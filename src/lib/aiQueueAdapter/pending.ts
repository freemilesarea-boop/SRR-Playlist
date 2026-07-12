// AI-MUSIC-8 — Pending Queue adapter. A candidate queue is held as a PENDING entry that is NEVER written to the
// real player store — it only reaches APPLIED inside the deterministic harness. Models the lifecycle
// (PENDING→VALIDATED→WAITING_BOUNDARY→APPLIED / SUPERSEDED / EXPIRED / REJECTED / CANCELLED). Pure.

import type { QueueCommand, PendingQueue, PendingStatus } from './types';

const ALLOWED: Record<PendingStatus, PendingStatus[]> = {
  PENDING: ['VALIDATED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'SUPERSEDED'],
  VALIDATED: ['WAITING_BOUNDARY', 'REJECTED', 'EXPIRED', 'CANCELLED', 'SUPERSEDED'],
  WAITING_BOUNDARY: ['APPLIED', 'EXPIRED', 'CANCELLED', 'SUPERSEDED', 'REJECTED'],
  APPLIED: [],            // terminal (harness-only)
  SUPERSEDED: [],
  EXPIRED: [],
  REJECTED: [],
  CANCELLED: [],
};

export function createPending(command: QueueCommand, requestedBoundary: string, createdAt: number, expiry: number | null): PendingQueue {
  return {
    command, pendingQueueHash: command.queueSnapshotHash, requestedBoundary, createdAt, expiry,
    status: 'PENDING', rejectionReason: null, supersededBy: null, appliedAt: null, appliedBoundary: null,
  };
}

export function canPendingTransition(from: PendingStatus, to: PendingStatus): boolean {
  return (ALLOWED[from] ?? []).includes(to);
}

export function transitionPending(p: PendingQueue, to: PendingStatus, opts?: { reason?: string; supersededBy?: string; appliedBoundary?: string; nowMs?: number }): PendingQueue {
  if (!canPendingTransition(p.status, to)) return { ...p, status: 'REJECTED', rejectionReason: `금지 전이 ${p.status}→${to}` };
  return {
    ...p, status: to,
    rejectionReason: to === 'REJECTED' ? (opts?.reason ?? p.rejectionReason) : p.rejectionReason,
    supersededBy: to === 'SUPERSEDED' ? (opts?.supersededBy ?? p.supersededBy) : p.supersededBy,
    appliedAt: to === 'APPLIED' ? (opts?.nowMs ?? p.appliedAt) : p.appliedAt,
    appliedBoundary: to === 'APPLIED' ? (opts?.appliedBoundary ?? p.appliedBoundary) : p.appliedBoundary,
  };
}
