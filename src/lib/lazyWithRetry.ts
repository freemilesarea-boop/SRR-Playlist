import { lazy, type ComponentType } from 'react';
import {
  isChunkLoadError, decideChunkAction, isAppCacheName,
  CHUNK_RELOAD_KEY, BUILD_ID,
} from '@/lib/bootRecovery';
import { captureChunkLoadFailure } from '@/lib/sentry';

/**
 * React.lazy + build-scoped chunk load 실패 안정 복구. (WEB-OPT-2)
 *
 * 배경:
 *   Vercel 신규 deploy 후 사용자 탭이 이전 index.html 에서 참조하던 chunk hash 를
 *   요청하면 404 가 떨어지고 Suspense fallback 이 무한 유지되거나 백지가 된다.
 *
 * 정책(순수 판정은 bootRecovery.decideChunkAction 에 위임 → 단위 테스트 가능):
 *   1. chunk load 실패만 처리, 그 외 런타임 오류는 즉시 rethrow → 상위 RootErrorBoundary.
 *   2. offline 이면 reload 하지 않고 rethrow(무의미한 reload 금지) → ErrorBoundary 안내.
 *   3. 같은 BUILD_ID 에서 이미 1회 reload 했으면 재reload 안 하고 rethrow → RootErrorBoundary.
 *   4. reload 대상일 때만 앱(workbox) 캐시 정리 후 1회 reload. 새 배포(새 BUILD_ID)면 재시도 가능.
 *   5. reload/포기 전 Sentry 로 진단 보고(토큰/PII 없음).
 */

const LEGACY_RELOAD_KEY = 'chunk-reload-attempt';
const LEGACY_BUILD_KEY = `chunk-reload-${BUILD_ID}`; // 이전 키 형식 하위 호환 정리용

function sessionHas(key: string): boolean {
  try { return typeof window !== 'undefined' && window.sessionStorage.getItem(key) === '1'; }
  catch { return false; }
}
function sessionSet(key: string): void {
  try { if (typeof window !== 'undefined') window.sessionStorage.setItem(key, '1'); } catch { /* noop */ }
}

async function purgeAppCachesAndReload(): Promise<void> {
  // 앱(workbox) 캐시만 삭제해 옛 chunk hash 매핑 제거. 사용자 데이터/타 캐시는 보존. best-effort.
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.filter(isAppCacheName).map((k) => caches.delete(k)));
    }
  } catch (e) {
    console.warn('[lazyWithRetry] cache purge failed (continuing reload)', e);
  }
  try { window.location.reload(); } catch { /* noop */ }
}

export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(() =>
    factory().catch((err: unknown) => {
      // (1) chunk load 실패가 아니면 rethrow — RootErrorBoundary 로 전달.
      if (!isChunkLoadError(err)) {
        console.error('[lazyWithRetry] non-chunk error, rethrow', err);
        throw err;
      }

      const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
      const action = decideChunkAction({
        alreadyReloadedThisBuild: sessionHas(CHUNK_RELOAD_KEY),
        online,
      });

      // 진단 보고(best-effort, 앱에 영향 없음).
      void captureChunkLoadFailure(err, { action, online, build: BUILD_ID });

      if (action === 'rethrow') {
        // offline 이거나 이미 이 build 에서 reload 함 → RootErrorBoundary 가 복구 UI 표시.
        console.error('[lazyWithRetry] chunk load failed — rethrow to ErrorBoundary', { build: BUILD_ID, online });
        throw err;
      }

      // (reload) BUILD_ID 별 flag + 앱 캐시 삭제 + 1회 reload.
      sessionSet(CHUNK_RELOAD_KEY);
      console.warn('[lazyWithRetry] chunk load failed — purging app caches + reload once', { build: BUILD_ID });
      void purgeAppCachesAndReload();
      // reload 진행 동안 Suspense fallback 유지 (깜빡임 방지).
      return new Promise<{ default: T }>(() => {});
    }),
  );
}

/**
 * 페이지 정상 렌더 도달 시 호출 — 다음 chunk 실패는 1회 retry 가능.
 * BUILD_ID 스코프 키는 배포마다 자동 소멸하므로 clear 는 하위 호환/조기정리 목적.
 */
export function clearChunkReloadFlag(): void {
  try {
    if (typeof window === 'undefined') return;
    window.sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    window.sessionStorage.removeItem(LEGACY_RELOAD_KEY);
    window.sessionStorage.removeItem(LEGACY_BUILD_KEY);
  } catch { /* noop */ }
}
