// AI-MUSIC-2 — Playlist Builder thresholds & weights (single source of truth).
//
// Rule-based / statistical ONLY — NO LLM, NO generative AI. Every number drives a *generated proposal or
// simulation*, never an automated playlist deployment. Below the pool floor the builder returns
// INSUFFICIENT_DATA rather than fabricating a playlist. All inputs are READ-ONLY derived from existing
// telemetry + store learning + AI-MUSIC-1 profiles; nothing here changes the Player / Queue / real Playlist.

// ── Build gates ───────────────────────────────────────────────────────────────
export const DEFAULT_TARGET_LENGTH = 20;         // default generated playlist length
export const MAX_TARGET_LENGTH = 60;
export const MIN_POOL_FOR_BUILD = 8;             // candidate pool below this → INSUFFICIENT_DATA
export const MIN_PICKS_FOR_READY = 5;            // fewer usable picks than this → INSUFFICIENT_DATA

// ── Energy curve (Low → Medium → High → Medium → Low) ───────────────────────────
export const ENERGY_STAGE_LEVELS: Record<'LOW' | 'MEDIUM' | 'HIGH', number> = { LOW: 0.25, MEDIUM: 0.55, HIGH: 0.85 };
export const ENERGY_CURVE_SHAPE: Array<'LOW' | 'MEDIUM' | 'HIGH'> = ['LOW', 'MEDIUM', 'HIGH', 'MEDIUM', 'LOW'];

// ── Fatigue prevention (recent 7-day repeat penalty) ────────────────────────────
export const FATIGUE_RECENT_DAYS = 7;            // window used to detect over-played tracks
export const FATIGUE_PLAYS_SOFT = 3;             // ≥ this many recent plays → soft penalty begins
export const FATIGUE_PLAYS_HARD = 8;             // ≥ this many recent plays → strong penalty
export const FATIGUE_MIN_FACTOR = 0.25;          // pick-score multiplier floor for the most-fatigued track

// ── Pick-score weights (0..1 components, weighted → 0..100) ──────────────────────
export const BUILD_WEIGHTS = {
  compatibility: 40,   // AI-MUSIC-1 store↔track compatibility
  industryFit: 18,     // genre/mood match to the industry rule
  timeFit: 14,         // energy match to the day-part slot
  learning: 16,        // store-learning affinity
  freshness: 12,       // inverse of recent-play fatigue
} as const;

// ── Diversity optimizer ─────────────────────────────────────────────────────────
export const DIVERSITY_MAX_GENRE_STREAK = 2;     // avoid > N consecutive same-genre tracks
export const DIVERSITY_MAX_MOOD_STREAK = 2;
export const BPM_BUCKET_EDGES = [90, 110, 130];  // slow / medium / upbeat / fast bucket edges

// ── Candidate comparison composite weights ──────────────────────────────────────
export const CANDIDATE_WEIGHTS = { compatibility: 34, diversity: 20, fatigue: 18, curveFit: 16, confidence: 12 } as const;
export const CANDIDATE_STRATEGIES: Array<{ label: string; strategy: 'BALANCED' | 'COMPATIBILITY_FIRST' | 'DISCOVERY_FORWARD' }> = [
  { label: 'A', strategy: 'BALANCED' },
  { label: 'B', strategy: 'COMPATIBILITY_FIRST' },
  { label: 'C', strategy: 'DISCOVERY_FORWARD' },
];

// ── Build confidence (HIGH / MEDIUM / LOW / INSUFFICIENT_DATA) ───────────────────
export const BUILD_CONFIDENCE_WEIGHTS = { poolSize: 26, storeReady: 22, compatCoverage: 24, learningCoverage: 16, curveFit: 12 } as const;
export const BUILD_CONFIDENCE_FULL_POOL = 60;    // pool at/above → full pool sub-score
export const BUILD_CONFIDENCE_MAX = 92;          // capped — a rule-based proposal is never certainty
export const BUILD_CONFIDENCE_HIGH = 76;
export const BUILD_CONFIDENCE_MEDIUM = 54;
