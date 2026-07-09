// Phase ALGO-6D — Continuous Observability Scheduler (Shadow) API 래퍼.
// 0439 admin RPC 경유. Schedule · Run Chain · Snapshot · Streak · SLA · Digest · Backfill — 운영 미반영.
import { supabase } from './supabase';

export interface ObsSchedule { key: string; type: string; enabled: boolean; steps: number }
export interface ObsRunStep { order: number; step: string; status: string }
export interface ObsSnapshot {
  accuracy: number | null; risk: number | null; drift: number | null; confidence: number | null;
  promotion_score: number | null; readiness_state: string | null; alert_count: number; regression_count: number;
  stable_window_count: number; critical_window_count: number; sample_size: number; snapshot_at: string;
}
export interface ObsStreak {
  consecutive_stable_days: number; consecutive_stable_weeks: number; consecutive_stable_months: number;
  stable_7d_count: number; stable_30d_count: number; stable_90d_count: number;
  last_critical_at: string | null; last_warning_at: string | null; readiness_streak: number;
}
export interface ObsSlaCheck { req: number; val: number | null; pass: boolean }
export interface ObsSlaResult {
  sla_status: string; evaluated_at: string;
  checks: { total?: number; passed?: number; [k: string]: ObsSlaCheck | number | string | undefined };
}
export interface ObsDigest {
  type: string; alerts: number; regressions: number; sla_fail: number; message: string; at: string;
}
export interface ObsBackfillPlan { from: string | null; to: string | null; cadence: string; planned_runs: number; status: string }
export interface ObsSlaPolicy {
  key: string; min_accuracy: number; max_risk: number; max_drift: number; min_days: number; min_months: number;
}

export interface ObservabilityOverview {
  has_data: boolean;
  latest_run_id?: string | null;
  schedules?: ObsSchedule[];
  run_steps?: ObsRunStep[];
  snapshot?: ObsSnapshot | null;
  streak?: ObsStreak | null;
  sla_policies?: ObsSlaPolicy[];
  sla_result?: ObsSlaResult | null;
  digests?: ObsDigest[];
  backfill_plans?: ObsBackfillPlan[];
}

export type ScheduleType = 'daily_shadow_observability' | 'weekly_shadow_observability' | 'monthly_shadow_observability' | 'manual_shadow_observability' | 'backfill_shadow_observability';
export type DigestType = 'daily_digest' | 'weekly_digest' | 'monthly_digest' | 'incident_digest';

export interface ScheduleResult { ok: boolean; schedule_id: string; schedule_key: string; schedule_type: string; enabled: boolean; backfill_plan_id: string | null }
export interface RunResult { ok: boolean; run_id: string; snapshot_id: string; accuracy: number | null; risk: number | null; drift: number | null; sample_size: number }
export interface StreakResult { ok: boolean; consecutive_stable_days: number; consecutive_stable_months: number; stable_7d: number; stable_30d: number; stable_90d: number }
export interface SlaResult { ok: boolean; sla_status: string; checks: Record<string, unknown> }
export interface DigestResult { ok: boolean; digest_id: string; digest_type: string; alert_count: number; sla_fail_count: number; message: string }

export async function adminCreateObservabilitySchedule(scheduleKey: string, scheduleType: ScheduleType = 'manual_shadow_observability', description: string | null = null, backfillFrom: string | null = null, backfillTo: string | null = null, cadence = 'daily'): Promise<ScheduleResult> {
  const { data, error } = await supabase.rpc('admin_create_observability_schedule', {
    p_schedule_key: scheduleKey, p_schedule_type: scheduleType, p_description: description,
    p_backfill_from: backfillFrom, p_backfill_to: backfillTo, p_cadence: cadence,
  });
  if (error) throw error;
  return data as ScheduleResult;
}

export async function adminRunObservabilitySnapshot(scheduleId: string | null = null, runType: ScheduleType = 'manual_shadow_observability', days = 120): Promise<RunResult> {
  const { data, error } = await supabase.rpc('admin_run_observability_snapshot', { p_schedule_id: scheduleId, p_run_type: runType, p_days: days });
  if (error) throw error;
  return data as RunResult;
}

export async function adminCalculateStabilityStreak(runId: string | null = null): Promise<StreakResult> {
  const { data, error } = await supabase.rpc('admin_calculate_stability_streak', { p_run_id: runId });
  if (error) throw error;
  return data as StreakResult;
}

export async function adminEvaluateObservabilitySla(runId: string | null = null, policyId: string | null = null): Promise<SlaResult> {
  const { data, error } = await supabase.rpc('admin_evaluate_observability_sla', { p_run_id: runId, p_policy_id: policyId });
  if (error) throw error;
  return data as SlaResult;
}

export async function adminGenerateObservabilityDigest(digestType: DigestType = 'daily_digest', runId: string | null = null): Promise<DigestResult> {
  const { data, error } = await supabase.rpc('admin_generate_observability_digest', { p_digest_type: digestType, p_run_id: runId });
  if (error) throw error;
  return data as DigestResult;
}

export async function adminAiObservabilityOverview(): Promise<ObservabilityOverview> {
  const { data, error } = await supabase.rpc('admin_ai_observability_overview');
  if (error) throw error;
  return data as ObservabilityOverview;
}
