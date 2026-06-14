# CLAP Embedding 자동 파이프라인 (Phase 6 / X6.73)

dev 머지 후 운영자가 한 번만 해야 하는 설정 가이드.

## 무엇이 자동인가

migration 0340 + pg_cron 으로 이미 자동:

- 신규 트랙 `release_status='released'` 전환 시 **트리거** → `track_embedding_jobs` 큐 적재
- pg_cron 5분 간격 → `dispatch_embedding_jobs()` → backend HTTP 호출 (pg_net)
- pg_cron 15분 간격 → `cron_reap_stale_embedding_jobs()` → 30분 timeout 자동 error 마킹
- backend 가 완료 시 `store_track_embedding` + `admin_mark_embedding_job_done` 호출 → status='done'

## 운영자 1회 설정 (5분)

### A안: Modal worker 배포 (권장, 처리 빠르고 비용 명확)

scripts/clap_embedder/README.md 의 1~2단계 그대로 진행:

```bash
# 1. Modal CLI 설치 + token
pip install modal
modal token set --token-id <ID> --token-secret <SECRET>

# 2. Supabase secret 등록 (Modal Dashboard → Secrets → "deudda-supabase"):
#    SUPABASE_URL = https://nsoesrvwkxqifjcxzvol.supabase.co
#    SUPABASE_SERVICE_ROLE_KEY = <Supabase API 페이지에서 복사>

# 3. 배포
cd scripts/clap_embedder
modal deploy modal_app.py

# 4. 출력된 endpoint URL 복사 (예: https://your-username--deudda-embed-single.modal.run)
```

### B안: 직접 Edge Function / 다른 인프라

backend 가 다음을 만족하면 됨:
- `POST <url>` 받음 (body: `{ job_id, track_id, audio_url, title }`)
- audio_url 다운로드 → CLAP `laion/larger_clap_music` 으로 임베딩
- Supabase RPC `store_track_embedding(track_id, embedding, 'laion-clap-music-v1')` 호출
- Supabase RPC `admin_mark_embedding_job_done(job_id, success, error, response)` 호출

### 공통: 운영자 UI 에서 backend URL 등록

1. 관리자 패널 → AI 큐레이션 → **임베딩(PoC)** 탭
2. 상단 "자동 파이프라인 (Phase 6)" 섹션
3. `Embed backend URL` 입력란에 위에서 복사한 URL 입력 → **저장**
4. **"미임베딩 일괄 큐 적재 (847)"** 클릭 → 큐 채워짐
5. 5분 후 첫 배치 처리 시작 (큐 처리중 1~5 증가 확인)

## 모니터링

같은 탭의 stat 카드:
- 임베딩 완료 / 발매곡 총합 / **진행률 %**
- 큐 대기 / 큐 처리중 / 24h 완료 / 24h 실패

"최근 작업" 펼치면 status chip + error 메시지 + 재시도 버튼.

## 처리 속도 (Modal A10G 기준)

- 트랙 1개: 3~5초 (다운로드 + 30s 추출 + CLAP)
- 배치 1회 (cron 5분): 기본 5건 (`admin_settings.embed_dispatch_batch_size`)
- 시간당 약 60건
- **847건 백필 예상**: ~14시간 (배치 크기 5) / ~3시간 (배치 크기 20)

배치 크기 늘리려면 SQL 콘솔에서:
```sql
update public.admin_settings set value = to_jsonb(20)
 where key = 'embed_dispatch_batch_size';
```

## 비용 (Modal 기준)

| 작업 | 시간 | 비용 |
|---|---|---|
| 847건 백필 | ~14h (idle 포함) | ~$0.50 |
| 월 신규 100건 | 5분 | $0.09 |
| 월 신규 1,000건 | 50분 | $0.92 |

## 문제 해결

### `dispatch skip: embed_backend_url not configured`
→ UI 에서 backend URL 저장 안 됐음. 다시 저장.

### `dispatch timeout (>30min)` 자동 error
→ backend 가 호출에 응답 안 함. Modal Dashboard 에서 로그 확인.

### 큐가 안 줄어듦
1. SQL `select cron.job_run_details from cron.job_run_details where jobname='srr-embed-dispatch' order by start_time desc limit 5;`
   → cron 실행 이력 확인
2. SQL `select * from net._http_response order by created desc limit 5;`
   → pg_net 응답 확인 (backend 응답 코드)
3. 에러 잡 재시도: 임베딩 탭에서 행별 "재시도" 클릭

### 임베딩이 들어왔는데 카운트가 안 늘어남
→ backend 가 `store_track_embedding` 만 호출하고 `admin_mark_embedding_job_done` 호출 안 함.
   reaper 가 30분 후 error 처리. modal_app.py 의 finalize 단계 확인.

## 끄기

`admin_set_embed_backend_url('')` (빈 문자열) 또는 UI 에서 URL 비우고 저장.
dispatcher 가 첫 줄에서 silent return, 트리거는 계속 큐 적재만 함 (재개 시 처리됨).
