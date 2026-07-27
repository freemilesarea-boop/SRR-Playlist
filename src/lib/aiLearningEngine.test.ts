import { describe, it, expect } from 'vitest';
import {
  MIN_SAMPLE,
  ADAPTIVE_WEIGHT,
  ADAPTIVE_ADJUST_CLAMP,
  NEUTRAL_REACTION_SCORE,
  PLAYBACK_FEEDBACK_EVENTS,
  computeReactionScore,
  computeAdaptiveScore,
  learningStatusFor,
  learningStatusLabel,
  learningStatusTone,
  formatDifference,
  differenceTone,
  formatRate,
  formatSampleProgress,
  type ReactionCounts,
} from './aiLearningEngine';

function counts(over: Partial<ReactionCounts> = {}): ReactionCounts {
  return { plays: 0, completes: 0, skips: 0, nexts: 0, completionDepth: 0, ...over };
}

describe('constants match DB contract (0465)', () => {
  it('locks learning constants', () => {
    expect(MIN_SAMPLE).toBe(20);
    expect(ADAPTIVE_WEIGHT).toBe(0.4);
    expect(ADAPTIVE_ADJUST_CLAMP).toBe(20);
    expect(NEUTRAL_REACTION_SCORE).toBe(50);
  });
  it('exposes the seven collected event types', () => {
    expect([...PLAYBACK_FEEDBACK_EVENTS]).toEqual([
      'play', 'complete', 'skip', 'next', 'previous', 'pause', 'resume',
    ]);
  });
});

describe('computeReactionScore — mirrors _ai_store_reaction_score', () => {
  it('no plays → neutral 50, sample 0, rates 0', () => {
    expect(computeReactionScore(counts())).toEqual({
      reaction_score: 50, sample_count: 0, skip_rate: 0, completion_rate: 0,
    });
  });

  it('all skipped, zero completion → floor near 0', () => {
    // raw = 50 + 0 + 0 − 1*50 − 0 + 0 = 0
    const r = computeReactionScore(counts({ plays: 24, skips: 24, completionDepth: 0.08 }));
    // depth 0.08*10=0.8 → raw = 0.8 → round 1 (matches DB reaction_score=1)
    expect(r.reaction_score).toBe(1);
    expect(r.sample_count).toBe(24);
    expect(r.skip_rate).toBe(1);
    expect(r.completion_rate).toBe(0);
  });

  it('all completed, full depth → 100 (clamped)', () => {
    // raw = 50 + 1*40 + 1*10 = 100
    const r = computeReactionScore(counts({ plays: 24, completes: 24, completionDepth: 1 }));
    expect(r.reaction_score).toBe(100);
    expect(r.completion_rate).toBe(1);
    expect(r.skip_rate).toBe(0);
  });

  it('neutral mix stays near 50', () => {
    // plays 10, completes 5, skips 0, depth 0.5 → 50 + 0.5*40 + 0.5*10 = 75
    const r = computeReactionScore(counts({ plays: 10, completes: 5, completionDepth: 0.5 }));
    expect(r.reaction_score).toBe(75);
  });

  it('like/dislike bonus applies ±10 at extremes', () => {
    const base = counts({ plays: 10, completes: 5, completionDepth: 0.5 });
    const allLike = computeReactionScore({ ...base, likes: 10, dislikes: 0 });
    const allDislike = computeReactionScore({ ...base, likes: 0, dislikes: 10 });
    expect(allLike.reaction_score).toBe(85); // 75 + 10
    expect(allDislike.reaction_score).toBe(65); // 75 − 10
  });

  it('clamps component rates that exceed plays', () => {
    // skips > plays should not push below 0 unnaturally; skip_r clamps to 1
    const r = computeReactionScore(counts({ plays: 5, skips: 99, completionDepth: 0 }));
    expect(r.skip_rate).toBe(1);
    expect(r.reaction_score).toBe(0); // 50 − 50 = 0
  });
});

describe('computeAdaptiveScore — mirrors _ai_adaptive_score', () => {
  it('below sample gate → returns rounded fit (learning not applied)', () => {
    expect(computeAdaptiveScore(70, 90, 5)).toBe(70);
    expect(computeAdaptiveScore(70, 10, MIN_SAMPLE - 1)).toBe(70);
    expect(computeAdaptiveScore(70.4, 90, 0)).toBe(70);
  });

  it('active positive reaction raises score, capped at +20', () => {
    // 70 + min(20, (90−50)*0.4=16) = 86
    expect(computeAdaptiveScore(70, 90, 25)).toBe(86);
    // 70 + min(20, (100−50)*0.4=20) = 90
    expect(computeAdaptiveScore(70, 100, 25)).toBe(90);
  });

  it('active negative reaction lowers score, floored at −20', () => {
    // 70 + max(−20, (10−50)*0.4=−16) = 54
    expect(computeAdaptiveScore(70, 10, 25)).toBe(54);
    // 70 + max(−20, (1−50)*0.4=−19.6) = 50.4 → 50
    expect(computeAdaptiveScore(70, 1, 25)).toBe(50);
  });

  it('clamps to 0..100', () => {
    expect(computeAdaptiveScore(95, 100, 30)).toBe(100); // 95+20=115 → 100
    expect(computeAdaptiveScore(5, 0, 30)).toBe(0); // 5−20=−15 → 0
  });

  it('is null-safe', () => {
    expect(computeAdaptiveScore(null, null, 30)).toBe(0);
    expect(computeAdaptiveScore(undefined, undefined, undefined)).toBe(0);
    expect(computeAdaptiveScore(80, null, 30)).toBe(80); // reaction defaults to 50 → no change
  });

  it('end-to-end matches the verified DB scenario (f1 skip / f2 love)', () => {
    // f1: fit 95, reaction 1, sample 24 → 75
    expect(computeAdaptiveScore(95, 1, 24)).toBe(75);
    // f2: fit 85, reaction 100, sample 24 → 100
    expect(computeAdaptiveScore(85, 100, 24)).toBe(100);
    // f3: fit 70, reaction 50, sample 0 → 70 (collecting)
    expect(computeAdaptiveScore(70, 50, 0)).toBe(70);
  });
});

describe('learningStatusFor', () => {
  it('gates on MIN_SAMPLE', () => {
    expect(learningStatusFor(0)).toBe('collecting');
    expect(learningStatusFor(MIN_SAMPLE - 1)).toBe('collecting');
    expect(learningStatusFor(MIN_SAMPLE)).toBe('active');
    expect(learningStatusFor(100)).toBe('active');
    expect(learningStatusFor(null)).toBe('collecting');
  });
});

describe('presentation helpers', () => {
  it('labels statuses, passes through unknown', () => {
    expect(learningStatusLabel('active')).toBe('학습 적용');
    expect(learningStatusLabel('collecting')).toBe('수집 중');
    expect(learningStatusLabel('none')).toBe('미적용');
    expect(learningStatusLabel('weird')).toBe('weird');
  });

  it('tones are high-contrast and neutral-safe', () => {
    expect(learningStatusTone('active')).toContain('emerald');
    expect(learningStatusTone('collecting')).toContain('amber');
    expect(learningStatusTone('anything')).toContain('ink');
  });

  it('formats difference with sign and typographic minus', () => {
    expect(formatDifference(15)).toBe('+15');
    expect(formatDifference(-20)).toBe('−20');
    expect(formatDifference(0)).toBe('0');
    expect(formatDifference(null)).toBe('—');
    expect(formatDifference(14.6)).toBe('+15');
  });

  it('difference tone reflects direction', () => {
    expect(differenceTone(5)).toContain('emerald');
    expect(differenceTone(-5)).toContain('rose');
    expect(differenceTone(0)).toContain('ink-mute');
    expect(differenceTone(null)).toContain('ink-mute');
  });

  it('formats rates as clamped percentages', () => {
    expect(formatRate(0.1234)).toBe('12%');
    expect(formatRate(1)).toBe('100%');
    expect(formatRate(0)).toBe('0%');
    expect(formatRate(2)).toBe('100%');
    expect(formatRate(null)).toBe('—');
  });

  it('formats sample progress against the gate', () => {
    expect(formatSampleProgress(0)).toBe('0 / 20');
    expect(formatSampleProgress(12)).toBe('12 / 20');
    expect(formatSampleProgress(20)).toBe('20');
    expect(formatSampleProgress(45)).toBe('45');
    expect(formatSampleProgress(null)).toBe('0 / 20');
  });
});
