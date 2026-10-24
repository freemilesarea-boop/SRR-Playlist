import { describe, it, expect } from 'vitest';
import { canonicalStoreType, CANONICAL_STORE_TYPES } from './storeTypeCanonical';

describe('canonicalStoreType — matrix D (store type normalization)', () => {
  it('every canonical type maps to itself', () => {
    for (const c of CANONICAL_STORE_TYPES) {
      expect(canonicalStoreType(c), c).toBe(c);
    }
    // 24 phase display types + 'restaurant' (coarse taxonomy/guardrail bucket) = 25 canonical.
    expect(CANONICAL_STORE_TYPES).toHaveLength(25);
    expect(new Set(CANONICAL_STORE_TYPES).size).toBe(CANONICAL_STORE_TYPES.length);
  });

  it('Korean aliases', () => {
    expect(canonicalStoreType('카페')).toBe('cafe');
    expect(canonicalStoreType('병원')).toBe('hospital');
    expect(canonicalStoreType('미용실')).toBe('hair_salon');
    expect(canonicalStoreType('네일샵')).toBe('nail_shop');
    expect(canonicalStoreType('와인바')).toBe('wine_bar');
    expect(canonicalStoreType('헬스장')).toBe('gym');
    expect(canonicalStoreType('스터디카페')).toBe('study_cafe');
    expect(canonicalStoreType('필라테스')).toBe('pilates');
    expect(canonicalStoreType('요가')).toBe('yoga');
  });

  it('English / legacy / guardrail-key / taxonomy aliases', () => {
    expect(canonicalStoreType('winebar')).toBe('wine_bar'); // guardrail key → canonical
    expect(canonicalStoreType('wine_bar')).toBe('wine_bar');
    expect(canonicalStoreType('cocktail_bar')).toBe('wine_bar');
    expect(canonicalStoreType('fitness')).toBe('gym');       // taxonomy slug → canonical
    expect(canonicalStoreType('salon')).toBe('hair_salon');  // guardrail key
    expect(canonicalStoreType('beauty_shop')).toBe('hair_salon'); // taxonomy (coarse)
    expect(canonicalStoreType('boutique')).toBe('select_shop');
    expect(canonicalStoreType('hotel_lobby')).toBe('hotel');
    expect(canonicalStoreType('cafe_independent')).toBe('cafe');
    expect(canonicalStoreType('cafe_franchise')).toBe('cafe');
    expect(canonicalStoreType('internet_cafe')).toBe('pc_bang');
  });

  it('pc_bang variants', () => {
    expect(canonicalStoreType('pc_bang')).toBe('pc_bang');
    expect(canonicalStoreType('PC방')).toBe('pc_bang');
    expect(canonicalStoreType('pcroom')).toBe('pc_bang');
    expect(canonicalStoreType('피시방')).toBe('pc_bang');
  });

  it('case-insensitive + whitespace trim', () => {
    expect(canonicalStoreType('  WINEBAR  ')).toBe('wine_bar');
    expect(canonicalStoreType('Cafe')).toBe('cafe');
    expect(canonicalStoreType('GYM')).toBe('gym');
    expect(canonicalStoreType('  네일샵 ')).toBe('nail_shop');
  });

  it('unknown → passthrough (no wrong guess)', () => {
    expect(canonicalStoreType('totally_unknown_type')).toBe('totally_unknown_type');
    expect(canonicalStoreType('  Weird Place ')).toBe('weird place');
  });

  it('null / empty → null', () => {
    expect(canonicalStoreType(null)).toBeNull();
    expect(canonicalStoreType(undefined)).toBeNull();
    expect(canonicalStoreType('')).toBeNull();
    expect(canonicalStoreType('   ')).toBeNull();
  });

  it('nail_shop and hair_salon stay distinct', () => {
    expect(canonicalStoreType('네일샵')).toBe('nail_shop');
    expect(canonicalStoreType('미용실')).toBe('hair_salon');
    expect(canonicalStoreType('nail_shop')).not.toBe(canonicalStoreType('hair_salon'));
  });
});
