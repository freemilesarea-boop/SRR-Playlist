/**
 * BRAND-DAILY-PLAYLIST-1 — 브랜드 플레이어 일일 플레이리스트 반영 타이밍.
 *
 * 서버(pg_cron)가 매일 09:00 KST 에 브랜드별 새 플레이리스트 스냅샷을 만든다.
 * 요구사항: **09:01~09:05 사이에 자동 반영**, 그리고 그 사이에도 음악이 꺼지면 안 된다.
 *
 * 플레이어는 버전만 폴링하다가 값이 바뀌면 큐를 무중단 교체한다. 09시 전후에는
 * 촘촘히(1분), 나머지 시간에는 느슨하게(10분) 폴링해서 반영 시각을 만족시키면서
 * 하루 종일 도는 무인 매장의 불필요한 요청을 줄인다.
 */

/** 교체가 완료되어야 하는 구간 (KST) */
export const REFRESH_WINDOW_START_MIN = 9 * 60; // 09:00
export const REFRESH_WINDOW_END_MIN = 9 * 60 + 10; // 09:10

export const FAST_POLL_MS = 60_000; // 09:00~09:10 — 늦어도 09:01 에 반영
export const SLOW_POLL_MS = 600_000; // 그 외 — 관리자 수동 재생성 등도 10분 내 반영

/** KST 기준 자정으로부터의 분. */
export function kstMinutesOfDay(now: Date = new Date()): number {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.getUTCHours() * 60 + kst.getUTCMinutes();
}

/** 반영 목표 시각 (KST 09:01) — 느린 폴링 중이어도 이 시각은 절대 지나치지 않는다. */
export const REFRESH_DEADLINE_MIN = 9 * 60 + 1; // 09:01

/**
 * 지금 시각 기준 다음 폴링까지의 대기 시간(ms).
 *
 * 09:00~09:10 KST 안에서는 1분, 밖에서는 10분. 다만 느린 주기로 자다가 09:01 을
 * 지나쳐 버리면 "09:01~09:05 반영" 요구를 못 지키므로, 다음 09:01 까지 남은 시간으로
 * 상한을 건다 (예: 08:55 에 계산하면 10분이 아니라 6분 뒤에 깨어난다).
 */
export function nextPollDelayMs(now: Date = new Date()): number {
  const m = kstMinutesOfDay(now);
  const inWindow = m >= REFRESH_WINDOW_START_MIN && m < REFRESH_WINDOW_END_MIN;
  const base = inWindow ? FAST_POLL_MS : SLOW_POLL_MS;
  if (inWindow) return base;
  // 다음 09:01 까지 남은 분 (이미 지났으면 내일)
  const untilMin = (REFRESH_DEADLINE_MIN - m + 24 * 60) % (24 * 60);
  return Math.max(FAST_POLL_MS, Math.min(base, untilMin * 60_000));
}

/**
 * 서버 버전이 바뀌었는가.
 * 첫 응답(known=null)은 기준값을 잡는 것이므로 교체하지 않는다 — 진입 직후 불필요한
 * 큐 교체를 막는다. 서버가 버전을 안 주는 레거시 응답도 교체하지 않는다.
 */
export function shouldSwapPlaylist(known: string | null, incoming: string | null | undefined): boolean {
  if (!incoming) return false;
  if (!known) return false;
  return known !== incoming;
}
