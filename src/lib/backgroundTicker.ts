/**
 * backgroundTicker.ts — 화면이 꺼져도 멈추지 않는 주기 실행기.
 *
 * 왜 필요한가 — 숙대점(2026-09-10) 사례:
 *   매장 정지 자동 복구 워치독이 `window.setInterval(tick, 3000)` 으로 돌고 있었다.
 *   그런데 브라우저는 **백그라운드 탭/화면 꺼짐 상태에서 메인 스레드 타이머를
 *   강하게 스로틀링한다**(크롬은 1분에 1회까지 떨어지고, 일부 브라우저는 더 심하다).
 *   무인 매장 태블릿은 대부분의 시간을 그 상태로 보낸다 — 정작 복구가 필요한
 *   바로 그 상황에서 워치독이 잠들어 있었다.
 *
 * Web Worker 의 타이머는 메인 스레드와 별개로 돌아 스로틀링을 훨씬 덜 받는다.
 * 워커를 못 만드는 환경(CSP 등)에서는 setInterval 로 조용히 되돌아간다 —
 * 그 경우에도 지금보다 나빠지지 않는다.
 *
 * 워커는 tick 신호만 보낸다. 판단과 실행은 전부 메인 스레드에 남는다.
 */

/** 워커 본문 — 외부 파일 없이 Blob 으로 만든다(빌드/배포 경로 추가 없음). */
const WORKER_SOURCE = `
let id = null;
self.onmessage = (e) => {
  const d = e.data || {};
  if (d.type === 'start') {
    if (id !== null) clearInterval(id);
    id = setInterval(() => self.postMessage('tick'), d.intervalMs || 3000);
  } else if (d.type === 'stop') {
    if (id !== null) clearInterval(id);
    id = null;
  }
};
`;

export interface Ticker {
  /** 실행 방식 — 진단/테스트용. */
  kind: 'worker' | 'interval';
  stop: () => void;
}

/**
 * onTick 을 intervalMs 마다 호출한다. 반환값의 stop() 으로 해제.
 * 워커 생성에 실패하면 setInterval 로 폴백한다.
 */
export function startBackgroundTicker(onTick: () => void, intervalMs = 3_000): Ticker {
  if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
    try {
      const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'application/javascript' }));
      const worker = new Worker(url);
      worker.onmessage = () => onTick();
      worker.postMessage({ type: 'start', intervalMs });
      return {
        kind: 'worker',
        stop: () => {
          try {
            worker.postMessage({ type: 'stop' });
            worker.terminate();
          } catch {
            /* noop */
          }
          try {
            URL.revokeObjectURL(url);
          } catch {
            /* noop */
          }
        },
      };
    } catch {
      /* 워커 불가 — 아래 폴백 */
    }
  }

  // window 대신 전역 타이머를 쓴다 — 워커/SSR/테스트 환경에서도 안전하다.
  const id = setInterval(onTick, intervalMs);
  return { kind: 'interval', stop: () => clearInterval(id) };
}
