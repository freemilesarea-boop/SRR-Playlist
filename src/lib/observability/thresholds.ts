// WEB-OBS-2 — Observability thresholds & weights (single source of truth).
//
// Every operational threshold used by health scoring, release comparison, spike/incident detection,
// and risk ranking lives HERE as a named constant with a documented rationale. Nothing downstream
// hard-codes a magic number — this keeps the "why" auditable and the tuning centralized.
//
// Provenance:
//   • Web Vital budgets (LCP/INP/CLS/TTFB/FCP) reuse the published web.dev "good/needs-improvement"
//     boundaries already encoded in src/lib/telemetry/aggregate.ts (VITAL_THRESHOLDS). We do NOT
//     invent new vital cutoffs; the regression DELTAS below are operational choices, flagged as such.
//   • Sample/session minimums are conservative operational guesses (ASSUMPTION) chosen so a handful
//     of events can never mint a "regression" or an "incident". They are documented as assumptions.
//   • Rate budgets (error/chunk/etc.) are operational targets, NOT SLAs. See docs.

// ── Minimum-data gates ──────────────────────────────────────────────────────
// Below these, we refuse to compute a score/verdict and surface INSUFFICIENT_DATA / NO DATA instead
// of a confident-looking-but-meaningless number. (ASSUMPTION — tune from real distribution.)
export const MIN_EVENTS_FOR_SCORE = 50;
export const MIN_SESSIONS_FOR_SCORE = 5;
/** A single metric needs at least this many samples on BOTH sides before we classify a change. */
export const MIN_SAMPLES_FOR_METRIC = 30;
/** Spike/incident detection needs at least this many affected sessions (not just events). */
export const MIN_SESSIONS_FOR_INCIDENT = 3;

// ── Confidence bands (by the smaller of the two compared sample counts) ─────
export const CONFIDENCE_HIGH_SAMPLES = 500;
export const CONFIDENCE_MEDIUM_SAMPLES = 100;
// LOW spans [MIN_SAMPLES_FOR_METRIC, CONFIDENCE_MEDIUM_SAMPLES); below MIN → INSUFFICIENT.

// ── Rate budgets (operational targets — NOT SLAs) ───────────────────────────
// A rate at/over its budget scores 0 on that component; 0 scores 1; linear in between.
export const ERROR_RATE_BUDGET = 0.05; // 5% of events being errors is "fully bad" for scoring
export const CRITICAL_ERROR_RATE_BUDGET = 0.01; // critical-severity errors are weighted harder
export const CHUNK_FAILURE_RATE_BUDGET = 0.02; // chunk-load failures as a fraction of sessions
export const HYDRATION_ERROR_RATE_BUDGET = 0.02;
export const SLOW_API_RATE_BUDGET = 0.2; // fraction of api events over the slow bar
export const SLOW_ROUTE_RATE_BUDGET = 0.2;
export const LONG_TASK_RATE_BUDGET = 1.0; // long tasks per session; >=1/session = fully bad
export const MEMORY_RISK_RATE_BUDGET = 0.1; // fraction of sessions showing heap pressure
export const BOOT_RECOVERY_FAILURE_BUDGET = 0.2; // fraction of recovery attempts that failed

/** "Slow" bars (ms) reused from the session dashboard's classifyApiDuration buckets. */
export const SLOW_API_MS = 1000;
export const SLOW_ROUTE_MS = 3000;
/** Heap-pressure bar: used/limit at or above this marks a memory-risk session. */
export const MEMORY_RISK_RATIO = 0.9;

// ── Health score component weights (sum = 100) ──────────────────────────────
// A component with no data contributes NO penalty (score 1) — absence of signal ≠ evidence of a
// problem. The overall INSUFFICIENT_DATA gate (MIN_EVENTS/SESSIONS) guards the low-traffic case.
export const HEALTH_WEIGHTS = {
  errorRate: 22,
  criticalErrorRate: 18,
  chunkFailureRate: 12,
  hydrationErrorRate: 8,
  slowApiRate: 10,
  slowRouteRate: 6,
  longTaskRate: 5,
  lcp: 8,
  inp: 5,
  cls: 3,
  bootRecoveryFailureRate: 3,
} as const;

// ── Health status bands (on the 0..100 score) ──────────────────────────────
export const HEALTH_BAND_HEALTHY = 90;
export const HEALTH_BAND_WATCH = 75;
export const HEALTH_BAND_DEGRADED = 50;
// below DEGRADED → CRITICAL

// Hard floors: regardless of the weighted score, these conditions cap the status. A live chunk-load
// or critical-error storm must never render as HEALTHY just because volume dilutes the rate.
export const CRITICAL_ERROR_RATE_FLOOR = 0.02; // ≥2% critical → at most DEGRADED
export const CHUNK_FAILURE_RATE_CRITICAL = 0.05; // ≥5% chunk failures → CRITICAL

// ── Web Vital budgets (good-max, ni-max) — mirrors aggregate.ts VITAL_THRESHOLDS ──
export const VITAL_GOOD_MAX = { LCP: 2500, INP: 200, CLS: 0.1, TTFB: 800, FCP: 1800 } as const;
export const VITAL_NI_MAX = { LCP: 4000, INP: 500, CLS: 0.25, TTFB: 1800, FCP: 3000 } as const;

// ── Per-metric release-regression thresholds ────────────────────────────────
// A change counts as REGRESSED/IMPROVED only when it clears BOTH an absolute floor (noise guard)
// AND a relative floor (scale guard), in the worsening/improving direction. Deltas are operational
// (ASSUMPTION), chosen near the vital "good/ni" band widths so a meaningful shift is required.
export interface MetricSpec {
  key: string;
  label: string;
  /** true when a LOWER value is better (latency, error rate); false when HIGHER is better (success rate). */
  lowerIsBetter: boolean;
  /** Absolute change (same unit as the value) that must be exceeded to leave STABLE. */
  absThreshold: number;
  /** Relative change (fraction, e.g. 0.2 = 20%) that must be exceeded to leave STABLE. */
  relThreshold: number;
  /** Optional unit hint for UI formatting. */
  unit?: 'ms' | 'ratio' | 'count' | 'score';
}

export const METRIC_SPECS: Record<string, MetricSpec> = {
  errorRate: { key: 'errorRate', label: 'Error Rate', lowerIsBetter: true, absThreshold: 0.005, relThreshold: 0.2, unit: 'ratio' },
  criticalErrorRate: { key: 'criticalErrorRate', label: 'Critical Error Rate', lowerIsBetter: true, absThreshold: 0.003, relThreshold: 0.2, unit: 'ratio' },
  chunkFailureRate: { key: 'chunkFailureRate', label: 'Chunk Failure Rate', lowerIsBetter: true, absThreshold: 0.005, relThreshold: 0.2, unit: 'ratio' },
  hydrationErrorRate: { key: 'hydrationErrorRate', label: 'Hydration Error Rate', lowerIsBetter: true, absThreshold: 0.005, relThreshold: 0.2, unit: 'ratio' },
  lcpP75: { key: 'lcpP75', label: 'LCP p75', lowerIsBetter: true, absThreshold: 300, relThreshold: 0.15, unit: 'ms' },
  inpP75: { key: 'inpP75', label: 'INP p75', lowerIsBetter: true, absThreshold: 50, relThreshold: 0.15, unit: 'ms' },
  clsP75: { key: 'clsP75', label: 'CLS p75', lowerIsBetter: true, absThreshold: 0.02, relThreshold: 0.15, unit: 'ratio' },
  ttfbP75: { key: 'ttfbP75', label: 'TTFB p75', lowerIsBetter: true, absThreshold: 150, relThreshold: 0.15, unit: 'ms' },
  slowApiRate: { key: 'slowApiRate', label: 'Slow API Rate', lowerIsBetter: true, absThreshold: 0.03, relThreshold: 0.2, unit: 'ratio' },
  slowRouteRate: { key: 'slowRouteRate', label: 'Slow Route Rate', lowerIsBetter: true, absThreshold: 0.03, relThreshold: 0.2, unit: 'ratio' },
  longTaskRate: { key: 'longTaskRate', label: 'Long Task Rate', lowerIsBetter: true, absThreshold: 0.1, relThreshold: 0.2, unit: 'count' },
  memoryRiskRate: { key: 'memoryRiskRate', label: 'Memory Risk Rate', lowerIsBetter: true, absThreshold: 0.02, relThreshold: 0.2, unit: 'ratio' },
  bootRecoverySuccessRate: { key: 'bootRecoverySuccessRate', label: 'Boot Recovery Success Rate', lowerIsBetter: false, absThreshold: 0.05, relThreshold: 0.1, unit: 'ratio' },
};

// ── Risk-ranking priority bands (0..100 risk score) ─────────────────────────
export const RISK_BAND_P0 = 80;
export const RISK_BAND_P1 = 60;
export const RISK_BAND_P2 = 35;
// below P2 → P3

// ════════════════════════════════════════════════════════════════════════════
// WEB-OBS-3 — Predictive Regression Engine (Release Quality · Budget · Gate)
// ════════════════════════════════════════════════════════════════════════════
// These drive the pre-promotion verdict ("is THIS release risky?"). Everything is rule-based and
// explainable — no ML. A release with too little data is INSUFFICIENT_DATA, never a fabricated PASS.

// ── Release Quality Score component weights (sum = 100) ─────────────────────
// Each component maps its current-release rate/value to a 0..1 goodness against its budget; a
// no-data component contributes no penalty (weights renormalize over present components). Mirrors
// the Health Score shape but scoped to ONE release and tuned for deploy-gating (errors weigh more).
export const RELEASE_QUALITY_WEIGHTS = {
  errorRate: 16,
  criticalErrorRate: 16,
  chunkFailureRate: 12,
  hydrationErrorRate: 8,
  slowRouteRate: 5,
  slowApiRate: 8,
  longTaskRate: 4,
  lcpP75: 9,
  inpP75: 6,
  clsP75: 4,
  ttfbP75: 3,
  memoryRiskRate: 3,
  bootRecoveryFailureRate: 2,
  incidents: 4,
} as const;

// Release Quality status bands (0..100).
export const QUALITY_BAND_EXCELLENT = 90;
export const QUALITY_BAND_GOOD = 75;
export const QUALITY_BAND_RISKY = 55;
// below RISKY → POOR

// ── Performance Budget (absolute ceilings — FAIL when exceeded) ─────────────
// Latency/vital budgets reuse the web.dev "needs-improvement" upper edge (a p75 past it is a real
// regression, not noise). Rate budgets are operational (ASSUMPTION, aligned with Health budgets).
// Bundle budgets are BUILD-TIME artifact sizes (measured at build, not from telemetry) — flagged.
export const PERF_BUDGET = {
  // telemetry-derived (p75 / rates)
  lcpP75Ms: 4000,
  inpP75Ms: 500,
  clsP75: 0.25,
  ttfbP75Ms: 1800,
  errorRate: 0.05,
  criticalErrorRate: 0.01,
  chunkFailureRate: 0.02,
  hydrationErrorRate: 0.02,
  slowApiRate: 0.2,
  slowRouteRate: 0.2,
  longTaskRate: 1.0,
  memoryRiskRate: 0.1,
  apiP95Ms: 1500,
  // build-artifact (bytes, gzip) — measured at build time, see docs. Not enforced from telemetry.
  initialJsGzipBytes: 140 * 1024,
  lazyChunkGzipBytes: 120 * 1024,
} as const;

// ── Deployment Readiness bands (on the Release Quality score, before gate overrides) ──
export const READINESS_READY_MIN = 85;
export const READINESS_WATCH_MIN = 65;
// below WATCH → BLOCKED (subject to confidence gating → INSUFFICIENT_DATA)

// ── Release Gate hard-block rules ───────────────────────────────────────────
// Any of these, on their own, force a BLOCK regardless of the composite score — the "do not promote"
// conditions. Values chosen to match the Health hard-floors so the two engines never disagree.
export const GATE_BLOCK_CRITICAL_ERROR_RATE = 0.02;
export const GATE_BLOCK_CHUNK_FAILURE_RATE = 0.05;
export const GATE_BLOCK_ERROR_RATE = 0.1;
/** A regression this severe on any budgeted metric hard-blocks (in addition to the STABLE thresholds). */
export const GATE_BLOCK_REGRESSED_METRICS = 3; // ≥3 metrics REGRESSED with ≥MEDIUM confidence → BLOCK

// ── Release-level confidence gates (distinct from per-metric compare confidence) ──
// A release verdict needs enough sessions AND events AND browser diversity to be trustworthy.
export const RELEASE_CONF_MIN_SESSIONS = 20;   // below → INSUFFICIENT
export const RELEASE_CONF_HIGH_SESSIONS = 300;
export const RELEASE_CONF_MEDIUM_SESSIONS = 80;
export const RELEASE_CONF_MIN_EVENTS = 200;
export const RELEASE_CONF_MIN_BROWSERS = 2;    // single-browser sample can't be HIGH confidence
