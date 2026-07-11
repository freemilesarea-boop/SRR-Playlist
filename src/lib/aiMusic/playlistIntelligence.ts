// AI-MUSIC-1 — Playlist Intelligence. Rule-based structural analysis of a track list: diversity, fatigue
// risk, genre/mood/artist balance, energy curve, repeat risk, instrumental ratio. Read-only analysis —
// it does not create or modify any playlist.

import { clamp, round, safeRatio } from '../observability/math';
import { PLAYLIST_MIN_TRACKS, FATIGUE_REPEAT_WINDOW, FATIGUE_HIGH } from './thresholds';
import type { TrackProfile, PlaylistIntelligence } from './types';

/** Shannon-style evenness (0..1) of a categorical distribution. */
function evenness(counts: Record<string, number>): number | null {
  const vals = Object.values(counts).filter((v) => v > 0);
  const total = vals.reduce((s, v) => s + v, 0);
  if (total <= 0 || vals.length <= 1) return vals.length === 1 ? 0 : null;
  const h = -vals.reduce((s, v) => { const p = v / total; return s + p * Math.log(p); }, 0);
  return clamp(h / Math.log(vals.length), 0, 1);
}

function distinctRatio(values: Array<string | null>): number | null {
  const known = values.filter((v): v is string => v != null);
  if (known.length === 0) return null;
  return round(new Set(known).size / known.length, 3);
}

/** Fatigue: fraction of adjacent-window repeats of artist/genre within FATIGUE_REPEAT_WINDOW. */
function fatigueIndex(tracks: TrackProfile[]): number | null {
  if (tracks.length < 2) return null;
  let repeats = 0, checks = 0;
  for (let i = 0; i < tracks.length; i++) {
    for (let j = Math.max(0, i - FATIGUE_REPEAT_WINDOW); j < i; j++) {
      checks++;
      if (tracks[i].genre && tracks[i].genre === tracks[j].genre) repeats += 0.5;
      // artist repeat weighs more (uses genre proxy when artist not on profile)
    }
  }
  return checks === 0 ? null : clamp(repeats / checks, 0, 1);
}

export function analyzePlaylist(tracks: TrackProfile[]): PlaylistIntelligence {
  if (tracks.length < PLAYLIST_MIN_TRACKS) {
    return {
      trackCount: tracks.length, status: 'INSUFFICIENT_DATA',
      diversity: null, fatigueRisk: null, fatigueBand: 'NO_DATA', genreBalance: null, moodBalance: null,
      artistBalance: null, energyCurve: [], repeatRisk: null, instrumentalRatio: null, notes: ['트랙 수 부족'],
    };
  }
  const genreCounts: Record<string, number> = {};
  const moodCounts: Record<string, number> = {};
  for (const t of tracks) { if (t.genre) genreCounts[t.genre] = (genreCounts[t.genre] ?? 0) + 1; if (t.mood) moodCounts[t.mood] = (moodCounts[t.mood] ?? 0) + 1; }

  const diversity = distinctRatio(tracks.map((t) => t.genre));
  const genreBalance = evenness(genreCounts);
  const moodBalance = evenness(moodCounts);
  const artistBalance = distinctRatio(tracks.map((t) => t.genre)); // artist not on profile → genre proxy
  const fatigue = fatigueIndex(tracks);
  const instrumentalKnown = tracks.filter((t) => t.instrumental != null);
  const instrumentalRatio = instrumentalKnown.length ? round(safeRatio(instrumentalKnown.filter((t) => t.instrumental).length, instrumentalKnown.length), 3) : null;
  const energyCurve = tracks.map((t) => (t.energy == null ? -1 : round(t.energy, 2) as number));
  // repeat risk: 1 - diversity, when diversity known
  const repeatRisk = diversity == null ? null : round(clamp(1 - diversity, 0, 1), 3);

  const fatigueBand = fatigue == null ? 'NO_DATA' : fatigue >= FATIGUE_HIGH ? 'HIGH' : fatigue >= FATIGUE_HIGH * 0.5 ? 'MEDIUM' : 'LOW';
  const notes: string[] = [];
  if (diversity != null && diversity < 0.4) notes.push('장르 다양성 낮음');
  if (fatigueBand === 'HIGH') notes.push('반복 피로 위험 높음');
  if (instrumentalRatio != null) notes.push(`Instrumental ${(instrumentalRatio * 100).toFixed(0)}%`);

  return {
    trackCount: tracks.length, status: 'READY',
    diversity: round(diversity, 3), fatigueRisk: round(fatigue, 3), fatigueBand,
    genreBalance: round(genreBalance, 3), moodBalance: round(moodBalance, 3), artistBalance: round(artistBalance, 3),
    energyCurve, repeatRisk, instrumentalRatio, notes: notes.length ? notes : ['균형 양호'],
  };
}
