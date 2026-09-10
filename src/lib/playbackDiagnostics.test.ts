// 매장 재생 중단 원인 기록 — 순수 판정 로직 테스트.
// 숙대점 사례(20초 세션 272건 / 102분 무음)에서 원인을 특정 못 했던 공백을 메우는 코드라
// 판정 기준을 못 박아둔다.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isCutShort, isDiagnosticReason, markReloadReason, takeReloadReason } from './playbackDiagnostics';

describe('isCutShort — 곡이 끝까지 갔는지', () => {
  it('숙대점 사례: 200초 곡이 20초에 끊김 → 중단', () => {
    expect(isCutShort({ playedSeconds: 20, trackDurationSeconds: 200 })).toBe(true);
  });

  it('거의 다 재생됨(90%) → 정상', () => {
    expect(isCutShort({ playedSeconds: 180, trackDurationSeconds: 200 })).toBe(false);
  });

  it('크로스페이드 여유 — 80% 지점은 정상으로 본다', () => {
    expect(isCutShort({ playedSeconds: 160, trackDurationSeconds: 200 })).toBe(false);
    expect(isCutShort({ playedSeconds: 159, trackDurationSeconds: 200 })).toBe(true);
  });

  it('사용자가 직접 넘긴 건 중단이 아니다', () => {
    expect(isCutShort({ playedSeconds: 5, trackDurationSeconds: 200, userSkipped: true })).toBe(false);
  });

  it('곡 길이를 모르면 30초 미만만 중단 — 오탐 방지', () => {
    expect(isCutShort({ playedSeconds: 20, trackDurationSeconds: null })).toBe(true);
    expect(isCutShort({ playedSeconds: 45, trackDurationSeconds: null })).toBe(false);
    expect(isCutShort({ playedSeconds: 45, trackDurationSeconds: undefined })).toBe(false);
  });

  it('비정상 입력은 중단으로 보지 않는다', () => {
    expect(isCutShort({ playedSeconds: 0, trackDurationSeconds: 200 })).toBe(false);
    expect(isCutShort({ playedSeconds: Number.NaN, trackDurationSeconds: 200 })).toBe(false);
    expect(isCutShort({ playedSeconds: -5, trackDurationSeconds: 200 })).toBe(false);
  });
});

describe('isDiagnosticReason', () => {
  it('알려진 사유만 통과', () => {
    expect(isDiagnosticReason('sw_update')).toBe(true);
    expect(isDiagnosticReason('chunk_error')).toBe(true);
    expect(isDiagnosticReason('made_up')).toBe(false);
    expect(isDiagnosticReason(null)).toBe(false);
    expect(isDiagnosticReason(123)).toBe(false);
  });
});

describe('리로드 사유 전달 (sessionStorage 1회성)', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });

  it('심은 사유를 다음 로드가 읽는다', () => {
    markReloadReason('sw_update');
    expect(takeReloadReason()).toBe('sw_update');
  });

  it('한 번 읽으면 사라진다 — 오래된 사유가 계속 따라붙지 않도록', () => {
    markReloadReason('chunk_error');
    expect(takeReloadReason()).toBe('chunk_error');
    expect(takeReloadReason()).toBe('fresh_load');
  });

  it('아무것도 없으면 fresh_load (사용자가 직접 연 경우)', () => {
    expect(takeReloadReason()).toBe('fresh_load');
  });
});
