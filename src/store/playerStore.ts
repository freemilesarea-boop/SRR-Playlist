import { create } from 'zustand';
import type { TrackRow, PlaylistRow } from '@/types/db';
import { isPlayableTrack } from '@/lib/audio';

export type RepeatMode = 'off' | 'all' | 'one';

/** 0102 — 플레이리스트 청취 조회수 집계용 컨텍스트 (어떤 플리에서 재생이 시작됐는지) */
export interface PlaylistContext {
  type: 'catalog' | 'user';
  id: string;
}

interface PlayerState {
  queue: TrackRow[];
  index: number;
  playlist: PlaylistRow | null;
  /** 0102 — 현재 큐가 시작된 플레이리스트 컨텍스트 (조회수 누적 기준) */
  playlistContext: PlaylistContext | null;
  playing: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  currentTime: number;
  duration: number;
  volume: number;
  /** 0078 — mute 직전 볼륨 (unmute 시 복원용) */
  mutedVolume: number;
  shuffleOrder: number[];
  /** 세션 복원 직후 audio 가 loadedmetadata 될 때 적용할 seek 위치 (초). 한 번 소비 후 null. */
  pendingSeekSec: number | null;

  setQueue: (tracks: TrackRow[], startIndex?: number, playlist?: PlaylistRow | null, context?: PlaylistContext | null) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  jumpTo: (i: number) => void;
  setShuffle: (v: boolean) => void;
  setRepeat: (r: RepeatMode) => void;
  setVolume: (v: number) => void;
  /** 0078 — 음소거 토글: muted 면 mutedVolume 으로 복원, 아니면 현재 볼륨 기억 후 0 */
  toggleMute: () => void;
  setCurrentTime: (t: number) => void;
  setDuration: (d: number) => void;
  setPendingSeek: (sec: number | null) => void;
}

// 0078 — localStorage 영속화
const VOLUME_KEY = 'srr.player.volume';
const MUTED_VOL_KEY = 'srr.player.mutedVolume';

function loadVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (raw === null) return 1;
    const v = Number(raw);
    if (Number.isFinite(v) && v >= 0 && v <= 1) return v;
  } catch { /* */ }
  return 1;
}

function loadMutedVolume(): number {
  try {
    const raw = localStorage.getItem(MUTED_VOL_KEY);
    if (raw === null) return 1;
    const v = Number(raw);
    if (Number.isFinite(v) && v > 0 && v <= 1) return v;
  } catch { /* */ }
  return 1;
}

function saveVolume(v: number): void {
  try { localStorage.setItem(VOLUME_KEY, String(v)); } catch { /* */ }
}

function saveMutedVolume(v: number): void {
  try { localStorage.setItem(MUTED_VOL_KEY, String(v)); } catch { /* */ }
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
  playlistContext: null,
  playing: false,
  shuffle: false,
  repeat: 'off',
  currentTime: 0,
  duration: 0,
  volume: loadVolume(),
  mutedVolume: loadMutedVolume(),
  shuffleOrder: [],
  pendingSeekSec: null,

  setQueue: (tracks, startIndex = 0, playlist = null, context = null) => {
    // 안전장치: 재생 불가(audio_url null/빈문자열/형식이상) 트랙은 큐에서 제외.
    // 호출 측에서 이미 filterPlayableTracks 를 호출했으면 이 단계는 no-op.
    // 호출 측이 잊었어도 무한 next() 캐스케이드를 차단한다.
    const target = tracks[Math.max(0, Math.min(startIndex, tracks.length - 1))];
    const filtered = tracks.filter(isPlayableTrack);
    const dropped = tracks.length - filtered.length;
    if (dropped > 0 && import.meta.env.DEV) {
      console.warn(
        `[playerStore] setQueue: ${dropped}곡이 재생 불가(audio_url 없음/형식이상)여서 큐에서 제외됨. ` +
          '호출 측에서 filterPlayableTracks() 로 미리 거르는 것을 권장.',
      );
    }
    if (filtered.length === 0) {
      // 전부 재생 불가 — 큐 변경 없이 정지
      set({ playing: false });
      return;
    }
    // 원본의 target 트랙이 살아남았으면 그 위치를, 아니면 0
    const idx = target ? Math.max(0, filtered.findIndex((t) => t.id === target.id)) : 0;
    const safeIdx = idx < 0 ? 0 : idx;
    set({
      queue: filtered,
      index: safeIdx,
      playlist,
      playlistContext: context,
      playing: true,
      currentTime: 0,
      duration: 0,
      pendingSeekSec: null,
      shuffleOrder: get().shuffle ? buildShuffleOrder(filtered.length, safeIdx) : [],
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
    // 0091-fix — 큐 1곡 + repeat='all' 무한 루프 가드:
    // 같은 곡으로 자동 점프하면 raw stream_events 가 무한 누적됨.
    // (24h cap 으로 eligible 은 보호되지만 raw 카운트는 보호 안 됨)
    // → 자동 정지 (사용자가 직접 재생 클릭하면 다시 시작)
    if (queue.length <= 1) {
      set({ playing: false, currentTime: 0, pendingSeekSec: null });
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
  setVolume: (v) => {
    const clamped = Math.max(0, Math.min(1, v));
    set({ volume: clamped });
    saveVolume(clamped);
    if (clamped > 0) {
      set({ mutedVolume: clamped });
      saveMutedVolume(clamped);
    }
  },

  toggleMute: () => {
    const { volume, mutedVolume } = get();
    if (volume > 0) {
      // mute: 현재 볼륨 기억 후 0
      set({ mutedVolume: volume, volume: 0 });
      saveMutedVolume(volume);
      saveVolume(0);
    } else {
      // unmute: mutedVolume 으로 복원 (최소 0.1 보장)
      const restored = mutedVolume > 0 ? mutedVolume : 1;
      set({ volume: restored });
      saveVolume(restored);
    }
  },
  setCurrentTime: (t) => set({ currentTime: t }),
  setDuration: (d) => set({ duration: d }),
  setPendingSeek: (sec) => set({ pendingSeekSec: sec }),
}));
