// Phase ALGO-4C — Prediction Calibration & Adaptive Learning API 래퍼.
// 0433 admin RPC 경유. Shadow/Calibration — prediction/exposure/queue 실반영 없음.
import { supabase } from './supabase';

export interface CalibrationRun {
  id: string; run_at: string; prediction_run_id: string | null; item_count: number | null;
  avg_absolute_error: number | null; avg_calibration_score: number | null; avg_bias_score: number | null;
  stable_count: number | null; overestimated_count: number | null; underestimated_count: number | null;
  needs_samples_count: number | null; cold_start_count: number | null; overall_status: string | null;
}

export interface AdaptiveWeights {
  adaptive_completion_weight: number; adaptive_skip_weight: number; adaptive_revenue_weight: number;
  adaptive_confidence_weight: number; adaptive_learning_weight: number;
  err_completion: number; err_skip: number; err_eligible: number; err_revenue: number;
}

export interface CalibrationWorstItem {
  track_id: string; abs_error: number; bias: number; calibration: number; status: string;
}

export interface QueueCalibration {
  id: string; run_at: string; store_id: string | null; twin_size: number; baseline_size: number;
  overlap_count: number; position_error: number | null; spearman_rank: number | null; kendall_tau: number | null;
  top10_overlap: number | null; top20_overlap: number | null; mrr: number | null; ndcg: number | null;
}

export interface CounterfactualSim {
  track_id: string; scenario: string; base: number; sim: number; delta: number;
}

export interface CalibrationOverview {
  has_data: boolean;
  run?: CalibrationRun;
  adaptive_weights?: AdaptiveWeights | null;
  status_breakdown?: { stable: number; overestimated: number; underestimated: number; needs_more_samples: number; cold_start: number };
  worst_items?: CalibrationWorstItem[];
  exposure_sim?: { count: number; improved: number; avg_delta: number };
  queue_calibration?: QueueCalibration[];
  counterfactuals?: CounterfactualSim[];
}

export interface CalibrationGenResult { ok: boolean; run_id: string; item_count?: number; overall_status?: string; note?: string }

export async function adminRunPredictionCalibration(predictionRunId: string | null = null): Promise<CalibrationGenResult> {
  const { data, error } = await supabase.rpc('admin_run_prediction_calibration', { p_prediction_run_id: predictionRunId });
  if (error) throw error;
  return data as CalibrationGenResult;
}

export async function adminGenerateAdaptiveWeights(calibrationRunId: string | null = null): Promise<{ ok: boolean; calibration_run_id: string; weights: Record<string, unknown> }> {
  const { data, error } = await supabase.rpc('admin_generate_adaptive_weights', { p_calibration_run_id: calibrationRunId });
  if (error) throw error;
  return data as { ok: boolean; calibration_run_id: string; weights: Record<string, unknown> };
}

export async function adminSimulateAdaptiveExposure(calibrationRunId: string | null = null): Promise<{ ok: boolean; calibration_run_id: string; simulated: number }> {
  const { data, error } = await supabase.rpc('admin_simulate_adaptive_exposure', { p_calibration_run_id: calibrationRunId });
  if (error) throw error;
  return data as { ok: boolean; calibration_run_id: string; simulated: number };
}

export async function adminValidateQueueCalibration(storeId: string, predictionRunId: string | null = null): Promise<QueueCalibration & { ok: boolean }> {
  const { data, error } = await supabase.rpc('admin_validate_queue_calibration', { p_store_id: storeId, p_prediction_run_id: predictionRunId });
  if (error) throw error;
  return data as QueueCalibration & { ok: boolean };
}

export async function adminGenerateCounterfactualSimulations(calibrationRunId: string | null = null, trackLimit = 20): Promise<{ ok: boolean; calibration_run_id: string; simulations: number }> {
  const { data, error } = await supabase.rpc('admin_generate_counterfactual_simulations', { p_calibration_run_id: calibrationRunId, p_track_limit: trackLimit });
  if (error) throw error;
  return data as { ok: boolean; calibration_run_id: string; simulations: number };
}

export async function adminPredictionCalibrationOverview(runId: string | null = null): Promise<CalibrationOverview> {
  const { data, error } = await supabase.rpc('admin_prediction_calibration_overview', { p_run_id: runId });
  if (error) throw error;
  return data as CalibrationOverview;
}
