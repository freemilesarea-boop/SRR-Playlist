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

  // 가장 먼저 — 이 아래에서 찍히는 로그부터 logcat 에서 읽을 수 있어야 한다.
  // Capacitor 는 객체 인자를 [object Object] 로 뭉개서, 그냥 두면 진단 정보가 통째로
  // 사라진다(기기에서만 나는 문제를 쫓을 때 치명적).
  try {
    const { installNativeConsoleJson } = await import('@/lib/nativeConsole');
    installNativeConsoleJson();
  } catch {
    /* 로그 포맷 때문에 부팅을 막지는 않는다 */
  }

  // 레이아웃 오버라이드 훅. 앱은 폭이 태블릿(≥1024px)이라 Tailwind 의 lg: 분기가
  // 그대로 걸려 데스크톱 사이드바 레이아웃이 뜬다 — 매장 태블릿에는 맞지 않는다.
  // index.css 의 .native-shell 블록이 이 클래스를 보고 터치 우선 레이아웃으로 되돌린다.
  try {
    document.documentElement.classList.add('native-shell');
    document.documentElement.dataset.nativePlatform = nativePlatform();
  } catch {
    /* DOM 없는 환경 — skip */
  }

  // 상태바: 앱 테마를 따라간다. 예전에는 다크로 고정해서, 라이트 모드로 쓰면
  // 화면 위쪽 한 줄만 시커멓게 남아 있었다 — 그 한 줄이 "웹뷰" 라고 광고한다.
  try {
    const { syncNativeStatusBar } = await import('@/lib/nativeStatusBar');
    await syncNativeStatusBar();
    // 테마가 바뀌면(사용자 전환 · OS 다크모드 · 시간대) 상태바도 따라가야 한다.
    const { useThemeStore } = await import('@/store/themeStore');
    useThemeStore.subscribe(() => {
      void syncNativeStatusBar();
    });
  } catch {
    /* 플러그인 미탑재 환경 — skip */
  }

  // 누를 때 짧게 울린다. 촉감이 없으면 아무리 다듬어도 웹처럼 읽힌다.
  try {
    const { installTapHaptics } = await import('@/lib/nativeHaptics');
    installTapHaptics();
  } catch {
    /* 진동이 안 되는 기기 — skip */
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
