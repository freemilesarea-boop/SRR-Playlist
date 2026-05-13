# PayApp 정기결제 운영 가이드 (2차 검수판)

SWK MVP 의 PayApp 정기결제(rebill) 통합 운영 가이드. 실제 운영 전 반드시 정독.

## 요금제

| plan_type | 상품명 | 가격 | 주기 |
|---|---|---|---|
| individual | SWK 일반 이용권 | 4,900원 | monthly |
| business | SWK 사업자 이용권 | 6,900원 | monthly |

**가격은 항상 `subscription_plans.price` 만 신뢰합니다.** 프론트엔드/요청 body 의 가격은 무시.

## 필요한 환경변수

### Supabase Edge Function secrets (운영 기준)

⚠️ **실제 값은 절대 git 에 커밋하지 마세요.** 아래는 형식 예시.

```bash
# 가맹점 식별 & 인증 (PayApp 콘솔에서 발급)
supabase secrets set PAYAPP_USERID=swk_pay_userid_value
supabase secrets set PAYAPP_LINKKEY=secret_linkkey_value
supabase secrets set PAYAPP_LINKVAL=secret_linkval_value
supabase secrets set PAYAPP_API_URL=https://api.payapp.kr/oapi/apiLoad.html
supabase secrets set PAYAPP_REBILL_EXPIRE=2099-12-31

# 브랜딩 / 고객센터
supabase secrets set PAYAPP_PAYMENT_MEMO="SRR Playlist 정기결제"
supabase secrets set SUPPORT_PHONE=02-0000-0000   # ⚠️ 개인 휴대폰 금지. 070/대표번호/업무용만.

# URL 분리 (필수 — 운영 배포 전 반드시 명시)
supabase secrets set PAYAPP_FEEDBACK_BASE_URL=https://nsoesrvwkxqifjcxzvol.supabase.co
supabase secrets set PUBLIC_APP_URL=https://srr-playlist.vercel.app
```

| 변수 | 용도 | 운영 예시값 |
|---|---|---|
| `PAYAPP_USERID` | PayApp 가맹점 ID | (PayApp 콘솔) |
| `PAYAPP_LINKKEY` | 결제 요청용 시크릿 | (PayApp 콘솔) |
| `PAYAPP_LINKVAL` | webhook 검증 토큰 | (PayApp 콘솔, feedbackurl 등록 시 설정) |
| `PAYAPP_API_URL` | REST endpoint | `https://api.payapp.kr/oapi/apiLoad.html` |
| `PAYAPP_REBILL_EXPIRE` | 정기결제 만료일 | `2099-12-31` |
| `PAYAPP_PAYMENT_MEMO` | 결제창 판매자 메모 (브랜딩) | `SRR Playlist 정기결제` |
| `SUPPORT_PHONE` | 고객센터 연락처 (판매자 노출) | `02-0000-0000` (⚠️ 개인 휴대폰 금지) |
| `PAYAPP_FEEDBACK_BASE_URL` | feedbackurl host | `https://<project>.supabase.co` |
| `PUBLIC_APP_URL` | return/fail host | `https://srr-playlist.vercel.app` |
| `APP_BASE_URL` | legacy fallback | 사용 권장 X — 두 URL 명시되면 자동 무시 |

> `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` 는 Supabase 자동 주입.

**Env 누락 가드**: `PAYAPP_USERID` / `PAYAPP_LINKKEY` / `PUBLIC_APP_URL` 중 하나라도 비어 있으면 `create-payapp-subscription` 가 즉시 HTTP 500 + 명확한 에러 반환 (실제 PayApp API 호출 안 함).

## 판매자 정보 정책 (중요)

### 결제창 메모 (브랜딩)
- 환경변수 `PAYAPP_PAYMENT_MEMO` 로 제어. 기본값 `SRR Playlist 정기결제`.
- 영문 브랜딩 옵션: `SRR Playlist Premium Membership`.
- 사용자에게 노출되는 결제창의 "메모" 영역에 표시됨.

### 판매자 연락처 (개인 휴대폰 금지)
PayApp 결제창 / 알림 / 영수증에 노출되는 **판매자(가맹점) 연락처**는 다음 정책을 따릅니다:

| 채널 | 노출 경로 | 설정 위치 |
|---|---|---|
| 결제창 안내 | PayApp 가맹점 정보 | **PayApp 콘솔의 가맹점 설정** |
| 영수증 / 카드사 매출전표 | PayApp 가맹점 정보 | **PayApp 콘솔의 가맹점 설정** |
| 코드 측 첨부 (가능 시 sellerphone) | rebillRegist 파라미터 | `SUPPORT_PHONE` env |

**금지**: 대표/개발자의 **개인 휴대폰 번호** 사용 금지. 다음 중 택일:
- `02-XXXX-XXXX` (대표번호)
- `070-XXXX-XXXX` (인터넷 전화)
- `1588/1644/1670` (대표 고객센터)
- 업무용 휴대폰

**운영 절차**:
1. SUPPORT_PHONE 시크릿에 등록
2. PayApp 콘솔의 **가맹점 정보 → 대표 연락처** 도 같은 번호로 동기화
3. 영수증 미리보기에서 개인 번호가 더 이상 노출되지 않는지 확인

> ⚠️ `rebillRegist` API 명세에 별도 `sellerphone` 파라미터가 없으면 코드의 attach 는 무시됨. PayApp 콘솔 설정이 단일 진실의 원천.

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

## 실제 PayApp webhook payload 캡처 (배포 후 1회 필수)

배포 직후 첫 테스트 결제를 1건 수행하고 **반드시** 아래 SQL 로 실제 payload 의 키 이름을 확인하세요.

```sql
-- 1) 가장 최근 webhook 의 raw payload 전체 확인
select created_at, raw_payload
from public.payapp_webhook_events
order by created_at desc limit 1;

-- 2) 키 이름 일관성 점검 (코드는 mul_no/mulno, pay_state/paystate, rebill_no/rebillno 별칭 처리 중)
select jsonb_object_keys(raw_payload) as key, count(*) as n
from public.payapp_webhook_events
group by 1 order by n desc;

-- 3) linkkey 가 PayApp 으로부터 실제 들어오는지 확인
select
  (raw_payload ? 'linkkey') as has_linkkey,
  (raw_payload->>'linkkey') as linkkey_value,
  count(*)
from public.payapp_webhook_events
group by 1, 2;
```

**기대 키 (코드가 읽는 이름)**:
- `userid`, `linkval`, `linkkey` (있을 때만), `price`
- `var1` = `order_no`, `var2` = `user_id`
- `pay_state` / `mul_no` / `rebill_no` (또는 대체형 `paystate` / `mulno` / `rebillno`)

**다르면**: `supabase/functions/payapp-feedback/index.ts` 의 `payloadFromForm` 직후 키 매핑 추가. (현재 코드는 흔한 대체형은 모두 처리.)

## 중복 방지 (DB 레벨 2중 보호)

1. `payapp_webhook_events.event_key` UNIQUE — 같은 (mul_no, rebill_no, pay_state, price) 조합 webhook 2회 호출 차단.
2. `payment_orders.payapp_mul_no` partial UNIQUE INDEX (0016) — 같은 mul_no 가 두 개 order 행에 들어가는 것 차단:
   ```sql
   create unique index uniq_payment_orders_mul_no
     on public.payment_orders(payapp_mul_no)
     where payapp_mul_no is not null;
   ```
   pay_state=1 등 mul_no 가 채워지지 않은 단계에선 제약 없음. pay_state=4 첫 결제 시점 이후 적용.

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
