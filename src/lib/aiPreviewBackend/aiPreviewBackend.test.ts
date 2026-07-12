// AI-MUSIC-12 — Isolated Preview Backend unit tests. Pure & deterministic. These exercise the audit/planning
// tooling ONLY — no Supabase resource is created, no Vercel env is mutated, no migration is applied, no runtime.
// They assert: production ref rejected everywhere; unrelated projects never reusable; cost-bearing branch not
// auto-created (MANUAL_PROVISIONING_REQUIRED); isolation requires distinct project/db/auth/storage; migration
// graph deps + runner production-ref rejection; env rebinding never touches production scope; connection /
// invariance; rebinding state machine forbids shortcuts; readiness capped without a created backend.
import { describe, it, expect } from 'vitest';
import {
  auditInfrastructure, classifyProject, isProductionRef, selectBackendStrategy, validateBackendIsolation,
  decideSchemaBaseline, AI_MUSIC_MIGRATION_GRAPH, validateMigrationGraph, guardMigrationRunner, planEnvRebinding,
  verifyConnection, checkProductionInvariance, canRebindingTransition, buildRollbackPlan,
  computeProvisioningReadiness, PRODUCTION_PROJECT_REF, ORG_ID,
  type BackendIsolationInput, type ProvisioningReadinessInput, type ProductionSnapshot,
} from './index';

const PROD = PRODUCTION_PROJECT_REF;
const PROJECTS = [
  { ref: PROD, name: 'SRR Playlist', region: 'ap-southeast-1', organizationId: ORG_ID },
  { ref: 'wxdlcjgvclyygjvimhgn', name: 'STUDIOBODA', region: 'ap-northeast-1', organizationId: ORG_ID },
  { ref: 'tyrhbiwvwmdybwaydvto', name: "freemilesarea-boop's Project", region: 'ap-northeast-1', organizationId: ORG_ID },
];

describe('infrastructure audit', () => {
  it('classifies production / unrelated / srr-test by relation, not name', () => {
    expect(classifyProject(PROD, 'SRR Playlist', PROD).relation).toBe('PRODUCTION');
    expect(classifyProject('x', 'STUDIOBODA', PROD).relation).toBe('UNRELATED');
    expect(classifyProject('x', "freemilesarea-boop's Project", PROD).relation).toBe('UNRELATED');
    expect(classifyProject('x', 'srr-playlist-preview', PROD).relation).toBe('SRR_TEST');
  });
  it('10. unrelated projects not reusable; no SRR test project exists', () => {
    const r = auditInfrastructure({ productionRef: PROD, projects: PROJECTS, orgPlan: 'pro', branchingAvailable: true, branchCostBearing: true, projectCreatePermission: true });
    expect(r.srrTestProjectExists).toBe(false);
    expect(r.classifications.filter((c) => c.reusable)).toEqual([]);
  });
  it('isProductionRef guard', () => { expect(isProductionRef(PROD, PROD)).toBe(true); expect(isProductionRef('x', PROD)).toBe(false); });
});

describe('backend strategy', () => {
  it('11./12. cost-bearing branch, no approval → MANUAL_PROVISIONING_REQUIRED (not auto-created)', () => {
    const r = selectBackendStrategy({ srrTestProjectExists: false, branchingAvailable: true, branchCostBearing: true, projectCreatePermission: true, costApproved: false, localSupabaseAvailable: false });
    expect(r.result).toBe('MANUAL_PROVISIONING_REQUIRED');
    expect(r.manualSteps.length).toBeGreaterThan(0);
  });
  it('9. existing srr test project → reuse (no cost)', () => {
    expect(selectBackendStrategy({ srrTestProjectExists: true, branchingAvailable: true, branchCostBearing: true, projectCreatePermission: true, costApproved: false, localSupabaseAvailable: false }).result).toBe('EXISTING_PROJECT_SELECTED');
  });
  it('local only when no create permission', () => {
    expect(selectBackendStrategy({ srrTestProjectExists: false, branchingAvailable: false, branchCostBearing: true, projectCreatePermission: false, costApproved: false, localSupabaseAvailable: true }).result).toBe('LOCAL_ONLY_SELECTED');
  });
});

function iso(o: Partial<BackendIsolationInput> = {}): BackendIsolationInput {
  return { productionProjectRef: PROD, previewProjectRef: 'preview-xyz', productionDbHostHash: 'pdb', previewDbHostHash: 'xdb', productionAuthTenantHash: 'pauth', previewAuthTenantHash: 'xauth', productionStorageNamespaceHash: 'pst', previewStorageNamespaceHash: 'xst', environmentScope: 'preview', killSwitch: true, testbedEnabled: false, ...o };
}
describe('isolation validator', () => {
  it('9. fully isolated', () => { expect(validateBackendIsolation(iso()).status).toBe('ISOLATED'); });
  it('1. same project ref → SHARED_PROJECT', () => { expect(validateBackendIsolation(iso({ previewProjectRef: PROD })).status).toBe('SHARED_PROJECT'); });
  it('3. same db host → SHARED_DB', () => { expect(validateBackendIsolation(iso({ previewDbHostHash: 'pdb' })).status).toBe('SHARED_DB'); });
  it('4. same auth tenant → SHARED_AUTH', () => { expect(validateBackendIsolation(iso({ previewAuthTenantHash: 'pauth' })).status).toBe('SHARED_AUTH'); });
  it('5. same storage → SHARED_STORAGE', () => { expect(validateBackendIsolation(iso({ previewStorageNamespaceHash: 'pst' })).status).toBe('SHARED_STORAGE'); });
  it('6. production scope → PRODUCTION_SCOPE', () => { expect(validateBackendIsolation(iso({ environmentScope: 'production' })).status).toBe('PRODUCTION_SCOPE'); });
  it('7. missing preview ref → INSUFFICIENT_DATA', () => { expect(validateBackendIsolation(iso({ previewProjectRef: null })).status).toBe('INSUFFICIENT_DATA'); });
});

describe('schema baseline', () => {
  it('13. AI-MUSIC needs base schema → FULL_SCHEMA_EMPTY_DATA, never a prod dump', () => {
    const r = decideSchemaBaseline({ aiMusicRequiresBaseSchema: true, minimalSubsetProven: false });
    expect(r.strategy).toBe('FULL_SCHEMA_EMPTY_DATA');
    expect(r.usesProductionDump).toBe(false);
    expect(r.usesMigrationSource).toBe(true);
  });
});

describe('migration graph', () => {
  it('15. full graph valid; 0470 depends on 0468/0469 + BASE', () => {
    const r = validateMigrationGraph({ nodes: AI_MUSIC_MIGRATION_GRAPH });
    expect(r.status).toBe('VALID');
    expect(r.orderedIds[0]).toBe('BASE');
  });
  it('14. missing BASE dependency detected', () => {
    const r = validateMigrationGraph({ nodes: AI_MUSIC_MIGRATION_GRAPH.filter((n) => n.id !== 'BASE') });
    expect(r.status).toBe('DEPENDENCY_MISSING');
  });
});

describe('migration runner guard', () => {
  const base = { productionProjectRef: PROD, isolationStatus: 'ISOLATED' as const, confirmPreview: true, dryRun: false };
  it('17. production ref rejected', () => { expect(guardMigrationRunner({ ...base, targetProjectRef: PROD }).result).toBe('REJECTED_PRODUCTION_REF'); });
  it('shared db rejected', () => { expect(guardMigrationRunner({ ...base, targetProjectRef: 'x', isolationStatus: 'SHARED_DB' }).result).toBe('REJECTED_SHARED_DB'); });
  it('not isolated rejected', () => { expect(guardMigrationRunner({ ...base, targetProjectRef: 'x', isolationStatus: 'PARTIAL' }).result).toBe('REJECTED_NOT_ISOLATED'); });
  it('18. dry-run applies nothing', () => { const r = guardMigrationRunner({ ...base, targetProjectRef: 'x', dryRun: true }); expect(r.result).toBe('DRY_RUN'); expect(r.wouldApply).toBe(false); });
  it('isolated + confirm → allowed', () => { expect(guardMigrationRunner({ ...base, targetProjectRef: 'x' }).result).toBe('ALLOWED_PREVIEW_APPLY'); });
});

describe('vercel env rebinding planner', () => {
  it('21. isolated → PLAN_READY, production scope untouched, redeploy required', () => {
    const r = planEnvRebinding({ previewProjectRef: 'preview-xyz', productionProjectRef: PROD, previewSupabaseUrlPresent: true, previewServiceRoleScoped: true, isolationStatus: 'ISOLATED' });
    expect(r.status).toBe('PLAN_READY');
    expect(r.productionScopeUntouched).toBe(true);
    expect(r.redeployRequired).toBe(true);
  });
  it('20. same-as-production ref → BLOCKED_PRODUCTION_SCOPE', () => {
    expect(planEnvRebinding({ previewProjectRef: PROD, productionProjectRef: PROD, previewSupabaseUrlPresent: true, previewServiceRoleScoped: true, isolationStatus: 'SHARED_PROJECT' }).status).toBe('BLOCKED_PRODUCTION_SCOPE');
  });
  it('not isolated → BLOCKED_NOT_ISOLATED', () => {
    expect(planEnvRebinding({ previewProjectRef: 'x', productionProjectRef: PROD, previewSupabaseUrlPresent: true, previewServiceRoleScoped: true, isolationStatus: 'PARTIAL' }).status).toBe('BLOCKED_NOT_ISOLATED');
  });
});

describe('connection verification', () => {
  const base = { deployed: true, frontendProjectRef: 'preview-xyz', serverProjectRef: 'preview-xyz', productionProjectRef: PROD, isPreviewEnvironment: true, requiredBaseTablesPresent: true, superAdminFnPresent: true, testbedFlagsOff: true, killSwitchOn: true };
  it('24. connected isolated', () => { expect(verifyConnection(base).status).toBe('CONNECTED_ISOLATED'); });
  it('23. bound to production → PRODUCTION_BOUND', () => { expect(verifyConnection({ ...base, frontendProjectRef: PROD }).status).toBe('PRODUCTION_BOUND'); });
  it('not deployed → NOT_DEPLOYED', () => { expect(verifyConnection({ ...base, deployed: false }).status).toBe('NOT_DEPLOYED'); });
});

describe('production invariance', () => {
  const snap = (o: Partial<ProductionSnapshot> = {}): ProductionSnapshot => ({ projectRef: PROD, supabaseUrlHash: 'u', anonKeyPresent: true, serviceRoleKeyPresent: true, migrationHead: '0453', deploymentSha: 'abc', ...o });
  it('25./26. identical → INVARIANT', () => { expect(checkProductionInvariance(snap(), snap()).status).toBe('INVARIANT'); });
  it('any change → CHANGED', () => { expect(checkProductionInvariance(snap(), snap({ migrationHead: '0471' })).status).toBe('CHANGED'); });
});

describe('rebinding state machine', () => {
  it('forbids ENV_BOUND → VERIFIED and BLOCKED → VERIFIED', () => {
    expect(canRebindingTransition('ENV_BOUND', 'VERIFIED')).toBe(false);
    expect(canRebindingTransition('BLOCKED', 'VERIFIED')).toBe(false);
    expect(canRebindingTransition('AUDIT_ONLY', 'CONNECTED')).toBe(false);
  });
  it('allows CONNECTED → VERIFIED', () => { expect(canRebindingTransition('CONNECTED', 'VERIFIED')).toBe(true); });
});

describe('rollback plan', () => {
  it('33. preview snapshot present → plan ready, production untouched', () => {
    const r = buildRollbackPlan({ previewEnvSnapshotPresent: true, touchesProductionScope: false, executed: false });
    expect(r.result).toBe('ROLLBACK_PLAN_READY');
    expect(r.productionUntouched).toBe(true);
  });
  it('production failover forbidden', () => { expect(buildRollbackPlan({ previewEnvSnapshotPresent: true, touchesProductionScope: true, executed: false }).result).toBe('PRODUCTION_FAILOVER_FORBIDDEN'); });
});

describe('provisioning readiness', () => {
  const full: ProvisioningReadinessInput = {
    backendTypeSelected: true, costPlanKnown: true, backendCreated: true, dbIsolated: true, authIsolated: true,
    storageIsolated: true, schemaStrategyReady: true, migrationGraphValid: true, migrationRunnerReady: true,
    envPlanReady: true, productionInvariant: true, connectionVerified: true, rollbackReady: true, cleanupReady: true, securityReady: true,
  };
  it('38. fully created + connected + invariant → ISOLATED_BACKEND_READY', () => {
    expect(computeProvisioningReadiness(full).status).toBe('ISOLATED_BACKEND_READY');
  });
  it('37. no backend created (this phase) → MANUAL_ACTION_REQUIRED, no runtime hook', () => {
    const r = computeProvisioningReadiness({ ...full, backendCreated: false, dbIsolated: false, authIsolated: false, storageIsolated: false, connectionVerified: false, productionInvariant: true });
    expect(r.status).toBe('MANUAL_ACTION_REQUIRED');
    expect(r.runtimeHookImplemented).toBe(false);
    expect(r.manualActions.length).toBeGreaterThan(0);
  });
  it('never ISOLATED_BACKEND_READY without a created+verified backend', () => {
    expect(computeProvisioningReadiness({ ...full, backendCreated: false }).status).not.toBe('ISOLATED_BACKEND_READY');
  });
});
