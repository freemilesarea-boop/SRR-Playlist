// 화면 꺼짐 상태에서도 워치독이 돌아야 한다 — 숙대점 34분 정지의 두 번째 원인.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { startBackgroundTicker } from './backgroundTicker';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('startBackgroundTicker', () => {
  it('Worker 를 쓸 수 있으면 Worker 로 돈다 (메인 스레드 스로틀링 회피)', () => {
    const posted: unknown[] = [];
    class FakeWorker {
      onmessage: ((e: { data: string }) => void) | null = null;
      postMessage(m: unknown) { posted.push(m); }
      terminate() { /* noop */ }
    }
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('Blob', class { constructor(public parts: unknown[]) {} });
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });

    const t = startBackgroundTicker(() => {}, 3000);
    expect(t.kind).toBe('worker');
    // 시작 신호에 주기가 실려야 한다.
    expect(posted[0]).toEqual({ type: 'start', intervalMs: 3000 });
    t.stop();
  });

  it('Worker 생성이 막히면 setInterval 로 폴백한다 (더 나빠지지 않는다)', () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', class { constructor() { throw new Error('CSP blocked'); } });
    vi.stubGlobal('Blob', class { constructor(public parts: unknown[]) {} });
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });

    const onTick = vi.fn();
    const t = startBackgroundTicker(onTick, 1000);
    expect(t.kind).toBe('interval');
    vi.advanceTimersByTime(3000);
    expect(onTick).toHaveBeenCalledTimes(3);
    t.stop();
    vi.advanceTimersByTime(3000);
    expect(onTick).toHaveBeenCalledTimes(3); // stop 이후 멈춘다
  });

  it('Worker 자체가 없는 환경에서도 동작한다', () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', undefined);
    const onTick = vi.fn();
    const t = startBackgroundTicker(onTick, 500);
    expect(t.kind).toBe('interval');
    vi.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalledTimes(2);
    t.stop();
  });
});
