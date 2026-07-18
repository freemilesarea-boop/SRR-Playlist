/**
 * ConstraintOptimizationSection — Enterprise Resource Intelligence, Capacity
 * Planning & Constraint Optimization Center (Phase AI-OPS-54).
 *
 * Enterprise Vision→Mission→Strategy→Scenario→Resource Inventory→Capacity
 * Planning→Constraint Detection→Dependency Analysis→Execution Readiness→
 * Optimization Candidates→Executive Resource Review→Resource Learning→Audit.
 * Capacity ≠ Guaranteed Delivery · Bottleneck ≠ Root Cause · Constraint ≠
 * Failure · Optimization ≠ Automatic Improvement. 자동 재배치/인력 이동 없음.
 * (기존 ResourceAllocationSection(0546)/ResourceCapacitySection(0529)/
 *  CapacityContinuitySection(0508)/ExecutiveCapacitySection(0519)과 별개 계층)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, BookOpen, ClipboardList, Gauge, GitBranch, Grid3x3,
  History, Inbox, Layers, Lightbulb, Lock, RefreshCw, Scale, Shield, Users,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchEnterpriseCapacitySummary, fetchEnterpriseCapacityResources,
  createEnterpriseCapacityResource, reviewEnterpriseCapacityResource,
  createEnterpriseCapacityReview, reviewEnterpriseCapacityReview,
  fetchEnterpriseCapacityReviews, recordEnterpriseCapacityEvent,
  fetchEnterpriseCapacityAudit,
  type EnterpriseCapacitySummary, type EnterpriseCapacityResourceRow,
  type EnterpriseCapacityReviewRow, type EnterpriseCapacityEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  RESOURCE_CATEGORIES, CAPACITY_DIMENSIONS, CAPACITY_RESULTS,
  CONSTRAINT_DIMENSIONS, CONSTRAINT_RESULTS, READINESS_DIMENSIONS, READINESS_RESULTS,
  UTILIZATION_RESULTS, CAPACITY_WORKLOAD_RESULTS, CAPACITY_BOTTLENECK_RESULTS,
  RESOURCE_RECOMMENDATION_TYPES, RESOURCE_SCORECARD_FIELDS, buildResourceTimeline,
  ENTERPRISE_RESOURCE_COMPONENTS, ENTERPRISE_RESOURCE_SUPPORT_MATRIX,
} from '@/lib/enterpriseResource';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'resources' | 'inventory' | 'capacity' | 'constraint' | 'dependency'
  | 'utilization' | 'workload' | 'budget' | 'readiness' | 'bottleneck' | 'optimization'
  | 'timeline' | 'summary' | 'scorecard' | 'recommendations' | 'reviewqueue' | 'reviewed'
  | 'learning' | 'links' | 'flow' | 'audit' | 'support' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Resource Overview', icon: Layers },
  { key: 'resources', label: 'Capacity Resources', icon: Gauge },
  { key: 'inventory', label: 'Resource Inventory', icon: ClipboardList },
  { key: 'capacity', label: 'Capacity Planning', icon: Gauge },
  { key: 'constraint', label: 'Constraint Analysis', icon: Shield },
  { key: 'dependency', label: 'Dependency Mapping', icon: GitBranch },
  { key: 'utilization', label: 'Resource Utilization', icon: Activity },
  { key: 'workload', label: 'Workload Analysis', icon: Users },
  { key: 'budget', label: 'Budget Capacity', icon: Scale },
  { key: 'readiness', label: 'Execution Readiness', icon: Activity },
  { key: 'bottleneck', label: 'Bottleneck Analysis', icon: Shield },
  { key: 'optimization', label: 'Optimization Candidates', icon: Lightbulb },
  { key: 'timeline', label: 'Capacity Timeline', icon: History },
  { key: 'summary', label: 'Executive Resource Summaries', icon: ClipboardList },
  { key: 'scorecard', label: 'Executive Resource Scorecard', icon: Grid3x3 },
  { key: 'recommendations', label: 'Recommendations', icon: Lightbulb },
  { key: 'reviewqueue', label: 'Review Queue', icon: Inbox },
  { key: 'reviewed', label: 'Review References', icon: Users },
  { key: 'learning', label: 'Resource Learning', icon: BookOpen },
  { key: 'links', label: 'Reference Links', icon: GitBranch },
  { key: 'flow', label: 'Flow Timeline', icon: History },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
  { key: 'limitations', label: 'Known Limitations', icon: ClipboardList },
];

const KNOWN_LIMITATIONS = [
  'Resource 자동 재배치·인력 자동 이동·Budget 자동 변경·Project 자동 시작/종료·계약 자동 체결/종료·Organization 자동 변경·Production 변경·Merge/Deploy/Rollback 없음 — 모든 반환 flag(resource_reallocated/personnel_moved/budget_changed 등) 항상 false',
  'Capacity ≠ Guaranteed Delivery · Readiness ≠ Success — 실행 가능성 후보 분석이며 성공 보장이 아닙니다',
  'Bottleneck ≠ Root Cause · Constraint ≠ Failure · Optimization ≠ Automatic Improvement — Evidence 없는 Optimization Candidate 서버 차단',
  'Capacity Review Reference 는 Self-Review 차단(작성자 ≠ 평가자) + Evidence 필수 — Review ≠ Approval, Resource 변경은 사람',
  'archived_reference/review_reference_recorded 재결정 차단 · 참조 실존 검증(0520/0545/0546/0547/0552/0555/0557)',
  '이름 충돌 실측: 0546(AI-OPS-42)이 ai_enterprise_resource_events·admin_enterprise_resource_* 를 사용 중 → 본 계층은 ai_enterprise_capacity_*/admin_enterprise_capacity_* 로 명명(별개 계층)',
  'HR 캐파 시스템/타임트래킹/ERP 재무 원장/자원 예약 시스템/PM 도구 피드/클라우드 비용 피드 부재(실측) — insufficient_data 유지, 분석은 수동 기록 기반',
  'Capacity Timeline/Resource·Constraint·Optimization History/Dependency Graph 는 JSONB 통합 — 시계열 원장 테이블 아님',
  'Migration 0472~0558 production 미적용 — 운영 수치는 적용 후 축적됩니다',
  '브라우저 실측 미검증 — UI 는 코드 리뷰/타입/빌드 기준 검증만 수행했습니다',
];

export default function ConstraintOptimizationSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<EnterpriseCapacitySummary>({});
  const [resources, setResources] = useState<EnterpriseCapacityResourceRow[]>([]);
  const [reviews, setReviews] = useState<EnterpriseCapacityReviewRow[]>([]);
  const [audit, setAudit] = useState<EnterpriseCapacityEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [selResource, setSelResource] = useState('');
  const [selReview, setSelReview] = useState('');
  const [catSel, setCatSel] = useState<string>('workforce');
  const [capDimSel, setCapDimSel] = useState<string>('workforce_capacity');
  const [conDimSel, setConDimSel] = useState<string>('budget_constraint');
  const [readyDimSel, setReadyDimSel] = useState<string>('resource_availability');
  const [recTypeSel, setRecTypeSel] = useState<string>('gather_more_evidence_candidate');
  const [resultSel, setResultSel] = useState<string>('insufficient_data');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, r, v, a] = await Promise.all([
        fetchEnterpriseCapacitySummary(), fetchEnterpriseCapacityResources(null, null, 200),
        fetchEnterpriseCapacityReviews(null, 200), fetchEnterpriseCapacityAudit(200),
      ]);
      setSummary(s); setResources(r); setReviews(v); setAudit(a);
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
  const resReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selResource) { if (!selResource) toast.error('Resource 선택 필수'); return; }
    void act(() => reviewEnterpriseCapacityResource(selResource, action, r, payload), ok);
  };
  const cvReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selReview) { if (!selReview) toast.error('Capacity Review 선택 필수'); return; }
    void act(() => reviewEnterpriseCapacityReview(selReview, action, r, payload), ok);
  };
  const capEvent = (kind: string, payload: Record<string, unknown>, ok: string, ids: { res?: boolean; review?: boolean } = { res: true }) => {
    const r = needReason();
    if (!r) return;
    void act(() => recordEnterpriseCapacityEvent(kind, r, payload, ids.res ? (selResource || null) : null, ids.review ? (selReview || null) : null), ok);
  };

  const obj = useCallback((k: string): Record<string, unknown> => (typeof summary[k] === 'object' && summary[k] !== null && !Array.isArray(summary[k]) ? summary[k] as Record<string, unknown> : {}), [summary]);
  const num = useCallback((k: string, sub: string): number | null => {
    const v = obj(k)[sub];
    return typeof v === 'number' ? v : null;
  }, [obj]);

  const flowTimeline = useMemo(() => buildResourceTimeline({ present: {
    enterprise_vision: (num('capacity_actuals', 'missions_0555') ?? 0) > 0,
    mission: (num('capacity_events', 'total') ?? 0) > 0 && (num('capacity_actuals', 'missions_0555') ?? 0) > 0,
    strategy: (num('capacity_actuals', 'strategy_portfolios_0545') ?? 0) > 0,
    scenario: (num('capacity_events', 'scenario_links') ?? 0) > 0,
    resource_inventory: (num('capacity_events', 'inventory_reviews') ?? 0) + (num('capacity_events', 'inventory_links') ?? 0) > 0,
    capacity_planning: (num('capacity_events', 'capacity_assessments') ?? 0) > 0,
    constraint_detection: (num('capacity_events', 'constraint_reviews') ?? 0) > 0,
    dependency_analysis: (num('capacity_events', 'dependency_mappings') ?? 0) > 0,
    execution_readiness: (num('capacity_events', 'readiness_reviews') ?? 0) > 0,
    optimization_candidates: (num('capacity_events', 'optimization_candidates') ?? 0) > 0,
    executive_resource_review: (num('capacity_events', 'resource_review_requests') ?? 0) + (num('capacity_events', 'executive_review_requests') ?? 0) + (num('capacity_events', 'human_review_requests') ?? 0) + (num('capacity_events', 'review_references') ?? 0) > 0,
    resource_learning: (num('capacity_events', 'learnings') ?? 0) > 0,
  } }), [num]);

  if (loading) return <AdminCard title="Resource Intelligence & Constraint Optimization Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Resource Intelligence & Constraint Optimization Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const resSelect = (
    <select value={selResource} onChange={(e) => setSelResource(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Resource 선택</option>
      {resources.map((r) => <option key={r.id} value={r.id}>{r.resource_code} · {r.resource_status}</option>)}
    </select>
  );
  const reviewSelect = (
    <select value={selReview} onChange={(e) => setSelReview(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Capacity Review 선택</option>
      {reviews.map((r) => <option key={r.id} value={r.id}>{r.review_code} · {r.review_status}</option>)}
    </select>
  );
  const reasonInput = <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button disabled={busy} onClick={onClick} className={primary ? 'rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50' : 'rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50'}>{label}</button>
  );
  const tone = (s: string) => (s.includes('sufficient') || s.includes('negligible') || s.includes('ready_candidate') || s.includes('efficient') || s.includes('balanced') || s.includes('no_material') || s.includes('available') || s.includes('review_reference') ? 'success' as const : s.includes('unavailable_candidate') || s.includes('critical') || s.includes('not_ready') || s.includes('overloaded') || s.includes('overutilized') || s === 'unavailable' ? 'danger' as const : 'warning' as const);
  const evByType = (t: string) => audit.filter((e) => e.event_type === t);
  const eventList = (rows: EnterpriseCapacityEventRow[], emptyTitle: string, emptyDesc: string) => (
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
  const resList = (list: EnterpriseCapacityResourceRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((r) => (
          <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(r.resource_status)}>{r.resource_status}</AdminBadge>
            <AdminBadge tone={tone(r.capacity_status)}>{r.capacity_status}</AdminBadge>
            <AdminBadge tone={tone(r.constraint_status)}>{r.constraint_status}</AdminBadge>
            <span className="ml-2 font-bold">{r.resource_code}</span>
            <span className="ml-2 text-muted-foreground">{r.resource_category} · {r.resource_name} · readiness {r.readiness_status} · optimizations {Array.isArray(r.optimization_candidates) ? r.optimization_candidates.length : 0}건</span>
          </div>
        ))}
      </div>
    )
  );
  const reviewList = (list: EnterpriseCapacityReviewRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((r) => (
          <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(r.review_status)}>{r.review_status}</AdminBadge>
            <span className="ml-2 font-bold">{r.review_code}</span>
            <span className="ml-2 text-muted-foreground">{r.review_type} · findings {Array.isArray(r.findings) ? r.findings.length : 0}건 · {r.review_summary ?? '—'}</span>
          </div>
        ))}
      </div>
    )
  );
  const simpleEventTab = (kind: string, title: string, note: string) => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        {resSelect}{reasonInput}
        {btn(`${title} 기록`, () => capEvent(kind, { note: reason.trim() }, `${title} 기록됨`), true)}
      </div>
      <AdminAlert tone="info" description={note} />
      {eventList(evByType(kind), `${title} 없음`, '기록이 여기에 표시됩니다.')}
    </div>
  );
  const resultEventTab = (kind: string, title: string, note: string, results: readonly string[], extraPayload: Record<string, unknown> = {}) => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        {resSelect}
        <select value={results.includes(resultSel) ? resultSel : results[0]} onChange={(e) => setResultSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
          {results.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {reasonInput}
        {btn(`${title} 기록`, () => capEvent(kind, { result: results.includes(resultSel) ? resultSel : results[0], ...extraPayload }, `${title} 기록됨`), true)}
      </div>
      <AdminAlert tone="info" description={note} />
      {eventList(evByType(kind), `${title} 없음`, '사람 검토 기록이 여기에 표시됩니다.')}
    </div>
  );

  return (
    <AdminCard
      title="Resource Intelligence & Constraint Optimization Center"
      subtitle="Resource Inventory→Capacity Planning→Constraint Detection→Dependency Analysis→Execution Readiness→Optimization Candidates→Executive Review→Learning — 자원 배분과 최종 결정은 반드시 사람"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 Enterprise 가 보유 자원으로 전략과 시나리오를 실제로 수행할 수 있는지 분석하는 Resource Intelligence 계층입니다. AI 는 Resource Inventory/Capacity Planning/Constraint Detection/Dependency Mapping/Utilization·Workload·Budget Capacity 분석/Execution Readiness/Bottleneck Detection/Optimization Candidate 생성/Executive Summary·Scorecard/Recommendation/Review 요청/Learning 기록까지만 수행하며, Resource 자동 재배치·인력 자동 이동·Budget 자동 변경·Project 자동 시작/종료·계약 자동 체결/종료·Organization 자동 변경·Production 변경·Merge/Deploy/Rollback 은 수행하지 않습니다. Capacity ≠ Guaranteed Delivery, Bottleneck ≠ Root Cause, Constraint ≠ Failure, Optimization ≠ Automatic Improvement, Readiness ≠ Success. AI 는 실행 가능성을 분석합니다. 사람이 자원을 배분하고 조직을 운영하며 최종 결정을 내립니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Capacity Resources" value={NUM(num('resources', 'total'))} />
            <Box label="Available / Constrained / Overloaded / Underutilized" value={`${NUM(num('resources', 'available'))} / ${NUM(num('resources', 'constrained'))} / ${NUM(num('resources', 'overloaded'))} / ${NUM(num('resources', 'underutilized'))}`} />
            <Box label="Capacity Sufficient / Overloaded·Unavailable" value={`${NUM(num('resources', 'capacity_sufficient'))} / ${NUM(num('resources', 'capacity_overloaded'))}`} />
            <Box label="Critical·Elevated Constraints" value={NUM(num('resources', 'critical_constraints'))} />
            <Box label="Ready / Not Ready" value={`${NUM(num('resources', 'ready'))} / ${NUM(num('resources', 'not_ready'))}`} />
            <Box label="Capacity Reviews" value={NUM(num('reviews', 'total'))} />
            <Box label="Requested / In Review / Reference / Revision" value={`${NUM(num('reviews', 'requested'))} / ${NUM(num('reviews', 'in_review'))} / ${NUM(num('reviews', 'reference_recorded'))} / ${NUM(num('reviews', 'revision_requested'))}`} />
            <Box label="Inventory / Capacity / Constraint Reviews" value={`${NUM(num('capacity_events', 'inventory_reviews'))} / ${NUM(num('capacity_events', 'capacity_assessments'))} / ${NUM(num('capacity_events', 'constraint_reviews'))}`} />
            <Box label="Dependency / Utilization / Workload" value={`${NUM(num('capacity_events', 'dependency_mappings'))} / ${NUM(num('capacity_events', 'utilization_reviews'))} / ${NUM(num('capacity_events', 'workload_reviews'))}`} />
            <Box label="Budget / Readiness / Bottleneck Reviews" value={`${NUM(num('capacity_events', 'budget_reviews'))} / ${NUM(num('capacity_events', 'readiness_reviews'))} / ${NUM(num('capacity_events', 'bottleneck_reviews'))}`} />
            <Box label="Optimization Candidates / Timelines" value={`${NUM(num('capacity_events', 'optimization_candidates'))} / ${NUM(num('capacity_events', 'timelines'))}`} />
            <Box label="Summaries / Scorecards / Recommendations" value={`${NUM(num('capacity_events', 'summaries'))} / ${NUM(num('capacity_events', 'scorecards'))} / ${NUM(num('capacity_events', 'recommendations'))}`} />
            <Box label="Resource / Executive / Human Review 요청" value={`${NUM(num('capacity_events', 'resource_review_requests'))} / ${NUM(num('capacity_events', 'executive_review_requests'))} / ${NUM(num('capacity_events', 'human_review_requests'))}`} />
            <Box label="Review References" value={NUM(num('capacity_events', 'review_references'))} />
            <Box label="Learnings / Scenario / Program Links" value={`${NUM(num('capacity_events', 'learnings'))} / ${NUM(num('capacity_events', 'scenario_links'))} / ${NUM(num('capacity_events', 'program_links'))}`} />
            <Box label="Inventory Links(0546)" value={NUM(num('capacity_events', 'inventory_links'))} />
          </div>
          <AdminAlert tone="info" description={`capacity_unavailable: ${Array.isArray(summary.capacity_unavailable) ? (summary.capacity_unavailable as unknown[]).map(String).join(', ') : '—'}. Capacity 원천 실측 — Decision Scenarios(0557) ${NUM(num('capacity_actuals', 'decision_scenarios_0557'))}건 · Execution Programs(0547) ${NUM(num('capacity_actuals', 'execution_programs_0547'))}건 · Commitments(0520) ${NUM(num('capacity_actuals', 'execution_commitments_0520'))}건 · Organization Models(0552) ${NUM(num('capacity_actuals', 'organization_models_0552'))}건 · Resource Inventory(0546) ${NUM(num('capacity_actuals', 'resource_inventory_0546'))}건 · Missions(0555) ${NUM(num('capacity_actuals', 'missions_0555'))}건. 0 과 Unknown 을 혼동하지 않습니다.`} />
        </div>
      )}

      {tab === 'resources' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <select value={catSel} onChange={(e) => setCatSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {RESOURCE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {reasonInput}
            {btn('Capacity Resource 생성(≠ 배치 변경)', () => {
              const r = needReason();
              if (!r) return;
              void act(() => createEnterpriseCapacityResource({ resource_category: catSel, resource_name: r }), 'Capacity Resource 생성됨(자동 재배치 없음)');
            }, true)}
            {btn('Available 표시', () => resReview('mark_available', {}, 'available(관측 상태)'))}
            {btn('Constrained 표시', () => resReview('mark_constrained', {}, 'constrained(≠ Failure)'))}
            {btn('Overloaded 표시', () => resReview('mark_overloaded', {}, 'overloaded(≠ 개인 평가)'))}
            {btn('Underutilized 표시', () => resReview('mark_underutilized', {}, 'underutilized(≠ 감축 지시)'))}
            {btn('Review Reference(Self 차단·Evidence 필수)', () => resReview('record_review_reference', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'review_reference(≠ Approval)'))}
            {btn('Archive', () => resReview('archive_reference', {}, 'archived_reference'))}
            {resSelect}
          </div>
          <AdminAlert tone="info" description="Category 12종 · 자동 재배치/인력 이동/Budget·Project·계약·조직 변경 계열 category 서버 차단 · archived 재결정 차단." />
          {resList(resources, 'Capacity Resource 없음', '핵심 질문 예: 현재 Resource 는 충분한가? 어떤 Constraint 가 Mission 달성을 방해하는가? — 전부 Candidate 분석.')}
        </div>
      )}

      {tab === 'inventory' && simpleEventTab('resource_inventory_reviewed', 'Resource Inventory 검토', 'Inventory 관측 ≠ 배치 확정 — 보유 자원 현황 관측 기록입니다.')}
      {tab === 'capacity' && (
        <>
          {resultEventTab('capacity_assessment_reviewed', 'Capacity Assessment 검토', 'Capacity 5평가(§5 — Workforce/Budget/Infrastructure/Technology/Operational) — Capacity ≠ Guaranteed Delivery.', CAPACITY_RESULTS, { capacity_dimension: capDimSel })}
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <span className="text-[11px] text-muted-foreground">Capacity Dimension:</span>
            <select value={capDimSel} onChange={(e) => setCapDimSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {CAPACITY_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </>
      )}
      {tab === 'constraint' && (
        <>
          {resultEventTab('constraint_analysis_reviewed', 'Constraint Analysis 검토', 'Constraint 5평가(§6 — Budget/Workforce/Technology/Dependency/Schedule) — Constraint ≠ Failure.', CONSTRAINT_RESULTS, { constraint_dimension: conDimSel })}
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <span className="text-[11px] text-muted-foreground">Constraint Dimension:</span>
            <select value={conDimSel} onChange={(e) => setConDimSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {CONSTRAINT_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </>
      )}
      {tab === 'dependency' && simpleEventTab('dependency_mapping_recorded', 'Dependency Mapping 기록', 'Dependency Graph 는 JSONB 통합 — Dependency ≠ 자동 조정, 지연 원인 확정 아님.')}
      {tab === 'utilization' && resultEventTab('resource_utilization_reviewed', 'Resource Utilization 검토', 'Utilization ≠ 생산성 평가 — 유휴/과부하 관측 후보입니다.', UTILIZATION_RESULTS)}
      {tab === 'workload' && resultEventTab('workload_analysis_reviewed', 'Workload Analysis 검토', 'Workload ≠ 개인 평가/재배치 신호 — 부하 분포 관측 후보입니다.', CAPACITY_WORKLOAD_RESULTS)}
      {tab === 'budget' && resultEventTab('budget_capacity_reviewed', 'Budget Capacity 검토', 'Budget Capacity ≠ Budget 변경 — 예산 여력 관측 후보입니다.', CAPACITY_RESULTS)}
      {tab === 'readiness' && (
        <>
          {resultEventTab('execution_readiness_reviewed', 'Execution Readiness 검토', 'Readiness 5평가(§7 — Resource Availability/Capacity/Dependencies/Risk/Organizational Readiness) — Readiness ≠ Success.', READINESS_RESULTS, { readiness_dimension: readyDimSel })}
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <span className="text-[11px] text-muted-foreground">Readiness Dimension:</span>
            <select value={readyDimSel} onChange={(e) => setReadyDimSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {READINESS_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </>
      )}
      {tab === 'bottleneck' && resultEventTab('bottleneck_detection_reviewed', 'Bottleneck Detection 검토', 'Bottleneck ≠ Root Cause — 병목 후보이며 원인 확정이 아닙니다.', CAPACITY_BOTTLENECK_RESULTS)}
      {tab === 'optimization' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {resSelect}{reasonInput}
            {btn('Optimization Candidate 기록(Evidence 필수)', () => capEvent('optimization_candidate_recorded', { note: reason.trim(), evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Optimization Candidate 기록됨(≠ Automatic Improvement)'), true)}
          </div>
          <AdminAlert tone="warning" description="Optimization ≠ Automatic Improvement — Evidence 없는 후보 서버 차단, 적용은 사람이 결정합니다." />
          {eventList(evByType('optimization_candidate_recorded'), 'Optimization Candidate 없음', '최적화 후보가 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'timeline' && simpleEventTab('capacity_timeline_recorded', 'Capacity Timeline 기록', 'Capacity Timeline — capacity_history 로 통합 축적됩니다(≠ Forecast 확정).')}
      {tab === 'summary' && simpleEventTab('executive_resource_summary_recorded', 'Executive Resource Summary 기록', 'Summary ≠ 자원 배분 확정 — 경영진 판단 보조 자료입니다.')}
      {tab === 'scorecard' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {resSelect}{reasonInput}
            {btn('Resource Scorecard 기록', () => capEvent('executive_resource_scorecard_recorded', { fields: [...RESOURCE_SCORECARD_FIELDS], note: reason.trim() }, 'Scorecard 기록됨(≠ 재배치 지시)'), true)}
          </div>
          <AdminAlert tone="warning" description={`§8 필드 8종(${RESOURCE_SCORECARD_FIELDS.join(', ')}) — Scorecard ≠ 재배치 지시(unavailable/critical constraint 우선 결정적 정렬 후보).`} />
          {eventList(evByType('executive_resource_scorecard_recorded'), 'Scorecard 없음', 'Executive Resource Scorecard 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'recommendations' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {resSelect}
            <select value={recTypeSel} onChange={(e) => setRecTypeSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {RESOURCE_RECOMMENDATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Recommendation 기록(Evidence 필수)', () => capEvent('resource_recommendation_recorded', { recommendation_type: recTypeSel, evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Recommendation 기록됨(≠ Decision)'), true)}
          </div>
          <AdminAlert tone="info" description="Resource Recommendation ≠ Decision — 권고 23종 whitelist, Evidence 없는 Recommendation 서버 차단. 채택은 사람이 결정합니다." />
          {eventList(evByType('resource_recommendation_recorded'), 'Recommendation 없음', 'Resource Recommendation 후보가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'reviewqueue' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {resSelect}{reasonInput}
            {btn('Resource Review 요청', () => {
              const r = needReason();
              if (!r || !selResource) { if (!selResource) toast.error('Resource 선택 필수'); return; }
              void act(() => createEnterpriseCapacityReview({ capacity_resource_id: selResource, review_type: 'resource_review', review_summary: r }), 'Resource Review 요청됨(≠ Approval)');
            }, true)}
            {btn('Executive Review 요청', () => {
              const r = needReason();
              if (!r || !selResource) { if (!selResource) toast.error('Resource 선택 필수'); return; }
              void act(() => createEnterpriseCapacityReview({ capacity_resource_id: selResource, review_type: 'executive_review', review_summary: r }), 'Executive Review 요청됨(≠ Approval)');
            })}
            {btn('Human Review 요청', () => {
              const r = needReason();
              if (!r || !selResource) { if (!selResource) toast.error('Resource 선택 필수'); return; }
              void act(() => createEnterpriseCapacityReview({ capacity_resource_id: selResource, review_type: 'human_review', review_summary: r }), 'Human Review 요청됨(Resource 변경은 사람)');
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {reviewSelect}
            {btn('검토 시작', () => cvReview('mark_in_review', {}, 'in_review'))}
            {btn('Review Reference 기록(Evidence 필수)', () => cvReview('record_review_reference', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Review Reference 기록됨(≠ Approval)'), true)}
            {btn('수정 요청', () => cvReview('request_revision', {}, 'revision_requested'))}
            {btn('Insufficient Data', () => cvReview('mark_insufficient_data', {}, 'insufficient_data'))}
          </div>
          <AdminAlert tone="warning" description="Review Workflow(§9 — resource/executive/human 3종 요청만) — Self-Review 서버 차단(작성자 ≠ 평가자) · Evidence 없는 Review Reference 차단 · 종결 재결정 차단 · Review ≠ Approval. Resource 변경은 반드시 사람이 수행합니다." />
          {reviewList(reviews.filter((r) => ['requested', 'in_review', 'revision_requested'].includes(r.review_status)), '대기 Review 없음', '0건은 검토할 것이 없음을 의미하지 않습니다.')}
        </div>
      )}
      {tab === 'reviewed' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Review Reference — 사람이 기록한 검토 참조이며 승인/재배치가 아닙니다." />
          {reviewList(reviews.filter((r) => r.review_status === 'review_reference_recorded'), 'Review Reference 없음', '사람이 검토를 완료한 기록이 여기에 표시됩니다.')}
          {eventList(evByType('capacity_review_reference_recorded'), 'Reference 이벤트 없음', 'Review Reference 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'learning' && simpleEventTab('resource_learning_recorded', 'Resource Learning 기록', 'Resource Learning ≠ 자동 재배치 — 학습 반영 여부는 사람이 결정합니다.')}

      {tab === 'links' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {resSelect}{reasonInput}
            {btn('Scenario Link(0557 실존 검증)', () => capEvent('scenario_reference_linked', { note: reason.trim() }, 'Scenario Link 기록됨(≠ 실행 확정)'), true)}
            {btn('Program Link(0547)', () => capEvent('program_reference_linked', { note: reason.trim() }, 'Program Link 기록됨'))}
            {btn('Organization Link(0552)', () => capEvent('organization_reference_linked', { note: reason.trim() }, 'Organization Link 기록됨'))}
            {btn('Portfolio Link(0545)', () => capEvent('portfolio_reference_linked', { note: reason.trim() }, 'Portfolio Link 기록됨'))}
            {btn('Mission Link(0555)', () => capEvent('mission_reference_linked', { note: reason.trim() }, 'Mission Link 기록됨'))}
            {btn('Commitment Link(0520)', () => capEvent('commitment_reference_linked', { note: reason.trim() }, 'Commitment Link 기록됨'))}
            {btn('Inventory Link(0546)', () => capEvent('inventory_reference_linked', { note: reason.trim() }, 'Inventory Link 기록됨(0546 참조만)'))}
          </div>
          <AdminAlert tone="info" description="Reference Link — ID 지정 시 실존 검증(0520/0545/0546/0547/0552/0555/0557). Link ≠ 변경/확정/배치." />
          {eventList([...evByType('scenario_reference_linked'), ...evByType('program_reference_linked'), ...evByType('organization_reference_linked'), ...evByType('portfolio_reference_linked'), ...evByType('mission_reference_linked'), ...evByType('commitment_reference_linked'), ...evByType('inventory_reference_linked')], 'Reference Link 없음', '참조 연결 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'flow' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Resource 흐름 관측 — 단계별 기록 존재 여부만 표시합니다(자동 진행 아님)." />
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
          <AdminAlert tone="info" description={`Capacity 이벤트 31종 통합 Audit — 총 ${NUM(num('capacity_events', 'total'))}건. 자동 재배치 이벤트 생성 금지.`} />
          {eventList(audit, 'Audit 이벤트 없음', '모든 Resource Intelligence 활동이 여기에 기록됩니다.')}
        </div>
      )}

      {tab === 'support' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description={`분류 6종(fully/partially/advisory_only/human_review_only/unavailable/insufficient_data) — 컴포넌트 ${ENTERPRISE_RESOURCE_COMPONENTS.length}종 · 매트릭스 ${ENTERPRISE_RESOURCE_SUPPORT_MATRIX.length}항목. unavailable 은 전부 automatic_*(자동 재배치 없음).`} />
          <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
            {ENTERPRISE_RESOURCE_SUPPORT_MATRIX.map((e) => (
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
