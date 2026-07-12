// AI-MUSIC-6 — Shadow resolution & certification engine tests. Rule-based (no LLM/ML). The shadow NEVER changes
// the real playlist/queue/playback; every failure fails OPEN to the existing result (actualPlaylistUnchanged).
// Control stores always match the existing result; a single control divergence caps certification at BLOCKED.
// Honest NO_DATA/NOT_AVAILABLE/INSUFFICIENT_DATA; readiness reaches at most READY_FOR_MANUAL_CANARY_REVIEW;
// events carry only hashes (no titles/tracks/URLs). Flags default OFF and the kill switch never touches the
// existing resolution.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveShadow, classifyDivergence, buildShadowEvent, eventName,
  certifyControlPreservation, certifyTreatmentEligibility, certifyFailOpen,
  computeCoverage, computeCertification, computeReadiness,
  getAiShadowConfig, shadowEvaluationAllowed, __resetAiShadowConfig,
} from './index';
import type {
  ExistingResolution, ShadowResolverInput, TreatmentEligibilityInput, CertificationInput,
  ControlPreservationResult, FailOpenResult, TreatmentEligibilityResult, CoverageResult,
} from './types';

const NOW = 1_700_000_000_000;

function existing(o: Partial<ExistingResolution> = {}): ExistingResolution {
  return { storeId: 's1', selectedPlaylistId: 'pl-existing', selectionSource: 'BRAND_ENTERPRISE', version: null, reason: 'franchise policy', ...o };
}
function input(o: Partial<ShadowResolverInput> = {}): ShadowResolverInput {
  return {
    storeId: 's1', resolvedAt: NOW, existing: existing(),
    experimentId: 'exp-1', pilotRunId: 'run-1', assignmentId: 'a1', assignmentGroup: 'treatment',
    candidatePlaylistId: 'pl-cand', candidateVersion: 3, expectedCandidateVersion: 3,
    overrideStatus: 'ACTIVE', overrideStart: NOW - 1000, overrideEnd: NOW + 86_400_000, expiry: NOW + 2 * 86_400_000,
    conflictingActivePilot: false, overrideFlagEnabled: true, shadowError: false, ...o,
  };
}

// ── Shadow resolver — fail-open in every failure mode ──
describe('shadow resolver', () => {
  it('applies the pinned treatment candidate when all checks pass', () => {
    const r = resolveShadow(input());
    expect(r.selectionSource).toBe('PILOT_OVERRIDE');
    expect(r.selectedPlaylistId).toBe('pl-cand');
    expect(r.version).toBe(3);
    expect(r.fallbackUsed).toBe(false);
    expect(r.overrideValid).toBe(true);
  });
  it('control store always returns the existing result (control preserved)', () => {
    const r = resolveShadow(input({ assignmentGroup: 'control' }));
    expect(r.selectedPlaylistId).toBe('pl-existing');
    expect(r.reasonCode).toBe('CONTROL_PRESERVED');
    expect(r.fallbackUsed).toBe(true);
  });
  it('no assignment → existing result', () => {
    expect(resolveShadow(input({ assignmentId: null, assignmentGroup: null })).reasonCode).toBe('NO_ASSIGNMENT');
  });
  it('override flag off → existing result', () => {
    expect(resolveShadow(input({ overrideFlagEnabled: false })).selectedPlaylistId).toBe('pl-existing');
  });
  it('version mismatch → existing result (fail open)', () => {
    const r = resolveShadow(input({ candidateVersion: 99 }));
    expect(r.reasonCode).toBe('VERSION_MISMATCH');
    expect(r.selectedPlaylistId).toBe('pl-existing');
  });
  it('candidate missing → existing result', () => {
    expect(resolveShadow(input({ candidatePlaylistId: null })).reasonCode).toBe('CANDIDATE_MISSING');
  });
  it('expired / paused / stopped / rolled-back override → existing result', () => {
    expect(resolveShadow(input({ expiry: NOW - 1 })).reasonCode).toBe('OVERRIDE_EXPIRED');
    expect(resolveShadow(input({ overrideStatus: 'PAUSED' })).reasonCode).toBe('OVERRIDE_NOT_ACTIVE');
    expect(resolveShadow(input({ overrideStatus: 'STOPPED' })).reasonCode).toBe('OVERRIDE_NOT_ACTIVE');
    expect(resolveShadow(input({ overrideStatus: 'ROLLED_BACK' })).reasonCode).toBe('OVERRIDE_NOT_ACTIVE');
  });
  it('assignment conflict → existing result', () => {
    expect(resolveShadow(input({ conflictingActivePilot: true })).reasonCode).toBe('ASSIGNMENT_CONFLICT');
  });
  it('shadow error → existing result (fail open, NOT_AVAILABLE)', () => {
    const r = resolveShadow(input({ shadowError: true }));
    expect(r.reasonCode).toBe('RESOLVER_ERROR');
    expect(r.selectedPlaylistId).toBe('pl-existing');
    expect(r.status).toBe('NOT_AVAILABLE');
  });
});

// ── Divergence classification ──
describe('divergence', () => {
  it('SAME_RESULT when override not applied and result matches', () => {
    const shadow = resolveShadow(input({ assignmentGroup: 'control' }));
    const d = classifyDivergence(existing(), shadow, 'control');
    expect(d.type).toBe('SAME_RESULT');
    expect(d.actualPlaylistUnchanged).toBe(true);
    expect(d.failOpenSuccess).toBe(true);
  });
  it('EXPECTED_TREATMENT_DIVERGENCE when treatment applies candidate', () => {
    const shadow = resolveShadow(input());
    const d = classifyDivergence(existing(), shadow, 'treatment');
    expect(d.type).toBe('EXPECTED_TREATMENT_DIVERGENCE');
    expect(d.severity).toBe('INFO');
  });
  it('UNEXPECTED_CONTROL_DIVERGENCE is CRITICAL', () => {
    // Force a differing shadow for a control store (should never happen, but classification must flag it).
    const shadow = { ...resolveShadow(input()), reasonCode: 'OVERRIDE_APPLIED' as const };
    const d = classifyDivergence(existing(), shadow, 'control');
    expect(d.type).toBe('UNEXPECTED_CONTROL_DIVERGENCE');
    expect(d.severity).toBe('CRITICAL');
    expect(d.certificationRisk).toBe(true);
  });
  it('RESOLVER_ERROR is runtime-safe but a certification risk', () => {
    const shadow = resolveShadow(input({ shadowError: true }));
    const d = classifyDivergence(existing(), shadow, 'treatment');
    expect(d.type).toBe('RESOLVER_ERROR');
    expect(d.failOpenSuccess).toBe(true);
    expect(d.certificationRisk).toBe(true);
  });
  it('VERSION_MISMATCH classified with WARNING', () => {
    const shadow = resolveShadow(input({ candidateVersion: 99 }));
    const d = classifyDivergence(existing(), shadow, 'treatment');
    expect(d.type).toBe('VERSION_MISMATCH');
    expect(d.severity).toBe('WARNING');
  });
});

// ── Privacy-safe events ──
describe('shadow events', () => {
  it('emits only hashes — no raw ids/titles/tracks', () => {
    const inp = input();
    const shadow = resolveShadow(inp);
    const d = classifyDivergence(existing(), shadow, 'treatment');
    const ev = buildShadowEvent(inp, shadow, d, 'session-token-xyz');
    expect(ev.storeIdHash).toMatch(/^[0-9a-f]{8}$/);
    expect(ev.sessionHash).toMatch(/^[0-9a-f]{8}$/);
    expect(ev.existingPlaylistHash).toMatch(/^[0-9a-f]{8}$/);
    // no raw store id leaks
    expect(JSON.stringify(ev)).not.toContain('pl-existing');
    expect(JSON.stringify(ev)).not.toContain('session-token-xyz');
    expect(ev.storeIdHash).not.toBe('s1');
  });
  it('event name reflects the decision', () => {
    expect(eventName(classifyDivergence(existing(), resolveShadow(input()), 'treatment'), resolveShadow(input()))).toBe('shadow_override_eligible');
    const ctrl = resolveShadow(input({ assignmentGroup: 'control' }));
    expect(eventName(classifyDivergence(existing(), ctrl, 'control'), ctrl)).toBe('shadow_control_preserved');
  });
});

// ── Control preservation certification ──
describe('control preservation', () => {
  it('PASS with enough samples and zero divergence', () => {
    expect(certifyControlPreservation({ controlSessions: 200, controlDivergences: 0, minSamples: 30 }).status).toBe('PASS');
  });
  it('FAIL on any control divergence', () => {
    expect(certifyControlPreservation({ controlSessions: 200, controlDivergences: 1, minSamples: 30 }).status).toBe('FAIL');
  });
  it('INSUFFICIENT_DATA below sample floor', () => {
    expect(certifyControlPreservation({ controlSessions: 5, controlDivergences: 0, minSamples: 30 }).status).toBe('INSUFFICIENT_DATA');
  });
  it('NOT_AVAILABLE with no control sessions', () => {
    expect(certifyControlPreservation({ controlSessions: 0, controlDivergences: 0, minSamples: 30 }).status).toBe('NOT_AVAILABLE');
  });
});

// ── Treatment eligibility ──
function elig(o: Partial<TreatmentEligibilityInput> = {}): TreatmentEligibilityInput {
  return {
    approvalValid: true, assignmentValid: true, versionPinValid: true, candidateExists: true, overrideActive: true,
    expiryValid: true, noActiveConflict: true, rollbackTargetExists: true, existingFallbackAvailable: true,
    queueInputCompatible: true, trackRpcCompatible: true, ...o,
  };
}
describe('treatment eligibility', () => {
  it('READY when everything valid', () => {
    expect(certifyTreatmentEligibility(elig()).status).toBe('READY');
  });
  it('BLOCKED on any hard failure', () => {
    expect(certifyTreatmentEligibility(elig({ approvalValid: false })).status).toBe('BLOCKED');
    expect(certifyTreatmentEligibility(elig({ existingFallbackAvailable: false })).status).toBe('BLOCKED');
  });
  it('REVIEW_REQUIRED on soft warnings only', () => {
    expect(certifyTreatmentEligibility(elig({ rollbackTargetExists: false })).status).toBe('REVIEW_REQUIRED');
  });
});

// ── Fail-open certification ──
describe('fail-open', () => {
  it('PASS when all cases preserve the existing result', () => {
    const r = certifyFailOpen([{ name: 'timeout', existingPreserved: true }, { name: 'candidate_missing', existingPreserved: true }]);
    expect(r.status).toBe('PASS');
    expect(r.preserved).toBe(2);
  });
  it('FAIL when any case changed the existing result', () => {
    const r = certifyFailOpen([{ name: 'timeout', existingPreserved: true }, { name: 'exception', existingPreserved: false }]);
    expect(r.status).toBe('FAIL');
    expect(r.failed).toContain('exception');
  });
  it('NOT_AVAILABLE with no cases', () => {
    expect(certifyFailOpen([]).status).toBe('NOT_AVAILABLE');
  });
});

// ── Coverage ──
function cov(o = {}) {
  return computeCoverage({
    storeSessionsEvaluated: 300, eligibleTreatmentSessions: 150, controlSessions: 150, shadowEvaluations: 300,
    sameResult: 250, expectedDivergence: 45, unexpectedDivergence: 0, failOpenCount: 5, resolverErrorCount: 0,
    versionMismatchCount: 0, candidateMissingCount: 0, assignmentConflictCount: 0, minSessions: 100, ...o,
  });
}
describe('coverage', () => {
  it('SUFFICIENT with enough evaluations', () => { expect(cov().status).toBe('SUFFICIENT'); });
  it('PARTIAL / LOW / NO_DATA tiers', () => {
    expect(cov({ shadowEvaluations: 50 }).status).toBe('PARTIAL');
    expect(cov({ shadowEvaluations: 10 }).status).toBe('LOW');
    expect(cov({ storeSessionsEvaluated: 0, shadowEvaluations: 0 }).status).toBe('NO_DATA');
  });
});

// ── Certification score ──
function certInput(o: Partial<CertificationInput> = {}): CertificationInput {
  const control: ControlPreservationResult = { status: 'PASS', controlSessions: 200, divergences: 0, reasons: [] };
  const failOpen: FailOpenResult = { status: 'PASS', total: 18, preserved: 18, failed: [] };
  const eligibility: TreatmentEligibilityResult = { status: 'READY', blockers: [], warnings: [] };
  const coverage: CoverageResult = { status: 'SUFFICIENT', signalCoverage: 1, notes: [] };
  return {
    control, failOpen, eligibility, coverage,
    candidateAvailabilityRate: 1, versionIntegrityRate: 1, assignmentIntegrityRate: 1, resolverErrorRate: 0,
    queueCompatible: true, rollbackReady: true, ...o,
  };
}
describe('certification score', () => {
  it('CERTIFIED at full marks', () => {
    const c = computeCertification(certInput());
    expect(c.status).toBe('CERTIFIED');
    expect(c.score).toBeGreaterThanOrEqual(90);
    expect(c.automated).toBe(false);
  });
  it('BLOCKED on any control divergence regardless of score', () => {
    const c = computeCertification(certInput({ control: { status: 'FAIL', controlSessions: 200, divergences: 1, reasons: [] } }));
    expect(c.status).toBe('BLOCKED');
  });
  it('BLOCKED on fail-open failure', () => {
    expect(computeCertification(certInput({ failOpen: { status: 'FAIL', total: 18, preserved: 17, failed: ['exception'] } })).status).toBe('BLOCKED');
  });
  it('BLOCKED when resolver error rate exceeds ceiling', () => {
    expect(computeCertification(certInput({ resolverErrorRate: 0.2 })).status).toBe('BLOCKED');
  });
  it('INSUFFICIENT_DATA when evidence too thin (not scored as 0)', () => {
    const c = computeCertification(certInput({
      control: { status: 'INSUFFICIENT_DATA', controlSessions: 5, divergences: 0, reasons: [] },
      coverage: { status: 'LOW', signalCoverage: 0.2, notes: [] },
    }));
    expect(c.status).toBe('INSUFFICIENT_DATA');
    expect(c.score).toBeNull();
  });
});

// ── Readiness (max READY_FOR_MANUAL_CANARY_REVIEW; never starts a canary) ──
describe('readiness', () => {
  it('READY_FOR_MANUAL_CANARY_REVIEW at full certification', () => {
    const cert = computeCertification(certInput());
    const r = computeReadiness(cert, { status: 'READY', blockers: [], warnings: [] });
    expect(r.state).toBe('READY_FOR_MANUAL_CANARY_REVIEW');
    expect(r.actualCanaryStarted).toBe(false);
    expect(r.automated).toBe(false);
  });
  it('BLOCKED when certification blocked', () => {
    const cert = computeCertification(certInput({ control: { status: 'FAIL', controlSessions: 200, divergences: 2, reasons: [] } }));
    expect(computeReadiness(cert, { status: 'READY', blockers: [], warnings: [] }).state).toBe('BLOCKED');
  });
  it('INSUFFICIENT_DATA propagates', () => {
    const cert = computeCertification(certInput({
      control: { status: 'INSUFFICIENT_DATA', controlSessions: 5, divergences: 0, reasons: [] },
      coverage: { status: 'LOW', signalCoverage: 0.2, notes: [] },
    }));
    expect(computeReadiness(cert, { status: 'REVIEW_REQUIRED', blockers: [], warnings: [] }).state).toBe('INSUFFICIENT_DATA');
  });
});

// ── Config / kill switch (default OFF; never touches existing resolution) ──
describe('config / kill switch', () => {
  beforeEach(() => __resetAiShadowConfig());
  it('all shadow flags default OFF', () => {
    const c = getAiShadowConfig();
    expect(c.resolutionEnabled).toBe(false);
    expect(c.eventIngestEnabled).toBe(false);
    expect(c.certificationEnabled).toBe(false);
    expect(c.dashboardEnabled).toBe(false);
    expect(c.killSwitch).toBe(false);
  });
  it('shadowEvaluationAllowed is false by default (master + flags OFF)', () => {
    expect(shadowEvaluationAllowed()).toBe(false);
  });
});
