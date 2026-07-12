// AI-MUSIC-10 — Runtime Boundary Observability Bridge unit tests. Pure & deterministic. These exercise the
// read-only observer model: contract/reducer, session attribution + reset, revision/stale/duplicate/wrong-
// session protection, per-signal sequence validation (valid + invalid recorded, never blocking), stable-boundary
// blockers, coverage NO_DATA, readiness capped at BOUNDARY_OBSERVABILITY_READY, evidence redaction, and the
// zero-control / fail-open guarantees (flag OFF → the store never changes; the store exposes no player-control
// method).
import { describe, it, expect, beforeEach } from 'vitest';
import {
  evaluateFreshness, validateTransition, computeStableBoundary, computeBoundaryCoverage, computeHookReadiness,
  buildBoundaryEvidence, initialBoundaryState, applySignal, resetForSession, isObserverActive,
  useRuntimeBoundaryStore, publishCrossfade, publishRecovery, publishPreload, publishAudioSwap,
  type AiRuntimeBoundaryConfig, type RuntimeBoundarySnapshot, type ObserverSignal,
} from './index';

const NOW = 1_700_000_000_000;

function cfg(o: Partial<AiRuntimeBoundaryConfig> = {}): AiRuntimeBoundaryConfig {
  return { masterEnabled: true, observerEnabled: true, crossfadeObserverEnabled: true, recoveryObserverEnabled: true, preloadObserverEnabled: true, audioSwapObserverEnabled: true, evidenceEnabled: true, dashboardEnabled: true, killSwitch: false, ...o };
}
function sig(s: ObserverSignal): ObserverSignal { return s; }

describe('config gate (isObserverActive)', () => {
  it('active only when master + observer on and kill switch off', () => {
    expect(isObserverActive(cfg())).toBe(true);
    expect(isObserverActive(cfg({ killSwitch: true }))).toBe(false);
    expect(isObserverActive(cfg({ masterEnabled: false }))).toBe(false);
    expect(isObserverActive(cfg({ observerEnabled: false }))).toBe(false);
  });
});

describe('freshness / stale protection', () => {
  const base = { incomingSessionId: 's1', currentSessionId: 's1', incomingRevision: 5, lastRevision: 4, incomingAtMs: NOW, lastAtMs: NOW - 10, isDuplicatePayload: false };
  it('current', () => { expect(evaluateFreshness(base).status).toBe('CURRENT'); });
  it('wrong session', () => { expect(evaluateFreshness({ ...base, incomingSessionId: 'other' }).status).toBe('WRONG_SESSION'); });
  it('stale revision', () => { expect(evaluateFreshness({ ...base, incomingRevision: 3 }).status).toBe('STALE'); });
  it('out of order', () => { expect(evaluateFreshness({ ...base, incomingAtMs: NOW - 100 }).status).toBe('OUT_OF_ORDER'); });
  it('duplicate', () => { expect(evaluateFreshness({ ...base, incomingRevision: 4, isDuplicatePayload: true }).status).toBe('DUPLICATE'); });
  it('no session → invalid', () => { expect(evaluateFreshness({ ...base, incomingSessionId: null }).status).toBe('INVALID'); });
});

describe('sequence validator', () => {
  it('crossfade valid IDLE→ACTIVE→COMPLETING→IDLE', () => {
    expect(validateTransition({ kind: 'crossfade', from: 'IDLE', to: 'ACTIVE', sameSession: true, staleRevision: false }).status).toBe('VALID');
    expect(validateTransition({ kind: 'crossfade', from: 'ACTIVE', to: 'COMPLETING', sameSession: true, staleRevision: false }).status).toBe('VALID');
    expect(validateTransition({ kind: 'crossfade', from: 'COMPLETING', to: 'IDLE', sameSession: true, staleRevision: false }).status).toBe('VALID');
  });
  it('crossfade invalid IDLE→COMPLETING', () => { expect(validateTransition({ kind: 'crossfade', from: 'IDLE', to: 'COMPLETING', sameSession: true, staleRevision: false }).status).toBe('INVALID_TRANSITION'); });
  it('recovery invalid IDLE→RECOVERED', () => { expect(validateTransition({ kind: 'recovery', from: 'IDLE', to: 'RECOVERED', sameSession: true, staleRevision: false }).status).toBe('INVALID_TRANSITION'); });
  it('preload invalid IDLE→READY', () => { expect(validateTransition({ kind: 'preload', from: 'IDLE', to: 'READY', sameSession: true, staleRevision: false }).status).toBe('INVALID_TRANSITION'); });
  it('audio swap invalid IDLE→COMPLETED', () => { expect(validateTransition({ kind: 'audioSwap', from: 'IDLE', to: 'COMPLETED', sameSession: true, staleRevision: false }).status).toBe('INVALID_TRANSITION'); });
  it('session changed short-circuits', () => { expect(validateTransition({ kind: 'crossfade', from: 'ACTIVE', to: 'IDLE', sameSession: false, staleRevision: false }).status).toBe('SESSION_CHANGED'); });
  it('stale revision short-circuits', () => { expect(validateTransition({ kind: 'crossfade', from: 'ACTIVE', to: 'IDLE', sameSession: true, staleRevision: true }).status).toBe('STALE_TRANSITION'); });
});

function snap(o: Partial<RuntimeBoundarySnapshot> = {}): RuntimeBoundarySnapshot {
  return {
    playerSessionId: 's1', observedAtMs: NOW, revision: 2, revisions: { sessionRevision: 1, boundaryRevision: 2, crossfadeRevision: 0, recoveryRevision: 0, preloadRevision: 0, audioSwapRevision: 0, queueObservationRevision: 1 },
    currentTrackIdHash: 'abc', currentIndex: 1, queueLength: 3, playing: true, paused: false, ended: false,
    buffering: false, waiting: false, stalled: false, crossfadeState: 'IDLE', recoveryState: 'IDLE', recoveryReason: null,
    preloadState: 'IDLE', audioSwapState: 'IDLE', activeAudioIndex: 0, inactiveAudioReady: false, nextTrackHash: null,
    boundaryCandidate: 'NONE', stableForQueueChange: true, reasonCodes: [], dataStatus: 'OK', ...o,
  };
}

describe('stable boundary engine', () => {
  it('SAFE when idle & valid', () => { expect(computeStableBoundary(snap()).result).toBe('SAFE'); });
  it('BLOCKED_CROSSFADE', () => { expect(computeStableBoundary(snap({ crossfadeState: 'ACTIVE' })).result).toBe('BLOCKED_CROSSFADE'); });
  it('BLOCKED_RECOVERY', () => { expect(computeStableBoundary(snap({ recoveryState: 'ATTEMPTING' })).result).toBe('BLOCKED_RECOVERY'); });
  it('BLOCKED_PRELOAD', () => { expect(computeStableBoundary(snap({ preloadState: 'LOADING' })).result).toBe('BLOCKED_PRELOAD'); });
  it('BLOCKED_AUDIO_SWAP', () => { expect(computeStableBoundary(snap({ audioSwapState: 'SWAPPING' })).result).toBe('BLOCKED_AUDIO_SWAP'); });
  it('BLOCKED_BUFFERING/WAITING/STALLED', () => {
    expect(computeStableBoundary(snap({ buffering: true })).result).toBe('BLOCKED_BUFFERING');
    expect(computeStableBoundary(snap({ waiting: true })).result).toBe('BLOCKED_WAITING');
    expect(computeStableBoundary(snap({ stalled: true })).result).toBe('BLOCKED_STALLED');
  });
  it('EMPTY_QUEUE / INVALID_INDEX / INVALID_CURRENT_TRACK / NO_SESSION', () => {
    expect(computeStableBoundary(snap({ queueLength: 0 })).result).toBe('EMPTY_QUEUE');
    expect(computeStableBoundary(snap({ currentIndex: 9 })).result).toBe('INVALID_INDEX');
    expect(computeStableBoundary(snap({ currentTrackIdHash: null })).result).toBe('INVALID_CURRENT_TRACK');
    expect(computeStableBoundary(snap({ playerSessionId: null })).result).toBe('NO_SESSION');
  });
  it('recovery RECOVERED & preload READY are not blockers', () => {
    expect(computeStableBoundary(snap({ recoveryState: 'RECOVERED', preloadState: 'READY' })).result).toBe('SAFE');
  });
});

describe('reducer — session attribution & signals', () => {
  it('session start creates snapshot; same id is idempotent', () => {
    let st = resetForSession(initialBoundaryState(), 's1', NOW);
    expect(st.snapshot?.playerSessionId).toBe('s1');
    const rev = st.revisions.sessionRevision;
    st = applySignal(st, sig({ kind: 'session', playerSessionId: 's1' }), NOW + 1);
    expect(st.revisions.sessionRevision).toBe(rev);
  });
  it('session change resets + bumps session revision', () => {
    let st = resetForSession(initialBoundaryState(), 's1', NOW);
    st = applySignal(st, sig({ kind: 'crossfade', state: 'ACTIVE' }), NOW + 1);
    st = applySignal(st, sig({ kind: 'session', playerSessionId: 's2' }), NOW + 2);
    expect(st.sessionId).toBe('s2');
    expect(st.snapshot?.crossfadeState).toBe('UNKNOWN');
    expect(st.revisions.sessionRevision).toBe(2);
  });
  it('crossfade signal updates state, bumps revision, counts transition', () => {
    let st = resetForSession(initialBoundaryState(), 's1', NOW);
    st = applySignal(st, sig({ kind: 'crossfade', state: 'ACTIVE', activeAudioIndex: 1 }), NOW + 1);
    expect(st.snapshot?.crossfadeState).toBe('ACTIVE');
    expect(st.counters.crossfadeTransitions).toBe(1);
    expect(st.snapshot?.stableForQueueChange).toBe(false); // crossfade active blocks
  });
  it('invalid transition is RECORDED, not blocking (still applies)', () => {
    let st = resetForSession(initialBoundaryState(), 's1', NOW);
    st = applySignal(st, sig({ kind: 'recovery', state: 'IDLE' }), NOW + 1); // UNKNOWN→IDLE (establishes known state)
    st = applySignal(st, sig({ kind: 'recovery', state: 'RECOVERED' }), NOW + 2); // IDLE→RECOVERED invalid
    expect(st.counters.invalidTransitions).toBe(1);
    expect(st.snapshot?.recoveryState).toBe('RECOVERED'); // still applied (observer never blocks)
  });
  it('out-of-order event is dropped as stale', () => {
    let st = resetForSession(initialBoundaryState(), 's1', NOW + 100);
    const before = st.counters.staleEvents;
    st = applySignal(st, sig({ kind: 'crossfade', state: 'ACTIVE' }), NOW); // earlier ts
    expect(st.counters.staleEvents).toBe(before + 1);
  });
  it('signal before any session → dropped (no attribution)', () => {
    const st = applySignal(initialBoundaryState(), sig({ kind: 'crossfade', state: 'ACTIVE' }), NOW);
    expect(st.counters.staleEvents).toBe(1);
    expect(st.snapshot).toBeNull();
  });
  it('full crossfade lifecycle reaches SAFE at IDLE', () => {
    let st = resetForSession(initialBoundaryState(), 's1', NOW);
    st = applySignal(st, sig({ kind: 'playerState', playing: true, paused: false, ended: false, buffering: false, waiting: false, stalled: false, currentTrackIdHash: 'h', currentIndex: 0, queueLength: 2, activeAudioIndex: 0, inactiveAudioReady: false, nextTrackHash: null }), NOW + 1);
    st = applySignal(st, sig({ kind: 'crossfade', state: 'ACTIVE' }), NOW + 2);
    st = applySignal(st, sig({ kind: 'crossfade', state: 'COMPLETING' }), NOW + 3);
    st = applySignal(st, sig({ kind: 'crossfade', state: 'IDLE' }), NOW + 4);
    expect(st.snapshot?.stableForQueueChange).toBe(true);
  });
});

describe('coverage', () => {
  it('no browser runtime → NO_DATA', () => {
    expect(computeBoundaryCoverage({ sessionsObserved: 0, snapshots: 0, crossfadeTransitions: 0, recoveryTransitions: 0, preloadTransitions: 0, swapTransitions: 0, safeBoundaries: 0, blockedBoundaries: 0, staleEvents: 0, observerErrors: 0, distinctStatesSeen: 0, browserRuntimeRan: false }).status).toBe('NO_DATA');
  });
  it('rich runtime → SUFFICIENT', () => {
    const r = computeBoundaryCoverage({ sessionsObserved: 2, snapshots: 50, crossfadeTransitions: 6, recoveryTransitions: 3, preloadTransitions: 5, swapTransitions: 4, safeBoundaries: 20, blockedBoundaries: 10, staleEvents: 1, observerErrors: 0, distinctStatesSeen: 18, browserRuntimeRan: true });
    expect(r.status).toBe('SUFFICIENT');
    expect(r.stateCoveragePct).toBeGreaterThanOrEqual(70);
  });
});

describe('hook readiness', () => {
  const full = { crossfadeObservable: true, recoveryObservable: true, preloadObservable: true, audioSwapObservable: true, stableBoundaryEngine: true, revisionStaleProtection: true, sessionAttribution: true, zeroControlGuaranteed: true, observerFailOpen: true, sequenceValidation: true, sufficientTestCoverage: true };
  it('observable but no store/migration → capped at BOUNDARY_OBSERVABILITY_READY', () => {
    expect(computeHookReadiness({ ...full, internalTestStoreConfigured: false, previewMigrationApplied: false }).status).toBe('BOUNDARY_OBSERVABILITY_READY');
  });
  it('with store + migration → single-store CR', () => {
    expect(computeHookReadiness({ ...full, internalTestStoreConfigured: true, previewMigrationApplied: true }).status).toBe('READY_FOR_SINGLE_STORE_CHANGE_REQUEST');
  });
  it('missing observability → NOT_READY, hook not implemented', () => {
    const r = computeHookReadiness({ ...full, crossfadeObservable: false, internalTestStoreConfigured: false, previewMigrationApplied: false });
    expect(r.status).toBe('NOT_READY');
    expect(r.runtimeHookImplemented).toBe(false);
  });
});

describe('evidence redaction', () => {
  it('hash-only, no PII/title/artist/url/token', () => {
    const e = buildBoundaryEvidence({ kind: 'crossfade_state_changed', sessionHash: 'sh', storeHash: 'st', state: 'ACTIVE', reason: 'start', revision: 3, durationMs: 12, nowMs: NOW });
    expect(e.durationBucket).toBe('5-20ms');
    expect(e.containsTrackTitle || e.containsArtist || e.containsAudioUrl || e.containsSignedUrl || e.containsRawQueue || e.containsRawError || e.containsToken || e.containsPii).toBe(false);
  });
});

describe('zero-control guarantee & fail-open (default OFF)', () => {
  beforeEach(() => { useRuntimeBoundaryStore.getState().reset(); });
  it('the observer store exposes NO player-control method', () => {
    const s = useRuntimeBoundaryStore.getState() as unknown as Record<string, unknown>;
    for (const forbidden of ['setQueue', 'setPlaying', 'play', 'pause', 'next', 'previous', 'load', 'seek', 'setSinkId', 'recover', 'startCrossfade']) {
      expect(s[forbidden]).toBeUndefined();
    }
  });
  it('publish is a no-op when the observer is disabled (default flags OFF, kill switch ON)', () => {
    // In the test env the AI-MUSIC master + observer flags are OFF and the kill switch is ON by default.
    publishCrossfade('ACTIVE');
    publishRecovery('ATTEMPTING');
    publishPreload('LOADING', 't1');
    publishAudioSwap('SWAPPING', 0, 1);
    const st = useRuntimeBoundaryStore.getState();
    expect(st.snapshot).toBeNull();
    expect(st.counters.snapshots).toBe(0);
    expect(st.counters.observerErrors).toBe(0);
  });
});
