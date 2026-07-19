import { describe, expect, it } from 'vitest';
import {
  BLOCKED_REC_ACTIONS, DEFAULT_REC_CONTEXT, EXPOSURE_LEDGER_STATUS, FIXED_REC_WARNING,
  MAX_EXPLORATION_RATIO, REC_ALGORITHM_VERSION, REC_WEIGHTS,
  buildRecExplanation, buildRecPayload, buildTrackExplanation, compareWithV1,
  computeFinalScore, computePlaylistCompatibility, computeRecommendationQuality,
  computeSequenceCompatibility, evaluateRecEligibility, isBlockedRecAction,
  normalizeRecCandidate, rankRecommendations,
  type RecPoolRow, type RecommendationContext,
} from './recommendIntelV2';
import { normalizeSequenceTrack } from './sequencingIntel';
import { normalizeCandidate as normalizePlaylistCandidate } from './playlistIntelCore';

const NOW = Date.parse('2026-07-19T00:00:00Z');

function mkRow(i: number, over: Partial<RecPoolRow> = {}): RecPoolRow {
  return {
    track_id: `t-${String(i).padStart(3, '0')}`,
    title: `Track ${i}`, artist: `artist-${i}`, album_name: `album-${i}`,
    main_genre: i % 2 ? 'jazz' : 'pop', sub_genre: null, mood: '차분한',
    bpm: 90, duration: 200, release_date: '2026-07-01',
    explicit_content: false, instrumental: true,
    energy: 0.4, vocal_presence: 0.2,
    qc_score: 85, qc_grade: 'A', fit_score: 80, fit_status: 'active',
    behavior_score: 70, completion_rate: 0.8, skip_rate: 0.1,
    play_count: 50, unique_listener_count: 20,
    like_count: 0, dislike_count: 0, like_ratio: null, dislike_ratio: null, total_reactions: 0,
    events: 5, last_event_at: null,
    in_source_playlist: false, store_excluded: false, genre_blocked: false,
    ...over,
  };
}
function ctx(over: Partial<RecommendationContext> = {}): RecommendationContext {
  return { ...DEFAULT_REC_CONTEXT, storeType: 'cafe', targetCount: 5, ...over };
}
const NO_INPUTS = { baselinePlaylist: null, currentTrack: null, nextTrack: null };

describe('Hard Eligibility Gate', () => {
  it('매장 제외/차단 장르/Explicit/Instrumental/QC 미달/fit excluded/현재곡/최근재생/Playlist 중복을 제외한다', () => {
    const base = ctx({ minQc: 70, blockedGenres: ['trot'], currentTrackId: 't-777', recentTrackIds: ['t-888'], recentPlayExcludeDays: 3 });
    const codes = (row: Partial<RecPoolRow>) => evaluateRecEligibility(mkRow(1, row), base, NOW).map((r) => r.code);
    expect(codes({ store_excluded: true })).toContain('store_exclusion');
    expect(codes({ genre_blocked: true })).toContain('blocked_genre');
    expect(codes({ main_genre: 'trot' })).toContain('blocked_genre');
    expect(codes({ explicit_content: true })).toContain('explicit_blocked');
    expect(codes({ qc_score: 50 })).toContain('qc_below_min');
    expect(codes({ fit_status: 'excluded' })).toContain('store_fit_excluded');
    expect(codes({ track_id: 't-777' })).toContain('current_track');
    expect(codes({ track_id: 't-888' })).toContain('recent_track');
    expect(codes({ in_source_playlist: true })).toContain('playlist_duplicate');
    expect(codes({ last_event_at: '2026-07-18T00:00:00Z' })).toContain('recent_play_window');
    const inst = evaluateRecEligibility(mkRow(1, { instrumental: false }), ctx({ requireInstrumental: true }), NOW);
    expect(inst.map((r) => r.code)).toContain('instrumental_required');
  });

  it('값 없음(null)은 Hard Exclude 가 아니다 — QC null 통과', () => {
    const r = evaluateRecEligibility(mkRow(1, { qc_score: null }), ctx({ minQc: 70 }), NOW);
    expect(r).toHaveLength(0);
  });
});

describe('신호 정규화 / Confidence', () => {
  it('Reaction 은 표본 3건 미만이면 insufficient_data(중립값 생성 없음)', () => {
    const c = normalizeRecCandidate(mkRow(1, { total_reactions: 0 }), ctx(), NOW);
    expect(c.reactionScore).toBeNull();
    expect(c.signalStatuses.reactionSignal).toBe('insufficient_data');
  });

  it('Reaction Confidence 는 표본 수에 비례하고 점수를 중앙으로 수축시킨다', () => {
    const low = normalizeRecCandidate(mkRow(1, { total_reactions: 4, like_ratio: 100, dislike_ratio: 0 }), ctx(), NOW);
    const high = normalizeRecCandidate(mkRow(2, { total_reactions: 40, like_ratio: 100, dislike_ratio: 0 }), ctx(), NOW);
    expect(low.reactionScore).not.toBeNull();
    expect(high.reactionScore).not.toBeNull();
    expect(low.reactionScore as number).toBeLessThan(high.reactionScore as number);
  });

  it('fit 부재 시 업종 기본 Profile 을 default_profile 로 명시해 사용한다', () => {
    const c = normalizeRecCandidate(mkRow(1, { fit_score: null, main_genre: 'jazz' }), ctx({ storeType: 'cafe' }), NOW);
    expect(c.storeFitScore).not.toBeNull();
    expect(c.storeFitSource).toContain('default_profile');
  });

  it('Reputation 은 청취자 표본이 적으면 insufficient — Popularity 와 동일시하지 않는다', () => {
    const c = normalizeRecCandidate(mkRow(1, { behavior_score: 90, unique_listener_count: 1, play_count: 9999 }), ctx(), NOW);
    expect(c.signalStatuses.reputation).toBe('insufficient_data');
  });

  it('Exposure 원장은 not_available — 프록시만 사용하고 상태를 기록한다', () => {
    expect(EXPOSURE_LEDGER_STATUS).toBe('not_available');
    const c = normalizeRecCandidate(mkRow(1), ctx(), NOW);
    expect(c.signalStatuses.exposureControl).toBe('insufficient_data');
  });

  it('Novelty 는 release_date 없으면 insufficient(임의 생성 없음)', () => {
    const c = normalizeRecCandidate(mkRow(1, { release_date: null }), ctx(), NOW);
    expect(c.noveltyScore).toBeNull();
    expect(c.signalStatuses.novelty).toBe('insufficient_data');
  });
});

describe('Compatibility(Phase 1/2 재사용)', () => {
  it('Playlist 기준이 없으면 insufficient, 있으면 Δ 기반 점수', () => {
    const cand = normalizeRecCandidate(mkRow(9, { main_genre: 'rock', artist: 'new-artist' }), ctx(), NOW);
    expect(computePlaylistCompatibility(cand, null, NOW).status).toBe('insufficient_data');
    const baseline = [1, 2, 3].map((i) => normalizePlaylistCandidate({
      track_id: `b-${i}`, title: `B${i}`, artist: `a-${i}`, album_name: `al-${i}`,
      main_genre: 'jazz', sub_genre: null, mood: '차분한', bpm: 90, duration: 200,
      release_date: '2026-07-01', explicit_content: false, instrumental: true,
      energy: 0.4, vocal_presence: 0.2, instrumentalness: 0.8, tempo_stability: 0.9,
      qc_score: 85, qc_grade: 'A', fit_score: 80, fit_status: 'active',
      events: 5, last_event_at: null, store_excluded: false, genre_blocked: false,
    }));
    const r = computePlaylistCompatibility(cand, baseline, NOW);
    expect(r.status).toBe('available');
    expect(r.score).not.toBeNull();
    expect(r.delta).not.toBeNull();
  });

  it('Current Track 없으면 Sequence Compatibility insufficient, 있으면 Transition 재사용', () => {
    const cand = normalizeRecCandidate(mkRow(9), ctx(), NOW);
    expect(computeSequenceCompatibility(cand, null, null).status).toBe('insufficient_data');
    const current = normalizeSequenceTrack({
      track_id: 'cur', original_draft_order: 0, title: 'Cur', artist: 'other', album_name: 'al',
      main_genre: 'jazz', mood: '차분한', instrumental: true, energy: 0.45, vocal_presence: 0.1,
      bpm: 95, fit_score: 80, events: 3,
    });
    const r = computeSequenceCompatibility(cand, current, null);
    expect(r.status).toBe('available');
    expect(r.score).toBeGreaterThan(0);
  });
});

describe('Multi-Objective Score / Ranking', () => {
  it('존재 신호만 재정규화하며 null 은 0점으로 간주하지 않는다', () => {
    const full = normalizeRecCandidate(mkRow(1), ctx(), NOW);
    const sparse = normalizeRecCandidate(mkRow(2, { qc_score: null, behavior_score: null, release_date: null }), ctx(), NOW);
    const a = computeFinalScore(full, []);
    const b = computeFinalScore(sparse, []);
    expect(a.score).toBeGreaterThan(0);
    expect(b.score).toBeGreaterThan(0); // 결측 많아도 0 이 아니라 존재 신호 기준.
    expect(Object.values(REC_WEIGHTS).reduce((s, w) => s + w, 0)).toBe(100);
  });

  it('동일 입력+Seed 동일 순위, Track 중복 없음', () => {
    const rows = Array.from({ length: 30 }, (_, i) => mkRow(i));
    const a = rankRecommendations(rows, ctx({ seed: 5, targetCount: 10 }), NO_INPUTS, NOW);
    const b = rankRecommendations(rows, ctx({ seed: 5, targetCount: 10 }), NO_INPUTS, NOW);
    expect(a.selected.map((c) => c.trackId)).toEqual(b.selected.map((c) => c.trackId));
    expect(new Set(a.selected.map((c) => c.trackId)).size).toBe(a.selected.length);
  });

  it('Artist/Genre 최대 비율 상한을 집행한다', () => {
    const rows = Array.from({ length: 12 }, (_, i) => mkRow(i, { artist: i < 8 ? 'same' : `a-${i}`, main_genre: 'jazz' }));
    const r = rankRecommendations(rows, ctx({ targetCount: 6, maxArtistShare: 0.3, maxGenreShare: 1 }), NO_INPUTS, NOW);
    const sameCount = r.selected.filter((c) => c.artistKey === 'same').length;
    expect(sameCount).toBeLessThanOrEqual(Math.ceil(6 * 0.3));
  });

  it('Exploration Ratio 는 상한(20%)으로 제한되고 저노출/신곡만 배정된다', () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => mkRow(i, { events: 100, release_date: '2025-01-01' })),
      ...Array.from({ length: 5 }, (_, i) => mkRow(50 + i, { events: 2, release_date: '2026-07-10' })),
    ];
    const r = rankRecommendations(rows, ctx({ targetCount: 10, explorationRatio: 0.9 }), NO_INPUTS, NOW);
    expect(MAX_EXPLORATION_RATIO).toBe(0.2);
    const expl = r.selected.filter((c) => c.isExploration);
    expect(expl.length).toBeLessThanOrEqual(Math.floor(10 * MAX_EXPLORATION_RATIO));
    for (const c of expl) expect(c.events).toBeLessThan(10);
  });

  it('모든 후보 Hard Excluded → 선택 0 + 경고', () => {
    const rows = [1, 2, 3].map((i) => mkRow(i, { store_excluded: true }));
    const r = rankRecommendations(rows, ctx({ targetCount: 3 }), NO_INPUTS, NOW);
    expect(r.selected).toHaveLength(0);
    expect(r.eligibleCount).toBe(0);
    expect(r.warnings.some((w) => w.includes('후보 부족'))).toBe(true);
  });

  it('0곡 풀 처리', () => {
    const r = rankRecommendations([], ctx(), NO_INPUTS, NOW);
    expect(r.selected).toHaveLength(0);
  });
});

describe('Quality / v1 비교 / Explainability / 금지', () => {
  it('Quality Score·Grade 와 breakdown 을 산출한다', () => {
    const rows = Array.from({ length: 10 }, (_, i) => mkRow(i));
    const r = rankRecommendations(rows, ctx({ targetCount: 5 }), NO_INPUTS, NOW);
    const q = computeRecommendationQuality(r, '2026-07-19T00:00:00Z');
    expect(q.score).not.toBeNull();
    expect(['A', 'B', 'C', 'D']).toContain(q.grade);
    expect(q.algorithmVersion).toBe(REC_ALGORITHM_VERSION);
    expect(q.insufficientData).toContain('exposure_ledger_not_available');
  });

  it('Hard Violation 이 있으면 0점/D — 승격 불가 신호', () => {
    const rows = Array.from({ length: 5 }, (_, i) => mkRow(i));
    const r = rankRecommendations(rows, ctx({ targetCount: 3 }), NO_INPUTS, NOW);
    const q = computeRecommendationQuality(r, 'now', ['source_policy_violation']);
    expect(q.score).toBe(0);
    expect(q.grade).toBe('D');
  });

  it('핵심 신호 결측 40% 초과면 insufficient_data', () => {
    const rows = Array.from({ length: 4 }, (_, i) => mkRow(i, { fit_score: null, qc_score: null, main_genre: null }));
    const r = rankRecommendations(rows, ctx({ storeType: null, targetCount: 4 }), NO_INPUTS, NOW);
    const q = computeRecommendationQuality(r, 'now');
    expect(q.grade).toBe('insufficient_data');
  });

  it('v1 비교 — Overlap/Only/순위 상관, v1 결과 없음 처리', () => {
    const m = compareWithV1(['a', 'b', 'c', 'd'], ['b', 'a', 'x']);
    expect(m.topNOverlap).toBe(2);
    expect(m.v1Only).toEqual(['x']);
    expect(m.v2Only).toEqual(['c', 'd']);
    expect(m.rankCorrelation).not.toBeNull();
    const empty = compareWithV1(['a'], []);
    expect(empty.topNOverlap).toBe(0);
    expect(empty.rankCorrelation).toBeNull();
  });

  it('설명은 결정론적이고 Reaction 부족·Exposure 프록시를 정직 고지하며 고정 경고로 끝난다', () => {
    const rows = Array.from({ length: 6 }, (_, i) => mkRow(i));
    const c = ctx({ targetCount: 4 });
    const r = rankRecommendations(rows, c, NO_INPUTS, NOW);
    const q = computeRecommendationQuality(r, '2026-07-19T00:00:00Z');
    const lines = buildRecExplanation(c, r, q);
    expect(lines[lines.length - 1]).toBe(FIXED_REC_WARNING);
    expect(lines.some((l) => l.includes('학습 완료를 주장하지 않습니다'))).toBe(true);
    expect(lines.some((l) => l.includes('프록시'))).toBe(true);
    expect(buildRecExplanation(c, r, q)).toEqual(lines);
    const trackLines = buildTrackExplanation(r.selected[0]);
    expect(trackLines.length).toBeGreaterThan(0);
  });

  it('payload 는 rank 0..n-1 조밀 + weight/constraint snapshot 포함(사유 10개 상한)', () => {
    const rows = Array.from({ length: 8 }, (_, i) => mkRow(i));
    const c = ctx({ targetCount: 4 });
    const r = rankRecommendations(rows, c, NO_INPUTS, NOW);
    const q = computeRecommendationQuality(r, 'now');
    const p = buildRecPayload('추천', c, r, ['설명'], q) as {
      tracks: Array<{ rank: number; selected: boolean; selection_reasons: unknown[] }>;
      weight_snapshot: Record<string, number>;
    };
    const selRanks = p.tracks.filter((t) => t.selected).map((t) => t.rank);
    expect(selRanks).toEqual(selRanks.map((_, i) => i));
    expect(p.weight_snapshot.storeFit).toBe(20);
    for (const t of p.tracks) expect(t.selection_reasons.length).toBeLessThanOrEqual(10);
  });

  it('Production 반영/자동 승인 액션은 전부 차단 목록', () => {
    expect(BLOCKED_REC_ACTIONS).toHaveLength(9);
    for (const a of BLOCKED_REC_ACTIONS) expect(isBlockedRecAction(a)).toBe(true);
    expect(isBlockedRecAction('automatic_rollout')).toBe(true);
    expect(isBlockedRecAction('view_draft')).toBe(false);
  });
});
