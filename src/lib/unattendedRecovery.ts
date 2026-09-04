/**
 * unattendedRecovery.ts — 매장/브랜드 플레이어(무인 24시간 운영) 자동 복구 판정.
 *
 * 배경: 재생 오류가 나면 Player 가 pause() 를 부르고 store.playing=false 가 되는데,
 *   그 순간 자동 복구가 전부 죽는다 — health monitor 의 감지 조건, Recovery Manager 의
 *   shouldAttemptPlay(), wake lock 이 모두 store.playing 을 본다. 무인 매장에서는
 *   ▶ 를 눌러줄 사람이 없어 그대로 영구 정지한다.
 *   (프로덕션에서 브랜드 플레이어 세션이 heartbeat 는 계속 보내면서 같은 곡에
 *    2일간 멈춰 있는 사례 확인)
 *
 * 그래서 매장모드에서는 정지 대신 다음 곡으로 넘긴다. 여기 있는 함수들이 그 판정.
 */

/** HTMLMediaElement.error.code */
export const MEDIA_ERR_ABORTED = 1;
export const MEDIA_ERR_NETWORK = 2;
export const MEDIA_ERR_DECODE = 3;
export const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

/** 재시도해도 소용없는 오류 — 코덱/컨테이너/업로드 문제. */
export function isPermanentMediaError(code: number | null | undefined): boolean {
  return code === MEDIA_ERR_DECODE || code === MEDIA_ERR_SRC_NOT_SUPPORTED;
}

export interface AutoSkipInput {
  /** 매장/브랜드 플레이어 모드인가 (무인 운영). */
  businessMode: boolean;
  /** 사용자 재생 의도 (store.playing). 직접 멈춘 상태면 개입하지 않는다. */
  playing: boolean;
  /** HTMLMediaElement.error.code */
  errorCode: number | null | undefined;
  /** 이 트랙에서 지금까지 소진한 네트워크 자동 재시도 횟수. */
  retryCount: number;
  /** 이 모드의 네트워크 재시도 한도 (매장 3 / 일반 1). */
  maxRetries: number;
}

/**
 * 무인 자동 다음곡으로 넘겨야 하는가.
 *
 * 매장에서 가장 흔한 실패는 Wi-Fi 순간 끊김(NETWORK)인데, 기존 로직은 영구 오류만
 * 자동 스킵해서 정작 흔한 쪽에 무인 복구가 없었다. 재시도를 모두 소진한 네트워크
 * 오류도 포함한다.
 */
export function shouldAutoSkipUnattended(i: AutoSkipInput): boolean {
  if (!i.businessMode || !i.playing) return false;
  if (isPermanentMediaError(i.errorCode)) return true;
  return i.errorCode === MEDIA_ERR_NETWORK && i.retryCount >= i.maxRetries;
}

/** 연속 자동 스킵이 이만큼 쌓이면 전면 장애로 보고 물러난다. */
export const AUTO_SKIP_BACKOFF_STREAK = 5;
export const AUTO_SKIP_DELAY_MS = 3000;
export const AUTO_SKIP_BACKOFF_DELAY_MS = 30000;

/**
 * 다음 곡으로 넘기기까지의 대기 시간.
 * 전 곡이 실패하는 전면 장애(네트워크 단절)에서 3초마다 큐를 무한 순회하며 서버를
 * 두드리는 것을 막는다. 정상 재생이 한 번이라도 되면 streak 은 0 으로 리셋된다.
 */
export function autoSkipDelayMs(streak: number): number {
  return streak >= AUTO_SKIP_BACKOFF_STREAK ? AUTO_SKIP_BACKOFF_DELAY_MS : AUTO_SKIP_DELAY_MS;
}
