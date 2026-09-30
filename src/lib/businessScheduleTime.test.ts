import { describe, it, expect } from 'vitest';
import {
  MINUTES_PER_DAY,
  findOverlappingWindowIds,
  minutesOf,
  nowKstParts,
  pickCurrentWindow,
  pickNextWindow,
  timeRangeCrossesMidnight,
  toHhMm,
  windowContains,
  windowSegments,
  type ScheduleWindow,
} from './businessScheduleTime';

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/** 24시간 운영 프리셋 (BusinessScheduler 의 FULL_DAY_SLOTS 와 동일한 시간). */
const FULL_DAY: ScheduleWindow[] = [
  { id: 'am', days: ALL_DAYS, startMinute: minutesOf('00:00'), endMinute: minutesOf('08:00') },
  { id: 'pm', days: ALL_DAYS, startMinute: minutesOf('08:00'), endMinute: minutesOf('16:00') },
  { id: 'night', days: ALL_DAYS, startMinute: minutesOf('16:00'), endMinute: minutesOf('00:00') },
];

describe('시간 파싱', () => {
  it("'HH:MM' 과 'HH:MM:SS' 를 모두 받는다", () => {
    expect(minutesOf('09:30')).toBe(570);
    expect(minutesOf('09:30:00')).toBe(570);
  });

  it("'24:00' 은 1440 — 0007 템플릿(와인바 마감 22:00~24:00) 호환", () => {
    expect(minutesOf('24:00')).toBe(MINUTES_PER_DAY);
  });

  it('toHhMm 은 1440 을 00:00 으로 wrap 한다 (time input 호환)', () => {
    expect(toHhMm(0)).toBe('00:00');
    expect(toHhMm(570)).toBe('09:30');
    expect(toHhMm(MINUTES_PER_DAY)).toBe('00:00');
    expect(toHhMm(MINUTES_PER_DAY + 120)).toBe('02:00');
  });

  it('자정 넘김 판별', () => {
    expect(timeRangeCrossesMidnight('22:00', '02:00')).toBe(true);
    expect(timeRangeCrossesMidnight('16:00', '00:00')).toBe(true);
    expect(timeRangeCrossesMidnight('09:00', '18:00')).toBe(false);
    expect(timeRangeCrossesMidnight('22:00', '24:00')).toBe(false);
  });
});

describe('windowContains — 자정 넘김', () => {
  const overnight: ScheduleWindow = {
    id: 'overnight',
    days: ALL_DAYS,
    startMinute: minutesOf('22:00'),
    endMinute: minutesOf('02:00'),
  };

  it('22:00~02:00 은 밤과 새벽을 모두 덮는다', () => {
    expect(windowContains(overnight, minutesOf('23:30'))).toBe(true);
    expect(windowContains(overnight, minutesOf('01:00'))).toBe(true);
  });

  it('영업 시간 밖은 걸리지 않는다', () => {
    expect(windowContains(overnight, minutesOf('12:00'))).toBe(false);
    expect(windowContains(overnight, minutesOf('21:59'))).toBe(false);
  });

  it('시작은 포함, 종료는 제외 — [start, end)', () => {
    expect(windowContains(overnight, minutesOf('22:00'))).toBe(true);
    expect(windowContains(overnight, minutesOf('02:00'))).toBe(false);
  });

  it('일반 슬롯의 경계도 [start, end)', () => {
    const normal: ScheduleWindow = {
      id: 'normal',
      days: ALL_DAYS,
      startMinute: minutesOf('09:00'),
      endMinute: minutesOf('18:00'),
    };
    expect(windowContains(normal, minutesOf('09:00'))).toBe(true);
    expect(windowContains(normal, minutesOf('17:59'))).toBe(true);
    expect(windowContains(normal, minutesOf('18:00'))).toBe(false);
  });

  it('자정 넘김 슬롯은 하루 안에서 두 조각으로 쪼개진다', () => {
    expect(windowSegments(overnight)).toEqual([
      [minutesOf('22:00'), MINUTES_PER_DAY],
      [0, minutesOf('02:00')],
    ]);
  });
});

describe('24시간 운영 프리셋', () => {
  it('하루 1,440분 전부를 정확히 1개 슬롯이 덮는다 (빈틈 0, 겹침 0)', () => {
    for (let m = 0; m < MINUTES_PER_DAY; m++) {
      const matches = FULL_DAY.filter((w) => windowContains(w, m));
      expect(matches, `${toHhMm(m)} 에 매칭된 슬롯 수`).toHaveLength(1);
    }
  });

  it('겹침 검사에 걸리지 않는다', () => {
    expect(findOverlappingWindowIds(FULL_DAY).size).toBe(0);
  });

  it('새벽 03:00 에도 재생할 슬롯이 있다 (수정 전에는 null 이었다)', () => {
    const current = pickCurrentWindow(FULL_DAY, { day: 3, minutes: minutesOf('03:00') });
    expect(current?.id).toBe('am');
  });

  it('심야 23:00 은 마지막 슬롯이 이어받는다', () => {
    const current = pickCurrentWindow(FULL_DAY, { day: 3, minutes: minutesOf('23:00') });
    expect(current?.id).toBe('night');
  });
});

describe('pickCurrentWindow — 요일', () => {
  const monOnly: ScheduleWindow = {
    id: 'mon-night',
    days: [1],
    startMinute: minutesOf('22:00'),
    endMinute: minutesOf('02:00'),
  };

  it('지정 요일의 밤과 새벽을 모두 덮는다 (브랜드 resolver 와 동일 규칙)', () => {
    expect(pickCurrentWindow([monOnly], { day: 1, minutes: minutesOf('23:00') })?.id).toBe('mon-night');
    expect(pickCurrentWindow([monOnly], { day: 1, minutes: minutesOf('01:00') })?.id).toBe('mon-night');
  });

  it('지정되지 않은 요일에는 잡히지 않는다', () => {
    expect(pickCurrentWindow([monOnly], { day: 2, minutes: minutesOf('01:00') })).toBeNull();
  });

  it('겹치면 시작이 이른 쪽이 이긴다', () => {
    const early: ScheduleWindow = { id: 'early', days: ALL_DAYS, startMinute: 540, endMinute: 720 };
    const late: ScheduleWindow = { id: 'late', days: ALL_DAYS, startMinute: 600, endMinute: 780 };
    expect(pickCurrentWindow([late, early], { day: 3, minutes: 660 })?.id).toBe('early');
  });
});

describe('pickNextWindow', () => {
  it('재생 중인 자정 넘김 슬롯을 "다음"으로 잘못 내놓지 않는다', () => {
    const windows: ScheduleWindow[] = [
      { id: 'overnight', days: ALL_DAYS, startMinute: minutesOf('22:00'), endMinute: minutesOf('02:00') },
      { id: 'morning', days: ALL_DAYS, startMinute: minutesOf('09:00'), endMinute: minutesOf('12:00') },
    ];
    // 새벽 00:30 — overnight 가 재생 중이므로 다음은 morning
    const next = pickNextWindow(windows, { day: 3, minutes: minutesOf('00:30') });
    expect(next?.id).toBe('morning');
  });

  it('오늘 남은 슬롯이 없으면 다음 요일에서 찾는다', () => {
    const windows: ScheduleWindow[] = [
      { id: 'sat', days: [6], startMinute: minutesOf('10:00'), endMinute: minutesOf('18:00') },
    ];
    const next = pickNextWindow(windows, { day: 3, minutes: minutesOf('20:00') });
    expect(next?.id).toBe('sat');
  });

  it('슬롯이 없으면 null', () => {
    expect(pickNextWindow([], { day: 3, minutes: 600 })).toBeNull();
  });
});

describe('findOverlappingWindowIds', () => {
  it('자정 넘김 구간의 겹침도 잡아낸다', () => {
    const windows: ScheduleWindow[] = [
      { id: 'a', days: ALL_DAYS, startMinute: minutesOf('22:00'), endMinute: minutesOf('02:00') },
      { id: 'b', days: ALL_DAYS, startMinute: minutesOf('01:00'), endMinute: minutesOf('03:00') },
    ];
    expect([...findOverlappingWindowIds(windows)].sort()).toEqual(['a', 'b']);
  });

  it('요일이 겹치지 않으면 시간이 겹쳐도 문제 없다', () => {
    const windows: ScheduleWindow[] = [
      { id: 'weekday', days: [1, 2, 3, 4, 5], startMinute: minutesOf('22:00'), endMinute: minutesOf('02:00') },
      { id: 'weekend', days: [0, 6], startMinute: minutesOf('22:00'), endMinute: minutesOf('02:00') },
    ];
    expect(findOverlappingWindowIds(windows).size).toBe(0);
  });

  it('맞닿기만 한 슬롯은 겹침이 아니다', () => {
    const windows: ScheduleWindow[] = [
      { id: 'a', days: ALL_DAYS, startMinute: minutesOf('09:00'), endMinute: minutesOf('12:00') },
      { id: 'b', days: ALL_DAYS, startMinute: minutesOf('12:00'), endMinute: minutesOf('18:00') },
    ];
    expect(findOverlappingWindowIds(windows).size).toBe(0);
  });
});

describe('nowKstParts', () => {
  it('UTC 를 KST(+9) 로 옮긴다', () => {
    // 2026-09-30T00:30Z → KST 09:30, 수요일(3)
    const parts = nowKstParts(new Date('2026-09-30T00:30:00Z'));
    expect(parts).toEqual({ day: 3, minutes: minutesOf('09:30') });
  });

  it('UTC 자정 직전은 KST 로 다음날 아침', () => {
    // 2026-09-29T23:00Z → KST 2026-09-30 08:00, 수요일(3)
    const parts = nowKstParts(new Date('2026-09-29T23:00:00Z'));
    expect(parts).toEqual({ day: 3, minutes: minutesOf('08:00') });
  });
});
