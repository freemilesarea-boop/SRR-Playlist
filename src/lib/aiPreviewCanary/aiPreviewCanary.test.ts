// AI-MUSIC-7 — Preview runtime canary engine tests. Rule-based (no LLM/ML). Production is always rejected;
// general/non-allowlisted stores are rejected; control stores always keep the existing result; every failure
// fails OPEN; candidate version + snapshot are pinned; the current track is never force-interrupted; guardrails
// only recommend; certification is internal-preview only (never "production ready"); flags default OFF and the
// kill switch defaults ON. No Player control, no automatic activation/stop/rollback, no production execution.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  evaluateEnvironmentGate, environmentAllowsCanary, checkAllowlist, isAllowlisted,
  canTransition, transition, allowedNext, isTerminal, computeCanaryApproval, validateCandidateQueue,
  buildExistingQueueSnapshot, resolveCanary, evaluateGuardrails,
  computePreviewCertification, computeProductionReadiness,
  getAiPreviewCanaryConfig, __resetAiPreviewCanaryConfig,
} from './index';
import type {
  EnvContext, AllowlistEntry, AllowlistCheckInput, ApprovalInput, CandidateQueueInput, CandidateTrackLite,
  CanaryResolveInput, GuardrailSignals, PreviewCertInput, EnvGateResult, GuardrailResult,
} from './types';

const NOW = 1_700_000_000_000;

function envCtx(o: Partial<EnvContext> = {}): EnvContext {
  return { mode: 'production', appEnv: 'preview', currentDeploymentId: 'dep-1', allowedDeploymentId: 'dep-1', isProductionHost: false, ...o };
}
const ENFORCED_GATE: EnvGateResult = { status: 'ENFORCED', isPreview: true, deploymentMatches: true, reasons: [] };

// ── Environment enforcement ──
describe('environment gate', () => {
  it('ENFORCED only when preview + deployment id matches + not production host', () => {
    const g = evaluateEnvironmentGate(envCtx());
    expect(g.status).toBe('ENFORCED');
    expect(environmentAllowsCanary(g)).toBe(true);
  });
  it('production host → UNSAFE (never allowed)', () => {
    const g = evaluateEnvironmentGate(envCtx({ isProductionHost: true }));
    expect(g.status).toBe('UNSAFE');
    expect(environmentAllowsCanary(g)).toBe(false);
  });
  it('deployment id mismatch → not enforced', () => {
    const g = evaluateEnvironmentGate(envCtx({ currentDeploymentId: 'dep-2' }));
    expect(g.status).not.toBe('ENFORCED');
    expect(environmentAllowsCanary(g)).toBe(false);
  });
  it('non-preview appEnv → not enforced', () => {
    expect(evaluateEnvironmentGate(envCtx({ appEnv: 'production' })).status).not.toBe('ENFORCED');
  });
  it('no deployment config → PARTIAL/NOT_AVAILABLE, never enforced', () => {
    const g = evaluateEnvironmentGate(envCtx({ allowedDeploymentId: null, currentDeploymentId: null }));
    expect(g.status).toBe('PARTIAL'); // still preview appEnv
    expect(environmentAllowsCanary(g)).toBe(false);
  });
});

// ── Allowlist ──
function entry(o: Partial<AllowlistEntry> = {}): AllowlistEntry {
  return { storeId: 's1', environment: 'preview', purpose: 'internal test', approvedBy: 'op', approvedAt: NOW,
    expiresAt: NOW + 86_400_000, enabled: true, maxSessions: 2, allowedCandidatePlaylistId: 'pl-cand',
    allowedCandidateVersion: 3, notes: null, ...o };
}
function allowInput(o: Partial<AllowlistCheckInput> = {}): AllowlistCheckInput {
  return { entry: entry(), candidatePlaylistId: 'pl-cand', candidateVersion: 3, activeSessions: 0, nowMs: NOW, ...o };
}
describe('allowlist', () => {
  it('ALLOWED for a valid preview entry in scope', () => {
    const r = checkAllowlist(allowInput());
    expect(r.status).toBe('ALLOWED');
    expect(isAllowlisted(r.status)).toBe(true);
  });
  it('no entry → NOT_ALLOWED (general store never auto-included)', () => {
    expect(checkAllowlist(allowInput({ entry: null })).status).toBe('NOT_ALLOWED');
  });
  it('non-preview environment entry → ENV_MISMATCH', () => {
    expect(checkAllowlist(allowInput({ entry: entry({ environment: 'production' as never }) })).status).toBe('ENV_MISMATCH');
  });
  it('expired / disabled → blocked', () => {
    expect(checkAllowlist(allowInput({ entry: entry({ expiresAt: NOW - 1 }) })).status).toBe('EXPIRED');
    expect(checkAllowlist(allowInput({ entry: entry({ enabled: false }) })).status).toBe('DISABLED');
  });
  it('candidate out of scope → CANDIDATE_OUT_OF_SCOPE', () => {
    expect(checkAllowlist(allowInput({ candidateVersion: 4 })).status).toBe('CANDIDATE_OUT_OF_SCOPE');
    expect(checkAllowlist(allowInput({ candidatePlaylistId: 'other' })).status).toBe('CANDIDATE_OUT_OF_SCOPE');
  });
  it('session cap reached → SESSION_CAP_REACHED', () => {
    expect(checkAllowlist(allowInput({ activeSessions: 2 })).status).toBe('SESSION_CAP_REACHED');
  });
});

// ── State machine ──
describe('state machine', () => {
  it('approval, arm, activate are separate hops', () => {
    expect(canTransition('DRAFT', 'REVIEW_REQUIRED')).toBe(true);
    expect(canTransition('REVIEW_REQUIRED', 'APPROVED')).toBe(true);
    expect(canTransition('APPROVED', 'ARMED')).toBe(true);
    expect(canTransition('ARMED', 'ACTIVE')).toBe(true);
  });
  it('forbids skipping straight to ACTIVE', () => {
    expect(canTransition('DRAFT', 'ACTIVE')).toBe(false);
    expect(canTransition('REVIEW_REQUIRED', 'ACTIVE')).toBe(false);
    expect(canTransition('APPROVED', 'ACTIVE')).toBe(false);
  });
  it('terminal states cannot re-activate', () => {
    for (const t of ['COMPLETED', 'ROLLED_BACK', 'FAILED', 'EXPIRED', 'CANCELLED'] as const) {
      expect(isTerminal(t)).toBe(true);
      expect(transition(t, 'ACTIVE').ok).toBe(false);
      expect(allowedNext(t)).toEqual([]);
    }
  });
  it('stop and rollback are request→confirm', () => {
    expect(canTransition('ACTIVE', 'STOP_REQUESTED')).toBe(true);
    expect(canTransition('STOP_REQUESTED', 'STOPPED')).toBe(true);
    expect(canTransition('STOPPED', 'ROLLBACK_REQUESTED')).toBe(true);
    expect(canTransition('ROLLBACK_REQUESTED', 'ROLLED_BACK')).toBe(true);
    expect(canTransition('ACTIVE', 'ROLLED_BACK')).toBe(false);
  });
});

// ── Approval gate ──
function approval(o: Partial<ApprovalInput> = {}): ApprovalInput {
  return {
    envGate: ENFORCED_GATE, allowlist: { status: 'ALLOWED', reasons: [] }, storeIsInternalTest: true,
    experimentApproved: true, pilotRunApproved: true, isTreatment: true, candidatePlaylistExists: true,
    candidateVersionMatches: true, candidateSnapshotExists: true, existingPlaylistSnapshotExists: true,
    existingQueueSnapshotAvailable: true, rollbackTargetExists: true, shadowCertificationStatus: 'READY_WITH_WARNINGS',
    controlDivergences: 0, failOpenVerified: true, criticalResolverError: false, criticalStreamingIncident: false,
    scheduledStart: NOW + 3_600_000, scheduledEnd: NOW + 10 * 86_400_000, expiry: NOW + 86_400_000,
    approver: 'op', reason: 'preview canary internal test', nowMs: NOW, ...o,
  };
}
describe('approval gate', () => {
  it('APPROVED when everything valid; approval never executes', () => {
    const a = computeCanaryApproval(approval());
    expect(a.status).toBe('APPROVED');
    expect(a.executed).toBe(false);
    expect(a.automated).toBe(false);
  });
  it('ENVIRONMENT_BLOCKED when env not enforced', () => {
    expect(computeCanaryApproval(approval({ envGate: { status: 'PARTIAL', isPreview: true, deploymentMatches: false, reasons: [] } })).status).toBe('ENVIRONMENT_BLOCKED');
  });
  it('STORE_NOT_ALLOWED when not allowlisted / not internal', () => {
    expect(computeCanaryApproval(approval({ allowlist: { status: 'NOT_ALLOWED', reasons: [] } })).status).toBe('STORE_NOT_ALLOWED');
    expect(computeCanaryApproval(approval({ storeIsInternalTest: false })).status).toBe('STORE_NOT_ALLOWED');
  });
  it('VERSION_MISMATCH when candidate version differs', () => {
    expect(computeCanaryApproval(approval({ candidateVersionMatches: false })).status).toBe('VERSION_MISMATCH');
  });
  it('REJECTED on control divergence / weak shadow cert / missing rollback', () => {
    expect(computeCanaryApproval(approval({ controlDivergences: 1 })).status).toBe('REJECTED');
    expect(computeCanaryApproval(approval({ shadowCertificationStatus: 'REVIEW_REQUIRED' })).status).toBe('REJECTED');
    expect(computeCanaryApproval(approval({ rollbackTargetExists: false })).status).toBe('REJECTED');
  });
  it('EXPIRED when expiry passed', () => {
    expect(computeCanaryApproval(approval({ expiry: NOW - 1 })).status).toBe('EXPIRED');
  });
});

// ── Candidate queue validation ──
function track(id: string, o: Partial<CandidateTrackLite> = {}): CandidateTrackLite {
  return { trackId: id, hasAudio: true, mediaSupported: true, disabled: false, qcFailed: false, industrySuitable: true, ...o };
}
function cq(o: Partial<CandidateQueueInput> = {}): CandidateQueueInput {
  return { playlistExists: true, candidateVersion: 3, expectedVersion: 3,
    tracks: [track('t1'), track('t2'), track('t3'), track('t4'), track('t5'), track('t6')],
    minTracks: 5, existingQueueLength: 6, existingItemTypeCompatible: true, ...o };
}
describe('candidate queue', () => {
  it('READY with enough usable tracks + deterministic snapshot hash', () => {
    const r = validateCandidateQueue(cq());
    expect(r.status).toBe('READY');
    expect(r.snapshotHash).toMatch(/^[0-9a-f]{8}$/);
    expect(validateCandidateQueue(cq()).snapshotHash).toBe(r.snapshotHash); // deterministic
  });
  it('empty playlist → INSUFFICIENT_DATA', () => {
    expect(validateCandidateQueue(cq({ tracks: [] })).status).toBe('INSUFFICIENT_DATA');
  });
  it('too few usable tracks (blocked tracks) → BLOCKED', () => {
    const r = validateCandidateQueue(cq({ tracks: [track('t1'), track('t2', { hasAudio: false }), track('t3', { qcFailed: true }), track('t4', { disabled: true })] }));
    expect(r.status).toBe('BLOCKED');
  });
  it('version mismatch → BLOCKED', () => {
    expect(validateCandidateQueue(cq({ candidateVersion: 9 })).status).toBe('BLOCKED');
  });
  it('incompatible item type → BLOCKED', () => {
    expect(validateCandidateQueue(cq({ existingItemTypeCompatible: false })).status).toBe('BLOCKED');
  });
  it('duplicates counted, not double-used', () => {
    const r = validateCandidateQueue(cq({ tracks: [track('t1'), track('t1'), track('t2'), track('t3'), track('t4'), track('t5'), track('t6')] }));
    expect(r.duplicateCount).toBe(1);
  });
});

// ── Existing queue snapshot (hash-only) ──
describe('existing queue snapshot', () => {
  it('emits only hashes — no raw ids/titles', () => {
    const s = buildExistingQueueSnapshot({ storeId: 's1', sessionToken: 'sess-x', playlistId: 'pl-existing', queueLength: 10, currentTrackId: 'tc', nextTrackId: 'tn', queueSource: 'BRAND_ENTERPRISE', capturedAt: NOW });
    expect(s.storeIdHash).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.stringify(s)).not.toContain('pl-existing');
    expect(JSON.stringify(s)).not.toContain('sess-x');
    expect(s.queueLength).toBe(10);
  });
});

// ── Canary resolver (fail-open everywhere; control preserved; decision only) ──
function rc(o: Partial<CanaryResolveInput> = {}): CanaryResolveInput {
  return {
    existingPlaylistId: 'pl-existing', envAllowed: true, masterEnabled: true, canaryFlagEnabled: true, killSwitch: false,
    allowlistStatus: 'ALLOWED', sessionState: 'ACTIVE', isTreatment: true, approvalValid: true,
    candidatePlaylistId: 'pl-cand', candidateVersion: 3, expectedCandidateVersion: 3,
    candidateSnapshotHash: 'abc12345', expectedSnapshotHash: 'abc12345', candidateQueueStatus: 'READY',
    expiry: NOW + 86_400_000, conflict: false, rollbackTargetExists: true, storeOnline: true, criticalIncident: false,
    shadowError: false, nowMs: NOW, ...o,
  };
}
describe('canary resolver', () => {
  it('USE_CANARY_CANDIDATE when every gate passes (decision only, playback unchanged)', () => {
    const r = resolveCanary(rc());
    expect(r.outcome).toBe('USE_CANARY_CANDIDATE');
    expect(r.selectedPlaylistId).toBe('pl-cand');
    expect(r.usedCandidate).toBe(true);
    expect(r.actualPlaybackUnchanged).toBe(true);
  });
  it('control store → CONTROL_PRESERVED (existing)', () => {
    const r = resolveCanary(rc({ isTreatment: false }));
    expect(r.outcome).toBe('CONTROL_PRESERVED');
    expect(r.selectedPlaylistId).toBe('pl-existing');
    expect(r.usedCandidate).toBe(false);
  });
  it('env blocked / flag off / kill switch → existing', () => {
    expect(resolveCanary(rc({ envAllowed: false })).outcome).toBe('ENVIRONMENT_BLOCKED');
    expect(resolveCanary(rc({ canaryFlagEnabled: false })).outcome).toBe('FLAG_DISABLED');
    expect(resolveCanary(rc({ killSwitch: true })).outcome).toBe('KILL_SWITCHED');
  });
  it('not allowlisted / session inactive → existing', () => {
    expect(resolveCanary(rc({ allowlistStatus: 'NOT_ALLOWED' })).outcome).toBe('STORE_NOT_ALLOWED');
    expect(resolveCanary(rc({ sessionState: 'APPROVED' })).outcome).toBe('SESSION_INACTIVE');
  });
  it('version / snapshot mismatch → existing (fail open)', () => {
    expect(resolveCanary(rc({ candidateVersion: 9 })).outcome).toBe('VERSION_MISMATCH');
    expect(resolveCanary(rc({ candidateSnapshotHash: 'zzz' })).outcome).toBe('SNAPSHOT_MISMATCH');
  });
  it('expired / conflict / offline / incident / bad queue → existing', () => {
    expect(resolveCanary(rc({ expiry: NOW - 1 })).outcome).toBe('EXPIRED');
    expect(resolveCanary(rc({ conflict: true })).outcome).toBe('CONFLICT');
    expect(resolveCanary(rc({ storeOnline: false })).outcome).toBe('CANDIDATE_BLOCKED');
    expect(resolveCanary(rc({ criticalIncident: true })).outcome).toBe('CANDIDATE_BLOCKED');
    expect(resolveCanary(rc({ candidateQueueStatus: 'BLOCKED' })).outcome).toBe('CANDIDATE_BLOCKED');
  });
  it('resolver error → FAIL_OPEN existing', () => {
    const r = resolveCanary(rc({ shadowError: true }));
    expect(r.outcome).toBe('FAIL_OPEN');
    expect(r.selectedPlaylistId).toBe('pl-existing');
  });
});

// ── Guardrails (recommendation only) ──
function gs(o: Partial<GuardrailSignals> = {}): GuardrailSignals {
  return { playbackStartSuccess: true, ttfaApproxMs: 800, transitionGapMs: 200, stall: false, mediaError: false,
    recoveryFailure: false, currentTrackPreserved: true, playerStatePreserved: true, queueCompatible: true,
    unexpectedReload: false, unexpectedPause: false, doublePlayback: false, queueEmpty: false, sampleSufficient: true, ...o };
}
describe('guardrails', () => {
  it('PASS on clean signals — never auto-acts', () => {
    const r = evaluateGuardrails(gs());
    expect(r.status).toBe('PASS');
    expect(r.automated).toBe(false);
    expect(r.requiresApproval).toBe(true);
  });
  it('BLOCKED when current track not preserved / double playback / queue empty', () => {
    expect(evaluateGuardrails(gs({ currentTrackPreserved: false })).status).toBe('BLOCKED');
    expect(evaluateGuardrails(gs({ doublePlayback: true })).status).toBe('BLOCKED');
    expect(evaluateGuardrails(gs({ queueEmpty: true })).status).toBe('BLOCKED');
  });
  it('STOP_RECOMMENDED on high TTFA / recovery failure', () => {
    expect(evaluateGuardrails(gs({ ttfaApproxMs: 9000 })).status).toBe('STOP_RECOMMENDED');
    expect(evaluateGuardrails(gs({ recoveryFailure: true })).status).toBe('STOP_RECOMMENDED');
  });
  it('WARNING between thresholds', () => {
    expect(evaluateGuardrails(gs({ ttfaApproxMs: 4000 })).status).toBe('WARNING');
  });
  it('INSUFFICIENT_DATA / NOT_AVAILABLE honest', () => {
    expect(evaluateGuardrails(gs({ sampleSufficient: false })).status).toBe('INSUFFICIENT_DATA');
    expect(evaluateGuardrails(gs({ playbackStartSuccess: null, ttfaApproxMs: null, transitionGapMs: null, stall: null, mediaError: null, recoveryFailure: null })).status).toBe('NOT_AVAILABLE');
  });
});

// ── Certification + production readiness ──
function certInput(o: Partial<PreviewCertInput> = {}): PreviewCertInput {
  const guardrail: GuardrailResult = { status: 'PASS', triggers: [], recommendation: '', automated: false, requiresApproval: true };
  return { envGate: ENFORCED_GATE, allowlistIntegrity: true, approvalIntegrity: true, controlDivergences: 0,
    candidateQueueValid: true, versionIntegrity: true, snapshotIntegrity: true, safeBoundaryApplied: true,
    failOpenSuccess: true, playerStatePreserved: true, guardrail, manualDisableVerified: true, rollbackReady: true,
    evidenceSessions: 5, minEvidenceSessions: 3, ...o };
}
describe('certification', () => {
  it('CERTIFIED_FOR_INTERNAL_PREVIEW at full marks (never says production ready)', () => {
    const c = computePreviewCertification(certInput());
    expect(c.status).toBe('CERTIFIED_FOR_INTERNAL_PREVIEW');
    expect(c.score).toBeGreaterThanOrEqual(85);
    expect(c.limitations.some((l) => l.includes('Production Ready'))).toBe(true);
  });
  it('BLOCKED on control divergence / unenforced env / fail-open failure', () => {
    expect(computePreviewCertification(certInput({ controlDivergences: 1 })).status).toBe('BLOCKED');
    expect(computePreviewCertification(certInput({ envGate: { status: 'PARTIAL', isPreview: true, deploymentMatches: false, reasons: [] } })).status).toBe('BLOCKED');
    expect(computePreviewCertification(certInput({ failOpenSuccess: false })).status).toBe('BLOCKED');
  });
  it('NOT_RUN when no evidence and no application', () => {
    expect(computePreviewCertification(certInput({ evidenceSessions: 0, safeBoundaryApplied: null })).status).toBe('NOT_RUN');
  });
  it('INSUFFICIENT_DATA when evidence thin', () => {
    expect(computePreviewCertification(certInput({ evidenceSessions: 1 })).status).toBe('INSUFFICIENT_DATA');
  });
  it('production readiness maxes at CHANGE_REQUEST; never runs a canary', () => {
    const cert = computePreviewCertification(certInput());
    const r = computeProductionReadiness(cert, true);
    expect(r.state).toBe('READY_FOR_PRODUCTION_CANARY_CHANGE_REQUEST');
    expect(r.actualProductionCanary).toBe(false);
  });
  it('production readiness single-store → internal multi-store preview', () => {
    const cert = computePreviewCertification(certInput());
    expect(computeProductionReadiness(cert, false).state).toBe('READY_FOR_INTERNAL_MULTI_STORE_PREVIEW');
  });
  it('production readiness BLOCKED propagates', () => {
    const cert = computePreviewCertification(certInput({ controlDivergences: 2 }));
    expect(computeProductionReadiness(cert, true).state).toBe('BLOCKED');
  });
});

// ── Config / flags (default OFF; kill switch default ON) ──
describe('config / kill switch', () => {
  beforeEach(() => __resetAiPreviewCanaryConfig());
  it('all canary flags default OFF and kill switch defaults ON', () => {
    const c = getAiPreviewCanaryConfig();
    expect(c.canaryEnabled).toBe(false);
    expect(c.resolutionEnabled).toBe(false);
    expect(c.queueEnabled).toBe(false);
    expect(c.dashboardEnabled).toBe(false);
    expect(c.killSwitch).toBe(true);
    expect(c.allowedDeploymentId).toBeNull();
  });
});
