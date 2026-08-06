import { describe, it, expect } from 'vitest';
import {
  classifyArtistBillingAccess,
  billingRequiredPayload,
  VALID_ARTIST_PLAN_TYPES,
  type ArtistBillingAccessInput,
  type ArtistBillingAccess,
} from './artistBillingAccess';

const NOW = '2026-08-06T00:00:00.000Z';
const FUTURE = '2026-09-06T00:00:00.000Z';
const PAST = '2026-07-06T00:00:00.000Z';
const DEMO = 'de700002-0000-0000-0000-000000000001';

function base(overrides: Partial<ArtistBillingAccessInput> = {}): ArtistBillingAccessInput {
  return {
    userId: 'a1111111-1111-1111-1111-111111111111',
    isArtist: true,
    role: 'user',
    everPaid: true,
    subscriptions: [],
    ...overrides,
  };
}

function activeSub(overrides = {}) {
  return {
    status: 'active',
    planType: 'individual',
    cancelRequestedAt: null,
    canceledAt: null,
    currentPeriodEnd: FUTURE,
    createdAt: PAST,
    ...overrides,
  };
}

describe('classifyArtistBillingAccess — allowed', () => {
  it('active paid artist → allowed/active', () => {
    const r = classifyArtistBillingAccess(base({ subscriptions: [activeSub()] }), NOW);
    expect(r).toEqual<ArtistBillingAccess>({ allowed: true, status: 'active', reason: null, restrictedAt: null });
  });

  it('admin → exempt (allowed)', () => {
    const r = classifyArtistBillingAccess(base({ role: 'admin', subscriptions: [] }), NOW);
    expect(r.allowed).toBe(true);
    expect(r.status).toBe('exempt');
  });

  it('exact demo UUID → exempt (allowed)', () => {
    const r = classifyArtistBillingAccess(base({ userId: DEMO, subscriptions: [] }), NOW);
    expect(r.allowed).toBe(true);
    expect(r.status).toBe('exempt');
  });

  it('business plan active → allowed', () => {
    const r = classifyArtistBillingAccess(base({ subscriptions: [activeSub({ planType: 'business' })] }), NOW);
    expect(r.allowed).toBe(true);
  });

  it('re-payment recovery: previously expired sub + new active sub → allowed', () => {
    const r = classifyArtistBillingAccess(
      base({ subscriptions: [
        { status: 'expired', planType: 'individual', cancelRequestedAt: null, canceledAt: null, currentPeriodEnd: PAST, createdAt: '2026-06-01T00:00:00Z' },
        activeSub({ createdAt: '2026-08-05T00:00:00Z' }),
      ] }),
      NOW,
    );
    expect(r.allowed).toBe(true);
    expect(r.status).toBe('active');
  });
});

describe('classifyArtistBillingAccess — restricted', () => {
  it('cancel_requested_at set → cancelled even if period_end future', () => {
    const r = classifyArtistBillingAccess(
      base({ subscriptions: [activeSub({ cancelRequestedAt: '2026-08-01T00:00:00Z', status: 'cancel_scheduled' })] }),
      NOW,
    );
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.reason).toBe('cancelled');
      expect(r.restrictedAt).toBe('2026-08-01T00:00:00Z');
    }
  });

  it('status canceled → cancelled', () => {
    const r = classifyArtistBillingAccess(
      base({ subscriptions: [activeSub({ status: 'canceled', cancelRequestedAt: null, canceledAt: '2026-08-02T00:00:00Z', currentPeriodEnd: PAST })] }),
      NOW,
    );
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('cancelled');
  });

  it('no subscription + never paid → unpaid', () => {
    const r = classifyArtistBillingAccess(base({ subscriptions: [], everPaid: false }), NOW);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('unpaid');
  });

  it('pending initial payment → unpaid', () => {
    const r = classifyArtistBillingAccess(
      base({ everPaid: false, subscriptions: [activeSub({ status: 'pending', currentPeriodEnd: null })] }),
      NOW,
    );
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('unpaid');
  });

  it('failed payment → unpaid', () => {
    const r = classifyArtistBillingAccess(
      base({ everPaid: false, subscriptions: [activeSub({ status: 'failed', currentPeriodEnd: null })] }),
      NOW,
    );
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('unpaid');
  });

  it('current_period_end passed → expired', () => {
    const r = classifyArtistBillingAccess(
      base({ subscriptions: [activeSub({ currentPeriodEnd: PAST })] }),
      NOW,
    );
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('expired');
  });

  it('status expired → expired', () => {
    const r = classifyArtistBillingAccess(
      base({ subscriptions: [activeSub({ status: 'expired', currentPeriodEnd: PAST })] }),
      NOW,
    );
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('expired');
  });

  it('boundary: current_period_end exactly now → expired (not allowed)', () => {
    const r = classifyArtistBillingAccess(
      base({ subscriptions: [activeSub({ currentPeriodEnd: NOW })] }),
      NOW,
    );
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('expired');
  });

  it('active status but no period_end + paid → invalid (fail-closed)', () => {
    const r = classifyArtistBillingAccess(
      base({ everPaid: true, subscriptions: [activeSub({ currentPeriodEnd: null })] }),
      NOW,
    );
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('invalid');
  });

  it('unknown/invalid plan type → not active (falls through to invalid)', () => {
    const r = classifyArtistBillingAccess(
      base({ subscriptions: [activeSub({ planType: 'mystery_plan' })] }),
      NOW,
    );
    expect(r.allowed).toBe(false);
  });

  it('null userId → unpaid (fail-closed)', () => {
    const r = classifyArtistBillingAccess(base({ userId: null }), NOW);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('unpaid');
  });
});

describe('billingRequiredPayload', () => {
  it('produces ARTIST_BILLING_REQUIRED payload with capability message + /subscription redirect', () => {
    const denied = classifyArtistBillingAccess(base({ subscriptions: [activeSub({ currentPeriodEnd: PAST })] }), NOW);
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      const p = billingRequiredPayload(denied, 'track.submit_distribution');
      expect(p.error).toBe('ARTIST_BILLING_REQUIRED');
      expect(p.status).toBe('expired');
      expect(p.redirect).toBe('/subscription');
      expect(p.message).toContain('유통 신청');
    }
  });
});

describe('VALID_ARTIST_PLAN_TYPES', () => {
  it('covers all paid artist tiers', () => {
    ['individual', 'business', 'artist_general', 'artist_student'].forEach((t) =>
      expect(VALID_ARTIST_PLAN_TYPES.has(t)).toBe(true),
    );
    expect(VALID_ARTIST_PLAN_TYPES.has('free')).toBe(false);
  });
});
