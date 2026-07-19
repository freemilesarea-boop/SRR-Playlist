/**
 * enterpriseIntelligenceHub — Enterprise E-2 (Enterprise Intelligence Hub).
 *
 * Music/Settlement/Platform/Operations/Financial/Enterprise 데이터를 **연결**하는
 * Data Intelligence Layer. 신규 Intelligence Engine/Business Logic/AI 모델/
 * Recommendation Engine 없음 — 입력은 전부 기존 adminApi wrapper 반환값이며,
 * 이 모듈은 결정적(pure)으로 방향 계산/연관 설명/품질 표시만 수행한다.
 *
 * 정직성 원칙:
 *  - AI 는 데이터를 생성하지 않는다 — 없는 데이터는 추론하지 않고 insufficient_data.
 *  - 상관 ≠ 인과 — Cross Domain 은 관련성(동반 이동)만 설명하고 인과를 단정하지 않는다.
 *  - Today's Alerts / Enterprise Status 는 기존 executiveCommandCenter(E-1) Alert
 *    파생 규칙을 재사용한다(중복 Business Logic 생성 금지).
 */
import { isFiniteNumber, clampScore } from './aiMemory';
import {
  deriveExecutiveAlerts, emptyExecutiveFeeds, numAt,
  type ExecutiveFeeds, type FeedRecord,
} from './executiveCommandCenter';

export type { FeedRecord } from './executiveCommandCenter';

// ── 피드 (기존 adminApi 반환값 — 관측 실패 시 null) ─────────────────────

export interface HubFeeds {
  revenue: FeedRecord | null;           // fetchRevenueSummary
  revenueTrend: FeedRecord | null;      // fetchRevenueTrend('30d')
  revenueForecast: FeedRecord | null;   // fetchRevenueForecast
  revenueBreakdown: FeedRecord | null;  // fetchRevenueBreakdown
  business: FeedRecord | null;          // fetchBusinessSummary
  businessGrowth: FeedRecord | null;    // fetchBusinessGrowth('30d')
  artist: FeedRecord | null;            // fetchArtistSummary
  artistGrowth: FeedRecord | null;      // fetchArtistGrowth('30d')
  artistBreakdown: FeedRecord | null;   // fetchArtistBreakdown
  streaming: FeedRecord | null;         // fetchStreamingSummary
  streamingTimeline: FeedRecord | null; // fetchStreamingTimeline('30d')
  noc: FeedRecord | null;               // fetchNocKpi
  settlementKpi: FeedRecord | null;     // fetchReadableSettlementKpi
  costSnapshots: FeedRecord[] | null;   // fetchCostSnapshots
  playlist: FeedRecord | null;          // fetchPlaylistIntelligence('30d')
  selfHealing: FeedRecord | null;       // fetchSelfHealingSummary
  actionHistory: FeedRecord[] | null;   // fetchActionHistory (0479)
}

export const HUB_FEED_KEYS = [
  'revenue', 'revenueTrend', 'revenueForecast', 'revenueBreakdown', 'business', 'businessGrowth',
  'artist', 'artistGrowth', 'artistBreakdown', 'streaming', 'streamingTimeline', 'noc',
  'settlementKpi', 'costSnapshots', 'playlist', 'selfHealing', 'actionHistory',
] as const;
export type HubFeedKey = (typeof HUB_FEED_KEYS)[number];

export function emptyHubFeeds(): HubFeeds {
  return {
    revenue: null, revenueTrend: null, revenueForecast: null, revenueBreakdown: null,
    business: null, businessGrowth: null, artist: null, artistGrowth: null, artistBreakdown: null,
    streaming: null, streamingTimeline: null, noc: null, settlementKpi: null, costSnapshots: null,
    playlist: null, selfHealing: null, actionHistory: null,
  };
}

/** E-1 Alert 파생 규칙 재사용을 위한 피드 매핑 (신규 규칙 생성 없음). */
export function toExecutiveFeeds(feeds: HubFeeds): ExecutiveFeeds {
  return {
    ...emptyExecutiveFeeds(),
    business: feeds.business, revenue: feeds.revenue, revenueForecast: feeds.revenueForecast,
    revenueBreakdown: feeds.revenueBreakdown, artist: feeds.artist, artistBreakdown: feeds.artistBreakdown,
    streaming: feeds.streaming, noc: feeds.noc, selfHealing: feeds.selfHealing,
    settlementKpi: feeds.settlementKpi, costSnapshots: feeds.costSnapshots, actionHistory: feeds.actionHistory,
  };
}

// ── 금지 목록 (스펙 1:1) ────────────────────────────────────────────────

export const HUB_BLOCKED_ACTIONS = [
  'new_ai_generation', 'automatic_recommendation_generation', 'automatic_approval',
  'automatic_contract_approval', 'automatic_payment', 'automatic_merge',
  'automatic_deploy', 'automatic_production_apply',
] as const;

export function isBlockedHubAction(action: string): boolean {
  return (HUB_BLOCKED_ACTIONS as readonly string[]).includes(action) || action.startsWith('automatic_');
}

// ── 추세 방향 (결정적 halves 비교 — 예측 아님) ──────────────────────────

export type TrendDirection = 'up' | 'down' | 'flat' | 'insufficient_data';

export interface TrendAnalysis {
  direction: TrendDirection;
  changePct: number | null;
  firstHalfAvg: number | null;
  secondHalfAvg: number | null;
  samples: number;
  note: string;
}

const TREND_MIN_SAMPLES = 4;
const TREND_FLAT_PCT = 5;

/** 시계열 전/후반 평균 비교 — ±5% 이내 flat, 표본 <4 insufficient_data. 예측/외삽 없음. */
export function analyzeTrendDirection(values: Array<number | null | undefined>): TrendAnalysis {
  const valid = values.filter((v): v is number => isFiniteNumber(v));
  if (valid.length < TREND_MIN_SAMPLES) {
    return { direction: 'insufficient_data', changePct: null, firstHalfAvg: null, secondHalfAvg: null, samples: valid.length, note: `표본 ${valid.length}개(<${TREND_MIN_SAMPLES}) — 방향 판정 보류` };
  }
  const mid = Math.floor(valid.length / 2);
  const first = valid.slice(0, mid);
  const second = valid.slice(mid);
  const firstAvg = first.reduce((a, b) => a + b, 0) / first.length;
  const secondAvg = second.reduce((a, b) => a + b, 0) / second.length;
  if (firstAvg === 0 && secondAvg === 0) {
    return { direction: 'flat', changePct: 0, firstHalfAvg: 0, secondHalfAvg: 0, samples: valid.length, note: '전·후반 모두 0 — 변화 없음' };
  }
  const base = Math.abs(firstAvg) > 0 ? Math.abs(firstAvg) : Math.abs(secondAvg);
  const changePct = ((secondAvg - firstAvg) / base) * 100;
  const direction: TrendDirection = Math.abs(changePct) <= TREND_FLAT_PCT ? 'flat' : changePct > 0 ? 'up' : 'down';
  return {
    direction, changePct: Math.round(changePct * 10) / 10, firstHalfAvg: firstAvg, secondHalfAvg: secondAvg,
    samples: valid.length, note: '전·후반 평균 비교(관측 구간 내) — 미래 예측 아님',
  };
}

/** 시계열 피드에서 특정 필드 배열 추출 (points: [{bucket, ...}] 형태). */
export function seriesOf(feed: FeedRecord | null, field: string): Array<number | null> {
  if (feed == null || !Array.isArray(feed.points)) return [];
  return (feed.points as Array<Record<string, unknown>>).map((p) => (isFiniteNumber(p[field]) ? p[field] : null));
}

// ── Data Quality (Available / Partial / Delayed / Insufficient Data) ────

export const HUB_DATA_QUALITY_LEVELS = ['available', 'partial', 'delayed', 'insufficient_data'] as const;
export type HubDataQuality = (typeof HUB_DATA_QUALITY_LEVELS)[number];

const DELAYED_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export interface FeedQualityEntry {
  feed: string;
  level: HubDataQuality;
  note: string;
}

/**
 * 관측 실패 → insufficient_data · generated_at 24h 초과 → delayed ·
 * 지원 플래그 일부 false → partial · 그 외 → available. 없는 데이터를 추론하지 않는다.
 */
export function assessFeedQuality(input: {
  feed: string;
  loaded: boolean;
  generatedAt: string | null;
  unsupportedParts: number;
  nowMs: number;
}): FeedQualityEntry {
  if (!input.loaded) return { feed: input.feed, level: 'insufficient_data', note: '관측 실패/미연결 — 값을 추론하지 않음' };
  if (input.generatedAt != null) {
    const t = Date.parse(input.generatedAt);
    if (!Number.isNaN(t) && input.nowMs - t > DELAYED_THRESHOLD_MS) {
      return { feed: input.feed, level: 'delayed', note: `집계 시각 24h 초과 경과(${input.generatedAt})` };
    }
  }
  if (input.unsupportedParts > 0) {
    return { feed: input.feed, level: 'partial', note: `미지원/부재 하위 항목 ${input.unsupportedParts}개` };
  }
  return { feed: input.feed, level: 'available', note: input.generatedAt == null ? '관측됨(집계 시각 미제공)' : '관측됨' };
}

function countFalseSupport(feed: FeedRecord | null): number {
  if (feed == null) return 0;
  const support = feed.support;
  if (support == null || typeof support !== 'object' || Array.isArray(support)) return 0;
  return Object.values(support as Record<string, unknown>).filter((v) => v === false).length;
}

export function assessAllFeedQuality(feeds: HubFeeds, nowMs: number): FeedQualityEntry[] {
  const genAt = (f: FeedRecord | null, key = 'generated_at'): string | null => {
    const v = f?.[key];
    return typeof v === 'string' ? v : null;
  };
  return HUB_FEED_KEYS.map((key) => {
    const raw = feeds[key];
    const loaded = raw != null;
    const rec = Array.isArray(raw) ? null : raw;
    return assessFeedQuality({
      feed: key,
      loaded,
      generatedAt: key === 'noc' ? genAt(rec, 'computed_at') : genAt(rec),
      unsupportedParts: countFalseSupport(rec),
      nowMs,
    });
  });
}

// ── Enterprise Overview (최상단 카드 8필드) ─────────────────────────────

export type EnterpriseStatus = 'operational' | 'attention' | 'critical' | 'insufficient_data';

export interface EnterpriseOverviewCard {
  enterpriseStatus: EnterpriseStatus;
  revenue: number | null;            // 이번달 매출
  activeStores: number | null;
  activeArtists: number | null;
  activeSubscribers: number | null;
  activeStreams: number | null;      // 오늘 스트림
  monthlySettlement: number | null;  // 이번달 지급 완료 합계
  todaysAlerts: number;
}

export function buildEnterpriseOverview(feeds: HubFeeds): {
  card: EnterpriseOverviewCard;
  alerts: ReturnType<typeof deriveExecutiveAlerts>;
} {
  const alerts = deriveExecutiveAlerts(toExecutiveFeeds(feeds));
  const critical = alerts.alerts.filter((a) => a.priority === 'critical').length;
  const high = alerts.alerts.filter((a) => a.priority === 'high').length;
  const status: EnterpriseStatus = alerts.observedCategories.length === 0
    ? 'insufficient_data'
    : critical > 0 ? 'critical' : high > 0 ? 'attention' : 'operational';
  const subsSeries = seriesOf(feeds.revenueTrend, 'active_subs').filter((v): v is number => v != null);
  return {
    card: {
      enterpriseStatus: status,
      revenue: numAt(feeds.revenue, 'month'),
      activeStores: numAt(feeds.noc, 'online_stores'),
      activeArtists: numAt(feeds.artist, 'active_artists'),
      activeSubscribers: subsSeries.length > 0 ? subsSeries[subsSeries.length - 1] : numAt(feeds.revenueBreakdown, 'churn', 'active'),
      activeStreams: numAt(feeds.streaming, 'today_streams'),
      monthlySettlement: numAt(feeds.settlementKpi, 'month_paid_total'),
      todaysAlerts: alerts.alerts.length,
    },
    alerts,
  };
}

// ── 도메인별 지표 (스펙 5도메인 × 28지표 — 값 표시만, 신규 계산 로직 최소) ──

export const HUB_DOMAINS = ['business', 'platform', 'music', 'financial', 'operations'] as const;
export type HubDomain = (typeof HUB_DOMAINS)[number];

export interface HubMetric {
  key: string;
  domain: HubDomain;
  label: string;
  value: number | null;
  unit: string;
  direction?: TrendDirection;
  status: 'observed' | 'insufficient_data';
  note: string;
}

const PB_MIN_SAMPLE = 10;

export function buildHubMetrics(feeds: HubFeeds): HubMetric[] {
  const out: HubMetric[] = [];
  const add = (key: string, domain: HubDomain, label: string, unit: string, value: number | null, note: string, direction?: TrendDirection) => {
    const observed = value != null || (direction !== undefined && direction !== 'insufficient_data');
    out.push({ key, domain, label, unit, value, direction, status: observed ? 'observed' : 'insufficient_data', note });
  };

  // Business — 추세는 기존 30d 시계열 halves 비교
  const revTrend = analyzeTrendDirection(seriesOf(feeds.revenueTrend, 'revenue'));
  add('revenue_trend', 'business', 'Revenue Trend', '%', revTrend.changePct, revTrend.note, revTrend.direction);
  const subsTrend = analyzeTrendDirection(seriesOf(feeds.revenueTrend, 'active_subs'));
  add('subscription_trend', 'business', 'Subscription Trend', '%', subsTrend.changePct, subsTrend.note, subsTrend.direction);
  add('churn_trend', 'business', 'Churn Trend', '건', numAt(feeds.revenueBreakdown, 'churn', 'canceled'), 'Churn 시계열 피드 부재 — 누적 스냅샷만 표시(방향 판정 보류)', 'insufficient_data');
  add('growth_rate', 'business', 'Growth Rate', '%', revTrend.changePct, '매출 전·후반 평균 변화율(관측 구간 내)', revTrend.direction);
  const storeTrend = analyzeTrendDirection(seriesOf(feeds.businessGrowth, 'new_stores'));
  add('store_growth', 'business', 'Store Growth', '%', storeTrend.changePct, storeTrend.note, storeTrend.direction);
  const artistTrend = analyzeTrendDirection(seriesOf(feeds.artistGrowth, 'new_artists'));
  add('artist_growth', 'business', 'Artist Growth', '%', artistTrend.changePct, artistTrend.note, artistTrend.direction);

  // Platform
  const pbStart = numAt(feeds.streaming, 'pb_start');
  const pbComplete = numAt(feeds.streaming, 'pb_complete');
  const pbError = numAt(feeds.streaming, 'pb_error');
  const pbOk = pbStart != null && pbStart >= PB_MIN_SAMPLE;
  add('playback_success', 'platform', 'Playback Success', '%', pbOk && pbComplete != null ? clampScore((pbComplete / pbStart) * 100) : null,
    pbStart != null && pbStart > 0 && pbStart < PB_MIN_SAMPLE ? `sample_too_small(start=${pbStart})` : '완료/시작 비율(파생값)');
  add('streaming_quality', 'platform', 'Streaming Quality', '%', pbOk && pbError != null ? clampScore(100 - (pbError / pbStart) * 100) : null, '오류율 역산(파생값) ≠ 체감 품질');
  add('queue_status', 'platform', 'Queue Status', '%', null, '전용 재생 큐 상태 피드 부재 — 추론하지 않음');
  add('active_sessions', 'platform', 'Active Sessions', '개', numAt(feeds.streaming, 'heartbeat_sessions'), '오늘 Heartbeat 세션');
  {
    const online = numAt(feeds.noc, 'online_stores');
    const total = numAt(feeds.noc, 'total_stores');
    add('store_availability', 'platform', 'Store Availability', '%', online != null && total != null && total > 0 ? clampScore((online / total) * 100) : null, 'online/total Store 비율');
  }
  add('platform_uptime', 'platform', 'Platform Uptime', '%', null, 'Uptime 계측 피드 부재 — 추론하지 않음');

  // Music
  add('total_tracks', 'music', 'Total Tracks', '곡', numAt(feeds.artistBreakdown, 'tracks', 'total'), '전체 트랙 수');
  add('new_releases', 'music', 'New Releases', '곡', numAt(feeds.artistBreakdown, 'tracks', 'month'), '이번달 신규 트랙');
  {
    const genres = feeds.artistBreakdown?.tracks != null && typeof feeds.artistBreakdown.tracks === 'object'
      ? (feeds.artistBreakdown.tracks as Record<string, unknown>).genre_dist : null;
    add('genre_distribution', 'music', 'Genre Distribution', '장르', Array.isArray(genres) ? genres.length : null, '관측된 장르 종류 수(상세는 Music 탭)');
  }
  {
    const playlists = feeds.playlist?.playlists;
    add('playlist_status', 'music', 'Playlist Status', '개', Array.isArray(playlists) ? playlists.length : null, '관측된 Playlist 수(30d 성과 창)');
  }
  add('qc_status', 'music', 'QC Status', '점', numAt(feeds.artist, 'avg_qc_score'), '평균 QC 점수');
  add('approval_queue', 'music', 'Approval Queue', '건', numAt(feeds.artist, 'pending'), '아티스트 승인 대기');

  // Financial
  add('fin_revenue', 'financial', 'Revenue', '원', numAt(feeds.revenue, 'month'), '이번달 매출');
  add('settlement', 'financial', 'Settlement', '원', numAt(feeds.settlementKpi, 'month_paid_total'), '이번달 지급 완료 합계');
  add('pending_settlement', 'financial', 'Pending Settlement', '원', numAt(feeds.settlementKpi, 'month_payable_total'), '이번달 지급 대기 합계');
  const cost = latestCostTotal(feeds.costSnapshots);
  add('estimated_cost', 'financial', 'Estimated Cost', '원', cost.total, cost.note);
  {
    const month = numAt(feeds.revenue, 'month');
    add('estimated_margin', 'financial', 'Estimated Margin', '원', month != null && cost.total != null ? month - cost.total : null, '매출 − 추정 비용 (추정 ≠ 회계 이익)');
  }

  // Operations
  add('incident', 'operations', 'Incident', '건', numAt(feeds.noc, 'today_incidents'), '오늘 Incident(NOC)');
  add('recovery', 'operations', 'Recovery', '건', numAt(feeds.noc, 'today_recovered'), '오늘 복구 완료');
  {
    const rows = feeds.actionHistory;
    add('review_queue', 'operations', 'Review Queue', '건', rows == null ? null : rows.filter((r) => r.status === 'pending').length, 'Action Center(0479) pending');
    add('executive_actions', 'operations', 'Executive Actions', '건',
      rows == null ? null : rows.filter((r) => typeof r.command_type === 'string' && (r.command_type as string).startsWith('executive_')).length,
      'E-1 Executive 감사 기록 수(관측 창 내)');
    add('open_tasks', 'operations', 'Open Tasks', '건', rows == null ? null : rows.filter((r) => r.status === 'pending' || r.status === 'running').length, 'pending+running 명령 수');
  }
  return out;
}

export function latestCostTotal(snapshots: FeedRecord[] | null): { total: number | null; note: string } {
  if (snapshots == null) return { total: null, note: '비용 스냅샷 피드 미관측' };
  const dated = snapshots
    .map((s) => ({ period: typeof s.period_start === 'string' ? s.period_start.slice(0, 7) : null, cost: isFiniteNumber(s.estimated_cost) ? s.estimated_cost : null }))
    .filter((s): s is { period: string; cost: number | null } => s.period != null);
  if (dated.length === 0) return { total: null, note: '비용 스냅샷 없음 — insufficient_data' };
  const latest = dated.map((s) => s.period).reduce((a, b) => (b > a ? b : a));
  const costs = dated.filter((s) => s.period === latest).map((s) => s.cost).filter((c): c is number => c != null);
  if (costs.length === 0) return { total: null, note: `최신 기간(${latest}) 비용 값 미기록` };
  return { total: costs.reduce((a, b) => a + b, 0), note: `최신 기간(${latest}) 추정 비용 합계 ≠ 실제 청구액` };
}

// ── Cross Domain Intelligence (관련성 설명 — 인과 단정 금지) ─────────────

export interface CrossDomainNode {
  key: string;
  label: string;
  direction: TrendDirection;
}

export interface CrossDomainLink {
  from: string;
  to: string;
  relation: 'co_up' | 'co_down' | 'divergent' | 'insufficient_data';
  description: string;
}

export const CROSS_DOMAIN_DISCLAIMER = 'AI는 인과관계를 단정하지 않습니다 — 동일 관측 구간의 동반 이동(관련성)만 설명합니다. 상관 ≠ 인과.';

/** 스펙 예시 체인(Revenue→Store→Streaming→Settlement→Artist) 순서로 동반 이동을 설명한다. */
export function buildCrossDomainChain(feeds: HubFeeds): {
  nodes: CrossDomainNode[];
  links: CrossDomainLink[];
  disclaimer: string;
} {
  const nodes: CrossDomainNode[] = [
    { key: 'revenue', label: 'Revenue', direction: analyzeTrendDirection(seriesOf(feeds.revenueTrend, 'revenue')).direction },
    { key: 'stores', label: 'Store', direction: analyzeTrendDirection(seriesOf(feeds.businessGrowth, 'new_stores')).direction },
    { key: 'streaming', label: 'Streaming', direction: analyzeTrendDirection(seriesOf(feeds.streamingTimeline, 'streams')).direction },
    { key: 'settlement', label: 'Settlement', direction: analyzeTrendDirection(seriesOf(feeds.artistGrowth, 'settlements')).direction },
    { key: 'artists', label: 'Artist', direction: analyzeTrendDirection(seriesOf(feeds.artistGrowth, 'new_artists')).direction },
  ];
  const links: CrossDomainLink[] = [];
  for (let i = 0; i < nodes.length - 1; i += 1) {
    const a = nodes[i];
    const b = nodes[i + 1];
    let relation: CrossDomainLink['relation'];
    let description: string;
    if (a.direction === 'insufficient_data' || b.direction === 'insufficient_data') {
      relation = 'insufficient_data';
      description = `${a.label}↔${b.label}: 표본 부족 — 관련성 판정 보류(추론 없음)`;
    } else if (a.direction === b.direction && a.direction !== 'flat') {
      relation = a.direction === 'up' ? 'co_up' : 'co_down';
      description = `${a.label}·${b.label} 동반 ${a.direction === 'up' ? '상승' : '하락'} 관측 — 관련성일 뿐 인과 단정 아님`;
    } else {
      relation = 'divergent';
      description = `${a.label}(${a.direction})·${b.label}(${b.direction}) 방향 상이/정체 — 단일 원인으로 설명하지 않음`;
    }
    links.push({ from: a.key, to: b.key, relation, description });
  }
  return { nodes, links, disclaimer: CROSS_DOMAIN_DISCLAIMER };
}

// ── Enterprise Relationships (영역 연결 관계) ───────────────────────────

export const ENTERPRISE_RELATIONSHIP_FLOW = ['business', 'platform', 'music', 'financial', 'operations', 'governance'] as const;
export type RelationshipDomain = (typeof ENTERPRISE_RELATIONSHIP_FLOW)[number];

export const ENTERPRISE_RELATIONSHIP_EDGES: Array<{ from: RelationshipDomain; to: RelationshipDomain; via: string }> = [
  { from: 'business', to: 'platform', via: 'Store/Player 운영이 재생 세션을 만든다' },
  { from: 'platform', to: 'music', via: '재생 세션이 Track/Playlist 소비로 이어진다' },
  { from: 'music', to: 'financial', via: '스트리밍 실적이 Settlement 산정의 입력이 된다' },
  { from: 'financial', to: 'operations', via: '정산/비용 검토가 운영 Review Queue 로 흐른다' },
  { from: 'operations', to: 'governance', via: '운영 조치는 감사 기록·사람 승인 절차를 거친다' },
];

export function buildEnterpriseRelationships(feeds: HubFeeds): Array<{
  domain: RelationshipDomain;
  observed: boolean;
  note: string;
}> {
  return ENTERPRISE_RELATIONSHIP_FLOW.map((domain) => {
    switch (domain) {
      case 'business': return { domain, observed: feeds.business != null || feeds.revenue != null, note: '사업자/매출 피드' };
      case 'platform': return { domain, observed: feeds.streaming != null || feeds.noc != null, note: '재생/Store 피드' };
      case 'music': return { domain, observed: feeds.artist != null || feeds.artistBreakdown != null || feeds.playlist != null, note: '아티스트/트랙/Playlist 피드' };
      case 'financial': return { domain, observed: feeds.settlementKpi != null || feeds.costSnapshots != null, note: '정산/비용 피드' };
      case 'operations': return { domain, observed: feeds.noc != null || feeds.selfHealing != null || feeds.actionHistory != null, note: 'Incident/Action 피드' };
      case 'governance': return { domain, observed: false, note: '이 화면에 연결된 Governance 실측 피드 없음 — 미관측(추론 없음)' };
      default: return { domain, observed: false, note: '' };
    }
  });
}

// ── AI Enterprise Summary (5줄 이내 결정적 요약 — 생성 아님) ─────────────

export function buildEnterpriseSummaryLines(input: {
  revenueDirection: TrendDirection;
  storeDirection: TrendDirection;
  streamingErrorRatePct: number | null;
  pendingSettlementAmount: number | null;
  criticalAlerts: number | null;
}): string[] {
  const lines: string[] = [];
  const dirText: Record<TrendDirection, string> = {
    up: '증가 중입니다', down: '감소 중입니다', flat: '큰 변화 없이 유지 중입니다',
    insufficient_data: '표본이 부족해 방향을 판정하지 않습니다',
  };
  lines.push(`Revenue는 ${dirText[input.revenueDirection]}.`);
  lines.push(`Store 유입은 ${dirText[input.storeDirection]}.`);
  if (input.streamingErrorRatePct == null) lines.push('Streaming 오류율은 관측되지 않았습니다.');
  else if (input.streamingErrorRatePct <= 5) lines.push('Streaming은 안정적으로 관측됩니다.');
  else lines.push(`Streaming 오류율이 ${input.streamingErrorRatePct}%로 관측됩니다.`);
  if (input.pendingSettlementAmount == null) lines.push('Settlement 대기 금액은 관측되지 않았습니다.');
  else if (input.pendingSettlementAmount > 0) lines.push(`Settlement 검토가 일부 남아 있습니다 (대기 ${input.pendingSettlementAmount.toLocaleString('ko-KR')}원).`);
  else lines.push('Settlement 대기 금액은 없습니다.');
  if (input.criticalAlerts == null) lines.push('Critical Alert 상태는 관측되지 않았습니다.');
  else if (input.criticalAlerts === 0) lines.push('Critical Incident는 없습니다.');
  else lines.push(`Critical Alert ${input.criticalAlerts}건 — 사람 확인이 필요합니다.`);
  return lines.slice(0, 5);
}
