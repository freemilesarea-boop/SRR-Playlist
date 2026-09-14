// @vitest-environment jsdom
//
// LEGACY-ANDROID §10 — Wake Lock 재획득.
//
// 구형 Android PWA 에서 화면 꺼짐 방지는 웹 Wake Lock 하나뿐이다(네이티브 쉘이
// 없으므로 KeepAwake 는 쓸 수 없다). 그게 풀리면 화면이 꺼지고 WebView 가
// 스로틀되어 재생이 끊긴다 — 무인 매장에서는 그게 곧 무음이다.
//
// 이 파일이 잡은 갭 (2026-09-14): OS 가 lock 을 스스로 풀었을 때
// (배터리 절약 모드 진입 등) 훅은 상태만 false 로 되돌리고 **다시 잡지 않았다.**
// 재획득 경로가 visibilitychange 하나뿐이라, 화면이 계속 보이는 매장 태블릿에서는
// 그 이벤트가 오지 않아 영영 잠금 없이 돌았다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const acquireScreenAwake = vi.fn();
vi.mock('@/lib/screenAwake', () => ({
  screenAwakeMode: () => 'web',
  acquireScreenAwake: () => acquireScreenAwake(),
}));

import { useWakeLock } from './useWakeLock';
import { usePlaybackHealthStore } from '@/store/playbackHealthStore';

/** 획득될 때마다 새 handle 을 주고, onLost 콜백을 밖에서 부를 수 있게 잡아둔다. */
function makeHandle() {
  let lost: (() => void) | null = null;
  const h = {
    mode: 'web' as const,
    release: vi.fn(async () => {}),
    onLost: (cb: () => void) => { lost = cb; },
  };
  return { h, fireLost: () => lost?.() };
}

beforeEach(() => {
  vi.useFakeTimers();
  acquireScreenAwake.mockReset();
  usePlaybackHealthStore.getState().setWakeLock(true, false);
  Object.defineProperty(document, 'visibilityState', {
    configurable: true, get: () => 'visible',
  });
});
afterEach(() => { vi.useRealTimers(); });

describe('lock 을 잃으면 보이는 동안 다시 잡는다', () => {
  it('OS 가 풀면 재획득을 시도한다 (visibilitychange 를 기다리지 않는다)', async () => {
    const first = makeHandle();
    const second = makeHandle();
    acquireScreenAwake.mockResolvedValueOnce(first.h).mockResolvedValueOnce(second.h);

    renderHook(() => useWakeLock(true));
    await act(async () => { await Promise.resolve(); });
    expect(acquireScreenAwake).toHaveBeenCalledTimes(1);

    await act(async () => { first.fireLost(); await Promise.resolve(); });
    // 즉시가 아니라 backoff 뒤에 시도한다.
    expect(acquireScreenAwake).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(acquireScreenAwake).toHaveBeenCalledTimes(2);
  });

  it('재시도는 유계다 — 무한 루프를 돌지 않는다', async () => {
    const first = makeHandle();
    acquireScreenAwake.mockResolvedValueOnce(first.h).mockResolvedValue(null);

    renderHook(() => useWakeLock(true));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { first.fireLost(); await Promise.resolve(); });

    // 1+2+4+8+16 초를 훌쩍 넘겨도 시도 횟수는 예산 안에서 멈춘다.
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    // 최초 1회 + 재시도 최대 5회
    expect(acquireScreenAwake.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it('문서가 숨겨져 있으면 재시도하지 않는다 (거부가 예산만 태운다)', async () => {
    const first = makeHandle();
    acquireScreenAwake.mockResolvedValueOnce(first.h).mockResolvedValue(null);

    renderHook(() => useWakeLock(true));
    await act(async () => { await Promise.resolve(); });

    Object.defineProperty(document, 'visibilityState', {
      configurable: true, get: () => 'hidden',
    });
    await act(async () => { first.fireLost(); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });

    expect(acquireScreenAwake).toHaveBeenCalledTimes(1);
  });

  it('다시 보이게 되면 예산이 되살아난다', async () => {
    const first = makeHandle();
    acquireScreenAwake.mockResolvedValueOnce(first.h).mockResolvedValue(null);

    renderHook(() => useWakeLock(true));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { first.fireLost(); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    const spent = acquireScreenAwake.mock.calls.length;

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    expect(acquireScreenAwake.mock.calls.length).toBeGreaterThan(spent);
  });

  it('언마운트하면 대기 중인 재시도 타이머가 남지 않는다', async () => {
    const first = makeHandle();
    acquireScreenAwake.mockResolvedValueOnce(first.h).mockResolvedValue(null);

    const { unmount } = renderHook(() => useWakeLock(true));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { first.fireLost(); await Promise.resolve(); });

    unmount();
    const after = acquireScreenAwake.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(acquireScreenAwake.mock.calls.length).toBe(after);
  });
});
