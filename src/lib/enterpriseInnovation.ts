// AI-OPS-58 — Enterprise Innovation Intelligence, Innovation Portfolio &
// Future Opportunity Center 순수 로직.
//
// 정직성 원칙:
//  * Opportunity ≠ Guaranteed Success. Innovation ≠ Business Success.
//  * Potential ≠ Outcome. Forecast ≠ Future Fact.
//  * Correlation ≠ Causation. Recommendation ≠ Decision.
//  * Priority ≠ Mandatory Order. Confidence ≠ Certainty.
//  * Null → 0 변환 금지 — insufficient_data / sample_too_small 유지.
//  * 모든 함수는 deterministic / pure / null-safe.
//  * 신규 사업 자동 시작, 제품 자동 출시, 투자 자동 승인, Budget/조직/전략
//    자동 변경, 계약 자동 체결, Production 변경, Merge/Deploy/Rollback 없음.

import { isFiniteNumber, clampScore } from './aiMemory';

// ── 상수(0562 SQL CHECK 와 1:1) ─────────────────────────────────────────

export const INNOVATION_CATEGORIES = [
  'technology', 'product', 'service', 'platform', 'market', 'business_model',
  'process', 'organization', 'executive', 'enterprise', 'custom',
] as const;
export type InnovationCategory = (typeof INNOVATION_CATEGORIES)[number];

export const INNOVATION_STATUSES = [
  'discovered', 'candidate', 'review_reference', 'archived_reference', 'insufficient_data',
] as const;
export type InnovationStatus = (typeof INNOVATION_STATUSES)[number];

export const OPPORTUNITY_DIMENSIONS = [
  'strategic_value', 'market_potential', 'technical_feasibility',
  'resource_availability', 'innovation_readiness',
] as const;

export const OPPORTUNITY_RESULTS = [
  'exceptional_candidate', 'strong_candidate', 'acceptable_candidate',
  'weak_candidate', 'insufficient_data',
] as const;
export type OpportunityResult = (typeof OPPORTUNITY_RESULTS)[number];

export const INNOVATION_RISK_DIMENSIONS = [
  'technology_risk', 'market_risk', 'resource_risk', 'execution_risk', 'governance_risk',
] as const;

export const INNOVATION_RISK_RESULTS = [
  'low_risk_candidate', 'manageable_risk_candidate', 'elevated_risk_candidate',
  'critical_risk_candidate', 'insufficient_data',
] as const;
export type InnovationRiskResult = (typeof INNOVATION_RISK_RESULTS)[number];

export const INNOVATION_PORTFOLIO_DIMENSIONS = [
  'portfolio_balance', 'strategic_alignment', 'investment_diversity',
  'innovation_coverage', 'long_term_sustainability',
] as const;

export const INNOVATION_PORTFOLIO_RESULTS = [
  'highly_balanced_candidate', 'balanced_candidate', 'partially_balanced_candidate',
  'imbalanced_candidate', 'insufficient_data',
] as const;
export type InnovationPortfolioResult = (typeof INNOVATION_PORTFOLIO_RESULTS)[number];

export const INNOVATION_READINESS_RESULTS = [
  'highly_ready_candidate', 'mostly_ready_candidate', 'partially_ready_candidate',
  'not_ready_candidate', 'insufficient_data',
] as const;

export const FUTURE_OPPORTUNITY_RESULTS = [
  'high_potential_candidate', 'moderate_potential_candidate', 'low_potential_candidate',
  'potential_unverified', 'insufficient_data',
] as const;

export const TECHNOLOGY_OPPORTUNITY_RESULTS = [
  'strategic_technology_candidate', 'emerging_technology_candidate',
  'commodity_technology_candidate', 'technology_unverified', 'insufficient_data',
] as const;

export const MARKET_POTENTIAL_RESULTS = [
  'large_market_candidate', 'niche_market_candidate', 'saturated_market_candidate',
  'market_unverified', 'insufficient_data',
] as const;

export const INNOVATION_ALIGNMENT_RESULTS = [
  'strongly_aligned_candidate', 'partially_aligned_candidate', 'misaligned_candidate',
  'alignment_unverified', 'insufficient_data',
] as const;

export const INNOVATION_PRIORITY_RESULTS = [
  'high_priority_candidate', 'medium_priority_candidate', 'low_priority_candidate',
  'priority_unverified', 'insufficient_data',
] as const;

export const INNOVATION_REVIEW_TYPES = ['innovation_review', 'executive_review', 'human_review'] as const;
export type InnovationReviewType = (typeof INNOVATION_REVIEW_TYPES)[number];

export const INNOVATION_REVIEW_STATUSES = [
  'requested', 'in_review', 'review_reference_recorded', 'revision_requested', 'insufficient_data',
] as const;

export const INNOVATION_RECOMMENDATION_TYPES = [
  'create_innovation_candidate', 'review_innovation_opportunity', 'review_innovation_risk',
  'review_innovation_portfolio', 'review_innovation_readiness', 'review_future_opportunity',
  'review_technology_opportunity', 'review_market_potential', 'review_mission_alignment',
  'review_innovation_priority', 'record_innovation_timeline',
  'build_executive_innovation_summary', 'build_executive_innovation_scorecard',
  'request_innovation_review', 'request_executive_review', 'request_human_review',
  'record_innovation_learning', 'link_improvement_reference', 'link_transformation_reference',
  'link_scenario_reference', 'pilot_review_candidate',
  'gather_more_evidence_candidate', 'insufficient_data',
] as const;

export const INNOVATION_SCORECARD_FIELDS = [
  'innovation_priority', 'opportunity_score', 'innovation_risk', 'portfolio_balance',
  'readiness', 'recommendation', 'executive_summary', 'human_review',
] as const;

// Vision → … → Audit 흐름(§핵심 목적) — 13단계.
export const INNOVATION_FLOW_STAGES = [
  'vision', 'mission', 'strategy', 'execution', 'continuous_improvement',
  'innovation_opportunity_detection', 'innovation_portfolio', 'innovation_readiness',
  'future_opportunity_analysis', 'innovation_prioritization', 'executive_innovation_review',
  'innovation_learning', 'audit',
] as const;
export type InnovationFlowStage = (typeof INNOVATION_FLOW_STAGES)[number];

// ── Innovation Opportunity(§5 — 평균, Opportunity ≠ Guaranteed Success) ─

export interface OpportunityDimensionInput {
  dimension: string;
  score: number | null;   // 0~100 — Null 유지
}

export interface InnovationOpportunityAssessment {
  result: OpportunityResult;
  averageScore: number | null;
  strongestDimension: string | null;
  weakestDimension: string | null;
  evaluatedDimensions: string[];
  missingDimensions: string[];
  opportunityIsNotGuaranteedSuccess: true;
}

/** Opportunity 평가 — 평균 기반. 유효 차원 3개 미만이면 insufficient_data. */
export function evaluateInnovationOpportunity(dimensions: OpportunityDimensionInput[] | null | undefined): InnovationOpportunityAssessment {
  const valid = (dimensions ?? []).filter(
    (d) => (OPPORTUNITY_DIMENSIONS as readonly string[]).includes(d.dimension) && isFiniteNumber(d.score),
  );
  const evaluated = valid.map((d) => d.dimension).sort((a, b) => a.localeCompare(b));
  const missing = OPPORTUNITY_DIMENSIONS.filter((d) => !evaluated.includes(d));
  if (valid.length < 3) {
    return { result: 'insufficient_data', averageScore: null, strongestDimension: null, weakestDimension: null, evaluatedDimensions: evaluated, missingDimensions: [...missing], opportunityIsNotGuaranteedSuccess: true };
  }
  const scores = valid.map((d) => clampScore(d.score as number));
  const avg = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
  const sorted = [...valid].sort((a, b) => (clampScore(b.score as number) - clampScore(a.score as number)) || a.dimension.localeCompare(b.dimension));
  let result: OpportunityResult;
  if (avg >= 80) result = 'exceptional_candidate';
  else if (avg >= 60) result = 'strong_candidate';
  else if (avg >= 35) result = 'acceptable_candidate';
  else result = 'weak_candidate';
  return { result, averageScore: avg, strongestDimension: sorted[0].dimension, weakestDimension: sorted[sorted.length - 1].dimension, evaluatedDimensions: evaluated, missingDimensions: [...missing], opportunityIsNotGuaranteedSuccess: true };
}

// ── Innovation Risk(§6 — worst-of, Risk 관측 ≠ 실패 확정) ───────────────

export interface InnovationRiskDimensionInput {
  dimension: string;
  severity: number | null;   // 0~100 (높을수록 위험 관측 큼) — Null 유지
}

export interface InnovationRiskAssessment {
  result: InnovationRiskResult;
  worstSeverity: number | null;
  worstDimension: string | null;
  evaluatedDimensions: string[];
  unevaluatedDimensions: string[];
  riskIsNotFailure: true;
}

/** Risk 평가 — worst-of. 유효 차원 2개 미만이면 insufficient_data. */
export function assessInnovationRisk(dimensions: InnovationRiskDimensionInput[] | null | undefined): InnovationRiskAssessment {
  const valid = (dimensions ?? []).filter(
    (d) => (INNOVATION_RISK_DIMENSIONS as readonly string[]).includes(d.dimension) && isFiniteNumber(d.severity),
  );
  const evaluated = valid.map((d) => d.dimension).sort((a, b) => a.localeCompare(b));
  const unevaluated = INNOVATION_RISK_DIMENSIONS.filter((d) => !evaluated.includes(d));
  if (valid.length < 2) {
    return { result: 'insufficient_data', worstSeverity: null, worstDimension: null, evaluatedDimensions: evaluated, unevaluatedDimensions: [...unevaluated], riskIsNotFailure: true };
  }
  const worst = [...valid].sort((a, b) => (clampScore(b.severity as number) - clampScore(a.severity as number)) || a.dimension.localeCompare(b.dimension))[0];
  const sev = clampScore(worst.severity as number);
  let result: InnovationRiskResult;
  if (sev >= 70) result = 'critical_risk_candidate';
  else if (sev >= 40) result = 'elevated_risk_candidate';
  else if (sev >= 15) result = 'manageable_risk_candidate';
  else result = 'low_risk_candidate';
  return { result, worstSeverity: sev, worstDimension: worst.dimension, evaluatedDimensions: evaluated, unevaluatedDimensions: [...unevaluated], riskIsNotFailure: true };
}

// ── Innovation Portfolio(§7 — Portfolio 관측 ≠ Portfolio 변경) ──────────

export interface PortfolioDimensionInput {
  dimension: string;
  score: number | null;   // 0~100 — Null 유지
}

export interface InnovationPortfolioAssessment {
  result: InnovationPortfolioResult;
  averageScore: number | null;
  weakestDimension: string | null;
  evaluatedDimensions: string[];
  missingDimensions: string[];
  portfolioIsNotChangeDirective: true;
}

/** Portfolio 평가 — 평균 기반. 유효 차원 3개 미만이면 insufficient_data. */
export function evaluateInnovationPortfolio(dimensions: PortfolioDimensionInput[] | null | undefined): InnovationPortfolioAssessment {
  const valid = (dimensions ?? []).filter(
    (d) => (INNOVATION_PORTFOLIO_DIMENSIONS as readonly string[]).includes(d.dimension) && isFiniteNumber(d.score),
  );
  const evaluated = valid.map((d) => d.dimension).sort((a, b) => a.localeCompare(b));
  const missing = INNOVATION_PORTFOLIO_DIMENSIONS.filter((d) => !evaluated.includes(d));
  if (valid.length < 3) {
    return { result: 'insufficient_data', averageScore: null, weakestDimension: null, evaluatedDimensions: evaluated, missingDimensions: [...missing], portfolioIsNotChangeDirective: true };
  }
  const scores = valid.map((d) => clampScore(d.score as number));
  const avg = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
  const weakest = [...valid].sort((a, b) => (clampScore(a.score as number) - clampScore(b.score as number)) || a.dimension.localeCompare(b.dimension))[0];
  let result: InnovationPortfolioResult;
  if (avg >= 80) result = 'highly_balanced_candidate';
  else if (avg >= 60) result = 'balanced_candidate';
  else if (avg >= 40) result = 'partially_balanced_candidate';
  else result = 'imbalanced_candidate';
  return { result, averageScore: avg, weakestDimension: weakest.dimension, evaluatedDimensions: evaluated, missingDimensions: [...missing], portfolioIsNotChangeDirective: true };
}

// ── Innovation Priority(Priority ≠ Mandatory Order) ─────────────────────

export interface InnovationCandidateInput {
  title: string;
  opportunityScore: number | null;   // 0~100 — Null 이면 unverified 로 분리
  alignmentScore: number | null;     // 0~100
  riskScore: number | null;          // 0~100 (높을수록 위험 관측 큼)
  evidenceCount: number;
}

export interface RankedInnovation {
  title: string;
  priorityScore: number;   // opportunity + alignment − risk
}

export interface InnovationPriorityRanking {
  ranked: RankedInnovation[];
  unverifiedCandidates: string[];        // 측정 불충분 — 순위 미부여(정직 공개)
  excludedWithoutEvidence: string[];     // Evidence 0 — 후보 제외(정직 공개)
  priorityIsNotMandatoryOrder: true;
}

/** 혁신 우선순위 — opportunity + alignment − risk. Evidence 없는 후보 제외,
 *  미측정 후보는 순위 없이 공개. 동점은 제목순 결정적 정렬. */
export function rankInnovationPriority(candidates: InnovationCandidateInput[] | null | undefined): InnovationPriorityRanking {
  const excluded: string[] = [];
  const unverified: string[] = [];
  const ranked: RankedInnovation[] = [];
  for (const c of candidates ?? []) {
    if (!c.title || c.title.trim() === '') continue;
    if (!isFiniteNumber(c.evidenceCount) || c.evidenceCount <= 0) { excluded.push(c.title); continue; }
    if (!isFiniteNumber(c.opportunityScore) || !isFiniteNumber(c.alignmentScore) || !isFiniteNumber(c.riskScore)) { unverified.push(c.title); continue; }
    ranked.push({
      title: c.title,
      priorityScore: clampScore(c.opportunityScore as number) + clampScore(c.alignmentScore as number) - clampScore(c.riskScore as number),
    });
  }
  ranked.sort((a, b) => (b.priorityScore - a.priorityScore) || a.title.localeCompare(b.title));
  excluded.sort((a, b) => a.localeCompare(b));
  unverified.sort((a, b) => a.localeCompare(b));
  return { ranked, unverifiedCandidates: unverified, excludedWithoutEvidence: excluded, priorityIsNotMandatoryOrder: true };
}

// ── Executive Innovation Scorecard(§8 — Scorecard ≠ 투자 지시) ──────────

export interface InnovationScorecardInput {
  criticalRisks: number;
  imbalancedPortfolios: number;
  weakOpportunities: number;
  pendingHumanReviews: number;
}

export interface ExecutiveInnovationScorecard {
  fields: readonly string[];
  severityScore: number;
  attention: { area: string; count: number; weight: number }[];
  humanReviewRequired: true;
  scorecardIsNotInvestmentDirective: true;
}

/** Scorecard 심각도 — critical risk ×10 + imbalanced ×5 + weak ×3 + 대기 리뷰. */
export function buildExecutiveInnovationScorecard(input: InnovationScorecardInput | null | undefined): ExecutiveInnovationScorecard {
  const n = (v: number | undefined) => (isFiniteNumber(v) && (v as number) > 0 ? Math.floor(v as number) : 0);
  const critical = n(input?.criticalRisks);
  const imbalanced = n(input?.imbalancedPortfolios);
  const weak = n(input?.weakOpportunities);
  const pending = n(input?.pendingHumanReviews);
  const attention = [
    { area: 'critical_risks', count: critical, weight: 10 },
    { area: 'imbalanced_portfolios', count: imbalanced, weight: 5 },
    { area: 'weak_opportunities', count: weak, weight: 3 },
    { area: 'pending_human_reviews', count: pending, weight: 1 },
  ]
    .filter((a) => a.count > 0)
    .sort((a, b) => (b.count * b.weight - a.count * a.weight) || a.area.localeCompare(b.area));
  return {
    fields: INNOVATION_SCORECARD_FIELDS,
    severityScore: critical * 10 + imbalanced * 5 + weak * 3 + pending,
    attention,
    humanReviewRequired: true,
    scorecardIsNotInvestmentDirective: true,
  };
}

// ── Review Workflow(§9 — Review ≠ Approval) ─────────────────────────────

export interface InnovationReviewInput {
  reviewType: string;
  createdBy: string | null;
  reviewerId: string | null;
  evidenceCount: number;
}

export interface InnovationReviewValidation {
  valid: boolean;
  reason: 'valid' | 'invalid_review_type' | 'self_review_blocked' | 'evidence_required' | 'reviewer_required';
  reviewIsNotApproval: true;
}

/** Review 검증 — 3종 외 차단, Self-Review 차단, Evidence 필수. */
export function validateInnovationReview(input: InnovationReviewInput | null | undefined): InnovationReviewValidation {
  const type = input?.reviewType ?? '';
  if (!(INNOVATION_REVIEW_TYPES as readonly string[]).includes(type)) {
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

// ── Innovation Timeline(Vision → Audit — 13단계) ────────────────────────

export interface InnovationTimelineEntry {
  stage: string;
  label?: string;
}

export interface InnovationTimeline {
  stages: { stage: InnovationFlowStage; entries: string[] }[];
  unknownStages: string[];   // 13단계 외 — 무시하지 않고 정직 공개
}

/** 타임라인 구성 — 13단계 순서 고정, 미지 단계는 별도 공개. */
export function buildInnovationTimeline(entries: InnovationTimelineEntry[] | null | undefined): InnovationTimeline {
  const unknown: string[] = [];
  const byStage = new Map<string, string[]>();
  for (const e of entries ?? []) {
    if (!(INNOVATION_FLOW_STAGES as readonly string[]).includes(e.stage)) {
      if (e.stage && !unknown.includes(e.stage)) unknown.push(e.stage);
      continue;
    }
    const list = byStage.get(e.stage) ?? [];
    list.push(e.label ?? e.stage);
    byStage.set(e.stage, list);
  }
  unknown.sort((a, b) => a.localeCompare(b));
  return {
    stages: INNOVATION_FLOW_STAGES.map((stage) => ({ stage, entries: byStage.get(stage) ?? [] })),
    unknownStages: unknown,
  };
}

// ── Support Matrix(정직 고지 — 48항목) ──────────────────────────────────

export type InnovationSupportLevel =
  | 'fully_supported'
  | 'partially_supported'
  | 'advisory_only'
  | 'human_review_only'
  | 'unavailable'
  | 'insufficient_data';

export interface InnovationSupportEntry {
  feature: string;
  level: InnovationSupportLevel;
  note: string;
}

export const ENTERPRISE_INNOVATION_SUPPORT_MATRIX: readonly InnovationSupportEntry[] = [
  // 기록/감사 계층(서버 RPC 실존).
  { feature: 'innovation_candidate_record', level: 'fully_supported', note: '0562 admin_enterprise_innovation_create — 관측 기록만' },
  { feature: 'innovation_event_audit_log', level: 'fully_supported', note: '0562 이벤트 31종 append-only Audit' },
  { feature: 'innovation_review_request', level: 'fully_supported', note: '§9 3종 요청만 — Review ≠ Approval' },
  { feature: 'innovation_learning_record', level: 'fully_supported', note: 'Learning 기록 ≠ 자동 사업 시작' },
  { feature: 'innovation_timeline_record', level: 'fully_supported', note: 'JSONB innovation_history append — Forecast 확정 아님' },
  { feature: 'future_opportunity_record', level: 'fully_supported', note: 'Evidence 필수 — Potential ≠ Outcome' },
  { feature: 'executive_innovation_summary_record', level: 'fully_supported', note: 'Summary ≠ 사업 시작 확정' },
  { feature: 'executive_innovation_scorecard_record', level: 'fully_supported', note: 'Scorecard ≠ 투자 지시' },
  { feature: 'innovation_recommendation_record', level: 'fully_supported', note: '23종 whitelist + Evidence 필수 — Recommendation ≠ Decision' },
  { feature: 'reference_linking', level: 'fully_supported', note: '0547/0555/0556/0557/0558/0559/0560/0561 실존 검증 후 참조만' },
  // 분석 계층(설명/후보 제시만).
  { feature: 'innovation_opportunity_detection', level: 'advisory_only', note: '§5 5차원 — Opportunity ≠ Guaranteed Success' },
  { feature: 'innovation_risk_assessment', level: 'advisory_only', note: '§6 worst-of — Risk 관측 ≠ 실패 확정' },
  { feature: 'innovation_portfolio_analysis', level: 'advisory_only', note: '§7 — Portfolio 관측 ≠ Portfolio 변경' },
  { feature: 'innovation_readiness_assessment', level: 'advisory_only', note: 'Readiness ≠ Success' },
  { feature: 'future_opportunity_analysis', level: 'advisory_only', note: 'Potential ≠ Outcome — Forecast ≠ Future Fact' },
  { feature: 'technology_opportunity_analysis', level: 'advisory_only', note: 'Technology 관측 후보 ≠ 도입 결정' },
  { feature: 'market_potential_analysis', level: 'advisory_only', note: 'Market Potential ≠ 시장 확정' },
  { feature: 'mission_alignment_analysis', level: 'advisory_only', note: 'Alignment 관측 ≠ Mission 변경' },
  { feature: 'innovation_priority_analysis', level: 'advisory_only', note: 'Priority ≠ Mandatory Order' },
  { feature: 'innovation_recommendation_generation', level: 'advisory_only', note: 'Recommendation ≠ Decision' },
  { feature: 'executive_innovation_summary_generation', level: 'advisory_only', note: '설명 계층 — 사업 시작 확정 아님' },
  { feature: 'innovation_forecast_discussion', level: 'advisory_only', note: 'Forecast ≠ Future Fact' },
  { feature: 'pilot_review_suggestion', level: 'advisory_only', note: '파일럿 후보 제안만 — 실행은 사람' },
  // 부분 지원(수동 기록 기반 — 자동 연동 아님).
  { feature: 'improvement_actuals_integration', level: 'partially_supported', note: '0561 improvements 수동 기록 기반 참조' },
  { feature: 'transformation_actuals_integration', level: 'partially_supported', note: '0560 transformations 수동 기록 기반 참조' },
  { feature: 'environment_actuals_integration', level: 'partially_supported', note: '0556 environment_observations 수동 기록 기반 참조' },
  { feature: 'scenario_actuals_integration', level: 'partially_supported', note: '0557 decision_scenarios 수동 기록 기반 참조' },
  // 사람 전용 결정.
  { feature: 'business_launch_decision', level: 'human_review_only', note: '신규 사업 시작은 사람' },
  { feature: 'product_launch_decision', level: 'human_review_only', note: '제품 출시는 사람' },
  { feature: 'investment_decision', level: 'human_review_only', note: '투자 승인은 사람' },
  { feature: 'strategy_change_decision', level: 'human_review_only', note: 'Strategy 변경은 사람' },
  // 금지(스펙 — RPC 자체 없음).
  { feature: 'automatic_business_launch', level: 'unavailable', note: '금지 — 신규 사업 자동 시작 없음' },
  { feature: 'automatic_product_launch', level: 'unavailable', note: '금지 — 제품 자동 출시 없음' },
  { feature: 'automatic_investment_approval', level: 'unavailable', note: '금지 — 투자 자동 승인 없음' },
  { feature: 'automatic_budget_change', level: 'unavailable', note: '금지 — Budget 자동 변경 없음' },
  { feature: 'automatic_organization_change', level: 'unavailable', note: '금지 — 조직 자동 변경 없음' },
  { feature: 'automatic_strategy_change', level: 'unavailable', note: '금지 — Strategy 자동 변경 없음' },
  { feature: 'automatic_contract_signing', level: 'unavailable', note: '금지 — 계약 자동 체결 없음' },
  { feature: 'automatic_production_change', level: 'unavailable', note: '금지 — Production 변경 없음' },
  { feature: 'automatic_merge', level: 'unavailable', note: '금지 — Merge 없음' },
  { feature: 'automatic_deploy', level: 'unavailable', note: '금지 — Deploy 없음' },
  { feature: 'automatic_rollback', level: 'unavailable', note: '금지 — Rollback 없음' },
  // 부재 피드(실측 — 원본 없음).
  { feature: 'market_research_feed', level: 'insufficient_data', note: '시장 조사 피드 부재(실측)' },
  { feature: 'patent_database_feed', level: 'insufficient_data', note: '특허 DB 피드 부재(실측)' },
  { feature: 'startup_ecosystem_feed', level: 'insufficient_data', note: '스타트업 생태계 피드 부재(실측)' },
  { feature: 'technology_radar_feed', level: 'insufficient_data', note: '기술 레이더 피드 부재(실측)' },
  { feature: 'customer_insight_feed', level: 'insufficient_data', note: '고객 인사이트 피드 부재(실측)' },
  { feature: 'rnd_lab_system', level: 'insufficient_data', note: 'R&D 랩 시스템 부재(실측)' },
] as const;
