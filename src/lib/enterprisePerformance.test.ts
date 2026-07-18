import { describe, expect, it } from 'vitest';
import {
  ENTERPRISE_KPI_CATEGORIES, ENTERPRISE_KPI_STATUSES, KPI_TREND_RESULTS, KPI_VARIANCE_RESULTS,
  BUSINESS_IMPACT_DOMAINS, BUSINESS_IMPACT_RESULTS, KPI_CORRELATION_RESULTS,
  PERFORMANCE_RECOMMENDATION_TYPES, SCORECARD_FIELDS, PERFORMANCE_FLOW_STAGES,
  calculateKpiTrendCandidate, calculateKpiVariance, compareForecastToActual,
  calculateKpiCorrelationCandidate, evaluateBusinessImpactCandidate,
  buildStrategicScorecardCandidate, buildExecutiveScorecardCandidate, evaluateKpiConfidence,
  validatePerformanceReview, buildPerformanceTimeline,
  ENTERPRISE_PERFORMANCE_COMPONENTS, ENTERPRISE_PERFORMANCE_SUPPORT_MATRIX,
  type ScorecardEntryInput,
} from './enterprisePerformance';

describe('enterprisePerformance 상수(SQL CHECK 1:1)', () => {
  it('핵심 whitelist 길이가 마이그레이션과 일치한다', () => {
    expect(ENTERPRISE_KPI_CATEGORIES).toHaveLength(15);
    expect(ENTERPRISE_KPI_STATUSES).toHaveLength(5);
    expect(KPI_TREND_RESULTS).toHaveLength(6);
    expect(KPI_VARIANCE_RESULTS).toHaveLength(5);
    expect(BUSINESS_IMPACT_DOMAINS).toHaveLength(11);
    expect(BUSINESS_IMPACT_RESULTS).toHaveLength(6);
    expect(PERFORMANCE_RECOMMENDATION_TYPES).toHaveLength(24);
    expect(SCORECARD_FIELDS).toHaveLength(10);
  });
  it('상태/결과 whitelist 는 insufficient_data 를 포함한다(Unknown 유지)', () => {
    for (const list of [ENTERPRISE_KPI_STATUSES, KPI_TREND_RESULTS, KPI_VARIANCE_RESULTS, BUSINESS_IMPACT_RESULTS, KPI_CORRELATION_RESULTS]) {
      expect(list).toContain('insufficient_data');
    }
  });
});

describe('calculateKpiTrendCandidate — KPI Trend', () => {
  it('변화율에 따라 5단계 Trend 를 판정하고 Trend ≠ Future Trend', () => {
    expect(calculateKpiTrendCandidate([{ value: 100 }, { value: 110 }, { value: 130 }]).result).toBe('strong_growth_candidate');
    expect(calculateKpiTrendCandidate([{ value: 100 }, { value: 103 }, { value: 108 }]).result).toBe('moderate_growth_candidate');
    expect(calculateKpiTrendCandidate([{ value: 100 }, { value: 101 }, { value: 99 }]).result).toBe('stable_candidate');
    expect(calculateKpiTrendCandidate([{ value: 100 }, { value: 95 }, { value: 88 }]).result).toBe('moderate_decline_candidate');
    const r = calculateKpiTrendCandidate([{ value: 100 }, { value: 80 }, { value: 60 }]);
    expect(r.result).toBe('strong_decline_candidate');
    expect(r.trendIsNotFutureTrend).toBe(true);
  });
  it('표본 부족은 sample_too_small · null 만 있으면 insufficient_data — Null→0 금지', () => {
    expect(calculateKpiTrendCandidate([{ value: 100 }, { value: 120 }]).dataStatus).toBe('sample_too_small');
    expect(calculateKpiTrendCandidate([{ value: null }, { value: null }, { value: null }]).dataStatus).toBe('insufficient_data');
    expect(calculateKpiTrendCandidate(null).result).toBe('insufficient_data');
  });
});

describe('calculateKpiVariance — KPI Variance', () => {
  it('목표 대비 미달률로 4단계 판정하며 Target ≠ Guaranteed Result', () => {
    expect(calculateKpiVariance({ baseline: 80, target: 100, actual: 98, direction: 'higher_is_better' }).result).toBe('on_target_candidate');
    expect(calculateKpiVariance({ baseline: 80, target: 100, actual: 90, direction: 'higher_is_better' }).result).toBe('slightly_off_target_candidate');
    expect(calculateKpiVariance({ baseline: 80, target: 100, actual: 75, direction: 'higher_is_better' }).result).toBe('materially_off_target_candidate');
    const r = calculateKpiVariance({ baseline: 80, target: 100, actual: 50, direction: 'higher_is_better' });
    expect(r.result).toBe('critical_variance_candidate');
    expect(r.targetIsNotGuaranteedResult).toBe(true);
    expect(r.declineIsNotStrategyFailure).toBe(true);
  });
  it('lower_is_better 는 목표 초과가 악화로 판정된다', () => {
    expect(calculateKpiVariance({ baseline: null, target: 100, actual: 90, direction: 'lower_is_better' }).result).toBe('on_target_candidate');
    expect(calculateKpiVariance({ baseline: null, target: 100, actual: 140, direction: 'lower_is_better' }).result).toBe('critical_variance_candidate');
  });
  it('actual/target null 은 insufficient_data — Null→0 치환 금지', () => {
    const r = calculateKpiVariance({ baseline: 80, target: null, actual: 90, direction: 'higher_is_better' });
    expect(r.result).toBe('insufficient_data');
    expect(r.varianceVsTarget).toBeNull();
    expect(r.varianceVsBaseline).toBe(10);
  });
});

describe('compareForecastToActual — Forecast 비교', () => {
  it('오차율로 판정하며 Forecast ≠ Future Fact', () => {
    expect(compareForecastToActual(100, 103).result).toBe('forecast_aligned_candidate');
    expect(compareForecastToActual(100, 115).result).toBe('forecast_moderately_off_candidate');
    const r = compareForecastToActual(100, 150);
    expect(r.result).toBe('forecast_materially_off_candidate');
    expect(r.forecastIsNotFutureFact).toBe(true);
  });
  it('null/0 forecast 는 insufficient_data', () => {
    expect(compareForecastToActual(null, 100).result).toBe('insufficient_data');
    expect(compareForecastToActual(0, 100).result).toBe('insufficient_data');
  });
});

describe('calculateKpiCorrelationCandidate — KPI Correlation', () => {
  it('Pearson 계수로 강도 후보를 판정하며 Correlation ≠ Causality', () => {
    const r = calculateKpiCorrelationCandidate([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
    expect(r.result).toBe('strong_correlation_candidate');
    expect(r.coefficient).toBe(1);
    expect(r.correlationIsNotCausality).toBe(true);
  });
  it('무상관 계열은 no_material_correlation_candidate', () => {
    const r = calculateKpiCorrelationCandidate([1, 2, 1, 2, 1, 2], [5, 5, 4, 4, 5, 4]);
    expect(['no_material_correlation_candidate', 'weak_correlation_candidate']).toContain(r.result);
  });
  it('표본 4 미만은 sample_too_small · null 쌍 제외 후 판단', () => {
    expect(calculateKpiCorrelationCandidate([1, 2, 3], [1, 2, 3]).result).toBe('sample_too_small');
    expect(calculateKpiCorrelationCandidate([null, null], [null, null]).result).toBe('insufficient_data');
    expect(calculateKpiCorrelationCandidate([1, 1, 1, 1, 1], [1, 2, 3, 4, 5]).result).toBe('insufficient_data');
  });
});

describe('evaluateBusinessImpactCandidate — Business Impact', () => {
  it('delta 에 따라 5단계 판정하며 Impact ≠ Financial Fact', () => {
    expect(evaluateBusinessImpactCandidate({ domain: 'revenue', deltaPct: 20, sampleSize: 10 }).result).toBe('high_positive_candidate');
    expect(evaluateBusinessImpactCandidate({ domain: 'cost', deltaPct: 5, sampleSize: 10 }).result).toBe('moderate_positive_candidate');
    expect(evaluateBusinessImpactCandidate({ domain: 'customer', deltaPct: 0, sampleSize: 10 }).result).toBe('neutral_candidate');
    const r = evaluateBusinessImpactCandidate({ domain: 'store', deltaPct: -20, sampleSize: 10 });
    expect(r.result).toBe('high_negative_candidate');
    expect(r.impactIsNotFinancialFact).toBe(true);
  });
  it('허용 밖 domain/표본 부족은 insufficient_data + sample_too_small', () => {
    expect(evaluateBusinessImpactCandidate({ domain: 'made_up', deltaPct: 20, sampleSize: 10 }).result).toBe('insufficient_data');
    expect(evaluateBusinessImpactCandidate({ domain: 'revenue', deltaPct: 20, sampleSize: 2 }).sampleStatus).toBe('sample_too_small');
  });
});

const ENTRY = (over: Partial<ScorecardEntryInput>): ScorecardEntryInput => ({
  kpiCode: 'K1', target: 100, actual: 90, trend: 'stable_candidate', variance: 'slightly_off_target_candidate',
  forecast: 95, confidence: 60, businessImpact: 'neutral_candidate', recommendation: 'review_kpi_variance', executiveReviewPresent: false,
  ...over,
});

describe('buildStrategicScorecardCandidate / buildExecutiveScorecardCandidate — Scorecard', () => {
  it('§8 필드 10종을 포함하고 Scorecard ≠ Executive Evaluation', () => {
    const r = buildStrategicScorecardCandidate([ENTRY({}), ENTRY({ kpiCode: 'K2', target: null })]);
    expect(r.fields).toHaveLength(10);
    expect(r.rows[0].fieldsComplete).toBe(true);
    expect(r.rows[1].fieldsComplete).toBe(false);
    expect(r.scorecardIsNotExecutiveEvaluation).toBe(true);
    expect(r.improvementIsNotStrategySuccess).toBe(true);
  });
  it('Executive Scorecard 는 악화 우선 결정적 정렬', () => {
    const r = buildExecutiveScorecardCandidate([
      ENTRY({ kpiCode: 'OK', variance: 'on_target_candidate' }),
      ENTRY({ kpiCode: 'CRIT', variance: 'critical_variance_candidate', trend: 'strong_decline_candidate' }),
      ENTRY({ kpiCode: 'MAT', variance: 'materially_off_target_candidate' }),
    ], 2);
    expect(r.priorityRows.map((e) => e.kpiCode)).toEqual(['CRIT', 'MAT']);
    expect(r.orderingIsDeterministic).toBe(true);
  });
  it('null 입력은 빈 결과(안전)', () => {
    expect(buildStrategicScorecardCandidate(null).rows).toHaveLength(0);
    expect(buildExecutiveScorecardCandidate(null).priorityRows).toHaveLength(0);
  });
});

describe('evaluateKpiConfidence — Confidence ≠ Certainty', () => {
  it('출처 품질·표본으로 계산하며 Certainty 가 아니다', () => {
    const r = evaluateKpiConfidence({ sampleSize: 30, dataQuality: 'verified_source_reference' });
    expect(r.confidence).toBe(100);
    expect(r.confidenceIsNotCertainty).toBe(true);
    expect(evaluateKpiConfidence({ sampleSize: 30, dataQuality: 'quality_unverified' }).confidence).toBe(30);
  });
  it('표본 0/null 은 null 유지(0 치환 금지)', () => {
    expect(evaluateKpiConfidence({ sampleSize: null, dataQuality: 'verified_source_reference' }).confidence).toBeNull();
    expect(evaluateKpiConfidence({ sampleSize: 0, dataQuality: 'verified_source_reference' }).confidence).toBeNull();
  });
});

describe('validatePerformanceReview — Review(Honest Boundary)', () => {
  it('Self-Review 와 Evidence 없는 Review Reference 를 차단한다', () => {
    const self = validatePerformanceReview({ action: 'record_review_reference', evidenceCount: 3, isSelfReview: true });
    expect(self.allowed).toBe(false);
    expect(self.blockedReasons.join(' ')).toContain('Self-Review');
    expect(validatePerformanceReview({ action: 'record_review_reference', evidenceCount: 0, isSelfReview: false }).allowed).toBe(false);
  });
  it('요청 액션은 허용하되 humanEvaluationRequired 유지', () => {
    const ok = validatePerformanceReview({ action: 'request_executive_review', evidenceCount: null, isSelfReview: true });
    expect(ok.allowed).toBe(true);
    expect(ok.humanEvaluationRequired).toBe(true);
    expect(validatePerformanceReview({ action: 'record_review_reference', evidenceCount: 2, isSelfReview: false }).allowed).toBe(true);
  });
});

describe('buildPerformanceTimeline — 흐름 관측', () => {
  it('13 단계 흐름을 순서대로 반환하고 관측 여부만 표시한다', () => {
    const t = buildPerformanceTimeline({ present: { strategic_kpi: true, observed_outcome: false } });
    expect(t).toHaveLength(PERFORMANCE_FLOW_STAGES.length);
    expect(t[0].stage).toBe('strategic_goal');
    expect(t.find((s) => s.stage === 'strategic_kpi')?.present).toBe(true);
    expect(t.find((s) => s.stage === 'observed_outcome')?.present).toBe(false);
  });
});

describe('ENTERPRISE_PERFORMANCE_SUPPORT_MATRIX — Honest Boundary', () => {
  it('컴포넌트 10종·매트릭스 58항목', () => {
    expect(ENTERPRISE_PERFORMANCE_COMPONENTS).toHaveLength(10);
    expect(ENTERPRISE_PERFORMANCE_SUPPORT_MATRIX).toHaveLength(58);
  });
  it('unavailable 21항목은 전부 automatic_* — 자동 평가/보상/변경 없음', () => {
    const unavailable = ENTERPRISE_PERFORMANCE_SUPPORT_MATRIX.filter((e) => e.support === 'unavailable');
    expect(unavailable).toHaveLength(21);
    for (const e of unavailable) expect(e.capability.startsWith('automatic_')).toBe(true);
  });
  it('외부 회계/CRM/벤치마크 피드는 insufficient_data 로 정직하게 표시된다', () => {
    const feeds = ENTERPRISE_PERFORMANCE_SUPPORT_MATRIX.filter((e) => e.support === 'insufficient_data');
    expect(feeds.length).toBeGreaterThanOrEqual(6);
    expect(feeds.map((f) => f.capability)).toContain('accounting_system_feed');
  });
});
