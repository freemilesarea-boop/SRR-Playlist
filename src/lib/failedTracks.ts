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
}
