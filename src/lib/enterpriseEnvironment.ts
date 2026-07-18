/**
 * enterpriseEnvironment — Enterprise Ecosystem Intelligence, External
 * Intelligence & Strategic Environment 순수 로직 (Phase AI-OPS-52).
 *
 * Enterprise Vision→Enterprise Mission→Internal Intelligence→External
 * Environment→Market/Competitive/Partner/Customer/Technology/Regulatory/
 * Macroeconomic Intelligence→Risk Signal Detection→Strategic Environment
 * Assessment→Executive Environment Review→Environment Learning→Audit.
 *
 * 정직성: Market Trend ≠ Future Market · Competitor Analysis ≠ Competitor
 * Intent · Technology Trend ≠ Guaranteed Adoption · Regulation Change ≠
 * Legal Advice · Customer Trend ≠ Customer Demand · Risk Signal ≠ Actual
 * Risk · Recommendation ≠ Decision · Pattern ≠ Causality · Null → 0 변환
 * 금지. 전 함수 결정적(Deterministic)·순수(Pure)·Null-safe. 자동 전략/계약
 * 변경 없음 — 사람이 전략과 계약, 투자와 실행을 결정한다.
 */
import { isFiniteNumber, clampScore } from './aiMemory';

/* ── 상수(SQL CHECK 1:1) ────────────────────────────────────────────────── */
export const ENVIRONMENT_CATEGORIES = [
  'market', 'customer', 'competitor', 'partner', 'vendor', 'technology', 'regulation',
  'economy', 'finance', 'security', 'ai', 'esg', 'global', 'executive', 'custom',
] as const;

export const ENVIRONMENT_STATUSES = [
  'observed', 'candidate', 'review_reference', 'archived_reference', 'insufficient_data',
] as const;

export const MARKET_SIGNAL_DIMENSIONS = [
  'trend_strength', 'signal_consistency', 'evidence_quality', 'freshness', 'coverage',
] as const;
export const MARKET_SIGNAL_RESULTS = [
  'strong_signal_candidate', 'moderate_signal_candidate', 'weak_signal_candidate',
  'unsupported_candidate', 'insufficient_data',
] as const;
export type MarketSignalResult = (typeof MARKET_SIGNAL_RESULTS)[number];

export const ENVIRONMENT_IMPACT_DIMENSIONS = [
  'mission_impact', 'strategy_impact', 'portfolio_impact', 'financial_impact', 'operational_impact',
] as const;
export const ENVIRONMENT_IMPACT_RESULTS = [
  'high_impact_candidate', 'medium_impact_candidate', 'low_impact_candidate',
  'impact_unknown', 'insufficient_data',
] as const;
export type EnvironmentImpactResult = (typeof ENVIRONMENT_IMPACT_RESULTS)[number];

export const EXTERNAL_RISK_DIMENSIONS = [
  'regulatory', 'technology', 'competitive', 'supply_chain', 'financial', 'reputation',
] as const;
export const EXTERNAL_RISK_RESULTS = [
  'critical_candidate', 'elevated_candidate', 'normal_candidate',
  'unverified_candidate', 'insufficient_data',
] as const;
export type ExternalRiskResult = (typeof EXTERNAL_RISK_RESULTS)[number];

export const ENVIRONMENT_REVIEW_TYPES = ['environment_review', 'executive_review', 'human_review'] as const;
export const ENVIRONMENT_REVIEW_STATUSES = ['requested', 'in_review', 'review_reference_recorded', 'revision_requested', 'insufficient_data'] as const;

export const ENVIRONMENT_RECOMMENDATION_TYPES = [
  'create_environment_observation', 'review_market_trend', 'review_competitive_landscape',
  'review_partner_relationship', 'review_customer_trend', 'review_technology_trend',
  'review_regulatory_change', 'review_economic_signal', 'review_risk_signal',
  'review_environment_impact', 'record_environment_mapping', 'record_ecosystem_relationship',
  'record_environment_timeline', 'build_executive_environment_summary',
  'build_executive_environment_scorecard', 'request_environment_review',
  'request_executive_review', 'request_human_review', 'record_environment_learning',
  'link_mission_reference', 'link_strategy_reference', 'gather_more_evidence_candidate', 'insufficient_data',
] as const;

/* §8 Executive Environment Scorecard 포함 필드 */
export const ENVIRONMENT_SCORECARD_FIELDS = [
  'market_intelligence', 'competitive_intelligence', 'technology_intelligence',
  'regulatory_intelligence', 'external_risk', 'strategic_environment_impact',
  'executive_summary', 'human_review',
] as const;

/* ── Market Intelligence(§5 — 5평가, Market Trend ≠ Future Market) ─────── */
export function evaluateMarketSignal(input: {
  trendStrength: number | null; signalConsistency: number | null; evidenceQuality: number | null;
  freshnessDays: number | null; coverage: number | null;
}): { result: MarketSignalResult; signalScore: number | null; assessedDimensions: number; marketTrendIsNotFutureMarket: true } {
  const parts: number[] = [];
  if (isFiniteNumber(input.trendStrength)) parts.push(clampScore(input.trendStrength));
  if (isFiniteNumber(input.signalConsistency)) parts.push(clampScore(input.signalConsistency));
  if (isFiniteNumber(input.evidenceQuality)) parts.push(clampScore(input.evidenceQuality));
  if (isFiniteNumber(input.freshnessDays) && input.freshnessDays >= 0) {
    parts.push(input.freshnessDays <= 30 ? 100 : input.freshnessDays <= 90 ? 70 : input.freshnessDays <= 180 ? 40 : 10);
  }
  if (isFiniteNumber(input.coverage)) parts.push(clampScore(input.coverage));
  // 5평가 중 3개 미만 → insufficient_data(Null → 0 변환 금지).
  if (parts.length < 3) {
    return { result: 'insufficient_data', signalScore: null, assessedDimensions: parts.length, marketTrendIsNotFutureMarket: true };
  }
  const score = clampScore(parts.reduce((s, v) => s + v, 0) / parts.length);
  const result: MarketSignalResult = score >= 80 ? 'strong_signal_candidate'
    : score >= 60 ? 'moderate_signal_candidate'
    : score >= 40 ? 'weak_signal_candidate'
    : 'unsupported_candidate';
  return { result, signalScore: score, assessedDimensions: parts.length, marketTrendIsNotFutureMarket: true };
}

/* ── Strategic Environment Impact(§6 — worst-of, Impact ≠ 전략 변경) ────── */
export function evaluateEnvironmentImpact(dimensions: { dimension: string; impactScore: number | null }[] | null): {
  result: EnvironmentImpactResult; worstDimension: string | null; worstImpactScore: number | null;
  assessedDimensions: number; unknownDimensions: number; impactIsNotStrategyChange: true;
} {
  const list = Array.isArray(dimensions) ? dimensions : [];
  const known = list.filter((d) => (ENVIRONMENT_IMPACT_DIMENSIONS as readonly string[]).includes(d.dimension));
  const valid = known.filter((d) => isFiniteNumber(d.impactScore));
  const unknownDimensions = known.length - valid.length;
  if (!known.length) {
    return { result: 'insufficient_data', worstDimension: null, worstImpactScore: null, assessedDimensions: 0, unknownDimensions: 0, impactIsNotStrategyChange: true };
  }
  // 평가 차원보다 미지 차원이 많으면 impact_unknown 유지(Null → 0 금지).
  if (valid.length < 2 || unknownDimensions > valid.length) {
    return { result: valid.length === 0 ? 'insufficient_data' : 'impact_unknown', worstDimension: null, worstImpactScore: null, assessedDimensions: valid.length, unknownDimensions, impactIsNotStrategyChange: true };
  }
  let worst = valid[0];
  for (const d of valid) { if ((d.impactScore as number) > (worst.impactScore as number)) worst = d; }
  const s = clampScore(worst.impactScore as number);
  const result: EnvironmentImpactResult = s >= 70 ? 'high_impact_candidate'
    : s >= 40 ? 'medium_impact_candidate'
    : 'low_impact_candidate';
  return { result, worstDimension: worst.dimension, worstImpactScore: s, assessedDimensions: valid.length, unknownDimensions, impactIsNotStrategyChange: true };
}

/* ── External Risk Signal(§7 — worst-of 6차원, Signal ≠ Actual Risk) ────── */
export function detectExternalRiskSignals(signals: { dimension: string; severity: number | null }[] | null): {
  result: ExternalRiskResult; worstDimension: string | null; worstSeverity: number | null;
  assessedDimensions: number; unverifiedDimensions: number; riskSignalIsNotActualRisk: true;
} {
  const list = Array.isArray(signals) ? signals : [];
  const known = list.filter((s) => (EXTERNAL_RISK_DIMENSIONS as readonly string[]).includes(s.dimension));
  if (!known.length) {
    return { result: 'insufficient_data', worstDimension: null, worstSeverity: null, assessedDimensions: 0, unverifiedDimensions: 0, riskSignalIsNotActualRisk: true };
  }
  const valid = known.filter((s) => isFiniteNumber(s.severity));
  const unverifiedDimensions = known.length - valid.length;
  if (!valid.length) {
    return { result: 'unverified_candidate', worstDimension: null, worstSeverity: null, assessedDimensions: 0, unverifiedDimensions, riskSignalIsNotActualRisk: true };
  }
  let worst = valid[0];
  for (const s of valid) { if ((s.severity as number) > (worst.severity as number)) worst = s; }
  const sev = clampScore(worst.severity as number);
  const result: ExternalRiskResult = sev >= 70 ? 'critical_candidate'
    : sev >= 40 ? 'elevated_candidate'
    : 'normal_candidate';
  return { result, worstDimension: worst.dimension, worstSeverity: sev, assessedDimensions: valid.length, unverifiedDimensions, riskSignalIsNotActualRisk: true };
}

/* ── Environment Recommendation 검증(Recommendation ≠ Decision) ─────────── */
export function validateEnvironmentRecommendation(input: { recommendationType: string; evidenceCount: number | null }): {
  allowed: boolean; blockedReasons: string[]; recommendationIsNotDecision: true;
} {
  const blockedReasons: string[] = [];
  if (!(ENVIRONMENT_RECOMMENDATION_TYPES as readonly string[]).includes(input.recommendationType)) {
    blockedReasons.push('허용되지 않는 recommendation_type(23종 whitelist)');
  }
  if (!isFiniteNumber(input.evidenceCount) || input.evidenceCount <= 0) {
    blockedReasons.push('Evidence 없는 Environment Recommendation 금지');
  }
  return { allowed: blockedReasons.length === 0, blockedReasons, recommendationIsNotDecision: true };
}

/* ── Executive Environment Scorecard(§8 — 결정적 우선순위 정렬) ─────────── */
export interface EnvironmentScorecardEntryInput {
  observationCode: string; category: string; signal: MarketSignalResult;
  impact: EnvironmentImpactResult; risk: ExternalRiskResult; humanReviewPresent: boolean;
}
export function buildExecutiveEnvironmentScorecard(entries: EnvironmentScorecardEntryInput[] | null, topN = 5): {
  priorityRows: EnvironmentScorecardEntryInput[]; fields: readonly string[]; scorecardIsNotStrategyChange: true; orderingIsDeterministic: true;
} {
  const severity = (e: EnvironmentScorecardEntryInput): number => {
    const r = e.risk === 'critical_candidate' ? 3 : e.risk === 'elevated_candidate' ? 2 : 0;
    const i = e.impact === 'high_impact_candidate' ? 3 : e.impact === 'medium_impact_candidate' ? 1 : 0;
    const s = e.signal === 'strong_signal_candidate' ? 1 : 0;
    return r * 10 + i * 5 + s;
  };
  const sorted = (Array.isArray(entries) ? [...entries] : [])
    .sort((a, b) => severity(b) - severity(a) || a.observationCode.localeCompare(b.observationCode));
  return { priorityRows: sorted.slice(0, Math.max(0, topN)), fields: ENVIRONMENT_SCORECARD_FIELDS, scorecardIsNotStrategyChange: true, orderingIsDeterministic: true };
}

/* ── Environment Review 검증(§9 — Self 차단·Evidence 필수) ──────────────── */
export function validateEnvironmentReview(input: { action: string; evidenceCount: number | null; isSelfReview: boolean }): {
  allowed: boolean; blockedReasons: string[]; reviewIsNotApproval: true; strategyChangeIsHuman: true;
} {
  const blockedReasons: string[] = [];
  if (input.action === 'record_review_reference') {
    if (input.isSelfReview) blockedReasons.push('Self-Review 차단(작성자 ≠ 평가자)');
    if (!isFiniteNumber(input.evidenceCount) || input.evidenceCount <= 0) blockedReasons.push('Evidence 없는 Environment Review Reference 금지');
  }
  return { allowed: blockedReasons.length === 0, blockedReasons, reviewIsNotApproval: true, strategyChangeIsHuman: true };
}

/* ── Environment 흐름 타임라인(관측 여부 표시 — 자동 진행 아님) ─────────── */
export const ENVIRONMENT_FLOW_STAGES = [
  'enterprise_vision', 'enterprise_mission', 'internal_intelligence', 'external_environment',
  'market_intelligence', 'competitive_intelligence', 'partner_intelligence', 'customer_intelligence',
  'technology_intelligence', 'regulatory_intelligence', 'macroeconomic_intelligence',
  'risk_signal_detection', 'strategic_environment_assessment', 'executive_environment_review',
  'environment_learning',
] as const;
export function buildEnvironmentTimeline(input: { present: Partial<Record<(typeof ENVIRONMENT_FLOW_STAGES)[number], boolean>> }): {
  stage: (typeof ENVIRONMENT_FLOW_STAGES)[number]; present: boolean;
}[] {
  return ENVIRONMENT_FLOW_STAGES.map((stage) => ({ stage, present: input.present[stage] === true }));
}

/* ── 컴포넌트/Support Matrix ────────────────────────────────────────────── */
export const ENTERPRISE_ENVIRONMENT_COMPONENTS = [
  'environment_observation_registry', 'environment_review_registry', 'market_intelligence_analysis',
  'competitive_intelligence_analysis', 'technology_intelligence_analysis', 'regulatory_intelligence_analysis',
  'external_risk_signal_detection', 'strategic_environment_mapping', 'executive_environment_scorecard',
  'environment_event_audit',
] as const;

export type EnvironmentSupportLevel = 'fully_supported' | 'partially_supported' | 'advisory_only' | 'human_review_only' | 'unavailable' | 'insufficient_data';
export const ENTERPRISE_ENVIRONMENT_SUPPORT_MATRIX: { capability: string; support: EnvironmentSupportLevel }[] = [
  { capability: 'environment_observation_structuring', support: 'fully_supported' },
  { capability: 'environment_category_15_domains', support: 'fully_supported' },
  { capability: 'market_signal_5_dimensions', support: 'fully_supported' },
  { capability: 'market_trend_candidate', support: 'advisory_only' },
  { capability: 'competitive_landscape_candidate', support: 'advisory_only' },
  { capability: 'partner_relationship_candidate', support: 'advisory_only' },
  { capability: 'customer_trend_candidate', support: 'advisory_only' },
  { capability: 'technology_trend_candidate', support: 'advisory_only' },
  { capability: 'regulatory_change_candidate', support: 'advisory_only' },
  { capability: 'economic_signal_candidate', support: 'advisory_only' },
  { capability: 'external_risk_signal_6_dimensions', support: 'fully_supported' },
  { capability: 'environment_impact_5_dimensions', support: 'fully_supported' },
  { capability: 'strategic_environment_mapping', support: 'fully_supported' },
  { capability: 'ecosystem_relationship_recording', support: 'fully_supported' },
  { capability: 'environment_timeline_recording', support: 'fully_supported' },
  { capability: 'executive_environment_summary_candidate', support: 'advisory_only' },
  { capability: 'executive_environment_scorecard_candidate', support: 'advisory_only' },
  { capability: 'environment_recommendation_with_evidence', support: 'advisory_only' },
  { capability: 'environment_review_request', support: 'human_review_only' },
  { capability: 'executive_review_request', support: 'human_review_only' },
  { capability: 'human_review_request', support: 'human_review_only' },
  { capability: 'environment_review_reference_no_self_review', support: 'human_review_only' },
  { capability: 'strategy_contract_change_human_only', support: 'human_review_only' },
  { capability: 'environment_learning_recording', support: 'fully_supported' },
  { capability: 'mission_reference_link_0555', support: 'partially_supported' },
  { capability: 'strategy_portfolio_link_0545', support: 'partially_supported' },
  { capability: 'program_reference_link_0547', support: 'partially_supported' },
  { capability: 'value_reference_link_0549', support: 'partially_supported' },
  { capability: 'governance_reference_link_0551', support: 'partially_supported' },
  { capability: 'knowledge_reference_link_0553', support: 'partially_supported' },
  { capability: 'environment_event_audit_trail', support: 'fully_supported' },
  { capability: 'market_data_feed', support: 'insufficient_data' },
  { capability: 'competitor_intelligence_feed', support: 'insufficient_data' },
  { capability: 'news_media_feed', support: 'insufficient_data' },
  { capability: 'regulatory_bulletin_feed', support: 'insufficient_data' },
  { capability: 'macroeconomic_data_feed', support: 'insufficient_data' },
  { capability: 'customer_survey_feed', support: 'insufficient_data' },
  { capability: 'automatic_strategy_change', support: 'unavailable' },
  { capability: 'automatic_mission_change', support: 'unavailable' },
  { capability: 'automatic_contract_signing', support: 'unavailable' },
  { capability: 'automatic_contract_termination', support: 'unavailable' },
  { capability: 'automatic_partner_approval', support: 'unavailable' },
  { capability: 'automatic_vendor_change', support: 'unavailable' },
  { capability: 'automatic_budget_change', support: 'unavailable' },
  { capability: 'automatic_pricing_change', support: 'unavailable' },
  { capability: 'automatic_product_change', support: 'unavailable' },
  { capability: 'automatic_production_change', support: 'unavailable' },
  { capability: 'automatic_merge', support: 'unavailable' },
  { capability: 'automatic_deploy', support: 'unavailable' },
  { capability: 'automatic_rollback', support: 'unavailable' },
];
