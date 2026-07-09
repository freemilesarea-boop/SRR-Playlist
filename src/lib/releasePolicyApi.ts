// Phase ALGO-7C — AI Release & Policy Manager (Shadow) API 래퍼 — Release Governance Layer.
// 0444 admin RPC 경유. Readiness · Policy Compliance · Approval Gate · Rollback Verification · Risk Matrix · Decision · Certificate — 운영 미반영.
import { supabase } from './supabase';

export interface ReadinessRow {
  component: string; candidate: string | null; policy: string | null; approval: string | null; rollback: string | null;
  incident: string | null; governance: string | null; observability: string | null; streaming: string | null;
  settlement: string | null; final: string | null; score: number | null;
}
export interface ComplianceRow {
  domain: string; version: boolean; checksum: boolean; history: boolean; diff: boolean; expired: boolean;
  needs_review: boolean; state: string | null;
}
export interface GateRow { component: string; required: boolean; state: string | null; human: boolean; gate: string | null }
export interface RollbackCheckRow {
  component: string; plan: boolean; steps: boolean; checklist: boolean; dependency: boolean; risk: string | null;
  sim_only: boolean; not_executed: boolean; state: string | null;
}
export interface RiskRow {
  component: string; technical: string; policy: string; approval: string; rollback: string; incident: string;
  governance: string; observability: string; overall: string; score: number | null;
}
export interface DecisionRow {
  component: string; candidate_id: string | null; state: string | null; reason: string | null;
  blockers: string[]; warnings: string[]; required_actions: string[];
}
export interface CertificateRow {
  component: string; policy: string | null; approval: string | null; rollback: string | null;
  governance_gate: string | null; observability: string | null; incident: string | null; hash: string | null;
}
export interface RelTimelineRow { ts: string; category: string | null; component?: string | null; event: string | null; detail?: string | null }

export interface ReleasePolicyOverview {
  has_data: boolean;
  run_id?: string | null;
  summary?: {
    components: number; ready: number; needs_approval: number; needs_policy_review?: number; blocked: number;
    certificates: number; risk: Record<string, number>;
  };
  readiness?: ReadinessRow[];
  policy?: ComplianceRow[];
  approvals?: GateRow[];
  rollback?: RollbackCheckRow[];
  risk_matrix?: RiskRow[];
  decisions?: DecisionRow[];
  certificates?: CertificateRow[];
  timeline?: RelTimelineRow[];
}

export async function adminGenerateReleaseReadiness(days = 30): Promise<{ ok: boolean; run_id: string }> {
  const { data, error } = await supabase.rpc('admin_generate_release_readiness', { p_days: days });
  if (error) throw error;
  return data as { ok: boolean; run_id: string };
}
export async function adminGeneratePolicyCompliance(runId: string | null = null): Promise<{ ok: boolean }> {
  const { data, error } = await supabase.rpc('admin_generate_policy_compliance', { p_run_id: runId });
  if (error) throw error;
  return data as { ok: boolean };
}
export async function adminGenerateApprovalGateCheck(runId: string | null = null): Promise<{ ok: boolean }> {
  const { data, error } = await supabase.rpc('admin_generate_approval_gate_check', { p_run_id: runId });
  if (error) throw error;
  return data as { ok: boolean };
}
export async function adminGenerateRollbackVerification(runId: string | null = null): Promise<{ ok: boolean }> {
  const { data, error } = await supabase.rpc('admin_generate_rollback_verification', { p_run_id: runId });
  if (error) throw error;
  return data as { ok: boolean };
}
export async function adminGenerateReleaseCertificate(runId: string | null = null): Promise<{ ok: boolean; certificates: number }> {
  const { data, error } = await supabase.rpc('admin_generate_release_certificate', { p_run_id: runId });
  if (error) throw error;
  return data as { ok: boolean; certificates: number };
}
export async function adminAiReleasePolicyOverview(): Promise<ReleasePolicyOverview> {
  const { data, error } = await supabase.rpc('admin_ai_release_policy_overview');
  if (error) throw error;
  return data as ReleasePolicyOverview;
}
