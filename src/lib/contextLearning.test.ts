// Phase AI-MUSIC-3 — Context Evolution & Adaptive Learning 순수 로직 단위 테스트.
// Drift · Stability · Decay(설정 가능) · Similarity · Smart Fallback · Recommendation Outcome ·
// Confidence Calibration · Evolution/Memory · Learning Timeline · Sample gate · 0~100 · NaN 금지.
import { describe, it, expect } from 'vitest';
import {
  computeDrift, computeStability, applyStability, decayWeight, applyDecay, DEFAULT_DECAY_CURVE,
  contextSimilarity, rankSimilar, smartFallbackChain, outcomeFromDelta, computeSuccessRate,
  calibrateConfidence, buildEvolution, mergeTimeline, learningAllowed, learningConfidence,
  MIN_DRIFT_SAMPLE, DRIFT_STATUS_LABEL, OUTCOME_LABEL, SIMILAR_FALLBACK_MIN,
  type DriftWindow, type ContextFeature, type RecoOutcomeRow, type Snapshot, type TimelineEntry,
} from './contextLearning';

const win = (over: Partial<DriftWindow> = {}): DriftWindow => ({
  events: 100, completion_rate: 80, skip_rate: 5,
  genres: [{ key: 'Lo-fi', share: 70 }, { key: 'Jazz', share: 30 }], ...over,
});

describe('computeDrift — 분포/KPI 변화·표본 부족', () => {
  it('분포 급변 → drifting', () => {
    const r = computeDrift(win({ genres: [{ key: 'Lo-fi', share: 72 }, { key: 'Jazz', share: 18 }, { key: 'Other', share: 10 }] }),
      win({ genres: [{ key: 'Lo-fi', share: 44 }, { key: 'Jazz', share: 43 }, { key: 'Other', share: 13 }] }));
    expect(r.status === 'changing' || r.status === 'drifting').toBe(true);
    expect(r.score).toBeGreaterThan(0); expect(r.score!).toBeLessThanOrEqual(100);
    expect(r.topShifts.length).toBeGreaterThan(0);
  });
  it('동일 분포 → stable(score 낮음)', () => {
    const r = computeDrift(win(), win());
    expect(r.status).toBe('stable'); expect(r.score).toBeLessThan(20);
  });
  it('표본 부족 → insufficient_data', () => {
    expect(computeDrift(win({ events: 5 }), win()).status).toBe('insufficient_data');
    expect(computeDrift(win(), win({ events: 3 })).score).toBeNull();
  });
  it('MIN_DRIFT_SAMPLE = 20', () => { expect(MIN_DRIFT_SAMPLE).toBe(20); });
  it('KPI 없음도 NaN 없이 처리', () => {
    const r = computeDrift(win({ completion_rate: null, skip_rate: null }), win({ completion_rate: null, skip_rate: null }));
    expect(Number.isFinite(r.score!)).toBe(true);
  });
});

describe('computeStability / applyStability', () => {
  it('일정한 값 → stable factor≈1', () => {
    const s = computeStability([80, 80, 80]);
    expect(s.level).toBe('stable'); expect(s.factor).toBeGreaterThan(0.9);
  });
  it('변동 큼 → volatile factor 낮음', () => {
    const s = computeStability([10, 90, 20, 80]);
    expect(s.level).toBe('volatile'); expect(s.factor).toBeLessThan(0.6);
  });
  it('포인트 부족 → 중립 0.5', () => { expect(computeStability([50]).factor).toBe(0.5); });
  it('applyStability: 불안정이면 confidence 하향', () => {
    expect(applyStability(80, 1)).toBe(80);
    expect(applyStability(80, 0)).toBeLessThan(80);
    expect(applyStability(80, 0)).toBe(40);
  });
});

describe('decayWeight — 설정 가능 Curve·선형보간', () => {
  it('1일=1.0, 90일≈0.5', () => {
    expect(decayWeight(1)).toBeCloseTo(1, 5);
    expect(decayWeight(90)).toBeCloseTo(0.5, 5);
  });
  it('보간(중간값)', () => {
    const w = decayWeight(15); // 7(0.95)~30(0.8) 사이
    expect(w).toBeLessThan(0.95); expect(w).toBeGreaterThan(0.8);
  });
  it('Curve 밖 clamp', () => {
    expect(decayWeight(365)).toBe(0.25);
    expect(decayWeight(0)).toBe(1);
  });
  it('커스텀 Curve 반영(하드코딩 아님)', () => {
    const flat = [{ days: 1, weight: 1 }, { days: 100, weight: 1 }];
    expect(decayWeight(50, flat)).toBe(1);
  });
  it('applyDecay 값 축소', () => { expect(applyDecay(100, 90)).toBeCloseTo(50, 5); });
  it('DEFAULT_DECAY_CURVE 존재', () => { expect(DEFAULT_DECAY_CURVE.length).toBeGreaterThan(0); });
});

describe('contextSimilarity / rankSimilar', () => {
  const cafe: ContextFeature = { store_type: 'cafe', events: 100, completion_rate: 80, skip_rate: 5, genres: [{ key: 'Jazz', share: 50 }, { key: 'Lo-fi', share: 50 }] };
  const bakery: ContextFeature = { store_type: 'bakery', events: 80, completion_rate: 82, skip_rate: 4, genres: [{ key: 'Jazz', share: 45 }, { key: 'Lo-fi', share: 55 }] };
  const gym: ContextFeature = { store_type: 'gym', events: 80, completion_rate: 40, skip_rate: 40, genres: [{ key: 'EDM', share: 90 }, { key: 'Pop', share: 10 }] };
  it('유사 Context 높은 유사도', () => {
    expect(contextSimilarity(cafe, bakery).similarity).toBeGreaterThan(0.85);
  });
  it('상이 Context 낮은 유사도', () => {
    expect(contextSimilarity(cafe, gym).similarity).toBeLessThan(0.5);
  });
  it('rankSimilar 정렬·표본 부족 제외', () => {
    const ranked = rankSimilar(cafe, [bakery, gym, { ...gym, store_type: 'small', events: 5 }]);
    expect(ranked[0].store_type).toBe('bakery');
    expect(ranked.some((r) => r.store_type === 'small')).toBe(false);
  });
});

describe('smartFallbackChain — 유사도 + Grain·Evidence 이유', () => {
  it('유사 Context → Grain 순서', () => {
    const chain = smartFallbackChain('store_type=cafe|daypart=morning', 'cafe',
      [{ store_type: 'bakery', similarity: 0.91, genreCosine: 0.92, kpiCloseness: 0.9, events: 80 }], 'store_type=cafe');
    expect(chain[0].type).toBe('self');
    expect(chain.some((c) => c.type === 'similar' && c.context_key.includes('bakery'))).toBe(true);
    expect(chain[chain.length - 1].type).toBe('grain');
    expect(chain.every((c) => c.reason.length > 0)).toBe(true);
  });
  it('임계 미만 유사 후보 제외', () => {
    const chain = smartFallbackChain('k', 'cafe', [{ store_type: 'x', similarity: 0.5, genreCosine: 0.5, kpiCloseness: 0.5, events: 80 }], 'store_type=cafe');
    expect(chain.some((c) => c.type === 'similar')).toBe(false);
  });
  it('SIMILAR_FALLBACK_MIN = 0.75', () => { expect(SIMILAR_FALLBACK_MIN).toBe(0.75); });
});

describe('outcomeFromDelta / computeSuccessRate', () => {
  it('완주율↑ → improved', () => {
    expect(outcomeFromDelta({ completion_rate: 82, skip_rate: 5 }, { completion_rate: 87, skip_rate: 4 })).toBe('improved');
  });
  it('완주율↓ → degraded', () => {
    expect(outcomeFromDelta({ completion_rate: 82, skip_rate: 5 }, { completion_rate: 74, skip_rate: 12 })).toBe('degraded');
  });
  it('변화 미미 → neutral', () => {
    expect(outcomeFromDelta({ completion_rate: 82 }, { completion_rate: 82.5 })).toBe('neutral');
  });
  it('KPI 없음 → null(추측 금지)', () => {
    expect(outcomeFromDelta(null, { completion_rate: 80 })).toBeNull();
    expect(outcomeFromDelta({}, {})).toBeNull();
  });
  it('성공률 = improved / 판정건', () => {
    const rows: RecoOutcomeRow[] = [
      { id: '1', context_key: 'c', reco_type: 't', status: 'resolved', outcome: 'improved' },
      { id: '2', context_key: 'c', reco_type: 't', status: 'resolved', outcome: 'degraded' },
      { id: '3', context_key: 'c', reco_type: 't', status: 'dismissed' },
      { id: '4', context_key: 'c', reco_type: 't', status: 'active' },
    ];
    const s = computeSuccessRate(rows);
    expect(s.total).toBe(4); expect(s.dismissed).toBe(1); expect(s.resolvedOutcomes).toBe(2);
    expect(s.successRate).toBe(50);
  });
  it('outcome 없음 → successRate null', () => {
    expect(computeSuccessRate([{ id: '1', context_key: 'c', reco_type: 't', status: 'active' }]).successRate).toBeNull();
  });
});

describe('calibrateConfidence — 성공률 기반·outcome 없으면 base 유지', () => {
  it('outcome 이력 없으면 base 유지', () => {
    const r = calibrateConfidence(70, computeSuccessRate([]));
    expect(r.calibrated).toBe(70); expect(r.weight).toBe(0);
  });
  it('높은 성공률 → base 상향', () => {
    const rows: RecoOutcomeRow[] = Array.from({ length: 10 }, (_, i) => ({ id: `${i}`, context_key: 'c', reco_type: 't', status: 'resolved', outcome: 'improved' as const }));
    const r = calibrateConfidence(60, computeSuccessRate(rows));
    expect(r.calibrated).toBeGreaterThan(60); expect(r.calibrated).toBeLessThanOrEqual(100);
  });
  it('낮은 성공률 → base 하향', () => {
    const rows: RecoOutcomeRow[] = Array.from({ length: 10 }, (_, i) => ({ id: `${i}`, context_key: 'c', reco_type: 't', status: 'resolved', outcome: 'degraded' as const }));
    const r = calibrateConfidence(80, computeSuccessRate(rows));
    expect(r.calibrated).toBeLessThan(80);
  });
});

describe('buildEvolution / mergeTimeline', () => {
  const snaps: Snapshot[] = [
    { context_key: 'c', created_at: '2026-06-01T00:00:00Z', health_score: 60, drift_score: 10 },
    { context_key: 'c', created_at: '2026-06-15T00:00:00Z', health_score: 70, drift_score: 20 },
    { context_key: 'c', created_at: '2026-07-01T00:00:00Z', health_score: 78, drift_score: 15 },
  ];
  it('시계열 정렬 + delta + Health 추세', () => {
    const e = buildEvolution([...snaps].reverse());
    expect(e.points[0].created_at).toBe('2026-06-01T00:00:00Z');
    expect(e.points[1].healthDelta).toBe(10);
    expect(e.healthTrend).toBe('rising');
    expect(e.latest!.health_score).toBe(78);
  });
  it('포인트 부족 → insufficient', () => {
    expect(buildEvolution(snaps.slice(0, 2)).healthTrend).toBe('insufficient_data');
  });
  it('mergeTimeline 시간 역순·파싱 실패 제외', () => {
    const items: TimelineEntry[] = [
      { at: '2026-06-01T00:00:00Z', kind: 'health', title: 'a' },
      { at: 'not-a-date', kind: 'drift', title: 'bad' },
      { at: '2026-07-01T00:00:00Z', kind: 'recommendation', title: 'b' },
    ];
    const m = mergeTimeline(items);
    expect(m.length).toBe(2); expect(m[0].title).toBe('b');
  });
});

describe('Data Sufficiency gate / 라벨', () => {
  it('learningAllowed 표본 gate', () => {
    expect(learningAllowed(10)).toBe(false); expect(learningAllowed(20)).toBe(true);
  });
  it('learningConfidence 0~100', () => {
    expect(learningConfidence(0)).toBe(0); expect(learningConfidence(200)).toBe(100);
  });
  it('라벨', () => {
    expect(DRIFT_STATUS_LABEL.drifting).toBe('Drift');
    expect(OUTCOME_LABEL.improved).toBe('개선');
  });
});
