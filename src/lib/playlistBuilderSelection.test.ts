import { describe, it, expect } from 'vitest';
import { type BuilderTrack } from './playlistBuilder';
import {
  isSelectable,
  selectableTrackIds,
  toggleSelection,
  selectAllOnPage,
  deselectPage,
  invertSelection,
  selectionSummary,
  replacementFilters,
  findReplacements,
  recommendationTags,
} from './playlistBuilderSelection';

function bt(over: Partial<BuilderTrack> = {}): BuilderTrack {
  return {
    track_id: 't1',
    title: 'T',
    artist: 'A',
    genre: 'jazz',
    mood: 'calm',
    bpm: 90,
    energyLevel: 3,
    vocalPresence: 1,
    instrumental: true,
    explicit: false,
    duration: 180,
    coverUrl: 'c',
    audioUrl: 'a',
    audioHash: null,
    fitScore: 70,
    fitStatus: 'active',
    adaptiveScore: 72,
    reactionScore: null,
    difference: null,
    completionRate: 0.9,
    skipRate: 0.1,
    sampleCount: 30,
    learningStatus: 'active',
    guardrailBlocked: false,
    guardrailPenalty: 0,
    guardrailSeverity: null,
    alreadyInPlaylist: false,
    ...over,
  };
}

describe('bulk selection', () => {
  it('isSelectable excludes blocked/excluded/alreadyIn', () => {
    expect(isSelectable(bt())).toBe(true);
    expect(isSelectable(bt({ guardrailBlocked: true }))).toBe(false);
    expect(isSelectable(bt({ fitStatus: 'excluded' }))).toBe(false);
    expect(isSelectable(bt({ alreadyInPlaylist: true }))).toBe(false);
  });

  it('toggle adds only when selectable, always removes', () => {
    let s = new Set<string>();
    s = toggleSelection(s, 'a', true);
    expect(s.has('a')).toBe(true);
    s = toggleSelection(s, 'a', true); // remove
    expect(s.has('a')).toBe(false);
    s = toggleSelection(s, 'b', false); // blocked → not added
    expect(s.has('b')).toBe(false);
  });

  it('select all on page adds only selectable', () => {
    const page = [bt({ track_id: 'a' }), bt({ track_id: 'b', guardrailBlocked: true }), bt({ track_id: 'c' })];
    const s = selectAllOnPage(new Set(), page);
    expect([...s].sort()).toEqual(['a', 'c']);
  });

  it('deselect page removes page ids', () => {
    const page = [bt({ track_id: 'a' }), bt({ track_id: 'c' })];
    const s = deselectPage(new Set(['a', 'c', 'z']), page);
    expect([...s]).toEqual(['z']);
  });

  it('invert toggles selectable page ids', () => {
    const page = [bt({ track_id: 'a' }), bt({ track_id: 'b' }), bt({ track_id: 'x', guardrailBlocked: true })];
    const s = invertSelection(new Set(['a']), page);
    expect(s.has('a')).toBe(false);
    expect(s.has('b')).toBe(true);
    expect(s.has('x')).toBe(false); // blocked never selected
  });

  it('selectableTrackIds + summary', () => {
    const page = [bt({ track_id: 'a', duration: 100 }), bt({ track_id: 'b', duration: 200, guardrailBlocked: true })];
    expect(selectableTrackIds(page)).toEqual(['a']);
    const sum = selectionSummary(page, new Set(['a', 'b']));
    expect(sum.count).toBe(2);
    expect(sum.totalDurationSec).toBe(300);
  });
});

describe('replacement candidates', () => {
  it('builds filters around target (genre/energy/bpm/vocal, excludes current+target)', () => {
    const target = bt({ track_id: 'x', genre: 'jazz', energyLevel: 3, bpm: 100, instrumental: false, vocalPresence: 4 });
    const f = replacementFilters(target, ['x', 'y']);
    expect(f.includeGenres).toEqual(['jazz']);
    expect(f.energyMin).toBe(2);
    expect(f.energyMax).toBe(4);
    expect(f.bpmMin).toBe(85);
    expect(f.bpmMax).toBe(115);
    expect(f.vocal).toBe('vocal');
    expect(f.excludeBlocked).toBe(true);
    expect(f.excludePenalized).toBe(true);
    expect(f.excludeTrackIds).toContain('x');
    expect(f.excludeTrackIds).toContain('y');
  });

  it('findReplacements returns similar, excludes target/current/blocked, sorted', () => {
    const target = bt({ track_id: 'x', genre: 'jazz', energyLevel: 3, bpm: 100, instrumental: true });
    const catalog = [
      bt({ track_id: 'x', genre: 'jazz' }), // the target itself → excluded
      bt({ track_id: 'g1', genre: 'jazz', energyLevel: 3, bpm: 98, instrumental: true, adaptiveScore: 60 }),
      bt({ track_id: 'g2', genre: 'jazz', energyLevel: 3, bpm: 102, instrumental: true, adaptiveScore: 90 }),
      bt({ track_id: 'b1', genre: 'jazz', energyLevel: 3, bpm: 100, guardrailBlocked: true }),
      bt({ track_id: 'far', genre: 'edm', energyLevel: 5, bpm: 150, instrumental: true }),
    ];
    const res = findReplacements(catalog, target, ['x'], 10);
    const ids = res.map((t) => t.track_id);
    expect(ids).not.toContain('x');
    expect(ids).not.toContain('b1'); // blocked
    expect(ids).not.toContain('far'); // out of range
    expect(ids[0]).toBe('g2'); // higher adaptive first
  });
});

describe('recommendationTags', () => {
  it('positive tags for strong track', () => {
    const t = bt({ fitScore: 85, adaptiveScore: 88, completionRate: 0.9, skipRate: 0.1, instrumental: true });
    const codes = recommendationTags(t).map((x) => x.code);
    expect(codes).toContain('fit_high');
    expect(codes).toContain('adaptive_high');
    expect(codes).toContain('completion_high');
    expect(codes).toContain('skip_low');
    expect(codes).toContain('instrumental');
    expect(recommendationTags(t).every((x) => x.kind === 'positive')).toBe(true);
  });

  it('warning tags for weak/blocked/missing track', () => {
    const t = bt({
      fitScore: 40,
      adaptiveScore: 40,
      completionRate: 0.4,
      skipRate: 0.7,
      sampleCount: 5,
      guardrailBlocked: true,
      audioUrl: null,
      coverUrl: null,
    });
    const codes = recommendationTags(t).map((x) => x.code);
    expect(codes).toContain('blocked');
    expect(codes).toContain('low_sample');
    expect(codes).toContain('skip_high');
    expect(codes).toContain('no_audio');
    expect(codes).toContain('no_artwork');
  });

  it('context tags for artist/genre over-concentration', () => {
    const t = bt({ track_id: 't', artist: 'X', genre: 'jazz' });
    const playlist = [
      bt({ track_id: 'a', artist: 'X', genre: 'jazz' }),
      bt({ track_id: 'b', artist: 'X', genre: 'jazz' }),
      bt({ track_id: 'c', artist: 'Y', genre: 'jazz' }),
    ];
    const codes = recommendationTags(t, playlist).map((x) => x.code);
    expect(codes).toContain('artist_over');
    expect(codes).toContain('genre_over');
  });
});
