import { create } from 'zustand';
import type { TrackRow, PlaylistRow } from '@/types/db';

export type RepeatMode = 'off' | 'all' | 'one';

interface PlayerState {
  queue: TrackRow[];
  index: number;
  playlist: PlaylistRow | null;
  playing: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  currentTime: number;
  duration: number;
  volume: number;
  shuffleOrder: number[];
  /** 세션 복원 직후 audio 가 loadedmetadata 될 때 적용할 seek 위치 (초). 한 번 소비 후 null. */
  pendingSeekSec: number | null;

  setQueue: (tracks: TrackRow[], startIndex?: number, playlist?: PlaylistRow | null) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  jumpTo: (i: number) => void;
  setShuffle: (v: boolean) => void;
  setRepeat: (r: RepeatMode) => void;
  setVolume: (v: number) => void;
  setCurrentTime: (t: number) => void;
  setDuration: (d: number) => void;
  setPendingSeek: (sec: number | null) => void;
}

function buildShuffleOrder(len: number, startIndex: number): number[] {
  const arr = Array.from({ length: len }, (_, i) => i).filter((i) => i !== startIndex);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return [startIndex, ...arr];
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  queue: [],
  index: 0,
  playlist: null,
  playing: false,
  shuffle: false,
  repeat: 'off',
  currentTime: 0,
  duration: 0,
  volume: 1,
  shuffleOrder: [],
  pendingSeekSec: null,

  setQueue: (tracks, startIndex = 0, playlist = null) => {
    const idx = Math.max(0, Math.min(startIndex, tracks.length - 1));
    set({
      queue: tracks,
      index: idx,
      playlist,
      playing: tracks.length > 0,
      currentTime: 0,
      duration: 0,
      pendingSeekSec: null,
      shuffleOrder: get().shuffle ? buildShuffleOrder(tracks.length, idx) : [],
    });
  },

  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),
  toggle: () => set((s) => ({ playing: !s.playing })),

  next: () => {
    const { queue, index, shuffle, shuffleOrder, repeat } = get();
    if (queue.length === 0) return;
    if (repeat === 'one') {
      set({ currentTime: 0, pendingSeekSec: null });
      return;
    }
    if (shuffle && shuffleOrder.length === queue.length) {
      const pos = shuffleOrder.indexOf(index);
      const nextPos = pos + 1;
      if (nextPos >= shuffleOrder.length) {
        if (repeat === 'all') {
          set({ index: shuffleOrder[0], currentTime: 0, playing: true, pendingSeekSec: null });
        } else {
          set({ playing: false, currentTime: 0, pendingSeekSec: null });
        }
        return;
      }
      set({ index: shuffleOrder[nextPos], currentTime: 0, playing: true, pendingSeekSec: null });
      return;
    }
    if (index + 1 >= queue.length) {
      if (repeat === 'all') {
        set({ index: 0, currentTime: 0, playing: true, pendingSeekSec: null });
      } else {
        set({ playing: false, currentTime: 0, pendingSeekSec: null });
      }
      return;
    }
    set({ index: index + 1, currentTime: 0, playing: true, pendingSeekSec: null });
  },

  prev: () => {
    const { index, currentTime, queue, shuffle, shuffleOrder } = get();
    if (queue.length === 0) return;
    // 3초 이내면 이전 곡, 아니면 처음으로
    if (currentTime > 3) {
      set({ currentTime: 0, pendingSeekSec: null });
      return;
    }
    if (shuffle && shuffleOrder.length === queue.length) {
      const pos = shuffleOrder.indexOf(index);
      const prevPos = Math.max(0, pos - 1);
      set({ index: shuffleOrder[prevPos], currentTime: 0, playing: true, pendingSeekSec: null });
      return;
    }
    set({ index: Math.max(0, index - 1), currentTime: 0, playing: true, pendingSeekSec: null });
  },

  jumpTo: (i) => {
    const { queue } = get();
    if (i < 0 || i >= queue.length) return;
    set({ index: i, currentTime: 0, playing: true, pendingSeekSec: null });
  },

  setShuffle: (v) => {
    const { queue, index } = get();
    set({
      shuffle: v,
      shuffleOrder: v ? buildShuffleOrder(queue.length, index) : [],
    });
  },

  setRepeat: (r) => set({ repeat: r }),
  setVolume: (v) => set({ volume: Math.max(0, Math.min(1, v)) }),
  setCurrentTime: (t) => set({ currentTime: t }),
  setDuration: (d) => set({ duration: d }),
  setPendingSeek: (sec) => set({ pendingSeekSec: sec }),
}));
