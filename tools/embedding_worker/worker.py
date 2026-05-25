#!/usr/bin/env python3
"""
듣다 — Audio Embedding Worker (Mac mini 운영용 PoC 스켈레톤)

역할:
  1) Supabase 에서 embedding 대기(track) 목록 조회
  2) audio_url 다운로드
  3) OpenL3 임베딩 추론 (CPU, GPU 불필요)
  4) track_embeddings 에 upsert (service_role)
  5) 실패 시 status=failed + error_message

설계 원칙:
  - 사용자 재생/플레이어/정산에 영향 없음 (완전 분리된 배치 프로세스)
  - batch size 제한, 곡별 실패 격리, 로그, timeout
  - 모델/버전(model_name, model_version) 기록 → 추후 교체 추적

의존성(설치):
  pip install openl3 soundfile numpy requests supabase
  # openl3 는 tensorflow(CPU) 기반. Mac mini(M-series)에서 CPU 추론 가능.

환경변수:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
  MODEL_NAME=openl3  MODEL_VERSION=v1  BATCH_SIZE=15  EMB_DIM=512

주의: 실제 운영 전 검증 필요(이 스켈레톤은 구조 제시용).
"""
import os
import tempfile
import traceback
import requests
import numpy as np

MODEL_NAME = os.environ.get("MODEL_NAME", "openl3")
MODEL_VERSION = os.environ.get("MODEL_VERSION", "v1")
BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "15"))
DOWNLOAD_TIMEOUT = 60

# --- Supabase (service_role 로 RLS 우회; 절대 클라이언트 노출 금지) ---
from supabase import create_client  # type: ignore

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])


def list_pending(limit: int):
    # admin_list_embedding_pending 은 admin 전용이라, 배치 워커는 테이블 직접 조회(service_role)
    rows = (
        sb.table("tracks")
        .select("id, audio_url, duration")
        .in_("release_status", ["released", "approved", "scheduled"])
        .is_("removed_at", "null")
        .not_.is_("audio_url", "null")
        .limit(limit * 3)
        .execute()
        .data
    )
    done = {
        r["track_id"]
        for r in sb.table("track_embeddings")
        .select("track_id")
        .eq("model_name", MODEL_NAME)
        .eq("status", "done")
        .execute()
        .data
    }
    return [r for r in rows if r["id"] not in done][:limit]


def embed_openl3(path: str) -> np.ndarray:
    import openl3  # type: ignore
    import soundfile as sf  # type: ignore

    audio, sr = sf.read(path)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)  # mono 다운믹스
    emb, _ts = openl3.get_audio_embedding(
        audio, sr, content_type="music", embedding_size=512, hop_size=1.0
    )
    # 곡 전체 평균 풀링 → 단일 512-d 벡터 (L2 정규화)
    v = emb.mean(axis=0)
    n = np.linalg.norm(v)
    return v / n if n > 0 else v


def upsert_embedding(track_id: str, vec: np.ndarray):
    sb.table("track_embeddings").upsert(
        {
            "track_id": track_id,
            "model_name": MODEL_NAME,
            "model_version": MODEL_VERSION,
            "embedding": vec.tolist(),  # pgvector accepts float[] → vector
            "embedding_dim": int(vec.shape[0]),
            "segment_type": "full",
            "status": "done",
            "error_message": None,
        },
        on_conflict="track_id,model_name",
    ).execute()


def mark_failed(track_id: str, msg: str):
    sb.table("track_embeddings").upsert(
        {"track_id": track_id, "model_name": MODEL_NAME, "model_version": MODEL_VERSION,
         "status": "failed", "error_message": msg[:500]},
        on_conflict="track_id,model_name",
    ).execute()


def run_once():
    pending = list_pending(BATCH_SIZE)
    print(f"[worker] pending={len(pending)} model={MODEL_NAME}")
    ok = fail = 0
    for r in pending:
        tid, url = r["id"], r["audio_url"]
        try:
            resp = requests.get(url, timeout=DOWNLOAD_TIMEOUT)
            resp.raise_for_status()
            with tempfile.NamedTemporaryFile(suffix=".mp3", delete=True) as f:
                f.write(resp.content)
                f.flush()
                vec = embed_openl3(f.name)
            upsert_embedding(tid, vec)
            ok += 1
            print(f"[worker] ok {tid} dim={vec.shape[0]}")
        except Exception as e:  # 곡별 실패 격리
            fail += 1
            mark_failed(tid, str(e))
            print(f"[worker] FAIL {tid}: {e}\n{traceback.format_exc()}")
    print(f"[worker] done ok={ok} fail={fail}")


if __name__ == "__main__":
    run_once()
