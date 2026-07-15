import { describe, expect, it } from 'vitest';
import {
  buildExecutiveCapacityRecommendation,
  buildExecutiveLoadBalancingCandidate,
  buildPortfolioOutcomeLink,
  buildPriorityDeferralCandidate,
  buildPriorityPortfolio,
  calculateCapacityHealthScore,
  calculateCapacityUtilization,
  calculateConfidenceDrift,
  calculateDecisionLoad,
  calculateDelayCost,
  calculateDelayExposure,
  calculateFinancialExposure,
  calculateOpportunityROI,
  calculatePriorityAging,
  calculatePriorityEffort,
  CAPACITY_SUPPORT,
  classifyAgingStatus,
  classifyConfidenceDrift,
  classifyExecutiveCapacity,
  detectCapacityConflict,
  detectMutuallyExclusivePriorities,
  detectOrganizationalDependency,
  detectScheduleConflict,
  detectSingleApproverDependency,
  detectSinglePersonDependency,
  evaluateHardRiskCoverage,
  evaluateNonFinancialValue,
  evaluatePortfolioFeasibility,
  simulatePortfolioDecision,
  validateExecutiveCapacity,
  validatePriorityEffort,
  type PortfolioPriorityInput,
} from './executiveCapacityIntelligence';

const NOW = new Date('2026-07-15T00:00:00Z');

describe('executive capacity — 임의 생성 금지·성과 평가 아님', () => {
  it('validate: reserved > available 차단, hours null 은 오류 아님', () => {
    expect(validateExecutiveCapacity({ availableHours: 10, reservedHours: 20, reviewCapacity: null, currentPriorities: null })).toContain('reserved > available 금지');
    expect(validateExecutiveCapacity({ availableHours: null, reservedHours: null, reviewCapacity: null, currentPriorities: null })).toEqual([]);
    expect(validateExecutiveCapacity({ availableHours: -1, reservedHours: null, reviewCapacity: null, currentPriorities: -2 })).toHaveLength(2);
  });
  it('classify: 시간 자료 없음 → executive_capacity_unknown(임의 생성 없음)', () => {
    const r = classifyExecutiveCapacity({ availableHours: null, reservedHours: null, concurrentLimit: 5, currentPriorities: 10 });
    expect(r.status).toBe('executive_capacity_unknown');
    expect(r.notPerformanceEvaluation).toBe(true);
  });
  it('classify: 여유 구간별 available/constrained/overloaded/critical', () => {
    expect(classifyExecutiveCapacity({ availableHours: 40, reservedHours: 10, concurrentLimit: null, currentPriorities: null }).status).toBe('available_reference');
    expect(classifyExecutiveCapacity({ availableHours: 40, reservedHours: 32, concurrentLimit: null, currentPriorities: null }).status).toBe('constrained_candidate');
    expect(classifyExecutiveCapacity({ availableHours: 40, reservedHours: 38, concurrentLimit: null, currentPriorities: null }).status).toBe('overloaded_candidate');
    expect(classifyExecutiveCapacity({ availableHours: 0, reservedHours: null, concurrentLimit: null, currentPriorities: null }).status).toBe('critical_overload_candidate');
  });
});

describe('decision load / utilization', () => {
  it('P0 3건 이상 → critical, 건수 미상 → insufficient, 단일 Approver 는 사유 기록', () => {
    expect(calculateDecisionLoad({ pendingPriorities: 5, p0Count: 3, p1Count: 0, pendingAgendas: 0, pendingConflicts: 0, singleApprover: false }).verdict).toBe('critical_decision_load');
    expect(calculateDecisionLoad({ pendingPriorities: null, p0Count: null, p1Count: null, pendingAgendas: null, pendingConflicts: null, singleApprover: null }).verdict).toBe('insufficient_data');
    const r = calculateDecisionLoad({ pendingPriorities: 2, p0Count: 0, p1Count: 1, pendingAgendas: 1, pendingConflicts: 0, singleApprover: true });
    expect(r.verdict).toBe('elevated_load');
    expect(r.reasons.join(' ')).toContain('단일 Approver');
  });
  it('utilization: available null/0 → 계산 금지, 초과 → overloaded', () => {
    expect(calculateCapacityUtilization({ usedHours: 10, availableHours: null, concurrentUsed: null, concurrentLimit: null }).verdict).toBe('executive_capacity_unknown');
    expect(calculateCapacityUtilization({ usedHours: 10, availableHours: 0, concurrentUsed: null, concurrentLimit: null }).utilizationPct).toBeNull();
    expect(calculateCapacityUtilization({ usedHours: 50, availableHours: 40, concurrentUsed: null, concurrentLimit: null }).verdict).toBe('overloaded_candidate');
    expect(calculateCapacityUtilization({ usedHours: 20, availableHours: 40, concurrentUsed: 2, concurrentLimit: 5 }).verdict).toBe('balanced_reference');
  });
});

describe('priority effort — null→0 합산 금지·검토/실행 분리', () => {
  it('음수 차단 + null 허용', () => {
    expect(validatePriorityEffort({ reviewHours: -1, decisionHours: null, executionHours: null })).toHaveLength(1);
    expect(validatePriorityEffort({ reviewHours: null, decisionHours: null, executionHours: null })).toEqual([]);
  });
  it('알려진 항목만 부분 합산 — null 은 0 으로 채우지 않음', () => {
    const r = calculatePriorityEffort({ reviewHours: 2, decisionHours: 1, meetingHours: null, analysisHours: null, executionHours: null, observationHours: null });
    expect(r.reviewTotalHours).toBe(3);
    expect(r.executionTotalHours).toBeNull();   // 실행 시간 미상 — 0 아님
    expect(r.status).toBe('partially_estimated');
    expect(r.nullSummedAsZero).toBe(false);
    expect(r.missing).toContain('execution');
  });
  it('전부 null → effort_unverified, 전부 존재 → measured_reference', () => {
    expect(calculatePriorityEffort({ reviewHours: null, decisionHours: null, meetingHours: null, analysisHours: null, executionHours: null, observationHours: null }).status).toBe('effort_unverified');
    expect(calculatePriorityEffort({ reviewHours: 1, decisionHours: 1, meetingHours: 1, analysisHours: 1, executionHours: 1, observationHours: 1 }).status).toBe('measured_reference');
  });
});

describe('aging — 자동 승격 없음·Threshold 명시 입력', () => {
  it('age/statusAge/deadline 계산(음수 방어)', () => {
    const r = calculatePriorityAging({ createdAt: new Date('2026-07-01T00:00:00Z'), reviewedAt: null, deadlineAt: new Date('2026-07-20T00:00:00Z'), now: NOW });
    expect(r.ageDays).toBe(14);
    expect(r.statusAgeDays).toBeNull();
    expect(r.daysToDeadline).toBe(5);
  });
  it('deadline 경과 → overdue/critical, Threshold 없음 → aging_threshold_unverified', () => {
    expect(classifyAgingStatus({ ageDays: 30, daysToDeadline: -10, thresholds: null }).status).toBe('critical_overdue_candidate');
    expect(classifyAgingStatus({ ageDays: 30, daysToDeadline: -2, thresholds: null }).status).toBe('overdue_candidate');
    expect(classifyAgingStatus({ ageDays: 30, daysToDeadline: 3, thresholds: null }).status).toBe('deadline_approaching');
    const r = classifyAgingStatus({ ageDays: 30, daysToDeadline: null, thresholds: null });
    expect(r.status).toBe('aging_threshold_unverified');
    expect(r.autoEscalated).toBe(false);
  });
  it('명시 Threshold 입력 시 fresh/aging/stale 분기', () => {
    const thresholds = { agingDays: 14, staleDays: 30 };
    expect(classifyAgingStatus({ ageDays: 5, daysToDeadline: null, thresholds }).status).toBe('fresh_reference');
    expect(classifyAgingStatus({ ageDays: 20, daysToDeadline: null, thresholds }).status).toBe('aging_candidate');
    expect(classifyAgingStatus({ ageDays: 40, daysToDeadline: null, thresholds }).status).toBe('stale_priority_candidate');
  });
});

describe('exposure / delay cost / ROI — 실제 손실·수익률 아님', () => {
  it('금액 미상 → financial_exposure_unknown, 인과 미확인 → causality_unverified', () => {
    expect(calculateDelayExposure({ exposureAmountKrw: null, mrrKrw: 1000000, hardRiskWindow: false, causalBasis: true }).verdict).toBe('financial_exposure_unknown');
    expect(calculateDelayExposure({ exposureAmountKrw: 100000, mrrKrw: 1000000, hardRiskWindow: false, causalBasis: false }).verdict).toBe('causality_unverified');
    expect(calculateDelayExposure({ exposureAmountKrw: 600000, mrrKrw: 1000000, hardRiskWindow: false, causalBasis: true }).verdict).toBe('critical_exposure_candidate');
    expect(calculateDelayExposure({ exposureAmountKrw: null, mrrKrw: null, hardRiskWindow: true, causalBasis: null }).verdict).toBe('critical_exposure_candidate');
  });
  it('financial exposure: 전부 null → unknown(0 변환 없음), 확률 가중은 assumption_based', () => {
    const empty = calculateFinancialExposure({ lowEstimate: null, expectedEstimate: null, highEstimate: null, probabilityPct: null });
    expect(empty.expectedExposure).toBeNull();
    expect(empty.verification).toBe('financial_exposure_unknown');
    const r = calculateFinancialExposure({ lowEstimate: 100, expectedEstimate: 1000, highEstimate: 2000, probabilityPct: 50 });
    expect(r.expectedExposure).toBe(500);
    expect(r.accountingLoss).toBe(false);
  });
  it('delay cost: Exposure/인과/Factor/Time 전부 있어야 계산(가짜 수치 금지)', () => {
    expect(calculateDelayCost({ exposureAmount: null, delayFactorPerDay: 0.01, delayDays: 10, causalBasis: true }).status).toBe('financial_exposure_unknown');
    expect(calculateDelayCost({ exposureAmount: 1000, delayFactorPerDay: 0.01, delayDays: 10, causalBasis: false }).status).toBe('causality_unverified');
    expect(calculateDelayCost({ exposureAmount: 1000, delayFactorPerDay: null, delayDays: 10, causalBasis: true }).status).toBe('insufficient_data');
    const ok = calculateDelayCost({ exposureAmount: 1000, delayFactorPerDay: 0.01, delayDays: 10, causalBasis: true });
    expect(ok.cost).toBe(100);
    expect(ok.fabricated).toBe(false);
  });
  it('ROI: cost 0/null → roi_unavailable, 실제 수익률 아님', () => {
    expect(calculateOpportunityROI({ expectedBenefit: 100, expectedCost: 0 }).verdict).toBe('roi_unavailable');
    expect(calculateOpportunityROI({ expectedBenefit: 100, expectedCost: null }).verdict).toBe('roi_unavailable');
    expect(calculateOpportunityROI({ expectedBenefit: null, expectedCost: 100 }).verdict).toBe('financial_exposure_unknown');
    const r = calculateOpportunityROI({ expectedBenefit: 300, expectedCost: 100 });
    expect(r.roiPct).toBe(200);
    expect(r.verdict).toBe('favorable_roi_candidate');
    expect(r.actualReturn).toBe(false);
    expect(calculateOpportunityROI({ expectedBenefit: 50, expectedCost: 100 }).verdict).toBe('negative_roi_candidate');
  });
  it('비금전 가치: qualitative_reference 만(금액 환산 없음), Evidence 없는 항목 제외', () => {
    const r = evaluateNonFinancialValue([{ kind: 'risk_reduction', rationale: 'r', evidence: ['e'] }, { kind: 'trust', rationale: 'r', evidence: [] }]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].label).toBe('qualitative_reference');
    expect(r.monetized).toBe(false);
  });
});

describe('confidence drift — 표본<3 판정 금지·자동 수정 없음', () => {
  it('표본 2 미만 → drift null, 3 미만 → sample_too_small', () => {
    expect(calculateConfidenceDrift([{ at: NOW, value: 80 }]).driftFromInitial).toBeNull();
    const drift = calculateConfidenceDrift([
      { at: new Date('2026-07-01'), value: 80 }, { at: new Date('2026-07-08'), value: 70 },
    ]);
    expect(drift.driftFromInitial).toBe(-10);
    expect(classifyConfidenceDrift({ driftFromInitial: -10, volatility: 5, sampleSize: 2 }).status).toBe('sample_too_small');
  });
  it('감소/증가/변동/안정 분기 + 자동 폐기 없음', () => {
    expect(classifyConfidenceDrift({ driftFromInitial: -15, volatility: 5, sampleSize: 4 }).status).toBe('decreasing_candidate');
    expect(classifyConfidenceDrift({ driftFromInitial: 12, volatility: 5, sampleSize: 4 }).status).toBe('increasing_candidate');
    expect(classifyConfidenceDrift({ driftFromInitial: 2, volatility: 20, sampleSize: 4 }).status).toBe('volatile_candidate');
    const r = classifyConfidenceDrift({ driftFromInitial: 2, volatility: 3, sampleSize: 4 });
    expect(r.status).toBe('stable_reference');
    expect(r.autoConfidenceAdjusted).toBe(false);
    expect(r.autoDiscarded).toBe(false);
  });
});

describe('organizational dependency — 인사 평가 아님', () => {
  it('조직도 없음 → unverified(임의 생성 금지)', () => {
    const r = detectOrganizationalDependency({ owners: ['a'], approvers: ['a'], backups: [], orgDataAvailable: false });
    expect(r.verdict).toBe('organizational_dependency_unverified');
    expect(r.notPersonnelEvaluation).toBe(true);
  });
  it('Owner 부재/Backup 부재/단일 Approver 분기', () => {
    expect(detectOrganizationalDependency({ owners: [], approvers: [], backups: [], orgDataAvailable: true }).verdict).toBe('missing_owner');
    expect(detectOrganizationalDependency({ owners: ['a'], approvers: ['a', 'b'], backups: [], orgDataAvailable: true }).verdict).toBe('missing_backup_owner');
    expect(detectOrganizationalDependency({ owners: ['a', 'b'], approvers: ['a'], backups: ['c'], orgDataAvailable: true }).verdict).toBe('single_approver_dependency_candidate');
    expect(detectOrganizationalDependency({ owners: ['a', 'b'], approvers: ['a', 'b'], backups: ['c'], orgDataAvailable: true }).verdict).toBe('dependency_resilient_reference');
  });
  it('단일 인물 집중 + 단일 Approver 이력 감지', () => {
    expect(detectSinglePersonDependency([{ person: 'admin', priorityCodes: ['p1', 'p2', 'p3'] }]).verdict).toBe('concentration_candidate');
    expect(detectSinglePersonDependency(null).verdict).toBe('organizational_dependency_unverified');
    expect(detectSingleApproverDependency([{ approver: 'a' }, { approver: 'a' }]).verdict).toBe('single_approver_dependency_candidate');
    expect(detectSingleApproverDependency([{ approver: 'a' }, { approver: 'b' }]).verdict).toBe('dependency_resilient_reference');
  });
});

const PRIORITIES: PortfolioPriorityInput[] = [
  { code: 'P-HARD', tier: 'P0_human_review_now', hardRiskFlags: ['security'], reviewHours: 4, materialityScore: 90, mutuallyExclusiveWith: [], dependencies: [] },
  { code: 'P-BIG', tier: 'P1_executive_review', hardRiskFlags: [], reviewHours: 8, materialityScore: 70, mutuallyExclusiveWith: ['P-ALT'], dependencies: [] },
  { code: 'P-ALT', tier: 'P1_executive_review', hardRiskFlags: [], reviewHours: 3, materialityScore: 60, mutuallyExclusiveWith: ['P-BIG'], dependencies: [] },
  { code: 'P-LOW', tier: 'P3_monitor', hardRiskFlags: [], reviewHours: 6, materialityScore: 20, mutuallyExclusiveWith: [], dependencies: [] },
];

describe('portfolio — 자동 선택 없음·optimal 단정 없음', () => {
  it('hard_risk_first: Hard Risk 최우선 포함, Capacity 초과분은 사유와 함께 제외', () => {
    const r = buildPriorityPortfolio({ priorities: PRIORITIES, availableReviewHours: 13, strategy: 'hard_risk_first_reference' });
    expect(r.included[0]).toBe('P-HARD');
    expect(r.included).toContain('P-BIG');
    expect(r.excluded.find((e) => e.code === 'P-ALT')?.why).toContain('상호 배타');
    expect(r.excluded.find((e) => e.code === 'P-LOW')?.why).toContain('중요도 부족 아님');
    expect(r.optimalClaimed).toBe(false);
    expect(r.autoSelected).toBe(false);
  });
  it('capacity 자료 없으면 totalReviewHours null(임의 생성 없음), 상호 배타는 여전히 적용', () => {
    const r = buildPriorityPortfolio({ priorities: PRIORITIES.map((p) => ({ ...p, reviewHours: null })), availableReviewHours: null, strategy: 'tier_first_reference' });
    expect(r.totalReviewHours).toBeNull();
    expect(r.included).toHaveLength(3);
    expect(r.excluded.find((e) => e.code === 'P-ALT')?.why).toContain('상호 배타');
  });
  it('Hard Risk 조용한 제외 감지 + feasibility 최우선 차단', () => {
    const coverage = evaluateHardRiskCoverage({ priorities: PRIORITIES, includedCodes: ['P-BIG'], exclusionReasons: null });
    expect(coverage.covered).toBe(false);
    expect(coverage.silentlyExcluded).toContain('P-HARD');
    const f = evaluatePortfolioFeasibility({ totalReviewHours: 8, availableReviewHours: 40, hardRiskCoverage: { covered: false, silentlyExcluded: ['P-HARD'] }, resourceConflicts: [], scheduleConflicts: [], mutexConflicts: [], blockingDependencies: [] });
    expect(f.status).toBe('hard_risk_uncovered');
  });
  it('명시 사유 있는 제외는 silent 아님 + partially_feasible', () => {
    const coverage = evaluateHardRiskCoverage({ priorities: PRIORITIES, includedCodes: ['P-BIG'], exclusionReasons: { 'P-HARD': '외부 감사 대기 — 즉시 사람 검토 별도 진행' } });
    expect(coverage.silentlyExcluded).toEqual([]);
    const f = evaluatePortfolioFeasibility({ totalReviewHours: 8, availableReviewHours: 40, hardRiskCoverage: { covered: false, silentlyExcluded: [] }, resourceConflicts: [], scheduleConflicts: [], mutexConflicts: [], blockingDependencies: [] });
    expect(f.status).toBe('partially_feasible');
  });
  it('capacity 미상 → feasible 단정 금지, 초과 → over_capacity', () => {
    expect(evaluatePortfolioFeasibility({ totalReviewHours: 8, availableReviewHours: null, hardRiskCoverage: { covered: true, silentlyExcluded: [] }, resourceConflicts: [], scheduleConflicts: [], mutexConflicts: [], blockingDependencies: [] }).status).toBe('executive_capacity_unknown');
    expect(evaluatePortfolioFeasibility({ totalReviewHours: 50, availableReviewHours: 40, hardRiskCoverage: { covered: true, silentlyExcluded: [] }, resourceConflicts: [], scheduleConflicts: [], mutexConflicts: [], blockingDependencies: [] }).status).toBe('over_capacity');
    expect(evaluatePortfolioFeasibility({ totalReviewHours: 8, availableReviewHours: 40, hardRiskCoverage: { covered: true, silentlyExcluded: [] }, resourceConflicts: [], scheduleConflicts: [], mutexConflicts: [], blockingDependencies: [] }).status).toBe('feasible_reference');
  });
});

describe('conflicts — 보존·자동 제거 없음', () => {
  it('role 초과 → resource_conflict, 자료 없음 → insufficient', () => {
    expect(detectCapacityConflict({ requiredRoles: ['admin'], sharedRoleUsage: { admin: 5 }, roleLimit: 3 }).verdict).toBe('resource_conflict');
    expect(detectCapacityConflict({ requiredRoles: ['admin'], sharedRoleUsage: null, roleLimit: 3 }).verdict).toBe('insufficient_data');
  });
  it('기간 겹침 → schedule_conflict(양쪽 보존), 기간 미상 → insufficient', () => {
    const r = detectScheduleConflict(
      { code: 'a', start: new Date('2026-07-01'), end: new Date('2026-07-10') },
      { code: 'b', start: new Date('2026-07-05'), end: new Date('2026-07-15') },
    );
    expect(r.verdict).toBe('schedule_conflict');
    expect(r.preserved).toEqual(['a', 'b']);
    expect(detectScheduleConflict({ code: 'a', start: null, end: null }, { code: 'b', start: null, end: null }).verdict).toBe('insufficient_data');
  });
  it('상호 배타 동시 포함 → conflict 반환(자동 제거 없음)', () => {
    const r = detectMutuallyExclusivePriorities([{ code: 'A', mutuallyExclusiveWith: ['B'] }, { code: 'B', mutuallyExclusiveWith: ['A'] }], ['A', 'B']);
    expect(r.conflicts).toEqual([{ a: 'A', b: 'B' }]);
    expect(r.autoRemoved).toBe(false);
  });
});

describe('deferral / load balancing / simulation / recommendation / outcome', () => {
  it('deferral: Evidence 필수, riskIfDeferred 미상은 0 아님으로 명시, 자동 상태 변경 없음', () => {
    expect('insufficient' in buildPriorityDeferralCandidate({ code: 'p', reason: 'capacity_conflict', riskIfDeferred: null, financialExposure: null, evidence: [] })).toBe(true);
    const r = buildPriorityDeferralCandidate({ code: 'p', reason: 'lower_materiality', riskIfDeferred: null, financialExposure: null, evidence: ['e'] });
    if ('autoDeferred' in r) {
      expect(r.autoDeferred).toBe(false);
      expect(r.riskIfDeferred).toContain('0 아님');
      expect(r.financialExposure).toBeNull();
    }
  });
  it('load balancing: capacity 자료 없으면 request_capacity_data, 업무 할당 없음', () => {
    expect(buildExecutiveLoadBalancingCandidate({ singleRoleOverload: true, singleApprover: true, missingBackup: true, meetingOverload: false, capacityDataAvailable: false })).toEqual([{ type: 'request_capacity_data', workAssigned: false }]);
    const r = buildExecutiveLoadBalancingCandidate({ singleRoleOverload: true, singleApprover: true, missingBackup: true, meetingOverload: true, capacityDataAvailable: true });
    expect(r.map((x) => x.type)).toEqual(['require_joint_review', 'assign_backup_reference', 'distribute_review_candidate', 'reduce_concurrent_priorities']);
    expect(r.every((x) => x.workAssigned === false)).toBe(true);
  });
  it('simulation: Evidence 없으면 counterfactual_unverified, Hard Risk 미커버 → uncovered, capacity 감소 반영', () => {
    expect(simulatePortfolioDecision({ scenario: 'A', totalReviewHours: 10, availableReviewHours: 40, capacityReductionPct: null, hardRiskCovered: true, evidenceBased: false }).verdict).toBe('counterfactual_unverified');
    expect(simulatePortfolioDecision({ scenario: 'A', totalReviewHours: 10, availableReviewHours: 40, capacityReductionPct: null, hardRiskCovered: false, evidenceBased: true }).verdict).toBe('hard_risk_uncovered');
    expect(simulatePortfolioDecision({ scenario: 'cap-20%', totalReviewHours: 35, availableReviewHours: 40, capacityReductionPct: 20, hardRiskCovered: true, evidenceBased: true }).verdict).toBe('capacity_overload_candidate');
    const ok = simulatePortfolioDecision({ scenario: 'B', totalReviewHours: 10, availableReviewHours: 40, capacityReductionPct: 0, hardRiskCovered: true, evidenceBased: true });
    expect(ok.verdict).toBe('feasible_candidate');
    expect(ok.autoExecuted).toBe(false);
  });
  it('recommendation: whitelist + Evidence 필수 + humanApprovalRequired', () => {
    expect('rejected' in buildExecutiveCapacityRecommendation({ type: 'auto_assign_work', reason: 'x', evidence: ['e'], severity: 'high', capacityImpact: null, riskIfDeferred: null })).toBe(true);
    expect('rejected' in buildExecutiveCapacityRecommendation({ type: 'prioritize_hard_risk_review', reason: 'x', evidence: [], severity: 'high', capacityImpact: null, riskIfDeferred: null })).toBe(true);
    const r = buildExecutiveCapacityRecommendation({ type: 'prioritize_hard_risk_review', reason: 'P0 대기', evidence: ['e'], severity: 'critical', capacityImpact: null, riskIfDeferred: null });
    if ('humanApprovalRequired' in r) {
      expect(r.humanApprovalRequired).toBe(true);
      expect(r.autoExecuted).toBe(false);
      expect(r.capacityImpact).toContain('미상');
    }
  });
  it('outcome link: Decision Memory 참조 필수, 연결 ≠ 인과', () => {
    expect('insufficient' in buildPortfolioOutcomeLink({ portfolioCode: 'pf', decisionMemoryRef: null, observationClosed: true, evidence: ['e'] })).toBe(true);
    const r = buildPortfolioOutcomeLink({ portfolioCode: 'pf', decisionMemoryRef: 'dm-1', observationClosed: false, evidence: ['e'] });
    if ('causallyAttributed' in r) {
      expect(r.causallyAttributed).toBe(false);
      expect(r.linkStatus).toBe('outcome_pending');
    }
  });
  it('capacity health: 구성 요소 전부 null → null(선택 순서 아님)', () => {
    const r = calculateCapacityHealthScore({ utilizationScore: null, loadScore: null, dependencyScore: null, agingScore: null });
    expect(r.score).toBeNull();
    expect(r.selectionOrder).toBe(false);
    expect(calculateCapacityHealthScore({ utilizationScore: 80, loadScore: null, dependencyScore: null, agingScore: null }).score).toBe(80);
  });
});

describe('CAPACITY_SUPPORT — 실측 기반 지원 매트릭스', () => {
  it('38개 항목 + 자동 실행/캘린더/업무/예산/Production 은 unsupported', () => {
    expect(CAPACITY_SUPPORT).toHaveLength(38);
    for (const key of ['auto_priority_selection', 'auto_calendar', 'auto_work_assignment', 'auto_budget', 'auto_executive_decision', 'production_apply']) {
      expect(CAPACITY_SUPPORT.find((s) => s.key === key)?.status).toBe('unsupported');
    }
    expect(CAPACITY_SUPPORT.filter((s) => s.status === 'partial').length).toBeGreaterThan(5);
  });
});
