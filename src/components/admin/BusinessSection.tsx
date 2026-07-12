/**
 * BusinessSection — Business Intelligence Dashboard (Phase ADMIN-BUSINESS-1).
 *
 * PR #362~#366 위에 이어 사업자/브랜드/매장/Player/계약/운영 Lifecycle 을 실제
 * 운영 데이터로 분석한다. 8개 내부 탭:
 *   Overview  — Business KPI + 사업자 Lifecycle 퍼널
 *   Growth    — 사업자/브랜드/매장/Player 시계열 (기간 선택)
 *   Brands    — 브랜드/프랜차이즈/본사 현황
 *   Stores    — 매장(franchise/business) 현황
 *   Players   — Player 온라인/오프라인/heartbeat/재생
 *   Contracts — 계약 현황 (대부분 데이터 없음 명시)
 *   Health    — 운영 Health Score (실데이터 신호만) + 제외 신호
 *   Rankings  — TOP 브랜드/매장/Player + 지원 매트릭스
 *
 * 자체 fetch·오류 격리 → 0476 미적용 시에도 기존 대시보드 정상. 희소 데이터 —
 * 없는 데이터는 "데이터 없음/미지원"으로 명시(추정 금지). 비율 0~100·Health 0~100.
 */
import { useEffect, useState } from 'react';
import {
  Building2, Store, MonitorSmartphone, Wifi, WifiOff, Radio, TrendingUp, Clock,
  RefreshCw, Inbox, Activity, Trophy, FileText, CircleSlash, HeartPulse,
} from 'lucide-react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { AdminCard, AdminStatCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import {
  fetchBusinessSummary, fetchBusinessFunnel, fetchBusinessGrowth, fetchBusinessHealth, fetchBusinessRankings,
  type BusinessSummary, type BusinessFunnel, type BusinessGrowth, type BusinessGrowthRange,
  type BusinessHealth, type BusinessRankings, type BusinessRankRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  formatKRW, formatPct, onlineRate, computeHealth, businessIntegrityWarnings,
  businessSupportMatrix, sortedHealthComponents, HEALTH_LEVEL_LABEL, HEALTH_LEVEL_TONE,
} from '@/lib/businessIntel';
import { computeFunnel, finalConversion, monotonicWarnings } from '@/lib/memberFunnel';
import { formatBucketLabel, relativeTimeKo, formatKstDateTime } from '@/lib/memberGrowth';

const NUM = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('ko-KR'));

const TONE_HEX = { success: '#10b981', warning: '#f59e0b', danger: '#ef4444', neutral: '#737373' } as const;
const SERIES = [
  { key: 'new_business', label: '사업자', color: '#a78bfa', type: 'bar' as const },
  { key: 'new_brands', label: '브랜드', color: '#60a5fa', type: 'line' as const },
  { key: 'new_stores', label: '매장', color: '#10b981', type: 'line' as const },
  { key: 'new_players', label: 'Player', color: '#f59e0b', type: 'line' as const },
];
const CHART_TOOLTIP_STYLE = { background: '#181818', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 } as const;

const RANGES: { key: BusinessGrowthRange; label: string }[] = [
  { key: '7d', label: '7일' }, { key: '30d', label: '30일' }, { key: '90d', label: '90일' }, { key: '12m', label: '12개월' },
];

type Tab = 'overview' | 'growth' | 'brands' | 'stores' | 'players' | 'contracts' | 'health' | 'rankings';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' }, { key: 'growth', label: 'Growth' }, { key: 'brands', label: 'Brands' },
  { key: 'stores', label: 'Stores' }, { key: 'players', label: 'Players' }, { key: 'contracts', label: 'Contracts' },
  { key: 'health', label: 'Health' }, { key: 'rankings', label: 'Rankings' },
];

export default function BusinessSection() {
  const [tab, setTab] = useState<Tab>('overview');

  const [summary, setSummary] = useState<BusinessSummary | null>(null);
  const [funnel, setFunnel] = useState<BusinessFunnel | null>(null);
  const [ovErr, setOvErr] = useState<AdminError | null>(null);
  const [ovLoading, setOvLoading] = useState(true);

  const [range, setRange] = useState<BusinessGrowthRange>('30d');
  const [growth, setGrowth] = useState<BusinessGrowth | null>(null);
  const [grErr, setGrErr] = useState<AdminError | null>(null);
  const [grLoading, setGrLoading] = useState(false);

  const [health, setHealth] = useState<BusinessHealth | null>(null);
  const [hErr, setHErr] = useState<AdminError | null>(null);
  const [hLoading, setHLoading] = useState(false);

  const [rankings, setRankings] = useState<BusinessRankings | null>(null);
  const [rkErr, setRkErr] = useState<AdminError | null>(null);
  const [rkLoading, setRkLoading] = useState(false);

  async function loadOverview() {
    setOvLoading(true); setOvErr(null);
    try { const [s, f] = await Promise.all([fetchBusinessSummary(), fetchBusinessFunnel()]); setSummary(s); setFunnel(f); }
    catch (e) { setOvErr(classifyAdminError(e)); } finally { setOvLoading(false); }
  }
  async function loadGrowth(r: BusinessGrowthRange) {
    setGrLoading(true); setGrErr(null);
    try { setGrowth(await fetchBusinessGrowth(r)); } catch (e) { setGrErr(classifyAdminError(e)); } finally { setGrLoading(false); }
  }
  async function loadHealth() {
    setHLoading(true); setHErr(null);
    try { setHealth(await fetchBusinessHealth()); } catch (e) { setHErr(classifyAdminError(e)); } finally { setHLoading(false); }
  }
  async function loadRankings() {
    setRkLoading(true); setRkErr(null);
    try { setRankings(await fetchBusinessRankings()); } catch (e) { setRkErr(classifyAdminError(e)); } finally { setRkLoading(false); }
  }

  useEffect(() => { void loadOverview(); }, []);
  useEffect(() => { if (tab === 'growth') void loadGrowth(range); }, [tab, range]);
  useEffect(() => {
    if (tab === 'health' && !health) void loadHealth();
    if (tab === 'rankings' && !rankings) void loadRankings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <AdminCard
      title="Business Intelligence"
      subtitle="사업자 · 브랜드 · 매장 · Player · 계약 · 운영 (KST 기준)"
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
      {tab === 'overview' && <OverviewTab summary={summary} funnel={funnel} loading={ovLoading} error={ovErr} onRetry={loadOverview} />}
      {tab === 'growth' && <GrowthTab growth={growth} loading={grLoading} error={grErr} range={range} onRange={setRange} onRetry={() => loadGrowth(range)} />}
      {tab === 'brands' && <BrandsTab s={summary} loading={ovLoading} error={ovErr} onRetry={loadOverview} />}
      {tab === 'stores' && <StoresTab s={summary} loading={ovLoading} error={ovErr} onRetry={loadOverview} />}
      {tab === 'players' && <PlayersTab s={summary} loading={ovLoading} error={ovErr} onRetry={loadOverview} />}
      {tab === 'contracts' && <ContractsTab s={summary} loading={ovLoading} error={ovErr} onRetry={loadOverview} />}
      {tab === 'health' && <HealthTab h={health} loading={hLoading} error={hErr} onRetry={loadHealth} />}
      {tab === 'rankings' && <RankingsTab r={rankings} loading={rkLoading} error={rkErr} onRetry={loadRankings} />}
    </AdminCard>
  );
}

/* ── 공통 ─────────────────────────────────────────────── */
function LoadingBlock() { return <div className="h-40 animate-pulse rounded-2xl bg-bg-deep" aria-busy="true" />; }
function ErrorBlock({ error, onRetry }: { error: AdminError; onRetry: () => void }) {
  return (
    <AdminAlert tone="warning" title="Business 데이터를 불러오지 못했어요" description={error.message}
      action={<button onClick={onRetry} className="inline-flex items-center gap-1 rounded-full bg-bg-card px-3 py-1.5 text-xs hover:bg-bg-hover"><RefreshCw size={12} /> 다시 시도</button>} />
  );
}

/* ── Overview ──────────────────────────────────────────── */
function OverviewTab({ summary, funnel, loading, error, onRetry }: { summary: BusinessSummary | null; funnel: BusinessFunnel | null; loading: boolean; error: AdminError | null; onRetry: () => void }) {
  if (loading) return <LoadingBlock />;
  if (error || !summary || !funnel) return <ErrorBlock error={error ?? classifyAdminError(null)} onRetry={onRetry} />;

  const warnings = [...businessIntegrityWarnings(summary), ...monotonicWarnings(funnel.steps)];
  const computed = computeFunnel(funnel.steps);
  const base = computed.find((s) => s.count != null)?.count ?? 0;

  return (
    <div className="space-y-4">
      {warnings.length > 0 && <AdminAlert tone="warning" title="Business 정합성 경고" description={warnings.join(' · ')} />}
      <AdminAlert tone="info" title="프랜차이즈 모델 안내" description="브랜드 1개가 여러 매장/Player 를 보유할 수 있어 사업자 수 ≥ 브랜드 수 ≥ 매장 수 가정은 적용하지 않습니다. 사업자 계정과 브랜드/매장 계층은 분리되어 집계됩니다." />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <AdminStatCard label="총 사업자" value={NUM(summary.total_business)} icon={<Building2 size={16} />} tone="primary" />
        <AdminStatCard label="오늘 가입" value={NUM(summary.today_signups)} icon={<Building2 size={16} />} tone="info" />
        <AdminStatCard label="이번달 가입" value={NUM(summary.month_signups)} icon={<Building2 size={16} />} tone="info" />
        <AdminStatCard label="활성 사업자" value={NUM(summary.active_business)} icon={<Building2 size={16} />} tone="success" hint="유료 구독" />
        <AdminStatCard label="비활성 사업자" value={NUM(summary.inactive_business)} icon={<CircleSlash size={16} />} tone="warning" />
        <AdminStatCard label="브랜드 수" value={NUM(summary.total_brands)} icon={<Trophy size={16} />} tone="primary" hint={`활성 ${NUM(summary.active_brands)}`} />
        <AdminStatCard label="매장 수" value={NUM(summary.total_stores)} icon={<Store size={16} />} tone="success" hint={`사업자 프로필 ${NUM(summary.business_stores)}`} />
        <AdminStatCard label="Player 수" value={NUM(summary.total_players)} icon={<MonitorSmartphone size={16} />} tone="primary" />
        <AdminStatCard label="온라인 Player" value={NUM(summary.online_players)} icon={<Wifi size={16} />} tone={summary.online_players > 0 ? 'success' : 'neutral'} hint={`≤${summary.online_cutoff_minutes}분`} />
        <AdminStatCard label="오프라인 Player" value={NUM(summary.offline_players)} icon={<WifiOff size={16} />} tone="danger" />
        <AdminStatCard label="오늘 신규 매장" value={NUM(summary.today_new_stores)} icon={<Store size={16} />} tone="info" />
        <AdminStatCard label="오늘 신규 Player" value={NUM(summary.today_new_players)} icon={<MonitorSmartphone size={16} />} tone="info" />
      </div>

      {/* 사업자 Lifecycle 퍼널 */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-xs font-bold">사업자 Lifecycle 퍼널</p>
          <span className="text-[10px] text-ink-dim">최종 전환율 {formatPct(finalConversion(funnel.steps))}</span>
        </div>
        <div className="space-y-1.5">
          {computed.map((s, i) => {
            const supported = s.supported && s.count != null;
            const width = supported && base > 0 ? Math.max(2, ((s.count as number) / base) * 100) : 0;
            return (
              <div key={s.key}>
                {i > 0 && supported && s.convFromPrev != null && (
                  <div className="pl-1 text-[10px] text-ink-dim">↓ <span style={{ color: TONE_HEX[s.tone] }} className="font-semibold">{formatPct(s.convFromPrev)}</span></div>
                )}
                <div className="flex items-center justify-between gap-2 rounded-lg px-3 py-2" style={{ background: supported ? `${TONE_HEX[s.tone]}22` : 'rgba(115,115,115,0.12)' }} title={s.note ?? undefined}>
                  <span className="flex items-center gap-2 text-xs font-semibold text-ink">{s.label}{!supported && <AdminBadge tone="neutral" size="sm">데이터 없음</AdminBadge>}</span>
                  {supported
                    ? <div className="flex items-center gap-2"><div className="hidden h-2 rounded-full sm:block" style={{ width: `${width}%`, minWidth: 8, maxWidth: 180, background: TONE_HEX[s.tone] }} /><span className="text-sm font-bold tabular-nums text-ink">{NUM(s.count)}</span></div>
                    : <span className="text-[10px] text-ink-dim">{s.note}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Growth ────────────────────────────────────────────── */
function GrowthTab({ growth, loading, error, range, onRange, onRetry }: {
  growth: BusinessGrowth | null; loading: boolean; error: AdminError | null;
  range: BusinessGrowthRange; onRange: (r: BusinessGrowthRange) => void; onRetry: () => void;
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
  else if (error || !growth) body = <ErrorBlock error={error ?? classifyAdminError(null)} onRetry={onRetry} />;
  else if (growth.points.length === 0) body = <AdminEmpty icon={<Inbox size={24} />} title="데이터 없음" />;
  else {
    const data = growth.points.map((p) => ({ ...p, label: formatBucketLabel(p.bucket, growth.unit) }));
    const minWidth = growth.unit === 'day' && data.length > 31 ? data.length * 22 : undefined;
    const tickInterval = data.length > 31 ? Math.floor(data.length / 12) : 0;
    body = (
      <div className="overflow-x-auto">
        <div style={minWidth ? { minWidth } : undefined}>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#737373' }} axisLine={false} tickLine={false} interval={tickInterval} minTickGap={8} />
              <YAxis tick={{ fontSize: 10, fill: '#737373' }} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v: number, n: string) => [NUM(v), n]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {SERIES.map((s) => s.type === 'bar'
                ? <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={28} />
                : <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={1.8} dot={false} />)}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-xs font-bold"><TrendingUp size={13} /> 사업자·브랜드·매장·Player 추이</span>
        {rangeButtons}
      </div>
      {body}
    </div>
  );
}

/* ── Brands ────────────────────────────────────────────── */
function BrandsTab({ s, loading, error, onRetry }: { s: BusinessSummary | null; loading: boolean; error: AdminError | null; onRetry: () => void }) {
  if (loading) return <LoadingBlock />;
  if (error || !s) return <ErrorBlock error={error ?? classifyAdminError(null)} onRetry={onRetry} />;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <AdminStatCard label="총 브랜드" value={NUM(s.total_brands)} icon={<Trophy size={16} />} tone="primary" />
        <AdminStatCard label="활성 브랜드" value={NUM(s.active_brands)} icon={<Trophy size={16} />} tone="success" />
        <AdminStatCard label="비활성 브랜드" value={NUM(s.total_brands - s.active_brands)} icon={<CircleSlash size={16} />} tone="neutral" />
        <AdminStatCard label="프랜차이즈" value={NUM(s.total_franchises)} icon={<Building2 size={16} />} tone="info" />
        <AdminStatCard label="본사(Enterprise)" value={NUM(s.total_enterprises)} icon={<Building2 size={16} />} tone="primary" />
      </div>
      <p className="text-[10px] text-ink-dim">브랜드별 매장/Player/스트리밍/성장은 Rankings 탭. 브랜드별 평균 운영률은 Player heartbeat 스냅샷만 존재해 시계열 운영률은 미지원.</p>
    </div>
  );
}

/* ── Stores ────────────────────────────────────────────── */
function StoresTab({ s, loading, error, onRetry }: { s: BusinessSummary | null; loading: boolean; error: AdminError | null; onRetry: () => void }) {
  if (loading) return <LoadingBlock />;
  if (error || !s) return <ErrorBlock error={error ?? classifyAdminError(null)} onRetry={onRetry} />;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <AdminStatCard label="총 매장(프랜차이즈)" value={NUM(s.total_stores)} icon={<Store size={16} />} tone="primary" />
        <AdminStatCard label="사업자 매장(프로필)" value={NUM(s.business_stores)} icon={<Store size={16} />} tone="info" />
        <AdminStatCard label="오늘 신규" value={NUM(s.today_new_stores)} icon={<Store size={16} />} tone="success" />
        <AdminStatCard label="이번달 신규" value={NUM(s.month_new_stores)} icon={<Store size={16} />} tone="success" />
        <AdminStatCard label="온라인(Player)" value={NUM(s.online_players)} icon={<Wifi size={16} />} tone={s.online_players > 0 ? 'success' : 'neutral'} />
        <AdminStatCard label="오프라인(Player)" value={NUM(s.offline_players)} icon={<WifiOff size={16} />} tone="danger" />
      </div>
      <AdminAlert tone="info" title="매장 운영 지표 미지원" description="24시간 정상 운영·평균 재생시간·Streaming Quality·Buffer·Skip·Error 는 매장 단위 운영/품질 이력 테이블이 없어 산출할 수 없습니다(추정 금지)." />
    </div>
  );
}

/* ── Players ───────────────────────────────────────────── */
function PlayersTab({ s, loading, error, onRetry }: { s: BusinessSummary | null; loading: boolean; error: AdminError | null; onRetry: () => void }) {
  if (loading) return <LoadingBlock />;
  if (error || !s) return <ErrorBlock error={error ?? classifyAdminError(null)} onRetry={onRetry} />;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <AdminStatCard label="등록 Player" value={NUM(s.total_players)} icon={<MonitorSmartphone size={16} />} tone="primary" />
        <AdminStatCard label="온라인" value={NUM(s.online_players)} icon={<Wifi size={16} />} tone={s.online_players > 0 ? 'success' : 'neutral'} hint={`온라인율 ${formatPct(onlineRate(s))}`} />
        <AdminStatCard label="오프라인" value={NUM(s.offline_players)} icon={<WifiOff size={16} />} tone="danger" />
        <AdminStatCard label="Heartbeat 수신" value={NUM(s.heartbeat_players)} icon={<Activity size={16} />} tone="info" />
        <AdminStatCard label="Heartbeat 없음" value={NUM(s.total_players - s.heartbeat_players)} icon={<CircleSlash size={16} />} tone="warning" />
        <AdminStatCard label="재생 중" value={NUM(s.playing_players)} icon={<Radio size={16} />} tone="success" />
        <AdminStatCard label="Idle" value={NUM(s.total_players - s.playing_players)} icon={<Clock size={16} />} tone="neutral" />
      </div>
      <AdminAlert tone="info" title="Player 운영 이력 미지원" description={`온라인 판정은 last_seen ≤ ${s.online_cutoff_minutes}분. 평균 Uptime·평균 Recovery·Heartbeat History 는 heartbeat 이력 테이블이 없어(last_seen 스냅샷만) 미지원입니다.`} />
    </div>
  );
}

/* ── Contracts ─────────────────────────────────────────── */
function ContractsTab({ s, loading, error, onRetry }: { s: BusinessSummary | null; loading: boolean; error: AdminError | null; onRetry: () => void }) {
  if (loading) return <LoadingBlock />;
  if (error || !s) return <ErrorBlock error={error ?? classifyAdminError(null)} onRetry={onRetry} />;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <AdminStatCard label="월 요금(기본)" value={formatKRW(s.monthly_fee_default)} icon={<FileText size={16} />} tone="primary" hint="브랜드 등록 기본값" />
        <AdminStatCard label="활성 사업자" value={NUM(s.active_business)} icon={<Building2 size={16} />} tone="success" hint="유료 구독 기준" />
      </div>
      <AdminAlert tone="info" title="사업자 계약 이력 미지원" description="사업자 전용 계약(완료/대기/종료/만료예정/자동·수동 갱신/평균 계약금액) 테이블이 없습니다. 브랜드 등록 기본 월 요금과 활성 구독(사업자)만 제공하며, 나머지는 데이터 없음으로 표시합니다(추정 금지)." />
    </div>
  );
}

/* ── Health ────────────────────────────────────────────── */
function HealthTab({ h, loading, error, onRetry }: { h: BusinessHealth | null; loading: boolean; error: AdminError | null; onRetry: () => void }) {
  if (loading) return <LoadingBlock />;
  if (error || !h) return <ErrorBlock error={error ?? classifyAdminError(null)} onRetry={onRetry} />;

  const result = computeHealth(h);
  const comps = sortedHealthComponents(h.components);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="rounded-2xl px-4 py-3" style={{ background: `${TONE_HEX[HEALTH_LEVEL_TONE[result.level]]}22` }}>
          <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-ink-dim"><HeartPulse size={12} /> Business Health</p>
          <p className="text-2xl font-extrabold tabular-nums text-ink">{result.score == null ? '—' : result.score.toFixed(1)}</p>
          <AdminBadge tone={HEALTH_LEVEL_TONE[result.level]} size="sm">{HEALTH_LEVEL_LABEL[result.level]}</AdminBadge>
        </div>
        <div className="text-[11px] text-ink-mute">
          <p>사용 신호 {result.usedCount}개 평균 · 제외 {result.excludedCount}개</p>
          <p className="mt-1 text-ink-dim">데이터 있는 신호만 0~100 평균. 없는 신호는 추정하지 않고 제외합니다.</p>
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-bold">Health 신호</p>
        <div className="space-y-1">
          {comps.map((c) => (
            <div key={c.key} className="flex items-center justify-between gap-2 rounded-lg bg-bg-deep px-3 py-1.5 text-xs">
              <span className="flex items-center gap-2 text-ink">{c.label}{!c.available && <AdminBadge tone="neutral" size="sm">데이터 없음</AdminBadge>}</span>
              <span className="tabular-nums text-ink-mute">
                {c.available && c.score != null
                  ? <><span className="font-bold text-ink">{c.score}</span> <span className="text-ink-dim">({c.detail})</span></>
                  : '—'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {h.excluded.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-bold">제외된 신호 (데이터 없음)</p>
          <div className="flex flex-wrap gap-1.5">
            {h.excluded.map((e) => <AdminBadge key={e} tone="neutral" size="sm">{e}</AdminBadge>)}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Rankings ──────────────────────────────────────────── */
function RankTable({ title, icon, rows, valueFmt }: { title: string; icon: React.ReactNode; rows: BusinessRankRow[]; valueFmt: (r: BusinessRankRow) => string }) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1 text-xs font-bold">{icon} {title}</p>
      {rows.length === 0 ? <AdminEmpty icon={<Inbox size={18} />} title="데이터 없음" /> : (
        <div className="space-y-0.5">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center justify-between gap-2 rounded bg-bg-deep px-2 py-1 text-[11px]">
              <span className="min-w-0 truncate"><span className="mr-1.5 text-ink-dim">{i + 1}</span><span className="text-ink">{r.name ?? '—'}</span></span>
              <span className="shrink-0 tabular-nums font-bold text-ink">{valueFmt(r)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RankingsTab({ r, loading, error, onRetry }: { r: BusinessRankings | null; loading: boolean; error: AdminError | null; onRetry: () => void }) {
  if (loading) return <LoadingBlock />;
  if (error || !r) return <ErrorBlock error={error ?? classifyAdminError(null)} onRetry={onRetry} />;

  const support = businessSupportMatrix(r.support);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <RankTable title="브랜드별 매장 수" icon={<Store size={13} />} rows={r.top_brand_stores} valueFmt={(x) => `${NUM(x.value ?? 0)}개`} />
        <RankTable title="브랜드별 Player 수" icon={<MonitorSmartphone size={13} />} rows={r.top_brand_players} valueFmt={(x) => `${NUM(x.value ?? 0)}개`} />
        <RankTable title="최근 접속 Player" icon={<Wifi size={13} />} rows={r.recent_players} valueFmt={(x) => x.last_seen ? relativeTimeKo(x.last_seen) : '—'} />
      </div>
      {r.recent_players.some((p) => p.last_seen) && (
        <p className="text-[10px] text-ink-dim">최근 접속: {r.recent_players.filter((p) => p.last_seen).map((p) => formatKstDateTime(p.last_seen)).slice(0, 1).join('')} (가장 최근)</p>
      )}
      <div>
        <p className="mb-1.5 text-xs font-bold">지표 지원 여부</p>
        <div className="flex flex-wrap gap-1.5">
          {support.map((s) => (
            <AdminBadge key={s.key} tone={s.supported ? 'success' : 'neutral'} size="sm">{s.label} {s.supported ? '지원' : '데이터 없음'}</AdminBadge>
          ))}
        </div>
      </div>
    </div>
  );
}
