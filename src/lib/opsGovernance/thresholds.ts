// WEB-OBS-9 — Operations Governance thresholds & weights (single source of truth).
//
// Decision SUPPORT only — every number here drives a *recommendation / readiness label*, never an
// automated action. Rule-based / statistical, NO ML/LLM. A thin sample can never mint a READY verdict,
// a confident recommendation, or a high confidence score — below the floors we return INSUFFICIENT_DATA.
//
// Nothing in this module executes, merges, rolls back, blocks a release, or controls the Player. The
// operator approves/rejects; the system only records the decision (audit).

// ── Release Readiness Score — component weights (renormalized over PRESENT components) ──
// Composed from WEB-OBS-7 quality + WEB-OBS-8 reliability/regression/coverage/incidents. A component
// with NO signal is dropped and weights renormalize — a missing input is never scored as 0.
export const READINESS_WEIGHTS = {
  streamingQuality: 26,   // WEB-OBS-7 quality score (0..100)
  reliability: 22,        // WEB-OBS-8 reliability index (0..100)
  regression: 18,         // penalized by regressed-metric count vs baseline
  coverage: 12,           // signal coverage (0..1 → 0..100)
  incidentStatus: 14,     // penalized by critical/high incident count
  sampleSufficiency: 8,   // sessions + store diversity sufficiency
} as const;

// ── Readiness status bands (0..100) + gates ─────────────────────────────────
export const READINESS_READY = 85;            // ≥85 AND no critical incident AND sufficient sample → READY
export const READINESS_REVIEW = 70;           // ≥70 → REVIEW_REQUIRED
export const READINESS_HIGH_RISK = 50;        // ≥50 → HIGH_RISK; below → BLOCK_RECOMMENDED
export const READINESS_MIN_SESSIONS = 20;     // below → INSUFFICIENT_DATA (can't assert readiness)
export const READINESS_MIN_STORES = 3;
export const READINESS_BLOCK_ON_CRITICAL = true; // a live CRITICAL incident forces ≤ BLOCK_RECOMMENDED

// ── Confidence Engine — rule-based confidence from evidence breadth ──────────
// confidence = weighted blend of coverage, sample-count sufficiency, store diversity, browser diversity.
// Capped below 100 — observational data can never be fully certain.
export const CONFIDENCE_WEIGHTS = {
  signalCoverage: 34,
  sampleCount: 26,
  storeDiversity: 24,
  browserDiversity: 16,
} as const;
export const CONFIDENCE_MAX = 96;
export const CONFIDENCE_SAMPLE_FULL = 400;     // sessions at/above → full sample-count sub-score
export const CONFIDENCE_STORES_FULL = 30;      // distinct stores at/above → full store-diversity
export const CONFIDENCE_BROWSERS_FULL = 4;     // distinct browsers at/above → full browser-diversity
export const CONFIDENCE_HIGH = 80;             // ≥80 → HIGH
export const CONFIDENCE_MEDIUM = 55;           // ≥55 → MEDIUM; below → LOW; no data → INSUFFICIENT

// ── Incident Escalation Matrix — severity × blast → escalation level ────────
// LOW/MEDIUM/HIGH/CRITICAL × affected-store/brand spread → Store / Brand / Enterprise / Platform.
export const ESCALATION_BRAND_STORES = 3;      // ≥ this many affected stores in one brand → Brand level
export const ESCALATION_ENTERPRISE_BRANDS = 2; // ≥ this many affected brands → Enterprise level
export const ESCALATION_PLATFORM_STORES = 25;  // ≥ this many affected stores overall → Platform level

// ── Decision Recommendation rules ───────────────────────────────────────────
export const REC_DELAY_RELEASE_SCORE_DROP = 8;  // release score ≥8 below baseline → DELAY_RELEASE candidate
export const REC_BLOCK_RELEASE_SCORE_DROP = 14; // ≥14 → BLOCK_RELEASE_RECOMMENDED candidate
export const REC_MIN_CONFIDENCE_TO_RECOMMEND = 55; // below → OBSERVE only (never a strong recommendation)

// ── Change Impact Analyzer ──────────────────────────────────────────────────
export const IMPACT_SIGNIFICANT_SCORE_DELTA = 4;   // |Δ score| ≥ 4 → significant
export const IMPACT_HIGH_RISK_SCORE_DELTA = 10;    // score drop ≥10 → high-risk change

// ── Executive report windows / sample floors ───────────────────────────────
export const EXEC_REPORT_MIN_SESSIONS = 20;    // below → sections flagged INSUFFICIENT_DATA
