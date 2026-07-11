// AI-MUSIC-1 — Track Intelligence Profile. Reuses existing track metadata + QC + store-learning score +
// READ-ONLY playback performance. Rule-based classification; performance bands degrade to NO_DATA below
// the sample floor. Time-of-day / industry suitability are rule-derived from energy/mood/instrumental.

import { safeRatio } from '../observability/math';
import { MIN_PLAYS_FOR_TRACK_PROFILE, TRACK_SKIP_POOR, TRACK_COMPLETION_STRONG, TRACK_REPLAY_STRONG } from './thresholds';
import type { TrackMeta, TrackPerformance, TrackProfile, BpmBucket, PerfBand, AiConfidenceLevel } from './types';

function bpmBucket(bpm: number | null): BpmBucket {
  if (bpm == null || bpm <= 0) return 'UNKNOWN';
  if (bpm < 90) return 'SLOW';
  if (bpm < 115) return 'MEDIUM';
  if (bpm < 135) return 'UPBEAT';
  return 'FAST';
}

/** Rule-derived time-of-day suitability from energy (low energy → morning/late; high → midday/evening). */
function timeOfDay(energy: number | null, mood: string | null): string[] {
  const out = new Set<string>();
  if (energy == null) return ['any'];
  if (energy < 0.4) { out.add('morning'); out.add('late-night'); }
  else if (energy < 0.7) { out.add('afternoon'); out.add('evening'); }
  else { out.add('midday'); out.add('evening'); }
  if (mood && /calm|chill|ambient|relax/i.test(mood)) out.add('morning');
  if (mood && /party|dance|energetic|up/i.test(mood)) out.add('evening');
  return [...out];
}

/** Rule-derived industry suitability from instrumental/energy/mood. */
function industrySuitability(meta: TrackMeta): string[] {
  const out = new Set<string>();
  const e = meta.energy ?? 0.5;
  if (meta.instrumental) { out.add('cafe'); out.add('hospital'); out.add('office'); out.add('winebar'); }
  if (e >= 0.7) { out.add('gym'); out.add('retail'); }
  if (e < 0.45) { out.add('hospital'); out.add('spa'); out.add('winebar'); }
  if (meta.mood && /calm|chill|ambient|jazz|acoustic/i.test(meta.mood)) { out.add('cafe'); out.add('winebar'); }
  if (out.size === 0) out.add('general');
  return [...out];
}

function band(rate: number | null, goodAtOrAbove: boolean, good: number, poor: number): PerfBand {
  if (rate == null) return 'NO_DATA';
  if (goodAtOrAbove) return rate >= good ? 'STRONG' : rate <= poor ? 'POOR' : 'OK';
  return rate <= poor ? 'STRONG' : rate >= good ? 'POOR' : 'OK';
}

export function computeTrackProfile(meta: TrackMeta, perf: TrackPerformance): TrackProfile {
  const enough = perf.plays >= MIN_PLAYS_FOR_TRACK_PROFILE;
  const skipRate = enough ? safeRatio(perf.skips, perf.plays) : null;
  const completionRate = enough ? safeRatio(perf.completes, perf.plays) : null;
  const replayRate = enough ? safeRatio(perf.replays, perf.plays) : null;

  const learningConfidence: AiConfidenceLevel = perf.learningScore != null && enough ? 'MEDIUM'
    : enough ? 'LOW' : 'INSUFFICIENT_DATA';

  return {
    trackId: meta.trackId, title: meta.title, genre: meta.genre, mood: meta.mood,
    energy: meta.energy, danceability: meta.danceability, instrumental: meta.instrumental, vocal: meta.vocal,
    bpmBucket: bpmBucket(meta.bpm),
    timeOfDaySuitability: timeOfDay(meta.energy, meta.mood),
    industrySuitability: industrySuitability(meta),
    replayPerformance: band(replayRate, true, TRACK_REPLAY_STRONG, 0),
    skipPerformance: band(skipRate, false, TRACK_SKIP_POOR, TRACK_SKIP_POOR * 0.5),
    completionPerformance: band(completionRate, true, TRACK_COMPLETION_STRONG, TRACK_COMPLETION_STRONG * 0.6),
    learningConfidence,
    qcStatus: meta.qcStatus,
  };
}
