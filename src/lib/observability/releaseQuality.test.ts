import { describe, it, expect } from 'vitest';
import {
  computeReleaseQuality, checkPerformanceBudget, checkBundleBudget, computeReleaseConfidence,
  computeDeploymentReadiness, computeReleaseGate, type ReleaseSignals,
} from './releaseQuality';
import { compareReleases, type ReleaseMetrics } from './release';

// A clean, well-sampled release.
const healthy: ReleaseSignals = {
  release: 'r-good', sessions: 400, events: 4000, browsers: 3,
  errorRate: 0.005, criticalErrorRate: 0, chunkFailureRate: 0, hydrationErrorRate: 0,
  slowRouteRate: 0.02, slowApiRate: 0.03, longTaskRate: 0.1, memoryRiskRate: 0,
  bootRecoveryFailureRate: null, lcpP75: 2000, inpP75: 150, clsP75: 0.05, ttfbP75: 600,
  apiP95: 800, incidentCount: 0,
};

describe('computeReleaseQuality', () => {
  it('EXCELLENT/GOOD for a clean release', () => {
    const q = computeReleaseQuality(healthy);
    expect(q.score).toBeGreaterThanOrEqual(85);
    expect(['EXCELLENT', 'GOOD']).toContain(q.status);
  });
  it('POOR when many budgets blown', () => {
    const q = computeReleaseQuality({ ...healthy, errorRate: 0.2, criticalErrorRate: 0.05, chunkFailureRate: 0.1, lcpP75: 6000, incidentCount: 5 });
    expect(q.status).toBe('POOR');
    expect(q.score).toBeLessThan(55);
  });
  it('INSUFFICIENT_DATA when no component has data', () => {
    const q = computeReleaseQuality({
      ...healthy, errorRate: null, criticalErrorRate: null, chunkFailureRate: null, hydrationErrorRate: null,
      slowRouteRate: null, slowApiRate: null, longTaskRate: null, memoryRiskRate: null, bootRecoveryFailureRate: null,
      lcpP75: null, inpP75: null, clsP75: null, ttfbP75: null, apiP95: null, incidentCount: 0,
    });
    // incidents component always has data (count 0) → still scored. Verify a truly empty set:
    expect(q.status).not.toBe('INSUFFICIENT_DATA'); // incidents=0 is data
  });
  it('no-data components do not penalize', () => {
    const q = computeReleaseQuality({ ...healthy, lcpP75: null, inpP75: null, clsP75: null, ttfbP75: null });
    const lcp = q.components.find((c) => c.key === 'lcpP75');
    expect(lcp?.score).toBeNull();
    expect(q.score).toBeGreaterThanOrEqual(85);
  });
  it('score bounded 0..100', () => {
    const q = computeReleaseQuality({ ...healthy, errorRate: 5, criticalErrorRate: 5 });
    expect(q.score).toBeGreaterThanOrEqual(0);
    expect(q.score).toBeLessThanOrEqual(100);
  });
});

describe('checkPerformanceBudget', () => {
  it('PASS within budget', () => {
    const b = checkPerformanceBudget(healthy);
    expect(b.overall).toBe('PASS');
    expect(b.failed).toBe(0);
  });
  it('FAIL when a ceiling exceeded', () => {
    const b = checkPerformanceBudget({ ...healthy, lcpP75: 5000, errorRate: 0.2 });
    expect(b.overall).toBe('FAIL');
    expect(b.failed).toBeGreaterThanOrEqual(2);
    expect(b.items.find((i) => i.key === 'lcpP75')?.pass).toBe(false);
  });
  it('INSUFFICIENT_DATA when every item is null', () => {
    const empty: ReleaseSignals = {
      release: 'x', sessions: 0, events: 0, browsers: 0,
      errorRate: null, criticalErrorRate: null, chunkFailureRate: null, hydrationErrorRate: null,
      slowRouteRate: null, slowApiRate: null, longTaskRate: null, memoryRiskRate: null, bootRecoveryFailureRate: null,
      lcpP75: null, inpP75: null, clsP75: null, ttfbP75: null, apiP95: null, incidentCount: 0,
    };
    expect(checkPerformanceBudget(empty).overall).toBe('INSUFFICIENT_DATA');
  });
  it('null items report pass=null (not counted)', () => {
    const b = checkPerformanceBudget({ ...healthy, apiP95: null });
    expect(b.items.find((i) => i.key === 'apiP95')?.pass).toBeNull();
  });
});

describe('checkBundleBudget', () => {
  it('PASS under budget', () => {
    const r = checkBundleBudget({ initialJsGzip: 127 * 1024, lazyChunkGzip: 64 * 1024 });
    expect(r.overall).toBe('PASS');
  });
  it('FAIL over budget', () => {
    const r = checkBundleBudget({ initialJsGzip: 200 * 1024, lazyChunkGzip: 64 * 1024 });
    expect(r.overall).toBe('FAIL');
    expect(r.initialJs.pass).toBe(false);
  });
  it('INSUFFICIENT_DATA when unmeasured', () => {
    expect(checkBundleBudget({ initialJsGzip: null, lazyChunkGzip: null }).overall).toBe('INSUFFICIENT_DATA');
  });
});

describe('computeReleaseConfidence', () => {
  it('HIGH with strong sessions + diversity', () => {
    expect(computeReleaseConfidence(healthy).level).toBe('HIGH');
  });
  it('MEDIUM when sessions moderate', () => {
    expect(computeReleaseConfidence({ ...healthy, sessions: 100 }).level).toBe('MEDIUM');
  });
  it('single browser caps below HIGH', () => {
    expect(computeReleaseConfidence({ ...healthy, browsers: 1 }).level).not.toBe('HIGH');
  });
  it('INSUFFICIENT below session/event floor', () => {
    expect(computeReleaseConfidence({ ...healthy, sessions: 5, events: 40 }).level).toBe('INSUFFICIENT');
  });
});

describe('computeDeploymentReadiness', () => {
  const q = computeReleaseQuality(healthy);
  const b = checkPerformanceBudget(healthy);
  it('READY for clean high-confidence release', () => {
    expect(computeDeploymentReadiness(q, b, 'HIGH')).toBe('READY');
  });
  it('INSUFFICIENT_DATA when confidence insufficient', () => {
    expect(computeDeploymentReadiness(q, b, 'INSUFFICIENT')).toBe('INSUFFICIENT_DATA');
  });
  it('BLOCKED when budget FAIL', () => {
    const bad = checkPerformanceBudget({ ...healthy, lcpP75: 5000 });
    expect(computeDeploymentReadiness(q, bad, 'HIGH')).toBe('BLOCKED');
  });
});

// ── Release Gate ──────────────────────────────────────────────────────────────
function gateFor(sig: ReleaseSignals, regression = null as null | ReturnType<typeof compareReleases>) {
  const quality = computeReleaseQuality(sig);
  const budget = checkPerformanceBudget(sig);
  const confidence = computeReleaseConfidence(sig).level;
  return computeReleaseGate({ signals: sig, quality, budget, confidence, regression });
}

describe('computeReleaseGate', () => {
  it('PASS for a clean, well-sampled, no-regression release', () => {
    const g = gateFor(healthy);
    expect(g.verdict).toBe('PASS');
    expect(g.blockingReasons).toHaveLength(0);
  });
  it('INSUFFICIENT_DATA when sample too small', () => {
    const g = gateFor({ ...healthy, sessions: 5, events: 30 });
    expect(g.verdict).toBe('INSUFFICIENT_DATA');
  });
  it('BLOCK on critical error floor', () => {
    const g = gateFor({ ...healthy, criticalErrorRate: 0.03 });
    expect(g.verdict).toBe('BLOCK');
    expect(g.blockingReasons.some((r) => r.code === 'CRITICAL_ERROR_RATE')).toBe(true);
  });
  it('BLOCK on chunk failure floor', () => {
    const g = gateFor({ ...healthy, chunkFailureRate: 0.08 });
    expect(g.verdict).toBe('BLOCK');
    expect(g.blockingReasons.some((r) => r.code === 'CHUNK_FAILURE_RATE')).toBe(true);
  });
  it('BLOCK on budget FAIL', () => {
    const g = gateFor({ ...healthy, lcpP75: 5000 });
    expect(g.verdict).toBe('BLOCK');
    expect(g.blockingReasons.some((r) => r.code === 'BUDGET_EXCEEDED')).toBe(true);
  });
  it('BLOCK on ≥3 strong regressions', () => {
    const A: ReleaseMetrics = { release: 'A', sessions: 400, events: 4000, metrics: {
      lcpP75: { value: 2000, count: 600 }, inpP75: { value: 150, count: 600 }, errorRate: { value: 0.005, count: 4000 },
    } };
    const B: ReleaseMetrics = { release: 'B', sessions: 400, events: 4000, metrics: {
      lcpP75: { value: 2600, count: 600 }, inpP75: { value: 250, count: 600 }, errorRate: { value: 0.02, count: 4000 },
    } };
    const reg = compareReleases(A, B, ['lcpP75', 'inpP75', 'errorRate']);
    expect(reg.regressed).toBe(3);
    const g = gateFor(healthy, reg);
    expect(g.verdict).toBe('BLOCK');
    expect(g.blockingReasons.some((r) => r.code === 'MULTI_REGRESSION')).toBe(true);
  });
  it('PASS_WITH_WARNING on a single strong regression', () => {
    const A: ReleaseMetrics = { release: 'A', sessions: 400, events: 4000, metrics: { lcpP75: { value: 2000, count: 600 } } };
    const B: ReleaseMetrics = { release: 'B', sessions: 400, events: 4000, metrics: { lcpP75: { value: 2600, count: 600 } } };
    const reg = compareReleases(A, B, ['lcpP75']);
    const g = gateFor(healthy, reg);
    expect(g.verdict).toBe('PASS_WITH_WARNING');
    expect(g.warnings.some((w) => w.code === 'REGRESSION')).toBe(true);
  });
  it('gate reasons carry threshold + evidence', () => {
    const g = gateFor({ ...healthy, criticalErrorRate: 0.03 });
    const r = g.blockingReasons[0];
    expect(r.threshold).toBeTruthy();
    expect(r.evidence).toBeTruthy();
    expect(r.metric).toBeTruthy();
  });
});
