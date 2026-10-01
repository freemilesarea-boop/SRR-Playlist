import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { initSentry } from './lib/sentry';
import { purgeBadAudioCaches } from './lib/swCache';
import { redirectToProductionIfNeeded } from './lib/productionRedirect';
import { isNativeApp, initNativeShell } from './lib/native';
import { useBusinessStore } from './store/businessStore';
import { usePlaybackHealthStore } from './store/playbackHealthStore';
import { shouldDeferReload, registerApplyUpdate } from './lib/swUpdateGate';
import {
  decideUpdateActivation, deterministicStaggerMs, alreadyActivated, markActivated,
  noteAutoplaySignals, autoplayTrusted,
} from './lib/zeroTouchUpdate';
import { beaconPlaybackDiagnostic } from './lib/playbackDiagnostics';
import { usePlayerStore } from './store/playerStore';
import { useAuthStore } from './store/authStore';
import { reloadApp } from './lib/playbackGuard';
import { installGlobalErrorTelemetry } from './lib/globalErrorTelemetry';

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

// ----------------------------------------------------------------------------
// BRAND-PLAYER-24H — 매장 재생 중에는 자동 리로드를 미룬다.
//
// 새 빌드가 뜨면 SW 가 페이지를 스스로 리로드하는데, 24시간 무인 매장에서는
// **배포 한 번 = 전 매장 음악 중단** 이 된다. 리로드 직후에는 사용자 제스처가 없어
// 브라우저 자동재생 정책에 막히고, 아무도 없는 매장은 그대로 무음이 된다.
// (프로덕션에서 배포 직후 두 매장이 동시에 재생목록 1번 곡으로 리셋된 뒤 소리가
//  나지 않는 상태가 실제로 관측됐다.)
//
// 재생 중이면 미루고, 멈춰 있으면 즉시 적용한다(이미 문제 상태라 리로드가 오히려 복구).
// 상한(12시간)을 넘기면 적용해서 키오스크가 옛 빌드에 갇히지 않게 한다.
// ----------------------------------------------------------------------------
let deferredSince: number | null = null;
let deferTimer: number | null = null;
let audioSub: (() => void) | null = null;
/**
 * 이 문서가 **제스처 없이** 소리를 시작했는가 — 누적 관측은 zeroTouchUpdate 가 소유한다.
 *
 * 리로드는 사용자 제스처를 잃는다. 한 번이라도 자동재생이 막힌 문서를 다시
 * 띄우면 또 막힐 것이고, 무인 매장에서는 그대로 무음이 된다. 그래서 자동
 * 활성화는 이 신뢰가 있을 때만 한다 — 없으면 옛 빌드로 도는 편이 낫다.
 *
 * 23 — 이 관측은 **업데이트가 감지되기 전부터** 돌아야 한다. 예전에는 첫 미룸
 * 이후에야 구독을 걸어 그 뒤의 전이만 봤고, 그래서 이미 재생 중이던 문서는
 * audioEverActive 가 false 인 채로 첫 트랙 경계를 autoplay_not_trusted 로
 * 버렸다 — 한 곡이 이유 없이 늦었다. 지금은 부팅 즉시 현재 상태를 한 번 읽고
 * 그 뒤로 계속 듣는다.
 */
// 27 — 전역 예외 기록을 **가장 먼저** 건다.
//
// 2026-09-15 14:06:16 KST 숙대점에서 플레이어 계층이 멈췄는데, 왜 멈췄는지
// 끝내 알 수 없었다. 유일한 클라이언트 진단기(Flight Recorder)가 플레이어와
// 함께 죽기 때문이다 — 정지를 감지해야 flush 하는데 감지하는 코드가 같이 멈췄다.
// 그날 12:17 사고 때는 3번 flush 됐고 14:05 전후로는 0번이다.
//
// 여기(window 전역)는 어느 컴포넌트가 죽든 문서가 살아 있는 한 계속 돈다.
// 그날 셸이 26분 38초 동안 살아 있었다는 것은 edge 로그로 실측됐다.
if (typeof window !== 'undefined') {
  installGlobalErrorTelemetry();
}

if (typeof window !== 'undefined') {
  noteAutoplaySignals(usePlaybackHealthStore.getState());
  usePlaybackHealthStore.subscribe(noteAutoplaySignals);
}

function applyReload(reason: string): void {
  if (window.sessionStorage.getItem(SW_RELOAD_KEY)) return;
  if (alreadyActivated(BUILD_ID)) return;
  window.sessionStorage.setItem(SW_RELOAD_KEY, '1');
  markActivated(BUILD_ID);
  // 이 줄 다음에 문서가 사라진다 — keepalive 가 아니면 기록이 남지 않는다.
  beaconPlaybackDiagnostic('update_activated', {
    reason: 'sw_update',
    context: { build: BUILD_ID, why: reason, deferredMs: deferredSince ? Date.now() - deferredSince : 0 },
  });
  // beforeunload 경고("변경한 내용이 저장되지 않을 수 있습니다")를 띄우지 않는다.
  // 우리가 의도한 리로드인데 모달이 뜨면 무인 매장에서는 아무도 안 눌러 그대로 멈춘다.
  reloadApp(`sw build ${BUILD_ID} (${reason})`);
}

/** 한 문서에서 같은 blocker 를 반복 기록하지 않는다(유계 로그). */
let lastBlockerLogged: string | null = null;

/**
 * 즉시 적용 or 미루기.
 *
 * 22 — 예전에는 30초 폴링 하나로 "재생이 멈추는 순간"을 노렸다. 그런데 그 창은
 * 트랙 전환의 emptied→playing 사이 수백 밀리초다. 30초 샘플링이 그 안에 들어갈
 * 확률은 한 번에 2% 남짓이고, 실제로 2026-09-14 하루 6번 배포 동안 두 매장 모두
 * **한 번도** 맞추지 못했다. 확률에 기대던 것을 사건에 거는 것으로 바꾼다 —
 * audioActive 가 false 로 떨어지는 그 순간 구독으로 직접 듣는다.
 */
function requestReload(reason: string): void {
  if (window.sessionStorage.getItem(SW_RELOAD_KEY)) return;

  const businessMode = useBusinessStore.getState().businessMode;
  const health = usePlaybackHealthStore.getState();

  // 일반 사용자는 기존 그대로 — 미루지 않고 즉시 적용한다.
  if (!shouldDeferReload({
    businessMode, audioActive: health.audioActive, deferredSince, now: Date.now(),
  })) {
    if (!businessMode) { applyReload(reason); return; }
  }

  if (deferredSince === null) {
    deferredSince = Date.now();
    console.warn('[sw] 매장 재생 중 — 업데이트 적용을 미룹니다', { build: BUILD_ID, reason });
    beaconPlaybackDiagnostic('update_pending', {
      reason: 'sw_update',
      context: { build: BUILD_ID, why: reason, autoplayTrusted: autoplayTrusted() },
    });
  }
  usePlaybackHealthStore.getState().setSwUpdatePending(true);

  const decision = decideUpdateActivation({
    updatePending: true,
    businessMode,
    audioActive: health.audioActive,
    // 매장 모드는 크로스페이드가 꺼져 있어 audioActive 가 false 로 떨어지는 그
    // 순간이 곧 트랙 경계다. 재생 의도가 남아 있으면 경계, 아니면 그냥 idle.
    atTrackBoundary: !health.audioActive && usePlayerStore.getState().playing,
    crossfading: false,
    recovering: health.autoplayBlocked || health.subscriptionBlocked,
    online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
    autoplayTrusted: autoplayTrusted(),
    deferredSince,
    staggerMs: deterministicStaggerMs(useAuthStore.getState().user?.id ?? ''),
    now: Date.now(),
  });

  if (decision.kind === 'activate') { applyReload(`${reason}:${decision.reason}`); return; }

  if (decision.blocker !== lastBlockerLogged) {
    lastBlockerLogged = decision.blocker;
    beaconPlaybackDiagnostic('update_blocked', {
      reason: 'sw_update',
      context: { build: BUILD_ID, blocker: decision.blocker, deferredMs: Date.now() - deferredSince },
    });
  }

  // 사건 기반 — audioActive 가 바뀌는 순간 바로 다시 판단한다.
  if (audioSub === null) {
    audioSub = usePlaybackHealthStore.subscribe((st, prev) => {
      if (st.audioActive !== prev.audioActive) requestReload('audio-state-change');
    });
  }
  // 안전망 — 구독이 어떤 이유로든 안 돌아도 상한에는 도달하게 한다.
  if (deferTimer === null) {
    deferTimer = window.setInterval(() => requestReload('deferred-recheck'), 30_000);
  }
}

// 운영자가 "지금 적용" 을 누른 경로 — 사용자 제스처가 있으므로 미루지 않는다.
registerApplyUpdate(() => applyReload('manual'));

// 네이티브 앱(Capacitor)에서는 SW 를 등록하지 않는다 — 로컬 번들을 Capacitor 가 직접
// 서빙하므로 SW precache/업데이트 리로드가 오히려 자산 로딩과 충돌한다. 웹/PWA 만 등록.
if (!isNativeApp() && typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  // (1) controllerchange — 새 SW 가 page control 잡으면 즉시 reload (build 당 1회)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // 24 — 새 SW 가 이 문서를 넘겨받은 그 순간을 먼저 남긴다.
    //
    // 왜 여기서, 왜 beacon 인가 — 숙대점이 배포 두 건을 자동으로 받았는데 업데이트
    // 진단이 한 줄도 남지 않았다. 우리 게이트가 한 일인지, 브라우저가 스스로 문서를
    // 다시 띄운 것인지 서버에서 가릴 방법이 없었다. 이 한 줄이 그 둘을 가른다:
    // 이것만 남고 update_* 가 없으면 리로드는 우리 것이 아니다.
    beaconPlaybackDiagnostic('sw_controllerchange', {
      reason: 'sw_update',
      context: { build: BUILD_ID },
    });
    requestReload('controllerchange');
  });

  // (2) SW activate 시 보낸 push 메시지 — 같은 탭에 새 SW 가 들어왔음을 강제 통지
  //     (controllerchange 가 lazy 한 환경에서도 동작)
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type !== 'SW_ACTIVATED') return;
    const msgKey = `sw-msg-${e.data.buildId ?? BUILD_ID}`;
    if (window.sessionStorage.getItem(msgKey)) return;
    window.sessionStorage.setItem(msgKey, '1');
    console.warn('[sw] SW_ACTIVATED message — 리로드 판단');
    beaconPlaybackDiagnostic('sw_controllerchange', {
      reason: 'sw_update',
      context: { build: BUILD_ID, why: 'sw-activated' },
    });
    requestReload('sw-activated');
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
