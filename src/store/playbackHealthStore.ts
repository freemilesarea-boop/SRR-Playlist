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
  /**
   * BRAND-PLAYER-24H — 브라우저 자동재생 정책에 막혀 소리가 시작되지 못한 상태.
   * 무인 매장에서는 토스트로는 아무도 못 보므로 전체화면 안내를 띄우는 근거가 된다.
   */
  autoplayBlocked: boolean;
  /** 새 빌드가 준비됐지만 재생 중이라 리로드를 미뤄둔 상태. */
  swUpdatePending: boolean;
  /**
   * 오디오가 **실제로** 소리를 내고 있는가 (audio element 의 playing/pause 이벤트 기준).
   * store.playing 은 "재생 의도"라 오류로 멈춘 플레이어도 true 로 남는다. 배포 리로드를
   * 미룰지 판단할 때는 의도가 아니라 실제 재생 여부를 봐야 한다.
   */
  audioActive: boolean;
  /**
   * 매장 모드인데 구독이 만료/미결제라 재생이 차단된 상태.
   * 무료 등급으로 매장 플레이어를 돌리면 곡당 25초만 나오고 멈춰서 "음악이 중간에
   * 끊긴다" 로 보인다 — 매장에서는 미리듣기를 주지 않고 이유를 명시한다.
   */
  subscriptionBlocked: boolean;

  setOnline: (v: boolean) => void;
  reportPlaybackError: (name: string | null) => void;
  setWakeLock: (supported: boolean, active: boolean) => void;
  incTodayPlay: () => void;
  setAutoplayBlocked: (v: boolean) => void;
  setSwUpdatePending: (v: boolean) => void;
  setAudioActive: (v: boolean) => void;
  setSubscriptionBlocked: (v: boolean) => void;
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
  autoplayBlocked: false,
  swUpdatePending: false,
  audioActive: false,
  subscriptionBlocked: false,

  setOnline: (v) => set({ online: v }),
  reportPlaybackError: (name) =>
    set((s) => ({ failedCount: s.failedCount + 1, lastErrorAt: Date.now(), lastErrorName: name })),
  setWakeLock: (supported, active) => set({ wakeLockSupported: supported, wakeLockActive: active }),
  incTodayPlay: () => {
    const k = todayStr();
    if (k !== get().todayKey) set({ todayKey: k, todayPlayCount: 1 });
    else set((s) => ({ todayPlayCount: s.todayPlayCount + 1 }));
  },
  setAutoplayBlocked: (v) => set({ autoplayBlocked: v }),
  setSwUpdatePending: (v) => set({ swUpdatePending: v }),
  setAudioActive: (v) => set({ audioActive: v }),
  setSubscriptionBlocked: (v) => set({ subscriptionBlocked: v }),
}));
