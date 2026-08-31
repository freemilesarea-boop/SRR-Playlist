// Phase LEGACY-BILLING-RECOVERY-BUILD-NOTIFY-1 — Legacy 복구 순수 로직 테스트.
import { describe, it, expect } from 'vitest';
import {
  classifyLegacyRecoveryTarget, isRecoveryChargeable, recoveryChargeAmount,
  recoveryCycleKey, resolveLegacyRecoveryKillSwitch, computeScheduledChargeAt,
  formatKstChargeNotice, recoveryNoticeSubject, recoveryNoticeBody,
  LEGACY_RECOVERY_OP, type LegacyRecoveryInput,
} from './legacyRecovery';

const CUTOVER = '2026-08-06T00:00:00+09:00';
const NOW = '2026-08-06T09:10:00+09:00';

function target(over: Partial<LegacyRecoveryInput> = {}): LegacyRecoveryInput {
  return {
    subscriptionId: 'aaaaaaaa-0000-4000-8000-000000000001',
    userId: 'bbbbbbbb-0000-4000-8000-000000000001',
    role: 'user',
    membershipTier: 'individual',
    status: 'active',
    autoRenew: true,
    rebillNo: 'RB1',
    currentPeriodEnd: '2026-07-01T00:00:00+09:00', // legacy (before cutover, due)
    amount: 4900,
    planType: 'individual',
    cancelRequestedAt: null,
    priorAttempts: 0,
    priorRecoveryOrders: 0,
    ...over,
  };
}

describe('classifyLegacyRecoveryTarget', () => {
  it('eligible: legacy, active, valid rebill, plan amount, no prior', () => {
    const r = classifyLegacyRecoveryTarget(target(), CUTOVER, NOW);
    expect(r.classification).toBe('RECOVERY_CHARGE_ELIGIBLE');
    expect(r.chargeable).toBe(true);
  });

  it('EXCLUDED: admin / free / demo / cancelled / inactive / prior recovery', () => {
    const cases: Array<[Partial<LegacyRecoveryInput>, string]> = [
      [{ role: 'admin' }, 'admin_account'],
      [{ membershipTier: 'free' }, 'free_account'],
      [{ userId: 'de700002-0000-0000-0000-000000000001' }, 'demo_account'],
      [{ cancelRequestedAt: '2026-08-01T00:00:00Z' }, 'cancel_requested'],
      [{ status: 'canceled' }, 'not_active'],
      [{ priorAttempts: 1 }, 'recovery_attempt_exists'],
      [{ priorRecoveryOrders: 1 }, 'recovery_order_exists'],
    ];
    for (const [over, reason] of cases) {
      const r = classifyLegacyRecoveryTarget(target(over), CUTOVER, NOW);
      expect(r.classification).toBe('EXCLUDED');
      expect(r.chargeable).toBe(false);
      expect(r.reason).toBe(reason);
    }
  });

  it('PAYMENT_METHOD_REQUIRED: no rebill_no / amount mismatch / unknown plan', () => {
    expect(classifyLegacyRecoveryTarget(target({ rebillNo: null }), CUTOVER, NOW).classification).toBe('PAYMENT_METHOD_REQUIRED');
    expect(classifyLegacyRecoveryTarget(target({ rebillNo: '  ' }), CUTOVER, NOW).reason).toBe('missing_rebill_no');
    expect(classifyLegacyRecoveryTarget(target({ amount: 6900 }), CUTOVER, NOW).reason).toBe('amount_mismatch');
    expect(classifyLegacyRecoveryTarget(target({ planType: 'mystery' }), CUTOVER, NOW).reason).toBe('unknown_plan');
  });

  it('never charges: not-due / non-legacy → OTHER', () => {
    expect(classifyLegacyRecoveryTarget(target({ currentPeriodEnd: '2026-09-01T00:00:00+09:00' }), CUTOVER, NOW).classification).toBe('OTHER');
  });

  it('admin exclusion beats everything (the 2 admin legacy subs never charge)', () => {
    const r = classifyLegacyRecoveryTarget(target({ role: 'admin', rebillNo: 'RB', amount: 4900 }), CUTOVER, NOW);
    expect(r.chargeable).toBe(false);
    expect(r.classification).toBe('EXCLUDED');
  });
});

describe('amount & idempotency', () => {
  it('recoveryChargeAmount = server plan price only', () => {
    expect(recoveryChargeAmount('individual')).toBe(4900);
    expect(recoveryChargeAmount('business')).toBe(6900);
    expect(recoveryChargeAmount('nope')).toBeNull();
  });
  it('recoveryCycleKey stable & scoped to recovery op + cutover date', () => {
    const k = recoveryCycleKey('sub-1', '2026-08-06');
    expect(k).toBe(`payapp:${LEGACY_RECOVERY_OP}:sub-1:2026-08-06`);
    expect(recoveryCycleKey('sub-1', '2026-08-06')).toBe(k);
    expect(recoveryCycleKey('sub-1', '2026-09-06')).not.toBe(k);
  });
  it('isRecoveryChargeable only for eligible', () => {
    expect(isRecoveryChargeable('RECOVERY_CHARGE_ELIGIBLE')).toBe(true);
    expect(isRecoveryChargeable('PAYMENT_METHOD_REQUIRED')).toBe(false);
    expect(isRecoveryChargeable('EXCLUDED')).toBe(false);
    expect(isRecoveryChargeable('OTHER')).toBe(false);
  });
});

describe('kill switch — fail-closed', () => {
  it('only explicit true/1', () => {
    expect(resolveLegacyRecoveryKillSwitch(undefined)).toBe(false);
    expect(resolveLegacyRecoveryKillSwitch('false')).toBe(false);
    expect(resolveLegacyRecoveryKillSwitch('true')).toBe(true);
    expect(resolveLegacyRecoveryKillSwitch('1')).toBe(true);
  });
});

describe('scheduled charge date — >=24h and 15:00 KST', () => {
  it('send 14:00 KST → next day 15:00 KST (>=24h)', () => {
    // 2026-08-06T14:00 KST = 2026-08-06T05:00Z
    const s = computeScheduledChargeAt('2026-08-06T05:00:00Z');
    expect(s).toBe('2026-08-07T06:00:00.000Z'); // 2026-08-07 15:00 KST
    expect(new Date(s).getTime() - Date.parse('2026-08-06T05:00:00Z')).toBeGreaterThanOrEqual(24 * 3600_000);
  });
  it('send 16:00 KST → skips to day+2 15:00 KST (since day+1 15:00 is <24h)', () => {
    // 2026-08-06T16:00 KST = 2026-08-06T07:00Z; min = 08-07T07:00Z; 08-07 06:00Z < min → 08-08 06:00Z
    const s = computeScheduledChargeAt('2026-08-06T07:00:00Z');
    expect(s).toBe('2026-08-08T06:00:00.000Z');
    expect(new Date(s).getTime() - Date.parse('2026-08-06T07:00:00Z')).toBeGreaterThanOrEqual(24 * 3600_000);
  });
  it('always yields 15:00 KST and never less than 24h', () => {
    for (const iso of ['2026-08-06T00:00:00Z', '2026-08-06T05:59:00Z', '2026-08-06T06:01:00Z', '2026-12-31T23:00:00Z']) {
      const s = computeScheduledChargeAt(iso);
      const k = new Date(new Date(s).getTime() + 9 * 3600_000);
      expect(k.getUTCHours()).toBe(15);
      expect(new Date(s).getTime() - Date.parse(iso)).toBeGreaterThanOrEqual(24 * 3600_000);
    }
  });
  it('throws on invalid input', () => {
    expect(() => computeScheduledChargeAt('nope')).toThrow();
  });
});

describe('notice formatting & templates', () => {
  it('formatKstChargeNotice renders absolute KST date/time', () => {
    expect(formatKstChargeNotice('2026-08-07T06:00:00.000Z')).toBe('2026년 08월 07일 15시 이후');
  });
  it('subjects', () => {
    expect(recoveryNoticeSubject('auto_recharge')).toBe('[듣다] 정기결제 재개 안내');
    expect(recoveryNoticeSubject('payment_method_required')).toBe('[듣다] 결제수단 재등록 요청');
  });
  it('auto_recharge body: 4,900 once, no multi-month, has schedule + manage url', () => {
    const body = recoveryNoticeBody('auto_recharge', { manageUrl: 'https://deudda.com/subscription', scheduledNotice: '2026년 08월 07일 15시 이후', amount: 4900 });
    expect(body).toContain('4900원');
    expect(body).toContain('여러 번 청구하지 않으며');
    expect(body).toContain('2026년 08월 07일 15시 이후');
    expect(body).toContain('https://deudda.com/subscription');
    // never mentions summed/back amounts
    expect(body).not.toContain('9800');
    expect(body).not.toContain('14700');
  });
  it('pmr body: manage url, no charge promise', () => {
    const body = recoveryNoticeBody('payment_method_required', { manageUrl: 'https://deudda.com/subscription' });
    expect(body).toContain('결제수단을 다시 등록');
    expect(body).toContain('https://deudda.com/subscription');
    expect(body).not.toContain('결제할 예정');
  });
});
