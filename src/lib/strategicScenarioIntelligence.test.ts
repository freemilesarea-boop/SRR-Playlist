// Phase AI-OPS-13 — Strategic Scenario/Portfolio 순수 로직 단위 테스트.
// Objective(미존재 type 차단) · Assumption(unverified → 신뢰 제한) · Constraint(Hard 우선·capacity_unknown) ·
// Scenario 입력(stale/cost/resource) · Forecast(범위·baseline 없음 투영 금지·capacity 상한·실제 미래 아님) ·
// Stress(고정 수치 강제 금지) · Sensitivity(NaN 방어) · Break-even(가짜 생성 금지) · Unit Economics(추정 분리) ·
// Portfolio(Hard/상호 배타/의존/총량) · Allocation(총량/Reserve/중복) · EV(억지 환산 금지) ·
// Risk-adjusted("최적" 금지) · Trade-off · Opportunity Cost · Concentration · 완결성(낙관만 금지) · 권고 · Support.
import { describe, it, expect } from 'vitest';
import {
  validateStrategicObjective, classifyAssumptionVerification, evaluateConstraintStatus,
  classifyScenarioInput, calculateScenarioForecast, calculateForecastReliability,
  runStressScenario, calculateSensitivity, calculateBreakEven, calculateUnitEconomics,
  evaluatePortfolioFeasibility, validateResourceAllocation, detectDoubleAllocation,
  calculateExpectedValue, calculateRiskAdjustedComparison, evaluateTradeoff, calculateOpportunityCost,
  calculateConcentrationRisk, calculateStrategicOptionValue, checkScenarioCompleteness,
  buildStrategicRecommendation, STRAT_SUPPORT,
  type InitiativeInput,
} from './strategicScenarioIntelligence';

describe('Objective / Assumption', () => {
  it('type whitelist·title/evidence 필수 · target 없음은 오류 아님(insufficient 처리)', () => {
    expect(validateStrategicObjective({ type: 'revenue_growth', title: 't', evidence: [1] })).toEqual([]);
    expect(validateStrategicObjective({ type: 'auto_execute', title: 't', evidence: [1] }).some((e) => e.includes('type'))).toBe(true);
    expect(validateStrategicObjective({ type: 'manual', title: ' ', evidence: [] }).length).toBe(2);
    expect(validateStrategicObjective({ type: 'store_growth', title: 't', targetValue: NaN, evidence: [1] }).some((e) => e.includes('NaN'))).toBe(true);
    expect(validateStrategicObjective(null)).toEqual(['objective 없음']);
  });
  it('Unverified 비중 → Forecast 신뢰 제한', () => {
    expect(classifyAssumptionVerification([]).unverifiedRatio).toBeNull();
    const r = classifyAssumptionVerification([
      { verification: 'verified_by_internal_data' }, { verification: 'unverified' }, { verification: 'external_reference_only' },
    ]);
    expect(r.unverifiedRatio).toBe(67);
    expect(r.note).toContain('신뢰 제한');
  });
});

describe('Constraint(Hard 우선)', () => {
  it('satisfied/violated/hard_violated/capacity_unknown', () => {
    expect(evaluateConstraintStatus({ current: 50, min: 10, max: 100, hard: false })).toBe('satisfied');
    expect(evaluateConstraintStatus({ current: 150, min: null, max: 100, hard: false })).toBe('violated');
    expect(evaluateConstraintStatus({ current: 150, min: null, max: 100, hard: true })).toBe('hard_constraint_violated');
    expect(evaluateConstraintStatus({ current: null, min: 10, max: 100, hard: true })).toBe('capacity_unknown');
  });
});

describe('Scenario 입력 / Forecast', () => {
  const base = { hasObjective: true, assumptionCount: 3, constraintCount: 2, hasBaseline: true, hasCostData: true, hasCapacityData: true, inputAgeDays: 10 };
  it('입력 검증 — valid/stale/cost_unknown/resource_unknown/invalid', () => {
    expect(classifyScenarioInput(base).verdict).toBe('valid');
    expect(classifyScenarioInput({ ...base, inputAgeDays: 120 }).verdict).toBe('stale_input_candidate');
    expect(classifyScenarioInput({ ...base, hasCostData: false }).verdict).toBe('cost_unknown');
    expect(classifyScenarioInput({ ...base, hasCapacityData: false }).verdict).toBe('resource_capacity_unknown');
    expect(classifyScenarioInput({ ...base, hasBaseline: false }).verdict).toBe('partially_valid');
    expect(classifyScenarioInput({ ...base, hasObjective: false }).verdict).toBe('invalid');
    expect(classifyScenarioInput({ ...base, assumptionCount: 0 }).verdict).toBe('insufficient_data');
  });
  it('Forecast — 범위 포함·baseline/성장 가정 없으면 투영 금지·capacity 상한·실제 미래 아님', () => {
    const r = calculateScenarioForecast({ metric: 'mrr', baseline: 1000, growthRatePct: 10, horizonDays: 90 });
    expect(r.expected).toBe(1331); expect(r.low).not.toBeNull(); expect(r.high).not.toBeNull();
    expect(r.low! < r.expected! && r.expected! < r.high!).toBe(true);
    expect(r.notActualFuture).toBe(true);
    expect(calculateScenarioForecast({ metric: 'x', baseline: null, growthRatePct: 10, horizonDays: 90 }).method).toBe('unsupported');
    expect(calculateScenarioForecast({ metric: 'x', baseline: 100, growthRatePct: null, horizonDays: 90 }).unknownFactors.join(' ')).toContain('연장 금지');
    const capped = calculateScenarioForecast({ metric: 'stores', baseline: 100, growthRatePct: 50, horizonDays: 365, capacityLimit: 200 });
    expect(capped.expected).toBe(200); expect(capped.method).toBe('capacity_bounded_projection');
    // 장기 horizon → confidence 하락
    const short = calculateScenarioForecast({ metric: 'x', baseline: 100, growthRatePct: 5, horizonDays: 30, unverifiedRatio: 0 });
    const long = calculateScenarioForecast({ metric: 'x', baseline: 100, growthRatePct: 5, horizonDays: 1095, unverifiedRatio: 0 });
    expect(long.confidence!).toBeLessThan(short.confidence!);
  });
  it('Reliability — 재정규화·High ≠ 보장·전부 null insufficient', () => {
    const hi = calculateForecastReliability({ inputCoverage: 90, inputFreshness: 90, assumptionVerification: 90, historicalSample: 10, contextMatch: 90, unknownVariableRatio: 10 });
    expect(hi.reliability).toBe('high_confidence_reference'); expect(hi.note).toContain('보장');
    expect(calculateForecastReliability({ inputCoverage: 10, inputFreshness: 10, assumptionVerification: 10, historicalSample: 0, contextMatch: 10, unknownVariableRatio: 90 }).reliability).toBe('forecast_unreliable');
    expect(calculateForecastReliability({ inputCoverage: null, inputFreshness: null, assumptionVerification: null, historicalSample: null, contextMatch: null, unknownVariableRatio: null }).reliability).toBe('insufficient_data');
  });
});

describe('Stress / Sensitivity', () => {
  it('Stress — evidence 없으면 강제 금지 · 투영 ≠ 발생 확률', () => {
    expect(runStressScenario({ baseline: 100, shockPct: -20, evidenceBased: true }).stressed).toBe(80);
    expect(runStressScenario({ baseline: 100, shockPct: -20, evidenceBased: false }).verdict).toBe('insufficient_data');
    expect(runStressScenario({ baseline: null, shockPct: -20, evidenceBased: true }).verdict).toBe('insufficient_data');
  });
  it('Sensitivity — elasticity·NaN/0 방어', () => {
    expect(calculateSensitivity({ variable: 'price', baseOutput: 100, shockedOutput: 130, shockPct: 10 }).verdict).toBe('critical_sensitivity');
    expect(calculateSensitivity({ variable: 'churn', baseOutput: 100, shockedOutput: 105, shockPct: 10 }).verdict).toBe('moderate_sensitivity');
    expect(calculateSensitivity({ variable: 'x', baseOutput: 100, shockedOutput: 101, shockPct: 10 }).verdict).toBe('low_sensitivity');
    expect(calculateSensitivity({ variable: 'x', baseOutput: 0, shockedOutput: 10, shockPct: 10 }).verdict).toBe('insufficient_data');
    expect(calculateSensitivity({ variable: 'x', baseOutput: null, shockedOutput: 10, shockPct: 10 }).elasticity).toBeNull();
  });
});

describe('Break-even / Unit Economics(가짜 수치 금지)', () => {
  it('정상 계산 · 비용 없음 cost_unknown · contribution ≤ 0', () => {
    expect(calculateBreakEven({ fixedCost: 1000, unitRevenue: 50, unitVariableCost: 30 }).requiredUnits).toBe(50);
    expect(calculateBreakEven({ fixedCost: null, unitRevenue: 50, unitVariableCost: 30 }).status).toBe('cost_unknown');
    expect(calculateBreakEven({ fixedCost: 1000, unitRevenue: null, unitVariableCost: 30 }).status).toBe('insufficient_data');
    expect(calculateBreakEven({ fixedCost: 1000, unitRevenue: 30, unitVariableCost: 50 }).status).toBe('unit_economics_unavailable');
  });
  it('Unit Economics — 인건비/마케팅비 없으면 완전한 마진/CAC 아님', () => {
    const r = calculateUnitEconomics({ revenue: 10000, units: 10, infraCost: 2000, laborCost: null, marketingCost: null });
    expect(r.revenuePerUnit).toBe(1000); expect(r.infraCostPerUnit).toBe(200);
    expect(r.grossMarginNote).toContain('cost_unknown'); expect(r.cacNote).toContain('임의 생성 금지');
    expect(r.isEstimate).toBe(true);
    expect(calculateUnitEconomics({ revenue: 100, units: 0, infraCost: null, laborCost: null, marketingCost: null }).revenuePerUnit).toBeNull();
  });
});

describe('Portfolio Feasibility(Hard/상호 배타/의존/총량)', () => {
  const I = (code: string, over: Partial<InitiativeInput> = {}): InitiativeInput => ({ code, requiredBudget: 100, dependencies: [], exclusionGroup: null, costKnown: true, ...over });
  it('feasible/hard 위반/상호 배타/의존 누락/총량 초과/비용 미상', () => {
    expect(evaluatePortfolioFeasibility({ initiatives: [I('a'), I('b')], totalBudget: 500, hardConstraintViolated: false }).status).toBe('feasible_reference');
    expect(evaluatePortfolioFeasibility({ initiatives: [I('a')], totalBudget: 500, hardConstraintViolated: true }).status).toBe('hard_constraint_violated');
    expect(evaluatePortfolioFeasibility({ initiatives: [I('a', { exclusionGroup: 'g' }), I('b', { exclusionGroup: 'g' })], totalBudget: 500, hardConstraintViolated: false }).status).toBe('mutually_exclusive_conflict');
    expect(evaluatePortfolioFeasibility({ initiatives: [I('a', { dependencies: ['ghost'] })], totalBudget: 500, hardConstraintViolated: false }).status).toBe('dependency_unverified');
    expect(evaluatePortfolioFeasibility({ initiatives: [I('a'), I('b'), I('c')], totalBudget: 250, hardConstraintViolated: false }).status).toBe('infeasible');
    expect(evaluatePortfolioFeasibility({ initiatives: [I('a', { costKnown: false })], totalBudget: 500, hardConstraintViolated: false }).status).toBe('cost_unknown');
    expect(evaluatePortfolioFeasibility({ initiatives: [I('a')], totalBudget: null, hardConstraintViolated: false }).status).toBe('resource_capacity_unknown');
    expect(evaluatePortfolioFeasibility({ initiatives: [], totalBudget: 500, hardConstraintViolated: false }).status).toBe('insufficient_data');
  });
});

describe('Allocation(총량/Reserve/중복 방어 — 실제 예산 미변경)', () => {
  it('정상/총량 초과/Reserve 침범/중복/음수/총량 미확인', () => {
    expect(validateResourceAllocation({ available: 1000, reserve: 100, items: [{ code: 'a', amount: 400 }, { code: 'b', amount: 400 }] }).status).toBe('ready_for_human_review');
    expect(validateResourceAllocation({ available: 1000, reserve: null, items: [{ code: 'a', amount: 1200 }] }).status).toBe('over_allocated');
    expect(validateResourceAllocation({ available: 1000, reserve: 200, items: [{ code: 'a', amount: 900 }] }).status).toBe('reserve_violated');
    expect(validateResourceAllocation({ available: 1000, reserve: null, items: [{ code: 'a', amount: 100 }, { code: 'a', amount: 100 }] }).status).toBe('double_allocation_detected');
    expect(validateResourceAllocation({ available: 1000, reserve: null, items: [{ code: 'a', amount: -5 }] }).status).toBe('insufficient_data');
    expect(validateResourceAllocation({ available: null, reserve: null, items: [{ code: 'a', amount: 100 }] }).status).toBe('resource_capacity_unknown');
  });
  it('후보 간 중복 배정 감지', () => {
    const r = detectDoubleAllocation([
      { code: 'c1', items: [{ code: 'init_a' }] },
      { code: 'c2', items: [{ code: 'init_a' }, { code: 'init_b' }] },
    ]);
    expect(r.length).toBe(1); expect(r[0].initiative).toBe('init_a'); expect(r[0].candidates).toEqual(['c1', 'c2']);
  });
});

describe('EV / Risk-adjusted / Trade-off / Opportunity Cost', () => {
  it('EV — 금전/비금전 분리 · 억지 환산 금지 · 실제 수익 아님', () => {
    const r = calculateExpectedValue({ revenueBenefit: 1000, costSaving: 500, riskReductionScore: 40, nonFinancialNote: '학습 가치' });
    expect(r.monetary).toBe(1500); expect(r.nonMonetary.length).toBe(2);
    expect(r.nonMonetary[0]).toContain('환산 안 함'); expect(r.notActualReturn).toBe(true);
    expect(calculateExpectedValue({ revenueBenefit: null, costSaving: null, riskReductionScore: 40, nonFinancialNote: null }).monetary).toBeNull();
  });
  it('Risk-adjusted — infeasible/저근거/고위험/favorable("최적" 금지)', () => {
    expect(calculateRiskAdjustedComparison({ expectedValue: 100, expectedCost: 10, downsideExposure: 5, confidence: 80, feasible: false, evidenceCount: 5 }).verdict).toBe('infeasible');
    expect(calculateRiskAdjustedComparison({ expectedValue: 100, expectedCost: 10, downsideExposure: 5, confidence: 80, feasible: true, evidenceCount: 1 }).verdict).toBe('low_evidence_candidate');
    expect(calculateRiskAdjustedComparison({ expectedValue: 100, expectedCost: 10, downsideExposure: 500, confidence: 80, feasible: true, evidenceCount: 5 }).verdict).toBe('high_risk_candidate');
    const fav = calculateRiskAdjustedComparison({ expectedValue: 100, expectedCost: 10, downsideExposure: 5, confidence: 80, feasible: true, evidenceCount: 5 });
    expect(fav.verdict).toBe('favorable_candidate'); expect(fav.note).toContain('최적');
    expect(calculateRiskAdjustedComparison({ expectedValue: null, expectedCost: 10, downsideExposure: 5, confidence: 80, feasible: true, evidenceCount: 5 }).verdict).toBe('insufficient_data');
  });
  it('Trade-off — favorable/acceptable/difficult/unacceptable', () => {
    expect(evaluateTradeoff({ axis: 'growth_vs_cost', gain: 100, loss: 20, hardLimitBreached: false }).verdict).toBe('favorable_tradeoff');
    expect(evaluateTradeoff({ axis: 'x', gain: 100, loss: 80, hardLimitBreached: false }).verdict).toBe('acceptable_tradeoff');
    expect(evaluateTradeoff({ axis: 'x', gain: 50, loss: 100, hardLimitBreached: false }).verdict).toBe('difficult_tradeoff');
    expect(evaluateTradeoff({ axis: 'personalization_vs_privacy', gain: 100, loss: 1, hardLimitBreached: true }).verdict).toBe('unacceptable_tradeoff');
    expect(evaluateTradeoff({ axis: 'x', gain: null, loss: 1, hardLimitBreached: false }).verdict).toBe('insufficient_data');
  });
  it('Opportunity Cost — 정량 없으면 수치 미생성', () => {
    expect(calculateOpportunityCost({ chosen: 'a', foregone: ['b'], foregoneValue: 500 }).quantified).toBe(500);
    const noQ = calculateOpportunityCost({ chosen: 'a', foregone: ['b', 'c'], foregoneValue: null });
    expect(noQ.quantified).toBeNull(); expect(noQ.note).toContain('임의 수치 생성 금지');
  });
});

describe('Concentration / Option Value / 완결성', () => {
  it('집중도 — diversified~critical · 데이터 없으면 insufficient', () => {
    const r = calculateConcentrationRisk([
      { axis: 'enterprise', topSharePct: 85 }, { axis: 'industry', topSharePct: 50 },
      { axis: 'provider', topSharePct: 30 }, { axis: 'region', topSharePct: null },
    ]);
    expect(r[0].verdict).toBe('critical_concentration');
    expect(r[1].verdict).toBe('moderate_concentration');
    expect(r[2].verdict).toBe('diversified_reference');
    expect(r[3].verdict).toBe('insufficient_data');
  });
  it('Option Value — 정량 없으면 qualitative_reference', () => {
    expect(calculateStrategicOptionValue({ reversibility: 'reversible', learningValue: true, dependencyReduction: false, quantifiedValue: null }).verdict).toBe('qualitative_reference');
    expect(calculateStrategicOptionValue({ reversibility: 'reversible', learningValue: false, dependencyReduction: false, quantifiedValue: 100 }).verdict).toBe('quantified_reference');
    expect(calculateStrategicOptionValue({ reversibility: 'unknown', learningValue: false, dependencyReduction: false, quantifiedValue: null }).verdict).toBe('insufficient_data');
  });
  it('완결성 — Downside/Stress 없이 낙관만 제시 금지', () => {
    expect(checkScenarioCompleteness(['base_case', 'downside_case', 'stress_case', 'no_action_case']).complete).toBe(true);
    const r = checkScenarioCompleteness(['base_case', 'upside_case']);
    expect(r.complete).toBe(false);
    expect(r.missing).toContain('downside_case'); expect(r.missing).toContain('stress_case');
  });
});

describe('Recommendation / Support', () => {
  it('권고 — Evidence 없으면 생성 금지 · Human Approval · 결정적', () => {
    const ok = buildStrategicRecommendation({ code: 's1', recType: 'run_downside_scenario', finding: 'downside 미작성 시나리오 2건', evidenceCount: 2, severity: 'high' });
    if ('insufficient' in ok) throw new Error('unexpected');
    expect(ok.humanApprovalRequired).toBe(true); expect(ok.noAutoExecution).toBe(true);
    expect(ok.recommendation).toContain('최적');
    expect(ok.preconditions).toContain('Human Approval');
    expect('insufficient' in buildStrategicRecommendation({ code: 's2', recType: 'run_downside_scenario', finding: 'x', evidenceCount: 0 })).toBe(true);
    expect('insufficient' in buildStrategicRecommendation({ code: 's3', recType: 'execute_budget' as never, finding: 'x', evidenceCount: 3 })).toBe(true);
    expect(ok).toEqual(buildStrategicRecommendation({ code: 's1', recType: 'run_downside_scenario', finding: 'downside 미작성 시나리오 2건', evidenceCount: 2, severity: 'high' }));
  });
  it('Support Matrix — 시장/인력 데이터 정직 표기 · 자동 실행 전부 unsupported', () => {
    expect(STRAT_SUPPORT.find((s) => s.key === 'market_data')!.status).toBe('market_data_unavailable');
    expect(STRAT_SUPPORT.find((s) => s.key === 'labor_capacity')!.status).toBe('resource_capacity_unknown');
    expect(STRAT_SUPPORT.find((s) => s.key === 'break_even')!.status).toBe('cost_unknown');
    expect(STRAT_SUPPORT.find((s) => s.key === 'portfolio_solver')!.status).toBe('unsupported');
    for (const k of ['auto_budget', 'auto_people', 'auto_commercial', 'auto_infra', 'auto_ai', 'production_apply']) {
      expect(STRAT_SUPPORT.find((s) => s.key === k)!.status).toBe('unsupported');
    }
  });
});
