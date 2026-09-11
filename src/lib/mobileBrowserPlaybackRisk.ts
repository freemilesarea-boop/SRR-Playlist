/**
 * mobileBrowserPlaybackRisk.ts — 이 기기로 매장 음악을 24시간 돌려도 되는지 판정.
 *
 * 왜 필요한가 — 숙대점(2026-09-11) 사례:
 *   10:58 까지 PC(삼성브라우저)로 재생 → 11:22 폰(Android Chrome)으로 갈아탐
 *   → 12:13 page_hidden(화면 끔/다른 앱) → 15:05 하트비트 완전 중단 → 15:25 offline 경보.
 *   백그라운드에서 2시간 50분 버티다 죽었다. **이게 웹 코드의 한계치다.**
 *
 * 왜 폰 브라우저는 못 버티나:
 *   • 브라우저는 포그라운드 서비스를 못 띄운다. 안드로이드가 백그라운드 탭을
 *     freeze/discard 하면 backgroundTicker 의 Web Worker 타이머도 같이 죽는다.
 *   • navigator.wakeLock 은 탭이 visible 일 때만 유지된다. page_hidden 이면 자동 해제.
 *   네이티브 쉘에는 StorePlaybackService(foregroundServiceType=mediaPlayback) 가 있어
 *   프로세스가 보호되지만, 웹에는 그에 상응하는 수단이 아예 없다.
 *
 * 그래서 끊김 자체를 웹에서 막을 수는 없다. 대신 **모르고 폰으로 틀어두는 것**을 막는다.
 * 이 모듈은 판정만 하고(순수 함수), 경고 UI 는 MobileBrowserPlaybackWarning 이 그린다.
 */

/** 매장 재생 기기 등급. */
export type PlaybackDeviceRisk =
  /** 네이티브 앱 — 포그라운드 서비스로 보호됨. 화면이 꺼져도 이어진다. */
  | 'native_app'
  /** PC 브라우저 — 창을 열어두면 안정적. 숙대점도 PC 구간에서는 끊기지 않았다. */
  | 'desktop_browser'
  /** 폰/태블릿 브라우저 — 백그라운드 전환 시 중단 위험. 경고 대상. */
  | 'mobile_browser';

/**
 * 모바일 브라우저를 가리키는 UA 토큰.
 * iPadOS 사파리는 데스크톱 UA(Macintosh)로 위장하므로 hasTouch 로 따로 잡는다.
 */
const MOBILE_UA = /Android|iPhone|iPad|iPod|Windows Phone|Mobile Safari|SamsungBrowser.*Mobile/i;

export interface PlaybackDeviceEnv {
  /** Capacitor 네이티브 쉘 안에서 실행 중인지 (isNativeApp()). */
  native: boolean;
  /** navigator.userAgent. */
  userAgent: string;
  /**
   * 터치 지원 여부. iPadOS 사파리가 Macintosh UA 로 위장하는 경우를 잡는 데만 쓴다.
   * 터치 지원 노트북(Windows)을 모바일로 오판하지 않도록 Macintosh 일 때만 본다.
   */
  hasTouch?: boolean;
}

/**
 * 실행 환경 → 기기 등급. 순수 함수(테스트 대상).
 *
 * 네이티브를 가장 먼저 본다 — Capacitor WebView 의 UA 에도 'Android' 가 들어 있어서
 * UA 를 먼저 보면 앱을 모바일 브라우저로 오판한다.
 */
export function assessPlaybackDeviceRisk(env: PlaybackDeviceEnv): PlaybackDeviceRisk {
  if (env.native) return 'native_app';

  const ua = env.userAgent ?? '';
  if (MOBILE_UA.test(ua)) return 'mobile_browser';

  // iPadOS 13+ 사파리: "Macintosh" 로 보고하지만 터치가 된다.
  if (/Macintosh/.test(ua) && env.hasTouch) return 'mobile_browser';

  return 'desktop_browser';
}

/** 현재 런타임 기준 판정. 브라우저 API 접근은 여기서만 한다(위 함수는 순수 유지). */
export function currentPlaybackDeviceRisk(native: boolean): PlaybackDeviceRisk {
  if (typeof navigator === 'undefined') return 'desktop_browser';
  return assessPlaybackDeviceRisk({
    native,
    userAgent: navigator.userAgent,
    hasTouch: typeof document !== 'undefined' && 'ontouchend' in document,
  });
}

/** 경고를 띄워야 하는 상태인지. */
export function shouldWarnMobileBrowser(risk: PlaybackDeviceRisk): boolean {
  return risk === 'mobile_browser';
}
