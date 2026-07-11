// AI-MUSIC-2 — Playlist Build Confidence. Rule-based (NOT a model) confidence in a generated playlist from
// pool size + store readiness + compatibility coverage + learning coverage + energy-curve fit. Capped below
// 100 — a rule-based proposal is never certainty. No usable evidence → INSUFFICIENT_DATA.

import { clamp, round } from '../observability/math';
import {
  BUILD_CONFIDENCE_WEIGHTS, BUILD_CONFIDENCE_FULL_POOL, BUILD_CONFIDENCE_MAX,
  BUILD_CONFIDENCE_HIGH, BUILD_CONFIDENCE_MEDIUM,
} from './thresholds';
import type { AiConfidenceLevel } from '../aiMusic/types';
import type { PlaylistBuildConfidenceInput, PlaylistBuildConfidence } from './types';

function level(v: number | null): AiConfidenceLevel {
  if (v == null) return 'INSUFFICIENT_DATA';
  if (v >= BUILD_CONFIDENCE_HIGH) return 'HIGH';
  if (v >= BUILD_CONFIDENCE_MEDIUM) return 'MEDIUM';
  return 'LOW';
}

export function computePlaylistBuildConfidence(input: PlaylistBuildConfidenceInput): PlaylistBuildConfidence {
  const W = BUILD_CONFIDENCE_WEIGHTS;
  if (input.poolSize <= 0 || !input.storeReady) {
    return { value: null, level: 'INSUFFICIENT_DATA', parts: [] };
  }
  const pool = clamp((input.poolSize / BUILD_CONFIDENCE_FULL_POOL) * 100, 0, 100);
  const store = input.storeReady ? 100 : 0;
  const compat = clamp(input.compatCoverage * 100, 0, 100);
  const learn = clamp(input.learningCoverage * 100, 0, 100);
  const curve = clamp((input.curveFit ?? 0) * 100, 0, 100);
  const parts = [
    { key: 'poolSize', label: 'Pool Size', score: round(pool, 1) ?? 0, weight: W.poolSize },
    { key: 'storeReady', label: 'Store Readiness', score: round(store, 1) ?? 0, weight: W.storeReady },
    { key: 'compatCoverage', label: 'Compatibility Coverage', score: round(compat, 1) ?? 0, weight: W.compatCoverage },
    { key: 'learningCoverage', label: 'Learning Coverage', score: round(learn, 1) ?? 0, weight: W.learningCoverage },
    { key: 'curveFit', label: 'Energy Curve Fit', score: round(curve, 1) ?? 0, weight: W.curveFit },
  ];
  const total = parts.reduce((s, p) => s + p.weight, 0);
  const weighted = parts.reduce((s, p) => s + p.score * p.weight, 0) / total;
  const value = clamp(Math.min(weighted, BUILD_CONFIDENCE_MAX), 0, BUILD_CONFIDENCE_MAX);
  return { value: round(value, 1), level: level(value), parts };
}
