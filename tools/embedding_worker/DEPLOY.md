# Modal CLAP Embedder — Phase X7 배포 가이드

DEUDDA 의 CLAP 기반 임베딩 워커를 Modal T4 GPU 위에 배포합니다.

## 사전 준비

### 1. Modal 계정 및 CLI 설치

```bash
pip install modal
modal token new  # 브라우저로 토큰 발급
```

(처음이면 https://modal.com 가입 → $30 무료 크레딧 자동 지급)

### 2. Supabase Service Role Key 등록

Modal Secret 으로 안전하게 등록 (코드에 절대 하드코딩 금지):

```bash
modal secret create supabase-service-role \
  SUPABASE_URL=https://nsoesrvwkxqifjcxzvol.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=<service_role_key_here>
```

> Service role key 는 Supabase 대시보드 → Project Settings → API → `service_role` 에서 복사.
> 이 키는 RLS 를 우회하므로 절대 클라이언트 (UI/앱) 에 노출 금지.

## 배포 절차

### 1. 빌드 + 첫 배포

```bash
cd tools/embedding_worker
modal deploy modal_clap_embedder.py
```

- 첫 빌드: 5-10분 (Docker image + PyTorch + transformers + librosa)
- 이후: image cache 적중 시 30초

### 2. 741곡 전체 backfill 실행

```bash
modal run modal_clap_embedder.py::backfill_all
```

콘솔 출력 예시:
```
[backfill] round 1: processing 50 tracks
[clap] model loaded on cuda | repo=laion/larger_clap_music_and_speech
[clap] batch summary: {'ok': 48, 'fail': 2, 'elapsed_s': 187.4, ...}
[backfill] round 2: processing 50 tracks
...
[backfill] no more pending. done after 15 rounds.
```

예상 결과:
- 처리 시간: **10-15분** (cold start 1회 + 15 rounds)
- 비용: **약 $0.35** (Modal T4)
- 실패: 보통 5% 미만 (다운로드 timeout / 손상 audio)

### 3. 결과 확인

Supabase SQL 에디터에서:
```sql
select count(*) as embeddings,
       count(*) filter (where status='done') as done,
       count(*) filter (where status='failed') as failed
from public.track_embeddings
where model_version = 'laion-clap-music-v1';
```

목표: `done = 741`.

### 4. 단일 트랙 디버깅 (선택)

```bash
modal run modal_clap_embedder.py::embed_single --track-id <uuid>
```

## 자동 실행 (incremental scheduler)

`modal deploy` 시 자동으로 활성:
- **`incremental_run`** 함수가 매 15분 호출됨
- pending=0 이면 즉시 종료 (비용 0)
- 신규 트랙 추가 시 자동으로 임베딩 채움

비활성화하려면:
```bash
modal app stop deudda-clap-embedder
```

## 모니터링

```bash
modal app logs deudda-clap-embedder         # 실시간 로그
modal app list                              # 활성 앱 확인
modal volume list deudda-hf-cache           # HF 캐시 사용량 확인
```

## 비용 추적

```bash
modal usage                                  # 사용량 + 비용
```

예상 월 비용:
- 신곡 100곡/월: **~$0.10**
- 자동 incremental 호출 (no-op): **~$0.05**
- HF cache volume (1GB): **무료**

## 트러블슈팅

### 모델 다운로드 실패
- 첫 실행 시 HuggingFace 에서 모델 다운로드 (~700MB)
- 네트워크 문제 시: `modal run modal_clap_embedder.py::backfill_all` 재시도

### "out of memory" 에러
- `MICROBATCH=8` 을 4 로 줄이거나 GPU 를 `A10G` 로 변경:
  ```python
  GPU_TYPE = "A10G"  # T4 → A10G
  ```

### 다운로드 timeout
- `DOWNLOAD_TIMEOUT_S = 60` 을 120 으로 늘리기
- 또는 `audio_url` 의 Supabase Storage 가 응답 느린지 확인

### 임베딩이 UI 에 안 보임
- UI 코드의 model 파라미터가 `'laion-clap-music-v1'` 인지 확인 (X7 에서 통일 완료)
- 또는 RPC default 확인: `select * from track_embeddings limit 1;` 의 `model_version` 검증

## 다음 단계 (Phase 2)

backfill 완료 후:
1. **Supabase SQL 에서 archetype 생성**:
   ```sql
   select * from public.admin_build_store_archetypes('laion-clap-music-v1', 8);
   ```
2. **추천 품질 검증**:
   ```sql
   select * from public.recommend_stores_for_track(
     '<jazz_track_id>'::uuid, 'laion-clap-music-v1'
   );
   -- 기대: top 1 = winebar/hotel/cafe 중 하나
   ```
3. UI: AI 큐레이션 → 임베딩(PoC) 탭에서 status 확인

## 레거시 처리

기존 `worker.py` 는 OpenL3 PoC. CLAP 워커가 가동된 이후 사용 안 함.
참고용으로만 유지 (코드 하단에 deprecated 표시).
