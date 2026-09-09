// 매장/브랜드 24시간 재생 — 화면 꺼짐 방지 드라이버 선택 로직 단위 테스트.
// iOS 네이티브 쉘(WKWebView)은 navigator.wakeLock 이 없으므로 native 모드가 반드시 선택돼야 한다.
import { describe, it, expect } from 'vitest';
import { pickScreenAwakeMode } from './screenAwake';

describe('pickScreenAwakeMode', () => {
  it('네이티브 쉘이면 wakeLock API 유무와 무관하게 native (iOS WKWebView 는 wakeLock 미제공)', () => {
    expect(pickScreenAwakeMode({ native: true, hasWakeLockApi: false })).toBe('native');
    expect(pickScreenAwakeMode({ native: true, hasWakeLockApi: true })).toBe('native');
  });

  it('웹에서 Screen Wake Lock API 가 있으면 web', () => {
    expect(pickScreenAwakeMode({ native: false, hasWakeLockApi: true })).toBe('web');
  });

  it('웹인데 API 도 없으면 unsupported — UI 가 자동 잠금 해제를 안내해야 한다', () => {
    expect(pickScreenAwakeMode({ native: false, hasWakeLockApi: false })).toBe('unsupported');
  });

  it('네이티브에서는 절대 unsupported 로 떨어지지 않는다', () => {
    for (const hasWakeLockApi of [true, false]) {
      expect(pickScreenAwakeMode({ native: true, hasWakeLockApi })).not.toBe('unsupported');
    }
  });
});
