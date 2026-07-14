// Phase AI-MUSIC-11 — Digital Twin & Counterfactual Simulation 순수 로직 단위 테스트.
// Completeness(재정규화) · Freshness(stale/version_mismatch) · Eligibility · Scenario/Variant 검증 ·
// Seeded PRNG(결정성) · Deterministic Simulation(동일 Input=동일 Output, unsupported null 유지) ·
// Confidence(horizon/contradiction penalty, iteration 미반영) · Uncertainty(가짜 구간 금지) ·
// Comparison(0 나눗셈 방어/mixed) · Trade-off(critical) · Pareto · Rank · Stress · Resilience · Calibration.
import { describe, it, expect } from 'vitest';
import {
  calculateTwinCompleteness, calculateTwinFreshness, classifyTwinReadiness, validateTwinEligibility,
  validateScenario, validateVariant, hashSimulationInput, createSeededRandom,
  calculateSimulationConfidence, calculateHorizonPenalty, calculateUncertainty, runDeterministicSimulation,
  compareVariantToBaseline, detectMetricTradeoffs, hasCriticalTradeoff, calculateParetoFrontier,
  rankScenarioVariants, classifyStressRisk, evaluateResilience, calculateCalibrationError,
  twinResultToCollaborationInput, TWIN_SUPPORT, TWIN_METRICS,
  type SimInput, type MetricComparison,
} from './digitalTwin';
import { runCollaboration } from './multiAgent';

const NOW = new Date('2026-07-13T12:00:00Z');

describe('Twin Completeness / Freshness / Readiness', () => {
  it('전 성분 존재 → complete', () => {
    const r = calculateTwinCompleteness({ contextPresent: true, policyPresent: true, guardrailPresent: true, playlistPresent: true, trackPoolPresent: true, outcomePresent: true, qualityPresent: true, memoryRefCount: 5, patternRefCount: 5, versionPresent: true, evidenceCount: 3 });
    expect(r.grade).toBe('complete'); expect(r.score!).toBeGreaterThanOrEqual(80);
  });
  it('일부 성분 누락 → 존재 성분만 재정규화(0 변환 없음)', () => {
    const r = calculateTwinCompleteness({ contextPresent: true, outcomePresent: true, versionPresent: true });
    expect(r.score).not.toBeNull(); expect(r.missing).toContain('policy');
  });
  it('모든 성분 누락 → insufficient_data', () => {
    expect(calculateTwinCompleteness({}).grade).toBe('insufficient_data');
    expect(calculateTwinCompleteness({}).score).toBeNull();
  });
  it('Freshness — 최신 current · 오래됨 stale', () => {
    expect(calculateTwinFreshness({ snapshotAt: '2026-07-12T00:00:00Z', now: NOW }).status).toBe('current');
    expect(calculateTwinFreshness({ snapshotAt: '2026-04-01T00:00:00Z', now: NOW }).status).toBe('stale');
  });
  it('Source 변경 후 → 점수 상한 40(aging/stale)', () => {
    const r = calculateTwinFreshness({ snapshotAt: '2026-07-12T00:00:00Z', now: NOW, sourceUpdatedAfterSnapshot: true });
    expect(r.score!).toBeLessThanOrEqual(40);
  });
  it('version mismatch / superseded → 0', () => {
    expect(calculateTwinFreshness({ snapshotAt: '2026-07-12T00:00:00Z', now: NOW, versionMismatch: true }).status).toBe('version_mismatch');
    expect(calculateTwinFreshness({ snapshotAt: '2026-07-12T00:00:00Z', now: NOW, superseded: true }).score).toBe(0);
  });
  it('Readiness 분류', () => {
    expect(classifyTwinReadiness({ completeness: 85, freshness: 80 })).toBe('ready');
    expect(classifyTwinReadiness({ completeness: 50, freshness: 80 })).toBe('partially_ready');
    expect(classifyTwinReadiness({ completeness: 85, freshness: 20 })).toBe('stale');
    expect(classifyTwinReadiness({ completeness: null, freshness: null })).toBe('insufficient_data');
    expect(classifyTwinReadiness({ completeness: 85, freshness: 80, blocked: true })).toBe('blocked');
  });
});

describe('Twin Eligibility', () => {
  const ok = { twinType: 'context', sourceType: 'context_intel', sourceId: 'cafe', sourceVersion: 'v1', sourceHash: 'h', snapshotAt: '2026-07-13', evidenceCount: 2, completeness: 85 };
  it('정상 → eligible', () => { expect(validateTwinEligibility(ok).status).toBe('eligible'); });
  it('completeness 부족 → partial', () => { expect(validateTwinEligibility({ ...ok, completeness: 50 }).status).toBe('partial'); });
  it('unsupported scope 차단', () => { expect(validateTwinEligibility({ ...ok, twinType: 'fleet' }).status).toBe('unsupported'); });
  it('Source/Version/Hash/Evidence 없음 → blocked', () => {
    expect(validateTwinEligibility({ ...ok, sourceId: null }).status).toBe('blocked');
    expect(validateTwinEligibility({ ...ok, sourceVersion: null }).status).toBe('blocked');
    expect(validateTwinEligibility({ ...ok, sourceHash: null }).status).toBe('blocked');
    expect(validateTwinEligibility({ ...ok, evidenceCount: 0 }).status).toBe('blocked');
  });
  it('duplicate / stale source', () => {
    expect(validateTwinEligibility({ ...ok, isDuplicate: true }).status).toBe('duplicate');
    expect(validateTwinEligibility({ ...ok, sourceExpired: true }).status).toBe('stale_source');
  });
});

describe('Scenario / Variant 검증', () => {
  it('Baseline 없는 Scenario 차단', () => {
    expect(validateScenario({ scenarioType: 'diversity', title: 't', baseline: null, horizon: 7, metrics: ['diversity_score'] })).toContain('baseline required');
  });
  it('Horizon 상한 30 · Metric 상한 12 · unsupported metric 차단', () => {
    expect(validateScenario({ scenarioType: 'diversity', title: 't', baseline: {}, horizon: 60, metrics: ['diversity_score'] })).toContain('horizon must be 1..30');
    expect(validateScenario({ scenarioType: 'diversity', title: 't', baseline: {}, horizon: 7, metrics: ['revenue_impact_estimate'] }).some((e) => e.includes('unsupported metric'))).toBe(true);
  });
  it('unsupported scenario_type(weather) 차단', () => {
    expect(validateScenario({ scenarioType: 'weather', title: 't', baseline: {}, horizon: 7, metrics: ['diversity_score'] })).toContain('unsupported scenario_type');
  });
  it('Variant — 상한 20 · ±50% 제한 · unsupported dimension · duplicate', () => {
    expect(validateVariant({ code: 'v', name: 'v', adjustments: {}, isBaseline: false, existingCount: 20, existingHashes: [] })).toContain('max 20 variants per scenario');
    expect(validateVariant({ code: 'v', name: 'v', adjustments: { diversity_score: 80 }, isBaseline: false, existingCount: 0, existingHashes: [] }).some((e) => e.includes('out of range'))).toBe(true);
    expect(validateVariant({ code: 'v', name: 'v', adjustments: { bogus_metric: 5 }, isBaseline: false, existingCount: 0, existingHashes: [] }).some((e) => e.includes('unsupported dimension'))).toBe(true);
    const hash = hashSimulationInput(['v', JSON.stringify({ diversity_score: 5 })]);
    expect(validateVariant({ code: 'v', name: 'v', adjustments: { diversity_score: 5 }, isBaseline: false, existingCount: 1, existingHashes: [hash] })).toContain('duplicate variant');
  });
});

describe('Seeded PRNG / Hash 결정성', () => {
  it('동일 Seed → 동일 시퀀스 · 다른 Seed → 다른 시퀀스', () => {
    const a = createSeededRandom(42); const b = createSeededRandom(42); const c = createSeededRandom(43);
    const seqA = [a(), a(), a()]; const seqB = [b(), b(), b()]; const seqC = [c(), c(), c()];
    expect(seqA).toEqual(seqB); expect(seqA).not.toEqual(seqC);
    for (const v of seqA) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
  it('hashSimulationInput 결정적', () => {
    expect(hashSimulationInput(['a', 1, null])).toBe(hashSimulationInput(['a', 1, null]));
    expect(hashSimulationInput(['a', 1])).not.toBe(hashSimulationInput(['a', 2]));
  });
});

describe('Deterministic Simulation', () => {
  const inp: SimInput = {
    baselineMetrics: { expected_skip_rate: 8, expected_completion_rate: 75, diversity_score: 60, freshness_score: null },
    variants: [
      { id: 'b1', code: 'baseline', name: 'Baseline', isBaseline: true, adjustments: {} },
      { id: 'v1', code: 'aggressive', name: 'Aggressive', isBaseline: false, adjustments: { expected_skip_rate: -10, diversity_score: 15 } },
    ],
    horizonDays: 7, seed: 42, twinCompleteness: 80, twinFreshness: 70,
  };
  it('동일 Input → 동일 Output(결정성)', () => {
    const a = runDeterministicSimulation(inp); const b = runDeterministicSimulation(inp);
    expect(a).toEqual(b);
  });
  it('Baseline variant 는 무변경 · Variant 는 명시적 adjustment 만 적용', () => {
    const r = runDeterministicSimulation(inp);
    const base = r.rows.find((x) => x.variantId === 'b1' && x.metricCode === 'expected_skip_rate')!;
    expect(base.simulatedValue).toBe(8); expect(base.deltaValue).toBe(0);
    const v = r.rows.find((x) => x.variantId === 'v1' && x.metricCode === 'expected_skip_rate')!;
    expect(v.simulatedValue).toBe(7.2); expect(v.deltaPercent).toBe(-10);
  });
  it('Baseline 없는 Metric → unsupported + null 유지(추정값 채우기 금지)', () => {
    const r = runDeterministicSimulation(inp);
    const f = r.rows.find((x) => x.variantId === 'v1' && x.metricCode === 'freshness_score')!;
    expect(f.resultStatus).toBe('unsupported'); expect(f.simulatedValue).toBeNull();
  });
  it('simulated ≠ actual 명시(limitations)', () => {
    const r = runDeterministicSimulation(inp);
    expect(r.limitations.some((l) => l.includes('simulated'))).toBe(true);
  });
});

describe('Simulation Confidence / Uncertainty', () => {
  it('재정규화 + Horizon Penalty', () => {
    const short = calculateSimulationConfidence({ twinCompleteness: 80, twinFreshness: 70, horizonDays: 1 });
    const long = calculateSimulationConfidence({ twinCompleteness: 80, twinFreshness: 70, horizonDays: 30 });
    expect(short!).toBeGreaterThan(long!);
    expect(calculateHorizonPenalty(30)).toBe(40);
  });
  it('Contradiction Penalty · version 비호환 → 0 · 전 성분 누락 → null', () => {
    const a = calculateSimulationConfidence({ twinCompleteness: 80, twinFreshness: 70, horizonDays: 7 });
    const b = calculateSimulationConfidence({ twinCompleteness: 80, twinFreshness: 70, horizonDays: 7, contradictionCount: 2 });
    expect(b!).toBeLessThan(a!);
    expect(calculateSimulationConfidence({ twinCompleteness: 80, twinFreshness: 70, horizonDays: 7, versionCompatible: false })).toBe(0);
    expect(calculateSimulationConfidence({ twinCompleteness: null, twinFreshness: null, horizonDays: 7 })).toBeNull();
  });
  it('Uncertainty — sample 없으면 구간 미제공(가짜 ±5% 금지)', () => {
    expect(calculateUncertainty({ simulated: 50, confidence: 70, sampleSize: null })).toEqual({ low: null, high: null });
    const u = calculateUncertainty({ simulated: 50, confidence: 70, sampleSize: 100 });
    expect(u.low!).toBeLessThan(50); expect(u.high!).toBeGreaterThan(50);
  });
});

describe('Baseline Comparison', () => {
  const mk = (over: Partial<MetricComparison>): MetricComparison => ({ metricCode: 'expected_skip_rate', baseline: 10, simulated: 8, direction: 'min', confidence: 70, ...over });
  it('개선 다수 + 높은 confidence → clearly_better', () => {
    const r = compareVariantToBaseline([mk({}), mk({ metricCode: 'expected_completion_rate', baseline: 70, simulated: 78, direction: 'max' })]);
    expect(r.result).toBe('clearly_better');
  });
  it('개선/악화 혼재 → mixed', () => {
    const r = compareVariantToBaseline([mk({}), mk({ metricCode: 'diversity_score', baseline: 60, simulated: 45, direction: 'max' })]);
    expect(r.result).toBe('mixed'); expect(r.improved).toContain('expected_skip_rate'); expect(r.worsened).toContain('diversity_score');
  });
  it('변화 미미 → neutral · 값 없음 → insufficient_data', () => {
    expect(compareVariantToBaseline([mk({ simulated: 10.05 })]).result).toBe('neutral');
    expect(compareVariantToBaseline([mk({ baseline: null, simulated: null })]).result).toBe('insufficient_data');
  });
  it('baseline 0 → division 방어(절대 delta 기준)', () => {
    expect(compareVariantToBaseline([mk({ baseline: 0, simulated: 1, direction: 'min' })]).result).toBe('potentially_worse');
  });
});

describe('Trade-off / Pareto / Rank', () => {
  it('Skip 개선 + Diversity 악화 → trade-off · 25%+ 악화 → critical', () => {
    const t = detectMetricTradeoffs([
      { metricCode: 'expected_skip_rate', baseline: 10, simulated: 7, direction: 'min', confidence: 70 },
      { metricCode: 'diversity_score', baseline: 60, simulated: 40, direction: 'max', confidence: 70 },
    ]);
    expect(t.length).toBe(1); expect(t[0].severity).toBe('critical'); expect(hasCriticalTradeoff(t)).toBe(true);
  });
  it('충돌 없음 → trade-off 없음 · Metric 누락 시 스킵', () => {
    expect(detectMetricTradeoffs([{ metricCode: 'expected_skip_rate', baseline: 10, simulated: 7, direction: 'min', confidence: 70 }]).length).toBe(0);
  });
  it('Pareto — dominated/non-dominated 결정적 구분', () => {
    const r = calculateParetoFrontier([
      { id: 'a', code: 'a', metrics: { expected_skip_rate: 5, diversity_score: 70 } },
      { id: 'b', code: 'b', metrics: { expected_skip_rate: 8, diversity_score: 60 } },   // a 에 지배됨
      { id: 'c', code: 'c', metrics: { expected_skip_rate: 4, diversity_score: 50 } },   // skip 은 낫고 diversity 는 나쁨 → 비지배
    ], [{ metric: 'expected_skip_rate', direction: 'min' }, { metric: 'diversity_score', direction: 'max' }]);
    expect(r.find((v) => v.id === 'b')!.dominated).toBe(true);
    expect(r.find((v) => v.id === 'a')!.dominated).toBe(false);
    expect(r.find((v) => v.id === 'c')!.dominated).toBe(false);
  });
  it('Pareto — 미측정 metric 은 지배 판정 제외', () => {
    const r = calculateParetoFrontier([
      { id: 'a', code: 'a', metrics: { expected_skip_rate: 5, diversity_score: null } },
      { id: 'b', code: 'b', metrics: { expected_skip_rate: 8, diversity_score: 60 } },
    ], [{ metric: 'expected_skip_rate', direction: 'min' }, { metric: 'diversity_score', direction: 'max' }]);
    expect(r.every((v) => !v.dominated)).toBe(true);
  });
  it('Rank — clearly_better+conf → recommended_for_review · governance risk → unsafe', () => {
    expect(rankScenarioVariants({ comparison: 'clearly_better', confidence: 70, criticalTradeoff: false, constraintViolations: 0, governanceRisk: false })).toBe('recommended_for_review');
    expect(rankScenarioVariants({ comparison: 'clearly_better', confidence: 70, criticalTradeoff: true, constraintViolations: 0, governanceRisk: false })).toBe('unsafe');
    expect(rankScenarioVariants({ comparison: 'insufficient_data', confidence: null, criticalTradeoff: false, constraintViolations: 0, governanceRisk: false })).toBe('insufficient_data');
    expect(rankScenarioVariants({ comparison: 'clearly_worse', confidence: 70, criticalTradeoff: false, constraintViolations: 0, governanceRisk: false })).toBe('weak');
  });
});

describe('Stress / Resilience', () => {
  it('Constitution Violation → critical', () => {
    expect(classifyStressRisk({ constitutionViolation: true }).risk).toBe('critical');
  });
  it('요인 개수 기반 단계 · 무요인 → low', () => {
    expect(classifyStressRisk({}).risk).toBe('low');
    expect(classifyStressRisk({ queueShortage: true }).risk).toBe('moderate');
    expect(classifyStressRisk({ queueShortage: true, trackPoolShortage: true, contextMissing: true }).risk).toBe('high');
  });
  it('Resilience — 성분 재정규화 · 전 성분 누락 insufficient_data', () => {
    expect(evaluateResilience({ trackFallbackCoverage: 80, playlistFallbackCoverage: 75 }).grade).toBe('resilient');
    expect(evaluateResilience({}).grade).toBe('insufficient_data');
    expect(evaluateResilience({ trackFallbackCoverage: 20, playlistFallbackCoverage: 10, qualityTolerance: 20 }).grade).toBe('fragile');
  });
});

describe('Calibration', () => {
  it('실제 Outcome 없으면 pending_outcome(Accuracy 계산 없음)', () => {
    expect(calculateCalibrationError({ simulated: 50, observed: null }).status).toBe('pending_outcome');
    expect(calculateCalibrationError({ simulated: 50, observed: null }).absolute).toBeNull();
  });
  it('연결 시 절대/상대 오차 · observed 0 → relative null(division 방어)', () => {
    const r = calculateCalibrationError({ simulated: 55, observed: 50 });
    expect(r.status).toBe('calibrated'); expect(r.absolute).toBe(5); expect(r.relative).toBe(10);
    expect(calculateCalibrationError({ simulated: 5, observed: 0 }).relative).toBeNull();
  });
  it('simulated 없음 → insufficient_data', () => {
    expect(calculateCalibrationError({ simulated: null, observed: 50 }).status).toBe('insufficient_data');
  });
});

describe('Multi-Agent Review Adapter (기존 Consensus 무변경)', () => {
  it('Sim 결과 → CollaborationInput 변환 · 미지원 신호 null(abstain 유지)', () => {
    const ci = twinResultToCollaborationInput({
      contextKey: 'store_type=cafe', sample: 300, confidence: 70, governanceRisk: false, criticalTradeoff: false,
      rows: [
        { variantId: 'v1', metricCode: 'expected_completion_rate', baselineValue: 70, simulatedValue: 78, deltaValue: 8, deltaPercent: 11.4, confidence: 70, uncertaintyLow: null, uncertaintyHigh: null, resultStatus: 'available', kind: 'real' },
        { variantId: 'v1', metricCode: 'expected_skip_rate', baselineValue: 10, simulatedValue: 8, deltaValue: -2, deltaPercent: -20, confidence: 70, uncertaintyLow: null, uncertaintyHigh: null, resultStatus: 'available', kind: 'real' },
      ],
    });
    expect(ci.predictedCompletion).toBe(78); expect(ci.roi).toBeNull(); expect(ci.constitutionPass).toBe(true);
    const collab = runCollaboration(ci);
    expect(collab.opinions.find((o) => o.agent === 'revenue')!.stance).toBe('abstain'); // 신호 없음 → 기존 abstain 유지
  });
  it('Governance risk → constitutionPass false → governance_review', () => {
    const ci = twinResultToCollaborationInput({ contextKey: 'c', sample: 300, confidence: 70, governanceRisk: true, criticalTradeoff: false, rows: [] });
    expect(ci.constitutionPass).toBe(false);
    expect(runCollaboration(ci).finalDecision).not.toBe('proceed_to_governance');
  });
});

describe('Support Matrix / Metric 정의', () => {
  it('Production Apply/Monte Carlo/Background = unsupported · Brand insufficient · Agent read_only', () => {
    expect(TWIN_SUPPORT.find((s) => s.key === 'production_apply')!.status).toBe('unsupported');
    expect(TWIN_SUPPORT.find((s) => s.key === 'monte_carlo')!.status).toBe('unsupported');
    expect(TWIN_SUPPORT.find((s) => s.key === 'large_scale_background')!.status).toBe('unsupported');
    expect(TWIN_SUPPORT.find((s) => s.key === 'brand_twin')!.status).toBe('insufficient_data');
    expect(TWIN_SUPPORT.find((s) => s.key === 'agent_review')!.status).toBe('read_only');
  });
  it('Metric 은 real/proxy 구분 명시', () => {
    expect(TWIN_METRICS.find((m) => m.code === 'expected_skip_rate')!.kind).toBe('real');
    expect(TWIN_METRICS.find((m) => m.code === 'store_satisfaction_proxy')!.kind).toBe('proxy');
  });
});
