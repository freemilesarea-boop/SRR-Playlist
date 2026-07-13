// Phase AI-RECOMMENDATION-2 — Root Cause & Impact & Outcome 순수 로직 단위 테스트.
// 상관≠인과 · 시계열 부족→insufficient · conflicting 유지 · 점수 clamp · NaN/Infinity 금지.
import { describe, it, expect } from 'vitest';
import {
  pearson, windowDelta, computeCorrelation, analyzeCandidate, rankRootCauses,
  computeImpact, classifyOutcome, isWindowElapsed, aggregateLearning, correlationPhrase,
  MIN_POINTS, ANALYSIS_LABEL, OUTCOME_LABEL,
  type CandidateInput, type OutcomeLike,
} from './rootCauseIntel';

const dec = [10, 9, 7, 5, 3, 1];        // 감소 추세
const decCorr = [20, 18, 14, 10, 6, 2]; // 같은 방향 감소(양의 상관)
const inc = [1, 3, 5, 7, 9, 11];        // 반대 방향(음의 상관)
const flat = [5, 5, 5, 5, 5, 5];        // 분산 0

describe('pearson', () => {
  it('양의 상관 ≈ 1', () => { expect((pearson(dec, decCorr) ?? 0)).toBeGreaterThan(0.98); });
  it('음의 상관 ≈ -1', () => { expect((pearson(dec, inc) ?? 0)).toBeLessThan(-0.98); });
  it('포인트 부족 → null', () => { expect(pearson([1, 2], [1, 2])).toBeNull(); });
  it('분산 0 → null(추정 금지)', () => { expect(pearson(dec, flat)).toBeNull(); });
});

describe('windowDelta', () => {
  it('감소 감지', () => { const w = windowDelta(dec)!; expect(w.delta).toBeLessThan(0); });
  it('포인트 부족 → null', () => { expect(windowDelta([1, 2])).toBeNull(); });
});

describe('computeCorrelation — 방향/상태', () => {
  it('같은 방향 → supported, correlationScore 0~100', () => {
    const c = computeCorrelation(dec, decCorr);
    expect(c.status).toBe('supported');
    expect(c.correlationScore).toBeGreaterThan(0);
    expect(c.correlationScore).toBeLessThanOrEqual(100);
  });
  it('반대 방향 → conflicting', () => {
    expect(computeCorrelation(dec, inc).status).toBe('conflicting');
  });
  it('시계열 없음 → unsupported', () => {
    expect(computeCorrelation(dec, []).status).toBe('unsupported');
  });
  it('포인트 부족 → insufficient_data', () => {
    expect(computeCorrelation([1, 2, 3], [1, 2, 3]).status).toBe('insufficient_data');
  });
  it('NaN/Infinity 없음', () => {
    const c = computeCorrelation(dec, decCorr);
    expect(Number.isFinite(c.correlationScore)).toBe(true);
    expect(Number.isFinite(c.temporalAlignmentScore)).toBe(true);
  });
});

describe('temporal alignment — 선행/후행', () => {
  it('후보가 선행(lag>0)하면 정렬 점수 가산', () => {
    // 후보가 target 보다 앞서 감소: candidate[0..] leads target
    const target = [10, 10, 9, 7, 5, 3, 1, 0];
    const candidate = [9, 7, 5, 3, 1, 0, 0, 0]; // 앞서 감소
    const c = computeCorrelation(target, candidate);
    expect(c.bestLag).toBeGreaterThanOrEqual(0);
    expect(c.temporalAlignmentScore).toBeGreaterThan(0);
  });
});

describe('rankRootCauses — TOP5 · conflicting · insufficient', () => {
  const mk = (metricKey: string, series: number[], target = dec): CandidateInput => ({
    metricKey, label: metricKey, targetSeries: target, candidateSeries: series,
    currentValue: series[series.length - 1], baselineValue: series[0],
    sourceDashboard: 'D', sourceRpc: 'rpc', timeWindow: '30d',
  });
  it('supported 후보 final_score 내림차순, conflicting 분리', () => {
    const res = rankRootCauses([mk('a', decCorr), mk('b', inc), mk('c', [12, 10, 8, 6, 4, 2])]);
    expect(res.candidates.length).toBeGreaterThanOrEqual(1);
    expect(res.candidates.every((c) => c.analysisStatus === 'supported')).toBe(true);
    for (let i = 1; i < res.candidates.length; i++) expect(res.candidates[i - 1].finalScore).toBeGreaterThanOrEqual(res.candidates[i].finalScore);
    expect(res.conflicting.length).toBe(1); // inc 는 충돌
    expect(res.overallStatus).toBe('supported');
  });
  it('후보 없음 → unsupported/insufficient', () => {
    const res = rankRootCauses([mk('x', [])]);
    expect(res.candidates.length).toBe(0);
    expect(['unsupported', 'insufficient_data']).toContain(res.overallStatus);
  });
  it('TOP5 제한', () => {
    const many = Array.from({ length: 8 }, (_, i) => mk(`m${i}`, decCorr.map((v) => v + i)));
    expect(rankRootCauses(many).candidates.length).toBe(5);
  });
  it('analyzeCandidate delta/deltaRate', () => {
    const a = analyzeCandidate(mk('a', decCorr));
    expect(a.delta).toBe(decCorr[decCorr.length - 1] - decCorr[0]);
    expect(a.deltaRate).not.toBeNull();
  });
});

describe('computeImpact — 계산식 명시, 임의 예측 금지', () => {
  it('backlog_reduction', () => {
    const r = computeImpact('backlog_reduction', { current: 120, target: 50 });
    expect(r.supported).toBe(true);
    expect(r.estimatedRemaining).toBe(70);
    expect(r.calculationMethod).toContain('max(0, current');
  });
  it('recovery_coverage 비율', () => {
    const r = computeImpact('recovery_coverage', { current: 5, target: 3 });
    expect(r.coverageRate).toBe(60);
  });
  it('payment_recovery 잠재 복구', () => {
    expect(computeImpact('payment_recovery', { current: 10, target: 8 }).estimatedRemaining).toBe(8);
  });
  it('revenue_run_rate 정액', () => {
    const r = computeImpact('revenue_run_rate', { current: 100, avgValue: 9900 });
    expect(r.estimatedRemaining).toBe(990000);
    expect(r.calculationMethod).toContain('active_subscriptions');
  });
  it('데이터 없음 → unsupported + 이유', () => {
    const r = computeImpact('backlog_reduction', { current: null, target: 50 });
    expect(r.supported).toBe(false);
    expect(r.unsupportedReason).toBeTruthy();
  });
});

describe('classifyOutcome — Before/After', () => {
  it('lower_better: 감소 → improved', () => {
    expect(classifyOutcome(120, 74, 'lower_better')).toBe('improved');
  });
  it('lower_better: 증가 → worsened', () => {
    expect(classifyOutcome(5, 8, 'lower_better')).toBe('worsened');
  });
  it('미미한 변화 → unchanged', () => {
    expect(classifyOutcome(100, 102, 'lower_better')).toBe('unchanged');
  });
  it('after 없음 → pending', () => {
    expect(classifyOutcome(5, null, 'lower_better')).toBe('pending');
  });
  it('before 없음 → insufficient_data', () => {
    expect(classifyOutcome(null, 3, 'lower_better')).toBe('insufficient_data');
  });
  it('higher_better: 증가 → improved', () => {
    expect(classifyOutcome(80, 95, 'higher_better')).toBe('improved');
  });
});

describe('isWindowElapsed', () => {
  it('24h 경과', () => {
    const t0 = 1_000_000_000_000;
    expect(isWindowElapsed(t0, '24h', t0 + 86400e3)).toBe(true);
    expect(isWindowElapsed(t0, '24h', t0 + 3600e3)).toBe(false);
    expect(isWindowElapsed(t0, 'immediate', t0)).toBe(true);
  });
});

describe('aggregateLearning — 집계, pending 제외', () => {
  const outs: OutcomeLike[] = [
    { recommendationKey: 'store_offline', actionType: 'store_resync', outcomeStatus: 'improved', delta: -3 },
    { recommendationKey: 'store_offline', actionType: 'store_resync', outcomeStatus: 'improved', delta: -2 },
    { recommendationKey: 'store_offline', actionType: 'store_resync', outcomeStatus: 'worsened', delta: 1 },
    { recommendationKey: 'store_offline', actionType: 'store_resync', outcomeStatus: 'pending', delta: null },
  ];
  it('success_rate/average_delta 계산, pending 제외', () => {
    const [s] = aggregateLearning(outs);
    expect(s.timesExecuted).toBe(3);
    expect(s.improvedCount).toBe(2);
    expect(s.worsenedCount).toBe(1);
    expect(s.successRate).toBeCloseTo(66.7, 1);
    expect(s.averageDelta).toBeCloseTo(-1.33, 1);
  });
  it('결정된 outcome 없으면 successRate null', () => {
    const [s] = aggregateLearning([{ recommendationKey: 'k', actionType: null, outcomeStatus: 'pending', delta: null }]);
    expect(s).toBeUndefined(); // pending 만 → 집계 항목 없음
  });
});

describe('인과 표현 제한(문구)', () => {
  it('conflicting/supported 문구에 인과 단정 없음', () => {
    const base = analyzeCandidate({ metricKey: 'm', label: '결제 실패', targetSeries: dec, candidateSeries: inc, currentValue: 1, baselineValue: 10, sourceDashboard: 'D', sourceRpc: 'r', timeWindow: '30d' });
    expect(correlationPhrase(base)).toContain('반대 방향');
    const sup = analyzeCandidate({ metricKey: 'm', label: '신규 결제', targetSeries: dec, candidateSeries: decCorr, currentValue: 2, baselineValue: 20, sourceDashboard: 'D', sourceRpc: 'r', timeWindow: '30d' });
    expect(correlationPhrase(sup)).toContain('인과 아님');
  });
});

describe('상수/라벨', () => {
  it('MIN_POINTS = 4', () => { expect(MIN_POINTS).toBe(4); });
  it('라벨', () => {
    expect(ANALYSIS_LABEL.conflicting).toBe('충돌 근거');
    expect(OUTCOME_LABEL.improved).toBe('개선');
  });
});
