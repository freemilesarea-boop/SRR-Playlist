/**
 * PortfolioIntelligenceSection — Enterprise Portfolio Intelligence, Investment
 * Portfolio Optimization & Strategic Capital Governance Center (Phase AI-OPS-46).
 *
 * Strategic Objectives→Strategic Initiatives→Investment Portfolio→Capital
 * Allocation Scenario→Diversification→Risk vs Return→Value Concentration→
 * Scenario Comparison→Portfolio Optimization Candidate→Executive Portfolio
 * Review→Portfolio Decision Reference→Portfolio Learning→Audit.
 * Portfolio Candidate ≠ Approved Portfolio · Allocation Candidate ≠ Capital
 * Allocation · Optimization ≠ Investment Decision · Review ≠ Approval.
 * 자동 투자 승인·자본 배분·Budget/Strategy/Initiative 변경 없음.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, BookOpen, ClipboardList, DollarSign, Gauge, GitBranch, Grid3x3,
  History, Inbox, Layers, Lightbulb, Lock, RefreshCw, Scale, Search,
  Target, TrendingUp, Users,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchEnterprisePortfolioSummary, fetchEnterpriseInvestmentPortfolios,
  createEnterpriseInvestmentPortfolio, reviewEnterpriseInvestmentPortfolio,
  createEnterprisePortfolioScenario, reviewEnterprisePortfolioScenario,
  fetchEnterprisePortfolioScenarios, recordEnterprisePortfolioReview,
  recordEnterprisePortfolioEvent, fetchEnterprisePortfolioAudit,
  type EnterprisePortfolioSummary, type EnterpriseInvestmentPortfolioRow,
  type EnterprisePortfolioScenarioRow, type EnterprisePortfolioEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  PORTFOLIO_CATEGORIES, DIVERSIFICATION_RESULTS, CAPITAL_ALLOCATION_RESULTS,
  PORTFOLIO_OPTIMIZATION_RESULTS, PORTFOLIO_BALANCE_RESULTS, CONCENTRATION_RISK_RESULTS,
  ROI_MIX_RESULTS, VALUE_MIX_RESULTS, RISK_RETURN_RESULTS, PORTFOLIO_TRADEOFF_AXES,
  PORTFOLIO_TRADEOFF_RESULTS, OPPORTUNITY_COST_RESULTS, CAPACITY_FIT_RESULTS,
  PORTFOLIO_RECOMMENDATION_TYPES, PORTFOLIO_SCORECARD_FIELDS, buildPortfolioTimeline,
  ENTERPRISE_PORTFOLIO_COMPONENTS, ENTERPRISE_PORTFOLIO_SUPPORT_MATRIX,
} from '@/lib/enterprisePortfolio';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'inbox' | 'portfolios' | 'capital' | 'scenarios' | 'pendingscenario'
  | 'allocation' | 'balance' | 'diversification' | 'concentration' | 'roimix' | 'valuemix'
  | 'riskreturn' | 'tradeoff' | 'comparison' | 'oppcost' | 'capacityfit' | 'optimization'
  | 'scorecard' | 'summaryrec' | 'recommendations' | 'reviewqueue' | 'reviewed' | 'links'
  | 'learning' | 'flow' | 'audit' | 'support' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Portfolio Overview', icon: Layers },
  { key: 'inbox', label: 'Portfolio Inbox', icon: Inbox },
  { key: 'portfolios', label: 'Investment Portfolios', icon: BookOpen },
  { key: 'capital', label: 'Capital References', icon: DollarSign },
  { key: 'scenarios', label: 'Portfolio Scenarios', icon: ClipboardList },
  { key: 'pendingscenario', label: 'Pending Scenario Review', icon: Scale },
  { key: 'allocation', label: 'Capital Allocation', icon: DollarSign },
  { key: 'balance', label: 'Portfolio Balance', icon: Scale },
  { key: 'diversification', label: 'Diversification', icon: GitBranch },
  { key: 'concentration', label: 'Concentration Risk', icon: Activity },
  { key: 'roimix', label: 'ROI Mix', icon: TrendingUp },
  { key: 'valuemix', label: 'Value Mix', icon: TrendingUp },
  { key: 'riskreturn', label: 'Risk vs Return', icon: Scale },
  { key: 'tradeoff', label: 'Portfolio Trade-offs', icon: Scale },
  { key: 'comparison', label: 'Scenario Comparison', icon: Search },
  { key: 'oppcost', label: 'Opportunity Cost', icon: Scale },
  { key: 'capacityfit', label: 'Capacity Fit', icon: Gauge },
  { key: 'optimization', label: 'Portfolio Optimization', icon: Target },
  { key: 'scorecard', label: 'Executive Portfolio Scorecard', icon: Grid3x3 },
  { key: 'summaryrec', label: 'Executive Portfolio Summary', icon: ClipboardList },
  { key: 'recommendations', label: 'Portfolio Recommendations', icon: Lightbulb },
  { key: 'reviewqueue', label: 'Review Queue', icon: Users },
  { key: 'reviewed', label: 'Review/Decision References', icon: Scale },
  { key: 'links', label: 'Reference Links', icon: GitBranch },
  { key: 'learning', label: 'Portfolio Learning', icon: Lightbulb },
  { key: 'flow', label: 'Flow Timeline', icon: History },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
  { key: 'limitations', label: 'Known Limitations', icon: ClipboardList },
];

const KNOWN_LIMITATIONS = [
  '자동 투자 승인·자동 Capital Allocation·자동 Budget/Strategy 변경·자동 Initiative 생성/종료·자동 Resource Allocation/KPI/Portfolio 변경·자동 회계 처리/Payment/Production/Merge/Deploy/Rollback 없음 — 모든 반환 flag(investment_approved/capital_allocated 등) 항상 false',
  'Portfolio Candidate ≠ Approved Portfolio · Capital Reference 는 출처 없이 기록 서버 차단',
  'Capital Allocation Candidate ≠ Capital Allocation — Evidence 없는 Allocation Candidate 기록 서버 차단',
  'Scenario preferred_candidate 는 Evidence 필수(≠ 투자 승인) · Scenario Comparison ≠ Future Fact',
  'Diversification Score(HHI) ≠ Risk Guarantee · Concentration Risk ≠ Failure Prediction · Opportunity Cost ≠ Actual Loss',
  'ROI Mix ≠ Accounting Return · Strategic Value Mix ≠ Financial Statement · Optimization ≠ Investment Decision',
  'Review/Decision Reference 는 Self-Review 차단(작성자 ≠ 평가자) + Evidence 필수 — Review ≠ Approval, Decision Reference ≠ Capital Allocation',
  'Capital Market/Treasury/투자위원회/회계 원장/재무 계획/외부 벤치마크 피드 부재 — insufficient_data 유지',
  'Migration 0472~0550 production 미적용 — 운영 수치는 적용 후 축적됩니다',
  '브라우저 실측 미검증 — UI 는 코드 리뷰/타입/빌드 기준 검증만 수행했습니다',
];

export default function PortfolioIntelligenceSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<EnterprisePortfolioSummary>({});
  const [portfolios, setPortfolios] = useState<EnterpriseInvestmentPortfolioRow[]>([]);
  const [scenarios, setScenarios] = useState<EnterprisePortfolioScenarioRow[]>([]);
  const [audit, setAudit] = useState<EnterprisePortfolioEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [selPortfolio, setSelPortfolio] = useState('');
  const [selScenario, setSelScenario] = useState('');
  const [catSel, setCatSel] = useState<string>('growth');
  const [axisSel, setAxisSel] = useState<string>('growth_vs_stability');
  const [recTypeSel, setRecTypeSel] = useState<string>('gather_more_evidence_candidate');
  const [resultSel, setResultSel] = useState<string>('insufficient_data');
  const [numVal, setNumVal] = useState('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, p, sc, a] = await Promise.all([
        fetchEnterprisePortfolioSummary(), fetchEnterpriseInvestmentPortfolios(null, null, 200),
        fetchEnterprisePortfolioScenarios(null, 200), fetchEnterprisePortfolioAudit(200),
      ]);
      setSummary(s); setPortfolios(p); setScenarios(sc); setAudit(a);
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
  const pfReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selPortfolio) { if (!selPortfolio) toast.error('Portfolio 선택 필수'); return; }
    void act(() => reviewEnterpriseInvestmentPortfolio(selPortfolio, action, r, payload), ok);
  };
  const scReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selScenario) { if (!selScenario) toast.error('Scenario 선택 필수'); return; }
    void act(() => reviewEnterprisePortfolioScenario(selScenario, action, r, payload), ok);
  };
  const execReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selPortfolio) { if (!selPortfolio) toast.error('Portfolio 선택 필수'); return; }
    void act(() => recordEnterprisePortfolioReview(selPortfolio, action, r, payload), ok);
  };
  const pfEvent = (kind: string, payload: Record<string, unknown>, ok: string, ids: { pf?: boolean; sc?: boolean } = { pf: true }) => {
    const r = needReason();
    if (!r) return;
    void act(() => recordEnterprisePortfolioEvent(kind, r, payload, ids.pf ? (selPortfolio || null) : null, ids.sc ? (selScenario || null) : null), ok);
  };

  const obj = useCallback((k: string): Record<string, unknown> => (typeof summary[k] === 'object' && summary[k] !== null && !Array.isArray(summary[k]) ? summary[k] as Record<string, unknown> : {}), [summary]);
  const num = useCallback((k: string, sub: string): number | null => {
    const v = obj(k)[sub];
    return typeof v === 'number' ? v : null;
  }, [obj]);

  const flowTimeline = useMemo(() => buildPortfolioTimeline({ present: {
    strategic_objectives: (num('portfolio_actuals', 'strategy_portfolios_0545') ?? 0) > 0,
    strategic_initiatives: (num('portfolio_actuals', 'strategic_initiatives_0545') ?? 0) > 0,
    investment_portfolio: (num('portfolios', 'total') ?? 0) > 0,
    capital_allocation_scenario: (num('scenarios', 'total') ?? 0) > 0,
    portfolio_diversification: (num('portfolio_events', 'diversification_reviews') ?? 0) > 0,
    risk_vs_return: (num('portfolio_events', 'risk_return_reviews') ?? 0) > 0,
    value_concentration: (num('portfolio_events', 'concentration_reviews') ?? 0) > 0,
    scenario_comparison: (num('portfolio_events', 'scenario_comparisons') ?? 0) > 0,
    portfolio_optimization: (num('portfolio_events', 'optimization_reviews') ?? 0) > 0,
    executive_portfolio_review: (num('portfolio_events', 'executive_review_requests') ?? 0) + (num('portfolio_events', 'review_references') ?? 0) > 0,
    portfolio_decision_reference: (num('portfolio_events', 'decision_references') ?? 0) > 0,
    portfolio_learning: (num('portfolio_events', 'learning_references') ?? 0) > 0,
  } }), [num]);

  if (loading) return <AdminCard title="Portfolio Intelligence & Strategic Capital Governance Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Portfolio Intelligence & Strategic Capital Governance Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const pfSelect = (
    <select value={selPortfolio} onChange={(e) => setSelPortfolio(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Portfolio 선택</option>
      {portfolios.map((p) => <option key={p.id} value={p.id}>{p.portfolio_code} · {p.portfolio_status}</option>)}
    </select>
  );
  const scSelect = (
    <select value={selScenario} onChange={(e) => setSelScenario(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Scenario 선택(선택)</option>
      {scenarios.map((s) => <option key={s.id} value={s.id}>{s.scenario_code} · {s.scenario_status}</option>)}
    </select>
  );
  const reasonInput = <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const numInput = <input value={numVal} onChange={(e) => setNumVal(e.target.value)} placeholder="수치" className="w-24 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button disabled={busy} onClick={onClick} className={primary ? 'rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50' : 'rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50'}>{label}</button>
  );
  const tone = (s: string) => (s.includes('diversified') || s.includes('recommended') || s.includes('favorable') || s.includes('optimized_candidate') || s.includes('highly_optimized') || s.includes('no_material') || s.includes('fits_capacity') || s.includes('well_balanced') || s.includes('high_roi_mix') || s.includes('active_reference') || s.includes('preferred') || s.includes('low_opportunity') ? 'success' as const : s.includes('highly_concentrated') || s.includes('critical') || s.includes('high_risk') || s.includes('severely') || s.includes('exceeds_capacity') || s.includes('high_risk_low_return') || s.includes('conflicting') || s.includes('rejected') || s.includes('deprecated') || s === 'unavailable' ? 'danger' as const : 'warning' as const);
  const evByType = (t: string) => audit.filter((e) => e.event_type === t);
  const eventList = (rows: EnterprisePortfolioEventRow[], emptyTitle: string, emptyDesc: string) => (
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
  const pfList = (list: EnterpriseInvestmentPortfolioRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((p) => (
          <div key={p.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(p.portfolio_status)}>{p.portfolio_status}</AdminBadge>
            <AdminBadge tone={tone(p.diversification_status)}>{p.diversification_status}</AdminBadge>
            <AdminBadge tone={tone(p.allocation_status)}>{p.allocation_status}</AdminBadge>
            <span className="ml-2 font-bold">{p.portfolio_code}</span>
            <span className="ml-2 text-muted-foreground">{p.portfolio_category} · {p.portfolio_name} · capital {NUM(p.total_capital_reference)} · {p.optimization_status}</span>
          </div>
        ))}
      </div>
    )
  );
  const scList = (list: EnterprisePortfolioScenarioRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((s) => (
          <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(s.scenario_status)}>{s.scenario_status}</AdminBadge>
            <span className="ml-2 font-bold">{s.scenario_code}</span>
            <span className="ml-2 text-muted-foreground">{s.scenario_name} · benefit {NUM(s.expected_benefit_candidate)} · risk {NUM(s.expected_risk_candidate)}</span>
          </div>
        ))}
      </div>
    )
  );
  const resultEventTab = (kind: string, title: string, note: string, results: readonly string[], extraPayload: Record<string, unknown> = {}, ids: { pf?: boolean; sc?: boolean } = { pf: true }) => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        {ids.pf ? pfSelect : null}{ids.sc ? scSelect : null}
        <select value={results.includes(resultSel) ? resultSel : results[0]} onChange={(e) => setResultSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
          {results.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {reasonInput}
        {btn(`${title} 기록`, () => pfEvent(kind, { result: results.includes(resultSel) ? resultSel : results[0], ...extraPayload }, `${title} 기록됨`, ids), true)}
      </div>
      <AdminAlert tone="info" description={note} />
      {eventList(evByType(kind), `${title} 없음`, '사람 검토 기록이 여기에 표시됩니다.')}
    </div>
  );

  return (
    <AdminCard
      title="Portfolio Intelligence & Strategic Capital Governance Center"
      subtitle="Strategic Initiatives→Investment Portfolio→Capital Allocation Scenario→Diversification→Risk vs Return→Concentration→Scenario Comparison→Optimization Candidate→Executive Portfolio Review→Decision Reference→Learning — 투자·전략 결정은 반드시 사람"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 Enterprise 의 모든 전략 Initiative 를 Portfolio 관점에서 분석해 어떤 조합이 가장 높은 장기 Business Value 를 만들 수 있는지 사람이 판단할 수 있게 하는 Portfolio Intelligence 계층입니다. AI 는 Investment Portfolio/Scenario 구조화·Capital Allocation Candidate·Balance·Diversification(HHI)·Concentration Risk·ROI/Value Mix·Risk vs Return·Trade-off·Scenario Comparison·Opportunity Cost·Capacity Fit·Optimization Candidate·Executive Scorecard/Summary·Recommendation·Review 요청까지만 수행하며, 자동 투자 승인·자동 Capital Allocation·자동 Budget/Strategy 변경·자동 Initiative 생성/종료·자동 Resource Allocation/KPI/Portfolio 변경·자동 회계 처리/Payment/Production/Merge/Deploy/Rollback 은 수행하지 않습니다. Portfolio Candidate ≠ Approved Portfolio, Allocation Candidate ≠ Capital Allocation, Optimization ≠ Investment Decision, Diversification Score ≠ Risk Guarantee, Opportunity Cost ≠ Actual Loss, Review ≠ Approval. AI 는 최적의 Portfolio 후보를 설명하고, 사람이 투자와 전략을 결정합니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Investment Portfolios" value={NUM(num('portfolios', 'total'))} />
            <Box label="Active / In Review / Deprecated" value={`${NUM(num('portfolios', 'active'))} / ${NUM(num('portfolios', 'in_review'))} / ${NUM(num('portfolios', 'deprecated'))}`} />
            <Box label="Capital Reference 보유" value={NUM(num('portfolios', 'with_capital_reference'))} />
            <Box label="Diversified / Concentrated" value={`${NUM(num('portfolios', 'diversified'))} / ${NUM(num('portfolios', 'concentrated'))}`} />
            <Box label="High-Risk Allocation / Optimized" value={`${NUM(num('portfolios', 'high_risk_allocation'))} / ${NUM(num('portfolios', 'optimized'))}`} />
            <Box label="Review / Decision References" value={`${NUM(num('portfolios', 'reviewed_references'))} / ${NUM(num('portfolios', 'decision_references'))}`} />
            <Box label="Scenarios" value={NUM(num('scenarios', 'total'))} />
            <Box label="Analyzed / Compared / Preferred" value={`${NUM(num('scenarios', 'analyzed'))} / ${NUM(num('scenarios', 'compared'))} / ${NUM(num('scenarios', 'preferred'))}`} />
            <Box label="Capital / Allocation Candidates" value={`${NUM(num('portfolio_events', 'capital_references'))} / ${NUM(num('portfolio_events', 'allocation_candidates'))}`} />
            <Box label="Balance / Diversification Reviews" value={`${NUM(num('portfolio_events', 'balance_reviews'))} / ${NUM(num('portfolio_events', 'diversification_reviews'))}`} />
            <Box label="Concentration / Risk-Return Reviews" value={`${NUM(num('portfolio_events', 'concentration_reviews'))} / ${NUM(num('portfolio_events', 'risk_return_reviews'))}`} />
            <Box label="ROI / Value Mix Reviews" value={`${NUM(num('portfolio_events', 'roi_mix_reviews'))} / ${NUM(num('portfolio_events', 'value_mix_reviews'))}`} />
            <Box label="Trade-off / Comparisons" value={`${NUM(num('portfolio_events', 'tradeoff_reviews'))} / ${NUM(num('portfolio_events', 'scenario_comparisons'))}`} />
            <Box label="Opportunity Cost / Capacity Fit" value={`${NUM(num('portfolio_events', 'opportunity_cost_reviews'))} / ${NUM(num('portfolio_events', 'capacity_fit_reviews'))}`} />
            <Box label="Optimization Reviews" value={NUM(num('portfolio_events', 'optimization_reviews'))} />
            <Box label="Scorecards / Summaries" value={`${NUM(num('portfolio_events', 'scorecards'))} / ${NUM(num('portfolio_events', 'summaries'))}`} />
            <Box label="Recommendations" value={NUM(num('portfolio_events', 'recommendations'))} />
            <Box label="Portfolio / Executive / Strategy Review 요청" value={`${NUM(num('portfolio_events', 'portfolio_review_requests'))} / ${NUM(num('portfolio_events', 'executive_review_requests'))} / ${NUM(num('portfolio_events', 'strategy_review_requests'))}`} />
            <Box label="Initiative / Value / KPI Links" value={`${NUM(num('portfolio_events', 'initiative_links'))} / ${NUM(num('portfolio_events', 'business_value_links'))} / ${NUM(num('portfolio_events', 'kpi_links'))}`} />
            <Box label="Learning References" value={NUM(num('portfolio_events', 'learning_references'))} />
          </div>
          <AdminAlert tone="info" description={`portfolio_unavailable: ${Array.isArray(summary.portfolio_unavailable) ? (summary.portfolio_unavailable as unknown[]).map(String).join(', ') : '—'}. Portfolio 원천 실측 — Business Values(0549) ${NUM(num('portfolio_actuals', 'business_values_0549'))}건 · KPIs(0548) ${NUM(num('portfolio_actuals', 'enterprise_kpis_0548'))}건 · Programs(0547) ${NUM(num('portfolio_actuals', 'execution_programs_0547'))}건 · Initiatives(0545) ${NUM(num('portfolio_actuals', 'strategic_initiatives_0545'))}건 · Resource Inventory(0546) ${NUM(num('portfolio_actuals', 'resource_inventory_0546'))}건 · Commitments(0520) ${NUM(num('portfolio_actuals', 'commitments_0520'))}건. 0 과 Unknown 을 혼동하지 않습니다.`} />
        </div>
      )}

      {tab === 'inbox' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="포트폴리오 대기함 — draft Portfolio 와 고위험/집중 후보. 우선순위와 투자 판단은 사람이 결정합니다." />
          {pfList(portfolios.filter((p) => p.portfolio_status === 'draft'), 'Draft Portfolio 없음', '0건은 포트폴리오 체계가 완성됐음을 의미하지 않습니다.')}
          {pfList(portfolios.filter((p) => p.allocation_status === 'high_risk_candidate' || ['concentrated_candidate', 'highly_concentrated_candidate'].includes(p.diversification_status)), '고위험/집중 후보 없음', 'High-Risk/Concentrated 후보가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'portfolios' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <select value={catSel} onChange={(e) => setCatSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {PORTFOLIO_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {reasonInput}
            {btn('Portfolio 생성(≠ 승인)', () => {
              const r = needReason();
              if (!r) return;
              void act(() => createEnterpriseInvestmentPortfolio({ portfolio_category: catSel, portfolio_name: r }), 'Portfolio 생성됨(draft — 자동 배분 없음)');
            }, true)}
            {btn('Active Reference', () => pfReview('activate_reference', {}, 'active_reference'))}
            {btn('Review Reference', () => pfReview('mark_review_reference', {}, 'review_reference'))}
            {btn('Deprecate', () => pfReview('deprecate_reference', {}, 'deprecated_reference'))}
            {pfSelect}
          </div>
          <AdminAlert tone="info" description="Category 16종 · 자동 집행/개인 평가 계열 category 서버 차단 · deprecated 재결정 차단." />
          {pfList(portfolios, 'Investment Portfolio 없음', '핵심 질문 예: 현재 Portfolio 는 균형적인가? 어디에 집중돼 있는가? — 전부 Candidate 분석.')}
        </div>
      )}

      {tab === 'capital' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {pfSelect}{numInput}{reasonInput}
            {btn('Capital Reference 기록(출처 필수)', () => pfReview('record_capital_reference', { total_capital_reference: Number(numVal) || 0, capital_source_reference: reason.trim() }, 'Capital Reference 기록됨(≠ 배분 집행)'), true)}
          </div>
          <AdminAlert tone="warning" description="Capital Reference ≠ 배분 집행/회계 확정 — 출처 없는 기록 서버 차단." />
          {eventList(evByType('portfolio_capital_reference_recorded'), 'Capital Reference 없음', '자본 참조 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'scenarios' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {pfSelect}{reasonInput}
            {btn('Scenario 생성(Portfolio 필수)', () => {
              const r = needReason();
              if (!r || !selPortfolio) { if (!selPortfolio) toast.error('Portfolio 선택 필수'); return; }
              void act(() => createEnterprisePortfolioScenario({ investment_portfolio_id: selPortfolio, scenario_name: r }), 'Scenario 생성됨(draft — Allocation Candidate ≠ Capital Allocation)');
            }, true)}
          </div>
          <AdminAlert tone="info" description="Capital Allocation Scenario — Current/Proposed Allocation·Expected Benefit/Risk·Capacity Requirement·Opportunity Cost 후보." />
          {scList(scenarios, 'Portfolio Scenario 없음', '자본 배분 시나리오 후보가 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'pendingscenario' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {scSelect}{reasonInput}
            {btn('Analyzed', () => scReview('mark_analyzed', {}, 'analyzed_candidate'), true)}
            {btn('Compared', () => scReview('mark_compared', {}, 'compared_candidate(≠ Future Fact)'))}
            {btn('Preferred(Evidence 필수)', () => scReview('mark_preferred', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'preferred_candidate(≠ 투자 승인)'))}
            {btn('Reject Reference', () => scReview('reject_reference', {}, 'rejected_reference'))}
            {btn('Supersede', () => scReview('supersede', {}, 'superseded'))}
          </div>
          <AdminAlert tone="warning" description="Preferred Candidate ≠ 투자 승인 — Evidence 없는 preferred 표시 서버 차단 · 종결(rejected/superseded) 재결정 차단." />
          {scList(scenarios.filter((s) => ['draft', 'analyzed_candidate', 'compared_candidate'].includes(s.scenario_status)), '검토 대기 Scenario 없음', '사람 검토 대기 Scenario 가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'allocation' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {pfSelect}{scSelect}
            <select value={CAPITAL_ALLOCATION_RESULTS.includes(resultSel as (typeof CAPITAL_ALLOCATION_RESULTS)[number]) ? resultSel : CAPITAL_ALLOCATION_RESULTS[0]} onChange={(e) => setResultSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {CAPITAL_ALLOCATION_RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {reasonInput}
            {btn('Allocation Candidate 기록(Evidence 필수)', () => pfEvent('capital_allocation_candidate_recorded', { result: CAPITAL_ALLOCATION_RESULTS.includes(resultSel as (typeof CAPITAL_ALLOCATION_RESULTS)[number]) ? resultSel : CAPITAL_ALLOCATION_RESULTS[0], evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Allocation Candidate 기록됨(≠ Capital Allocation)', { pf: true, sc: true }), true)}
          </div>
          <AdminAlert tone="warning" description="Capital Allocation Candidate ≠ Capital Allocation — Evidence 없는 기록 서버 차단(§6: Current/Proposed/Benefit/Risk/Capacity/Opportunity Cost)." />
          {eventList(evByType('capital_allocation_candidate_recorded'), 'Allocation Candidate 없음', '자본 배분 후보 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'balance' && resultEventTab('portfolio_balance_reviewed', 'Portfolio Balance 검토', 'Balance Candidate ≠ 자동 재배분 신호 — 균형 판단 후보입니다.', PORTFOLIO_BALANCE_RESULTS)}
      {tab === 'diversification' && resultEventTab('diversification_reviewed', 'Diversification 검토', 'Diversification Score(§5, HHI 기반) ≠ Risk Guarantee.', DIVERSIFICATION_RESULTS)}
      {tab === 'concentration' && resultEventTab('concentration_risk_reviewed', 'Concentration Risk 검토', 'Concentration Risk ≠ Failure Prediction — 특정 Initiative 과다 집중 후보.', CONCENTRATION_RISK_RESULTS)}
      {tab === 'roimix' && resultEventTab('roi_mix_reviewed', 'ROI Mix 검토', 'ROI Mix(0549 ROI Candidate 조합) ≠ Accounting Return.', ROI_MIX_RESULTS)}
      {tab === 'valuemix' && resultEventTab('value_mix_reviewed', 'Value Mix 검토', 'Strategic Value Mix ≠ Financial Statement — 저ROI·고전략가치 Initiative 도 표시.', VALUE_MIX_RESULTS)}
      {tab === 'riskreturn' && resultEventTab('risk_return_reviewed', 'Risk vs Return 검토', 'Risk-Return 사분면 후보 — 투자 결정이 아닙니다.', RISK_RETURN_RESULTS)}
      {tab === 'tradeoff' && resultEventTab('portfolio_tradeoff_reviewed', 'Portfolio Trade-off 검토', '축 6종(Growth vs Stability·단기 ROI vs 장기 Value 등) — Trade-off ≠ 자동 우선순위 결정.', PORTFOLIO_TRADEOFF_RESULTS, { axis: axisSel })}
      {tab === 'tradeoff' && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
          <span className="text-[11px] text-muted-foreground">Trade-off Axis:</span>
          <select value={axisSel} onChange={(e) => setAxisSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
            {PORTFOLIO_TRADEOFF_AXES.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      )}

      {tab === 'comparison' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {pfSelect}{scSelect}{reasonInput}
            {btn('Scenario Comparison 기록', () => pfEvent('scenario_comparison_recorded', { note: reason.trim() }, 'Comparison 기록됨(≠ Future Fact)', { pf: true, sc: true }), true)}
          </div>
          <AdminAlert tone="info" description="Scenario A vs B 비교 — 결정적 비교 후보이며 Future Fact 이 아닙니다." />
          {eventList(evByType('scenario_comparison_recorded'), 'Comparison 없음', '시나리오 비교 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'oppcost' && resultEventTab('opportunity_cost_reviewed', 'Opportunity Cost 검토', 'Opportunity Cost ≠ Actual Loss — 최선 대안 대비 포기 이익 후보.', OPPORTUNITY_COST_RESULTS, {}, { pf: true, sc: true })}
      {tab === 'capacityfit' && resultEventTab('capacity_fit_reviewed', 'Capacity Fit 검토', 'Resource/Capacity(0546) 안에서 실행 가능한지의 후보 — Resource 배정이 아닙니다.', CAPACITY_FIT_RESULTS)}
      {tab === 'optimization' && resultEventTab('portfolio_optimization_reviewed', 'Portfolio Optimization 검토', 'Optimization 7차원(§7 — Alignment/ROI/Value/Capacity/Resource/Risk/Sustainability) — Optimization ≠ Investment Decision.', PORTFOLIO_OPTIMIZATION_RESULTS)}

      {tab === 'scorecard' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {pfSelect}{reasonInput}
            {btn('Executive Portfolio Scorecard 기록', () => pfEvent('executive_portfolio_scorecard_recorded', { fields: [...PORTFOLIO_SCORECARD_FIELDS], note: reason.trim() }, 'Scorecard 기록됨(≠ 경영 평가)'), true)}
          </div>
          <AdminAlert tone="warning" description={`§8 필드 8종(${PORTFOLIO_SCORECARD_FIELDS.join(', ')}) — 집중/고위험 우선 결정적 정렬 후보.`} />
          {eventList(evByType('executive_portfolio_scorecard_recorded'), 'Scorecard 없음', 'Executive Portfolio Scorecard 기록이 여기에 표시됩니다.')}
          {pfList(portfolios.filter((p) => p.diversification_status === 'highly_concentrated_candidate' || p.allocation_status === 'high_risk_candidate'), 'Critical 우선 Portfolio 없음', 'Highly Concentrated/High-Risk 후보가 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'summaryrec' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {reasonInput}
            {btn('Executive Portfolio Summary 기록', () => pfEvent('executive_portfolio_summary_recorded', { note: reason.trim() }, 'Summary 기록됨'), true)}
          </div>
          <AdminAlert tone="info" description="Summary ≠ Portfolio 확정 — Executive 가 먼저 검토할 관측 요약 후보입니다." />
          {eventList(evByType('executive_portfolio_summary_recorded'), 'Summary 없음', 'Executive Portfolio Summary 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'recommendations' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {pfSelect}
            <select value={recTypeSel} onChange={(e) => setRecTypeSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {PORTFOLIO_RECOMMENDATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Recommendation 기록(Evidence 필수)', () => pfEvent('portfolio_recommendation_recorded', { recommendation_type: recTypeSel, evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Recommendation 기록됨(≠ Decision)'), true)}
          </div>
          <AdminAlert tone="info" description="Portfolio Recommendation ≠ Decision — Evidence 없는 Recommendation 서버 차단. 채택은 사람이 결정합니다." />
          {eventList(evByType('portfolio_recommendation_recorded'), 'Recommendation 없음', 'Portfolio Recommendation 후보가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'reviewqueue' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {pfSelect}{reasonInput}
            {btn('Portfolio Review 요청', () => execReview('request_portfolio_review', {}, 'Portfolio Review 요청됨'), true)}
            {btn('Executive Review 요청', () => execReview('request_executive_review', {}, 'Executive Review 요청됨(≠ Approval)'))}
            {btn('Strategy Review 요청', () => execReview('request_strategy_review', {}, 'Strategy Review 요청됨'))}
            {btn('Review Reference 기록(Evidence 필수)', () => execReview('record_review_reference', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Review Reference 기록됨(≠ Approval)'))}
            {btn('Decision Reference 기록(Evidence 필수)', () => execReview('record_decision_reference', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Decision Reference 기록됨(≠ Capital Allocation)'))}
            {btn('수정 요청', () => execReview('request_revision', {}, '수정 요청됨'))}
          </div>
          <AdminAlert tone="warning" description="Executive Portfolio Review — Self-Review 서버 차단(작성자 ≠ 평가자) · Evidence 없는 Review/Decision Reference 차단 · Review ≠ Approval · Decision Reference ≠ Capital Allocation. 최종 Portfolio 결정은 반드시 사람이 수행합니다." />
          {eventList([...evByType('portfolio_review_requested'), ...evByType('executive_review_requested'), ...evByType('strategy_review_requested'), ...evByType('portfolio_revision_requested')], 'Review 요청 없음', 'Portfolio/Executive/Strategy Review 요청이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'reviewed' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Review/Decision References — 사람 결정 기록(≠ Approval/Capital Allocation·자동 집행 없음)." />
          {pfList(portfolios.filter((p) => p.review_reference != null || p.decision_reference != null), 'Reference Portfolio 없음', '사람 검토/결정이 기록된 Portfolio 가 여기에 표시됩니다.')}
          {eventList([...evByType('portfolio_review_reference_recorded'), ...evByType('portfolio_decision_reference_recorded')], 'Reference 이벤트 없음', '검토/결정 Reference 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'links' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {pfSelect}{reasonInput}
            {btn('Initiative Link(0545 실존 검증)', () => pfEvent('initiative_reference_linked', { note: reason.trim() }, 'Initiative Link 기록됨'), true)}
            {btn('Business Value Link(0549)', () => pfEvent('business_value_reference_linked', { note: reason.trim() }, 'Business Value Link 기록됨'))}
            {btn('KPI Link(0548)', () => pfEvent('kpi_reference_linked', { note: reason.trim() }, 'KPI Link 기록됨'))}
            {btn('Program Link(0547)', () => pfEvent('program_reference_linked', { note: reason.trim() }, 'Program Link 기록됨'))}
            {btn('Resource Link(0546)', () => pfEvent('resource_reference_linked', { note: reason.trim() }, 'Resource Link 기록됨'))}
          </div>
          <AdminAlert tone="info" description="Reference Link — ID 지정 시 실존 검증(0545/0546/0547/0548/0549). Link ≠ 확대/축소/배정 결정." />
          {eventList([...evByType('initiative_reference_linked'), ...evByType('business_value_reference_linked'), ...evByType('kpi_reference_linked'), ...evByType('program_reference_linked'), ...evByType('resource_reference_linked')], 'Reference Link 없음', '참조 연결 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'learning' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {pfSelect}{reasonInput}
            {btn('Portfolio Learning 기록', () => pfEvent('portfolio_learning_reference_recorded', { note: reason.trim() }, 'Learning Reference 기록됨'), true)}
          </div>
          <AdminAlert tone="info" description="Learning Reference ≠ 자동 Portfolio 변경 — 학습 반영 여부는 사람이 결정합니다." />
          {eventList(evByType('portfolio_learning_reference_recorded'), 'Learning Reference 없음', '포트폴리오 학습 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'flow' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Portfolio 흐름 관측 — 단계별 기록 존재 여부만 표시합니다(자동 진행 아님)." />
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
          <AdminAlert tone="info" description={`Portfolio 이벤트 32종 통합 Audit — 총 ${NUM(num('portfolio_events', 'total'))}건. 자동 승인 이벤트 생성 금지.`} />
          {eventList(audit, 'Audit 이벤트 없음', '모든 Portfolio Intelligence 활동이 여기에 기록됩니다.')}
        </div>
      )}

      {tab === 'support' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description={`분류 6종(fully/partially/advisory_only/human_review_only/unavailable/insufficient_data) — 컴포넌트 ${ENTERPRISE_PORTFOLIO_COMPONENTS.length}종 · 매트릭스 ${ENTERPRISE_PORTFOLIO_SUPPORT_MATRIX.length}항목. unavailable 은 전부 automatic_*(자동 투자 승인/자본 배분 없음).`} />
          <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
            {ENTERPRISE_PORTFOLIO_SUPPORT_MATRIX.map((e) => (
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
