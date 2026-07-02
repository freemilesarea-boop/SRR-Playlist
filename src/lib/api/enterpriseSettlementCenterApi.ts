/**
 * enterpriseSettlementCenterApi — Phase 3-1
 *
 * `/admin → 정산·청구 통합` 탭 전용 얇은 wrapper.
 * 기존 3개 API (enterpriseContractApi / enterpriseMonthlySettlementApi / enterpriseBillingApi)
 * 를 재사용 + Phase 3-1 신규 기능 (PDF, Email, Suspended, Center KPI) 만 추가.
 *
 * 절대 무수정:
 *   • 기존 wrapper 함수 시그니처 무관 — 이 파일에서 import 만 함.
 *   • Settlement 계산식 무관 — adminGenerate... 그대로 호출.
 *   • Contract/Billing 기존 RPC 무영향.
 */
import { supabase } from '@/lib/supabase';
import {
  adminGenerateEnterpriseMonthlySettlement,
  adminListEnterpriseMonthlySettlements,
  adminGetEnterpriseMonthlySettlement,
  currentMonthFirstDay,
  type EnterpriseMonthlySettlementRow,
  type EnterpriseMonthlySettlementDetail,
} from './enterpriseMonthlySettlementApi';
import {
  listEnterpriseContracts,
  getContractKpi,
  type EnterpriseContract,
  type ContractKpi,
} from './enterpriseContractApi';
import {
  listBillingInvoices,
  getBillingInvoiceDetail,
  type BillingInvoice,
  type BillingInvoiceDetail,
  type BillingInvoiceStatus,
} from './enterpriseBillingApi';

// ============================================================================
// Types
// ============================================================================

/**
 * 사용자 spec 상태 (UI 표시용, DB 값 매핑).
 *   ACTIVE = active | expiring
 *   EXPIRED = expired
 *   PENDING = draft
 *   SUSPENDED = metadata.suspended_at != null (enum 무관)
 *   TERMINATED = terminated
 */
export type ContractDisplayStatus =
  | 'ACTIVE' | 'EXPIRED' | 'PENDING' | 'SUSPENDED' | 'TERMINATED';

export function toDisplayContractStatus(
  raw: EnterpriseContract['status'],
  metadata: Record<string, unknown> | null | undefined,
): ContractDisplayStatus {
  if (metadata && (metadata as Record<string, unknown>).suspended_at) return 'SUSPENDED';
  switch (raw) {
    case 'active':
    case 'expiring':   return 'ACTIVE';
    case 'expired':    return 'EXPIRED';
    case 'terminated': return 'TERMINATED';
    case 'draft':      return 'PENDING';
    default:           return 'PENDING';
  }
}

/** Settlement / Billing status 통합 badge (사용자 spec). */
export type UnifiedBillingStatus =
  | 'DRAFT' | 'GENERATED' | 'SENT' | 'PAID' | 'FAILED';

export function toDisplayBillingStatus(raw: BillingInvoiceStatus): UnifiedBillingStatus {
  switch (raw) {
    case 'draft':     return 'DRAFT';
    case 'issued':    return 'SENT';
    case 'paid':      return 'PAID';
    case 'overdue':   return 'FAILED';
    case 'cancelled': return 'DRAFT';
    case 'failed':    return 'FAILED';
    default:          return 'GENERATED';
  }
}

// ============================================================================
// Contract Snapshot preview (Generate Settlement modal 용)
// ============================================================================

export interface SnapshotPreview {
  contract_id: string;
  contract_no: string;
  contract_start_date: string;
  contract_end_date: string | null;
  monthly_store_price: number;
  commission_rate: number;
  minimum_payout: number;
  settlement_method: string;
  auto_renew: boolean;
  metadata_suspended_at: string | null;
}

/**
 * 특정 enterprise 의 활성 계약 스냅샷 미리보기. Modal 에서 청구금액 미리 보기용.
 * 이미 존재하는 admin_list_enterprise_contracts (status='active') 를 재사용.
 * 새 계산식 없음.
 */
export async function fetchActiveContractPreview(
  enterpriseAccountId: string,
): Promise<SnapshotPreview | null> {
  const list = await listEnterpriseContracts({
    enterpriseAccountId,
    status: 'active',
    limit: 1,
  });
  const row = list.data?.[0];
  if (!row) return null;
  return {
    contract_id:            row.id,
    contract_no:            row.contract_no,
    contract_start_date:    row.start_date,
    contract_end_date:      row.end_date,
    monthly_store_price:    row.monthly_store_price ?? 0,
    commission_rate:        Number(row.commission_rate ?? 0),
    minimum_payout:         row.minimum_payout ?? 0,
    settlement_method:      row.settlement_method ?? 'monthly',
    auto_renew:             row.auto_renew,
    metadata_suspended_at:  ((row as { metadata?: { suspended_at?: string } }).metadata?.suspended_at ?? null),
  };
}

// ============================================================================
// Generate Settlement (기존 로직 그대로 호출, 얇은 wrapper)
// ============================================================================

export interface GenerateSettlementInput {
  /** YYYY-MM-01 */
  month: string;
  /** null 이면 전체 enterprise 대상. */
  enterpriseAccountId?: string | null;
}

/**
 * 기존 admin_generate_enterprise_monthly_settlement 를 그대로 호출.
 * 새 계산식 없음. Snapshot 은 이미 0390 에서 저장됨.
 */
export async function generateEnterpriseSettlement(input: GenerateSettlementInput) {
  return adminGenerateEnterpriseMonthlySettlement(input.month);
}

// ============================================================================
// KPI 집계 (Billing Dashboard 카드)
// ============================================================================

export interface BillingCenterKpi {
  this_month_expected_count: number;   // 이번달 청구 예정 (draft)
  this_month_generated_count: number;  // 이번달 생성 완료 (issued+paid)
  unpaid_count: number;                // 미납 (issued or overdue, paid 아님)
  paid_count: number;                  // 완납
  next_due_date: string | null;        // 다음 청구일 = 가장 빠른 미납 due_date
  total_contract_amount: number;       // 총 계약금액 (활성 계약의 monthly_store_price 합)
  expected_bill_amount: number;        // 예상 청구액 (이번달 draft/issued 합)
  enterprise_count: number;            // 총 Enterprise 수 (활성 계약 기준)
  recent_settlements: EnterpriseMonthlySettlementRow[];
}

/**
 * Billing Dashboard KPI 집계. RPC 조회 결과를 client 에서 산술 조합만 함.
 * 신규 RPC 없음. 총 계약금액은 활성 계약(monthly_store_price) 리스트 합산.
 */
export async function fetchBillingCenterKpi(): Promise<BillingCenterKpi> {
  const monthStart = currentMonthFirstDay();

  const [thisMonthList, allIssuedList, kpi, activeContracts, recent] = await Promise.all([
    listBillingInvoices({ billingMonth: monthStart, limit: 200 }),
    listBillingInvoices({ status: 'issued', limit: 200 }),
    getContractKpi(),
    listEnterpriseContracts({ status: 'active', limit: 500 }),
    adminListEnterpriseMonthlySettlements({ limit: 5 }),
  ]);

  const invoices = thisMonthList.data ?? [];
  const expected = invoices.filter((i) => i.status === 'draft').length;
  const generated = invoices.filter(
    (i) => i.status === 'issued' || i.status === 'paid',
  ).length;
  const unpaid = (allIssuedList.data ?? []).filter((i) => i.status !== 'paid').length;
  const paid = invoices.filter((i) => i.status === 'paid').length;

  const dueCandidates = (allIssuedList.data ?? [])
    .map((i) => i.due_date)
    .filter((d): d is string => !!d)
    .sort();
  const nextDue = dueCandidates[0] ?? null;

  const expectedBillAmount = invoices
    .filter((i) => i.status === 'draft' || i.status === 'issued')
    .reduce((acc, i) => acc + (i.total_amount ?? 0), 0);

  const totalContractAmount = (activeContracts.data ?? []).reduce(
    (acc, c) => acc + (c.monthly_store_price ?? 0),
    0,
  );

  return {
    this_month_expected_count: expected,
    this_month_generated_count: generated,
    unpaid_count: unpaid,
    paid_count: paid,
    next_due_date: nextDue,
    total_contract_amount: totalContractAmount,
    expected_bill_amount: expectedBillAmount,
    enterprise_count: kpi.active_contracts ?? 0,
    recent_settlements: (recent.rows ?? []).slice(0, 5),
  };
}

// ============================================================================
// PDF (edge function 트리거)
// ============================================================================

export interface GenerateInvoicePdfResult {
  ok: boolean;
  invoice_id?: string;
  pdf_storage_path?: string;
  pdf_signed_url?: string;
  pdf_signed_expires_in?: number;
  duration_ms?: number;
  error?: string;
  message?: string;
}

export async function generateInvoicePdf(invoiceId: string): Promise<GenerateInvoicePdfResult> {
  const { data, error } = await supabase.functions.invoke('generate-enterprise-billing-pdf', {
    body: { invoice_id: invoiceId },
  });
  if (error) return { ok: false, error: error.message };
  return (data ?? { ok: false, error: 'no_response' }) as GenerateInvoicePdfResult;
}

// ============================================================================
// Email (RPC 로 job 생성 + edge function 발송)
// ============================================================================

export interface CreateEmailJobResult {
  success: boolean;
  job_id: string;
  invoice_id: string;
  to_email: string;
  send_count_before: number;
}

export async function createBillingEmailJob(
  invoiceId: string, toEmail: string, ccEmails?: string[],
): Promise<CreateEmailJobResult> {
  const { data, error } = await supabase.rpc('admin_create_billing_email_job', {
    p_invoice_id: invoiceId, p_to_email: toEmail, p_cc_emails: ccEmails ?? null,
  });
  if (error) throw error;
  return data as CreateEmailJobResult;
}

export interface DispatchEmailResult {
  ok: boolean;
  job_id: string;
  status?: 'sent' | 'failed';
  resend_id?: string;
  error_message?: string;
  duration_ms?: number;
  error?: string;
  message?: string;
}

export async function dispatchBillingInvoiceEmail(jobId: string): Promise<DispatchEmailResult> {
  const { data, error } = await supabase.functions.invoke('dispatch-enterprise-billing-invoice', {
    body: { job_id: jobId },
  });
  if (error) return { ok: false, job_id: jobId, error: error.message };
  return (data ?? { ok: false, job_id: jobId, error: 'no_response' }) as DispatchEmailResult;
}

export interface EmailJobRow {
  id: string;
  invoice_id: string;
  to_email: string;
  cc_emails: string[] | null;
  resend_id: string | null;
  status: 'pending' | 'sent' | 'failed';
  error_message: string | null;
  retry_count: number;
  created_at: string;
  sent_at: string | null;
}

export async function listBillingEmailJobs(invoiceId: string): Promise<EmailJobRow[]> {
  const { data, error } = await supabase.rpc('admin_list_billing_email_jobs', {
    p_invoice_id: invoiceId,
  });
  if (error) throw error;
  return ((data as { jobs?: EmailJobRow[] })?.jobs ?? []) as EmailJobRow[];
}

// ============================================================================
// Contract Suspended toggle
// ============================================================================

export interface SetContractSuspendedResult {
  success: boolean;
  contract_id: string;
  suspended: boolean;
  suspended_at: string | null;
  suspended_reason: string | null;
}

export async function setContractSuspended(
  contractId: string, suspended: boolean, reason?: string,
): Promise<SetContractSuspendedResult> {
  const { data, error } = await supabase.rpc('admin_set_contract_suspended', {
    p_contract_id: contractId, p_suspended: suspended, p_reason: reason ?? null,
  });
  if (error) throw error;
  return data as SetContractSuspendedResult;
}

// ============================================================================
// Re-exports (편의)
// ============================================================================
export type { EnterpriseMonthlySettlementRow, EnterpriseMonthlySettlementDetail };
export type { EnterpriseContract, ContractKpi };
export type { BillingInvoice, BillingInvoiceDetail, BillingInvoiceStatus };
export { adminGetEnterpriseMonthlySettlement, getBillingInvoiceDetail };
