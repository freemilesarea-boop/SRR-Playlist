# AI-ENV-2 — Dedicated Test Project Provisioning Runbook (사람 실행 절차)

이 문서는 **격리된 SRR 전용 Test Supabase Project**를 구성하고 Vercel Preview를 그
Test Project에 연결하기 위해 **사람(운영자)이 직접 수행**해야 하는 정확한 절차와 값
목록이다. AI 에이전트는 다음 두 가지를 자율 수행하지 않았다:

1. **Dedicated Test Supabase Project 생성** — 월 **$10 recurring billing**이 발생하는
   결제/승인 행위이므로 사용자 명시 승인 없이 생성하지 않는다.
2. **Vercel Preview 환경변수 설정** — 운영 대시보드 접근이 필요한 ops 행위.

> 절대 원칙: Production Supabase(project ref `nsoesr…`, 이하 마스킹)에는 어떤 Migration/
> Schema/Data/Auth/Storage/Secret 변경도 하지 않는다. Production 데이터·개인정보·계약·
> 정산·계좌·결제·Storage Asset을 Test로 복사하지 않는다.

---

## 1. Test Supabase Project 생성

- Supabase Dashboard → Organization `freemilesarea-boop's Org` → **New Project**
- Name: `SRR Playlist Test`
- Region: Production과 동일 Region(예: ap-southeast-1) 권장 — 지연/동작 근접성. 다른
  Region도 무방하나 선택 이유를 기록.
- Database Password: **Production과 다른 강력한 신규 비밀번호** (로그/커밋 금지).
- 비용: 월 $10 확인 후 진행.
- 생성 후 확보할 값(전체 노출 금지, 안전 보관):
  - `TEST_SUPABASE_URL` = `https://<test-ref>.supabase.co`
  - `TEST_SUPABASE_ANON_KEY`
  - `TEST_SUPABASE_SERVICE_ROLE_KEY` (**서버 전용 — VITE_ 접두사 금지**)
  - `TEST_SUPABASE_PROJECT_REF` = `<test-ref>` (Production ref와 반드시 다름)
  - `TEST_DATABASE_URL` (Migration/psql용, 서버 전용)

## 2. Test Project 격리 감사 (생성 직후)

- Project Ref ≠ Production Ref, URL ≠ Production URL, API Key ≠ Production Key 확인
- Replication/FDW/외부 Integration 없음, 초기 Table Empty 확인
- 다음이면 **즉시 중단**: Production Ref와 동일 / Production Dump 복원 흔적 / 실제 사용자·
  계약·정산·계좌 데이터 존재 / Production Storage·Webhook 연결

## 3. Local Full Migration Dry Run (Test 적용 전 필수)

```bash
# supabase CLI + Docker 필요
npm run db:test:dryrun:list           # 순서/중복/누락만 검사(무해)
# 격리 Local 또는 Test DB 에 전체 적용:
TEST_SUPABASE_PROJECT_REF=local DATABASE_URL="postgres://postgres:postgres@127.0.0.1:54322/postgres" \
  npm run db:test:dryrun
```

- 0001~0571 순차 적용. 실패 시 **정확한 migration 번호 + SQL Error** 확인.
- 호환성 문제 발생 시 **기존 Migration 수정 금지** → 신규 `0572_test_environment_full_stack_compatibility.sql`
  (조건부 Object/Index/Constraint, 안전한 Function 재정의, search_path 보정 등)로만 해결.
  Production 데이터 영향 없는 처리만 허용.

## 4. Dedicated Test DB Full Apply

```bash
TEST_SUPABASE_PROJECT_REF=<test-ref> \
DATABASE_URL="$TEST_DATABASE_URL" \
  npm run db:test:dryrun         # db-test-guard 가 Production Ref 를 거부
# 또는 supabase CLI link 후:
#   supabase link --project-ref <test-ref>
#   npm run db:test:push
```

- 적용 후: Applied 수 / Latest / Failed 0 / Drift(Repo vs Test = in_sync) 확인.
- Production은 여전히 0453(repository_ahead) — **이 Phase에서 수정하지 않음**.

## 5. Synthetic Seed 적용

```bash
npm run db:test:guard && psql "$TEST_DATABASE_URL" -f supabase/seed_test.sql
```

- 18 Test Track(+fixtures) / 2 Playlist / Test Admin·Store Owner·Artist×4. 실제 PII/계약/
  정산/계좌/ISRC/Production ID 없음. Brand/Business/reaction/playback 확장 블록은 적용
  스키마에 맞춰 운영자가 채운다.

## 6. Test Storage / Audio

- Test Project에 **`test-audio` 버킷** 생성(Production 버킷과 분리).
- 30초 이상 정상 MP3/WAV 5개 이상(자체 제작 Test Tone) 업로드 + `seed_test.sql`의 URL을
  실제 서명/공개 URL로 갱신. Invalid URL / Missing Cover fixture 유지.

## 7. Test Auth

- Admin Create User로 Test Admin(`admin@example.com` 등 허구)·Test Store Owner 생성.
  실제 사용자 이메일로 Invite 금지. Role Metadata/Profile/Store 연결.

## 8. Vercel Preview 환경변수 (Preview Scope 전용)

Vercel → Project → Settings → Environment Variables → **Preview** scope에만:

```
VITE_APP_ENV=preview
VITE_SUPABASE_URL=<TEST_SUPABASE_URL>
VITE_SUPABASE_ANON_KEY=<TEST_SUPABASE_ANON_KEY>
VITE_EXPECTED_SUPABASE_PROJECT_REF=<TEST_SUPABASE_PROJECT_REF>
```

서버 전용(Preview scope, VITE_ 금지):

```
SUPABASE_SERVICE_ROLE_KEY=<TEST_SUPABASE_SERVICE_ROLE_KEY>
TEST_EMAIL_PROVIDER_DISABLED=true
TEST_SMS_PROVIDER_DISABLED=true
TEST_PAYMENT_PROVIDER_DISABLED=true
TEST_WEBHOOKS_DISABLED=true
TEST_EXTERNAL_STORE_CONTROL_DISABLED=true
TEST_SETTLEMENT_DISABLED=true
```

- **Production scope는 변경하지 않는다.** Production scope에 `VITE_APP_ENV`/Expected Ref가
  없다면 별도 Production Change Request로 분리(이 Phase에서 임의 변경 금지).
- 설정 후 **신규 Preview Deployment** 생성(기존 재사용 금지). Build 전 CI에서
  `npm run env:preview:verify` 로 검증(Preview Build에서 실패 시 중단).

## 8b. Build-Time 검증(선택 — Preview build에 추가 권장)

`build` 앞에 preview 전용 검증을 붙이려면(운영자 판단):

```json
"build:preview": "npm run env:preview:verify && npm run build"
```

## 9. Browser Validation (실제 Preview에서)

Preview URL에서 확인: Test Banner 표시 / Block Screen 미표시 / Test Admin·Store Login /
Playlist·Track 조회 / **Test Audio 실제 재생** / Logout·재로그인 / **Production 데이터(User·
Store·Artist·계약·정산) 미노출**. Browser/OS/Device 기록.

## 10. RLS / RPC Integration (실제 Auth Context)

- Anonymous/Store/Other-Store/Admin/Artist 실제 세션으로 RLS 검증(Service Role 단독 금지).
- AI Experiment Runtime/Admin RPC 존재 + 인증 + Store Scope + 위조 차단 검증(존재만으로
  PASS 금지). **이 Phase에서 Experiment를 Running으로 전환하거나 Treatment를 재생하지
  않는다** — 인증·안전성까지만.

## 11. Reset / Re-seed

```bash
# Reset 은 test-only 스크립트로만. Production Ref 는 db-test-guard 가 거부.
npm run db:test:guard && psql "$TEST_DATABASE_URL" -c "-- delete synthetic-prefixed runtime rows only"
npm run db:test:guard && psql "$TEST_DATABASE_URL" -f supabase/seed_test.sql
```

## 12. 완료 판정

모든 항목 PASS + Production 데이터 0 + Production 영향 0 → `READY_FOR_INTERNAL_TEST`.
하나라도 미완/미검증 → `PARTIALLY_READY`. Dedicated Project 없음/Preview가 Production
연결/Full Apply 실패/Secret 분리 실패/Critical RLS 실패 → `BLOCKED`.

> `READY_FOR_INTERNAL_TEST`는 Internal Test **성공**이 아니라 격리 환경 **인증 완료**를
> 의미한다. Recommendation v2 Treatment/Internal Experiment/Canary/Global Rollout은 다음
> Phase에서만 수행한다.
