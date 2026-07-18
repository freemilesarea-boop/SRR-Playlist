/**
 * enterpriseValue — Enterprise Value Intelligence, Business Value Attribution &
 * ROI Governance 순수 로직 (Phase AI-OPS-45).
 *
 * Enterprise Strategy→Strategic Initiative→Execution Outcome→Performance KPI→
 * Business Value→Value Attribution→ROI Analysis→Investment Effectiveness→
 * Enterprise Value Score→Value Trade-off→Executive Value Review→
 * Observed Business Outcome→Value Learning→Audit.
 *
 * 정직성: Business Value ≠ Financial Statement · ROI Candidate ≠ Accounting ROI ·
 * ROI ≠ Investment Decision · Value Attribution ≠ Proven Causality ·
 * KPI Improvement ≠ Value Creation · Revenue Increase ≠ Enterprise Value Increase ·
 * Enterprise Value Score ≠ Company Valuation · Confidence ≠ Certainty ·
 * Null → 0 변환 금지. 전 함수 결정적(Deterministic)·순수(Pure)·Null-safe.
 * ROI 자동 확정/투자 자동 승인 없음.
 */
import { isFiniteNumber, clampScore } from './aiMemory';

/* ── 상수(SQL CHECK 1:1) ────────────────────────────────────────────────── */
export const BUSINESS_VALUE_CATEGORIES = [
  'revenue', 'profitability', 'customer', 'brand', 'artist', 'store', 'platform', 'operations',
  'ai_capability', 'innovation', 'reliability', 'security', 'compliance', 'strategic', 'long_term', 'custom',
] as const;

export const BUSINESS_VALUE_STATUSES = ['draft', 'active_reference', 'paused_reference', 'deprecated_reference', 'insufficient_data'] as const;

export const VALUE_TREND_RESULTS = [
  'strong_positive_candidate', 'moderate_positive_candidate', 'stable_candidate',
  'moderate_negative_candidate', 'strong_negative_candidate', 'insufficient_data',
] as const;
export type ValueTrendResult = (typeof VALUE_TREND_RESULTS)[number];

export const ROI_RESULTS = [
  'excellent_roi_candidate', 'acceptable_roi_candidate', 'uncertain_roi_candidate',
  'poor_roi_candidate', 'insufficient_data',
] as const;
export type RoiResult = (typeof ROI_RESULTS)[number];

export const VALUE_ATTRIBUTION_DIMENSIONS = [
  'strategy_contribution', 'execution_contribution', 'kpi_contribution',
  'resource_contribution', 'external_factors', 'unknown_factors',
] as const;
export const VALUE_ATTRIBUTION_RESULTS = [
  'strong_attribution_candidate', 'moderate_attribution_candidate', 'weak_attribution_candidate',
  'attribution_unverified', 'insufficient_data',
] as const;
export type ValueAttributionResult = (typeof VALUE_ATTRIBUTION_RESULTS)[number];

export const VALUE_LINK_RESULTS = ['strong_link_candidate', 'moderate_link_candidate', 'weak_link_candidate', 'no_material_link_candidate', 'link_unverified', 'insufficient_data'] as const;
export type ValueLinkResult = (typeof VALUE_LINK_RESULTS)[number];
export const INVESTMENT_EFFECTIVENESS_RESULTS = ['high_effectiveness_candidate', 'moderate_effectiveness_candidate', 'low_effectiveness_candidate', 'ineffective_candidate', 'effectiveness_unverified', 'insufficient_data'] as const;
export const VALUE_DRIFT_RESULTS = ['no_material_value_drift_candidate', 'minor_value_drift_candidate', 'moderate_value_drift_candidate', 'severe_value_drift_candidate', 'value_drift_unverified', 'insufficient_data'] as const;
export const VALUE_CORRELATION_RESULTS = ['strong_correlation_candidate', 'moderate_correlation_candidate', 'weak_correlation_candidate', 'no_material_correlation_candidate', 'diverging_domains_candidate', 'sample_too_small', 'correlation_unverified', 'insufficient_data'] as const;
export const VALUE_TRADEOFF_AXES = ['short_term_roi_vs_long_term_value', 'brand_value_vs_revenue', 'customer_satisfaction_vs_revenue', 'growth_vs_profitability', 'innovation_vs_reliability', 'cost_vs_capability'] as const;
export const VALUE_TRADEOFF_RESULTS = ['favorable_tradeoff_candidate', 'balanced_tradeoff_candidate', 'conflicting_tradeoff_candidate', 'mixed_tradeoff_candidate', 'tradeoff_unverified', 'insufficient_data'] as const;
export const VALUE_DATA_QUALITY_LEVELS = ['verified_source_reference', 'proxy_candidate', 'manual_entry_reference', 'quality_unverified', 'insufficient_data'] as const;

export const VALUE_RECOMMENDATION_TYPES = [
  'create_business_value_model', 'record_value_baseline', 'record_investment_reference',
  'record_value_snapshot', 'review_value_trend', 'review_value_attribution',
  'review_kpi_value_link', 'review_execution_value_link', 'review_roi_candidate',
  'review_investment_effectiveness', 'review_value_confidence', 'review_value_drift',
  'review_value_correlation', 'review_cross_domain_value', 'record_enterprise_value_score',
  'build_strategic_value_scorecard', 'build_executive_value_summary', 'review_value_tradeoff',
  'request_value_review', 'request_executive_review', 'request_strategy_review',
  'link_business_outcome', 'record_value_learning_reference', 'gather_more_evidence_candidate',
  'insufficient_data',
] as const;

/* §8 Enterprise Value Score 포함 필드 */
export const VALUE_SCORE_FIELDS = [
  'value_category', 'baseline', 'current', 'trend', 'roi_candidate', 'confidence',
  'attribution', 'recommendation', 'executive_review',
] as const;

/* ── ROI Candidate(§6 — ROI Candidate ≠ Accounting ROI/Investment Decision) ─ */
export function calculateRoiCandidate(input: { investment: number | null; benefit: number | null; confidence: number | null }): {
  result: RoiResult; roiPct: number | null; roiIsNotAccountingRoi: true; roiIsNotInvestmentDecision: true;
} {
  const { investment, benefit, confidence } = input;
  if (!isFiniteNumber(investment) || !isFiniteNumber(benefit) || investment <= 0) {
    return { result: 'insufficient_data', roiPct: null, roiIsNotAccountingRoi: true, roiIsNotInvestmentDecision: true };
  }
  const roiPct = Math.round(((benefit - investment) / investment) * 10000) / 100;
  // 신뢰도 낮으면 수치와 무관하게 uncertain 유지(Confidence ≠ Certainty).
  if (!isFiniteNumber(confidence) || confidence < 40) {
    return { result: 'uncertain_roi_candidate', roiPct, roiIsNotAccountingRoi: true, roiIsNotInvestmentDecision: true };
  }
  const result: RoiResult = roiPct >= 30 ? 'excellent_roi_candidate'
    : roiPct >= 0 ? 'acceptable_roi_candidate'
    : 'poor_roi_candidate';
  return { result, roiPct, roiIsNotAccountingRoi: true, roiIsNotInvestmentDecision: true };
}

/* ── Value Attribution(§7 — Attribution ≠ Proven Causality) ────────────── */
export function evaluateValueAttribution(signals: { dimension: string; weight: number }[] | null): {
  result: ValueAttributionResult; topDimension: string | null; unknownShare: number | null; attributionIsNotProvenCausality: true;
} {
  const valid = (Array.isArray(signals) ? signals : []).filter((s) => (VALUE_ATTRIBUTION_DIMENSIONS as readonly string[]).includes(s.dimension) && isFiniteNumber(s.weight) && s.weight >= 0);
  const total = valid.reduce((sum, s) => sum + s.weight, 0);
  if (!valid.length || total <= 0) {
    return { result: 'insufficient_data', topDimension: null, unknownShare: null, attributionIsNotProvenCausality: true };
  }
  const unknownWeight = valid.filter((s) => s.dimension === 'unknown_factors' || s.dimension === 'external_factors').reduce((sum, s) => sum + s.weight, 0);
  const unknownShare = Math.round((unknownWeight / total) * 100) / 100;
  // 외부/미지 요인이 절반 이상이면 attribution 자체를 검증 불가로 유지.
  if (unknownShare >= 0.5) {
    return { result: 'attribution_unverified', topDimension: null, unknownShare, attributionIsNotProvenCausality: true };
  }
  const internal = valid.filter((s) => s.dimension !== 'unknown_factors' && s.dimension !== 'external_factors');
  let top = internal[0];
  for (const s of internal) { if (s.weight > top.weight) top = s; }
  const topShare = top.weight / total;
  const result: ValueAttributionResult = topShare >= 0.5 ? 'strong_attribution_candidate'
    : topShare >= 0.3 ? 'moderate_attribution_candidate'
    : 'weak_attribution_candidate';
  return { result, topDimension: top.dimension, unknownShare, attributionIsNotProvenCausality: true };
}

/* ── Value Trend Candidate(§5 — Trend ≠ Future Trend) ──────────────────── */
export function calculateValueTrendCandidate(points: { value: number | null }[] | null, minSample = 3): {
  result: ValueTrendResult; changePct: number | null; dataStatus: 'ok' | 'sample_too_small' | 'insufficient_data'; trendIsNotFutureTrend: true;
} {
  if (!Array.isArray(points)) return { result: 'insufficient_data', changePct: null, dataStatus: 'insufficient_data', trendIsNotFutureTrend: true };
  const vals = points.map((p) => p?.value).filter(isFiniteNumber);
  if (vals.length === 0) return { result: 'insufficient_data', changePct: null, dataStatus: 'insufficient_data', trendIsNotFutureTrend: true };
  if (vals.length < minSample) return { result: 'insufficient_data', changePct: null, dataStatus: 'sample_too_small', trendIsNotFutureTrend: true };
  const first = vals[0];
  const last = vals[vals.length - 1];
  if (first === 0) return { result: 'insufficient_data', changePct: null, dataStatus: 'insufficient_data', trendIsNotFutureTrend: true };
  const changePct = Math.round(((last - first) / Math.abs(first)) * 10000) / 100;
  const result: ValueTrendResult = changePct >= 20 ? 'strong_positive_candidate'
    : changePct >= 5 ? 'moderate_positive_candidate'
    : changePct > -5 ? 'stable_candidate'
    : changePct > -20 ? 'moderate_negative_candidate'
    : 'strong_negative_candidate';
  return { result, changePct, dataStatus: 'ok', trendIsNotFutureTrend: true };
}

/* ── KPI/Execution → Value Link(KPI Improvement ≠ Value Creation) ──────── */
export function evaluateValueLinkCandidate(input: { sourceDeltaPct: number | null; valueDeltaPct: number | null; sampleSize: number | null }): {
  result: ValueLinkResult; sameDirection: boolean | null; kpiImprovementIsNotValueCreation: true;
} {
  const { sourceDeltaPct, valueDeltaPct, sampleSize } = input;
  if (!isFiniteNumber(sourceDeltaPct) || !isFiniteNumber(valueDeltaPct)) {
    return { result: 'insufficient_data', sameDirection: null, kpiImprovementIsNotValueCreation: true };
  }
  if (!isFiniteNumber(sampleSize) || sampleSize < 4) {
    return { result: 'link_unverified', sameDirection: null, kpiImprovementIsNotValueCreation: true };
  }
  const sameDirection = Math.sign(sourceDeltaPct) === Math.sign(valueDeltaPct) && sourceDeltaPct !== 0 && valueDeltaPct !== 0;
  if (!sameDirection) return { result: 'no_material_link_candidate', sameDirection, kpiImprovementIsNotValueCreation: true };
  const magnitude = Math.min(Math.abs(sourceDeltaPct), Math.abs(valueDeltaPct));
  const result: ValueLinkResult = magnitude >= 15 ? 'strong_link_candidate'
    : magnitude >= 5 ? 'moderate_link_candidate'
    : 'weak_link_candidate';
  return { result, sameDirection, kpiImprovementIsNotValueCreation: true };
}

/* ── Cross-Domain Value(Revenue ↑ ≠ Enterprise Value ↑ — 발산 탐지) ────── */
export function evaluateCrossDomainValue(domains: { domain: string; deltaPct: number | null }[] | null): {
  result: (typeof VALUE_CORRELATION_RESULTS)[number]; divergingPairs: { a: string; b: string }[]; revenueIncreaseIsNotEnterpriseValueIncrease: true;
} {
  const valid = (Array.isArray(domains) ? domains : []).filter((d) => isFiniteNumber(d.deltaPct));
  if (valid.length < 2) return { result: 'insufficient_data', divergingPairs: [], revenueIncreaseIsNotEnterpriseValueIncrease: true };
  const divergingPairs: { a: string; b: string }[] = [];
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const a = valid[i];
      const b = valid[j];
      if ((a.deltaPct as number) >= 5 && (b.deltaPct as number) <= -5) divergingPairs.push({ a: a.domain, b: b.domain });
      else if ((a.deltaPct as number) <= -5 && (b.deltaPct as number) >= 5) divergingPairs.push({ a: b.domain, b: a.domain });
    }
  }
  const result = divergingPairs.length > 0 ? 'diverging_domains_candidate' as const : 'no_material_correlation_candidate' as const;
  return { result, divergingPairs, revenueIncreaseIsNotEnterpriseValueIncrease: true };
}

/* ── Enterprise Value Score(§8 — Score ≠ Company Valuation) ────────────── */
export interface ValueScoreEntryInput {
  valueCode: string; category: string; baseline: number | null; current: number | null;
  trend: ValueTrendResult; roi: RoiResult; confidence: number | null;
  attribution: ValueAttributionResult; recommendation: string | null; executiveReviewPresent: boolean;
}
export function buildEnterpriseValueScore(entries: ValueScoreEntryInput[] | null): {
  score: number | null; assessedEntries: number; fields: readonly string[]; scoreIsNotCompanyValuation: true; insufficientData: boolean;
} {
  const valid = (Array.isArray(entries) ? entries : []).filter((e) => e.trend !== 'insufficient_data' && e.roi !== 'insufficient_data');
  if (!valid.length) return { score: null, assessedEntries: 0, fields: VALUE_SCORE_FIELDS, scoreIsNotCompanyValuation: true, insufficientData: true };
  const trendScore = (t: ValueTrendResult): number => t === 'strong_positive_candidate' ? 100 : t === 'moderate_positive_candidate' ? 75 : t === 'stable_candidate' ? 50 : t === 'moderate_negative_candidate' ? 25 : 0;
  const roiScore = (r: RoiResult): number => r === 'excellent_roi_candidate' ? 100 : r === 'acceptable_roi_candidate' ? 70 : r === 'uncertain_roi_candidate' ? 40 : 10;
  const total = valid.reduce((sum, e) => sum + (trendScore(e.trend) + roiScore(e.roi)) / 2, 0);
  return { score: clampScore(total / valid.length), assessedEntries: valid.length, fields: VALUE_SCORE_FIELDS, scoreIsNotCompanyValuation: true, insufficientData: false };
}

/* ── Strategic Value Scorecard(악화/저ROI 우선 결정적 정렬) ────────────── */
export function buildStrategicValueScorecard(entries: ValueScoreEntryInput[] | null, topN = 5): {
  priorityRows: ValueScoreEntryInput[]; scorecardIsNotExecutiveEvaluation: true; orderingIsDeterministic: true;
} {
  const severity = (e: ValueScoreEntryInput): number => {
    const r = e.roi === 'poor_roi_candidate' ? 3 : e.roi === 'uncertain_roi_candidate' ? 2 : e.roi === 'acceptable_roi_candidate' ? 1 : 0;
    const t = e.trend === 'strong_negative_candidate' ? 2 : e.trend === 'moderate_negative_candidate' ? 1 : 0;
    const a = e.attribution === 'attribution_unverified' ? 1 : 0;
    return r * 10 + t * 3 + a;
  };
  const sorted = (Array.isArray(entries) ? [...entries] : [])
    .sort((a, b) => severity(b) - severity(a) || a.valueCode.localeCompare(b.valueCode));
  return { priorityRows: sorted.slice(0, Math.max(0, topN)), scorecardIsNotExecutiveEvaluation: true, orderingIsDeterministic: true };
}

/* ── Value Trade-off(단기 ROI vs 장기 Value 등 충돌 탐지) ──────────────── */
export function evaluateValueTradeoff(input: { axis: string; sideADeltaPct: number | null; sideBDeltaPct: number | null }): {
  result: (typeof VALUE_TRADEOFF_RESULTS)[number]; tradeoffIsNotPriorityDecision: true;
} {
  if (!(VALUE_TRADEOFF_AXES as readonly string[]).includes(input.axis) || !isFiniteNumber(input.sideADeltaPct) || !isFiniteNumber(input.sideBDeltaPct)) {
    return { result: 'insufficient_data', tradeoffIsNotPriorityDecision: true };
  }
  const a = input.sideADeltaPct;
  const b = input.sideBDeltaPct;
  const result = a >= 0 && b >= 0 ? 'favorable_tradeoff_candidate' as const
    : (a >= 5 && b <= -5) || (a <= -5 && b >= 5) ? 'conflicting_tradeoff_candidate' as const
    : Math.abs(a) < 5 && Math.abs(b) < 5 ? 'balanced_tradeoff_candidate' as const
    : 'mixed_tradeoff_candidate' as const;
  return { result, tradeoffIsNotPriorityDecision: true };
}

/* ── Value Confidence(Confidence ≠ Certainty) ──────────────────────────── */
export function evaluateValueConfidence(input: { sampleSize: number | null; dataQuality: string; attributionUnverified: boolean }): {
  confidence: number | null; confidenceIsNotCertainty: true;
} {
  if (!isFiniteNumber(input.sampleSize) || input.sampleSize <= 0) return { confidence: null, confidenceIsNotCertainty: true };
  const qualityFactor = input.dataQuality === 'verified_source_reference' ? 1
    : input.dataQuality === 'proxy_candidate' ? 0.6
    : input.dataQuality === 'manual_entry_reference' ? 0.5
    : 0.3;
  const attributionFactor = input.attributionUnverified ? 0.5 : 1;
  const sampleFactor = Math.min(1, input.sampleSize / 30);
  return { confidence: clampScore(qualityFactor * attributionFactor * sampleFactor * 100), confidenceIsNotCertainty: true };
}

/* ── Executive Value Review 검증(Self-Review 차단·Evidence 필수) ───────── */
export function validateValueReview(input: { action: string; evidenceCount: number | null; isSelfReview: boolean }): {
  allowed: boolean; blockedReasons: string[]; humanDecisionRequired: true;
} {
  const blockedReasons: string[] = [];
  if (input.action === 'record_review_reference') {
    if (input.isSelfReview) blockedReasons.push('Self-Review 차단(작성자 ≠ 평가자)');
    if (!isFiniteNumber(input.evidenceCount) || input.evidenceCount <= 0) blockedReasons.push('Evidence 없는 Value Review Reference 금지');
  }
  return { allowed: blockedReasons.length === 0, blockedReasons, humanDecisionRequired: true };
}

/* ── Value 흐름 타임라인(관측 여부 표시 — 자동 진행 아님) ──────────────── */
export const VALUE_FLOW_STAGES = [
  'enterprise_strategy', 'strategic_initiative', 'execution_outcome', 'performance_kpi',
  'business_value', 'value_attribution', 'roi_analysis', 'investment_effectiveness',
  'enterprise_value_score', 'value_tradeoff', 'executive_value_review',
  'observed_business_outcome', 'value_learning',
] as const;
export function buildValueTimeline(input: { present: Partial<Record<(typeof VALUE_FLOW_STAGES)[number], boolean>> }): {
  stage: (typeof VALUE_FLOW_STAGES)[number]; present: boolean;
}[] {
  return VALUE_FLOW_STAGES.map((stage) => ({ stage, present: input.present[stage] === true }));
}

/* ── 컴포넌트/Support Matrix(분류 6종 — §1) ────────────────────────────── */
export const ENTERPRISE_VALUE_COMPONENTS = [
  'business_value_registry', 'value_snapshot_ledger', 'value_trend_analysis',
  'value_attribution_analysis', 'roi_candidate_analysis', 'investment_effectiveness_analysis',
  'enterprise_value_score', 'value_tradeoff_cross_domain', 'executive_value_review_workflow',
  'value_event_audit',
] as const;

export type ValueSupportLevel = 'fully_supported' | 'partially_supported' | 'advisory_only' | 'human_review_only' | 'unavailable' | 'insufficient_data';
export const ENTERPRISE_VALUE_SUPPORT_MATRIX: { capability: string; support: ValueSupportLevel }[] = [
  { capability: 'business_value_model_structuring', support: 'fully_supported' },
  { capability: 'value_category_16_domains', support: 'fully_supported' },
  { capability: 'value_baseline_with_source_reference', support: 'human_review_only' },
  { capability: 'investment_reference_with_source', support: 'human_review_only' },
  { capability: 'value_snapshot_recording_null_safe', support: 'fully_supported' },
  { capability: 'value_trend_candidate_calculation', support: 'fully_supported' },
  { capability: 'value_attribution_candidate', support: 'advisory_only' },
  { capability: 'kpi_value_link_candidate_0548', support: 'partially_supported' },
  { capability: 'execution_value_link_candidate_0547', support: 'partially_supported' },
  { capability: 'roi_candidate_calculation', support: 'fully_supported' },
  { capability: 'investment_effectiveness_candidate', support: 'advisory_only' },
  { capability: 'value_confidence_candidate', support: 'partially_supported' },
  { capability: 'value_drift_candidate', support: 'advisory_only' },
  { capability: 'value_correlation_candidate', support: 'fully_supported' },
  { capability: 'cross_domain_value_divergence', support: 'fully_supported' },
  { capability: 'enterprise_value_score_candidate', support: 'advisory_only' },
  { capability: 'strategic_value_scorecard_candidate', support: 'advisory_only' },
  { capability: 'executive_value_summary_candidate', support: 'advisory_only' },
  { capability: 'value_tradeoff_analysis', support: 'advisory_only' },
  { capability: 'value_recommendation_with_evidence', support: 'advisory_only' },
  { capability: 'value_review_request', support: 'human_review_only' },
  { capability: 'executive_review_request', support: 'human_review_only' },
  { capability: 'strategy_review_request', support: 'human_review_only' },
  { capability: 'value_review_reference_no_self_review', support: 'human_review_only' },
  { capability: 'kpi_reference_link_0548', support: 'partially_supported' },
  { capability: 'initiative_reference_link_0545', support: 'partially_supported' },
  { capability: 'portfolio_reference_link_0545', support: 'partially_supported' },
  { capability: 'program_reference_link_0547', support: 'partially_supported' },
  { capability: 'decision_outcome_link_0514', support: 'partially_supported' },
  { capability: 'business_outcome_link', support: 'partially_supported' },
  { capability: 'value_learning_reference', support: 'partially_supported' },
  { capability: 'value_event_audit_trail', support: 'fully_supported' },
  { capability: 'accounting_ledger_feed', support: 'insufficient_data' },
  { capability: 'financial_statement_feed', support: 'insufficient_data' },
  { capability: 'revenue_recognition_feed', support: 'insufficient_data' },
  { capability: 'company_valuation_model', support: 'insufficient_data' },
  { capability: 'market_data_feed', support: 'insufficient_data' },
  { capability: 'investor_relations_feed', support: 'insufficient_data' },
  { capability: 'automatic_roi_approval', support: 'unavailable' },
  { capability: 'automatic_roi_confirmation', support: 'unavailable' },
  { capability: 'automatic_investment_approval', support: 'unavailable' },
  { capability: 'automatic_investment_termination', support: 'unavailable' },
  { capability: 'automatic_budget_change', support: 'unavailable' },
  { capability: 'automatic_resource_allocation', support: 'unavailable' },
  { capability: 'automatic_strategy_change', support: 'unavailable' },
  { capability: 'automatic_kpi_modification', support: 'unavailable' },
  { capability: 'automatic_portfolio_modification', support: 'unavailable' },
  { capability: 'automatic_payment', support: 'unavailable' },
  { capability: 'automatic_settlement_change', support: 'unavailable' },
  { capability: 'automatic_accounting_entry', support: 'unavailable' },
  { capability: 'automatic_company_valuation', support: 'unavailable' },
  { capability: 'automatic_ma_decision', support: 'unavailable' },
  { capability: 'automatic_investor_disclosure', support: 'unavailable' },
  { capability: 'automatic_production_change', support: 'unavailable' },
  { capability: 'automatic_deploy', support: 'unavailable' },
  { capability: 'automatic_merge', support: 'unavailable' },
];
