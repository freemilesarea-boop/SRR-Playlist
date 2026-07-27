import { describe, it, expect } from 'vitest';
import {
  type BuilderTrack,
  isVocalTrack,
  effectiveScore,
  dedupeTracks,
  totalDuration,
  formatTotalDuration,
  artistDistribution,
  genreDistribution,
  energyDistribution,
  generateReasons,
  generateWarnings,
  filterCandidates,
  runQualityCheck,
  hasBlockingIssues,
  summarizeIssues,
  suggestOrder,
  sameOrder,
  toSaveTrackIds,
  suggestCloneTitle,
  mapAdminTrack,
  enrichWithDashboard,
  enrichWithCandidatePool,
  markAlreadyIn,
} from './playlistBuilder';

function bt(over: Partial<BuilderTrack> = {}): BuilderTrack {
  return {
    track_id: over.track_id ?? 't1',
    title: 'Title',
    artist: 'A',
    genre: 'jazz',
    mood: 'calm',
    bpm: 90,
    energyLevel: 3,
    vocalPresence: 1,
    instrumental: true,
    explicit: false,
    duration: 180,
    coverUrl: 'https://c/1.jpg',
    audioUrl: 'https://cdn/1.mp3',
    audioHash: null,
    fitScore: 85,
    fitStatus: 'active',
    adaptiveScore: null,
    reactionScore: null,
    difference: null,
    completionRate: null,
    skipRate: null,
    sampleCount: null,
    learningStatus: null,
    guardrailBlocked: false,
    guardrailPenalty: 0,
    guardrailSeverity: null,
    alreadyInPlaylist: false,
    ...over,
  };
}

describe('isVocalTrack / effectiveScore', () => {
  it('resolves vocal flag from instrumental then presence', () => {
    expect(isVocalTrack(bt({ instrumental: true }))).toBe(false);
    expect(isVocalTrack(bt({ instrumental: false }))).toBe(true);
    expect(isVocalTrack(bt({ instrumental: null, vocalPresence: 4 }))).toBe(true);
    expect(isVocalTrack(bt({ instrumental: null, vocalPresence: 1 }))).toBe(false);
    expect(isVocalTrack(bt({ instrumental: null, vocalPresence: null }))).toBeNull();
  });
  it('prefers adaptive then fit then null', () => {
    expect(effectiveScore(bt({ adaptiveScore: 70, fitScore: 90 }))).toBe(70);
    expect(effectiveScore(bt({ adaptiveScore: null, fitScore: 90 }))).toBe(90);
    expect(effectiveScore(bt({ adaptiveScore: null, fitScore: null }))).toBeNull();
  });
});

describe('dedupe / duration / distributions', () => {
  it('dedupes by track_id preserving order', () => {
    const r = dedupeTracks([bt({ track_id: 'a' }), bt({ track_id: 'b' }), bt({ track_id: 'a' })]);
    expect(r.map((t) => t.track_id)).toEqual(['a', 'b']);
  });
  it('sums duration ignoring null/negative', () => {
    expect(totalDuration([bt({ duration: 100 }), bt({ duration: null }), bt({ duration: 200 })])).toBe(300);
  });
  it('formats total duration', () => {
    expect(formatTotalDuration(65)).toBe('1:05');
    expect(formatTotalDuration(3661)).toBe('1:01:01');
    expect(formatTotalDuration(0)).toBe('0:00');
  });
  it('artist/genre distributions sorted by count desc', () => {
    const tracks = [bt({ track_id: '1', artist: 'A' }), bt({ track_id: '2', artist: 'A' }), bt({ track_id: '3', artist: 'B' })];
    const d = artistDistribution(tracks);
    expect(d[0]).toEqual({ key: 'A', count: 2, ratio: 2 / 3 });
    expect(genreDistribution(tracks)[0].key).toBe('jazz');
  });
  it('energy buckets low/mid/high', () => {
    const d = energyDistribution([bt({ track_id: '1', energyLevel: 1 }), bt({ track_id: '2', energyLevel: 3 }), bt({ track_id: '3', energyLevel: 5 }), bt({ track_id: '4', energyLevel: null })]);
    const keys = d.map((x) => x.key).sort();
    expect(keys).toEqual(['high', 'low', 'mid']);
    expect(d.reduce((a, b) => a + b.count, 0)).toBe(3); // null excluded
  });
});

describe('generateReasons', () => {
  it('produces data-backed human reasons, no fabrication', () => {
    const t = bt({
      fitScore: 92, instrumental: true, energyLevel: 2,
      completionRate: 0.94, skipRate: 0.05, sampleCount: 40,
    });
    const reasons = generateReasons(t, { storeType: '카페', daypart: '오후' });
    expect(reasons).toContain('카페 적합도 높음 (92)');
    expect(reasons).toContain('보컬 없음');
    expect(reasons).toContain('오후 시간대에 어울리는 에너지');
    expect(reasons).toContain('완청률 94%');
    expect(reasons).toContain('최근 스킵률 낮음');
    expect(reasons).toContain('차단 조건 없음');
  });
  it('omits learning reasons when sample below threshold', () => {
    const t = bt({ completionRate: 0.95, skipRate: 0.02, sampleCount: 5 });
    const reasons = generateReasons(t);
    expect(reasons.some((r) => r.includes('완청률'))).toBe(false);
    expect(reasons).not.toContain('최근 스킵률 낮음');
  });
});

describe('generateWarnings', () => {
  it('flags blocked, penalized, explicit, high skip, low sample', () => {
    const t = bt({ guardrailBlocked: true, guardrailPenalty: 30, explicit: true, skipRate: 0.68, sampleCount: 41, learningStatus: 'active' });
    const w = generateWarnings(t);
    expect(w).toContain('Blocked Guardrail 적용');
    expect(w).toContain('감점 적용 (−30)');
    expect(w).toContain('Explicit 포함');
    expect(w).toContain('해당 매장 스킵률 높음 (68%)');
  });
  it('flags same-artist saturation from the current playlist', () => {
    const t = bt({ track_id: 'x', artist: 'A' });
    const playlist = ['1', '2', '3'].map((id) => bt({ track_id: id, artist: 'A' }));
    expect(generateWarnings(t, playlist)).toContain('동일 아티스트가 이미 3곡 포함됨');
  });
  it('flags missing audio url', () => {
    expect(generateWarnings(bt({ audioUrl: null }))).toContain('Audio URL 누락');
  });
});

describe('filterCandidates', () => {
  const tracks = [
    bt({ track_id: '1', title: 'Lofi Rain', artist: 'A', genre: 'lofi', bpm: 80, energyLevel: 2, instrumental: true, fitScore: 90, adaptiveScore: 88, skipRate: 0.1, sampleCount: 30 }),
    bt({ track_id: '2', title: 'Jazz Cafe', artist: 'B', genre: 'jazz', bpm: 120, energyLevel: 4, instrumental: false, fitScore: 70, adaptiveScore: 60, skipRate: 0.6, sampleCount: 25 }),
    bt({ track_id: '3', title: 'Rock Loud', artist: 'C', genre: 'rock', bpm: 160, energyLevel: 5, instrumental: false, fitScore: 40, guardrailBlocked: true }),
  ];
  it('search matches title/artist/genre', () => {
    expect(filterCandidates(tracks, { query: 'lofi' }).map((t) => t.track_id)).toEqual(['1']);
    expect(filterCandidates(tracks, { query: 'jazz' }).map((t) => t.track_id)).toEqual(['2']); // title+genre
    expect(filterCandidates(tracks, { query: 'b' }).map((t) => t.track_id)).toEqual(['2']); // artist 'B'
  });
  it('bpm/energy range excludes out-of-range and unknowns', () => {
    expect(filterCandidates(tracks, { bpmMin: 100, bpmMax: 130 }).map((t) => t.track_id)).toEqual(['2']);
    expect(filterCandidates(tracks, { energyMin: 4 }).map((t) => t.track_id)).toEqual(['2', '3']);
  });
  it('vocal / instrumental filter', () => {
    expect(filterCandidates(tracks, { vocal: 'instrumental' }).map((t) => t.track_id)).toEqual(['1']);
    expect(filterCandidates(tracks, { vocal: 'vocal' }).map((t) => t.track_id)).toEqual(['2', '3']);
  });
  it('fit/adaptive/skip ranges', () => {
    expect(filterCandidates(tracks, { fitMin: 80 }).map((t) => t.track_id)).toEqual(['1']);
    expect(filterCandidates(tracks, { adaptiveMin: 80 }).map((t) => t.track_id)).toEqual(['1']);
    expect(filterCandidates(tracks, { skipMax: 0.2 }).map((t) => t.track_id)).toEqual(['1']);
  });
  it('exclude blocked / penalized / already-in / artist / id', () => {
    expect(filterCandidates(tracks, { excludeBlocked: true }).map((t) => t.track_id)).toEqual(['1', '2']);
    expect(filterCandidates(tracks, { excludeArtists: ['A'] }).map((t) => t.track_id)).toEqual(['2', '3']);
    expect(filterCandidates(tracks, { excludeTrackIds: ['2'] }).map((t) => t.track_id)).toEqual(['1', '3']);
    const withIn = [bt({ track_id: '9', alreadyInPlaylist: true }), ...tracks];
    expect(filterCandidates(withIn, { excludeAlreadyIn: true }).map((t) => t.track_id)).not.toContain('9');
  });
});

describe('runQualityCheck', () => {
  it('errors on empty, duplicates, blocked, missing audio', () => {
    const issues = runQualityCheck([
      bt({ track_id: '1' }),
      bt({ track_id: '1' }), // duplicate
      bt({ track_id: '2', guardrailBlocked: true }),
      bt({ track_id: '3', audioUrl: null }),
    ], { minTracks: 5 });
    const codes = issues.map((i) => i.code);
    expect(codes).toContain('duplicate_track');
    expect(codes).toContain('blocked_track');
    expect(codes).toContain('missing_audio_url');
    expect(codes).toContain('too_few_tracks');
    expect(hasBlockingIssues(issues)).toBe(true);
  });
  it('warnings do not block', () => {
    const tracks = Array.from({ length: 6 }, (_, i) => bt({ track_id: `t${i}`, artist: 'A', explicit: i === 0 }));
    const issues = runQualityCheck(tracks);
    expect(issues.some((i) => i.code === 'artist_concentration')).toBe(true);
    expect(issues.some((i) => i.code === 'explicit_track')).toBe(true);
    expect(hasBlockingIssues(issues)).toBe(false);
  });
  it('flags below target duration', () => {
    const issues = runQualityCheck([bt({ track_id: '1', duration: 100 })], { minTracks: 1, targetDurationSec: 3600 });
    expect(issues.some((i) => i.code === 'below_target_duration')).toBe(true);
  });
  it('summarizes by severity', () => {
    const issues = runQualityCheck([bt({ track_id: '1', guardrailBlocked: true })], { minTracks: 1 });
    const s = summarizeIssues(issues);
    expect(s.error).toBeGreaterThanOrEqual(1);
  });
});

describe('suggestOrder (advisory)', () => {
  it('separates same-artist adjacency', () => {
    const tracks = [
      bt({ track_id: '1', artist: 'A', genre: 'g1', bpm: 90, energyLevel: 3 }),
      bt({ track_id: '2', artist: 'A', genre: 'g1', bpm: 92, energyLevel: 3 }),
      bt({ track_id: '3', artist: 'B', genre: 'g2', bpm: 91, energyLevel: 3 }),
    ];
    const r = suggestOrder(tracks);
    // No two adjacent share the same artist
    for (let i = 1; i < r.order.length; i++) {
      expect(r.order[i].artist === r.order[i - 1].artist).toBe(false);
    }
  });
  it('pushes blocked/penalized toward the end', () => {
    const tracks = [
      bt({ track_id: '1', guardrailBlocked: true, artist: 'A' }),
      bt({ track_id: '2', artist: 'B' }),
      bt({ track_id: '3', artist: 'C' }),
    ];
    const r = suggestOrder(tracks);
    expect(r.order[r.order.length - 1].track_id).toBe('1');
    expect(r.changed).toBe(true);
  });
  it('single/empty is unchanged and deterministic', () => {
    expect(suggestOrder([]).changed).toBe(false);
    const one = [bt({ track_id: '1' })];
    expect(suggestOrder(one).order).toEqual(one);
  });
  it('is deterministic (same input → same output)', () => {
    const tracks = [bt({ track_id: '1', artist: 'A' }), bt({ track_id: '2', artist: 'B' }), bt({ track_id: '3', artist: 'A' })];
    const a = suggestOrder(tracks).order.map((t) => t.track_id);
    const b = suggestOrder(tracks).order.map((t) => t.track_id);
    expect(a).toEqual(b);
  });
});

describe('sameOrder', () => {
  it('compares by track_id sequence', () => {
    expect(sameOrder([{ track_id: 'a' }, { track_id: 'b' }], [{ track_id: 'a' }, { track_id: 'b' }])).toBe(true);
    expect(sameOrder([{ track_id: 'a' }], [{ track_id: 'b' }])).toBe(false);
  });
});

describe('mapping / enrichment', () => {
  it('maps admin track row with feature fields', () => {
    const t = mapAdminTrack({ id: 'x', title: 'T', artist: 'A', main_genre: 'jazz', bpm: 100, energy_level: 4, instrumental: false, explicit_content: true, duration: 200, cover_url: 'c', audio_url: 'a', audio_sha256: 'h' });
    expect(t).toMatchObject({ track_id: 'x', genre: 'jazz', bpm: 100, energyLevel: 4, instrumental: false, explicit: true, audioHash: 'h' });
    expect(t.fitScore).toBeNull(); // not scored yet
  });
  it('enriches with dashboard (adaptive fallback to live)', () => {
    const base = [mapAdminTrack({ id: 'x' })];
    const r = enrichWithDashboard(base, [{ track_id: 'x', fit_score: 95, adaptive_score_live: 75, difference: -20, skip_rate: 0.68, sample_count: 41, learning_status: 'active' }]);
    expect(r[0]).toMatchObject({ fitScore: 95, adaptiveScore: 75, difference: -20, skipRate: 0.68, sampleCount: 41, learningStatus: 'active' });
  });
  it('enriches with candidate pool (guardrail + adaptive)', () => {
    const base = [mapAdminTrack({ id: 'x' })];
    const r = enrichWithCandidatePool(base, [{ track_id: 'x', fit_score: 80, adaptive_score: 80, fit_status: 'review_needed', guardrail_blocked: false, guardrail_penalty: 50, guardrail_severity: 'soft_block' }]);
    expect(r[0]).toMatchObject({ fitStatus: 'review_needed', guardrailPenalty: 50, guardrailSeverity: 'soft_block' });
  });
  it('marks already-in-playlist', () => {
    const base = [mapAdminTrack({ id: 'x' }), mapAdminTrack({ id: 'y' })];
    const r = markAlreadyIn(base, ['y']);
    expect(r.find((t) => t.track_id === 'y')?.alreadyInPlaylist).toBe(true);
    expect(r.find((t) => t.track_id === 'x')?.alreadyInPlaylist).toBe(false);
  });
});

describe('filterCandidates — genre/explicit extensions (UX-2)', () => {
  it('includeGenres: loose any-of match', () => {
    const rows = [
      mapAdminTrack({ id: 'a', main_genre: 'Lofi Beats' }),
      mapAdminTrack({ id: 'b', main_genre: 'EDM' }),
    ];
    const r = filterCandidates(rows, { includeGenres: ['lofi', 'jazz'] });
    expect(r.map((t) => t.track_id)).toEqual(['a']);
  });
  it('excludeGenres: loose any-of block', () => {
    const rows = [
      mapAdminTrack({ id: 'a', main_genre: 'ambient' }),
      mapAdminTrack({ id: 'b', main_genre: 'jazz' }),
    ];
    const r = filterCandidates(rows, { excludeGenres: ['ambient'] });
    expect(r.map((t) => t.track_id)).toEqual(['b']);
  });
  it('excludeExplicit: only true excluded, null passes', () => {
    const rows = [
      mapAdminTrack({ id: 'a', explicit_content: true }),
      mapAdminTrack({ id: 'b', explicit_content: false }),
      mapAdminTrack({ id: 'c' }), // null explicit
    ];
    const r = filterCandidates(rows, { excludeExplicit: true });
    expect(r.map((t) => t.track_id).sort()).toEqual(['b', 'c']);
  });
});

describe('save payload + clone title', () => {
  it('toSaveTrackIds preserves order and drops duplicates/empties', () => {
    const ids = toSaveTrackIds([
      { track_id: 'b' },
      { track_id: 'a' },
      { track_id: 'b' }, // dup
      { track_id: '' }, // empty
      { track_id: 'c' },
    ]);
    expect(ids).toEqual(['b', 'a', 'c']);
  });
  it('toSaveTrackIds returns empty for empty input', () => {
    expect(toSaveTrackIds([])).toEqual([]);
  });
  it('suggestCloneTitle appends (사본)', () => {
    expect(suggestCloneTitle('아침 재즈')).toBe('아침 재즈 (사본)');
  });
  it('suggestCloneTitle increments existing (사본)', () => {
    expect(suggestCloneTitle('아침 재즈 (사본)')).toBe('아침 재즈 (사본 2)');
    expect(suggestCloneTitle('아침 재즈 (사본 2)')).toBe('아침 재즈 (사본 3)');
  });
  it('suggestCloneTitle handles blank/nullish title', () => {
    expect(suggestCloneTitle('')).toBe('제목 없음 (사본)');
    expect(suggestCloneTitle(null)).toBe('제목 없음 (사본)');
    expect(suggestCloneTitle(undefined)).toBe('제목 없음 (사본)');
  });
});
