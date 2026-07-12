// AI-MUSIC-5 — Pilot Orchestration API. Wraps the 0468 read RPCs (pilot overview/detail/progress/observations/
// guardrails) and the approval-gated write RPCs (approval → activate → pause/resume → stop → rollback →
// complete + observation/guardrail records), and runs the rule-based aiPilot engines client-side. Every write
// is an explicit operator action; nothing here starts a pilot automatically, assigns a store to playback,
// deploys/updates an original playlist, controls the Player, or rolls out to production. The Treatment Override
// is preview-only (no runtime reads it — DEFERRED). All outputs are recommendation/draft requiring approval.

import { supabase } from '@/lib/supabase';
import {
  buildAssignmentSnapshot, monitorGuardrails, buildPilotProgress, evaluateCompletion, evaluateExpansion,
  type AssignmentSnapshotInput, type GuardrailSignals, type GuardrailMonitorResult, type PilotProgress,
  type CompletionInput, type CompletionResult, type ExpansionInput, type ExpansionResult, type PilotState,
} from '@/lib/aiPilot';

// ── Read models ─────────────────────────────────────────────────────────────
export interface PilotRunSummary {
  id: string; name: string; state: PilotState; experimentId: string | null;
  candidatePlaylistId: string | null; candidateVersion: number | null;
  scheduledStart: string | null; scheduledEnd: string | null; expiry: string | null;
  controlCount: number; treatmentCount: number; activeOverrides: number; createdAt: string | null;
}
export interface PilotAssignmentRow {
  id: string; storeId: string; arm: 'control' | 'treatment'; candidatePlaylistId: string | null;
  candidateVersion: number | null; previousPlaylistId: string | null; assignmentHash: string;
}
export interface PilotOverrideRow {
  id: string; storeId: string; arm: 'control' | 'treatment'; state: string;
  candidatePlaylistId: string | null; candidateVersion: number | null;
}
export interface PilotActionRow {
  action: string; fromState: string | null; toState: string | null; actor: string | null; reason: string | null; createdAt: string;
}
export interface PilotArm { stores: number; sessions: number; playbacks: number; completes?: number; skips?: number; likes?: number; completionRate?: number | null; skipRate?: number | null; streamingQualityScore: number | null; criticalIncidents: number | null; }

export async function getPilotOverview(limit = 50): Promise<PilotRunSummary[]> {
  const { data, error } = await supabase.rpc('admin_ai_pilot_overview', { p_limit: limit });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; runs?: PilotRunSummary[] };
  return res.ok ? (res.runs ?? []) : [];
}

export interface PilotRunDetail {
  run: Record<string, unknown> | null;
  assignments: PilotAssignmentRow[];
  overrides: PilotOverrideRow[];
  actions: PilotActionRow[];
}
export async function getPilotRun(runId: string): Promise<PilotRunDetail | null> {
  const { data, error } = await supabase.rpc('admin_ai_pilot_run', { p_run: runId });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean } & PilotRunDetail;
  if (!res.ok) return null;
  return { run: res.run ?? null, assignments: res.assignments ?? [], overrides: res.overrides ?? [], actions: res.actions ?? [] };
}

// Pilot progress: observational arm rollups (READ-ONLY) → engine-shaped progress + guardrail recommendation.
export interface PilotProgressBundle { arms: { control: PilotArm; treatment: PilotArm }; guardrail: GuardrailMonitorResult; }
export async function getPilotProgress(runId: string, days = 30): Promise<PilotProgressBundle | null> {
  const { data, error } = await supabase.rpc('admin_ai_pilot_progress', { p_run: runId, p_days: days });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; control?: PilotArm; treatment?: PilotArm };
  if (!res.ok || !res.control || !res.treatment) return null;
  // Guardrail signal sources (streaming/incident) are NOT_AVAILABLE in prod → honest NOT_AVAILABLE, never a fake PASS.
  const guardrail = monitorGuardrails(guardrailSignalsFromArms(res.control, res.treatment));
  return { arms: { control: res.control, treatment: res.treatment }, guardrail };
}

function guardrailSignalsFromArms(control: PilotArm, treatment: PilotArm): GuardrailSignals {
  const sampleSufficient = (control.sessions ?? 0) + (treatment.sessions ?? 0) >= 200;
  return {
    criticalIncident: null, streamingQualityDrop: null, stallIncrease: null, mediaErrorIncrease: null,
    recoveryFailIncrease: null, skipIncrease: null, dislikeIncrease: null, contamination: null,
    candidateVersionChanged: null, controlPlaylistChanged: null, sampleSufficient,
  };
}

/** Shape a PilotProgress view from a run summary + arm rollups (pure engine; read-only). */
export function shapeProgress(run: PilotRunSummary, arms: { control: PilotArm; treatment: PilotArm }, nowMs: number, guardrailStatus: GuardrailMonitorResult['status']): PilotProgress {
  const start = run.scheduledStart ? Date.parse(run.scheduledStart) : null;
  const end = run.scheduledEnd ? Date.parse(run.scheduledEnd) : null;
  const sessions = (arms.control.sessions ?? 0) + (arms.treatment.sessions ?? 0);
  const playbacks = (arms.control.playbacks ?? 0) + (arms.treatment.playbacks ?? 0);
  return buildPilotProgress({
    startMs: Number.isNaN(start ?? NaN) ? null : start, endMs: Number.isNaN(end ?? NaN) ? null : end, nowMs,
    storesActive: run.treatmentCount + run.controlCount, storesExcluded: 0, storesOffline: 0,
    sessionsCollected: sessions, playbacksCollected: playbacks,
    guardrailStatus, contamination: 'UNKNOWN', lastObservationMs: null,
  });
}

export interface PilotObservationRow { window: string; status: string; payload: Record<string, unknown>; createdAt: string; }
export async function getPilotObservations(runId: string, limit = 50): Promise<PilotObservationRow[]> {
  const { data, error } = await supabase.rpc('admin_ai_pilot_observations', { p_run: runId, p_limit: limit });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; observations?: PilotObservationRow[] };
  return res.ok ? (res.observations ?? []) : [];
}

export interface PilotGuardrailRow { status: string; triggers: string[]; recommendation: string | null; createdAt: string; }
export async function getPilotGuardrails(runId: string, limit = 50): Promise<PilotGuardrailRow[]> {
  const { data, error } = await supabase.rpc('admin_ai_pilot_guardrails', { p_run: runId, p_limit: limit });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; guardrails?: PilotGuardrailRow[] };
  return res.ok ? (res.guardrails ?? []) : [];
}

// ── Approval-gated writes (each is an explicit operator action; none auto-executes) ──
export interface ApprovalAssignmentDraft {
  storeId: string; arm: 'control' | 'treatment';
  candidatePlaylistId?: string | null; candidateVersion?: number | null;
  previousPlaylistId?: string | null; previousPlaylistVersion?: number | null;
}

/** Compute deterministic immutable-snapshot hashes client-side, then record the APPROVAL (state=APPROVED). This
 *  stores the approval + immutable assignment snapshots; it NEVER activates the pilot or creates any override. */
export async function recordApproval(input: {
  experimentId: string | null; name: string; candidatePlaylistId: string; candidateVersion: number;
  scheduledStart: string; scheduledEnd: string; expiry: string; reason: string; assignments: ApprovalAssignmentDraft[];
}): Promise<{ ok: boolean; id?: string; assignmentsStored?: number }> {
  const withHash = input.assignments.map((a) => {
    const snapInput: AssignmentSnapshotInput = {
      experimentId: input.experimentId ?? '', storeId: a.storeId, group: a.arm,
      candidatePlaylistId: a.arm === 'control' ? null : (a.candidatePlaylistId ?? input.candidatePlaylistId),
      candidateVersion: a.arm === 'control' ? null : (a.candidateVersion ?? input.candidateVersion),
      previousPlaylistId: a.previousPlaylistId ?? null, previousPlaylistVersion: a.previousPlaylistVersion ?? null,
      approvedBy: null, approvedAt: null, scheduledStart: Date.parse(input.scheduledStart),
      scheduledEnd: Date.parse(input.scheduledEnd), expiry: Date.parse(input.expiry),
      rollbackTarget: a.previousPlaylistId ?? null, snapshotVersion: 1,
    };
    const snap = buildAssignmentSnapshot(snapInput);
    return {
      storeId: a.storeId, arm: a.arm,
      candidatePlaylistId: snap.candidatePlaylistId, candidateVersion: snap.candidateVersion,
      previousPlaylistId: a.previousPlaylistId ?? null, previousPlaylistVersion: a.previousPlaylistVersion ?? null,
      assignmentHash: snap.assignmentHash,
    };
  });
  const { data, error } = await supabase.rpc('record_ai_pilot_approval', {
    p_experiment: input.experimentId, p_name: input.name, p_candidate: input.candidatePlaylistId, p_version: input.candidateVersion,
    p_scheduled_start: input.scheduledStart, p_scheduled_end: input.scheduledEnd, p_expiry: input.expiry,
    p_reason: input.reason, p_assignments: withHash,
  });
  if (error) throw error;
  return (data ?? { ok: false }) as { ok: boolean; id?: string; assignmentsStored?: number };
}

async function callAction(fn: string, runId: string, reason: string): Promise<{ ok: boolean; state?: string }> {
  const { data, error } = await supabase.rpc(fn, { p_run: runId, p_reason: reason });
  if (error) throw error;
  return (data ?? { ok: false }) as { ok: boolean; state?: string };
}
export const activatePilot = (runId: string, reason: string) => callAction('activate_ai_pilot', runId, reason);
export const pausePilot = (runId: string, reason: string) => callAction('pause_ai_pilot', runId, reason);
export const resumePilot = (runId: string, reason: string) => callAction('resume_ai_pilot', runId, reason);
export const requestPilotStop = (runId: string, reason: string) => callAction('request_ai_pilot_stop', runId, reason);
export const stopPilot = (runId: string, reason: string) => callAction('stop_ai_pilot', runId, reason);
export const requestPilotRollback = (runId: string, reason: string) => callAction('request_ai_pilot_rollback', runId, reason);
export const rollbackPilot = (runId: string, reason: string) => callAction('rollback_ai_pilot', runId, reason);
export const completePilot = (runId: string, reason: string) => callAction('complete_ai_pilot', runId, reason);

export async function recordObservation(runId: string, window: string, status: string, payload: Record<string, unknown>): Promise<{ ok: boolean }> {
  const { data, error } = await supabase.rpc('record_ai_pilot_observation', { p_run: runId, p_window: window, p_status: status, p_payload: payload });
  if (error) throw error;
  return (data ?? { ok: false }) as { ok: boolean };
}
export async function recordGuardrail(runId: string, status: string, triggers: string[], recommendation: string): Promise<{ ok: boolean }> {
  const { data, error } = await supabase.rpc('record_ai_pilot_guardrail', { p_run: runId, p_status: status, p_triggers: triggers, p_recommendation: recommendation });
  if (error) throw error;
  return (data ?? { ok: false }) as { ok: boolean };
}

// ── Pure engine passthroughs (client-side rule engines; no execution) ──
export function computeCompletion(input: CompletionInput): CompletionResult { return evaluateCompletion(input); }
export function computeExpansion(input: ExpansionInput): ExpansionResult { return evaluateExpansion(input); }
