// AI-MUSIC-7 — Canary approval gate. Evaluates whether an approved pilot candidate may be manually ARMED for a
// preview runtime canary. Storing an approval NEVER touches the runtime queue (executed:false) — Arm and
// Activate are separate operator actions. Environment must be ENFORCED and the store must be an allowlisted
// internal test store; anything else blocks. Rule-based, deterministic (caller supplies the clock).

import { MIN_SHADOW_CERT } from './thresholds';
import type { ApprovalInput, Approval, ApprovalStatus } from './types';

export function computeCanaryApproval(input: ApprovalInput): Approval {
  const blocking: string[] = [];
  const warnings: string[] = [];
  const base = { requiresApproval: true as const, automated: false as const, executed: false as const };

  // environment / store scope come first (hard structural gates)
  const envBlocked = input.envGate.status !== 'ENFORCED';
  const storeBlocked = input.allowlist.status !== 'ALLOWED' || !input.storeIsInternalTest;

  // prerequisites
  if (!input.experimentApproved) blocking.push('Experiment Plan 미승인');
  if (!input.pilotRunApproved) blocking.push('Pilot Run 미승인');
  if (!input.isTreatment) blocking.push('Treatment Assignment 아님 (Control 은 Canary 대상 아님)');
  if (!input.candidatePlaylistExists) blocking.push('Candidate Playlist 없음');
  if (!input.candidateSnapshotExists) blocking.push('Candidate Track Snapshot 없음');
  if (!input.existingPlaylistSnapshotExists) blocking.push('Existing Playlist Snapshot 없음');
  if (!input.existingQueueSnapshotAvailable) blocking.push('Existing Queue Snapshot 불가');
  if (!input.rollbackTargetExists) blocking.push('Rollback Target 없음');
  if (input.controlDivergences > 0) blocking.push('Control Divergence 존재 (0 이어야 함)');
  if (!input.failOpenVerified) blocking.push('Fail-open 검증 미통과');
  if (input.criticalResolverError) blocking.push('Critical Resolver Error 존재');
  if (input.criticalStreamingIncident) blocking.push('Critical Streaming Incident 존재');
  if (input.scheduledStart == null || input.scheduledEnd == null) blocking.push('시작/종료 시간 미지정');
  if (input.expiry == null) blocking.push('Expiry 없음');
  if (!input.approver) blocking.push('승인자 없음');
  if (!input.reason || input.reason.trim().length < 3) blocking.push('승인 이유 없음');

  // shadow certification must be at least READY_WITH_WARNINGS
  if (!MIN_SHADOW_CERT.includes(input.shadowCertificationStatus)) {
    blocking.push(`Shadow Certification 부족 (${input.shadowCertificationStatus}) — 최소 READY_WITH_WARNINGS`);
  }

  // version pin (missing → INSUFFICIENT_DATA precedence handled below)
  if (!input.candidateVersionMatches) blocking.push('Candidate Version 불일치');

  const expired = input.expiry != null && input.expiry <= input.nowMs;

  let status: ApprovalStatus;
  if (envBlocked) status = 'ENVIRONMENT_BLOCKED';
  else if (storeBlocked) status = 'STORE_NOT_ALLOWED';
  else if (!input.candidatePlaylistExists || input.scheduledStart == null) status = 'INSUFFICIENT_DATA';
  else if (expired) status = 'EXPIRED';
  else if (!input.candidateVersionMatches) status = 'VERSION_MISMATCH';
  else if (blocking.length > 0) status = 'REJECTED';
  else if (warnings.length > 0) status = 'NEEDS_INVESTIGATION';
  else status = 'APPROVED';

  return { ...base, status, blockingReasons: blocking, warnings };
}
