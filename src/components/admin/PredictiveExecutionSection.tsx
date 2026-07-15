/**
 * PredictiveExecutionSection — Predictive Execution Intelligence, Strategic
 * Forecasting & Executive Simulation Center (Phase AI-OPS-19).
 *
 * Current Execution → Predictive Modeling → Scenario Simulation → Forecast →
 * Executive Decision Support. 0521(현재 분석) 위의 미래 시뮬레이션 계층.
 * Forecast = Prediction ≠ Outcome · Simulation ≠ Executive Decision ·
 * Confidence 100 ≠ 성공 보장 · 자동 확정/배정/일정/KPI 변경 없음.
 *
 * 탭 20개.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3, Calendar, GitBranch, Grid3x3, History, Layers, Lightbulb,
  Lock, RefreshCw, Scale, ScrollText, Shield, Target, TrendingUp, Users,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchForecastSummary, createForecast, fetchForecasts, createExecSimulation,
  fetchExecSimulations, recordForecastGovernance, fetchForecastAudit,
  fetchCommitments, fetchCommitmentBlockers, fetchCommitmentMilestones, fetchDeliverySnapshots,
  type ForecastSummary, type ForecastRow, type ExecSimulationRow, type ForecastEventRow,
  type CommitmentRow, type CommitmentBlockerRow, type CommitmentMilestoneRow, type DeliverySnapshotRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  calculateCompletionProbability, forecastDeliveryDelay, forecastVerificationReadiness,
  forecastPortfolioCompletion, simulateWhatIf, simulateResourceImpact,
  forecastDependencyPropagation, forecastExecutiveRisk, buildForecastConfidence,
  projectBusinessImpact, buildSimulationGraph, buildForecastTimeline,
  forecastOrganizationalHealth, buildForecastRecommendation, FORECAST_SUPPORT,
} from '@/lib/predictiveExecution';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const ACTIVE_BLOCKER = ['detected', 'pending_review', 'active_reference'];
const CLOSED = ['verified_complete_reference', 'outcome_observation_pending', 'cancelled_reference', 'invalidated', 'expired'];

type Tab = 'overview' | 'completionprob' | 'delayforecast' | 'verificationforecast' | 'portfolioforecast'
  | 'whatif' | 'resourcesim' | 'depforecast' | 'riskforecast' | 'confidence' | 'projection'
  | 'simgraph' | 'timeline' | 'healthforecast' | 'recommendations' | 'forecasts' | 'simulations'
  | 'external' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Overview', icon: Layers },
  { key: 'completionprob', label: 'Completion Probability', icon: BarChart3 },
  { key: 'delayforecast', label: 'Delay Forecast', icon: History },
  { key: 'verificationforecast', label: 'Verification Readiness Forecast', icon: Scale },
  { key: 'portfolioforecast', label: 'Portfolio Forecast', icon: Target },
  { key: 'whatif', label: 'What-if Simulation', icon: Lightbulb },
  { key: 'resourcesim', label: 'Resource Impact Simulation', icon: Users },
  { key: 'depforecast', label: 'Dependency Propagation Forecast', icon: GitBranch },
  { key: 'riskforecast', label: 'Executive Risk Forecast', icon: Shield },
  { key: 'confidence', label: 'Forecast Confidence', icon: Scale },
  { key: 'projection', label: 'Business Impact Projection', icon: TrendingUp },
  { key: 'simgraph', label: 'Executive Simulation Graph', icon: GitBranch },
  { key: 'timeline', label: 'Forecast Timeline', icon: Calendar },
  { key: 'healthforecast', label: 'Predictive Organizational Health', icon: Shield },
  { key: 'recommendations', label: 'Forecast Recommendations', icon: Lightbulb },
  { key: 'forecasts', label: 'Forecast Records', icon: History },
  { key: 'simulations', label: 'Simulation Records', icon: History },
  { key: 'external', label: 'External References', icon: ScrollText },
  { key: 'audit', label: 'Audit', icon: ScrollText },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

export default function PredictiveExecutionSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<ForecastSummary>({});
  const [forecasts, setForecasts] = useState<ForecastRow[]>([]);
  const [simulations, setSimulations] = useState<ExecSimulationRow[]>([]);
  const [audit, setAudit] = useState<ForecastEventRow[]>([]);
  const [commitments, setCommitments] = useState<CommitmentRow[]>([]);
  const [blockers, setBlockers] = useState<CommitmentBlockerRow[]>([]);
  const [milestones, setMilestones] = useState<CommitmentMilestoneRow[]>([]);
  const [deliverySnaps, setDeliverySnaps] = useState<DeliverySnapshotRow[]>([]);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, fc, si, au, co, bl, ms, ds] = await Promise.all([
        fetchForecastSummary(), fetchForecasts(null, 100), fetchExecSimulations(null, 100),
        fetchForecastAudit(100), fetchCommitments(null, 100), fetchCommitmentBlockers(null, 100),
        fetchCommitmentMilestones(null, 100), fetchDeliverySnapshots(null, 50),
      ]);
      setSummary(s); setForecasts(fc); setSimulations(si); setAudit(au);
      setCommitments(co); setBlockers(bl); setMilestones(ms); setDeliverySnaps(ds);
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

  /* ── 실측/순수 로직 예측 ── */
  const inputActuals = useMemo(() => (summary.input_actuals ?? {}) as Record<string, number | string>, [summary]);
  const mrr = typeof inputActuals.mrr_actual === 'number' ? inputActuals.mrr_actual : null;

  const historicalRates = useMemo(() => deliverySnaps.filter((s) => s.snapshot_kind === 'delivery_summary' && s.success_rate != null), [deliverySnaps]);

  const commitmentProbabilities = useMemo(() => commitments.filter((c) => !CLOSED.includes(c.commitment_status)).map((c) => {
    const cMilestones = milestones.filter((m) => m.commitment_id === c.id);
    const verified = cMilestones.length ? (cMilestones.filter((m) => m.milestone_status === 'verified_complete_reference').length / cMilestones.length) * 100 : null;
    const activeBlockers = blockers.filter((b) => b.commitment_id === c.id && ACTIVE_BLOCKER.includes(b.blocker_status)).length;
    const daysToTarget = c.target_reference_at ? (new Date(c.target_reference_at).getTime() - now.getTime()) / 86400000 : null;
    const prob = calculateCompletionProbability({
      verifiedProgress: verified, activeBlockers,
      dependencyClear: (c.dependencies ?? []).length === 0 ? true : null,
      historicalSuccessRate: historicalRates.length ? historicalRates[0].success_rate : null,
      historicalSample: historicalRates.length ? historicalRates[0].sample_size : 0,
      daysToTarget,
    });
    return { c, prob, activeBlockers };
  }), [commitments, milestones, blockers, historicalRates, now]);

  const delayForecast = useMemo(() => forecastDeliveryDelay({
    historicalDelays: null,   // 지연 이력 표본 미축적(실측 — 초기 부족 정직 표기)
    activeBlockers: blockers.filter((b) => ACTIVE_BLOCKER.includes(b.blocker_status)).length,
    dependencyWaitDays: null,
  }), [blockers]);

  const verificationForecasts = useMemo(() => milestones.slice(0, 20).map((m) => ({
    m,
    f: forecastVerificationReadiness({ evidenceProvided: (m.evidence ?? []).length, evidenceRequired: (m.evidence_required ?? []).length, criteriaDefined: (m.success_criteria ?? []).length > 0, reviewerExists: true }),
  })), [milestones]);

  const portfolioForecast = useMemo(() => forecastPortfolioCompletion(
    commitmentProbabilities.map(({ c, prob }) => ({ code: c.commitment_code, probability: prob.probability })),
  ), [commitmentProbabilities]);

  const whatIf = useMemo(() => simulateWhatIf({
    scenario: 'Blocker 전체 해소 가정',
    baseline: { totalReviewHours: null, riskCount: blockers.filter((b) => ACTIVE_BLOCKER.includes(b.blocker_status)).length, deliveryProbability: portfolioForecast.portfolioProbability },
    change: { kind: 'remove_blocker', reviewHoursDelta: null, riskDelta: -blockers.filter((b) => ACTIVE_BLOCKER.includes(b.blocker_status)).length, probabilityDelta: 15 },
  }), [blockers, portfolioForecast]);

  const resourceSim = useMemo(() => simulateResourceImpact({
    currentReviewers: typeof inputActuals.active_commitments === 'number' ? 1 : null,   // 단일 Admin(실측)
    addedReviewers: 1, currentLatencyDays: null,
  }), [inputActuals]);

  const depPropagation = useMemo(() => {
    const chain = commitments.map((c) => ({ code: c.commitment_code, dependsOn: ((c.dependencies ?? []) as unknown[]).find((d): d is string => typeof d === 'string') ?? null }));
    const delayedCommitment = commitments.find((c) => c.target_reference_at && new Date(c.target_reference_at).getTime() < now.getTime() && !CLOSED.includes(c.commitment_status));
    if (!delayedCommitment) return { possible: [], confirmed: false as const };
    const delayDays = Math.round((now.getTime() - new Date(delayedCommitment.target_reference_at!).getTime()) / 86400000);
    return forecastDependencyPropagation(chain, { code: delayedCommitment.commitment_code, delayDays });
  }, [commitments, now]);

  const riskForecast = useMemo(() => forecastExecutiveRisk({
    deliveryProbability: portfolioForecast.portfolioProbability,
    scheduleVarianceDays: null,
    blockingDependencies: depPropagation.possible.length,
    unapprovedScopeChanges: 0,
    confidenceDrift: null,
  }), [portfolioForecast, depPropagation]);

  const forecastConfidence = useMemo(() => buildForecastConfidence({
    componentValues: [portfolioForecast.portfolioProbability, historicalRates.length ? 60 : null, null],
    unknownComponents: ['market_data', 'customer_satisfaction'],
    missingSignals: historicalRates.length ? [] : ['delivery_snapshot_history'],
    inputAgeDays: historicalRates.length ? Math.round((now.getTime() - new Date(historicalRates[0].generated_at).getTime()) / 86400000) : null,
  }), [portfolioForecast, historicalRates, now]);

  const projections = useMemo(() => [
    projectBusinessImpact({ kpiKey: 'mrr', kpiAvailable: mrr != null, currentValue: mrr, historicalDeltas: null, horizonPeriods: 3 }),
    projectBusinessImpact({ kpiKey: 'store_expansion', kpiAvailable: true, currentValue: typeof inputActuals.active_commitments === 'number' ? inputActuals.active_commitments : null, historicalDeltas: null, horizonPeriods: 3 }),
    projectBusinessImpact({ kpiKey: 'customer_satisfaction', kpiAvailable: false, currentValue: null, historicalDeltas: null, horizonPeriods: 3 }),
  ], [mrr, inputActuals]);

  const simGraph = useMemo(() => buildSimulationGraph([
    ...commitments.slice(0, 8).map((c) => ({ id: `c_${c.id}`, stage: 'commitment', label: c.commitment_code })),
    ...forecasts.slice(0, 8).map((f) => ({ id: `f_${f.id}`, stage: 'forecast', label: f.forecast_code })),
    ...simulations.slice(0, 8).map((s) => ({ id: `s_${s.id}`, stage: 'projected_outcome', label: s.simulation_code })),
  ]), [commitments, forecasts, simulations]);

  const timeline = useMemo(() => buildForecastTimeline(forecasts.map((f) => ({ horizon: f.horizon, kind: f.forecast_kind, label: f.forecast_code }))), [forecasts]);

  const healthForecast = useMemo(() => forecastOrganizationalHealth({
    deliveryTrendDelta: null, currentHealth: portfolioForecast.portfolioProbability,
    stabilityScore: null, reviewLatencyScore: null, evidenceCoverage: null,
    completionQuality: null, accountabilityScore: null,
  }), [portfolioForecast]);

  const autoRecs = useMemo(() => {
    const out: { type: string; reason: string }[] = [];
    const push = (r: ReturnType<typeof buildForecastRecommendation>) => { if (!('rejected' in r)) out.push({ type: r.type, reason: r.reason }); };
    if (depPropagation.possible.length > 0) push(buildForecastRecommendation({ type: 'validate_dependency', reason: `지연 전파 가능 ${depPropagation.possible.length}건 — 의존성 확인 필요(확정 아님)`, evidence: depPropagation.possible.slice(0, 3).map((p) => p.code), confidence: null, assumptions: [], unknownFactors: [] }));
    if (!historicalRates.length) push(buildForecastRecommendation({ type: 'update_forecast', reason: 'Delivery Snapshot 이력 없음 — 예측 정확도 개선을 위한 Snapshot 누적 필요', evidence: ['snapshot_history:0'], confidence: null, assumptions: [], unknownFactors: ['이력 부족'] }));
    if (verificationForecasts.some(({ f }) => f.gaps.length > 0)) push(buildForecastRecommendation({ type: 'prepare_evidence', reason: 'Verification Readiness 예측상 Evidence Gap 존재', evidence: ['readiness_gaps'], confidence: null, assumptions: [], unknownFactors: [] }));
    if (mrr != null) push(buildForecastRecommendation({ type: 'observe_kpi', reason: 'MRR 실측 존재 — Projection 대조를 위한 관측 지속', evidence: ['mrr_actual'], confidence: null, assumptions: [], unknownFactors: [] }));
    return out;
  }, [depPropagation, historicalRates, verificationForecasts, mrr]);

  if (loading) return <AdminCard title="Predictive Execution Intelligence & Executive Simulation Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Predictive Execution Intelligence & Executive Simulation Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  return (
    <AdminCard
      title="Predictive Execution Intelligence & Executive Simulation Center"
      subtitle="Current Execution→Predictive Modeling→Scenario Simulation→Forecast→Decision Support — Forecast = Prediction ≠ Outcome·Simulation ≠ Executive Decision"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="자동 업무 배정/일정 변경/Owner 변경/Commitment 생성/Forecast 사실 확정/KPI 변경/Outcome 생성/Budget·계약·정책·Production 변경/Merge/Deploy 는 없습니다. Forecast 는 Prediction 이며 Outcome 이 아닙니다. Projection ≠ Commitment, 상관 ≠ 인과, Confidence 100 ≠ 성공 보장, Delay Forecast ≠ 실제 지연, Simulation ≠ Executive Decision. Missing Data 는 Unknown 으로 유지하며 null 을 0 으로 변환하지 않습니다." />
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
            <Box label="Forecasts" value={NUM(summary.forecasts_total as number)} />
            <Box label="Simulations" value={NUM(summary.simulations_total as number)} />
            <Box label="Actual 대조 기록" value={NUM(summary.forecasts_with_actual as number)} />
            <Box label="Portfolio 완료 확률(예측)" value={portfolioForecast.portfolioProbability == null ? portfolioForecast.status : `${portfolioForecast.portfolioProbability}% (${portfolioForecast.status})`} />
            <Box label="지연 전파 가능" value={NUM(depPropagation.possible.length)} />
            <Box label="Forecast Confidence" value={forecastConfidence.confidence == null ? 'unknown' : String(forecastConfidence.confidence)} />
            <Box label="Health 예측 방향" value={healthForecast.direction} />
            <Box label="활성 Commitment(실측)" value={NUM(typeof inputActuals.active_commitments === 'number' ? inputActuals.active_commitments : null)} />
            <Box label="CSAT Projection" value={String(inputActuals.customer_satisfaction ?? 'projection_unavailable')} />
            <Box label="자동 Forecast 확정" value="없음(금지)" />
          </div>
          <p className="text-[10px] text-muted-foreground">Prediction ≠ Outcome — 모든 수치는 예측 참고값이며 미래를 확정하지 않습니다. MRR 실측 {NUM(mrr)}원.</p>
        </div>
      )}

      {/* ── Completion Probability ── */}
      {tab === 'completionprob' && (
        !commitmentProbabilities.length ? <AdminEmpty title="예측 대상 없음" description="활성 Commitment 가 생기면 완료 확률(예측)을 계산합니다." /> : (
          <div className="space-y-1">
            {commitmentProbabilities.map(({ c, prob }) => (
              <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{c.commitment_code}</span>
                <AdminBadge tone={prob.status === 'forecast_reference' ? 'info' : 'warning'}>{prob.status}</AdminBadge>
                <span className="ml-2 font-bold">{prob.probability == null ? 'null(0 아님)' : `${prob.probability}%`}</span>
                <span className="ml-2 text-muted-foreground">{prob.drivers.join(' · ') || '—'} · Prediction ≠ Outcome</span>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Delay Forecast ── */}
      {tab === 'delayforecast' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="예상 지연(예측)" value={delayForecast.expectedDelayDays == null ? '계산 불가' : `${delayForecast.expectedDelayDays}일`} />
            <Box label="범위" value={delayForecast.low == null ? '—' : `${delayForecast.low}~${delayForecast.high}일`} />
            <Box label="판정" value={delayForecast.status} />
            <Box label="실제 지연 아님" value="notActualDelay" />
          </div>
          <AdminAlert tone="info" description="지연 이력 표본이 아직 없어(실측) Blocker 수 기반 참고 예측만 제공합니다. Delay Forecast ≠ Actual Delay." />
        </div>
      )}

      {/* ── Verification Readiness Forecast ── */}
      {tab === 'verificationforecast' && (
        !verificationForecasts.length ? <AdminEmpty title="Milestone 없음" description="Criteria/Evidence/Reviewer 기반 검증 준비도를 예측합니다." /> : (
          <div className="space-y-1">
            {verificationForecasts.map(({ m, f }) => (
              <div key={m.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{m.milestone_code}</span>
                <AdminBadge tone={f.status === 'forecast_unverified' ? 'warning' : 'info'}>{f.status}</AdminBadge>
                <span className="ml-2">{f.readinessPct == null ? 'null' : `${f.readinessPct}%`}</span>
                <span className="ml-2 text-muted-foreground">{f.gaps.join(' · ') || 'Gap 없음'}</span>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Portfolio Forecast ── */}
      {tab === 'portfolioforecast' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Box label="Portfolio 완료 확률(예측)" value={portfolioForecast.portfolioProbability == null ? '산출 불가' : `${portfolioForecast.portfolioProbability}%`} />
            <Box label="판정" value={portfolioForecast.status} />
            <Box label="최약 항목" value={portfolioForecast.weakest ?? '—'} />
          </div>
          <AdminAlert tone="info" description="최약 항목을 보수적으로 반영합니다(평균 낙관 금지). Projection ≠ Commitment." />
        </div>
      )}

      {/* ── What-if / Resource / Dependency ── */}
      {tab === 'whatif' && (
        <div className="space-y-2">
          <div className="rounded-lg border border-border p-2 text-[11px]">
            <p className="font-bold">{whatIf.scenario}</p>
            {whatIf.effects.map((e, i) => <p key={i} className="text-muted-foreground">· {e}</p>)}
            {!whatIf.effects.length && <p className="text-muted-foreground">예상 변화 없음(입력 부족)</p>}
            <p className="mt-1 text-[10px] text-muted-foreground">counterfactual · executiveDecision=false</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => createExecSimulation({ code: `sim_${now.toISOString().slice(0, 19)}`, kind: 'blocker_removal_whatif', summary: r.slice(0, 200), evidence: [{ label: 'note', value: r.slice(0, 100) }], baseline: { risks: whatIf.projected.riskCount }, effects: whatIf.effects.map((e) => ({ effect: e })) }), 'Simulation 기록(Executive Decision 아님)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">What-if 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="시나리오 설명(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
        </div>
      )}
      {tab === 'resourcesim' && (
        <div className="space-y-2">
          <div className="rounded-lg border border-border p-2 text-[11px]">
            <p className="font-bold">Reviewer +1 가정</p>
            <p className="mt-1 text-muted-foreground">{resourceSim.projectedLatencyDays == null ? resourceSim.note : `Review Latency ${resourceSim.projectedLatencyDays}일 예상 · Confidence ${resourceSim.confidenceChange}`}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">resourcesAssigned=false — 실제 배정/채용은 절대 수행하지 않습니다</p>
          </div>
          <AdminAlert tone="info" description="Review Latency 실측 데이터가 없어(실측) 예상 계산이 제한됩니다 — 임의 수치를 만들지 않습니다." />
        </div>
      )}
      {tab === 'depforecast' && (
        !depPropagation.possible.length ? <AdminEmpty title="전파 예측 대상 없음" description="지연된 Commitment 가 생기면 하위 의존의 가능 영향만 계산합니다(확정 아님)." /> : (
          <div className="space-y-1">
            {depPropagation.possible.map((p) => (
              <div key={p.code} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{p.code}</span>
                <AdminBadge tone="warning">가능 지연 +{p.possibleDelayDays}일</AdminBadge>
                <span className="ml-2 text-muted-foreground">가능성 계산 — 확정하지 않음(confirmed=false)</span>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Risk / Confidence / Projection ── */}
      {tab === 'riskforecast' && (
        <div className="space-y-1">
          {riskForecast.map((r) => (
            <div key={r.kind} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={r.level === 'high' ? 'danger' : r.level === 'insufficient_data' ? 'warning' : r.level === 'low' ? 'success' : 'info'}>{r.level}</AdminBadge>
              <span className="ml-2 font-bold">{r.kind}</span>
              <span className="ml-2 text-muted-foreground">{r.note}</span>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => recordForecastGovernance('risk_forecast_calculated', r, { risks: riskForecast.map((x) => ({ kind: x.kind, level: x.level })) }), 'Risk Forecast 검토 기록(사실 확정 아님)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Risk Forecast 검토 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="검토 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
        </div>
      )}
      {tab === 'confidence' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Confidence" value={forecastConfidence.confidence == null ? 'unknown' : String(forecastConfidence.confidence)} />
            <Box label="Evidence Coverage" value={forecastConfidence.evidenceCoverage == null ? '—' : `${forecastConfidence.evidenceCoverage}%`} />
            <Box label="Freshness" value={forecastConfidence.freshness} />
            <Box label="성공 보장" value="아님(successGuarantee=false)" />
          </div>
          <AdminAlert tone="warning" title="Unknown / Missing" description={`Unknown: ${forecastConfidence.unknownComponents.join(', ') || '—'} · Missing Signals: ${forecastConfidence.missingSignals.join(', ') || '—'}`} />
          <p className="text-[10px] text-muted-foreground">{forecastConfidence.limitations.join(' · ')}</p>
        </div>
      )}
      {tab === 'projection' && (
        <div className="space-y-1">
          {projections.map((p) => (
            <div key={p.kpiKey} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{p.kpiKey}</span>
              <AdminBadge tone={p.status === 'projection_unavailable' ? 'danger' : p.status === 'forecast_reference' ? 'info' : 'warning'}>{p.status}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{p.projected == null ? '산출 불가(이력/원본 부족 — 0 아님)' : `${NUM(p.projected)} (${NUM(p.low)}~${NUM(p.high)})`} · Projection ≠ Business Result</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Graph / Timeline / Health ── */}
      {tab === 'simgraph' && (
        <div className="space-y-2">
          {simGraph.stages.map((s) => (
            <div key={s.stage} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.projectedOnly ? 'warning' : 'info'}>{s.stage}{s.projectedOnly ? '(예측 구간)' : ''}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{s.nodes.length ? s.nodes.slice(0, 6).map((n) => n.label).join(' · ') : '노드 없음'}</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">Decision→Commitment→Execution→Forecast→Projected Outcome→Business Impact — 예측 구간은 실제가 아닙니다.</p>
        </div>
      )}
      {tab === 'timeline' && (
        <div className="space-y-1">
          {timeline.buckets.map((b) => (
            <div key={b.horizon} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone="info">{b.horizon}</AdminBadge>
              <span className="ml-2 font-bold">{b.items.length}건</span>
              <span className="ml-2 text-muted-foreground">{b.items.slice(0, 4).map((i) => i.label).join(' · ') || '예측 없음'}</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">다음 주/다음 달/다음 분기/반기/연간 — Prediction ≠ Outcome</p>
        </div>
      )}
      {tab === 'healthforecast' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Box label="예상 Health(예측)" value={healthForecast.projectedScore == null ? 'insufficient_data' : String(healthForecast.projectedScore)} />
            <Box label="방향" value={healthForecast.direction} />
            <Box label="누락 성분" value={healthForecast.missing.length ? `${healthForecast.missing.length}개` : '없음'} />
          </div>
          <p className="text-[10px] text-muted-foreground">Delivery/Stability/Review Latency/Evidence/Completion Quality/Accountability 성분 — predictionNotOutcome=true</p>
        </div>
      )}

      {/* ── Recommendations / Records / External / Audit / Support ── */}
      {tab === 'recommendations' && (
        !autoRecs.length ? <AdminEmpty title="권고 없음" description="Evidence 없는 권고는 생성되지 않습니다." /> : (
          <div className="space-y-1">
            {autoRecs.map((r, i) => (
              <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone="info">{r.type}</AdminBadge>
                <span className="ml-2">{r.reason}</span>
                <p className="mt-1 text-[10px] text-muted-foreground">humanApprovalRequired · autoExecuted=false</p>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'forecasts' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => createForecast({ code: `fc_${now.toISOString().slice(0, 19)}`, kind: 'organizational_delivery_forecast', horizon: 'next_month', evidence: [{ label: 'note', value: r.slice(0, 100) }], probability: portfolioForecast.portfolioProbability, sample: commitmentProbabilities.length, evidenceCoverage: forecastConfidence.evidenceCoverage }), 'Forecast 기록(표본<5 시 서버가 확정 차단)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">현재 예측 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예측 근거(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!forecasts.length ? <AdminEmpty title="Forecast 없음" description="Forecast 는 덮어쓰지 않고 누적되며 actual 은 사후 수동 대조만 합니다." /> : forecasts.map((f) => (
            <div key={f.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{f.forecast_code}</span>
              <AdminBadge tone="info">{f.forecast_kind}</AdminBadge>
              <AdminBadge tone={f.forecast_status === 'forecast_reference' ? 'neutral' : 'warning'}>{f.forecast_status}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{f.horizon} · 예측 {f.predicted_value ?? f.probability_reference ?? 'null'} · actual {f.actual_value ?? '미기록'}</span>
            </div>
          ))}
        </div>
      )}
      {tab === 'simulations' && (
        !simulations.length ? <AdminEmpty title="Simulation 없음" description="Simulation ≠ Executive Decision — 가상 결과만 기록합니다." /> : (
          <div className="space-y-1">
            {simulations.map((s) => (
              <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{s.simulation_code}</span>
                <AdminBadge tone="info">{s.simulation_kind}</AdminBadge>
                <AdminBadge tone={s.simulation_status === 'simulated_reference' ? 'neutral' : 'warning'}>{s.simulation_status}</AdminBadge>
                <span className="ml-2 text-muted-foreground">{s.scenario_summary}</span>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'external' && (() => {
        const ext = audit.filter((e) => e.event_type === 'external_forecast_reference');
        return !ext.length ? <AdminEmpty title="외부 참조 없음" description="외부 예측 자료는 참조로만 기록됩니다." /> : (
          <div className="space-y-1">
            {ext.slice(0, 30).map((e) => (
              <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]"><span className="font-mono text-muted-foreground">{e.created_at.slice(0, 16).replace('T', ' ')}</span><span className="ml-2">{e.detail}</span></div>
            ))}
          </div>
        );
      })()}
      {tab === 'audit' && (
        !audit.length ? <AdminEmpty title="Audit 없음" description="예측/시뮬레이션이 이벤트로 남습니다(13종 whitelist)." /> : (
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
          {FORECAST_SUPPORT.map((s) => (
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

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <p className="text-[10px] font-bold text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-sm font-black">{value}</p>
    </div>
  );
}
