// AI-MUSIC-1 — Intelligent Music OS engine tests. Rule-based (no LLM); recommendation/simulation only,
// never auto-deploy. Honest NO_DATA / INSUFFICIENT_DATA below sample floors.

import { describe, it, expect } from 'vitest';
import {
  computeStoreProfile, computeTrackProfile, computeCompatibility, analyzePlaylist, computeLearningProfile,
  musicDirectorPlan, allDirectorRuleTypes, computeAiConfidence, buildMusicRecommendations, simulatePlaylist,
  evaluateDiscovery,
} from './index';
import type { StorePlayAggregate, TrackMeta, TrackPerformance, TrackProfile } from './types';

function mkAgg(o: Partial<StorePlayAggregate> = {}): StorePlayAggregate {
  return {
    storeId: 's1', storeType: 'cafe', plays: 200, skips: 40, completes: 130, likes: 12, dislikes: 3, replays: 8,
    sessionCount: 20, avgSessionSeconds: 1800,
    genreShare: { jazz: 90, pop: 60, acoustic: 50 }, moodShare: { calm: 100, bright: 60, warm: 40 },
    instrumentalPlays: 120, vocalPlays: 80, energySum: 80, energyCount: 200,
    activeHours: { '9': 30, '12': 50, '18': 40, '20': 20 }, ...o,
  };
}
function mkTrack(o: Partial<TrackMeta> = {}): TrackMeta {
  return { trackId: 't1', title: 'Track', artistId: 'a1', genre: 'jazz', mood: 'calm', energy: 0.4, danceability: 0.5, bpm: 100, instrumental: true, vocal: false, durationSeconds: 200, qcStatus: 'approved', ...o };
}
const perf = (o: Partial<TrackPerformance> = {}): TrackPerformance => ({ plays: 60, skips: 12, completes: 42, replays: 3, likes: 4, dislikes: 1, learningScore: 0.3, ...o });

describe('store profile', () => {
  it('computes preferences + rates when sufficient', () => {
    const p = computeStoreProfile(mkAgg());
    expect(p.status).toBe('READY');
    expect(p.genrePreference[0].key).toBe('jazz');
    expect(p.skipRate).toBeCloseTo(0.2, 1);
    expect(p.seasonalPattern).toBe('NOT_AVAILABLE');
  });
  it('INSUFFICIENT_DATA below play floor', () => {
    expect(computeStoreProfile(mkAgg({ plays: 5 })).status).toBe('INSUFFICIENT_DATA');
  });
});

describe('track profile', () => {
  it('classifies bpm bucket + performance', () => {
    const tp = computeTrackProfile(mkTrack(), perf());
    expect(tp.bpmBucket).toBe('MEDIUM');
    expect(tp.industrySuitability).toContain('cafe');
    expect(['STRONG', 'OK', 'POOR']).toContain(tp.completionPerformance);
  });
  it('NO_DATA performance below play floor', () => {
    const tp = computeTrackProfile(mkTrack(), perf({ plays: 3 }));
    expect(tp.completionPerformance).toBe('NO_DATA');
    expect(tp.learningConfidence).toBe('INSUFFICIENT_DATA');
  });
});

describe('compatibility (recommendation only)', () => {
  it('scores EXCELLENT/GOOD for aligned track', () => {
    const store = computeStoreProfile(mkAgg());
    const track = computeTrackProfile(mkTrack(), perf());
    const c = computeCompatibility(store, track, perf());
    expect(c.score).not.toBeNull();
    expect(['EXCELLENT', 'GOOD', 'ACCEPTABLE']).toContain(c.band);
  });
  it('INSUFFICIENT_DATA when store thin', () => {
    const store = computeStoreProfile(mkAgg({ plays: 5 }));
    const c = computeCompatibility(store, computeTrackProfile(mkTrack(), perf()));
    expect(c.band).toBe('INSUFFICIENT_DATA');
  });
});

describe('playlist intelligence', () => {
  const tracks = (n: number, genre = 'jazz'): TrackProfile[] => Array.from({ length: n }, (_, i) => computeTrackProfile(mkTrack({ trackId: `t${i}`, genre: i % 2 ? genre : 'pop', energy: 0.3 + (i % 5) * 0.1 }), perf()));
  it('computes diversity/fatigue/balance', () => {
    const pi = analyzePlaylist(tracks(12));
    expect(pi.status).toBe('READY');
    expect(pi.diversity).not.toBeNull();
    expect(['LOW', 'MEDIUM', 'HIGH']).toContain(pi.fatigueBand);
  });
  it('INSUFFICIENT_DATA below track floor', () => {
    expect(analyzePlaylist(tracks(3)).status).toBe('INSUFFICIENT_DATA');
  });
});

describe('learning engine', () => {
  it('POSITIVE affinity for good signals', () => {
    const l = computeLearningProfile('s1:t1', { skip: 2, complete: 30, like: 5, dislike: 0, replay: 4, sessionSeconds: null });
    expect(l.status).toBe('READY');
    expect(l.band).toBe('POSITIVE');
  });
  it('INSUFFICIENT below signal floor', () => {
    expect(computeLearningProfile('x', { skip: 1, complete: 2, like: 0, dislike: 0, replay: 0, sessionSeconds: null }).status).toBe('INSUFFICIENT_DATA');
  });
});

describe('music director (rule-based, no LLM)', () => {
  it('returns industry day-part plan', () => {
    const plan = musicDirectorPlan('cafe');
    expect(plan.source).toBe('RULE');
    expect(plan.slots.length).toBeGreaterThan(0);
    expect(allDirectorRuleTypes()).toContain('gym');
  });
  it('falls back to general plan', () => {
    expect(musicDirectorPlan('unknown-type').slots.length).toBeGreaterThan(0);
  });
});

describe('ai confidence', () => {
  it('HIGH with broad evidence, capped', () => {
    const c = computeAiConfidence({ sampleSize: 1000, storeHistoryPlays: 1000, trackHistoryPlays: 500, learningCoverage: 1, signalCoverage: 1 });
    expect(c.value as number).toBeLessThanOrEqual(94);
    expect(c.level).toBe('HIGH');
  });
  it('INSUFFICIENT with no sample', () => {
    expect(computeAiConfidence({ sampleSize: 0, storeHistoryPlays: 0, trackHistoryPlays: 0, learningCoverage: 0, signalCoverage: 0 }).level).toBe('INSUFFICIENT_DATA');
  });
});

describe('recommendation engine (advisory only)', () => {
  it('produces recommend/exclude, all advisory', () => {
    const store = computeStoreProfile(mkAgg());
    const good = computeCompatibility(store, computeTrackProfile(mkTrack({ trackId: 'g' }), perf()), perf());
    const bad = computeCompatibility(store, computeTrackProfile(mkTrack({ trackId: 'b', genre: 'metal', mood: 'aggressive', energy: 0.95, instrumental: false }), perf({ skips: 40, completes: 5 })), perf({ plays: 60, skips: 40, completes: 5 }));
    const recs = buildMusicRecommendations({ store, compatibilities: [{ trackId: 'g', title: 'G', compat: good }, { trackId: 'b', title: 'B', compat: bad }], confidence: 'MEDIUM' });
    expect(recs.every((r) => r.automated === false && r.requiresApproval === true)).toBe(true);
    expect(recs.some((r) => r.kind === 'RECOMMEND_TRACK')).toBe(true);
  });
});

describe('playlist simulation (simulation only)', () => {
  it('predicts outcomes, marked simulationOnly', () => {
    const store = computeStoreProfile(mkAgg());
    const tracks = Array.from({ length: 8 }, (_, i) => computeTrackProfile(mkTrack({ trackId: `t${i}` }), perf()));
    const comps = tracks.map((t) => computeCompatibility(store, t, perf()));
    const sim = simulatePlaylist({ store, tracks, compatibilities: comps, confidence: 'MEDIUM' });
    expect(sim.status).toBe('READY');
    expect(sim.simulationOnly).toBe(true);
    expect(sim.predictedSkipRate).not.toBeNull();
  });
  it('INSUFFICIENT below track floor', () => {
    const store = computeStoreProfile(mkAgg());
    expect(simulatePlaylist({ store, tracks: [], compatibilities: [], confidence: 'LOW' }).status).toBe('INSUFFICIENT_DATA');
  });
});

describe('discovery pool (no auto-deploy)', () => {
  it('recommends expansion on good pilot, never automated', () => {
    const d = evaluateDiscovery({ trackId: 't1', title: 'T', stage: 'EVALUATION', pilotStores: 5, pilotPlays: 40, pilotCompletes: 28, pilotSkips: 8 });
    expect(d.automated).toBe(false);
    expect(d.recommendation).toContain('Expansion');
  });
  it('holds evaluation when pilot plays insufficient', () => {
    const d = evaluateDiscovery({ trackId: 't1', title: 'T', stage: 'EVALUATION', pilotStores: 2, pilotPlays: 5, pilotCompletes: 3, pilotSkips: 1 });
    expect(d.recommendation).toContain('INSUFFICIENT_DATA');
  });
});
