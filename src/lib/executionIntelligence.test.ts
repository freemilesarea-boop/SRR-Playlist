import { describe, expect, it } from 'vitest';
import {
  EXECUTION_PROGRAM_TYPES, EXECUTION_STATUSES, DELIVERY_HEALTH_LEVELS, DELIVERY_RISK_LEVELS,
  EXECUTION_RISK_DIMENSIONS, PROGRESS_DRIFT_LEVELS, DELIVERY_QUALITY_LEVELS, MILESTONE_STATUSES,
  DELAY_ROOT_CAUSE_CATEGORIES, DELIVERY_RECOMMENDATION_TYPES, EXECUTION_FLOW_STAGES,
  calculatePlannedProgressCandidate, evaluateProgressDrift, detectExecutionDependencyCycles,
  evaluateDelayCandidate, evaluateDeliveryHealth, evaluateDeliveryRisk, evaluateDeliveryQuality,
  calculateVelocityCandidate, buildDeliveryForecastCandidate, evaluateDelayRootCauseCandidate,
  validateDeliveryReview, buildExecutionTimeline, EXECUTION_COMPONENTS, EXECUTION_SUPPORT_MATRIX,
} from './executionIntelligence';

const DAY = 86_400_000;

describe('executionIntelligence 상수(SQL CHECK 1:1)', () => {
  it('핵심 whitelist 길이가 마이그레이션과 일치한다', () => {
    expect(EXECUTION_PROGRAM_TYPES).toHaveLength(12);
    expect(EXECUTION_STATUSES).toHaveLength(11);
    expect(DELIVERY_HEALTH_LEVELS).toHaveLength(6);
    expect(DELIVERY_RISK_LEVELS).toHaveLength(5);
    expect(EXECUTION_RISK_DIMENSIONS).toHaveLength(8);
    expect(PROGRESS_DRIFT_LEVELS).toHaveLength(5);
    expect(DELIVERY_QUALITY_LEVELS).toHaveLength(5);
    expect(MILESTONE_STATUSES).toHaveLength(8);
    expect(DELAY_ROOT_CAUSE_CATEGORIES).toHaveLength(9);
    expect(DELIVERY_RECOMMENDATION_TYPES).toHaveLength(29);
  });
  it('모든 whitelist 는 insufficient_data 를 포함한다(Unknown 유지)', () => {
    for (const list of [EXECUTION_STATUSES, DELIVERY_HEALTH_LEVELS, DELIVERY_RISK_LEVELS, PROGRESS_DRIFT_LEVELS, DELIVERY_QUALITY_LEVELS, MILESTONE_STATUSES, DELAY_ROOT_CAUSE_CATEGORIES]) {
      expect(list).toContain('insufficient_data');
    }
  });
});

describe('calculatePlannedProgressCandidate — Progress 계산', () => {
  it('경과 비율을 0~100 으로 계산하고 Planned ≠ Actual 을 명시한다', () => {
    const r = calculatePlannedProgressCandidate(0, 10 * DAY, 5 * DAY);
    expect(r.plannedProgressCandidate).toBe(50);
    expect(r.insufficientData).toBe(false);
    expect(r.plannedIsNotActual).toBe(true);
  });
  it('기간 밖 시점은 0/100 으로 clamp 된다', () => {
    expect(calculatePlannedProgressCandidate(0, 10 * DAY, -5 * DAY).plannedProgressCandidate).toBe(0);
    expect(calculatePlannedProgressCandidate(0, 10 * DAY, 20 * DAY).plannedProgressCandidate).toBe(100);
  });
  it('null/역전 기간은 insufficient_data — Null→0 치환 금지', () => {
    expect(calculatePlannedProgressCandidate(null, 10, 5).plannedProgressCandidate).toBeNull();
    expect(calculatePlannedProgressCandidate(10, 10, 5).insufficientData).toBe(true);
  });
});

describe('evaluateProgressDrift — Drift 계산', () => {
  it('임계값에 따라 on_track/minor/major/severe 를 판정한다', () => {
    expect(evaluateProgressDrift(50, 48).level).toBe('on_track');
    expect(evaluateProgressDrift(60, 50).level).toBe('minor_drift_candidate');
    expect(evaluateProgressDrift(80, 60).level).toBe('major_drift_candidate');
    expect(evaluateProgressDrift(90, 40).level).toBe('severe_drift_candidate');
  });
  it('null 입력은 insufficient_data 이고 Drift ≠ Confirmed Delay', () => {
    const r = evaluateProgressDrift(null, 50);
    expect(r.level).toBe('insufficient_data');
    expect(r.driftPoints).toBeNull();
    expect(r.driftIsNotConfirmedDelay).toBe(true);
  });
});

describe('detectExecutionDependencyCycles — Dependency', () => {
  it('순환 의존을 탐지하고 자동 해제는 적용하지 않는다', () => {
    const r = detectExecutionDependencyCycles([
      { id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['c'] }, { id: 'c', dependsOn: ['a'] },
    ]);
    expect(r.hasCycle).toBe(true);
    expect(r.autoResolutionApplied).toBe(false);
  });
  it('비순환 그래프는 hasCycle=false', () => {
    const r = detectExecutionDependencyCycles([
      { id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: [] },
    ]);
    expect(r.hasCycle).toBe(false);
    expect(r.cycles).toHaveLength(0);
  });
});

describe('evaluateDelayCandidate — Delay', () => {
  it('마감 초과 일수를 계산하되 confirmedDelay 는 항상 false', () => {
    const r = evaluateDelayCandidate(0, 10 * DAY, false);
    expect(r.delayDaysCandidate).toBe(10);
    expect(r.result).toBe('major_delay_candidate');
    expect(r.confirmedDelay).toBe(false);
  });
  it('Evidence 기반 완료/마감 전에는 no_delay_candidate', () => {
    expect(evaluateDelayCandidate(10 * DAY, 5 * DAY, false).result).toBe('no_delay_candidate');
    expect(evaluateDelayCandidate(0, 10 * DAY, true).result).toBe('no_delay_candidate');
  });
  it('null 입력은 insufficient_data', () => {
    expect(evaluateDelayCandidate(null, 5, false).result).toBe('insufficient_data');
  });
});

describe('evaluateDeliveryHealth — Health', () => {
  it('drift/risk/blocked 조합으로 판정하며 성공을 보장하지 않는다', () => {
    expect(evaluateDeliveryHealth({ driftLevel: 'on_track', riskLevel: 'low', blockedCount: 0 }).level).toBe('excellent');
    expect(evaluateDeliveryHealth({ driftLevel: 'minor_drift_candidate', riskLevel: 'low', blockedCount: 0 }).level).toBe('watch');
    expect(evaluateDeliveryHealth({ driftLevel: 'major_drift_candidate', riskLevel: 'low', blockedCount: 0 }).level).toBe('degraded');
    const r = evaluateDeliveryHealth({ driftLevel: 'on_track', riskLevel: 'critical', blockedCount: 0 });
    expect(r.level).toBe('critical');
    expect(r.guaranteedSuccess).toBe(false);
  });
  it('입력 미비는 insufficient_data', () => {
    expect(evaluateDeliveryHealth({ driftLevel: null, riskLevel: 'low', blockedCount: 0 }).level).toBe('insufficient_data');
  });
});

describe('evaluateDeliveryRisk — Risk', () => {
  it('worst-of 합성이며 위험 목록의 완전성을 주장하지 않는다', () => {
    const r = evaluateDeliveryRisk([
      { dimension: 'schedule_risk', level: 'low' },
      { dimension: 'dependency_risk', level: 'high' },
      { dimension: 'provider_risk', level: 'moderate' },
    ]);
    expect(r.overall).toBe('high');
    expect(r.assessedDimensions).toBe(3);
    expect(r.riskListIsExhaustive).toBe(false);
  });
  it('평가된 차원이 없으면 insufficient_data', () => {
    expect(evaluateDeliveryRisk([]).overall).toBe('insufficient_data');
    expect(evaluateDeliveryRisk([{ dimension: 'x', level: 'insufficient_data' }]).overall).toBe('insufficient_data');
  });
});

describe('evaluateDeliveryQuality — Quality', () => {
  it('Evidence 기반 완료율과 regression/rollback 으로 판정하되 Verified Quality 아님', () => {
    const r = evaluateDeliveryQuality({ milestonesCompletedWithEvidence: 10, milestonesTotal: 10, regressionCount: 0, rollbackCount: 0, outcomeLinked: true });
    expect(r.level).toBe('excellent');
    expect(r.verifiedQuality).toBe(false);
    expect(r.causalityEstablished).toBe(false);
    expect(evaluateDeliveryQuality({ milestonesCompletedWithEvidence: 6, milestonesTotal: 10, regressionCount: 1, rollbackCount: 0, outcomeLinked: true }).level).toBe('degraded');
    expect(evaluateDeliveryQuality({ milestonesCompletedWithEvidence: 1, milestonesTotal: 10, regressionCount: 0, rollbackCount: 0, outcomeLinked: false }).level).toBe('poor');
  });
  it('total 0/null 은 insufficient_data', () => {
    expect(evaluateDeliveryQuality({ milestonesCompletedWithEvidence: 1, milestonesTotal: 0, regressionCount: 0, rollbackCount: 0, outcomeLinked: false }).level).toBe('insufficient_data');
    expect(evaluateDeliveryQuality({ milestonesCompletedWithEvidence: null, milestonesTotal: 10, regressionCount: 0, rollbackCount: 0, outcomeLinked: false }).level).toBe('insufficient_data');
  });
});

describe('calculateVelocityCandidate / buildDeliveryForecastCandidate', () => {
  it('주간 Velocity 를 계산하되 Productivity 판단이 아니다', () => {
    const r = calculateVelocityCandidate(4, 14);
    expect(r.milestonesPerWeekCandidate).toBe(2);
    expect(r.velocityIsNotProductivity).toBe(true);
  });
  it('window 0/음수·null 은 insufficient', () => {
    expect(calculateVelocityCandidate(4, 0).insufficientData).toBe(true);
    expect(calculateVelocityCandidate(null, 14).milestonesPerWeekCandidate).toBeNull();
  });
  it('Forecast 는 0~100 clamp 되고 Forecast ≠ Future Fact', () => {
    const r = buildDeliveryForecastCandidate(60, 2, 4, 10);
    expect(r.forecastProgressCandidate).toBe(100);
    expect(r.result).toBe('on_schedule_forecast_candidate');
    expect(r.forecastIsNotFutureFact).toBe(true);
    expect(buildDeliveryForecastCandidate(20, 0.5, 2, 10).result).toBe('delayed_forecast_candidate');
  });
  it('Forecast 입력 미비는 insufficient_data', () => {
    expect(buildDeliveryForecastCandidate(null, 2, 4, 10).result).toBe('insufficient_data');
    expect(buildDeliveryForecastCandidate(60, 2, 4, 0).result).toBe('insufficient_data');
  });
});

describe('evaluateDelayRootCauseCandidate — Root Cause', () => {
  it('최대 가중치 후보를 선택하되 provenCause 는 항상 false', () => {
    const r = evaluateDelayRootCauseCandidate([
      { category: 'resource_cause_candidate', weight: 2 },
      { category: 'approval_cause_candidate', weight: 5 },
    ]);
    expect(r.topCategory).toBe('approval_cause_candidate');
    expect(r.provenCause).toBe(false);
  });
  it('허용 밖 category/빈 신호는 insufficient_data', () => {
    expect(evaluateDelayRootCauseCandidate([{ category: 'made_up', weight: 9 }]).topCategory).toBe('insufficient_data');
    expect(evaluateDelayRootCauseCandidate([]).insufficientData).toBe(true);
  });
});

describe('validateDeliveryReview — Review(Honest Boundary)', () => {
  it('Self-Approval 과 Evidence 없는 승인을 차단한다', () => {
    const self = validateDeliveryReview({ action: 'approve_delivery_reference', evidenceCount: 3, isSelfApproval: true });
    expect(self.allowed).toBe(false);
    expect(self.blockedReasons.join(' ')).toContain('Self-Approval');
    const noEv = validateDeliveryReview({ action: 'approve_delivery_reference', evidenceCount: 0, isSelfApproval: false });
    expect(noEv.allowed).toBe(false);
  });
  it('정상 승인/비승인 액션은 허용하되 humanDecisionRequired 유지', () => {
    const ok = validateDeliveryReview({ action: 'approve_delivery_reference', evidenceCount: 2, isSelfApproval: false });
    expect(ok.allowed).toBe(true);
    expect(ok.humanDecisionRequired).toBe(true);
    expect(validateDeliveryReview({ action: 'defer_delivery_reference', evidenceCount: null, isSelfApproval: true }).allowed).toBe(true);
  });
});

describe('buildExecutionTimeline — Event/Timeline', () => {
  it('14 단계 흐름을 순서대로 반환하고 관측 여부만 표시한다', () => {
    const t = buildExecutionTimeline({ present: { execution_program: true, approval_reference: false } });
    expect(t).toHaveLength(EXECUTION_FLOW_STAGES.length);
    expect(t[0].stage).toBe('strategic_portfolio');
    expect(t.find((s) => s.stage === 'execution_program')?.present).toBe(true);
    expect(t.find((s) => s.stage === 'approval_reference')?.present).toBe(false);
  });
});

describe('EXECUTION_SUPPORT_MATRIX — Honest Boundary', () => {
  it('컴포넌트 10종·매트릭스 59항목', () => {
    expect(EXECUTION_COMPONENTS).toHaveLength(10);
    expect(EXECUTION_SUPPORT_MATRIX).toHaveLength(59);
  });
  it('unavailable 15항목은 전부 automatic_* — 자동 실행/완료/승인 없음', () => {
    const unavailable = EXECUTION_SUPPORT_MATRIX.filter((e) => e.support === 'unavailable');
    expect(unavailable).toHaveLength(15);
    for (const e of unavailable) expect(e.capability.startsWith('automatic_')).toBe(true);
  });
  it('외부 PM/CI/배포 피드는 insufficient_data 로 정직하게 표시된다', () => {
    const feeds = EXECUTION_SUPPORT_MATRIX.filter((e) => e.support === 'insufficient_data');
    expect(feeds.length).toBeGreaterThanOrEqual(6);
    expect(feeds.map((f) => f.capability)).toContain('project_management_system_feed');
  });
});
