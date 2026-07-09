// Phase ALGO-8A — Runtime Fix Readiness & Safe Apply Plan (Shadow) API 래퍼 — Runtime Readiness Layer.
// 0446 admin RPC 경유. Change Planner · Dependency Graph · Safe Apply Plan · Success/Failure Criteria · Checklist · Rollback Readiness — 운영 미반영.
import { supabase } from './supabase';

export interface ChangeRow {
  key: string; title: string | null; area: string | null; root_cause: string | null;
  current: string | null; target: string | null; impact: number | null; risk: string | null; effort: string | null; dependencies: string[];
}
export interface DependencyRow {
  order: number; from: string | null; to: string | null; change: string | null; impact: string | null; affected: boolean;
}
export interface ApplyStageRow {
  num: number; key: string | null; name: string | null; description: string | null; gate: string | null;
  prerequisites: string[]; exit_criteria: string[]; executed: boolean;
}
export interface SuccessRow { criterion: string; metric: string | null; current: number | null; target: number | null; comparator: string | null; met: boolean }
export interface FailureRow { criterion: string; metric: string | null; threshold: number | null; direction: string | null; auto_block: boolean }
export interface ChecklistRow { item: string; category: string | null; status: string; required: boolean; note: string | null }
export interface RollbackRow {
  change: string; prerequisites: string[]; dependencies: string[]; checkpoints: string[];
  owner: string | null; duration: string | null; verification: string | null; ready: boolean;
}

export interface RuntimeReadinessOverview {
  has_data: boolean;
  run_id?: string | null;
  report?: {
    run_at: string; overall_readiness: string | null; readiness_score: number | null; changes_total: number;
    blocked_count: number | null; success_criteria_total: number; success_criteria_met: number;
    checklist_ready: number | null; checklist_total: number | null; recommendation: string | null; headline: string | null; hash: string | null;
  };
  changes?: ChangeRow[];
  dependency?: DependencyRow[];
  apply_plan?: ApplyStageRow[];
  success?: SuccessRow[];
  failure?: FailureRow[];
  checklist?: ChecklistRow[];
  rollback?: RollbackRow[];
}

export async function adminGenerateRuntimePlan(days = 30): Promise<{ ok: boolean; run_id: string; baseline: Record<string, number> }> {
  const { data, error } = await supabase.rpc('admin_generate_runtime_plan', { p_days: days });
  if (error) throw error;
  return data as { ok: boolean; run_id: string; baseline: Record<string, number> };
}
export async function adminGenerateDependencyGraph(runId: string | null = null): Promise<{ ok: boolean; edges: number; affected: number }> {
  const { data, error } = await supabase.rpc('admin_generate_dependency_graph', { p_run_id: runId });
  if (error) throw error;
  return data as { ok: boolean; edges: number; affected: number };
}
export async function adminGenerateSafeApplyPlan(runId: string | null = null): Promise<{ ok: boolean; stages: number; executed: number }> {
  const { data, error } = await supabase.rpc('admin_generate_safe_apply_plan', { p_run_id: runId });
  if (error) throw error;
  return data as { ok: boolean; stages: number; executed: number };
}
export async function adminGenerateRuntimeChecklist(runId: string | null = null): Promise<{ ok: boolean; overall_readiness: string; readiness_score: number; checklist_ready: number; checklist_total: number; certificate_hash: string }> {
  const { data, error } = await supabase.rpc('admin_generate_runtime_checklist', { p_run_id: runId });
  if (error) throw error;
  return data as { ok: boolean; overall_readiness: string; readiness_score: number; checklist_ready: number; checklist_total: number; certificate_hash: string };
}
export async function adminRuntimeReadinessOverview(): Promise<RuntimeReadinessOverview> {
  const { data, error } = await supabase.rpc('admin_runtime_readiness_overview');
  if (error) throw error;
  return data as RuntimeReadinessOverview;
}
