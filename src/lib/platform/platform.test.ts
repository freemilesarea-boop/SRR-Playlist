// WEB-OPS-10 — Unified Operations Platform engine tests. Read-only rule-based summaries + pure workspace
// helpers. Honest INSUFFICIENT_DATA below sample floors.

import { describe, it, expect } from 'vitest';
import {
  computePlatformScore, computeSlaMetrics, deriveMttrMtbf, buildExecutiveSummary, buildCommandTimeline,
  searchPlatform, defaultLayout, normalizeLayout, moveWidget, reorderWidget, updateWidget, addWidget, removeWidget,
} from './index';
import type { CommandEvent, SearchableEntity } from './index';

describe('platform score', () => {
  it('computes over present components + renormalizes', () => {
    const s = computePlatformScore({ availability: 95, streaming: 88, reliability: 90, governanceOpen: 1, criticalIncidents: 0, highIncidents: 0, coverage: 0.9, confidence: 80, sessions: 200 });
    expect(s.score).not.toBeNull();
    expect(['EXCELLENT', 'HEALTHY', 'WATCH']).toContain(s.band);
    expect(s.coverage).toBe(1);
  });
  it('drops NO_DATA components (coverage < 1)', () => {
    const s = computePlatformScore({ availability: 95, streaming: null, reliability: 90, governanceOpen: 0, criticalIncidents: 0, highIncidents: 0, coverage: null, confidence: null, sessions: 200 });
    expect(s.score).not.toBeNull();
    expect(s.coverage).toBeLessThan(1);
  });
  it('INSUFFICIENT_DATA below the session floor', () => {
    const s = computePlatformScore({ availability: 95, streaming: 90, reliability: 90, governanceOpen: 0, criticalIncidents: 0, highIncidents: 0, coverage: 0.9, confidence: 80, sessions: 5 });
    expect(s.band).toBe('INSUFFICIENT_DATA');
    expect(s.score).toBeNull();
  });
  it('critical incident drags the incident sub-score down', () => {
    const s = computePlatformScore({ availability: 95, streaming: 90, reliability: 90, governanceOpen: 0, criticalIncidents: 2, highIncidents: 0, coverage: 0.9, confidence: 80, sessions: 200 });
    expect(s.components.find((c) => c.key === 'incidents')?.score).toBe(40);
  });
});

describe('SLA metrics', () => {
  const timeline: CommandEvent[] = [
    { at: '2026-07-11T09:00:00Z', stage: 'INCIDENT', label: 'i1', detail: '', actor: null },
    { at: '2026-07-11T09:30:00Z', stage: 'RESOLVED', label: 'r1', detail: '', actor: null },
    { at: '2026-07-11T11:00:00Z', stage: 'INCIDENT', label: 'i2', detail: '', actor: null },
    { at: '2026-07-11T11:20:00Z', stage: 'RESOLVED', label: 'r2', detail: '', actor: null },
  ];
  it('derives MTTR from resolved pairs; MTBF needs ≥2 gaps (else INSUFFICIENT)', () => {
    const d = deriveMttrMtbf(timeline);
    expect(d.mttrMinutes).toBe(25);   // (30 + 20) / 2 durations
    expect(d.mtbfHours).toBeNull();   // only 1 gap (2 incidents) → below the min-gaps floor
    // with a 3rd incident there are 2 gaps → MTBF averages honestly
    const d3 = deriveMttrMtbf([...timeline, { at: '2026-07-11T13:00:00Z', stage: 'INCIDENT', label: 'i3', detail: '', actor: null }]);
    expect(d3.mtbfHours).toBe(2);     // incidents 09:00/11:00/13:00 → gaps 2h + 2h → mean 2h
  });
  it('INSUFFICIENT_DATA below session floor', () => {
    const m = computeSlaMetrics({ sessions: 5, availability: 99, recoverySucceeded: 1, recoveryAttempted: 1, badSessions: 0, incidentCount: 0 }, []);
    expect(m.status).toBe('INSUFFICIENT_DATA');
  });
  it('BREACHED when error budget exhausted', () => {
    const m = computeSlaMetrics({ sessions: 1000, availability: 90, recoverySucceeded: 5, recoveryAttempted: 10, badSessions: 40, incidentCount: 5 }, []);
    expect(m.status).toBe('BREACHED');
    expect(m.mttrMinutes).toBeNull(); // no resolved incidents in an empty timeline
  });
});

describe('executive summary (rule-based)', () => {
  it('Platform Stable + Release Safe when healthy', () => {
    const s = buildExecutiveSummary({ window: '7d', platformScore: 88, sessions: 300, hasBlockingRelease: false, criticalIncidents: 0, highIncidents: 0, mediumIncidents: 2, recoveryRate: 0.95 });
    expect(s.dataSufficient).toBe(true);
    expect(s.lines.some((l) => l.text.includes('Platform Stable'))).toBe(true);
    expect(s.lines.some((l) => l.text.includes('Release Safe'))).toBe(true);
    expect(s.lines.some((l) => l.text.includes('Recovery Excellent'))).toBe(true);
  });
  it('INSUFFICIENT below floor', () => {
    expect(buildExecutiveSummary({ window: '7d', platformScore: null, sessions: 5, hasBlockingRelease: false, criticalIncidents: 0, highIncidents: 0, mediumIncidents: 0, recoveryRate: null }).dataSufficient).toBe(false);
  });
});

describe('command timeline', () => {
  it('merges + orders sources', () => {
    const tl = buildCommandTimeline({
      governance: [{ at: '2026-07-11T10:00:00Z', stage: 'APPROVAL', label: 'Approve', actor: 'a', detail: 'ok' }],
      incidents: [{ incidentKey: 'k', type: 'MEDIA_ERROR_SPIKE', severity: 'HIGH', scope: 'FLEET', release: null, affectedSessions: 3, baseline: null, current: null, delta: null, confidence: 'MEDIUM', evidence: [], suggestedAction: '' }],
      incidentAt: '2026-07-11T09:00:00Z',
      releases: [{ release: 'v2', status: 'REVIEW_REQUIRED', at: '2026-07-11T11:00:00Z' }],
    });
    expect(tl).toHaveLength(3);
    expect(tl[0].stage).toBe('INCIDENT');
    expect(tl[2].stage).toBe('RELEASE');
  });
});

describe('unified search', () => {
  const ents: SearchableEntity[] = [
    { kind: 'store', id: 's1', label: 'Store One', detail: 'brand A' },
    { kind: 'release', id: 'v2', label: 'Release v2', detail: 'REVIEW' },
    { kind: 'decision', id: 'd1', label: 'Release v2 readiness', detail: 'DELAY' },
  ];
  it('matches substring, respects min query', () => {
    expect(searchPlatform('v2', ents).length).toBe(2);
    expect(searchPlatform('a', ents)).toEqual([]); // below min query length
  });
});

describe('workspace helpers (pure)', () => {
  it('default layout + normalize drops unknown widgets', () => {
    const norm = normalizeLayout({ name: 'X', widgets: [{ id: 'a', type: 'streaming' }, { id: 'b', type: 'BOGUS' }] });
    expect(norm.widgets).toHaveLength(1);
    expect(norm.widgets[0].type).toBe('streaming');
  });
  it('move / reorder / update / add / remove', () => {
    let l = defaultLayout();
    const first = l.widgets[0].id, second = l.widgets[1].id;
    l = moveWidget(l, second, -1);
    expect(l.widgets[0].id).toBe(second);
    l = updateWidget(l, first, { collapsed: true, size: 'S' });
    expect(l.widgets.find((w) => w.id === first)?.collapsed).toBe(true);
    const n = l.widgets.length;
    l = addWidget(l, 'sla');
    expect(l.widgets).toHaveLength(n + 1);
    l = removeWidget(l, first);
    expect(l.widgets.find((w) => w.id === first)).toBeUndefined();
    l = reorderWidget(l, l.widgets[l.widgets.length - 1].id, l.widgets[0].id);
    expect(l.widgets.length).toBe(n); // moved, count stable
  });
});
