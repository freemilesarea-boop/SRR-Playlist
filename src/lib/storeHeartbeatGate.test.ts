import { describe, it, expect } from 'vitest';
import { shouldSendStoreHeartbeat, type StoreHeartbeatGateInput } from '@/lib/storeHeartbeatGate';

const base: StoreHeartbeatGateInput = {
  userId: 'u1',
  accountType: 'business',
  subscriptionType: null,
  membershipTier: null,
  businessMode: false,
  pathname: '/',
  hasTrack: true,
};

describe('shouldSendStoreHeartbeat', () => {
  it("매장이 '/' 에서 재생 중이면 보낸다 (2026-11-10 성수점: 관제가 21일 멈춤)", () => {
    expect(shouldSendStoreHeartbeat(base)).toBe(true);
  });

  it('매장 모드만 켠 계정도 매장 후보로 본다', () => {
    expect(shouldSendStoreHeartbeat({ ...base, accountType: null, businessMode: true })).toBe(true);
  });

  it('비로그인 / 매장 후보가 아니면 보내지 않는다', () => {
    expect(shouldSendStoreHeartbeat({ ...base, userId: null })).toBe(false);
    expect(shouldSendStoreHeartbeat({ ...base, accountType: 'personal' })).toBe(false);
  });

  it('관리/작가 화면에서는 보내지 않는다', () => {
    expect(shouldSendStoreHeartbeat({ ...base, pathname: '/admin' })).toBe(false);
    expect(shouldSendStoreHeartbeat({ ...base, pathname: '/admin/stores' })).toBe(false);
    expect(shouldSendStoreHeartbeat({ ...base, pathname: '/artist/me' })).toBe(false);
  });

  it("곡이 없으면 보내지 않아 매장 기기의 'playing' 을 덮어쓰지 않는다", () => {
    expect(shouldSendStoreHeartbeat({ ...base, pathname: '/business', hasTrack: false })).toBe(false);
  });

  it('매장 플레이어 화면은 곡이 없어도 보낸다 (기존 동작 유지)', () => {
    expect(shouldSendStoreHeartbeat({ ...base, pathname: '/business/player', hasTrack: false })).toBe(true);
  });
});
