// AI-MUSIC-7 — Canary Resolver. After the real resolver has finalized a playlist, this decides whether an
// allowlisted preview treatment store's ACTIVE canary may return the pinned candidate playlist id instead —
// but ONLY when EVERY gate holds. It never mutates playback (actualPlaybackUnchanged). Control stores ALWAYS
// get the existing result. Every failure fails OPEN to the existing playlist. A returned USE_CANARY_CANDIDATE
// is a *decision only*; actual queue application (setQueue) is DEFERRED and not performed by this phase.

import { CANARY_LIVE_STATES } from './thresholds';
import type { CanaryResolveInput, CanaryResolveResult, CanaryResolveOutcome } from './types';

function existing(input: CanaryResolveInput, outcome: CanaryResolveOutcome, reason: string, failOpen = true): CanaryResolveResult {
  return { outcome, selectedPlaylistId: input.existingPlaylistId, usedCandidate: false, failOpen, reason, actualPlaybackUnchanged: true };
}

export function resolveCanary(input: CanaryResolveInput): CanaryResolveResult {
  // Shadow/adapter error → fail open (runtime-safe).
  if (input.shadowError) return existing(input, 'FAIL_OPEN', 'Canary Resolver 오류 → 기존 결과 유지');

  // Environment / flags / kill switch — hardest gates first.
  if (!input.envAllowed) return existing(input, 'ENVIRONMENT_BLOCKED', 'Preview Environment/Deployment 미충족 → 기존 결과');
  if (!input.masterEnabled || !input.canaryFlagEnabled) return existing(input, 'FLAG_DISABLED', 'Canary Flag OFF → 기존 결과');
  if (input.killSwitch) return existing(input, 'KILL_SWITCHED', 'Kill Switch ON → 기존 결과');

  // Control store → ALWAYS existing (control preserved). Never overlay a candidate.
  if (!input.isTreatment) return existing(input, 'CONTROL_PRESERVED', 'Control Store → 기존 결과 (Control 보존)', false);

  // Allowlist / session / approval.
  if (input.allowlistStatus !== 'ALLOWED') return existing(input, 'STORE_NOT_ALLOWED', `Store Allowlist 미충족 (${input.allowlistStatus}) → 기존 결과`);
  if (!CANARY_LIVE_STATES.includes(input.sessionState)) return existing(input, 'SESSION_INACTIVE', `Canary Session 비활성 (${input.sessionState}) → 기존 결과`);
  if (!input.approvalValid) return existing(input, 'STORE_NOT_ALLOWED', 'Approval 무효 → 기존 결과');

  // Expiry / conflict / rollback / store / incident.
  if (input.expiry != null && input.expiry <= input.nowMs) return existing(input, 'EXPIRED', 'Canary 만료 → 기존 결과');
  if (input.conflict) return existing(input, 'CONFLICT', 'Conflict → 기존 결과');
  if (!input.rollbackTargetExists) return existing(input, 'CANDIDATE_BLOCKED', 'Rollback Target 없음 → 기존 결과');
  if (!input.storeOnline) return existing(input, 'CANDIDATE_BLOCKED', 'Store Offline → 기존 결과');
  if (input.criticalIncident) return existing(input, 'CANDIDATE_BLOCKED', 'Critical Incident → 기존 결과');

  // Candidate presence + version pin + snapshot pin + queue validity.
  if (!input.candidatePlaylistId) return existing(input, 'CANDIDATE_BLOCKED', 'Candidate Playlist 없음 → 기존 결과');
  if (input.expectedCandidateVersion != null && input.candidateVersion !== input.expectedCandidateVersion) {
    return existing(input, 'VERSION_MISMATCH', `Version Pin 불일치 (기대 ${input.expectedCandidateVersion} ≠ ${input.candidateVersion}) → 기존 결과`);
  }
  if (input.expectedSnapshotHash != null && input.candidateSnapshotHash !== input.expectedSnapshotHash) {
    return existing(input, 'SNAPSHOT_MISMATCH', 'Candidate Snapshot Hash 불일치 → 기존 결과');
  }
  if (input.candidateQueueStatus !== 'READY' && input.candidateQueueStatus !== 'READY_WITH_WARNINGS') {
    return existing(input, 'CANDIDATE_BLOCKED', `Candidate Queue 미준비 (${input.candidateQueueStatus}) → 기존 결과`);
  }

  // All gates pass → the canary WOULD resolve to the pinned candidate (decision only; application DEFERRED).
  return {
    outcome: 'USE_CANARY_CANDIDATE',
    selectedPlaylistId: input.candidatePlaylistId,
    usedCandidate: true,
    failOpen: false,
    reason: 'Preview Canary Candidate 결정 (allowlist·approval·version·snapshot·queue 충족) — 실제 Queue 적용은 DEFERRED',
    actualPlaybackUnchanged: true,
  };
}
