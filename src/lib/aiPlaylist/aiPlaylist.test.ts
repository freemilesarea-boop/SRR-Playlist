// AI-MUSIC-2 — Playlist Builder engine tests. Rule-based (no LLM); every result is a proposal/simulation,
// never auto-deployed (requiresApproval:true, automated:false, simulationOnly:true). Honest NO_DATA /
// INSUFFICIENT_DATA below the pool floor.

import { describe, it, expect } from 'vitest';
import {
  buildPlaylist, compareCandidates, resolveTimeSlot, industryPlaylistRule, targetEnergyCurve,
  scoreEnergyCurve, fatigueFactor, playlistFatigueRisk, measureDiversity, optimizeDiversity,
  computePlaylistBuildConfidence, getAiPlaylistConfig, __resetAiPlaylistConfig,
} from './index';
import type { BuilderTrack, PlaylistBuildInput, PlaylistTrackPick } from './types';

const GENRES = ['jazz', 'pop', 'acoustic', 'lofi', 'soul', 'bossa'];
const MOODS = ['calm', 'bright', 'warm', 'chill', 'lounge'];

function mkTrack(i: number, o: Partial<BuilderTrack> = {}): BuilderTrack {
  return {
    trackId: `t${i}`, title: `Track ${i}`, genre: GENRES[i % GENRES.length], mood: MOODS[i % MOODS.length],
    energy: round2(0.2 + (i % 5) * 0.15), instrumental: i % 2 === 0, bpm: 90 + (i % 5) * 12,
    compatScore: 60 + (i % 8) * 4, learningScore: 0.4 + (i % 4) * 0.1, recentPlays7d: 0, ...o,
  };
}
function round2(n: number): number { return Math.round(n * 100) / 100; }

function mkPool(n: number, o: (i: number) => Partial<BuilderTrack> = () => ({})): BuilderTrack[] {
  return Array.from({ length: n }, (_, i) => mkTrack(i, o(i)));
}

function mkInput(o: Partial<PlaylistBuildInput> = {}): PlaylistBuildInput {
  return {
    storeId: 's1', storeType: 'cafe', storeReady: true, storeEnergyPreference: 0.4, hour: 9,
    targetLength: 20, strategy: 'BALANCED', pool: mkPool(30), ...o,
  };
}

function mkPicks(genres: string[]): PlaylistTrackPick[] {
  return genres.map((g, i) => ({
    trackId: `p${i}`, title: `P${i}`, position: i + 1, genre: g, mood: MOODS[i % MOODS.length],
    energy: 0.3 + (i % 4) * 0.15, bpm: 100 + i * 5, compatScore: 70, pickScore: 80 - i,
    explain: { factors: [], summary: '' },
  }));
}

describe('time intelligence', () => {
  it('maps hours to day-part slots', () => {
    expect(resolveTimeSlot(9)?.key).toBe('MORNING');
    expect(resolveTimeSlot(12)?.key).toBe('LUNCH');
    expect(resolveTimeSlot(18)?.key).toBe('DINNER');
    expect(resolveTimeSlot(22)?.key).toBe('CLOSING');
    expect(resolveTimeSlot(3)?.key).toBe('CLOSING'); // late-night wraps
    expect(resolveTimeSlot(null)).toBeNull();
  });
});

describe('industry intelligence', () => {
  it('resolves 9 industries + general fallback', () => {
    expect(industryPlaylistRule('cafe').storeType).toBe('cafe');
    expect(industryPlaylistRule('헬스장').storeType).toBe('gym');
    expect(industryPlaylistRule('스터디카페').storeType).toBe('studycafe');
    expect(industryPlaylistRule('unknown-xyz').storeType).toBe('general');
    expect(industryPlaylistRule('office').energyProfile).toBe('LOW');
  });
});

describe('energy curve', () => {
  it('target curve rises then falls (Low→High→Low)', () => {
    const c = targetEnergyCurve(5);
    expect(c[0]).toBeLessThan(c[2]);   // low < high
    expect(c[4]).toBeLessThan(c[2]);   // low < high
    expect(c).toHaveLength(5);
  });
  it('scores a matching sequence high and an inverted one low', () => {
    const target = targetEnergyCurve(5);
    expect(scoreEnergyCurve(target)!).toBeGreaterThan(0.95);
    const inverted = [...target].reverse().map((v) => 1 - v);
    expect(scoreEnergyCurve(inverted)!).toBeLessThan(scoreEnergyCurve(target)!);
  });
  it('returns null when no energies comparable', () => {
    expect(scoreEnergyCurve([null, null, null])).toBeNull();
  });
});

describe('fatigue prevention', () => {
  it('no penalty below soft threshold, floor at hard', () => {
    expect(fatigueFactor(0)).toBe(1);
    expect(fatigueFactor(2)).toBe(1);
    expect(fatigueFactor(10)).toBeLessThan(0.5);
    expect(fatigueFactor(5)).toBeGreaterThan(fatigueFactor(7));
  });
  it('risk rises with recent plays', () => {
    expect(playlistFatigueRisk([0, 0, 0])).toBe(0);
    expect(playlistFatigueRisk([8, 8, 8])).toBe(1);
    expect(playlistFatigueRisk([])).toBeNull();
  });
});

describe('diversity optimizer', () => {
  it('measures genre diversity', () => {
    expect(measureDiversity(mkPicks(['jazz', 'jazz', 'jazz'])).genreDiversity).toBeCloseTo(0.333, 2);
    expect(measureDiversity(mkPicks(['jazz', 'pop', 'soul'])).genreDiversity).toBe(1);
  });
  it('breaks long same-genre streaks', () => {
    const { picks } = optimizeDiversity(mkPicks(['jazz', 'jazz', 'jazz', 'jazz', 'pop', 'soul']));
    let maxStreak = 1, cur = 1;
    for (let i = 1; i < picks.length; i++) { if (picks[i].genre === picks[i - 1].genre) { cur++; maxStreak = Math.max(maxStreak, cur); } else cur = 1; }
    expect(maxStreak).toBeLessThanOrEqual(2);
  });
});

describe('build confidence', () => {
  it('INSUFFICIENT_DATA when store not ready', () => {
    expect(computePlaylistBuildConfidence({ poolSize: 30, storeReady: false, compatCoverage: 1, learningCoverage: 1, curveFit: 1 }).level).toBe('INSUFFICIENT_DATA');
  });
  it('HIGH with full evidence, capped below 100', () => {
    const c = computePlaylistBuildConfidence({ poolSize: 60, storeReady: true, compatCoverage: 1, learningCoverage: 1, curveFit: 1 });
    expect(c.level).toBe('HIGH');
    expect(c.value!).toBeLessThanOrEqual(92);
  });
});

describe('playlist builder', () => {
  it('generates a proposal (simulation only, requires approval)', () => {
    const pl = buildPlaylist(mkInput());
    expect(pl.status).toBe('READY');
    expect(pl.simulationOnly).toBe(true);
    expect(pl.requiresApproval).toBe(true);
    expect(pl.automated).toBe(false);
    expect(pl.picks.length).toBeGreaterThanOrEqual(5);
    expect(pl.picks.length).toBeLessThanOrEqual(20);
    expect(pl.timeSlot?.key).toBe('MORNING');
    expect(pl.industryRule.storeType).toBe('cafe');
  });
  it('each pick carries explainability factors', () => {
    const pl = buildPlaylist(mkInput());
    for (const p of pl.picks) {
      expect(p.explain.factors.length).toBeGreaterThan(0);
      expect(p.explain.factors.map((f) => f.key)).toContain('compatibility');
    }
  });
  it('follows the energy curve reasonably (curveFit present)', () => {
    const pl = buildPlaylist(mkInput());
    expect(pl.curveFit).not.toBeNull();
    expect(pl.targetEnergyCurve).toHaveLength(pl.trackCount);
  });
  it('de-prioritizes fatigued (recently over-played) tracks', () => {
    const pool = mkPool(30, (i) => (i < 5 ? { recentPlays7d: 10 } : { recentPlays7d: 0 }));
    const pl = buildPlaylist(mkInput({ pool, targetLength: 15 }));
    const fatiguedPicked = pl.picks.filter((p) => ['t0', 't1', 't2', 't3', 't4'].includes(p.trackId)).length;
    // the 5 heavily-played tracks should be largely pushed out of a 15-track selection
    expect(fatiguedPicked).toBeLessThanOrEqual(3);
  });
  it('INSUFFICIENT_DATA when store not ready', () => {
    const pl = buildPlaylist(mkInput({ storeReady: false }));
    expect(pl.status).toBe('INSUFFICIENT_DATA');
    expect(pl.picks).toHaveLength(0);
  });
  it('INSUFFICIENT_DATA when pool below floor (NO_DATA-ish)', () => {
    const pl = buildPlaylist(mkInput({ pool: mkPool(4) }));
    expect(pl.status).toBe('INSUFFICIENT_DATA');
    expect(pl.confidence.level).toBe('INSUFFICIENT_DATA');
  });
});

describe('candidate comparison', () => {
  it('builds A/B/C and picks a best candidate', () => {
    const cmp = compareCandidates(mkInput());
    expect(cmp.candidates.map((c) => c.label)).toEqual(['A', 'B', 'C']);
    expect(cmp.simulationOnly).toBe(true);
    expect(cmp.bestLabel).not.toBeNull();
    expect(cmp.candidates.filter((c) => c.isBest)).toHaveLength(1);
    const best = cmp.candidates.find((c) => c.isBest)!;
    for (const c of cmp.candidates) { if (c.score != null && best.score != null) expect(best.score).toBeGreaterThanOrEqual(c.score); }
  });
  it('all-insufficient input yields no best candidate', () => {
    const cmp = compareCandidates(mkInput({ pool: mkPool(3) }));
    expect(cmp.bestLabel).toBeNull();
  });
});

describe('config (flags default OFF)', () => {
  it('builder/compare/simulation default OFF', () => {
    __resetAiPlaylistConfig();
    const c = getAiPlaylistConfig();
    expect(c.builderEnabled).toBe(false);
    expect(c.compareEnabled).toBe(false);
    expect(c.simulationEnabled).toBe(false);
  });
});
