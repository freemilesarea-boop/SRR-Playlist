// Phase AI-PLAYLIST-1 — Adaptive Playlist Intelligence 순수 로직 단위 테스트.
// 실제 KPI 기반 · Evidence 필수 · Score/Skip/Completion clamp 0~100 · NaN 금지 · 취향 추측 없음.
import { describe, it, expect } from 'vitest';
import {
  clampPct, playlistScore, rankPlaylists, freshnessScore, summarizeIndustries,
  buildRecommendations, aggregatePlaylistLearning,
  PLAYLIST_WEIGHTS, MIN_EVENTS, SCORE_COMPONENT_LABEL, PRIORITY_TONE,
  type PlaylistKpi, type IndustryKpi, type RecoHistoryLike,
} from './playlistIntel';

const NOW = 1_700_000_000_000;

function kpi(over: Partial<PlaylistKpi> = {}): PlaylistKpi {
  return {
    playlist_id: 'p1', playlist_title: '카페 로파이', events: 100, skips: 2, skip_rate: 2, completion_rate: 70,
    likes: 5, replays: 3, unique_tracks: 60, store_type_count: 2, last_event_at: new Date(NOW - 86400e3).toISOString(), ...over,
  };
}

describe('clampPct', () => {
  it('범위 clamp, null 유지', () => {
    expect(clampPct(150)).toBe(100);
    expect(clampPct(-5)).toBe(0);
    expect(clampPct(NaN)).toBeNull();
    expect(clampPct(null)).toBeNull();
    expect(clampPct(68.85)).toBe(68.9);
  });
});

describe('freshnessScore', () => {
  it('오늘 1 · 30일+ 0 · 없음 0', () => {
    expect(freshnessScore(NOW, NOW)).toBe(1);
    expect(freshnessScore(NOW - 31 * 86400e3, NOW)).toBe(0);
    expect(freshnessScore(null, NOW)).toBe(0);
  });
});

describe('playlistScore — Explainable, 0~100', () => {
  it('성분 합 = total, 가중치 상한', () => {
    const s = playlistScore(kpi(), NOW);
    const b = s.breakdown;
    expect(b.completion).toBeLessThanOrEqual(PLAYLIST_WEIGHTS.completion);
    expect(b.skip).toBeLessThanOrEqual(PLAYLIST_WEIGHTS.skip);
    expect(b.total).toBe(Math.min(100, b.completion + b.skip + b.diversity + b.coverage + b.freshness + b.evidence));
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.score).toBeLessThanOrEqual(100);
  });
  it('이벤트 부족 → insufficient=true, evidence 성분 낮음', () => {
    const s = playlistScore(kpi({ events: 5, unique_tracks: 3 }), NOW);
    expect(s.insufficient).toBe(true);
    expect(s.breakdown.evidence).toBeLessThan(PLAYLIST_WEIGHTS.evidence);
  });
  it('완주율 null / skip null → 0 처리(추정 없음, NaN 없음)', () => {
    const s = playlistScore(kpi({ completion_rate: null, skip_rate: null }), NOW);
    expect(Number.isFinite(s.score)).toBe(true);
    expect(s.completionRate).toBeNull();
  });
  it('skip율 100 → skip 성분 0', () => {
    expect(playlistScore(kpi({ skip_rate: 100 }), NOW).breakdown.skip).toBe(0);
  });
});

describe('rankPlaylists — 점수 내림차순', () => {
  it('정렬', () => {
    const r = rankPlaylists([kpi({ playlist_id: 'a', completion_rate: 40, skip_rate: 20 }), kpi({ playlist_id: 'b', completion_rate: 90, skip_rate: 1 })], NOW);
    expect(r[0].playlistId).toBe('b');
    for (let i = 1; i < r.length; i++) expect(r[i - 1].score).toBeGreaterThanOrEqual(r[i].score);
  });
  it('Playlist 없음 → 빈 배열', () => { expect(rankPlaylists([], NOW)).toEqual([]); });
});

describe('summarizeIndustries — 완주율 정렬', () => {
  it('완주율 내림차순, pct clamp', () => {
    const list: IndustryKpi[] = [
      { store_type_slug: 'cafe', events: 100, skip_rate: 0, completion_rate: 68, playlist_count: 3, unique_tracks: 200 },
      { store_type_slug: 'restaurant', events: 50, skip_rate: 2, completion_rate: 75, playlist_count: 1, unique_tracks: 30 },
    ];
    const s = summarizeIndustries(list);
    expect(s[0].store_type_slug).toBe('restaurant');
  });
});

describe('buildRecommendations — Evidence 기반, 취향 추측 없음', () => {
  const best = kpi({ playlist_id: 'best', playlist_title: 'BEST', events: 200, skip_rate: 1, completion_rate: 85 });
  const bad = kpi({ playlist_id: 'bad', playlist_title: 'BAD', events: 120, skip_rate: 20, completion_rate: 50 });
  it('Skip율 초과 → 교체 추천 + Evidence', () => {
    const recs = buildRecommendations('cafe', 68, 3, [best, bad], NOW);
    expect(recs.length).toBe(1);
    expect(recs[0].recommendedTitle).toBe('BEST');
    expect(recs[0].targetTitle).toBe('BAD');
    expect(recs[0].evidence.length).toBeGreaterThan(0);
    expect(recs[0].reason).toContain('Skip');
  });
  it('저성과 없음 → 추천 없음', () => {
    const ok = kpi({ playlist_id: 'ok', playlist_title: 'OK', events: 120, skip_rate: 2, completion_rate: 70 });
    expect(buildRecommendations('cafe', 68, 3, [best, ok], NOW)).toEqual([]);
  });
  it('비교 대상 부족(1개) → 추천 없음', () => {
    expect(buildRecommendations('cafe', 68, 3, [best], NOW)).toEqual([]);
  });
  it('이벤트 부족 Playlist 는 제외', () => {
    const small = kpi({ playlist_id: 's', events: 5, skip_rate: 40 });
    expect(buildRecommendations('cafe', 68, 3, [best, small], NOW)).toEqual([]);
  });
});

describe('aggregatePlaylistLearning', () => {
  const hist: RecoHistoryLike[] = [
    { ruleKey: 'high_skip_swap', state: 'applied' },
    { ruleKey: 'high_skip_swap', state: 'applied' },
    { ruleKey: 'high_skip_swap', state: 'dismissed' },
    { ruleKey: 'high_skip_swap', state: 'suggested' },
  ];
  it('applyRate = applied/decided(suggested 제외)', () => {
    const [s] = aggregatePlaylistLearning(hist);
    expect(s.total).toBe(4);
    expect(s.applied).toBe(2);
    expect(s.applyRate).toBeCloseTo(66.7, 1);
  });
  it('빈 입력 → 빈 배열', () => { expect(aggregatePlaylistLearning([])).toEqual([]); });
});

describe('상수/라벨', () => {
  it('MIN_EVENTS=20, 가중치 합 100', () => {
    expect(MIN_EVENTS).toBe(20);
    const sum = Object.values(PLAYLIST_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });
  it('라벨/톤', () => {
    expect(SCORE_COMPONENT_LABEL.completion).toBe('완주');
    expect(PRIORITY_TONE.high).toBe('danger');
  });
});
