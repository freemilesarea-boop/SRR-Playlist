import { describe, it, expect } from 'vitest';
import {
  BRAND_POLICY_GENRES,
  BRAND_POLICY_MOODS,
  STUDY_CAFE_POLICY_GENRES,
  STUDY_CAFE_HARD,
  clampStudyCafeBrandPolicy,
  validateCustomPolicy,
  normalizePolicySlugs,
  isValidPolicyGenre,
  isValidPolicyMood,
  genreLabel,
  moodLabel,
  type ClampableBrandPolicy,
} from '@/lib/brandMusicPolicy';

/** A relaxed custom policy that a study cafe must not be allowed to keep as-is. */
const RELAXED: ClampableBrandPolicy = {
  allowedGenres: ['lofi', 'rock'],
  vocalPolicy: 'any',
  energyMin: null,
  energyMax: 0.9,
  bpmMin: null,
  bpmMax: 200,
};

describe('taxonomy option lists', () => {
  it('genre/mood slugs are unique and lower-case', () => {
    const gs = BRAND_POLICY_GENRES.map((g) => g.slug);
    const ms = BRAND_POLICY_MOODS.map((m) => m.slug);
    expect(new Set(gs).size).toBe(gs.length);
    expect(new Set(ms).size).toBe(ms.length);
    expect(gs.every((s) => s === s.toLowerCase())).toBe(true);
    expect(ms.every((s) => s === s.toLowerCase())).toBe(true);
  });

  it('validates membership and resolves labels', () => {
    expect(isValidPolicyGenre('lofi')).toBe(true);
    expect(isValidPolicyGenre('bossa nova')).toBe(false);
    expect(isValidPolicyMood('calm')).toBe(true);
    expect(isValidPolicyMood('cozy')).toBe(false); // not in taxonomy_moods
    expect(genreLabel('lofi')).toBe('로파이');
    expect(moodLabel('calm')).toBe('차분한');
    expect(genreLabel('unknown')).toBe('unknown');
  });
});

describe('normalizePolicySlugs', () => {
  it('lower-cases, trims, drops blanks, dedupes preserving order', () => {
    expect(normalizePolicySlugs([' Lofi ', 'JAZZ', 'jazz', '', '  '])).toEqual(['lofi', 'jazz']);
    expect(normalizePolicySlugs(null)).toEqual([]);
  });
});

describe('clampStudyCafeBrandPolicy — study cafe cannot relax the hard policy', () => {
  it('leaves a non-study brand untouched with no warnings', () => {
    const { values, warnings } = clampStudyCafeBrandPolicy(RELAXED, false);
    expect(warnings).toEqual([]);
    expect(values).toEqual(RELAXED);
  });

  it('clamps every unsafe field and reports each warning (mirrors SQL §C)', () => {
    const { values, warnings } = clampStudyCafeBrandPolicy(RELAXED, true);
    expect(values.allowedGenres).toEqual(['lofi']); // rock dropped
    expect(values.vocalPolicy).toBe(STUDY_CAFE_HARD.vocalPolicy);
    expect(values.energyMax).toBe(STUDY_CAFE_HARD.energyMax); // 0.5
    expect(values.bpmMax).toBe(STUDY_CAFE_HARD.bpmMax); // 110
    expect(warnings).toEqual(
      expect.arrayContaining([
        'allowed_genres_clamped_to_study',
        'vocal_forced_instrumental_only',
        'energy_max_clamped_0.5',
        'bpm_max_clamped_110',
      ]),
    );
    expect(warnings).toHaveLength(4);
  });

  it('forces caps even when the operator left energy/bpm empty (no warning for defaults)', () => {
    const { values, warnings } = clampStudyCafeBrandPolicy(
      { allowedGenres: [], vocalPolicy: 'instrumental_only', energyMin: null, energyMax: null, bpmMin: null, bpmMax: null },
      true,
    );
    expect(values.energyMax).toBe(0.5);
    expect(values.bpmMax).toBe(110);
    // empty allowed stays empty (study hard filter still applies at runtime), vocal already ok
    expect(values.allowedGenres).toEqual([]);
    expect(warnings).toEqual([]); // defaults applied silently, nothing was *relaxed*
  });

  it('does not warn when allowed genres are already a study subset', () => {
    const { values, warnings } = clampStudyCafeBrandPolicy(
      { allowedGenres: ['jazz', 'lofi'], vocalPolicy: 'instrumental_only', energyMin: null, energyMax: 0.4, bpmMin: null, bpmMax: 90 },
      true,
    );
    expect(values.allowedGenres).toEqual(['jazz', 'lofi']);
    expect(warnings).toEqual([]);
  });

  it('pulls energy_min / bpm_min down when they exceed the clamped max', () => {
    const { values } = clampStudyCafeBrandPolicy(
      { allowedGenres: [], vocalPolicy: 'instrumental_only', energyMin: 0.8, energyMax: 0.9, bpmMin: 150, bpmMax: 200 },
      true,
    );
    expect(values.energyMax).toBe(0.5);
    expect(values.energyMin).toBe(0.5);
    expect(values.bpmMax).toBe(110);
    expect(values.bpmMin).toBe(110);
  });

  it('STUDY_CAFE_POLICY_GENRES is the fixed lofi/ambient/jazz set', () => {
    expect([...STUDY_CAFE_POLICY_GENRES].sort()).toEqual(['ambient', 'jazz', 'lofi']);
  });
});

describe('validateCustomPolicy — mirrors server structural rejects', () => {
  const base = {
    allowedGenres: [] as string[], blockedGenres: [] as string[], preferredGenres: [] as string[],
    blockedMoods: [] as string[], preferredMoods: [] as string[],
    energyMin: null as number | null, energyMax: null as number | null, bpmMin: null as number | null, bpmMax: null as number | null,
  };

  it('accepts a clean policy', () => {
    expect(validateCustomPolicy({ ...base, allowedGenres: ['lofi'], blockedGenres: ['edm'], bpmMin: 60, bpmMax: 110 }).ok).toBe(true);
  });
  it('rejects unknown genre / mood slugs', () => {
    expect(validateCustomPolicy({ ...base, allowedGenres: ['not_a_genre'] }).ok).toBe(false);
    expect(validateCustomPolicy({ ...base, blockedMoods: ['cozy'] }).ok).toBe(false);
  });
  it('rejects allowed/blocked overlap', () => {
    expect(validateCustomPolicy({ ...base, allowedGenres: ['lofi'], blockedGenres: ['lofi'] }).ok).toBe(false);
  });
  it('rejects out-of-range and inverted ranges', () => {
    expect(validateCustomPolicy({ ...base, energyMax: 1.5 }).ok).toBe(false);
    expect(validateCustomPolicy({ ...base, energyMin: 0.8, energyMax: 0.2 }).ok).toBe(false);
    expect(validateCustomPolicy({ ...base, bpmMax: 400 }).ok).toBe(false);
    expect(validateCustomPolicy({ ...base, bpmMin: 150, bpmMax: 100 }).ok).toBe(false);
  });
});
