// WEB-OBS-5 — Recovery Tracking (pure, unit-tested, rule-based — NO ML).
//
// "Did it actually recover — and is it recurring?" Compares a RECENT sub-window against an EARLIER
// sub-window of the same release/incident, over a real observation window with enough samples on
// BOTH sides. One dip never means RECOVERED; a fresh spike in the recent buckets re-opens the verdict
// (REGRESSED). Automated status is a signal only — operator confirmation is required to close an
// incident (operatorCloseRequired stays true).

import { percentChange, round } from './math';
import type { Confidence } from './release';
import {
  RECOVERY_MIN_WINDOW_MINUTES, RECOVERY_MIN_SESSIONS_PER_BUCKET, RECOVERY_MIN_EVENTS_PER_BUCKET,
  RECOVERY_IMPROVE_REL, RECOVERY_RECOVERED_ABS, RECOVERY_REGRESS_REL, RECOVERY_RECURRENCE_MIN_RATE,
} from './thresholds';

export type RecoveryStatus = 'NOT_STARTED' | 'IMPROVING' | 'STABLE' | 'RECOVERED' | 'REGRESSED' | 'INSUFFICIENT_DATA';

export interface RecoveryBucket {
  errorRate: number | null;
  criticalRate: number | null;
  chunkRate: number | null;
  apiP95: number | null;
  lcpP75: number | null;
  sessions: number;
  events: number;
}

export interface RecoveryInput {
  earlier: RecoveryBucket;   // the incident period (baseline for recovery)
  recent: RecoveryBucket;    // the most-recent observation sub-window
  observationWindowMinutes: number;
  /** ordered error-rate series across recent buckets (oldest→newest) for recurrence detection. */
  recentSeries: number[];
  /** optional explicit recovery target (e.g. baseline release error rate). Defaults to the abs floor. */
  targetErrorRate?: number | null;
}

export interface RecoveryResult {
  status: RecoveryStatus;
  confidence: Confidence;
  baselineErrorRate: number | null;  // "earlier" = the incident level
  currentErrorRate: number | null;   // "recent"
  targetErrorRate: number | null;
  relChange: number | null;          // recent vs earlier
  observationWindowMinutes: number;
  recurrence: boolean;
  /** ALWAYS true — recovery is a signal; only an operator closes an incident. */
  operatorCloseRequired: boolean;
  reasons: string[];
}

function recoveryConfidence(recent: RecoveryBucket, earlier: RecoveryBucket): Confidence {
  const minSessions = Math.min(recent.sessions, earlier.sessions);
  if (minSessions < RECOVERY_MIN_SESSIONS_PER_BUCKET) return 'INSUFFICIENT';
  if (minSessions >= 200) return 'HIGH';
  if (minSessions >= 60) return 'MEDIUM';
  return 'LOW';
}

/** Detect a fresh spike after a dip within the recent buckets (oldest→newest). */
function detectRecurrence(series: readonly number[]): boolean {
  if (series.length < 3) return false;
  let min = Infinity;
  for (let i = 0; i < series.length - 1; i++) min = Math.min(min, series[i]);
  const last = series[series.length - 1];
  // A dip occurred (min notably below the last) AND the last bucket is back above the recurrence floor.
  return last >= RECOVERY_RECURRENCE_MIN_RATE && min < last * 0.6;
}

export function computeRecovery(input: RecoveryInput): RecoveryResult {
  const { earlier, recent } = input;
  const confidence = recoveryConfidence(recent, earlier);
  const baselineErrorRate = earlier.errorRate;
  const currentErrorRate = recent.errorRate;
  const target = input.targetErrorRate ?? RECOVERY_RECOVERED_ABS;
  const relChange = baselineErrorRate != null && currentErrorRate != null ? round(percentChange(currentErrorRate, baselineErrorRate), 4) : null;
  const recurrence = detectRecurrence(input.recentSeries);

  const base: Omit<RecoveryResult, 'status' | 'reasons'> = {
    confidence, baselineErrorRate: round(baselineErrorRate, 4), currentErrorRate: round(currentErrorRate, 4),
    targetErrorRate: round(target, 4), relChange, observationWindowMinutes: input.observationWindowMinutes,
    recurrence, operatorCloseRequired: true,
  };

  // Gates: real window + enough samples on both sides + measurable rates.
  if (input.observationWindowMinutes < RECOVERY_MIN_WINDOW_MINUTES) {
    return { ...base, status: 'NOT_STARTED', reasons: [`관측 창 부족(${input.observationWindowMinutes}분 < ${RECOVERY_MIN_WINDOW_MINUTES}분)`] };
  }
  if (confidence === 'INSUFFICIENT' || recent.events < RECOVERY_MIN_EVENTS_PER_BUCKET || earlier.events < RECOVERY_MIN_EVENTS_PER_BUCKET) {
    return { ...base, status: 'INSUFFICIENT_DATA', reasons: [`표본 부족(recent ${recent.sessions}s/${recent.events}e, earlier ${earlier.sessions}s/${earlier.events}e)`] };
  }
  if (baselineErrorRate == null || currentErrorRate == null) {
    return { ...base, status: 'INSUFFICIENT_DATA', reasons: ['error rate 측정 불가'] };
  }

  // Recurrence overrides an otherwise-improving read.
  if (recurrence) {
    return { ...base, status: 'REGRESSED', reasons: ['최근 버킷에서 재발(dip 후 재상승) 감지'] };
  }
  // Regressed: recent materially above earlier.
  if (baselineErrorRate > 0 && currentErrorRate >= baselineErrorRate * RECOVERY_REGRESS_REL) {
    return { ...base, status: 'REGRESSED', reasons: [`error rate ${(baselineErrorRate * 100).toFixed(2)}% → ${(currentErrorRate * 100).toFixed(2)}% (악화)`] };
  }
  // Recovered: dropped past the improvement ratio AND under the absolute target.
  const improvedEnough = baselineErrorRate > 0 && currentErrorRate <= baselineErrorRate * RECOVERY_IMPROVE_REL;
  if (improvedEnough && currentErrorRate <= target) {
    return { ...base, status: 'RECOVERED', reasons: [`error rate ${(currentErrorRate * 100).toFixed(2)}% ≤ target ${(target * 100).toFixed(2)}% · 운영자 확인 필요`] };
  }
  if (improvedEnough) {
    return { ...base, status: 'IMPROVING', reasons: [`error rate 하락(${(baselineErrorRate * 100).toFixed(2)}% → ${(currentErrorRate * 100).toFixed(2)}%) but target 미달`] };
  }
  return { ...base, status: 'STABLE', reasons: ['유의미한 개선·악화 신호 없음(관찰 지속)'] };
}
