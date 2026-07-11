// WEB-OBS-2 — Release comparison, regression classification & confidence (pure, unit-tested).
//
// Compares one metric between two releases (or two windows) and returns a verdict that is HONEST
// about sample size. A change is only REGRESSED/IMPROVED when it clears BOTH an absolute floor (noise
// guard) AND a relative floor (scale guard) in the worsening/improving direction — a single outlier
// or a sub-threshold wiggle stays STABLE. Below the per-metric minimum sample count on either side we
// return INSUFFICIENT_DATA and never mint a confident verdict.

import { percentChange, absDelta, round } from './math';
import { MetricSpec, METRIC_SPECS, MIN_SAMPLES_FOR_METRIC, CONFIDENCE_HIGH_SAMPLES, CONFIDENCE_MEDIUM_SAMPLES } from './thresholds';

export type MetricClassification = 'IMPROVED' | 'REGRESSED' | 'STABLE' | 'INSUFFICIENT_DATA';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';

export interface MetricSample {
  /** Aggregated value (p75, rate, etc.); null when the metric had no measurable events. */
  value: number | null;
  /** Number of underlying samples that produced `value` (events or sessions, per metric). */
  count: number;
}

export interface MetricComparison {
  key: string;
  label: string;
  lowerIsBetter: boolean;
  unit?: string;
  valueA: number | null;
  valueB: number | null;
  sampleA: number;
  sampleB: number;
  /** valueB − valueA (absolute), null if either side missing. */
  absDelta: number | null;
  /** relative change from A→B as a signed fraction, null on zero/again-missing baseline. */
  relDelta: number | null;
  classification: MetricClassification;
  confidence: Confidence;
}

/** Confidence from the SMALLER of the two sample counts — the weaker side bounds the claim. */
export function classifyConfidence(sampleA: number, sampleB: number): Confidence {
  const n = Math.min(sampleA, sampleB);
  if (n < MIN_SAMPLES_FOR_METRIC) return 'INSUFFICIENT';
  if (n >= CONFIDENCE_HIGH_SAMPLES) return 'HIGH';
  if (n >= CONFIDENCE_MEDIUM_SAMPLES) return 'MEDIUM';
  return 'LOW';
}

/**
 * Classify a single metric change from baseline A → current B.
 * - INSUFFICIENT_DATA when either side is below MIN_SAMPLES_FOR_METRIC or a value is missing.
 * - Otherwise worsened past BOTH abs & rel thresholds → REGRESSED; improved past BOTH → IMPROVED.
 * - Zero baseline: rel is undefined, so the ABSOLUTE threshold alone decides.
 */
export function compareMetric(spec: MetricSpec, a: MetricSample, b: MetricSample): MetricComparison {
  const base: Omit<MetricComparison, 'classification' | 'confidence'> = {
    key: spec.key, label: spec.label, lowerIsBetter: spec.lowerIsBetter, unit: spec.unit,
    valueA: a.value, valueB: b.value, sampleA: a.count, sampleB: b.count,
    absDelta: a.value != null && b.value != null ? round(absDelta(b.value, a.value)) : null,
    relDelta: a.value != null && b.value != null ? round(percentChange(b.value, a.value), 4) : null,
  };

  const confidence = classifyConfidence(a.count, b.count);
  if (a.value == null || b.value == null || a.count < MIN_SAMPLES_FOR_METRIC || b.count < MIN_SAMPLES_FOR_METRIC) {
    return { ...base, classification: 'INSUFFICIENT_DATA', confidence };
  }

  const rawAbs = b.value - a.value; // signed, B relative to A
  const absMag = Math.abs(rawAbs);
  const relMag = a.value !== 0 ? absMag / Math.abs(a.value) : Infinity; // zero baseline → abs decides

  const passesAbs = absMag >= spec.absThreshold;
  const passesRel = a.value !== 0 ? relMag >= spec.relThreshold : true;
  const meaningful = passesAbs && passesRel;

  if (!meaningful) return { ...base, classification: 'STABLE', confidence };

  // Direction: for lower-is-better, a POSITIVE rawAbs (B>A) is a regression.
  const worse = spec.lowerIsBetter ? rawAbs > 0 : rawAbs < 0;
  return { ...base, classification: worse ? 'REGRESSED' : 'IMPROVED', confidence };
}

/** The per-release metric bundle a comparison consumes. Values are pre-aggregated server-side. */
export interface ReleaseMetrics {
  release: string;
  sessions: number;
  events: number;
  metrics: Record<string, MetricSample>;
}

export interface ReleaseComparison {
  releaseA: string;
  releaseB: string;
  sessionsA: number;
  sessionsB: number;
  eventsA: number;
  eventsB: number;
  rows: MetricComparison[];
  regressed: number;
  improved: number;
}

/** Compare two release metric bundles across every metric that has a spec. */
export function compareReleases(a: ReleaseMetrics, b: ReleaseMetrics, keys?: string[]): ReleaseComparison {
  const specKeys = keys ?? Object.keys(METRIC_SPECS);
  const rows = specKeys
    .map((k) => METRIC_SPECS[k])
    .filter((s): s is MetricSpec => Boolean(s))
    .map((spec) => compareMetric(
      spec,
      a.metrics[spec.key] ?? { value: null, count: 0 },
      b.metrics[spec.key] ?? { value: null, count: 0 },
    ));
  return {
    releaseA: a.release, releaseB: b.release,
    sessionsA: a.sessions, sessionsB: b.sessions,
    eventsA: a.events, eventsB: b.events,
    rows,
    regressed: rows.filter((r) => r.classification === 'REGRESSED').length,
    improved: rows.filter((r) => r.classification === 'IMPROVED').length,
  };
}
