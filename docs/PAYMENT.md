# PayApp 정기결제 운영 가이드

이 문서는 SWK MVP 의 PayApp 정기결제(rebill) 통합을 운영하기 위한 환경변수 / 배포 / 검증 가이드입니다.

## 요금제

| plan_type | 상품명 | 가격 | 주기 |
|---|---|---|---|
| individual | SWK 일반 이용권 | 4,900원 | monthly |
| business | SWK 사업자 이용권 | 6,900원 | monthly |

**가격은 항상 `subscription_plans` 테이블의 `price` 컬럼만 신뢰합니다.** 프론트엔드/요청 body 의 가격은 무시됩니다.

## 필요한 환경변수

### Supabase Edge Functions secrets
Supabase CLI 로 등록:
```bash
supabase secrets set PAYAPP_USERID=실제값
supabase secrets set PAYAPP_LINKKEY=실제값
supabase secrets set PAYAPP_LINKVAL=실제값
supabase secrets set PAYAPP_API_URL=https://api.payapp.kr/oapi/apiLoad.html
supabase secrets set APP_BASE_URL=https://YOUR-PROJECT.supabase.co
supabase secrets set PAYAPP_REBILL_EXPIRE=2099-12-31
```

> `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` 는 Supabase 가 자동 주입.

### Vercel (프론트 — `.env.production`)
```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=anon-key
```

## PayApp 관리자 페이지 설정

PayApp 콘솔(가맹점) 에서 다음 설정 확인:

| 항목 | 값 |
|---|---|
| feedbackurl | `{APP_BASE_URL}/functions/v1/payapp-feedback` |
| linkval | `PAYAPP_LINKVAL` 시크릿과 동일하게 설정 |
| 결제 알림 응답 | HTTP 200 + plain `SUCCESS` 인지 확인 |
| 정기결제(rebill) 기능 | 사용 가능 상태인지 확인 |

## 배포 순서

### 1. DB 마이그레이션
```bash
# GitHub Actions 워크플로우 'DB · 추천 메타데이터 시드 적용' 재실행
# 또는 로컬 psql 로
psql "$SUPABASE_DB_URL" -f supabase/migrations/0015_payapp_subscriptions.sql
```

확인:
```sql
select plan_type, name, price from public.subscription_plans;
-- individual | SWK 일반 이용권 | 4900
-- business   | SWK 사업자 이용권 | 6900
```

### 2. Edge Functions 배포
```bash
supabase functions deploy create-payapp-subscription
supabase functions deploy payapp-feedback --no-verify-jwt
supabase functions deploy cancel-payapp-subscription
supabase functions deploy get-my-subscription
```

> `payapp-feedback` 는 PayApp 서버가 호출하므로 `--no-verify-jwt` 로 배포. 대신 함수 내부에서 `linkval` 검증.

### 3. Vercel 배포
`main` 또는 PR 브랜치 푸시 → 자동 빌드.

### 4. PayApp 콘솔에서 feedbackurl 등록
`{APP_BASE_URL}/functions/v1/payapp-feedback`

## 보안 원칙

1. **`PAYAPP_LINKKEY` / `PAYAPP_LINKVAL` 절대 프론트 노출 X** — Edge Function secrets 에만 저장.
2. **가격은 서버 DB 만 신뢰** — `create-payapp-subscription` 이 `subscription_plans.price` 로 검증.
3. **권한 부여는 `payapp-feedback` 웹훅에서만** — returnurl 은 화면 이동용 (PaymentSuccessPage 의 polling 으로 확인).
4. **웹훅 멱등 처리** — `event_key = payapp:{mul_no}:{rebill_no}:{pay_state}:{price}` 로 UNIQUE.
5. **가격 위변조** — PayApp 의 price 와 plan_price 가 다르면 권한 부여 안 함 + `suspicious` 로그.
6. **linkval 불일치** — 저장은 하되 processed_at=null + 권한 부여 X.

## 결제 상태 (pay_state) 처리

| pay_state | 의미 | 처리 |
|---|---|---|
| 4 | 결제 완료 | `paid` / `active` + period 1개월 + membership_tier 갱신 |
| 10 | 가상계좌 결제 대기 | `waiting` / `payment_waiting` |
| 8, 32 | 요청 취소 | `canceled` / `canceled` |
| 9, 64, 70, 71 | 승인 취소 / 부분 취소 | `canceled` / `canceled` + free 다운그레이드 |
| 그 외 | 이벤트만 기록, 상태 변경 X | — |

## 테스트 시나리오

### a. 정상 결제
1. `/subscription` 진입 → "광고 없이 감성 음악 듣기" 또는 "우리 매장 음악 자동 운영하기" 클릭
2. 전화번호 입력 → "PayApp 결제하기"
3. PayApp 결제창 → 카드 결제 완료
4. `/payment/success?order_no=...` 로 리다이렉트
5. polling 으로 ~10s 내 `status='active'` 확인
6. Supabase 대시보드:
   ```sql
   select order_no, status from public.payment_orders order by created_at desc limit 1;
   -- status = 'paid'
   select status, plan_type from public.subscriptions order by created_at desc limit 1;
   -- status = 'active'
   select membership_tier from public.users where id = '<user_id>';
   -- 'individual' or 'business'
   ```

### b. 중복 웹훅 (멱등)
같은 payload 로 feedback 2번 호출 시:
- 두 번째 요청도 `SUCCESS` 응답
- `payapp_webhook_events` 에 행은 1개만 존재
- `payment_orders` / `subscriptions` 상태 중복 변경 없음

### c. 가격 위변조
PayApp 응답에 `price=1000` 등 임의로 보낼 때:
- 웹훅은 SUCCESS 응답
- `payapp_webhook_events.processed_at` 은 채워지지만 status 변경 X
- `users.membership_tier` 는 `free` 그대로
- Supabase Functions logs 에 `[payapp-feedback] price mismatch` warning

### d. linkval 불일치
- 저장은 됨 (`linkval_verified=false`)
- 권한 부여 X
- PayApp 에는 SUCCESS 응답 (재시도 방지)

### e. 해지
1. `/profile` (혹은 마이페이지) → 구독 해지 클릭
2. `cancel-payapp-subscription` 호출
3. PayApp `rebillCancel` API 호출
4. 즉시 `users.membership_tier='free'` 다운그레이드 (MVP 정책)

## 운영 모니터링

```sql
-- 최근 1시간 결제 시도
select created_at, status, plan_type, amount, order_no
from public.payment_orders
order by created_at desc limit 20;

-- 미처리 웹훅 (linkval_verified=false 또는 processed_at=null)
select created_at, pay_state, price, linkval_verified, processed_at, order_no
from public.payapp_webhook_events
where processed_at is null
   or linkval_verified = false
order by created_at desc limit 20;

-- 활성 구독 분포
select plan_type, status, count(*) from public.subscriptions group by plan_type, status;
```

## 알려진 한계

- 구독 해지 시 `current_period_end` 까지 권한 유지하는 정책은 미구현 (즉시 free 다운그레이드).
- PayApp 의 자동 정기결제 결과(매월 결제)도 같은 `payapp-feedback` 으로 들어옴 — `var1=order_no` 가 동일 order 면 2회차부터는 새 order_no 발급이 필요할 수 있음 (PayApp 정책 확인 필요).
- 환불 처리는 admin 수동 (DB UPDATE) — 별도 admin UI 미구현.

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
