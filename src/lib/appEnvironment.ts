/**
 * appEnvironment — Isolated Preview Database, Safe Migration Pipeline & Test
 * Runtime Foundation (Phase AI-ENV-1, 순수 로직).
 *
 * 목적: Vercel Preview 앱이 Production Supabase 에 연결되는 것을 **정적·Runtime
 * 이중으로 차단**하고, Test/Preview 환경을 Production 과 완전히 분리하기 위한
 * 환경 판정·Project Ref 검증·Migration Drift·Readiness 로직을 담는다.
 *
 * 원칙: Isolated / Non-Production / Synthetic-Data-Only / Fail-Closed / Auditable.
 *  · Preview 에서 Production Project Ref 가 감지되면 앱을 정상 실행하지 않는다.
 *  · Runtime Environment 가 unknown 이어도 Production 으로 자동 Fallback 하지 않는다.
 *  · Service Role Key 는 Client 번들에 절대 노출하지 않는다(Server-only).
 *  · Production Migration Apply / Data Clone / Payment / Email / SMS / Webhook 은
 *    Test 환경에서 함수 자체가 차단된다(Kill Switch + BLOCKED 목록).
 *
 * PRODUCTION_PROJECT_REF 는 Supabase URL 에 노출되는 공개 식별자이며 Secret 이
 * 아니다(Anon Key/Service Role Key 아님). Client 초기화 전 Build-time 상수로 검증한다.
 */

/* ── Domain 타입 ─────────────────────────────────────────────────────────── */
export type AppEnvironment = 'production' | 'preview' | 'development' | 'test' | 'local' | 'unknown';
export type DatabaseEnvironment = 'production' | 'preview' | 'test' | 'local' | 'unknown';
export type EnvironmentSafetyStatus = 'safe' | 'warning' | 'blocked' | 'unknown';

export type EnvironmentValidationReason =
  | 'valid_isolated_environment'
  | 'legacy_unconfigured_environment'
  | 'production_project_in_preview'
  | 'unknown_project_ref'
  | 'missing_supabase_url'
  | 'missing_anon_key'
  | 'service_role_exposed'
  | 'environment_mismatch'
  | 'expected_ref_mismatch'
  | 'expected_ref_not_configured'
  | 'invalid_redirect_url'
  | 'unsafe_external_integration'
  | 'migration_not_ready'
  | 'seed_not_ready';

export interface EnvironmentValidationResult {
  appEnvironment: AppEnvironment;
  databaseEnvironment: DatabaseEnvironment;
  projectRef: string | null;
  expectedProjectRef: string | null;
  status: EnvironmentSafetyStatus;
  reasons: EnvironmentValidationReason[];
  canInitializeSupabase: boolean;
  canRunExperiment: boolean;
}

/** Production Supabase Project Ref(공개 식별자 — Secret 아님). */
export const PRODUCTION_PROJECT_REF = 'nsoesrvwkxqifjcxzvol';

/** 금지 액션 — 스펙 금지 기능과 1:1(자동 Production Sync/Clone/Apply 포함). */
export const BLOCKED_ENV_ACTIONS = [
  'apply_production_migration',
  'clone_production_data',
  'copy_production_users',
  'enable_production_payment',
  'enable_production_settlement',
  'start_internal_treatment',
  'activate_canary',
  'global_rollout',
  'auto_production_sync',
  'auto_production_deploy',
] as const;
export function isBlockedEnvAction(action: string): boolean {
  return (BLOCKED_ENV_ACTIONS as readonly string[]).includes(action) || action.startsWith('automatic_');
}

/* ── Project Ref 추출 ────────────────────────────────────────────────────── */
/** https://<ref>.supabase.co → <ref>. 로컬/부재는 안전하게 null/local 로. */
export function parseProjectRef(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).host;
    if (host === '127.0.0.1' || host === 'localhost' || host.startsWith('127.0.0.1:') || host.startsWith('localhost:')) {
      return 'local';
    }
    const ref = host.split('.')[0];
    return ref && ref.length > 0 ? ref : null;
  } catch {
    return null;
  }
}

export function isServiceRoleKey(key: string | null | undefined): boolean {
  if (!key) return false;
  // service_role JWT 는 role 클레임에 service_role 을 담는다. Client 번들에 있으면 위험.
  try {
    const parts = key.split('.');
    if (parts.length !== 3) return false;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}

/* ── Environment Validation(Fail-Closed) ─────────────────────────────────── */
export interface EnvironmentInputRaw {
  appEnv: string | null | undefined; // VITE_APP_ENV
  supabaseUrl: string | null | undefined; // VITE_SUPABASE_URL
  anonKey: string | null | undefined; // VITE_SUPABASE_ANON_KEY
  expectedRef: string | null | undefined; // VITE_EXPECTED_SUPABASE_PROJECT_REF
}

function normalizeAppEnv(v: string | null | undefined): AppEnvironment {
  switch ((v ?? '').trim().toLowerCase()) {
    case 'production': return 'production';
    case 'preview': return 'preview';
    case 'development': return 'development';
    case 'test': return 'test';
    case 'local': return 'local';
    default: return 'unknown';
  }
}

function dbEnvFromRef(ref: string | null, appEnv: AppEnvironment): DatabaseEnvironment {
  if (ref === 'local') return 'local';
  if (ref === PRODUCTION_PROJECT_REF) return 'production';
  if (ref == null) return 'unknown';
  if (appEnv === 'preview' || appEnv === 'test') return 'test';
  return 'unknown';
}

/**
 * 환경 검증. Preview/Test 앱이 Production Ref 에 연결되면 status='blocked' 이고
 * canInitializeSupabase=false 다(앱은 Block Screen 을 렌더한다). appEnv 가 unknown
 * (미설정 레거시)이면 Production 을 깨뜨리지 않기 위해 client 는 허용하되 status는
 * 'unknown'/'warning' 으로 표시하고 Experiment 실행은 불가하다(canRunExperiment=false).
 * Production 자동 Fallback 은 하지 않는다.
 */
export function validateEnvironment(input: EnvironmentInputRaw): EnvironmentValidationResult {
  const appEnvironment = normalizeAppEnv(input.appEnv);
  const projectRef = parseProjectRef(input.supabaseUrl);
  const expectedProjectRef = (input.expectedRef ?? '').trim() || null;
  const databaseEnvironment = dbEnvFromRef(projectRef, appEnvironment);
  const reasons: EnvironmentValidationReason[] = [];

  const nonProductionApp = appEnvironment === 'preview' || appEnvironment === 'test'
    || appEnvironment === 'development' || appEnvironment === 'local';

  // 1) Hard blocks — 증명된 위험.
  if (!input.supabaseUrl) reasons.push('missing_supabase_url');
  if (!input.anonKey) reasons.push('missing_anon_key');
  if (isServiceRoleKey(input.anonKey)) reasons.push('service_role_exposed');
  if (nonProductionApp && projectRef === PRODUCTION_PROJECT_REF) reasons.push('production_project_in_preview');
  if (expectedProjectRef && projectRef && projectRef !== expectedProjectRef) reasons.push('expected_ref_mismatch');
  if (nonProductionApp && projectRef == null) reasons.push('unknown_project_ref');

  const hardBlock = reasons.some((r) =>
    r === 'production_project_in_preview' || r === 'service_role_exposed'
    || r === 'expected_ref_mismatch' || r === 'unknown_project_ref'
    || r === 'missing_supabase_url' || r === 'missing_anon_key');

  if (hardBlock) {
    return {
      appEnvironment, databaseEnvironment, projectRef, expectedProjectRef,
      status: 'blocked', reasons, canInitializeSupabase: false, canRunExperiment: false,
    };
  }

  // 2) Legacy — appEnv 미설정. Production 을 깨지 않기 위해 client 허용(레거시), 단 실험 불가.
  if (appEnvironment === 'unknown') {
    reasons.push('legacy_unconfigured_environment');
    return {
      appEnvironment, databaseEnvironment, projectRef, expectedProjectRef,
      status: 'unknown', reasons, canInitializeSupabase: true, canRunExperiment: false,
    };
  }

  // 3) Production 앱 + Production Ref = 정상 운영(실험은 이 Phase 에서 불가).
  if (appEnvironment === 'production') {
    if (projectRef !== PRODUCTION_PROJECT_REF) reasons.push('environment_mismatch');
    const mismatched = reasons.includes('environment_mismatch');
    return {
      appEnvironment, databaseEnvironment, projectRef, expectedProjectRef,
      status: mismatched ? 'blocked' : 'safe',
      reasons: mismatched ? reasons : ['valid_isolated_environment'],
      canInitializeSupabase: !mismatched, canRunExperiment: false,
    };
  }

  // 4) 비-Production 앱 + 비-Production Ref = 격리 Test/Preview/Local.
  const warnReasons: EnvironmentValidationReason[] = [];
  if (!expectedProjectRef) warnReasons.push('expected_ref_not_configured');
  const status: EnvironmentSafetyStatus = warnReasons.length ? 'warning' : 'safe';
  return {
    appEnvironment, databaseEnvironment, projectRef, expectedProjectRef,
    status,
    reasons: warnReasons.length ? warnReasons : ['valid_isolated_environment'],
    canInitializeSupabase: true,
    // 실험 실행은 완전 격리(safe) + 비-Production 환경에서만 후속 Phase 에서 허용.
    canRunExperiment: status === 'safe',
  };
}

/** UI/로그용 Ref 마스킹 — 앞 6자 + …(전체 노출 금지). */
export function maskProjectRef(ref: string | null): string {
  if (!ref) return '(none)';
  if (ref === 'local') return 'local';
  return ref.length <= 8 ? ref : `${ref.slice(0, 6)}…`;
}

/* ── External Integration Kill Switch ────────────────────────────────────── */
export interface IntegrationKillSwitchInput {
  appEnvironment: AppEnvironment;
  emailDisabled: boolean | null;
  smsDisabled: boolean | null;
  paymentDisabled: boolean | null;
  webhooksDisabled: boolean | null;
}

export type IntegrationName = 'payment' | 'settlement' | 'email' | 'sms' | 'push' | 'webhook' | 'store_control' | 'analytics';

/** 비-Production 환경에서 외부 연동은 기본 차단(명시적 disable 없으면 안전측=차단). */
export function isIntegrationBlocked(name: IntegrationName, s: IntegrationKillSwitchInput): boolean {
  if (s.appEnvironment === 'production') return false;
  // Test/Preview/Local/Unknown: 실제 외부 요청 금지. flag 로 명시 비활성 시 확실히 차단,
  // flag 미설정이어도 비-Production 이면 안전측으로 차단한다(Fail-Closed).
  switch (name) {
    case 'payment':
    case 'settlement':
      return s.paymentDisabled !== false;
    case 'email':
      return s.emailDisabled !== false;
    case 'sms':
    case 'push':
      return s.smsDisabled !== false;
    case 'webhook':
    case 'store_control':
    case 'analytics':
      return s.webhooksDisabled !== false;
    default:
      return true;
  }
}

/* ── Migration Drift ─────────────────────────────────────────────────────── */
export type MigrationDriftStatus = 'in_sync' | 'repository_ahead' | 'database_ahead' | 'diverged' | 'unknown';

export function detectMigrationDrift(repositoryLatest: string | null, databaseLatest: string | null): MigrationDriftStatus {
  if (repositoryLatest == null || databaseLatest == null) return 'unknown';
  if (repositoryLatest === databaseLatest) return 'in_sync';
  // 문자열 비교로 순서 판정(zero-padded prefix 가정). 다르면 최소한 방향을 보고한다.
  if (repositoryLatest > databaseLatest) return 'repository_ahead';
  if (repositoryLatest < databaseLatest) return 'database_ahead';
  return 'diverged';
}

/* ── Synthetic Seed 검증(실제 PII 거부) ──────────────────────────────────── */
export interface SeedRecord {
  email: string | null;
  phone: string | null;
  name: string | null;
  isSynthetic: boolean;
}

const SYNTHETIC_EMAIL_DOMAINS = ['example.com', 'test.local', 'srr-test.local'];

export function validateSeedRecord(r: SeedRecord): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  if (!r.isSynthetic) violations.push('not_marked_synthetic');
  if (r.email) {
    const domain = r.email.split('@')[1]?.toLowerCase() ?? '';
    if (!SYNTHETIC_EMAIL_DOMAINS.includes(domain)) violations.push('non_synthetic_email_domain');
  }
  if (r.phone && /^\+?\d[\d\s-]{7,}$/.test(r.phone.trim())) {
    // 실전화번호 형태는 Seed 에 금지(허구 라벨만 허용).
    if (!/^(000|999|test)/i.test(r.phone.replace(/[^\dA-Za-z]/g, ''))) violations.push('possible_real_phone');
  }
  return { ok: violations.length === 0, violations };
}

/* ── Readiness Score & Decision ──────────────────────────────────────────── */
export type ReadinessGrade = 'A' | 'B' | 'C' | 'D' | 'partially_ready' | 'blocked' | 'unknown';
export type ReadinessDecision = 'READY_FOR_INTERNAL_TEST' | 'PARTIALLY_READY' | 'BLOCKED';

export interface ReadinessInput {
  databaseIsolated: boolean;
  secretIsolated: boolean;
  projectRefValidated: boolean;
  migrationComplete: boolean;
  migrationDrift: MigrationDriftStatus;
  rlsValidated: boolean;
  rpcValidated: boolean;
  syntheticSeedReady: boolean;
  authIsolated: boolean;
  storageIsolated: boolean;
  externalIntegrationsBlocked: boolean;
  resetReady: boolean;
  previewDeploymentConnected: boolean;
  productionConnectionGuarded: boolean;
  browserValidated: boolean;
  auditable: boolean;
  // Hard blockers
  previewConnectedToProduction: boolean;
  serviceRoleExposed: boolean;
  productionSecretReused: boolean;
  productionDataIncluded: boolean;
  productionResetPossible: boolean;
  externalPaymentActive: boolean;
  rlsCriticalFailure: boolean;
  migrationFailed: boolean;
  testDbMissing: boolean;
}

export interface ReadinessResult {
  score: number | null;
  grade: ReadinessGrade;
  decision: ReadinessDecision;
  blockingReasons: string[];
}

export function computeEnvironmentReadiness(i: ReadinessInput): ReadinessResult {
  const blockers: string[] = [];
  if (i.previewConnectedToProduction) blockers.push('preview_connected_to_production');
  if (i.serviceRoleExposed) blockers.push('service_role_client_exposed');
  if (i.productionSecretReused) blockers.push('production_secret_reused');
  if (i.testDbMissing) blockers.push('test_db_missing');
  if (i.migrationFailed) blockers.push('migration_failed');
  if (i.rlsCriticalFailure) blockers.push('rls_critical_failure');
  if (i.externalPaymentActive) blockers.push('external_payment_active');
  if (i.productionDataIncluded) blockers.push('production_data_included');
  if (i.productionResetPossible) blockers.push('production_reset_possible');

  if (blockers.length) {
    return { score: null, grade: 'blocked', decision: 'BLOCKED', blockingReasons: blockers };
  }

  const readyChecks = [
    i.databaseIsolated, i.secretIsolated, i.projectRefValidated, i.migrationComplete,
    i.migrationDrift === 'in_sync', i.rlsValidated, i.rpcValidated, i.syntheticSeedReady,
    i.authIsolated, i.storageIsolated, i.externalIntegrationsBlocked, i.resetReady,
    i.previewDeploymentConnected, i.productionConnectionGuarded, i.browserValidated, i.auditable,
  ];
  const passed = readyChecks.filter(Boolean).length;
  const score = Math.round((passed / readyChecks.length) * 1000) / 10;

  // Preview Deployment 미연결 또는 Browser 미검증 → 완전 준비 아님(PARTIALLY_READY).
  const previewComplete = i.previewDeploymentConnected && i.browserValidated && i.databaseIsolated;
  if (!previewComplete) {
    return {
      score,
      grade: 'partially_ready',
      decision: 'PARTIALLY_READY',
      blockingReasons: [
        ...(i.databaseIsolated ? [] : ['dedicated_test_db_not_provisioned']),
        ...(i.previewDeploymentConnected ? [] : ['preview_not_connected_to_test_db']),
        ...(i.browserValidated ? [] : ['browser_preview_not_validated']),
      ],
    };
  }

  const grade: ReadinessGrade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D';
  return { score, grade, decision: 'READY_FOR_INTERNAL_TEST', blockingReasons: [] };
}
