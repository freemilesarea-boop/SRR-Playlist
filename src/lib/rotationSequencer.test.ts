// Phase AI-PLAYLIST-5 — Adaptive Rotation & Anti-Fatigue Sequencing 순수 로직 단위 테스트.
// 결정론적·중복없음·Hard/Soft Constraint·Fatigue/Rediscovery·Budget·Simulation·Comparison·NaN 금지.
import { describe, it, expect } from 'vitest';
import {
  buildProfile, classifyBucket, budgetSum, budgetValid, sequencingScore, generateSequence,
  simulateSequence, compareSequences, aggregateRotationLearning,
  DEFAULT_ROTATION_BUDGET, DEFAULT_SEQUENCE_CONFIG, SUPPORT_MATRIX, BUCKET_LABEL,
  type RotationTrack, type SequenceConfig,
} from './rotationSequencer';

const NOW = 1_700_000_000_000;

function trk(over: Partial<RotationTrack> = {}): RotationTrack {
  return {
    track_id: 't1', title: 'S1', artist: 'A', main_genre: 'Lo-fi', mood: '차분한', bpm: 80, duration: 200,
    events: 30, skip_rate: 3, completion_rate: 76, p1d: 0, p7d: 3, p30d: 20,
    last_played_at: new Date(NOW - 5 * 86400e3).toISOString(), days_since_last_play: 5, rollout_stage: 'global', compatibility: 80, ...over,
  };
}
function pool(n: number): RotationTrack[] {
  return Array.from({ length: n }, (_, i) => trk({ track_id: `t${i}`, title: `S${i}`, artist: `Artist${i % 4}`, main_genre: i % 2 ? 'Jazz' : 'Lo-fi', completion_rate: 70 + (i % 10) }));
}

describe('buildProfile — Fatigue/Freshness/Rediscovery', () => {
  it('최근 다수 재생 → Fatigue 높음', () => {
    const p = buildProfile(trk({ p1d: 5, p7d: 20, p30d: 60, days_since_last_play: 0.5 }), NOW);
    expect(p.fatigue).toBeGreaterThan(60);
    expect(p.freshness).toBe(100 - p.fatigue);
  });
  it('성과 좋고 장기 미노출 → Rediscovery 높음', () => {
    const p = buildProfile(trk({ completion_rate: 85, skip_rate: 1, days_since_last_play: 30, p7d: 0, p1d: 0, p30d: 2 }), NOW);
    expect(p.rediscovery).toBeGreaterThan(20);
  });
  it('최근 미재생이어도 저성과는 Rediscovery 낮음', () => {
    const good = buildProfile(trk({ completion_rate: 88, skip_rate: 1, days_since_last_play: 40, p1d: 0, p7d: 0, p30d: 2 }), NOW);
    const bad = buildProfile(trk({ completion_rate: 25, skip_rate: 60, days_since_last_play: 40, p1d: 0, p7d: 0, p30d: 2 }), NOW);
    expect(bad.rediscovery).toBeLessThan(good.rediscovery); // 저성과는 고성과보다 낮음(성과+비노출 함께 사용)
  });
  it('메타/이벤트 없음 → NaN 없음', () => {
    const p = buildProfile(trk({ completion_rate: null, skip_rate: null, last_played_at: null, days_since_last_play: null, p1d: 0, p7d: 0, p30d: 0 }), NOW);
    expect(Number.isFinite(p.fatigue)).toBe(true);
    expect(Number.isFinite(p.rediscovery)).toBe(true);
  });
});

describe('budget', () => {
  it('기본 예산 합 100', () => { expect(budgetSum(DEFAULT_ROTATION_BUDGET)).toBe(100); expect(budgetValid(DEFAULT_ROTATION_BUDGET)).toBe(true); });
  it('합 100 아니면 invalid', () => { expect(budgetValid({ ...DEFAULT_ROTATION_BUDGET, surprise: 10 })).toBe(false); });
});

describe('sequencingScore — 존재 신호만 재정규화', () => {
  it('bpm null/last null → bpm_flow present=false, NaN 없음', () => {
    const p = buildProfile(trk({ bpm: null }), NOW);
    const { score, signals } = sequencingScore(p, { lastBpm: null });
    expect(signals.find((s) => s.key === 'bpm_flow')!.present).toBe(false);
    expect(score).toBeGreaterThanOrEqual(0); expect(score).toBeLessThanOrEqual(100);
  });
});

describe('generateSequence — 결정론적·중복없음·Constraint', () => {
  const cfg: SequenceConfig = { ...DEFAULT_SEQUENCE_CONFIG, targetCount: 8 };
  it('Track 중복 없음, 순서 결정론적(재현)', () => {
    const p = pool(12);
    const a = generateSequence(p, cfg, NOW);
    const b = generateSequence(p, cfg, NOW);
    const ids = a.sequence.map((s) => s.track.track_id);
    expect(new Set(ids).size).toBe(ids.length); // 중복 없음
    expect(ids).toEqual(b.sequence.map((s) => s.track.track_id)); // 재현
  });
  it('Track 없음/1개', () => {
    expect(generateSequence([], cfg, NOW).sequence).toEqual([]);
    expect(generateSequence([trk()], cfg, NOW).sequence.length).toBe(1);
  });
  it('Hard: Fatigue 초과 제외', () => {
    const hot = trk({ track_id: 'hot', p1d: 10, p7d: 40, p30d: 100, days_since_last_play: 0.2 });
    const r = generateSequence([hot, ...pool(5)], { ...cfg, maxFatigue: 50 }, NOW);
    expect(r.excluded.some((e) => e.track.track_id === 'hot')).toBe(true);
    expect(r.sequence.some((s) => s.track.track_id === 'hot')).toBe(false);
  });
  it('Hard: 금지 장르 제외', () => {
    const r = generateSequence(pool(6), { ...cfg, bannedGenres: ['Jazz'] }, NOW);
    expect(r.sequence.every((s) => (s.track.main_genre ?? '').toLowerCase() !== 'jazz')).toBe(true);
  });
  it('Soft: 연속 동일 아티스트 회피(가능할 때)', () => {
    const p = [trk({ track_id: 'a1', artist: 'X', main_genre: 'Lo-fi' }), trk({ track_id: 'a2', artist: 'X', main_genre: 'Lo-fi' }), trk({ track_id: 'b1', artist: 'Y', main_genre: 'Jazz' })];
    const r = generateSequence(p, { ...cfg, targetCount: 3 }, NOW);
    let consec = 0;
    for (let i = 1; i < r.sequence.length; i++) if (r.sequence[i].track.artist === r.sequence[i - 1].track.artist) consec++;
    expect(consec).toBeLessThanOrEqual(1); // 최소화
  });
  it('후보 부족 시 완화 기록', () => {
    const p = [trk({ track_id: 'a1', artist: 'X' }), trk({ track_id: 'a2', artist: 'X' })]; // 전부 동일 아티스트
    const r = generateSequence(p, { ...cfg, targetCount: 2 }, NOW);
    expect(r.sequence.length).toBe(2);
    expect(r.relaxations.length).toBeGreaterThan(0); // 연속 아티스트 완화
  });
});

describe('simulateSequence — 실측 집계', () => {
  it('집계 필드 범위·NaN 없음', () => {
    const r = generateSequence(pool(10), { ...DEFAULT_SEQUENCE_CONFIG, targetCount: 6 }, NOW);
    const s = simulateSequence(r);
    expect(s.trackCount).toBe(r.sequence.length);
    expect(s.avgFatigue).toBeGreaterThanOrEqual(0); expect(s.avgFatigue).toBeLessThanOrEqual(100);
    expect(s.maxArtistShare).toBeGreaterThanOrEqual(0); expect(s.maxArtistShare).toBeLessThanOrEqual(100);
    expect(s.nullMetadataRate).toBeGreaterThanOrEqual(0);
  });
  it('빈 시퀀스 → 0/null', () => {
    const s = simulateSequence({ sequence: [], excluded: [], relaxations: [], bucketActual: { core_verified: 0, recent_winner: 0, new_test: 0, rediscovery: 0, surprise: 0 }, bucketTarget: { core_verified: 0, recent_winner: 0, new_test: 0, rediscovery: 0, surprise: 0 } });
    expect(s.trackCount).toBe(0); expect(s.avgCompletion).toBeNull();
  });
});

describe('compareSequences — Simulation 만 비교', () => {
  it('다양성/Fatigue 방향 비교', () => {
    const a = simulateSequence(generateSequence(pool(8), { ...DEFAULT_SEQUENCE_CONFIG, targetCount: 6 }, NOW));
    const b = simulateSequence(generateSequence(pool(8), { ...DEFAULT_SEQUENCE_CONFIG, targetCount: 6, maxConsecutiveArtist: 3 }, NOW));
    const cmp = compareSequences(a, b);
    expect(cmp.length).toBeGreaterThan(0);
    expect(cmp.every((c) => ['existing', 'rotation', 'tie', 'na'].includes(c.better))).toBe(true);
  });
});

describe('classifyBucket / Learning / Support', () => {
  it('버킷 분류', () => {
    expect(classifyBucket(buildProfile(trk({ rollout_stage: 'test_pool' }), NOW))).toBe('new_test');
    expect(classifyBucket(buildProfile(trk({ completion_rate: 85, skip_rate: 1, days_since_last_play: 30, p7d: 0, p1d: 0, p30d: 2 }), NOW))).toBe('rediscovery');
  });
  it('learning 승인율', () => {
    const l = aggregateRotationLearning([{ status: 'approved' }, { status: 'approved' }, { status: 'rejected' }, { status: 'draft' }]);
    expect(l.approved).toBe(2); expect(l.approvalRate).toBeCloseTo(66.7, 1);
  });
  it('Support Matrix — 미지원 명시', () => {
    expect(SUPPORT_MATRIX.find((s) => s.key === 'energy')!.supported).toBe(false);
    expect(SUPPORT_MATRIX.find((s) => s.key === 'store_history')!.supported).toBe(false);
    expect(SUPPORT_MATRIX.find((s) => s.key === 'track_history')!.supported).toBe(true);
    expect(BUCKET_LABEL.core_verified).toBe('Core 검증');
  });
});
