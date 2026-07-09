// Phase ALGO-6A — Unified AI Decision Layer (Shadow) API 래퍼.
// 0436 admin RPC 경유. 6 sub-score 통합 · Explain · Risk · Candidate · Canary · Approval — 운영 미반영.
import { supabase } from './supabase';

export interface DecisionTop {
  track_id: string; score: number; state: string | null;
  prediction: number; reward: number; exposure: number; bandit: number; ensemble: number; calibration: number;
  confidence: number; risk: number; top_factor: string | null;
}

export interface DecisionOverview {
  has_data: boolean;
  decision_run_id?: string | null;
  summary?: { tracks: number; avg_score: number | null; avg_risk: number | null; avg_confidence: number | null };
  top?: DecisionTop[];
  candidates?: Record<string, number>;
  risk_levels?: Record<string, number>;
  canary?: { plans: number; stages: number; applied: number };
  approvals?: { requested: number; auto_apply: number };
}

export interface DecisionResult { ok: boolean; decision_run_id: string; tracks: number; avg_score: number | null }
export interface CandidateResult { ok: boolean; decision_run_id: string; candidates: number; breakdown: Record<string, number> }
export interface CanaryResult { ok: boolean; decision_run_id: string; canary_plans: number; approval_requests: number }

export async function adminGenerateUnifiedDecision(days = 120, trackLimit = 200): Promise<DecisionResult> {
  const { data, error } = await supabase.rpc('admin_generate_unified_decision', { p_days: days, p_track_limit: trackLimit });
  if (error) throw error;
  return data as DecisionResult;
}

export async function adminGenerateDecisionCandidates(runId: string | null = null): Promise<CandidateResult> {
  const { data, error } = await supabase.rpc('admin_generate_decision_candidates', { p_run_id: runId });
  if (error) throw error;
  return data as CandidateResult;
}

export async function adminGenerateCanaryPlan(runId: string | null = null, top = 20): Promise<CanaryResult> {
  const { data, error } = await supabase.rpc('admin_generate_canary_plan', { p_run_id: runId, p_top: top });
  if (error) throw error;
  return data as CanaryResult;
}

export async function adminAiDecisionOverview(): Promise<DecisionOverview> {
  const { data, error } = await supabase.rpc('admin_ai_decision_overview');
  if (error) throw error;
  return data as DecisionOverview;
}
