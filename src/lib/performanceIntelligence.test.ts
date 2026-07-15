import { describe, expect, it } from 'vitest';
import {
  analyzeKpiAttribution,
  assessKpiHealth,
  buildExecutiveBriefing,
  buildKpiHierarchy,
  buildPerformanceCockpit,
  buildPerformanceRecommendation,
  classifyTrend,
  classifyVariance,
  compareBenchmark,
  correlateStrategyPerformance,
  PERFORMANCE_SUPPORT,
} from './performanceIntelligence';

describe('hierarchy — 5단계 + orphan/cycle', () => {
  it('corporate_goal 은 parent 불필요, 미연결 노드 orphan, cycle 감지', () => {
    const r = buildKpiHierarchy([
      { id: 'g1', level: 'corporate_goal', label: 'G', parentId: null },
      { id: 'b1', level: 'business_kpi', label: 'MRR', parentId: 'g1' },
      { id: 'o1', level: 'operational_kpi', label: 'Listening', parentId: null },   // orphan
      { id: 'x', level: 'bogus', label: 'X', parentId: null },
    ]);
    expect(r.levels).toHaveLength(5);
    expect(r.orphans).toContain('o1');
    expect(r.orphans).not.toContain('b1');
    const cyclic = buildKpiHierarchy([
      { id: 'a', level: 'business_kpi', label: 'A', parentId: 'b' },
      { id: 'b', level: 'business_kpi', label: 'B', parentId: 'a' },
    ]);
    expect(cyclic.cycles.length).toBeGreaterThan(0);
  });
});

describe('attribution — 인과 확정 아님', () => {
  it('Evidence 없음 → attribution_unverified, 후보 없음 → insufficient, notCausalConfirmation 고정', () => {
    expect(analyzeKpiAttribution({ kpiKey: 'mrr', direction: 'up', candidateFactors: ['f'], evidence: [], unknownFactors: [] }).verdict).toBe('attribution_unverified');
    expect(analyzeKpiAttribution({ kpiKey: 'mrr', direction: 'unknown', candidateFactors: ['f'], evidence: ['e'], unknownFactors: [] }).verdict).toBe('insufficient_data');
    const r = analyzeKpiAttribution({ kpiKey: 'mrr', direction: 'up', candidateFactors: ['신규 구독 증가'], evidence: ['subscriptions 실측'], unknownFactors: ['seasonality'] });
    expect(r.verdict).toBe('attribution_candidate');
    expect(r.confidence).toBe(55);   // unknown 1건 감점
    expect(r.notCausalConfirmation).toBe(true);
  });
});

describe('variance — 4상태만 + Variance ≠ Failure', () => {
  it('자료 없음 → variance_unknown, tolerance 내 neutral, 방향 반영', () => {
    expect(classifyVariance({ actual: null, target: 100 }).verdict).toBe('variance_unknown');
    expect(classifyVariance({ actual: 102, target: 100 }).verdict).toBe('neutral');
    const up = classifyVariance({ actual: 130, target: 100 });
    expect(up.verdict).toBe('positive');
    expect(up.variancePct).toBe(30);
    expect(up.varianceIsNotFailure).toBe(true);
    expect(classifyVariance({ actual: 70, target: 100 }).verdict).toBe('negative');
    expect(classifyVariance({ actual: 70, target: 100, direction: 'lower_is_better' }).verdict).toBe('positive');
  });
});

describe('trend — 4분류 + 표본 방어', () => {
  it('표본<4 sample_too_small, 값 없음 insufficient, 분류/변동성', () => {
    expect(classifyTrend(null).dataStatus).toBe('insufficient_data');
    expect(classifyTrend([{ value: 1 }, { value: 2 }]).dataStatus).toBe('sample_too_small');
    const up = classifyTrend([{ value: 10 }, { value: 10 }, { value: 20 }, { value: 20 }]);
    expect(up.trend).toBe('improving');
    expect(up.trendIsNotGuarantee).toBe(true);
    expect(classifyTrend([{ value: 20 }, { value: 20 }, { value: 10 }, { value: 10 }]).trend).toBe('declining');
    expect(classifyTrend([{ value: 10 }, { value: 10 }, { value: 10 }, { value: 10 }]).trend).toBe('stable');
    expect(classifyTrend([{ value: 1 }, { value: 100 }, { value: 2 }, { value: 90 }]).trend).toBe('volatile');
  });
});

describe('health — Evidence 필수', () => {
  it('Evidence 없으면 unknown + kpi_unverified, negative variance → at_risk', () => {
    const noEv = assessKpiHealth({ variance: 'negative', trend: 'declining', evidence: [] });
    expect(noEv.health).toBe('unknown');
    expect(noEv.verdict).toBe('kpi_unverified');
    expect(assessKpiHealth({ variance: 'negative', trend: null, evidence: ['snap'] }).health).toBe('at_risk');
    expect(assessKpiHealth({ variance: 'neutral', trend: 'declining', evidence: ['snap'] }).health).toBe('watch');
    const ok = assessKpiHealth({ variance: 'positive', trend: 'improving', evidence: ['snap'] });
    expect(ok.health).toBe('healthy');
    expect(ok.healthIsNotBusinessQuality).toBe(true);
    expect(assessKpiHealth({ variance: 'variance_unknown', trend: null, evidence: ['snap'] }).health).toBe('unknown');
  });
});

describe('benchmark — 외부 비교는 실데이터 필수', () => {
  it('이전 기간 비교 + 외부 데이터 없으면 performed=false', () => {
    const r = compareBenchmark({ metric: 'mrr', current: 120, previous: 100, previousLabel: 'previous_quarter' });
    expect(r.verdict).toBe('compared');
    expect(r.delta).toBe(20);
    expect(r.deltaPct).toBe(20);
    expect(r.externalComparison.performed).toBe(false);
    expect(compareBenchmark({ metric: 'mrr', current: null, previous: 100, previousLabel: 'previous_year' }).verdict).toBe('benchmark_unavailable');
    const ext = compareBenchmark({ metric: 'mrr', current: 120, previous: 100, previousLabel: 'previous_period', external: { value: 110, source: 'real_dataset' } });
    expect(ext.externalComparison.performed).toBe(true);
  });
});

describe('correlation — Correlation ≠ Causation', () => {
  it('표본<5 sample_too_small, 동방향 candidate, 자료 없음 insufficient', () => {
    const r = correlateStrategyPerformance([
      { label: 'strategy↔mrr', strategySignal: 30, kpiSignal: 25, sample: 10 },
      { label: 'small', strategySignal: 10, kpiSignal: 10, sample: 3 },
      { label: 'nodata', strategySignal: null, kpiSignal: 5, sample: 10 },
      { label: 'opposite', strategySignal: 10, kpiSignal: -10, sample: 10 },
    ]);
    expect(r.pairs[0].verdict).toBe('correlation_candidate');
    expect(r.pairs[0].strength).toBe('strong_candidate');
    expect(r.pairs[1].verdict).toBe('sample_too_small');
    expect(r.pairs[2].verdict).toBe('insufficient_data');
    expect(r.pairs[3].verdict).toBe('no_known_correlation');
    expect(r.correlationIsNotCausation).toBe(true);
  });
});

describe('briefing / recommendation / cockpit / support', () => {
  it('briefing: 5섹션 + 자동 발송 없음 + period whitelist', () => {
    const r = buildExecutiveBriefing({ periodKind: 'weekly', kpiChanges: [{ kpi: 'mrr', note: '+5%' }], risks: ['r'], opportunities: ['o'], unknownFactors: ['u'], executiveNotes: null });
    expect(r.valid).toBe(true);
    expect(r.sections).toHaveLength(5);
    expect(r.autoSendDisabled).toBe(true);
    expect(buildExecutiveBriefing({ periodKind: 'hourly', kpiChanges: [], risks: [], opportunities: [], unknownFactors: [], executiveNotes: null }).valid).toBe(false);
  });
  it('recommendation: whitelist + Evidence 필수 + Recommendation ≠ Decision', () => {
    expect('rejected' in buildPerformanceRecommendation({ type: 'auto_update_kpi', reason: 'x', evidence: ['e'], confidence: null, assumptions: [] })).toBe(true);
    expect('rejected' in buildPerformanceRecommendation({ type: 'review_kpi', reason: 'x', evidence: [], confidence: null, assumptions: [] })).toBe(true);
    const r = buildPerformanceRecommendation({ type: 'investigate_variance', reason: 'MRR variance negative', evidence: ['snapshot'], confidence: 40, alternatives: ['a'], assumptions: ['s'] });
    if ('humanApprovalRequired' in r) {
      expect(r.humanApprovalRequired).toBe(true);
      expect(r.approvalImplied).toBe(false);
      expect(r.limitations).toContain('Recommendation ≠ Decision');
    }
  });
  it('cockpit: 8영역 + humanDecisionRequired', () => {
    const r = buildPerformanceCockpit({ kpiTotal: 5, kpiUnavailable: 1, hierarchyOrphans: 0, trendsAnalyzed: 3, varianceNegative: 1, healthAtRisk: 1, benchmarksCompared: 2, recommendationsOpen: 2, summaryNote: null });
    expect(r.sections).toHaveLength(8);
    expect(r.humanDecisionRequired).toBe(true);
    expect(r.sections.find((s) => s.key === 'executive_summary')?.headline).toBe('insufficient_data');
    expect(r.sections.find((s) => s.key === 'kpi_variance')?.detail).toBe('Variance ≠ Failure');
  });
  it('PERFORMANCE_SUPPORT: 16항목 + 자동 생성/외부 벤치마크/자동 발송 unsupported', () => {
    expect(PERFORMANCE_SUPPORT).toHaveLength(16);
    for (const key of ['external_benchmark', 'auto_kpi_creation', 'auto_briefing_send']) {
      expect(PERFORMANCE_SUPPORT.find((s) => s.key === key)?.status).toBe('unsupported');
    }
  });
});
