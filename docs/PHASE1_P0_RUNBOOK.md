# Phase 1 P0 — 사용자 직접 실행 가이드 (Runbook)

`docs/PHASE1_DEPLOY_CHECKLIST.md` §11 (Conditional 완료 근거) 의 6개 항목을 실제로 실행 완료하기
위한 단계별 실행 매뉴얼. Sandbox / MCP approval / Vercel 개인 계정 제약 때문에 이 세션에서 자동
실행이 불가한 항목들.

**진행 순서 권장**: §1 → §2 → §3 → §4 → §5 → §6. §1~§3 은 인프라 확인이므로 먼저 통과 후 §4
스모크가 의미 있음.

**표기**:
- 🖥️ 실행 위치
- 📥 입력값
- ✅ 기대 결과
- ❌ 실패 시 원인 후보
- 🛠️ 실패 시 다음 조치

---

## §1. `dispatch-admin-notifications` edge function 재배포

`0392` 멱등 로직 (dispatched_at 컬럼 + 채널별 마커) 을 참조하는 코드 반영본 재배포.

### 방법 A — Supabase CLI (로컬)

- 🖥️ **실행 위치**: 로컬 개발 머신 (Supabase CLI 설치된 곳)
- 📥 **입력값**:
  - `SUPABASE_ACCESS_TOKEN` — Supabase Personal Access Token (Dashboard → Account → Access Tokens)
  - `project_ref = nsoesrvwkxqifjcxzvol`
  - 로컬에 최신 dev 브랜치 체크아웃 (`git checkout claude/playlist-mvp-development-2JmTJ && git pull`)

```bash
supabase login  # 최초 1회
supabase link --project-ref nsoesrvwkxqifjcxzvol
supabase functions deploy dispatch-admin-notifications
```

- ✅ **기대 결과**:
  ```
  Deploying function dispatch-admin-notifications
  Function dispatch-admin-notifications deployed successfully at
  https://nsoesrvwkxqifjcxzvol.functions.supabase.co/dispatch-admin-notifications
  Version: 9
  ```
  Version 8 → 9 로 bump. 코드 diff 없이도 배포 성공.

### 방법 B — Supabase MCP approval (Claude Code 세션 내)

- 🖥️ **실행 위치**: Claude Code 세션 (재시작해 approval prompt 수락)
- 📥 **입력값**: 없음 (Claude 가 함수 소스를 그대로 재배포 요청)
- ✅ **기대 결과**: `{ "success": true, "version": 9 }`

### 방법 C — Supabase Dashboard (Web UI)

- 🖥️ Dashboard → Project → Edge Functions → dispatch-admin-notifications → Deploy new version 클릭
- 📥 없음
- ✅ Dashboard 상단 versions 목록에 새 항목 추가

### ❌ 실패 시 원인 후보

| 증상 | 원인 |
|------|------|
| `not linked to project` | `supabase link` 미실행 또는 잘못된 project_ref |
| `permission denied` | `SUPABASE_ACCESS_TOKEN` 만료 / 권한 부족 |
| `deploy timeout` | Supabase egress 임시 장애 |
| Version 이 안 오름 | 이미 최신 배포됨 (변경 없음 → no-op) — 문제 아님 |

### 🛠️ 실패 시 다음 조치

1. Access token 재발급 후 재시도
2. Dashboard 에서 함수 로그 (Logs 탭) 확인
3. 실패해도 스모크 §4 는 실행 가능 — cron 은 별도 배포됨

### 검증 SQL (배포 성공 후)

Supabase SQL Editor 에서:
```sql
select id, kind, dispatched_at, dispatch_slack_at, dispatch_email_at, dispatch_attempts, dispatch_error
  from public.admin_notifications
 where dispatched_at is null
 order by created_at desc
 limit 5;
```
✅ 이후 §4 cron 실행 시 이 미발송 알림들의 `dispatched_at` 이 채워져야 함.

---

## §2. Vercel 최신 dev 배포 확인

merge SHA 자동 배포 여부.

- 🖥️ **실행 위치**: Vercel Dashboard (개인 계정)
- 📥 **입력값**:
  - 프로젝트: `srr-playlist` (또는 실제 이름)
  - Production branch: `claude/playlist-mvp-development-2JmTJ` 로 설정돼 있어야 자동 배포
  - 확인할 merge SHA: **`5013d62`** (PR #232 머지 최신)

### 절차

1. https://vercel.com/dashboard → 프로젝트 선택
2. Deployments 탭
3. 최근 목록에서 SHA `5013d62` (또는 그 이후) 확인

### ✅ 기대 결과

| 필드 | 값 |
|------|-----|
| Status | **Ready** (Building/Queued 아님) |
| Environment | Production |
| Branch | `claude/playlist-mvp-development-2JmTJ` |
| Commit | `5013d62 docs(phase1): mark 조건부 완료 ...` |
| Domain | `www.deudda.com` alias 활성 |

### ❌ 실패 시 원인 후보

| 증상 | 원인 |
|------|------|
| Deploy 없음 | Vercel GitHub App 이 base branch 를 Production 으로 미설정 |
| Build failed | vite/typescript 오류 — 로컬에서 이미 `npm run build` 통과 확인됨 → env 미설정 가능성 |
| Deploy 오래됨 (`db45727` 이하) | 자동 배포 트리거 실패 — 수동 Redeploy 필요 |
| Domain 이 이전 SHA | Alias 수동 promotion 필요 |

### 🛠️ 실패 시 다음 조치

1. Vercel → Project → Settings → Git → **Production Branch** 가 `claude/playlist-mvp-development-2JmTJ` 인지 확인
2. Deployments → 해당 SHA → `⋯` → **Redeploy**
3. Build logs 확인 (env 오류 vs 코드 오류 구분)

### 검증 (배포 성공 후)

```bash
curl -sS -I https://www.deudda.com/ | head -5
# X-Vercel-Cache: HIT/MISS, X-Vercel-Id 헤더 확인
```

---

## §3. Vercel Environment Variables 5종 확인

Cron + edge function 이 사용하는 서버 시크릿.

- 🖥️ **실행 위치**: Vercel Dashboard → Project → **Settings → Environment Variables**
- 📥 확인 대상:

| Variable | Env | 용도 |
|----------|-----|------|
| `CRON_SECRET` | Production | `/api/cron/enterprise-ops` Bearer 인증 |
| `SUPABASE_URL` | Production | 서버 사이드 REST/RPC 호출 base URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Production | cron 내부 admin RPC 호출 (0391 service_role 게이트) |
| `RESEND_API_KEY` | Production | dispatch-admin-notifications 이메일 발송 |
| `RESEND_FROM` | Production | `듣다 운영 <no-reply@deudda.com>` 등 발신자 |

### ✅ 기대 결과

- 5종 모두 **Production** environment 에 존재 (값 자체는 보지 못해도 됨, Set 여부만)
- `CRON_SECRET` 은 Supabase Edge Function secret (`supabase secrets list`) 과 **동일 값**

### ❌ 실패 시 원인 후보

| 증상 | 원인 |
|------|------|
| `CRON_SECRET` 없음 | 처음 배포 시 미설정 |
| `SUPABASE_SERVICE_ROLE_KEY` 없음 | Vercel 이 Preview/Development 에만 설정됨 |
| `RESEND_API_KEY` 없음 | 이메일 채널만 skip, 나머지는 동작 (silent 실패) |
| 값이 Preview 만 | Production 재발급 필요 |

### 🛠️ 실패 시 다음 조치

1. 각 env 를 **Production, Preview, Development 3개 environment** 모두에 세팅
2. `Sensitive` 체크 (Service Role Key / RESEND API KEY 는 반드시)
3. **재배포 필수** — env 변경 후 자동 재빌드 안 되면 §2 절차로 Redeploy

### Supabase Edge Function secrets 확인 (로컬)

```bash
supabase link --project-ref nsoesrvwkxqifjcxzvol
supabase secrets list
```

- ✅ `CRON_SECRET` / `RESEND_API_KEY` / `RESEND_FROM` 존재
- ❌ 미존재 시:
  ```bash
  supabase secrets set CRON_SECRET=$(openssl rand -hex 32)
  supabase secrets set RESEND_API_KEY=re_xxx
  supabase secrets set 'RESEND_FROM=듣다 운영 <no-reply@deudda.com>'
  ```
  (Vercel 의 `CRON_SECRET` 과 동일 값 사용!)

---

## §4. `scripts/smoke-enterprise-ops.sh` 로컬 실행

Phase 1 cron 실 스모크.

- 🖥️ **실행 위치**: 로컬 개발 머신 (인터넷 접근 가능)
- 📥 **입력값** (환경변수):
  - `APP_URL=https://www.deudda.com` (또는 Vercel preview URL)
  - `CRON_SECRET=<Vercel Production env 값과 동일>`
  - (선택) `SUPABASE_URL=https://nsoesrvwkxqifjcxzvol.supabase.co`

### 절차

```bash
cd /path/to/SRR-Playlist
git checkout claude/playlist-mvp-development-2JmTJ && git pull

APP_URL=https://www.deudda.com \
CRON_SECRET=<value> \
SUPABASE_URL=https://nsoesrvwkxqifjcxzvol.supabase.co \
bash scripts/smoke-enterprise-ops.sh
```

### ✅ 기대 결과

```
== 1) enterprise-ops cron 수동 호출 ==
HTTP 200
{
  "ok": true,
  "ran_at": "2026-07-01T...",
  "failed": [],
  "results": {
    "policy_automation":     { "ok": true, "status": 200, "ms": <N> },
    "billing_overdue":       { "ok": true, "status": 200, "ms": <N> },
    "noc_alert_sync":        { "ok": true, "status": 200, "ms": <N> },
    "notifications_dispatch":{ "ok": true, "status": 200, "ms": <N> }
  }
}
```

4개 task 각 `ok: true`, HTTP 200.

### ❌ 실패 시 원인 후보

| HTTP | Body 힌트 | 원인 | 조치 |
|------|-----------|------|------|
| **401** | `CRON_SECRET 미설정` 또는 `invalid secret` | Vercel env 없음 / 값 불일치 | §3 재확인 |
| **500** | `SUPABASE_URL 미설정` | Vercel env 없음 | §3 재확인 |
| **200 + `policy_automation.ok=false`** | `_is_super_admin() = false` | 0391 미적용 (service_role 분기 없음) | Supabase 마이그 재실행 |
| **200 + `notifications_dispatch.ok=false, status=401`** | edge function 인증 실패 | `CRON_SECRET` Vercel ↔ Supabase 불일치 | 두 곳 값 동기화 |
| **200 + `noc_alert_sync.ok=false`** | `admin_noc_sync_alerts_to_notifications` 실행 실패 | 0393 미적용 / dedup index 충돌 | Supabase SQL Editor 로 함수 존재 확인 |
| **200 + `billing_overdue.ok=false`** | `admin_mark_enterprise_billing_overdue` 실패 | 0382 이후 signature 변경 미반영 | RPC 존재 확인 |
| **connection refused / DNS** | APP_URL 오타 | | URL 재확인 |

### 🛠️ 실패 시 다음 조치

1. `results.failed` 배열의 첫 항목 확인 → 해당 task 만 개별 디버깅
2. Vercel → Deployments → Functions 탭 → `/api/cron/enterprise-ops` → 실시간 로그 확인
3. Supabase Dashboard → Edge Functions → 로그 확인
4. 오류가 계속되면 코드 수정 없이 **`docs/PHASE1_DEPLOY_CHECKLIST.md` §11 에 실패 원인 첨부** 후 다음 세션에서 hotfix PR 킥오프

### 재실행 (멱등 확인)

같은 명령을 5분 후 다시 실행:
```bash
bash scripts/smoke-enterprise-ops.sh
```

- ✅ 기대: 첫 실행에서 발송된 알림은 **재발송 안 됨** (`notifications_dispatch.sent` = 0 또는 신규 알림만)
- ❌ 재발송되면 0392 멱등 로직 미반영 → §1 재배포 재시도

---

## §5. Supabase SQL Editor read-only 쿼리 실행

Cron / 알림 / 계약 버킷 상태 검증.

- 🖥️ **실행 위치**: Supabase Dashboard → **SQL Editor**
- 📥 **입력값**: 없음 (read-only)

### 5-a) 종합 지표

```sql
select
  (select count(*) from public.admin_notifications
    where kind='noc_alert' and created_at >= now() - interval '6 hours') as noc_alert_6h,
  (select count(*) from public.admin_notifications where dispatched_at is null) as pending_dispatch,
  (select count(*) from public.admin_operation_logs
    where source='cron' and category='enterprise_ops'
    and created_at >= now() - interval '1 hour') as cron_runs_1h,
  (select public from storage.buckets where id='enterprise-contracts') as contracts_bucket_public;
```

- ✅ **기대 결과**:
  | column | 값 | 판정 |
  |--------|-----|------|
  | `noc_alert_6h` | 0 이상 | 값 자체는 상황 의존 |
  | `pending_dispatch` | **낮을수록 좋음** (0 이면 완벽) | 100+ 면 dispatch 실패 신호 |
  | `cron_runs_1h` | **≥ 1** | 15min 주기라 최소 3-4 여야 정상 |
  | `contracts_bucket_public` | **`false`** | 0394 적용 확인 |

### 5-b) NOC dedup 위반 (있으면 안 됨)

```sql
select coalesce((context->>'noc_dedup_key'), 'null') as dedup_key, count(*) c
  from public.admin_notifications
 where kind='noc_alert' and created_at >= now() - interval '6 hours'
 group by 1 having count(*) > 1;
```

- ✅ **기대 결과**: **결과 0건** (같은 dedup_key 가 6h 내 여러 번 생성되지 않음)
- ❌ **결과 있음**: 0393 dedup index 실패 → hotfix 필요

### 5-c) Announcement occurrence 중복 (있으면 안 됨)

```sql
select context->>'occurrence_key' as occurrence, count(*)
  from public.enterprise_announcement_play_logs
 where status='played' and created_at >= now() - interval '24 hours'
 group by 1 having count(*) > 1;
```

- ✅ **기대 결과**: **결과 0건** (같은 occurrence_key 가 한 번만 played)
- ❌ **결과 있음**: 0389 occurrence dedup 실패 → hotfix 필요

### 5-d) Dispatch 세부 상태

```sql
select id, kind, severity,
       dispatched_at,
       dispatch_slack_at, dispatch_email_at,
       dispatch_attempts, left(dispatch_error, 100) as err
  from public.admin_notifications
 order by created_at desc
 limit 10;
```

- ✅ **기대 결과**:
  - 최근 알림들의 `dispatch_attempts ≥ 1`
  - Slack 활성이면 `dispatch_slack_at` 채워짐
  - Email 활성이면 `dispatch_email_at` 채워짐
  - `dispatch_error` NULL 또는 이전 실패 사유
- ❌ **`dispatch_attempts=0` 이 많음**: cron 이 미발화 → §4 재실행

### 5-e) Cron 실행 로그

```sql
select created_at, level, status, left(message, 120) as msg
  from public.admin_operation_logs
 where source='cron' and category='enterprise_ops'
 order by created_at desc
 limit 10;
```

- ✅ 최근 10건 각 `level='info' or 'success'`, `status='success'`

### 🛠️ 실패 시 다음 조치

각 쿼리별 실패 처리:
| 쿼리 | 실패 시 확인 |
|------|-------------|
| 5-a `cron_runs_1h=0` | Vercel cron 등록 확인 (§3 후 `vercel.json` 저장 → 재배포) |
| 5-a `contracts_bucket_public=true` | 0394 재실행 |
| 5-b 위반 있음 | `select * from pg_indexes where indexname like '%noc_dedup%';` 로 인덱스 존재 확인 |
| 5-c 위반 있음 | 0389 `admin_notifications occurrence_key unique` 인덱스 확인 |
| 5-d dispatch 미발화 | §1 재배포 + §4 재실행 |

---

## §6. 실제 계약 파일 public 403 / signed URL 확인

`0394` 계약 버킷 private 정책 실증. **실제 계약 파일이 있어야 함.**

### 6-a) 계약 파일 생성 (선결)

- 🖥️ **실행 위치**: 브라우저 → https://www.deudda.com/admin
- 📥 **입력값**: super_admin 계정 로그인
- **절차**:
  1. Admin 패널 → **Enterprise 계약 관리** 탭
  2. 신규 계약 생성 → 계약서 파일 업로드 (PDF/이미지)
  3. 업로드 완료 후 `enterprise_contracts` / `enterprise_contract_files` 에 row 생성

### 6-b) 과거 public URL 접근 → 403 확인

Bucket 이 private 로 전환됐으므로 옛 public URL 은 접근 불가.

- 🖥️ **실행 위치**: 로컬 shell
- 📥 **입력값**: 6-a) 에서 생성된 파일의 `file_path`

파일 경로를 알아내기 위해 Supabase SQL Editor:
```sql
select id, contract_id, file_path
  from public.enterprise_contract_files
 order by created_at desc
 limit 1;
```

그 뒤:
```bash
FILE_PATH="<위 쿼리 결과의 file_path>"
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://nsoesrvwkxqifjcxzvol.supabase.co/storage/v1/object/public/enterprise-contracts/$FILE_PATH"
```

- ✅ **기대 결과**: **`400`** 또는 **`403`** (bucket private → public 경로 차단)
- ❌ **`200`**: 0394 미적용 (`storage.buckets.public = true` 상태) → §5-a `contracts_bucket_public` 재확인

### 6-c) Admin signed URL 정상 다운로드

- 🖥️ **실행 위치**: 브라우저 https://www.deudda.com/admin
- **절차**:
  1. Admin 패널 → Enterprise 계약 관리 → 6-a 에서 만든 계약 상세
  2. **파일 다운로드 링크 클릭** → 새 탭 열림
  3. URL 이 `/storage/v1/object/sign/enterprise-contracts/...?token=...&exp=...` 패턴인지 확인
  4. 파일 실제 다운로드 정상 완료

- ✅ **기대 결과**:
  - 새 탭에서 파일 표시/다운로드 정상 (TTL 5분 내)
  - URL 에 `?token=` 쿼리 파라미터 존재
- ❌ **403 / signed URL 생성 실패**: `enterpriseContractApi.ts:172` `createSignedUrl` 호출 실패 → super_admin storage SELECT 정책 (0394 §3 정의) 존재 확인:
  ```sql
  select polname, cmd, pg_get_expr(polqual, polrelid) as using_expr
    from pg_policy
   where polrelid = 'storage.objects'::regclass
     and polname like '%enterprise_contracts%';
  ```
  ✅ super_admin RLS 정책 존재해야 함.

### 6-d) TTL 만료 후 재접근 (선택)

- signed URL 을 별도로 저장 후 **5분 뒤 재접근**
- ✅ **기대**: 403 (TTL 만료)
- 다시 파일 다운로드하려면 Admin UI 재클릭 → 새 signed URL 생성

### 🛠️ 실패 시 다음 조치

| 증상 | 조치 |
|------|------|
| 6-b 가 `200` | 0394 재적용 (`update storage.buckets set public=false where id='enterprise-contracts'`) |
| 6-c signed URL 생성 실패 | RLS policy 재확인 + super_admin 계정 확인 |
| 6-c 새 탭 401/403 | signed URL 서명 무효 — 최신 프론트 배포됐는지 §2 재확인 |
| 계약 파일이 없어서 실증 불가 | 6-a 계약 생성 완료 후 재시도 (선택 항목이므로 skip 가능) |

---

## 최종 완료 판정

6개 항목 모두 ✅ 되면 `docs/PHASE1_DEPLOY_CHECKLIST.md` §11 의 checkbox 를 `[x]` 로 update.
그 뒤 §0 배너의 **"조건부 완료"** 를 **"완료 (Complete)"** 로 변경하는 PR 을 생성 → Phase 1 확정
종료 → Phase 2 킥오프 진행.

### 진행 상태 로그 (수동 기록용 템플릿)

```
- [ ] §1 dispatch-admin-notifications 재배포:   결과=?  버전=?
- [ ] §2 Vercel 최신 dev 배포:                  결과=?  SHA=?
- [ ] §3 Vercel env 5종:                        결과=?  누락=?
- [ ] §4 smoke-enterprise-ops.sh:               결과=?  4task ok=?
- [ ] §5 SQL Editor 5쿼리:                      결과=?  위반=?
- [ ] §6 계약 파일 403 + signed URL:            결과=?  파일 존재=?
```

---

## 관련 문서

- `docs/PHASE1_DEPLOY_CHECKLIST.md` — 전체 배포 체크리스트
- `scripts/smoke-enterprise-ops.sh` — 자동 스모크 헬퍼
- `docs/MIGRATION_RULES.md` — SQL 작성 규칙
- `docs/migrations.md` — 파일명 prefix 규칙
