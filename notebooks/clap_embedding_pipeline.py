"""
듣다 — CLAP 임베딩 파이프라인 (Colab batch)

용도:
  1) `track_embeddings` (track_id, embedding 512d, model_name='laion-clap-music-v1') 적재
  2) `store_archetype_embeddings` 텍스트 prompt 기반 적재 (27개 store_key)

환경: Colab (GPU 권장) — laion-clap, librosa, requests
인증: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (Colab Secrets)
호환: 0170/0183 migration RPC (admin_import_track_embeddings, admin_export_embedding_pending_tracks)

X6.55 (Phase 1: 수동 batch 로 임베딩 unlock — fit_score audio_score 활성화)
"""

import io
import os
import time
from typing import Any, Optional

import requests

MODEL_NAME = 'laion-clap-music-v1'
MODEL_VERSION = 'v1'
EMBEDDING_DIM = 512
SEGMENT_START_SEC = 30  # 30초부터
SEGMENT_DURATION_SEC = 30  # 30초간
SAMPLE_RATE = 48000  # laion-clap 표준 입력
REQUEST_TIMEOUT = 60
BATCH_UPLOAD_SIZE = 50  # admin_import_track_embeddings 호출 당 트랙 수


# -----------------------------------------------------------------------------
# 매장 텍스트 prompt (CLAP text encoder 로 임베딩 — 매장 archetype 정의)
# -----------------------------------------------------------------------------
# 각 store_key 에 대한 자연어 묘사. 영어가 모델 학습 데이터의 주류라 영어 prompt 우선.
# (한국 매장 컨텍스트 단어 추가는 매장 차별화 효과 미미 — 영어 음악 묘사가 핵심)
STORE_PROMPTS: dict[str, str] = {
    'gym': 'high energy upbeat workout music with strong driving beat, electronic dance music',
    'pilates': 'calm focused instrumental music for stretching and pilates, ambient with steady rhythm',
    'yoga': 'meditative peaceful yoga music with soft acoustic instruments, slow tempo, nature sounds',
    'hospital': 'quiet calming background music for medical waiting room, soft piano and ambient pads',
    'cafe_independent': 'cozy coffee shop background music, indie folk and acoustic guitar, relaxed vocals',
    'cafe_franchise': 'mainstream cafe background music, pop acoustic and chill electronic, light vocals',
    'brunch_cafe': 'bright cheerful brunch cafe music, sunny acoustic pop and bossa nova, morning vibes',
    'winebar': 'sophisticated wine bar music, smooth jazz and lounge, mellow saxophone',
    'cocktail_bar': 'classy cocktail bar music, deep house and nu jazz, midnight ambient grooves',
    'pub': 'casual pub atmosphere music, rock and pop hits, upbeat and social',
    'izakaya': 'japanese izakaya background music, city pop and acoustic jazz, warm and inviting',
    'restaurant': 'background music for casual restaurant, soft pop and instrumental, light and unobtrusive',
    'korean_restaurant': 'background music for korean restaurant, modern korean ballad and acoustic, warm',
    'japanese_restaurant': 'japanese restaurant background music, traditional koto and modern ambient',
    'chinese_restaurant': 'background music for chinese restaurant, instrumental and traditional fusion',
    'western_restaurant': 'background music for western restaurant, classical and easy listening jazz',
    'fine_dining': 'elegant fine dining music, classical piano and chamber music, refined ambient',
    'office': 'focused office productivity music, lo-fi hip hop and instrumental ambient',
    'coworking': 'modern coworking space music, chill electronic and lo-fi beats, productive focus',
    'salon': 'relaxing hair salon music, smooth pop and chill electronic, modern background',
    'nail_shop': 'soft nail salon music, gentle pop and acoustic, peaceful background',
    'hotel_lobby': 'luxury hotel lobby music, sophisticated ambient and smooth jazz, refined elegance',
    'select_shop': 'trendy select shop music, indie pop and modern electronic, fashionable vibes',
    'clothing_store': 'energetic clothing store music, current pop hits and electronic, upbeat shopping',
    'kids_cafe': 'cheerful kids cafe music, fun upbeat childrens songs and bright pop',
    'dog_cafe': 'pet friendly cafe music, calm acoustic and soft instrumental, relaxing vibes',
    'pc_bang': 'gaming center music, electronic dance music and game soundtracks, energetic edm',
}


# =============================================================================
# 1. 모델 로드 (Colab 셀 3)
# =============================================================================
def load_clap_model():
    """laion-clap music 모델 로드. GPU 있으면 자동 사용."""
    import laion_clap
    import torch

    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    print(f'[clap] device = {device}')

    model = laion_clap.CLAP_Module(enable_fusion=False, amodel='HTSAT-base', device=device)
    # music_audioset_epoch_15_esc_90.14.pt = laion-clap music 사전훈련 체크포인트
    model.load_ckpt()  # 기본 ckpt download (~1.5GB, 1회)
    return model


# =============================================================================
# 2. Supabase RPC 호출 helper
# =============================================================================
def _rpc(url: str, key: str, fn: str, payload: dict[str, Any]) -> Any:
    r = requests.post(
        f'{url}/rest/v1/rpc/{fn}',
        headers={
            'apikey': key,
            'Authorization': f'Bearer {key}',
            'Content-Type': 'application/json',
        },
        json=payload,
        timeout=REQUEST_TIMEOUT,
    )
    r.raise_for_status()
    return r.json()


def fetch_pending_tracks(url: str, key: str, limit: int = 1000) -> list[dict]:
    """미적재 트랙 목록 fetch (admin_export_embedding_pending_tracks RPC)."""
    data = _rpc(url, key, 'admin_export_embedding_pending_tracks', {
        'p_model': MODEL_NAME,
        'p_limit': limit,
    })
    return data or []


def import_track_embeddings(url: str, key: str, rows: list[dict], dry_run: bool = False) -> dict:
    """RPC: track_embeddings 적재 (배치)."""
    return _rpc(url, key, 'admin_import_track_embeddings', {
        'p_rows': rows,
        'p_dry_run': dry_run,
    })


# =============================================================================
# 3. 오디오 다운로드 + 디코드 (30s segment from 30s mark)
# =============================================================================
def download_and_decode(audio_url: str, duration_hint: Optional[float] = None) -> Optional['np.ndarray']:
    """
    오디오 URL → 30초 segment (30s~60s) → 48kHz mono float32 ndarray.

    duration_hint < 60s 면 segment 시작점을 0 으로 (짧은 곡 안전).
    실패 시 None 반환 (호출자가 skip).
    """
    import numpy as np
    import librosa

    try:
        # offset 결정 — 짧은 곡이면 처음부터
        offset = SEGMENT_START_SEC
        if duration_hint is not None and duration_hint < SEGMENT_START_SEC + SEGMENT_DURATION_SEC:
            offset = max(0, (duration_hint - SEGMENT_DURATION_SEC) / 2)

        # librosa.load 는 URL 직접 지원 안 함 → requests 로 다운로드 후 BytesIO
        r = requests.get(audio_url, timeout=REQUEST_TIMEOUT, stream=True)
        r.raise_for_status()
        buf = io.BytesIO(r.content)

        # 디코드 + 리샘플 + 모노
        y, sr = librosa.load(buf, sr=SAMPLE_RATE, mono=True, offset=offset, duration=SEGMENT_DURATION_SEC)
        if y.size == 0:
            return None
        # laion-clap 표준 입력 float32, [-1, 1] range
        return y.astype(np.float32)
    except Exception as e:
        print(f'[decode] FAIL: {audio_url[:80]}... — {type(e).__name__}: {e}')
        return None


# =============================================================================
# 4. 임베딩 추출
# =============================================================================
def embed_audio(model, audio_array) -> Optional[list[float]]:
    """laion-clap 모듈로 512-dim 임베딩 추출."""
    import numpy as np
    import torch

    try:
        with torch.no_grad():
            emb = model.get_audio_embedding_from_data(x=np.expand_dims(audio_array, 0), use_tensor=False)
        vec = emb[0]
        if len(vec) != EMBEDDING_DIM:
            print(f'[embed] dim mismatch: {len(vec)} != {EMBEDDING_DIM}')
            return None
        return [float(v) for v in vec]
    except Exception as e:
        print(f'[embed] FAIL: {type(e).__name__}: {e}')
        return None


def embed_text(model, prompt: str) -> Optional[list[float]]:
    """laion-clap 텍스트 임베딩 — 매장 archetype 용."""
    import torch
    try:
        with torch.no_grad():
            emb = model.get_text_embedding([prompt], use_tensor=False)
        vec = emb[0]
        if len(vec) != EMBEDDING_DIM:
            return None
        return [float(v) for v in vec]
    except Exception as e:
        print(f'[embed_text] FAIL: {type(e).__name__}: {e}')
        return None


# =============================================================================
# 5. 트랙 batch 처리 (Colab 셀 4)
# =============================================================================
def process_track_batch(model, url: str, key: str, limit: int = 1000) -> dict:
    """
    미적재 트랙을 batch 로 처리.

    흐름:
      1) RPC 로 pending 목록 fetch
      2) 트랙별로: 다운로드 → 디코드 → 임베딩
      3) BATCH_UPLOAD_SIZE 마다 import_track_embeddings 호출
      4) 결과 집계 반환

    실패한 트랙은 errors 에 기록되고 다음 트랙 계속.
    """
    pending = fetch_pending_tracks(url, key, limit)
    total = len(pending)
    print(f'[batch] pending tracks: {total}')
    if total == 0:
        return {'ok': True, 'pending': 0, 'imported': 0, 'errors': []}

    rows: list[dict] = []
    errors: list[dict] = []
    succeeded = 0
    failed = 0
    t0 = time.time()

    for idx, t in enumerate(pending, 1):
        track_id = t.get('track_id')
        audio_url = t.get('audio_url')
        title = t.get('title', '')[:40]
        duration = t.get('duration')

        if not audio_url:
            errors.append({'track_id': track_id, 'reason': 'no audio_url'})
            failed += 1
            continue

        print(f'[{idx}/{total}] {title}', end=' ... ')
        audio = download_and_decode(audio_url, duration_hint=duration)
        if audio is None:
            errors.append({'track_id': track_id, 'reason': 'decode_failed'})
            failed += 1
            print('decode_fail')
            continue

        emb = embed_audio(model, audio)
        if emb is None:
            errors.append({'track_id': track_id, 'reason': 'embed_failed'})
            failed += 1
            print('embed_fail')
            continue

        rows.append({
            'track_id': track_id,
            'model_name': MODEL_NAME,
            'model_version': MODEL_VERSION,
            'embedding': emb,
            'embedding_dim': EMBEDDING_DIM,
            'segment_type': 'mid_30s',
        })
        succeeded += 1
        elapsed = time.time() - t0
        rate = succeeded / max(elapsed, 0.001)
        eta = (total - idx) / max(rate, 0.001)
        print(f'OK  ({succeeded}/{total} · {rate:.1f}/s · ETA {eta/60:.1f}min)')

        # batch upload
        if len(rows) >= BATCH_UPLOAD_SIZE:
            res = import_track_embeddings(url, key, rows, dry_run=False)
            print(f'  → uploaded {res.get("imported", 0)} (skipped {res.get("skipped", 0)})')
            rows = []

    # 남은 row flush
    if rows:
        res = import_track_embeddings(url, key, rows, dry_run=False)
        print(f'  → final flush uploaded {res.get("imported", 0)}')

    elapsed = time.time() - t0
    print(f'\n[batch] DONE — succeeded={succeeded} failed={failed} elapsed={elapsed/60:.1f}min')
    return {'ok': True, 'pending': total, 'imported': succeeded, 'failed': failed, 'errors': errors[:50]}


# =============================================================================
# 6. 매장 아키타입 (텍스트 prompt 기반, Colab 셀 5)
# =============================================================================
def build_store_archetypes_from_text(model, url: str, key: str) -> dict:
    """
    STORE_PROMPTS 각각을 CLAP text encoder 로 임베딩 → store_archetype_embeddings 적재.

    이유: ai_store_fit 이 비어있어 admin_build_store_archetypes (seed-track 경로) 작동 불가.
    CLAP 은 text-audio contrastive 학습이라 text 임베딩과 audio 임베딩이 같은 공간 →
    text prompt 로 archetype 정의 가능.

    호출 RPC: admin_import_store_archetypes (X6.55 / migration 0331). pgvector 직접 cast 처리.
    """
    rows: list[dict] = []
    embed_failed: list[dict] = []

    for store_key, prompt in STORE_PROMPTS.items():
        print(f'[store] {store_key} ← "{prompt[:50]}..."', end=' ... ')
        emb = embed_text(model, prompt)
        if emb is None:
            embed_failed.append({'store_key': store_key, 'reason': 'embed_failed'})
            print('FAIL')
            continue
        rows.append({
            'store_key': store_key,
            'model_name': MODEL_NAME,
            'model_version': MODEL_VERSION,
            'embedding': emb,
            'embedding_dim': EMBEDDING_DIM,
            'prompt_text': prompt,
        })
        print('OK')

    if not rows:
        return {'ok': False, 'built': 0, 'failed': embed_failed, 'reason': 'no embeddings'}

    # 0331 RPC: admin_import_store_archetypes (vector cast + upsert 처리)
    res = _rpc(url, key, 'admin_import_store_archetypes', {'p_rows': rows})
    res.setdefault('failed', [])
    res['failed'].extend(embed_failed)
    print(f'\n[store] imported={res.get("imported", 0)}/27 skipped={res.get("skipped", 0)} embed_failed={len(embed_failed)}')
    return res


# =============================================================================
# 7. 사용 예시 (Colab 또는 local 실행)
# =============================================================================
if __name__ == '__main__':
    SUPABASE_URL = os.environ.get('SUPABASE_URL', '').rstrip('/')
    SUPABASE_SERVICE_ROLE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise SystemExit('Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars.')

    print('=' * 60)
    print('Step 1: load CLAP model (1-2 min)')
    print('=' * 60)
    clap = load_clap_model()

    print('\n' + '=' * 60)
    print('Step 2: process tracks (limit=1000)')
    print('=' * 60)
    result = process_track_batch(clap, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, limit=1000)
    print(result)

    print('\n' + '=' * 60)
    print('Step 3: build store archetypes from text prompts')
    print('=' * 60)
    result = build_store_archetypes_from_text(clap, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    print(result)

    print('\n' + '=' * 60)
    print('DONE — 확인: AiCurationPanel → 임베딩(PoC) 탭')
    print('=' * 60)
