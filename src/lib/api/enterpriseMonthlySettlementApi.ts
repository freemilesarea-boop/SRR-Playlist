/**
 * enterpriseMonthlySettlementApi — Phase 1-11
 *
 * 본사 월 정산 스냅샷 + 매장 단위 근거.
 * 실시간 재계산 없음. admin 가 generate 시점의 값으로 영구 보관.
 *
 * SQL: supabase/migrations/0372_enterprise_monthly_settlement.sql
 */
import { supabase } from '@/lib/supabase';

// =============================================================================
// Types
// =============================================================================

export type EnterpriseMonthlySettlementStatus =
  | 'pending' | 'approved' | 'paid' | 'cancelled';

export type EnterpriseMonthlySettlementItemStatus = 'included' | 'excluded';

/**
 * 0390 — 정산 생성 시 적용된 단가/수수료의 출처.
 *   contract: 활성 계약값 적용 / profile: 정산 프로필값 / default: 시스템 기본값.
 */
export type SettlementRateSource = 'contract' | 'profile' | 'default';

/**
 * 0390 — 월 정산 생성 시 "당시 계약" 스냅샷 필드.
 * 계약 수정은 다음 달 정산부터 반영되며, 이미 생성된 정산은 이 값으로 고정된다.
 */
export interface SettlementContractSnapshot {
  contract_id: string | null;
  contract_no: string | null;
  /** 0390 — 적용 당시 계약 기간/버전 snapshot (생성 시점 고정, read-only) */
  contract_start_date: string | null;
  contract_end_date: string | null;
  contract_version: string | null;   // 계약 개정 시각(버전) = 적용 당시 contract.updated_at
  minimum_payout: number | null;
  settlement_method: string | null;
  rate_source: SettlementRateSource | null;
}

export interface EnterpriseMonthlySettlementRow extends SettlementContractSnapshot {
  id: string;
  enterprise_account_id: string;
  enterprise_name: string;
  brand_code: string | null;
  settlement_month: string;            // 'YYYY-MM-DD' (월 첫째날)
  active_store_count: number;
  monthly_store_price: number;
  commission_rate: number;
  per_store_commission: number;
  total_commission: number;
  status: EnterpriseMonthlySettlementStatus;
  generated_at: string;
  approved_at: string | null;
  paid_at: string | null;
  payment_reference: string | null;
  admin_note: string | null;
}

export interface EnterpriseMonthlySettlementItem {
  id: string;
  store_id: string;
  store_name: string | null;
  franchise_id?: string | null;
  franchise_name: string | null;
  region_id?: string | null;
  region_name: string | null;
  monthly_store_price: number;
  commission_rate: number;
  per_store_commission: number;
  status: EnterpriseMonthlySettlementItemStatus;
  reason: string | null;
}

export interface EnterpriseMonthlySettlementDetail extends SettlementContractSnapshot {
  id: string;
  enterprise_account_id: string;
  enterprise_name: string;
  brand_code: string | null;
  manager_name: string;
  manager_email: string;
  settlement_month: string;
  active_store_count: number;
  monthly_store_price: number;
  commission_rate: number;
  per_store_commission: number;
  total_commission: number;
  status: EnterpriseMonthlySettlementStatus;
  generated_at: string;
  approved_at: string | null;
  paid_at: string | null;
  payment_reference: string | null;
  admin_note: string | null;
}

// HQ 쪽 — 본인 본사만, manager 정보 제외
export interface HqEnterpriseMonthlySettlementRow extends SettlementContractSnapshot {
  id: string;
  settlement_month: string;
  active_store_count: number;
  monthly_store_price: number;
  commission_rate: number;
  per_store_commission: number;
  total_commission: number;
  status: EnterpriseMonthlySettlementStatus;
  generated_at: string;
  approved_at: string | null;
  paid_at: string | null;
  payment_reference: string | null;
}

export interface HqEnterpriseMonthlySettlementDetail extends SettlementContractSnapshot {
  id: string;
  settlement_month: string;
  active_store_count: number;
  monthly_store_price: number;
  commission_rate: number;
  per_store_commission: number;
  total_commission: number;
  status: EnterpriseMonthlySettlementStatus;
  paid_at: string | null;
  payment_reference: string | null;
}

// =============================================================================
// Admin RPCs
// =============================================================================

export interface AdminGenerateResultDetail {
  enterprise_account_id: string;
  enterprise_name: string;
  result: 'created' | 'skipped';
  reason?: 'no_active_stores' | 'already_exists';
  existing_settlement_id?: string;
  settlement_id?: string;
  active_store_count?: number;
  total_commission?: number;
}

export interface AdminGenerateResult {
  success: boolean;
  settlement_month: string;
  created: number;
  skipped: number;
  details: AdminGenerateResultDetail[];
}

export async function adminGenerateEnterpriseMonthlySettlement(
  monthYyyyMmDd: string,            // 'YYYY-MM-DD' or 'YYYY-MM-01'
): Promise<AdminGenerateResult> {
  const { data, error } = await supabase.rpc('admin_generate_enterprise_monthly_settlement', {
    p_month: monthYyyyMmDd,
  });
  if (error) {
    console.error('[ems] generate failed', error);
    throw new Error(error.message || '월 정산 생성에 실패했습니다.');
  }
  return data as AdminGenerateResult;
}

export interface AdminListInput {
  month?: string | null;
  status?: EnterpriseMonthlySettlementStatus | null;
  limit?: number;
  offset?: number;
}

export interface AdminListResult {
  success: boolean;
  total: number;
  rows: EnterpriseMonthlySettlementRow[];
}

export async function adminListEnterpriseMonthlySettlements(
  input: AdminListInput = {},
): Promise<AdminListResult> {
  const { data, error } = await supabase.rpc('admin_list_enterprise_monthly_settlements', {
    p_month:  input.month ?? null,
    p_status: input.status ?? null,
    p_limit:  input.limit  ?? 50,
    p_offset: input.offset ?? 0,
  });
  if (error) {
    console.error('[ems] list failed', error);
    throw new Error(error.message || '월 정산 목록을 불러올 수 없습니다.');
  }
  return data as AdminListResult;
}

export interface AdminGetResult {
  success: boolean;
  settlement: EnterpriseMonthlySettlementDetail;
  items: EnterpriseMonthlySettlementItem[];
}

export async function adminGetEnterpriseMonthlySettlement(
  settlementId: string,
): Promise<AdminGetResult> {
  const { data, error } = await supabase.rpc('admin_get_enterprise_monthly_settlement', {
    p_settlement_id: settlementId,
  });
  if (error) {
    console.error('[ems] get failed', error);
    throw new Error(error.message || '월 정산 상세를 불러올 수 없습니다.');
  }
  return data as AdminGetResult;
}

export async function adminApproveEnterpriseMonthlySettlement(
  settlementId: string,
  adminNote?: string | null,
): Promise<{ success: boolean; settlement_id: string; status: 'approved'; approved_at: string }> {
  const { data, error } = await supabase.rpc('admin_approve_enterprise_monthly_settlement', {
    p_settlement_id: settlementId,
    p_admin_note: adminNote ?? null,
  });
  if (error) {
    console.error('[ems] approve failed', error);
    throw new Error(error.message || '승인에 실패했습니다.');
  }
  return data as { success: boolean; settlement_id: string; status: 'approved'; approved_at: string };
}

export async function adminMarkPaidEnterpriseMonthlySettlement(
  settlementId: string,
  paymentReference: string,
  adminNote?: string | null,
): Promise<{ success: boolean; settlement_id: string; status: 'paid'; paid_at: string }> {
  const { data, error } = await supabase.rpc('admin_mark_paid_enterprise_monthly_settlement', {
    p_settlement_id: settlementId,
    p_payment_reference: paymentReference,
    p_admin_note: adminNote ?? null,
  });
  if (error) {
    console.error('[ems] mark paid failed', error);
    throw new Error(error.message || '지급완료 처리에 실패했습니다.');
  }
  return data as { success: boolean; settlement_id: string; status: 'paid'; paid_at: string };
}

export async function adminCancelEnterpriseMonthlySettlement(
  settlementId: string,
  adminNote: string,
): Promise<{ success: boolean; settlement_id: string; status: 'cancelled' }> {
  const { data, error } = await supabase.rpc('admin_cancel_enterprise_monthly_settlement', {
    p_settlement_id: settlementId,
    p_admin_note: adminNote,
  });
  if (error) {
    console.error('[ems] cancel failed', error);
    throw new Error(error.message || '취소에 실패했습니다.');
  }
  return data as { success: boolean; settlement_id: string; status: 'cancelled' };
}

// =============================================================================
// HQ RPCs (read-only)
// =============================================================================

export async function getMyEnterpriseMonthlySettlements(
  limit = 12,
): Promise<{ success: boolean; rows: HqEnterpriseMonthlySettlementRow[] }> {
  const { data, error } = await supabase.rpc('get_my_enterprise_monthly_settlements', {
    p_limit: limit,
  });
  if (error) {
    console.error('[ems] my list failed', error);
    throw new Error(error.message || '본사 정산 목록을 불러올 수 없습니다.');
  }
  return data as { success: boolean; rows: HqEnterpriseMonthlySettlementRow[] };
}

export async function getMyEnterpriseMonthlySettlementItems(
  settlementId: string,
): Promise<{
  success: boolean;
  settlement: HqEnterpriseMonthlySettlementDetail;
  items: EnterpriseMonthlySettlementItem[];
}> {
  const { data, error } = await supabase.rpc('get_my_enterprise_monthly_settlement_items', {
    p_settlement_id: settlementId,
  });
  if (error) {
    console.error('[ems] my items failed', error);
    throw new Error(error.message || '본사 정산 상세를 불러올 수 없습니다.');
  }
  return data as {
    success: boolean;
    settlement: HqEnterpriseMonthlySettlementDetail;
    items: EnterpriseMonthlySettlementItem[];
  };
}

// =============================================================================
// Helpers
// =============================================================================

/** 'YYYY-MM-01' (월 첫째날) — admin generate 호출용 */
export function currentMonthFirstDay(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}-01`;
}

/** 'YYYY-MM-DD' → 'YYYY-MM' */
export function formatSettlementMonth(yyyyMmDd: string): string {
  return yyyyMmDd.slice(0, 7);
}

export const SETTLEMENT_STATUS_LABEL: Record<EnterpriseMonthlySettlementStatus, string> = {
  pending: '대기',
  approved: '승인됨',
  paid: '지급완료',
  cancelled: '취소됨',
};

/** 0390 — 정산에 적용된 단가/수수료 출처 라벨 (관리자/HQ 화면 배지용) */
export const SETTLEMENT_RATE_SOURCE_LABEL: Record<SettlementRateSource, string> = {
  contract: '계약 적용',
  profile: '정산 프로필',
  default: '기본값',
};
