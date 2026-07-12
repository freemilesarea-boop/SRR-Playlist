// AI-MUSIC-6 — Shadow Resolver. Computes what a store WOULD resolve to under a pilot override, IN PARALLEL,
// taking the (already-finalized, authoritative) existing resolution as the base. It does NOT re-resolve the
// base path (schedule / franchise / fallback) — the real resolver already decided that; the shadow only
// decides whether a valid treatment override would overlay it. Every failure fails OPEN to the existing
// result. The real playlist / queue / playback are never changed by this function.
//
// Priority (per the phase spec, reconciled with the audited code): a valid treatment override is the only
// thing that can differ from the existing result; for every other case the shadow returns the existing result.
// (The base path has no playlist-content version — only the pilot candidate carries an approved version pin.)

import { SHADOW_CONFIDENCE_MAX } from './thresholds';
import type { ShadowResolverInput, ShadowResolution, ReasonCode } from './types';

function fromExisting(input: ShadowResolverInput, reasonCode: ReasonCode, reason: string, extra?: Partial<ShadowResolution>): ShadowResolution {
  const e = input.existing;
  return {
    storeId: input.storeId,
    selectedPlaylistId: e.selectedPlaylistId,
    selectionSource: e.selectionSource,
    version: e.version,
    decisionReason: reason,
    reasonCode,
    fallbackUsed: true,               // shadow fell open to the existing result
    versionValid: true,
    candidateAvailable: false,
    assignmentValid: reasonCode === 'CONTROL_PRESERVED' || reasonCode === 'EXISTING_RESULT',
    overrideValid: false,
    confidence: null,
    status: 'READY',
    ...extra,
  };
}

export function resolveShadow(input: ShadowResolverInput): ShadowResolution {
  // Any shadow-path error → fail open to existing (runtime-safe). Recorded as RESOLVER_ERROR.
  if (input.shadowError) {
    return fromExisting(input, 'RESOLVER_ERROR', 'Shadow Resolver 오류 → 기존 결과 유지', { status: 'NOT_AVAILABLE', fallbackUsed: true });
  }

  // No pilot assignment for this store → existing result stands.
  if (!input.assignmentId || input.assignmentGroup == null) {
    return fromExisting(input, 'NO_ASSIGNMENT', 'Pilot Assignment 없음 → 기존 결과');
  }

  // Control store → ALWAYS the existing result (control preserved). Never overlay an override.
  if (input.assignmentGroup === 'control') {
    return fromExisting(input, 'CONTROL_PRESERVED', 'Control Store → 기존 결과 (Control 보존)', { assignmentValid: true });
  }

  // Override consideration disabled → existing result.
  if (!input.overrideFlagEnabled) {
    return fromExisting(input, 'OVERRIDE_FLAG_OFF', 'Override 고려 Flag OFF → 기존 결과');
  }

  // Conflict: store bound to another active pilot → existing result.
  if (input.conflictingActivePilot) {
    return fromExisting(input, 'ASSIGNMENT_CONFLICT', '다른 활성 Pilot 충돌 → 기존 결과', { assignmentValid: false });
  }

  // Override not live (paused/stopped/rolled-back/expired/absent) → existing result.
  if (input.overrideStatus !== 'ACTIVE') {
    const code: ReasonCode = input.overrideStatus === 'EXPIRED' ? 'OVERRIDE_EXPIRED' : 'OVERRIDE_NOT_ACTIVE';
    return fromExisting(input, code, `Override 상태 ${input.overrideStatus ?? 'none'} → 기존 결과`);
  }
  // Expiry / window checks.
  if (input.expiry != null && input.expiry <= input.resolvedAt) {
    return fromExisting(input, 'OVERRIDE_EXPIRED', 'Override 만료 → 기존 결과');
  }
  if (input.overrideStart != null && input.overrideStart > input.resolvedAt) {
    return fromExisting(input, 'OVERRIDE_NOT_ACTIVE', 'Override 시작 전 → 기존 결과');
  }
  if (input.overrideEnd != null && input.overrideEnd <= input.resolvedAt) {
    return fromExisting(input, 'OVERRIDE_NOT_ACTIVE', 'Override 종료 → 기존 결과');
  }

  // Candidate missing → existing result (fail open).
  if (!input.candidatePlaylistId) {
    return fromExisting(input, 'CANDIDATE_MISSING', 'Candidate Playlist 없음 → 기존 결과');
  }

  // Version pin: the live override's candidate version must equal the approved pin.
  if (input.expectedCandidateVersion != null && input.candidateVersion !== input.expectedCandidateVersion) {
    return fromExisting(input, 'VERSION_MISMATCH',
      `Version Pin 불일치 (기대 ${input.expectedCandidateVersion} ≠ ${input.candidateVersion}) → 기존 결과`);
  }

  // All checks pass → the shadow WOULD resolve to the pinned candidate (preview only, never applied).
  return {
    storeId: input.storeId,
    selectedPlaylistId: input.candidatePlaylistId,
    selectionSource: 'PILOT_OVERRIDE',
    version: input.candidateVersion,
    decisionReason: 'Treatment Override 적용 (version-pinned, preview only) — 실제 재생 미변경',
    reasonCode: 'OVERRIDE_APPLIED',
    fallbackUsed: false,
    versionValid: true,
    candidateAvailable: true,
    assignmentValid: true,
    overrideValid: true,
    confidence: SHADOW_CONFIDENCE_MAX,
    status: 'READY',
  };
}
