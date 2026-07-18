/**
 * ResourceAllocationSection — Enterprise Resource Intelligence, Capital Allocation &
 * Capacity Planning Center (Phase AI-OPS-42).
 *
 * Resource Inventory→Availability→Human/Technical/Operational Capacity→
 * Financial Envelope→Initiative Demand→Demand Forecast→Conflict→
 * Capacity/Funding/Workforce Gap→Allocation Option→Opportunity Cost→
 * Capital Efficiency→Trade-off/Robustness/Regret→Reversibility/Feasibility→
 * Capacity Plan→Human Resource/Finance Review→Approval Reference→Outcome→
 * Quality/Drift→Learning→Audit.
 * Inventory ≠ 자산 원장 · Demand ≠ 예약 · Option ≠ 배정 · Approval Reference ≠ 집행.
 * 최종 예산·자원·인력·Capacity 배정과 비용 집행은 반드시 사람.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, BookOpen, ClipboardList, DollarSign, Gauge, GitBranch,
  Grid3x3, History, Inbox, Layers, Lightbulb, ListOrdered, Lock, RefreshCw, Scale,
  Search, Shield, TrendingUp, Users,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchResourceIntelSummary, fetchResourceInventory, createResourceInventory, reviewResourceInventory,
  fetchResourceDemands, createResourceDemand, reviewResourceDemand,
  fetchAllocationOptions, createAllocationOption, reviewAllocationOption,
  recordResourceEvent, fetchEnterpriseResourceAudit,
  type ResourceIntelSummary, type ResourceInventoryRow, type ResourceDemandRow,
  type AllocationOptionRow, type EnterpriseResourceEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  RESOURCE_DOMAINS, RESOURCE_TYPES, ALLOCATION_OPTION_TYPES, AVAILABILITY_RESULTS,
  FRESHNESS_RESULTS, RELIABILITY_RESULTS, HUMAN_CAPACITY_RESULTS, TECHNICAL_CAPACITY_RESULTS,
  FINANCIAL_ENVELOPE_TYPES, DEMAND_FORECAST_RESULTS, RESOURCE_CONFLICT_RESULTS,
  OVERCOMMITMENT_RESULTS, UNDERUTILIZATION_RESULTS, CAPACITY_GAP_RESULTS, FUNDING_GAP_RESULTS,
  WORKFORCE_GAP_RESULTS, OPPORTUNITY_COST_RESULTS, CAPITAL_EFFICIENCY_RESULTS,
  UTILIZATION_RESULTS, ALLOCATION_TRADEOFF_AXES, ALLOCATION_TRADEOFF_RESULTS,
  ALLOCATION_ROBUSTNESS_RESULTS, ALLOCATION_REGRET_RESULTS, ALLOCATION_REVERSIBILITY_RESULTS,
  ALLOCATION_FEASIBILITY_RESULTS, ALLOCATION_RECOMMENDATION_TYPES, ALLOCATION_QUALITY_RESULTS,
  RESOURCE_DRIFT_RESULTS, ALLOCATION_DRIFT_RESULTS, buildResourceTimeline,
  RESOURCE_COMPONENTS, RESOURCE_SUPPORT_MATRIX,
} from '@/lib/resourceAllocation';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'inbox' | 'inventory' | 'pendinginv' | 'availability' | 'freshness' | 'reliability'
  | 'chuman' | 'creviewer' | 'cspecialist' | 'ctechnical' | 'coperational' | 'ccompute' | 'cstorage'
  | 'cconnector' | 'cprovider' | 'envelopes' | 'cashflow' | 'demands' | 'pendingdemand' | 'demandforecast'
  | 'conflicts' | 'overcommit' | 'underutil' | 'capgaps' | 'fundgaps' | 'workgaps' | 'options'
  | 'pendingalloc' | 'onoalloc' | 'odefer' | 'opartial' | 'ophased' | 'oreversible' | 'oreserve'
  | 'oppcost' | 'efficiency' | 'utilization' | 'tradeoff' | 'robustness' | 'regret' | 'reversibility'
  | 'feasibility' | 'capplans' | 'recommendations' | 'humanreviews' | 'approved' | 'rejected' | 'deferred'
  | 'budgetrefs' | 'commitrefs' | 'decisionrefs' | 'outcomes' | 'quality' | 'resdrift' | 'allocdrift'
  | 'learning' | 'timeline' | 'audit' | 'support' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Overview', icon: Layers },
  { key: 'inbox', label: 'Resource Inbox', icon: Inbox },
  { key: 'inventory', label: 'Resource Inventory', icon: BookOpen },
  { key: 'pendinginv', label: 'Pending Inventory Review', icon: Scale },
  { key: 'availability', label: 'Availability', icon: Gauge },
  { key: 'freshness', label: 'Freshness', icon: History },
  { key: 'reliability', label: 'Reliability', icon: Shield },
  { key: 'chuman', label: 'Human Capacity', icon: Users },
  { key: 'creviewer', label: 'Reviewer Capacity', icon: Users },
  { key: 'cspecialist', label: 'Specialist Capacity', icon: Users },
  { key: 'ctechnical', label: 'Technical Capacity', icon: Activity },
  { key: 'coperational', label: 'Operational Capacity', icon: Activity },
  { key: 'ccompute', label: 'Compute Capacity', icon: Activity },
  { key: 'cstorage', label: 'Storage Capacity', icon: Activity },
  { key: 'cconnector', label: 'Connector Capacity', icon: GitBranch },
  { key: 'cprovider', label: 'Provider Capacity', icon: GitBranch },
  { key: 'envelopes', label: 'Financial Envelopes', icon: DollarSign },
  { key: 'cashflow', label: 'Cash Flow References', icon: DollarSign },
  { key: 'demands', label: 'Resource Demands', icon: ClipboardList },
  { key: 'pendingdemand', label: 'Pending Demand Review', icon: Scale },
  { key: 'demandforecast', label: 'Demand Forecast', icon: TrendingUp },
  { key: 'conflicts', label: 'Resource Conflicts', icon: AlertTriangle },
  { key: 'overcommit', label: 'Overcommitment', icon: AlertTriangle },
  { key: 'underutil', label: 'Underutilization', icon: Gauge },
  { key: 'capgaps', label: 'Capacity Gaps', icon: AlertTriangle },
  { key: 'fundgaps', label: 'Funding Gaps', icon: DollarSign },
  { key: 'workgaps', label: 'Workforce Gaps', icon: Users },
  { key: 'options', label: 'Allocation Options', icon: ListOrdered },
  { key: 'pendingalloc', label: 'Pending Allocation Review', icon: Scale },
  { key: 'onoalloc', label: 'No Allocation Options', icon: ListOrdered },
  { key: 'odefer', label: 'Defer Allocation Options', icon: History },
  { key: 'opartial', label: 'Partial Allocations', icon: ListOrdered },
  { key: 'ophased', label: 'Phased Allocations', icon: ListOrdered },
  { key: 'oreversible', label: 'Reversible Allocations', icon: RefreshCw },
  { key: 'oreserve', label: 'Reserve Capacity Options', icon: Shield },
  { key: 'oppcost', label: 'Opportunity Cost', icon: Scale },
  { key: 'efficiency', label: 'Capital Efficiency', icon: Gauge },
  { key: 'utilization', label: 'Resource Utilization', icon: Gauge },
  { key: 'tradeoff', label: 'Allocation Trade-offs', icon: Scale },
  { key: 'robustness', label: 'Allocation Robustness', icon: Gauge },
  { key: 'regret', label: 'Allocation Regret', icon: Scale },
  { key: 'reversibility', label: 'Allocation Reversibility', icon: RefreshCw },
  { key: 'feasibility', label: 'Allocation Feasibility', icon: Gauge },
  { key: 'capplans', label: 'Capacity Plans', icon: ClipboardList },
  { key: 'recommendations', label: 'Recommendation Candidates', icon: Lightbulb },
  { key: 'humanreviews', label: 'Human Resource/Finance Reviews', icon: Users },
  { key: 'approved', label: 'Approved Allocation References', icon: Scale },
  { key: 'rejected', label: 'Rejected Allocation References', icon: Scale },
  { key: 'deferred', label: 'Deferred Allocation References', icon: History },
  { key: 'budgetrefs', label: 'Budget References', icon: DollarSign },
  { key: 'commitrefs', label: 'Commitment References', icon: ClipboardList },
  { key: 'decisionrefs', label: 'Decision/Portfolio References', icon: ClipboardList },
  { key: 'outcomes', label: 'Resource Outcomes', icon: Search },
  { key: 'quality', label: 'Allocation Quality', icon: Gauge },
  { key: 'resdrift', label: 'Resource Drift', icon: Activity },
  { key: 'allocdrift', label: 'Allocation Drift', icon: Activity },
  { key: 'learning', label: 'Resource Learning', icon: Lightbulb },
  { key: 'timeline', label: 'Timeline', icon: History },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
  { key: 'limitations', label: 'Known Limitations', icon: ClipboardList },
];

const KNOWN_LIMITATIONS = [
  '자동 Budget/Resource/Capital Allocation·비용 집행·Payment·Provisioning 없음 — Approval Reference 의 budget_allocated/resources_allocated/capacity_provisioned/production_applied 는 항상 false',
  'Resource Inventory ≠ 검증된 물리 자산/회계 장부 — accounting ledger/bank balance/treasury 피드 부재',
  'HR 가용성 캘린더/Payroll 시스템 부재 — Human Capacity 는 Proxy 중심, 개인 생산성·성과·보상 판단에 사용하지 않음',
  'Cloud Billing/Provider Quota API 피드 부재 — Compute/Storage/Provider Capacity 는 Reference 중심(unverified 유지)',
  '자원 예약 시스템 부재 — Reservation Candidate ≠ Actual Reservation(외부 Reference 없으면 reserved 기록 서버 차단)',
  'Budget Reference ≠ Available Cash · Cash Flow Reference ≠ Bank Balance · Funding Gap ≠ 회계상 적자 확정',
  'Opportunity Cost ≠ 확정 손실 · Capital Efficiency ≠ 회계 ROI · High Utilization ≠ Healthy · Low Utilization ≠ 낭비',
  'Conflict/Overcommitment/Gap 은 Candidate 중심 — Confirmed 판정 아님, Historical Usage ≠ Future Usage',
  'Allocation Quality 는 Outcome 연결 후에만 · Resource/Allocation Drift 는 자동 재배분 신호 아님 · Correlation ≠ Causality',
  '스펙 §30 이후 절단 수신 — 해당 구간은 §1~29+시리즈 패턴 기반 구성(원문과 다를 수 있음)',
  'Migration 0472~0546 production 미적용 — 운영 수치는 적용 후 축적됩니다',
];

const CAPACITY_TAB_DOMAINS: Partial<Record<Tab, string[]>> = {
  chuman: ['human_capacity', 'engineering_capacity', 'incident_response_capacity', 'customer_support_capacity', 'store_operations_capacity', 'content_operations_capacity', 'music_quality_capacity', 'playlist_operations_capacity'],
  creviewer: ['reviewer_capacity'],
  cspecialist: ['specialist_capacity'],
  ctechnical: ['technical_capacity', 'network_capacity', 'database_capacity', 'api_capacity', 'queue_capacity', 'workflow_capacity'],
  coperational: ['operational_capacity'],
  ccompute: ['compute_capacity', 'ai_agent_capacity_reference'],
  cstorage: ['storage_capacity'],
  cconnector: ['connector_capacity'],
  cprovider: ['provider_capacity'],
};
const OPTION_TAB_TYPES: Partial<Record<Tab, string[]>> = {
  onoalloc: ['no_allocation_reference'],
  odefer: ['defer_allocation_reference'],
  opartial: ['partial_allocation_reference', 'shared_allocation_reference', 'substitute_resource_reference'],
  ophased: ['phased_allocation_reference', 'conditional_allocation_reference'],
  oreversible: ['reversible_allocation_reference'],
  oreserve: ['reserve_capacity_reference', 'contingency_allocation_reference'],
};

export default function ResourceAllocationSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<ResourceIntelSummary>({});
  const [inventory, setInventory] = useState<ResourceInventoryRow[]>([]);
  const [demands, setDemands] = useState<ResourceDemandRow[]>([]);
  const [options, setOptions] = useState<AllocationOptionRow[]>([]);
  const [audit, setAudit] = useState<EnterpriseResourceEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [selRes, setSelRes] = useState('');
  const [selDemand, setSelDemand] = useState('');
  const [selOpt, setSelOpt] = useState('');
  const [domain, setDomain] = useState<string>('compute_capacity');
  const [resType, setResType] = useState<string>('compute_unit_reference');
  const [optionType, setOptionType] = useState<string>('phased_allocation_reference');
  const [envelopeType, setEnvelopeType] = useState<string>('operating_budget_reference');
  const [axisSel, setAxisSel] = useState<string>('budget_vs_capacity');
  const [recTypeSel, setRecTypeSel] = useState<string>('gather_more_evidence_candidate');
  const [resultSel, setResultSel] = useState<string>('insufficient_data');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, r, d, o, a] = await Promise.all([
        fetchResourceIntelSummary(), fetchResourceInventory(null, 200), fetchResourceDemands(null, 200),
        fetchAllocationOptions(null, 200), fetchEnterpriseResourceAudit(200),
      ]);
      setSummary(s); setInventory(r); setDemands(d); setOptions(o); setAudit(a);
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
  const invReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selRes) { if (!selRes) toast.error('Resource 선택 필수'); return; }
    void act(() => reviewResourceInventory(selRes, action, r, payload), ok);
  };
  const demandReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selDemand) { if (!selDemand) toast.error('Demand 선택 필수'); return; }
    void act(() => reviewResourceDemand(selDemand, action, r, payload), ok);
  };
  const allocReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selOpt) { if (!selOpt) toast.error('Option 선택 필수'); return; }
    void act(() => reviewAllocationOption(selOpt, action, r, payload), ok);
  };
  const resEvent = (kind: string, payload: Record<string, unknown>, ok: string, ids: { res?: boolean; demand?: boolean; opt?: boolean } = { opt: true }) => {
    const r = needReason();
    if (!r) return;
    void act(() => recordResourceEvent(kind, r, payload, ids.res ? (selRes || null) : null, ids.demand ? (selDemand || null) : null, ids.opt ? (selOpt || null) : null), ok);
  };

  const obj = useCallback((k: string): Record<string, unknown> => (typeof summary[k] === 'object' && summary[k] !== null && !Array.isArray(summary[k]) ? summary[k] as Record<string, unknown> : {}), [summary]);
  const num = useCallback((k: string, sub: string): number | null => {
    const v = obj(k)[sub];
    return typeof v === 'number' ? v : null;
  }, [obj]);

  const timeline = useMemo(() => buildResourceTimeline({ present: {
    resource_inventory: (num('inventory', 'total') ?? 0) > 0,
    availability: (num('resource_events', 'availability_reviews') ?? 0) > 0,
    capacity_review: (num('resource_events', 'human_capacity_reviews') ?? 0) + (num('resource_events', 'technical_capacity_reviews') ?? 0) > 0,
    financial_envelope: (num('resource_events', 'financial_envelopes') ?? 0) > 0,
    resource_demand: (num('demands', 'total') ?? 0) > 0,
    demand_forecast: (num('resource_events', 'demand_forecasts') ?? 0) > 0,
    conflict_review: (num('resource_events', 'conflict_reviews') ?? 0) > 0,
    gap_review: (num('resource_events', 'capacity_gap_reviews') ?? 0) + (num('resource_events', 'funding_gap_reviews') ?? 0) > 0,
    allocation_option: (num('allocation_options', 'total') ?? 0) > 0,
    human_allocation_review: (num('resource_events', 'allocation_reviews') ?? 0) > 0,
    approval_reference: (num('resource_events', 'allocation_approvals') ?? 0) > 0,
    outcome: (num('resource_events', 'outcome_links') ?? 0) > 0,
  } }), [num]);

  if (loading) return <AdminCard title="Resource Intelligence & Capital Allocation Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Resource Intelligence & Capital Allocation Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const resSelect = (
    <select value={selRes} onChange={(e) => setSelRes(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Resource 선택</option>
      {inventory.map((r) => <option key={r.id} value={r.id}>{r.resource_code} · {r.resource_status}</option>)}
    </select>
  );
  const demandSelect = (
    <select value={selDemand} onChange={(e) => setSelDemand(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Demand 선택</option>
      {demands.map((d) => <option key={d.id} value={d.id}>{d.demand_code} · {d.demand_status}</option>)}
    </select>
  );
  const optSelect = (
    <select value={selOpt} onChange={(e) => setSelOpt(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Option 선택</option>
      {options.map((o) => <option key={o.id} value={o.id}>{o.allocation_code} · {o.option_status}</option>)}
    </select>
  );
  const reasonInput = <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button disabled={busy} onClick={onClick} className={primary ? 'rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50' : 'rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50'}>{label}</button>
  );
  const tone = (s: string) => (s.includes('available') || s.includes('viable') || s.includes('ready') || s.includes('no_capacity_gap') || s.includes('no_funding_gap') || s.includes('no_material') || s.includes('healthy') || s.includes('high_reliability') || s.includes('current_reference') || s.includes('feasible_allocation') || s.includes('robust_allocation') || s.includes('high_efficiency') ? 'success' as const : s.includes('rejected') || s.includes('invalidated') || s.includes('blocked') || s.includes('exhausted') || s.includes('critical') || s.includes('severe') || s.includes('irreversible') || s.includes('overload') || s.includes('double_allocation') || s.includes('unavailable') || s === 'unsupported' ? 'danger' as const : 'warning' as const);
  const evByType = (t: string) => audit.filter((e) => e.event_type === t);
  const eventList = (rows: EnterpriseResourceEventRow[], emptyTitle: string, emptyDesc: string) => (
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
  const invList = (list: ResourceInventoryRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((r) => (
          <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(r.resource_status)}>{r.resource_status}</AdminBadge>
            <AdminBadge tone={tone(r.freshness_status)}>{r.freshness_status}</AdminBadge>
            <span className="ml-2 font-bold">{r.resource_code}</span>
            <span className="ml-2 text-muted-foreground">{r.resource_domain} · {r.resource_name} · total {NUM(r.total_capacity_candidate)} · avail {NUM(r.available_capacity_candidate)}{r.unit_type ? ` ${r.unit_type}` : ''}</span>
          </div>
        ))}
      </div>
    )
  );
  const demandList = (list: ResourceDemandRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((d) => (
          <div key={d.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(d.demand_status)}>{d.demand_status}</AdminBadge>
            <span className="ml-2 font-bold">{d.demand_code}</span>
            <span className="ml-2 text-muted-foreground">{d.resource_domain} · {d.demand_name} · required {NUM(d.required_quantity_candidate)}{d.unit_type ? ` ${d.unit_type}` : ''}</span>
          </div>
        ))}
      </div>
    )
  );
  const optList = (list: AllocationOptionRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((o) => (
          <div key={o.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(o.option_status)}>{o.option_status}</AdminBadge>
            <span className="ml-2 font-bold">{o.allocation_code}</span>
            <span className="ml-2 text-muted-foreground">{o.option_type} · {o.allocation_name} · demands {Array.isArray(o.resource_demand_references) ? o.resource_demand_references.length : 0}</span>
          </div>
        ))}
      </div>
    )
  );
  const resultEventTab = (kind: string, title: string, note: string, results: readonly string[], ids: { res?: boolean; demand?: boolean; opt?: boolean } = { opt: true }, extraPayload: Record<string, unknown> = {}) => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        {ids.res ? resSelect : null}{ids.demand ? demandSelect : null}{ids.opt ? optSelect : null}
        <select value={results.includes(resultSel) ? resultSel : results[0]} onChange={(e) => setResultSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
          {results.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {reasonInput}
        {btn(`${title} 기록`, () => resEvent(kind, { result: results.includes(resultSel) ? resultSel : results[0], ...extraPayload }, `${title} 기록됨`, ids), true)}
      </div>
      <AdminAlert tone="info" description={note} />
      {eventList(evByType(kind), `${title} 없음`, '사람 검토 기록이 여기에 표시됩니다.')}
    </div>
  );
  const capacityDomains = CAPACITY_TAB_DOMAINS[tab];
  const optionTabTypes = OPTION_TAB_TYPES[tab];

  return (
    <AdminCard
      title="Resource Intelligence & Capital Allocation Center"
      subtitle="Resource Inventory→Availability→Capacity→Financial Envelope→Initiative Demand→Forecast→Conflict→Gap→Allocation Option→Opportunity Cost→Efficiency→Trade-off→Capacity Plan→Human Resource/Finance Review→Approval Reference→Outcome→Quality/Drift/Learning — 최종 배정·집행은 반드시 사람"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 전략 포트폴리오가 요구하는 인력·예산·기술·운영·Connector·Provider·Storage·Compute Capacity 를 통합 분석해 제한된 자원을 어디에 우선 배분할지 사람이 검토할 수 있게 합니다. AI 는 자원 구조화·신뢰도 평가·수요 비교·충돌/병목 탐지·Gap 계산·배분 대안/Opportunity Cost 설명·Capacity Plan Candidate 생성까지만 수행하며, 실제 예산·자원·인력·Capacity 배정/비용 지출/투자 집행/Payment/Refund/Settlement/Contract/Pricing/직원 배치·채용·해고·보상/Provider 계약·변경/Connector 실행/Compute·Storage·Infrastructure 구매/Cloud Plan 변경/Capacity Scaling/Initiative 시작·중단/Rollout·Rollback/Alert·Email·Slack·Push/Deploy/Merge/Migration Apply 는 수행하지 않습니다. Inventory ≠ 자산 원장, Demand ≠ 예약, Option ≠ 배정, Approval Reference ≠ 집행, Budget Reference ≠ Cash. 예약되지 않은 자원을 Reserved 로, 배정되지 않은 예산을 Allocated 로, 구매되지 않은 Capacity 를 Provisioned 로 표시하지 않습니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Resource Inventory" value={NUM(num('inventory', 'total'))} />
            <Box label="Available / Committed / Reserved" value={`${NUM(num('inventory', 'available'))} / ${NUM(num('inventory', 'committed'))} / ${NUM(num('inventory', 'reserved'))}`} />
            <Box label="Bottleneck / Exhausted / Stale" value={`${NUM(num('inventory', 'bottleneck'))} / ${NUM(num('inventory', 'exhausted'))} / ${NUM(num('inventory', 'stale'))}`} />
            <Box label="Resource Demands" value={NUM(num('demands', 'total'))} />
            <Box label="Demand Ready / Blocked" value={`${NUM(num('demands', 'ready'))} / ${NUM(num('demands', 'blocked'))}`} />
            <Box label="Resource / Funding / Capacity Gap Demands" value={`${NUM(num('demands', 'resource_gap'))} / ${NUM(num('demands', 'funding_gap'))} / ${NUM(num('demands', 'capacity_gap'))}`} />
            <Box label="Allocation Options" value={NUM(num('allocation_options', 'total'))} />
            <Box label="Viable / Cond. Viable" value={`${NUM(num('allocation_options', 'viable'))} / ${NUM(num('allocation_options', 'conditionally_viable'))}`} />
            <Box label="Capacity / Funding / Workload Constrained" value={`${NUM(num('allocation_options', 'capacity_constrained'))} / ${NUM(num('allocation_options', 'funding_constrained'))} / ${NUM(num('allocation_options', 'workload_constrained'))}`} />
            <Box label="Approved / Rejected / Deferred" value={`${NUM(num('allocation_options', 'approved_references'))} / ${NUM(num('allocation_options', 'rejected'))} / ${NUM(num('allocation_options', 'deferred'))}`} />
            <Box label="Availability / Freshness / Reliability Reviews" value={`${NUM(num('resource_events', 'availability_reviews'))} / ${NUM(num('resource_events', 'freshness_reviews'))} / ${NUM(num('resource_events', 'reliability_reviews'))}`} />
            <Box label="Human / Technical Capacity Reviews" value={`${NUM(num('resource_events', 'human_capacity_reviews'))} / ${NUM(num('resource_events', 'technical_capacity_reviews'))}`} />
            <Box label="Financial Envelopes / Cash Flow" value={`${NUM(num('resource_events', 'financial_envelopes'))} / ${NUM(num('resource_events', 'cash_flow_references'))}`} />
            <Box label="Conflict / Overcommit / Underutil Reviews" value={`${NUM(num('resource_events', 'conflict_reviews'))} / ${NUM(num('resource_events', 'overcommitment_reviews'))} / ${NUM(num('resource_events', 'underutilization_reviews'))}`} />
            <Box label="Capacity / Funding / Workforce Gap Reviews" value={`${NUM(num('resource_events', 'capacity_gap_reviews'))} / ${NUM(num('resource_events', 'funding_gap_reviews'))} / ${NUM(num('resource_events', 'workforce_gap_reviews'))}`} />
            <Box label="Opportunity Cost / Efficiency Reviews" value={`${NUM(num('resource_events', 'opportunity_cost_reviews'))} / ${NUM(num('resource_events', 'efficiency_reviews'))}`} />
            <Box label="Trade-off / Robustness / Regret Reviews" value={`${NUM(num('resource_events', 'tradeoff_reviews'))} / ${NUM(num('resource_events', 'robustness_reviews'))} / ${NUM(num('resource_events', 'regret_reviews'))}`} />
            <Box label="Capacity Plans" value={NUM(num('resource_events', 'capacity_plans'))} />
            <Box label="Recommendation Candidates" value={NUM(num('resource_events', 'recommendations'))} />
            <Box label="Budget / Commitment Links" value={`${NUM(num('resource_events', 'budget_links'))} / ${NUM(num('resource_events', 'commitment_links'))}`} />
            <Box label="Outcome Links" value={NUM(num('resource_events', 'outcome_links'))} />
            <Box label="Quality / Resource / Allocation Drift" value={`${NUM(num('resource_events', 'quality_reviews'))} / ${NUM(num('resource_events', 'resource_drift_reviews'))} / ${NUM(num('resource_events', 'allocation_drift_reviews'))}`} />
            <Box label="Learning References" value={NUM(num('resource_events', 'learning_references'))} />
          </div>
          <AdminAlert tone="info" description={`resource_unavailable: ${Array.isArray(summary.resource_unavailable) ? (summary.resource_unavailable as unknown[]).map(String).join(', ') : '—'}. Resource 원천 실측 — Initiatives(0545) ${NUM(num('resource_actuals', 'strategic_initiatives_0545'))}건 · Portfolios(0545) ${NUM(num('resource_actuals', 'strategy_portfolios_0545'))}건 · Commitments(0520) ${NUM(num('resource_actuals', 'commitments_0520'))}건 · Capacity Snapshots(0508) ${NUM(num('resource_actuals', 'capacity_snapshots_0508'))}건 · Cost Snapshots(0508) ${NUM(num('resource_actuals', 'cost_snapshots_0508'))}건 · Connectors(0536) ${NUM(num('resource_actuals', 'connector_instances_0536'))}건 · Invoices ${NUM(num('resource_actuals', 'billing_invoices'))}건. 0 과 Unknown 을 혼동하지 않습니다.`} />
        </div>
      )}

      {tab === 'inbox' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="자원 대기함 — 검토 대기 Inventory/Demand/Allocation Option. 배분 우선순위는 사람이 판단합니다." />
          {invList(inventory.filter((r) => ['draft', 'pending_evidence', 'pending_review'].includes(r.resource_status)), '대기 Inventory 없음', '0건은 자원이 충분함을 의미하지 않습니다.')}
          {demandList(demands.filter((d) => ['draft', 'pending_evidence', 'pending_review'].includes(d.demand_status)), '대기 Demand 없음', '검토 대기 Demand 가 여기에 표시됩니다.')}
          {optList(options.filter((o) => ['draft', 'pending_evidence', 'pending_review'].includes(o.option_status)), '대기 Option 없음', '검토 대기 Allocation Option 이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'inventory' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <select value={domain} onChange={(e) => setDomain(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {RESOURCE_DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <select value={resType} onChange={(e) => setResType(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {RESOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Inventory 생성(≠ 자산 원장)', () => {
              const r = needReason();
              if (!r) return;
              void act(() => createResourceInventory({ resource_domain: domain, resource_type: resType, resource_name: r }), 'Inventory 생성됨(draft — 자동 배정 없음)');
            }, true)}
          </div>
          <AdminAlert tone="info" description="금지 도메인 19종 서버 차단 · Inventory ≠ Verified Physical Inventory/회계 장부." />
          {invList(inventory, 'Resource Inventory 없음', '핵심 질문 예: 실제 보유 자원은? 가용 vs Commitment 구분은? 오래된 데이터는? — 전부 Candidate 분석.')}
        </div>
      )}
      {tab === 'pendinginv' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {resSelect}{reasonInput}
            {btn('Evidence 요청', () => invReview('request_evidence', {}, 'pending_evidence'))}
            {btn('검토 시작', () => invReview('start_review', {}, 'pending_review'))}
            {btn('Available', () => invReview('mark_available', {}, 'available_candidate(보장 아님)'), true)}
            {btn('부분 Available', () => invReview('mark_partially_available', {}, 'partially_available_candidate'))}
            {btn('Committed Ref', () => invReview('mark_committed_reference', {}, 'committed_reference'))}
            {btn('Reserved(외부 Ref 필수)', () => invReview('mark_reserved_reference', { external_reservation_reference: reason.trim() }, 'reserved_reference'))}
            {btn('Constrained', () => invReview('mark_constrained', {}, 'constrained_candidate'))}
            {btn('Bottleneck', () => invReview('mark_bottleneck', {}, 'bottleneck_candidate'))}
            {btn('Exhausted', () => invReview('mark_exhausted', {}, 'exhausted_candidate'))}
            {btn('Unavailable', () => invReview('mark_unavailable', {}, 'unavailable_reference'))}
            {btn('Stale', () => invReview('mark_stale', {}, 'stale_candidate'))}
            {btn('무효화', () => invReview('invalidate', {}, '무효화'))}
          </div>
          <AdminAlert tone="info" description="외부 Reservation Reference 없는 reserved 기록 서버 차단 · available_candidate ≠ 사용 가능 보장 · 종결 재결정 차단." />
          {invList(inventory.filter((r) => ['pending_evidence', 'pending_review'].includes(r.resource_status)), 'Pending Inventory Review 없음', '검토 대기 Resource 가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'availability' && resultEventTab('resource_availability_reviewed', 'Availability 검토', 'Total/Utilization/Commitment/Reservation/Maintenance/Contract·Provider Limit 검토 — Availability Candidate ≠ Guaranteed Availability.', AVAILABILITY_RESULTS, { res: true })}
      {tab === 'freshness' && resultEventTab('resource_freshness_reviewed', 'Freshness 검토', '24시간 current / 7일 recent / 30일 stale / 초과 severely_stale — 오래된 데이터를 최신처럼 표시하지 않습니다.', FRESHNESS_RESULTS, { res: true })}
      {tab === 'reliability' && resultEventTab('resource_reliability_reviewed', 'Reliability 검토', 'Source/관측 빈도/완전성/중복·충돌 Source/수기 입력 여부 — Source 없으면 resource_source_unverified.', RELIABILITY_RESULTS, { res: true })}

      {capacityDomains != null && (
        <div className="space-y-2">
          {tab === 'chuman' || tab === 'creviewer' || tab === 'cspecialist' || tab === 'coperational'
            ? resultEventTab(tab === 'coperational' ? 'operational_capacity_reviewed' : 'human_capacity_reviewed', 'Capacity 검토', '가용 시간/기존 Commitment/승인 큐/Incident 부하 Proxy — 개인 생산성·성과·보상·채용·해고 판단에 사용하지 않습니다.', HUMAN_CAPACITY_RESULTS, { res: true })
            : resultEventTab('technical_capacity_reviewed', 'Capacity 검토', 'Peak/Forecast Utilization·Safety Margin·Provider/Contract Limit·단일 의존 — Compute/Storage Candidate ≠ Provisioned.', TECHNICAL_CAPACITY_RESULTS, { res: true })}
          {invList(inventory.filter((r) => capacityDomains.includes(r.resource_domain)), '해당 도메인 Resource 없음', 'Inventory 에 해당 도메인 자원을 생성하면 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'envelopes' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {resSelect}
            <select value={envelopeType} onChange={(e) => setEnvelopeType(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {FINANCIAL_ENVELOPE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Financial Envelope 기록', () => resEvent('financial_envelope_recorded', { envelope_type: envelopeType }, 'Envelope 기록됨(≠ 회계 장부)', { res: true }), true)}
          </div>
          <AdminAlert tone="info" description="14 유형(operating/strategic/initiative/contingency/infrastructure/staffing 등) — Financial Envelope ≠ 회계 장부/은행 잔액, Envelope Candidate ≠ Approved Budget." />
          {eventList(evByType('financial_envelope_recorded'), 'Financial Envelope 없음', '예산 봉투 Reference 가 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'cashflow' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {reasonInput}
            {btn('Cash Flow Reference 기록', () => resEvent('cash_flow_reference_recorded', { note: 'cash_flow_reference_only' }, 'Cash Flow Reference 기록됨(≠ Bank Balance)', {}), true)}
          </div>
          <AdminAlert tone="info" description="Cash Flow Reference ≠ Bank Balance — 근거 없으면 cash_flow_unverified." />
          {eventList(evByType('cash_flow_reference_recorded'), 'Cash Flow Reference 없음', '현금 흐름 참조가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'demands' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <select value={domain} onChange={(e) => setDomain(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {RESOURCE_DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            {reasonInput}
            {btn('Demand 생성(≠ 예약)', () => {
              const r = needReason();
              if (!r) return;
              void act(() => createResourceDemand({ resource_domain: domain, resource_type: resType, demand_name: r }), 'Demand 생성됨(draft — 예약/구매 요청 아님)');
            }, true)}
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {demandSelect}{reasonInput}
            {btn('Evidence 요청', () => demandReview('request_evidence', {}, 'pending_evidence'))}
            {btn('검토 시작', () => demandReview('start_review', {}, 'pending_review'))}
            {btn('Demand Ready(Evidence)', () => demandReview('mark_demand_ready', { evidence: [reason.trim()] }, 'demand_ready(예약 아님)'), true)}
            {btn('부분 정의', () => demandReview('mark_partially_defined', {}, 'partially_defined_candidate'))}
            {btn('Resource Gap', () => demandReview('mark_resource_gap', {}, 'resource_gap_candidate'))}
            {btn('Funding Gap', () => demandReview('mark_funding_gap', {}, 'funding_gap_candidate'))}
            {btn('Capacity Gap', () => demandReview('mark_capacity_gap', {}, 'capacity_gap_candidate'))}
            {btn('차단', () => demandReview('mark_blocked', {}, 'blocked_candidate'))}
            {btn('보류', () => demandReview('defer', {}, 'deferred_reference'))}
            {btn('무효화', () => demandReview('invalidate', {}, '무효화'))}
          </div>
          <AdminAlert tone="info" description="Initiative/Portfolio 실존 검증(0545) · minimum > required 차단 · 미실행 Demand 를 Active Usage 로 표시하지 않습니다." />
          {demandList(demands, 'Resource Demand 없음', 'Initiative 별 자원 수요를 정의해 비교합니다.')}
        </div>
      )}
      {tab === 'pendingdemand' && demandList(demands.filter((d) => ['pending_evidence', 'pending_review'].includes(d.demand_status)), 'Pending Demand Review 없음', '검토 대기 Demand 가 여기에 표시됩니다.')}
      {tab === 'demandforecast' && resultEventTab('demand_forecast_reviewed', 'Demand Forecast 검토', 'fixed/phased/rolling/growth·store·customer·workload·incident linked — Forecast ≠ Future Fact, Historical Usage ≠ Future Usage.', DEMAND_FORECAST_RESULTS, { demand: true })}
      {tab === 'conflicts' && resultEventTab('resource_conflict_reviewed', 'Resource Conflict 검토', '동일 자원/기간/수량 경쟁·공유 Capacity·Provider/Contract Limit — Conflict Candidate ≠ 자동 Demand 제거 근거.', RESOURCE_CONFLICT_RESULTS, { demand: true, opt: true })}
      {tab === 'overcommit' && resultEventTab('overcommitment_reviewed', 'Overcommitment 검토', 'Committed+Reserved+Planned vs Total·Safety Margin — Overcommitment Candidate ≠ Confirmed Failure.', OVERCOMMITMENT_RESULTS, { res: true })}
      {tab === 'underutil' && resultEventTab('underutilization_reviewed', 'Underutilization 검토', 'Strategic Reserve/Contingency/계약 최소치 고려 — Low Utilization 을 자동 낭비로 판정하지 않습니다.', UNDERUTILIZATION_RESULTS, { res: true })}
      {tab === 'capgaps' && resultEventTab('capacity_gap_reviewed', 'Capacity Gap 검토', 'Required vs Available·Safety Margin·Peak — Gap Candidate ≠ Confirmed Capacity Shortage.', CAPACITY_GAP_RESULTS)}
      {tab === 'fundgaps' && resultEventTab('funding_gap_reviewed', 'Funding Gap 검토', 'Required Funding vs Budget Reference·Contingency — Funding Gap ≠ 회계상 적자 확정.', FUNDING_GAP_RESULTS)}
      {tab === 'workgaps' && resultEventTab('workforce_gap_reviewed', 'Workforce Gap 검토', 'Specialist/Reviewer/Owner 부족 후보 — 자동 채용/배치 없음.', WORKFORCE_GAP_RESULTS)}

      {tab === 'options' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <select value={optionType} onChange={(e) => setOptionType(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {ALLOCATION_OPTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Allocation Option 생성(≠ 배정)', () => {
              const r = needReason();
              if (!r) return;
              void act(() => createAllocationOption({ option_type: optionType, allocation_name: r, resource_demand_references: demands.slice(0, 200).map((d) => d.id) }), 'Option 생성됨(draft — 예산/자원 배정 아님)');
            }, true)}
          </div>
          <AdminAlert tone="info" description="금지 Type 7종(direct_budget_execution/direct_resource_assignment 등) 서버 차단 · demand reference ≤ 200 · payload 64KB." />
          {optList(options, 'Allocation Option 없음', 'No/Defer/Partial/Conditional/Phased/Reversible/Shared/Reserve/Contingency 배분안을 비교합니다.')}
        </div>
      )}
      {tab === 'pendingalloc' && optList(options.filter((o) => ['pending_evidence', 'pending_review'].includes(o.option_status)), 'Pending Allocation Review 없음', '검토 대기 Option 이 여기에 표시됩니다.')}
      {optionTabTypes != null && (
        <div className="space-y-2">
          <AdminAlert tone="info" description={`${optionTabTypes.join(', ')} — Allocation Option ≠ Allocated Resource, 자동 선택 없음.`} />
          {optList(options.filter((o) => optionTabTypes.includes(o.option_type)), '해당 유형 Option 없음', '해당 유형 배분안이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'oppcost' && resultEventTab('opportunity_cost_reviewed', 'Opportunity Cost 검토', '선택되지 않은/지연된 Initiative 의 포기 가치 — Opportunity Cost Candidate ≠ 확정 손실.', OPPORTUNITY_COST_RESULTS)}
      {tab === 'efficiency' && resultEventTab('capital_efficiency_reviewed', 'Capital Efficiency 검토', 'Strategic/Financial/Capability Value vs Budget·Capacity·Workload — Capital Efficiency ≠ 회계 ROI.', CAPITAL_EFFICIENCY_RESULTS)}
      {tab === 'utilization' && resultEventTab('resource_utilization_reviewed', 'Utilization 검토', 'High Utilization ≠ Healthy · Low Utilization ≠ 낭비 — Headroom 과 함께 검토.', UTILIZATION_RESULTS, { res: true })}

      {tab === 'tradeoff' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {optSelect}
            <select value={axisSel} onChange={(e) => setAxisSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {ALLOCATION_TRADEOFF_AXES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={(ALLOCATION_TRADEOFF_RESULTS as readonly string[]).includes(resultSel) ? resultSel : ALLOCATION_TRADEOFF_RESULTS[0]} onChange={(e) => setResultSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {ALLOCATION_TRADEOFF_RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {reasonInput}
            {btn('Trade-off 기록', () => resEvent('allocation_tradeoff_reviewed', { axis: axisSel, result: (ALLOCATION_TRADEOFF_RESULTS as readonly string[]).includes(resultSel) ? resultSel : ALLOCATION_TRADEOFF_RESULTS[0] }, 'Trade-off 기록됨'), true)}
          </div>
          <AdminAlert tone="info" description="10개 축(단기 비용 vs 장기 Capability/budget vs capacity/reserve vs deployment 등) — 자동 점수로 배분안을 선택하지 않습니다." />
          {eventList(evByType('allocation_tradeoff_reviewed'), 'Allocation Trade-off 없음', '축별 트레이드오프 검토가 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'robustness' && resultEventTab('allocation_robustness_reviewed', 'Robustness 검토', 'Budget 20% 감소/Capacity 2배/Provider 장애 케이스 견고성 — Robust ≠ Correct Allocation.', ALLOCATION_ROBUSTNESS_RESULTS)}
      {tab === 'regret' && resultEventTab('allocation_regret_reviewed', 'Regret 검토', '최악 손실·기회비용·회수 불가 비용 — Lowest Regret ≠ Best Allocation.', ALLOCATION_REGRET_RESULTS)}
      {tab === 'reversibility' && resultEventTab('allocation_reversibility_reviewed', 'Reversibility 검토', '해제 가능성/Contract·Provider Lock-in/Sunk Cost — Reversible ≠ Guaranteed Recovery.', ALLOCATION_REVERSIBILITY_RESULTS)}
      {tab === 'feasibility' && resultEventTab('allocation_feasibility_reviewed', 'Feasibility 검토', 'Budget/Capacity/Reviewer/Policy — Feasibility ≠ Resource Reservation.', ALLOCATION_FEASIBILITY_RESULTS)}
      {tab === 'capplans' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {optSelect}{reasonInput}
            {btn('Capacity Plan 기록', () => resEvent('capacity_plan_recorded', { note: 'capacity_plan_candidate' }, 'Capacity Plan 기록됨(≠ Provisioning)'), true)}
          </div>
          <AdminAlert tone="info" description="Capacity Plan Candidate ≠ 실제 Provisioning/Scaling — 구매·확장은 사람이 별도 수행." />
          {eventList(evByType('capacity_plan_recorded'), 'Capacity Plan 없음', '용량 계획 후보가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'recommendations' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {optSelect}
            <select value={recTypeSel} onChange={(e) => setRecTypeSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {ALLOCATION_RECOMMENDATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Recommendation 기록(Evidence)', () => resEvent('allocation_recommendation_recorded', { recommendation_type: recTypeSel, evidence: [reason.trim()] }, 'Recommendation 기록됨(≠ Approval)'), true)}
          </div>
          <AdminAlert tone="info" description="34 유형 전부 Candidate — Evidence 필수(서버 거부) · 자동 배분/집행 없음 · Human Resource/Finance/Executive Review Required." />
          {eventList(evByType('allocation_recommendation_recorded'), 'Recommendation 없음', '배분 권고 후보가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'humanreviews' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {optSelect}{reasonInput}
            {btn('Review 시작', () => allocReview('start_review', {}, 'pending_review'))}
            {btn('Viable', () => allocReview('mark_viable', {}, 'viable_candidate(배분 아님)'))}
            {btn('조건부 Viable', () => allocReview('mark_conditionally_viable', {}, 'conditionally_viable_candidate'))}
            {btn('Capacity Constrained', () => allocReview('mark_capacity_constrained', {}, 'capacity_constrained_candidate'))}
            {btn('Funding Constrained', () => allocReview('mark_funding_constrained', {}, 'funding_constrained_candidate'))}
            {btn('Workload Constrained', () => allocReview('mark_workload_constrained', {}, 'workload_constrained_candidate'))}
            {btn('Approve Allocation Reference(Evidence)', () => allocReview('approve_allocation_reference', { evidence: [reason.trim()] }, 'approved(집행 아님)'), true)}
            {btn('조건부 Approve', () => allocReview('approve_with_conditions_reference', { evidence: [reason.trim()], conditions: [reason.trim()] }, 'approved(조건부 — 집행 아님)'))}
            {btn('Reject Reference', () => allocReview('reject_allocation_reference', {}, 'rejected_reference'))}
            {btn('Defer Reference', () => allocReview('defer_allocation_reference', {}, 'deferred_reference'))}
            {btn('수정 요청', () => allocReview('request_revision_reference', {}, 'pending_evidence'))}
            {btn('차단', () => allocReview('mark_blocked', {}, 'blocked_candidate'))}
            {btn('실행 불가', () => allocReview('mark_infeasible', {}, 'infeasible_candidate'))}
            {btn('무효화', () => allocReview('invalidate', {}, '무효화'))}
          </div>
          <AdminAlert tone="info" description="Approval Reference ≠ Budget Execution/Resource 배정(budget_allocated/resources_allocated/capacity_provisioned/production_applied 항상 false) · Self-Approval 서버 차단 · Evidence 없는 승인 거부." />
          {eventList(audit.filter((e) => ['human_allocation_review_started', 'allocation_approval_reference_recorded', 'allocation_rejection_reference_recorded', 'allocation_defer_reference_recorded', 'allocation_revision_requested'].includes(e.event_type)), 'Human Review 없음', '사람 Resource/Finance 검토 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'approved' && optList(options.filter((o) => o.approval_reference != null), 'Approved Allocation Reference 없음', 'approved 는 실제 예산 집행/자원 배정이 아닙니다(전부 false).')}
      {tab === 'rejected' && optList(options.filter((o) => o.option_status === 'rejected_reference'), 'Rejected Allocation Reference 없음', '거절 Reference 가 여기에 표시됩니다.')}
      {tab === 'deferred' && optList(options.filter((o) => o.option_status === 'deferred_reference'), 'Deferred Allocation Reference 없음', '보류 Reference 가 여기에 표시됩니다.')}

      {tab === 'budgetrefs' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {optSelect}{reasonInput}
            {btn('Budget Reference 연결', () => resEvent('budget_reference_linked', { note: 'budget_reference_only' }, 'Budget Reference 연결됨(≠ Cash)'), true)}
          </div>
          <AdminAlert tone="info" description="Budget Reference ≠ Available Cash — 근거 없으면 budget_unverified." />
          {eventList(evByType('budget_reference_linked'), 'Budget Reference 없음', '예산 참조가 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'commitrefs' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {resSelect}{reasonInput}
            {btn('Commitment Reference 연결', () => resEvent('commitment_reference_linked', { note: 'commitment_reference_only' }, 'Commitment 연결됨(자동 완료/변경 없음)', { res: true }), true)}
          </div>
          <AdminAlert tone="info" description="Commitment 실존 검증(0520) — 기존 Commitment 를 자동 변경/완료하지 않습니다." />
          {eventList(evByType('commitment_reference_linked'), 'Commitment Reference 없음', '커밋먼트 연결 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'decisionrefs' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {optSelect}{reasonInput}
            {btn('Decision Reference 연결', () => resEvent('decision_reference_linked', { note: 'decision_reference_only' }, 'Decision Reference 연결됨(≠ Execution)'))}
            {btn('Portfolio Reference 연결', () => resEvent('portfolio_reference_linked', { note: 'portfolio_reference_only' }, 'Portfolio Reference 연결됨'), true)}
          </div>
          <AdminAlert tone="info" description="0544 Decision Context/0545 Strategy Portfolio 실존 검증 — Reference ≠ 실행." />
          {eventList(audit.filter((e) => ['decision_reference_linked', 'portfolio_reference_linked'].includes(e.event_type)), 'Decision/Portfolio Reference 없음', '참조 연결 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'outcomes' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {optSelect}{reasonInput}
            {btn('Resource Outcome 연결', () => resEvent('resource_outcome_linked', { causality_status: 'causality_unverified' }, 'Outcome 연결됨(≠ Causality)'), true)}
          </div>
          <AdminAlert tone="info" description="Outcome Link ≠ Allocation Causality — 실제 Outcome 없으면 outcome_unverified 유지." />
          {eventList(evByType('resource_outcome_linked'), 'Resource Outcome 없음', '실측 결과 연결 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'quality' && resultEventTab('allocation_quality_reviewed', 'Allocation Quality 검토', 'Demand 충족/비용·Capacity Range/부작용 — Quality Candidate ≠ Verified Management Quality.', ALLOCATION_QUALITY_RESULTS)}
      {tab === 'resdrift' && resultEventTab('resource_drift_reviewed', 'Resource Drift 검토', 'Availability/Cost/Demand Drift — Resource Drift ≠ 자동 재배분 신호.', RESOURCE_DRIFT_RESULTS, { res: true, opt: true })}
      {tab === 'allocdrift' && resultEventTab('allocation_drift_reviewed', 'Allocation Drift 검토', '실사용 vs 계획 Drift — Allocation Drift ≠ Confirmed Misallocation.', ALLOCATION_DRIFT_RESULTS)}
      {tab === 'learning' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {optSelect}{reasonInput}
            {btn('Learning Reference 기록', () => resEvent('resource_learning_reference_recorded', { note: 'learning_reference_only' }, 'Learning 기록됨(자동 재배분 없음)'), true)}
          </div>
          <AdminAlert tone="info" description="어떤 Forecast/병목/수요 추정이 맞았는지 — Learning Reference ≠ 자동 재배분." />
          {eventList(evByType('resource_learning_reference_recorded'), 'Resource Learning 없음', '자원 학습 참조가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'timeline' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="단계별 기록 존재 여부 — 완료 주장이 아닙니다. Unknown 은 insufficient_data 로 유지합니다." />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {timeline.stages.map((s) => (
              <div key={s.stage} className="rounded-lg border border-border p-2">
                <p className="text-[10px] font-bold text-muted-foreground">{s.stage}</p>
                <p className="mt-0.5 text-sm font-black">{s.present ? 'recorded' : 'insufficient_data'}</p>
              </div>
            ))}
          </div>
          <AdminAlert tone="info" description={`기록된 단계 ${NUM(timeline.completedCount)} / ${timeline.stages.length} — Timeline ≠ Execution Log.`} />
        </div>
      )}

      {tab === 'audit' && (
        eventList(audit, 'Audit 없음', '47종 Resource 이벤트 전체 감사 로그입니다.')
      )}

      {tab === 'support' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="실측 구성요소(추측 없음) — available:false 는 이 코드베이스에 해당 구조가 없음을 의미합니다." />
          <div className="grid grid-cols-2 gap-1 md:grid-cols-3">
            {RESOURCE_COMPONENTS.map((c) => (
              <div key={c.key} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone={c.available ? 'success' : 'danger'}>{c.available ? 'available' : 'unavailable'}</AdminBadge>
                <span className="ml-2 font-bold">{c.key}</span>
              </div>
            ))}
          </div>
          <div className="space-y-1">
            {RESOURCE_SUPPORT_MATRIX.map((s) => (
              <div key={s.feature} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone={s.status === 'unsupported' ? 'danger' : s.status === 'fully_supported' ? 'success' : 'warning'}>{s.status}</AdminBadge>
                <span className="ml-2 font-bold">{s.feature}</span>
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
