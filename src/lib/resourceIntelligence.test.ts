import { describe, expect, it } from 'vitest';
import {
  analyzeAiResource,
  analyzeUtilization,
  assessCapacity,
  buildResourceBriefing,
  buildResourceCockpit,
  buildResourceRecommendation,
  detectBottlenecks,
  evaluateInfraEfficiency,
  evaluateOperationalEfficiency,
  forecastCapacity,
  RESOURCE_SUPPORT,
} from './resourceIntelligence';

describe('capacity — 실측 기반만·Capacity ≠ Demand', () => {
  it('null 유지 → insufficient, 계산 시 remaining/pressure', () => {
    expect(assessCapacity({ current: null, used: 10 }).verdict).toBe('insufficient_data');
    expect(assessCapacity({ current: 0, used: 10 }).verdict).toBe('insufficient_data');
    const r = assessCapacity({ current: 100, used: 80 });
    expect(r.remaining).toBe(20);
    expect(r.pressurePct).toBe(80);
    expect(r.capacityIsNotDemand).toBe(true);
  });
});

describe('utilization / ai resource — 없는 데이터 unavailable 유지', () => {
  it('utilization: null → resource_unavailable + ≠ Efficiency', () => {
    const r = analyzeUtilization([
      { key: 'database_rows', usagePct: 40 },
      { key: 'cpu', usagePct: null },
    ]);
    expect(r.measuredCount).toBe(1);
    expect(r.unavailableCount).toBe(1);
    expect(r.rows[1].status).toBe('resource_unavailable');
    expect(r.utilizationIsNotEfficiency).toBe(true);
  });
  it('ai resource: 전부 null → resource_unavailable + noAutoScaling', () => {
    const r = analyzeAiResource({ tokenConsumption: null, inferenceRequests: null, queueLength: null, processingTimeMs: null, modelAvailabilityPct: null });
    expect(r.verdict).toBe('resource_unavailable');
    expect(r.components).toHaveLength(5);
    expect(r.noAutoScaling).toBe(true);
    expect(analyzeAiResource({ tokenConsumption: 100, inferenceRequests: null, queueLength: null, processingTimeMs: null, modelAvailabilityPct: null }).verdict).toBe('partial_measured');
  });
});

describe('infra efficiency — 실측만·표본 방어', () => {
  it('sample<5 제외, 저활용/포화 후보, balance 판정', () => {
    const r = evaluateInfraEfficiency({ metrics: [
      { key: 'db', utilizationPct: 5, sample: 30 },      // waste 후보
      { key: 'storage', utilizationPct: 95, sample: 30 },// 포화 후보
      { key: 'cpu', utilizationPct: null, sample: 0 },   // unavailable 제외
      { key: 'net', utilizationPct: 50, sample: 2 },     // sample_too_small 제외
    ] });
    expect(r.wasteCandidates[0]).toContain('db');
    expect(r.saturationCandidates[0]).toContain('storage');
    expect(r.balance).toBe('imbalanced_candidate');
    expect(r.excluded).toHaveLength(2);
    expect(r.efficiencyIsMeasuredOnly).toBe(true);
    expect(evaluateInfraEfficiency({ metrics: [] }).balance).toBe('insufficient_data');
  });
});

describe('forecast — Prediction·Forecast ≠ Actual', () => {
  it('horizon whitelist + 표본<7 sample_too_small + 추세 기반 투영', () => {
    expect(forecastCapacity([{ value: 1 }], 'someday').verdict).toBe('invalid_horizon');
    expect(forecastCapacity(null, 'next_week').verdict).toBe('insufficient_data');
    expect(forecastCapacity([{ value: 1 }, { value: 2 }], 'next_week').verdict).toBe('sample_too_small');
    const pts = Array.from({ length: 14 }, (_, i) => ({ value: 100 + i * 10 }));
    const r = forecastCapacity(pts, 'next_month');
    expect(r.verdict).toBe('forecast_candidate');
    expect(r.projected).not.toBeNull();
    expect(r.forecastIsNotActual).toBe(true);
  });
});

describe('bottleneck — 후보만·Root Cause 아님', () => {
  it('Evidence 없음 unverified, 신호 없음 unavailable, 임계 초과 후보', () => {
    const r = detectBottlenecks([
      { kind: 'queue_bottleneck', signal: 95, threshold: 80, evidence: ['queue 실측'] },
      { kind: 'cpu_bottleneck', signal: null, threshold: 80, evidence: ['참조'] },
      { kind: 'memory_bottleneck', signal: 50, threshold: 80, evidence: [] },
      { kind: 'storage_bottleneck', signal: 10, threshold: 80, evidence: ['storage 실측'] },
    ]);
    expect(r.candidates[0].verdict).toBe('bottleneck_candidate');
    expect(r.candidates[1].verdict).toBe('resource_unavailable');
    expect(r.candidates[2].verdict).toBe('resource_unverified');
    expect(r.candidates[3].verdict).toBe('no_known_bottleneck');
    expect(r.bottleneckIsNotRootCause).toBe(true);
  });
});

describe('operational efficiency — Evidence 게이트', () => {
  it('Evidence 없는 컴포넌트 점수 제외 + scoreOnlyReturn=false', () => {
    const r = evaluateOperationalEfficiency([
      { component: 'infrastructure_efficiency', score: 80, evidence: ['0508'] },
      { component: 'ai_efficiency', score: 70, evidence: [] },   // 제외
      { component: 'database_efficiency', score: 60, evidence: ['rows'] },
    ]);
    expect(r.overall).toBe(70);
    expect(r.byComponent.find((c) => c.component === 'ai_efficiency')?.score).toBeNull();
    expect(r.missingComponents).toContain('ai_efficiency');
    expect(r.scoreOnlyReturn).toBe(false);
  });
});

describe('briefing / recommendation / cockpit / support', () => {
  it('briefing: 5섹션 + 자동 발송 없음', () => {
    const r = buildResourceBriefing({ periodKind: 'monthly', capacityChanges: ['c'], resourcePressure: [], bottlenecks: ['b'], unknownFactors: ['u'], recommendations: [] });
    expect(r.valid).toBe(true);
    expect(r.sections).toHaveLength(5);
    expect(r.autoSendDisabled).toBe(true);
    expect(buildResourceBriefing({ periodKind: 'hourly', capacityChanges: [], resourcePressure: [], bottlenecks: [], unknownFactors: [], recommendations: [] }).valid).toBe(false);
  });
  it('recommendation: whitelist + Evidence 필수 + ≠ Operational Decision', () => {
    expect('rejected' in buildResourceRecommendation({ type: 'scale_up_server', reason: 'x', evidence: ['e'], confidence: null, assumptions: [] })).toBe(true);
    expect('rejected' in buildResourceRecommendation({ type: 'review_capacity', reason: 'x', evidence: [], confidence: null, assumptions: [] })).toBe(true);
    const r = buildResourceRecommendation({ type: 'reduce_waste', reason: '저활용 후보 존재(단정 아님)', evidence: ['metrics'], confidence: 30, assumptions: ['a'] });
    if ('humanApprovalRequired' in r) {
      expect(r.humanApprovalRequired).toBe(true);
      expect(r.approvalImplied).toBe(false);
      expect(r.limitations).toContain('Recommendation ≠ Operational Decision');
    }
  });
  it('cockpit: 8영역 + autoScaled=false', () => {
    const r = buildResourceCockpit({ registryTotal: 3, capacityMeasured: 5, utilizationMeasured: 2, aiResourceVerdict: 'resource_unavailable', infraBalance: 'insufficient_data', bottleneckCandidates: 1, opEfficiencyOverall: null, summaryNote: null });
    expect(r.sections).toHaveLength(8);
    expect(r.humanDecisionRequired).toBe(true);
    expect(r.autoScaled).toBe(false);
    expect(r.sections.find((s) => s.key === 'operational_efficiency')?.headline).toBe('insufficient_data');
  });
  it('RESOURCE_SUPPORT: 16항목 + APM/AI 사용/자동 스케일 unsupported', () => {
    expect(RESOURCE_SUPPORT).toHaveLength(16);
    for (const key of ['cpu_memory_gpu_usage', 'network_usage', 'ai_token_inference', 'auto_scaling', 'auto_cost_change']) {
      expect(RESOURCE_SUPPORT.find((s) => s.key === key)?.status).toBe('unsupported');
    }
  });
});
