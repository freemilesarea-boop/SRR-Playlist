// Phase ALGO-3B — Settlement v2 Validation & Cutover Readiness API 래퍼.
// 0421 admin RPC 경유. 분석 전용 — 실제 지급/정산 무관. v1 무변경.
import { supabase } from './supabase';
import type { StreamSource } from './settlementV2Api';

export type DiffReason =
  | 'MATCH' | 'DATA_VINTAGE' | 'NEW_STREAM' | 'STREAMING_V2'
  | 'POLICY' | 'ROUNDING' | 'BUG' | 'UNKNOWN' | 'NO_V2_RUN';

export interface DiffComponents {
  DATA_VINTAGE: number; NEW_STREAM: number; STREAMING_V2: number;
  POLICY: number; ROUNDING: number; BUG: number; UNKNOWN: number;
}
export interface DiffClassification {
  has_v2: boolean;
  v1_gross?: number; v2_gross?: number; total_diff?: number; abs_diff?: number;
  v1_pool?: number; v2_pool?: number;
  v1_eligible_streams?: number; v2_eligible_streams?: number;
  primary_reason: DiffReason;
  invariants?: { gross_le_pool: boolean; non_negative: boolean };
  components?: DiffComponents;
  pct?: Record<string, number>;
}

export interface ValidationMetric {
  metric: string; v1: number; v2: number; diff: number; diff_pct: number | null;
}
export interface SettlementValidation {
  settlement_month: string; stream_source: string; has_v2: boolean;
  v2_run_id?: string; v2_version?: number;
  metrics?: ValidationMetric[];
  difference_reason?: DiffReason;
  classification?: DiffClassification;
  note?: string;
}

export interface ReadinessComponent { score: number; max: number; [k: string]: unknown }
export interface SettlementReadiness {
  settlement_month: string; stream_source: string; has_v2: boolean;
  readiness_score: number;
  components?: {
    difference: ReadinessComponent; no_bug: ReadinessComponent;
    shadow_stable: ReadinessComponent; replay_stable: ReadinessComponent; health: ReadinessComponent;
  };
  consecutive_ready_months?: number;
  has_v1_baseline?: boolean;
  cutover_candidate?: boolean;
  cutover_rule?: string;
  primary_reason?: DiffReason;
  note?: string;
}

export interface TrendPoint {
  month: string; has_v2: boolean;
  v1_gross?: number; v2_gross?: number; abs_diff?: number;
  diff_pct?: number | null; primary_reason?: DiffReason;
}
export interface DifferenceAI {
  settlement_month: string; stream_source: string; has_v2: boolean;
  primary_reason?: DiffReason;
  pct?: Record<string, number>;
  components?: DiffComponents;
  invariants?: { gross_le_pool: boolean; non_negative: boolean };
  summary: string;
  trend: TrendPoint[];
}

export interface ArtistCompareRow {
  artist_user_id: string; v1_gross: number; v2_gross: number;
  gross_diff: number; gross_diff_pct: number | null;
  eligible_stream_diff: number; revenue_weight_diff: number;
  carryover_diff: number; final_diff: number; top_reason: string;
}
export interface ArtistCompare {
  settlement_month: string; stream_source: string; v2_run_id: string | null;
  artists: ArtistCompareRow[];
}

export interface TrackCompareRow {
  track_id: string; track_title: string | null;
  v1_eligible_stream: number; v2_eligible_stream: number; v1_rejected_stream: number;
  v2_revenue_weight: number; v1_gross_contribution: number; v2_gross_contribution: number;
  diff: number; diff_reason: string;
}
export interface TrackCompare {
  settlement_month: string; stream_source: string; v2_run_id: string | null;
  tracks: TrackCompareRow[];
}

export interface StoreCompareRow {
  store_id: string | null; enterprise_account_id: string | null;
  eligible: number; rejected: number; revenue_weight: number;
  health_score: number | null; fraud_count: number;
  top_genres: Array<Record<string, unknown>>; top_rejections: Array<Record<string, unknown>>;
}
export interface StoreCompare {
  settlement_month: string; has_shadow_data: boolean;
  stores: StoreCompareRow[]; note: string | null;
}

export interface BrandCompareRow {
  brand_id: string | null; eligible: number;
  contribution_pct: number; estimated_revenue: number; settlement_note?: string;
}
export interface BrandCompare {
  settlement_month: string; stream_source: string;
  total_eligible: number; pool_revenue: number; brands: BrandCompareRow[];
}

export async function adminSettlementValidation(month: string, source: StreamSource = 'v1_basis'): Promise<SettlementValidation> {
  const { data, error } = await supabase.rpc('admin_settlement_validation', { p_month: month, p_stream_source: source });
  if (error) throw error;
  return data as SettlementValidation;
}
export async function adminSettlementReadiness(month: string, source: StreamSource = 'v1_basis'): Promise<SettlementReadiness> {
  const { data, error } = await supabase.rpc('admin_settlement_readiness', { p_month: month, p_stream_source: source });
  if (error) throw error;
  return data as SettlementReadiness;
}
export async function adminSettlementDifferenceAI(month: string, source: StreamSource = 'v1_basis'): Promise<DifferenceAI> {
  const { data, error } = await supabase.rpc('admin_settlement_difference_ai', { p_month: month, p_stream_source: source });
  if (error) throw error;
  return data as DifferenceAI;
}
export async function adminSettlementArtistCompare(month: string, source: StreamSource = 'v1_basis'): Promise<ArtistCompare> {
  const { data, error } = await supabase.rpc('admin_settlement_artist_compare', { p_month: month, p_stream_source: source });
  if (error) throw error;
  return data as ArtistCompare;
}
export async function adminSettlementTrackCompare(month: string, source: StreamSource = 'v1_basis'): Promise<TrackCompare> {
  const { data, error } = await supabase.rpc('admin_settlement_track_compare', { p_month: month, p_stream_source: source });
  if (error) throw error;
  return data as TrackCompare;
}
export async function adminSettlementStoreCompare(month: string): Promise<StoreCompare> {
  const { data, error } = await supabase.rpc('admin_settlement_store_compare', { p_month: month });
  if (error) throw error;
  return data as StoreCompare;
}
export async function adminSettlementBrandCompare(month: string, source: StreamSource = 'v1_basis'): Promise<BrandCompare> {
  const { data, error } = await supabase.rpc('admin_settlement_brand_compare', { p_month: month, p_stream_source: source });
  if (error) throw error;
  return data as BrandCompare;
}
