/**
 * strategicScenarioIntelligence — 전략 시나리오/포트폴리오/자원 배분 순수 로직 (Phase AI-OPS-13).
 *
 * Objective → Assumption/Constraint → Scenario(Base/Upside/Downside/Stress/No-action) →
 * Forecast(범위·신뢰도) → Sensitivity/Break-even/Unit Economics → Initiative → Portfolio →
 * Allocation(총량/Reserve/중복 방어) → Expected Value → Risk-adjusted → Trade-off →
 * Opportunity Cost → Concentration → Recommendation.
 *
 * 전략 정직성(전부 코드로 강제):
 *  - Forecast ≠ 실제 미래(모든 결과에 notActualFuture). 실측/추정 분리.
 *  - 비용 없으면 cost_unknown(가짜 break-even/CAC/마진 생성 금지). 시장 데이터 없으면 market_data_unavailable.
 *  - Hard Constraint 위반 → feasible 금지. 총량 초과/중복 배정/상호 배타 충돌 생성 금지.
 *  - Downside/Stress 없이 낙관만 제시 금지(비교 completeness 검사). "최적" 단정 금지.
 *  - deterministic · pure · null 안전 · NaN/Infinity 방어 · Date 주입 · Production 변경 없음.
 */
import { isFiniteNumber, clampScore, normalizeAvailableComponents } from './aiMemory';

/* ── 타입 ─────────────────────────────────────────────────────────────── */
export type AssumptionVerification = 'verified_by_internal_data' | 'partially_verified' | 'external_reference_only' | 'unverified' | 'stale_candidate' | 'conflicting' | 'unsupported' | 'insufficient_data';
export type ConstraintVerdict = 'satisfied' | 'partially_satisfied' | 'violated' | 'hard_constraint_violated' | 'capacity_unknown' | 'evidence_unverified' | 'insufficient_data';
export type ScenarioType = 'base_case' | 'upside_case' | 'downside_case' | 'stress_case' | 'conservative_case' | 'aggressive_case' | 'alternative_case' | 'no_action_case' | 'custom';
export type ForecastReliability = 'high_confidence_reference' | 'moderate_confidence_reference' | 'low_confidence_reference' | 'forecast_unreliable' | 'insufficient_data';
export type FeasibilityStatus = 'feasible_reference' | 'partially_feasible' | 'hard_constraint_violated' | 'dependency_unverified' | 'resource_capacity_unknown' | 'cost_unknown' | 'mutually_exclusive_conflict' | 'infeasible' | 'insufficient_data';
export type RiskAdjustedVerdict = 'favorable_candidate' | 'balanced_candidate' | 'high_risk_candidate' | 'low_evidence_candidate' | 'infeasible' | 'insufficient_data';
export type TradeoffVerdict = 'favorable_tradeoff' | 'acceptable_tradeoff' | 'difficult_tradeoff' | 'unacceptable_tradeoff' | 'insufficient_data';
export type ConcentrationVerdict = 'diversified_reference' | 'moderate_concentration' | 'high_concentration' | 'critical_concentration' | 'insufficient_data';
export type SensitivityVerdict = 'low_sensitivity' | 'moderate_sensitivity' | 'high_sensitivity' | 'critical_sensitivity' | 'insufficient_data';

/* ── Objective / Assumption 검증 ─────────────────────────────────────── */
export const OBJECTIVE_TYPES = ['revenue_growth', 'mrr_growth', 'enterprise_growth', 'store_growth', 'artist_growth', 'retention_improvement', 'churn_reduction', 'contract_renewal', 'margin_improvement', 'cost_reduction', 'capacity_expansion', 'reliability_improvement', 'security_risk_reduction', 'operational_efficiency', 'playlist_performance', 'market_expansion', 'product_expansion', 'strategic_partnership', 'governance_improvement', 'resilience_improvement', 'manual'] as const;

export function validateStrategicObjective(o: { type?: string; title?: string | null; targetValue?: number | null; baselineValue?: number | null; evidence?: unknown[] | null } | null): string[] {
  if (!o) return ['objective 없음'];
  const errors: string[] = [];
  if (!o.type || !(OBJECTIVE_TYPES as readonly string[]).includes(o.type)) errors.push('허용되지 않는 objective type');
  if (!o.title?.trim()) errors.push('title 필수');
  if (!o.evidence?.length) errors.push('Evidence 필수');
  if (o.targetValue != null && !isFiniteNumber(o.targetValue)) errors.push('target NaN/Infinity 금지');
  return errors;   // target/baseline 없음은 오류 아님 — 이후 판정에서 insufficient 처리
}

/** Unverified Assumption 비중 → Forecast 신뢰 제한 근거. */
export function classifyAssumptionVerification(assumptions: { verification: AssumptionVerification }[]): { unverifiedRatio: number | null; note: string } {
  if (!assumptions.length) return { unverifiedRatio: null, note: '가정 없음 — insufficient_data' };
  const unverified = assumptions.filter((a) => !['verified_by_internal_data', 'partially_verified'].includes(a.verification)).length;
  const ratio = Math.round((unverified / assumptions.length) * 100);
  return { unverifiedRatio: ratio, note: ratio > 50 ? 'Unverified 비중 높음 — Forecast 신뢰 제한' : '가정 검증 상태 양호(검증 ≠ 보장)' };
}

/* ── Constraint 평가(Hard 우선) ──────────────────────────────────────── */
export function evaluateConstraintStatus(c: { current: number | null; min: number | null; max: number | null; hard: boolean }): ConstraintVerdict {
  if (!isFiniteNumber(c.current)) return 'capacity_unknown';   // 총량 미확인 — 임의 추정 금지
  const minOk = !isFiniteNumber(c.min) || c.current >= c.min;
  const maxOk = !isFiniteNumber(c.max) || c.current <= c.max;
  if (minOk && maxOk) return 'satisfied';
  return c.hard ? 'hard_constraint_violated' : 'violated';
}

/* ── Scenario 입력 검증 ──────────────────────────────────────────────── */
export type ScenarioInputVerdict = 'valid' | 'partially_valid' | 'cost_unknown' | 'resource_capacity_unknown' | 'dependency_unverified' | 'stale_input_candidate' | 'invalid' | 'insufficient_data';

export function classifyScenarioInput(i: {
  hasObjective: boolean; assumptionCount: number; constraintCount: number; hasBaseline: boolean;
  hasCostData: boolean; hasCapacityData: boolean; inputAgeDays: number | null;
}): { verdict: ScenarioInputVerdict; notes: string[] } {
  const notes: string[] = [];
  if (!i.hasObjective) return { verdict: 'invalid', notes: ['Objective 없음'] };
  if (i.assumptionCount === 0) return { verdict: 'insufficient_data', notes: ['Assumption 없음'] };
  if (isFiniteNumber(i.inputAgeDays) && i.inputAgeDays > 90) { notes.push('입력 90일 초과'); return { verdict: 'stale_input_candidate', notes }; }
  if (!i.hasCostData) { notes.push('비용 데이터 없음'); return { verdict: 'cost_unknown', notes }; }
  if (!i.hasCapacityData) { notes.push('용량 데이터 없음'); return { verdict: 'resource_capacity_unknown', notes }; }
  if (!i.hasBaseline || i.constraintCount === 0) { notes.push(!i.hasBaseline ? 'baseline 없음' : 'constraint 없음'); return { verdict: 'partially_valid', notes }; }
  return { verdict: 'valid', notes };
}

/* ── Forecast(범위 포함 — 실제 미래 아님) ────────────────────────────── */
export interface ForecastResult {
  metric: string; baseline: number | null; expected: number | null; low: number | null; high: number | null;
  unit: string; horizonDays: number; method: 'deterministic_projection' | 'historical_trend' | 'scenario_multiplier' | 'capacity_bounded_projection' | 'manual_assumption' | 'unsupported';
  confidence: number | null; unknownFactors: string[]; notActualFuture: true;
}

/** 결정적 시나리오 투영 — baseline × (1 + 성장 가정), 범위는 가정 신뢰도 기반. ML 미사용. */
export function calculateScenarioForecast(i: {
  metric: string; baseline: number | null; growthRatePct: number | null; horizonDays: number;
  unit?: string; capacityLimit?: number | null; unverifiedRatio?: number | null;
}): ForecastResult {
  const base: Omit<ForecastResult, 'expected' | 'low' | 'high' | 'method' | 'confidence'> = {
    metric: i.metric, baseline: isFiniteNumber(i.baseline) ? i.baseline : null,
    unit: i.unit ?? 'count', horizonDays: i.horizonDays,
    unknownFactors: [], notActualFuture: true,
  };
  if (!isFiniteNumber(i.baseline)) return { ...base, expected: null, low: null, high: null, method: 'unsupported', confidence: null, unknownFactors: ['baseline 없음 — 투영 금지'] };
  if (!isFiniteNumber(i.growthRatePct)) return { ...base, expected: null, low: null, high: null, method: 'unsupported', confidence: null, unknownFactors: ['성장 가정 없음 — 과거 연장 금지'] };
  const periods = Math.max(1, Math.round(i.horizonDays / 30));
  let expected = i.baseline * Math.pow(1 + i.growthRatePct / 100, periods);
  let method: ForecastResult['method'] = 'scenario_multiplier';
  const unknownFactors = ['가정 기반 투영 — 실제 미래 아님'];
  if (isFiniteNumber(i.capacityLimit) && expected > i.capacityLimit) {
    expected = i.capacityLimit; method = 'capacity_bounded_projection';
    unknownFactors.push('capacity 상한 적용');
  }
  const spreadPct = isFiniteNumber(i.unverifiedRatio) ? Math.min(50, 10 + i.unverifiedRatio / 2) : 30;
  const confidence = clampScore(70 - spreadPct - Math.min(20, periods * 2));   // 장기일수록 제한
  return {
    ...base, expected: Math.round(expected), low: Math.round(expected * (1 - spreadPct / 100)), high: Math.round(expected * (1 + spreadPct / 100)),
    method, confidence, unknownFactors,
  };
}

export function calculateForecastReliability(c: {
  inputCoverage: number | null; inputFreshness: number | null; assumptionVerification: number | null;
  historicalSample: number | null; contextMatch: number | null; unknownVariableRatio: number | null;
}): { reliability: ForecastReliability; score: number | null; note: string } {
  const { score } = normalizeAvailableComponents([
    { key: 'coverage', value: c.inputCoverage, weight: 0.2 },
    { key: 'freshness', value: c.inputFreshness, weight: 0.15 },
    { key: 'assumption', value: c.assumptionVerification, weight: 0.25 },
    { key: 'sample', value: isFiniteNumber(c.historicalSample) ? Math.min(100, c.historicalSample * 10) : null, weight: 0.15 },
    { key: 'context', value: c.contextMatch, weight: 0.1 },
    { key: 'unknowns', value: isFiniteNumber(c.unknownVariableRatio) ? Math.max(0, 100 - c.unknownVariableRatio) : null, weight: 0.15 },
  ]);
  if (score == null) return { reliability: 'insufficient_data', score: null, note: '입력 없음' };
  const reliability: ForecastReliability = score >= 75 ? 'high_confidence_reference' : score >= 50 ? 'moderate_confidence_reference' : score >= 30 ? 'low_confidence_reference' : 'forecast_unreliable';
  return { reliability, score, note: 'High Confidence ≠ 실제 결과 보장' };
}

/* ── Stress / Sensitivity ────────────────────────────────────────────── */
export function runStressScenario(i: { baseline: number | null; shockPct: number | null; evidenceBased: boolean }): { stressed: number | null; verdict: 'projected' | 'insufficient_data'; note: string } {
  if (!i.evidenceBased) return { stressed: null, verdict: 'insufficient_data', note: '고정 수치 강제 금지 — Evidence 또는 사용자 설정 값만' };
  if (!isFiniteNumber(i.baseline) || !isFiniteNumber(i.shockPct)) return { stressed: null, verdict: 'insufficient_data', note: 'baseline/충격 값 없음' };
  return { stressed: Math.round(i.baseline * (1 + i.shockPct / 100)), verdict: 'projected', note: 'Stress 투영 — 실제 발생 확률 아님' };
}

export function calculateSensitivity(i: { variable: string; baseOutput: number | null; shockedOutput: number | null; shockPct: number | null }): { variable: string; verdict: SensitivityVerdict; elasticity: number | null } {
  if (!isFiniteNumber(i.baseOutput) || !isFiniteNumber(i.shockedOutput) || !isFiniteNumber(i.shockPct) || i.shockPct === 0 || i.baseOutput === 0) {
    return { variable: i.variable, verdict: 'insufficient_data', elasticity: null };
  }
  const outputChangePct = ((i.shockedOutput - i.baseOutput) / Math.abs(i.baseOutput)) * 100;
  const elasticity = Math.round((outputChangePct / i.shockPct) * 100) / 100;
  const abs = Math.abs(elasticity);
  const verdict: SensitivityVerdict = abs >= 2 ? 'critical_sensitivity' : abs >= 1 ? 'high_sensitivity' : abs >= 0.3 ? 'moderate_sensitivity' : 'low_sensitivity';
  return { variable: i.variable, verdict, elasticity };
}

/* ── Break-even / Unit Economics(가짜 수치 생성 금지) ────────────────── */
export function calculateBreakEven(i: { fixedCost: number | null; unitRevenue: number | null; unitVariableCost: number | null }): { requiredUnits: number | null; status: 'break_even_estimated' | 'cost_unknown' | 'unit_economics_unavailable' | 'insufficient_data'; note: string } {
  if (!isFiniteNumber(i.fixedCost)) return { requiredUnits: null, status: 'cost_unknown', note: '고정비 없음 — 가짜 손익분기점 생성 금지' };
  if (!isFiniteNumber(i.unitRevenue)) return { requiredUnits: null, status: 'insufficient_data', note: '단위 수익 없음' };
  if (!isFiniteNumber(i.unitVariableCost)) return { requiredUnits: null, status: 'cost_unknown', note: '변동비 없음' };
  const contribution = i.unitRevenue - i.unitVariableCost;
  if (contribution <= 0) return { requiredUnits: null, status: 'unit_economics_unavailable', note: 'Contribution ≤ 0 — 단위 경제 미성립' };
  return { requiredUnits: Math.ceil(i.fixedCost / contribution), status: 'break_even_estimated', note: '추정 — 실제 보장 아님' };
}

export function calculateUnitEconomics(i: { revenue: number | null; units: number | null; infraCost: number | null; laborCost: number | null; marketingCost: number | null }): {
  revenuePerUnit: number | null; infraCostPerUnit: number | null; grossMarginNote: string; cacNote: string; isEstimate: true;
} {
  const perUnit = (v: number | null): number | null => (isFiniteNumber(v) && isFiniteNumber(i.units) && i.units > 0 ? Math.round(v / i.units) : null);
  return {
    revenuePerUnit: perUnit(i.revenue),
    infraCostPerUnit: perUnit(i.infraCost),
    grossMarginNote: isFiniteNumber(i.laborCost) ? '인건비 포함 추정' : '인건비 없음 — 완전한 마진 아님(cost_unknown)',
    cacNote: isFiniteNumber(i.marketingCost) ? '마케팅비 기반 추정' : '마케팅비 없음 — CAC 임의 생성 금지(cost_unknown)',
    isEstimate: true,
  };
}

/* ── Portfolio Feasibility(Hard 우선·상호 배타·중복 방어) ────────────── */
export interface InitiativeInput { code: string; requiredBudget: number | null; dependencies: string[]; exclusionGroup: string | null; costKnown: boolean }

export function evaluatePortfolioFeasibility(i: { initiatives: InitiativeInput[]; totalBudget: number | null; hardConstraintViolated: boolean }): { status: FeasibilityStatus; issues: string[] } {
  const issues: string[] = [];
  if (!i.initiatives.length) return { status: 'insufficient_data', issues: ['initiative 없음'] };
  if (i.hardConstraintViolated) return { status: 'hard_constraint_violated', issues: ['Hard Constraint 위반 — feasible 표시 금지'] };
  // 상호 배타 충돌
  const groups = new Map<string, string[]>();
  for (const it of i.initiatives) if (it.exclusionGroup) groups.set(it.exclusionGroup, [...(groups.get(it.exclusionGroup) ?? []), it.code]);
  for (const [g, codes] of groups) if (codes.length > 1) { issues.push(`상호 배타(${g}): ${codes.join(', ')}`); return { status: 'mutually_exclusive_conflict', issues }; }
  // 의존 누락
  const codeSet = new Set(i.initiatives.map((x) => x.code));
  const missingDeps = i.initiatives.flatMap((x) => x.dependencies.filter((d) => !codeSet.has(d)));
  if (missingDeps.length) { issues.push(`선행조건 누락: ${[...new Set(missingDeps)].join(', ')}`); return { status: 'dependency_unverified', issues }; }
  // 비용/예산
  if (i.initiatives.some((x) => !x.costKnown)) { issues.push('일부 비용 미상'); return { status: 'cost_unknown', issues }; }
  const budgets = i.initiatives.map((x) => x.requiredBudget);
  if (budgets.some((b) => !isFiniteNumber(b))) { issues.push('예산 미상'); return { status: 'cost_unknown', issues }; }
  if (!isFiniteNumber(i.totalBudget)) { issues.push('총 예산 미확인'); return { status: 'resource_capacity_unknown', issues }; }
  const sum = budgets.reduce((a: number, b) => a + (b as number), 0);
  if (sum > i.totalBudget) { issues.push(`필요 예산(${sum})이 총량(${i.totalBudget}) 초과`); return { status: 'infeasible', issues }; }
  return { status: sum > i.totalBudget * 0.9 ? 'partially_feasible' : 'feasible_reference', issues };
}

/* ── Allocation(총량/Reserve/중복 방어) ──────────────────────────────── */
export function validateResourceAllocation(i: { available: number | null; reserve: number | null; items: { code: string; amount: number | null }[] }): { status: 'ready_for_human_review' | 'reserve_violated' | 'over_allocated' | 'double_allocation_detected' | 'resource_capacity_unknown' | 'insufficient_data'; allocated: number | null; issues: string[] } {
  const issues: string[] = [];
  if (!i.items.length) return { status: 'insufficient_data', allocated: null, issues: ['배분 항목 없음'] };
  if (i.items.some((x) => !isFiniteNumber(x.amount) || x.amount < 0)) return { status: 'insufficient_data', allocated: null, issues: ['금액 음수/누락'] };
  const seen = new Set<string>();
  for (const x of i.items) {
    if (seen.has(x.code)) { issues.push(`중복 배정: ${x.code}`); return { status: 'double_allocation_detected', allocated: null, issues }; }
    seen.add(x.code);
  }
  const allocated = i.items.reduce((a, x) => a + (x.amount as number), 0);
  if (!isFiniteNumber(i.available)) return { status: 'resource_capacity_unknown', allocated, issues: ['자원 총량 미확인 — feasible 단정 금지'] };
  if (allocated > i.available) return { status: 'over_allocated', allocated, issues: [`총량(${i.available}) 초과 배분(${allocated}) 금지`] };
  if (isFiniteNumber(i.reserve) && allocated > i.available - i.reserve) return { status: 'reserve_violated', allocated, issues: ['최소 Reserve 침범'] };
  return { status: 'ready_for_human_review', allocated, issues };
}

export function detectDoubleAllocation(candidates: { code: string; items: { code: string }[] }[]): { initiative: string; candidates: string[] }[] {
  const map = new Map<string, string[]>();
  for (const c of candidates) for (const it of c.items) map.set(it.code, [...(map.get(it.code) ?? []), c.code]);
  return [...map.entries()].filter(([, cs]) => cs.length > 1).map(([initiative, cs]) => ({ initiative, candidates: [...cs].sort() })).sort((a, b) => a.initiative.localeCompare(b.initiative));
}

/* ── Expected Value / Risk-adjusted / Trade-off ──────────────────────── */
export function calculateExpectedValue(c: { revenueBenefit: number | null; costSaving: number | null; riskReductionScore: number | null; nonFinancialNote: string | null }): { monetary: number | null; nonMonetary: string[]; note: string; notActualReturn: true } {
  const monetary = [c.revenueBenefit, c.costSaving].filter(isFiniteNumber).reduce((a: number, b) => a + b, 0);
  const hasMonetary = isFiniteNumber(c.revenueBenefit) || isFiniteNumber(c.costSaving);
  const nonMonetary: string[] = [];
  if (isFiniteNumber(c.riskReductionScore)) nonMonetary.push(`위험 감소 점수 ${c.riskReductionScore}(원화 환산 안 함)`);
  if (c.nonFinancialNote) nonMonetary.push(c.nonFinancialNote);
  return { monetary: hasMonetary ? monetary : null, nonMonetary, note: '금전 환산 근거 없는 효과는 qualitative — 억지 환산 금지', notActualReturn: true };
}

export function calculateRiskAdjustedComparison(i: { expectedValue: number | null; expectedCost: number | null; downsideExposure: number | null; confidence: number | null; feasible: boolean; evidenceCount: number | null }): { verdict: RiskAdjustedVerdict; note: string } {
  if (!i.feasible) return { verdict: 'infeasible', note: 'Hard Constraint/제약 위반' };
  if (!isFiniteNumber(i.evidenceCount) || i.evidenceCount < 2) return { verdict: 'low_evidence_candidate', note: '근거 부족 — "최적" 단정 금지' };
  if (!isFiniteNumber(i.expectedValue) || !isFiniteNumber(i.expectedCost)) return { verdict: 'insufficient_data', note: '가치/비용 미상' };
  if (isFiniteNumber(i.downsideExposure) && i.downsideExposure > i.expectedValue) return { verdict: 'high_risk_candidate', note: 'Downside 노출이 기대가치 초과' };
  const ratio = i.expectedCost > 0 ? i.expectedValue / i.expectedCost : null;
  if (ratio != null && ratio >= 2 && (i.confidence ?? 0) >= 50) return { verdict: 'favorable_candidate', note: '후보 — 실제 수익 보장 아님("최적" 아님)' };
  return { verdict: 'balanced_candidate', note: '후보 비교 참고' };
}

export function evaluateTradeoff(i: { axis: string; gain: number | null; loss: number | null; hardLimitBreached: boolean }): { axis: string; verdict: TradeoffVerdict } {
  if (i.hardLimitBreached) return { axis: i.axis, verdict: 'unacceptable_tradeoff' };
  if (!isFiniteNumber(i.gain) || !isFiniteNumber(i.loss)) return { axis: i.axis, verdict: 'insufficient_data' };
  if (i.loss <= 0) return { axis: i.axis, verdict: 'favorable_tradeoff' };
  const ratio = i.gain / i.loss;
  return { axis: i.axis, verdict: ratio >= 2 ? 'favorable_tradeoff' : ratio >= 1 ? 'acceptable_tradeoff' : 'difficult_tradeoff' };
}

export function calculateOpportunityCost(i: { chosen: string; foregone: string[]; foregoneValue: number | null }): { chosen: string; foregone: string[]; quantified: number | null; note: string } {
  return {
    chosen: i.chosen, foregone: [...i.foregone].sort(),
    quantified: isFiniteNumber(i.foregoneValue) ? i.foregoneValue : null,
    note: isFiniteNumber(i.foregoneValue) ? '포기 가치 추정(보장 아님)' : '정량 데이터 없음 — 임의 수치 생성 금지',
  };
}

/* ── Concentration / Option Value ────────────────────────────────────── */
export function calculateConcentrationRisk(shares: { axis: string; topSharePct: number | null }[]): { axis: string; verdict: ConcentrationVerdict }[] {
  return shares.map((s) => ({
    axis: s.axis,
    verdict: !isFiniteNumber(s.topSharePct) ? 'insufficient_data' as ConcentrationVerdict
      : s.topSharePct >= 80 ? 'critical_concentration' : s.topSharePct >= 60 ? 'high_concentration' : s.topSharePct >= 40 ? 'moderate_concentration' : 'diversified_reference',
  }));
}

export function calculateStrategicOptionValue(i: { reversibility: 'reversible' | 'partially_reversible' | 'irreversible' | 'unknown'; learningValue: boolean; dependencyReduction: boolean; quantifiedValue: number | null }): { verdict: 'quantified_reference' | 'qualitative_reference' | 'insufficient_data'; factors: string[] } {
  const factors: string[] = [];
  if (i.reversibility === 'reversible') factors.push('가역성 높음');
  if (i.learningValue) factors.push('학습 가치');
  if (i.dependencyReduction) factors.push('의존 감소');
  if (isFiniteNumber(i.quantifiedValue)) return { verdict: 'quantified_reference', factors };
  return { verdict: factors.length ? 'qualitative_reference' : 'insufficient_data', factors };
}

/* ── Scenario 비교 완결성(낙관만 제시 금지) ──────────────────────────── */
export function checkScenarioCompleteness(types: ScenarioType[]): { complete: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!types.includes('base_case')) missing.push('base_case');
  if (!types.includes('downside_case')) missing.push('downside_case');
  if (!types.includes('stress_case')) missing.push('stress_case');
  if (!types.includes('no_action_case')) missing.push('no_action_case(권장)');
  return { complete: missing.length === 0, missing };
}

/* ── Strategic Recommendation ────────────────────────────────────────── */
export const STRATEGIC_REC_TYPES = ['prioritize_initiative_candidate', 'defer_initiative_candidate', 'reject_infeasible_candidate', 'request_more_evidence', 'reduce_portfolio_concentration', 'preserve_resource_reserve', 'validate_unit_economics', 'validate_market_assumption', 'validate_cost_assumption', 'validate_capacity_assumption', 'run_downside_scenario', 'run_stress_scenario', 'select_balanced_portfolio_candidate', 'select_conservative_portfolio_candidate', 'increase_observation_before_commitment', 'create_executive_decision_reference', 'insufficient_data'] as const;
export type StrategicRecType = (typeof STRATEGIC_REC_TYPES)[number];

export interface StrategicRecommendation {
  code: string; recType: StrategicRecType; recommendation: string; reason: string;
  evidence: { label: string; value: number | string | null }[]; confidence: number;
  severity: 'low' | 'moderate' | 'high' | 'critical'; expectedBenefit: string; expectedRisk: string;
  opportunityCostNote: string; alternatives: string[]; preconditions: string[]; limitations: string[];
  humanApprovalRequired: true; noAutoExecution: true;
}

export function buildStrategicRecommendation(i: { code: string; recType: StrategicRecType; finding: string; evidenceCount: number | null; severity?: 'low' | 'moderate' | 'high' | 'critical' }): StrategicRecommendation | { insufficient: true; why: string } {
  if (!(STRATEGIC_REC_TYPES as readonly string[]).includes(i.recType)) return { insufficient: true, why: '허용되지 않는 유형' };
  if (!i.finding?.trim()) return { insufficient: true, why: '관찰 없음' };
  if (!isFiniteNumber(i.evidenceCount) || i.evidenceCount < 1) return { insufficient: true, why: 'Evidence 없음 — 생성 금지' };
  return {
    code: i.code, recType: i.recType,
    recommendation: `[${i.recType}] ${i.finding} — 검토 후보(자동 실행 없음·"최적" 단정 아님)`,
    reason: `전략 근거 관찰: ${i.finding} (evidence ${i.evidenceCount}건)`,
    evidence: [{ label: 'evidence_count', value: i.evidenceCount }],
    confidence: clampScore(30 + Math.min(40, i.evidenceCount * 10)),
    severity: i.severity ?? 'moderate',
    expectedBenefit: '전략 비교 품질 개선(사람 결정 후)',
    expectedRisk: 'Forecast 불확실성 — 실제 결과 미보장',
    opportunityCostNote: '선택 시 포기 후보 존재 — 정량 미상 시 수치 미생성',
    alternatives: ['현행 유지(no_action_case)', '추가 근거 수집'],
    preconditions: ['Human Approval', 'Downside/Stress Case 검토', 'Hard Constraint 확인'],
    limitations: ['권고만 — 자동 예산/실행/계약/가격 변경 없음'],
    humanApprovalRequired: true, noAutoExecution: true,
  };
}

/* ── Support Matrix ──────────────────────────────────────────────────── */
export interface StratSupportItem { key: string; label: string; status: 'fully_supported' | 'partially_supported' | 'read_only' | 'evidence_only' | 'external_reference_only' | 'cost_unknown' | 'market_data_unavailable' | 'resource_capacity_unknown' | 'unsupported' | 'insufficient_data'; note: string }

export const STRAT_SUPPORT: StratSupportItem[] = [
  { key: 'strategic_objective', label: 'Strategic Objective', status: 'fully_supported', note: 'type 20종 — active_reference ≠ 실행 중' },
  { key: 'assumption', label: 'Assumption + Verification', status: 'fully_supported', note: '검증 8상태 — unverified 비중 → Forecast 신뢰 제한' },
  { key: 'constraint', label: 'Constraint + Validation', status: 'fully_supported', note: 'Hard 위반 → feasible 금지 · current null = capacity_unknown' },
  { key: 'scenario', label: 'Strategic Scenario(Base/Upside/Downside/Stress/No-action)', status: 'fully_supported', note: '시뮬레이션 입력 — 확정 사업계획 아님 · 낙관만 제시 금지(완결성 검사)' },
  { key: 'forecast', label: 'Forecast(범위 포함)', status: 'partially_supported', note: '결정적 투영만(ML 미사용) — notActualFuture 고정 · 과거 성장률 무조건 연장 금지' },
  { key: 'forecast_reliability', label: 'Forecast Reliability', status: 'partially_supported', note: '6성분 재정규화 — High ≠ 실제 보장' },
  { key: 'sensitivity', label: 'Sensitivity Analysis', status: 'fully_supported', note: 'elasticity 기반 — NaN/0 나눗셈 방어' },
  { key: 'break_even', label: 'Break-even', status: 'cost_unknown', note: '고정비/변동비 없으면 가짜 손익분기점 생성 금지' },
  { key: 'unit_economics', label: 'Unit Economics', status: 'partially_supported', note: '인건비/마케팅비 없음 — 완전한 CAC/마진 아님(추정 표시)' },
  { key: 'initiative', label: 'Strategic Initiative', status: 'fully_supported', note: 'type 16종 — 프로젝트 생성/업무 할당 없음' },
  { key: 'portfolio', label: 'Strategic Portfolio + Feasibility', status: 'fully_supported', note: 'Hard/상호 배타/의존/총량 검증 — selected_reference ≠ 집행' },
  { key: 'allocation', label: 'Resource Allocation + Safety', status: 'fully_supported', note: '총량/Reserve/중복 배정 서버+로직 이중 방어 — 실제 Budget 미변경' },
  { key: 'capital_allocation', label: 'Capital Allocation Reference', status: 'evidence_only', note: '내부 검토 Reference — 회계 전표/송금 아님' },
  { key: 'expected_value', label: 'Expected Value', status: 'partially_supported', note: '금전/비금전 분리 — 억지 원화 환산 금지 · notActualReturn' },
  { key: 'risk_adjusted', label: 'Risk-adjusted Comparison', status: 'partially_supported', note: '"최적" 단정 금지 — 후보 표현만' },
  { key: 'tradeoff', label: 'Trade-off Analysis', status: 'fully_supported', note: '10축 — hard limit 위반 시 unacceptable' },
  { key: 'opportunity_cost', label: 'Opportunity Cost', status: 'partially_supported', note: '정량 데이터 없으면 수치 미생성' },
  { key: 'concentration', label: 'Concentration Risk', status: 'partially_supported', note: '집중도 축 — 지역/팀 데이터 미존재 축은 insufficient' },
  { key: 'strategic_dependency', label: 'Strategic Dependency', status: 'partially_supported', note: 'Knowledge Graph(0513) 재사용 — 선행조건 누락 시 dependency_unverified' },
  { key: 'option_value', label: 'Strategic Option Value', status: 'partially_supported', note: '정량 근거 없으면 qualitative_reference' },
  { key: 'recommendation', label: 'Strategic Recommendation', status: 'fully_supported', note: '17 유형 — Evidence 필수·Human Approval' },
  { key: 'decision_reference', label: 'Strategic Decision Reference', status: 'fully_supported', note: 'selected_reference ≠ 예산 집행/사업 실행' },
  { key: 'external_action', label: 'External Strategic Action Reference', status: 'external_reference_only', note: '참고 기록만' },
  { key: 'scenario_outcome_link', label: 'Scenario Outcome Link', status: 'partially_supported', note: '0514 Decision Memory 연결 — 자동 인과 연결 없음' },
  { key: 'market_data', label: 'TAM/SAM/SOM·경쟁사·지역', status: 'market_data_unavailable', note: '데이터 미존재 — 임의 생성 금지' },
  { key: 'labor_capacity', label: '인력 Capacity/인건비', status: 'resource_capacity_unknown', note: '데이터 미존재 — 임의 추정 금지' },
  { key: 'portfolio_solver', label: '수리 최적화 Solver', status: 'unsupported', note: '미도입 — 제한된 후보 비교 기반(정직 표기)' },
  { key: 'auto_budget', label: '자동 예산 배정/지출/투자/대출', status: 'unsupported', note: '금지' },
  { key: 'auto_people', label: '자동 인력 배치/채용/해고', status: 'unsupported', note: '금지' },
  { key: 'auto_commercial', label: '자동 가격/요금제/계약/정산 변경·영업/광고 집행', status: 'unsupported', note: '금지' },
  { key: 'auto_infra', label: '자동 서버 증설/축소/Provider 변경', status: 'unsupported', note: '금지' },
  { key: 'auto_ai', label: '자동 모델 학습/Weight/Prompt/Governance/Trust 변경', status: 'unsupported', note: '금지' },
  { key: 'production_apply', label: 'Production Apply/Merge/Deploy/Migration', status: 'unsupported', note: '금지' },
];
