/**
 * 해지 신호 판정 회귀.
 *
 * 함정이 하나 있다: 진행 중인 달은 아직 데이터가 덜 쌓여서 전월과 비교하면
 * 멀쩡한 회원도 전부 "급감"으로 찍힌다. 그래서 끝난 달끼리만 비교한다.
 */
import { describe, it, expect } from 'vitest';
import {
  isBillingFailure,
  currentKstMonth,
  playbackDrop,
  DROP_BASELINE_SECONDS,
  type PlaybackTrendPoint,
} from './memberChurnSignals';

const pt = (month: string, listened_seconds: number, plays = 10): PlaybackTrendPoint => ({
  month,
  listened_seconds,
  plays,
});

// 2026-10-30 12:00 KST
const NOW = new Date('2026-10-30T03:00:00Z');

describe('isBillingFailure', () => {
  it('결제로 이어지지 않은 status 를 실패로 센다', () => {
    for (const s of ['failed', 'provider_rejected', 'unknown', 'skipped']) {
      expect(isBillingFailure(s)).toBe(true);
    }
  });

  it('성공·진행 중 status 는 실패가 아니다', () => {
    for (const s of ['paid', 'eligible', 'requesting', 'accepted', 'provider_accepted', 'awaiting_webhook', 'reconciled']) {
      expect(isBillingFailure(s)).toBe(false);
    }
  });

  it('빈 값은 실패가 아니다', () => {
    expect(isBillingFailure(null)).toBe(false);
    expect(isBillingFailure(undefined)).toBe(false);
    expect(isBillingFailure('')).toBe(false);
  });
});

describe('currentKstMonth', () => {
  it('UTC 자정 직후도 KST 날짜로 센다', () => {
    // 2026-10-31 15:30 UTC = 2026-11-01 00:30 KST → 11월
    expect(currentKstMonth(new Date('2026-10-31T15:30:00Z'))).toBe('2026-11');
    // 2026-10-31 14:30 UTC = 2026-10-31 23:30 KST → 아직 10월
    expect(currentKstMonth(new Date('2026-10-31T14:30:00Z'))).toBe('2026-10');
  });
});

describe('playbackDrop', () => {
  it('진행 중인 달은 비교에서 뺀다 — 이번 달이 비어 있어도 급감이 아니다', () => {
    const d = playbackDrop(
      [pt('2026-08', 100_000), pt('2026-09', 100_000), pt('2026-10', 1_000)],
      NOW,
    );
    expect(d).not.toBeNull();
    expect(d!.previous.month).toBe('2026-08');
    expect(d!.latest.month).toBe('2026-09');
    expect(d!.dropPercent).toBe(0);
    expect(d!.severe).toBe(false);
  });

  it('끝난 달끼리 절반 이하로 줄면 severe', () => {
    const d = playbackDrop([pt('2026-08', 100_000), pt('2026-09', 20_000), pt('2026-10', 0)], NOW);
    expect(d!.dropPercent).toBe(80);
    expect(d!.severe).toBe(true);
  });

  it('늘어난 달은 감소 0 으로 본다', () => {
    const d = playbackDrop([pt('2026-08', 10_000), pt('2026-09', 90_000), pt('2026-10', 0)], NOW);
    expect(d!.dropPercent).toBe(0);
    expect(d!.severe).toBe(false);
  });

  it('전월 청취가 너무 적으면 신호로 쓰지 않는다', () => {
    const d = playbackDrop(
      [pt('2026-08', DROP_BASELINE_SECONDS - 1), pt('2026-09', 0), pt('2026-10', 0)],
      NOW,
    );
    expect(d).toBeNull();
  });

  it('비교할 끝난 달이 하나뿐이면 null', () => {
    expect(playbackDrop([pt('2026-09', 100_000), pt('2026-10', 0)], NOW)).toBeNull();
    expect(playbackDrop([pt('2026-10', 100_000)], NOW)).toBeNull();
    expect(playbackDrop([], NOW)).toBeNull();
    expect(playbackDrop(null, NOW)).toBeNull();
  });

  it('입력 순서가 뒤섞여 있어도 최신 끝난 달 둘을 고른다', () => {
    const d = playbackDrop(
      [pt('2026-10', 0), pt('2026-07', 50_000), pt('2026-09', 20_000), pt('2026-08', 100_000)],
      NOW,
    );
    expect(d!.previous.month).toBe('2026-08');
    expect(d!.latest.month).toBe('2026-09');
  });
});
