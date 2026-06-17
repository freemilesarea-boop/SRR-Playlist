#!/usr/bin/env python3
"""
DEUDDA CLAP local backfill worker — X6.77 / Phase 6 보강.

Modal 배포 없이 노트북/VPS 에서 한 줄로 실행하는 백필 도구.
- track_embedding_jobs 큐 (Phase 6 / X6.73) 에서 pending pull
- 30초 segment CLAP 임베딩 계산 (laion/larger_clap_music_and_speech)
- store_track_embedding RPC 로 저장 + admin_mark_embedding_job_done 으로 큐 닫음

사용:
    cd scripts/clap_embedder
    pip install -r requirements.txt
    export SUPABASE_URL='https://nsoesrvwkxqifjcxzvol.supabase.co'
    export SUPABASE_SERVICE_ROLE_KEY='<service_role>'
    python local_worker.py --batch 50
    # 또는 --loop 로 큐가 빌 때까지 반복:
    python local_worker.py --loop

옵션:
    --batch N      한 번에 처리할 최대 트랙 (기본 20)
    --loop         큐가 빌 때까지 반복
    --backfill-all 큐에 미적재된 pending(847건) 도 한 번에 enqueue 후 처리
    --device cpu   GPU 없으면 cpu (느림). 기본 auto (cuda 있으면 cuda)
    --dry-run      실제 저장 안 함, 1트랙만 처리해 동작 검증

성능:
    - GPU (NVIDIA 8GB+): 1트랙당 1~3초 → 847건 ~15~45분
    - CPU (M1/M2): 1트랙당 5~10초 → 847건 ~1~2시간
    - CPU (일반): 1트랙당 15~30초 → 847건 ~4~7시간 (밤새 돌리기 OK)

장애시:
    - 모델 다운로드 한번만 ~2GB → ~/.cache/huggingface (한번 받으면 재사용)
    - 인터넷 끊김: 다시 실행하면 처리된 트랙은 자동 skip (큐 idempotent)
    - audio_url 4xx/5xx: 해당 트랙만 error 마킹, 나머지 계속
"""
from __future__ import annotations

import argparse
import io
import os
import sys
import time
import traceback
from typing import Any

import httpx
import librosa
import numpy as np
import torch
from transformers import ClapModel, ClapProcessor


MODEL_ID = "laion/larger_clap_music_and_speech"
TARGET_SR = 48000
SEGMENT_SEC = 30.0
EMBEDDING_DIM = 512
MODEL_VERSION = "laion-clap-music-v1"


# ---------- Supabase REST helpers ----------

def _env(name: str) -> str:
    v = os.environ.get(name, "").strip()
    if not v:
        sys.exit(f"환경변수 {name} 설정 필요. README 참고.")
    return v


def _client() -> httpx.Client:
    url = _env("SUPABASE_URL").rstrip("/")
    key = _env("SUPABASE_SERVICE_ROLE_KEY")
    return httpx.Client(
        base_url=f"{url}/rest/v1",
        headers={
            "apikey": key,
            "authorization": f"Bearer {key}",
            "content-type": "application/json",
        },
        timeout=httpx.Timeout(60.0, connect=10.0),
    )


def rpc(client: httpx.Client, fn: str, body: dict[str, Any] | None = None) -> Any:
    r = client.post(f"/rpc/{fn}", json=body or {})
    if r.status_code >= 300:
        raise RuntimeError(f"RPC {fn} failed {r.status_code}: {r.text[:300]}")
    return r.json() if r.content else None


def fetch_pending_jobs(client: httpx.Client, limit: int) -> list[dict[str, Any]]:
    rows = rpc(client, "admin_list_embedding_jobs",
               {"p_status": "pending", "p_limit": limit}) or []
    return [r for r in rows if r.get("status") == "pending"]


# ---------- Audio download + decode ----------

def fetch_audio_segment(url: str, target_sr: int, segment_sec: float) -> np.ndarray:
    """audio_url 전체 다운로드 → 30초 segment (중앙) 추출 → mono float32 numpy."""
    r = httpx.get(url, timeout=httpx.Timeout(60.0, connect=10.0), follow_redirects=True)
    r.raise_for_status()
    audio, sr = librosa.load(io.BytesIO(r.content), sr=None, mono=True)
    if sr != target_sr:
        audio = librosa.resample(audio, orig_sr=sr, target_sr=target_sr)
        sr = target_sr
    total_sec = len(audio) / sr
    if total_sec < segment_sec:
        # 너무 짧으면 padding (silent tail)
        pad = int((segment_sec - total_sec) * sr)
        audio = np.pad(audio, (0, pad), mode="constant")
    else:
        # 중앙 segment
        mid = total_sec / 2
        start = int((mid - segment_sec / 2) * sr)
        end = start + int(segment_sec * sr)
        audio = audio[start:end]
    return audio.astype(np.float32)


# ---------- CLAP embedder ----------

class LocalEmbedder:
    def __init__(self, device: str):
        print(f"[clap] loading {MODEL_ID} on {device} … (첫 실행 시 ~2GB 다운로드)")
        self.device = device
        self.processor = ClapProcessor.from_pretrained(MODEL_ID)
        self.model = ClapModel.from_pretrained(MODEL_ID).to(device).eval()
        print(f"[clap] ready.")

    def embed(self, audio: np.ndarray, sr: int) -> list[float]:
        # X6.81 — transformers 4.57+ 에서 'audios' 키워드 deprecated → 'audio' 단수형 사용
        # 4.x 라인은 둘 다 받지만 deprecation 메시지가 ValueError 로 raise 됨.
        inputs = self.processor(audio=audio, sampling_rate=sr, return_tensors="pt")
        inputs = {k: v.to(self.device) for k, v in inputs.items()}
        with torch.no_grad():
            feat = self.model.get_audio_features(**inputs)
        feat = feat / (feat.norm(dim=-1, keepdim=True) + 1e-9)
        vec = feat.squeeze(0).cpu().numpy().astype(np.float32).tolist()
        if len(vec) != EMBEDDING_DIM:
            raise RuntimeError(f"임베딩 차원 이상: {len(vec)} (expected {EMBEDDING_DIM})")
        return vec


# ---------- Process one job ----------

def process_job(client: httpx.Client, embedder: LocalEmbedder,
                job: dict[str, Any], dry_run: bool) -> tuple[bool, str | None]:
    track_id = job["track_id"]
    # job dict 에는 audio_url 이 없음 (admin_list_embedding_jobs returns: id, track_id, track_title, status, ...)
    # tracks 테이블에서 audio_url 가져오기
    r = client.get("/tracks", params={"id": f"eq.{track_id}",
                                       "select": "audio_url,title", "limit": "1"})
    r.raise_for_status()
    rows = r.json()
    if not rows or not rows[0].get("audio_url"):
        return False, "no audio_url"
    audio_url = rows[0]["audio_url"]

    audio = fetch_audio_segment(audio_url, TARGET_SR, SEGMENT_SEC)
    embedding = embedder.embed(audio, TARGET_SR)

    if dry_run:
        return True, f"DRY-RUN ok (dim={len(embedding)}, first3={embedding[:3]})"

    rpc(client, "store_track_embedding", {
        "p_track_id": track_id,
        "p_embedding": embedding,
        "p_model_version": MODEL_VERSION,
    })
    rpc(client, "admin_mark_embedding_job_done", {
        "p_job_id": job["id"],
        "p_success": True,
        "p_error": None,
        "p_response": {"worker": "local_worker.py", "dim": EMBEDDING_DIM},
    })
    return True, None


# ---------- Main ----------

def main():
    ap = argparse.ArgumentParser(description="DEUDDA CLAP local backfill worker")
    ap.add_argument("--batch", type=int, default=20, help="한 번에 처리할 최대 트랙")
    ap.add_argument("--loop", action="store_true", help="큐 빌 때까지 반복")
    ap.add_argument("--backfill-all", action="store_true",
                    help="실행 전 admin_embedding_backfill_enqueue(1000) 호출")
    ap.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu", "mps"])
    ap.add_argument("--dry-run", action="store_true", help="저장 없이 1트랙만 테스트")
    args = ap.parse_args()

    device = args.device
    if device == "auto":
        if torch.cuda.is_available():
            device = "cuda"
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            device = "mps"
        else:
            device = "cpu"
    print(f"[worker] device={device}")

    embedder = LocalEmbedder(device)
    client = _client()

    if args.backfill_all and not args.dry_run:
        r = rpc(client, "admin_embedding_backfill_enqueue", {"p_limit": 1000})
        print(f"[worker] enqueue: {r}")

    total_ok = 0
    total_err = 0
    tick = 0

    while True:
        tick += 1
        jobs = fetch_pending_jobs(client, args.batch)
        if not jobs:
            print("[worker] 큐 비어있음 — 종료.")
            break

        for i, job in enumerate(jobs, 1):
            t0 = time.time()
            try:
                ok, note = process_job(client, embedder, job, args.dry_run)
                dt = time.time() - t0
                if ok:
                    total_ok += 1
                    print(f"  [{tick}.{i}/{len(jobs)}] ✓ {job.get('track_title','?')[:40]} "
                          f"({dt:.1f}s){' — '+note if note else ''}")
                else:
                    total_err += 1
                    print(f"  [{tick}.{i}/{len(jobs)}] ✗ {job.get('track_title','?')[:40]} — {note}")
                    if not args.dry_run:
                        rpc(client, "admin_mark_embedding_job_done", {
                            "p_job_id": job["id"], "p_success": False,
                            "p_error": str(note)[:500], "p_response": None,
                        })
            except KeyboardInterrupt:
                print("\n[worker] 사용자 중단. 현재 작업까지 처리됨.")
                sys.exit(0)
            except Exception as e:
                total_err += 1
                err_msg = f"{type(e).__name__}: {str(e)[:200]}"
                print(f"  [{tick}.{i}/{len(jobs)}] ✗ {job.get('track_title','?')[:40]} — {err_msg}")
                if not args.dry_run:
                    try:
                        rpc(client, "admin_mark_embedding_job_done", {
                            "p_job_id": job["id"], "p_success": False,
                            "p_error": err_msg, "p_response": None,
                        })
                    except Exception:
                        pass  # 큐 마킹 실패해도 reaper 가 30분 후 처리

            if args.dry_run:
                print("[worker] dry-run 완료 — 1트랙 테스트 종료.")
                sys.exit(0)

        if not args.loop:
            break

    print(f"\n[worker] 완료 — 성공 {total_ok} / 실패 {total_err}")


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as e:
        print(f"FATAL: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception:
        traceback.print_exc()
        sys.exit(2)
