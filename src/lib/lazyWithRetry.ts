import { lazy, type ComponentType } from 'react';

/**
 * React.lazy + chunk load 실패 시 1회 자동 reload.
 *
 * 배경: Vercel 새 deploy 후 사용자가 열어둔 탭이 옛 manifest 의 chunk path 를 요청하면
 * 404 가 떨어지고 Suspense fallback 이 무한 또는 빈 페이지로 남음. 정확히 "페이지 이동 시
 * 데이터 안 뜨고 새로고침해야 보임" 증상의 주 원인.
 *
 * 동작:
 *  - import() 실패 시 sessionStorage 에 flag 기록 후 window.location.reload()
 *  - 같은 세션에서 reload 후 다시 실패하면 throw — 무한 reload 루프 방지
 *
 * 사용:
 *   const PlaylistPage = lazyWithRetry(() => import('@/pages/PlaylistPage'));
 */
const RELOAD_FLAG_KEY = 'chunk-reload-attempt';

export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(() =>
    factory().catch((err: unknown) => {
      const alreadyReloaded =
        typeof window !== 'undefined' &&
        window.sessionStorage.getItem(RELOAD_FLAG_KEY) === '1';
      // 같은 세션에서 이미 reload 한 적 있으면 진짜 에러 — 무한 루프 방지
      if (alreadyReloaded) {
        // eslint-disable-next-line no-console
        console.error('[lazyWithRetry] chunk failed after retry:', err);
        throw err;
      }
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(RELOAD_FLAG_KEY, '1');
        // eslint-disable-next-line no-console
        console.warn('[lazyWithRetry] chunk load failed → reloading once', err);
        window.location.reload();
      }
      // reload 가 진행되는 동안 영원히 pending — Suspense 가 fallback 유지
      return new Promise<{ default: T }>(() => {});
    }),
  );
}

/**
 * 페이지가 정상 로드/렌더된 시점에 호출 — 다음 chunk 실패는 1회 retry 사용 가능.
 * App 의 useEffect 에서 한 번만 호출.
 */
export function clearChunkReloadFlag(): void {
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem(RELOAD_FLAG_KEY);
  }
}
