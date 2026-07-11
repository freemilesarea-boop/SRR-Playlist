// WEB-OBS-2 — Rule-based spike detection (pure, unit-tested).
//
// Deliberately simple and EXPLAINABLE — no statistical/ML model (out of scope, and unexplainable
// alerts erode trust). A spike requires ALL of: enough current samples, enough affected sessions,
// AND a change that clears both a relative and an absolute floor vs a baseline. Zero baseline is
// handled explicitly (a from-nothing appearance is a spike only if it also clears the absolute floor
// and the session minimum) so low-traffic noise doesn't page anyone.

import { percentChange, round } from './math';
import { MIN_SESSIONS_FOR_INCIDENT } from './thresholds';

export interface SpikeInput {
  current: number;
  baseline: number;
  /** samples behind `current` (events) */
  currentSamples: number;
  /** distinct sessions affected by the current value */
  affectedSessions: number;
  minSamples: number;
  minSessions?: number;
  /** relative increase (fraction) required, e.g. 0.5 = +50% */
  relThreshold: number;
  /** absolute increase required in the same unit as current/baseline */
  absThreshold: number;
}

export interface SpikeResult {
  isSpike: boolean;
  relChange: number | null;
  absChange: number;
  reason: string;
}

export function detectSpike(input: SpikeInput): SpikeResult {
  const minSessions = input.minSessions ?? MIN_SESSIONS_FOR_INCIDENT;
  const absChange = input.current - input.baseline;
  const relChange = percentChange(input.current, input.baseline);

  if (input.currentSamples < input.minSamples) {
    return { isSpike: false, relChange, absChange, reason: `표본 부족(${input.currentSamples}/${input.minSamples})` };
  }
  if (input.affectedSessions < minSessions) {
    return { isSpike: false, relChange, absChange, reason: `영향 세션 부족(${input.affectedSessions}/${minSessions})` };
  }
  const passesAbs = absChange >= input.absThreshold;
  if (!passesAbs) {
    return { isSpike: false, relChange, absChange, reason: `절대 증가 미달(${round(absChange)} < ${input.absThreshold})` };
  }
  // Zero baseline: no relative change is defined → absolute + session gates already passed ⇒ spike.
  if (input.baseline === 0) {
    return { isSpike: true, relChange: null, absChange, reason: `baseline 0에서 신규 발생(${round(input.current)})` };
  }
  const passesRel = relChange != null && relChange >= input.relThreshold;
  if (!passesRel) {
    return { isSpike: false, relChange, absChange, reason: `상대 증가 미달(${relChange != null ? `${(relChange * 100).toFixed(0)}%` : '—'} < ${(input.relThreshold * 100).toFixed(0)}%)` };
  }
  return {
    isSpike: true, relChange, absChange,
    reason: `+${(relChange! * 100).toFixed(0)}% / +${round(absChange)} (baseline ${round(input.baseline)} → ${round(input.current)})`,
  };
}
