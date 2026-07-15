import { describe, expect, it } from 'vitest';
import {
  buildForecastConfidence,
  buildForecastRecommendation,
  buildForecastTimeline,
  buildSimulationGraph,
  calculateCompletionProbability,
  FORECAST_SUPPORT,
  forecastDeliveryDelay,
  forecastDependencyPropagation,
  forecastExecutiveRisk,
  forecastOrganizationalHealth,
  forecastPortfolioCompletion,
  forecastVerificationReadiness,
  projectBusinessImpact,
  simulateResourceImpact,
  simulateWhatIf,
} from './predictiveExecution';

describe('completion probability — Prediction ≠ Outcome·표본 방어', () => {
  it('이력 0 + progress 없음 → insufficient, 표본<5 → sample_too_small', () => {
    expect(calculateCompletionProbability({ verifiedProgress: null, activeBlockers: 0, dependencyClear: null, historicalSuccessRate: null, historicalSample: 0, daysToTarget: null }).status).toBe('insufficient_data');
    const r = calculateCompletionProbability({ verifiedProgress: 50, activeBlockers: 1, dependencyClear: true, historicalSuccessRate: 80, historicalSample: 3, daysToTarget: 10 });
    expect(r.status).toBe('sample_too_small');
    expect(r.probability).not.toBeNull();
    expect(r.predictionNotOutcome).toBe(true);
    expect(r.drivers.some((d) => d.includes('이력 표본'))).toBe(true);
  });
  it('target 경과는 감점하되 실패 확정 아님', () => {
    const r = calculateCompletionProbability({ verifiedProgress: 80, activeBlockers: 0, dependencyClear: true, historicalSuccessRate: 70, historicalSample: 10, daysToTarget: -5 });
    expect(r.status).toBe('forecast_reference');
    expect(r.drivers.some((d) => d.includes('실패 확정 아님'))).toBe(true);
  });
});

describe('delay forecast — 실제 지연 아님', () => {
  it('이력·의존 없음 → insufficient, blocker/의존 대기 반영 + notActualDelay', () => {
    expect(forecastDeliveryDelay({ historicalDelays: null, activeBlockers: 2, dependencyWaitDays: null }).status).toBe('insufficient_data');
    const r = forecastDeliveryDelay({ historicalDelays: [2, 4], activeBlockers: 1, dependencyWaitDays: 3 });
    expect(r.expectedDelayDays).toBe(9);   // avg 3 + blocker 3 + dep 3
    expect(r.status).toBe('sample_too_small');
    expect(r.notActualDelay).toBe(true);
    expect(r.low).not.toBeNull();
    expect(r.high).not.toBeNull();
  });
});

describe('verification readiness / portfolio forecast', () => {
  it('criteria 없음 + evidence 0 → forecast_unverified, gap 명시', () => {
    expect(forecastVerificationReadiness({ evidenceProvided: 0, evidenceRequired: 2, criteriaDefined: false, reviewerExists: false }).status).toBe('forecast_unverified');
    const r = forecastVerificationReadiness({ evidenceProvided: 1, evidenceRequired: 2, criteriaDefined: true, reviewerExists: true });
    expect(r.readinessPct).toBe(80);
    expect(r.gaps).toContain('Evidence 1/2');
  });
  it('portfolio: 최약 항목 보수 반영(평균 낙관 금지) + notCommitment', () => {
    expect(forecastPortfolioCompletion(null).status).toBe('insufficient_data');
    const r = forecastPortfolioCompletion([{ code: 'a', probability: 90 }, { code: 'b', probability: 30 }]);
    expect(r.weakest).toBe('b');
    expect(r.portfolioProbability).toBeLessThan(60);   // 평균(60)보다 보수적
    expect(r.status).toBe('sample_too_small');
    expect(r.notCommitment).toBe(true);
  });
});

describe('what-if / resource simulation — 실행·배정 없음', () => {
  it('what-if: 변화 예상만 반환, executiveDecision=false', () => {
    const r = simulateWhatIf({
      scenario: 'Priority A 제거',
      baseline: { totalReviewHours: 20, riskCount: 3, deliveryProbability: 60 },
      change: { kind: 'remove_priority', reviewHoursDelta: -5, riskDelta: -1, probabilityDelta: 10 },
    });
    expect(r.projected.reviewHours).toBe(15);
    expect(r.projected.riskCount).toBe(2);
    expect(r.projected.deliveryProbability).toBe(70);
    expect(r.executiveDecision).toBe(false);
    expect(r.counterfactual).toBe(true);
    expect(r.effects.some((e) => e.includes('보장 아님'))).toBe(true);
  });
  it('resource: 실측 없으면 계산 금지, Reviewer 증가 → latency 감소 예상(배정 없음)', () => {
    expect(simulateResourceImpact({ currentReviewers: null, addedReviewers: 1, currentLatencyDays: 5 }).projectedLatencyDays).toBeNull();
    const r = simulateResourceImpact({ currentReviewers: 1, addedReviewers: 1, currentLatencyDays: 6 });
    expect(r.projectedLatencyDays).toBe(3);
    expect(r.resourcesAssigned).toBe(false);
    expect(r.note).toContain('실제 배정');
  });
});

describe('dependency propagation — 가능 영향만(확정 아님)', () => {
  it('A 7일 지연 → B,C 가능 영향, cycle 방어, confirmed=false', () => {
    const r = forecastDependencyPropagation(
      [{ code: 'A', dependsOn: null }, { code: 'B', dependsOn: 'A' }, { code: 'C', dependsOn: 'B' }],
      { code: 'A', delayDays: 7 },
    );
    expect(r.possible).toEqual([{ code: 'B', possibleDelayDays: 7 }, { code: 'C', possibleDelayDays: 7 }]);
    expect(r.confirmed).toBe(false);
    const cyclic = forecastDependencyPropagation([{ code: 'A', dependsOn: 'B' }, { code: 'B', dependsOn: 'A' }], { code: 'A', delayDays: 3 });
    expect(cyclic.possible).toHaveLength(1);   // 무한 루프 없음
    expect(forecastDependencyPropagation(null, { code: 'A', delayDays: 7 }).possible).toEqual([]);
  });
});

describe('risk forecast / forecast confidence', () => {
  it('5축 risk — 자료 없으면 insufficient_data 유지', () => {
    const r = forecastExecutiveRisk({ deliveryProbability: 30, scheduleVarianceDays: null, blockingDependencies: 2, unapprovedScopeChanges: 0, confidenceDrift: -20 });
    expect(r).toHaveLength(5);
    expect(r.find((x) => x.kind === 'future_delivery_risk')?.level).toBe('high');
    expect(r.find((x) => x.kind === 'future_schedule_risk')?.level).toBe('insufficient_data');
    expect(r.find((x) => x.kind === 'future_dependency_risk')?.level).toBe('high');
    expect(r.find((x) => x.kind === 'future_confidence_risk')?.level).toBe('high');
  });
  it('forecast confidence: coverage/unknown/missing/freshness/successGuarantee=false 동시 제공', () => {
    const r = buildForecastConfidence({ componentValues: [80, null, 60], unknownComponents: ['market'], missingSignals: ['csat'], inputAgeDays: 45 });
    expect(r.confidence).toBe(70);
    expect(r.evidenceCoverage).toBe(67);
    expect(r.freshness).toBe('stale_input_candidate');
    expect(r.successGuarantee).toBe(false);
    expect(buildForecastConfidence({ componentValues: [], unknownComponents: [], missingSignals: [], inputAgeDays: null }).confidence).toBeNull();
  });
});

describe('business impact projection — KPI 없으면 unavailable', () => {
  it('kpiAvailable=false → projection_unavailable, 이력 없음 → forecast_unverified', () => {
    expect(projectBusinessImpact({ kpiKey: 'csat', kpiAvailable: false, currentValue: null, historicalDeltas: null, horizonPeriods: 3 }).status).toBe('projection_unavailable');
    expect(projectBusinessImpact({ kpiKey: 'mrr', kpiAvailable: true, currentValue: 1000, historicalDeltas: [], horizonPeriods: 3 }).status).toBe('forecast_unverified');
    const r = projectBusinessImpact({ kpiKey: 'mrr', kpiAvailable: true, currentValue: 1000, historicalDeltas: [100, 200], horizonPeriods: 2 });
    expect(r.projected).toBe(1300);
    expect(r.status).toBe('sample_too_small');
    expect(r.notBusinessResult).toBe(true);
  });
});

describe('simulation graph / timeline / health forecast', () => {
  it('graph: 6단계 + 예측 구간 projectedOnly 표시', () => {
    const r = buildSimulationGraph([{ id: 'd1', stage: 'decision', label: 'D' }, { id: 'f1', stage: 'forecast', label: 'F' }, { id: 'x', stage: 'bogus', label: 'X' }]);
    expect(r.stages).toHaveLength(6);
    expect(r.stages.find((s) => s.stage === 'forecast')?.projectedOnly).toBe(true);
    expect(r.stages.find((s) => s.stage === 'decision')?.projectedOnly).toBe(false);
    expect(r.stages.flatMap((s) => s.nodes)).toHaveLength(2);
  });
  it('timeline: 5개 horizon 버킷 + predictionNotOutcome', () => {
    const r = buildForecastTimeline([{ horizon: 'next_week', kind: 'a', label: '1' }, { horizon: 'annual', kind: 'b', label: '2' }]);
    expect(r.buckets).toHaveLength(5);
    expect(r.buckets.find((b) => b.horizon === 'next_week')?.items).toHaveLength(1);
    expect(r.predictionNotOutcome).toBe(true);
  });
  it('health forecast: 전부 null → insufficient, trend 반영 방향 expected', () => {
    expect(forecastOrganizationalHealth({ deliveryTrendDelta: null, currentHealth: null, stabilityScore: null, reviewLatencyScore: null, evidenceCoverage: null, completionQuality: null, accountabilityScore: null }).direction).toBe('insufficient_data');
    const r = forecastOrganizationalHealth({ deliveryTrendDelta: 10, currentHealth: 60, stabilityScore: null, reviewLatencyScore: null, evidenceCoverage: null, completionQuality: null, accountabilityScore: null });
    expect(r.direction).toBe('improving_expected');
    expect(r.projectedScore).toBe(65);
    expect(r.predictionNotOutcome).toBe(true);
  });
});

describe('recommendation / support', () => {
  it('recommendation: 6종 whitelist + Evidence 필수 + 사람 승인 + alternatives/limitations 포함', () => {
    expect('rejected' in buildForecastRecommendation({ type: 'auto_execute_forecast', reason: 'x', evidence: ['e'], confidence: null, assumptions: [], unknownFactors: [] })).toBe(true);
    expect('rejected' in buildForecastRecommendation({ type: 'review_forecast', reason: 'x', evidence: [], confidence: null, assumptions: [], unknownFactors: [] })).toBe(true);
    const r = buildForecastRecommendation({ type: 'validate_dependency', reason: '전파 후보 존재', evidence: ['e'], confidence: 50, assumptions: ['a'], unknownFactors: ['u'] });
    if ('humanApprovalRequired' in r) {
      expect(r.humanApprovalRequired).toBe(true);
      expect(r.autoExecuted).toBe(false);
      expect(r.alternatives.length).toBeGreaterThan(0);
      expect(r.limitations[0]).toContain('사실 확정 아님');
    }
  });
  it('FORECAST_SUPPORT: 26항목 + CSAT/자동 확정/배정/Production unsupported', () => {
    expect(FORECAST_SUPPORT).toHaveLength(26);
    for (const key of ['csat_projection', 'auto_forecast_confirmation', 'auto_assignment', 'production_apply']) {
      expect(FORECAST_SUPPORT.find((s) => s.key === key)?.status).toBe('unsupported');
    }
  });
});
