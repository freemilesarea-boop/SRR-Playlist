/// <reference lib="webworker" />
/**
 * DEUDDA Service Worker (injectManifest)
 *
 * 갱신 전략 (Auth UX QA 이후 강화):
 *   • module-level skipWaiting + clientsClaim → 즉시 대기 없이 활성
 *   • message SKIP_WAITING → main.tsx 가 새 SW installed 감지 시 강제 activate
 *   • activate 시 workbox-precache-v2 만 유지 (구 precache 전부 삭제)
 *   • activate 후 SW_ACTIVATED postMessage → 열린 탭 강제 reload
 *
 * 유지:
 *   • workbox precache — 빌드 시 self.__WB_MANIFEST 로 inject
 *   • runtimeCaching 없음 — 오디오 Range 요청 가로채기 방지 (206 → opaque 방지)
 *   • push handler + notificationclick handler
 */
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope;

self.skipWaiting();
clientsClaim();

// 이전 workbox 버전에서 남은 오래된 precache 항목을 자동 정리.
// workbox 는 revision 이 바뀐 파일은 자연히 갱신하지만, 삭제된 파일 항목은 남을 수 있음.
cleanupOutdatedCaches();

precacheAndRoute(self.__WB_MANIFEST);

// 빌드 시점 inject — main.tsx 의 SW_RELOAD_KEY 와 일치하는 BUILD_ID.
// import.meta.env 는 SW 컨텍스트에서도 vite define 으로 inject 됨.
declare const __SW_BUILD_ID__: string | undefined;

// main.tsx 의 updatefound → SKIP_WAITING 메시지로 대기중 SW 즉시 활성화.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

// activate — 오래된 캐시 정리 + 모든 window client 에 활성화 알림.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 현재 SW 가 관리하는 workbox precache 이름 (workbox 는 scope 별로 이름 부여)
    // 그 외 workbox- prefix 캐시는 이전 SW/빌드 유물 → 삭제.
    const currentScope = self.registration.scope;
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith('workbox-') && !k.includes(currentScope))
        .map((k) => caches.delete(k)),
    );
    // clientsClaim 은 module-level 이미 호출됐지만, activate 사이클 보장 위해 한 번 더.
    await self.clients.claim();
    // 새 SW activate 직후 모든 열린 탭에 통지 — main.tsx 가 받아서 1회 reload
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const buildId = typeof __SW_BUILD_ID__ === 'string' ? __SW_BUILD_ID__ : Date.now().toString(36);
    for (const c of windows) {
      c.postMessage({ type: 'SW_ACTIVATED', buildId });
    }
  })());
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
