# PayApp 정기결제 운영 가이드 (2차 검수판)

SRR Playlist MVP 의 PayApp 정기결제(rebill) 통합 운영 가이드. 실제 운영 전 반드시 정독.

## 요금제

| plan_type | 상품명 | 가격 | 주기 |
|---|---|---|---|
| individual | SRR Playlist 정기이용권 | 4,900원 | monthly |
| business | SRR Playlist 사업자 정기이용권 | 6,900원 | monthly |

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
#
# ⚠️ 브랜드 변경 시 반드시 secret 갱신 + 함수 재배포 필요:
#    1) supabase secrets set PAYAPP_PAYMENT_MEMO="SRR Playlist 정기결제"
#    2) supabase functions deploy create-payapp-subscription
#
#    secret 값이 옛 문구('SWK monthly subscription' 등) 그대로면 코드 fallback 과
#    무관하게 PayApp 결제창의 판매자 메모가 옛 값으로 표시됩니다.
#    상품명은 subscription_plans.name (DB) 에서 자동 적용되지만, memo 는 env-only.
supabase secrets set PAYAPP_PAYMENT_MEMO="SRR Playlist 정기결제"
supabase functions deploy create-payapp-subscription
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

## pay_state 처리 (운영 진단 결과 확정 — 2026-05 기준)

| pay_state | 의미 | 처리 |
|---|---|---|
| 1 | 요청 수신 | `requested` / `pending` 유지. **권한 부여 X** |
| 4 | **승인대기** (카드 인증 단계) | `requested` / `pending` 유지. **권한 부여 X** (이전 코드의 paid 처리는 잘못됨) |
| 10 | 가상계좌 입금 대기 | `waiting` / `payment_waiting` |
| 8, 32 | 요청 취소 | `canceled` / `canceled` |
| **64** | **승인완료** (정산 확정 — 실제 결제 성공) | `paid` / `active` + period 1개월 + **membership_tier 부여** |
| 9, 70, 71 | 승인 취소 / 부분 취소 | `canceled` + free 다운그레이드 |
| 그 외 | 이벤트만 기록 | — |

### state=64 미도착 시 진단 / 복구

운영 사례: PayApp 콘솔에서는 결제완료 표시되지만 state=64 webhook 이 영구
미도착 → membership 미적용. SQL Editor 에서 다음 쿼리로 진단:

```sql
-- 특정 mul_no 의 모든 webhook event 확인 (state별 도착 여부)
select pay_state, linkval_verified, matched_user_id, membership_updated,
       processing_error, created_at
from public.payapp_webhook_events
where payapp_mul_no = '115554935'
order by created_at;
```

state=4 만 보이고 state=64 행이 없으면:
1. PayApp 콘솔의 "공통 통보 URL" 설정 확인
2. `supabase functions deploy payapp-feedback --no-verify-jwt` 재배포 확인
3. PayApp 측 retry 정책상 영구 미도착일 수 있음 → 아래 복구 절차

**복구 방법 A** — 관리자 UI:
`/admin → 결제 동기화 → Webhook 진단` 표에서 해당 행의 `강제승인` 버튼 클릭.
이 버튼은 `matched_user_id` 가 채워진 행 + `membership_updated=false` 일 때만 표시.

**복구 방법 B** — SQL Editor 직접:
```sql
select * from public.admin_force_activate_membership(
  '<matched_user_id>'::uuid,
  'individual',
  'state=64 webhook missing — mul_no=115554935',
  4900
);
```

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

## 해지 정책 (현행 — 0056 이후)

사용자가 해지하면 `cancel-payapp-subscription` 이 PayApp `rebillCancel` 을 먼저 호출하고,
성공했을 때만 DB 를 바꾼다.

- `subscriptions.status='cancel_scheduled'`, `auto_renew=false`, `cancel_requested_at=now()`
- `users.membership_tier` 는 **`current_period_end` 까지 유지**(유예기간)
- 유예 종료 시 `expire_my_scheduled_cancellation()`(로그인 시) /
  `admin_expire_scheduled_cancellations()` 가 `canceled` + `free` 로 회수
- 남은 기간 환불은 자동 처리하지 않는다 — 고객센터 수동 처리

### 유예기간 = 전부 이용 가능 (0496)

**결제한 이용기간(`current_period_end`)이 남아 있으면 해지했더라도 음원 등록·유통 신청을 포함한
유료 기능을 전부 이용할 수 있다.** 0467 이 요구하던 `cancel_requested_at is null` 조건을 없애고
기간 만료 하나로 통일했다.

```
artist_has_paid_access = status in ('active','cancel_scheduled')
                         AND refunded_at is null
                         AND current_period_end > now()
                         AND plan_type in (individual, business, artist_general, artist_student)
```

- 환불건(`refunded_at`)은 기간이 남아 있어도 계속 차단 — 환불은 이용권 회수다.
- `canceled` / `refunded` / `expired` 상태는 차단.
- 기간이 지나면 만료 배치가 상태를 바꾸기 전이라도 자동으로 다시 차단된다.
- 이 함수 하나가 tracks 트리거 · tracks/track_audio_quality RLS · storage(audio/covers) INSERT ·
  `get_artist_upload_eligibility` · `get_artist_billing_access` 의 공통 게이트다.

## 정지 후 재개 정책 (0495)

**정지(해지 예약/해지)한 유저는 이전 요금제 기간이 끝나기를 기다릴 필요 없이 언제든 바로 다시
결제해 유통을 재개할 수 있다.**

| 지점 | 동작 |
|---|---|
| `/subscription` | 정지 상태면 요금제 카드의 '이용 중' 잠금 해제 + 상단에 재개 배너/CTA (유예 중이면 "언제까지 그대로 이용 가능" 안내) |
| 아티스트 대시보드 | `has_paid_membership=false` → 재결제 카드 노출(문구는 '유통 재개') |
| `create-payapp-subscription` | 정지 구독을 건드리지 않고 **새 pending 구독**으로 결제 진행 |
| `_internal_apply_payapp_paid_event` | 결제 성공 시 `cancel_requested_at` / `cancel_reason` 제거 + `auto_renew=true` → 게이트 즉시 통과. 대체된 이전 정지 구독은 `current_period_end` 를 결제시각에서 끊음 |
| `expire_*_scheduled_cancellation(s)` | 유효한 다른 활성 구독이 있으면 `free` 강등 금지 |
| `admin_force_activate_membership` | 관리자 강제 활성화도 동일하게 해지 흔적 제거 |

- 재결제 시점부터 **새 결제 주기(1개월)** 가 시작된다. PayApp 정기결제는 등록일 기준으로
  매월 청구되므로 남은 유예 일수를 청구 주기에 얹지 않는다(잔여분 보상은 필요 시 수동 처리).
- 배포 순서: migration `0495_resume_paused_subscription.sql` → `0496_grace_period_full_access.sql`
  적용 → `supabase functions deploy create-payapp-subscription` → 프론트 배포.
  migration 이전에 프론트만 배포하면 `has_paid_membership` 이 옛 기준(membership_tier)이라
  정지 유저에게 재결제 카드가 뜨지 않는다.

## 아티스트 플랜과 membership_tier 매핑 (0497)

`users.membership_tier` 는 CHECK 상 `free/individual/business` 만 저장 가능하다.
아티스트 플랜은 tier 로 매핑해서 저장한다.

| payment_orders.plan_type | users.membership_tier |
|---|---|
| individual | individual |
| business | business |
| artist_general (6,900) | individual |
| artist_student (4,900) | individual |

⚠️ **plan_type 과 membership_tier 를 문자열로 직접 비교하면 안 된다.** 아티스트 플랜에서
항상 false 가 된다. `get_my_payment_status.membership_applied` 가 이 실수로 아티스트 플랜
결제 53건(회원 47명, 2026-06-10~)에 대해 결제 성공 페이지에서 "아직 반영되지 않음" 을
띄웠고, 이미 결제한 회원에게 재결제를 안내했다 (0497 에서 수정).

비교가 필요하면 `_internal_apply_payapp_paid_event` 의 `v_tier_target` 과 동일한 매핑을 거칠 것.

## PayApp 콘솔 설정

| 항목 | 값 |
|---|---|
| feedbackurl | `${PAYAPP_FEEDBACK_BASE_URL}/functions/v1/payapp-feedback` |
| linkval | `PAYAPP_LINKVAL` 시크릿과 동일 |
| 정기결제(rebill) 기능 | 활성화 |
| 결제 알림 응답 | HTTP 200 + plain `SUCCESS` 확인 |

## 운영 진단 (결제 미반영 시)

신규 결제가 앱에 반영 안 될 때, Supabase SQL Editor 에서 아래 쿼리 순서로 확인:

```sql
-- 1) Webhook 수신 여부 (최근 2시간)
select
  created_at,
  payapp_mul_no,
  payapp_rebill_no,
  pay_state,
  linkval_verified,
  processed_at,
  raw_payload
from public.payapp_webhook_events
where created_at > now() - interval '2 hours'
order by created_at desc;
```

- 해당 결제의 `mul_no` 가 안 보이면 → **PayApp feedbackurl 미호출**. PayApp 콘솔의
  "공통 통보 URL" 확인 + `supabase functions deploy payapp-feedback --no-verify-jwt` 재배포.
- 보이는데 `linkval_verified=false` 면 → `PAYAPP_LINKVAL` 시크릿 불일치.
- 보이는데 `processed_at` 이 NULL 이면 → 함수 내부 처리 실패 (Supabase Functions 로그 확인).

### ⚠️ PayApp REST API 의 한계 — 결제내역 조회 cmd 없음

PayApp REST API (`https://api.payapp.kr/oapi/apiLoad.html`) 는 **결제내역 일괄 조회를
지원하지 않습니다**. 공식/오픈소스 PayApp 라이브러리(ssut/payapp 파이썬, chwnam/Box-
billingPayApp PHP 등) 및 매뉴얼이 일치하게 지원하는 cmd 는 다음 쓰기 계열뿐:

| 분류 | cmd | 용도 |
|---|---|---|
| 결제 | `payrequest` / `paycancel` / `paycancelreq` | 결제 요청·취소 |
| 정기결제 | `rebillRegist` / `rebillPay` / `rebillStop` | 정기결제 등록·즉시결제·해지 |

→ `paymentList` / `payList` / `tradeList` 등의 cmd 는 존재하지 않으며, 호출 시
`errno=70040 "cmd을 가져오지 못했습니다"` 가 반환되는 것이 **정상 응답**. 따라서 결제
데이터의 유일한 진실 원천은 PayApp webhook(feedbackurl) 으로 들어와
`payapp_webhook_events` 에 저장된 payload.

### 결제 누락 복구 흐름 (PayApp 가 webhook 보낸 경우)

`sync-payapp-payments` Edge Function 은 이제 **저장된 webhook event 재처리** 모드로
동작:

```sql
-- 미처리 webhook event 확인
select id, payapp_mul_no, pay_state, price, membership_updated, processed_at,
       processing_error, created_at
from public.payapp_webhook_events
where linkval_verified = true
  and membership_updated = false
  and pay_state in (4, 64)
  and created_at > now() - interval '7 days'
order by created_at desc;
```

→ `/admin → 결제 동기화 → 미처리 webhook 자동 재처리` 버튼이 위 행들을
`admin_replay_webhook_event` 로 일괄 재처리.

### 결제 누락 복구 흐름 (PayApp webhook 자체가 안 온 경우)

PayApp 콘솔 점검 등으로 feedbackurl 호출이 누락된 결제 → webhook 재처리 도구로는
복구 불가능 (재처리할 row 자체가 없음). 두 가지 수동 도구 사용:

1. **order_no 강제완료** (admin UI) — PayApp 콘솔에서 결제 확인 후 `swk_...` order_no
   로 `admin_force_paid_by_order_no` 호출 → 권한 즉시 부여 + 감사 로그.
2. **수동 입력 동기화** (admin UI 하단 폼) — `payapp_mul_no` + 금액 + 결제일시 직접
   입력 → `admin_sync_payapp_payment` 가 멱등 처리.

```sql
-- 3) 수동 동기화 import 큐 (미매칭 결제)
select payapp_mul_no, approval_no, buyer_email, buyer_phone, amount,
       plan_type, status, matched_user_id, created_at
from public.payapp_manual_payment_imports
order by created_at desc
limit 20;
```

- 결제건이 여기 `unmatched` 로 들어와 있으면 → `/admin → 결제 동기화 → 미매칭 결제` 에서 1-클릭 연결.

```sql
-- 4) subscription / membership 적용 결과 (특정 사용자)
select u.id, u.nickname, u.phone, u.membership_tier,
       s.status as sub_status, s.last_paid_at, s.current_period_end
from public.users u
left join public.subscriptions s on s.user_id = u.id
where u.id = '<USER_UUID>';
```

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
