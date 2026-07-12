// AI-MUSIC-11 — Internal Preview Testbed unit tests. Pure & deterministic. These exercise the provisioning
// tooling ONLY — no DB apply, no fixture creation, no runtime. They assert: production project ref is rejected
// everywhere (env audit, seeder, cleanup); shared production DB blocks migration apply and caps readiness at
// BLOCKED; fixture contracts reject customer/enterprise/franchise/production; version/snapshot pinning; single-
// store allowlist; deployment binding; test window; isolation; readiness capping; and that no runtime hook is
// implemented.
import { describe, it, expect } from 'vitest';
import {
  auditEnvironment, isProductionProjectRef, recommendDbStrategy, validateMigrationPlan, AI_MUSIC_MIGRATIONS,
  computeSnapshotHash, snapshotMatches, validateTestStore, validateTestAccount, validateExistingPlaylist,
  validateCandidatePlaylist, validateCandidateVersionSnapshot, validateRollbackTarget, validateAllowlist,
  evaluateDeploymentBinding, validateTestWindow, guardSeeder, guardCleanup, verifyIsolation,
  computeTestbedReadiness, PRODUCTION_PROJECT_REF,
  type InternalTestStore, type InternalTestAccount, type PlaylistFixture, type CandidateVersionSnapshot,
  type PreviewAllowlistFixture, type TestbedReadinessInput,
} from './index';

const PROD = PRODUCTION_PROJECT_REF;
const NOW = 1_700_000_000_000;

describe('environment audit', () => {
  const base = { productionProjectRef: PROD, previewSupabaseUrl: null, productionSupabaseUrl: null, supabaseBranchingAvailable: false, localSupabaseAvailable: false, previewEnvVarsScopedSeparately: false, serverSideEnvVerification: false };
  it('2. shared production ref → SHARED_PRODUCTION_DB, apply forbidden', () => {
    const r = auditEnvironment({ ...base, previewProjectRef: PROD });
    expect(r.isolation).toBe('SHARED_PRODUCTION_DB');
    expect(r.migrationApplyAllowed).toBe(false);
  });
  it('1./3. no preview backend + no local → NOT_AVAILABLE', () => {
    expect(auditEnvironment({ ...base, previewProjectRef: null }).isolation).toBe('NOT_AVAILABLE');
  });
  it('local only → apply allowed (local)', () => {
    expect(auditEnvironment({ ...base, previewProjectRef: null, localSupabaseAvailable: true }).isolation).toBe('LOCAL_ONLY');
  });
  it('distinct preview ref + scoped + server verify → ISOLATED_PREVIEW_DB', () => {
    const r = auditEnvironment({ ...base, previewProjectRef: 'preview-xyz', previewEnvVarsScopedSeparately: true, serverSideEnvVerification: true });
    expect(r.isolation).toBe('ISOLATED_PREVIEW_DB');
    expect(r.migrationApplyAllowed).toBe(true);
  });
  it('isProductionProjectRef guard', () => {
    expect(isProductionProjectRef(PROD, PROD)).toBe(true);
    expect(isProductionProjectRef('other', PROD)).toBe(false);
    expect(isProductionProjectRef(null, PROD)).toBe(false);
  });
});

describe('db strategy', () => {
  it('4. shared prod → recommend isolated project, D blocked', () => {
    const r = recommendDbStrategy({ isolation: 'SHARED_PRODUCTION_DB', supabaseBranchingAvailable: false, localSupabaseAvailable: false });
    expect(r.status).toBe('RECOMMENDED');
    expect(r.option).toBe('B_SEPARATE_TEST_PROJECT');
  });
  it('branching available → recommend A', () => {
    expect(recommendDbStrategy({ isolation: 'SHARED_PRODUCTION_DB', supabaseBranchingAvailable: true, localSupabaseAvailable: false }).option).toBe('A_SUPABASE_BRANCH');
  });
});

describe('migration plan', () => {
  it('29./30. valid order + deps but apply blocked when not isolated', () => {
    const r = validateMigrationPlan({ migrations: AI_MUSIC_MIGRATIONS, migrationApplyAllowed: false });
    expect(r.status).toBe('BLOCKED');
    expect(r.applied).toBe(false);
    expect(r.missingDependencies).toEqual([]);
  });
  it('apply-allowed → APPLY_NOT_RUN (validation only)', () => {
    expect(validateMigrationPlan({ migrations: AI_MUSIC_MIGRATIONS, migrationApplyAllowed: true }).status).toBe('APPLY_NOT_RUN');
  });
  it('missing dependency detected', () => {
    const r = validateMigrationPlan({ migrations: AI_MUSIC_MIGRATIONS.filter((m) => m.id !== '0464'), migrationApplyAllowed: true });
    expect(r.status).toBe('DEPENDENCY_MISSING');
  });
});

describe('snapshot hash', () => {
  it('deterministic + order-sensitive', () => {
    const a = computeSnapshotHash(['t1', 't2', 't3'], 3);
    expect(computeSnapshotHash(['t1', 't2', 't3'], 3)).toBe(a);
    expect(computeSnapshotHash(['t3', 't2', 't1'], 3)).not.toBe(a);
    expect(snapshotMatches(['t1', 't2', 't3'], 3, a)).toBe(true);
  });
});

function store(o: Partial<InternalTestStore> = {}): InternalTestStore {
  return { storeId: 's1', storeName: 'INTERNAL_AI_CANARY_STORE_01', environment: 'preview', testOnly: true, customerStore: false, enterpriseStore: false, franchiseStore: false, createdBy: 'op', createdAtMs: NOW - 1, expiresAtMs: NOW + 60_000, cleanupRequired: true, purpose: 'proof', testWindow: null, allowedDeploymentId: 'dpl-1', ...o };
}
describe('test store fixture', () => {
  it('5. internal store valid', () => { expect(validateTestStore(store(), NOW).validity).toBe('VALID'); });
  it('6. customer store rejected', () => { expect(validateTestStore(store({ customerStore: true }), NOW).validity).toBe('CUSTOMER_STORE'); });
  it('7. enterprise rejected', () => { expect(validateTestStore(store({ enterpriseStore: true }), NOW).validity).toBe('ENTERPRISE_STORE'); });
  it('8. franchise rejected', () => { expect(validateTestStore(store({ franchiseStore: true }), NOW).validity).toBe('FRANCHISE_STORE'); });
  it('real name rejected', () => { expect(validateTestStore(store({ storeName: 'Starbucks Gangnam' }), NOW).validity).toBe('REAL_NAME'); });
  it('expired rejected', () => { expect(validateTestStore(store({ expiresAtMs: NOW - 1 }), NOW).validity).toBe('EXPIRED'); });
});

function acct(o: Partial<InternalTestAccount> = {}): InternalTestAccount {
  return { email: 'ai+canary@example.test', role: 'store_player', purpose: 'proof', createdBy: 'op', expiresAtMs: NOW + 60_000, testOnly: true, productionAccess: false, ...o };
}
describe('test account fixture', () => {
  it('9. valid test alias', () => { expect(validateTestAccount(acct(), NOW).validity).toBe('VALID'); });
  it('10. production access rejected', () => { expect(validateTestAccount(acct({ productionAccess: true }), NOW).validity).toBe('PRODUCTION_ACCOUNT'); });
  it('real email (no alias) rejected', () => { expect(validateTestAccount(acct({ email: 'john.doe@gmail.com' }), NOW).validity).toBe('REAL_EMAIL'); });
});

function pl(o: Partial<PlaylistFixture> = {}): PlaylistFixture {
  return { playlistId: 'pl-e', version: 1, trackIds: ['test-1', 'test-2', 'test-3', 'test-4', 'test-5'], trackCount: 5, snapshotHash: 'h', createdAtMs: NOW, testOnly: true, ...o };
}
describe('playlist fixtures', () => {
  it('11. existing valid', () => { expect(validateExistingPlaylist(pl()).validity).toBe('VALID'); });
  it('12. candidate valid (shares tracks with existing)', () => {
    const existing = pl();
    const candidate = pl({ playlistId: 'pl-c', trackIds: ['test-1', 'test-2', 'test-9', 'test-8', 'test-7'] });
    expect(validateCandidatePlaylist(candidate, existing).validity).toBe('VALID');
  });
  it('13. empty candidate rejected', () => { expect(validateCandidatePlaylist(pl({ trackIds: [], trackCount: 0 }), pl()).validity).toBe('EMPTY_CANDIDATE'); });
  it('too few tracks rejected', () => { expect(validateExistingPlaylist(pl({ trackIds: ['test-1'], trackCount: 1 })).validity).toBe('TOO_FEW_TRACKS'); });
});

describe('candidate version/snapshot', () => {
  const ids = ['test-1', 'test-2', 'test-9', 'test-8', 'test-7'];
  const good: CandidateVersionSnapshot = { candidatePlaylistId: 'pl-c', candidateVersion: 3, candidateTrackIds: ids, candidateSnapshotHash: computeSnapshotHash(ids, 3), generatedAtMs: NOW, approvedBy: 'op', immutable: true };
  it('valid pinned snapshot', () => { expect(validateCandidateVersionSnapshot(good).validity).toBe('VALID'); });
  it('15. snapshot mismatch rejected', () => { expect(validateCandidateVersionSnapshot({ ...good, candidateSnapshotHash: 'zzzz' }).validity).toBe('SNAPSHOT_MISMATCH'); });
  it('16. rollback target missing', () => { expect(validateRollbackTarget(null).validity).toBe('NO_ROLLBACK_TARGET'); });
});

function allow(o: Partial<PreviewAllowlistFixture> = {}): PreviewAllowlistFixture {
  return { storeId: 's1', environment: 'preview', deploymentId: 'dpl-1', candidatePlaylistId: 'pl-c', candidateVersion: 3, candidateSnapshotHash: 'h', maxSessions: 1, maxQueueApplications: 1, approvedBy: 'op', approvedAtMs: NOW, expiresAtMs: NOW + 60_000, enabled: false, reason: 'proof', ...o };
}
describe('allowlist fixture', () => {
  it('17. disabled allowlist is valid this phase', () => { expect(validateAllowlist(allow(), NOW).validity).toBe('VALID'); });
  it('18. expired rejected', () => { expect(validateAllowlist(allow({ expiresAtMs: NOW - 1 }), NOW).validity).toBe('EXPIRED'); });
  it('20. enabled=true rejected this phase', () => { expect(validateAllowlist(allow({ enabled: true }), NOW).validity).toBe('INSUFFICIENT_DATA'); });
});

describe('deployment binding', () => {
  const base = { currentDeploymentId: 'dpl-1', allowedDeploymentId: 'dpl-1', stableAliasAvailable: false, runtimeDeploymentIdReadable: true };
  it('21. match → BOUND', () => { expect(evaluateDeploymentBinding(base).status).toBe('BOUND'); });
  it('22. mismatch → PARTIAL', () => { expect(evaluateDeploymentBinding({ ...base, currentDeploymentId: 'dpl-2' }).status).toBe('PARTIAL'); });
  it('missing → NOT_AVAILABLE', () => { expect(evaluateDeploymentBinding({ ...base, allowedDeploymentId: null }).status).toBe('NOT_AVAILABLE'); });
});

describe('test window', () => {
  const full = { testStartMs: NOW, testEndMs: NOW + 3600_000, operator: 'op', reviewer: 'rev', rollbackOperator: 'rb', incidentContact: 'ic', maxDurationMs: 3600_000, maxSessions: 1, maxApplications: 1, stopConditions: ['Double Playback'], rollbackConditions: ['Media Error'] };
  it('planned when complete', () => { expect(validateTestWindow(full).status).toBe('PLANNED'); });
  it('23./24. draft when empty', () => { expect(validateTestWindow({ ...full, testStartMs: null, testEndMs: null, operator: null, reviewer: null, rollbackOperator: null }).status).toBe('DRAFT'); });
});

describe('seeder guard', () => {
  const base = { productionProjectRef: PROD, environment: 'preview', confirmPreview: true, dryRun: false };
  it('28. production ref rejected (even dry-run)', () => { expect(guardSeeder({ ...base, targetProjectRef: PROD, dryRun: true }).result).toBe('REJECTED_PRODUCTION_REF'); });
  it('25. dry-run allowed, writes nothing', () => { const r = guardSeeder({ ...base, targetProjectRef: 'preview-xyz', dryRun: true }); expect(r.result).toBe('ALLOWED_DRY_RUN'); expect(r.wouldWrite).toBe(false); });
  it('27. no confirm → rejected', () => { expect(guardSeeder({ ...base, targetProjectRef: 'preview-xyz', confirmPreview: false }).result).toBe('REJECTED_NO_CONFIRM'); });
  it('preview + confirm → allowed write', () => { const r = guardSeeder({ ...base, targetProjectRef: 'preview-xyz' }); expect(r.result).toBe('ALLOWED_PREVIEW'); expect(r.wouldWrite).toBe(true); });
});

describe('cleanup guard', () => {
  const base = { productionProjectRef: PROD, tag: 'AI_PREVIEW_TESTBED', dryRun: true, confirm: false };
  it('26. production ref rejected', () => { expect(guardCleanup({ ...base, targetProjectRef: PROD }).result).toBe('REJECTED_PRODUCTION_REF'); });
  it('untagged rejected', () => { expect(guardCleanup({ ...base, targetProjectRef: 'preview-xyz', tag: 'other' }).result).toBe('REJECTED_UNTAGGED'); });
  it('dry-run lists targets only', () => { expect(guardCleanup({ ...base, targetProjectRef: 'preview-xyz' }).result).toBe('DRY_RUN_ONLY'); });
});

describe('isolation', () => {
  const iso = { dbProjectRefDiffersFromProd: true, authSeparate: true, storageSeparate: true, storeIdCollisionFree: true, playlistIdCollisionFree: true, reachableOnlyFromPreviewDeployment: true, allowlistSingleStore: true, sessionCapOne: true, candidatePinned: true, expiryPresent: true, cleanupPossible: true };
  it('fully isolated', () => { expect(verifyIsolation(iso).status).toBe('ISOLATED'); });
  it('shared prod DB → UNSAFE', () => { expect(verifyIsolation({ ...iso, dbProjectRefDiffersFromProd: false }).status).toBe('UNSAFE'); });
});

describe('testbed readiness', () => {
  const full: TestbedReadinessInput = {
    previewDbIsolated: true, migrationApplyAllowed: true, internalTestStoreCreated: true, testAccountCreated: true,
    existingPlaylistReady: true, candidatePlaylistReady: true, versionPinned: true, snapshotIntegrity: true,
    rollbackTargetReady: true, allowlistReady: true, deploymentBound: true, testWindowPlanned: true,
    operatorPlanned: true, cleanupReady: true, boundaryObservabilityReady: true, featureFlagsOff: true, killSwitchOn: true,
  };
  it('37. all ready → READY_FOR_SINGLE_STORE_CHANGE_REQUEST', () => { expect(computeTestbedReadiness(full).status).toBe('READY_FOR_SINGLE_STORE_CHANGE_REQUEST'); });
  it('35. shared prod DB (this phase) → BLOCKED', () => { const r = computeTestbedReadiness({ ...full, previewDbIsolated: false, migrationApplyAllowed: false }); expect(r.status).toBe('BLOCKED'); expect(r.runtimeHookImplemented).toBe(false); });
  it('34. missing core fixtures → PARTIAL', () => { expect(computeTestbedReadiness({ ...full, internalTestStoreCreated: false, candidatePlaylistReady: false }).status).toBe('PARTIAL'); });
  it('36. minor gaps → READY_WITH_WARNINGS', () => { expect(computeTestbedReadiness({ ...full, testWindowPlanned: false }).status).toBe('READY_WITH_WARNINGS'); });
  it('33. kill switch off → BLOCKED', () => { expect(computeTestbedReadiness({ ...full, killSwitchOn: false }).status).toBe('BLOCKED'); });
});
