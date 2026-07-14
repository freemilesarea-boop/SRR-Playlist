/**
 * StrategicScenarioSection — Enterprise Strategic Scenario Intelligence, Portfolio
 * Optimization & Capital Allocation Center (Phase AI-OPS-13).
 *
 * Objective → Assumption/Constraint → Scenario(Base/Upside/Downside/Stress/No-action) →
 * Forecast(범위) → Sensitivity/Break-even/Unit Economics → Initiative → Portfolio →
 * Allocation Safety → Expected Value → Risk-adjusted → Trade-off → Concentration →
 * Recommendation → Executive Decision Reference → Audit.
 * Forecast ≠ 실제 미래 · selected_reference ≠ 집행 · 자동 예산/실행 없음.
 *
 * 탭 36개(스펙 47절 전체).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Banknote, BarChart3, BookOpen, Brain, FileText, Grid3x3, History, Layers,
  Lightbulb, Link2, Lock, RefreshCw, Scale, ScrollText, Target, TrendingDown, TrendingUp, Zap,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchStratSummary, createStratObjective, fetchStratObjectives, saveStratAssumption, fetchStratAssumptions,
  saveStratConstraint, fetchStratConstraints, createStratScenario, reviewStratScenario, fetchStratScenarios,
  createStratInitiative, fetchStratInitiatives, createStratPortfolio, reviewStratPortfolio, fetchStratPortfolios,
  createStratAllocation, fetchStratAllocations, recordStratExternalAction, fetchStratAudit, fetchDMRecords,
  type StratSummary, type StratObjectiveRow, type StratAssumptionRow, type StratConstraintRow,
  type StratScenarioRow, type StratInitiativeRow, type StratPortfolioRow, type StratAllocationRow,
  type StratEventRow, type DMRecordRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  classifyAssumptionVerification, evaluateConstraintStatus, classifyScenarioInput,
  calculateScenarioForecast, calculateForecastReliability, runStressScenario, calculateSensitivity,
  calculateBreakEven, calculateUnitEconomics, evaluatePortfolioFeasibility, validateResourceAllocation,
  detectDoubleAllocation, calculateExpectedValue, calculateRiskAdjustedComparison, evaluateTradeoff,
  calculateOpportunityCost, calculateConcentrationRisk, calculateStrategicOptionValue,
  checkScenarioCompleteness, buildStrategicRecommendation, STRAT_SUPPORT,
  type AssumptionVerification, type ScenarioType, type StrategicRecommendation, type InitiativeInput,
} from '@/lib/strategicScenarioIntelligence';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const KRW = (n: number | null | undefined) => (n == null ? 'cost_unknown' : `₩${Number(n).toLocaleString('ko-KR')}`);

type Tab = 'overview' | 'objectives' | 'assumptions' | 'verification' | 'constraints' | 'validation'
  | 'scenarios' | 'comparison' | 'base' | 'upside' | 'downside' | 'stress' | 'forecasts' | 'reliability'
  | 'sensitivity' | 'breakeven' | 'uniteconomics' | 'initiatives' | 'portfolios' | 'feasibility'
  | 'allocation' | 'allocsafety' | 'capital' | 'ev' | 'riskadjusted' | 'tradeoffs' | 'opportunity'
  | 'concentration' | 'dependencies' | 'optionvalue' | 'recommendations' | 'decisions' | 'external'
  | 'outcomes' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Overview', icon: Layers },
  { key: 'objectives', label: 'Strategic Objectives', icon: Target },
  { key: 'assumptions', label: 'Assumptions', icon: BookOpen },
  { key: 'verification', label: 'Assumption Verification', icon: Scale },
  { key: 'constraints', label: 'Constraints', icon: Lock },
  { key: 'validation', label: 'Constraint Validation', icon: Scale },
  { key: 'scenarios', label: 'Scenarios', icon: Brain },
  { key: 'comparison', label: 'Scenario Comparison', icon: BarChart3 },
  { key: 'base', label: 'Base Case', icon: FileText },
  { key: 'upside', label: 'Upside Case', icon: TrendingUp },
  { key: 'downside', label: 'Downside Case', icon: TrendingDown },
  { key: 'stress', label: 'Stress Case', icon: AlertTriangle },
  { key: 'forecasts', label: 'Forecasts', icon: BarChart3 },
  { key: 'reliability', label: 'Forecast Reliability', icon: Scale },
  { key: 'sensitivity', label: 'Sensitivity Analysis', icon: Zap },
  { key: 'breakeven', label: 'Break-even', icon: Banknote },
  { key: 'uniteconomics', label: 'Unit Economics', icon: Banknote },
  { key: 'initiatives', label: 'Strategic Initiatives', icon: Lightbulb },
  { key: 'portfolios', label: 'Strategic Portfolios', icon: Layers },
  { key: 'feasibility', label: 'Portfolio Feasibility', icon: Scale },
  { key: 'allocation', label: 'Resource Allocation', icon: Banknote },
  { key: 'allocsafety', label: 'Allocation Safety', icon: Lock },
  { key: 'capital', label: 'Capital Allocation', icon: Banknote },
  { key: 'ev', label: 'Expected Value', icon: TrendingUp },
  { key: 'riskadjusted', label: 'Risk-adjusted Comparison', icon: Scale },
  { key: 'tradeoffs', label: 'Trade-offs', icon: Scale },
  { key: 'opportunity', label: 'Opportunity Cost', icon: History },
  { key: 'concentration', label: 'Concentration Risk', icon: AlertTriangle },
  { key: 'dependencies', label: 'Strategic Dependencies', icon: Link2 },
  { key: 'optionvalue', label: 'Strategic Option Value', icon: Lightbulb },
  { key: 'recommendations', label: 'Recommendations', icon: Lightbulb },
  { key: 'decisions', label: 'Executive Decisions', icon: Scale },
  { key: 'external', label: 'External Strategic Actions', icon: ScrollText },
  { key: 'outcomes', label: 'Scenario Outcomes', icon: History },
  { key: 'audit', label: 'Audit', icon: ScrollText },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

const EXT_ACTIONS = ['budget_approved_reference', 'initiative_started_reference', 'initiative_paused_reference', 'initiative_completed_reference', 'enterprise_acquired_reference', 'contract_signed_reference', 'capacity_added_reference', 'hiring_completed_reference', 'partnership_signed_reference', 'product_launched_reference', 'campaign_started_reference', 'cost_reduction_completed_reference', 'strategic_action_cancelled_reference', 'manual_strategic_action_reference'];

export default function StrategicScenarioSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<StratSummary>({});
  const [objectives, setObjectives] = useState<StratObjectiveRow[]>([]);
  const [assumptions, setAssumptions] = useState<StratAssumptionRow[]>([]);
  const [constraints, setConstraints] = useState<StratConstraintRow[]>([]);
  const [scenarios, setScenarios] = useState<StratScenarioRow[]>([]);
  const [initiatives, setInitiatives] = useState<StratInitiativeRow[]>([]);
  const [portfolios, setPortfolios] = useState<StratPortfolioRow[]>([]);
  const [allocations, setAllocations] = useState<StratAllocationRow[]>([]);
  const [audit, setAudit] = useState<StratEventRow[]>([]);
  const [dmRecords, setDmRecords] = useState<DMRecordRow[]>([]);
  const [reason, setReason] = useState('');
  const [extAction, setExtAction] = useState(EXT_ACTIONS[0]);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, ob, as2, co, sc, ini, pf, al, au, dm] = await Promise.all([
        fetchStratSummary(), fetchStratObjectives(null, 100), fetchStratAssumptions(100),
        fetchStratConstraints(100), fetchStratScenarios(null, null, 100), fetchStratInitiatives(100),
        fetchStratPortfolios(null, 100), fetchStratAllocations(100), fetchStratAudit(100), fetchDMRecords('strategy', null, 50),
      ]);
      setSummary(s); setObjectives(ob); setAssumptions(as2); setConstraints(co); setScenarios(sc);
      setInitiatives(ini); setPortfolios(pf); setAllocations(al); setAudit(au); setDmRecords(dm);
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

  /* ── 실측/순수 로직 분석 ── */
  const actuals = useMemo(() => (summary.source_actuals ?? {}) as Record<string, number | string>, [summary]);
  const mrr = typeof actuals.mrr_actual === 'number' ? actuals.mrr_actual : null;
  const activeStores = typeof actuals.active_stores === 'number' ? actuals.active_stores : null;

  const verification = useMemo(() => classifyAssumptionVerification(assumptions.map((a) => ({ verification: a.verification_status as AssumptionVerification }))), [assumptions]);
  const constraintStatuses = useMemo(() => constraints.map((c) => ({ c, status: evaluateConstraintStatus({ current: c.current_value, min: c.minimum_value, max: c.maximum_value, hard: c.hard_constraint }) })), [constraints]);
  const hardViolations = constraintStatuses.filter((x) => x.status === 'hard_constraint_violated');

  const completeness = useMemo(() => checkScenarioCompleteness(scenarios.map((s) => s.scenario_type as ScenarioType)), [scenarios]);
  const inputValidation = useMemo(() => classifyScenarioInput({
    hasObjective: objectives.length > 0, assumptionCount: assumptions.length, constraintCount: constraints.length,
    hasBaseline: mrr != null, hasCostData: false, hasCapacityData: false, inputAgeDays: 0,
  }), [objectives, assumptions, constraints, mrr]);

  const forecasts = useMemo(() => {
    const growth = assumptions.find((a) => a.assumption_type === 'demand_growth')?.input_value ?? null;
    return [
      calculateScenarioForecast({ metric: 'MRR(실측 baseline)', baseline: mrr, growthRatePct: growth, horizonDays: 90, unit: 'krw', unverifiedRatio: verification.unverifiedRatio }),
      calculateScenarioForecast({ metric: '활성 매장', baseline: activeStores, growthRatePct: growth, horizonDays: 90, unverifiedRatio: verification.unverifiedRatio }),
      calculateScenarioForecast({ metric: '계약(서명)', baseline: typeof actuals.contracts_signed === 'number' ? actuals.contracts_signed : null, growthRatePct: growth, horizonDays: 180, unverifiedRatio: verification.unverifiedRatio }),
    ];
  }, [assumptions, mrr, activeStores, actuals, verification]);

  const reliability = useMemo(() => calculateForecastReliability({
    inputCoverage: assumptions.length ? Math.min(100, assumptions.length * 20) : null,
    inputFreshness: 90, assumptionVerification: verification.unverifiedRatio != null ? 100 - verification.unverifiedRatio : null,
    historicalSample: null, contextMatch: null, unknownVariableRatio: 40,
  }), [assumptions, verification]);

  const sensitivities = useMemo(() => {
    if (mrr == null) return [];
    return [
      calculateSensitivity({ variable: 'price(+10%)', baseOutput: mrr, shockedOutput: mrr * 1.1, shockPct: 10 }),
      calculateSensitivity({ variable: 'churn(+10%p 가정)', baseOutput: mrr, shockedOutput: mrr * 0.9, shockPct: 10 }),
      calculateSensitivity({ variable: 'store_growth(+10%)', baseOutput: mrr, shockedOutput: mrr * 1.08, shockPct: 10 }),
    ];
  }, [mrr]);

  const breakEven = useMemo(() => calculateBreakEven({ fixedCost: null, unitRevenue: mrr != null && activeStores ? Math.round(mrr / Math.max(1, activeStores)) : null, unitVariableCost: null }), [mrr, activeStores]);
  const unitEcon = useMemo(() => calculateUnitEconomics({ revenue: typeof actuals.revenue_30d === 'number' ? actuals.revenue_30d : null, units: activeStores, infraCost: null, laborCost: null, marketingCost: null }), [actuals, activeStores]);

  const portfolioFeasibility = useMemo(() => portfolios.map((p) => {
    const inis: InitiativeInput[] = initiatives.filter((i) => p.initiative_ids.includes(i.id)).map((i) => ({
      code: i.initiative_code, requiredBudget: i.required_budget,
      dependencies: i.dependencies ?? [], exclusionGroup: i.mutual_exclusion_group,
      costKnown: i.expected_cost_note !== 'cost_unknown' && i.required_budget != null,
    }));
    return { p, r: evaluatePortfolioFeasibility({ initiatives: inis, totalBudget: p.total_required_budget, hardConstraintViolated: hardViolations.length > 0 }) };
  }), [portfolios, initiatives, hardViolations]);

  const allocSafety = useMemo(() => allocations.map((a) => ({
    a,
    r: validateResourceAllocation({ available: a.available_amount, reserve: a.reserve_amount, items: (a.allocation_items ?? []).map((it) => ({ code: it.initiative_code, amount: it.amount })) }),
  })), [allocations]);
  const doubleAllocs = useMemo(() => detectDoubleAllocation(allocations.map((a) => ({ code: a.candidate_code, items: (a.allocation_items ?? []).map((it) => ({ code: it.initiative_code })) }))), [allocations]);

  const riskAdjusted = useMemo(() => portfolioFeasibility.map(({ p, r }) => ({
    p,
    verdict: calculateRiskAdjustedComparison({
      expectedValue: null, expectedCost: p.total_required_budget, downsideExposure: null,
      confidence: p.confidence, feasible: r.status === 'feasible_reference' || r.status === 'partially_feasible',
      evidenceCount: p.initiative_ids.length,
    }),
  })), [portfolioFeasibility]);

  const concentration = useMemo(() => {
    const byDomain = new Map<string, number>();
    for (const i of initiatives) byDomain.set(i.strategic_domain, (byDomain.get(i.strategic_domain) ?? 0) + 1);
    const total = initiatives.length;
    const top = [...byDomain.values()].sort((a, b) => b - a)[0] ?? null;
    return calculateConcentrationRisk([
      { axis: 'initiative domain', topSharePct: total > 0 && top != null ? Math.round((top / total) * 100) : null },
      { axis: 'payment provider(PayApp 단일 — 코드 실측)', topSharePct: 100 },
      { axis: 'infra provider(Supabase 단일 — 코드 실측)', topSharePct: 100 },
      { axis: 'region', topSharePct: null },
    ]);
  }, [initiatives]);

  const tradeoffs = useMemo(() => [
    evaluateTradeoff({ axis: 'Growth vs Cost', gain: null, loss: null, hardLimitBreached: false }),
    evaluateTradeoff({ axis: 'Speed vs Reliability', gain: null, loss: null, hardLimitBreached: false }),
    evaluateTradeoff({ axis: 'Personalization vs Privacy', gain: 1, loss: 1, hardLimitBreached: hardViolations.some((v) => ['privacy', 'security', 'compliance'].includes(v.c.constraint_type)) }),
  ], [hardViolations]);

  const autoRecs = useMemo(() => {
    const out: StrategicRecommendation[] = [];
    const push = (r: StrategicRecommendation | { insufficient: true; why: string }) => { if (!('insufficient' in r)) out.push(r); };
    if (!completeness.complete && scenarios.length > 0) push(buildStrategicRecommendation({ code: `strec_downside_${now.toISOString().slice(0, 10)}`, recType: 'run_downside_scenario', finding: `누락 시나리오: ${completeness.missing.join(', ')}`, evidenceCount: completeness.missing.length, severity: 'high' }));
    if (verification.unverifiedRatio != null && verification.unverifiedRatio > 50) push(buildStrategicRecommendation({ code: `strec_assumption_${now.toISOString().slice(0, 10)}`, recType: 'validate_market_assumption', finding: `미검증 가정 ${verification.unverifiedRatio}%`, evidenceCount: assumptions.length, severity: 'moderate' }));
    if (breakEven.status === 'cost_unknown') push(buildStrategicRecommendation({ code: `strec_cost_${now.toISOString().slice(0, 10)}`, recType: 'validate_cost_assumption', finding: '고정비/변동비 데이터 없음(cost_unknown)', evidenceCount: 1, severity: 'moderate' }));
    if (concentration.some((c) => c.verdict === 'critical_concentration')) push(buildStrategicRecommendation({ code: `strec_conc_${now.toISOString().slice(0, 10)}`, recType: 'reduce_portfolio_concentration', finding: 'Provider 단일 의존(critical)', evidenceCount: concentration.filter((c) => c.verdict === 'critical_concentration').length, severity: 'high' }));
    if (doubleAllocs.length > 0) push(buildStrategicRecommendation({ code: `strec_dalloc_${now.toISOString().slice(0, 10)}`, recType: 'preserve_resource_reserve', finding: `후보 간 중복 배정 ${doubleAllocs.length}건`, evidenceCount: doubleAllocs.length, severity: 'high' }));
    return out;
  }, [completeness, scenarios, verification, assumptions, breakEven, concentration, doubleAllocs, now]);

  if (loading) return <AdminCard title="Enterprise Strategic Scenario & Portfolio Intelligence Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Enterprise Strategic Scenario & Portfolio Intelligence Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const scenariosByStatus = (summary.scenarios_by_status ?? {}) as Record<string, number>;
  const scenarioList = (types: string[]) => {
    const list = scenarios.filter((s) => types.includes(s.scenario_type));
    if (!list.length) return <AdminEmpty title="시나리오 없음" description="Downside/Stress 를 생략하고 낙관 시나리오만 제시하지 않습니다." />;
    return (
      <div className="space-y-1">
        {list.map((s) => (
          <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono font-bold">{s.scenario_code}</span>
              <AdminBadge tone="info">{s.scenario_type}</AdminBadge>
              <AdminBadge tone="neutral">{s.scenario_horizon}</AdminBadge>
              <AdminBadge tone={s.scenario_status === 'selected_reference' ? 'success' : 'neutral'}>{s.scenario_status}</AdminBadge>
            </div>
            <p className="mt-1">{s.scenario_name}</p>
            <p className="text-muted-foreground">Forecast ≠ 실제 미래 · selected_reference ≠ 실행 승인</p>
            {!['rejected', 'cancelled', 'expired', 'invalidated'].includes(s.scenario_status) && (
              <div className="mt-1 flex flex-wrap gap-1">
                {(['waiting_evidence', 'reviewed', 'selected_reference', 'rejected'] as const).map((t) => (
                  <button key={t} disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewStratScenario(s.id, t, rr), t); }} className={`rounded-md px-2 py-0.5 text-[10px] font-bold disabled:opacity-50 ${t === 'selected_reference' ? 'bg-accent text-black' : 'border border-border hover:bg-muted'}`}>{t}</button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <AdminCard
      title="Enterprise Strategic Scenario & Portfolio Intelligence Center"
      subtitle="목표→가정/제약→시나리오(Base/Downside/Stress)→Forecast 범위→포트폴리오→배분 Safety→Risk-adjusted 비교 — Forecast≠실제 미래(자동 예산/실행 없음)"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="자동 예산 배정/지출/투자, 자동 인력 배치/채용/해고, 자동 가격/요금제/계약/정산 변경, 자동 영업/광고 집행, 자동 서버 증설/축소, 자동 모델 학습/Weight/Prompt/Governance/Trust 변경, Production Apply/Merge/Deploy 는 없습니다. Forecast 는 실제 미래가 아니고 Scenario 는 확정 사업계획이 아니며 selected_reference 는 예산 집행이 아닙니다. 비용 데이터 없으면 cost_unknown, 시장 데이터 없으면 market_data_unavailable — 가짜 수치를 만들지 않습니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {/* ── Overview ── */}
      {tab === 'overview' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Objectives" value={NUM(objectives.length)} />
            <Box label="Assumptions(미검증 %)" value={verification.unverifiedRatio == null ? 'insufficient_data' : `${assumptions.length} (${verification.unverifiedRatio}%)`} />
            <Box label="Constraints(hard)" value={`${NUM(constraints.length)} (${NUM(summary.hard_constraints as number)})`} />
            <Box label="Hard 위반" value={NUM(hardViolations.length)} />
            <Box label="Scenarios" value={NUM(scenarios.length)} />
            <Box label="시나리오 완결성" value={completeness.complete ? 'complete' : `누락: ${completeness.missing.length}`} />
            <Box label="Forecast Reliability" value={reliability.reliability} />
            <Box label="Break-even" value={breakEven.status} />
            <Box label="Initiatives" value={NUM(initiatives.length)} />
            <Box label="Portfolios" value={NUM(portfolios.length)} />
            <Box label="Feasible Portfolios" value={NUM(portfolioFeasibility.filter((x) => x.r.status === 'feasible_reference').length)} />
            <Box label="Allocation Candidates" value={NUM(allocations.length)} />
            <Box label="중복 배정 경고" value={NUM(doubleAllocs.length)} />
            <Box label="Selected 대기" value={NUM(scenariosByStatus.selected_reference ?? 0)} />
            <Box label="MRR(실측)" value={KRW(mrr)} />
            <Box label="자동 예산/실행" value="없음(금지)" />
          </div>
          <p className="text-[10px] text-muted-foreground">실측: 매출 30d {KRW(typeof actuals.revenue_30d === 'number' ? actuals.revenue_30d : null)} · 활성 매장 {NUM(activeStores)} · 계약 {NUM(typeof actuals.contracts_signed === 'number' ? actuals.contracts_signed : null)} · 인건비/마케팅비 {String(actuals.labor_cost)} · 시장 규모 {String(actuals.market_size)}</p>
        </div>
      )}

      {/* ── Objectives ── */}
      {tab === 'objectives' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => createStratObjective({ code: `sobj_${now.toISOString().slice(0, 19)}`, title: r, domain: 'revenue', type: 'mrr_growth', evidence: [{ label: 'mrr_actual', value: mrr }], targetMetric: 'mrr', targetDirection: 'increase', baselineValue: mrr }), 'Objective 기록(proposed — 실행 아님)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">MRR 성장 목표 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="목표 제목/사유(필수)" className="min-w-[220px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!objectives.length ? <AdminEmpty title="Objective 없음" description="active_reference 도 실제 사업 실행을 보장하지 않습니다." /> : objectives.map((o) => (
            <div key={o.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{o.objective_code}</span>
                <AdminBadge tone="info">{o.objective_type}</AdminBadge>
                <AdminBadge tone="neutral">{o.objective_status}</AdminBadge>
              </div>
              <p className="mt-1">{o.title}</p>
              <p className="text-muted-foreground">baseline {NUM(o.baseline_value)} → target {o.target_value == null ? 'expected_outcome_unavailable' : NUM(o.target_value)}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Assumptions / Verification ── */}
      {tab === 'assumptions' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => saveStratAssumption({ code: `sasm_${now.toISOString().slice(0, 19)}`, type: 'demand_growth', description: r, evidence: [{ label: 'manual', value: r.slice(0, 100) }], value: 5, unit: 'percent', verification: 'unverified' }), '가정 기록(unverified — 신뢰 제한 반영)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">성장 가정 기록(+5%/월 예시)</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="가정 설명(필수)" className="min-w-[220px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!assumptions.length ? <AdminEmpty title="Assumption 없음" description="가정 없으면 Forecast 투영을 하지 않습니다(과거 성장률 무조건 연장 금지)." /> : assumptions.map((a) => (
            <div key={a.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{a.assumption_code}</span>
                <AdminBadge tone="info">{a.assumption_type}</AdminBadge>
                <AdminBadge tone={a.verification_status === 'verified_by_internal_data' ? 'success' : 'warning'}>{a.verification_status}</AdminBadge>
                {a.input_value != null && <span className="text-muted-foreground">{a.input_value}{a.value_unit === 'percent' ? '%' : ` ${a.value_unit ?? ''}`}</span>}
              </div>
              <p className="mt-1">{a.description}</p>
            </div>
          ))}
        </div>
      )}
      {tab === 'verification' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="미검증 비중" value={verification.unverifiedRatio == null ? 'insufficient_data' : `${verification.unverifiedRatio}%`} />
            <Box label="판정" value={verification.note} />
          </div>
          <AdminAlert tone="info" description="Unverified Assumption 비중이 높으면 Forecast 신뢰도를 제한합니다(검증 8상태)." />
        </div>
      )}

      {/* ── Constraints / Validation ── */}
      {tab === 'constraints' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => saveStratConstraint({ code: `scon_${now.toISOString().slice(0, 19)}`, type: 'budget', evidence: [{ label: 'manual', value: r.slice(0, 100) }], resourceType: 'budget', max: null, current: null, unit: 'krw', hard: true }), '제약 기록(current null = capacity_unknown)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">예산 Hard 제약 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="제약 설명(필수)" className="min-w-[220px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!constraints.length ? <AdminEmpty title="Constraint 없음" description="모델에 없는 제약을 무시한 채 feasible 로 표시하지 않습니다." /> : constraints.map((c) => (
            <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{c.constraint_code}</span>
                <AdminBadge tone="info">{c.constraint_type}</AdminBadge>
                {c.hard_constraint && <AdminBadge tone="danger">hard</AdminBadge>}
                <span className="text-muted-foreground">current {c.current_value == null ? 'capacity_unknown' : NUM(c.current_value)} / max {NUM(c.maximum_value)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {tab === 'validation' && (
        !constraintStatuses.length ? <AdminEmpty title="검증 대상 없음" /> : (
          <div className="space-y-1">
            {constraintStatuses.map(({ c, status }) => (
              <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{c.constraint_code}</span>
                <AdminBadge tone={status === 'satisfied' ? 'success' : status === 'hard_constraint_violated' ? 'danger' : status === 'capacity_unknown' ? 'neutral' : 'warning'}>{status}</AdminBadge>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground">Hard Constraint 위반 시 feasible 후보로 표시하지 않습니다.</p>
          </div>
        )
      )}

      {/* ── Scenarios ── */}
      {tab === 'scenarios' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {(['base_case', 'downside_case', 'stress_case', 'no_action_case'] as const).map((t) => (
              <button key={t} disabled={busy} onClick={() => {
                const r = needReason(); if (!r) return;
                const growth = t === 'base_case' ? 5 : t === 'downside_case' ? -10 : t === 'stress_case' ? -20 : 0;
                const fc = calculateScenarioForecast({ metric: 'mrr', baseline: mrr, growthRatePct: growth, horizonDays: 90, unit: 'krw', unverifiedRatio: verification.unverifiedRatio });
                void act(() => createStratScenario({
                  code: `sscn_${t}_${now.toISOString().slice(0, 19)}`, name: `${r} (${t})`, type: t, horizon: '90_day',
                  evidence: [{ label: 'mrr_baseline', value: mrr }],
                  forecastResults: { mrr: fc }, inputValidation: { verdict: inputValidation.verdict, notes: inputValidation.notes },
                  feasibility: 'feasibility_unverified', confidence: fc.confidence, unknownFactors: fc.unknownFactors,
                }), `${t} 생성(Forecast ≠ 실제 미래)`);
              }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">{t} 생성</button>
            ))}
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="시나리오 이름/사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!completeness.complete && scenarios.length > 0 && <AdminAlert tone="warning" description={`누락 시나리오: ${completeness.missing.join(', ')} — 낙관 시나리오만 제시하지 않습니다.`} />}
          {scenarioList(['base_case', 'upside_case', 'downside_case', 'stress_case', 'conservative_case', 'aggressive_case', 'alternative_case', 'no_action_case', 'custom'])}
        </div>
      )}
      {tab === 'comparison' && (
        !scenarios.length ? <AdminEmpty title="비교 대상 없음" description="단일 숫자 순위만으로 전략을 결정하지 않습니다." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="py-1 pr-2">scenario</th><th className="pr-2">type</th><th className="pr-2">horizon</th><th className="pr-2">MRR expected(low~high)</th><th className="pr-2">confidence</th><th className="pr-2">feasibility</th></tr></thead>
              <tbody>
                {scenarios.map((s) => {
                  const fc = (s.forecast_results as { mrr?: { expected: number | null; low: number | null; high: number | null } } | null)?.mrr;
                  return (
                    <tr key={s.id} className="border-b border-border/50">
                      <td className="py-1 pr-2 font-mono">{s.scenario_code.slice(0, 24)}</td>
                      <td className="pr-2">{s.scenario_type}</td>
                      <td className="pr-2">{s.scenario_horizon}</td>
                      <td className="pr-2">{fc?.expected == null ? 'insufficient_data' : `${KRW(fc.expected)} (${KRW(fc.low)}~${KRW(fc.high)})`}</td>
                      <td className="pr-2">{s.confidence ?? '—'}</td>
                      <td className="pr-2">{s.feasibility_status}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
      {tab === 'base' && scenarioList(['base_case'])}
      {tab === 'upside' && scenarioList(['upside_case', 'aggressive_case'])}
      {tab === 'downside' && scenarioList(['downside_case', 'conservative_case'])}
      {tab === 'stress' && (
        <div className="space-y-2">
          {scenarioList(['stress_case'])}
          <div className="rounded-lg border border-border p-2 text-[11px]">
            <p className="font-bold">Stress 예시(evidence 기반 — 고정 수치 강제 아님)</p>
            {(() => { const r = runStressScenario({ baseline: mrr, shockPct: -20, evidenceBased: true }); return <p className="mt-1 text-muted-foreground">Revenue -20% 가정: {r.stressed == null ? r.note : `${KRW(r.stressed)} — ${r.note}`}</p>; })()}
          </div>
        </div>
      )}

      {/* ── Forecasts / Reliability ── */}
      {tab === 'forecasts' && (
        <div className="space-y-1">
          {forecasts.map((f) => (
            <div key={f.metric} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{f.metric}</span>
                <AdminBadge tone="neutral">{f.method}</AdminBadge>
                {f.confidence != null && <span className="text-muted-foreground">confidence {f.confidence}</span>}
              </div>
              <p className="mt-1">{f.expected == null ? 'insufficient_data — 투영 금지' : `baseline ${NUM(f.baseline)} → expected ${NUM(f.expected)} (범위 ${NUM(f.low)}~${NUM(f.high)}, ${f.horizonDays}d)`}</p>
              <p className="text-muted-foreground">{f.unknownFactors.join(' · ')} — 실제 미래 아님</p>
            </div>
          ))}
        </div>
      )}
      {tab === 'reliability' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Forecast Reliability" value={reliability.score == null ? reliability.reliability : `${reliability.score} (${reliability.reliability})`} />
            <Box label="Note" value={reliability.note} />
          </div>
          <AdminAlert tone="info" description="Input Coverage/신선도/가정 검증/표본/Context/Unknown 비율 6성분 재정규화 — High Confidence 라고 실제 결과를 보장하지 않습니다. Forecast Error History 는 초기 표본 부족(insufficient)." />
        </div>
      )}

      {/* ── Sensitivity / Break-even / Unit Economics ── */}
      {tab === 'sensitivity' && (
        !sensitivities.length ? <AdminEmpty title="분석 대상 없음" description="MRR baseline 이 있어야 민감도를 계산합니다." /> : (
          <div className="space-y-1">
            {sensitivities.map((s) => (
              <div key={s.variable} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-bold">{s.variable}</span>
                <AdminBadge tone={s.verdict === 'critical_sensitivity' || s.verdict === 'high_sensitivity' ? 'danger' : s.verdict === 'moderate_sensitivity' ? 'warning' : 'info'}>{s.verdict}</AdminBadge>
                {s.elasticity != null && <span className="ml-2 text-muted-foreground">elasticity {s.elasticity}</span>}
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground">어떤 변수가 결과를 가장 크게 흔드는지 표시 — 예시 shock 기반(가정치).</p>
          </div>
        )
      )}
      {tab === 'breakeven' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="상태" value={breakEven.status} />
            <Box label="필요 단위 수" value={breakEven.requiredUnits == null ? '—' : NUM(breakEven.requiredUnits)} />
          </div>
          <AdminAlert tone="info" description={`${breakEven.note} — 고정비/변동비 데이터가 없으면 가짜 손익분기점을 만들지 않습니다.`} />
        </div>
      )}
      {tab === 'uniteconomics' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Revenue per Store(추정)" value={unitEcon.revenuePerUnit == null ? 'insufficient_data' : KRW(unitEcon.revenuePerUnit)} />
            <Box label="Infra Cost per Store" value={unitEcon.infraCostPerUnit == null ? 'cost_unknown' : KRW(unitEcon.infraCostPerUnit)} />
            <Box label="Gross Margin" value={unitEcon.grossMarginNote} />
            <Box label="CAC" value={unitEcon.cacNote} />
          </div>
          <AdminAlert tone="info" description="실측과 추정을 분리합니다. 인건비·마케팅비가 없으므로 완전한 CAC/마진이 아닙니다." />
        </div>
      )}

      {/* ── Initiatives / Portfolios / Feasibility ── */}
      {tab === 'initiatives' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => createStratInitiative({ code: `sini_${now.toISOString().slice(0, 19)}`, title: r, type: 'expand_store_candidate', domain: 'store', evidence: [{ label: 'active_stores', value: activeStores }], budget: null, costNote: 'cost_unknown' }), 'Initiative 후보 기록(프로젝트 생성 아님)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">매장 확장 후보 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Initiative 제목(필수)" className="min-w-[220px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!initiatives.length ? <AdminEmpty title="Initiative 없음" /> : initiatives.map((i) => (
            <div key={i.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{i.initiative_code}</span>
                <AdminBadge tone="info">{i.initiative_type}</AdminBadge>
                <span className="text-muted-foreground">budget {i.required_budget == null ? 'cost_unknown' : KRW(i.required_budget)}</span>
                {i.mutual_exclusion_group && <AdminBadge tone="warning">배타: {i.mutual_exclusion_group}</AdminBadge>}
              </div>
              <p className="mt-1">{i.title}</p>
            </div>
          ))}
        </div>
      )}
      {tab === 'portfolios' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy || !initiatives.length} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => createStratPortfolio({ code: `spf_${now.toISOString().slice(0, 19)}`, title: r, type: 'balanced', evidence: [{ label: 'initiatives', value: initiatives.length }], initiativeIds: initiatives.slice(0, 5).map((i) => i.id), totalBudget: null, feasibility: 'resource_capacity_unknown' }), 'Portfolio 후보 생성(예산 미배정)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Balanced Portfolio 생성</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Portfolio 제목/사유(필수)" className="min-w-[220px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!portfolios.length ? <AdminEmpty title="Portfolio 없음" description="selected_reference 도 실제 예산 집행이 아닙니다." /> : portfolios.map((p) => (
            <div key={p.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{p.portfolio_code}</span>
                <AdminBadge tone="info">{p.portfolio_type}</AdminBadge>
                <AdminBadge tone={p.review_status === 'selected_reference' ? 'success' : 'neutral'}>{p.review_status}</AdminBadge>
                {p.self_approval_warning && <AdminBadge tone="warning">self-approval 경고</AdminBadge>}
              </div>
              <p className="mt-1">{p.title} — initiatives {p.initiative_ids.length} · budget {p.total_required_budget == null ? 'resource_capacity_unknown' : KRW(p.total_required_budget)}</p>
              {!['rejected', 'cancelled', 'expired', 'invalidated'].includes(p.review_status) && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {(['waiting_evidence', 'selected_reference', 'deferred_reference', 'rejected'] as const).map((t) => (
                    <button key={t} disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewStratPortfolio(p.id, t, rr), `${t}(≠집행)`); }} className={`rounded-md px-2 py-0.5 text-[10px] font-bold disabled:opacity-50 ${t === 'selected_reference' ? 'bg-accent text-black' : 'border border-border hover:bg-muted'}`}>{t}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {tab === 'feasibility' && (
        !portfolioFeasibility.length ? <AdminEmpty title="Portfolio 없음" /> : (
          <div className="space-y-1">
            {portfolioFeasibility.map(({ p, r }) => (
              <div key={p.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{p.portfolio_code}</span>
                <AdminBadge tone={r.status === 'feasible_reference' ? 'success' : r.status === 'hard_constraint_violated' || r.status === 'infeasible' ? 'danger' : 'warning'}>{r.status}</AdminBadge>
                {r.issues.length > 0 && <p className="mt-1 text-muted-foreground">{r.issues.join(' · ')}</p>}
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Allocation / Safety / Capital ── */}
      {tab === 'allocation' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy || !portfolios.length || !initiatives.length} onClick={() => {
              const r = needReason(); if (!r) return;
              const p = portfolios[0]; const i = initiatives[0];
              void act(() => createStratAllocation({ code: `salloc_${now.toISOString().slice(0, 19)}`, portfolioId: p.id, resourceType: 'budget', allocated: 100, items: [{ initiative_code: i.initiative_code, amount: 100 }], evidence: [{ label: 'manual', value: r.slice(0, 100) }], available: null, reserve: null }), '배분 후보 생성(총량 미확인 → resource_capacity_unknown)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">배분 후보 생성(예시)</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="배분 근거(필수)" className="min-w-[220px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!allocations.length ? <AdminEmpty title="배분 후보 없음" description="실제 Budget/인력/서버 설정을 변경하지 않습니다." /> : allocations.map((a) => (
            <div key={a.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{a.candidate_code}</span>
                <AdminBadge tone="info">{a.resource_type}</AdminBadge>
                <AdminBadge tone={a.constraint_status === 'ready_for_human_review' ? 'success' : 'warning'}>{a.constraint_status}</AdminBadge>
              </div>
              <p className="mt-1 text-muted-foreground">allocated {NUM(a.allocated_amount)} / available {a.available_amount == null ? 'unknown' : NUM(a.available_amount)} / reserve {NUM(a.reserve_amount)}</p>
            </div>
          ))}
        </div>
      )}
      {tab === 'allocsafety' && (
        <div className="space-y-2">
          {doubleAllocs.length > 0 && <AdminAlert tone="danger" title="후보 간 중복 배정" description={doubleAllocs.map((d) => `${d.initiative}: ${d.candidates.join(', ')}`).join(' / ')} />}
          {!allocSafety.length ? <AdminEmpty title="검증 대상 없음" /> : allocSafety.map(({ a, r }) => (
            <div key={a.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{a.candidate_code}</span>
              <AdminBadge tone={r.status === 'ready_for_human_review' ? 'success' : 'warning'}>{r.status}</AdminBadge>
              {r.issues.length > 0 && <p className="mt-1 text-muted-foreground">{r.issues.join(' · ')}</p>}
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">총량 초과/Reserve 침범/중복 배정은 서버와 순수 로직이 이중 차단합니다.</p>
        </div>
      )}
      {tab === 'capital' && (
        <AdminAlert tone="info" description="Capital Allocation 은 내부 검토 Reference 일 뿐 회계 전표나 실제 송금이 아닙니다. 배분 후보는 Resource Allocation 탭에서 관리하며, 실제 집행은 외부에서 수행 후 External Strategic Actions 탭에 참고 기록만 남깁니다." />
      )}

      {/* ── EV / Risk-adjusted / Trade-offs / Opportunity / Concentration ── */}
      {tab === 'ev' && (
        <div className="space-y-2">
          {(() => {
            const ev = calculateExpectedValue({ revenueBenefit: null, costSaving: null, riskReductionScore: 40, nonFinancialNote: '학습 가치(qualitative)' });
            return (
              <>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <Box label="Monetary EV" value={ev.monetary == null ? 'insufficient_data' : KRW(ev.monetary)} />
                  <Box label="Non-monetary" value={ev.nonMonetary.join(' · ') || '없음'} />
                </div>
                <AdminAlert tone="info" description={`${ev.note} — Expected Value ≠ 실제 수익(notActualReturn).`} />
              </>
            );
          })()}
        </div>
      )}
      {tab === 'riskadjusted' && (
        !riskAdjusted.length ? <AdminEmpty title="비교 대상 없음" description={'"최적" 표현은 모든 후보와 제약이 충분히 검토된 경우가 아니면 사용하지 않습니다.'} /> : (
          <div className="space-y-1">
            {riskAdjusted.map(({ p, verdict }) => (
              <div key={p.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{p.portfolio_code}</span>
                <AdminBadge tone={verdict.verdict === 'favorable_candidate' ? 'success' : verdict.verdict === 'high_risk_candidate' || verdict.verdict === 'infeasible' ? 'danger' : 'info'}>{verdict.verdict}</AdminBadge>
                <p className="mt-1 text-muted-foreground">{verdict.note}</p>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'tradeoffs' && (
        <div className="space-y-1">
          {tradeoffs.map((t) => (
            <div key={t.axis} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{t.axis}</span>
              <AdminBadge tone={t.verdict === 'unacceptable_tradeoff' ? 'danger' : t.verdict === 'insufficient_data' ? 'neutral' : 'info'}>{t.verdict}</AdminBadge>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">정량 gain/loss 없는 축은 insufficient_data — 임의 판정하지 않습니다. Privacy/Security hard 제약 위반 시 unacceptable.</p>
        </div>
      )}
      {tab === 'opportunity' && (
        !portfolios.length ? <AdminEmpty title="후보 없음" description="Opportunity Cost 데이터가 없으면 정량 수치를 임의 생성하지 않습니다." /> : (
          <div className="space-y-1">
            {portfolios.slice(0, 5).map((p) => {
              const oc = calculateOpportunityCost({ chosen: p.portfolio_code, foregone: portfolios.filter((x) => x.id !== p.id).map((x) => x.portfolio_code), foregoneValue: null });
              return (
                <div key={p.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <span className="font-mono font-bold">{oc.chosen}</span>
                  <p className="mt-1 text-muted-foreground">포기 후보: {oc.foregone.join(', ') || '없음'} · {oc.note}</p>
                </div>
              );
            })}
          </div>
        )
      )}
      {tab === 'concentration' && (
        <div className="space-y-1">
          {concentration.map((c) => (
            <div key={c.axis} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{c.axis}</span>
              <AdminBadge tone={c.verdict === 'critical_concentration' ? 'danger' : c.verdict === 'high_concentration' ? 'warning' : c.verdict === 'insufficient_data' ? 'neutral' : 'success'}>{c.verdict}</AdminBadge>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">지역/팀 축은 데이터 미존재 — insufficient_data 정직 표기.</p>
        </div>
      )}

      {/* ── Dependencies / Option Value ── */}
      {tab === 'dependencies' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="전략 의존성은 Knowledge Graph(0513)를 재사용합니다 — Initiative 간 의존은 dependencies 선언 기반이며 선행조건 누락 시 dependency_unverified 로 차단됩니다." />
          {initiatives.filter((i) => i.dependencies?.length).length === 0 ? <AdminEmpty title="선언된 의존 없음" /> : initiatives.filter((i) => i.dependencies?.length).map((i) => (
            <div key={i.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{i.initiative_code}</span>
              <span className="ml-2 text-muted-foreground">→ 의존: {i.dependencies.join(', ')}</span>
            </div>
          ))}
        </div>
      )}
      {tab === 'optionvalue' && (
        <div className="space-y-1">
          {!initiatives.length ? <AdminEmpty title="후보 없음" /> : initiatives.slice(0, 10).map((i) => {
            const ov = calculateStrategicOptionValue({ reversibility: (i.reversibility ?? 'unknown') as 'reversible' | 'partially_reversible' | 'irreversible' | 'unknown', learningValue: true, dependencyReduction: false, quantifiedValue: null });
            return (
              <div key={i.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{i.initiative_code}</span>
                <AdminBadge tone="neutral">{ov.verdict}</AdminBadge>
                <span className="ml-2 text-muted-foreground">{ov.factors.join(' · ') || '—'}</span>
              </div>
            );
          })}
          <p className="text-[10px] text-muted-foreground">정량 근거 없으면 qualitative_reference — 억지 환산 없음.</p>
        </div>
      )}

      {/* ── Recommendations / Decisions / External / Outcomes ── */}
      {tab === 'recommendations' && (
        !autoRecs.length ? <AdminEmpty title="권고 없음" description="Evidence 없는 권고는 생성하지 않습니다." /> : (
          <div className="space-y-1">
            {autoRecs.map((r) => (
              <div key={r.code} className="rounded-lg border border-border p-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <AdminBadge tone="info">{r.recType}</AdminBadge>
                  <AdminBadge tone={r.severity === 'high' || r.severity === 'critical' ? 'danger' : 'warning'}>{r.severity}</AdminBadge>
                  <span className="text-muted-foreground">confidence {r.confidence}</span>
                  <AdminBadge tone="warning">Human Approval 필수</AdminBadge>
                </div>
                <p className="mt-1">{r.recommendation}</p>
                <p className="text-muted-foreground">{r.opportunityCostNote} · {r.limitations.join(' · ')}</p>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'decisions' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Executive 결정은 Decision Memory(0514)의 strategy 도메인으로 기록됩니다 — selected_reference ≠ 실제 예산 집행/사업 실행." />
          {!dmRecords.length ? <AdminEmpty title="전략 Decision 기록 없음" /> : dmRecords.map((d) => (
            <div key={d.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{d.decision_code}</span>
              <AdminBadge tone="neutral">{d.decision_status}</AdminBadge>
              <p className="mt-1">{d.decision_summary}</p>
            </div>
          ))}
        </div>
      )}
      {tab === 'external' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="외부에서 실제 전략 실행이 시작된 경우의 참고 기록만 — 시스템이 조치를 실행하지 않습니다." />
          <div className="flex flex-wrap items-center gap-2">
            <select value={extAction} onChange={(e) => setExtAction(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {EXT_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="실행 내용(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
            <button disabled={busy} onClick={() => {
              const rr = needReason(); if (!rr) return;
              void act(() => recordStratExternalAction(extAction, rr, [{ label: 'manual_report', value: rr.slice(0, 200) }]), '참고 기록(reference only)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">참고 기록</button>
          </div>
          {audit.filter((e) => e.event_type === 'external_strategic_action_reference').map((e) => (
            <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="text-muted-foreground">{new Date(e.created_at).toLocaleString('ko-KR')}</span>
              <p className="mt-1">{e.detail}</p>
            </div>
          ))}
        </div>
      )}
      {tab === 'outcomes' && (
        <AdminAlert tone="info" description="Scenario Outcome 은 Decision Memory(0514)의 Observation/Outcome 과 연결됩니다 — 시나리오 선택과 실제 Outcome 을 자동 인과관계로 연결하지 않습니다(causality_unverified). Decision Memory Section 에서 Expected vs Actual 을 검토하세요." />
      )}

      {/* ── Audit / Support ── */}
      {tab === 'audit' && (
        !audit.length ? <AdminEmpty title="감사 이벤트 없음" /> : (
          <div className="space-y-1">
            {audit.map((e) => (
              <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <AdminBadge tone="info">{e.event_type}</AdminBadge>
                  <span className="text-muted-foreground">{new Date(e.created_at).toLocaleString('ko-KR')}</span>
                </div>
                {e.detail && <p className="mt-1 text-muted-foreground">{e.detail}</p>}
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'support' && (
        <div className="space-y-1">
          {STRAT_SUPPORT.map((s) => (
            <div key={s.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.status === 'fully_supported' ? 'success' : s.status === 'unsupported' ? 'danger' : 'info'}>{s.status}</AdminBadge>
              <span className="font-bold">{s.label}</span>
              <span className="text-muted-foreground">{s.note}</span>
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
