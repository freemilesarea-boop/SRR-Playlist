import { describe, it, expect } from 'vitest';
import {
  type StoreProfileRow,
  energyToLevel,
  profileToPreset,
  emptyPreset,
  mergeConditions,
  presetToFilters,
  presetSummaryLines,
  UX_DEFAULT_TARGET_SEC,
} from './playlistPresets';

const gym: StoreProfileRow = {
  store_key: 'gym',
  store_label: '헬스장',
  preferred_genres: ['kpop', 'pop', 'edm'],
  blocked_genres: ['ambient', 'classical'],
  preferred_moods: ['energetic', 'hype'],
  vocal_preference: 'vocal_preferred',
  ideal_bpm_min: 120,
  ideal_bpm_max: 160,
  ideal_energy_min: '0.7',
  ideal_energy_max: '1.0',
  allow_explicit: false,
  require_clean_content: false,
};

describe('energyToLevel', () => {
  it('maps 0..1 to 1..5', () => {
    expect(energyToLevel(0)).toBe(1);
    expect(energyToLevel('0.2')).toBe(1);
    expect(energyToLevel(0.5)).toBe(3);
    expect(energyToLevel(0.7)).toBe(4);
    expect(energyToLevel(1)).toBe(5);
    expect(energyToLevel(1.5)).toBe(5);
  });
  it('null passes through', () => {
    expect(energyToLevel(null)).toBeNull();
    expect(energyToLevel(undefined)).toBeNull();
    expect(energyToLevel('nope')).toBeNull();
  });
});

describe('profileToPreset', () => {
  it('maps policy fields, excludes blocked genres, keeps energy min<=max', () => {
    const p = profileToPreset(gym);
    expect(p.source).toBe('store_profile');
    expect(p.storeKey).toBe('gym');
    expect(p.storeLabel).toBe('헬스장');
    expect(p.preferredGenres).toEqual(['kpop', 'pop', 'edm']);
    expect(p.conditions.excludeGenres).toEqual(['ambient', 'classical']);
    expect(p.conditions.bpmMin).toBe(120);
    expect(p.conditions.bpmMax).toBe(160);
    expect(p.conditions.energyMin).toBe(4);
    expect(p.conditions.energyMax).toBe(5);
    expect(p.conditions.energyMin! <= p.conditions.energyMax!).toBe(true);
  });
  it('does not hard-require preferred genres (safe default) and vocal stays any', () => {
    const p = profileToPreset(gym);
    expect(p.conditions.includeGenres).toEqual([]);
    expect(p.conditions.vocal).toBe('any');
    expect(p.conditions.excludeBlocked).toBe(true);
  });
  it('sets excludeExplicit when clean required or explicit disallowed', () => {
    expect(profileToPreset(gym).conditions.excludeExplicit).toBe(true); // allow_explicit=false
    const relaxed = profileToPreset({ ...gym, allow_explicit: true, require_clean_content: false });
    expect(relaxed.conditions.excludeExplicit).toBe(false);
    const clean = profileToPreset({ ...gym, allow_explicit: true, require_clean_content: true });
    expect(clean.conditions.excludeExplicit).toBe(true);
  });
  it('uses UX default target duration (not policy)', () => {
    expect(profileToPreset(gym).conditions.targetDurationSec).toBe(UX_DEFAULT_TARGET_SEC);
  });
  it('handles missing/empty arrays', () => {
    const bare = profileToPreset({ store_key: 'x', store_label: '', vocal_preference: null });
    expect(bare.storeLabel).toBe('x');
    expect(bare.preferredGenres).toEqual([]);
    expect(bare.conditions.excludeGenres).toEqual([]);
    expect(bare.vocalPreferenceLabel).toBe('제한 없음');
  });
});

describe('mergeConditions (override)', () => {
  it('overrides only given keys', () => {
    const base = profileToPreset(gym).conditions;
    const merged = mergeConditions(base, { fitMin: 60, vocal: 'instrumental' });
    expect(merged.fitMin).toBe(60);
    expect(merged.vocal).toBe('instrumental');
    expect(merged.bpmMin).toBe(base.bpmMin); // untouched
  });
});

describe('presetToFilters', () => {
  it('maps conditions to CandidateFilters with excludeAlreadyIn default true', () => {
    const f = presetToFilters(profileToPreset(gym).conditions, { query: 'abc' });
    expect(f.query).toBe('abc');
    expect(f.bpmMin).toBe(120);
    expect(f.excludeGenres).toEqual(['ambient', 'classical']);
    expect(f.excludeExplicit).toBe(true);
    expect(f.excludeAlreadyIn).toBe(true);
  });
  it('respects excludeAlreadyIn override', () => {
    const f = presetToFilters(emptyPreset().conditions, { excludeAlreadyIn: false });
    expect(f.excludeAlreadyIn).toBe(false);
  });
});

describe('emptyPreset', () => {
  it('is a neutral ux_default preset', () => {
    const p = emptyPreset();
    expect(p.source).toBe('ux_default');
    expect(p.conditions.bpmMin).toBeNull();
    expect(p.conditions.excludeGenres).toEqual([]);
    expect(p.conditions.targetDurationSec).toBeNull();
  });
});

describe('presetSummaryLines', () => {
  it('produces human-readable preview lines', () => {
    const lines = presetSummaryLines(profileToPreset(gym));
    expect(lines.some((l) => l.includes('선호 장르'))).toBe(true);
    expect(lines.some((l) => l.includes('제외 장르'))).toBe(true);
    expect(lines.some((l) => l.startsWith('BPM'))).toBe(true);
    expect(lines.some((l) => l.startsWith('Energy'))).toBe(true);
    expect(lines.some((l) => l.includes('Explicit 제외'))).toBe(true);
    expect(lines.some((l) => l.includes('8시간'))).toBe(true);
  });
});
