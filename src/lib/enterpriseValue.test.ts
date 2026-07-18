import { describe, expect, it } from 'vitest';
import {
  BUSINESS_VALUE_CATEGORIES, BUSINESS_VALUE_STATUSES, VALUE_TREND_RESULTS, ROI_RESULTS,
  VALUE_ATTRIBUTION_DIMENSIONS, VALUE_ATTRIBUTION_RESULTS, VALUE_LINK_RESULTS,
  VALUE_TRADEOFF_AXES, VALUE_RECOMMENDATION_TYPES, VALUE_SCORE_FIELDS, VALUE_FLOW_STAGES,
  calculateRoiCandidate, evaluateValueAttribution, calculateValueTrendCandidate,
  evaluateValueLinkCandidate, evaluateCrossDomainValue, buildEnterpriseValueScore,
  buildStrategicValueScorecard, evaluateValueTradeoff, evaluateValueConfidence,
  validateValueReview, buildValueTimeline,
  ENTERPRISE_VALUE_COMPONENTS, ENTERPRISE_VALUE_SUPPORT_MATRIX,
  type ValueScoreEntryInput,
} from './enterpriseValue';

describe('enterpriseValue 상수(SQL CHECK 1:1)', () => {
  it('핵심 whitelist 길이가 마이그레이션과 일치한다', () => {
    expect(BUSINESS_VALUE_CATEGORIES).toHaveLength(16);
    expect(BUSINESS_VALUE_STATUSES).toHaveLength(5);
    expect(VALUE_TREND_RESULTS).toHaveLength(6);
    expect(ROI_RESULTS).toHaveLength(5);
    expect(VALUE_ATTRIBUTION_DIMENSIONS).toHaveLength(6);
    expect(VALUE_ATTRIBUTION_RESULTS).toHaveLength(5);
    expect(VALUE_TRADEOFF_AXES).toHaveLength(6);
    expect(VALUE_RECOMMENDATION_TYPES).toHaveLength(25);
    expect(VALUE_SCORE_FIELDS).toHaveLength(9);
  });
  it('상태/결과 whitelist 는 insufficient_data 를 포함한다(Unknown 유지)', () => {
    for (const list of [BUSINESS_VALUE_STATUSES, VALUE_TREND_RESULTS, ROI_RESULTS, VALUE_ATTRIBUTION_RESULTS, VALUE_LINK_RESULTS]) {
      expect(list).toContain('insufficient_data');
    }
  });
});

describe('calculateRoiCandidate — ROI Candidate(§6)', () => {
  it('ROI 수치를 계산하되 Accounting ROI/Investment Decision 이 아니다', () => {
    const r = calculateRoiCandidate({ investment: 100, benefit: 150, confidence: 80 });
    expect(r.result).toBe('excellent_roi_candidate');
    expect(r.roiPct).toBe(50);
    expect(r.roiIsNotAccountingRoi).toBe(true);
    expect(r.roiIsNotInvestmentDecision).toBe(true);
    expect(calculateRoiCandidate({ investment: 100, benefit: 110, confidence: 80 }).result).toBe('acceptable_roi_candidate');
    expect(calculateRoiCandidate({ investment: 100, benefit: 60, confidence: 80 }).result).toBe('poor_roi_candidate');
  });
  it('신뢰도 낮으면 수치와 무관하게 uncertain 유지(Confidence ≠ Certainty)', () => {
    expect(calculateRoiCandidate({ investment: 100, benefit: 200, confidence: 20 }).result).toBe('uncertain_roi_candidate');
    expect(calculateRoiCandidate({ investment: 100, benefit: 200, confidence: null }).result).toBe('uncertain_roi_candidate');
  });
  it('investment null/0 이하는 insufficient_data — Null→0 치환 금지', () => {
    expect(calculateRoiCandidate({ investment: null, benefit: 100, confidence: 80 }).result).toBe('insufficient_data');
    expect(calculateRoiCandidate({ investment: 0, benefit: 100, confidence: 80 }).roiPct).toBeNull();
  });
});

describe('evaluateValueAttribution — Value Attribution(§7)', () => {
  it('최대 기여 차원을 후보로 판정하되 Proven Causality 가 아니다', () => {
    const r = evaluateValueAttribution([
      { dimension: 'strategy_contribution', weight: 6 },
      { dimension: 'execution_contribution', weight: 2 },
      { dimension: 'external_factors', weight: 2 },
    ]);
    expect(r.result).toBe('strong_attribution_candidate');
    expect(r.topDimension).toBe('strategy_contribution');
    expect(r.attributionIsNotProvenCausality).toBe(true);
  });
  it('외부/미지 요인이 절반 이상이면 attribution_unverified 유지', () => {
    const r = evaluateValueAttribution([
      { dimension: 'kpi_contribution', weight: 2 },
      { dimension: 'unknown_factors', weight: 5 },
      { dimension: 'external_factors', weight: 3 },
    ]);
    expect(r.result).toBe('attribution_unverified');
    expect(r.topDimension).toBeNull();
  });
  it('허용 밖 dimension/빈 신호는 insufficient_data', () => {
    expect(evaluateValueAttribution([{ dimension: 'made_up', weight: 9 }]).result).toBe('insufficient_data');
    expect(evaluateValueAttribution(null).result).toBe('insufficient_data');
  });
});

describe('calculateValueTrendCandidate — Value Trend(§5)', () => {
  it('변화율로 5단계 판정하며 Trend ≠ Future Trend', () => {
    expect(calculateValueTrendCandidate([{ value: 100 }, { value: 110 }, { value: 130 }]).result).toBe('strong_positive_candidate');
    expect(calculateValueTrendCandidate([{ value: 100 }, { value: 101 }, { value: 99 }]).result).toBe('stable_candidate');
    const r = calculateValueTrendCandidate([{ value: 100 }, { value: 80 }, { value: 60 }]);
    expect(r.result).toBe('strong_negative_candidate');
    expect(r.trendIsNotFutureTrend).toBe(true);
  });
  it('표본 부족은 sample_too_small · null 만 있으면 insufficient_data', () => {
    expect(calculateValueTrendCandidate([{ value: 100 }, { value: 120 }]).dataStatus).toBe('sample_too_small');
    expect(calculateValueTrendCandidate([{ value: null }, { value: null }, { value: null }]).dataStatus).toBe('insufficient_data');
  });
});

describe('evaluateValueLinkCandidate — KPI→Value Link', () => {
  it('동방향 변화 크기로 후보 강도를 판정하며 KPI Improvement ≠ Value Creation', () => {
    const r = evaluateValueLinkCandidate({ sourceDeltaPct: 20, valueDeltaPct: 18, sampleSize: 10 });
    expect(r.result).toBe('strong_link_candidate');
    expect(r.kpiImprovementIsNotValueCreation).toBe(true);
    expect(evaluateValueLinkCandidate({ sourceDeltaPct: 10, valueDeltaPct: -8, sampleSize: 10 }).result).toBe('no_material_link_candidate');
  });
  it('표본 부족은 link_unverified · null 은 insufficient_data', () => {
    expect(evaluateValueLinkCandidate({ sourceDeltaPct: 20, valueDeltaPct: 18, sampleSize: 2 }).result).toBe('link_unverified');
    expect(evaluateValueLinkCandidate({ sourceDeltaPct: null, valueDeltaPct: 18, sampleSize: 10 }).result).toBe('insufficient_data');
  });
});

describe('evaluateCrossDomainValue — Cross-Domain Value', () => {
  it('발산 도메인 쌍(Brand ↓ vs Revenue ↑)을 탐지한다', () => {
    const r = evaluateCrossDomainValue([
      { domain: 'revenue', deltaPct: 12 },
      { domain: 'brand', deltaPct: -9 },
      { domain: 'customer', deltaPct: 1 },
    ]);
    expect(r.result).toBe('diverging_domains_candidate');
    expect(r.divergingPairs).toEqual([{ a: 'revenue', b: 'brand' }]);
    expect(r.revenueIncreaseIsNotEnterpriseValueIncrease).toBe(true);
  });
  it('발산 없으면 no_material · 도메인 2개 미만은 insufficient_data', () => {
    expect(evaluateCrossDomainValue([{ domain: 'revenue', deltaPct: 3 }, { domain: 'brand', deltaPct: 2 }]).result).toBe('no_material_correlation_candidate');
    expect(evaluateCrossDomainValue([{ domain: 'revenue', deltaPct: 3 }]).result).toBe('insufficient_data');
  });
});

const ENTRY = (over: Partial<ValueScoreEntryInput>): ValueScoreEntryInput => ({
  valueCode: 'V1', category: 'revenue', baseline: 100, current: 110,
  trend: 'moderate_positive_candidate', roi: 'acceptable_roi_candidate', confidence: 60,
  attribution: 'moderate_attribution_candidate', recommendation: 'review_roi_candidate', executiveReviewPresent: false,
  ...over,
});

describe('buildEnterpriseValueScore / buildStrategicValueScorecard — Value Score(§8)', () => {
  it('Trend/ROI 기반 0~100 점수를 결정적으로 계산하며 Score ≠ Company Valuation', () => {
    const r = buildEnterpriseValueScore([
      ENTRY({ trend: 'strong_positive_candidate', roi: 'excellent_roi_candidate' }),
      ENTRY({ valueCode: 'V2', trend: 'stable_candidate', roi: 'acceptable_roi_candidate' }),
    ]);
    expect(r.score).toBe(80);
    expect(r.fields).toHaveLength(9);
    expect(r.scoreIsNotCompanyValuation).toBe(true);
  });
  it('평가 가능 항목 없으면 score null(0 치환 금지)', () => {
    const r = buildEnterpriseValueScore([ENTRY({ trend: 'insufficient_data' })]);
    expect(r.score).toBeNull();
    expect(r.insufficientData).toBe(true);
  });
  it('Scorecard 는 저ROI/악화 우선 결정적 정렬', () => {
    const r = buildStrategicValueScorecard([
      ENTRY({ valueCode: 'OK', roi: 'excellent_roi_candidate' }),
      ENTRY({ valueCode: 'POOR', roi: 'poor_roi_candidate', trend: 'strong_negative_candidate' }),
      ENTRY({ valueCode: 'UNC', roi: 'uncertain_roi_candidate' }),
    ], 2);
    expect(r.priorityRows.map((e) => e.valueCode)).toEqual(['POOR', 'UNC']);
    expect(r.orderingIsDeterministic).toBe(true);
  });
});

describe('evaluateValueTradeoff — Value Trade-off', () => {
  it('단기 ROI vs 장기 Value 충돌을 후보로 판정한다', () => {
    const r = evaluateValueTradeoff({ axis: 'short_term_roi_vs_long_term_value', sideADeltaPct: 15, sideBDeltaPct: -10 });
    expect(r.result).toBe('conflicting_tradeoff_candidate');
    expect(r.tradeoffIsNotPriorityDecision).toBe(true);
    expect(evaluateValueTradeoff({ axis: 'brand_value_vs_revenue', sideADeltaPct: 5, sideBDeltaPct: 8 }).result).toBe('favorable_tradeoff_candidate');
    expect(evaluateValueTradeoff({ axis: 'growth_vs_profitability', sideADeltaPct: 1, sideBDeltaPct: -2 }).result).toBe('balanced_tradeoff_candidate');
  });
  it('허용 밖 axis/null 은 insufficient_data', () => {
    expect(evaluateValueTradeoff({ axis: 'made_up', sideADeltaPct: 1, sideBDeltaPct: 1 }).result).toBe('insufficient_data');
    expect(evaluateValueTradeoff({ axis: 'cost_vs_capability', sideADeltaPct: null, sideBDeltaPct: 1 }).result).toBe('insufficient_data');
  });
});

describe('evaluateValueConfidence — Confidence ≠ Certainty', () => {
  it('출처 품질·표본·attribution 상태로 계산한다', () => {
    expect(evaluateValueConfidence({ sampleSize: 30, dataQuality: 'verified_source_reference', attributionUnverified: false }).confidence).toBe(100);
    expect(evaluateValueConfidence({ sampleSize: 30, dataQuality: 'verified_source_reference', attributionUnverified: true }).confidence).toBe(50);
  });
  it('표본 0/null 은 null 유지(0 치환 금지)', () => {
    expect(evaluateValueConfidence({ sampleSize: null, dataQuality: 'verified_source_reference', attributionUnverified: false }).confidence).toBeNull();
  });
});

describe('validateValueReview — Review(Honest Boundary)', () => {
  it('Self-Review 와 Evidence 없는 Review Reference 를 차단한다', () => {
    const self = validateValueReview({ action: 'record_review_reference', evidenceCount: 3, isSelfReview: true });
    expect(self.allowed).toBe(false);
    expect(self.blockedReasons.join(' ')).toContain('Self-Review');
    expect(validateValueReview({ action: 'record_review_reference', evidenceCount: 0, isSelfReview: false }).allowed).toBe(false);
  });
  it('요청 액션은 허용하되 humanDecisionRequired 유지', () => {
    const ok = validateValueReview({ action: 'request_executive_review', evidenceCount: null, isSelfReview: true });
    expect(ok.allowed).toBe(true);
    expect(ok.humanDecisionRequired).toBe(true);
  });
});

describe('buildValueTimeline — 흐름 관측', () => {
  it('13 단계 흐름을 순서대로 반환하고 관측 여부만 표시한다', () => {
    const t = buildValueTimeline({ present: { business_value: true, value_learning: false } });
    expect(t).toHaveLength(VALUE_FLOW_STAGES.length);
    expect(t[0].stage).toBe('enterprise_strategy');
    expect(t.find((s) => s.stage === 'business_value')?.present).toBe(true);
    expect(t.find((s) => s.stage === 'value_learning')?.present).toBe(false);
  });
});

describe('ENTERPRISE_VALUE_SUPPORT_MATRIX — Honest Boundary', () => {
  it('컴포넌트 10종·매트릭스 56항목', () => {
    expect(ENTERPRISE_VALUE_COMPONENTS).toHaveLength(10);
    expect(ENTERPRISE_VALUE_SUPPORT_MATRIX).toHaveLength(56);
  });
  it('unavailable 18항목은 전부 automatic_* — 자동 ROI 확정/투자 승인/회계 처리 없음', () => {
    const unavailable = ENTERPRISE_VALUE_SUPPORT_MATRIX.filter((e) => e.support === 'unavailable');
    expect(unavailable).toHaveLength(18);
    for (const e of unavailable) expect(e.capability.startsWith('automatic_')).toBe(true);
  });
  it('회계/재무제표/기업가치/시장 데이터 피드는 insufficient_data 로 정직하게 표시된다', () => {
    const feeds = ENTERPRISE_VALUE_SUPPORT_MATRIX.filter((e) => e.support === 'insufficient_data');
    expect(feeds.length).toBeGreaterThanOrEqual(6);
    expect(feeds.map((f) => f.capability)).toContain('accounting_ledger_feed');
    expect(feeds.map((f) => f.capability)).toContain('company_valuation_model');
  });
});
