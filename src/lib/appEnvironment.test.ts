import { describe, it, expect } from 'vitest';
import {
  parseProjectRef, isServiceRoleKey, validateEnvironment, maskProjectRef,
  isIntegrationBlocked, detectMigrationDrift, validateSeedRecord, computeEnvironmentReadiness,
  isBlockedEnvAction, BLOCKED_ENV_ACTIONS, PRODUCTION_PROJECT_REF,
  type EnvironmentInputRaw, type ReadinessInput,
} from './appEnvironment';

describe('parseProjectRef', () => {
  it('supabase URL → ref', () => {
    expect(parseProjectRef('https://nsoesrvwkxqifjcxzvol.supabase.co')).toBe('nsoesrvwkxqifjcxzvol');
  });
  it('localhost → local', () => {
    expect(parseProjectRef('http://127.0.0.1:54321')).toBe('local');
    expect(parseProjectRef('http://localhost:54321')).toBe('local');
  });
  it('빈/이상 → null', () => {
    expect(parseProjectRef('')).toBeNull();
    expect(parseProjectRef('not a url')).toBeNull();
  });
});

describe('isServiceRoleKey', () => {
  it('service_role JWT 감지', () => {
    const payload = btoa(JSON.stringify({ role: 'service_role' }));
    expect(isServiceRoleKey(`h.${payload}.s`)).toBe(true);
  });
  it('anon JWT 는 false', () => {
    const payload = btoa(JSON.stringify({ role: 'anon' }));
    expect(isServiceRoleKey(`h.${payload}.s`)).toBe(false);
  });
  it('비-JWT 는 false', () => expect(isServiceRoleKey('public-anon-key')).toBe(false));
});

const raw = (over: Partial<EnvironmentInputRaw> = {}): EnvironmentInputRaw => ({
  appEnv: 'preview', supabaseUrl: 'https://testref123.supabase.co',
  anonKey: 'anon-key', expectedRef: 'testref123', ...over,
});

describe('validateEnvironment (Fail-Closed)', () => {
  it('preview → production ref → blocked, client 생성 불가', () => {
    const r = validateEnvironment(raw({ supabaseUrl: `https://${PRODUCTION_PROJECT_REF}.supabase.co`, expectedRef: null }));
    expect(r.status).toBe('blocked');
    expect(r.canInitializeSupabase).toBe(false);
    expect(r.reasons).toContain('production_project_in_preview');
  });
  it('expected ref 불일치 → blocked', () => {
    const r = validateEnvironment(raw({ supabaseUrl: 'https://other.supabase.co' }));
    expect(r.status).toBe('blocked');
    expect(r.reasons).toContain('expected_ref_mismatch');
  });
  it('service role 노출 → blocked', () => {
    const payload = btoa(JSON.stringify({ role: 'service_role' }));
    const r = validateEnvironment(raw({ anonKey: `h.${payload}.s` }));
    expect(r.status).toBe('blocked');
    expect(r.reasons).toContain('service_role_exposed');
  });
  it('격리 preview + 일치 ref → safe, 실험 가능', () => {
    const r = validateEnvironment(raw());
    expect(r.status).toBe('safe');
    expect(r.canInitializeSupabase).toBe(true);
    expect(r.canRunExperiment).toBe(true);
  });
  it('appEnv 미설정(legacy) → unknown, client 허용하되 실험 불가(Production 미파괴)', () => {
    const r = validateEnvironment(raw({ appEnv: undefined, expectedRef: undefined, supabaseUrl: `https://${PRODUCTION_PROJECT_REF}.supabase.co` }));
    expect(r.status).toBe('unknown');
    expect(r.canInitializeSupabase).toBe(true);
    expect(r.canRunExperiment).toBe(false);
    expect(r.reasons).toContain('legacy_unconfigured_environment');
  });
  it('production 앱 + production ref → safe(실험은 불가)', () => {
    const r = validateEnvironment(raw({ appEnv: 'production', supabaseUrl: `https://${PRODUCTION_PROJECT_REF}.supabase.co`, expectedRef: PRODUCTION_PROJECT_REF }));
    expect(r.status).toBe('safe');
    expect(r.canRunExperiment).toBe(false);
  });
  it('production 앱 + 잘못된 ref → blocked', () => {
    const r = validateEnvironment(raw({ appEnv: 'production', supabaseUrl: 'https://wrong.supabase.co', expectedRef: null }));
    expect(r.status).toBe('blocked');
  });
  it('missing url → blocked', () => {
    expect(validateEnvironment(raw({ supabaseUrl: null })).status).toBe('blocked');
  });
  it('expected ref 미설정(preview) → warning', () => {
    const r = validateEnvironment(raw({ expectedRef: undefined }));
    expect(r.status).toBe('warning');
    expect(r.canRunExperiment).toBe(false);
  });
});

describe('maskProjectRef', () => {
  it('마스킹', () => expect(maskProjectRef('nsoesrvwkxqifjcxzvol')).toBe('nsoesr…'));
  it('local/none', () => {
    expect(maskProjectRef('local')).toBe('local');
    expect(maskProjectRef(null)).toBe('(none)');
  });
});

describe('Integration Kill Switch', () => {
  const s = { appEnvironment: 'preview' as const, emailDisabled: null, smsDisabled: null, paymentDisabled: null, webhooksDisabled: null };
  it('비-Production 기본 차단(flag 미설정도 안전측 차단)', () => {
    expect(isIntegrationBlocked('payment', s)).toBe(true);
    expect(isIntegrationBlocked('email', s)).toBe(true);
    expect(isIntegrationBlocked('webhook', s)).toBe(true);
  });
  it('명시 비활성 → 차단', () => {
    expect(isIntegrationBlocked('payment', { ...s, paymentDisabled: true })).toBe(true);
  });
  it('flag=false(활성) → 차단 해제', () => {
    expect(isIntegrationBlocked('payment', { ...s, paymentDisabled: false })).toBe(false);
  });
  it('production → 차단 없음', () => {
    expect(isIntegrationBlocked('payment', { ...s, appEnvironment: 'production' })).toBe(false);
  });
});

describe('Migration Drift', () => {
  it('동일 → in_sync', () => expect(detectMigrationDrift('0571', '0571')).toBe('in_sync'));
  it('repo ahead', () => expect(detectMigrationDrift('0571', '0453')).toBe('repository_ahead'));
  it('db ahead', () => expect(detectMigrationDrift('0453', '0571')).toBe('database_ahead'));
  it('null → unknown', () => expect(detectMigrationDrift(null, '0571')).toBe('unknown'));
});

describe('Synthetic Seed 검증', () => {
  it('synthetic + example.com → ok', () => {
    expect(validateSeedRecord({ email: 'admin@example.com', phone: null, name: 'Test Admin', isSynthetic: true }).ok).toBe(true);
  });
  it('실제 도메인 → 위반', () => {
    expect(validateSeedRecord({ email: 'real@gmail.com', phone: null, name: 'x', isSynthetic: true }).violations).toContain('non_synthetic_email_domain');
  });
  it('synthetic 미표시 → 위반', () => {
    expect(validateSeedRecord({ email: 'a@test.local', phone: null, name: 'x', isSynthetic: false }).ok).toBe(false);
  });
  it('실전화번호 형태 → 위반', () => {
    expect(validateSeedRecord({ email: null, phone: '010-1234-5678', name: 'x', isSynthetic: true }).violations).toContain('possible_real_phone');
  });
});

describe('Environment Readiness', () => {
  const good = (over: Partial<ReadinessInput> = {}): ReadinessInput => ({
    databaseIsolated: true, secretIsolated: true, projectRefValidated: true, migrationComplete: true,
    migrationDrift: 'in_sync', rlsValidated: true, rpcValidated: true, syntheticSeedReady: true,
    authIsolated: true, storageIsolated: true, externalIntegrationsBlocked: true, resetReady: true,
    previewDeploymentConnected: true, productionConnectionGuarded: true, browserValidated: true, auditable: true,
    previewConnectedToProduction: false, serviceRoleExposed: false, productionSecretReused: false,
    productionDataIncluded: false, productionResetPossible: false, externalPaymentActive: false,
    rlsCriticalFailure: false, migrationFailed: false, testDbMissing: false, ...over,
  });
  it('preview→production → BLOCKED', () => {
    expect(computeEnvironmentReadiness(good({ previewConnectedToProduction: true })).decision).toBe('BLOCKED');
  });
  it('test db 없음 → BLOCKED', () => {
    expect(computeEnvironmentReadiness(good({ testDbMissing: true })).decision).toBe('BLOCKED');
  });
  it('전부 충족 → READY_FOR_INTERNAL_TEST', () => {
    const r = computeEnvironmentReadiness(good());
    expect(r.decision).toBe('READY_FOR_INTERNAL_TEST');
    expect(['A', 'B']).toContain(r.grade);
  });
  it('preview 미연결/browser 미검증 → PARTIALLY_READY', () => {
    const r = computeEnvironmentReadiness(good({ previewDeploymentConnected: false, browserValidated: false, databaseIsolated: false }));
    expect(r.decision).toBe('PARTIALLY_READY');
    expect(r.blockingReasons).toContain('dedicated_test_db_not_provisioned');
  });
});

describe('BLOCKED actions', () => {
  it('production apply/clone/canary/global rollout 차단', () => {
    for (const a of ['apply_production_migration', 'clone_production_data', 'activate_canary', 'global_rollout', 'start_internal_treatment']) {
      expect(isBlockedEnvAction(a)).toBe(true);
    }
    expect(isBlockedEnvAction('automatic_x')).toBe(true);
    expect(isBlockedEnvAction('validate_environment')).toBe(false);
  });
  it('BLOCKED 목록 포함', () => {
    expect(BLOCKED_ENV_ACTIONS).toContain('clone_production_data');
    expect(BLOCKED_ENV_ACTIONS).toContain('apply_production_migration');
  });
});
