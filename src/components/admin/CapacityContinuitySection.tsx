/**
 * CapacityContinuitySection — AI Capacity, Cost & Continuity Center (Phase AI-OPS-5).
 *
 * Usage(실측) → Baseline → Trend → Deterministic Forecast → Headroom → Saturation →
 * Cost → Continuity → 권고/계획 Evidence 만. Infrastructure/Billing 실행 엔진 아님.
 * Scale Up/Down·Upgrade Plan·Change Supabase/Vercel Plan·Increase Database·Add Worker·
 * Create Replica·Enable Failover·Execute Backup/Restore·Deploy/Apply/Merge/Run Migration·
 * Update Queue/Scheduler/Playback 버튼 없음.
 *
 * 탭 25개: Overview · Capacity Domains · Usage · Baselines · Demand Trends · Forecasts ·
 * Headroom · Saturation Risk · Time to Exhaustion · Capacity Budget · Cost Models ·
 * Cost Actuals · Cost Forecast · Unit Economics · Cost Anomalies · Recommendations ·
 * Scaling Plans · Dependencies · SPOF · RTO/RPO · Continuity Readiness · Stress Scenarios ·
 * Continuity Scenarios · Audit · Support Matrix.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, Banknote, BarChart3, Box as BoxIcon, Calculator, Clock, Database,
  FlaskConical, Gauge, Grid3x3, Layers, LifeBuoy, Link2, Lock, RefreshCw, Ruler, ScrollText,
  Shield, Target, TrendingUp, Wallet, Waypoints, Zap,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchCapacitySummary, fetchCapacityMetrics, fetchCapacityUsage, fetchCapacitySnapshots,
  createCapacitySnapshot, saveCapacityMetric, fetchCostModels, saveCostModel, fetchCostSnapshots,
  saveCostSnapshot, fetchCapacityPlans, saveCapacityPlan, reviewCapacityPlan,
  fetchOperationalDependencies, saveOperationalDependency, fetchCapacityAudit,
  type CapacityMetricRow, type CapacitySnapshotRow, type CapacityUsageDay, type CostModelRow,
  type CostSnapshotRow, type CapacityPlanRow, type OperationalDependencyRow, type CapacityEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  calculateUsageBaseline, calculateDemandTrend, forecastDemand, calculateHeadroom,
  estimateTimeToExhaustion, calculateSaturationRisk, calculateEstimatedCost, forecastCost,
  calculateUnitEconomics, detectCostAnomaly, buildCapacityRecommendation,
  detectSinglePointOfFailure, evaluateContinuityReadiness, evaluateCapacityStressScenario,
  evaluateContinuityScenario, CAPACITY_DOMAINS, CAP_SUPPORT, CAP_STATUS_TONE, READINESS_TONE,
  SCENARIO_TONE,
  type DailyUsagePoint, type DependencyLike,
} from '@/lib/capacityIntelligence';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const BYTES = (n: number | null | undefined) => (n == null ? '—' : n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)}GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`);

type Tab = 'overview' | 'domains' | 'usage' | 'baselines' | 'trends' | 'forecasts' | 'headroom' | 'saturation'
  | 'exhaustion' | 'budget' | 'costmodels' | 'costactuals' | 'costforecast' | 'uniteconomics' | 'anomalies'
  | 'recommendations' | 'plans' | 'dependencies' | 'spof' | 'rtorpo' | 'readiness' | 'stress' | 'continuity' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Overview', icon: Layers },
  { key: 'domains', label: 'Capacity Domains', icon: BoxIcon },
  { key: 'usage', label: 'Usage', icon: Activity },
  { key: 'baselines', label: 'Baselines', icon: Ruler },
  { key: 'trends', label: 'Demand Trends', icon: TrendingUp },
  { key: 'forecasts', label: 'Forecasts', icon: BarChart3 },
  { key: 'headroom', label: 'Headroom', icon: Gauge },
  { key: 'saturation', label: 'Saturation Risk', icon: AlertTriangle },
  { key: 'exhaustion', label: 'Time to Exhaustion', icon: Clock },
  { key: 'budget', label: 'Capacity Budget', icon: Target },
  { key: 'costmodels', label: 'Cost Models', icon: Banknote },
  { key: 'costactuals', label: 'Cost Actuals', icon: Wallet },
  { key: 'costforecast', label: 'Cost Forecast', icon: BarChart3 },
  { key: 'uniteconomics', label: 'Unit Economics', icon: Calculator },
  { key: 'anomalies', label: 'Cost Anomalies', icon: AlertTriangle },
  { key: 'recommendations', label: 'Recommendations', icon: Zap },
  { key: 'plans', label: 'Scaling Plans', icon: Waypoints },
  { key: 'dependencies', label: 'Dependencies', icon: Link2 },
  { key: 'spof', label: 'SPOF', icon: Shield },
  { key: 'rtorpo', label: 'RTO / RPO', icon: Clock },
  { key: 'readiness', label: 'Continuity Readiness', icon: LifeBuoy },
  { key: 'stress', label: 'Stress Scenarios', icon: FlaskConical },
  { key: 'continuity', label: 'Continuity Scenarios', icon: Database },
  { key: 'audit', label: 'Audit', icon: ScrollText },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

export default function CapacityContinuitySection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<Record<string, number | string | Record<string, number> | null>>({});
  const [metrics, setMetrics] = useState<CapacityMetricRow[]>([]);
  const [snapshots, setSnapshots] = useState<CapacitySnapshotRow[]>([]);
  const [usage, setUsage] = useState<CapacityUsageDay[]>([]);
  const [costModels, setCostModels] = useState<CostModelRow[]>([]);
  const [costSnaps, setCostSnaps] = useState<CostSnapshotRow[]>([]);
  const [plans, setPlans] = useState<CapacityPlanRow[]>([]);
  const [deps, setDeps] = useState<OperationalDependencyRow[]>([]);
  const [audit, setAudit] = useState<CapacityEventRow[]>([]);
  const [limitInput, setLimitInput] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, m, snap, u, cm, cs, pl, dp, au] = await Promise.all([
        fetchCapacitySummary(), fetchCapacityMetrics(null, 100), fetchCapacitySnapshots(null, 200),
        fetchCapacityUsage(30), fetchCostModels(100), fetchCostSnapshots(100),
        fetchCapacityPlans(null, 100), fetchOperationalDependencies(100), fetchCapacityAudit(100),
      ]);
      setSummary(s); setMetrics(m); setSnapshots(snap); setUsage(u);
      setCostModels(cm); setCostSnaps(cs); setPlans(pl); setDeps(dp); setAudit(au);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await load(); }
    catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  const latestSnap = useCallback((metricId: string) => snapshots.find((s) => s.metric_id === metricId) ?? null, [snapshots]);
  const eventSeries: DailyUsagePoint[] = useMemo(() => usage.map((u) => ({ day: u.day, value: u.events })), [usage]);
  const storeSeries: DailyUsagePoint[] = useMemo(() => usage.map((u) => ({ day: u.day, value: u.active_stores })), [usage]);
  const playerSeries: DailyUsagePoint[] = useMemo(() => usage.map((u) => ({ day: u.day, value: u.active_players })), [usage]);
  const SERIES: Array<{ code: string; label: string; series: DailyUsagePoint[] }> = useMemo(() => [
    { code: 'daily_playback_events', label: 'Playback Events/day', series: eventSeries },
    { code: 'active_stores_daily', label: 'Active Stores/day', series: storeSeries },
    { code: 'active_players_daily', label: 'Active Players/day', series: playerSeries },
  ], [eventSeries, storeSeries, playerSeries]);

  const trendOf = useCallback((code: string) => calculateDemandTrend(SERIES.find((s) => s.code === code)?.series ?? []), [SERIES]);
  const readiness = useMemo(() => {
    const spofs = deps.map((d) => detectSinglePointOfFailure(d as unknown as DependencyLike));
    return evaluateContinuityReadiness({
      dependencyCount: deps.length,
      confirmedSpofs: spofs.filter((s) => s.status === 'confirmed_spof').length,
      potentialSpofs: spofs.filter((s) => s.status === 'potential_spof').length,
      backupConfigured: null, restoreTested: null, failoverAvailable: deps.some((d) => d.fallback_available) ? true : deps.length ? false : null,
      monitoringCoverage: null, playbookCount: 0,
      rtoDefinedCount: deps.filter((d) => d.rto_target !== 'not_defined').length,
      lastValidationAt: null,
    });
  }, [deps]);

  if (loading) return <AdminCard title="AI Capacity, Cost & Continuity Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="AI Capacity, Cost & Continuity Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  return (
    <AdminCard
      title="AI Capacity, Cost & Continuity Center"
      subtitle="Usage(실측) → Baseline → Trend → Forecast → Headroom → Saturation → Cost → Continuity — 예측·권고·계획 Evidence 만 (자동 Scale/Backup/결제 변경 없음)"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 Infrastructure Provisioning/Billing 실행 엔진이 아닙니다. Limit 을 모르는 자원은 사용률/Headroom/소진 시점을 계산하지 않고 limit_unknown 으로 표시하며, 단가가 없는 비용은 cost_unknown 입니다. Forecast 는 항상 '예측값 — Actual 아님' 으로 표시되고 실제 Usage 로 저장되지 않습니다. AI 는 Limit/단가/Budget 을 직접 수정할 수 없습니다(관리자 승인 + Audit)." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {/* ── Overview ── */}
      {tab === 'overview' && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Box label="Active Metrics" value={`${NUM(summary.metrics_active as number)}/${NUM(summary.metrics_total as number)}`} />
          <Box label="Limit 확인됨" value={NUM(summary.metrics_with_limits as number)} />
          <Box label="Limit Unknown" value={NUM(summary.metrics_limit_unknown as number)} />
          <Box label="Snapshots" value={String(snapshots.length)} />
          <Box label="Saturation Risk" value={String(snapshots.filter((s) => s.status === 'saturation_risk').length)} />
          <Box label="Exhausted" value={String(snapshots.filter((s) => s.status === 'exhausted').length)} />
          <Box label="Scaling Plans" value={NUM(summary.plans_total as number)} />
          <Box label="Cost Models" value={NUM(summary.cost_models as number)} />
          <Box label="Actual Cost 기록" value={NUM(summary.cost_actual_snapshots as number)} />
          <Box label="Critical Dependencies" value={NUM(summary.dependencies_critical as number)} />
          <Box label="Continuity" value={readiness.readiness} />
          <Box label="Last Evaluation" value={summary.last_snapshot_at ? String(summary.last_snapshot_at).slice(0, 16) : '—'} />
        </div>
      )}

      {/* ── Domains ── */}
      {tab === 'domains' && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Domain</th><th className="px-2">상태</th><th className="px-2">근거(실측 분석)</th></tr></thead>
            <tbody>{CAPACITY_DOMAINS.map((d) => (
              <tr key={d.domain} className="border-b border-border/50">
                <td className="py-1.5 pr-2 font-semibold">{d.label}</td>
                <td className="px-2"><AdminBadge tone={d.status === 'unsupported' ? 'danger' : d.status === 'limit_unknown' || d.status === 'insufficient_data' ? 'neutral' : 'warning'}>{d.status}</AdminBadge></td>
                <td className="px-2 text-[10px] text-muted-foreground">{d.note}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {/* ── Usage ── */}
      {tab === 'usage' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Capacity Metric (실측)" description="AI 는 Metric/Limit/Threshold 를 생성·수정할 수 없습니다. 활성화·Limit 입력은 관리자 승인 + Audit 로 기록됩니다. Limit 미입력 시 limit_unknown." />
          <div className="flex items-center gap-2">
            <input value={limitInput} onChange={(e) => setLimitInput(e.target.value)} placeholder="hard limit(선택 — Provider 요금표 근거)" className="w-64 rounded-md border border-border bg-background px-2 py-1 text-[11px]" aria-label="hard limit" />
          </div>
          {metrics.map((m) => {
            const s = latestSnap(m.id);
            return (
              <div key={m.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <span className="font-semibold">{m.title}</span>
                <AdminBadge tone="neutral">{m.domain}</AdminBadge>
                <AdminBadge tone={m.is_active ? 'success' : 'warning'}>{m.is_active ? 'active' : '미활성'}</AdminBadge>
                <span className="text-[10px] text-muted-foreground">
                  usage {m.unit === 'bytes' ? BYTES(s?.current_usage ?? null) : NUM(s?.current_usage)} · limit {m.hard_limit == null ? 'limit_unknown' : m.unit === 'bytes' ? BYTES(m.hard_limit) : NUM(m.hard_limit)}
                </span>
                {s && <AdminBadge tone={CAP_STATUS_TONE[s.status] ?? 'neutral'}>{s.status}</AdminBadge>}
                <div className="ml-auto flex gap-1">
                  {!m.is_active && <button disabled={busy} onClick={() => void act(() => saveCapacityMetric({ metric_code: m.metric_code, is_active: true, change_reason: '관리자 활성화(실측 근거 확인)', evidence: [{ label: 'source', value: m.source_type }] }), 'Metric 활성화')} className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">활성화</button>}
                  {limitInput && <button disabled={busy} onClick={() => { const v = Number(limitInput); if (!Number.isFinite(v) || v < 0) { toast.error('limit 은 0 이상 숫자'); return; }
                    void act(() => saveCapacityMetric({ metric_code: m.metric_code, hard_limit: v, limit_source: 'admin_entered', change_reason: '관리자 limit 입력(요금표/Plan 근거)', evidence: [{ label: 'limit_source', value: 'admin_entered' }] }), 'Limit 입력(관리자)'); }} className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Limit 입력</button>}
                  <button disabled={busy || !m.is_active} onClick={() => void act(() => createCapacitySnapshot(m.id), '실측 Snapshot 생성')} className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-40">실측 수집</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Baselines ── */}
      {tab === 'baselines' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Usage Baseline" description="7일 미만 데이터로는 7d/30d Baseline 을 만들지 않습니다(정직 표기)." />
          {SERIES.map(({ code, label, series }) => {
            const b = calculateUsageBaseline(series);
            return (
              <div key={code} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <span className="font-semibold">{label}</span>
                <span className="text-[10px] text-muted-foreground">일 평균 {NUM(b.dailyAverage)} · 피크 {NUM(b.peak)} · 7d {b.avg7d == null ? '—(데이터 부족)' : NUM(b.avg7d)} · 30d {b.avg30d == null ? '—(30일 미만)' : NUM(b.avg30d)} · 관측 {b.coverageDays}일</span>
                <AdminBadge tone={b.status === 'available' ? 'success' : b.status === 'partial' ? 'warning' : 'neutral'}>{b.status}</AdminBadge>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Demand Trends ── */}
      {tab === 'trends' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Demand Trend" description="한 번의 Spike 만으로 increasing 판정하지 않습니다(outlier 제거 후 재검증)." />
          {SERIES.map(({ code, label }) => {
            const t = trendOf(code);
            return (
              <div key={code} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <span className="font-semibold">{label}</span>
                <AdminBadge tone={t.trend === 'increasing' ? 'info' : t.trend === 'decreasing' ? 'warning' : t.trend === 'volatile' ? 'danger' : t.trend === 'stable' ? 'success' : 'neutral'}>{t.trend}</AdminBadge>
                <span className="text-[10px] text-muted-foreground">최근 {NUM(t.recentAvg)} vs 이전 {NUM(t.previousAvg)} · 변화 {t.relativeChangePct == null ? '—' : `${t.relativeChangePct}%`} · 변동성 {t.volatility == null ? '—' : `${t.volatility}%`} · outlier {t.outliers} · 표본 {t.sampleDays}일</span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Forecasts ── */}
      {tab === 'forecasts' && (
        <div className="space-y-2">
          <AdminAlert tone="warning" title="Demand Forecast — 예측값(Actual 아님)" description="Deterministic Trend Forecast(moving average/linear trend). Horizon 1/7/30일 — 90일은 데이터 축적 전 미지원. 예측값은 실제 Usage 로 저장되지 않습니다." />
          {SERIES.flatMap(({ code, label, series }) => [7, 30].map((h) => {
            const f = forecastDemand(series, h);
            return (
              <div key={`${code}-${h}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone="info">예측값 — Actual 아님</AdminBadge>
                <span className="font-semibold">{label} +{h}d</span>
                {f.modelType === 'insufficient_data' ? <AdminBadge tone="neutral">insufficient_data</AdminBadge> : (
                  <span className="text-[10px] text-muted-foreground">point {NUM(f.pointForecast)} [{NUM(f.lowerBound)} ~ {NUM(f.upperBound)}] · confidence {f.confidence} · model {f.modelType} · 학습 {f.trainingDays}일</span>
                )}
              </div>
            );
          }))}
        </div>
      )}

      {/* ── Headroom ── */}
      {tab === 'headroom' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Capacity Headroom" description="Limit 이 없으면 Headroom/Utilization 을 계산하지 않습니다(null 유지, limit_unknown)." />
          {metrics.filter((m) => m.is_active).map((m) => {
            const s = latestSnap(m.id);
            const h = calculateHeadroom(s?.current_usage ?? null, m.soft_limit, m.hard_limit);
            return (
              <div key={m.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <span className="font-semibold">{m.metric_code}</span>
                <AdminBadge tone={h.status === 'ok' ? 'success' : h.status === 'invalid' ? 'danger' : 'neutral'}>{h.status}</AdminBadge>
                <span className="text-[10px] text-muted-foreground">usage {NUM(s?.current_usage)} · hard headroom {h.hardHeadroom == null ? 'limit_unknown' : NUM(h.hardHeadroom)} · utilization {h.utilizationPct == null ? '—' : `${h.utilizationPct}%`}</span>
              </div>
            );
          })}
          {!metrics.some((m) => m.is_active) && <AdminEmpty icon={<Gauge size={20} />} title="활성 Metric 없음" description="Usage 탭에서 활성화하세요." />}
        </div>
      )}

      {/* ── Saturation ── */}
      {tab === 'saturation' && (
        <div className="space-y-2">
          <AdminAlert tone="warning" title="Saturation Risk (자동 증설 없음)" description="Limit 을 추정해서 Saturation 으로 보고하지 않습니다 — limit_unknown 은 판정 제외. Critical 이어도 자동 Scale 하지 않습니다." />
          {metrics.filter((m) => m.is_active).map((m) => {
            const s = latestSnap(m.id);
            const trend = SERIES.some((x) => x.code === m.metric_code) ? trendOf(m.metric_code) : null;
            const r = calculateSaturationRisk({
              utilizationRisk: s?.utilization_percent ?? null,
              forecastUtilizationRisk: null,
              growthRisk: trend ? (trend.trend === 'increasing' ? 70 : trend.trend === 'volatile' ? 50 : 10) : null,
              volatilityRisk: trend?.volatility ?? null,
              exhaustionProximityRisk: s?.projected_exhaustion_at ? 80 : s?.hard_limit != null ? 10 : null,
              sloRisk: null, incidentRisk: null, monitoringRisk: null,
            }, m.hard_limit != null);
            return (
              <div key={m.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <span className="font-semibold">{m.metric_code}</span>
                <AdminBadge tone={r.risk === 'critical' ? 'danger' : r.risk === 'high' ? 'warning' : r.risk === 'moderate' ? 'info' : r.risk === 'low' ? 'success' : 'neutral'}>{r.risk}</AdminBadge>
                {r.score !== null && <span className="text-[10px] text-muted-foreground">score {r.score} · 제외 성분 {r.missing.length}</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Exhaustion ── */}
      {tab === 'exhaustion' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Time to Exhaustion" description="실제 Limit + 양의 성장률에서만 계산합니다. 성장 0/음수·limit 미확인이면 날짜를 생성하지 않으며, 정확한 날짜 단정이 아닙니다." />
          {metrics.filter((m) => m.is_active).map((m) => {
            const s = latestSnap(m.id);
            const e = estimateTimeToExhaustion({ usage: s?.current_usage ?? null, hardLimit: m.hard_limit, growthPerDay: s?.growth_per_day ?? null, confidence: null, now });
            return (
              <div key={m.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <span className="font-semibold">{m.metric_code}</span>
                <AdminBadge tone={e.status === 'estimated' ? 'warning' : e.status === 'already_exhausted' ? 'danger' : 'neutral'}>{e.status}</AdminBadge>
                {e.estimatedDate && <span className="text-[10px] text-muted-foreground">추정 {e.estimatedDate} (범위 {e.range?.[0]} ~ {e.range?.[1]}) · {e.limitations[0]}</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Budget ── */}
      {tab === 'budget' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Capacity Budget (관리 기준 — 실행 권한 아님)" description="Budget 은 soft limit 로 관리되며 AI 가 직접 변경하지 않습니다(관리자 입력만)." />
          {metrics.map((m) => (
            <div key={m.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <span className="font-semibold">{m.metric_code}</span>
              <span className="text-[10px] text-muted-foreground">soft(budget) {m.soft_limit == null ? '미설정' : NUM(m.soft_limit)} · hard {m.hard_limit == null ? 'limit_unknown' : NUM(m.hard_limit)} · warning {m.warning_threshold}% · critical {m.critical_threshold}%</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Cost Models ── */}
      {tab === 'costmodels' && (
        <div className="space-y-2">
          <AdminAlert tone="warning" title="Cost Model (관리자 입력 단가만)" description="실제 청구서/공식 요금표 근거 없이 단가를 생성하지 않습니다. AI 는 단가를 수정할 수 없습니다. 단가 미입력 상태의 비용은 전부 cost_unknown." />
          <button disabled={busy} onClick={() => void act(() => saveCostModel({ cost_code: 'supabase_pro_base', provider: 'supabase', resource_type: 'plan_base', unit: 'month', unit_price: 25, currency: 'USD', billing_period: 'monthly', source: 'Supabase 공식 요금표(Pro $25/mo) — 관리자 확인 필요', evidence: [{ label: 'source', value: 'supabase.com/pricing' }] }), 'Cost Model 초안 저장(관리자 확인 필요)')} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-50">+ Supabase 요금표 기반 초안(관리자 검증 필요)</button>
          {!costModels.length ? <AdminEmpty icon={<Banknote size={20} />} title="Cost Model 없음 — cost_unknown" description="청구서/요금표 근거로 관리자가 입력해야 비용 계산이 가능합니다." /> : (
            costModels.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <span className="font-semibold">{c.cost_code}</span>
                <AdminBadge tone="neutral">v{c.version}</AdminBadge>
                <span className="text-[10px] text-muted-foreground">{c.provider}/{c.resource_type} · {c.unit_price} {c.currency}/{c.unit} · included {NUM(c.included_amount)} · overage {NUM(c.overage_price)} · 근거: {c.source.slice(0, 40)}</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Cost Actuals ── */}
      {tab === 'costactuals' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Cost Actuals" description="Actual(청구 기록)과 Estimated(단가×사용량)를 다른 Badge 로 분리합니다. 청구서 연동이 없어 Actual 은 관리자 수동 기록만 가능합니다." />
          {costModels.length > 0 && (
            <button disabled={busy} onClick={() => {
              const model = costModels[0];
              const monthEvents = usage.reduce((a, u) => a + u.events, 0);
              const est = calculateEstimatedCost({ usage: 1, unitPrice: model.unit_price, includedAmount: model.included_amount, overagePrice: model.overage_price });
              void act(() => saveCostSnapshot({
                period_start: new Date(now.getTime() - 30 * 86400000).toISOString(), period_end: now.toISOString(),
                provider: model.provider, resource_type: model.resource_type, usage_amount: monthEvents,
                estimated_cost: est.estimatedCost, currency: model.currency, model_version: `v${model.version}`, status: 'estimated',
                evidence: [{ label: 'model', value: model.cost_code }, { label: 'estimated', value: true }],
              }), 'Estimated Cost 기록(청구서 아님)');
            }} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-50">+ Estimated Cost 기록(모델 기반)</button>
          )}
          {!costSnaps.length ? <AdminEmpty icon={<Wallet size={20} />} title="Cost 기록 없음 — cost_unknown" /> : (
            costSnaps.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone={c.status === 'actual' ? 'success' : c.status === 'estimated' ? 'info' : 'neutral'}>{c.status}</AdminBadge>
                <span className="font-semibold">{c.provider}/{c.resource_type}</span>
                <span className="text-[10px] text-muted-foreground">{c.period_end.slice(0, 10)} · usage {NUM(c.usage_amount)} · est {NUM(c.estimated_cost)} · actual {NUM(c.actual_cost)} {c.currency}</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Cost Forecast ── */}
      {tab === 'costforecast' && (
        <div className="space-y-2">
          <AdminAlert tone="warning" title="Cost Forecast — 예측값(Actual 아님)" description="단가(Cost Model)가 없으면 cost_unknown 으로 표시하고 계산하지 않습니다." />
          {(() => {
            const model = costModels[0] ?? null;
            const f7 = forecastDemand(eventSeries, 7);
            const cf = forecastCost({ currentUsage: eventSeries.at(-1)?.value ?? null, forecastUsage: f7.pointForecast, unitPrice: model?.unit_price ?? null, includedAmount: model?.included_amount, overagePrice: model?.overage_price, confidence: f7.confidence });
            return (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone={cf.status === 'estimated' ? 'info' : 'neutral'}>{cf.status}</AdminBadge>
                <span className="text-[10px] text-muted-foreground">{cf.status === 'cost_unknown' ? '단가 미입력 — 비용 예측 불가(cost_unknown)' : `현재 ${NUM(cf.currentCost)} → +7d ${NUM(cf.forecastCost)} (${model?.currency ?? ''}) · confidence ${cf.confidence ?? '—'} · 예측값 — Actual 아님`}</span>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Unit Economics ── */}
      {tab === 'uniteconomics' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Unit Economics" description="실제 비용과 분모가 모두 존재할 때만 계산합니다. 없으면 null(0 조작 없음)." />
          {(() => {
            const actual = costSnaps.find((c) => c.status === 'actual')?.actual_cost ?? null;
            const stores = usage.at(-1)?.active_stores ?? null;
            const events = usage.reduce((a, u) => a + u.events, 0) || null;
            const rows = [
              { label: 'Cost per Active Store', value: calculateUnitEconomics(actual, stores) },
              { label: 'Cost per 1,000 Playback Events', value: calculateUnitEconomics(actual, events ? events / 1000 : null) },
            ];
            return rows.map((r) => (
              <div key={r.label} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <span className="font-semibold">{r.label}</span>
                <span className="text-[10px] text-muted-foreground">{r.value == null ? 'cost_unknown(실제 비용/분모 없음)' : NUM(r.value)}</span>
              </div>
            ));
          })()}
        </div>
      )}

      {/* ── Anomalies ── */}
      {tab === 'anomalies' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Cost Anomaly" description="청구 데이터(Actual) 2건 미만이면 미지원. 이상 징후를 Fraud 로 단정하지 않습니다." />
          {(() => {
            const r = detectCostAnomaly(costSnaps.map((c) => ({ period_end: c.period_end, actual_cost: c.actual_cost, estimated_cost: c.estimated_cost, usage_amount: c.usage_amount })));
            if (r.status === 'unsupported') return <AdminEmpty icon={<AlertTriangle size={20} />} title="미지원 — 청구 데이터 부족" description="Actual Cost 기록이 2건 이상 필요합니다." />;
            if (!r.anomalies.length) return <AdminEmpty icon={<AlertTriangle size={20} />} title="이상 징후 없음" />;
            return r.anomalies.map((a, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone={a.severity === 'high' ? 'danger' : 'warning'}>{a.type}</AdminBadge>
                <span className="text-[10px] text-muted-foreground">{a.note}</span>
              </div>
            ));
          })()}
        </div>
      )}

      {/* ── Recommendations ── */}
      {tab === 'recommendations' && (
        <div className="space-y-2">
          <AdminAlert tone="warning" title="Capacity Recommendation (실행 명령 없음)" description="권고는 Reason/Evidence/Risk/Cost Impact/Preconditions 를 포함하며 자동 실행/자동 Execution Plan 생성이 없습니다." />
          {metrics.filter((m) => m.is_active).map((m) => {
            const s = latestSnap(m.id);
            const trend = SERIES.some((x) => x.code === m.metric_code) ? trendOf(m.metric_code).trend : 'insufficient_data' as const;
            const r = buildCapacityRecommendation({
              metricCode: m.metric_code, status: s?.status ?? 'insufficient_data', utilizationPct: s?.utilization_percent ?? null,
              trend, exhaustionDays: null, limitKnown: m.hard_limit != null, costKnown: costModels.length > 0,
            });
            return (
              <div key={m.id} className="rounded-lg border border-border p-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{m.metric_code}</span>
                  <AdminBadge tone={r.risk === 'critical' ? 'danger' : r.risk === 'high' ? 'warning' : 'info'}>{r.type}</AdminBadge>
                  <span className="text-[10px] text-muted-foreground">{r.reason} · cost impact: {r.costImpact}</span>
                  <button disabled={busy} onClick={() => void act(() => saveCapacityPlan({
                    plan_code: `cap_${m.metric_code}_${now.toISOString().slice(0, 10)}`, metric_code: m.metric_code,
                    plan_type: r.type === 'prepare_scale_plan' ? 'scale_up_review' : r.type === 'optimize_storage' ? 'storage_optimization' : r.type === 'review_provider_plan' ? 'provider_plan_review' : 'monitor_only',
                    trigger_condition: r.reason, risk_tier: r.risk === 'critical' ? 'critical' : r.risk === 'high' ? 'high' : 'medium',
                    expected_cost: costModels.length ? { status: 'estimated_possible' } : { status: 'cost_unknown' },
                    evidence: r.evidence, limitations: r.limitations, idempotency_key: `capplan_${m.metric_code}_${now.toISOString().slice(0, 10)}`,
                  }), '계획 초안 저장(실행 아님)')} className="ml-auto rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">계획 초안 생성</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Plans ── */}
      {tab === 'plans' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Scaling Plans (계획 문서 — 실행 상태 없음)" description="approved_reference 는 참고 승인일 뿐 실제 Scale 실행이 아닙니다." />
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="검토 사유(필수)" className="w-full rounded-md border border-border bg-background px-2 py-1 text-[11px]" aria-label="plan 사유" />
          {!plans.length ? <AdminEmpty icon={<Waypoints size={20} />} title="Plan 없음" /> : plans.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <span className="font-semibold">{p.plan_code.slice(0, 30)}</span>
              <AdminBadge tone="neutral">{p.plan_type}</AdminBadge>
              <AdminBadge tone={p.status === 'approved_reference' ? 'success' : p.status === 'rejected' ? 'danger' : 'warning'}>{p.status}</AdminBadge>
              <span className="text-[10px] text-muted-foreground">{p.trigger_condition.slice(0, 40)}</span>
              {['draft', 'pending_review'].includes(p.status) && (
                <div className="ml-auto flex gap-1">
                  {(['approved_reference', 'rejected'] as const).map((st) => (
                    <button key={st} disabled={busy} onClick={() => { if (!reason.trim()) { toast.error('사유 필수'); return; } void act(() => reviewCapacityPlan(p.id, st, reason.trim()), `검토: ${st}`); setReason(''); }} className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{st === 'approved_reference' ? '참고 승인' : '기각'}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Dependencies ── */}
      {tab === 'dependencies' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Dependency Inventory" description="코드/설정에서 확인된 항목만 등록됩니다(seed 7종은 draft — 관리자 확정 필요). AI 가 Dependency 를 임의 생성하지 않습니다." />
          {deps.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={d.criticality === 'critical' ? 'danger' : d.criticality === 'high' ? 'warning' : 'neutral'}>{d.criticality}</AdminBadge>
              <span className="font-semibold">{d.service_name}</span>
              <span className="text-[10px] text-muted-foreground">{d.domain} · {d.provider} · fallback {d.fallback_available === true ? '있음' : d.fallback_available === false ? '없음' : '미확인'} · {d.failure_impact ?? ''}</span>
              <AdminBadge tone={d.lifecycle_status === 'active' ? 'success' : 'warning'}>{d.lifecycle_status}</AdminBadge>
              {d.lifecycle_status === 'draft' && (
                <button disabled={busy} onClick={() => void act(() => saveOperationalDependency({ dependency_code: d.dependency_code, lifecycle_status: 'active', change_reason: '관리자 확정(코드 근거 확인)' }), 'Dependency 확정')} className="ml-auto rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">확정</button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── SPOF ── */}
      {tab === 'spof' && (
        <div className="space-y-2">
          <AdminAlert tone="warning" title="Single Point of Failure" description="no_known_spof 는 SPOF 가 절대 없다는 뜻이 아니라 현재 Evidence 에서 확인되지 않았다는 뜻입니다." />
          {deps.map((d) => {
            const s = detectSinglePointOfFailure(d as unknown as DependencyLike);
            return (
              <div key={d.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <span className="font-semibold">{d.service_name}</span>
                <AdminBadge tone={s.status === 'confirmed_spof' ? 'danger' : s.status === 'potential_spof' ? 'warning' : s.status === 'no_known_spof' ? 'success' : 'neutral'}>{s.status}</AdminBadge>
                <span className="text-[10px] text-muted-foreground">{s.gaps.join(' · ') || '확인된 공백 없음'}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── RTO/RPO ── */}
      {tab === 'rtorpo' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="RTO / RPO" description="실제 승인된 목표만 저장합니다. AI 가 목표를 생성·수정하지 않으며 미정의는 not_defined 로 표시합니다." />
          {deps.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <span className="font-semibold">{d.service_name}</span>
              <span className="text-[10px] text-muted-foreground">RTO {d.rto_target} · RPO {d.rpo_target} · owner {d.owner ?? '미지정'}</span>
              {d.rto_target === 'not_defined' && <AdminBadge tone="warning">not_defined</AdminBadge>}
            </div>
          ))}
        </div>
      )}

      {/* ── Readiness ── */}
      {tab === 'readiness' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <AdminBadge tone={READINESS_TONE[readiness.readiness]}>{readiness.readiness}</AdminBadge>
            <span className="text-[10px] text-muted-foreground">{readiness.reasons.join(' · ') || '확인된 공백 없음'}</span>
          </div>
          <AdminAlert tone="warning" description="Backup 구성/Restore 검증/Failover 는 현재 Evidence 로 확인되지 않아 미확인으로 처리합니다(자동 Backup/Restore 실행 없음)." />
        </div>
      )}

      {/* ── Stress Scenarios ── */}
      {tab === 'stress' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Capacity Stress Scenario (Evidence-only)" description="실제 장애·부하를 주입하지 않습니다. Limit 미입력 metric 은 판정 불가(unsupported)." />
          {metrics.filter((m) => m.is_active).flatMap((m) => {
            const s = latestSnap(m.id);
            return [2].map((mult) => {
              const r = evaluateCapacityStressScenario({ scenario: `${m.metric_code}_${mult}x`, multiplier: mult, usage: s?.current_usage ?? null, hardLimit: m.hard_limit });
              return (
                <div key={`${m.id}-${mult}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                  <span className="font-semibold">{m.metric_code} ×{mult}</span>
                  <AdminBadge tone={SCENARIO_TONE[r.result]}>{r.result}</AdminBadge>
                  <span className="text-[10px] text-muted-foreground">projected {NUM(r.projectedUsage)} · util {r.projectedUtilizationPct == null ? 'limit_unknown' : `${r.projectedUtilizationPct}%`} · {r.note}</span>
                </div>
              );
            });
          })}
        </div>
      )}

      {/* ── Continuity Scenarios ── */}
      {tab === 'continuity' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Continuity Scenario (Evidence-only)" description="실제 장애를 발생시키지 않습니다. RTO 미정의 시 복구 시간은 not_defined." />
          {deps.map((d) => {
            const r = evaluateContinuityScenario({ scenario: `${d.dependency_code}_unavailable`, dependency: d as unknown as DependencyLike, blastRadius: d.failure_impact ?? '미확인' });
            return (
              <div key={d.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <span className="font-semibold">{d.service_name} 장애 시</span>
                <AdminBadge tone={SCENARIO_TONE[r.result]}>{r.result}</AdminBadge>
                <span className="text-[10px] text-muted-foreground">영향: {r.affected.slice(0, 30)} · fallback {r.fallback} · 복구 {r.estimatedRecovery}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Audit ── */}
      {tab === 'audit' && (
        <div className="space-y-2">
          {!audit.length ? <AdminEmpty icon={<ScrollText size={20} />} title="Audit 없음" /> : audit.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <span className="text-[10px] text-muted-foreground">{a.created_at.slice(0, 16)}</span>
              <AdminBadge tone={a.event_type.includes('exhausted') || a.event_type.includes('anomaly') ? 'danger' : a.event_type.includes('saturation') ? 'warning' : 'neutral'}>{a.event_type}</AdminBadge>
              <span className="text-[10px] text-muted-foreground">{(a.detail ?? '').slice(0, 80)}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Support Matrix ── */}
      {tab === 'support' && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">기능</th><th className="px-2">상태</th><th className="px-2">근거</th></tr></thead>
            <tbody>{CAP_SUPPORT.map((s) => (
              <tr key={s.key} className="border-b border-border/50">
                <td className="py-1.5 pr-2 font-semibold">{s.label}</td>
                <td className="px-2"><AdminBadge tone={s.status === 'fully_supported' ? 'success' : s.status === 'unsupported' ? 'danger' : s.status === 'limit_unknown' || s.status === 'cost_unknown' || s.status === 'insufficient_data' ? 'neutral' : 'warning'}>{s.status}</AdminBadge></td>
                <td className="px-2 text-[10px] text-muted-foreground">{s.note}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </AdminCard>
  );
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <p className="text-[10px] font-bold text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-sm font-black">{value}</p>
    </div>
  );
}
