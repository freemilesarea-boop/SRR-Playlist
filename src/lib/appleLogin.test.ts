import { describe, it, expect } from 'vitest';
import { shouldShowAppleLogin } from './appleLogin';

describe('shouldShowAppleLogin', () => {
  it('iOS 앱에서는 설정과 상관없이 보인다 — App Store 지침 4.8', () => {
    expect(shouldShowAppleLogin({ native: true, platform: 'ios', flag: undefined })).toBe(true);
    expect(shouldShowAppleLogin({ native: true, platform: 'ios', flag: 'false' })).toBe(true);
  });
  it('웹·안드로이드는 VITE_ENABLE_APPLE_LOGIN=true 일 때만', () => {
    expect(shouldShowAppleLogin({ native: false, platform: 'web', flag: undefined })).toBe(false);
    expect(shouldShowAppleLogin({ native: true, platform: 'android', flag: '' })).toBe(false);
    expect(shouldShowAppleLogin({ native: false, platform: 'web', flag: 'true' })).toBe(true);
    expect(shouldShowAppleLogin({ native: true, platform: 'android', flag: 'TRUE' })).toBe(true);
  });
});
