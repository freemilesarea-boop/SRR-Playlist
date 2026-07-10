import { describe, it, expect } from 'vitest';
import {
  rateVital, percentile, maxOf, avgOf, classifyApiDuration,
  durationBuckets, durationStats, topSlowByKey,
} from './aggregate';

describe('rateVital (web.dev standard thresholds)', () => {
  it('LCP boundaries', () => {
    expect(rateVital('LCP', 2500)).toBe('good');
    expect(rateVital('LCP', 2501)).toBe('needs-improvement');
    expect(rateVital('LCP', 4000)).toBe('needs-improvement');
    expect(rateVital('LCP', 4001)).toBe('poor');
  });
  it('CLS boundaries', () => {
    expect(rateVital('CLS', 0.1)).toBe('good');
    expect(rateVital('CLS', 0.2)).toBe('needs-improvement');
    expect(rateVital('CLS', 0.26)).toBe('poor');
  });
  it('INP / FCP / TTFB good cases', () => {
    expect(rateVital('INP', 200)).toBe('good');
    expect(rateVital('FCP', 1800)).toBe('good');
    expect(rateVital('TTFB', 800)).toBe('good');
    expect(rateVital('TTFB', 2000)).toBe('poor');
  });
});

describe('percentile (nearest-rank, non-mutating)', () => {
  it('empty → null', () => expect(percentile([], 95)).toBeNull());
  it('single value', () => expect(percentile([42], 95)).toBe(42));
  it('p95 of 1..100 is 95', () => {
    const vals = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(vals, 95)).toBe(95);
    expect(percentile(vals, 75)).toBe(75);
    expect(percentile(vals, 100)).toBe(100);
  });
  it('does not mutate input', () => {
    const input = [3, 1, 2];
    percentile(input, 50);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe('maxOf / avgOf', () => {
  it('empty → null', () => {
    expect(maxOf([])).toBeNull();
    expect(avgOf([])).toBeNull();
  });
  it('values', () => {
    expect(maxOf([5, 9, 2])).toBe(9);
    expect(avgOf([2, 4, 6])).toBe(4);
  });
});

describe('classifyApiDuration', () => {
  it('buckets', () => {
    expect(classifyApiDuration(100)).toBe('safe');
    expect(classifyApiDuration(499)).toBe('safe');
    expect(classifyApiDuration(500)).toBe('warn');
    expect(classifyApiDuration(999)).toBe('warn');
    expect(classifyApiDuration(1000)).toBe('critical');
    expect(classifyApiDuration(5000)).toBe('critical');
  });
});

describe('durationBuckets', () => {
  it('counts crossings', () => {
    const b = durationBuckets([100, 250, 600, 1200, 3500]);
    expect(b.over200).toBe(4); // 250,600,1200,3500
    expect(b.over500).toBe(3);
    expect(b.over1000).toBe(2);
    expect(b.over3000).toBe(1);
  });
});

describe('durationStats', () => {
  it('empty', () => {
    const s = durationStats([]);
    expect(s.count).toBe(0);
    expect(s.worst).toBeNull();
    expect(s.p95).toBeNull();
  });
  it('populated', () => {
    const s = durationStats([10, 20, 30, 40, 50]);
    expect(s.count).toBe(5);
    expect(s.worst).toBe(50);
    expect(s.avg).toBe(30);
  });
});

describe('topSlowByKey', () => {
  it('groups and ranks by worst desc', () => {
    const items = [
      { route: '/a', d: 100 },
      { route: '/a', d: 900 },
      { route: '/b', d: 300 },
      { route: '/c', d: 50 },
    ];
    const top = topSlowByKey(items, (i) => i.route, (i) => i.d, 2);
    expect(top).toHaveLength(2);
    expect(top[0].key).toBe('/a');
    expect(top[0].worst).toBe(900);
    expect(top[0].count).toBe(2);
    expect(top[1].key).toBe('/b');
  });
});
