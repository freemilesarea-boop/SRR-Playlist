// AI-MUSIC-6 — Shadow Resolution & Runtime Certification API. Wraps the 0469 ingest RPC (store-attributed via
// auth.uid()) + the admin read/record RPCs, and composes the rule-based aiShadow engines client-side. NOTHING
// here changes the real playlist resolution, queue, or playback: the shadow is computed in parallel, fails open
// to the existing result, and is stored for analysis/certification only. No runtime integration and no canary
// is ever started — certification/readiness are advisory (max READY_FOR_MANUAL_CANARY_REVIEW).

import { supabase } from '@/lib/supabase';
import {
  resolveShadow, classifyDivergence, buildShadowEvent, eventName,
  certifyControlPreservation, certifyTreatmentEligibility, certifyFailOpen, computeCoverage,
  computeCertification, computeReadiness, shadowEvaluationAllowed, getAiShadowConfig,
  type ShadowResolverInput, type ShadowDecisionEvent, type CertificationResult, type ReadinessResult,
  type TreatmentEligibilityInput, type FailOpenCase,
} from '@/lib/aiShadow';

// ── Pure evaluation (client-side, fail-open) — produces an event WITHOUT touching real playback ──
export interface ShadowEvaluation { event: ShadowDecisionEvent; eventName: string; }
export function evaluateShadow(input: ShadowResolverInput, sessionToken: string): ShadowEvaluation {
  const shadow = resolveShadow(input);
  const divergence = classifyDivergence(input.existing, shadow, input.assignmentGroup);
  return { event: buildShadowEvent(input, shadow, divergence, sessionToken), eventName: eventName(divergence, shadow) };
}

// Fire-and-forget ingest. Guarded by the flag/kill-switch; any error is swallowed (never affects the caller).
// The caller MUST NOT await this in a playback/render critical path.
export function ingestShadowEventsBestEffort(events: ShadowDecisionEvent[]): void {
  if (!shadowEvaluationAllowed() || !getAiShadowConfig().eventIngestEnabled || events.length === 0) return;
  void supabase.rpc('ingest_ai_shadow_resolution_events', { p_events: events }).then(
    () => { /* ignore result */ },
    () => { /* swallow — shadow failure must never surface */ },
  );
}

// ── Admin reads (super-admin) ──
export interface ShadowOverview {
  sessionsEvaluated: number; shadowEvaluations: number; sameResult: number; expectedDivergence: number;
  unexpectedControlDivergence: number; versionMismatch: number; candidateMissing: number;
  assignmentConflict: number; resolverErrors: number; failOpen: number;
}
export async function getShadowOverview(days = 30): Promise<ShadowOverview | null> {
  const { data, error } = await supabase.rpc('admin_ai_shadow_overview', { p_days: days });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean } & ShadowOverview;
  return res.ok ? res : null;
}

export interface ShadowSessionRow { sessionHash: string; evalCount: number; lastEvaluatedAt: string; }
export async function getShadowSessions(days = 30, limit = 100): Promise<ShadowSessionRow[]> {
  const { data, error } = await supabase.rpc('admin_ai_shadow_sessions', { p_days: days, p_limit: limit });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; sessions?: ShadowSessionRow[] };
  return res.ok ? (res.sessions ?? []) : [];
}

export interface ShadowDivergenceRow { divergenceType: string; eventName: string; existingSource: string | null; shadowSource: string | null; reasonCode: string | null; evaluatedAt: string; }
export interface ShadowDivergences { byType: Record<string, number>; recent: ShadowDivergenceRow[]; }
export async function getShadowDivergences(days = 30, limit = 200): Promise<ShadowDivergences | null> {
  const { data, error } = await supabase.rpc('admin_ai_shadow_divergences', { p_days: days, p_limit: limit });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean } & ShadowDivergences;
  return res.ok ? { byType: res.byType ?? {}, recent: res.recent ?? [] } : null;
}

export interface ShadowTraceRow { eventName: string; divergenceType: string; existingSource: string | null; shadowSource: string | null; reasonCode: string | null; candidateVersion: number | null; evaluatedAt: string; }
export async function getShadowTrace(sessionHash: string, limit = 50): Promise<ShadowTraceRow[]> {
  const { data, error } = await supabase.rpc('admin_ai_shadow_trace', { p_session_hash: sessionHash, p_limit: limit });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; trace?: ShadowTraceRow[] };
  return res.ok ? (res.trace ?? []) : [];
}

export interface ShadowCertRow { id: string; pilotRunId: string | null; score: number | null; certStatus: string; readiness: string; components: Record<string, unknown>; blockers: string[]; createdAt: string; }
export async function getShadowCertifications(limit = 50): Promise<ShadowCertRow[]> {
  const { data, error } = await supabase.rpc('admin_ai_shadow_certification', { p_limit: limit });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; certifications?: ShadowCertRow[] };
  return res.ok ? (res.certifications ?? []) : [];
}

export async function recordShadowCertification(input: {
  pilotRunId: string | null; cert: CertificationResult; readiness: ReadinessResult;
}): Promise<{ ok: boolean; id?: string }> {
  const { data, error } = await supabase.rpc('record_ai_shadow_certification', {
    p_pilot_run: input.pilotRunId, p_score: input.cert.score, p_status: input.cert.status,
    p_readiness: input.readiness.state, p_components: input.cert.components,
    p_blockers: input.cert.blockers, p_limitations: input.cert.limitations,
  });
  if (error) throw error;
  return (data ?? { ok: false }) as { ok: boolean; id?: string };
}

// ── Compose a certification + readiness from the overview aggregate (rule engines; advisory only) ──
export interface CertificationBundle { cert: CertificationResult; readiness: ReadinessResult; }
export function buildCertification(
  overview: ShadowOverview,
  eligibilityInput: TreatmentEligibilityInput,
  failOpenCases: FailOpenCase[],
): CertificationBundle {
  const controlSessions = Math.max(0, overview.sessionsEvaluated - (overview.expectedDivergence > 0 ? 1 : 0));
  const control = certifyControlPreservation({
    controlSessions, controlDivergences: overview.unexpectedControlDivergence, minSamples: 30,
  });
  const eligibility = certifyTreatmentEligibility(eligibilityInput);
  const failOpen = certifyFailOpen(failOpenCases);
  const coverage = computeCoverage({
    storeSessionsEvaluated: overview.sessionsEvaluated, eligibleTreatmentSessions: overview.expectedDivergence,
    controlSessions, shadowEvaluations: overview.shadowEvaluations, sameResult: overview.sameResult,
    expectedDivergence: overview.expectedDivergence, unexpectedDivergence: overview.unexpectedControlDivergence,
    failOpenCount: overview.failOpen, resolverErrorCount: overview.resolverErrors,
    versionMismatchCount: overview.versionMismatch, candidateMissingCount: overview.candidateMissing,
    assignmentConflictCount: overview.assignmentConflict, minSessions: 100,
  });
  const evals = overview.shadowEvaluations || 1;
  const cert = computeCertification({
    control, failOpen, eligibility, coverage,
    candidateAvailabilityRate: 1 - overview.candidateMissing / evals,
    versionIntegrityRate: 1 - overview.versionMismatch / evals,
    assignmentIntegrityRate: 1 - overview.assignmentConflict / evals,
    resolverErrorRate: overview.resolverErrors / evals,
    queueCompatible: eligibilityInput.queueInputCompatible,
    rollbackReady: eligibilityInput.rollbackTargetExists,
  });
  const readiness = computeReadiness(cert, eligibility);
  return { cert, readiness };
}
