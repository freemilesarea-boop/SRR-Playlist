# PayApp 정기결제 운영 가이드 (2차 검수판)

SWK MVP 의 PayApp 정기결제(rebill) 통합 운영 가이드. 실제 운영 전 반드시 정독.

## 요금제

| plan_type | 상품명 | 가격 | 주기 |
|---|---|---|---|
| individual | SWK 일반 이용권 | 4,900원 | monthly |
| business | SWK 사업자 이용권 | 6,900원 | monthly |

**가격은 항상 `subscription_plans.price` 만 신뢰합니다.** 프론트엔드/요청 body 의 가격은 무시.

## 필요한 환경변수

### Supabase Edge Function secrets

```bash
# 가맹점 식별 & 인증
supabase secrets set PAYAPP_USERID=실제값
supabase secrets set PAYAPP_LINKKEY=실제값
supabase secrets set PAYAPP_LINKVAL=실제값
supabase secrets set PAYAPP_API_URL=https://api.payapp.kr/oapi/apiLoad.html
supabase secrets set PAYAPP_REBILL_EXPIRE=2099-12-31

# URL 분리 (중요)
supabase secrets set PAYAPP_FEEDBACK_BASE_URL=https://YOUR-PROJECT.supabase.co
supabase secrets set PUBLIC_APP_URL=https://srr-playlist.vercel.app
```

| 변수 | 용도 |
|---|---|
| `PAYAPP_FEEDBACK_BASE_URL` | feedbackurl 의 host (Supabase Functions URL) |
| `PUBLIC_APP_URL` | returnurl / failurl 의 host (프론트 도메인) |
| `APP_BASE_URL` | legacy fallback — 둘 다 같으면 이거 하나로 OK |

> `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` 는 Supabase 자동 주입.

### Vercel (프론트)
```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=anon-key
```

## payapp-feedback 검증 로직 (2차 보강)

웹훅이 호출되면 **4중 검증** 후에만 권한 부여:

1. `userid === PAYAPP_USERID` (가맹점 일치)
2. `linkval === PAYAPP_LINKVAL` (콜백 토큰 일치)
3. `linkkey === PAYAPP_LINKKEY` (payload 에 포함될 때만 검증, 없으면 통과)
4. `price === payment_orders.amount` (가격 위변조 차단)

**하나라도 실패하면 권한 부여 X**. 단 PayApp 재시도 폭주 방지를 위해 응답은 항상 HTTP 200 + `SUCCESS`. 실패 사유는 `payapp_webhook_events.raw_payload._verification.reasons` 에 기록.

```sql
-- 실패 웹훅 모니터링
select created_at, pay_state, raw_payload->'_verification'->'reasons' as reasons
from public.payapp_webhook_events
where linkval_verified = false
order by created_at desc;
```

## pay_state 처리

| pay_state | 의미 | 처리 |
|---|---|---|
| 1 | 결제 요청 수신 (완료 아님) | `requested` / `pending` 유지. **권한 부여 X** |
| 4 | 결제 완료 | `paid` / `active` + period 1개월 + membership_tier 부여 |
| 10 | 가상계좌 결제 대기 | `waiting` / `payment_waiting` |
| 8, 32 | 요청 취소 | `canceled` / `canceled` |
| 9, 64, 70, 71 | 승인 취소 / 부분 취소 | `canceled` + free 다운그레이드 |
| 그 외 | 이벤트만 기록 | — |

## 2회차+ 자동 결제 (renewal) 처리

PayApp 의 매월 자동 결제는 같은 `var1=order_no` 로 콜백이 들어옵니다. 이를 처리하기 위해:

1. `pay_state=4` 수신
2. order 의 `payapp_mul_no` 가 비어있거나 현재 mul_no 와 같으면 **첫 결제** → 기존 order 를 `paid` 로 갱신
3. 기존 `payapp_mul_no` 와 다르면 **2회차+ 자동 결제** → 새 `payment_orders` 행 생성
   - `order_no = ${original_order_no}_renewal_${mul_no}` (UNIQUE 자동 보장)
   - status=`paid`, subscription_id 동일
4. 어느 경우든 subscription 의 `last_paid_at`, `current_period_start/end` 갱신

```sql
-- 사용자의 결제 이력 (renewal 포함)
select order_no, status, amount, payapp_mul_no, created_at
from public.payment_orders
where subscription_id = '<sub_id>'
order by created_at desc;
```

## 멱등성 (event_key)

```ts
event_key = `payapp:${mul_no}:${rebill_no}:${pay_state}:${price}`
```

`mul_no` 가 없을 때는 raw payload hash fallback. `payapp_webhook_events.event_key` 가 UNIQUE 이므로:
- 같은 payload 2회 호출 → 첫 INSERT 만 성공, 두 번째는 23505 (unique violation) → 즉시 SUCCESS
- `payment_orders` / `subscriptions` 중복 변경 0회 보장

## 해지 정책 (MVP)

**해지 즉시 이용권이 종료되며 `users.membership_tier='free'` 로 다운그레이드됩니다.** 남은 기간에 대한 환불은 자동 처리되지 않습니다 — 고객센터 수동 처리.

향후 "만료일까지 권한 유지" 정책으로 바꾸려면:
1. `cancel-payapp-subscription/index.ts` 의 `users.update({ membership_tier: 'free' })` 부분 제거
2. `current_period_end` 도래 시 free 다운그레이드하는 별도 cron job 추가 (예: Vercel cron `0 1 * * *` 또는 Supabase scheduled function)

## PayApp 콘솔 설정

| 항목 | 값 |
|---|---|
| feedbackurl | `${PAYAPP_FEEDBACK_BASE_URL}/functions/v1/payapp-feedback` |
| linkval | `PAYAPP_LINKVAL` 시크릿과 동일 |
| 정기결제(rebill) 기능 | 활성화 |
| 결제 알림 응답 | HTTP 200 + plain `SUCCESS` 확인 |

## 배포 순서

```bash
# 1. DB 마이그레이션 — GitHub Actions 워크플로우 재실행 (1h 스텝이 0015 적용)
# 또는 로컬에서:
psql "$SUPABASE_DB_URL" -f supabase/migrations/0015_payapp_subscriptions.sql

# 2. Edge Functions
supabase functions deploy create-payapp-subscription
supabase functions deploy payapp-feedback --no-verify-jwt    # PayApp 서버 호출 — JWT 없음
supabase functions deploy cancel-payapp-subscription
supabase functions deploy get-my-subscription

# 3. Secrets
supabase secrets set PAYAPP_USERID=... PAYAPP_LINKKEY=... PAYAPP_LINKVAL=... \
  PAYAPP_FEEDBACK_BASE_URL=https://YOUR-PROJECT.supabase.co \
  PUBLIC_APP_URL=https://srr-playlist.vercel.app

# 4. Vercel 자동 배포 (main 푸시됨)

# 5. PayApp 콘솔에서 feedbackurl 등록
```

## 테스트 시나리오 (8가지)

### A. pay_state=1 (결제 요청 수신)
```bash
curl -X POST "${PAYAPP_FEEDBACK_BASE_URL}/functions/v1/payapp-feedback" \
  -H 'content-type: application/x-www-form-urlencoded' \
  -d "userid=${PAYAPP_USERID}&linkval=${PAYAPP_LINKVAL}&var1=swk_test_001&var2=USER_UUID&mul_no=m1&rebill_no=r1&pay_state=1&price=4900"
```
**기대**: `payment_orders.status='requested'`, `subscriptions.status='pending'`, **권한 부여 X**.

### B. pay_state=4 첫 결제
```bash
curl -X POST "${PAYAPP_FEEDBACK_BASE_URL}/functions/v1/payapp-feedback" \
  -H 'content-type: application/x-www-form-urlencoded' \
  -d "userid=${PAYAPP_USERID}&linkval=${PAYAPP_LINKVAL}&var1=swk_test_001&var2=USER_UUID&mul_no=m1&rebill_no=r1&pay_state=4&price=4900"
```
**기대**: `payment_orders.status='paid'`, `subscriptions.status='active'`, `users.membership_tier='individual'`, `current_period_end` ≈ now+1month.

### C. 동일 payload 중복 호출 (멱등)
B 와 같은 curl 을 한 번 더 실행.
**기대**: HTTP 200 + `SUCCESS`. `payapp_webhook_events` 행 1개만 존재. `payment_orders` / `subscriptions` 상태 변경 없음 (event_key UNIQUE 충돌로 두 번째는 skip).

### D. pay_state=4 같은 order_no + 새 mul_no (renewal)
```bash
curl -X POST "${PAYAPP_FEEDBACK_BASE_URL}/functions/v1/payapp-feedback" \
  -H 'content-type: application/x-www-form-urlencoded' \
  -d "userid=${PAYAPP_USERID}&linkval=${PAYAPP_LINKVAL}&var1=swk_test_001&var2=USER_UUID&mul_no=m2&rebill_no=r1&pay_state=4&price=4900"
```
**기대**: `swk_test_001_renewal_m2` 새 payment_orders 행 생성 (status='paid'), 기존 order 는 그대로, subscription 의 `last_paid_at` / `current_period_*` 갱신.

### E. 가격 불일치
```bash
curl -X POST "${PAYAPP_FEEDBACK_BASE_URL}/functions/v1/payapp-feedback" \
  -H 'content-type: application/x-www-form-urlencoded' \
  -d "userid=${PAYAPP_USERID}&linkval=${PAYAPP_LINKVAL}&var1=swk_test_001&var2=USER_UUID&mul_no=m3&rebill_no=r1&pay_state=4&price=1000"
```
**기대**: `payapp_webhook_events.linkval_verified=false`, reasons 에 `price_mismatch (got=1000, expect=4900)`, **권한 부여 X**.

### F. userid 불일치
```bash
curl -X POST "${PAYAPP_FEEDBACK_BASE_URL}/functions/v1/payapp-feedback" \
  -H 'content-type: application/x-www-form-urlencoded' \
  -d "userid=ATTACKER&linkval=${PAYAPP_LINKVAL}&var1=swk_test_001&var2=USER_UUID&mul_no=m4&pay_state=4&price=4900"
```
**기대**: reasons 에 `userid_mismatch`, **권한 부여 X**.

### G. linkval 불일치
```bash
curl -X POST "${PAYAPP_FEEDBACK_BASE_URL}/functions/v1/payapp-feedback" \
  -H 'content-type: application/x-www-form-urlencoded' \
  -d "userid=${PAYAPP_USERID}&linkval=WRONG&var1=swk_test_001&var2=USER_UUID&mul_no=m5&pay_state=4&price=4900"
```
**기대**: reasons 에 `linkval_mismatch`, SUCCESS 응답, **권한 부여 X**.

### H. 해지
```bash
# 프론트에서 cancel-payapp-subscription 호출
# 결과 확인:
```
```sql
select status, canceled_at from public.subscriptions where user_id='USER_UUID';
-- status='canceled', canceled_at 채워짐
select membership_tier from public.users where id='USER_UUID';
-- 'free'
```

## 운영 모니터링 SQL

```sql
-- 최근 24시간 webhook 검증 결과
select
  date_trunc('hour', created_at) as hour,
  count(*) filter (where linkval_verified) as ok,
  count(*) filter (where not linkval_verified) as failed,
  count(*) filter (where processed_at is not null) as processed
from public.payapp_webhook_events
where created_at >= now() - interval '24 hours'
group by 1 order by 1 desc;

-- 실패 사유 분석
select
  raw_payload->'_verification'->'reasons' as reasons,
  count(*) as n
from public.payapp_webhook_events
where linkval_verified = false
  and created_at >= now() - interval '7 days'
group by 1 order by n desc;

-- 활성 구독
select plan_type, status, count(*)
from public.subscriptions
group by 1, 2 order by 1;

-- 최근 결제 (renewal 포함)
select order_no, plan_type, amount, status, payapp_mul_no, created_at
from public.payment_orders
order by created_at desc limit 20;
```

## 파일 위치

```
supabase/migrations/0015_payapp_subscriptions.sql     -- DB 스키마
supabase/functions/create-payapp-subscription/        -- 결제 시작
supabase/functions/payapp-feedback/                   -- 웹훅 (가장 중요)
supabase/functions/cancel-payapp-subscription/        -- 해지
supabase/functions/get-my-subscription/               -- 폴링 조회
src/lib/subscriptionApi.ts                            -- 프론트 wrapper
src/pages/SubscriptionPage.tsx                        -- 가격/결제 페이지
src/pages/PaymentSuccessPage.tsx                      -- 성공 페이지 (polling)
src/pages/PaymentFailPage.tsx                         -- 실패 페이지
```
