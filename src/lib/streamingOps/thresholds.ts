// WEB-OBS-8 — Intelligent Operations thresholds & weights (single source of truth).
//
// Rule-based / statistical ONLY — no ML, no LLM. Every operational number for the predictive warning
// rule engine, release-risk scoring, progressive-incident detection, the Streaming Reliability Index,
// quality-trend direction, and signal-coverage gates lives HERE as a named constant with a rationale.
//
// Honesty rules (inherited from WEB-OBS-7):
//   • A handful of events can never mint a prediction, a risk, or a confident trend. Below the sample
//     floors the engines return INSUFFICIENT_DATA / NOT_AVAILABLE, never a fabricated verdict.
//   • A prediction is a *rule-derived likelihood band*, not a probability estimate from a model.
//   • currentTime progress ≠ speaker output (TTFA is TTFA_APPROX); event count ≠ affected sessions/stores.

// ── Streaming Reliability Index — sub-component weights (renormalized over PRESENT) ──
// Reframes the WEB-OBS-7 quality signals as an operator-facing 0..100 reliability index. A sub-component
// with NO signal (NO_DATA / NOT_AVAILABLE, e.g. crossfade/continuity in business mode) is DROPPED and
// the remaining weights renormalize — a missing signal is never scored as 0.
export const RELIABILITY_WEIGHTS = {
  availability: 26,   // did sessions actually get audio (start success, not catastrophic failure)
  start: 16,          // playback-start success rate
  transition: 8,      // crossfade completion / transition gap (NOT_AVAILABLE for stores)
  recovery: 12,       // recovery success rate
  media: 20,          // freedom from media/decoder errors
  continuity: 6,      // session continuity (INSUFFICIENT this phase)
  buffering: 12,      // freedom from stalls/buffering
} as const;

export const RELIABILITY_BAND_EXCELLENT = 90;
export const RELIABILITY_BAND_HEALTHY = 78;
export const RELIABILITY_BAND_WATCH = 62;
export const RELIABILITY_BAND_DEGRADED = 45;
// below DEGRADED → CRITICAL

// ── Predictive warning rule engine ──────────────────────────────────────────
// Looks at recent time buckets (default last 30 min in 5-min buckets). A warning fires ONLY when
// multiple independent signals are trending worse AND recent absolute levels are already elevated —
// a single noisy bucket must never predict an incident.
export const PREDICT_MIN_BUCKETS = 4;            // need ≥4 usable buckets to read a trend
export const PREDICT_MIN_SESSIONS_PER_BUCKET = 3; // a bucket with fewer sessions is not "usable"
export const PREDICT_LOOKBACK_MS = 30 * 60 * 1000;
export const PREDICT_BUCKET_MS = 5 * 60 * 1000;
// A signal counts as "rising" when its last-third mean exceeds its first-third mean by BOTH floors.
export const PREDICT_TTFA_RISE_MS = 400;         // TTFA_APPROX p75 rise
export const PREDICT_TTFA_RISE_REL = 0.2;
export const PREDICT_RECOVERY_RISE_ABS = 0.05;   // recovery-failure rate rise
export const PREDICT_RECOVERY_RISE_REL = 0.3;
export const PREDICT_MEDIA_RISE_ABS = 0.02;      // media-error rate rise
export const PREDICT_MEDIA_RISE_REL = 0.3;
export const PREDICT_STALL_RISE_ABS = 0.03;      // stall rate rise
export const PREDICT_STALL_RISE_REL = 0.3;
// Likelihood bands by number of concurrently-rising signals (of the 4 above).
export const PREDICT_ELEVATED_SIGNALS = 2;       // ≥2 rising → ELEVATED
export const PREDICT_HIGH_SIGNALS = 3;           // ≥3 rising → HIGH

// ── Release risk ────────────────────────────────────────────────────────────
// A new release on a small store sample cannot assert fleet risk. Risk is a graded label, never a block.
export const RELEASE_RISK_MIN_SESSIONS = 20;
export const RELEASE_RISK_MIN_STORES = 3;
export const RELEASE_RISK_CANARY_STORE_FRACTION = 0.05; // "새 Release Store 5%" canary framing
export const RELEASE_RISK_SCORE_DROP_WATCH = 4;   // score below baseline by ≥4 → WATCH
export const RELEASE_RISK_SCORE_DROP_HIGH = 8;    // ≥8 → HIGH
export const RELEASE_RISK_SCORE_DROP_CRITICAL = 14; // ≥14 → CRITICAL

// ── Progressive incident (same-type spike → recovery → spike repetition) ────
export const PROGRESSIVE_MIN_SPIKES = 2;          // ≥2 spikes of the same type …
export const PROGRESSIVE_MAJOR_SPIKES = 3;        // … ≥3 → MAJOR (chronic)
export const PROGRESSIVE_WINDOW_MS = 6 * 60 * 60 * 1000; // within a 6h window

// ── Quality trend direction ─────────────────────────────────────────────────
export const TREND_MIN_BUCKETS = 3;
export const TREND_SCORE_DELTA = 4;               // first→last score change past this = direction change
export const TREND_MIN_SESSIONS_PER_BUCKET = 3;

// ── Signal coverage gates ───────────────────────────────────────────────────
// Coverage = share of sessions/events for which a given signal was actually observed. Low coverage
// down-weights confidence in that signal's verdict (reported, never hidden).
export const COVERAGE_GOOD = 0.9;
export const COVERAGE_FAIR = 0.6;
// below FAIR → LOW coverage (verdict shown but flagged low-confidence)

// ── Root-cause evidence confidence ──────────────────────────────────────────
// Confidence is RULE-derived from how complete the observed evidence chain is (not a model score).
// Capped below 100 — the browser can never fully prove causation.
export const ROOTCAUSE_MAX_CONFIDENCE = 92;
export const ROOTCAUSE_MIN_LINKS = 2;             // fewer than 2 corroborating links → LOW confidence
export const ROOTCAUSE_LINK_CONFIDENCE = 18;      // each corroborating evidence link adds this much

// ── Replay / fleet-replay bucketing ─────────────────────────────────────────
export const REPLAY_MAX_STEPS = 300;              // cap a single replay to a bounded step count
export const FLEET_REPLAY_BUCKET_MS = 5 * 60 * 1000;
export const FLEET_REPLAY_MAX_BUCKETS = 288;      // 24h at 5-min buckets

// ── Matrix (browser/device) concentration ──────────────────────────────────
// A dimension "concentrates" a problem when one cell holds ≥ this share of a signal's total.
export const MATRIX_CONCENTRATION = 0.6;
export const MATRIX_MIN_CELL_SESSIONS = 5;        // below → cell shown but marked INSUFFICIENT_DATA
