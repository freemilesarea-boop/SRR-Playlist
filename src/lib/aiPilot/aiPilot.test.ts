// AI-MUSIC-5 — Approval-gated pilot orchestration engine tests. Rule-based (no LLM/ML). Every result is a
// recommendation/draft gated behind operator approval — never executed (requiresApproval:true, automated:false,
// executed:false). No auto start/assign/deploy/expand/stop/rollback. Control stores get no override; original
// playlists are never modified; version pins are enforced; overrides fail OPEN to the existing path. Honest
// NO_DATA / NOT_AVAILABLE / INSUFFICIENT_DATA; small samples never complete a pilot; kill switch defaults OFF.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  canTransition, transition, allowedNext, isTerminal,
  computeApproval, buildAssignmentSnapshot, verifyImmutable, resolveStorePlaylist,
  monitorGuardrails, classifyWindow, windowForElapsed, buildObservationSnapshot,
  buildPilotProgress, evaluateCompletion, evaluateExpansion,
  getAiPilotConfig, __resetAiPilotConfig,
  PILOT_MIN_SESSIONS, PILOT_MIN_PLAYBACKS,
} from './index';
import type { ApprovalInput, AssignmentSnapshotInput, PilotOverride, StoreResolutionInput, GuardrailSignals, CompletionInput } from './types';

const NOW = 1_700_000_000_000;

function approvalInput(o: Partial<ApprovalInput> = {}): ApprovalInput {
  return {
    planExists: true, planStatus: 'APPROVED_FOR_MANUAL_SETUP', candidatePlaylistId: 'pl-cand',
    candidateVersion: 3, groupsConfirmed: true, eligibilityRevalidated: true, duplicateExperiment: false,
    streamingGuardrailAvailable: true, criticalIncident: false, storeOffline: false,
    scheduledStart: NOW + 3_600_000, scheduledEnd: NOW + 10 * 86_400_000, rollbackSnapshotExists: true,
    approver: 'op-1', reason: 'manual pilot setup', expiry: NOW + 86_400_000, nowMs: NOW, ...o,
  };
}
function assignmentInput(o: Partial<AssignmentSnapshotInput> = {}): AssignmentSnapshotInput {
  return {
    experimentId: 'exp-1', storeId: 's1', group: 'treatment', candidatePlaylistId: 'pl-cand',
    candidateVersion: 3, previousPlaylistId: 'pl-prev', previousPlaylistVersion: 1, approvedBy: 'op-1',
    approvedAt: NOW, scheduledStart: NOW, scheduledEnd: NOW + 86_400_000, expiry: NOW + 2 * 86_400_000,
    rollbackTarget: 'pl-prev', snapshotVersion: 1, ...o,
  };
}
function override(o: Partial<PilotOverride> = {}): PilotOverride {
  return {
    experimentId: 'exp-1', assignmentId: 'a1', storeId: 's1', group: 'treatment',
    candidatePlaylistId: 'pl-cand', candidateVersion: 3, state: 'ACTIVE',
    start: NOW - 1000, end: NOW + 86_400_000, expiry: NOW + 2 * 86_400_000, ...o,
  };
}
function resolutionInput(o: Partial<StoreResolutionInput> = {}): StoreResolutionInput {
  return {
    storeId: 's1', override: override(), expectedCandidateVersion: 3, storePlaylistId: 'pl-store',
    brandPlaylistId: 'pl-brand', fallbackPlaylistId: 'pl-fb', nowMs: NOW, ...o,
  };
}
function guardrailSignals(o: Partial<GuardrailSignals> = {}): GuardrailSignals {
  return {
    criticalIncident: false, streamingQualityDrop: 0, stallIncrease: 0, mediaErrorIncrease: 0,
    recoveryFailIncrease: 0, skipIncrease: 0, dislikeIncrease: 0, contamination: false,
    candidateVersionChanged: false, controlPlaylistChanged: false, sampleSufficient: true, ...o,
  };
}
function completionInput(o: Partial<CompletionInput> = {}): CompletionInput {
  return {
    elapsedMs: 8 * 86_400_000, minDurationMs: 7 * 86_400_000, sessions: 300, minSessions: PILOT_MIN_SESSIONS,
    playbacks: 1500, minPlaybacks: PILOT_MIN_PLAYBACKS, finalSnapshotExists: true, criticalGuardrailFailure: false,
    contamination: 'CLEAN', operatorApproved: false, ...o,
  };
}

// ── State machine ────────────────────────────────────────────────────────────────
describe('state machine', () => {
  it('allows a listed transition', () => {
    expect(canTransition('ACTIVE', 'PAUSED')).toBe(true);
    expect(transition('ACTIVE', 'PAUSED').ok).toBe(true);
  });
  it('rejects an unlisted transition', () => {
    const r = transition('DRAFT', 'ACTIVE');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('금지 전이');
  });
  it('rejects same-state transition', () => {
    expect(transition('ACTIVE', 'ACTIVE').ok).toBe(false);
  });
  it('terminal states cannot re-activate', () => {
    for (const t of ['COMPLETED', 'CANCELLED', 'ROLLED_BACK', 'FAILED', 'EXPIRED'] as const) {
      expect(isTerminal(t)).toBe(true);
      expect(transition(t, 'ACTIVE').ok).toBe(false);
      expect(allowedNext(t)).toEqual([]);
    }
  });
  it('rollback path is request → confirm only', () => {
    expect(canTransition('STOPPED', 'ROLLBACK_REQUESTED')).toBe(true);
    expect(canTransition('ROLLBACK_REQUESTED', 'ROLLED_BACK')).toBe(true);
    expect(canTransition('ACTIVE', 'ROLLED_BACK')).toBe(false);   // no direct/auto rollback
  });
  it('pause then resume is allowed', () => {
    expect(canTransition('ACTIVE', 'PAUSED')).toBe(true);
    expect(canTransition('PAUSED', 'ACTIVE')).toBe(true);
  });
  it('stop is request → confirm', () => {
    expect(canTransition('ACTIVE', 'STOP_REQUESTED')).toBe(true);
    expect(canTransition('STOP_REQUESTED', 'STOPPED')).toBe(true);
  });
});

// ── Approval gate ────────────────────────────────────────────────────────────────
describe('approval gate', () => {
  it('APPROVED when all prerequisites met', () => {
    const a = computeApproval(approvalInput());
    expect(a.status).toBe('APPROVED');
    expect(a.requiresApproval).toBe(true);
    expect(a.automated).toBe(false);
    expect(a.executed).toBe(false);            // approval never activates
  });
  it('REJECTED when plan status wrong', () => {
    expect(computeApproval(approvalInput({ planStatus: 'DRAFT' })).status).toBe('REJECTED');
  });
  it('REJECTED when candidate version not pinned but plan/start present → still INSUFFICIENT_DATA', () => {
    expect(computeApproval(approvalInput({ candidateVersion: null })).status).toBe('INSUFFICIENT_DATA');
  });
  it('REJECTED when rollback snapshot missing', () => {
    expect(computeApproval(approvalInput({ rollbackSnapshotExists: false })).status).toBe('REJECTED');
  });
  it('REJECTED on critical incident / store offline', () => {
    expect(computeApproval(approvalInput({ criticalIncident: true })).status).toBe('REJECTED');
    expect(computeApproval(approvalInput({ storeOffline: true })).status).toBe('REJECTED');
  });
  it('EXPIRED when expiry passed', () => {
    expect(computeApproval(approvalInput({ expiry: NOW - 1 })).status).toBe('EXPIRED');
  });
  it('NEEDS_INVESTIGATION when streaming guardrail NOT_AVAILABLE', () => {
    const a = computeApproval(approvalInput({ streamingGuardrailAvailable: false }));
    expect(a.status).toBe('NEEDS_INVESTIGATION');
    expect(a.warnings.length).toBeGreaterThan(0);
  });
  it('INSUFFICIENT_DATA when plan missing', () => {
    expect(computeApproval(approvalInput({ planExists: false })).status).toBe('INSUFFICIENT_DATA');
  });
});

// ── Assignment snapshot + immutability ───────────────────────────────────────────
describe('assignment snapshot', () => {
  it('produces a stable deterministic hash', () => {
    const a = buildAssignmentSnapshot(assignmentInput());
    const b = buildAssignmentSnapshot(assignmentInput());
    expect(a.assignmentHash).toBe(b.assignmentHash);
    expect(a.assignmentHash).toMatch(/^[0-9a-f]{8}$/);
  });
  it('different binding → different hash', () => {
    const a = buildAssignmentSnapshot(assignmentInput());
    const b = buildAssignmentSnapshot(assignmentInput({ candidateVersion: 4 }));
    expect(a.assignmentHash).not.toBe(b.assignmentHash);
  });
  it('control snapshot never carries a candidate playlist/version', () => {
    const c = buildAssignmentSnapshot(assignmentInput({ group: 'control' }));
    expect(c.candidatePlaylistId).toBeNull();
    expect(c.candidateVersion).toBeNull();
  });
  it('verifyImmutable passes for identical snapshot', () => {
    const a = buildAssignmentSnapshot(assignmentInput());
    expect(verifyImmutable(a, a).ok).toBe(true);
  });
  it('detects a mutated immutable field', () => {
    const a = buildAssignmentSnapshot(assignmentInput());
    const tampered = { ...a, candidatePlaylistId: 'pl-evil' };
    const chk = verifyImmutable(a, tampered);
    expect(chk.ok).toBe(false);
    expect(chk.changed).toContain('candidatePlaylistId');
  });
  it('detects a forged hash that does not match content', () => {
    const a = buildAssignmentSnapshot(assignmentInput());
    const forged = { ...a, storeId: 's-evil', assignmentHash: a.assignmentHash };
    const chk = verifyImmutable(a, forged);
    expect(chk.ok).toBe(false);
    expect(chk.changed).toContain('assignmentHash');
  });
});

// ── Override resolver ────────────────────────────────────────────────────────────
describe('override resolver', () => {
  it('resolves to the pilot override for a live, version-matched treatment store', () => {
    const r = resolveStorePlaylist(resolutionInput());
    expect(r.source).toBe('PILOT_OVERRIDE');
    expect(r.playlistId).toBe('pl-cand');
    expect(r.version).toBe(3);
    expect(r.failOpen).toBe(false);
  });
  it('control store gets NO override (control preserved)', () => {
    const r = resolveStorePlaylist(resolutionInput({ override: override({ group: 'control' }) }));
    expect(r.source).toBe('STORE_PLAYLIST');
    expect(r.controlPreserved).toBe(true);
  });
  it('version-pin mismatch fails open + flags conflict', () => {
    const r = resolveStorePlaylist(resolutionInput({ override: override({ candidateVersion: 99 }) }));
    expect(r.source).toBe('STORE_PLAYLIST');
    expect(r.failOpen).toBe(true);
    expect(r.conflict).toBe(true);
  });
  it('expired override fails open to existing path', () => {
    const r = resolveStorePlaylist(resolutionInput({ override: override({ expiry: NOW - 1 }) }));
    expect(r.source).toBe('STORE_PLAYLIST');
    expect(r.failOpen).toBe(true);
  });
  it('paused override fails open', () => {
    const r = resolveStorePlaylist(resolutionInput({ override: override({ state: 'PAUSED' }) }));
    expect(r.failOpen).toBe(true);
    expect(r.source).toBe('STORE_PLAYLIST');
  });
  it('no override → plain existing path, not fail-open', () => {
    const r = resolveStorePlaylist(resolutionInput({ override: null }));
    expect(r.source).toBe('STORE_PLAYLIST');
    expect(r.failOpen).toBe(false);
    expect(r.controlPreserved).toBe(false);
  });
  it('falls through store → brand → fallback → NONE', () => {
    expect(resolveStorePlaylist(resolutionInput({ override: null, storePlaylistId: null })).source).toBe('BRAND_ENTERPRISE');
    expect(resolveStorePlaylist(resolutionInput({ override: null, storePlaylistId: null, brandPlaylistId: null })).source).toBe('FALLBACK');
    const none = resolveStorePlaylist(resolutionInput({ override: null, storePlaylistId: null, brandPlaylistId: null, fallbackPlaylistId: null }));
    expect(none.source).toBe('NONE');
    expect(none.playlistId).toBeNull();
  });
});

// ── Guardrail monitor (recommendation only) ──────────────────────────────────────
describe('guardrail monitor', () => {
  it('PASS on clean signals — never auto-acts', () => {
    const r = monitorGuardrails(guardrailSignals());
    expect(r.status).toBe('PASS');
    expect(r.automated).toBe(false);
    expect(r.executed).toBe(false);
    expect(r.requiresApproval).toBe(true);
  });
  it('BLOCKED on critical incident (still recommendation only)', () => {
    const r = monitorGuardrails(guardrailSignals({ criticalIncident: true }));
    expect(r.status).toBe('BLOCKED');
    expect(r.executed).toBe(false);
  });
  it('BLOCKED on candidate version drift (pin violation)', () => {
    expect(monitorGuardrails(guardrailSignals({ candidateVersionChanged: true })).status).toBe('BLOCKED');
  });
  it('BLOCKED on control playlist change', () => {
    expect(monitorGuardrails(guardrailSignals({ controlPlaylistChanged: true })).status).toBe('BLOCKED');
  });
  it('STOP_RECOMMENDED on streaming drop over stop threshold', () => {
    expect(monitorGuardrails(guardrailSignals({ streamingQualityDrop: 10 })).status).toBe('STOP_RECOMMENDED');
  });
  it('WARNING between warn and stop thresholds', () => {
    expect(monitorGuardrails(guardrailSignals({ streamingQualityDrop: 4 })).status).toBe('WARNING');
  });
  it('INSUFFICIENT_DATA when sample thin', () => {
    expect(monitorGuardrails(guardrailSignals({ sampleSufficient: false })).status).toBe('INSUFFICIENT_DATA');
  });
  it('NOT_AVAILABLE when all quality signals absent', () => {
    const r = monitorGuardrails(guardrailSignals({
      streamingQualityDrop: null, stallIncrease: null, mediaErrorIncrease: null,
      recoveryFailIncrease: null, skipIncrease: null, dislikeIncrease: null,
    }));
    expect(r.status).toBe('NOT_AVAILABLE');
  });
});

// ── Observation windows ──────────────────────────────────────────────────────────
describe('observation', () => {
  it('classifies windows by elapsed fraction', () => {
    expect(classifyWindow(0)).toBe('BASELINE');
    expect(classifyWindow(0.2)).toBe('EARLY');
    expect(classifyWindow(0.5)).toBe('MID');
    expect(classifyWindow(0.8)).toBe('LATE');
    expect(classifyWindow(1.0)).toBe('FINAL');
  });
  it('windowForElapsed handles zero total', () => {
    expect(windowForElapsed(100, 0)).toBe('BASELINE');
  });
  it('NO_DATA when no sessions/playbacks', () => {
    const s = buildObservationSnapshot({
      elapsedMs: 100, totalMs: 1000, stores: 0, sessions: 0, playbacks: 0,
      completionRate: null, skipRate: null, likeRate: null, dislikeRate: null,
      streamingQualityScore: null, criticalIncidents: null, contamination: 'UNKNOWN',
    });
    expect(s.status).toBe('NO_DATA');
  });
  it('INSUFFICIENT_DATA below sample floor', () => {
    const s = buildObservationSnapshot({
      elapsedMs: 500, totalMs: 1000, stores: 2, sessions: 10, playbacks: 20,
      completionRate: 0.7, skipRate: 0.1, likeRate: 0.1, dislikeRate: 0.01,
      streamingQualityScore: null, criticalIncidents: 0, contamination: 'CLEAN',
    });
    expect(s.status).toBe('INSUFFICIENT_DATA');
    expect(s.notes.some(n => n.includes('NOT_AVAILABLE'))).toBe(true);   // streaming score null
  });
  it('READY with sufficient sample', () => {
    const s = buildObservationSnapshot({
      elapsedMs: 1000, totalMs: 1000, stores: 5, sessions: PILOT_MIN_SESSIONS + 50, playbacks: PILOT_MIN_PLAYBACKS + 100,
      completionRate: 0.75, skipRate: 0.1, likeRate: 0.12, dislikeRate: 0.01,
      streamingQualityScore: 92, criticalIncidents: 0, contamination: 'CLEAN',
    });
    expect(s.status).toBe('READY');
    expect(s.window).toBe('FINAL');
  });
});

// ── Progress ─────────────────────────────────────────────────────────────────────
describe('pilot progress', () => {
  it('NO_DATA yields null confidence (never fabricated)', () => {
    const p = buildPilotProgress({
      startMs: NOW - 1000, endMs: NOW + 1000, nowMs: NOW, storesActive: 3, storesExcluded: 0, storesOffline: 0,
      sessionsCollected: 0, playbacksCollected: 0, guardrailStatus: 'INSUFFICIENT_DATA', contamination: 'UNKNOWN', lastObservationMs: null,
    });
    expect(p.status).toBe('NO_DATA');
    expect(p.confidence).toBeNull();
    expect(p.primaryMetricProgress).toBeNull();
  });
  it('caps confidence and reports sufficiency', () => {
    const p = buildPilotProgress({
      startMs: NOW - 86_400_000, endMs: NOW + 86_400_000, nowMs: NOW, storesActive: 5, storesExcluded: 1, storesOffline: 0,
      sessionsCollected: 5000, playbacksCollected: 9000, guardrailStatus: 'PASS', contamination: 'CLEAN', lastObservationMs: NOW,
    });
    expect(p.status).toBe('READY');
    expect(p.sampleSufficient).toBe(true);
    expect(p.confidence).toBeLessThanOrEqual(88);
    expect(p.confidence).toBeGreaterThan(0);
  });
});

// ── Completion (never auto-fires) ────────────────────────────────────────────────
describe('completion', () => {
  it('COMPLETED criteria met but still requires operator confirmation', () => {
    const r = evaluateCompletion(completionInput());
    expect(r.status).toBe('COMPLETED');
    expect(r.requiresApproval).toBe(true);
    expect(r.automated).toBe(false);
    expect(r.reasons.some(x => x.includes('운영자'))).toBe(true);
  });
  it('EXTEND_RECOMMENDED when duration met but sample thin', () => {
    expect(evaluateCompletion(completionInput({ sessions: 10, playbacks: 20 })).status).toBe('EXTEND_RECOMMENDED');
  });
  it('CONTAMINATED blocks clean completion', () => {
    expect(evaluateCompletion(completionInput({ contamination: 'CONTAMINATED' })).status).toBe('CONTAMINATED');
  });
  it('STOP_RECOMMENDED on critical guardrail failure', () => {
    expect(evaluateCompletion(completionInput({ criticalGuardrailFailure: true })).status).toBe('STOP_RECOMMENDED');
  });
  it('INSUFFICIENT_DATA with no observations', () => {
    expect(evaluateCompletion(completionInput({ sessions: 0, playbacks: 0, finalSnapshotExists: false })).status).toBe('INSUFFICIENT_DATA');
  });
});

// ── Expansion (always a new experiment version, never full auto rollout) ─────────
describe('expansion', () => {
  it('recommends small expansion first, as a NEW experiment version', () => {
    const r = evaluateExpansion({
      pilotCompleted: true, outcomePositive: true, guardrailsClean: true, contamination: 'CLEAN',
      currentStores: 5, currentStage: 'NONE', operatorApproved: false,
    });
    expect(r.stage).toBe('EXPAND_SMALL_RECOMMENDED');
    expect(r.newExperimentVersionRequired).toBe(true);
    expect(r.fullProductionRollout).toBe(false);
    expect(r.automated).toBe(false);
  });
  it('does not advance without operator approval', () => {
    const r = evaluateExpansion({
      pilotCompleted: true, outcomePositive: true, guardrailsClean: true, contamination: 'CLEAN',
      currentStores: 5, currentStage: 'EXPAND_SMALL_RECOMMENDED', operatorApproved: false,
    });
    expect(r.stage).toBe('EXPAND_SMALL_RECOMMENDED');
  });
  it('no expansion when pilot not completed / contaminated / negative', () => {
    expect(evaluateExpansion({ pilotCompleted: false, outcomePositive: true, guardrailsClean: true, contamination: 'CLEAN', currentStores: 5, currentStage: 'NONE', operatorApproved: false }).stage).toBe('NONE');
    expect(evaluateExpansion({ pilotCompleted: true, outcomePositive: true, guardrailsClean: true, contamination: 'CONTAMINATED', currentStores: 5, currentStage: 'NONE', operatorApproved: false }).stage).toBe('NONE');
    expect(evaluateExpansion({ pilotCompleted: true, outcomePositive: false, guardrailsClean: true, contamination: 'CLEAN', currentStores: 5, currentStage: 'NONE', operatorApproved: false }).stage).toBe('NONE');
  });
  it('manual rollout stage is still gated and never full auto rollout', () => {
    const r = evaluateExpansion({
      pilotCompleted: true, outcomePositive: true, guardrailsClean: true, contamination: 'CLEAN',
      currentStores: 20, currentStage: 'READY_FOR_MANUAL_ROLLOUT', operatorApproved: true,
    });
    expect(r.stage).toBe('MANUAL_ROLLOUT_APPROVED');
    expect(r.fullProductionRollout).toBe(false);
  });
});

// ── Feature flags (kill switch defaults OFF) ─────────────────────────────────────
describe('config / kill switch', () => {
  beforeEach(() => __resetAiPilotConfig());
  it('all pilot flags default OFF', () => {
    const c = getAiPilotConfig();
    expect(c.orchestrationEnabled).toBe(false);
    expect(c.activationEnabled).toBe(false);
    expect(c.overrideEnabled).toBe(false);
    expect(c.observationEnabled).toBe(false);
    expect(c.guardrailEnabled).toBe(false);
    expect(c.pauseResumeEnabled).toBe(false);
    expect(c.rollbackEnabled).toBe(false);
  });
  it('master inherits AI-MUSIC master (default OFF)', () => {
    expect(getAiPilotConfig().masterEnabled).toBe(false);
  });
});
