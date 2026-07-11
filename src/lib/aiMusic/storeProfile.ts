// AI-MUSIC-1 — Store Intelligence Profile. Rule-based per-store musical profile derived from READ-ONLY
// playback aggregates (skip/complete/like/replay + genre/mood/instrumental/energy of played tracks).
// Seasonal / weather / holiday patterns are rule placeholders (no such data this phase → NOT_AVAILABLE).

import { clamp, round, safeRatio } from '../observability/math';
import { MIN_PLAYS_FOR_STORE_PROFILE, PREF_STRONG, PREF_MODERATE } from './thresholds';
import type { StorePlayAggregate, StoreProfile, PrefStrength } from './types';

function strength(share: number): PrefStrength {
  if (share >= PREF_STRONG) return 'STRONG';
  if (share >= PREF_MODERATE) return 'MODERATE';
  if (share > 0) return 'WEAK';
  return 'NEUTRAL';
}

function topShares(counts: Record<string, number>, total: number, limit = 6): Array<{ key: string; share: number; strength: PrefStrength }> {
  if (total <= 0) return [];
  return Object.entries(counts)
    .map(([key, c]) => ({ key, share: round(c / total, 3) ?? 0, strength: strength(c / total) }))
    .sort((a, b) => b.share - a.share)
    .slice(0, limit);
}

export function computeStoreProfile(agg: StorePlayAggregate): StoreProfile {
  const plays = agg.plays;
  const base: Omit<StoreProfile, 'status' | 'genrePreference' | 'moodPreference' | 'instrumentalPreference' | 'vocalPreference' | 'energyPreference' | 'skipRate' | 'completionRate' | 'likeRatio' | 'dislikeRatio' | 'avgSessionSeconds' | 'activeHours'> = {
    storeId: agg.storeId, storeType: agg.storeType,
    seasonalPattern: 'NOT_AVAILABLE', weatherPattern: 'NOT_AVAILABLE', holidayPattern: 'NOT_AVAILABLE', plays,
  };
  if (plays < MIN_PLAYS_FOR_STORE_PROFILE) {
    return {
      ...base, status: 'INSUFFICIENT_DATA', genrePreference: [], moodPreference: [],
      instrumentalPreference: null, vocalPreference: null, energyPreference: null,
      skipRate: null, completionRate: null, likeRatio: null, dislikeRatio: null, avgSessionSeconds: null, activeHours: [],
    };
  }
  const instrumentalPreference = round(safeRatio(agg.instrumentalPlays, agg.instrumentalPlays + agg.vocalPlays), 3);
  const vocalPreference = round(safeRatio(agg.vocalPlays, agg.instrumentalPlays + agg.vocalPlays), 3);
  const energyPreference = agg.energyCount > 0 ? round(clamp(agg.energySum / agg.energyCount, 0, 1), 3) : null;
  const activeHours = Object.entries(agg.activeHours).map(([h, c]) => ({ h: Number(h), c })).sort((a, b) => b.c - a.c).slice(0, 4).map((x) => x.h);

  return {
    ...base, status: 'READY',
    genrePreference: topShares(agg.genreShare, plays),
    moodPreference: topShares(agg.moodShare, plays),
    instrumentalPreference, vocalPreference, energyPreference,
    skipRate: round(safeRatio(agg.skips, plays), 3),
    completionRate: round(safeRatio(agg.completes, plays), 3),
    likeRatio: round(safeRatio(agg.likes, plays), 4),
    dislikeRatio: round(safeRatio(agg.dislikes, plays), 4),
    avgSessionSeconds: agg.avgSessionSeconds == null ? null : round(agg.avgSessionSeconds, 0),
    activeHours,
  };
}
