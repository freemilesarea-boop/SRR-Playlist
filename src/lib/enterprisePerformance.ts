/**
 * enterprisePerformance — Enterprise Performance Intelligence, KPI Governance &
 * Strategic Performance Management 순수 로직 (Phase AI-OPS-44).
 *
 * Enterprise Vision→Strategic Goal→Strategic KPI→Performance Target→Baseline→
 * Observed Performance→Variance Analysis→Business Impact→Cross-Domain Correlation→
 * Strategic Scorecard→Executive Performance Review→Performance Recommendation→
 * Observed Outcome→Performance Learning→Audit.
 *
 * 정직성: KPI Target ≠ Guaranteed Result · Trend ≠ Future Trend ·
 * Correlation ≠ Causality · Improvement ≠ Strategy Success · Decline ≠ Strategy
 * Failure · Business Impact ≠ Financial Fact · Scorecard ≠ Executive Evaluation ·
 * Forecast ≠ Future Fact · Confidence ≠ Certainty · Null → 0 변환 금지.
 * 전 함수 결정적(Deterministic)·순수(Pure)·Null-safe. 자동 KPI 변경/평가 없음.
 *
 * 파일명 고지: 스펙 §11 은 performanceIntelligence.ts 를 지정했으나 해당 파일은
 * AI-OPS-22(0525)에 이미 존재 — 충돌 회피를 위해 enterprisePerformance.ts 로 명명.
 */
import { isFiniteNumber, clampScore } from './aiMemory';

/* ── 상수(SQL CHECK 1:1) ────────────────────────────────────────────────── */
export const ENTERPRISE_KPI_CATEGORIES = [
  'financial', 'customer', 'operational', 'platform', 'store', 'brand', 'artist',
  'content', 'ai', 'security', 'compliance', 'reliability', 'growth', 'quality', 'custom',
] as const;

export const ENTERPRISE_KPI_STATUSES = ['draft', 'active_reference', 'paused_reference', 'deprecated_reference', 'insufficient_data'] as const;

export const KPI_TREND_RESULTS = [
  'strong_growth_candidate', 'moderate_growth_candidate', 'stable_candidate',
  'moderate_decline_candidate', 'strong_decline_candidate', 'insufficient_data',
] as const;
export type KpiTrendResult = (typeof KPI_TREND_RESULTS)[number];

export const KPI_VARIANCE_RESULTS = [
  'on_target_candidate', 'slightly_off_target_candidate', 'materially_off_target_candidate',
  'critical_variance_candidate', 'insufficient_data',
] as const;
export type KpiVarianceResult = (typeof KPI_VARIANCE_RESULTS)[number];

export const BUSINESS_IMPACT_DOMAINS = [
  'revenue', 'cost', 'customer', 'store', 'brand', 'artist', 'operations', 'ai', 'platform', 'risk', 'compliance',
] as const;
export const BUSINESS_IMPACT_RESULTS = [
  'high_positive_candidate', 'moderate_positive_candidate', 'neutral_candidate',
  'moderate_negative_candidate', 'high_negative_candidate', 'insufficient_data',
] as const;
export type BusinessImpactResult = (typeof BUSINESS_IMPACT_RESULTS)[number];

export const KPI_DRIFT_RESULTS = ['no_material_kpi_drift_candidate', 'minor_kpi_drift_candidate', 'moderate_kpi_drift_candidate', 'severe_kpi_drift_candidate', 'kpi_drift_unverified', 'insufficient_data'] as const;
export const KPI_CORRELATION_RESULTS = ['strong_correlation_candidate', 'moderate_correlation_candidate', 'weak_correlation_candidate', 'no_material_correlation_candidate', 'sample_too_small', 'correlation_unverified', 'insufficient_data'] as const;
export type KpiCorrelationResult = (typeof KPI_CORRELATION_RESULTS)[number];
export const KPI_DEPENDENCY_RESULTS = ['upstream_dependency_candidate', 'downstream_dependency_candidate', 'shared_driver_candidate', 'no_material_dependency_candidate', 'dependency_unverified', 'insufficient_data'] as const;
export const FORECAST_COMPARISON_RESULTS = ['forecast_aligned_candidate', 'forecast_moderately_off_candidate', 'forecast_materially_off_candidate', 'forecast_comparison_unverified', 'insufficient_data'] as const;
export const KPI_DATA_QUALITY_LEVELS = ['verified_source_reference', 'proxy_candidate', 'manual_entry_reference', 'quality_unverified', 'insufficient_data'] as const;
export const KPI_DIRECTIONS = ['higher_is_better', 'lower_is_better', 'unspecified'] as const;

export const PERFORMANCE_RECOMMENDATION_TYPES = [
  'create_kpi', 'record_kpi_baseline', 'record_kpi_target', 'record_kpi_snapshot',
  'review_kpi_trend', 'review_kpi_variance', 'review_kpi_confidence', 'compare_kpi_forecast',
  'review_kpi_drift', 'review_kpi_correlation', 'review_kpi_dependency',
  'review_cross_domain_correlation', 'review_business_impact', 'build_strategic_scorecard',
  'build_executive_scorecard', 'request_kpi_review', 'request_executive_review',
  'request_performance_review', 'link_decision_outcome', 'link_forecast_reference',
  'link_performance_outcome', 'record_performance_learning_reference',
  'gather_more_evidence_candidate', 'insufficient_data',
] as const;

/* §8 Strategic Scorecard 포함 필드 */
export const SCORECARD_FIELDS = [
  'kpi', 'target', 'actual', 'trend', 'variance', 'forecast', 'confidence',
  'business_impact', 'recommendation', 'executive_review',
] as const;

/* ── KPI Trend Candidate(Trend ≠ Future Trend) ─────────────────────────── */
export function calculateKpiTrendCandidate(points: { value: number | null }[] | null, minSample = 3): {
  result: KpiTrendResult; changePct: number | null; dataStatus: 'ok' | 'sample_too_small' | 'insufficient_data'; trendIsNotFutureTrend: true;
} {
  if (!Array.isArray(points)) return { result: 'insufficient_data', changePct: null, dataStatus: 'insufficient_data', trendIsNotFutureTrend: true };
  const vals = points.map((p) => p?.value).filter(isFiniteNumber);
  if (vals.length === 0) return { result: 'insufficient_data', changePct: null, dataStatus: 'insufficient_data', trendIsNotFutureTrend: true };
  if (vals.length < minSample) return { result: 'insufficient_data', changePct: null, dataStatus: 'sample_too_small', trendIsNotFutureTrend: true };
  const first = vals[0];
  const last = vals[vals.length - 1];
  if (first === 0) return { result: 'insufficient_data', changePct: null, dataStatus: 'insufficient_data', trendIsNotFutureTrend: true };
  const changePct = Math.round(((last - first) / Math.abs(first)) * 10000) / 100;
  const result: KpiTrendResult = changePct >= 20 ? 'strong_growth_candidate'
    : changePct >= 5 ? 'moderate_growth_candidate'
    : changePct > -5 ? 'stable_candidate'
    : changePct > -20 ? 'moderate_decline_candidate'
    : 'strong_decline_candidate';
  return { result, changePct, dataStatus: 'ok', trendIsNotFutureTrend: true };
}

/* ── KPI Variance(Baseline/Target/Actual — Target ≠ Guaranteed Result) ──── */
export function calculateKpiVariance(input: { baseline: number | null; target: number | null; actual: number | null; direction: (typeof KPI_DIRECTIONS)[number] }): {
  result: KpiVarianceResult; varianceVsTarget: number | null; variancePct: number | null; varianceVsBaseline: number | null;
  targetIsNotGuaranteedResult: true; declineIsNotStrategyFailure: true;
} {
  const { baseline, target, actual, direction } = input;
  const varianceVsBaseline = isFiniteNumber(actual) && isFiniteNumber(baseline) ? actual - baseline : null;
  if (!isFiniteNumber(actual) || !isFiniteNumber(target) || target === 0) {
    return { result: 'insufficient_data', varianceVsTarget: null, variancePct: null, varianceVsBaseline, targetIsNotGuaranteedResult: true, declineIsNotStrategyFailure: true };
  }
  const varianceVsTarget = actual - target;
  // 방향 반영: lower_is_better 는 목표 초과가 악화.
  const signed = direction === 'lower_is_better' ? -varianceVsTarget : varianceVsTarget;
  const shortfall = signed < 0 ? Math.abs(signed) : 0;
  const variancePct = Math.round((shortfall / Math.abs(target)) * 10000) / 100;
  const result: KpiVarianceResult = variancePct <= 5 ? 'on_target_candidate'
    : variancePct <= 15 ? 'slightly_off_target_candidate'
    : variancePct <= 30 ? 'materially_off_target_candidate'
    : 'critical_variance_candidate';
  return { result, varianceVsTarget, variancePct, varianceVsBaseline, targetIsNotGuaranteedResult: true, declineIsNotStrategyFailure: true };
}

/* ── Forecast vs Actual 비교(Forecast ≠ Future Fact) ────────────────────── */
export function compareForecastToActual(forecast: number | null, actual: number | null): {
  result: (typeof FORECAST_COMPARISON_RESULTS)[number]; deltaPct: number | null; forecastIsNotFutureFact: true;
} {
  if (!isFiniteNumber(forecast) || !isFiniteNumber(actual) || forecast === 0) {
    return { result: 'insufficient_data', deltaPct: null, forecastIsNotFutureFact: true };
  }
  const deltaPct = Math.round((Math.abs(actual - forecast) / Math.abs(forecast)) * 10000) / 100;
  const result = deltaPct <= 5 ? 'forecast_aligned_candidate' as const
    : deltaPct <= 20 ? 'forecast_moderately_off_candidate' as const
    : 'forecast_materially_off_candidate' as const;
  return { result, deltaPct, forecastIsNotFutureFact: true };
}

/* ── KPI Correlation Candidate(Pearson — Correlation ≠ Causality) ───────── */
export function calculateKpiCorrelationCandidate(seriesA: (number | null)[], seriesB: (number | null)[], minSample = 4): {
  result: KpiCorrelationResult; coefficient: number | null; sampleSize: number; correlationIsNotCausality: true;
} {
  const pairs: [number, number][] = [];
  const n = Math.min(Array.isArray(seriesA) ? seriesA.length : 0, Array.isArray(seriesB) ? seriesB.length : 0);
  for (let i = 0; i < n; i++) {
    const a = seriesA[i];
    const b = seriesB[i];
    if (isFiniteNumber(a) && isFiniteNumber(b)) pairs.push([a, b]);
  }
  if (pairs.length === 0) return { result: 'insufficient_data', coefficient: null, sampleSize: 0, correlationIsNotCausality: true };
  if (pairs.length < minSample) return { result: 'sample_too_small', coefficient: null, sampleSize: pairs.length, correlationIsNotCausality: true };
  const meanA = pairs.reduce((s, p) => s + p[0], 0) / pairs.length;
  const meanB = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
  let cov = 0, varA = 0, varB = 0;
  for (const [a, b] of pairs) {
    cov += (a - meanA) * (b - meanB);
    varA += (a - meanA) ** 2;
    varB += (b - meanB) ** 2;
  }
  if (varA === 0 || varB === 0) return { result: 'insufficient_data', coefficient: null, sampleSize: pairs.length, correlationIsNotCausality: true };
  const r = Math.round((cov / Math.sqrt(varA * varB)) * 1000) / 1000;
  const abs = Math.abs(r);
  const result: KpiCorrelationResult = abs >= 0.7 ? 'strong_correlation_candidate'
    : abs >= 0.4 ? 'moderate_correlation_candidate'
    : abs >= 0.2 ? 'weak_correlation_candidate'
    : 'no_material_correlation_candidate';
  return { result, coefficient: r, sampleSize: pairs.length, correlationIsNotCausality: true };
}

/* ── Business Impact Candidate(Impact ≠ Financial Fact) ────────────────── */
export function evaluateBusinessImpactCandidate(input: { domain: string; deltaPct: number | null; sampleSize: number | null }): {
  result: BusinessImpactResult; impactIsNotFinancialFact: true; sampleStatus: 'ok' | 'sample_too_small' | 'insufficient_data';
} {
  if (!(BUSINESS_IMPACT_DOMAINS as readonly string[]).includes(input.domain) || !isFiniteNumber(input.deltaPct)) {
    return { result: 'insufficient_data', impactIsNotFinancialFact: true, sampleStatus: 'insufficient_data' };
  }
  if (!isFiniteNumber(input.sampleSize) || input.sampleSize < 3) {
    return { result: 'insufficient_data', impactIsNotFinancialFact: true, sampleStatus: 'sample_too_small' };
  }
  const d = input.deltaPct;
  const result: BusinessImpactResult = d >= 15 ? 'high_positive_candidate'
    : d >= 3 ? 'moderate_positive_candidate'
    : d > -3 ? 'neutral_candidate'
    : d > -15 ? 'moderate_negative_candidate'
    : 'high_negative_candidate';
  return { result, impactIsNotFinancialFact: true, sampleStatus: 'ok' };
}

/* ── Strategic Scorecard Candidate(§8 — Scorecard ≠ Executive Evaluation) ─ */
export interface ScorecardEntryInput {
  kpiCode: string; target: number | null; actual: number | null;
  trend: KpiTrendResult; variance: KpiVarianceResult; forecast: number | null;
  confidence: number | null; businessImpact: BusinessImpactResult;
  recommendation: string | null; executiveReviewPresent: boolean;
}
export function buildStrategicScorecardCandidate(entries: ScorecardEntryInput[] | null): {
  rows: (ScorecardEntryInput & { fieldsComplete: boolean })[]; fields: readonly string[];
  scorecardIsNotExecutiveEvaluation: true; improvementIsNotStrategySuccess: true;
} {
  const rows = (Array.isArray(entries) ? entries : []).map((e) => ({
    ...e,
    fieldsComplete: e.target != null && e.actual != null && e.confidence != null && e.recommendation != null,
  }));
  return { rows, fields: SCORECARD_FIELDS, scorecardIsNotExecutiveEvaluation: true, improvementIsNotStrategySuccess: true };
}

/* ── Executive Scorecard(악화 우선 정렬 — 결정적) ──────────────────────── */
export function buildExecutiveScorecardCandidate(entries: ScorecardEntryInput[] | null, topN = 5): {
  priorityRows: ScorecardEntryInput[]; scorecardIsNotExecutiveEvaluation: true; orderingIsDeterministic: true;
} {
  const severity = (e: ScorecardEntryInput): number => {
    const v = e.variance === 'critical_variance_candidate' ? 4 : e.variance === 'materially_off_target_candidate' ? 3 : e.variance === 'slightly_off_target_candidate' ? 2 : e.variance === 'on_target_candidate' ? 1 : 0;
    const t = e.trend === 'strong_decline_candidate' ? 2 : e.trend === 'moderate_decline_candidate' ? 1 : 0;
    const i = e.businessImpact === 'high_negative_candidate' ? 2 : e.businessImpact === 'moderate_negative_candidate' ? 1 : 0;
    return v * 10 + t * 3 + i;
  };
  const sorted = (Array.isArray(entries) ? [...entries] : [])
    .sort((a, b) => severity(b) - severity(a) || a.kpiCode.localeCompare(b.kpiCode));
  return { priorityRows: sorted.slice(0, Math.max(0, topN)), scorecardIsNotExecutiveEvaluation: true, orderingIsDeterministic: true };
}

/* ── KPI Confidence(Confidence ≠ Certainty) ────────────────────────────── */
export function evaluateKpiConfidence(input: { sampleSize: number | null; dataQuality: string }): {
  confidence: number | null; confidenceIsNotCertainty: true;
} {
  if (!isFiniteNumber(input.sampleSize) || input.sampleSize <= 0) return { confidence: null, confidenceIsNotCertainty: true };
  const qualityFactor = input.dataQuality === 'verified_source_reference' ? 1
    : input.dataQuality === 'proxy_candidate' ? 0.6
    : input.dataQuality === 'manual_entry_reference' ? 0.5
    : 0.3;
  const sampleFactor = Math.min(1, input.sampleSize / 30);
  return { confidence: clampScore(qualityFactor * sampleFactor * 100), confidenceIsNotCertainty: true };
}

/* ── Human Performance Review 검증(Self-Review 차단·Evidence 필수) ─────── */
export function validatePerformanceReview(input: { action: string; evidenceCount: number | null; isSelfReview: boolean }): {
  allowed: boolean; blockedReasons: string[]; humanEvaluationRequired: true;
} {
  const blockedReasons: string[] = [];
  if (input.action === 'record_review_reference') {
    if (input.isSelfReview) blockedReasons.push('Self-Review 차단(작성자 ≠ 평가자)');
    if (!isFiniteNumber(input.evidenceCount) || input.evidenceCount <= 0) blockedReasons.push('Evidence 없는 Performance Review Reference 금지');
  }
  return { allowed: blockedReasons.length === 0, blockedReasons, humanEvaluationRequired: true };
}

/* ── Performance 흐름 타임라인(관측 여부 표시 — 자동 진행 아님) ────────── */
export const PERFORMANCE_FLOW_STAGES = [
  'strategic_goal', 'strategic_kpi', 'performance_target', 'baseline', 'observed_performance',
  'variance_analysis', 'business_impact', 'cross_domain_correlation', 'strategic_scorecard',
  'executive_performance_review', 'performance_recommendation', 'observed_outcome', 'performance_learning',
] as const;
export function buildPerformanceTimeline(input: { present: Partial<Record<(typeof PERFORMANCE_FLOW_STAGES)[number], boolean>> }): {
  stage: (typeof PERFORMANCE_FLOW_STAGES)[number]; present: boolean;
}[] {
  return PERFORMANCE_FLOW_STAGES.map((stage) => ({ stage, present: input.present[stage] === true }));
}

/* ── 컴포넌트/Support Matrix(분류 6종 — §1) ────────────────────────────── */
export const ENTERPRISE_PERFORMANCE_COMPONENTS = [
  'enterprise_kpi_registry', 'kpi_snapshot_ledger', 'kpi_trend_variance_analysis',
  'forecast_comparison', 'kpi_correlation_dependency', 'business_impact_analysis',
  'strategic_executive_scorecard', 'human_performance_review_workflow',
  'performance_recommendation', 'performance_event_audit',
] as const;

export type PerformanceSupportLevel = 'fully_supported' | 'partially_supported' | 'advisory_only' | 'human_review_only' | 'unavailable' | 'insufficient_data';
export const ENTERPRISE_PERFORMANCE_SUPPORT_MATRIX: { capability: string; support: PerformanceSupportLevel }[] = [
  { capability: 'enterprise_kpi_structuring', support: 'fully_supported' },
  { capability: 'kpi_category_15_domains', support: 'fully_supported' },
  { capability: 'kpi_baseline_with_source_reference', support: 'human_review_only' },
  { capability: 'kpi_target_with_rationale', support: 'human_review_only' },
  { capability: 'kpi_snapshot_recording_null_safe', support: 'fully_supported' },
  { capability: 'kpi_trend_candidate_calculation', support: 'fully_supported' },
  { capability: 'kpi_growth_decline_classification', support: 'fully_supported' },
  { capability: 'kpi_variance_candidate_calculation', support: 'fully_supported' },
  { capability: 'kpi_confidence_candidate', support: 'partially_supported' },
  { capability: 'kpi_forecast_comparison_0543', support: 'partially_supported' },
  { capability: 'kpi_drift_candidate', support: 'advisory_only' },
  { capability: 'kpi_correlation_candidate', support: 'fully_supported' },
  { capability: 'kpi_dependency_candidate', support: 'advisory_only' },
  { capability: 'cross_domain_correlation_candidate', support: 'advisory_only' },
  { capability: 'business_impact_candidate_11_domains', support: 'advisory_only' },
  { capability: 'strategic_scorecard_candidate', support: 'advisory_only' },
  { capability: 'executive_scorecard_candidate', support: 'advisory_only' },
  { capability: 'performance_summary_candidate', support: 'advisory_only' },
  { capability: 'performance_recommendation_with_evidence', support: 'advisory_only' },
  { capability: 'kpi_review_request', support: 'human_review_only' },
  { capability: 'executive_review_request', support: 'human_review_only' },
  { capability: 'performance_review_reference_no_self_review', support: 'human_review_only' },
  { capability: 'goal_reference_link_0545', support: 'partially_supported' },
  { capability: 'portfolio_reference_link_0545', support: 'partially_supported' },
  { capability: 'program_reference_link_0547', support: 'partially_supported' },
  { capability: 'decision_outcome_link_0514', support: 'partially_supported' },
  { capability: 'forecast_reference_link_0543', support: 'partially_supported' },
  { capability: 'commitment_reference_link_0520', support: 'partially_supported' },
  { capability: 'performance_outcome_link', support: 'partially_supported' },
  { capability: 'performance_learning_reference', support: 'partially_supported' },
  { capability: 'performance_event_audit_trail', support: 'fully_supported' },
  { capability: 'accounting_system_feed', support: 'insufficient_data' },
  { capability: 'revenue_recognition_feed', support: 'insufficient_data' },
  { capability: 'crm_feed', support: 'insufficient_data' },
  { capability: 'external_market_benchmark_feed', support: 'insufficient_data' },
  { capability: 'ab_test_platform_feed', support: 'insufficient_data' },
  { capability: 'bi_warehouse_feed', support: 'insufficient_data' },
  { capability: 'automatic_kpi_modification', support: 'unavailable' },
  { capability: 'automatic_kpi_deletion', support: 'unavailable' },
  { capability: 'automatic_kpi_approval', support: 'unavailable' },
  { capability: 'automatic_personnel_evaluation', support: 'unavailable' },
  { capability: 'automatic_performance_evaluation', support: 'unavailable' },
  { capability: 'automatic_compensation', support: 'unavailable' },
  { capability: 'automatic_promotion', support: 'unavailable' },
  { capability: 'automatic_termination', support: 'unavailable' },
  { capability: 'automatic_budget_change', support: 'unavailable' },
  { capability: 'automatic_strategy_change', support: 'unavailable' },
  { capability: 'automatic_portfolio_change', support: 'unavailable' },
  { capability: 'automatic_resource_allocation', support: 'unavailable' },
  { capability: 'automatic_production_change', support: 'unavailable' },
  { capability: 'automatic_payment', support: 'unavailable' },
  { capability: 'automatic_settlement_change', support: 'unavailable' },
  { capability: 'automatic_contract_change', support: 'unavailable' },
  { capability: 'automatic_incident_creation', support: 'unavailable' },
  { capability: 'automatic_rollout', support: 'unavailable' },
  { capability: 'automatic_rollback', support: 'unavailable' },
  { capability: 'automatic_merge', support: 'unavailable' },
  { capability: 'automatic_deploy', support: 'unavailable' },
];
