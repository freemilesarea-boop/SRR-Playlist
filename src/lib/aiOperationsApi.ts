// Phase ALGO-7B — AI Operations Center (Shadow) API 래퍼.
// 0443 admin RPC 경유. Release · Rollback(sim) · Policy · Approval · Maintenance · Incident · Timeline — 운영 미반영.
import { supabase } from './supabase';

export interface ReleaseRow {
  component: string; stage: string | null; readiness: number | null; status: string | null;
  present: boolean; blockers?: unknown; note?: string | null;
}
export interface RollbackRow {
  component: string; risk: string | null; reason: string | null;
  steps?: string[]; dependencies?: string[]; checklist?: Record<string, unknown>;
}
export interface PolicyRow { key: string; domain: string | null; version: number | null; checksum: string | null }
export interface PolicyHistoryRow { key: string; from: number | null; to: number | null; diff?: unknown }
export interface ApprovalRow { subject: string; kind: string | null; state: string; priority: string | null }
export interface MaintenanceRow { type: string; status: string | null; scope: string | null; executed: boolean; note?: string | null }
export interface OpsIncidentRow { type: string; component: string | null; priority: string; state: string; count: number; summary: string | null }
export interface OpsTimelineRow { ts: string; category: string | null; component?: string | null; event: string | null; detail?: string | null }

export interface AiOperationsOverview {
  has_data: boolean;
  run_id?: string | null;
  summary?: {
    run_at: string; window_days: number | null; release_total: number; release_ready: number; release_blocked: number;
    rollback_plans: number; policies_total: number; incidents_total: number | null; incidents_critical: number | null;
    approvals_pending: number | null; maintenance_windows: number | null; headline: string | null;
  };
  releases?: ReleaseRow[];
  rollbacks?: RollbackRow[];
  policies?: PolicyRow[];
  policy_history?: PolicyHistoryRow[];
  approvals?: ApprovalRow[];
  maintenance?: MaintenanceRow[];
  incidents?: OpsIncidentRow[];
  timeline?: OpsTimelineRow[];
}

export async function adminGenerateReleaseCandidates(days = 30): Promise<{ ok: boolean; run_id: string; candidates: number; ready: number; blocked: number; approvals_pending: number }> {
  const { data, error } = await supabase.rpc('admin_generate_release_candidates', { p_days: days });
  if (error) throw error;
  return data as { ok: boolean; run_id: string; candidates: number; ready: number; blocked: number; approvals_pending: number };
}

export async function adminGenerateRollbackPlan(runId: string | null = null): Promise<{ ok: boolean; run_id: string; plans: number; high_risk: number }> {
  const { data, error } = await supabase.rpc('admin_generate_rollback_plan', { p_run_id: runId });
  if (error) throw error;
  return data as { ok: boolean; run_id: string; plans: number; high_risk: number };
}

export async function adminGeneratePolicySnapshot(runId: string | null = null): Promise<{ ok: boolean; run_id: string; policies: number; versions: number; history: number }> {
  const { data, error } = await supabase.rpc('admin_generate_policy_snapshot', { p_run_id: runId });
  if (error) throw error;
  return data as { ok: boolean; run_id: string; policies: number; versions: number; history: number };
}

export async function adminGenerateIncidentSummary(runId: string | null = null): Promise<{ ok: boolean; run_id: string; incidents: number; maintenance: number }> {
  const { data, error } = await supabase.rpc('admin_generate_incident_summary', { p_run_id: runId });
  if (error) throw error;
  return data as { ok: boolean; run_id: string; incidents: number; maintenance: number };
}

export async function adminGenerateOperationTimeline(runId: string | null = null): Promise<{ ok: boolean; run_id: string; timeline: number; by_category: Record<string, number> }> {
  const { data, error } = await supabase.rpc('admin_generate_operation_timeline', { p_run_id: runId });
  if (error) throw error;
  return data as { ok: boolean; run_id: string; timeline: number; by_category: Record<string, number> };
}

export async function adminAiOperationsOverview(): Promise<AiOperationsOverview> {
  const { data, error } = await supabase.rpc('admin_ai_operations_overview');
  if (error) throw error;
  return data as AiOperationsOverview;
}
