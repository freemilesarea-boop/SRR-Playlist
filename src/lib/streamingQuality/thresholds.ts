// WEB-OBS-7 — Streaming Quality thresholds & weights (single source of truth).
//
// Every operational threshold for playback-start / TTFA-approx / transition / crossfade / stall /
// preload / media-error / recovery / continuity classification, the Streaming Quality Score, and
// regression/incident detection lives HERE as a named constant with a documented rationale.
//
// Honesty rules baked in:
//   • The browser CANNOT prove real speaker output. TTFA is measured as request→first-currentTime-
//     progress (TTFA_APPROX / TIME_TO_FIRST_PROGRESS) and labelled as such — never asserted as audio out.
//   • Crossfade & preload are HARD-DISABLED in business/store mode (Player.tsx `if (businessMode) return`).
//     Their signals therefore come from individual users only; for stores they are NOT_AVAILABLE.
//   • Sample minimums are conservative operational guesses (ASSUMPTION) so a handful of events can
//     never mint a regression, an incident, or a confident score.

// ── Minimum-data gates ──────────────────────────────────────────────────────
export const MIN_EVENTS_FOR_SCORE = 40;
export const MIN_SESSIONS_FOR_SCORE = 5;
export const MIN_SAMPLES_FOR_METRIC = 20;      // both sides, before a regression is classified
export const MIN_SESSIONS_FOR_INCIDENT = 3;
export const MIN_STORES_FOR_FLEET = 3;

// ── Confidence bands (by the smaller compared sample count) ─────────────────
export const CONFIDENCE_HIGH_SAMPLES = 300;
export const CONFIDENCE_MEDIUM_SAMPLES = 60;

// ── TTFA_APPROX (request → first currentTime progress), milliseconds ────────
// Operational targets (ASSUMPTION). A store player on a wired connection should reach first progress
// quickly; these bands drive the score component, not an SLA.
export const TTFA_GOOD_MS = 1000;
export const TTFA_OK_MS = 2500;
export const TTFA_SLOW_MS = 6000;   // above → poor
/** A first-progress delta above this is treated as ABANDONED (never actually started), not "slow". */
export const TTFA_ABANDON_MS = 30_000;

// ── Playback start success ──────────────────────────────────────────────────
// A "request" is one intended track start; retries of the SAME track within this window collapse into
// one attempt so a retry storm is not counted as many user attempts.
export const START_RETRY_DEDUPE_MS = 15_000;
export const START_SUCCESS_RATE_BUDGET = 0.9; // ≥90% start success = fully good for scoring

// ── Track transition quality (gap between tracks), milliseconds ─────────────
// Gap = silent time between one track ending and the next producing progress. Thresholds are
// operational (ASSUMPTION) — a real inter-track silence beyond GAP_CRITICAL_MS is audible dead air.
export const TRANSITION_SEAMLESS_MS = 150;   // ≤ → SEAMLESS
export const TRANSITION_ACCEPTABLE_MS = 600; // ≤ → ACCEPTABLE
export const GAP_WARNING_MS = 2000;          // ≤ → GAP_WARNING; above → GAP_CRITICAL
export const OVERLAP_WARNING_MS = 400;       // negative gap (overlap) beyond this → OVERLAP_WARNING

// ── Crossfade outcome ───────────────────────────────────────────────────────
export const CROSSFADE_COMPLETION_BUDGET = 0.95; // ≥95% completed (vs fallback/aborted) = good

// ── Buffering / stall ───────────────────────────────────────────────────────
// A `waiting` shorter than this is normal jitter, not a stall. Stalls near track end are end-of-track,
// not buffering. Hidden-tab stalls are confidence-downgraded (background throttling).
export const STALL_MIN_MS = 1500;
export const STALL_TRACK_END_GUARD_SEC = 5;
export const STALL_SESSION_RATE_BUDGET = 0.1; // ≥10% of sessions stalling = fully bad

// ── Preload effectiveness ───────────────────────────────────────────────────
export const PRELOAD_READY_RATE_BUDGET = 0.9;
// preload "consumed" (did the preloaded element actually become the next active track?) is NOT
// reliably observable from the current signals → reported NOT_AVAILABLE (see docs).

// ── Media / decoder error ───────────────────────────────────────────────────
export const MEDIA_ERROR_SESSION_RATE_BUDGET = 0.05; // ≥5% of sessions hitting a media error = fully bad

// ── Recovery quality ────────────────────────────────────────────────────────
export const RECOVERY_SUCCESS_RATE_BUDGET = 0.8;
/** Post-recovery stable window: no fresh unhealthy signal for this long counts as truly recovered. */
export const RECOVERY_STABLE_WINDOW_MS = 30_000;

// ── Session continuity ──────────────────────────────────────────────────────
export const CONTINUITY_MIN_TRANSITIONS = 3;   // below → INSUFFICIENT_DATA
export const CONTINUITY_STABLE_MAX_INTERRUPTIONS = 0;
export const CONTINUITY_DEGRADED_MAX_INTERRUPTIONS = 2; // ≤2 → DEGRADED; more → INTERRUPTED

// ── Streaming Quality Score component weights (sum need not be 100; renormalized over PRESENT) ──
// A component with NO signal (NO_DATA) is dropped and the weights renormalize — a missing signal is
// never scored as 0. Signal coverage (present weight / total weight) is reported alongside the score.
export const QUALITY_WEIGHTS = {
  startSuccess: 22,
  ttfaApprox: 10,
  transitionGap: 10,
  crossfadeCompletion: 8,
  stallRate: 16,
  mediaErrorRate: 18,
  preloadReady: 6,
  recoverySuccess: 6,
  sessionContinuity: 4,
} as const;

// ── Streaming Quality Score status bands (0..100) ───────────────────────────
export const QUALITY_BAND_EXCELLENT = 90;
export const QUALITY_BAND_HEALTHY = 78;
export const QUALITY_BAND_WATCH = 62;
export const QUALITY_BAND_DEGRADED = 45;
// below DEGRADED → CRITICAL

// ── Per-metric regression thresholds (absolute + relative, both must clear) ─
// Rates are fractions; TTFA/gap are ms. A change only counts as REGRESSED/IMPROVED past BOTH floors.
export const REG_START_SUCCESS = { abs: 0.03, rel: 0.05, lowerIsBetter: false };
export const REG_TTFA_MS = { abs: 300, rel: 0.15, lowerIsBetter: true };
export const REG_GAP_MS = { abs: 250, rel: 0.2, lowerIsBetter: true };
export const REG_CROSSFADE_RATE = { abs: 0.03, rel: 0.05, lowerIsBetter: false };
export const REG_STALL_RATE = { abs: 0.03, rel: 0.2, lowerIsBetter: true };
export const REG_MEDIA_ERROR_RATE = { abs: 0.02, rel: 0.2, lowerIsBetter: true };
export const REG_PRELOAD_RATE = { abs: 0.05, rel: 0.1, lowerIsBetter: false };
export const REG_RECOVERY_RATE = { abs: 0.05, rel: 0.1, lowerIsBetter: false };
export const REG_SCORE = { abs: 4, rel: 0.05, lowerIsBetter: false };

// ── Release-level confidence gates ──────────────────────────────────────────
export const RELEASE_CONF_MIN_SESSIONS = 20;
export const RELEASE_CONF_HIGH_SESSIONS = 200;
export const RELEASE_CONF_MEDIUM_SESSIONS = 60;
export const RELEASE_CONF_MIN_EVENTS = 120;

// ── Incident spike thresholds (current vs baseline rate) ────────────────────
export const INCIDENT_SPIKE_REL = 1.5;    // current ≥ 1.5× baseline …
export const INCIDENT_SPIKE_ABS = 0.03;   // … AND ≥3pp absolute increase
export const INCIDENT_MIN_AFFECTED_SESSIONS = 3;
export const INCIDENT_RELEASE_MIN_SESSIONS = 20;
export const INCIDENT_BROWSER_CONCENTRATION = 0.6;   // ≥60% of a signal in one browser → browser-specific
export const INCIDENT_DEVICE_CONCENTRATION = 0.6;

// ── Advisor escalation gates ────────────────────────────────────────────────
export const ADVISOR_ESCALATE_AFFECTED_SESSIONS = 50;
export const ADVISOR_HOLD_RELEASE_SCORE_DROP = 8; // release score ≥8 below baseline → hold-release candidate
