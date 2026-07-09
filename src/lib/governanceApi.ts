// Phase ALGO-6F — SLA Streak Ledger & AI Governance (Shadow) API 래퍼.
// 0440 admin RPC 경유. Append-only SLA Ledger · Governance Gate · Integrity · Certificate — 운영 미반영.
import { supabase } from './supabase';

export interface LedgerEntry {
  seq: number; state: string; score: number | null; accuracy: number | null; risk: number | null;
  entry_hash: string; prev_hash: string; at: string;
}
export interface GovGate {
  gate_state: string; current_streak: number; consecutive_pass_months: number;
  reasons: Record<string, unknown>; computed_at: string;
}
export interface GovStreak {
  consecutive_pass_days: number; consecutive_pass_weeks: number; consecutive_pass_months: number;
  best_streak: number; current_streak: number; failure_count: number; recovery_count: number; total_entries: number;
}
export interface LedgerIntegrity {
  ledger_name: string; entries_checked: number; chain_valid: boolean; tamper_detected: boolean;
  checksum: string; verified_at: string;
}
export interface Certificate {
  certificate_version: number; gate_state: string | null; cert_hash: string; issued_at: string;
}
export interface Approval {
  seq: number; request: string; result: string; reason: string | null; at: string;
}
export interface AuditEntry { action: string; why: string | null; at: string }

export interface GovernanceOverview {
  has_data: boolean;
  gate?: GovGate | null;
  streak?: GovStreak | null;
  ledger?: LedgerEntry[];
  integrity?: LedgerIntegrity | null;
  certificate?: Certificate | null;
  approvals?: Approval[];
  audit?: AuditEntry[];
  counts?: { sla_entries: number; gov_entries: number; certificates: number };
}

export interface AppendResult { ok: boolean; seq: number; sla_state: string; sla_score: number | null; accuracy: number | null; risk: number | null; sample_size: number; entry_hash: string; prev_hash: string }
export interface GateResult { ok: boolean; gate_state: string; current_streak: number; consecutive_pass_days: number; consecutive_pass_months: number; best_streak: number; failure_count: number; reasons: Record<string, unknown> }
export interface IntegrityResult { ok: boolean; ledger: string; entries_checked: number; chain_valid: boolean; tamper_detected: boolean; first_hash: string; last_hash: string; checksum: string }
export interface CertResult { ok: boolean; certificate_id: string; certificate_version: number; gate_state: string | null; cert_hash: string }

export async function adminAppendSlaLedger(days = 120): Promise<AppendResult> {
  const { data, error } = await supabase.rpc('admin_append_sla_ledger', { p_days: days });
  if (error) throw error;
  return data as AppendResult;
}

export async function adminGenerateGovernanceGate(): Promise<GateResult> {
  const { data, error } = await supabase.rpc('admin_generate_governance_gate');
  if (error) throw error;
  return data as GateResult;
}

export async function adminVerifyLedgerIntegrity(ledger: 'sla_ledger' | 'governance_ledger' = 'sla_ledger'): Promise<IntegrityResult> {
  const { data, error } = await supabase.rpc('admin_verify_ledger_integrity', { p_ledger: ledger });
  if (error) throw error;
  return data as IntegrityResult;
}

export async function adminGenerateShadowCertificate(): Promise<CertResult> {
  const { data, error } = await supabase.rpc('admin_generate_shadow_certificate');
  if (error) throw error;
  return data as CertResult;
}

export async function adminAiGovernanceOverview(): Promise<GovernanceOverview> {
  const { data, error } = await supabase.rpc('admin_ai_governance_overview');
  if (error) throw error;
  return data as GovernanceOverview;
}
