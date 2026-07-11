import { describe, it, expect } from 'vitest';
import {
  analyzeRootCauses, correlateEvidence, commitCorrelation, buildTimeline, rollbackAdvisor,
  explainIncident, serviceGraph, rootCauseConfidence,
  type ReleaseErrorProfile, type TimelineRelease,
} from './rootCause';

// A candidate release with a clear release-error spike + chunk failures on Safari + route concentration.
const cand: ReleaseErrorProfile = {
  release: 'r2', sessions: 200, events: 2000, errorSessions: 90, errorEvents: 300, criticalEvents: 40,
  chunkSessions: 12, hydrationSessions: 0, memoryRiskSessions: 0, longTaskEvents: 0,
  apiP95: 1600, lcpP75: 3200, browsers: 3,
  byBrowser: [
    { browser: 'Safari', errorSessions: 70, totalSessions: 80 },
    { browser: 'Chrome', errorSessions: 15, totalSessions: 100 },
    { browser: 'Firefox', errorSessions: 5, totalSessions: 20 },
  ],
  byKind: [{ key: 'chunk-load', sessions: 12, count: 12 }, { key: 'js', sessions: 78, count: 288 }],
  byRoute: [{ key: '/player', sessions: 75, count: 250 }, { key: '/library', sessions: 15, count: 50 }],
};
const base: ReleaseErrorProfile = {
  release: 'r1', sessions: 220, events: 2200, errorSessions: 5, errorEvents: 22, criticalEvents: 0,
  chunkSessions: 0, hydrationSessions: 0, memoryRiskSessions: 0, longTaskEvents: 0,
  apiP95: 800, lcpP75: 1900, browsers: 3, byBrowser: [], byKind: [], byRoute: [],
};

describe('rootCauseConfidence', () => {
  it('INSUFFICIENT below floor', () => expect(rootCauseConfidence({ sessions: 5, events: 40, browsers: 1 })).toBe('INSUFFICIENT'));
  it('HIGH with coverage', () => expect(rootCauseConfidence({ sessions: 400, events: 4000, browsers: 3 })).toBe('HIGH'));
  it('single browser caps below HIGH', () => expect(rootCauseConfidence({ sessions: 400, events: 4000, browsers: 1 })).not.toBe('HIGH'));
});

describe('analyzeRootCauses', () => {
  it('surfaces ranked causes with evidence', () => {
    const causes = analyzeRootCauses(cand, base);
    expect(causes.length).toBeGreaterThan(0);
    const codes = causes.map((c) => c.code);
    expect(codes).toContain('RELEASE_ERROR_SPIKE');
    expect(codes).toContain('CHUNK_DEPLOY');
    expect(codes).toContain('BROWSER_SPECIFIC');
    expect(codes).toContain('ROUTE_CONCENTRATION');
    expect(codes).toContain('API_LATENCY');
    // sorted by score desc
    for (let i = 1; i < causes.length; i++) expect(causes[i - 1].score).toBeGreaterThanOrEqual(causes[i].score);
    // every cause carries evidence
    causes.forEach((c) => expect(c.evidence.length).toBeGreaterThan(0));
  });
  it('browser-specific identifies Safari', () => {
    const c = analyzeRootCauses(cand, base).find((x) => x.code === 'BROWSER_SPECIFIC');
    expect(c?.browser).toBe('Safari');
  });
  it('clean release yields no or only generic cause', () => {
    const clean: ReleaseErrorProfile = { ...base, release: 'r3', errorSessions: 1, errorEvents: 2 };
    const causes = analyzeRootCauses(clean, base);
    expect(causes.every((c) => c.code !== 'RELEASE_ERROR_SPIKE')).toBe(true);
  });
  it('RUNTIME_ERROR fallback when errors present but unconcentrated', () => {
    const diffuse: ReleaseErrorProfile = {
      ...base, release: 'r4', errorSessions: 12, errorEvents: 24, events: 2000, apiP95: 500, lcpP75: 1800,
      byBrowser: [
        { browser: 'Chrome', errorSessions: 4, totalSessions: 400 },
        { browser: 'Safari', errorSessions: 4, totalSessions: 400 },
        { browser: 'Firefox', errorSessions: 4, totalSessions: 400 },
      ],
      byRoute: [
        { key: '/a', sessions: 4, count: 8 },
        { key: '/b', sessions: 4, count: 8 },
        { key: '/c', sessions: 4, count: 8 },
      ],
    };
    const causes = analyzeRootCauses(diffuse, base);
    expect(causes.some((c) => c.code === 'RUNTIME_ERROR')).toBe(true);
  });
});

describe('correlateEvidence', () => {
  it('produces all correlation pairs with bands', () => {
    const corr = correlateEvidence(cand, base);
    const pairs = corr.map((c) => c.pair);
    expect(pairs).toContain('Release ↔ Error');
    expect(pairs).toContain('Browser ↔ Error');
    expect(pairs).toContain('Chunk ↔ Release');
    expect(pairs).toContain('Route ↔ API');
    const rel = corr.find((c) => c.pair === 'Release ↔ Error');
    expect(['STRONG', 'MODERATE']).toContain(rel?.strength);
  });
  it('NONE when a dimension is absent', () => {
    const corr = correlateEvidence({ ...cand, chunkSessions: 0 }, base);
    expect(corr.find((c) => c.pair === 'Chunk ↔ Release')?.strength).toBe('NONE');
  });
});

describe('commitCorrelation (no commit content)', () => {
  const timeline: TimelineRelease[] = [
    { release: 'r1', firstSeen: '2026-07-01T00:00:00Z', lastSeen: '2026-07-02T00:00:00Z', sessions: 220, events: 2200, errorEvents: 22, chunkSessions: 0 },
    { release: 'r2', firstSeen: '2026-07-03T00:00:00Z', lastSeen: '2026-07-04T00:00:00Z', sessions: 200, events: 2000, errorEvents: 300, chunkSessions: 12 },
  ];
  it('computes error-rate delta vs previous release', () => {
    const cc = commitCorrelation(timeline);
    expect(cc[0].errorRateDeltaVsPrev).toBeNull(); // first has no prev
    expect(cc[1].errorRateDeltaVsPrev).toBeGreaterThan(0);
    expect(cc[1].release).toBe('r2');
  });
  it('does not expose any commit message field', () => {
    const cc = commitCorrelation(timeline);
    expect(Object.keys(cc[0])).not.toContain('message');
  });
});

describe('buildTimeline', () => {
  it('classifies health newest-first', () => {
    const t = buildTimeline([
      { release: 'r1', firstSeen: '2026-07-01T00:00:00Z', lastSeen: '2026-07-02T00:00:00Z', sessions: 220, events: 2200, errorEvents: 22, chunkSessions: 0 },
      { release: 'r2', firstSeen: '2026-07-03T00:00:00Z', lastSeen: '2026-07-04T00:00:00Z', sessions: 200, events: 2000, errorEvents: 300, chunkSessions: 12 },
    ]);
    expect(t[0].release).toBe('r2'); // newest first
    expect(t[0].health).toBe('critical');
    expect(t[1].health).toBe('healthy');
  });
  it('unknown when too few events', () => {
    const t = buildTimeline([{ release: 'x', firstSeen: null, lastSeen: null, sessions: 1, events: 5, errorEvents: 0, chunkSessions: 0 }]);
    expect(t[0].health).toBe('unknown');
  });
});

describe('rollbackAdvisor (recommendation only)', () => {
  it('BLOCK_RELEASE on critical/chunk floor', () => {
    expect(rollbackAdvisor(cand, base).status).toBe('BLOCK_RELEASE'); // critical 2% & chunk 6%
  });
  it('ROLLBACK_RECOMMENDED on error storm without critical/chunk', () => {
    const c = { ...cand, criticalEvents: 0, chunkSessions: 0, errorEvents: 300 }; // 15% error rate
    expect(rollbackAdvisor(c, base).status).toBe('ROLLBACK_RECOMMENDED');
  });
  it('WATCH on moderate error rate', () => {
    const c = { ...cand, criticalEvents: 0, chunkSessions: 0, errorEvents: 80 }; // 4%
    expect(rollbackAdvisor(c, base).status).toBe('WATCH');
  });
  it('NO_ACTION when clean', () => {
    const c: ReleaseErrorProfile = { ...base, release: 'r5', errorEvents: 10, events: 2000, sessions: 200 }; // 0.5%
    expect(rollbackAdvisor(c, base).status).toBe('NO_ACTION');
  });
  it('INSUFFICIENT sample → NO_ACTION with INSUFFICIENT confidence', () => {
    const c: ReleaseErrorProfile = { ...cand, sessions: 5, events: 40 };
    const r = rollbackAdvisor(c, base);
    expect(r.status).toBe('NO_ACTION');
    expect(r.confidence).toBe('INSUFFICIENT');
  });
});

describe('explainIncident', () => {
  it('INSUFFICIENT_DATA when confidence insufficient', () => {
    expect(explainIncident([], rollbackAdvisor({ ...cand, sessions: 5, events: 40 }, base), 'INSUFFICIENT')[0]).toMatch(/INSUFFICIENT_DATA/);
  });
  it('templated lines include cause + rollback status', () => {
    const causes = analyzeRootCauses(cand, base);
    const rb = rollbackAdvisor(cand, base);
    const lines = explainIncident(causes, rb, 'HIGH');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toMatch(/BLOCK_RELEASE|ROLLBACK_RECOMMENDED|WATCH|NO_ACTION/);
    expect(lines.join(' ')).toMatch(/실제 롤백은 수행되지 않습니다|실제 조치는 수행되지 않습니다|조치 불필요|관찰/);
  });
});

describe('serviceGraph', () => {
  it('highlights impacted nodes from causes; edges intact', () => {
    const causes = analyzeRootCauses(cand, base);
    const g = serviceGraph(causes);
    expect(g.nodes.some((n) => n.id === 'api' && n.impacted)).toBe(true); // API_LATENCY
    expect(g.nodes.some((n) => n.id === 'player' && n.impacted)).toBe(true); // route /player concentration
    expect(g.edges.length).toBeGreaterThan(0);
    expect(g.nodes.length).toBe(10);
  });
  it('no impacted nodes for empty causes', () => {
    const g = serviceGraph([]);
    expect(g.nodes.every((n) => !n.impacted)).toBe(true);
  });
});
