import { describe, it, expect, vi } from 'vitest';
vi.mock('@/lib/native', () => ({ isNativeApp: () => false }));
const { reloadLosesAutoplay, isIOSWeb } = await import('./gestureReloadPolicy');

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 16; SM-X230) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157 Safari/537.36';

describe('reloadLosesAutoplay — 새로고침하면 터치가 다시 필요한 기기', () => {
  it('아이폰 웹(이루밍 2026-11-27 기기)은 true', () => {
    expect(reloadLosesAutoplay({ userAgent: IPHONE, native: false })).toBe(true);
  });
  it('MacIntel 로 위장한 아이패드도 true', () => {
    expect(isIOSWeb({ userAgent: MAC, platform: 'MacIntel', maxTouchPoints: 5, native: false })).toBe(true);
  });
  it('네이티브 iOS 앱은 터치 없이 재생되므로 false', () => {
    expect(reloadLosesAutoplay({ userAgent: IPHONE, native: true })).toBe(false);
  });
  it('안드로이드·맥 데스크톱은 false (기존 동작 유지)', () => {
    expect(reloadLosesAutoplay({ userAgent: ANDROID, native: false })).toBe(false);
    expect(reloadLosesAutoplay({ userAgent: MAC, platform: 'MacIntel', maxTouchPoints: 0, native: false })).toBe(false);
  });
});
