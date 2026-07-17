/**
 * PredictiveEnterpriseSection — Predictive Enterprise Intelligence, Forecast Calibration &
 * Human-Reviewed Early Warning Center (Phase AI-OPS-39).
 *
 * Observed Signals→Forecast Definition→Baseline→Leading Indicator→Trend→Forecast Run→
 * Prediction Error→Calibration→Drift→Threshold Candidate→Early Warning Candidate→
 * Cross-Domain Impact→Human Review→Escalation Recommendation→Outcome→Effectiveness→Audit.
 * Forecast ≠ Future Fact · Warning Candidate ≠ Alert · Threshold Candidate ≠ Applied ·
 * Confidence ≠ Correctness · No Warning ≠ No Risk.
 * 자동 Alert 발송/Incident 생성/Escalation/Threshold·Runtime·Production 변경 없음.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, BookOpen, ClipboardList, DollarSign, Gauge, Grid3x3,
  History, Layers, Lightbulb, ListOrdered, Lock, RefreshCw, Scale, Search, Shield,
  TrendingUp, Users,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchForecastIntelSummary, fetchForecastDefinitions, createForecastDefinition, reviewForecastDefinition,
  fetchForecastRuns, createForecastRun, recordForecastRun, fetchWarningCandidates,
  createWarningCandidate, reviewWarningCandidate, recordForecastEvent, fetchEnterpriseForecastAudit,
  type ForecastIntelSummary, type ForecastDefinitionRow, type ForecastRunRow,
  type WarningCandidateRow, type EnterpriseForecastEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  FORECAST_DOMAINS, BASELINE_METHODS, FORECAST_METHODS, WARNING_TYPES, THRESHOLD_TYPES,
  BASELINE_RESULTS, LEADING_INDICATOR_RESULTS, TREND_RESULTS, PREDICTION_ERROR_RESULTS,
  CALIBRATION_RESULTS, FORECAST_DRIFT_RESULTS, FALSE_POSITIVE_RESULTS, FALSE_NEGATIVE_RESULTS,
  WARNING_EFFECTIVENESS_RESULTS, buildForecastTimeline, FORECAST_COMPONENTS, FORECAST_SUPPORT_MATRIX,
} from '@/lib/predictiveEnterprise';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'definitions' | 'pendingdef' | 'signalsources' | 'signalwindows' | 'baselines'
  | 'leading' | 'lagging' | 'trend' | 'runs' | 'results' | 'error' | 'calibration' | 'drift'
  | 'thresholds' | 'pendingthreshold' | 'warnings' | 'pendingwarning' | 'wruntime' | 'wconnector'
  | 'wapproval' | 'wincident' | 'wrecovery' | 'wcapacity' | 'wcost' | 'wworkload' | 'wsecurity'
  | 'wprivacy' | 'wcompliance' | 'crossdomain' | 'leadtime' | 'falsepositive' | 'falsenegative'
  | 'outcomes' | 'effectiveness' | 'humanreviews' | 'recommendations' | 'timeline' | 'audit'
  | 'support' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Overview', icon: Layers },
  { key: 'definitions', label: 'Forecast Definitions', icon: BookOpen },
  { key: 'pendingdef', label: 'Pending Definition Review', icon: Scale },
  { key: 'signalsources', label: 'Signal Sources', icon: Activity },
  { key: 'signalwindows', label: 'Signal Windows', icon: ListOrdered },
  { key: 'baselines', label: 'Baselines', icon: Gauge },
  { key: 'leading', label: 'Leading Indicators', icon: TrendingUp },
  { key: 'lagging', label: 'Lagging Indicators', icon: History },
  { key: 'trend', label: 'Trend Analysis', icon: TrendingUp },
  { key: 'runs', label: 'Forecast Runs', icon: RefreshCw },
  { key: 'results', label: 'Forecast Results', icon: Search },
  { key: 'error', label: 'Prediction Error', icon: Scale },
  { key: 'calibration', label: 'Confidence Calibration', icon: Gauge },
  { key: 'drift', label: 'Forecast Drift', icon: Activity },
  { key: 'thresholds', label: 'Threshold Candidates', icon: ListOrdered },
  { key: 'pendingthreshold', label: 'Pending Threshold Review', icon: Scale },
  { key: 'warnings', label: 'Early Warning Candidates', icon: AlertTriangle },
  { key: 'pendingwarning', label: 'Pending Warning Review', icon: Scale },
  { key: 'wruntime', label: 'Runtime Warnings', icon: AlertTriangle },
  { key: 'wconnector', label: 'Connector Warnings', icon: AlertTriangle },
  { key: 'wapproval', label: 'Approval Warnings', icon: ListOrdered },
  { key: 'wincident', label: 'Incident Warnings', icon: AlertTriangle },
  { key: 'wrecovery', label: 'Recovery Warnings', icon: RefreshCw },
  { key: 'wcapacity', label: 'Capacity Warnings', icon: Activity },
  { key: 'wcost', label: 'Cost Warnings', icon: DollarSign },
  { key: 'wworkload', label: 'Workload Warnings', icon: Users },
  { key: 'wsecurity', label: 'Security Warnings', icon: Shield },
  { key: 'wprivacy', label: 'Privacy Warnings', icon: Shield },
  { key: 'wcompliance', label: 'Compliance Warnings', icon: Shield },
  { key: 'crossdomain', label: 'Cross-Domain Impact', icon: Layers },
  { key: 'leadtime', label: 'Lead Time', icon: History },
  { key: 'falsepositive', label: 'False Positive Candidates', icon: Scale },
  { key: 'falsenegative', label: 'False Negative Candidates', icon: Scale },
  { key: 'outcomes', label: 'Warning Outcomes', icon: Search },
  { key: 'effectiveness', label: 'Warning Effectiveness', icon: Gauge },
  { key: 'humanreviews', label: 'Human Reviews', icon: Users },
  { key: 'recommendations', label: 'Recommendations', icon: Lightbulb },
  { key: 'timeline', label: 'Timeline', icon: History },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
  { key: 'limitations', label: 'Known Limitations', icon: ClipboardList },
];
const WARNING_TAB_TYPES: Partial<Record<Tab, string[]>> = {
  wruntime: ['runtime_degradation_candidate', 'throughput_decline_candidate'],
  wconnector: ['connector_degradation_candidate', 'connector_failure_candidate'],
  wapproval: ['approval_bottleneck_candidate'],
  wincident: ['incident_escalation_candidate'],
  wrecovery: ['recovery_deterioration_candidate'],
  wcapacity: ['capacity_exhaustion_candidate'],
  wcost: ['cost_escalation_candidate'],
  wworkload: ['workload_overload_candidate'],
  wsecurity: ['security_risk_candidate'],
  wprivacy: ['privacy_risk_candidate'],
  wcompliance: ['compliance_risk_candidate'],
};

const KNOWN_LIMITATIONS = [
  '학습된 Forecast Model 없음 — 단순 Trend Projection Reference 중심(forecast_model_unavailable 상태 실존)',
  'Anomaly Detection 엔진/Alert Dispatcher/Pager 없음 — Warning 은 Candidate 로만 존재하며 발송되지 않습니다',
  '외부 Provider/Region 장애 피드·휴가 캘린더·Seasonality 데이터셋 없음 — 관련 판정은 unverified 유지',
  'Human Workload/Queue 는 승인 대기 Proxy 중심 · Cost/Capacity Forecast 모델 제한(0508 스냅샷 기반)',
  'Leading Indicator 는 상관 후보 중심(post-hoc 선택 차단) — Correlation ≠ Causality',
  'Threshold 는 Candidate 중심 — 자동 적용 없음(실제 시스템 Threshold 변경 RPC 자체가 없음)',
  'False Positive/Negative 는 Outcome 연결 후에만 평가 · Calibration 은 충분한 Forecast Outcome 필요 · Drift 는 장기 데이터 필요',
  '자동 Alert/Incident/Escalation/Capacity Scaling 없음 — Human Review 필수',
  'Migration 0472~0543 production 미적용 — 운영 수치는 적용 후 축적됩니다',
];

export default function PredictiveEnterpriseSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<ForecastIntelSummary>({});
  const [defs, setDefs] = useState<ForecastDefinitionRow[]>([]);
  const [runs, setRuns] = useState<ForecastRunRow[]>([]);
  const [warnings, setWarnings] = useState<WarningCandidateRow[]>([]);
  const [audit, setAudit] = useState<EnterpriseForecastEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [selDef, setSelDef] = useState('');
  const [selRun, setSelRun] = useState('');
  const [selWarn, setSelWarn] = useState('');
  const [domain, setDomain] = useState<string>('connector_timeout');
  const [baselineMethod, setBaselineMethod] = useState<string>('rolling_average_baseline');
  const [forecastMethod, setForecastMethod] = useState<string>('rolling_trend_reference');
  const [warningType, setWarningType] = useState<string>('connector_degradation_candidate');
  const [thresholdType, setThresholdType] = useState<string>('slope');
  const [resultSel, setResultSel] = useState<string>('baseline_ready_reference');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, d, r, w, a] = await Promise.all([
        fetchForecastIntelSummary(), fetchForecastDefinitions(null, 200), fetchForecastRuns(null, 200),
        fetchWarningCandidates(null, 200), fetchEnterpriseForecastAudit(200),
      ]);
      setSummary(s); setDefs(d); setRuns(r); setWarnings(w); setAudit(a);
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
  const needDef = (): ForecastDefinitionRow | null => {
    const d = defs.find((x) => x.id === selDef);
    if (!d) { toast.error('Definition 선택 필수'); return null; }
    return d;
  };
  const defReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason(); const d = needDef();
    if (!r || !d) return;
    void act(() => reviewForecastDefinition(d.id, action, r, payload), ok);
  };
  const runReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selRun) { if (!selRun) toast.error('Run 선택 필수'); return; }
    void act(() => recordForecastRun(selRun, action, r, payload), ok);
  };
  const warnReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selWarn) { if (!selWarn) toast.error('Warning 선택 필수'); return; }
    void act(() => reviewWarningCandidate(selWarn, action, r, payload), ok);
  };
  const fcEvent = (kind: string, payload: Record<string, unknown>, ok: string, ids: { def?: boolean; run?: boolean; warn?: boolean } = {}) => {
    const r = needReason();
    if (!r) return;
    void act(() => recordForecastEvent(kind, r, payload, ids.def ? (selDef || null) : null, ids.run ? (selRun || null) : null, ids.warn ? (selWarn || null) : null), ok);
  };

  const obj = useCallback((k: string): Record<string, unknown> => (typeof summary[k] === 'object' && summary[k] !== null && !Array.isArray(summary[k]) ? summary[k] as Record<string, unknown> : {}), [summary]);
  const num = useCallback((k: string, sub: string): number | null => {
    const v = obj(k)[sub];
    return typeof v === 'number' ? v : null;
  }, [obj]);

  const timeline = useMemo(() => buildForecastTimeline([
    { stage: 'definition', count: num('definitions', 'total'), source: 'definitions 실측' },
    { stage: 'baseline', count: num('forecast_events', 'baselines'), source: 'events 실측' },
    { stage: 'signal_window', count: num('forecast_events', 'signal_windows'), source: 'events 실측' },
    { stage: 'leading_indicator', count: num('forecast_events', 'leading_indicators'), source: 'events 실측' },
    { stage: 'trend', count: num('forecast_events', 'trend_reviews'), source: 'events 실측' },
    { stage: 'forecast_run', count: num('runs', 'total'), source: 'runs 실측' },
    { stage: 'threshold_candidate', count: num('forecast_events', 'threshold_candidates'), source: 'events 실측' },
    { stage: 'warning_candidate', count: num('warnings', 'total'), source: 'warnings 실측' },
    { stage: 'human_review', count: audit.filter((e) => e.event_type === 'early_warning_reviewed').length, source: 'events 실측' },
    { stage: 'outcome', count: num('warnings', 'outcome_linked'), source: 'warnings 실측' },
  ]), [num, audit]);

  if (loading) return <AdminCard title="Predictive Enterprise Intelligence & Early Warning"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Predictive Enterprise Intelligence & Early Warning">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const defSelect = (
    <select value={selDef} onChange={(e) => setSelDef(e.target.value)} className="min-w-[190px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Definition 선택</option>
      {defs.map((d) => <option key={d.id} value={d.id}>{d.forecast_code} · {d.definition_status}</option>)}
    </select>
  );
  const runSelect = (
    <select value={selRun} onChange={(e) => setSelRun(e.target.value)} className="min-w-[170px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Run 선택</option>
      {runs.map((r) => <option key={r.id} value={r.id}>{r.run_code} · {r.run_status}</option>)}
    </select>
  );
  const warnSelect = (
    <select value={selWarn} onChange={(e) => setSelWarn(e.target.value)} className="min-w-[190px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Warning 선택</option>
      {warnings.map((w) => <option key={w.id} value={w.id}>{w.warning_code} · {w.warning_status}</option>)}
    </select>
  );
  const reasonInput = <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button disabled={busy} onClick={onClick} className={primary ? 'rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50' : 'rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50'}>{label}</button>
  );
  const tone = (s: string) => (s.includes('approved') || s.includes('completed') || s.includes('ready') || s.includes('well_calibrated') || s.includes('effective_warning') || s.includes('closed_reference') ? 'success' as const : s.includes('rejected') || s.includes('invalidated') || s.includes('blocked') || s.includes('failed') || s.includes('critical') || s.includes('unavailable') || s === 'unsupported' ? 'danger' as const : 'warning' as const);
  const evByType = (t: string) => audit.filter((e) => e.event_type === t);
  const eventList = (rows: EnterpriseForecastEventRow[], emptyTitle: string, emptyDesc: string) => (
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
  const resultEventTab = (kind: string, title: string, note: string, results: readonly string[], ids: { def?: boolean; run?: boolean; warn?: boolean } = { run: true }) => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        {ids.def ? defSelect : null}{ids.run ? runSelect : null}{ids.warn ? warnSelect : null}
        <select value={results.includes(resultSel) ? resultSel : results[0]} onChange={(e) => setResultSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
          {results.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {reasonInput}
        {btn(`${title} 기록`, () => fcEvent(kind, { result: results.includes(resultSel) ? resultSel : results[0] }, `${title} 기록됨`, ids), true)}
      </div>
      <AdminAlert tone="info" description={note} />
      {eventList(evByType(kind), `${title} 없음`, '사람 검토 기록이 여기에 표시됩니다.')}
    </div>
  );
  const warningListTab = (types: string[], title: string) => {
    const list = warnings.filter((w) => types.includes(w.warning_type));
    return (
      <div className="space-y-2">
        <AdminAlert tone="info" description={`${title} — Warning Candidate ≠ Alert(발송 없음)·Severity 는 Incident Severity 가 아닙니다. No Warning ≠ No Risk.`} />
        {!list.length ? <AdminEmpty title={`${title} 없음`} description="0건은 위험 없음을 의미하지 않습니다(No Warning ≠ No Risk)." /> : (
          <div className="space-y-1">
            {list.slice(0, 30).map((w) => (
              <div key={w.id} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone={tone(w.severity_candidate)}>{w.severity_candidate}</AdminBadge>
                <AdminBadge tone={tone(w.warning_status)}>{w.warning_status}</AdminBadge>
                <span className="ml-2 font-bold">{w.warning_code}</span>
                <span className="ml-2 text-muted-foreground">{w.warning_type} · lead {NUM(w.expected_lead_time_minutes)}분(추정) · confidence {NUM(w.confidence)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };
  const warnTabTypes = WARNING_TAB_TYPES[tab];

  return (
    <AdminCard
      title="Predictive Enterprise Intelligence & Early Warning"
      subtitle="Signals→Forecast Definition→Baseline→Leading Indicator→Trend→Forecast Run→Error→Calibration→Drift→Threshold Candidate→Early Warning Candidate→Human Review→Outcome→Effectiveness — 자동 경보·Incident·Escalation·Threshold 변경 없음"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 위험이 현실화되기 전의 선행 신호와 추세를 Candidate/Reference 계층에서만 분석합니다. 실제 Alert 발송/Incident 생성/Escalation/Threshold 변경/Runtime·Connector·Automation·Policy·Capacity·Infrastructure·Production 변경은 수행하지 않습니다. Forecast ≠ Future Fact, Trend ≠ Guaranteed Continuation, Leading Indicator ≠ Cause, Warning Candidate ≠ Alert, Threshold Candidate ≠ Applied Threshold, Confidence ≠ Correctness, High Confidence ≠ High Accuracy, No Warning ≠ No Risk. 실제 발송하지 않은 경보를 Sent 로 표시하지 않습니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Forecast Definitions" value={NUM(num('definitions', 'total'))} />
            <Box label="Pending Definition Review" value={NUM(num('definitions', 'pending_review'))} />
            <Box label="Forecast Runs" value={NUM(num('runs', 'total'))} />
            <Box label="Runs Completed" value={NUM(num('runs', 'completed'))} />
            <Box label="Runs Blocked / Unverified" value={`${NUM(num('runs', 'blocked'))} / ${NUM(num('runs', 'unverified'))}`} />
            <Box label="Model / Baseline Unavailable" value={`${NUM(num('runs', 'model_unavailable'))} / ${NUM(num('runs', 'baseline_unavailable'))}`} />
            <Box label="Baselines Recorded" value={NUM(num('forecast_events', 'baselines'))} />
            <Box label="Signal Windows" value={NUM(num('forecast_events', 'signal_windows'))} />
            <Box label="Leading Indicator Reviews" value={NUM(num('forecast_events', 'leading_indicators'))} />
            <Box label="Trend Reviews" value={NUM(num('forecast_events', 'trend_reviews'))} />
            <Box label="Calibration Reviews" value={NUM(num('forecast_events', 'calibration_reviews'))} />
            <Box label="Drift Reviews" value={NUM(num('forecast_events', 'drift_reviews'))} />
            <Box label="Threshold Candidates" value={NUM(num('forecast_events', 'threshold_candidates'))} />
            <Box label="Warning Candidates" value={NUM(num('warnings', 'total'))} />
            <Box label="Pending Warning Review" value={NUM(num('warnings', 'pending_review'))} />
            <Box label="Watch References" value={NUM(num('warnings', 'watch'))} />
            <Box label="Escalation Recommendations" value={NUM(num('warnings', 'escalation_recommended'))} />
            <Box label="Critical Warning Candidates" value={NUM(num('warnings', 'critical'))} />
            <Box label="False Positive Candidates" value={NUM(num('warnings', 'false_positive_candidates'))} />
            <Box label="Outcome Pending / Linked" value={`${NUM(num('warnings', 'outcome_pending'))} / ${NUM(num('warnings', 'outcome_linked'))}`} />
            <Box label="FP / FN Reviews" value={`${NUM(num('forecast_events', 'false_positive_reviews'))} / ${NUM(num('forecast_events', 'false_negative_reviews'))}`} />
            <Box label="Effectiveness Reviews" value={NUM(num('forecast_events', 'effectiveness_reviews'))} />
            <Box label="Sample Too Small(Runs)" value={NUM(num('runs', 'sample_too_small'))} />
            <Box label="Learning References" value={NUM(num('forecast_events', 'learning_references'))} />
          </div>
          <AdminAlert tone="info" description={`forecast_unavailable: ${Array.isArray(summary.forecast_unavailable) ? (summary.forecast_unavailable as unknown[]).map(String).join(', ') : '—'}. Signal 원천 실측 — Assurance Signals(0537) ${NUM(num('signal_actuals', 'assurance_signals_0537'))}건 · Runtime Events(0536) ${NUM(num('signal_actuals', 'runtime_events_0536'))}건 · Scenario Runs(0542) ${NUM(num('signal_actuals', 'scenario_runs_0542'))}건 · Cost Snapshots(0508) ${NUM(num('signal_actuals', 'cost_snapshots_0508'))}건. 0 과 Unknown 을 혼동하지 않습니다.`} />
        </div>
      )}

      {tab === 'definitions' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <select value={domain} onChange={(e) => setDomain(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {FORECAST_DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <select value={baselineMethod} onChange={(e) => setBaselineMethod(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {BASELINE_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            {reasonInput}
            {btn('Definition 생성(자동 경보 아님)', () => {
              const r = needReason();
              if (!r) return;
              void act(() => createForecastDefinition({ forecast_domain: domain, forecast_name: r, target_metric: `${domain}_metric`, baseline_method: baselineMethod }), 'Definition 생성됨(draft — Monitoring 설정 아님)');
            }, true)}
          </div>
          {!defs.length ? <AdminEmpty title="Definition 없음" description="핵심 질문 예: Incident 증가 전 선행 신호? Timeout→장애 가능성? Queue 증가→병목? Capacity 며칠 내 한계? 비용 증가 일시적/구조적? — 전부 Candidate 분석." /> : (
            <div className="space-y-1">
              {defs.slice(0, 30).map((d) => (
                <div key={d.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <AdminBadge tone={tone(d.definition_status)}>{d.definition_status}</AdminBadge>
                  <AdminBadge tone={tone(d.support_status)}>{d.support_status}</AdminBadge>
                  <span className="ml-2 font-bold">{d.forecast_code}</span>
                  <span className="ml-2 text-muted-foreground">{d.forecast_domain} · {d.target_metric} · baseline {d.baseline_method} · model {d.model_reference_type}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'pendingdef' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {defSelect}{reasonInput}
            {btn('검토 시작', () => defReview('start_review', {}, '검토 시작'))}
            {btn('Evidence 요청', () => defReview('request_evidence', {}, 'Evidence 요청'))}
            {btn('검토 완료', () => defReview('mark_reviewed', {}, 'reviewed_reference'))}
            {btn('Forecast 승인(Evidence)', () => defReview('approve_for_forecast', { evidence: [reason.trim()] }, 'approved(자동 경보 승인 아님)'), true)}
            {btn('차단', () => defReview('block_forecast', {}, 'forecast_blocked'))}
            {btn('기각', () => defReview('reject', {}, '기각'))}
            {btn('무효화', () => defReview('invalidate', {}, '무효화'))}
          </div>
          <AdminAlert tone="info" description="approved_for_forecast_reference 는 자동 경보 승인이 아닙니다. Evidence 없는 승인 서버 거부·종결 재결정 차단·self-review 경고." />
          {eventList(evByType('forecast_definition_reviewed'), 'Definition 검토 없음', '사람 검토 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'signalsources' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Signal 원천 실측(전부 읽기 전용) — Latency/Timeout/Failure/Incident/Recovery/Approval/Cost/Capacity/Scenario Prediction/Outcome 이력." />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Assurance Signals(0537)" value={NUM(num('signal_actuals', 'assurance_signals_0537'))} />
            <Box label="Runtime Events(0536)" value={NUM(num('signal_actuals', 'runtime_events_0536'))} />
            <Box label="Incident Candidates(0537)" value={NUM(num('signal_actuals', 'incident_candidates_0537'))} />
            <Box label="Incidents(0502)" value={NUM(num('signal_actuals', 'incidents_0502'))} />
            <Box label="Recovery Candidates(0502)" value={NUM(num('signal_actuals', 'recovery_candidates_0502'))} />
            <Box label="Execution Requests(0535)" value={NUM(num('signal_actuals', 'execution_requests_0535'))} />
            <Box label="Capacity Metrics(0508)" value={NUM(num('signal_actuals', 'capacity_metrics_0508'))} />
            <Box label="Capacity Snapshots(0508)" value={NUM(num('signal_actuals', 'capacity_snapshots_0508'))} />
            <Box label="Cost Snapshots(0508)" value={NUM(num('signal_actuals', 'cost_snapshots_0508'))} />
            <Box label="Scenario Runs(0542)" value={NUM(num('signal_actuals', 'scenario_runs_0542'))} />
            <Box label="Twin Runs(0540)" value={NUM(num('signal_actuals', 'twin_runs_0540'))} />
            <Box label="Decision Outcomes(0514)" value={NUM(num('signal_actuals', 'decision_outcomes_0514'))} />
          </div>
        </div>
      )}

      {tab === 'signalwindows' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {defSelect}{reasonInput}
            {btn('Signal Window 기록', () => fcEvent('signal_window_recorded', { note: 'window_is_not_cause' }, 'Signal Window 기록됨(원인 아님)', { def: true }), true)}
          </div>
          <AdminAlert tone="info" description="최대 365일·샘플 10,000 제한(서버 차단)·완전성/순서/NaN 검증. Signal Window ≠ 원인." />
          {eventList(evByType('signal_window_recorded'), 'Signal Window 없음', '관측 창 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'baselines' && resultEventTab('baseline_recorded', 'Baseline 기록', 'Baseline 11 method·8 판정 — Baseline ≠ 미래 보장. 없으면 baseline_unavailable 유지.', BASELINE_RESULTS, { def: true })}
      {tab === 'leading' && resultEventTab('leading_indicator_reviewed', 'Leading Indicator 검토', 'Leading Indicator ≠ Cause·post-hoc 선택 차단·Correlation ≠ Causality.', LEADING_INDICATOR_RESULTS, { def: true })}
      {tab === 'lagging' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Lagging Indicator — 사건 이후 변화하는 지표 구분(선행 아님)." />
          {eventList(evByType('leading_indicator_reviewed').filter((e) => String(e.payload?.result ?? '') === 'lagging_indicator_candidate'), 'Lagging Indicator 없음', 'lagging_indicator_candidate 판정이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'trend' && resultEventTab('trend_reviewed', 'Trend 검토', 'slope/acceleration/volatility 기반 — Trend ≠ Guaranteed Continuation. 미래 지속을 가정하지 않습니다.', TREND_RESULTS, { def: true })}

      {tab === 'runs' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {defSelect}
            <select value={forecastMethod} onChange={(e) => setForecastMethod(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {FORECAST_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            {reasonInput}
            {btn('Forecast Run 생성', () => {
              const r = needReason(); const d = needDef();
              if (!r || !d) return;
              void act(() => createForecastRun({ forecast_definition_id: d.id, forecast_method: forecastMethod, forecast_horizon_minutes: 10080, limitations: [r] }), 'Run 생성됨(draft — Forecast ≠ Future Fact)');
            }, true)}
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {runSelect}{reasonInput}
            {btn('Ready', () => runReview('mark_ready', {}, 'ready_reference'))}
            {btn('시작 Reference', () => runReview('start_reference', {}, '시작(started_at 기록)'))}
            {btn('완료(Evidence)', () => runReview('complete_reference', { evidence: [reason.trim()] }, 'completed(Forecast ≠ Future Fact)'), true)}
            {btn('Model 없음', () => runReview('mark_model_unavailable', {}, 'forecast_model_unavailable'))}
            {btn('Baseline 없음', () => runReview('mark_baseline_unavailable', {}, 'baseline_unavailable'))}
            {btn('차단', () => runReview('block', {}, 'blocked_reference'))}
            {btn('무효화', () => runReview('invalidate', {}, '무효화'))}
          </div>
          <AdminAlert tone="info" description="Definition 승인 선행·금지 method 4종(autonomous_ml_training 등) 서버 차단·미실행 completed 차단(Evidence+started_at). Horizon 15분~365일, 기간이 길수록 Confidence 상한 하락(1h:95→90d초과:25)." />
          {!runs.length ? <AdminEmpty title="Forecast Run 없음" description="승인된 Definition 에서만 생성 가능합니다." /> : (
            <div className="space-y-1">
              {runs.slice(0, 30).map((r) => (
                <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <AdminBadge tone={tone(r.run_status)}>{r.run_status}</AdminBadge>
                  <span className="ml-2 font-bold">{r.run_code}</span>
                  <span className="ml-2 text-muted-foreground">{r.forecast_domain} · {r.forecast_method} · horizon {NUM(r.forecast_horizon_minutes)}분 · confidence {NUM(r.confidence)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'results' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="예측 값/범위/방향/Risk Class/Threshold 도달 후보 — 전부 Reference(보장 아님)." />
          {!runs.filter((r) => r.predicted_value != null).length ? <AdminEmpty title="Forecast 결과 없음" description="Run 완료 시 예측 결과가 여기에 표시됩니다." /> : (
            <div className="space-y-1">
              {runs.filter((r) => r.predicted_value != null).slice(0, 30).map((r) => (
                <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <span className="font-bold">{r.run_code}</span>
                  <span className="ml-2">predicted {NUM(r.predicted_value)} [{NUM(r.predicted_range_low)}~{NUM(r.predicted_range_high)}] · {r.predicted_direction ?? '—'} · {r.predicted_risk_class ?? '—'}</span>
                  <span className="ml-2 text-muted-foreground">crossing {r.predicted_threshold_crossing_at ? new Date(r.predicted_threshold_crossing_at).toLocaleString('ko-KR') : '—'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'error' && resultEventTab('prediction_error_recorded', 'Prediction Error 기록', 'Observed Outcome 연결 후에만 계산 — Error ≠ Model Failure. Null 은 유지됩니다.', PREDICTION_ERROR_RESULTS)}
      {tab === 'calibration' && resultEventTab('calibration_reviewed', 'Calibration 검토', 'Confidence 대비 실제 적중률 — over/underconfident 후보. Calibration Candidate ≠ Verified Calibration, High Confidence ≠ High Accuracy.', CALIBRATION_RESULTS)}
      {tab === 'drift' && resultEventTab('forecast_drift_reviewed', 'Forecast Drift 검토', 'Input/Baseline/Error/Confidence/Model 등 13차원 — Drift Candidate ≠ Confirmed Drift, No Detected Drift ≠ No Drift.', FORECAST_DRIFT_RESULTS)}

      {tab === 'thresholds' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {defSelect}
            <select value={thresholdType} onChange={(e) => setThresholdType(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {THRESHOLD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Threshold Candidate 생성', () => fcEvent('threshold_candidate_created', { threshold_type: thresholdType, evidence: [reason.trim()] }, 'Threshold Candidate 기록(적용 아님)', { def: true }), true)}
          </div>
          <AdminAlert tone="info" description="14 타입 whitelist — Threshold Candidate ≠ Applied Threshold. 실제 시스템 Threshold 를 변경하는 RPC 자체가 없습니다. 근거 없는 Threshold 는 threshold_unverified." />
          {eventList(evByType('threshold_candidate_created'), 'Threshold Candidate 없음', '후보 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'pendingthreshold' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {defSelect}{reasonInput}
            {btn('Threshold Review 기록', () => fcEvent('threshold_candidate_reviewed', { note: 'candidate_only' }, 'Threshold 검토 기록됨(적용 아님)', { def: true }), true)}
          </div>
          <AdminAlert tone="info" description="approved_for_warning_reference 도 실제 시스템 Threshold 적용이 아닙니다." />
          {eventList(evByType('threshold_candidate_reviewed'), 'Threshold Review 없음', '사람 검토 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'warnings' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {defSelect}
            <select value={warningType} onChange={(e) => setWarningType(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {WARNING_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Warning Candidate 생성', () => {
              const r = needReason(); const d = needDef();
              if (!r || !d) return;
              void act(() => createWarningCandidate({ forecast_definition_id: d.id, warning_type: warningType, evidence: [r] }), 'Warning Candidate 생성(Alert 아님·발송 없음)');
            }, true)}
          </div>
          <AdminAlert tone="info" description="Warning Candidate ≠ Alert — Dispatcher 가 없으므로 발송 자체가 불가능합니다. Severity 는 후보이며 Incident Severity 가 아닙니다." />
          {!warnings.length ? <AdminEmpty title="Warning Candidate 없음" description="0건은 위험 없음을 의미하지 않습니다(No Warning ≠ No Risk)." /> : (
            <div className="space-y-1">
              {warnings.slice(0, 30).map((w) => (
                <div key={w.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <AdminBadge tone={tone(w.severity_candidate)}>{w.severity_candidate}</AdminBadge>
                  <AdminBadge tone={tone(w.warning_status)}>{w.warning_status}</AdminBadge>
                  <span className="ml-2 font-bold">{w.warning_code}</span>
                  <span className="ml-2 text-muted-foreground">{w.warning_type} · {w.warning_domain}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'pendingwarning' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {warnSelect}{reasonInput}
            {btn('검토 시작', () => warnReview('start_review', {}, '검토 시작'))}
            {btn('검토 완료', () => warnReview('mark_reviewed', {}, 'reviewed_reference'))}
            {btn('Watch', () => warnReview('watch', {}, 'watch_reference'))}
            {btn('Escalation 권고(Evidence)', () => warnReview('recommend_escalation', { evidence: [reason.trim()] }, 'Escalation Recommendation(실제 Escalation 아님)'), true)}
            {btn('기각', () => warnReview('dismiss', {}, 'dismissed_reference'))}
            {btn('FP 후보', () => warnReview('mark_false_positive', {}, 'false_positive_candidate'))}
            {btn('Closure(Evidence)', () => warnReview('close', { evidence: [reason.trim()] }, 'closed_reference'))}
            {btn('무효화', () => warnReview('invalidate', {}, '무효화'))}
          </div>
          <AdminAlert tone="info" description="escalation_recommended_reference 는 실제 Escalation 이 아니며 발송/Ticket/Issue 생성이 없습니다. AI 의 Warning 은 Incident/Escalation 을 대체하지 않습니다." />
          {eventList([...evByType('early_warning_reviewed'), ...evByType('escalation_recommendation_recorded'), ...evByType('warning_watch_reference_recorded')], 'Warning 검토 없음', '사람 검토 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {warnTabTypes && warningListTab(warnTabTypes, TABS.find((t) => t.key === tab)?.label ?? '')}

      {tab === 'crossdomain' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Cross-Domain Impact — Runtime/Connector/Approval/Incident/Capacity/Cost/Security/Privacy/Compliance/Settlement/Payment 등. Settlement·Payment 는 영향 Reference 만(변경 없음). cross-enterprise 차단." />
          {!warnings.filter((w) => w.cross_domain_impact).length ? <AdminEmpty title="Cross-Domain Impact 없음" description="Warning 의 cross_domain_impact JSONB 가 여기에 표시됩니다." /> : (
            <div className="space-y-1">
              {warnings.filter((w) => w.cross_domain_impact).slice(0, 20).map((w) => (
                <div key={w.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <span className="font-bold">{w.warning_code}</span>
                  <span className="ml-2 break-all font-mono text-[10px] text-muted-foreground">{JSON.stringify(w.cross_domain_impact).slice(0, 300)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'leadtime' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Warning Lead Time — 최초 Signal→Warning→실제 Event→Human Review 시점 비교. Lead Time ≠ 보장된 대응 시간, warning_after_event 후보 포함." />
          {!warnings.filter((w) => w.expected_lead_time_minutes != null).length ? <AdminEmpty title="Lead Time 데이터 없음" description="Warning 의 expected_lead_time(추정)과 Outcome 연결 후 실측 lead time 이 여기에 표시됩니다." /> : (
            <div className="space-y-1">
              {warnings.filter((w) => w.expected_lead_time_minutes != null).slice(0, 30).map((w) => (
                <div key={w.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <span className="font-bold">{w.warning_code}</span>
                  <span className="ml-2">expected lead {NUM(w.expected_lead_time_minutes)}분(추정 — 보장 아님)</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'falsepositive' && resultEventTab('false_positive_candidate_reviewed', 'False Positive 검토', 'Observation Window 종료+Event 미발생 기반 후보 — Confirmed FP 아님.', FALSE_POSITIVE_RESULTS, { warn: true })}
      {tab === 'falsenegative' && resultEventTab('false_negative_candidate_reviewed', 'False Negative 검토', '사전 Warning 없이 Event 발생 — missed signal/threshold gap/data gap 후보. Confirmed FN 아님·No Warning ≠ No Risk.', FALSE_NEGATIVE_RESULTS, { warn: true })}

      {tab === 'outcomes' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {warnSelect}{reasonInput}
            {btn('Outcome Reference 연결', () => warnReview('link_outcome', { causality_status: 'causality_unverified' }, 'Outcome 연결(예방 증명 아님)'), true)}
          </div>
          <AdminAlert tone="info" description="Outcome Link 는 Warning 이 사건을 예방했다는 증명이 아닙니다 — Causality 미검토 시 unverified 유지." />
          {eventList(evByType('warning_outcome_linked'), 'Outcome Link 없음', '실제 관측 결과 연결이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'effectiveness' && resultEventTab('warning_effectiveness_reviewed', 'Warning Effectiveness 검토', 'Lead Time/Human Review 시점/FP 비율 기반 후보 — too_late/missed/excessive FP 포함. 예방 증명 아님.', WARNING_EFFECTIVENESS_RESULTS, { warn: true })}

      {tab === 'humanreviews' && (
        eventList([...evByType('forecast_definition_reviewed'), ...evByType('early_warning_reviewed'), ...evByType('threshold_candidate_reviewed')].sort((a, b) => b.created_at.localeCompare(a.created_at)), 'Human Review 없음', '모든 승인·기각·Watch·Closure 는 사람 기록으로만 남습니다.')
      )}

      {tab === 'recommendations' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {defSelect}{reasonInput}
            {btn('Learning Reference 기록', () => fcEvent('forecast_learning_reference_recorded', { evidence: [reason.trim()] }, 'Forecast Learning Reference 기록됨', { def: true }), true)}
          </div>
          <AdminAlert tone="info" description="추천 23 유형은 순수 로직(buildForecastRecommendation·Evidence 필수)으로 계산되며 자동 경보 발송/실행이 없습니다 — Recommendation ≠ Decision." />
          {eventList(evByType('forecast_learning_reference_recorded'), 'Learning Reference 없음', 'Forecast 학습 참조 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'timeline' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="측정 카운트 요약 — 완료 주장이 아닙니다. Unknown 은 insufficient_data 로 유지합니다." />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            {timeline.stages.map((s) => (
              <div key={s.stage} className="rounded-lg border border-border p-2">
                <p className="text-[10px] font-bold text-muted-foreground">{s.stage}</p>
                <p className="mt-0.5 text-sm font-black">{s.status === 'measured' ? NUM(s.count) : 'insufficient_data'}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'audit' && (
        eventList(audit, 'Audit 없음', '24종 Forecast 이벤트 전체 감사 로그입니다.')
      )}

      {tab === 'support' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="실측 구성요소(추측 없음) — available:false 는 이 코드베이스에 해당 구조가 없음을 의미합니다." />
          <div className="space-y-1">
            {FORECAST_COMPONENTS.map((c) => (
              <div key={c.key} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone={c.available === true ? 'success' : c.available === false ? 'danger' : 'warning'}>{c.available === true ? 'available' : c.available === false ? 'unavailable' : 'unverified'}</AdminBadge>
                <span className="ml-2 font-bold">{c.key}</span>
                <span className="ml-2 text-muted-foreground">{c.note}</span>
              </div>
            ))}
          </div>
          <div className="space-y-1">
            {FORECAST_SUPPORT_MATRIX.map((s) => (
              <div key={s.key} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone={s.status === 'unsupported' ? 'danger' : s.status === 'fully_supported' ? 'success' : 'warning'}>{s.status}</AdminBadge>
                <span className="ml-2 font-bold">{s.key}</span>
                <span className="ml-2 text-muted-foreground">{s.note}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'limitations' && (
        <div className="space-y-1">
          {KNOWN_LIMITATIONS.map((l, i) => (
            <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone="warning">limitation</AdminBadge>
              <span className="ml-2">{l}</span>
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
