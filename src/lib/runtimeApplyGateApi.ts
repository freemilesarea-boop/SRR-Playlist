// Phase ALGO-8E — Runtime Apply Governance Gate (Shadow) API 래퍼.
// 0449 admin RPC 경유. 0447/0448 Apply Package · Snapshot · Governance · Approval · Plan · Rollback · Observation · Certificate — 실제 Apply 금지.
import { supabase } from './supabase';

export interface PackageItem { seq: number; file: string; kind: string | null; description: string | null; rollback_sql: string | null }
export interface GovernanceCheck { key: string; category: string | null; passed: boolean; required: boolean; detail: string | null }
export interface ApplyStage { num: number; key: string | null; name: string | null; description: string | null; planned: boolean; executed: boolean; auto_execute: boolean }
export interface SuccessCriterion { scope: string | null; criterion: string; metric: string | null; expected: number | null; comparator: string | null; note: string | null }
export interface FailureCriterion { criterion: string; metric: string | null; condition: string | null; rollback_candidate: boolean }
export interface RollbackItem { order: number; target: string | null; rollback_sql: string | null; owner: string | null; checklist: string[]; validation_query: string | null; duration: string | null; state: string | null }
export interface ObservationWindow { label: string; offset: number | null; metrics: string[]; scheduled: boolean }

export interface ApplyGateOverview {
  has_data: boolean;
  package_id?: string | null;
  package?: { package_key: string; title: string | null; description: string | null; apply_order: string[]; status: string | null; created_at: string };
  items?: PackageItem[];
  snapshot?: {
    stream_ingest_v2_count: number; stream_sessions_v2_count: number; stream_events_count: number;
    playback_events_v2_count: number; playlist_tracks_count: number; v2_verified_streams_count: number;
    v2_eligible_streams_count: number; v2_settlement_eligible_streams_count: number; fraud_high_count: number;
    dispute_count: number; user_play_30s_count: number; identity_mismatch_count: number; generated_at: string;
  };
  governance?: GovernanceCheck[];
  approval?: { approval_request_id: string; requested_by: string | null; requested_at: string; reviewer: string | null; review_state: string; review_notes: string | null; expiration_at: string | null; hash: string | null };
  apply_plan?: ApplyStage[];
  success?: SuccessCriterion[];
  failure?: FailureCriterion[];
  rollback?: RollbackItem[];
  observation?: ObservationWindow[];
  certificate?: { gate_state: string | null; governance_passed: number | null; governance_total: number | null; approval_state: string | null; success_criteria_total: number | null; failure_criteria_total: number | null; apply_ready: boolean; hash: string | null };
  timeline?: Array<{ ts: string; category: string | null; event: string | null; detail: string | null }>;
}

export async function adminCreateRuntimeApplyPackage(): Promise<{ ok: boolean; package_id: string; items: number }> {
  const { data, error } = await supabase.rpc('admin_create_runtime_apply_package');
  if (error) throw error;
  return data as { ok: boolean; package_id: string; items: number };
}
export async function adminGeneratePreapplySnapshot(pkgId: string | null = null): Promise<{ ok: boolean }> {
  const { data, error } = await supabase.rpc('admin_generate_preapply_snapshot', { p_package_id: pkgId });
  if (error) throw error;
  return data as { ok: boolean };
}
export async function adminGenerateRuntimeApprovalRequest(pkgId: string | null = null, requestedBy = 'admin'): Promise<{ ok: boolean; approval_request_id: string; review_state: string }> {
  const { data, error } = await supabase.rpc('admin_generate_runtime_approval_request', { p_package_id: pkgId, p_requested_by: requestedBy });
  if (error) throw error;
  return data as { ok: boolean; approval_request_id: string; review_state: string };
}
export async function adminEvaluateRuntimeApplyGovernance(pkgId: string | null = null): Promise<{ ok: boolean; gate_state: string; passed: number; total: number }> {
  const { data, error } = await supabase.rpc('admin_evaluate_runtime_apply_governance', { p_package_id: pkgId });
  if (error) throw error;
  return data as { ok: boolean; gate_state: string; passed: number; total: number };
}
export async function adminGenerateLimitedApplyPlan(pkgId: string | null = null): Promise<{ ok: boolean; stages: number; windows: number }> {
  const { data, error } = await supabase.rpc('admin_generate_limited_apply_plan', { p_package_id: pkgId });
  if (error) throw error;
  return data as { ok: boolean; stages: number; windows: number };
}
export async function adminGenerateRuntimeRollbackPackage(pkgId: string | null = null): Promise<{ ok: boolean; rollback_items: number }> {
  const { data, error } = await supabase.rpc('admin_generate_runtime_rollback_package', { p_package_id: pkgId });
  if (error) throw error;
  return data as { ok: boolean; rollback_items: number };
}
export async function adminGenerateRuntimeApplyCertificate(pkgId: string | null = null): Promise<{ ok: boolean; gate_state: string; approval_state: string; apply_ready: boolean; certificate_hash: string }> {
  const { data, error } = await supabase.rpc('admin_generate_runtime_apply_certificate', { p_package_id: pkgId });
  if (error) throw error;
  return data as { ok: boolean; gate_state: string; approval_state: string; apply_ready: boolean; certificate_hash: string };
}
export async function adminRuntimeApplyGovernanceOverview(): Promise<ApplyGateOverview> {
  const { data, error } = await supabase.rpc('admin_runtime_apply_governance_overview');
  if (error) throw error;
  return data as ApplyGateOverview;
}
