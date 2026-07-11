import { describe, it, expect } from 'vitest';
import { clamp, safeRatio, percentChange, absDelta, round } from './math';
import { computeHealth, type HealthInput } from './health';
import { compareMetric, compareReleases, classifyConfidence, type MetricSample, type ReleaseMetrics } from './release';
import { normalizeErrorMessage, classifyErrorGroup, fnv1a, fingerprintError, groupErrors, type ErrorOccurrence } from './fingerprint';
import { detectSpike } from './spike';
import { routeRiskScore, apiRiskScore } from './risk';
import { buildIncidents } from './incident';
import { METRIC_SPECS } from './thresholds';

// ── math ────────────────────────────────────────────────────────────────────
describe('math helpers', () => {
  it('clamp bounds and rejects NaN', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
    expect(clamp(NaN, 2, 10)).toBe(2);
  });
  it('safeRatio never divides by zero', () => {
    expect(safeRatio(5, 10)).toBe(0.5);
    expect(safeRatio(5, 0)).toBe(0);
    expect(safeRatio(5, Infinity)).toBe(0);
  });
  it('percentChange returns null on zero baseline', () => {
    expect(percentChange(120, 100)).toBeCloseTo(0.2);
    expect(percentChange(80, 100)).toBeCloseTo(-0.2);
    expect(percentChange(5, 0)).toBeNull();
  });
  it('absDelta + round', () => {
    expect(absDelta(120, 100)).toBe(20);
    expect(round(1.23456, 2)).toBe(1.23);
    expect(round(null)).toBeNull();
  });
});

// ── health ──────────────────────────────────────────────────────────────────
const healthyInput: HealthInput = {
  totalEvents: 1000, sessions: 100,
  errorCount: 2, criticalErrorCount: 0, chunkErrorSessions: 0, hydrationErrorSessions: 0,
  apiCount: 400, slowApiCount: 5, routeCount: 200, slowRouteCount: 2, longTaskCount: 10,
  lcpP75: 2000, inpP75: 150, clsP75: 0.05, bootRecoveryAttempts: null, bootRecoveryFailures: null,
};

describe('computeHealth', () => {
  it('INSUFFICIENT_DATA below the sample gate', () => {
    const r = computeHealth({ ...healthyInput, totalEvents: 10, sessions: 2 });
    expect(r.status).toBe('INSUFFICIENT_DATA');
    expect(r.score).toBeNull();
  });
  it('HEALTHY for clean input', () => {
    const r = computeHealth(healthyInput);
    expect(r.status).toBe('HEALTHY');
    expect(r.score).toBeGreaterThanOrEqual(90);
  });
  it('CRITICAL when chunk failure rate crosses the hard floor', () => {
    const r = computeHealth({ ...healthyInput, chunkErrorSessions: 10 }); // 10% of 100 sessions
    expect(r.status).toBe('CRITICAL');
    expect(r.reasons.join(' ')).toMatch(/chunk/i);
  });
  it('at most DEGRADED when critical error rate crosses the floor', () => {
    const r = computeHealth({ ...healthyInput, criticalErrorCount: 25, errorCount: 25 }); // 2.5%
    expect(['DEGRADED', 'CRITICAL']).toContain(r.status);
  });
  it('components with no data do not penalize (null score excluded)', () => {
    const r = computeHealth({ ...healthyInput, lcpP75: null, inpP75: null, clsP75: null });
    const vitalComp = r.components.find((c) => c.key === 'lcp');
    expect(vitalComp?.score).toBeNull();
    expect(r.status).toBe('HEALTHY');
  });
  it('score is 0..100', () => {
    const r = computeHealth({ ...healthyInput, errorCount: 500, criticalErrorCount: 400, slowApiCount: 400, longTaskCount: 1000 });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});

// ── release comparison ───────────────────────────────────────────────────────
describe('classifyConfidence', () => {
  it('bands by the smaller sample', () => {
    expect(classifyConfidence(1000, 800)).toBe('HIGH');
    expect(classifyConfidence(1000, 200)).toBe('MEDIUM');
    expect(classifyConfidence(1000, 40)).toBe('LOW');
    expect(classifyConfidence(1000, 5)).toBe('INSUFFICIENT');
  });
});

describe('compareMetric', () => {
  const spec = METRIC_SPECS.lcpP75; // lower is better, abs 300ms, rel 15%
  const big = (value: number): MetricSample => ({ value, count: 600 });
  it('INSUFFICIENT_DATA when a side is under min samples', () => {
    const r = compareMetric(spec, { value: 2000, count: 5 }, big(2400));
    expect(r.classification).toBe('INSUFFICIENT_DATA');
  });
  it('REGRESSED when worse past both abs and rel', () => {
    const r = compareMetric(spec, big(2000), big(2500)); // +500ms +25%
    expect(r.classification).toBe('REGRESSED');
    expect(r.absDelta).toBe(500);
  });
  it('STABLE when abs floor not cleared', () => {
    const r = compareMetric(spec, big(2000), big(2200)); // +200ms < 300 abs
    expect(r.classification).toBe('STABLE');
  });
  it('STABLE when rel floor not cleared even if abs is', () => {
    const r = compareMetric(spec, big(5000), big(5350)); // +350ms but only 7%
    expect(r.classification).toBe('STABLE');
  });
  it('IMPROVED when better past both floors', () => {
    const r = compareMetric(spec, big(3000), big(2400)); // -600ms -20%
    expect(r.classification).toBe('IMPROVED');
  });
  it('zero baseline uses absolute threshold only, no fabricated rel', () => {
    const rateSpec = METRIC_SPECS.errorRate; // abs 0.005
    const r = compareMetric(rateSpec, { value: 0, count: 600 }, { value: 0.02, count: 600 });
    expect(r.relDelta).toBeNull();
    expect(r.classification).toBe('REGRESSED');
  });
  it('higher-is-better metric flips direction', () => {
    const s = METRIC_SPECS.bootRecoverySuccessRate; // higher better, abs 0.05
    const r = compareMetric(s, { value: 0.95, count: 600 }, { value: 0.8, count: 600 }); // dropped
    expect(r.classification).toBe('REGRESSED');
  });
});

describe('compareReleases', () => {
  it('counts regressed/improved across bundle', () => {
    const a: ReleaseMetrics = { release: 'r1', sessions: 100, events: 1000, metrics: { lcpP75: { value: 2000, count: 600 }, errorRate: { value: 0.01, count: 600 } } };
    const b: ReleaseMetrics = { release: 'r2', sessions: 120, events: 1200, metrics: { lcpP75: { value: 2600, count: 600 }, errorRate: { value: 0.01, count: 600 } } };
    const cmp = compareReleases(a, b, ['lcpP75', 'errorRate']);
    expect(cmp.regressed).toBe(1);
    expect(cmp.rows).toHaveLength(2);
  });
});

// ── fingerprint ──────────────────────────────────────────────────────────────
describe('normalizeErrorMessage', () => {
  it('collapses numbers/hex/urls/paths/quotes for stable grouping', () => {
    const a = normalizeErrorMessage('Failed to load chunk 3 from https://cdn.x/app.a1b2c3d4.js');
    const b = normalizeErrorMessage('Failed to load chunk 47 from https://cdn.x/app.99ffaa22.js');
    expect(a).toBe(b);
  });
  it('idempotent', () => {
    const once = normalizeErrorMessage('x 12 "y"');
    expect(normalizeErrorMessage(once)).toBe(once);
  });
  it('empty → [empty]', () => expect(normalizeErrorMessage('')).toBe('[empty]'));
});

describe('classifyErrorGroup', () => {
  it('separates chunk and hydration from generic', () => {
    expect(classifyErrorGroup('chunk-load', 'Loading chunk 5 failed')).toBe('chunk');
    expect(classifyErrorGroup('js', 'ChunkLoadError')).toBe('chunk');
    expect(classifyErrorGroup('react', 'Hydration failed because the server rendered HTML')).toBe('hydration');
    expect(classifyErrorGroup('react', 'Minified React error #418')).toBe('hydration');
    expect(classifyErrorGroup('react', 'Cannot read properties of undefined')).toBe('react');
    expect(classifyErrorGroup('unhandledrejection', 'boom')).toBe('rejection');
    expect(classifyErrorGroup('js', 'TypeError x')).toBe('runtime');
  });
});

describe('fnv1a + fingerprintError', () => {
  it('deterministic 8-char hex', () => {
    expect(fnv1a('abc')).toBe(fnv1a('abc'));
    expect(fnv1a('abc')).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1a('abc')).not.toBe(fnv1a('abd'));
  });
  it('same defect across releases → same fingerprint; route matters', () => {
    const x = fingerprintError({ kind: 'js', message: 'boom 12', route: '/player' });
    const y = fingerprintError({ kind: 'js', message: 'boom 99', route: '/player' });
    const z = fingerprintError({ kind: 'js', message: 'boom 12', route: '/library' });
    expect(x.fingerprint).toBe(y.fingerprint);
    expect(x.fingerprint).not.toBe(z.fingerprint);
  });
});

describe('groupErrors', () => {
  it('folds occurrences into fingerprint groups with dims + first/last seen', () => {
    const occ: ErrorOccurrence[] = [
      { kind: 'js', message: 'boom 1', route: '/a', release: 'r1', browser: 'Chrome', count: 5, sessions: 3, firstSeen: '2026-07-01', lastSeen: '2026-07-02' },
      { kind: 'js', message: 'boom 2', route: '/a', release: 'r2', browser: 'Safari', count: 7, sessions: 4, firstSeen: '2026-06-30', lastSeen: '2026-07-03' },
    ];
    const groups = groupErrors(occ);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(12);
    expect(groups[0].releases.sort()).toEqual(['r1', 'r2']);
    expect(groups[0].browsers.sort()).toEqual(['Chrome', 'Safari']);
    expect(groups[0].firstSeen).toBe('2026-06-30');
    expect(groups[0].lastSeen).toBe('2026-07-03');
  });
});

// ── spike ────────────────────────────────────────────────────────────────────
describe('detectSpike', () => {
  const base = { minSamples: 30, relThreshold: 0.5, absThreshold: 10 };
  it('no spike below sample floor', () => {
    expect(detectSpike({ ...base, current: 100, baseline: 10, currentSamples: 5, affectedSessions: 10 }).isSpike).toBe(false);
  });
  it('no spike below affected-session floor', () => {
    expect(detectSpike({ ...base, current: 100, baseline: 10, currentSamples: 100, affectedSessions: 1 }).isSpike).toBe(false);
  });
  it('spike when abs+rel+session all pass', () => {
    const r = detectSpike({ ...base, current: 100, baseline: 40, currentSamples: 100, affectedSessions: 20 });
    expect(r.isSpike).toBe(true);
  });
  it('zero baseline → spike on abs+session alone (no rel)', () => {
    const r = detectSpike({ ...base, current: 50, baseline: 0, currentSamples: 50, affectedSessions: 10 });
    expect(r.isSpike).toBe(true);
    expect(r.relChange).toBeNull();
  });
  it('single-event increase is never a spike', () => {
    expect(detectSpike({ ...base, current: 1, baseline: 0, currentSamples: 1, affectedSessions: 1 }).isSpike).toBe(false);
  });
});

// ── risk ─────────────────────────────────────────────────────────────────────
describe('routeRiskScore / apiRiskScore', () => {
  it('thin samples → INSUFFICIENT_DATA, never P0', () => {
    const r = routeRiskScore({ p95: 9000, errorRate: 0.5, sessions: 2, longTasks: 5, sampleCount: 4 });
    expect(r.priority).toBe('INSUFFICIENT_DATA');
  });
  it('broken high-traffic route → P0/P1', () => {
    const r = routeRiskScore({ p95: 9000, errorRate: 0.2, sessions: 120, longTasks: 100, sampleCount: 600, regressed: true });
    expect(['P0', 'P1']).toContain(r.priority);
  });
  it('healthy high-volume route is NOT high risk (volume alone does not dominate)', () => {
    const r = routeRiskScore({ p95: 500, errorRate: 0, sessions: 500, longTasks: 0, sampleCount: 5000 });
    expect(['P2', 'P3']).toContain(r.priority);
  });
  it('api failure drives priority', () => {
    const r = apiRiskScore({ p95: 4000, failureRate: 0.3, timeoutRate: 0.1, networkErrorRate: 0.05, sessions: 80, sampleCount: 600 });
    expect(['P0', 'P1']).toContain(r.priority);
    expect(r.score).toBeGreaterThan(0);
  });
});

// ── incidents ─────────────────────────────────────────────────────────────────
describe('buildIncidents', () => {
  it('no incidents on a clean window', () => {
    const inc = buildIncidents({
      errorGroups: [], criticalErrorRate: 0, chunkFailureRate: 0, chunkFailureSessions: 0,
      hydrationErrorSessions: 0, totalSessions: 100,
    });
    expect(inc).toEqual([]);
  });
  it('critical error rate → CRITICAL_ERROR candidate', () => {
    const inc = buildIncidents({
      errorGroups: [], criticalErrorRate: 0.05, chunkFailureRate: 0, chunkFailureSessions: 0,
      hydrationErrorSessions: 0, totalSessions: 100,
    });
    expect(inc.some((i) => i.type === 'CRITICAL_ERROR' && i.severity === 'critical')).toBe(true);
  });
  it('chunk failure spike + hydration spike fire with sessions', () => {
    const inc = buildIncidents({
      errorGroups: [], criticalErrorRate: 0, chunkFailureRate: 0.08, chunkFailureSessions: 8,
      hydrationErrorSessions: 5, totalSessions: 100,
    });
    expect(inc.some((i) => i.type === 'CHUNK_FAILURE_SPIKE')).toBe(true);
    expect(inc.some((i) => i.type === 'HYDRATION_ERROR_SPIKE')).toBe(true);
  });
  it('candidates carry threshold + evidence + suggestedAction', () => {
    const inc = buildIncidents({
      errorGroups: [], criticalErrorRate: 0.05, chunkFailureRate: 0, chunkFailureSessions: 0,
      hydrationErrorSessions: 0, totalSessions: 100,
    });
    const c = inc[0];
    expect(c.threshold).toBeTruthy();
    expect(c.evidence).toBeTruthy();
    expect(c.suggestedAction).toBeTruthy();
  });
});
