import { describe, it, expect } from 'vitest';
import {
  fieldOrAbsent,
  formatDDay,
  normalizeOperationalStatus,
  normalizeHeartbeatState,
  formatRelativeTime,
  OPERATIONAL_STATUS_LABEL,
  OPERATIONAL_STATUS_TONE,
  HEARTBEAT_STATE_LABEL,
} from '@/lib/hqOpsFleet';

describe('fieldOrAbsent', () => {
  it('빈 값은 표준 부재 문구로 대체 (가짜 값 금지)', () => {
    expect(fieldOrAbsent(null)).toBe('데이터 없음');
    expect(fieldOrAbsent(undefined)).toBe('데이터 없음');
    expect(fieldOrAbsent('')).toBe('데이터 없음');
    expect(fieldOrAbsent('   ')).toBe('데이터 없음');
    expect(fieldOrAbsent(null, '미지원')).toBe('미지원');
    expect(fieldOrAbsent(undefined, '수집 전')).toBe('수집 전');
  });
  it('실제 값은 문자열로 보존', () => {
    expect(fieldOrAbsent('카페')).toBe('카페');
    expect(fieldOrAbsent(0)).toBe('0');
    expect(fieldOrAbsent(85)).toBe('85');
  });
});

describe('formatDDay', () => {
  it('null 은 데이터 없음', () => {
    expect(formatDDay(null)).toBe('데이터 없음');
    expect(formatDDay(undefined)).toBe('데이터 없음');
  });
  it('경계값', () => {
    expect(formatDDay(0)).toBe('D-Day');
    expect(formatDDay(30)).toBe('D-30');
    expect(formatDDay(-3)).toBe('만료 3일 경과');
  });
});

describe('normalizeOperationalStatus', () => {
  it('서버 값을 신뢰하되 유효 상태만 통과', () => {
    expect(normalizeOperationalStatus({ status: 'CRITICAL', reasons: ['재생 오류'] }))
      .toEqual({ status: 'CRITICAL', reasons: ['재생 오류'] });
    expect(normalizeOperationalStatus({ status: 'HEALTHY', reasons: [] }))
      .toEqual({ status: 'HEALTHY', reasons: [] });
  });
  it('누락/오염 시 UNKNOWN 폴백 (클라이언트 재계산 아님)', () => {
    expect(normalizeOperationalStatus(null)).toEqual({ status: 'UNKNOWN', reasons: [] });
    expect(normalizeOperationalStatus({ status: 'BOGUS' })).toEqual({ status: 'UNKNOWN', reasons: [] });
    expect(normalizeOperationalStatus({ status: 'WARNING', reasons: 'x' }))
      .toEqual({ status: 'WARNING', reasons: [] });
  });
  it('reasons 배열의 비문자열 항목은 제거', () => {
    expect(normalizeOperationalStatus({ status: 'WARNING', reasons: ['a', 1, null, 'b'] }))
      .toEqual({ status: 'WARNING', reasons: ['a', 'b'] });
  });
  it('모든 상태에 label/tone 정의 존재', () => {
    (['HEALTHY', 'WARNING', 'CRITICAL', 'OFFLINE', 'UNKNOWN'] as const).forEach((s) => {
      expect(OPERATIONAL_STATUS_LABEL[s]).toBeTruthy();
      expect(OPERATIONAL_STATUS_TONE[s]).toBeTruthy();
    });
  });
});

describe('normalizeHeartbeatState', () => {
  it('유효 상태 통과 · 그 외 UNKNOWN', () => {
    expect(normalizeHeartbeatState('ONLINE')).toBe('ONLINE');
    expect(normalizeHeartbeatState('STALE')).toBe('STALE');
    expect(normalizeHeartbeatState('nope')).toBe('UNKNOWN');
    expect(normalizeHeartbeatState(undefined)).toBe('UNKNOWN');
    expect(HEARTBEAT_STATE_LABEL.ONLINE).toBe('온라인');
  });
});

describe('formatRelativeTime', () => {
  const now = Date.UTC(2026, 6, 24, 12, 0, 0);
  it('null 은 수집 전', () => {
    expect(formatRelativeTime(null, now)).toBe('수집 전');
    expect(formatRelativeTime(undefined, now)).toBe('수집 전');
  });
  it('경과 구간별 표기', () => {
    expect(formatRelativeTime(new Date(now - 30_000).toISOString(), now)).toBe('30초 전');
    expect(formatRelativeTime(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5분 전');
    expect(formatRelativeTime(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe('3시간 전');
    expect(formatRelativeTime(new Date(now - 2 * 86_400_000).toISOString(), now)).toBe('2일 전');
  });
  it('미래 시각은 방금', () => {
    expect(formatRelativeTime(new Date(now + 10_000).toISOString(), now)).toBe('방금');
  });
  it('잘못된 문자열은 데이터 없음', () => {
    expect(formatRelativeTime('not-a-date', now)).toBe('데이터 없음');
  });
});
