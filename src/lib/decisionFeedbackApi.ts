// Phase ALGO-6B — Decision Feedback & Drift Monitor (Shadow) API 래퍼.
// 0437 admin RPC 경유. Feedback · Drift · Stability · Promotion Readiness · Shadow Alert — 운영 미반영.
import { supabase } from './supabase';

export interface LowConfidenceItem { track_id: string; confidence: number; conf_err: number; accuracy: number }
export interface DriftWorstItem {
  track_id: string; magnitude: number | null; status: string;
  completion_drift: number | null; reward_drift: number | null;
}
export interface StabilityWindow {
  window: string; status: string; stable_days: number; warning_days: number; critical_days: number;
  score: number | null; consecutive: number;
}
export interface ShadowAlert { type: string; severity: string; metric: string; value: number | null; message: string }
export interface ReadinessInfo {
  readiness_state: string; decision_accuracy: number | null; avg_risk: number | null;
  drift_status: string | null; sample_size: number | null; consecutive_stable_windows: number | null;
  reasons: Record<string, unknown>;
}

export interface FeedbackOverview {
  has_data: boolean;
  feedback?: {
    feedback_run_id: string | null; items: number | null; avg_accuracy: number | null;
    avg_score_error: number | null; avg_confidence_error: number | null; avg_risk_error: number | null;
    low_confidence_items: LowConfidenceItem[];
  };
  drift?: { drift_run_id: string | null; status: string | null; avg_drift: number | null; worst_items: DriftWorstItem[] };
  stability?: StabilityWindow[];
  readiness?: ReadinessInfo | null;
  alerts?: ShadowAlert[];
}

export interface FeedbackResult { ok: boolean; feedback_run_id: string; items: number; split_at: string; avg_accuracy: number | null }
export interface DriftResult { ok: boolean; drift_run_id: string; feedback_run_id: string; items: number; drift_status: string; avg_drift: number | null; alerts: number }
export interface StabilityResult { ok: boolean; windows: number; consecutive_stable_windows: number; summary: Array<Record<string, unknown>> }
export interface ReadinessResult { ok: boolean; readiness_state: string; reasons: Record<string, unknown> }

export async function adminRunDecisionFeedback(decisionRunId: string | null = null, days = 120): Promise<FeedbackResult> {
  const { data, error } = await supabase.rpc('admin_run_decision_feedback', { p_decision_run_id: decisionRunId, p_days: days });
  if (error) throw error;
  return data as FeedbackResult;
}

export async function adminRunDecisionDriftMonitor(feedbackRunId: string | null = null): Promise<DriftResult> {
  const { data, error } = await supabase.rpc('admin_run_decision_drift_monitor', { p_feedback_run_id: feedbackRunId });
  if (error) throw error;
  return data as DriftResult;
}

export async function adminCalculateDecisionStability(days = 90): Promise<StabilityResult> {
  const { data, error } = await supabase.rpc('admin_calculate_decision_stability', { p_days: days });
  if (error) throw error;
  return data as StabilityResult;
}

export async function adminGeneratePromotionReadiness(minSample = 30): Promise<ReadinessResult> {
  const { data, error } = await supabase.rpc('admin_generate_promotion_readiness', { p_min_sample: minSample });
  if (error) throw error;
  return data as ReadinessResult;
}

export async function adminAiDecisionFeedbackOverview(): Promise<FeedbackOverview> {
  const { data, error } = await supabase.rpc('admin_ai_decision_feedback_overview');
  if (error) throw error;
  return data as FeedbackOverview;
}
