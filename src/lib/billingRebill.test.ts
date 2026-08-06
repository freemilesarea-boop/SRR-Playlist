// Phase BILLING-SCHEDULER-RECOVERY-1 — 정기결제(rebill) 재개 순수 로직 테스트.
import { describe, it, expect } from 'vitest';
import {
  PLAN_PRICES_KRW, REBILL_LIMIT_DEFAULT, REBILL_LIMIT_MAX,
  resolveKillSwitch, resolveDryRun, resolveMode, normalizeDispatchRequest,
  resolvePlanAmount, isAmountValid, rebillCycleKey, classifyRebillCandidate,
  isChargeable, summarizeClassification, addMonthsClamped, maskEmail, maskPhone,
  secretPresence, isValidUuid, type RebillCandidateInput, type RebillClassification,
} from './billingRebill';

const CUTOVER = '2026-08-06T00:00:00+09:00'; // KST 자정 = 2026-08-05T15:00:00Z
const NOW = '2026-08-06T09:10:00+09:00';

function candidate(over: Partial<RebillCandidateInput> = {}): RebillCandidateInput {
  return {
    subscriptionId: 'aaaaaaaa-0000-4000-8000-000000000001',
    userId: 'bbbbbbbb-0000-4000-8000-000000000001',
    planType: 'individual',
    membershipTier: 'individual',
    status: 'active',
    autoRenew: true,
    rebillNo: 'RB123456',
    currentPeriodEnd: '2026-08-06T02:00:00+09:00', // due, after cutover
    amount: 4900,
    cancelRequestedAt: null,
    hasExistingCharge: false,
    ...over,
  };
}

describe('resolveKillSwitch — fail-closed', () => {
  it('undefined/null/empty → false', () => {
    expect(resolveKillSwitch(undefined)).toBe(false);
    expect(resolveKillSwitch(null)).toBe(false);
    expect(resolveKillSwitch('')).toBe(false);
  });
  it('only explicit true/1 → true', () => {
    expect(resolveKillSwitch('true')).toBe(true);
    expect(resolveKillSwitch('TRUE')).toBe(true);
    expect(resolveKillSwitch(' 1 ')).toBe(true);
  });
  it('ambiguous values → false', () => {
    for (const v of ['false', '0', 'yes', 'on', 'enabled', 'True!', 'y']) {
      expect(resolveKillSwitch(v)).toBe(false);
    }
  });
});

describe('resolveDryRun — dry_run 기본값 true, kill switch off 강제 dry', () => {
  it('kill switch off → always dry (true) regardless of body', () => {
    expect(resolveDryRun({ dry_run: false }, false)).toBe(true);
    expect(resolveDryRun({ dry_run: true }, false)).toBe(true);
    expect(resolveDryRun(undefined, false)).toBe(true);
  });
  it('kill switch on → default dry_run true, explicit false honored', () => {
    expect(resolveDryRun(undefined, true)).toBe(true);
    expect(resolveDryRun({}, true)).toBe(true);
    expect(resolveDryRun({ dry_run: false }, true)).toBe(false);
    expect(resolveDryRun({ dry_run: true }, true)).toBe(true);
  });
});

describe('resolveMode', () => {
  it('defaults to future_due, only legacy_review recognized', () => {
    expect(resolveMode(undefined)).toBe('future_due');
    expect(resolveMode('future_due')).toBe('future_due');
    expect(resolveMode('legacy_review')).toBe('legacy_review');
    expect(resolveMode('charge_everything')).toBe('future_due');
    expect(resolveMode(42)).toBe('future_due');
  });
});

describe('normalizeDispatchRequest', () => {
  it('clamps limit to [1, MAX] and defaults', () => {
    expect(normalizeDispatchRequest(undefined, 'x').limit).toBe(REBILL_LIMIT_DEFAULT);
    expect(normalizeDispatchRequest({ limit: 0 }, 'x').limit).toBe(1);
    expect(normalizeDispatchRequest({ limit: 9999 }, 'x').limit).toBe(REBILL_LIMIT_MAX);
    expect(normalizeDispatchRequest({ limit: 5 }, 'x').limit).toBe(5);
  });
  it('keeps only valid UUID subscription_ids, else null', () => {
    const ok = 'aaaaaaaa-0000-4000-8000-000000000001';
    expect(normalizeDispatchRequest({ subscription_ids: [ok, 'bad', ''] }, 'x').subscriptionIds).toEqual([ok]);
    expect(normalizeDispatchRequest({ subscription_ids: ['bad'] }, 'x').subscriptionIds).toBeNull();
    expect(normalizeDispatchRequest({}, 'x').subscriptionIds).toBeNull();
  });
  it('uses provided execution_id or fallback', () => {
    expect(normalizeDispatchRequest({ execution_id: 'run-1' }, 'fb').executionId).toBe('run-1');
    expect(normalizeDispatchRequest({ execution_id: '  ' }, 'fb').executionId).toBe('fb');
    expect(normalizeDispatchRequest(undefined, 'fb').executionId).toBe('fb');
  });
});

describe('amount calculation — server plan price is the source of truth', () => {
  it('resolvePlanAmount', () => {
    expect(resolvePlanAmount('individual')).toBe(4900);
    expect(resolvePlanAmount('business')).toBe(6900);
    expect(resolvePlanAmount('artist_general')).toBe(6900);
    expect(resolvePlanAmount('artist_student')).toBe(4900);
    expect(resolvePlanAmount('nonexistent')).toBeNull();
    expect(resolvePlanAmount(null)).toBeNull();
  });
  it('isAmountValid rejects mismatches and zero', () => {
    expect(isAmountValid('individual', 4900)).toBe(true);
    expect(isAmountValid('individual', 5000)).toBe(false);
    expect(isAmountValid('individual', 0)).toBe(false);
    expect(isAmountValid('individual', null)).toBe(false);
    expect(isAmountValid('unknown', 4900)).toBe(false);
  });
  it('plan price table matches audited values', () => {
    expect(PLAN_PRICES_KRW).toMatchObject({
      individual: 4900, artist_student: 4900, business: 6900, artist_general: 6900,
    });
  });
});

describe('rebillCycleKey — idempotency', () => {
  it('stable & unique per (subscription, cycle)', () => {
    const k1 = rebillCycleKey('sub-1', '2026-08-06T00:00:00Z');
    expect(k1).toBe('payapp:rebill:sub-1:2026-08-06T00:00:00Z');
    expect(rebillCycleKey('sub-1', '2026-08-06T00:00:00Z')).toBe(k1); // deterministic
    expect(rebillCycleKey('sub-1', '2026-09-06T00:00:00Z')).not.toBe(k1); // next cycle differs
    expect(rebillCycleKey('sub-2', '2026-08-06T00:00:00Z')).not.toBe(k1); // other sub differs
  });
});

describe('classifyRebillCandidate', () => {
  it('FUTURE_DUE: valid, due, after cutover, no prior charge → chargeable', () => {
    const r = classifyRebillCandidate(candidate(), CUTOVER, NOW);
    expect(r.classification).toBe('FUTURE_DUE');
    expect(r.chargeable).toBe(true);
  });

  it('LEGACY_OVERDUE: period ended before cutover → NOT chargeable', () => {
    const r = classifyRebillCandidate(
      candidate({ currentPeriodEnd: '2026-06-22T10:37:53+09:00' }), CUTOVER, NOW);
    expect(r.classification).toBe('LEGACY_OVERDUE');
    expect(r.chargeable).toBe(false);
    expect(r.reason).toBe('legacy_overdue_requires_manual_policy');
  });

  it('DUPLICATE_BLOCKED: existing charge for cycle → NOT chargeable', () => {
    const r = classifyRebillCandidate(candidate({ hasExistingCharge: true }), CUTOVER, NOW);
    expect(r.classification).toBe('DUPLICATE_BLOCKED');
    expect(r.chargeable).toBe(false);
  });

  it('INVALID_REBILL variants → NOT chargeable', () => {
    const cases: Array<[Partial<RebillCandidateInput>, string]> = [
      [{ rebillNo: null }, 'missing_rebill_no'],
      [{ rebillNo: '   ' }, 'missing_rebill_no'],
      [{ autoRenew: false }, 'auto_renew_off'],
      [{ status: 'canceled' }, 'not_active'],
      [{ cancelRequestedAt: '2026-08-01T00:00:00Z' }, 'cancel_requested'],
      [{ membershipTier: 'free' }, 'non_chargeable_tier'],
      [{ planType: 'mystery' }, 'unknown_plan'],
      [{ amount: 9999 }, 'amount_mismatch'],
      [{ currentPeriodEnd: null }, 'no_period_end'],
    ];
    for (const [over, reason] of cases) {
      const r = classifyRebillCandidate(candidate(over), CUTOVER, NOW);
      expect(r.classification).toBe('INVALID_REBILL');
      expect(r.chargeable).toBe(false);
      expect(r.reason).toBe(reason);
    }
  });

  it('demo account (exact UUID) is excluded from charging', () => {
    const r = classifyRebillCandidate(
      candidate({ userId: 'de700002-0000-0000-0000-000000000001' }), CUTOVER, NOW);
    expect(r.classification).toBe('INVALID_REBILL');
    expect(r.reason).toBe('demo_account_excluded');
    expect(r.chargeable).toBe(false);
  });

  it('not-yet-due (period end in future) → not charged', () => {
    const r = classifyRebillCandidate(
      candidate({ currentPeriodEnd: '2026-09-01T00:00:00+09:00' }), CUTOVER, NOW);
    expect(r.classification).toBe('INVALID_REBILL');
    expect(r.reason).toBe('not_yet_due');
  });

  it('the 12 known legacy subs (all before cutover) are ALL non-chargeable', () => {
    const legacyEnds = [
      '2026-06-22T10:37:53+09:00', '2026-07-01T00:00:00+09:00', '2026-07-27T01:10:04+09:00',
    ];
    for (const end of legacyEnds) {
      const r = classifyRebillCandidate(candidate({ currentPeriodEnd: end }), CUTOVER, NOW);
      expect(r.chargeable).toBe(false);
      expect(r.classification).toBe('LEGACY_OVERDUE');
    }
  });
});

describe('isChargeable', () => {
  it('only FUTURE_DUE', () => {
    const all: RebillClassification[] = ['FUTURE_DUE', 'LEGACY_OVERDUE', 'INVALID_REBILL', 'DUPLICATE_BLOCKED'];
    expect(all.filter(isChargeable)).toEqual(['FUTURE_DUE']);
  });
});

describe('summarizeClassification', () => {
  it('buckets counts and amounts, stable order', () => {
    const s = summarizeClassification([
      { classification: 'FUTURE_DUE', amount: 4900 },
      { classification: 'FUTURE_DUE', amount: 6900 },
      { classification: 'LEGACY_OVERDUE', amount: 4900 },
      { classification: 'INVALID_REBILL', amount: null },
    ]);
    expect(s[0]).toEqual({ classification: 'FUTURE_DUE', count: 2, amount: 11800 });
    expect(s[1]).toEqual({ classification: 'LEGACY_OVERDUE', count: 1, amount: 4900 });
    expect(s[2].count).toBe(1);
    expect(s[3]).toEqual({ classification: 'DUPLICATE_BLOCKED', count: 0, amount: 0 });
  });
});

describe('addMonthsClamped — month-end / cycle_date boundaries', () => {
  it('normal month add', () => {
    expect(addMonthsClamped('2026-08-06T02:00:00Z')).toBe('2026-09-06T02:00:00.000Z');
  });
  it('clamps 1/31 → 2/28 (non-leap)', () => {
    expect(addMonthsClamped('2026-01-31T00:00:00Z')).toBe('2026-02-28T00:00:00.000Z');
  });
  it('clamps 1/29 → 2/28 (non-leap), 30/31 too', () => {
    expect(addMonthsClamped('2026-01-29T00:00:00Z')).toBe('2026-02-28T00:00:00.000Z');
    expect(addMonthsClamped('2026-01-30T00:00:00Z')).toBe('2026-02-28T00:00:00.000Z');
  });
  it('leap year 1/31 → 2/29 (2028)', () => {
    expect(addMonthsClamped('2028-01-31T00:00:00Z')).toBe('2028-02-29T00:00:00.000Z');
  });
  it('3/31 → 4/30, 12/31 rolls year', () => {
    expect(addMonthsClamped('2026-03-31T00:00:00Z')).toBe('2026-04-30T00:00:00.000Z');
    expect(addMonthsClamped('2026-12-31T00:00:00Z')).toBe('2027-01-31T00:00:00.000Z');
  });
  it('throws on invalid input', () => {
    expect(() => addMonthsClamped('not-a-date')).toThrow();
  });
});

describe('masking — no PII / secrets in logs', () => {
  it('maskEmail', () => {
    expect(maskEmail('customer@example.com')).toBe('cu***@e***');
    expect(maskEmail('a@b.com')).toBe('a***@b***');
    expect(maskEmail(null)).toBe('***');
    expect(maskEmail('garbage')).toBe('***');
  });
  it('maskPhone reveals at most last 2 digits', () => {
    expect(maskPhone('010-1234-5678')).toBe('***78');
    expect(maskPhone(null)).toBe('***');
    expect(maskPhone('12')).toBe('***');
  });
  it('secretPresence never leaks value', () => {
    expect(secretPresence('super-secret-value')).toBe('PRESENT');
    expect(secretPresence('')).toBe('MISSING');
    expect(secretPresence(undefined)).toBe('MISSING');
  });
});

describe('isValidUuid', () => {
  it('accepts UUIDs, rejects everything else (no fuzzy matching)', () => {
    expect(isValidUuid('de700002-0000-0000-0000-000000000001')).toBe(true);
    expect(isValidUuid('customer@example.com')).toBe(false);
    expect(isValidUuid('nickname')).toBe(false);
    expect(isValidUuid(123)).toBe(false);
    expect(isValidUuid(null)).toBe(false);
  });
});
