# Phase 3-1 킥오프 — Enterprise Contract & Billing 완성 + Generate Settlement 활성화

**상태**: **킥오프 (승인 대기)**. 코드 변경 없음. 계획 검토용.

**목표**: `/admin → 운영 관제` Quick Actions 의 비활성화된 QA-5 (Generate Settlement) 를
실제 운영 가능한 수준으로 활성화. 계약 스냅샷 freeze, PDF, Email, Audit 를 완성.

**핵심 원칙**:
1. 기존 Settlement 계산 로직 (0372, 0390) **절대 무수정**
2. 기존 Snapshot 구조 (0390) **재사용**
3. 기존 Cron / Dispatch / Policy 기능 **무영향**
4. Enterprise 전용 UI + Billing Flow **만 추가**
5. 회귀 0 — 기존 EnterpriseMonthlySettlementsPanel / ContractsPanel / BillingPanel 손대지 않음

---

## 1. 인벤토리 요약 (재사용 대상)

### 1.1 Settlement (Phase 1-11, migration 0372 + 0390) — 완성
- Table: `enterprise_monthly_settlements` + `_items` (0372:23, 0372:94)
- Generate RPC: `admin_generate_enterprise_monthly_settlement(p_month date)` (0372:148, 0390 재작성)
- Snapshot 컬럼 **이미 존재** (0390:41 추가): `contract_id, contract_no, contract_start_date, contract_end_date, contract_version, minimum_payout, settlement_method, rate_source, monthly_store_price, commission_rate, active_store_count`
- Status enum: `pending / approved / paid / cancelled` (0372:35)
- Client wrapper: `src/lib/api/enterpriseMonthlySettlementApi.ts` (`adminGenerateEnterpriseMonthlySettlement` L149)
- UI (기존): `src/components/admin/EnterpriseMonthlySettlementsPanel.tsx` (661줄, 완성)

### 1.2 Contract (Phase 4-12, migration 0383) — 완성
- Table: `enterprise_contracts` (0383:44), files (0383:77)
- RPC: list/get/create/update/set_status/soft_delete/kpi (0383:291~657)
- Status enum: `draft / active / expiring / expired / terminated`
- Client wrapper: `src/lib/api/enterpriseContractApi.ts` (302줄)
- UI (기존): `src/components/admin/EnterpriseContractsPanel.tsx` (678줄, 완성)

### 1.3 Billing (Priority 6, migration 0382) — 완성
- Table: `enterprise_billing_invoices` + `_items` (0382:39, 0382:79)
- RPC: generate/list/detail/issue/paid/cancel/overdue/adjust/hq_summary (0382:175~674)
- Status enum: `draft / issued / paid / overdue / cancelled / failed`
- Client wrapper: `src/lib/api/enterpriseBillingApi.ts` (219줄)
- UI (기존): `src/components/admin/EnterpriseBillingPanel.tsx` (698줄, 완성)
- **부재**: `pdf_url` 컬럼, 이메일 발송 이력 저장소, 재발송 기능

### 1.4 QA-5 Generate Settlement 현재 상태
- `EnterpriseOperationsPanel.tsx:585-589` — `disabled: { reason: 'Phase 2-3 에서 활성화 예정' }`
- `switch (a.key)` 에 `case 'generate_settlement'` 없음 → `default: {ok:false, error:'disabled'}`
- Wrapper `adminGenerateEnterpriseMonthlySettlement(monthYyyyMmDd)` 이미 존재 → 얇은 QA wrapper 만 필요

### 1.5 PDF / Email 인프라
- **PDF**: `package.json` 에 라이브러리 **부재** (pdfkit/jspdf/pdf-lib 없음). 신규 도입 필요.
- **Email**: Resend 인프라 완비. `dispatch-contract-emails` 패턴 재사용.
- **Storage**: `enterprise-contracts` (0394 private 버킷) 패턴 재사용 가능.

### 1.6 Audit
- `admin_log_operation` RPC 재사용. `source='enterprise_operations'` 유지, `category='quick_action.generate_settlement'` 등 신규 문자열.

---

## 2. 사용자 spec 매핑 (실제 무엇을 만들 것인지)

| Spec 섹션 | 재사용 | 신규 필요 | 판정 |
|-----------|--------|-----------|------|
| 1. Contract 목록 (16 필드) | 기존 `EnterpriseContractsPanel.tsx` | 없음 (라벨 매핑만) | 기존 재사용 |
| 2. Contract 상세 + Snapshot Card | 기존 상세 modal | **Snapshot Card 추가** (계약값 freeze 표시) | UI 확장 |
| 3. Billing Dashboard | 기존 `EnterpriseBillingPanel` | **KPI 카드 추가** (예상 청구액, 총 계약금액 등) | UI 확장 |
| 4. Generate Settlement modal | 없음 | **신규 modal** (enterprise 선택 + 월 선택 + snapshot 미리보기) | UI 신규 |
| 5. Settlement 생성 (snapshot freeze) | 기존 `admin_generate_enterprise_monthly_settlement` | **Snapshot 이미 저장됨 (0390)** → 표시 UI 만 신규 | 표시 신규 |
| 6. Billing History (상태 5종) | 기존 리스트 RPC | **PDF/Email 컬럼 표시** | UI 확장 |
| 7. PDF 생성 | 없음 | **신규 edge function + Storage 버킷 + PDF 라이브러리** | 신규 |
| 8. Email 발송 (재발송 + 이력) | Resend 인프라 | **신규 edge function + `settlement_invoice_email_jobs` 테이블** | 신규 |
| 9. Audit Log (5 이벤트) | `admin_log_operation` | **QA-5 client audit + 3 category 추가** | 신규 (얇음) |
| 10. 검증 | — | build/lint/typecheck | 절차 |

**요약**: 6개 섹션 중 **4개는 기존 재사용/확장**, 신규 큰 덩어리는 **PDF (7)** + **Email (8)** + **Generate modal (4)**.

---

## 3. 아키텍처 결정 (승인 필요)

### D-1. PDF 생성 위치 — **서버 사이드 권장**

**Option A**: Client-side (jsPDF, ~50KB gzip)
- Pro: 즉시 다운로드, 서버 리소스 0
- Con: 한글 폰트 embed 필요 (~1MB), 재발송 지원 불가, 이메일 첨부 불가

**Option B (권장)**: Edge Function (Deno + `pdf-lib` via esm.sh)
- Pro: PDF 를 Storage 에 저장 → 재발송 가능 + 이메일 첨부 가능
- Pro: 한글 폰트 서버 상주
- Con: 신규 edge function + 신규 Storage 버킷 + 한 번의 콜드 스타트 지연

**결정**: Option B (재발송 요구사항이 있으므로 Storage 저장이 필수).

### D-2. Contract Status enum — **UI 매핑만, 마이그레이션 없음 권장**

사용자 spec 5 상태 (ACTIVE / EXPIRED / PENDING / SUSPENDED / TERMINATED) 를 기존 5 상태 (draft / active / expiring / expired / terminated) 로 매핑:

| Spec | DB 현재값 | 매핑 방식 |
|------|-----------|-----------|
| ACTIVE | `active`, `expiring` | UI badge "ACTIVE" (`expiring` 는 "만료 임박" hint 병기) |
| EXPIRED | `expired` | UI badge "EXPIRED" |
| PENDING | `draft` | UI badge "PENDING" |
| SUSPENDED | (없음) | **UI-only 상태** — `metadata.suspended_at` jsonb 필드로 확장 (enum 무변경, 회귀 0) |
| TERMINATED | `terminated` | UI badge "TERMINATED" |

**결정**: enum 변경 없음. SUSPENDED 는 `metadata.suspended_at` jsonb + 새 RPC 매개변수로 처리. 기존 UI 회귀 0.

### D-3. Settlement Status ↔ Billing History 통합 — **분리 유지 권장**

사용자 spec 6 (Billing History with DRAFT/GENERATED/SENT/PAID/FAILED) 은 개념적으로 **Billing invoice** 목록. 기존 두 개념:
- **Settlement** (본사→우리 정산금 계산) — `enterprise_monthly_settlements` (0372)
- **Billing** (우리→본사 청구서 발행) — `enterprise_billing_invoices` (0382)

두 개는 별개 테이블/RPC. Spec 5 "Settlement 생성" 은 정산 (0372) 을, Spec 7-8 "청구서 PDF/Email" 은 billing (0382) 를 가리키는 것으로 해석.

**결정**: Spec 4-5 (Generate Settlement) 는 정산 rows 를 생성. Spec 6-8 (History/PDF/Email) 은 billing invoices 를 렌더링. UI 상에서만 통합 view 제공.

### D-4. 이메일 발송 이력 — **신규 테이블**

- 신규: `enterprise_billing_email_jobs` (invoice_id, to_email, sent_at, resend_id, status, error, retry_count)
- 신규 edge function: `dispatch-enterprise-billing-invoice` (Resend, `dispatch-contract-emails` 패턴 복사)

### D-5. 통합 UI 배치 — **새 탭 하나만**

- 신규 탭: `/admin → 정산·청구 통합` (Enterprise Settlement Center)
- 파일: `src/components/admin/EnterpriseSettlementCenterPanel.tsx` (신규)
- 3-tab 구조:
  - `계약` — 기존 `EnterpriseContractsPanel` embed + Snapshot card 확장
  - `정산` — 기존 `EnterpriseMonthlySettlementsPanel` embed + Generate 통합 modal
  - `청구서` — 기존 `EnterpriseBillingPanel` embed + PDF/Email 컬럼 확장
- 기존 3개 개별 탭은 유지 (회귀 0)

---

## 4. 변경 파일 목록 (예상)

### 신규 (n=8)
| 파일 | 라인 예상 |
|------|----------|
| `supabase/migrations/0397_enterprise_billing_pdf_email_v1.sql` | ~140 (테이블 2, RPC 4) |
| `supabase/functions/dispatch-enterprise-billing-invoice/index.ts` | ~180 (Resend + PDF fetch + audit) |
| `supabase/functions/generate-enterprise-billing-pdf/index.ts` | ~220 (pdf-lib + Storage 업로드) |
| `src/lib/api/enterpriseSettlementCenterApi.ts` | ~250 (wrapper 통합) |
| `src/components/admin/EnterpriseSettlementCenterPanel.tsx` | ~350 (3-tab 통합 프레임) |
| `src/components/admin/settlement/GenerateSettlementModal.tsx` | ~280 (Modal + 미리보기) |
| `src/components/admin/settlement/ContractSnapshotCard.tsx` | ~120 |
| `src/components/admin/settlement/BillingKpiCards.tsx` | ~100 |

### 수정 (n=3)
| 파일 | 변경 |
|------|------|
| `src/components/admin/EnterpriseOperationsPanel.tsx` | QUICK_ACTIONS 에서 `generate_settlement.disabled` 제거 + switch case 추가 + Modal 트리거 |
| `src/lib/api/enterpriseOperationsApi.ts` | `generateEnterpriseSettlement()` wrapper 추가 (audit + generate RPC 호출) |
| `src/pages/AdminPage.tsx` | 신규 탭 추가 (기존 3 탭은 유지, 회귀 0) |

**총 예상: 11 파일, ~1,600 lines** (신규 8, 수정 3).

---

## 5. 마이그레이션 0397 상세 (계획)

```sql
-- 0397_enterprise_billing_pdf_email_v1.sql (신규만, 기존 컬럼/RPC 무수정)

-- (A) 청구서 PDF url + 최종 발송 시각 컬럼 additive
alter table public.enterprise_billing_invoices
  add column if not exists pdf_url text,
  add column if not exists pdf_generated_at timestamptz,
  add column if not exists last_email_sent_at timestamptz,
  add column if not exists email_send_count int not null default 0;

-- (B) 이메일 발송 이력 (재발송 이력 저장)
create table if not exists public.enterprise_billing_email_jobs (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references enterprise_billing_invoices(id) on delete cascade,
  to_email text not null,
  cc_emails text[],
  resend_id text,
  status text not null check (status in ('pending','sent','failed')) default 'pending',
  error_message text,
  retry_count int not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index on enterprise_billing_email_jobs(invoice_id, created_at desc);

-- (C) super_admin PDF 생성 트리거 RPC (edge function 이 호출)
create or replace function public.admin_mark_billing_invoice_pdf(
  p_invoice_id uuid, p_pdf_url text
) returns void ...

-- (D) 이메일 job 생성 RPC
create or replace function public.admin_create_billing_email_job(
  p_invoice_id uuid, p_to_email text, p_cc_emails text[]
) returns uuid ...

-- (E) 이메일 job 결과 반영 RPC
create or replace function public.admin_finalize_billing_email_job(
  p_job_id uuid, p_resend_id text, p_status text, p_error text
) returns void ...

-- (F) Contract SUSPENDED metadata helper (enum 무변경)
create or replace function public.admin_set_contract_suspended(
  p_contract_id uuid, p_suspended boolean, p_reason text
) returns jsonb ...
```

- 기존 컬럼/RPC/제약 **무수정**
- 기존 rows 무영향 (신규 컬럼 default null / 0)

---

## 6. 검증 계획

| 단계 | 조치 |
|------|------|
| 1 | `npm run lint:migrations` — 0397 duplicate prefix 없음 |
| 2 | `npm run lint:tones` — 새 UI clean |
| 3 | `npm run lint` — 0 warnings |
| 4 | `npm run typecheck` — 0 errors |
| 5 | `npm run build` — success |
| 6 | 0397 dry-run BEGIN/ROLLBACK (Supabase SQL editor) |
| 7 | 기존 3 개 UI panel (`EnterpriseContractsPanel`, `EnterpriseMonthlySettlementsPanel`, `EnterpriseBillingPanel`) 회귀 확인 — diff 0 |
| 8 | Cron / Dispatch / Policy 파일 diff 0 확인 |
| 9 | 로컬 Chromium — Generate Settlement modal 흐름 dry-run |

---

## 7. 리스크 & 완화

| 리스크 | 완화 |
|--------|------|
| PDF pdf-lib 한글 폰트 이슈 | Noto Sans KR embed (base64 or `esm.sh` cdn); 초기 지원 폰트 1개만 |
| Storage 버킷 신규 정책 오설정 | 기존 `enterprise-contracts` 정책 그대로 복사 |
| 재발송 스팸 | client-side 10초 debounce + `email_send_count >= 3` 이면 super_admin 재승인 요구 |
| Contract SUSPENDED 상태 UI 필터링 회귀 | 기존 `admin_list_enterprise_contracts` 무수정, SUSPENDED 는 metadata.suspended_at 있는 것만 UI 에서 재분류 |
| edge function cold start | pdf-lib esm 캐시 warmup 첫 호출 1회만 지연 |
| Snapshot freeze 오판 | 이미 0390 에서 저장 중 — 신규 저장 로직 없음 |

---

## 8. Phase 3-2 (후속) 후보 스코프

- 청구서 배치 발송 (여러 invoice 을 한 번에 이메일)
- 자동 청구 스케줄 (매월 1일 cron)
- 청구서 발송 실패 알림 (Slack)
- 정산 상태 이력 timeline UI

---

## 9. 결정 요청

이 계획으로 착수해도 되는지 확인 필요. 특히:

**Q1. PDF 방식**
- **Option A (권장)**: Edge Function + pdf-lib + Storage
- Option B: Client-side jsPDF (재발송 없음)

**Q2. Contract SUSPENDED 상태**
- **Option A (권장)**: metadata.suspended_at (enum 무변경)
- Option B: enum 확장 (migration 필요, 기존 UI 회귀 검토 필요)

**Q3. UI 배치**
- **Option A (권장)**: 신규 `정산·청구 통합` 탭 하나 + 기존 3 탭 유지
- Option B: 기존 3 탭에 각각 확장 삽입 (Snapshot Card, Modal, PDF 컬럼)

**Q4. Phase 3-1 스코프**
- **Option A (권장)**: 위 8 신규 + 3 수정 파일 전체
- Option B: PDF/Email 을 Phase 3-2 로 미루고 Generate Settlement Modal + Snapshot Card + Audit 만 활성화 (스코프 절반)

승인 or 스코프 조정 지시 주시면 그에 맞춰 실제 구현 착수.
