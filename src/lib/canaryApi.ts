// Phase ALGO-7D — AI Canary Readiness Simulator (Shadow) API 래퍼 — Canary Simulation Layer.
// 0445 admin RPC 경유. Traffic Plan · Impact · Safety Gate · Rollback Simulation · Timeline · Certificate — 운영 미반영.
import { supabase } from './supabase';

export interface CanaryTrafficRow {
  stage: number; events: number; stores?: number; listeners: number; tracks: number;
  gate: string | null; rollback: boolean;
}
export interface CanaryImpactRow {
  stage: number; metric: string; kind: string | null; baseline: number | null; predicted: number | null;
  delta: number | null; direction: string | null;
}
export interface CanaryGateRow {
  stage: number; risk: boolean; drift: boolean; confidence: boolean; sla: boolean;
  governance: string | null; approval: string | null; policy: string | null; rollback: string | null; state: string | null;
}
export interface CanaryRollbackRow {
  stage: number; condition: string; triggered: boolean; threshold: number | null; observed: number | null; reason: string | null;
}
export interface CanaryTimelineRow { ts: string; stage?: number | null; category: string | null; event: string | null; detail?: string | null }

export interface CanaryOverview {
  has_data: boolean;
  run_id?: string | null;
  plan?: {
    run_at: string; window_days: number | null; store_count: number | null; listener_count: number | null;
    track_count: number | null; expected_events: number | null; stages: number[]; status: string | null; headline: string | null;
  };
  simulations?: CanaryTrafficRow[];
  impacts?: CanaryImpactRow[];
  gates?: CanaryGateRow[];
  rollback_sims?: CanaryRollbackRow[];
  certificate?: {
    max_safe_stage: number | null; overall_gate: string | null; overall_risk: string | null;
    rollback_conditions: number | null; gate_summary?: Record<string, number>; impact_summary?: Array<{ stage: number; risk: number }>; hash: string | null;
  };
  timeline?: CanaryTimelineRow[];
}

export async function adminGenerateCanaryPlan(days = 30): Promise<{ ok: boolean; run_id: string; stores: number; listeners: number; tracks: number; events: number }> {
  const { data, error } = await supabase.rpc('admin_generate_canary_plan', { p_days: days });
  if (error) throw error;
  return data as { ok: boolean; run_id: string; stores: number; listeners: number; tracks: number; events: number };
}
export async function adminGenerateCanaryImpact(runId: string | null = null): Promise<{ ok: boolean; run_id: string; rows: number }> {
  const { data, error } = await supabase.rpc('admin_generate_canary_impact', { p_run_id: runId });
  if (error) throw error;
  return data as { ok: boolean; run_id: string; rows: number };
}
export async function adminRunCanarySimulation(runId: string | null = null): Promise<{ ok: boolean; run_id: string; gates: Record<string, number>; rollback_stages: number }> {
  const { data, error } = await supabase.rpc('admin_run_canary_simulation', { p_run_id: runId });
  if (error) throw error;
  return data as { ok: boolean; run_id: string; gates: Record<string, number>; rollback_stages: number };
}
export async function adminGenerateCanaryCertificate(runId: string | null = null): Promise<{ ok: boolean; run_id: string; max_safe_stage: number; overall_gate: string; overall_risk: string; rollback_conditions: number; certificate_hash: string }> {
  const { data, error } = await supabase.rpc('admin_generate_canary_certificate', { p_run_id: runId });
  if (error) throw error;
  return data as { ok: boolean; run_id: string; max_safe_stage: number; overall_gate: string; overall_risk: string; rollback_conditions: number; certificate_hash: string };
}
export async function adminAiCanaryOverview(): Promise<CanaryOverview> {
  const { data, error } = await supabase.rpc('admin_ai_canary_overview');
  if (error) throw error;
  return data as CanaryOverview;
}
