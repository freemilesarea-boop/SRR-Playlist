/**
 * StrategyIntelligenceSection — Enterprise Strategy Intelligence, Strategic Portfolio &
 * Long-Horizon Planning Center (Phase AI-OPS-41).
 *
 * Vision Reference→Strategic Goal(계층/충돌)→Priority→Initiative→Dependency→
 * Portfolio(버전/Scenario)→Resource/Financial/Capacity/Workload Constraint→
 * Concentration/Diversification/Balance→Trade-off/Robustness/Regret→
 * Reversibility/Feasibility→Roadmap/Milestone/Critical Path→
 * Human Strategy Review→Approval Reference→Outcome→Quality/Drift→Learning→Audit.
 * Strategy Candidate ≠ Approved Strategy · Portfolio ≠ Selected Portfolio ·
 * Approval Reference ≠ 예산·자원 배분. 최종 전략 승인과 자원 배분은 반드시 사람.
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
  fetchStrategyIntelSummary, fetchStrategicGoals, createStrategicGoal, reviewStrategicGoal,
  fetchStrategicInitiatives, createStrategicInitiative, reviewStrategicInitiative,
  fetchStrategyPortfolios, createStrategyPortfolio, reviewStrategyPortfolio,
  recordStrategyEvent, fetchEnterpriseStrategyAudit,
  type StrategyIntelSummary, type StrategicGoalRow, type StrategicInitiativeRow,
  type StrategyPortfolioRow, type EnterpriseStrategyEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  STRATEGY_DOMAINS, STRATEGIC_GOAL_TYPES, STRATEGIC_INITIATIVE_TYPES, INITIATIVE_DEPENDENCY_TYPES,
  DEPENDENCY_RESULTS, PORTFOLIO_SCENARIO_TYPES, RESOURCE_DEMAND_RESULTS, FINANCIAL_CONSTRAINT_RESULTS,
  CAPACITY_CONSTRAINT_RESULTS, WORKLOAD_CONSTRAINT_RESULTS, CONCENTRATION_RESULTS,
  DIVERSIFICATION_RESULTS, PORTFOLIO_BALANCE_RESULTS, STRATEGIC_TRADEOFF_AXES,
  STRATEGIC_TRADEOFF_RESULTS, STRATEGIC_ROBUSTNESS_RESULTS, STRATEGIC_REGRET_RESULTS,
  STRATEGIC_REVERSIBILITY_RESULTS, STRATEGIC_FEASIBILITY_RESULTS, MILESTONE_STATUSES,
  CRITICAL_PATH_RESULTS, STRATEGY_RECOMMENDATION_TYPES, GOAL_CONFLICT_RESULTS,
  STRATEGIC_PRIORITY_RESULTS, STRATEGY_QUALITY_RESULTS, STRATEGY_DRIFT_RESULTS,
  PORTFOLIO_DRIFT_RESULTS, buildStrategyTimeline, STRATEGY_COMPONENTS, STRATEGY_SUPPORT_MATRIX,
} from '@/lib/strategyIntelligence';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'inbox' | 'visions' | 'goals' | 'hierarchy' | 'goaldeps' | 'goalconflicts'
  | 'pendinggoals' | 'priorities' | 'initiatives' | 'pendinginits' | 'viableinits' | 'blockedinits'
  | 'deferredinits' | 'initdeps' | 'initconflicts' | 'portfolios' | 'versions' | 'pendingpf'
  | 'scenarios' | 'sbase' | 'sgrowth' | 'sconservative' | 'sbudget' | 'scapacity'
  | 'resource' | 'financialcon' | 'capacitycon' | 'workloadcon' | 'providerdeps' | 'connectordeps'
  | 'contractcon' | 'securitycon' | 'privacycon' | 'compliancecon' | 'concentration' | 'diversification'
  | 'balance' | 'risk' | 'opportunity' | 'ifinancial' | 'icapacity' | 'ioperational' | 'icustomer'
  | 'istore' | 'iorg' | 'tradeoff' | 'robustness' | 'regret' | 'reversibility' | 'feasibility'
  | 'roadmaps' | 'sequence' | 'parallel' | 'criticalpath' | 'milestones' | 'recommendations'
  | 'humanreviews' | 'approved' | 'rejected' | 'deferred' | 'revisions' | 'decisionrefs' | 'commitrefs'
  | 'observation' | 'reviewtriggers' | 'outcomes' | 'quality' | 'drift' | 'pfdrift' | 'learning'
  | 'timeline' | 'audit' | 'support' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Overview', icon: Layers },
  { key: 'inbox', label: 'Strategy Inbox', icon: Inbox },
  { key: 'visions', label: 'Vision References', icon: BookOpen },
  { key: 'goals', label: 'Strategic Goals', icon: TrendingUp },
  { key: 'hierarchy', label: 'Goal Hierarchy', icon: GitBranch },
  { key: 'goaldeps', label: 'Goal Dependencies', icon: GitBranch },
  { key: 'goalconflicts', label: 'Goal Conflicts', icon: AlertTriangle },
  { key: 'pendinggoals', label: 'Pending Goal Review', icon: Scale },
  { key: 'priorities', label: 'Strategic Priorities', icon: ListOrdered },
  { key: 'initiatives', label: 'Strategic Initiatives', icon: ClipboardList },
  { key: 'pendinginits', label: 'Pending Initiative Review', icon: Scale },
  { key: 'viableinits', label: 'Viable Initiatives', icon: ClipboardList },
  { key: 'blockedinits', label: 'Blocked Initiatives', icon: AlertTriangle },
  { key: 'deferredinits', label: 'Deferred Initiatives', icon: History },
  { key: 'initdeps', label: 'Initiative Dependencies', icon: GitBranch },
  { key: 'initconflicts', label: 'Initiative Conflicts', icon: AlertTriangle },
  { key: 'portfolios', label: 'Strategic Portfolios', icon: Layers },
  { key: 'versions', label: 'Portfolio Versions', icon: History },
  { key: 'pendingpf', label: 'Pending Portfolio Review', icon: Scale },
  { key: 'scenarios', label: 'Portfolio Scenarios', icon: Search },
  { key: 'sbase', label: 'Base Portfolio', icon: Layers },
  { key: 'sgrowth', label: 'Growth Portfolio', icon: TrendingUp },
  { key: 'sconservative', label: 'Conservative Portfolio', icon: Shield },
  { key: 'sbudget', label: 'Budget-Constrained Portfolio', icon: DollarSign },
  { key: 'scapacity', label: 'Capacity-Constrained Portfolio', icon: Activity },
  { key: 'resource', label: 'Resource Demand', icon: Users },
  { key: 'financialcon', label: 'Financial Constraints', icon: DollarSign },
  { key: 'capacitycon', label: 'Capacity Constraints', icon: Activity },
  { key: 'workloadcon', label: 'Human Workload Constraints', icon: Users },
  { key: 'providerdeps', label: 'Provider Dependencies', icon: GitBranch },
  { key: 'connectordeps', label: 'Connector Dependencies', icon: GitBranch },
  { key: 'contractcon', label: 'Contract Constraints', icon: ClipboardList },
  { key: 'securitycon', label: 'Security Constraints', icon: Shield },
  { key: 'privacycon', label: 'Privacy Constraints', icon: Shield },
  { key: 'compliancecon', label: 'Compliance Constraints', icon: Shield },
  { key: 'concentration', label: 'Portfolio Concentration', icon: Gauge },
  { key: 'diversification', label: 'Portfolio Diversification', icon: Layers },
  { key: 'balance', label: 'Portfolio Balance', icon: Scale },
  { key: 'risk', label: 'Strategic Risk', icon: AlertTriangle },
  { key: 'opportunity', label: 'Strategic Opportunity', icon: Lightbulb },
  { key: 'ifinancial', label: 'Financial Impact', icon: DollarSign },
  { key: 'icapacity', label: 'Capacity Impact', icon: Activity },
  { key: 'ioperational', label: 'Operational Impact', icon: Activity },
  { key: 'icustomer', label: 'Customer Experience Impact', icon: Users },
  { key: 'istore', label: 'Store Operations Impact', icon: Users },
  { key: 'iorg', label: 'Organizational Impact', icon: Users },
  { key: 'tradeoff', label: 'Strategic Trade-offs', icon: Scale },
  { key: 'robustness', label: 'Strategic Robustness', icon: Gauge },
  { key: 'regret', label: 'Strategic Regret', icon: Scale },
  { key: 'reversibility', label: 'Strategic Reversibility', icon: RefreshCw },
  { key: 'feasibility', label: 'Strategic Feasibility', icon: Gauge },
  { key: 'roadmaps', label: 'Strategic Roadmaps', icon: ListOrdered },
  { key: 'sequence', label: 'Initiative Sequence', icon: ListOrdered },
  { key: 'parallel', label: 'Parallel Initiatives', icon: Layers },
  { key: 'criticalpath', label: 'Critical Path', icon: GitBranch },
  { key: 'milestones', label: 'Milestones', icon: ClipboardList },
  { key: 'recommendations', label: 'Recommendation Candidates', icon: Lightbulb },
  { key: 'humanreviews', label: 'Human Strategy Reviews', icon: Users },
  { key: 'approved', label: 'Approved Portfolio References', icon: Scale },
  { key: 'rejected', label: 'Rejected Portfolio References', icon: Scale },
  { key: 'deferred', label: 'Deferred Portfolio References', icon: History },
  { key: 'revisions', label: 'Revision Requests', icon: RefreshCw },
  { key: 'decisionrefs', label: 'Decision References', icon: ClipboardList },
  { key: 'commitrefs', label: 'Commitment References', icon: ClipboardList },
  { key: 'observation', label: 'Observation Plans', icon: Search },
  { key: 'reviewtriggers', label: 'Review Triggers', icon: TrendingUp },
  { key: 'outcomes', label: 'Strategic Outcomes', icon: Search },
  { key: 'quality', label: 'Strategy Quality', icon: Gauge },
  { key: 'drift', label: 'Strategy Drift', icon: Activity },
  { key: 'pfdrift', label: 'Portfolio Drift', icon: Activity },
  { key: 'learning', label: 'Strategy Learning', icon: Lightbulb },
  { key: 'timeline', label: 'Timeline', icon: History },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
  { key: 'limitations', label: 'Known Limitations', icon: ClipboardList },
];

const KNOWN_LIMITATIONS = [
  '자동 Strategy 확정/Portfolio 선택/예산·자원·인력 배정/Initiative 시작·중단 없음 — Approval Reference 의 budget_allocated/resources_allocated/production_applied 는 항상 false',
  '공식 Enterprise Vision 데이터셋 없음 — Vision 은 Reference 기록(0524 corporate vision 은 별도 계층·무변경)',
  '실제 Budget/Cash Flow 피드 없음 — Budget Reference ≠ Available Cash, Financial Impact 는 Estimate 중심',
  'Revenue Impact 는 Reference 중심 · Resource Availability/Human Workload 는 Proxy 중심(자원 예약 시스템 부재)',
  'Provider Dependency 피드 없음 — provider 관련 판정은 unverified 유지',
  'Contract/Settlement/Payment 영향은 Reference 중심 — 원문/원본 변경·조회 없음',
  'Initiative Dependency 는 Candidate 중심 · Critical Path 는 실제 프로젝트 일정 보장이 아님(PM 시스템 부재)',
  'Concentration ≠ 기업가치 위험 확정 · Diversification ≠ Resilience 보장 · Reversibility ≠ Exit 성공 보장',
  'Historical Strategic Outcome 표본 부족 가능 — Quality 는 Outcome 연결 후에만, Strategy Drift 는 장기 관찰 필요, Portfolio Drift ≠ 자동 재조정 신호',
  'Correlation ≠ Causality — Human Strategy Review 필수, 자동 Commitment 완료/Initiative 실행 없음',
  'Migration 0472~0545 production 미적용 — 운영 수치는 적용 후 축적됩니다',
];

const SCENARIO_TAB_TYPE: Partial<Record<Tab, string>> = {
  sbase: 'base_case_candidate', sgrowth: 'growth_case_candidate', sconservative: 'conservative_case_candidate',
  sbudget: 'budget_constrained_candidate', scapacity: 'capacity_constrained_candidate',
};
const IMPACT_TAB_FIELD: Partial<Record<Tab, { field: keyof StrategicInitiativeRow; label: string }>> = {
  ifinancial: { field: 'financial_impact', label: 'Financial Impact' },
  icapacity: { field: 'capacity_impact', label: 'Capacity Impact' },
  ioperational: { field: 'operational_impact', label: 'Operational Impact' },
  icustomer: { field: 'customer_experience_impact', label: 'Customer Experience Impact' },
  istore: { field: 'store_operations_impact', label: 'Store Operations Impact' },
  iorg: { field: 'organizational_impact', label: 'Organizational Impact' },
};
const DEP_LIST_TAB: Partial<Record<Tab, { field: keyof StrategicInitiativeRow; label: string; note: string }>> = {
  providerdeps: { field: 'provider_dependencies', label: 'Provider Dependency', note: 'Provider 의존 Candidate — 피드 부재로 unverified 유지, 단일 Provider 집중은 Concentration 탭에서 검토.' },
  connectordeps: { field: 'connector_dependencies', label: 'Connector Dependency', note: 'Connector 의존 Candidate — 실제 Connector 실행 없음.' },
  contractcon: { field: 'contract_dependencies', label: 'Contract Constraint', note: 'Contract 제약 Reference — 원문 조회/변경 없음(0383/0057 무변경).' },
  securitycon: { field: 'security_constraints', label: 'Security Constraint', note: 'Security 제약 Reference — 실제 보안 설정 변경 없음.' },
  privacycon: { field: 'privacy_constraints', label: 'Privacy Constraint', note: 'Privacy 제약 Reference — 개인정보 payload 서버 차단.' },
  compliancecon: { field: 'compliance_constraints', label: 'Compliance Constraint', note: 'Compliance 제약 Reference — 자동 준수 확정 없음.' },
};

export default function StrategyIntelligenceSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<StrategyIntelSummary>({});
  const [goals, setGoals] = useState<StrategicGoalRow[]>([]);
  const [inits, setInits] = useState<StrategicInitiativeRow[]>([]);
  const [pfs, setPfs] = useState<StrategyPortfolioRow[]>([]);
  const [audit, setAudit] = useState<EnterpriseStrategyEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [selGoal, setSelGoal] = useState('');
  const [selInit, setSelInit] = useState('');
  const [selPf, setSelPf] = useState('');
  const [domain, setDomain] = useState<string>('enterprise_growth');
  const [goalType, setGoalType] = useState<string>('growth_reference');
  const [initType, setInitType] = useState<string>('pilot_reference');
  const [scenarioType, setScenarioType] = useState<string>('base_case_candidate');
  const [depType, setDepType] = useState<string>('prerequisite');
  const [milestoneStatus, setMilestoneStatus] = useState<string>('planned_reference');
  const [axisSel, setAxisSel] = useState<string>('growth_vs_stability');
  const [recTypeSel, setRecTypeSel] = useState<string>('gather_strategy_evidence');
  const [resultSel, setResultSel] = useState<string>('insufficient_data');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, g, i, p, a] = await Promise.all([
        fetchStrategyIntelSummary(), fetchStrategicGoals(null, 200), fetchStrategicInitiatives(null, 200),
        fetchStrategyPortfolios(null, 200), fetchEnterpriseStrategyAudit(200),
      ]);
      setSummary(s); setGoals(g); setInits(i); setPfs(p); setAudit(a);
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
  const goalReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selGoal) { if (!selGoal) toast.error('Goal 선택 필수'); return; }
    void act(() => reviewStrategicGoal(selGoal, action, r, payload), ok);
  };
  const initReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selInit) { if (!selInit) toast.error('Initiative 선택 필수'); return; }
    void act(() => reviewStrategicInitiative(selInit, action, r, payload), ok);
  };
  const pfReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selPf) { if (!selPf) toast.error('Portfolio 선택 필수'); return; }
    void act(() => reviewStrategyPortfolio(selPf, action, r, payload), ok);
  };
  const stEvent = (kind: string, payload: Record<string, unknown>, ok: string, ids: { goal?: boolean; init?: boolean; pf?: boolean } = { pf: true }) => {
    const r = needReason();
    if (!r) return;
    void act(() => recordStrategyEvent(kind, r, payload, ids.goal ? (selGoal || null) : null, ids.init ? (selInit || null) : null, ids.pf ? (selPf || null) : null), ok);
  };

  const obj = useCallback((k: string): Record<string, unknown> => (typeof summary[k] === 'object' && summary[k] !== null && !Array.isArray(summary[k]) ? summary[k] as Record<string, unknown> : {}), [summary]);
  const num = useCallback((k: string, sub: string): number | null => {
    const v = obj(k)[sub];
    return typeof v === 'number' ? v : null;
  }, [obj]);

  const timeline = useMemo(() => buildStrategyTimeline({ present: {
    vision_reference: (num('strategy_events', 'vision_references') ?? 0) > 0,
    strategic_goal: (num('goals', 'total') ?? 0) > 0,
    goal_conflict: (num('strategy_events', 'goal_conflicts') ?? 0) > 0,
    strategic_initiative: (num('initiatives', 'total') ?? 0) > 0,
    initiative_dependency: (num('strategy_events', 'initiative_dependencies') ?? 0) > 0,
    strategy_portfolio: (num('portfolios', 'total') ?? 0) > 0,
    portfolio_scenario: (num('strategy_events', 'scenarios') ?? 0) > 0,
    constraint_review: (num('strategy_events', 'financial_reviews') ?? 0) + (num('strategy_events', 'capacity_reviews') ?? 0) > 0,
    roadmap: (num('strategy_events', 'roadmaps') ?? 0) > 0,
    human_strategy_review: (num('strategy_events', 'strategy_reviews') ?? 0) > 0,
    approval_reference: (num('strategy_events', 'portfolio_approvals') ?? 0) > 0,
    outcome: (num('strategy_events', 'outcome_links') ?? 0) > 0,
  } }), [num]);

  if (loading) return <AdminCard title="Strategy Intelligence & Strategic Portfolio Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Strategy Intelligence & Strategic Portfolio Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const goalSelect = (
    <select value={selGoal} onChange={(e) => setSelGoal(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Goal 선택</option>
      {goals.map((g) => <option key={g.id} value={g.id}>{g.goal_code} · L{g.goal_level} · {g.goal_status}</option>)}
    </select>
  );
  const initSelect = (
    <select value={selInit} onChange={(e) => setSelInit(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Initiative 선택</option>
      {inits.map((i) => <option key={i.id} value={i.id}>{i.initiative_code} · {i.initiative_status}</option>)}
    </select>
  );
  const pfSelect = (
    <select value={selPf} onChange={(e) => setSelPf(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Portfolio 선택</option>
      {pfs.map((p) => <option key={p.id} value={p.id}>{p.portfolio_code} v{p.portfolio_version} · {p.portfolio_status}</option>)}
    </select>
  );
  const reasonInput = <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button disabled={busy} onClick={onClick} className={primary ? 'rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50' : 'rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50'}>{label}</button>
  );
  const tone = (s: string) => (s.includes('approved') || s.includes('viable') || s.includes('ready') || s.includes('achieved') || s.includes('feasible_portfolio') || s.includes('robust_portfolio') || s.includes('within_budget') || s.includes('available') || s.includes('diversified_candidate') || s.includes('balanced') ? 'success' as const : s.includes('rejected') || s.includes('invalidated') || s.includes('blocked') || s.includes('exceeded') || s.includes('exhaustion') || s.includes('critical') || s.includes('irreversible') || s.includes('overload') || s.includes('unavailable') || s === 'unsupported' ? 'danger' as const : 'warning' as const);
  const evByType = (t: string) => audit.filter((e) => e.event_type === t);
  const eventList = (rows: EnterpriseStrategyEventRow[], emptyTitle: string, emptyDesc: string) => (
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
  const goalList = (list: StrategicGoalRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((g) => (
          <div key={g.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(g.goal_status)}>{g.goal_status}</AdminBadge>
            <AdminBadge tone={tone(g.priority_candidate)}>{g.priority_candidate}</AdminBadge>
            <span className="ml-2 font-bold">{g.goal_code} · L{g.goal_level}</span>
            <span className="ml-2 text-muted-foreground">{g.strategy_domain} · {g.goal_type} · {g.goal_name}</span>
          </div>
        ))}
      </div>
    )
  );
  const initList = (list: StrategicInitiativeRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((i) => (
          <div key={i.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(i.initiative_status)}>{i.initiative_status}</AdminBadge>
            <span className="ml-2 font-bold">{i.initiative_code}</span>
            <span className="ml-2 text-muted-foreground">{i.initiative_type} · {i.initiative_name}{i.sequence_candidate != null ? ` · seq ${i.sequence_candidate}` : ''}{i.parallel_group_candidate ? ` · group ${i.parallel_group_candidate}` : ''}</span>
          </div>
        ))}
      </div>
    )
  );
  const pfList = (list: StrategyPortfolioRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((p) => (
          <div key={p.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(p.portfolio_status)}>{p.portfolio_status}</AdminBadge>
            <span className="ml-2 font-bold">{p.portfolio_code} v{p.portfolio_version}</span>
            <span className="ml-2 text-muted-foreground">{p.portfolio_name} · initiatives {Array.isArray(p.initiative_references) ? p.initiative_references.length : 0} · scenarios {Array.isArray(p.portfolio_scenarios) ? p.portfolio_scenarios.length : 0}</span>
          </div>
        ))}
      </div>
    )
  );
  const resultEventTab = (kind: string, title: string, note: string, results: readonly string[], ids: { goal?: boolean; init?: boolean; pf?: boolean } = { pf: true }, extraPayload: Record<string, unknown> = {}, filter?: (e: EnterpriseStrategyEventRow) => boolean) => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        {ids.goal ? goalSelect : null}{ids.init ? initSelect : null}{ids.pf ? pfSelect : null}
        <select value={results.includes(resultSel) ? resultSel : results[0]} onChange={(e) => setResultSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
          {results.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {reasonInput}
        {btn(`${title} 기록`, () => stEvent(kind, { result: results.includes(resultSel) ? resultSel : results[0], ...extraPayload }, `${title} 기록됨`, ids), true)}
      </div>
      <AdminAlert tone="info" description={note} />
      {eventList(filter ? evByType(kind).filter(filter) : evByType(kind), `${title} 없음`, '사람 검토 기록이 여기에 표시됩니다.')}
    </div>
  );
  const scenarioTabType = SCENARIO_TAB_TYPE[tab];
  const impactField = IMPACT_TAB_FIELD[tab];
  const depListTab = DEP_LIST_TAB[tab];

  return (
    <AdminCard
      title="Strategy Intelligence & Strategic Portfolio Center"
      subtitle="Vision Reference→Strategic Goal→Priority→Initiative→Dependency→Portfolio(버전/Scenario)→Constraint→Concentration/Balance→Trade-off/Robustness/Regret→Roadmap/Critical Path→Human Strategy Review→Approval Reference→Outcome→Quality/Drift/Learning — 최종 전략 승인·자원 배분은 반드시 사람"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 여러 목표·프로젝트·의사결정·자원을 하나의 전략 포트폴리오로 통합해 장기 우선순위와 실행 순서를 사람이 검토할 수 있게 합니다. AI 는 목표 구조화·충돌 탐지·Initiative 정리·의존성 분석·Scenario 생성·우선순위/Roadmap Candidate 생성까지만 수행하며, 실제 Strategy 확정/Portfolio 자동 선택/Goal 변경/Initiative 시작·중단/예산·비용·투자·자원·인력 배분/채용·해고·보상/Contract·Payment·Refund·Settlement·Pricing/Capacity·Infrastructure·Provider 변경/Policy 적용/Rollout·Rollback/Alert·Email·Slack·Push 발송/Deploy/Merge/Migration Apply 는 수행하지 않습니다. Strategy Candidate ≠ Approved Strategy, Portfolio Candidate ≠ Selected Portfolio, Roadmap Candidate ≠ Execution Schedule, Approval Reference ≠ Resource Allocation. 실행하지 않은 Initiative 를 Active 로, 배정되지 않은 예산을 Allocated 로 표시하지 않습니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Vision References" value={NUM(num('strategy_events', 'vision_references'))} />
            <Box label="Strategic Goals" value={NUM(num('goals', 'total'))} />
            <Box label="Pending Goal Review" value={NUM(num('goals', 'pending_review'))} />
            <Box label="Critical Goal Candidates" value={NUM(num('goals', 'critical_priority'))} />
            <Box label="Goal Conflicts" value={NUM(num('strategy_events', 'goal_conflicts'))} />
            <Box label="Strategic Initiatives" value={NUM(num('initiatives', 'total'))} />
            <Box label="Pending Initiative Review" value={NUM(num('initiatives', 'pending_review'))} />
            <Box label="Viable / Blocked / Deferred" value={`${NUM(num('initiatives', 'viable'))} / ${NUM(num('initiatives', 'blocked'))} / ${NUM(num('initiatives', 'deferred'))}`} />
            <Box label="Initiative Dependencies" value={NUM(num('strategy_events', 'initiative_dependencies'))} />
            <Box label="Strategy Portfolios" value={NUM(num('portfolios', 'total'))} />
            <Box label="Pending Portfolio Review" value={NUM(num('portfolios', 'pending_review'))} />
            <Box label="Max Portfolio Version" value={NUM(num('portfolios', 'max_version'))} />
            <Box label="Portfolio Scenarios" value={NUM(num('strategy_events', 'scenarios'))} />
            <Box label="Resource / Financial Reviews" value={`${NUM(num('strategy_events', 'resource_reviews'))} / ${NUM(num('strategy_events', 'financial_reviews'))}`} />
            <Box label="Capacity / Workload Reviews" value={`${NUM(num('strategy_events', 'capacity_reviews'))} / ${NUM(num('strategy_events', 'workload_reviews'))}`} />
            <Box label="Concentration / Diversification" value={`${NUM(num('strategy_events', 'concentration_reviews'))} / ${NUM(num('strategy_events', 'diversification_reviews'))}`} />
            <Box label="Balance Reviews" value={NUM(num('strategy_events', 'balance_reviews'))} />
            <Box label="Trade-off / Robustness / Regret" value={`${NUM(num('strategy_events', 'tradeoff_reviews'))} / ${NUM(num('strategy_events', 'robustness_reviews'))} / ${NUM(num('strategy_events', 'regret_reviews'))}`} />
            <Box label="Reversibility / Feasibility" value={`${NUM(num('strategy_events', 'reversibility_reviews'))} / ${NUM(num('strategy_events', 'feasibility_reviews'))}`} />
            <Box label="Roadmaps / Milestones" value={`${NUM(num('strategy_events', 'roadmaps'))} / ${NUM(num('strategy_events', 'milestones'))}`} />
            <Box label="Critical Path Reviews" value={NUM(num('strategy_events', 'critical_paths'))} />
            <Box label="Recommendation Candidates" value={NUM(num('strategy_events', 'recommendations'))} />
            <Box label="Approved / Rejected / Deferred PF" value={`${NUM(num('portfolios', 'approved_references'))} / ${NUM(num('portfolios', 'rejected_references'))} / ${NUM(num('portfolios', 'deferred_references'))}`} />
            <Box label="Revision Requests" value={NUM(num('portfolios', 'revision_requested'))} />
            <Box label="Outcome Links" value={NUM(num('strategy_events', 'outcome_links'))} />
            <Box label="Quality / Drift / PF Drift" value={`${NUM(num('strategy_events', 'quality_reviews'))} / ${NUM(num('strategy_events', 'drift_reviews'))} / ${NUM(num('strategy_events', 'portfolio_drift_reviews'))}`} />
            <Box label="Learning References" value={NUM(num('strategy_events', 'learning_references'))} />
          </div>
          <AdminAlert tone="info" description={`strategy_unavailable: ${Array.isArray(summary.strategy_unavailable) ? (summary.strategy_unavailable as unknown[]).map(String).join(', ') : '—'}. Strategy 원천 실측 — Decision Contexts(0544) ${NUM(num('strategy_actuals', 'decision_contexts_0544'))}건 · Commitments(0520) ${NUM(num('strategy_actuals', 'commitments_0520'))}건 · Scenario Runs(0542) ${NUM(num('strategy_actuals', 'scenario_runs_0542'))}건 · Forecast Runs(0543) ${NUM(num('strategy_actuals', 'forecast_runs_0543'))}건 · Corporate Visions(0524) ${NUM(num('strategy_actuals', 'corporate_visions_0524'))}건 · Enterprise Contracts(0383) ${NUM(num('strategy_actuals', 'enterprise_contracts_0383'))}건. 0 과 Unknown 을 혼동하지 않습니다.`} />
        </div>
      )}

      {tab === 'inbox' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="전략 대기함 — 검토 대기 Goal/Initiative/Portfolio. 지금 반드시 결정해야 할 전략 사안을 사람이 판단합니다." />
          {goalList(goals.filter((g) => ['draft', 'pending_evidence', 'pending_review'].includes(g.goal_status)), '대기 Goal 없음', '0건은 전략 사안이 없음을 의미하지 않습니다.')}
          {initList(inits.filter((i) => ['draft', 'pending_evidence', 'pending_review'].includes(i.initiative_status)), '대기 Initiative 없음', '검토 대기 Initiative 가 여기에 표시됩니다.')}
          {pfList(pfs.filter((p) => ['draft', 'pending_evidence', 'pending_review', 'ready_for_strategy_review_reference', 'under_strategy_review', 'revision_requested'].includes(p.portfolio_status)), '대기 Portfolio 없음', '검토 대기 Portfolio 가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'visions' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {reasonInput}
            {btn('Vision Reference 기록', () => stEvent('vision_reference_recorded', { vision_title: reason.trim() }, 'Vision Reference 기록됨(공식 Vision 확정 아님)', {}), true)}
          </div>
          <AdminAlert tone="info" description="Vision Reference ≠ 법적·공식 Corporate Vision 확정 — 전략 원칙/비타협 제약의 Reference 기록." />
          {eventList(evByType('vision_reference_recorded'), 'Vision Reference 없음', '장기 비전 참조가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'goals' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <select value={domain} onChange={(e) => setDomain(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {STRATEGY_DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <select value={goalType} onChange={(e) => setGoalType(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {STRATEGIC_GOAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {goalSelect}
            {reasonInput}
            {btn('Goal 생성(≠ 성과 보장)', () => {
              const r = needReason();
              if (!r) return;
              void act(() => createStrategicGoal({ strategy_domain: domain, goal_type: goalType, goal_name: r, parent_goal_id: selGoal || null }), 'Goal 생성됨(draft — 선택된 Goal 이 있으면 하위 Goal)');
            }, true)}
          </div>
          <AdminAlert tone="info" description="금지 도메인 16종 서버 차단 · depth ≤ 6 · 최대 200 · Goal ≠ Guaranteed Outcome." />
          {goalList(goals, 'Strategic Goal 없음', '핵심 질문 예: 장기 목표는? 충돌/중복은? 지금 추진할 것은? — 전부 Candidate 분석.')}
        </div>
      )}

      {tab === 'hierarchy' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Goal 계층(레벨 1~6) — Circular/Self Parent 서버 차단. 계층 ≠ 실행 조직도." />
          {[1, 2, 3, 4, 5, 6].map((lv) => {
            const lvGoals = goals.filter((g) => g.goal_level === lv);
            return lvGoals.length ? (
              <div key={lv}>
                <p className="mb-1 text-[10px] font-bold text-muted-foreground">Level {lv}</p>
                {goalList(lvGoals, '', '')}
              </div>
            ) : null;
          })}
          {!goals.length ? <AdminEmpty title="Goal Hierarchy 없음" description="Goal 생성 시 부모 Goal 을 선택하면 하위 레벨로 배치됩니다." /> : null}
        </div>
      )}

      {tab === 'goaldeps' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {goalSelect}{reasonInput}
            {btn('Goal Dependency 기록', () => stEvent('goal_dependency_recorded', { note: 'dependency_candidate' }, 'Goal Dependency 기록됨(Confirmed 아님)', { goal: true }), true)}
          </div>
          <AdminAlert tone="info" description="Goal 간 의존 Candidate — Dependency Candidate ≠ Confirmed Dependency." />
          {eventList(evByType('goal_dependency_recorded'), 'Goal Dependency 없음', '목표 간 의존 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'goalconflicts' && resultEventTab('goal_conflict_reviewed', 'Goal Conflict 검토', '자원/예산/KPI/Timeline/Policy 충돌 — Conflict Candidate ≠ 자동 Goal 제거 근거.', GOAL_CONFLICT_RESULTS, { goal: true })}
      {tab === 'pendinggoals' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {goalSelect}{reasonInput}
            {btn('Evidence 요청', () => goalReview('request_evidence', {}, 'pending_evidence'))}
            {btn('검토 시작', () => goalReview('start_review', {}, 'pending_review'))}
            {btn('검토 완료', () => goalReview('mark_reviewed', {}, 'reviewed_reference'))}
            {btn('Strategy 승인(Evidence)', () => goalReview('approve_strategy', { evidence: [reason.trim()] }, 'approved(예산 배분 아님)'), true)}
            {btn('Active Reference', () => goalReview('mark_active_reference', {}, 'active_reference(실행 상태 아님)'))}
            {btn('일시중지', () => goalReview('pause', {}, 'paused_reference'))}
            {btn('보류', () => goalReview('defer', {}, 'deferred_reference'))}
            {btn('At Risk', () => goalReview('mark_at_risk', {}, 'at_risk_candidate'))}
            {btn('차단', () => goalReview('mark_blocked', {}, 'blocked_candidate'))}
            {btn('달성(Evidence)', () => goalReview('mark_achieved', { evidence: [reason.trim()] }, 'achieved_reference'))}
            {btn('미달성', () => goalReview('mark_not_achieved', {}, 'not_achieved_reference'))}
            {btn('무효화', () => goalReview('invalidate', {}, '무효화'))}
          </div>
          <AdminAlert tone="info" description="Evidence 없는 승인/achieved 서버 거부 · active_reference ≠ 실제 Initiative 실행 상태 · 종결 재결정 차단." />
          {goalList(goals.filter((g) => ['pending_evidence', 'pending_review'].includes(g.goal_status)), 'Pending Goal Review 없음', '검토 대기 Goal 이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'priorities' && resultEventTab('strategic_priority_reviewed', 'Strategic Priority 검토', 'Value/Risk Reduction/Cost of Delay/Portfolio Balance 기반 — Priority Candidate ≠ Final Priority, 자동 정렬/승인 없음.', STRATEGIC_PRIORITY_RESULTS, { goal: true })}

      {tab === 'initiatives' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <select value={initType} onChange={(e) => setInitType(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {STRATEGIC_INITIATIVE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={domain} onChange={(e) => setDomain(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {STRATEGY_DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            {reasonInput}
            {btn('Initiative 생성(≠ 실행)', () => {
              const r = needReason();
              if (!r) return;
              void act(() => createStrategicInitiative({ initiative_type: initType, strategy_domain: domain, initiative_name: r }), 'Initiative 생성됨(draft — 프로젝트 시작 아님)');
            }, true)}
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {initSelect}{reasonInput}
            {btn('Evidence 요청', () => initReview('request_evidence', {}, 'pending_evidence'))}
            {btn('검토 시작', () => initReview('start_review', {}, 'pending_review'))}
            {btn('Viable', () => initReview('mark_viable', {}, 'viable_candidate'), true)}
            {btn('조건부 Viable', () => initReview('mark_conditionally_viable', {}, 'conditionally_viable_candidate'))}
            {btn('Strategy 승인(Evidence)', () => initReview('approve_strategy', { evidence: [reason.trim()] }, 'approved(시작 아님)'))}
            {btn('Planned', () => initReview('mark_planned', {}, 'planned_reference'))}
            {btn('일시중지', () => initReview('pause', {}, 'paused_reference'))}
            {btn('보류', () => initReview('defer', {}, 'deferred_reference'))}
            {btn('At Risk', () => initReview('mark_at_risk', {}, 'at_risk_candidate'))}
            {btn('차단', () => initReview('mark_blocked', {}, 'blocked_candidate'))}
            {btn('중단 Reference', () => initReview('stop_reference', {}, 'stopped_reference'))}
            {btn('기각', () => initReview('reject', {}, 'rejected_reference'))}
            {btn('무효화', () => initReview('invalidate', {}, '무효화'))}
          </div>
          <AdminAlert tone="info" description="금지 Type 8종 서버 차단 · completed 는 Evidence+외부 실행 Reference 필수(미실행 completed 차단) · 최대 200 · dependency ≤ 500." />
          {initList(inits, 'Strategic Initiative 없음', 'Research/Pilot/Phased Program/Capability Building 등 — 전부 Reference 계층.')}
        </div>
      )}
      {tab === 'pendinginits' && initList(inits.filter((i) => ['pending_evidence', 'pending_review'].includes(i.initiative_status)), 'Pending Initiative Review 없음', '검토 대기 Initiative 가 여기에 표시됩니다.')}
      {tab === 'viableinits' && initList(inits.filter((i) => ['viable_candidate', 'conditionally_viable_candidate'].includes(i.initiative_status)), 'Viable Initiative 없음', 'Viable Candidate ≠ 실행 — 사람 승인 대기.')}
      {tab === 'blockedinits' && initList(inits.filter((i) => i.initiative_status === 'blocked_candidate'), 'Blocked Initiative 없음', '차단 후보가 여기에 표시됩니다.')}
      {tab === 'deferredinits' && initList(inits.filter((i) => ['deferred_reference', 'paused_reference'].includes(i.initiative_status)), 'Deferred Initiative 없음', '보류/일시중지 Initiative 가 여기에 표시됩니다.')}

      {tab === 'initdeps' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {initSelect}
            <select value={depType} onChange={(e) => setDepType(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {INITIATIVE_DEPENDENCY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Dependency 기록', () => stEvent('initiative_dependency_recorded', { dependency_type: depType }, 'Dependency 기록됨(Confirmed 아님)', { init: true }), true)}
          </div>
          {resultEventTab('initiative_dependency_reviewed', 'Dependency 검토', 'Circular/Self Dependency 는 순수 로직에서 탐지 — Dependency Candidate ≠ Confirmed Dependency.', DEPENDENCY_RESULTS, { init: true })}
        </div>
      )}
      {tab === 'initconflicts' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Initiative 충돌 — dependency 검토에서 conflict/blocked 판정된 기록. Conflict ≠ 자동 제거." />
          {eventList(evByType('initiative_dependency_reviewed').filter((e) => ['dependency_conflict_candidate', 'dependency_blocked_candidate', 'circular_dependency_candidate'].includes(String(e.payload?.result ?? ''))), 'Initiative Conflict 없음', '충돌 판정 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'portfolios' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {reasonInput}
            {btn('Portfolio 생성(≠ 배분)', () => {
              const r = needReason();
              if (!r) return;
              void act(() => createStrategyPortfolio({ portfolio_name: r, initiative_references: inits.slice(0, 100).map((i) => i.id) }), 'Portfolio 생성됨(draft — 예산·자원 배분 아님)');
            }, true)}
            {btn('새 버전 생성', () => {
              const r = needReason();
              if (!r || !selPf) { if (!selPf) toast.error('이전 Portfolio 선택 필수'); return; }
              void act(() => createStrategyPortfolio({ portfolio_name: r, previous_portfolio_id: selPf }), '새 버전 생성됨(이전 버전 superseded — 결과 보존)');
            })}
          </div>
          <AdminAlert tone="info" description="Initiative ≤ 100 · Scenario ≤ 20 · Milestone ≤ 200 · payload 64KB — Portfolio ≠ Selected Portfolio." />
          {pfList(pfs, 'Strategy Portfolio 없음', '여러 Goal/Initiative 를 하나의 포트폴리오로 묶어 사람이 비교합니다.')}
        </div>
      )}
      {tab === 'versions' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="버전 이력 — 이전 Portfolio 결과를 덮어쓰지 않고 superseded 로 보존합니다." />
          {pfList([...pfs].sort((a, b) => b.portfolio_version - a.portfolio_version), 'Portfolio Version 없음', '버전이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'pendingpf' && pfList(pfs.filter((p) => ['ready_for_strategy_review_reference', 'under_strategy_review'].includes(p.portfolio_status)), 'Pending Portfolio Review 없음', '전략 검토 대기 Portfolio 가 여기에 표시됩니다.')}

      {tab === 'scenarios' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {pfSelect}
            <select value={scenarioType} onChange={(e) => setScenarioType(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {PORTFOLIO_SCENARIO_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Scenario 기록(≠ Reality)', () => stEvent('portfolio_scenario_recorded', { scenario_type: scenarioType }, 'Scenario 기록됨(Portfolio Scenario ≠ Reality)'), true)}
          </div>
          <AdminAlert tone="info" description="16 유형(base/growth/conservative/budget·capacity·workforce constrained/provider·connector failure 등) — Scenario ≠ Reality, Forecast ≠ Future Fact." />
          {eventList(evByType('portfolio_scenario_recorded'), 'Portfolio Scenario 없음', '전략 시나리오 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {scenarioTabType != null && (
        <div className="space-y-2">
          <AdminAlert tone="info" description={`${scenarioTabType} — Portfolio Scenario ≠ Reality. 자동 선택 없음.`} />
          {eventList(evByType('portfolio_scenario_recorded').filter((e) => String(e.payload?.scenario_type ?? '') === scenarioTabType), `${scenarioTabType} 없음`, '해당 유형 시나리오가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'resource' && resultEventTab('resource_demand_reviewed', 'Resource Demand 검토', 'Human/Technical/Reviewer/Connector/Compute/Financial/Time — Resource Demand ≠ Reserved Resource.', RESOURCE_DEMAND_RESULTS)}
      {tab === 'financialcon' && resultEventTab('financial_constraint_reviewed', 'Financial Constraint 검토', 'Budget Reference ≠ Available Cash — Cost Estimate ≠ Actual Cost(회계 피드 부재).', FINANCIAL_CONSTRAINT_RESULTS)}
      {tab === 'capacitycon' && resultEventTab('capacity_constraint_reviewed', 'Capacity Constraint 검토', 'Capacity Estimate ≠ Capacity Guarantee — Initiative 동시 추진 한계 검토.', CAPACITY_CONSTRAINT_RESULTS)}
      {tab === 'workloadcon' && resultEventTab('workload_constraint_reviewed', 'Workload Constraint 검토', 'Reviewer/Specialist/Owner 가용성 Proxy — 자동 인사 배치/평가 없음.', WORKLOAD_CONSTRAINT_RESULTS)}

      {depListTab != null && (
        <div className="space-y-2">
          <AdminAlert tone="info" description={depListTab.note} />
          {!inits.filter((i) => Array.isArray(i[depListTab.field]) && (i[depListTab.field] as unknown[]).length > 0).length
            ? <AdminEmpty title={`${depListTab.label} 없음`} description="Initiative 생성 시 해당 의존/제약을 기록하면 여기에 표시됩니다." />
            : (
              <div className="space-y-1">
                {inits.filter((i) => Array.isArray(i[depListTab.field]) && (i[depListTab.field] as unknown[]).length > 0).slice(0, 30).map((i) => (
                  <div key={i.id} className="rounded-lg border border-border p-2 text-[11px]">
                    <AdminBadge tone="warning">{depListTab.label}</AdminBadge>
                    <span className="ml-2 font-bold">{i.initiative_code}</span>
                    <span className="ml-2 text-muted-foreground">{JSON.stringify(i[depListTab.field]).slice(0, 160)}</span>
                  </div>
                ))}
              </div>
            )}
        </div>
      )}

      {tab === 'concentration' && resultEventTab('portfolio_concentration_reviewed', 'Concentration 검토', '단일 사업/고객군/Brand/Provider/Connector/Revenue/Specialist 의존도 — Concentration Candidate ≠ Confirmed Risk.', CONCENTRATION_RESULTS)}
      {tab === 'diversification' && resultEventTab('portfolio_diversification_reviewed', 'Diversification 검토', 'Goal/Initiative/Revenue/Segment/Provider/Horizon 다양성 — Diversification ≠ Guaranteed Resilience.', DIVERSIFICATION_RESULTS)}
      {tab === 'balance' && resultEventTab('portfolio_balance_reviewed', 'Portfolio Balance 검토', '단기/장기·Growth/Stability·Innovation/Reliability·Reversible/Irreversible 균형 — 자동 재조정 없음.', PORTFOLIO_BALANCE_RESULTS)}

      {tab === 'risk' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Strategic Risk Projection — Risk Candidate ≠ Actual Risk. Portfolio/Initiative 의 risk_projection 을 표시합니다." />
          {!pfs.filter((p) => p.risk_projection != null).length && !inits.filter((i) => i.risk_projection != null).length ? <AdminEmpty title="Strategic Risk 없음" description="risk_projection 이 기록되면 여기에 표시됩니다. 0건 ≠ 위험 없음." /> : (
            <div className="space-y-1">
              {pfs.filter((p) => p.risk_projection != null).slice(0, 15).map((p) => (
                <div key={p.id} className="rounded-lg border border-border p-2 text-[11px]"><AdminBadge tone="warning">portfolio</AdminBadge><span className="ml-2 font-bold">{p.portfolio_code}</span><span className="ml-2 text-muted-foreground">{JSON.stringify(p.risk_projection).slice(0, 160)}</span></div>
              ))}
              {inits.filter((i) => i.risk_projection != null).slice(0, 15).map((i) => (
                <div key={i.id} className="rounded-lg border border-border p-2 text-[11px]"><AdminBadge tone="warning">initiative</AdminBadge><span className="ml-2 font-bold">{i.initiative_code}</span><span className="ml-2 text-muted-foreground">{JSON.stringify(i.risk_projection).slice(0, 160)}</span></div>
              ))}
            </div>
          )}
        </div>
      )}
      {tab === 'opportunity' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Strategic Opportunity Projection — Opportunity Candidate ≠ Guaranteed Benefit." />
          {!pfs.filter((p) => p.opportunity_projection != null).length && !inits.filter((i) => i.opportunity_projection != null).length ? <AdminEmpty title="Strategic Opportunity 없음" description="opportunity_projection 이 기록되면 여기에 표시됩니다." /> : (
            <div className="space-y-1">
              {pfs.filter((p) => p.opportunity_projection != null).slice(0, 15).map((p) => (
                <div key={p.id} className="rounded-lg border border-border p-2 text-[11px]"><AdminBadge tone="warning">portfolio</AdminBadge><span className="ml-2 font-bold">{p.portfolio_code}</span><span className="ml-2 text-muted-foreground">{JSON.stringify(p.opportunity_projection).slice(0, 160)}</span></div>
              ))}
              {inits.filter((i) => i.opportunity_projection != null).slice(0, 15).map((i) => (
                <div key={i.id} className="rounded-lg border border-border p-2 text-[11px]"><AdminBadge tone="warning">initiative</AdminBadge><span className="ml-2 font-bold">{i.initiative_code}</span><span className="ml-2 text-muted-foreground">{JSON.stringify(i.opportunity_projection).slice(0, 160)}</span></div>
              ))}
            </div>
          )}
        </div>
      )}
      {impactField != null && (
        <div className="space-y-2">
          <AdminAlert tone="info" description={`${impactField.label} Candidate — Estimate 중심(회계/실측 확정 아님). Settlement·Payment 는 Reference 만.`} />
          {!inits.filter((i) => i[impactField.field] != null).length ? <AdminEmpty title={`${impactField.label} 없음`} description="Initiative 에 해당 impact 가 기록되면 여기에 표시됩니다." /> : (
            <div className="space-y-1">
              {inits.filter((i) => i[impactField.field] != null).slice(0, 30).map((i) => (
                <div key={i.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <AdminBadge tone="warning">{impactField.label}</AdminBadge>
                  <span className="ml-2 font-bold">{i.initiative_code}</span>
                  <span className="ml-2 text-muted-foreground">{JSON.stringify(i[impactField.field]).slice(0, 160)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'tradeoff' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {pfSelect}
            <select value={axisSel} onChange={(e) => setAxisSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {STRATEGIC_TRADEOFF_AXES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={(STRATEGIC_TRADEOFF_RESULTS as readonly string[]).includes(resultSel) ? resultSel : STRATEGIC_TRADEOFF_RESULTS[0]} onChange={(e) => setResultSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {STRATEGIC_TRADEOFF_RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {reasonInput}
            {btn('Trade-off 기록', () => stEvent('strategic_tradeoff_reviewed', { axis: axisSel, result: (STRATEGIC_TRADEOFF_RESULTS as readonly string[]).includes(resultSel) ? resultSel : STRATEGIC_TRADEOFF_RESULTS[0] }, 'Trade-off 기록됨'), true)}
          </div>
          <AdminAlert tone="info" description="13개 축(short/long·growth/stability·innovation/reliability·concentration/diversification 등) — 자동 점수로 Portfolio 를 선택하지 않습니다." />
          {eventList(evByType('strategic_tradeoff_reviewed'), 'Strategic Trade-off 없음', '축별 트레이드오프 검토가 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'robustness' && resultEventTab('strategic_robustness_reviewed', 'Robustness 검토', 'Base/Growth/Conservative/Constrained/Failure 케이스 견고성 — Robust Portfolio ≠ Correct Portfolio.', STRATEGIC_ROBUSTNESS_RESULTS)}
      {tab === 'regret' && resultEventTab('strategic_regret_reviewed', 'Regret 검토', '중단/미선택 Initiative·지연 비용·Lock-in — Lowest Regret Portfolio ≠ Best Strategy.', STRATEGIC_REGRET_RESULTS)}
      {tab === 'reversibility' && resultEventTab('strategic_reversibility_reviewed', 'Reversibility 검토', '중단/재구성/예산 회수/Contract·Provider Lock-in — Reversibility ≠ Guaranteed Exit.', STRATEGIC_REVERSIBILITY_RESULTS, { init: true, pf: true })}
      {tab === 'feasibility' && resultEventTab('strategic_feasibility_reviewed', 'Feasibility 검토', '기술/인력/Reviewer/Budget/Capacity/Contract/Policy — Feasibility ≠ Resource Reservation.', STRATEGIC_FEASIBILITY_RESULTS, { init: true, pf: true })}

      {tab === 'roadmaps' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {pfSelect}{reasonInput}
            {btn('Roadmap Candidate 기록', () => stEvent('roadmap_candidate_recorded', { note: 'roadmap_is_not_execution_schedule' }, 'Roadmap 기록됨(실행 일정 아님)'), true)}
          </div>
          <AdminAlert tone="info" description="Goal/Initiative Sequence·Parallel Group·Decision/Evidence/Approval/Budget Gate·Stop Condition·Replanning Trigger — Roadmap Candidate ≠ Execution Schedule." />
          {eventList(evByType('roadmap_candidate_recorded'), 'Strategic Roadmap 없음', '로드맵 후보 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'sequence' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Initiative Sequence Candidate — 순서는 실행 일정이 아닙니다." />
          {initList([...inits].filter((i) => i.sequence_candidate != null).sort((a, b) => (a.sequence_candidate ?? 0) - (b.sequence_candidate ?? 0)), 'Sequence 없음', 'sequence_candidate 가 기록된 Initiative 가 순서대로 표시됩니다.')}
        </div>
      )}
      {tab === 'parallel' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Parallel Initiative Group Candidate — 동시 추진 가능 후보(Capacity 검토 필요)." />
          {initList(inits.filter((i) => i.parallel_group_candidate != null), 'Parallel Group 없음', 'parallel_group_candidate 가 기록된 Initiative 가 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'criticalpath' && resultEventTab('critical_path_reviewed', 'Critical Path 검토', '최장 의존 경로/공유 자원·예산·Capacity/승인 지연 — Critical Path Candidate ≠ 일정 보장.', CRITICAL_PATH_RESULTS)}
      {tab === 'milestones' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {pfSelect}
            <select value={milestoneStatus} onChange={(e) => setMilestoneStatus(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {MILESTONE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {reasonInput}
            {btn('Milestone Candidate 기록', () => stEvent('milestone_candidate_recorded', { milestone_name: reason.trim(), milestone_status: milestoneStatus, ...(milestoneStatus === 'achieved_reference' ? { evidence: [reason.trim()] } : {}) }, 'Milestone 기록됨(≠ Commitment)'), true)}
          </div>
          <AdminAlert tone="info" description="Evidence 없는 achieved 서버 차단 — Milestone Candidate ≠ Commitment, 미완료 Milestone 을 Completed 로 표시하지 않습니다." />
          {eventList(evByType('milestone_candidate_recorded'), 'Milestone 없음', '마일스톤 후보가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'recommendations' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {pfSelect}
            <select value={recTypeSel} onChange={(e) => setRecTypeSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {STRATEGY_RECOMMENDATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Recommendation 기록(Evidence)', () => stEvent('strategy_recommendation_recorded', { recommendation_type: recTypeSel, evidence: [reason.trim()] }, 'Recommendation 기록됨(≠ Approval)'), true)}
          </div>
          <AdminAlert tone="info" description="34 유형 전부 Candidate — Evidence 필수(서버 거부) · 자동 Portfolio 선택/예산 배분/실행 없음 · Human Strategy Approval Required." />
          {eventList(evByType('strategy_recommendation_recorded'), 'Recommendation 없음', '전략 권고 후보가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'humanreviews' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {pfSelect}{reasonInput}
            {btn('Review 상정(Evidence)', () => pfReview('mark_ready_for_strategy_review', { evidence: [reason.trim()] }, 'ready(승인 아님)'))}
            {btn('Strategy 검토 시작', () => pfReview('start_strategy_review', {}, 'under_strategy_review'))}
            {btn('Approve Portfolio Reference(Evidence)', () => pfReview('approve_portfolio_reference', { evidence: [reason.trim()] }, 'approved(예산·자원 배분 아님)'), true)}
            {btn('조건부 Approve', () => pfReview('approve_with_conditions_reference', { evidence: [reason.trim()], conditions: [reason.trim()] }, 'approved(조건부 — 배분 아님)'))}
            {btn('Reject Reference', () => pfReview('reject_portfolio_reference', {}, 'rejected_reference'))}
            {btn('Defer Reference', () => pfReview('defer_portfolio_reference', {}, 'deferred_reference'))}
            {btn('수정 요청', () => pfReview('request_revision_reference', {}, 'revision_requested'))}
            {btn('Evidence 추가 요청', () => pfReview('request_more_evidence_reference', {}, 'pending_evidence'))}
            {btn('전문가 검토 요청', () => pfReview('request_specialist_review_reference', {}, 'pending_review'))}
            {btn('Outcome 대기', () => pfReview('mark_outcome_pending', {}, 'outcome_pending'))}
            {btn('종결(Evidence)', () => pfReview('close_reference', { evidence: [reason.trim()] }, 'closed_reference'))}
            {btn('무효화', () => pfReview('invalidate', {}, '무효화'))}
          </div>
          <AdminAlert tone="info" description="Approval Reference ≠ 예산·자원 배분/Production Apply(budget_allocated/resources_allocated/production_applied 항상 false) · Self-Approval 서버 차단 · Evidence 없는 승인 거부." />
          {eventList(audit.filter((e) => ['human_strategy_review_started', 'portfolio_approval_reference_recorded', 'portfolio_rejection_reference_recorded', 'portfolio_defer_reference_recorded', 'strategy_revision_requested'].includes(e.event_type)), 'Human Strategy Review 없음', '사람 전략 검토 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'approved' && pfList(pfs.filter((p) => p.portfolio_status === 'approved_strategy_reference'), 'Approved Portfolio Reference 없음', 'approved 는 실제 Initiative 시작/예산 배정이 아닙니다.')}
      {tab === 'rejected' && pfList(pfs.filter((p) => p.portfolio_status === 'rejected_reference'), 'Rejected Portfolio Reference 없음', '거절 Reference 가 여기에 표시됩니다.')}
      {tab === 'deferred' && pfList(pfs.filter((p) => p.portfolio_status === 'deferred_reference'), 'Deferred Portfolio Reference 없음', '보류 Reference 가 여기에 표시됩니다.')}
      {tab === 'revisions' && pfList(pfs.filter((p) => p.portfolio_status === 'revision_requested'), 'Revision Request 없음', '수정 요청 상태의 Portfolio 가 여기에 표시됩니다.')}

      {tab === 'decisionrefs' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {pfSelect}{reasonInput}
            {btn('Decision Reference 연결', () => stEvent('decision_reference_linked', { note: 'decision_reference_only' }, 'Decision Reference 연결됨(≠ Execution)'), true)}
          </div>
          <AdminAlert tone="info" description="0544 Decision Context 실존 검증 — Decision Reference ≠ 실행." />
          {eventList(evByType('decision_reference_linked'), 'Decision Reference 없음', '의사결정 참조가 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'commitrefs' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {initSelect}{reasonInput}
            {btn('Commitment Reference 연결', () => stEvent('commitment_reference_linked', { note: 'commitment_reference_only' }, 'Commitment 연결됨(자동 완료 없음)', { init: true }), true)}
          </div>
          <AdminAlert tone="info" description="Commitment 실존 검증(0520) — Commitment Reference ≠ Completed Commitment." />
          {eventList(evByType('commitment_reference_linked'), 'Commitment Reference 없음', '커밋먼트 연결 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'observation' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Observation Plan Reference — 전략 실행 후 무엇을 관찰할지(자동 Polling 없음)." />
          {!pfs.filter((p) => p.observation_plan_reference != null).length ? <AdminEmpty title="Observation Plan 없음" description="Portfolio 에 observation_plan_reference 가 기록되면 여기에 표시됩니다." /> : (
            <div className="space-y-1">
              {pfs.filter((p) => p.observation_plan_reference != null).slice(0, 30).map((p) => (
                <div key={p.id} className="rounded-lg border border-border p-2 text-[11px]"><AdminBadge tone="warning">observation_plan</AdminBadge><span className="ml-2 font-bold">{p.portfolio_code} v{p.portfolio_version}</span><span className="ml-2 text-muted-foreground">{JSON.stringify(p.observation_plan_reference).slice(0, 160)}</span></div>
              ))}
            </div>
          )}
        </div>
      )}
      {tab === 'reviewtriggers' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Review Trigger Reference — 환경이 바뀌면 언제 전략을 재검토할지." />
          {!pfs.filter((p) => p.review_trigger_reference != null).length ? <AdminEmpty title="Review Trigger 없음" description="Portfolio 에 review_trigger_reference 가 기록되면 여기에 표시됩니다." /> : (
            <div className="space-y-1">
              {pfs.filter((p) => p.review_trigger_reference != null).slice(0, 30).map((p) => (
                <div key={p.id} className="rounded-lg border border-border p-2 text-[11px]"><AdminBadge tone="warning">review_trigger</AdminBadge><span className="ml-2 font-bold">{p.portfolio_code} v{p.portfolio_version}</span><span className="ml-2 text-muted-foreground">{JSON.stringify(p.review_trigger_reference).slice(0, 160)}</span></div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'outcomes' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {pfSelect}{reasonInput}
            {btn('Strategic Outcome 연결', () => stEvent('strategic_outcome_linked', { causality_status: 'causality_unverified' }, 'Outcome 연결됨(≠ Causality)'), true)}
          </div>
          <AdminAlert tone="info" description="Outcome Link ≠ 전략이 결과를 직접 발생시켰다는 인과 증명 — 외부 요인/표본 부족 시 unverified 유지." />
          {eventList(evByType('strategic_outcome_linked'), 'Strategic Outcome 없음', '실측 결과 연결 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'quality' && resultEventTab('strategy_quality_reviewed', 'Strategy Quality 검토', 'Goal 달성/Financial·Capacity Range/부작용/재검토 — Quality Candidate ≠ 경영진 성과 평가.', STRATEGY_QUALITY_RESULTS)}
      {tab === 'drift' && resultEventTab('strategy_drift_reviewed', 'Strategy Drift 검토', 'Vision/Goal/Policy/Financial/Capacity/Contract/Assumption Drift — Drift ≠ Confirmed Failure, 장기 관찰 필요.', STRATEGY_DRIFT_RESULTS)}
      {tab === 'pfdrift' && resultEventTab('portfolio_drift_reviewed', 'Portfolio Drift 검토', 'Initiative Mix/Envelope/Concentration/Balance/Timeline Drift — 자동 Portfolio 재조정 없음.', PORTFOLIO_DRIFT_RESULTS)}
      {tab === 'learning' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {pfSelect}{reasonInput}
            {btn('Learning Reference 기록', () => stEvent('strategy_learning_reference_recorded', { note: 'learning_reference_only' }, 'Learning 기록됨(자동 Goal·Portfolio 변경 없음)'), true)}
          </div>
          <AdminAlert tone="info" description="어떤 Goal/Initiative/Scenario/Bottleneck/Milestone 이 유효했는지 — Learning Reference ≠ 자동 Goal·Portfolio 변경." />
          {eventList(evByType('strategy_learning_reference_recorded'), 'Strategy Learning 없음', '전략 학습 참조가 여기에 표시됩니다.')}
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
        eventList(audit, 'Audit 없음', '43종 Strategy 이벤트 전체 감사 로그입니다.')
      )}

      {tab === 'support' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="실측 구성요소(추측 없음) — available:false 는 이 코드베이스에 해당 구조가 없음을 의미합니다." />
          <div className="grid grid-cols-2 gap-1 md:grid-cols-3">
            {STRATEGY_COMPONENTS.map((c) => (
              <div key={c.key} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone={c.available ? 'success' : 'danger'}>{c.available ? 'available' : 'unavailable'}</AdminBadge>
                <span className="ml-2 font-bold">{c.key}</span>
              </div>
            ))}
          </div>
          <div className="space-y-1">
            {STRATEGY_SUPPORT_MATRIX.map((s) => (
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
