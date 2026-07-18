// AI-OPS-59 — Enterprise Foresight Intelligence, Strategic Foresight &
// Long-Term Future Planning Center 순수 로직.
//
// 정직성 원칙:
//  * Weak Signal ≠ Future Fact. Trend ≠ Certainty. Scenario ≠ Prediction.
//  * Possibility ≠ Probability. Opportunity ≠ Success. Risk ≠ Outcome.
//  * Recommendation ≠ Decision. Confidence ≠ Certainty.
//  * Correlation ≠ Causation.
//  * Null → 0 변환 금지 — insufficient_data / sample_too_small 유지.
//  * 모든 함수는 deterministic / pure / null-safe.
//  * 장기 전략 자동 변경, 투자 자동 승인, 사업 자동 시작, Budget/조직 자동
//    변경, 계약 자동 체결, Production 변경, Merge/Deploy/Rollback 없음.

import { isFiniteNumber, clampScore } from './aiMemory';

// ── 상수(0563 SQL CHECK 와 1:1) ─────────────────────────────────────────

export const FORESIGHT_CATEGORIES = [
  'technology', 'market', 'society', 'regulation', 'competition', 'customer',
  'product', 'executive', 'enterprise', 'global', 'custom',
] as const;
export type ForesightCategory = (typeof FORESIGHT_CATEGORIES)[number];

export const FORESIGHT_STATUSES = [
  'observed', 'candidate', 'review_reference', 'archived_reference', 'insufficient_data',
] as const;
export type ForesightStatus = (typeof FORESIGHT_STATUSES)[number];

export const WEAK_SIGNAL_DIMENSIONS = [
  'signal_strength', 'evidence', 'consistency', 'relevance', 'strategic_importance',
] as const;

export const WEAK_SIGNAL_RESULTS = [
  'highly_significant_candidate', 'significant_candidate', 'emerging_candidate',
  'speculative_candidate', 'insufficient_data',
] as const;
export type WeakSignalResult = (typeof WEAK_SIGNAL_RESULTS)[number];

export const FUTURE_SCENARIO_DIMENSIONS = [
  'plausibility', 'strategic_impact', 'resource_readiness', 'business_alignment', 'uncertainty',
] as const;

export const FUTURE_SCENARIO_RESULTS = [
  'highly_plausible_candidate', 'plausible_candidate', 'exploratory_candidate',
  'speculative_candidate', 'insufficient_data',
] as const;
export type FutureScenarioResult = (typeof FUTURE_SCENARIO_RESULTS)[number];

export const LONG_TERM_OPPORTUNITY_DIMENSIONS = [
  'growth_potential', 'sustainability', 'strategic_value', 'competitive_advantage', 'innovation_potential',
] as const;

export const LONG_TERM_OPPORTUNITY_RESULTS = [
  'exceptional_candidate', 'strong_candidate', 'acceptable_candidate',
  'weak_candidate', 'insufficient_data',
] as const;
export type LongTermOpportunityResult = (typeof LONG_TERM_OPPORTUNITY_RESULTS)[number];

export const LONG_TERM_RISK_RESULTS = [
  'critical_future_risk_candidate', 'elevated_future_risk_candidate',
  'manageable_future_risk_candidate', 'negligible_future_risk_candidate', 'insufficient_data',
] as const;

export const STRATEGIC_OPTION_RESULTS = [
  'robust_option_candidate', 'conditional_option_candidate', 'exploratory_option_candidate',
  'option_unverified', 'insufficient_data',
] as const;

export const TREND_EVOLUTION_RESULTS = [
  'accelerating_trend_candidate', 'stable_trend_candidate', 'declining_trend_candidate',
  'trend_unverified', 'insufficient_data',
] as const;

export const SCENARIO_READINESS_RESULTS = [
  'highly_ready_candidate', 'mostly_ready_candidate', 'partially_ready_candidate',
  'not_ready_candidate', 'insufficient_data',
] as const;

export const OPPORTUNITY_HORIZON_RESULTS = [
  'near_horizon_candidate', 'mid_horizon_candidate', 'long_horizon_candidate',
  'horizon_unverified', 'insufficient_data',
] as const;

export const UNCERTAINTY_RESULTS = [
  'low_uncertainty_candidate', 'moderate_uncertainty_candidate',
  'high_uncertainty_candidate', 'critical_uncertainty_candidate', 'insufficient_data',
] as const;

export const FORESIGHT_REVIEW_TYPES = ['foresight_review', 'executive_review', 'human_review'] as const;
export type ForesightReviewType = (typeof FORESIGHT_REVIEW_TYPES)[number];

export const FORESIGHT_REVIEW_STATUSES = [
  'requested', 'in_review', 'review_reference_recorded', 'revision_requested', 'insufficient_data',
] as const;

export const FORESIGHT_RECOMMENDATION_TYPES = [
  'create_foresight_candidate', 'review_weak_signal', 'review_future_scenario',
  'review_long_term_opportunity', 'review_long_term_risk', 'record_strategic_option',
  'review_trend_evolution', 'review_scenario_readiness', 'review_opportunity_horizon',
  'review_uncertainty', 'record_foresight_timeline',
  'build_executive_foresight_summary', 'build_executive_foresight_scorecard',
  'request_foresight_review', 'request_executive_review', 'request_human_review',
  'record_foresight_learning', 'link_innovation_reference', 'link_scenario_reference',
  'link_environment_reference', 'monitor_signal_candidate',
  'gather_more_evidence_candidate', 'insufficient_data',
] as const;

export const FORESIGHT_SCORECARD_FIELDS = [
  'weak_signals', 'strategic_options', 'long_term_opportunities', 'future_risks',
  'scenario_readiness', 'recommendation', 'executive_summary', 'human_review',
] as const;

// Vision → … → Audit 흐름(§핵심 목적) — 12단계.
export const FORESIGHT_FLOW_STAGES = [
  'vision', 'mission', 'strategy', 'innovation', 'strategic_foresight',
  'weak_signal_detection', 'future_scenario_modeling', 'long_term_opportunity_analysis',
  'strategic_option_generation', 'executive_foresight_review', 'foresight_learning', 'audit',
] as const;
export type ForesightFlowStage = (typeof FORESIGHT_FLOW_STAGES)[number];

// ── Weak Signal Assessment(§5 — Weak Signal ≠ Future Fact) ──────────────

export interface WeakSignalDimensionInput {
  dimension: string;
  score: number | null;   // 0~100 (근거 강도) — Null 유지
}

export interface WeakSignalAssessment {
  result: WeakSignalResult;
  averageScore: number | null;
  weakestDimension: string | null;
  evaluatedDimensions: string[];
  missingDimensions: string[];
  weakSignalIsNotFutureFact: true;
}

/** Weak Signal 평가 — 평균 기반. 유효 차원 3개 미만이면 insufficient_data.
 *  evidence 차원 미평가 시 highly_significant 로 승격하지 않음(과단정 방지). */
export function assessWeakSignal(dimensions: WeakSignalDimensionInput[] | null | undefined): WeakSignalAssessment {
  const valid = (dimensions ?? []).filter(
    (d) => (WEAK_SIGNAL_DIMENSIONS as readonly string[]).includes(d.dimension) && isFiniteNumber(d.score),
  );
  const evaluated = valid.map((d) => d.dimension).sort((a, b) => a.localeCompare(b));
  const missing = WEAK_SIGNAL_DIMENSIONS.filter((d) => !evaluated.includes(d));
  if (valid.length < 3) {
    return { result: 'insufficient_data', averageScore: null, weakestDimension: null, evaluatedDimensions: evaluated, missingDimensions: [...missing], weakSignalIsNotFutureFact: true };
  }
  const scores = valid.map((d) => clampScore(d.score as number));
  const avg = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
  const weakest = [...valid].sort((a, b) => (clampScore(a.score as number) - clampScore(b.score as number)) || a.dimension.localeCompare(b.dimension))[0];
  const evidenceEvaluated = evaluated.includes('evidence');
  let result: WeakSignalResult;
  if (avg >= 75 && evidenceEvaluated) result = 'highly_significant_candidate';
  else if (avg >= 75) result = 'significant_candidate';   // evidence 미평가 — 승격 차단
  else if (avg >= 50) result = 'significant_candidate';
  else if (avg >= 25) result = 'emerging_candidate';
  else result = 'speculative_candidate';
  return { result, averageScore: avg, weakestDimension: weakest.dimension, evaluatedDimensions: evaluated, missingDimensions: [...missing], weakSignalIsNotFutureFact: true };
}

// ── Future Scenario Assessment(§6 — Scenario ≠ Prediction) ──────────────

export interface FutureScenarioDimensionInput {
  dimension: string;
  score: number | null;   // uncertainty 차원은 불확실성 크기(높을수록 불확실) — Null 유지
}

export interface FutureScenarioAssessment {
  result: FutureScenarioResult;
  plausibilityScore: number | null;   // uncertainty 제외 평균
  uncertaintyLevel: number | null;    // uncertainty 차원 관측값(미평가 시 null 유지)
  evaluatedDimensions: string[];
  missingDimensions: string[];
  scenarioIsNotPrediction: true;
}

/** Scenario 평가 — uncertainty 제외 차원 평균. 유효 3개 미만 insufficient_data.
 *  uncertainty ≥70 관측 시 exploratory 이상으로 승격하지 않음(과단정 방지). */
export function assessFutureScenario(dimensions: FutureScenarioDimensionInput[] | null | undefined): FutureScenarioAssessment {
  const known = (dimensions ?? []).filter((d) => (FUTURE_SCENARIO_DIMENSIONS as readonly string[]).includes(d.dimension) && isFiniteNumber(d.score));
  const evaluated = known.map((d) => d.dimension).sort((a, b) => a.localeCompare(b));
  const missing = FUTURE_SCENARIO_DIMENSIONS.filter((d) => !evaluated.includes(d));
  const plausibilityDims = known.filter((d) => d.dimension !== 'uncertainty');
  const uncertaintyDim = known.find((d) => d.dimension === 'uncertainty');
  const uncertaintyLevel = uncertaintyDim ? clampScore(uncertaintyDim.score as number) : null;
  if (plausibilityDims.length < 3) {
    return { result: 'insufficient_data', plausibilityScore: null, uncertaintyLevel, evaluatedDimensions: evaluated, missingDimensions: [...missing], scenarioIsNotPrediction: true };
  }
  const scores = plausibilityDims.map((d) => clampScore(d.score as number));
  const avg = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
  let result: FutureScenarioResult;
  if (avg >= 75) result = 'highly_plausible_candidate';
  else if (avg >= 50) result = 'plausible_candidate';
  else if (avg >= 25) result = 'exploratory_candidate';
  else result = 'speculative_candidate';
  if (uncertaintyLevel !== null && uncertaintyLevel >= 70 && (result === 'highly_plausible_candidate' || result === 'plausible_candidate')) {
    result = 'exploratory_candidate';   // 높은 불확실성 관측 — plausible 승격 차단
  }
  return { result, plausibilityScore: avg, uncertaintyLevel, evaluatedDimensions: evaluated, missingDimensions: [...missing], scenarioIsNotPrediction: true };
}

// ── Long-Term Opportunity Assessment(§7 — Opportunity ≠ Success) ────────

export interface LongTermOpportunityDimensionInput {
  dimension: string;
  score: number | null;   // 0~100 — Null 유지
}

export interface LongTermOpportunityAssessment {
  result: LongTermOpportunityResult;
  averageScore: number | null;
  strongestDimension: string | null;
  weakestDimension: string | null;
  evaluatedDimensions: string[];
  missingDimensions: string[];
  opportunityIsNotSuccess: true;
}

/** Long-Term Opportunity 평가 — 평균 기반. 유효 3개 미만 insufficient_data. */
export function assessLongTermOpportunity(dimensions: LongTermOpportunityDimensionInput[] | null | undefined): LongTermOpportunityAssessment {
  const valid = (dimensions ?? []).filter(
    (d) => (LONG_TERM_OPPORTUNITY_DIMENSIONS as readonly string[]).includes(d.dimension) && isFiniteNumber(d.score),
  );
  const evaluated = valid.map((d) => d.dimension).sort((a, b) => a.localeCompare(b));
  const missing = LONG_TERM_OPPORTUNITY_DIMENSIONS.filter((d) => !evaluated.includes(d));
  if (valid.length < 3) {
    return { result: 'insufficient_data', averageScore: null, strongestDimension: null, weakestDimension: null, evaluatedDimensions: evaluated, missingDimensions: [...missing], opportunityIsNotSuccess: true };
  }
  const scores = valid.map((d) => clampScore(d.score as number));
  const avg = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
  const sorted = [...valid].sort((a, b) => (clampScore(b.score as number) - clampScore(a.score as number)) || a.dimension.localeCompare(b.dimension));
  let result: LongTermOpportunityResult;
  if (avg >= 80) result = 'exceptional_candidate';
  else if (avg >= 60) result = 'strong_candidate';
  else if (avg >= 35) result = 'acceptable_candidate';
  else result = 'weak_candidate';
  return { result, averageScore: avg, strongestDimension: sorted[0].dimension, weakestDimension: sorted[sorted.length - 1].dimension, evaluatedDimensions: evaluated, missingDimensions: [...missing], opportunityIsNotSuccess: true };
}

// ── Strategic Option Ranking(Recommendation ≠ Decision) ─────────────────

export interface StrategicOptionInput {
  title: string;
  opportunityScore: number | null;    // 0~100 — Null 이면 unverified 로 분리
  plausibilityScore: number | null;   // 0~100
  riskScore: number | null;           // 0~100 (높을수록 위험 관측 큼)
  evidenceCount: number;
}

export interface RankedStrategicOption {
  title: string;
  priorityScore: number;   // opportunity + plausibility − risk
}

export interface StrategicOptionRanking {
  ranked: RankedStrategicOption[];
  unverifiedOptions: string[];           // 측정 불충분 — 순위 미부여(정직 공개)
  excludedWithoutEvidence: string[];     // Evidence 0 — 후보 제외(정직 공개)
  optionIsNotDecision: true;
}

/** 전략 옵션 정렬 — opportunity + plausibility − risk. Evidence 없는 옵션 제외,
 *  미측정 옵션은 순위 없이 공개. 동점은 제목순 결정적 정렬. */
export function rankStrategicOptions(options: StrategicOptionInput[] | null | undefined): StrategicOptionRanking {
  const excluded: string[] = [];
  const unverified: string[] = [];
  const ranked: RankedStrategicOption[] = [];
  for (const o of options ?? []) {
    if (!o.title || o.title.trim() === '') continue;
    if (!isFiniteNumber(o.evidenceCount) || o.evidenceCount <= 0) { excluded.push(o.title); continue; }
    if (!isFiniteNumber(o.opportunityScore) || !isFiniteNumber(o.plausibilityScore) || !isFiniteNumber(o.riskScore)) { unverified.push(o.title); continue; }
    ranked.push({
      title: o.title,
      priorityScore: clampScore(o.opportunityScore as number) + clampScore(o.plausibilityScore as number) - clampScore(o.riskScore as number),
    });
  }
  ranked.sort((a, b) => (b.priorityScore - a.priorityScore) || a.title.localeCompare(b.title));
  excluded.sort((a, b) => a.localeCompare(b));
  unverified.sort((a, b) => a.localeCompare(b));
  return { ranked, unverifiedOptions: unverified, excludedWithoutEvidence: excluded, optionIsNotDecision: true };
}

// ── Executive Foresight Scorecard(§8 — Scorecard ≠ 전략 지시) ───────────

export interface ForesightScorecardInput {
  criticalFutureRisks: number;
  speculativeSignals: number;
  weakOpportunities: number;
  pendingHumanReviews: number;
}

export interface ExecutiveForesightScorecard {
  fields: readonly string[];
  severityScore: number;
  attention: { area: string; count: number; weight: number }[];
  humanReviewRequired: true;
  scorecardIsNotStrategyDirective: true;
}

/** Scorecard 심각도 — critical future risk ×10 + speculative ×5 + weak ×3 + 대기 리뷰. */
export function buildExecutiveForesightScorecard(input: ForesightScorecardInput | null | undefined): ExecutiveForesightScorecard {
  const n = (v: number | undefined) => (isFiniteNumber(v) && (v as number) > 0 ? Math.floor(v as number) : 0);
  const critical = n(input?.criticalFutureRisks);
  const speculative = n(input?.speculativeSignals);
  const weak = n(input?.weakOpportunities);
  const pending = n(input?.pendingHumanReviews);
  const attention = [
    { area: 'critical_future_risks', count: critical, weight: 10 },
    { area: 'speculative_signals', count: speculative, weight: 5 },
    { area: 'weak_opportunities', count: weak, weight: 3 },
    { area: 'pending_human_reviews', count: pending, weight: 1 },
  ]
    .filter((a) => a.count > 0)
    .sort((a, b) => (b.count * b.weight - a.count * a.weight) || a.area.localeCompare(b.area));
  return {
    fields: FORESIGHT_SCORECARD_FIELDS,
    severityScore: critical * 10 + speculative * 5 + weak * 3 + pending,
    attention,
    humanReviewRequired: true,
    scorecardIsNotStrategyDirective: true,
  };
}

// ── Review Workflow(§9 — Review ≠ Approval) ─────────────────────────────

export interface ForesightReviewInput {
  reviewType: string;
  createdBy: string | null;
  reviewerId: string | null;
  evidenceCount: number;
}

export interface ForesightReviewValidation {
  valid: boolean;
  reason: 'valid' | 'invalid_review_type' | 'self_review_blocked' | 'evidence_required' | 'reviewer_required';
  reviewIsNotApproval: true;
}

/** Review 검증 — 3종 외 차단, Self-Review 차단, Evidence 필수. */
export function validateForesightReview(input: ForesightReviewInput | null | undefined): ForesightReviewValidation {
  const type = input?.reviewType ?? '';
  if (!(FORESIGHT_REVIEW_TYPES as readonly string[]).includes(type)) {
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

// ── Foresight Timeline(Vision → Audit — 12단계) ─────────────────────────

export interface ForesightTimelineEntry {
  stage: string;
  label?: string;
}

export interface ForesightTimeline {
  stages: { stage: ForesightFlowStage; entries: string[] }[];
  unknownStages: string[];   // 12단계 외 — 무시하지 않고 정직 공개
}

/** 타임라인 구성 — 12단계 순서 고정, 미지 단계는 별도 공개. */
export function buildForesightTimeline(entries: ForesightTimelineEntry[] | null | undefined): ForesightTimeline {
  const unknown: string[] = [];
  const byStage = new Map<string, string[]>();
  for (const e of entries ?? []) {
    if (!(FORESIGHT_FLOW_STAGES as readonly string[]).includes(e.stage)) {
      if (e.stage && !unknown.includes(e.stage)) unknown.push(e.stage);
      continue;
    }
    const list = byStage.get(e.stage) ?? [];
    list.push(e.label ?? e.stage);
    byStage.set(e.stage, list);
  }
  unknown.sort((a, b) => a.localeCompare(b));
  return {
    stages: FORESIGHT_FLOW_STAGES.map((stage) => ({ stage, entries: byStage.get(stage) ?? [] })),
    unknownStages: unknown,
  };
}

// ── Support Matrix(정직 고지 — 47항목) ──────────────────────────────────

export type ForesightSupportLevel =
  | 'fully_supported'
  | 'partially_supported'
  | 'advisory_only'
  | 'human_review_only'
  | 'unavailable'
  | 'insufficient_data';

export interface ForesightSupportEntry {
  feature: string;
  level: ForesightSupportLevel;
  note: string;
}

export const ENTERPRISE_FORESIGHT_SUPPORT_MATRIX: readonly ForesightSupportEntry[] = [
  // 기록/감사 계층(서버 RPC 실존).
  { feature: 'foresight_candidate_record', level: 'fully_supported', note: '0563 admin_enterprise_foresight_create — 관측 기록만' },
  { feature: 'foresight_event_audit_log', level: 'fully_supported', note: '0563 이벤트 31종 append-only Audit' },
  { feature: 'foresight_review_request', level: 'fully_supported', note: '§9 3종 요청만 — Review ≠ Approval' },
  { feature: 'foresight_learning_record', level: 'fully_supported', note: 'Learning 기록 ≠ 자동 전략 변경' },
  { feature: 'foresight_timeline_record', level: 'fully_supported', note: 'JSONB foresight_history append — Forecast 확정 아님' },
  { feature: 'strategic_option_record', level: 'fully_supported', note: 'Evidence 필수 — Option ≠ 전략 결정' },
  { feature: 'executive_foresight_summary_record', level: 'fully_supported', note: 'Summary ≠ 전략 확정' },
  { feature: 'executive_foresight_scorecard_record', level: 'fully_supported', note: 'Scorecard ≠ 전략 지시' },
  { feature: 'foresight_recommendation_record', level: 'fully_supported', note: '23종 whitelist + Evidence 필수 — Recommendation ≠ Decision' },
  { feature: 'reference_linking', level: 'fully_supported', note: '0549/0551/0555/0556/0557/0559/0560/0561/0562 실존 검증 후 참조만' },
  // 분석 계층(설명/후보 제시만).
  { feature: 'strategic_foresight_analysis', level: 'advisory_only', note: '가능성 탐색 — 예측 확정 아님' },
  { feature: 'weak_signal_detection', level: 'advisory_only', note: '§5 5차원 — Weak Signal ≠ Future Fact' },
  { feature: 'future_scenario_modeling', level: 'advisory_only', note: '§6 — Scenario ≠ Prediction' },
  { feature: 'opportunity_horizon_analysis', level: 'advisory_only', note: 'Horizon 관측 ≠ 시점 확정' },
  { feature: 'long_term_opportunity_analysis', level: 'advisory_only', note: '§7 — Opportunity ≠ Success' },
  { feature: 'long_term_risk_analysis', level: 'advisory_only', note: 'Risk ≠ Outcome' },
  { feature: 'strategic_option_generation', level: 'advisory_only', note: '옵션 생성만 — 선택은 사람' },
  { feature: 'trend_evolution_analysis', level: 'advisory_only', note: 'Trend ≠ Certainty' },
  { feature: 'scenario_readiness_analysis', level: 'advisory_only', note: 'Readiness ≠ Success' },
  { feature: 'uncertainty_analysis', level: 'advisory_only', note: 'Unknown 은 Unknown 으로 유지' },
  { feature: 'foresight_recommendation_generation', level: 'advisory_only', note: 'Recommendation ≠ Decision' },
  { feature: 'executive_foresight_summary_generation', level: 'advisory_only', note: '설명 계층 — 전략 확정 아님' },
  { feature: 'foresight_forecast_discussion', level: 'advisory_only', note: 'Possibility ≠ Probability' },
  // 부분 지원(수동 기록 기반 — 자동 연동 아님).
  { feature: 'innovation_actuals_integration', level: 'partially_supported', note: '0562 innovations 수동 기록 기반 참조' },
  { feature: 'environment_actuals_integration', level: 'partially_supported', note: '0556 environment_observations 수동 기록 기반 참조' },
  { feature: 'scenario_actuals_integration', level: 'partially_supported', note: '0557 decision_scenarios 수동 기록 기반 참조' },
  { feature: 'mission_actuals_integration', level: 'partially_supported', note: '0555 missions 수동 기록 기반 참조' },
  // 사람 전용 결정.
  { feature: 'long_term_strategy_decision', level: 'human_review_only', note: '장기 전략 결정은 사람' },
  { feature: 'investment_decision', level: 'human_review_only', note: '투자 승인은 사람' },
  { feature: 'business_launch_decision', level: 'human_review_only', note: '사업 시작은 사람' },
  { feature: 'organization_change_decision', level: 'human_review_only', note: '조직 변경은 사람' },
  // 금지(스펙 — RPC 자체 없음).
  { feature: 'automatic_long_term_strategy_change', level: 'unavailable', note: '금지 — 장기 전략 자동 변경 없음' },
  { feature: 'automatic_investment_approval', level: 'unavailable', note: '금지 — 투자 자동 승인 없음' },
  { feature: 'automatic_business_launch', level: 'unavailable', note: '금지 — 사업 자동 시작 없음' },
  { feature: 'automatic_budget_change', level: 'unavailable', note: '금지 — Budget 자동 변경 없음' },
  { feature: 'automatic_organization_change', level: 'unavailable', note: '금지 — 조직 자동 변경 없음' },
  { feature: 'automatic_contract_signing', level: 'unavailable', note: '금지 — 계약 자동 체결 없음' },
  { feature: 'automatic_production_change', level: 'unavailable', note: '금지 — Production 변경 없음' },
  { feature: 'automatic_merge', level: 'unavailable', note: '금지 — Merge 없음' },
  { feature: 'automatic_deploy', level: 'unavailable', note: '금지 — Deploy 없음' },
  { feature: 'automatic_rollback', level: 'unavailable', note: '금지 — Rollback 없음' },
  // 부재 피드(실측 — 원본 없음).
  { feature: 'futures_research_feed', level: 'insufficient_data', note: '미래학 연구 피드 부재(실측)' },
  { feature: 'trend_database_feed', level: 'insufficient_data', note: '트렌드 DB 피드 부재(실측)' },
  { feature: 'expert_panel_feed', level: 'insufficient_data', note: '전문가 패널 피드 부재(실측)' },
  { feature: 'horizon_scanning_tool', level: 'insufficient_data', note: '호라이즌 스캐닝 도구 부재(실측)' },
  { feature: 'macroeconomic_feed', level: 'insufficient_data', note: '거시경제 피드 부재(실측)' },
  { feature: 'foresight_platform_feed', level: 'insufficient_data', note: '포사이트 플랫폼 피드 부재(실측)' },
] as const;
