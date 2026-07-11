// WEB-OBS-3 — Predictive Regression Engine (pure, unit-tested, rule-based — NO ML).
//
// Answers "is THIS release safe to promote?" BEFORE production, from the same persistent RUM the
// observability dashboard already reads. Every verdict is a deterministic function of documented
// thresholds (src/lib/observability/thresholds.ts) so it is fully explainable and reproducible.
// A release with too little data returns INSUFFICIENT_DATA — never a fabricated PASS.
//
// Pipeline: ReleaseSignals → { Release Quality Score · Performance Budget · Regression Budget ·
// Release Confidence } → Deployment Readiness → Release Gate verdict.

import { clamp } from './math';
import type { ReleaseComparison, Confidence } from './release';
import {
  RELEASE_QUALITY_WEIGHTS, QUALITY_BAND_EXCELLENT, QUALITY_BAND_GOOD, QUALITY_BAND_RISKY,
  PERF_BUDGET, READINESS_READY_MIN, READINESS_WATCH_MIN,
  GATE_BLOCK_CRITICAL_ERROR_RATE, GATE_BLOCK_CHUNK_FAILURE_RATE, GATE_BLOCK_ERROR_RATE, GATE_BLOCK_REGRESSED_METRICS,
  RELEASE_CONF_MIN_SESSIONS, RELEASE_CONF_HIGH_SESSIONS, RELEASE_CONF_MEDIUM_SESSIONS,
  RELEASE_CONF_MIN_EVENTS, RELEASE_CONF_MIN_BROWSERS,
  ERROR_RATE_BUDGET, CRITICAL_ERROR_RATE_BUDGET, CHUNK_FAILURE_RATE_BUDGET, HYDRATION_ERROR_RATE_BUDGET,
  SLOW_API_RATE_BUDGET, SLOW_ROUTE_RATE_BUDGET, LONG_TASK_RATE_BUDGET, MEMORY_RISK_RATE_BUDGET,
  BOOT_RECOVERY_FAILURE_BUDGET, VITAL_GOOD_MAX, VITAL_NI_MAX,
} from './thresholds';

// ── Inputs ────────────────────────────────────────────────────────────────────
/** Flat, explicit per-release signal bundle. Rates are fractions; p75/p95 are ms (CLS is unitless).
 *  A field is null when that stream had no measurable events (→ its component/budget item is skipped). */
export interface ReleaseSignals {
  release: string;
  sessions: number;
  events: number;
  browsers: number; // distinct browser families observed
  errorRate: number | null;
  criticalErrorRate: number | null;
  chunkFailureRate: number | null;
  hydrationErrorRate: number | null;
  slowRouteRate: number | null;
  slowApiRate: number | null;
  longTaskRate: number | null;
  memoryRiskRate: number | null;
  bootRecoveryFailureRate: number | null; // typically null — no dedicated boot-recovery channel yet
  lcpP75: number | null;
  inpP75: number | null;
  clsP75: number | null;
  ttfbP75: number | null;
  apiP95: number | null;
  incidentCount: number;
}

// ── Small shared scorers (local to keep this module self-contained) ─────────
function rateScore(value: number, budget: number): number {
  if (budget <= 0) return value > 0 ? 0 : 1;
  return clamp(1 - value / budget, 0, 1);
}
function vitalScore(p75: number | null, good: number, ni: number): number | null {
  if (p75 == null || !Number.isFinite(p75)) return null;
  if (p75 <= good) return 1;
  if (p75 >= ni) return 0;
  return clamp(1 - (p75 - good) / (ni - good), 0, 1);
}
/** Incident count → 0..1 goodness (0 incidents = 1; 5+ = 0). */
function incidentScore(n: number): number {
  return clamp(1 - n / 5, 0, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Release Quality Score
// ════════════════════════════════════════════════════════════════════════════
export type QualityStatus = 'EXCELLENT' | 'GOOD' | 'RISKY' | 'POOR' | 'INSUFFICIENT_DATA';

export interface QualityComponent { key: string; weight: number; score: number | null; value: number | null; budget: number | null; }
export interface ReleaseQualityResult {
  score: number | null;
  status: QualityStatus;
  components: QualityComponent[];
  reasons: string[];
}

export function computeReleaseQuality(sig: ReleaseSignals): ReleaseQualityResult {
  // Insufficient-data gate is applied at the Confidence/Readiness layer; here we score whatever
  // components have data, and if NOTHING has data we return INSUFFICIENT_DATA.
  const W = RELEASE_QUALITY_WEIGHTS;
  const rc = (v: number | null, budget: number): number | null => (v == null ? null : rateScore(v, budget));
  const components: QualityComponent[] = [
    { key: 'errorRate', weight: W.errorRate, value: sig.errorRate, budget: ERROR_RATE_BUDGET, score: rc(sig.errorRate, ERROR_RATE_BUDGET) },
    { key: 'criticalErrorRate', weight: W.criticalErrorRate, value: sig.criticalErrorRate, budget: CRITICAL_ERROR_RATE_BUDGET, score: rc(sig.criticalErrorRate, CRITICAL_ERROR_RATE_BUDGET) },
    { key: 'chunkFailureRate', weight: W.chunkFailureRate, value: sig.chunkFailureRate, budget: CHUNK_FAILURE_RATE_BUDGET, score: rc(sig.chunkFailureRate, CHUNK_FAILURE_RATE_BUDGET) },
    { key: 'hydrationErrorRate', weight: W.hydrationErrorRate, value: sig.hydrationErrorRate, budget: HYDRATION_ERROR_RATE_BUDGET, score: rc(sig.hydrationErrorRate, HYDRATION_ERROR_RATE_BUDGET) },
    { key: 'slowRouteRate', weight: W.slowRouteRate, value: sig.slowRouteRate, budget: SLOW_ROUTE_RATE_BUDGET, score: rc(sig.slowRouteRate, SLOW_ROUTE_RATE_BUDGET) },
    { key: 'slowApiRate', weight: W.slowApiRate, value: sig.slowApiRate, budget: SLOW_API_RATE_BUDGET, score: rc(sig.slowApiRate, SLOW_API_RATE_BUDGET) },
    { key: 'longTaskRate', weight: W.longTaskRate, value: sig.longTaskRate, budget: LONG_TASK_RATE_BUDGET, score: rc(sig.longTaskRate, LONG_TASK_RATE_BUDGET) },
    { key: 'lcpP75', weight: W.lcpP75, value: sig.lcpP75, budget: VITAL_GOOD_MAX.LCP, score: vitalScore(sig.lcpP75, VITAL_GOOD_MAX.LCP, VITAL_NI_MAX.LCP) },
    { key: 'inpP75', weight: W.inpP75, value: sig.inpP75, budget: VITAL_GOOD_MAX.INP, score: vitalScore(sig.inpP75, VITAL_GOOD_MAX.INP, VITAL_NI_MAX.INP) },
    { key: 'clsP75', weight: W.clsP75, value: sig.clsP75, budget: VITAL_GOOD_MAX.CLS, score: vitalScore(sig.clsP75, VITAL_GOOD_MAX.CLS, VITAL_NI_MAX.CLS) },
    { key: 'ttfbP75', weight: W.ttfbP75, value: sig.ttfbP75, budget: VITAL_GOOD_MAX.TTFB, score: vitalScore(sig.ttfbP75, VITAL_GOOD_MAX.TTFB, VITAL_NI_MAX.TTFB) },
    { key: 'memoryRiskRate', weight: W.memoryRiskRate, value: sig.memoryRiskRate, budget: MEMORY_RISK_RATE_BUDGET, score: rc(sig.memoryRiskRate, MEMORY_RISK_RATE_BUDGET) },
    { key: 'bootRecoveryFailureRate', weight: W.bootRecoveryFailureRate, value: sig.bootRecoveryFailureRate, budget: BOOT_RECOVERY_FAILURE_BUDGET, score: rc(sig.bootRecoveryFailureRate, BOOT_RECOVERY_FAILURE_BUDGET) },
    { key: 'incidents', weight: W.incidents, value: sig.incidentCount, budget: null, score: incidentScore(sig.incidentCount) },
  ];

  let weighted = 0, present = 0;
  for (const c of components) {
    if (c.score == null) continue;
    weighted += c.weight * c.score;
    present += c.weight;
  }
  if (present === 0) {
    return { score: null, status: 'INSUFFICIENT_DATA', components, reasons: ['측정 가능한 지표 없음'] };
  }
  const score = Math.round((weighted / present) * 100);
  const status: QualityStatus =
    score >= QUALITY_BAND_EXCELLENT ? 'EXCELLENT'
      : score >= QUALITY_BAND_GOOD ? 'GOOD'
        : score >= QUALITY_BAND_RISKY ? 'RISKY'
          : 'POOR';
  const reasons = components
    .filter((c) => c.score != null && c.score < 0.5)
    .map((c) => `${c.key} 예산 초과(score ${Math.round((c.score ?? 0) * 100)})`);
  return { score, status, components, reasons };
}

// ════════════════════════════════════════════════════════════════════════════
// 2. Performance Budget (absolute ceilings)
// ════════════════════════════════════════════════════════════════════════════
export interface BudgetItem { key: string; label: string; value: number | null; budget: number; unit: 'ms' | 'ratio' | 'score'; pass: boolean | null; }
export interface PerfBudgetResult { items: BudgetItem[]; failed: number; passed: number; overall: 'PASS' | 'FAIL' | 'INSUFFICIENT_DATA'; }

export function checkPerformanceBudget(sig: ReleaseSignals): PerfBudgetResult {
  const B = PERF_BUDGET;
  const mk = (key: string, label: string, value: number | null, budget: number, unit: BudgetItem['unit']): BudgetItem => ({
    key, label, value, budget, unit, pass: value == null ? null : value <= budget,
  });
  const items: BudgetItem[] = [
    mk('lcpP75', 'LCP p75', sig.lcpP75, B.lcpP75Ms, 'ms'),
    mk('inpP75', 'INP p75', sig.inpP75, B.inpP75Ms, 'ms'),
    mk('clsP75', 'CLS p75', sig.clsP75, B.clsP75, 'ratio'),
    mk('ttfbP75', 'TTFB p75', sig.ttfbP75, B.ttfbP75Ms, 'ms'),
    mk('apiP95', 'API p95', sig.apiP95, B.apiP95Ms, 'ms'),
    mk('errorRate', 'Error Rate', sig.errorRate, B.errorRate, 'ratio'),
    mk('criticalErrorRate', 'Critical Error Rate', sig.criticalErrorRate, B.criticalErrorRate, 'ratio'),
    mk('chunkFailureRate', 'Chunk Failure Rate', sig.chunkFailureRate, B.chunkFailureRate, 'ratio'),
    mk('hydrationErrorRate', 'Hydration Error Rate', sig.hydrationErrorRate, B.hydrationErrorRate, 'ratio'),
    mk('slowApiRate', 'Slow API Rate', sig.slowApiRate, B.slowApiRate, 'ratio'),
    mk('slowRouteRate', 'Slow Route Rate', sig.slowRouteRate, B.slowRouteRate, 'ratio'),
    mk('longTaskRate', 'Long Task Rate', sig.longTaskRate, B.longTaskRate, 'score'),
    mk('memoryRiskRate', 'Memory Risk Rate', sig.memoryRiskRate, B.memoryRiskRate, 'ratio'),
  ];
  const withData = items.filter((i) => i.pass != null);
  const failed = withData.filter((i) => i.pass === false).length;
  const passed = withData.filter((i) => i.pass === true).length;
  const overall: PerfBudgetResult['overall'] = withData.length === 0 ? 'INSUFFICIENT_DATA' : failed > 0 ? 'FAIL' : 'PASS';
  return { items, failed, passed, overall };
}

/** Build-artifact budget — measured at BUILD time (not telemetry). Pass measured gzip sizes. */
export interface BundleBudgetResult { initialJs: BudgetItem; lazyChunk: BudgetItem; overall: 'PASS' | 'FAIL' | 'INSUFFICIENT_DATA'; }
export function checkBundleBudget(measured: { initialJsGzip: number | null; lazyChunkGzip: number | null }): BundleBudgetResult {
  const mk = (key: string, label: string, value: number | null, budget: number): BudgetItem => ({
    key, label, value, budget, unit: 'score', pass: value == null ? null : value <= budget,
  });
  const initialJs = mk('initialJsGzip', 'Initial JS (gzip)', measured.initialJsGzip, PERF_BUDGET.initialJsGzipBytes);
  const lazyChunk = mk('lazyChunkGzip', 'Lazy chunk (gzip)', measured.lazyChunkGzip, PERF_BUDGET.lazyChunkGzipBytes);
  const known = [initialJs, lazyChunk].filter((i) => i.pass != null);
  const overall: BundleBudgetResult['overall'] = known.length === 0 ? 'INSUFFICIENT_DATA' : known.some((i) => i.pass === false) ? 'FAIL' : 'PASS';
  return { initialJs, lazyChunk, overall };
}

// ════════════════════════════════════════════════════════════════════════════
// 3. Release Confidence (distinct from per-metric compare confidence)
// ════════════════════════════════════════════════════════════════════════════
export interface ReleaseConfidenceResult { level: Confidence; reasons: string[]; }

export function computeReleaseConfidence(sig: ReleaseSignals): ReleaseConfidenceResult {
  const reasons: string[] = [];
  if (sig.sessions < RELEASE_CONF_MIN_SESSIONS) reasons.push(`세션 부족(${sig.sessions}/${RELEASE_CONF_MIN_SESSIONS})`);
  if (sig.events < RELEASE_CONF_MIN_EVENTS) reasons.push(`이벤트 부족(${sig.events}/${RELEASE_CONF_MIN_EVENTS})`);
  if (sig.browsers < RELEASE_CONF_MIN_BROWSERS) reasons.push(`브라우저 다양성 부족(${sig.browsers}/${RELEASE_CONF_MIN_BROWSERS})`);

  if (sig.sessions < RELEASE_CONF_MIN_SESSIONS || sig.events < RELEASE_CONF_MIN_EVENTS) {
    return { level: 'INSUFFICIENT', reasons };
  }
  // HIGH requires strong session coverage AND browser diversity; a single-browser sample caps at MEDIUM.
  if (sig.sessions >= RELEASE_CONF_HIGH_SESSIONS && sig.browsers >= RELEASE_CONF_MIN_BROWSERS) {
    return { level: 'HIGH', reasons };
  }
  if (sig.sessions >= RELEASE_CONF_MEDIUM_SESSIONS) return { level: 'MEDIUM', reasons };
  return { level: 'LOW', reasons };
}

// ════════════════════════════════════════════════════════════════════════════
// 4. Deployment Readiness
// ════════════════════════════════════════════════════════════════════════════
export type DeploymentReadiness = 'READY' | 'WATCH' | 'BLOCKED' | 'INSUFFICIENT_DATA';

export function computeDeploymentReadiness(
  quality: ReleaseQualityResult, budget: PerfBudgetResult, confidence: Confidence,
): DeploymentReadiness {
  if (confidence === 'INSUFFICIENT' || quality.status === 'INSUFFICIENT_DATA') return 'INSUFFICIENT_DATA';
  if (budget.overall === 'FAIL') return 'BLOCKED';
  const s = quality.score ?? 0;
  if (s >= READINESS_READY_MIN) return 'READY';
  if (s >= READINESS_WATCH_MIN) return 'WATCH';
  return 'BLOCKED';
}

// ════════════════════════════════════════════════════════════════════════════
// 5. Release Gate — final verdict
// ════════════════════════════════════════════════════════════════════════════
export type GateVerdict = 'PASS' | 'PASS_WITH_WARNING' | 'BLOCK' | 'INSUFFICIENT_DATA';

export interface GateReason { code: string; metric: string; threshold: string; evidence: string; }
export interface ReleaseGateResult {
  verdict: GateVerdict;
  readiness: DeploymentReadiness;
  qualityScore: number | null;
  qualityStatus: QualityStatus;
  confidence: Confidence;
  budgetOverall: PerfBudgetResult['overall'];
  regressedCount: number;
  improvedCount: number;
  blockingReasons: GateReason[];
  warnings: GateReason[];
}

export interface GateInput {
  signals: ReleaseSignals;
  quality: ReleaseQualityResult;
  budget: PerfBudgetResult;
  confidence: Confidence;
  /** candidate-vs-baseline comparison (null when no baseline release is available). */
  regression: ReleaseComparison | null;
}

/**
 * Final release gate. Precedence:
 *   1. INSUFFICIENT_DATA  — confidence INSUFFICIENT or quality INSUFFICIENT_DATA (never guess).
 *   2. BLOCK              — any hard-block rule (critical/chunk/error floor, budget FAIL, ≥N regressed).
 *   3. PASS_WITH_WARNING  — WATCH readiness, or 1–2 medium-confidence regressions, or LOW confidence.
 *   4. PASS               — READY, budget PASS, no meaningful regression.
 */
export function computeReleaseGate(input: GateInput): ReleaseGateResult {
  const { signals: sig, quality, budget, confidence, regression } = input;
  const readiness = computeDeploymentReadiness(quality, budget, confidence);
  const blockingReasons: GateReason[] = [];
  const warnings: GateReason[] = [];

  // Count regressions with at least MEDIUM confidence (weak-sample regressions become warnings only).
  const regRows = regression?.rows ?? [];
  const strongRegressions = regRows.filter((r) => r.classification === 'REGRESSED' && (r.confidence === 'HIGH' || r.confidence === 'MEDIUM'));
  const weakRegressions = regRows.filter((r) => r.classification === 'REGRESSED' && (r.confidence === 'LOW' || r.confidence === 'INSUFFICIENT'));
  const improvedCount = regRows.filter((r) => r.classification === 'IMPROVED').length;

  if (readiness === 'INSUFFICIENT_DATA') {
    return {
      verdict: 'INSUFFICIENT_DATA', readiness, qualityScore: quality.score, qualityStatus: quality.status,
      confidence, budgetOverall: budget.overall, regressedCount: strongRegressions.length, improvedCount,
      blockingReasons: [], warnings: [{ code: 'INSUFFICIENT_DATA', metric: 'sample', threshold: `sessions ≥ ${RELEASE_CONF_MIN_SESSIONS}, events ≥ ${RELEASE_CONF_MIN_EVENTS}`, evidence: `sessions ${sig.sessions}, events ${sig.events}, browsers ${sig.browsers}` }],
    };
  }

  // ── Hard-block rules ──
  if ((sig.criticalErrorRate ?? 0) >= GATE_BLOCK_CRITICAL_ERROR_RATE) {
    blockingReasons.push({ code: 'CRITICAL_ERROR_RATE', metric: 'criticalErrorRate', threshold: `≥ ${(GATE_BLOCK_CRITICAL_ERROR_RATE * 100).toFixed(0)}%`, evidence: `${((sig.criticalErrorRate ?? 0) * 100).toFixed(2)}%` });
  }
  if ((sig.chunkFailureRate ?? 0) >= GATE_BLOCK_CHUNK_FAILURE_RATE) {
    blockingReasons.push({ code: 'CHUNK_FAILURE_RATE', metric: 'chunkFailureRate', threshold: `≥ ${(GATE_BLOCK_CHUNK_FAILURE_RATE * 100).toFixed(0)}%`, evidence: `${((sig.chunkFailureRate ?? 0) * 100).toFixed(2)}%` });
  }
  if ((sig.errorRate ?? 0) >= GATE_BLOCK_ERROR_RATE) {
    blockingReasons.push({ code: 'ERROR_RATE', metric: 'errorRate', threshold: `≥ ${(GATE_BLOCK_ERROR_RATE * 100).toFixed(0)}%`, evidence: `${((sig.errorRate ?? 0) * 100).toFixed(2)}%` });
  }
  for (const i of budget.items) {
    if (i.pass === false) blockingReasons.push({ code: 'BUDGET_EXCEEDED', metric: i.key, threshold: `≤ ${i.budget}`, evidence: String(i.value) });
  }
  if (strongRegressions.length >= GATE_BLOCK_REGRESSED_METRICS) {
    blockingReasons.push({ code: 'MULTI_REGRESSION', metric: 'release', threshold: `≥ ${GATE_BLOCK_REGRESSED_METRICS} metrics REGRESSED (≥MEDIUM)`, evidence: strongRegressions.map((r) => r.key).join(', ') });
  }

  // ── Warnings ──
  for (const r of strongRegressions) {
    warnings.push({ code: 'REGRESSION', metric: r.key, threshold: `${r.label} abs+rel 초과`, evidence: `${r.confidence} · Δ${r.absDelta ?? '—'}${r.relDelta != null ? ` (${(r.relDelta * 100).toFixed(0)}%)` : ''}` });
  }
  for (const r of weakRegressions) {
    warnings.push({ code: 'WEAK_REGRESSION', metric: r.key, threshold: `${r.label} (표본 약함)`, evidence: `${r.confidence}` });
  }
  if (confidence === 'LOW') warnings.push({ code: 'LOW_CONFIDENCE', metric: 'sample', threshold: 'confidence < MEDIUM', evidence: `sessions ${sig.sessions}, browsers ${sig.browsers}` });

  // ── Verdict precedence ──
  let verdict: GateVerdict;
  if (blockingReasons.length > 0 || readiness === 'BLOCKED') {
    verdict = 'BLOCK';
    if (readiness === 'BLOCKED' && blockingReasons.length === 0) {
      blockingReasons.push({ code: 'LOW_QUALITY', metric: 'qualityScore', threshold: `< ${READINESS_WATCH_MIN}`, evidence: String(quality.score) });
    }
  } else if (readiness === 'WATCH' || strongRegressions.length > 0 || warnings.length > 0) {
    verdict = 'PASS_WITH_WARNING';
  } else {
    verdict = 'PASS';
  }

  return {
    verdict, readiness, qualityScore: quality.score, qualityStatus: quality.status, confidence,
    budgetOverall: budget.overall, regressedCount: strongRegressions.length, improvedCount,
    blockingReasons, warnings,
  };
}
