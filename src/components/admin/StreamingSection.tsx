/**
 * StreamingSection — Streaming Intelligence Dashboard (Phase ADMIN-STREAMING-1).
 *
 * PR #362~#367 위에 이어 Playback/Streaming/Queue/Player/Store/Fleet 운영 상태를
 * BI 관점으로 분석한다. 핵심 원칙: 기존 Observability(NOC 0385·Now Playing 0376·
 * Streaming v2 0413·Playback Events v2 0253)를 **재사용**하고 Health/Quality/Fleet
 * 계산을 새로 만들지 않는다. 신규는 전역 재생 스냅샷/시계열(0477)만.
 *
 * 8개 내부 탭:
 *   Overview  — 전역 재생 KPI + Fleet(NOC)/Now Playing 요약 (재사용)
 *   Playback  — 재생 성공/완료/스킵 + 최근 Player 오류 (재사용) + 미수집 항목 안내
 *   Quality   — Streaming v2 Health(재사용). stream_quality 미수집 → Quality Score 데이터 없음
 *   Queue     — 큐 텔레메트리 미수집 → 데이터 없음
 *   Fleet     — NOC KPI(재사용): online/offline/incident/recovered/errors
 *   Stores    — NOC 매장 Health 랭킹(재사용, _noc_store_health_score)
 *   Timeline  — 재생 시계열(신규, 기간 선택)
 *   Rankings  — TOP 안정/위험 매장(NOC 재사용) + 지원 매트릭스
 *
 * 자체 fetch·오류 격리 → RPC 미적용/미가용 시에도 기존 대시보드 정상. 미수집
 * 텔레메트리(Buffer/Crossfade/TTFA/Decoder/Queue/Quality)는 "데이터 없음" 명시.
 */
import { useEffect, useState } from 'react';
import {
  Radio, Wifi, WifiOff, Headphones, Play, SkipForward, CheckCircle2, AlertTriangle,
  Activity, RefreshCw, Inbox, TrendingUp, ShieldCheck, Server, Ban, Gauge, ListMusic,
} from 'lucide-react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { AdminCard, AdminStatCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import {
  fetchStreamingSummary, fetchStreamingTimeline, fetchNocKpi, fetchNowPlayingKpi,
  fetchStreamV2Health, fetchRecentPlayerErrors, fetchNocStoreHealth,
  type StreamingSummary, type StreamingTimeline, type StreamingTimelineRange,
  type NocKpi, type NowPlayingKpi, type StreamV2Health, type PlayerErrorRow, type NocStoreHealthRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  formatPct, formatNum, formatSeconds, completionRate, skipRate, rateTone,
  streamingIntegrityWarnings, unsupportedList, isSupported,
} from '@/lib/streamingIntel';
import { formatBucketLabel, relativeTimeKo } from '@/lib/memberGrowth';

const NUM = (n: number | null | undefined) => formatNum(n);
const CHART_TOOLTIP_STYLE = { background: '#181818', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 } as const;

const RANGES: { key: StreamingTimelineRange; label: string }[] = [
  { key: '7d', label: '7일' }, { key: '30d', label: '30일' }, { key: '90d', label: '90일' }, { key: '12m', label: '12개월' },
];

type Tab = 'overview' | 'playback' | 'quality' | 'queue' | 'fleet' | 'stores' | 'timeline' | 'rankings';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' }, { key: 'playback', label: 'Playback' }, { key: 'quality', label: 'Quality' },
  { key: 'queue', label: 'Queue' }, { key: 'fleet', label: 'Fleet' }, { key: 'stores', label: 'Stores' },
  { key: 'timeline', label: 'Timeline' }, { key: 'rankings', label: 'Rankings' },
];

export default function StreamingSection() {
  const [tab, setTab] = useState<Tab>('overview');

  const [summary, setSummary] = useState<StreamingSummary | null>(null);
  const [sumErr, setSumErr] = useState<AdminError | null>(null);
  const [sumLoading, setSumLoading] = useState(true);

  // 재사용 Observability
  const [noc, setNoc] = useState<NocKpi | null>(null);
  const [nocErr, setNocErr] = useState<AdminError | null>(null);
  const [np, setNp] = useState<NowPlayingKpi | null>(null);
  const [obsLoaded, setObsLoaded] = useState(false);
  const [obsLoading, setObsLoading] = useState(false);

  const [health, setHealth] = useState<StreamV2Health | null>(null);
  const [healthErr, setHealthErr] = useState<AdminError | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const [errors, setErrors] = useState<PlayerErrorRow[] | null>(null);
  const [errLoading, setErrLoading] = useState(false);

  const [stores, setStores] = useState<NocStoreHealthRow[] | null>(null);
  const [storeErr, setStoreErr] = useState<AdminError | null>(null);
  const [storeLoading, setStoreLoading] = useState(false);

  const [range, setRange] = useState<StreamingTimelineRange>('30d');
  const [timeline, setTimeline] = useState<StreamingTimeline | null>(null);
  const [tlErr, setTlErr] = useState<AdminError | null>(null);
  const [tlLoading, setTlLoading] = useState(false);

  async function loadSummary() {
    setSumLoading(true); setSumErr(null);
    try { setSummary(await fetchStreamingSummary()); } catch (e) { setSumErr(classifyAdminError(e)); } finally { setSumLoading(false); }
  }
  async function loadObs() {
    setObsLoading(true); setNocErr(null);
    try {
      const [n, p] = await Promise.all([fetchNocKpi().catch(() => null), fetchNowPlayingKpi().catch(() => null)]);
      setNoc(n); setNp(p); setObsLoaded(true);
    } catch (e) { setNocErr(classifyAdminError(e)); } finally { setObsLoading(false); }
  }
  async function loadHealth() {
    setHealthLoading(true); setHealthErr(null);
    try { setHealth(await fetchStreamV2Health(30)); } catch (e) { setHealthErr(classifyAdminError(e)); } finally { setHealthLoading(false); }
  }
  async function loadErrors() {
    setErrLoading(true);
    try { setErrors(await fetchRecentPlayerErrors(30, 15)); } catch { setErrors([]); } finally { setErrLoading(false); }
  }
  async function loadStores() {
    setStoreLoading(true); setStoreErr(null);
    try { setStores(await fetchNocStoreHealth(20)); } catch (e) { setStoreErr(classifyAdminError(e)); } finally { setStoreLoading(false); }
  }
  async function loadTimeline(r: StreamingTimelineRange) {
    setTlLoading(true); setTlErr(null);
    try { setTimeline(await fetchStreamingTimeline(r)); } catch (e) { setTlErr(classifyAdminError(e)); } finally { setTlLoading(false); }
  }

  useEffect(() => { void loadSummary(); }, []);
  useEffect(() => { if (tab === 'timeline') void loadTimeline(range); }, [tab, range]);
  useEffect(() => {
    if ((tab === 'overview' || tab === 'fleet') && !obsLoaded) void loadObs();
    if (tab === 'quality' && !health && !healthErr) void loadHealth();
    if (tab === 'playback' && errors === null) void loadErrors();
    if (tab === 'stores' && stores === null) void loadStores();
    if (tab === 'rankings' && stores === null) void loadStores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <AdminCard
      title="Streaming Intelligence"
      subtitle="Playback · Streaming · Fleet · Store · Player 운영 BI (기존 Observability 재사용)"
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
      {tab === 'overview' && <OverviewTab summary={summary} loading={sumLoading} error={sumErr} onRetry={loadSummary} noc={noc} np={np} obsLoading={obsLoading} />}
      {tab === 'playback' && <PlaybackTab summary={summary} loading={sumLoading} error={sumErr} onRetry={loadSummary} errors={errors} errLoading={errLoading} />}
      {tab === 'quality' && <QualityTab summary={summary} health={health} loading={healthLoading} error={healthErr} onRetry={loadHealth} />}
      {tab === 'queue' && <QueueTab />}
      {tab === 'fleet' && <FleetTab noc={noc} loading={obsLoading} error={nocErr} onRetry={loadObs} />}
      {tab === 'stores' && <StoresTab stores={stores} loading={storeLoading} error={storeErr} onRetry={loadStores} />}
      {tab === 'timeline' && <TimelineTab timeline={timeline} loading={tlLoading} error={tlErr} range={range} onRange={setRange} onRetry={() => loadTimeline(range)} />}
      {tab === 'rankings' && <RankingsTab summary={summary} stores={stores} loading={storeLoading} error={storeErr} onRetry={loadStores} />}
    </AdminCard>
  );
}

/* ── 공통 ─────────────────────────────────────────────── */
function LoadingBlock() { return <div className="h-40 animate-pulse rounded-2xl bg-bg-deep" aria-busy="true" />; }
function ErrorBlock({ error, onRetry }: { error: AdminError; onRetry: () => void }) {
  return (
    <AdminAlert tone="warning" title="Streaming 데이터를 불러오지 못했어요" description={error.message}
      action={<button onClick={onRetry} className="inline-flex items-center gap-1 rounded-full bg-bg-card px-3 py-1.5 text-xs hover:bg-bg-hover"><RefreshCw size={12} /> 다시 시도</button>} />
  );
}
function NoData({ title, description }: { title: string; description: string }) {
  return <AdminAlert tone="info" icon={<Ban size={16} />} title={title} description={description} />;
}

/* ── Overview ──────────────────────────────────────────── */
function OverviewTab({ summary, loading, error, onRetry, noc, np, obsLoading }: {
  summary: StreamingSummary | null; loading: boolean; error: AdminError | null; onRetry: () => void;
  noc: NocKpi | null; np: NowPlayingKpi | null; obsLoading: boolean;
}) {
  if (loading) return <LoadingBlock />;
  if (error || !summary) return <ErrorBlock error={error ?? classifyAdminError(null)} onRetry={onRetry} />;

  const warnings = streamingIntegrityWarnings(summary);
  const comp = completionRate(summary);

  return (
    <div className="space-y-3">
      {warnings.length > 0 && <AdminAlert tone="warning" title="Streaming 정합성 경고" description={warnings.join(' · ')} />}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <AdminStatCard label="현재 재생 중" value={NUM(summary.now_playing)} icon={<Radio size={16} />} tone={summary.now_playing > 0 ? 'success' : 'neutral'} />
        <AdminStatCard label="온라인 Player" value={NUM(summary.online_players)} icon={<Wifi size={16} />} tone={summary.online_players > 0 ? 'success' : 'neutral'} hint={`≤${summary.online_cutoff_minutes}분`} />
        <AdminStatCard label="오프라인 Player" value={NUM(summary.offline_players)} icon={<WifiOff size={16} />} tone="danger" />
        <AdminStatCard label="오늘 재생" value={NUM(summary.today_streams)} icon={<Play size={16} />} tone="primary" />
        <AdminStatCard label="오늘 재생시간" value={formatSeconds(summary.today_listen_seconds)} icon={<Headphones size={16} />} tone="info" />
        <AdminStatCard label="평균 재생시간" value={formatSeconds(summary.avg_listen_seconds)} icon={<Headphones size={16} />} tone="neutral" />
        <AdminStatCard label="Playback 성공(완료율)" value={formatPct(comp)} icon={<CheckCircle2 size={16} />} tone={rateTone(comp)} hint={`${NUM(summary.pb_complete)}/${NUM(summary.pb_start)}`} />
        <AdminStatCard label="Playback 오류" value={NUM(summary.pb_error)} icon={<AlertTriangle size={16} />} tone={summary.pb_error > 0 ? 'danger' : 'neutral'} />
      </div>

      {/* 재사용: Fleet(NOC) / Now Playing 요약 */}
      <div>
        <p className="mb-1.5 flex items-center gap-1 text-xs font-bold"><Server size={13} /> Fleet · Now Playing (기존 Observability)</p>
        {obsLoading ? <div className="h-16 animate-pulse rounded-xl bg-bg-deep" /> : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <AdminStatCard label="Fleet 온라인 매장" value={noc ? NUM(noc.online_stores) : '데이터 없음'} icon={<Wifi size={16} />} tone="success" />
            <AdminStatCard label="Fleet 오프라인 매장" value={noc ? NUM(noc.offline_stores) : '데이터 없음'} icon={<WifiOff size={16} />} tone="warning" />
            <AdminStatCard label="오늘 Incident" value={noc ? NUM(noc.today_incidents) : '데이터 없음'} icon={<AlertTriangle size={16} />} tone="danger" />
            <AdminStatCard label="재생 중(매장)" value={np ? NUM(np.playing) : '데이터 없음'} icon={<Radio size={16} />} tone="primary" />
          </div>
        )}
        <p className="mt-1 text-[10px] text-ink-dim">Fleet/Now Playing 값은 기존 admin_noc_kpi · admin_now_playing_kpi RPC 를 재사용합니다(재계산 없음).</p>
      </div>
    </div>
  );
}

/* ── Playback ──────────────────────────────────────────── */
function PlaybackTab({ summary, loading, error, onRetry, errors, errLoading }: {
  summary: StreamingSummary | null; loading: boolean; error: AdminError | null; onRetry: () => void;
  errors: PlayerErrorRow[] | null; errLoading: boolean;
}) {
  if (loading) return <LoadingBlock />;
  if (error || !summary) return <ErrorBlock error={error ?? classifyAdminError(null)} onRetry={onRetry} />;

  const comp = completionRate(summary);
  const skip = skipRate(summary);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <AdminStatCard label="재생 시작" value={NUM(summary.pb_start)} icon={<Play size={16} />} tone="primary" />
        <AdminStatCard label="재생 완료" value={NUM(summary.pb_complete)} icon={<CheckCircle2 size={16} />} tone="success" hint={`완료율 ${formatPct(comp)}`} />
        <AdminStatCard label="스킵" value={NUM(summary.pb_skip)} icon={<SkipForward size={16} />} tone="warning" hint={`스킵율 ${formatPct(skip)}`} />
        <AdminStatCard label="Playback 오류" value={NUM(summary.pb_error)} icon={<AlertTriangle size={16} />} tone={summary.pb_error > 0 ? 'danger' : 'neutral'} />
      </div>

      {/* 최근 Player 오류 — 재사용 admin_recent_player_errors */}
      <div>
        <p className="mb-1.5 flex items-center gap-1 text-xs font-bold"><AlertTriangle size={13} /> 최근 Player 오류 (기존 RPC 재사용)</p>
        {errLoading ? <div className="h-16 animate-pulse rounded-xl bg-bg-deep" />
          : !errors || errors.length === 0 ? <AdminEmpty icon={<Inbox size={20} />} title="최근 오류 없음" description="최근 30일 player_error 이벤트가 없습니다." />
          : (
            <div className="space-y-1">
              {errors.slice(0, 10).map((e, i) => (
                <div key={i} className="flex items-center justify-between gap-2 rounded bg-bg-deep px-2 py-1 text-[11px]">
                  <span className="min-w-0 truncate text-ink-mute">{String(e.message ?? e.error ?? '오류')}</span>
                  <span className="shrink-0 text-ink-dim">{e.created_at ? relativeTimeKo(e.created_at) : ''}</span>
                </div>
              ))}
            </div>
          )}
      </div>

      <NoData title="미수집 재생 텔레메트리 (데이터 없음)"
        description="Time To First Audio · Track Transition Gap · Crossfade · Retry · Recovery 는 클라이언트(audioDiagnosticsStore) 로컬에만 존재하고 서버로 전송되지 않아 집계할 수 없습니다(추정 금지)." />
    </div>
  );
}

/* ── Quality ───────────────────────────────────────────── */
function QualityTab({ summary, health, loading, error, onRetry }: {
  summary: StreamingSummary | null; health: StreamV2Health | null; loading: boolean; error: AdminError | null; onRetry: () => void;
}) {
  const qualitySupported = isSupported(summary?.support, 'streaming_quality');
  return (
    <div className="space-y-3">
      {/* Streaming v2 Health — 재사용 admin_stream_v2_health */}
      <div>
        <p className="mb-1.5 flex items-center gap-1 text-xs font-bold"><Gauge size={13} /> Streaming v2 Health (기존 RPC 재사용)</p>
        {loading ? <LoadingBlock />
          : error ? <ErrorBlock error={error} onRetry={onRetry} />
          : !health ? <NoData title="Streaming v2 Health 없음" description="admin_stream_v2_health 응답이 없습니다(shadow 비활성 또는 데이터 부족)." />
          : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <AdminStatCard label="Overall Health" value={health.overall_health != null ? String(health.overall_health) : '데이터 없음'} icon={<ShieldCheck size={16} />} tone="success" />
              <AdminStatCard label="Verified Rate" value={formatPct(health.verified_rate)} icon={<CheckCircle2 size={16} />} tone="info" />
              <AdminStatCard label="Eligible Rate" value={formatPct(health.eligible_rate)} icon={<CheckCircle2 size={16} />} tone="info" />
              <AdminStatCard label="Heartbeat 성공률" value={formatPct(health.heartbeat_success_rate)} icon={<Activity size={16} />} tone="success" />
              <AdminStatCard label="Fraud Rate" value={formatPct(health.fraud_rate)} icon={<AlertTriangle size={16} />} tone="warning" />
              <AdminStatCard label="Rejected Rate" value={formatPct(health.rejected_rate)} icon={<Ban size={16} />} tone="warning" />
            </div>
          )}
      </div>

      {!qualitySupported && (
        <NoData title="Streaming Quality Score — 데이터 없음"
          description="stream_ingest_v2.stream_quality 가 전부 비어 있어(클라이언트 미수집) Quality Score · Quality Trend · Release/Browser/Device 품질 비교를 산출할 수 없습니다(추정 금지). 위 Health 지표(verified/eligible/heartbeat)는 기존 RPC 값을 그대로 사용합니다." />
      )}
    </div>
  );
}

/* ── Queue ─────────────────────────────────────────────── */
function QueueTab() {
  return (
    <NoData title="Queue Intelligence — 데이터 없음"
      description="Queue Size · Queue Delay · Queue Empty · Queue Recovery · Queue Rebuild · Scheduler Delay 텔레메트리는 서버에 수집되지 않습니다(큐 상태는 런타임 클라이언트 로컬). 추정하지 않고 데이터 없음으로 표시합니다. 필요 시 큐 이벤트 수집 파이프라인 도입이 선행되어야 합니다." />
  );
}

/* ── Fleet ─────────────────────────────────────────────── */
function FleetTab({ noc, loading, error, onRetry }: { noc: NocKpi | null; loading: boolean; error: AdminError | null; onRetry: () => void }) {
  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBlock error={error} onRetry={onRetry} />;
  if (!noc) return <NoData title="Fleet(NOC) 데이터 없음" description="admin_noc_kpi 응답이 없습니다." />;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <AdminStatCard label="총 매장" value={NUM(noc.total_stores)} icon={<Server size={16} />} tone="primary" />
        <AdminStatCard label="온라인" value={NUM(noc.online_stores)} icon={<Wifi size={16} />} tone="success" />
        <AdminStatCard label="오프라인" value={NUM(noc.offline_stores)} icon={<WifiOff size={16} />} tone="danger" />
        <AdminStatCard label="24h Idle" value={NUM(noc.idle_24h)} icon={<Activity size={16} />} tone="warning" />
        <AdminStatCard label="Heartbeat 오류" value={NUM(noc.heartbeat_errors)} icon={<AlertTriangle size={16} />} tone="danger" />
        <AdminStatCard label="Player 오류" value={NUM(noc.player_errors)} icon={<AlertTriangle size={16} />} tone="danger" />
        <AdminStatCard label="오늘 Incident" value={NUM(noc.today_incidents)} icon={<AlertTriangle size={16} />} tone="danger" />
        <AdminStatCard label="오늘 Recovery" value={NUM(noc.today_recovered)} icon={<ShieldCheck size={16} />} tone="success" />
      </div>
      <p className="text-[10px] text-ink-dim">Fleet 값은 기존 admin_noc_kpi(0385 NOC) 를 재사용합니다. Blast Radius/Warning/Critical 세부는 NOC 패널(admin_noc_active_alerts)에서 확인하세요.</p>
    </div>
  );
}

/* ── Stores ────────────────────────────────────────────── */
const HEALTH_TONE_HEX: Record<string, string> = { green: '#10b981', yellow: '#f59e0b', orange: '#f97316', red: '#ef4444' };
function StoresTab({ stores, loading, error, onRetry }: { stores: NocStoreHealthRow[] | null; loading: boolean; error: AdminError | null; onRetry: () => void }) {
  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBlock error={error} onRetry={onRetry} />;
  if (!stores || stores.length === 0) return <AdminEmpty icon={<Inbox size={24} />} title="매장 Health 데이터 없음" description="admin_noc_store_health_list 결과가 없습니다." />;

  return (
    <div className="space-y-2">
      <p className="mb-1 flex items-center gap-1 text-xs font-bold"><ShieldCheck size={13} /> 매장 Health (기존 _noc_store_health_score 재사용)</p>
      <div className="space-y-1">
        {stores.map((s, i) => (
          <div key={String(s.store_id ?? i)} className="flex items-center justify-between gap-2 rounded bg-bg-deep px-3 py-1.5 text-xs">
            <span className="min-w-0 truncate text-ink">{String(s.store_name ?? s.store_id ?? '(매장)')}</span>
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: HEALTH_TONE_HEX[String(s.health_tone)] ?? '#737373' }} />
              <span className="tabular-nums font-bold text-ink">{s.score != null ? s.score : '—'}</span>
            </span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-ink-dim">Store Health/Score 는 기존 NOC 계산(_noc_store_health_score)을 그대로 사용합니다(재계산 없음).</p>
    </div>
  );
}

/* ── Timeline ──────────────────────────────────────────── */
function TimelineTab({ timeline, loading, error, range, onRange, onRetry }: {
  timeline: StreamingTimeline | null; loading: boolean; error: AdminError | null;
  range: StreamingTimelineRange; onRange: (r: StreamingTimelineRange) => void; onRetry: () => void;
}) {
  const rangeButtons = (
    <div className="flex flex-wrap gap-1">
      {RANGES.map((r) => (
        <button key={r.key} onClick={() => onRange(r.key)}
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${range === r.key ? 'bg-accent text-black' : 'bg-bg-deep text-ink-mute hover:text-ink'}`}>{r.label}</button>
      ))}
    </div>
  );

  let body: React.ReactNode;
  if (loading) body = <LoadingBlock />;
  else if (error || !timeline) body = <ErrorBlock error={error ?? classifyAdminError(null)} onRetry={onRetry} />;
  else if (timeline.points.length === 0) body = <AdminEmpty icon={<Inbox size={24} />} title="데이터 없음" />;
  else {
    const data = timeline.points.map((p) => ({ ...p, label: formatBucketLabel(p.bucket, timeline.unit), listen_min: Math.round(p.listen_seconds / 60) }));
    const minWidth = timeline.unit === 'day' && data.length > 31 ? data.length * 22 : undefined;
    const tickInterval = data.length > 31 ? Math.floor(data.length / 12) : 0;
    body = (
      <div className="overflow-x-auto">
        <div style={minWidth ? { minWidth } : undefined}>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#737373' }} axisLine={false} tickLine={false} interval={tickInterval} minTickGap={8} />
              <YAxis tick={{ fontSize: 10, fill: '#737373' }} axisLine={false} tickLine={false} width={34} allowDecimals={false} />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v: number, n: string) => [NUM(v), n]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="starts" name="재생 시작" fill="#a78bfa" radius={[4, 4, 0, 0]} maxBarSize={26} />
              <Line type="monotone" dataKey="completes" name="완료" stroke="#10b981" strokeWidth={1.8} dot={false} />
              <Line type="monotone" dataKey="skips" name="스킵" stroke="#f59e0b" strokeWidth={1.8} dot={false} />
              <Line type="monotone" dataKey="errors" name="오류" stroke="#ef4444" strokeWidth={1.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-xs font-bold"><TrendingUp size={13} /> 재생 추이 (신규 admin_streaming_timeline)</span>
        {rangeButtons}
      </div>
      {body}
      <p className="text-[10px] text-ink-dim">Buffer·Crossfade·Quality 시계열은 텔레메트리 미수집으로 제외했습니다(데이터 없음).</p>
    </div>
  );
}

/* ── Rankings ──────────────────────────────────────────── */
function RankingsTab({ summary, stores, loading, error, onRetry }: {
  summary: StreamingSummary | null; stores: NocStoreHealthRow[] | null; loading: boolean; error: AdminError | null; onRetry: () => void;
}) {
  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBlock error={error} onRetry={onRetry} />;

  const withScore = (stores ?? []).filter((s) => s.score != null);
  const stable = [...withScore].sort((a, b) => (b.score as number) - (a.score as number)).slice(0, 10);
  const risky = [...withScore].sort((a, b) => (a.score as number) - (b.score as number)).slice(0, 10);
  const unsupported = unsupportedList(summary?.support);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <RankTable title="TOP 안정 매장" icon={<ShieldCheck size={13} />} rows={stable} />
        <RankTable title="TOP 위험 매장" icon={<AlertTriangle size={13} />} rows={risky} />
      </div>
      <p className="text-[10px] text-ink-dim">매장 랭킹은 기존 NOC Health Score(재사용) 기준. TOP Buffer/Error/Recovery/Quality 랭킹은 해당 텔레메트리 미수집으로 데이터 없음.</p>

      <div>
        <p className="mb-1.5 flex items-center gap-1 text-xs font-bold"><ListMusic size={13} /> 미수집 지표 (데이터 없음)</p>
        <div className="flex flex-wrap gap-1.5">
          {unsupported.map((u) => <AdminBadge key={u} tone="neutral" size="sm">{u}</AdminBadge>)}
        </div>
      </div>
    </div>
  );
}

function RankTable({ title, icon, rows }: { title: string; icon: React.ReactNode; rows: NocStoreHealthRow[] }) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1 text-xs font-bold">{icon} {title}</p>
      {rows.length === 0 ? <AdminEmpty icon={<Inbox size={18} />} title="데이터 없음" /> : (
        <div className="space-y-0.5">
          {rows.map((s, i) => (
            <div key={String(s.store_id ?? i)} className="flex items-center justify-between gap-2 rounded bg-bg-deep px-2 py-1 text-[11px]">
              <span className="min-w-0 truncate"><span className="mr-1.5 text-ink-dim">{i + 1}</span><span className="text-ink">{String(s.store_name ?? s.store_id ?? '(매장)')}</span></span>
              <span className="shrink-0 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: HEALTH_TONE_HEX[String(s.health_tone)] ?? '#737373' }} />
                <span className="tabular-nums font-bold text-ink">{s.score}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
