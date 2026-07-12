// AI-MUSIC-10 — Boundary revision / stale protection. Every observer event is checked against the current
// session + last revision + last timestamp so an out-of-order, duplicate, stale, or wrong-session event is
// ignored rather than regressing the snapshot. The observer only RECORDS these outcomes; it never blocks the
// player. Pure & deterministic (no clock — nowMs passed in).

import type { FreshnessInput, FreshnessResult, FreshnessStatus } from './types';

export function evaluateFreshness(i: FreshnessInput): FreshnessResult {
  const mk = (status: FreshnessStatus, reason: string): FreshnessResult => ({ status, reasons: [reason] });

  if (i.incomingSessionId == null) return mk('INVALID', 'Session 없음');
  if (i.currentSessionId != null && i.incomingSessionId !== i.currentSessionId) return mk('WRONG_SESSION', '다른 Session Event');
  if (i.isDuplicatePayload && i.incomingRevision === i.lastRevision) return mk('DUPLICATE', '동일 Snapshot 재수신');
  if (i.incomingRevision < i.lastRevision) return mk('STALE', `오래된 Revision (${i.incomingRevision} < ${i.lastRevision})`);
  if (i.incomingAtMs < i.lastAtMs) return mk('OUT_OF_ORDER', 'Timestamp 역전');
  return mk('CURRENT', '최신 Event');
}

export function isFreshBoundary(status: FreshnessStatus): boolean { return status === 'CURRENT'; }
