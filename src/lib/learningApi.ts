// Phase ALGO-4A.5 — Learning Memory Engine (Shadow) API 래퍼.
// 0431 admin RPC 경유. Shadow Memory — Exposure Score 미반영. v1/v2 무관.
import { supabase } from './supabase';

export interface LearningRun {
  id: string; run_at: string; window_days: number | null;
  track_count: number | null; store_count: number | null; context_count: number | null;
  industry_count: number | null; exposure_count: number | null; formula_version: number; notes: string | null;
}

export interface TrackMemoryTop {
  track_id: string; learning_score: number; completion: number; skip: number;
  plays: number; best_store: string | null; best_slot: string | null;
}
export interface IndustryMemory {
  industry: string; plays: number; completion: number; skip: number;
  best_slot: string | null; top_genres: unknown[]; learning_score: number;
}
export interface ContextMemory {
  context: string; slot: string | null; industry: string | null;
  completion: number; skip: number; sample: number; genre_perf: Record<string, number>;
}
export interface ExposureGap {
  count: number; avg_gap: number; high: number; mid: number; low: number;
}

export interface LearningOverview {
  has_data: boolean;
  run?: LearningRun;
  track_top?: TrackMemoryTop[];
  industries?: IndustryMemory[];
  contexts?: ContextMemory[];
  exposure_gap?: ExposureGap;
}

export interface LearningGenResult {
  ok: boolean; run_id: string; track_count: number; store_count: number;
  context_count: number; industry_count: number; exposure_count: number; note?: string;
}

export interface PredictionRow {
  track_id: string; exposure_score: number | null; actual_completion: number | null;
  actual_skip: number | null; gap: number | null; quality: string | null;
}
export interface PredictionCompare {
  run_id: string | null;
  summary: { count: number; avg_gap: number; avg_abs_gap: number; high: number; mid: number; low: number };
  rows: PredictionRow[];
}

export async function adminGenerateLearningMemory(days = 90, trackLimit = 200): Promise<LearningGenResult> {
  const { data, error } = await supabase.rpc('admin_generate_learning_memory', { p_days: days, p_track_limit: trackLimit });
  if (error) throw error;
  return data as LearningGenResult;
}

export async function adminLearningMemoryOverview(runId: string | null = null): Promise<LearningOverview> {
  const { data, error } = await supabase.rpc('admin_learning_memory_overview', { p_run_id: runId });
  if (error) throw error;
  return data as LearningOverview;
}

export async function adminGetTrackMemory(trackId: string, runId: string | null = null): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('admin_get_track_memory', { p_track_id: trackId, p_run_id: runId });
  if (error) throw error;
  return data as Record<string, unknown>;
}

export async function adminGetStoreMemory(storeId: string, runId: string | null = null): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('admin_get_store_memory', { p_store_id: storeId, p_run_id: runId });
  if (error) throw error;
  return data as Record<string, unknown>;
}

export async function adminGetContextMemory(runId: string | null = null, industry: string | null = null): Promise<{ run_id: string | null; industry: string | null; contexts: Record<string, unknown>[] }> {
  const { data, error } = await supabase.rpc('admin_get_context_memory', { p_run_id: runId, p_industry: industry });
  if (error) throw error;
  return data as { run_id: string | null; industry: string | null; contexts: Record<string, unknown>[] };
}

export async function adminCompareExposurePrediction(runId: string | null = null, limit = 50): Promise<PredictionCompare> {
  const { data, error } = await supabase.rpc('admin_compare_exposure_prediction', { p_run_id: runId, p_limit: limit });
  if (error) throw error;
  return data as PredictionCompare;
}
