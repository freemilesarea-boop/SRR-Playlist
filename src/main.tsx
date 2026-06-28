import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { initSentry } from './lib/sentry';
import { purgeBadAudioCaches } from './lib/swCache';
import { redirectToProductionIfNeeded } from './lib/productionRedirect';

// X6.26 — production 빌드 + srr-playlist.vercel.app 접속이면 www.deudda.com 으로
// 즉시 replace redirect. createRoot / SW / Sentry 호출 이전에 실행해 부분 상태 누락 방지.
redirectToProductionIfNeeded();

// 0093 — Sentry 초기화 (DSN 없으면 silent skip, production 만 활성)
void initSentry();

// 과거 SW 가 오디오 Range 요청을 opaque 로 잘못 캐싱한 캐시를 시작 시 1회 정리(모바일 재생 복구).
void purgeBadAudioCaches();

// PWA 새 SW 가 활성화되면 같은 탭의 옛 chunk 를 우회하도록 1회 reload.
// sessionStorage key 에 BUILD_ID 를 포함 → 배포마다 reload 1회 보장
// (이전 단순 'sw-reloaded' 키는 이전 배포의 reload 이후 영구 set → 새 배포의
//  controllerchange 가 발화해도 reload skip → 옛 chunk 영구 stuck 문제 발생).
const BUILD_ID = (import.meta.env.VITE_BUILD_ID as string | undefined) ?? 'dev';
const SW_RELOAD_KEY = `sw-reloaded-${BUILD_ID}`;

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
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
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
