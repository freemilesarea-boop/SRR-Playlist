// AI-MUSIC-5 — Approval Gate. Evaluates whether an AI-MUSIC-4 plan may be manually activated. Storing an
// approval NEVER activates the pilot — a separate Manual Activate request is always required. Rule-based,
// deterministic (caller supplies the clock). Missing streaming-guardrail source → NEEDS_INVESTIGATION warning
// (honest NOT_AVAILABLE), not a fabricated pass.

import { REQUIRED_PLAN_STATUS } from './thresholds';
import type { ApprovalInput, Approval, ApprovalStatus } from './types';

export function computeApproval(input: ApprovalInput): Approval {
  const blocking: string[] = [];
  const warnings: string[] = [];
  const base = { requiresApproval: true as const, automated: false as const, executed: false as const };

  // hard prerequisites
  if (!input.planExists) blocking.push('Experiment Plan 없음');
  if (input.planStatus !== REQUIRED_PLAN_STATUS) blocking.push(`Plan 상태가 ${REQUIRED_PLAN_STATUS} 아님 (${input.planStatus ?? 'null'})`);
  if (!input.candidatePlaylistId) blocking.push('Candidate Playlist 없음');
  if (input.candidateVersion == null) blocking.push('Candidate Version 고정 안됨');
  if (!input.groupsConfirmed) blocking.push('Control/Treatment 그룹 미확정');
  if (input.duplicateExperiment) blocking.push('중복 Experiment 존재');
  if (!input.rollbackSnapshotExists) blocking.push('Rollback 대상 Playlist Snapshot 없음');
  if (!input.approver) blocking.push('승인자 없음');
  if (!input.reason || input.reason.trim().length < 3) blocking.push('승인 이유 없음');
  if (input.scheduledStart == null || input.scheduledEnd == null) blocking.push('시작/종료 시간 미지정');
  if (input.expiry == null) blocking.push('Expiration 없음');

  // safety re-checks
  if (input.criticalIncident) blocking.push('Critical Incident 존재');
  if (input.storeOffline) blocking.push('대상 Store Offline');
  if (!input.eligibilityRevalidated) blocking.push('Store Eligibility 재검증 안됨');

  // expiry check
  const expired = input.expiry != null && input.expiry <= input.nowMs;

  // honest NOT_AVAILABLE → needs investigation (not a block, not a fake pass)
  if (!input.streamingGuardrailAvailable) warnings.push('Streaming Guardrail 데이터 NOT_AVAILABLE — 활성화 전 조사 필요');

  let status: ApprovalStatus;
  if (!input.planExists || input.candidateVersion == null || input.scheduledStart == null) status = 'INSUFFICIENT_DATA';
  else if (expired) status = 'EXPIRED';
  else if (blocking.length > 0) status = 'REJECTED';
  else if (warnings.length > 0) status = 'NEEDS_INVESTIGATION';
  else status = 'APPROVED';

  return { ...base, status, blockingReasons: blocking, warnings };
}
