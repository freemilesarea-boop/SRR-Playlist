// WEB-OBS-8 — Operations-intelligence engine tests. Rule-based, honest degradation. Uses real
// WEB-OBS-7 aggregates → computeStreamingQuality so the fixtures exercise the actual classifiers.

import { describe, it, expect } from 'vitest';
import { computeStreamingQuality } from '../streamingQuality/quality';
import type { QualityAggregate } from '../streamingQuality/types';
import {
  computeReliabilityIndex, computeSignalCoverage, buildQualityMatrix, buildReleaseHeatmap,
  buildEnterpriseHeatmap, buildQualityTrend, computePredictiveWarning, computeReleaseRisk,
  detectProgressiveIncident, buildPlaybackReplay, buildFleetReplay, buildRootCauseEvidence,
} from './index';
import type { SqTimeBucket, SqEventRow, IncidentTick, FleetSnapshot } from './types';

function mkAgg(o: Partial<QualityAggregate> = {}): QualityAggregate {
  return {
    scope: 'FLEET', sessions: 100, startRequests: 100, startSuccess: 96, startFailed: 3, startAbandoned: 1,
    ttfa: { p50: 700, p75: 1200, p95: 3000, samples: 90 },
    transitionGap: { p50: null, p75: null, p95: null, samples: 0 },
    crossfadeStarted: 0, crossfadeCompleted: 0, crossfadeFallback: 0, crossfadeAborted: 0, crossfadeApplicable: false,
    stallSessions: 4, mediaErrorSessions: 3, mediaErrorEvents: 4, mediaErrorByCode: { '2': 1, '3': 3 },
    preloadReady: 0, preloadFailed: 0, recoveryAttempted: 10, recoverySucceeded: 9, recoveryFailed: 1,
    stableSessions: 0, continuityInterruptions: 0, continuityTransitions: 0, ...o,
  };
}
const bucket = (o: Partial<SqTimeBucket>): SqTimeBucket => ({
  bucketStart: '2026-07-11T09:00:00Z', sessions: 20, ttfaP75: 1000, startSuccessRate: 0.95,
  mediaErrorRate: 0.02, stallRate: 0.03, recoveryFailedRate: 0.05, score: 85, ...o,
});

describe('reliability index', () => {
  it('computes an index and band over present sub-components', () => {
    const r = computeReliabilityIndex(computeStreamingQuality(mkAgg()));
    expect(r.index).not.toBeNull();
    expect(['EXCELLENT', 'HEALTHY', 'WATCH', 'DEGRADED', 'CRITICAL']).toContain(r.band);
    // crossfade + continuity NOT_AVAILABLE this fixture → dropped, coverage < 1
    expect(r.coverage).toBeLessThan(1);
    const transition = r.subs.find((s) => s.key === 'transition');
    expect(transition?.score).toBeNull();
  });
  it('is INSUFFICIENT_DATA below the session floor', () => {
    const r = computeReliabilityIndex(computeStreamingQuality(mkAgg({ sessions: 2, startSuccess: 2, ttfa: { p50: 1, p75: 1, p95: 1, samples: 1 } })));
    expect(r.index).toBeNull();
    expect(r.band).toBe('INSUFFICIENT_DATA');
  });
});

describe('signal coverage', () => {
  it('marks crossfade NONE (unobservable in business mode) and media observable', () => {
    const c = computeSignalCoverage(mkAgg());
    expect(c.signals.find((s) => s.signal === 'crossfade')?.level).toBe('NONE');
    expect(c.signals.find((s) => s.signal === 'media')?.ratio).toBe(1);
    expect(c.overall).not.toBeNull();
  });
});

describe('quality matrix', () => {
  it('sorts by sessions, flags worst + concentration', () => {
    const m = buildQualityMatrix('browser', [
      { value: 'chrome', aggregate: mkAgg({ scope: 'chrome', sessions: 80, mediaErrorEvents: 1, mediaErrorSessions: 1 }) },
      { value: 'safari', aggregate: mkAgg({ scope: 'safari', sessions: 40, mediaErrorEvents: 20, mediaErrorSessions: 18, startSuccess: 30, startFailed: 10 }) },
    ]);
    expect(m.cells[0].value).toBe('chrome'); // most sessions first
    expect(m.concentration?.value).toBe('safari'); // holds ≥60% of media errors
  });
  it('marks a thin cell INSUFFICIENT_DATA', () => {
    const m = buildQualityMatrix('device', [{ value: 'tablet', aggregate: mkAgg({ sessions: 2 }) }]);
    expect(m.cells[0].insufficient).toBe(true);
  });
});

describe('release heatmap', () => {
  it('picks the highest-session release as baseline and computes deltas', () => {
    const h = buildReleaseHeatmap([
      { release: 'v1', stores: 10, aggregate: mkAgg({ scope: 'v1', sessions: 200 }) },
      { release: 'v2', stores: 3, aggregate: mkAgg({ scope: 'v2', sessions: 60, mediaErrorSessions: 20, mediaErrorEvents: 30, startSuccess: 40, startFailed: 18 }) },
    ]);
    expect(h.baseline).toBe('v1');
    const v2 = h.rows.find((r) => r.release === 'v2');
    expect(v2?.scoreDelta).not.toBeNull();
  });
});

describe('enterprise heatmap', () => {
  it('is NOT_AVAILABLE when no mapping', () => {
    const e = buildEnterpriseHeatmap(null);
    expect(e.available).toBe(false);
  });
  it('rolls stores up to a brand when mapping present', () => {
    const e = buildEnterpriseHeatmap([{ brand: 'BrandA', stores: [mkAgg({ sessions: 50 }), mkAgg({ sessions: 50 })] }]);
    expect(e.available).toBe(true);
    if (e.available) { expect(e.rows[0].stores).toBe(2); expect(e.rows[0].sessions).toBe(100); }
  });
});

describe('quality trend', () => {
  it('DEGRADING when score falls across usable buckets', () => {
    const t = buildQualityTrend('hour', [bucket({ score: 92 }), bucket({ score: 88 }), bucket({ score: 80 }), bucket({ score: 70 })]);
    expect(t.direction).toBe('DEGRADING');
  });
  it('INSUFFICIENT_DATA with too few usable buckets', () => {
    const t = buildQualityTrend('hour', [bucket({ sessions: 1 }), bucket({ sessions: 1 })]);
    expect(t.direction).toBe('INSUFFICIENT_DATA');
  });
});

describe('predictive warning', () => {
  it('ELEVATED/HIGH when multiple signals rise', () => {
    const buckets: SqTimeBucket[] = [
      bucket({ ttfaP75: 800, mediaErrorRate: 0.01, recoveryFailedRate: 0.02, stallRate: 0.02 }),
      bucket({ ttfaP75: 900, mediaErrorRate: 0.02, recoveryFailedRate: 0.03, stallRate: 0.03 }),
      bucket({ ttfaP75: 1600, mediaErrorRate: 0.05, recoveryFailedRate: 0.09, stallRate: 0.07 }),
      bucket({ ttfaP75: 1800, mediaErrorRate: 0.06, recoveryFailedRate: 0.11, stallRate: 0.08 }),
    ];
    const w = computePredictiveWarning('FLEET', buckets);
    expect(['ELEVATED', 'HIGH']).toContain(w.likelihood);
    expect(w.risingCount).toBeGreaterThanOrEqual(2);
    expect(w.automated).toBe(false);
    expect(w.remoteControl).toBe(false);
  });
  it('INSUFFICIENT_DATA below the bucket floor', () => {
    const w = computePredictiveWarning('FLEET', [bucket({}), bucket({})]);
    expect(w.likelihood).toBe('INSUFFICIENT_DATA');
  });
  it('NONE when nothing rises', () => {
    const flat = [bucket({}), bucket({}), bucket({}), bucket({})];
    expect(computePredictiveWarning('FLEET', flat).likelihood).toBe('NONE');
  });
});

describe('release risk', () => {
  it('INSUFFICIENT_DATA on a tiny canary', () => {
    const cur = computeStreamingQuality(mkAgg({ scope: 'v2', sessions: 5 }));
    const base = computeStreamingQuality(mkAgg({ scope: 'v1', sessions: 300 }));
    const r = computeReleaseRisk(cur, base, 1, 20);
    expect(r.band).toBe('INSUFFICIENT_DATA');
  });
  it('grades HIGH/CRITICAL on a real score drop', () => {
    const cur = computeStreamingQuality(mkAgg({ scope: 'v2', sessions: 60, mediaErrorSessions: 25, mediaErrorEvents: 40, startSuccess: 35, startFailed: 20, stallSessions: 20 }));
    const base = computeStreamingQuality(mkAgg({ scope: 'v1', sessions: 300 }));
    const r = computeReleaseRisk(cur, base, 5, 20);
    expect(['WATCH', 'HIGH', 'CRITICAL']).toContain(r.band);
    expect(r.remoteControl).toBe(false);
  });
});

describe('progressive incident', () => {
  const T = (at: string, kind: 'spike' | 'recovery'): IncidentTick => ({ at, type: 'MEDIA_ERROR_SPIKE', kind, scope: 'FLEET' });
  it('MAJOR on ≥3 spikes of same type', () => {
    const p = detectProgressiveIncident('MEDIA_ERROR_SPIKE', [
      T('2026-07-11T09:00Z', 'spike'), T('2026-07-11T09:10Z', 'recovery'),
      T('2026-07-11T09:20Z', 'spike'), T('2026-07-11T09:30Z', 'recovery'), T('2026-07-11T09:40Z', 'spike'),
    ]);
    expect(p.pattern).toBe('MAJOR');
    expect(p.spikes).toBe(3);
  });
  it('NONE when no spikes of the type', () => {
    expect(detectProgressiveIncident('STALL_SPIKE', []).pattern).toBe('NONE');
  });
});

describe('replay', () => {
  const row = (o: Partial<SqEventRow>): SqEventRow => ({
    eventType: 'first_progress', occurredAt: 0, receivedAt: '2026-07-11T09:00:00Z', sessionId: 's1',
    trackHash: 'abc', durationMs: 900, outcome: 'progress', reason: null, mediaCode: null, networkState: null, readyState: null, ...o,
  });
  it('maps events to ordered playback steps', () => {
    const r = buildPlaybackReplay('store1', [
      row({ receivedAt: '2026-07-11T09:00:03Z', eventType: 'media_error', mediaCode: 3, networkState: 1, readyState: 1 }),
      row({ receivedAt: '2026-07-11T09:00:00Z', eventType: 'first_progress' }),
      row({ receivedAt: '2026-07-11T09:00:05Z', eventType: 'recovery_succeeded', reason: 'media-error' }),
    ]);
    expect(r.steps[0].label).toBe('Playing');
    expect(r.steps[1].label).toBe('Media Error');
    expect(r.steps[2].label).toBe('Recovered');
  });
  it('builds a fleet replay from snapshots', () => {
    const snaps: FleetSnapshot[] = [
      { bucketStart: '2026-07-11T09:00:00Z', healthy: 990, waiting: 0, recovering: 0, error: 0, total: 990 },
      { bucketStart: '2026-07-11T09:05:00Z', healthy: 987, waiting: 3, recovering: 0, error: 0, total: 990 },
    ];
    const f = buildFleetReplay(snaps);
    expect(f.steps).toHaveLength(2);
    expect(f.steps[1].detail).toContain('Waiting');
  });
});

describe('root cause evidence', () => {
  const row = (o: Partial<SqEventRow>): SqEventRow => ({
    eventType: 'recovery_attempted', occurredAt: 0, receivedAt: '2026-07-11T09:00:00Z', sessionId: 's1',
    trackHash: null, durationMs: null, outcome: null, reason: 'stalled', mediaCode: null, networkState: null, readyState: null, ...o,
  });
  it('builds a NETWORK chain with capped confidence', () => {
    const rc = buildRootCauseEvidence('s1', [
      row({ receivedAt: '2026-07-11T09:00:00Z', reason: 'stalled' }),
      row({ receivedAt: '2026-07-11T09:00:01Z', eventType: 'recovery_failed', reason: 'stalled', networkState: 2, readyState: 1 }),
      row({ receivedAt: '2026-07-11T09:00:02Z', eventType: 'media_error', reason: null, mediaCode: 2, networkState: 2, readyState: 1 }),
    ]);
    expect(rc.verdict).toBe('NETWORK');
    expect(rc.confidence).not.toBeNull();
    expect(rc.confidence as number).toBeLessThanOrEqual(92);
    expect(rc.caveat).toContain('스피커');
  });
  it('is UNKNOWN with too few links', () => {
    const rc = buildRootCauseEvidence('s1', [row({ eventType: 'first_progress', reason: null })]);
    expect(rc.verdict).toBe('UNKNOWN');
    expect(rc.confidence).toBeNull();
  });
});
