/**
 * screenAwake.ts — 화면 꺼짐 방지 드라이버 선택 (웹 / 네이티브 공통).
 *
 * 매장·브랜드 플레이어는 기기를 켜둔 채 24시간 돌아간다. 화면이 꺼지면 WebView 가
 * 스로틀되어 재생이 끊기므로, 실행 환경에서 가능한 최선의 수단을 고른다.
 *
 *   • 네이티브 쉘(iOS/Android) → @capacitor-community/keep-awake
 *       iOS WKWebView 는 Screen Wake Lock API(navigator.wakeLock) 를 제공하지 않는다.
 *       네이티브 플러그인만이 화면을 켜둘 수 있으므로 네이티브에서는 이쪽을 우선한다.
 *   • 웹 / PWA → navigator.wakeLock (Screen Wake Lock API)
 *   • 둘 다 없으면 unsupported → UI 가 "기기 자동 잠금을 꺼주세요" 로 안내.
 *
 * 플러그인 로드는 동적 import — 웹 번들 초기 로드에 네이티브 코드가 끼지 않는다.
 */
import { isNativeApp } from '@/lib/native';

export type ScreenAwakeMode = 'native' | 'web' | 'unsupported';

/** 획득한 wake lock 하나. release() 는 여러 번 불려도 안전(멱등). */
export interface ScreenAwakeHandle {
  mode: Exclude<ScreenAwakeMode, 'unsupported'>;
  release: () => Promise<void>;
  /** 웹 모드에서 OS/브라우저가 lock 을 스스로 해제했을 때 알림(네이티브는 미사용). */
  onLost: (cb: () => void) => void;
}

/**
 * 실행 환경 → 사용할 드라이버. 순수 함수(테스트 대상).
 * 네이티브가 우선인 이유: Android WebView 는 wakeLock 이 있을 수도 있지만,
 * 앱 생명주기(백그라운드 복귀)와 함께 다루려면 플러그인이 일관적이다.
 */
export function pickScreenAwakeMode(env: { native: boolean; hasWakeLockApi: boolean }): ScreenAwakeMode {
  if (env.native) return 'native';
  return env.hasWakeLockApi ? 'web' : 'unsupported';
}

/** 현재 런타임의 Screen Wake Lock API 지원 여부. */
export function hasWakeLockApi(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator && !!navigator.wakeLock;
}

/** 현재 런타임에서 화면 꺼짐 방지가 가능한지(= unsupported 가 아닌지). */
export function screenAwakeMode(): ScreenAwakeMode {
  return pickScreenAwakeMode({ native: isNativeApp(), hasWakeLockApi: hasWakeLockApi() });
}

/**
 * 화면 꺼짐 방지 획득. 실패하면 null (호출부는 조용히 '대기' 상태로 둔다).
 * 네이티브 플러그인 로드/호출이 실패하면 웹 API 로 한 번 폴백한다.
 */
export async function acquireScreenAwake(): Promise<ScreenAwakeHandle | null> {
  const mode = screenAwakeMode();

  if (mode === 'native') {
    const handle = await acquireNative();
    if (handle) return handle;
    // 플러그인 미탑재(예: cap sync 전) → 웹 API 가 있으면 그걸로라도 버틴다.
    return hasWakeLockApi() ? acquireWeb() : null;
  }
  if (mode === 'web') return acquireWeb();
  return null;
}

async function acquireNative(): Promise<ScreenAwakeHandle | null> {
  try {
    const { KeepAwake } = await import('@capacitor-community/keep-awake');
    const { isSupported } = await KeepAwake.isSupported();
    if (!isSupported) return null;
    await KeepAwake.keepAwake();
    let released = false;
    return {
      mode: 'native',
      release: async () => {
        if (released) return;
        released = true;
        try {
          await KeepAwake.allowSleep();
        } catch {
          /* 이미 해제됨 — noop */
        }
      },
      onLost: () => {
        /* 네이티브는 OS 가 임의로 풀지 않는다 — 구독 불필요 */
      },
    };
  } catch {
    return null;
  }
}

async function acquireWeb(): Promise<ScreenAwakeHandle | null> {
  try {
    const sentinel = await navigator.wakeLock!.request('screen');
    let released = false;
    return {
      mode: 'web',
      release: async () => {
        if (released) return;
        released = true;
        try {
          await sentinel.release();
        } catch {
          /* noop */
        }
      },
      onLost: (cb) => sentinel.addEventListener('release', cb),
    };
  } catch {
    // 권한 거부 / 비활성 탭 / 배터리 절약 모드 등 — 조용히 실패
    return null;
  }
}
