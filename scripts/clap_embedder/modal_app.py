"""
DEUDDA CLAP Embedding Worker — Modal serverless GPU app.

배포:
    pip install modal
    modal token set --token-id ... --token-secret ...
    modal deploy scripts/clap_embedder/modal_app.py

환경 변수 (Modal Secrets 에 등록):
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY

엔드포인트:
    POST /embed_single       — { track_id, audio_url } → 단일 트랙 임베딩 → store_track_embedding RPC 호출
    POST /backfill           — { limit?: int } → list_tracks_needing_embedding → 일괄 처리

운영:
    - cold start: ~30초 (모델 로드)
    - warm: 트랙당 ~3-5초 (다운로드 + 30초 추출 + CLAP 인코딩)
    - GPU: A10G (24GB), 한 번에 1~8 트랙 batch
    - 비용: $1.10/시간 → 1000 트랙 ≈ $1
"""

import modal
import io
import os
import json
from typing import Optional


def _supabase_url() -> str:
    """SUPABASE_URL 정규화 — protocol prefix 자동 추가, trailing slash 제거.
    Modal Secret 입력 실수 (예: 'nsoes...supabase.co' 또는 'https://...supabase.co/') 모두 흡수.
    """
    url = os.environ.get("SUPABASE_URL", "").strip().rstrip('/')
    if not url:
        raise RuntimeError("SUPABASE_URL env var not set in Modal Secret")
    if not url.startswith("http://") and not url.startswith("https://"):
        url = "https://" + url
    return url


# ----- Modal 앱 정의 -----
app = modal.App("deudda-clap-embedder")

# 이미지: CUDA + PyTorch + transformers + audio libs
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install(
        "torch==2.2.0",
        "torchaudio==2.2.0",
        "transformers==4.40.0",
        "librosa==0.10.1",
        "soundfile==0.12.1",
        "httpx==0.27.0",
        "numpy==1.26.0",
        "fastapi[standard]==0.115.0",
        "pyloudnorm==0.1.1",
        "scipy==1.13.0",
    )
)

# Secrets: Supabase URL + service role key
secrets = [modal.Secret.from_name("deudda-supabase")]

# 모델 캐시 영구 볼륨
model_volume = modal.Volume.from_name("clap-model-cache", create_if_missing=True)


# ----- CLAP 모델 로더 -----
@app.cls(
    image=image,
    gpu="A10G",
    secrets=secrets,
    volumes={"/cache": model_volume},
    timeout=600,
    scaledown_window=300,  # 5분 idle 후 종료 (비용 절감)
)
class ClapEmbedder:
    @modal.enter()
    def load_model(self):
        """컨테이너 시작 시 1회 모델 로드 — cold start 비용."""
        import torch
        from transformers import ClapModel, ClapProcessor

        os.environ["HF_HOME"] = "/cache/huggingface"
        os.environ["TRANSFORMERS_CACHE"] = "/cache/huggingface"

        model_id = "laion/larger_clap_music_and_speech"
        print(f"[ClapEmbedder] loading {model_id} ...")

        self.processor = ClapProcessor.from_pretrained(model_id)
        self.model = ClapModel.from_pretrained(model_id).to("cuda").eval()
        self.sample_rate = 48000

        # Zero-shot 분류용 텍스트 프롬프트 임베딩 — 한 번 계산해서 캐시
        self.energy_prompts = [
            "this is a very calm and quiet ambient music",   # level 1
            "this is a soft and gentle relaxing music",      # level 2
            "this is a moderately paced music",              # level 3
            "this is an energetic and lively music",         # level 4
            "this is a very intense and high energy music",  # level 5
        ]
        text_inputs = self.processor(
            text=self.energy_prompts, return_tensors="pt", padding=True,
        )
        text_inputs = {k: v.to("cuda") for k, v in text_inputs.items()}
        with torch.no_grad():
            text_features = self.model.get_text_features(**text_inputs)
        text_features = text_features / (text_features.norm(dim=-1, keepdim=True) + 1e-9)
        self.energy_text_features = text_features  # shape: [5, 512], cuda

        print("[ClapEmbedder] ready.")

    def _extract_embedding(self, audio_array, sr: int) -> list[float]:
        """numpy audio array → 512-dim embedding (list[float])."""
        import torch
        import librosa
        import numpy as np

        # 48kHz 리샘플 (CLAP 표준)
        if sr != self.sample_rate:
            audio_array = librosa.resample(audio_array, orig_sr=sr, target_sr=self.sample_rate)

        # 30초 구간 추출 (중앙)
        target_len = self.sample_rate * 30
        if len(audio_array) > target_len:
            start = (len(audio_array) - target_len) // 2
            audio_array = audio_array[start:start + target_len]
        elif len(audio_array) < target_len:
            audio_array = np.pad(audio_array, (0, target_len - len(audio_array)))

        # CLAP 인코딩
        inputs = self.processor(
            audios=audio_array,
            sampling_rate=self.sample_rate,
            return_tensors="pt",
        )
        inputs = {k: v.to("cuda") for k, v in inputs.items()}

        with torch.no_grad():
            audio_features = self.model.get_audio_features(**inputs)

        # 정규화 + 리스트 변환
        embedding = audio_features[0].cpu().numpy()
        embedding = embedding / (np.linalg.norm(embedding) + 1e-9)
        return embedding.tolist()

    def _classify_track(self, audio_array, sr: int, embedding: list[float]) -> dict:
        """CLAP zero-shot energy 분류 + librosa BPM 추정.

        Returns:
            {
              "energy_level": 1~5,
              "energy_confidence": 0~1 (softmax 확률),
              "energy_label_scores": {"level_1":0.1, ...},
              "bpm": int,
              "bpm_confidence": 0~1 (peak strength),
              "tempo_feel": "slow"|"mid"|"fast",
            }
        """
        import torch
        import librosa
        import numpy as np

        # 1) Energy zero-shot: cosine sim(audio_embed, energy_text_embeds) → softmax
        audio_emb = torch.tensor(embedding, dtype=torch.float32, device="cuda").unsqueeze(0)
        # audio_emb 는 이미 정규화돼 있음. text features 도 정규화됨.
        with torch.no_grad():
            sims = (audio_emb @ self.energy_text_features.T).squeeze(0)  # [5]
            # CLAP 의 logit_scale (or 100 곱) 적용해서 softmax 가 sharp 하게
            scores = torch.softmax(sims * 100.0, dim=-1)
        scores_np = scores.cpu().numpy()
        energy_idx = int(np.argmax(scores_np))
        energy_level = energy_idx + 1  # 0~4 → 1~5
        energy_conf = float(scores_np[energy_idx])
        energy_label_scores = {
            f"level_{i+1}": float(scores_np[i]) for i in range(5)
        }

        # 2) librosa BPM
        try:
            if sr != 22050:  # librosa beat tracking 표준 sr
                audio_for_bpm = librosa.resample(audio_array, orig_sr=sr, target_sr=22050)
                bpm_sr = 22050
            else:
                audio_for_bpm = audio_array
                bpm_sr = sr
            tempo, _ = librosa.beat.beat_track(y=audio_for_bpm, sr=bpm_sr)
            bpm = int(round(float(tempo)))
            bpm_conf = 0.7  # librosa beat tracker 는 confidence 직접 안 줌 → 휴리스틱
        except Exception as e:
            print(f"[ClapEmbedder] BPM detection failed: {e}")
            bpm = None
            bpm_conf = None

        # 3) tempo_feel from BPM
        if bpm is None:
            tempo_feel = None
        elif bpm < 80:
            tempo_feel = "slow"
        elif bpm < 120:
            tempo_feel = "mid"
        else:
            tempo_feel = "fast"

        return {
            "energy_level": energy_level,
            "energy_confidence": round(energy_conf, 3),
            "energy_label_scores": energy_label_scores,
            "bpm": bpm,
            "bpm_confidence": bpm_conf,
            "tempo_feel": tempo_feel,
        }

    def _store_predictions(self, track_id: str, predictions: dict):
        """store_track_ai_predictions RPC 호출."""
        import httpx

        url = _supabase_url()
        key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                f"{url}/rest/v1/rpc/store_track_ai_predictions",
                headers={
                    "apikey": key,
                    "Authorization": f"Bearer {key}",
                    "content-type": "application/json",
                },
                json={
                    "p_track_id": track_id,
                    "p_predicted_energy_level": predictions.get("energy_level"),
                    "p_energy_confidence": predictions.get("energy_confidence"),
                    "p_predicted_bpm": predictions.get("bpm"),
                    "p_bpm_confidence": predictions.get("bpm_confidence"),
                    "p_predicted_tempo_feel": predictions.get("tempo_feel"),
                    "p_energy_label_scores": predictions.get("energy_label_scores"),
                },
            )
            if resp.status_code >= 400:
                raise RuntimeError(f"store_track_ai_predictions HTTP {resp.status_code}: {resp.text[:500]}")

    def _analyze_qc(self, audio_array, sr: int) -> dict:
        """DSP-급 음원 QC 분석 — LUFS / TruePeak / Clipping / DR / Noise / Stereo / Silence.

        Returns dict with raw metrics + qc_score + qc_grade + risk_level + issues_json.
        """
        import numpy as np
        import pyloudnorm as pyln

        # 입력은 mono 가정 (download 시 mono 로 디코딩). stereo_width 계산은 별도 처리.
        if audio_array.ndim == 1:
            mono = audio_array
            stereo_width = 0.0  # mono → 0
        else:
            mono = np.mean(audio_array, axis=0) if audio_array.shape[0] < audio_array.shape[1] else np.mean(audio_array, axis=1)
            # mid/side 기반 스테레오 폭 = side / (mid + side + 1e-9)
            left = audio_array[0] if audio_array.shape[0] < audio_array.shape[1] else audio_array[:, 0]
            right = audio_array[1] if audio_array.shape[0] < audio_array.shape[1] else audio_array[:, 1]
            mid = (left + right) / 2
            side = (left - right) / 2
            mid_rms = float(np.sqrt(np.mean(mid ** 2)))
            side_rms = float(np.sqrt(np.mean(side ** 2)))
            stereo_width = side_rms / (mid_rms + side_rms + 1e-9)

        duration = float(len(mono) / sr)

        # 1) Integrated LUFS (ITU-R BS.1770)
        try:
            meter = pyln.Meter(sr)  # block-based loudness measurement
            integrated_lufs = float(meter.integrated_loudness(mono))
            if not np.isfinite(integrated_lufs) or integrated_lufs < -80:
                integrated_lufs = -80.0
        except Exception:
            integrated_lufs = None

        # 2) True Peak (간단 근사 — 4x oversample 후 max abs → dBTP)
        try:
            from scipy import signal as sps
            up = sps.resample_poly(mono, 4, 1)
            peak_lin = float(np.max(np.abs(up)))
            true_peak_db = 20 * np.log10(peak_lin + 1e-12)
        except Exception:
            peak_lin = float(np.max(np.abs(mono)))
            true_peak_db = 20 * np.log10(peak_lin + 1e-12)

        # 3) Clipping — 0 dBFS 이상 샘플 카운트 (mono 기반 + tolerance)
        clipping_count = int(np.sum(np.abs(mono) >= 0.99))

        # 4) Noise floor — RMS lower 10th percentile of 50ms windows
        win = max(int(sr * 0.05), 1)
        if len(mono) > win:
            squared = mono ** 2
            n_blocks = len(mono) // win
            rms = np.sqrt(np.mean(squared[: n_blocks * win].reshape(n_blocks, win), axis=1))
            noise_rms = float(np.percentile(rms, 10))
            noise_floor_db = 20 * np.log10(noise_rms + 1e-12)
        else:
            noise_floor_db = -60.0

        # 5) Silence ratio — |x| < -50dBFS (≈ 0.003 amp) 인 샘플 비율
        silence_thresh = 10 ** (-50 / 20.0)
        silence_ratio = float(np.mean(np.abs(mono) < silence_thresh))

        # 6) Dynamic Range — true_peak_db - integrated_lufs (PSR 근사)
        if integrated_lufs is not None:
            dynamic_range = float(true_peak_db - integrated_lufs)
        else:
            dynamic_range = None

        # 7) Distortion proxy — RMS 위 4*RMS 초과 샘플 비율 (간단 한계)
        rms_overall = float(np.sqrt(np.mean(mono ** 2)))
        distortion_score = float(np.mean(np.abs(mono) > 4 * rms_overall + 1e-9)) if rms_overall > 0 else 0.0
        distortion_score = min(distortion_score * 5, 1.0)  # 0-1 스케일

        # ----- 점수/등급/위험도 계산 -----
        issues = []
        score = 100.0

        # LUFS — 목표 -14 LUFS (±2 허용)
        if integrated_lufs is None:
            score -= 5
            issues.append({"code": "LOUDNESS_UNKNOWN", "message": "LUFS 측정 실패"})
        elif integrated_lufs < -18:
            score -= 15
            issues.append({"code": "LOUDNESS_LOW", "message": f"LUFS {integrated_lufs:.1f} — 권장 -14 보다 낮음"})
        elif integrated_lufs > -10:
            score -= 12
            issues.append({"code": "LOUDNESS_HIGH", "message": f"LUFS {integrated_lufs:.1f} — 권장 -14 보다 너무 높음"})
        elif integrated_lufs < -16 or integrated_lufs > -12:
            score -= 5
            issues.append({"code": "LOUDNESS_OFFTARGET", "message": f"LUFS {integrated_lufs:.1f} — 목표 -14 에서 벗어남"})

        # True Peak — -1 dBTP 초과 금지
        if true_peak_db > 0:
            score -= 20
            issues.append({"code": "TRUE_PEAK_CLIP", "message": f"True peak {true_peak_db:.1f} dBTP — 0 dB 초과 (클리핑 위험)"})
        elif true_peak_db > -1:
            score -= 8
            issues.append({"code": "TRUE_PEAK_HOT", "message": f"True peak {true_peak_db:.1f} dBTP — 권장 -1 dBTP 초과"})

        # Clipping — 100샘플 이상이면 위험
        if clipping_count > 500:
            score -= 25
            issues.append({"code": "CLIPPING_SEVERE", "message": f"클리핑 {clipping_count}샘플 — 심각"})
        elif clipping_count > 100:
            score -= 12
            issues.append({"code": "CLIPPING", "message": f"클리핑 {clipping_count}샘플 발생"})
        elif clipping_count > 10:
            score -= 4
            issues.append({"code": "CLIPPING_MINOR", "message": f"클리핑 {clipping_count}샘플 경미"})

        # Noise floor — > -45 dBFS 면 노이즈 많음
        if noise_floor_db > -35:
            score -= 15
            issues.append({"code": "NOISE_HIGH", "message": f"노이즈 플로어 {noise_floor_db:.1f} dBFS — 매우 높음"})
        elif noise_floor_db > -45:
            score -= 5
            issues.append({"code": "NOISE_ELEVATED", "message": f"노이즈 플로어 {noise_floor_db:.1f} dBFS — 다소 높음"})

        # Silence — > 30% 면 비정상
        if silence_ratio > 0.5:
            score -= 30
            issues.append({"code": "SILENCE_EXCESS", "message": f"무음 비율 {silence_ratio*100:.0f}% — 매우 과다"})
        elif silence_ratio > 0.3:
            score -= 12
            issues.append({"code": "SILENCE_HIGH", "message": f"무음 비율 {silence_ratio*100:.0f}%"})

        # Dynamic Range — 4 미만 (over-compressed) / 25 이상 (제어 부족)
        if dynamic_range is not None:
            if dynamic_range < 3:
                score -= 10
                issues.append({"code": "DR_LOW", "message": f"DR {dynamic_range:.1f} — 과도하게 압축됨"})
            elif dynamic_range > 25:
                score -= 5
                issues.append({"code": "DR_HIGH", "message": f"DR {dynamic_range:.1f} — 다이내믹 과다"})

        # Stereo width — mono 면 신경 안 씀, stereo 인데 width < 0.05 면 사실상 mono
        if stereo_width > 0 and stereo_width < 0.05:
            score -= 3
            issues.append({"code": "STEREO_NARROW", "message": "스테레오 폭이 매우 좁음 (사실상 mono)"})

        # Distortion proxy
        if distortion_score > 0.3:
            score -= 10
            issues.append({"code": "DISTORTION_HIGH", "message": f"왜곡 추정치 높음 ({distortion_score:.2f})"})

        # Duration — 너무 짧거나 너무 김
        if duration < 20:
            score -= 20
            issues.append({"code": "DURATION_SHORT", "message": f"재생시간 {duration:.0f}초 — 매우 짧음"})
        elif duration > 900:
            score -= 5
            issues.append({"code": "DURATION_LONG", "message": f"재생시간 {duration/60:.0f}분"})

        score = max(0.0, min(100.0, score))

        # 등급
        if score >= 85:
            qc_grade = 'A'
        elif score >= 70:
            qc_grade = 'B'
        elif score >= 50:
            qc_grade = 'C'
        else:
            qc_grade = 'D'

        # 위험도 — 심각 항목 가산
        critical_codes = {'CLIPPING_SEVERE', 'SILENCE_EXCESS', 'TRUE_PEAK_CLIP', 'DURATION_SHORT'}
        high_codes = {'CLIPPING', 'NOISE_HIGH', 'SILENCE_HIGH', 'LOUDNESS_HIGH', 'DISTORTION_HIGH'}
        codes = {i['code'] for i in issues}
        if codes & critical_codes:
            risk_level = 'CRITICAL'
        elif codes & high_codes or score < 50:
            risk_level = 'HIGH'
        elif score < 70:
            risk_level = 'MEDIUM'
        else:
            risk_level = 'LOW'

        return {
            "integrated_lufs": round(integrated_lufs, 2) if integrated_lufs is not None else None,
            "true_peak_db": round(true_peak_db, 2),
            "dynamic_range": round(dynamic_range, 2) if dynamic_range is not None else None,
            "stereo_width": round(stereo_width, 3),
            "noise_floor_db": round(noise_floor_db, 2),
            "silence_ratio": round(silence_ratio, 3),
            "clipping_count": clipping_count,
            "distortion_score": round(distortion_score, 3),
            "sample_rate": int(sr),
            "bit_depth": None,  # librosa 디코딩 후엔 알 수 없음
            "duration": round(duration, 2),
            "qc_score": round(score, 2),
            "qc_grade": qc_grade,
            "risk_level": risk_level,
            "issues": issues,
        }

    def _store_qc_report(self, track_id: str, qc: dict):
        """store_track_qc_report RPC 호출."""
        import httpx
        import json

        url = _supabase_url()
        key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                f"{url}/rest/v1/rpc/store_track_qc_report",
                headers={
                    "apikey": key,
                    "Authorization": f"Bearer {key}",
                    "content-type": "application/json",
                },
                json={
                    "p_track_id": track_id,
                    "p_integrated_lufs": qc.get("integrated_lufs"),
                    "p_true_peak_db": qc.get("true_peak_db"),
                    "p_dynamic_range": qc.get("dynamic_range"),
                    "p_stereo_width": qc.get("stereo_width"),
                    "p_noise_floor_db": qc.get("noise_floor_db"),
                    "p_silence_ratio": qc.get("silence_ratio"),
                    "p_clipping_count": qc.get("clipping_count"),
                    "p_distortion_score": qc.get("distortion_score"),
                    "p_sample_rate": qc.get("sample_rate"),
                    "p_bit_depth": qc.get("bit_depth"),
                    "p_duration": qc.get("duration"),
                    "p_qc_score": qc.get("qc_score"),
                    "p_qc_grade": qc.get("qc_grade"),
                    "p_risk_level": qc.get("risk_level"),
                    "p_issues_json": qc.get("issues"),
                },
            )
            if resp.status_code >= 400:
                raise RuntimeError(f"store_track_qc_report HTTP {resp.status_code}: {resp.text[:500]}")

    def _list_pending_qc(self, limit: int) -> list:
        """list_tracks_needing_qc RPC."""
        import httpx
        url = _supabase_url()
        key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                f"{url}/rest/v1/rpc/list_tracks_needing_qc",
                headers={"apikey": key, "Authorization": f"Bearer {key}", "content-type": "application/json"},
                json={"p_limit": limit},
            )
            resp.raise_for_status()
            return resp.json()

    def _download_audio(self, audio_url: str) -> tuple:
        """audio_url 에서 오디오 다운로드 후 numpy array 로 변환."""
        import httpx
        import librosa
        import io

        print(f"[ClapEmbedder] downloading {audio_url[:80]}...")
        with httpx.Client(timeout=60.0, follow_redirects=True) as client:
            resp = client.get(audio_url)
            resp.raise_for_status()
            audio_bytes = resp.content

        # librosa 로 디코딩 (ffmpeg backend)
        audio, sr = librosa.load(io.BytesIO(audio_bytes), sr=None, mono=True)
        return audio, sr

    def _store_embedding(self, track_id: str, embedding: list[float]):
        """Supabase store_track_embedding RPC 호출."""
        import httpx

        url = _supabase_url()
        key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                f"{url}/rest/v1/rpc/store_track_embedding",
                headers={
                    "apikey": key,
                    "Authorization": f"Bearer {key}",
                    "content-type": "application/json",
                },
                json={
                    "p_track_id": track_id,
                    "p_embedding": embedding,
                    "p_model_version": "laion-clap-music-v1",
                },
            )
            if resp.status_code >= 400:
                raise RuntimeError(f"store_track_embedding HTTP {resp.status_code}: {resp.text[:500]}")

    def _list_pending(self, limit: int) -> list:
        """list_tracks_needing_embedding RPC 호출."""
        import httpx

        url = _supabase_url()
        key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                f"{url}/rest/v1/rpc/list_tracks_needing_embedding",
                headers={
                    "apikey": key,
                    "Authorization": f"Bearer {key}",
                    "content-type": "application/json",
                },
                json={"p_limit": limit},
            )
            resp.raise_for_status()
            return resp.json()

    @modal.method()
    def embed_single(self, track_id: str, audio_url: str) -> dict:
        """단일 트랙 임베딩 + zero-shot 분류 + BPM + DB 저장."""
        try:
            audio, sr = self._download_audio(audio_url)
            embedding = self._extract_embedding(audio, sr)
            self._store_embedding(track_id, embedding)
            # 분류는 best-effort — 실패해도 임베딩은 저장됨
            try:
                predictions = self._classify_track(audio, sr, embedding)
                self._store_predictions(track_id, predictions)
                return {"ok": True, "track_id": track_id, "dim": len(embedding), "predictions": predictions}
            except Exception as pe:
                print(f"[ClapEmbedder] classify failed for {track_id}: {pe}")
                return {"ok": True, "track_id": track_id, "dim": len(embedding), "classify_error": str(pe)[:200]}
        except Exception as e:
            return {"ok": False, "track_id": track_id, "error": str(e)}

    def _list_pending_predictions(self, limit: int) -> list:
        """list_tracks_needing_predictions RPC 호출 (분류 백필용)."""
        import httpx

        url = _supabase_url()
        key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                f"{url}/rest/v1/rpc/list_tracks_needing_predictions",
                headers={
                    "apikey": key,
                    "Authorization": f"Bearer {key}",
                    "content-type": "application/json",
                },
                json={"p_limit": limit},
            )
            resp.raise_for_status()
            return resp.json()

    @modal.method()
    def classify_backfill(self, limit: int = 50) -> dict:
        """이미 임베딩된 트랙 중 예측 없는 것 → 다운로드 + 분류 (임베딩 skip)."""
        tracks = self._list_pending_predictions(limit)
        print(f"[ClapEmbedder] classify backfill {len(tracks)} tracks")
        done = 0
        failed = []
        for t in tracks:
            track_id = t["track_id"]
            audio_url = t.get("audio_url")
            if not audio_url:
                failed.append({"track_id": track_id, "error": "no_audio_url"})
                continue
            try:
                audio, sr = self._download_audio(audio_url)
                embedding = self._extract_embedding(audio, sr)  # 분류에 audio_emb 필요
                predictions = self._classify_track(audio, sr, embedding)
                self._store_predictions(track_id, predictions)
                done += 1
                if done % 10 == 0:
                    print(f"[ClapEmbedder] classify {done}/{len(tracks)} done")
            except Exception as e:
                failed.append({"track_id": track_id, "error": str(e)[:200]})
        return {
            "ok": True,
            "total_candidates": len(tracks),
            "classified": done,
            "failed_count": len(failed),
            "failed_samples": failed[:10],
        }

    @modal.method()
    def qc_single(self, track_id: str, audio_url: str) -> dict:
        """단일 트랙 QC 분석 + DB 저장."""
        try:
            audio, sr = self._download_audio(audio_url)
            qc = self._analyze_qc(audio, sr)
            self._store_qc_report(track_id, qc)
            return {"ok": True, "track_id": track_id,
                    "qc_score": qc["qc_score"], "qc_grade": qc["qc_grade"],
                    "risk_level": qc["risk_level"], "issues_count": len(qc["issues"])}
        except Exception as e:
            return {"ok": False, "track_id": track_id, "error": str(e)[:300]}

    @modal.method()
    def qc_backfill(self, limit: int = 50, dry_run: bool = False) -> dict:
        """QC 없는 트랙들 백필. dry_run=True 면 후보만 반환하고 분석 안 함.
        실패 시 전체 failed 목록 반환 (응답 페이로드 크기 고려해 최대 100건)."""
        tracks = self._list_pending_qc(limit)
        if dry_run:
            return {
                "ok": True, "dryRun": True,
                "candidate_count": len(tracks),
                "candidates": [{"track_id": t["track_id"], "title": t.get("title")} for t in tracks[:limit]],
            }
        print(f"[QC] backfill {len(tracks)} tracks")
        done = 0
        failed = []
        for t in tracks:
            track_id = t["track_id"]
            audio_url = t.get("audio_url")
            if not audio_url:
                failed.append({"track_id": track_id, "error": "no_audio_url"})
                continue
            try:
                audio, sr = self._download_audio(audio_url)
                qc = self._analyze_qc(audio, sr)
                self._store_qc_report(track_id, qc)
                done += 1
                if done % 10 == 0:
                    print(f"[QC] {done}/{len(tracks)} done")
            except Exception as e:
                failed.append({"track_id": track_id, "error": str(e)[:200]})
        return {"ok": True, "total_candidates": len(tracks),
                "analyzed": done, "failed_count": len(failed),
                "failed": failed[:100], "failed_samples": failed[:10]}

    @modal.method()
    def backfill(self, limit: int = 100) -> dict:
        """백필: list_tracks_needing_embedding 호출 → 순차 처리 → 결과 요약."""
        tracks = self._list_pending(limit)
        print(f"[ClapEmbedder] backfill {len(tracks)} tracks")
        sent = 0
        failed = []
        for t in tracks:
            track_id = t["track_id"]
            audio_url = t.get("audio_url")
            if not audio_url:
                failed.append({"track_id": track_id, "error": "no_audio_url"})
                continue
            try:
                audio, sr = self._download_audio(audio_url)
                embedding = self._extract_embedding(audio, sr)
                self._store_embedding(track_id, embedding)
                try:
                    predictions = self._classify_track(audio, sr, embedding)
                    self._store_predictions(track_id, predictions)
                except Exception as pe:
                    print(f"[ClapEmbedder] classify skipped for {track_id}: {pe}")
                sent += 1
                if sent % 10 == 0:
                    print(f"[ClapEmbedder] {sent}/{len(tracks)} done")
            except Exception as e:
                failed.append({"track_id": track_id, "error": str(e)[:200]})
        return {
            "ok": True,
            "total_candidates": len(tracks),
            "embedded": sent,
            "failed_count": len(failed),
            "failed_samples": failed[:10],
        }


# ----- HTTP 엔드포인트 -----
def _check_auth(item: dict):
    """공통 시크릿 검증 — QC_WORKER_SECRET env 가 있으면 body._auth 매칭 필수.
    env 미설정 시 우회 (dev). 인증 실패 시 401 JSONResponse 반환, 통과 시 None.
    """
    expected = os.environ.get("QC_WORKER_SECRET")
    if not expected:
        print("[QC_AUTH] QC_WORKER_SECRET not set — bypassing auth (dev mode)")
        return None
    if item.get("_auth") != expected:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=401,
            content={"ok": False, "error": "unauthorized: invalid worker secret"},
        )
    return None


@app.function(image=image, secrets=secrets)
@modal.fastapi_endpoint(method="POST", label="embed-single")
def embed_single_endpoint(item: dict) -> dict:
    """POST { track_id, audio_url, _auth } → embedding 추출 + 저장."""
    deny = _check_auth(item)
    if deny is not None: return deny
    track_id = item.get("track_id")
    audio_url = item.get("audio_url")
    if not track_id or not audio_url:
        return {"ok": False, "error": "track_id and audio_url required"}
    embedder = ClapEmbedder()
    return embedder.embed_single.remote(track_id, audio_url)


@app.function(image=image, secrets=secrets, timeout=3600)
@modal.fastapi_endpoint(method="POST", label="backfill")
def backfill_endpoint(item: dict) -> dict:
    """POST { limit?, _auth } → 임베딩 + 분류 백필."""
    deny = _check_auth(item)
    if deny is not None: return deny
    limit = int(item.get("limit", 100))
    embedder = ClapEmbedder()
    return embedder.backfill.remote(limit)


@app.function(image=image, secrets=secrets, timeout=3600)
@modal.fastapi_endpoint(method="POST", label="classify-backfill")
def classify_backfill_endpoint(item: dict) -> dict:
    """POST { limit?, _auth } → 임베딩 있는데 분류 없는 트랙 백필."""
    deny = _check_auth(item)
    if deny is not None: return deny
    limit = int(item.get("limit", 50))
    embedder = ClapEmbedder()
    return embedder.classify_backfill.remote(limit)


@app.function(image=image, secrets=secrets)
@modal.fastapi_endpoint(method="POST", label="qc-single")
def qc_single_endpoint(item: dict) -> dict:
    """POST { track_id, audio_url, _auth } → AI QC 분석 + 저장."""
    deny = _check_auth(item)
    if deny is not None: return deny
    track_id = item.get("track_id")
    audio_url = item.get("audio_url")
    if not track_id or not audio_url:
        return {"ok": False, "error": "track_id and audio_url required"}
    embedder = ClapEmbedder()
    return embedder.qc_single.remote(track_id, audio_url)


@app.function(image=image, secrets=secrets, timeout=3600)
@modal.fastapi_endpoint(method="POST", label="qc-backfill")
def qc_backfill_endpoint(item: dict) -> dict:
    """POST { limit?, dryRun?, _auth } → QC 백필. dryRun=true 면 후보만 반환."""
    deny = _check_auth(item)
    if deny is not None: return deny
    limit = int(item.get("limit", 50))
    dry_run = bool(item.get("dryRun", False))
    embedder = ClapEmbedder()
    return embedder.qc_backfill.remote(limit, dry_run)


# ----- 로컬 테스트 -----
@app.local_entrypoint()
def main():
    """`modal run modal_app.py` 로 단일 테스트 실행."""
    embedder = ClapEmbedder()
    result = embedder.backfill.remote(limit=3)
    print(json.dumps(result, indent=2))
