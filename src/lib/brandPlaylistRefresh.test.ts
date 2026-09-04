import { describe, it, expect } from 'vitest';
import {
  kstMinutesOfDay, nextPollDelayMs, shouldSwapPlaylist,
  FAST_POLL_MS, SLOW_POLL_MS,
} from './brandPlaylistRefresh';

/** 주어진 KST 시:분에 해당하는 Date (UTC 기준으로 -9h). */
function kst(h: number, m: number): Date {
  return new Date(Date.UTC(2026, 8, 4, h - 9, m, 0));
}

describe('kstMinutesOfDay', () => {
  it('UTC 00:00 은 KST 09:00', () => {
    expect(kstMinutesOfDay(new Date(Date.UTC(2026, 8, 4, 0, 0, 0)))).toBe(9 * 60);
  });
  it('자정을 넘겨도 KST 로 환산된다', () => {
    // UTC 16:30 = KST 다음날 01:30
    expect(kstMinutesOfDay(new Date(Date.UTC(2026, 8, 4, 16, 30, 0)))).toBe(90);
  });
});

describe('nextPollDelayMs', () => {
  it('09:00~09:10 KST 에는 1분마다 확인한다 (09:01 반영 보장)', () => {
    expect(nextPollDelayMs(kst(9, 0))).toBe(FAST_POLL_MS);
    expect(nextPollDelayMs(kst(9, 4))).toBe(FAST_POLL_MS);
    expect(nextPollDelayMs(kst(9, 9))).toBe(FAST_POLL_MS);
  });
  it('창을 벗어나면 느슨하게 확인한다', () => {
    expect(nextPollDelayMs(kst(9, 10))).toBe(SLOW_POLL_MS);
    expect(nextPollDelayMs(kst(3, 0))).toBe(SLOW_POLL_MS);
    expect(nextPollDelayMs(kst(21, 0))).toBe(SLOW_POLL_MS);
  });

  it('느린 주기로 09:01 을 지나치지 않는다 (반영 마감 보장)', () => {
    // 08:55 → 10분 뒤(09:05)가 아니라 09:01 에 깨어난다
    expect(nextPollDelayMs(kst(8, 55))).toBe(6 * 60_000);
    // 08:59 → 남은 2분이지만 최소 1분 주기는 지킨다
    expect(nextPollDelayMs(kst(8, 59))).toBe(2 * 60_000);
    // 09:00 직전 1분 미만이어도 1분 미만으로는 내려가지 않는다
    expect(nextPollDelayMs(kst(9, 0, ))).toBe(FAST_POLL_MS);
  });
});

describe('shouldSwapPlaylist', () => {
  it('버전이 달라지면 교체한다', () => {
    expect(shouldSwapPlaylist('20260903T000000', '20260904T000000')).toBe(true);
  });
  it('같은 버전이면 교체하지 않는다 (불필요한 큐 조작 방지)', () => {
    expect(shouldSwapPlaylist('20260904T000000', '20260904T000000')).toBe(false);
  });
  it('첫 응답(기준값 없음)은 교체하지 않는다', () => {
    expect(shouldSwapPlaylist(null, '20260904T000000')).toBe(false);
  });
  it('서버가 버전을 주지 않으면 교체하지 않는다 (레거시 안전)', () => {
    expect(shouldSwapPlaylist('20260904T000000', null)).toBe(false);
    expect(shouldSwapPlaylist('20260904T000000', undefined)).toBe(false);
    expect(shouldSwapPlaylist('20260904T000000', '')).toBe(false);
  });
});
