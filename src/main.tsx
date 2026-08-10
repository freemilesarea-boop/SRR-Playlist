import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { initSentry, captureServiceWorkerRecovery } from './lib/sentry';
import { purgeBadAudioCaches } from './lib/swCache';
import { redirectToProductionIfNeeded } from './lib/productionRedirect';
import RootErrorBoundary from './components/RootErrorBoundary';
import { BUILD_ID, SW_RELOAD_KEY, RECOVERY_LOG_KEY, shouldReloadForUpdatedSw, shouldRunOnce } from './lib/bootRecovery';

// X6.26 — production 빌드 + srr-playlist.vercel.app 접속이면 www.deudda.com 으로
// 즉시 replace redirect. createRoot / SW / Sentry 호출 이전에 실행해 부분 상태 누락 방지.
redirectToProductionIfNeeded();

// 0093 — Sentry 초기화 (DSN 없으면 silent skip, production 만 활성)
void initSentry();

// WEB-OPT-2 — index.html watchdog 이 남긴 긴급 복구 로그가 있으면 이번 로드에서 1회 Sentry 보고 후 정리.
// (watchdog 은 bundle/Sentry 로드 전에 실행되므로, 복구 후 재부팅 시점에 여기서 보고한다.)
try {
  const raw = window.sessionStorage.getItem(RECOVERY_LOG_KEY);
  if (raw) {
    window.sessionStorage.removeItem(RECOVERY_LOG_KEY);
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(raw) as Record<string, unknown>; } catch { payload = { raw_parse_failed: true }; }
    void captureServiceWorkerRecovery(payload);
  }
} catch { /* noop */ }

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
// WEB-OPT-2 — reload 가드 통합:
//   • controllerchange 와 SW_ACTIVATED 가 "동일한" build 스코프 키(SW_RELOAD_KEY)를 공유
//     → 한 activation 에서 최대 1회만 reload (2~3회 연쇄 reload 방지).
//   • 최초 방문(controller 없던 상태의 clientsClaim)에서는 reload 안 함(불필요한 첫방문 reload 방지).
//   • 새 배포(새 BUILD_ID)면 키가 자동 소멸 → 복구 재시도 가능. 같은 build 무한 reload 없음.
//   • push / notificationclick / 오디오 runtimeCaching 정책은 무변경.
// ============================================================================
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  // 페이지 로드 시점에 이미 controller 가 있었는지 — 첫방문 clientsClaim reload 를 구분하기 위함.
  const hadInitialController = !!navigator.serviceWorker.controller;

  const reloadForUpdatedSw = (source: string): void => {
    const alreadyReloaded = !shouldRunOnce(window.sessionStorage.getItem(SW_RELOAD_KEY));
    if (!shouldReloadForUpdatedSw({ hadInitialController, alreadyReloaded })) return;
    window.sessionStorage.setItem(SW_RELOAD_KEY, '1');
    console.warn('[sw] reloading once for build', BUILD_ID, '(', source, ')');
    window.location.reload();
  };

  // (1) controllerchange — 새 SW 가 page control 을 잡음 (기존 controller 가 있던 경우만 reload)
  navigator.serviceWorker.addEventListener('controllerchange', () => reloadForUpdatedSw('controllerchange'));

  // (2) SW activate 시 보낸 메시지 — 같은 탭에 새 SW 통지 (controllerchange 가 lazy 한 환경 우회).
  //     동일 SW_RELOAD_KEY 공유 → controllerchange 와 합쳐 최대 1회.
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type !== 'SW_ACTIVATED') return;
    reloadForUpdatedSw('sw-activated');
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
    <RootErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </RootErrorBoundary>
  </StrictMode>,
);
