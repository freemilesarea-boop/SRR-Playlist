import { describe, it, expect } from 'vitest';
import { needsExternalBrowserForGoogle } from './inAppBrowser';

describe('needsExternalBrowserForGoogle', () => {
  it('우리 앱(네이티브)은 WebView 로 잡혀도 안내 없이 진행 — 시스템 브라우저로 로그인한다', () => {
    expect(needsExternalBrowserForGoogle({ native: true, inApp: true, pwa: false })).toBe(false);
    expect(needsExternalBrowserForGoogle({ native: true, inApp: false, pwa: true })).toBe(false);
  });
  it('웹: 카카오톡 등 인앱 브라우저·PWA 는 지금처럼 안내', () => {
    expect(needsExternalBrowserForGoogle({ native: false, inApp: true, pwa: false })).toBe(true);
    expect(needsExternalBrowserForGoogle({ native: false, inApp: false, pwa: true })).toBe(true);
  });
  it('웹: 일반 브라우저는 바로 진행', () => {
    expect(needsExternalBrowserForGoogle({ native: false, inApp: false, pwa: false })).toBe(false);
  });
});
