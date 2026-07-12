// AI-MUSIC-10 — Boundary snapshot reducer (pure state machine). Applies observer signals to a session-scoped,
// monotonically-revisioned snapshot with stale/duplicate/wrong-session protection and per-signal sequence
// validation. It only RECORDS invalid transitions / stale events — it never blocks the player. Session change
// resets the snapshot and namespaces the revision. Deterministic (no clock — nowMs passed in). This reducer is
// the read-only heart of the bridge; nothing here touches the queue, playback, or audio.

import type {
  RuntimeBoundarySnapshot, BoundaryRevisions, ObserverSignal, BoundaryCandidate, DataStatus,
  CrossfadeState, RecoveryState, PreloadState, AudioSwapState, FreshnessResult, SequenceResult,
} from './types';
import { evaluateFreshness } from './revision';
import { validateTransition } from './sequenceValidator';
import { computeStableBoundary } from './stableBoundary';

export interface BoundaryReducerState {
  sessionId: string | null;
  snapshot: RuntimeBoundarySnapshot | null;
  revisions: BoundaryRevisions;
  lastAtMs: number;
  counters: {
    snapshots: number;
    crossfadeTransitions: number;
    recoveryTransitions: number;
    preloadTransitions: number;
    swapTransitions: number;
    safeBoundaries: number;
    blockedBoundaries: number;
    staleEvents: number;
    observerErrors: number;
    invalidTransitions: number;
  };
  seenStates: string[];
  lastFreshness: FreshnessResult | null;
  lastSequence: SequenceResult | null;
}

const ZERO_REV: BoundaryRevisions = {
  sessionRevision: 0, boundaryRevision: 0, crossfadeRevision: 0, recoveryRevision: 0,
  preloadRevision: 0, audioSwapRevision: 0, queueObservationRevision: 0,
};

export function initialBoundaryState(): BoundaryReducerState {
  return {
    sessionId: null, snapshot: null, revisions: { ...ZERO_REV }, lastAtMs: 0,
    counters: { snapshots: 0, crossfadeTransitions: 0, recoveryTransitions: 0, preloadTransitions: 0, swapTransitions: 0, safeBoundaries: 0, blockedBoundaries: 0, staleEvents: 0, observerErrors: 0, invalidTransitions: 0 },
    seenStates: [], lastFreshness: null, lastSequence: null,
  };
}

function emptySnapshot(sessionId: string | null, revisions: BoundaryRevisions, nowMs: number): RuntimeBoundarySnapshot {
  return {
    playerSessionId: sessionId, observedAtMs: nowMs, revision: revisions.boundaryRevision, revisions,
    currentTrackIdHash: null, currentIndex: -1, queueLength: 0, playing: false, paused: false, ended: false,
    buffering: false, waiting: false, stalled: false, crossfadeState: 'UNKNOWN', recoveryState: 'UNKNOWN',
    recoveryReason: null, preloadState: 'UNKNOWN', audioSwapState: 'UNKNOWN', activeAudioIndex: -1,
    inactiveAudioReady: false, nextTrackHash: null, boundaryCandidate: 'UNKNOWN', stableForQueueChange: false,
    reasonCodes: ['SESSION_START'], dataStatus: sessionId == null ? 'NO_SESSION' : 'PARTIAL',
  };
}

export function resetForSession(state: BoundaryReducerState, sessionId: string | null, nowMs: number): BoundaryReducerState {
  const revisions: BoundaryRevisions = { ...ZERO_REV, sessionRevision: state.revisions.sessionRevision + 1, boundaryRevision: 1 };
  return {
    ...initialBoundaryState(),
    sessionId,
    revisions,
    lastAtMs: nowMs,
    snapshot: emptySnapshot(sessionId, revisions, nowMs),
  };
}

function deriveBoundaryCandidate(s: RuntimeBoundarySnapshot): BoundaryCandidate {
  if (s.playerSessionId == null) return 'UNKNOWN';
  if (s.crossfadeState === 'COMPLETING') return 'CROSSFADE_COMPLETED';
  if (s.crossfadeState === 'FALLBACK') return 'CROSSFADE_FALLBACK_COMPLETED';
  if (s.recoveryState === 'RECOVERED') return 'RECOVERY_COMPLETED';
  if (s.ended) return 'TRACK_ENDED';
  if (!s.playing && s.currentIndex < 0) return 'SESSION_START';
  if (!s.playing && !s.buffering && !s.waiting) return 'PLAYER_IDLE';
  return 'NONE';
}

// Recompute derived fields (boundary candidate, stability, revision, data status) after any field change.
function finalize(snapshot: RuntimeBoundarySnapshot, revisions: BoundaryRevisions, nowMs: number): RuntimeBoundarySnapshot {
  const boundaryRevision = revisions.boundaryRevision + 1;
  const nextRevisions = { ...revisions, boundaryRevision };
  const withRev: RuntimeBoundarySnapshot = { ...snapshot, revisions: nextRevisions, revision: boundaryRevision, observedAtMs: nowMs };
  const candidate = deriveBoundaryCandidate(withRev);
  const stable = computeStableBoundary(withRev);
  const dataStatus: DataStatus = withRev.playerSessionId == null ? 'NO_SESSION' : 'OK';
  return { ...withRev, boundaryCandidate: candidate, stableForQueueChange: stable.result === 'SAFE', reasonCodes: stable.blockers.length ? stable.blockers : [stable.result], dataStatus };
}

function bump(map: BoundaryRevisions, key: keyof BoundaryRevisions): BoundaryRevisions {
  return { ...map, [key]: map[key] + 1 };
}

export function applySignal(state: BoundaryReducerState, signal: ObserverSignal, nowMs: number): BoundaryReducerState {
  // Session signal → reset on change (idempotent for the same id).
  if (signal.kind === 'session') {
    if (signal.playerSessionId === state.sessionId) return state;
    return resetForSession(state, signal.playerSessionId, nowMs);
  }
  if (state.sessionId == null || state.snapshot == null) {
    // No session yet → cannot attribute; record as stale/dropped.
    return { ...state, counters: { ...state.counters, staleEvents: state.counters.staleEvents + 1 }, lastFreshness: { status: 'INVALID', reasons: ['Session 미확정'] } };
  }

  // Freshness (revision + timestamp + session).
  const freshness = evaluateFreshness({
    incomingSessionId: state.sessionId, currentSessionId: state.sessionId,
    incomingRevision: state.revisions.boundaryRevision + 1, lastRevision: state.revisions.boundaryRevision,
    incomingAtMs: nowMs, lastAtMs: state.lastAtMs, isDuplicatePayload: false,
  });
  if (freshness.status === 'OUT_OF_ORDER' || freshness.status === 'STALE' || freshness.status === 'WRONG_SESSION' || freshness.status === 'INVALID') {
    return { ...state, counters: { ...state.counters, staleEvents: state.counters.staleEvents + 1 }, lastFreshness: freshness };
  }

  let snapshot = { ...state.snapshot };
  let revisions = { ...state.revisions };
  const counters = { ...state.counters };
  const seen = new Set(state.seenStates);
  let sequence: SequenceResult | null = state.lastSequence;

  switch (signal.kind) {
    case 'crossfade': {
      sequence = validateTransition({ kind: 'crossfade', from: snapshot.crossfadeState === 'UNKNOWN' ? null : snapshot.crossfadeState, to: signal.state, sameSession: true, staleRevision: false });
      if (sequence.status === 'INVALID_TRANSITION') counters.invalidTransitions += 1;
      snapshot.crossfadeState = signal.state as CrossfadeState;
      if (signal.activeAudioIndex != null) snapshot.activeAudioIndex = signal.activeAudioIndex;
      revisions = bump(revisions, 'crossfadeRevision');
      counters.crossfadeTransitions += 1;
      seen.add(`crossfade:${signal.state}`);
      break;
    }
    case 'recovery': {
      sequence = validateTransition({ kind: 'recovery', from: snapshot.recoveryState === 'UNKNOWN' ? null : snapshot.recoveryState, to: signal.state, sameSession: true, staleRevision: false });
      if (sequence.status === 'INVALID_TRANSITION') counters.invalidTransitions += 1;
      snapshot.recoveryState = signal.state as RecoveryState;
      snapshot.recoveryReason = signal.reason ?? snapshot.recoveryReason;
      revisions = bump(revisions, 'recoveryRevision');
      counters.recoveryTransitions += 1;
      seen.add(`recovery:${signal.state}`);
      break;
    }
    case 'preload': {
      sequence = validateTransition({ kind: 'preload', from: snapshot.preloadState === 'UNKNOWN' ? null : snapshot.preloadState, to: signal.state, sameSession: true, staleRevision: false });
      if (sequence.status === 'INVALID_TRANSITION') counters.invalidTransitions += 1;
      snapshot.preloadState = signal.state as PreloadState;
      if (signal.nextTrackHash !== undefined) snapshot.nextTrackHash = signal.nextTrackHash;
      snapshot.inactiveAudioReady = signal.state === 'READY';
      revisions = bump(revisions, 'preloadRevision');
      counters.preloadTransitions += 1;
      seen.add(`preload:${signal.state}`);
      break;
    }
    case 'audioSwap': {
      sequence = validateTransition({ kind: 'audioSwap', from: snapshot.audioSwapState === 'UNKNOWN' ? null : snapshot.audioSwapState, to: signal.state, sameSession: true, staleRevision: false });
      if (sequence.status === 'INVALID_TRANSITION') counters.invalidTransitions += 1;
      snapshot.audioSwapState = signal.state as AudioSwapState;
      if (signal.afterActiveIndex != null) snapshot.activeAudioIndex = signal.afterActiveIndex;
      revisions = bump(revisions, 'audioSwapRevision');
      counters.swapTransitions += 1;
      seen.add(`audioSwap:${signal.state}`);
      break;
    }
    case 'playerState': {
      snapshot.playing = signal.playing; snapshot.paused = signal.paused; snapshot.ended = signal.ended;
      snapshot.buffering = signal.buffering; snapshot.waiting = signal.waiting; snapshot.stalled = signal.stalled;
      snapshot.currentTrackIdHash = signal.currentTrackIdHash; snapshot.currentIndex = signal.currentIndex;
      snapshot.queueLength = signal.queueLength; snapshot.activeAudioIndex = signal.activeAudioIndex;
      snapshot.inactiveAudioReady = signal.inactiveAudioReady; snapshot.nextTrackHash = signal.nextTrackHash;
      revisions = bump(revisions, 'queueObservationRevision');
      break;
    }
  }

  snapshot = finalize(snapshot, revisions, nowMs);
  revisions = snapshot.revisions;
  counters.snapshots += 1;
  if (snapshot.stableForQueueChange) counters.safeBoundaries += 1; else counters.blockedBoundaries += 1;

  return { ...state, snapshot, revisions, lastAtMs: nowMs, counters, seenStates: Array.from(seen), lastFreshness: freshness, lastSequence: sequence };
}
