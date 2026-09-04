import { describe, it, expect } from 'vitest';
import { shouldDeferReload, deferExpired, MAX_DEFER_MS, type ReloadGateInput } from './swUpdateGate';

const T0 = 1_700_000_000_000;
function input(over: Partial<ReloadGateInput> = {}): ReloadGateInput {
  return { businessMode: true, audioActive: true, deferredSince: null, now: T0, ...over };
}

describe('shouldDeferReload', () => {
  it('매장에서 재생 중이면 미룬다 (배포가 음악을 끊지 않게)', () => {
    expect(shouldDeferReload(input())).toBe(true);
  });

  it('일반 사용자는 기존처럼 즉시 리로드', () => {
    expect(shouldDeferReload(input({ businessMode: false }))).toBe(false);
  });

  it('소리가 안 나면 즉시 적용 — 이미 멈춘 상태라 리로드가 오히려 복구다', () => {
    expect(shouldDeferReload(input({ audioActive: false }))).toBe(false);
  });

  it('재생 의도(playing)가 아니라 실제 소리 기준이어야 한다 — 오류로 멈춘 플레이어는 리로드로 복구', () => {
    // onError 가 매장모드에서 playing=true 를 유지하므로, 의도로 판단하면 영원히 안 고쳐진다
    expect(shouldDeferReload(input({ audioActive: false, deferredSince: T0 - 60_000 }))).toBe(false);
  });

  it('상한(12시간) 전까지는 계속 미룬다', () => {
    expect(shouldDeferReload(input({ deferredSince: T0 - MAX_DEFER_MS + 1000 }))).toBe(true);
  });

  it('상한을 넘기면 재생 중이어도 적용한다 — 키오스크가 옛 빌드에 갇히지 않도록', () => {
    expect(shouldDeferReload(input({ deferredSince: T0 - MAX_DEFER_MS }))).toBe(false);
    expect(shouldDeferReload(input({ deferredSince: T0 - MAX_DEFER_MS - 60_000 }))).toBe(false);
  });
});

describe('deferExpired', () => {
  it('미룬 적 없으면 false', () => expect(deferExpired(null, T0)).toBe(false));
  it('상한 전이면 false', () => expect(deferExpired(T0 - 1000, T0)).toBe(false));
  it('상한 이후면 true', () => expect(deferExpired(T0 - MAX_DEFER_MS, T0)).toBe(true));
});
