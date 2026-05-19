import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { initSentry } from './lib/sentry';

// 0093 — Sentry 초기화 (DSN 없으면 silent skip, production 만 활성)
void initSentry();

// PWA 새 SW 가 활성화되면 (autoUpdate 가 백그라운드 swap 후 controllerchange fire)
// 같은 탭의 옛 SW 가 캐시한 옛 chunk 가 안 잡히도록 1회 reload.
// 이 reload 는 사용자가 다시 SPA navigate 했을 때 데이터 안 뜨는 증상의 보조 원인 차단.
if (
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  !window.sessionStorage.getItem('sw-reloaded')
) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // 한 세션당 1회만 — 무한 reload 방지
    window.sessionStorage.setItem('sw-reloaded', '1');
    // eslint-disable-next-line no-console
    console.info('[sw] controllerchange — reloading once');
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
