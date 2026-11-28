/**
 * gestureReloadPolicy.ts — 이 기기에서 페이지를 새로 띄우면 소리가 막히는가.
 *
 * 2026-11-27 이루밍(아이폰 홈 화면 웹앱): 배포 후 플레이어가 스스로 새로고침했고,
 * 아이폰은 새로 뜬 페이지가 **터치 없이** 소리 내는 것을 막아 약 23시간 무음이었다.
 * 다음 날 직원이 화면을 눌렀을 때도 자동 복구가 "오래 멈춰 있었다" 며 또 새로고침해서
 * 다시 막혔다("2~3초 나오고 끊긴다").
 *
 * iPhone/iPad 의 Safari·홈 화면 웹앱(WebKit)은 문서마다 사용자 제스처를 요구한다.
 * 이전 문서에서 소리가 났다는 사실은 새 문서로 넘어가지 않는다 — 그래서 이 기기에서는
 * "제스처 없이 재생됐다" 는 관측을 자동재생 권한의 증거로 쓸 수 없다.
 *
 * 네이티브 앱(Capacitor iOS)은 WKWebView 가 mediaTypesRequiringUserActionForPlayback=[] 로
 * 떠서 터치 없이 재생된다 — 그래서 여기서 false 다.
 */
import { isNativeApp } from '@/lib/native';

export interface GestureEnv {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  native: boolean;
}

function currentEnv(): GestureEnv {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  return {
    userAgent: nav?.userAgent ?? '',
    platform: nav?.platform,
    maxTouchPoints: nav?.maxTouchPoints,
    native: isNativeApp(),
  };
}

/** iPhone/iPad/iPod 의 웹(브라우저·홈 화면 웹앱)인가. iPadOS 13+ 의 'MacIntel' 위장도 잡는다. */
export function isIOSWeb(env: GestureEnv = currentEnv()): boolean {
  if (env.native) return false;
  if (/iPad|iPhone|iPod/.test(env.userAgent)) return true;
  return env.platform === 'MacIntel' && (env.maxTouchPoints ?? 0) > 1;
}

/**
 * 페이지를 새로 띄우면 터치 없이는 소리가 다시 나지 않는 기기인가.
 * true 면 자동 업데이트 새로고침·자동 복구 새로고침을 하지 않는다 —
 * 같은 문서를 살려 두는 것이 무인 매장에서 소리를 지키는 유일한 방법이다.
 */
export function reloadLosesAutoplay(env: GestureEnv = currentEnv()): boolean {
  return isIOSWeb(env);
}
