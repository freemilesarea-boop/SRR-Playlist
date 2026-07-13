// Phase AI-MUSIC-1 — Track Intelligence & Lifecycle 순수 로직 단위 테스트.
// 실제 KPI 기반 · Health/Score/Confidence 0~100 · Trend · Lifecycle 추천 · Evidence · NaN 금지.
import { describe, it, expect } from 'vitest';
import {
  computeTrend, computeHealth, recommendLifecycle, scoreBreakdown, recommendTrack,
  SUPPORT_MATRIX, LIFECYCLE_LABEL, TREND_LABEL, healthTone, MIN_BREAKDOWN_EVENTS,
  type TrackIntelKpi, type Breakdown,
} from './trackIntel';

function kpi(over: Partial<TrackIntelKpi> = {}): TrackIntelKpi {
  return {
    track_id: 't1', title: 'Song', artist: 'A', main_genre: 'Lo-fi', mood: '차분한', bpm: 80, duration: 200,
    events: 40, skip_rate: 3, completion_rate: 80, likes: 2, replays: 1,
    p7d: 10, p30d: 30, p90d: 40, uniq_playlists: 3, uniq_store_types: 3,
    last_played_at: new Date(1_700_000_000_000 - 3 * 86400e3).toISOString(), days_since_last_play: 3, rollout_stage: 'expanded', ...over,
  };
}

describe('computeTrend', () => {
  it('최근 급증 → up', () => {
    expect(computeTrend(kpi({ p7d: 20, p30d: 30 })).dir).toBe('up');
  });
  it('최근 급감 → down', () => {
    expect(computeTrend(kpi({ p7d: 1, p30d: 40 })).dir).toBe('down');
  });
  it('표본 부족 → unknown', () => {
    expect(computeTrend(kpi({ p30d: 2 })).dir).toBe('unknown');
  });
});

describe('computeHealth — 0~100, 존재 신호만', () => {
  it('우수 KPI → 높은 Health + Confidence', () => {
    const h = computeHealth(kpi({ completion_rate: 85, skip_rate: 2, p7d: 15, p30d: 25, uniq_store_types: 3, rollout_stage: 'global' }));
    expect(h.score).toBeGreaterThan(70);
    expect(h.confidence).toBeGreaterThanOrEqual(0); expect(h.confidence).toBeLessThanOrEqual(100);
  });
  it('rollout/trend 없음 → 해당 성분 제외, NaN 없음', () => {
    const h = computeHealth(kpi({ rollout_stage: null, p30d: 2, completion_rate: null, skip_rate: null }));
    expect(h.components.find((c) => c.key === 'rollout')!.present).toBe(false);
    expect(Number.isFinite(h.score)).toBe(true);
  });
  it('score 0~100', () => {
    const h = computeHealth(kpi({ completion_rate: 30, skip_rate: 50 }));
    expect(h.score).toBeGreaterThanOrEqual(0); expect(h.score).toBeLessThanOrEqual(100);
  });
});

describe('recommendLifecycle — 자동 변경 없음, 판정+Evidence', () => {
  it('우수 → core', () => {
    const k = kpi({ completion_rate: 82, skip_rate: 2, p7d: 15, p30d: 25, uniq_store_types: 3, rollout_stage: 'expanded' });
    expect(recommendLifecycle(k, computeHealth(k)).stage).toBe('core');
  });
  it('표본 부족 → testing', () => {
    const k = kpi({ events: 5 });
    expect(recommendLifecycle(k, computeHealth(k)).stage).toBe('testing');
  });
  it('장기 미재생+과거 우수 → archive_candidate', () => {
    const k = kpi({ days_since_last_play: 40, completion_rate: 75, events: 40, p7d: 0, p30d: 5 });
    expect(recommendLifecycle(k, computeHealth(k)).stage).toBe('archive_candidate');
  });
  it('Evidence 포함', () => {
    const k = kpi();
    expect(recommendLifecycle(k, computeHealth(k)).evidence.length).toBeGreaterThan(0);
  });
});

describe('scoreBreakdown — 표본 부족 미지원', () => {
  it('완주율 기준 정렬, 표본 부족 null', () => {
    const rows: Breakdown[] = [
      { key: 'cafe', events: 30, completion_rate: 80, skip_rate: 2 },
      { key: 'gym', events: 2, completion_rate: 90, skip_rate: 0 },
    ];
    const s = scoreBreakdown(rows);
    expect(s.find((x) => x.key === 'gym')!.supported).toBe(false);
    expect(s.find((x) => x.key === 'gym')!.score).toBeNull();
    expect(s.find((x) => x.key === 'cafe')!.score).toBeGreaterThan(0);
  });
  it('MIN_BREAKDOWN_EVENTS 상수', () => { expect(MIN_BREAKDOWN_EVENTS).toBe(5); });
});

describe('recommendTrack — Evidence 기반 추천', () => {
  it('Core 성과 + 미완 Rollout → core_promote(high)', () => {
    const k = kpi({ completion_rate: 82, skip_rate: 2, p7d: 15, p30d: 25, uniq_store_types: 3, rollout_stage: 'limited' });
    const h = computeHealth(k);
    const recos = recommendTrack(k, h, scoreBreakdown([{ key: 'cafe', events: 30, completion_rate: 82, skip_rate: 2 }]));
    const core = recos.find((r) => r.type === 'core_promote');
    expect(core).toBeTruthy();
    expect(core!.evidence.length).toBeGreaterThan(0);
  });
  it('장기 미노출 성과 양호 → rediscovery', () => {
    const k = kpi({ days_since_last_play: 25, completion_rate: 78, events: 30, p7d: 0, p30d: 6 });
    const recos = recommendTrack(k, computeHealth(k), []);
    expect(recos.some((r) => r.type === 'rediscovery')).toBe(true);
  });
  it('KPI 빈약 → 추천 없거나 최소', () => {
    const k = kpi({ events: 3, completion_rate: null, skip_rate: null, days_since_last_play: null });
    const recos = recommendTrack(k, computeHealth(k), []);
    expect(Array.isArray(recos)).toBe(true);
  });
});

describe('Support Matrix / 헬퍼', () => {
  it('Brand/Weather/Event 미지원 명시', () => {
    expect(SUPPORT_MATRIX.find((s) => s.key === 'brand')!.supported).toBe(false);
    expect(SUPPORT_MATRIX.find((s) => s.key === 'weather')!.supported).toBe(false);
    expect(SUPPORT_MATRIX.find((s) => s.key === 'track_kpi')!.supported).toBe(true);
  });
  it('라벨/톤', () => {
    expect(LIFECYCLE_LABEL.core).toBe('Core');
    expect(TREND_LABEL.up).toBe('상승');
    expect(healthTone(80)).toBe('success');
    expect(healthTone(30)).toBe('danger');
  });
});
