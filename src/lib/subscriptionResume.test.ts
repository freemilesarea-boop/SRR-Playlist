import { describe, it, expect } from 'vitest';
import {
  isPausedSubscription,
  hasRemainingGrace,
  remainingGraceDays,
  resumeNotice,
  planCardLocked,
  resumeCheckoutTarget,
  type PausedSubscriptionSnapshot,
} from './subscriptionResume';

const NOW = '2026-09-03T00:00:00.000Z';

function sub(overrides: Partial<PausedSubscriptionSnapshot> = {}): PausedSubscriptionSnapshot {
  return {
    status: 'cancel_scheduled',
    plan_type: 'individual',
    current_period_end: '2026-09-14T00:00:00.000Z',
    cancel_requested_at: '2026-08-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('isPausedSubscription', () => {
  it('해지 예약 = 정지', () => {
    expect(isPausedSubscription(sub())).toBe(true);
  });
  it('해지 완료 = 정지', () => {
    expect(isPausedSubscription(sub({ status: 'canceled', cancel_requested_at: null }))).toBe(true);
  });
  it('active 인데 취소 요청 흔적이 남아 있으면 정지로 본다', () => {
    expect(isPausedSubscription(sub({ status: 'active' }))).toBe(true);
  });
  it('정상 active / null 은 정지 아님', () => {
    expect(isPausedSubscription(sub({ status: 'active', cancel_requested_at: null }))).toBe(false);
    expect(isPausedSubscription(null)).toBe(false);
  });
});

describe('remainingGraceDays', () => {
  it('남은 일수를 올림으로 계산', () => {
    expect(remainingGraceDays(sub(), NOW)).toBe(11);
    expect(hasRemainingGrace(sub(), NOW)).toBe(true);
  });
  it('기간이 지났으면 0', () => {
    expect(remainingGraceDays(sub({ current_period_end: '2026-08-14T00:00:00.000Z' }), NOW)).toBe(0);
    expect(hasRemainingGrace(sub({ current_period_end: null }), NOW)).toBe(false);
  });
  it('정지 상태가 아니면 0', () => {
    expect(remainingGraceDays(sub({ status: 'active', cancel_requested_at: null }), NOW)).toBe(0);
  });
  it('날짜가 깨져 있어도 예외 없이 0', () => {
    expect(remainingGraceDays(sub({ current_period_end: 'not-a-date' }), NOW)).toBe(0);
  });
});

describe('resumeNotice', () => {
  it('유예가 남았으면 종료일을 알리고 즉시 재결제를 안내한다', () => {
    const n = resumeNotice(sub(), NOW);
    expect(n).not.toBeNull();
    expect(n?.remainingDays).toBe(11);
    expect(n?.body).toContain('2026년 9월 14일');
    expect(n?.body).toContain('새 결제 주기');
    expect(n?.ctaLabel).toContain('다시 결제');
  });
  it('유예가 끝났으면 남은 기간 문구 없이 재결제만 안내', () => {
    const n = resumeNotice(sub({ status: 'canceled', current_period_end: '2026-08-01T00:00:00.000Z' }), NOW);
    expect(n?.remainingDays).toBe(0);
    expect(n?.body).not.toContain('남아 있어도');
  });
  it('정지 상태가 아니면 null', () => {
    expect(resumeNotice(sub({ status: 'active', cancel_requested_at: null }), NOW)).toBeNull();
    expect(resumeNotice(null, NOW)).toBeNull();
  });
});

describe('planCardLocked', () => {
  it('정지 상태면 현재 요금제 카드도 잠그지 않는다 (즉시 재결제 허용)', () => {
    expect(planCardLocked(true, sub())).toBe(false);
  });
  it('정상 이용 중이면 잠근다', () => {
    expect(planCardLocked(true, sub({ status: 'active', cancel_requested_at: null }))).toBe(true);
    expect(planCardLocked(true, null)).toBe(true);
  });
  it('현재 요금제가 아니면 항상 열려 있다', () => {
    expect(planCardLocked(false, null)).toBe(false);
  });
});

describe('resumeCheckoutTarget', () => {
  it('아티스트 요금제는 아티스트 대시보드에서 재결제', () => {
    expect(resumeCheckoutTarget('artist_general')).toEqual({ kind: 'artist' });
    expect(resumeCheckoutTarget('artist_student')).toEqual({ kind: 'artist' });
  });
  it('일반/사업자는 구독 페이지에서 바로 재결제', () => {
    expect(resumeCheckoutTarget('business')).toEqual({ kind: 'plan', plan: 'business' });
    expect(resumeCheckoutTarget('individual')).toEqual({ kind: 'plan', plan: 'personal' });
    expect(resumeCheckoutTarget(null)).toEqual({ kind: 'plan', plan: 'personal' });
  });
});
