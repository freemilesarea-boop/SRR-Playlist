/**
 * ExecutivePerformanceSection — Enterprise Performance Intelligence, KPI Intelligence &
 * Executive Performance Center (Phase AI-OPS-22).
 *
 * Outcome→Business Performance→KPI Intelligence→Executive Performance→Strategic Learning.
 * KPI 자동 생성/수정/목표 변경 없음 · KPI ≠ Business Success · Trend ≠ Guarantee ·
 * Correlation ≠ Causation · Forecast ≠ Actual · Variance ≠ Failure · Health ≠ Business Quality.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3, Gauge, GitBranch, Grid3x3, HeartPulse, History, Layers, Lightbulb,
  ListChecks, Lock, RefreshCw, Scale, ScrollText, Target, TrendingUp,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchPerformanceSummary, createKpiDefinition, setKpiTarget, reviewKpiDefinition,
  fetchKpiDefinitions, recordKpiSnapshot, captureKpiSnapshot, fetchKpiSnapshots,
  fetchPerformanceTimeline, recordPerformanceGovernance, fetchPerformanceAudit,
  type PerformanceSummary, type KpiDefinitionRow, type KpiSnapshotRow,
  type PerformanceTimelinePoint, type PerformanceEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  buildKpiHierarchy, analyzeKpiAttribution, classifyVariance, classifyTrend,
  assessKpiHealth, compareBenchmark, correlateStrategyPerformance,
  buildExecutiveBriefing, buildPerformanceRecommendation, buildPerformanceCockpit,
  PERFORMANCE_SUPPORT,
} from '@/lib/performanceIntelligence';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const KPI_TERMINAL = ['retired_reference', 'invalidated'];

type Tab = 'cockpit' | 'dashboard' | 'kpis' | 'snapshots' | 'hierarchy' | 'attribution' | 'variance'
  | 'trend' | 'health' | 'benchmark' | 'correlation' | 'briefing' | 'recommendations'
  | 'humanreviews' | 'external' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'cockpit', label: 'Executive Performance Cockpit', icon: Layers },
  { key: 'dashboard', label: 'Executive Performance Dashboard', icon: Gauge },
  { key: 'kpis', label: 'Enterprise KPI Intelligence', icon: Target },
  { key: 'snapshots', label: 'KPI Snapshots', icon: ListChecks },
  { key: 'hierarchy', label: 'KPI Hierarchy', icon: GitBranch },
  { key: 'attribution', label: 'KPI Attribution', icon: Lightbulb },
  { key: 'variance', label: 'KPI Variance', icon: Scale },
  { key: 'trend', label: 'KPI Trends', icon: TrendingUp },
  { key: 'health', label: 'KPI Health', icon: HeartPulse },
  { key: 'benchmark', label: 'Performance Benchmark', icon: BarChart3 },
  { key: 'correlation', label: 'Strategy↔Performance', icon: GitBranch },
  { key: 'briefing', label: 'Executive Briefing', icon: ScrollText },
  { key: 'recommendations', label: 'Performance Recommendations', icon: Lightbulb },
  { key: 'humanreviews', label: 'Human Reviews', icon: Scale },
  { key: 'external', label: 'External References', icon: ScrollText },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

const KPI_SOURCES = ['mrr', 'arr_derived', 'member_growth', 'active_stores', 'active_artists', 'listening_hours', 'playlist_quality_proxy', 'system_stability_proxy'] as const;

export default function ExecutivePerformanceSection() {
  const [tab, setTab] = useState<Tab>('cockpit');
  const [summary, setSummary] = useState<PerformanceSummary>({});
  const [kpis, setKpis] = useState<KpiDefinitionRow[]>([]);
  const [snapshots, setSnapshots] = useState<KpiSnapshotRow[]>([]);
  const [timeline, setTimeline] = useState<PerformanceTimelinePoint[]>([]);
  const [audit, setAudit] = useState<PerformanceEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, k, sn, tl, au] = await Promise.all([
        fetchPerformanceSummary(), fetchKpiDefinitions(null, 100), fetchKpiSnapshots(null, 100),
        fetchPerformanceTimeline(30), fetchPerformanceAudit(100),
      ]);
      setSummary(s); setKpis(k); setSnapshots(sn); setTimeline(tl); setAudit(au);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await load(); }
    catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };
  const needReason = (): string | null => {
    if (!reason.trim()) { toast.error('사유/내용 필수(Human Decision)'); return null; }
    return reason.trim();
  };
  const needNumber = (): number | null => {
    const n = Number(reason.trim());
    if (!reason.trim() || !Number.isFinite(n)) { toast.error('숫자 입력 필요(null→0 변환 금지)'); return null; }
    return n;
  };

  const actuals = useMemo(() => (typeof summary.kpi_actuals === 'object' && summary.kpi_actuals !== null && !Array.isArray(summary.kpi_actuals) ? summary.kpi_actuals as Record<string, unknown> : {}), [summary]);
  const num = (k: string): number | null => (typeof actuals[k] === 'number' ? actuals[k] as number : null);
  const latestSnap = useCallback((kpiId: string) => snapshots.find((s) => s.kpi_id === kpiId && s.source_kind === 'measured') ?? snapshots.find((s) => s.kpi_id === kpiId) ?? null, [snapshots]);

  const hierarchy = useMemo(() => buildKpiHierarchy(kpis.filter((k) => !KPI_TERMINAL.includes(k.kpi_status)).map((k) => ({ id: k.id, level: k.hierarchy_level, label: k.kpi_code, parentId: k.parent_kpi_id }))), [kpis]);

  const trends = useMemo(() => ([
    { metric: 'new_members', t: classifyTrend(timeline.map((p) => ({ value: p.new_members }))) },
    { metric: 'listening_hours', t: classifyTrend(timeline.map((p) => ({ value: p.listening_hours }))) },
    { metric: 'play_starts', t: classifyTrend(timeline.map((p) => ({ value: p.play_starts }))) },
    { metric: 'player_errors', t: classifyTrend(timeline.map((p) => ({ value: p.player_errors }))) },
    { metric: 'active_stores', t: classifyTrend(timeline.map((p) => ({ value: p.active_stores }))) },
  ]), [timeline]);

  const variances = useMemo(() => kpis.filter((k) => !KPI_TERMINAL.includes(k.kpi_status)).map((k) => {
    const snap = latestSnap(k.id);
    return { k, v: classifyVariance({ actual: snap?.actual_value ?? null, target: k.target_value ?? snap?.target_value ?? null, direction: k.direction === 'lower_is_better' ? 'lower_is_better' : 'higher_is_better' }) };
  }), [kpis, latestSnap]);

  const healths = useMemo(() => variances.map(({ k, v }) => {
    const trend = k.measurement_source === 'member_growth' ? trends[0].t : k.measurement_source === 'listening_hours' ? trends[1].t : k.measurement_source === 'system_stability_proxy' ? trends[3].t : null;
    return { k, h: assessKpiHealth({ variance: v.verdict, trend: trend?.trend ?? null, evidence: latestSnap(k.id) ? ['measured snapshot'] : [] }) };
  }), [variances, trends, latestSnap]);

  const attributions = useMemo(() => trends.filter(({ t }) => t.dataStatus === 'ok').slice(0, 5).map(({ metric, t }) => analyzeKpiAttribution({
    kpiKey: metric,
    direction: t.trend === 'improving' ? 'up' : t.trend === 'declining' ? 'down' : t.trend === 'stable' ? 'flat' : 'unknown',
    candidateFactors: metric === 'listening_hours' ? ['재생 활동 변화(play_starts 실측)', '활동 매장 수 변화(active_stores 실측)'] : metric === 'player_errors' ? ['플레이어 오류 발생(playback_events_v2 실측)'] : ['신규 가입/활동 변화(실측 시계열)'],
    evidence: [`timeline ${timeline.length}일 실측`],
    unknownFactors: ['계절성', '외부 요인(자료 없음)'],
  })), [trends, timeline]);

  const half = Math.floor(timeline.length / 2);
  const sumRange = useCallback((rows: PerformanceTimelinePoint[], key: 'new_members' | 'play_starts' | 'player_errors') => rows.reduce((a, p) => a + (p[key] ?? 0), 0), []);
  const benchmarks = useMemo(() => {
    const prev = timeline.slice(0, half); const cur = timeline.slice(half);
    const hours = (rows: PerformanceTimelinePoint[]) => { const vals = rows.map((p) => p.listening_hours).filter((v): v is number => v != null); return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) * 100) / 100 : null; };
    return [
      compareBenchmark({ metric: 'new_members', current: cur.length ? sumRange(cur, 'new_members') : null, previous: prev.length ? sumRange(prev, 'new_members') : null, previousLabel: 'previous_period(15d)' }),
      compareBenchmark({ metric: 'listening_hours', current: hours(cur), previous: hours(prev), previousLabel: 'previous_period(15d)' }),
      compareBenchmark({ metric: 'play_starts', current: cur.length ? sumRange(cur, 'play_starts') : null, previous: prev.length ? sumRange(prev, 'play_starts') : null, previousLabel: 'previous_period(15d)' }),
      compareBenchmark({ metric: 'mrr', current: num('mrr'), previous: null, previousLabel: 'previous_quarter' }),   // 이전 분기 시계열 원본 없음 → unavailable 정직 표기
      compareBenchmark({ metric: 'mrr', current: num('mrr'), previous: null, previousLabel: 'previous_year' }),
    ];
  }, [timeline, half, sumRange, actuals]);   // eslint-disable-line react-hooks/exhaustive-deps

  const correlations = useMemo(() => correlateStrategyPerformance([
    { label: 'Execution(play_starts) ↔ Outcome(listening_hours)', strategySignal: trends[2].t.changePct, kpiSignal: trends[1].t.changePct, sample: timeline.length },
    { label: 'Growth(new_members) ↔ Activity(active_stores)', strategySignal: trends[0].t.changePct, kpiSignal: trends[4].t.changePct, sample: timeline.length },
    { label: 'Strategy(objectives 0524) ↔ MRR', strategySignal: null, kpiSignal: null, sample: 0 },   // 전략→MRR 시계열 원본 없음
  ]), [trends, timeline]);

  const briefing = useMemo(() => buildExecutiveBriefing({
    periodKind: 'weekly',
    kpiChanges: trends.filter(({ t }) => t.dataStatus === 'ok').map(({ metric, t }) => ({ kpi: metric, note: `${t.trend}(${t.changePct ?? '—'}%)` })),
    risks: healths.filter(({ h }) => h.health === 'at_risk').map(({ k }) => `${k.kpi_code} at_risk(근거 검토 필요)`),
    opportunities: variances.filter(({ v }) => v.verdict === 'positive').map(({ k }) => `${k.kpi_code} variance positive`),
    unknownFactors: ['외부 시장 자료 없음', '계절성 미검증'],
    executiveNotes: null,
  }), [trends, healths, variances]);

  const autoRecs = useMemo(() => {
    const out: { type: string; reason: string }[] = [];
    const push = (r: ReturnType<typeof buildPerformanceRecommendation>) => { if (!('rejected' in r)) out.push({ type: r.type, reason: r.reason }); };
    if (!kpis.length) push(buildPerformanceRecommendation({ type: 'review_kpi', reason: 'KPI 미정의 — 사람 정의 필요(자동 생성 불가)', evidence: ['kpi_definitions:0'], confidence: null, assumptions: [] }));
    const noSnap = kpis.filter((k) => !KPI_TERMINAL.includes(k.kpi_status) && !snapshots.some((s) => s.kpi_id === k.id)).length;
    if (noSnap > 0) push(buildPerformanceRecommendation({ type: 'gather_more_data', reason: `Snapshot 없는 KPI ${noSnap}건 — 측정 근거 필요`, evidence: [`no_snapshot:${noSnap}`], confidence: null, assumptions: [] }));
    const neg = variances.filter(({ v }) => v.verdict === 'negative').length;
    if (neg > 0) push(buildPerformanceRecommendation({ type: 'investigate_variance', reason: `Variance negative ${neg}건(Variance ≠ Failure) — 원인 검토`, evidence: [`negative:${neg}`], confidence: null, assumptions: [] }));
    const bad = trends.filter(({ t }) => t.trend === 'declining' || t.trend === 'volatile').length;
    if (bad > 0) push(buildPerformanceRecommendation({ type: 'review_trend', reason: `declining/volatile trend ${bad}건(Trend ≠ Guarantee)`, evidence: [`trends:${bad}`], confidence: null, assumptions: [] }));
    const unlinked = kpis.filter((k) => !KPI_TERMINAL.includes(k.kpi_status) && (k.linked_objective_ids ?? []).length === 0).length;
    if (unlinked > 0) push(buildPerformanceRecommendation({ type: 'review_strategy_link', reason: `Objective(0524) 미연결 KPI ${unlinked}건`, evidence: [`unlinked:${unlinked}`], confidence: null, assumptions: [] }));
    if (kpis.some((k) => k.kpi_status === 'kpi_unavailable')) push(buildPerformanceRecommendation({ type: 'validate_evidence', reason: 'kpi_unavailable KPI 존재 — 원본 확보 전 해석 금지', evidence: ['kpi_unavailable'], confidence: null, assumptions: [] }));
    return out;
  }, [kpis, snapshots, variances, trends]);

  const cockpit = useMemo(() => buildPerformanceCockpit({
    kpiTotal: kpis.length,
    kpiUnavailable: kpis.filter((k) => k.kpi_status === 'kpi_unavailable').length,
    hierarchyOrphans: hierarchy.orphans.length,
    trendsAnalyzed: trends.filter(({ t }) => t.dataStatus === 'ok').length,
    varianceNegative: variances.filter(({ v }) => v.verdict === 'negative').length,
    healthAtRisk: healths.filter(({ h }) => h.health === 'at_risk').length,
    benchmarksCompared: benchmarks.filter((b) => b.verdict === 'compared').length,
    recommendationsOpen: autoRecs.length,
    summaryNote: null,
  }), [kpis, hierarchy, trends, variances, healths, benchmarks, autoRecs]);

  if (loading) return <AdminCard title="Enterprise Performance Intelligence & Executive Performance Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Enterprise Performance Intelligence & Executive Performance Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  return (
    <AdminCard
      title="Enterprise Performance Intelligence & Executive Performance Center"
      subtitle="Outcome→Business Performance→KPI Intelligence→Executive Performance→Strategic Learning — KPI 자동 생성/수정/목표 변경 없음"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="자동 KPI 생성/수정/목표 변경, 자동 Strategy/Objective/Budget/계약/Production 변경, 자동 Merge/Deploy 는 없습니다. AI는 KPI 분석·관계 설명·변화 원인 후보 제시만 하며 KPI 를 사실 이상으로 해석하지 않습니다. KPI ≠ Business Success, Trend ≠ Guarantee, Correlation ≠ Causation, Forecast ≠ Actual, Variance ≠ Failure, Health ≠ Business Quality, Recommendation ≠ Decision." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {/* ── Cockpit ── */}
      {tab === 'cockpit' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
            {cockpit.sections.map((s) => (
              <div key={s.key} className="rounded-lg border border-border p-2">
                <p className="text-[10px] font-bold uppercase text-muted-foreground">{s.key}</p>
                <p className="mt-0.5 text-sm font-black">{s.headline}</p>
                <p className="text-[10px] text-muted-foreground">{s.detail}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">humanDecisionRequired · kpiIsNotBusinessSuccess</p>
        </div>
      )}

      {/* ── Dashboard(7영역 실측) ── */}
      {tab === 'dashboard' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Revenue — MRR 실측" value={NUM(num('mrr'))} />
            <Box label="ARR(=MRR×12 파생·계약 아님)" value={NUM(num('arr_derived'))} />
            <Box label="Growth — 신규 가입(30d)" value={NUM(num('new_members_30d'))} />
            <Box label="KPI Health — at_risk" value={NUM(healths.filter(({ h }) => h.health === 'at_risk').length)} />
            <Box label="Strategy Progress — Objectives(0524 참조)" value={NUM(typeof summary.objectives_0524 === 'number' ? summary.objectives_0524 : null)} />
            <Box label="Delivery — play_starts(30d)" value={NUM(num('play_starts_30d'))} />
            <Box label="Organizational Health" value="insufficient_data" />
            <Box label="Performance Summary — 권고" value={NUM(autoRecs.length)} />
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Active Stores(30d 재생 실측)" value={NUM(num('active_stores_30d'))} />
            <Box label="Active Artists(등록 실측)" value={NUM(num('active_artists_registered'))} />
            <Box label="Listening Hours(30d)" value={num('listening_hours_30d') == null ? 'null(표본 0 — 0 아님)' : NUM(num('listening_hours_30d'))} />
            <Box label="Playlist Quality(fit Proxy)" value={num('playlist_quality_proxy_avg_fit') == null ? 'null(표본 0)' : NUM(num('playlist_quality_proxy_avg_fit'))} />
          </div>
          <AdminAlert tone="info" description={`지원되지 않는 KPI(kpi_unavailable): ${Array.isArray(summary.kpi_unavailable) ? (summary.kpi_unavailable as unknown[]).map(String).join(', ') : '—'} — 원본 없음(임의 생성 금지). Organizational Health 는 조직 지표 원본이 없어 insufficient_data 로 유지합니다.`} />
        </div>
      )}

      {/* ── KPI 정의 ── */}
      {tab === 'kpis' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {KPI_SOURCES.slice(0, 4).map((src) => (
              <button key={src} disabled={busy} onClick={() => {
                const r = needReason(); if (!r) return;
                void act(() => createKpiDefinition({ code: `kpi_${src}_${now.toISOString().slice(0, 19)}`, title: r.slice(0, 100), source: src, evidence: [{ label: 'note', value: '사람 정의 KPI' }] }), `KPI 정의(${src} — 자동 생성 아님)`);
              }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">{src} KPI 정의</button>
            ))}
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="KPI 제목/사유/숫자(사람 입력·필수)" className="min-w-[220px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!kpis.length ? <AdminEmpty title="KPI 미정의" description="KPI 는 AI 가 자동 생성하지 않습니다 — 사람 정의만 기록됩니다." /> : kpis.map((k) => (
            <div key={k.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{k.kpi_code}</span>
                <AdminBadge tone="info">{k.measurement_source}</AdminBadge>
                <AdminBadge tone={k.kpi_status === 'at_risk_reference' ? 'danger' : k.kpi_status === 'active_reference' ? 'success' : k.kpi_status === 'kpi_unavailable' ? 'warning' : 'neutral'}>{k.kpi_status}</AdminBadge>
                <AdminBadge tone="neutral">{k.hierarchy_level}</AdminBadge>
                <span className="text-muted-foreground">{k.title} · target {k.target_value ?? 'null(미설정)'} · {k.review_cycle}</span>
              </div>
              {!KPI_TERMINAL.includes(k.kpi_status) && (
                <div className="mt-1 flex flex-wrap gap-1">
                  <button disabled={busy} onClick={() => { void act(() => captureKpiSnapshot(`cap_${k.id.slice(0, 8)}_${now.toISOString().slice(0, 19)}`, k.id, 'monthly'), '실측 Snapshot(KPI ≠ Business Success)'); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">실측 캡처</button>
                  <button disabled={busy} onClick={() => { const n = needNumber(); if (n == null) return; void act(() => setKpiTarget(k.id, n, '사람 목표 설정(자동 변경 아님)'), '목표 설정(사람)'); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">목표 설정(숫자 입력)</button>
                  {(['active_reference', 'watch_reference', 'at_risk_reference', 'under_review', 'paused_reference'] as const).map((st) => (
                    <button key={st} disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewKpiDefinition(k.id, st, rr), `${st}(Health ≠ Business Quality)`); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{st}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Snapshots ── */}
      {tab === 'snapshots' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy || !kpis.length} onClick={() => {
              const n = needNumber(); if (n == null || !kpis.length) return;
              void act(() => recordKpiSnapshot({ key: `fc_${now.toISOString().slice(0, 19)}`, kpiId: kpis[0].id, periodKind: 'monthly', sourceKind: 'forecast_reference', evidence: [{ label: 'note', value: '사람 입력 Forecast(Actual 아님)' }], forecast: n }), 'Forecast 기록(Forecast ≠ Actual)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">첫 KPI Forecast 기록(숫자)</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="숫자 입력(Forecast — Actual 아님)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!snapshots.length ? <AdminEmpty title="Snapshot 없음" description="실측 캡처 또는 사람 입력으로만 기록됩니다(append-only)." /> : snapshots.slice(0, 40).map((s) => (
            <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono text-muted-foreground">{s.created_at.slice(0, 16).replace('T', ' ')}</span>
              <AdminBadge tone={s.source_kind === 'measured' ? 'success' : s.source_kind === 'forecast_reference' ? 'warning' : 'info'}>{s.source_kind}</AdminBadge>
              <AdminBadge tone="neutral">{s.period_kind}</AdminBadge>
              <span className="ml-2">actual {s.actual_value ?? 'null(0 아님)'} · target {s.target_value ?? '—'} · forecast {s.forecast_value ?? '—'} · 표본 {s.sample_size ?? '—'}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Hierarchy ── */}
      {tab === 'hierarchy' && (
        <div className="space-y-2">
          {hierarchy.levels.map((l) => (
            <div key={l.level} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={l.nodes.length ? 'info' : 'neutral'}>{l.level}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{l.nodes.length ? l.nodes.slice(0, 6).map((n) => n.label + (n.linked ? '' : '(미연결)')).join(' · ') : '노드 없음'}</span>
            </div>
          ))}
          {hierarchy.orphans.length > 0 && <AdminAlert tone="warning" title={`미연결(orphan) ${hierarchy.orphans.length}건`} description="상위 계층과 연결되지 않은 KPI — 사람 검토 필요" />}
          {hierarchy.cycles.length > 0 && <AdminAlert tone="danger" title="Cycle 감지" description={hierarchy.cycles.join(' · ')} />}
          <p className="text-[10px] text-muted-foreground">Corporate Goal→Strategic Objective→Business KPI→Operational KPI→Execution Metrics 5단계</p>
        </div>
      )}

      {/* ── Attribution / Variance / Trend / Health ── */}
      {tab === 'attribution' && (
        !attributions.length ? <AdminEmpty title="Attribution 대상 없음" description="Trend 자료가 충분해지면 변화 원인 후보(인과 확정 아님)를 제시합니다." /> : (
          <div className="space-y-1">
            {attributions.map((a) => (
              <div key={a.kpiKey} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-bold">{a.kpiKey}</span>
                <AdminBadge tone={a.verdict === 'attribution_candidate' ? 'info' : 'warning'}>{a.verdict}</AdminBadge>
                <span className="ml-2 text-muted-foreground">{a.candidates.join(' · ') || '—'} · confidence {a.confidence ?? '—'} · 인과 확정 아님</span>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'variance' && (
        !variances.length ? <AdminEmpty title="Variance 대상 없음" description="KPI 와 Snapshot/Target 이 있어야 Variance 를 비교합니다." /> : (
          <div className="space-y-1">
            {variances.map(({ k, v }) => (
              <div key={k.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{k.kpi_code}</span>
                <AdminBadge tone={v.verdict === 'positive' ? 'success' : v.verdict === 'negative' ? 'danger' : v.verdict === 'variance_unknown' ? 'warning' : 'neutral'}>{v.verdict}</AdminBadge>
                <span className="ml-2 text-muted-foreground">variance {v.variance ?? 'null(자료 없음)'} · {v.variancePct == null ? '—' : `${v.variancePct}%`} · Variance ≠ Failure</span>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'trend' && (
        <div className="space-y-1">
          {trends.map(({ metric, t }) => (
            <div key={metric} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{metric}</span>
              {t.dataStatus === 'ok' ? (
                <AdminBadge tone={t.trend === 'improving' ? 'success' : t.trend === 'declining' ? 'danger' : t.trend === 'volatile' ? 'warning' : 'neutral'}>{t.trend}</AdminBadge>
              ) : <AdminBadge tone="warning">{t.dataStatus}</AdminBadge>}
              <span className="ml-2 text-muted-foreground">{t.changePct == null ? '변화율 계산 불가' : `${t.changePct}%`} · 30d 실측 · Trend ≠ Guarantee</span>
            </div>
          ))}
        </div>
      )}
      {tab === 'health' && (
        !healths.length ? <AdminEmpty title="Health 대상 없음" description="KPI 정의 + measured snapshot 이 있어야 Health 를 평가합니다(Evidence 필수)." /> : (
          <div className="space-y-1">
            {healths.map(({ k, h }) => (
              <div key={k.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{k.kpi_code}</span>
                <AdminBadge tone={h.health === 'healthy' ? 'success' : h.health === 'at_risk' ? 'danger' : h.health === 'watch' ? 'warning' : 'neutral'}>{h.health}</AdminBadge>
                {h.verdict === 'kpi_unverified' && <AdminBadge tone="warning">kpi_unverified</AdminBadge>}
                <span className="ml-2 text-muted-foreground">{h.reasons.join(' · ')} · Health ≠ Business Quality</span>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Benchmark / Correlation / Briefing ── */}
      {tab === 'benchmark' && (
        <div className="space-y-1">
          {benchmarks.map((b, i) => (
            <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{b.metric}</span>
              <AdminBadge tone={b.verdict === 'compared' ? 'info' : 'warning'}>{b.verdict}</AdminBadge>
              <span className="ml-2 text-muted-foreground">vs {b.previousLabel} · Δ {b.delta ?? 'null'} ({b.deltaPct == null ? '—' : `${b.deltaPct}%`}) · 외부 비교: {b.externalComparison.performed ? '수행' : '수행 안 함(실데이터 없음)'}</span>
            </div>
          ))}
        </div>
      )}
      {tab === 'correlation' && (
        <div className="space-y-1">
          {correlations.pairs.map((p) => (
            <div key={p.label} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{p.label}</span>
              <AdminBadge tone={p.verdict === 'correlation_candidate' ? 'info' : p.verdict === 'no_known_correlation' ? 'neutral' : 'warning'}>{p.verdict}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{p.strength ?? '—'} · Correlation ≠ Causation</span>
            </div>
          ))}
        </div>
      )}
      {tab === 'briefing' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => recordPerformanceGovernance('performance_briefing_recorded', r, { period: 'weekly', sections: briefing.sections.map((s) => ({ key: s.key, count: s.items.length })) }), 'Briefing 기록(자동 발송 없음)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Weekly Briefing 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="기록 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {briefing.sections.map((s) => (
            <div key={s.key} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.items.length ? 'info' : 'neutral'}>{s.key}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{s.items.length ? s.items.join(' · ') : '항목 없음(unknown 유지)'}</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">Today/Weekly/Monthly/Quarterly — autoSendDisabled=true(자동 발송 없음)</p>
        </div>
      )}

      {/* ── Recommendations / Reviews / External / Audit / Support ── */}
      {tab === 'recommendations' && (
        !autoRecs.length ? <AdminEmpty title="권고 없음" description="Evidence 없는 권고는 생성되지 않습니다." /> : (
          <div className="space-y-1">
            {autoRecs.map((r, i) => (
              <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone="info">{r.type}</AdminBadge>
                <span className="ml-2">{r.reason}</span>
                <p className="mt-1 text-[10px] text-muted-foreground">humanApprovalRequired · Recommendation ≠ Decision</p>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'humanreviews' && (() => {
        const reviews = audit.filter((e) => ['kpi_reviewed', 'kpi_target_set', 'kpi_defined'].includes(e.event_type));
        return !reviews.length ? <AdminEmpty title="검토 이력 없음" description="KPI 정의/목표 설정/Health 판정은 전부 사람이 수행합니다." /> : (
          <div className="space-y-1">
            {reviews.slice(0, 40).map((e) => (
              <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone="info">{e.event_type}</AdminBadge>
                <span className="ml-2">{e.detail}</span>
              </div>
            ))}
          </div>
        );
      })()}
      {tab === 'external' && (() => {
        const ext = audit.filter((e) => e.event_type === 'external_performance_reference');
        return !ext.length ? <AdminEmpty title="외부 참조 없음" description="외부 성과 자료는 참조로만 기록됩니다 — 실데이터 없이 외부 비교하지 않습니다." /> : (
          <div className="space-y-1">
            {ext.slice(0, 30).map((e) => (
              <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]"><span className="font-mono text-muted-foreground">{e.created_at.slice(0, 16).replace('T', ' ')}</span><span className="ml-2">{e.detail}</span></div>
            ))}
          </div>
        );
      })()}
      {tab === 'audit' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => recordPerformanceGovernance('trend_analyzed', r, { trends: trends.map(({ metric, t }) => ({ metric, trend: t.trend, status: t.dataStatus })) }), 'Trend 분석 기록(Trend ≠ Guarantee)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Trend 분석 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="기록 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!audit.length ? <AdminEmpty title="Audit 없음" description="KPI 기록/검토가 이벤트로 남습니다(16종 whitelist)." /> : audit.slice(0, 60).map((e) => (
            <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono text-muted-foreground">{e.created_at.slice(0, 16).replace('T', ' ')}</span>
              <AdminBadge tone="neutral">{e.event_type}</AdminBadge>
              <span className="ml-2">{e.detail}</span>
            </div>
          ))}
        </div>
      )}
      {tab === 'support' && (
        <div className="space-y-1">
          {PERFORMANCE_SUPPORT.map((s) => (
            <div key={s.key} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.status === 'supported' ? 'success' : s.status === 'partial' ? 'warning' : 'danger'}>{s.status}</AdminBadge>
              <span className="ml-2 font-bold">{s.key}</span>
              <span className="ml-2 text-muted-foreground">{s.note}</span>
            </div>
          ))}
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
