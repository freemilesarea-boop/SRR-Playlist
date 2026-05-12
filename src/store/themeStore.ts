import { create } from 'zustand';
import {
  applyThemeAttributes,
  getKstTimeSlot,
  resolveMode,
  type ThemeMode,
  type ResolvedMode,
  type TimeSlot,
} from '@/lib/timeTheme';

const STORAGE_KEY = 'srr-theme-mode';

interface ThemeState {
  mode: ThemeMode;
  resolvedMode: ResolvedMode;
  timeSlot: TimeSlot;
  setMode: (m: ThemeMode) => void;
  refreshTimeSlot: () => void;
  init: () => void;
}

function readStoredMode(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* noop */
  }
  return 'system';
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: 'system',
  resolvedMode: 'dark',
  timeSlot: 'night',

  setMode: (m) => {
    try {
      localStorage.setItem(STORAGE_KEY, m);
    } catch {
      /* noop */
    }
    const resolved = resolveMode(m);
    const slot = getKstTimeSlot();
    applyThemeAttributes(resolved, slot);
    set({ mode: m, resolvedMode: resolved, timeSlot: slot });
  },

  refreshTimeSlot: () => {
    const slot = getKstTimeSlot();
    if (slot === get().timeSlot) return;
    applyThemeAttributes(get().resolvedMode, slot);
    set({ timeSlot: slot });
  },

  init: () => {
    const mode = readStoredMode();
    const resolved = resolveMode(mode);
    const slot = getKstTimeSlot();
    applyThemeAttributes(resolved, slot);
    set({ mode, resolvedMode: resolved, timeSlot: slot });

    // system 모드일 때 OS 설정 변경 감지
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => {
        if (get().mode !== 'system') return;
        const r = resolveMode('system');
        applyThemeAttributes(r, get().timeSlot);
        set({ resolvedMode: r });
      };
      mq.addEventListener?.('change', onChange);
    }
  },
}));
