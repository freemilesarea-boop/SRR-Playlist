import { describe, it, expect } from 'vitest';
import { resolveStoreGate, isStorePlaybackBlocked, type StoreGateInput } from './storePlaybackGate';

function input(over: Partial<StoreGateInput> = {}): StoreGateInput {
  return { membership: 'free', businessMode: true, ...over };
}

describe('resolveStoreGate', () => {
  it('유료/체험(premium)은 매장이든 개인이든 재생 가능', () => {
    expect(resolveStoreGate(input({ membership: 'premium' }))).toBe('allow');
    expect(resolveStoreGate(input({ membership: 'premium', businessMode: false }))).toBe('allow');
  });

  it('매장 모드 + 무료 등급 → 미리듣기 없이 전체화면 차단', () => {
    expect(resolveStoreGate(input())).toBe('subscription_required');
  });

  it('일반 사용자 + 무료 등급 → 기존 25초 미리듣기 유지 (결제 유도 흐름 불변)', () => {
    expect(resolveStoreGate(input({ businessMode: false }))).toBe('preview');
  });

  it('비로그인은 로그인 요구', () => {
    expect(resolveStoreGate(input({ membership: 'anonymous' }))).toBe('login_required');
    expect(resolveStoreGate(input({ membership: 'anonymous', businessMode: false }))).toBe('login_required');
  });
});

describe('isStorePlaybackBlocked', () => {
  it('매장 무료 등급에서만 true', () => {
    expect(isStorePlaybackBlocked(input())).toBe(true);
    expect(isStorePlaybackBlocked(input({ businessMode: false }))).toBe(false);
    expect(isStorePlaybackBlocked(input({ membership: 'premium' }))).toBe(false);
    expect(isStorePlaybackBlocked(input({ membership: 'anonymous' }))).toBe(false);
  });

  it('데모 계정은 membership 이 premium 으로 해석되므로 걸리지 않는다 (시연용 무제한 — 의도됨)', () => {
    expect(isStorePlaybackBlocked(input({ membership: 'premium' }))).toBe(false);
  });
});
