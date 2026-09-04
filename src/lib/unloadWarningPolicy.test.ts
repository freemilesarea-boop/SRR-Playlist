import { describe, it, expect } from 'vitest';
import { shouldWarnBeforeUnload } from './unloadWarningPolicy';

const base = { suppressed: false, businessMode: false, audioActive: false };

describe('shouldWarnBeforeUnload', () => {
  it('개인 사용자: 실제로 소리가 날 때만 경고한다', () => {
    expect(shouldWarnBeforeUnload({ ...base, audioActive: true })).toBe(true);
    expect(shouldWarnBeforeUnload({ ...base, audioActive: false })).toBe(false);
  });

  it('앱이 스스로 일으킨 리로드 직전이면 경고하지 않는다', () => {
    expect(shouldWarnBeforeUnload({ ...base, audioActive: true, suppressed: true })).toBe(false);
  });

  it('매장/브랜드 플레이어 모드에서는 재생 중이어도 절대 경고하지 않는다', () => {
    // 무인 매장에 뜬 "사이트를 다시 로드할까요?" 모달은 아무도 누르지 않아
    // 자동 복구(리로드)를 영구히 막는다 — 이게 실제 매장 무음 장애의 원인이었다.
    expect(shouldWarnBeforeUnload({ ...base, businessMode: true, audioActive: true })).toBe(false);
    expect(shouldWarnBeforeUnload({ ...base, businessMode: true, audioActive: false })).toBe(false);
  });

  it('suppressed 가 businessMode/audioActive 조합보다 우선한다', () => {
    expect(
      shouldWarnBeforeUnload({ suppressed: true, businessMode: true, audioActive: true }),
    ).toBe(false);
  });
});
