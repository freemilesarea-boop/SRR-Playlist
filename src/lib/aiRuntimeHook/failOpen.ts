// AI-MUSIC-9 — Fail-open runtime wrapper (pure model of the gate chain + try/catch). Models the isolation the
// real hook would run under: feature flag → preview environment → deployment id → store allowlist → session →
// kill switch, then a short-timeout, no-retry body. ANY gate miss short-circuits, and ANY thrown error is
// dropped (summary only, never a raw stack) so the existing queue + existing player state are returned. Nothing
// ever throws up to the resolver/player. Deterministic.

import type { FailOpenReport, FailOpenResult } from './types';

export interface FailOpenInput {
  flagEnabled: boolean;
  isPreviewEnvironment: boolean;
  deploymentMatch: boolean;
  storeAllowed: boolean;
  sessionValid: boolean;
  isControlStore: boolean;
  killSwitch: boolean;
  bodyThrew: boolean;              // the modelled hook body raised
  bodyErrorSummary: string | null; // summary only (never a stack)
}

export function runFailOpen(i: FailOpenInput): FailOpenReport {
  const ok = (result: FailOpenResult, reason: string, errorSummary: string | null = null): FailOpenReport => ({
    result, existingQueuePreserved: true, existingPlaybackPreserved: true, errorSummary, threwToPlayer: false, reasons: [reason],
  });

  // Short-circuits (zero extra work) — existing queue/state always preserved.
  if (i.isControlStore) return ok('SHORT_CIRCUIT_CONTROL', 'Control Store — Hook 미실행');
  if (!i.flagEnabled) return ok('SHORT_CIRCUIT_DISABLED', 'Feature Flag OFF — Hook 미실행');
  if (!i.isPreviewEnvironment || !i.deploymentMatch || !i.storeAllowed || !i.sessionValid || i.killSwitch) {
    return ok('SHORT_CIRCUIT_DISABLED', 'Gate 미충족 — Hook 미실행 (기존 유지)');
  }
  // Body ran — any throw is dropped and we fail open to existing.
  if (i.bodyThrew) return ok('FAILED_OPEN', '오류 발생 — 기존 Queue/Player 유지 (throw 억제)', i.bodyErrorSummary ?? 'error');
  return ok('PASSED', 'Gate 통과 · 오류 없음 (모델)');
}
