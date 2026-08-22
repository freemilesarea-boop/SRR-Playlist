/**
 * artistSettlementApi.ts — Phase 4 정산 RPC wrapper.
 *
 * 안전: 모든 RPC 는 DB 내부에서 검증 (admin only / immutability / advisory lock).
 * 프론트는 단순 래퍼 + 타입.
 */
import { supabase } from './supabase';

export type SettlementStatus =
  | 'pending'
  | 'carried_over'
  | 'payable'
  | 'paid'
  | 'held'
  | 'disputed';

export interface AdminSettlementRow {
  id: string;
  settlement_month: string; // 'YYYY-MM-DD' (1일)
  artist_user_id: string;
  artist_nickname: string;
  artist_email: string;
  gross_settlement_amount: number;
  company_fee_amount: number;
  sales_agent_fee_amount: number;
  artist_net_settlement: number;
  previous_carried_amount: number;
  total_settlement_amount: number;
  meets_min_payout: boolean;
  withholding_tax_amount: number;
  final_payout_amount: number;
  carried_over_amount: number;
  status: SettlementStatus;
  finalized_at: string | null;
  paid_at: string | null;
  created_at: string;
  // X6.25 — payout PII (마스킹) + 이월 메타데이터
  payout_account_id: string | null;
  legal_name: string | null;
  rrn_masked: string | null;           // e.g. 930407-*******
  has_rrn: boolean;
  bank_name: string | null;
  masked_account_number: string | null; // e.g. ********3345
  account_holder: string | null;
  has_account_number: boolean;
  tax_withholding_type: 'business_income_3_3' | 'other_income_8_8' | 'none' | null;
  payout_account_status: 'ready' | 'verified_partial' | 'pending' | 'missing';
  is_manual_carryover: boolean;
  carryover_applied: boolean;
  carried_over_to_month: string | null;
  carryover_reason: string | null;
  held_reason: string | null;
  // X6.28/X6.29 — auto-merge 추적 + paid 후 메모
  merged_into_settlement_id: string | null;
  payout_memo: string | null;
  // X6.45 — 버전 관리 (pending/held 재생성 시 version+1, 최신만 is_current)
  version: number;
  is_current: boolean;
}

/** X6.45 — 동일 (월, 아티스트) 의 정산 version 이력 1건 */
export interface SettlementVersionRow {
  id: string;
  settlement_month: string;
  artist_user_id: string;
  version: number;
  is_current: boolean;
  status: SettlementStatus;
  gross_settlement_amount: number;
  artist_net_settlement: number;
  previous_carried_amount: number;
  total_settlement_amount: number;
  withholding_tax_amount: number;
  final_payout_amount: number;
  carried_over_amount: number;
  meets_min_payout: boolean;
  created_at: string;
  updated_at: string | null;
  finalized_at: string | null;
  paid_at: string | null;
}

export interface SettlementItem {
  track_code: string;
  track_title: string;
  stream_count: number;
  /** 0079 — 정산에 실제 반영된 카운트 (= stream_count) */
  eligible_stream_count?: number;
  /** 0079 — 전체 milestone_30s 카운트 (eligible + excluded) */
  raw_milestone_stream_count?: number;
  /** 0079 — admin/artist 미리듣기, 셀프재생 등으로 제외된 카운트 */
  excluded_stream_count?: number;
  pool_revenue_share: number;
}

export interface GenerateSettlementResult {
  ok: boolean;
  run_id: string;
  dry_run: boolean;
  settlement_month: string;
  platform_revenue: number;
  pool_revenue: number;
  total_pool_streams: number;
  generated: number;
  overwritten: number;
  skipped: number;
  payable: number;
  carried_over: number;
  held_pii_incomplete?: number;
  total_gross: number;
  total_company_fee: number;
  total_sales_agent_fee: number;
  total_final_payout: number;
  total_carried_over: number;
  skipped_artists: Array<{
    artist_user_id: string;
    existing_status: string;
    reason: string;
  }>;
}

export interface PendingSettlementAlert {
  has_pending: boolean;
  settlement_month: string | null;
  pending_count: number;
  held_count: number;
  total_amount: number;
}

/** 관리자 배너용 — 지급 대기(pending/held) 최신 정산월 + 건수. 관리자만. */
export async function adminPendingSettlementAlert(): Promise<PendingSettlementAlert | null> {
  const { data, error } = await supabase.rpc('admin_pending_settlement_alert');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? null) as PendingSettlementAlert | null;
}

export interface MySettlementRow {
  id: string;
  settlement_month: string;
  gross_settlement_amount: number;
  artist_net_settlement: number;
  previous_carried_amount: number;
  total_settlement_amount: number;
  meets_min_payout: boolean;
  withholding_tax_amount: number;
  final_payout_amount: number;
  carried_over_amount: number;
  status: SettlementStatus;
  paid_at: string | null;
  created_at: string;
}

export async function adminGenerateMonthlySettlement(
  month: string,
  dryRun = true,
): Promise<GenerateSettlementResult> {
  const { data, error } = await supabase.rpc('admin_generate_monthly_settlement', {
    p_month: month,
    p_dry_run: dryRun,
  });
  if (error) throw error;
  return data as GenerateSettlementResult;
}

export async function adminFinalizeSettlement(id: string): Promise<SettlementStatus> {
  const { data, error } = await supabase.rpc('admin_finalize_settlement', {
    p_settlement_id: id,
  });
  if (error) throw error;
  return (data as { status: SettlementStatus }).status;
}

export interface MarkPaidResult {
  ok: boolean;
  settlement_id: string;
  status: 'paid';
  before_status?: string;
  audit_id?: number;
  final_payout_amount?: number;
  paid_at?: string;
  already_paid?: boolean;
}

/**
 * 정산 지급완료 처리 (X6.29).
 * - 허용: pending / payable / held → paid (단, 안전장치 통과)
 * - p_force_pii: held + pii_incomplete 케이스 명시적 override (기본 false)
 */
export async function adminMarkSettlementPaid(
  id: string,
  memo?: string | null,
  forcePii: boolean = false,
): Promise<MarkPaidResult> {
  const { data, error } = await supabase.rpc('admin_mark_settlement_paid', {
    p_settlement_id: id,
    p_payout_memo: memo ?? null,
    p_force_pii: forcePii,
  });
  if (error) throw error;
  return data as MarkPaidResult;
}

export async function adminMarkSettlementHeld(
  id: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc('admin_mark_settlement_held', {
    p_settlement_id: id,
    p_reason: reason,
  });
  if (error) throw error;
}

export async function adminListSettlements(opts?: {
  month?: string | null;
  status?: SettlementStatus | '';
  search?: string;
}): Promise<AdminSettlementRow[]> {
  const { data, error } = await supabase.rpc('admin_settlement_list', {
    p_month: opts?.month ?? null,
    p_status: opts?.status || null,
    p_search: opts?.search || null,
  });
  if (error) throw error;
  return (data ?? []) as AdminSettlementRow[];
}

/**
 * 동일 (월, 아티스트) 정산의 전체 version 이력 조회 (관리자).
 * 최신 version 이 is_current=true. 재생성 시마다 version+1 이 쌓임.
 */
export async function adminSettlementVersionHistory(
  settlementMonth: string,
  artistUserId: string,
): Promise<SettlementVersionRow[]> {
  const { data, error } = await supabase.rpc('admin_settlement_version_history', {
    p_settlement_month: settlementMonth,
    p_artist_user_id: artistUserId,
  });
  if (error) throw error;
  return (data ?? []) as SettlementVersionRow[];
}

export interface SettlementPayoutAccountSummary {
  id: string;
  legal_name: string | null;
  bank_name: string | null;
  account_holder: string | null;
  tax_withholding_type: string | null;
  tax_consent_at: string | null;
  verification_status: string;
  has_rrn: boolean;
  has_account_number: boolean;
  rrn_masked: string | null;
  masked_account_number: string | null;
  status: 'ready' | 'verified_partial' | 'pending';
}

export interface SettlementAuditLog {
  id: number;
  action: string;
  amount: number | null;
  from_month: string | null;
  to_month: string | null;
  reason: string | null;
  admin_user_id: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export async function adminSettlementDetail(id: string): Promise<{
  settlement: Record<string, unknown> & {
    id: string;
    status: SettlementStatus;
    is_manual_carryover?: boolean;
    carryover_applied?: boolean;
    carried_over_to_month?: string | null;
    carryover_reason?: string | null;
    carried_over_at?: string | null;
    held_reason?: string | null;
    payout_account_id?: string | null;
  };
  artist: { nickname: string | null; email: string | null; artist_name: string | null };
  policy: Record<string, unknown>;
  payout_account: SettlementPayoutAccountSummary | null;
  items: SettlementItem[];
  audit_logs: SettlementAuditLog[];
} | null> {
  const { data, error } = await supabase.rpc('admin_settlement_detail', { p_id: id });
  if (error) throw error;
  return (data as unknown) as ReturnType<typeof adminSettlementDetail> extends Promise<infer R>
    ? R
    : never;
}

export interface CarryoverResult {
  ok: boolean;
  settlement_id: string;
  audit_id: number;
  carryover_amount: number;
  carried_over_to_month: string;
  status: 'carried_over';
}

export async function adminCarryoverSettlement(
  id: string,
  reason: string,
): Promise<CarryoverResult> {
  const { data, error } = await supabase.rpc('admin_carryover_settlement', {
    p_settlement_id: id,
    p_reason: reason,
  });
  if (error) throw error;
  return data as CarryoverResult;
}

export async function getMySettlements(): Promise<MySettlementRow[]> {
  const { data, error } = await supabase.rpc('get_my_settlements');
  if (error) throw error;
  return (data ?? []) as MySettlementRow[];
}

export async function getMySettlementDetail(id: string): Promise<{
  settlement: Record<string, unknown>;
  items: SettlementItem[];
} | null> {
  const { data, error } = await supabase.rpc('get_my_settlement_detail', { p_id: id });
  if (error) throw error;
  return data as { settlement: Record<string, unknown>; items: SettlementItem[] } | null;
}
