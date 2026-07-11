// AI-MUSIC-3 — Adaptive Playlist Score. Updates a playlist's score over time from the reinforcement net
// signal (Yesterday 82 → Today 87 → Next 91) via an EMA-smoothed step, and projects the next score. Pure
// math — read-only, a recommendation only.

import { clamp, round } from '../observability/math';
import {
  MIN_SIGNALS_FOR_ADAPTIVE, ADAPTIVE_STEP_SCALE, ADAPTIVE_EMA_ALPHA, ADAPTIVE_TREND_EPS, DEFAULT_PRIOR_SCORE,
} from './thresholds';
import type { ReinforcementScore, AdaptiveScore, Trend } from './types';

function trendOf(delta: number): Trend {
  if (delta > ADAPTIVE_TREND_EPS) return 'RISING';
  if (delta < -ADAPTIVE_TREND_EPS) return 'FALLING';
  return 'FLAT';
}

/**
 * @param priorScore  yesterday's score (0..100); null → DEFAULT_PRIOR_SCORE
 * @param reinforcement  today's reinforcement signal
 * @param sampleSize  plays behind the reinforcement (gate)
 */
export function computeAdaptiveScore(priorScore: number | null, reinforcement: ReinforcementScore, sampleSize: number): AdaptiveScore {
  if (reinforcement.status !== 'READY' || reinforcement.net == null || sampleSize < MIN_SIGNALS_FOR_ADAPTIVE) {
    return { status: 'INSUFFICIENT_DATA', yesterday: priorScore, today: null, next: null, delta: null, trend: 'FLAT' };
  }
  const yesterday = clamp(priorScore ?? DEFAULT_PRIOR_SCORE, 0, 100);
  const rawStep = reinforcement.net * ADAPTIVE_STEP_SCALE;   // -scale..scale
  const step = rawStep * ADAPTIVE_EMA_ALPHA;                 // smoothed
  const today = clamp(yesterday + step, 0, 100);
  const delta = today - yesterday;
  // Project next: continue the smoothed step, damped (momentum halves).
  const next = clamp(today + step * 0.5, 0, 100);
  return {
    status: 'READY',
    yesterday: round(yesterday, 1), today: round(today, 1), next: round(next, 1),
    delta: round(delta, 1), trend: trendOf(delta),
  };
}
