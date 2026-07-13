// Phase AI-PLAYLIST-4 — AI Playlist Generator 순수 로직 단위 테스트.
// 실제 메타/KPI 기반 · Evidence · Diversity/Freshness/Fatigue Guard · 0~100 clamp · NaN 금지 · 취향 추측 없음.
import { describe, it, expect } from 'vitest';
import {
  INDUSTRY_PROFILES, getProfile, computeCompatibility, fatigueScore, trackBucket,
  checkDiversity, generateDraft, simulateDraft, DEFAULT_BUDGET, UNSUPPORTED_METADATA, BUCKET_LABEL,
  type PoolTrack, type GeneratorConfig,
} from './playlistGenerator';

const NOW = 1_700_000_000_000;

function track(over: Partial<PoolTrack> = {}): PoolTrack {
  return {
    track_id: 't1', title: 'Song', artist: 'A', main_genre: 'Lo-fi', mood: '차분한', bpm: 80, duration: 200, language: 'ko',
    events: 30, skip_rate: 2, completion_rate: 75, likes: 1, replays: 0, last_event_at: new Date(NOW - 5 * 86400e3).toISOString(),
    store_coverage: 2, rollout_stage: null, ...over,
  };
}

describe('computeCompatibility — 신호 가중, bpm null 제외', () => {
  it('cafe: 장르/무드 매칭 → 높은 점수 + Evidence', () => {
    const c = computeCompatibility(track({ main_genre: 'Lo-fi', mood: '차분한', completion_rate: 80 }), INDUSTRY_PROFILES.cafe);
    expect(c.score).toBeGreaterThan(70);
    expect(c.signals.length).toBe(4);
    expect(c.signals.find((s) => s.key === 'genre')!.match).toBe(1);
  });
  it('bpm null → bpm 신호 제외(present=false), NaN 없음', () => {
    const c = computeCompatibility(track({ bpm: null }), INDUSTRY_PROFILES.cafe);
    expect(c.signals.find((s) => s.key === 'bpm')!.present).toBe(false);
    expect(Number.isFinite(c.score)).toBe(true);
  });
  it('gym에 lo-fi/차분한 → 낮은 적합도', () => {
    const c = computeCompatibility(track({ main_genre: 'Lo-fi', mood: '차분한', bpm: 70 }), INDUSTRY_PROFILES.gym);
    expect(c.score).toBeLessThan(40);
  });
  it('메타데이터 전부 없음 → 0점, 메타 없음 요약', () => {
    const c = computeCompatibility(track({ main_genre: null, mood: null, bpm: null, completion_rate: null }), INDUSTRY_PROFILES.cafe);
    expect(c.score).toBe(0);
    expect(c.summary).toContain('메타데이터 없음');
  });
});

describe('fatigueScore — 빈도+최근성 0~100', () => {
  it('많이+최근 재생 → 높음', () => {
    expect(fatigueScore(track({ events: 80, last_event_at: new Date(NOW).toISOString() }), NOW)).toBeGreaterThan(70);
  });
  it('적게+오래전 → 낮음', () => {
    expect(fatigueScore(track({ events: 5, last_event_at: new Date(NOW - 30 * 86400e3).toISOString() }), NOW)).toBeLessThan(20);
  });
  it('이벤트 시각 없음 → NaN 없음', () => {
    expect(Number.isFinite(fatigueScore(track({ last_event_at: null }), NOW))).toBe(true);
  });
});

describe('trackBucket — Freshness 버킷', () => {
  it('rollout stage 매핑', () => {
    expect(trackBucket(track({ rollout_stage: 'global' }))).toBe('verified');
    expect(trackBucket(track({ rollout_stage: 'test_pool' }))).toBe('test_pool');
    expect(trackBucket(track({ rollout_stage: 'limited' }))).toBe('promoted');
    expect(trackBucket(track({ rollout_stage: null, events: 5 }))).toBe('longterm');
    expect(trackBucket(track({ rollout_stage: null, events: 50 }))).toBe('verified');
  });
});

describe('checkDiversity — 편중/연속 감지', () => {
  it('동일 아티스트 연속 위반', () => {
    const v = checkDiversity([track({ artist: 'A' }), track({ artist: 'A' })]);
    expect(v.some((x) => x.includes('연속'))).toBe(true);
  });
  it('장르 편중 위반(전부 동일 장르)', () => {
    const v = checkDiversity([track({ artist: 'A', main_genre: 'Pop' }), track({ artist: 'B', main_genre: 'Pop' }), track({ artist: 'C', main_genre: 'Pop' })]);
    expect(v.some((x) => x.includes('장르'))).toBe(true);
  });
  it('빈 리스트 → 위반 없음', () => { expect(checkDiversity([])).toEqual([]); });
});

describe('generateDraft — 선택/제외 + Evidence', () => {
  const pool: PoolTrack[] = [
    track({ track_id: 'g1', artist: 'A', main_genre: 'Lo-fi', mood: '차분한', completion_rate: 82, events: 30, rollout_stage: 'global' }),
    track({ track_id: 'g2', artist: 'B', main_genre: 'Jazz', mood: '따뜻한', completion_rate: 78, events: 25, rollout_stage: 'global' }),
    track({ track_id: 'g3', artist: 'C', main_genre: 'Acoustic', mood: '차분한', completion_rate: 74, events: 22, rollout_stage: 'test_pool' }),
    track({ track_id: 'bad', artist: 'D', main_genre: 'EDM', mood: '강렬한', completion_rate: 40, events: 10, rollout_stage: null }),
    track({ track_id: 'tired', artist: 'E', main_genre: 'Lo-fi', mood: '차분한', completion_rate: 80, events: 80, last_event_at: new Date(NOW).toISOString() }),
  ];
  const cfg: GeneratorConfig = { storeType: 'cafe', targetCount: 3, minCompatibility: 50, maxFatigue: 70 };

  it('적합 Track 선택 + 저적합/고피로 제외', () => {
    const r = generateDraft(pool, cfg, NOW);
    expect(r.selected.length).toBeGreaterThan(0);
    expect(r.selected.length).toBeLessThanOrEqual(3);
    expect(r.selected.every((s) => s.reason.length > 0)).toBe(true);          // Evidence(reason)
    expect(r.excluded.some((e) => e.track.track_id === 'bad')).toBe(true);     // 저적합 제외
    expect(r.excluded.some((e) => e.track.track_id === 'tired')).toBe(true);   // 고피로 제외
  });
  it('연속 동일 아티스트 없음(Diversity Guard)', () => {
    const r = generateDraft(pool, cfg, NOW);
    for (let i = 1; i < r.selected.length; i++) expect(r.selected[i].track.artist).not.toBe(r.selected[i - 1].track.artist);
  });
  it('Track 없음 → 빈 결과', () => {
    expect(generateDraft([], cfg, NOW).selected).toEqual([]);
  });
  it('알 수 없는 업종 → 생성 없음(profile null)', () => {
    const r = generateDraft(pool, { ...cfg, storeType: 'unknown' }, NOW);
    expect(r.profile).toBeNull();
    expect(r.selected).toEqual([]);
  });
});

describe('simulateDraft — 실측 기반 추정', () => {
  it('diversity/freshness/completion/skipRisk 계산', () => {
    const cfg: GeneratorConfig = { storeType: 'cafe', targetCount: 3, minCompatibility: 40, maxFatigue: 90 };
    const pool: PoolTrack[] = [
      track({ track_id: 'a', artist: 'A', main_genre: 'Lo-fi', completion_rate: 80, skip_rate: 2, rollout_stage: 'global' }),
      track({ track_id: 'b', artist: 'B', main_genre: 'Jazz', completion_rate: 70, skip_rate: 5, rollout_stage: 'test_pool' }),
    ];
    const r = generateDraft(pool, cfg, NOW);
    const sim = simulateDraft(r.selected);
    expect(sim.trackCount).toBe(r.selected.length);
    expect(sim.diversity).toBeGreaterThanOrEqual(0);
    expect(sim.diversity).toBeLessThanOrEqual(100);
    expect(sim.freshness).toBeGreaterThanOrEqual(0);
    expect(sim.avgCompletion == null || (sim.avgCompletion >= 0 && sim.avgCompletion <= 100)).toBe(true);
  });
  it('빈 선택 → 0 / null', () => {
    const sim = simulateDraft([]);
    expect(sim.trackCount).toBe(0);
    expect(sim.avgCompletion).toBeNull();
  });
});

describe('상수/헬퍼', () => {
  it('업종 프로필/버킷 라벨/미지원', () => {
    expect(getProfile('cafe')?.label).toBe('카페');
    expect(getProfile('none')).toBeNull();
    expect(BUCKET_LABEL.verified).toBe('검증');
    expect(UNSUPPORTED_METADATA.length).toBeGreaterThan(0);
    const sum = DEFAULT_BUDGET.verified + DEFAULT_BUDGET.test_pool + DEFAULT_BUDGET.promoted + DEFAULT_BUDGET.longterm;
    expect(sum).toBeCloseTo(1, 5);
  });
});
