import { create } from 'zustand';

export const CROSSFADE_OPTIONS = [0, 3, 5, 8, 10] as const;
export type CrossfadeSeconds = (typeof CROSSFADE_OPTIONS)[number];

interface PlaybackSettingsState {
  crossfadeEnabled: boolean;
  crossfadeSeconds: CrossfadeSeconds;
  /** 사용자가 명시적으로 설정했는지. true 면 매장 모드가 덮어쓰지 않음. */
  userOverride: boolean;
  autoplayRecommendations: boolean;

  setCrossfadeEnabled: (v: boolean, fromUser?: boolean) => void;
  setCrossfadeSeconds: (s: CrossfadeSeconds, fromUser?: boolean) => void;
  setAutoplayRecommendations: (v: boolean) => void;
  enableForBusinessMode: () => void;
  init: () => void;
}

const STORAGE_KEY = 'srr-playback-settings';

interface StoredSettings {
  crossfadeEnabled: boolean;
  crossfadeSeconds: CrossfadeSeconds;
  userOverride: boolean;
  autoplayRecommendations: boolean;
}

function readStored(): StoredSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSettings>;
    return {
      crossfadeEnabled: !!parsed.crossfadeEnabled,
      crossfadeSeconds: ((CROSSFADE_OPTIONS as readonly number[]).includes(parsed.crossfadeSeconds as number)
        ? (parsed.crossfadeSeconds as CrossfadeSeconds)
        : 0),
      userOverride: !!parsed.userOverride,
      autoplayRecommendations: parsed.autoplayRecommendations !== false,
    };
  } catch {
    return null;
  }
}

function write(s: StoredSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* noop */
  }
}

export const usePlaybackSettingsStore = create<PlaybackSettingsState>((set, get) => ({
  crossfadeEnabled: false,
  crossfadeSeconds: 0,
  userOverride: false,
  autoplayRecommendations: true,

  setAutoplayRecommendations: (v) => {
    const next = {
      crossfadeEnabled: get().crossfadeEnabled,
      crossfadeSeconds: get().crossfadeSeconds,
      userOverride: get().userOverride,
      autoplayRecommendations: v,
    };
    set({ autoplayRecommendations: v });
    write(next);
  },

  init: () => {
    const stored = readStored();
    if (stored) {
      set(stored);
    }
  },

  setCrossfadeEnabled: (v, fromUser = true) => {
    const next = {
      crossfadeEnabled: v,
      crossfadeSeconds: v && get().crossfadeSeconds === 0 ? 3 : get().crossfadeSeconds,
      userOverride: fromUser || get().userOverride,
      autoplayRecommendations: get().autoplayRecommendations,
    };
    set(next as PlaybackSettingsState);
    write(next);
  },

  setCrossfadeSeconds: (s, fromUser = true) => {
    const next = {
      crossfadeEnabled: s > 0,
      crossfadeSeconds: s,
      userOverride: fromUser || get().userOverride,
      autoplayRecommendations: get().autoplayRecommendations,
    };
    set(next as PlaybackSettingsState);
    write(next);
  },

  /** 매장 모드 시작 시 호출.
   *
   *  X6.88.1 (긴급 안정성 follow-up) — userOverride 와 무관하게 crossfade 강제 OFF.
   *
   *  배경: X6.88 시점에는 `if (userOverride) return` 가 있어, 이전에 사용자가
   *  명시 활성화한 매장 (userOverride=true, crossfadeEnabled=true) 의 localStorage
   *  를 정규화하지 못함 → hotfix 가 그 매장에 효력 없음. 매장 안정성 절대 우선
   *  이므로 진입 시점에 무조건 OFF + userOverride=false 로 초기화.
   *
   *  - 매장 모드: 항상 OFF 강제 (이 함수)
   *  - 일반 사용자 모드: 영향 없음 (setCrossfadeEnabled / setCrossfadeSeconds 가
   *    호출되어야만 변경됨, 그 경로는 userOverride 유지). */
  enableForBusinessMode: () => {
    const next = {
      crossfadeEnabled: false,
      crossfadeSeconds: 0 as CrossfadeSeconds,
      userOverride: false,
      autoplayRecommendations: get().autoplayRecommendations,
    };
    set(next as PlaybackSettingsState);
    write(next);
  },
}));
