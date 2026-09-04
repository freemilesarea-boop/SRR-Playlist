import { lazy, type ComponentType } from 'react';
import { reloadApp } from '@/lib/playbackGuard';
import { decideChunkRecovery } from '@/lib/chunkRecoveryPolicy';
import { useBusinessStore } from '@/store/businessStore';
import { usePlaybackHealthStore } from '@/store/playbackHealthStore';

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
 *   4. 리로드는 reloadApp 경유 — beforeunload 경고("사이트를 다시 로드할까요?") 모달이
 *      뜨면 무인 매장에서는 아무도 누르지 않아 복구가 그 자리에서 멈춘다.
 *   5. 재시도 횟수/간격은 chunkRecoveryPolicy 가 결정한다. 개인 사용자는 종전대로
 *      1회 시도 후 포기하고, 무인 매장은 상한(빌드당 5회)까지 60초 간격으로 되살린다.
 */

const BUILD_ID = (import.meta.env.VITE_BUILD_ID as string | undefined) ?? 'dev';
const RELOAD_KEY = `chunk-reload-${BUILD_ID}`;
const ATTEMPT_AT_KEY = `chunk-reload-at-${BUILD_ID}`;
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

function readNumber(key: string): number | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** 이 빌드에서 이미 실행한 복구 리로드 횟수. 과거 '1' 값과 호환. */
function readAttempts(): number {
  return readNumber(RELOAD_KEY) ?? 0;
}

async function purgeAllCachesAndReload(attempts: number): Promise<void> {
  try {
    window.sessionStorage.setItem(RELOAD_KEY, String(attempts + 1));
    window.sessionStorage.setItem(ATTEMPT_AT_KEY, String(Date.now()));
  } catch { /* sessionStorage 불가여도 복구는 진행 */ }

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
  // reloadApp: beforeunload 경고를 억제한 뒤 리로드한다. 직접 location.reload() 를 부르면
  // 무인 매장에서 "사이트를 다시 로드할까요?" 모달에 막혀 복구 자체가 멈춘다.
  reloadApp(`chunk-load-failed (build ${BUILD_ID}, attempt ${attempts + 1})`);
}

/** 정책이 give-up 을 낼 때까지 캐시 정리 + 리로드를 시도한다(매장은 지연 재시도 포함). */
function scheduleRecovery(err: unknown): void {
  const attempts = readAttempts();
  const decision = decideChunkRecovery({
    attempts,
    businessMode: useBusinessStore.getState().businessMode,
    audioActive: usePlaybackHealthStore.getState().audioActive,
    lastAttemptAt: readNumber(ATTEMPT_AT_KEY),
    now: Date.now(),
  });

  if (decision.action === 'give-up') {
    console.error('[lazyWithRetry] chunk 복구 포기 — ErrorBoundary 로 전달', {
      build: BUILD_ID,
      attempts,
      err,
    });
    return;
  }

  if (decision.action === 'wait') {
    console.warn('[lazyWithRetry] chunk 복구 대기 후 재시도', {
      build: BUILD_ID,
      attempts,
      delayMs: decision.delayMs,
    });
    window.setTimeout(() => scheduleRecovery(err), decision.delayMs);
    return;
  }

  console.warn('[lazyWithRetry] chunk load failed — purging caches + reload', {
    build: BUILD_ID,
    attempts,
    err,
  });
  void purgeAllCachesAndReload(attempts);
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
      if (typeof window === 'undefined') throw err;

      // (2) 정책상 더 시도할 게 없으면 그대로 던진다(개인 사용자 = 기존 동작).
      const decision = decideChunkRecovery({
        attempts: readAttempts(),
        businessMode: useBusinessStore.getState().businessMode,
        audioActive: usePlaybackHealthStore.getState().audioActive,
        lastAttemptAt: readNumber(ATTEMPT_AT_KEY),
        now: Date.now(),
      });
      if (decision.action === 'give-up') {
        console.error(
          '[lazyWithRetry] chunk failed after cache purge + reload — giving up',
          { build: BUILD_ID, err },
        );
        throw err;
      }

      // (3) 캐시 삭제 + 리로드 (매장은 필요하면 지연 후 재시도).
      scheduleRecovery(err);
      // reload 진행 동안 Suspense fallback 유지 (깜빡임 방지).
      return new Promise<{ default: T }>(() => {});
    }),
  );
}

/**
 * 페이지 정상 렌더 도달 시 호출 — 다음 chunk 실패는 다시 retry 가능.
 * BUILD_ID 스코프 키는 배포마다 자동 소멸하므로 clear 는 하위 호환 목적.
 * 이전 단일 키 (`chunk-reload-attempt`) 잔재도 함께 정리.
 */
export function clearChunkReloadFlag(): void {
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.removeItem(LEGACY_RELOAD_KEY);
      window.sessionStorage.removeItem(RELOAD_KEY);
      window.sessionStorage.removeItem(ATTEMPT_AT_KEY);
    } catch { /* noop */ }
  }
}
