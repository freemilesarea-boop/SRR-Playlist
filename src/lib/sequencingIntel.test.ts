import { describe, expect, it } from 'vitest';
import {
  BLOCKED_SEQUENCE_ACTIONS, DEFAULT_SEQ_CONFIG, FIXED_SEQUENCE_WARNING,
  HARMONIC_TRANSITION_STATUS, SEQUENCE_LIMITS, SEQ_ALGORITHM_VERSION,
  buildSequenceExplanation, buildSequencePayload, buildTargetCurve, compareOrders,
  computeOrderStats, computeSequenceQuality, evaluateTransition, generateSequence,
  isBlockedSequenceAction, normalizeSequenceTrack, vocalState,
  type SeqInputRow, type SequencingConfig, type SequencingTrackFeature, type SequenceSuccess,
} from './sequencingIntel';

function mkRow(i: number, over: Partial<SeqInputRow> = {}): SeqInputRow {
  return {
    track_id: `t-${String(i).padStart(3, '0')}`, original_draft_order: i,
    title: `Track ${i}`, artist: `artist-${i}`, album_name: `album-${i}`,
    main_genre: i % 2 ? 'jazz' : 'pop', mood: '차분한', instrumental: true,
    energy: 0.3 + (i % 5) * 0.1, vocal_presence: 0.2, bpm: 80 + (i % 6) * 5,
    fit_score: 80, events: 5,
    ...over,
  };
}
function mkTracks(n: number, over: (i: number) => Partial<SeqInputRow> = () => ({})): SequencingTrackFeature[] {
  return Array.from({ length: n }, (_, i) => normalizeSequenceTrack(mkRow(i, over(i))));
}
function cfg(over: Partial<SequencingConfig> = {}): SequencingConfig {
  return { ...DEFAULT_SEQ_CONFIG, ...over };
}
function ok(r: ReturnType<typeof generateSequence>): SequenceSuccess {
  if (!r.ok) throw new Error(`expected success, got ${r.reasons.join(',')}`);
  return r;
}

describe('입력 정규화 / Vocal 판정', () => {
  it('결측 Energy/BPM/Vocal/Genre 를 missing_* 로 표시하고 보간하지 않는다', () => {
    const t = normalizeSequenceTrack(mkRow(1, { energy: null, bpm: null, instrumental: null, vocal_presence: null, main_genre: null }));
    expect(t.missing).toEqual(expect.arrayContaining(['missing_energy', 'missing_bpm', 'missing_vocal', 'missing_genre']));
    expect(t.energy).toBeNull();
    expect(vocalState(t)).toBeNull();
  });

  it('instrumental 명시가 vocal_presence 보다 우선한다', () => {
    const t = normalizeSequenceTrack(mkRow(1, { instrumental: true, vocal_presence: 0.9 }));
    expect(vocalState(t)).toBe(false);
    const v = normalizeSequenceTrack(mkRow(2, { instrumental: null, vocal_presence: 0.9 }));
    expect(vocalState(v)).toBe(true);
  });
});

describe('결정론 / 무결성', () => {
  it('동일 입력+Seed → 동일 순서, 다른 Seed 도 유효한 순열', () => {
    const tracks = mkTracks(20);
    const a = ok(generateSequence(tracks, cfg({ seed: 7 })));
    const b = ok(generateSequence(tracks, cfg({ seed: 7 })));
    const c = ok(generateSequence(tracks, cfg({ seed: 99 })));
    expect(a.ordered.map((t) => t.trackId)).toEqual(b.ordered.map((t) => t.trackId));
    expect(new Set(c.ordered.map((t) => t.trackId)).size).toBe(20);
  });

  it('Track Set 불변 — 추가/누락/중복 없음', () => {
    const tracks = mkTracks(15);
    const r = ok(generateSequence(tracks, cfg()));
    const inIds = tracks.map((t) => t.trackId).sort();
    const outIds = r.ordered.map((t) => t.trackId).sort();
    expect(outIds).toEqual(inIds);
  });

  it('0곡/1곡/상한 초과/중복 Track 은 sequence_generation_failed', () => {
    expect(generateSequence([], cfg()).ok).toBe(false);
    expect(generateSequence(mkTracks(1), cfg()).ok).toBe(false);
    const over = mkTracks(SEQUENCE_LIMITS.maxTracks + 1);
    expect(generateSequence(over, cfg()).ok).toBe(false);
    const dup = [...mkTracks(2), ...mkTracks(1)];
    const r = generateSequence(dup, cfg());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons).toContain('hard_constraint_conflict');
  });

  it('2곡도 순서를 생성한다', () => {
    const r = ok(generateSequence(mkTracks(2), cfg()));
    expect(r.ordered).toHaveLength(2);
    expect(r.transitions[0].fromTrackId).toBeNull();
  });
});

describe('고정 Position / Start / End (Hard)', () => {
  it('고정 Start/End 를 준수한다', () => {
    const tracks = mkTracks(8);
    const r = ok(generateSequence(tracks, cfg({ startTrackId: 't-005', endTrackId: 't-002' })));
    expect(r.ordered[0].trackId).toBe('t-005');
    expect(r.ordered[7].trackId).toBe('t-002');
  });

  it('고정 Position 충돌/범위 초과/미존재 Track 은 저장 차단 사유로 실패한다', () => {
    const tracks = mkTracks(5);
    expect(generateSequence(tracks, cfg({ pinnedPositions: { 't-001': 9 } })).ok).toBe(false);
    expect(generateSequence(tracks, cfg({ pinnedPositions: { 'ghost': 0 } })).ok).toBe(false);
    const conflict = generateSequence(tracks, cfg({ startTrackId: 't-001', pinnedPositions: { 't-002': 0 } }));
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.reasons).toContain('manual_review_required');
    expect(generateSequence(tracks, cfg({ startTrackId: 't-001', endTrackId: 't-001' })).ok).toBe(false);
  });
});

describe('Spacing / Flow 제약', () => {
  it('동일 아티스트 인접을 회피한다(가능한 구성일 때)', () => {
    const tracks = mkTracks(6, (i) => ({ artist: i < 3 ? 'dup' : `a-${i}`, album_name: `al-${i}` }));
    const r = ok(generateSequence(tracks, cfg({ artistMinGap: 2 })));
    const stats = computeOrderStats(r.ordered);
    expect(stats.adjacentSameArtist).toBe(0);
  });

  it('만족 불가능하면 간격을 완화하고 기록한다 — Hard 는 완화하지 않는다', () => {
    const tracks = mkTracks(4, () => ({ artist: 'same', album_name: 'same-album' }));
    const r = ok(generateSequence(tracks, cfg({ artistMinGap: 3 })));
    expect(r.relaxations.length).toBeGreaterThan(0);
    expect(r.relaxations[0].constraint).toBe('artist_min_gap');
    expect(r.relaxations[0].note).toContain('완화했습니다');
    expect(r.ordered).toHaveLength(4); // Track Set 은 그대로
  });

  it('동일 앨범 인접을 회피한다', () => {
    const tracks = mkTracks(6, (i) => ({ album_name: i < 3 ? 'dup-album' : `al-${i}`, artist: `a-${i}` }));
    const r = ok(generateSequence(tracks, cfg()));
    expect(computeOrderStats(r.ordered).adjacentSameAlbum).toBe(0);
  });

  it('장르 최대 연속 제한을 반영한다', () => {
    const tracks = mkTracks(8, (i) => ({ main_genre: i < 5 ? 'jazz' : 'pop', artist: `a-${i}`, album_name: `al-${i}` }));
    const r = ok(generateSequence(tracks, cfg({ maxGenreRun: 2 })));
    expect(computeOrderStats(r.ordered).maxGenreRun).toBeLessThanOrEqual(3); // 5:3 구성상 최대 완충 1
  });

  it('Vocal 연속 제한을 반영한다', () => {
    const tracks = mkTracks(8, (i) => ({ instrumental: i < 5 ? false : true, artist: `a-${i}`, album_name: `al-${i}` }));
    const r = ok(generateSequence(tracks, cfg({ maxVocalRun: 2 })));
    expect(computeOrderStats(r.ordered).maxVocalRun).toBeLessThanOrEqual(3);
  });

  it('고피로 Track 인접을 억제한다', () => {
    const tracks = mkTracks(6, (i) => ({ events: i < 3 ? 100 : 0, artist: `a-${i}`, album_name: `al-${i}` }));
    const r = ok(generateSequence(tracks, cfg()));
    const stats = computeOrderStats(r.ordered);
    expect(stats.highFatigueAdjacent).toBeLessThanOrEqual(1);
  });
});

describe('Energy Curve 전략', () => {
  it('energy_rise 는 상승 경향, energy_fall 은 하강 경향을 만든다', () => {
    const tracks = mkTracks(10, (i) => ({ energy: 0.1 + i * 0.08, artist: `a-${i}`, album_name: `al-${i}`, main_genre: `g-${i}` }));
    const rise = ok(generateSequence(tracks, cfg({ strategy: 'energy_rise' })));
    const fall = ok(generateSequence(tracks, cfg({ strategy: 'energy_fall' })));
    const firstHalf = (r: SequenceSuccess) => r.ordered.slice(0, 5).map((t) => t.energy ?? 0).reduce((s, v) => s + v, 0);
    const secondHalf = (r: SequenceSuccess) => r.ordered.slice(5).map((t) => t.energy ?? 0).reduce((s, v) => s + v, 0);
    expect(firstHalf(rise)).toBeLessThan(secondHalf(rise));
    expect(firstHalf(fall)).toBeGreaterThan(secondHalf(fall));
  });

  it('steady 는 목표 Curve 를 중앙값으로 유지하고, daypart 는 insufficient_data 를 기록한다', () => {
    const energies = [0.2, 0.4, 0.6, 0.8];
    const steady = buildTargetCurve('steady', 4, energies);
    expect(steady.target).not.toBeNull();
    expect(new Set(steady.target as number[]).size).toBe(1);
    const daypart = buildTargetCurve('daypart', 4, energies);
    expect(daypart.target).toBeNull();
    expect(daypart.notes[0]).toContain('insufficient_data');
  });

  it('Energy 실측값이 부족하면 목표 Curve 를 만들지 않는다(보간 금지)', () => {
    const c = buildTargetCurve('energy_rise', 5, [0.5]);
    expect(c.target).toBeNull();
  });
});

describe('Transition 평가 / BPM', () => {
  it('BPM 은 단순 절대 Delta 로 평가한다(70↔140 동일 Tempo 로 확정하지 않음)', () => {
    const a = normalizeSequenceTrack(mkRow(1, { bpm: 70 }));
    const b = normalizeSequenceTrack(mkRow(2, { bpm: 140, artist: 'other' }));
    const ev = evaluateTransition(a, b, cfg({ maxBpmDelta: 30 }));
    expect(ev.bpmDelta).toBe(70);
    expect(ev.penalties.map((p) => p.code)).toContain('bpm_jump');
  });

  it('결측 신호는 감점이 아니라 completeness 로 분리되고 사유가 남는다', () => {
    const a = normalizeSequenceTrack(mkRow(1, { bpm: null, energy: null }));
    const b = normalizeSequenceTrack(mkRow(2, { bpm: null, energy: null, artist: 'other' }));
    const ev = evaluateTransition(a, b, cfg());
    expect(ev.penalties.map((p) => p.code)).toEqual(expect.arrayContaining(['missing_energy', 'missing_bpm']));
    expect(ev.transitionScore).toBeGreaterThan(0);
  });

  it('BPM 누락률 50% 초과 시 가중치 완화가 기록된다', () => {
    const tracks = mkTracks(6, (i) => ({ bpm: i < 4 ? null : 100, artist: `a-${i}`, album_name: `al-${i}` }));
    const r = ok(generateSequence(tracks, cfg()));
    expect(r.relaxations.some((x) => x.constraint === 'bpm_transition_weight')).toBe(true);
  });
});

describe('Quality / Local Swap / 성능 제한', () => {
  it('Quality Score 와 Grade, Transition 통계를 산출한다', () => {
    const tracks = mkTracks(10, (i) => ({ artist: `a-${i}`, album_name: `al-${i}` }));
    const r = ok(generateSequence(tracks, cfg()));
    const q = computeSequenceQuality(r.ordered, r.transitions, cfg(), '2026-07-19T00:00:00Z');
    expect(q.score).not.toBeNull();
    expect(['A', 'B', 'C', 'D']).toContain(q.grade);
    expect(q.transitionCount).toBe(9);
    expect(q.averageTransitionScore).not.toBeNull();
    expect(q.worstTransitionScore).not.toBeNull();
    expect(q.algorithmVersion).toBe(SEQ_ALGORITHM_VERSION);
    expect(q.insufficientData).toContain('harmonic_transition_not_available');
  });

  it('Hard Violation 이 있으면 점수 0 / D — ready_for_review 승격 불가 신호', () => {
    const tracks = mkTracks(4);
    const r = ok(generateSequence(tracks, cfg()));
    const q = computeSequenceQuality(r.ordered, r.transitions, cfg(), 'now', ['track_set_mismatch']);
    expect(q.score).toBe(0);
    expect(q.grade).toBe('D');
  });

  it('결측률 40% 초과면 insufficient_data', () => {
    const tracks = mkTracks(4, () => ({ energy: null, bpm: null, instrumental: null, vocal_presence: null }));
    const r = ok(generateSequence(tracks, cfg()));
    const q = computeSequenceQuality(r.ordered, r.transitions, cfg(), 'now');
    expect(q.score).toBeNull();
    expect(q.grade).toBe('insufficient_data');
  });

  it('Local Swap 은 반복 상한을 지키고 결과 순열을 보존한다', () => {
    const tracks = mkTracks(30, (i) => ({ artist: `a-${i % 7}`, album_name: `al-${i}` }));
    const r = ok(generateSequence(tracks, cfg()));
    expect(r.swapIterations).toBeLessThanOrEqual(SEQUENCE_LIMITS.maxSwapIterations);
    expect(new Set(r.ordered.map((t) => t.trackId)).size).toBe(30);
  });
});

describe('비교 / Explainability / Payload / 금지 액션', () => {
  it('원본 순서와 Sequence 를 비교한다', () => {
    const tracks = mkTracks(6);
    const r = ok(generateSequence(tracks, cfg({ seed: 3 })));
    const cmp = compareOrders(tracks, r.ordered);
    expect(cmp.a.adjacentSameArtist).toBeGreaterThanOrEqual(0);
    expect(cmp.positionChanged).toBeGreaterThanOrEqual(0);
    expect(cmp.positionChanged).toBeLessThanOrEqual(6);
  });

  it('설명은 결정론적이며 Harmonic not_available 과 고정 경고로 끝난다', () => {
    const tracks = mkTracks(5);
    const c = cfg();
    const r = ok(generateSequence(tracks, c));
    const q = computeSequenceQuality(r.ordered, r.transitions, c, '2026-07-19T00:00:00Z');
    const lines = buildSequenceExplanation('테스트 Draft', c, r, q);
    expect(lines[lines.length - 1]).toBe(FIXED_SEQUENCE_WARNING);
    expect(lines.some((l) => l.includes('not_available'))).toBe(true);
    expect(buildSequenceExplanation('테스트 Draft', c, r, q)).toEqual(lines);
    expect(HARMONIC_TRANSITION_STATUS).toBe('not_available');
  });

  it('payload 는 순열 전체와 constraint snapshot 을 포함한다', () => {
    const tracks = mkTracks(4);
    const c = cfg({ startTrackId: 't-001' });
    const r = ok(generateSequence(tracks, c));
    const q = computeSequenceQuality(r.ordered, r.transitions, c, 'now');
    const payload = buildSequencePayload('시퀀스', 'draft-uuid', c, r, ['설명'], q) as {
      ordering: Array<{ track_id: string; sequence_position: number }>;
      constraint_snapshot: Record<string, unknown>;
    };
    expect(payload.ordering).toHaveLength(4);
    expect(payload.ordering[0].sequence_position).toBe(0);
    expect(payload.constraint_snapshot.start_track_id).toBe('t-001');
  });

  it('Position Apply/Queue/Player/Publish/자동 승인은 전부 차단 목록', () => {
    expect(BLOCKED_SEQUENCE_ACTIONS).toHaveLength(8);
    for (const a of BLOCKED_SEQUENCE_ACTIONS) expect(isBlockedSequenceAction(a)).toBe(true);
    expect(isBlockedSequenceAction('automatic_position_apply')).toBe(true);
    expect(isBlockedSequenceAction('view_sequence')).toBe(false);
  });
});
