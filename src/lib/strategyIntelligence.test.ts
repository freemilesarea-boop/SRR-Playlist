import { describe, expect, it } from 'vitest';
import {
  BLOCKED_INITIATIVE_TYPES, BLOCKED_STRATEGY_DOMAINS, STRATEGIC_GOAL_STATUSES,
  STRATEGIC_INITIATIVE_STATUSES, STRATEGY_DOMAINS, STRATEGY_PORTFOLIO_STATUSES,
  STRATEGY_RECOMMENDATION_TYPES, STRATEGY_SUPPORT_MATRIX,
  buildMilestoneCandidate, buildStrategicGoal, buildStrategicInitiative,
  buildStrategicRoadmapCandidate, buildStrategyLearningReference,
  buildStrategyRecommendationCandidate, buildStrategyTimeline,
  calculateCriticalPathCandidate, calculatePortfolioDriftCandidate,
  calculateStrategyDriftCandidate, calculateStrategyQualityCandidate,
  detectCircularDependencies, detectGoalConflicts, evaluateCapacityConstraint,
  evaluateFinancialConstraint, evaluateHumanWorkloadConstraint,
  evaluatePortfolioBalance, evaluatePortfolioConcentration,
  evaluatePortfolioDiversification, evaluateResourceDemand,
  evaluateStrategicFeasibility, evaluateStrategicOutcome,
  evaluateStrategicPriorityCandidate, evaluateStrategicRegret,
  evaluateStrategicReversibility, evaluateStrategicRobustness,
  evaluateStrategicTradeoffs, generatePortfolioScenario,
  validateGoalHierarchy, validateInitiativeDependency, validatePortfolioVersion,
  validateStrategyReviewAction,
} from './strategyIntelligence';

describe('strategyIntelligence — Goal/Hierarchy/Conflict/Priority', () => {
  it('금지 도메인 전수 거부, 허용 도메인 draft (Goal ≠ Guaranteed Outcome)', () => {
    for (const d of BLOCKED_STRATEGY_DOMAINS) {
      const r = buildStrategicGoal({ domain: d, name: 'g', goalType: 'growth_reference', parentLevel: null });
      expect('rejected' in r && r.rejected).toBe(true);
    }
    const ok = buildStrategicGoal({ domain: 'enterprise_growth', name: '성장 목표', goalType: 'growth_reference', parentLevel: 2 });
    expect(ok).toMatchObject({ status: 'draft', level: 3, goalIsNotGuaranteedOutcome: true, autoApproved: false, budgetAllocated: false });
    expect(buildStrategicGoal({ domain: 'innovation', name: 'x', goalType: 'growth_reference', parentLevel: 6 })).toMatchObject({ rejected: true });
    expect(STRATEGY_DOMAINS).toHaveLength(32);
    expect(STRATEGIC_GOAL_STATUSES).toHaveLength(15);
  });

  it('hierarchy: self/circular parent 차단, depth 초과 차단', () => {
    expect(validateGoalHierarchy({ goalId: 'g1', parentChain: ['g1'], maxDepth: 6 }).result).toBe('self_parent_blocked');
    expect(validateGoalHierarchy({ goalId: 'g1', parentChain: ['g2', 'g1', 'g3'], maxDepth: 6 }).result).toBe('circular_parent_blocked');
    expect(validateGoalHierarchy({ goalId: 'g7', parentChain: ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'], maxDepth: 6 }).result).toBe('depth_exceeded');
    expect(validateGoalHierarchy({ goalId: 'g3', parentChain: ['g1', 'g2'], maxDepth: 6 }).result).toBe('hierarchy_valid_reference');
  });

  it('goal conflict: KPI+자원 상반 → structural (자동 제거 근거 아님)', () => {
    const s = detectGoalConflicts({ conflictKinds: ['timeline'], sharedBudget: true, sharedResource: false, opposedKpi: true });
    expect(s.result).toBe('structural_conflict_candidate');
    expect(s.conflictIsNotAutomaticRemoval).toBe(true);
    expect(detectGoalConflicts({ conflictKinds: [], sharedBudget: false, sharedResource: false, opposedKpi: false }).result).toBe('no_material_conflict_candidate');
    expect(detectGoalConflicts({ conflictKinds: null, sharedBudget: false, sharedResource: false, opposedKpi: false }).result).toBe('insufficient_data');
  });

  it('priority: evidence 없음 → unverified, 고가치+기한 → critical (Final Priority 아님)', () => {
    expect(evaluateStrategicPriorityCandidate({ strategicValue: 90, riskReduction: 50, costOfDelayKnown: true, deadlineNear: true, dependencyUnlockCount: 3, evidenceCount: 0, portfolioBalanceReviewed: true }).result).toBe('priority_unverified');
    const r = evaluateStrategicPriorityCandidate({ strategicValue: 80, riskReduction: 60, costOfDelayKnown: true, deadlineNear: true, dependencyUnlockCount: 4, evidenceCount: 3, portfolioBalanceReviewed: true });
    expect(r.result).toBe('critical_candidate');
    expect(r.priorityIsNotFinalPriority).toBe(true);
    expect(r.autoSorted).toBe(false);
  });
});

describe('strategyIntelligence — Initiative/Dependency', () => {
  it('금지 initiative type 전수 거부 (Initiative ≠ Execution)', () => {
    for (const t of BLOCKED_INITIATIVE_TYPES) {
      const r = buildStrategicInitiative({ initiativeType: t, name: 'x', domain: 'innovation' });
      expect('rejected' in r && r.rejected).toBe(true);
    }
    const ok = buildStrategicInitiative({ initiativeType: 'pilot_reference', name: '파일럿', domain: 'ai_capability' });
    expect(ok).toMatchObject({ status: 'draft', initiativeIsNotExecution: true, autoStarted: false, budgetAllocated: false, resourcesAllocated: false });
    expect(STRATEGIC_INITIATIVE_STATUSES).toHaveLength(19);
  });

  it('dependency: self 차단·circular 탐지·blocks → conflict candidate (Confirmed 아님)', () => {
    expect(validateInitiativeDependency({ dependencyType: 'prerequisite', fromId: 'a', toId: 'a', targetExists: true }).result).toBe('self_dependency_blocked');
    expect(validateInitiativeDependency({ dependencyType: 'invalid', fromId: 'a', toId: 'b', targetExists: true }).result).toBe('invalid_dependency_type');
    expect(validateInitiativeDependency({ dependencyType: 'blocks', fromId: 'a', toId: 'b', targetExists: true }).result).toBe('dependency_conflict_candidate');
    const cyc = detectCircularDependencies([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }]);
    expect(cyc.result).toBe('circular_dependency_candidate');
    expect(cyc.cycles.length).toBeGreaterThan(0);
    expect(cyc.dependencyIsNotConfirmed).toBe(true);
    expect(detectCircularDependencies([{ from: 'a', to: 'b' }]).result).toBe('dependency_ready_reference');
  });
});

describe('strategyIntelligence — Portfolio/Scenario/Constraints', () => {
  it('version: schema 변경 → breaking, envelope 변경 → limitation (이전 결과 보존)', () => {
    expect(validatePortfolioVersion({ previousVersion: 2, goalSetChanged: false, initiativeSetChanged: false, envelopeChanged: false, schemaChanged: true })).toMatchObject({ nextVersion: 3, result: 'breaking_change_candidate', previousResultsPreserved: true });
    expect(validatePortfolioVersion({ previousVersion: null, goalSetChanged: false, initiativeSetChanged: false, envelopeChanged: false, schemaChanged: false })).toMatchObject({ nextVersion: 1, result: 'version_ready_reference' });
    expect(validatePortfolioVersion({ previousVersion: 1, goalSetChanged: false, initiativeSetChanged: false, envelopeChanged: true, schemaChanged: false }).result).toBe('compatible_with_limitation');
    expect(STRATEGY_PORTFOLIO_STATUSES).toHaveLength(15);
  });

  it('scenario: 잘못된 type 거부·최대 개수 초과 거부 (Scenario ≠ Reality)', () => {
    expect(generatePortfolioScenario({ scenarioType: 'invalid', initiativeCount: 3, maxScenarios: 20, existingScenarioCount: 0 })).toMatchObject({ rejected: true });
    expect(generatePortfolioScenario({ scenarioType: 'base_case_candidate', initiativeCount: 3, maxScenarios: 20, existingScenarioCount: 20 })).toMatchObject({ rejected: true });
    const ok = generatePortfolioScenario({ scenarioType: 'budget_constrained_candidate', initiativeCount: 5, maxScenarios: 20, existingScenarioCount: 2 });
    expect(ok).toMatchObject({ scenarioIsNotReality: true, forecastIsNotFutureFact: true });
  });

  it('resource demand: 병목/전문가 부족/미검증 구분 (예약 아님)', () => {
    expect(evaluateResourceDemand({ demandItems: [{ kind: 'reviewer', requiredUnits: 5, availableUnits: 2 }], specialistRequired: false, specialistAvailable: null, reviewerAvailable: true }).result).toBe('resource_bottleneck_candidate');
    expect(evaluateResourceDemand({ demandItems: [], specialistRequired: true, specialistAvailable: false, reviewerAvailable: true }).result).toBe('specialist_shortage_candidate');
    expect(evaluateResourceDemand({ demandItems: [{ kind: 'compute', requiredUnits: 1, availableUnits: null }], specialistRequired: false, specialistAvailable: null, reviewerAvailable: true }).result).toBe('resource_availability_unverified');
    const ok = evaluateResourceDemand({ demandItems: [{ kind: 'compute', requiredUnits: 1, availableUnits: 3 }], specialistRequired: false, specialistAvailable: null, reviewerAvailable: true });
    expect(ok.result).toBe('resource_demand_ready_reference');
    expect(ok.demandIsNotReservation).toBe(true);
  });

  it('financial: budget 없음 → unverified, 초과 → exceeded (Budget Reference ≠ Cash)', () => {
    expect(evaluateFinancialConstraint({ budgetReference: null, estimatedCost: 100, recurringCost: null }).result).toBe('budget_unverified');
    expect(evaluateFinancialConstraint({ budgetReference: 100, estimatedCost: 150, recurringCost: null }).result).toBe('budget_exceeded_candidate');
    expect(evaluateFinancialConstraint({ budgetReference: 100, estimatedCost: 95, recurringCost: null }).result).toBe('budget_constraint_candidate');
    const ok = evaluateFinancialConstraint({ budgetReference: 100, estimatedCost: 30, recurringCost: null });
    expect(ok.result).toBe('within_budget_candidate');
    expect(ok.budgetReferenceIsNotCash).toBe(true);
    expect(evaluateFinancialConstraint({ budgetReference: 100, estimatedCost: Number.NaN, recurringCost: null }).result).toBe('budget_unverified');
  });

  it('capacity/workload: exhaustion/overload/미검증 (Estimate ≠ Guarantee·자동 인사 없음)', () => {
    expect(evaluateCapacityConstraint({ currentCapacity: 100, requiredCapacity: 120, safetyMarginPct: 15 }).result).toBe('capacity_exhaustion_candidate');
    expect(evaluateCapacityConstraint({ currentCapacity: 100, requiredCapacity: 90, safetyMarginPct: 15 }).result).toBe('capacity_bottleneck_candidate');
    expect(evaluateCapacityConstraint({ currentCapacity: null, requiredCapacity: 10, safetyMarginPct: 15 }).result).toBe('capacity_unverified');
    const w = evaluateHumanWorkloadConstraint({ concurrentInitiatives: 12, reviewerAvailable: true, specialistAvailable: true, commitmentLoad: 2, maxConcurrent: 5 });
    expect(w.result).toBe('workload_overload_candidate');
    expect(w.autoStaffAssignment).toBe(false);
    expect(evaluateHumanWorkloadConstraint({ concurrentInitiatives: 2, reviewerAvailable: false, specialistAvailable: true, commitmentLoad: 1, maxConcurrent: 5 }).result).toBe('reviewer_bottleneck_candidate');
  });
});

describe('strategyIntelligence — Concentration/Diversification/Balance/Trade-off', () => {
  it('concentration: 80%+ → critical (Confirmed Risk 아님)', () => {
    const c = evaluatePortfolioConcentration({ shares: [85, 10, 5] });
    expect(c.result).toBe('critical_concentration_candidate');
    expect(c.concentrationIsNotConfirmedRisk).toBe(true);
    expect(evaluatePortfolioConcentration({ shares: [30, 30, 40] }).result).toBe('moderate_concentration_candidate');
    expect(evaluatePortfolioConcentration({ shares: null }).result).toBe('insufficient_data');
    expect(evaluatePortfolioConcentration({ shares: [Number.NaN, 1] }).result).toBe('concentration_unverified');
  });

  it('diversification: superficial/limited/diversified (Resilience 보장 아님)', () => {
    expect(evaluatePortfolioDiversification({ dimensionCounts: [{ dimension: 'goal', distinctValues: 5 }, { dimension: 'provider', distinctValues: 4 }], superficialOverlap: false }).result).toBe('diversified_candidate');
    expect(evaluatePortfolioDiversification({ dimensionCounts: [{ dimension: 'goal', distinctValues: 5 }], superficialOverlap: true }).result).toBe('superficial_diversification_candidate');
    const lim = evaluatePortfolioDiversification({ dimensionCounts: [{ dimension: 'goal', distinctValues: 1 }], superficialOverlap: false });
    expect(lim.result).toBe('limited_diversification_candidate');
    expect(lim.diversificationIsNotGuaranteedResilience).toBe(true);
  });

  it('balance: growth 60%+ → growth_heavy, 분산 30개+ → fragmented', () => {
    expect(evaluatePortfolioBalance({ growthShare: 70, stabilityShare: 20, costShare: 5, innovationShare: 5, highRiskShare: 10, initiativeCount: 10 }).result).toBe('growth_heavy_candidate');
    expect(evaluatePortfolioBalance({ growthShare: 20, stabilityShare: 20, costShare: 20, innovationShare: 20, highRiskShare: 10, initiativeCount: 40 }).result).toBe('fragmented_portfolio_candidate');
    const bal = evaluatePortfolioBalance({ growthShare: 45, stabilityShare: 40, costShare: 10, innovationShare: 5, highRiskShare: 10, initiativeCount: 8 });
    expect(bal.result).toBe('balanced_portfolio_candidate');
    expect(bal.autoRebalanced).toBe(false);
    expect(evaluatePortfolioBalance({ growthShare: null, stabilityShare: 40, costShare: null, innovationShare: null, highRiskShare: null, initiativeCount: 5 }).result).toBe('balance_unverified');
  });

  it('tradeoff/robustness/regret — 자동 선택 없음·Robust ≠ Correct·Lowest Regret ≠ Best', () => {
    expect(evaluateStrategicTradeoffs({ axis: 'bad_axis', sideAScore: 50, sideBScore: 50 }).result).toBe('insufficient_data');
    const t = evaluateStrategicTradeoffs({ axis: 'growth_vs_stability', sideAScore: 90, sideBScore: 30 });
    expect(t.result).toBe('favorable_tradeoff_candidate');
    expect(t.autoPortfolioSelected).toBe(false);
    const cases = (flags: (boolean | null)[]) => flags.map((acceptable, k) => ({ scenario: `s${k}`, acceptable }));
    const rob = evaluateStrategicRobustness({ scenarioOutcomes: cases([true, true, true]), minScenarios: 3 });
    expect(rob.result).toBe('robust_portfolio_candidate');
    expect(rob.robustPortfolioIsNotCorrectPortfolio).toBe(true);
    expect(evaluateStrategicRobustness({ scenarioOutcomes: cases([true, false, false]), minScenarios: 3 }).result).toBe('scenario_specific_candidate');
    const reg = evaluateStrategicRegret({ worstCaseLoss: 100, opportunityCost: 5, reversible: false, lockInPresent: true });
    expect(reg.result).toBe('asymmetric_regret_candidate');
    expect(reg.lowestRegretIsNotBestStrategy).toBe(true);
  });

  it('reversibility/feasibility — Exit 보장 아님·자원 예약 아님', () => {
    expect(evaluateStrategicReversibility({ stoppable: true, contractLockIn: true, providerLockIn: true, dataMigrationRequired: false, exitConditionsDefined: true, rollbackReferenceExists: true }).result).toBe('irreversible_candidate');
    const rev = evaluateStrategicReversibility({ stoppable: true, contractLockIn: false, providerLockIn: false, dataMigrationRequired: false, exitConditionsDefined: true, rollbackReferenceExists: true });
    expect(rev.result).toBe('highly_reversible_candidate');
    expect(rev.reversibilityIsNotGuaranteedExit).toBe(true);
    expect(evaluateStrategicFeasibility({ technicallyPossible: true, reviewerAvailable: false, budgetWithin: true, capacityWithin: true, policyAllowed: true, dependenciesReady: true }).result).toBe('feasibility_blocked_candidate');
    const f = evaluateStrategicFeasibility({ technicallyPossible: true, reviewerAvailable: true, budgetWithin: true, capacityWithin: true, policyAllowed: true, dependenciesReady: true });
    expect(f.result).toBe('feasible_portfolio_candidate');
    expect(f.feasibilityIsNotResourceReservation).toBe(true);
  });
});

describe('strategyIntelligence — Roadmap/Milestone/Critical Path/Recommendation/Review', () => {
  it('roadmap: 누락 선행 탐지·순서 정렬 (Execution Schedule 아님)', () => {
    const r = buildStrategicRoadmapCandidate({ steps: [{ code: 'B', sequence: 2, prerequisites: ['A'] }, { code: 'A', sequence: 1, prerequisites: [] }, { code: 'C', sequence: 3, prerequisites: ['X'] }] });
    expect(r.orderedCodes).toEqual(['A', 'B', 'C']);
    expect(r.result).toBe('missing_prerequisite_candidate');
    expect(r.missingPrerequisites).toEqual([{ code: 'C', missing: ['X'] }]);
    expect(r.roadmapIsNotExecutionSchedule).toBe(true);
    expect(buildStrategicRoadmapCandidate({ steps: [{ code: 'A', sequence: -1, prerequisites: [] }] }).result).toBe('invalid_sequence');
  });

  it('milestone: Evidence 없는 achieved 차단 (≠ Commitment)', () => {
    expect(buildMilestoneCandidate({ name: 'M1', status: 'achieved_reference', evidenceCount: 0 })).toMatchObject({ rejected: true });
    const ok = buildMilestoneCandidate({ name: 'M1', status: 'achieved_reference', evidenceCount: 2 });
    expect(ok).toMatchObject({ milestoneIsNotCommitment: true, autoCompleted: false });
    expect(buildMilestoneCandidate({ name: 'M2', status: 'weird', evidenceCount: 0 })).toMatchObject({ rejected: true });
  });

  it('critical path: 최장 경로·순환 차단·다중 경로 (일정 보장 아님)', () => {
    const cp = calculateCriticalPathCandidate({ edges: [{ from: 'A', to: 'B', durationDays: 5 }, { from: 'B', to: 'C', durationDays: 10 }, { from: 'A', to: 'C', durationDays: 3 }] });
    expect(cp.pathCodes).toEqual(['A', 'B', 'C']);
    expect(cp.totalDurationDays).toBe(15);
    expect(cp.result).toBe('critical_path_candidate');
    expect(cp.criticalPathIsNotScheduleGuarantee).toBe(true);
    expect(calculateCriticalPathCandidate({ edges: [{ from: 'A', to: 'B', durationDays: 1 }, { from: 'B', to: 'A', durationDays: 1 }] }).result).toBe('path_blocked_candidate');
    expect(calculateCriticalPathCandidate({ edges: [{ from: 'A', to: 'B', durationDays: null }] }).result).toBe('critical_path_unverified');
  });

  it('recommendation: whitelist+Evidence 필수 (≠ Approval)', () => {
    expect(buildStrategyRecommendationCandidate({ type: 'auto_select_portfolio', reason: 'r', evidence: ['e'], confidence: 50 })).toMatchObject({ rejected: true });
    expect(buildStrategyRecommendationCandidate({ type: 'rebalance_portfolio_candidate', reason: 'r', evidence: [], confidence: 50 })).toMatchObject({ rejected: true });
    const ok = buildStrategyRecommendationCandidate({ type: 'rebalance_portfolio_candidate', reason: '집중도 완화', evidence: ['concentration_review'], confidence: 300 });
    expect(ok).toMatchObject({ confidence: 100, recommendationIsNotApproval: true, humanStrategyApprovalRequired: true, autoSelected: false });
    expect(STRATEGY_RECOMMENDATION_TYPES).toHaveLength(34);
  });

  it('strategy review: Self-Approval 차단·Evidence 필수·배분/적용 전부 false', () => {
    expect(validateStrategyReviewAction({ action: 'approve_portfolio_reference', reason: 'ok', evidenceCount: 1, reviewerIsCreator: true })).toMatchObject({ rejected: true });
    expect(validateStrategyReviewAction({ action: 'approve_portfolio_reference', reason: 'ok', evidenceCount: 0, reviewerIsCreator: false })).toMatchObject({ rejected: true });
    expect(validateStrategyReviewAction({ action: 'select_portfolio_automatically', reason: 'r', evidenceCount: 1, reviewerIsCreator: false })).toMatchObject({ rejected: true });
    const ok = validateStrategyReviewAction({ action: 'approve_with_conditions_reference', reason: '조건부 승인', evidenceCount: 2, reviewerIsCreator: false });
    expect(ok).toMatchObject({ humanStrategyDecisionConfirmed: true, approvalIsNotAllocation: true, budgetAllocated: false, resourcesAllocated: false, productionApplied: false });
  });
});

describe('strategyIntelligence — Outcome/Quality/Drift/Learning/Timeline/Matrix', () => {
  it('outcome: 외부 요인 → causality_unverified, 표본 부족 → sample_too_small (≠ Causality)', () => {
    expect(evaluateStrategicOutcome({ observedOutcomeExists: false, observationCompletenessPct: null, externalFactorPresent: false, sampleSize: 10, minSample: 5 }).result).toBe('outcome_unverified');
    expect(evaluateStrategicOutcome({ observedOutcomeExists: true, observationCompletenessPct: 100, externalFactorPresent: false, sampleSize: 2, minSample: 5 }).result).toBe('sample_too_small');
    const ok = evaluateStrategicOutcome({ observedOutcomeExists: true, observationCompletenessPct: 95, externalFactorPresent: false, sampleSize: 10, minSample: 5 });
    expect(ok.result).toBe('outcome_linked_reference');
    expect(ok.outcomeIsNotStrategyCausality).toBe(true);
  });

  it('quality: 3/3 달성 → high, 부작용 → mixed (경영진 평가 아님)', () => {
    expect(calculateStrategyQualityCandidate({ outcomeLinked: false, goalAchieved: true, financialWithinRange: true, capacityWithinRange: true, unexpectedSideEffect: false, causalityVerified: true, sampleSize: 10, minSample: 5 }).result).toBe('outcome_unverified');
    const high = calculateStrategyQualityCandidate({ outcomeLinked: true, goalAchieved: true, financialWithinRange: true, capacityWithinRange: true, unexpectedSideEffect: false, causalityVerified: true, sampleSize: 10, minSample: 5 });
    expect(high.result).toBe('high_quality_candidate');
    expect(high.qualityCandidateIsNotExecutiveEvaluation).toBe(true);
    expect(calculateStrategyQualityCandidate({ outcomeLinked: true, goalAchieved: true, financialWithinRange: true, capacityWithinRange: false, unexpectedSideEffect: true, causalityVerified: true, sampleSize: 10, minSample: 5 }).result).toBe('mixed_quality_candidate');
  });

  it('drift: vision/goal drift → structural, portfolio drift ≠ 자동 재조정', () => {
    expect(calculateStrategyDriftCandidate({ driftedDimensions: ['vision_drift'], assumptionsInvalidated: 0 }).result).toBe('structural_drift_candidate');
    expect(calculateStrategyDriftCandidate({ driftedDimensions: [], assumptionsInvalidated: 0 }).result).toBe('no_material_drift_candidate');
    const pd = calculatePortfolioDriftCandidate({ driftedDimensions: ['initiative_mix_drift', 'balance_drift', 'timeline_drift'] });
    expect(pd.result).toBe('structural_portfolio_drift_candidate');
    expect(pd.driftIsNotAutomaticRebalancing).toBe(true);
    expect(calculatePortfolioDriftCandidate({ driftedDimensions: [] }).result).toBe('no_material_portfolio_drift_candidate');
  });

  it('learning/timeline — 자동 Goal·Portfolio 변경 없음', () => {
    const l = buildStrategyLearningReference({ effectiveGoals: ['g1'], overestimatedInitiatives: [], missedDependencies: ['d1'], actualBottlenecks: [], templateImprovements: ['t1'] });
    expect(l).toMatchObject({ entryCount: 3, result: 'learning_reference_recorded', autoGoalChanged: false, autoPortfolioChanged: false });
    const t = buildStrategyTimeline({ present: { strategic_goal: true, strategy_portfolio: true } });
    expect(t.stages).toHaveLength(12);
    expect(t.completedCount).toBe(2);
    expect(t.timelineIsNotExecutionLog).toBe(true);
  });

  it('support matrix: 72항목, automatic 계열 13개 전부 unsupported', () => {
    expect(STRATEGY_SUPPORT_MATRIX).toHaveLength(72);
    const unsupported = STRATEGY_SUPPORT_MATRIX.filter((f) => f.status === 'unsupported');
    expect(unsupported).toHaveLength(13);
    expect(unsupported.every((f) => f.feature.startsWith('automatic_'))).toBe(true);
  });
});
