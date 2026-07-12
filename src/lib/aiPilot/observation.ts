// AI-MUSIC-5 — Observation window classification + read-only snapshot shaping. Classifies a pilot's elapsed
// fraction into BASELINE/EARLY/MID/LATE/FINAL and shapes a rollup the caller feeds from REAL data. Pure &
// deterministic (clock passed in). It only *labels* observed data — it never generates fake Observation rows
// and never mutates anything. Absent metrics stay null (NOT_AVAILABLE); below-floor samples → INSUFFICIENT_DATA.

import { OBSERVATION_WINDOWS, OBSERVATION_INTERVAL_MS, PILOT_MIN_SESSIONS, PILOT_MIN_PLAYBACKS } from './thresholds';
import type { ObservationWindow, ObservationSnapshot } from './types';

// Map an elapsed fraction (0..1) to its observation window using the ordered upTo boundaries.
export function classifyWindow(fraction: number): ObservationWindow {
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  if (f <= 0) return 'BASELINE';
  for (const w of OBSERVATION_WINDOWS) {
    if (w.window === 'BASELINE') continue;
    if (f <= w.upTo) return w.window;
  }
  return 'FINAL';
}

export function windowForElapsed(elapsedMs: number, totalMs: number): ObservationWindow {
  if (!(totalMs > 0)) return 'BASELINE';
  return classifyWindow(elapsedMs / totalMs);
}

// When the next read-only observation rollup is suggested (never enforced; snapshots are manual/scheduled reads).
export function nextObservationAt(lastObservationMs: number | null, nowMs: number): number {
  const anchor = lastObservationMs ?? nowMs;
  return anchor + OBSERVATION_INTERVAL_MS;
}

export interface ObservationInput {
  elapsedMs: number; totalMs: number;
  stores: number; sessions: number; playbacks: number;
  completionRate: number | null; skipRate: number | null; likeRate: number | null; dislikeRate: number | null;
  streamingQualityScore: number | null;
  criticalIncidents: number | null;
  contamination: 'CLEAN' | 'SUSPECTED' | 'CONTAMINATED' | 'UNKNOWN';
}

export function buildObservationSnapshot(input: ObservationInput): ObservationSnapshot {
  const window = windowForElapsed(input.elapsedMs, input.totalMs);
  const notes: string[] = [];

  let status: ObservationSnapshot['status'];
  if (input.sessions <= 0 && input.playbacks <= 0) {
    status = 'NO_DATA';
    notes.push('관측 데이터 없음 (NO_DATA)');
  } else if (input.sessions < PILOT_MIN_SESSIONS || input.playbacks < PILOT_MIN_PLAYBACKS) {
    status = 'INSUFFICIENT_DATA';
    notes.push(`표본 부족 (sessions ${input.sessions}/${PILOT_MIN_SESSIONS}, playbacks ${input.playbacks}/${PILOT_MIN_PLAYBACKS})`);
  } else {
    status = 'READY';
  }

  if (input.streamingQualityScore == null) notes.push('Streaming 품질 점수 NOT_AVAILABLE');
  if (input.contamination === 'CONTAMINATED') notes.push('오염 감지 — 결과 신뢰 불가');

  return {
    window, status,
    stores: input.stores, sessions: input.sessions, playbacks: input.playbacks,
    completionRate: input.completionRate, skipRate: input.skipRate,
    likeRate: input.likeRate, dislikeRate: input.dislikeRate,
    streamingQualityScore: input.streamingQualityScore,
    criticalIncidents: input.criticalIncidents,
    contamination: input.contamination,
    notes,
  };
}
