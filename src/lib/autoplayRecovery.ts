/**
 * autoplayRecovery.ts — 자동재생 차단이 **실제로 풀린 순간**을 정확히 1회 기록한다.
 *
 * 왜 필요한가: `autoplay_recovered` 는 진단 enum 에만 존재하고 이를 기록하는 코드가
 * 어디에도 없었다. 그래서 차단된 매장이 언제, 어떻게 풀렸는지 — 사람이 화면을
 * 눌러서인지, 다른 경로로 저절로인지 — 우리는 알 수가 없었다. 숙대점 조사에서
 * `autoplay_blocked` 3건에 `autoplay_recovered` 0건이 나온 것은 "복구된 적이 없다"
 * 가 아니라 "기록한 적이 없다" 였다.
 *
 * 판정 기준은 다른 곳과 같다 — **실제로 소리가 났는가**. 차단 플래그가 false 로
 * 바뀌었다는 것만으로는 복구가 아니다(오버레이를 눌렀어도 재생이 실패할 수 있다).
 *
 * 출처는 **아는 것만** 적는다. 오버레이를 눌러 풀린 것은 우리가 아는 사실이고,
 * 그 외에는 'unknown' 이다. 추측해서 채우지 않는다.
 */

/** 차단이 풀린 경로. 확실히 아는 것만 값을 갖는다. */
export type AutoplayUnblockSource =
  /** PlaybackBlockedOverlay 를 사람이 눌렀다 — 우리가 직접 아는 경우. */
  | 'overlay_tap'
  /** 그 외. 어떻게 풀렸는지 모른다 — 추측하지 않는다. */
  | 'unknown';

export interface AutoplayRecoveryReport {
  source: AutoplayUnblockSource;
  /** 차단 상태로 있었던 시간(ms). 차단 시각을 모르면 null. */
  blockedForMs: number | null;
}

let armed = false;
let blockedAt: number | null = null;
let pendingSource: AutoplayUnblockSource | null = null;

/** play() 가 NotAllowedError 로 거절됐을 때. 이때부터 복구 보고를 기다린다. */
export function noteAutoplayBlocked(nowMs: number = Date.now()): void {
  armed = true;
  blockedAt = nowMs;
}

/**
 * 오버레이를 눌러 차단을 푼 순간. 아직 소리가 난 것은 아니므로 **보고하지 않는다** —
 * 실제 재생이 시작되면 그때 이 출처가 함께 기록된다.
 */
export function markAutoplayUnblockSource(source: AutoplayUnblockSource): void {
  if (!armed) return;
  pendingSource = source;
}

/**
 * 실제로 소리가 나기 시작했다. 차단 구간이 열려 있었으면 보고 내용을 돌려주고
 * 상태를 닫는다 — 같은 차단 구간에 대해 **두 번 돌려주지 않는다**.
 *
 * @returns 보고할 내용, 또는 차단 구간이 아니었으면 null
 */
export function noteAudiblePlayback(nowMs: number = Date.now()): AutoplayRecoveryReport | null {
  if (!armed) return null;
  armed = false;
  const source = pendingSource ?? 'unknown';
  const report: AutoplayRecoveryReport = {
    source,
    blockedForMs: blockedAt === null ? null : Math.max(0, nowMs - blockedAt),
  };
  pendingSource = null;
  blockedAt = null;
  return report;
}

/** 지금 차단 복구를 기다리는 중인가 (테스트·진단용). */
export function isAwaitingAutoplayRecovery(): boolean {
  return armed;
}

/** 테스트 전용 초기화. */
export function resetAutoplayRecovery(): void {
  armed = false;
  blockedAt = null;
  pendingSource = null;
}
