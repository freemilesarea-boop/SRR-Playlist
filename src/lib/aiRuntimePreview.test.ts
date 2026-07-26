import { describe, it, expect } from 'vitest';
import {
  AI_PREVIEW_FLAG_KEY,
  isAiRuntimePreviewEnabled,
  setAiRuntimePreviewEnabled,
  classificationLabel,
  classificationTone,
  formatFitScore,
  poolEligibleRatio,
  summarizePoolCounts,
  type CandidatePoolCounts,
} from './aiRuntimePreview';

/** 최소 in-memory Storage 목(테스트용). */
function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    removeItem: (k: string) => { m.delete(k); },
    setItem: (k: string, v: string) => { m.set(k, v); },
  } as Storage;
}

describe('aiRuntimePreview — feature flag (OFF by default)', () => {
  it('defaults to OFF when nothing stored', () => {
    expect(isAiRuntimePreviewEnabled(memStorage())).toBe(false);
  });

  it('set true → enabled, set false → disabled', () => {
    const s = memStorage();
    setAiRuntimePreviewEnabled(true, s);
    expect(s.getItem(AI_PREVIEW_FLAG_KEY)).toBe('1');
    expect(isAiRuntimePreviewEnabled(s)).toBe(true);

    setAiRuntimePreviewEnabled(false, s);
    expect(s.getItem(AI_PREVIEW_FLAG_KEY)).toBeNull();
    expect(isAiRuntimePreviewEnabled(s)).toBe(false);
  });

  it('only the exact string "1" counts as ON (no truthy coercion)', () => {
    const s = memStorage();
    s.setItem(AI_PREVIEW_FLAG_KEY, 'true');
    expect(isAiRuntimePreviewEnabled(s)).toBe(false);
    s.setItem(AI_PREVIEW_FLAG_KEY, '0');
    expect(isAiRuntimePreviewEnabled(s)).toBe(false);
    s.setItem(AI_PREVIEW_FLAG_KEY, '1');
    expect(isAiRuntimePreviewEnabled(s)).toBe(true);
  });

  it('throwing storage is handled gracefully → OFF, no throw', () => {
    const bad = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    } as unknown as Storage;
    expect(isAiRuntimePreviewEnabled(bad)).toBe(false);
    expect(() => setAiRuntimePreviewEnabled(true, bad)).not.toThrow();
  });
});

describe('aiRuntimePreview — classification helpers', () => {
  it('labels the three canonical classifications', () => {
    expect(classificationLabel('eligible')).toBe('재생 가능');
    expect(classificationLabel('penalized')).toBe('감점');
    expect(classificationLabel('blocked')).toBe('차단');
  });

  it('unknown classification passes through (no wrong guess)', () => {
    expect(classificationLabel('mystery')).toBe('mystery');
    expect(classificationTone('mystery')).toContain('ink-mute');
  });

  it('tone differs per classification', () => {
    expect(classificationTone('eligible')).toContain('emerald');
    expect(classificationTone('penalized')).toContain('amber');
    expect(classificationTone('blocked')).toContain('rose');
  });
});

describe('aiRuntimePreview — score/count helpers', () => {
  it('formatFitScore rounds and guards null/NaN', () => {
    expect(formatFitScore(90)).toBe('90');
    expect(formatFitScore(72.6)).toBe('73');
    expect(formatFitScore(null)).toBe('—');
    expect(formatFitScore(undefined)).toBe('—');
    expect(formatFitScore(Number.NaN)).toBe('—');
  });

  it('poolEligibleRatio computes eligible/total, guards zero', () => {
    expect(poolEligibleRatio({ eligible: 1, penalized: 1, blocked: 1, total: 3 })).toBeCloseTo(1 / 3);
    expect(poolEligibleRatio({ eligible: 0, penalized: 0, blocked: 0, total: 0 })).toBe(0);
    expect(poolEligibleRatio({ eligible: 5, penalized: 0, blocked: 0, total: 5 })).toBe(1);
  });

  it('summarizePoolCounts renders a readable line', () => {
    const counts: CandidatePoolCounts = { eligible: 1, penalized: 1, blocked: 1, total: 3 };
    expect(summarizePoolCounts(counts)).toBe('재생 가능 1 · 감점 1 · 차단 1 (총 3)');
  });

  it('summarizePoolCounts derives total when absent', () => {
    const partial = { eligible: 2, penalized: 1, blocked: 0 } as CandidatePoolCounts;
    expect(summarizePoolCounts(partial)).toBe('재생 가능 2 · 감점 1 · 차단 0 (총 3)');
  });
});
