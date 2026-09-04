import { describe, it, expect, beforeEach } from 'vitest';
import { usePlayerStore } from '@/store/playerStore';
import type { TrackRow } from '@/types/db';

// Minimal playable track (setQueue keeps only isPlayableTrack rows).
function track(id: string): TrackRow {
  return { id, audio_url: `https://example.com/${id}.mp3` } as unknown as TrackRow;
}

const S = () => usePlayerStore.getState();

describe('playerStore schedule-suppression gate (BRAND-PLAYLIST-ROTATION-4, §29)', () => {
  beforeEach(() => {
    usePlayerStore.setState({
      queue: [],
      index: 0,
      playing: false,
      shuffle: false,
      repeat: 'off',
      scheduleSuppressed: false,
      scheduleSuppressReason: null,
    });
  });

  it('default (no suppression): play/pause behave normally', () => {
    S().play();
    expect(S().playing).toBe(true);
    S().pause();
    expect(S().playing).toBe(false);
  });

  it('setScheduleSuppression("break") pauses immediately and records reason', () => {
    S().play();
    expect(S().playing).toBe(true);
    S().setScheduleSuppression('break');
    expect(S().playing).toBe(false);
    expect(S().scheduleSuppressed).toBe(true);
    expect(S().scheduleSuppressReason).toBe('break');
  });

  it('play() is a no-op while suppressed (no playback during break/closed)', () => {
    S().setScheduleSuppression('break');
    S().play();
    expect(S().playing).toBe(false);
  });

  it('toggle() cannot start playback while suppressed', () => {
    S().setScheduleSuppression('closed');
    S().toggle();
    expect(S().playing).toBe(false);
    S().toggle();
    expect(S().playing).toBe(false);
  });

  it('setQueue() while suppressed stages the queue but stays paused', () => {
    S().setScheduleSuppression('break');
    S().setQueue([track('a'), track('b')], 0);
    expect(S().queue.length).toBe(2);
    expect(S().index).toBe(0);
    expect(S().playing).toBe(false); // staged, not playing
  });

  it('setQueue() with no suppression plays as before (regression guard)', () => {
    S().setQueue([track('a'), track('b')], 0);
    expect(S().queue.length).toBe(2);
    expect(S().playing).toBe(true);
  });

  it('releasing the gate restores normal play() (auto-resume path)', () => {
    S().setScheduleSuppression('break');
    S().play();
    expect(S().playing).toBe(false);
    S().setScheduleSuppression(null);
    expect(S().scheduleSuppressed).toBe(false);
    expect(S().scheduleSuppressReason).toBeNull();
    S().play();
    expect(S().playing).toBe(true);
  });

  it('pause() always works, even while suppressed', () => {
    S().setScheduleSuppression('closed');
    S().pause();
    expect(S().playing).toBe(false);
  });

  it('closed suppression while actively playing stops immediately', () => {
    S().setQueue([track('a')], 0);
    expect(S().playing).toBe(true);
    S().setScheduleSuppression('closed');
    expect(S().playing).toBe(false);
    expect(S().scheduleSuppressReason).toBe('closed');
  });
});

describe('playerStore cycle-completion signal (BRAND-PLAYLIST-ROTATION-4C, §19)', () => {
  beforeEach(() => {
    usePlayerStore.setState({
      queue: [track('a'), track('b'), track('c')],
      index: 0,
      playing: true,
      shuffle: false,
      shuffleOrder: [],
      repeat: 'all',
      scheduleSuppressed: false,
      scheduleSuppressReason: null,
      playlist: { id: 'pl-1' } as never,
      queueGeneration: 7,
      cycleEvent: null,
    });
  });

  it('audio_ended on the LAST track emits a cycle event', () => {
    usePlayerStore.setState({ index: 2 });
    S().next({ cause: 'audio_ended' });
    const ev = S().cycleEvent;
    expect(ev).not.toBeNull();
    expect(ev?.cause).toBe('audio_ended');
    expect(ev?.sequence).toBe(1);
    expect(ev?.playlistId).toBe('pl-1');
    expect(ev?.trackId).toBe('c');
    expect(ev?.queueGeneration).toBe(7);
    expect(S().index).toBe(0); // still wraps as before
  });

  it('audio_ended on a MIDDLE track emits nothing', () => {
    usePlayerStore.setState({ index: 1 });
    S().next({ cause: 'audio_ended' });
    expect(S().cycleEvent).toBeNull();
    expect(S().index).toBe(2);
  });

  it('manual next() on the last track emits nothing (no false positive)', () => {
    usePlayerStore.setState({ index: 2 });
    S().next(); // default cause = manual_next
    expect(S().cycleEvent).toBeNull();
    expect(S().index).toBe(0);
  });

  it('manual next() with explicit cause manual_next emits nothing', () => {
    usePlayerStore.setState({ index: 2 });
    S().next({ cause: 'manual_next' });
    expect(S().cycleEvent).toBeNull();
  });

  it('single-track audio_ended emits a cycle event', () => {
    usePlayerStore.setState({ queue: [track('solo')], index: 0, cycleEvent: null });
    S().next({ cause: 'audio_ended' });
    expect(S().cycleEvent?.trackId).toBe('solo');
    expect(S().playing).toBe(true); // repeat=all keeps looping
  });

  it('repeat=one audio_ended is NOT a playlist cycle', () => {
    usePlayerStore.setState({ index: 2, repeat: 'one' });
    S().next({ cause: 'audio_ended' });
    expect(S().cycleEvent).toBeNull();
  });

  it('sequence increments monotonically across cycles', () => {
    usePlayerStore.setState({ index: 2 });
    S().next({ cause: 'audio_ended' });
    const first = S().cycleEvent?.sequence;
    usePlayerStore.setState({ index: 2 });
    S().next({ cause: 'audio_ended' });
    expect(S().cycleEvent?.sequence).toBe((first ?? 0) + 1);
  });

  it('prev() and jumpTo() never emit a cycle event', () => {
    usePlayerStore.setState({ index: 2, currentTime: 0 });
    S().prev();
    expect(S().cycleEvent).toBeNull();
    S().jumpTo(0);
    expect(S().cycleEvent).toBeNull();
  });

  it('setQueue increments queueGeneration', () => {
    const g0 = S().queueGeneration;
    S().setQueue([track('x'), track('y')], 0);
    expect(S().queueGeneration).toBe(g0 + 1);
  });
});

describe('replaceQueueKeepingCurrent (BRAND-DAILY-PLAYLIST-1 — 무중단 큐 교체)', () => {
  beforeEach(() => {
    usePlayerStore.setState({
      queue: [], index: 0, playing: false, shuffle: false, repeat: 'off',
      currentTime: 0, duration: 0, pendingSeekSec: null, liveSeek: null,
      shuffleOrder: [], queueGeneration: 0,
      scheduleSuppressed: false, scheduleSuppressReason: null,
    });
  });

  it('현재 재생 중인 곡을 그대로 두고 나머지만 교체한다 (audio.src 재설정 없음)', () => {
    S().setQueue([track('a'), track('b'), track('c')], 1);
    usePlayerStore.setState({ currentTime: 42, duration: 180 });
    expect(S().queue[S().index].id).toBe('b');

    S().replaceQueueKeepingCurrent([track('x'), track('b'), track('y'), track('z')]);

    // 활성 트랙 id 가 그대로 → Player 의 track sync effect 가 src 를 건드리지 않는다
    expect(S().queue[S().index].id).toBe('b');
    expect(S().queue.map((t) => t.id)).toEqual(['x', 'b', 'y', 'z']);
    expect(S().currentTime).toBe(42);
    expect(S().duration).toBe(180);
  });

  it('playing 상태를 바꾸지 않는다 (교체가 음악을 멈추면 안 된다)', () => {
    S().setQueue([track('a'), track('b')], 0);
    S().play();
    S().replaceQueueKeepingCurrent([track('a'), track('c')]);
    expect(S().playing).toBe(true);
  });

  it('새 목록에 현재 곡이 빠졌으면 맨 앞에 끼워 끝까지 재생시킨다', () => {
    S().setQueue([track('a'), track('b')], 0);
    S().play();
    S().replaceQueueKeepingCurrent([track('c'), track('d')]);
    expect(S().queue.map((t) => t.id)).toEqual(['a', 'c', 'd']);
    expect(S().index).toBe(0);
    expect(S().queue[S().index].id).toBe('a');
    expect(S().playing).toBe(true);
  });

  it('새 목록이 비면 아무것도 하지 않는다 (무음 방지)', () => {
    S().setQueue([track('a'), track('b')], 0);
    S().play();
    const before = S().queue.map((t) => t.id);
    S().replaceQueueKeepingCurrent([]);
    expect(S().queue.map((t) => t.id)).toEqual(before);
    expect(S().playing).toBe(true);
  });

  it('재생 불가/중복 트랙은 걸러낸다', () => {
    S().setQueue([track('a')], 0);
    const broken = { id: 'bad', audio_url: null } as unknown as TrackRow;
    S().replaceQueueKeepingCurrent([track('a'), broken, track('b'), track('b')]);
    expect(S().queue.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('shuffle 이면 새 길이에 맞는 순서를 현재 곡부터 다시 만든다', () => {
    S().setQueue([track('a'), track('b'), track('c')], 0);
    S().setShuffle(true);
    S().replaceQueueKeepingCurrent([track('a'), track('d'), track('e'), track('f')]);
    expect(S().shuffleOrder).toHaveLength(4);
    expect(S().shuffleOrder[0]).toBe(S().index);
    expect([...S().shuffleOrder].sort((x, y) => x - y)).toEqual([0, 1, 2, 3]);
  });

  it('queueGeneration 을 올려 이전 큐의 Cycle Signal 을 stale 로 만든다', () => {
    S().setQueue([track('a')], 0);
    const g = S().queueGeneration;
    S().replaceQueueKeepingCurrent([track('a'), track('b')]);
    expect(S().queueGeneration).toBe(g + 1);
  });

  it('playlist/context 를 생략하면 기존 값을 유지한다', () => {
    const pl = { id: 'p1', title: 'brand' } as never;
    S().setQueue([track('a')], 0, pl, { type: 'catalog', id: 'p1' });
    S().replaceQueueKeepingCurrent([track('a'), track('b')]);
    expect(S().playlist).toBe(pl);
    expect(S().playlistContext).toEqual({ type: 'catalog', id: 'p1' });
  });
});
