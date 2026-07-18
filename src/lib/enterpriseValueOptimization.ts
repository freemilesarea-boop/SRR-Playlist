// AI-OPS-55 — Enterprise Value Optimization Intelligence, Benefit
// Realization & ROI Governance Center 순수 로직.
//
// 정직성 원칙:
//  * ROI ≠ Business Success. Benefit ≠ Profit. Value ≠ Revenue.
//  * Correlation ≠ Causation. Optimization ≠ Automatic Improvement.
//  * Recommendation ≠ Decision. Forecast ≠ Future Fact.
//  * Confidence ≠ Certainty. Pattern ≠ Causality.
//  * Null → 0 변환 금지 — insufficient_data / sample_too_small 유지.
//  * 모든 함수는 deterministic / pure / null-safe.
//  * 투자 자동 승인·취소, Budget/Portfolio/KPI/Strategy 자동 변경, Project
//    자동 종료, Production 변경, Merge/Deploy/Rollback 없음.
//  * 0549(AI-OPS-45) enterpriseValue.ts 와 별개 계층(원본 무변경).

import { isFiniteNumber, clampScore } from './aiMemory';

// ── 상수(0559 SQL CHECK 와 1:1) ─────────────────────────────────────────

export const VALUE_CATEGORIES = [
  'financial', 'operational', 'strategic', 'customer', 'market', 'product',
  'portfolio', 'investment', 'executive', 'enterprise', 'custom',
] as const;
export type ValueCategory = (typeof VALUE_CATEGORIES)[number];

export const VALUE_REALIZATION_STATUSES = [
  'observed', 'candidate', 'review_reference', 'archived_reference', 'insufficient_data',
] as const;
export type ValueRealizationStatus = (typeof VALUE_REALIZATION_STATUSES)[number];

export const ROI_DIMENSIONS = [
  'financial_return', 'operational_gain', 'strategic_value', 'resource_efficiency', 'sustainability',
] as const;
export type RoiDimension = (typeof ROI_DIMENSIONS)[number];

export const ROI_RESULTS = [
  'exceptional_roi_candidate', 'strong_roi_candidate', 'acceptable_roi_candidate',
  'weak_roi_candidate', 'insufficient_data',
] as const;
export type RoiResult = (typeof ROI_RESULTS)[number];

export const BENEFIT_DIMENSIONS = [
  'planned_benefit', 'delivered_benefit', 'benefit_gap', 'kpi_achievement', 'business_outcome',
] as const;

export const BENEFIT_RESULTS = [
  'fully_realized_candidate', 'mostly_realized_candidate', 'partially_realized_candidate',
  'unrealized_candidate', 'insufficient_data',
] as const;
export type BenefitResult = (typeof BENEFIT_RESULTS)[number];

export const LEAKAGE_DIMENSIONS = [
  'budget_leakage', 'resource_leakage', 'time_leakage', 'opportunity_leakage', 'process_leakage',
] as const;
export type LeakageDimension = (typeof LEAKAGE_DIMENSIONS)[number];

export const LEAKAGE_RESULTS = [
  'critical_leakage_candidate', 'elevated_leakage_candidate', 'manageable_leakage_candidate',
  'negligible_leakage_candidate', 'insufficient_data',
] as const;
export type LeakageResult = (typeof LEAKAGE_RESULTS)[number];

export const COST_BENEFIT_RESULTS = [
  'favorable_cost_benefit_candidate', 'balanced_cost_benefit_candidate',
  'unfavorable_cost_benefit_candidate', 'cost_benefit_unverified', 'insufficient_data',
] as const;

export const INVESTMENT_EFFECTIVENESS_RESULTS = [
  'highly_effective_investment_candidate', 'effective_investment_candidate',
  'marginally_effective_investment_candidate', 'ineffective_investment_candidate',
  'investment_effectiveness_unverified', 'insufficient_data',
] as const;
export type InvestmentEffectivenessResult = (typeof INVESTMENT_EFFECTIVENESS_RESULTS)[number];

export const KPI_CONTRIBUTION_RESULTS = [
  'primary_contributor_candidate', 'supporting_contributor_candidate',
  'minimal_contribution_candidate', 'kpi_contribution_unverified', 'insufficient_data',
] as const;

export const PORTFOLIO_VALUE_RESULTS = [
  'high_value_portfolio_candidate', 'moderate_value_portfolio_candidate',
  'low_value_portfolio_candidate', 'portfolio_value_unverified', 'insufficient_data',
] as const;

export const VALUE_REVIEW_TYPES = ['value_review', 'executive_review', 'human_review'] as const;
export type ValueReviewType = (typeof VALUE_REVIEW_TYPES)[number];

export const VALUE_REVIEW_STATUSES = [
  'requested', 'in_review', 'review_reference_recorded', 'revision_requested', 'insufficient_data',
] as const;

export const VALUE_RECOMMENDATION_TYPES = [
  'create_value_realization', 'review_business_outcome', 'review_roi_assessment',
  'review_benefit_realization', 'review_cost_benefit', 'review_value_leakage',
  'review_investment_effectiveness', 'review_kpi_contribution', 'review_portfolio_value',
  'record_roi_timeline', 'record_optimization_opportunity', 'build_executive_value_summary',
  'build_executive_value_scorecard', 'request_value_review', 'request_executive_review',
  'request_human_review', 'record_value_learning', 'link_business_value_reference',
  'link_portfolio_reference', 'link_kpi_reference', 'link_capacity_reference',
  'gather_more_evidence_candidate', 'insufficient_data',
] as const;

export const VALUE_SCORECARD_FIELDS = [
  'roi', 'benefit_realization', 'value_leakage', 'investment_effectiveness',
  'portfolio_value', 'optimization_opportunities', 'executive_summary', 'human_review',
] as const;

// Vision → … → Audit 흐름(§핵심 목적) — 13단계.
export const VALUE_FLOW_STAGES = [
  'vision', 'mission', 'strategy', 'execution', 'resource_intelligence',
  'business_outcome', 'benefit_realization', 'roi_analysis', 'value_leakage_detection',
  'optimization_opportunity', 'executive_value_review', 'value_learning', 'audit',
] as const;
export type ValueFlowStage = (typeof VALUE_FLOW_STAGES)[number];

// ── ROI Assessment(§5 — 평균 기반, ROI ≠ Business Success) ──────────────

export interface RoiDimensionInput {
  dimension: string;
  score: number | null;   // 0~100 (높을수록 수익성 관측 우수) — Null 유지
}

export interface RoiAssessment {
  result: RoiResult;
  averageScore: number | null;
  evaluatedDimensions: string[];
  missingDimensions: string[];
  weakestDimension: string | null;
  roiIsNotBusinessSuccess: true;
}

/** ROI 평가 — 유효 차원 3개 미만이면 insufficient_data(Null → 0 금지). */
export function evaluateRoiAssessment(dimensions: RoiDimensionInput[] | null | undefined): RoiAssessment {
  const valid = (dimensions ?? []).filter(
    (d) => (ROI_DIMENSIONS as readonly string[]).includes(d.dimension) && isFiniteNumber(d.score),
  );
  const evaluated = valid.map((d) => d.dimension).sort((a, b) => a.localeCompare(b));
  const missing = ROI_DIMENSIONS.filter((d) => !evaluated.includes(d));
  if (valid.length < 3) {
    return { result: 'insufficient_data', averageScore: null, evaluatedDimensions: evaluated, missingDimensions: [...missing], weakestDimension: null, roiIsNotBusinessSuccess: true };
  }
  const scores = valid.map((d) => clampScore(d.score as number));
  const avg = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
  const weakest = [...valid].sort((a, b) => (clampScore(a.score as number) - clampScore(b.score as number)) || a.dimension.localeCompare(b.dimension))[0];
  let result: RoiResult;
  if (avg >= 80) result = 'exceptional_roi_candidate';
  else if (avg >= 60) result = 'strong_roi_candidate';
  else if (avg >= 35) result = 'acceptable_roi_candidate';
  else result = 'weak_roi_candidate';
  return { result, averageScore: avg, evaluatedDimensions: evaluated, missingDimensions: [...missing], weakestDimension: weakest.dimension, roiIsNotBusinessSuccess: true };
}

// ── Benefit Realization(§6 — Benefit ≠ Profit) ──────────────────────────

export interface BenefitRealizationInput {
  plannedBenefit: number | null;
  deliveredBenefit: number | null;
  sampleSize?: number | null;   // 관측 표본 수(선택) — 3 미만이면 sample_too_small
}

export interface BenefitRealization {
  result: BenefitResult;
  realizationRatio: number | null;   // delivered/planned × 100 (0~200 클램프)
  benefitGap: number | null;         // planned − delivered
  reason: 'evaluated' | 'insufficient_data' | 'sample_too_small' | 'invalid_planned_benefit';
  benefitIsNotProfit: true;
}

/** Benefit Realization — planned ≤ 0 이거나 Null 이면 판정하지 않음. */
export function evaluateBenefitRealization(input: BenefitRealizationInput | null | undefined): BenefitRealization {
  const planned = input?.plannedBenefit ?? null;
  const delivered = input?.deliveredBenefit ?? null;
  const sample = input?.sampleSize ?? null;
  if (sample !== null && isFiniteNumber(sample) && sample < 3) {
    return { result: 'insufficient_data', realizationRatio: null, benefitGap: null, reason: 'sample_too_small', benefitIsNotProfit: true };
  }
  if (!isFiniteNumber(planned) || !isFiniteNumber(delivered)) {
    return { result: 'insufficient_data', realizationRatio: null, benefitGap: null, reason: 'insufficient_data', benefitIsNotProfit: true };
  }
  if ((planned as number) <= 0) {
    return { result: 'insufficient_data', realizationRatio: null, benefitGap: null, reason: 'invalid_planned_benefit', benefitIsNotProfit: true };
  }
  const raw = ((delivered as number) / (planned as number)) * 100;
  const ratio = Math.round(Math.min(200, Math.max(0, raw)));
  const gap = (planned as number) - (delivered as number);
  let result: BenefitResult;
  if (ratio >= 90) result = 'fully_realized_candidate';
  else if (ratio >= 65) result = 'mostly_realized_candidate';
  else if (ratio >= 30) result = 'partially_realized_candidate';
  else result = 'unrealized_candidate';
  return { result, realizationRatio: ratio, benefitGap: gap, reason: 'evaluated', benefitIsNotProfit: true };
}

// ── Value Leakage(§7 — worst-of, Leakage 관측 ≠ 책임 판정) ──────────────

export interface LeakageDimensionInput {
  dimension: string;
  severity: number | null;   // 0~100 (높을수록 누수 관측 심각) — Null 유지
}

export interface ValueLeakageAnalysis {
  result: LeakageResult;
  worstSeverity: number | null;
  worstDimension: string | null;
  evaluatedDimensions: string[];
  unevaluatedDimensions: string[];
  leakageIsNotFailure: true;
}

/** Leakage 분석 — worst-of. 유효 차원 2개 미만이면 insufficient_data. */
export function analyzeValueLeakage(dimensions: LeakageDimensionInput[] | null | undefined): ValueLeakageAnalysis {
  const valid = (dimensions ?? []).filter(
    (d) => (LEAKAGE_DIMENSIONS as readonly string[]).includes(d.dimension) && isFiniteNumber(d.severity),
  );
  const evaluated = valid.map((d) => d.dimension).sort((a, b) => a.localeCompare(b));
  const unevaluated = LEAKAGE_DIMENSIONS.filter((d) => !evaluated.includes(d));
  if (valid.length < 2) {
    return { result: 'insufficient_data', worstSeverity: null, worstDimension: null, evaluatedDimensions: evaluated, unevaluatedDimensions: [...unevaluated], leakageIsNotFailure: true };
  }
  const worst = [...valid].sort((a, b) => (clampScore(b.severity as number) - clampScore(a.severity as number)) || a.dimension.localeCompare(b.dimension))[0];
  const sev = clampScore(worst.severity as number);
  let result: LeakageResult;
  if (sev >= 70) result = 'critical_leakage_candidate';
  else if (sev >= 40) result = 'elevated_leakage_candidate';
  else if (sev >= 15) result = 'manageable_leakage_candidate';
  else result = 'negligible_leakage_candidate';
  return { result, worstSeverity: sev, worstDimension: worst.dimension, evaluatedDimensions: evaluated, unevaluatedDimensions: [...unevaluated], leakageIsNotFailure: true };
}

// ── Investment Effectiveness(Effectiveness ≠ 투자 승인) ─────────────────

export interface InvestmentEffectivenessInput {
  investment: number | null;   // 투입(>0 필요)
  benefit: number | null;      // 관측 Benefit — Null 유지
}

export interface InvestmentEffectiveness {
  result: InvestmentEffectivenessResult;
  benefitToInvestmentRatio: number | null;   // 소수 둘째 자리 반올림
  effectivenessIsNotApproval: true;
}

/** 투자 대비 효과 — investment ≤ 0/Null 이면 판정하지 않음(Null → 0 금지). */
export function analyzeInvestmentEffectiveness(input: InvestmentEffectivenessInput | null | undefined): InvestmentEffectiveness {
  const investment = input?.investment ?? null;
  const benefit = input?.benefit ?? null;
  if (!isFiniteNumber(investment) || (investment as number) <= 0) {
    return { result: 'insufficient_data', benefitToInvestmentRatio: null, effectivenessIsNotApproval: true };
  }
  if (!isFiniteNumber(benefit)) {
    return { result: 'investment_effectiveness_unverified', benefitToInvestmentRatio: null, effectivenessIsNotApproval: true };
  }
  const ratio = Math.round(((benefit as number) / (investment as number)) * 100) / 100;
  let result: InvestmentEffectivenessResult;
  if (ratio >= 1.5) result = 'highly_effective_investment_candidate';
  else if (ratio >= 1.0) result = 'effective_investment_candidate';
  else if (ratio >= 0.5) result = 'marginally_effective_investment_candidate';
  else result = 'ineffective_investment_candidate';
  return { result, benefitToInvestmentRatio: ratio, effectivenessIsNotApproval: true };
}

// ── Optimization Opportunity(Optimization ≠ Automatic Improvement) ──────

export interface OpportunityCandidateInput {
  title: string;
  expectedImpact: number | null;   // 0~100 — Null 이면 unverified 로 분리
  effort: number | null;           // 0~100 — Null 이면 unverified 로 분리
  evidenceCount: number;
}

export interface RankedOpportunity {
  title: string;
  priorityScore: number;   // impact − effort
  expectedImpact: number;
  effort: number;
}

export interface OptimizationOpportunities {
  ranked: RankedOpportunity[];
  unverifiedCandidates: string[];        // impact/effort 미측정 — 순위 미부여(정직 공개)
  excludedWithoutEvidence: string[];     // Evidence 0 — 후보 제외(정직 공개)
  optimizationIsNotAutomaticImprovement: true;
}

/** 최적화 후보 정렬 — Evidence 없는 후보 제외, 미측정 후보는 순위 없이 공개. */
export function buildOptimizationOpportunities(candidates: OpportunityCandidateInput[] | null | undefined): OptimizationOpportunities {
  const excluded: string[] = [];
  const unverified: string[] = [];
  const ranked: RankedOpportunity[] = [];
  for (const c of candidates ?? []) {
    if (!c.title || c.title.trim() === '') continue;
    if (!isFiniteNumber(c.evidenceCount) || c.evidenceCount <= 0) { excluded.push(c.title); continue; }
    if (!isFiniteNumber(c.expectedImpact) || !isFiniteNumber(c.effort)) { unverified.push(c.title); continue; }
    const impact = clampScore(c.expectedImpact as number);
    const effort = clampScore(c.effort as number);
    ranked.push({ title: c.title, priorityScore: impact - effort, expectedImpact: impact, effort });
  }
  ranked.sort((a, b) => (b.priorityScore - a.priorityScore) || a.title.localeCompare(b.title));
  excluded.sort((a, b) => a.localeCompare(b));
  unverified.sort((a, b) => a.localeCompare(b));
  return { ranked, unverifiedCandidates: unverified, excludedWithoutEvidence: excluded, optimizationIsNotAutomaticImprovement: true };
}

// ── Executive Value Scorecard(§8 — Scorecard ≠ 투자 지시) ───────────────

export interface ValueScorecardInput {
  criticalLeakages: number;
  unrealizedBenefits: number;
  weakRoiRealizations: number;
  pendingHumanReviews: number;
}

export interface ExecutiveValueScorecard {
  fields: readonly string[];
  severityScore: number;
  attention: { area: string; count: number; weight: number }[];
  humanReviewRequired: true;
  scorecardIsNotInvestmentDirective: true;
}

/** Scorecard 심각도 — critical 누수 ×10 + 미실현 ×5 + weak ROI ×3 + 대기 리뷰. */
export function buildExecutiveValueScorecard(input: ValueScorecardInput | null | undefined): ExecutiveValueScorecard {
  const n = (v: number | undefined) => (isFiniteNumber(v) && (v as number) > 0 ? Math.floor(v as number) : 0);
  const critical = n(input?.criticalLeakages);
  const unrealized = n(input?.unrealizedBenefits);
  const weakRoi = n(input?.weakRoiRealizations);
  const pending = n(input?.pendingHumanReviews);
  const attention = [
    { area: 'critical_leakages', count: critical, weight: 10 },
    { area: 'unrealized_benefits', count: unrealized, weight: 5 },
    { area: 'weak_roi_realizations', count: weakRoi, weight: 3 },
    { area: 'pending_human_reviews', count: pending, weight: 1 },
  ]
    .filter((a) => a.count > 0)
    .sort((a, b) => (b.count * b.weight - a.count * a.weight) || a.area.localeCompare(b.area));
  return {
    fields: VALUE_SCORECARD_FIELDS,
    severityScore: critical * 10 + unrealized * 5 + weakRoi * 3 + pending,
    attention,
    humanReviewRequired: true,
    scorecardIsNotInvestmentDirective: true,
  };
}

// ── Review Workflow(§9 — Review ≠ Approval) ─────────────────────────────

export interface ValueReviewInput {
  reviewType: string;
  createdBy: string | null;
  reviewerId: string | null;
  evidenceCount: number;
}

export interface ValueReviewValidation {
  valid: boolean;
  reason: 'valid' | 'invalid_review_type' | 'self_review_blocked' | 'evidence_required' | 'reviewer_required';
  reviewIsNotApproval: true;
}

/** Review 검증 — 3종 외 차단, Self-Review 차단, Evidence 필수. */
export function validateValueReview(input: ValueReviewInput | null | undefined): ValueReviewValidation {
  const type = input?.reviewType ?? '';
  if (!(VALUE_REVIEW_TYPES as readonly string[]).includes(type)) {
    return { valid: false, reason: 'invalid_review_type', reviewIsNotApproval: true };
  }
  if (!input?.reviewerId) {
    return { valid: false, reason: 'reviewer_required', reviewIsNotApproval: true };
  }
  if (input.createdBy !== null && input.createdBy === input.reviewerId) {
    return { valid: false, reason: 'self_review_blocked', reviewIsNotApproval: true };
  }
  if (!isFiniteNumber(input.evidenceCount) || input.evidenceCount <= 0) {
    return { valid: false, reason: 'evidence_required', reviewIsNotApproval: true };
  }
  return { valid: true, reason: 'valid', reviewIsNotApproval: true };
}

// ── Value Timeline(Vision → Audit — 13단계) ─────────────────────────────

export interface ValueTimelineEntry {
  stage: string;
  label?: string;
}

export interface ValueTimeline {
  stages: { stage: ValueFlowStage; entries: string[] }[];
  unknownStages: string[];   // 13단계 외 — 무시하지 않고 정직 공개
}

/** 타임라인 구성 — 13단계 순서 고정, 미지 단계는 별도 공개. */
export function buildValueTimeline(entries: ValueTimelineEntry[] | null | undefined): ValueTimeline {
  const unknown: string[] = [];
  const byStage = new Map<string, string[]>();
  for (const e of entries ?? []) {
    if (!(VALUE_FLOW_STAGES as readonly string[]).includes(e.stage)) {
      if (e.stage && !unknown.includes(e.stage)) unknown.push(e.stage);
      continue;
    }
    const list = byStage.get(e.stage) ?? [];
    list.push(e.label ?? e.stage);
    byStage.set(e.stage, list);
  }
  unknown.sort((a, b) => a.localeCompare(b));
  return {
    stages: VALUE_FLOW_STAGES.map((stage) => ({ stage, entries: byStage.get(stage) ?? [] })),
    unknownStages: unknown,
  };
}

// ── Support Matrix(정직 고지 — 48항목) ──────────────────────────────────

export type ValueSupportLevel =
  | 'fully_supported'
  | 'partially_supported'
  | 'advisory_only'
  | 'human_review_only'
  | 'unavailable'
  | 'insufficient_data';

export interface ValueSupportEntry {
  feature: string;
  level: ValueSupportLevel;
  note: string;
}

export const ENTERPRISE_VALUE_OPTIMIZATION_SUPPORT_MATRIX: readonly ValueSupportEntry[] = [
  // 기록/감사 계층(서버 RPC 실존).
  { feature: 'value_realization_record', level: 'fully_supported', note: '0559 admin_enterprise_value_realization_create — 관측 기록만' },
  { feature: 'value_event_audit_log', level: 'fully_supported', note: '0559 이벤트 31종 append-only Audit' },
  { feature: 'value_review_request', level: 'fully_supported', note: '§9 3종 요청만 — Review ≠ Approval' },
  { feature: 'value_learning_record', level: 'fully_supported', note: 'Learning 기록 ≠ 자동 투자 변경' },
  { feature: 'roi_timeline_record', level: 'fully_supported', note: 'JSONB value_history append — Forecast 확정 아님' },
  { feature: 'optimization_opportunity_record', level: 'fully_supported', note: 'Evidence 필수 — Optimization ≠ Automatic Improvement' },
  { feature: 'executive_value_summary_record', level: 'fully_supported', note: 'Summary ≠ 투자 확정' },
  { feature: 'executive_value_scorecard_record', level: 'fully_supported', note: 'Scorecard ≠ 투자 지시' },
  { feature: 'value_recommendation_record', level: 'fully_supported', note: '23종 whitelist + Evidence 필수 — Recommendation ≠ Decision' },
  { feature: 'reference_linking', level: 'fully_supported', note: '0549/0545/0547/0557/0555/0548/0558/0520 실존 검증 후 참조만' },
  // 분석 계층(설명/후보 제시만).
  { feature: 'roi_assessment', level: 'advisory_only', note: '§5 5차원 — ROI ≠ Business Success' },
  { feature: 'benefit_realization_analysis', level: 'advisory_only', note: '§6 — Benefit ≠ Profit' },
  { feature: 'cost_benefit_analysis', level: 'advisory_only', note: 'Cost/Benefit ≠ 투자 결정' },
  { feature: 'value_leakage_detection', level: 'advisory_only', note: '§7 worst-of — Leakage 관측 ≠ 책임 판정' },
  { feature: 'investment_effectiveness_analysis', level: 'advisory_only', note: 'Effectiveness ≠ 투자 승인' },
  { feature: 'business_outcome_analysis', level: 'advisory_only', note: 'Value ≠ Revenue — 회계 확정 아님' },
  { feature: 'kpi_contribution_analysis', level: 'advisory_only', note: 'Correlation ≠ Causation' },
  { feature: 'portfolio_value_analysis', level: 'advisory_only', note: 'Portfolio Value ≠ Portfolio 변경' },
  { feature: 'optimization_opportunity_generation', level: 'advisory_only', note: '후보 생성만 — 실행은 사람' },
  { feature: 'value_recommendation_generation', level: 'advisory_only', note: 'Recommendation ≠ Decision' },
  { feature: 'executive_value_summary_generation', level: 'advisory_only', note: '설명 계층 — 투자 확정 아님' },
  { feature: 'value_forecast_discussion', level: 'advisory_only', note: 'Forecast ≠ Future Fact' },
  { feature: 'leakage_mitigation_suggestion', level: 'advisory_only', note: '완화 후보 제안만 — 조치는 사람' },
  // 부분 지원(수동 기록 기반 — 자동 연동 아님).
  { feature: 'kpi_actuals_integration', level: 'partially_supported', note: '0548 ai_enterprise_kpis 수동 기록 기반 참조' },
  { feature: 'financial_actuals_integration', level: 'partially_supported', note: '0549 business_values 수동 기록 기반 — 회계 원장 아님' },
  { feature: 'portfolio_actuals_integration', level: 'partially_supported', note: '0545 portfolios 수동 기록 기반 참조' },
  { feature: 'capacity_actuals_integration', level: 'partially_supported', note: '0558 capacity_resources 수동 기록 기반 참조' },
  // 사람 전용 결정.
  { feature: 'investment_decision', level: 'human_review_only', note: '투자 승인/취소는 사람' },
  { feature: 'budget_change_decision', level: 'human_review_only', note: 'Budget 변경은 사람' },
  { feature: 'portfolio_change_decision', level: 'human_review_only', note: 'Portfolio 변경은 사람' },
  { feature: 'strategy_change_decision', level: 'human_review_only', note: 'Strategy 변경은 사람' },
  // 금지(스펙 — RPC 자체 없음).
  { feature: 'automatic_investment_approval', level: 'unavailable', note: '금지 — 투자 자동 승인 없음' },
  { feature: 'automatic_investment_cancellation', level: 'unavailable', note: '금지 — 투자 자동 취소 없음' },
  { feature: 'automatic_budget_change', level: 'unavailable', note: '금지 — Budget 자동 변경 없음' },
  { feature: 'automatic_portfolio_change', level: 'unavailable', note: '금지 — Portfolio 자동 변경 없음' },
  { feature: 'automatic_kpi_change', level: 'unavailable', note: '금지 — KPI 자동 변경 없음' },
  { feature: 'automatic_strategy_change', level: 'unavailable', note: '금지 — Strategy 자동 변경 없음' },
  { feature: 'automatic_project_termination', level: 'unavailable', note: '금지 — Project 자동 종료 없음' },
  { feature: 'automatic_production_change', level: 'unavailable', note: '금지 — Production 변경 없음' },
  { feature: 'automatic_merge', level: 'unavailable', note: '금지 — Merge 없음' },
  { feature: 'automatic_deploy', level: 'unavailable', note: '금지 — Deploy 없음' },
  { feature: 'automatic_rollback', level: 'unavailable', note: '금지 — Rollback 없음' },
  // 부재 피드(실측 — 원본 없음).
  { feature: 'accounting_ledger_feed', level: 'insufficient_data', note: '회계 원장 피드 부재(실측)' },
  { feature: 'erp_finance_ledger', level: 'insufficient_data', note: 'ERP 재무 원장 부재(실측)' },
  { feature: 'billing_system_feed', level: 'insufficient_data', note: '빌링 시스템 피드 부재(실측)' },
  { feature: 'crm_revenue_feed', level: 'insufficient_data', note: 'CRM 매출 피드 부재(실측)' },
  { feature: 'cost_accounting_system', level: 'insufficient_data', note: '원가 회계 시스템 부재(실측)' },
  { feature: 'market_benchmark_feed', level: 'insufficient_data', note: '시장 벤치마크 피드 부재(실측)' },
] as const;
