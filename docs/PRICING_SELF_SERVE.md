# 요금제(Pricing) 셀프 가입 — 2026-09

좌측 네비게이터 **요금제** (`/pricing`).
일반 회원으로 가입한 점주님들이 가입 이후 결제 화면을 찾지 못하던 문제를 해결한다.
가입 유형과 무관하게 언제든 아래 **3가지**로만 결제/가입한다.

| # | 카테고리 | 결제 경로 | 금액 |
|---|---|---|---|
| 1 | 매장 가입 | `create-payapp-subscription` (`plan_type='business'`) — **기존 경로 그대로** | `subscription_plans.business` (현재 6,900원/월) |
| 2 | 엔터프라이즈 본사 | 사업자 인증 → 본사 계정 생성 → (본사 일괄청구인 경우) `/enterprise/pay` | 관리자가 확정 |
| 3 | 엔터프라이즈 가맹 | 본사 코드 → 매장 연결 → `/enterprise/pay` | 본사의 `store_monthly_price` |

---

## 1. 매장 가입

서버 변경 **없음**. 요금제 화면이 기존 business 플랜 결제창을 그대로 연다.
프로모션 코드도 `/subscription` 과 동일하게 적용된다.

이미 엔터프라이즈(본사/가맹)에 속한 회원에게는 이 카드의 결제 버튼을 감춘다 —
엔터프라이즈 요금과 이중 청구되는 것을 막기 위함(`storeCheckoutBlockedReason`).

## 2. 엔터프라이즈 본사 (셀프 신청)

```
사업자 인증 (verify-business-number 엣지함수)
   → business_verification_profiles 기록
   → apply_enterprise_hq_selfserve RPC
   → enterprise_accounts(status='invited') 생성 + 본사 코드 발급
   → 관리자 화면(EnterpriseAccountsPanel, 상태 필터 'invited')에 즉시 노출
```

- 사업자번호는 **서버가 다시 검증**한다 (`_kr_business_number_valid`, KS X 1003 체크섬).
  `000-00-00000` 처럼 체크섬을 통과해버리는 값은 별도로 막는다.
- `business_verified` / `verification_status` 는 **엣지함수만** 기록한다.
  RPC 는 `verified` 또는 `manual_review` 인 행이 있어야만 본사 계정을 만든다.
- 사업자번호는 `enterprise_accounts.notes` 에도 남겨 관리자가 목록에서 바로 본다.
- primary franchise 는 `0373` AFTER INSERT 트리거가 자동 생성한다.

### 청구 방식 (신청자가 선택)

| 선택 | 결과 |
|---|---|
| 가맹점 개별 결제 (`per_store`, 기본) | `billing_enabled=true`, `store_monthly_price = subscription_plans.business` → **가맹점이 즉시 결제 가능** |
| 본사 일괄 결제 (`hq_consolidated`) | `billing_enabled=false` → 매장 수에 따라 **관리자가 요금 확정 후** `admin_set_enterprise_billing_config` 로 활성화 |

본사 일괄 요금은 규모별 협의 사항이라 셀프로 금액을 정하지 않는다.
금액을 발명하지 않는다는 원칙 — 매장 요금은 항상 `subscription_plans` 를 따라간다
(`_default_store_monthly_price`).

### 국세청 API

`verify-business-number` 는 `NTS_BUSINESS_API_KEY` (공공데이터포털 사업자등록 진위확인)
가 설정돼 있으면 실제 조회해 `verified` 로 기록한다.

**키가 없으면 `manual_review` 로만 기록한다 — 검증하지 않은 것을 검증했다고 쓰지 않는다.**
관리자가 확인 후 승인하는 흐름이 되며, 신청 자체는 진행된다.

| 환경변수 | 위치 | 필수 |
|---|---|---|
| `NTS_BUSINESS_API_KEY` | Supabase → Project Settings → Edge Functions → Secrets | 선택(없으면 manual_review) |
| `NTS_BUSINESS_API_URL` | 동일 | 선택 (기본 `https://api.odcloud.kr/api/nts-businessman/v1/validate`) |

**아티스트 계정은 거절한다** (0509). 가맹 가입과 같은 규칙이다 — `account_type='artist'`
를 바꾸면 아티스트 대시보드/정산이 깨진다(0499 회귀 이력). 아티스트가 매장·본사를
하려면 별도 계정을 만들어야 하며, 그래야 아티스트의 업로드/유통/정산 권리가
계정 전환에 휘말리지 않는다.

0502 는 화면(`canApplyHq`)에서만 막고 서버 함수에는 검사가 없어서 RPC 직접 호출로
우회할 수 있었다. 0509 에서 서버에도 같은 검사를 넣어 두 곳의 규칙을 맞췄다.

## 3. 엔터프라이즈 가맹 (본사 코드 필수)

```
본사 코드 입력 → lookup_enterprise_join_code (코드만으로 본사 확인)
   → join_enterprise_store_by_code
       · account_type 이 individual/null 이면 business 로 승격
       · claim_enterprise_store_account(0490) 를 그대로 호출 (본문 무변경)
   → get_my_enterprise_payment_context().should_pay 면 /enterprise/pay
```

- 코드 매칭 기준은 `0480 validate_enterprise_invite('store')` 과 동일 —
  `store_invite_code`(정확) 또는 `brand_code`(대소문자 무시).
- **아티스트 계정은 거절한다.** `account_type='artist'` 를 바꾸면 아티스트
  대시보드/정산이 깨진다(0499 회귀 이력).
- `membership_tier`(스트리밍 권한)는 여기서 건드리지 않는다. 결제 웹훅에서만 올라간다.

---

## 결제 성공 → 스트리밍 권한

`_apply_enterprise_payapp_event` (0472) 는 그동안 엔터프라이즈 결제가 성공해도
`users.membership_tier` 를 올리지 않아, 결제해도 매장 재생이 안 되는 상태였다.
0502 에서 결제 성공 분기에 `_grant_enterprise_store_membership()` 을 추가했다.

- **승격만** 한다 (`free`/`individual` → `business`). 강등은 절대 없음.
- `account_type='artist'` 는 제외.
- 이 함수가 도입되기 전까지 엔터프라이즈 결제는 **한 번도 실행된 적이 없다**
  (`enterprise_payment_subscriptions` / `_orders` / `_webhook_events` 전부 0행) —
  기존 결제/스트리밍에 영향이 없는 이유.

---

## 관련 파일

| 레이어 | 파일 |
|---|---|
| 마이그레이션 | `supabase/migrations/0502_pricing_self_serve_signup.sql` |
| 엣지함수 | `supabase/functions/verify-business-number/index.ts` |
| 순수 헬퍼 (+테스트) | `src/lib/pricingPlans.ts` / `.test.ts` |
| API 래퍼 | `src/lib/api/pricingApi.ts` |
| 화면 | `src/pages/PricingPage.tsx` |
| 진입점 | `src/components/Sidebar.tsx` (요금제), `src/pages/ProfilePage.tsx` (모바일) |

## 건드리지 않은 것 (회귀 방지)

- `subscriptions` / `payment_orders` / 기존 `users.membership_tier` 행
- `_internal_apply_payapp_event` (일반 구독 웹훅)
- `artist_has_paid_access` / `get_artist_upload_eligibility` / 업로드 RLS
- `claim_enterprise_store_account` (0490) / `validate_enterprise_invite` (0480) 본문
