import { describe, it, expect } from 'vitest';
import {
  classifyArtistBillingAccess,
  billingRequiredPayload,
  artistBillingBannerContent,
  isArtistBillingRequiredError,
  VALID_ARTIST_PLAN_TYPES,
  type ArtistBillingAccessInput,
  type ArtistBillingAccess,
  type ArtistBillingAccessResult,
} from './artistBillingAccess';

function result(partial: Partial<ArtistBillingAccessResult> & { isArtist: boolean }): ArtistBillingAccessResult {
  return { allowed: false, status: 'expired', reason: 'expired', restrictedAt: '2026-08-06T00:00:00Z', ...partial } as ArtistBillingAccessResult;
}

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

  it('0496 — 해지 예약(cancel_scheduled)이어도 결제한 기간이 남아 있으면 allowed', () => {
    const r = classifyArtistBillingAccess(
      base({ subscriptions: [activeSub({
        status: 'cancel_scheduled', cancelRequestedAt: '2026-08-01T00:00:00Z', currentPeriodEnd: FUTURE,
      })] }),
      NOW,
    );
    expect(r).toEqual<ArtistBillingAccess>({ allowed: true, status: 'active', reason: null, restrictedAt: null });
  });

  it('0496 — 아티스트 요금제도 유예기간 동안 allowed', () => {
    const r = classifyArtistBillingAccess(
      base({ subscriptions: [activeSub({
        status: 'cancel_scheduled', planType: 'artist_general',
        cancelRequestedAt: '2026-08-01T00:00:00Z', currentPeriodEnd: FUTURE,
      })] }),
      NOW,
    );
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
  it('해지 예약 + 기간 지남 → cancelled', () => {
    const r = classifyArtistBillingAccess(
      base({ subscriptions: [activeSub({
        status: 'cancel_scheduled', cancelRequestedAt: '2026-07-20T00:00:00Z', currentPeriodEnd: PAST,
      })] }),
      NOW,
    );
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.reason).toBe('cancelled');
      expect(r.restrictedAt).toBe('2026-07-20T00:00:00Z');
    }
  });

  it('환불건은 기간이 남아 있어도 차단 (0496)', () => {
    const r = classifyArtistBillingAccess(
      base({ subscriptions: [activeSub({ refundedAt: '2026-08-01T00:00:00Z' })] }),
      NOW,
    );
    expect(r.allowed).toBe(false);
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

describe('artistBillingBannerContent — banner copy per status', () => {
  it('cancelled: 기간 종료 문구 + 기존 음원 수정 언급 + 3 CTA(구독 다시 시작/기존 음원/정산)', () => {
    const c = artistBillingBannerContent(result({ isArtist: true, status: 'cancelled', reason: 'cancelled' }));
    expect(c).not.toBeNull();
    expect(c!.title).toContain('구독 기간이 끝나');
    expect(c!.body).toContain('기존 음원 수정');
    expect(c!.ctas[0]).toEqual({ label: '구독 다시 시작', to: '/subscription' });
    expect(c!.ctas.map((x) => x.label)).toEqual(['구독 다시 시작', '기존 음원 보기', '정산 내역 보기']);
  });

  it('expired: 결제 미확인 문구 + 기존 음원 수정 + CTA(결제수단 등록/구독 확인/고객지원)', () => {
    const c = artistBillingBannerContent(result({ isArtist: true, status: 'expired', reason: 'expired' }));
    expect(c!.title).toContain('결제가 확인되지 않아');
    expect(c!.body).toContain('기존 음원 수정');
    expect(c!.ctas.map((x) => x.label)).toEqual(['결제수단 등록', '구독 확인', '고객지원']);
    expect(c!.ctas.find((x) => x.label === '고객지원')!.to).toBe('/support');
  });

  it('unpaid & invalid: 결제 미확인 배너 표시', () => {
    expect(artistBillingBannerContent(result({ isArtist: true, status: 'unpaid', reason: 'unpaid' }))!.title).toContain('결제가 확인되지 않아');
    expect(artistBillingBannerContent(result({ isArtist: true, status: 'invalid', reason: 'invalid' }))!.title).toContain('결제가 확인되지 않아');
  });

  it('ACTIVE 아티스트 → 배너 없음(null)', () => {
    expect(artistBillingBannerContent({ allowed: true, status: 'active', reason: null, restrictedAt: null, isArtist: true })).toBeNull();
  });

  it('EXEMPT(admin/demo) → 배너 없음(null)', () => {
    expect(artistBillingBannerContent({ allowed: true, status: 'exempt', reason: null, restrictedAt: null, isArtist: true })).toBeNull();
  });

  it('비아티스트(제한 상태여도) → 배너 없음(null)', () => {
    expect(artistBillingBannerContent(result({ isArtist: false, status: 'expired', reason: 'expired' }))).toBeNull();
  });

  it('미조회(null) → 배너 없음(null)', () => {
    expect(artistBillingBannerContent(null)).toBeNull();
  });

  it('모든 CTA 는 유효 라우트만 사용(404 방지)', () => {
    const valid = new Set(['/subscription', '/artist', '/artist/settlements', '/support']);
    for (const reason of ['cancelled', 'unpaid', 'expired', 'invalid'] as const) {
      const c = artistBillingBannerContent(result({ isArtist: true, status: reason, reason }));
      c!.ctas.forEach((cta) => expect(valid.has(cta.to)).toBe(true));
    }
  });
});

describe('isArtistBillingRequiredError — DB Trigger/RPC 오류 매핑', () => {
  it('ARTIST_BILLING_REQUIRED 를 포함한 Error/문자열/객체를 인식', () => {
    expect(isArtistBillingRequiredError(new Error('ARTIST_BILLING_REQUIRED'))).toBe(true);
    expect(isArtistBillingRequiredError('foo ARTIST_BILLING_REQUIRED bar')).toBe(true);
    expect(isArtistBillingRequiredError({ message: 'ARTIST_BILLING_REQUIRED' })).toBe(true);
  });
  it('무관한 오류는 false', () => {
    expect(isArtistBillingRequiredError(new Error('row-level security'))).toBe(false);
    expect(isArtistBillingRequiredError(null)).toBe(false);
    expect(isArtistBillingRequiredError(undefined)).toBe(false);
  });
});

describe('billingRequiredPayload — 기존 음원 수정 capability', () => {
  it('track.edit 도 표준 페이로드 + /subscription redirect', () => {
    const denied = classifyArtistBillingAccess(base({ subscriptions: [activeSub({ status: 'canceled', cancelRequestedAt: '2026-08-01T00:00:00Z' })] }), NOW);
    if (!denied.allowed) {
      const p = billingRequiredPayload(denied, 'track.edit');
      expect(p.error).toBe('ARTIST_BILLING_REQUIRED');
      expect(p.status).toBe('cancelled');
      expect(p.redirect).toBe('/subscription');
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
