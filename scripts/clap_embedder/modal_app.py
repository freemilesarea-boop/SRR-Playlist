"""
DEUDDA CLAP Embedding Worker — Modal serverless GPU app.

배포:
    pip install modal
    modal token set --token-id ... --token-secret ...
    modal deploy scripts/clap_embedder/modal_app.py

환경 변수 (Modal Secrets 에 등록):
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY

엔드포인트 (Modal Free 플랜 Web Function 제한 8개 — 7개 사용):
    POST /embed-single       — { track_id, audio_url } → 단일 트랙 임베딩
    POST /backfill           — { limit?: int } → list_tracks_needing_embedding → 일괄 처리
    POST /qc-single          — { track_id, audio_url } → 단일 QC
    POST /qc-backfill        — { limit?, dryRun? } → QC 일괄
    POST /genre-backfill     — { limit?, dryRun?, track_id?, audio_url? } → 장르 분류
                                 track_id 지정 시 단일 트랙
    POST /mood-backfill      — { limit?, dryRun?, track_id?, audio_url? } → mood 분류
                                 track_id 지정 시 단일 트랙
    POST /storetype-backfill — { limit?, dryRun?, track_id?, audio_url? } → store_type 분류 (X1.3)
                                 track_id 지정 시 단일 트랙

⚠️ 백필 호출 안전 권고 (X1.2.4 + X1.3.1 이후):
    - limit ≤ 50 으로 chunk 호출 권장. 트랙당 3-5초 × 50 ≈ 150-250초, HTTP timeout 300초 이내.
    - limit=233 단일 호출은 timeout 또는 중단 → 처리 누락 발생 (X1.2.3 + X1.3 실측).
    - 전체 백필 = limit=50 × 7~8 회 반복. 각 호출 후 누락 수 확인 SQL:
        select count(*) from public.tracks t
          where t.audio_url is not null and t.removed_at is null
            and not exists (select 1 from public.track_ai_predictions p
                            where p.track_id=t.id and p.model_version='taxonomy-v1'
                              and p.predicted_moods is not null);  -- mood 미처리

  변경 기록:
    X1.2.2 — single (2개) 제거 → backfill 에 track_id 옵션 통합 (8 → 7)
    X1.3   — classify-backfill (energy/BPM) 제거 → storetype-backfill 추가 (7 유지)

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
        # 진단 메시지 — Secret attachment 끊김 여부 확인용 (현재 env 보고)
        env_keys_sample = sorted([k for k in os.environ.keys()
                                  if 'SUPABASE' in k or 'QC' in k or 'KEY' in k])
        raise RuntimeError(
            f"SUPABASE_URL env var not set in Modal Secret. "
            f"Available secret-like env keys: {env_keys_sample or '(none)'}. "
            f"Check: modal secret inspect deudda-supabase + modal app deploy 재실행."
        )
    if not url.startswith("http://") and not url.startswith("https://"):
        url = "https://" + url
    return url


def _supabase_key() -> str:
    """SUPABASE_SERVICE_ROLE_KEY 명시 체크 — KeyError 대신 진단 메시지."""
    k = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not k:
        env_keys_sample = sorted([k for k in os.environ.keys() if 'SUPABASE' in k or 'KEY' in k])
        raise RuntimeError(
            f"SUPABASE_SERVICE_ROLE_KEY env var not set in Modal Secret. "
            f"Available secret-like env keys: {env_keys_sample or '(none)'}."
        )
    return k


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

    # ========== Phase X1.1 — taxonomy zero-shot 장르 분류 ==========

    def _fetch_active_genres(self) -> list[dict]:
        """list_taxonomy_genres RPC → 활성 장르 + name_en + name_ko 수집."""
        import httpx
        url = _supabase_url()
        key = _supabase_key()
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                f"{url}/rest/v1/rpc/list_taxonomy_genres",
                headers={"apikey": key, "Authorization": f"Bearer {key}",
                         "content-type": "application/json"},
                json={},
            )
            resp.raise_for_status()
            rows = resp.json()
        # [{slug, name_ko, name_en, is_active, sort_order, ...}, ...]
        return [{"slug": r["slug"], "name_en": r["name_en"], "name_ko": r["name_ko"]} for r in rows]

    def _ensure_genre_features(self):
        """taxonomy_genres 활성 목록 → CLAP text features 캐싱.
        장르당 3 prompt 평균 → 1 feature. 호출 시 캐시 없으면 계산, 있으면 재사용.
        Cold container 마다 1번 재계산.
        """
        import torch

        if getattr(self, "_genre_cache_loaded", False):
            return

        genres = self._fetch_active_genres()
        if not genres:
            raise RuntimeError("no active taxonomy_genres rows — Phase X1.0 마이그레이션 미적용?")

        prompts: list[str] = []
        per_genre_prompt_count = 3
        for g in genres:
            en = g["name_en"]
            prompts.append(f"this is {en} music")
            prompts.append(f"a {en} song")
            prompts.append(f"{en} background music")

        text_inputs = self.processor(text=prompts, return_tensors="pt", padding=True)
        text_inputs = {k: v.to("cuda") for k, v in text_inputs.items()}
        with torch.no_grad():
            text_features = self.model.get_text_features(**text_inputs)
        # normalize per-prompt
        text_features = text_features / (text_features.norm(dim=-1, keepdim=True) + 1e-9)
        # 평균 over 3 prompts → re-normalize per-genre
        text_features = text_features.view(len(genres), per_genre_prompt_count, -1).mean(dim=1)
        text_features = text_features / (text_features.norm(dim=-1, keepdim=True) + 1e-9)

        self._genre_slugs = [g["slug"] for g in genres]
        self._genre_labels_ko = [g["name_ko"] for g in genres]
        self._genre_text_features = text_features  # [N_genre, 512] cuda
        self._genre_cache_loaded = True
        print(f"[ClapEmbedder] cached genre text features for {len(genres)} active genres")

    def _classify_genre(self, audio_embedding: list[float]) -> dict:
        """audio_embedding (정규화 512-dim) → 장르 분류 결과.
        Returns:
          {
            "predicted_main_genre": "kpop",
            "predicted_sub_genres": ["pop","ballad","indie"],
            "genre_confidence": 0.421,
            "prediction_scores": {"genre": {"kpop":0.42,"pop":0.18,...}}
          }
        """
        import torch
        import numpy as np

        self._ensure_genre_features()

        audio_emb = torch.tensor(audio_embedding, dtype=torch.float32, device="cuda").unsqueeze(0)
        # audio_emb 는 정규화된 상태 (extract_embedding 마지막에 정규화)
        with torch.no_grad():
            sims = (audio_emb @ self._genre_text_features.T).squeeze(0)  # [N_genre]
            scores = torch.softmax(sims * 100.0, dim=-1)
        scores_np = scores.cpu().numpy()

        order = np.argsort(-scores_np)
        top1_idx = int(order[0])
        top1 = self._genre_slugs[top1_idx]
        top1_conf = float(scores_np[top1_idx])

        # sub_genres = top2~top4
        sub = [self._genre_slugs[int(i)] for i in order[1:4]]

        # prediction_scores: {"genre": {slug: float, ...}}
        genre_scores = {self._genre_slugs[i]: round(float(scores_np[i]), 4) for i in range(len(self._genre_slugs))}
        return {
            "predicted_main_genre": top1,
            "predicted_sub_genres": sub,
            "genre_confidence": round(top1_conf, 4),
            "prediction_scores": {"genre": genre_scores},
        }

    def _store_genre_prediction(self, track_id: str, result: dict):
        """store_track_genre_prediction RPC 호출."""
        import httpx
        url = _supabase_url()
        key = _supabase_key()
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                f"{url}/rest/v1/rpc/store_track_genre_prediction",
                headers={"apikey": key, "Authorization": f"Bearer {key}",
                         "content-type": "application/json"},
                json={
                    "p_track_id": track_id,
                    "p_predicted_main_genre": result["predicted_main_genre"],
                    "p_predicted_sub_genres": result["predicted_sub_genres"],
                    "p_genre_confidence": result["genre_confidence"],
                    "p_prediction_scores": result["prediction_scores"],
                    "p_model_version": "taxonomy-v1",
                },
            )
            if resp.status_code >= 400:
                raise RuntimeError(f"store_track_genre_prediction HTTP {resp.status_code}: {resp.text[:500]}")

    def _list_pending_genre(self, limit: int) -> list:
        import httpx
        url = _supabase_url()
        key = _supabase_key()
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                f"{url}/rest/v1/rpc/list_tracks_needing_genre_classification",
                headers={"apikey": key, "Authorization": f"Bearer {key}",
                         "content-type": "application/json"},
                json={"p_limit": limit},
            )
            resp.raise_for_status()
            return resp.json()

    # ========== Phase X1.2 — taxonomy zero-shot Mood 분류 ==========

    # Phase X1.2.4 — happy 59% 과적합 + 9 mood 0건 + 운영 불가 → 사용자 spec 기반 전면 재설계.
    #
    # 핵심 변경:
    #   - happy 더 축소 ("가벼운 기분 좋은 pop"). electronic/rock/dance/workout/party/festival/high energy 금지
    #   - energetic = hard rock workout (Rock/헬스장 흡수)
    #   - exciting = dance electronic festival (구 happy 의 광범위 영역)
    #   - lively = pop rock retail (J-Rock/J-Pop 흡수)
    #   - emotional / romantic = ballad 명시 (Ballad → bright 차단)
    #   - calm = 병원/요가/대기 / relaxed = 카페/라운지 / warm = 어쿠스틱 감성
    #   - sensual = 뷰티/편집샵/와인바 / chic = 패션/모던 / luxurious = 호텔/와인바 jazz
    _MOOD_PROMPTS: dict[str, list[str]] = {
        "calm": [
            "calm hospital waiting room music",
            "quiet yoga relaxation music",
            "peaceful clinic background music",
            "gentle meditation music",
        ],
        "relaxed": [
            "relaxed cafe background music",
            "easygoing comfortable lounge music",
            "soft laid back coffee shop music",
            "mellow lounge background music",
        ],
        "warm": [
            "warm acoustic cafe music",
            "cozy mellow background music",
            "warm vintage acoustic instrumental",
        ],
        "bright": [
            "bright daytime acoustic music",
            "clear morning pop music",
            "light sunny instrumental",
        ],
        "lively": [
            "lively pop rock music",
            "upbeat retail background music",
            "playful bright shop music",
        ],
        "happy": [
            "light feel good pop music",
            "pleasant cheerful song",
            "friendly mellow pop song",
        ],
        "emotional": [
            "emotional ballad music",
            "sentimental vocal ballad",
            "slow heartfelt song",
        ],
        "romantic": [
            "romantic ballad music",
            "intimate evening song",
            "romantic dinner jazz",
            "candlelight jazz music",
        ],
        "dreamy": [
            "dreamy ambient music",
            "soft atmospheric night music",
            "mellow dreamlike background music",
            "floating ethereal music",
        ],
        "sensual": [
            "sensual stylish boutique music",
            "sophisticated sensual lounge music",
            "elegant sensual fashion music",
            "refined wine bar sensual atmosphere",
        ],
        "chic": [
            "chic minimalist music",
            "stylish modern lounge music",
            "sophisticated trendy background music",
            "minimalist fashion music",
        ],
        "luxurious": [
            "sophisticated jazz lounge music",
            "elegant hotel lobby jazz",
            "premium wine bar jazz",
            "high end cocktail bar music",
            "refined luxury lounge atmosphere",
        ],
        "exciting": [
            "exciting dance electronic music",
            "festival dance music",
            "fun event music",
        ],
        "energetic": [
            "hard rock workout music",
            "aggressive gym training music",
            "high energy rock music",
            "powerful fitness music",
        ],
        "trendy": [
            "trendy hip street fashion music",
            "trendy idol playlist",
            "trendy youth culture music",
        ],
        "focused": [
            "focused concentration music",
            "study cafe background music",
            "minimal focus instrumental",
            "productivity background music",
        ],
    }

    def _fetch_active_moods(self) -> list[dict]:
        """list_taxonomy_moods RPC → 활성 mood 목록 (slug + name_en + name_ko)."""
        import httpx
        url = _supabase_url()
        key = _supabase_key()
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                f"{url}/rest/v1/rpc/list_taxonomy_moods",
                headers={"apikey": key, "Authorization": f"Bearer {key}",
                         "content-type": "application/json"},
                json={},
            )
            resp.raise_for_status()
            rows = resp.json()
        return [{"slug": r["slug"], "name_en": r["name_en"], "name_ko": r["name_ko"]} for r in rows]

    def _ensure_mood_features(self):
        """활성 mood 목록 → CLAP text features 캐싱.
        slug 별 3 DSP-상황 prompts 평균 → 단일 정규화 feature (X1.1 genre 패턴 동일).
        미정의 slug 는 fallback 으로 'name_en mood music' 단일.
        """
        import torch

        if getattr(self, "_mood_cache_loaded", False):
            return

        moods = self._fetch_active_moods()
        if not moods:
            raise RuntimeError("no active taxonomy_moods rows — Phase X1.0 마이그레이션 미적용?")

        # mood 별 prompt 개수가 다를 수 있으므로 (정의된 slug = 3, fallback = 1)
        # 그룹 인덱스를 함께 보존했다가 인코딩 후 mood 별 평균.
        prompts: list[str] = []
        group_idx: list[int] = []  # 각 prompt 의 mood 인덱스
        for i, m in enumerate(moods):
            slug = m["slug"]
            ps = self._MOOD_PROMPTS.get(slug) or [f"{m['name_en'].lower()} mood music"]
            for p in ps:
                prompts.append(p)
                group_idx.append(i)

        text_inputs = self.processor(text=prompts, return_tensors="pt", padding=True)
        text_inputs = {k: v.to("cuda") for k, v in text_inputs.items()}
        with torch.no_grad():
            text_features = self.model.get_text_features(**text_inputs)
        # per-prompt 정규화
        text_features = text_features / (text_features.norm(dim=-1, keepdim=True) + 1e-9)

        # mood 별 평균
        import numpy as np
        gi = torch.tensor(group_idx, device="cuda")
        n_moods = len(moods)
        mood_features = torch.zeros(n_moods, text_features.shape[1], device="cuda")
        mood_features.index_add_(0, gi, text_features)
        counts = torch.bincount(gi, minlength=n_moods).float().clamp(min=1.0).unsqueeze(1)
        mood_features = mood_features / counts
        # 평균 후 재정규화
        mood_features = mood_features / (mood_features.norm(dim=-1, keepdim=True) + 1e-9)

        self._mood_slugs = [m["slug"] for m in moods]
        self._mood_labels_ko = [m["name_ko"] for m in moods]
        self._mood_text_features = mood_features  # [N_mood, 512] cuda (mood 별 평균 + 정규화)
        self._mood_cache_loaded = True
        print(f"[ClapEmbedder] cached mood text features for {len(moods)} active moods "
              f"({len(prompts)} total prompts, {len(prompts) / max(len(moods), 1):.1f} avg per mood)")

    def _classify_mood(self, audio_embedding: list[float]) -> dict:
        """audio_embedding → mood top1~3 + softmax 분포.
        Returns:
          {
            "predicted_moods": ["calm","warm","emotional"],
            "mood_confidence": 0.41,
            "prediction_scores": {"mood": {slug: score, ...}}
          }
        """
        import torch
        import numpy as np

        self._ensure_mood_features()

        audio_emb = torch.tensor(audio_embedding, dtype=torch.float32, device="cuda").unsqueeze(0)
        with torch.no_grad():
            sims = (audio_emb @ self._mood_text_features.T).squeeze(0)
            scores = torch.softmax(sims * 100.0, dim=-1)
        scores_np = scores.cpu().numpy()

        order = np.argsort(-scores_np)
        top3 = [self._mood_slugs[int(i)] for i in order[:3]]
        top1_conf = float(scores_np[int(order[0])])

        mood_scores = {self._mood_slugs[i]: round(float(scores_np[i]), 4) for i in range(len(self._mood_slugs))}
        return {
            "predicted_moods": top3,
            "mood_confidence": round(top1_conf, 4),
            "prediction_scores": {"mood": mood_scores},
        }

    def _store_mood_prediction(self, track_id: str, result: dict):
        """store_track_mood_prediction RPC 호출 (predicted_main_genre 보존)."""
        import httpx
        url = _supabase_url()
        key = _supabase_key()
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                f"{url}/rest/v1/rpc/store_track_mood_prediction",
                headers={"apikey": key, "Authorization": f"Bearer {key}",
                         "content-type": "application/json"},
                json={
                    "p_track_id": track_id,
                    "p_predicted_moods": result["predicted_moods"],
                    "p_mood_confidence": result["mood_confidence"],
                    "p_prediction_scores": result["prediction_scores"],
                    "p_model_version": "taxonomy-v1",
                },
            )
            if resp.status_code >= 400:
                raise RuntimeError(f"store_track_mood_prediction HTTP {resp.status_code}: {resp.text[:500]}")

    def _list_pending_mood(self, limit: int) -> list:
        import httpx
        url = _supabase_url()
        key = _supabase_key()
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                f"{url}/rest/v1/rpc/list_tracks_needing_mood_classification",
                headers={"apikey": key, "Authorization": f"Bearer {key}",
                         "content-type": "application/json"},
                json={"p_limit": limit},
            )
            resp.raise_for_status()
            return resp.json()

    # ========== Phase X1.3 — taxonomy zero-shot Store Type 분류 ==========

    # Phase X1.3.1 — boutique 100% 쏠림 진단 결과:
    #   avg score: boutique=0.947, cafe=0.019, hospital=0.028, kids_zone=0.004, 나머지 ~0.
    # 원인: boutique prompts ("fashion boutique / select shop / stylish retail") 가 너무 광범위
    # → 모든 pop/modern/bright 음악 흡수. 다른 10 prompts 는 너무 좁은 도메인.
    # 수정: 사용자 spec — 각 store_type 을 "업장 + 음악 스타일 + 사용 맥락" 명시. 4 prompts/slug.
    _STORE_TYPE_PROMPTS: dict[str, list[str]] = {
        "cafe": [
            "coffee shop background music",
            "acoustic cafe playlist",
            "cozy brunch cafe music",
            "relaxed coffeehouse ambience",
        ],
        "hospital": [
            "calm clinic waiting room music",
            "peaceful hospital background music",
            "gentle healing instrumental music",
            "quiet medical lobby music",
        ],
        "hotel": [
            "elegant hotel lobby music",
            "luxury hotel lounge jazz",
            "refined five star hotel ambience",
            "premium lobby background music",
        ],
        "restaurant": [
            "dinner restaurant background music",
            "elegant dining music",
            "soft meal time ambience",
            "romantic restaurant jazz",
        ],
        "fitness": [
            "gym workout music",
            "high energy training music",
            "fitness center background music",
            "powerful exercise playlist",
        ],
        "boutique": [
            "high fashion designer boutique music",
            "luxury apparel store music",
            "designer brand boutique playlist",
            "premium fashion boutique atmosphere",
        ],
        "office": [
            "office background music",
            "productive work music",
            "calm office lounge music",
            "corporate workspace ambience",
        ],
        "study_cafe": [
            "study cafe focus music",
            "concentration background music",
            "quiet reading room music",
            "minimal focus instrumental",
        ],
        "bakery": [
            "bakery cafe music",
            "warm pastry shop background music",
            "cozy morning bakery ambience",
            "light brunch bakery music",
        ],
        "beauty_shop": [
            "beauty salon background music",
            "hair salon trendy music",
            "relaxing beauty shop ambience",
            "stylish cosmetic shop music",
        ],
        "kids_zone": [
            "playful kids cafe music",
            "cheerful family friendly music",
            "children play area background music",
            "fun bright kids music",
        ],
    }

    def _fetch_active_store_types(self) -> list[dict]:
        """list_taxonomy_store_types RPC → 활성 store_type 목록."""
        import httpx
        url = _supabase_url()
        key = _supabase_key()
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                f"{url}/rest/v1/rpc/list_taxonomy_store_types",
                headers={"apikey": key, "Authorization": f"Bearer {key}",
                         "content-type": "application/json"},
                json={},
            )
            resp.raise_for_status()
            rows = resp.json()
        return [{"slug": r["slug"], "name_en": r["name_en"], "name_ko": r["name_ko"]} for r in rows]

    def _ensure_storetype_features(self):
        """활성 store_type 목록 → CLAP text features 캐싱.
        X1.2 mood 와 동일 패턴 (가변 prompt 평균 + 정규화).
        """
        import torch

        if getattr(self, "_storetype_cache_loaded", False):
            return

        store_types = self._fetch_active_store_types()
        if not store_types:
            raise RuntimeError("no active taxonomy_store_types rows — Phase X1.0 마이그레이션 미적용?")

        prompts: list[str] = []
        group_idx: list[int] = []
        for i, s in enumerate(store_types):
            ps = self._STORE_TYPE_PROMPTS.get(s["slug"]) or [f"{s['name_en'].lower()} background music"]
            for p in ps:
                prompts.append(p)
                group_idx.append(i)

        text_inputs = self.processor(text=prompts, return_tensors="pt", padding=True)
        text_inputs = {k: v.to("cuda") for k, v in text_inputs.items()}
        with torch.no_grad():
            text_features = self.model.get_text_features(**text_inputs)
        text_features = text_features / (text_features.norm(dim=-1, keepdim=True) + 1e-9)

        gi = torch.tensor(group_idx, device="cuda")
        n = len(store_types)
        st_features = torch.zeros(n, text_features.shape[1], device="cuda")
        st_features.index_add_(0, gi, text_features)
        counts = torch.bincount(gi, minlength=n).float().clamp(min=1.0).unsqueeze(1)
        st_features = st_features / counts
        st_features = st_features / (st_features.norm(dim=-1, keepdim=True) + 1e-9)

        self._storetype_slugs = [s["slug"] for s in store_types]
        self._storetype_labels_ko = [s["name_ko"] for s in store_types]
        self._storetype_text_features = st_features
        self._storetype_cache_loaded = True
        print(f"[ClapEmbedder] cached store_type text features for {len(store_types)} active types "
              f"({len(prompts)} total prompts)")

    def _classify_storetype(self, audio_embedding: list[float]) -> dict:
        """audio_embedding → store_type top1~3 + softmax 분포."""
        import torch
        import numpy as np

        self._ensure_storetype_features()

        audio_emb = torch.tensor(audio_embedding, dtype=torch.float32, device="cuda").unsqueeze(0)
        with torch.no_grad():
            sims = (audio_emb @ self._storetype_text_features.T).squeeze(0)
            scores = torch.softmax(sims * 100.0, dim=-1)
        scores_np = scores.cpu().numpy()

        order = np.argsort(-scores_np)
        top3 = [self._storetype_slugs[int(i)] for i in order[:3]]
        top1_conf = float(scores_np[int(order[0])])

        st_scores = {self._storetype_slugs[i]: round(float(scores_np[i]), 4)
                     for i in range(len(self._storetype_slugs))}
        return {
            "predicted_store_types": top3,
            "store_type_confidence": round(top1_conf, 4),
            "prediction_scores": {"store_type": st_scores},
        }

    def _store_storetype_prediction(self, track_id: str, result: dict):
        """store_track_storetype_prediction RPC 호출 (genre/mood 보존)."""
        import httpx
        url = _supabase_url()
        key = _supabase_key()
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                f"{url}/rest/v1/rpc/store_track_storetype_prediction",
                headers={"apikey": key, "Authorization": f"Bearer {key}",
                         "content-type": "application/json"},
                json={
                    "p_track_id": track_id,
                    "p_predicted_store_types": result["predicted_store_types"],
                    "p_store_type_confidence": result["store_type_confidence"],
                    "p_prediction_scores": result["prediction_scores"],
                    "p_model_version": "taxonomy-v1",
                },
            )
            if resp.status_code >= 400:
                raise RuntimeError(f"store_track_storetype_prediction HTTP {resp.status_code}: {resp.text[:500]}")

    def _list_pending_storetype(self, limit: int) -> list:
        import httpx
        url = _supabase_url()
        key = _supabase_key()
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                f"{url}/rest/v1/rpc/list_tracks_needing_storetype_classification",
                headers={"apikey": key, "Authorization": f"Bearer {key}",
                         "content-type": "application/json"},
                json={"p_limit": limit},
            )
            resp.raise_for_status()
            return resp.json()

    def _store_predictions(self, track_id: str, predictions: dict):
        """store_track_ai_predictions RPC 호출."""
        import httpx

        url = _supabase_url()
        key = _supabase_key()

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

        # 4) Noise floor — qc-v2 알고리즘 (false positive 100% 발생 → v2 로 교체):
        #    1차: |x| < -55 dBFS 구간을 실제 silence 로 간주하고 그 안의 RMS 측정
        #    2차: silence 구간이 부족하면 (전체 < 1%) 1st percentile RMS 로 fallback
        #    기존 v1 의 10th percentile 은 "조용한 음악" 까지 noise 로 오인해 부적합.
        win = max(int(sr * 0.05), 1)
        if len(mono) > win:
            # samples 단위 실제 silence detection
            silence_sample_thresh = 10 ** (-55 / 20.0)   # ≈ 0.00178
            is_silent_sample = np.abs(mono) < silence_sample_thresh
            silence_frac = float(np.mean(is_silent_sample))

            squared = mono ** 2
            n_blocks = len(mono) // win
            rms = np.sqrt(np.mean(squared[: n_blocks * win].reshape(n_blocks, win), axis=1))

            if silence_frac >= 0.01:
                # silence sample 들의 RMS = 진짜 noise floor
                silent_samples = mono[is_silent_sample]
                noise_rms = float(np.sqrt(np.mean(silent_samples ** 2)))
                if noise_rms < 1e-12:
                    noise_rms = 1e-12
            else:
                # silence 구간 거의 없음 → 1st percentile (음악 사이 짧은 정적)
                noise_rms = float(np.percentile(rms, 1))
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

        # Noise floor (qc-v2 임계점): 마스터링된 상업 음원 기준 -50~-80 dB 정상
        # > -40 dBFS = 청취 가능한 hiss/noise → HIGH
        # > -50 dBFS = 다소 높음 → 경고
        if noise_floor_db > -40:
            score -= 15
            issues.append({"code": "NOISE_HIGH", "message": f"노이즈 플로어 {noise_floor_db:.1f} dBFS — 매우 높음"})
        elif noise_floor_db > -50:
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
        key = _supabase_key()

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
                    "p_model_version": "qc-v2",
                },
            )
            if resp.status_code >= 400:
                raise RuntimeError(f"store_track_qc_report HTTP {resp.status_code}: {resp.text[:500]}")

    def _list_pending_qc(self, limit: int) -> list:
        """list_tracks_needing_qc RPC."""
        import httpx
        url = _supabase_url()
        key = _supabase_key()
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
        key = _supabase_key()

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
        key = _supabase_key()

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
        key = _supabase_key()

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
    def genre_single(self, track_id: str, audio_url: str, dry_run: bool = False) -> dict:
        """단일 트랙 zero-shot 장르 분류. embedding 추출 (저장은 안함) → genre classification → DB.
        dry_run=True 면 DB 저장 skip + 결과만 반환.
        """
        try:
            audio, sr = self._download_audio(audio_url)
            embedding = self._extract_embedding(audio, sr)
            result = self._classify_genre(embedding)
            if not dry_run:
                self._store_genre_prediction(track_id, result)
            return {
                "ok": True, "track_id": track_id, "dryRun": dry_run,
                "predicted_main_genre": result["predicted_main_genre"],
                "predicted_sub_genres": result["predicted_sub_genres"],
                "genre_confidence": result["genre_confidence"],
                "top4_scores": {k: result["prediction_scores"]["genre"][k]
                                for k in [result["predicted_main_genre"]] + result["predicted_sub_genres"]},
            }
        except Exception as e:
            return {"ok": False, "track_id": track_id, "error": str(e)[:300]}

    @modal.method()
    def genre_backfill(self, limit: int = 50, dry_run: bool = False,
                       track_id: str | None = None, audio_url: str | None = None) -> dict:
        """taxonomy-v1 장르 예측 없는 트랙 일괄 분류.
        dryRun=True → 결과 계산하지만 DB 저장 skip + samples 응답.
        track_id 지정 시 단일 트랙만 처리 (old /genre-single 대체):
          - audio_url 도 전달되면 그대로 사용, 없으면 DB 의 tracks.audio_url 조회.
        """
        if track_id:
            # 단일 모드 — audio_url 자동 조회 fallback
            if not audio_url:
                import httpx
                url = _supabase_url(); key = _supabase_key()
                with httpx.Client(timeout=30.0) as client:
                    resp = client.get(
                        f"{url}/rest/v1/tracks?id=eq.{track_id}&select=audio_url",
                        headers={"apikey": key, "Authorization": f"Bearer {key}"},
                    )
                    resp.raise_for_status()
                    rows = resp.json()
                    audio_url = rows[0]["audio_url"] if rows else None
                if not audio_url:
                    return {"ok": False, "error": "track_id not found or audio_url missing"}
            tracks = [{"track_id": track_id, "audio_url": audio_url, "title": None, "main_genre": None}]
        else:
            tracks = self._list_pending_genre(limit)
            if not tracks:
                return {"ok": True, "total_candidates": 0, "classified": 0, "samples": []}
        if not tracks:
            return {"ok": True, "total_candidates": 0, "classified": 0, "samples": []}
        print(f"[Genre] {'(dry) ' if dry_run else ''}backfill {len(tracks)} tracks")
        done = 0
        failed: list = []
        samples: list = []  # dryRun 시 결과 비교용
        for t in tracks:
            track_id = t["track_id"]
            audio_url = t.get("audio_url")
            current_genre = t.get("main_genre")
            if not audio_url:
                failed.append({"track_id": track_id, "error": "no_audio_url"})
                continue
            try:
                audio, sr = self._download_audio(audio_url)
                embedding = self._extract_embedding(audio, sr)
                result = self._classify_genre(embedding)
                if not dry_run:
                    self._store_genre_prediction(track_id, result)
                done += 1
                samples.append({
                    "track_id": track_id,
                    "title": t.get("title"),
                    "current_genre": current_genre,
                    "predicted_main_genre": result["predicted_main_genre"],
                    "predicted_sub_genres": result["predicted_sub_genres"],
                    "genre_confidence": result["genre_confidence"],
                    "top4_scores": {k: result["prediction_scores"]["genre"][k]
                                    for k in [result["predicted_main_genre"]] + result["predicted_sub_genres"]},
                })
                if done % 10 == 0:
                    print(f"[Genre] {done}/{len(tracks)} done")
            except Exception as e:
                failed.append({"track_id": track_id, "error": str(e)[:200]})
        return {
            "ok": True, "dryRun": dry_run,
            "total_candidates": len(tracks),
            "classified": done,
            "failed_count": len(failed),
            "failed_samples": failed[:10],
            "samples": samples,
        }

    @modal.method()
    def mood_single(self, track_id: str, audio_url: str, dry_run: bool = False) -> dict:
        """단일 트랙 zero-shot mood 분류. genre 와 동일 패턴 — predicted_main_genre 보존."""
        try:
            audio, sr = self._download_audio(audio_url)
            embedding = self._extract_embedding(audio, sr)
            result = self._classify_mood(embedding)
            if not dry_run:
                self._store_mood_prediction(track_id, result)
            return {
                "ok": True, "track_id": track_id, "dryRun": dry_run,
                "predicted_moods": result["predicted_moods"],
                "mood_confidence": result["mood_confidence"],
                "top3_scores": {k: result["prediction_scores"]["mood"][k]
                                for k in result["predicted_moods"]},
            }
        except Exception as e:
            return {"ok": False, "track_id": track_id, "error": str(e)[:300]}

    @modal.method()
    def mood_backfill(self, limit: int = 50, dry_run: bool = False,
                      track_id: str | None = None, audio_url: str | None = None) -> dict:
        """taxonomy-v1 의 predicted_moods 가 비어있는 트랙 일괄 분류.
        dry_run=True → 결과 계산 + DB 저장 skip + samples 응답.
        track_id 지정 시 단일 트랙만 처리 (old /mood-single 대체):
          - audio_url 도 전달되면 그대로 사용, 없으면 DB 의 tracks.audio_url 조회.
        """
        if track_id:
            if not audio_url:
                import httpx
                url = _supabase_url(); key = _supabase_key()
                with httpx.Client(timeout=30.0) as client:
                    resp = client.get(
                        f"{url}/rest/v1/tracks?id=eq.{track_id}&select=audio_url",
                        headers={"apikey": key, "Authorization": f"Bearer {key}"},
                    )
                    resp.raise_for_status()
                    rows = resp.json()
                    audio_url = rows[0]["audio_url"] if rows else None
                if not audio_url:
                    return {"ok": False, "error": "track_id not found or audio_url missing"}
            tracks = [{"track_id": track_id, "audio_url": audio_url, "title": None, "mood": None}]
        else:
            tracks = self._list_pending_mood(limit)
            if not tracks:
                return {"ok": True, "total_candidates": 0, "classified": 0, "samples": []}
        print(f"[Mood] {'(dry) ' if dry_run else ''}backfill {len(tracks)} tracks")
        done = 0
        failed: list = []
        samples: list = []
        for t in tracks:
            track_id = t["track_id"]
            audio_url = t.get("audio_url")
            current_mood = t.get("mood")
            if not audio_url:
                failed.append({"track_id": track_id, "error": "no_audio_url"})
                continue
            try:
                audio, sr = self._download_audio(audio_url)
                embedding = self._extract_embedding(audio, sr)
                result = self._classify_mood(embedding)
                if not dry_run:
                    self._store_mood_prediction(track_id, result)
                done += 1
                samples.append({
                    "track_id": track_id,
                    "title": t.get("title"),
                    "current_mood": current_mood,
                    "predicted_moods": result["predicted_moods"],
                    "mood_confidence": result["mood_confidence"],
                    "top3_scores": {k: result["prediction_scores"]["mood"][k]
                                    for k in result["predicted_moods"]},
                })
                if done % 10 == 0:
                    print(f"[Mood] {done}/{len(tracks)} done")
            except Exception as e:
                failed.append({"track_id": track_id, "error": str(e)[:200]})
        return {
            "ok": True, "dryRun": dry_run,
            "total_candidates": len(tracks),
            "classified": done,
            "failed_count": len(failed),
            "failed_samples": failed[:10],
            "samples": samples,
        }

    @modal.method()
    def storetype_backfill(self, limit: int = 50, dry_run: bool = False,
                           track_id: str | None = None, audio_url: str | None = None) -> dict:
        """taxonomy-v1 의 predicted_store_types 가 비어있는 트랙 일괄 분류.
        X1.2 mood 와 동일 패턴 — predicted_main_genre / predicted_moods 보존.
        track_id 지정 시 단일 트랙 처리 (audio_url 미지정이면 DB 조회).
        """
        if track_id:
            if not audio_url:
                import httpx
                url = _supabase_url(); key = _supabase_key()
                with httpx.Client(timeout=30.0) as client:
                    resp = client.get(
                        f"{url}/rest/v1/tracks?id=eq.{track_id}&select=audio_url",
                        headers={"apikey": key, "Authorization": f"Bearer {key}"},
                    )
                    resp.raise_for_status()
                    rows = resp.json()
                    audio_url = rows[0]["audio_url"] if rows else None
                if not audio_url:
                    return {"ok": False, "error": "track_id not found or audio_url missing"}
            tracks = [{"track_id": track_id, "audio_url": audio_url, "title": None, "suitable_store": None}]
        else:
            tracks = self._list_pending_storetype(limit)
            if not tracks:
                return {"ok": True, "total_candidates": 0, "classified": 0, "samples": []}

        print(f"[StoreType] {'(dry) ' if dry_run else ''}backfill {len(tracks)} tracks")
        done = 0
        failed: list = []
        samples: list = []
        for t in tracks:
            tid = t["track_id"]
            aurl = t.get("audio_url")
            current_store = t.get("suitable_store")
            if not aurl:
                failed.append({"track_id": tid, "error": "no_audio_url"})
                continue
            try:
                audio, sr = self._download_audio(aurl)
                embedding = self._extract_embedding(audio, sr)
                result = self._classify_storetype(embedding)
                if not dry_run:
                    self._store_storetype_prediction(tid, result)
                done += 1
                samples.append({
                    "track_id": tid,
                    "title": t.get("title"),
                    "current_store": current_store,
                    "predicted_store_types": result["predicted_store_types"],
                    "store_type_confidence": result["store_type_confidence"],
                    "top3_scores": {k: result["prediction_scores"]["store_type"][k]
                                    for k in result["predicted_store_types"]},
                })
                if done % 10 == 0:
                    print(f"[StoreType] {done}/{len(tracks)} done")
            except Exception as e:
                failed.append({"track_id": tid, "error": str(e)[:200]})
        return {
            "ok": True, "dryRun": dry_run,
            "total_candidates": len(tracks),
            "classified": done,
            "failed_count": len(failed),
            "failed_samples": failed[:10],
            "samples": samples,
        }

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
    # strip() — 일부 Modal Secret 입력 시 trailing newline 포함되는 사례 (httpx Illegal header value).
    expected = os.environ.get("QC_WORKER_SECRET", "").strip()
    if not expected:
        print("[QC_AUTH] QC_WORKER_SECRET not set — bypassing auth (dev mode)")
        return None
    client_auth = item.get("_auth") or ""
    if isinstance(client_auth, str):
        client_auth = client_auth.strip()
    if client_auth != expected:
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


# NOTE: classify-backfill (energy/BPM 분류) 는 storetype-backfill (X1.3) 추가로 8개 한도 초과 → 제거.
# energy/BPM 은 후속 PR 에서 mood/store_type 분류와 통합 endpoint 로 재도입 검토.
# 메서드 ClapEmbedder.classify_backfill 은 보존 (내부 .remote 호출 가능).

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


# NOTE: genre-single / mood-single 은 Modal Free 플랜의 Web Function 제한(8개) 으로 인해 제거.
# 동일 기능은 backfill endpoint 에 { track_id, audio_url? } 옵션으로 통합.

@app.function(image=image, secrets=secrets, timeout=3600)
@modal.fastapi_endpoint(method="POST", label="genre-backfill")
def genre_backfill_endpoint(item: dict) -> dict:
    """POST { limit?, dryRun?, track_id?, audio_url?, _auth }
    → 장르 미분류 트랙 일괄 분류.
    track_id 지정 시 단일 트랙만 처리 (audio_url 미지정이면 DB 조회).
    dryRun=true 면 결과는 계산하고 DB 저장만 건너뜀 (검증용)."""
    deny = _check_auth(item)
    if deny is not None: return deny
    limit = int(item.get("limit", 50))
    dry_run = bool(item.get("dryRun", False))
    track_id = item.get("track_id")
    audio_url = item.get("audio_url")
    embedder = ClapEmbedder()
    return embedder.genre_backfill.remote(limit, dry_run, track_id, audio_url)


@app.function(image=image, secrets=secrets, timeout=3600)
@modal.fastapi_endpoint(method="POST", label="mood-backfill")
def mood_backfill_endpoint(item: dict) -> dict:
    """POST { limit?, dryRun?, track_id?, audio_url?, debug_secret?, _auth }
    → mood 미분류 트랙 일괄 분류.
    track_id 지정 시 단일 트랙만 처리 (audio_url 미지정이면 DB 조회).
    dryRun=true 면 결과는 계산하고 DB 저장만 건너뜀.
    debug_secret=true 면 Modal Secret attachment 진단 결과만 반환 (audio 처리 X).
    """
    deny = _check_auth(item)
    if deny is not None: return deny

    # Secret attachment 진단 — auth 통과했는데 SUPABASE_URL 못 읽는 케이스 대응.
    # 값은 노출하지 않고 (보안) key 이름 + 길이 + 존재 여부만 반환.
    if item.get("debug_secret"):
        url_v = os.environ.get("SUPABASE_URL", "")
        key_v = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
        qc_v  = os.environ.get("QC_WORKER_SECRET", "")
        env_keys = sorted([k for k in os.environ.keys()
                           if any(t in k.upper() for t in ('SUPABASE', 'QC_WORKER', 'KEY', 'TOKEN'))])
        return {
            "ok": False,
            "diagnostic": "secret_attachment",
            "endpoint_function": "mood_backfill_endpoint",
            "secrets_decl": ["deudda-supabase"],
            "supabase_url_set": bool(url_v),
            "supabase_url_len": len(url_v),
            "supabase_url_prefix": url_v[:15] + "..." if len(url_v) > 18 else url_v,
            "supabase_key_set": bool(key_v),
            "supabase_key_len": len(key_v),
            "supabase_key_starts_with_eyJ": key_v.startswith("eyJ"),
            "qc_secret_set": bool(qc_v),
            "qc_secret_len": len(qc_v),
            "secret_like_env_keys": env_keys,
            "env_keys_total": len(os.environ),
        }

    limit = int(item.get("limit", 50))
    dry_run = bool(item.get("dryRun", False))
    track_id = item.get("track_id")
    audio_url = item.get("audio_url")
    embedder = ClapEmbedder()
    return embedder.mood_backfill.remote(limit, dry_run, track_id, audio_url)


@app.function(image=image, secrets=secrets, timeout=3600)
@modal.fastapi_endpoint(method="POST", label="storetype-backfill")
def storetype_backfill_endpoint(item: dict) -> dict:
    """POST { limit?, dryRun?, track_id?, audio_url?, _auth }
    → store_type 미분류 트랙 일괄 분류.
    track_id 지정 시 단일 트랙만 처리 (audio_url 미지정이면 DB 조회).
    dryRun=true 면 결과는 계산하고 DB 저장만 건너뜀."""
    deny = _check_auth(item)
    if deny is not None: return deny
    limit = int(item.get("limit", 50))
    dry_run = bool(item.get("dryRun", False))
    track_id = item.get("track_id")
    audio_url = item.get("audio_url")
    embedder = ClapEmbedder()
    return embedder.storetype_backfill.remote(limit, dry_run, track_id, audio_url)


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
