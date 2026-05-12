/**
 * KST(UTC+9) 기준 시간대 판단.
 * 브라우저 로컬 타임존과 무관하게 항상 한국 시각 기준.
 */

export type TimeSlot = 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night';
export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedMode = 'light' | 'dark';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function getKstHour(now: Date = new Date()): number {
  const utc = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  const kst = new Date(utc + KST_OFFSET_MS);
  return kst.getHours();
}

export function getKstTimeSlot(now: Date = new Date()): TimeSlot {
  const h = getKstHour(now);
  if (h >= 0 && h < 6) return 'dawn';
  if (h >= 6 && h < 12) return 'morning';
  if (h >= 12 && h < 18) return 'afternoon';
  if (h >= 18 && h < 21) return 'evening';
  return 'night';
}

export const TIME_SLOT_LABEL: Record<TimeSlot, string> = {
  dawn: '새벽',
  morning: '아침',
  afternoon: '점심',
  evening: '저녁',
  night: '밤',
};

export function getTimeSlotLabel(slot: TimeSlot): string {
  return TIME_SLOT_LABEL[slot];
}

export function resolveMode(mode: ThemeMode): ResolvedMode {
  if (mode === 'light' || mode === 'dark') return mode;
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Apply data-theme + data-timeslot 어트리뷰트.
 * 모든 CSS 변수 매핑은 src/theme.css 에서 처리.
 */
export function applyThemeAttributes(mode: ResolvedMode, slot: TimeSlot) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = mode;
  document.documentElement.dataset.timeslot = slot;
  document.documentElement.style.colorScheme = mode;
}

/**
 * 다음 시간대 변경까지 남은 ms (1분 단위 폴링용 보조값).
 */
export function msUntilNextSlot(): number {
  const slot = getKstTimeSlot();
  const next = (() => {
    switch (slot) {
      case 'dawn': return 6;
      case 'morning': return 12;
      case 'afternoon': return 18;
      case 'evening': return 21;
      case 'night': return 24;
    }
  })();
  const utc = Date.now() + new Date().getTimezoneOffset() * 60 * 1000;
  const kst = new Date(utc + KST_OFFSET_MS);
  const targetKst = new Date(kst);
  targetKst.setHours(next, 0, 0, 0);
  return Math.max(60_000, targetKst.getTime() - kst.getTime());
}
