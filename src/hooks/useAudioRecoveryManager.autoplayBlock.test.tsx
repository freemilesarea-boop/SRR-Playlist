// @vitest-environment jsdom
//
// AUTOPLAY-BLOCK-PARITY — 복구 매니저가 자동재생 차단을 화면·서버에 알리는가.
//
// 이 파일이 잡은 갭 (화정점 2026-10-05 07:08): Flight Recorder 에 이 경로의
// `PLAY_REJECTED errName:NotAllowedError` 가 4건 찍혔는데
// store_playback_diagnostics 의 `autoplay_blocked` 는 26시간 내내 0건이었다.
//
// 원인은 경로 분기였다. Player.tsx 의 play() 래퍼는 NotAllowedError 에서
// setAutoplayBlocked(true) → 전체화면 안내 → 진단 기록까지 하는데, 이 훅의 tryPlay 는
// 지역 catch 로 끝나 그 셋을 전부 건너뛰었다. 그래서 무인 매장 점주는 "화면을 한 번
// 눌러주세요" 안내를 못 보고, 서버는 차단 사실을 몰랐다.
//
// 자동재생 차단은 코드로 뚫을 수 없다 — 그래서 이 테스트가 지키는 것은 "뚫는다" 가
// 아니라 **알린다** 뿐이다.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/** 호출 인자를 타입으로 고정한다 — tsc -b 가 테스트 파일도 검사한다. */
type DiagOpts = { reason?: string; playerMode?: string; context?: Record<string, unknown> };
const logPlaybackDiagnostic = vi.fn((_event: string, _opts?: DiagOpts) => Promise.resolve());
vi.mock('@/lib/playbackDiagnostics', () => ({
  logPlaybackDiagnostic: (event: string, opts?: DiagOpts) => logPlaybackDiagnostic(event, opts),
}));

import { useAudioRecoveryManager, type RecoveryContext } from './useAudioRecoveryManager';
import { usePlaybackHealthStore } from '@/store/playbackHealthStore';
import { useBusinessStore } from '@/store/businessStore';

/** play() 가 지정한 에러로 거절되는 가짜 오디오 엘리먼트. */
function fakeAudio(errName: string | null): HTMLAudioElement {
  return {
    paused: true,
    readyState: 4,
    networkState: 1,
    currentTime: 15,
    play: () => (errName === null
      ? Promise.resolve()
      : Promise.reject(Object.assign(new Error(errName), { name: errName }))),
    pause: () => {},
  } as unknown as HTMLAudioElement;
}

function ctxFor(el: HTMLAudioElement): RecoveryContext {
  return {
    audioARef: { current: el },
    audioBRef: { current: null },
    getActiveIdx: () => 0,
    getCrossfading: () => false,
    getForceCompleteCrossfade: () => null,
    ensureSinkReady: () => Promise.resolve(true),
    // 재생 의도가 있어야 복구가 play() 를 시도한다.
    getPlayingExpected: () => true,
  };
}

describe('복구 매니저 — 자동재생 차단 보고', () => {
  beforeEach(() => {
    logPlaybackDiagnostic.mockClear();
    usePlaybackHealthStore.getState().setAutoplayBlocked(false);
    useBusinessStore.getState().setBusinessMode(true);
  });

  it('NotAllowedError 면 전체화면 안내 상태를 켜고 서버에 알린다', async () => {
    const { result } = renderHook(() => useAudioRecoveryManager(ctxFor(fakeAudio('NotAllowedError'))));

    await act(async () => { await result.current.recoverAudio('stalled'); });

    // 점주가 "화면을 눌러주세요" 안내를 볼 수 있는 상태가 됐는가.
    expect(usePlaybackHealthStore.getState().autoplayBlocked).toBe(true);

    // 서버가 차단 사실을 알게 됐는가.
    const call = logPlaybackDiagnostic.mock.calls.find((c) => c[0] === 'autoplay_blocked');
    expect(call).toBeDefined();
    expect(call?.[1]?.context?.site).toBe('recovery-manager');
    expect(call?.[1]?.context?.recoveryReason).toBe('stalled');
  });

  it('차단이 아닌 실패(예: AbortError)에는 안내를 켜지 않는다', async () => {
    const { result } = renderHook(() => useAudioRecoveryManager(ctxFor(fakeAudio('AbortError'))));

    await act(async () => { await result.current.recoverAudio('stalled'); });

    expect(usePlaybackHealthStore.getState().autoplayBlocked).toBe(false);
    expect(logPlaybackDiagnostic.mock.calls.some((c) => c[0] === 'autoplay_blocked')).toBe(false);
  });

  it('play() 가 성공하면 아무것도 보고하지 않는다', async () => {
    const { result } = renderHook(() => useAudioRecoveryManager(ctxFor(fakeAudio(null))));

    await act(async () => { await result.current.recoverAudio('stalled'); });

    expect(usePlaybackHealthStore.getState().autoplayBlocked).toBe(false);
    expect(logPlaybackDiagnostic.mock.calls.some((c) => c[0] === 'autoplay_blocked')).toBe(false);
  });

  it('매장 모드가 아니면 보고하지 않는다 — 일반 청취자 동작 변화 0', async () => {
    useBusinessStore.getState().setBusinessMode(false);
    const { result } = renderHook(() => useAudioRecoveryManager(ctxFor(fakeAudio('NotAllowedError'))));

    await act(async () => { await result.current.recoverAudio('stalled'); });

    expect(usePlaybackHealthStore.getState().autoplayBlocked).toBe(false);
    expect(logPlaybackDiagnostic.mock.calls.some((c) => c[0] === 'autoplay_blocked')).toBe(false);
  });
});
