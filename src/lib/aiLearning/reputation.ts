// AI-MUSIC-3 — Track Reputation. RULE-based reputation (Excellent / Good / Weak / Recovering) from a
// track's completion / skip / like / replay rates, with a RECOVERING overlay when a previously-weak track
// is trending up. Read-only — an evaluation, never a ranking/exposure change.

import { clamp, round } from '../observability/math';
import {
  MIN_PLAYS_FOR_REPUTATION, REPUTATION_EXCELLENT, REPUTATION_GOOD, REPUTATION_RECOVERING_DELTA, REPUTATION_WEIGHTS,
} from './thresholds';
import type { TrackReputationInput, TrackReputation, ReputationBand, Trend } from './types';

export function computeTrackReputation(input: TrackReputationInput): TrackReputation {
  if (input.plays < MIN_PLAYS_FOR_REPUTATION) {
    return { trackId: input.trackId, title: input.title, status: 'INSUFFICIENT_DATA', score: null, band: 'NO_DATA', trend: 'FLAT', reasons: ['표본 부족'] };
  }
  const W = REPUTATION_WEIGHTS;
  const completion = clamp(input.completionRate ?? 0, 0, 1);
  const lowSkip = 1 - clamp(input.skipRate ?? 0, 0, 1);
  const like = clamp((input.likeRate ?? 0) * 10, 0, 1);      // like rates are small; scale to 0..1
  const replay = clamp((input.replayRate ?? 0) * 8, 0, 1);
  const score = clamp((completion * W.completion + lowSkip * W.lowSkip + like * W.like + replay * W.replay) * 100, 0, 100);

  const prior = input.priorScore;
  const delta = prior == null ? 0 : score - prior;
  const trend: Trend = delta > 1 ? 'RISING' : delta < -1 ? 'FALLING' : 'FLAT';

  let band: ReputationBand;
  if (score >= REPUTATION_EXCELLENT) band = 'EXCELLENT';
  else if (score >= REPUTATION_GOOD) band = 'GOOD';
  else band = 'WEAK';
  // RECOVERING: a track that was weak (prior below GOOD) but has gained clearly.
  if (band === 'WEAK' && prior != null && prior < REPUTATION_GOOD && delta >= REPUTATION_RECOVERING_DELTA) band = 'RECOVERING';

  const reasons: string[] = [];
  if (completion >= 0.65) reasons.push('완주율 우수');
  if ((input.skipRate ?? 0) >= 0.4) reasons.push('스킵 높음');
  if (band === 'RECOVERING') reasons.push('약세→회복 추세');
  if (reasons.length === 0) reasons.push('안정');

  return { trackId: input.trackId, title: input.title, status: 'READY', score: round(score, 1), band, trend, reasons };
}
