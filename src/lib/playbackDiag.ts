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
  // blob: URL 은 길고 의미가 없다 — 종류만 남긴다.
  const srcKind = src.startsWith('blob:') ? 'blob(캐시)' : src ? 'network' : '(없음)';

  return [
    '[PLAYBACK_DIAG]',
    `stage=${i.stage}`,
    `track=${i.trackId ?? '—'}`,
    `playlist=${i.playlistId ?? '—'}`,
    `source=${i.sourceType ?? '—'}`,
    `srcKind=${srcKind}`,
    `mediaError=${errName ?? '—'}${mediaErr?.message ? `(${mediaErr.message})` : ''}`,
    `ex=${ex?.name ?? '—'}${ex?.message ? `(${ex.message})` : ''}`,
    `readyState=${a?.readyState ?? '—'}`,
    `networkState=${a?.networkState ?? '—'}`,
    `paused=${a?.paused ?? '—'}`,
    `ended=${a?.ended ?? '—'}`,
    `seeking=${a?.seeking ?? '—'}`,
    `duration=${a && Number.isFinite(a.duration) ? a.duration.toFixed(1) : '—'}`,
    `currentTime=${a ? a.currentTime.toFixed(1) : '—'}`,
    ...Object.entries(i.extra ?? {}).map(([k, v]) => `${k}=${String(v)}`),
    `src=${src.slice(0, 160)}`,
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
  } catch { /* 로그가 재생을 막아서는 안 된다 */ }
  return true;
}
