// WEB-OBS-6 — Shared fleet types (status enums + per-store aggregate input/result shapes).
//
// The admin RPCs return per-store AGGREGATES over the store_player_health_events window; the pure
// engines here classify those aggregates. Every classifier degrades to UNKNOWN / INSUFFICIENT_DATA /
// NO_DATA rather than fabricating a verdict on thin or absent signal.

import type {
  PlaybackState, VisibilityState, QueueLengthBucket, SchedulerAgeBucket,
  FleetBrowserFamily, FleetDeviceClass,
} from './eventSchema';

export type { Confidence } from '../observability/release';

// ── Per-signal status enums ─────────────────────────────────────────────────
export type LivenessStatus = 'ONLINE' | 'DEGRADED' | 'STALE' | 'OFFLINE' | 'UNKNOWN' | 'INSUFFICIENT_DATA';

export type PlaybackHealthStatus =
  | 'HEALTHY' | 'PLAYING' | 'PAUSED_EXPECTED' | 'PAUSED_UNEXPECTED' | 'STALLED' | 'SILENCE_SUSPECTED'
  | 'QUEUE_EMPTY' | 'NETWORK_DEGRADED' | 'OFFLINE' | 'UNKNOWN' | 'INSUFFICIENT_DATA';

export type SilenceStatus =
  | 'AUDIO_CONFIRMED' | 'PLAYBACK_PROGRESSING' | 'SILENCE_SUSPECTED' | 'AUDIO_ERROR'
  | 'OUTPUT_DEVICE_ERROR' | 'UNKNOWN' | 'NO_DATA';

export type QueueHealthStatus = 'HEALTHY' | 'LOW' | 'EMPTY' | 'STALE' | 'UNKNOWN';

export type SchedulerHealthStatus = 'HEALTHY' | 'STALE' | 'FALLBACK_ACTIVE' | 'UNKNOWN' | 'NO_DATA';

export type NetworkHealthStatus =
  | 'HEALTHY' | 'DEGRADED' | 'DISCONNECTED' | 'RECONNECTING' | 'RECOVERED' | 'UNKNOWN';

export type RepetitionStatus = 'NORMAL' | 'REPEAT_WARNING' | 'REPEAT_ANOMALY' | 'INSUFFICIENT_DATA';

export type FleetHealthStatus =
  | 'HEALTHY' | 'WATCH' | 'DEGRADED' | 'CRITICAL' | 'OFFLINE' | 'INSUFFICIENT_DATA';

/**
 * Per-store aggregate over the observation window (produced by admin_store_player_health / overview).
 * All fields are signal counts / last-known buckets — never raw payloads. `lastSeenAgeSec` is computed
 * server-side (now() − max(occurred/received)) so the client never needs a synced clock.
 */
export interface StoreHealthInput {
  storeId: string;
  /** Seconds since the most recent heartbeat/event for this store (server-computed). null → never seen. */
  lastSeenAgeSec: number | null;
  heartbeats: number;
  lastVisibility: VisibilityState;
  lastPlaybackState: PlaybackState;
  /** Consecutive frozen (no meaningful progress while playing) heartbeats at the window END. */
  frozenStreakAtEnd: number;
  stalledEvents: number;
  silenceSuspectedEvents: number;
  queueEmptyEvents: number;
  lastQueueBucket: QueueLengthBucket;
  hasNext: boolean;
  disconnectEvents: number;
  reconnectEvents: number;
  schedulerAgeBucket: SchedulerAgeBucket;
  /** Distinct track hashes seen (repetition denominator). */
  distinctTracks: number;
  /** Max times any single track hash appeared (repetition numerator). */
  maxTrackRepeat: number;
  /** Track transitions observed (repetition sample size). */
  transitions: number;
  online: boolean;
  release: string;
  browserFamily: FleetBrowserFamily;
  deviceClass: FleetDeviceClass;
  /** repeat mode last reported ('one' means intended repeat → repetition suppressed). */
  repeatMode: 'off' | 'all' | 'one' | 'unknown';
  // ── Attribution (server-derived, display-only; may be null) ──
  storeName?: string | null;
  brandId?: string | null;     // franchise_id in this codebase
  brandName?: string | null;
  enterpriseRegionId?: string | null;
  regionName?: string | null;
}

export interface StoreHealthResult {
  storeId: string;
  storeName: string | null;
  brandId: string | null;
  brandName: string | null;
  regionName: string | null;
  release: string;
  browserFamily: FleetBrowserFamily;
  deviceClass: FleetDeviceClass;
  liveness: LivenessStatus;
  playback: PlaybackHealthStatus;
  silence: SilenceStatus;
  queue: QueueHealthStatus;
  scheduler: SchedulerHealthStatus;
  network: NetworkHealthStatus;
  repetition: RepetitionStatus;
  healthScore: number | null; // 0..100, null when INSUFFICIENT_DATA
  status: FleetHealthStatus;  // per-store rollup band
  confidence: import('../observability/release').Confidence;
  lastSeenAgeSec: number | null;
  hidden: boolean;
  reasons: string[];
}
