import { describe, expect, it } from 'vitest';
import {
  BLOCKED_ALLOCATION_TYPES, BLOCKED_RESOURCE_DOMAINS, RESOURCE_DOMAINS, RESOURCE_STATUSES,
  ALLOCATION_OPTION_STATUSES, ALLOCATION_RECOMMENDATION_TYPES, RESOURCE_SUPPORT_MATRIX,
  buildAllocationOption, buildAllocationRecommendation, buildResourceDemand,
  buildResourceInventory, buildResourceLearningReference, buildResourceTimeline,
  calculateAllocationDrift, calculateAllocationQuality, calculateCapacityGap,
  calculateFundingGap, calculateResourceDrift, detectResourceConflicts,
  evaluateAllocationFeasibility, evaluateAllocationRegret, evaluateAllocationReversibility,
  evaluateAllocationRobustness, evaluateAllocationTradeoffs, evaluateCapitalEfficiency,
  evaluateDemandForecast, evaluateHumanCapacity, evaluateOpportunityCost,
  evaluateOvercommitment, evaluateResourceAvailability, evaluateResourceFreshness,
  evaluateResourceOutcome, evaluateResourceReliability, evaluateResourceUtilization,
  evaluateTechnicalCapacity, evaluateUnderutilization, validateAllocationReviewAction,
} from './resourceAllocation';

const NOW = new Date('2026-07-17T00:00:00Z');

describe('resourceAllocation — Inventory/Availability/Freshness/Reliability', () => {
  it('금지 도메인 전수 거부, 허용 도메인 draft (Inventory ≠ 자산 원장)', () => {
    for (const d of BLOCKED_RESOURCE_DOMAINS) {
      const r = buildResourceInventory({ domain: d, name: 'x', resourceType: 'custom_reference' });
      expect('rejected' in r && r.rejected).toBe(true);
    }
    const ok = buildResourceInventory({ domain: 'compute_capacity', name: 'GPU 풀', resourceType: 'compute_unit_reference' });
    expect(ok).toMatchObject({ status: 'draft', inventoryIsNotLedger: true, autoAllocated: false, budgetAllocated: false });
    expect(RESOURCE_DOMAINS).toHaveLength(30);
    expect(RESOURCE_STATUSES).toHaveLength(15);
  });

  it('availability: source 미검증 → unverified, committed 차감 (보장 아님)', () => {
    expect(evaluateResourceAvailability({ total: 100, committed: 20, reserved: 10, maintenanceBlocked: 0, constraintPresent: false, sourceVerified: false }).result).toBe('availability_unverified');
    const r = evaluateResourceAvailability({ total: 100, committed: 20, reserved: 10, maintenanceBlocked: 0, constraintPresent: false, sourceVerified: true });
    expect(r).toMatchObject({ availableCandidate: 70, result: 'high_availability_candidate', availabilityIsNotGuarantee: true });
    expect(evaluateResourceAvailability({ total: 100, committed: 100, reserved: 0, maintenanceBlocked: 0, constraintPresent: false, sourceVerified: true }).result).toBe('unavailable_candidate');
    expect(evaluateResourceAvailability({ total: Number.NaN, committed: 0, reserved: 0, maintenanceBlocked: 0, constraintPresent: false, sourceVerified: true }).result).toBe('availability_unverified');
  });

  it('freshness: 24h/7d/30d 기준 구분', () => {
    expect(evaluateResourceFreshness({ observedAt: new Date('2026-07-16T12:00:00Z'), now: NOW }).result).toBe('current_reference');
    expect(evaluateResourceFreshness({ observedAt: new Date('2026-07-12T00:00:00Z'), now: NOW }).result).toBe('recently_observed_reference');
    expect(evaluateResourceFreshness({ observedAt: new Date('2026-06-25T00:00:00Z'), now: NOW }).result).toBe('stale_resource_candidate');
    expect(evaluateResourceFreshness({ observedAt: new Date('2026-05-01T00:00:00Z'), now: NOW }).result).toBe('severely_stale_candidate');
    expect(evaluateResourceFreshness({ observedAt: null, now: NOW }).result).toBe('freshness_unverified');
  });

  it('reliability: source 0 → unverified, 충돌 source → conflicting', () => {
    expect(evaluateResourceReliability({ sourceCount: 0, conflictingSources: false, manualEntryOnly: false, externallyVerified: false, completenessPct: null }).result).toBe('reliability_unverified');
    expect(evaluateResourceReliability({ sourceCount: 2, conflictingSources: true, manualEntryOnly: false, externallyVerified: true, completenessPct: 90 }).result).toBe('conflicting_source_candidate');
    expect(evaluateResourceReliability({ sourceCount: 2, conflictingSources: false, manualEntryOnly: false, externallyVerified: true, completenessPct: 90 }).result).toBe('high_reliability_candidate');
    expect(evaluateResourceReliability({ sourceCount: 1, conflictingSources: false, manualEntryOnly: true, externallyVerified: false, completenessPct: 50 }).result).toBe('low_reliability_candidate');
  });
});

describe('resourceAllocation — Capacity/Demand/Forecast', () => {
  it('human capacity: overload/병목 구분 (개인 평가 아님)', () => {
    const over = evaluateHumanCapacity({ availableHours: 100, committedHours: 80, plannedHours: 40, overloadThresholdPct: 100, reviewerAvailable: true, specialistAvailable: true });
    expect(over.result).toBe('workload_overload_candidate');
    expect(over.notUsedForPerformanceReview).toBe(true);
    expect(evaluateHumanCapacity({ availableHours: 100, committedHours: 10, plannedHours: 10, overloadThresholdPct: 100, reviewerAvailable: false, specialistAvailable: true }).result).toBe('reviewer_bottleneck_candidate');
    expect(evaluateHumanCapacity({ availableHours: null, committedHours: 10, plannedHours: 10, overloadThresholdPct: 100, reviewerAvailable: true, specialistAvailable: true }).result).toBe('capacity_unverified');
  });

  it('technical capacity: exhaustion/단일 의존 (Provisioned 아님)', () => {
    expect(evaluateTechnicalCapacity({ current: 100, forecastPeak: 120, safetyMarginPct: 15, singlePointDependency: false }).result).toBe('capacity_exhaustion_candidate');
    const spd = evaluateTechnicalCapacity({ current: 100, forecastPeak: 50, safetyMarginPct: 15, singlePointDependency: true });
    expect(spd.result).toBe('single_point_dependency_candidate');
    expect(spd.capacityIsNotProvisioned).toBe(true);
    expect(evaluateTechnicalCapacity({ current: null, forecastPeak: 50, safetyMarginPct: 15, singlePointDependency: false }).result).toBe('capacity_unverified');
  });

  it('demand: 금지 도메인 거부·minimum>required 차단 (예약 아님)', () => {
    expect(buildResourceDemand({ domain: 'automatic_budget_allocation', name: 'x', requiredQuantity: 1, minimumQuantity: 1 })).toMatchObject({ rejected: true });
    expect(buildResourceDemand({ domain: 'compute_capacity', name: 'x', requiredQuantity: 10, minimumQuantity: 20 })).toMatchObject({ rejected: true });
    const ok = buildResourceDemand({ domain: 'compute_capacity', name: '학습 잡', requiredQuantity: 10, minimumQuantity: 5 });
    expect(ok).toMatchObject({ status: 'draft', demandIsNotReservation: true, activeUsage: false });
  });

  it('demand forecast: volatile/accelerating/peak 구분 (Forecast ≠ Future Fact)', () => {
    expect(evaluateDemandForecast({ forecastType: 'invalid', samples: [1, 2], minSamples: 2 }).result).toBe('forecast_unverified');
    expect(evaluateDemandForecast({ forecastType: 'rolling_demand_reference', samples: [10], minSamples: 3 }).result).toBe('demand_forecast_partial');
    const vol = evaluateDemandForecast({ forecastType: 'rolling_demand_reference', samples: [1, 20, 2, 30, 1, 25], minSamples: 3 });
    expect(vol.result).toBe('volatile_demand_candidate');
    expect(vol.forecastIsNotFutureFact).toBe(true);
    expect(evaluateDemandForecast({ forecastType: 'growth_linked_demand_reference', samples: [10, 10, 11, 20, 22, 21], minSamples: 3 }).result).toBe('accelerating_demand_candidate');
  });
});

describe('resourceAllocation — Conflict/Overcommitment/Gap', () => {
  it('conflict: 동일 자원+기간 겹침 탐지, capacity 초과 → double allocation (자동 제거 아님)', () => {
    const r = detectResourceConflicts([
      { demandCode: 'A', resourceKey: 'gpu', start: 0, end: 10, quantity: 60 },
      { demandCode: 'B', resourceKey: 'gpu', start: 5, end: 15, quantity: 60 },
      { demandCode: 'C', resourceKey: 'db', start: 0, end: 5, quantity: 1 },
    ], { gpu: 100 });
    expect(r.result).toBe('double_allocation_candidate');
    expect(r.conflicts[0].demandCodes).toEqual(['A', 'B']);
    expect(r.conflictIsNotAutomaticRemoval).toBe(true);
    expect(detectResourceConflicts([{ demandCode: 'A', resourceKey: 'gpu', start: 0, end: 10, quantity: 1 }], {}).result).toBe('no_material_conflict_candidate');
    expect(detectResourceConflicts(null, {}).result).toBe('insufficient_data');
  });

  it('overcommitment/underutilization — Confirmed Failure/낭비 아님', () => {
    expect(evaluateOvercommitment({ total: 100, committed: 80, reserved: 20, plannedDemand: 30, safetyMarginPct: 10 }).result).toBe('severe_overcommitment_candidate');
    expect(evaluateOvercommitment({ total: 100, committed: 50, reserved: 0, plannedDemand: 45, safetyMarginPct: 10 }).result).toBe('near_overcommitment_candidate');
    expect(evaluateOvercommitment({ total: null, committed: 1, reserved: 0, plannedDemand: 1, safetyMarginPct: 10 }).result).toBe('overcommitment_unverified');
    const reserve = evaluateUnderutilization({ available: 100, actualUsage: 10, strategicReserve: true, contractMinimum: null });
    expect(reserve.result).toBe('strategic_reserve_candidate');
    expect(reserve.lowUtilizationIsNotWaste).toBe(true);
    expect(evaluateUnderutilization({ available: 100, actualUsage: 10, strategicReserve: false, contractMinimum: null }).result).toBe('high_underutilization_candidate');
  });

  it('capacity/funding gap — Confirmed 부족/회계 적자 아님', () => {
    expect(calculateCapacityGap({ required: 100, available: 100, safetyMarginPct: 0 }).result).toBe('no_capacity_gap_candidate');
    const g = calculateCapacityGap({ required: 100, available: 40, safetyMarginPct: 0 });
    expect(g.result).toBe('critical_capacity_gap_candidate');
    expect(g.gapIsNotConfirmedShortage).toBe(true);
    expect(calculateCapacityGap({ required: null, available: 40, safetyMarginPct: 0 }).result).toBe('capacity_gap_unverified');
    expect(calculateFundingGap({ requiredFunding: 100, availableBudgetReference: null, contingencyRequired: null }).result).toBe('funding_gap_unverified');
    const f = calculateFundingGap({ requiredFunding: 100, availableBudgetReference: 40, contingencyRequired: 0 });
    expect(f.result).toBe('critical_funding_gap_candidate');
    expect(f.fundingGapIsNotAccountingDeficit).toBe(true);
    expect(calculateFundingGap({ requiredFunding: 100, availableBudgetReference: 120, contingencyRequired: 10 }).result).toBe('no_funding_gap_candidate');
  });
});

describe('resourceAllocation — Option/Opportunity Cost/Efficiency/Utilization', () => {
  it('금지 allocation type 전수 거부 (Option ≠ Allocated Resource)', () => {
    for (const t of BLOCKED_ALLOCATION_TYPES) {
      const r = buildAllocationOption({ optionType: t, name: 'x' });
      expect('rejected' in r && r.rejected).toBe(true);
    }
    const ok = buildAllocationOption({ optionType: 'phased_allocation_reference', name: '단계 배분안' });
    expect(ok).toMatchObject({ status: 'draft', optionIsNotAllocatedResource: true, budgetAllocated: false, resourcesAllocated: false, capacityProvisioned: false });
    expect(ALLOCATION_OPTION_STATUSES).toHaveLength(15);
  });

  it('opportunity cost/efficiency — 확정 손실/회계 ROI 아님', () => {
    const asym = evaluateOpportunityCost({ forgoneStrategicValue: 80, forgoneRevenueReference: null, delayCostKnown: true, irreversibleLoss: true });
    expect(asym.result).toBe('asymmetric_opportunity_cost_candidate');
    expect(asym.opportunityCostIsNotConfirmedLoss).toBe(true);
    expect(evaluateOpportunityCost({ forgoneStrategicValue: null, forgoneRevenueReference: null, delayCostKnown: false, irreversibleLoss: false }).result).toBe('insufficient_data');
    const eff = evaluateCapitalEfficiency({ strategicValue: 90, requiredBudget: 50, timeToValueMonths: 6, adverseSignal: false });
    expect(eff.result).toBe('high_efficiency_candidate');
    expect(eff.efficiencyIsNotAccountingRoi).toBe(true);
    expect(evaluateCapitalEfficiency({ strategicValue: 90, requiredBudget: 0, timeToValueMonths: 6, adverseSignal: false }).result).toBe('efficiency_unverified');
  });

  it('utilization — High ≠ Healthy·Low ≠ 낭비', () => {
    expect(evaluateResourceUtilization({ utilizationPct: 95, overloadThresholdPct: 90 }).result).toBe('overload_utilization_candidate');
    const high = evaluateResourceUtilization({ utilizationPct: 80, overloadThresholdPct: 90 });
    expect(high.result).toBe('high_utilization_candidate');
    expect(high.highUtilizationIsNotHealthy).toBe(true);
    expect(evaluateResourceUtilization({ utilizationPct: 20, overloadThresholdPct: 90 }).result).toBe('low_utilization_candidate');
    expect(evaluateResourceUtilization({ utilizationPct: null, overloadThresholdPct: 90 }).result).toBe('insufficient_data');
  });
});

describe('resourceAllocation — Trade-off/Robustness/Regret/Reversibility/Feasibility', () => {
  it('tradeoff: 잘못된 축 거부·자동 선택 없음', () => {
    expect(evaluateAllocationTradeoffs({ axis: 'bad', sideAScore: 1, sideBScore: 1 }).result).toBe('insufficient_data');
    const t = evaluateAllocationTradeoffs({ axis: 'budget_vs_capacity', sideAScore: 80, sideBScore: 20 });
    expect(t.result).toBe('favorable_tradeoff_candidate');
    expect(t.autoAllocationSelected).toBe(false);
  });

  it('robustness/regret/reversibility/feasibility — 정직 flag 유지', () => {
    const cases = (flags: (boolean | null)[]) => flags.map((acceptable, k) => ({ scenario: `s${k}`, acceptable }));
    const rob = evaluateAllocationRobustness({ scenarioOutcomes: cases([true, true, true]), minScenarios: 3 });
    expect(rob.result).toBe('robust_allocation_candidate');
    expect(rob.robustIsNotCorrectAllocation).toBe(true);
    const reg = evaluateAllocationRegret({ worstCaseLoss: 100, opportunityCost: 5, reversible: false });
    expect(reg.result).toBe('asymmetric_regret_candidate');
    expect(reg.lowestRegretIsNotBestAllocation).toBe(true);
    expect(evaluateAllocationReversibility({ releasable: true, contractLockIn: true, providerLockIn: true, sunkCostHigh: false, releaseConditionsDefined: true }).result).toBe('irreversible_candidate');
    const rev = evaluateAllocationReversibility({ releasable: true, contractLockIn: false, providerLockIn: false, sunkCostHigh: false, releaseConditionsDefined: true });
    expect(rev).toMatchObject({ result: 'highly_reversible_candidate', reversibleIsNotGuaranteedRecovery: true });
    expect(evaluateAllocationFeasibility({ withinBudget: true, withinCapacity: true, reviewerAvailable: false, policyAllowed: true }).result).toBe('feasibility_blocked_candidate');
    const f = evaluateAllocationFeasibility({ withinBudget: true, withinCapacity: true, reviewerAvailable: true, policyAllowed: true });
    expect(f).toMatchObject({ result: 'feasible_allocation_candidate', feasibilityIsNotReservation: true });
  });
});

describe('resourceAllocation — Recommendation/Review/Outcome/Quality/Drift/Matrix', () => {
  it('recommendation: whitelist+Evidence 필수 (≠ Approval)', () => {
    expect(buildAllocationRecommendation({ type: 'auto_allocate', reason: 'r', evidence: ['e'], confidence: 50 })).toMatchObject({ rejected: true });
    expect(buildAllocationRecommendation({ type: 'rebalance_allocation_candidate', reason: 'r', evidence: [], confidence: 50 })).toMatchObject({ rejected: true });
    const ok = buildAllocationRecommendation({ type: 'rebalance_allocation_candidate', reason: '병목 완화', evidence: ['gap_review'], confidence: 250 });
    expect(ok).toMatchObject({ confidence: 100, recommendationIsNotApproval: true, humanReviewRequired: true, autoAllocated: false });
    expect(ALLOCATION_RECOMMENDATION_TYPES).toHaveLength(34);
  });

  it('review: Self-Approval 차단·Evidence 필수·배정/집행 flag 전부 false', () => {
    expect(validateAllocationReviewAction({ action: 'approve_allocation_reference', reason: 'ok', evidenceCount: 1, reviewerIsCreator: true })).toMatchObject({ rejected: true });
    expect(validateAllocationReviewAction({ action: 'approve_allocation_reference', reason: 'ok', evidenceCount: 0, reviewerIsCreator: false })).toMatchObject({ rejected: true });
    expect(validateAllocationReviewAction({ action: 'execute_budget', reason: 'r', evidenceCount: 1, reviewerIsCreator: false })).toMatchObject({ rejected: true });
    const ok = validateAllocationReviewAction({ action: 'approve_with_conditions_reference', reason: '조건부', evidenceCount: 2, reviewerIsCreator: false });
    expect(ok).toMatchObject({ humanAllocationDecisionConfirmed: true, approvalIsNotExecution: true, budgetAllocated: false, resourcesAllocated: false, capacityProvisioned: false, productionApplied: false });
  });

  it('outcome/quality — Outcome ≠ Causality·Quality ≠ 경영 평가', () => {
    expect(evaluateResourceOutcome({ observedOutcomeExists: false, observationCompletenessPct: null, externalFactorPresent: false, sampleSize: 10, minSample: 5 }).result).toBe('outcome_unverified');
    expect(evaluateResourceOutcome({ observedOutcomeExists: true, observationCompletenessPct: 100, externalFactorPresent: true, sampleSize: 10, minSample: 5 }).result).toBe('causality_unverified');
    const q = calculateAllocationQuality({ outcomeLinked: true, demandMet: true, costWithinRange: true, capacityWithinRange: true, unexpectedSideEffect: false, causalityVerified: true, sampleSize: 10, minSample: 5 });
    expect(q.result).toBe('high_quality_candidate');
    expect(q.qualityIsNotVerifiedManagementQuality).toBe(true);
    expect(calculateAllocationQuality({ outcomeLinked: true, demandMet: true, costWithinRange: false, capacityWithinRange: true, unexpectedSideEffect: true, causalityVerified: true, sampleSize: 10, minSample: 5 }).result).toBe('mixed_quality_candidate');
  });

  it('drift/learning/timeline — 자동 재배분 없음', () => {
    expect(calculateResourceDrift({ driftedDimensions: ['availability_drift', 'cost_drift', 'demand_drift'] }).result).toBe('structural_drift_candidate');
    expect(calculateResourceDrift({ driftedDimensions: [] }).result).toBe('no_material_drift_candidate');
    const ad = calculateAllocationDrift({ driftedDimensions: ['usage_vs_plan_drift', 'budget_drift', 'timeline_drift'] });
    expect(ad.result).toBe('structural_allocation_drift_candidate');
    expect(ad.driftIsNotConfirmedMisallocation).toBe(true);
    const l = buildResourceLearningReference({ validForecasts: ['f1'], actualBottlenecks: ['b1'], misestimatedDemands: [], templateImprovements: [] });
    expect(l).toMatchObject({ entryCount: 2, result: 'learning_reference_recorded', autoReallocated: false });
    const t = buildResourceTimeline({ present: { resource_inventory: true, allocation_option: true } });
    expect(t.stages).toHaveLength(12);
    expect(t.completedCount).toBe(2);
  });

  it('support matrix: 78항목, automatic 계열 14개 전부 unsupported', () => {
    expect(RESOURCE_SUPPORT_MATRIX).toHaveLength(78);
    const unsupported = RESOURCE_SUPPORT_MATRIX.filter((f) => f.status === 'unsupported');
    expect(unsupported).toHaveLength(14);
    expect(unsupported.every((f) => f.feature.startsWith('automatic_'))).toBe(true);
  });
});
