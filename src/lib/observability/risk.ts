// WEB-OBS-2 — Route / API risk ranking (pure, unit-tested).
//
// Turns per-resource aggregates into an explainable 0..100 risk score and a P0..P3 priority. The
// formula is published (below) so a ranking can always be justified. Design choices that matter:
//   • A resource with too few samples is INSUFFICIENT_DATA, never P0 — we don't page on 2 events.
//   • Volume alone must NOT dominate: affected SESSIONS (deduped users) contribute on a log scale,
//     so a chatty-but-healthy endpoint doesn't outrank a rare-but-broken one.
//   • Low sample counts get a confidence penalty applied to the final score.

import { clamp, safeRatio } from './math';
import {
  RISK_BAND_P0, RISK_BAND_P1, RISK_BAND_P2, MIN_SAMPLES_FOR_METRIC,
  SLOW_API_MS, SLOW_ROUTE_MS, CONFIDENCE_MEDIUM_SAMPLES, CONFIDENCE_HIGH_SAMPLES,
} from './thresholds';
import type { Confidence } from './release';

export type Priority = 'P0' | 'P1' | 'P2' | 'P3' | 'INSUFFICIENT_DATA';

export interface RiskResult {
  score: number; // 0..100
  priority: Priority;
  confidence: Confidence;
  factors: Record<string, number>; // component contributions, for the "why"
}

function confidenceFor(samples: number): Confidence {
  if (samples < MIN_SAMPLES_FOR_METRIC) return 'INSUFFICIENT';
  if (samples >= CONFIDENCE_HIGH_SAMPLES) return 'HIGH';
  if (samples >= CONFIDENCE_MEDIUM_SAMPLES) return 'MEDIUM';
  return 'LOW';
}

/** Session weight on a log scale, capped — 1 session ≈ 0, ~150 sessions ≈ 1. */
function sessionWeight(sessions: number): number {
  if (sessions <= 1) return 0;
  return clamp(Math.log10(sessions) / Math.log10(150), 0, 1);
}

/** Latency badness: at/under the slow bar → 0, ~3× the bar → 1. */
function latencyBadness(p95: number | null, slowBar: number): number {
  if (p95 == null || !Number.isFinite(p95) || p95 <= slowBar) return 0;
  return clamp((p95 - slowBar) / (slowBar * 2), 0, 1);
}

function bandPriority(score: number): Priority {
  if (score >= RISK_BAND_P0) return 'P0';
  if (score >= RISK_BAND_P1) return 'P1';
  if (score >= RISK_BAND_P2) return 'P2';
  return 'P3';
}

/** Apply a confidence haircut so a thin sample can't reach the top bands. */
function withConfidence(rawScore: number, samples: number): RiskResult {
  const confidence = confidenceFor(samples);
  if (confidence === 'INSUFFICIENT') {
    return { score: Math.round(rawScore * 0.4), priority: 'INSUFFICIENT_DATA', confidence, factors: {} };
  }
  const factor = confidence === 'LOW' ? 0.7 : confidence === 'MEDIUM' ? 0.9 : 1;
  const score = clamp(Math.round(rawScore * factor), 0, 100);
  return { score, priority: bandPriority(score), confidence, factors: {} };
}

export interface RouteRiskInput {
  p95: number | null;
  errorRate: number; // errors / route-events on this route
  sessions: number;
  longTasks: number;
  sampleCount: number;
  regressed?: boolean; // release regression flag for this route
}

/**
 * Route risk = weighted blend of latency, error rate, long-task pressure and reach.
 *   latency 35 · errorRate 35 · longTask 10 · reach 10 · regression 10
 */
export function routeRiskScore(input: RouteRiskInput): RiskResult {
  const latency = latencyBadness(input.p95, SLOW_ROUTE_MS);
  const errorBad = clamp(input.errorRate / 0.1, 0, 1); // 10% error on a route = fully bad
  const longTaskBad = clamp(safeRatio(input.longTasks, Math.max(1, input.sessions)), 0, 1);
  const reach = sessionWeight(input.sessions);
  const regression = input.regressed ? 1 : 0;

  const factors = {
    latency: 35 * latency,
    errorRate: 35 * errorBad,
    longTask: 10 * longTaskBad,
    reach: 10 * reach,
    regression: 10 * regression,
  };
  const raw = Object.values(factors).reduce((s, v) => s + v, 0);
  const out = withConfidence(raw, input.sampleCount);
  out.factors = factors;
  return out;
}

export interface ApiRiskInput {
  p95: number | null;
  failureRate: number; // failed / total calls
  timeoutRate: number;
  networkErrorRate: number;
  sessions: number;
  sampleCount: number;
  regressed?: boolean;
}

/**
 * API risk = weighted blend of latency, failure, timeout/network, reach and regression.
 *   latency 30 · failure 30 · timeout+network 15 · reach 10 · regression 15
 */
export function apiRiskScore(input: ApiRiskInput): RiskResult {
  const latency = latencyBadness(input.p95, SLOW_API_MS);
  const failureBad = clamp(input.failureRate / 0.1, 0, 1); // 10% failure = fully bad
  const netBad = clamp((input.timeoutRate + input.networkErrorRate) / 0.1, 0, 1);
  const reach = sessionWeight(input.sessions);
  const regression = input.regressed ? 1 : 0;

  const factors = {
    latency: 30 * latency,
    failure: 30 * failureBad,
    timeoutNetwork: 15 * netBad,
    reach: 10 * reach,
    regression: 15 * regression,
  };
  const raw = Object.values(factors).reduce((s, v) => s + v, 0);
  const out = withConfidence(raw, input.sampleCount);
  out.factors = factors;
  return out;
}
