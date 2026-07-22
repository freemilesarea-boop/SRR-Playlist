import { describe, it, expect } from 'vitest';
import {
  resolveBrandDisplayMode,
  isValidSignageItem,
  filterValidSignageItems,
  type SignageValidatable,
} from './brandDisplayMode';

const img = (id: string, extra?: Partial<SignageValidatable>): SignageValidatable => ({
  id, image_url: `https://x/${id}.jpg`, asset_type: 'image', ...extra,
});

describe('isValidSignageItem', () => {
  it('rejects empty / whitespace url', () => {
    expect(isValidSignageItem({ id: 'a', image_url: '' })).toBe(false);
    expect(isValidSignageItem({ id: 'a', image_url: '   ' })).toBe(false);
  });
  it('rejects null/undefined', () => {
    expect(isValidSignageItem(null)).toBe(false);
    expect(isValidSignageItem(undefined)).toBe(false);
  });
  it('accepts explicit image/video asset_type', () => {
    expect(isValidSignageItem(img('a'))).toBe(true);
    expect(isValidSignageItem({ id: 'b', image_url: 'https://x/v.mp4', asset_type: 'video' })).toBe(true);
  });
  it('validates by mime when asset_type missing', () => {
    expect(isValidSignageItem({ id: 'c', image_url: 'https://x/y', mime_type: 'image/png' })).toBe(true);
    expect(isValidSignageItem({ id: 'd', image_url: 'https://x/y', mime_type: 'video/mp4' })).toBe(true);
    expect(isValidSignageItem({ id: 'e', image_url: 'https://x/y', mime_type: 'application/pdf' })).toBe(false);
  });
  it('treats legacy (no asset_type, no mime) with url as valid image', () => {
    expect(isValidSignageItem({ id: 'f', image_url: 'https://x/y.jpg' })).toBe(true);
  });
});

describe('filterValidSignageItems', () => {
  it('drops invalid, preserves order', () => {
    const items = [img('1'), { id: '2', image_url: '' }, img('3')];
    expect(filterValidSignageItems(items).map((i) => i.id)).toEqual(['1', '3']);
  });
  it('handles null/empty', () => {
    expect(filterValidSignageItems(null)).toEqual([]);
    expect(filterValidSignageItems([])).toEqual([]);
  });
});

describe('resolveBrandDisplayMode — priority', () => {
  it('1: valid media present → BRAND_MEDIA (even with logo + artwork)', () => {
    expect(resolveBrandDisplayMode({ usableMediaCount: 2, logoUrl: 'l', artworkUrl: 'a', artworkFailed: false }))
      .toBe('BRAND_MEDIA');
  });
  // UX-FIX-1: 자켓이 로고보다 우선. 유효 자켓 + 로고 동시 존재 → TRACK_ARTWORK.
  it('2: no media + valid artwork → TRACK_ARTWORK (wins over logo)', () => {
    expect(resolveBrandDisplayMode({ usableMediaCount: 0, logoUrl: 'https://x/logo.png', artworkUrl: 'https://x/art.jpg', artworkFailed: false }))
      .toBe('TRACK_ARTWORK');
  });
  it('3: no media + no logo + artwork present → TRACK_ARTWORK', () => {
    expect(resolveBrandDisplayMode({ usableMediaCount: 0, logoUrl: null, artworkUrl: 'https://x/art.jpg', artworkFailed: false }))
      .toBe('TRACK_ARTWORK');
  });
  it('4: no media + no logo + no artwork → DEFAULT_FALLBACK', () => {
    expect(resolveBrandDisplayMode({ usableMediaCount: 0, logoUrl: null, artworkUrl: null, artworkFailed: false }))
      .toBe('DEFAULT_FALLBACK');
  });
  // UX-FIX-1: 자켓 로드 실패 → 로고로 폴백 (로고 존재 시).
  it('4a: artwork load failed + logo present → BRAND_LOGO (fallback to logo)', () => {
    expect(resolveBrandDisplayMode({ usableMediaCount: 0, logoUrl: 'https://x/logo.png', artworkUrl: 'https://x/art.jpg', artworkFailed: true }))
      .toBe('BRAND_LOGO');
  });
  it('4b: artwork present but load failed + no logo → DEFAULT_FALLBACK', () => {
    expect(resolveBrandDisplayMode({ usableMediaCount: 0, logoUrl: null, artworkUrl: 'https://x/art.jpg', artworkFailed: true }))
      .toBe('DEFAULT_FALLBACK');
  });
  it('5: invalid media (usable=0) + logo + no artwork → BRAND_LOGO', () => {
    expect(resolveBrandDisplayMode({ usableMediaCount: 0, logoUrl: 'https://x/logo.png', artworkUrl: null, artworkFailed: false }))
      .toBe('BRAND_LOGO');
  });
  it('6: invalid media (usable=0) + no logo + artwork → TRACK_ARTWORK', () => {
    expect(resolveBrandDisplayMode({ usableMediaCount: 0, logoUrl: '   ', artworkUrl: 'https://x/art.jpg', artworkFailed: false }))
      .toBe('TRACK_ARTWORK');
  });
  it('treats whitespace-only logo as absent', () => {
    expect(resolveBrandDisplayMode({ usableMediaCount: 0, logoUrl: '   ', artworkUrl: null, artworkFailed: false }))
      .toBe('DEFAULT_FALLBACK');
  });

  // §15 video-loop invariant: while ≥1 valid media remains (e.g. a single looping video),
  // the mode stays BRAND_MEDIA and never drops to TRACK_ARTWORK on video end.
  it('video-loop invariant: single valid media + artwork stays BRAND_MEDIA', () => {
    expect(resolveBrandDisplayMode({ usableMediaCount: 1, logoUrl: null, artworkUrl: 'https://x/art.jpg', artworkFailed: false }))
      .toBe('BRAND_MEDIA');
  });
  it('video-load-failure invariant: only when media becomes unusable does priority re-evaluate', () => {
    // failed video → usable drops to 0 → falls to artwork (not before)
    expect(resolveBrandDisplayMode({ usableMediaCount: 0, logoUrl: null, artworkUrl: 'https://x/art.jpg', artworkFailed: false }))
      .toBe('TRACK_ARTWORK');
  });
});
