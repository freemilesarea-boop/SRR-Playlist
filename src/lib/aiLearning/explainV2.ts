// AI-MUSIC-3 — Explainability v2. Per-track 8-factor explanation: Genre / Mood / Energy / Learning /
// Discovery / Industry / Time / Confidence — each 0..100 (or null when the signal is absent). Read-only —
// it explains a recommendation, it does not change anything.

import { round } from '../observability/math';
import type { ExplainV2, ExplainV2Factor } from './types';

export interface ExplainV2Input {
  trackId: string;
  title: string | null;
  genreMatch: number | null;      // 0..1
  moodMatch: number | null;
  energyFit: number | null;
  learningScore: number | null;   // 0..1 store-learning affinity
  discoveryScore: number | null;  // 0..1 (freshness / new-track weight)
  industryFit: number | null;
  timeFit: number | null;
  confidence: number | null;      // 0..100
}

function pct(v: number | null): number | null { return v == null ? null : round(v * 100, 0); }

export function buildExplainV2(input: ExplainV2Input): ExplainV2 {
  const factors: ExplainV2Factor[] = [
    { key: 'genre', label: 'Genre', score: pct(input.genreMatch) },
    { key: 'mood', label: 'Mood', score: pct(input.moodMatch) },
    { key: 'energy', label: 'Energy', score: pct(input.energyFit) },
    { key: 'learning', label: 'Learning', score: pct(input.learningScore) },
    { key: 'discovery', label: 'Discovery', score: pct(input.discoveryScore) },
    { key: 'industry', label: 'Industry', score: pct(input.industryFit) },
    { key: 'time', label: 'Time', score: pct(input.timeFit) },
    { key: 'confidence', label: 'Confidence', score: input.confidence == null ? null : round(input.confidence, 0) },
  ];
  const present = factors.filter((f) => f.score != null);
  const top = present.length ? [...present].sort((a, b) => (b.score as number) - (a.score as number))[0] : null;
  const summary = top ? `${top.label} ${top.score}% 주도` : '설명 신호 없음 (NO_DATA)';
  return { trackId: input.trackId, title: input.title, factors, summary };
}
