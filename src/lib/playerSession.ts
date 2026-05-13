import type { TrackRow, PlaylistRow } from '@/types/db';
import type { RepeatMode } from '@/store/playerStore';
import { usePlayerStore } from '@/store/playerStore';
import { useBusinessStore } from '@/store/businessStore';

/**
 * Continue Listening Phase 2 — full session snapshot.
 *
 * 기존 `srr-continue-listening` 은 단일 트랙 + 위치만 저장 (DB 백업/크로스디바이스용).
 * 이 모듈은 큐 전체 + index + 상태를 localStorage 에 저장해서
 * 새로고침/탭종료 후에도 큐 그대로 이어재생 가능하게 한다.
 */

const LS_KEY = 'srr-player-session';
const SCHEMA_VERSION = 1;
const DEBOUNCE_MS = 5_000;
/** 30일 이후 만료 */
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

export interface PlayerSnapshot {
  v: number;
  track_id: string | null;
  playlist_id: string | null;
  queue: TrackRow[];
  current_index: number;
  current_time: number;
  duration: number;
  playing: boolean;
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
  business_mode: boolean;
  timestamp: number;
  /** 복원 시 playlist 정보 함께 (커버/제목 표시용). */
  playlist?: PlaylistRow | null;
}

export function loadPlayerSession(): PlayerSnapshot | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<PlayerSnapshot>;
    if (!data || typeof data !== 'object') return null;
    if (data.v !== SCHEMA_VERSION) return null;
    if (!Array.isArray(data.queue) || data.queue.length === 0) return null;
    if (typeof data.current_index !== 'number') return null;
    if (typeof data.timestamp !== 'number') return null;
    if (Date.now() - data.timestamp > MAX_AGE_MS) {
      localStorage.removeItem(LS_KEY);
      return null;
    }
    return data as PlayerSnapshot;
  } catch {
    return null;
  }
}

export function savePlayerSession(snapshot: PlayerSnapshot): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(snapshot));
  } catch {
    // QuotaExceeded — 한 번 비우고 재시도
    try {
      localStorage.removeItem(LS_KEY);
      localStorage.setItem(LS_KEY, JSON.stringify(snapshot));
    } catch {
      /* noop */
    }
  }
}

export function clearPlayerSession(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* noop */
  }
}

function snapshotFromState(): PlayerSnapshot | null {
  const s = usePlayerStore.getState();
  if (s.queue.length === 0) return null;
  const current = s.queue[s.index];
  return {
    v: SCHEMA_VERSION,
    track_id: current?.id ?? null,
    playlist_id: s.playlist?.id ?? null,
    queue: s.queue,
    current_index: s.index,
    current_time: s.currentTime,
    duration: s.duration,
    playing: s.playing,
    volume: s.volume,
    shuffle: s.shuffle,
    repeat: s.repeat,
    business_mode: useBusinessStore.getState().businessMode,
    timestamp: Date.now(),
    playlist: s.playlist,
  };
}

/**
 * 세션을 playerStore 로 복원. 자동재생은 하지 않음 (모바일 정책 준수 — 사용자 제스처 필요).
 * 반환값: 복원된 snapshot (null 이면 복원할 게 없음).
 */
export function restorePlayerSessionToStore(): PlayerSnapshot | null {
  const snap = loadPlayerSession();
  if (!snap) return null;

  const safeIndex = Math.max(0, Math.min(snap.current_index, snap.queue.length - 1));
  const safeTime =
    Number.isFinite(snap.current_time) && snap.current_time > 0 ? snap.current_time : 0;

  usePlayerStore.setState({
    queue: snap.queue,
    index: safeIndex,
    playlist: snap.playlist ?? null,
    // 자동재생 차단 — 사용자가 ▶ 누르면 그때 재생.
    playing: false,
    shuffle: snap.shuffle,
    repeat: snap.repeat,
    volume: Number.isFinite(snap.volume) ? snap.volume : 1,
    currentTime: safeTime,
    duration: snap.duration,
    pendingSeekSec: safeTime > 1 ? safeTime : null,
    shuffleOrder: [],
  });

  // 셔플이 켜져 있었으면 새 순서 빌드
  if (snap.shuffle) {
    usePlayerStore.getState().setShuffle(true);
  }

  return snap;
}

/**
 * playerStore 변경 구독 + 5초 debounce 저장 + 페이지 종료/숨김 시 즉시 flush.
 *
 * - currentTime 만 바뀌면 debounce (5s) — 매 timeupdate 마다 쓰면 IO 과다
 * - track/playing/queue/index 변경은 즉시 flush
 * - visibilitychange→hidden, pagehide, beforeunload → 즉시 flush (모바일 Safari 대응)
 *
 * @returns cleanup 함수
 */
export function installPlayerSessionPersistence(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function scheduleSave() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flushSave, DEBOUNCE_MS);
  }

  function flushSave() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const snap = snapshotFromState();
    if (!snap) return;
    savePlayerSession(snap);
  }

  const unsubPlayer = usePlayerStore.subscribe((state, prev) => {
    const curId = state.queue[state.index]?.id ?? null;
    const prevId = prev.queue[prev.index]?.id ?? null;
    const trackChanged = curId !== prevId;
    const playingChanged = state.playing !== prev.playing;
    const queueRefChanged = state.queue !== prev.queue;
    const indexChanged = state.index !== prev.index;
    const shuffleChanged = state.shuffle !== prev.shuffle;
    const repeatChanged = state.repeat !== prev.repeat;

    if (
      trackChanged ||
      playingChanged ||
      queueRefChanged ||
      indexChanged ||
      shuffleChanged ||
      repeatChanged
    ) {
      flushSave();
    } else {
      // currentTime / duration / volume 변경은 debounce
      scheduleSave();
    }
  });

  // business_mode 도 스냅샷에 포함 — 변경 시 debounce 저장
  const unsubBusiness = useBusinessStore.subscribe(() => scheduleSave());

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') flushSave();
  }
  function onPageHide() {
    flushSave();
  }
  function onBeforeUnload() {
    flushSave();
  }

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('beforeunload', onBeforeUnload);

  return () => {
    unsubPlayer();
    unsubBusiness();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('beforeunload', onBeforeUnload);
    if (timer) clearTimeout(timer);
  };
}
