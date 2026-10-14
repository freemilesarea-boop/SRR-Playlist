/**
 * 재생 불가 음원 처리 회귀.
 *
 * 실기기에서 확인된 것: Android WebView 가 디코딩하지 못하는 mp3 한 곡이
 * 805곡·448곡짜리 플레이리스트 다섯 개에 들어 있었고, 그 곡이 큐 앞에 걸리면
 * 플레이리스트 전체가 재생 불가로 보였다. 플레이어가 건너뛰지 않고 그 자리에서
 * 멈췄기 때문이다.
 *
 * 두 가지를 못 박는다: 영구 오류는 모드와 무관하게 건너뛴다는 것, 그리고
 * 열 번 건너뛰어진 음원은 앱에서 빠진다는 것.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  recordFailureSkip, isTrackBlocked, failureSkipCount, blockedTrackIds,
  clearBlockedTracks, resetFailedTracks, BLOCK_AFTER_SKIPS, SKIP_DEDUPE_WINDOW_MS,
} from './failedTracks';
import { getTrackPlaybackState, filterPlayableTracks } from './trackPlayability';
import { isPlayableTrack } from './audio';
import type { TrackRow } from '@/types/db';

const track = (id: string) =>
  ({ id, title: id, audio_url: `https://example.com/${id}.mp3` }) as unknown as TrackRow;

describe('반복 실패 누적', () => {
  beforeEach(() => resetFailedTracks());

  // 서로 다른 때에 실패해야 한 번씩 센다 (아래 '중복 억제' 참고).
  const far = (i: number) => i * SKIP_DEDUPE_WINDOW_MS;

  it('임계치 전에는 제외하지 않는다', () => {
    for (let i = 1; i < BLOCK_AFTER_SKIPS; i++) {
      expect(recordFailureSkip('t1', far(i))).toBe(false);
      expect(failureSkipCount('t1')).toBe(i);
    }
    expect(isTrackBlocked('t1')).toBe(false);
  });

  it(`${BLOCK_AFTER_SKIPS}번째에 앱에서 내린다`, () => {
    for (let i = 1; i < BLOCK_AFTER_SKIPS; i++) recordFailureSkip('t1', far(i));
    expect(recordFailureSkip('t1', far(BLOCK_AFTER_SKIPS))).toBe(true);
    expect(isTrackBlocked('t1')).toBe(true);
    expect(blockedTrackIds()).toContain('t1');
  });

  it('이미 제외된 음원은 다시 세지 않는다', () => {
    for (let i = 1; i <= BLOCK_AFTER_SKIPS; i++) recordFailureSkip('t1', far(i));
    expect(recordFailureSkip('t1', far(BLOCK_AFTER_SKIPS + 1))).toBe(false);
  });

  it('곡마다 따로 센다', () => {
    for (let i = 1; i <= BLOCK_AFTER_SKIPS; i++) recordFailureSkip('bad', far(i));
    recordFailureSkip('ok', far(1));
    expect(isTrackBlocked('bad')).toBe(true);
    expect(isTrackBlocked('ok')).toBe(false);
  });

  it('음원이 고쳐지면 되돌릴 수 있다', () => {
    for (let i = 1; i <= BLOCK_AFTER_SKIPS; i++) recordFailureSkip('t1', far(i));
    clearBlockedTracks();
    expect(isTrackBlocked('t1')).toBe(false);
  });

  // 이게 없으면 멀쩡한 음원이 전송 실패 열 번에 앱에서 사라진다.
  // 실제로 실패한 음원을 ffprobe 로 보니 192kbps 44.1kHz 정상 mp3 였다.
  it('짧은 간격의 반복 실패는 한 번으로 센다', () => {
    expect(recordFailureSkip('t1', 1_000)).toBe(false);
    for (let i = 0; i < 50; i++) recordFailureSkip('t1', 1_000 + i * 10);
    expect(failureSkipCount('t1')).toBe(1);
    expect(isTrackBlocked('t1')).toBe(false);
  });

  it('간격이 지나면 다시 센다', () => {
    recordFailureSkip('t1', 0);
    recordFailureSkip('t1', SKIP_DEDUPE_WINDOW_MS - 1);
    expect(failureSkipCount('t1')).toBe(1);
    recordFailureSkip('t1', SKIP_DEDUPE_WINDOW_MS);
    expect(failureSkipCount('t1')).toBe(2);
  });

  it('빈 값에 대해 안전하다', () => {
    expect(isTrackBlocked(null)).toBe(false);
    expect(isTrackBlocked(undefined)).toBe(false);
  });
});

describe('제외된 음원은 어디에도 안 나온다', () => {
  beforeEach(() => {
    resetFailedTracks();
    for (let i = 1; i <= BLOCK_AFTER_SKIPS; i++) recordFailureSkip('bad', i * SKIP_DEDUPE_WINDOW_MS);
  });

  it('목록에서 재생 불가로 표시된다', () => {
    expect(getTrackPlaybackState({ id: 'bad', audio_url: 'https://x/y.mp3' })).toBe('error');
    expect(getTrackPlaybackState({ id: 'ok', audio_url: 'https://x/y.mp3' })).toBe('ready');
  });

  it('큐 필터에서 떨어진다', () => {
    const { playable, dropped } = filterPlayableTracks([track('ok'), track('bad'), track('ok2')]);
    expect(playable.map((t) => t.id)).toEqual(['ok', 'ok2']);
    expect(dropped.map((t) => t.id)).toEqual(['bad']);
  });

  // setQueue 가 쓰는 마지막 안전망 — 호출 측이 필터를 잊어도 걸러져야 한다.
  it('setQueue 안전망에서도 떨어진다', () => {
    expect(isPlayableTrack(track('bad'))).toBe(false);
    expect(isPlayableTrack(track('ok'))).toBe(true);
  });
});

describe('Player 배선', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../components/player/Player.tsx', import.meta.url)), 'utf8');

  it('재생 불가 곡에서 멈추지 않고 다음 곡으로 넘긴다', () => {
    const at = src.indexOf('playing && isTrackFailed(current.id)');
    expect(at).toBeGreaterThan(0);
    const skipAt = src.indexOf("next({ cause: 'skip_error' })", at);
    expect(skipAt).toBeGreaterThan(at);          // 같은 분기 안에서 넘긴다
    const block = src.slice(at, skipAt);
    // 멈추면 그 곡이 든 플레이리스트가 통째로 죽는다.
    expect(block).not.toMatch(/\bpause\(\)/);
  });

  it('건너뛸 때마다 누적한다', () => {
    expect(src).toContain('recordFailureSkip(');
  });
});
