import { describe, expect, it } from 'vitest';
import {
  PORTFOLIO_CATEGORIES, PORTFOLIO_STATUSES, PORTFOLIO_SCENARIO_STATUSES,
  DIVERSIFICATION_RESULTS, CAPITAL_ALLOCATION_RESULTS, PORTFOLIO_OPTIMIZATION_DIMENSIONS,
  PORTFOLIO_OPTIMIZATION_RESULTS, PORTFOLIO_TRADEOFF_AXES, PORTFOLIO_RECOMMENDATION_TYPES,
  PORTFOLIO_SCORECARD_FIELDS, PORTFOLIO_FLOW_STAGES,
  calculateDiversificationScore, evaluateConcentrationRisk, evaluateCapitalAllocationCandidate,
  calculateOpportunityCostCandidate, evaluateRiskReturn, comparePortfolioScenarios,
  evaluatePortfolioOptimization, buildExecutivePortfolioScorecard, validatePortfolioReview,
  buildPortfolioTimeline, ENTERPRISE_PORTFOLIO_COMPONENTS, ENTERPRISE_PORTFOLIO_SUPPORT_MATRIX,
  type PortfolioScorecardEntryInput,
} from './enterprisePortfolio';

describe('enterprisePortfolio 상수(SQL CHECK 1:1)', () => {
  it('핵심 whitelist 길이가 마이그레이션과 일치한다', () => {
    expect(PORTFOLIO_CATEGORIES).toHaveLength(16);
    expect(PORTFOLIO_STATUSES).toHaveLength(5);
    expect(PORTFOLIO_SCENARIO_STATUSES).toHaveLength(7);
    expect(DIVERSIFICATION_RESULTS).toHaveLength(6);
    expect(CAPITAL_ALLOCATION_RESULTS).toHaveLength(4);
    expect(PORTFOLIO_OPTIMIZATION_DIMENSIONS).toHaveLength(7);
    expect(PORTFOLIO_OPTIMIZATION_RESULTS).toHaveLength(5);
    expect(PORTFOLIO_TRADEOFF_AXES).toHaveLength(6);
    expect(PORTFOLIO_RECOMMENDATION_TYPES).toHaveLength(23);
    expect(PORTFOLIO_SCORECARD_FIELDS).toHaveLength(8);
  });
  it('상태/결과 whitelist 는 insufficient_data 를 포함한다(Unknown 유지)', () => {
    for (const list of [PORTFOLIO_STATUSES, DIVERSIFICATION_RESULTS, CAPITAL_ALLOCATION_RESULTS, PORTFOLIO_OPTIMIZATION_RESULTS]) {
      expect(list).toContain('insufficient_data');
    }
  });
});

describe('calculateDiversificationScore — Diversification(§5, HHI)', () => {
  it('균등 분산은 highly_diversified·단일 집중은 highly_concentrated', () => {
    const even = calculateDiversificationScore(Array.from({ length: 10 }, (_, i) => ({ key: `k${i}`, weight: 10 })));
    expect(even.result).toBe('highly_diversified_candidate');
    expect(even.hhi).toBe(0.1);
    expect(even.diversificationIsNotRiskGuarantee).toBe(true);
    const conc = calculateDiversificationScore([{ key: 'a', weight: 80 }, { key: 'b', weight: 20 }]);
    expect(conc.result).toBe('highly_concentrated_candidate');
  });
  it('중간 분산 단계를 구분한다', () => {
    expect(calculateDiversificationScore([{ key: 'a', weight: 50 }, { key: 'b', weight: 30 }, { key: 'c', weight: 20 }]).result).toBe('concentrated_candidate');
    expect(calculateDiversificationScore([{ key: 'a', weight: 30 }, { key: 'b', weight: 20 }, { key: 'c', weight: 20 }, { key: 'd', weight: 15 }, { key: 'e', weight: 15 }]).result).toBe('moderately_diversified_candidate');
  });
  it('항목 2개 미만/전부 null 은 insufficient_data — Null→0 치환 금지', () => {
    expect(calculateDiversificationScore([{ key: 'a', weight: 100 }]).result).toBe('insufficient_data');
    expect(calculateDiversificationScore([{ key: 'a', weight: null }, { key: 'b', weight: null }]).hhi).toBeNull();
    expect(calculateDiversificationScore(null).result).toBe('insufficient_data');
  });
});

describe('evaluateConcentrationRisk — Value Concentration', () => {
  it('최대 점유율로 판정하되 Failure Prediction 이 아니다', () => {
    const r = evaluateConcentrationRisk([{ key: 'ai', weight: 75 }, { key: 'brand', weight: 25 }]);
    expect(r.result).toBe('critical_concentration_candidate');
    expect(r.topKey).toBe('ai');
    expect(r.concentrationIsNotFailurePrediction).toBe(true);
    expect(evaluateConcentrationRisk([{ key: 'a', weight: 55 }, { key: 'b', weight: 45 }]).result).toBe('high_concentration_candidate');
    expect(evaluateConcentrationRisk([{ key: 'a', weight: 25 }, { key: 'b', weight: 25 }, { key: 'c', weight: 25 }, { key: 'd', weight: 25 }]).result).toBe('no_material_concentration_candidate');
  });
  it('빈/전부 null 은 insufficient_data', () => {
    expect(evaluateConcentrationRisk([]).result).toBe('insufficient_data');
    expect(evaluateConcentrationRisk([{ key: 'a', weight: null }]).topShare).toBeNull();
  });
});

describe('evaluateCapitalAllocationCandidate — Capital Allocation(§6)', () => {
  it('저위험·고신뢰·Capacity 적합이면 recommended — 배분 집행이 아니다', () => {
    const r = evaluateCapitalAllocationCandidate({ expectedBenefit: 100, expectedRisk: 20, capacityFits: true, confidence: 70 });
    expect(r.result).toBe('recommended_candidate');
    expect(r.allocationCandidateIsNotCapitalAllocation).toBe(true);
  });
  it('고위험/Capacity 초과는 high_risk · 애매하면 acceptable', () => {
    expect(evaluateCapitalAllocationCandidate({ expectedBenefit: 100, expectedRisk: 80, capacityFits: true, confidence: 70 }).result).toBe('high_risk_candidate');
    expect(evaluateCapitalAllocationCandidate({ expectedBenefit: 100, expectedRisk: 20, capacityFits: false, confidence: 70 }).result).toBe('high_risk_candidate');
    expect(evaluateCapitalAllocationCandidate({ expectedBenefit: 100, expectedRisk: 50, capacityFits: true, confidence: 70 }).result).toBe('acceptable_candidate');
    expect(evaluateCapitalAllocationCandidate({ expectedBenefit: 100, expectedRisk: 20, capacityFits: true, confidence: 30 }).result).toBe('acceptable_candidate');
  });
  it('benefit/risk null 은 insufficient_data', () => {
    expect(evaluateCapitalAllocationCandidate({ expectedBenefit: null, expectedRisk: 20, capacityFits: true, confidence: 70 }).result).toBe('insufficient_data');
  });
});

describe('calculateOpportunityCostCandidate — Opportunity Cost(≠ Actual Loss)', () => {
  it('최선 대안 대비 포기 이익을 계산한다', () => {
    const r = calculateOpportunityCostCandidate(100, [80, 160, 90]);
    expect(r.forgoneBenefitCandidate).toBe(60);
    expect(r.result).toBe('high_opportunity_cost_candidate');
    expect(r.opportunityCostIsNotActualLoss).toBe(true);
    expect(calculateOpportunityCostCandidate(100, [110, 90]).result).toBe('low_opportunity_cost_candidate');
    expect(calculateOpportunityCostCandidate(100, [130]).result).toBe('moderate_opportunity_cost_candidate');
  });
  it('선택이 최선이면 forgone 0 · null/빈 대안은 insufficient_data', () => {
    expect(calculateOpportunityCostCandidate(200, [100, 150]).forgoneBenefitCandidate).toBe(0);
    expect(calculateOpportunityCostCandidate(null, [100]).result).toBe('insufficient_data');
    expect(calculateOpportunityCostCandidate(100, []).result).toBe('insufficient_data');
  });
});

describe('evaluateRiskReturn — Risk vs Return', () => {
  it('사분면 후보를 판정하되 투자 결정이 아니다', () => {
    expect(evaluateRiskReturn(20, 80).result).toBe('favorable_risk_return_candidate');
    expect(evaluateRiskReturn(80, 20).result).toBe('high_risk_low_return_candidate');
    expect(evaluateRiskReturn(80, 80).result).toBe('unfavorable_risk_return_candidate');
    const r = evaluateRiskReturn(20, 20);
    expect(r.result).toBe('balanced_risk_return_candidate');
    expect(r.riskReturnIsNotInvestmentDecision).toBe(true);
  });
  it('null 입력은 insufficient_data', () => {
    expect(evaluateRiskReturn(null, 80).result).toBe('insufficient_data');
  });
});

describe('comparePortfolioScenarios — Scenario Comparison(§12)', () => {
  it('benefit-risk-capacity 합성으로 결정적 preferred 후보를 낸다 — Future Fact 아님', () => {
    const r = comparePortfolioScenarios(
      { scenarioCode: 'A', expectedBenefit: 100, expectedRisk: 30, capacityFits: true },
      { scenarioCode: 'B', expectedBenefit: 90, expectedRisk: 20, capacityFits: false },
    );
    expect(r.preferredCandidate).toBe('A');
    expect(r.benefitDelta).toBe(10);
    expect(r.comparisonIsNotFutureFact).toBe(true);
  });
  it('동점은 preferred null 유지 · null 입력은 insufficient', () => {
    const tie = comparePortfolioScenarios(
      { scenarioCode: 'A', expectedBenefit: 100, expectedRisk: 30, capacityFits: null },
      { scenarioCode: 'B', expectedBenefit: 100, expectedRisk: 30, capacityFits: null },
    );
    expect(tie.preferredCandidate).toBeNull();
    expect(comparePortfolioScenarios(
      { scenarioCode: 'A', expectedBenefit: null, expectedRisk: 30, capacityFits: null },
      { scenarioCode: 'B', expectedBenefit: 100, expectedRisk: 30, capacityFits: null },
    ).insufficientData).toBe(true);
  });
});

describe('evaluatePortfolioOptimization — Portfolio Optimization(§7)', () => {
  it('7차원 평균으로 판정하되 Investment Decision 이 아니다', () => {
    const dims = (score: number) => PORTFOLIO_OPTIMIZATION_DIMENSIONS.map((d) => ({ dimension: d, score }));
    expect(evaluatePortfolioOptimization(dims(90)).result).toBe('highly_optimized_candidate');
    expect(evaluatePortfolioOptimization(dims(65)).result).toBe('optimized_candidate');
    const r = evaluatePortfolioOptimization(dims(40));
    expect(r.result).toBe('partially_optimized_candidate');
    expect(r.optimizationIsNotInvestmentDecision).toBe(true);
  });
  it('평가 차원이 절반 미만이면 optimization_unverified 유지', () => {
    const r = evaluatePortfolioOptimization([
      { dimension: 'strategic_alignment', score: 90 },
      { dimension: 'roi_mix', score: 90 },
    ]);
    expect(r.result).toBe('optimization_unverified');
    expect(r.assessedDimensions).toBe(2);
  });
  it('허용 밖 dimension/빈 입력은 insufficient_data', () => {
    expect(evaluatePortfolioOptimization([{ dimension: 'made_up', score: 90 }]).result).toBe('insufficient_data');
    expect(evaluatePortfolioOptimization(null).averageScore).toBeNull();
  });
});

const ENTRY = (over: Partial<PortfolioScorecardEntryInput>): PortfolioScorecardEntryInput => ({
  portfolioCode: 'P1', category: 'growth', diversification: 'well_diversified_candidate',
  roiMix: 'balanced_roi_mix_candidate', valueMix: 'balanced_value_mix_candidate',
  opportunityCost: 'low_opportunity_cost_candidate', risk: 'balanced_risk_return_candidate',
  recommendation: 'review_diversification', executiveReviewPresent: false,
  ...over,
});

describe('buildExecutivePortfolioScorecard — Scorecard(§8)', () => {
  it('집중/고위험 우선 결정적 정렬이며 필드 8종 — 경영 평가 확정 아님', () => {
    const r = buildExecutivePortfolioScorecard([
      ENTRY({ portfolioCode: 'OK' }),
      ENTRY({ portfolioCode: 'CONC', diversification: 'highly_concentrated_candidate', risk: 'high_risk_low_return_candidate' }),
      ENTRY({ portfolioCode: 'RISK', risk: 'unfavorable_risk_return_candidate' }),
    ], 2);
    expect(r.priorityRows.map((e) => e.portfolioCode)).toEqual(['CONC', 'RISK']);
    expect(r.fields).toHaveLength(8);
    expect(r.scorecardIsNotExecutiveEvaluation).toBe(true);
  });
  it('null 입력은 빈 결과(안전)', () => {
    expect(buildExecutivePortfolioScorecard(null).priorityRows).toHaveLength(0);
  });
});

describe('validatePortfolioReview — Review(Honest Boundary)', () => {
  it('Self-Review 와 Evidence 없는 Review/Decision Reference 를 차단한다', () => {
    const self = validatePortfolioReview({ action: 'record_decision_reference', evidenceCount: 3, isSelfReview: true });
    expect(self.allowed).toBe(false);
    expect(self.blockedReasons.join(' ')).toContain('Self-Review');
    expect(validatePortfolioReview({ action: 'record_review_reference', evidenceCount: 0, isSelfReview: false }).allowed).toBe(false);
  });
  it('요청 액션은 허용하되 humanDecisionRequired 유지', () => {
    const ok = validatePortfolioReview({ action: 'request_executive_review', evidenceCount: null, isSelfReview: true });
    expect(ok.allowed).toBe(true);
    expect(ok.humanDecisionRequired).toBe(true);
    expect(validatePortfolioReview({ action: 'record_decision_reference', evidenceCount: 2, isSelfReview: false }).allowed).toBe(true);
  });
});

describe('buildPortfolioTimeline — 흐름 관측', () => {
  it('12 단계 흐름을 순서대로 반환하고 관측 여부만 표시한다', () => {
    const t = buildPortfolioTimeline({ present: { investment_portfolio: true, portfolio_learning: false } });
    expect(t).toHaveLength(PORTFOLIO_FLOW_STAGES.length);
    expect(t[0].stage).toBe('strategic_objectives');
    expect(t.find((s) => s.stage === 'investment_portfolio')?.present).toBe(true);
    expect(t.find((s) => s.stage === 'portfolio_learning')?.present).toBe(false);
  });
});

describe('ENTERPRISE_PORTFOLIO_SUPPORT_MATRIX — Honest Boundary', () => {
  it('컴포넌트 10종·매트릭스 52항목', () => {
    expect(ENTERPRISE_PORTFOLIO_COMPONENTS).toHaveLength(10);
    expect(ENTERPRISE_PORTFOLIO_SUPPORT_MATRIX).toHaveLength(52);
  });
  it('unavailable 15항목은 전부 automatic_* — 자동 투자 승인/자본 배분 없음', () => {
    const unavailable = ENTERPRISE_PORTFOLIO_SUPPORT_MATRIX.filter((e) => e.support === 'unavailable');
    expect(unavailable).toHaveLength(15);
    for (const e of unavailable) expect(e.capability.startsWith('automatic_')).toBe(true);
  });
  it('Capital Market/Treasury/투자위원회/회계 피드는 insufficient_data 로 정직하게 표시된다', () => {
    const feeds = ENTERPRISE_PORTFOLIO_SUPPORT_MATRIX.filter((e) => e.support === 'insufficient_data');
    expect(feeds.length).toBeGreaterThanOrEqual(6);
    expect(feeds.map((f) => f.capability)).toContain('capital_market_feed');
    expect(feeds.map((f) => f.capability)).toContain('investment_committee_system');
  });
});
