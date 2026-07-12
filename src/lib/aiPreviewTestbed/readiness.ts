// AI-MUSIC-11 — Testbed readiness certification. Only READY_FOR_SINGLE_STORE_CHANGE_REQUEST when EVERYTHING is
// in place (isolated preview DB + migration-apply-allowed + store + account + playlists + version/snapshot +
// rollback + allowlist + deployment binding + test window + operator + cleanup + boundary observability + flags
// off + kill switch on). If the preview DB, internal store, or candidate fixture is missing, the maximum is
// PARTIAL; a shared production DB caps at BLOCKED. No runtime hook is implemented. Pure & deterministic.

import type { TestbedReadinessInput, TestbedReadinessResult, TestbedReadinessStatus } from './types';

export function computeTestbedReadiness(i: TestbedReadinessInput): TestbedReadinessResult {
  const satisfied: string[] = [];
  const missing: string[] = [];
  const blockers: string[] = [];
  const check = (ok: boolean, label: string, isBlocker = false) => {
    if (ok) satisfied.push(label);
    else { missing.push(label); if (isBlocker) blockers.push(label); }
    return ok;
  };

  // Hard blockers first.
  check(i.previewDbIsolated, '격리된 Preview DB', true);
  check(i.migrationApplyAllowed, 'Migration 적용 허용(격리 DB)', true);
  check(i.killSwitchOn, 'Kill Switch ON', true);
  check(i.featureFlagsOff, 'Feature Flags OFF', true);

  // Provisioning items.
  const store = check(i.internalTestStoreCreated, '내부 Test Store 생성');
  check(i.testAccountCreated, 'Test Account 생성');
  check(i.existingPlaylistReady, 'Existing Playlist');
  const candidate = check(i.candidatePlaylistReady, 'Candidate Playlist');
  check(i.versionPinned, 'Version 고정');
  check(i.snapshotIntegrity, 'Snapshot 무결성');
  check(i.rollbackTargetReady, 'Rollback Target');
  check(i.allowlistReady, 'Allowlist');
  check(i.deploymentBound, 'Deployment Binding');
  check(i.testWindowPlanned, 'Test Window');
  check(i.operatorPlanned, 'Operator Plan');
  check(i.cleanupReady, 'Cleanup Plan');
  check(i.boundaryObservabilityReady, 'Boundary Observability');

  const nextAction = [
    '격리 Preview DB(별도 Test Project 또는 Supabase Branch) provisioning',
    '내부 Test Store / Test Account / Candidate Playlist Fixture 생성 (격리 DB)',
    'Preview Migration 0464~0470 적용 (격리 DB)',
    'AI-MUSIC-12 Single-store Hook Change Request 실행',
  ];
  const base = { satisfied, missing, blockers, nextAction, runtimeHookImplemented: false as const };

  let status: TestbedReadinessStatus;
  // Shared production DB (not isolated) → apply forbidden → BLOCKED.
  if (!i.previewDbIsolated || !i.migrationApplyAllowed) status = 'BLOCKED';
  else if (!i.killSwitchOn || !i.featureFlagsOff) status = 'BLOCKED';
  else if (!store || !candidate) status = 'PARTIAL';           // core fixtures missing
  else if (missing.length === 0) status = 'READY_FOR_SINGLE_STORE_CHANGE_REQUEST';
  else if (missing.length <= 3) status = 'READY_WITH_WARNINGS';
  else status = 'PARTIAL';

  return { ...base, status };
}
