/**
 * failedTracks.ts — "이 세션에서 재생에 실패한 트랙" 명단과 그 수명.
 *
 * 원래는 Player 안의 모듈 전역 Set 이었다. 한 번 들어가면 나오는 길이 둘뿐이었다:
 *   • 그 곡에서 ▶ 를 다시 누르기 (에러 화면에 머물러 있을 때만 가능)
 *   • 매장모드의 1시간 prune (일반 사용자에게는 아예 돌지 않는다)
 *
 * 그래서 홈에서 자동 생성된 플레이리스트가 한 번 실패하면, 그 곡이 들어간
 * 플레이리스트는 **앱을 껐다 켤 때까지** 계속 같은 자리에서 멈췄다.
 * 곡 정보는 뜨는데 0:00 에서 움직이지 않는 그 상태다.
 *
 * 안드로이드 WebView 의 디코딩 실패는 영구적이지 않을 때가 많다(메모리 압박,
 * 코덱 일시 실패, 캐시 blob 수명). 그래서 명단에 **유효기간**을 둔다.
 * 진짜로 깨진 파일이면 만료 후 한 번 더 실패하고 다시 들어갈 뿐이고,
 * 일시적 실패였다면 스스로 풀린다. 앱 재시작이 유일한 복구 수단이면 안 된다.
 */

/** 실패 기록이 유효한 시간. 한 번 더 시도해볼 만해지는 간격. */
export const FAILED_TRACK_TTL_MS = 10 * 60_000;

/** 명단 상한 — 전면 장애에서 메모리가 늘어나지 않도록. */
export const FAILED_TRACK_MAX = 300;

const failedAt = new Map<string, number>();

/* ------------------------------------------------------------------ *
 * 영구 제외 — 반복해서 실패하는 음원은 앱에서 내린다
 * ------------------------------------------------------------------ */

/**
 * 이만큼 건너뛰어진 음원은 앱에서 빼버린다.
 *
 * 한 번 실패는 네트워크 사정일 수 있지만, 열 번 건너뛰어졌다면 그 기기에서
 * 재생되지 않는 파일이다. 계속 큐에 넣어두면 매번 로딩을 기다렸다가
 * 건너뛰는 비용만 치른다.
 *
 * 서버 데이터는 건드리지 않는다 — 이 기기에서만 빼는 것이고, 원인(파일)이
 * 고쳐지면 아래 clearBlockedTracks() 로 되돌릴 수 있다.
 */
export const BLOCK_AFTER_SKIPS = 10;

const SKIP_COUNT_KEY = 'deudda.trackSkipCounts';
const BLOCKED_KEY = 'deudda.blockedTracks';

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;   // 저장소가 막혔거나 값이 깨졌다
  }
}

function saveJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 무시 */ }
}

// 앱을 껐다 켜도 누적이 이어져야 한다 — 그래야 열 번이 의미를 갖는다.
const skipCounts = new Map<string, number>(Object.entries(loadJson<Record<string, number>>(SKIP_COUNT_KEY, {})));
const blocked = new Set<string>(loadJson<string[]>(BLOCKED_KEY, []));

/**
 * 재생 실패로 건너뛴 사실을 기록한다. 임계치에 닿으면 영구 제외한다.
 * @returns 이번 호출로 제외 처리됐으면 true
 */
export function recordFailureSkip(trackId: string): boolean {
  if (blocked.has(trackId)) return false;
  const n = (skipCounts.get(trackId) ?? 0) + 1;
  skipCounts.set(trackId, n);
  saveJson(SKIP_COUNT_KEY, Object.fromEntries(skipCounts));
  if (n < BLOCK_AFTER_SKIPS) return false;
  blocked.add(trackId);
  skipCounts.delete(trackId);
  saveJson(SKIP_COUNT_KEY, Object.fromEntries(skipCounts));
  saveJson(BLOCKED_KEY, [...blocked]);
  return true;
}

/** 앱에서 내린 음원인가. 큐·목록 어디에서도 빠진다. */
export function isTrackBlocked(trackId: string | null | undefined): boolean {
  return trackId != null && blocked.has(trackId);
}

export function failureSkipCount(trackId: string): number {
  return skipCounts.get(trackId) ?? 0;
}

export function blockedTrackIds(): readonly string[] {
  return [...blocked];
}

/** 음원이 고쳐졌을 때 되돌리는 통로. */
export function clearBlockedTracks(): void {
  blocked.clear();
  skipCounts.clear();
  saveJson(BLOCKED_KEY, []);
  saveJson(SKIP_COUNT_KEY, {});
}

export function markTrackFailed(trackId: string, now: number = Date.now()): void {
  failedAt.set(trackId, now);
  if (failedAt.size > FAILED_TRACK_MAX) pruneFailedTracks(now);
}

/** 아직 유효한 실패 기록이 있는가. 만료된 기록은 조회 시점에 치운다. */
export function isTrackFailed(trackId: string, now: number = Date.now()): boolean {
  const at = failedAt.get(trackId);
  if (at === undefined) return false;
  if (now - at >= FAILED_TRACK_TTL_MS) {
    failedAt.delete(trackId);
    return false;
  }
  return true;
}

/** 사용자가 직접 재시도했을 때처럼, 즉시 명단에서 뺀다. */
export function clearTrackFailure(trackId: string): void {
  failedAt.delete(trackId);
}

/** 만료된 기록 정리. 지운 개수를 돌려준다. */
export function pruneFailedTracks(now: number = Date.now()): number {
  let removed = 0;
  for (const [id, at] of failedAt) {
    if (now - at >= FAILED_TRACK_TTL_MS) {
      failedAt.delete(id);
      removed += 1;
    }
  }
  // 그래도 넘치면 오래된 것부터. Map 은 삽입 순서를 지킨다.
  while (failedAt.size > FAILED_TRACK_MAX) {
    const oldest = failedAt.keys().next();
    if (oldest.done) break;
    failedAt.delete(oldest.value);
    removed += 1;
  }
  return removed;
}

export function failedTrackCount(): number {
  return failedAt.size;
}

/** 테스트 전용 — 모듈 전역 상태를 비운다. */
export function resetFailedTracks(): void {
  failedAt.clear();
  clearBlockedTracks();
}
