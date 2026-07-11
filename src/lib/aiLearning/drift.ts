// AI-MUSIC-3 — Playlist Drift. Measures how far a playlist's current genre/mood/energy distribution has
// moved from its ORIGINAL intent (0 = identical, 1 = fully diverged). Pure math over two distribution
// snapshots — read-only analysis, no playlist change.

import { clamp, round } from '../observability/math';
import { DRIFT_LOW, DRIFT_MEDIUM } from './thresholds';
import type { DriftProfile, PlaylistDrift } from './types';

/** Total-variation distance (0..1) between two share maps (normalized internally). */
function shareDistance(a: Record<string, number>, b: Record<string, number>): number | null {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  if (keys.size === 0) return null;
  const sum = (m: Record<string, number>) => Object.values(m).reduce((s, v) => s + Math.max(0, v), 0);
  const sa = sum(a), sb = sum(b);
  if (sa <= 0 || sb <= 0) return null;
  let tv = 0;
  for (const k of keys) tv += Math.abs((Math.max(0, a[k] ?? 0) / sa) - (Math.max(0, b[k] ?? 0) / sb));
  return clamp(tv / 2, 0, 1);   // TV distance is half the L1
}

export function computePlaylistDrift(original: DriftProfile, current: DriftProfile): PlaylistDrift {
  const genreDrift = shareDistance(original.genreShare, current.genreShare);
  const moodDrift = shareDistance(original.moodShare, current.moodShare);
  const energyDrift = original.energyMean == null || current.energyMean == null ? null : clamp(Math.abs(original.energyMean - current.energyMean), 0, 1);

  const parts = [genreDrift, moodDrift, energyDrift].filter((v): v is number => v != null);
  if (parts.length === 0) {
    return { status: 'INSUFFICIENT_DATA', drift: null, band: 'NO_DATA', genreDrift, moodDrift, energyDrift, notes: ['비교 가능한 분포 없음'] };
  }
  const drift = clamp(parts.reduce((s, v) => s + v, 0) / parts.length, 0, 1);
  const band = drift <= DRIFT_LOW ? 'LOW' : drift <= DRIFT_MEDIUM ? 'MEDIUM' : 'HIGH';
  const notes: string[] = [];
  if (band === 'HIGH') notes.push('원래 목적에서 크게 이탈 — 재정렬 권고');
  if (genreDrift != null && genreDrift >= 0.5) notes.push('장르 구성 이탈');
  if (notes.length === 0) notes.push('목적 유지');

  return {
    status: 'READY', drift: round(drift, 3), band,
    genreDrift: round(genreDrift, 3), moodDrift: round(moodDrift, 3), energyDrift: round(energyDrift, 3), notes,
  };
}
