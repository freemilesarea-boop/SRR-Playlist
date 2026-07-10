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

// WEB-OPT-4 — matchMedia('change') 리스너는 앱 수명 동안 단 1회만 등록한다.
// 배경: init() 은 App useEffect 에서 호출되는데, StrictMode 이중 invoke / 재호출 시
//   가드가 없으면 익명 onChange 리스너가 계속 누적됐다(remove 불가 → 장시간 실행 시 누수).
// 리스너는 OS 테마 변경을 세션 내내 추적해야 하므로 제거 없이 "1회 등록"이 정답(app-lifetime singleton).
let mqBound = false;

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

    // system 모드일 때 OS 설정 변경 감지 — 앱 수명 동안 1회만 등록(중복 누수 방지).
    if (!mqBound && typeof window !== 'undefined' && window.matchMedia) {
      mqBound = true;
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => {
        // 항상 store getter 로 최신 state 를 읽으므로 stale closure 없음.
        if (get().mode !== 'system') return;
        const r = resolveMode('system');
        applyThemeAttributes(r, get().timeSlot);
        set({ resolvedMode: r });
      };
      mq.addEventListener?.('change', onChange);
    }
  },
}));
