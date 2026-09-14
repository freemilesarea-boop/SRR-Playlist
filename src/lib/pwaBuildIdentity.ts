/**
 * pwaBuildIdentity.ts — "지금 이 매장에서 **어떤 코드**가 돌고 있는가" 를 서버가 알게 한다.
 *
 * 왜 만들었나 — 2026-09-14 숙대점.
 *   06:44  buildHash 837a38cbe9ec (최신) 로 정상 기동
 *   09:46  heartbeat 소실 (5분 51초)
 *   09:52  fresh_load — 그런데 **2026-09-10~09-12 사이 번들**이 떴다
 *
 * 그걸 우리가 어떻게 알았나: session_start context 가 `{}` 였기 때문이다. 즉
 * **필드가 없다는 사실**로 역추론했다. 이건 관측이 아니라 추리다. 다음번에도
 * 이런 식이면 또 며칠을 태운다.
 *
 * 그래서 이 모듈은 세 가지를 관측 가능하게 만든다:
 *   1) 페이지가 실행 중인 번들의 build hash   (pageBuildHash)
 *   2) 그 페이지를 제어하는 SW 의 build hash  (swBuildHash)
 *   3) 둘의 조합 상태                          (page/sw 매트릭스)
 *
 * ── 절대 규칙 ───────────────────────────────────────────────────────────────
 *  • **서버가 기대하는 값을 복사해 오지 않는다.** 여기서 나가는 값은 항상 지금
 *    실행 중인 코드 자신의 identity 다. 기대값을 되돌려주면 stale 을 영영 못 본다.
 *  • 최신 버전을 하드코딩하지 않는다. 빌드 시점에 주입된 값만 쓴다.
 *  • controller.scriptURL 만으로는 build identity 가 되지 않는다 — 모든 배포가
 *    같은 `/sw.js` 다. SW 내부 compile-time 값을 물어봐야 한다(scriptURL 은 보조).
 *  • PII 없음. UA·이메일·좌표·기기 일련번호 전부 넣지 않는다.
 */
import { buildHash } from '@/lib/playbackFlightRecorder';

/** 페이지가 실제로 실행 중인 번들의 build hash. 빌드 시 주입된 값 그대로. */
export function pageBuildHash(): string {
  return buildHash();
}

// ─────────────────────────────────────────────────────────────────────────────
// Navigation / display 식별 (§5)
// ─────────────────────────────────────────────────────────────────────────────

export type NavigationType = 'navigate' | 'reload' | 'back_forward' | 'prerender' | 'unknown';

const NAV_TYPES: ReadonlySet<string> = new Set(['navigate', 'reload', 'back_forward', 'prerender']);

/**
 * 이 문서가 어떻게 떴는가. PerformanceNavigationTiming 기준.
 *
 * cold-start 복원(back_forward)과 진짜 새 진입(navigate)을 가르는 데 쓴다 —
 * 09:52 숙대 사례에서 이 값이 있었다면 "복원된 문서인가" 를 바로 답할 수 있었다.
 */
export function resolveNavigationType(): NavigationType {
  try {
    if (typeof performance === 'undefined' || !performance.getEntriesByType) return 'unknown';
    const [nav] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    const t = nav?.type as string | undefined;
    return t && NAV_TYPES.has(t) ? (t as NavigationType) : 'unknown';
  } catch {
    return 'unknown';
  }
}

export type DisplayMode = 'standalone' | 'browser' | 'fullscreen' | 'minimal-ui' | 'unknown';

/** 설치형으로 떴는지. 기존 installed_webapp 판정과 같은 matchMedia 기준을 쓴다. */
export function resolveDisplayMode(): DisplayMode {
  try {
    if (typeof window === 'undefined' || !window.matchMedia) return 'unknown';
    for (const m of ['standalone', 'fullscreen', 'minimal-ui'] as const) {
      if (window.matchMedia(`(display-mode: ${m})`).matches) return m;
    }
    return window.matchMedia('(display-mode: browser)').matches ? 'browser' : 'unknown';
  } catch {
    return 'unknown';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Service Worker identity (§2 · §4 · §6)
// ─────────────────────────────────────────────────────────────────────────────

/** SW 가 GET_SW_IDENTITY 에 답하는 모양. 전부 비민감. */
export interface ServiceWorkerIdentity {
  swBuildHash: string | null;
  precacheEntryCount: number | null;
  scope: string | null;
  /** SW 자신의 런타임 기준 activate 시각(ms). 서버 시각과 섞지 않는다. */
  activatedAt: number | null;
}

/** registration 상태 — boolean 만. 객체·URL 전체를 남기지 않는다(§6). */
export interface ServiceWorkerState {
  hasInstalling: boolean;
  hasWaiting: boolean;
  hasActive: boolean;
  /** 이 페이지가 SW 의 제어를 받고 있는가. */
  controlled: boolean;
  /** 보조 정보일 뿐 — build identity 로 쓰지 않는다(§4). */
  controllerScriptPath: string | null;
}

export const NO_SW_STATE: ServiceWorkerState = {
  hasInstalling: false, hasWaiting: false, hasActive: false,
  controlled: false, controllerScriptPath: null,
};

/** scriptURL 에서 경로만 남긴다 — origin·쿼리는 버린다(§4 보조 정보). */
export function scriptPathOf(scriptURL: string | null | undefined): string | null {
  const s = (scriptURL ?? '').trim();
  if (!s) return null;
  try { return new URL(s).pathname; } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Page ↔ SW 매트릭스 (§3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 다음 incident 의 원인 판정은 이 다섯 갈래에서 시작한다.
 *
 *   A  page NEW / sw NEW    정상
 *   B  page OLD / sw NEW    SW 는 갱신됐는데 문서가 옛것 — 복원/HTTP 캐시 의심
 *   C  page NEW / sw OLD    SW 갱신이 막힘
 *   D  page OLD / sw OLD    갱신 자체가 멈춤
 *   E  controller 없음       SW 가 제어하지 않는 문서
 */
export type BuildMatrix = 'A_PAGE_NEW_SW_NEW' | 'B_PAGE_OLD_SW_NEW'
  | 'C_PAGE_NEW_SW_OLD' | 'D_PAGE_OLD_SW_OLD' | 'E_NO_CONTROLLER' | 'UNKNOWN';

export interface MatrixInput {
  /** 서버가 기대하는 최신 build hash. 없으면 판정 불가. */
  expected: string | null;
  pageBuildHash: string | null;
  swBuildHash: string | null;
  controlled: boolean;
}

export function resolveBuildMatrix(i: MatrixInput): BuildMatrix {
  if (!i.controlled) return 'E_NO_CONTROLLER';
  if (!i.expected || !i.pageBuildHash || !i.swBuildHash) return 'UNKNOWN';
  const pageNew = i.pageBuildHash === i.expected;
  const swNew = i.swBuildHash === i.expected;
  if (pageNew && swNew) return 'A_PAGE_NEW_SW_NEW';
  if (!pageNew && swNew) return 'B_PAGE_OLD_SW_NEW';
  if (pageNew && !swNew) return 'C_PAGE_NEW_SW_OLD';
  return 'D_PAGE_OLD_SW_OLD';
}

// ─────────────────────────────────────────────────────────────────────────────
// Stale 판정 (§8)
// ─────────────────────────────────────────────────────────────────────────────

export type BuildFreshness = 'CURRENT' | 'STALE' | 'UNKNOWN';

/**
 * 서버 기대값과 클라이언트가 보고한 값을 비교한다.
 *
 * **UNKNOWN 을 CURRENT 로 취급하지 않는다.** 값을 안 보낸 클라이언트는 "최신"이
 * 아니라 "모른다" 이다. 2026-09-14 09:52 숙대점이 정확히 이 경우다 — 그 번들은
 * buildHash 를 보낼 줄 모른다. CURRENT 로 세면 그날의 사고가 통계에서 사라진다.
 */
export function classifyBuildFreshness(
  expected: string | null | undefined,
  reported: string | null | undefined,
): BuildFreshness {
  const e = (expected ?? '').trim();
  const r = (reported ?? '').trim();
  if (!r) return 'UNKNOWN';        // 안 보냈다 = 모른다
  if (!e) return 'UNKNOWN';        // 기대값이 없으면 비교 자체가 불가
  return r === e ? 'CURRENT' : 'STALE';
}

/**
 * page 와 sw 의 build 가 어긋났는가 (§9).
 * **관측 이벤트일 뿐이다.** 이것만으로 장애 처리도, 리로드도 하지 않는다.
 */
export function isPageSwBuildMismatch(
  pageHash: string | null | undefined,
  swHash: string | null | undefined,
): boolean {
  const p = (pageHash ?? '').trim();
  const s = (swHash ?? '').trim();
  if (!p || !s) return false;      // 하나라도 모르면 mismatch 라고 말하지 않는다
  return p !== s;
}

// ─────────────────────────────────────────────────────────────────────────────
// heartbeat 에 실어 보낼 payload
// ─────────────────────────────────────────────────────────────────────────────

export interface BuildIdentityPayload {
  pageBuildHash: string;
  swBuildHash: string | null;
  swControlled: boolean;
  navigationType: NavigationType;
}

/** 비민감 필드만 담겼는지 — 테스트가 이 목록을 고정한다. */
export const IDENTITY_PAYLOAD_KEYS: readonly string[] =
  ['pageBuildHash', 'swBuildHash', 'swControlled', 'navigationType'];

// ─────────────────────────────────────────────────────────────────────────────
// 런타임 조회 — SW 에게 직접 물어본다
// ─────────────────────────────────────────────────────────────────────────────

/** 현재 registration/controller 상태를 boolean 으로만 읽는다. */
export function readServiceWorkerState(): ServiceWorkerState {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return NO_SW_STATE;
    const ctrl = navigator.serviceWorker.controller ?? null;
    return {
      hasInstalling: false, hasWaiting: false, hasActive: !!ctrl,
      controlled: !!ctrl,
      controllerScriptPath: scriptPathOf(ctrl?.scriptURL),
    };
  } catch {
    return NO_SW_STATE;
  }
}

/** registration 까지 본 정밀 상태. registration 조회가 비동기라 분리해 둔다. */
export async function readServiceWorkerStateDetailed(): Promise<ServiceWorkerState> {
  const base = readServiceWorkerState();
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return base;
    const reg = await navigator.serviceWorker.getRegistration('/');
    if (!reg) return base;
    return {
      ...base,
      hasInstalling: !!reg.installing,
      hasWaiting: !!reg.waiting,
      hasActive: !!reg.active,
    };
  } catch {
    return base;
  }
}

/**
 * 제어 중인 SW 에게 자기 identity 를 물어본다.
 *
 * 응답이 없으면 null 이다 — **추측해서 채우지 않는다.** SW 가 옛 버전이라
 * GET_SW_IDENTITY 를 모를 수도 있는데, 그 침묵 자체가 정보다(그 배포 이전 SW).
 */
export async function requestServiceWorkerIdentity(
  timeoutMs = 2_000,
): Promise<ServiceWorkerIdentity | null> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
    const ctrl = navigator.serviceWorker.controller;
    if (!ctrl) return null;
    return await new Promise<ServiceWorkerIdentity | null>((resolve) => {
      let settled = false;
      const done = (v: ServiceWorkerIdentity | null) => {
        if (settled) return;
        settled = true;
        resolve(v);
      };
      const timer = setTimeout(() => done(null), timeoutMs);
      try {
        const ch = new MessageChannel();
        ch.port1.onmessage = (e: MessageEvent) => {
          clearTimeout(timer);
          const d = (e.data ?? {}) as Partial<ServiceWorkerIdentity> & { type?: string };
          if (d.type !== 'SW_IDENTITY') return done(null);
          done({
            swBuildHash: typeof d.swBuildHash === 'string' ? d.swBuildHash : null,
            precacheEntryCount:
              typeof d.precacheEntryCount === 'number' ? d.precacheEntryCount : null,
            scope: typeof d.scope === 'string' ? d.scope : null,
            activatedAt: typeof d.activatedAt === 'number' ? d.activatedAt : null,
          });
        };
        ctrl.postMessage({ type: 'GET_SW_IDENTITY' }, [ch.port2]);
      } catch {
        clearTimeout(timer);
        done(null);
      }
    });
  } catch {
    return null;
  }
}
