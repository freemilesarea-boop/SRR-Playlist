/**
 * strategyIntelligence — Enterprise Strategy Intelligence, Strategic Portfolio &
 * Long-Horizon Planning Center 순수 로직 (Phase AI-OPS-41).
 *
 * Vision Reference → Strategic Goal(계층/충돌) → Priority → Strategic Initiative →
 * Dependency → Portfolio(버전/Scenario) → Resource/Financial/Capacity/Workload Constraint →
 * Concentration/Diversification/Balance → Trade-off/Robustness/Regret →
 * Reversibility/Feasibility → Roadmap/Milestone/Critical Path →
 * Human Strategy Review → Approval Reference → Outcome → Quality/Drift → Learning.
 *
 * 정직성(전부 코드로 강제):
 *  - Strategy Candidate ≠ Approved Strategy. Goal ≠ Guaranteed Outcome.
 *  - Portfolio Candidate ≠ Selected Portfolio. Roadmap Candidate ≠ Execution Schedule.
 *  - Milestone Candidate ≠ Commitment. Budget Reference ≠ Allocated Budget/Cash.
 *  - Resource Demand ≠ Reserved Resource. Capacity Estimate ≠ Guarantee.
 *  - Dependency Candidate ≠ Confirmed. Critical Path Candidate ≠ 일정 보장.
 *  - Concentration ≠ Confirmed Risk. Diversification ≠ Guaranteed Resilience.
 *  - Robust Portfolio ≠ Correct Portfolio. Lowest Regret ≠ Best Strategy.
 *  - Approval Reference ≠ Execution/Allocation. Outcome ≠ Causality.
 *  - Portfolio Drift ≠ 자동 재조정 신호. Unknown 유지(null→0 금지).
 *  - deterministic · pure · null 안전 · NaN/Infinity 방어 · Date 주입.
 */
import { isFiniteNumber, clampScore } from './aiMemory';

/* ── 상수(0545 CHECK와 1:1 정렬) ─────────────────────────────────────── */
export const STRATEGY_DOMAINS = ['enterprise_growth', 'market_expansion', 'product_expansion', 'service_expansion', 'customer_experience', 'store_growth', 'brand_growth', 'artist_ecosystem', 'content_supply', 'music_quality', 'playlist_quality', 'playback_reliability', 'operational_efficiency', 'automation_strategy', 'ai_capability', 'data_strategy', 'security_strategy', 'privacy_strategy', 'compliance_strategy', 'financial_sustainability', 'cost_optimization', 'revenue_growth_reference', 'capacity_strategy', 'infrastructure_strategy_reference', 'connector_strategy', 'partnership_strategy', 'contract_strategy_reference', 'organizational_capability', 'risk_reduction', 'innovation', 'strategic_resilience', 'custom_reference'] as const;
export const BLOCKED_STRATEGY_DOMAINS = ['automatic_investment_execution', 'automatic_budget_allocation', 'automatic_resource_allocation', 'automatic_employee_assignment', 'automatic_hiring', 'automatic_termination', 'automatic_compensation', 'automatic_contract_execution', 'automatic_payment_execution', 'automatic_settlement_mutation', 'automatic_infrastructure_purchase', 'automatic_production_change', 'automatic_policy_application', 'personal_behavior_strategy', 'medical_strategy', 'credit_strategy'] as const;
export const STRATEGIC_GOAL_TYPES = ['vision_reference', 'strategic_outcome_reference', 'growth_reference', 'resilience_reference', 'efficiency_reference', 'reliability_reference', 'financial_reference', 'customer_reference', 'operational_reference', 'capability_reference', 'compliance_reference', 'risk_reduction_reference', 'innovation_reference', 'custom_reference'] as const;
export const STRATEGIC_GOAL_STATUSES = ['draft', 'pending_evidence', 'pending_review', 'reviewed_reference', 'approved_strategy_reference', 'active_reference', 'paused_reference', 'deferred_reference', 'at_risk_candidate', 'blocked_candidate', 'achieved_reference', 'not_achieved_reference', 'superseded', 'invalidated', 'insufficient_data'] as const;
export const STRATEGIC_PRIORITY_RESULTS = ['informational_candidate', 'low_candidate', 'normal_candidate', 'high_candidate', 'critical_candidate', 'priority_unverified', 'insufficient_data'] as const;
export const GOAL_CONFLICT_RESULTS =['no_material_conflict_candidate', 'minor_conflict_candidate', 'moderate_conflict_candidate', 'major_conflict_candidate', 'structural_conflict_candidate', 'conflict_unverified', 'insufficient_data'] as const;
export const STRATEGIC_INITIATIVE_TYPES = ['research_reference', 'validation_reference', 'pilot_reference', 'phased_program_reference', 'capability_building_reference', 'operational_improvement_reference', 'product_development_reference', 'service_expansion_reference', 'market_expansion_reference', 'partnership_reference', 'connector_adoption_reference', 'infrastructure_planning_reference', 'cost_control_reference', 'risk_reduction_reference', 'governance_improvement_reference', 'compliance_improvement_reference', 'strategic_monitoring_reference', 'custom_reference'] as const;
export const BLOCKED_INITIATIVE_TYPES = ['direct_production_execution', 'automatic_budget_spend', 'automatic_resource_assignment', 'automatic_contract_execution', 'automatic_payment', 'automatic_employee_action', 'automatic_infrastructure_purchase', 'automatic_policy_apply'] as const;
export const STRATEGIC_INITIATIVE_STATUSES = ['draft', 'pending_evidence', 'pending_review', 'viable_candidate', 'conditionally_viable_candidate', 'approved_strategy_reference', 'planned_reference', 'active_reference', 'paused_reference', 'deferred_reference', 'at_risk_candidate', 'blocked_candidate', 'completed_reference', 'completed_with_limitation', 'stopped_reference', 'rejected_reference', 'superseded', 'invalidated', 'insufficient_data'] as const;
export const INITIATIVE_DEPENDENCY_TYPES = ['prerequisite', 'enables', 'blocks', 'conflicts', 'shares_resource', 'shares_budget', 'shares_capacity', 'shares_provider', 'shares_connector', 'shares_contract', 'requires_policy', 'requires_approval', 'requires_capability', 'requires_milestone', 'replaces', 'supersedes', 'related_reference', 'unknown'] as const;
export const DEPENDENCY_RESULTS = ['dependency_ready_reference', 'dependency_partial', 'circular_dependency_candidate', 'dependency_conflict_candidate', 'dependency_blocked_candidate', 'dependency_unverified', 'insufficient_data'] as const;
export const STRATEGY_PORTFOLIO_STATUSES = ['draft', 'pending_evidence', 'pending_review', 'ready_for_strategy_review_reference', 'under_strategy_review', 'revision_requested', 'approved_strategy_reference', 'rejected_reference', 'deferred_reference', 'superseded', 'invalidated', 'outcome_pending', 'closed_reference', 'closed_with_limitation', 'insufficient_data'] as const;
export const PORTFOLIO_VERSION_RESULTS = ['version_ready_reference', 'backward_compatible_reference', 'compatible_with_limitation', 'breaking_change_candidate', 'version_unverified', 'insufficient_data'] as const;
export const PORTFOLIO_SCENARIO_TYPES = ['base_case_candidate', 'growth_case_candidate', 'conservative_case_candidate', 'aggressive_case_candidate', 'budget_constrained_candidate', 'capacity_constrained_candidate', 'workforce_constrained_candidate', 'provider_failure_candidate', 'connector_failure_candidate', 'market_slowdown_candidate', 'accelerated_growth_candidate', 'compliance_constraint_candidate', 'no_new_initiative_candidate', 'strategic_focus_candidate', 'strategic_diversification_candidate', 'custom_reference'] as const;
export const RESOURCE_DEMAND_RESULTS = ['resource_demand_ready_reference', 'resource_demand_partial', 'resource_bottleneck_candidate', 'specialist_shortage_candidate', 'reviewer_shortage_candidate', 'resource_availability_unverified', 'insufficient_data'] as const;
export const FINANCIAL_CONSTRAINT_RESULTS = ['within_budget_candidate', 'conditionally_within_budget_candidate', 'budget_pressure_candidate', 'budget_constraint_candidate', 'budget_exceeded_candidate', 'budget_unverified', 'insufficient_data'] as const;
export const CAPACITY_CONSTRAINT_RESULTS = ['capacity_available_candidate', 'capacity_tight_candidate', 'capacity_bottleneck_candidate', 'capacity_exhaustion_candidate', 'capacity_unverified', 'insufficient_data'] as const;
export const WORKLOAD_CONSTRAINT_RESULTS = ['workload_available_candidate', 'workload_pressure_candidate', 'workload_overload_candidate', 'reviewer_bottleneck_candidate', 'specialist_bottleneck_candidate', 'workload_unverified', 'insufficient_data'] as const;
export const CONCENTRATION_RESULTS = ['low_concentration_candidate', 'moderate_concentration_candidate', 'high_concentration_candidate', 'critical_concentration_candidate', 'concentration_unverified', 'insufficient_data'] as const;
export const DIVERSIFICATION_RESULTS = ['diversified_candidate', 'moderately_diversified_candidate', 'limited_diversification_candidate', 'superficial_diversification_candidate', 'diversification_unverified', 'insufficient_data'] as const;
export const PORTFOLIO_BALANCE_RESULTS = ['balanced_portfolio_candidate', 'growth_heavy_candidate', 'stability_heavy_candidate', 'cost_heavy_candidate', 'innovation_heavy_candidate', 'risk_heavy_candidate', 'fragmented_portfolio_candidate', 'unbalanced_portfolio_candidate', 'balance_unverified', 'insufficient_data'] as const;
export const STRATEGIC_TRADEOFF_AXES = ['short_term_vs_long_term', 'growth_vs_stability', 'innovation_vs_reliability', 'cost_vs_quality', 'speed_vs_safety', 'concentration_vs_diversification', 'investment_vs_cash_preservation', 'automation_vs_human_control', 'expansion_vs_operational_readiness', 'customer_growth_vs_service_quality', 'capability_building_vs_immediate_revenue', 'reversible_option_vs_time_to_value', 'strategic_focus_vs_optionality'] as const;
export const STRATEGIC_TRADEOFF_RESULTS = ['favorable_tradeoff_candidate', 'balanced_tradeoff_candidate', 'unfavorable_tradeoff_candidate', 'mixed_tradeoff_candidate', 'tradeoff_unverified', 'insufficient_data'] as const;
export const STRATEGIC_ROBUSTNESS_RESULTS = ['robust_portfolio_candidate', 'conditionally_robust_candidate', 'fragile_portfolio_candidate', 'scenario_specific_candidate', 'robustness_unverified', 'insufficient_data'] as const;
export const STRATEGIC_REGRET_RESULTS = ['lowest_regret_portfolio_candidate', 'low_regret_candidate', 'moderate_regret_candidate', 'high_regret_candidate', 'asymmetric_regret_candidate', 'regret_unverified', 'insufficient_data'] as const;
export const STRATEGIC_REVERSIBILITY_RESULTS = ['highly_reversible_candidate', 'reversible_with_condition_candidate', 'partially_reversible_candidate', 'difficult_to_reverse_candidate', 'irreversible_candidate', 'reversibility_unverified', 'insufficient_data'] as const;
export const STRATEGIC_FEASIBILITY_RESULTS = ['feasible_portfolio_candidate', 'conditionally_feasible_candidate', 'feasibility_blocked_candidate', 'feasibility_unverified', 'insufficient_data'] as const;
export const MILESTONE_STATUSES = ['draft', 'pending_evidence', 'pending_review', 'planned_reference', 'at_risk_candidate', 'blocked_candidate', 'achieved_reference', 'not_achieved_reference', 'deferred_reference', 'invalidated', 'insufficient_data'] as const;
export const CRITICAL_PATH_RESULTS = ['critical_path_candidate', 'multiple_critical_paths_candidate', 'near_critical_path_candidate', 'path_blocked_candidate', 'critical_path_unverified', 'insufficient_data'] as const;
export const STRATEGY_RECOMMENDATION_TYPES = ['create_strategic_goal', 'review_goal_conflict', 'create_strategic_initiative', 'gather_strategy_evidence', 'review_initiative_dependency', 'create_strategy_portfolio', 'create_portfolio_version', 'generate_base_portfolio_scenario', 'generate_budget_constrained_scenario', 'generate_capacity_constrained_scenario', 'review_resource_demand', 'review_financial_constraint', 'review_capacity_constraint', 'review_workload_constraint', 'reduce_portfolio_concentration_candidate', 'improve_portfolio_diversification_candidate', 'rebalance_portfolio_candidate', 'prioritize_initiative_candidate', 'defer_initiative_candidate', 'pause_initiative_reference', 'reject_current_portfolio_candidate', 'gather_more_evidence_candidate', 'request_specialist_review_candidate', 'create_roadmap_candidate', 'review_critical_path_candidate', 'request_human_strategy_review', 'record_portfolio_approval_reference', 'link_milestone_reference', 'link_commitment_reference', 'link_strategic_outcome', 'review_strategy_quality', 'review_strategy_drift', 'record_strategy_learning_reference', 'insufficient_data'] as const;
export const PORTFOLIO_REVIEW_ACTIONS = ['request_evidence', 'mark_ready_for_strategy_review', 'start_strategy_review', 'approve_portfolio_reference', 'approve_with_conditions_reference', 'reject_portfolio_reference', 'defer_portfolio_reference', 'request_revision_reference', 'request_more_evidence_reference', 'request_specialist_review_reference', 'mark_outcome_pending', 'close_reference', 'close_with_limitation', 'invalidate'] as const;
export const STRATEGY_QUALITY_RESULTS = ['high_quality_candidate', 'moderate_quality_candidate', 'low_quality_candidate', 'mixed_quality_candidate', 'outcome_unverified', 'causality_unverified', 'sample_too_small', 'insufficient_data'] as const;
export const STRATEGY_DRIFT_RESULTS = ['no_material_drift_candidate', 'minor_drift_candidate', 'moderate_drift_candidate', 'severe_drift_candidate', 'structural_drift_candidate', 'drift_unverified', 'insufficient_data'] as const;
export const PORTFOLIO_DRIFT_RESULTS = ['no_material_portfolio_drift_candidate', 'minor_portfolio_drift_candidate', 'moderate_portfolio_drift_candidate', 'severe_portfolio_drift_candidate', 'structural_portfolio_drift_candidate', 'portfolio_drift_unverified', 'insufficient_data'] as const;
export const STRATEGY_TIMELINE_STAGES = ['vision_reference', 'strategic_goal', 'goal_conflict', 'strategic_initiative', 'initiative_dependency', 'strategy_portfolio', 'portfolio_scenario', 'constraint_review', 'roadmap', 'human_strategy_review', 'approval_reference', 'outcome'] as const;

/* ── 1) Strategic Goal(성과 보장 아님) ───────────────────────────────── */
export function buildStrategicGoal(i: { domain: string; name: string; goalType: string; parentLevel: number | null }):
  | { rejected: true; rejectReason: string }
  | { domain: string; name: string; goalType: string; level: number; status: 'draft'; goalIsNotGuaranteedOutcome: true; autoApproved: false; budgetAllocated: false } {
  if ((BLOCKED_STRATEGY_DOMAINS as readonly string[]).includes(i.domain)) return { rejected: true, rejectReason: `금지 strategy domain(${i.domain}) — 구조적 차단` };
  if (!(STRATEGY_DOMAINS as readonly string[]).includes(i.domain)) return { rejected: true, rejectReason: '허용되지 않는 strategy_domain' };
  if (!(STRATEGIC_GOAL_TYPES as readonly string[]).includes(i.goalType)) return { rejected: true, rejectReason: '허용되지 않는 goal_type' };
  if (!i.name.trim()) return { rejected: true, rejectReason: 'goal_name 필수' };
  const level = i.parentLevel == null ? 1 : i.parentLevel + 1;
  if (level > 6) return { rejected: true, rejectReason: 'Goal Hierarchy depth 6 초과' };
  return { domain: i.domain, name: i.name, goalType: i.goalType, level, status: 'draft', goalIsNotGuaranteedOutcome: true, autoApproved: false, budgetAllocated: false };
}

/* ── 2) Goal Hierarchy(circular/self 차단·depth ≤ 6) ─────────────────── */
export function validateGoalHierarchy(i: { goalId: string; parentChain: string[]; maxDepth: number }): { result: 'hierarchy_valid_reference' | 'self_parent_blocked' | 'circular_parent_blocked' | 'depth_exceeded' | 'insufficient_data' } {
  if (!i.goalId) return { result: 'insufficient_data' };
  if (i.parentChain.includes(i.goalId)) {
    return { result: i.parentChain[0] === i.goalId && i.parentChain.length === 1 ? 'self_parent_blocked' : 'circular_parent_blocked' };
  }
  if (i.parentChain.length + 1 > i.maxDepth) return { result: 'depth_exceeded' };
  return { result: 'hierarchy_valid_reference' };
}

/* ── 3) Goal Conflict(자동 Goal 제거 근거 아님) ──────────────────────── */
export function detectGoalConflicts(i: { conflictKinds: string[] | null; sharedBudget: boolean; sharedResource: boolean; opposedKpi: boolean }): { result: (typeof GOAL_CONFLICT_RESULTS)[number]; conflictIsNotAutomaticRemoval: true } {
  const flags = { conflictIsNotAutomaticRemoval: true as const };
  if (i.conflictKinds == null) return { result: 'insufficient_data', ...flags };
  const n = i.conflictKinds.length + (i.sharedBudget ? 1 : 0) + (i.sharedResource ? 1 : 0) + (i.opposedKpi ? 1 : 0);
  if (n === 0) return { result: 'no_material_conflict_candidate', ...flags };
  if (i.opposedKpi && (i.sharedBudget || i.sharedResource)) return { result: 'structural_conflict_candidate', ...flags };
  if (n >= 4) return { result: 'major_conflict_candidate', ...flags };
  if (n >= 2) return { result: 'moderate_conflict_candidate', ...flags };
  return { result: 'minor_conflict_candidate', ...flags };
}

/* ── 4) Strategic Priority(자동 정렬/승인 없음) ──────────────────────── */
export function evaluateStrategicPriorityCandidate(i: { strategicValue: number | null; riskReduction: number | null; costOfDelayKnown: boolean; deadlineNear: boolean; dependencyUnlockCount: number | null; evidenceCount: number; portfolioBalanceReviewed: boolean }): { score: number | null; result: 'informational_candidate' | 'low_candidate' | 'normal_candidate' | 'high_candidate' | 'critical_candidate' | 'priority_unverified' | 'insufficient_data'; priorityIsNotFinalPriority: true; autoSorted: false } {
  const flags = { priorityIsNotFinalPriority: true as const, autoSorted: false as const };
  if (i.strategicValue == null && i.riskReduction == null) return { score: null, result: 'insufficient_data', ...flags };
  if (i.strategicValue != null && !isFiniteNumber(i.strategicValue)) return { score: null, result: 'priority_unverified', ...flags };
  if (i.evidenceCount === 0) return { score: null, result: 'priority_unverified', ...flags };
  let score = i.strategicValue != null ? clampScore(i.strategicValue) : 30;
  if (i.riskReduction != null && isFiniteNumber(i.riskReduction)) score += Math.min(20, Math.max(0, i.riskReduction) / 5);
  if (i.deadlineNear) score += 15;
  if (i.costOfDelayKnown) score += 5;
  if (i.dependencyUnlockCount != null && isFiniteNumber(i.dependencyUnlockCount)) score += Math.min(10, Math.max(0, i.dependencyUnlockCount) * 2);
  if (i.portfolioBalanceReviewed) score += 5;
  score = clampScore(score);
  if (score >= 80) return { score, result: 'critical_candidate', ...flags };
  if (score >= 60) return { score, result: 'high_candidate', ...flags };
  if (score >= 35) return { score, result: 'normal_candidate', ...flags };
  if (score >= 15) return { score, result: 'low_candidate', ...flags };
  return { score, result: 'informational_candidate', ...flags };
}

/* ── 5) Strategic Initiative(≠ 실행) ─────────────────────────────────── */
export function buildStrategicInitiative(i: { initiativeType: string; name: string; domain: string }):
  | { rejected: true; rejectReason: string }
  | { initiativeType: string; name: string; status: 'draft'; initiativeIsNotExecution: true; autoStarted: false; budgetAllocated: false; resourcesAllocated: false } {
  if ((BLOCKED_INITIATIVE_TYPES as readonly string[]).includes(i.initiativeType)) return { rejected: true, rejectReason: `금지 initiative_type(${i.initiativeType}) — 구조적 차단` };
  if (!(STRATEGIC_INITIATIVE_TYPES as readonly string[]).includes(i.initiativeType)) return { rejected: true, rejectReason: '허용되지 않는 initiative_type' };
  if (!i.name.trim()) return { rejected: true, rejectReason: 'initiative_name 필수' };
  return { initiativeType: i.initiativeType, name: i.name, status: 'draft', initiativeIsNotExecution: true, autoStarted: false, budgetAllocated: false, resourcesAllocated: false };
}

/* ── 6) Initiative Dependency(Confirmed 아님) — circular 탐지 ────────── */
export function detectCircularDependencies(edges: { from: string; to: string }[] | null): { cycles: string[][]; result: (typeof DEPENDENCY_RESULTS)[number]; dependencyIsNotConfirmed: true } {
  const flags = { dependencyIsNotConfirmed: true as const };
  if (edges == null) return { cycles: [], result: 'insufficient_data', ...flags };
  if (!edges.length) return { cycles: [], result: 'dependency_partial', ...flags };
  const graph = new Map<string, string[]>();
  edges.forEach((e) => { graph.set(e.from, [...(graph.get(e.from) ?? []), e.to]); });
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const walk = (node: string, path: string[]) => {
    const idx = path.indexOf(node);
    if (idx >= 0) { cycles.push(path.slice(idx).concat(node)); return; }
    if (visited.has(node)) return;
    visited.add(node);
    (graph.get(node) ?? []).forEach((next) => walk(next, [...path, node]));
  };
  [...graph.keys()].forEach((n) => walk(n, []));
  if (cycles.length) return { cycles, result: 'circular_dependency_candidate', ...flags };
  return { cycles: [], result: 'dependency_ready_reference', ...flags };
}

export function validateInitiativeDependency(i: { dependencyType: string; fromId: string; toId: string; targetExists: boolean }): { result: (typeof DEPENDENCY_RESULTS)[number] | 'self_dependency_blocked' | 'invalid_dependency_type'; dependencyIsNotConfirmed: true } {
  const flags = { dependencyIsNotConfirmed: true as const };
  if (!(INITIATIVE_DEPENDENCY_TYPES as readonly string[]).includes(i.dependencyType)) return { result: 'invalid_dependency_type', ...flags };
  if (i.fromId === i.toId) return { result: 'self_dependency_blocked', ...flags };
  if (!i.targetExists) return { result: 'dependency_unverified', ...flags };
  if (i.dependencyType === 'conflicts' || i.dependencyType === 'blocks') return { result: 'dependency_conflict_candidate', ...flags };
  return { result: 'dependency_ready_reference', ...flags };
}

/* ── 7) Portfolio 버전 검증(이전 결과 덮어쓰기 없음) ─────────────────── */
export function validatePortfolioVersion(i: { previousVersion: number | null; goalSetChanged: boolean; initiativeSetChanged: boolean; envelopeChanged: boolean; schemaChanged: boolean }): { nextVersion: number; result: (typeof PORTFOLIO_VERSION_RESULTS)[number]; previousResultsPreserved: true } {
  const flags = { previousResultsPreserved: true as const };
  const nextVersion = i.previousVersion == null || !isFiniteNumber(i.previousVersion) ? 1 : i.previousVersion + 1;
  if (i.schemaChanged) return { nextVersion, result: 'breaking_change_candidate', ...flags };
  if (i.goalSetChanged && i.initiativeSetChanged && i.envelopeChanged) return { nextVersion, result: 'breaking_change_candidate', ...flags };
  if (i.envelopeChanged) return { nextVersion, result: 'compatible_with_limitation', ...flags };
  if (i.goalSetChanged || i.initiativeSetChanged) return { nextVersion, result: 'backward_compatible_reference', ...flags };
  return { nextVersion, result: 'version_ready_reference', ...flags };
}

/* ── 8) Portfolio Scenario(≠ Reality) ────────────────────────────────── */
export function generatePortfolioScenario(i: { scenarioType: string; initiativeCount: number; maxScenarios: number; existingScenarioCount: number }):
  | { rejected: true; rejectReason: string }
  | { scenarioType: string; initiativeCount: number; scenarioIsNotReality: true; forecastIsNotFutureFact: true } {
  if (!(PORTFOLIO_SCENARIO_TYPES as readonly string[]).includes(i.scenarioType)) return { rejected: true, rejectReason: '허용되지 않는 scenario_type' };
  if (i.existingScenarioCount >= i.maxScenarios) return { rejected: true, rejectReason: `Scenario ${i.maxScenarios}개 초과` };
  return { scenarioType: i.scenarioType, initiativeCount: i.initiativeCount, scenarioIsNotReality: true, forecastIsNotFutureFact: true };
}

/* ── 9) Resource Demand(예약 아님) ───────────────────────────────────── */
export function evaluateResourceDemand(i: { demandItems: { kind: string; requiredUnits: number | null; availableUnits: number | null }[] | null; specialistRequired: boolean; specialistAvailable: boolean | null; reviewerAvailable: boolean | null }): { result: (typeof RESOURCE_DEMAND_RESULTS)[number]; demandIsNotReservation: true } {
  const flags = { demandIsNotReservation: true as const };
  if (i.demandItems == null) return { result: 'insufficient_data', ...flags };
  if (i.specialistRequired && i.specialistAvailable === false) return { result: 'specialist_shortage_candidate', ...flags };
  if (i.reviewerAvailable === false) return { result: 'reviewer_shortage_candidate', ...flags };
  if (i.demandItems.some((d) => d.availableUnits == null || d.requiredUnits == null)) return { result: 'resource_availability_unverified', ...flags };
  if (i.demandItems.some((d) => !isFiniteNumber(d.requiredUnits!) || !isFiniteNumber(d.availableUnits!))) return { result: 'resource_availability_unverified', ...flags };
  if (i.demandItems.some((d) => d.requiredUnits! > d.availableUnits!)) return { result: 'resource_bottleneck_candidate', ...flags };
  if (!i.demandItems.length) return { result: 'resource_demand_partial', ...flags };
  return { result: 'resource_demand_ready_reference', ...flags };
}

/* ── 10) Financial Constraint(Budget Reference ≠ Cash) ───────────────── */
export function evaluateFinancialConstraint(i: { budgetReference: number | null; estimatedCost: number | null; recurringCost: number | null }): { result: (typeof FINANCIAL_CONSTRAINT_RESULTS)[number]; budgetReferenceIsNotCash: true; financialCandidateIsNotAccountingFact: true } {
  const flags = { budgetReferenceIsNotCash: true as const, financialCandidateIsNotAccountingFact: true as const };
  if (i.budgetReference == null) return { result: 'budget_unverified', ...flags };
  if (i.estimatedCost == null) return { result: 'insufficient_data', ...flags };
  if (!isFiniteNumber(i.budgetReference) || !isFiniteNumber(i.estimatedCost) || (i.recurringCost != null && !isFiniteNumber(i.recurringCost))) return { result: 'budget_unverified', ...flags };
  const total = i.estimatedCost + (i.recurringCost ?? 0);
  if (total > i.budgetReference) return { result: 'budget_exceeded_candidate', ...flags };
  if (total > i.budgetReference * 0.9) return { result: 'budget_constraint_candidate', ...flags };
  if (total > i.budgetReference * 0.7) return { result: 'budget_pressure_candidate', ...flags };
  if (i.recurringCost != null && i.recurringCost > 0) return { result: 'conditionally_within_budget_candidate', ...flags };
  return { result: 'within_budget_candidate', ...flags };
}

/* ── 11) Capacity Constraint(Estimate ≠ Guarantee) ───────────────────── */
export function evaluateCapacityConstraint(i: { currentCapacity: number | null; requiredCapacity: number | null; safetyMarginPct: number }): { utilizationPct: number | null; result: (typeof CAPACITY_CONSTRAINT_RESULTS)[number]; capacityEstimateIsNotGuarantee: true } {
  const flags = { capacityEstimateIsNotGuarantee: true as const };
  if (i.currentCapacity == null || i.requiredCapacity == null) return { utilizationPct: null, result: 'capacity_unverified', ...flags };
  if (!isFiniteNumber(i.currentCapacity) || !isFiniteNumber(i.requiredCapacity) || i.currentCapacity <= 0) return { utilizationPct: null, result: 'capacity_unverified', ...flags };
  const utilizationPct = Math.round((i.requiredCapacity / i.currentCapacity) * 1000) / 10;
  if (utilizationPct >= 100) return { utilizationPct, result: 'capacity_exhaustion_candidate', ...flags };
  if (utilizationPct >= 100 - i.safetyMarginPct) return { utilizationPct, result: 'capacity_bottleneck_candidate', ...flags };
  if (utilizationPct >= 70) return { utilizationPct, result: 'capacity_tight_candidate', ...flags };
  return { utilizationPct, result: 'capacity_available_candidate', ...flags };
}

/* ── 12) Human Workload(자동 인사 배치 없음) ─────────────────────────── */
export function evaluateHumanWorkloadConstraint(i: { concurrentInitiatives: number | null; reviewerAvailable: boolean | null; specialistAvailable: boolean | null; commitmentLoad: number | null; maxConcurrent: number }): { result: (typeof WORKLOAD_CONSTRAINT_RESULTS)[number]; autoStaffAssignment: false } {
  const flags = { autoStaffAssignment: false as const };
  if (i.concurrentInitiatives == null || !isFiniteNumber(i.concurrentInitiatives)) return { result: 'workload_unverified', ...flags };
  if (i.reviewerAvailable === false) return { result: 'reviewer_bottleneck_candidate', ...flags };
  if (i.specialistAvailable === false) return { result: 'specialist_bottleneck_candidate', ...flags };
  if (i.concurrentInitiatives > i.maxConcurrent) return { result: 'workload_overload_candidate', ...flags };
  if (i.commitmentLoad != null && isFiniteNumber(i.commitmentLoad) && i.commitmentLoad > i.maxConcurrent) return { result: 'workload_pressure_candidate', ...flags };
  if (i.reviewerAvailable == null || i.specialistAvailable == null) return { result: 'workload_unverified', ...flags };
  return { result: 'workload_available_candidate', ...flags };
}

/* ── 13) Portfolio Concentration(Confirmed Risk 아님) ────────────────── */
export function evaluatePortfolioConcentration(i: { shares: number[] | null }): { maxSharePct: number | null; result: (typeof CONCENTRATION_RESULTS)[number]; concentrationIsNotConfirmedRisk: true } {
  const flags = { concentrationIsNotConfirmedRisk: true as const };
  if (i.shares == null || !i.shares.length) return { maxSharePct: null, result: 'insufficient_data', ...flags };
  if (i.shares.some((s) => !isFiniteNumber(s) || s < 0)) return { maxSharePct: null, result: 'concentration_unverified', ...flags };
  const total = i.shares.reduce((a, b) => a + b, 0);
  if (total <= 0) return { maxSharePct: null, result: 'concentration_unverified', ...flags };
  const maxSharePct = Math.round((Math.max(...i.shares) / total) * 1000) / 10;
  if (maxSharePct >= 80) return { maxSharePct, result: 'critical_concentration_candidate', ...flags };
  if (maxSharePct >= 60) return { maxSharePct, result: 'high_concentration_candidate', ...flags };
  if (maxSharePct >= 40) return { maxSharePct, result: 'moderate_concentration_candidate', ...flags };
  return { maxSharePct, result: 'low_concentration_candidate', ...flags };
}

/* ── 14) Portfolio Diversification(Resilience 보장 아님) ─────────────── */
export function evaluatePortfolioDiversification(i: { dimensionCounts: { dimension: string; distinctValues: number }[] | null; superficialOverlap: boolean }): { result: (typeof DIVERSIFICATION_RESULTS)[number]; diversificationIsNotGuaranteedResilience: true } {
  const flags = { diversificationIsNotGuaranteedResilience: true as const };
  if (i.dimensionCounts == null || !i.dimensionCounts.length) return { result: 'insufficient_data', ...flags };
  if (i.dimensionCounts.some((d) => !isFiniteNumber(d.distinctValues) || d.distinctValues < 0)) return { result: 'diversification_unverified', ...flags };
  if (i.superficialOverlap) return { result: 'superficial_diversification_candidate', ...flags };
  const avg = i.dimensionCounts.reduce((a, d) => a + d.distinctValues, 0) / i.dimensionCounts.length;
  if (avg >= 4) return { result: 'diversified_candidate', ...flags };
  if (avg >= 2.5) return { result: 'moderately_diversified_candidate', ...flags };
  return { result: 'limited_diversification_candidate', ...flags };
}

/* ── 15) Portfolio Balance ───────────────────────────────────────────── */
export function evaluatePortfolioBalance(i: { growthShare: number | null; stabilityShare: number | null; costShare: number | null; innovationShare: number | null; highRiskShare: number | null; initiativeCount: number }): { result: (typeof PORTFOLIO_BALANCE_RESULTS)[number]; autoRebalanced: false } {
  const flags = { autoRebalanced: false as const };
  if (i.growthShare == null || i.stabilityShare == null) return { result: 'balance_unverified', ...flags };
  const shares = [i.growthShare, i.stabilityShare, i.costShare ?? 0, i.innovationShare ?? 0, i.highRiskShare ?? 0];
  if (shares.some((s) => !isFiniteNumber(s) || s < 0 || s > 100)) return { result: 'balance_unverified', ...flags };
  if (i.initiativeCount === 0) return { result: 'insufficient_data', ...flags };
  if (i.initiativeCount > 30 && Math.max(...shares) < 25) return { result: 'fragmented_portfolio_candidate', ...flags };
  if (i.highRiskShare != null && i.highRiskShare >= 60) return { result: 'risk_heavy_candidate', ...flags };
  if (i.growthShare >= 60) return { result: 'growth_heavy_candidate', ...flags };
  if (i.stabilityShare >= 60) return { result: 'stability_heavy_candidate', ...flags };
  if (i.costShare != null && i.costShare >= 60) return { result: 'cost_heavy_candidate', ...flags };
  if (i.innovationShare != null && i.innovationShare >= 60) return { result: 'innovation_heavy_candidate', ...flags };
  if (Math.abs(i.growthShare - i.stabilityShare) <= 25) return { result: 'balanced_portfolio_candidate', ...flags };
  return { result: 'unbalanced_portfolio_candidate', ...flags };
}

/* ── 16) Strategic Trade-off(자동 Portfolio 선택 없음) ───────────────── */
export function evaluateStrategicTradeoffs(i: { axis: string; sideAScore: number | null; sideBScore: number | null }): { axis: string | null; result: (typeof STRATEGIC_TRADEOFF_RESULTS)[number]; autoPortfolioSelected: false } {
  const flags = { autoPortfolioSelected: false as const };
  if (!(STRATEGIC_TRADEOFF_AXES as readonly string[]).includes(i.axis)) return { axis: null, result: 'insufficient_data', ...flags };
  if (i.sideAScore == null || i.sideBScore == null || !isFiniteNumber(i.sideAScore) || !isFiniteNumber(i.sideBScore)) return { axis: i.axis, result: 'tradeoff_unverified', ...flags };
  const delta = i.sideAScore - i.sideBScore;
  if (Math.abs(delta) <= 5) return { axis: i.axis, result: 'balanced_tradeoff_candidate', ...flags };
  if (delta > 25) return { axis: i.axis, result: 'favorable_tradeoff_candidate', ...flags };
  if (delta < -25) return { axis: i.axis, result: 'unfavorable_tradeoff_candidate', ...flags };
  return { axis: i.axis, result: 'mixed_tradeoff_candidate', ...flags };
}

/* ── 17) Strategic Robustness(Robust ≠ Correct) ──────────────────────── */
export function evaluateStrategicRobustness(i: { scenarioOutcomes: { scenario: string; acceptable: boolean | null }[] | null; minScenarios: number }): { acceptableCount: number | null; result: (typeof STRATEGIC_ROBUSTNESS_RESULTS)[number]; robustPortfolioIsNotCorrectPortfolio: true } {
  const flags = { robustPortfolioIsNotCorrectPortfolio: true as const };
  if (i.scenarioOutcomes == null) return { acceptableCount: null, result: 'insufficient_data', ...flags };
  if (i.scenarioOutcomes.length < i.minScenarios) return { acceptableCount: null, result: 'robustness_unverified', ...flags };
  if (i.scenarioOutcomes.some((s) => s.acceptable == null)) return { acceptableCount: null, result: 'robustness_unverified', ...flags };
  const acceptable = i.scenarioOutcomes.filter((s) => s.acceptable).length;
  if (acceptable === i.scenarioOutcomes.length) return { acceptableCount: acceptable, result: 'robust_portfolio_candidate', ...flags };
  if (acceptable === 0) return { acceptableCount: acceptable, result: 'fragile_portfolio_candidate', ...flags };
  if (acceptable === 1) return { acceptableCount: acceptable, result: 'scenario_specific_candidate', ...flags };
  return { acceptableCount: acceptable, result: 'conditionally_robust_candidate', ...flags };
}

/* ── 18) Strategic Regret(Lowest Regret ≠ Best Strategy) ─────────────── */
export function evaluateStrategicRegret(i: { worstCaseLoss: number | null; opportunityCost: number | null; reversible: boolean | null; lockInPresent: boolean }): { result: (typeof STRATEGIC_REGRET_RESULTS)[number]; lowestRegretIsNotBestStrategy: true } {
  const flags = { lowestRegretIsNotBestStrategy: true as const };
  if (i.worstCaseLoss == null || i.opportunityCost == null) return { result: 'insufficient_data', ...flags };
  if (!isFiniteNumber(i.worstCaseLoss) || !isFiniteNumber(i.opportunityCost) || i.reversible == null) return { result: 'regret_unverified', ...flags };
  if (i.worstCaseLoss > i.opportunityCost * 3 && (i.lockInPresent || !i.reversible)) return { result: 'asymmetric_regret_candidate', ...flags };
  if (i.worstCaseLoss <= 0 && i.opportunityCost <= 0) return { result: 'lowest_regret_portfolio_candidate', ...flags };
  if (i.opportunityCost < 10 && (i.reversible || i.worstCaseLoss < 10)) return { result: 'low_regret_candidate', ...flags };
  if (i.opportunityCost < 40) return { result: 'moderate_regret_candidate', ...flags };
  return { result: 'high_regret_candidate', ...flags };
}

/* ── 19) Strategic Reversibility(Exit 보장 아님) ─────────────────────── */
export function evaluateStrategicReversibility(i: { stoppable: boolean | null; contractLockIn: boolean; providerLockIn: boolean; dataMigrationRequired: boolean; exitConditionsDefined: boolean; rollbackReferenceExists: boolean }): { result: (typeof STRATEGIC_REVERSIBILITY_RESULTS)[number]; reversibilityIsNotGuaranteedExit: true } {
  const flags = { reversibilityIsNotGuaranteedExit: true as const };
  if (i.stoppable == null) return { result: 'reversibility_unverified', ...flags };
  if (i.contractLockIn && i.providerLockIn) return { result: 'irreversible_candidate', ...flags };
  if (!i.stoppable) return { result: 'difficult_to_reverse_candidate', ...flags };
  if (i.contractLockIn || i.providerLockIn || i.dataMigrationRequired) return { result: 'partially_reversible_candidate', ...flags };
  if (!i.exitConditionsDefined || !i.rollbackReferenceExists) return { result: 'reversible_with_condition_candidate', ...flags };
  return { result: 'highly_reversible_candidate', ...flags };
}

/* ── 20) Strategic Feasibility(자원 예약 아님) ───────────────────────── */
export function evaluateStrategicFeasibility(i: { technicallyPossible: boolean | null; reviewerAvailable: boolean; budgetWithin: boolean | null; capacityWithin: boolean | null; policyAllowed: boolean; dependenciesReady: boolean | null }): { result: (typeof STRATEGIC_FEASIBILITY_RESULTS)[number]; feasibilityIsNotResourceReservation: true } {
  const flags = { feasibilityIsNotResourceReservation: true as const };
  if (i.technicallyPossible == null) return { result: 'feasibility_unverified', ...flags };
  if (!i.policyAllowed || !i.technicallyPossible || !i.reviewerAvailable) return { result: 'feasibility_blocked_candidate', ...flags };
  if (i.budgetWithin == null || i.capacityWithin == null || i.dependenciesReady == null) return { result: 'feasibility_unverified', ...flags };
  if (i.budgetWithin && i.capacityWithin && i.dependenciesReady) return { result: 'feasible_portfolio_candidate', ...flags };
  return { result: 'conditionally_feasible_candidate', ...flags };
}

/* ── 21) Roadmap(실행 일정 아님) — 순서/병렬/누락 선행 검증 ──────────── */
export function buildStrategicRoadmapCandidate(i: { steps: { code: string; sequence: number; prerequisites: string[] }[] | null }): { orderedCodes: string[]; missingPrerequisites: { code: string; missing: string[] }[]; result: 'roadmap_candidate_reference' | 'invalid_sequence' | 'missing_prerequisite_candidate' | 'insufficient_data'; roadmapIsNotExecutionSchedule: true } {
  const flags = { roadmapIsNotExecutionSchedule: true as const };
  if (i.steps == null || !i.steps.length) return { orderedCodes: [], missingPrerequisites: [], result: 'insufficient_data', ...flags };
  if (i.steps.some((s) => !isFiniteNumber(s.sequence) || s.sequence < 0)) return { orderedCodes: [], missingPrerequisites: [], result: 'invalid_sequence', ...flags };
  const sorted = [...i.steps].sort((a, b) => a.sequence - b.sequence);
  const seen = new Set<string>();
  const missingPrerequisites: { code: string; missing: string[] }[] = [];
  const allCodes = new Set(i.steps.map((s) => s.code));
  sorted.forEach((s) => {
    const missing = s.prerequisites.filter((p) => !seen.has(p) || !allCodes.has(p));
    if (missing.length) missingPrerequisites.push({ code: s.code, missing });
    seen.add(s.code);
  });
  return { orderedCodes: sorted.map((s) => s.code), missingPrerequisites, result: missingPrerequisites.length ? 'missing_prerequisite_candidate' : 'roadmap_candidate_reference', ...flags };
}

/* ── 22) Milestone Candidate(≠ Commitment) — achieved 는 Evidence 필수 ─ */
export function buildMilestoneCandidate(i: { name: string; status: string; evidenceCount: number }):
  | { rejected: true; rejectReason: string }
  | { name: string; status: string; milestoneIsNotCommitment: true; autoCompleted: false } {
  if (!(MILESTONE_STATUSES as readonly string[]).includes(i.status)) return { rejected: true, rejectReason: '허용되지 않는 milestone_status' };
  if (!i.name.trim()) return { rejected: true, rejectReason: 'milestone_name 필수' };
  if (i.status === 'achieved_reference' && i.evidenceCount === 0) return { rejected: true, rejectReason: 'Evidence 없는 achieved 기록 금지' };
  return { name: i.name, status: i.status, milestoneIsNotCommitment: true, autoCompleted: false };
}

/* ── 23) Critical Path(일정 보장 아님) — 최장 의존 경로 후보 ─────────── */
export function calculateCriticalPathCandidate(i: { edges: { from: string; to: string; durationDays: number | null }[] | null }): { pathCodes: string[]; totalDurationDays: number | null; result: (typeof CRITICAL_PATH_RESULTS)[number]; criticalPathIsNotScheduleGuarantee: true } {
  const flags = { criticalPathIsNotScheduleGuarantee: true as const };
  if (i.edges == null || !i.edges.length) return { pathCodes: [], totalDurationDays: null, result: 'insufficient_data', ...flags };
  if (i.edges.some((e) => e.durationDays == null || !isFiniteNumber(e.durationDays) || e.durationDays < 0)) return { pathCodes: [], totalDurationDays: null, result: 'critical_path_unverified', ...flags };
  if (detectCircularDependencies(i.edges.map((e) => ({ from: e.from, to: e.to }))).cycles.length) return { pathCodes: [], totalDurationDays: null, result: 'path_blocked_candidate', ...flags };
  const graph = new Map<string, { to: string; d: number }[]>();
  i.edges.forEach((e) => { graph.set(e.from, [...(graph.get(e.from) ?? []), { to: e.to, d: e.durationDays! }]); });
  let best: { path: string[]; total: number } = { path: [], total: -1 };
  let bestCount = 0;
  const walk = (node: string, path: string[], total: number) => {
    const next = graph.get(node) ?? [];
    if (!next.length) {
      if (total > best.total) { best = { path: [...path, node], total }; bestCount = 1; }
      else if (total === best.total) { bestCount += 1; }
      return;
    }
    next.forEach((n) => walk(n.to, [...path, node], total + n.d));
  };
  const targets = new Set(i.edges.map((e) => e.to));
  const roots = [...graph.keys()].filter((k) => !targets.has(k));
  if (!roots.length) return { pathCodes: [], totalDurationDays: null, result: 'path_blocked_candidate', ...flags };
  roots.forEach((r) => walk(r, [], 0));
  return { pathCodes: best.path, totalDurationDays: best.total, result: bestCount > 1 ? 'multiple_critical_paths_candidate' : 'critical_path_candidate', ...flags };
}

/* ── 24) Strategy Recommendation(≠ Approval) ─────────────────────────── */
export function buildStrategyRecommendationCandidate(i: { type: string; reason: string; evidence: string[]; confidence: number | null }):
  | { rejected: true; rejectReason: string }
  | { type: string; reason: string; confidence: number | null; recommendationIsNotApproval: true; humanStrategyApprovalRequired: true; autoSelected: false } {
  if (!(STRATEGY_RECOMMENDATION_TYPES as readonly string[]).includes(i.type)) return { rejected: true, rejectReason: '허용되지 않는 recommendation type' };
  if (!i.reason.trim()) return { rejected: true, rejectReason: 'Reason 필수' };
  if (!i.evidence.length) return { rejected: true, rejectReason: 'Evidence 없는 Recommendation 금지' };
  const confidence = i.confidence == null || !isFiniteNumber(i.confidence) ? null : clampScore(i.confidence);
  return { type: i.type, reason: i.reason, confidence, recommendationIsNotApproval: true, humanStrategyApprovalRequired: true, autoSelected: false };
}

/* ── 25) Human Strategy Review(Approval Reference ≠ Allocation) ──────── */
export function validateStrategyReviewAction(i: { action: string; reason: string; evidenceCount: number; reviewerIsCreator: boolean }):
  | { rejected: true; rejectReason: string }
  | { action: string; humanStrategyDecisionConfirmed: true; approvalIsNotAllocation: true; budgetAllocated: false; resourcesAllocated: false; productionApplied: false } {
  if (!(PORTFOLIO_REVIEW_ACTIONS as readonly string[]).includes(i.action)) return { rejected: true, rejectReason: '허용되지 않는 review action' };
  if (!i.reason.trim()) return { rejected: true, rejectReason: 'Reason 필수(승인/거절/보류/수정 전부)' };
  if (i.action === 'approve_portfolio_reference' || i.action === 'approve_with_conditions_reference') {
    if (i.reviewerIsCreator) return { rejected: true, rejectReason: 'Self-Approval 차단(작성자 ≠ 승인자)' };
    if (i.evidenceCount === 0) return { rejected: true, rejectReason: 'Evidence 없는 Portfolio Approval Reference 금지' };
  }
  return { action: i.action, humanStrategyDecisionConfirmed: true, approvalIsNotAllocation: true, budgetAllocated: false, resourcesAllocated: false, productionApplied: false };
}

/* ── 26) Strategic Outcome(≠ Causality) ──────────────────────────────── */
export function evaluateStrategicOutcome(i: { observedOutcomeExists: boolean; observationCompletenessPct: number | null; externalFactorPresent: boolean; sampleSize: number | null; minSample: number }): { result: 'outcome_linked_reference' | 'observation_partial' | 'outcome_unverified' | 'causality_unverified' | 'sample_too_small' | 'insufficient_data'; outcomeIsNotStrategyCausality: true } {
  const flags = { outcomeIsNotStrategyCausality: true as const };
  if (!i.observedOutcomeExists) return { result: 'outcome_unverified', ...flags };
  if (i.sampleSize == null || !isFiniteNumber(i.sampleSize)) return { result: 'insufficient_data', ...flags };
  if (i.sampleSize < i.minSample) return { result: 'sample_too_small', ...flags };
  if (i.externalFactorPresent) return { result: 'causality_unverified', ...flags };
  if (i.observationCompletenessPct != null && isFiniteNumber(i.observationCompletenessPct) && i.observationCompletenessPct < 80) return { result: 'observation_partial', ...flags };
  return { result: 'outcome_linked_reference', ...flags };
}

/* ── 27) Strategy Quality(경영진 평가 아님) ──────────────────────────── */
export function calculateStrategyQualityCandidate(i: { outcomeLinked: boolean; goalAchieved: boolean | null; financialWithinRange: boolean | null; capacityWithinRange: boolean | null; unexpectedSideEffect: boolean; causalityVerified: boolean; sampleSize: number | null; minSample: number }): { result: (typeof STRATEGY_QUALITY_RESULTS)[number]; qualityCandidateIsNotExecutiveEvaluation: true } {
  const flags = { qualityCandidateIsNotExecutiveEvaluation: true as const };
  if (!i.outcomeLinked) return { result: 'outcome_unverified', ...flags };
  if (i.sampleSize == null || !isFiniteNumber(i.sampleSize)) return { result: 'insufficient_data', ...flags };
  if (i.sampleSize < i.minSample) return { result: 'sample_too_small', ...flags };
  if (!i.causalityVerified) return { result: 'causality_unverified', ...flags };
  if (i.goalAchieved == null || i.financialWithinRange == null || i.capacityWithinRange == null) return { result: 'insufficient_data', ...flags };
  const positives = [i.goalAchieved, i.financialWithinRange, i.capacityWithinRange].filter(Boolean).length;
  if (positives === 3 && !i.unexpectedSideEffect) return { result: 'high_quality_candidate', ...flags };
  if (positives >= 2 && i.unexpectedSideEffect) return { result: 'mixed_quality_candidate', ...flags };
  if (positives >= 2) return { result: 'moderate_quality_candidate', ...flags };
  return { result: 'low_quality_candidate', ...flags };
}

/* ── 28) Strategy / Portfolio Drift(자동 재조정 아님) ────────────────── */
export function calculateStrategyDriftCandidate(i: { driftedDimensions: string[] | null; assumptionsInvalidated: number | null }): { result: (typeof STRATEGY_DRIFT_RESULTS)[number]; driftIsNotConfirmedFailure: true } {
  const flags = { driftIsNotConfirmedFailure: true as const };
  if (i.driftedDimensions == null) return { result: 'insufficient_data', ...flags };
  if (i.assumptionsInvalidated == null || !isFiniteNumber(i.assumptionsInvalidated)) return { result: 'drift_unverified', ...flags };
  const n = i.driftedDimensions.length;
  if (n === 0 && i.assumptionsInvalidated === 0) return { result: 'no_material_drift_candidate', ...flags };
  if (i.driftedDimensions.includes('vision_drift') || i.driftedDimensions.includes('goal_drift') || i.assumptionsInvalidated >= 3) return { result: 'structural_drift_candidate', ...flags };
  if (n >= 4) return { result: 'severe_drift_candidate', ...flags };
  if (n >= 2) return { result: 'moderate_drift_candidate', ...flags };
  return { result: 'minor_drift_candidate', ...flags };
}

export function calculatePortfolioDriftCandidate(i: { driftedDimensions: string[] | null }): { result: (typeof PORTFOLIO_DRIFT_RESULTS)[number]; driftIsNotAutomaticRebalancing: true } {
  const flags = { driftIsNotAutomaticRebalancing: true as const };
  if (i.driftedDimensions == null) return { result: 'insufficient_data', ...flags };
  const n = i.driftedDimensions.length;
  if (n === 0) return { result: 'no_material_portfolio_drift_candidate', ...flags };
  if (i.driftedDimensions.includes('initiative_mix_drift') && n >= 3) return { result: 'structural_portfolio_drift_candidate', ...flags };
  if (n >= 4) return { result: 'severe_portfolio_drift_candidate', ...flags };
  if (n >= 2) return { result: 'moderate_portfolio_drift_candidate', ...flags };
  return { result: 'minor_portfolio_drift_candidate', ...flags };
}

/* ── 29) Strategy Learning(자동 Goal·Portfolio 변경 아님) ────────────── */
export function buildStrategyLearningReference(i: { effectiveGoals: string[]; overestimatedInitiatives: string[]; missedDependencies: string[]; actualBottlenecks: string[]; templateImprovements: string[] }): { entryCount: number; result: 'learning_reference_recorded' | 'insufficient_data'; autoGoalChanged: false; autoPortfolioChanged: false } {
  const flags = { autoGoalChanged: false as const, autoPortfolioChanged: false as const };
  const entryCount = i.effectiveGoals.length + i.overestimatedInitiatives.length + i.missedDependencies.length + i.actualBottlenecks.length + i.templateImprovements.length;
  if (entryCount === 0) return { entryCount, result: 'insufficient_data', ...flags };
  return { entryCount, result: 'learning_reference_recorded', ...flags };
}

/* ── 30) Strategy Timeline ───────────────────────────────────────────── */
export function buildStrategyTimeline(i: { present: Partial<Record<(typeof STRATEGY_TIMELINE_STAGES)[number], boolean>> }): { stages: { stage: (typeof STRATEGY_TIMELINE_STAGES)[number]; present: boolean }[]; completedCount: number; timelineIsNotExecutionLog: true } {
  const stages = STRATEGY_TIMELINE_STAGES.map((stage) => ({ stage, present: i.present[stage] === true }));
  return { stages, completedCount: stages.filter((s) => s.present).length, timelineIsNotExecutionLog: true };
}

/* ── 31) Support Matrix(실측 기반 — Automatic 계열 전부 unsupported) ─── */
export const STRATEGY_COMPONENTS = [
  { key: 'decision_contexts_0544', available: true },
  { key: 'executive_briefs_0544', available: true },
  { key: 'decision_memory_0514', available: true },
  { key: 'commitments_0520', available: true },
  { key: 'commitment_milestones_0520', available: true },
  { key: 'scenario_runs_0542', available: true },
  { key: 'forecast_runs_0543', available: true },
  { key: 'warning_candidates_0543', available: true },
  { key: 'capacity_cost_snapshots_0508', available: true },
  { key: 'corporate_visions_0524', available: true },
  { key: 'enterprise_contracts_0383', available: true },
  { key: 'knowledge_entities_0513', available: true },
  { key: 'official_corporate_vision_dataset', available: false },
  { key: 'budget_actuals_feed', available: false },
  { key: 'cash_flow_feed', available: false },
  { key: 'org_capacity_directory', available: false },
  { key: 'provider_dependency_feed', available: false },
  { key: 'project_management_system', available: false },
  { key: 'initiative_execution_tracker', available: false },
  { key: 'resource_reservation_system', available: false },
] as const;

export type StrategySupportStatus = 'fully_supported' | 'partially_supported' | 'read_only' | 'strategy_reference_only' | 'goal_only' | 'initiative_only' | 'portfolio_only' | 'planning_only' | 'advisory_only' | 'human_review_only' | 'approval_reference_only' | 'outcome_reference_only' | 'unavailable' | 'unverified' | 'unsupported' | 'insufficient_data';
export const STRATEGY_SUPPORT_MATRIX: { feature: string; status: StrategySupportStatus }[] = [
  { feature: 'vision_reference', status: 'strategy_reference_only' },
  { feature: 'strategic_goal', status: 'goal_only' },
  { feature: 'goal_hierarchy', status: 'goal_only' },
  { feature: 'goal_dependency', status: 'advisory_only' },
  { feature: 'goal_conflict', status: 'advisory_only' },
  { feature: 'strategic_priority_candidate', status: 'advisory_only' },
  { feature: 'strategic_initiative', status: 'initiative_only' },
  { feature: 'initiative_dependency', status: 'advisory_only' },
  { feature: 'initiative_conflict', status: 'advisory_only' },
  { feature: 'strategy_portfolio', status: 'portfolio_only' },
  { feature: 'portfolio_versioning', status: 'portfolio_only' },
  { feature: 'portfolio_scenario', status: 'planning_only' },
  { feature: 'resource_demand', status: 'advisory_only' },
  { feature: 'financial_constraint', status: 'advisory_only' },
  { feature: 'capacity_constraint', status: 'advisory_only' },
  { feature: 'human_workload_constraint', status: 'advisory_only' },
  { feature: 'provider_dependency', status: 'unverified' },
  { feature: 'connector_dependency', status: 'advisory_only' },
  { feature: 'contract_constraint', status: 'strategy_reference_only' },
  { feature: 'security_constraint', status: 'strategy_reference_only' },
  { feature: 'privacy_constraint', status: 'strategy_reference_only' },
  { feature: 'compliance_constraint', status: 'strategy_reference_only' },
  { feature: 'portfolio_concentration', status: 'advisory_only' },
  { feature: 'portfolio_diversification', status: 'advisory_only' },
  { feature: 'portfolio_balance', status: 'advisory_only' },
  { feature: 'strategic_risk', status: 'advisory_only' },
  { feature: 'strategic_opportunity', status: 'advisory_only' },
  { feature: 'financial_impact', status: 'advisory_only' },
  { feature: 'capacity_impact', status: 'advisory_only' },
  { feature: 'operational_impact', status: 'advisory_only' },
  { feature: 'customer_experience_impact', status: 'advisory_only' },
  { feature: 'store_operations_impact', status: 'advisory_only' },
  { feature: 'organizational_impact', status: 'advisory_only' },
  { feature: 'strategic_tradeoff', status: 'advisory_only' },
  { feature: 'strategic_robustness', status: 'advisory_only' },
  { feature: 'strategic_regret', status: 'advisory_only' },
  { feature: 'strategic_reversibility', status: 'advisory_only' },
  { feature: 'strategic_feasibility', status: 'advisory_only' },
  { feature: 'strategic_roadmap', status: 'planning_only' },
  { feature: 'initiative_sequence', status: 'planning_only' },
  { feature: 'parallel_initiative', status: 'planning_only' },
  { feature: 'critical_path_candidate', status: 'planning_only' },
  { feature: 'milestone_candidate', status: 'planning_only' },
  { feature: 'strategy_recommendation_candidate', status: 'advisory_only' },
  { feature: 'human_strategy_review', status: 'human_review_only' },
  { feature: 'portfolio_approval_reference', status: 'approval_reference_only' },
  { feature: 'portfolio_rejection_reference', status: 'approval_reference_only' },
  { feature: 'portfolio_defer_reference', status: 'approval_reference_only' },
  { feature: 'revision_request', status: 'human_review_only' },
  { feature: 'decision_reference', status: 'strategy_reference_only' },
  { feature: 'commitment_reference', status: 'strategy_reference_only' },
  { feature: 'observation_plan_reference', status: 'strategy_reference_only' },
  { feature: 'review_trigger_reference', status: 'strategy_reference_only' },
  { feature: 'strategic_outcome_reference', status: 'outcome_reference_only' },
  { feature: 'strategy_quality_candidate', status: 'advisory_only' },
  { feature: 'strategy_drift_candidate', status: 'advisory_only' },
  { feature: 'portfolio_drift_candidate', status: 'advisory_only' },
  { feature: 'strategy_learning_reference', status: 'strategy_reference_only' },
  { feature: 'strategy_audit', status: 'read_only' },
  { feature: 'automatic_strategy', status: 'unsupported' },
  { feature: 'automatic_portfolio_selection', status: 'unsupported' },
  { feature: 'automatic_budget_allocation', status: 'unsupported' },
  { feature: 'automatic_resource_allocation', status: 'unsupported' },
  { feature: 'automatic_initiative_execution', status: 'unsupported' },
  { feature: 'automatic_policy_application', status: 'unsupported' },
  { feature: 'automatic_payment', status: 'unsupported' },
  { feature: 'automatic_settlement_mutation', status: 'unsupported' },
  { feature: 'automatic_contract_execution', status: 'unsupported' },
  { feature: 'automatic_infrastructure_purchase', status: 'unsupported' },
  { feature: 'automatic_rollout', status: 'unsupported' },
  { feature: 'automatic_rollback', status: 'unsupported' },
  { feature: 'automatic_production_mutation', status: 'unsupported' },
];
