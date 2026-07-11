// WEB-OBS-6 — Per-store signal classifiers (pure, unit-tested, rule-based — NO ML).
//
// Each function classifies ONE dimension of a store's health from the windowed aggregate. Every one
// degrades to UNKNOWN / INSUFFICIENT_DATA / NO_DATA rather than inventing a verdict. Hard honesty
// rules baked in:
//   • A single missed heartbeat never means OFFLINE; hidden tabs widen the gate (background throttle).
//   • Silence is never CONFIRMED — the live player has no AnalyserNode, so the strongest verdict is
//     SILENCE_SUSPECTED (sustained frozen progress while "playing").
//   • Scheduler freshness has no real runtime signal → usually NO_DATA (documented weak proxy only).
//   • Player-alive (heartbeat) ≠ audio actually output; paused ≠ fault; online ≠ real reachability.

import type { Confidence } from '../observability/release';
import type {
  StoreHealthInput, LivenessStatus, PlaybackHealthStatus, SilenceStatus,
  QueueHealthStatus, SchedulerHealthStatus, NetworkHealthStatus, RepetitionStatus,
} from './types';
import {
  HEARTBEAT_INTERVAL_SEC, LIVENESS_STALE_MULTIPLIER, LIVENESS_OFFLINE_MULTIPLIER,
  LIVENESS_HIDDEN_STALE_MULTIPLIER, LIVENESS_MIN_HEARTBEATS,
  STALL_MIN_FROZEN_HEARTBEATS, SILENCE_MIN_FROZEN_HEARTBEATS,
  RECONNECT_LOOP_COUNT, NETWORK_DEGRADED_RECONNECTS,
  REPEAT_WARNING_COUNT, REPEAT_ANOMALY_COUNT, REPEAT_MIN_DISTINCT_TRACKS, REPEAT_MIN_TRANSITIONS,
  FLEET_MIN_STORE_HEARTBEATS,
} from './thresholds';

export function isHidden(input: StoreHealthInput): boolean {
  return input.lastVisibility === 'hidden';
}

/** Per-store confidence from heartbeat count; hidden tabs are downgraded (throttled, less reliable). */
export function storeConfidence(input: StoreHealthInput): Confidence {
  if (input.heartbeats < FLEET_MIN_STORE_HEARTBEATS) return 'INSUFFICIENT';
  if (isHidden(input)) return 'LOW'; // background throttling → never HIGH from a hidden tab
  if (input.heartbeats >= 30) return 'HIGH';
  if (input.heartbeats >= 10) return 'MEDIUM';
  return 'LOW';
}

/**
 * Liveness from last-seen age (server-computed seconds). Hidden tabs widen the stale/offline gates.
 * Never OFFLINE from a single missed beat; below the min heartbeat count → INSUFFICIENT_DATA.
 * DEGRADED is a store-rollup concept (ONLINE-but-unhealthy), not produced here.
 */
export function computeLiveness(input: StoreHealthInput): LivenessStatus {
  if (input.lastSeenAgeSec == null) return 'UNKNOWN';
  if (input.heartbeats < LIVENESS_MIN_HEARTBEATS) return 'INSUFFICIENT_DATA';
  const hiddenMul = isHidden(input) ? LIVENESS_HIDDEN_STALE_MULTIPLIER : 1;
  const staleGate = HEARTBEAT_INTERVAL_SEC * LIVENESS_STALE_MULTIPLIER * hiddenMul;
  const offlineGate = HEARTBEAT_INTERVAL_SEC * LIVENESS_OFFLINE_MULTIPLIER * hiddenMul;
  const age = input.lastSeenAgeSec;
  if (age <= staleGate) return 'ONLINE';
  if (age <= offlineGate) return 'STALE';
  return 'OFFLINE';
}

/**
 * Playback health. Precedence: offline → data gate → queue-empty → silence → stall → network → the
 * plain playing/paused states. Paused is never asserted as a fault (intent is unknowable from the
 * store), so it maps to PAUSED_EXPECTED.
 */
export function computePlaybackHealth(input: StoreHealthInput): PlaybackHealthStatus {
  const liveness = computeLiveness(input);
  if (liveness === 'OFFLINE' || input.online === false) return 'OFFLINE';
  if (input.heartbeats < FLEET_MIN_STORE_HEARTBEATS) return 'INSUFFICIENT_DATA';
  if (input.lastQueueBucket === 'empty') return 'QUEUE_EMPTY';
  const playing = input.lastPlaybackState === 'playing';
  if (playing && input.frozenStreakAtEnd >= SILENCE_MIN_FROZEN_HEARTBEATS) return 'SILENCE_SUSPECTED';
  if (playing && input.frozenStreakAtEnd >= STALL_MIN_FROZEN_HEARTBEATS) return 'STALLED';
  if (input.reconnectEvents >= RECONNECT_LOOP_COUNT) return 'NETWORK_DEGRADED';
  if (playing) return 'PLAYING';
  if (input.lastPlaybackState === 'paused') return 'PAUSED_EXPECTED';
  if (input.lastPlaybackState === 'stopped') return 'PAUSED_EXPECTED';
  return 'UNKNOWN';
}

/**
 * Silence classification. Deliberately conservative: no AnalyserNode → AUDIO_CONFIRMED is impossible,
 * and audio-element error/output-device signals are NOT captured this phase (would require a forbidden
 * Player.tsx change) → those channels are NO_DATA. The strongest positive verdict is SILENCE_SUSPECTED.
 */
export function computeSilence(input: StoreHealthInput): SilenceStatus {
  if (input.heartbeats < FLEET_MIN_STORE_HEARTBEATS) return 'NO_DATA';
  if (input.lastPlaybackState !== 'playing') return 'UNKNOWN';
  if (input.frozenStreakAtEnd >= SILENCE_MIN_FROZEN_HEARTBEATS) return 'SILENCE_SUSPECTED';
  return 'PLAYBACK_PROGRESSING';
}

export function computeQueueHealth(input: StoreHealthInput): QueueHealthStatus {
  if (input.heartbeats < FLEET_MIN_STORE_HEARTBEATS) return 'UNKNOWN';
  switch (input.lastQueueBucket) {
    case 'empty': return 'EMPTY';
    case 'low': return 'LOW';
    case 'some':
    case 'many': return 'HEALTHY';
    default: return 'UNKNOWN';
  }
}

/**
 * Scheduler health. The runtime exposes NO scheduler-refresh timestamp (audited), so this is a WEAK
 * proxy from how long the same playlist context has been active. Usually NO_DATA. Never FAILED.
 */
export function computeSchedulerHealth(input: StoreHealthInput): SchedulerHealthStatus {
  switch (input.schedulerAgeBucket) {
    case 'stale': return 'STALE';
    case 'fresh':
    case 'recent':
    case 'aging': return 'HEALTHY';
    default: return 'NO_DATA';
  }
}

/** Network health from online state + observed disconnect/reconnect transitions. onLine ≠ reachability. */
export function computeNetworkHealth(input: StoreHealthInput): NetworkHealthStatus {
  if (input.online === false) return 'DISCONNECTED';
  if (input.heartbeats < FLEET_MIN_STORE_HEARTBEATS) return 'UNKNOWN';
  if (input.reconnectEvents >= RECONNECT_LOOP_COUNT) return 'DEGRADED';         // reconnect loop
  if (input.reconnectEvents >= NETWORK_DEGRADED_RECONNECTS) return 'DEGRADED';
  if (input.disconnectEvents > 0 && input.reconnectEvents > 0) return 'RECOVERED';
  return 'HEALTHY';
}

/**
 * Duplicate / repetition. Non-reversible hashes only. Intended repeat (repeat='one', tiny playlist)
 * is excluded; a small playlist → INSUFFICIENT_DATA, never ANOMALY.
 */
export function computeRepetition(input: StoreHealthInput): RepetitionStatus {
  if (input.repeatMode === 'one') return 'NORMAL'; // intended single-track loop
  if (input.transitions < REPEAT_MIN_TRANSITIONS || input.distinctTracks < REPEAT_MIN_DISTINCT_TRACKS) {
    return 'INSUFFICIENT_DATA';
  }
  if (input.maxTrackRepeat >= REPEAT_ANOMALY_COUNT) return 'REPEAT_ANOMALY';
  if (input.maxTrackRepeat >= REPEAT_WARNING_COUNT) return 'REPEAT_WARNING';
  return 'NORMAL';
}
