// Phase ALGO-4B — Prediction Engine & Digital Twin Queue API 래퍼.
// 0432 admin RPC 경유. Shadow/Digital Twin — 실제 Queue/Playback 미반영.
import { supabase } from './supabase';

export interface PredictionRun {
  id: string; run_at: string; store_scope: string | null; track_count: number | null;
  learning_run_id: string | null; exposure_run_id: string | null; formula_version: number; notes: string | null;
}

export interface PredictionCandidate {
  run_id: string; track_id: string; track_title: string | null; main_genre: string | null;
  prediction_score: number; expected_completion_rate: number; expected_skip_rate: number;
  expected_eligible_rate: number; expected_revenue_weight: number; expected_listener_fit: number;
  prediction_confidence: number; data_source: string; rank: number;
}

export interface QueueValidationSummary {
  validation_run_id: string; run_at: string; store_id: string | null; baseline_source: string | null;
  twin_size: number; baseline_size: number; overlap_count: number; overlap_rate: number;
  expected_completion_delta: number; expected_skip_delta: number; expected_revenue_delta: number;
  diversity_delta: number; freshness_delta: number;
}

export interface PredictionOverview {
  has_data: boolean;
  run?: PredictionRun;
  top?: PredictionCandidate[];
  source_breakdown?: Record<string, number>;
  validations?: QueueValidationSummary[];
  gap?: { count: number; over: number; under: number; accurate: number };
}

export interface PredictionGenResult {
  ok: boolean; run_id: string; track_count: number; learning_run_id: string | null; exposure_run_id: string | null; note?: string;
}

export interface TwinQueueResult { ok: boolean; run_id: string; store_id: string; queue_size: number; note?: string }

export interface ValidationResult {
  ok: boolean; validation_run_id: string; prediction_run_id?: string; store_id?: string;
  baseline_source?: string; twin_size: number; baseline_size: number; overlap_count: number; overlap_rate: number; note?: string;
}

export interface Counterfactual {
  track_a: string; track_b: string; a_prediction: number; b_prediction: number;
  completion_diff: number; skip_diff: number; eligible_diff: number; revenue_weight_diff: number;
  exposure_score_diff: number; final_score_diff: number; top_factor: string; reason_summary: string;
}

export async function adminGenerateTrackPredictions(storeScope: string | null = null, trackLimit = 100): Promise<PredictionGenResult> {
  const { data, error } = await supabase.rpc('admin_generate_track_predictions', { p_store_scope: storeScope, p_track_limit: trackLimit });
  if (error) throw error;
  return data as PredictionGenResult;
}

export async function adminPredictionOverview(runId: string | null = null): Promise<PredictionOverview> {
  const { data, error } = await supabase.rpc('admin_prediction_overview', { p_run_id: runId });
  if (error) throw error;
  return data as PredictionOverview;
}

export async function adminGenerateDigitalTwinQueue(storeId: string, size = 20, predictionRunId: string | null = null): Promise<TwinQueueResult> {
  const { data, error } = await supabase.rpc('admin_generate_digital_twin_queue', { p_store_id: storeId, p_size: size, p_prediction_run_id: predictionRunId });
  if (error) throw error;
  return data as TwinQueueResult;
}

export async function adminValidateShadowQueue(storeId: string, predictionRunId: string | null = null): Promise<ValidationResult> {
  const { data, error } = await supabase.rpc('admin_validate_shadow_queue', { p_store_id: storeId, p_prediction_run_id: predictionRunId });
  if (error) throw error;
  return data as ValidationResult;
}

export async function adminGetCounterfactual(trackA: string, trackB: string, runId: string | null = null): Promise<Counterfactual> {
  const { data, error } = await supabase.rpc('admin_get_counterfactual_explanation', { p_track_a: trackA, p_track_b: trackB, p_run_id: runId });
  if (error) throw error;
  return data as Counterfactual;
}
