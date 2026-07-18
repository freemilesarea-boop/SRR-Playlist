/**
 * resourceAllocation — Enterprise Resource Intelligence, Capital Allocation &
 * Capacity Planning Center 순수 로직 (Phase AI-OPS-42).
 *
 * Resource Inventory → Availability → Human/Technical/Operational Capacity →
 * Financial Envelope → Initiative Demand → Demand Forecast → Conflict →
 * Capacity/Funding/Workforce Gap → Allocation Option → Opportunity Cost →
 * Capital Efficiency → Trade-off/Robustness/Regret/Reversibility/Feasibility →
 * Capacity Plan → Human Resource/Finance Review → Approval Reference →
 * Outcome → Quality/Drift → Learning.
 *
 * 정직성(전부 코드로 강제):
 *  - Inventory ≠ Verified Physical Inventory. Availability ≠ Guarantee.
 *  - Demand ≠ Reserved Resource. Reservation Candidate ≠ Actual Reservation.
 *  - Allocation Option ≠ Allocated Resource. Approval Reference ≠ Budget Execution.
 *  - Budget Reference ≠ Available Cash. Cash Flow ≠ Bank Balance.
 *  - Capacity/Compute/Storage Candidate ≠ Provisioned. Gap ≠ Confirmed 부족.
 *  - Opportunity Cost ≠ 확정 손실. Capital Efficiency ≠ 회계 ROI.
 *  - High Utilization ≠ Healthy. Low Utilization ≠ 낭비.
 *  - Robust ≠ Correct. Lowest Regret ≠ Best. Reversible ≠ Guaranteed Recovery.
 *  - Outcome ≠ Allocation Causality. Drift ≠ 자동 재배분 신호.
 *  - Unknown 유지(null→0 금지) · deterministic · pure · NaN/Infinity 방어 · Date 주입.
 */
import { isFiniteNumber, clampScore } from './aiMemory';

/* ── 상수(0546 CHECK와 1:1 정렬) ─────────────────────────────────────── */
export const RESOURCE_DOMAINS = ['human_capacity', 'reviewer_capacity', 'specialist_capacity', 'operational_capacity', 'technical_capacity', 'engineering_capacity', 'ai_agent_capacity_reference', 'connector_capacity', 'provider_capacity', 'compute_capacity', 'storage_capacity', 'network_capacity', 'database_capacity', 'api_capacity', 'queue_capacity', 'workflow_capacity', 'incident_response_capacity', 'customer_support_capacity', 'store_operations_capacity', 'content_operations_capacity', 'music_quality_capacity', 'playlist_operations_capacity', 'financial_envelope_reference', 'budget_envelope_reference', 'cost_envelope_reference', 'cash_flow_reference', 'contract_capacity_reference', 'strategic_reserve_reference', 'contingency_capacity_reference', 'custom_reference'] as const;
export const BLOCKED_RESOURCE_DOMAINS = ['automatic_budget_allocation', 'automatic_resource_allocation', 'automatic_employee_assignment', 'automatic_hiring', 'automatic_termination', 'automatic_compensation', 'automatic_payment_execution', 'automatic_refund_execution', 'automatic_contract_execution', 'automatic_provider_purchase', 'automatic_compute_provisioning', 'automatic_storage_provisioning', 'automatic_capacity_scaling', 'automatic_infrastructure_purchase', 'automatic_production_change', 'automatic_policy_application', 'personal_performance_scoring', 'credit_decision', 'medical_resource_decision'] as const;
export const RESOURCE_TYPES = ['person_hour_reference', 'reviewer_hour_reference', 'specialist_hour_reference', 'operational_slot_reference', 'technical_slot_reference', 'compute_unit_reference', 'storage_unit_reference', 'network_unit_reference', 'api_quota_reference', 'connector_slot_reference', 'provider_quota_reference', 'database_capacity_reference', 'queue_capacity_reference', 'workflow_capacity_reference', 'budget_amount_reference', 'cost_limit_reference', 'cash_flow_reference', 'contingency_reserve_reference', 'strategic_reserve_reference', 'contract_capacity_reference', 'custom_reference'] as const;
export const RESOURCE_STATUSES = ['draft', 'pending_evidence', 'pending_review', 'available_candidate', 'partially_available_candidate', 'committed_reference', 'reserved_reference', 'constrained_candidate', 'bottleneck_candidate', 'exhausted_candidate', 'unavailable_reference', 'stale_candidate', 'superseded', 'invalidated', 'insufficient_data'] as const;
export const AVAILABILITY_RESULTS = ['availability_ready_reference', 'high_availability_candidate', 'moderate_availability_candidate', 'low_availability_candidate', 'constrained_availability_candidate', 'unavailable_candidate', 'availability_unverified', 'insufficient_data'] as const;
export const FRESHNESS_RESULTS = ['current_reference', 'recently_observed_reference', 'stale_resource_candidate', 'severely_stale_candidate', 'freshness_unverified', 'insufficient_data'] as const;
export const RELIABILITY_RESULTS = ['high_reliability_candidate', 'moderate_reliability_candidate', 'low_reliability_candidate', 'conflicting_source_candidate', 'reliability_unverified', 'insufficient_data'] as const;
export const HUMAN_CAPACITY_RESULTS = ['capacity_available_candidate', 'capacity_tight_candidate', 'workload_pressure_candidate', 'workload_overload_candidate', 'reviewer_bottleneck_candidate', 'specialist_bottleneck_candidate', 'capacity_unverified', 'insufficient_data'] as const;
export const TECHNICAL_CAPACITY_RESULTS = ['capacity_available_candidate', 'capacity_tight_candidate', 'capacity_bottleneck_candidate', 'capacity_exhaustion_candidate', 'single_point_dependency_candidate', 'capacity_unverified', 'insufficient_data'] as const;
export const FINANCIAL_ENVELOPE_TYPES = ['operating_budget_reference', 'strategic_budget_reference', 'initiative_budget_reference', 'contingency_budget_reference', 'infrastructure_budget_reference', 'provider_budget_reference', 'connector_budget_reference', 'staffing_budget_reference', 'marketing_budget_reference', 'content_budget_reference', 'reserve_reference', 'cash_flow_reference', 'cost_limit_reference', 'custom_reference'] as const;
export const RESOURCE_DEMAND_STATUSES = ['draft', 'pending_evidence', 'pending_review', 'demand_ready_reference', 'partially_defined_candidate', 'resource_gap_candidate', 'funding_gap_candidate', 'capacity_gap_candidate', 'blocked_candidate', 'deferred_reference', 'superseded', 'invalidated', 'insufficient_data'] as const;
export const DEMAND_FORECAST_TYPES = ['fixed_demand_reference', 'phased_demand_reference', 'rolling_demand_reference', 'growth_linked_demand_reference', 'store_count_linked_reference', 'customer_count_linked_reference', 'workload_linked_reference', 'incident_linked_reference', 'scenario_derived_reference', 'manual_reference', 'insufficient_data'] as const;
export const DEMAND_FORECAST_RESULTS = ['demand_forecast_ready_reference', 'demand_forecast_partial', 'peak_demand_candidate', 'accelerating_demand_candidate', 'volatile_demand_candidate', 'forecast_unverified', 'insufficient_data'] as const;
export const RESOURCE_CONFLICT_RESULTS = ['no_material_conflict_candidate', 'minor_conflict_candidate', 'moderate_conflict_candidate', 'major_conflict_candidate', 'structural_conflict_candidate', 'double_allocation_candidate', 'conflict_unverified', 'insufficient_data'] as const;
export const OVERCOMMITMENT_RESULTS = ['no_overcommitment_candidate', 'near_overcommitment_candidate', 'overcommitment_candidate', 'severe_overcommitment_candidate', 'overcommitment_unverified', 'insufficient_data'] as const;
export const UNDERUTILIZATION_RESULTS = ['healthy_headroom_candidate', 'moderate_underutilization_candidate', 'high_underutilization_candidate', 'strategic_reserve_candidate', 'underutilization_unverified', 'insufficient_data'] as const;
export const CAPACITY_GAP_RESULTS = ['no_capacity_gap_candidate', 'minor_capacity_gap_candidate', 'moderate_capacity_gap_candidate', 'severe_capacity_gap_candidate', 'critical_capacity_gap_candidate', 'capacity_gap_unverified', 'insufficient_data'] as const;
export const FUNDING_GAP_RESULTS = ['no_funding_gap_candidate', 'minor_funding_gap_candidate', 'moderate_funding_gap_candidate', 'severe_funding_gap_candidate', 'critical_funding_gap_candidate', 'funding_gap_unverified', 'insufficient_data'] as const;
export const WORKFORCE_GAP_RESULTS = ['no_workforce_gap_candidate', 'minor_workforce_gap_candidate', 'moderate_workforce_gap_candidate', 'severe_workforce_gap_candidate', 'specialist_gap_candidate', 'reviewer_gap_candidate', 'workforce_gap_unverified', 'insufficient_data'] as const;
export const ALLOCATION_OPTION_TYPES = ['no_allocation_reference', 'defer_allocation_reference', 'partial_allocation_reference', 'conditional_allocation_reference', 'phased_allocation_reference', 'reversible_allocation_reference', 'shared_allocation_reference', 'reserve_capacity_reference', 'contingency_allocation_reference', 'substitute_resource_reference', 'rebalance_candidate', 'budget_constrained_reference', 'capacity_constrained_reference', 'workload_constrained_reference', 'custom_reference'] as const;
export const BLOCKED_ALLOCATION_TYPES = ['direct_budget_execution', 'direct_resource_assignment', 'automatic_employee_assignment', 'automatic_payment_execution', 'automatic_provider_purchase', 'automatic_compute_provisioning', 'automatic_infrastructure_purchase'] as const;
export const ALLOCATION_OPTION_STATUSES = ['draft', 'pending_evidence', 'pending_review', 'viable_candidate', 'conditionally_viable_candidate', 'capacity_constrained_candidate', 'funding_constrained_candidate', 'workload_constrained_candidate', 'blocked_candidate', 'infeasible_candidate', 'rejected_reference', 'deferred_reference', 'superseded', 'invalidated', 'insufficient_data'] as const;
export const OPPORTUNITY_COST_RESULTS = ['low_opportunity_cost_candidate', 'moderate_opportunity_cost_candidate', 'high_opportunity_cost_candidate', 'asymmetric_opportunity_cost_candidate', 'opportunity_cost_unverified', 'insufficient_data'] as const;
export const CAPITAL_EFFICIENCY_RESULTS = ['high_efficiency_candidate', 'moderate_efficiency_candidate', 'low_efficiency_candidate', 'mixed_efficiency_candidate', 'efficiency_unverified', 'insufficient_data'] as const;
export const UTILIZATION_RESULTS = ['healthy_utilization_candidate', 'high_utilization_candidate', 'overload_utilization_candidate', 'low_utilization_candidate', 'utilization_unverified', 'insufficient_data'] as const;
export const ALLOCATION_TRADEOFF_AXES = ['short_term_cost_vs_long_term_capability', 'revenue_vs_capability', 'budget_vs_capacity', 'concentration_vs_diversification', 'utilization_vs_headroom', 'fixed_vs_variable_cost', 'speed_vs_safety', 'growth_vs_stability', 'reserve_vs_deployment', 'automation_vs_human_control'] as const;
export const ALLOCATION_TRADEOFF_RESULTS = ['favorable_tradeoff_candidate', 'balanced_tradeoff_candidate', 'unfavorable_tradeoff_candidate', 'mixed_tradeoff_candidate', 'tradeoff_unverified', 'insufficient_data'] as const;
export const ALLOCATION_ROBUSTNESS_RESULTS = ['robust_allocation_candidate', 'conditionally_robust_candidate', 'fragile_allocation_candidate', 'scenario_specific_candidate', 'robustness_unverified', 'insufficient_data'] as const;
export const ALLOCATION_REGRET_RESULTS = ['lowest_regret_allocation_candidate', 'low_regret_candidate', 'moderate_regret_candidate', 'high_regret_candidate', 'asymmetric_regret_candidate', 'regret_unverified', 'insufficient_data'] as const;
export const ALLOCATION_REVERSIBILITY_RESULTS = ['highly_reversible_candidate', 'reversible_with_condition_candidate', 'partially_reversible_candidate', 'difficult_to_reverse_candidate', 'irreversible_candidate', 'reversibility_unverified', 'insufficient_data'] as const;
export const ALLOCATION_FEASIBILITY_RESULTS = ['feasible_allocation_candidate', 'conditionally_feasible_candidate', 'feasibility_blocked_candidate', 'feasibility_unverified', 'insufficient_data'] as const;
export const ALLOCATION_RECOMMENDATION_TYPES = ['create_resource_inventory', 'review_resource_freshness', 'review_resource_reliability', 'review_availability', 'create_resource_demand', 'review_demand_forecast', 'review_resource_conflict', 'review_overcommitment', 'review_underutilization', 'review_capacity_gap', 'review_funding_gap', 'review_workforce_gap', 'create_allocation_option', 'create_partial_allocation_candidate', 'create_phased_allocation_candidate', 'create_reversible_allocation_candidate', 'create_reserve_capacity_candidate', 'defer_allocation_candidate', 'rebalance_allocation_candidate', 'review_opportunity_cost', 'review_capital_efficiency', 'gather_more_evidence_candidate', 'request_specialist_review_candidate', 'request_finance_review', 'request_resource_review', 'request_executive_review', 'record_allocation_approval_reference', 'link_budget_reference', 'link_commitment_reference', 'link_resource_outcome', 'review_allocation_quality', 'review_resource_drift', 'record_resource_learning_reference', 'insufficient_data'] as const;
export const ALLOCATION_REVIEW_ACTIONS = ['request_evidence', 'start_review', 'mark_viable', 'mark_conditionally_viable', 'mark_capacity_constrained', 'mark_funding_constrained', 'mark_workload_constrained', 'mark_blocked', 'mark_infeasible', 'approve_allocation_reference', 'approve_with_conditions_reference', 'reject_allocation_reference', 'defer_allocation_reference', 'request_revision_reference', 'supersede', 'invalidate'] as const;
export const ALLOCATION_QUALITY_RESULTS = ['high_quality_candidate', 'moderate_quality_candidate', 'low_quality_candidate', 'mixed_quality_candidate', 'outcome_unverified', 'causality_unverified', 'sample_too_small', 'insufficient_data'] as const;
export const RESOURCE_DRIFT_RESULTS = ['no_material_drift_candidate', 'minor_drift_candidate', 'moderate_drift_candidate', 'severe_drift_candidate', 'structural_drift_candidate', 'drift_unverified', 'insufficient_data'] as const;
export const ALLOCATION_DRIFT_RESULTS = ['no_material_allocation_drift_candidate', 'minor_allocation_drift_candidate', 'moderate_allocation_drift_candidate', 'severe_allocation_drift_candidate', 'structural_allocation_drift_candidate', 'allocation_drift_unverified', 'insufficient_data'] as const;
export const RESOURCE_TIMELINE_STAGES = ['resource_inventory', 'availability', 'capacity_review', 'financial_envelope', 'resource_demand', 'demand_forecast', 'conflict_review', 'gap_review', 'allocation_option', 'human_allocation_review', 'approval_reference', 'outcome'] as const;

/* ── 1) Resource Inventory(자산 원장 아님) ───────────────────────────── */
export function buildResourceInventory(i: { domain: string; name: string; resourceType: string }):
  | { rejected: true; rejectReason: string }
  | { domain: string; name: string; resourceType: string; status: 'draft'; inventoryIsNotLedger: true; autoAllocated: false; budgetAllocated: false } {
  if ((BLOCKED_RESOURCE_DOMAINS as readonly string[]).includes(i.domain)) return { rejected: true, rejectReason: `금지 resource domain(${i.domain}) — 구조적 차단` };
  if (!(RESOURCE_DOMAINS as readonly string[]).includes(i.domain)) return { rejected: true, rejectReason: '허용되지 않는 resource_domain' };
  if (!(RESOURCE_TYPES as readonly string[]).includes(i.resourceType)) return { rejected: true, rejectReason: '허용되지 않는 resource_type' };
  if (!i.name.trim()) return { rejected: true, rejectReason: 'resource_name 필수' };
  return { domain: i.domain, name: i.name, resourceType: i.resourceType, status: 'draft', inventoryIsNotLedger: true, autoAllocated: false, budgetAllocated: false };
}

/* ── 2) Availability(보장 아님) ──────────────────────────────────────── */
export function evaluateResourceAvailability(i: { total: number | null; committed: number | null; reserved: number | null; maintenanceBlocked: number | null; constraintPresent: boolean; sourceVerified: boolean }): { availableCandidate: number | null; result: (typeof AVAILABILITY_RESULTS)[number]; availabilityIsNotGuarantee: true } {
  const flags = { availabilityIsNotGuarantee: true as const };
  if (!i.sourceVerified) return { availableCandidate: null, result: 'availability_unverified', ...flags };
  if (i.total == null) return { availableCandidate: null, result: 'insufficient_data', ...flags };
  if (!isFiniteNumber(i.total) || i.total < 0 || (i.committed != null && !isFiniteNumber(i.committed)) || (i.reserved != null && !isFiniteNumber(i.reserved))) return { availableCandidate: null, result: 'availability_unverified', ...flags };
  const used = (i.committed ?? 0) + (i.reserved ?? 0) + (i.maintenanceBlocked ?? 0);
  const available = Math.max(0, Math.round((i.total - used) * 100) / 100);
  if (i.total === 0 || available === 0) return { availableCandidate: available, result: 'unavailable_candidate', ...flags };
  const pct = available / i.total;
  if (i.constraintPresent) return { availableCandidate: available, result: 'constrained_availability_candidate', ...flags };
  if (pct >= 0.6) return { availableCandidate: available, result: 'high_availability_candidate', ...flags };
  if (pct >= 0.3) return { availableCandidate: available, result: 'moderate_availability_candidate', ...flags };
  return { availableCandidate: available, result: 'low_availability_candidate', ...flags };
}

/* ── 3) Freshness(24h/7d/30d 기준) ───────────────────────────────────── */
export function evaluateResourceFreshness(i: { observedAt: Date | null; now: Date }): { ageHours: number | null; result: (typeof FRESHNESS_RESULTS)[number]; staleDataKept: true } {
  const flags = { staleDataKept: true as const };
  if (i.observedAt == null) return { ageHours: null, result: 'freshness_unverified', ...flags };
  const ageHours = (i.now.getTime() - i.observedAt.getTime()) / 3600000;
  if (!isFiniteNumber(ageHours) || ageHours < 0) return { ageHours: null, result: 'freshness_unverified', ...flags };
  const rounded = Math.round(ageHours * 10) / 10;
  if (ageHours <= 24) return { ageHours: rounded, result: 'current_reference', ...flags };
  if (ageHours <= 24 * 7) return { ageHours: rounded, result: 'recently_observed_reference', ...flags };
  if (ageHours <= 24 * 30) return { ageHours: rounded, result: 'stale_resource_candidate', ...flags };
  return { ageHours: rounded, result: 'severely_stale_candidate', ...flags };
}

/* ── 4) Reliability(Source 없으면 unverified) ────────────────────────── */
export function evaluateResourceReliability(i: { sourceCount: number | null; conflictingSources: boolean; manualEntryOnly: boolean; externallyVerified: boolean; completenessPct: number | null }): { result: (typeof RELIABILITY_RESULTS)[number]; sourceUnverifiedKept: true } {
  const flags = { sourceUnverifiedKept: true as const };
  if (i.sourceCount == null || !isFiniteNumber(i.sourceCount)) return { result: 'insufficient_data', ...flags };
  if (i.sourceCount === 0) return { result: 'reliability_unverified', ...flags };
  if (i.conflictingSources) return { result: 'conflicting_source_candidate', ...flags };
  if (i.externallyVerified && i.completenessPct != null && isFiniteNumber(i.completenessPct) && i.completenessPct >= 80) return { result: 'high_reliability_candidate', ...flags };
  if (i.manualEntryOnly) return { result: 'low_reliability_candidate', ...flags };
  return { result: 'moderate_reliability_candidate', ...flags };
}

/* ── 5) Human Capacity(개인 평가 아님) ───────────────────────────────── */
export function evaluateHumanCapacity(i: { availableHours: number | null; committedHours: number | null; plannedHours: number | null; overloadThresholdPct: number; reviewerAvailable: boolean | null; specialistAvailable: boolean | null }): { loadPct: number | null; result: (typeof HUMAN_CAPACITY_RESULTS)[number]; notUsedForPerformanceReview: true } {
  const flags = { notUsedForPerformanceReview: true as const };
  if (i.availableHours == null || !isFiniteNumber(i.availableHours) || i.availableHours <= 0) return { loadPct: null, result: 'capacity_unverified', ...flags };
  if (i.reviewerAvailable === false) return { loadPct: null, result: 'reviewer_bottleneck_candidate', ...flags };
  if (i.specialistAvailable === false) return { loadPct: null, result: 'specialist_bottleneck_candidate', ...flags };
  if (i.committedHours == null || i.plannedHours == null) return { loadPct: null, result: 'insufficient_data', ...flags };
  if (!isFiniteNumber(i.committedHours) || !isFiniteNumber(i.plannedHours)) return { loadPct: null, result: 'capacity_unverified', ...flags };
  const loadPct = Math.round(((i.committedHours + i.plannedHours) / i.availableHours) * 1000) / 10;
  if (loadPct > i.overloadThresholdPct) return { loadPct, result: 'workload_overload_candidate', ...flags };
  if (loadPct > i.overloadThresholdPct * 0.85) return { loadPct, result: 'workload_pressure_candidate', ...flags };
  if (loadPct > 70) return { loadPct, result: 'capacity_tight_candidate', ...flags };
  return { loadPct, result: 'capacity_available_candidate', ...flags };
}

/* ── 6) Technical Capacity(Provisioned 아님) ─────────────────────────── */
export function evaluateTechnicalCapacity(i: { current: number | null; forecastPeak: number | null; safetyMarginPct: number; singlePointDependency: boolean }): { peakUtilizationPct: number | null; result: (typeof TECHNICAL_CAPACITY_RESULTS)[number]; capacityIsNotProvisioned: true } {
  const flags = { capacityIsNotProvisioned: true as const };
  if (i.current == null || i.forecastPeak == null) return { peakUtilizationPct: null, result: 'capacity_unverified', ...flags };
  if (!isFiniteNumber(i.current) || !isFiniteNumber(i.forecastPeak) || i.current <= 0) return { peakUtilizationPct: null, result: 'capacity_unverified', ...flags };
  const pct = Math.round((i.forecastPeak / i.current) * 1000) / 10;
  if (i.singlePointDependency) return { peakUtilizationPct: pct, result: 'single_point_dependency_candidate', ...flags };
  if (pct >= 100) return { peakUtilizationPct: pct, result: 'capacity_exhaustion_candidate', ...flags };
  if (pct >= 100 - i.safetyMarginPct) return { peakUtilizationPct: pct, result: 'capacity_bottleneck_candidate', ...flags };
  if (pct >= 70) return { peakUtilizationPct: pct, result: 'capacity_tight_candidate', ...flags };
  return { peakUtilizationPct: pct, result: 'capacity_available_candidate', ...flags };
}

/* ── 7) Demand(예약 아님) / Demand Forecast ──────────────────────────── */
export function buildResourceDemand(i: { domain: string; name: string; requiredQuantity: number | null; minimumQuantity: number | null }):
  | { rejected: true; rejectReason: string }
  | { domain: string; name: string; status: 'draft'; demandIsNotReservation: true; activeUsage: false } {
  if ((BLOCKED_RESOURCE_DOMAINS as readonly string[]).includes(i.domain)) return { rejected: true, rejectReason: `금지 resource domain(${i.domain})` };
  if (!(RESOURCE_DOMAINS as readonly string[]).includes(i.domain)) return { rejected: true, rejectReason: '허용되지 않는 resource_domain' };
  if (!i.name.trim()) return { rejected: true, rejectReason: 'demand_name 필수' };
  if (i.requiredQuantity != null && (!isFiniteNumber(i.requiredQuantity) || i.requiredQuantity < 0)) return { rejected: true, rejectReason: '음수/비정상 quantity 차단' };
  if (i.minimumQuantity != null && i.requiredQuantity != null && i.minimumQuantity > i.requiredQuantity) return { rejected: true, rejectReason: 'minimum > required 불일치' };
  return { domain: i.domain, name: i.name, status: 'draft', demandIsNotReservation: true, activeUsage: false };
}

export function evaluateDemandForecast(i: { forecastType: string; samples: number[] | null; minSamples: number }): { result: (typeof DEMAND_FORECAST_RESULTS)[number]; forecastIsNotFutureFact: true; historicalUsageIsNotFutureUsage: true } {
  const flags = { forecastIsNotFutureFact: true as const, historicalUsageIsNotFutureUsage: true as const };
  if (!(DEMAND_FORECAST_TYPES as readonly string[]).includes(i.forecastType)) return { result: 'forecast_unverified', ...flags };
  if (i.samples == null) return { result: 'insufficient_data', ...flags };
  if (i.samples.some((s) => !isFiniteNumber(s))) return { result: 'forecast_unverified', ...flags };
  if (i.samples.length < i.minSamples) return { result: 'demand_forecast_partial', ...flags };
  const mean = i.samples.reduce((a, b) => a + b, 0) / i.samples.length;
  const max = Math.max(...i.samples);
  const half = Math.floor(i.samples.length / 2);
  const firstMean = i.samples.slice(0, half).reduce((a, b) => a + b, 0) / Math.max(1, half);
  const secondMean = i.samples.slice(half).reduce((a, b) => a + b, 0) / Math.max(1, i.samples.length - half);
  const variance = i.samples.reduce((a, b) => a + (b - mean) ** 2, 0) / i.samples.length;
  if (mean > 0 && Math.sqrt(variance) / mean > 0.5) return { result: 'volatile_demand_candidate', ...flags };
  if (firstMean > 0 && secondMean > firstMean * 1.5) return { result: 'accelerating_demand_candidate', ...flags };
  if (mean > 0 && max > mean * 2) return { result: 'peak_demand_candidate', ...flags };
  return { result: 'demand_forecast_ready_reference', ...flags };
}

/* ── 8) Conflict(자동 제거 아님) — 동일 자원/기간 경쟁 탐지 ──────────── */
export function detectResourceConflicts(demands: { demandCode: string; resourceKey: string; start: number; end: number; quantity: number }[] | null, capacity: Record<string, number>): { conflicts: { resourceKey: string; demandCodes: string[]; totalQuantity: number; capacity: number | null }[]; result: (typeof RESOURCE_CONFLICT_RESULTS)[number]; conflictIsNotAutomaticRemoval: true } {
  const flags = { conflictIsNotAutomaticRemoval: true as const };
  if (demands == null) return { conflicts: [], result: 'insufficient_data', ...flags };
  if (demands.some((d) => !isFiniteNumber(d.quantity) || d.quantity < 0 || d.end <= d.start)) return { conflicts: [], result: 'conflict_unverified', ...flags };
  const byResource = new Map<string, typeof demands>();
  demands.forEach((d) => byResource.set(d.resourceKey, [...(byResource.get(d.resourceKey) ?? []), d]));
  const conflicts: { resourceKey: string; demandCodes: string[]; totalQuantity: number; capacity: number | null }[] = [];
  let doubleAllocation = false;
  byResource.forEach((list, resourceKey) => {
    const overlapping = list.filter((a) => list.some((b) => b !== a && a.start < b.end && b.start < a.end));
    if (overlapping.length >= 2) {
      const totalQuantity = overlapping.reduce((s, d) => s + d.quantity, 0);
      const cap = capacity[resourceKey];
      conflicts.push({ resourceKey, demandCodes: overlapping.map((d) => d.demandCode).sort(), totalQuantity, capacity: cap ?? null });
      if (cap != null && isFiniteNumber(cap) && totalQuantity > cap) doubleAllocation = true;
    }
  });
  if (!conflicts.length) return { conflicts, result: 'no_material_conflict_candidate', ...flags };
  if (doubleAllocation) return { conflicts, result: 'double_allocation_candidate', ...flags };
  if (conflicts.length >= 4) return { conflicts, result: 'structural_conflict_candidate', ...flags };
  if (conflicts.length >= 3) return { conflicts, result: 'major_conflict_candidate', ...flags };
  if (conflicts.length === 2) return { conflicts, result: 'moderate_conflict_candidate', ...flags };
  return { conflicts, result: 'minor_conflict_candidate', ...flags };
}

/* ── 9) Overcommitment / Underutilization ────────────────────────────── */
export function evaluateOvercommitment(i: { total: number | null; committed: number | null; reserved: number | null; plannedDemand: number | null; safetyMarginPct: number }): { commitmentPct: number | null; result: (typeof OVERCOMMITMENT_RESULTS)[number]; overcommitmentIsNotConfirmedFailure: true } {
  const flags = { overcommitmentIsNotConfirmedFailure: true as const };
  if (i.total == null || !isFiniteNumber(i.total) || i.total <= 0) return { commitmentPct: null, result: 'overcommitment_unverified', ...flags };
  if (i.committed == null || i.plannedDemand == null) return { commitmentPct: null, result: 'insufficient_data', ...flags };
  if (!isFiniteNumber(i.committed) || !isFiniteNumber(i.plannedDemand) || (i.reserved != null && !isFiniteNumber(i.reserved))) return { commitmentPct: null, result: 'overcommitment_unverified', ...flags };
  const pct = Math.round(((i.committed + (i.reserved ?? 0) + i.plannedDemand) / i.total) * 1000) / 10;
  if (pct > 120) return { commitmentPct: pct, result: 'severe_overcommitment_candidate', ...flags };
  if (pct > 100) return { commitmentPct: pct, result: 'overcommitment_candidate', ...flags };
  if (pct > 100 - i.safetyMarginPct) return { commitmentPct: pct, result: 'near_overcommitment_candidate', ...flags };
  return { commitmentPct: pct, result: 'no_overcommitment_candidate', ...flags };
}

export function evaluateUnderutilization(i: { available: number | null; actualUsage: number | null; strategicReserve: boolean; contractMinimum: number | null }): { usagePct: number | null; result: (typeof UNDERUTILIZATION_RESULTS)[number]; lowUtilizationIsNotWaste: true } {
  const flags = { lowUtilizationIsNotWaste: true as const };
  if (i.available == null || !isFiniteNumber(i.available) || i.available <= 0) return { usagePct: null, result: 'underutilization_unverified', ...flags };
  if (i.actualUsage == null) return { usagePct: null, result: 'insufficient_data', ...flags };
  if (!isFiniteNumber(i.actualUsage)) return { usagePct: null, result: 'underutilization_unverified', ...flags };
  const usagePct = Math.round((i.actualUsage / i.available) * 1000) / 10;
  if (i.strategicReserve) return { usagePct, result: 'strategic_reserve_candidate', ...flags };
  if (usagePct < 20) return { usagePct, result: 'high_underutilization_candidate', ...flags };
  if (usagePct < 50) return { usagePct, result: 'moderate_underutilization_candidate', ...flags };
  return { usagePct, result: 'healthy_headroom_candidate', ...flags };
}

/* ── 10) Capacity / Funding Gap(Confirmed 아님) ──────────────────────── */
export function calculateCapacityGap(i: { required: number | null; available: number | null; safetyMarginPct: number }): { gapQuantity: number | null; gapPct: number | null; result: (typeof CAPACITY_GAP_RESULTS)[number]; gapIsNotConfirmedShortage: true } {
  const flags = { gapIsNotConfirmedShortage: true as const };
  if (i.required == null || i.available == null) return { gapQuantity: null, gapPct: null, result: 'capacity_gap_unverified', ...flags };
  if (!isFiniteNumber(i.required) || !isFiniteNumber(i.available) || i.required < 0) return { gapQuantity: null, gapPct: null, result: 'capacity_gap_unverified', ...flags };
  const effective = i.available * (1 - i.safetyMarginPct / 100);
  const gap = Math.round((i.required - effective) * 100) / 100;
  const gapPct = i.required > 0 ? Math.round((gap / i.required) * 1000) / 10 : 0;
  if (gap <= 0) return { gapQuantity: 0, gapPct: 0, result: 'no_capacity_gap_candidate', ...flags };
  if (gapPct >= 50) return { gapQuantity: gap, gapPct, result: 'critical_capacity_gap_candidate', ...flags };
  if (gapPct >= 30) return { gapQuantity: gap, gapPct, result: 'severe_capacity_gap_candidate', ...flags };
  if (gapPct >= 10) return { gapQuantity: gap, gapPct, result: 'moderate_capacity_gap_candidate', ...flags };
  return { gapQuantity: gap, gapPct, result: 'minor_capacity_gap_candidate', ...flags };
}

export function calculateFundingGap(i: { requiredFunding: number | null; availableBudgetReference: number | null; contingencyRequired: number | null }): { gapAmount: number | null; result: (typeof FUNDING_GAP_RESULTS)[number]; fundingGapIsNotAccountingDeficit: true; budgetReferenceIsNotCash: true } {
  const flags = { fundingGapIsNotAccountingDeficit: true as const, budgetReferenceIsNotCash: true as const };
  if (i.availableBudgetReference == null) return { gapAmount: null, result: 'funding_gap_unverified', ...flags };
  if (i.requiredFunding == null) return { gapAmount: null, result: 'insufficient_data', ...flags };
  if (!isFiniteNumber(i.requiredFunding) || !isFiniteNumber(i.availableBudgetReference) || (i.contingencyRequired != null && !isFiniteNumber(i.contingencyRequired))) return { gapAmount: null, result: 'funding_gap_unverified', ...flags };
  const gap = Math.round((i.requiredFunding + (i.contingencyRequired ?? 0) - i.availableBudgetReference) * 100) / 100;
  if (gap <= 0) return { gapAmount: 0, result: 'no_funding_gap_candidate', ...flags };
  const pct = i.requiredFunding > 0 ? gap / i.requiredFunding : 1;
  if (pct >= 0.5) return { gapAmount: gap, result: 'critical_funding_gap_candidate', ...flags };
  if (pct >= 0.3) return { gapAmount: gap, result: 'severe_funding_gap_candidate', ...flags };
  if (pct >= 0.1) return { gapAmount: gap, result: 'moderate_funding_gap_candidate', ...flags };
  return { gapAmount: gap, result: 'minor_funding_gap_candidate', ...flags };
}

/* ── 11) Allocation Option(배정 아님) ────────────────────────────────── */
export function buildAllocationOption(i: { optionType: string; name: string }):
  | { rejected: true; rejectReason: string }
  | { optionType: string; name: string; status: 'draft'; optionIsNotAllocatedResource: true; budgetAllocated: false; resourcesAllocated: false; capacityProvisioned: false } {
  if ((BLOCKED_ALLOCATION_TYPES as readonly string[]).includes(i.optionType)) return { rejected: true, rejectReason: `금지 option_type(${i.optionType}) — 구조적 차단` };
  if (!(ALLOCATION_OPTION_TYPES as readonly string[]).includes(i.optionType)) return { rejected: true, rejectReason: '허용되지 않는 option_type' };
  if (!i.name.trim()) return { rejected: true, rejectReason: 'allocation_name 필수' };
  return { optionType: i.optionType, name: i.name, status: 'draft', optionIsNotAllocatedResource: true, budgetAllocated: false, resourcesAllocated: false, capacityProvisioned: false };
}

/* ── 12) Opportunity Cost(확정 손실 아님) ────────────────────────────── */
export function evaluateOpportunityCost(i: { forgoneStrategicValue: number | null; forgoneRevenueReference: number | null; delayCostKnown: boolean; irreversibleLoss: boolean }): { result: (typeof OPPORTUNITY_COST_RESULTS)[number]; opportunityCostIsNotConfirmedLoss: true } {
  const flags = { opportunityCostIsNotConfirmedLoss: true as const };
  if (i.forgoneStrategicValue == null && i.forgoneRevenueReference == null) return { result: 'insufficient_data', ...flags };
  if ((i.forgoneStrategicValue != null && !isFiniteNumber(i.forgoneStrategicValue)) || (i.forgoneRevenueReference != null && !isFiniteNumber(i.forgoneRevenueReference))) return { result: 'opportunity_cost_unverified', ...flags };
  const value = Math.max(i.forgoneStrategicValue ?? 0, 0);
  if (i.irreversibleLoss && value >= 60) return { result: 'asymmetric_opportunity_cost_candidate', ...flags };
  if (value >= 60) return { result: 'high_opportunity_cost_candidate', ...flags };
  if (value >= 30 || i.delayCostKnown) return { result: 'moderate_opportunity_cost_candidate', ...flags };
  return { result: 'low_opportunity_cost_candidate', ...flags };
}

/* ── 13) Capital Efficiency(회계 ROI 아님) ───────────────────────────── */
export function evaluateCapitalEfficiency(i: { strategicValue: number | null; requiredBudget: number | null; timeToValueMonths: number | null; adverseSignal: boolean }): { result: (typeof CAPITAL_EFFICIENCY_RESULTS)[number]; efficiencyIsNotAccountingRoi: true } {
  const flags = { efficiencyIsNotAccountingRoi: true as const };
  if (i.strategicValue == null || i.requiredBudget == null) return { result: 'insufficient_data', ...flags };
  if (!isFiniteNumber(i.strategicValue) || !isFiniteNumber(i.requiredBudget) || i.requiredBudget <= 0) return { result: 'efficiency_unverified', ...flags };
  const ratio = clampScore(i.strategicValue) / i.requiredBudget;
  if (i.adverseSignal && ratio >= 0.5) return { result: 'mixed_efficiency_candidate', ...flags };
  if (i.timeToValueMonths != null && isFiniteNumber(i.timeToValueMonths) && i.timeToValueMonths > 24 && ratio < 0.5) return { result: 'low_efficiency_candidate', ...flags };
  if (ratio >= 1) return { result: 'high_efficiency_candidate', ...flags };
  if (ratio >= 0.4) return { result: 'moderate_efficiency_candidate', ...flags };
  return { result: 'low_efficiency_candidate', ...flags };
}

/* ── 14) Utilization(High ≠ Healthy·Low ≠ 낭비) ──────────────────────── */
export function evaluateResourceUtilization(i: { utilizationPct: number | null; overloadThresholdPct: number }): { result: (typeof UTILIZATION_RESULTS)[number]; highUtilizationIsNotHealthy: true; lowUtilizationIsNotWaste: true } {
  const flags = { highUtilizationIsNotHealthy: true as const, lowUtilizationIsNotWaste: true as const };
  if (i.utilizationPct == null) return { result: 'insufficient_data', ...flags };
  if (!isFiniteNumber(i.utilizationPct) || i.utilizationPct < 0) return { result: 'utilization_unverified', ...flags };
  if (i.utilizationPct >= i.overloadThresholdPct) return { result: 'overload_utilization_candidate', ...flags };
  if (i.utilizationPct >= 75) return { result: 'high_utilization_candidate', ...flags };
  if (i.utilizationPct < 30) return { result: 'low_utilization_candidate', ...flags };
  return { result: 'healthy_utilization_candidate', ...flags };
}

/* ── 15) Trade-off / Robustness / Regret / Reversibility / Feasibility ─ */
export function evaluateAllocationTradeoffs(i: { axis: string; sideAScore: number | null; sideBScore: number | null }): { axis: string | null; result: (typeof ALLOCATION_TRADEOFF_RESULTS)[number]; autoAllocationSelected: false } {
  const flags = { autoAllocationSelected: false as const };
  if (!(ALLOCATION_TRADEOFF_AXES as readonly string[]).includes(i.axis)) return { axis: null, result: 'insufficient_data', ...flags };
  if (i.sideAScore == null || i.sideBScore == null || !isFiniteNumber(i.sideAScore) || !isFiniteNumber(i.sideBScore)) return { axis: i.axis, result: 'tradeoff_unverified', ...flags };
  const delta = i.sideAScore - i.sideBScore;
  if (Math.abs(delta) <= 5) return { axis: i.axis, result: 'balanced_tradeoff_candidate', ...flags };
  if (delta > 25) return { axis: i.axis, result: 'favorable_tradeoff_candidate', ...flags };
  if (delta < -25) return { axis: i.axis, result: 'unfavorable_tradeoff_candidate', ...flags };
  return { axis: i.axis, result: 'mixed_tradeoff_candidate', ...flags };
}

export function evaluateAllocationRobustness(i: { scenarioOutcomes: { scenario: string; acceptable: boolean | null }[] | null; minScenarios: number }): { acceptableCount: number | null; result: (typeof ALLOCATION_ROBUSTNESS_RESULTS)[number]; robustIsNotCorrectAllocation: true } {
  const flags = { robustIsNotCorrectAllocation: true as const };
  if (i.scenarioOutcomes == null) return { acceptableCount: null, result: 'insufficient_data', ...flags };
  if (i.scenarioOutcomes.length < i.minScenarios || i.scenarioOutcomes.some((s) => s.acceptable == null)) return { acceptableCount: null, result: 'robustness_unverified', ...flags };
  const acceptable = i.scenarioOutcomes.filter((s) => s.acceptable).length;
  if (acceptable === i.scenarioOutcomes.length) return { acceptableCount: acceptable, result: 'robust_allocation_candidate', ...flags };
  if (acceptable === 0) return { acceptableCount: acceptable, result: 'fragile_allocation_candidate', ...flags };
  if (acceptable === 1) return { acceptableCount: acceptable, result: 'scenario_specific_candidate', ...flags };
  return { acceptableCount: acceptable, result: 'conditionally_robust_candidate', ...flags };
}

export function evaluateAllocationRegret(i: { worstCaseLoss: number | null; opportunityCost: number | null; reversible: boolean | null }): { result: (typeof ALLOCATION_REGRET_RESULTS)[number]; lowestRegretIsNotBestAllocation: true } {
  const flags = { lowestRegretIsNotBestAllocation: true as const };
  if (i.worstCaseLoss == null || i.opportunityCost == null) return { result: 'insufficient_data', ...flags };
  if (!isFiniteNumber(i.worstCaseLoss) || !isFiniteNumber(i.opportunityCost) || i.reversible == null) return { result: 'regret_unverified', ...flags };
  if (i.worstCaseLoss > i.opportunityCost * 3 && !i.reversible) return { result: 'asymmetric_regret_candidate', ...flags };
  if (i.worstCaseLoss <= 0 && i.opportunityCost <= 0) return { result: 'lowest_regret_allocation_candidate', ...flags };
  if (i.opportunityCost < 10 && (i.reversible || i.worstCaseLoss < 10)) return { result: 'low_regret_candidate', ...flags };
  if (i.opportunityCost < 40) return { result: 'moderate_regret_candidate', ...flags };
  return { result: 'high_regret_candidate', ...flags };
}

export function evaluateAllocationReversibility(i: { releasable: boolean | null; contractLockIn: boolean; providerLockIn: boolean; sunkCostHigh: boolean; releaseConditionsDefined: boolean }): { result: (typeof ALLOCATION_REVERSIBILITY_RESULTS)[number]; reversibleIsNotGuaranteedRecovery: true } {
  const flags = { reversibleIsNotGuaranteedRecovery: true as const };
  if (i.releasable == null) return { result: 'reversibility_unverified', ...flags };
  if (i.contractLockIn && i.providerLockIn) return { result: 'irreversible_candidate', ...flags };
  if (!i.releasable) return { result: 'difficult_to_reverse_candidate', ...flags };
  if (i.sunkCostHigh || i.contractLockIn || i.providerLockIn) return { result: 'partially_reversible_candidate', ...flags };
  if (!i.releaseConditionsDefined) return { result: 'reversible_with_condition_candidate', ...flags };
  return { result: 'highly_reversible_candidate', ...flags };
}

export function evaluateAllocationFeasibility(i: { withinBudget: boolean | null; withinCapacity: boolean | null; reviewerAvailable: boolean; policyAllowed: boolean }): { result: (typeof ALLOCATION_FEASIBILITY_RESULTS)[number]; feasibilityIsNotReservation: true } {
  const flags = { feasibilityIsNotReservation: true as const };
  if (!i.policyAllowed || !i.reviewerAvailable) return { result: 'feasibility_blocked_candidate', ...flags };
  if (i.withinBudget == null || i.withinCapacity == null) return { result: 'feasibility_unverified', ...flags };
  if (i.withinBudget && i.withinCapacity) return { result: 'feasible_allocation_candidate', ...flags };
  return { result: 'conditionally_feasible_candidate', ...flags };
}

/* ── 16) Recommendation / Review(Approval ≠ Execution) ───────────────── */
export function buildAllocationRecommendation(i: { type: string; reason: string; evidence: string[]; confidence: number | null }):
  | { rejected: true; rejectReason: string }
  | { type: string; reason: string; confidence: number | null; recommendationIsNotApproval: true; humanReviewRequired: true; autoAllocated: false } {
  if (!(ALLOCATION_RECOMMENDATION_TYPES as readonly string[]).includes(i.type)) return { rejected: true, rejectReason: '허용되지 않는 recommendation type' };
  if (!i.reason.trim()) return { rejected: true, rejectReason: 'Reason 필수' };
  if (!i.evidence.length) return { rejected: true, rejectReason: 'Evidence 없는 Recommendation 금지' };
  const confidence = i.confidence == null || !isFiniteNumber(i.confidence) ? null : clampScore(i.confidence);
  return { type: i.type, reason: i.reason, confidence, recommendationIsNotApproval: true, humanReviewRequired: true, autoAllocated: false };
}

export function validateAllocationReviewAction(i: { action: string; reason: string; evidenceCount: number; reviewerIsCreator: boolean }):
  | { rejected: true; rejectReason: string }
  | { action: string; humanAllocationDecisionConfirmed: true; approvalIsNotExecution: true; budgetAllocated: false; resourcesAllocated: false; capacityProvisioned: false; productionApplied: false } {
  if (!(ALLOCATION_REVIEW_ACTIONS as readonly string[]).includes(i.action)) return { rejected: true, rejectReason: '허용되지 않는 review action' };
  if (!i.reason.trim()) return { rejected: true, rejectReason: 'Reason 필수(승인/거절/보류/수정 전부)' };
  if (i.action === 'approve_allocation_reference' || i.action === 'approve_with_conditions_reference') {
    if (i.reviewerIsCreator) return { rejected: true, rejectReason: 'Self-Approval 차단(작성자 ≠ 승인자)' };
    if (i.evidenceCount === 0) return { rejected: true, rejectReason: 'Evidence 없는 Allocation Approval Reference 금지' };
  }
  return { action: i.action, humanAllocationDecisionConfirmed: true, approvalIsNotExecution: true, budgetAllocated: false, resourcesAllocated: false, capacityProvisioned: false, productionApplied: false };
}

/* ── 17) Outcome / Quality / Drift / Learning ────────────────────────── */
export function evaluateResourceOutcome(i: { observedOutcomeExists: boolean; observationCompletenessPct: number | null; externalFactorPresent: boolean; sampleSize: number | null; minSample: number }): { result: 'outcome_linked_reference' | 'observation_partial' | 'outcome_unverified' | 'causality_unverified' | 'sample_too_small' | 'insufficient_data'; outcomeIsNotAllocationCausality: true } {
  const flags = { outcomeIsNotAllocationCausality: true as const };
  if (!i.observedOutcomeExists) return { result: 'outcome_unverified', ...flags };
  if (i.sampleSize == null || !isFiniteNumber(i.sampleSize)) return { result: 'insufficient_data', ...flags };
  if (i.sampleSize < i.minSample) return { result: 'sample_too_small', ...flags };
  if (i.externalFactorPresent) return { result: 'causality_unverified', ...flags };
  if (i.observationCompletenessPct != null && isFiniteNumber(i.observationCompletenessPct) && i.observationCompletenessPct < 80) return { result: 'observation_partial', ...flags };
  return { result: 'outcome_linked_reference', ...flags };
}

export function calculateAllocationQuality(i: { outcomeLinked: boolean; demandMet: boolean | null; costWithinRange: boolean | null; capacityWithinRange: boolean | null; unexpectedSideEffect: boolean; causalityVerified: boolean; sampleSize: number | null; minSample: number }): { result: (typeof ALLOCATION_QUALITY_RESULTS)[number]; qualityIsNotVerifiedManagementQuality: true } {
  const flags = { qualityIsNotVerifiedManagementQuality: true as const };
  if (!i.outcomeLinked) return { result: 'outcome_unverified', ...flags };
  if (i.sampleSize == null || !isFiniteNumber(i.sampleSize)) return { result: 'insufficient_data', ...flags };
  if (i.sampleSize < i.minSample) return { result: 'sample_too_small', ...flags };
  if (!i.causalityVerified) return { result: 'causality_unverified', ...flags };
  if (i.demandMet == null || i.costWithinRange == null || i.capacityWithinRange == null) return { result: 'insufficient_data', ...flags };
  const positives = [i.demandMet, i.costWithinRange, i.capacityWithinRange].filter(Boolean).length;
  if (positives === 3 && !i.unexpectedSideEffect) return { result: 'high_quality_candidate', ...flags };
  if (positives >= 2 && i.unexpectedSideEffect) return { result: 'mixed_quality_candidate', ...flags };
  if (positives >= 2) return { result: 'moderate_quality_candidate', ...flags };
  return { result: 'low_quality_candidate', ...flags };
}

export function calculateResourceDrift(i: { driftedDimensions: string[] | null }): { result: (typeof RESOURCE_DRIFT_RESULTS)[number]; driftIsNotAutomaticReallocation: true } {
  const flags = { driftIsNotAutomaticReallocation: true as const };
  if (i.driftedDimensions == null) return { result: 'insufficient_data', ...flags };
  const n = i.driftedDimensions.length;
  if (n === 0) return { result: 'no_material_drift_candidate', ...flags };
  if (i.driftedDimensions.includes('availability_drift') && n >= 3) return { result: 'structural_drift_candidate', ...flags };
  if (n >= 4) return { result: 'severe_drift_candidate', ...flags };
  if (n >= 2) return { result: 'moderate_drift_candidate', ...flags };
  return { result: 'minor_drift_candidate', ...flags };
}

export function calculateAllocationDrift(i: { driftedDimensions: string[] | null }): { result: (typeof ALLOCATION_DRIFT_RESULTS)[number]; driftIsNotConfirmedMisallocation: true } {
  const flags = { driftIsNotConfirmedMisallocation: true as const };
  if (i.driftedDimensions == null) return { result: 'insufficient_data', ...flags };
  const n = i.driftedDimensions.length;
  if (n === 0) return { result: 'no_material_allocation_drift_candidate', ...flags };
  if (i.driftedDimensions.includes('usage_vs_plan_drift') && n >= 3) return { result: 'structural_allocation_drift_candidate', ...flags };
  if (n >= 4) return { result: 'severe_allocation_drift_candidate', ...flags };
  if (n >= 2) return { result: 'moderate_allocation_drift_candidate', ...flags };
  return { result: 'minor_allocation_drift_candidate', ...flags };
}

export function buildResourceLearningReference(i: { validForecasts: string[]; actualBottlenecks: string[]; misestimatedDemands: string[]; templateImprovements: string[] }): { entryCount: number; result: 'learning_reference_recorded' | 'insufficient_data'; autoReallocated: false } {
  const flags = { autoReallocated: false as const };
  const entryCount = i.validForecasts.length + i.actualBottlenecks.length + i.misestimatedDemands.length + i.templateImprovements.length;
  if (entryCount === 0) return { entryCount, result: 'insufficient_data', ...flags };
  return { entryCount, result: 'learning_reference_recorded', ...flags };
}

/* ── 18) Timeline ────────────────────────────────────────────────────── */
export function buildResourceTimeline(i: { present: Partial<Record<(typeof RESOURCE_TIMELINE_STAGES)[number], boolean>> }): { stages: { stage: (typeof RESOURCE_TIMELINE_STAGES)[number]; present: boolean }[]; completedCount: number; timelineIsNotExecutionLog: true } {
  const stages = RESOURCE_TIMELINE_STAGES.map((stage) => ({ stage, present: i.present[stage] === true }));
  return { stages, completedCount: stages.filter((s) => s.present).length, timelineIsNotExecutionLog: true };
}

/* ── 19) Support Matrix(실측 기반 — Automatic 계열 전부 unsupported) ─── */
export const RESOURCE_COMPONENTS = [
  { key: 'strategic_initiatives_0545', available: true },
  { key: 'strategy_portfolios_0545', available: true },
  { key: 'decision_contexts_0544', available: true },
  { key: 'commitments_0520', available: true },
  { key: 'capacity_metrics_snapshots_0508', available: true },
  { key: 'cost_models_snapshots_0508', available: true },
  { key: 'connector_definitions_instances_0536', available: true },
  { key: 'agents_0497', available: true },
  { key: 'resource_registry_0529', available: true },
  { key: 'enterprise_contracts_0383', available: true },
  { key: 'billing_invoices_subscriptions', available: true },
  { key: 'verified_physical_inventory', available: false },
  { key: 'accounting_ledger_feed', available: false },
  { key: 'bank_balance_feed', available: false },
  { key: 'treasury_system', available: false },
  { key: 'hr_availability_calendar', available: false },
  { key: 'payroll_system', available: false },
  { key: 'cloud_billing_api_feed', available: false },
  { key: 'provider_quota_api_feed', available: false },
  { key: 'reservation_system', available: false },
] as const;

export type ResourceSupportStatus = 'fully_supported' | 'partially_supported' | 'read_only' | 'inventory_only' | 'demand_only' | 'capacity_only' | 'financial_reference_only' | 'allocation_option_only' | 'planning_only' | 'advisory_only' | 'human_review_only' | 'approval_reference_only' | 'outcome_reference_only' | 'unavailable' | 'unverified' | 'unsupported' | 'insufficient_data';
export const RESOURCE_SUPPORT_MATRIX: { feature: string; status: ResourceSupportStatus }[] = [
  { feature: 'resource_inventory', status: 'inventory_only' },
  { feature: 'resource_availability', status: 'advisory_only' },
  { feature: 'resource_commitment', status: 'financial_reference_only' },
  { feature: 'resource_reservation_candidate', status: 'advisory_only' },
  { feature: 'resource_freshness', status: 'advisory_only' },
  { feature: 'resource_reliability', status: 'advisory_only' },
  { feature: 'human_capacity', status: 'capacity_only' },
  { feature: 'reviewer_capacity', status: 'capacity_only' },
  { feature: 'specialist_capacity', status: 'capacity_only' },
  { feature: 'technical_capacity', status: 'capacity_only' },
  { feature: 'operational_capacity', status: 'capacity_only' },
  { feature: 'compute_capacity', status: 'capacity_only' },
  { feature: 'storage_capacity', status: 'capacity_only' },
  { feature: 'connector_capacity', status: 'capacity_only' },
  { feature: 'provider_capacity', status: 'unverified' },
  { feature: 'financial_envelope', status: 'financial_reference_only' },
  { feature: 'budget_envelope', status: 'financial_reference_only' },
  { feature: 'cash_flow_reference', status: 'financial_reference_only' },
  { feature: 'initiative_resource_demand', status: 'demand_only' },
  { feature: 'portfolio_resource_demand', status: 'demand_only' },
  { feature: 'resource_demand_forecast', status: 'advisory_only' },
  { feature: 'peak_demand', status: 'advisory_only' },
  { feature: 'shared_resource_dependency', status: 'advisory_only' },
  { feature: 'resource_conflict', status: 'advisory_only' },
  { feature: 'double_allocation_detection', status: 'advisory_only' },
  { feature: 'overcommitment', status: 'advisory_only' },
  { feature: 'underutilization', status: 'advisory_only' },
  { feature: 'resource_bottleneck', status: 'advisory_only' },
  { feature: 'capacity_gap', status: 'advisory_only' },
  { feature: 'funding_gap', status: 'advisory_only' },
  { feature: 'workforce_gap', status: 'advisory_only' },
  { feature: 'allocation_option', status: 'allocation_option_only' },
  { feature: 'partial_allocation_option', status: 'allocation_option_only' },
  { feature: 'phased_allocation_option', status: 'allocation_option_only' },
  { feature: 'reversible_allocation_option', status: 'allocation_option_only' },
  { feature: 'reserve_capacity_option', status: 'allocation_option_only' },
  { feature: 'opportunity_cost', status: 'advisory_only' },
  { feature: 'capital_efficiency', status: 'advisory_only' },
  { feature: 'resource_utilization', status: 'advisory_only' },
  { feature: 'capacity_headroom', status: 'advisory_only' },
  { feature: 'resource_concentration', status: 'advisory_only' },
  { feature: 'resource_diversification', status: 'advisory_only' },
  { feature: 'allocation_tradeoff', status: 'advisory_only' },
  { feature: 'allocation_robustness', status: 'advisory_only' },
  { feature: 'allocation_regret', status: 'advisory_only' },
  { feature: 'allocation_reversibility', status: 'advisory_only' },
  { feature: 'allocation_feasibility', status: 'advisory_only' },
  { feature: 'capacity_plan', status: 'planning_only' },
  { feature: 'allocation_recommendation_candidate', status: 'advisory_only' },
  { feature: 'human_finance_review', status: 'human_review_only' },
  { feature: 'human_resource_review', status: 'human_review_only' },
  { feature: 'allocation_approval_reference', status: 'approval_reference_only' },
  { feature: 'allocation_rejection_reference', status: 'approval_reference_only' },
  { feature: 'allocation_defer_reference', status: 'approval_reference_only' },
  { feature: 'budget_reference_link', status: 'financial_reference_only' },
  { feature: 'commitment_reference_link', status: 'financial_reference_only' },
  { feature: 'decision_reference_link', status: 'financial_reference_only' },
  { feature: 'portfolio_reference_link', status: 'financial_reference_only' },
  { feature: 'resource_outcome_reference', status: 'outcome_reference_only' },
  { feature: 'allocation_quality_candidate', status: 'advisory_only' },
  { feature: 'resource_drift_candidate', status: 'advisory_only' },
  { feature: 'allocation_drift_candidate', status: 'advisory_only' },
  { feature: 'resource_learning_reference', status: 'financial_reference_only' },
  { feature: 'resource_audit', status: 'read_only' },
  { feature: 'automatic_budget_allocation', status: 'unsupported' },
  { feature: 'automatic_resource_allocation', status: 'unsupported' },
  { feature: 'automatic_capital_allocation', status: 'unsupported' },
  { feature: 'automatic_payment_execution', status: 'unsupported' },
  { feature: 'automatic_employee_assignment', status: 'unsupported' },
  { feature: 'automatic_hiring_termination', status: 'unsupported' },
  { feature: 'automatic_provider_purchase', status: 'unsupported' },
  { feature: 'automatic_compute_provisioning', status: 'unsupported' },
  { feature: 'automatic_storage_provisioning', status: 'unsupported' },
  { feature: 'automatic_capacity_scaling', status: 'unsupported' },
  { feature: 'automatic_infrastructure_purchase', status: 'unsupported' },
  { feature: 'automatic_settlement_mutation', status: 'unsupported' },
  { feature: 'automatic_contract_execution', status: 'unsupported' },
  { feature: 'automatic_production_mutation', status: 'unsupported' },
];
