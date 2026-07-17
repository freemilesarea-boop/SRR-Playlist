/**
 * ScenarioIntelligenceSection — Enterprise Scenario Intelligence, Scenario Replay &
 * Multi-Future Comparison Center (Phase AI-OPS-38).
 *
 * Historical Event→Template(Versioning)→Replay→Branching→Variable Injection→Multi-Future→
 * Timeline→Cross-Scenario Comparison→Trade-off/Robustness/Regret→Human Review→
 * Executive Option Candidate→Decision Reference→Outcome Link→Accuracy/Drift→Audit.
 * Scenario ≠ Reality · Replay ≠ Reoccurrence · Branch Probability ≠ True Probability ·
 * Robust ≠ Correct · Lowest Regret ≠ Best Decision · Comparison ≠ Automatic Ranking.
 * Failure Injection/Chaos Test/자동 Decision/자동 실행/Production 변경 없음.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, BookOpen, ClipboardList, Copy, DollarSign, FlaskConical,
  GitBranch, Grid3x3, History, Layers, Lightbulb, ListOrdered, Lock, RefreshCw,
  Scale, Search, Shield, TrendingUp, Users,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchScenarioIntelSummary, fetchScenarioTemplates, createScenarioTemplate, reviewScenarioTemplate,
  versionScenarioTemplate, fetchScenarioRuns, createScenarioRun, recordScenarioRun,
  fetchScenarioBranches, recordScenarioBranch, reviewScenarioBranch, recordScenarioEvent,
  fetchScenarioAudit, fetchEnterpriseStateSnapshots,
  type ScenarioIntelSummary, type ScenarioTemplateRow, type ScenarioRunRow, type ScenarioBranchRow,
  type ScenarioEventRow, type EnterpriseStateSnapshotRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  SCENARIO_DOMAINS, TEMPLATE_SOURCE_TYPES, RUN_MODES, FUTURE_CASE_TYPES, TRANSITION_TYPES,
  ACCURACY_RESULTS, DRIFT_RESULTS, SCENARIO_RECOMMENDATION_TYPES,
  buildScenarioTimeline, SCENARIO_COMPONENTS, SCENARIO_SUPPORT_MATRIX,
} from '@/lib/scenarioIntelligence';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'templates' | 'versions' | 'historicalevents' | 'replay' | 'replayevidence'
  | 'variables' | 'builder' | 'injection' | 'timeline' | 'decisionpoints' | 'branches' | 'multifuture'
  | 'basecase' | 'bestcase' | 'worstcase' | 'noaction' | 'risk' | 'opportunity' | 'cost' | 'capacity'
  | 'approvalqueue' | 'incident' | 'humanworkload' | 'comparison' | 'tradeoff' | 'robustness' | 'regret'
  | 'commonrisks' | 'commonsafe' | 'execoptions' | 'humanreviews' | 'decisionrefs' | 'outcomes'
  | 'accuracy' | 'drift' | 'recommendations' | 'audit' | 'support' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Overview', icon: Layers },
  { key: 'templates', label: 'Scenario Templates', icon: BookOpen },
  { key: 'versions', label: 'Template Versions', icon: Copy },
  { key: 'historicalevents', label: 'Historical Events', icon: History },
  { key: 'replay', label: 'Historical Replay', icon: RefreshCw },
  { key: 'replayevidence', label: 'Replay Evidence', icon: ClipboardList },
  { key: 'variables', label: 'Scenario Variables', icon: ListOrdered },
  { key: 'builder', label: 'Scenario Builder', icon: FlaskConical },
  { key: 'injection', label: 'Scenario Injection', icon: Activity },
  { key: 'timeline', label: 'Timeline', icon: History },
  { key: 'decisionpoints', label: 'Decision Points', icon: Scale },
  { key: 'branches', label: 'Scenario Branches', icon: GitBranch },
  { key: 'multifuture', label: 'Multi-Future', icon: Layers },
  { key: 'basecase', label: 'Base Case', icon: Layers },
  { key: 'bestcase', label: 'Best Case', icon: TrendingUp },
  { key: 'worstcase', label: 'Worst Case', icon: AlertTriangle },
  { key: 'noaction', label: 'No Action Case', icon: Lock },
  { key: 'risk', label: 'Risk Projection', icon: AlertTriangle },
  { key: 'opportunity', label: 'Opportunity Projection', icon: TrendingUp },
  { key: 'cost', label: 'Cost Projection', icon: DollarSign },
  { key: 'capacity', label: 'Capacity Projection', icon: Activity },
  { key: 'approvalqueue', label: 'Approval Queue Projection', icon: ListOrdered },
  { key: 'incident', label: 'Incident Projection', icon: AlertTriangle },
  { key: 'humanworkload', label: 'Human Workload', icon: Users },
  { key: 'comparison', label: 'Scenario Comparison', icon: Scale },
  { key: 'tradeoff', label: 'Trade-off Analysis', icon: Scale },
  { key: 'robustness', label: 'Robustness', icon: Shield },
  { key: 'regret', label: 'Regret Analysis', icon: Scale },
  { key: 'commonrisks', label: 'Common Risks', icon: AlertTriangle },
  { key: 'commonsafe', label: 'Common Safe Conditions', icon: Shield },
  { key: 'execoptions', label: 'Executive Option Candidates', icon: Lightbulb },
  { key: 'humanreviews', label: 'Human Reviews', icon: Users },
  { key: 'decisionrefs', label: 'Decision References', icon: ClipboardList },
  { key: 'outcomes', label: 'Observed Outcomes', icon: Search },
  { key: 'accuracy', label: 'Accuracy Candidates', icon: Search },
  { key: 'drift', label: 'Drift Candidates', icon: Activity },
  { key: 'recommendations', label: 'Recommendations', icon: Lightbulb },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
  { key: 'limitations', label: 'Known Limitations', icon: ClipboardList },
];

const KNOWN_LIMITATIONS = [
  '실제 확률 모델 없음 — Branch Probability 는 Candidate 이며 근거(basis) 없이는 표시 자체가 차단됩니다',
  'Historical Event 는 결측/순서 불완전 가능 — gap/duplicate/ordering 후보로 정직 표기(Replay ≠ 완벽 재현)',
  'Provider 상태/Region 장애/휴가 캘린더 피드 없음 — 해당 도메인은 partially_supported',
  'Cost/Capacity Projection 모델 제한 — 0540 선형 추정 재사용(모델 없으면 cost_model_missing)',
  'Queue Projection 은 승인 대기 proxy · Multi-Agent Simulation 은 Reference 중심',
  '실제 Chaos Engine/Failure Injection/Production Replay 없음 — 금지 도메인 13종·금지 모드 5종 서버 차단',
  '자동 Scenario 선택/자동 Executive Decision 없음 — 모든 결정은 사람',
  'Accuracy 는 Observed Outcome 연결 후에만 · Drift 는 장기 관측 필요 · Correlation ≠ Causality',
  'Migration 0472~0542 production 미적용 — 운영 수치는 적용 후 축적됩니다',
];

export default function ScenarioIntelligenceSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<ScenarioIntelSummary>({});
  const [templates, setTemplates] = useState<ScenarioTemplateRow[]>([]);
  const [runs, setRuns] = useState<ScenarioRunRow[]>([]);
  const [branches, setBranches] = useState<ScenarioBranchRow[]>([]);
  const [audit, setAudit] = useState<ScenarioEventRow[]>([]);
  const [snapshots, setSnapshots] = useState<EnterpriseStateSnapshotRow[]>([]);
  const [reason, setReason] = useState('');
  const [selTpl, setSelTpl] = useState('');
  const [selSnap, setSelSnap] = useState('');
  const [selRun, setSelRun] = useState('');
  const [selRun2, setSelRun2] = useState('');
  const [selBranch, setSelBranch] = useState('');
  const [domain, setDomain] = useState<string>('connector_failure');
  const [sourceType, setSourceType] = useState<string>('historical_incident');
  const [runMode, setRunMode] = useState<string>('historical_replay_reference');
  const [caseType, setCaseType] = useState<string>('base_case_candidate');
  const [transitionType, setTransitionType] = useState<string>('metric_threshold');
  const [accResult, setAccResult] = useState<string>('accuracy_unverified');
  const [driftResult, setDriftResult] = useState<string>('drift_unverified');
  const [recType, setRecType] = useState<string>('compare_scenarios');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, tp, ru, br, au, sn] = await Promise.all([
        fetchScenarioIntelSummary(), fetchScenarioTemplates(null, 200), fetchScenarioRuns(null, 200),
        fetchScenarioBranches(null, 200), fetchScenarioAudit(200), fetchEnterpriseStateSnapshots(null, 50),
      ]);
      setSummary(s); setTemplates(tp); setRuns(ru); setBranches(br); setAudit(au); setSnapshots(sn);
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
  const needTpl = (): ScenarioTemplateRow | null => {
    const t = templates.find((x) => x.id === selTpl);
    if (!t) { toast.error('Template 선택 필수'); return null; }
    return t;
  };
  const needRun = (): ScenarioRunRow | null => {
    const r = runs.find((x) => x.id === selRun);
    if (!r) { toast.error('Run 선택 필수'); return null; }
    return r;
  };
  const tplReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason(); const t = needTpl();
    if (!r || !t) return;
    void act(() => reviewScenarioTemplate(t.id, action, r, payload), ok);
  };
  const runReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason(); const rn = needRun();
    if (!r || !rn) return;
    void act(() => recordScenarioRun(rn.id, action, r, payload), ok);
  };
  const scnEvent = (kind: string, payload: Record<string, unknown>, ok: string, ids: { tpl?: boolean; run?: boolean; branch?: boolean } = {}) => {
    const r = needReason();
    if (!r) return;
    if (ids.run && !selRun) { toast.error('Run 선택 필수'); return; }
    void act(() => recordScenarioEvent(kind, r, payload, ids.tpl ? (selTpl || null) : null, ids.run ? (selRun || null) : null, ids.branch ? (selBranch || null) : null), ok);
  };

  const obj = useCallback((k: string): Record<string, unknown> => (typeof summary[k] === 'object' && summary[k] !== null && !Array.isArray(summary[k]) ? summary[k] as Record<string, unknown> : {}), [summary]);
  const num = useCallback((k: string, sub: string): number | null => {
    const v = obj(k)[sub];
    return typeof v === 'number' ? v : null;
  }, [obj]);

  const timeline = useMemo(() => buildScenarioTimeline([
    { stage: 'template', count: num('templates', 'total'), source: 'templates 실측' },
    { stage: 'replay', count: num('scenario_events', 'replays_completed'), source: 'events 실측' },
    { stage: 'injection', count: audit.filter((e) => e.event_type === 'scenario_injection_reviewed').length, source: 'events 실측' },
    { stage: 'run', count: num('runs', 'total'), source: 'runs 실측' },
    { stage: 'branch', count: num('branches', 'total'), source: 'branches 실측' },
    { stage: 'multi_future', count: num('scenario_events', 'multi_future_sets'), source: 'events 실측' },
    { stage: 'comparison', count: num('scenario_events', 'comparisons'), source: 'events 실측' },
    { stage: 'human_review', count: num('scenario_events', 'human_reviews'), source: 'events 실측' },
    { stage: 'decision_reference', count: num('scenario_events', 'decision_references'), source: 'events 실측' },
    { stage: 'outcome', count: num('scenario_events', 'outcome_links'), source: 'events 실측' },
  ]), [num, audit]);

  if (loading) return <AdminCard title="Enterprise Scenario Intelligence & Multi-Future Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Enterprise Scenario Intelligence & Multi-Future Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const tplSelect = (
    <select value={selTpl} onChange={(e) => setSelTpl(e.target.value)} className="min-w-[190px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Template 선택</option>
      {templates.map((t) => <option key={t.id} value={t.id}>{t.template_code} v{t.template_version} · {t.template_status}</option>)}
    </select>
  );
  const snapSelect = (
    <select value={selSnap} onChange={(e) => setSelSnap(e.target.value)} className="min-w-[170px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Snapshot 선택</option>
      {snapshots.map((s) => <option key={s.id} value={s.id}>{s.snapshot_code}</option>)}
    </select>
  );
  const runSelect = (value: string, set: (v: string) => void, label: string) => (
    <select value={value} onChange={(e) => set(e.target.value)} className="min-w-[170px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">{label}</option>
      {runs.map((r) => <option key={r.id} value={r.id}>{r.run_code} · {r.run_status}</option>)}
    </select>
  );
  const branchSelect = (
    <select value={selBranch} onChange={(e) => setSelBranch(e.target.value)} className="min-w-[170px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Branch 선택</option>
      {branches.map((b) => <option key={b.id} value={b.id}>{b.branch_code} d{b.branch_depth} · {b.branch_status}</option>)}
    </select>
  );
  const reasonInput = <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button disabled={busy} onClick={onClick} className={primary ? 'rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50' : 'rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50'}>{label}</button>
  );
  const tone = (s: string) => (s.includes('approved') || s.includes('completed') || s.includes('ready') || s === 'supported_reference' || s === 'fully_supported' ? 'success' as const : s.includes('rejected') || s.includes('invalidated') || s.includes('blocked') || s.includes('failed') || s.includes('unavailable') || s === 'unsupported' ? 'danger' as const : 'warning' as const);
  const evByType = (t: string) => audit.filter((e) => e.event_type === t);
  const eventList = (rows: ScenarioEventRow[], emptyTitle: string, emptyDesc: string) => (
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
  const reviewEventTab = (kind: string, title: string, note: string, extraPayload: Record<string, unknown> = {}) => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        {runSelect(selRun, setSelRun, 'Run 선택')}{reasonInput}
        {btn(`${title} 기록`, () => scnEvent(kind, { note: 'candidate_only', ...extraPayload }, `${title} 기록됨`, { run: true }), true)}
      </div>
      <AdminAlert tone="info" description={note} />
      {eventList(evByType(kind), `${title} 없음`, '사람 검토 기록이 여기에 표시됩니다.')}
    </div>
  );
  const caseTab = (ct: string, title: string, note: string) => {
    const list = branches.filter((b) => b.future_case_type === ct);
    return (
      <div className="space-y-2">
        <AdminAlert tone="info" description={note} />
        {!list.length ? <AdminEmpty title={`${title} 없음`} description="Branches 탭에서 case 유형을 지정해 생성하세요 — 확정 미래가 아닙니다." /> : (
          <div className="space-y-1">
            {list.slice(0, 30).map((b) => (
              <div key={b.id} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone={tone(b.branch_status)}>{b.branch_status}</AdminBadge>
                <span className="ml-2 font-bold">{b.branch_code}</span>
                <span className="ml-2 text-muted-foreground">{b.branch_name} · depth {b.branch_depth} · 확률 {b.probability_candidate == null ? 'unverified(근거 없음)' : `${b.probability_candidate}% (Candidate)`}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <AdminCard
      title="Enterprise Scenario Intelligence & Multi-Future Center"
      subtitle="Historical Event→Template→Replay→Branching→Multi-Future→Comparison→Trade-off/Robustness/Regret→Human Review→Decision Reference→Outcome→Accuracy/Drift — 자동 실행·Failure Injection·Production 변경 없음"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 복수의 미래 경로를 Reference/Simulation 계층에서 생성·재생·비교만 합니다. 실제 Runtime/Connector/Automation/Agent/Policy/Permission/Scope/Production Entity 를 변경하지 않으며 Failure Injection·Chaos Test·자동 Decision·자동 실행이 없습니다. Scenario ≠ Reality, Replay ≠ Reoccurrence, Prediction ≠ Future Fact, Branch Probability ≠ True Probability, Best Case ≠ Expected Outcome, Worst Case ≠ Guaranteed Failure, Robust Option ≠ Correct Option, Lowest Regret ≠ Best Decision, Comparison ≠ Automatic Ranking, Confidence ≠ Correctness." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Scenario Templates" value={NUM(num('templates', 'total'))} />
            <Box label="Pending Template Review" value={NUM(num('templates', 'pending_review'))} />
            <Box label="Approved Replay References" value={NUM(num('templates', 'approved_for_replay'))} />
            <Box label="Template Versions(v2+)" value={NUM(num('templates', 'versions_recorded'))} />
            <Box label="Replay Runs" value={NUM(num('runs', 'replay_runs'))} />
            <Box label="Replays Completed" value={NUM(num('scenario_events', 'replays_completed'))} />
            <Box label="Replay Partial" value={NUM(num('scenario_events', 'replay_partial'))} />
            <Box label="Replay Unavailable" value={NUM(num('runs', 'replay_unavailable'))} />
            <Box label="Scenario Runs" value={NUM(num('runs', 'total'))} />
            <Box label="Runs Completed" value={NUM(num('runs', 'completed'))} />
            <Box label="Runs Blocked" value={NUM(num('runs', 'blocked'))} />
            <Box label="Runs Unverified" value={NUM(num('runs', 'unverified'))} />
            <Box label="Branches" value={NUM(num('branches', 'total'))} />
            <Box label="Branches Completed" value={NUM(num('branches', 'completed'))} />
            <Box label="Multi-Future Sets" value={NUM(num('scenario_events', 'multi_future_sets'))} />
            <Box label="Base/Best/Worst/NoAction" value={`${NUM(num('branches', 'base_case'))}/${NUM(num('branches', 'best_case'))}/${NUM(num('branches', 'worst_case'))}/${NUM(num('branches', 'no_action'))}`} />
            <Box label="Comparisons" value={NUM(num('scenario_events', 'comparisons'))} />
            <Box label="Robustness Reviews" value={NUM(num('scenario_events', 'robustness_reviews'))} />
            <Box label="Regret Reviews" value={NUM(num('scenario_events', 'regret_reviews'))} />
            <Box label="Common Risks / Safe" value={`${NUM(num('scenario_events', 'common_risks'))} / ${NUM(num('scenario_events', 'common_safe_conditions'))}`} />
            <Box label="Decision References" value={NUM(num('scenario_events', 'decision_references'))} />
            <Box label="Outcome Links" value={NUM(num('scenario_events', 'outcome_links'))} />
            <Box label="Accuracy Reviews" value={NUM(num('scenario_events', 'accuracy_reviews'))} />
            <Box label="Sample Too Small" value={NUM(num('runs', 'sample_too_small'))} />
          </div>
          <AdminAlert tone="info" description={`scenario_unavailable: ${Array.isArray(summary.scenario_unavailable) ? (summary.scenario_unavailable as unknown[]).map(String).join(', ') : '—'}. Replay 원천 실측 — Runtime Events(0536) ${NUM(num('replay_actuals', 'runtime_events_0536'))}건 · Incidents(0502) ${NUM(num('replay_actuals', 'incidents_0502'))}건 · Twin Runs(0540) ${NUM(num('replay_actuals', 'twin_runs_0540'))}건 · Decision Outcomes(0514) ${NUM(num('replay_actuals', 'decision_outcomes_0514'))}건. 0 과 Unknown 을 혼동하지 않습니다.`} />
        </div>
      )}

      {tab === 'templates' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {tplSelect}{reasonInput}
            {btn('검토 시작', () => tplReview('start_review', {}, '검토 시작'))}
            {btn('Evidence 요청', () => tplReview('request_evidence', {}, 'Evidence 요청'))}
            {btn('검토 완료', () => tplReview('mark_reviewed', {}, 'reviewed_reference'))}
            {btn('Replay 승인(Evidence)', () => tplReview('approve_for_replay', { evidence: [reason.trim()] }, 'Replay 참조 승인(실행 승인 아님)'), true)}
            {btn('Replay 차단', () => tplReview('block_replay', {}, 'replay_blocked'))}
            {btn('기각', () => tplReview('reject', {}, '기각'))}
            {btn('무효화', () => tplReview('invalidate', {}, '무효화'))}
          </div>
          <AdminAlert tone="info" description="approved_for_replay_reference 는 실제 실행 승인이 아닙니다. Evidence 없는 승인은 서버가 거부하며 종결 상태 재결정은 차단됩니다." />
          {!templates.length ? <AdminEmpty title="Template 없음" description="Scenario Builder 에서 생성하세요 — Template ≠ Execution." /> : (
            <div className="space-y-1">
              {templates.slice(0, 30).map((t) => (
                <div key={t.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <AdminBadge tone={tone(t.template_status)}>{t.template_status}</AdminBadge>
                    <AdminBadge tone={tone(t.support_status)}>{t.support_status}</AdminBadge>
                    <span className="font-bold">{t.template_code} v{t.template_version}</span>
                    <span className="text-muted-foreground">{t.scenario_domain} · {t.source_type}{t.source_type === 'synthetic_reference' ? ' (실제 사건 아님)' : ''}</span>
                  </div>
                  <p className="mt-1">{t.template_name}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'versions' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {tplSelect}{reasonInput}
            {btn('새 버전 생성(Change Summary=사유)', () => {
              const r = needReason(); const t = needTpl();
              if (!r || !t) return;
              void act(() => versionScenarioTemplate(t.id, r, {}), '새 버전 생성됨(원본 불변)');
            }, true)}
          </div>
          <AdminAlert tone="info" description="동일 Scenario 라도 버전에 따라 결과가 달라질 수 있습니다. 새 버전은 새 행으로 생성되며 previous_version_reference 로 연결됩니다(원본 불변)." />
          {!templates.filter((t) => t.template_version > 1 || t.previous_version_id).length ? <AdminEmpty title="버전 이력 없음" description="v2 이상 버전이 여기에 표시됩니다." /> : (
            <div className="space-y-1">
              {templates.filter((t) => t.template_version > 1 || t.previous_version_id).slice(0, 30).map((t) => (
                <div key={t.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <AdminBadge tone={tone(t.version_compatibility)}>{t.version_compatibility}</AdminBadge>
                  <span className="ml-2 font-bold">{t.template_code} v{t.template_version}</span>
                  <span className="ml-2 text-muted-foreground">{t.change_summary ?? '—'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'historicalevents' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Historical Event ≠ Future Event — 과거 이력은 재발을 의미하지 않습니다. 전부 읽기 전용 실측입니다." />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Runtime Events(0536)" value={NUM(num('replay_actuals', 'runtime_events_0536'))} />
            <Box label="Incidents(0502)" value={NUM(num('replay_actuals', 'incidents_0502'))} />
            <Box label="Incident Candidates(0537)" value={NUM(num('replay_actuals', 'incident_candidates_0537'))} />
            <Box label="Postmortems(0538)" value={NUM(num('replay_actuals', 'postmortems_0538'))} />
            <Box label="Policy Sim Runs(0539)" value={NUM(num('replay_actuals', 'policy_simulation_runs_0539'))} />
            <Box label="Twin Runs(0540)" value={NUM(num('replay_actuals', 'twin_runs_0540'))} />
            <Box label="Decision Outcomes(0514)" value={NUM(num('replay_actuals', 'decision_outcomes_0514'))} />
            <Box label="Observations(0506)" value={NUM(num('replay_actuals', 'post_change_observations_0506'))} />
            <Box label="Commitment Events(0520)" value={NUM(num('replay_actuals', 'commitment_events_0520'))} />
            <Box label="Capacity Metrics(0508)" value={NUM(num('replay_actuals', 'capacity_metrics_0508'))} />
            <Box label="Cost Models(0508)" value={NUM(num('replay_actuals', 'cost_models_0508'))} />
          </div>
        </div>
      )}

      {tab === 'replay' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {runSelect(selRun, setSelRun, 'Run 선택')}{reasonInput}
            {btn('Replay 요청 기록', () => scnEvent('replay_requested_reference', { source: 'historical' }, 'Replay 요청 기록됨'), )}
            {btn('Replay 시작 Reference', () => scnEvent('replay_started_reference', {}, 'Replay 시작 Reference', { run: true }))}
            {btn('Replay 완료(Evidence)', () => scnEvent('replay_completed_reference', { result: 'replay_completed_reference', evidence: [reason.trim()] }, 'Replay 완료 Reference(Reoccurrence 아님)', { run: true }), true)}
          </div>
          <AdminAlert tone="info" description="Historical Replay 는 과거 사건의 완벽한 재현이 아닙니다. Evidence 없는 완료는 서버가 거부하며 gap/duplicate/ordering/bias/sample/stale 후보는 result whitelist(13종)로 정직 표기됩니다." />
          {eventList([...evByType('replay_requested_reference'), ...evByType('replay_started_reference'), ...evByType('replay_completed_reference')], 'Replay 기록 없음', '저장 이력 Reference 재생 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'replayevidence' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Replay Evidence — 완료 이벤트의 Evidence 배열과 result 후보를 표시합니다." />
          {eventList(evByType('replay_completed_reference'), 'Replay Evidence 없음', 'Evidence 기반 완료 기록만 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'variables' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {tplSelect}{reasonInput}
            {btn('Variable Schema 기록', () => scnEvent('variable_schema_recorded', { types: ['count', 'duration', 'percentage'] }, 'Variable Schema 기록됨', { tpl: true }), true)}
          </div>
          <AdminAlert tone="info" description="변수 14 타입 — NaN/Infinity/음수/percentage 범위/duration·count·currency 상한 검증, Unknown 은 Unknown 으로 유지(0 변환 금지), 템플릿당 최대 100개." />
          {eventList(evByType('variable_schema_recorded'), 'Variable Schema 없음', '변수 스키마 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'builder' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <select value={domain} onChange={(e) => setDomain(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {SCENARIO_DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <select value={sourceType} onChange={(e) => setSourceType(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {TEMPLATE_SOURCE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {reasonInput}
            {btn('Template 생성(실행 아님)', () => {
              const r = needReason();
              if (!r) return;
              void act(() => createScenarioTemplate({ scenario_domain: domain, source_type: sourceType, template_name: r }), 'Template 생성됨(draft — Template ≠ Execution)');
            }, true)}
          </div>
          <AdminAlert tone="info" description="핵심 질문 예시: 같은 장애 재발 전개? 승인자 1명 vs 3명? Timeout 10/30/60초? 매장 2/5/10배 병목 시점? 비용 최소 vs 안정성 최대? 빠른 대응 vs 늦은 대응 MTTR? 정책 적용 vs 미적용? Region+Provider 동시 장애 연쇄? 공통 안전 결정? 최소 후회 선택? — 전부 Reference 계층 분석이며 실제 운영에 영향 없음. Synthetic 은 실제 사건으로 표시되지 않습니다." />
        </div>
      )}

      {tab === 'injection' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {tplSelect}{snapSelect}
            <select value={runMode} onChange={(e) => setRunMode(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {RUN_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            {reasonInput}
            {btn('Injection Review 기록', () => scnEvent('scenario_injection_reviewed', { result: 'injection_ready_reference' }, 'Injection 검토 기록(실제 장애 주입 아님)', { tpl: true }))}
            {btn('Scenario Run 생성', () => {
              const r = needReason(); const t = needTpl();
              if (!r || !t) return;
              if (!selSnap) { toast.error('Snapshot 선택 필수'); return; }
              void act(() => createScenarioRun({ scenario_template_id: t.id, enterprise_snapshot_id: selSnap, run_mode: runMode, horizon_minutes: 10080, limitations: [r] }), 'Run 생성됨(draft — Simulation ≠ Execution)');
            }, true)}
          </div>
          <AdminAlert tone="info" description="Run 은 Template 이 approved_for_replay_reference 상태여야 생성됩니다. 금지 run_mode 5종(production_execution/live_chaos_test 등)과 cross-enterprise 는 서버 차단. Injection 은 실제 장애 주입이 아닙니다." />
          {!runs.length ? <AdminEmpty title="Scenario Run 없음" description="승인된 Template + Snapshot 에서만 생성 가능합니다." /> : (
            <div className="space-y-1">
              {runs.slice(0, 30).map((r) => (
                <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <AdminBadge tone={tone(r.run_status)}>{r.run_status}</AdminBadge>
                  <span className="ml-2 font-bold">{r.run_code}</span>
                  <span className="ml-2 text-muted-foreground">{r.run_mode} · tpl v{r.scenario_template_version} · horizon {NUM(r.horizon_minutes)}분 · depth≤{r.max_branch_depth} · count≤{r.max_branch_count} · confidence {NUM(r.confidence)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {runSelect(selRun, setSelRun, 'Run 진행')}{reasonInput}
            {btn('Ready', () => runReview('mark_ready', {}, 'ready_reference'))}
            {btn('시작 Reference', () => runReview('start_reference', {}, '시작 Reference(started_at 기록)'))}
            {btn('완료(Evidence)', () => runReview('complete_reference', { evidence: [reason.trim()] }, 'completed_reference(Prediction ≠ Future Fact)'), true)}
            {btn('차단', () => runReview('block', {}, 'blocked_reference'))}
            {btn('Replay 불가', () => runReview('mark_replay_unavailable', {}, 'replay_unavailable'))}
            {btn('무효화', () => runReview('invalidate', {}, '무효화'))}
          </div>
        </div>
      )}

      {tab === 'timeline' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {runSelect(selRun, setSelRun, 'Run 선택')}{reasonInput}
            {btn('Timeline Step 기록', () => scnEvent('timeline_step_recorded', { step: evByType('timeline_step_recorded').filter((e) => e.scenario_run_id === selRun).length + 1 }, 'Timeline Step 기록(실제 Runtime Event 아님)', { run: true }), true)}
          </div>
          <AdminAlert tone="info" description="Timeline ≠ Actual Schedule. Run 당 최대 500 step(서버 차단). 측정 카운트 요약은 완료 주장이 아닙니다." />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            {timeline.stages.map((s) => (
              <div key={s.stage} className="rounded-lg border border-border p-2">
                <p className="text-[10px] font-bold text-muted-foreground">{s.stage}</p>
                <p className="mt-0.5 text-sm font-black">{s.status === 'measured' ? NUM(s.count) : 'insufficient_data'}</p>
              </div>
            ))}
          </div>
          {eventList(evByType('timeline_step_recorded'), 'Timeline Step 없음', 'Simulated Step 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'decisionpoints' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {runSelect(selRun, setSelRun, 'Run 선택')}{reasonInput}
            {btn('Decision Point 기록', () => scnEvent('decision_point_recorded', { options: ['option_a', 'option_b'], human_role_required: true }, 'Decision Point 기록(AI 는 결정하지 않음)', { run: true }), true)}
          </div>
          <AdminAlert tone="info" description="AI 는 Decision Point 를 생성할 수 있지만 결정하지 않습니다 — 선택지 2개 이상, human_role_required." />
          {eventList(evByType('decision_point_recorded'), 'Decision Point 없음', '결정 지점 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'branches' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {runSelect(selRun, setSelRun, 'Run 선택')}
            <select value={caseType} onChange={(e) => setCaseType(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {FUTURE_CASE_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={transitionType} onChange={(e) => setTransitionType(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {TRANSITION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Branch 생성', () => {
              const r = needReason(); const rn = needRun();
              if (!r || !rn) return;
              void act(() => recordScenarioBranch({ scenario_run_id: rn.id, branch_name: r, future_case_type: caseType, transition_type: transitionType, parent_branch_id: selBranch || null }), 'Branch 생성됨(Branch ≠ Actual Future)');
            }, true)}
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {branchSelect}{reasonInput}
            {btn('Ready', () => { const r = needReason(); if (!r || !selBranch) { if (!selBranch) toast.error('Branch 선택 필수'); return; } void act(() => reviewScenarioBranch(selBranch, 'mark_ready', r, {}), 'ready_reference'); })}
            {btn('완료(Evidence)', () => { const r = needReason(); if (!r || !selBranch) { if (!selBranch) toast.error('Branch 선택 필수'); return; } void act(() => reviewScenarioBranch(selBranch, 'complete_reference', r, { evidence: [r] }), 'completed_reference'); }, true)}
            {btn('Prune Reference', () => { const r = needReason(); if (!r || !selBranch) { if (!selBranch) toast.error('Branch 선택 필수'); return; } void act(() => reviewScenarioBranch(selBranch, 'prune', r, {}), 'pruned_reference'); })}
            {btn('무효화', () => { const r = needReason(); if (!r || !selBranch) { if (!selBranch) toast.error('Branch 선택 필수'); return; } void act(() => reviewScenarioBranch(selBranch, 'invalidate', r, {}), '무효화'); })}
          </div>
          <AdminAlert tone="info" description="Depth 최대 6·Run 당 최대 100개(Branch Explosion 서버 차단). 근거(basis) 없는 확률은 저장 자체가 거부됩니다. 미실행 Branch 를 Completed 로 표시하지 않습니다." />
          {!branches.length ? <AdminEmpty title="Branch 없음" description="Run 선택 후 생성하세요." /> : (
            <div className="space-y-1">
              {branches.slice(0, 30).map((b) => (
                <div key={b.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <AdminBadge tone={tone(b.branch_status)}>{b.branch_status}</AdminBadge>
                  <span className="ml-2 font-bold">{b.branch_code}</span>
                  <span className="ml-2 text-muted-foreground">{b.branch_name} · depth {b.branch_depth} · {b.future_case_type ?? '—'} · {b.transition_type ?? '—'} · 확률 {b.probability_candidate == null ? 'unverified' : `${b.probability_candidate}%(Candidate)`}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'multifuture' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {runSelect(selRun, setSelRun, 'Run 선택')}{reasonInput}
            {btn('Multi-Future 생성 Reference', () => scnEvent('multi_future_generated_reference', { cases: ['base_case_candidate', 'best_case_candidate', 'worst_case_candidate', 'no_action_candidate'] }, 'Multi-Future Reference 기록(Future ≠ Fact)', { run: true }), true)}
          </div>
          <AdminAlert tone="info" description="14 case 유형. Horizon 이 길수록 Confidence 상한이 낮아집니다(24h:90/7d:75/30d:60/90d:40/초과:25) — 근거 없는 숫자를 확률처럼 표시하지 않습니다." />
          {eventList(evByType('multi_future_generated_reference'), 'Multi-Future 없음', '복수 미래 세트 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'basecase' && caseTab('base_case_candidate', 'Base Case', 'Base Case ≠ Most Likely Fact — 기준 후보일 뿐입니다.')}
      {tab === 'bestcase' && caseTab('best_case_candidate', 'Best Case', 'Best Case ≠ Expected Outcome — 낙관 후보일 뿐입니다.')}
      {tab === 'worstcase' && caseTab('worst_case_candidate', 'Worst Case', 'Worst Case ≠ Guaranteed Failure — 비관 후보일 뿐입니다.')}
      {tab === 'noaction' && caseTab('no_action_candidate', 'No Action Case', '무대응 미래 후보 — 실제 무대응 결정이 아닙니다.')}

      {tab === 'risk' && reviewEventTab('common_risk_reviewed', 'Risk Projection 검토', 'No Detected Risk ≠ No Risk. cascading failure/single point of failure 후보 포함 — 전부 Candidate 입니다.', { scope: 'risk_projection' })}
      {tab === 'opportunity' && reviewEventTab('tradeoff_reviewed', 'Opportunity 검토', 'Opportunity 는 후보입니다 — Evidence 없는 기회 주장은 unverified 로 유지됩니다.', { scope: 'opportunity_projection' })}
      {tab === 'cost' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Cost Projection — 0540 projectCost 재사용(비용 모델 없으면 cost_model_missing·실제 청구 없음). Run 완료 payload 의 risk/opportunity 결과 JSONB 로 저장됩니다." />
          {!runs.filter((r) => r.risk_result || r.opportunity_result).length ? <AdminEmpty title="Projection 결과 없음" description="Run 완료 시 결과 JSONB 가 여기에 표시됩니다." /> : (
            <div className="space-y-1">
              {runs.filter((r) => r.risk_result || r.opportunity_result).slice(0, 20).map((r) => (
                <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <span className="font-bold">{r.run_code}</span>
                  <span className="ml-2 break-all font-mono text-[10px] text-muted-foreground">{JSON.stringify({ risk: r.risk_result, opportunity: r.opportunity_result }).slice(0, 300)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {tab === 'capacity' && reviewEventTab('common_safe_condition_reviewed', 'Capacity 검토', 'Capacity Estimate ≠ Guarantee — 0540 projectCapacity 재사용(부하 테스트 없음).', { scope: 'capacity_projection' })}
      {tab === 'approvalqueue' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Approval Queue Projection — 범용 Queue 없음(승인 대기 counts proxy·0540 재사용). Reviewer 0명 시 queue_unbounded 후보." />
          {eventList(audit.filter((e) => e.event_type === 'timeline_step_recorded' && String(e.payload?.scope ?? '') === 'approval_queue'), 'Queue Projection 기록 없음', 'Timeline Step 의 approval_queue scope 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'incident' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Incident Projection — 표본 부족 시 sample_too_small 유지(0540 재사용). Correlation ≠ Causality." />
          {eventList(audit.filter((e) => e.event_type === 'timeline_step_recorded' && String(e.payload?.scope ?? '') === 'incident'), 'Incident Projection 기록 없음', 'Timeline Step 의 incident scope 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'humanworkload' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Human Workload Projection — 자동 인사 판단/책임자 지정 없음(0540 재사용)." />
          {eventList(audit.filter((e) => e.event_type === 'timeline_step_recorded' && String(e.payload?.scope ?? '') === 'human_workload'), 'Workload Projection 기록 없음', 'Timeline Step 의 human_workload scope 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'comparison' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {runSelect(selRun, setSelRun, 'Run A')}
            {runSelect(selRun2, setSelRun2, 'Run B')}
            {reasonInput}
            {btn('Comparison 생성', () => {
              if (!selRun || !selRun2 || selRun === selRun2) { toast.error('서로 다른 Run 2개 필수'); return; }
              scnEvent('scenario_comparison_created', { run_ids: [selRun, selRun2] }, 'Comparison 기록(자동 승자 없음)', { run: true });
            }, true)}
          </div>
          <AdminAlert tone="info" description="비교 16차원 — scope/horizon/version 불일치는 incomparable, 결측 차원은 dimension_unverified 유지(Null→0 없음). Comparison ≠ Automatic Ranking, Scenario Winner ≠ Selected Decision." />
          {eventList(evByType('scenario_comparison_created'), 'Comparison 없음', 'Run 2~20개 비교 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'tradeoff' && reviewEventTab('tradeoff_reviewed', 'Trade-off Review', '10 유형(risk_vs_cost/speed_vs_safety 등) — Trade-off Score ≠ Business Value.')}
      {tab === 'robustness' && reviewEventTab('robustness_reviewed', 'Robustness Review', '여러 Scenario 에서 공통으로 견고한 선택 후보 — Robust Option ≠ Correct Option.')}
      {tab === 'regret' && reviewEventTab('regret_reviewed', 'Regret Review', '대안 미평가 시 regret_unverified. 비가역+큰 손실은 asymmetric 후보 — Lowest Regret ≠ Best Decision.')}
      {tab === 'commonrisks' && reviewEventTab('common_risk_reviewed', 'Common Risk Review', 'Scenario 간 교집합 위험 후보 — 미검출 ≠ 무위험.')}
      {tab === 'commonsafe' && reviewEventTab('common_safe_condition_reviewed', 'Common Safe Condition Review', '최선·최악·기준 시나리오에서 공통으로 안전한 조건 후보 — 후보일 뿐 보장이 아닙니다.')}

      {tab === 'execoptions' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Executive Option Candidate — Robust/Lowest Regret/Common Safe 후보를 사람 검토용으로 제시만 합니다. 자동 Executive Decision 없음." />
          {eventList([...evByType('robustness_reviewed'), ...evByType('regret_reviewed'), ...evByType('scenario_recommendation_recorded')].sort((a, b) => b.created_at.localeCompare(a.created_at)), 'Option Candidate 없음', 'Robustness/Regret/Recommendation 검토가 여기에 모입니다.')}
        </div>
      )}

      {tab === 'humanreviews' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {runSelect(selRun, setSelRun, 'Run 선택')}{reasonInput}
            {btn('Human Review 기록', () => scnEvent('human_scenario_review_recorded', { note: 'human_decision_only' }, 'Human Review 기록됨', { run: true }), true)}
          </div>
          <AdminAlert tone="info" description="AI 의 Recommendation 은 Human Decision 을 대체하지 않습니다." />
          {eventList(evByType('human_scenario_review_recorded'), 'Human Review 없음', '사람 검토 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'decisionrefs' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {runSelect(selRun, setSelRun, 'Run 선택')}{reasonInput}
            {btn('Decision Reference 기록(Evidence)', () => scnEvent('decision_reference_recorded', { evidence: [reason.trim()] }, 'Decision Reference 기록(Decision 아님)', { run: true }), true)}
          </div>
          <AdminAlert tone="info" description="Decision Reference ≠ Decision — 사람이 내린 결정의 참조 기록만 남깁니다." />
          {eventList(evByType('decision_reference_recorded'), 'Decision Reference 없음', 'Evidence 기반 결정 참조가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'outcomes' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {runSelect(selRun, setSelRun, 'Run 선택')}{reasonInput}
            {btn('Observed Outcome 연결', () => scnEvent('observed_outcome_linked', { causality_status: 'causality_unverified' }, 'Outcome Reference 연결(인과 증명 아님)', { run: true }), true)}
          </div>
          <AdminAlert tone="info" description="Outcome Reference 는 인과관계 증명이 아닙니다 — 외부 요인 미검토 시 causality_unverified 유지." />
          {eventList(evByType('observed_outcome_linked'), 'Outcome Link 없음', '실제 관측 결과 연결이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'accuracy' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {runSelect(selRun, setSelRun, 'Run 선택')}
            <select value={accResult} onChange={(e) => setAccResult(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {ACCURACY_RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {reasonInput}
            {btn('Accuracy Review 기록', () => scnEvent('accuracy_candidate_reviewed', { result: accResult }, 'Accuracy Candidate 검토(Verified Accuracy 아님)', { run: true }), true)}
          </div>
          <AdminAlert tone="info" description="Accuracy 는 Observed Outcome 연결 후에만 판정 가능합니다 — Accuracy Candidate ≠ Verified Accuracy." />
          {eventList(evByType('accuracy_candidate_reviewed'), 'Accuracy Review 없음', '예측 대비 관측 검토가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'drift' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {runSelect(selRun, setSelRun, 'Run 선택')}
            <select value={driftResult} onChange={(e) => setDriftResult(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {DRIFT_RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {reasonInput}
            {btn('Drift Review 기록', () => scnEvent('drift_candidate_reviewed', { result: driftResult }, 'Drift Candidate 검토(모델 실패 확정 아님)', { run: true }), true)}
          </div>
          <AdminAlert tone="info" description="Drift Candidate ≠ Confirmed Model Failure — 장기 관측 데이터가 필요합니다." />
          {eventList(evByType('drift_candidate_reviewed'), 'Drift Review 없음', 'Input/Data/Policy/Cost 등 드리프트 검토가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'recommendations' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {runSelect(selRun, setSelRun, 'Run 선택')}
            <select value={recType} onChange={(e) => setRecType(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {SCENARIO_RECOMMENDATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Recommendation 기록(Evidence)', () => scnEvent('scenario_recommendation_recorded', { recommendation: recType, evidence: [reason.trim()] }, 'Recommendation 기록(Decision 아님)', { run: true }), true)}
          </div>
          <AdminAlert tone="info" description="23 유형 — Evidence 필수, Recommendation ≠ Approval, 자동 실행 없음." />
          {eventList(evByType('scenario_recommendation_recorded'), 'Recommendation 없음', 'Evidence 기반 제안이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'audit' && (
        eventList(audit, 'Audit 없음', '29종 Scenario 이벤트 전체 감사 로그입니다.')
      )}

      {tab === 'support' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="실측 구성요소(추측 없음) — available:false 는 이 코드베이스에 해당 구조가 없음을 의미합니다." />
          <div className="space-y-1">
            {SCENARIO_COMPONENTS.map((c) => (
              <div key={c.key} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone={c.available === true ? 'success' : c.available === false ? 'danger' : 'warning'}>{c.available === true ? 'available' : c.available === false ? 'unavailable' : 'unverified'}</AdminBadge>
                <span className="ml-2 font-bold">{c.key}</span>
                <span className="ml-2 text-muted-foreground">{c.note}</span>
              </div>
            ))}
          </div>
          <div className="space-y-1">
            {SCENARIO_SUPPORT_MATRIX.map((s) => (
              <div key={s.key} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone={tone(s.status)}>{s.status}</AdminBadge>
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
