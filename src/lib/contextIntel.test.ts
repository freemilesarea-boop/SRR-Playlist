// Phase AI-MUSIC-2 — Context Intelligence 순수 로직 단위 테스트.
// 지원 Dimension 만 Context Key · Grain fallback · Score/Health/Confidence 0~100 · NaN 금지 ·
// Genre/Mood unknown·표본부족 분리 · Evidence 기반 추천 · Comparison(승자 단정 없음) · Trend · KST.
import { describe, it, expect } from 'vitest';
import {
  buildContextKey, resolveGrain, sampleTier, sampleConfidence,
  computeContextScore, computeContextHealth, rankContextItems, rankGenreMood,
  recommendContext, compareContexts, computeContextTrend, contextDNA, isStale,
  SUPPORT_MATRIX, dimensionSupported, GRAIN_LEVELS, STATUS_LABEL, TREND_DIR_LABEL,
  MIN_TREND_POINTS, SAMPLE_TIERS,
  type ContextSummary, type ContextDetail, type GenreMoodRow, type TrendPoint,
} from './contextIntel';

function summary(over: Partial<ContextSummary> = {}): ContextSummary {
  return {
    events: 120, track_count: 40, playlist_count: 2, genre_count: 6, mood_count: 5,
    unknown_genre_events: 0, completion_rate: 78, skip_rate: 4, avg_listen_seconds: 95,
    likes: 2, replays: 3, last_event_at: '2026-07-10T00:00:00Z', days_since_last: 2, ...over,
  };
}
function detail(over: Partial<ContextDetail> = {}): ContextDetail {
  return {
    store_type: 'cafe',
    requested: { daypart: '아침', weekday_group: 'weekday' },
    resolved: { grain: 'L3', daypart: '아침', weekday_group: 'weekday', fallback: false },
    candidate_samples: { l1: 2898, l2: 524, l3: 524, min_sample: 20 },
    range: '30d', summary: summary(),
    tracks: [
      { track_id: 't1', title: 'Good', artist: 'A', genre: 'Lo-fi', mood: '차분한', events: 40, completion_rate: 85, skip_rate: 2, avg_listen_seconds: 110, last_played_at: '2026-07-10T00:00:00Z' },
      { track_id: 't2', title: 'Bad', artist: 'B', genre: 'Rock', mood: '신나는', events: 30, completion_rate: 30, skip_rate: 40, avg_listen_seconds: 20, last_played_at: '2026-07-09T00:00:00Z' },
      { track_id: 't3', title: 'Stale', artist: 'C', genre: 'Jazz', mood: '차분한', events: 20, completion_rate: 80, skip_rate: 5, avg_listen_seconds: 100, last_played_at: '2026-06-01T00:00:00Z' },
    ],
    playlists: [
      { playlist_id: 'p1', title: 'Morning Cafe', events: 300, unique_track_count: 30, completion_rate: 80, skip_rate: 3, avg_listen_seconds: 100 },
      { playlist_id: 'p2', title: 'Alt', events: 200, unique_track_count: 20, completion_rate: 72, skip_rate: 6, avg_listen_seconds: 90 },
    ],
    genres: [
      { key: 'Lo-fi', is_unknown: false, events: 60, completion_rate: 82, skip_rate: 3 },
      { key: 'Rock', is_unknown: false, events: 30, completion_rate: 40, skip_rate: 30 },
      { key: 'Rare', is_unknown: false, events: 2, completion_rate: 90, skip_rate: 0 },
      { key: '(unknown)', is_unknown: true, events: 5, completion_rate: 50, skip_rate: 10 },
    ],
    moods: [
      { key: '차분한', is_unknown: false, events: 70, completion_rate: 80, skip_rate: 3 },
      { key: '신나는', is_unknown: false, events: 30, completion_rate: 45, skip_rate: 25 },
    ],
    baseline: { events: 4000, completion_rate: 70, skip_rate: 6, avg_listen_seconds: 88 },
    generated_at: '2026-07-12T00:00:00Z',
    ...over,
  };
}

describe('buildContextKey — 지원 Dimension 만·고정 순서·null 제외', () => {
  it('store_type+daypart+weekday → 정렬된 key', () => {
    expect(buildContextKey({ store_type: 'cafe', daypart: '아침', weekday_group: 'weekday' })).toBe('store_type=cafe|daypart=morning|weekday=weekday');
  });
  it('입력 순서 무관·null 제외 동일 key', () => {
    const a = buildContextKey({ weekday_group: 'weekday', store_type: 'cafe', daypart: null });
    expect(a).toBe('store_type=cafe|weekday=weekday');
  });
  it('미지원 daypart/weekday 값 제외', () => {
    expect(buildContextKey({ store_type: 'cafe', daypart: 'invalid', weekday_group: 'xxx' })).toBe('store_type=cafe');
  });
});

describe('resolveGrain — 표본 부족 시 상위 fallback', () => {
  it('충분 → L3', () => {
    const r = resolveGrain({ store_type: 'cafe', daypart: '아침', weekday_group: 'weekday' }, { l1: 2898, l2: 524, l3: 524 });
    expect(r.grain).toBe('L3'); expect(r.fallback).toBe(false);
  });
  it('L3 부족 → L2 fallback', () => {
    const r = resolveGrain({ store_type: 'cafe', daypart: '아침', weekday_group: 'weekday' }, { l1: 500, l2: 100, l3: 5 });
    expect(r.grain).toBe('L2'); expect(r.fallback).toBe(true); expect(r.weekday_group).toBeNull();
  });
  it('L2 부족 → L1 fallback', () => {
    const r = resolveGrain({ store_type: 'salon', daypart: '아침' }, { l1: 34, l2: 3, l3: 0 });
    expect(r.grain).toBe('L1'); expect(r.fallback).toBe(true); expect(r.daypart).toBeNull();
  });
  it('요청 없음(store_type만) → L1·fallback 아님', () => {
    const r = resolveGrain({ store_type: 'cafe' }, { l1: 2898, l2: 0, l3: 0 });
    expect(r.grain).toBe('L1'); expect(r.fallback).toBe(false);
  });
});

describe('sample 신뢰도', () => {
  it('tier 경계', () => {
    expect(sampleTier(10)).toBe('insufficient');
    expect(sampleTier(20)).toBe('low');
    expect(sampleTier(50)).toBe('medium');
    expect(sampleTier(200)).toBe('high');
  });
  it('confidence 0~100', () => {
    expect(sampleConfidence(0)).toBe(0);
    expect(sampleConfidence(200)).toBe(100);
    expect(sampleConfidence(100)).toBeGreaterThan(0);
  });
});

describe('computeContextScore/Health — 0~100·존재 성분만·NaN 금지', () => {
  it('우수 KPI → 높은 Score', () => {
    const s = computeContextScore(summary({ completion_rate: 88, skip_rate: 2 }));
    expect(s.score).toBeGreaterThan(65);
    expect(s.confidence).toBeGreaterThanOrEqual(0); expect(s.confidence).toBeLessThanOrEqual(100);
  });
  it('completion/skip 없음 → 성분 제외·NaN 없음', () => {
    const s = computeContextScore(summary({ completion_rate: null, skip_rate: null, days_since_last: null }));
    expect(s.components.find((c) => c.key === 'completion')!.present).toBe(false);
    expect(s.components.find((c) => c.key === 'freshness')!.present).toBe(false);
    expect(Number.isFinite(s.score)).toBe(true);
  });
  it('표본 부족 → insufficient_data', () => {
    expect(computeContextHealth(summary({ events: 10 })).status).toBe('insufficient_data');
  });
  it('Health 블렌드 0~100', () => {
    const h = computeContextHealth(summary(), { trackScoreAvg: 80, playlistScoreAvg: 75 });
    expect(h.score).toBeGreaterThanOrEqual(0); expect(h.score).toBeLessThanOrEqual(100);
    expect(['healthy', 'watch', 'weak', 'insufficient_data']).toContain(h.status);
  });
});

describe('rankContextItems / rankGenreMood — 표본 부족·unknown 분리', () => {
  it('완주율 기준 정렬', () => {
    const r = rankContextItems([
      { key: 'a', label: 'A', events: 30, completion_rate: 85, skip_rate: 2 },
      { key: 'b', label: 'B', events: 30, completion_rate: 40, skip_rate: 30 },
    ]);
    expect(r[0].key).toBe('a'); expect(r[0].score!).toBeGreaterThan(r[1].score!);
  });
  it('unknown·표본부족 분리', () => {
    const rows: GenreMoodRow[] = detail().genres;
    const gm = rankGenreMood(rows);
    expect(gm.unknown!.key).toBe('(unknown)');
    expect(gm.insufficient.some((r) => r.key === 'Rare')).toBe(true);
    expect(gm.top.some((t) => t.key === 'Lo-fi')).toBe(true);
  });
});

describe('recommendContext — Evidence 기반·표본 부족 시 수집만', () => {
  it('표본 부족 → collect_sample 만', () => {
    const recos = recommendContext(detail({ summary: summary({ events: 10 }) }));
    expect(recos.length).toBe(1); expect(recos[0].type).toBe('collect_sample');
  });
  it('우수 Context → Evidence 포함 추천 생성', () => {
    const recos = recommendContext(detail());
    expect(recos.length).toBeGreaterThan(0);
    expect(recos.every((r) => r.evidence.length > 0)).toBe(true);
    expect(recos.some((r) => r.type === 'top_track_expand')).toBe(true);
    expect(recos.some((r) => r.type === 'low_track_reduce')).toBe(true);
  });
  it('모든 추천 Evidence 에 Context/Sample/기간/Source 포함', () => {
    const recos = recommendContext(detail());
    for (const r of recos) {
      const labels = r.evidence.map((e) => e.label);
      expect(labels).toContain('Context'); expect(labels).toContain('Sample');
      expect(labels).toContain('기간'); expect(labels).toContain('Source');
    }
  });
  it('Rediscovery: 완주 양호+미노출 Track', () => {
    const recos = recommendContext(detail());
    expect(recos.some((r) => r.type === 'rediscovery')).toBe(true);
  });
});

describe('compareContexts — 승자 단정 없음·표본 부족 비교 불가', () => {
  it('표본 부족 → comparable=false', () => {
    const a = { label: 'A', summary: summary({ events: 10 }), health: computeContextHealth(summary({ events: 10 })) };
    const b = { label: 'B', summary: summary(), health: computeContextHealth(summary()) };
    expect(compareContexts(a, b).comparable).toBe(false);
  });
  it('항목별 우세 표기(Winner 아님)', () => {
    const a = { label: 'A', summary: summary({ completion_rate: 85 }), health: computeContextHealth(summary({ completion_rate: 85 })) };
    const b = { label: 'B', summary: summary({ completion_rate: 60 }), health: computeContextHealth(summary({ completion_rate: 60 })) };
    const res = compareContexts(a, b);
    expect(res.comparable).toBe(true);
    expect(res.rows.find((r) => r.kpi === '완주율')!.note).toContain('A');
  });
  it('Skip 은 낮을수록 우세', () => {
    const a = { label: 'A', summary: summary({ skip_rate: 2 }), health: computeContextHealth(summary({ skip_rate: 2 })) };
    const b = { label: 'B', summary: summary({ skip_rate: 20 }), health: computeContextHealth(summary({ skip_rate: 20 })) };
    expect(compareContexts(a, b).rows.find((r) => r.kpi === 'Skip율')!.note).toContain('A');
  });
});

describe('computeContextTrend — rising/falling/stable/insufficient', () => {
  const mkPts = (vals: number[]): TrendPoint[] => vals.map((v, i) => ({ bucket_start: `2026-06-0${i + 1}`, events: v, completion_rate: v, skip_rate: 10, avg_listen_seconds: v, track_count: v, playlist_count: 1 }));
  it('포인트 부족 → insufficient', () => {
    expect(computeContextTrend(mkPts([10, 20]), 'events').dir).toBe('insufficient_data');
  });
  it('증가 → rising', () => {
    expect(computeContextTrend(mkPts([10, 20, 30, 40]), 'events').dir).toBe('rising');
  });
  it('감소 → falling', () => {
    expect(computeContextTrend(mkPts([40, 30, 20, 10]), 'events').dir).toBe('falling');
  });
  it('skip 증가 → falling(낮을수록 좋음)', () => {
    const pts = [5, 5, 40, 40].map((v, i) => ({ bucket_start: `d${i}`, events: 10, completion_rate: 70, skip_rate: v, avg_listen_seconds: 90, track_count: 5, playlist_count: 1 }));
    expect(computeContextTrend(pts, 'skip_rate').dir).toBe('falling');
  });
  it('MIN_TREND_POINTS = 3', () => { expect(MIN_TREND_POINTS).toBe(3); });
});

describe('contextDNA — 실제 메타/KPI 만·서술형 취향 없음', () => {
  it('dominant genre/mood + bpm/vocal 미지원 명시', () => {
    const dna = contextDNA(detail());
    expect(dna.dominant_genres).toContain('Lo-fi');
    expect(dna.dominant_moods).toContain('차분한');
    expect(dna.bpm_range).toContain('미지원');
    expect(dna.vocal_support).toBe(false);
    expect(dna.sample_size).toBe(120);
  });
});

describe('Support Matrix / 헬퍼', () => {
  it('Brand/Weather/Event/Individual Store/BPM 미지원', () => {
    for (const k of ['brand', 'weather', 'event', 'individual_store', 'bpm']) {
      expect(SUPPORT_MATRIX.find((d) => d.key === k)!.status).toBe('unsupported');
    }
  });
  it('Season 은 insufficient_data', () => {
    expect(SUPPORT_MATRIX.find((d) => d.key === 'season')!.status).toBe('insufficient_data');
  });
  it('store_type/daypart/weekday_group 지원', () => {
    expect(dimensionSupported('store_type')).toBe(true);
    expect(dimensionSupported('daypart')).toBe(true);
    expect(dimensionSupported('brand')).toBe(false);
  });
  it('GRAIN_LEVELS 3단계·라벨', () => {
    expect(GRAIN_LEVELS.length).toBe(3);
    expect(STATUS_LABEL.healthy).toBe('Healthy');
    expect(TREND_DIR_LABEL.rising).toBe('상승');
    expect(SAMPLE_TIERS.insufficient).toBe(20);
  });
  it('isStale: 파싱 실패/null → false', () => {
    expect(isStale(null, '2026-07-12', 14)).toBe(false);
    expect(isStale('2026-06-01T00:00:00Z', '2026-07-12T00:00:00Z', 14)).toBe(true);
    expect(isStale('2026-07-11T00:00:00Z', '2026-07-12T00:00:00Z', 14)).toBe(false);
  });
});
