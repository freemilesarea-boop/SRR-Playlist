// Phase ALGO-5A — AI Experiment Engine & Model Registry (MLOps, Shadow) API 래퍼.
// 0434 admin RPC 경유. Champion/Challenger Shadow A/B — 운영 미반영(상태 판정만).
import { supabase } from './supabase';

export interface AiModelSummary {
  model_key: string;
  model_type: string;
  versions: number;
  champion: number | null;
}

export interface AiExperimentSummary {
  id: string;
  key: string;
  name: string | null;
  status: string | null;
  promotion_state: string | null;
  champion_v: number | null;
  challenger_v: number | null;
  winner: string | null;
}

export interface AiCandidateSummary {
  key: string;
  promotion_state: string | null;
}

export interface AiAuditEntry {
  action: string;
  at: string;
  meta: Record<string, unknown> | null;
}

export interface AiExperimentOverview {
  has_data: boolean;
  models?: AiModelSummary[];
  experiments?: AiExperimentSummary[];
  candidates?: AiCandidateSummary[];
  rollback_plans?: number;
  recent_audit?: AiAuditEntry[];
}

export interface AiMetricRow {
  metric: string;
  direction: string;
  champion: number | null;
  challenger: number | null;
  delta: number | null;
  better: string;
}

export interface AiCompareResult {
  has_data: boolean;
  experiment_run_id?: string;
  winner?: string;
  metrics?: AiMetricRow[];
}

export interface AiRegisterResult {
  ok: boolean;
  model_version_id: string;
  model_key: string;
  version: number;
  status: string;
}

export interface AiCreateExperimentResult {
  ok: boolean;
  experiment_id: string;
  experiment_key: string;
}

export interface AiRunResult {
  ok: boolean;
  experiment_run_id: string;
  winner: string;
  challenger_wins: number;
  champion_wins: number;
}

export interface AiGate {
  'calibration_ge_champion+0.03': boolean;
  'skip_le_champion-0.05': boolean;
  'completion_ge_champion+0.03': boolean;
  'risk_le_0.2': boolean;
  sample_ok: boolean;
}

export interface AiMarkCandidateResult {
  ok: boolean;
  experiment_id: string;
  promotion_state: string;
  gate: AiGate;
  rollback_plan_id: string | null;
  note: string;
}

export async function adminRegisterAiModel(params: {
  modelKey: string; modelType: string; version: number; status?: string;
  parameters?: Record<string, unknown>; metrics?: Record<string, unknown>;
  parentVersion?: number | null; createdFromRunId?: string | null; notes?: string | null;
}): Promise<AiRegisterResult> {
  const { data, error } = await supabase.rpc('admin_register_ai_model', {
    p_model_key: params.modelKey, p_model_type: params.modelType, p_version: params.version,
    p_status: params.status ?? 'draft', p_parameters: params.parameters ?? {}, p_metrics: params.metrics ?? {},
    p_parent_version: params.parentVersion ?? null, p_created_from_run_id: params.createdFromRunId ?? null,
    p_notes: params.notes ?? null,
  });
  if (error) throw error;
  return data as AiRegisterResult;
}

export async function adminCreateAiExperiment(params: {
  experimentKey: string; name: string; modelType: string;
  championVersionId: string; challengerVersionId: string;
  trafficSplit?: number; evalWindow?: number; minSample?: number;
}): Promise<AiCreateExperimentResult> {
  const { data, error } = await supabase.rpc('admin_create_ai_experiment', {
    p_experiment_key: params.experimentKey, p_name: params.name, p_model_type: params.modelType,
    p_champion_version_id: params.championVersionId, p_challenger_version_id: params.challengerVersionId,
    p_traffic_split: params.trafficSplit ?? 0.5, p_eval_window: params.evalWindow ?? 14, p_min_sample: params.minSample ?? 30,
  });
  if (error) throw error;
  return data as AiCreateExperimentResult;
}

export async function adminRunAiExperiment(experimentId: string, sampleSize = 100): Promise<AiRunResult> {
  const { data, error } = await supabase.rpc('admin_run_ai_experiment', { p_experiment_id: experimentId, p_sample_size: sampleSize });
  if (error) throw error;
  return data as AiRunResult;
}

export async function adminCompareAiExperiment(experimentId: string): Promise<AiCompareResult> {
  const { data, error } = await supabase.rpc('admin_compare_ai_experiment', { p_experiment_id: experimentId });
  if (error) throw error;
  return data as AiCompareResult;
}

export async function adminMarkExperimentCandidate(experimentId: string): Promise<AiMarkCandidateResult> {
  const { data, error } = await supabase.rpc('admin_mark_experiment_candidate', { p_experiment_id: experimentId });
  if (error) throw error;
  return data as AiMarkCandidateResult;
}

export async function adminAiExperimentOverview(): Promise<AiExperimentOverview> {
  const { data, error } = await supabase.rpc('admin_ai_experiment_overview');
  if (error) throw error;
  return data as AiExperimentOverview;
}
