/**
 * enterprisePortfolio — Enterprise Portfolio Intelligence, Investment Portfolio
 * Optimization & Strategic Capital Governance 순수 로직 (Phase AI-OPS-46).
 *
 * Enterprise Vision→Strategic Objectives→Strategic Initiatives→Investment
 * Portfolio→Capital Allocation Scenario→Portfolio Diversification→
 * Risk vs Return→Value Concentration→Scenario Comparison→Portfolio
 * Optimization Candidate→Executive Portfolio Review→Portfolio Decision
 * Reference→Portfolio Learning→Audit.
 *
 * 정직성: Portfolio Candidate ≠ Approved Portfolio · Capital Allocation
 * Candidate ≠ Capital Allocation · Optimization ≠ Investment Decision ·
 * Diversification Score ≠ Risk Guarantee · Concentration Risk ≠ Failure
 * Prediction · Opportunity Cost ≠ Actual Loss · Scenario Comparison ≠ Future
 * Fact · Confidence ≠ Certainty · Null → 0 변환 금지.
 * 전 함수 결정적(Deterministic)·순수(Pure)·Null-safe. 자동 투자 승인/자본 배분 없음.
 */
import { isFiniteNumber, clampScore } from './aiMemory';

/* ── 상수(SQL CHECK 1:1) ────────────────────────────────────────────────── */
export const PORTFOLIO_CATEGORIES = [
  'growth', 'stability', 'innovation', 'operational_excellence', 'customer_experience',
  'platform', 'ai', 'security', 'compliance', 'infrastructure', 'brand', 'content',
  'store', 'strategic', 'long_term', 'custom',
] as const;

export const PORTFOLIO_STATUSES = ['draft', 'active_reference', 'review_reference', 'deprecated_reference', 'insufficient_data'] as const;
export const PORTFOLIO_SCENARIO_STATUSES = ['draft', 'analyzed_candidate', 'compared_candidate', 'preferred_candidate', 'rejected_reference', 'superseded', 'insufficient_data'] as const;

export const DIVERSIFICATION_RESULTS = [
  'highly_diversified_candidate', 'well_diversified_candidate', 'moderately_diversified_candidate',
  'concentrated_candidate', 'highly_concentrated_candidate', 'insufficient_data',
] as const;
export type DiversificationResult = (typeof DIVERSIFICATION_RESULTS)[number];

export const CAPITAL_ALLOCATION_RESULTS = ['recommended_candidate', 'acceptable_candidate', 'high_risk_candidate', 'insufficient_data'] as const;
export type CapitalAllocationResult = (typeof CAPITAL_ALLOCATION_RESULTS)[number];

export const PORTFOLIO_OPTIMIZATION_DIMENSIONS = [
  'strategic_alignment', 'roi_mix', 'value_mix', 'capacity_fit', 'resource_fit',
  'risk_profile', 'long_term_sustainability',
] as const;
export const PORTFOLIO_OPTIMIZATION_RESULTS = [
  'highly_optimized_candidate', 'optimized_candidate', 'partially_optimized_candidate',
  'optimization_unverified', 'insufficient_data',
] as const;
export type PortfolioOptimizationResult = (typeof PORTFOLIO_OPTIMIZATION_RESULTS)[number];

export const PORTFOLIO_BALANCE_RESULTS = ['well_balanced_candidate', 'moderately_balanced_candidate', 'imbalanced_candidate', 'severely_imbalanced_candidate', 'balance_unverified', 'insufficient_data'] as const;
export const CONCENTRATION_RISK_RESULTS = ['no_material_concentration_candidate', 'moderate_concentration_candidate', 'high_concentration_candidate', 'critical_concentration_candidate', 'concentration_unverified', 'insufficient_data'] as const;
export type ConcentrationRiskResult = (typeof CONCENTRATION_RISK_RESULTS)[number];
export const ROI_MIX_RESULTS = ['high_roi_mix_candidate', 'balanced_roi_mix_candidate', 'low_roi_mix_candidate', 'mixed_roi_candidate', 'roi_mix_unverified', 'insufficient_data'] as const;
export const VALUE_MIX_RESULTS = ['strategic_value_heavy_candidate', 'balanced_value_mix_candidate', 'short_term_heavy_candidate', 'value_mix_unverified', 'insufficient_data'] as const;
export const RISK_RETURN_RESULTS = ['favorable_risk_return_candidate', 'balanced_risk_return_candidate', 'unfavorable_risk_return_candidate', 'high_risk_low_return_candidate', 'risk_return_unverified', 'insufficient_data'] as const;
export type RiskReturnResult = (typeof RISK_RETURN_RESULTS)[number];
export const PORTFOLIO_TRADEOFF_AXES = ['growth_vs_stability', 'short_term_roi_vs_long_term_value', 'innovation_vs_operational_excellence', 'concentration_vs_diversification', 'risk_vs_return', 'capacity_vs_ambition'] as const;
export const PORTFOLIO_TRADEOFF_RESULTS = ['favorable_tradeoff_candidate', 'balanced_tradeoff_candidate', 'conflicting_tradeoff_candidate', 'mixed_tradeoff_candidate', 'tradeoff_unverified', 'insufficient_data'] as const;
export const OPPORTUNITY_COST_RESULTS = ['low_opportunity_cost_candidate', 'moderate_opportunity_cost_candidate', 'high_opportunity_cost_candidate', 'asymmetric_opportunity_cost_candidate', 'opportunity_cost_unverified', 'insufficient_data'] as const;
export type OpportunityCostResult = (typeof OPPORTUNITY_COST_RESULTS)[number];
export const CAPACITY_FIT_RESULTS = ['fits_capacity_candidate', 'tight_capacity_candidate', 'exceeds_capacity_candidate', 'capacity_fit_unverified', 'insufficient_data'] as const;

export const PORTFOLIO_RECOMMENDATION_TYPES = [
  'create_investment_portfolio', 'create_portfolio_scenario', 'record_capital_reference',
  'record_capital_allocation_candidate', 'review_portfolio_balance', 'review_diversification',
  'review_concentration_risk', 'review_roi_mix', 'review_value_mix', 'review_risk_return',
  'review_portfolio_tradeoff', 'compare_scenarios', 'review_opportunity_cost',
  'review_capacity_fit', 'review_portfolio_optimization', 'build_executive_portfolio_scorecard',
  'build_executive_portfolio_summary', 'request_portfolio_review', 'request_executive_review',
  'request_strategy_review', 'record_portfolio_learning_reference', 'gather_more_evidence_candidate',
  'insufficient_data',
] as const;

/* §8 Executive Portfolio Scorecard 포함 필드 */
export const PORTFOLIO_SCORECARD_FIELDS = [
  'portfolio_category', 'diversification', 'roi_mix', 'value_mix', 'opportunity_cost',
  'risk', 'recommendation', 'executive_review',
] as const;

/* ── Diversification Score(HHI 기반 — Score ≠ Risk Guarantee) ──────────── */
export function calculateDiversificationScore(allocations: { key: string; weight: number | null }[] | null): {
  result: DiversificationResult; hhi: number | null; entries: number; diversificationIsNotRiskGuarantee: true;
} {
  const valid = (Array.isArray(allocations) ? allocations : []).filter((a) => isFiniteNumber(a.weight) && (a.weight as number) > 0);
  const total = valid.reduce((sum, a) => sum + (a.weight as number), 0);
  if (valid.length < 2 || total <= 0) {
    return { result: 'insufficient_data', hhi: null, entries: valid.length, diversificationIsNotRiskGuarantee: true };
  }
  // Herfindahl-Hirschman Index: 점유율 제곱합(0~1 — 낮을수록 분산).
  const hhi = Math.round(valid.reduce((sum, a) => sum + ((a.weight as number) / total) ** 2, 0) * 1000) / 1000;
  const result: DiversificationResult = hhi >= 0.5 ? 'highly_concentrated_candidate'
    : hhi >= 0.3 ? 'concentrated_candidate'
    : hhi >= 0.2 ? 'moderately_diversified_candidate'
    : hhi >= 0.12 ? 'well_diversified_candidate'
    : 'highly_diversified_candidate';
  return { result, hhi, entries: valid.length, diversificationIsNotRiskGuarantee: true };
}

/* ── Concentration Risk(최대 점유율 — Risk ≠ Failure Prediction) ───────── */
export function evaluateConcentrationRisk(allocations: { key: string; weight: number | null }[] | null): {
  result: ConcentrationRiskResult; topKey: string | null; topShare: number | null; concentrationIsNotFailurePrediction: true;
} {
  const valid = (Array.isArray(allocations) ? allocations : []).filter((a) => isFiniteNumber(a.weight) && (a.weight as number) > 0);
  const total = valid.reduce((sum, a) => sum + (a.weight as number), 0);
  if (!valid.length || total <= 0) {
    return { result: 'insufficient_data', topKey: null, topShare: null, concentrationIsNotFailurePrediction: true };
  }
  let top = valid[0];
  for (const a of valid) { if ((a.weight as number) > (top.weight as number)) top = a; }
  const topShare = Math.round(((top.weight as number) / total) * 1000) / 1000;
  const result: ConcentrationRiskResult = topShare >= 0.7 ? 'critical_concentration_candidate'
    : topShare >= 0.5 ? 'high_concentration_candidate'
    : topShare >= 0.35 ? 'moderate_concentration_candidate'
    : 'no_material_concentration_candidate';
  return { result, topKey: top.key, topShare, concentrationIsNotFailurePrediction: true };
}

/* ── Capital Allocation Candidate(§6 — Candidate ≠ Capital Allocation) ─── */
export function evaluateCapitalAllocationCandidate(input: { expectedBenefit: number | null; expectedRisk: number | null; capacityFits: boolean | null; confidence: number | null }): {
  result: CapitalAllocationResult; allocationCandidateIsNotCapitalAllocation: true;
} {
  const { expectedBenefit, expectedRisk, capacityFits, confidence } = input;
  if (!isFiniteNumber(expectedBenefit) || !isFiniteNumber(expectedRisk)) {
    return { result: 'insufficient_data', allocationCandidateIsNotCapitalAllocation: true };
  }
  if (expectedRisk >= 70 || capacityFits === false) {
    return { result: 'high_risk_candidate', allocationCandidateIsNotCapitalAllocation: true };
  }
  if (expectedBenefit > 0 && expectedRisk < 40 && isFiniteNumber(confidence) && confidence >= 50 && capacityFits === true) {
    return { result: 'recommended_candidate', allocationCandidateIsNotCapitalAllocation: true };
  }
  return { result: 'acceptable_candidate', allocationCandidateIsNotCapitalAllocation: true };
}

/* ── Opportunity Cost Candidate(≠ Actual Loss) ─────────────────────────── */
export function calculateOpportunityCostCandidate(chosenBenefit: number | null, alternativeBenefits: (number | null)[] | null): {
  result: OpportunityCostResult; forgoneBenefitCandidate: number | null; opportunityCostIsNotActualLoss: true;
} {
  const alts = (Array.isArray(alternativeBenefits) ? alternativeBenefits : []).filter(isFiniteNumber);
  if (!isFiniteNumber(chosenBenefit) || !alts.length) {
    return { result: 'insufficient_data', forgoneBenefitCandidate: null, opportunityCostIsNotActualLoss: true };
  }
  const bestAlt = Math.max(...alts);
  const forgone = Math.round((bestAlt - chosenBenefit) * 100) / 100;
  if (forgone <= 0) return { result: 'low_opportunity_cost_candidate', forgoneBenefitCandidate: 0, opportunityCostIsNotActualLoss: true };
  const ratio = chosenBenefit !== 0 ? forgone / Math.abs(chosenBenefit) : Infinity;
  const result: OpportunityCostResult = ratio >= 0.5 ? 'high_opportunity_cost_candidate'
    : ratio >= 0.15 ? 'moderate_opportunity_cost_candidate'
    : 'low_opportunity_cost_candidate';
  return { result, forgoneBenefitCandidate: forgone, opportunityCostIsNotActualLoss: true };
}

/* ── Risk vs Return(사분면 후보 — ≠ 투자 결정) ─────────────────────────── */
export function evaluateRiskReturn(riskScore: number | null, returnScore: number | null): {
  result: RiskReturnResult; riskReturnIsNotInvestmentDecision: true;
} {
  if (!isFiniteNumber(riskScore) || !isFiniteNumber(returnScore)) {
    return { result: 'insufficient_data', riskReturnIsNotInvestmentDecision: true };
  }
  const highRisk = riskScore >= 50;
  const highReturn = returnScore >= 50;
  const result: RiskReturnResult = !highRisk && highReturn ? 'favorable_risk_return_candidate'
    : highRisk && !highReturn ? 'high_risk_low_return_candidate'
    : highRisk && highReturn ? 'unfavorable_risk_return_candidate'
    : 'balanced_risk_return_candidate';
  return { result, riskReturnIsNotInvestmentDecision: true };
}

/* ── Scenario Comparison(결정적 — Comparison ≠ Future Fact) ────────────── */
export interface PortfolioScenarioInput { scenarioCode: string; expectedBenefit: number | null; expectedRisk: number | null; capacityFits: boolean | null }
export function comparePortfolioScenarios(a: PortfolioScenarioInput, b: PortfolioScenarioInput): {
  preferredCandidate: string | null; benefitDelta: number | null; riskDelta: number | null; comparisonIsNotFutureFact: true; insufficientData: boolean;
} {
  if (!isFiniteNumber(a.expectedBenefit) || !isFiniteNumber(b.expectedBenefit) || !isFiniteNumber(a.expectedRisk) || !isFiniteNumber(b.expectedRisk)) {
    return { preferredCandidate: null, benefitDelta: null, riskDelta: null, comparisonIsNotFutureFact: true, insufficientData: true };
  }
  const benefitDelta = Math.round((a.expectedBenefit - b.expectedBenefit) * 100) / 100;
  const riskDelta = a.expectedRisk - b.expectedRisk;
  const scoreA = a.expectedBenefit - a.expectedRisk + (a.capacityFits === true ? 10 : a.capacityFits === false ? -10 : 0);
  const scoreB = b.expectedBenefit - b.expectedRisk + (b.capacityFits === true ? 10 : b.capacityFits === false ? -10 : 0);
  const preferredCandidate = scoreA > scoreB ? a.scenarioCode : scoreB > scoreA ? b.scenarioCode : null;
  return { preferredCandidate, benefitDelta, riskDelta, comparisonIsNotFutureFact: true, insufficientData: false };
}

/* ── Portfolio Optimization Candidate(§7 — ≠ Investment Decision) ──────── */
export function evaluatePortfolioOptimization(dimensions: { dimension: string; score: number | null }[] | null): {
  result: PortfolioOptimizationResult; averageScore: number | null; assessedDimensions: number; optimizationIsNotInvestmentDecision: true;
} {
  const valid = (Array.isArray(dimensions) ? dimensions : []).filter((d) => (PORTFOLIO_OPTIMIZATION_DIMENSIONS as readonly string[]).includes(d.dimension) && isFiniteNumber(d.score));
  if (!valid.length) {
    return { result: 'insufficient_data', averageScore: null, assessedDimensions: 0, optimizationIsNotInvestmentDecision: true };
  }
  const avg = clampScore(valid.reduce((sum, d) => sum + (d.score as number), 0) / valid.length);
  // 7차원 중 절반 미만 평가 시 검증 불가 유지.
  if (valid.length < 4) {
    return { result: 'optimization_unverified', averageScore: avg, assessedDimensions: valid.length, optimizationIsNotInvestmentDecision: true };
  }
  const result: PortfolioOptimizationResult = avg >= 80 ? 'highly_optimized_candidate'
    : avg >= 60 ? 'optimized_candidate'
    : 'partially_optimized_candidate';
  return { result, averageScore: avg, assessedDimensions: valid.length, optimizationIsNotInvestmentDecision: true };
}

/* ── Executive Portfolio Scorecard(§8 — 악화/집중 우선 결정적 정렬) ────── */
export interface PortfolioScorecardEntryInput {
  portfolioCode: string; category: string; diversification: DiversificationResult;
  roiMix: string; valueMix: string; opportunityCost: OpportunityCostResult;
  risk: RiskReturnResult; recommendation: string | null; executiveReviewPresent: boolean;
}
export function buildExecutivePortfolioScorecard(entries: PortfolioScorecardEntryInput[] | null, topN = 5): {
  priorityRows: PortfolioScorecardEntryInput[]; fields: readonly string[]; scorecardIsNotExecutiveEvaluation: true; orderingIsDeterministic: true;
} {
  const severity = (e: PortfolioScorecardEntryInput): number => {
    const d = e.diversification === 'highly_concentrated_candidate' ? 3 : e.diversification === 'concentrated_candidate' ? 2 : 0;
    const r = e.risk === 'high_risk_low_return_candidate' ? 3 : e.risk === 'unfavorable_risk_return_candidate' ? 2 : 0;
    const o = e.opportunityCost === 'high_opportunity_cost_candidate' ? 1 : 0;
    return d * 10 + r * 3 + o;
  };
  const sorted = (Array.isArray(entries) ? [...entries] : [])
    .sort((a, b) => severity(b) - severity(a) || a.portfolioCode.localeCompare(b.portfolioCode));
  return { priorityRows: sorted.slice(0, Math.max(0, topN)), fields: PORTFOLIO_SCORECARD_FIELDS, scorecardIsNotExecutiveEvaluation: true, orderingIsDeterministic: true };
}

/* ── Executive Portfolio Review 검증(Self-Review 차단·Evidence 필수) ───── */
export function validatePortfolioReview(input: { action: string; evidenceCount: number | null; isSelfReview: boolean }): {
  allowed: boolean; blockedReasons: string[]; humanDecisionRequired: true;
} {
  const blockedReasons: string[] = [];
  if (input.action === 'record_review_reference' || input.action === 'record_decision_reference') {
    if (input.isSelfReview) blockedReasons.push('Self-Review 차단(작성자 ≠ 평가자)');
    if (!isFiniteNumber(input.evidenceCount) || input.evidenceCount <= 0) blockedReasons.push('Evidence 없는 Portfolio Review/Decision Reference 금지');
  }
  return { allowed: blockedReasons.length === 0, blockedReasons, humanDecisionRequired: true };
}

/* ── Portfolio 흐름 타임라인(관측 여부 표시 — 자동 진행 아님) ──────────── */
export const PORTFOLIO_FLOW_STAGES = [
  'strategic_objectives', 'strategic_initiatives', 'investment_portfolio',
  'capital_allocation_scenario', 'portfolio_diversification', 'risk_vs_return',
  'value_concentration', 'scenario_comparison', 'portfolio_optimization',
  'executive_portfolio_review', 'portfolio_decision_reference', 'portfolio_learning',
] as const;
export function buildPortfolioTimeline(input: { present: Partial<Record<(typeof PORTFOLIO_FLOW_STAGES)[number], boolean>> }): {
  stage: (typeof PORTFOLIO_FLOW_STAGES)[number]; present: boolean;
}[] {
  return PORTFOLIO_FLOW_STAGES.map((stage) => ({ stage, present: input.present[stage] === true }));
}

/* ── 컴포넌트/Support Matrix(분류 6종 — §1) ────────────────────────────── */
export const ENTERPRISE_PORTFOLIO_COMPONENTS = [
  'investment_portfolio_registry', 'portfolio_scenario_registry', 'diversification_concentration_analysis',
  'capital_allocation_candidate', 'roi_value_mix_analysis', 'risk_return_tradeoff_analysis',
  'opportunity_cost_analysis', 'portfolio_optimization_candidate', 'executive_portfolio_review_workflow',
  'portfolio_event_audit',
] as const;

export type PortfolioSupportLevel = 'fully_supported' | 'partially_supported' | 'advisory_only' | 'human_review_only' | 'unavailable' | 'insufficient_data';
export const ENTERPRISE_PORTFOLIO_SUPPORT_MATRIX: { capability: string; support: PortfolioSupportLevel }[] = [
  { capability: 'investment_portfolio_structuring', support: 'fully_supported' },
  { capability: 'portfolio_category_16_domains', support: 'fully_supported' },
  { capability: 'capital_reference_with_source', support: 'human_review_only' },
  { capability: 'portfolio_scenario_structuring', support: 'fully_supported' },
  { capability: 'capital_allocation_candidate_with_evidence', support: 'advisory_only' },
  { capability: 'portfolio_balance_candidate', support: 'advisory_only' },
  { capability: 'diversification_score_hhi', support: 'fully_supported' },
  { capability: 'concentration_risk_candidate', support: 'fully_supported' },
  { capability: 'roi_mix_candidate_0549', support: 'partially_supported' },
  { capability: 'value_mix_candidate_0549', support: 'partially_supported' },
  { capability: 'risk_return_quadrant_candidate', support: 'fully_supported' },
  { capability: 'portfolio_tradeoff_analysis', support: 'advisory_only' },
  { capability: 'scenario_comparison_deterministic', support: 'fully_supported' },
  { capability: 'opportunity_cost_candidate', support: 'fully_supported' },
  { capability: 'capacity_fit_candidate_0546', support: 'partially_supported' },
  { capability: 'portfolio_optimization_candidate_7_dimensions', support: 'advisory_only' },
  { capability: 'executive_portfolio_scorecard_candidate', support: 'advisory_only' },
  { capability: 'executive_portfolio_summary_candidate', support: 'advisory_only' },
  { capability: 'portfolio_recommendation_with_evidence', support: 'advisory_only' },
  { capability: 'portfolio_review_request', support: 'human_review_only' },
  { capability: 'executive_review_request', support: 'human_review_only' },
  { capability: 'strategy_review_request', support: 'human_review_only' },
  { capability: 'portfolio_review_reference_no_self_review', support: 'human_review_only' },
  { capability: 'portfolio_decision_reference_human_only', support: 'human_review_only' },
  { capability: 'initiative_reference_link_0545', support: 'partially_supported' },
  { capability: 'business_value_reference_link_0549', support: 'partially_supported' },
  { capability: 'kpi_reference_link_0548', support: 'partially_supported' },
  { capability: 'program_reference_link_0547', support: 'partially_supported' },
  { capability: 'resource_reference_link_0546', support: 'partially_supported' },
  { capability: 'portfolio_learning_reference', support: 'partially_supported' },
  { capability: 'portfolio_event_audit_trail', support: 'fully_supported' },
  { capability: 'capital_market_feed', support: 'insufficient_data' },
  { capability: 'treasury_system_feed', support: 'insufficient_data' },
  { capability: 'investment_committee_system', support: 'insufficient_data' },
  { capability: 'accounting_ledger_feed', support: 'insufficient_data' },
  { capability: 'financial_planning_system_feed', support: 'insufficient_data' },
  { capability: 'external_benchmark_feed', support: 'insufficient_data' },
  { capability: 'automatic_investment_approval', support: 'unavailable' },
  { capability: 'automatic_capital_allocation', support: 'unavailable' },
  { capability: 'automatic_budget_change', support: 'unavailable' },
  { capability: 'automatic_strategy_change', support: 'unavailable' },
  { capability: 'automatic_initiative_termination', support: 'unavailable' },
  { capability: 'automatic_initiative_creation', support: 'unavailable' },
  { capability: 'automatic_resource_allocation', support: 'unavailable' },
  { capability: 'automatic_kpi_modification', support: 'unavailable' },
  { capability: 'automatic_portfolio_modification', support: 'unavailable' },
  { capability: 'automatic_accounting_entry', support: 'unavailable' },
  { capability: 'automatic_payment', support: 'unavailable' },
  { capability: 'automatic_production_change', support: 'unavailable' },
  { capability: 'automatic_merge', support: 'unavailable' },
  { capability: 'automatic_deploy', support: 'unavailable' },
  { capability: 'automatic_rollback', support: 'unavailable' },
];
