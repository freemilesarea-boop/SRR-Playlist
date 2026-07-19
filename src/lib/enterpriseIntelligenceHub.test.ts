import { describe, expect, it } from 'vitest';
import {
  CROSS_DOMAIN_DISCLAIMER, ENTERPRISE_RELATIONSHIP_EDGES, ENTERPRISE_RELATIONSHIP_FLOW,
  HUB_BLOCKED_ACTIONS, HUB_FEED_KEYS,
  analyzeTrendDirection, assessAllFeedQuality, assessFeedQuality, buildCrossDomainChain,
  buildEnterpriseOverview, buildEnterpriseRelationships, buildEnterpriseSummaryLines,
  buildHubMetrics, emptyHubFeeds, isBlockedHubAction, latestCostTotal, seriesOf, toExecutiveFeeds,
  type HubFeeds,
} from './enterpriseIntelligenceHub';

const NOW = Date.parse('2026-07-19T12:00:00Z');

function pts(field: string, values: number[]) {
  return { points: values.map((v, i) => ({ bucket: `d${i}`, [field]: v })), generated_at: '2026-07-19T11:00:00Z' };
}

function hubFixture(): HubFeeds {
  return {
    ...emptyHubFeeds(),
    revenue: { today: 90000, month: 2500000 },
    revenueTrend: pts('revenue', [100, 110, 120, 200, 220, 240]),
    revenueBreakdown: { churn: { canceled: 3, active: 42, churn_numerator: 1, churn_denominator: 40, failed_payments: 0 } },
    business: { total_business: 12 },
    businessGrowth: pts('new_stores', [1, 1, 2, 3, 4, 5]),
    artist: { total_artists: 210, active_artists: 80, pending: 5, rejected: 2, avg_qc_score: 88 },
    artistGrowth: pts('new_artists', [2, 2, 2, 5, 6, 7]),
    artistBreakdown: { tracks: { total: 5400, month: 60, genre_dist: [{ key: 'jazz', count: 10 }, { key: 'pop', count: 8 }] } },
    streaming: { pb_start: 200, pb_complete: 190, pb_error: 4, heartbeat_sessions: 31, today_streams: 480 },
    streamingTimeline: pts('streams', [50, 55, 60, 90, 95, 100]),
    noc: { total_stores: 40, online_stores: 38, offline_stores: 2, today_incidents: 0, today_recovered: 0, computed_at: '2026-07-19T11:30:00Z' },
    settlementKpi: { month_paid_total: 700000, month_payable_total: 120000, held_count: 0 },
    actionHistory: [{ status: 'pending', command_type: 'executive_review' }, { status: 'success', command_type: 'force_store_resync' }],
  };
}

describe('Trend Direction — 예측 없음, 관측 구간 halves 비교', () => {
  it('전반 대비 후반 +5% 초과면 up, -5% 미만이면 down, 이내면 flat', () => {
    expect(analyzeTrendDirection([100, 100, 200, 200]).direction).toBe('up');
    expect(analyzeTrendDirection([200, 200, 100, 100]).direction).toBe('down');
    expect(analyzeTrendDirection([100, 100, 101, 102]).direction).toBe('flat');
  });

  it('유효 표본 <4 는 insufficient_data — 값을 지어내지 않는다', () => {
    expect(analyzeTrendDirection([1, 2, 3]).direction).toBe('insufficient_data');
    expect(analyzeTrendDirection([null, null, 1, 2]).direction).toBe('insufficient_data');
    expect(analyzeTrendDirection([]).changePct).toBeNull();
  });

  it('seriesOf 는 유한 숫자만 추출한다', () => {
    expect(seriesOf(pts('v', [1, 2]), 'v')).toEqual([1, 2]);
    expect(seriesOf({ points: [{ v: 'x' }, { v: 3 }] }, 'v')).toEqual([null, 3]);
    expect(seriesOf(null, 'v')).toEqual([]);
  });
});

describe('Data Quality — Available/Partial/Delayed/Insufficient', () => {
  it('미관측은 insufficient_data, 24h 초과 집계는 delayed, 미지원 항목은 partial', () => {
    expect(assessFeedQuality({ feed: 'x', loaded: false, generatedAt: null, unsupportedParts: 0, nowMs: NOW }).level).toBe('insufficient_data');
    expect(assessFeedQuality({ feed: 'x', loaded: true, generatedAt: '2026-07-17T00:00:00Z', unsupportedParts: 0, nowMs: NOW }).level).toBe('delayed');
    expect(assessFeedQuality({ feed: 'x', loaded: true, generatedAt: '2026-07-19T11:00:00Z', unsupportedParts: 2, nowMs: NOW }).level).toBe('partial');
    expect(assessFeedQuality({ feed: 'x', loaded: true, generatedAt: '2026-07-19T11:00:00Z', unsupportedParts: 0, nowMs: NOW }).level).toBe('available');
  });

  it('전체 피드 품질 목록은 17개 피드 전부를 다룬다', () => {
    const entries = assessAllFeedQuality(emptyHubFeeds(), NOW);
    expect(entries).toHaveLength(HUB_FEED_KEYS.length);
    expect(entries.every((e) => e.level === 'insufficient_data')).toBe(true);
    const loaded = assessAllFeedQuality(hubFixture(), NOW);
    expect(loaded.find((e) => e.feed === 'noc')?.level).toBe('available');
    expect(loaded.find((e) => e.feed === 'playlist')?.level).toBe('insufficient_data');
  });
});

describe('Enterprise Overview — E-1 Alert 규칙 재사용', () => {
  it('관측 피드 기반 카드 8필드를 채우고 미관측 값은 null 유지', () => {
    const { card } = buildEnterpriseOverview(hubFixture());
    expect(card.revenue).toBe(2500000);
    expect(card.activeStores).toBe(38);
    expect(card.activeStreams).toBe(480);
    expect(card.monthlySettlement).toBe(700000);
    expect(card.enterpriseStatus).not.toBe('insufficient_data');
  });

  it('전부 미관측이면 enterpriseStatus 는 insufficient_data, 값은 전부 null', () => {
    const { card } = buildEnterpriseOverview(emptyHubFeeds());
    expect(card.enterpriseStatus).toBe('insufficient_data');
    expect(card.revenue).toBeNull();
    expect(card.activeSubscribers).toBeNull();
    expect(card.todaysAlerts).toBe(0);
  });

  it('toExecutiveFeeds 는 E-1 피드 구조로 매핑한다(신규 규칙 생성 없음)', () => {
    const mapped = toExecutiveFeeds(hubFixture());
    expect(mapped.noc).not.toBeNull();
    expect(mapped.resilience).toBeNull();
  });
});

describe('Hub Metrics — 5도메인 28지표, Null→0 금지', () => {
  it('빈 피드에서는 28개 전부 insufficient_data', () => {
    const metrics = buildHubMetrics(emptyHubFeeds());
    expect(metrics).toHaveLength(28);
    expect(metrics.every((m) => m.status === 'insufficient_data')).toBe(true);
  });

  it('부재 피드 지표(queue_status/platform_uptime)는 항상 insufficient_data 로 정직 표시', () => {
    const metrics = buildHubMetrics(hubFixture());
    expect(metrics.find((m) => m.key === 'queue_status')?.status).toBe('insufficient_data');
    expect(metrics.find((m) => m.key === 'platform_uptime')?.status).toBe('insufficient_data');
    expect(metrics.find((m) => m.key === 'playback_success')?.value).toBe(95);
    expect(metrics.find((m) => m.key === 'revenue_trend')?.direction).toBe('up');
    expect(metrics.find((m) => m.key === 'genre_distribution')?.value).toBe(2);
  });

  it('estimated_cost/margin 은 최신 기간 스냅샷 기준으로만 계산한다', () => {
    expect(latestCostTotal(null).total).toBeNull();
    expect(latestCostTotal([{ period_start: '2026-07-01', estimated_cost: 100 }, { period_start: '2026-06-01', estimated_cost: 999 }]).total).toBe(100);
    const feeds = { ...hubFixture(), costSnapshots: [{ period_start: '2026-07-01', estimated_cost: 500000 }] };
    expect(buildHubMetrics(feeds).find((m) => m.key === 'estimated_margin')?.value).toBe(2000000);
  });
});

describe('Cross Domain — 상관 ≠ 인과', () => {
  it('동일 방향 동반 이동은 co_up/co_down 으로, 인과 단정 없는 문구로 설명한다', () => {
    const chain = buildCrossDomainChain(hubFixture());
    expect(chain.nodes.map((n) => n.key)).toEqual(['revenue', 'stores', 'streaming', 'settlement', 'artists']);
    expect(chain.disclaimer).toBe(CROSS_DOMAIN_DISCLAIMER);
    const first = chain.links[0];
    expect(first.relation).toBe('co_up');
    expect(first.description).toContain('인과 단정 아님');
  });

  it('한쪽 표본 부족이면 관련성 판정을 보류한다(추론 없음)', () => {
    const chain = buildCrossDomainChain({ ...hubFixture(), streamingTimeline: null });
    const link = chain.links.find((l) => l.to === 'streaming');
    expect(link?.relation).toBe('insufficient_data');
    expect(link?.description).toContain('보류');
  });
});

describe('Enterprise Relationships', () => {
  it('6개 영역 흐름과 5개 연결을 정의하고 governance 는 미관측으로 정직 표시', () => {
    expect(ENTERPRISE_RELATIONSHIP_FLOW).toHaveLength(6);
    expect(ENTERPRISE_RELATIONSHIP_EDGES).toHaveLength(5);
    const rel = buildEnterpriseRelationships(hubFixture());
    expect(rel.find((r) => r.domain === 'governance')?.observed).toBe(false);
    expect(rel.find((r) => r.domain === 'platform')?.observed).toBe(true);
    expect(buildEnterpriseRelationships(emptyHubFeeds()).every((r) => !r.observed)).toBe(true);
  });
});

describe('AI Enterprise Summary — 5줄 이내 결정적 요약', () => {
  it('관측값 기반 5줄을 생성한다', () => {
    const lines = buildEnterpriseSummaryLines({
      revenueDirection: 'up', storeDirection: 'up', streamingErrorRatePct: 2,
      pendingSettlementAmount: 120000, criticalAlerts: 0,
    });
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe('Revenue는 증가 중입니다.');
    expect(lines[2]).toBe('Streaming은 안정적으로 관측됩니다.');
    expect(lines[3]).toContain('Settlement 검토가 일부 남아 있습니다');
    expect(lines[4]).toBe('Critical Incident는 없습니다.');
  });

  it('미관측 값은 수치를 지어내지 않고 미관측으로 서술한다', () => {
    const lines = buildEnterpriseSummaryLines({
      revenueDirection: 'insufficient_data', storeDirection: 'insufficient_data',
      streamingErrorRatePct: null, pendingSettlementAmount: null, criticalAlerts: null,
    });
    expect(lines.length).toBeLessThanOrEqual(5);
    expect(lines[0]).toContain('판정하지 않습니다');
    expect(lines[2]).toContain('관측되지 않았습니다');
    expect(lines[4]).toContain('관측되지 않았습니다');
  });
});

describe('금지 목록 — 신규 AI/자동 승인/지급/배포 없음', () => {
  it('금지 8종과 automatic_* 전부 차단 판정', () => {
    expect(HUB_BLOCKED_ACTIONS).toHaveLength(8);
    for (const a of HUB_BLOCKED_ACTIONS) expect(isBlockedHubAction(a)).toBe(true);
    expect(isBlockedHubAction('automatic_anything')).toBe(true);
    expect(isBlockedHubAction('read_only_view')).toBe(false);
  });
});
