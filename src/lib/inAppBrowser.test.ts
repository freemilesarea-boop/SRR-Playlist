// 인앱 브라우저 감지 — 우리 앱이 스스로를 차단하지 않는지가 핵심.
//
// 배경: 안드로이드 WebView 의 UA 에는 "; wv)" 가 들어간다. Capacitor 로 만든
// 우리 앱도 예외가 아니라서, catch-all 패턴이 우리 앱을 "Android 인앱 브라우저" 로
// 잡아버렸다. 그 결과 앱에서 Google 로그인을 누르면 "Chrome 에서 열어주세요" 모달만
// 뜨고 로그인 자체가 불가능했다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const isNativeApp = vi.fn(() => false);
vi.mock('@/lib/native', () => ({
  isNativeApp: () => isNativeApp(),
  nativePlatform: () => 'web',
}));

const { detectInAppBrowser, isPwaStandalone } = await import('./inAppBrowser');

/** 안드로이드 Capacitor WebView 가 실제로 보내는 형태의 UA. */
const CAPACITOR_ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel Tablet Build/UQ1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Safari/537.36';
const KAKAOTALK_UA =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 KAKAOTALK/10.4.0';
const CHROME_UA =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

function setUserAgent(ua: string): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: ua },
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  isNativeApp.mockReturnValue(false);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('detectInAppBrowser', () => {
  it('우리 앱(Capacitor)은 인앱 브라우저로 잡지 않는다', () => {
    // 앱은 OAuth 를 WebView 안에서 열지 않는다 — 시스템 브라우저(커스텀탭)로
    // 나갔다가 딥링크로 돌아오므로 Google 정책 위반이 아니다.
    setUserAgent(CAPACITOR_ANDROID_UA);
    isNativeApp.mockReturnValue(true);
    expect(detectInAppBrowser().isInApp).toBe(false);
  });

  it('같은 UA 라도 앱이 아니면(=남의 앱 WebView) 여전히 인앱으로 잡는다', () => {
    // 네이티브 예외가 catch-all 자체를 무력화하면 안 된다.
    setUserAgent(CAPACITOR_ANDROID_UA);
    isNativeApp.mockReturnValue(false);
    const det = detectInAppBrowser();
    expect(det.isInApp).toBe(true);
    expect(det.name).toBe('android_webview');
  });

  it('카카오톡은 그대로 잡는다', () => {
    setUserAgent(KAKAOTALK_UA);
    const det = detectInAppBrowser();
    expect(det.isInApp).toBe(true);
    expect(det.name).toBe('kakaotalk');
  });

  it('정식 Chrome 은 통과', () => {
    setUserAgent(CHROME_UA);
    expect(detectInAppBrowser().isInApp).toBe(false);
  });
});

describe('isPwaStandalone', () => {
  it('앱에서는 standalone 으로 보이더라도 차단 대상이 아니다', () => {
    setUserAgent(CAPACITOR_ANDROID_UA);
    isNativeApp.mockReturnValue(true);
    Object.defineProperty(globalThis, 'window', {
      value: { matchMedia: () => ({ matches: true }) },
      configurable: true,
      writable: true,
    });
    expect(isPwaStandalone()).toBe(false);
  });
});
