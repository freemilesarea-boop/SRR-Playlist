// WEB-OBS-9 — Confidence Engine. Rule-based confidence (NOT a probability model) from evidence breadth:
// signal coverage, sample count, store diversity, browser diversity. Capped below 100 — observational
// data can never be fully certain. No data → INSUFFICIENT.

import { clamp, round } from '../observability/math';
import {
  CONFIDENCE_WEIGHTS, CONFIDENCE_MAX, CONFIDENCE_SAMPLE_FULL, CONFIDENCE_STORES_FULL,
  CONFIDENCE_BROWSERS_FULL, CONFIDENCE_HIGH, CONFIDENCE_MEDIUM,
} from './thresholds';
import type { ConfidenceInput, ConfidenceResult, ConfidenceLevel } from './types';

function level(v: number | null): ConfidenceLevel {
  if (v == null) return 'INSUFFICIENT';
  if (v >= CONFIDENCE_HIGH) return 'HIGH';
  if (v >= CONFIDENCE_MEDIUM) return 'MEDIUM';
  return 'LOW';
}

/** Compute rule-based confidence from evidence breadth. All sub-scores are 0..100. */
export function computeConfidence(input: ConfidenceInput): ConfidenceResult {
  const W = CONFIDENCE_WEIGHTS;
  if (input.sessions <= 0) {
    return { value: null, level: 'INSUFFICIENT', parts: [] };
  }
  const cov = input.coverage == null ? 0 : clamp(input.coverage * 100, 0, 100);
  const samp = clamp((input.sessions / CONFIDENCE_SAMPLE_FULL) * 100, 0, 100);
  const store = clamp((input.stores / CONFIDENCE_STORES_FULL) * 100, 0, 100);
  const brow = clamp((input.browsers / CONFIDENCE_BROWSERS_FULL) * 100, 0, 100);

  const parts = [
    { key: 'coverage', label: 'Signal Coverage', score: round(cov, 1) ?? 0, weight: W.signalCoverage },
    { key: 'sample', label: 'Sample Count', score: round(samp, 1) ?? 0, weight: W.sampleCount },
    { key: 'storeDiv', label: 'Store Diversity', score: round(store, 1) ?? 0, weight: W.storeDiversity },
    { key: 'browserDiv', label: 'Browser Diversity', score: round(brow, 1) ?? 0, weight: W.browserDiversity },
  ];
  const total = parts.reduce((s, p) => s + p.weight, 0);
  const weighted = parts.reduce((s, p) => s + p.score * p.weight, 0) / total;
  const value = clamp(Math.min(weighted, CONFIDENCE_MAX), 0, CONFIDENCE_MAX);
  return { value: round(value, 1), level: level(value), parts };
}
