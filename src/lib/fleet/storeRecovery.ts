// WEB-OBS-6 — Store recovery tracking (pure, unit-tested). "Did the store actually come back — and
// is it staying back?" Compares an EARLIER vs a RECENT sub-window of a store's heartbeat health over a
// real observation window with enough beats on BOTH sides. One returning heartbeat never means
// RECOVERED; a fresh unhealthy run in the recent buckets re-opens the verdict (REGRESSED). Automated
// status is a SIGNAL only — an operator closes the incident (operatorCloseRequired stays true).

import { round, safeRatio } from '../observability/math';
import type { Confidence } from '../observability/release';
import {
  RECOVERY_MIN_WINDOW_MINUTES, RECOVERY_MIN_HEARTBEATS_PER_SIDE,
  RECOVERY_STABLE_MIN_HEARTBEATS, RECOVERY_RECURRENCE_MIN,
} from './thresholds';

export type StoreRecoveryStatus =
  | 'NOT_STARTED' | 'RECOVERING' | 'STABLE' | 'RECOVERED' | 'REGRESSED' | 'INSUFFICIENT_DATA';

export interface RecoverySide {
  healthyHeartbeats: number;
  unhealthyHeartbeats: number;
}

export interface StoreRecoveryInput {
  earlier: RecoverySide;   // the incident period
  recent: RecoverySide;    // the most-recent observation sub-window
  observationWindowMinutes: number;
  /** recent unhealthy-flag series (oldest→newest, 1 = unhealthy beat) for recurrence detection. */
  recentSeries: number[];
  /** consecutive healthy beats at the very end of the recent window. */
  trailingHealthyStreak: number;
}

export interface StoreRecoveryResult {
  status: StoreRecoveryStatus;
  confidence: Confidence;
  baselineUnhealthyRate: number | null;
  currentUnhealthyRate: number | null;
  observationWindowMinutes: number;
  recurrence: boolean;
  operatorCloseRequired: boolean; // ALWAYS true
  reasons: string[];
}

function sideTotal(s: RecoverySide): number { return s.healthyHeartbeats + s.unhealthyHeartbeats; }

/** A fresh unhealthy run after a healthy dip within the recent series. */
function detectRecurrence(series: readonly number[]): boolean {
  if (series.length < 3) return false;
  let healthyDipSeen = false;
  let trailingUnhealthy = 0;
  for (let i = 0; i < series.length; i++) {
    if (series[i] === 0) { healthyDipSeen = true; trailingUnhealthy = 0; }
    else if (healthyDipSeen) trailingUnhealthy += 1;
  }
  return trailingUnhealthy >= RECOVERY_RECURRENCE_MIN;
}

export function computeStoreRecovery(input: StoreRecoveryInput): StoreRecoveryResult {
  const earlierTotal = sideTotal(input.earlier);
  const recentTotal = sideTotal(input.recent);
  const baselineUnhealthyRate = earlierTotal > 0 ? round(safeRatio(input.earlier.unhealthyHeartbeats, earlierTotal), 4) : null;
  const currentUnhealthyRate = recentTotal > 0 ? round(safeRatio(input.recent.unhealthyHeartbeats, recentTotal), 4) : null;
  const recurrence = detectRecurrence(input.recentSeries);
  const minSide = Math.min(earlierTotal, recentTotal);
  const confidence: Confidence = minSide < RECOVERY_MIN_HEARTBEATS_PER_SIDE ? 'INSUFFICIENT' : minSide >= 20 ? 'HIGH' : minSide >= 8 ? 'MEDIUM' : 'LOW';

  const base: Omit<StoreRecoveryResult, 'status' | 'reasons'> = {
    confidence, baselineUnhealthyRate, currentUnhealthyRate,
    observationWindowMinutes: input.observationWindowMinutes, recurrence, operatorCloseRequired: true,
  };

  if (input.observationWindowMinutes < RECOVERY_MIN_WINDOW_MINUTES) {
    return { ...base, status: 'NOT_STARTED', reasons: [`관측 창 부족(${input.observationWindowMinutes}분 < ${RECOVERY_MIN_WINDOW_MINUTES}분)`] };
  }
  if (minSide < RECOVERY_MIN_HEARTBEATS_PER_SIDE || baselineUnhealthyRate == null || currentUnhealthyRate == null) {
    return { ...base, status: 'INSUFFICIENT_DATA', reasons: [`heartbeat 표본 부족(earlier ${earlierTotal}, recent ${recentTotal})`] };
  }
  if (recurrence) {
    return { ...base, status: 'REGRESSED', reasons: ['최근 구간에서 불안정 재발 감지'] };
  }
  if (currentUnhealthyRate > baselineUnhealthyRate) {
    return { ...base, status: 'REGRESSED', reasons: [`불안정 비율 악화(${(baselineUnhealthyRate * 100).toFixed(0)}% → ${(currentUnhealthyRate * 100).toFixed(0)}%)`] };
  }
  const recovered = currentUnhealthyRate <= 0.05 && input.trailingHealthyStreak >= RECOVERY_STABLE_MIN_HEARTBEATS && baselineUnhealthyRate > 0.05;
  if (recovered) {
    return { ...base, status: 'RECOVERED', reasons: ['최근 구간 정상 · 운영자 확인 후 종료 필요'] };
  }
  if (currentUnhealthyRate < baselineUnhealthyRate) {
    return { ...base, status: 'RECOVERING', reasons: [`불안정 비율 하락(${(baselineUnhealthyRate * 100).toFixed(0)}% → ${(currentUnhealthyRate * 100).toFixed(0)}%) — 관측 지속`] };
  }
  return { ...base, status: 'STABLE', reasons: ['유의미한 변화 없음(관측 지속)'] };
}
