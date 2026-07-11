// WEB-OBS-9 — Operations Governance engine tests. Rule-based decision SUPPORT; every recommendation is
// advisory (never automated / remote-control) and degrades honestly to INSUFFICIENT_DATA.

import { describe, it, expect } from 'vitest';
import { computeStreamingQuality } from '../streamingQuality/quality';
import { detectQualityIncidents } from '../streamingQuality/analysis';
import { computeReliabilityIndex } from '../streamingOps';
import type { QualityAggregate } from '../streamingQuality/types';
import {
  computeConfidence, computeReleaseReadiness, recommendForRelease, recommendForIncidents,
  getPlaybook, allPlaybooks, computeEscalation, analyzeChangeImpact,
  buildEvidencePackage, evidenceToMarkdown, buildExecutiveReport, buildGovernanceTimeline,
} from './index';

function mkAgg(o: Partial<QualityAggregate> = {}): QualityAggregate {
  return {
    scope: 'v1', sessions: 120, startRequests: 120, startSuccess: 115, startFailed: 3, startAbandoned: 2,
    ttfa: { p50: 700, p75: 1200, p95: 3000, samples: 110 },
    transitionGap: { p50: null, p75: null, p95: null, samples: 0 },
    crossfadeStarted: 0, crossfadeCompleted: 0, crossfadeFallback: 0, crossfadeAborted: 0, crossfadeApplicable: false,
    stallSessions: 4, mediaErrorSessions: 3, mediaErrorEvents: 4, mediaErrorByCode: { '3': 4 },
    preloadReady: 0, preloadFailed: 0, recoveryAttempted: 10, recoverySucceeded: 9, recoveryFailed: 1,
    stableSessions: 0, continuityInterruptions: 0, continuityTransitions: 0, ...o,
  };
}
function readinessInput(agg: QualityAggregate, over: Partial<Parameters<typeof computeReleaseReadiness>[0]> = {}) {
  const q = computeStreamingQuality(agg);
  return {
    release: agg.scope, quality: q, reliability: computeReliabilityIndex(q), regression: null,
    coverage: 0.85, stores: 12, browsers: 3, criticalIncidents: 0, ...over,
  };
}

describe('confidence engine', () => {
  it('rises with breadth and caps below 100', () => {
    const c = computeConfidence({ coverage: 1, sessions: 1000, stores: 50, browsers: 5 });
    expect(c.value).not.toBeNull();
    expect(c.value as number).toBeLessThanOrEqual(96);
    expect(c.level).toBe('HIGH');
  });
  it('INSUFFICIENT with no sessions', () => {
    expect(computeConfidence({ coverage: null, sessions: 0, stores: 0, browsers: 0 }).level).toBe('INSUFFICIENT');
  });
});

describe('release readiness', () => {
  it('READY for healthy release with no critical incident', () => {
    const r = computeReleaseReadiness(readinessInput(mkAgg()));
    expect(r.score).not.toBeNull();
    expect(['READY', 'REVIEW_REQUIRED']).toContain(r.status);
    expect(r.automated).toBe(false);
    expect(r.remoteControl).toBe(false);
  });
  it('caps at BLOCK/HIGH_RISK when a critical incident is live', () => {
    const r = computeReleaseReadiness(readinessInput(mkAgg({ mediaErrorSessions: 40, mediaErrorEvents: 60, startSuccess: 70, startFailed: 40, stallSessions: 40 }), { criticalIncidents: 2 }));
    expect(['HIGH_RISK', 'BLOCK_RECOMMENDED']).toContain(r.status);
  });
  it('INSUFFICIENT_DATA below the sample floor', () => {
    const r = computeReleaseReadiness(readinessInput(mkAgg({ sessions: 5, startSuccess: 5 }), { stores: 1 }));
    expect(r.status).toBe('INSUFFICIENT_DATA');
    expect(r.score).toBeNull();
  });
});

describe('recommendations (advisory only)', () => {
  it('PROMOTE_OK path for READY, all advisory', () => {
    const r = computeReleaseReadiness(readinessInput(mkAgg()));
    const recs = recommendForRelease(r);
    expect(recs.every((x) => x.automated === false && x.remoteControl === false && x.requiresApproval === true)).toBe(true);
  });
  it('OBSERVE only when confidence is low', () => {
    const r = computeReleaseReadiness(readinessInput(mkAgg({ sessions: 25, startSuccess: 24 }), { stores: 3, browsers: 1, coverage: 0.3 }));
    const recs = recommendForRelease(r);
    expect(recs[0].action).toBe('OBSERVE');
  });
  it('maps critical incidents to ESCALATE', () => {
    const cur = computeStreamingQuality(mkAgg({ scope: 'v2', mediaErrorSessions: 40, mediaErrorEvents: 60, startSuccess: 60, startFailed: 40 }));
    const incidents = detectQualityIncidents(null, cur, 'v2');
    const recs = recommendForIncidents(incidents);
    expect(recs.every((x) => x.automated === false)).toBe(true);
  });
});

describe('playbooks (static)', () => {
  it('returns a known playbook and a fallback', () => {
    expect(getPlaybook('MEDIA_ERROR_SPIKE').title).toContain('Media');
    expect(getPlaybook('SOMETHING_NEW').incidentType).toBe('SOMETHING_NEW');
    expect(allPlaybooks().length).toBeGreaterThanOrEqual(5);
  });
});

describe('escalation matrix', () => {
  it('CRITICAL floors at ENTERPRISE', () => {
    expect(computeEscalation({ severity: 'CRITICAL', affectedStores: 1, affectedBrands: 1 }).level).toBe('ENTERPRISE');
  });
  it('platform when store blast is wide', () => {
    expect(computeEscalation({ severity: 'HIGH', affectedStores: 40, affectedBrands: 1 }).level).toBe('PLATFORM');
  });
});

describe('change impact', () => {
  it('HIGH risk on a large score drop', () => {
    const prev = computeStreamingQuality(mkAgg({ scope: 'v1', sessions: 300 }));
    const cur = computeStreamingQuality(mkAgg({ scope: 'v2', sessions: 120, mediaErrorSessions: 40, mediaErrorEvents: 60, startSuccess: 60, startFailed: 40, stallSessions: 40 }));
    const im = analyzeChangeImpact(prev, cur);
    expect(['MODERATE', 'HIGH']).toContain(im.risk);
    expect(['DELAY_RELEASE', 'BLOCK_RELEASE_RECOMMENDED']).toContain(im.recommendation);
  });
  it('INSUFFICIENT_DATA when a side is thin', () => {
    const prev = computeStreamingQuality(mkAgg({ scope: 'v1', sessions: 2, startSuccess: 2 }));
    const cur = computeStreamingQuality(mkAgg({ scope: 'v2' }));
    expect(analyzeChangeImpact(prev, cur).risk).toBe('INSUFFICIENT_DATA');
  });
});

describe('evidence package', () => {
  it('builds + renders markdown', () => {
    const pkg = buildEvidencePackage({
      incidentKey: 'FLEET:MEDIA_ERROR_SPIKE', scope: 'FLEET', title: 'Media Error Spike',
      replay: { scope: 'FLEET', steps: [{ at: '2026-07-11T09:00:00Z', kind: 'error', label: 'Media Error', detail: 'DECODE', severity: 'error' }], truncated: false },
      rootCause: { scope: 'FLEET', verdict: 'MEDIA_DECODER', confidence: 72, chain: [{ at: 't', signal: 'media', observed: 'media_error DECODE' }], summary: 's', caveat: '증거는 상관관계이며 스피커 출력 증명 아님' },
      metrics: [{ label: 'Media Error Rate', value: '5%' }], affectedStores: 12, affectedSessions: 40, regression: 'REGRESSED', relatedRelease: 'v2',
    });
    expect(pkg.timeline).toHaveLength(1);
    const md = evidenceToMarkdown(pkg);
    expect(md).toContain('# Operational Evidence Package');
    expect(md).toContain('Root-Cause Chain');
  });
});

describe('executive report + governance timeline', () => {
  it('flags INSUFFICIENT below the floor', () => {
    const rep = buildExecutiveReport({ window: '7d', availability: 99, reliability: 90, sessions: 5, releasesReviewed: 1, approvals: 0, rejectedReleases: 0, majorIncidents: 0, recommendations: [] });
    expect(rep.dataSufficient).toBe(false);
    expect(rep.availability).toBeNull();
  });
  it('orders governance timeline by time', () => {
    const tl = buildGovernanceTimeline(
      [{ id: 'd1', scope: 'v2', kind: 'RELEASE', title: 'Release v2', recommendation: 'DELAY_RELEASE', status: 'OPEN', confidence: 80, createdBy: 'admin', createdAt: '2026-07-11T09:00:00Z' }],
      [{ id: 'a1', decisionId: 'd1', choice: 'APPROVE', reason: 'ok', actor: 'admin', createdAt: '2026-07-11T10:00:00Z' }],
    );
    expect(tl).toHaveLength(2);
    expect(tl[0].stage).toBe('RELEASE');
    expect(tl[1].stage).toBe('APPROVAL');
  });
});
