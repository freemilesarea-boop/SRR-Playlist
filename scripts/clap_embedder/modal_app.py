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

        url = os.environ["SUPABASE_URL"]
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
            resp.raise_for_status()

    def _list_pending(self, limit: int) -> list:
        """list_tracks_needing_embedding RPC 호출."""
        import httpx

        url = os.environ["SUPABASE_URL"]
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
        """단일 트랙 임베딩 + DB 저장."""
        try:
            audio, sr = self._download_audio(audio_url)
            embedding = self._extract_embedding(audio, sr)
            self._store_embedding(track_id, embedding)
            return {"ok": True, "track_id": track_id, "dim": len(embedding)}
        except Exception as e:
            return {"ok": False, "track_id": track_id, "error": str(e)}

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
@app.function(image=image, secrets=secrets)
@modal.fastapi_endpoint(method="POST", label="embed-single")
def embed_single_endpoint(item: dict) -> dict:
    """POST { track_id, audio_url } → embedding 추출 + 저장."""
    track_id = item.get("track_id")
    audio_url = item.get("audio_url")
    if not track_id or not audio_url:
        return {"ok": False, "error": "track_id and audio_url required"}
    embedder = ClapEmbedder()
    return embedder.embed_single.remote(track_id, audio_url)


@app.function(image=image, secrets=secrets, timeout=3600)  # 1시간 한도
@modal.fastapi_endpoint(method="POST", label="backfill")
def backfill_endpoint(item: dict) -> dict:
    """POST { limit?: int } → 백필 일괄 처리."""
    limit = int(item.get("limit", 100))
    embedder = ClapEmbedder()
    return embedder.backfill.remote(limit)


# ----- 로컬 테스트 -----
@app.local_entrypoint()
def main():
    """`modal run modal_app.py` 로 단일 테스트 실행."""
    embedder = ClapEmbedder()
    result = embedder.backfill.remote(limit=3)
    print(json.dumps(result, indent=2))
