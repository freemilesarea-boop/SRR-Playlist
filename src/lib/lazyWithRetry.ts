import { lazy, type ComponentType } from 'react';

/**
 * React.lazy + build-scoped chunk load 실패 자동 복구.
 *
 * 배경:
 *   Vercel 신규 deploy 후 사용자 탭이 이전 index.html 에서 참조하던 chunk hash 를
 *   요청하면 404 가 떨어지고 Suspense fallback 이 "불러오는 중…" 상태로 무한 유지.
 *   특히 워크박스 precache 가 옛 chunk 를 매핑하고 있으면 SW 자체 갱신만으로는
 *   복구되지 않아, precache 삭제 후 hard reload 가 필요.
 *
 * 개선 사항 (이전 단일 sessionStorage 키 재사용 금지 요구):
 *   1. reload 가드 키를 BUILD_ID 스코프 (`chunk-reload-<BUILD_ID>`) 로 분리 —
 *      새 배포에 이르면 flag 자동 소멸 → 다음 배포에서도 1회 재시도 보장.
 *   2. import() rejection 중 실제 chunk load 실패만 감지 (Failed to fetch dynamically
 *      imported module / Loading chunk failed / Importing a module script failed 등).
 *      그 외 런타임 에러는 rethrow 하여 상위 ErrorBoundary 로 전달.
 *   3. 감지 시 workbox precache 를 포함한 모든 Cache Storage 를 삭제한 뒤 reload.
 *   4. 동일 BUILD_ID 에서는 1회만 시도 — 무한 loop 차단.
 */

const BUILD_ID = (import.meta.env.VITE_BUILD_ID as string | undefined) ?? 'dev';
const RELOAD_KEY = `chunk-reload-${BUILD_ID}`;
const LEGACY_RELOAD_KEY = 'chunk-reload-attempt';

// 브라우저별로 다른 chunk load 실패 메시지 — 알려진 패턴만 감지.
const CHUNK_ERROR_PATTERNS: RegExp[] = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Loading chunk [\w-]+ failed/i,
  /Loading CSS chunk [\w-]+ failed/i,
  /dynamically imported module/i,
];

function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const rawMsg =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
      ? err
      : String((err as { message?: unknown })?.message ?? '');
  if (!rawMsg) return false;
  return CHUNK_ERROR_PATTERNS.some((r) => r.test(rawMsg));
}

async function purgeAllCachesAndReload(): Promise<void> {
  // workbox precache + 기타 SW cache 를 삭제해 옛 chunk hash 매핑 제거.
  // 실패해도 reload 는 진행 (best-effort).
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (e) {
    console.warn('[lazyWithRetry] cache purge failed (continuing reload)', e);
  }
  window.location.reload();
}

export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(() =>
    factory().catch((err: unknown) => {
      // (1) chunk load 실패가 아니면 rethrow — 상위 ErrorBoundary 로 전달.
      if (!isChunkLoadError(err)) {
        console.error('[lazyWithRetry] non-chunk error, rethrow', err);
        throw err;
      }

      // (2) 같은 BUILD_ID 로 이미 1회 시도했으면 무한 루프 방지.
      const alreadyReloaded =
        typeof window !== 'undefined' &&
        window.sessionStorage.getItem(RELOAD_KEY) === '1';
      if (alreadyReloaded) {
        console.error(
          '[lazyWithRetry] chunk failed after cache purge + reload — giving up',
          { build: BUILD_ID, err },
        );
        throw err;
      }

      // (3) BUILD_ID 별 flag + 모든 cache 삭제 + reload.
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(RELOAD_KEY, '1');
        console.warn(
          '[lazyWithRetry] chunk load failed — purging caches + reload once',
          { build: BUILD_ID, err },
        );
        void purgeAllCachesAndReload();
      }
      // reload 진행 동안 Suspense fallback 유지 (깜빡임 방지).
      return new Promise<{ default: T }>(() => {});
    }),
  );
}

/**
 * 페이지 정상 렌더 도달 시 호출 — 다음 chunk 실패는 1회 retry 가능.
 * BUILD_ID 스코프 키는 배포마다 자동 소멸하므로 clear 는 하위 호환 목적.
 * 이전 단일 키 (`chunk-reload-attempt`) 잔재도 함께 정리.
 */
export function clearChunkReloadFlag(): void {
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem(LEGACY_RELOAD_KEY);
    window.sessionStorage.removeItem(RELOAD_KEY);
  }
}
