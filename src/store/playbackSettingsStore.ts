import { create } from 'zustand';

export const CROSSFADE_OPTIONS = [0, 3, 5, 8, 10] as const;
export type CrossfadeSeconds = (typeof CROSSFADE_OPTIONS)[number];

interface PlaybackSettingsState {
  crossfadeEnabled: boolean;
  crossfadeSeconds: CrossfadeSeconds;
  /** 사용자가 명시적으로 설정했는지. true 면 매장 모드가 덮어쓰지 않음. */
  userOverride: boolean;

  setCrossfadeEnabled: (v: boolean, fromUser?: boolean) => void;
  setCrossfadeSeconds: (s: CrossfadeSeconds, fromUser?: boolean) => void;
  enableForBusinessMode: () => void;
  init: () => void;
}

const STORAGE_KEY = 'srr-playback-settings';

interface StoredSettings {
  crossfadeEnabled: boolean;
  crossfadeSeconds: CrossfadeSeconds;
  userOverride: boolean;
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
    };
    set(next as PlaybackSettingsState);
    write(next);
  },

  setCrossfadeSeconds: (s, fromUser = true) => {
    const next = {
      crossfadeEnabled: s > 0,
      crossfadeSeconds: s,
      userOverride: fromUser || get().userOverride,
    };
    set(next as PlaybackSettingsState);
    write(next);
  },

  /** 매장 모드 시작 시 호출. 사용자가 직접 설정한 값이 있으면 그대로 둠. */
  enableForBusinessMode: () => {
    if (get().userOverride) return;
    const next = {
      crossfadeEnabled: true,
      crossfadeSeconds: 5 as CrossfadeSeconds,
      userOverride: false,
    };
    set(next as PlaybackSettingsState);
    write(next);
  },
}));
