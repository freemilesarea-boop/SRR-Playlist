// WEB-OBS-2 — Health Score & Status (pure, unit-tested).
//
// The Health Score is an OPERATIONAL PRIORITIZATION signal, not an SLA/uptime guarantee. A score of
// 100 means "no problem signal in this window", NOT "no incident is possible". It is a weighted blend
// of component sub-scores (see HEALTH_WEIGHTS); each component maps a measured rate to a 0..1 badness
// against a documented budget, and a component with no data contributes no penalty. When the window
// carries too few events/sessions we return INSUFFICIENT_DATA rather than a confident-looking number.

import { clamp, safeRatio } from './math';
import {
  HEALTH_WEIGHTS, HEALTH_BAND_HEALTHY, HEALTH_BAND_WATCH, HEALTH_BAND_DEGRADED,
  MIN_EVENTS_FOR_SCORE, MIN_SESSIONS_FOR_SCORE,
  ERROR_RATE_BUDGET, CRITICAL_ERROR_RATE_BUDGET, CHUNK_FAILURE_RATE_BUDGET, HYDRATION_ERROR_RATE_BUDGET,
  SLOW_API_RATE_BUDGET, SLOW_ROUTE_RATE_BUDGET, LONG_TASK_RATE_BUDGET, BOOT_RECOVERY_FAILURE_BUDGET,
  VITAL_GOOD_MAX, VITAL_NI_MAX, CRITICAL_ERROR_RATE_FLOOR, CHUNK_FAILURE_RATE_CRITICAL,
} from './thresholds';

export type HealthStatus = 'HEALTHY' | 'WATCH' | 'DEGRADED' | 'CRITICAL' | 'INSUFFICIENT_DATA';

/**
 * Raw inputs for a window/scope. All counts are non-negative; vital p75s are null when no vital of
 * that name was seen. `sessions` is the distinct session count. `bootRecoveryAttempts/Failures` are
 * null when boot-recovery telemetry is unavailable (→ that component is simply skipped).
 */
export interface HealthInput {
  totalEvents: number;
  sessions: number;
  errorCount: number;
  criticalErrorCount: number;
  chunkErrorSessions: number; // sessions that saw a chunk-load failure
  hydrationErrorSessions: number;
  apiCount: number;
  slowApiCount: number;
  routeCount: number;
  slowRouteCount: number;
  longTaskCount: number;
  lcpP75: number | null;
  inpP75: number | null;
  clsP75: number | null;
  bootRecoveryAttempts: number | null;
  bootRecoveryFailures: number | null;
}

export interface HealthComponent {
  key: string;
  weight: number;
  /** 0 (worst) .. 1 (best); null when the component had no data (excluded from the weighted mean). */
  score: number | null;
  /** The measured rate/value that produced the score (for evidence display). */
  value: number | null;
  budget: number | null;
}

export interface HealthResult {
  status: HealthStatus;
  /** 0..100 rounded, or null when INSUFFICIENT_DATA. */
  score: number | null;
  components: HealthComponent[];
  reasons: string[];
  sessions: number;
  totalEvents: number;
}

/** Linear badness→goodness for a rate against a budget: rate 0 → 1 (good), rate>=budget → 0 (bad). */
function rateScore(value: number, budget: number): number {
  if (budget <= 0) return value > 0 ? 0 : 1;
  return clamp(1 - value / budget, 0, 1);
}

/** Vital p75 goodness: <=good → 1, >=ni → 0, linear in the "needs-improvement" band. */
function vitalScore(p75: number | null, good: number, ni: number): number | null {
  if (p75 == null || !Number.isFinite(p75)) return null;
  if (p75 <= good) return 1;
  if (p75 >= ni) return 0;
  return clamp(1 - (p75 - good) / (ni - good), 0, 1);
}

export function computeHealth(input: HealthInput): HealthResult {
  const sessions = Math.max(0, input.sessions);
  const totalEvents = Math.max(0, input.totalEvents);

  // Insufficient-data gate — refuse to fabricate a score from a trickle.
  if (totalEvents < MIN_EVENTS_FOR_SCORE || sessions < MIN_SESSIONS_FOR_SCORE) {
    return {
      status: 'INSUFFICIENT_DATA', score: null, components: [], sessions, totalEvents,
      reasons: [`표본 부족(events ${totalEvents}/${MIN_EVENTS_FOR_SCORE}, sessions ${sessions}/${MIN_SESSIONS_FOR_SCORE})`],
    };
  }

  const errorRate = safeRatio(input.errorCount, totalEvents);
  const criticalRate = safeRatio(input.criticalErrorCount, totalEvents);
  const chunkRate = safeRatio(input.chunkErrorSessions, sessions);
  const hydrationRate = safeRatio(input.hydrationErrorSessions, sessions);
  const slowApiRate = safeRatio(input.slowApiCount, input.apiCount);
  const slowRouteRate = safeRatio(input.slowRouteCount, input.routeCount);
  const longTaskRate = safeRatio(input.longTaskCount, sessions);
  const bootFailRate = input.bootRecoveryAttempts && input.bootRecoveryAttempts > 0
    ? safeRatio(input.bootRecoveryFailures ?? 0, input.bootRecoveryAttempts)
    : null;

  const components: HealthComponent[] = [
    { key: 'errorRate', weight: HEALTH_WEIGHTS.errorRate, value: errorRate, budget: ERROR_RATE_BUDGET, score: rateScore(errorRate, ERROR_RATE_BUDGET) },
    { key: 'criticalErrorRate', weight: HEALTH_WEIGHTS.criticalErrorRate, value: criticalRate, budget: CRITICAL_ERROR_RATE_BUDGET, score: rateScore(criticalRate, CRITICAL_ERROR_RATE_BUDGET) },
    { key: 'chunkFailureRate', weight: HEALTH_WEIGHTS.chunkFailureRate, value: chunkRate, budget: CHUNK_FAILURE_RATE_BUDGET, score: rateScore(chunkRate, CHUNK_FAILURE_RATE_BUDGET) },
    { key: 'hydrationErrorRate', weight: HEALTH_WEIGHTS.hydrationErrorRate, value: hydrationRate, budget: HYDRATION_ERROR_RATE_BUDGET, score: rateScore(hydrationRate, HYDRATION_ERROR_RATE_BUDGET) },
    { key: 'slowApiRate', weight: HEALTH_WEIGHTS.slowApiRate, value: input.apiCount > 0 ? slowApiRate : null, budget: SLOW_API_RATE_BUDGET, score: input.apiCount > 0 ? rateScore(slowApiRate, SLOW_API_RATE_BUDGET) : null },
    { key: 'slowRouteRate', weight: HEALTH_WEIGHTS.slowRouteRate, value: input.routeCount > 0 ? slowRouteRate : null, budget: SLOW_ROUTE_RATE_BUDGET, score: input.routeCount > 0 ? rateScore(slowRouteRate, SLOW_ROUTE_RATE_BUDGET) : null },
    { key: 'longTaskRate', weight: HEALTH_WEIGHTS.longTaskRate, value: longTaskRate, budget: LONG_TASK_RATE_BUDGET, score: rateScore(longTaskRate, LONG_TASK_RATE_BUDGET) },
    { key: 'lcp', weight: HEALTH_WEIGHTS.lcp, value: input.lcpP75, budget: VITAL_GOOD_MAX.LCP, score: vitalScore(input.lcpP75, VITAL_GOOD_MAX.LCP, VITAL_NI_MAX.LCP) },
    { key: 'inp', weight: HEALTH_WEIGHTS.inp, value: input.inpP75, budget: VITAL_GOOD_MAX.INP, score: vitalScore(input.inpP75, VITAL_GOOD_MAX.INP, VITAL_NI_MAX.INP) },
    { key: 'cls', weight: HEALTH_WEIGHTS.cls, value: input.clsP75, budget: VITAL_GOOD_MAX.CLS, score: vitalScore(input.clsP75, VITAL_GOOD_MAX.CLS, VITAL_NI_MAX.CLS) },
    { key: 'bootRecoveryFailureRate', weight: HEALTH_WEIGHTS.bootRecoveryFailureRate, value: bootFailRate, budget: BOOT_RECOVERY_FAILURE_BUDGET, score: bootFailRate == null ? null : rateScore(bootFailRate, BOOT_RECOVERY_FAILURE_BUDGET) },
  ];

  // Weighted mean over components that HAVE data (renormalize by present weight).
  let weighted = 0;
  let presentWeight = 0;
  for (const c of components) {
    if (c.score == null) continue;
    weighted += c.weight * c.score;
    presentWeight += c.weight;
  }
  const score = presentWeight > 0 ? Math.round((weighted / presentWeight) * 100) : 100;

  // Band the score, then apply hard floors for the two "page someone now" conditions.
  let status: HealthStatus =
    score >= HEALTH_BAND_HEALTHY ? 'HEALTHY'
      : score >= HEALTH_BAND_WATCH ? 'WATCH'
        : score >= HEALTH_BAND_DEGRADED ? 'DEGRADED'
          : 'CRITICAL';

  const reasons: string[] = [];
  if (criticalRate >= CRITICAL_ERROR_RATE_FLOOR) {
    reasons.push(`critical error rate ${(criticalRate * 100).toFixed(2)}% ≥ ${(CRITICAL_ERROR_RATE_FLOOR * 100).toFixed(0)}%`);
    if (status === 'HEALTHY' || status === 'WATCH') status = 'DEGRADED';
  }
  if (chunkRate >= CHUNK_FAILURE_RATE_CRITICAL) {
    reasons.push(`chunk failure rate ${(chunkRate * 100).toFixed(2)}% ≥ ${(CHUNK_FAILURE_RATE_CRITICAL * 100).toFixed(0)}%`);
    status = 'CRITICAL';
  }
  if (errorRate >= ERROR_RATE_BUDGET) reasons.push(`error rate ${(errorRate * 100).toFixed(2)}% ≥ budget`);

  return { status, score, components, reasons, sessions, totalEvents };
}
