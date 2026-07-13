// Phase AI-MUSIC-4 — Predictive Music Intelligence & AI Simulation 순수 로직 단위 테스트.
// Forecast(회귀) · Simulation(Playlist/Track/Genre/Mood) · Recommendation Impact · Counterfactual ·
// Risk · Opportunity · Prediction Confidence · Evidence · Sample gate · 0~100 clamp · NaN 금지.
import { describe, it, expect } from 'vitest';
import {
  predictionConfidence, forecastKpi, forecastContext, classifyForecast,
  simulateItemChange, simulateMix, predictRecoImpact, counterfactual, predictRisk,
  detectOpportunities, scanSlopes, predictionAllowed, sampleConf,
  HORIZONS, MIN_FORECAST_POINTS, FORECAST_STATUS_LABEL,
  type SeriesPoint, type ContextForecast, type ScanRow, type MixTarget,
} from './predictiveIntel';
import type { ContextSummary, GenreMoodRow } from './contextIntel';

const summary = (over: Partial<ContextSummary> = {}): ContextSummary => ({
  events: 200, track_count: 40, playlist_count: 2, genre_count: 6, mood_count: 5,
  unknown_genre_events: 0, completion_rate: 80, skip_rate: 6, avg_listen_seconds: 100,
  likes: 2, replays: 3, last_event_at: '2026-07-10T00:00:00Z', days_since_last: 2, ...over,
});
const series = (comps: number[]): SeriesPoint[] => comps.map((c, i) => ({
  bucket_start: new Date(Date.UTC(2026, 5, 1 + i * 7)).toISOString(), events: 50,
  completion_rate: c, skip_rate: 10 - i, avg_listen_seconds: 90 + i,
}));

describe('predictionConfidence — 요소 결합·0~100·horizon 하향', () => {
  it('표본 많고 안정·짧은 horizon → 높음', () => {
    const c = predictionConfidence({ sample: 300, stabilityFactor: 1, driftScore: 0, freshnessDays: 0, horizonDays: 7 });
    expect(c).toBeGreaterThan(80); expect(c).toBeLessThanOrEqual(100);
  });
  it('긴 horizon → 낮아짐', () => {
    const s = predictionConfidence({ sample: 300, horizonDays: 7 });
    const l = predictionConfidence({ sample: 300, horizonDays: 90 });
    expect(l).toBeLessThan(s);
  });
  it('표본 0 → 낮음, NaN 없음', () => {
    const c = predictionConfidence({ sample: 0 });
    expect(Number.isFinite(c)).toBe(true); expect(c).toBeGreaterThanOrEqual(0);
  });
});

describe('forecastKpi — 회귀·포인트 부족·clamp', () => {
  it('상승 추세 → 예측 > 현재', () => {
    const f = forecastKpi(series([60, 65, 70, 75]), 'completion_rate', 30);
    expect(f.insufficient).toBe(false);
    expect(f.predicted!).toBeGreaterThan(75);
    expect(f.slopePerDay!).toBeGreaterThan(0);
  });
  it('포인트 부족 → insufficient', () => {
    expect(forecastKpi(series([60, 65]), 'completion_rate', 30).insufficient).toBe(true);
  });
  it('완주율 예측 0~100 clamp', () => {
    const f = forecastKpi(series([90, 95, 99, 100]), 'completion_rate', 90);
    expect(f.predicted!).toBeLessThanOrEqual(100);
  });
  it('MIN_FORECAST_POINTS = 3', () => { expect(MIN_FORECAST_POINTS).toBe(3); });
});

describe('forecastContext / classifyForecast', () => {
  it('7/30/90 horizon 예측 + Health', () => {
    const fc: ContextForecast[] = forecastContext(series([60, 65, 70, 75]), summary(), { sample: 200, stabilityFactor: 0.8 });
    expect(fc.map((f) => f.horizon)).toEqual(HORIZONS);
    expect(fc[0].health).not.toBeNull();
    expect(fc.every((f) => f.confidence >= 0 && f.confidence <= 100)).toBe(true);
  });
  it('상승 → improving, skip 급감 → improving', () => {
    expect(classifyForecast(forecastKpi(series([60, 65, 70, 80]), 'completion_rate', 30), 'completion_rate')).toBe('improving');
    // skip 급감(25,18,11,4 → -7/주 ≈ -1/일, 낮을수록 좋음) → improving
    const skipSteep: SeriesPoint[] = [25, 18, 11, 4].map((s, i) => ({ bucket_start: new Date(Date.UTC(2026, 5, 1 + i * 7)).toISOString(), events: 50, completion_rate: 70, skip_rate: s, avg_listen_seconds: 90 }));
    expect(classifyForecast(forecastKpi(skipSteep, 'skip_rate', 30), 'skip_rate')).toBe('improving');
  });
  it('포인트 부족 → insufficient_data', () => {
    expect(classifyForecast(forecastKpi(series([60, 65]), 'completion_rate', 30), 'completion_rate')).toBe('insufficient_data');
  });
});

describe('simulateItemChange — 가중 혼합·Sample gate', () => {
  it('완주율 높은 Track add → 완주율 상승', () => {
    const r = simulateItemChange(summary({ completion_rate: 80, events: 200 }), 'add', { key: 't', label: 'Good', events: 50, completion_rate: 95, skip_rate: 2 });
    expect(r.insufficient).toBe(false);
    expect(r.after.completion!).toBeGreaterThan(80);
    expect(r.delta.completion!).toBeGreaterThan(0);
  });
  it('저성과 Track remove → 완주율 상승', () => {
    const r = simulateItemChange(summary({ completion_rate: 80, events: 200 }), 'remove', { key: 't', label: 'Bad', events: 40, completion_rate: 40, skip_rate: 30 });
    expect(r.after.completion!).toBeGreaterThan(80);
  });
  it('swap: out 저성과 → in 고성과', () => {
    const r = simulateItemChange(summary({ completion_rate: 80, events: 200 }), 'swap',
      { key: 'o', label: 'Out', events: 40, completion_rate: 45, skip_rate: 25 },
      { key: 'i', label: 'In', events: 40, completion_rate: 92, skip_rate: 3 });
    expect(r.after.completion!).toBeGreaterThan(80); expect(r.evidence.some((e) => e.label === '교체 투입')).toBe(true);
  });
  it('표본 부족 → insufficient', () => {
    expect(simulateItemChange(summary({ events: 10 }), 'add', { key: 't', label: 'x', events: 5, completion_rate: 90, skip_rate: 2 }).insufficient).toBe(true);
  });
});

describe('simulateMix — Genre/Mood 비율·Diversity·Health', () => {
  const genres: GenreMoodRow[] = [
    { key: 'Lo-fi', is_unknown: false, events: 60, completion_rate: 88, skip_rate: 3 },
    { key: 'Rock', is_unknown: false, events: 40, completion_rate: 45, skip_rate: 30 },
    { key: 'Jazz', is_unknown: false, events: 50, completion_rate: 82, skip_rate: 4 },
  ];
  it('고성과 장르 비중↑ → 완주율 상승', () => {
    const mix: MixTarget[] = [{ key: 'Lo-fi', share: 0.7 }, { key: 'Jazz', share: 0.3 }];
    const r = simulateMix(summary({ completion_rate: 70 }), genres, mix);
    expect(r.insufficient).toBe(false);
    expect(r.after.completion).toBeGreaterThan(70);
    expect(r.after.health).toBeGreaterThanOrEqual(0); expect(r.after.health).toBeLessThanOrEqual(100);
  });
  it('사용 가능 그룹 없음 → insufficient', () => {
    const r = simulateMix(summary(), genres, [{ key: 'Unknown', share: 1 }]);
    expect(r.insufficient).toBe(true);
  });
  it('Diversity 0~100', () => {
    const r = simulateMix(summary(), genres, [{ key: 'Lo-fi', share: 0.34 }, { key: 'Rock', share: 0.33 }, { key: 'Jazz', share: 0.33 }]);
    expect(r.after.diversity).toBeGreaterThanOrEqual(0); expect(r.after.diversity).toBeLessThanOrEqual(100);
  });
});

describe('predictRecoImpact — 보수적·headroom·Sample gate', () => {
  it('top_track_expand → 완주율 개선(+) · Skip 개선(-)', () => {
    const r = predictRecoImpact('top_track_expand', summary({ completion_rate: 70, skip_rate: 20 }), 80);
    expect(r.insufficient).toBe(false);
    expect(r.completion).toBeGreaterThan(0); expect(r.skip).toBeLessThanOrEqual(0);
  });
  it('완주율 100(headroom 0) → 개선폭 0 근처', () => {
    const r = predictRecoImpact('top_track_expand', summary({ completion_rate: 100 }), 80);
    expect(r.completion).toBe(0);
  });
  it('표본 부족 → insufficient', () => {
    expect(predictRecoImpact('top_playlist', summary({ events: 5 }), 80).insufficient).toBe(true);
  });
});

describe('counterfactual — 승자 단정 없음·항목별', () => {
  it('완주율 우세 표기', () => {
    const cf = counterfactual({ label: '현재', completion: 70, skip: 10 }, { label: '추천', completion: 82, skip: 6 });
    expect(cf.rows.find((r) => r.kpi === '완주율')!.note).toContain('추천');
    expect(cf.rows.find((r) => r.kpi === 'Skip율')!.note).toContain('추천');
  });
  it('diversity/health 선택적 포함', () => {
    const cf = counterfactual({ label: 'a', completion: 70, skip: 10, health: 60 }, { label: 'b', completion: 72, skip: 9, health: 70 });
    expect(cf.rows.some((r) => r.kpi === 'Health')).toBe(true);
  });
});

describe('predictRisk — 하락/증가/Drift·Sample gate', () => {
  it('완주율 하락 + Skip 증가 → 높은 위험', () => {
    const r = predictRisk({ completionSlopePerDay: -0.8, skipSlopePerDay: 0.6, driftScore: 40, sample: 200 });
    expect(r.insufficient).toBe(false);
    expect(r.overall).toBeGreaterThan(0);
    expect(r.risks[0].score).toBeGreaterThan(0);
  });
  it('안정 → 낮은 위험', () => {
    const r = predictRisk({ completionSlopePerDay: 0.1, skipSlopePerDay: -0.1, driftScore: 5, sample: 200 });
    expect(r.overall).toBeLessThan(30);
  });
  it('표본 부족 → insufficient', () => {
    expect(predictRisk({ completionSlopePerDay: -1, skipSlopePerDay: 1, sample: 10 }).insufficient).toBe(true);
  });
});

describe('detectOpportunities / scanSlopes', () => {
  const scan = (over: Partial<ScanRow>): ScanRow => ({
    store_type: 'cafe', events: 300, completion_rate: 78, skip_rate: 6, avg_listen_seconds: 100,
    track_count: 40, playlist_count: 2, prior_events: 100, prior_completion: 70, prior_skip: 8,
    recent_events: 200, recent_completion: 80, recent_skip: 5, ...over,
  });
  it('상승 추세 + headroom → 기회', () => {
    const ops = detectOpportunities([scan({})]);
    expect(ops.length).toBe(1);
    expect(ops[0].expectedImprovement).toBeGreaterThan(0);
    expect(ops[0].evidence.length).toBeGreaterThan(0);
  });
  it('표본 부족 Context 제외', () => {
    expect(detectOpportunities([scan({ recent_events: 5 })]).length).toBe(0);
  });
  it('완주율 결측 제외(추측 금지)', () => {
    expect(detectOpportunities([scan({ recent_completion: null })]).length).toBe(0);
  });
  it('scanSlopes 일별 기울기', () => {
    const s = scanSlopes(scan({ prior_completion: 70, recent_completion: 80 }), 15);
    expect(s.completionSlopePerDay!).toBeCloseTo(10 / 15, 1);
  });
});

describe('게이트 / 헬퍼', () => {
  it('predictionAllowed 표본 gate', () => {
    expect(predictionAllowed(10)).toBe(false); expect(predictionAllowed(20)).toBe(true);
  });
  it('sampleConf 0~100', () => { expect(sampleConf(0)).toBe(0); expect(sampleConf(200)).toBe(100); });
  it('라벨', () => { expect(FORECAST_STATUS_LABEL.improving).toBe('개선'); });
});
