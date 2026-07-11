// WEB-OPS-10 — Unified Operations Platform thresholds & weights (single source of truth).
//
// This phase adds NO new Player/Streaming feature — it converges the WEB-OBS engines. Every number here
// drives a *read-only* platform summary (Platform Score, SLA, Executive Summary). Rule-based, NO ML/LLM.
// Below the sample floors the engines return INSUFFICIENT_DATA rather than fabricating a platform verdict.

// ── Platform Score — component weights (renormalized over PRESENT components) ──
// Composes availability + streaming quality + reliability + governance + incidents + coverage + confidence
// into a 0..100 platform score. A component with NO signal is dropped and weights renormalize.
export const PLATFORM_WEIGHTS = {
  availability: 22,
  streaming: 20,
  reliability: 18,
  governance: 10,
  incidents: 14,
  coverage: 8,
  confidence: 8,
} as const;

export const PLATFORM_BAND_EXCELLENT = 90;
export const PLATFORM_BAND_HEALTHY = 78;
export const PLATFORM_BAND_WATCH = 62;
export const PLATFORM_BAND_DEGRADED = 45;
// below DEGRADED → CRITICAL

export const PLATFORM_MIN_SESSIONS = 20;      // below → INSUFFICIENT_DATA
// Governance sub-score: each open decision beyond this many drags the governance health down.
export const GOVERNANCE_OPEN_TOLERANCE = 3;
export const GOVERNANCE_OPEN_PENALTY = 12;    // per open decision over tolerance
// Incidents sub-score: penalty per critical / high incident.
export const INCIDENT_CRITICAL_PENALTY = 30;
export const INCIDENT_HIGH_PENALTY = 12;

// ── SLA metrics ──────────────────────────────────────────────────────────────
// Error budget = allowed fraction of "bad" sessions before the budget is exhausted.
export const SLA_ERROR_BUDGET = 0.02;         // 2% bad-session budget (ASSUMPTION)
export const SLA_RECOVERY_GOOD = 0.8;         // recovery success ≥80% = good
export const SLA_MIN_SESSIONS = 20;           // below → SLA INSUFFICIENT_DATA
export const SLA_MIN_INCIDENTS_FOR_MTTR = 2;  // below → MTTR/MTBF INSUFFICIENT_DATA (can't average)

// ── Executive Summary rule thresholds ───────────────────────────────────────
export const EXEC_STABLE_SCORE = 78;          // platform score ≥ → "Platform Stable"
export const EXEC_RECOVERY_EXCELLENT = 0.9;   // recovery ≥90% → "Recovery Excellent"

// ── Reliability dashboard (reuses WEB-OBS-8 reliability index bands) ─────────
export const RELIABILITY_TREND_MIN_BUCKETS = 3;

// ── Workspace / widgets ──────────────────────────────────────────────────────
export const WORKSPACE_MAX_WIDGETS = 24;
export const WORKSPACE_MAX_SAVED = 12;        // max saved layouts per operator

// ── Unified search ───────────────────────────────────────────────────────────
export const SEARCH_MIN_QUERY = 2;            // below → no search
export const SEARCH_MAX_RESULTS = 50;
