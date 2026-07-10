// Phase BRAND-PLAYER-UX-2 — 브랜드 사이니지 설정/미리로드/진행표시/시계 순수 로직 단위 테스트.
import { describe, it, expect } from 'vitest';
import {
  normalizeSignageSettings, normalizeTransitionEffect, normalizeTransitionMs,
  slidePreloadIndexes, slideProgressMode, formatClockHhMm,
  DEFAULT_SIGNAGE_SETTINGS, DEFAULT_TRANSITION_MS, MIN_TRANSITION_MS, MAX_TRANSITION_MS,
  SLIDE_DOTS_MIN, SLIDE_COUNTER_THRESHOLD,
} from './brandSignageSettings';

describe('normalizeTransitionEffect (none/fade 만 허용)', () => {
  it('none 그대로', () => { expect(normalizeTransitionEffect('none')).toBe('none'); });
  it('fade 그대로', () => { expect(normalizeTransitionEffect('fade')).toBe('fade'); });
  it('대소문자/공백 정규화', () => {
    expect(normalizeTransitionEffect(' FADE ')).toBe('fade');
    expect(normalizeTransitionEffect('None')).toBe('none');
  });
  it('미지원 효과(slide/zoom/kenburns) → fade', () => {
    expect(normalizeTransitionEffect('slide')).toBe('fade');
    expect(normalizeTransitionEffect('zoom')).toBe('fade');
    expect(normalizeTransitionEffect('kenburns')).toBe('fade');
  });
  it('null/undefined/숫자 → fade', () => {
    expect(normalizeTransitionEffect(null)).toBe('fade');
    expect(normalizeTransitionEffect(undefined)).toBe('fade');
    expect(normalizeTransitionEffect(123)).toBe('fade');
  });
});

describe('normalizeTransitionMs (0~2000 clamp, 기본 500)', () => {
  it('범위 내 그대로', () => { expect(normalizeTransitionMs(500)).toBe(500); });
  it('유효한 0 보존(none/즉시)', () => { expect(normalizeTransitionMs(0)).toBe(0); });
  it('음수 → 0 clamp', () => { expect(normalizeTransitionMs(-100)).toBe(MIN_TRANSITION_MS); });
  it('2000 초과 → 2000 clamp', () => { expect(normalizeTransitionMs(9999)).toBe(MAX_TRANSITION_MS); });
  it('문자열 "800" → 800', () => { expect(normalizeTransitionMs('800')).toBe(800); });
  it('소수 반올림', () => { expect(normalizeTransitionMs(499.6)).toBe(500); });
  it('NaN/null/undefined/비숫자 → 기본 500', () => {
    expect(normalizeTransitionMs(NaN)).toBe(DEFAULT_TRANSITION_MS);
    expect(normalizeTransitionMs(null)).toBe(DEFAULT_TRANSITION_MS);
    expect(normalizeTransitionMs(undefined)).toBe(DEFAULT_TRANSITION_MS);
    expect(normalizeTransitionMs('abc')).toBe(DEFAULT_TRANSITION_MS);
  });
});

describe('normalizeSignageSettings (레거시/null fallback + 정규화)', () => {
  it('null → 전부 default(fade/500/off)', () => {
    expect(normalizeSignageSettings(null)).toEqual(DEFAULT_SIGNAGE_SETTINGS);
  });
  it('undefined → default', () => {
    expect(normalizeSignageSettings(undefined)).toEqual(DEFAULT_SIGNAGE_SETTINGS);
  });
  it('빈 객체 → default(옵션 전부 off)', () => {
    expect(normalizeSignageSettings({})).toEqual(DEFAULT_SIGNAGE_SETTINGS);
  });
  it('표시 옵션은 명시적 true 일 때만 on', () => {
    const s = normalizeSignageSettings({
      show_brand_name: true, show_now_playing: 'yes', show_clock: 1, show_slide_dots: false,
    });
    expect(s.show_brand_name).toBe(true);
    expect(s.show_now_playing).toBe(false); // 문자열은 off
    expect(s.show_clock).toBe(false);       // 숫자는 off
    expect(s.show_slide_dots).toBe(false);
  });
  it('전체 정상값 정규화', () => {
    const s = normalizeSignageSettings({
      transition_effect: 'none', transition_duration_ms: 800,
      show_brand_name: true, show_now_playing: true, show_clock: true, show_slide_dots: true,
    });
    expect(s).toEqual({
      transition_effect: 'none', transition_duration_ms: 800,
      show_brand_name: true, show_now_playing: true, show_clock: true, show_slide_dots: true,
    });
  });
  it('손상값 → 안전 정규화(effect fallback + duration clamp)', () => {
    const s = normalizeSignageSettings({ transition_effect: 'slide', transition_duration_ms: 99999 });
    expect(s.transition_effect).toBe('fade');
    expect(s.transition_duration_ms).toBe(2000);
  });
  it('비객체(문자열/숫자) → default', () => {
    expect(normalizeSignageSettings('x')).toEqual(DEFAULT_SIGNAGE_SETTINGS);
    expect(normalizeSignageSettings(42)).toEqual(DEFAULT_SIGNAGE_SETTINGS);
  });
});

describe('slidePreloadIndexes (bounded — 현재 제외, 다음 1~2, dedupe)', () => {
  it('count<=1 → 빈 배열(미리로드 불필요)', () => {
    expect(slidePreloadIndexes(0, 0)).toEqual([]);
    expect(slidePreloadIndexes(0, 1)).toEqual([]);
  });
  it('기본(next 1장): 다음 인덱스만', () => {
    expect(slidePreloadIndexes(0, 5)).toEqual([1]);
    expect(slidePreloadIndexes(4, 5)).toEqual([0]); // wrap
  });
  it('includeSecond: 다음+1까지(총 2장)', () => {
    expect(slidePreloadIndexes(0, 5, true)).toEqual([1, 2]);
    expect(slidePreloadIndexes(4, 5, true)).toEqual([0, 1]); // wrap
  });
  it('count=2 면 next 와 next+1 이 같아 dedupe → 1장', () => {
    expect(slidePreloadIndexes(0, 2, true)).toEqual([1]);
    expect(slidePreloadIndexes(1, 2, true)).toEqual([0]);
  });
  it('항상 현재 인덱스는 제외', () => {
    expect(slidePreloadIndexes(3, 5, true)).not.toContain(3);
  });
  it('100장이어도 최대 2개만 반환(전부 로드 안 함)', () => {
    expect(slidePreloadIndexes(0, 100, true).length).toBe(2);
    expect(slidePreloadIndexes(50, 100).length).toBe(1);
  });
  it('out-of-range current 정규화', () => {
    expect(slidePreloadIndexes(7, 5)).toEqual([slidePreloadIndexes(2, 5)[0]]);
  });
});

describe('slideProgressMode (2장~ 도트, 20장~ 카운터)', () => {
  it('0/1장 → none', () => {
    expect(slideProgressMode(0)).toBe('none');
    expect(slideProgressMode(1)).toBe('none');
  });
  it('2~19장 → dots', () => {
    expect(slideProgressMode(SLIDE_DOTS_MIN)).toBe('dots');
    expect(slideProgressMode(2)).toBe('dots');
    expect(slideProgressMode(19)).toBe('dots');
  });
  it('20장 이상 → counter', () => {
    expect(slideProgressMode(SLIDE_COUNTER_THRESHOLD)).toBe('counter');
    expect(slideProgressMode(20)).toBe('counter');
    expect(slideProgressMode(100)).toBe('counter');
  });
});

describe('formatClockHhMm (HH:mm, 초 없음, zero-pad)', () => {
  it('한 자리 시/분 zero-pad', () => {
    expect(formatClockHhMm(new Date(2026, 0, 1, 9, 5, 42))).toBe('09:05');
  });
  it('24h 표기', () => {
    expect(formatClockHhMm(new Date(2026, 0, 1, 23, 59, 0))).toBe('23:59');
  });
  it('자정 00:00', () => {
    expect(formatClockHhMm(new Date(2026, 0, 1, 0, 0, 0))).toBe('00:00');
  });
  it('초는 무시', () => {
    expect(formatClockHhMm(new Date(2026, 0, 1, 14, 30, 59))).toBe('14:30');
  });
});
