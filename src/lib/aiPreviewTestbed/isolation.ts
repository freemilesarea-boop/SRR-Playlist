// AI-MUSIC-11 — Testbed isolation verification. Only ISOLATED unblocks the single-store hook change request:
// the preview DB/auth/storage must differ from production, store/playlist ids must not collide, the testbed must
// be reachable only from the preview deployment, the allowlist must be a single store with a session cap of 1, a
// pinned candidate, an expiry, and a cleanup path. Pure & deterministic.

import type { IsolationInput, IsolationResult, IsolationStatus } from './types';

export function verifyIsolation(i: IsolationInput): IsolationResult {
  const blockers: string[] = [];
  const need = (ok: boolean, label: string) => { if (!ok) blockers.push(label); };

  need(i.dbProjectRefDiffersFromProd, 'Preview DB Project Ref 가 Production 과 동일');
  need(i.authSeparate, 'Auth 미분리');
  need(i.storageSeparate, 'Storage 미분리');
  need(i.storeIdCollisionFree, 'Store ID 충돌');
  need(i.playlistIdCollisionFree, 'Playlist ID 충돌');
  need(i.reachableOnlyFromPreviewDeployment, 'Preview 외 접근 가능');
  need(i.allowlistSingleStore, 'Allowlist 단일 Store 아님');
  need(i.sessionCapOne, 'Session Cap 1 아님');
  need(i.candidatePinned, 'Candidate 미고정');
  need(i.expiryPresent, 'Expiry 없음');
  need(i.cleanupPossible, 'Cleanup 불가');

  let status: IsolationStatus;
  if (!i.dbProjectRefDiffersFromProd) status = 'UNSAFE';                 // sharing prod DB → never isolated
  else if (blockers.length === 0) status = 'ISOLATED';
  else if (blockers.length <= 3) status = 'PARTIAL';
  else status = 'NOT_AVAILABLE';

  return { status, blockers };
}
