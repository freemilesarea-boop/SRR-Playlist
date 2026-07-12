// AI-MUSIC-8 — Idempotency / stale protection. The audit confirmed the real store carries NO revision, source,
// session, or version on its queue and does last-writer-wins with no stale guard. This engine models the
// protection a safe adapter MUST add (in the pure harness only): reject duplicate, stale (older revision than
// the latest for its source), wrong-session, wrong-store, version-mismatch, and expired commands so a late
// async response can never overwrite a newer queue. Pure & deterministic.

import type { FreshnessInput, FreshnessResult, FreshnessStatus } from './types';

export function evaluateFreshness(i: FreshnessInput): FreshnessResult {
  const c = i.command;
  const status: FreshnessStatus = 'CURRENT';
  const reasons: string[] = [];

  if (c.storeId !== i.currentStoreId) return { status: 'WRONG_STORE', reasons: ['다른 Store Command'] };
  if (c.playerSessionId !== i.currentSessionId) return { status: 'WRONG_SESSION', reasons: ['다른/이전 Session Command'] };
  if (c.expiresAt != null && c.expiresAt <= i.nowMs) return { status: 'EXPIRED', reasons: ['Command 만료'] };

  // Duplicate: same command id, or the same resulting queue hash already applied.
  if (i.latestAppliedCommandId != null && c.commandId === i.latestAppliedCommandId) return { status: 'DUPLICATE', reasons: ['동일 Command 재수신'] };
  if (i.latestAppliedQueueHash != null && c.queueSnapshotHash != null && c.queueSnapshotHash === i.latestAppliedQueueHash) {
    return { status: 'DUPLICATE', reasons: ['동일 Queue 재요청 (hash 일치)'] };
  }

  // Stale: an older revision than the latest seen for this source (a late/out-of-order response).
  if (i.latestRevisionForSource != null && c.requestRevision < i.latestRevisionForSource) {
    return { status: 'STALE', reasons: [`오래된 응답 (rev ${c.requestRevision} < ${i.latestRevisionForSource})`] };
  }

  // Version pin: the candidate playlist version must match the expected pin.
  if (i.expectedPlaylistVersion != null && c.playlistVersion !== i.expectedPlaylistVersion) {
    return { status: 'VERSION_MISMATCH', reasons: [`Version 불일치 (기대 ${i.expectedPlaylistVersion} ≠ ${c.playlistVersion})`] };
  }

  reasons.push('최신 Command');
  return { status, reasons };
}

export function isFresh(status: FreshnessStatus): boolean { return status === 'CURRENT'; }
