/// <reference lib="webworker" />
/**
 * DEUDDA Service Worker (injectManifest)
 *
 * - workbox precache 는 빌드 시 self.__WB_MANIFEST 로 inject 됨
 * - runtimeCaching 는 의도적으로 두지 않음 — 오디오 Range 요청을 SW 가
 *   가로채면 206 → opaque cache 깨짐 (모바일 재생 실패 원인이었음)
 * - push event handler 추가 — Web Push API 알림 표시
 * - notificationclick 으로 클릭 시 target URL 로 focus/openWindow
 */
import { precacheAndRoute } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope;

self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);

// 오래된 캐시 정리 (workbox 가 자동 처리는 하지만 명시)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith('workbox-') && !k.includes(self.registration.scope))
          .map((k) => caches.delete(k)),
      ),
    ),
  );
});

interface PushPayload {
  title: string;
  body?: string;
  icon?: string;
  badge?: string;
  url?: string;
  tag?: string;
}

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload: PushPayload;
  try {
    payload = event.data.json() as PushPayload;
  } catch {
    // 텍스트 payload 폴백
    payload = { title: event.data.text() || 'DEUDDA' };
  }
  const title = payload.title || 'DEUDDA';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body ?? '',
      icon: payload.icon ?? '/pwa-192x192.png',
      badge: payload.badge ?? '/favicon-32.png',
      data: { url: payload.url ?? '/' },
      tag: payload.tag ?? title,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl =
    (event.notification.data && (event.notification.data as { url?: string }).url) || '/';
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(async (clients) => {
        // 이미 열린 같은 origin 창이 있으면 focus + navigate
        for (const c of clients) {
          if ('focus' in c) {
            try {
              await (c as WindowClient).navigate(targetUrl);
              return (c as WindowClient).focus();
            } catch {
              return (c as WindowClient).focus();
            }
          }
        }
        // 없으면 새 창
        return self.clients.openWindow(targetUrl);
      }),
  );
});
