/**
 * EnterpriseIntelligenceHubSection — Enterprise E-2 (Enterprise Intelligence Hub).
 *
 * Music/Settlement/Platform/Operations/Financial/Enterprise 데이터를 하나의
 * 통합 화면에서 연결·설명하는 Data Intelligence Layer.
 * 신규 Intelligence Engine/Business Logic/AI 모델/Recommendation Engine 없음 —
 * 기존 adminApi wrapper 17종만 재사용(읽기 전용, 신규 Migration/RPC 없음).
 * AI 는 데이터를 생성하지 않는다 — 없는 데이터는 추론하지 않고 insufficient_data.
 * 상관 ≠ 인과 — Cross Domain 은 관련성만 설명한다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowDown, Bot, ClipboardList, Database, DollarSign,
  GitBranch, LayoutDashboard, Lock, Music, RefreshCw, Shield, TrendingUp,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import {
  fetchRevenueSummary, fetchRevenueTrend, fetchRevenueForecast, fetchRevenueBreakdown,
  fetchBusinessSummary, fetchBusinessGrowth, fetchArtistSummary, fetchArtistGrowth,
  fetchArtistBreakdown, fetchStreamingSummary, fetchStreamingTimeline, fetchNocKpi,
  fetchReadableSettlementKpi, fetchCostSnapshots, fetchPlaylistIntelligence,
  fetchSelfHealingSummary, fetchActionHistory,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import { numAt } from '@/lib/executiveCommandCenter';
import {
  ENTERPRISE_RELATIONSHIP_EDGES, HUB_DOMAINS, HUB_FEED_KEYS,
  analyzeTrendDirection, assessAllFeedQuality, buildCrossDomainChain, buildEnterpriseOverview,
  buildEnterpriseRelationships, buildEnterpriseSummaryLines, buildHubMetrics, emptyHubFeeds,
  seriesOf,
  type FeedRecord, type HubFeeds, type TrendDirection,
} from '@/lib/enterpriseIntelligenceHub';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const DIR_LABEL: Record<TrendDirection, string> = { up: '▲ 상승', down: '▼ 하락', flat: '― 유지', insufficient_data: '표본 부족' };

type Tab = 'overview' | 'business' | 'platform' | 'music' | 'financial' | 'operations'
  | 'relationships' | 'summary' | 'quality' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'business', label: 'Business', icon: TrendingUp },
  { key: 'platform', label: 'Platform', icon: Activity },
  { key: 'music', label: 'Music', icon: Music },
  { key: 'financial', label: 'Financial', icon: DollarSign },
  { key: 'operations', label: 'Operations', icon: ClipboardList },
  { key: 'relationships', label: 'Relationships', icon: GitBranch },
  { key: 'summary', label: 'AI Summary', icon: Bot },
  { key: 'quality', label: 'Data Quality', icon: Database },
  { key: 'limitations', label: 'Known Limitations', icon: Shield },
];

const KNOWN_LIMITATIONS = [
  '신규 Intelligence Engine/Business Logic/AI 모델/Recommendation Engine 생성 없음 — 기존 데이터 연결·설명 계층입니다',
  '신규 Migration/RPC 없음 — 기존 adminApi wrapper 17종 재사용(읽기 전용)',
  'AI 는 데이터를 생성하지 않습니다 — 미관측 피드는 0/추정값으로 치환하지 않고 insufficient_data 로만 노출',
  'Cross Domain 은 동일 관측 구간의 동반 이동(관련성)만 설명하며 인과관계를 단정하지 않습니다 (상관 ≠ 인과)',
  '추세 방향은 30d 관측 구간 전·후반 평균 비교이며 미래 예측/외삽이 아닙니다 (표본 <4 판정 보류)',
  'Queue Status/Platform Uptime/Churn 시계열/Governance 실측 피드 부재 — insufficient_data/미관측으로 정직 표시',
  'Enterprise Status·Today’s Alerts 는 E-1 executiveCommandCenter Alert 파생 규칙 재사용(중복 로직 생성 없음)',
  'AI Enterprise Summary 는 관측값 기반 결정적 문장 생성(5줄 이내)이며 판단/예측/승인이 아닙니다',
  '자동 추천 생성/자동 승인/자동 계약 승인/자동 지급/자동 Merge/자동 Deploy/Production Apply 없음',
  'Migration 0472~0564 production 미적용 — 관련 피드는 적용 전까지 미관측으로 나타날 수 있습니다',
  '브라우저 실측 미검증 — UI 는 타입/린트/빌드/단위 테스트 기준으로만 검증했습니다',
];

const FEED_FETCHERS: Record<(typeof HUB_FEED_KEYS)[number], () => Promise<unknown>> = {
  revenue: () => fetchRevenueSummary(),
  revenueTrend: () => fetchRevenueTrend('30d'),
  revenueForecast: () => fetchRevenueForecast(),
  revenueBreakdown: () => fetchRevenueBreakdown(),
  business: () => fetchBusinessSummary(),
  businessGrowth: () => fetchBusinessGrowth('30d'),
  artist: () => fetchArtistSummary(),
  artistGrowth: () => fetchArtistGrowth('30d'),
  artistBreakdown: () => fetchArtistBreakdown(),
  streaming: () => fetchStreamingSummary(),
  streamingTimeline: () => fetchStreamingTimeline('30d'),
  noc: () => fetchNocKpi(),
  settlementKpi: () => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    return fetchReadableSettlementKpi(month);
  },
  costSnapshots: () => fetchCostSnapshots(100),
  playlist: () => fetchPlaylistIntelligence('30d'),
  selfHealing: () => fetchSelfHealingSummary(),
  actionHistory: () => fetchActionHistory(80),
};

export default function EnterpriseIntelligenceHubSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [feeds, setFeeds] = useState<HubFeeds>(emptyHubFeeds());
  const [failedFeeds, setFailedFeeds] = useState<string[]>([]);
  const [loadedAt, setLoadedAt] = useState<number>(0);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const results = await Promise.allSettled(HUB_FEED_KEYS.map((k) => FEED_FETCHERS[k]()));
      const next = emptyHubFeeds();
      const failed: string[] = [];
      HUB_FEED_KEYS.forEach((k, i) => {
        const r = results[i];
        if (r.status === 'fulfilled' && r.value != null) {
          (next as unknown as Record<string, unknown>)[k] = r.value as FeedRecord | FeedRecord[];
        } else {
          failed.push(k);
        }
      });
      setFeeds(next); setFailedFeeds(failed); setLoadedAt(Date.now());
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const overview = useMemo(() => buildEnterpriseOverview(feeds), [feeds]);
  const metrics = useMemo(() => buildHubMetrics(feeds), [feeds]);
  const chain = useMemo(() => buildCrossDomainChain(feeds), [feeds]);
  const relationships = useMemo(() => buildEnterpriseRelationships(feeds), [feeds]);
  const quality = useMemo(() => assessAllFeedQuality(feeds, loadedAt || 0), [feeds, loadedAt]);

  const summaryLines = useMemo(() => {
    const pbStart = numAt(feeds.streaming, 'pb_start');
    const pbError = numAt(feeds.streaming, 'pb_error');
    return buildEnterpriseSummaryLines({
      revenueDirection: analyzeTrendDirection(seriesOf(feeds.revenueTrend, 'revenue')).direction,
      storeDirection: analyzeTrendDirection(seriesOf(feeds.businessGrowth, 'new_stores')).direction,
      streamingErrorRatePct: pbStart != null && pbError != null && pbStart >= 10 ? Math.round((pbError / pbStart) * 100) : null,
      pendingSettlementAmount: numAt(feeds.settlementKpi, 'month_payable_total'),
      criticalAlerts: overview.alerts.observedCategories.length === 0 ? null : overview.alerts.alerts.filter((a) => a.priority === 'critical').length,
    });
  }, [feeds, overview]);

  if (loading) return <AdminCard title="Enterprise Intelligence Hub"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Enterprise Intelligence Hub">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const qualityTone = (l: string) => (l === 'available' ? 'success' : l === 'partial' ? 'warning' : l === 'delayed' ? 'warning' : 'neutral') as 'success' | 'warning' | 'neutral';
  const dirBadge = (d?: TrendDirection) => d === undefined ? null : (
    <AdminBadge tone={d === 'up' ? 'success' : d === 'down' ? 'danger' : 'neutral'}>{DIR_LABEL[d]}</AdminBadge>
  );
  const metricGrid = (domain: (typeof HUB_DOMAINS)[number]) => (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
      {metrics.filter((m) => m.domain === domain).map((m) => (
        <div key={m.key} className="rounded-lg border border-border p-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] text-muted-foreground">{m.label}</div>
            {dirBadge(m.direction)}
          </div>
          <div className="text-sm font-bold">{m.value == null ? '미관측' : `${NUM(m.value)}${m.unit === '%' ? '%' : ''}`}</div>
          <div className="text-[10px] text-muted-foreground">{m.note}</div>
        </div>
      ))}
    </div>
  );

  return (
    <AdminCard
      title="Enterprise Intelligence Hub"
      subtitle="Music·Settlement·Platform·Operations·Financial·Enterprise 데이터 통합 조회/연관 설명 — 기존 데이터만 연결 (생성/추론/자동 승인 없음)"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 허브는 각 Dashboard 에 흩어진 기존 데이터를 하나의 화면에서 연결하고 설명하는 Data Intelligence Layer 입니다. AI 는 데이터를 생성하지 않으며, 없는 데이터를 추론하지 않습니다(insufficient_data 정직 표시). Cross Domain 은 동반 이동(관련성)만 설명하고 인과관계를 단정하지 않습니다. 신규 Intelligence Engine·Business Logic·AI 모델·Recommendation Engine 은 만들지 않았고, 자동 추천 생성·자동 승인·자동 계약 승인·자동 지급·자동 Merge·자동 Deploy·Production Apply 는 수행하지 않습니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Enterprise Status" value={overview.card.enterpriseStatus} />
            <Box label="Revenue (월)" value={`${NUM(overview.card.revenue)}원`} />
            <Box label="Active Stores" value={NUM(overview.card.activeStores)} />
            <Box label="Active Artists" value={NUM(overview.card.activeArtists)} />
            <Box label="Active Subscribers" value={NUM(overview.card.activeSubscribers)} />
            <Box label="Active Streams (오늘)" value={NUM(overview.card.activeStreams)} />
            <Box label="Monthly Settlement (지급 완료)" value={`${NUM(overview.card.monthlySettlement)}원`} />
            <Box label="Today's Alerts" value={NUM(overview.card.todaysAlerts)} />
          </div>
          {failedFeeds.length > 0 && (
            <AdminAlert tone="warning" icon={<AlertTriangle size={14} />} description={`관측 실패 피드 ${failedFeeds.length}종: ${failedFeeds.join(', ')} — insufficient_data 로만 표시됩니다(추론 없음).`} />
          )}
          <p className="text-[11px] text-muted-foreground">Enterprise Status/Alerts 는 E-1 Alert 파생 규칙 재사용 — 미관측 카테고리: {overview.alerts.unobservedCategories.join(', ') || '없음'}</p>
        </div>
      )}

      {tab === 'business' && metricGrid('business')}
      {tab === 'platform' && metricGrid('platform')}
      {tab === 'music' && (
        <div className="space-y-3">
          {metricGrid('music')}
          {(() => {
            const tracks = feeds.artistBreakdown?.tracks;
            const genres = tracks != null && typeof tracks === 'object' ? (tracks as Record<string, unknown>).genre_dist : null;
            return Array.isArray(genres) && genres.length > 0 ? (
              <div>
                <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Genre Distribution (관측값)</div>
                <div className="flex flex-wrap gap-1">
                  {(genres as Array<Record<string, unknown>>).slice(0, 20).map((g, i) => (
                    <AdminBadge key={i} tone="neutral">{String(g.key ?? '—')} · {NUM(typeof g.count === 'number' ? g.count : null)}</AdminBadge>
                  ))}
                </div>
              </div>
            ) : <AdminEmpty title="장르 분포 미관측" description="genre_dist 피드가 관측되지 않았습니다 — 추론하지 않습니다." />;
          })()}
        </div>
      )}
      {tab === 'financial' && metricGrid('financial')}
      {tab === 'operations' && metricGrid('operations')}

      {tab === 'relationships' && (
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Cross Domain Intelligence (관련성 설명)</div>
            <div className="space-y-1">
              {chain.nodes.map((n, i) => (
                <div key={n.key}>
                  <div className="flex items-center gap-2 rounded-lg border border-border p-2">
                    <span className="text-xs font-bold">{n.label}</span>
                    {dirBadge(n.direction)}
                    {i < chain.links.length && <span className="text-[10px] text-muted-foreground">{chain.links[i].description}</span>}
                  </div>
                  {i < chain.nodes.length - 1 && <div className="pl-3 text-muted-foreground"><ArrowDown size={12} /></div>}
                </div>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">{chain.disclaimer}</p>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Enterprise Relationships (영역 연결)</div>
            <div className="space-y-1">
              {relationships.map((r, i) => (
                <div key={r.domain}>
                  <div className="flex items-center justify-between rounded-lg border border-border p-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold">{r.domain}</span>
                      <AdminBadge tone={r.observed ? 'success' : 'neutral'}>{r.observed ? '관측됨' : '미관측'}</AdminBadge>
                    </div>
                    <span className="text-[10px] text-muted-foreground">{i < ENTERPRISE_RELATIONSHIP_EDGES.length ? ENTERPRISE_RELATIONSHIP_EDGES[i].via : r.note}</span>
                  </div>
                  {i < relationships.length - 1 && <div className="pl-3 text-muted-foreground"><ArrowDown size={12} /></div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'summary' && (
        <div className="space-y-2">
          <div className="rounded-lg border border-border p-3">
            {summaryLines.map((line, i) => <p key={i} className="text-xs">{line}</p>)}
          </div>
          <p className="text-[11px] text-muted-foreground">관측값 기반 결정적 요약(5줄 이내) — 판단/예측/승인 아님. 미관측 값은 수치를 지어내지 않습니다.</p>
        </div>
      )}

      {tab === 'quality' && (
        <div className="space-y-1">
          {quality.map((q) => (
            <div key={q.feed} className="flex items-center justify-between rounded-lg border border-border p-2">
              <div className="flex min-w-0 items-center gap-2">
                <AdminBadge tone={qualityTone(q.level)}>{q.level}</AdminBadge>
                <span className="truncate text-xs font-bold">{q.feed}</span>
              </div>
              <span className="shrink-0 text-[10px] text-muted-foreground">{q.note}</span>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">Available/Partial/Delayed/Insufficient Data — 없는 데이터를 추론하지 않습니다.</p>
        </div>
      )}

      {tab === 'limitations' && (
        <ul className="list-disc space-y-1 pl-4">
          {KNOWN_LIMITATIONS.map((l, i) => <li key={i} className="text-[11px] text-muted-foreground">{l}</li>)}
        </ul>
      )}
    </AdminCard>
  );
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-bold">{value}</div>
    </div>
  );
}
