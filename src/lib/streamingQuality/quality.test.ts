// WEB-OBS-7 — Streaming Quality engine tests (pure, deterministic).

import { describe, it, expect } from 'vitest';
import { computeStreamingQuality } from './quality';
import { computeQualityRegression, detectQualityIncidents, computeQualityAdvice, compareQualityMetric, QUALITY_METRIC_SPECS } from './analysis';
import {
  parseStreamingQualityEvent, parseStreamingQualityBatch, hashTrackId, sqRoute, SQ_MAX_BATCH_EVENTS,
} from './eventSchema';
import type { QualityAggregate, StreamingQualityResult } from './types';

function agg(over: Partial<QualityAggregate> = {}): QualityAggregate {
  return {
    scope: 'FLEET', sessions: 100,
    startRequests: 200, startSuccess: 195, startFailed: 3, startAbandoned: 2,
    ttfa: { p50: 500, p75: 800, p95: 1500, samples: 180 },
    transitionGap: { p50: null, p75: null, p95: null, samples: 0 },
    crossfadeStarted: 150, crossfadeCompleted: 147, crossfadeFallback: 2, crossfadeAborted: 1, crossfadeApplicable: true,
    stallSessions: 2,
    mediaErrorSessions: 1, mediaErrorEvents: 1, mediaErrorByCode: { '3': 1 },
    preloadReady: 140, preloadFailed: 5,
    recoveryAttempted: 10, recoverySucceeded: 9, recoveryFailed: 1,
    stableSessions: 90, continuityInterruptions: 5, continuityTransitions: 400,
    ...over,
  };
}
function result(over: Partial<QualityAggregate> = {}): StreamingQualityResult {
  return computeStreamingQuality(agg(over));
}

describe('streaming quality score', () => {
  it('healthy aggregate → high score, EXCELLENT/HEALTHY', () => {
    const r = result();
    expect(r.score).not.toBeNull();
    expect(r.score!).toBeGreaterThanOrEqual(78);
    expect(['EXCELLENT', 'HEALTHY']).toContain(r.status);
    expect(r.signalCoverage).toBeGreaterThan(0.8);
  });
  it('INSUFFICIENT_DATA below min sessions → null score', () => {
    const r = result({ sessions: 2, ttfa: { p50: null, p75: null, p95: null, samples: 0 }, mediaErrorEvents: 0, crossfadeStarted: 0, recoveryAttempted: 0, preloadReady: 0, preloadFailed: 0 });
    expect(r.status).toBe('INSUFFICIENT_DATA');
    expect(r.score).toBeNull();
  });
  it('high media error rate tanks the score and flags reason', () => {
    const r = result({ mediaErrorSessions: 40, mediaErrorEvents: 60 });
    expect(r.mediaError.status).toBe('HIGH');
    expect(r.reasons.some((x) => x.includes('Media'))).toBe(true);
    expect(r.score!).toBeLessThan(78);
  });
  it('NO_DATA components are dropped (not scored 0) and lower coverage', () => {
    const full = result();
    const partial = result({ crossfadeApplicable: false, crossfadeStarted: 0, preloadReady: 0, preloadFailed: 0, ttfa: { p50: null, p75: null, p95: null, samples: 0 } });
    expect(partial.crossfade.status).toBe('NOT_AVAILABLE');
    expect(partial.preload.status).toBe('NOT_AVAILABLE');
    expect(partial.ttfa.p75).toBeNull();
    expect(partial.signalCoverage).toBeLessThan(full.signalCoverage);
    // dropping good components shouldn't crater the score to 0
    expect(partial.score).not.toBeNull();
  });
  it('business-mode scope reports crossfade & preload NOT_AVAILABLE', () => {
    const r = result({ crossfadeApplicable: false });
    expect(r.crossfade.status).toBe('NOT_AVAILABLE');
    expect(r.preload.status).toBe('NOT_AVAILABLE');
  });
  it('TTFA carries an approximation disclaimer and never claims audio output', () => {
    const r = result();
    expect(r.ttfa.approxDisclaimer).toContain('증명 불가');
  });
});

describe('per-dimension classifiers', () => {
  it('start success bands', () => {
    expect(result({ startSuccess: 200, startFailed: 0, startAbandoned: 0 }).start.status).toBe('SUCCESS');
    expect(result({ startSuccess: 80, startFailed: 15, startAbandoned: 5 }).start.status).toBe('FAILING');
  });
  it('transition NOT_AVAILABLE without gap samples', () => {
    expect(result().transition.status).toBe('NOT_AVAILABLE');
  });
  it('crossfade completion bands', () => {
    expect(result({ crossfadeStarted: 100, crossfadeCompleted: 60, crossfadeFallback: 30, crossfadeAborted: 10 }).crossfade.status).toBe('FAILING');
  });
  it('recovery NOT_ATTEMPTED with no attempts', () => {
    expect(result({ recoveryAttempted: 0, recoverySucceeded: 0, recoveryFailed: 0 }).recovery.status).toBe('NOT_ATTEMPTED');
  });
  it('preload consumed is always NOT_AVAILABLE', () => {
    expect(result().preload.consumed).toBe('NOT_AVAILABLE');
  });
  it('stall high rate', () => {
    expect(result({ stallSessions: 30 }).stall.status).toBe('HIGH');
  });
});

describe('regression', () => {
  it('media error rate regression classified REGRESSED', () => {
    const base = result({ mediaErrorSessions: 1, mediaErrorEvents: 1 });
    const cur = result({ mediaErrorSessions: 20, mediaErrorEvents: 25 });
    const reg = computeQualityRegression(base, cur);
    const me = reg.metrics.find((m) => m.key === 'mediaErrorSessionRate')!;
    expect(me.classification).toBe('REGRESSED');
    expect(reg.overall).toBe('REGRESSED');
  });
  it('INSUFFICIENT_DATA when a side is thin', () => {
    const thin = result({ sessions: 5, ttfa: { p50: null, p75: null, p95: null, samples: 0 }, mediaErrorEvents: 0, crossfadeStarted: 0, recoveryAttempted: 0, preloadReady: 0, preloadFailed: 0 });
    const cmp = compareQualityMetric(QUALITY_METRIC_SPECS[0], thin, result());
    expect(cmp.classification).toBe('INSUFFICIENT_DATA');
  });
  it('stable when change below both floors', () => {
    const reg = computeQualityRegression(result(), result({ stallSessions: 3 }));
    expect(['STABLE', 'INSUFFICIENT_DATA']).toContain(reg.metrics.find((m) => m.key === 'stallSessionRate')!.classification);
  });
});

describe('incidents — small sample cannot mint a wide incident', () => {
  it('media error spike incident with enough events', () => {
    const cur = result({ mediaErrorSessions: 40, mediaErrorEvents: 60 });
    const incs = detectQualityIncidents(result(), cur, 'r2');
    expect(incs.some((i) => i.type === 'MEDIA_ERROR_SPIKE')).toBe(true);
  });
  it('no incident on insufficient confidence', () => {
    const thin = result({ sessions: 2, mediaErrorEvents: 0, ttfa: { p50: null, p75: null, p95: null, samples: 0 }, crossfadeStarted: 0, recoveryAttempted: 0, preloadReady: 0, preloadFailed: 0 });
    expect(detectQualityIncidents(null, thin).length).toBe(0);
  });
  it('release-specific quality regression needs enough sessions + score drop', () => {
    const base = result();
    const cur = result({ mediaErrorSessions: 45, mediaErrorEvents: 70, stallSessions: 30 });
    const incs = detectQualityIncidents(base, cur, 'r2');
    expect(incs.some((i) => i.type === 'RELEASE_SPECIFIC_QUALITY_REGRESSION')).toBe(true);
  });
});

describe('advisor — recommendation only, never executed, no remote control', () => {
  it('every advice is automated:false, requiresApproval:true, remoteControl:false', () => {
    const a = computeQualityAdvice(result({ mediaErrorSessions: 40, mediaErrorEvents: 60 }), null);
    expect(a.automated).toBe(false);
    expect(a.requiresApproval).toBe(true);
    expect(a.remoteControl).toBe(false);
  });
  it('high media error → verify decoder compatibility', () => {
    expect(computeQualityAdvice(result({ mediaErrorSessions: 40, mediaErrorEvents: 60 }), null).recommendedAction).toBe('VERIFY_DECODER_COMPATIBILITY');
  });
  it('insufficient → monitor', () => {
    const thin = result({ sessions: 2, mediaErrorEvents: 0, ttfa: { p50: null, p75: null, p95: null, samples: 0 }, crossfadeStarted: 0, recoveryAttempted: 0, preloadReady: 0, preloadFailed: 0 });
    expect(computeQualityAdvice(thin, null).recommendedAction).toBe('MONITOR_RECOVERY');
  });
  it('release regression → hold release', () => {
    const base = result();
    const cur = result({ mediaErrorSessions: 45, mediaErrorEvents: 70, stallSessions: 40, startSuccess: 120, startFailed: 40, startAbandoned: 40 });
    const reg = computeQualityRegression(base, cur);
    const a = computeQualityAdvice(cur, reg);
    expect(['HOLD_RELEASE', 'VERIFY_DECODER_COMPATIBILITY', 'VERIFY_MEDIA_SOURCE', 'VERIFY_NETWORK']).toContain(a.recommendedAction);
  });
});

describe('event schema — privacy & sanitization', () => {
  it('hashes track ids non-reversibly', () => {
    const h = hashTrackId('11111111-2222-3333-4444-555555555555');
    expect(h).not.toBeNull();
    expect(h).not.toContain('1111');
    expect(hashTrackId(null)).toBeNull();
  });
  it('normalizes route to store/brand/individual', () => {
    expect(sqRoute('/store/player')).toBe('store');
    expect(sqRoute('/brand/x/player')).toBe('brand');
    expect(sqRoute('/library')).toBe('individual');
  });
  it('parse drops unknown fields, coerces enums, rejects missing ids and unknown event types', () => {
    const ev = parseStreamingQualityEvent({
      event_id: 'e1', player_session_id: 'p1', event_type: 'media_error',
      browser: 'nonsense', media_code: 3, network_state: 2, ready_state: 0,
      secret_token: 'drop', store_id: 'ignore', current_track_hash: 'abc',
    });
    expect(ev).not.toBeNull();
    expect(ev!.browser).toBe('other');
    expect(ev!.media_code).toBe(3);
    expect((ev as unknown as Record<string, unknown>).secret_token).toBeUndefined();
    expect((ev as unknown as Record<string, unknown>).store_id).toBeUndefined();
    expect(parseStreamingQualityEvent({ event_id: 'e', player_session_id: 'p', event_type: 'not_a_type' })).toBeNull();
    expect(parseStreamingQualityEvent({ event_type: 'media_error' })).toBeNull();
  });
  it('batch parse caps size', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ event_id: `e${i}`, player_session_id: 'p', event_type: 'first_progress' }));
    expect(parseStreamingQualityBatch(many).length).toBe(SQ_MAX_BATCH_EVENTS);
  });
});
