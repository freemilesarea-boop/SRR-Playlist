import { describe, it, expect } from 'vitest';
import { rgbTripletToHex, statusBarStyleNameFor } from '@/lib/nativeStatusBar';

describe('rgbTripletToHex', () => {
  it('CSS 변수의 "10 10 10" 을 hex 로 바꾼다', () => {
    expect(rgbTripletToHex('10 10 10')).toBe('#0a0a0a');
  });

  it('앞뒤 공백과 쉼표 구분도 받는다 — theme.css 표기가 섞여 있다', () => {
    expect(rgbTripletToHex('  245, 245, 245 ')).toBe('#f5f5f5');
  });

  it('255 와 0 을 정확히 채운다', () => {
    expect(rgbTripletToHex('255 0 128')).toBe('#ff0080');
  });

  it('값이 3개가 아니면 null — 색을 추측하지 않는다', () => {
    expect(rgbTripletToHex('10 10')).toBeNull();
    expect(rgbTripletToHex('')).toBeNull();
  });

  it('숫자가 아니거나 범위를 벗어나면 null', () => {
    expect(rgbTripletToHex('10 10 abc')).toBeNull();
    expect(rgbTripletToHex('10 10 300')).toBeNull();
    expect(rgbTripletToHex('-1 0 0')).toBeNull();
  });
});

describe('statusBarStyleNameFor', () => {
  // Capacitor 의 Style 은 글자색이 아니라 "배경이 어둡다/밝다" 를 뜻한다. 여기서 자주 뒤집힌다.
  it('라이트 테마면 Light', () => {
    expect(statusBarStyleNameFor('light')).toBe('Light');
  });

  it('다크 테마면 Dark', () => {
    expect(statusBarStyleNameFor('dark')).toBe('Dark');
  });

  it('테마를 아직 모를 때는 Dark — 이 앱의 기본 배경이 어둡다', () => {
    expect(statusBarStyleNameFor(undefined)).toBe('Dark');
  });
});
