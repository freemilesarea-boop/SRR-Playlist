/**
 * StrategicAdvisorySection — Executive Strategic Intelligence, Scenario
 * Optimization & Decision Advisory Center (Phase AI-OPS-20).
 *
 * Forecast → Scenario Comparison → Trade-off Analysis → Executive Advisory →
 * Human Decision. AI는 비교/분석/설명/권고만 — 최종 의사결정은 항상 사람.
 * Recommendation ≠ Decision · Scenario ≠ Reality · Confidence ≠ Correctness.
 *
 * 탭 18개(Executive Cockpit 2.0 포함).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3, Briefcase, GitBranch, Grid3x3, History, Layers, Lightbulb, ListChecks, Lock,
  RefreshCw, Scale, ScrollText, Shield, Target, TrendingUp,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchAdvisorySummary, createScenarioComparison, reviewScenarioComparison, fetchScenarioComparisons,
  createExecAdvisory, reviewExecAdvisory, fetchExecAdvisories, recordAdvisoryGovernance,
  fetchAdvisoryAudit, fetchForecasts, fetchPriorityPortfolios, fetchExecPriorities,
  type AdvisorySummary, type ScenarioComparisonRow, type ExecAdvisoryRow, type AdvisoryEventRow,
  type ForecastRow, type PriorityPortfolioRow, type ExecPriorityRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  buildScenarioComparison, analyzeTradeoff, buildDecisionMatrix, classifyStrategyPosture,
  analyzePortfolioBalance, buildExecutiveAdvisory, validateExplainability, buildExecutiveBriefing20,
  evaluateStrategicAlignment, projectDecisionImpact, buildExecutiveCockpit20, buildAdvisoryConfidence,
  ADVISORY_SUPPORT, type ScenarioInput,
} from '@/lib/strategicAdvisory';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'cockpit20' | 'comparison' | 'tradeoffs' | 'matrix' | 'postures' | 'portfolioadvisory'
  | 'recommendations' | 'explainability' | 'briefing' | 'alignment' | 'impact' | 'advisoryconfidence'
  | 'advisories' | 'comparisons' | 'humanreviews' | 'external' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'cockpit20', label: 'Executive Cockpit 2.0', icon: Layers },
  { key: 'comparison', label: 'Scenario Comparison', icon: BarChart3 },
  { key: 'tradeoffs', label: 'Trade-off Intelligence', icon: Scale },
  { key: 'matrix', label: 'Decision Matrix', icon: Grid3x3 },
  { key: 'postures', label: 'Strategy Optimization', icon: Target },
  { key: 'portfolioadvisory', label: 'Portfolio Advisory', icon: Briefcase },
  { key: 'recommendations', label: 'Recommendation Engine', icon: Lightbulb },
  { key: 'explainability', label: 'Explainable Strategy', icon: ListChecks },
  { key: 'briefing', label: 'Executive Briefing', icon: ScrollText },
  { key: 'alignment', label: 'Strategic Alignment', icon: GitBranch },
  { key: 'impact', label: 'Decision Impact Projection', icon: TrendingUp },
  { key: 'advisoryconfidence', label: 'Advisory Confidence', icon: Shield },
  { key: 'advisories', label: 'Advisory Records', icon: History },
  { key: 'comparisons', label: 'Comparison Records', icon: History },
  { key: 'humanreviews', label: 'Human Reviews', icon: Scale },
  { key: 'external', label: 'External References', icon: ScrollText },
  { key: 'audit', label: 'Audit', icon: ScrollText },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

export default function StrategicAdvisorySection() {
  const [tab, setTab] = useState<Tab>('cockpit20');
  const [summary, setSummary] = useState<AdvisorySummary>({});
  const [comparisons, setComparisons] = useState<ScenarioComparisonRow[]>([]);
  const [advisories, setAdvisories] = useState<ExecAdvisoryRow[]>([]);
  const [audit, setAudit] = useState<AdvisoryEventRow[]>([]);
  const [forecasts, setForecasts] = useState<ForecastRow[]>([]);
  const [portfolios, setPortfolios] = useState<PriorityPortfolioRow[]>([]);
  const [priorities, setPriorities] = useState<ExecPriorityRow[]>([]);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, cm, ad, au, fc, pf, pr] = await Promise.all([
        fetchAdvisorySummary(), fetchScenarioComparisons(null, 50), fetchExecAdvisories(null, 100),
        fetchAdvisoryAudit(100), fetchForecasts(null, 100), fetchPriorityPortfolios(null, 50),
        fetchExecPriorities(null, 100),
      ]);
      setSummary(s); setComparisons(cm); setAdvisories(ad); setAudit(au);
      setForecasts(fc); setPortfolios(pf); setPriorities(pr);
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

  /* ── 순수 로직 분석(Forecast/Portfolio 실측 입력) ── */
  const inputActuals = useMemo(() => (summary.input_actuals ?? {}) as Record<string, number | string>, [summary]);

  const orgForecast = useMemo(() => forecasts.find((f) => f.forecast_kind === 'organizational_delivery_forecast'), [forecasts]);
  const baseProbability = orgForecast?.probability_reference ?? null;

  const scenarios: ScenarioInput[] = useMemo(() => {
    const base = baseProbability;
    return [
      { name: 'Current Strategy', posture: 'current', expectedDelivery: base, expectedRisk: base == null ? null : clamp(100 - base), expectedCostKrw: null, expectedImpact: base, expectedTimelineDays: null, confidence: orgForecast?.forecast_confidence ?? null },
      { name: 'Conservative Strategy', posture: 'conservative', expectedDelivery: base == null ? null : clamp(base + 10), expectedRisk: base == null ? null : clamp((100 - base) - 20), expectedCostKrw: null, expectedImpact: base == null ? null : clamp(base - 15), expectedTimelineDays: null, confidence: base == null ? null : clamp((orgForecast?.forecast_confidence ?? 50) + 10) },
      { name: 'Balanced Strategy', posture: 'balanced', expectedDelivery: base, expectedRisk: base == null ? null : clamp(100 - base), expectedCostKrw: null, expectedImpact: base, expectedTimelineDays: null, confidence: orgForecast?.forecast_confidence ?? null },
      { name: 'Aggressive Strategy', posture: 'aggressive', expectedDelivery: base == null ? null : clamp(base - 10), expectedRisk: base == null ? null : clamp((100 - base) + 25), expectedCostKrw: null, expectedImpact: base == null ? null : clamp(base + 20), expectedTimelineDays: null, confidence: base == null ? null : clamp((orgForecast?.forecast_confidence ?? 50) - 15) },
    ];
  }, [baseProbability, orgForecast]);

  const comparison = useMemo(() => buildScenarioComparison(scenarios), [scenarios]);
  const tradeoff = useMemo(() => analyzeTradeoff(scenarios[1], scenarios[3]), [scenarios]);
  const matrix = useMemo(() => buildDecisionMatrix(scenarios, { unknownFactors: ['market_data', 'customer_satisfaction'], assumptions: ['현 인력/Capacity 유지', 'Forecast(0522) 입력 기준'], evidenceCoverage: orgForecast?.evidence_coverage ?? null }), [scenarios, orgForecast]);
  const postures = useMemo(() => scenarios.map((s) => ({ s, p: classifyStrategyPosture({ expectedRisk: s.expectedRisk, expectedImpact: s.expectedImpact }) })), [scenarios]);

  const selectedPortfolio = portfolios.find((p) => p.review_status === 'selected_reference') ?? portfolios[0] ?? null;
  const portfolioAdvisory = useMemo(() => {
    if (!selectedPortfolio) return null;
    const included = priorities.filter((p) => selectedPortfolio.priority_candidate_ids.includes(p.id));
    return analyzePortfolioBalance({
      includedCount: included.length,
      hardRiskCount: included.filter((p) => (p.hard_risk_flags ?? []).length > 0).length,
      domains: included.map((p) => p.priority_domain),
      totalReviewHours: selectedPortfolio.total_review_hours,
      availableReviewHours: null,
      expectedCompletionPct: baseProbability,
    });
  }, [selectedPortfolio, priorities, baseProbability]);

  const sampleAdvisory = useMemo(() => buildExecutiveAdvisory({
    type: 'gather_more_evidence',
    title: 'Forecast 근거 보강',
    summary: 'Forecast 이력·Delivery Snapshot 표본이 부족하여 Scenario 비교 신뢰도가 제한됨',
    reasoningChain: ['Forecast 표본이 5 미만이고', 'Scenario 수치가 Forecast 파생 추정이며', 'Evidence Coverage 가 낮기 때문'],
    evidence: ['forecast_summary(0522)'],
    confidence: 40, alternatives: [], assumptions: ['운영 데이터 누적 지속'], unknownFactors: ['market_data'],
  }), []);

  const explainCheck = useMemo(() => validateExplainability(
    'reasoningChain' in sampleAdvisory ? sampleAdvisory.reasoningChain : null,
    'evidence' in sampleAdvisory ? sampleAdvisory.evidence : null,
  ), [sampleAdvisory]);

  const briefing = useMemo(() => buildExecutiveBriefing20({
    period: 'weekly',
    keyChanges: forecasts.slice(0, 5).map((f) => `${f.forecast_code}(${f.forecast_kind})`),
    coreRisks: ['단일 Admin 운영(실측)', ...(baseProbability != null && baseProbability < 50 ? ['조직 Delivery 확률 50% 미만(예측)'] : [])],
    opportunities: baseProbability != null && baseProbability >= 50 ? ['Delivery 확률 유지 시 Portfolio 완료 기대(보장 아님)'] : [],
    unknowns: ['market_data', 'customer_satisfaction', 'delivery snapshot 이력 부족'],
    recommendations: advisories.filter((a) => a.advisory_status === 'pending_executive_review').slice(0, 5).map((a) => a.title),
  }), [forecasts, baseProbability, advisories]);

  const alignments = useMemo(() => scenarios.map((s) => evaluateStrategicAlignment({
    scenarioName: s.name,
    matchedPriorities: priorities.length ? priorities.filter((p) => p.priority_status === 'accepted_reference').length : null,
    totalPriorities: priorities.length || null,
    policyConflicts: null, governanceIssues: null,
  })), [scenarios, priorities]);

  const impact = useMemo(() => projectDecisionImpact(scenarios, [
    { key: 'revenue', available: typeof inputActuals.mrr_actual === 'number' },
    { key: 'growth', available: true },
    { key: 'customer_satisfaction', available: false },
  ]), [scenarios, inputActuals]);

  const advisoryConfidence = useMemo(() => buildAdvisoryConfidence({
    componentValues: [orgForecast?.forecast_confidence ?? null, orgForecast?.evidence_coverage ?? null, comparison.status === 'advisory_reference' ? 60 : null],
    unknownFactors: ['market_data', 'customer_satisfaction'],
    assumptions: ['Forecast(0522) 입력 기준', '현 Capacity 유지'],
    inputAgeDays: orgForecast ? Math.round((now.getTime() - new Date(orgForecast.generated_at).getTime()) / 86400000) : null,
  }), [orgForecast, comparison, now]);

  const cockpit = useMemo(() => buildExecutiveCockpit20({
    strategy: baseProbability == null ? 'Forecast 입력 대기' : `조직 Delivery 확률 ${baseProbability}%(예측)`,
    comparisonCount: comparisons.length,
    matrixReady: matrix.rows.some((r) => r.benefit != null),
    pendingAdvisories: advisories.filter((a) => a.advisory_status === 'pending_executive_review').length,
    portfolioBalance: portfolioAdvisory?.balance ?? 'insufficient_data',
    tradeoffChains: tradeoff.chains.length,
    projectionAvailable: impact.rows.filter((r) => r.direction !== 'projection_unavailable').length,
    projectionUnavailable: impact.rows.filter((r) => r.direction === 'projection_unavailable').length,
    healthStatus: advisoryConfidence.confidence == null ? 'insufficient_data' : advisoryConfidence.confidence >= 60 ? 'watch_candidate' : 'advisory_unverified',
    briefingPeriod: 'weekly',
  }), [baseProbability, comparisons, matrix, advisories, portfolioAdvisory, tradeoff, impact, advisoryConfidence]);

  if (loading) return <AdminCard title="Executive Strategic Intelligence & Decision Advisory Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Executive Strategic Intelligence & Decision Advisory Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  return (
    <AdminCard
      title="Executive Strategic Intelligence & Decision Advisory Center"
      subtitle="Forecast→Scenario Comparison→Trade-off→Executive Advisory→Human Decision — Recommendation ≠ Decision·Scenario ≠ Reality·Confidence ≠ Correctness"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="자동 전략 선택/Executive Decision/Priority·Portfolio·Budget·Commitment·Owner·KPI·Policy·계약·Production 변경/Merge/Deploy 는 없습니다. AI는 비교·분석·설명·권고만 수행하며 최종 의사결정은 항상 사람이 합니다. Recommendation ≠ Decision, Scenario ≠ Reality, Projection ≠ Outcome, Forecast ≠ Guarantee, Confidence ≠ Correctness. 근거(설명 체인) 없는 추천은 서버에서 차단됩니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {/* ── Cockpit 2.0 ── */}
      {tab === 'cockpit20' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {cockpit.sections.map((s) => (
              <div key={s.key} className="rounded-lg border border-border p-2">
                <p className="text-[10px] font-bold uppercase text-muted-foreground">{s.key}</p>
                <p className="mt-0.5 text-sm font-black">{s.headline}</p>
                <p className="text-[10px] text-muted-foreground">{s.detail}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => recordAdvisoryGovernance('cockpit_reviewed', r, { sections: cockpit.sections.length }), 'Cockpit 검토 기록');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Cockpit 검토 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="검토 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          <p className="text-[10px] text-muted-foreground">humanDecisionRequired · autoExecution=false · MRR 실측 {NUM(typeof inputActuals.mrr_actual === 'number' ? inputActuals.mrr_actual : null)}원</p>
        </div>
      )}

      {/* ── Scenario Comparison ── */}
      {tab === 'comparison' && (
        <div className="space-y-2">
          <div className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={comparison.status === 'advisory_reference' ? 'info' : 'warning'}>{comparison.status}</AdminBadge>
            <span className="ml-2 text-muted-foreground">Scenario {comparison.rows.length}개 — Scenario ≠ Reality · 자동 선택 없음</span>
          </div>
          {comparison.rows.map((s) => (
            <div key={s.name} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{s.name}</span>
              <AdminBadge tone="neutral">{s.posture}</AdminBadge>
              <span className="ml-2 text-muted-foreground">Delivery {s.expectedDelivery ?? 'null'} · Risk {s.expectedRisk ?? 'null'} · Impact {s.expectedImpact ?? 'null'} · Confidence {s.confidence ?? 'null'} · 완성도 {s.completeness}%</span>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => createScenarioComparison({ code: `cmp_${now.toISOString().slice(0, 19)}`, title: r.slice(0, 100), scenarios: comparison.rows as unknown as Array<Record<string, unknown>>, evidence: [{ label: 'source', value: 'forecast(0522) 파생' }], tradeoffs: tradeoff.chains as unknown as Array<Record<string, unknown>>, matrix: matrix.rows as unknown as Array<Record<string, unknown>> }), '비교 기록(자동 선택 없음)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">현재 비교 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="비교 제목(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          <p className="text-[10px] text-muted-foreground">수치는 조직 Delivery Forecast(0522) 파생 추정이며 Cost/Timeline 원본 없음(null 유지).</p>
        </div>
      )}

      {/* ── Trade-offs ── */}
      {tab === 'tradeoffs' && (
        <div className="space-y-2">
          {!tradeoff.chains.length ? <AdminEmpty title="Trade-off 체인 없음" description="Forecast 입력이 생기면 Conservative ↔ Aggressive 비교 체인을 구성합니다." /> : tradeoff.chains.map((c, i) => (
            <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone="info">{c.factor}</AdminBadge>
              <span className="ml-2">{c.direction}</span>
              <span className="ml-2 text-muted-foreground">→ {c.consequence}</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">Trade-off 분석 ≠ 최적화 보장(optimizationGuaranteed=false) · 9요소: Revenue/Growth/Risk/Cost/Speed/Quality/Load/Capacity/Sustainability</p>
        </div>
      )}

      {/* ── Decision Matrix ── */}
      {tab === 'matrix' && (
        <div className="space-y-2">
          {matrix.rows.map((r) => (
            <div key={r.name} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{r.name}</span>
              <span className="ml-2 text-muted-foreground">Benefit {r.benefit ?? 'null'} · Risk {r.risk ?? 'null'} · Cost {r.cost ?? 'null(원본 없음)'} · Timeline {r.timeline ?? 'null'} · Confidence {r.confidence ?? 'null'}</span>
            </div>
          ))}
          <AdminAlert tone="warning" title="Unknown / Assumptions" description={`Unknown: ${matrix.unknownFactors.join(', ')} · Assumptions: ${matrix.assumptions.join(', ')} · Evidence Coverage: ${matrix.evidenceCoverage ?? '—'}`} />
          <p className="text-[10px] text-muted-foreground">decisionMadeByAI=false — Matrix 는 사람 의사결정 보조 자료입니다.</p>
        </div>
      )}

      {/* ── Strategy Postures ── */}
      {tab === 'postures' && (
        <div className="space-y-1">
          {postures.map(({ s, p }) => (
            <div key={s.name} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{s.name}</span>
              <AdminBadge tone={p.posture === 'insufficient_data' ? 'warning' : 'info'}>{p.posture}</AdminBadge>
              <p className="mt-1 text-muted-foreground">장점: {p.pros.join(', ') || '—'} · 단점: {p.cons.join(', ') || '—'}</p>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">분류·장단점 설명만 — 자동 선택 없음(autoSelected=false)</p>
        </div>
      )}

      {/* ── Portfolio Advisory ── */}
      {tab === 'portfolioadvisory' && (
        !portfolioAdvisory ? <AdminEmpty title="Portfolio 없음" description="0519 Portfolio 가 생기면 Balance/Capacity/Risk 분포를 분석합니다." /> : (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Box label="Balance" value={portfolioAdvisory.balance} />
              <Box label="Risk 분포" value={portfolioAdvisory.riskDistribution} />
              <Box label="Resource Pressure" value={portfolioAdvisory.resourcePressure} />
              <Box label="Expected Completion(예측)" value={portfolioAdvisory.expectedCompletion == null ? 'unknown' : `${portfolioAdvisory.expectedCompletion}%`} />
            </div>
            {portfolioAdvisory.findings.length > 0 && <AdminAlert tone="warning" description={portfolioAdvisory.findings.join(' · ')} />}
            <p className="text-[10px] text-muted-foreground">autoRebalanced=false — 재조정 권고는 사람 승인 후에만.</p>
          </div>
        )
      )}

      {/* ── Recommendations / Explainability ── */}
      {tab === 'recommendations' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              if (!('reasoningChain' in sampleAdvisory)) return;
              void act(() => createExecAdvisory({ code: `adv_${now.toISOString().slice(0, 19)}`, type: sampleAdvisory.type, title: sampleAdvisory.title, summary: r.slice(0, 200), reasoning: sampleAdvisory.reasoningChain.map((s) => ({ step: s })), evidence: sampleAdvisory.evidence.map((e) => ({ ref: e })), confidence: sampleAdvisory.confidence, assumptions: sampleAdvisory.assumptions.map((a) => ({ note: a })), unknown: sampleAdvisory.unknownFactors.map((u) => ({ factor: u })) }), 'Advisory 기록(Recommendation ≠ Decision)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">근거 보강 권고 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="권고 설명(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!advisories.length ? <AdminEmpty title="권고 없음" description="설명 체인 2단계 미만 권고는 서버에서 차단됩니다." /> : advisories.map((a) => (
            <div key={a.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{a.advisory_code}</span>
                <AdminBadge tone="info">{a.advisory_type}</AdminBadge>
                <AdminBadge tone={a.advisory_status === 'accepted_reference' ? 'success' : a.advisory_status === 'pending_executive_review' ? 'warning' : 'neutral'}>{a.advisory_status}</AdminBadge>
                {(a.warnings ?? []).length > 0 && <AdminBadge tone="warning">warnings {a.warnings.length}</AdminBadge>}
              </div>
              <p className="mt-1">{a.title} · confidence {a.advisory_confidence ?? 'null'}(≠ Correctness)</p>
              {!['rejected', 'invalidated'].includes(a.advisory_status) && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {(['under_review', 'accepted_reference', 'deferred_reference', 'rejected'] as const).map((st) => (
                    <button key={st} disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewExecAdvisory(a.id, st, rr), `${st}(결정/실행 아님)`); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{st}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {tab === 'explainability' && (
        <div className="space-y-2">
          <div className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={explainCheck.explainable ? 'success' : 'danger'}>{explainCheck.explainable ? 'explainable' : 'not_explainable'}</AdminBadge>
            <span className="ml-2 text-muted-foreground">{explainCheck.why}</span>
          </div>
          {'reasoningChain' in sampleAdvisory && (
            <div className="rounded-lg border border-border p-2 text-[11px]">
              <p className="font-bold">예시: 왜 "{sampleAdvisory.title}"를 권고하는가?</p>
              {sampleAdvisory.reasoningChain.map((s, i) => <p key={i} className="text-muted-foreground">{'↓ '.repeat(i > 0 ? 1 : 0)}{s}</p>)}
            </div>
          )}
          {advisories.slice(0, 10).map((a) => (
            <div key={a.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{a.advisory_code}</span>
              <span className="ml-2 text-muted-foreground">체인 {(a.reasoning_chain ?? []).length}단계 · Evidence {(a.evidence ?? []).length}건</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">근거 없는 추천 금지 — 설명 체인 2단계 미만은 서버 raise.</p>
        </div>
      )}

      {/* ── Briefing / Alignment / Impact / Confidence ── */}
      {tab === 'briefing' && (
        <div className="space-y-2">
          {([['주요 변화', briefing.sections.keyChanges], ['핵심 Risk(생략 금지)', briefing.sections.coreRisks], ['예상 Opportunity(보장 아님)', briefing.sections.opportunities], ['미확인 요소', briefing.sections.unknowns], ['권고 사항', briefing.sections.recommendations]] as const).map(([label, items]) => (
            <div key={label} className="rounded-lg border border-border p-2 text-[11px]">
              <p className="font-bold">{label}</p>
              {items.length ? items.map((i, idx) => <p key={idx} className="text-muted-foreground">· {i}</p>) : <p className="text-muted-foreground">—</p>}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => recordAdvisoryGovernance('executive_briefing_generated', r, { period: briefing.period, sections: briefing.sections as unknown as Record<string, unknown> }), 'Briefing 기록(자동 발송 없음)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Weekly Briefing 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="기록 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          <p className="text-[10px] text-muted-foreground">{briefing.limitations.join(' · ')} · Today/Weekly/Monthly/Quarterly 지원</p>
        </div>
      )}
      {tab === 'alignment' && (
        <div className="space-y-1">
          {alignments.map((a) => (
            <div key={a.scenario} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{a.scenario}</span>
              <AdminBadge tone={a.verdict === 'aligned_reference' ? 'success' : a.verdict === 'alignment_unverified' ? 'warning' : 'neutral'}>{a.verdict}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{a.alignmentPct == null ? '매핑 자료 없음(임의 생성 금지)' : `일치도 ${a.alignmentPct}%`} · {a.issues.join(' · ') || '이슈 없음'}</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">Corporate Strategy/Priority/Portfolio/Policy/Governance 일치도 — Policy·Governance 매핑은 수동 검토 대상.</p>
        </div>
      )}
      {tab === 'impact' && (
        <div className="space-y-1">
          {impact.rows.map((r, i) => (
            <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{r.scenario}</span>
              <AdminBadge tone="neutral">{r.kpi}</AdminBadge>
              <AdminBadge tone={r.direction === 'projection_unavailable' ? 'danger' : r.direction === 'increase_expected' ? 'success' : 'warning'}>{r.direction}</AdminBadge>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">projectionNotOutcome=true — 예측은 Projection 이며 실제 결과로 간주하지 않습니다.</p>
        </div>
      )}
      {tab === 'advisoryconfidence' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Confidence(≠ Correctness)" value={advisoryConfidence.confidence == null ? 'unknown' : String(advisoryConfidence.confidence)} />
            <Box label="Evidence Coverage" value={advisoryConfidence.evidenceCoverage == null ? '—' : `${advisoryConfidence.evidenceCoverage}%`} />
            <Box label="Freshness" value={advisoryConfidence.freshness} />
            <Box label="정답 보장" value="아님(correctnessImplied=false)" />
          </div>
          <AdminAlert tone="warning" title="Unknown / Assumptions" description={`Unknown: ${advisoryConfidence.unknownFactors.join(', ')} · Assumptions: ${advisoryConfidence.assumptions.join(', ')}`} />
          <p className="text-[10px] text-muted-foreground">{advisoryConfidence.limitations.join(' · ')}</p>
        </div>
      )}

      {/* ── Records / Reviews / External / Audit / Support ── */}
      {tab === 'advisories' && (
        !advisories.length ? <AdminEmpty title="Advisory 기록 없음" description="모든 권고는 사람 검토 대기 상태로 생성됩니다." /> : (
          <div className="space-y-1">
            {advisories.map((a) => (
              <div key={a.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{a.advisory_code}</span>
                <AdminBadge tone="neutral">{a.advisory_status}</AdminBadge>
                <span className="ml-2 text-muted-foreground">{a.recommendation_summary}</span>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'comparisons' && (
        !comparisons.length ? <AdminEmpty title="비교 기록 없음" description="Scenario 비교는 자동 선택 없이 기록됩니다." /> : (
          <div className="space-y-1">
            {comparisons.map((c) => (
              <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-bold">{c.comparison_code}</span>
                  <AdminBadge tone="neutral">{c.review_status}</AdminBadge>
                  {c.selected_scenario_reference && <AdminBadge tone="success">사람 선택: {c.selected_scenario_reference}</AdminBadge>}
                  <span className="text-muted-foreground">{c.title} · {c.scenarios.length} scenarios</span>
                </div>
                {!['rejected', 'invalidated'].includes(c.review_status) && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(['pending_executive_review', 'reviewed_reference', 'human_selected_reference', 'rejected'] as const).map((st) => (
                      <button key={st} disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewScenarioComparison(c.id, st, rr, st === 'human_selected_reference' ? String((c.scenarios[0] as Record<string, unknown>)?.name ?? 'scenario_1') : null), `${st}(선택 Reference ≠ 실행)`); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{st}</button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'humanreviews' && (() => {
        const reviews = audit.filter((e) => ['scenario_comparison_reviewed', 'human_scenario_selected_reference', 'advisory_reviewed', 'cockpit_reviewed'].includes(e.event_type));
        return !reviews.length ? <AdminEmpty title="검토 이력 없음" description="최종 의사결정은 항상 사람이 수행합니다." /> : (
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
        const ext = audit.filter((e) => e.event_type === 'external_advisory_reference');
        return !ext.length ? <AdminEmpty title="외부 참조 없음" description="외부 자문 자료는 참조로만 기록됩니다." /> : (
          <div className="space-y-1">
            {ext.slice(0, 30).map((e) => (
              <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]"><span className="font-mono text-muted-foreground">{e.created_at.slice(0, 16).replace('T', ' ')}</span><span className="ml-2">{e.detail}</span></div>
            ))}
          </div>
        );
      })()}
      {tab === 'audit' && (
        !audit.length ? <AdminEmpty title="Audit 없음" description="비교/권고/검토가 이벤트로 남습니다(14종 whitelist)." /> : (
          <div className="space-y-1">
            {audit.slice(0, 60).map((e) => (
              <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono text-muted-foreground">{e.created_at.slice(0, 16).replace('T', ' ')}</span>
                <AdminBadge tone="neutral">{e.event_type}</AdminBadge>
                <span className="ml-2">{e.detail}</span>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'support' && (
        <div className="space-y-1">
          {ADVISORY_SUPPORT.map((s) => (
            <div key={s.key} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.status === 'supported' ? 'success' : s.status === 'partial' ? 'warning' : 'danger'}>{s.status}</AdminBadge>
              <span className="ml-2 font-bold">{s.label}</span>
              <span className="ml-2 text-muted-foreground">{s.note}</span>
            </div>
          ))}
        </div>
      )}
    </AdminCard>
  );
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <p className="text-[10px] font-bold text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-sm font-black">{value}</p>
    </div>
  );
}
