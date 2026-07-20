/**
 * migrationCertification — Dedicated Test Project Provisioning, Full Migration
 * Certification & Preview Isolation Activation (Phase AI-ENV-2, 순수 로직).
 *
 * AI-ENV-1 의 환경 가드 위에서, 격리된 Dedicated Test DB 에 전체 Migration Stack 을
 * 적용한 결과를 인증(certify)하고 RLS/RPC Integration 결과를 집계해 최종
 * READY_FOR_INTERNAL_TEST / PARTIALLY_READY / BLOCKED 를 판정한다.
 *
 * 원칙: Dedicated / Isolated / Synthetic-Only / Full-Stack-Validated / Fail-Closed.
 *  · Dedicated Test Project 가 실제 존재하지 않으면 BLOCKED(생성은 결제/사람 승인 필요).
 *  · Service Role 만으로 통과한 RLS 는 PASS 로 인정하지 않는다(실제 Role Context 필수).
 *  · 존재만 확인한 RPC 는 권한 PASS 로 인정하지 않는다.
 *  · Preview Build 성공만으로 환경 분리 PASS 로 인정하지 않는다.
 *  · 브라우저 미검증/Audio 미재생/Production Data 미검증은 PASS 가 아니라 not_run.
 *  · Production 은 여전히 repository_ahead 이며 이 Phase 에서 수정하지 않는다.
 */

import { PRODUCTION_PROJECT_REF } from '@/lib/appEnvironment';

export type CertStatus = 'pass' | 'fail' | 'not_run';

/* ── Migration Certification ─────────────────────────────────────────────── */
export interface MigrationApplyInput {
  firstVersion: string | null;
  latestRepositoryVersion: string | null;
  latestAppliedVersion: string | null;
  appliedCount: number;
  repositoryCount: number;
  failedCount: number;
  historicalModifiedCount: number;
  outOfOrderCount: number;
  duplicateVersionCount: number;
  missingVersionCount: number;
  target: 'local' | 'dedicated_test' | 'none';
  targetProjectRef: string | null;
}

export interface MigrationCertResult {
  status: CertStatus;
  fullStackApplied: boolean;
  latestMatches: boolean;
  blockers: string[];
}

export function certifyMigrationApply(i: MigrationApplyInput): MigrationCertResult {
  const blockers: string[] = [];
  if (i.target === 'none') {
    return { status: 'not_run', fullStackApplied: false, latestMatches: false, blockers: ['no_target_db'] };
  }
  if (i.targetProjectRef === PRODUCTION_PROJECT_REF) {
    // Production 을 대상으로 한 인증은 절대 허용하지 않는다.
    return { status: 'fail', fullStackApplied: false, latestMatches: false, blockers: ['production_target_forbidden'] };
  }
  if (i.failedCount > 0) blockers.push('failed_migrations');
  if (i.historicalModifiedCount > 0) blockers.push('historical_migration_modified');
  if (i.outOfOrderCount > 0) blockers.push('out_of_order');
  if (i.duplicateVersionCount > 0) blockers.push('duplicate_version');
  if (i.missingVersionCount > 0) blockers.push('missing_version');

  const fullStackApplied = i.appliedCount >= i.repositoryCount && i.repositoryCount > 0 && i.failedCount === 0;
  const latestMatches = i.latestAppliedVersion != null && i.latestAppliedVersion === i.latestRepositoryVersion;
  if (!fullStackApplied) blockers.push('full_stack_not_applied');
  if (!latestMatches) blockers.push('latest_version_mismatch');

  return {
    status: blockers.length === 0 ? 'pass' : 'fail',
    fullStackApplied, latestMatches, blockers,
  };
}

/* ── RLS Integration 집계(실제 Auth Context 필수) ────────────────────────── */
export interface RlsRoleResult {
  role: 'anonymous' | 'store' | 'other_store' | 'admin' | 'artist';
  /** 실제 Auth Context 로 실행했는가(Service Role 단독이면 false → 인증 불가). */
  usedRealAuthContext: boolean;
  /** 각 기대 규칙의 PASS 여부(차단 기대는 차단됨, 허용 기대는 허용됨). */
  expectationsPassed: number;
  expectationsTotal: number;
}

export interface RlsCertResult {
  status: CertStatus;
  criticalFailure: boolean;
  perRole: Array<{ role: string; status: CertStatus }>;
}

export function certifyRls(results: RlsRoleResult[]): RlsCertResult {
  if (results.length === 0) return { status: 'not_run', criticalFailure: false, perRole: [] };
  const perRole = results.map((r) => {
    if (!r.usedRealAuthContext) return { role: r.role, status: 'not_run' as CertStatus };
    if (r.expectationsTotal === 0) return { role: r.role, status: 'not_run' as CertStatus };
    return { role: r.role, status: (r.expectationsPassed === r.expectationsTotal ? 'pass' : 'fail') as CertStatus };
  });
  const anyFail = perRole.some((p) => p.status === 'fail');
  const anyNotRun = perRole.some((p) => p.status === 'not_run');
  // Anonymous / other_store 차단 실패는 critical.
  const criticalFailure = results.some((r) =>
    (r.role === 'anonymous' || r.role === 'other_store')
    && r.usedRealAuthContext && r.expectationsPassed < r.expectationsTotal);
  const status: CertStatus = anyFail ? 'fail' : anyNotRun ? 'not_run' : 'pass';
  return { status, criticalFailure, perRole };
}

/* ── RPC Inventory / Integration ─────────────────────────────────────────── */
export const REQUIRED_EXPERIMENT_RPCS = [
  'experiment_runtime_lookup', 'experiment_treatment_gate', 'experiment_treatment_recommend',
  'experiment_record_runtime_event', 'experiment_record_exposure',
  'admin_ai_exp_store_stop', 'admin_ai_exp_store_resume',
  'admin_ai_exp_generate_metric_snapshot', 'admin_ai_exp_generate_guardrail_snapshot',
  'admin_ai_exp_create_test_session', 'admin_ai_exp_record_execution_check',
  'admin_ai_exp_compute_promotion_gate',
] as const;

export interface RpcCheck {
  name: string;
  exists: boolean;
  /** 실제 인증 호출로 권한(Auth/Store Scope/위조 차단)을 검증했는가. */
  authValidated: boolean;
  authOk: boolean;
  securityDefiner: boolean;
  searchPathFixed: boolean;
}

export interface RpcCertResult {
  status: CertStatus;
  missing: string[];
  existsButUnvalidated: string[];
  failed: string[];
}

export function certifyRpc(checks: RpcCheck[], required: readonly string[] = REQUIRED_EXPERIMENT_RPCS): RpcCertResult {
  if (checks.length === 0) return { status: 'not_run', missing: [...required], existsButUnvalidated: [], failed: [] };
  const byName = new Map(checks.map((c) => [c.name, c]));
  const missing: string[] = [];
  const existsButUnvalidated: string[] = [];
  const failed: string[] = [];
  for (const name of required) {
    const c = byName.get(name);
    if (!c || !c.exists) { missing.push(name); continue; }
    if (!c.authValidated) { existsButUnvalidated.push(name); continue; } // 존재만으로 PASS 아님.
    if (!c.authOk || !c.securityDefiner || !c.searchPathFixed) failed.push(name);
  }
  const status: CertStatus = failed.length || missing.length ? 'fail' : existsButUnvalidated.length ? 'not_run' : 'pass';
  return { status, missing, existsButUnvalidated, failed };
}

/* ── Production Data Absence ─────────────────────────────────────────────── */
export interface ProductionDataAbsenceInput {
  /** 실제 검사를 실행했는가(미실행 → not_run). */
  checked: boolean;
  syntheticMarkerPresent: boolean;
  productionEmailDomainFound: boolean;
  productionKnownRecordFound: boolean;
  piiPatternFound: boolean;
  unexpectedRowCount: number;
}

export function certifyProductionDataAbsence(i: ProductionDataAbsenceInput): { status: CertStatus; reasons: string[] } {
  if (!i.checked) return { status: 'not_run', reasons: ['absence_check_not_run'] };
  const reasons: string[] = [];
  if (!i.syntheticMarkerPresent) reasons.push('synthetic_marker_absent');
  if (i.productionEmailDomainFound) reasons.push('production_email_domain_found');
  if (i.productionKnownRecordFound) reasons.push('production_known_record_found');
  if (i.piiPatternFound) reasons.push('pii_pattern_found');
  if (i.unexpectedRowCount > 0) reasons.push('unexpected_rows');
  return { status: reasons.length === 0 ? 'pass' : 'fail', reasons };
}

/* ── Final Certification Decision ────────────────────────────────────────── */
export type EnvDecision = 'READY_FOR_INTERNAL_TEST' | 'PARTIALLY_READY' | 'BLOCKED';

export interface FinalCertInput {
  dedicatedProjectExists: boolean;
  previewConnectedToTestProject: boolean;
  productionRefUsedAsTarget: boolean;
  secretIsolated: boolean;
  failClosedGuardOk: boolean;
  migration: MigrationCertResult;
  driftRepoVsTest: 'in_sync' | 'repository_ahead' | 'database_ahead' | 'diverged' | 'unknown';
  seedApplied: boolean;
  authLoginOk: CertStatus;
  storageOk: CertStatus;
  audioPlaybackOk: CertStatus;
  rls: RlsCertResult;
  rpc: RpcCertResult;
  externalIntegrationsBlocked: boolean;
  resetReseedOk: CertStatus;
  browserPreviewOk: CertStatus;
  productionDataAbsence: CertStatus;
}

export interface FinalCertResult {
  decision: EnvDecision;
  grade: 'A' | 'B' | 'C' | 'D' | 'PARTIALLY_READY' | 'BLOCKED';
  score: number | null;
  blockingReasons: string[];
}

const isPass = (s: CertStatus) => s === 'pass';

export function deriveFinalCertification(i: FinalCertInput): FinalCertResult {
  const hard: string[] = [];
  if (i.productionRefUsedAsTarget) hard.push('production_ref_used_as_target');
  if (!i.dedicatedProjectExists) hard.push('dedicated_project_missing');
  if (!i.secretIsolated) hard.push('secret_isolation_failed');
  if (i.migration.status === 'fail') hard.push('migration_full_apply_failed');
  if (i.rls.criticalFailure) hard.push('rls_critical_failure');
  if (i.productionDataAbsence === 'fail') hard.push('production_data_present');

  if (hard.length) {
    return { decision: 'BLOCKED', grade: 'BLOCKED', score: null, blockingReasons: hard };
  }

  // 완전 준비(READY) 요건 — 전부 PASS + Preview 연결 + Drift in_sync.
  const readyChecks: Array<[string, boolean]> = [
    ['preview_connected_to_test', i.previewConnectedToTestProject],
    ['fail_closed_guard', i.failClosedGuardOk],
    ['migration_pass', i.migration.status === 'pass'],
    ['drift_in_sync', i.driftRepoVsTest === 'in_sync'],
    ['seed_applied', i.seedApplied],
    ['auth_login', isPass(i.authLoginOk)],
    ['storage', isPass(i.storageOk)],
    ['audio_playback', isPass(i.audioPlaybackOk)],
    ['rls', i.rls.status === 'pass'],
    ['rpc', i.rpc.status === 'pass'],
    ['external_blocked', i.externalIntegrationsBlocked],
    ['reset_reseed', isPass(i.resetReseedOk)],
    ['browser_preview', isPass(i.browserPreviewOk)],
    ['production_data_absence', isPass(i.productionDataAbsence)],
  ];
  const passed = readyChecks.filter(([, ok]) => ok).length;
  const score = Math.round((passed / readyChecks.length) * 1000) / 10;
  const pending = readyChecks.filter(([, ok]) => !ok).map(([k]) => k);

  if (pending.length === 0) {
    const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : 'C';
    return { decision: 'READY_FOR_INTERNAL_TEST', grade, score, blockingReasons: [] };
  }
  return { decision: 'PARTIALLY_READY', grade: 'PARTIALLY_READY', score, blockingReasons: pending };
}
