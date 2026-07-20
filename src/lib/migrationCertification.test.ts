import { describe, it, expect } from 'vitest';
import {
  certifyMigrationApply, certifyRls, certifyRpc, certifyProductionDataAbsence,
  deriveFinalCertification, REQUIRED_EXPERIMENT_RPCS,
  type MigrationApplyInput, type RlsRoleResult, type RpcCheck, type FinalCertInput, type MigrationCertResult,
} from './migrationCertification';
import { PRODUCTION_PROJECT_REF } from './appEnvironment';

const applyInput = (over: Partial<MigrationApplyInput> = {}): MigrationApplyInput => ({
  firstVersion: '0001', latestRepositoryVersion: '0571', latestAppliedVersion: '0571',
  appliedCount: 517, repositoryCount: 517, failedCount: 0, historicalModifiedCount: 0,
  outOfOrderCount: 0, duplicateVersionCount: 0, missingVersionCount: 0,
  target: 'dedicated_test', targetProjectRef: 'testref123', ...over,
});

describe('certifyMigrationApply', () => {
  it('target none → not_run', () => {
    expect(certifyMigrationApply(applyInput({ target: 'none' })).status).toBe('not_run');
  });
  it('production target → fail(금지)', () => {
    const r = certifyMigrationApply(applyInput({ targetProjectRef: PRODUCTION_PROJECT_REF }));
    expect(r.status).toBe('fail');
    expect(r.blockers).toContain('production_target_forbidden');
  });
  it('full apply + latest 일치 → pass', () => {
    const r = certifyMigrationApply(applyInput());
    expect(r.status).toBe('pass');
    expect(r.fullStackApplied).toBe(true);
    expect(r.latestMatches).toBe(true);
  });
  it('failed migration → fail', () => {
    expect(certifyMigrationApply(applyInput({ failedCount: 1 })).blockers).toContain('failed_migrations');
  });
  it('historical 수정 → fail', () => {
    expect(certifyMigrationApply(applyInput({ historicalModifiedCount: 1 })).blockers).toContain('historical_migration_modified');
  });
  it('부분 적용 → fail', () => {
    expect(certifyMigrationApply(applyInput({ appliedCount: 400 })).blockers).toContain('full_stack_not_applied');
  });
});

describe('certifyRls (실제 Auth Context 필수)', () => {
  it('결과 없음 → not_run', () => expect(certifyRls([]).status).toBe('not_run'));
  it('Service Role 단독(usedRealAuthContext=false) → not_run', () => {
    const r = certifyRls([{ role: 'store', usedRealAuthContext: false, expectationsPassed: 5, expectationsTotal: 5 }]);
    expect(r.perRole[0].status).toBe('not_run');
  });
  it('anonymous 차단 실패 → critical', () => {
    const rs: RlsRoleResult[] = [{ role: 'anonymous', usedRealAuthContext: true, expectationsPassed: 3, expectationsTotal: 5 }];
    const r = certifyRls(rs);
    expect(r.criticalFailure).toBe(true);
    expect(r.status).toBe('fail');
  });
  it('전부 실제 Context + 통과 → pass', () => {
    const rs: RlsRoleResult[] = [
      { role: 'anonymous', usedRealAuthContext: true, expectationsPassed: 5, expectationsTotal: 5 },
      { role: 'store', usedRealAuthContext: true, expectationsPassed: 4, expectationsTotal: 4 },
    ];
    expect(certifyRls(rs).status).toBe('pass');
  });
});

describe('certifyRpc (존재만으로 PASS 아님)', () => {
  const mk = (over: Partial<RpcCheck> = {}): RpcCheck => ({
    name: 'x', exists: true, authValidated: true, authOk: true, securityDefiner: true, searchPathFixed: true, ...over,
  });
  it('검사 없음 → not_run + 전부 missing', () => {
    const r = certifyRpc([]);
    expect(r.status).toBe('not_run');
    expect(r.missing.length).toBe(REQUIRED_EXPERIMENT_RPCS.length);
  });
  it('존재하지만 auth 미검증 → not_run(existsButUnvalidated)', () => {
    const checks = REQUIRED_EXPERIMENT_RPCS.map((n) => mk({ name: n, authValidated: false }));
    const r = certifyRpc(checks);
    expect(r.status).toBe('not_run');
    expect(r.existsButUnvalidated.length).toBe(REQUIRED_EXPERIMENT_RPCS.length);
  });
  it('부재 → fail(missing)', () => {
    const checks = REQUIRED_EXPERIMENT_RPCS.slice(1).map((n) => mk({ name: n }));
    const r = certifyRpc(checks);
    expect(r.status).toBe('fail');
    expect(r.missing).toContain(REQUIRED_EXPERIMENT_RPCS[0]);
  });
  it('전부 검증 통과 → pass', () => {
    const checks = REQUIRED_EXPERIMENT_RPCS.map((n) => mk({ name: n }));
    expect(certifyRpc(checks).status).toBe('pass');
  });
});

describe('Production Data Absence', () => {
  it('미검사 → not_run', () => {
    expect(certifyProductionDataAbsence({ checked: false, syntheticMarkerPresent: false, productionEmailDomainFound: false, productionKnownRecordFound: false, piiPatternFound: false, unexpectedRowCount: 0 }).status).toBe('not_run');
  });
  it('production email 발견 → fail', () => {
    const r = certifyProductionDataAbsence({ checked: true, syntheticMarkerPresent: true, productionEmailDomainFound: true, productionKnownRecordFound: false, piiPatternFound: false, unexpectedRowCount: 0 });
    expect(r.status).toBe('fail');
    expect(r.reasons).toContain('production_email_domain_found');
  });
  it('마커 존재 + 청정 → pass', () => {
    expect(certifyProductionDataAbsence({ checked: true, syntheticMarkerPresent: true, productionEmailDomainFound: false, productionKnownRecordFound: false, piiPatternFound: false, unexpectedRowCount: 0 }).status).toBe('pass');
  });
});

describe('deriveFinalCertification', () => {
  const passMig: MigrationCertResult = { status: 'pass', fullStackApplied: true, latestMatches: true, blockers: [] };
  const base = (over: Partial<FinalCertInput> = {}): FinalCertInput => ({
    dedicatedProjectExists: true, previewConnectedToTestProject: true, productionRefUsedAsTarget: false,
    secretIsolated: true, failClosedGuardOk: true, migration: passMig, driftRepoVsTest: 'in_sync',
    seedApplied: true, authLoginOk: 'pass', storageOk: 'pass', audioPlaybackOk: 'pass',
    rls: { status: 'pass', criticalFailure: false, perRole: [] },
    rpc: { status: 'pass', missing: [], existsButUnvalidated: [], failed: [] },
    externalIntegrationsBlocked: true, resetReseedOk: 'pass', browserPreviewOk: 'pass', productionDataAbsence: 'pass', ...over,
  });
  it('Dedicated Project 없음 → BLOCKED', () => {
    const r = deriveFinalCertification(base({ dedicatedProjectExists: false }));
    expect(r.decision).toBe('BLOCKED');
    expect(r.blockingReasons).toContain('dedicated_project_missing');
  });
  it('production ref 타겟 → BLOCKED', () => {
    expect(deriveFinalCertification(base({ productionRefUsedAsTarget: true })).decision).toBe('BLOCKED');
  });
  it('RLS critical → BLOCKED', () => {
    expect(deriveFinalCertification(base({ rls: { status: 'fail', criticalFailure: true, perRole: [] } })).decision).toBe('BLOCKED');
  });
  it('전부 PASS → READY_FOR_INTERNAL_TEST', () => {
    const r = deriveFinalCertification(base());
    expect(r.decision).toBe('READY_FOR_INTERNAL_TEST');
  });
  it('브라우저 not_run → PARTIALLY_READY', () => {
    const r = deriveFinalCertification(base({ browserPreviewOk: 'not_run' }));
    expect(r.decision).toBe('PARTIALLY_READY');
    expect(r.blockingReasons).toContain('browser_preview');
  });
});
