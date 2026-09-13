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

/* ────────────────────────────────────────────────────────────────────────── */
/* HARDENING-13 — 네이티브 상태 조회 · 원격 APP_RESTART · 배터리 최적화 안내      */
/* ────────────────────────────────────────────────────────────────────────── */

/** 이 클라이언트가 무엇으로 돌고 있는가. UA 가 아니라 런타임으로 판단한다. */
export type PlayerRuntime = 'android_native' | 'ios_native' | 'pwa' | 'web';

/** 네이티브가 보고하는 상태. 개인정보·기기 시리얼·광고 ID 는 담지 않는다. */
export interface NativeHealth {
  runtime: 'android_native';
  androidSdk: number;
  androidRelease: string;
  serviceRunning: boolean;
  /** Activity 객체가 존재하는가 (onCreate ~ onDestroy). */
  activityAlive: boolean;
  /** 화면에 떠 있는가. **워치독 판단에는 쓰지 않는다** — 표시용이다. */
  activityForeground: boolean;
  /** JS 하트비트가 끊긴 시간(ms). 아직 한 번도 못 받았으면 -1. */
  webHeartbeatSilentForMs: number;
  /** 소리가 끊긴 시간(ms). 아직 한 번도 못 들었으면 -1. */
  audibleSilentForMs: number;
  batteryOptimizationIgnored: boolean;
  appVersion: string | null;
  appBuild: number;
}

interface NativeExtra {
  heartbeat(options: { audible: boolean }): Promise<void>;
  restartApp(): Promise<{ started: boolean }>;
  health(): Promise<NativeHealth>;
  openBatteryOptimizationSettings(): Promise<void>;
}

const NativeExt = Native as unknown as StorePlaybackServicePlugin & NativeExtra;

/**
 * 실행 런타임 판정.
 *
 * standalone 판정은 호출부가 넘긴다 — 이 모듈이 DOM/matchMedia 에 의존하지 않게
 * 하기 위해서다(테스트 가능성). 네이티브 여부만 여기서 직접 본다.
 */
export function resolvePlayerRuntime(standalone: boolean): PlayerRuntime {
  if (isNativeApp()) {
    return nativePlatform() === 'android' ? 'android_native' : 'ios_native';
  }
  return standalone ? 'pwa' : 'web';
}

/**
 * 네이티브 워치독에 "WebView 가 살아 있다" 를 알린다.
 *
 * 이 신호가 없으면 네이티브는 백그라운드와 사망을 구분할 수 없고, 점주가 다른 앱을
 * 오래 쓰는 것만으로 듣다를 강제로 띄우게 된다. 실패는 조용히 무시한다 —
 * 하트비트 실패가 재생을 막으면 안 된다.
 */
export async function sendNativeHeartbeat(audible: boolean): Promise<void> {
  if (!backgroundPlaybackServiceSupported()) return;
  try { await NativeExt.heartbeat({ audible }); } catch { /* noop */ }
}

/**
 * 원격 APP_RESTART — **WebView/Activity 재생성**이다. 기기 재부팅이 아니다.
 * 네이티브 안드로이드가 아니면 실행하지 않고 false 를 준다.
 */
export async function restartNativeApp(): Promise<boolean> {
  if (!backgroundPlaybackServiceSupported()) return false;
  try {
    const res = await NativeExt.restartApp();
    return res?.started === true;
  } catch {
    return false;
  }
}

/** 네이티브 상태. 네이티브가 아니거나 조회 실패면 null. */
export async function readNativeHealth(): Promise<NativeHealth | null> {
  if (!backgroundPlaybackServiceSupported()) return null;
  try {
    return await NativeExt.health();
  } catch {
    return null;
  }
}

/**
 * 배터리 최적화 설정 화면으로 **안내만** 한다.
 * 자동 예외 요청은 하지 않는다 — 무엇을 허용하는지 보고 사람이 결정한다.
 */
export async function openBatteryOptimizationSettings(): Promise<void> {
  if (!backgroundPlaybackServiceSupported()) return;
  try { await NativeExt.openBatteryOptimizationSettings(); } catch { /* noop */ }
}
