#!/usr/bin/env python3
"""
DEUDDA — Modal CLAP Embedding Worker (Phase X7)

목표:
  - 모델: laion/larger_clap_music_and_speech (512d, DB 표준 'laion-clap-music-v1')
  - 인프라: Modal T4 GPU
  - 처리: 50 batch / call, async download + GPU batch inference
  - DB: Supabase service_role 로 tracks 직접 조회 + admin_import_track_embeddings 호출

사용:
  # 1) 첫 배포
  modal deploy modal_clap_embedder.py

  # 2) 741곡 전체 backfill (수동 호출)
  modal run modal_clap_embedder.py::backfill_all

  # 3) 임베딩 1개 추출 (디버깅용)
  modal run modal_clap_embedder.py::embed_single --track-id <uuid>

  # 4) Modal scheduler 활성 시 cron (매 15분 자동)
  # → @app.function(schedule=modal.Period(minutes=15)) 의 incremental_run

환경변수 (Modal Secret):
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

모델 캐시:
  HuggingFace 모델은 Modal Volume 에 캐시 (cold start 30초 → 5초)
"""
import io
import os
import time
from typing import Optional

import modal

# ===== Modal app 설정 =====
APP_NAME = "deudda-clap-embedder"
MODEL_REPO = "laion/larger_clap_music_and_speech"
MODEL_VERSION_TAG = "laion-clap-music-v1"  # DB 표준 (track_embeddings.model_version)
EMBEDDING_DIM = 512
BATCH_SIZE = 50  # backfill 시 한 번에 처리할 곡 수
DOWNLOAD_CONCURRENCY = 10
DOWNLOAD_TIMEOUT_S = 60
GPU_TYPE = "T4"  # 비용 효율: T4 (~$0.59/hr)

# Volume 으로 HuggingFace 모델 캐시 영구화 (cold start 단축)
hf_cache = modal.Volume.from_name("deudda-hf-cache", create_if_missing=True)

# Docker 이미지: CUDA + PyTorch + transformers + librosa + supabase
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libsndfile1")
    .pip_install(
        "torch==2.1.0",
        "transformers==4.36.0",
        "librosa==0.10.1",
        "soundfile==0.12.1",
        "supabase==2.3.0",
        "httpx==0.25.0",
        "numpy<2",
        "huggingface_hub==0.19.4",
    )
    .env({"HF_HOME": "/cache/hf", "TRANSFORMERS_CACHE": "/cache/hf"})
)

app = modal.App(APP_NAME, image=image)


# ===== 모델 로딩 (cold start 시 1회) =====
def _load_clap_model():
    """ClapModel + ClapProcessor 로딩. Volume 캐시 활용."""
    import torch
    from transformers import ClapModel, ClapProcessor

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = ClapModel.from_pretrained(MODEL_REPO, cache_dir="/cache/hf").to(device)
    model.eval()
    processor = ClapProcessor.from_pretrained(MODEL_REPO, cache_dir="/cache/hf")
    print(f"[clap] model loaded on {device} | repo={MODEL_REPO}")
    return model, processor, device


# ===== Supabase 클라이언트 =====
def _sb():
    from supabase import create_client
    return create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )


def _list_pending_tracks(sb, limit: int) -> list:
    """DB 표준 'laion-clap-music-v1' 임베딩이 아직 없는 트랙 목록."""
    # 모든 tracks 중 audio_url 있는 것
    tracks = (
        sb.table("tracks")
        .select("id, audio_url, duration, title")
        .is_("removed_at", "null")
        .not_.is_("audio_url", "null")
        .limit(limit * 5)
        .execute()
        .data
    )
    # 이미 done 인 임베딩 제외
    done = {
        r["track_id"]
        for r in sb.table("track_embeddings")
        .select("track_id")
        .eq("model_version", MODEL_VERSION_TAG)
        .eq("status", "done")
        .execute()
        .data
    }
    pending = [t for t in tracks if t["id"] not in done and t.get("audio_url")]
    return pending[:limit]


# ===== Audio 다운로드 + 디코딩 =====
def _download_and_decode(audio_url: str, target_sr: int = 48000):
    """audio_url → 48kHz mono numpy array. CLAP 표준 입력."""
    import httpx
    import librosa
    import numpy as np
    import soundfile as sf

    with httpx.Client(timeout=DOWNLOAD_TIMEOUT_S, follow_redirects=True) as client:
        resp = client.get(audio_url)
        resp.raise_for_status()
        audio_bytes = resp.content

    # librosa 가 다양한 포맷 지원 (mp3/m4a/wav 등)
    audio, sr = sf.read(io.BytesIO(audio_bytes))
    if audio.ndim > 1:
        audio = audio.mean(axis=1)  # mono

    if sr != target_sr:
        audio = librosa.resample(audio, orig_sr=sr, target_sr=target_sr)

    return audio.astype(np.float32)


def _embed_audio_batch(model, processor, device, audios: list) -> list:
    """audios = [numpy array, ...] → [512d numpy array, ...]"""
    import numpy as np
    import torch

    inputs = processor(audios=audios, sampling_rate=48000, return_tensors="pt", padding=True)
    inputs = {k: v.to(device) for k, v in inputs.items()}
    with torch.no_grad():
        audio_features = model.get_audio_features(**inputs)
    # L2 normalize (cosine similarity 표준)
    audio_features = audio_features / audio_features.norm(dim=-1, keepdim=True).clamp(min=1e-12)
    return [v.cpu().numpy() for v in audio_features]


def _upsert_embedding(sb, track_id: str, vec, model_version: str = MODEL_VERSION_TAG):
    sb.table("track_embeddings").upsert(
        {
            "track_id": track_id,
            "model_name": "clap",  # 짧은 식별자
            "model_version": model_version,
            "embedding": vec.tolist(),
            "embedding_dim": int(vec.shape[0]),
            "segment_type": "full",
            "status": "done",
            "error_message": None,
        },
        on_conflict="track_id,model_name",
    ).execute()


def _mark_failed(sb, track_id: str, msg: str):
    sb.table("track_embeddings").upsert(
        {
            "track_id": track_id,
            "model_name": "clap",
            "model_version": MODEL_VERSION_TAG,
            "status": "failed",
            "error_message": msg[:500],
        },
        on_conflict="track_id,model_name",
    ).execute()


# ===== Core: 배치 처리 함수 =====
@app.function(
    gpu=GPU_TYPE,
    volumes={"/cache": hf_cache},
    secrets=[modal.Secret.from_name("supabase-service-role")],
    timeout=60 * 30,  # 30분 (전체 backfill 대비)
)
def process_batch(track_rows: list, dry_run: bool = False) -> dict:
    """N개 트랙 → CLAP 임베딩 → DB 업서트. 곡별 실패 격리."""
    import concurrent.futures as cf
    import traceback

    t0 = time.time()
    sb = _sb() if not dry_run else None
    model, processor, device = _load_clap_model()
    t_load = time.time() - t0

    # 1) 동시 다운로드 (CPU bound)
    audios = {}
    download_errors = {}
    with cf.ThreadPoolExecutor(max_workers=DOWNLOAD_CONCURRENCY) as ex:
        futures = {ex.submit(_download_and_decode, r["audio_url"]): r["id"] for r in track_rows}
        for fut in cf.as_completed(futures):
            tid = futures[fut]
            try:
                audios[tid] = fut.result()
            except Exception as e:
                download_errors[tid] = f"download: {e}"

    t_download = time.time() - t0 - t_load

    # 2) GPU 배치 추론 (microbatch=8 — VRAM 안전)
    results = {}
    inference_errors = {}
    items = list(audios.items())
    MICROBATCH = 8
    for i in range(0, len(items), MICROBATCH):
        chunk = items[i : i + MICROBATCH]
        ids = [tid for tid, _ in chunk]
        arrs = [arr for _, arr in chunk]
        try:
            vecs = _embed_audio_batch(model, processor, device, arrs)
            for tid, v in zip(ids, vecs):
                results[tid] = v
        except Exception as e:
            err = f"inference: {e}\n{traceback.format_exc()[:500]}"
            for tid in ids:
                inference_errors[tid] = err

    t_inference = time.time() - t0 - t_load - t_download

    # 3) DB 업서트 (또는 dry_run)
    n_ok = 0
    n_fail = 0
    if not dry_run:
        for tid, vec in results.items():
            try:
                _upsert_embedding(sb, tid, vec)
                n_ok += 1
            except Exception as e:
                _mark_failed(sb, tid, f"upsert: {e}")
                n_fail += 1
        for tid, err in download_errors.items():
            _mark_failed(sb, tid, err)
            n_fail += 1
        for tid, err in inference_errors.items():
            _mark_failed(sb, tid, err)
            n_fail += 1
    else:
        n_ok = len(results)
        n_fail = len(download_errors) + len(inference_errors)

    elapsed = time.time() - t0
    summary = {
        "ok": n_ok,
        "fail": n_fail,
        "elapsed_s": round(elapsed, 2),
        "load_s": round(t_load, 2),
        "download_s": round(t_download, 2),
        "inference_s": round(t_inference, 2),
        "model_version": MODEL_VERSION_TAG,
        "dry_run": dry_run,
    }
    print(f"[clap] batch summary: {summary}")
    return summary


# ===== Entry: 741곡 전체 backfill =====
@app.function(
    volumes={"/cache": hf_cache},
    secrets=[modal.Secret.from_name("supabase-service-role")],
    timeout=60 * 60 * 2,  # 2시간 (안전)
)
def backfill_all(batch_size: int = BATCH_SIZE) -> dict:
    """Modal 엔트리: 모든 pending 트랙을 batch 단위로 처리."""
    sb = _sb()
    total_ok = 0
    total_fail = 0
    rounds = 0
    started = time.time()

    while True:
        pending = _list_pending_tracks(sb, batch_size)
        if not pending:
            print(f"[backfill] no more pending. done after {rounds} rounds.")
            break
        print(f"[backfill] round {rounds + 1}: processing {len(pending)} tracks")
        result = process_batch.remote(pending)
        total_ok += result["ok"]
        total_fail += result["fail"]
        rounds += 1
        # 안전장치: 무한 루프 방지
        if rounds >= 30:
            print("[backfill] reached max rounds (30). stopping.")
            break

    elapsed = time.time() - started
    return {
        "total_ok": total_ok,
        "total_fail": total_fail,
        "rounds": rounds,
        "elapsed_s": round(elapsed, 2),
        "model_version": MODEL_VERSION_TAG,
    }


# ===== Entry: 단일 트랙 디버깅 =====
@app.function(
    gpu=GPU_TYPE,
    volumes={"/cache": hf_cache},
    secrets=[modal.Secret.from_name("supabase-service-role")],
    timeout=120,
)
def embed_single(track_id: str) -> dict:
    """단일 track_id 임베딩 추출 (디버깅용)."""
    sb = _sb()
    row = sb.table("tracks").select("id, audio_url, title").eq("id", track_id).single().execute().data
    if not row:
        return {"error": "track_not_found"}
    if not row.get("audio_url"):
        return {"error": "no_audio_url"}
    result = process_batch.remote([row])
    return {"track": row["title"], **result}


# ===== Entry: incremental (Modal scheduler 자동 호출) =====
@app.function(
    volumes={"/cache": hf_cache},
    secrets=[modal.Secret.from_name("supabase-service-role")],
    schedule=modal.Period(minutes=15),
    timeout=60 * 20,
)
def incremental_run() -> dict:
    """매 15분 자동 호출: pending 있으면 1 batch 처리, 없으면 즉시 종료."""
    sb = _sb()
    pending = _list_pending_tracks(sb, BATCH_SIZE)
    if not pending:
        return {"skipped": "no_pending", "model_version": MODEL_VERSION_TAG}
    return process_batch.remote(pending)


# ===== Local entry =====
if __name__ == "__main__":
    print("Use 'modal run modal_clap_embedder.py::backfill_all' to run.")
    print("Or 'modal deploy modal_clap_embedder.py' to enable scheduler.")
