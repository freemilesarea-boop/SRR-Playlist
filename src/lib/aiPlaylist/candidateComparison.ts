// AI-MUSIC-2 — Candidate Comparison. Generates A/B/C playlist candidates (different strategies) from the
// same store input, scores each on a composite of compatibility / diversity / (low) fatigue / energy-curve
// fit / confidence, and picks the best. SIMULATION ONLY — comparing proposals; nothing is deployed.

import { clamp, round } from '../observability/math';
import { CANDIDATE_WEIGHTS, CANDIDATE_STRATEGIES } from './thresholds';
import { buildPlaylist } from './playlistBuilder';
import type { PlaylistBuildInput, GeneratedPlaylist, PlaylistCandidate, CandidateComparison } from './types';

function meanCompat(pl: GeneratedPlaylist): number | null {
  const cs = pl.picks.map((p) => p.compatScore).filter((s): s is number => s != null);
  return cs.length ? round(cs.reduce((a, b) => a + b, 0) / cs.length, 1) : null;
}

function compositeScore(pl: GeneratedPlaylist): { score: number | null; metrics: PlaylistCandidate['metrics'] } {
  const compatibility = meanCompat(pl);
  const diversity = pl.diversity;
  const fatigueRisk = pl.fatigueRisk;
  const curveFit = pl.curveFit;
  const confidence = pl.confidence.value;
  const metrics = { compatibility, diversity, fatigueRisk, curveFit, confidence };
  if (pl.status !== 'READY') return { score: null, metrics };
  const W = CANDIDATE_WEIGHTS;
  const parts: Array<{ v: number | null; w: number; invert?: boolean }> = [
    { v: compatibility == null ? null : compatibility / 100, w: W.compatibility },
    { v: diversity, w: W.diversity },
    { v: fatigueRisk, w: W.fatigue, invert: true },      // lower fatigue is better
    { v: curveFit, w: W.curveFit },
    { v: confidence == null ? null : confidence / 100, w: W.confidence },
  ];
  const present = parts.filter((p) => p.v != null);
  if (present.length === 0) return { score: null, metrics };
  const totW = present.reduce((s, p) => s + p.w, 0);
  const val = present.reduce((s, p) => s + (p.invert ? 1 - (p.v as number) : (p.v as number)) * p.w, 0) / totW;
  return { score: round(clamp(val * 100, 0, 100), 1), metrics };
}

/** Build and compare A/B/C candidates for a store; marks the highest composite score as best. */
export function compareCandidates(baseInput: Omit<PlaylistBuildInput, 'strategy'>): CandidateComparison {
  const candidates: PlaylistCandidate[] = CANDIDATE_STRATEGIES.map(({ label, strategy }) => {
    const playlist = buildPlaylist({ ...baseInput, strategy });
    const { score, metrics } = compositeScore(playlist);
    return { label, strategy, playlist, score, isBest: false, metrics };
  });

  let bestLabel: string | null = null;
  let bestScore = -Infinity;
  for (const c of candidates) { if (c.score != null && c.score > bestScore) { bestScore = c.score; bestLabel = c.label; } }
  for (const c of candidates) c.isBest = c.label === bestLabel;

  const notes: string[] = ['Simulation Only — 후보 비교, 자동 배포 없음'];
  if (bestLabel == null) notes.push('유효 후보 없음 — INSUFFICIENT_DATA');
  else notes.push(`Best Candidate: ${bestLabel} (${candidates.find((c) => c.label === bestLabel)?.strategy})`);

  return { storeId: baseInput.storeId, candidates, bestLabel, notes, simulationOnly: true };
}
