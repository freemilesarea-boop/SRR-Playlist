// Phase ALGO-2E — Streaming Shadow Calibration & Verified Pipeline (Shadow) API 래퍼.
// 0441 admin RPC 경유. Identity Mapping · Completion · Verified/Eligible 후보 · Funnel · Drop 분석 — 운영 미반영.
import { supabase } from './supabase';

export interface ShadowItem {
  token: string; true_ptype: string | null; m_vsec: number | null; s_vsec: number | null; hb: number | null;
  actual_verified: boolean; verified_cand: boolean; eligible_cand: boolean; settlement_cand: boolean;
  drop_stage: string | null; drop_reason: string | null;
}
export interface IdentityRow {
  token: string; session: string | null; milestone: string | null; true: string | null; mismatch: boolean;
}
export interface DropRow { stage: string | null; reason: string | null; count: number; pct: number | null; recommendation: string }

export interface StreamShadowOverview {
  has_data: boolean;
  run_id?: string | null;
  summary?: {
    raw_count: number; play30s_count: number; verified_actual: number; verified_candidate: number;
    eligible_candidate: number; settlement_candidate: number; top_drop_reason: string | null; run_at: string;
  };
  funnel?: {
    raw_events: number; verified_events_actual: number; verified_candidate: number; eligible_candidate: number;
    settlement_candidate: number; learning_candidate: number; prediction_candidate: number;
    verified_conversion_rate: number | null; verified_drop_rate: number | null;
  };
  identity?: { mismatches: number; breakdown: Record<string, number>; list: IdentityRow[] };
  drop_analysis?: DropRow[];
  candidates?: Record<string, number>;
  items?: ShadowItem[];
}

export interface CalibrationResult {
  ok: boolean; run_id: string; raw_count: number; play30s: number;
  verified_actual: number; verified_candidate: number; eligible_candidate: number; settlement_candidate: number; top_drop_reason: string | null;
}

export async function adminRunStreamShadowCalibration(days = 30): Promise<CalibrationResult> {
  const { data, error } = await supabase.rpc('admin_run_stream_shadow_calibration', { p_days: days });
  if (error) throw error;
  return data as CalibrationResult;
}

export async function adminGenerateIdentityMapping(runId: string | null = null): Promise<{ ok: boolean; mapped: number; mismatches: number; breakdown: Record<string, number> }> {
  const { data, error } = await supabase.rpc('admin_generate_identity_mapping', { p_run_id: runId });
  if (error) throw error;
  return data as { ok: boolean; mapped: number; mismatches: number; breakdown: Record<string, number> };
}

export async function adminGenerateVerifiedCandidates(runId: string | null = null): Promise<{ ok: boolean; candidate_rows: number; stage_counts: Record<string, number> }> {
  const { data, error } = await supabase.rpc('admin_generate_verified_candidates', { p_run_id: runId });
  if (error) throw error;
  return data as { ok: boolean; candidate_rows: number; stage_counts: Record<string, number> };
}

export async function adminGenerateFunnelSummary(runId: string | null = null): Promise<{ ok: boolean; funnel: Record<string, number>; drop_analysis: DropRow[]; report: { headline: string; top_recommendation: string | null } }> {
  const { data, error } = await supabase.rpc('admin_generate_funnel_summary', { p_run_id: runId });
  if (error) throw error;
  return data as { ok: boolean; funnel: Record<string, number>; drop_analysis: DropRow[]; report: { headline: string; top_recommendation: string | null } };
}

export async function adminStreamShadowOverview(): Promise<StreamShadowOverview> {
  const { data, error } = await supabase.rpc('admin_stream_shadow_overview');
  if (error) throw error;
  return data as StreamShadowOverview;
}
