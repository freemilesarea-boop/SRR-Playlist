/**
 * playbackDiag.ts — 재생 실패를 기기에서 한 줄로 읽는다.
 *
 * 지금까지 실패가 나면 사용자는 "재생 오류가 발생했어요" 토스트만 보고,
 * 개발자는 아무것도 못 봤다. 상세 로그는 audioDebugWarn 으로 감싸져 있어서
 * ?audioDebug=1 세션에서만 나왔는데, APK 에는 주소창이 없다.
 *
 * 그래서 실패 로그만은 게이트 없이 항상 남긴다. 실패는 드물어서 spam 이 아니고,
 * 프로덕션 빌드는 console.log/debug/info 를 지우므로 warn 으로 내보낸다.
 *
 * 같은 실패가 반복돼도 한 번만 — dedupe 키는 (트랙, 오류코드, 단계) 다.
 */

export interface PlaybackDiagInput {
  /** 어느 단계에서 터졌나: 'media-error' | 'play-reject' | 'meta-timeout' | ... */
  stage: string;
  trackId?: string | null;
  playlistId?: string | null;
  /** 'home' | 'search' | 'store' | 'brand' 등 큐를 만든 경로. */
  sourceType?: string | null;
  audio?: HTMLMediaElement | null;
  /** play() 가 reject 한 경우의 예외. */
  error?: unknown;
  /** 큐에서 몇 번째 곡이었나. */
  queueIndex?: number | null;
  /** 이 트랙이 이미 실패 명단에 있었나. */
  failedTrack?: boolean | null;
  /** 이 실패에 대해 무엇을 했나 (retry / skip / stop / none). */
  recovery?: string | null;
  /** 추가 맥락 (activeIdx, crossfading 등). */
  extra?: Record<string, unknown>;
}

const MEDIA_ERROR_NAMES: Record<number, string> = {
  1: 'MEDIA_ERR_ABORTED',
  2: 'MEDIA_ERR_NETWORK',
  3: 'MEDIA_ERR_DECODE',
  4: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
};

/**
 * ABORTED 는 "파일이 잘못됐다" 가 아니다.
 *
 * 로딩 중에 src 를 바꾸거나 load() 를 다시 부르면 브라우저가 진행 중이던 로드를
 * 취소하면서 내는 정상적인 신호다. 플레이리스트를 빠르게 갈아타면 반드시 난다.
 * 사용자에게 보여줄 실패가 아니다 — 기록만 한다.
 */
export function isUserVisibleMediaError(code: number | null | undefined): boolean {
  return code === 2 || code === 3 || code === 4;
}

/** play() 가 던지는 DOMException 중 사용자 잘못이 아닌 것. */
export function isBenignPlayRejection(name: string | null | undefined): boolean {
  // AbortError: 로드/재생이 다음 요청으로 교체됨 (= 빠른 곡 전환).
  // NotAllowedError: 사용자 제스처 없는 자동재생 차단 — 별도 오버레이가 처리한다.
  return name === 'AbortError' || name === 'NotAllowedError';
}

/* ------------------------------------------------------------------ *
 * 안전한 URL 식별
 * ------------------------------------------------------------------ */

/**
 * 로그에 남겨도 되는 형태의 URL 식별자.
 *
 * 전체 URL 은 서명·토큰이 붙을 수 있고 길어서 로그를 못 읽게 만든다.
 * 같은 곡인지 구분할 수 있을 만큼만 남긴다 — 종류 + 파일명 꼬리.
 */
export function safeUrlId(url: string | null | undefined): string {
  if (!url) return '(없음)';
  if (url.startsWith('blob:')) return `blob:…${url.slice(-8)}`;
  if (url.startsWith('data:')) return 'data:…';
  try {
    const u = new URL(url);                       // 쿼리(서명)는 버린다
    const base = u.pathname.split('/').pop() ?? '';
    return `net:…${base.slice(-20)}`;
  } catch {
    return `net:…${url.slice(-20)}`;
  }
}

/* ------------------------------------------------------------------ *
 * 브레드크럼 — 실패 직전에 무슨 일이 있었나
 * ------------------------------------------------------------------ */

/**
 * 실패 한 줄만으로는 "왜" 를 못 본다. ABORTED 가 났을 때 그것을 abort 시킨
 * 동작이 무엇이었는지는 직전 몇 개의 호출을 봐야 안다.
 *
 * 그래서 재생 경로의 주요 전이를 가볍게 쌓아두고(콘솔 출력 없음),
 * 실패가 났을 때만 한꺼번에 뱉는다. 평소에는 배열 push 한 번이 전부다.
 */
export interface Crumb {
  t: number;
  type: string;
  data?: Record<string, unknown>;
}

const CRUMB_MAX = 40;
const crumbs: Crumb[] = [];

export function breadcrumb(type: string, data?: Record<string, unknown>): void {
  crumbs.push({
    t: typeof performance !== 'undefined' ? performance.now() : Date.now(),
    type,
    data,
  });
  if (crumbs.length > CRUMB_MAX) crumbs.shift();
}

export function readCrumbs(): readonly Crumb[] {
  return crumbs;
}

export function resetCrumbs(): void {
  crumbs.length = 0;
}

/** 실패 시점 기준 상대시각(ms)으로 되감아 보여준다. */
export function formatTimeline(now?: number): string {
  if (crumbs.length === 0) return '[PLAYBACK_TIMELINE] (기록 없음)';
  const end = now ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const lines = crumbs.map((c) => {
    const ago = Math.round(end - c.t);
    const kv = Object.entries(c.data ?? {}).map(([k, v]) => `${k}=${String(v)}`).join(' ');
    return `  -${String(ago).padStart(6)}ms ${c.type}${kv ? ` · ${kv}` : ''}`;
  });
  return ['[PLAYBACK_TIMELINE] (실패 시점 기준 역순 아님 — 위가 과거)', ...lines].join('\n');
}

const seen = new Set<string>();
/** 세션당 기록 상한 — 장애가 길어져도 로그가 기기를 먹지 않도록. */
const MAX_ENTRIES = 200;

export function resetPlaybackDiagDedupe(): void {
  seen.clear();
}

/** 사람이 읽는 한 줄. 테스트가 이 포맷을 잡는다. */
export function formatPlaybackDiag(i: PlaybackDiagInput): string {
  const a = i.audio ?? null;
  const mediaErr = a?.error ?? null;
  const errName = mediaErr ? (MEDIA_ERROR_NAMES[mediaErr.code] ?? `code=${mediaErr.code}`) : null;
  const ex = i.error as { name?: string; message?: string } | undefined;

  const src = a ? (a.currentSrc || a.src || '') : '';
  const srcKind = src.startsWith('blob:') ? 'blob(캐시)' : src ? 'network' : '(없음)';

  return [
    '[PLAYBACK_DIAG]',
    `ts=${new Date().toISOString()}`,
    `stage=${i.stage}`,
    `track=${i.trackId ?? '—'}`,
    `playlist=${i.playlistId ?? '—'}`,
    `source=${i.sourceType ?? '—'}`,
    `queueIndex=${i.queueIndex ?? '—'}`,
    `srcKind=${srcKind}`,
    `srcId=${safeUrlId(src)}`,
    `mediaError=${errName ?? '—'}${mediaErr?.message ? `(${mediaErr.message})` : ''}`,
    `ex=${ex?.name ?? '—'}${ex?.message ? `(${ex.message})` : ''}`,
    `readyState=${a?.readyState ?? '—'}`,
    `networkState=${a?.networkState ?? '—'}`,
    `paused=${a?.paused ?? '—'}`,
    `ended=${a?.ended ?? '—'}`,
    `seeking=${a?.seeking ?? '—'}`,
    `duration=${a && Number.isFinite(a.duration) ? a.duration.toFixed(1) : '—'}`,
    `currentTime=${a ? a.currentTime.toFixed(1) : '—'}`,
    `failedTrack=${i.failedTrack ?? '—'}`,
    `recovery=${i.recovery ?? '—'}`,
    ...Object.entries(i.extra ?? {}).map(([k, v]) => `${k}=${String(v)}`),
  ].join(' · ');
}

/** dedupe 키 — 같은 트랙의 같은 오류를 단계별로 한 번씩만. */
export function playbackDiagKey(i: PlaybackDiagInput): string {
  const code = i.audio?.error?.code ?? '';
  const name = (i.error as { name?: string } | undefined)?.name ?? '';
  return `${i.stage}|${i.trackId ?? ''}|${code}|${name}`;
}

/**
 * 기록. 게이트 없음(실패만 찍는다) · 중복 제거 · 상한.
 * 반환값은 "이번에 실제로 찍었는가" — 테스트가 중복 억제를 확인한다.
 */
export function logPlaybackDiag(i: PlaybackDiagInput): boolean {
  const key = playbackDiagKey(i);
  if (seen.has(key)) return false;
  if (seen.size >= MAX_ENTRIES) return false;
  seen.add(key);
  try {
    console.warn(formatPlaybackDiag(i));
    // 실패 한 줄만으로는 "무엇이 이것을 abort 시켰나" 를 못 본다.
    console.warn(formatTimeline());
  } catch { /* 로그가 재생을 막아서는 안 된다 */ }
  return true;
}
