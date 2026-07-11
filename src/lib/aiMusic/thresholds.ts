// AI-MUSIC-1 — Intelligent Music OS Foundation thresholds & weights (single source of truth).
//
// Rule-based / statistical ONLY — NO LLM, NO generative AI. Every number here drives a *recommendation
// or simulation*, never an automated playlist deployment or policy execution. Below the sample floors the
// engines return INSUFFICIENT_DATA / NO_DATA rather than fabricating a musical verdict. All inputs are
// derived READ-ONLY from existing telemetry + store learning; nothing here changes Player/music data.

// ── Sample / confidence gates ────────────────────────────────────────────────
export const MIN_PLAYS_FOR_STORE_PROFILE = 30;   // below → store profile INSUFFICIENT_DATA
export const MIN_PLAYS_FOR_TRACK_PROFILE = 15;   // below → track performance INSUFFICIENT_DATA
export const MIN_PLAYS_FOR_COMPAT_HISTORY = 8;   // below → historical-performance component NO_DATA
export const CONFIDENCE_FULL_SAMPLE = 300;       // plays at/above → full sample-size sub-score

// ── Store preference classification (fractions of plays) ────────────────────
export const PREF_STRONG = 0.35;                 // ≥35% share of a genre/mood → STRONG preference
export const PREF_MODERATE = 0.18;               // ≥18% → MODERATE; below → WEAK/NEUTRAL
export const SKIP_HIGH = 0.35;                   // ≥35% skip rate = high
export const COMPLETION_GOOD = 0.6;              // ≥60% completion = good
export const LIKE_RATIO_GOOD = 0.05;             // like/plays ≥5% = good engagement

// ── Track performance classification ─────────────────────────────────────────
export const TRACK_SKIP_POOR = 0.4;              // ≥40% skip → poor
export const TRACK_COMPLETION_STRONG = 0.65;     // ≥65% completion → strong
export const TRACK_REPLAY_STRONG = 0.03;         // replay/plays ≥3% → strong replay

// ── Compatibility score component weights (0..1 each, weighted) ─────────────
export const COMPAT_WEIGHTS = {
  genreMatch: 24,
  moodMatch: 20,
  energyMatch: 14,
  instrumentalMatch: 8,
  vocalMatch: 6,
  historicalPerformance: 16,
  industryMatch: 8,
  timeMatch: 4,
} as const;

// Compatibility bands (0..100 over PRESENT components).
export const COMPAT_EXCELLENT = 82;
export const COMPAT_GOOD = 66;
export const COMPAT_ACCEPTABLE = 50;
export const COMPAT_WEAK = 34;
// below WEAK → UNSUITABLE

// ── Playlist intelligence ────────────────────────────────────────────────────
export const PLAYLIST_MIN_TRACKS = 5;            // below → INSUFFICIENT_DATA
export const DIVERSITY_LOW = 0.4;                // distinct-genre/artist ratio below → low diversity
export const FATIGUE_REPEAT_WINDOW = 8;          // same artist/genre within N tracks → fatigue contribution
export const FATIGUE_HIGH = 0.35;                // fatigue index ≥ → HIGH fatigue risk
export const ARTIST_DOMINANCE = 0.25;            // one artist ≥25% of playlist → imbalance
export const INSTRUMENTAL_TARGET_DEFAULT = 0.5;  // default target instrumental ratio (business ambience)

// ── Discovery pool stages (no auto-deploy) ───────────────────────────────────
export const DISCOVERY_PILOT_STORES = 5;         // candidate → pilot on ≤ this many stores
export const DISCOVERY_MIN_PILOT_PLAYS = 20;     // below → evaluation INSUFFICIENT_DATA
export const DISCOVERY_EXPAND_COMPLETION = 0.6;  // pilot completion ≥ → recommend expansion
export const DISCOVERY_EXPAND_SKIP_MAX = 0.35;   // pilot skip ≤ → recommend expansion

// ── Learning engine signal weights ──────────────────────────────────────────
export const LEARNING_WEIGHTS = { skip: -1.0, complete: 1.0, like: 1.5, dislike: -1.5, replay: 1.2 } as const;
export const LEARNING_MIN_SIGNALS = 10;          // below → learning profile INSUFFICIENT_DATA

// ── AI Confidence bands ──────────────────────────────────────────────────────
export const CONFIDENCE_WEIGHTS = { sampleSize: 30, storeHistory: 22, trackHistory: 20, learningCoverage: 16, signalCoverage: 12 } as const;
export const AI_CONFIDENCE_MAX = 94;             // capped — rule-based estimate, never certainty
export const AI_CONFIDENCE_HIGH = 78;
export const AI_CONFIDENCE_MEDIUM = 55;

// ── Recommendation engine ────────────────────────────────────────────────────
export const REC_MAX_RESULTS = 50;
export const REC_EXCLUDE_COMPAT_MAX = COMPAT_WEAK;  // compatibility below WEAK band → exclude candidate

// ── Simulation guards ────────────────────────────────────────────────────────
export const SIM_MIN_TRACKS = 5;                 // below → simulation INSUFFICIENT_DATA
