import { describe, it, expect } from 'vitest';
import { shouldVibrateFor, passesThrottle, THROTTLE_MS } from '@/lib/nativeHaptics';

describe('shouldVibrateFor', () => {
  it('보통 버튼은 울린다', () => {
    expect(shouldVibrateFor({})).toBe(true);
  });

  it('data-no-haptic 안쪽은 울리지 않는다 — 호출부가 끌 수 있어야 한다', () => {
    expect(shouldVibrateFor({ closestNoHaptic: true })).toBe(false);
  });

  it('입력란은 울리지 않는다 — 글자마다 울리면 못 쓴다', () => {
    expect(shouldVibrateFor({ isFormField: true })).toBe(false);
  });
});

describe('passesThrottle', () => {
  it('첫 입력은 통과한다', () => {
    expect(passesThrottle(1000, -Infinity)).toBe(true);
  });

  it('간격을 채우면 통과한다', () => {
    expect(passesThrottle(1000, 1000 - THROTTLE_MS)).toBe(true);
  });

  it('연타는 막는다 — 진동이 밀려서 기기가 웅웅거린다', () => {
    expect(passesThrottle(1000, 1000 - (THROTTLE_MS - 1))).toBe(false);
  });
});
