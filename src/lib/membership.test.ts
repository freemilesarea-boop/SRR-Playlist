// Phase DEMO-PREMIUM-WHITELIST-1 — 데모 계정 Premium 화이트리스트 순수 로직 테스트.
import { describe, it, expect } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import type { UserRow } from '@/types/db';
import {
  resolveSubscriptionStatus, resolveMembership,
  isDemoPremiumAccount, DEMO_PREMIUM_ACCOUNT_IDS,
} from './membership';

const SESSION = {} as unknown as Session; // resolve* 는 truthiness 만 사용
const DEMO_IDS = [
  'de700001-0000-0000-0000-000000000001', // demohq
  'de700002-0000-0000-0000-000000000001', // demoshop1
  'de700002-0000-0000-0000-000000000002', // demoshop2
  'de700002-0000-0000-0000-000000000003', // demoshop3
];

function user(over: Partial<UserRow> & { id: string }): UserRow {
  return {
    nickname: null, role: 'user',
    subscription_type: 'free', membership_tier: 'free',
    free_trial_started_at: null, free_trial_ends_at: null,
    ...over,
  } as UserRow;
}

describe('isDemoPremiumAccount', () => {
  it('has exactly the 4 designated demo ids', () => {
    expect(DEMO_PREMIUM_ACCOUNT_IDS.size).toBe(4);
    for (const id of DEMO_IDS) expect(DEMO_PREMIUM_ACCOUNT_IDS.has(id)).toBe(true);
  });
  it('true only for exact demo ids', () => {
    for (const id of DEMO_IDS) expect(isDemoPremiumAccount(user({ id }))).toBe(true);
  });
  it('false for null profile', () => {
    expect(isDemoPremiumAccount(null)).toBe(false);
  });
  it('false for similar-but-not-exact id (no fuzzy match)', () => {
    expect(isDemoPremiumAccount(user({ id: 'de700001-0000-0000-0000-000000000002' }))).toBe(false);
    expect(isDemoPremiumAccount(user({ id: 'de700001-0000-0000-0000-00000000000' }))).toBe(false);
    expect(isDemoPremiumAccount(user({ id: 'DE700001-0000-0000-0000-000000000001' }))).toBe(false); // 대소문자도 정확 일치
    expect(isDemoPremiumAccount(user({ id: 'abc' }))).toBe(false);
  });
});

describe('demo accounts get premium (each of the 4)', () => {
  for (const id of DEMO_IDS) {
    it(`${id} → active/premium`, () => {
      const p = user({ id }); // membership_tier=free, no trial — 원래라면 free
      expect(resolveSubscriptionStatus(SESSION, p)).toBe('active');
      expect(resolveMembership(SESSION, p)).toBe('premium');
    });
  }
  it('demo id but NO session → anonymous (세션 필수)', () => {
    const p = user({ id: DEMO_IDS[0] });
    expect(resolveSubscriptionStatus(null, p)).toBe('anonymous');
    expect(resolveMembership(null, p)).toBe('anonymous');
  });
});

describe('non-demo users keep existing policy (회귀 없음)', () => {
  it('free user stays free', () => {
    const p = user({ id: 'normal-free-uuid' });
    expect(resolveSubscriptionStatus(SESSION, p)).toBe('free');
    expect(resolveMembership(SESSION, p)).toBe('free');
  });
  it('paid tier (individual) stays active/premium', () => {
    const p = user({ id: 'paid-uuid', membership_tier: 'individual' });
    expect(resolveSubscriptionStatus(SESSION, p)).toBe('active');
    expect(resolveMembership(SESSION, p)).toBe('premium');
  });
  it('business tier stays active/premium', () => {
    const p = user({ id: 'biz-uuid', membership_tier: 'business' });
    expect(resolveMembership(SESSION, p)).toBe('premium');
  });
  it('active trial stays trial/premium', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const p = user({ id: 'trial-uuid', free_trial_started_at: '2020-01-01T00:00:00Z', free_trial_ends_at: future });
    expect(resolveSubscriptionStatus(SESSION, p)).toBe('trial');
    expect(resolveMembership(SESSION, p)).toBe('premium');
  });
  it('expired trial stays expired/free', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const p = user({ id: 'expired-uuid', free_trial_started_at: '2020-01-01T00:00:00Z', free_trial_ends_at: past });
    expect(resolveSubscriptionStatus(SESSION, p)).toBe('expired');
    expect(resolveMembership(SESSION, p)).toBe('free');
  });
  it('anonymous when no session', () => {
    expect(resolveMembership(null, null)).toBe('anonymous');
  });
});
