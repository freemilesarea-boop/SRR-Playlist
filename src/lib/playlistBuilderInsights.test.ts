import { describe, it, expect } from 'vitest';
import { type BuilderTrack, type QualityIssue, runQualityCheck } from './playlistBuilder';
import {
  computeQualityStatus,
  qualityStatusLabel,
  isBlockingTrack,
  buildQualityDashboard,
  computeOrderDiff,
  adjacencyMetrics,
  orderImprovement,
  unsavedChangeSummary,
  saveReviewSummary,
  templateSummary,
  sortByScore,
} from './playlistBuilderInsights';

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

describe('computeQualityStatus', () => {
  it('blocked when an error issue exists', () => {
    const issues: QualityIssue[] = [{ code: 'x', severity: 'error', message: 'e' }];
    expect(computeQualityStatus([bt()], issues)).toBe('blocked');
  });
  it('blocked when a blocked track is present', () => {
    expect(computeQualityStatus([bt({ guardrailBlocked: true })], [])).toBe('blocked');
  });
  it('blocked when audio URL missing', () => {
    expect(computeQualityStatus([bt({ audioUrl: null })], [])).toBe('blocked');
  });
  it('needs_review when only warnings', () => {
    const issues: QualityIssue[] = [{ code: 'w', severity: 'warning', message: 'w' }];
    expect(computeQualityStatus([bt()], issues)).toBe('needs_review');
  });
  it('ready when clean', () => {
    expect(computeQualityStatus([bt(), bt({ track_id: 't2' })], [])).toBe('ready');
  });
  it('labels', () => {
    expect(qualityStatusLabel('ready')).toBe('Ready');
    expect(qualityStatusLabel('needs_review')).toBe('Needs Review');
    expect(qualityStatusLabel('blocked')).toBe('Blocked');
  });
  it('isBlockingTrack detects excluded/blocked/no-audio', () => {
    expect(isBlockingTrack(bt({ fitStatus: 'excluded' }))).toBe(true);
    expect(isBlockingTrack(bt({ guardrailBlocked: true }))).toBe(true);
    expect(isBlockingTrack(bt({ audioUrl: null }))).toBe(true);
    expect(isBlockingTrack(bt())).toBe(false);
  });
});

describe('buildQualityDashboard', () => {
  it('summarizes counts, averages, ratios, status', () => {
    const tracks = [
      bt({ track_id: 'a', fitScore: 80, adaptiveScore: 90, instrumental: true }),
      bt({ track_id: 'b', fitScore: 60, adaptiveScore: 50, instrumental: false, vocalPresence: 4, guardrailPenalty: 20 }),
    ];
    const d = buildQualityDashboard(tracks, runQualityCheck(tracks), { targetDurationSec: 3600 });
    expect(d.trackCount).toBe(2);
    expect(d.avgFit).toBe(70);
    expect(d.avgAdaptive).toBe(70);
    expect(d.penalizedCount).toBe(1);
    expect(d.vocalRatio).toBeCloseTo(0.5, 5);
    expect(d.durationFulfillment).toBeCloseTo(360 / 3600, 5);
    expect(['ready', 'needs_review', 'blocked']).toContain(d.status);
  });
  it('null averages/ratios when no data', () => {
    const d = buildQualityDashboard([], [], {});
    expect(d.avgFit).toBeNull();
    expect(d.vocalRatio).toBeNull();
    expect(d.durationFulfillment).toBeNull();
  });
});

describe('computeOrderDiff', () => {
  it('reports from/to/delta/moved', () => {
    const cur = [bt({ track_id: 'a' }), bt({ track_id: 'b' }), bt({ track_id: 'c' })];
    const sug = [bt({ track_id: 'c' }), bt({ track_id: 'a' }), bt({ track_id: 'b' })];
    const diff = computeOrderDiff(cur, sug);
    expect(diff.map((d) => d.trackId)).toEqual(['c', 'a', 'b']);
    expect(diff[0]).toMatchObject({ fromIndex: 2, toIndex: 0, delta: -2, moved: true });
    expect(diff.find((d) => d.trackId === 'b')).toMatchObject({ delta: 1 });
  });
  it('blocked/penalized get demote reasons', () => {
    const cur = [bt({ track_id: 'a', guardrailBlocked: true }), bt({ track_id: 'b' })];
    const sug = [bt({ track_id: 'b' }), bt({ track_id: 'a', guardrailBlocked: true })];
    const diff = computeOrderDiff(cur, sug);
    expect(diff.find((d) => d.trackId === 'a')?.reason).toContain('차단');
  });
});

describe('adjacencyMetrics + orderImprovement', () => {
  it('counts adjacent same-artist/genre and avg deltas', () => {
    const tracks = [
      bt({ track_id: 'a', artist: 'X', genre: 'jazz', bpm: 90, energyLevel: 2 }),
      bt({ track_id: 'b', artist: 'X', genre: 'jazz', bpm: 100, energyLevel: 4 }),
    ];
    const m = adjacencyMetrics(tracks);
    expect(m.sameArtistAdjacent).toBe(1);
    expect(m.sameGenreAdjacent).toBe(1);
    expect(m.avgBpmDelta).toBe(10);
    expect(m.avgEnergyDelta).toBe(2);
  });
  it('orderImprovement compares current vs suggested', () => {
    const cur = [bt({ track_id: 'a', artist: 'X' }), bt({ track_id: 'b', artist: 'X' })];
    const sug = [bt({ track_id: 'a', artist: 'X' }), bt({ track_id: 'b', artist: 'Y' })];
    const imp = orderImprovement(cur, sug);
    expect(imp.current.sameArtistAdjacent).toBe(1);
    expect(imp.suggested.sameArtistAdjacent).toBe(0);
  });
});

describe('unsavedChangeSummary + saveReviewSummary', () => {
  it('counts added/removed/reordered', () => {
    const saved = ['a', 'b', 'c'];
    const current = ['c', 'a', 'd']; // removed b; added d; reordered
    const u = unsavedChangeSummary(saved, current);
    expect(u.added).toBe(1);
    expect(u.removed).toBe(1);
    expect(u.hasChanges).toBe(true);
    expect(u.reordered).toBeGreaterThan(0);
  });
  it('no changes when identical', () => {
    const u = unsavedChangeSummary(['a', 'b'], ['a', 'b']);
    expect(u).toMatchObject({ added: 0, removed: 0, reordered: 0, hasChanges: false });
  });
  it('saveReviewSummary flags willBlock on error', () => {
    const cur = [bt({ track_id: 'a', audioUrl: null })];
    const s = saveReviewSummary([], cur, runQualityCheck(cur));
    expect(s.willBlock).toBe(true);
    expect(s.status).toBe('blocked');
    expect(s.added).toBe(1);
  });
});

describe('templateSummary + sortByScore', () => {
  it('summarizes genres/energy/vocal/duration', () => {
    const tracks = [
      bt({ track_id: 'a', genre: 'jazz', energyLevel: 2, instrumental: true, duration: 120 }),
      bt({ track_id: 'b', genre: 'jazz', energyLevel: 4, instrumental: false, vocalPresence: 4, duration: 180 }),
    ];
    const s = templateSummary(tracks);
    expect(s.trackCount).toBe(2);
    expect(s.totalDurationSec).toBe(300);
    expect(s.topGenres).toContain('jazz');
    expect(s.avgEnergy).toBe(3);
    expect(s.vocalRatio).toBeCloseTo(0.5, 5);
  });
  it('sortByScore orders desc, nulls last', () => {
    const tracks = [
      bt({ track_id: 'a', fitScore: 50 }),
      bt({ track_id: 'b', fitScore: 90 }),
      bt({ track_id: 'c', fitScore: null, adaptiveScore: null }),
    ];
    expect(sortByScore(tracks, 'fit').map((t) => t.track_id)).toEqual(['b', 'a', 'c']);
  });
});
