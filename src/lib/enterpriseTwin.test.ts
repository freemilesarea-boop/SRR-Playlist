import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_SOURCE_DOMAINS, SNAPSHOT_STATUSES, TWIN_LAYERS, TWIN_SCENARIO_TYPES, TWIN_SCENARIO_STATUSES,
  TWIN_SUPPORT_STATUSES, TWIN_RUN_STATUSES, PREDICTION_METRICS, COMPARISON_DIMENSIONS,
  TWIN_RECOMMENDATION_TYPES, TWIN_TIMELINE_STAGES,
  evaluateSnapshotCompleteness, evaluateTwinCoverage, buildTwinScenario, evaluateScenarioInjection,
  projectFutureMetric, projectRisk, projectCost, projectCapacity, projectApprovalQueue,
  projectIncidents, projectHumanWorkload, calculatePredictionConfidence, buildBestWorstCase,
  compareTwinScenarios, buildExecutiveTwinRecommendation, evaluateHumanTwinReview, buildTwinTimeline,
  TWIN_COMPONENTS, ENTERPRISE_TWIN_SUPPORT,
} from './enterpriseTwin';

const NOW = new Date('2026-07-16T00:00:00Z');

describe('enterpriseTwin 상수(0540 CHECK 정렬)', () => {
  it('whitelist 개수 고정 — 소스 11·레이어 8·시나리오 18·상태 5/8/4/10·지표 10·비교 8·추천 6·타임라인 9', () => {
    expect(SNAPSHOT_SOURCE_DOMAINS).toHaveLength(11);
    expect(SNAPSHOT_STATUSES).toHaveLength(5);
    expect(TWIN_LAYERS).toHaveLength(8);
    expect(TWIN_SCENARIO_TYPES).toHaveLength(18);
    expect(TWIN_SCENARIO_STATUSES).toHaveLength(8);
    expect(TWIN_SUPPORT_STATUSES).toHaveLength(4);
    expect(TWIN_RUN_STATUSES).toHaveLength(10);
    expect(PREDICTION_METRICS).toHaveLength(10);
    expect(COMPARISON_DIMENSIONS).toHaveLength(8);
    expect(TWIN_RECOMMENDATION_TYPES).toHaveLength(6);
    expect(TWIN_TIMELINE_STAGES).toHaveLength(9);
  });
});

describe('evaluateSnapshotCompleteness', () => {
  it('부분 캡처는 partial·오래되면 stale(Snapshot ≠ Live 상태)', () => {
    expect(evaluateSnapshotCompleteness({ capturedSources: null, capturedAt: NOW, now: NOW, staleAfterHours: 24 }).result).toBe('insufficient_data');
    const partial = evaluateSnapshotCompleteness({ capturedSources: ['organization', 'runtime'], capturedAt: NOW, now: NOW, staleAfterHours: 24 });
    expect(partial.result).toBe('partial_reference');
    expect(partial.missingDomains).toContain('policy');
    expect(evaluateSnapshotCompleteness({ capturedSources: [...SNAPSHOT_SOURCE_DOMAINS], capturedAt: new Date('2026-07-10T00:00:00Z'), now: NOW, staleAfterHours: 24 }).result).toBe('stale_candidate');
    const ok = evaluateSnapshotCompleteness({ capturedSources: [...SNAPSHOT_SOURCE_DOMAINS], capturedAt: NOW, now: NOW, staleAfterHours: 24 });
    expect(ok).toMatchObject({ result: 'captured_reference', snapshotIsNotLiveState: true, twinIsNotProduction: true });
  });
});

describe('evaluateTwinCoverage', () => {
  it('원본 없는 계층은 source_missing 유지(임의 모델링 금지·Twin 읽기 전용)', () => {
    const r = evaluateTwinCoverage([
      { layer: 'runtime_twin', sourceAvailable: true, entityCount: 5 },
      { layer: 'queue_twin', sourceAvailable: false, entityCount: null },
      { layer: 'agent_twin', sourceAvailable: true, entityCount: 0 },
      { layer: 'weird_twin', sourceAvailable: true, entityCount: 1 },
    ]);
    expect(r.rows.map((x) => x.result)).toEqual(['modeled_reference', 'source_missing', 'modeled_empty_reference', 'layer_invalid']);
    expect(r).toMatchObject({ modeledCount: 2, missingCount: 1, twinIsNotProduction: true, twinIsReadOnly: true });
  });
});

describe('buildTwinScenario', () => {
  it('type whitelist·horizon 범위·source 기반 support 판정(Scenario ≠ Reality)', () => {
    expect(buildTwinScenario({ type: 'nuclear_meltdown', title: 't', injectionParameters: {}, horizonDays: 30, sourceAvailable: true })).toMatchObject({ rejected: true });
    expect(buildTwinScenario({ type: 'scale_x10', title: 't', injectionParameters: {}, horizonDays: 999, sourceAvailable: true })).toMatchObject({ rejected: true });
    const partial = buildTwinScenario({ type: 'provider_down', title: 'Provider 장애', injectionParameters: {}, horizonDays: 30, sourceAvailable: false });
    expect(partial).toMatchObject({ supportStatus: 'partially_supported', scenarioIsNotReality: true, autoExecuted: false, productionChanged: false });
    expect(buildTwinScenario({ type: 'agent_failure', title: 'Agent 장애', injectionParameters: {}, horizonDays: 30, sourceAvailable: true })).toMatchObject({ supportStatus: 'supported_reference', status: 'draft' });
  });
});

describe('evaluateScenarioInjection', () => {
  it('승인 선행·무효 Snapshot 차단·레이어 원본 검증(Injection ≠ Execution)', () => {
    expect(evaluateScenarioInjection({ scenarioStatus: 'draft', snapshotStatus: 'captured_reference', targetLayers: ['runtime_twin'], layerCoverage: { runtime_twin: true } }).result).toBe('scenario_approval_missing');
    expect(evaluateScenarioInjection({ scenarioStatus: 'approved_for_twin_reference', snapshotStatus: 'invalidated', targetLayers: ['runtime_twin'], layerCoverage: { runtime_twin: true } }).result).toBe('snapshot_invalidated');
    const miss = evaluateScenarioInjection({ scenarioStatus: 'approved_for_twin_reference', snapshotStatus: 'captured_reference', targetLayers: ['runtime_twin', 'queue_twin'], layerCoverage: { runtime_twin: true, queue_twin: false } });
    expect(miss).toMatchObject({ result: 'layer_source_missing', missingLayers: ['queue_twin'] });
    expect(evaluateScenarioInjection({ scenarioStatus: 'approved_for_twin_reference', snapshotStatus: 'captured_reference', targetLayers: ['runtime_twin'], layerCoverage: { runtime_twin: true } })).toMatchObject({ result: 'injection_ready_reference', injectionIsNotExecution: true, productionChanged: false });
  });
});

describe('projectFutureMetric', () => {
  it('baseline unknown 은 null 유지(0 대체 금지·Prediction ≠ Future Fact)', () => {
    expect(projectFutureMetric({ metric: 'weird', baseline: 10, multiplier: 2, horizonDays: 30 }).result).toBe('metric_invalid');
    const unk = projectFutureMetric({ metric: 'incident_count', baseline: null, multiplier: 2, horizonDays: 30 });
    expect(unk).toMatchObject({ projected: null, result: 'baseline_unknown', predictionIsNotFutureFact: true, projectionIsNotObservation: true });
    expect(projectFutureMetric({ metric: 'cost', baseline: 100, multiplier: 2, horizonDays: 30 })).toMatchObject({ projected: 200, result: 'projected_reference' });
  });
});

describe('projectRisk', () => {
  it('recovery 이력 없으면 recoveryUnverified 유지(Risk ≠ Fact)', () => {
    expect(projectRisk({ incidentBaseline: null, incidentMultiplier: 2, mitigationsDefined: false, recoveryHistoryAvailable: true }).result).toBe('insufficient_data');
    const high = projectRisk({ incidentBaseline: 5, incidentMultiplier: 3, mitigationsDefined: false, recoveryHistoryAvailable: false });
    expect(high).toMatchObject({ result: 'risk_high_candidate', recoveryUnverified: true, riskIsNotFact: true });
    expect(projectRisk({ incidentBaseline: 10, incidentMultiplier: 5, mitigationsDefined: false, recoveryHistoryAvailable: true }).result).toBe('risk_critical_candidate');
  });
});

describe('projectCost', () => {
  it('비용 모델 없으면 cost_model_missing(임의 추정 금지·청구 없음)', () => {
    expect(projectCost({ costModelAvailable: false, costBaseline: 100, costMultiplier: 2 })).toMatchObject({ projected: null, result: 'cost_model_missing', billingExecuted: false });
    expect(projectCost({ costModelAvailable: true, costBaseline: 100, costMultiplier: 2 })).toMatchObject({ projected: 200, result: 'cost_projected_reference', costIsNotBilling: true });
  });
});

describe('projectCapacity', () => {
  it('초과/여유 후보 구분(Estimate ≠ Guarantee)', () => {
    expect(projectCapacity({ capacityBaseline: 100, demandBaseline: 60, demandMultiplier: 2 })).toMatchObject({ result: 'capacity_exceeded_candidate', utilizationPct: 120 });
    expect(projectCapacity({ capacityBaseline: 100, demandBaseline: 45, demandMultiplier: 2 })).toMatchObject({ result: 'capacity_tight_candidate', utilizationPct: 90 });
    expect(projectCapacity({ capacityBaseline: 100, demandBaseline: 20, demandMultiplier: 2, }).result).toBe('capacity_sufficient_candidate');
    expect(projectCapacity({ capacityBaseline: null, demandBaseline: 20, demandMultiplier: 2 }).result).toBe('capacity_unverified');
  });
});

describe('projectApprovalQueue', () => {
  it('reviewer 0명 + 유입 존재 → unbounded 후보(Queue 는 승인 대기 proxy)', () => {
    expect(projectApprovalQueue({ pendingBaseline: 10, arrivalMultiplier: 2, reviewersAvailable: 0, reviewCapacityPerReviewer: 5 })).toMatchObject({ result: 'queue_unbounded_candidate', queueIsProxyOnly: true });
    expect(projectApprovalQueue({ pendingBaseline: 10, arrivalMultiplier: 2, reviewersAvailable: 2, reviewCapacityPerReviewer: 5 })).toMatchObject({ result: 'queue_growing_candidate', projectedBacklog: 10 });
    expect(projectApprovalQueue({ pendingBaseline: 10, arrivalMultiplier: 1, reviewersAvailable: 5, reviewCapacityPerReviewer: 5 })).toMatchObject({ result: 'queue_stable_candidate', projectedBacklog: 0 });
  });
});

describe('projectIncidents', () => {
  it('표본 부족 유지(재정규화 없음·Correlation ≠ Causality)', () => {
    expect(projectIncidents({ incidentBaseline: 4, sampleSize: 2, minSample: 10, scenarioMultiplier: 3 }).result).toBe('sample_too_small');
    expect(projectIncidents({ incidentBaseline: 4, sampleSize: 100, minSample: 10, scenarioMultiplier: 3 })).toMatchObject({ projected: 12, result: 'incident_projected_reference', correlationIsNotCausality: true });
  });
});

describe('projectHumanWorkload', () => {
  it('reviewer unknown 유지·자동 인사 판단 없음', () => {
    expect(projectHumanWorkload({ reviewBaseline: 20, reviewMultiplier: 2, reviewers: 0 })).toMatchObject({ perReviewer: null, result: 'reviewer_unknown', workloadIsNotPerformanceJudgement: true });
    expect(projectHumanWorkload({ reviewBaseline: 20, reviewMultiplier: 2, reviewers: 4 })).toMatchObject({ perReviewer: 10, result: 'workload_projected_reference' });
  });
});

describe('calculatePredictionConfidence', () => {
  it('표본 부족 상한 30·장기(>90일) 상한 40·미검증 가정 감점(Confidence ≠ Correctness)', () => {
    expect(calculatePredictionConfidence({ sourceCoverageRatio: 1, sampleSize: 2, minSample: 10, unverifiedAssumptions: 0, horizonDays: 7 })).toMatchObject({ confidence: 30, confidenceIsNotCorrectness: true });
    expect(calculatePredictionConfidence({ sourceCoverageRatio: 1, sampleSize: 100, minSample: 10, unverifiedAssumptions: 0, horizonDays: 180 }).confidence).toBe(40);
    expect(calculatePredictionConfidence({ sourceCoverageRatio: 1, sampleSize: 100, minSample: 10, unverifiedAssumptions: 3, horizonDays: 7 }).confidence).toBe(70);
    expect(calculatePredictionConfidence({ sourceCoverageRatio: null, sampleSize: 100, minSample: 10, unverifiedAssumptions: 0, horizonDays: 7 }).result).toBe('insufficient_data');
  });
});

describe('buildBestWorstCase', () => {
  it('결측은 unknown 카운트 유지(Case ≠ Fact)', () => {
    const r = buildBestWorstCase([{ metric: 'cost', optimistic: 100, pessimistic: 300 }, { metric: 'risk', optimistic: null, pessimistic: 5 }]);
    expect(r.best[0]).toMatchObject({ metric: 'cost', value: 100 });
    expect(r.worst[1]).toMatchObject({ metric: 'risk', value: 5 });
    expect(r).toMatchObject({ unknownCount: 1, caseIsNotFact: true });
  });
});

describe('compareTwinScenarios', () => {
  it('Run 2개 미만 거부·결측 차원 unverified 유지·자동 승자 없음', () => {
    expect(compareTwinScenarios([{ runCode: 'A', dimensions: {} }]).result).toBe('insufficient_runs');
    const r = compareTwinScenarios([
      { runCode: 'A', dimensions: { risk: 3, cost: 100, capacity: 80, human_workload: 5, approval_delay: 2, incident_probability: 10, recovery_difficulty: 4, confidence: 60 } },
      { runCode: 'B', dimensions: { risk: 5, cost: 80, capacity: null, human_workload: 7, approval_delay: 3, incident_probability: 20, recovery_difficulty: 6, confidence: 50 } },
    ]);
    expect(r.result).toBe('comparison_reference');
    expect(r.comparableDimensions).not.toContain('capacity');
    expect(r.rows.find((x) => x.runCode === 'B' && x.dimension === 'capacity')?.status).toBe('dimension_unverified');
    expect(r).toMatchObject({ winnerIsCandidateOnly: true, autoSelected: false });
  });
});

describe('buildExecutiveTwinRecommendation', () => {
  it('Evidence 없는 추천 금지·type whitelist·confidence clamp(Recommendation ≠ Decision)', () => {
    expect(buildExecutiveTwinRecommendation({ type: 'execute_now', reason: 'r', evidence: ['e'], confidence: 50 })).toMatchObject({ rejected: true });
    expect(buildExecutiveTwinRecommendation({ type: 'lowest_risk_candidate', reason: 'r', evidence: [], confidence: 50 })).toMatchObject({ rejected: true });
    const r = buildExecutiveTwinRecommendation({ type: 'lowest_risk_candidate', reason: 'r', evidence: ['e'], confidence: 150 });
    expect(r).toMatchObject({ confidence: 100, isRecommendationOnly: true, recommendationIsNotDecision: true, autoExecuted: false });
  });
});

describe('evaluateHumanTwinReview', () => {
  it('Unknown/Limitations/Confidence 문서화 선행(검토는 사람만)', () => {
    expect(evaluateHumanTwinReview({ runCompleted: false, unknownFactorsDocumented: true, limitationsDocumented: true, confidenceRecorded: true }).result).toBe('run_incomplete');
    expect(evaluateHumanTwinReview({ runCompleted: true, unknownFactorsDocumented: false, limitationsDocumented: true, confidenceRecorded: true }).result).toBe('unknown_factors_missing');
    expect(evaluateHumanTwinReview({ runCompleted: true, unknownFactorsDocumented: true, limitationsDocumented: true, confidenceRecorded: true })).toMatchObject({ result: 'review_ready_reference', reviewIsHumanOnly: true });
  });
});

describe('buildTwinTimeline', () => {
  it('9단계 whitelist·비수치는 insufficient_data 유지(완료 주장 아님)', () => {
    const r = buildTwinTimeline([
      { stage: 'snapshot', count: 2, source: 'snapshots 실측' },
      { stage: 'prediction', count: null, source: 'runs 실측' },
      { stage: 'weird', count: 1, source: 'x' },
    ]);
    expect(r.stages).toHaveLength(2);
    expect(r.stages[1]).toMatchObject({ status: 'insufficient_data', count: null });
    expect(r).toMatchObject({ invalidStages: 1, timelineIsNotCompletionClaim: true });
  });
});

describe('실측 구성요소·지원 매트릭스', () => {
  it('원본 실존 9종 가용·부재 6종 명시·real_/auto_ 계열 unsupported', () => {
    const byKey = Object.fromEntries(TWIN_COMPONENTS.map((c) => [c.key, c.available]));
    expect(byKey['organization_0349']).toBe(true);
    expect(byKey['knowledge_graph_0513']).toBe(true);
    expect(byKey['gpu_cost_feed']).toBe(false);
    expect(byKey['generic_queue_worker']).toBe(false);
    expect(byKey['provider_state_feed']).toBe(false);
    expect(byKey['load_test_infrastructure']).toBe(false);
    const unsupported = ENTERPRISE_TWIN_SUPPORT.filter((s) => s.status === 'unsupported');
    expect(unsupported.length).toBe(14);
    expect(unsupported.every((s) => s.key.startsWith('real_') || s.key.startsWith('auto_') || s.key === 'production_change')).toBe(true);
    expect(ENTERPRISE_TWIN_SUPPORT.filter((s) => s.status === 'supported').length).toBe(34);
  });
});
