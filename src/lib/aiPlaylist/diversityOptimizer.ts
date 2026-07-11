// AI-MUSIC-2 — Diversity Optimizer. Measures artist/genre/mood/BPM/energy diversity of a proposed track
// order and offers two de-streak passes: `localDestreak` (adjacent swaps — preserves the energy-curve
// backbone) used by the builder, and `optimizeDiversity` (aggressive greedy reorder) for the Optimize tab.
// Pure reordering of a PROPOSAL — it never touches a real playlist. Artist id is not reliably present in the
// track metadata, so artist balance uses a genre proxy (documented deferred work).

import { clamp, round } from '../observability/math';
import { DIVERSITY_MAX_GENRE_STREAK, DIVERSITY_MAX_MOOD_STREAK, BPM_BUCKET_EDGES } from './thresholds';
import type { PlaylistTrackPick } from './types';

function bpmBucket(bpm: number | null): number {
  if (bpm == null) return -1;
  let b = 0;
  for (const edge of BPM_BUCKET_EDGES) { if (bpm >= edge) b++; }
  return b;
}

function distinctRatio<T>(values: T[], skip: (v: T) => boolean): number | null {
  const known = values.filter((v) => !skip(v));
  if (known.length === 0) return null;
  return round(new Set(known).size / known.length, 3);
}

function trailingStreak(seq: Array<string | null>, key: string | null): number {
  if (key == null) return 0;
  let n = 0;
  for (let i = seq.length - 1; i >= 0; i--) { if (seq[i] === key) n++; else break; }
  return n;
}

export interface DiversityMetrics {
  artistDiversity: number | null;   // genre proxy
  genreDiversity: number | null;
  moodDiversity: number | null;
  bpmDiversity: number | null;
  energySpread: number | null;      // 0..1 range of energies present
}

export function measureDiversity(picks: PlaylistTrackPick[]): DiversityMetrics {
  const genreDiv = distinctRatio(picks.map((p) => p.genre), (v) => v == null);
  const moodDiv = distinctRatio(picks.map((p) => p.mood), (v) => v == null);
  const bpmDiv = distinctRatio(picks.map((p) => bpmBucket(p.bpm)), (b) => b < 0);
  const energies = picks.map((p) => p.energy).filter((e): e is number => e != null);
  const energySpread = energies.length ? round(clamp(Math.max(...energies) - Math.min(...energies), 0, 1), 3) : null;
  return { artistDiversity: genreDiv, genreDiversity: genreDiv, moodDiversity: moodDiv, bpmDiversity: bpmDiv, energySpread };
}

function reindex(picks: PlaylistTrackPick[]): PlaylistTrackPick[] {
  return picks.map((p, i) => ({ ...p, position: i + 1 }));
}

/**
 * Adjacent-swap de-streak that PRESERVES the energy-curve backbone: only swaps neighbours (i, i+1) — whose
 * target energies are near-equal — when position i sits inside a genre/mood run longer than the max and the
 * swap reduces it. A few passes converge without disturbing the Low→High→Low shape.
 */
export function localDestreak(picks: PlaylistTrackPick[]): PlaylistTrackPick[] {
  const arr = [...picks];
  const n = arr.length;
  const overStreakAt = (a: PlaylistTrackPick[], i: number): boolean => {
    const g = trailingStreak(a.slice(0, i).map((p) => p.genre), a[i].genre);
    const m = trailingStreak(a.slice(0, i).map((p) => p.mood), a[i].mood);
    return g >= DIVERSITY_MAX_GENRE_STREAK || m >= DIVERSITY_MAX_MOOD_STREAK;
  };
  for (let pass = 0; pass < 3; pass++) {
    let swapped = false;
    for (let i = 1; i < n - 1; i++) {
      if (overStreakAt(arr, i) && !overStreakAt([...arr.slice(0, i), arr[i + 1], arr[i]], i)) {
        [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
        swapped = true;
      }
    }
    if (!swapped) break;
  }
  return reindex(arr);
}

/** Aggressive greedy de-streak: keep score priority but avoid > max consecutive same genre/mood. */
export function optimizeDiversity(picks: PlaylistTrackPick[]): { picks: PlaylistTrackPick[]; metrics: DiversityMetrics } {
  const remaining = [...picks];
  const out: PlaylistTrackPick[] = [];
  const genreSeq: Array<string | null> = [];
  const moodSeq: Array<string | null> = [];
  while (remaining.length > 0) {
    let chosen = 0;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      if (trailingStreak(genreSeq, cand.genre) < DIVERSITY_MAX_GENRE_STREAK && trailingStreak(moodSeq, cand.mood) < DIVERSITY_MAX_MOOD_STREAK) { chosen = i; break; }
    }
    const pick = remaining.splice(chosen, 1)[0];
    out.push(pick); genreSeq.push(pick.genre); moodSeq.push(pick.mood);
  }
  const reindexed = reindex(out);
  return { picks: reindexed, metrics: measureDiversity(reindexed) };
}
