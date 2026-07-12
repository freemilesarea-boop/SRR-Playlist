// AI-MUSIC-9 — Isolated Preview Queue Hook & Single-Store Runtime Proof unit tests. Pure & deterministic. These
// exercise the model ONLY — no runtime hook is wired this phase (DEFERRED). They assert the safety envelope
// (actualPlayerControl:false etc.), the gate chain, the queue-only adapter preservation proof, boundary safety,
// arbitration, preservation checks, fail-open, guardrails, evidence redaction, rollback, certification=NOT_RUN
// without evidence, and Go/No-Go=NO_GO for this phase.
import { describe, it, expect } from 'vitest';
import {
  evaluateRuntimeHook, computeQueueOnlyMutation, validateTestStore, createReservation,
  transitionReservation, canReservationTransition, resolveRuntimeArbitration,
  checkCurrentTrackPreservation, checkPlaybackStatePreservation, runFailOpen, evaluateGuardrails,
  buildEvidence, evaluateRollback, computeSingleStoreCertification, computeProductionCrReadiness,
  evaluateGoNoGo,
  type IsolatedTestStore, type RuntimeHookInput, type RuntimePlaybackSnapshot,
  type RuntimeHookFlags, type SingleStoreCertInput,
} from './index';

const NOW = 1_700_000_000_000;

function store(o: Partial<IsolatedTestStore> = {}): IsolatedTestStore {
  return {
    storeId: 's-internal', storeNameHash: 'h', purpose: 'runtime-proof', previewDeploymentId: 'dpl-preview',
    approvedCandidatePlaylistId: 'pl-cand', approvedCandidateVersion: 3, approvedSnapshotHash: 'snap1',
    approvedExistingPlaylistId: 'pl-exist', approvedBy: 'op1', approvedAtMs: NOW - 1000, expiresAtMs: NOW + 60_000,
    maxSessions: 1, maxQueueApplications: 1, enabled: true, killSwitchRequired: true, ...o,
  };
}
function pb(o: Partial<RuntimePlaybackSnapshot> = {}): RuntimePlaybackSnapshot {
  return {
    playing: true, paused: false, ended: false, buffering: false, recovering: false, crossfading: false,
    currentTime: 42, volume: 0.8, muted: false, sinkId: 'default', activeAudioIndex: 0, queueLength: 3,
    currentTrackId: 't2', observable: true, ...o,
  };
}
function flags(o: Partial<RuntimeHookFlags> = {}): RuntimeHookFlags {
  return {
    masterEnabled: true, hookEnabled: true, queueOnlyAdapterEnabled: true, boundaryReservationEnabled: true,
    runtimeEvidenceEnabled: true, runtimeGuardrailEnabled: true, runtimeRollbackEnabled: true, ...o,
  };
}
function hi(name: string, o: Partial<RuntimeHookInput> = {}): RuntimeHookInput {
  return {
    scenarioName: name, storeId: 's-internal', playerSessionId: 'sess1', resolvedPlaylistId: 'pl-cand',
    queueRevision: 5, resolverSource: 'PILOT_PREVIEW', currentTrackId: 't2', currentIndex: 1,
    playbackState: pb(), boundaryState: 'TRACK_ENDED', crossfadeState: false, recoveryState: false, preloadState: false,
    previewDeploymentId: 'dpl-preview', currentDeploymentId: 'dpl-preview', isPreviewEnvironment: true,
    isControlStore: false, candidatePlaylistId: 'pl-cand', candidateVersion: 3, candidateSnapshotHash: 'snap1',
    existingQueueTrackIds: ['t1', 't2', 't3'], candidateQueueTrackIds: ['t2', 't7', 't8'], sessionCount: 1,
    appliedCount: 0, store: store(), featureFlags: flags(), killSwitch: false, nowMs: NOW, ...o,
  };
}

describe('safety envelope', () => {
  it('every hook result carries the structural safety flags + realPlayerUntouched', () => {
    const r = evaluateRuntimeHook(hi('Valid Single Store'));
    expect(r.actualPlayerControl).toBe(false);
    expect(r.directAudioMutation).toBe(false);
    expect(r.automated).toBe(false);
    expect(r.previewOnly).toBe(true);
    expect(r.realPlayerUntouched).toBe(true);
  });
});

describe('hook gate chain', () => {
  it('1. store not configured / null store → STORE_NOT_ALLOWED', () => {
    expect(evaluateRuntimeHook(hi('Store Not Configured', { store: null })).decision).toBe('STORE_NOT_ALLOWED');
  });
  it('3. wrong store → STORE_NOT_ALLOWED', () => {
    expect(evaluateRuntimeHook(hi('Wrong Store', { storeId: 'other', store: store({ storeId: 'other-x' }) })).decision).toBe('STORE_NOT_ALLOWED');
  });
  it('4. wrong deployment → DEPLOYMENT_MISMATCH', () => {
    expect(evaluateRuntimeHook(hi('Wrong Deployment', { currentDeploymentId: 'dpl-prod' })).decision).toBe('DEPLOYMENT_MISMATCH');
  });
  it('5. flag OFF → FLAG_DISABLED', () => {
    expect(evaluateRuntimeHook(hi('Flag OFF', { featureFlags: flags({ hookEnabled: false }) })).decision).toBe('FLAG_DISABLED');
  });
  it('6. kill switch ON → KILL_SWITCHED', () => {
    expect(evaluateRuntimeHook(hi('Kill Switch', { killSwitch: true })).decision).toBe('KILL_SWITCHED');
  });
  it('control store → CONTROL_PRESERVED and existing queue returned', () => {
    const r = evaluateRuntimeHook(hi('Control Store', { isControlStore: true }));
    expect(r.decision).toBe('CONTROL_PRESERVED');
    expect(r.resultQueueTrackIds).toEqual(['t1', 't2', 't3']);
  });
  it('8. second session → SESSION_LIMIT', () => {
    expect(evaluateRuntimeHook(hi('Second Session', { sessionCount: 2 })).decision).toBe('SESSION_LIMIT');
  });
  it('9. application cap reached → SESSION_LIMIT', () => {
    expect(evaluateRuntimeHook(hi('Application Cap', { appliedCount: 1 })).decision).toBe('SESSION_LIMIT');
  });
  it('10. candidate version mismatch → VERSION_MISMATCH', () => {
    expect(evaluateRuntimeHook(hi('Version Mismatch', { candidateVersion: 9 })).decision).toBe('VERSION_MISMATCH');
  });
  it('11. snapshot mismatch → SNAPSHOT_MISMATCH', () => {
    expect(evaluateRuntimeHook(hi('Snapshot Mismatch', { candidateSnapshotHash: 'zzz' })).decision).toBe('SNAPSHOT_MISMATCH');
  });
  it('not preview environment → STORE_NOT_ALLOWED', () => {
    expect(evaluateRuntimeHook(hi('Prod Env', { isPreviewEnvironment: false })).decision).toBe('STORE_NOT_ALLOWED');
  });
});

describe('boundary safety', () => {
  it('16. track ended boundary → APPLIED_AT_BOUNDARY', () => {
    const r = evaluateRuntimeHook(hi('Track Ended', { boundaryState: 'TRACK_ENDED' }));
    expect(r.decision).toBe('APPLIED_AT_BOUNDARY');
    expect(r.boundaryUsed).toBe('TRACK_ENDED');
  });
  it('17. crossfade active → UNSAFE_BOUNDARY', () => {
    expect(evaluateRuntimeHook(hi('Crossfade Active', { crossfadeState: true })).decision).toBe('UNSAFE_BOUNDARY');
  });
  it('18. recovery active → UNSAFE_BOUNDARY', () => {
    expect(evaluateRuntimeHook(hi('Recovery Active', { recoveryState: true })).decision).toBe('UNSAFE_BOUNDARY');
  });
  it('19. preload active → UNSAFE_BOUNDARY', () => {
    expect(evaluateRuntimeHook(hi('Preload Active', { preloadState: true })).decision).toBe('UNSAFE_BOUNDARY');
  });
  it('playing mid-track (unsafe boundary) → WAITING_BOUNDARY', () => {
    expect(evaluateRuntimeHook(hi('Mid Track', { boundaryState: 'PLAYING_MID_TRACK' })).decision).toBe('WAITING_BOUNDARY');
  });
  it('not observable → UNSAFE_BOUNDARY', () => {
    expect(evaluateRuntimeHook(hi('Not Observable', { boundaryState: 'UNKNOWN_NOT_OBSERVABLE', playbackState: pb({ observable: false }) })).decision).toBe('UNSAFE_BOUNDARY');
  });
});

describe('queue-only adapter (preservation proof)', () => {
  it('20. current track in candidate → replace + remap index, playback fields unchanged, no setQueue', () => {
    const m = computeQueueOnlyMutation({ existingQueueTrackIds: ['t1', 't2', 't3'], candidateQueueTrackIds: ['t9', 't2', 't5'], currentTrackId: 't2', currentIndex: 1, playback: pb() });
    expect(m.result).toBe('QUEUE_REPLACED_PRESERVING_PLAYBACK');
    expect(m.resultIndex).toBe(1);
    expect(m.resultCurrentTrackId).toBe('t2');
    expect(m.playingUnchanged && m.currentTimeUnchanged && m.activeAudioIndexUnchanged && m.currentTrackUnchanged).toBe(true);
    expect(m.setQueueCalled).toBe(false);
    expect(m.setPlayingCalled).toBe(false);
    expect(m.audioApiCalled).toBe(false);
  });
  it('21. current track missing → held as head, candidate tail', () => {
    const m = computeQueueOnlyMutation({ existingQueueTrackIds: ['t1', 't2', 't3'], candidateQueueTrackIds: ['t7', 't8', 't9'], currentTrackId: 't2', currentIndex: 1, playback: pb() });
    expect(m.result).toBe('CURRENT_TRACK_HELD_AS_HEAD');
    expect(m.resultQueueTrackIds[0]).toBe('t2');
    expect(m.resultIndex).toBe(0);
  });
  it('26. empty candidate → BLOCKED, existing unchanged', () => {
    const m = computeQueueOnlyMutation({ existingQueueTrackIds: ['t1', 't2'], candidateQueueTrackIds: [], currentTrackId: 't1', currentIndex: 0, playback: pb() });
    expect(m.result).toBe('BLOCKED_EMPTY_CANDIDATE');
    expect(m.resultQueueTrackIds).toEqual(['t1', 't2']);
  });
  it('invalid index → BLOCKED', () => {
    expect(computeQueueOnlyMutation({ existingQueueTrackIds: ['t1'], candidateQueueTrackIds: ['t2'], currentTrackId: 't1', currentIndex: 5, playback: pb() }).result).toBe('BLOCKED_INVALID_INDEX');
  });
  it('not observable → BLOCKED', () => {
    expect(computeQueueOnlyMutation({ existingQueueTrackIds: ['t1'], candidateQueueTrackIds: ['t2'], currentTrackId: 't1', currentIndex: 0, playback: pb({ observable: false }) }).result).toBe('BLOCKED_NOT_OBSERVABLE');
  });
  it('identical queue → NO_CHANGE', () => {
    expect(computeQueueOnlyMutation({ existingQueueTrackIds: ['t1', 't2'], candidateQueueTrackIds: ['t1', 't2'], currentTrackId: 't1', currentIndex: 0, playback: pb() }).result).toBe('NO_CHANGE');
  });
});

describe('test store contract', () => {
  const ctx = { currentDeploymentId: 'dpl-preview', configuredStoreId: 's-internal', isInternalStore: () => true, nowMs: NOW };
  it('valid single internal store', () => { expect(validateTestStore(store(), ctx).validity).toBe('VALID'); });
  it('no store configured', () => { expect(validateTestStore(null, ctx).validity).toBe('NO_STORE_CONFIGURED'); });
  it('wildcard forbidden', () => { expect(validateTestStore(store({ storeId: '*' }), { ...ctx, configuredStoreId: '*' }).validity).toBe('WILDCARD_FORBIDDEN'); });
  it('multi-store forbidden (mismatch)', () => { expect(validateTestStore(store({ storeId: 'x' }), ctx).validity).toBe('MULTI_STORE_FORBIDDEN'); });
  it('not internal store forbidden', () => { expect(validateTestStore(store(), { ...ctx, isInternalStore: () => false }).validity).toBe('NOT_INTERNAL_STORE'); });
  it('expired', () => { expect(validateTestStore(store({ expiresAtMs: NOW - 1 }), ctx).validity).toBe('EXPIRED'); });
  it('deployment mismatch', () => { expect(validateTestStore(store({ previewDeploymentId: 'other' }), ctx).validity).toBe('DEPLOYMENT_MISMATCH'); });
});

describe('boundary reservation state machine', () => {
  it('legal path RESERVED→VALIDATED→WAITING_BOUNDARY→APPLYING→APPLIED', () => {
    let r = createReservation(hi('res'), 'r1', 'c1');
    expect(r.persistedToProductionDb).toBe(false);
    r = transitionReservation(r, 'VALIDATED', NOW);
    r = transitionReservation(r, 'WAITING_BOUNDARY', NOW);
    r = transitionReservation(r, 'APPLYING', NOW);
    r = transitionReservation(r, 'APPLIED', NOW);
    expect(r.state).toBe('APPLIED');
    expect(r.appliedCount).toBe(1);
  });
  it('illegal jump blocked', () => { expect(canReservationTransition('RESERVED', 'APPLIED')).toBe(false); });
  it('expiry forces EXPIRED', () => {
    const r = createReservation(hi('res', { nowMs: NOW }), 'r1', 'c1');
    expect(transitionReservation(r, 'VALIDATED', NOW + 10_000_000).state).toBe('EXPIRED');
  });
});

describe('runtime arbitration', () => {
  const res = createReservation(hi('res'), 'r1', 'c1');
  const arb = (o: Partial<Parameters<typeof resolveRuntimeArbitration>[0]> = {}) => resolveRuntimeArbitration({
    reservation: res, recoveryActive: false, policyRevisionChanged: false, scheduleRevisionChanged: false,
    existingQueueRevisionChanged: false, killSwitch: false, sessionChanged: false, deploymentChanged: false,
    candidateVersionChanged: false, nowMs: NOW, ...o,
  });
  it('no conflict → CANDIDATE_MAY_APPLY', () => { expect(arb().outcome).toBe('CANDIDATE_MAY_APPLY'); });
  it('18. recovery → CANDIDATE_DEFERRED', () => { expect(arb({ recoveryActive: true }).outcome).toBe('CANDIDATE_DEFERRED'); });
  it('13. policy changed → CANDIDATE_STALE', () => { expect(arb({ policyRevisionChanged: true }).outcome).toBe('CANDIDATE_STALE'); });
  it('14. schedule changed → CANDIDATE_STALE', () => { expect(arb({ scheduleRevisionChanged: true }).outcome).toBe('CANDIDATE_STALE'); });
  it('12. existing queue changed → CANDIDATE_STALE', () => { expect(arb({ existingQueueRevisionChanged: true }).outcome).toBe('CANDIDATE_STALE'); });
  it('32. kill switch after reservation → CANDIDATE_CANCELLED', () => { expect(arb({ killSwitch: true }).outcome).toBe('CANDIDATE_CANCELLED'); });
  it('15. session changed → CANDIDATE_CANCELLED', () => { expect(arb({ sessionChanged: true }).outcome).toBe('CANDIDATE_CANCELLED'); });
});

describe('preservation runtime checks', () => {
  it('22-25. preserved playback → PRESERVED', () => {
    const before = pb(); const after = pb({ queueLength: 4 });
    expect(checkCurrentTrackPreservation({ before, after }).result).toBe('PRESERVED');
    expect(checkPlaybackStatePreservation({ before, after }).result).toBe('PRESERVED');
  });
  it('current time reset → CHANGED_BLOCKED + FORBIDDEN_CHANGE', () => {
    const before = pb(); const after = pb({ currentTime: 0 });
    expect(checkCurrentTrackPreservation({ before, after }).result).toBe('CHANGED_BLOCKED');
    expect(checkPlaybackStatePreservation({ before, after }).result).toBe('FORBIDDEN_CHANGE');
  });
  it('not observable → NOT_OBSERVABLE', () => {
    expect(checkCurrentTrackPreservation({ before: pb({ observable: false }), after: pb() }).result).toBe('NOT_OBSERVABLE');
  });
});

describe('fail-open wrapper', () => {
  const fo = (o: Partial<Parameters<typeof runFailOpen>[0]> = {}) => runFailOpen({
    flagEnabled: true, isPreviewEnvironment: true, deploymentMatch: true, storeAllowed: true, sessionValid: true,
    isControlStore: false, killSwitch: false, bodyThrew: false, bodyErrorSummary: null, ...o,
  });
  it('34. body throws → FAILED_OPEN, existing preserved, never throws to player', () => {
    const r = fo({ bodyThrew: true, bodyErrorSummary: 'x' });
    expect(r.result).toBe('FAILED_OPEN');
    expect(r.existingQueuePreserved && r.existingPlaybackPreserved).toBe(true);
    expect(r.threwToPlayer).toBe(false);
  });
  it('36. control store → SHORT_CIRCUIT_CONTROL', () => { expect(fo({ isControlStore: true }).result).toBe('SHORT_CIRCUIT_CONTROL'); });
  it('gate miss → SHORT_CIRCUIT_DISABLED', () => { expect(fo({ killSwitch: true }).result).toBe('SHORT_CIRCUIT_DISABLED'); });
  it('all pass → PASSED', () => { expect(fo().result).toBe('PASSED'); });
});

describe('guardrails', () => {
  it('35. dangerous signal → STOP_RECOMMENDED, never auto-stop', () => {
    const r = evaluateGuardrails({ signals: ['DOUBLE_PLAYBACK', 'CURRENT_TIME_RESET'] });
    expect(r.verdict).toBe('STOP_RECOMMENDED');
    expect(r.automaticStop).toBe(false);
  });
  it('no signal → CLEAR', () => { expect(evaluateGuardrails({ signals: [] }).verdict).toBe('CLEAR'); });
});

describe('evidence redaction', () => {
  it('hash-only, no PII/audio/token/raw', () => {
    const e = buildEvidence({ kind: 'candidate_applied', storeHash: 'sh', sessionHash: 'se', deploymentHash: 'dh', existingPlaylistHash: 'ep', candidatePlaylistHash: 'cp', queueHashBefore: 'qb', queueHashAfter: 'qa', currentTrackHash: 'ct', boundary: 'TRACK_ENDED', result: 'APPLIED', reasonCode: 'ok', durationMs: 12, nowMs: NOW });
    expect(e.durationBucket).toBe('5-20ms');
    expect(e.containsAudioUrl || e.containsTrackTitle || e.containsArtist || e.containsRawQueue || e.containsRawError || e.containsToken || e.containsPii).toBe(false);
  });
});

describe('manual rollback', () => {
  const rb = (o: Partial<Parameters<typeof evaluateRollback>[0]> = {}) => evaluateRollback({
    existingPlaylistId: 'pl-exist', canRebuildExistingQueue: true, sameSession: true, sameDeployment: true,
    currentTrackSnapshotPresent: true, currentTrackPreservable: true, safeBoundary: true, killSwitch: false, reason: 'op', ...o,
  });
  it('33. safe boundary → ROLLED_BACK_AT_BOUNDARY, never automatic', () => {
    const r = rb();
    expect(r.result).toBe('ROLLED_BACK_AT_BOUNDARY');
    expect(r.automatic).toBe(false);
  });
  it('unsafe boundary → UNSAFE_BOUNDARY (reserved)', () => { expect(rb({ safeBoundary: false }).result).toBe('UNSAFE_BOUNDARY'); });
  it('target missing → TARGET_MISSING', () => { expect(rb({ existingPlaylistId: null }).result).toBe('TARGET_MISSING'); });
});

describe('certification & production CR readiness', () => {
  const good: SingleStoreCertInput = {
    runtimeEvidencePresent: true, previewEnvironmentConfirmed: true, deploymentMatch: true, storeAllowlistMatch: true,
    singleSession: true, candidateVersionMatch: true, snapshotHashMatch: true, safeBoundaryConfirmed: true,
    currentTrackPreserved: true, playbackStatePreserved: true, existingQueueFailOpen: true, killSwitchProven: true,
    manualRollbackProven: true, controlStoreUnchanged: true, noDoublePlayback: true, noUnexpectedPause: true,
    noQueueEmpty: true, noRuntimeError: true,
  };
  it('38. full evidence → CERTIFIED_FOR_SINGLE_INTERNAL_STORE', () => {
    expect(computeSingleStoreCertification(good).status).toBe('CERTIFIED_FOR_SINGLE_INTERNAL_STORE');
  });
  it('no runtime evidence (this phase) → NOT_RUN', () => {
    expect(computeSingleStoreCertification({ ...good, runtimeEvidencePresent: false }).status).toBe('NOT_RUN');
  });
  it('preservation failure → BLOCKED', () => {
    expect(computeSingleStoreCertification({ ...good, currentTrackPreserved: false }).status).toBe('BLOCKED');
  });
  it('39. certified → MORE_SINGLE_STORE_EVIDENCE_REQUIRED', () => {
    expect(computeProductionCrReadiness(computeSingleStoreCertification(good)).status).toBe('MORE_SINGLE_STORE_EVIDENCE_REQUIRED');
  });
  it('40. NOT_RUN cert → NOT_RUN readiness, never runs a production canary', () => {
    const r = computeProductionCrReadiness(computeSingleStoreCertification({ ...good, runtimeEvidencePresent: false }));
    expect(r.status).toBe('NOT_RUN');
    expect(r.actualProductionCanaryRun).toBe(false);
  });
});

describe('Go/No-Go (this phase)', () => {
  it('NO_GO → SAFE_ADAPTER_ONLY, runtime hook not implemented', () => {
    const r = evaluateGoNoGo({
      ci357Success: true, preview357Ready: true, certificationReadyForHook: true,
      internalTestStoreConfigured: false, candidatePlaylistConfigured: false, previewMigrationApplied: false,
      boundaryStateObservableAtRuntime: false, currentTrackPreservationProvable: false, playbackStatePreservationProvable: false,
      controlStoreSeparable: true, previewVsProductionDistinguishable: true, rollbackTargetPresent: false,
    });
    expect(r.decision).toBe('NO_GO');
    expect(r.feasibility).toBe('SAFE_ADAPTER_ONLY');
    expect(r.runtimeHookImplemented).toBe(false);
    expect(r.deferredReason).toBeTruthy();
  });
  it('all Go conditions → GO / SAFE_HOOK_AVAILABLE (hypothetical)', () => {
    const r = evaluateGoNoGo({
      ci357Success: true, preview357Ready: true, certificationReadyForHook: true,
      internalTestStoreConfigured: true, candidatePlaylistConfigured: true, previewMigrationApplied: true,
      boundaryStateObservableAtRuntime: true, currentTrackPreservationProvable: true, playbackStatePreservationProvable: true,
      controlStoreSeparable: true, previewVsProductionDistinguishable: true, rollbackTargetPresent: true,
    });
    expect(r.decision).toBe('GO');
    expect(r.feasibility).toBe('SAFE_HOOK_AVAILABLE');
  });
});
