// Phase ALGO-8G — Limited Runtime Apply Rehearsal (Shadow Validation) API 래퍼.
// 0451 admin RPC 경유. Apply Rehearsal(dry-run) · Validation · Observation · Rollback Drill · Runbook — view/원본 무변경.
import { supabase } from './supabase';

export interface ValidationRow { phase: string; metric: string; sql?: string; before: number | null; after: number | null; delta: number | null; comparator?: string; passed: boolean; note?: string }
export interface RunbookStep { step: number; phase: string; action: string; command: string; expected: string; executed: boolean }
export interface ObservationRow { label: string; offset: number | null; checklist: string[]; status: string }
export interface RollbackDrillRow { metric: string; sql: string; note: string }

export interface RehearsalOverview {
  has_data: boolean;
  rehearsal_id?: string | null;
  rehearsal?: {
    rehearsal_id: string; package_ref: string | null; apply_script: string[]; mode: string; status: string; stages: string[];
    verified_current: number; verified_rehearsed: number; eligible_current: number; eligible_rehearsed: number;
    settlement_current: number; settlement_rehearsed: number; headline: string | null; result: string | null; created_at: string;
  };
  validation?: ValidationRow[];
  rollback_drill?: RollbackDrillRow[];
  runbook?: RunbookStep[];
  observation?: ObservationRow[];
}

export async function adminRunApplyRehearsal(days = 30): Promise<{ ok: boolean; rehearsal_id: string; result: string; verified: { current: number; rehearsed: number }; eligible: { current: number; rehearsed: number }; settlement: { current: number; rehearsed: number } }> {
  const { data, error } = await supabase.rpc('admin_run_apply_rehearsal', { p_days: days });
  if (error) throw error;
  return data as { ok: boolean; rehearsal_id: string; result: string; verified: { current: number; rehearsed: number }; eligible: { current: number; rehearsed: number }; settlement: { current: number; rehearsed: number } };
}
export async function adminGenerateObservationReports(rehearsalId: string | null = null): Promise<{ ok: boolean; windows: number }> {
  const { data, error } = await supabase.rpc('admin_generate_observation_reports', { p_rehearsal_id: rehearsalId });
  if (error) throw error;
  return data as { ok: boolean; windows: number };
}
export async function adminGenerateRollbackDrill(rehearsalId: string | null = null): Promise<{ ok: boolean; rollback_steps: number }> {
  const { data, error } = await supabase.rpc('admin_generate_rollback_drill', { p_rehearsal_id: rehearsalId });
  if (error) throw error;
  return data as { ok: boolean; rollback_steps: number };
}
export async function adminRuntimeApplyRehearsalOverview(): Promise<RehearsalOverview> {
  const { data, error } = await supabase.rpc('admin_runtime_apply_rehearsal_overview');
  if (error) throw error;
  return data as RehearsalOverview;
}
