// Phase ALGO-7A — AI Control Center (Unified AI Operations Dashboard, Shadow) API 래퍼.
// 0442 admin RPC 경유. Engine Registry · Health · Pipeline · Incident · Metrics · Timeline — 운영 미반영(읽기 전용 관찰).
import { supabase } from './supabase';

export interface EngineRow {
  key: string; name: string | null; category?: string | null;
  status: string; health: number | null; present: boolean; rows: number | null; note: string | null;
}
export interface PipelineStage {
  order: number; key?: string; name: string | null; engine?: string | null;
  health: number | null; latency?: number | null; status: string; throughput: number | null;
}
export interface IncidentRow {
  type: string; engine?: string | null; priority: string; severity?: number | null;
  count: number; summary: string | null; recommendation?: string | null;
}
export interface MetricRow {
  key: string; label: string | null; value: number | null; unit?: string | null;
  band: string | null; source?: string | null; note?: string | null;
}
export interface TimelineRow {
  ts: string; category: string | null; engine?: string | null; event: string | null; detail?: string | null;
}

export interface AiControlOverview {
  has_data: boolean;
  run_id?: string | null;
  summary?: {
    run_at: string; window_days: number | null; overall_health: number | null; overall_score: number | null;
    engines_total: number; engines_ready: number; engines_warning: number; engines_blocked: number;
    engines_shadow: number; engines_unknown: number; incidents_total: number | null; incidents_critical: number | null; headline: string | null;
  };
  engines?: EngineRow[];
  health?: Array<{ key: string; score: number | null; latency: number | null; status: string; note: string | null }>;
  pipeline?: PipelineStage[];
  incidents?: IncidentRow[];
  metrics?: MetricRow[];
  timeline?: TimelineRow[];
}

export async function adminGenerateAiHealth(days = 30): Promise<{ ok: boolean; run_id: string; engines_total: number; overall_health: number | null; ready: number; warning: number; shadow: number; unknown: number }> {
  const { data, error } = await supabase.rpc('admin_generate_ai_health', { p_days: days });
  if (error) throw error;
  return data as { ok: boolean; run_id: string; engines_total: number; overall_health: number | null; ready: number; warning: number; shadow: number; unknown: number };
}

export async function adminGeneratePipelineStatus(runId: string | null = null): Promise<{ ok: boolean; run_id: string; stages: number; blocked: number; warning: number }> {
  const { data, error } = await supabase.rpc('admin_generate_pipeline_status', { p_run_id: runId });
  if (error) throw error;
  return data as { ok: boolean; run_id: string; stages: number; blocked: number; warning: number };
}

export async function adminGenerateAiIncidents(runId: string | null = null): Promise<{ ok: boolean; run_id: string; total: number; critical: number; high: number; by_type: Record<string, number> }> {
  const { data, error } = await supabase.rpc('admin_generate_ai_incidents', { p_run_id: runId });
  if (error) throw error;
  return data as { ok: boolean; run_id: string; total: number; critical: number; high: number; by_type: Record<string, number> };
}

export async function adminGenerateAiMetrics(runId: string | null = null): Promise<{ ok: boolean; run_id: string; metrics: number; computed: number; timeline: number }> {
  const { data, error } = await supabase.rpc('admin_generate_ai_metrics', { p_run_id: runId });
  if (error) throw error;
  return data as { ok: boolean; run_id: string; metrics: number; computed: number; timeline: number };
}

export async function adminAiControlOverview(): Promise<AiControlOverview> {
  const { data, error } = await supabase.rpc('admin_ai_control_overview');
  if (error) throw error;
  return data as AiControlOverview;
}
