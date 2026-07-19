import { describe, expect, it } from 'vitest';
import {
  BLOCKED_INTEL_ACTIONS, DEFAULT_INTEL_CONFIG, FIXED_DRAFT_WARNING, INTEL_ALGORITHM_VERSION,
  buildDraftExplanation, buildDraftPayload, computeDiversityMetrics, computeEnergyProfile,
  computeQuality, evaluateHardConstraints, evaluateSoftConstraints, isBlockedIntelAction,
  normalizeCandidate, selectDraftTracks,
  type IntelPoolRow, type PlaylistIntelConfig,
} from './playlistIntelCore';

const NOW = Date.parse('2026-07-19T00:00:00Z');

function mkRow(i: number, over: Partial<IntelPoolRow> = {}): IntelPoolRow {
  return {
    track_id: `t-${String(i).padStart(3, '0')}`,
    title: `Track ${i}`, artist: `artist-${i}`, album_name: `album-${i}`,
    main_genre: 'jazz', sub_genre: null, mood: '차분한',
    bpm: 90, duration: 200, release_date: '2026-07-01',
    explicit_content: false, instrumental: true,
    energy: 0.4, vocal_presence: 0.2, instrumentalness: 0.8, tempo_stability: 0.9,
    qc_score: 90, qc_grade: 'A', fit_score: 80, fit_status: 'active',
    events: 5, last_event_at: null, store_excluded: false, genre_blocked: false,
    ...over,
  };
}

function cfg(over: Partial<PlaylistIntelConfig> = {}): PlaylistIntelConfig {
  return { ...DEFAULT_INTEL_CONFIG, storeType: 'cafe', targetCount: 5, ...over };
}

describe('Candidate 정규화 — 데이터 부족 표시', () => {
  it('fit/qc/energy/특성 누락을 missing_* 로 명시하고 값을 만들지 않는다', () => {
    const c = normalizeCandidate(mkRow(1, { fit_score: null, qc_score: null, energy: null, main_genre: null }));
    expect(c.missing).toEqual(expect.arrayContaining(['missing_store_fit', 'missing_qc', 'missing_energy', 'unknown_feature']));
    expect(c.fitScore).toBeNull();
    expect(c.energy).toBeNull();
  });
});

describe('Hard Constraint — 제외 및 완화 금지', () => {
  it('매장 제외/차단 장르/Explicit/Instrumental/QC 미달/fit excluded 를 각각 차단한다', () => {
    const base = cfg({ blockExplicit: true, requireInstrumental: true, minQc: 70, blockedGenres: ['trot'] });
    const codes = (row: Partial<IntelPoolRow>) =>
      evaluateHardConstraints(normalizeCandidate(mkRow(1, row)), base).map((r) => r.code);
    expect(codes({ store_excluded: true })).toContain('store_policy');
    expect(codes({ genre_blocked: true })).toContain('genre');
    expect(codes({ main_genre: 'trot' })).toContain('genre');
    expect(codes({ explicit_content: true })).toContain('explicit_content');
    expect(codes({ instrumental: false })).toContain('instrumental');
    expect(codes({ qc_score: 50 })).toContain('qc');
    expect(codes({ fit_status: 'excluded' })).toContain('store_fit');
  });

  it('QC 누락(null)은 Hard 위반이 아니다 — 서버 규칙과 동일', () => {
    const r = evaluateHardConstraints(normalizeCandidate(mkRow(1, { qc_score: null })), cfg({ minQc: 70 }));
    expect(r).toHaveLength(0);
  });

  it('모든 후보가 Hard 제외면 선택 0곡 + shortfall', () => {
    const rows = [1, 2, 3].map((i) => mkRow(i, { store_excluded: true }));
    const res = selectDraftTracks(rows, cfg({ targetCount: 3 }), NOW);
    expect(res.selected).toHaveLength(0);
    expect(res.shortfall).toBe(3);
    expect(res.hardViolationCount).toBe(3);
  });
});

describe('Soft Constraint — 감점과 완화 기록', () => {
  it('BPM/Energy 범위 이탈은 감점으로 기록된다(제외 아님)', () => {
    const soft = evaluateSoftConstraints(
      normalizeCandidate(mkRow(1, { bpm: 150, energy: 0.9 })),
      cfg({ bpmMax: 120, energyMax: 0.7 }), NOW, null);
    expect(soft.softExcluded).toBe(false);
    expect(soft.penalties.map((p) => p.code)).toEqual(expect.arrayContaining(['bpm', 'energy']));
  });

  it('목표 미달 시 최소 Store Fit 을 단계 완화하고 기록한다 — Hard 는 완화하지 않는다', () => {
    const rows = [
      mkRow(1, { fit_score: 90 }), mkRow(2, { fit_score: 72 }), mkRow(3, { fit_score: 72 }),
      mkRow(4, { explicit_content: true }),
    ];
    const res = selectDraftTracks(rows, cfg({ targetCount: 3, minStoreFit: 75, blockExplicit: true, maxGenreShare: 1 }), NOW);
    expect(res.relaxations.length).toBeGreaterThan(0);
    expect(res.relaxations[0].constraint).toBe('min_store_fit');
    expect(res.relaxations[0].note).toContain('완화함');
    expect(res.relaxations[0].note).toContain('Hard Constraint는 완화하지 않음');
    // Explicit 차단 곡은 완화 후에도 선택되지 않는다.
    expect(res.selected.map((c) => c.trackId)).not.toContain('t-004');
    expect(res.selected).toHaveLength(3);
  });

  it('최근 재생 제외 기준이 적용된다', () => {
    const rows = [mkRow(1, { last_event_at: '2026-07-18T12:00:00Z' }), mkRow(2)];
    const res = selectDraftTracks(rows, cfg({ targetCount: 1, recentPlayExcludeDays: 3 }), NOW);
    expect(res.selected.map((c) => c.trackId)).toEqual(['t-002']);
    const ex = res.excluded.find((c) => c.trackId === 't-001');
    expect(ex?.exclusionReasons.map((r) => r.code)).toContain('recent_play');
  });
});

describe('선택 엔진 — 결정론/편중 제한/상한', () => {
  it('동일 입력+Seed 는 동일 결과, 목표 곡 수 초과 입력은 200 으로 상한', () => {
    const rows = Array.from({ length: 30 }, (_, i) => mkRow(i, { fit_score: 70 + (i % 5) }));
    const a = selectDraftTracks(rows, cfg({ targetCount: 500, seed: 42 }), NOW);
    const b = selectDraftTracks(rows, cfg({ targetCount: 500, seed: 42 }), NOW);
    expect(a.selected.map((c) => c.trackId)).toEqual(b.selected.map((c) => c.trackId));
    expect(a.selected.length).toBeLessThanOrEqual(200);
  });

  it('동일 아티스트/앨범 제한을 집행하고 사유를 기록한다', () => {
    const rows = [
      mkRow(1, { artist: 'same', album_name: 'alb' }), mkRow(2, { artist: 'same', album_name: 'alb' }),
      mkRow(3, { artist: 'same', album_name: 'alb' }), mkRow(4, { artist: 'other', album_name: 'alb2' }),
    ];
    const res = selectDraftTracks(rows, cfg({ targetCount: 4, maxPerArtist: 2, maxPerAlbum: 2, maxGenreShare: 1 }), NOW);
    const sameCount = res.selected.filter((c) => c.artistKey === 'same').length;
    expect(sameCount).toBeLessThanOrEqual(2);
    const rejected = res.excluded.find((c) => c.exclusionReasons.some((r) => r.code === 'artist_repetition' || r.code === 'album_repetition'));
    expect(rejected).toBeTruthy();
  });

  it('장르 비율 상한을 넘는 선택을 막는다', () => {
    const rows = [
      ...Array.from({ length: 6 }, (_, i) => mkRow(i, { main_genre: 'jazz', artist: `a${i}`, album_name: `b${i}` })),
      ...Array.from({ length: 4 }, (_, i) => mkRow(10 + i, { main_genre: 'pop', artist: `p${i}`, album_name: `q${i}` })),
    ];
    const res = selectDraftTracks(rows, cfg({ targetCount: 6, maxGenreShare: 0.5 }), NOW);
    const jazz = res.selected.filter((c) => c.genre === 'jazz').length;
    expect(jazz).toBeLessThanOrEqual(Math.ceil(6 * 0.5));
  });

  it('0곡 풀은 빈 결과와 목표만큼의 shortfall 을 반환한다', () => {
    const res = selectDraftTracks([], cfg({ targetCount: 5 }), NOW);
    expect(res.selected).toHaveLength(0);
    expect(res.shortfall).toBe(5);
  });

  it('신호가 전혀 없는 곡은 점수 0 + insufficient_data 사유', () => {
    const rows = [mkRow(1, { fit_score: null, qc_score: null, main_genre: null, mood: null, bpm: null })];
    const res = selectDraftTracks(rows, cfg({ storeType: null, targetCount: 1 }), NOW);
    const track = res.selected[0] ?? res.excluded[0];
    expect(track.selectionScore).toBe(0);
    expect(track.selectionReasons.map((r) => r.code)).toContain('insufficient_data');
  });
});

describe('Diversity / Energy', () => {
  it('아티스트·앨범·장르 분포와 누락 비율을 계산한다', () => {
    const rows = [
      mkRow(1, { artist: 'a', album_name: 'x', main_genre: 'jazz' }),
      mkRow(2, { artist: 'a', album_name: 'x', main_genre: 'jazz' }),
      mkRow(3, { artist: 'b', album_name: 'y', main_genre: 'pop', fit_score: null }),
    ];
    const res = selectDraftTracks(rows, cfg({ targetCount: 3, maxPerArtist: 2 }), NOW);
    const m = computeDiversityMetrics(res.selected, NOW);
    expect(m.maxArtistShare).toBeCloseTo(2 / 3, 2);
    expect(m.uniqueAlbumRatio).toBeCloseTo(2 / 3, 2);
    expect(m.genreDistribution.jazz).toBe(2);
    expect(m.missingMetadataRatio).toBeGreaterThan(0);
    expect(m.instrumentalRatio).toBe(1);
  });

  it('Energy 분포·정책 이탈·누락 비율 계산, Daypart 목표는 항상 insufficient_data', () => {
    const rows = [mkRow(1, { energy: 0.2 }), mkRow(2, { energy: 0.8 }), mkRow(3, { energy: null })];
    const res = selectDraftTracks(rows, cfg({ targetCount: 3, maxGenreShare: 1 }), NOW);
    const p = computeEnergyProfile(res.selected, cfg({ energyMax: 0.7 }));
    expect(p.lowRatio).toBeCloseTo(0.5, 2);
    expect(p.highRatio).toBeCloseTo(0.5, 2);
    expect(p.outOfPolicyRatio).toBeCloseTo(0.5, 2);
    expect(p.missingRatio).toBeCloseTo(1 / 3, 2);
    expect(p.daypartTarget).toBe('insufficient_data');
  });

  it('전부 Energy 누락이면 분포를 만들지 않는다', () => {
    const rows = [mkRow(1, { energy: null })];
    const res = selectDraftTracks(rows, cfg({ targetCount: 1 }), NOW);
    const p = computeEnergyProfile(res.selected, cfg());
    expect(p.avg).toBeNull();
    expect(p.stddev).toBeNull();
  });
});

describe('Quality Score / Grade', () => {
  function qualityFor(rows: IntelPoolRow[], c: PlaylistIntelConfig, hard = 0) {
    const res = selectDraftTracks(rows, c, NOW);
    const m = computeDiversityMetrics(res.selected, NOW);
    const e = computeEnergyProfile(res.selected, c);
    return computeQuality(res.selected, hard, m, e, c, '2026-07-19T00:00:00Z');
  }

  it('완전한 데이터에서는 가중 평균 점수와 등급을 산출한다', () => {
    const rows = Array.from({ length: 5 }, (_, i) => mkRow(i, { fit_score: 90, energy: 0.4, artist: `a${i}`, album_name: `b${i}`, main_genre: i % 2 ? 'jazz' : 'pop' }));
    const q = qualityFor(rows, cfg({ targetCount: 5 }));
    expect(q.score).not.toBeNull();
    expect(['A', 'B', 'C', 'D']).toContain(q.grade);
    expect(q.breakdown.policyCompliance).toBe(100);
    expect(q.algorithmVersion).toBe(INTEL_ALGORITHM_VERSION);
  });

  it('Hard 위반이 있으면 failures 에 승격 불가를 기록한다', () => {
    const rows = [mkRow(1)];
    const q = qualityFor(rows, cfg({ targetCount: 1 }), 1);
    expect(q.failures.some((f) => f.includes('ready_for_review'))).toBe(true);
    expect(q.breakdown.policyCompliance).toBe(0);
  });

  it('메타데이터 부족 40% 초과면 높은 점수 대신 insufficient_data', () => {
    const rows = Array.from({ length: 4 }, (_, i) => mkRow(i, { fit_score: null, energy: null, artist: `a${i}` }));
    const q = qualityFor(rows, cfg({ targetCount: 4 }));
    expect(q.score).toBeNull();
    expect(q.grade).toBe('insufficient_data');
    expect(q.insufficientData).toContain('missing_store_fit');
  });

  it('0곡이면 insufficient_data', () => {
    const q = qualityFor([], cfg({ targetCount: 3 }));
    expect(q.grade).toBe('insufficient_data');
  });

  it('무드 목표 분포는 임의 생성하지 않는다(moodBalance null)', () => {
    const q = qualityFor([mkRow(1)], cfg({ targetCount: 1 }));
    expect(q.breakdown.moodBalance).toBeNull();
    expect(q.insufficientData).toContain('mood_balance_target_missing');
  });
});

describe('Explainability / Payload / 금지 액션', () => {
  it('설명은 결정론적 템플릿이며 고정 경고 문구로 끝난다', () => {
    const c = cfg({ targetCount: 2, minStoreFit: 75, blockExplicit: true });
    const rows = [mkRow(1), mkRow(2, { fit_score: 60 }), mkRow(3, { explicit_content: true })];
    const res = selectDraftTracks(rows, c, NOW);
    const m = computeDiversityMetrics(res.selected, NOW);
    const e = computeEnergyProfile(res.selected, c);
    const q = computeQuality(res.selected, 0, m, e, c, '2026-07-19T00:00:00Z');
    const lines = buildDraftExplanation(c, rows.length, res, m, e, q);
    expect(lines[0]).toContain('카페');
    expect(lines.some((l) => l.includes('후보 3곡'))).toBe(true);
    expect(lines[lines.length - 1]).toBe(FIXED_DRAFT_WARNING);
    const again = buildDraftExplanation(c, rows.length, res, m, e, q);
    expect(again).toEqual(lines);
  });

  it('payload 는 서버 재검증 대상 스냅샷을 포함하고 사유를 10개로 상한한다', () => {
    const c = cfg({ targetCount: 2 });
    const rows = [mkRow(1), mkRow(2), mkRow(3, { store_excluded: true })];
    const res = selectDraftTracks(rows, c, NOW);
    const m = computeDiversityMetrics(res.selected, NOW);
    const e = computeEnergyProfile(res.selected, c);
    const q = computeQuality(res.selected, 0, m, e, c, '2026-07-19T00:00:00Z');
    const payload = buildDraftPayload('테스트 Draft', c, rows.length, res, ['설명'], q) as {
      tracks: Array<{ selection_reasons: unknown[]; selected: boolean }>;
      constraint_snapshot: Record<string, unknown>;
      target_track_count: number;
    };
    expect(payload.target_track_count).toBe(2);
    expect(payload.constraint_snapshot.block_explicit).toBe(true);
    expect(payload.tracks.length).toBeGreaterThan(0);
    for (const t of payload.tracks) expect(t.selection_reasons.length).toBeLessThanOrEqual(10);
  });

  it('Publish/Queue/Player/Scheduler/자동 승인 액션은 전부 차단 목록에 있다', () => {
    expect(BLOCKED_INTEL_ACTIONS).toHaveLength(7);
    for (const a of BLOCKED_INTEL_ACTIONS) expect(isBlockedIntelAction(a)).toBe(true);
    expect(isBlockedIntelAction('automatic_publish')).toBe(true);
    expect(isBlockedIntelAction('view_draft')).toBe(false);
  });
});
