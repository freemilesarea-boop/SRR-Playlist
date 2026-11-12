// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const beats: Array<{ instanceId: string; brandId?: string | null; armed: boolean }> = [];
const goodbyes: string[] = [];
vi.mock('@/lib/api/announcementApi', () => ({
  sendAnnouncerHeartbeat: (i: { instanceId: string; brandId?: string | null; armed: boolean }) => { beats.push(i); return Promise.resolve(); },
  sendAnnouncerGoodbye: (id: string) => { goodbyes.push(id); return Promise.resolve(); },
}));

import { useAnnouncerHeartbeat } from './useAnnouncerHeartbeat';

describe('useAnnouncerHeartbeat', () => {
  beforeEach(() => { beats.length = 0; goodbyes.length = 0; vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('진입 즉시 + 60초마다 알리고, armed 가 바뀌면 바로 알린다', () => {
    const { rerender } = renderHook((p: { armed: boolean }) => useAnnouncerHeartbeat({ enabled: true, armed: p.armed, brandId: 'b1' }), {
      initialProps: { armed: false },
    });
    expect(beats.length).toBeGreaterThanOrEqual(1);
    expect(beats.every((b) => b.brandId === 'b1' && b.armed === false)).toBe(true);
    const n = beats.length;
    vi.advanceTimersByTime(60_000);
    expect(beats.length).toBe(n + 1);
    rerender({ armed: true });
    expect(beats.at(-1)?.armed).toBe(true);
  });

  it('창을 떠나면 goodbye 로 즉시 내린다 — 음악 플레이어가 바로 이어받게', () => {
    const { unmount } = renderHook(() => useAnnouncerHeartbeat({ enabled: true, armed: true }));
    const id = beats[0].instanceId;
    unmount();
    expect(goodbyes).toContain(id);
    const n = beats.length;
    vi.advanceTimersByTime(120_000);
    expect(beats.length).toBe(n);
  });

  it('enabled=false 면 아무것도 보내지 않는다', () => {
    renderHook(() => useAnnouncerHeartbeat({ enabled: false, armed: true }));
    vi.advanceTimersByTime(120_000);
    expect(beats.length).toBe(0);
  });
});
