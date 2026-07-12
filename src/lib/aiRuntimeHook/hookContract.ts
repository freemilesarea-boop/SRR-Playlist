// AI-MUSIC-9 — Runtime hook contract (PURE evaluator). Given a runtime input it decides what an isolated Preview
// hook WOULD do — in simulation only. It runs the full gate chain (flags → kill switch → control store → preview
// env → deployment → store allowlist → session/application caps → version/snapshot → boundary safety), composes
// the queue-only adapter at a safe boundary, and always returns the existing queue unless the decision is
// APPLIED_AT_BOUNDARY (in-model). Every result carries the safety envelope (actualPlayerControl:false, etc.) and
// realPlayerUntouched:true. It NEVER calls setQueue/setPlaying or any audio API. Deterministic.

import type { RuntimeHookInput, RuntimeHookResult, HookDecision, BoundaryStateKnown } from './types';
import { SAFETY_ENVELOPE } from './types';
import { SAFE_BOUNDARIES } from './thresholds';
import { computeQueueOnlyMutation } from './queueOnlyAdapter';

function existing(input: RuntimeHookInput, decision: HookDecision, reasons: string[], boundary: BoundaryStateKnown | null = null): RuntimeHookResult {
  return {
    ...SAFETY_ENVELOPE,
    scenarioName: input.scenarioName,
    decision,
    reasons,
    resultQueueTrackIds: input.existingQueueTrackIds,
    resultCurrentTrackId: input.currentTrackId,
    resultIndex: input.currentIndex,
    boundaryUsed: boundary,
    realPlayerUntouched: true,
  };
}

function isSafeBoundary(b: BoundaryStateKnown): boolean {
  return (SAFE_BOUNDARIES as readonly string[]).includes(b);
}

export function evaluateRuntimeHook(input: RuntimeHookInput): RuntimeHookResult {
  const f = input.featureFlags;

  // Gate chain (fail-closed to the existing queue at every step).
  if (!f.masterEnabled || !f.hookEnabled) return existing(input, 'FLAG_DISABLED', ['Master/Hook Flag OFF']);
  if (input.killSwitch) return existing(input, 'KILL_SWITCHED', ['Kill Switch ON']);
  if (input.isControlStore) return existing(input, 'CONTROL_PRESERVED', ['Control Store — 기존 유지, Hook 미실행']);
  if (!input.isPreviewEnvironment) return existing(input, 'STORE_NOT_ALLOWED', ['Preview 환경 아님']);
  if (input.currentDeploymentId !== input.previewDeploymentId) return existing(input, 'DEPLOYMENT_MISMATCH', ['Deployment ID 불일치']);
  if (input.store == null || input.store.storeId !== input.storeId) return existing(input, 'STORE_NOT_ALLOWED', ['Store 미허용 (allowlist 불일치)']);
  if (input.sessionCount > input.store.maxSessions) return existing(input, 'SESSION_LIMIT', ['Session 한도 초과 (max 1)']);
  if (input.appliedCount >= input.store.maxQueueApplications) return existing(input, 'SESSION_LIMIT', ['Application Cap 도달']);
  if (input.candidateVersion == null || input.candidateVersion !== input.store.approvedCandidateVersion) {
    return existing(input, 'VERSION_MISMATCH', ['Candidate Version 불일치']);
  }
  if (input.candidateSnapshotHash == null || input.candidateSnapshotHash !== input.store.approvedSnapshotHash) {
    return existing(input, 'SNAPSHOT_MISMATCH', ['Candidate Snapshot 불일치']);
  }

  // Boundary safety — a boundary that is unsafe or not observable at runtime never applies.
  if (input.boundaryState === 'UNKNOWN_NOT_OBSERVABLE' || !input.playbackState.observable) {
    return existing(input, 'UNSAFE_BOUNDARY', ['경계 상태 Runtime 관측 불가 — 적용 금지'], input.boundaryState);
  }
  if (input.crossfadeState === true || input.recoveryState === true || input.preloadState === true) {
    return existing(input, 'UNSAFE_BOUNDARY', ['Crossfade/Recovery/Preload 진행 중 — 적용 금지'], input.boundaryState);
  }
  if (!isSafeBoundary(input.boundaryState)) {
    return existing(input, 'WAITING_BOUNDARY', ['안전 경계 대기 중'], input.boundaryState);
  }

  // Safe boundary → compute the queue-only mutation (preserves playback).
  const mut = computeQueueOnlyMutation({
    existingQueueTrackIds: input.existingQueueTrackIds,
    candidateQueueTrackIds: input.candidateQueueTrackIds,
    currentTrackId: input.currentTrackId,
    currentIndex: input.currentIndex,
    playback: input.playbackState,
  });

  if (mut.result === 'NO_CHANGE') return existing(input, 'NO_ACTION', ['Candidate 가 기존과 동일 — 변경 없음'], input.boundaryState);
  if (mut.result === 'BLOCKED_EMPTY_CANDIDATE' || mut.result === 'BLOCKED_INVALID_INDEX' || mut.result === 'BLOCKED_NOT_OBSERVABLE') {
    return existing(input, 'FAIL_OPEN', [`Queue 변환 실패 (${mut.result}) — 기존 Queue 유지`], input.boundaryState);
  }

  // APPLIED_AT_BOUNDARY — in-model result only; the real store is never written.
  return {
    ...SAFETY_ENVELOPE,
    scenarioName: input.scenarioName,
    decision: 'APPLIED_AT_BOUNDARY',
    reasons: [`안전 경계(${input.boundaryState})에서 Queue-only 적용 (모델) — 재생 필드 보존`, ...mut.reasons],
    resultQueueTrackIds: mut.resultQueueTrackIds,
    resultCurrentTrackId: mut.resultCurrentTrackId,
    resultIndex: mut.resultIndex,
    boundaryUsed: input.boundaryState,
    realPlayerUntouched: true,
  };
}
