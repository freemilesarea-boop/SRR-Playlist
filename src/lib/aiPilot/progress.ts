// AI-MUSIC-5 — Pilot Progress shaping (read-only). Rolls up an active pilot's elapsed/remaining time, sample
// collection, and guardrail status into a PilotProgress view for the operator. Confidence is evidence-breadth
// only (capped at PILOT_CONFIDENCE_MAX — never certainty). Pure & deterministic; never mutates, never acts.

import { PROGRESS_CONFIDENCE_FULL_SESSIONS, PILOT_CONFIDENCE_MAX, PILOT_MIN_SESSIONS, PILOT_MIN_PLAYBACKS, OBSERVATION_INTERVAL_MS } from './thresholds';
import type { PilotProgress, GuardrailMonitorStatus } from './types';

export interface ProgressInput {
  startMs: number | null; endMs: number | null; nowMs: number;
  storesActive: number; storesExcluded: number; storesOffline: number;
  sessionsCollected: number; playbacksCollected: number;
  guardrailStatus: GuardrailMonitorStatus;
  contamination: string;
  lastObservationMs: number | null;
}

export function buildPilotProgress(input: ProgressInput): PilotProgress {
  const hasWindow = input.startMs != null && input.endMs != null && input.endMs > input.startMs;
  const elapsedMs = input.startMs != null ? Math.max(0, input.nowMs - input.startMs) : null;
  const remainingMs = hasWindow ? Math.max(0, (input.endMs as number) - input.nowMs) : null;

  const noData = input.sessionsCollected <= 0 && input.playbacksCollected <= 0;
  const sampleSufficient = input.sessionsCollected >= PILOT_MIN_SESSIONS && input.playbacksCollected >= PILOT_MIN_PLAYBACKS;
  const status: PilotProgress['status'] = noData ? 'NO_DATA' : (sampleSufficient ? 'READY' : 'INSUFFICIENT_DATA');

  // Primary-metric progress = fraction toward the minimum session floor (0..1), null when no data.
  const primaryMetricProgress = noData ? null : Math.min(1, input.sessionsCollected / PILOT_MIN_SESSIONS);

  // Confidence: breadth of evidence, capped. No sample → null (honest "unknown"), never a fabricated number.
  const confidence = noData
    ? null
    : Math.round(Math.min(PILOT_CONFIDENCE_MAX, (Math.min(1, input.sessionsCollected / PROGRESS_CONFIDENCE_FULL_SESSIONS)) * PILOT_CONFIDENCE_MAX));

  const nextObservationMs = input.startMs == null ? null : (input.lastObservationMs ?? input.startMs) + OBSERVATION_INTERVAL_MS;

  return {
    status,
    elapsedMs, remainingMs,
    storesActive: input.storesActive, storesExcluded: input.storesExcluded, storesOffline: input.storesOffline,
    sessionsCollected: input.sessionsCollected, playbacksCollected: input.playbacksCollected,
    primaryMetricProgress,
    guardrailStatus: input.guardrailStatus,
    confidence,
    sampleSufficient,
    contamination: input.contamination,
    nextObservationMs,
  };
}
