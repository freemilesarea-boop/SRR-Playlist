import { describe, it, expect } from 'vitest';
import { nativeLandingPath, isStoreAccount, landingGate, type NativeLandingInput } from './nativeLanding';

const base: NativeLandingInput = {
  currentPath: '/',
  signedIn: true,
  accountType: 'individual',
  membershipTier: 'individual',
  subscriptionType: 'individual',
  boundBrandId: null,
  hasPlayerSession: false,
};

describe('isStoreAccount', () => {
  it('셋 중 하나만 business 여도 매장으로 본다', () => {
    // 결제/가입 경로마다 어느 컬럼이 채워지는지가 달라서(0014/0017 마이그레이션 이력)
    // 하나만 보면 숙대점처럼 매장인데 개인으로 오인되는 경우가 생긴다.
    expect(isStoreAccount({ accountType: 'business', membershipTier: 'free', subscriptionType: 'free' })).toBe(true);
    expect(isStoreAccount({ accountType: 'individual', membershipTier: 'business', subscriptionType: 'free' })).toBe(true);
    expect(isStoreAccount({ accountType: 'individual', membershipTier: 'free', subscriptionType: 'business' })).toBe(true);
  });

  it('전부 개인이면 매장이 아니다', () => {
    expect(isStoreAccount({ accountType: 'individual', membershipTier: 'individual', subscriptionType: 'individual' })).toBe(false);
    expect(isStoreAccount({ accountType: null, membershipTier: null, subscriptionType: null })).toBe(false);
  });
});

describe('nativeLandingPath', () => {
  it('루트가 아니면 건드리지 않는다 (딥링크·푸시 진입 보호)', () => {
    // 푸시 알림으로 /profile 에 들어왔는데 매장 화면으로 튕기면 알림이 무용지물이 된다.
    expect(nativeLandingPath({ ...base, currentPath: '/profile', accountType: 'business', hasPlayerSession: true })).toBeNull();
    expect(nativeLandingPath({ ...base, currentPath: '/playlist/abc', accountType: 'business', hasPlayerSession: true })).toBeNull();
  });

  it('로그인 전에는 이동하지 않는다', () => {
    expect(nativeLandingPath({ ...base, signedIn: false, accountType: 'business', hasPlayerSession: true })).toBeNull();
  });

  it('브랜드가 묶인 기기는 브랜드 플레이어로', () => {
    expect(nativeLandingPath({ ...base, boundBrandId: 'brand-1' })).toBe('/brand/player/brand-1');
  });

  it('브랜드 결속이 매장 계정보다 우선한다', () => {
    // 브랜드 전용 태블릿은 그 브랜드를 틀려고 설치한 기기다.
    expect(
      nativeLandingPath({ ...base, accountType: 'business', hasPlayerSession: true, boundBrandId: 'brand-9' }),
    ).toBe('/brand/player/brand-9');
  });

  it('매장 계정 + 복원할 큐 있음 → 매장 플레이어로 바로 복귀', () => {
    // 태블릿 재부팅 후 아무도 안 눌러서 무음이 되던 경로를 없앤다.
    expect(nativeLandingPath({ ...base, accountType: 'business', hasPlayerSession: true })).toBe('/business/player');
  });

  it('매장 계정인데 큐가 없으면 대시보드로', () => {
    // 첫 설정. 빈 플레이어를 띄우면 오히려 막힌다.
    expect(nativeLandingPath({ ...base, accountType: 'business', hasPlayerSession: false })).toBe('/business');
  });

  it('개인 회원은 기존대로 홈에 머문다', () => {
    expect(nativeLandingPath({ ...base, hasPlayerSession: true })).toBeNull();
  });
});

describe('landingGate — 언제 판단할 차례인가', () => {
  const base = { native: true, profileReady: true, userId: 'u1', landedForUser: null as string | null };

  it('웹에서는 아무것도 하지 않는다', () => {
    expect(landingGate({ ...base, native: false })).toBe('skip');
  });

  it('프로필 로드 전에는 미룬다 — 매장 계정을 개인으로 오인한다', () => {
    expect(landingGate({ ...base, profileReady: false })).toBe('skip');
  });

  it('로그인 전에는 판단을 쓰지 않고 풀어둔다', () => {
    // 예전에는 여기서 "끝냈다" 로 표시해버려서, 앱에서 로그인한 직후에는
    // 역할별 진입이 아예 동작하지 않았다(로그인 화면이 홈으로 보내면 홈에 머묾).
    expect(landingGate({ ...base, userId: null })).toBe('reset');
  });

  it('로그인하면 그 사용자에 대해 한 번 판단한다', () => {
    expect(landingGate(base)).toBe('evaluate');
    expect(landingGate({ ...base, landedForUser: 'u1' })).toBe('skip');
  });

  it('다른 사용자로 로그인하면 다시 판단한다', () => {
    expect(landingGate({ ...base, userId: 'u2', landedForUser: 'u1' })).toBe('evaluate');
  });

  it('로그인 → 로그아웃 → 같은 계정 재로그인 에서도 다시 판단한다', () => {
    // reset 이 플래그를 풀어주므로 재로그인 시 evaluate 로 돌아온다.
    expect(landingGate({ ...base, landedForUser: 'u1' })).toBe('skip');
    expect(landingGate({ ...base, userId: null, landedForUser: 'u1' })).toBe('reset');
    expect(landingGate({ ...base, landedForUser: null })).toBe('evaluate');
  });
});
