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
  syncThemeColorMeta();
}

/** CSS 변수에 들어있는 "10 10 10" 같은 rgb 3원소를 #rrggbb 로. 못 읽으면 null. */
export function rgbTripletToHex(triplet: string): string | null {
  const parts = triplet.trim().split(/[\s,]+/).filter(Boolean);
  if (parts.length !== 3) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
  return `#${nums.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * 브라우저 크롬 색을 테마에 맞춘다.
 *
 * index.html 의 theme-color 는 #0a0a0a 로 고정이었다. 네이티브 앱은 StatusBar 플러그인이
 * 따로 맞춰주지만, 아이폰·아이패드는 지금 PWA 로만 돌기 때문에 이 메타 태그가 전부다 —
 * 라이트 테마로 써도 사파리 툴바와 안드로이드 크롬 주소창만 새까맣게 남았다.
 *
 * 시간대(timeslot) 테마까지 반영해야 하므로 색은 하드코딩하지 않고 문서에서 읽는다.
 */
export function syncThemeColorMeta(): void {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return;
  try {
    const hex = rgbTripletToHex(
      getComputedStyle(document.documentElement).getPropertyValue('--color-bg'),
    );
    if (!hex) return;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = hex;
  } catch {
    /* 메타 태그 하나 때문에 테마 적용을 막지는 않는다 */
  }
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
