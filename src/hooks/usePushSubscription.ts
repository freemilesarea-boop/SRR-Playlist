import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/authStore';

interface PushStatus {
  /** 브라우저가 Notification + ServiceWorker + PushManager 지원하는지 */
  supported: boolean;
  /** 현재 알림 권한 — granted / denied / default(prompt 필요) */
  permission: NotificationPermission;
  /** 활성 구독 존재 여부 */
  subscribed: boolean;
  /** 작업 중 (subscribe / unsubscribe) */
  busy: boolean;
  /** 에러 메시지 */
  error: string | null;
}

/**
 * Web Push 구독 관리 — DEUDDA D8 인프라.
 *
 * - subscribe(): 권한 요청 → PushManager.subscribe → save_push_subscription RPC
 * - unsubscribe(): subscription.unsubscribe + delete_push_subscription RPC
 * - 미지원 브라우저(iOS Safari, FF private 등)는 supported=false
 *
 * VAPID public key 는 VITE_VAPID_PUBLIC_KEY 환경변수에서 읽음. 미설정 시 supported=false.
 */
export function usePushSubscription() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [status, setStatus] = useState<PushStatus>(() => ({
    supported: false,
    permission: 'default',
    subscribed: false,
    busy: false,
    error: null,
  }));

  // 마운트 시 지원 여부 + 현재 구독 상태 점검
  useEffect(() => {
    const vapidPub = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
    const supported =
      typeof window !== 'undefined' &&
      'Notification' in window &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      !!vapidPub;

    if (!supported) {
      setStatus((s) => ({ ...s, supported: false }));
      return;
    }

    let alive = true;
    (async () => {
      const permission = Notification.permission;
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!alive) return;
        setStatus({
          supported: true,
          permission,
          subscribed: !!sub,
          busy: false,
          error: null,
        });
      } catch (e) {
        if (!alive) return;
        setStatus({
          supported: true,
          permission,
          subscribed: false,
          busy: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function subscribe(): Promise<boolean> {
    if (!status.supported || !userId) return false;
    setStatus((s) => ({ ...s, busy: true, error: null }));
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setStatus((s) => ({ ...s, permission: perm, busy: false }));
        return false;
      }
      const vapidPub = import.meta.env.VITE_VAPID_PUBLIC_KEY as string;
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        // applicationServerKey 는 Uint8Array 또는 ArrayBuffer 받음 — buffer 캐스팅으로 dom lib 타입 호환
        const keyBytes = urlBase64ToUint8Array(vapidPub);
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes.buffer as ArrayBuffer,
        });
      }
      const json = sub.toJSON();
      const { error } = await supabase.rpc('save_push_subscription', {
        p_endpoint: sub.endpoint,
        p_p256dh: json.keys?.p256dh ?? '',
        p_auth: json.keys?.auth ?? '',
        p_user_agent: navigator.userAgent.slice(0, 200),
      });
      if (error) throw error;
      setStatus({ supported: true, permission: 'granted', subscribed: true, busy: false, error: null });
      return true;
    } catch (e) {
      setStatus((s) => ({ ...s, busy: false, error: e instanceof Error ? e.message : String(e) }));
      return false;
    }
  }

  async function unsubscribe(): Promise<boolean> {
    if (!status.supported) return false;
    setStatus((s) => ({ ...s, busy: true, error: null }));
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        await supabase.rpc('delete_push_subscription', { p_endpoint: sub.endpoint });
      }
      setStatus((s) => ({ ...s, subscribed: false, busy: false }));
      return true;
    } catch (e) {
      setStatus((s) => ({ ...s, busy: false, error: e instanceof Error ? e.message : String(e) }));
      return false;
    }
  }

  return { ...status, subscribe, unsubscribe };
}

/** VAPID URL-safe base64 → Uint8Array (Web Push 표준) */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
