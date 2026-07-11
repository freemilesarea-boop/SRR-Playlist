// AI-MUSIC-1 — Store ↔ Track Compatibility Engine. Rule-based match score from genre/mood/energy/
// instrumental/vocal + historical performance + industry + time. RECOMMENDATION ONLY — it never queues,
// deploys, or plays anything. A component with no signal is dropped and weights renormalize; below the
// confidence gate → INSUFFICIENT_DATA.

import { clamp, round } from '../observability/math';
import {
  COMPAT_WEIGHTS, COMPAT_EXCELLENT, COMPAT_GOOD, COMPAT_ACCEPTABLE, COMPAT_WEAK, MIN_PLAYS_FOR_COMPAT_HISTORY,
} from './thresholds';
import type { StoreProfile, TrackProfile, TrackPerformance, Compatibility, CompatBand, CompatComponent } from './types';

function band(score: number): CompatBand {
  if (score >= COMPAT_EXCELLENT) return 'EXCELLENT';
  if (score >= COMPAT_GOOD) return 'GOOD';
  if (score >= COMPAT_ACCEPTABLE) return 'ACCEPTABLE';
  if (score >= COMPAT_WEAK) return 'WEAK';
  return 'UNSUITABLE';
}

/** Match a track attribute against the store's ranked preference list → 0..1. */
function prefMatch(pref: Array<{ key: string; share: number }>, value: string | null): number | null {
  if (value == null) return null;
  const hit = pref.find((p) => p.key.toLowerCase() === value.toLowerCase());
  if (!hit) return pref.length ? 0.15 : null; // known preferences but no match → weak; no data → null
  return clamp(0.4 + hit.share * 1.5, 0, 1);
}

function numMatch(target: number | null, value: number | null): number | null {
  if (target == null || value == null) return null;
  return clamp(1 - Math.abs(target - value), 0, 1);
}

export function computeCompatibility(store: StoreProfile, track: TrackProfile, perf?: TrackPerformance): Compatibility {
  const W = COMPAT_WEIGHTS;
  if (store.status === 'INSUFFICIENT_DATA') {
    return { storeId: store.storeId, trackId: track.trackId, score: null, band: 'INSUFFICIENT_DATA', components: [], reasons: ['store 표본 부족'] };
  }
  const genre = prefMatch(store.genrePreference, track.genre);
  const mood = prefMatch(store.moodPreference, track.mood);
  const energy = numMatch(store.energyPreference, track.energy);
  const instrumental = store.instrumentalPreference == null || track.instrumental == null ? null
    : clamp(1 - Math.abs(store.instrumentalPreference - (track.instrumental ? 1 : 0)), 0, 1);
  const vocal = store.vocalPreference == null || track.vocal == null ? null
    : clamp(1 - Math.abs(store.vocalPreference - (track.vocal ? 1 : 0)), 0, 1);
  // historical: completion strong + low skip → high; only when enough store plays of this track.
  const hist = perf && perf.plays >= MIN_PLAYS_FOR_COMPAT_HISTORY
    ? clamp((perf.completes / perf.plays) * 0.7 + (1 - perf.skips / perf.plays) * 0.3, 0, 1) : null;
  const industry = store.storeType == null ? null : (track.industrySuitability.includes(store.storeType.toLowerCase()) ? 1 : track.industrySuitability.includes('general') ? 0.4 : 0.2);
  const time = store.activeHours.length === 0 ? null : (track.timeOfDaySuitability.includes('any') ? 0.5 : 0.6);

  const defs: Array<{ key: string; label: string; weight: number; v: number | null }> = [
    { key: 'genreMatch', label: 'Genre Match', weight: W.genreMatch, v: genre },
    { key: 'moodMatch', label: 'Mood Match', weight: W.moodMatch, v: mood },
    { key: 'energyMatch', label: 'Energy Match', weight: W.energyMatch, v: energy },
    { key: 'instrumentalMatch', label: 'Instrumental Match', weight: W.instrumentalMatch, v: instrumental },
    { key: 'vocalMatch', label: 'Vocal Match', weight: W.vocalMatch, v: vocal },
    { key: 'historicalPerformance', label: 'Historical Performance', weight: W.historicalPerformance, v: hist },
    { key: 'industryMatch', label: 'Industry Match', weight: W.industryMatch, v: industry },
    { key: 'timeMatch', label: 'Time Match', weight: W.timeMatch, v: time },
  ];
  const components: CompatComponent[] = defs.map((d) => ({ key: d.key, label: d.label, score: round(d.v, 3), weight: d.weight }));
  const present = defs.filter((d) => d.v != null);
  const presentWeight = present.reduce((s, d) => s + d.weight, 0);
  if (present.length === 0 || presentWeight === 0) {
    return { storeId: store.storeId, trackId: track.trackId, score: null, band: 'INSUFFICIENT_DATA', components, reasons: ['비교 가능한 신호 없음'] };
  }
  const score = clamp((present.reduce((s, d) => s + (d.v as number) * d.weight, 0) / presentWeight) * 100, 0, 100);
  const reasons: string[] = [];
  if (genre != null && genre >= 0.6) reasons.push('장르 선호 일치');
  if (hist != null && hist >= 0.7) reasons.push('과거 성과 우수');
  if (industry === 1) reasons.push('업종 적합');
  if (track.qcStatus && track.qcStatus !== 'approved') reasons.push(`QC 상태 ${track.qcStatus}`);
  return { storeId: store.storeId, trackId: track.trackId, score: round(score, 1), band: band(score), components, reasons };
}
