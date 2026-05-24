import { create } from 'zustand';

/**
 * 매장 재생 모드 / 플레이어 안정성 상태 공유 스토어.
 * - 오디오 엔진(Player.tsx)이 네트워크/오류/wake-lock 상태를 여기에 기록하고,
 *   매장 재생 모드(StorePlayerPage) UI 가 이를 읽어 표시한다.
 * - 오디오 재생 자체는 항상 전역 <Player> 의 audio element 가 담당(단일 소스).
 */
interface PlaybackHealthState {
  online: boolean;
  /** 이번 세션에서 재생 실패(스킵)된 누적 횟수 */
  failedCount: number;
  lastErrorAt: number | null;
  lastErrorName: string | null;
  /** Wake Lock(화면 꺼짐 방지) 지원/활성 상태 */
  wakeLockSupported: boolean;
  wakeLockActive: boolean;
  /** 오늘(로컬 날짜 기준) 재생 시작한 곡 수 */
  todayPlayCount: number;
  todayKey: string;

  setOnline: (v: boolean) => void;
  reportPlaybackError: (name: string | null) => void;
  setWakeLock: (supported: boolean, active: boolean) => void;
  incTodayPlay: () => void;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export const usePlaybackHealthStore = create<PlaybackHealthState>((set, get) => ({
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  failedCount: 0,
  lastErrorAt: null,
  lastErrorName: null,
  wakeLockSupported: typeof navigator !== 'undefined' && 'wakeLock' in navigator,
  wakeLockActive: false,
  todayPlayCount: 0,
  todayKey: todayStr(),

  setOnline: (v) => set({ online: v }),
  reportPlaybackError: (name) =>
    set((s) => ({ failedCount: s.failedCount + 1, lastErrorAt: Date.now(), lastErrorName: name })),
  setWakeLock: (supported, active) => set({ wakeLockSupported: supported, wakeLockActive: active }),
  incTodayPlay: () => {
    const k = todayStr();
    if (k !== get().todayKey) set({ todayKey: k, todayPlayCount: 1 });
    else set((s) => ({ todayPlayCount: s.todayPlayCount + 1 }));
  },
}));
