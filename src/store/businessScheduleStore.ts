import { create } from 'zustand';
import {
  fetchBusinessProfile,
  fetchBusinessSchedules,
  type BusinessProfile,
  type BusinessSchedule,
} from '@/lib/businessSchedulerApi';
import { fetchPlaylists } from '@/lib/api';
import type { PlaylistRow, TrackRow } from '@/types/db';

/**
 * 매장 자동 운영 통합 스토어 — single source of truth.
 *
 * BusinessPage(NOW 카드)와 BusinessScheduler(에디터)가 동일한 schedules/profile/playlists를
 * 구독하여 "내가 설정한 음악"과 "지금 재생될 음악"이 항상 일치하도록 보장.
 *
 * 자동 전환 엔진(useBusinessAutoSwitch)이 prefetch한 트랙도 같은 스토어에서 공유.
 */
interface BusinessScheduleStore {
  // 저장된 DB 상태
  schedules: BusinessSchedule[];
  profile: BusinessProfile | null;
  playlists: PlaylistRow[];
  loading: boolean;
  // 1-min tick — current/next 재계산 트리거
  tick: number;
  // 현재 슬롯의 prefetch 트랙 (autoplay 정책 안전한 동기 setQueue 용)
  currentTracks: TrackRow[] | null;
  tracksLoading: boolean;
  tracksError: string | null;
  // 마지막으로 자동 전환한 schedule id (중복 전환 방지)
  lastSwitchedScheduleId: string | null;

  // Actions
  refresh: (userId: string) => Promise<void>;
  setSchedules: (s: BusinessSchedule[]) => void;
  setProfile: (p: BusinessProfile | null) => void;
  bumpTick: () => void;
  setCurrentTracks: (t: TrackRow[] | null) => void;
  setTracksLoading: (b: boolean) => void;
  setTracksError: (s: string | null) => void;
  setLastSwitchedScheduleId: (id: string | null) => void;
}

export const useBusinessScheduleStore = create<BusinessScheduleStore>((set) => ({
  schedules: [],
  profile: null,
  playlists: [],
  loading: true,
  tick: 0,
  currentTracks: null,
  tracksLoading: false,
  tracksError: null,
  lastSwitchedScheduleId: null,

  async refresh(userId) {
    set({ loading: true });
    try {
      const [p, s, pls] = await Promise.all([
        fetchBusinessProfile(userId),
        fetchBusinessSchedules(userId).catch(() => []),
        fetchPlaylists(),
      ]);
      set({ profile: p, schedules: s, playlists: pls });
    } finally {
      set({ loading: false });
    }
  },
  setSchedules: (s) => set({ schedules: s }),
  setProfile: (p) => set({ profile: p }),
  bumpTick: () => set((st) => ({ tick: st.tick + 1 })),
  setCurrentTracks: (t) => set({ currentTracks: t }),
  setTracksLoading: (b) => set({ tracksLoading: b }),
  setTracksError: (s) => set({ tracksError: s }),
  setLastSwitchedScheduleId: (id) => set({ lastSwitchedScheduleId: id }),
}));
