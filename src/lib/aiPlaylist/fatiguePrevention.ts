// AI-MUSIC-2 — Fatigue Prevention. Penalizes tracks over-played at the store within the recent 7-day
// window so a proposed playlist does not repeat the same songs. Pure function — READ-ONLY over the
// recent-play counts supplied by the read RPC; it never changes playback history.

import { clamp, round } from '../observability/math';
import { FATIGUE_PLAYS_SOFT, FATIGUE_PLAYS_HARD, FATIGUE_MIN_FACTOR } from './thresholds';

/**
 * Pick-score multiplier (0..1) from a track's recent 7-day play count.
 * < SOFT → 1.0 (no fatigue); SOFT..HARD → linear taper; ≥ HARD → FATIGUE_MIN_FACTOR floor.
 */
export function fatigueFactor(recentPlays7d: number): number {
  const n = Math.max(0, recentPlays7d);
  if (n < FATIGUE_PLAYS_SOFT) return 1;
  if (n >= FATIGUE_PLAYS_HARD) return FATIGUE_MIN_FACTOR;
  const span = FATIGUE_PLAYS_HARD - FATIGUE_PLAYS_SOFT;
  const t = (n - FATIGUE_PLAYS_SOFT) / span;                 // 0..1
  return round(clamp(1 - t * (1 - FATIGUE_MIN_FACTOR), FATIGUE_MIN_FACTOR, 1), 3) as number;
}

/**
 * Fatigue risk (0..1) of a set of selected tracks: mean of per-track recent-play pressure.
 * 0 recent plays → 0 risk; ≥ HARD plays → 1. null when no tracks.
 */
export function playlistFatigueRisk(recentPlays: number[]): number | null {
  if (recentPlays.length === 0) return null;
  const pressures = recentPlays.map((n) => clamp(Math.max(0, n) / FATIGUE_PLAYS_HARD, 0, 1));
  return round(pressures.reduce((a, b) => a + b, 0) / pressures.length, 3);
}
