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

export async function adminMarkSettlementPaid(
  id: string,
  memo?: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('admin_mark_settlement_paid', {
    p_settlement_id: id,
    p_payout_memo: memo ?? null,
  });
  if (error) throw error;
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

export async function adminSettlementDetail(id: string): Promise<{
  settlement: Record<string, unknown> & { id: string; status: SettlementStatus };
  artist: { nickname: string | null; email: string | null; artist_name: string | null };
  policy: Record<string, unknown>;
  items: SettlementItem[];
} | null> {
  const { data, error } = await supabase.rpc('admin_settlement_detail', { p_id: id });
  if (error) throw error;
  return (data as unknown) as ReturnType<typeof adminSettlementDetail> extends Promise<infer R>
    ? R
    : never;
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
