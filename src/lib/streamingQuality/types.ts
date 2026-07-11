// WEB-OBS-7 — Shared streaming-quality types. The admin RPCs return windowed AGGREGATES over
// streaming_quality_events (+ the existing playback_events_v2 start funnel); the pure engines classify
// them. Every classifier degrades to NO_DATA / NOT_AVAILABLE / INSUFFICIENT_DATA rather than fabricating.

export type { Confidence } from '../observability/release';

export type StartStatus = 'SUCCESS' | 'DEGRADED' | 'FAILING' | 'UNKNOWN' | 'INSUFFICIENT_DATA';
export type TransitionStatus = 'SEAMLESS' | 'ACCEPTABLE' | 'GAP_WARNING' | 'GAP_CRITICAL' | 'OVERLAP_WARNING' | 'UNKNOWN' | 'NOT_AVAILABLE';
export type CrossfadeStatus = 'HEALTHY' | 'DEGRADED' | 'FAILING' | 'NOT_APPLICABLE' | 'UNKNOWN' | 'NOT_AVAILABLE';
export type StallStatus = 'HEALTHY' | 'ELEVATED' | 'HIGH' | 'UNKNOWN' | 'NO_DATA';
export type PreloadStatus = 'HEALTHY' | 'DEGRADED' | 'FAILING' | 'UNKNOWN' | 'NOT_AVAILABLE';
export type MediaErrorStatus = 'HEALTHY' | 'ELEVATED' | 'HIGH' | 'UNKNOWN' | 'NO_DATA';
export type RecoveryStatus = 'HEALTHY' | 'DEGRADED' | 'FAILING' | 'NOT_ATTEMPTED' | 'UNKNOWN' | 'INSUFFICIENT_DATA';
export type ContinuityStatus = 'STABLE' | 'DEGRADED' | 'INTERRUPTED' | 'FAILED' | 'UNKNOWN' | 'INSUFFICIENT_DATA';
export type QualityStatus = 'EXCELLENT' | 'HEALTHY' | 'WATCH' | 'DEGRADED' | 'CRITICAL' | 'INSUFFICIENT_DATA';

/** Percentile triplet (ms or ratio). null when no samples. */
export interface Percentiles {
  p50: number | null;
  p75: number | null;
  p95: number | null;
  samples: number;
}

/**
 * Windowed aggregate for one scope (fleet / store / release / browser / device). Produced by the
 * admin RPCs from streaming_quality_events, with the start funnel merged in from playback_events_v2.
 */
export interface QualityAggregate {
  scope: string;                 // label (e.g. release id, store id, 'FLEET')
  sessions: number;              // distinct player sessions in window
  // ── start (from playback_events_v2 funnel + first_progress / media_error) ──
  startRequests: number;         // distinct (session,track) start attempts (retry-deduped server-side)
  startSuccess: number;          // reached first progress / play_25
  startFailed: number;           // media_error before any progress
  startAbandoned: number;        // requested, no progress, no error (within window)
  // ── TTFA_APPROX (ms), from first_progress.duration_ms ──
  ttfa: Percentiles;
  // ── transition / crossfade ──
  transitionGap: Percentiles;    // NOT_AVAILABLE this phase unless gap events exist → samples 0
  crossfadeStarted: number;      // completed + fallback + aborted
  crossfadeCompleted: number;
  crossfadeFallback: number;
  crossfadeAborted: number;
  crossfadeApplicable: boolean;  // false when business_mode-only scope (crossfade disabled)
  // ── stall / buffering (from recovery reason 'stalled'/'neither-playing') ──
  stallSessions: number;
  // ── media / decoder error ──
  mediaErrorSessions: number;
  mediaErrorEvents: number;
  mediaErrorByCode: Record<string, number>;
  // ── preload ──
  preloadReady: number;
  preloadFailed: number;
  // ── recovery ──
  recoveryAttempted: number;
  recoverySucceeded: number;
  recoveryFailed: number;
  // ── session continuity ──
  stableSessions: number;        // sessions with 0 interruptions and ≥ min transitions
  continuityInterruptions: number;
  continuityTransitions: number;
}

export interface QualityComponent {
  key: string;
  status: string;
  goodness: number | null;       // 0..1, null → NO_DATA (dropped from the score)
  detail: string;
}

export interface StreamingQualityResult {
  scope: string;
  sessions: number;
  start: { status: StartStatus; successRate: number | null; requests: number; failed: number; abandoned: number };
  ttfa: { p50: number | null; p75: number | null; p95: number | null; samples: number; approxDisclaimer: string };
  transition: { status: TransitionStatus; gapP75: number | null; gapP95: number | null; samples: number };
  crossfade: { status: CrossfadeStatus; completionRate: number | null; started: number; fallback: number; aborted: number };
  stall: { status: StallStatus; sessionRate: number | null; stallSessions: number };
  mediaError: { status: MediaErrorStatus; sessionRate: number | null; events: number; byCode: Record<string, number> };
  preload: { status: PreloadStatus; readyRate: number | null; ready: number; failed: number; consumed: 'NOT_AVAILABLE' };
  recovery: { status: RecoveryStatus; successRate: number | null; attempted: number; succeeded: number; failed: number };
  continuity: { status: ContinuityStatus; stableRate: number | null; stableSessions: number };
  score: number | null;          // 0..100, null → INSUFFICIENT_DATA
  status: QualityStatus;
  signalCoverage: number;        // present component weight / total weight (0..1)
  components: QualityComponent[];
  confidence: import('../observability/release').Confidence;
  reasons: string[];
}
