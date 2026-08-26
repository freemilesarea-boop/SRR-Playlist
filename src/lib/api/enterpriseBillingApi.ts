/**
 * enterpriseBillingApi — Enterprise Billing Management V1 (Priority 6).
 *
 * "본사 → 우리" 청구/인보이스 wrapper.
 * 기존 "우리 → 본사" 지급 (enterpriseMonthlySettlementApi) 와 완전 분리.
 *
 * SQL: supabase/migrations/0382_enterprise_billing_invoices_v1.sql
 */
import { supabase } from '@/lib/supabase';

export type BillingInvoiceStatus =
  | 'draft' | 'issued' | 'paid' | 'overdue' | 'cancelled' | 'failed';

export type BillingInvoiceItemType =
  | 'store_subscription' | 'discount' | 'adjustment' | 'tax';

export interface BillingInvoice {
  id: string;
  enterprise_account_id: string;
  enterprise_name: string | null;
  manager_email: string | null;
  manager_name: string | null;
  billing_month: string;            // YYYY-MM-01
  active_store_count: number;
  monthly_store_price: number;
  subtotal_amount: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  currency: string;
  status: BillingInvoiceStatus;
  due_date: string | null;
  issued_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  payment_reference: string | null;
  payment_method: string | null;
  memo: string | null;
  metadata: Record<string, unknown>;
  item_count: number;
  created_at: string;
  updated_at: string;
}

export interface BillingInvoiceItem {
  id: string;
  invoice_id: string;
  store_id: string | null;
  store_name: string | null;
  region_id: string | null;
  region_name: string | null;
  unit_price: number;
  quantity: number;
  amount: number;
  item_type: BillingInvoiceItemType;
  memo: string | null;
  created_at: string;
}

export interface BillingInvoiceDetail {
  success: boolean;
  invoice: BillingInvoice;
  items: BillingInvoiceItem[];
  computed_at: string;
}

export interface BillingInvoicesListParams {
  search?: string | null;
  status?: BillingInvoiceStatus | null;
  billingMonth?: string | null;     // YYYY-MM-01
  enterpriseAccountId?: string | null;
  overdueOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface BillingInvoicesListResponse {
  success: boolean;
  data: BillingInvoice[];
  pagination: { total: number; limit: number; offset: number; has_more: boolean };
  computed_at: string;
}

export interface BillingGenerateParams {
  billingMonth: string;                     // YYYY-MM-01
  enterpriseAccountId?: string | null;
  dueDate?: string | null;
  taxRate?: number;
  overwrite?: boolean;
}

export interface BillingGenerateResult {
  success: boolean;
  billing_month: string;
  created_count: number;
  overwritten_count: number;
  skipped_count: number;
  total_amount: number;
  errors: Array<{ enterprise_account_id: string; reason: string; existing_status?: string }>;
}

export interface BillingHqSummary {
  success: boolean;
  enterprise_account_id: string;
  this_month: string;
  current_invoice: (BillingInvoice & { is_overdue: boolean }) | null;
  recent_invoices: BillingInvoice[];
  active_store_count: number;
  monthly_store_price: number;
  computed_at: string;
}

// =============================================================================
// Admin RPCs
// =============================================================================

export async function generateBillingInvoice(params: BillingGenerateParams): Promise<BillingGenerateResult> {
  const { data, error } = await supabase.rpc('admin_generate_enterprise_billing_invoice', {
    p_billing_month:         params.billingMonth,
    p_enterprise_account_id: params.enterpriseAccountId ?? null,
    p_due_date:              params.dueDate ?? null,
    p_tax_rate:              params.taxRate ?? 0,
    p_overwrite:             params.overwrite ?? false,
  });
  if (error) { console.error('[billingApi] generate failed', error); throw error; }
  return data as BillingGenerateResult;
}

export async function listBillingInvoices(
  params: BillingInvoicesListParams = {},
): Promise<BillingInvoicesListResponse> {
  const { data, error } = await supabase.rpc('admin_list_enterprise_billing_invoices', {
    p_search:                params.search ?? null,
    p_status:                params.status ?? null,
    p_billing_month:         params.billingMonth ?? null,
    p_enterprise_account_id: params.enterpriseAccountId ?? null,
    p_overdue_only:          params.overdueOnly ?? false,
    p_limit:                 params.limit ?? 50,
    p_offset:                params.offset ?? 0,
  });
  if (error) { console.error('[billingApi] list failed', error); throw error; }
  return data as BillingInvoicesListResponse;
}

export async function getBillingInvoiceDetail(invoiceId: string): Promise<BillingInvoiceDetail> {
  const { data, error } = await supabase.rpc('admin_get_enterprise_billing_invoice_detail', {
    p_invoice_id: invoiceId,
  });
  if (error) { console.error('[billingApi] detail failed', error); throw error; }
  return data as BillingInvoiceDetail;
}

export async function issueBillingInvoice(
  invoiceId: string, dueDate?: string | null,
): Promise<{ success: boolean; invoice_id: string; status: BillingInvoiceStatus }> {
  const { data, error } = await supabase.rpc('admin_issue_enterprise_billing_invoice', {
    p_invoice_id: invoiceId, p_due_date: dueDate ?? null,
  });
  if (error) { console.error('[billingApi] issue failed', error); throw error; }
  return data as { success: boolean; invoice_id: string; status: BillingInvoiceStatus };
}

export async function markBillingInvoicePaid(
  invoiceId: string,
  opts: { paymentReference?: string | null; paymentMethod?: string | null; paidAt?: string | null } = {},
): Promise<{ success: boolean; invoice_id: string; status: BillingInvoiceStatus; previous_status: BillingInvoiceStatus }> {
  const { data, error } = await supabase.rpc('admin_mark_enterprise_billing_invoice_paid', {
    p_invoice_id:        invoiceId,
    p_payment_reference: opts.paymentReference ?? null,
    p_payment_method:    opts.paymentMethod ?? null,
    p_paid_at:           opts.paidAt ?? null,
  });
  if (error) { console.error('[billingApi] paid failed', error); throw error; }
  return data as { success: boolean; invoice_id: string; status: BillingInvoiceStatus; previous_status: BillingInvoiceStatus };
}

export async function cancelBillingInvoice(
  invoiceId: string, memo?: string | null,
): Promise<{ success: boolean; invoice_id: string; status: BillingInvoiceStatus; previous_status: BillingInvoiceStatus }> {
  const { data, error } = await supabase.rpc('admin_cancel_enterprise_billing_invoice', {
    p_invoice_id: invoiceId, p_memo: memo ?? null,
  });
  if (error) { console.error('[billingApi] cancel failed', error); throw error; }
  return data as { success: boolean; invoice_id: string; status: BillingInvoiceStatus; previous_status: BillingInvoiceStatus };
}

export async function markBillingInvoicesOverdue(
  asOf?: string | null,
): Promise<{ success: boolean; as_of: string; marked_count: number }> {
  const { data, error } = await supabase.rpc('admin_mark_enterprise_billing_overdue', {
    p_as_of: asOf ?? null,
  });
  if (error) { console.error('[billingApi] overdue failed', error); throw error; }
  return data as { success: boolean; as_of: string; marked_count: number };
}

export async function updateBillingInvoiceAdjustments(
  invoiceId: string,
  patch: { discountAmount?: number | null; taxAmount?: number | null; memo?: string | null },
): Promise<{ success: boolean; invoice_id: string; discount_amount: number; tax_amount: number; total_amount: number }> {
  const { data, error } = await supabase.rpc('admin_update_enterprise_billing_invoice_adjustments', {
    p_invoice_id:      invoiceId,
    p_discount_amount: patch.discountAmount ?? null,
    p_tax_amount:      patch.taxAmount ?? null,
    p_memo:            patch.memo ?? null,
  });
  if (error) { console.error('[billingApi] adjust failed', error); throw error; }
  return data as { success: boolean; invoice_id: string; discount_amount: number; tax_amount: number; total_amount: number };
}

// =============================================================================
// 일괄청구(consolidated billing) — 토글 + 실시간 청구예정액
// SQL: supabase/migrations/0479_enterprise_consolidated_billing.sql
// =============================================================================

export interface ConsolidatedBillingPreviewRow {
  enterprise_account_id: string;
  enterprise_name: string | null;
  brand_code: string | null;
  consolidated_billing_enabled: boolean;
  active_store_count: number;
  monthly_store_price: number;
  projected_amount: number;              // 활성매장 × 단가 (실시간)
  current_month: string;                 // YYYY-MM-01
  current_invoice_id: string | null;
  current_invoice_status: BillingInvoiceStatus | null;
  current_invoice_total: number | null;
}

/** 활성 본사별 실시간 청구예정액 + 일괄청구 on/off 상태 (관리자 전용). */
export async function getConsolidatedBillingPreview(): Promise<ConsolidatedBillingPreviewRow[]> {
  const { data, error } = await supabase.rpc('admin_enterprise_consolidated_billing_preview');
  if (error) { console.error('[billingApi] consolidated preview failed', error); throw error; }
  return (data ?? []) as ConsolidatedBillingPreviewRow[];
}

/** 브랜드(본사) 일괄청구 대상 on/off 토글 (관리자 전용). */
export async function setEnterpriseConsolidatedBilling(
  enterpriseAccountId: string,
  enabled: boolean,
): Promise<{ success: boolean; enterprise_account_id: string; enabled: boolean }> {
  const { data, error } = await supabase.rpc('admin_set_enterprise_consolidated_billing', {
    p_enterprise_account_id: enterpriseAccountId,
    p_enabled:               enabled,
  });
  if (error) { console.error('[billingApi] set consolidated failed', error); throw error; }
  return data as { success: boolean; enterprise_account_id: string; enabled: boolean };
}

// =============================================================================
// HQ read-only
// =============================================================================

export async function getMyEnterpriseBillingSummary(): Promise<BillingHqSummary> {
  const { data, error } = await supabase.rpc('get_my_enterprise_billing_summary');
  if (error) { console.error('[billingApi] hq summary failed', error); throw error; }
  return data as BillingHqSummary;
}
