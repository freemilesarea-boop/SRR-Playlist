/**
 * businessScheduleTime — 매장(개인 사업자) 자동 스케줄러의 시간 계산 코어.
 *
 * 이 모듈은 I/O 가 없는 순수 함수만 담는다. Supabase client 를 import 하지 않으므로
 * DB/브라우저 없이 단위 테스트가 돈다. (storePlaybackPolicy 와 같은 역할 분리)
 *
 * ─────────────────────────────────────────────────────────────────
 * 자정 넘김(overnight) 규칙
 * ─────────────────────────────────────────────────────────────────
 * 브랜드/프랜차이즈 resolver (`get_store_active_music_policy`,
 * `storePlaybackPolicy.slotContainsTime`) 와 **동일한 규칙**을 쓴다:
 *
 *   start <= end  (일반)      → [start, end)
 *   start >  end  (자정 넘김) → [start, 24:00) ∪ [00:00, end)
 *
 * 두 경우 모두 "슬롯에 지정된 요일" 안에서 평가한다. 즉 `월` 22:00~02:00 슬롯은
 * 월요일 22:00~24:00 과 월요일 00:00~02:00 을 모두 커버한다. 매장 플레이어와
 * 브랜드 플레이어가 같은 시간 규칙을 쓰게 하려는 의도적 선택이다.
 *
 * 24시간 운영은 슬롯 3개로 빈틈 없이 덮는다 (00:00~08:00 / 08:00~16:00 / 16:00~00:00).
 * 마지막 슬롯의 end '00:00' 은 start(16:00) > end(00:00) 이므로 자정 넘김으로 해석되어
 * 실질적으로 16:00~24:00 을 덮는다 — `<input type="time">` 이 '24:00' 을 못 받기 때문에
 * 쓰는 표현이며, 별도 분기가 필요 없다.
 */

export const MINUTES_PER_DAY = 1440;

/** 하나의 스케줄 행을 시간 계산에 필요한 최소 형태로 정규화한 것. */
export interface ScheduleWindow {
  id: string;
  /** 적용 요일. 0=일 … 6=토 */
  days: number[];
  /** 자정 기준 분. 0..1440 (1440 = 24:00, exclusive end 로만 등장) */
  startMinute: number;
  endMinute: number;
}

/** KST 기준 "지금" — 요일 + 자정 기준 분. */
export interface KstInstant {
  /** 0=일 … 6=토 */
  day: number;
  /** 0..1439 */
  minutes: number;
}

/** 'HH:MM' | 'HH:MM:SS' → { h, m } */
export function parseTime(s: string): { h: number; m: number } {
  const parts = s.split(':');
  return { h: Number(parts[0] ?? 0), m: Number(parts[1] ?? 0) };
}

/** 'HH:MM' | 'HH:MM:SS' → 자정 기준 분. '24:00' → 1440 */
export function minutesOf(s: string): number {
  const { h, m } = parseTime(s);
  return h * 60 + m;
}

/** 자정 기준 분 → 'HH:MM'. 1440(=24:00) 은 '00:00' 으로 wrap — time input 호환. */
export function toHhMm(min: number): string {
  const wrapped = ((min % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 자정을 넘는 슬롯인가 (start > end). 예: 22:00~02:00 */
export function crossesMidnight(startMinute: number, endMinute: number): boolean {
  return startMinute > endMinute;
}

/** 'HH:MM' 문자열 쌍이 자정을 넘는지 — UI 표시용 편의 wrapper. */
export function timeRangeCrossesMidnight(start: string, end: string): boolean {
  return crossesMidnight(minutesOf(start), minutesOf(end));
}

/** minute 가 [start, end) 안에 드는가 — 자정 넘김 지원. */
export function windowContains(w: ScheduleWindow, minutes: number): boolean {
  if (!crossesMidnight(w.startMinute, w.endMinute)) {
    return minutes >= w.startMinute && minutes < w.endMinute;
  }
  return minutes >= w.startMinute || minutes < w.endMinute;
}

/**
 * 하루 안에서 슬롯이 차지하는 구간들. 자정 넘김이면 2조각으로 쪼갠다.
 * 겹침 검사는 이 구간 단위로 한다.
 */
export function windowSegments(w: ScheduleWindow): Array<[number, number]> {
  if (!crossesMidnight(w.startMinute, w.endMinute)) {
    return [[w.startMinute, w.endMinute]];
  }
  return [
    [w.startMinute, MINUTES_PER_DAY],
    [0, w.endMinute],
  ];
}

/** 지금 재생돼야 할 슬롯. 여러 개가 겹치면 시작이 이른 쪽. 없으면 null. */
export function pickCurrentWindow(
  windows: ScheduleWindow[],
  now: KstInstant,
): ScheduleWindow | null {
  const matches = windows
    .filter((w) => w.days.includes(now.day) && windowContains(w, now.minutes))
    .sort((a, b) => a.startMinute - b.startMinute);
  return matches[0] ?? null;
}

/**
 * 다음에 시작될 슬롯. 지금 재생 중인 슬롯은 제외한다
 * (자정 넘김 슬롯은 start 가 현재 시각보다 "뒤"로 보여서, 제외하지 않으면
 *  재생 중인 슬롯이 '다음 시간대'로 표시되는 버그가 난다).
 */
export function pickNextWindow(
  windows: ScheduleWindow[],
  now: KstInstant,
): ScheduleWindow | null {
  const activeIds = new Set(
    windows.filter((w) => w.days.includes(now.day) && windowContains(w, now.minutes)).map((w) => w.id),
  );
  const upcoming = windows.filter((w) => !activeIds.has(w.id));

  // 오늘 안에서 아직 시작 전인 슬롯
  const today = upcoming
    .filter((w) => w.days.includes(now.day) && w.startMinute > now.minutes)
    .sort((a, b) => a.startMinute - b.startMinute);
  if (today[0]) return today[0];

  // 내일부터 한 바퀴
  for (let i = 1; i <= 7; i++) {
    const nextDay = (now.day + i) % 7;
    const ofDay = upcoming
      .filter((w) => w.days.includes(nextDay))
      .sort((a, b) => a.startMinute - b.startMinute);
    if (ofDay[0]) return ofDay[0];
  }
  return null;
}

/** 요일을 하나라도 공유하면서 시간이 겹치는 슬롯들의 id. 자정 넘김 구간까지 본다. */
export function findOverlappingWindowIds(windows: ScheduleWindow[]): Set<string> {
  const overlapping = new Set<string>();
  for (let i = 0; i < windows.length; i++) {
    for (let j = i + 1; j < windows.length; j++) {
      const a = windows[i];
      const b = windows[j];
      if (!a.days.some((d) => b.days.includes(d))) continue;
      const segsA = windowSegments(a);
      const segsB = windowSegments(b);
      const hit = segsA.some(([aStart, aEnd]) =>
        segsB.some(([bStart, bEnd]) => aStart < bEnd && bStart < aEnd),
      );
      if (hit) {
        overlapping.add(a.id);
        overlapping.add(b.id);
      }
    }
  }
  return overlapping;
}

/** KST 현재 요일/분. */
export function nowKstParts(now: Date = new Date()): KstInstant {
  const utc = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  const kst = new Date(utc + 9 * 60 * 60 * 1000);
  return {
    day: kst.getDay(),
    minutes: kst.getHours() * 60 + kst.getMinutes(),
  };
}
