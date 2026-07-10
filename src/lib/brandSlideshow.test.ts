// Phase BRAND-PLAYER-UX-1 — 브랜드 사이니지 슬라이드쇼 순수 로직 단위 테스트.
import { describe, it, expect } from 'vitest';
import {
  resolveSlideDurationMs, nextSlideIndex, normalizeSlideIndex, shouldRunSlideshow,
  DEFAULT_SLIDE_SECONDS, MIN_SLIDE_SECONDS, MAX_SLIDE_SECONDS,
} from './brandSlideshow';

const DEFAULT_MS = DEFAULT_SLIDE_SECONDS * 1000;

describe('resolveSlideDurationMs (초 → ms, 단일 변환 함수)', () => {
  it('저장값 10초 → 10,000ms', () => { expect(resolveSlideDurationMs(10)).toBe(10_000); });
  it('저장값 5초 → 5,000ms', () => { expect(resolveSlideDurationMs(5)).toBe(5_000); });
  it('문자열 "8" → 8,000ms', () => { expect(resolveSlideDurationMs('8')).toBe(8_000); });
  it('null → 기본값', () => { expect(resolveSlideDurationMs(null)).toBe(DEFAULT_MS); });
  it('undefined → 기본값', () => { expect(resolveSlideDurationMs(undefined)).toBe(DEFAULT_MS); });
  it('0 → 기본값', () => { expect(resolveSlideDurationMs(0)).toBe(DEFAULT_MS); });
  it('음수 → 기본값', () => { expect(resolveSlideDurationMs(-3)).toBe(DEFAULT_MS); });
  it('NaN → 기본값', () => { expect(resolveSlideDurationMs(NaN)).toBe(DEFAULT_MS); });
  it('빈 문자열/비숫자 → 기본값', () => {
    expect(resolveSlideDurationMs('')).toBe(DEFAULT_MS);
    expect(resolveSlideDurationMs('abc')).toBe(DEFAULT_MS);
  });
  it('min 미만은 min 으로 clamp', () => { expect(resolveSlideDurationMs(0.2)).toBe(MIN_SLIDE_SECONDS * 1000); });
  it('max 초과는 max 로 clamp', () => { expect(resolveSlideDurationMs(9999)).toBe(MAX_SLIDE_SECONDS * 1000); });
  it('이미 초 단위이므로 추가 곱셈 없음(3초=3000ms)', () => { expect(resolveSlideDurationMs(3)).toBe(3_000); });
});

describe('shouldRunSlideshow (2장 이상에서만 타이머)', () => {
  it('0장 → false', () => { expect(shouldRunSlideshow(0)).toBe(false); });
  it('1장 → false', () => { expect(shouldRunSlideshow(1)).toBe(false); });
  it('2장 → true', () => { expect(shouldRunSlideshow(2)).toBe(true); });
  it('3장 → true', () => { expect(shouldRunSlideshow(3)).toBe(true); });
});

describe('nextSlideIndex (순환)', () => {
  it('3장: 0→1→2→0 순환', () => {
    expect(nextSlideIndex(0, 3)).toBe(1);
    expect(nextSlideIndex(1, 3)).toBe(2);
    expect(nextSlideIndex(2, 3)).toBe(0);
  });
  it('1장은 항상 0', () => { expect(nextSlideIndex(0, 1)).toBe(0); });
  it('0장은 0', () => { expect(nextSlideIndex(0, 0)).toBe(0); });
});

describe('normalizeSlideIndex (out-of-range 안전화)', () => {
  it('범위 내는 그대로', () => { expect(normalizeSlideIndex(1, 3)).toBe(1); });
  it('범위 초과는 wrap', () => { expect(normalizeSlideIndex(4, 3)).toBe(1); });
  it('음수는 wrap', () => { expect(normalizeSlideIndex(-1, 3)).toBe(2); });
  it('count 0 → 0', () => { expect(normalizeSlideIndex(5, 0)).toBe(0); });
  it('NaN → 0', () => { expect(normalizeSlideIndex(NaN, 3)).toBe(0); });
  it('이미지 목록 축소(3→2) 시 out-of-range index 안전 정규화', () => {
    expect(normalizeSlideIndex(2, 2)).toBe(0);
  });
});
