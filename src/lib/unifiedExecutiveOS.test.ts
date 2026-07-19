import { describe, expect, it } from 'vitest';
import {
  EXECUTIVE_LAYERS, OS_BLOCKED_ACTIONS, OS_RELATIONSHIP_EDGES, OS_RELATIONSHIP_FLOW,
  OS_SUMMARY_FIXED_LINE,
  assessLayers, assessOsQuality, buildCockpit, buildOsRelationships, buildOsSummaryLines,
  buildUnifiedTimeline, computeOsAnalytics, emptyOsFeeds, isBlockedOsAction,
  type OsFeeds,
} from './unifiedExecutiveOS';

function pts(field: string, values: number[]) {
  return { points: values.map((v, i) => ({ bucket: `d${i}`, [field]: v })) };
}

function feedsFixture(): OsFeeds {
  return {
    actionHistory: [
      { id: 'a1', command_type: 'decision_approve', status: 'success', requested_at: '2026-07-19T03:00:00Z' },
      { id: 'a2', command_type: 'executive_review', status: 'success', requested_at: '2026-07-19T02:00:00Z' },
      { id: 'a3', command_type: 'force_store_resync', status: 'success', requested_at: '2026-07-19T01:00:00Z' },
    ],
    noc: { total_stores: 40, online_stores: 39, offline_stores: 1, today_incidents: 0, today_recovered: 0 },
    streaming: { pb_start: 200, pb_complete: 195, pb_error: 2 },
    revenue: { today: 90000, month: 2500000, recent: [{ paid_at: '2026-07-19T00:30:00Z', subscription_type: 'pro', amount: 9900 }] },
    revenueTrend: pts('revenue', [100, 110, 120, 125, 130, 128]),
    revenueForecast: { projected_month_revenue: 3000000 },
    settlementKpi: { held_count: 0, verification_failed_count: 0 },
    artist: { pending: 3 },
    govEvents: { violations: 0, overrides: 0, checks: 20 },
    incidents: [
      { id: 'i1', incident_code: 'INC-1', incident_type: 'store_offline', detected_at: '2026-07-18T00:00:00Z', resolved_at: '2026-07-18T01:00:00Z' },
    ],
    recoveries: [
      { id: 'r1', recovery_code: 'REC-1', status: 'done', outcome: 'success', created_at: '2026-07-18T00:30:00Z' },
    ],
    portfolios: [{ id: 'p1', portfolio_code: 'PF-1', portfolio_status: 'active' }],
    performance: { kpis: {} },
    resilienceSummary: { resilience_actuals: {} },
  };
}

describe('Layer 평가 — 기존 E-계층 규칙 재사용', () => {
  it('9개 Layer 전부 평가하고 관측값 기반 등급을 부여한다', () => {
    const layers = assessLayers(feedsFixture());
    expect(layers).toHaveLength(EXECUTIVE_LAYERS.length);
    expect(layers.find((l) => l.layer === 'governance')?.level).toBe('healthy');
    expect(layers.find((l) => l.layer === 'decision')?.level).toBe('healthy');
    expect(layers.find((l) => l.layer === 'resilience')?.level).toBe('healthy');
    expect(layers.every((l) => l.level !== 'insufficient_data')).toBe(true);
  });

  it('전부 미관측이면 전 Layer insufficient_data', () => {
    const layers = assessLayers(emptyOsFeeds());
    expect(layers.every((l) => l.level === 'insufficient_data')).toBe(true);
  });

  it('governance 위반은 critical, 미해결 incident 는 resilience attention', () => {
    const layers = assessLayers({
      ...feedsFixture(),
      govEvents: { violations: 1, overrides: 0, checks: 5 },
      incidents: [{ id: 'i2', incident_code: 'INC-2', incident_type: 'x', detected_at: '2026-07-19T00:00:00Z', resolved_at: null }],
    });
    expect(layers.find((l) => l.layer === 'governance')?.level).toBe('critical');
    expect(layers.find((l) => l.layer === 'resilience')?.level).toBe('attention');
  });
});

describe('Executive Cockpit — 과단정 방지', () => {
  it('카드 8필드 — Score 는 관측 Layer 등급 환산 평균', () => {
    const { card } = buildCockpit(feedsFixture());
    expect(card.enterpriseHealth).toBe('healthy');
    expect(card.executiveReadiness).toBe(9);
    expect(card.overallConfidencePct).toBe(100);
    expect(card.enterpriseScore).toBe(100);
  });

  it('관측 Layer <5 이면 Enterprise Score 를 산출하지 않는다', () => {
    const sparse: OsFeeds = { ...emptyOsFeeds(), govEvents: { violations: 0, overrides: 0, checks: 1 }, portfolios: [], performance: {} };
    const { card } = buildCockpit(sparse);
    expect(card.enterpriseScore).toBeNull();
    expect(card.enterpriseHealth).not.toBe('insufficient_data');
    const empty = buildCockpit(emptyOsFeeds());
    expect(empty.card.enterpriseHealth).toBe('insufficient_data');
    expect(empty.card.enterpriseScore).toBeNull();
    expect(empty.card.overallConfidencePct).toBe(0);
  });
});

describe('Unified Timeline — E-1 병합 로직 재사용', () => {
  it('6개 소스를 시각 내림차순 병합한다(신규 Timeline Engine 없음)', () => {
    const t = buildUnifiedTimeline(feedsFixture());
    expect(t.events[0].label).toBe('decision_approve'); // 최신
    expect(t.observedSources).toContain('incident_0502');
    expect(t.observedSources).toContain('payment');
    expect(t.droppedInvalid).toBe(0);
  });

  it('미관측 피드에서는 이벤트를 만들지 않는다', () => {
    const t = buildUnifiedTimeline(emptyOsFeeds());
    expect(t.events).toHaveLength(0);
  });
});

describe('Relationships / Analytics', () => {
  it('10단계/9연결 — enterprise 단계는 별도 저장소 없음 정직', () => {
    expect(OS_RELATIONSHIP_FLOW).toHaveLength(10);
    expect(OS_RELATIONSHIP_EDGES).toHaveLength(9);
    const rel = buildOsRelationships(feedsFixture());
    expect(rel.filter((r) => r.observed)).toHaveLength(9);
    expect(rel.find((r) => r.stage === 'enterprise')?.observed).toBe(false);
  });

  it('Trend 7종 — 시계열 부재 영역은 insufficient 정직, 성과는 E-2 재사용', () => {
    const a = computeOsAnalytics(feedsFixture());
    expect(a).toHaveLength(7);
    expect(a.find((t) => t.area === 'enterprise_health')?.direction).toBe('insufficient_data');
    expect(a.find((t) => t.area === 'performance')?.direction).toBe('up');
    expect(a.find((t) => t.area === 'governance')?.direction).toBe('insufficient_data');
    expect(computeOsAnalytics(emptyOsFeeds()).every((t) => t.direction === 'insufficient_data')).toBe(true);
  });
});

describe('Summary / Quality / 금지 목록', () => {
  it('요약 5줄 — 마지막 줄은 스펙 고정 문구', () => {
    const lines = buildOsSummaryLines({ enterpriseHealth: 'healthy', governanceViolations: 0, openIncidents: 0, performanceTrend: 'flat' });
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe('Enterprise는 Healthy 상태입니다.');
    expect(lines[1]).toBe('Governance 위반은 관측되지 않았습니다.');
    expect(lines[3]).toBe('Performance는 유지되고 있습니다.');
    expect(lines[4]).toBe(OS_SUMMARY_FIXED_LINE);
    const none = buildOsSummaryLines({ enterpriseHealth: 'insufficient_data', governanceViolations: null, openIncidents: null, performanceTrend: 'insufficient_data' });
    expect(none[1]).toContain('관측되지 않았습니다');
    expect(none[4]).toBe(OS_SUMMARY_FIXED_LINE);
  });

  it('Quality 종합은 관측 Layer 최악(E-8 재사용)', () => {
    const q = assessOsQuality(feedsFixture());
    expect(q.overall).toBe('healthy');
    expect(assessOsQuality(emptyOsFeeds()).overall).toBe('insufficient_data');
  });

  it('금지 9종 + automatic_* 차단', () => {
    expect(OS_BLOCKED_ACTIONS).toHaveLength(9);
    for (const a of OS_BLOCKED_ACTIONS) expect(isBlockedOsAction(a)).toBe(true);
    expect(isBlockedOsAction('view_cockpit')).toBe(false);
  });
});
