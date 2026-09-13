/**
 * storePlaybackService.ts — 안드로이드 백그라운드 재생 유지(포그라운드 서비스) 제어.
 *
 * 왜 필요한가: 안드로이드는 백그라운드 프로세스의 오디오를 언제든 중단시킨다
 * (메모리 압박 · Doze). mediaPlayback 포그라운드 서비스가 떠 있으면 프로세스가
 * 보호되어 화면이 꺼지거나 앱이 백그라운드로 가도 WebView 재생이 이어진다.
 *
 * 소리는 그대로 WebView 의 <audio> 가 낸다 — 서비스는 프로세스를 살려두는 역할만 하며
 * 오디오 파이프라인을 건드리지 않는다.
 *
 * iOS 는 이 서비스가 필요 없다: AppDelegate 의 AVAudioSession `.playback` +
 * Info.plist `UIBackgroundModes: audio` 로 OS 가 백그라운드 재생을 보장한다.
 * 웹/PWA 는 브라우저 탭이 살아 있는 동안만 재생되며 여기서 할 수 있는 일이 없다.
 */
import { registerPlugin } from '@capacitor/core';
import { isNativeApp, nativePlatform } from '@/lib/native';

interface StorePlaybackServicePlugin {
  start(options: { title?: string; text?: string }): Promise<void>;
  stop(): Promise<void>;
}

const Native = registerPlugin<StorePlaybackServicePlugin>('StorePlaybackService');

/** 이 실행 환경에서 포그라운드 서비스를 쓸 수 있는지(= 안드로이드 네이티브). */
export function backgroundPlaybackServiceSupported(): boolean {
  return isNativeApp() && nativePlatform() === 'android';
}

/**
 * 매장 재생 중 백그라운드 유지가 필요한 상태인지.
 *
 * 켜는 조건을 매장/브랜드 모드 + 재생 중으로 한정한다. 개인 감상까지 상시
 * 알림을 띄우면 사용자에게 불필요한 상태바 알림이 남는다.
 */
export function shouldKeepAlive(opts: { storeMode: boolean; playing: boolean }): boolean {
  return opts.storeMode && opts.playing;
}

let running = false;

/** 현재 서비스가 떠 있는지(테스트/진단용). */
export function isKeepAliveRunning(): boolean {
  return running;
}

/**
 * 필요한 상태로 맞춘다. 중복 호출은 무시되므로 렌더마다 불려도 안전하다.
 * 실패는 조용히 무시 — 서비스가 없어도 포그라운드 재생은 그대로 동작한다.
 */
export async function syncBackgroundPlayback(desired: boolean, label?: { title?: string; text?: string }): Promise<void> {
  if (!backgroundPlaybackServiceSupported()) return;
  if (desired === running) return;
  try {
    if (desired) {
      await Native.start({
        title: label?.title ?? '매장 음악 재생 중',
        text: label?.text ?? '앱을 닫아도 재생이 계속됩니다.',
      });
    } else {
      await Native.stop();
    }
    running = desired;
  } catch {
    // 플러그인 미탑재(cap sync 전) 등 — 재생 자체에는 영향 없음.
  }
}
