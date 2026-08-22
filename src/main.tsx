import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { initSentry } from './lib/sentry';
import { purgeBadAudioCaches } from './lib/swCache';
import { redirectToProductionIfNeeded } from './lib/productionRedirect';
import { isNativeApp, initNativeShell } from './lib/native';

// X6.26 — production 빌드 + srr-playlist.vercel.app 접속이면 www.deudda.com 으로
// 즉시 replace redirect. createRoot / SW / Sentry 호출 이전에 실행해 부분 상태 누락 방지.
// 네이티브 앱(Capacitor)은 localhost origin 이라 대상 아님이지만, 방어적으로 명시 가드.
if (!isNativeApp()) redirectToProductionIfNeeded();

// Capacitor 네이티브 쉘 초기화(상태바/스플래시/하드웨어 back). 웹에서는 no-op.
void initNativeShell();

// 0093 — Sentry 초기화 (DSN 없으면 silent skip, production 만 활성)
void initSentry();

// 과거 SW 가 오디오 Range 요청을 opaque 로 잘못 캐싱한 캐시를 시작 시 1회 정리(모바일 재생 복구).
void purgeBadAudioCaches();

// ============================================================================
// PWA Service Worker 등록 + 자동 갱신 감지
// ----------------------------------------------------------------------------
// 목적:
//   신규 배포 시 사용자가 Hard Refresh 하지 않아도 항상 최신 UI 를 받도록.
//   일반 브라우저 / Incognito / 모바일 / 설치된 PWA 모두 동일 동작.
//
// 갱신 감지 경로 (다중 안전망):
//   a) 명시적 register('/sw.js', { updateViaCache: 'none' })
//      → 브라우저의 SW 파일 24h 캐시 완전 우회 (RFC-9111 예외 처리).
//   b) 페이지 focus / visibilitychange / 60s interval 로 registration.update() 호출
//      → 사용자가 탭을 오래 열어두어도 갱신 감지.
//   c) 'updatefound' + newWorker 'statechange' 로 새 SW installed 감지 →
//      SKIP_WAITING postMessage → 즉시 activate 후 controllerchange 발화.
//   d) controllerchange 리스너 — build 당 1회 reload (sessionStorage 가드).
//   e) sw.ts activate 시 SW_ACTIVATED postMessage — c/d 가 lazy 한 환경 우회.
//
// 기존 로직 유지:
//   • BUILD_ID 기반 sessionStorage key → 배포마다 reload 1회 (무한 loop 방지)
//   • push / notificationclick handler (sw.ts) 무영향
//   • 오디오 runtimeCaching 미도입 유지
// ============================================================================
const BUILD_ID = (import.meta.env.VITE_BUILD_ID as string | undefined) ?? 'dev';
const SW_RELOAD_KEY = `sw-reloaded-${BUILD_ID}`;

// 네이티브 앱(Capacitor)에서는 SW 를 등록하지 않는다 — 로컬 번들을 Capacitor 가 직접
// 서빙하므로 SW precache/업데이트 리로드가 오히려 자산 로딩과 충돌한다. 웹/PWA 만 등록.
if (!isNativeApp() && typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  // (1) controllerchange — 새 SW 가 page control 잡으면 즉시 reload (build 당 1회)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (window.sessionStorage.getItem(SW_RELOAD_KEY)) return;
    window.sessionStorage.setItem(SW_RELOAD_KEY, '1');
    console.warn('[sw] controllerchange — reloading once for build', BUILD_ID);
    window.location.reload();
  });

  // (2) SW activate 시 보낸 push 메시지 — 같은 탭에 새 SW 가 들어왔음을 강제 통지
  //     (controllerchange 가 lazy 한 환경에서도 동작)
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type !== 'SW_ACTIVATED') return;
    const msgKey = `sw-msg-${e.data.buildId ?? BUILD_ID}`;
    if (window.sessionStorage.getItem(msgKey)) return;
    window.sessionStorage.setItem(msgKey, '1');
    console.warn('[sw] SW_ACTIVATED message — reloading once');
    window.location.reload();
  });

  // (3) 명시적 SW 등록 — updateViaCache:'none' 로 SW 파일 자체 24h 브라우저 캐시 우회.
  //     페이지 load 후 register → focus/visibility/interval 로 주기적 update().
  //     새 SW installed 감지 시 즉시 SKIP_WAITING → controllerchange → reload.
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((registration) => {
        console.info('[sw] registered', { scope: registration.scope, build: BUILD_ID });

        // 새 SW 감지 helper — installing worker 의 상태 변화 감시
        const watchInstalling = (worker: ServiceWorker | null): void => {
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              // 새 SW installed + 이미 controller 존재 → 대기중 SW 를 즉시 activate
              console.warn('[sw] new SW installed — sending SKIP_WAITING');
              worker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        };

        // 초기 상태에서 이미 waiting 이 있으면 즉시 activate
        if (registration.waiting) {
          console.warn('[sw] existing waiting worker on register — SKIP_WAITING');
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }

        // 이후 감지: updatefound 이벤트로 새 SW 설치 감시
        registration.addEventListener('updatefound', () => {
          watchInstalling(registration.installing);
        });

        // 주기적 update() — 사용자가 탭 오래 열어두어도 갱신 확인.
        const safeUpdate = (): void => {
          registration.update().catch((err) => {
            // 오프라인/네트워크 오류는 조용히 무시
            void err;
          });
        };

        // 페이지 focus 시 즉시 update
        window.addEventListener('focus', safeUpdate);
        // visibilitychange (탭 복귀) 시에도
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') safeUpdate();
        });
        // 60초 인터벌 — 오래 열린 탭 안전망
        window.setInterval(safeUpdate, 60_000);
        // 등록 직후 1회
        safeUpdate();
      })
      .catch((err) => {
        console.warn('[sw] registration failed', err);
      });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
