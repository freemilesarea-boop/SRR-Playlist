// WEB-OBS-8 — Quality trend over time buckets (hour → day → week → month → quarter). Direction is a
// first-vs-last score comparison past a floor, but ONLY over buckets with enough sessions to be real.
// Gaps (empty buckets) are preserved as null points, never interpolated.

import { round } from '../observability/math';
import { TREND_MIN_BUCKETS, TREND_SCORE_DELTA, TREND_MIN_SESSIONS_PER_BUCKET } from './thresholds';
import type { SqTimeBucket, QualityTrend, TrendPoint, TrendDirection } from './types';

/**
 * Build a quality trend from time buckets. Each bucket must carry a pre-computed `score` (the RPC/engine
 * supplies it). Direction requires ≥TREND_MIN_BUCKETS usable buckets; otherwise INSUFFICIENT_DATA.
 */
export function buildQualityTrend(granularity: string, buckets: SqTimeBucket[]): QualityTrend {
  const points: TrendPoint[] = buckets.map((b) => ({ at: b.bucketStart, score: b.score, sessions: b.sessions }));
  const usable = points.filter((p) => p.score != null && p.sessions >= TREND_MIN_SESSIONS_PER_BUCKET);

  if (usable.length < TREND_MIN_BUCKETS) {
    return { granularity, points, direction: 'INSUFFICIENT_DATA', firstScore: null, lastScore: null, delta: null };
  }
  const first = usable[0].score as number;
  const last = usable[usable.length - 1].score as number;
  const delta = last - first;
  const direction: TrendDirection = Math.abs(delta) < TREND_SCORE_DELTA ? 'STABLE' : delta > 0 ? 'IMPROVING' : 'DEGRADING';
  return { granularity, points, direction, firstScore: round(first, 1), lastScore: round(last, 1), delta: round(delta, 1) };
}
