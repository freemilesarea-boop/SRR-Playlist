/**
 * nativeStatusBar.ts — 상태바를 앱 테마에 맞춘다.
 *
 * 예전에는 initNativeShell 이 다크로 고정했다(Style.Dark + #0a0a0a). 라이트 모드로 써도
 * 화면 위쪽만 시커멓게 남아서, 그 한 줄 때문에 "웹뷰를 띄운 것" 처럼 보였다.
 *
 * 색은 하드코딩하지 않고 문서에서 읽는다. 테마는 라이트/다크 말고도 시간대(timeslot)로
 * 한 번 더 갈리는데, 색을 여기에 또 적어두면 theme.css 와 갈라지기 때문이다.
 */
import { isNativeApp, nativePlatform } from '@/lib/native';

/** CSS 변수에 들어있는 "10 10 10" 같은 rgb 3원소를 #rrggbb 로. 못 읽으면 null. */
export function rgbTripletToHex(triplet: string): string | null {
  const parts = triplet.trim().split(/[\s,]+/).filter(Boolean);
  if (parts.length !== 3) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
  return `#${nums.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Capacitor StatusBar 의 Style 이름은 "글자색" 이 아니라 "배경이 어둡다/밝다" 를 뜻한다.
 * 앱 테마가 dark 면 배경이 어두우므로 Dark, light 면 Light. (여기서 자주 헷갈린다.)
 */
export function statusBarStyleNameFor(theme: string | undefined): 'Dark' | 'Light' {
  return theme === 'light' ? 'Light' : 'Dark';
}

/** 지금 문서에 적용된 배경색. 못 읽으면 null. */
export function readThemeBackgroundHex(): string | null {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return null;
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--color-bg');
    return v ? rgbTripletToHex(v) : null;
  } catch {
    return null;
  }
}

/** 지금 테마에 맞춰 상태바를 갱신한다. 웹에서는 아무 것도 하지 않는다. */
export async function syncNativeStatusBar(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    const theme = document.documentElement.dataset.theme;
    await StatusBar.setStyle({ style: Style[statusBarStyleNameFor(theme)] });
    // 배경색은 안드로이드만 설정할 수 있다(iOS 는 상태바 배경이 없다).
    if (nativePlatform() === 'android') {
      const hex = readThemeBackgroundHex();
      if (hex) await StatusBar.setBackgroundColor({ color: hex });
    }
  } catch {
    /* 플러그인 미탑재 환경 — 상태바 때문에 부팅을 막지는 않는다 */
  }
}
