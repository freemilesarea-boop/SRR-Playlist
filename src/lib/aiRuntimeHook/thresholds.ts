// AI-MUSIC-9 — Isolated preview hook thresholds. Constants only; NO LLM/ML. The runtime hook is DEFERRED this
// phase, so these govern the PURE model + certification only. Certification cannot exceed NOT_RUN without real
// single-store runtime evidence (which does not exist this phase).

// The set of boundary states at which a candidate queue MAY be applied (safe). Anything else is unsafe or
// not-observable and must never apply. Mirrors the audited safe-boundary model (AI-MUSIC-8).
export const SAFE_BOUNDARIES = [
  'TRACK_ENDED', 'CROSSFADE_COMPLETED', 'CROSSFADE_FALLBACK_COMPLETED',
  'PLAYER_IDLE', 'SESSION_START_NOT_PLAYING', 'MANUAL_QUEUE_REFRESH',
] as const;

export const UNSAFE_BOUNDARIES = [
  'CROSSFADE_ACTIVE', 'RECOVERY_ACTIVE', 'PRELOAD_HOLDS_NEXT', 'AUDIO_SWAP_ACTIVE',
  'BUFFERING', 'ERROR_RECOVERY', 'PLAYING_MID_TRACK', 'POLICY_FETCH', 'SCHEDULE_FETCH',
] as const;

// Single-store certification weights (advisory; preservation invariants dominate). Sum = 100.
export const RUNTIME_CERT_WEIGHTS = {
  currentTrackPreserved: 18,
  playbackStatePreserved: 18,
  safeBoundaryConfirmed: 12,
  existingQueueFailOpen: 10,
  killSwitchProven: 8,
  manualRollbackProven: 8,
  controlStoreUnchanged: 8,
  noDoublePlayback: 6,
  noUnexpectedPause: 4,
  noQueueEmpty: 4,
  noRuntimeError: 4,
} as const;

// Minimum synthetic scenarios modelled before the design is considered adequately exercised.
export const MIN_RUNTIME_SCENARIOS = 40;

// Default reservation TTL used by scenarios when none supplied (ms).
export const DEFAULT_RESERVATION_TTL_MS = 2 * 60 * 1000;
