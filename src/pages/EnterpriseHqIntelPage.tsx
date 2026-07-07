/**
 * EnterpriseHqIntelPage — Phase 3-4
 *
 * 본사 (HQ) 인텔리전스 센터. /enterprise/intel.
 * Executive Dashboard — 브랜드 전체 운영 현황과 성과 요약.
 *
 * SQL: supabase/migrations/0402_enterprise_hq_intel_center.sql
 * API: src/lib/api/enterpriseHqIntelApi.ts
 *
 * 섹션 (위→아래):
 *   0) Executive Summary (자연어 2-3줄) — 최상단
 *   1) Executive KPI (5 카드)
 *   2) Brand Health Score (large gauge + breakdown)
 *   3) AI Insights (rule-based cards)
 *   4) Store Ranking (top 5 · bottom 5)
 *   5) Risk Stores (health<50 or offline_24h+)
 *   6) Trend Chart (7d/30d/90d 셀렉터)
 *   7) Monthly Report 다운로드 (JSON/CSV · PDF 는 Phase 3-4b)
 *
 * 절대 원칙:
 *   - HF1~GC UI contrast 정책 유지 (라이트/다크 이중 테마)
 *   - HQ 만 접근 · 서버 게이트 · super admin 우회 없음
 *   - 기존 admin_* / 0401 HQ Ops RPC 무변경
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  BarChart3, AlertCircle, ArrowLeft, Sparkles, TrendingUp,
  Building2, Coins, Activity, ShieldAlert, Wifi, Download, FileText,
  ChevronUp, ChevronDown, AlertTriangle, CheckCircle2, Store as StoreIcon,
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from 'recharts';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';
import EnterpriseHqNotificationBell from '@/components/enterprise/EnterpriseHqNotificationBell';
import {
  getMyEnterpriseIntelKpi,
  getMyEnterpriseIntelHealthScore,
  getMyEnterpriseIntelStoreRanking,
  getMyEnterpriseIntelRiskStores,
  getMyEnterpriseIntelTrend,
  getMyEnterpriseIntelInsights,
  getMyEnterpriseIntelMonthlyReport,
  getMyEnterpriseIntelExecutiveSummary,
  monthlyReportToCsv,
  downloadCsv,
  downloadJson,
  downloadEnterpriseIntelPdf,
  firstOfMonth,
  INSIGHT_SEVERITY_LABEL,
  EXEC_TONE_LABEL,
  type HqIntelKpi,
  type HqIntelHealthScore,
  type HqIntelRankingRow,
  type HqIntelRiskStore,
  type HqIntelTrendResult,
  type HqIntelInsight,
  type HqIntelExecutiveSummary,
  type HqIntelExecutiveTone,
  type HqIntelInsightSeverity,
  type HqIntelPeriod,
} from '@/lib/api/enterpriseHqIntelApi';

const POLL_MS_KPI = 30_000;
const POLL_MS_SUMMARY = 30_000;
const POLL_MS_INSIGHTS = 60_000;

export default function EnterpriseHqIntelPage() {
  const { user, loading: authLoading } = useAuthStore();
  if (!authLoading && !user) return <Navigate to="/login" replace />;

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 pb-24">
      <PageHeader />
      <ExecutiveSummarySection />
      <KpiSection />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <HealthScoreSection />
        </div>
        <div className="lg:col-span-2">
          <InsightsSection />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <RankingSection />
        <RiskStoresSection />
      </div>
      <TrendSection />
      <MonthlyReportSection />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Header
// -----------------------------------------------------------------------------

function PageHeader() {
  return (
    <header className="flex items-center gap-3">
      <Link
        to="/enterprise/me"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-bg-card"
        aria-label="본사 대시보드로"
      >
        <ArrowLeft size={18} />
      </Link>
      <div className="flex-1 min-w-0">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
          <BarChart3 size={20} className="text-accent" /> 브랜드 인텔리전스
        </h1>
        <p className="text-xs text-ink-mute">
          브랜드 전체 운영 현황 · 성과 · 리스크를 한눈에.
        </p>
      </div>
      <EnterpriseHqNotificationBell className="bg-bg-card hover:bg-bg-hover" />
    </header>
  );
}

// -----------------------------------------------------------------------------
// 0) Executive Summary AI 카드 — 최상단 · 자연어 2~3줄
// -----------------------------------------------------------------------------

function ExecutiveSummarySection() {
  const [data, setData] = useState<HqIntelExecutiveSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getMyEnterpriseIntelExecutiveSummary());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), POLL_MS_SUMMARY);
    return () => window.clearInterval(t);
  }, [load]);

  if (loading && !data) {
    return <div className="h-24 animate-pulse rounded-2xl bg-bg-card" />;
  }
  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!data) return null;

  return <ExecutiveSummaryCard summary={data} />;
}

function ExecutiveSummaryCard({ summary }: { summary: HqIntelExecutiveSummary }) {
  const toneCls = toneToClass(summary.tone);
  return (
    <section className={`rounded-2xl border p-5 ${toneCls.bg}`}>
      <div className="flex items-start gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${toneCls.iconBg}`} aria-hidden>
          <Sparkles size={20} className={toneCls.iconText} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={`text-[10px] font-bold uppercase tracking-wider ${toneCls.subtitle}`}>Executive Summary</p>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${toneCls.badge}`}>
              {EXEC_TONE_LABEL[summary.tone]}
            </span>
          </div>
          <div className={`mt-1 space-y-1 text-[14px] font-medium leading-relaxed ${toneCls.body}`}>
            {summary.lines.map((line, i) => (
              <p key={i} className={i === 0 ? 'text-[15px] font-extrabold' : ''}>{line}</p>
            ))}
          </div>
        </div>
        <div className="hidden shrink-0 text-right sm:block">
          <p className="text-[10px] text-slate-700 dark:text-ink-mute">Brand Health</p>
          <p className={`text-3xl font-extrabold tabular-nums ${toneCls.scoreText}`}>
            {summary.brand_score}
          </p>
        </div>
      </div>
    </section>
  );
}

function toneToClass(tone: HqIntelExecutiveTone) {
  if (tone === 'stable') {
    return {
      bg: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-500/20 dark:border-transparent dark:ring-1 dark:ring-emerald-400/40',
      iconBg: 'bg-emerald-100 dark:bg-emerald-500/40',
      iconText: 'text-emerald-700 dark:text-emerald-100',
      subtitle: 'text-emerald-700 dark:text-emerald-100',
      badge: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/30 dark:text-emerald-50',
      body: 'text-slate-900 dark:text-emerald-50',
      scoreText: 'text-emerald-700 dark:text-emerald-100',
    };
  }
  if (tone === 'attention') {
    return {
      bg: 'bg-amber-50 border-amber-200 dark:bg-amber-500/25 dark:border-transparent dark:ring-1 dark:ring-amber-400/40',
      iconBg: 'bg-amber-100 dark:bg-amber-500/40',
      iconText: 'text-amber-700 dark:text-amber-100',
      subtitle: 'text-amber-700 dark:text-amber-100',
      badge: 'bg-amber-100 text-amber-900 dark:bg-amber-500/35 dark:text-amber-50',
      body: 'text-slate-900 dark:text-amber-50',
      scoreText: 'text-amber-700 dark:text-amber-100',
    };
  }
  return {
    bg: 'bg-rose-50 border-rose-200 dark:bg-rose-500/25 dark:border-transparent dark:ring-1 dark:ring-rose-400/40',
    iconBg: 'bg-rose-100 dark:bg-rose-500/40',
    iconText: 'text-rose-700 dark:text-rose-100',
    subtitle: 'text-rose-700 dark:text-rose-100',
    badge: 'bg-rose-100 text-rose-900 dark:bg-rose-500/35 dark:text-rose-50',
    body: 'text-slate-900 dark:text-rose-50',
    scoreText: 'text-rose-700 dark:text-rose-100',
  };
}

// -----------------------------------------------------------------------------
// 1) KPI
// -----------------------------------------------------------------------------

function KpiSection() {
  const [kpi, setKpi] = useState<HqIntelKpi | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setKpi(await getMyEnterpriseIntelKpi());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), POLL_MS_KPI);
    return () => window.clearInterval(t);
  }, [load]);

  if (loading && !kpi) return <div className="h-24 animate-pulse rounded-2xl bg-bg-card" />;
  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!kpi) return null;

  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <KpiCard icon={<StoreIcon size={14} />} label="전체 매장" value={kpi.total_stores.toLocaleString('ko-KR')} tone="neutral" />
      <KpiCard icon={<Wifi size={14} />} label="온라인" value={kpi.active_stores.toLocaleString('ko-KR')} tone="emerald" />
      <KpiCard icon={<Coins size={14} />} label="이번 달 정산" value={`${kpi.mtd_revenue.toLocaleString('ko-KR')}원`} tone="sky" />
      <KpiCard icon={<Building2 size={14} />} label="이월 예정" value={kpi.carryover_pending.toLocaleString('ko-KR')} tone="amber" />
      <KpiCard icon={<ShieldAlert size={14} />} label="주의 매장" value={kpi.open_alerts.toLocaleString('ko-KR')} tone="rose" />
    </section>
  );
}

function KpiCard({
  icon, label, value, tone,
}: {
  icon: React.ReactNode; label: string; value: string;
  tone: 'neutral' | 'emerald' | 'sky' | 'amber' | 'rose';
}) {
  const cls =
    tone === 'emerald' ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-500/20 dark:border-transparent dark:ring-1 dark:ring-emerald-400/40' :
    tone === 'sky'     ? 'bg-sky-50 border-sky-200 dark:bg-sky-500/20 dark:border-transparent dark:ring-1 dark:ring-sky-400/40' :
    tone === 'amber'   ? 'bg-amber-50 border-amber-200 dark:bg-amber-500/25 dark:border-transparent dark:ring-1 dark:ring-amber-400/40' :
    tone === 'rose'    ? 'bg-rose-50 border-rose-200 dark:bg-rose-500/25 dark:border-transparent dark:ring-1 dark:ring-rose-400/40' :
    'bg-bg-card border-line/10';
  const iconCls =
    tone === 'emerald' ? 'text-emerald-700 dark:text-emerald-100' :
    tone === 'sky'     ? 'text-sky-700 dark:text-sky-100' :
    tone === 'amber'   ? 'text-amber-700 dark:text-amber-100' :
    tone === 'rose'    ? 'text-rose-700 dark:text-rose-100' :
    'text-ink';
  return (
    <div className={`rounded-2xl border p-3 ${cls}`}>
      <p className="flex items-center gap-1 text-[10px] font-semibold text-slate-700 dark:text-ink-mute">
        <span className={iconCls}>{icon}</span> {label}
      </p>
      <p className="mt-1 text-xl font-extrabold tabular-nums text-slate-950 dark:text-ink truncate">
        {value}
      </p>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 2) Brand Health Score
// -----------------------------------------------------------------------------

function HealthScoreSection() {
  const [data, setData] = useState<HqIntelHealthScore | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getMyEnterpriseIntelHealthScore());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(t);
  }, [load]);

  if (loading && !data) return <div className="h-48 animate-pulse rounded-2xl bg-bg-card" />;
  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!data) return null;

  const scoreColorCls =
    data.score >= 80 ? 'text-emerald-700 dark:text-emerald-100' :
    data.score >= 60 ? 'text-amber-700 dark:text-amber-100' :
    'text-rose-700 dark:text-rose-100';

  return (
    <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <div className="flex items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-bold">
          <Activity size={14} /> Brand Health
        </h2>
        <span className="ml-auto text-[10px] text-ink-mute">
          매장 {data.total_stores}곳 · 활성 {data.active_stores}
        </span>
      </div>

      {/* Gauge */}
      <div className="mt-4 text-center">
        <p className={`text-6xl font-extrabold tabular-nums ${scoreColorCls}`}>{data.score}</p>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-mute">score / 100</p>
      </div>

      {/* Breakdown */}
      <dl className="mt-4 space-y-2 text-xs">
        <BreakdownRow label="매장 health 평균" value={`${data.breakdown.avg_store_health}`} tone="neutral" />
        <BreakdownRow label="온라인 비율" value={`${data.breakdown.online_ratio}%`} tone="emerald" />
        <BreakdownRow label="정책 sync 비율" value={`${data.breakdown.policy_sync_ratio}%`} tone="sky" />
        <BreakdownRow label="재생 성공률" value={`${data.breakdown.playback_success_ratio}%`} tone="amber" />
      </dl>

      {/* Delta 7d signal */}
      <div className="mt-3 rounded-lg bg-bg-soft p-2.5 text-[11px] text-slate-700 dark:text-ink-mute">
        <p className="mb-1 flex items-center gap-1 font-semibold">
          <TrendingUp size={11} /> 최근 7일 신호
        </p>
        <ul className="space-y-0.5">
          <li>· 강제 동기화 이벤트: <b>{data.delta_7d_signal.force_resync_events}건</b></li>
          <li>· 지급 차단 이벤트: <b>{data.delta_7d_signal.paid_blocked_events}건</b></li>
        </ul>
      </div>
    </section>
  );
}

function BreakdownRow({ label, value, tone }: {
  label: string; value: string; tone: 'neutral' | 'emerald' | 'sky' | 'amber';
}) {
  const bar =
    tone === 'emerald' ? 'bg-emerald-500' :
    tone === 'sky'     ? 'bg-sky-500' :
    tone === 'amber'   ? 'bg-amber-500' :
    'bg-ink/40';
  const pct = Math.min(100, Math.max(0, Number(value.replace(/[^0-9.]/g, '')) || 0));
  return (
    <div>
      <div className="flex items-center justify-between">
        <dt className="text-slate-700 dark:text-ink-mute">{label}</dt>
        <dd className="font-mono font-semibold tabular-nums text-slate-950 dark:text-ink">{value}</dd>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg-deep">
        <div className={`h-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 3) AI Insights
// -----------------------------------------------------------------------------

function InsightsSection() {
  const [rows, setRows] = useState<HqIntelInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getMyEnterpriseIntelInsights();
      setRows(r.insights);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), POLL_MS_INSIGHTS);
    return () => window.clearInterval(t);
  }, [load]);

  if (error) return <ErrorBanner message={error} onRetry={load} />;

  return (
    <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <div className="flex items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-bold">
          <Sparkles size={14} /> AI 인사이트
        </h2>
        <span className="ml-auto text-[10px] text-ink-mute">rule-based · 총 {rows.length}건</span>
      </div>
      {loading && rows.length === 0 ? (
        <div className="mt-3 h-32 animate-pulse rounded bg-bg-deep" />
      ) : rows.length === 0 ? (
        <div className="mt-3 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-slate-900 dark:bg-emerald-500/20 dark:border-transparent dark:ring-1 dark:ring-emerald-400/40 dark:text-emerald-100">
          <CheckCircle2 size={11} className="mr-1 inline text-emerald-700 dark:text-emerald-200" />
          현재 특이사항이 없습니다.
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((row, i) => (
            <InsightCard key={`${row.rule}-${i}`} insight={row} />
          ))}
        </ul>
      )}
    </section>
  );
}

function InsightCard({ insight }: { insight: HqIntelInsight }) {
  const sevCls = severityToClass(insight.severity);
  return (
    <li className={`rounded-lg border p-3 ${sevCls.bg}`}>
      <div className="flex items-start gap-2">
        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${sevCls.badge}`}>
          {INSIGHT_SEVERITY_LABEL[insight.severity]}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`font-semibold ${sevCls.title}`}>{insight.title}</p>
          <p className={`mt-0.5 text-[12px] leading-relaxed ${sevCls.body}`}>{insight.body}</p>
        </div>
        {insight.action_hint && (
          <Link
            to={insight.action_hint}
            className="shrink-0 rounded bg-white/70 border border-slate-200 px-2 py-1 text-[11px] font-bold text-slate-900 hover:bg-white dark:bg-bg-deep dark:border-transparent dark:text-ink dark:hover:bg-bg-hover"
          >
            보기
          </Link>
        )}
      </div>
    </li>
  );
}

function severityToClass(sev: HqIntelInsightSeverity) {
  if (sev === 'critical') {
    return {
      bg: 'bg-rose-50 border-rose-200 dark:bg-rose-500/20 dark:border-transparent dark:ring-1 dark:ring-rose-400/40',
      badge: 'bg-rose-500 text-rose-50',
      title: 'text-slate-950 dark:text-rose-50',
      body: 'text-slate-900 dark:text-rose-100',
    };
  }
  if (sev === 'warning') {
    return {
      bg: 'bg-amber-50 border-amber-200 dark:bg-amber-500/20 dark:border-transparent dark:ring-1 dark:ring-amber-400/40',
      badge: 'bg-amber-500 text-amber-950',
      title: 'text-slate-950 dark:text-amber-50',
      body: 'text-slate-900 dark:text-amber-100',
    };
  }
  return {
    bg: 'bg-sky-50 border-sky-200 dark:bg-sky-500/20 dark:border-transparent dark:ring-1 dark:ring-sky-400/40',
    badge: 'bg-sky-500 text-sky-50',
    title: 'text-slate-950 dark:text-sky-50',
    body: 'text-slate-900 dark:text-sky-100',
  };
}

// -----------------------------------------------------------------------------
// 4) Store Ranking
// -----------------------------------------------------------------------------

function RankingSection() {
  const [top, setTop] = useState<HqIntelRankingRow[]>([]);
  const [bottom, setBottom] = useState<HqIntelRankingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, b] = await Promise.all([
        getMyEnterpriseIntelStoreRanking('health', 'top', 5),
        getMyEnterpriseIntelStoreRanking('health', 'bottom', 5),
      ]);
      setTop(t.data);
      setBottom(b.data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(t);
  }, [load]);

  if (error) return <ErrorBanner message={error} onRetry={load} />;

  return (
    <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <div className="flex items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-bold">
          <BarChart3 size={14} /> 매장 순위 (Health)
        </h2>
      </div>
      {loading && top.length === 0 ? (
        <div className="mt-3 h-40 animate-pulse rounded bg-bg-deep" />
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <RankingList title="상위" icon={<ChevronUp size={12} />} rows={top} tone="emerald" />
          <RankingList title="하위" icon={<ChevronDown size={12} />} rows={bottom} tone="rose" />
        </div>
      )}
    </section>
  );
}

function RankingList({
  title, icon, rows, tone,
}: {
  title: string; icon: React.ReactNode; rows: HqIntelRankingRow[];
  tone: 'emerald' | 'rose';
}) {
  const badgeCls =
    tone === 'emerald' ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/25 dark:text-emerald-100'
    : 'bg-rose-100 text-rose-900 dark:bg-rose-500/25 dark:text-rose-100';
  return (
    <div>
      <p className="flex items-center gap-1 text-[11px] font-semibold text-ink-mute">
        {icon} {title}
      </p>
      {rows.length === 0 ? (
        <p className="mt-2 text-[11px] text-ink-mute">매장이 없어요.</p>
      ) : (
        <ul className="mt-1 divide-y divide-line/10">
          {rows.map((r) => (
            <li key={r.store_id} className="flex items-center gap-2 py-2 text-xs">
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${badgeCls}`}>
                {r.health_score}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{r.store_name}</p>
                <p className="truncate text-[10px] text-ink-mute">
                  {r.franchise_name ?? ''}{r.enterprise_region_name && ` · ${r.enterprise_region_name}`}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// 5) Risk Stores
// -----------------------------------------------------------------------------

function RiskStoresSection() {
  const [rows, setRows] = useState<HqIntelRiskStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getMyEnterpriseIntelRiskStores(20);
      setRows(r.data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(t);
  }, [load]);

  if (error) return <ErrorBanner message={error} onRetry={load} />;

  return (
    <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <div className="flex items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-bold">
          <AlertTriangle size={14} /> 리스크 매장
        </h2>
        <Link
          to="/enterprise/ops"
          className="ml-auto rounded bg-bg-deep px-2 py-1 text-[11px] hover:bg-bg-hover"
        >
          운영 관제 →
        </Link>
      </div>
      {loading && rows.length === 0 ? (
        <div className="mt-3 h-40 animate-pulse rounded bg-bg-deep" />
      ) : rows.length === 0 ? (
        <div className="mt-3 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-slate-900 dark:bg-emerald-500/20 dark:border-transparent dark:ring-1 dark:ring-emerald-400/40 dark:text-emerald-100">
          <CheckCircle2 size={11} className="mr-1 inline text-emerald-700 dark:text-emerald-200" />
          현재 리스크 매장이 없습니다.
        </div>
      ) : (
        <ul className="mt-3 max-h-64 overflow-y-auto divide-y divide-line/10">
          {rows.map((r) => (
            <RiskRow key={r.store_id} row={r} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RiskRow({ row }: { row: HqIntelRiskStore }) {
  const reason =
    row.is_offline_24h ? '오프라인'
    : row.has_playback_error ? '재생 오류'
    : row.has_policy_outdated ? '정책 지연'
    : row.has_device_missing ? '기기 미등록'
    : '주의';
  const badgeCls =
    row.health_score < 30 ? 'bg-rose-100 text-rose-900 dark:bg-rose-500/25 dark:text-rose-100'
    : row.health_score < 60 ? 'bg-amber-100 text-amber-900 dark:bg-amber-500/25 dark:text-amber-100'
    : 'bg-slate-100 text-slate-900 dark:bg-ink/15 dark:text-ink';
  return (
    <li className="flex items-center gap-2 py-2 text-xs">
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${badgeCls}`}>
        {row.health_score}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{row.store_name}</p>
        <p className="truncate text-[10px] text-ink-mute">
          {reason}
          {row.franchise_name && ` · ${row.franchise_name}`}
        </p>
      </div>
    </li>
  );
}

// -----------------------------------------------------------------------------
// 6) Trend Chart (7/30/90d)
// -----------------------------------------------------------------------------

function TrendSection() {
  const [period, setPeriod] = useState<HqIntelPeriod>('30d');
  const [data, setData] = useState<HqIntelTrendResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getMyEnterpriseIntelTrend(period));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { void load(); }, [load]);

  const daily = useMemo(() => data?.daily_activity ?? [], [data]);
  const monthly = useMemo(() => (data?.monthly_revenue ?? []).map((m) => ({
    month: m.settlement_month.slice(0, 7),
    revenue: m.effective_total,
  })), [data]);

  return (
    <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-bold">
          <TrendingUp size={14} /> 트렌드
        </h2>
        <div className="ml-auto flex gap-1">
          {(['7d','30d','90d'] as HqIntelPeriod[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded px-2.5 py-1 text-[11px] font-semibold transition ${
                period === p
                  ? 'bg-accent text-bg shadow'
                  : 'bg-bg-deep text-ink-mute hover:bg-bg-hover'
              }`}
            >
              {p === '7d' ? '7일' : p === '30d' ? '30일' : '90일'}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}

      {loading && !data ? (
        <div className="mt-3 h-56 animate-pulse rounded bg-bg-deep" />
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-1 text-[11px] font-semibold text-ink-mute">일별 활동</p>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: 'rgb(var(--color-surface))', border: 'none', borderRadius: 8, fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="force_resync_count" name="강제 동기화" stroke="#0ea5e9" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="paid_blocked_count" name="지급 차단" stroke="#f43f5e" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="carryover_created_count" name="이월 생성" stroke="#f59e0b" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div>
            <p className="mb-1 text-[11px] font-semibold text-ink-mute">월별 정산 (effective_total)</p>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: 'rgb(var(--color-surface))', border: 'none', borderRadius: 8, fontSize: 11 }} />
                  <Bar dataKey="revenue" name="정산금(이월포함)" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// -----------------------------------------------------------------------------
// 7) Monthly Report Download
// -----------------------------------------------------------------------------

function MonthlyReportSection() {
  const [month, setMonth] = useState<string>(() => new Date().toISOString().slice(0, 7));
  const [downloading, setDownloading] = useState<'csv' | 'json' | 'pdf' | null>(null);

  const onDownloadCsvJson = async (kind: 'csv' | 'json') => {
    if (!month) {
      toast.error('월을 선택해주세요.');
      return;
    }
    setDownloading(kind);
    try {
      const report = await getMyEnterpriseIntelMonthlyReport(firstOfMonth(month));
      const filename = `brand-report-${month}.${kind}`;
      if (kind === 'csv') {
        downloadCsv(filename, monthlyReportToCsv(report));
      } else {
        downloadJson(filename, report);
      }
      toast.success(`${filename} 다운로드됨.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDownloading(null);
    }
  };

  const onDownloadPdf = async () => {
    if (!month) {
      toast.error('월을 선택해주세요.');
      return;
    }
    setDownloading('pdf');
    try {
      await downloadEnterpriseIntelPdf(month);
      toast.success(`brand-report-${month}.pdf 다운로드됨.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-bold">
          <FileText size={14} /> 월간 리포트 다운로드
        </h2>
      </div>
      <p className="mt-1 text-[11px] text-ink-mute">
        정산 · 매장별 상태 · 이벤트 카운트를 CSV/JSON 으로, 요약 리포트를 PDF 로 저장할 수 있어요.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="month" value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded bg-bg-deep px-2 py-1.5 text-xs tabular-nums"
        />
        <button
          onClick={() => void onDownloadPdf()}
          disabled={downloading !== null}
          className="inline-flex items-center gap-1 rounded bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-500 disabled:opacity-50"
        >
          <Download size={12} /> {downloading === 'pdf' ? '생성 중…' : 'PDF 다운로드'}
        </button>
        <button
          onClick={() => void onDownloadCsvJson('csv')}
          disabled={downloading !== null}
          className="inline-flex items-center gap-1 rounded bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          <Download size={12} /> CSV 다운로드
        </button>
        <button
          onClick={() => void onDownloadCsvJson('json')}
          disabled={downloading !== null}
          className="inline-flex items-center gap-1 rounded bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-50"
        >
          <Download size={12} /> JSON 다운로드
        </button>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Common
// -----------------------------------------------------------------------------

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 dark:bg-rose-500/25 dark:border-transparent dark:ring-1 dark:ring-rose-400/40">
      <p className="text-sm text-slate-900 dark:text-rose-100">
        <AlertCircle size={12} className="mr-1 inline" /> {message}
      </p>
      <button
        onClick={onRetry}
        className="mt-2 rounded bg-white/70 border border-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-900 hover:bg-white dark:bg-rose-500/30 dark:border-transparent dark:text-rose-50 dark:hover:bg-rose-500/40"
      >
        재시도
      </button>
    </div>
  );
}
