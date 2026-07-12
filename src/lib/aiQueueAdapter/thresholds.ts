// AI-MUSIC-8 — Queue adapter thresholds & source priority (single source of truth). Constants only; NO LLM/ML.
// The source priority mirrors the AUDITED real resolution precedence — it is NOT invented. From the delivery
// audit (AI-MUSIC-6/7): on the store player, a franchise policy is layered last and effectively wins over the
// business schedule; a store default is the fallback; recovery/manual actions are user/system-initiated and
// must not be silently overridden; a PILOT_PREVIEW must NEVER outrank an existing resolver (and never wins in
// production). Higher number = higher priority.

import type { QueueSource } from './types';

export const SOURCE_PRIORITY: Record<QueueSource, number> = {
  MANUAL_REFRESH: 100,     // explicit operator/user refresh
  RECOVERY: 90,            // recovery must not be silently overridden
  FRANCHISE_POLICY: 60,    // franchise policy wins over schedule on the store player (audited)
  BUSINESS_SCHEDULE: 50,
  STORE_DEFAULT: 40,
  PILOT_PREVIEW: 30,       // never outranks an existing resolver; never wins in production
  UNKNOWN: 0,
};

// Certification score weights (sum = 100). Advisory; preservation invariants dominate.
export const CERT_WEIGHTS = {
  currentTrackPreservation: 20,
  playbackStatePreservation: 20,
  boundarySafety: 12,
  staleProtection: 12,
  idempotency: 8,
  resolverRaceSafety: 10,
  controlPreservation: 8,
  failOpen: 6,
  killSwitch: 4,
} as const;
export const CERT_PURE_HARNESS_MIN = 80;
export const CERT_PREVIEW_HOOK_MIN = 90;

// Scenario coverage floor (small by design — pure harness only; never "production ready").
export const MIN_SCENARIOS = 30;

// Default pending-command TTL used by scenarios when none is supplied (ms).
export const DEFAULT_COMMAND_TTL_MS = 5 * 60 * 1000;

// A candidate queue that replaces nearly everything is a warning signal (not a block) in the harness.
export const HIGH_CHANGE_RATIO_WARN = 0.9;
