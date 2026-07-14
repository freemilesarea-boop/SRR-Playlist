// Phase AI-OPS-8 — Executive Strategy 순수 로직 단위 테스트.
// ARR 추정(Actual 분리) · 성장률(0 나눗셈 방어) · Churn/LTV(무한 LTV 금지) · CAC(cost_unknown) ·
// Business Risk(재정규화·자동 없음) · Explainable Decision(8요소/표본 방어) · Briefing ·
// Scenario(evidence-only·simulated≠actual) · Support Matrix(자동 금지).
import { describe, it, expect } from 'vitest';
import {
  calculateArrEstimate, calculateGrowthRate, calculateChurnRate, calculateLtvEstimate, calculateCac,
  calculateBusinessRisk, validateExplainableDecision, buildDecisionRecommendation,
  buildDailyBriefing, evaluateBusinessScenario, EXEC_SUPPORT,
  type BusinessRiskComponents, type ExplainableDecision,
} from './executiveStrategy';

const NOW = new Date('2026-07-14T12:00:00Z');

describe('Financial(실측/추정 분리)', () => {
  it('ARR = MRR×12 추정 명시 · MRR 없으면 null', () => {
    const r = calculateArrEstimate(1_000_000);
    expect(r.arr).toBe(12_000_000); expect(r.isEstimate).toBe(true); expect(r.note).toContain('추정');
    expect(calculateArrEstimate(null).arr).toBeNull();
    expect(calculateArrEstimate(NaN).arr).toBeNull();
  });
  it('성장률 — 이전 0/null 나눗셈 방어(null→0 없음)', () => {
    expect(calculateGrowthRate(120, 100)).toBe(20);
    expect(calculateGrowthRate(80, 100)).toBe(-20);
    expect(calculateGrowthRate(100, 0)).toBeNull();
    expect(calculateGrowthRate(null, 100)).toBeNull();
  });
  it('Churn — total 0 방어 · LTV — churn 0 이면 산출 안 함(무한 LTV 금지)', () => {
    expect(calculateChurnRate(5, 100)).toBe(5);
    expect(calculateChurnRate(5, 0)).toBeNull();
    const ltv = calculateLtvEstimate(50_000, 5);
    expect(ltv.ltv).toBe(1_000_000); expect(ltv.isEstimate).toBe(true);
    expect(calculateLtvEstimate(50_000, 0).ltv).toBeNull();
    expect(calculateLtvEstimate(50_000, 0).note).toContain('무한 LTV');
    expect(calculateLtvEstimate(null, 5).ltv).toBeNull();
  });
  it('CAC/Payback — 비용 데이터 없음 cost_unknown', () => {
    const c = calculateCac();
    expect(c.cac).toBeNull(); expect(c.status).toBe('cost_unknown');
  });
});

describe('Business Risk', () => {
  const C = (v: number | null): BusinessRiskComponents => ({ contractExpiryRisk: v, churnRisk: v, usageDeclineRisk: v, storeInactivityRisk: v, revenueDeclineRisk: v, securityRisk: v, operationalRisk: v });
  it('Low~Critical · 재정규화 · 전부 null insufficient · 자동 조치 없음', () => {
    expect(calculateBusinessRisk(C(10)).level).toBe('low');
    expect(calculateBusinessRisk(C(60)).level).toBe('high');
    expect(calculateBusinessRisk(C(90)).level).toBe('critical');
    const partial = calculateBusinessRisk({ ...C(50), securityRisk: null, operationalRisk: null });
    expect(partial.score).toBe(50); expect(partial.missing.length).toBe(2);
    expect(calculateBusinessRisk(C(null)).level).toBe('insufficient_data');
    expect(calculateBusinessRisk(C(90)).noAutoAction).toBe(true);
  });
});

describe('Explainable Decision(8요소)', () => {
  it('Recommendation/Reason/Evidence/Confidence/Alternative/Benefit/Risk 필수', () => {
    const ok: Partial<ExplainableDecision> = { recommendation: 'r', reason: 'why', evidence: [{ label: 'x', value: 1 }], confidence: 60, alternatives: ['a'], expected_benefit: 'b', risk: 'rk' };
    expect(validateExplainableDecision(ok)).toEqual([]);
    expect(validateExplainableDecision({ ...ok, alternatives: [] }).some((e) => e.includes('대안'))).toBe(true);
    expect(validateExplainableDecision({ ...ok, evidence: [] }).some((e) => e.includes('Evidence'))).toBe(true);
    expect(validateExplainableDecision({ ...ok, confidence: 150 }).some((e) => e.includes('0~100'))).toBe(true);
    expect(validateExplainableDecision({ ...ok, risk: undefined }).some((e) => e.includes('Risk'))).toBe(true);
    expect(validateExplainableDecision(null)).toEqual(['decision 없음']);
  });
  it('추천 생성 — 표본 5건 미만/후보 없음이면 생성 안 함 · Human Approval 필수', () => {
    const r = buildDecisionRecommendation({ category: 'target_industry', topCandidate: '카페', metricValue: 80, sampleSize: 20, code: 'd1' });
    expect('insufficient' in r).toBe(false);
    if (!('insufficient' in r)) {
      expect(r.recommendation).toContain('카페');
      expect(r.humanApprovalRequired).toBe(true);
      expect(r.alternatives.length).toBeGreaterThan(0);
      expect(validateExplainableDecision(r)).toEqual([]);
    }
    expect('insufficient' in buildDecisionRecommendation({ category: 'target_brand', topCandidate: 'X', metricValue: 50, sampleSize: 3, code: 'd2' })).toBe(true);
    expect('insufficient' in buildDecisionRecommendation({ category: 'region_focus', topCandidate: null, metricValue: 50, sampleSize: 20, code: 'd3' })).toBe(true);
  });
  it('동일 입력 동일 출력(deterministic)', () => {
    const a = buildDecisionRecommendation({ category: 'contract_renewal', topCandidate: 'A사', metricValue: 60, sampleSize: 10, code: 'd4' });
    const b = buildDecisionRecommendation({ category: 'contract_renewal', topCandidate: 'A사', metricValue: 60, sampleSize: 10, code: 'd4' });
    expect(a).toEqual(b);
  });
});

describe('Daily Briefing / Scenario', () => {
  it('Briefing — 필수 섹션 + 수동 생성/참고 자료 명시 · 전일 0 이면 insufficient', () => {
    const pkg = buildDailyBriefing({ todayRevenue: 120, yesterdayRevenue: 100, newContracts: 2, expiringContracts: 1, activeIncidents: 0, criticalRisks: [], todoItems: ['t'], topRecommendations: ['r'] }, NOW);
    const sections = pkg.map((p) => p.section);
    for (const s of ['어제 대비 성장', '주요 계약', '주요 장애', '주요 위험', '오늘 해야 할 일', 'AI 추천 Top', 'Limitations']) expect(sections).toContain(s);
    expect(pkg.find((p) => p.section === '어제 대비 성장')!.content).toBe('20%');
    expect(JSON.stringify(pkg.find((p) => p.section === 'Limitations')!.content)).toContain('자동 스케줄 미지원');
    const zero = buildDailyBriefing({ todayRevenue: 120, yesterdayRevenue: 0, newContracts: 0, expiringContracts: 0, activeIncidents: 0, criticalRisks: [], todoItems: [], topRecommendations: [] }, NOW);
    expect(String(zero.find((p) => p.section === '어제 대비 성장')!.content)).toContain('insufficient');
  });
  it('Scenario — 매장/기업 증가는 limit 필요 · 실제 적용 없음(simulated≠actual)', () => {
    const r = evaluateBusinessScenario({ scenario: '매장 500개 증가', kind: 'stores', delta: 500 }, { current: 100, capacityLimit: 1000, mrr: 100 });
    expect(r.projected).toBe(600); expect(r.result).toBe('manageable');
    expect(r.evidenceOnly).toBe(true); expect(r.simulatedNotActual).toBe(true);
    expect(evaluateBusinessScenario({ scenario: 'x', kind: 'stores', delta: 950 }, { current: 100, capacityLimit: 1000, mrr: 100 }).result).toBe('critical');
    expect(evaluateBusinessScenario({ scenario: 'x', kind: 'stores', delta: 500 }, { current: 100, capacityLimit: null, mrr: 100 }).result).toBe('insufficient_data'); // limit_unknown
    expect(evaluateBusinessScenario({ scenario: 'x', kind: 'stores', delta: 500 }, { current: null, capacityLimit: 1000, mrr: 100 }).result).toBe('insufficient_data');
  });
  it('서버 비용 2배 — 단가 미입력 시 cost_unknown 표기 · 해지율 증가 시나리오', () => {
    const cost = evaluateBusinessScenario({ scenario: '서버 비용 2배', kind: 'server_cost', multiplier: 2 }, { current: 1, capacityLimit: null, mrr: 100 });
    expect(cost.note).toContain('cost_unknown');
    expect(evaluateBusinessScenario({ scenario: '해지율 35%', kind: 'churn', multiplier: 35 }, { current: 1, capacityLimit: null, mrr: 100 }).result).toBe('critical');
  });
});

describe('Support Matrix', () => {
  it('MRR 실측 · ARR/LTV 추정 · CAC/순이익 cost_unknown · 자동 실행 전부 unsupported', () => {
    expect(EXEC_SUPPORT.find((s) => s.key === 'mrr')!.status).toBe('fully_supported');
    expect(EXEC_SUPPORT.find((s) => s.key === 'arr')!.status).toBe('estimated');
    expect(EXEC_SUPPORT.find((s) => s.key === 'ltv')!.status).toBe('estimated');
    expect(EXEC_SUPPORT.find((s) => s.key === 'net_profit')!.status).toBe('cost_unknown');
    expect(EXEC_SUPPORT.find((s) => s.key === 'cac_payback')!.status).toBe('cost_unknown');
    expect(EXEC_SUPPORT.find((s) => s.key === 'brand_region_growth')!.status).toBe('insufficient_data');
    for (const k of ['auto_contract_change', 'auto_settlement_change', 'auto_pricing_change', 'auto_sales_execution', 'auto_decision', 'production_apply']) {
      expect(EXEC_SUPPORT.find((s) => s.key === k)!.status).toBe('unsupported');
    }
    expect(EXEC_SUPPORT.find((s) => s.key === 'daily_briefing')!.note).toContain('자동 스케줄');
  });
});
