// Phase ADMIN-STREAMING-1 — Streaming Intelligence 순수 로직 단위 테스트.
import { describe, it, expect } from 'vitest';
import {
  pct, formatPct, formatNum, formatSeconds, completionRate, skipRate, rateTone,
  streamingIntegrityWarnings, isSupported, unsupportedList,
} from './streamingIntel';
import { EMPTY_STREAMING_SUMMARY, type StreamingSummary } from './adminApi';

function summary(over: Partial<StreamingSummary>): StreamingSummary { return { ...EMPTY_STREAMING_SUMMARY, ...over }; }

// 실데이터 기반(검증된 값)
const REAL = summary({
  now_playing: 5, online_players: 0, offline_players: 5, total_players: 5,
  today_streams: 504, today_listen_seconds: 103839, avg_listen_seconds: 101,
  pb_start: 945, pb_complete: 713, pb_skip: 61, pb_error: 0,
  heartbeat_total: 27759, heartbeat_sessions: 1351,
  support: { playback: true, skip: true, completion: true, heartbeat: true, device_browser: true, player_online: true, streaming_quality: false, buffer: false, crossfade: false, ttfa: false, decoder_error: false, queue: false, scheduler: false, store_playback: false, recovery: false },
});

describe('pct — 0~100, NaN/Infinity 금지', () => {
  it('정상', () => { expect(pct(713, 945)).toBe(75.4); });
  it('분모 0 → null', () => { expect(pct(1, 0)).toBeNull(); });
  it('0/0 → null', () => { expect(pct(0, 0)).toBeNull(); });
  it('clamp 100', () => { expect(pct(200, 100)).toBe(100); });
});

describe('formatPct / formatNum', () => {
  it('pct', () => { expect(formatPct(75.4)).toBe('75.4%'); expect(formatPct(null)).toBe('—'); expect(formatPct(Infinity)).toBe('—'); });
  it('num', () => { expect(formatNum(103839)).toBe('103,839'); expect(formatNum(null)).toBe('—'); });
});

describe('formatSeconds', () => {
  it('시간', () => { expect(formatSeconds(103839)).toBe('28시간 51분'); });
  it('분', () => { expect(formatSeconds(101)).toBe('1분 41초'); });
  it('초', () => { expect(formatSeconds(45)).toBe('45초'); });
  it('null/음수 → —', () => { expect(formatSeconds(null)).toBe('—'); expect(formatSeconds(-1)).toBe('—'); });
});

describe('completionRate / skipRate — 실데이터', () => {
  it('완료율 713/945 = 75.4%', () => { expect(completionRate(REAL)).toBe(75.4); });
  it('스킵율 61/945 = 6.5%', () => { expect(skipRate(REAL)).toBe(6.5); });
  it('재생 없음 → null (분모 0)', () => { expect(completionRate(summary({ pb_start: 0, pb_complete: 0 }))).toBeNull(); });
});

describe('rateTone', () => {
  it('80+ success', () => { expect(rateTone(90)).toBe('success'); });
  it('50~80 warning', () => { expect(rateTone(75.4)).toBe('warning'); });
  it('<50 danger', () => { expect(rateTone(30)).toBe('danger'); });
  it('null neutral', () => { expect(rateTone(null)).toBe('neutral'); });
});

describe('streamingIntegrityWarnings', () => {
  it('실데이터 정상 → 경고 없음', () => { expect(streamingIntegrityWarnings(REAL)).toEqual([]); });
  it('완료 > 시작 → 경고', () => {
    expect(streamingIntegrityWarnings(summary({ pb_start: 10, pb_complete: 20 })).length).toBeGreaterThan(0);
  });
  it('온라인 > 총 Player → 경고', () => {
    expect(streamingIntegrityWarnings(summary({ total_players: 5, online_players: 9 })).some((w) => w.includes('온라인'))).toBe(true);
  });
});

describe('지원 매트릭스', () => {
  it('isSupported', () => {
    expect(isSupported(REAL.support, 'playback')).toBe(true);
    expect(isSupported(REAL.support, 'streaming_quality')).toBe(false);
    expect(isSupported(undefined, 'playback')).toBe(false);
  });
  it('unsupportedList — 실데이터: quality/buffer/crossfade 등 미지원', () => {
    const list = unsupportedList(REAL.support);
    expect(list).toContain('Streaming Quality Score');
    expect(list).toContain('Buffer');
    expect(list).toContain('Crossfade');
    expect(list.length).toBe(9); // 실데이터에서 전부 미지원
  });
  it('전부 지원 시 빈 목록', () => {
    const allTrue: Record<string, boolean> = {};
    for (const t of ['streaming_quality', 'buffer', 'crossfade', 'ttfa', 'decoder_error', 'queue', 'scheduler', 'recovery', 'store_playback']) allTrue[t] = true;
    expect(unsupportedList(allTrue)).toEqual([]);
  });
});
