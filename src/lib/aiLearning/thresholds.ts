// AI-MUSIC-3 — Adaptive learning thresholds & weights (single source of truth).
//
// Rule-based / statistical ONLY — NO LLM, NO reinforcement-learning model. Every number drives a
// *recommendation*, never an automated change to the Player / Playback / Queue / Playlist / ranking /
// settlement. Below the sample floors the engines return INSUFFICIENT_DATA / NO_DATA. All inputs are
// READ-ONLY derived from existing telemetry + reactions + AI-MUSIC-1/2 outputs.

// ── Sample gates ────────────────────────────────────────────────────────────────
export const MIN_PLAYS_FOR_REINFORCEMENT = 20;   // below → reinforcement INSUFFICIENT_DATA
export const MIN_PLAYS_FOR_REPUTATION = 15;      // below → reputation NO_DATA
export const MIN_VERSIONS_FOR_EVOLUTION = 2;     // fewer versions → INSUFFICIENT_DATA
export const MIN_SIGNALS_FOR_ADAPTIVE = 20;      // below → adaptive score INSUFFICIENT_DATA

// ── Reinforcement reward / penalty weights (per-play contribution) ──────────────
export const REWARD_WEIGHTS = { complete: 1.0, like: 1.6, longSession: 1.2 } as const;
export const PENALTY_WEIGHTS = { skip: 1.0, dislike: 1.6, repeatFatigue: 1.3 } as const;

// ── Adaptive score smoothing ────────────────────────────────────────────────────
export const ADAPTIVE_STEP_SCALE = 12;           // net(-1..1) × scale → score delta points
export const ADAPTIVE_EMA_ALPHA = 0.4;           // smoothing of the applied delta
export const ADAPTIVE_TREND_EPS = 1.0;           // |delta| below → FLAT
export const DEFAULT_PRIOR_SCORE = 70;           // starting score when no prior exists

// ── Track reputation bands (0..100 reputation score) ────────────────────────────
export const REPUTATION_EXCELLENT = 72;
export const REPUTATION_GOOD = 58;
// below GOOD → WEAK (or RECOVERING when trending up strongly)
export const REPUTATION_RECOVERING_DELTA = 8;    // prior WEAK + gain ≥ this → RECOVERING
export const REPUTATION_WEIGHTS = { completion: 0.4, lowSkip: 0.3, like: 0.2, replay: 0.1 } as const;

// ── Exploration vs Exploitation ─────────────────────────────────────────────────
export const EXPLOIT_RATIO_DEFAULT = 0.8;        // 80% best track / 20% discovery
export const EXPLORE_RATIO_MIN = 0.1;
export const EXPLORE_RATIO_MAX = 0.4;

// ── Discovery expansion stage gates (advance when completion high + skip low) ────
export const EXPANSION_ORDER: Array<'PILOT' | 'SMALL_GROUP' | 'MEDIUM' | 'LARGE' | 'GLOBAL_RECOMMENDATION'> =
  ['PILOT', 'SMALL_GROUP', 'MEDIUM', 'LARGE', 'GLOBAL_RECOMMENDATION'];
export const EXPANSION_MIN_PLAYS = 20;           // below → INSUFFICIENT_DATA (no advance)
export const EXPANSION_ADVANCE_COMPLETION = 0.6; // completion ≥ → eligible to advance
export const EXPANSION_ADVANCE_SKIP_MAX = 0.3;   // skip ≤ → eligible to advance

// ── Playlist drift bands (0..1) ──────────────────────────────────────────────────
export const DRIFT_LOW = 0.2;                    // ≤ → LOW
export const DRIFT_MEDIUM = 0.45;                // ≤ → MEDIUM; above → HIGH

// ── Segment (seasonal / time / industry) learning ──────────────────────────────
export const SEGMENT_MIN_PLAYS = 15;             // per-segment plays below → NO_DATA strength
export const SEGMENT_STRONG_PLAYS = 80;          // ≥ → STRONG; ≥ half → MODERATE

// ── Learning confidence reuse ────────────────────────────────────────────────────
export const LEARNING_CONFIDENCE_FULL = 300;     // plays at/above → full learning coverage
