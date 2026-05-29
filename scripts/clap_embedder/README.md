# DEUDDA CLAP Embedder (Modal)

LAION-CLAP 모델로 트랙 오디오 → 512차원 임베딩 추출.
Modal serverless GPU 위에서 동작 (A10G, $1.10/시간).

## 1. 사전 준비

### 1.1 Modal 계정
```
https://modal.com → Sign up
Payment method 등록 (free tier $30 credit 포함)
```

### 1.2 로컬 CLI 설치
```bash
pip install modal
modal token set --token-id <ID> --token-secret <SECRET>
```
(token 은 Modal 대시보드 → Settings → Tokens 에서 발급)

### 1.3 Secret 등록 (Modal Dashboard)
**Modal Dashboard → Secrets → Create Secret → "deudda-supabase"**:
- `SUPABASE_URL` = `https://nsoesrvwkxqifjcxzvol.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` = (Supabase Settings → API → service_role key)

## 2. 배포

```bash
cd scripts/clap_embedder
modal deploy modal_app.py
```

성공 시 두 개의 endpoint URL 반환:
- `https://...-embed-single.modal.run` — 단일 트랙 처리
- `https://...-backfill.modal.run` — 백필 일괄 처리

## 3. 백필 실행

### Option A: HTTP 호출
```bash
curl -X POST https://...-backfill.modal.run \
  -H "content-type: application/json" \
  -d '{"limit": 100}'
```

### Option B: Modal CLI 로 단발 실행
```bash
modal run modal_app.py::main
```

3000 트랙 backfill 예상 시간: **약 90분 (A10G 기준)**.
1트랙당 3-5초 (다운로드 + 30초 추출 + CLAP 인코딩).

## 4. 신규 트랙 자동 처리

음원 승인 시 (`admin_approve_artist_release` 호출 후) Supabase trigger 또는
별도 edge function 이 `embed-single` endpoint 를 호출하도록 설정.

(현재는 수동 백필만, 자동 트리거는 다음 PR 에서 연결)

## 5. 모델 정보

- **Model**: `laion/larger_clap_music_and_speech`
- **Embedding dim**: 512
- **Audio sample rate**: 48kHz
- **Segment**: 30초 (트랙 중앙)
- **GPU**: A10G (24GB VRAM)
- **Cold start**: ~30초 (모델 로드)
- **Warm batch**: 1트랙 ~3-5초

## 6. 비용

| 작업 | 시간 | 비용 |
|---|---|---|
| 초기 백필 (3,000 트랙) | ~90분 | ~$1.65 |
| 월 신규 100 트랙 | ~5분 | ~$0.09 |
| 월 신규 300 트랙 | ~15분 | ~$0.28 |
| 월 신규 1,000 트랙 | ~50분 | ~$0.92 |

## 7. 검증

배포 후 단일 호출로 동작 확인:
```bash
# Supabase 에서 임베딩 없는 트랙 1개 ID 가져오기
TRACK_ID=$(curl -s "https://nsoesrvwkxqifjcxzvol.supabase.co/rest/v1/rpc/list_tracks_needing_embedding" \
  -H "apikey: <ANON_KEY>" \
  -H "Authorization: Bearer <SERVICE_ROLE>" \
  -X POST -d '{"p_limit":1}' | jq -r '.[0].track_id')

# Modal endpoint 호출
curl -X POST https://...-embed-single.modal.run \
  -H "content-type: application/json" \
  -d "{\"track_id\":\"$TRACK_ID\",\"audio_url\":\"...\"}"

# Supabase 에서 임베딩 행 확인
# select count(*) from track_embeddings;
```
