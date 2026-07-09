// Phase ALGO-3 — Settlement v2 (Shadow) API 래퍼.
// 0420 admin RPC 경유. SHADOW ONLY — 실제 지급 미사용. v1 정산 무관.
import { supabase } from './supabase';

export type StreamSource = 'v1_basis' | 'v2_shadow';

export interface SettlementV2Run {
  id: string;
  settlement_month: string;
  run_at: string;
  dry_run: boolean;
  stream_source: string;
  version: number;
  platform_revenue: number | null;
  pool_revenue: number | null;
  total_eligible_streams: number | null;
  total_revenue_weight: number | null;
  confidence_avg: number | null;
  artist_count: number | null;
  fraud_count: number | null;
  rejected_count: number | null;
  total_gross: number | null;
  total_company_fee: number | null;
  total_agent_fee: number | null;
  total_net: number | null;
  total_final: number | null;
  total_carried_over: number | null;
}

export interface SettlementV2Overview {
  has_data: boolean;
  run?: SettlementV2Run;
  top_artists?: Array<{ id: string; artist_user_id: string; gross: number; net: number; final: number; eligible: number }>;
}

export interface SettlementV2CompareRow {
  artist_user_id: string;
  v1_gross: number | null; v2_gross: number | null;
  v1_net: number | null; v2_net: number | null;
  v1_final: number | null; v2_final: number | null;
  net_diff: number;
}
export interface SettlementV2Compare {
  settlement_month: string;
  v2_run_id: string | null;
  summary: {
    v1_gross: number; v2_gross: number; v1_net: number; v2_net: number; v1_final: number; v2_final: number;
    artists_v1: number; artists_v2: number; net_match_count: number; net_diff_count: number;
  };
  rows: SettlementV2CompareRow[];
}

export interface SettlementV2GenResult {
  ok: boolean; run_id: string; version: number; dry_run: boolean; stream_source: string;
  settlement_month: string; platform_revenue: number; pool_revenue: number;
  total_eligible_streams: number; total_revenue_weight: number; artist_count: number;
  total_gross: number; total_company_fee: number; total_agent_fee: number;
  total_net: number; total_final: number; total_carried_over: number; note: string;
}

export interface SettlementV2Explain {
  settlement: Record<string, unknown>;
  explain: Record<string, unknown> | null;
  items: Array<{ track_id: string; track_title: string | null; eligible: number; weight: number; share: number }>;
}

export async function adminGenerateSettlementV2(month: string, dryRun = true, streamSource: StreamSource = 'v1_basis'): Promise<SettlementV2GenResult> {
  const { data, error } = await supabase.rpc('admin_generate_monthly_settlement_v2', { p_month: month, p_dry_run: dryRun, p_stream_source: streamSource });
  if (error) throw error;
  return data as SettlementV2GenResult;
}

export async function adminSettlementV2Overview(month: string | null = null): Promise<SettlementV2Overview> {
  const { data, error } = await supabase.rpc('admin_settlement_v2_overview', { p_month: month });
  if (error) throw error;
  return data as SettlementV2Overview;
}

export async function adminSettlementV2Compare(month: string, streamSource: StreamSource = 'v1_basis'): Promise<SettlementV2Compare> {
  const { data, error } = await supabase.rpc('admin_settlement_v2_compare', { p_month: month, p_stream_source: streamSource });
  if (error) throw error;
  return data as SettlementV2Compare;
}

export async function adminGetSettlementV2Explain(settlementV2Id: string): Promise<SettlementV2Explain> {
  const { data, error } = await supabase.rpc('admin_get_settlement_v2_explain', { p_settlement_v2_id: settlementV2Id });
  if (error) throw error;
  return data as SettlementV2Explain;
}
