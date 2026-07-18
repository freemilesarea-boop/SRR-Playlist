/**
 * PerformanceIntelligenceSection — Enterprise Performance Intelligence, KPI
 * Governance & Strategic Performance Management Center (Phase AI-OPS-44).
 *
 * Enterprise Vision→Strategic Goal→Strategic KPI→Performance Target→Baseline→
 * Observed Performance→Variance→Business Impact→Cross-Domain Correlation→
 * Strategic/Executive Scorecard→Executive Performance Review→Recommendation→
 * Observed Outcome→Performance Learning→Audit.
 * Target ≠ Guaranteed Result · Trend ≠ Future Trend · Correlation ≠ Causality ·
 * Scorecard ≠ Executive Evaluation · Review ≠ Approval.
 * KPI 자동 변경·자동 성과평가·자동 보상·자동 Budget/Production 변경 없음.
 * (기존 0525 ExecutivePerformanceSection 과 별도의 enterprise 신규 계층)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, BookOpen, ClipboardList, Gauge, GitBranch, Grid3x3,
  History, Inbox, Layers, Lightbulb, Lock, RefreshCw, Scale, Search,
  Target, TrendingUp, Users,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchEnterprisePerformanceSummary, fetchEnterpriseKpis, createEnterpriseKpi, reviewEnterpriseKpi,
  recordEnterpriseKpiSnapshot, fetchEnterpriseKpiSnapshots, recordEnterprisePerformanceReview,
  recordEnterprisePerformanceEvent, fetchEnterprisePerformanceAudit,
  type EnterprisePerformanceSummary, type EnterpriseKpiRow, type EnterpriseKpiSnapshotRow,
  type EnterprisePerformanceEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  ENTERPRISE_KPI_CATEGORIES, KPI_TREND_RESULTS, KPI_VARIANCE_RESULTS,
  BUSINESS_IMPACT_DOMAINS, BUSINESS_IMPACT_RESULTS, KPI_DRIFT_RESULTS,
  KPI_CORRELATION_RESULTS, KPI_DEPENDENCY_RESULTS, FORECAST_COMPARISON_RESULTS,
  KPI_DATA_QUALITY_LEVELS, PERFORMANCE_RECOMMENDATION_TYPES, SCORECARD_FIELDS,
  buildPerformanceTimeline, ENTERPRISE_PERFORMANCE_COMPONENTS, ENTERPRISE_PERFORMANCE_SUPPORT_MATRIX,
} from '@/lib/enterprisePerformance';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'inbox' | 'kpis' | 'baseline' | 'targets' | 'snapshots' | 'trends' | 'variance'
  | 'confidence' | 'forecastcmp' | 'drift' | 'correlation' | 'dependency' | 'crossdomain' | 'impact'
  | 'scorecard' | 'execscorecard' | 'summaryrec' | 'recommendations' | 'reviewqueue' | 'reviewed'
  | 'links' | 'outcomes' | 'learning' | 'flow' | 'audit' | 'support' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'KPI Overview', icon: Layers },
  { key: 'inbox', label: 'Performance Inbox', icon: Inbox },
  { key: 'kpis', label: 'Strategic KPIs', icon: BookOpen },
  { key: 'baseline', label: 'Baselines', icon: History },
  { key: 'targets', label: 'Performance Targets', icon: Target },
  { key: 'snapshots', label: 'Observed Snapshots', icon: ClipboardList },
  { key: 'trends', label: 'KPI Trends', icon: TrendingUp },
  { key: 'variance', label: 'KPI Variance', icon: Scale },
  { key: 'confidence', label: 'KPI Confidence', icon: Gauge },
  { key: 'forecastcmp', label: 'Forecast Comparison', icon: TrendingUp },
  { key: 'drift', label: 'KPI Drift', icon: Activity },
  { key: 'correlation', label: 'KPI Correlation', icon: GitBranch },
  { key: 'dependency', label: 'KPI Dependency', icon: GitBranch },
  { key: 'crossdomain', label: 'Cross-Domain Correlation', icon: GitBranch },
  { key: 'impact', label: 'Business Impact', icon: Scale },
  { key: 'scorecard', label: 'Strategic Scorecard', icon: Grid3x3 },
  { key: 'execscorecard', label: 'Executive Scorecard', icon: Grid3x3 },
  { key: 'summaryrec', label: 'Performance Summary', icon: ClipboardList },
  { key: 'recommendations', label: 'Performance Recommendations', icon: Lightbulb },
  { key: 'reviewqueue', label: 'Review Queue', icon: Users },
  { key: 'reviewed', label: 'Review References', icon: Scale },
  { key: 'links', label: 'Reference Links', icon: GitBranch },
  { key: 'outcomes', label: 'Observed Outcomes', icon: Search },
  { key: 'learning', label: 'Performance Learning', icon: Lightbulb },
  { key: 'flow', label: 'Flow Timeline', icon: History },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
  { key: 'limitations', label: 'Known Limitations', icon: ClipboardList },
];

const KNOWN_LIMITATIONS = [
  'KPI 자동 수정/삭제/승인·자동 인사/성과평가·자동 보상/승진/해고·자동 Budget/Strategy/Portfolio/Resource/Production/Payment/Settlement/Contract/Incident/Rollout/Rollback/Merge/Deploy 없음 — 모든 반환 flag(kpi_auto_modified/auto_evaluation_applied/compensation_changed 등) 항상 false',
  'KPI Target ≠ Guaranteed Result · Baseline 은 출처 없이 기록 서버 차단 · Target 은 Rationale 필수',
  'KPI Trend ≠ Future Trend · KPI Correlation ≠ Causality · KPI Improvement ≠ Strategy Success · KPI Decline ≠ Strategy Failure',
  'Business Impact ≠ Financial Fact — 회계/Revenue Recognition/CRM/BI Warehouse 피드 부재(insufficient_data 유지)',
  'Scorecard ≠ Executive Evaluation — 개인 인사/성과/보상 평가 계열 category 는 서버에서 구조적 차단',
  'Performance Review Reference 는 Self-Review 차단(작성자 ≠ 평가자) + Evidence 필수 — Review ≠ Approval',
  'Snapshot observed_value 는 null 유지 가능(Null → 0 변환 금지) · verified_source_reference 표기는 출처 참조 필수',
  '외부 시장 벤치마크/AB 테스트 플랫폼 피드 부재 — 비교 지표는 후보(Candidate) 중심',
  '스펙 §11 지정 파일명 performanceIntelligence.ts 는 AI-OPS-22(0525)에 기존 — 충돌 회피 위해 enterprisePerformance.ts 로 명명(고지)',
  'Migration 0472~0548 production 미적용 — 운영 수치는 적용 후 축적됩니다',
  '브라우저 실측 미검증 — UI 는 코드 리뷰/타입/빌드 기준 검증만 수행했습니다',
];

export default function PerformanceIntelligenceSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<EnterprisePerformanceSummary>({});
  const [kpis, setKpis] = useState<EnterpriseKpiRow[]>([]);
  const [snapshots, setSnapshots] = useState<EnterpriseKpiSnapshotRow[]>([]);
  const [audit, setAudit] = useState<EnterprisePerformanceEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [selKpi, setSelKpi] = useState('');
  const [catSel, setCatSel] = useState<string>('growth');
  const [impactDomainSel, setImpactDomainSel] = useState<string>('revenue');
  const [qualitySel, setQualitySel] = useState<string>('quality_unverified');
  const [recTypeSel, setRecTypeSel] = useState<string>('gather_more_evidence_candidate');
  const [resultSel, setResultSel] = useState<string>('insufficient_data');
  const [numVal, setNumVal] = useState('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, k, sn, a] = await Promise.all([
        fetchEnterprisePerformanceSummary(), fetchEnterpriseKpis(null, null, 200),
        fetchEnterpriseKpiSnapshots(null, 200), fetchEnterprisePerformanceAudit(200),
      ]);
      setSummary(s); setKpis(k); setSnapshots(sn); setAudit(a);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await load(); }
    catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };
  const needReason = (): string | null => {
    if (!reason.trim()) { toast.error('사유/내용 필수(Human Review)'); return null; }
    return reason.trim();
  };
  const kpiReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selKpi) { if (!selKpi) toast.error('KPI 선택 필수'); return; }
    void act(() => reviewEnterpriseKpi(selKpi, action, r, payload), ok);
  };
  const perfReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selKpi) { if (!selKpi) toast.error('KPI 선택 필수'); return; }
    void act(() => recordEnterprisePerformanceReview(selKpi, action, r, payload), ok);
  };
  const perfEvent = (kind: string, payload: Record<string, unknown>, ok: string, requireKpi = false) => {
    const r = needReason();
    if (!r) return;
    if (requireKpi && !selKpi) { toast.error('KPI 선택 필수'); return; }
    void act(() => recordEnterprisePerformanceEvent(kind, r, payload, selKpi || null), ok);
  };

  const obj = useCallback((k: string): Record<string, unknown> => (typeof summary[k] === 'object' && summary[k] !== null && !Array.isArray(summary[k]) ? summary[k] as Record<string, unknown> : {}), [summary]);
  const num = useCallback((k: string, sub: string): number | null => {
    const v = obj(k)[sub];
    return typeof v === 'number' ? v : null;
  }, [obj]);

  const flowTimeline = useMemo(() => buildPerformanceTimeline({ present: {
    strategic_goal: (num('performance_actuals', 'strategic_goals_0545') ?? 0) > 0,
    strategic_kpi: (num('kpis', 'total') ?? 0) > 0,
    performance_target: (num('kpis', 'with_target') ?? 0) > 0,
    baseline: (num('kpis', 'with_baseline') ?? 0) > 0,
    observed_performance: (num('snapshots', 'with_observed_value') ?? 0) > 0,
    variance_analysis: (num('performance_events', 'variance_reviews') ?? 0) > 0,
    business_impact: (num('performance_events', 'impact_reviews') ?? 0) > 0,
    cross_domain_correlation: (num('performance_events', 'cross_domain_correlations') ?? 0) > 0,
    strategic_scorecard: (num('performance_events', 'strategic_scorecards') ?? 0) > 0,
    executive_performance_review: (num('performance_events', 'executive_review_requests') ?? 0) + (num('performance_events', 'review_references') ?? 0) > 0,
    performance_recommendation: (num('performance_events', 'recommendations') ?? 0) > 0,
    observed_outcome: (num('performance_events', 'outcome_links') ?? 0) > 0,
    performance_learning: (num('performance_events', 'learning_references') ?? 0) > 0,
  } }), [num]);

  if (loading) return <AdminCard title="Performance Intelligence & KPI Governance Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Performance Intelligence & KPI Governance Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const kpiSelect = (
    <select value={selKpi} onChange={(e) => setSelKpi(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">KPI 선택</option>
      {kpis.map((k) => <option key={k.id} value={k.id}>{k.kpi_code} · {k.kpi_status}</option>)}
    </select>
  );
  const reasonInput = <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const numInput = <input value={numVal} onChange={(e) => setNumVal(e.target.value)} placeholder="수치" className="w-24 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button disabled={busy} onClick={onClick} className={primary ? 'rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50' : 'rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50'}>{label}</button>
  );
  const tone = (s: string) => (s.includes('growth') || s.includes('on_target') || s.includes('positive') || s.includes('aligned') || s.includes('no_material') || s.includes('active_reference') || s.includes('verified_source') || s === 'stable_candidate' ? 'success' as const : s.includes('critical') || s.includes('severe') || s.includes('strong_decline') || s.includes('high_negative') || s.includes('deprecated') || s.includes('invalidated') || s === 'unavailable' ? 'danger' as const : 'warning' as const);
  const evByType = (t: string) => audit.filter((e) => e.event_type === t);
  const eventList = (rows: EnterprisePerformanceEventRow[], emptyTitle: string, emptyDesc: string) => (
    !rows.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {rows.slice(0, 30).map((e) => (
          <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(String(e.payload?.result ?? e.event_type))}>{e.event_type}</AdminBadge>
            <span className="ml-2">{e.detail}</span>
            <span className="ml-2 text-muted-foreground">{new Date(e.created_at).toLocaleString('ko-KR')}</span>
          </div>
        ))}
      </div>
    )
  );
  const kpiList = (list: EnterpriseKpiRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((k) => (
          <div key={k.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(k.kpi_status)}>{k.kpi_status}</AdminBadge>
            <AdminBadge tone={tone(k.trend_status)}>{k.trend_status}</AdminBadge>
            <AdminBadge tone={tone(k.variance_status)}>{k.variance_status}</AdminBadge>
            <span className="ml-2 font-bold">{k.kpi_code}</span>
            <span className="ml-2 text-muted-foreground">{k.kpi_category} · {k.kpi_name} · baseline {NUM(k.baseline_value)} · target {NUM(k.target_value)} · observed {NUM(k.current_value_reference)}{k.unit_type ? ` ${k.unit_type}` : ''}</span>
          </div>
        ))}
      </div>
    )
  );
  const snapshotList = (list: EnterpriseKpiSnapshotRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((s) => (
          <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(s.data_quality)}>{s.data_quality}</AdminBadge>
            <span className="ml-2 font-bold">{s.observed_value == null ? 'null(관측 없음)' : NUM(s.observed_value)}</span>
            <span className="ml-2 text-muted-foreground">{s.snapshot_period_reference ?? '—'} · vs target {NUM(s.variance_vs_target)} · vs baseline {NUM(s.variance_vs_baseline)} · {new Date(s.created_at).toLocaleString('ko-KR')}</span>
          </div>
        ))}
      </div>
    )
  );
  const resultEventTab = (kind: string, title: string, note: string, results: readonly string[], extraPayload: Record<string, unknown> = {}) => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        {kpiSelect}
        <select value={results.includes(resultSel) ? resultSel : results[0]} onChange={(e) => setResultSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
          {results.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {reasonInput}
        {btn(`${title} 기록`, () => perfEvent(kind, { result: results.includes(resultSel) ? resultSel : results[0], ...extraPayload }, `${title} 기록됨`), true)}
      </div>
      <AdminAlert tone="info" description={note} />
      {eventList(evByType(kind), `${title} 없음`, '사람 검토 기록이 여기에 표시됩니다.')}
    </div>
  );

  return (
    <AdminCard
      title="Performance Intelligence & KPI Governance Center"
      subtitle="Strategic Goal→Strategic KPI→Target/Baseline→Observed Performance→Variance→Business Impact→Cross-Domain Correlation→Strategic/Executive Scorecard→Human Performance Review→Recommendation→Outcome→Learning — 최종 평가는 반드시 사람"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 Enterprise 의 실행 결과를 KPI 와 Business Performance 관점에서 객관적으로 분석하는 Performance Intelligence 계층입니다. AI 는 KPI 구조화·Baseline/Target 후보·Snapshot·Trend/Growth/Decline·Variance·Confidence·Forecast 비교·Drift·Correlation/Dependency·Cross-Domain Correlation·Business Impact·Strategic/Executive Scorecard·Performance Summary·Recommendation·Review 요청까지만 수행하며, KPI 자동 수정/삭제/승인·자동 인사평가/성과평가/보상/승진/해고·자동 Budget/Strategy/Portfolio/Resource Allocation/Production/Payment/Settlement/Contract/Incident/Rollout/Rollback/Merge/Deploy 는 수행하지 않습니다. KPI Target ≠ Guaranteed Result, Trend ≠ Future Trend, Correlation ≠ Causality, Improvement ≠ Strategy Success, Decline ≠ Strategy Failure, Business Impact ≠ Financial Fact, Scorecard ≠ Executive Evaluation, Review ≠ Approval. AI 는 성과를 설명하고, 사람이 평가합니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Strategic KPIs" value={NUM(num('kpis', 'total'))} />
            <Box label="Active / Paused / Deprecated" value={`${NUM(num('kpis', 'active'))} / ${NUM(num('kpis', 'paused'))} / ${NUM(num('kpis', 'deprecated'))}`} />
            <Box label="Baseline / Target / Observed 보유" value={`${NUM(num('kpis', 'with_baseline'))} / ${NUM(num('kpis', 'with_target'))} / ${NUM(num('kpis', 'with_observed'))}`} />
            <Box label="Growth / Decline KPI" value={`${NUM(num('kpis', 'growth'))} / ${NUM(num('kpis', 'decline'))}`} />
            <Box label="Off-Target / Critical Variance" value={`${NUM(num('kpis', 'off_target'))} / ${NUM(num('kpis', 'critical_variance'))}`} />
            <Box label="Negative Impact KPI" value={NUM(num('kpis', 'negative_impact'))} />
            <Box label="Snapshots (관측 / null)" value={`${NUM(num('snapshots', 'with_observed_value'))} / ${NUM(num('snapshots', 'null_observed'))}`} />
            <Box label="Verified / Proxy / Unverified Source" value={`${NUM(num('snapshots', 'verified_source'))} / ${NUM(num('snapshots', 'proxy'))} / ${NUM(num('snapshots', 'quality_unverified'))}`} />
            <Box label="Baselines / Targets 기록" value={`${NUM(num('performance_events', 'baselines'))} / ${NUM(num('performance_events', 'targets'))}`} />
            <Box label="Trend / Variance Reviews" value={`${NUM(num('performance_events', 'trend_reviews'))} / ${NUM(num('performance_events', 'variance_reviews'))}`} />
            <Box label="Confidence / Forecast 비교" value={`${NUM(num('performance_events', 'confidence_reviews'))} / ${NUM(num('performance_events', 'forecast_comparisons'))}`} />
            <Box label="Drift / Correlation / Dependency" value={`${NUM(num('performance_events', 'drift_reviews'))} / ${NUM(num('performance_events', 'correlation_reviews'))} / ${NUM(num('performance_events', 'dependency_reviews'))}`} />
            <Box label="Cross-Domain / Impact Reviews" value={`${NUM(num('performance_events', 'cross_domain_correlations'))} / ${NUM(num('performance_events', 'impact_reviews'))}`} />
            <Box label="Strategic / Executive Scorecards" value={`${NUM(num('performance_events', 'strategic_scorecards'))} / ${NUM(num('performance_events', 'executive_scorecards'))}`} />
            <Box label="Recommendations" value={NUM(num('performance_events', 'recommendations'))} />
            <Box label="KPI / Executive / Performance Review 요청" value={`${NUM(num('performance_events', 'kpi_review_requests'))} / ${NUM(num('performance_events', 'executive_review_requests'))} / ${NUM(num('performance_events', 'performance_review_requests'))}`} />
            <Box label="Review References" value={NUM(num('performance_events', 'review_references'))} />
            <Box label="Goal / Program / Forecast Links" value={`${NUM(num('performance_events', 'goal_links'))} / ${NUM(num('performance_events', 'program_links'))} / ${NUM(num('performance_events', 'forecast_links'))}`} />
            <Box label="Outcome Links / Learning" value={`${NUM(num('performance_events', 'outcome_links'))} / ${NUM(num('performance_events', 'learning_references'))}`} />
          </div>
          <AdminAlert tone="info" description={`performance_unavailable: ${Array.isArray(summary.performance_unavailable) ? (summary.performance_unavailable as unknown[]).map(String).join(', ') : '—'}. Performance 원천 실측 — Programs(0547) ${NUM(num('performance_actuals', 'execution_programs_0547'))}건 · Goals(0545) ${NUM(num('performance_actuals', 'strategic_goals_0545'))}건 · Portfolios(0545) ${NUM(num('performance_actuals', 'strategy_portfolios_0545'))}건 · Forecast Runs(0543) ${NUM(num('performance_actuals', 'forecast_runs_0543'))}건 · Decision Outcomes(0514) ${NUM(num('performance_actuals', 'decision_outcomes_0514'))}건 · Commitments(0520) ${NUM(num('performance_actuals', 'commitments_0520'))}건 · Legacy KPI(0525) ${NUM(num('performance_actuals', 'legacy_kpi_definitions_0525'))}건. 0 과 Unknown 을 혼동하지 않습니다.`} />
        </div>
      )}

      {tab === 'inbox' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="성과 대기함 — draft KPI 와 악화 후보 KPI. 우선순위와 최종 평가는 사람이 결정합니다." />
          {kpiList(kpis.filter((k) => k.kpi_status === 'draft'), 'Draft KPI 없음', '0건은 KPI 체계가 완성됐음을 의미하지 않습니다.')}
          {kpiList(kpis.filter((k) => ['materially_off_target_candidate', 'critical_variance_candidate'].includes(k.variance_status) || ['moderate_decline_candidate', 'strong_decline_candidate'].includes(k.trend_status)), '악화 후보 KPI 없음', 'Off-Target/Decline 후보가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'kpis' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <select value={catSel} onChange={(e) => setCatSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {ENTERPRISE_KPI_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {reasonInput}
            {btn('KPI 생성(≠ 인사평가 지표)', () => {
              const r = needReason();
              if (!r) return;
              void act(() => createEnterpriseKpi({ kpi_category: catSel, kpi_name: r }), 'KPI 생성됨(draft — 자동 변경 없음)');
            }, true)}
            {btn('Active Reference', () => kpiReview('activate_reference', {}, 'active_reference'))}
            {btn('Pause', () => kpiReview('pause_reference', {}, 'paused_reference'))}
            {btn('Deprecate', () => kpiReview('deprecate_reference', {}, 'deprecated_reference'))}
            {kpiSelect}
          </div>
          <AdminAlert tone="info" description="Category 15종 · 개인 평가/보상/해고 계열 category 서버 차단 · deprecated 재결정 차단." />
          {kpiList(kpis, 'Strategic KPI 없음', '핵심 질문 예: 목표 대비 실제 성과는? 어떤 KPI 가 악화 중인가? — 전부 Candidate 분석.')}
        </div>
      )}

      {tab === 'baseline' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {kpiSelect}{numInput}{reasonInput}
            {btn('Baseline 기록(출처 필수)', () => kpiReview('record_baseline', { baseline_value: Number(numVal) || 0, baseline_source_reference: reason.trim() }, 'Baseline 기록됨'), true)}
          </div>
          <AdminAlert tone="warning" description="출처 없는 Baseline 기록 서버 차단 — Baseline ≠ 보장된 기준 성과." />
          {eventList(evByType('kpi_baseline_recorded'), 'Baseline 기록 없음', 'KPI Baseline 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'targets' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {kpiSelect}{numInput}{reasonInput}
            {btn('Target 기록(Rationale 필수)', () => kpiReview('record_target', { target_value: Number(numVal) || 0, target_rationale: reason.trim() }, 'Target 기록됨(≠ Guaranteed Result)'), true)}
          </div>
          <AdminAlert tone="warning" description="KPI Target ≠ Guaranteed Result — Rationale 없는 Target 기록 서버 차단." />
          {eventList(evByType('kpi_target_recorded'), 'Target 기록 없음', 'Performance Target 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'snapshots' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {kpiSelect}{numInput}
            <select value={qualitySel} onChange={(e) => setQualitySel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {KPI_DATA_QUALITY_LEVELS.map((q) => <option key={q} value={q}>{q}</option>)}
            </select>
            {reasonInput}
            {btn('Snapshot 기록(Observed)', () => {
              const r = needReason();
              if (!r || !selKpi) { if (!selKpi) toast.error('KPI 선택 필수'); return; }
              void act(() => recordEnterpriseKpiSnapshot({ kpi_id: selKpi, observed_value: numVal.trim() === '' ? null : Number(numVal), data_quality: qualitySel, notes: r, snapshot_period_reference: r.slice(0, 60) }), 'Snapshot 기록됨(관측 없으면 null 유지)');
            }, true)}
          </div>
          <AdminAlert tone="info" description="Observed Performance — 관측값 없으면 null 유지(0 치환 금지) · verified 표기는 출처 참조 필수." />
          {snapshotList(snapshots, 'Snapshot 없음', 'KPI 관측 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'trends' && resultEventTab('kpi_trend_reviewed', 'KPI Trend 검토', 'Trend 5단계(§5) — KPI Trend ≠ Future Trend.', KPI_TREND_RESULTS)}
      {tab === 'variance' && resultEventTab('kpi_variance_reviewed', 'KPI Variance 검토', 'Baseline/Target/Actual/Forecast Variance(§6) — Variance ≠ Strategy Failure/Success.', KPI_VARIANCE_RESULTS)}
      {tab === 'confidence' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {kpiSelect}{numInput}{reasonInput}
            {btn('Confidence 기록(0~100)', () => perfEvent('kpi_confidence_reviewed', { confidence: Number(numVal) || 0 }, 'Confidence 기록됨(≠ Certainty)', true), true)}
          </div>
          <AdminAlert tone="info" description="Confidence ≠ Certainty — 표본·출처 품질 기반 후보 수치입니다." />
          {eventList(evByType('kpi_confidence_reviewed'), 'Confidence 기록 없음', 'KPI Confidence 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'forecastcmp' && resultEventTab('kpi_forecast_comparison_reviewed', 'Forecast 비교 검토', 'Forecast(0543 실존 검증) vs Actual — Forecast ≠ Future Fact.', FORECAST_COMPARISON_RESULTS)}
      {tab === 'drift' && resultEventTab('kpi_drift_reviewed', 'KPI Drift 검토', 'KPI Drift ≠ 자동 KPI 변경 신호 — 정의/측정 방식 변화 후보.', KPI_DRIFT_RESULTS)}
      {tab === 'correlation' && resultEventTab('kpi_correlation_reviewed', 'KPI Correlation 검토', 'KPI Correlation ≠ Causality — 표본 부족 시 sample_too_small 유지.', KPI_CORRELATION_RESULTS)}
      {tab === 'dependency' && resultEventTab('kpi_dependency_reviewed', 'KPI Dependency 검토', 'Dependency Candidate ≠ 확정 인과 구조.', KPI_DEPENDENCY_RESULTS)}
      {tab === 'crossdomain' && resultEventTab('cross_domain_correlation_reviewed', 'Cross-Domain Correlation 검토', 'Domain 간 상관 후보 — Correlation ≠ Causality.', KPI_CORRELATION_RESULTS)}
      {tab === 'impact' && resultEventTab('business_impact_reviewed', 'Business Impact 검토', 'Impact 11 도메인(§7) — Business Impact ≠ Financial Fact.', BUSINESS_IMPACT_RESULTS, { impact_domain: impactDomainSel })}
      {tab === 'impact' && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
          <span className="text-[11px] text-muted-foreground">Impact Domain:</span>
          <select value={impactDomainSel} onChange={(e) => setImpactDomainSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
            {BUSINESS_IMPACT_DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      )}

      {tab === 'scorecard' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {kpiSelect}{reasonInput}
            {btn('Strategic Scorecard 기록', () => perfEvent('strategic_scorecard_recorded', { fields: [...SCORECARD_FIELDS], note: reason.trim() }, 'Strategic Scorecard 기록됨(≠ Executive Evaluation)', true), true)}
          </div>
          <AdminAlert tone="warning" description={`Scorecard 필드 10종(${SCORECARD_FIELDS.join(', ')}) — Scorecard ≠ Executive Evaluation(개인 평가 사용 금지).`} />
          {eventList(evByType('strategic_scorecard_recorded'), 'Strategic Scorecard 없음', '전략 Scorecard 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'execscorecard' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {kpiSelect}{reasonInput}
            {btn('Executive Scorecard 기록', () => perfEvent('executive_scorecard_recorded', { note: reason.trim() }, 'Executive Scorecard 기록됨(≠ 인사평가)', true), true)}
          </div>
          <AdminAlert tone="info" description="Executive 가 먼저 확인할 악화 우선 정렬 후보 — 자동 평가/보상 없음." />
          {eventList(evByType('executive_scorecard_recorded'), 'Executive Scorecard 없음', '경영진 Scorecard 기록이 여기에 표시됩니다.')}
          {kpiList(kpis.filter((k) => k.variance_status === 'critical_variance_candidate' || k.trend_status === 'strong_decline_candidate'), 'Critical 우선 KPI 없음', 'Critical Variance/Strong Decline 후보가 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'summaryrec' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {reasonInput}
            {btn('Performance Summary 기록', () => perfEvent('performance_summary_recorded', { note: reason.trim() }, 'Performance Summary 기록됨'), true)}
          </div>
          <AdminAlert tone="info" description="Summary ≠ 성과 확정 — 관측 데이터 요약 후보입니다." />
          {eventList(evByType('performance_summary_recorded'), 'Summary 없음', 'Performance Summary 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'recommendations' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {kpiSelect}
            <select value={recTypeSel} onChange={(e) => setRecTypeSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {PERFORMANCE_RECOMMENDATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Recommendation 기록(Evidence 필수)', () => perfEvent('performance_recommendation_recorded', { recommendation_type: recTypeSel, evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Recommendation 기록됨(≠ Decision)'), true)}
          </div>
          <AdminAlert tone="info" description="Performance Recommendation ≠ Decision — Evidence 없는 Recommendation 서버 차단. 채택은 사람이 결정합니다." />
          {eventList(evByType('performance_recommendation_recorded'), 'Recommendation 없음', 'Performance Recommendation 후보가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'reviewqueue' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {kpiSelect}{reasonInput}
            {btn('KPI Review 요청', () => perfReview('request_kpi_review', {}, 'KPI Review 요청됨'), true)}
            {btn('Executive Review 요청', () => perfReview('request_executive_review', {}, 'Executive Review 요청됨(≠ Approval)'))}
            {btn('Performance Review 요청', () => perfReview('request_performance_review', {}, 'Performance Review 요청됨'))}
            {btn('Review Reference 기록(Evidence 필수)', () => perfReview('record_review_reference', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Review Reference 기록됨(≠ Approval)'))}
            {btn('수정 요청', () => perfReview('request_revision', {}, '수정 요청됨'))}
          </div>
          <AdminAlert tone="warning" description="Human Performance Review — Self-Review 서버 차단(작성자 ≠ 평가자) · Evidence 없는 Review Reference 차단 · Review ≠ Approval. 최종 평가는 반드시 사람이 수행합니다." />
          {eventList([...evByType('kpi_review_requested'), ...evByType('executive_review_requested'), ...evByType('performance_review_requested'), ...evByType('performance_revision_requested')], 'Review 요청 없음', 'KPI/Executive/Performance Review 요청이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'reviewed' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Review References — 사람 평가 기록(≠ Approval·자동 보상/변경 없음)." />
          {kpiList(kpis.filter((k) => k.review_reference != null), 'Review Reference KPI 없음', '사람 평가가 기록된 KPI 가 여기에 표시됩니다.')}
          {eventList(evByType('performance_review_reference_recorded'), 'Review Reference 이벤트 없음', '평가 Reference 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'links' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {kpiSelect}{reasonInput}
            {btn('Goal Link(0545 실존 검증)', () => perfEvent('goal_reference_linked', { note: reason.trim() }, 'Goal Link 기록됨', true), true)}
            {btn('Portfolio Link(0545)', () => perfEvent('portfolio_reference_linked', { note: reason.trim() }, 'Portfolio Link 기록됨'))}
            {btn('Program Link(0547)', () => perfEvent('program_reference_linked', { note: reason.trim() }, 'Program Link 기록됨', true))}
            {btn('Decision Outcome Link(0514)', () => perfEvent('decision_outcome_linked', { note: reason.trim() }, 'Decision Outcome Link 기록됨'))}
            {btn('Forecast Link(0543)', () => perfEvent('forecast_reference_linked', { note: reason.trim() }, 'Forecast Link 기록됨', true))}
            {btn('Commitment Link(0520)', () => perfEvent('commitment_reference_linked', { note: reason.trim() }, 'Commitment Link 기록됨'))}
          </div>
          <AdminAlert tone="info" description="Reference Link — ID 지정 시 실존 검증(0514/0520/0543/0545/0547). Link ≠ 달성/성공/인과." />
          {eventList([...evByType('goal_reference_linked'), ...evByType('portfolio_reference_linked'), ...evByType('program_reference_linked'), ...evByType('decision_outcome_linked'), ...evByType('forecast_reference_linked'), ...evByType('commitment_reference_linked')], 'Reference Link 없음', '참조 연결 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'outcomes' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {kpiSelect}{reasonInput}
            {btn('Performance Outcome 연결', () => perfEvent('performance_outcome_linked', { note: reason.trim() }, 'Outcome 연결됨(≠ Proven Causality)', true), true)}
          </div>
          <AdminAlert tone="info" description="Outcome Link ≠ Proven Causality — KPI 개선이 우연인지의 판단은 사람이 수행합니다." />
          {eventList(evByType('performance_outcome_linked'), 'Outcome Link 없음', '관측된 Outcome 연결이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'learning' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {kpiSelect}{reasonInput}
            {btn('Performance Learning 기록', () => perfEvent('performance_learning_reference_recorded', { note: reason.trim() }, 'Learning Reference 기록됨', true), true)}
          </div>
          <AdminAlert tone="info" description="Learning Reference ≠ 자동 KPI 변경 — 학습 반영 여부는 사람이 결정합니다." />
          {eventList(evByType('performance_learning_reference_recorded'), 'Learning Reference 없음', '성과 학습 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'flow' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Performance 흐름 관측 — 단계별 기록 존재 여부만 표시합니다(자동 진행 아님)." />
          <div className="space-y-1">
            {flowTimeline.map((s) => (
              <div key={s.stage} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone={s.present ? 'success' : 'warning'}>{s.present ? '관측됨' : '미관측'}</AdminBadge>
                <span className="font-bold">{s.stage}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description={`Performance 이벤트 32종 통합 Audit — 총 ${NUM(num('performance_events', 'total'))}건. 자동 평가 이벤트 생성 금지.`} />
          {eventList(audit, 'Audit 이벤트 없음', '모든 Performance Intelligence 활동이 여기에 기록됩니다.')}
        </div>
      )}

      {tab === 'support' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description={`분류 6종(fully/partially/advisory_only/human_review_only/unavailable/insufficient_data) — 컴포넌트 ${ENTERPRISE_PERFORMANCE_COMPONENTS.length}종 · 매트릭스 ${ENTERPRISE_PERFORMANCE_SUPPORT_MATRIX.length}항목. unavailable 은 전부 automatic_*(자동 평가/보상/변경 없음).`} />
          <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
            {ENTERPRISE_PERFORMANCE_SUPPORT_MATRIX.map((e) => (
              <div key={e.capability} className="flex items-center justify-between rounded-lg border border-border p-2 text-[11px]">
                <span>{e.capability}</span>
                <AdminBadge tone={e.support === 'unavailable' ? 'danger' : e.support === 'fully_supported' ? 'success' : 'warning'}>{e.support}</AdminBadge>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'limitations' && (
        <div className="space-y-1">
          {KNOWN_LIMITATIONS.map((l) => (
            <div key={l} className="rounded-lg border border-border p-2 text-[11px]">{l}</div>
          ))}
        </div>
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
