// AI-MUSIC-1 — Learning Engine. Blends READ-ONLY store-learning signals (skip/complete/like/dislike/
// replay) into a rule-weighted affinity score (-1..1). Reuses the existing Store Learning data; it does
// not write learning memory or change any learning algorithm.

import { clamp, round } from '../observability/math';
import { LEARNING_WEIGHTS, LEARNING_MIN_SIGNALS } from './thresholds';
import type { LearningSignals, LearningProfile } from './types';

export function computeLearningProfile(scope: string, s: LearningSignals): LearningProfile {
  const total = s.skip + s.complete + s.like + s.dislike + s.replay;
  const breakdown = {
    skip: s.skip * LEARNING_WEIGHTS.skip,
    complete: s.complete * LEARNING_WEIGHTS.complete,
    like: s.like * LEARNING_WEIGHTS.like,
    dislike: s.dislike * LEARNING_WEIGHTS.dislike,
    replay: s.replay * LEARNING_WEIGHTS.replay,
  };
  if (total < LEARNING_MIN_SIGNALS) {
    return { scope, status: 'INSUFFICIENT_DATA', affinityScore: null, band: 'NO_DATA', signalCount: total, breakdown };
  }
  const raw = Object.values(breakdown).reduce((a, b) => a + b, 0);
  // normalize by total signal magnitude so score is bounded -1..1
  const magnitude = s.skip + s.complete + s.like + s.dislike + s.replay;
  const affinity = clamp(raw / (magnitude * 1.5), -1, 1);
  const band = affinity >= 0.2 ? 'POSITIVE' : affinity <= -0.2 ? 'NEGATIVE' : 'NEUTRAL';
  return { scope, status: 'READY', affinityScore: round(affinity, 3), band, signalCount: total, breakdown };
}
