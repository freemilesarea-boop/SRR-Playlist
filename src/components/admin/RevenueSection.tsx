/**
 * RevenueSection — Revenue Intelligence Dashboard (Phase ADMIN-REVENUE-1).
 *
 * PR #362·#363·#364 위에 이어 SaaS Revenue 지표(MRR/ARR/ARPU/ARPPU/Growth/Churn/
 * Forecast)를 실제 payment_orders/subscriptions 기반으로 분석한다. 5개 내부 탭:
 *   Overview — 핵심 Revenue KPI + 정합성 경고
 *   Trend    — 매출/결제/구독 시계열 (기간 선택)
 *   Plans    — 플랜별/유형별 매출 · 플랜 분석 · Churn · Revenue Funnel
 *   Forecast — 이번달 예상 매출 · 다음달 MRR · ARR (단순 예측, AI 없음)
 *   Top      — TOP 결제 회원/플랜/매출일 + 지원 여부 매트릭스
 *
 * 자체 fetch·오류 격리 → 0474 미적용 시에도 기존 대시보드 정상. 매출 원천은
 * payment_orders(paid, 환불 제외). 미지원 지표는 "데이터 없음"으로 명시(추정 금지).
 */
import { useEffect, useState } from 'react';
import {
  Wallet, TrendingUp, TrendingDown, Minus, Repeat, CreditCard, RefreshCw, Inbox,
  BarChart3, PieChart as PieIcon, LineChart as LineIcon, Trophy, CircleSlash, Coins,
} from 'lucide-react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { AdminCard, AdminStatCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import {
  fetchRevenueKpis, fetchRevenueTrend, fetchRevenueBreakdown, fetchRevenueForecast,
  type RevenueKpis, type RevenueTrend, type RevenueTrendRange, type RevenueBreakdown, type RevenueForecast,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  formatKRW, formatKRWShort, formatPct, deriveRevenueKpis, churnRate,
  revenueIntegrityWarnings, supportMatrix, ratio,
} from '@/lib/revenueIntel';
import { computeFunnel } from '@/lib/memberFunnel';
import { formatBucketLabel } from '@/lib/memberGrowth';

const NUM = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('ko-KR'));

const TONE_HEX = { success: '#10b981', warning: '#f59e0b', danger: '#ef4444', neutral: '#737373' } as const;
const REV_COLOR = '#10b981';
const SUB_COLOR = '#a78bfa';
const PLAN_COLORS = ['#a78bfa', '#60a5fa', '#10b981', '#f59e0b', '#f472b6', '#737373'];

const CHART_TOOLTIP_STYLE = {
  background: '#181818', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11,
} as const;

const RANGES: { key: RevenueTrendRange; label: string }[] = [
  { key: '7d', label: '7일' }, { key: '30d', label: '30일' }, { key: '90d', label: '90일' }, { key: '12m', label: '12개월' },
];

type Tab = 'overview' | 'trend' | 'plans' | 'forecast' | 'top';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'trend', label: 'Trend' },
  { key: 'plans', label: 'Plans' },
  { key: 'forecast', label: 'Forecast' },
  { key: 'top', label: 'Top Revenue' },
];

export default function RevenueSection() {
  const [tab, setTab] = useState<Tab>('overview');

  const [kpis, setKpis] = useState<RevenueKpis | null>(null);
  const [kpiErr, setKpiErr] = useState<AdminError | null>(null);
  const [kpiLoading, setKpiLoading] = useState(true);

  const [range, setRange] = useState<RevenueTrendRange>('30d');
  const [trend, setTrend] = useState<RevenueTrend | null>(null);
  const [trendErr, setTrendErr] = useState<AdminError | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);

  const [breakdown, setBreakdown] = useState<RevenueBreakdown | null>(null);
  const [bdErr, setBdErr] = useState<AdminError | null>(null);
  const [bdLoading, setBdLoading] = useState(false);

  const [forecast, setForecast] = useState<RevenueForecast | null>(null);
  const [fcErr, setFcErr] = useState<AdminError | null>(null);
  const [fcLoading, setFcLoading] = useState(false);

  async function loadKpis() {
    setKpiLoading(true); setKpiErr(null);
    try { setKpis(await fetchRevenueKpis()); } catch (e) { setKpiErr(classifyAdminError(e)); } finally { setKpiLoading(false); }
  }
  async function loadTrend(r: RevenueTrendRange) {
    setTrendLoading(true); setTrendErr(null);
    try { setTrend(await fetchRevenueTrend(r)); } catch (e) { setTrendErr(classifyAdminError(e)); } finally { setTrendLoading(false); }
  }
  async function loadBreakdown() {
    setBdLoading(true); setBdErr(null);
    try { setBreakdown(await fetchRevenueBreakdown()); } catch (e) { setBdErr(classifyAdminError(e)); } finally { setBdLoading(false); }
  }
  async function loadForecast() {
    setFcLoading(true); setFcErr(null);
    try { setForecast(await fetchRevenueForecast()); } catch (e) { setFcErr(classifyAdminError(e)); } finally { setFcLoading(false); }
  }

  useEffect(() => { void loadKpis(); }, []);
  useEffect(() => {
    if (tab === 'trend') void loadTrend(range);
  }, [tab, range]);
  useEffect(() => {
    if ((tab === 'plans' || tab === 'top') && !breakdown) void loadBreakdown();
    if (tab === 'forecast' && !forecast) void loadForecast();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <AdminCard
      title="Revenue Intelligence"
      subtitle="MRR · ARR · 성장 · Churn · Forecast (KST · payment_orders 기준)"
      action={
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${tab === t.key ? 'bg-accent text-black' : 'bg-bg-deep text-ink-mute hover:text-ink'}`}>
              {t.label}
            </button>
          ))}
        </div>
      }
      bodyClassName="space-y-4"
    >
      {tab === 'overview' && <OverviewTab kpis={kpis} loading={kpiLoading} error={kpiErr} onRetry={loadKpis} />}
      {tab === 'trend' && <TrendTab trend={trend} loading={trendLoading} error={trendErr} range={range} onRange={setRange} onRetry={() => loadTrend(range)} />}
      {tab === 'plans' && <PlansTab breakdown={breakdown} loading={bdLoading} error={bdErr} onRetry={loadBreakdown} />}
      {tab === 'forecast' && <ForecastTab forecast={forecast} loading={fcLoading} error={fcErr} onRetry={loadForecast} />}
      {tab === 'top' && <TopTab breakdown={breakdown} loading={bdLoading} error={bdErr} onRetry={loadBreakdown} />}
    </AdminCard>
  );
}

/* ── 공통 ─────────────────────────────────────────────── */
function LoadingBlock() { return <div className="h-40 animate-pulse rounded-2xl bg-bg-deep" aria-busy="true" />; }
function ErrorBlock({ error, onRetry }: { error: AdminError; onRetry: () => void }) {
  return (
    <AdminAlert tone="warning" title="Revenue 데이터를 불러오지 못했어요" description={error.message}
      action={<button onClick={onRetry} className="inline-flex items-center gap-1 rounded-full bg-bg-card px-3 py-1.5 text-xs hover:bg-bg-hover"><RefreshCw size={12} /> 다시 시도</button>} />
  );
}
function deltaTone(t: 'success' | 'danger' | 'neutral') {
  return t === 'success' ? 'success' as const : t === 'danger' ? 'danger' as const : 'neutral' as const;
}

/* ── Overview ──────────────────────────────────────────── */
function OverviewTab({ kpis, loading, error, onRetry }: { kpis: RevenueKpis | null; loading: boolean; error: AdminError | null; onRetry: () => void }) {
  if (loading) return <LoadingBlock />;
  if (error || !kpis) return <ErrorBlock error={error ?? classifyAdminError(null)} onRetry={onRetry} />;

  const d = deriveRevenueKpis(kpis);
  const warnings = revenueIntegrityWarnings(kpis);
  const GrowthIcon = d.revenueGrowth.tone === 'danger' ? TrendingDown : d.revenueGrowth.tone === 'success' ? TrendingUp : Minus;

  return (
    <div className="space-y-3">
      {warnings.length > 0 && <AdminAlert tone="warning" title="Revenue 정합성 경고" description={warnings.join(' · ')} />}

      {/* 매출 스냅샷 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <AdminStatCard label="오늘 매출" value={formatKRW(kpis.today_revenue)} icon={<Wallet size={16} />} tone="success" hint={`어제 ${formatKRW(kpis.yesterday_revenue)}`} />
        <AdminStatCard label="이번주 매출" value={formatKRW(kpis.week_revenue)} icon={<Coins size={16} />} tone="success" />
        <AdminStatCard label="이번달 매출" value={formatKRW(kpis.month_revenue)} icon={<Coins size={16} />} tone="success" hint={`지난달 ${formatKRW(kpis.last_month_revenue)}`} />
        <AdminStatCard label="이번달 예상" value={formatKRW(kpis.month_forecast)} icon={<TrendingUp size={16} />} tone="info" hint="일평균 run-rate" />
      </div>

      {/* SaaS 핵심 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <AdminStatCard label="MRR" value={formatKRW(kpis.mrr)} icon={<Repeat size={16} />} tone="primary" hint="활성 월구독 합" />
        <AdminStatCard label="ARR" value={formatKRW(kpis.arr)} icon={<TrendingUp size={16} />} tone="primary" hint="MRR × 12" />
        <AdminStatCard label="Revenue Growth" value={d.revenueGrowth.text} icon={<GrowthIcon size={16} />} tone={deltaTone(d.revenueGrowth.tone)} hint="이번달 vs 지난달" />
        <AdminStatCard label="Subscription Growth" value={d.subscriptionGrowth.text} icon={<TrendingUp size={16} />} tone={deltaTone(d.subscriptionGrowth.tone)} hint="신규 구독 MoM" />
        <AdminStatCard label="ARPU" value={formatKRW(d.arpu)} icon={<CreditCard size={16} />} tone="info" hint={`총매출/활성회원 ${NUM(kpis.active_members)}`} />
        <AdminStatCard label="ARPPU" value={formatKRW(d.arppu)} icon={<CreditCard size={16} />} tone="info" hint={`총매출/결제회원 ${NUM(kpis.paying_users)}`} />
        <AdminStatCard label="평균 결제금액" value={formatKRW(kpis.avg_payment_amount)} icon={<Coins size={16} />} tone="neutral" />
        <AdminStatCard label="총 누적 매출" value={formatKRW(kpis.total_revenue)} icon={<Wallet size={16} />} tone="success" />
      </div>

      {/* 결제/구독 상태 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <AdminStatCard label="신규 결제" value={NUM(kpis.new_payments)} icon={<CreditCard size={16} />} tone="success" />
        <AdminStatCard label="재결제" value={NUM(kpis.renewal_payments)} icon={<Repeat size={16} />} tone="success" />
        <AdminStatCard label="결제 실패" value={NUM(kpis.failed_payments)} icon={<CircleSlash size={16} />} tone="danger" hint={`성공률 ${formatPct(d.paymentSuccessRate)}`} />
        <AdminStatCard label="환불" value={NUM(kpis.refund_count)} icon={<RefreshCw size={16} />} tone="warning" hint={`${formatKRW(kpis.refund_amount)} · ${formatPct(d.refundRate)}`} />
        <AdminStatCard label="활성 구독" value={NUM(kpis.active_subscriptions)} icon={<Repeat size={16} />} tone="primary" />
        <AdminStatCard label="종료 예정" value={NUM(kpis.ending_subscriptions)} icon={<TrendingDown size={16} />} tone="warning" />
        <AdminStatCard label="미결제 회원" value={NUM(kpis.unpaid_users)} icon={<CircleSlash size={16} />} tone="warning" />
        <AdminStatCard label="프로모션 결제" value={NUM(kpis.promo_count)} icon={<Coins size={16} />} tone="neutral" />
      </div>
    </div>
  );
}

/* ── Trend ─────────────────────────────────────────────── */
function TrendTab({ trend, loading, error, range, onRange, onRetry }: {
  trend: RevenueTrend | null; loading: boolean; error: AdminError | null;
  range: RevenueTrendRange; onRange: (r: RevenueTrendRange) => void; onRetry: () => void;
}) {
  const rangeButtons = (
    <div className="flex flex-wrap gap-1">
      {RANGES.map((r) => (
        <button key={r.key} onClick={() => onRange(r.key)}
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${range === r.key ? 'bg-accent text-black' : 'bg-bg-deep text-ink-mute hover:text-ink'}`}>
          {r.label}
        </button>
      ))}
    </div>
  );

  let body: React.ReactNode;
  if (loading) body = <LoadingBlock />;
  else if (error || !trend) body = <ErrorBlock error={error ?? classifyAdminError(null)} onRetry={onRetry} />;
  else if (trend.points.length === 0 || trend.total_revenue === 0) body = <AdminEmpty icon={<Inbox size={24} />} title="매출 데이터 없음" description="선택한 기간에 결제가 없어요." />;
  else {
    const data = trend.points.map((p) => ({ ...p, label: formatBucketLabel(p.bucket, trend.unit) }));
    const minWidth = trend.unit === 'day' && data.length > 31 ? data.length * 22 : undefined;
    const tickInterval = data.length > 31 ? Math.floor(data.length / 12) : 0;
    body = (
      <div className="overflow-x-auto">
        <div style={minWidth ? { minWidth } : undefined}>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#737373' }} axisLine={false} tickLine={false} interval={tickInterval} minTickGap={8} />
              <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#737373' }} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => formatKRWShort(v)} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#737373' }} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={trendTooltip} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="left" dataKey="revenue" name="매출" fill={REV_COLOR} radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Line yAxisId="right" type="monotone" dataKey="payments" name="결제건수" stroke="#f59e0b" strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="active_subs" name="활성구독" stroke={SUB_COLOR} strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="refunds" name="환불" stroke="#ef4444" strokeWidth={1.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-xs font-bold"><LineIcon size={13} /> 매출 · 결제 · 구독 추이</span>
        {rangeButtons}
      </div>
      {body}
      <p className="text-[10px] text-ink-dim">활성구독은 각 시점 종료 기준 재구성(생성 ≤ 시점 & 미취소/취소 이후). 매출은 paid·환불 제외.</p>
    </div>
  );
}
function trendTooltip(value: number, name: string): [string, string] {
  if (name === '매출') return [formatKRW(value), name];
  return [value.toLocaleString('ko-KR'), name];
}

/* ── Plans ─────────────────────────────────────────────── */
function PlansTab({ breakdown, loading, error, onRetry }: { breakdown: RevenueBreakdown | null; loading: boolean; error: AdminError | null; onRetry: () => void }) {
  if (loading) return <LoadingBlock />;
  if (error || !breakdown) return <ErrorBlock error={error ?? classifyAdminError(null)} onRetry={onRetry} />;

  const planTotal = breakdown.by_plan.reduce((s, r) => s + r.revenue, 0);
  const cr = churnRate(breakdown);
  const funnel = computeFunnel(breakdown.revenue_funnel);
  const funnelBase = funnel.find((s) => s.count != null)?.count ?? 0;

  return (
    <div className="space-y-4">
      {/* 플랜별 매출 */}
      <div>
        <p className="mb-1.5 flex items-center gap-1 text-xs font-bold"><PieIcon size={13} /> 플랜별 매출</p>
        <div className="space-y-1">
          {breakdown.by_plan.map((r, i) => (
            <div key={r.key} className="flex items-center gap-2 text-xs">
              <span className="w-24 shrink-0 truncate text-ink-mute">{r.key}</span>
              <div className="h-2 rounded-full" style={{ width: `${planTotal > 0 ? Math.max(2, (r.revenue / planTotal) * 100) : 0}%`, background: PLAN_COLORS[i % PLAN_COLORS.length], minWidth: 8 }} />
              <span className="tabular-nums font-semibold text-ink">{formatKRW(r.revenue)}</span>
              <span className="tabular-nums text-ink-dim">({NUM(r.count)}건)</span>
            </div>
          ))}
        </div>
      </div>

      {/* 회원 유형별 매출 */}
      <div>
        <p className="mb-1.5 flex items-center gap-1 text-xs font-bold"><BarChart3 size={13} /> 회원 유형별 매출</p>
        <div className="grid grid-cols-3 gap-2">
          {breakdown.by_type.map((r) => (
            <div key={r.key} className="rounded-lg bg-bg-deep px-3 py-2">
              <p className="text-[10px] text-ink-dim">{r.key}</p>
              <p className="text-sm font-bold tabular-nums text-ink">{formatKRW(r.revenue)}</p>
              <p className="text-[10px] text-ink-dim">{NUM(r.count)}건</p>
            </div>
          ))}
        </div>
      </div>

      {/* 플랜 분석 */}
      <div className="overflow-x-auto">
        <p className="mb-1.5 text-xs font-bold">플랜 분석</p>
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead>
            <tr className="border-b border-line/10 text-[10px] uppercase tracking-wider text-ink-dim">
              <th className="px-2 py-2 font-semibold">플랜</th>
              <th className="px-2 py-2 text-right font-semibold">구독</th>
              <th className="px-2 py-2 text-right font-semibold">활성</th>
              <th className="px-2 py-2 text-right font-semibold">취소</th>
              <th className="px-2 py-2 text-right font-semibold">매출</th>
              <th className="px-2 py-2 text-right font-semibold">평균 유지</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.plan_analysis.map((p) => (
              <tr key={p.key} className="border-b border-line/5 last:border-0">
                <td className="px-2 py-2 font-semibold text-ink">{p.key}</td>
                <td className="px-2 py-2 text-right tabular-nums text-ink-mute">{NUM(p.subs)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-ink-mute">{NUM(p.active)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-ink-mute">{NUM(p.canceled)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-ink">{formatKRW(p.revenue)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-ink-mute">{p.avg_retention_days == null ? '—' : `${NUM(p.avg_retention_days)}일`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Churn */}
      <div>
        <p className="mb-1.5 flex items-center gap-1 text-xs font-bold"><TrendingDown size={13} /> Churn</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <AdminStatCard label="Churn Rate" value={formatPct(cr)} tone={cr != null && cr > 10 ? 'danger' : 'neutral'} hint="취소/(활성+취소)" />
          <AdminStatCard label="취소" value={NUM(breakdown.churn.canceled)} tone="danger" />
          <AdminStatCard label="종료 예정" value={NUM(breakdown.churn.cancel_scheduled)} tone="warning" />
          <AdminStatCard label="결제 실패" value={NUM(breakdown.churn.failed_payments)} tone="danger" />
          <AdminStatCard label="환불" value={NUM(breakdown.churn.refunds)} tone="warning" />
        </div>
        <p className="mt-1 text-[10px] text-ink-dim">스냅샷 기준 · 월별 리텐션(3/6/12개월)은 코호트 이력 부재로 미지원.</p>
      </div>

      {/* Revenue Funnel */}
      <div>
        <p className="mb-1.5 text-xs font-bold">Revenue Funnel</p>
        <div className="space-y-1.5">
          {funnel.map((s, i) => {
            const supported = s.supported && s.count != null;
            const width = supported && funnelBase > 0 ? Math.max(2, ((s.count as number) / funnelBase) * 100) : 0;
            return (
              <div key={s.key}>
                {i > 0 && supported && s.convFromPrev != null && (
                  <div className="pl-1 text-[10px] text-ink-dim">↓ <span style={{ color: TONE_HEX[s.tone] }} className="font-semibold">{formatPct(s.convFromPrev)}</span></div>
                )}
                <div className="flex items-center justify-between gap-2 rounded-lg px-3 py-2" style={{ background: supported ? `${TONE_HEX[s.tone]}22` : 'rgba(115,115,115,0.12)' }} title={s.note ?? undefined}>
                  <span className="flex items-center gap-2 text-xs font-semibold text-ink">{s.label}{!supported && <AdminBadge tone="neutral" size="sm">미지원</AdminBadge>}</span>
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

/* ── Forecast ──────────────────────────────────────────── */
function ForecastTab({ forecast, loading, error, onRetry }: { forecast: RevenueForecast | null; loading: boolean; error: AdminError | null; onRetry: () => void }) {
  if (loading) return <LoadingBlock />;
  if (error || !forecast) return <ErrorBlock error={error ?? classifyAdminError(null)} onRetry={onRetry} />;

  const subGrowth = ratio(forecast.subs_this_month - forecast.subs_last_month, forecast.subs_last_month);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <AdminStatCard label="이번달 예상 매출" value={formatKRW(forecast.projected_month_revenue)} icon={<TrendingUp size={16} />} tone="success" hint={`MTD ${formatKRW(forecast.month_to_date_revenue)} · ${forecast.days_elapsed}/${forecast.days_in_month}일`} />
        <AdminStatCard label="현재 MRR" value={formatKRW(forecast.current_mrr)} icon={<Repeat size={16} />} tone="primary" />
        <AdminStatCard label="다음달 예상 MRR" value={formatKRW(forecast.next_month_mrr)} icon={<Repeat size={16} />} tone="info" hint="활성·자동갱신 (종료예정 제외)" />
        <AdminStatCard label="ARR Forecast" value={formatKRW(forecast.arr_forecast)} icon={<TrendingUp size={16} />} tone="primary" hint="다음달 MRR × 12" />
        <AdminStatCard label="이번달 신규 구독" value={NUM(forecast.subs_this_month)} icon={<TrendingUp size={16} />} tone="success" hint={`지난달 ${NUM(forecast.subs_last_month)}`} />
        <AdminStatCard label="구독 증가 예상" value={subGrowth == null ? '신규' : `${subGrowth > 0 ? '+' : ''}${subGrowth.toFixed(1)}%`} icon={<TrendingUp size={16} />} tone="success" hint="신규 구독 MoM" />
      </div>
      <AdminAlert tone="info" title="예측 방식" description={`${forecast.method}. 이번달 예상 = 실적 ÷ 경과일 × 총일수. 다음달 MRR = 자동갱신 활성 구독 합(종료예정 제외). AI 추정 없음.`} />
    </div>
  );
}

/* ── Top ───────────────────────────────────────────────── */
function maskEmailLocal(email: string | null): string {
  if (!email) return '—';
  const at = email.indexOf('@');
  if (at <= 0) return email;
  const local = email.slice(0, at);
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(0, local.length - 2))}${email.slice(at)}`;
}

function TopTab({ breakdown, loading, error, onRetry }: { breakdown: RevenueBreakdown | null; loading: boolean; error: AdminError | null; onRetry: () => void }) {
  if (loading) return <LoadingBlock />;
  if (error || !breakdown) return <ErrorBlock error={error ?? classifyAdminError(null)} onRetry={onRetry} />;

  const support = supportMatrix(breakdown.support);

  return (
    <div className="space-y-4">
      {/* Top 지표 카드 */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-lg bg-bg-deep px-3 py-2">
          <p className="flex items-center gap-1 text-[10px] text-ink-dim"><Trophy size={11} /> TOP 플랜</p>
          <p className="text-sm font-bold text-ink">{breakdown.top_plan?.key ?? '—'}</p>
          <p className="text-[10px] text-ink-dim">{formatKRW(breakdown.top_plan?.revenue ?? 0)}</p>
        </div>
        <div className="rounded-lg bg-bg-deep px-3 py-2">
          <p className="flex items-center gap-1 text-[10px] text-ink-dim"><Trophy size={11} /> TOP 매출일</p>
          <p className="text-sm font-bold text-ink">{breakdown.top_revenue_day?.day ?? '—'}</p>
          <p className="text-[10px] text-ink-dim">{formatKRW(breakdown.top_revenue_day?.revenue ?? 0)}</p>
        </div>
        <div className="rounded-lg bg-bg-deep px-3 py-2">
          <p className="flex items-center gap-1 text-[10px] text-ink-dim"><Trophy size={11} /> TOP 결제일</p>
          <p className="text-sm font-bold text-ink">{breakdown.top_count_day?.day ?? '—'}</p>
          <p className="text-[10px] text-ink-dim">{NUM(breakdown.top_count_day?.payments ?? 0)}건</p>
        </div>
      </div>

      {/* TOP 결제 회원 */}
      <div className="overflow-x-auto">
        <p className="mb-1.5 flex items-center gap-1 text-xs font-bold"><Trophy size={13} /> TOP 결제 회원</p>
        {breakdown.top_payers.length === 0 ? (
          <AdminEmpty icon={<Inbox size={20} />} title="결제 회원 없음" />
        ) : (
          <table className="w-full min-w-[360px] text-left text-xs">
            <thead>
              <tr className="border-b border-line/10 text-[10px] uppercase tracking-wider text-ink-dim">
                <th className="px-2 py-2 font-semibold">#</th>
                <th className="px-2 py-2 font-semibold">회원</th>
                <th className="px-2 py-2 text-right font-semibold">매출</th>
                <th className="px-2 py-2 text-right font-semibold">결제</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.top_payers.map((p, i) => (
                <tr key={p.user_id} className="border-b border-line/5 last:border-0">
                  <td className="px-2 py-2 text-ink-dim">{i + 1}</td>
                  <td className="px-2 py-2 text-ink" title={p.email ?? undefined}>{maskEmailLocal(p.email)}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-bold text-ink">{formatKRW(p.revenue)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink-mute">{NUM(p.payments)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-1 text-[10px] text-ink-dim">TOP 사업자/브랜드/지역은 회원-지역·브랜드 매핑이 없어 미지원.</p>
      </div>

      {/* 지원 여부 매트릭스 */}
      <div>
        <p className="mb-1.5 text-xs font-bold">지표 지원 여부</p>
        <div className="flex flex-wrap gap-1.5">
          {support.map((s) => (
            <AdminBadge key={s.key} tone={s.supported ? 'success' : 'neutral'} size="sm">
              {s.label} {s.supported ? '지원' : '데이터 없음'}
            </AdminBadge>
          ))}
        </div>
      </div>
    </div>
  );
}
