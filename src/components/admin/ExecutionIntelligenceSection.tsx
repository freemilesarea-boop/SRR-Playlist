/**
 * ExecutionIntelligenceSection — Enterprise Execution Intelligence, Program
 * Management & Initiative Delivery Center (Phase AI-OPS-43).
 *
 * Strategic Portfolio→Execution Program→Execution Plan(Wave)→Initiative Delivery→
 * Milestone Tracking→Dependency→Critical Path→Health→Risk→Planned/Actual/Forecast
 * Progress→Drift→Velocity/Stability→Delay Root Cause→Bottleneck→Delivery Forecast→
 * Quality→Recommendation→Human Delivery Review→Approval Reference→Outcome→Learning→Audit.
 * Plan ≠ Execution · Progress Candidate ≠ Actual · Milestone Candidate ≠ Completed ·
 * Forecast ≠ Future Fact · Approval Reference ≠ Execution Approval.
 * 실제 프로젝트 시작·완료·Milestone 완료·배포·일정/예산 변경은 반드시 사람.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, BookOpen, ClipboardList, Gauge, GitBranch, Grid3x3,
  History, Inbox, Layers, Lightbulb, ListOrdered, Lock, RefreshCw, Scale, Search,
  Shield, TrendingUp, Users,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchExecutionIntelSummary, fetchEnterpriseExecutionPrograms, createEnterpriseExecutionProgram,
  reviewEnterpriseExecutionProgram, fetchEnterpriseExecutionPlans, createEnterpriseExecutionPlan,
  reviewEnterpriseExecutionPlan, recordEnterpriseDeliveryReview, recordEnterpriseExecutionEvent,
  fetchEnterpriseExecutionAudit,
  type ExecutionIntelSummary, type EnterpriseExecutionProgramRow, type EnterpriseExecutionPlanRow,
  type EnterpriseExecutionEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  EXECUTION_PROGRAM_TYPES, MILESTONE_STATUSES, EXECUTION_TIMELINE_RESULTS,
  MILESTONE_PROGRESS_RESULTS, EXECUTION_DEPENDENCY_RESULTS, CRITICAL_PATH_RESULTS,
  DELIVERY_HEALTH_LEVELS, DELIVERY_RISK_LEVELS, EXECUTION_RISK_DIMENSIONS,
  PROGRESS_DRIFT_LEVELS, SCHEDULE_DRIFT_RESULTS, VELOCITY_RESULTS, STABILITY_RESULTS,
  DELAY_RESULTS, DELAY_ROOT_CAUSE_CATEGORIES, BOTTLENECK_RESULTS, DELIVERY_FORECAST_RESULTS,
  DELIVERY_QUALITY_LEVELS, DELIVERY_RECOMMENDATION_TYPES, buildExecutionTimeline,
  EXECUTION_COMPONENTS, EXECUTION_SUPPORT_MATRIX,
} from '@/lib/executionIntelligence';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'inbox' | 'programs' | 'pendingprog' | 'plans' | 'pendingplan'
  | 'initiativestatus' | 'timeline' | 'milestones' | 'milestoneprog' | 'dependencies' | 'criticalpath'
  | 'health' | 'risk' | 'progress' | 'drift' | 'scheduledrift' | 'velocity' | 'stability'
  | 'delays' | 'rootcause' | 'bottleneck' | 'forecast' | 'quality' | 'regressions'
  | 'recommendations' | 'reviewqueue' | 'approved' | 'rejected' | 'links' | 'outcomes'
  | 'learning' | 'flow' | 'audit' | 'support' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Execution Intelligence', icon: Layers },
  { key: 'inbox', label: 'Execution Inbox', icon: Inbox },
  { key: 'programs', label: 'Program Overview', icon: BookOpen },
  { key: 'pendingprog', label: 'Pending Program Review', icon: Scale },
  { key: 'plans', label: 'Execution Plans', icon: ClipboardList },
  { key: 'pendingplan', label: 'Pending Plan Review', icon: Scale },
  { key: 'initiativestatus', label: 'Initiative Status', icon: ListOrdered },
  { key: 'timeline', label: 'Execution Timeline', icon: History },
  { key: 'milestones', label: 'Milestones', icon: ListOrdered },
  { key: 'milestoneprog', label: 'Milestone Progress', icon: TrendingUp },
  { key: 'dependencies', label: 'Dependencies', icon: GitBranch },
  { key: 'criticalpath', label: 'Critical Path', icon: GitBranch },
  { key: 'health', label: 'Delivery Health', icon: Gauge },
  { key: 'risk', label: 'Delivery Risk', icon: AlertTriangle },
  { key: 'progress', label: 'Planned/Actual Progress', icon: TrendingUp },
  { key: 'drift', label: 'Progress Drift', icon: Activity },
  { key: 'scheduledrift', label: 'Schedule Drift', icon: Activity },
  { key: 'velocity', label: 'Velocity', icon: Gauge },
  { key: 'stability', label: 'Stability', icon: Shield },
  { key: 'delays', label: 'Delay Candidates', icon: AlertTriangle },
  { key: 'rootcause', label: 'Delay Root Cause', icon: Search },
  { key: 'bottleneck', label: 'Bottlenecks', icon: AlertTriangle },
  { key: 'forecast', label: 'Delivery Forecast', icon: TrendingUp },
  { key: 'quality', label: 'Execution Quality', icon: Gauge },
  { key: 'regressions', label: 'Regressions/Rollbacks', icon: RefreshCw },
  { key: 'recommendations', label: 'Recommendation Candidates', icon: Lightbulb },
  { key: 'reviewqueue', label: 'Review Queue', icon: Users },
  { key: 'approved', label: 'Approved Delivery References', icon: Scale },
  { key: 'rejected', label: 'Rejected/Deferred References', icon: Scale },
  { key: 'links', label: 'Reference Links', icon: GitBranch },
  { key: 'outcomes', label: 'Delivery Outcomes', icon: Search },
  { key: 'learning', label: 'Execution Learning', icon: Lightbulb },
  { key: 'flow', label: 'Flow Timeline', icon: History },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
  { key: 'limitations', label: 'Known Limitations', icon: ClipboardList },
];

const KNOWN_LIMITATIONS = [
  '자동 프로젝트 시작/종료·자동 Milestone 완료·자동 승인/Rollout/Rollback/Merge/Deploy/Budget/Resource Allocation/일정 변경 없음 — Approval Reference 의 auto_started/auto_completed/milestone_auto_completed/schedule_changed/budget_changed/production_applied 는 항상 false',
  'Execution Plan ≠ Execution · Program Status ≠ Project Completion — executing/completed 는 외부 Reference+Evidence 없으면 서버 차단',
  'Progress Candidate ≠ Actual Completion — actual progress 는 Evidence 없이 기록 불가(미검증 Progress 를 Actual 로 표시 금지)',
  'Milestone Candidate ≠ Completed Milestone — completed_reference 는 Evidence+외부 Completion Reference 필수(자동 Milestone 완료 없음)',
  'Forecast ≠ Future Fact · Delay Candidate ≠ Confirmed Delay · Root Cause Candidate ≠ Proven Cause',
  'Velocity ≠ Productivity · Health ≠ Guaranteed Success · Stable ≠ Risk Free · Quality ≠ Verified Quality',
  'PM 시스템/Issue Tracker/CI·CD Pipeline/배포 이력/Sprint Velocity/Time Tracking 피드 부재 — 해당 지표는 insufficient_data 유지',
  'ai_execution_events 테이블 부재(실측) — 실제 실행 이벤트 원장은 ai_execution_gateway_events(0535)/ai_commitment_events(0520) 참조',
  '스펙에 실행 시작 문구/최종 보고 목록 없음 — 시리즈 패턴 기반 구성(원문과 다를 수 있음)',
  'Migration 0472~0547 production 미적용 — 운영 수치는 적용 후 축적됩니다',
  '브라우저 실측 미검증 — UI 는 코드 리뷰/타입/빌드 기준 검증만 수행했습니다',
];

export default function ExecutionIntelligenceSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<ExecutionIntelSummary>({});
  const [programs, setPrograms] = useState<EnterpriseExecutionProgramRow[]>([]);
  const [plans, setPlans] = useState<EnterpriseExecutionPlanRow[]>([]);
  const [audit, setAudit] = useState<EnterpriseExecutionEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [selProg, setSelProg] = useState('');
  const [selPlan, setSelPlan] = useState('');
  const [progType, setProgType] = useState<string>('initiative_delivery_program');
  const [msStatusSel, setMsStatusSel] = useState<string>('proposed_candidate');
  const [riskDimSel, setRiskDimSel] = useState<string>('schedule_risk');
  const [causeSel, setCauseSel] = useState<string>('dependency_cause_candidate');
  const [recTypeSel, setRecTypeSel] = useState<string>('gather_more_evidence_candidate');
  const [resultSel, setResultSel] = useState<string>('insufficient_data');
  const [progressVal, setProgressVal] = useState('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, p, l, a] = await Promise.all([
        fetchExecutionIntelSummary(), fetchEnterpriseExecutionPrograms(null, 200),
        fetchEnterpriseExecutionPlans(null, 200), fetchEnterpriseExecutionAudit(200),
      ]);
      setSummary(s); setPrograms(p); setPlans(l); setAudit(a);
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
  const progReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selProg) { if (!selProg) toast.error('Program 선택 필수'); return; }
    void act(() => reviewEnterpriseExecutionProgram(selProg, action, r, payload), ok);
  };
  const planReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selPlan) { if (!selPlan) toast.error('Plan 선택 필수'); return; }
    void act(() => reviewEnterpriseExecutionPlan(selPlan, action, r, payload), ok);
  };
  const deliveryReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    const target = selPlan ? ('plan' as const) : ('program' as const);
    const id = selPlan || selProg;
    if (!r || !id) { if (!id) toast.error('Program 또는 Plan 선택 필수'); return; }
    void act(() => recordEnterpriseDeliveryReview(target, id, action, r, payload), ok);
  };
  const execEvent = (kind: string, payload: Record<string, unknown>, ok: string, ids: { prog?: boolean; plan?: boolean } = { prog: true }) => {
    const r = needReason();
    if (!r) return;
    void act(() => recordEnterpriseExecutionEvent(kind, r, payload, ids.prog ? (selProg || null) : null, ids.plan ? (selPlan || null) : null), ok);
  };

  const obj = useCallback((k: string): Record<string, unknown> => (typeof summary[k] === 'object' && summary[k] !== null && !Array.isArray(summary[k]) ? summary[k] as Record<string, unknown> : {}), [summary]);
  const num = useCallback((k: string, sub: string): number | null => {
    const v = obj(k)[sub];
    return typeof v === 'number' ? v : null;
  }, [obj]);

  const flowTimeline = useMemo(() => buildExecutionTimeline({ present: {
    strategic_portfolio: (num('execution_actuals', 'strategy_portfolios_0545') ?? 0) > 0,
    execution_program: (num('programs', 'total') ?? 0) > 0,
    execution_plan: (num('plans', 'total') ?? 0) > 0,
    milestone_candidate: (num('execution_events', 'milestone_candidates') ?? 0) > 0,
    dependency_review: (num('execution_events', 'dependency_reviews') ?? 0) > 0,
    health_review: (num('execution_events', 'health_reviews') ?? 0) > 0,
    risk_review: (num('execution_events', 'risk_reviews') ?? 0) > 0,
    progress_record: (num('execution_events', 'planned_progress_records') ?? 0) + (num('execution_events', 'actual_progress_records') ?? 0) > 0,
    drift_review: (num('execution_events', 'drift_reviews') ?? 0) > 0,
    delivery_forecast: (num('execution_events', 'forecast_reviews') ?? 0) > 0,
    quality_review: (num('execution_events', 'quality_reviews') ?? 0) > 0,
    human_delivery_review: (num('execution_events', 'delivery_reviews') ?? 0) > 0,
    approval_reference: (num('execution_events', 'delivery_approvals') ?? 0) > 0,
    outcome_link: (num('execution_events', 'outcome_links') ?? 0) > 0,
  } }), [num]);

  if (loading) return <AdminCard title="Execution Intelligence & Initiative Delivery Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Execution Intelligence & Initiative Delivery Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const progSelect = (
    <select value={selProg} onChange={(e) => setSelProg(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Program 선택</option>
      {programs.map((p) => <option key={p.id} value={p.id}>{p.program_code} · {p.program_status}</option>)}
    </select>
  );
  const planSelect = (
    <select value={selPlan} onChange={(e) => setSelPlan(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Plan 선택(없으면 Program 대상)</option>
      {plans.map((p) => <option key={p.id} value={p.id}>{p.plan_code} · {p.plan_status}</option>)}
    </select>
  );
  const reasonInput = <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button disabled={busy} onClick={onClick} className={primary ? 'rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50' : 'rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50'}>{label}</button>
  );
  const tone = (s: string) => (s.includes('excellent') || s.includes('healthy') || s === 'low' || s.includes('on_track') || s.includes('no_material') || s.includes('no_delay') || s.includes('stable') || s.includes('ready') || s.includes('on_schedule') || s.includes('completed_reference') || s === 'acceptable' ? 'success' as const : s.includes('critical') || s.includes('severe') || s.includes('blocked') || s.includes('cancelled') || s.includes('invalidated') || s === 'poor' || s.includes('circular') || s === 'unsupported' || s === 'unavailable' ? 'danger' as const : 'warning' as const);
  const evByType = (t: string) => audit.filter((e) => e.event_type === t);
  const eventList = (rows: EnterpriseExecutionEventRow[], emptyTitle: string, emptyDesc: string) => (
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
  const progList = (list: EnterpriseExecutionProgramRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((p) => (
          <div key={p.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(p.program_status)}>{p.program_status}</AdminBadge>
            <AdminBadge tone={tone(p.delivery_health)}>{p.delivery_health}</AdminBadge>
            <AdminBadge tone={tone(p.delivery_risk)}>risk {p.delivery_risk}</AdminBadge>
            <span className="ml-2 font-bold">{p.program_code}</span>
            <span className="ml-2 text-muted-foreground">{p.program_type} · {p.program_name} · planned {NUM(p.planned_progress_candidate)}% · actual {NUM(p.actual_progress_reference)}% · forecast {NUM(p.forecast_progress_candidate)}%</span>
          </div>
        ))}
      </div>
    )
  );
  const planList = (list: EnterpriseExecutionPlanRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((p) => (
          <div key={p.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(p.plan_status)}>{p.plan_status}</AdminBadge>
            <AdminBadge tone={tone(p.progress_drift_status)}>{p.progress_drift_status}</AdminBadge>
            <span className="ml-2 font-bold">{p.plan_code}</span>
            <span className="ml-2 text-muted-foreground">{p.plan_name} · planned {NUM(p.planned_progress_candidate)}% · actual {NUM(p.actual_progress_reference)}%</span>
          </div>
        ))}
      </div>
    )
  );
  const resultEventTab = (kind: string, title: string, note: string, results: readonly string[], extraPayload: Record<string, unknown> = {}, ids: { prog?: boolean; plan?: boolean } = { prog: true, plan: true }) => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        {ids.prog ? progSelect : null}{ids.plan ? planSelect : null}
        <select value={results.includes(resultSel) ? resultSel : results[0]} onChange={(e) => setResultSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
          {results.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {reasonInput}
        {btn(`${title} 기록`, () => execEvent(kind, { result: results.includes(resultSel) ? resultSel : results[0], ...extraPayload }, `${title} 기록됨`, ids), true)}
      </div>
      <AdminAlert tone="info" description={note} />
      {eventList(evByType(kind), `${title} 없음`, '사람 검토 기록이 여기에 표시됩니다.')}
    </div>
  );

  return (
    <AdminCard
      title="Execution Intelligence & Initiative Delivery Center"
      subtitle="Strategic Portfolio→Execution Program→Execution Plan(Wave)→Milestone→Dependency→Critical Path→Health/Risk→Planned/Actual/Forecast Progress→Drift→Velocity/Stability→Delay Root Cause→Bottleneck→Delivery Forecast→Quality→Human Delivery Review→Approval Reference→Outcome→Learning — 실행은 반드시 사람"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 Enterprise 전체의 실행 상태를 객관적으로 관측·설명하는 Execution Intelligence 계층입니다. AI 는 Program/Plan 구조화·Milestone Candidate·Dependency/Critical Path·Health/Risk/Quality·Planned/Actual/Forecast Progress·Drift·Velocity/Stability·Delay Root Cause Candidate·Bottleneck·Delivery Forecast·Recommendation·Human Delivery Review 요청까지만 수행하며, 실제 프로젝트 시작/종료·Milestone 완료 처리·승인·Rollout/Rollback/Merge/Deploy·Budget/Resource Allocation·일정 변경·계약/Payment/Settlement·Provider 변경·Email/Slack/Ticket/Incident 생성·Production 변경은 수행하지 않습니다. Execution Plan ≠ Execution, Progress Candidate ≠ Actual Completion, Milestone Candidate ≠ Completed Milestone, Forecast ≠ Future Fact, Approval Reference ≠ Execution Approval. 실행하지 않은 작업을 Completed 로, 미검증 Progress 를 Actual 로 표시하지 않습니다. AI 는 실행을 추천하고, 사람이 실행합니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Execution Programs" value={NUM(num('programs', 'total'))} />
            <Box label="Planned / Ready / Executing" value={`${NUM(num('programs', 'planned'))} / ${NUM(num('programs', 'ready'))} / ${NUM(num('programs', 'executing'))}`} />
            <Box label="Delayed / Blocked" value={`${NUM(num('programs', 'delayed'))} / ${NUM(num('programs', 'blocked'))}`} />
            <Box label="Completed / Cancelled References" value={`${NUM(num('programs', 'completed'))} / ${NUM(num('programs', 'cancelled'))}`} />
            <Box label="Health Watch 이하" value={NUM(num('programs', 'health_watch_or_worse'))} />
            <Box label="Risk High/Critical" value={NUM(num('programs', 'risk_high_or_critical'))} />
            <Box label="Drift Major/Severe" value={NUM(num('programs', 'drift_major_or_severe'))} />
            <Box label="Execution Plans" value={NUM(num('plans', 'total'))} />
            <Box label="Plan Executing / Delayed / Blocked" value={`${NUM(num('plans', 'executing'))} / ${NUM(num('plans', 'delayed'))} / ${NUM(num('plans', 'blocked'))}`} />
            <Box label="Milestone Candidates" value={NUM(num('execution_events', 'milestone_candidates'))} />
            <Box label="Dependency / Critical Path Reviews" value={`${NUM(num('execution_events', 'dependency_reviews'))} / ${NUM(num('execution_events', 'critical_path_reviews'))}`} />
            <Box label="Health / Risk Reviews" value={`${NUM(num('execution_events', 'health_reviews'))} / ${NUM(num('execution_events', 'risk_reviews'))}`} />
            <Box label="Planned / Actual Progress Records" value={`${NUM(num('execution_events', 'planned_progress_records'))} / ${NUM(num('execution_events', 'actual_progress_records'))}`} />
            <Box label="Drift / Schedule Drift Reviews" value={`${NUM(num('execution_events', 'drift_reviews'))} / ${NUM(num('execution_events', 'schedule_drift_reviews'))}`} />
            <Box label="Velocity / Stability Reviews" value={`${NUM(num('execution_events', 'velocity_reviews'))} / ${NUM(num('execution_events', 'stability_reviews'))}`} />
            <Box label="Delay / Root Cause Candidates" value={`${NUM(num('execution_events', 'delay_candidates'))} / ${NUM(num('execution_events', 'root_cause_candidates'))}`} />
            <Box label="Bottleneck / Forecast Reviews" value={`${NUM(num('execution_events', 'bottleneck_reviews'))} / ${NUM(num('execution_events', 'forecast_reviews'))}`} />
            <Box label="Quality Reviews" value={NUM(num('execution_events', 'quality_reviews'))} />
            <Box label="Recommendation Candidates" value={NUM(num('execution_events', 'recommendations'))} />
            <Box label="Delivery Reviews / Approvals" value={`${NUM(num('execution_events', 'delivery_reviews'))} / ${NUM(num('execution_events', 'delivery_approvals'))}`} />
            <Box label="Executive / Resource Review Requests" value={`${NUM(num('execution_events', 'executive_review_requests'))} / ${NUM(num('execution_events', 'resource_review_requests'))}`} />
            <Box label="Outcome Links / Learning" value={`${NUM(num('execution_events', 'outcome_links'))} / ${NUM(num('execution_events', 'learning_references'))}`} />
          </div>
          <AdminAlert tone="info" description={`execution_unavailable: ${Array.isArray(summary.execution_unavailable) ? (summary.execution_unavailable as unknown[]).map(String).join(', ') : '—'}. Execution 원천 실측 — Initiatives(0545) ${NUM(num('execution_actuals', 'strategic_initiatives_0545'))}건 · Portfolios(0545) ${NUM(num('execution_actuals', 'strategy_portfolios_0545'))}건 · Allocation Options(0546) ${NUM(num('execution_actuals', 'allocation_options_0546'))}건 · Commitments(0520) ${NUM(num('execution_actuals', 'commitments_0520'))}건 · Commitment Milestones(0520) ${NUM(num('execution_actuals', 'commitment_milestones_0520'))}건 · Execution Requests(0535) ${NUM(num('execution_actuals', 'execution_requests_0535'))}건 · Agents(0497) ${NUM(num('execution_actuals', 'agents_0497'))}건. 0 과 Unknown 을 혼동하지 않습니다.`} />
        </div>
      )}

      {tab === 'inbox' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="실행 대기함 — 검토 대기 Program/Plan. 실행 우선순위와 실제 실행은 사람이 결정합니다." />
          {progList(programs.filter((p) => ['draft', 'pending_review'].includes(p.program_status)), '대기 Program 없음', '0건은 실행이 순조로움을 의미하지 않습니다.')}
          {planList(plans.filter((p) => ['draft', 'pending_review'].includes(p.plan_status)), '대기 Plan 없음', '검토 대기 Execution Plan 이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'programs' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <select value={progType} onChange={(e) => setProgType(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {EXECUTION_PROGRAM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Program 생성(≠ 실행)', () => {
              const r = needReason();
              if (!r) return;
              void act(() => createEnterpriseExecutionProgram({ program_type: progType, program_name: r }), 'Program 생성됨(draft — 자동 시작 없음)');
            }, true)}
          </div>
          <AdminAlert tone="info" description="금지 Program Type(automatic_* 14종) 서버 차단 · Program ≠ Execution · Status 11종." />
          {progList(programs, 'Execution Program 없음', '핵심 질문 예: 어떤 Initiative 가 실제로 실행 중인가? 어디가 지연 위험인가? — 전부 Candidate/Reference 분석.')}
        </div>
      )}
      {tab === 'pendingprog' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {progSelect}{reasonInput}
            {btn('검토 시작', () => progReview('start_review', {}, 'pending_review'))}
            {btn('Planned', () => progReview('mark_planned', {}, 'planned(≠ Executing)'))}
            {btn('Ready Candidate', () => progReview('mark_ready', {}, 'ready_candidate'))}
            {btn('Executing Reference(외부 Ref 필수)', () => progReview('mark_executing_reference', { external_execution_reference: reason.trim() }, 'executing_reference'))}
            {btn('Delayed Candidate', () => progReview('mark_delayed', {}, 'delayed_candidate'))}
            {btn('Blocked Candidate', () => progReview('mark_blocked', {}, 'blocked_candidate'))}
            {btn('Partially Completed(Evidence)', () => progReview('mark_partially_completed', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'partially_completed_candidate'))}
            {btn('Completed Reference(Evidence+외부 Ref)', () => progReview('mark_completed_reference', { evidence: [{ type: 'manual_review', note: reason.trim() }], external_completion_reference: reason.trim() }, 'completed_reference'))}
            {btn('Cancel Reference', () => progReview('cancel_reference', {}, 'cancelled_reference'))}
            {btn('Insufficient Data', () => progReview('mark_insufficient_data', {}, 'insufficient_data'))}
          </div>
          <AdminAlert tone="warning" description="executing/completed 는 외부 Reference·Evidence 없으면 서버 차단 — 실행하지 않은 작업 Completed 표시 금지. 종결(completed/cancelled) 재결정 차단." />
          {progList(programs.filter((p) => ['draft', 'pending_review', 'planned', 'ready_candidate'].includes(p.program_status)), '검토 대기 Program 없음', '사람 검토 대기 Program 이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'plans' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {progSelect}{reasonInput}
            {btn('Plan 생성(Program 필수)', () => {
              const r = needReason();
              if (!r || !selProg) { if (!selProg) toast.error('Program 선택 필수'); return; }
              void act(() => createEnterpriseExecutionPlan({ execution_program_id: selProg, plan_name: r }), 'Plan 생성됨(draft — 자동 실행 없음)');
            }, true)}
          </div>
          <AdminAlert tone="info" description="Plan ≠ Execution · Wave/Milestone/Deliverable 은 JSONB 통합 · Program/Initiative 실존 검증." />
          {planList(plans, 'Execution Plan 없음', 'Program 하위 실행 계획이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'pendingplan' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {planSelect}{reasonInput}
            {btn('검토 시작', () => planReview('start_review', {}, 'pending_review'))}
            {btn('Planned', () => planReview('mark_planned', {}, 'planned'))}
            {btn('Ready', () => planReview('mark_ready', {}, 'ready_candidate'))}
            {btn('Executing Reference(외부 Ref)', () => planReview('mark_executing_reference', { external_execution_reference: reason.trim() }, 'executing_reference'))}
            {btn('Delayed', () => planReview('mark_delayed', {}, 'delayed_candidate'))}
            {btn('Blocked', () => planReview('mark_blocked', {}, 'blocked_candidate'))}
            {btn('Completed Reference(Evidence+외부 Ref)', () => planReview('mark_completed_reference', { evidence: [{ type: 'manual_review', note: reason.trim() }], external_completion_reference: reason.trim() }, 'completed_reference'))}
            {btn('Cancel', () => planReview('cancel_reference', {}, 'cancelled_reference'))}
          </div>
          {planList(plans.filter((p) => ['draft', 'pending_review', 'planned', 'ready_candidate'].includes(p.plan_status)), '검토 대기 Plan 없음', '사람 검토 대기 Plan 이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'initiativestatus' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Initiative Status — Plan 의 Initiative 연결(0545 실존 검증) 기준. Initiative Reference ≠ Initiative 완료." />
          {planList(plans.filter((p) => p.strategic_initiative_id != null), 'Initiative 연결 Plan 없음', 'strategic_initiative_id 가 연결된 Plan 이 여기에 표시됩니다.')}
          {eventList(evByType('initiative_reference_linked'), 'Initiative Link 없음', 'Initiative 연결 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'timeline' && resultEventTab('execution_timeline_reviewed', 'Execution Timeline 검토', 'Timeline Candidate ≠ 확정 일정 — 일정 변경은 사람이 결정합니다.', EXECUTION_TIMELINE_RESULTS)}

      {tab === 'milestones' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {progSelect}{planSelect}
            <select value={msStatusSel} onChange={(e) => setMsStatusSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {MILESTONE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {reasonInput}
            {btn('Milestone Candidate 기록', () => execEvent('milestone_candidate_recorded',
              msStatusSel === 'completed_reference'
                ? { milestone_status: msStatusSel, milestone_name: reason.trim(), evidence: [{ type: 'manual_review', note: reason.trim() }], external_completion_reference: reason.trim() }
                : { milestone_status: msStatusSel, milestone_name: reason.trim() },
              'Milestone Candidate 기록됨', { prog: true, plan: true }), true)}
          </div>
          <AdminAlert tone="warning" description="Milestone Candidate ≠ Completed Milestone — completed_reference 는 Evidence+외부 Completion Reference 없으면 서버 차단(자동 Milestone 완료 없음)." />
          {eventList(evByType('milestone_candidate_recorded'), 'Milestone Candidate 없음', 'Milestone 후보 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'milestoneprog' && resultEventTab('milestone_progress_reviewed', 'Milestone Progress 검토', 'Milestone Progress ≠ Actual Completion — 완료 처리는 Evidence 기반으로만.', MILESTONE_PROGRESS_RESULTS)}
      {tab === 'dependencies' && resultEventTab('execution_dependency_reviewed', 'Execution Dependency 검토', 'Dependency Candidate(순환/차단/외부 포함) ≠ 자동 차단·해제 — 조정은 사람이 결정합니다.', EXECUTION_DEPENDENCY_RESULTS)}
      {tab === 'criticalpath' && resultEventTab('critical_path_reviewed', 'Critical Path 검토', 'Critical Path Candidate ≠ 확정 경로 — 최장 경로 후보 설명일 뿐입니다.', CRITICAL_PATH_RESULTS)}
      {tab === 'health' && resultEventTab('execution_health_reviewed', 'Delivery Health 검토', 'Health ≠ Guaranteed Success — excellent 도 성공을 보장하지 않습니다.', DELIVERY_HEALTH_LEVELS)}
      {tab === 'risk' && resultEventTab('execution_risk_reviewed', 'Delivery Risk 검토', 'Risk 8차원(Schedule/Resource/Dependency/Provider/Approval/Technical/Operational/External) — Risk Candidate ≠ Confirmed Failure.', DELIVERY_RISK_LEVELS, { risk_dimension: riskDimSel })}
      {tab === 'risk' && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
          <span className="text-[11px] text-muted-foreground">Risk Dimension:</span>
          <select value={riskDimSel} onChange={(e) => setRiskDimSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
            {EXECUTION_RISK_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      )}

      {tab === 'progress' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {progSelect}{planSelect}
            <input value={progressVal} onChange={(e) => setProgressVal(e.target.value)} placeholder="0~100" className="w-20 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
            {reasonInput}
            {btn('Planned Progress 기록', () => execEvent('progress_planned_recorded', { planned_progress: Number(progressVal) || 0 }, 'Planned Progress 기록됨', { prog: true, plan: true }), true)}
            {btn('Actual Progress 기록(Evidence 필수)', () => execEvent('progress_actual_reference_recorded', { actual_progress: Number(progressVal) || 0, evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Actual Progress 기록됨', { prog: true, plan: true }))}
          </div>
          <AdminAlert tone="warning" description="Planned ≠ Actual Progress — Actual 은 Evidence 없으면 서버 차단(미검증 Progress 를 Actual 표시 금지)." />
          {eventList([...evByType('progress_planned_recorded'), ...evByType('progress_actual_reference_recorded')], 'Progress 기록 없음', 'Planned/Actual Progress 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'drift' && resultEventTab('progress_drift_reviewed', 'Progress Drift 검토', 'Drift 5단계(on_track/minor/major/severe/insufficient) — Drift Candidate ≠ Confirmed Delay.', PROGRESS_DRIFT_LEVELS)}
      {tab === 'scheduledrift' && resultEventTab('schedule_drift_reviewed', 'Schedule Drift 검토', 'Schedule Drift ≠ 자동 일정 변경 신호 — 일정 조정은 사람이 결정합니다.', SCHEDULE_DRIFT_RESULTS)}
      {tab === 'velocity' && resultEventTab('velocity_reviewed', 'Velocity 검토', 'Velocity ≠ Productivity — 개인 생산성·성과 판단에 사용하지 않습니다.', VELOCITY_RESULTS)}
      {tab === 'stability' && resultEventTab('stability_reviewed', 'Stability 검토', 'Stable ≠ Risk Free — 안정 판정도 위험 부재를 의미하지 않습니다.', STABILITY_RESULTS)}
      {tab === 'delays' && resultEventTab('delay_candidate_recorded', 'Delay Candidate 기록', 'Delay Candidate ≠ Confirmed Delay — 지연 확정은 사람 검토로만.', DELAY_RESULTS)}
      {tab === 'rootcause' && resultEventTab('delay_root_cause_candidate_recorded', 'Delay Root Cause Candidate', 'Root Cause Candidate ≠ Proven Cause — 8+1 원인 카테고리 후보 설명입니다.', DELAY_ROOT_CAUSE_CATEGORIES.map((c) => c), { cause_category: causeSel, result: 'insufficient_data' })}
      {tab === 'rootcause' && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
          <span className="text-[11px] text-muted-foreground">Cause Category:</span>
          <select value={causeSel} onChange={(e) => setCauseSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
            {DELAY_ROOT_CAUSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      )}
      {tab === 'bottleneck' && resultEventTab('bottleneck_reviewed', 'Bottleneck 검토', 'Bottleneck Candidate ≠ 자동 재배치 신호 — Review/Approval/Resource/Dependency/Technical 병목 후보.', BOTTLENECK_RESULTS)}
      {tab === 'forecast' && resultEventTab('delivery_forecast_reviewed', 'Delivery Forecast 검토', 'Forecast ≠ Future Fact — 예측 진행률/완료 시점은 미래 사실이 아닙니다.', DELIVERY_FORECAST_RESULTS)}
      {tab === 'quality' && resultEventTab('execution_quality_reviewed', 'Execution Quality 검토', 'Quality ≠ Verified Quality — Milestone/Review/Outcome/Regression/Rollback 이력 기반 후보 판정.', DELIVERY_QUALITY_LEVELS)}

      {tab === 'regressions' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {progSelect}{planSelect}{reasonInput}
            {btn('Regression Reference 기록', () => execEvent('regression_reference_recorded', { reference: reason.trim() }, 'Regression Reference 기록됨', { prog: true, plan: true }), true)}
            {btn('Rollback Reference 기록', () => execEvent('rollback_reference_recorded', { reference: reason.trim() }, 'Rollback Reference 기록됨', { prog: true, plan: true }))}
          </div>
          <AdminAlert tone="info" description="Regression/Rollback Reference — 실제 Rollback 실행은 외부/사람. 자동 Rollback 없음." />
          {eventList([...evByType('regression_reference_recorded'), ...evByType('rollback_reference_recorded')], 'Regression/Rollback Reference 없음', '회귀·롤백 참조 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'recommendations' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {progSelect}
            <select value={recTypeSel} onChange={(e) => setRecTypeSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {DELIVERY_RECOMMENDATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Recommendation 기록(Evidence 필수)', () => execEvent('delivery_recommendation_recorded', { recommendation_type: recTypeSel, evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Recommendation 기록됨', { prog: true }), true)}
          </div>
          <AdminAlert tone="info" description="Recommendation ≠ Decision — Evidence 없는 Recommendation 서버 차단. 채택 여부는 사람이 결정합니다." />
          {eventList(evByType('delivery_recommendation_recorded'), 'Recommendation 없음', 'Delivery Recommendation 후보가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'reviewqueue' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {progSelect}{planSelect}{reasonInput}
            {btn('Delivery Review 시작', () => deliveryReview('start_review', {}, 'Delivery Review 시작됨'), true)}
            {btn('승인 Reference(Evidence 필수)', () => deliveryReview('approve_delivery_reference', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Approval Reference 기록됨(≠ Execution Approval)'))}
            {btn('조건부 승인 Reference', () => deliveryReview('approve_with_conditions_reference', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, '조건부 Approval Reference 기록됨'))}
            {btn('거절 Reference', () => deliveryReview('reject_delivery_reference', {}, 'Rejection Reference 기록됨'))}
            {btn('보류 Reference', () => deliveryReview('defer_delivery_reference', {}, 'Defer Reference 기록됨'))}
            {btn('수정 요청', () => deliveryReview('request_revision', {}, '수정 요청됨'))}
            {btn('Executive Review 요청', () => deliveryReview('request_executive_review', {}, 'Executive Review 요청됨'))}
            {btn('Resource Review 요청', () => deliveryReview('request_resource_review', {}, 'Resource Review 요청됨'))}
          </div>
          <AdminAlert tone="warning" description="Human Delivery Review — Self-Approval 서버 차단(작성자 ≠ 승인자) · Evidence 없는 승인 차단 · Approval Reference ≠ Execution Approval(자동 시작/완료/배포/일정/예산 변경 전부 false). 최종 승인자는 사람입니다." />
          {eventList([...evByType('human_delivery_review_started'), ...evByType('executive_review_requested'), ...evByType('resource_review_requested'), ...evByType('delivery_revision_requested')], 'Review 기록 없음', 'Delivery/Executive/Resource Review 요청이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'approved' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Approved Delivery References — Approval Reference ≠ Execution Approval. 승인 기록일 뿐 실행이 아닙니다." />
          {progList(programs.filter((p) => p.approval_reference != null), '승인 Reference Program 없음', '승인된 Delivery Reference 가 여기에 표시됩니다.')}
          {eventList(evByType('delivery_approval_reference_recorded'), 'Approval Reference 이벤트 없음', '승인 Reference 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'rejected' && (
        <div className="space-y-2">
          {eventList([...evByType('delivery_rejection_reference_recorded'), ...evByType('delivery_defer_reference_recorded')], 'Rejection/Defer Reference 없음', '거절/보류 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'links' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {progSelect}{reasonInput}
            {btn('Initiative Link(0545 실존 검증)', () => execEvent('initiative_reference_linked', { note: reason.trim() }, 'Initiative Link 기록됨', { prog: true }), true)}
            {btn('Portfolio Link(0545)', () => execEvent('portfolio_reference_linked', { note: reason.trim() }, 'Portfolio Link 기록됨', { prog: true }))}
            {btn('Allocation Link(0546)', () => execEvent('allocation_reference_linked', { note: reason.trim() }, 'Allocation Link 기록됨', { prog: true }))}
            {btn('Commitment Link(0520)', () => execEvent('commitment_reference_linked', { note: reason.trim() }, 'Commitment Link 기록됨', { prog: true }))}
            {btn('Execution Request Link(0535)', () => execEvent('execution_request_reference_linked', { note: reason.trim() }, 'Execution Request Link 기록됨', { prog: true }))}
            {btn('Decision Link(0544)', () => execEvent('decision_reference_linked', { note: reason.trim() }, 'Decision Link 기록됨', { prog: true }))}
          </div>
          <AdminAlert tone="info" description="Reference Link — ID 지정 시 실존 검증(0520/0535/0544/0545/0546). Link ≠ 완료/실행/인과." />
          {eventList([...evByType('initiative_reference_linked'), ...evByType('portfolio_reference_linked'), ...evByType('allocation_reference_linked'), ...evByType('commitment_reference_linked'), ...evByType('execution_request_reference_linked'), ...evByType('decision_reference_linked')], 'Reference Link 없음', '참조 연결 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'outcomes' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {progSelect}{planSelect}{reasonInput}
            {btn('Delivery Outcome 연결', () => execEvent('delivery_outcome_linked', { note: reason.trim() }, 'Outcome 연결됨(≠ Causality)', { prog: true, plan: true }), true)}
          </div>
          <AdminAlert tone="info" description="Outcome Link ≠ Causality — 결과 연결이 실행의 인과를 증명하지 않습니다." />
          {eventList(evByType('delivery_outcome_linked'), 'Outcome Link 없음', '관측된 Delivery Outcome 연결이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'learning' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {progSelect}{reasonInput}
            {btn('Execution Learning 기록', () => execEvent('execution_learning_reference_recorded', { note: reason.trim() }, 'Learning Reference 기록됨', { prog: true }), true)}
          </div>
          <AdminAlert tone="info" description="Learning Reference ≠ 자동 재계획 — 학습 반영 여부는 사람이 결정합니다." />
          {eventList(evByType('execution_learning_reference_recorded'), 'Learning Reference 없음', '실행 학습 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'flow' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Execution 흐름 관측 — 단계별 기록 존재 여부만 표시합니다(자동 진행 아님)." />
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
          <AdminAlert tone="info" description={`Execution 이벤트 41종 통합 Audit — 총 ${NUM(num('execution_events', 'total'))}건. 자동 완료 이벤트 생성 금지.`} />
          {eventList(audit, 'Audit 이벤트 없음', '모든 Execution Intelligence 활동이 여기에 기록됩니다.')}
        </div>
      )}

      {tab === 'support' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description={`분류 7종(fully/partially/execution_only/advisory_only/human_review_only/unavailable/insufficient_data) — 컴포넌트 ${EXECUTION_COMPONENTS.length}종 · 매트릭스 ${EXECUTION_SUPPORT_MATRIX.length}항목. unavailable 은 전부 automatic_*(자동 실행/완료/승인 없음).`} />
          <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
            {EXECUTION_SUPPORT_MATRIX.map((e) => (
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
