/**
 * 재생 실패 처리 회귀.
 *
 * 실기기에서 "재생 오류가 발생했습니다" 가 뜨고, 그 뒤로는 곡 정보만 보이고
 * 0:00 에 멈춘 채 앱을 껐다 켜야 풀리던 증상의 두 축을 잡는다:
 *   1. 실패가 아닌 것(ABORTED)을 실패로 알리던 것
 *   2. 한 번 실패한 트랙이 세션 내내 영구 차단되던 것
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  isUserVisibleMediaError,
  isBenignPlayRejection,
  formatPlaybackDiag,
  logPlaybackDiag,
  resetPlaybackDiagDedupe,
} from './playbackDiag';
import {
  markTrackFailed, isTrackFailed, clearTrackFailure,
  pruneFailedTracks, failedTrackCount, resetFailedTracks,
  FAILED_TRACK_TTL_MS, FAILED_TRACK_MAX,
} from './failedTracks';

describe('어떤 오류를 사용자에게 알릴 것인가', () => {
  it('DECODE · SRC_NOT_SUPPORTED · NETWORK 는 알린다', () => {
    expect(isUserVisibleMediaError(2)).toBe(true);
    expect(isUserVisibleMediaError(3)).toBe(true);
    expect(isUserVisibleMediaError(4)).toBe(true);
  });

  // 이게 핵심. 로딩 중 src 가 바뀌면 나는 정상 신호라, 플레이리스트를 빠르게
  // 갈아타면 반드시 발생한다. 여기에 토스트를 띄우면 멀쩡히 재생되는 중에도 뜬다.
  it('ABORTED 는 알리지 않는다 — 실패가 아니라 취소다', () => {
    expect(isUserVisibleMediaError(1)).toBe(false);
  });

  it('코드 미상도 알리지 않는다', () => {
    expect(isUserVisibleMediaError(0)).toBe(false);
    expect(isUserVisibleMediaError(null)).toBe(false);
    expect(isUserVisibleMediaError(undefined)).toBe(false);
  });

  it('AbortError · NotAllowedError 는 사용자 잘못이 아니다', () => {
    expect(isBenignPlayRejection('AbortError')).toBe(true);
    expect(isBenignPlayRejection('NotAllowedError')).toBe(true);
    expect(isBenignPlayRejection('NotSupportedError')).toBe(false);
  });
});

describe('실패 명단 수명', () => {
  beforeEach(() => resetFailedTracks());

  it('표시하면 실패로 잡힌다', () => {
    markTrackFailed('t1', 1_000);
    expect(isTrackFailed('t1', 1_000)).toBe(true);
  });

  // 앱 재시작이 유일한 복구 수단이면 안 된다.
  it('유효기간이 지나면 스스로 풀린다', () => {
    markTrackFailed('t1', 1_000);
    expect(isTrackFailed('t1', 1_000 + FAILED_TRACK_TTL_MS - 1)).toBe(true);
    expect(isTrackFailed('t1', 1_000 + FAILED_TRACK_TTL_MS)).toBe(false);
  });

  it('만료된 기록은 조회 시점에 사라진다', () => {
    markTrackFailed('t1', 0);
    isTrackFailed('t1', FAILED_TRACK_TTL_MS);
    expect(failedTrackCount()).toBe(0);
  });

  it('수동 재시도는 즉시 푼다', () => {
    markTrackFailed('t1', 1_000);
    clearTrackFailure('t1');
    expect(isTrackFailed('t1', 1_000)).toBe(false);
  });

  it('prune 이 만료분만 치운다', () => {
    markTrackFailed('old', 0);
    markTrackFailed('new', FAILED_TRACK_TTL_MS);
    const removed = pruneFailedTracks(FAILED_TRACK_TTL_MS);
    expect(removed).toBe(1);
    expect(isTrackFailed('new', FAILED_TRACK_TTL_MS)).toBe(true);
  });

  it('전면 장애에서도 명단이 무한히 늘지 않는다', () => {
    for (let i = 0; i < FAILED_TRACK_MAX + 50; i++) markTrackFailed(`t${i}`, 1_000);
    expect(failedTrackCount()).toBeLessThanOrEqual(FAILED_TRACK_MAX);
  });
});

describe('PLAYBACK_DIAG 한 줄', () => {
  beforeEach(() => {
    resetPlaybackDiagDedupe();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  const audio = (over: Partial<HTMLMediaElement> = {}) => ({
    currentSrc: 'https://x/y.mp3', src: 'https://x/y.mp3',
    readyState: 0, networkState: 3, paused: true, ended: false,
    seeking: false, duration: NaN, currentTime: 0,
    error: { code: 4, message: '' },
    ...over,
  }) as unknown as HTMLMediaElement;

  it('요구된 필드를 전부 담는다', () => {
    const line = formatPlaybackDiag({
      stage: 'media-error', trackId: 'tr1', playlistId: 'pl1', sourceType: 'home',
      audio: audio(), error: new DOMException('nope', 'NotSupportedError'),
    });
    for (const f of [
      'stage=media-error', 'track=tr1', 'playlist=pl1', 'source=home',
      'MEDIA_ERR_SRC_NOT_SUPPORTED', 'NotSupportedError',
      'readyState=0', 'networkState=3', 'paused=true', 'ended=false', 'seeking=false',
    ]) expect(line).toContain(f);
  });

  it('blob 캐시본인지 구분한다 — 캐시 수명 문제를 가르는 단서', () => {
    const line = formatPlaybackDiag({ stage: 'x', audio: audio({ currentSrc: 'blob:abc' }) });
    expect(line).toContain('srcKind=blob(캐시)');
  });

  it('같은 실패를 반복해서 찍지 않는다', () => {
    const i = { stage: 'media-error', trackId: 't', audio: audio() };
    expect(logPlaybackDiag(i)).toBe(true);
    expect(logPlaybackDiag(i)).toBe(false);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('다른 트랙·다른 단계는 따로 찍는다', () => {
    expect(logPlaybackDiag({ stage: 'media-error', trackId: 'a', audio: audio() })).toBe(true);
    expect(logPlaybackDiag({ stage: 'media-error', trackId: 'b', audio: audio() })).toBe(true);
    expect(logPlaybackDiag({ stage: 'play-reject', trackId: 'a', audio: audio() })).toBe(true);
  });

  it('audio 가 없어도 던지지 않는다', () => {
    expect(() => formatPlaybackDiag({ stage: 'x', audio: null })).not.toThrow();
  });
});

describe('Player 배선', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../components/player/Player.tsx', import.meta.url)), 'utf8',
  );

  it('모듈 전역 Set 으로 돌아가지 않았다', () => {
    expect(src).not.toContain('sessionFailedTrackIds');
  });

  it('실패 명단 정리가 매장모드 밖에서도 돈다', () => {
    // businessMode 안에 갇혀 있으면 일반 사용자는 영원히 정리되지 않는다.
    const prune = src.slice(src.indexOf('pruneFailedTracks()') - 400, src.indexOf('pruneFailedTracks()'));
    expect(prune).not.toMatch(/if \(businessMode\) \{[^}]*$/);
  });

  it('media-error 와 play-reject 양쪽에서 진단을 남긴다', () => {
    expect(src).toContain("stage: 'media-error'");
    expect(src).toContain("stage: 'play-reject'");
  });
});
