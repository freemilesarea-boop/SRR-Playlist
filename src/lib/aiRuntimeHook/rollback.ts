// AI-MUSIC-9 — Manual rollback at boundary. An operator requests rollback; it is validated and reserved for the
// next safe boundary — never applied automatically and never by cutting the current track mid-play. Requires an
// existing playlist, a rebuildable existing queue, the same session + deployment, a preserved current-track
// snapshot, and a safe boundary; the kill switch does not block a rollback (it *is* the safe restore path).
// Pure & deterministic.

import type { RollbackInput, RollbackReport, RollbackResult } from './types';

export function evaluateRollback(i: RollbackInput): RollbackReport {
  const out = (result: RollbackResult, reason: string): RollbackReport => ({ result, automatic: false, reasons: [reason] });

  if (!i.existingPlaylistId || !i.canRebuildExistingQueue) return out('TARGET_MISSING', 'Existing Playlist/Queue 재생성 불가 — Rollback Target 없음');
  if (!i.sameSession) return out('STALE_SESSION', 'Session 불일치 — Rollback 불가');
  if (!i.sameDeployment) return out('STALE_SESSION', 'Deployment 불일치 — Rollback 불가');
  if (!i.currentTrackSnapshotPresent || !i.currentTrackPreservable) return out('FAILED', '현재 Track Snapshot/보존 불가 — Rollback 실패');
  if (!i.safeBoundary) return out('UNSAFE_BOUNDARY', '안전 경계 아님 — 경계까지 대기 (ROLLBACK_RESERVED)');
  return out('ROLLED_BACK_AT_BOUNDARY', '안전 경계에서 기존 Resolver 결과로 복귀 (수동)');
}
