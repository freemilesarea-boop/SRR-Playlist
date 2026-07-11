// AI-MUSIC-1 — AI Confidence. Rule-based confidence (NOT a model) from sample size + store history +
// track history + learning coverage + signal coverage. Capped below 100 — musical recommendations from
// observational data are never certain. No data → INSUFFICIENT_DATA.

import { clamp, round } from '../observability/math';
import {
  CONFIDENCE_WEIGHTS, AI_CONFIDENCE_MAX, AI_CONFIDENCE_HIGH, AI_CONFIDENCE_MEDIUM, CONFIDENCE_FULL_SAMPLE,
} from './thresholds';
import type { AiConfidenceInput, AiConfidence, AiConfidenceLevel } from './types';

function level(v: number | null): AiConfidenceLevel {
  if (v == null) return 'INSUFFICIENT_DATA';
  if (v >= AI_CONFIDENCE_HIGH) return 'HIGH';
  if (v >= AI_CONFIDENCE_MEDIUM) return 'MEDIUM';
  return 'LOW';
}

export function computeAiConfidence(input: AiConfidenceInput): AiConfidence {
  const W = CONFIDENCE_WEIGHTS;
  if (input.sampleSize <= 0) return { value: null, level: 'INSUFFICIENT_DATA', parts: [] };
  const sample = clamp((input.sampleSize / CONFIDENCE_FULL_SAMPLE) * 100, 0, 100);
  const store = clamp((input.storeHistoryPlays / CONFIDENCE_FULL_SAMPLE) * 100, 0, 100);
  const track = clamp((input.trackHistoryPlays / (CONFIDENCE_FULL_SAMPLE / 3)) * 100, 0, 100);
  const learn = clamp(input.learningCoverage * 100, 0, 100);
  const signal = clamp(input.signalCoverage * 100, 0, 100);
  const parts = [
    { key: 'sampleSize', label: 'Sample Size', score: round(sample, 1) ?? 0, weight: W.sampleSize },
    { key: 'storeHistory', label: 'Store History', score: round(store, 1) ?? 0, weight: W.storeHistory },
    { key: 'trackHistory', label: 'Track History', score: round(track, 1) ?? 0, weight: W.trackHistory },
    { key: 'learningCoverage', label: 'Learning Coverage', score: round(learn, 1) ?? 0, weight: W.learningCoverage },
    { key: 'signalCoverage', label: 'Signal Coverage', score: round(signal, 1) ?? 0, weight: W.signalCoverage },
  ];
  const total = parts.reduce((s, p) => s + p.weight, 0);
  const weighted = parts.reduce((s, p) => s + p.score * p.weight, 0) / total;
  const value = clamp(Math.min(weighted, AI_CONFIDENCE_MAX), 0, AI_CONFIDENCE_MAX);
  return { value: round(value, 1), level: level(value), parts };
}
