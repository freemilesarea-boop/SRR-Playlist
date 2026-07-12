// AI-MUSIC-4 — Controlled experiment thresholds & weights (single source of truth).
//
// Rule-based ONLY — NO LLM / NO ML / NO statistical-significance library. Every number drives a
// *recommendation / draft / analysis*, never an automated pilot start, group assignment, playlist deploy,
// expansion, stop, or rollback. Below the sample floors the engines return INSUFFICIENT_DATA / NO_DATA /
// NOT_AVAILABLE. Store count, session count and playback count are kept strictly distinct.

// ── Eligibility sample gates ────────────────────────────────────────────────────
export const MIN_PLAYBACKS_FOR_ELIGIBLE = 200;   // below → INSUFFICIENT_DATA
export const MIN_SESSIONS_FOR_ELIGIBLE = 30;     // below → INSUFFICIENT_DATA
export const MIN_PROFILE_COVERAGE = 0.5;         // AI profile coverage below → REVIEW_REQUIRED
export const MIN_COMPAT_COVERAGE = 0.4;
export const MAX_OFFLINE_DAYS = 3;               // offline beyond → TEMPORARILY_EXCLUDED
export const STREAMING_QUALITY_MIN = 70;         // streaming score below → TEMPORARILY_EXCLUDED (when available)

// ── Pilot recommendation ────────────────────────────────────────────────────────
export const PILOT_TARGET_STORES_DEFAULT = 8;
export const PILOT_MIN_ELIGIBLE_STORES = 4;      // fewer eligible → INSUFFICIENT_DATA
export const PILOT_DIVERSITY_MIN_INDUSTRIES = 2;

// ── Group design balance ────────────────────────────────────────────────────────
export const GROUP_MIN_STORES_PER_ARM = 2;       // below → INSUFFICIENT_DATA
export const GROUP_SESSION_IMBALANCE_ACCEPTABLE = 0.25;  // |Δ|/max ≤ → ACCEPTABLE
export const GROUP_SESSION_IMBALANCE_BALANCED = 0.12;    // ≤ → BALANCED
export const GROUP_BASELINE_SKEW_MAX = 0.15;     // baseline skip/completion mean gap above → IMBALANCED

// ── Experiment plan defaults ────────────────────────────────────────────────────
export const PLAN_MIN_SESSIONS = 200;
export const PLAN_MIN_PLAYBACKS = 1000;
export const PLAN_MIN_DURATION_DAYS = 7;
export const PLAN_MAX_DURATION_DAYS = 28;

// ── Outcome / meaningful difference ─────────────────────────────────────────────
export const OUTCOME_MIN_SESSIONS_PER_ARM = 100;   // below per-arm → INSUFFICIENT_DATA
export const OUTCOME_MIN_PLAYBACKS_PER_ARM = 500;
export const MEANINGFUL_REL_DELTA = 0.05;          // |relative delta| below → NO_MEANINGFUL_DIFFERENCE
export const MEANINGFUL_ABS_DELTA = 0.02;          // and |absolute delta| below → NO_MEANINGFUL_DIFFERENCE

// ── Guardrail thresholds (constants — evaluated only when the metric is available) ──
export const GUARDRAIL = {
  streamingQualityDropWarn: 3,     // treatment streaming score lower by ≥ → WARNING
  streamingQualityDropFail: 8,     // ≥ → FAIL
  ttfaRegressWarnMs: 150,          // TTFA approx worse by ≥ → WARNING
  ttfaRegressFailMs: 400,          // ≥ → FAIL
  stallRateIncreaseWarn: 0.02,     // stall-session-rate up by ≥ → WARNING
  stallRateIncreaseFail: 0.05,     // ≥ → FAIL
  mediaErrorIncreaseWarn: 0.01,
  mediaErrorIncreaseFail: 0.03,
  recoveryFailIncreaseWarn: 0.01,
  recoveryFailIncreaseFail: 0.03,
  criticalIncidentFail: 1,         // any critical incident in treatment → FAIL
} as const;

// ── Rollout ─────────────────────────────────────────────────────────────────────
export const ROLLOUT_EXPAND_MIN_SESSIONS_PER_ARM = 300;
export const ROLLOUT_EXPAND_MEDIUM_SESSIONS_PER_ARM = 800;
export const ROLLOUT_READY_SESSIONS_PER_ARM = 1500;
export const ROLLOUT_EXPAND_MIN_INDUSTRIES = 2;

// ── Confidence blend (evidence breadth, capped — never certainty) ───────────────
export const CONFIDENCE_WEIGHTS = { sampleSize: 34, balance: 22, guardrail: 20, coverage: 14, contamination: 10 } as const;
export const CONFIDENCE_FULL_SESSIONS = 2000;    // sessions per arm at/above → full sample sub-score
export const CONFIDENCE_MAX = 90;                // rule-based experiment estimate — never certainty

// ── Metric catalog (definitions documented in metrics.ts) ───────────────────────
export const PRIMARY_METRICS = ['completion_rate', 'skip_rate', 'like_ratio', 'dislike_ratio', 'adaptive_playlist_score'] as const;
export const SECONDARY_METRICS = ['session_duration', 'repeat_fatigue', 'track_reputation', 'playlist_drift', 'diversity_score', 'compatibility_score'] as const;
export const GUARDRAIL_METRICS = ['playback_start_success', 'ttfa_approx', 'transition_gap', 'stall_session_rate', 'media_error_rate', 'recovery_failure_rate', 'streaming_quality_score', 'critical_incident_count'] as const;
