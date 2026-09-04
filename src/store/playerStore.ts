import { create } from 'zustand';
import type { TrackRow, PlaylistRow } from '@/types/db';
import { isPlayableTrack } from '@/lib/audio';
import {
  isPlaylistCycleComplete,
  type NextCause,
  type PlaylistCycleEvent,
} from '@/lib/playerCycleCompletion';

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

  /**
   * BRAND-PLAYER-UX-5 — live seek 요청. Audio Element Owner(<Player>)만 소비한다.
   * { sec, trackId } 로 대상 트랙을 검증 → 곡 변경 race 방지. 소비 후 consumeLiveSeek 로 null.
   * UI 는 seekTo() 만 호출하고 audio DOM 에 직접 접근하지 않는다.
   */
  liveSeek: { sec: number; trackId: string } | null;

  /**
   * BRAND-PLAYLIST-ROTATION-4 — 본사 스케줄(브레이크/운영종료) 재생 억제 게이트.
   * useStorePlaybackPolicy 가 resolve_store_playback_policy 결과로 설정한다.
   * suppressed=true 이면 play()/toggle()/setQueue() 가 playing=true 로 만들지 않는다
   * (playing=false 유지). 기존 Player 의 모든 auto-resume 경로는 이미 playing=false 를
   * "사용자 의도적 정지"로 존중하므로, 이 게이트 하나로 브레이크/종료 중 무음이 보장된다.
   * 프랜차이즈 미연결/legacy/play 매장에서는 항상 false → 회귀 0.
   */
  scheduleSuppressed: boolean;
  scheduleSuppressReason: 'break' | 'closed' | null;

  /**
   * BRAND-PLAYLIST-ROTATION-4C — Queue 세대(generation). setQueue 마다 증가.
   * Cycle 완료 Signal / Rotation 이 stale onEnded·이전 Playlist 완료를 걸러내는 기준.
   */
  queueGeneration: number;
  /**
   * BRAND-PLAYLIST-ROTATION-4C — 명시적 "플레이리스트 1 Cycle 완료" Signal.
   * next({cause:'audio_ended'}) 가 마지막 재생순번(또는 단일 트랙) 자연 종료 시에만 emit.
   * monotonic sequence — 소비자는 마지막 처리 sequence 만 추적(boolean flag 사용 금지).
   * 수동 next/prev/jumpTo/setQueue/Break/Closed 에서는 절대 emit 하지 않는다.
   */
  cycleEvent: PlaylistCycleEvent | null;

  /**
   * X6.80 — opts.dailySeedShuffle: 매장 모드에서 매일 다른 순서로 셔플.
   * shuffle=true 와 함께 사용 → buildSeededShuffleOrder(todayKstSeed) 적용.
   * (true → 같은 날엔 일관, 다음날 자동 다른 순서)
   */
  setQueue: (
    tracks: TrackRow[],
    startIndex?: number,
    playlist?: PlaylistRow | null,
    context?: PlaylistContext | null,
    opts?: { dailySeedShuffle?: boolean },
  ) => void;
  /**
   * BRAND-DAILY-PLAYLIST-1 — **재생을 끊지 않고** 큐만 교체한다.
   *
   * 매일 아침 9시(KST) 서버가 새 브랜드 플레이리스트를 발행하면 무인 매장의 플레이어가
   * 이를 반영해야 하는데, setQueue 는 currentTime=0 + index 재설정이라 재생 중인 곡이
   * 끊긴다. 24시간 도는 매장에서는 그 끊김이 그대로 사고다.
   *
   * 이 액션은 지금 나오고 있는 곡을 그대로 둔 채(같은 track id 를 새 큐의 활성 index 에
   * 배치) 나머지 목록만 갈아끼운다. Player 는 track id 가 바뀔 때만 audio.src 를
   * 재설정하므로 오디오는 전혀 건드려지지 않는다.
   *
   * - 새 목록에 현재 곡이 없으면 맨 앞에 끼워 넣어 끝까지 재생시키고 다음 곡부터 새 목록.
   * - 새 목록이 비었으면 아무것도 하지 않는다(무음 방지).
   * - playing / currentTime / duration / liveSeek 을 절대 건드리지 않는다.
   */
  replaceQueueKeepingCurrent: (
    tracks: TrackRow[],
    playlist?: PlaylistRow | null,
    context?: PlaylistContext | null,
    opts?: { dailySeedShuffle?: boolean },
  ) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  /**
   * BRAND-PLAYLIST-ROTATION-4 — 스케줄 게이트 설정.
   * reason!=null → 즉시 억제(playing=false + suppressed). reason=null → 게이트 해제
   * (자동 재생하지 않음; 재개는 호출측이 play() 로 명시적으로 결정).
   */
  setScheduleSuppression: (reason: 'break' | 'closed' | null) => void;
  /**
   * 다음 곡. opts.cause 로 자동 종료(audio_ended) 와 수동/스킵을 구분한다.
   * default 'manual_next' → 기존 호출부(수동 next, 미디어세션 등)는 그대로 동작하고
   * Cycle 완료 Signal 을 발생시키지 않는다. Player onEnded 자연 종료만 'audio_ended'.
   */
  next: (opts?: { cause?: NextCause }) => void;
  prev: () => void;
  jumpTo: (i: number) => void;
  /** BRAND-PLAYER-UX-5 — 현재 트랙 내 위치 이동 요청(초). Owner 가 실제 audio.currentTime 적용. */
  seekTo: (sec: number) => void;
  /** Owner 전용 — liveSeek 소비 후 초기화. */
  consumeLiveSeek: () => void;
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

/**
 * X6.80 — daily seed 기반 셔플 (매장 매일 다른 순서 보장).
 * 같은 seed → 같은 순서 (하루 안에선 일관). 다음날 seed 변경 → 다른 순서.
 * Mulberry32 (간단/빠름/충돌적음) PRNG.
 */
function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildSeededShuffleOrder(len: number, startIndex: number, seed: number): number[] {
  const rand = seededRandom(seed);
  const arr = Array.from({ length: len }, (_, i) => i).filter((i) => i !== startIndex);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return [startIndex, ...arr];
}

/** YYYYMMDD 정수 (KST 기준) — 매장모드 daily shuffle seed. */
function todayKstSeed(): number {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000); // UTC+9
  return kst.getUTCFullYear() * 10000 + (kst.getUTCMonth() + 1) * 100 + kst.getUTCDate();
}

/** track_id 기준 중복 제거 (첫 번째 occurrence 유지, 순서 보존). */
function dedupeByTrackId<T extends { id: string }>(tracks: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const t of tracks) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
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
  liveSeek: null,
  scheduleSuppressed: false,
  scheduleSuppressReason: null,
  queueGeneration: 0,
  cycleEvent: null,

  setQueue: (tracks, startIndex = 0, playlist = null, context = null, opts) => {
    // 안전장치: 재생 불가(audio_url null/빈문자열/형식이상) 트랙은 큐에서 제외.
    // 호출 측에서 이미 filterPlayableTracks 를 호출했으면 이 단계는 no-op.
    // 호출 측이 잊었어도 무한 next() 캐스케이드를 차단한다.
    const target = tracks[Math.max(0, Math.min(startIndex, tracks.length - 1))];
    const playable = tracks.filter(isPlayableTrack);
    const droppedUnplayable = tracks.length - playable.length;

    // X6.80 — track_id 중복 제거 (매장모드 중복 연속재생 버그 차단).
    // 원인: playlist_tracks 재추가/Phase 7 daily refresh + autoplay 추천이
    // 같은 곡을 큐에 두 번 넣을 수 있음.
    const filtered = dedupeByTrackId(playable);
    const droppedDup = playable.length - filtered.length;

    if ((droppedUnplayable > 0 || droppedDup > 0) && import.meta.env.DEV) {
      console.warn(
        `[playerStore] setQueue: 재생불가 ${droppedUnplayable}곡 + 중복 ${droppedDup}곡 제외. ` +
          '호출 측에서 filterPlayableTracks() / dedup 으로 미리 거르는 것을 권장.',
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
    const useShuffle = get().shuffle;
    // X6.80 — daily seed shuffle (매장모드 매일 다른 순서)
    const shuffleOrder = useShuffle
      ? (opts?.dailySeedShuffle
          ? buildSeededShuffleOrder(filtered.length, safeIdx, todayKstSeed())
          : buildShuffleOrder(filtered.length, safeIdx))
      : [];
    set({
      queue: filtered,
      index: safeIdx,
      playlist,
      playlistContext: context,
      // BRAND-PLAYLIST-ROTATION-4 — 브레이크/종료 억제 중이면 큐만 준비하고 정지 유지.
      // (프랜차이즈 정책이 다음 슬롯 playlist 를 미리 스테이징해도 브레이크 중 재생되지 않음)
      playing: !get().scheduleSuppressed,
      currentTime: 0,
      duration: 0,
      pendingSeekSec: null,
      shuffleOrder,
      // 4C — 새 Queue 로드 = 세대 증가. 진행 중이던 Cycle Signal 을 stale 로 만든다.
      queueGeneration: get().queueGeneration + 1,
    });
  },

  // BRAND-DAILY-PLAYLIST-1 — 무중단 큐 교체. 상세 계약은 인터페이스 주석 참조.
  replaceQueueKeepingCurrent: (tracks, playlist, context, opts) => {
    const filtered = dedupeByTrackId(tracks.filter(isPlayableTrack));
    // 새 목록이 비었으면 지금 돌고 있는 것을 유지한다 — 교체가 무음의 원인이 되면 안 된다.
    if (filtered.length === 0) return;

    const { queue, index, shuffle } = get();
    const current = queue[index] ?? null;

    let nextQueue = filtered;
    let nextIndex = 0;
    if (current) {
      const pos = filtered.findIndex((t) => t.id === current.id);
      if (pos >= 0) {
        nextIndex = pos;
      } else {
        // 새 정책에서 빠진 곡이어도 지금 나오는 중이면 끝까지 들려준다.
        nextQueue = [current, ...filtered];
        nextIndex = 0;
      }
    }

    const shuffleOrder = shuffle
      ? (opts?.dailySeedShuffle
          ? buildSeededShuffleOrder(nextQueue.length, nextIndex, todayKstSeed())
          : buildShuffleOrder(nextQueue.length, nextIndex))
      : [];

    set({
      queue: nextQueue,
      index: nextIndex,
      shuffleOrder,
      // 호출측이 명시하지 않으면 기존 컨텍스트를 유지한다(집계 기준이 흔들리지 않도록).
      playlist: playlist === undefined ? get().playlist : playlist,
      playlistContext: context === undefined ? get().playlistContext : context,
      // 진행 중이던 Cycle 완료 Signal 을 stale 로 만든다.
      queueGeneration: get().queueGeneration + 1,
    });
    // playing / currentTime / duration / pendingSeekSec / liveSeek 은 의도적으로 미변경.
  },

  // BRAND-PLAYLIST-ROTATION-4 — 스케줄 억제 중 play()/toggle() 는 재생 시작을 거부한다.
  // (수동 재생 우회 차단 §21 + franchiseSync/business auto-switch 의 재개 차단)
  play: () => { if (get().scheduleSuppressed) return; set({ playing: true }); },
  pause: () => set({ playing: false }),
  toggle: () => set((s) => ({ playing: s.scheduleSuppressed ? false : !s.playing })),

  setScheduleSuppression: (reason) => {
    if (reason) {
      set({ scheduleSuppressed: true, scheduleSuppressReason: reason, playing: false });
    } else {
      set({ scheduleSuppressed: false, scheduleSuppressReason: null });
    }
  },

  next: (opts) => {
    const cause: NextCause = opts?.cause ?? 'manual_next';
    const { queue, index, shuffle, shuffleOrder, repeat } = get();
    if (queue.length === 0) return;

    // 4C — 자연 종료(audio_ended) 가 마지막 재생순번/단일 트랙에서 발생하면 Cycle 완료.
    // 아래 wrap 분기 set() 에만 병합한다(...cyc). 완료가 아니면 cyc={} → no-op.
    const complete = isPlaylistCycleComplete({
      cause, repeat, queueLength: queue.length, index, shuffle, shuffleOrder,
    });
    const cyc: { cycleEvent?: PlaylistCycleEvent } = complete
      ? {
          cycleEvent: {
            sequence: (get().cycleEvent?.sequence ?? 0) + 1,
            playlistId: get().playlist?.id ?? null,
            queueGeneration: get().queueGeneration,
            trackId: queue[index]?.id ?? null,
            completedAt: Date.now(),
            cause: 'audio_ended',
          },
        }
      : {};

    if (repeat === 'one') {
      set({ currentTime: 0, pendingSeekSec: null });
      return;
    }
    // 0091-fix → X6.62: 큐 1곡 + repeat='all' 은 자동 정지하지 않고 loopback.
    // 기존: stream_events 무한 누적 우려로 자동 정지. → 매장 야간 1곡 plr 자동 무음 문제.
    // 현재: X6.47 30s dedup + X6.46 24h cap 으로 raw count 도 보호됨.
    // queue=1 일 때 repeat='all' 은 repeat='one' 과 동등하게 트랙 재시작.
    if (queue.length <= 1) {
      if (repeat === 'all') {
        set({ currentTime: 0, pendingSeekSec: null, playing: true, ...cyc });
      } else {
        set({ playing: false, currentTime: 0, pendingSeekSec: null, ...cyc });
      }
      return;
    }
    if (shuffle && shuffleOrder.length === queue.length) {
      const pos = shuffleOrder.indexOf(index);
      // 현재 index 가 shuffleOrder 에 없으면(큐 변경 등) shuffle 순서 점프 대신 선형 진행으로 폴백.
      if (pos !== -1) {
        const nextPos = pos + 1;
        if (nextPos >= shuffleOrder.length) {
          if (repeat === 'all') {
            set({ index: shuffleOrder[0], currentTime: 0, playing: true, pendingSeekSec: null, ...cyc });
          } else {
            set({ playing: false, currentTime: 0, pendingSeekSec: null, ...cyc });
          }
          return;
        }
        set({ index: shuffleOrder[nextPos], currentTime: 0, playing: true, pendingSeekSec: null });
        return;
      }
    }
    if (index + 1 >= queue.length) {
      if (repeat === 'all') {
        set({ index: 0, currentTime: 0, playing: true, pendingSeekSec: null, ...cyc });
      } else {
        set({ playing: false, currentTime: 0, pendingSeekSec: null, ...cyc });
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
      // 현재 index 가 shuffleOrder 에 없으면 선형 진행으로 폴백 (아래 공통 경로).
      if (pos !== -1) {
        const prevPos = Math.max(0, pos - 1);
        set({ index: shuffleOrder[prevPos], currentTime: 0, playing: true, pendingSeekSec: null });
        return;
      }
    }
    set({ index: Math.max(0, index - 1), currentTime: 0, playing: true, pendingSeekSec: null });
  },

  jumpTo: (i) => {
    const { queue } = get();
    if (i < 0 || i >= queue.length) return;
    set({ index: i, currentTime: 0, playing: true, pendingSeekSec: null, liveSeek: null });
  },

  // BRAND-PLAYER-UX-5 — live seek 요청. 실제 audio.currentTime 변경은 Owner(<Player>)에서만.
  // 현재 트랙 id 를 함께 실어 곡 변경 race 를 방지. currentTime 은 즉시 낙관적 반영(UI 반응성).
  seekTo: (sec) => {
    const { queue, index } = get();
    const track = queue[index];
    if (!track) return;
    const s = Number.isFinite(sec) && sec > 0 ? sec : 0;
    set({ liveSeek: { sec: s, trackId: track.id }, currentTime: s });
  },
  consumeLiveSeek: () => set({ liveSeek: null }),

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
