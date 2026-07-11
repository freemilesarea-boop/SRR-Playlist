// AI-MUSIC-3 — Playlist Evolution. Builds the V1 → V2 → … → Vn history of a playlist with per-version score
// deltas and an overall trend. Read-only analysis of proposal snapshots — it does not change any real
// playlist.

import { round } from '../observability/math';
import { MIN_VERSIONS_FOR_EVOLUTION } from './thresholds';
import type { PlaylistVersion, PlaylistEvolution, Trend } from './types';

export function buildEvolution(versions: PlaylistVersion[]): PlaylistEvolution {
  if (versions.length < MIN_VERSIONS_FOR_EVOLUTION) {
    return { status: 'INSUFFICIENT_DATA', versions: versions.map((v) => ({ ...v, delta: null })), latestScore: versions.at(-1)?.score ?? null, overallTrend: 'FLAT', summary: '버전 부족' };
  }
  const ordered = [...versions].sort((a, b) => a.version - b.version);
  const withDelta = ordered.map((v, i) => ({ ...v, delta: i === 0 || v.score == null || ordered[i - 1].score == null ? null : round(v.score - (ordered[i - 1].score as number), 1) }));
  const first = ordered.find((v) => v.score != null)?.score ?? null;
  const last = [...ordered].reverse().find((v) => v.score != null)?.score ?? null;
  const overall = first == null || last == null ? 0 : last - first;
  const overallTrend: Trend = overall > 1 ? 'RISING' : overall < -1 ? 'FALLING' : 'FLAT';
  const summary = overallTrend === 'RISING' ? `개선 중 (+${round(overall, 1)})` : overallTrend === 'FALLING' ? `하락 (${round(overall, 1)})` : '안정';
  return { status: 'READY', versions: withDelta, latestScore: last, overallTrend, summary };
}
