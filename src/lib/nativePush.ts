/**
 * nativePush.ts — 네이티브 앱(iOS/Android) 푸시 알림.
 *
 * 앱은 Service Worker 를 등록하지 않으므로 Web Push 를 쓸 수 없다.
 * 대신 OS 푸시를 쓴다:
 *   • Android → FCM 등록 토큰
 *   • iOS     → APNs 디바이스 토큰
 * 서버(send-push)가 토큰의 platform 을 보고 전송 경로를 고른다.
 *
 * 토큰은 `save_device_push_token` RPC 로 저장한다. 같은 기기에서 계정을 바꾸면
 * 토큰의 주인이 옮겨간다(이전 사용자에게 알림이 계속 가지 않도록).
 *
 * 알림 탭 → payload 의 url 로 라우팅. 딥링크 스킴이 아니라 앱 내부 경로다.
 */
import { supabase } from '@/lib/supabase';
import { isNativeApp, nativePlatform } from '@/lib/native';

/** 네이티브 푸시 권한 상태 — Web Push 의 NotificationPermission 과 같은 어휘를 쓴다. */
export type NativePushPermission = 'granted' | 'denied' | 'default';

export interface NativePushState {
  supported: boolean;
  permission: NativePushPermission;
  /** 서버에 토큰이 저장됨 */
  registered: boolean;
  token: string | null;
  error: string | null;
}

/** 이 실행 환경에서 네이티브 푸시를 쓸 수 있는지. */
export function nativePushSupported(): boolean {
  const p = nativePlatform();
  return isNativeApp() && (p === 'ios' || p === 'android');
}

function platformOrNull(): 'ios' | 'android' | null {
  const p = nativePlatform();
  return p === 'ios' || p === 'android' ? p : null;
}

/**
 * Capacitor 플러그인 동적 로드 — 웹 번들 초기 로드에 끼지 않도록.
 *
 * 반드시 객체에 담아서 돌려준다. 플러그인을 async 함수에서 그대로 반환하면
 * 앱에서 푸시가 통째로 죽는다. 이유는 이렇다:
 *
 *   Capacitor 플러그인은 Proxy 다. 어떤 속성을 읽든 "네이티브 메서드" 로 간주하고
 *   호출을 넘긴다. 그래서 `.then` 도 함수처럼 보인다.
 *   자바스크립트는 Promise 를 resolve 할 때 그 값이 thenable 이면 한 번 더 풀려고
 *   `.then()` 을 부른다. 즉 `return mod.PushNotifications` 는
 *   `PushNotifications.then()` 이라는 존재하지 않는 네이티브 호출이 되고,
 *   안드로이드가 "not implemented" 로 거절한다.
 *
 * 증상이 고약하다 — 호출부가 전부 try/catch 로 감싸고 있어서 조용히 실패한다.
 * 권한 조회는 'default' 를, 등록은 error 를 돌려주므로 화면상으로는 "아직 안 켰네"
 * 와 구분이 안 된다. 서버 자격증명을 아무리 맞춰도 토큰 자체가 만들어지지 않는다.
 */
async function loadPlugin() {
  const mod = await import('@capacitor/push-notifications');
  return { push: mod.PushNotifications };
}

/** Capacitor 의 권한 상태를 Web Push 어휘로 정규화. */
export function normalizePermission(receive: string): NativePushPermission {
  if (receive === 'granted') return 'granted';
  if (receive === 'denied') return 'denied';
  return 'default'; // 'prompt' | 'prompt-with-rationale'
}

/** 현재 권한 상태만 조회(요청하지 않음). */
export async function checkNativePushPermission(): Promise<NativePushPermission> {
  if (!nativePushSupported()) return 'default';
  try {
    const { push: PushNotifications } = await loadPlugin();
    const s = await PushNotifications.checkPermissions();
    return normalizePermission(s.receive);
  } catch {
    return 'default';
  }
}

async function saveToken(token: string): Promise<void> {
  const platform = platformOrNull();
  if (!platform) return;
  const { error } = await supabase.rpc('save_device_push_token', {
    p_token: token,
    p_platform: platform,
    p_device_model: navigator.userAgent.slice(0, 120),
    p_app_version: import.meta.env.VITE_APP_VERSION ?? null,
  });
  if (error) throw error;
}

/**
 * 권한 요청 → OS 등록 → 토큰 저장.
 * 등록 결과는 'registration' / 'registrationError' 이벤트로 비동기 도착하므로
 * 여기서 한 번 감싸 기다린다(최대 15초 — 그 이상은 기기/네트워크 문제).
 */
export async function enableNativePush(): Promise<{ ok: boolean; token?: string; error?: string }> {
  if (!nativePushSupported()) return { ok: false, error: 'not_native' };
  try {
    const { push: PushNotifications } = await loadPlugin();

    const perm = await PushNotifications.requestPermissions();
    if (normalizePermission(perm.receive) !== 'granted') {
      return { ok: false, error: 'permission_denied' };
    }

    const token = await new Promise<string>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('registration_timeout')), 15_000);
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        fn();
      };
      void PushNotifications.addListener('registration', (t) => finish(() => resolve(t.value)));
      void PushNotifications.addListener('registrationError', (e) =>
        finish(() => reject(new Error(typeof e?.error === 'string' ? e.error : 'registration_error'))),
      );
      void PushNotifications.register();
    });

    await saveToken(token);
    return { ok: true, token };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 서버에서 이 기기 토큰 제거 + OS 등록 해제. */
export async function disableNativePush(token: string | null): Promise<boolean> {
  if (!nativePushSupported()) return false;
  try {
    if (token) {
      const { error } = await supabase.rpc('delete_device_push_token', { p_token: token });
      if (error) throw error;
    }
    const { push: PushNotifications } = await loadPlugin();
    await PushNotifications.unregister();
    return true;
  } catch {
    return false;
  }
}

/**
 * 알림 탭 처리 — payload 의 url 로 앱 내부 라우팅.
 * App.tsx 에서 라우터 navigate 를 넘겨 한 번만 연결한다(웹에서는 no-op).
 */
let tapBound = false;

export async function initNativePushRouting(navigate: (path: string) => void): Promise<void> {
  if (!nativePushSupported() || tapBound) return;
  tapBound = true;
  try {
    const { push: PushNotifications } = await loadPlugin();
    await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const data = action.notification?.data as Record<string, unknown> | undefined;
      const url = typeof data?.url === 'string' ? data.url : '/';
      navigate(safeInAppPath(url));
    });
  } catch {
    tapBound = false;
  }
}

/**
 * 알림 payload 의 url 을 앱 내부 경로로만 제한한다.
 * 외부 URL 이나 스킴이 오면 홈으로 — 알림 payload 를 신뢰해 임의 위치로 보내지 않는다.
 */
export function safeInAppPath(url: string): string {
  if (!url || typeof url !== 'string') return '/';
  // '//host' 는 프로토콜 상대 URL — 외부로 나간다.
  if (!url.startsWith('/') || url.startsWith('//')) return '/';
  return url;
}
