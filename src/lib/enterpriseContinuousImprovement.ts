// AI-OPS-57 — Enterprise Continuous Improvement Intelligence, Continuous
// Optimization & Operational Excellence Center 순수 로직.
//
// 정직성 원칙:
//  * Improvement ≠ Guaranteed Success. Best Practice ≠ Universal Practice.
//  * Pattern ≠ Root Cause. Correlation ≠ Causation.
//  * Recommendation ≠ Decision. Optimization ≠ Automatic Improvement.
//  * Trend ≠ Prediction. Confidence ≠ Certainty.
//  * Null → 0 변환 금지 — insufficient_data / sample_too_small 유지.
//  * 모든 함수는 deterministic / pure / null-safe.
//  * Process/Workflow/Strategy/KPI/Budget/조직 자동 변경, Production 변경,
//    Merge/Deploy/Rollback 없음.
//  * 0554(AI-OPS-50) improvement_candidates(AI 자기개선 후보 원장)와 별개 계층.

import { isFiniteNumber, clampScore } from './aiMemory';

// ── 상수(0561 SQL CHECK 와 1:1) ─────────────────────────────────────────

export const IMPROVEMENT_CATEGORIES = [
  'process', 'organization', 'technology', 'product', 'operations', 'resource',
  'governance', 'quality', 'executive', 'enterprise', 'custom',
] as const;
export type ImprovementCategory = (typeof IMPROVEMENT_CATEGORIES)[number];

export const IMPROVEMENT_STATUSES = [
  'identified', 'candidate', 'review_reference', 'archived_reference', 'insufficient_data',
] as const;
export type ImprovementStatus = (typeof IMPROVEMENT_STATUSES)[number];

export const IMPROVEMENT_DIMENSIONS = [
  'business_impact', 'operational_impact', 'cost_reduction', 'quality_improvement', 'sustainability',
] as const;

export const IMPROVEMENT_ASSESSMENT_RESULTS = [
  'exceptional_candidate', 'strong_candidate', 'acceptable_candidate',
  'weak_candidate', 'insufficient_data',
] as const;
export type ImprovementAssessmentResult = (typeof IMPROVEMENT_ASSESSMENT_RESULTS)[number];

export const ROOT_CAUSE_DIMENSIONS = [
  'evidence', 'frequency', 'severity', 'scope', 'confidence',
] as const;

export const ROOT_CAUSE_RESULTS = [
  'highly_supported_candidate', 'moderately_supported_candidate',
  'weakly_supported_candidate', 'speculative_candidate', 'insufficient_data',
] as const;
export type RootCauseResult = (typeof ROOT_CAUSE_RESULTS)[number];

export const EXCELLENCE_DIMENSIONS = [
  'process_stability', 'quality_consistency', 'resource_efficiency',
  'continuous_learning', 'improvement_adoption',
] as const;

export const EXCELLENCE_RESULTS = [
  'excellence_candidate', 'mature_candidate', 'developing_candidate',
  'immature_candidate', 'insufficient_data',
] as const;
export type ExcellenceResult = (typeof EXCELLENCE_RESULTS)[number];

export const IMPROVEMENT_TREND_RESULTS = [
  'improving_trend_candidate', 'stable_trend_candidate', 'deteriorating_trend_candidate',
  'trend_unverified', 'insufficient_data',
] as const;
export type ImprovementTrendResult = (typeof IMPROVEMENT_TREND_RESULTS)[number];

export const PROCESS_EFFICIENCY_RESULTS = [
  'efficient_process_candidate', 'acceptable_efficiency_candidate',
  'inefficient_process_candidate', 'efficiency_unverified', 'insufficient_data',
] as const;

export const BEST_PRACTICE_RESULTS = [
  'proven_practice_candidate', 'promising_practice_candidate',
  'context_specific_candidate', 'practice_unverified', 'insufficient_data',
] as const;

export const RECURRENCE_RESULTS = [
  'frequent_recurrence_candidate', 'occasional_recurrence_candidate',
  'isolated_incident_candidate', 'recurrence_unverified', 'insufficient_data',
] as const;

export const IMPROVEMENT_PRIORITY_RESULTS = [
  'high_priority_candidate', 'medium_priority_candidate', 'low_priority_candidate',
  'priority_unverified', 'insufficient_data',
] as const;

export const IMPROVEMENT_REVIEW_TYPES = ['improvement_review', 'executive_review', 'human_review'] as const;
export type ImprovementReviewType = (typeof IMPROVEMENT_REVIEW_TYPES)[number];

export const IMPROVEMENT_REVIEW_STATUSES = [
  'requested', 'in_review', 'review_reference_recorded', 'revision_requested', 'insufficient_data',
] as const;

export const IMPROVEMENT_RECOMMENDATION_TYPES = [
  'create_improvement_candidate', 'record_continuous_observation', 'review_improvement_opportunity',
  'review_root_cause', 'review_trend_analysis', 'review_process_efficiency',
  'review_operational_excellence', 'review_best_practice', 'review_recurrence_pattern',
  'review_improvement_priority', 'record_improvement_timeline',
  'build_executive_improvement_summary', 'build_executive_improvement_scorecard',
  'request_improvement_review', 'request_executive_review', 'request_human_review',
  'record_continuous_learning', 'link_transformation_reference', 'link_value_reference',
  'link_capacity_reference', 'spread_best_practice_review_candidate',
  'gather_more_evidence_candidate', 'insufficient_data',
] as const;

export const IMPROVEMENT_SCORECARD_FIELDS = [
  'improvement_priority', 'root_cause_confidence', 'business_impact', 'operational_excellence',
  'best_practice', 'recommendation', 'executive_summary', 'human_review',
] as const;

// Vision → … → Audit 흐름(§핵심 목적) — 13단계.
export const IMPROVEMENT_FLOW_STAGES = [
  'vision', 'mission', 'strategy', 'execution', 'transformation',
  'continuous_observation', 'improvement_opportunity_detection', 'root_cause_review',
  'continuous_optimization', 'operational_excellence', 'executive_improvement_review',
  'continuous_learning', 'audit',
] as const;
export type ImprovementFlowStage = (typeof IMPROVEMENT_FLOW_STAGES)[number];

// ── Improvement Assessment(§5 — 평균, Improvement ≠ Guaranteed Success) ─

export interface ImprovementDimensionInput {
  dimension: string;
  score: number | null;   // 0~100 — Null 유지
}

export interface ImprovementAssessment {
  result: ImprovementAssessmentResult;
  averageScore: number | null;
  strongestDimension: string | null;
  weakestDimension: string | null;
  evaluatedDimensions: string[];
  missingDimensions: string[];
  improvementIsNotGuaranteedSuccess: true;
}

/** Improvement 평가 — 평균 기반. 유효 차원 3개 미만이면 insufficient_data. */
export function evaluateImprovementAssessment(dimensions: ImprovementDimensionInput[] | null | undefined): ImprovementAssessment {
  const valid = (dimensions ?? []).filter(
    (d) => (IMPROVEMENT_DIMENSIONS as readonly string[]).includes(d.dimension) && isFiniteNumber(d.score),
  );
  const evaluated = valid.map((d) => d.dimension).sort((a, b) => a.localeCompare(b));
  const missing = IMPROVEMENT_DIMENSIONS.filter((d) => !evaluated.includes(d));
  if (valid.length < 3) {
    return { result: 'insufficient_data', averageScore: null, strongestDimension: null, weakestDimension: null, evaluatedDimensions: evaluated, missingDimensions: [...missing], improvementIsNotGuaranteedSuccess: true };
  }
  const scores = valid.map((d) => clampScore(d.score as number));
  const avg = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
  const sorted = [...valid].sort((a, b) => (clampScore(b.score as number) - clampScore(a.score as number)) || a.dimension.localeCompare(b.dimension));
  let result: ImprovementAssessmentResult;
  if (avg >= 80) result = 'exceptional_candidate';
  else if (avg >= 60) result = 'strong_candidate';
  else if (avg >= 35) result = 'acceptable_candidate';
  else result = 'weak_candidate';
  return { result, averageScore: avg, strongestDimension: sorted[0].dimension, weakestDimension: sorted[sorted.length - 1].dimension, evaluatedDimensions: evaluated, missingDimensions: [...missing], improvementIsNotGuaranteedSuccess: true };
}

// ── Root Cause Review(§6 — Pattern ≠ Root Cause) ────────────────────────

export interface RootCauseDimensionInput {
  dimension: string;
  score: number | null;   // 0~100 (근거 강도) — Null 유지
}

export interface RootCauseReview {
  result: RootCauseResult;
  averageSupport: number | null;
  weakestDimension: string | null;
  evaluatedDimensions: string[];
  missingDimensions: string[];
  patternIsNotRootCause: true;
}

/** Root Cause 검토 — 근거 평균. 유효 차원 3개 미만이면 insufficient_data.
 *  evidence 차원 미평가 시 highly_supported 로 승격하지 않음(과단정 방지). */
export function reviewRootCause(dimensions: RootCauseDimensionInput[] | null | undefined): RootCauseReview {
  const valid = (dimensions ?? []).filter(
    (d) => (ROOT_CAUSE_DIMENSIONS as readonly string[]).includes(d.dimension) && isFiniteNumber(d.score),
  );
  const evaluated = valid.map((d) => d.dimension).sort((a, b) => a.localeCompare(b));
  const missing = ROOT_CAUSE_DIMENSIONS.filter((d) => !evaluated.includes(d));
  if (valid.length < 3) {
    return { result: 'insufficient_data', averageSupport: null, weakestDimension: null, evaluatedDimensions: evaluated, missingDimensions: [...missing], patternIsNotRootCause: true };
  }
  const scores = valid.map((d) => clampScore(d.score as number));
  const avg = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
  const weakest = [...valid].sort((a, b) => (clampScore(a.score as number) - clampScore(b.score as number)) || a.dimension.localeCompare(b.dimension))[0];
  const evidenceEvaluated = evaluated.includes('evidence');
  let result: RootCauseResult;
  if (avg >= 75 && evidenceEvaluated) result = 'highly_supported_candidate';
  else if (avg >= 75) result = 'moderately_supported_candidate';   // evidence 미평가 — 승격 차단
  else if (avg >= 50) result = 'moderately_supported_candidate';
  else if (avg >= 25) result = 'weakly_supported_candidate';
  else result = 'speculative_candidate';
  return { result, averageSupport: avg, weakestDimension: weakest.dimension, evaluatedDimensions: evaluated, missingDimensions: [...missing], patternIsNotRootCause: true };
}

// ── Operational Excellence(§7 — Excellence 관측 후보 ≠ 조직 평가) ───────

export interface ExcellenceDimensionInput {
  dimension: string;
  score: number | null;   // 0~100 — Null 유지
}

export interface OperationalExcellenceAssessment {
  result: ExcellenceResult;
  averageScore: number | null;
  weakestDimension: string | null;
  evaluatedDimensions: string[];
  missingDimensions: string[];
  excellenceIsNotOrganizationRating: true;
}

/** Operational Excellence 평가 — 평균 기반. 유효 3개 미만 insufficient_data. */
export function evaluateOperationalExcellence(dimensions: ExcellenceDimensionInput[] | null | undefined): OperationalExcellenceAssessment {
  const valid = (dimensions ?? []).filter(
    (d) => (EXCELLENCE_DIMENSIONS as readonly string[]).includes(d.dimension) && isFiniteNumber(d.score),
  );
  const evaluated = valid.map((d) => d.dimension).sort((a, b) => a.localeCompare(b));
  const missing = EXCELLENCE_DIMENSIONS.filter((d) => !evaluated.includes(d));
  if (valid.length < 3) {
    return { result: 'insufficient_data', averageScore: null, weakestDimension: null, evaluatedDimensions: evaluated, missingDimensions: [...missing], excellenceIsNotOrganizationRating: true };
  }
  const scores = valid.map((d) => clampScore(d.score as number));
  const avg = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
  const weakest = [...valid].sort((a, b) => (clampScore(a.score as number) - clampScore(b.score as number)) || a.dimension.localeCompare(b.dimension))[0];
  let result: ExcellenceResult;
  if (avg >= 80) result = 'excellence_candidate';
  else if (avg >= 60) result = 'mature_candidate';
  else if (avg >= 40) result = 'developing_candidate';
  else result = 'immature_candidate';
  return { result, averageScore: avg, weakestDimension: weakest.dimension, evaluatedDimensions: evaluated, missingDimensions: [...missing], excellenceIsNotOrganizationRating: true };
}

// ── Trend Analysis(Trend ≠ Prediction) ──────────────────────────────────

export interface TrendAnalysis {
  result: ImprovementTrendResult;
  delta: number | null;   // 후반 평균 − 전반 평균(반올림)
  sampleCount: number;
  reason: 'evaluated' | 'sample_too_small';
  trendIsNotPrediction: true;
}

/** 관측 시계열 추세 — 전/후반 평균 비교. 유효 표본 4개 미만이면
 *  sample_too_small(Null 은 표본에서 제외 — 0 치환 금지). */
export function analyzeTrend(series: (number | null)[] | null | undefined): TrendAnalysis {
  const valid = (series ?? []).filter((v): v is number => isFiniteNumber(v));
  if (valid.length < 4) {
    return { result: 'insufficient_data', delta: null, sampleCount: valid.length, reason: 'sample_too_small', trendIsNotPrediction: true };
  }
  const half = Math.floor(valid.length / 2);
  const first = valid.slice(0, half);
  const second = valid.slice(valid.length - half);
  const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
  const delta = Math.round(avg(second) - avg(first));
  let result: ImprovementTrendResult;
  if (delta >= 5) result = 'improving_trend_candidate';
  else if (delta <= -5) result = 'deteriorating_trend_candidate';
  else result = 'stable_trend_candidate';
  return { result, delta, sampleCount: valid.length, reason: 'evaluated', trendIsNotPrediction: true };
}

// ── Improvement Priority(Priority ≠ Mandatory Order) ────────────────────

export interface ImprovementCandidateInput {
  title: string;
  expectedImpact: number | null;    // 0~100 — Null 이면 unverified 로 분리
  effort: number | null;            // 0~100
  recurrence: number | null;        // 0~100 (반복 발생 관측 강도)
  evidenceCount: number;
}

export interface RankedImprovement {
  title: string;
  priorityScore: number;   // impact + recurrence − effort
}

export interface ImprovementPriorityRanking {
  ranked: RankedImprovement[];
  unverifiedCandidates: string[];        // 측정 불충분 — 순위 미부여(정직 공개)
  excludedWithoutEvidence: string[];     // Evidence 0 — 후보 제외(정직 공개)
  priorityIsNotMandatoryOrder: true;
}

/** 개선 우선순위 — impact + recurrence − effort. Evidence 없는 후보 제외,
 *  미측정 후보는 순위 없이 공개. 동점은 제목순 결정적 정렬. */
export function rankImprovementPriority(candidates: ImprovementCandidateInput[] | null | undefined): ImprovementPriorityRanking {
  const excluded: string[] = [];
  const unverified: string[] = [];
  const ranked: RankedImprovement[] = [];
  for (const c of candidates ?? []) {
    if (!c.title || c.title.trim() === '') continue;
    if (!isFiniteNumber(c.evidenceCount) || c.evidenceCount <= 0) { excluded.push(c.title); continue; }
    if (!isFiniteNumber(c.expectedImpact) || !isFiniteNumber(c.effort) || !isFiniteNumber(c.recurrence)) { unverified.push(c.title); continue; }
    ranked.push({
      title: c.title,
      priorityScore: clampScore(c.expectedImpact as number) + clampScore(c.recurrence as number) - clampScore(c.effort as number),
    });
  }
  ranked.sort((a, b) => (b.priorityScore - a.priorityScore) || a.title.localeCompare(b.title));
  excluded.sort((a, b) => a.localeCompare(b));
  unverified.sort((a, b) => a.localeCompare(b));
  return { ranked, unverifiedCandidates: unverified, excludedWithoutEvidence: excluded, priorityIsNotMandatoryOrder: true };
}

// ── Executive Improvement Scorecard(§8 — Scorecard ≠ 개선 지시) ─────────

export interface ImprovementScorecardInput {
  speculativeRootCauses: number;
  weakImprovements: number;
  immatureExcellenceAreas: number;
  pendingHumanReviews: number;
}

export interface ExecutiveImprovementScorecard {
  fields: readonly string[];
  severityScore: number;
  attention: { area: string; count: number; weight: number }[];
  humanReviewRequired: true;
  scorecardIsNotImprovementDirective: true;
}

/** Scorecard 심각도 — speculative ×10 + weak ×5 + immature ×3 + 대기 리뷰. */
export function buildExecutiveImprovementScorecard(input: ImprovementScorecardInput | null | undefined): ExecutiveImprovementScorecard {
  const n = (v: number | undefined) => (isFiniteNumber(v) && (v as number) > 0 ? Math.floor(v as number) : 0);
  const speculative = n(input?.speculativeRootCauses);
  const weak = n(input?.weakImprovements);
  const immature = n(input?.immatureExcellenceAreas);
  const pending = n(input?.pendingHumanReviews);
  const attention = [
    { area: 'speculative_root_causes', count: speculative, weight: 10 },
    { area: 'weak_improvements', count: weak, weight: 5 },
    { area: 'immature_excellence_areas', count: immature, weight: 3 },
    { area: 'pending_human_reviews', count: pending, weight: 1 },
  ]
    .filter((a) => a.count > 0)
    .sort((a, b) => (b.count * b.weight - a.count * a.weight) || a.area.localeCompare(b.area));
  return {
    fields: IMPROVEMENT_SCORECARD_FIELDS,
    severityScore: speculative * 10 + weak * 5 + immature * 3 + pending,
    attention,
    humanReviewRequired: true,
    scorecardIsNotImprovementDirective: true,
  };
}

// ── Review Workflow(§9 — Review ≠ Approval) ─────────────────────────────

export interface ImprovementReviewInput {
  reviewType: string;
  createdBy: string | null;
  reviewerId: string | null;
  evidenceCount: number;
}

export interface ImprovementReviewValidation {
  valid: boolean;
  reason: 'valid' | 'invalid_review_type' | 'self_review_blocked' | 'evidence_required' | 'reviewer_required';
  reviewIsNotApproval: true;
}

/** Review 검증 — 3종 외 차단, Self-Review 차단, Evidence 필수. */
export function validateImprovementReview(input: ImprovementReviewInput | null | undefined): ImprovementReviewValidation {
  const type = input?.reviewType ?? '';
  if (!(IMPROVEMENT_REVIEW_TYPES as readonly string[]).includes(type)) {
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

// ── Improvement Timeline(Vision → Audit — 13단계) ───────────────────────

export interface ImprovementTimelineEntry {
  stage: string;
  label?: string;
}

export interface ImprovementTimeline {
  stages: { stage: ImprovementFlowStage; entries: string[] }[];
  unknownStages: string[];   // 13단계 외 — 무시하지 않고 정직 공개
}

/** 타임라인 구성 — 13단계 순서 고정, 미지 단계는 별도 공개. */
export function buildImprovementTimeline(entries: ImprovementTimelineEntry[] | null | undefined): ImprovementTimeline {
  const unknown: string[] = [];
  const byStage = new Map<string, string[]>();
  for (const e of entries ?? []) {
    if (!(IMPROVEMENT_FLOW_STAGES as readonly string[]).includes(e.stage)) {
      if (e.stage && !unknown.includes(e.stage)) unknown.push(e.stage);
      continue;
    }
    const list = byStage.get(e.stage) ?? [];
    list.push(e.label ?? e.stage);
    byStage.set(e.stage, list);
  }
  unknown.sort((a, b) => a.localeCompare(b));
  return {
    stages: IMPROVEMENT_FLOW_STAGES.map((stage) => ({ stage, entries: byStage.get(stage) ?? [] })),
    unknownStages: unknown,
  };
}

// ── Support Matrix(정직 고지 — 47항목) ──────────────────────────────────

export type ImprovementSupportLevel =
  | 'fully_supported'
  | 'partially_supported'
  | 'advisory_only'
  | 'human_review_only'
  | 'unavailable'
  | 'insufficient_data';

export interface ImprovementSupportEntry {
  feature: string;
  level: ImprovementSupportLevel;
  note: string;
}

export const ENTERPRISE_CONTINUOUS_IMPROVEMENT_SUPPORT_MATRIX: readonly ImprovementSupportEntry[] = [
  // 기록/감사 계층(서버 RPC 실존).
  { feature: 'improvement_candidate_record', level: 'fully_supported', note: '0561 admin_enterprise_improvement_create — 관측 기록만' },
  { feature: 'improvement_event_audit_log', level: 'fully_supported', note: '0561 이벤트 31종 append-only Audit' },
  { feature: 'improvement_review_request', level: 'fully_supported', note: '§9 3종 요청만 — Review ≠ Approval' },
  { feature: 'continuous_learning_record', level: 'fully_supported', note: 'Learning 기록 ≠ 자동 프로세스 변경' },
  { feature: 'improvement_timeline_record', level: 'fully_supported', note: 'JSONB improvement_history append — Forecast 확정 아님' },
  { feature: 'continuous_observation_record', level: 'fully_supported', note: '관측 기록 ≠ 문제 확정' },
  { feature: 'executive_improvement_summary_record', level: 'fully_supported', note: 'Summary ≠ 개선 적용 확정' },
  { feature: 'executive_improvement_scorecard_record', level: 'fully_supported', note: 'Scorecard ≠ 개선 지시' },
  { feature: 'improvement_recommendation_record', level: 'fully_supported', note: '23종 whitelist + Evidence 필수 — Recommendation ≠ Decision' },
  { feature: 'reference_linking', level: 'fully_supported', note: '0547/0549/0551/0555/0557/0558/0559/0560 실존 검증 후 참조만' },
  // 분석 계층(설명/후보 제시만).
  { feature: 'improvement_opportunity_detection', level: 'advisory_only', note: '§5 5차원 — Improvement ≠ Guaranteed Success' },
  { feature: 'root_cause_review', level: 'advisory_only', note: '§6 — Pattern ≠ Root Cause' },
  { feature: 'operational_excellence_analysis', level: 'advisory_only', note: '§7 — Excellence 관측 후보 ≠ 조직 평가' },
  { feature: 'trend_analysis', level: 'advisory_only', note: 'Trend ≠ Prediction' },
  { feature: 'process_efficiency_analysis', level: 'advisory_only', note: 'Efficiency 관측 ≠ 프로세스 변경' },
  { feature: 'best_practice_detection', level: 'advisory_only', note: 'Best Practice ≠ Universal Practice — Evidence 필수' },
  { feature: 'recurrence_pattern_analysis', level: 'advisory_only', note: 'Correlation ≠ Causation' },
  { feature: 'improvement_priority_analysis', level: 'advisory_only', note: 'Priority ≠ Mandatory Order' },
  { feature: 'improvement_recommendation_generation', level: 'advisory_only', note: 'Recommendation ≠ Decision' },
  { feature: 'executive_improvement_summary_generation', level: 'advisory_only', note: '설명 계층 — 개선 적용 확정 아님' },
  { feature: 'best_practice_spread_suggestion', level: 'advisory_only', note: '확산 후보 제안만 — 확산 결정은 사람' },
  { feature: 'improvement_forecast_discussion', level: 'advisory_only', note: 'Forecast ≠ Future Fact' },
  { feature: 'waste_pattern_discussion', level: 'advisory_only', note: '낭비 관측 후보 — 책임 판정 아님' },
  // 부분 지원(수동 기록 기반 — 자동 연동 아님).
  { feature: 'transformation_actuals_integration', level: 'partially_supported', note: '0560 transformations 수동 기록 기반 참조' },
  { feature: 'value_actuals_integration', level: 'partially_supported', note: '0559 value_realizations 수동 기록 기반 참조' },
  { feature: 'capacity_actuals_integration', level: 'partially_supported', note: '0558 capacity_resources 수동 기록 기반 참조' },
  { feature: 'execution_actuals_integration', level: 'partially_supported', note: '0547 execution_programs 수동 기록 기반 참조' },
  // 사람 전용 결정.
  { feature: 'improvement_apply_decision', level: 'human_review_only', note: '개선 적용은 사람' },
  { feature: 'process_change_decision', level: 'human_review_only', note: 'Process 변경은 사람' },
  { feature: 'best_practice_spread_decision', level: 'human_review_only', note: 'Best Practice 확산은 사람' },
  { feature: 'kpi_change_decision', level: 'human_review_only', note: 'KPI 변경은 사람' },
  // 금지(스펙 — RPC 자체 없음).
  { feature: 'automatic_process_change', level: 'unavailable', note: '금지 — Process 자동 변경 없음' },
  { feature: 'automatic_workflow_change', level: 'unavailable', note: '금지 — Workflow 자동 변경 없음' },
  { feature: 'automatic_strategy_change', level: 'unavailable', note: '금지 — Strategy 자동 변경 없음' },
  { feature: 'automatic_kpi_change', level: 'unavailable', note: '금지 — KPI 자동 변경 없음' },
  { feature: 'automatic_budget_change', level: 'unavailable', note: '금지 — Budget 자동 변경 없음' },
  { feature: 'automatic_organization_change', level: 'unavailable', note: '금지 — 조직 자동 변경 없음' },
  { feature: 'automatic_production_change', level: 'unavailable', note: '금지 — Production 변경 없음' },
  { feature: 'automatic_merge', level: 'unavailable', note: '금지 — Merge 없음' },
  { feature: 'automatic_deploy', level: 'unavailable', note: '금지 — Deploy 없음' },
  { feature: 'automatic_rollback', level: 'unavailable', note: '금지 — Rollback 없음' },
  // 부재 피드(실측 — 원본 없음).
  { feature: 'process_mining_tool', level: 'insufficient_data', note: '프로세스 마이닝 도구 부재(실측)' },
  { feature: 'incident_management_feed', level: 'insufficient_data', note: '인시던트 관리 피드 부재(실측)' },
  { feature: 'quality_management_system', level: 'insufficient_data', note: '품질 관리 시스템 부재(실측)' },
  { feature: 'workflow_analytics_feed', level: 'insufficient_data', note: '워크플로 분석 피드 부재(실측)' },
  { feature: 'ticketing_system_feed', level: 'insufficient_data', note: '티켓팅 시스템 피드 부재(실측)' },
  { feature: 'ops_metrics_warehouse', level: 'insufficient_data', note: '운영 메트릭 웨어하우스 부재(실측)' },
] as const;
