// AI-MUSIC-7 — Preview Runtime Canary API. Wraps the 0470 RPCs (allowlist / approval / arm / activate / pause /
// stop / rollback / complete / queue-snapshot / event ingest / certification / server-side candidate resolve /
// admin reads) and composes the rule-based aiPreviewCanary engines client-side. Every write is an explicit
// operator action gated on Preview environment + deployment id + allowlist + super-admin; nothing here starts a
// canary automatically, applies a candidate to the real queue (application is DEFERRED), controls the Player,
// or runs in production. Certification is internal-preview only. Fire-and-forget event ingest never blocks.

import { supabase } from '@/lib/supabase';
import {
  evaluateEnvironmentGate, resolveCanary, evaluateGuardrails, validateCandidateQueue,
  computePreviewCertification, computeProductionReadiness, getAiPreviewCanaryConfig,
  type EnvGateResult, type CanaryResolveInput, type CanaryResolveResult, type GuardrailSignals, type GuardrailResult,
  type CandidateQueueInput, type CandidateQueueResult, type PreviewCertInput, type PreviewCertResult, type ProductionReadinessResult,
} from '@/lib/aiPreviewCanary';

// ── Client-side environment gate (composed from config) ──
export function currentEnvGate(): EnvGateResult {
  const cfg = getAiPreviewCanaryConfig();
  let host = '';
  try { if (typeof window !== 'undefined') host = window.location.host; } catch { /* noop */ }
  const isProductionHost = /(^|\.)srr-playlist\.(app|com)$/i.test(host) || (!host.includes('vercel.app') && host !== '' && !host.includes('localhost'));
  return evaluateEnvironmentGate({
    mode: (() => { try { return String((import.meta.env as Record<string, unknown>).MODE ?? ''); } catch { return null; } })(),
    appEnv: cfg.appEnv, currentDeploymentId: cfg.currentDeploymentId, allowedDeploymentId: cfg.allowedDeploymentId, isProductionHost,
  });
}

// ── Pure engine passthroughs (no side effects) ──
export function resolvePreviewCanary(input: CanaryResolveInput): CanaryResolveResult { return resolveCanary(input); }
export function validatePreviewCandidateQueue(input: CandidateQueueInput): CandidateQueueResult { return validateCandidateQueue(input); }
export function evaluatePreviewGuardrails(s: GuardrailSignals): GuardrailResult { return evaluateGuardrails(s); }
export function buildPreviewCertification(input: PreviewCertInput, multiStore: boolean): { cert: PreviewCertResult; readiness: ProductionReadinessResult } {
  const cert = computePreviewCertification(input);
  return { cert, readiness: computeProductionReadiness(cert, multiStore) };
}

// ── Admin reads ──
export interface CanaryRunSummary {
  id: string; state: string; storeUid: string; environment: string; deploymentId: string;
  candidateVersion: number | null; activeSessions: number; createdAt: string;
}
export interface CanaryOverview { allowlistedStores: number; runs: CanaryRunSummary[]; }
export async function getCanaryOverview(limit = 50): Promise<CanaryOverview | null> {
  const { data, error } = await supabase.rpc('admin_ai_preview_canary_overview', { p_limit: limit });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean } & CanaryOverview;
  return res.ok ? { allowlistedStores: res.allowlistedStores ?? 0, runs: res.runs ?? [] } : null;
}
export interface CanaryRunDetail { run: Record<string, unknown> | null; sessions: unknown[]; snapshots: unknown[]; events: unknown[]; actions: unknown[]; certifications: unknown[]; }
export async function getCanaryRun(runId: string): Promise<CanaryRunDetail | null> {
  const { data, error } = await supabase.rpc('admin_ai_preview_canary_run', { p_run: runId });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean } & CanaryRunDetail;
  if (!res.ok) return null;
  return { run: res.run ?? null, sessions: res.sessions ?? [], snapshots: res.snapshots ?? [], events: res.events ?? [], actions: res.actions ?? [], certifications: res.certifications ?? [] };
}
export interface CanaryAllowlistRow { storeUid: string; environment: string; purpose: string; enabled: boolean; expiresAt: string; maxSessions: number; allowedCandidatePlaylistId: string | null; allowedCandidateVersion: number | null; }
export async function getCanaryAllowlist(limit = 100): Promise<CanaryAllowlistRow[]> {
  const { data, error } = await supabase.rpc('admin_ai_preview_canary_allowlist', { p_limit: limit });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; entries?: CanaryAllowlistRow[] };
  return res.ok ? (res.entries ?? []) : [];
}

// ── Allowlist writes (super-admin, preview-only) ──
export async function addAllowlistStore(input: { storeId: string; purpose: string; expiresAt: string; maxSessions: number; candidatePlaylistId: string | null; candidateVersion: number | null; notes: string; }): Promise<{ ok: boolean; id?: string }> {
  const { data, error } = await supabase.rpc('record_ai_preview_canary_allowlist', {
    p_store: input.storeId, p_environment: 'preview', p_purpose: input.purpose, p_expires_at: input.expiresAt,
    p_max_sessions: input.maxSessions, p_candidate_playlist: input.candidatePlaylistId, p_candidate_version: input.candidateVersion, p_notes: input.notes,
  });
  if (error) throw error;
  return (data ?? { ok: false }) as { ok: boolean; id?: string };
}
export async function setAllowlistEnabled(storeId: string, enabled: boolean, reason: string): Promise<{ ok: boolean }> {
  const { data, error } = await supabase.rpc('set_ai_preview_canary_allowlist_enabled', { p_store: storeId, p_enabled: enabled, p_reason: reason });
  if (error) throw error;
  return (data ?? { ok: false }) as { ok: boolean };
}

// ── Approval + lifecycle (each explicit; preview-only) ──
export async function recordCanaryApproval(input: {
  pilotRunId: string | null; storeId: string; deploymentId: string; candidatePlaylistId: string; candidateVersion: number;
  candidateSnapshotHash: string; scheduledStart: string; scheduledEnd: string; expiry: string; reason: string;
}): Promise<{ ok: boolean; id?: string }> {
  const { data, error } = await supabase.rpc('record_ai_preview_canary_approval', {
    p_pilot_run: input.pilotRunId, p_store: input.storeId, p_environment: 'preview', p_deployment_id: input.deploymentId,
    p_candidate_playlist: input.candidatePlaylistId, p_candidate_version: input.candidateVersion, p_candidate_snapshot_hash: input.candidateSnapshotHash,
    p_scheduled_start: input.scheduledStart, p_scheduled_end: input.scheduledEnd, p_expiry: input.expiry, p_reason: input.reason,
  });
  if (error) throw error;
  return (data ?? { ok: false }) as { ok: boolean; id?: string };
}
async function callAction(fn: string, runId: string, reason: string): Promise<{ ok: boolean; state?: string }> {
  const { data, error } = await supabase.rpc(fn, { p_run: runId, p_reason: reason });
  if (error) throw error;
  return (data ?? { ok: false }) as { ok: boolean; state?: string };
}
export const armCanary = (runId: string, reason: string) => callAction('arm_ai_preview_canary', runId, reason);
export const activateCanary = (runId: string, reason: string) => callAction('activate_ai_preview_canary', runId, reason);
export const pauseCanary = (runId: string, reason: string) => callAction('pause_ai_preview_canary', runId, reason);
export const requestCanaryStop = (runId: string, reason: string) => callAction('request_ai_preview_canary_stop', runId, reason);
export const stopCanary = (runId: string, reason: string) => callAction('stop_ai_preview_canary', runId, reason);
export const requestCanaryRollback = (runId: string, reason: string) => callAction('request_ai_preview_canary_rollback', runId, reason);
export const rollbackCanary = (runId: string, reason: string) => callAction('rollback_ai_preview_canary', runId, reason);
export const completeCanary = (runId: string, reason: string) => callAction('complete_ai_preview_canary', runId, reason);

export async function recordCanaryCertification(input: { runId: string; cert: PreviewCertResult; readiness: ProductionReadinessResult }): Promise<{ ok: boolean }> {
  const { data, error } = await supabase.rpc('record_ai_preview_canary_certification', {
    p_run: input.runId, p_score: input.cert.score, p_status: input.cert.status, p_readiness: input.readiness.state,
    p_components: input.cert.components, p_blockers: input.cert.blockers, p_limitations: input.cert.limitations,
  });
  if (error) throw error;
  return (data ?? { ok: false }) as { ok: boolean };
}

// Server-side candidate resolution (validation only; application DEFERRED — never mutates the queue/player).
export async function resolveCanaryCandidateServer(input: { runId: string; deploymentId: string; isTreatment: boolean; candidateVersion: number; candidateSnapshotHash: string; }): Promise<{ outcome: string; usedCandidate: boolean; candidatePlaylistId?: string | null }> {
  const { data, error } = await supabase.rpc('resolve_ai_preview_canary_candidate', {
    p_run: input.runId, p_environment: 'preview', p_deployment_id: input.deploymentId, p_is_treatment: input.isTreatment,
    p_candidate_version: input.candidateVersion, p_candidate_snapshot_hash: input.candidateSnapshotHash, p_now: new Date().toISOString(),
  });
  if (error) throw error;
  return (data ?? { outcome: 'USE_EXISTING', usedCandidate: false }) as { outcome: string; usedCandidate: boolean; candidatePlaylistId?: string | null };
}
