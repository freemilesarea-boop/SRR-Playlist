// AI-MUSIC-3 — Adaptive learning engine tests. Rule-based (no LLM/RL model); every result is a
// recommendation, never auto-applied (requiresApproval:true, automated:false). Honest NO_DATA /
// INSUFFICIENT_DATA below the sample floors.

import { describe, it, expect } from 'vitest';
import {
  computeReinforcement, computeAdaptiveScore, computeTrackReputation, buildEvolution, explorationPlan,
  evaluateExpansion, seasonalLearning, timeLearning, seasonForMonth, dayPartForHour, computePlaylistDrift,
  buildExplainV2, runLearningLoop, getAiLearningConfig, __resetAiLearningConfig,
} from './index';
import type { ReinforcementSignals, TrackReputationInput, PlaylistVersion } from './types';

function sig(o: Partial<ReinforcementSignals> = {}): ReinforcementSignals {
  return { plays: 100, completes: 70, likes: 8, longSessions: 20, skips: 15, dislikes: 2, repeatFatigue: 3, ...o };
}

describe('reinforcement', () => {
  it('rewards completion/like/long-session, penalizes skip/dislike/fatigue', () => {
    const r = computeReinforcement(sig());
    expect(r.status).toBe('READY');
    expect(r.reward!).toBeGreaterThan(r.penalty!);
    expect(r.net!).toBeGreaterThan(0);
  });
  it('net turns negative when skips/dislikes dominate', () => {
    const r = computeReinforcement(sig({ completes: 10, likes: 0, longSessions: 2, skips: 70, dislikes: 15 }));
    expect(r.net!).toBeLessThan(0);
  });
  it('INSUFFICIENT_DATA below play floor', () => {
    expect(computeReinforcement(sig({ plays: 5 })).status).toBe('INSUFFICIENT_DATA');
  });
});

describe('adaptive score', () => {
  it('raises score on positive reinforcement (yesterday→today→next rising)', () => {
    const r = computeReinforcement(sig());
    const a = computeAdaptiveScore(82, r, 100);
    expect(a.status).toBe('READY');
    expect(a.today!).toBeGreaterThan(a.yesterday!);
    expect(a.next!).toBeGreaterThanOrEqual(a.today!);
    expect(a.trend).toBe('RISING');
  });
  it('lowers score on negative reinforcement', () => {
    const r = computeReinforcement(sig({ completes: 5, likes: 0, longSessions: 1, skips: 80, dislikes: 12 }));
    const a = computeAdaptiveScore(82, r, 100);
    expect(a.today!).toBeLessThan(82);
    expect(a.trend).toBe('FALLING');
  });
  it('INSUFFICIENT_DATA when reinforcement insufficient', () => {
    const r = computeReinforcement(sig({ plays: 5 }));
    expect(computeAdaptiveScore(82, r, 5).status).toBe('INSUFFICIENT_DATA');
  });
});

describe('track reputation', () => {
  const base = (o: Partial<TrackReputationInput> = {}): TrackReputationInput => ({ trackId: 't1', title: 'T', completionRate: 0.8, skipRate: 0.1, likeRate: 0.06, replayRate: 0.04, plays: 50, priorScore: null, ...o });
  it('EXCELLENT for strong completion + low skip', () => {
    expect(computeTrackReputation(base()).band).toBe('EXCELLENT');
  });
  it('WEAK for poor performance', () => {
    expect(computeTrackReputation(base({ completionRate: 0.2, skipRate: 0.6, likeRate: 0, replayRate: 0 })).band).toBe('WEAK');
  });
  it('RECOVERING when previously weak but improving strongly', () => {
    const rep = computeTrackReputation(base({ completionRate: 0.5, skipRate: 0.3, likeRate: 0.02, replayRate: 0.01, priorScore: 35 }));
    expect(rep.band).toBe('RECOVERING');
    expect(rep.trend).toBe('RISING');
  });
  it('NO_DATA below play floor', () => {
    expect(computeTrackReputation(base({ plays: 5 })).band).toBe('NO_DATA');
  });
});

describe('playlist evolution', () => {
  const v = (version: number, score: number): PlaylistVersion => ({ version, score, trackCount: 20, diversity: 0.6, fatigueRisk: 0.1, label: `V${version}` });
  it('builds V1..Vn with deltas + rising trend', () => {
    const e = buildEvolution([v(1, 80), v(2, 84), v(3, 88)]);
    expect(e.status).toBe('READY');
    expect(e.versions[1].delta).toBe(4);
    expect(e.overallTrend).toBe('RISING');
    expect(e.latestScore).toBe(88);
  });
  it('INSUFFICIENT_DATA with a single version', () => {
    expect(buildEvolution([v(1, 80)]).status).toBe('INSUFFICIENT_DATA');
  });
});

describe('exploration vs exploitation', () => {
  it('keeps ~80/20 split', () => {
    const p = explorationPlan(20);
    expect(p.exploitCount).toBe(16);
    expect(p.exploreCount).toBe(4);
  });
  it('clamps explore ratio to bounds', () => {
    const p = explorationPlan(10, 0.99); // explore would be ~0 → clamped to min 0.1
    expect(p.exploreCount).toBeGreaterThanOrEqual(1);
  });
});

describe('discovery expansion', () => {
  const inp = (o = {}) => ({ trackId: 't1', title: 'T', stage: 'PILOT' as const, reachStores: 3, plays: 40, completionRate: 0.7, skipRate: 0.2, ...o });
  it('recommends advancing when completion high + skip low (requires approval)', () => {
    const e = evaluateExpansion(inp());
    expect(e.advance).toBe(true);
    expect(e.recommendedStage).toBe('SMALL_GROUP');
    expect(e.requiresApproval).toBe(true);
    expect(e.automated).toBe(false);
  });
  it('holds when below thresholds', () => {
    expect(evaluateExpansion(inp({ completionRate: 0.4, skipRate: 0.5 })).advance).toBe(false);
  });
  it('INSUFFICIENT_DATA below play floor', () => {
    expect(evaluateExpansion(inp({ plays: 5 })).status).toBe('INSUFFICIENT_DATA');
  });
});

describe('seasonal / time learning', () => {
  it('maps month → season and hour → day part', () => {
    expect(seasonForMonth(4)).toBe('SPRING');
    expect(seasonForMonth(7)).toBe('SUMMER');
    expect(seasonForMonth(10)).toBe('FALL');
    expect(seasonForMonth(1)).toBe('WINTER');
    expect(dayPartForHour(8)).toBe('MORNING');
    expect(dayPartForHour(12)).toBe('LUNCH');
    expect(dayPartForHour(18)).toBe('EVENING');
    expect(dayPartForHour(2)).toBe('LATE_NIGHT');
  });
  it('picks the best segment by completion', () => {
    const s = seasonalLearning({ SPRING: { plays: 100, completionRate: 0.7, topGenres: ['jazz'] }, SUMMER: { plays: 90, completionRate: 0.6, topGenres: ['pop'] } });
    expect(s.status).toBe('READY');
    expect(s.bestSegment).toBe('SPRING');
  });
  it('INSUFFICIENT_DATA when no segment has enough plays', () => {
    expect(timeLearning({ MORNING: { plays: 3, completionRate: 0.9, topGenres: [] } }).status).toBe('INSUFFICIENT_DATA');
  });
});

describe('playlist drift', () => {
  it('0 drift for identical distributions', () => {
    const p = { genreShare: { jazz: 5, pop: 5 }, moodShare: { calm: 10 }, energyMean: 0.5 };
    expect(computePlaylistDrift(p, p).drift).toBe(0);
    expect(computePlaylistDrift(p, p).band).toBe('LOW');
  });
  it('HIGH drift for fully divergent genres', () => {
    const a = { genreShare: { jazz: 10 }, moodShare: { calm: 10 }, energyMean: 0.3 };
    const b = { genreShare: { edm: 10 }, moodShare: { energetic: 10 }, energyMean: 0.9 };
    expect(computePlaylistDrift(a, b).band).toBe('HIGH');
  });
  it('INSUFFICIENT_DATA when nothing comparable', () => {
    expect(computePlaylistDrift({ genreShare: {}, moodShare: {}, energyMean: null }, { genreShare: {}, moodShare: {}, energyMean: null }).status).toBe('INSUFFICIENT_DATA');
  });
});

describe('explainability v2', () => {
  it('emits 8 factors with a dominant summary', () => {
    const e = buildExplainV2({ trackId: 't1', title: 'T', genreMatch: 0.9, moodMatch: 0.7, energyFit: 0.6, learningScore: 0.5, discoveryScore: 0.2, industryFit: 0.8, timeFit: 0.6, confidence: 80 });
    expect(e.factors).toHaveLength(8);
    expect(e.factors.map((f) => f.key)).toContain('confidence');
    expect(e.summary).toContain('%');
  });
  it('NO_DATA summary when all signals absent', () => {
    const e = buildExplainV2({ trackId: 't1', title: null, genreMatch: null, moodMatch: null, energyFit: null, learningScore: null, discoveryScore: null, industryFit: null, timeFit: null, confidence: null });
    expect(e.summary).toContain('NO_DATA');
  });
});

describe('continuous learning loop', () => {
  it('produces a next-recommendation score (recommendation only)', () => {
    const r = runLearningLoop({ storeId: 's1', priorScore: 82, signals: sig() });
    expect(r.status).toBe('READY');
    expect(r.requiresApproval).toBe(true);
    expect(r.automated).toBe(false);
    expect(r.nextRecommendationScore).not.toBeNull();
  });
  it('INSUFFICIENT_DATA loop below floor', () => {
    expect(runLearningLoop({ storeId: 's1', priorScore: null, signals: sig({ plays: 4 }) }).status).toBe('INSUFFICIENT_DATA');
  });
});

describe('config (flags default OFF)', () => {
  it('learning/reputation/adaptive/history default OFF', () => {
    __resetAiLearningConfig();
    const c = getAiLearningConfig();
    expect(c.learningEngineEnabled).toBe(false);
    expect(c.reputationEnabled).toBe(false);
    expect(c.adaptiveEnabled).toBe(false);
    expect(c.playlistHistoryEnabled).toBe(false);
  });
});
