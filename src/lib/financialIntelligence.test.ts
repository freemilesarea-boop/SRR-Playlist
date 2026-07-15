import { describe, expect, it } from 'vitest';
import {
  analyzeCapitalPerformance,
  analyzeCashFlow,
  analyzeCostDistribution,
  assessFinancialRisk,
  assessRoi,
  buildFinancialBriefing,
  buildFinancialCockpit,
  buildFinancialRecommendation,
  classifyFinancialVariance,
  computeMargins,
  FINANCIAL_SUPPORT,
} from './financialIntelligence';

describe('margin — 부분 비용 기반 Proxy', () => {
  it('자료 없음 insufficient, 계산 시 partialCostBasis + Margin ≠ Business Health', () => {
    expect(computeMargins({ revenue: null, knownCosts: 100, costBasisComplete: false }).verdict).toBe('insufficient_data');
    const r = computeMargins({ revenue: 1000, knownCosts: 400, costBasisComplete: false });
    expect(r.grossProxy).toBe(600);
    expect(r.marginPct).toBe(60);
    expect(r.partialCostBasis).toBe(true);
    expect(r.marginIsNotBusinessHealth).toBe(true);
    expect(r.revenueIsNotProfit).toBe(true);
  });
});

describe('cash flow — 부분 실측·Liquidity 보장 아님', () => {
  it('5 segment + 투자/재무 흐름 없으면 financial_unavailable', () => {
    const r = analyzeCashFlow({ inflow: 1000, outflowPartial: 300, investmentFlow: null, financingFlow: null });
    expect(r.netPartial).toBe(700);
    expect(r.verdict).toBe('partial_measured');
    expect(r.segments).toHaveLength(5);
    expect(r.segments.find((s) => s.key === 'investment_cash_flow')?.status).toBe('financial_unavailable');
    expect(r.cashFlowIsNotLiquidityGuarantee).toBe(true);
    expect(r.notAccountingLedger).toBe(true);
    expect(analyzeCashFlow({ inflow: null, outflowPartial: 300, investmentFlow: null, financingFlow: null }).verdict).toBe('insufficient_data');
  });
});

describe('capital / cost', () => {
  it('capital: Evidence 없으면 financial_unverified, 계산 시 notInvestmentDecision', () => {
    expect(analyzeCapitalPerformance({ allocated: 100, utilized: 50, evidence: [] }).verdict).toBe('financial_unverified');
    expect(analyzeCapitalPerformance({ allocated: null, utilized: 50, evidence: ['e'] }).verdict).toBe('insufficient_data');
    const r = analyzeCapitalPerformance({ allocated: 100, utilized: 60, evidence: ['record'] });
    expect(r.utilizationPct).toBe(60);
    expect(r.notInvestmentDecision).toBe(true);
  });
  it('cost distribution: null 제외 + actual/estimated 구분', () => {
    const r = analyzeCostDistribution([
      { category: 'supabase', amount: 60, kind: 'actual' },
      { category: 'vercel', amount: 40, kind: 'estimated' },
      { category: 'licensing', amount: null, kind: 'actual' },   // null 제외(0 변환 금지)
    ]);
    expect(r.totalKnown).toBe(100);
    expect(r.excludedNull).toBe(1);
    expect(r.shares[0].sharePct).toBe(60);
    expect(r.estimatedIncluded).toBe(true);
    expect(analyzeCostDistribution([]).verdict).toBe('insufficient_data');
  });
});

describe('variance — 4상태만 + 비용 방향', () => {
  it('자료 없음 unknown, 비용 지표는 예산 미만이 positive', () => {
    expect(classifyFinancialVariance({ actual: null, budget: 100 }).verdict).toBe('variance_unknown');
    expect(classifyFinancialVariance({ actual: 102, budget: 100 }).verdict).toBe('neutral');
    expect(classifyFinancialVariance({ actual: 130, budget: 100 }).verdict).toBe('positive');
    expect(classifyFinancialVariance({ actual: 70, budget: 100, costMetric: true }).verdict).toBe('positive');
    expect(classifyFinancialVariance({ actual: 130, budget: 100, costMetric: true }).verdict).toBe('negative');
  });
});

describe('roi — Evidence 기반만·표본 방어', () => {
  it('Evidence 없음 financial_unverified, 표본<5 sample_too_small, ROI ≠ Investment Success', () => {
    expect(assessRoi({ target: 'feature', investment: 100, returnValue: 150, evidence: [], sample: 10 }).verdict).toBe('financial_unverified');
    expect(assessRoi({ target: 'feature', investment: null, returnValue: 150, evidence: ['e'], sample: 10 }).verdict).toBe('insufficient_data');
    expect(assessRoi({ target: 'feature', investment: 100, returnValue: 150, evidence: ['e'], sample: 3 }).verdict).toBe('sample_too_small');
    const r = assessRoi({ target: 'feature', investment: 100, returnValue: 150, evidence: ['records'], sample: 10 });
    expect(r.roiPct).toBe(50);
    expect(r.roiIsNotInvestmentSuccess).toBe(true);
  });
});

describe('risk — Low/Medium/High/Unknown 만', () => {
  it('Evidence 없음 unknown+unverified, 임계값 분류, lowerIsRiskier 반영', () => {
    expect(assessFinancialRisk({ kind: 'cash_flow_risk', signal: 90, highThreshold: 80, mediumThreshold: 50, evidence: [] }).level).toBe('unknown');
    expect(assessFinancialRisk({ kind: 'bogus_risk', signal: 90, highThreshold: 80, mediumThreshold: 50, evidence: ['e'] }).verdict).toBe('financial_unverified');
    expect(assessFinancialRisk({ kind: 'cost_growth_risk', signal: 90, highThreshold: 80, mediumThreshold: 50, evidence: ['e'] }).level).toBe('high');
    expect(assessFinancialRisk({ kind: 'cost_growth_risk', signal: 60, highThreshold: 80, mediumThreshold: 50, evidence: ['e'] }).level).toBe('medium');
    expect(assessFinancialRisk({ kind: 'cost_growth_risk', signal: 10, highThreshold: 80, mediumThreshold: 50, evidence: ['e'] }).level).toBe('low');
    expect(assessFinancialRisk({ kind: 'liquidity_risk', signal: null, highThreshold: 80, mediumThreshold: 50, evidence: ['e'] }).level).toBe('unknown');
    // lowerIsRiskier: 잔여 개월 수가 적을수록 위험
    expect(assessFinancialRisk({ kind: 'burn_rate_risk', signal: 2, highThreshold: 3, mediumThreshold: 6, lowerIsRiskier: true, evidence: ['e'] }).level).toBe('high');
    expect(assessFinancialRisk({ kind: 'burn_rate_risk', signal: 12, highThreshold: 3, mediumThreshold: 6, lowerIsRiskier: true, evidence: ['e'] }).level).toBe('low');
  });
});

describe('briefing / recommendation / cockpit / support', () => {
  it('briefing: 5섹션 + 자동 발송 없음 + period whitelist', () => {
    const r = buildFinancialBriefing({ periodKind: 'monthly', revenueChanges: ['+5%'], costChanges: [], risks: ['r'], opportunities: [], unknownFactors: ['u'] });
    expect(r.valid).toBe(true);
    expect(r.sections).toHaveLength(5);
    expect(r.autoSendDisabled).toBe(true);
    expect(buildFinancialBriefing({ periodKind: 'hourly', revenueChanges: [], costChanges: [], risks: [], opportunities: [], unknownFactors: [] }).valid).toBe(false);
  });
  it('recommendation: whitelist + Evidence 필수 + ≠ Financial Decision', () => {
    expect('rejected' in buildFinancialRecommendation({ type: 'approve_budget', reason: 'x', evidence: ['e'], confidence: null, assumptions: [] })).toBe(true);
    expect('rejected' in buildFinancialRecommendation({ type: 'review_cost', reason: 'x', evidence: [], confidence: null, assumptions: [] })).toBe(true);
    const r = buildFinancialRecommendation({ type: 'review_cash_flow', reason: '부분 Outflow 상승', evidence: ['timeline'], confidence: 40, assumptions: ['a'] });
    if ('humanApprovalRequired' in r) {
      expect(r.humanApprovalRequired).toBe(true);
      expect(r.approvalImplied).toBe(false);
      expect(r.limitations).toContain('Recommendation ≠ Financial Decision');
    }
  });
  it('cockpit: 9영역 + humanDecisionRequired', () => {
    const r = buildFinancialCockpit({ revenue30d: 100000, netPartial: 70000, marginPct: null, costCategories: 3, roiAssessed: 1, trendsAnalyzed: 4, risksHigh: 0, recommendationsOpen: 2, summaryNote: null });
    expect(r.sections).toHaveLength(9);
    expect(r.humanDecisionRequired).toBe(true);
    expect(r.sections.find((s) => s.key === 'margin')?.headline).toBe('insufficient_data');
    expect(r.sections.find((s) => s.key === 'financial_risk')?.detail).toContain('Risk ≠ Failure');
  });
  it('FINANCIAL_SUPPORT: 16항목 + EBITDA/Cash Position/자동 회계 unsupported', () => {
    expect(FINANCIAL_SUPPORT).toHaveLength(16);
    for (const key of ['ebitda', 'cash_position', 'investment_financing_cash_flow', 'auto_accounting_change']) {
      expect(FINANCIAL_SUPPORT.find((s) => s.key === key)?.status).toBe('unsupported');
    }
  });
});
