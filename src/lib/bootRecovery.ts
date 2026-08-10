// Phase WEB-OPT-2 — 부팅 복구 공통 순수 로직.
//
// 목적:
//   새로고침 백지 / stale chunk 404 / 오래된 SW 로 인한 부팅 실패를 build 단위로 안전하게
//   1회만 복구하고, 같은 build 에서 무한 reload 를 막는다. RootErrorBoundary / main.tsx /
//   lazyWithRetry 가 동일한 판정 로직을 공유하도록 순수 함수로 분리(DOM 비의존 → 단위 테스트 가능).
//
// 절대 원칙: 인증/재생/큐/크로스페이드/스케줄러/정산 로직과 무관. 오직 "다시 그리기/새로고침" 판정만.

/** 빌드 시 vite define 으로 주입되는 값 (main.tsx / sw.ts 와 동일). dev 는 'dev'. */
export const BUILD_ID = (import.meta.env.VITE_BUILD_ID as string | undefined) ?? 'dev';

/** build 스코프 sessionStorage 가드 키 — 새 배포(새 BUILD_ID)면 자동으로 초기화되어 복구 재시도 가능. */
export const SW_RELOAD_KEY = `sw-reload:${BUILD_ID}`;
export const CHUNK_RELOAD_KEY = `chunk-reload:${BUILD_ID}`;
export const BOOT_RECOVERY_KEY = `boot-recovery:${BUILD_ID}`;
/** watchdog 복구 후 다음 로드에서 Sentry 로 보고하기 위한 진단 로그 (1회성). */
export const RECOVERY_LOG_KEY = 'srr-recovery-log';

/** 같은 build 에서 watchdog/emergency 복구를 최대 몇 번까지 허용하는가. */
export const MAX_BOOT_RECOVERY_ATTEMPTS = 1;

// 브라우저별 chunk load 실패 메시지 — 알려진 패턴만. 광범위한 /fetch/ 매칭은 하지 않는다.
const CHUNK_ERROR_PATTERNS: RegExp[] = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Loading chunk [\w-]+ failed/i,
  /Loading CSS chunk [\w-]+ failed/i,
  /dynamically imported module/i,
];

/** dynamic import 실패(=chunk 404/stale)인지 판별. 일반 런타임 오류는 false → 상위로 rethrow. */
export function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  // 일부 브라우저/번들러는 name 을 'ChunkLoadError' 로 설정.
  const name = err instanceof Error ? err.name : '';
  if (name === 'ChunkLoadError') return true;
  const rawMsg =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : String((err as { message?: unknown })?.message ?? '');
  if (!rawMsg) return false;
  return CHUNK_ERROR_PATTERNS.some((r) => r.test(rawMsg));
}

/**
 * chunk 로드 실패 시 취할 동작(순수 판정).
 * - offline: reload 해도 소용없음 → rethrow (ErrorBoundary 가 안내).
 * - 이미 이 build 에서 1회 reload 함 → rethrow (무한 reload 방지 → ErrorBoundary).
 * - 그 외 → reload (캐시 정리 후 1회).
 */
export type ChunkAction = 'reload' | 'rethrow';
export function decideChunkAction(input: { alreadyReloadedThisBuild: boolean; online: boolean }): ChunkAction {
  if (!input.online) return 'rethrow';
  if (input.alreadyReloadedThisBuild) return 'rethrow';
  return 'reload';
}

/** build 스코프 1회성 가드: 아직 실행 안 했으면 true. */
export function shouldRunOnce(existing: string | null): boolean {
  return existing !== '1';
}

/**
 * SW 업데이트 reload 판정(순수).
 * - 최초 방문(controller 없던 상태에서의 clientsClaim)은 reload 하지 않음(불필요한 첫방문 reload 방지).
 * - 이미 이 build 에서 reload 했으면 재reload 안 함(controllerchange + SW_ACTIVATED 중복 방지).
 */
export function shouldReloadForUpdatedSw(input: { hadInitialController: boolean; alreadyReloaded: boolean }): boolean {
  return input.hadInitialController && !input.alreadyReloaded;
}

/** watchdog bounded 복구 판정: 이전 시도 횟수 → 다음 시도 번호와 허용 여부. */
export function nextRecoveryAttempt(prev: number, max: number = MAX_BOOT_RECOVERY_ATTEMPTS): { attempt: number; allowed: boolean } {
  const safePrev = Number.isFinite(prev) && prev > 0 ? Math.trunc(prev) : 0;
  const attempt = safePrev + 1;
  return { attempt, allowed: attempt <= max };
}

/** 삭제 대상 캐시 이름인지 — 앱(workbox) 캐시만 대상. 타 캐시/사용자 데이터는 건드리지 않음. */
export function isAppCacheName(name: string): boolean {
  return /workbox|srr|deudda|precache/i.test(name);
}

// ── 진단(PII 안전) ────────────────────────────────────────────────────
export interface BootDiag {
  build: string;
  /** pathname 만 — query/hash 는 OAuth token 등이 있을 수 있어 절대 포함하지 않음. */
  path: string;
  online: boolean | null;
  hasController: boolean | null;
  attempt?: number;
  reason?: string;
}

/** 부팅 진단 컨텍스트 생성 — pathname 만, 토큰/이메일/응답 본문 없음. */
export function buildBootDiag(src?: {
  path?: string;
  online?: boolean | null;
  hasController?: boolean | null;
  attempt?: number;
  reason?: string;
}): BootDiag {
  return {
    build: BUILD_ID,
    path: sanitizePath(src?.path),
    online: src?.online ?? null,
    hasController: src?.hasController ?? null,
    ...(src?.attempt != null ? { attempt: src.attempt } : {}),
    ...(src?.reason ? { reason: src.reason } : {}),
  };
}

/** query/hash 제거하여 pathname 만 남김(빈 값이면 '/'). */
export function sanitizePath(path?: string | null): string {
  if (!path || typeof path !== 'string') return '/';
  const noHash = path.split('#')[0] ?? '';
  const noQuery = noHash.split('?')[0] ?? '';
  return noQuery || '/';
}

const FORBIDDEN_DIAG_KEYS = /token|secret|password|email|authorization|cookie|signed|api[_-]?key/i;

/** 진단 객체가 민감정보 키를 포함하지 않는지 검증(테스트/가드용). */
export function isDiagSafe(diag: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(diag)) {
    if (FORBIDDEN_DIAG_KEYS.test(k)) return false;
    // path 값에 access_token= 같은 게 섞여 들어오지 않았는지 방어적 확인
    if (typeof v === 'string' && /access_token|refresh_token|Bearer\s/i.test(v)) return false;
  }
  return true;
}
