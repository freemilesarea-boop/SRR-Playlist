/**
 * AiDigitalTwinSection — Store Digital Twin & Counterfactual Simulation Laboratory (Phase AI-MUSIC-11).
 *
 * 실제 운영 Snapshot(Context KPI + Guardrail)을 Immutable Twin 으로 복제하고, 여러 Scenario/Variant 를
 * 결정적(Seeded)으로 비교한다. 결과는 simulated/counterfactual — 실제 Outcome 이 아니며
 * Production Playlist/Rotation/Scheduler/Queue/Playback 을 변경하지 않는다.
 * Apply/Publish/Deploy/Execute/Start Rollout 버튼 없음 · 자동 실행 없음 · Twin Snapshot 불변.
 *
 * 탭: Overview · Twins · Scenarios · Variants · Runs · Comparison · Counterfactual · Metrics ·
 *     Trade-offs · Pareto · Stress · Resilience · Agent Review · Calibration · Audit · Support.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Copy, Boxes, GitBranch, Layers, Play, Scale, HelpCircle, Ruler, ArrowLeftRight, Target,
  Zap, ShieldCheck, Users, Link2, ScrollText, Grid3x3, Lock, RefreshCw, FlaskConical,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchContextOverview, fetchContextDetail, fetchSandboxConstraints,
  fetchTwinSummary, fetchTwins, fetchTwinDetail, createTwin, fetchTwinScenarios, createTwinScenario,
  createTwinVariant, fetchTwinVariants, saveTwinSimulation, fetchTwinSimulationRuns, fetchTwinSimulationResults,
  fetchTwinAudit,
  type ContextOverview, type TwinSummaryResp, type TwinRow, type TwinDetailResp, type TwinScenarioRow,
  type TwinVariantRow, type TwinSimRunRow, type TwinSimResultRow, type TwinAuditRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  SIMULATION_ENGINE_VERSION, SCENARIO_TYPES, UNSUPPORTED_SCENARIOS, TWIN_METRICS, UNSUPPORTED_METRICS,
  calculateTwinCompleteness, calculateTwinFreshness, classifyTwinReadiness, hashSimulationInput,
  runDeterministicSimulation, compareVariantToBaseline, detectMetricTradeoffs, hasCriticalTradeoff,
  calculateParetoFrontier, rankScenarioVariants, classifyStressRisk, evaluateResilience,
  twinResultToCollaborationInput, TWIN_SUPPORT,
  READINESS_LABEL, READINESS_TONE, COMPARISON_LABEL, COMPARISON_TONE, RANK_LABEL, RANK_TONE, TRADEOFF_TONE, STRESS_TONE,
  type TwinReadiness, type SimVariant, type MetricComparison, type StressInput,
} from '@/lib/digitalTwin';
import { runCollaboration, agentDef, STANCE_LABEL, STANCE_TONE, CONSENSUS_LABEL, FINAL_DECISION_LABEL } from '@/lib/multiAgent';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'twins' | 'scenarios' | 'variants' | 'runs' | 'comparison' | 'counterfactual' | 'metrics'
  | 'tradeoffs' | 'pareto' | 'stress' | 'resilience' | 'agentreview' | 'calibration' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Copy }[] = [
  { key: 'overview', label: 'Overview', icon: Boxes },
  { key: 'twins', label: 'Digital Twins', icon: Copy },
  { key: 'scenarios', label: 'Scenarios', icon: GitBranch },
  { key: 'variants', label: 'Variants', icon: Layers },
  { key: 'runs', label: 'Simulation Runs', icon: Play },
  { key: 'comparison', label: 'Comparison', icon: Scale },
  { key: 'counterfactual', label: 'Counterfactual', icon: HelpCircle },
  { key: 'metrics', label: 'Metrics', icon: Ruler },
  { key: 'tradeoffs', label: 'Trade-offs', icon: ArrowLeftRight },
  { key: 'pareto', label: 'Pareto', icon: Target },
  { key: 'stress', label: 'Stress Testing', icon: Zap },
  { key: 'resilience', label: 'Resilience', icon: ShieldCheck },
  { key: 'agentreview', label: 'Agent Review', icon: Users },
  { key: 'calibration', label: 'Calibration', icon: Link2 },
  { key: 'audit', label: 'Audit', icon: ScrollText },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

const PRESET_VARIANTS: Array<{ code: string; name: string; adjustments: Record<string, number>; direction: 'improve' | 'worsen' | 'unknown' }> = [
  { code: 'conservative', name: 'Conservative (±5%)', adjustments: { expected_skip_rate: -5, diversity_score: 5 }, direction: 'improve' },
  { code: 'balanced', name: 'Balanced (±10%)', adjustments: { expected_skip_rate: -10, expected_completion_rate: 5, diversity_score: 10 }, direction: 'improve' },
  { code: 'aggressive', name: 'Aggressive (±20%)', adjustments: { expected_skip_rate: -20, expected_completion_rate: 10, diversity_score: -15 }, direction: 'unknown' },
  { code: 'stress', name: 'Stress (악화 가정)', adjustments: { expected_skip_rate: 25, expected_completion_rate: -15 }, direction: 'worsen' },
];

export default function AiDigitalTwinSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<TwinSummaryResp | null>(null);
  const [twins, setTwins] = useState<TwinRow[]>([]);
  const [overview, setOverview] = useState<ContextOverview | null>(null);
  const [storeType, setStoreType] = useState<string>('');
  const [selTwin, setSelTwin] = useState<TwinRow | null>(null);
  const [twinDetail, setTwinDetail] = useState<TwinDetailResp | null>(null);
  const [scenarios, setScenarios] = useState<TwinScenarioRow[]>([]);
  const [selScenario, setSelScenario] = useState<TwinScenarioRow | null>(null);
  const [variants, setVariants] = useState<TwinVariantRow[]>([]);
  const [runs, setRuns] = useState<TwinSimRunRow[]>([]);
  const [selRun, setSelRun] = useState<TwinSimRunRow | null>(null);
  const [results, setResults] = useState<TwinSimResultRow[]>([]);
  const [auditLog, setAuditLog] = useState<TwinAuditRow[]>([]);
  const [horizon, setHorizon] = useState(7);
  const [cfMetric, setCfMetric] = useState('expected_skip_rate');
  const [cfAdj, setCfAdj] = useState(-10);
  const [stress, setStress] = useState<StressInput>({});
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, t, o, r, a] = await Promise.all([
        fetchTwinSummary(), fetchTwins(null, null, 100), fetchContextOverview('30d'),
        fetchTwinSimulationRuns(null, null, 100), fetchTwinAudit(null, null, 100),
      ]);
      setSummary(s); setTwins(t); setOverview(o); setRuns(r); setAuditLog(a);
      if (o.items.length && !storeType) setStoreType(o.items[0].store_type);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, [storeType]);
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadScenarios = useCallback(async (twin: TwinRow | null) => {
    try { setScenarios(await fetchTwinScenarios(twin?.id ?? null, 100)); } catch (e) { toast.error(classifyAdminError(e).message); }
  }, []);
  useEffect(() => { if (['scenarios', 'variants', 'runs'].includes(tab)) void loadScenarios(selTwin); }, [tab, selTwin, loadScenarios]);

  // ── Twin 생성: 실제 Context KPI + Guardrail Snapshot(0490/0494 재사용) ──
  const createTwinFromContext = async () => {
    if (!storeType) return;
    setBusy(true);
    try {
      const [detail, guard] = await Promise.all([
        fetchContextDetail(storeType, null, null, '30d', 20),
        fetchSandboxConstraints(storeType).catch(() => null),
      ]);
      const s = detail.summary as unknown as Record<string, number | null>;
      const baselineMetrics: Record<string, number | null> = {
        expected_completion_rate: s.completion_rate ?? null,
        expected_skip_rate: s.skip_rate ?? null,
        diversity_score: (s.genre_count ?? 0) > 0 ? Math.min(100, Math.round(((s.genre_count as number) / 8) * 100)) : null,
        // 실데이터 없는 Metric 은 null 유지(추정값 채우기 금지) → Simulation 에서 unsupported.
        repetition_rate: null, fatigue_risk: null, freshness_score: null, streaming_quality_score: null,
        guardrail_conflict: guard ? 0 : null, store_satisfaction_proxy: null,
      };
      const snapshotAt = now.toISOString();
      const sourceHash = hashSimulationInput(['admin_context_detail', storeType, JSON.stringify(baselineMetrics), snapshotAt.slice(0, 10)]);
      const comp = calculateTwinCompleteness({
        contextPresent: true, policyPresent: undefined, guardrailPresent: !!guard, playlistPresent: (detail.playlists?.length ?? 0) > 0,
        trackPoolPresent: (detail.tracks?.length ?? 0) > 0, outcomePresent: s.completion_rate != null, qualityPresent: undefined,
        memoryRefCount: null, patternRefCount: null, versionPresent: true, evidenceCount: 3,
      });
      const fresh = calculateTwinFreshness({ snapshotAt, now });
      const readiness: TwinReadiness = classifyTwinReadiness({ completeness: comp.score, freshness: fresh.score });
      const res = await createTwin({
        twin_code: `twin_ctx_${storeType}_${sourceHash.slice(4)}`, twin_type: 'context', twin_scope: 'context', scope_id: storeType,
        source_type: 'admin_context_detail', source_id: storeType, source_version: 'context_v1(0490)', source_hash: sourceHash,
        snapshot_at: snapshotAt,
        context_snapshot: { store_type: storeType, range: '30d', metrics: baselineMetrics, events: s.events ?? null, track_count: s.track_count ?? null, genre_count: s.genre_count ?? null },
        guardrail_snapshot: guard, playlist_snapshot: { count: detail.playlists?.length ?? 0 },
        track_pool_snapshot: { count: detail.tracks?.length ?? 0 }, outcome_snapshot: { completion_rate: s.completion_rate, skip_rate: s.skip_rate },
        completeness_score: comp.score, freshness_score: fresh.score, readiness_status: readiness,
        limitations: [...comp.missing.map((m) => `${m} 누락`), 'policy/quality snapshot 미지원'],
        evidence: [
          { label: 'source', value: `admin_context_detail:${storeType}` },
          { label: 'events', value: s.events ?? null },
          { label: 'guardrails', value: guard ? (guard.genre_guardrails.length + guard.store_guardrails.length) : null },
        ],
        idempotency_key: sourceHash,
      });
      toast.success(res.idempotent ? '동일 Snapshot Twin 존재(중복 방지)' : `Twin 생성(${res.eligibility} · ${READINESS_LABEL[readiness]})`);
      setTwins(await fetchTwins(null, null, 100));
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  const openTwin = async (t: TwinRow) => {
    setSelTwin(t); setBusy(true);
    try { setTwinDetail(await fetchTwinDetail(t.id)); } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  const twinMetrics = useMemo(() => {
    const snap = twinDetail?.twin?.context_snapshot as { metrics?: Record<string, number | null> } | undefined;
    return snap?.metrics ?? null;
  }, [twinDetail]);

  // ── Scenario + Baseline Variant 생성 ──
  const [scenarioType, setScenarioType] = useState('diversity');
  const createScenario = async () => {
    if (!selTwin || !twinMetrics) { toast.error('Twin 을 먼저 선택하세요(상세 열기).'); return; }
    setBusy(true);
    try {
      const availableMetrics = Object.entries(twinMetrics).filter(([, v]) => v != null).map(([k]) => k);
      if (!availableMetrics.length) { toast.error('사용 가능한 Baseline Metric 없음(insufficient_data)'); return; }
      const inputHash = hashSimulationInput([selTwin.id, scenarioType, horizon, JSON.stringify(twinMetrics)]);
      const res = await createTwinScenario({
        scenario_code: `sc_${scenarioType}_${inputHash.slice(4)}`, twin_id: selTwin.id, scenario_type: scenarioType,
        title: `${scenarioType} — ${selTwin.scope_id ?? selTwin.twin_code}`,
        objective: 'Baseline 대비 Variant KPI 비교(Evidence-only)',
        baseline_definition: { metrics: twinMetrics, source: 'twin context_snapshot' },
        simulation_horizon: horizon, time_granularity: 'day', requested_metrics: availableMetrics,
        assumption_snapshot: { adjustments_declared_by: 'operator', engine: SIMULATION_ENGINE_VERSION },
        model_version: SIMULATION_ENGINE_VERSION, input_hash: inputHash, risk_tier: 'low',
        evidence: [{ label: 'twin', value: selTwin.twin_code }, { label: 'metrics', value: availableMetrics.length }],
        limitations: ['simulated — Not Actual Outcome'], idempotency_key: inputHash,
      });
      if (!res.idempotent) {
        await createTwinVariant({
          scenario_id: res.scenario.id, variant_code: 'baseline', variant_name: 'Baseline (무변경)',
          variant_definition: { adjustments: {} }, changed_dimensions: [], expected_direction: 'neutral',
          input_hash: hashSimulationInput(['baseline', res.scenario.id]), is_baseline: true,
        });
      }
      toast.success(res.idempotent ? '동일 Scenario 존재(중복 방지)' : 'Scenario + Baseline Variant 생성');
      setSelScenario(res.scenario); await loadScenarios(selTwin);
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  const loadVariants = async (sc: TwinScenarioRow) => {
    setSelScenario(sc); setBusy(true);
    try { setVariants(await fetchTwinVariants(sc.id, 50)); } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  const addPresetVariant = async (preset: typeof PRESET_VARIANTS[number]) => {
    if (!selScenario) return;
    setBusy(true);
    try {
      const res = await createTwinVariant({
        scenario_id: selScenario.id, variant_code: preset.code, variant_name: preset.name,
        variant_definition: { adjustments: preset.adjustments },
        changed_dimensions: Object.keys(preset.adjustments), expected_direction: preset.direction,
        assumption_snapshot: { declared: '운영자 선언 가정(관찰 아님)', adjustments: preset.adjustments },
        input_hash: hashSimulationInput([preset.code, JSON.stringify(preset.adjustments), selScenario.id]),
      });
      toast.success(res.idempotent ? '동일 Variant 존재(중복 방지)' : `Variant 추가: ${preset.name}`);
      setVariants(await fetchTwinVariants(selScenario.id, 50));
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  // ── Deterministic Simulation 실행(동기 · 클라이언트) + 저장 ──
  const runSimulation = async () => {
    if (!selTwin || !selScenario || !twinMetrics) { toast.error('Twin 상세 + Scenario 선택 필요'); return; }
    const vars = variants.length ? variants : await fetchTwinVariants(selScenario.id, 50);
    if (!vars.some((v) => v.is_baseline)) { toast.error('Baseline Variant 없음(Baseline 없는 Simulation 금지)'); return; }
    setBusy(true);
    try {
      const seed = 42;
      const simVariants: SimVariant[] = vars.map((v) => ({
        id: v.id, code: v.variant_code, name: v.variant_name, isBaseline: v.is_baseline,
        adjustments: ((v.variant_definition as { adjustments?: Record<string, number> })?.adjustments) ?? {},
      }));
      const sim = runDeterministicSimulation({
        baselineMetrics: twinMetrics, variants: simVariants, horizonDays: selScenario.simulation_horizon, seed,
        twinCompleteness: selTwin.completeness_score, twinFreshness: selTwin.freshness_score,
      });
      const inputHash = hashSimulationInput([selScenario.input_hash, seed, SIMULATION_ENGINE_VERSION, JSON.stringify(simVariants.map((v) => v.code))]);
      const startedAt = new Date().toISOString();
      const res = await saveTwinSimulation({
        run_code: `run_${inputHash.slice(4)}`, scenario_id: selScenario.id,
        baseline_variant_id: vars.find((v) => v.is_baseline)?.id ?? null,
        run_status: sim.rows.some((r) => r.resultStatus === 'available') ? (sim.rows.every((r) => r.resultStatus === 'available') ? 'completed' : 'partial') : 'failed',
        simulation_engine_version: SIMULATION_ENGINE_VERSION, model_version: SIMULATION_ENGINE_VERSION,
        seed, iteration_count: 1, simulation_horizon: selScenario.simulation_horizon,
        input_hash: inputHash, input_snapshot: { baseline: twinMetrics, variants: simVariants.map((v) => ({ code: v.code, adjustments: v.adjustments })) },
        assumption_snapshot: { note: 'Variant adjustment 는 운영자 선언 가정 — 관찰 아님' },
        started_at: startedAt, completed_at: new Date().toISOString(),
        output_summary: { rows: sim.rows.length, confidence: sim.confidence },
        confidence_summary: { confidence: sim.confidence, horizon: selScenario.simulation_horizon },
        limitations: sim.limitations,
        evidence: [{ label: 'engine', value: SIMULATION_ENGINE_VERSION }, { label: 'seed', value: seed }],
        results: sim.rows.map((r) => ({
          variant_id: r.variantId, metric_code: r.metricCode, metric_type: r.kind === 'proxy' ? 'proxy' : 'simulated',
          baseline_value: r.baselineValue, simulated_value: r.simulatedValue, delta_value: r.deltaValue, delta_percent: r.deltaPercent,
          confidence: r.confidence, uncertainty_low: r.uncertaintyLow, uncertainty_high: r.uncertaintyHigh,
          result_status: r.resultStatus, evidence: [{ label: 'simulated', value: true }, { label: 'not_actual', value: true }],
        })),
      });
      toast.success(res.idempotent ? '동일 Input Run 존재(재현 가능 — 중복 방지)' : `Simulation 저장(${res.result_count ?? 0} rows · simulated)`);
      const rr = await fetchTwinSimulationRuns(selTwin.id, null, 100); setRuns(rr);
      if (!res.idempotent) { setSelRun(res.run); setResults(await fetchTwinSimulationResults(res.run.id, 200)); }
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  const openRun = async (r: TwinSimRunRow) => {
    setSelRun(r); setBusy(true);
    try { setResults(await fetchTwinSimulationResults(r.id, 200)); } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  // ── 분석(Comparison/Trade-off/Pareto/Rank/Agent Review) — 결정적 클라이언트 계산 ──
  const variantIds = useMemo(() => [...new Set(results.map((r) => r.variant_id))], [results]);
  const baselineVariantId = selRun?.baseline_variant_id ?? null;
  const comparisonByVariant = useMemo(() => {
    if (!results.length) return [];
    return variantIds.filter((v) => v !== baselineVariantId).map((vid) => {
      const items: MetricComparison[] = results.filter((r) => r.variant_id === vid && r.result_status === 'available').map((r) => ({
        metricCode: r.metric_code, baseline: r.baseline_value, simulated: r.simulated_value,
        direction: TWIN_METRICS.find((m) => m.code === r.metric_code)?.direction ?? 'max', confidence: r.confidence,
      }));
      const cmp = compareVariantToBaseline(items);
      const tradeoffs = detectMetricTradeoffs(items);
      const rank = rankScenarioVariants({ comparison: cmp.result, confidence: items.find((i) => i.confidence != null)?.confidence ?? null, criticalTradeoff: hasCriticalTradeoff(tradeoffs), constraintViolations: 0, governanceRisk: false });
      return { variantId: vid, items, cmp, tradeoffs, rank };
    });
  }, [results, variantIds, baselineVariantId]);

  const pareto = useMemo(() => {
    if (!results.length) return [];
    const objectives = [
      { metric: 'expected_skip_rate', direction: 'min' as const },
      { metric: 'expected_completion_rate', direction: 'max' as const },
      { metric: 'diversity_score', direction: 'max' as const },
    ];
    const pv = variantIds.map((vid) => ({
      id: vid, code: vid.slice(0, 8),
      metrics: Object.fromEntries(objectives.map((o) => [o.metric, results.find((r) => r.variant_id === vid && r.metric_code === o.metric)?.simulated_value ?? null])),
    }));
    return calculateParetoFrontier(pv, objectives);
  }, [results, variantIds]);

  const agentReview = useMemo(() => {
    if (!selRun || !results.length) return null;
    const firstVariant = variantIds.find((v) => v !== baselineVariantId);
    if (!firstVariant) return null;
    const rows = results.filter((r) => r.variant_id === firstVariant).map((r) => ({
      variantId: r.variant_id, metricCode: r.metric_code, baselineValue: r.baseline_value, simulatedValue: r.simulated_value,
      deltaValue: r.delta_value, deltaPercent: r.delta_percent, confidence: r.confidence,
      uncertaintyLow: r.uncertainty_low, uncertaintyHigh: r.uncertainty_high,
      resultStatus: r.result_status as 'available' | 'unsupported' | 'insufficient_data', kind: 'real' as const,
    }));
    const critical = comparisonByVariant.some((c) => hasCriticalTradeoff(c.tradeoffs));
    const ci = twinResultToCollaborationInput({
      contextKey: selTwin?.scope_id ? `store_type=${selTwin.scope_id}` : (selTwin?.twin_code ?? ''), sample: 300,
      rows, confidence: rows.find((r) => r.confidence != null)?.confidence ?? null,
      governanceRisk: false, criticalTradeoff: critical,
    });
    return runCollaboration(ci);
  }, [selRun, results, variantIds, baselineVariantId, comparisonByVariant, selTwin]);

  const stressResult = useMemo(() => classifyStressRisk(stress), [stress]);
  const [resilInput, setResilInput] = useState({ trackFallbackCoverage: '', playlistFallbackCoverage: '', qualityTolerance: '' });
  const resilience = useMemo(() => evaluateResilience({
    trackFallbackCoverage: resilInput.trackFallbackCoverage === '' ? null : Number(resilInput.trackFallbackCoverage),
    playlistFallbackCoverage: resilInput.playlistFallbackCoverage === '' ? null : Number(resilInput.playlistFallbackCoverage),
    qualityTolerance: resilInput.qualityTolerance === '' ? null : Number(resilInput.qualityTolerance),
  }), [resilInput]);

  const counterfactual = useMemo(() => {
    if (!twinMetrics) return null;
    const base = twinMetrics[cfMetric];
    if (base == null) return { unsupported: true as const };
    const sim = runDeterministicSimulation({
      baselineMetrics: { [cfMetric]: base },
      variants: [
        { id: '__base', code: 'baseline', name: 'Baseline', isBaseline: true, adjustments: {} },
        { id: '__cf', code: 'counterfactual', name: 'Counterfactual', isBaseline: false, adjustments: { [cfMetric]: cfAdj } },
      ],
      horizonDays: horizon, seed: 42, twinCompleteness: selTwin?.completeness_score ?? null, twinFreshness: selTwin?.freshness_score ?? null,
    });
    const row = sim.rows.find((r) => r.variantId === '__cf');
    return { unsupported: false as const, base, row, confidence: sim.confidence };
  }, [twinMetrics, cfMetric, cfAdj, horizon, selTwin]);

  if (loading) return <AdminCard title="AI Digital Twin & Simulation Lab"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="AI Digital Twin & Simulation Lab">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const tw = summary?.twins ?? null; const ru = summary?.runs ?? null;

  return (
    <AdminCard
      title="AI Digital Twin & Simulation Lab"
      subtitle="Immutable Production Snapshot 위 결정적 Counterfactual Simulation (simulated ≠ actual · Production 무변경)"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="모든 결과는 simulated/counterfactual(관찰되지 않은 가상 추정치)이며 실제 Outcome 이 아닙니다. Twin 은 Production 과 동기화되지 않는 읽기 전용 Snapshot 이고, Playlist/Rotation/Scheduler/Queue/Playback/Rollout/Trust/Constitution 을 변경하거나 자동 실행하지 않습니다." />
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
            <Box label="Total Twins" value={NUM(tw?.total)} />
            <Box label="Ready" value={NUM(tw?.ready)} />
            <Box label="Partial" value={NUM(tw?.partial)} />
            <Box label="Stale" value={NUM(tw?.stale)} />
            <Box label="Avg Completeness" value={NUM(tw?.avg_completeness)} />
            <Box label="Avg Freshness" value={NUM(tw?.avg_freshness)} />
            <Box label="Scenarios" value={NUM(tw?.scenarios)} />
            <Box label="Variants" value={NUM(tw?.variants)} />
            <Box label="Completed Runs" value={NUM(ru?.completed)} />
            <Box label="Partial Runs" value={NUM(ru?.partial)} />
            <Box label="Failed Runs" value={NUM(ru?.failed)} />
            <Box label="Calibrated / Pending" value={`${NUM(summary?.calibration?.calibrated)} / ${NUM(summary?.calibration?.pending_outcome)}`} />
          </div>
          <AdminAlert tone="info" title="Sandbox 와의 경계"
            description="Sandbox(0494)는 단일 Strategy 후보의 정책/제약 통과 검증, Digital Twin 은 환경 Snapshot 전체에 다중 Variant 를 비교하는 Scenario Laboratory 입니다. Twin 결과는 Sandbox 판정을 덮어쓰지 않는 참고 Evidence 입니다." />
        </div>
      )}

      {/* ── Twins ── */}
      {tab === 'twins' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-muted/30 p-2">
            <span className="text-[10px] font-bold text-muted-foreground">Source Context</span>
            <select value={storeType} onChange={(e) => setStoreType(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold">
              {(overview?.items ?? []).map((it) => <option key={it.store_type} value={it.store_type}>{it.store_type} ({NUM(it.events)})</option>)}
            </select>
            <button disabled={busy || !storeType} onClick={() => void createTwinFromContext()} className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[11px] font-bold text-black disabled:opacity-50"><Copy size={12} /> Twin 생성(실제 Snapshot)</button>
          </div>
          {!twins.length ? <AdminEmpty icon={<Copy size={20} />} title="Twin 없음" description="실제 Context Snapshot 으로 Twin 을 생성하세요." /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Twin</th><th className="px-2">Type</th><th className="px-2">Source</th><th className="px-2">Snapshot</th><th className="px-2">Complete</th><th className="px-2">Fresh</th><th className="px-2">Readiness</th><th className="px-2">Lifecycle</th><th className="px-2" /></tr></thead>
                <tbody>
                  {twins.map((t) => (
                    <tr key={t.id} className="border-b border-border/50">
                      <td className="py-1.5 pr-2"><code className="text-[10px]">{t.twin_code.slice(0, 24)}</code></td>
                      <td className="px-2"><AdminBadge tone="neutral">{t.twin_type}</AdminBadge></td>
                      <td className="px-2 text-[10px]">{t.source_type.slice(0, 20)}:{t.source_id}</td>
                      <td className="px-2 text-[10px] text-muted-foreground">{t.snapshot_at.slice(0, 16)}</td>
                      <td className="px-2">{t.completeness_score ?? '—'}</td>
                      <td className="px-2">{t.freshness_score ?? '—'}</td>
                      <td className="px-2"><AdminBadge tone={READINESS_TONE[t.readiness_status as TwinReadiness] ?? 'neutral'}>{READINESS_LABEL[t.readiness_status as TwinReadiness] ?? t.readiness_status}</AdminBadge></td>
                      <td className="px-2 text-[10px]">{t.lifecycle_status}</td>
                      <td className="px-2"><button disabled={busy} onClick={() => void openTwin(t)} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">상세</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {twinDetail?.found && twinDetail.twin && (
            <AdminCard title={`Twin Detail — ${twinDetail.twin.twin_code}`} action={<button onClick={() => setTwinDetail(null)} className="text-[11px] font-bold underline">닫기</button>}>
              <div className="grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4">
                <Box label="Source Version" value={String(twinDetail.twin.source_version)} />
                <Box label="Source Hash" value={String(twinDetail.twin.source_hash ?? '—').slice(0, 16)} />
                <Box label="Scenarios" value={NUM(twinDetail.scenarios.length)} />
                <Box label="Limitations" value={`${(twinDetail.twin.limitations as unknown[]).length}건`} />
              </div>
              <div className="mt-2 max-h-40 overflow-auto rounded-lg border border-border bg-muted/30 p-2">
                <p className="text-[10px] font-bold text-muted-foreground">Context Snapshot (Immutable — 수정 불가)</p>
                <pre className="mt-1 whitespace-pre-wrap break-all text-[10px]">{JSON.stringify(twinDetail.twin.context_snapshot, null, 1)}</pre>
              </div>
            </AdminCard>
          )}
        </div>
      )}

      {/* ── Scenarios ── */}
      {tab === 'scenarios' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Scenario (Baseline 필수 · Horizon ≤ 30일)" description={`weather/event/energy Scenario 는 실데이터가 없어 미지원: ${UNSUPPORTED_SCENARIOS.join(', ')}`} />
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-muted/30 p-2">
            <span className="text-[10px] font-bold text-muted-foreground">Twin: {selTwin ? selTwin.twin_code.slice(0, 24) : '미선택(Twins 탭에서 상세 열기)'}</span>
            <select value={scenarioType} onChange={(e) => setScenarioType(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold">
              {SCENARIO_TYPES.map((s) => <option key={s.code} value={s.code}>{s.label} ({s.support})</option>)}
            </select>
            <label className="text-[10px] font-bold text-muted-foreground">Horizon
              <input type="number" min={1} max={30} value={horizon} onChange={(e) => setHorizon(Math.max(1, Math.min(30, Number(e.target.value) || 7)))} className="ml-1 w-14 rounded-md border border-border bg-background px-1.5 py-1 text-[11px]" aria-label="Simulation Horizon (일)" />일
            </label>
            <button disabled={busy || !selTwin || !twinMetrics} onClick={() => void createScenario()} className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[11px] font-bold text-black disabled:opacity-50"><GitBranch size={12} /> Scenario 생성</button>
          </div>
          {!scenarios.length ? <AdminEmpty icon={<GitBranch size={20} />} title="Scenario 없음" /> : (
            <div className="space-y-1.5">
              {scenarios.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                  <AdminBadge tone="neutral">{s.scenario_type}</AdminBadge>
                  <span className="font-semibold">{s.title.slice(0, 40)}</span>
                  <span className="text-[10px] text-muted-foreground">Horizon {s.simulation_horizon}일 · Metrics {(s.requested_metrics ?? []).length}</span>
                  <button disabled={busy} onClick={() => { void loadVariants(s); setTab('variants'); }} className="ml-auto rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Variants</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Variants ── */}
      {tab === 'variants' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Variant (최대 20개 · 조정 ±50% 제한)" description="Variant adjustment 는 운영자가 선언한 가정입니다(관찰 아님). Baseline 은 정확히 1개이며 덮어쓸 수 없습니다." />
          {!selScenario ? <AdminEmpty icon={<Layers size={20} />} title="Scenario 선택 필요" description="Scenarios 탭에서 선택하세요." /> : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_VARIANTS.map((p) => <button key={p.code} disabled={busy} onClick={() => void addPresetVariant(p)} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-50">+ {p.name}</button>)}
                <button disabled={busy} onClick={() => void runSimulation()} className="ml-auto inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[11px] font-bold text-black disabled:opacity-50"><Play size={12} /> Simulation 실행(가상 · 저장)</button>
              </div>
              {!variants.length ? <AdminEmpty icon={<Layers size={20} />} title="Variant 없음" /> : (
                <div className="space-y-1.5">
                  {variants.map((v) => (
                    <div key={v.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                      {v.is_baseline ? <AdminBadge tone="info">Baseline</AdminBadge> : <AdminBadge tone="neutral">Variant</AdminBadge>}
                      <span className="font-semibold">{v.variant_name}</span>
                      <code className="text-[10px] text-muted-foreground">{JSON.stringify((v.variant_definition as { adjustments?: Record<string, number> })?.adjustments ?? {}).slice(0, 60)}</code>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Runs ── */}
      {tab === 'runs' && (
        <div className="space-y-2">
          {!runs.length ? <AdminEmpty icon={<Play size={20} />} title="Simulation Run 없음" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Run</th><th className="px-2">Status</th><th className="px-2">Engine</th><th className="px-2">Seed</th><th className="px-2">Horizon</th><th className="px-2">생성</th><th className="px-2" /></tr></thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-b border-border/50">
                      <td className="py-1.5 pr-2"><code className="text-[10px]">{r.run_code.slice(0, 20)}</code></td>
                      <td className="px-2"><AdminBadge tone={r.run_status === 'completed' ? 'success' : r.run_status === 'failed' ? 'danger' : 'warning'}>{r.run_status}</AdminBadge></td>
                      <td className="px-2 text-[10px]">{r.simulation_engine_version}</td>
                      <td className="px-2">{r.seed}</td>
                      <td className="px-2">{r.simulation_horizon}일</td>
                      <td className="px-2 text-[10px] text-muted-foreground">{r.created_at.slice(0, 16)}</td>
                      <td className="px-2"><button disabled={busy} onClick={() => void openRun(r)} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">결과</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {selRun && (
            <AdminAlert tone="info" title={`선택된 Run: ${selRun.run_code}`} description={`Input(seed ${selRun.seed}, hash ${selRun.input_hash})과 Output(${results.length} rows)은 분리 저장됩니다. 동일 Input 재실행 시 중복 저장되지 않습니다(재현 가능).`} />
          )}
        </div>
      )}

      {/* ── Comparison ── */}
      {tab === 'comparison' && (
        <div className="space-y-3">
          <AdminAlert tone="warning" title="Simulated — Not Actual Outcome" description="아래 값은 가상 추정치입니다. 실제 Outcome 과 다른 컬럼/Badge 로 구분되며 인과관계를 단정하지 않습니다." />
          {!selRun || !results.length ? <AdminEmpty icon={<Scale size={20} />} title="Run 선택 필요" description="Simulation Runs 탭에서 결과를 여세요." /> : (
            <>
              {comparisonByVariant.map((c) => (
                <AdminCard key={c.variantId} title={`Variant ${c.variantId.slice(0, 8)} vs Baseline`}>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <AdminBadge tone={COMPARISON_TONE[c.cmp.result]}>{COMPARISON_LABEL[c.cmp.result]}</AdminBadge>
                    <AdminBadge tone={RANK_TONE[c.rank]}>{RANK_LABEL[c.rank]}</AdminBadge>
                    <span className="text-[10px] text-muted-foreground">개선 {c.cmp.improved.length} · 악화 {c.cmp.worsened.length} · Trade-off {c.tradeoffs.length}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1 pr-2">Metric</th><th className="px-2">Baseline</th><th className="px-2">Simulated</th><th className="px-2">Δ</th><th className="px-2">Δ%</th><th className="px-2">Confidence</th><th className="px-2">Status</th></tr></thead>
                      <tbody>
                        {results.filter((r) => r.variant_id === c.variantId).map((r) => (
                          <tr key={r.id} className="border-b border-border/50">
                            <td className="py-1 pr-2 font-semibold">{r.metric_code}</td>
                            <td className="px-2">{r.baseline_value ?? '—'}</td>
                            <td className="px-2"><AdminBadge tone="info">{r.simulated_value ?? '—'}</AdminBadge></td>
                            <td className="px-2">{r.delta_value ?? '—'}</td>
                            <td className="px-2">{r.delta_percent == null ? '—' : `${r.delta_percent}%`}</td>
                            <td className="px-2">{r.confidence ?? '—'}</td>
                            <td className="px-2 text-[10px]">{r.result_status}{r.metric_type === 'proxy' ? ' (proxy)' : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </AdminCard>
              ))}
            </>
          )}
        </div>
      )}

      {/* ── Counterfactual ── */}
      {tab === 'counterfactual' && (
        <div className="space-y-3">
          <AdminAlert tone="warning" title="Counterfactual — Not Actual (관찰되지 않은 가상 추정)" description="'~했다면?' 질문에 대한 가상 비교입니다. 상관/가정 기반이며 인과관계 단정 및 Production 실행이 아닙니다." />
          {!twinMetrics ? <AdminEmpty icon={<HelpCircle size={20} />} title="Twin 선택 필요" description="Twins 탭에서 상세를 여세요." /> : (
            <>
              <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-muted/30 p-2">
                <select value={cfMetric} onChange={(e) => setCfMetric(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold">
                  {Object.keys(twinMetrics).map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <label className="text-[10px] font-bold text-muted-foreground">변경
                  <input type="number" min={-50} max={50} value={cfAdj} onChange={(e) => setCfAdj(Math.max(-50, Math.min(50, Number(e.target.value) || 0)))} className="ml-1 w-16 rounded-md border border-border bg-background px-1.5 py-1 text-[11px]" aria-label="Counterfactual 조정(%)" />%
                </label>
              </div>
              {!counterfactual || counterfactual.unsupported ? (
                <AdminAlert tone="info" title="unsupported" description="이 Metric 은 Baseline 실데이터가 없어 Counterfactual 을 계산하지 않습니다(추정값 채우기 금지)." />
              ) : (
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <Box label="Baseline (실측)" value={`${counterfactual.base}`} />
                  <Box label="Simulated (가상)" value={`${counterfactual.row?.simulatedValue ?? '—'}`} />
                  <Box label="Δ" value={`${counterfactual.row?.deltaValue ?? '—'} (${counterfactual.row?.deltaPercent ?? '—'}%)`} />
                  <Box label="Confidence" value={`${counterfactual.confidence ?? '—'}`} />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Metrics ── */}
      {tab === 'metrics' && (
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Metric</th><th className="px-2">방향</th><th className="px-2">종류</th><th className="px-2">근거</th></tr></thead>
              <tbody>
                {TWIN_METRICS.map((m) => (
                  <tr key={m.code} className="border-b border-border/50">
                    <td className="py-1.5 pr-2 font-semibold">{m.label}</td>
                    <td className="px-2">{m.direction === 'min' ? '낮을수록 좋음' : '높을수록 좋음'}</td>
                    <td className="px-2"><AdminBadge tone={m.kind === 'real' ? 'success' : 'warning'}>{m.kind}</AdminBadge></td>
                    <td className="px-2 text-[10px] text-muted-foreground">{m.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <AdminAlert tone="info" title="미지원 Metric (실데이터 없음)" description={UNSUPPORTED_METRICS.join(' · ')} />
        </div>
      )}

      {/* ── Trade-offs ── */}
      {tab === 'tradeoffs' && (
        <div className="space-y-2">
          {!comparisonByVariant.length ? <AdminEmpty icon={<ArrowLeftRight size={20} />} title="Run 선택 필요" /> : comparisonByVariant.every((c) => !c.tradeoffs.length) ? <AdminEmpty icon={<ArrowLeftRight size={20} />} title="Trade-off 없음" /> : (
            comparisonByVariant.flatMap((c) => c.tradeoffs.map((t, i) => (
              <div key={`${c.variantId}${i}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone={TRADEOFF_TONE[t.severity]}>{t.severity}</AdminBadge>
                <span className="font-semibold">{t.reason}</span>
                <span className="text-[10px] text-muted-foreground">Variant {c.variantId.slice(0, 8)}</span>
                {t.severity === 'critical' && <AdminBadge tone="danger">Governance Review Required</AdminBadge>}
              </div>
            )))
          )}
        </div>
      )}

      {/* ── Pareto ── */}
      {tab === 'pareto' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Pareto Frontier" description="단일 KPI 1등이 아니라 다목표(Skip 최소·Completion 최대·Diversity 최대) 기준 Dominated/Non-Dominated 를 구분합니다. Non-Dominated 는 검토 후보일 뿐 실행 추천이 아닙니다." />
          {!pareto.length ? <AdminEmpty icon={<Target size={20} />} title="Run 선택 필요" /> : (
            <div className="space-y-1.5">
              {pareto.map((v) => (
                <div key={v.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                  <AdminBadge tone={v.dominated ? 'neutral' : 'success'}>{v.dominated ? 'Dominated' : 'Non-Dominated'}</AdminBadge>
                  <code className="text-[10px]">{v.id.slice(0, 8)}{v.id === baselineVariantId ? ' (baseline)' : ''}</code>
                  <span className="text-[10px] text-muted-foreground">{Object.entries(v.metrics).map(([k, val]) => `${k}: ${val ?? '—'}`).join(' · ')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Stress ── */}
      {tab === 'stress' && (
        <div className="space-y-3">
          <AdminAlert tone="warning" icon={<Lock size={14} />} title="Stress Testing (가상 평가만)" description="실제 장애를 주입하지 않습니다. 선택한 비정상 상황을 Twin 에 가상 적용한 위험 평가 Evidence 만 생성합니다." />
          <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3">
            {([['queueShortage', 'Queue 부족'], ['trackPoolShortage', 'Track Pool 부족'], ['policyConflict', 'Policy 충돌'], ['guardrailConflict', 'Guardrail 충돌'], ['contextMissing', 'Context 누락'], ['memoryContradiction', 'Memory 반례'], ['constitutionViolation', 'Constitution 위반(Critical)']] as Array<[keyof StressInput, string]>).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <input type="checkbox" checked={!!stress[k]} onChange={(e) => setStress((prev) => ({ ...prev, [k]: e.target.checked }))} aria-label={label} />
                {label}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <AdminBadge tone={STRESS_TONE[stressResult.risk]}>Stress Risk: {stressResult.risk}</AdminBadge>
            <span className="text-[10px] text-muted-foreground">{stressResult.factors.join(' · ') || '요인 없음'}</span>
          </div>
          {stressResult.risk === 'critical' && <AdminAlert tone="danger" title="Critical" description="Critical Constitution Violation 또는 복합 요인 — Governance Review 필요(자동 조치 없음)." />}
        </div>
      )}

      {/* ── Resilience ── */}
      {tab === 'resilience' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Resilience (가상 평가 · Recovery 로직 무변경)" description="Fallback Coverage/Tolerance 는 proxy 입력 기반입니다. 입력이 없으면 insufficient_data 로 유지합니다(0 조작 없음)." />
          <div className="flex flex-wrap gap-2">
            {([['trackFallbackCoverage', 'Track Fallback Coverage'], ['playlistFallbackCoverage', 'Playlist Fallback Coverage'], ['qualityTolerance', 'Quality Degradation Tolerance']] as Array<[keyof typeof resilInput, string]>).map(([k, label]) => (
              <label key={k} className="text-[10px] font-bold text-muted-foreground">{label}
                <input type="number" min={0} max={100} value={resilInput[k]} onChange={(e) => setResilInput((p) => ({ ...p, [k]: e.target.value }))} className="ml-1 w-16 rounded-md border border-border bg-background px-1.5 py-1 text-[11px]" aria-label={label} />
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <AdminBadge tone={resilience.grade === 'resilient' ? 'success' : resilience.grade === 'adequate' ? 'info' : resilience.grade === 'fragile' ? 'danger' : 'neutral'}>{resilience.grade}</AdminBadge>
            <span className="text-[11px]">Score {resilience.score ?? '—'}</span>
          </div>
        </div>
      )}

      {/* ── Agent Review ── */}
      {tab === 'agentreview' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Multi-Agent Review (기존 Consensus 재사용 · 정의 무변경)" description="Agent 는 Simulation Output 을 수정하지 않고 평가 Opinion 만 생성합니다. 신호 없는 도메인은 abstain 을 유지합니다." />
          {!agentReview ? <AdminEmpty icon={<Users size={20} />} title="Run 선택 필요" description="Simulation Runs 탭에서 결과를 여세요." /> : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <AdminBadge tone={agentReview.finalDecision === 'proceed_to_governance' ? 'success' : agentReview.finalDecision === 'governance_review' ? 'warning' : 'neutral'}>{FINAL_DECISION_LABEL[agentReview.finalDecision]}</AdminBadge>
                <span className="text-[10px] text-muted-foreground">{CONSENSUS_LABEL[agentReview.consensus.type]} · Score {agentReview.consensus.score ?? '—'} · 기권 {agentReview.consensus.abstain}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1 pr-2">Agent</th><th className="px-2">Stance</th><th className="px-2">Score</th><th className="px-2">근거</th></tr></thead>
                  <tbody>
                    {agentReview.opinions.map((o) => (
                      <tr key={o.agent} className="border-b border-border/50">
                        <td className="py-1 pr-2 font-semibold">{agentDef(o.agent)?.name}</td>
                        <td className="px-2"><AdminBadge tone={STANCE_TONE[o.stance]}>{STANCE_LABEL[o.stance]}</AdminBadge></td>
                        <td className="px-2">{o.score ?? '—'}</td>
                        <td className="px-2 text-[10px] text-muted-foreground">{o.rationale}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Calibration ── */}
      {tab === 'calibration' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Calibration (실제 Outcome 연결 시에만)" description="실제 Outcome 이 축적되기 전에는 pending_outcome 을 유지하며 Simulation Accuracy 를 계산하지 않습니다(실제 Outcome 없는 Calibration PASS 보고 금지)." />
          {!results.length ? <AdminEmpty icon={<Link2 size={20} />} title="Run 선택 필요" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Metric</th><th className="px-2">Simulated</th><th className="px-2">Observed</th><th className="px-2">오차</th><th className="px-2">Status</th></tr></thead>
                <tbody>
                  {results.slice(0, 30).map((r) => (
                    <tr key={r.id} className="border-b border-border/50">
                      <td className="py-1.5 pr-2 font-semibold">{r.metric_code}</td>
                      <td className="px-2">{r.simulated_value ?? '—'}</td>
                      <td className="px-2">{r.observed_value ?? '—'}</td>
                      <td className="px-2">{r.absolute_error == null ? '—' : `${r.absolute_error} (${r.relative_error ?? '—'}%)`}</td>
                      <td className="px-2"><AdminBadge tone={r.calibration_status === 'calibrated' ? 'success' : 'neutral'}>{r.calibration_status}</AdminBadge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Audit ── */}
      {tab === 'audit' && (
        <div className="space-y-2">
          {!auditLog.length ? <AdminEmpty icon={<ScrollText size={20} />} title="Audit 없음" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Event</th><th className="px-2">상태</th><th className="px-2">사유</th><th className="px-2">시각</th></tr></thead>
                <tbody>
                  {auditLog.map((a) => (
                    <tr key={a.id} className="border-b border-border/50">
                      <td className="py-1.5 pr-2"><AdminBadge tone={a.event_type.includes('failed') || a.event_type.includes('blocked') ? 'danger' : 'neutral'}>{a.event_type}</AdminBadge></td>
                      <td className="px-2 text-[10px]">{a.previous_state ?? '—'} → {a.new_state ?? '—'}</td>
                      <td className="px-2 text-[10px] text-muted-foreground">{a.reason ?? '—'}</td>
                      <td className="px-2 text-[10px] text-muted-foreground">{a.created_at.slice(0, 16)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Support Matrix ── */}
      {tab === 'support' && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">기능</th><th className="px-2">상태</th><th className="px-2">근거</th></tr></thead>
            <tbody>
              {TWIN_SUPPORT.map((s) => (
                <tr key={s.key} className="border-b border-border/50">
                  <td className="py-1.5 pr-2 font-semibold">{s.label}</td>
                  <td className="px-2"><AdminBadge tone={s.status === 'fully_supported' ? 'success' : s.status === 'unsupported' ? 'danger' : s.status === 'insufficient_data' ? 'neutral' : 'warning'}>{s.status}</AdminBadge></td>
                  <td className="px-2 text-[10px] text-muted-foreground">{s.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2">
            <AdminAlert tone="info" icon={<FlaskConical size={14} />} title="Independent Boundary" description="AI-MUSIC-11 은 Production Apply/Deployment/Publish/Scheduler/Queue/Playback/Rollout/Experiment 실행 엔진이 아닙니다 — 읽기 전용 Snapshot 기반 Simulation Evidence Layer 입니다." />
          </div>
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
