/**
 * MemberGrowthSection — 회원 성장 대시보드 (Phase ADMIN-MEMBER-GROWTH-1).
 *
 * PR #362(MemberStatsSection, 회원 스냅샷) 를 확장한다. 4개 내부 탭:
 *   ③ 개요   — 성장 KPI (오늘/7일/30일/이번달/지난달/전월대비/활성유료/유료전환율)
 *   ④ 성장   — 가입 추이 시계열(신규 막대 + 누적 선) + 회원 유형별 성장
 *   ⑥ 전환   — 유료 전환 분석 (전체/일반/사업자/최근30일 · 무료→유료 이력 여부)
 *   ⑦ 최근   — 최근 가입 회원 목록(최신순)
 *
 * 자체 fetch·오류 격리 → RPC 미적용(0472 미배포) 등으로 실패해도 기존 대시보드는
 * 깨지지 않는다. 시간대/집계 정의는 0472 RPC 가 KST 기준으로 계산하며, 프론트는
 * 표시·정합성 재검증만 한다.
 */
import { useEffect, useState } from 'react';
import {
  UserPlus, CalendarClock, CalendarRange, CalendarDays, TrendingUp, TrendingDown,
  CreditCard, Percent, RefreshCw, Users2, History, Inbox, Minus,
} from 'lucide-react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { AdminStatCard, AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import {
  fetchMemberGrowthKpis, fetchMemberGrowthSeries, fetchRecentMembers,
  type MemberGrowthKpis, type MemberGrowthSeries, type MemberGrowthRange, type RecentMember,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  formatNum, formatPct, momDisplay, relativeTimeKo, formatKstDateTime, formatBucketLabel,
  maskEmail, memberDisplayName, accountTypeLabel, sumByType,
  seriesIntegrityWarnings, kpiIntegrityWarnings, recentMembersOverLimit,
  PAY_STATUS_LABEL, MEMBER_STATUS_LABEL, MEMBER_STATUS_TONE,
} from '@/lib/memberGrowth';

const RECENT_LIMIT = 10;

const TYPE_COLORS = { general: '#60a5fa', business: '#10b981', artist: '#a78bfa', unknown: '#737373' } as const;
const NEW_COLOR = '#a78bfa';
const CUM_COLOR = '#10b981';

const RANGES: { key: MemberGrowthRange; label: string }[] = [
  { key: '7d', label: '7일' },
  { key: '30d', label: '30일' },
  { key: '90d', label: '90일' },
  { key: '12m', label: '12개월' },
];

type Tab = 'overview' | 'growth' | 'conversion' | 'recent';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: '개요' },
  { key: 'growth', label: '성장' },
  { key: 'conversion', label: '전환' },
  { key: 'recent', label: '최근 가입' },
];

const CHART_TOOLTIP_STYLE = {
  background: '#181818',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  fontSize: 11,
} as const;

export default function MemberGrowthSection() {
  const [tab, setTab] = useState<Tab>('overview');

  // 개요/전환 KPI
  const [kpis, setKpis] = useState<MemberGrowthKpis | null>(null);
  const [kpiErr, setKpiErr] = useState<AdminError | null>(null);
  const [kpiLoading, setKpiLoading] = useState(true);

  // 성장 시계열 (성장 탭)
  const [range, setRange] = useState<MemberGrowthRange>('30d');
  const [series, setSeries] = useState<MemberGrowthSeries | null>(null);
  const [seriesErr, setSeriesErr] = useState<AdminError | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);

  // 최근 가입 (최근 탭)
  const [recent, setRecent] = useState<RecentMember[] | null>(null);
  const [recentErr, setRecentErr] = useState<AdminError | null>(null);
  const [recentLoading, setRecentLoading] = useState(true);

  async function loadKpis() {
    setKpiLoading(true); setKpiErr(null);
    try { setKpis(await fetchMemberGrowthKpis()); }
    catch (e) { setKpiErr(classifyAdminError(e)); }
    finally { setKpiLoading(false); }
  }

  async function loadSeries(r: MemberGrowthRange) {
    setSeriesLoading(true); setSeriesErr(null);
    try { setSeries(await fetchMemberGrowthSeries(r)); }
    catch (e) { setSeriesErr(classifyAdminError(e)); }
    finally { setSeriesLoading(false); }
  }

  async function loadRecent() {
    setRecentLoading(true); setRecentErr(null);
    try { setRecent(await fetchRecentMembers(RECENT_LIMIT)); }
    catch (e) { setRecentErr(classifyAdminError(e)); }
    finally { setRecentLoading(false); }
  }

  useEffect(() => { void loadKpis(); void loadRecent(); }, []);
  // 성장 탭 최초 진입 또는 기간 변경 시 시계열 로드.
  useEffect(() => {
    if (tab === 'growth' && (!series || series.range !== range)) void loadSeries(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, range]);

  return (
    <AdminCard
      title="회원 성장"
      subtitle="가입 추이 · 유료 전환 · 최근 가입 (KST 기준)"
      action={
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                tab === t.key ? 'bg-accent text-black' : 'bg-bg-deep text-ink-mute hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      }
      bodyClassName="space-y-4"
    >
      {tab === 'overview' && (
        <OverviewTab kpis={kpis} loading={kpiLoading} error={kpiErr} onRetry={loadKpis} />
      )}
      {tab === 'growth' && (
        <GrowthTab
          series={series} loading={seriesLoading} error={seriesErr}
          range={range} onRange={setRange} onRetry={() => loadSeries(range)}
        />
      )}
      {tab === 'conversion' && (
        <ConversionTab kpis={kpis} loading={kpiLoading} error={kpiErr} onRetry={loadKpis} />
      )}
      {tab === 'recent' && (
        <RecentTab rows={recent} loading={recentLoading} error={recentErr} onRetry={loadRecent} />
      )}
    </AdminCard>
  );
}

/* ── 공통 상태 ─────────────────────────────────────────── */
function LoadingBlock() {
  return <div className="h-28 animate-pulse rounded-2xl bg-bg-deep" aria-busy="true" />;
}
function ErrorBlock({ error, onRetry }: { error: AdminError; onRetry: () => void }) {
  return (
    <AdminAlert
      tone="warning"
      title="회원 성장 데이터를 불러오지 못했어요"
      description={error.message}
      action={
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1 rounded-full bg-bg-card px-3 py-1.5 text-xs hover:bg-bg-hover"
        >
          <RefreshCw size={12} /> 다시 시도
        </button>
      }
    />
  );
}

/* ── ③ 개요 탭 ─────────────────────────────────────────── */
function OverviewTab({
  kpis, loading, error, onRetry,
}: { kpis: MemberGrowthKpis | null; loading: boolean; error: AdminError | null; onRetry: () => void }) {
  if (loading) return <LoadingBlock />;
  if (error || !kpis) return <ErrorBlock error={error ?? classifyAdminError(null)} onRetry={onRetry} />;

  const mom = momDisplay(kpis);
  const warnings = kpiIntegrityWarnings(kpis);

  return (
    <div className="space-y-3">
      {warnings.length > 0 && (
        <AdminAlert tone="warning" title="회원 성장 정합성 경고" description={warnings.join(' · ')} />
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <AdminStatCard label="오늘 가입" value={formatNum(kpis.today_signups)} icon={<UserPlus size={16} />} tone="primary" hint="KST 오늘 00:00~" />
        <AdminStatCard label="최근 7일" value={formatNum(kpis.last_7d)} icon={<CalendarClock size={16} />} tone="info" />
        <AdminStatCard label="최근 30일" value={formatNum(kpis.last_30d)} icon={<CalendarRange size={16} />} tone="info" />
        <AdminStatCard label="이번 달" value={formatNum(kpis.this_month)} icon={<CalendarDays size={16} />} tone="primary" hint="KST 1일~" />
        <AdminStatCard label="지난달" value={formatNum(kpis.last_month)} icon={<CalendarDays size={16} />} tone="neutral" />
        <AdminStatCard
          label="전월 대비"
          value={mom.text}
          icon={mom.tone === 'danger' ? <TrendingDown size={16} /> : mom.tone === 'success' ? <TrendingUp size={16} /> : <Minus size={16} />}
          tone={mom.tone === 'success' ? 'success' : mom.tone === 'danger' ? 'danger' : 'neutral'}
          hint="이번 달 vs 지난달"
        />
        <AdminStatCard label="활성 유료 회원" value={formatNum(kpis.active_paid_members)} icon={<CreditCard size={16} />} tone="success" hint={`전체 ${formatNum(kpis.total_valid_members)}`} />
        <AdminStatCard label="유료 전환율" value={formatPct(kpis.paid_conversion_rate)} icon={<Percent size={16} />} tone="success" hint="활성유료/전체" />
      </div>
    </div>
  );
}

/* ── ④ 성장 탭 (시계열 + 유형별) ───────────────────────── */
function GrowthTab({
  series, loading, error, range, onRange, onRetry,
}: {
  series: MemberGrowthSeries | null; loading: boolean; error: AdminError | null;
  range: MemberGrowthRange; onRange: (r: MemberGrowthRange) => void; onRetry: () => void;
}) {
  const rangeButtons = (
    <div className="flex flex-wrap gap-1">
      {RANGES.map((r) => (
        <button
          key={r.key}
          onClick={() => onRange(r.key)}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
            range === r.key ? 'bg-accent text-black' : 'bg-bg-deep text-ink-mute hover:text-ink'
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  );

  let body: React.ReactNode;
  if (loading) {
    body = <LoadingBlock />;
  } else if (error || !series) {
    body = <ErrorBlock error={error ?? classifyAdminError(null)} onRetry={onRetry} />;
  } else if (series.points.length === 0 || series.total_new === 0) {
    body = <AdminEmpty icon={<Inbox size={24} />} title="가입 데이터 없음" description="선택한 기간에 신규 가입이 없어요." />;
  } else {
    body = <GrowthCharts series={series} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold tracking-tight">가입 추이</span>
        {rangeButtons}
      </div>
      {body}
    </div>
  );
}

function GrowthCharts({ series }: { series: MemberGrowthSeries }) {
  const data = series.points.map((p) => ({
    ...p,
    label: formatBucketLabel(p.bucket, series.unit),
  }));
  // 일 단위에서 포인트가 많으면(90일) 가로 스크롤로 잘림 방지.
  const minWidth = series.unit === 'day' && data.length > 31 ? data.length * 22 : undefined;
  const totals = sumByType(series.points);
  const warnings = seriesIntegrityWarnings(series);

  const tickInterval = data.length > 31 ? Math.floor(data.length / 12) : 0;

  return (
    <div className="space-y-4">
      {warnings.length > 0 && (
        <AdminAlert
          tone="warning"
          title="시계열 정합성 경고"
          description={`유형 합계가 신규 합계와 다른 구간: ${warnings.slice(0, 5).join(' · ')}`}
        />
      )}

      {/* 신규 가입(막대) + 누적 회원(선) */}
      <div>
        <p className="mb-1 text-[11px] text-ink-mute">일별 신규 가입 · 누적 회원</p>
        <div className="overflow-x-auto">
          <div style={minWidth ? { minWidth } : undefined}>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#737373' }} axisLine={false} tickLine={false} interval={tickInterval} minTickGap={8} />
                <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#737373' }} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#737373' }} axisLine={false} tickLine={false} width={36} allowDecimals={false} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={growthTooltipFormatter} labelFormatter={(l) => `${l}`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="left" dataKey="new_total" name="신규 가입" fill={NEW_COLOR} radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Line yAxisId="right" type="monotone" dataKey="cumulative" name="누적 회원" stroke={CUM_COLOR} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 회원 유형별 신규 가입 (일반/사업자/아티스트/미분류) */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <p className="text-[11px] text-ink-mute">회원 유형별 신규 가입</p>
          {totals.unknown > 0 && (
            <AdminBadge tone="warning" size="sm">미분류 {formatNum(totals.unknown)}건</AdminBadge>
          )}
        </div>
        <div className="overflow-x-auto">
          <div style={minWidth ? { minWidth } : undefined}>
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} stackOffset="none">
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#737373' }} axisLine={false} tickLine={false} interval={tickInterval} minTickGap={8} />
                <YAxis tick={{ fontSize: 10, fill: '#737373' }} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={typeTooltipFormatter} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="new_general" stackId="t" name="일반" fill={TYPE_COLORS.general} />
                <Bar dataKey="new_business" stackId="t" name="사업자" fill={TYPE_COLORS.business} />
                <Bar dataKey="new_artist" stackId="t" name="아티스트" fill={TYPE_COLORS.artist} />
                <Bar dataKey="new_unknown" stackId="t" name="미분류" fill={TYPE_COLORS.unknown} radius={[4, 4, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
        <p className="mt-1 text-[10px] text-ink-dim">
          유형별 ‘일반’은 account_type=individual 기준이며, 미지정(null)은 ‘미분류’로 분리합니다
          (회원 요약의 일반 집계와 기준이 다를 수 있습니다).
        </p>
      </div>
    </div>
  );
}

function growthTooltipFormatter(value: number, name: string): [string, string] {
  return [formatNum(value), name];
}
function typeTooltipFormatter(value: number, name: string): [string, string] {
  return [formatNum(value), name];
}

/* ── ⑥ 전환 탭 ─────────────────────────────────────────── */
function ConversionTab({
  kpis, loading, error, onRetry,
}: { kpis: MemberGrowthKpis | null; loading: boolean; error: AdminError | null; onRetry: () => void }) {
  if (loading) return <LoadingBlock />;
  if (error || !kpis) return <ErrorBlock error={error ?? classifyAdminError(null)} onRetry={onRetry} />;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <AdminStatCard label="전체 유료 전환율" value={formatPct(kpis.paid_conversion_rate)} icon={<Percent size={16} />} tone="success" hint={`${formatNum(kpis.active_paid_members)}/${formatNum(kpis.total_valid_members)}`} />
        <AdminStatCard label="일반 회원 전환율" value={formatPct(kpis.general_conversion_rate)} icon={<Users2 size={16} />} tone="info" hint={`${formatNum(kpis.general_paid)}/${formatNum(kpis.general_total)}`} />
        <AdminStatCard label="사업자 전환율" value={formatPct(kpis.business_conversion_rate)} icon={<Users2 size={16} />} tone="primary" hint={`${formatNum(kpis.business_paid)}/${formatNum(kpis.business_total)}`} />
        <AdminStatCard label="최근 30일 전환율" value={formatPct(kpis.last30_conversion_rate)} icon={<CalendarRange size={16} />} tone="success" hint={`${formatNum(kpis.last30_paid)}/${formatNum(kpis.last30_signups)}`} />
        <AdminStatCard label="미결제 회원" value={formatNum(kpis.unpaid_users)} icon={<CreditCard size={16} />} tone="warning" hint="유료 플랜·결제 미완료" />
      </div>

      <AdminAlert
        tone="info"
        icon={<History size={16} />}
        title="무료 → 유료 전환 회원 수 — 이력 데이터 없음"
        description={
          kpis.free_to_paid_history_supported
            ? `무료→유료 전환: ${formatNum(kpis.free_to_paid_count ?? 0)}명`
            : '멤버십 티어 변경 이력(이벤트 로그) 테이블이 없어 스냅샷만으로는 정확한 전환 수를 산출할 수 없습니다. 임의 추정 대신 이력 없음으로 표시하며, 정확 집계가 필요하면 membership_change_events 로그를 후속 마이그레이션으로 도입해야 합니다.'
        }
      />
      <p className="text-[10px] text-ink-dim">
        분모 정의 — 전체: 총 유효 회원(운영자 제외) · 일반: account_type 이 사업자/아티스트가
        아닌 회원(미지정 포함) · 사업자: account_type=business. 분자: 활성 유료 구독 보유
        (status=active·cancel_scheduled). 회원 요약(스냅샷) 정의와 일치합니다.
      </p>
    </div>
  );
}

/* ── ⑦ 최근 가입 탭 ────────────────────────────────────── */
function RecentTab({
  rows, loading, error, onRetry,
}: { rows: RecentMember[] | null; loading: boolean; error: AdminError | null; onRetry: () => void }) {
  if (loading) return <LoadingBlock />;
  if (error || !rows) return <ErrorBlock error={error ?? classifyAdminError(null)} onRetry={onRetry} />;
  if (rows.length === 0) {
    return <AdminEmpty icon={<Inbox size={24} />} title="최근 가입 회원 없음" description="아직 가입한 회원이 없어요." />;
  }

  const over = recentMembersOverLimit(rows, RECENT_LIMIT);

  return (
    <div className="space-y-2">
      {over && (
        <AdminAlert tone="warning" title="정합성 경고" description={`요청 ${RECENT_LIMIT}명보다 많은 ${rows.length}명이 반환됐어요.`} />
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead>
            <tr className="border-b border-line/10 text-[10px] uppercase tracking-wider text-ink-dim">
              <th className="px-2 py-2 font-semibold">회원</th>
              <th className="px-2 py-2 font-semibold">유형</th>
              <th className="px-2 py-2 font-semibold">플랜</th>
              <th className="px-2 py-2 font-semibold">결제</th>
              <th className="px-2 py-2 font-semibold">상태</th>
              <th className="px-2 py-2 font-semibold">인증</th>
              <th className="px-2 py-2 text-right font-semibold">가입</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className="border-b border-line/5 last:border-0">
                <td className="px-2 py-2">
                  <div className="font-semibold text-ink">{memberDisplayName(m)}</div>
                  <div className="text-[10px] text-ink-dim" title={m.email ?? undefined}>{maskEmail(m.email)}</div>
                </td>
                <td className="px-2 py-2 text-ink-mute">{accountTypeLabel(m.account_type)}</td>
                <td className="px-2 py-2 text-ink-mute">{m.membership_tier}</td>
                <td className="px-2 py-2">
                  <AdminBadge tone={m.pay_status === 'paid' ? 'success' : m.pay_status === 'unpaid' ? 'warning' : 'neutral'} size="sm">
                    {PAY_STATUS_LABEL[m.pay_status]}
                  </AdminBadge>
                </td>
                <td className="px-2 py-2">
                  <AdminBadge tone={MEMBER_STATUS_TONE[m.status]} size="sm">{MEMBER_STATUS_LABEL[m.status]}</AdminBadge>
                </td>
                <td className="px-2 py-2">
                  {m.email_verified
                    ? <AdminBadge tone="success" size="sm">인증</AdminBadge>
                    : <span className="text-ink-dim">미인증</span>}
                </td>
                <td className="px-2 py-2 text-right">
                  <span className="text-ink-mute" title={formatKstDateTime(m.created_at)}>
                    {relativeTimeKo(m.created_at)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-ink-dim">최신 가입 순 · 관리자 전용 · 이메일 부분 마스킹(정확 시각은 가입 열 툴팁).</p>
    </div>
  );
}
