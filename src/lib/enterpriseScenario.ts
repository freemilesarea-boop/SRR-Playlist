/**
 * enterpriseScenario — Enterprise Scenario Intelligence, Predictive
 * Simulation & Executive Decision Laboratory 순수 로직 (Phase AI-OPS-53).
 *
 * Enterprise Vision→Mission→Current State→Scenario Generation→Alternative
 * Strategies→Trade-off Analysis→Impact/Resource/Financial/Operational/Risk
 * Simulation→Scenario Comparison→Executive Decision Laboratory→Human
 * Decision→Scenario Learning→Audit.
 *
 * 정직성: Scenario ≠ Future Reality · Simulation ≠ Prediction ·
 * Recommendation ≠ Decision · Ranking ≠ Executive Priority · Trade-off ≠
 * Optimal Solution · Cost Estimate ≠ Actual Cost · Risk Estimate ≠ Actual
 * Risk · Pattern ≠ Causality · Null → 0 변환 금지.
 * 전 함수 결정적(Deterministic)·순수(Pure)·Null-safe. 자동 실행 없음 —
 * 사람이 결정을 내리고 실행한다.
 * (0542 scenarioIntelligence/0516 strategicScenarioIntelligence 와 별개 계층)
 */
import { isFiniteNumber, clampScore } from './aiMemory';

/* ── 상수(SQL CHECK 1:1) ────────────────────────────────────────────────── */
export const SCENARIO_CATEGORIES = [
  'strategy', 'portfolio', 'investment', 'organization', 'product', 'technology', 'market',
  'finance', 'operations', 'risk', 'ai', 'executive', 'enterprise', 'custom',
] as const;

export const SCENARIO_STATUSES = [
  'draft', 'candidate', 'review_reference', 'archived_reference', 'insufficient_data',
] as const;

export const IMPACT_SIMULATION_DIMENSIONS = [
  'financial_impact', 'operational_impact', 'mission_impact', 'resource_impact', 'risk_impact',
] as const;
export const IMPACT_SIMULATION_RESULTS = [
  'high_positive_candidate', 'moderate_positive_candidate', 'neutral_candidate',
  'high_negative_candidate', 'insufficient_data',
] as const;
export type ImpactSimulationResult = (typeof IMPACT_SIMULATION_RESULTS)[number];

export const TRADEOFF_DIMENSIONS = ['cost', 'benefit', 'complexity', 'time', 'risk'] as const;
export const TRADEOFF_RESULTS = [
  'highly_balanced_candidate', 'balanced_candidate', 'acceptable_candidate',
  'poor_tradeoff_candidate', 'insufficient_data',
] as const;
export type TradeoffResult = (typeof TRADEOFF_RESULTS)[number];

export const SCENARIO_CONFIDENCE_DIMENSIONS = [
  'evidence', 'coverage', 'stability', 'consistency', 'similar_history',
] as const;
export const SCENARIO_CONFIDENCE_RESULTS = [
  'high_confidence_candidate', 'moderate_confidence_candidate', 'low_confidence_candidate',
  'speculative_candidate', 'insufficient_data',
] as const;
export type ScenarioConfidenceResult = (typeof SCENARIO_CONFIDENCE_RESULTS)[number];

export const SCENARIO_REVIEW_TYPES = ['scenario_review', 'executive_review', 'human_review'] as const;
export const SCENARIO_REVIEW_STATUSES = ['requested', 'in_review', 'review_reference_recorded', 'revision_requested', 'insufficient_data'] as const;

export const SCENARIO_RECOMMENDATION_TYPES = [
  'create_decision_scenario', 'record_alternative_strategy', 'run_whatif_simulation',
  'run_resource_simulation', 'run_financial_simulation', 'run_operational_simulation',
  'run_risk_simulation', 'review_impact_simulation', 'review_tradeoff_analysis',
  'review_scenario_confidence', 'record_cost_benefit', 'record_scenario_ranking',
  'record_scenario_comparison', 'build_executive_decision_summary',
  'build_executive_decision_scorecard', 'request_scenario_review',
  'request_executive_review', 'request_human_review', 'record_human_decision',
  'record_scenario_learning', 'link_mission_reference', 'gather_more_evidence_candidate', 'insufficient_data',
] as const;

/* §8 Executive Decision Scorecard 포함 필드 */
export const DECISION_SCORECARD_FIELDS = [
  'scenario_ranking', 'trade_off', 'financial_impact', 'operational_impact',
  'mission_impact', 'risk', 'recommendation', 'executive_summary', 'human_review',
] as const;

/* ── Scenario Generation(레버 조합 — Scenario ≠ Future Reality) ─────────── */
export function generateScenarioMatrix(levers: { name: string; options: string[] }[] | null, maxScenarios = 8): {
  scenarios: { scenarioCode: string; choices: { lever: string; option: string }[] }[];
  totalCombinations: number; truncated: boolean; scenarioIsNotFutureReality: true;
} {
  const valid = (Array.isArray(levers) ? levers : [])
    .filter((l) => typeof l.name === 'string' && l.name.length > 0 && Array.isArray(l.options) && l.options.length > 0);
  if (!valid.length) {
    return { scenarios: [], totalCombinations: 0, truncated: false, scenarioIsNotFutureReality: true };
  }
  // 결정적 순서: 레버 이름순 → 옵션 원순서 카테시안 곱.
  const sorted = [...valid].sort((a, b) => a.name.localeCompare(b.name));
  let combos: { lever: string; option: string }[][] = [[]];
  for (const lever of sorted) {
    const next: { lever: string; option: string }[][] = [];
    for (const combo of combos) {
      for (const option of lever.options) next.push([...combo, { lever: lever.name, option }]);
    }
    combos = next;
  }
  const totalCombinations = combos.length;
  const truncated = totalCombinations > Math.max(1, maxScenarios);
  const scenarios = combos.slice(0, Math.max(1, maxScenarios)).map((choices, i) => ({
    scenarioCode: `SCN-${String(i + 1).padStart(2, '0')}`, choices,
  }));
  return { scenarios, totalCombinations, truncated, scenarioIsNotFutureReality: true };
}

/* ── Impact Simulation(§5 — signed 평균, Simulation ≠ Prediction) ───────── */
export function evaluateImpactSimulation(dimensions: { dimension: string; impactScore: number | null }[] | null): {
  result: ImpactSimulationResult; averageImpact: number | null; assessedDimensions: number; simulationIsNotPrediction: true;
} {
  const list = Array.isArray(dimensions) ? dimensions : [];
  const valid = list.filter((d) => (IMPACT_SIMULATION_DIMENSIONS as readonly string[]).includes(d.dimension) && isFiniteNumber(d.impactScore));
  // 5평가 중 3개 미만 → insufficient_data(Null → 0 변환 금지).
  if (valid.length < 3) {
    return { result: 'insufficient_data', averageImpact: null, assessedDimensions: valid.length, simulationIsNotPrediction: true };
  }
  const avg = Math.round((valid.reduce((s, d) => s + Math.max(-100, Math.min(100, d.impactScore as number)), 0) / valid.length) * 100) / 100;
  const result: ImpactSimulationResult = avg >= 50 ? 'high_positive_candidate'
    : avg >= 15 ? 'moderate_positive_candidate'
    : avg > -50 ? 'neutral_candidate'
    : 'high_negative_candidate';
  return { result, averageImpact: avg, assessedDimensions: valid.length, simulationIsNotPrediction: true };
}

/* ── Trade-off Analysis(§6 — Benefit 대비 부담, Trade-off ≠ Optimal) ────── */
export function analyzeTradeoff(input: {
  costScore: number | null; benefitScore: number | null; complexityScore: number | null;
  timeScore: number | null; riskScore: number | null;
}): { result: TradeoffResult; balanceScore: number | null; assessedDimensions: number; tradeoffIsNotOptimalSolution: true } {
  const burdens = [input.costScore, input.complexityScore, input.timeScore, input.riskScore]
    .filter((s): s is number => isFiniteNumber(s)).map((s) => clampScore(s));
  const hasBenefit = isFiniteNumber(input.benefitScore);
  const assessedDimensions = burdens.length + (hasBenefit ? 1 : 0);
  // Benefit 미평가 또는 5평가 중 3개 미만 → insufficient_data.
  if (!hasBenefit || assessedDimensions < 3) {
    return { result: 'insufficient_data', balanceScore: null, assessedDimensions, tradeoffIsNotOptimalSolution: true };
  }
  const burden = burdens.reduce((s, v) => s + v, 0) / burdens.length;
  const balanceScore = Math.round((clampScore(input.benefitScore as number) - burden) * 100) / 100;
  const result: TradeoffResult = balanceScore >= 30 ? 'highly_balanced_candidate'
    : balanceScore >= 10 ? 'balanced_candidate'
    : balanceScore >= -10 ? 'acceptable_candidate'
    : 'poor_tradeoff_candidate';
  return { result, balanceScore, assessedDimensions, tradeoffIsNotOptimalSolution: true };
}

/* ── Scenario Confidence(§7 — Confidence ≠ Certainty) ───────────────────── */
export function evaluateScenarioConfidence(dimensions: { dimension: string; score: number | null }[] | null): {
  result: ScenarioConfidenceResult; confidenceScore: number | null; assessedDimensions: number; confidenceIsNotCertainty: true;
} {
  const list = Array.isArray(dimensions) ? dimensions : [];
  const valid = list.filter((d) => (SCENARIO_CONFIDENCE_DIMENSIONS as readonly string[]).includes(d.dimension) && isFiniteNumber(d.score));
  if (valid.length < 3) {
    return { result: 'insufficient_data', confidenceScore: null, assessedDimensions: valid.length, confidenceIsNotCertainty: true };
  }
  const score = clampScore(valid.reduce((s, d) => s + (d.score as number), 0) / valid.length);
  const result: ScenarioConfidenceResult = score >= 80 ? 'high_confidence_candidate'
    : score >= 60 ? 'moderate_confidence_candidate'
    : score >= 40 ? 'low_confidence_candidate'
    : 'speculative_candidate';
  return { result, confidenceScore: score, assessedDimensions: valid.length, confidenceIsNotCertainty: true };
}

/* ── Scenario Ranking(복합 점수 — Ranking ≠ Executive Priority) ─────────── */
export function rankScenarios(entries: { scenarioCode: string; impactScore: number | null; tradeoffScore: number | null; riskScore: number | null }[] | null): {
  ranked: { scenarioCode: string; compositeScore: number }[]; unrankedScenarios: string[]; rankingIsNotExecutivePriority: true;
} {
  const list = Array.isArray(entries) ? entries : [];
  const rankable = list.filter((e) => isFiniteNumber(e.impactScore) && isFiniteNumber(e.tradeoffScore) && isFiniteNumber(e.riskScore));
  // 점수 미비 시나리오는 순위에서 제외하고 정직하게 공개(Null → 0 금지).
  const unrankedScenarios = list.filter((e) => !rankable.includes(e)).map((e) => e.scenarioCode).sort((a, b) => a.localeCompare(b));
  const ranked = rankable
    .map((e) => ({
      scenarioCode: e.scenarioCode,
      compositeScore: Math.round(((e.impactScore as number) + (e.tradeoffScore as number) - clampScore(e.riskScore as number)) * 100) / 100,
    }))
    .sort((a, b) => b.compositeScore - a.compositeScore || a.scenarioCode.localeCompare(b.scenarioCode));
  return { ranked, unrankedScenarios, rankingIsNotExecutivePriority: true };
}

/* ── Executive Decision Scorecard(§8 — 결정적 우선순위 정렬) ────────────── */
export interface DecisionScorecardEntryInput {
  scenarioCode: string; category: string; impact: ImpactSimulationResult;
  tradeoff: TradeoffResult; confidence: ScenarioConfidenceResult; humanReviewPresent: boolean;
}
export function buildExecutiveDecisionScorecard(entries: DecisionScorecardEntryInput[] | null, topN = 5): {
  priorityRows: DecisionScorecardEntryInput[]; fields: readonly string[]; scorecardIsNotDecision: true; orderingIsDeterministic: true;
} {
  const severity = (e: DecisionScorecardEntryInput): number => {
    const i = e.impact === 'high_negative_candidate' ? 3 : e.impact === 'high_positive_candidate' ? 2 : 0;
    const t = e.tradeoff === 'poor_tradeoff_candidate' ? 3 : e.tradeoff === 'highly_balanced_candidate' ? 1 : 0;
    const c = e.confidence === 'speculative_candidate' ? 2 : e.confidence === 'low_confidence_candidate' ? 1 : 0;
    return i * 10 + t * 5 + c * 2;
  };
  const sorted = (Array.isArray(entries) ? [...entries] : [])
    .sort((a, b) => severity(b) - severity(a) || a.scenarioCode.localeCompare(b.scenarioCode));
  return { priorityRows: sorted.slice(0, Math.max(0, topN)), fields: DECISION_SCORECARD_FIELDS, scorecardIsNotDecision: true, orderingIsDeterministic: true };
}

/* ── Scenario Review 검증(§9 — Self 차단·Evidence 필수) ─────────────────── */
export function validateScenarioReview(input: { action: string; evidenceCount: number | null; isSelfReview: boolean }): {
  allowed: boolean; blockedReasons: string[]; reviewIsNotApproval: true; adoptionIsHuman: true;
} {
  const blockedReasons: string[] = [];
  if (input.action === 'record_review_reference') {
    if (input.isSelfReview) blockedReasons.push('Self-Review 차단(작성자 ≠ 평가자)');
    if (!isFiniteNumber(input.evidenceCount) || input.evidenceCount <= 0) blockedReasons.push('Evidence 없는 Scenario Review Reference 금지');
  }
  return { allowed: blockedReasons.length === 0, blockedReasons, reviewIsNotApproval: true, adoptionIsHuman: true };
}

/* ── Scenario 흐름 타임라인(관측 여부 표시 — 자동 진행 아님) ────────────── */
export const SCENARIO_FLOW_STAGES = [
  'enterprise_vision', 'mission', 'current_state', 'scenario_generation', 'alternative_strategies',
  'tradeoff_analysis', 'impact_simulation', 'resource_simulation', 'financial_simulation',
  'operational_simulation', 'risk_simulation', 'scenario_comparison',
  'executive_decision_laboratory', 'human_decision', 'scenario_learning',
] as const;
export function buildScenarioTimeline(input: { present: Partial<Record<(typeof SCENARIO_FLOW_STAGES)[number], boolean>> }): {
  stage: (typeof SCENARIO_FLOW_STAGES)[number]; present: boolean;
}[] {
  return SCENARIO_FLOW_STAGES.map((stage) => ({ stage, present: input.present[stage] === true }));
}

/* ── 컴포넌트/Support Matrix ────────────────────────────────────────────── */
export const ENTERPRISE_SCENARIO_COMPONENTS = [
  'decision_scenario_registry', 'scenario_review_registry', 'alternative_strategy_ledger',
  'impact_simulation_analysis', 'tradeoff_analysis', 'scenario_confidence_analysis',
  'scenario_ranking', 'cost_benefit_analysis', 'executive_decision_scorecard',
  'scenario_event_audit',
] as const;

export type ScenarioSupportLevel = 'fully_supported' | 'partially_supported' | 'advisory_only' | 'human_review_only' | 'unavailable' | 'insufficient_data';
export const ENTERPRISE_SCENARIO_SUPPORT_MATRIX: { capability: string; support: ScenarioSupportLevel }[] = [
  { capability: 'decision_scenario_structuring', support: 'fully_supported' },
  { capability: 'scenario_category_14_domains', support: 'fully_supported' },
  { capability: 'scenario_generation_deterministic', support: 'fully_supported' },
  { capability: 'alternative_strategy_recording', support: 'fully_supported' },
  { capability: 'whatif_simulation_candidate', support: 'advisory_only' },
  { capability: 'resource_simulation_candidate', support: 'advisory_only' },
  { capability: 'financial_simulation_candidate', support: 'advisory_only' },
  { capability: 'operational_simulation_candidate', support: 'advisory_only' },
  { capability: 'risk_simulation_candidate', support: 'advisory_only' },
  { capability: 'impact_simulation_5_dimensions', support: 'fully_supported' },
  { capability: 'tradeoff_analysis_5_dimensions', support: 'fully_supported' },
  { capability: 'scenario_confidence_5_dimensions', support: 'fully_supported' },
  { capability: 'cost_benefit_candidate', support: 'advisory_only' },
  { capability: 'scenario_ranking_deterministic', support: 'fully_supported' },
  { capability: 'scenario_comparison_candidate', support: 'advisory_only' },
  { capability: 'executive_decision_summary_candidate', support: 'advisory_only' },
  { capability: 'executive_decision_scorecard_candidate', support: 'advisory_only' },
  { capability: 'scenario_recommendation_with_evidence', support: 'advisory_only' },
  { capability: 'scenario_review_request', support: 'human_review_only' },
  { capability: 'executive_review_request', support: 'human_review_only' },
  { capability: 'human_review_request', support: 'human_review_only' },
  { capability: 'scenario_review_reference_no_self_review', support: 'human_review_only' },
  { capability: 'scenario_adoption_human_only', support: 'human_review_only' },
  { capability: 'human_decision_recording', support: 'fully_supported' },
  { capability: 'scenario_learning_recording', support: 'fully_supported' },
  { capability: 'mission_reference_link_0555', support: 'partially_supported' },
  { capability: 'strategy_portfolio_link_0545', support: 'partially_supported' },
  { capability: 'environment_reference_link_0556', support: 'partially_supported' },
  { capability: 'program_reference_link_0547', support: 'partially_supported' },
  { capability: 'value_reference_link_0549', support: 'partially_supported' },
  { capability: 'scenario_run_link_0542', support: 'partially_supported' },
  { capability: 'scenario_event_audit_trail', support: 'fully_supported' },
  { capability: 'financial_planning_system', support: 'insufficient_data' },
  { capability: 'erp_feed', support: 'insufficient_data' },
  { capability: 'project_management_feed', support: 'insufficient_data' },
  { capability: 'hr_capacity_feed', support: 'insufficient_data' },
  { capability: 'external_forecast_feed', support: 'insufficient_data' },
  { capability: 'monte_carlo_engine', support: 'insufficient_data' },
  { capability: 'automatic_strategy_execution', support: 'unavailable' },
  { capability: 'automatic_project_creation', support: 'unavailable' },
  { capability: 'automatic_budget_change', support: 'unavailable' },
  { capability: 'automatic_contract_signing', support: 'unavailable' },
  { capability: 'automatic_organization_change', support: 'unavailable' },
  { capability: 'automatic_kpi_change', support: 'unavailable' },
  { capability: 'automatic_production_change', support: 'unavailable' },
  { capability: 'automatic_merge', support: 'unavailable' },
  { capability: 'automatic_deploy', support: 'unavailable' },
  { capability: 'automatic_rollback', support: 'unavailable' },
];
