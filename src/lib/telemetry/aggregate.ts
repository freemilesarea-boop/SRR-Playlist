// WEB-OPT-11 — Runtime Telemetry: pure aggregation helpers (no browser API, unit-testable).
// Web Vitals thresholds follow the published web.dev standard values. We do NOT invent metrics;
// the raw values come from standard PerformanceEntry fields (see collect.ts). These functions
// only classify/aggregate already-measured numbers.

export type Rating = 'good' | 'needs-improvement' | 'poor';
export type VitalName = 'FCP' | 'LCP' | 'CLS' | 'INP' | 'TTFB';

// [good-max, needs-improvement-max] — web.dev standard thresholds.
const VITAL_THRESHOLDS: Record<VitalName, readonly [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
  CLS: [0.1, 0.25],
};

export function rateVital(name: VitalName, value: number): Rating {
  const t = VITAL_THRESHOLDS[name];
  if (!t) return 'good';
  const [good, ni] = t;
  if (value <= good) return 'good';
  if (value <= ni) return 'needs-improvement';
  return 'poor';
}

/** Nearest-rank percentile (p in 0..100). Returns null for empty input. Does not mutate input. */
export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((Math.min(100, Math.max(0, p)) / 100) * sorted.length);
  const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[idx];
}

export function maxOf(values: readonly number[]): number | null {
  if (!values.length) return null;
  let m = values[0];
  for (const v of values) if (v > m) m = v;
  return m;
}

export function avgOf(values: readonly number[]): number | null {
  if (!values.length) return null;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

export type ApiSeverity = 'safe' | 'warn' | 'critical';

/** Slow-API classification. Buckets from the phase spec (500ms warn, 1000ms critical). */
export function classifyApiDuration(ms: number): ApiSeverity {
  if (ms >= 1000) return 'critical';
  if (ms >= 500) return 'warn';
  return 'safe';
}

/** Counts of durations crossing each phase-spec bucket (>=200 / >=500 / >=1000 / >=3000 ms). */
export function durationBuckets(durations: readonly number[]): {
  over200: number; over500: number; over1000: number; over3000: number;
} {
  const b = { over200: 0, over500: 0, over1000: 0, over3000: 0 };
  for (const d of durations) {
    if (d >= 200) b.over200++;
    if (d >= 500) b.over500++;
    if (d >= 1000) b.over1000++;
    if (d >= 3000) b.over3000++;
  }
  return b;
}

export interface DurationStats {
  count: number;
  p75: number | null;
  p95: number | null;
  p99: number | null;
  worst: number | null;
  avg: number | null;
}

export function durationStats(values: readonly number[]): DurationStats {
  return {
    count: values.length,
    p75: percentile(values, 75),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    worst: maxOf(values),
    avg: avgOf(values),
  };
}

/** Group by a key and return top-N entries by aggregated worst duration (descending). */
export function topSlowByKey<T>(
  items: readonly T[],
  keyOf: (t: T) => string,
  durationOf: (t: T) => number,
  topN: number,
): Array<{ key: string; count: number; worst: number; p95: number | null }> {
  const groups = new Map<string, number[]>();
  for (const it of items) {
    const k = keyOf(it);
    const arr = groups.get(k) ?? [];
    arr.push(durationOf(it));
    groups.set(k, arr);
  }
  const rows = Array.from(groups.entries()).map(([key, ds]) => ({
    key,
    count: ds.length,
    worst: maxOf(ds) ?? 0,
    p95: percentile(ds, 95),
  }));
  rows.sort((a, b) => b.worst - a.worst);
  return rows.slice(0, Math.max(0, topN));
}
