/**
 * MissionControlSection — AI Music OS Mission Control (Phase ADMIN-MISSION-CONTROL-1).
 *
 * 기존 Dashboard(Member/Growth/Funnel/Revenue/Artist/Business/Streaming/WEB-OBS)의
 * **통합 레이어**다. 새 KPI 를 계산하지 않고 기존 fetcher 를 병렬 재사용해 하나의
 * 운영 관제센터로 통합한다(중복 계산/RPC 없음). 신규는 교차 도메인 이벤트 피드
 * (admin_mission_feed)와 기존 admin_noc_active_alerts 재사용뿐.
 *
 * 탭: Executive(모드 선택 + Overview + Mission Map + AI Insights) · Operations ·
 *     Finance · Streaming · Health · Alerts · Timeline · Feed.
 *
 * 각 데이터 소스는 독립 fetch·오류 격리 → 일부 실패해도 나머지는 정상. 값은 기존
 * Dashboard 와 동일(동일 RPC/fetcher 재사용) → 불일치 없음.
 */
import { useEffect, useState } from 'react';
import {
  Rocket, Users, Building2, Mic2, Wallet, Radio, Wifi, Server, ShieldCheck, AlertTriangle,
  Activity, RefreshCw, Inbox, TrendingUp, HeartPulse, ListTree, Sparkles, CircleDot,
} from 'lucide-react';
import { AdminCard, AdminStatCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import {
  fetchMemberGrowthKpis, fetchRevenueKpis, fetchArtistSummary, fetchBusinessSummary,
  fetchBusinessHealth, fetchStreamingSummary, fetchNocKpi, fetchNowPlayingKpi,
  fetchArtistBreakdown, fetchMissionFeed, fetchNocActiveAlerts,
  type MemberGrowthKpis, type RevenueKpis, type ArtistSummary, type BusinessSummary,
  type BusinessHealth, type StreamingSummary, type NocKpi, type NowPlayingKpi,
  type ArtistBreakdown, type MissionFeed, type NocAlertRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import { momDisplay } from '@/lib/memberGrowth';
import { deriveRevenueKpis, formatKRW } from '@/lib/revenueIntel';
import { completionRate as pbCompletionRate } from '@/lib/streamingIntel';
import { computeHealth as computeBusinessHealth } from '@/lib/businessIntel';
import {
  composeMissionHealth, generateInsights, feedLabel, modeKpis, FEED_META,
  MISSION_HEALTH_LABEL, MISSION_HEALTH_TONE, EXECUTIVE_MODES,
  type ExecutiveMode, type MissionMapNode, type Insight,
} from '@/lib/missionControl';
import { relativeTimeKo, formatKstDateTime } from '@/lib/memberGrowth';

const NUM = (n: number | null | undefined) => (n == null ? '데이터 없음' : n.toLocaleString('ko-KR'));
const PCT = (n: number | null | undefined) => (n == null ? '—' : `${n.toFixed(1)}%`);
const TONE_HEX = { success: '#10b981', warning: '#f59e0b', danger: '#ef4444', neutral: '#737373', info: '#60a5fa' } as const;

type Tab = 'executive' | 'operations' | 'finance' | 'streaming' | 'health' | 'alerts' | 'timeline' | 'feed';
const TABS: { key: Tab; label: string }[] = [
  { key: 'executive', label: 'Executive' }, { key: 'operations', label: 'Operations' },
  { key: 'finance', label: 'Finance' }, { key: 'streaming', label: 'Streaming' },
  { key: 'health', label: 'Health' }, { key: 'alerts', label: 'Alerts' },
  { key: 'timeline', label: 'Timeline' }, { key: 'feed', label: 'Feed' },
];

interface Bundle {
  member: MemberGrowthKpis | null; revenue: RevenueKpis | null; artist: ArtistSummary | null;
  business: BusinessSummary | null; bizHealth: BusinessHealth | null; streaming: StreamingSummary | null;
  noc: NocKpi | null; nowPlaying: NowPlayingKpi | null; artistBreakdown: ArtistBreakdown | null;
}

async function loadBundle(): Promise<Bundle> {
  const settle = async <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);
  const [member, revenue, artist, business, bizHealth, streaming, noc, nowPlaying, artistBreakdown] = await Promise.all([
    settle(fetchMemberGrowthKpis()), settle(fetchRevenueKpis()), settle(fetchArtistSummary()),
    settle(fetchBusinessSummary()), settle(fetchBusinessHealth()), settle(fetchStreamingSummary()),
    settle(fetchNocKpi()), settle(fetchNowPlayingKpi()), settle(fetchArtistBreakdown()),
  ]);
  return { member, revenue, artist, business, bizHealth, streaming, noc, nowPlaying, artistBreakdown };
}

export default function MissionControlSection() {
  const [tab, setTab] = useState<Tab>('executive');
  const [mode, setMode] = useState<ExecutiveMode>('ceo');

  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [bundleErr, setBundleErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);

  const [feed, setFeed] = useState<MissionFeed | null>(null);
  const [feedLoading, setFeedLoading] = useState(false);
  const [alerts, setAlerts] = useState<NocAlertRow[] | null>(null);
  const [alertsLoading, setAlertsLoading] = useState(false);

  async function load() {
    setLoading(true); setBundleErr(null);
    try { setBundle(await loadBundle()); } catch (e) { setBundleErr(classifyAdminError(e)); } finally { setLoading(false); }
  }
  async function loadFeed() {
    setFeedLoading(true);
    try { setFeed(await fetchMissionFeed(30)); } catch { setFeed({ items: [], limit: 30, generated_at: null }); } finally { setFeedLoading(false); }
  }
  async function loadAlerts() {
    setAlertsLoading(true);
    try { setAlerts(await fetchNocActiveAlerts(30, null)); } catch { setAlerts([]); } finally { setAlertsLoading(false); }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (tab === 'feed' && !feed) void loadFeed();
    if (tab === 'alerts' && alerts === null) void loadAlerts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <AdminCard
      title={<span className="flex items-center gap-1.5"><Rocket size={16} /> Mission Control</span>}
      subtitle="AI Music OS 통합 관제 — 기존 Dashboard 재사용(동일 KPI)"
      action={
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${tab === t.key ? 'bg-accent text-black' : 'bg-bg-deep text-ink-mute hover:text-ink'}`}>
              {t.label}
            </button>
          ))}
        </div>
      }
      bodyClassName="space-y-4"
    >
      {loading ? <LoadingBlock />
        : bundleErr || !bundle ? <ErrorBlock error={bundleErr ?? classifyAdminError(null)} onRetry={load} />
        : (
          <>
            {tab === 'executive' && <ExecutiveTab b={bundle} mode={mode} onMode={setMode} />}
            {tab === 'operations' && <OperationsTab b={bundle} />}
            {tab === 'finance' && <FinanceTab b={bundle} />}
            {tab === 'streaming' && <StreamingTab b={bundle} />}
            {tab === 'health' && <HealthTab b={bundle} />}
            {tab === 'alerts' && <AlertsTab alerts={alerts} loading={alertsLoading} />}
            {tab === 'timeline' && <TimelineHint />}
            {tab === 'feed' && <FeedTab feed={feed} loading={feedLoading} />}
          </>
        )}
    </AdminCard>
  );
}

/* ── 공통 ─────────────────────────────────────────────── */
function LoadingBlock() { return <div className="h-40 animate-pulse rounded-2xl bg-bg-deep" aria-busy="true" />; }
function ErrorBlock({ error, onRetry }: { error: AdminError; onRetry: () => void }) {
  return (
    <AdminAlert tone="warning" title="Mission Control 데이터를 불러오지 못했어요" description={error.message}
      action={<button onClick={onRetry} className="inline-flex items-center gap-1 rounded-full bg-bg-card px-3 py-1.5 text-xs hover:bg-bg-hover"><RefreshCw size={12} /> 다시 시도</button>} />
  );
}

/* ── Mission Health 조합 (기존 Health 재사용) ──────────── */
function missionHealthComponents(b: Bundle) {
  const streamingScore = b.streaming ? pbCompletionRate(b.streaming) : null;
  const fleetScore = b.noc && b.noc.total_stores > 0 ? Math.round((b.noc.online_stores / b.noc.total_stores) * 100) : null;
  const storeScore = b.bizHealth ? computeBusinessHealth(b.bizHealth).score : null;
  const playerScore = b.streaming && b.streaming.total_players > 0 ? Math.round((b.streaming.online_players / b.streaming.total_players) * 100) : null;
  return [
    { key: 'streaming', label: 'Streaming(완료율)', score: streamingScore, available: streamingScore != null },
    { key: 'fleet', label: 'Fleet(온라인율)', score: fleetScore, available: fleetScore != null },
    { key: 'store', label: 'Store(운영 Health)', score: storeScore, available: storeScore != null },
    { key: 'player', label: 'Player(온라인율)', score: playerScore, available: playerScore != null },
    { key: 'member', label: 'Member', score: null, available: false },
    { key: 'revenue', label: 'Revenue', score: null, available: false },
    { key: 'artist', label: 'Artist', score: null, available: false },
    { key: 'system', label: 'System', score: null, available: false },
    { key: 'ai', label: 'AI', score: null, available: false },
  ];
}

/* ── Executive ─────────────────────────────────────────── */
function ExecutiveTab({ b, mode, onMode }: { b: Bundle; mode: ExecutiveMode; onMode: (m: ExecutiveMode) => void }) {
  const mom = b.member ? momDisplay(b.member) : null;
  const revD = b.revenue ? deriveRevenueKpis(b.revenue) : null;
  const comp = b.streaming ? pbCompletionRate(b.streaming) : null;
  const health = composeMissionHealth(missionHealthComponents(b));
  const settlementPending = b.artistBreakdown ? (b.artistBreakdown.settlement.pending + b.artistBreakdown.settlement.held + b.artistBreakdown.settlement.carried_over) : null;

  const insights = generateInsights({
    memberToday: b.member?.today_signups ?? null, memberMomText: mom?.text ?? null, memberMomTone: mom?.tone ?? null,
    businessToday: b.business?.today_signups ?? null, artistToday: b.artist?.today_signups ?? null,
    revenueToday: b.revenue?.today_revenue ?? null, revenueGrowthText: revD?.revenueGrowth.text ?? null, revenueGrowthTone: revD?.revenueGrowth.tone ?? null,
    completionRate: comp, onlinePlayers: b.streaming?.online_players ?? null, totalPlayers: b.streaming?.total_players ?? null,
    todayIncidents: b.noc?.today_incidents ?? null,
  });

  const map = buildMissionMap(b);
  const highlighted = new Set(modeKpis(mode));

  return (
    <div className="space-y-4">
      {/* Executive Modes */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-ink-dim">View</span>
        {(Object.keys(EXECUTIVE_MODES) as ExecutiveMode[]).map((m) => (
          <button key={m} onClick={() => onMode(m)}
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition ${mode === m ? 'bg-accent text-black' : 'bg-bg-deep text-ink-mute hover:text-ink'}`}>
            {EXECUTIVE_MODES[m].label}
          </button>
        ))}
      </div>

      {/* Executive Overview KPI (기존 값 재사용) */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi hi={highlighted.has('member_today')} label="오늘 신규 회원" value={NUM(b.member?.today_signups)} icon={<Users size={16} />} tone="info" />
        <Kpi hi={highlighted.has('business_today')} label="오늘 신규 사업자" value={NUM(b.business?.today_signups)} icon={<Building2 size={16} />} tone="info" />
        <Kpi hi={highlighted.has('artist_today')} label="오늘 신규 아티스트" value={NUM(b.artist?.today_signups)} icon={<Mic2 size={16} />} tone="info" />
        <Kpi hi={highlighted.has('revenue_today')} label="오늘 매출" value={b.revenue ? formatKRW(b.revenue.today_revenue) : '데이터 없음'} icon={<Wallet size={16} />} tone="success" />
        <Kpi hi={highlighted.has('now_playing')} label="현재 재생 중" value={NUM(b.streaming?.now_playing)} icon={<Radio size={16} />} tone="success" />
        <Kpi hi={highlighted.has('online_stores')} label="온라인 Store" value={NUM(b.noc?.online_stores)} icon={<Server size={16} />} tone="success" />
        <Kpi hi={highlighted.has('online_players')} label="온라인 Player" value={NUM(b.streaming?.online_players)} icon={<Wifi size={16} />} tone={b.streaming && b.streaming.online_players > 0 ? 'success' : 'neutral'} />
        <Kpi hi={highlighted.has('mrr')} label="MRR" value={b.revenue ? formatKRW(b.revenue.mrr) : '데이터 없음'} icon={<TrendingUp size={16} />} tone="primary" />
        <Kpi hi={highlighted.has('mission_health')} label="Mission Health" value={health.score == null ? '데이터 없음' : String(health.score)} icon={<HeartPulse size={16} />} tone={MISSION_HEALTH_TONE[health.level]} />
        <Kpi hi={highlighted.has('completion_rate')} label="Streaming 완료율" value={PCT(comp)} icon={<Activity size={16} />} tone="success" />
        <Kpi hi={highlighted.has('incidents')} label="현재 Incident" value={NUM(b.noc?.today_incidents)} icon={<AlertTriangle size={16} />} tone={b.noc && b.noc.today_incidents > 0 ? 'danger' : 'neutral'} />
        <Kpi hi={highlighted.has('settlement_pending')} label="정산 예정" value={NUM(settlementPending)} icon={<Wallet size={16} />} tone="warning" />
      </div>

      {/* Mission Map */}
      <div>
        <p className="mb-1.5 flex items-center gap-1 text-xs font-bold"><ListTree size={13} /> Mission Map — 서비스 체인 상태</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {map.map((n, i) => (
            <span key={n.key} className="flex items-center gap-1.5">
              <span className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px]" style={{ background: `${TONE_HEX[n.tone]}22` }}>
                <CircleDot size={11} style={{ color: TONE_HEX[n.tone] }} />
                <span className="font-semibold text-ink">{n.label}</span>
                <span className="tabular-nums text-ink-mute">{n.value}</span>
              </span>
              {i < map.length - 1 && <span className="text-ink-dim">→</span>}
            </span>
          ))}
        </div>
      </div>

      {/* AI Insights (사실 서술만) */}
      <div>
        <p className="mb-1.5 flex items-center gap-1 text-xs font-bold"><Sparkles size={13} /> AI Insights — 실제 KPI 변화 요약</p>
        {insights.length === 0 ? <AdminEmpty icon={<Inbox size={20} />} title="요약할 KPI 없음" /> : (
          <div className="space-y-1">
            {insights.map((ins: Insight) => (
              <div key={ins.key} className="flex items-center gap-2 rounded-lg bg-bg-deep px-3 py-1.5 text-xs">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: TONE_HEX[ins.tone] }} />
                <span className="text-ink">{ins.text}</span>
              </div>
            ))}
          </div>
        )}
        <p className="mt-1 text-[10px] text-ink-dim">LLM 추측·예측·원인 분석 없이 실제 KPI 값/변화만 서술합니다.</p>
      </div>
    </div>
  );
}

function Kpi({ hi, ...props }: { hi: boolean; label: string; value: React.ReactNode; icon: React.ReactNode; tone: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' }) {
  return <div className={hi ? 'rounded-2xl ring-2 ring-accent/40' : ''}><AdminStatCard {...props} /></div>;
}

function buildMissionMap(b: Bundle): MissionMapNode[] {
  const t = (ok: boolean, warn = false): 'success' | 'warning' | 'danger' | 'neutral' => ok ? 'success' : warn ? 'warning' : 'neutral';
  return [
    { key: 'member', label: '회원', value: NUM(b.member?.total_valid_members), tone: t(!!b.member) },
    { key: 'business', label: '사업자', value: NUM(b.business?.total_business), tone: t(!!b.business) },
    { key: 'store', label: '매장', value: NUM(b.business?.total_stores), tone: t(!!b.business) },
    { key: 'player', label: 'Player', value: b.streaming ? `${b.streaming.online_players}/${b.streaming.total_players}` : '—', tone: b.streaming ? (b.streaming.online_players > 0 ? 'success' : 'warning') : 'neutral' },
    { key: 'playback', label: 'Playback', value: b.streaming ? `${NUM(b.streaming.now_playing)} 재생` : '—', tone: t(!!b.streaming) },
    { key: 'streaming', label: 'Streaming', value: b.noc ? `${NUM(b.noc.online_stores)} 온라인` : '—', tone: t(!!b.noc) },
    { key: 'settlement', label: '정산', value: NUM(b.artist?.settled), tone: t(!!b.artist) },
    { key: 'revenue', label: '매출', value: b.revenue ? formatKRW(b.revenue.mrr) : '—', tone: t(!!b.revenue) },
  ];
}

/* ── Operations ────────────────────────────────────────── */
function OperationsTab({ b }: { b: Bundle }) {
  return (
    <div className="space-y-2">
      <ReuseNote text="admin_noc_kpi · admin_now_playing_kpi · admin_streaming_summary 재사용" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <AdminStatCard label="온라인 Store" value={NUM(b.noc?.online_stores)} icon={<Server size={16} />} tone="success" />
        <AdminStatCard label="오프라인 Store" value={NUM(b.noc?.offline_stores)} icon={<Server size={16} />} tone="warning" />
        <AdminStatCard label="재생 중(매장)" value={NUM(b.nowPlaying?.playing)} icon={<Radio size={16} />} tone="success" />
        <AdminStatCard label="온라인 Player" value={NUM(b.streaming?.online_players)} icon={<Wifi size={16} />} tone={b.streaming && b.streaming.online_players > 0 ? 'success' : 'neutral'} hint={b.streaming && b.streaming.total_players > 0 ? `온라인율 ${PCT(Math.round((b.streaming.online_players / b.streaming.total_players) * 1000) / 10)}` : undefined} />
        <AdminStatCard label="오늘 Incident" value={NUM(b.noc?.today_incidents)} icon={<AlertTriangle size={16} />} tone={b.noc && b.noc.today_incidents > 0 ? 'danger' : 'neutral'} />
        <AdminStatCard label="오늘 Recovery" value={NUM(b.noc?.today_recovered)} icon={<ShieldCheck size={16} />} tone="success" />
        <AdminStatCard label="Heartbeat 오류" value={NUM(b.noc?.heartbeat_errors)} icon={<Activity size={16} />} tone="danger" />
        <AdminStatCard label="Player 오류" value={NUM(b.noc?.player_errors)} icon={<AlertTriangle size={16} />} tone="danger" />
      </div>
    </div>
  );
}

/* ── Finance ───────────────────────────────────────────── */
function FinanceTab({ b }: { b: Bundle }) {
  if (!b.revenue) return <AdminEmpty icon={<Inbox size={24} />} title="Revenue 데이터 없음" />;
  const d = deriveRevenueKpis(b.revenue);
  const settlementPending = b.artistBreakdown ? (b.artistBreakdown.settlement.pending + b.artistBreakdown.settlement.held + b.artistBreakdown.settlement.carried_over) : null;
  return (
    <div className="space-y-2">
      <ReuseNote text="admin_revenue_kpis · admin_artist_breakdown 재사용" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <AdminStatCard label="오늘 매출" value={formatKRW(b.revenue.today_revenue)} icon={<Wallet size={16} />} tone="success" />
        <AdminStatCard label="이번달 매출" value={formatKRW(b.revenue.month_revenue)} icon={<Wallet size={16} />} tone="success" />
        <AdminStatCard label="MRR" value={formatKRW(b.revenue.mrr)} icon={<TrendingUp size={16} />} tone="primary" />
        <AdminStatCard label="ARR" value={formatKRW(b.revenue.arr)} icon={<TrendingUp size={16} />} tone="primary" />
        <AdminStatCard label="Revenue Growth" value={d.revenueGrowth.text} icon={<TrendingUp size={16} />} tone={d.revenueGrowth.tone === 'success' ? 'success' : d.revenueGrowth.tone === 'danger' ? 'danger' : 'neutral'} />
        <AdminStatCard label="유료 전환율" value={PCT(b.member?.paid_conversion_rate ?? null)} icon={<Activity size={16} />} tone="success" />
        <AdminStatCard label="정산 예정" value={NUM(settlementPending)} icon={<Wallet size={16} />} tone="warning" />
        <AdminStatCard label="활성 구독" value={NUM(b.revenue.active_subscriptions)} icon={<Users size={16} />} tone="primary" />
      </div>
    </div>
  );
}

/* ── Streaming ─────────────────────────────────────────── */
function StreamingTab({ b }: { b: Bundle }) {
  if (!b.streaming) return <AdminEmpty icon={<Inbox size={24} />} title="Streaming 데이터 없음" />;
  const comp = pbCompletionRate(b.streaming);
  return (
    <div className="space-y-2">
      <ReuseNote text="admin_streaming_summary · admin_now_playing_kpi 재사용" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <AdminStatCard label="현재 재생 중" value={NUM(b.streaming.now_playing)} icon={<Radio size={16} />} tone="success" />
        <AdminStatCard label="온라인 Player" value={NUM(b.streaming.online_players)} icon={<Wifi size={16} />} tone={b.streaming.online_players > 0 ? 'success' : 'neutral'} />
        <AdminStatCard label="오늘 재생" value={NUM(b.streaming.today_streams)} icon={<Radio size={16} />} tone="primary" />
        <AdminStatCard label="완료율" value={PCT(comp)} icon={<Activity size={16} />} tone="success" hint={`${NUM(b.streaming.pb_complete)}/${NUM(b.streaming.pb_start)}`} />
      </div>
    </div>
  );
}

/* ── Health ────────────────────────────────────────────── */
function HealthTab({ b }: { b: Bundle }) {
  const comps = missionHealthComponents(b);
  const health = composeMissionHealth(comps);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="rounded-2xl px-4 py-3" style={{ background: `${TONE_HEX[MISSION_HEALTH_TONE[health.level]]}22` }}>
          <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-ink-dim"><HeartPulse size={12} /> Mission Health</p>
          <p className="text-2xl font-extrabold tabular-nums text-ink">{health.score == null ? '—' : health.score.toFixed(1)}</p>
          <AdminBadge tone={MISSION_HEALTH_TONE[health.level]} size="sm">{MISSION_HEALTH_LABEL[health.level]}</AdminBadge>
        </div>
        <p className="text-[11px] text-ink-mute">사용 신호 {health.used.length}개 평균 · 제외 {health.excluded.length}개. 기존 Health 계산을 재사용하며 없는 항목은 제외합니다(추정 금지).</p>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-bold">Health 구성 (기존 계산 재사용)</p>
        <div className="space-y-1">
          {comps.map((c) => (
            <div key={c.key} className="flex items-center justify-between gap-2 rounded-lg bg-bg-deep px-3 py-1.5 text-xs">
              <span className="flex items-center gap-2 text-ink">{c.label}{!c.available && <AdminBadge tone="neutral" size="sm">데이터 없음/제외</AdminBadge>}</span>
              <span className="tabular-nums font-bold text-ink">{c.available && c.score != null ? c.score : '—'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Alerts (admin_noc_active_alerts 재사용) ──────────────── */
function AlertsTab({ alerts, loading }: { alerts: NocAlertRow[] | null; loading: boolean }) {
  if (loading) return <LoadingBlock />;
  if (!alerts) return <LoadingBlock />;
  if (alerts.length === 0) return <AdminEmpty icon={<ShieldCheck size={24} />} title="열린 Alert 없음" description="현재 활성 알림이 없습니다 (admin_noc_active_alerts)." />;
  const sevTone = (s?: string) => s === 'critical' ? 'danger' : s === 'major' || s === 'warning' ? 'warning' : 'neutral';
  return (
    <div className="space-y-2">
      <ReuseNote text="admin_noc_active_alerts 재사용" />
      <div className="space-y-1">
        {alerts.map((a, i) => (
          <div key={String(a.id ?? i)} className="flex items-center justify-between gap-2 rounded-lg bg-bg-deep px-3 py-1.5 text-xs">
            <span className="flex min-w-0 items-center gap-2">
              <AdminBadge tone={sevTone(a.severity)} size="sm">{a.severity ?? 'info'}</AdminBadge>
              <span className="min-w-0 truncate text-ink">{String(a.title ?? a.message ?? a.category ?? '알림')}</span>
            </span>
            <span className="shrink-0 text-ink-dim">{a.created_at ? relativeTimeKo(a.created_at) : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Timeline (기존 시계열 대시보드로 이동 안내) ─────────── */
function TimelineHint() {
  return (
    <AdminAlert tone="info" title="Executive Timeline"
      description="회원/매출/재생/정산 시계열은 각 Dashboard(회원 성장 · Revenue Trend · Streaming Timeline)의 기존 시계열 RPC 를 그대로 사용합니다. Mission Control 은 중복 시계열을 새로 만들지 않고 해당 섹션으로 연결합니다(동일 값)." />
  );
}

/* ── Feed (admin_mission_feed 신규) ──────────────────────── */
function FeedTab({ feed, loading }: { feed: MissionFeed | null; loading: boolean }) {
  if (loading) return <LoadingBlock />;
  if (!feed) return <LoadingBlock />;
  if (feed.items.length === 0) return <AdminEmpty icon={<Inbox size={24} />} title="최근 이벤트 없음" />;
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-ink-mute">실시간 운영 이벤트 (실제 존재하는 이벤트만 · admin_mission_feed)</p>
      <div className="space-y-1">
        {feed.items.map((it, i) => {
          const meta = FEED_META[it.kind];
          return (
            <div key={i} className="flex items-center justify-between gap-2 rounded-lg bg-bg-deep px-3 py-1.5 text-xs">
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: TONE_HEX[meta?.tone ?? 'neutral'] }} />
                <span className="shrink-0 font-semibold text-ink">{feedLabel(it)}</span>
                {it.ref && <span className="min-w-0 truncate text-ink-mute">{it.ref}</span>}
              </span>
              <span className="shrink-0 text-ink-dim" title={formatKstDateTime(it.at)}>{relativeTimeKo(it.at)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReuseNote({ text }: { text: string }) {
  return <p className="text-[10px] text-ink-dim">↺ {text} (재계산 없음 · 값 동일)</p>;
}
