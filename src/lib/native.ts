/**
 * native.ts — Capacitor 네이티브 앱 컨텍스트 감지 + 초기화 헬퍼.
 *
 * 같은 웹 코드가 (1) 일반 브라우저/PWA 와 (2) iOS/Android 네이티브 쉘에서 함께 돈다.
 * 네이티브에서만 달라져야 하는 동작(SW 미등록, 상태바/스플래시 제어, 하드웨어 back)을
 * 여기서 한 곳에 모아 가드한다.
 *
 * 주의: @capacitor/core 는 브라우저에서도 안전하게 로드되며, 네이티브 런타임이 없으면
 *   isNativePlatform() 이 false 를 반환한다(웹 폴백). 따라서 웹 번들에도 포함 OK.
 */
import { Capacitor } from '@capacitor/core';

/** iOS/Android 네이티브 쉘(Capacitor WebView) 안에서 실행 중인지. 웹/PWA 면 false. */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** 'ios' | 'android' | 'web' */
export function nativePlatform(): string {
  try {
    return Capacitor.getPlatform();
  } catch {
    return 'web';
  }
}

/**
 * 네이티브 전용 초기화. 웹에서는 아무 것도 하지 않는다(전부 no-op 가드).
 * 플러그인은 동적 import — 웹 번들 초기 로드에 네이티브 플러그인 코드가 끼지 않도록.
 */
export async function initNativeShell(): Promise<void> {
  if (!isNativeApp()) return;

  // 상태바: 다크 테마 고정(앱 배경 #0a0a0a 와 일치).
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Dark });
    if (nativePlatform() === 'android') {
      await StatusBar.setBackgroundColor({ color: '#0a0a0a' });
    }
  } catch {
    /* 플러그인 미탑재 환경 — skip */
  }

  // 스플래시: 첫 렌더 이후 수동 숨김(깜빡임 방지).
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide();
  } catch {
    /* skip */
  }

  // Android 하드웨어 back: 히스토리 있으면 뒤로, 루트면 앱 최소화(종료 대신).
  try {
    const { App } = await import('@capacitor/app');
    App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) {
        window.history.back();
      } else {
        void App.minimizeApp();
      }
    });
  } catch {
    /* skip */
  }
}
