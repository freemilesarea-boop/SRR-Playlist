# Phase 3-2 킥오프 — Brand Registry + 자동 Onboarding

**상태**: **킥오프 (승인 대기)**. 코드 변경 없음.

**목표**: 관리자가 브랜드를 사전 등록 → Enterprise 회원이 브랜드명+코드로 자동 매칭 가입 → 자동 계약 생성 → 관리자 승인.

**핵심 원칙**:
1. 기존 `enterprise_accounts` 스키마 / 기존 RPC / 기존 invite 시스템 (0363) **모두 유지**
2. Settlement 계산식 / Snapshot 구조 / Cron / Dispatch / Policy **무영향**
3. 기존 Enterprise UI 회귀 0 — 새 탭 + 새 signup form 병행

---

## 1. 인벤토리 요약 (중요)

### 1.1 기존 `enterprise_accounts` (0351 + 0363)

- 이미 존재: `enterprise_name`, `manager_name / email / phone`, `brand_code`, `hq_invite_code`, `store_invite_code`, `role`, `status ∈ {active,invited,suspended,inactive}`, `auth_user_id`, `onboarding_enabled`, `allow_self_register_region`
- **부재**: 사업자정보 (사업자명, 사업자번호, 대표자, 주소), 기본 계약값 (default_monthly_store_price 등), brand template concept

### 1.2 기존 Enterprise 회원가입 (0363 Phase 1-6)

- 진입점: `LoginPage.tsx` 통합 (SignupPage 없음)
- 흐름: **관리자가 enterprise_account 미리 생성** → invite code 발급 → 사용자가 `/login?signup=enterprise-hq&brand=X&code=Y` 로 가입 → `validate_enterprise_invite` + `claim_enterprise_hq_account` → `auth_user_id` binding
- Signup mode: `signup-enterprise-hq` / `signup-enterprise-store` (이미 존재)

### 1.3 기존 Contract (0383)

- `admin_create_enterprise_contract` — **`contract_no` 자동 발번 로직 없음** (사용자가 입력)
- Contract status: `draft|active|expiring|expired|terminated`

### 1.4 기존 Enterprise UI

- `EnterpriseAccountsPanel.tsx` — enterprise_accounts CRUD (invite code 관리 포함)
- `EnterpriseContractsPanel.tsx` — 계약 CRUD
- `EnterpriseSettlementCenterPanel.tsx` (Phase 3-1) — 통합 화면
- `EnterpriseHqSignupForm.tsx` / `EnterpriseStoreSignupForm.tsx` — 초대 code 기반 가입

---

## 2. Phase 3-2 vs 기존 시스템 — 관계

사용자 spec 은 **두 가지 새 flow** 를 요구:

| 기존 (0363) | Phase 3-2 (신규) |
|-------------|-----------------|
| 관리자가 enterprise_account 를 미리 생성 | 관리자가 **brand registry** 만 미리 등록 |
| 사용자가 `brand_name + invite_code` 로 가입 | 사용자가 `brand_name + brand_code` 로 가입 |
| enterprise_account 는 이미 존재 | 가입 성공 시 enterprise_account **신규 생성** (registry 참조) |
| 계약은 별도 관리자 조작 | **자동 계약 생성** (없으면) |
| 즉시 활성 | **관리자 승인 대기** → 활성 |

**두 flow 는 병행**. 관리자는 브랜드별로 선택 가능. 기존 flow **무영향**.

---

## 3. 아키텍처 결정 (승인 필요)

### D-1. Brand Registry 저장 방식

**Option A (권장)** — 신규 테이블 `enterprise_brand_registry`
- 명확한 template/instance 분리 (registry=템플릿, enterprise_accounts=인스턴스)
- 미 claim 상태에서도 admin 이 관리 가능
- 기존 enterprise_accounts 스키마 무변경 (원칙 준수)

Option B — enterprise_accounts 에 컬럼 추가 (사업자정보 + defaults)
- 스키마 확장. 기존 UI 회귀 검토 필요.

**결정**: Option A.

### D-2. 기존 invite code 시스템 처리

**Option A (권장)** — 그대로 유지, 병행 flow
- 기존 브랜드는 invite 로, 신규 브랜드는 registry 로
- 회귀 0

Option B — deprecate, 신규만
- 기존 UI 대량 수정 필요. 원칙 위반.

**결정**: Option A.

### D-3. 계약 자동 생성 시점

**Option A (권장)** — 가입 성공 즉시 (status='draft')
- 승인 시 status='active' 로 전환 (기존 admin_set_enterprise_contract_status 재사용)
- 사용자 spec 6 과 일치 ("가입 성공 시 자동 생성")

Option B — 승인 후 생성
- Race condition 리스크

**결정**: Option A.

### D-4. Brand Registry ↔ enterprise_accounts 연결 방식

**Option A (권장)** — enterprise_accounts 에 `brand_registry_id` 컬럼 추가 (additive, NULL 허용)
- 기존 계정 무영향 (NULL 이면 legacy)
- 신규 계정만 registry_id 참조

Option B — 신규 매핑 테이블
- 복잡성 증가

**결정**: Option A (단 하나의 additive 컬럼).

### D-5. 브랜드 코드 자동 생성 규칙

사용자 spec 예시:
- 쿠우쿠우 → KUU001
- 제로백PC → ZBP001
- 본죽 → BJK001

Regex 유추: **자음 첫 글자 3자 (없으면 로마자 첫 글자 3자) + 3자리 순차 번호**.
- 한글 → 초성 3자 (예: 쿠우쿠우 → ㅋㅇㅋ → KUU)
- 영문 → 대문자 첫 글자 3자 (예: PC → PC/ZBP)
- 숫자/특수문자 skip

이 로직은 SQL 함수로 구현 (한글 초성 분리 CASE 문). 중복 시 `_last_numeric + 1` loop.

---

## 4. 신규 DB 자산 (migration 0398)

### Tables (1개 신규)

```sql
create table enterprise_brand_registry (
  id                        uuid primary key,
  brand_name                text not null,           -- 브랜드명 (unique on lower(btrim))
  brand_code                text not null,           -- 브랜드코드 (unique on upper(btrim))
  business_name             text not null,           -- 사업자명
  business_registration_no  text,                    -- 사업자번호
  representative_name       text,                    -- 대표자
  manager_name              text not null,           -- 담당자
  manager_email             text not null,           -- 담당자 이메일
  manager_phone             text,                    -- 담당자 연락처
  business_address          text,                    -- 본사 주소
  default_monthly_fee       int  not null default 0, -- 기본 월 이용료
  default_store_price       int  not null default 4900, -- 기본 매장 단가
  default_commission_rate   numeric(5,2) default 0,  -- 기본 수수료율
  default_minimum_payout    int  default 0,          -- 기본 최소정산금
  default_settlement_method text not null default 'monthly' check (…),
  default_auto_renew        boolean not null default true,
  is_active                 boolean not null default true, -- 활성 여부
  created_by, updated_by, deleted_at, created_at, updated_at
);
```

### 컬럼 추가 (2개 additive)

```sql
alter table enterprise_accounts
  add column if not exists brand_registry_id uuid references enterprise_brand_registry(id),
  add column if not exists auto_onboarded    boolean not null default false;
```

### RPCs (10개 신규)

| # | RPC | 용도 | Gate |
|---|-----|------|------|
| 1 | `admin_generate_brand_code(text)` | 브랜드명 → 코드 자동 (초성 3자 + 001) | super_admin |
| 2 | `admin_create_brand_registry(...)` | 브랜드 등록 | super_admin |
| 3 | `admin_update_brand_registry(...)` | 수정 (brand_code 는 변경 불가) | super_admin |
| 4 | `admin_toggle_brand_registry_active(uuid,bool)` | 활성 토글 | super_admin |
| 5 | `admin_list_brand_registry(...)` | 목록 | super_admin |
| 6 | `admin_get_brand_registry(uuid)` | 상세 | super_admin |
| 7 | `validate_brand_registry_signup(brand_name, brand_code)` | 회원가입 시 검증 | **anon** (invite validate 패턴 재사용) |
| 8 | `claim_brand_registry_enterprise(brand_name, brand_code, business_info)` | 가입 성공 시 enterprise_accounts + contract 자동 생성 | authenticated |
| 9 | `admin_approve_brand_onboarding(enterprise_account_id)` | 승인 → active | super_admin |
| 10 | `admin_reject_brand_onboarding(enterprise_account_id, reason)` | 거절 → 연결 해제 | super_admin |

### Audit — 감사 이벤트 (모두 admin_log_operation 재사용)

- `brand.create` / `brand.update` / `brand.deactivate`
- `brand.signup` / `brand.match_ok` / `brand.match_fail`
- `brand.auto_contract_created`
- `brand.admin_approve` / `brand.admin_reject`

---

## 5. 신규 UI 자산

### 5.1 Admin Panel — `BrandRegistryPanel.tsx` (신규)

- `/admin → 브랜드 관리` 탭 (신규, super_admin only)
- 목록 (16 필드) + 등록/수정 modal + 승인 대기 목록
- 브랜드 등록 modal — 브랜드코드 자동 생성 버튼 (`admin_generate_brand_code`)
- 승인/거절 액션 → RPC 호출 + audit

### 5.2 Signup UI — `EnterpriseBrandSignupForm.tsx` (신규)

- LoginPage mode 추가: `signup-enterprise-brand`
- SignupTypeSelector 에 카드 1개 추가 ("Brand Registry 로 가입")
- 폼 필드: 브랜드명 / 브랜드코드 / 회사명 / 사업자번호 / 담당자명 / 이메일 / 비번 / 휴대폰
- Submit: `validate_brand_registry_signup` → `signUpWithPassword` → `claim_brand_registry_enterprise`

### 5.3 API wrapper — `enterpriseBrandRegistryApi.ts` (신규)

- 10개 RPC wrapper + type 정의

---

## 6. 예상 변경 파일 (11개)

| # | 파일 | 상태 | 라인 |
|---|------|------|------|
| 1 | `docs/PHASE3_2_BRAND_REGISTRY_ONBOARDING_KICKOFF.md` | 신규 | ~200 |
| 2 | `supabase/migrations/0398_enterprise_brand_registry_v1.sql` | 신규 | ~350 |
| 3 | `src/lib/api/enterpriseBrandRegistryApi.ts` | 신규 | ~220 |
| 4 | `src/components/admin/BrandRegistryPanel.tsx` | 신규 | ~500 |
| 5 | `src/components/auth/EnterpriseBrandSignupForm.tsx` | 신규 | ~230 |
| 6 | `src/components/auth/SignupTypeSelector.tsx` | 수정 | ~+30 |
| 7 | `src/pages/LoginPage.tsx` | 수정 | ~+40 (mode 추가 + form 렌더링) |
| 8 | `src/pages/AdminPage.tsx` | 수정 | ~+5 (탭 등록) |
| 9 | (Optional) `src/lib/pendingEnterpriseClaim.ts` | 수정 | ~+15 |

**총**: 신규 5, 수정 4, ~1,600 lines.

---

## 7. 회귀 영향 (원칙 검증)

| 항목 | 상태 |
|------|------|
| Settlement 계산식 (0372+0390) | ✋ 무영향 |
| Contract Snapshot (0390) | ✋ 무영향 |
| Cron / Dispatch / Policy | ✋ 무영향 |
| 기존 `enterprise_accounts` 컬럼 (brand_code, invite codes, status enum) | ✋ 무영향 (2 additive columns 만) |
| 기존 invite code onboarding (0363) | ✋ 무영향 — 병행 flow |
| 기존 UI (EnterpriseAccountsPanel, EnterpriseContractsPanel, EnterpriseHqSignupForm, EnterpriseStoreSignupForm) | ✋ 무영향 (파일 diff 0) |
| 신규 계정만 registry_id 참조. 기존 계정 NULL. | ✋ Legacy 무영향 |

---

## 8. 검증 계획

| 단계 | 항목 |
|------|------|
| Unit | `admin_generate_brand_code` 한글/영문/특수 케이스 테스트 |
| Unit | 브랜드명 불일치 / 코드 불일치 → validate 실패 |
| Integration | 성공 가입 → enterprise_account + contract 생성 확인 |
| Integration | 중복 가입 → 실패 |
| Integration | 이미 계약 존재 → 새 계약 생성 안 함 (ACTIVE 재사용) |
| Integration | 관리자 승인 → status='active', contract status='active' |
| Integration | 관리자 거절 → 연결 해제 (auth_user_id NULL) |
| Regression | 기존 invite code flow 정상 동작 |
| Regression | Settlement 생성 (Phase 3-1) 정상 |
| CI | lint:migrations / lint:tones / lint / typecheck / build |

---

## 9. 결정 요청

이 계획으로 착수해도 되는지 확인:

**Q1**: Brand Registry 를 신규 테이블 `enterprise_brand_registry` 로 하고, `enterprise_accounts` 는 2 additive 컬럼만 추가하는 접근이 맞나요? (권장 Option)

**Q2**: 기존 0363 invite code 시스템은 그대로 유지 + 병행으로 두는 것이 맞나요? (권장)

**Q3**: 브랜드 코드 자동 생성 규칙 — 초성 3자 + 001 순차 번호가 맞나요? 다른 규칙 있으면 알려주세요.

**Q4**: Phase 3-2 스코프 — 위 11 파일 전체 구현 (권장) vs 축소 (예: signup UI 는 Phase 3-3 로 분리, admin 만 이번에)?

승인 or 스코프 조정 지시 주시면 실제 구현 착수.
