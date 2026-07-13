/**
 * StrategySandboxSection — Autonomous Strategy Sandbox & Validation (Phase AI-MUSIC-6).
 *
 * AI-MUSIC-5 전략을 **실제 운영에 반영하지 않고** 격리 Sandbox 에서 입력/정책/제약 검증 · 시나리오
 * 시뮬레이션 · 회귀 검증 · Risk/Benefit 비교 · Go/Review/Reject 판정까지 수행한다.
 * Production Entity 무변경 · 자동 승인/실행/Draft 생성 없음 · 승인 후보 지정까지만.
 *
 * 탭: Overview · New Run · Validation · Scenarios · Comparison · Portfolio · Pareto · History · Audit · Support Matrix.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard, PlayCircle, ShieldCheck, SlidersHorizontal, GitCompare, Briefcase, ScatterChart,
  History, ScrollText, BookOpen, RefreshCw, FlaskConical, Lock,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchContextOverview, fetchContextDetail, fetchContextDrift,
  fetchSandboxConstraints, createSandboxRun, fetchSandboxHistory, fetchSandboxSummary,
  fetchSandboxDetail, markSandboxReview, fetchStrategyLearning,
  type ContextOverview, type ContextDetailResp, type ContextDriftResp, type SandboxRunRow,
  type SandboxSummary, type SandboxAuditRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import { buildContextKey, computeContextHealth, computeContextScore, type ContextDetail } from '@/lib/contextIntel';
import { computeDrift } from '@/lib/contextLearning';
import type { ItemKpi } from '@/lib/predictiveIntel';
import { generateStrategies, STRATEGY_LABEL, type Strategy, type StrategyType } from '@/lib/optimizationStrategy';
import {
  runSandboxScenario, selectBaseline, buildPortfolio, paretoFrontier, compareRuns, inputHash, sufficiencyTier,
  candidatePlaylistSnapshot, SCENARIO_PRESETS, SANDBOX_STRATEGY_SUPPORT, CONSTRAINT_SUPPORT, MODEL_VERSION,
  DECISION_LABEL, DECISION_TONE, CONSTRAINT_RESULT_TONE, REVIEW_STATUS_LABEL, REVIEW_STATUS_TONE,
  CONSTRAINT_SUPPORT_TONE, safetyTone, benefitTone, sandboxAllowed,
  type GuardrailSource, type Objective, type KpiSet, type BaselineChoice,
  type SandboxScenarioResult, type ScenarioParams,
} from '@/lib/strategySandbox';

const NUM = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('ko-KR'));
const SIGN = (n: number | null | undefined) => (n == null ? '—' : n > 0 ? `+${n}` : `${n}`);
const RANGES = ['30d', '90d', '12m'] as const;
const DAYPARTS = ['새벽', '아침', '점심', '오후', '저녁', '심야'] as const;
const OBJECTIVES: Objective[] = ['balanced', 'maximize_completion', 'minimize_skip', 'maximize_listening', 'maximize_health', 'maximize_diversity', 'maximize_new_track_exposure'];
type PresetScenario = 'conservative' | 'balanced' | 'aggressive';
const SCENARIOS: PresetScenario[] = ['conservative', 'balanced', 'aggressive'];

type Tab = 'overview' | 'newrun' | 'validation' | 'scenarios' | 'comparison' | 'portfolio' | 'pareto' | 'history' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'newrun', label: 'New Run', icon: PlayCircle },
  { key: 'validation', label: 'Validation', icon: ShieldCheck },
  { key: 'scenarios', label: 'Scenarios', icon: SlidersHorizontal },
  { key: 'comparison', label: 'Comparison', icon: GitCompare },
  { key: 'portfolio', label: 'Portfolio', icon: Briefcase },
  { key: 'pareto', label: 'Pareto', icon: ScatterChart },
  { key: 'history', label: 'History', icon: History },
  { key: 'audit', label: 'Audit', icon: ScrollText },
  { key: 'support', label: 'Support Matrix', icon: BookOpen },
];

export default function StrategySandboxSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [range, setRange] = useState<(typeof RANGES)[number]>('30d');
  const [overview, setOverview] = useState<ContextOverview | null>(null);
  const [summary, setSummary] = useState<SandboxSummary | null>(null);
  const [storeType, setStoreType] = useState<string | null>(null);
  const [daypart, setDaypart] = useState<string | null>(null);
  const [weekdayGroup, setWeekdayGroup] = useState<string | null>(null);
  const [detail, setDetail] = useState<ContextDetailResp | null>(null);
  const [drift, setDrift] = useState<ContextDriftResp | null>(null);
  const [guardrails, setGuardrails] = useState<GuardrailSource | null>(null);
  const [history, setHistory] = useState<SandboxRunRow[]>([]);
  const [histFail, setHistFail] = useState(25);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [objective, setObjective] = useState<Objective>('balanced');
  const [scenario, setScenario] = useState<PresetScenario>('balanced');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [auditRun, setAuditRun] = useState<string | null>(null);
  const [audit, setAudit] = useState<SandboxAuditRow[]>([]);

  const contextKey = useMemo(() => buildContextKey({ store_type: storeType, daypart, weekday_group: weekdayGroup }), [storeType, daypart, weekdayGroup]);

  const loadTop = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [o, s] = await Promise.all([fetchContextOverview(range), fetchSandboxSummary(null)]);
      setOverview(o); setSummary(s);
      if (o.items.length && !storeType) setStoreType(o.items[0].store_type);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, [range, storeType]);
  useEffect(() => { void loadTop(); }, [range]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadContext = useCallback(async () => {
    if (!storeType) return;
    setBusy(true);
    try {
      const [de, dr, gr, hi, lr] = await Promise.all([
        fetchContextDetail(storeType, daypart, weekdayGroup, range, 20).catch(() => null),
        fetchContextDrift(storeType, daypart, weekdayGroup, range).catch(() => null),
        fetchSandboxConstraints(storeType).catch(() => null),
        fetchSandboxHistory(contextKey || storeType, null, null, 100).catch(() => [] as SandboxRunRow[]),
        fetchStrategyLearning(contextKey || storeType).catch(() => null),
      ]);
      setDetail(de); setDrift(dr); setGuardrails(gr); setHistory(hi);
      setHistFail(lr?.totals && lr.totals.resolved_outcomes > 0 ? Math.round((lr.totals.degraded / lr.totals.resolved_outcomes) * 100) : 25);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setBusy(false); }
  }, [storeType, daypart, weekdayGroup, range, contextKey]);
  useEffect(() => { void loadContext(); }, [loadContext]);

  const d = useMemo(() => (detail ? (detail as ContextDetail) : null), [detail]);
  const driftResult = useMemo(() => (drift?.recent && drift?.prior ? computeDrift(drift.prior, drift.recent) : null), [drift]);
  const confidence = useMemo(() => (d ? computeContextScore(d.summary).confidence : 0), [d]);
  const metaCov = useMemo(() => (d && d.summary.events > 0 ? Math.round((1 - d.summary.unknown_genre_events / d.summary.events) * 100) : 80), [d]);

  const strategies = useMemo<Strategy[]>(() => {
    if (!d || !sandboxAllowed(d.summary.events)) return [];
    const toItems = (rows: { key: string; label: string; events: number; completion_rate: number | null; skip_rate: number | null }[]): ItemKpi[] => rows;
    return generateStrategies({
      summary: d.summary,
      tracks: toItems(d.tracks.map((t) => ({ key: t.track_id, label: t.title ?? t.track_id, events: t.events, completion_rate: t.completion_rate, skip_rate: t.skip_rate }))),
      playlists: toItems(d.playlists.map((p) => ({ key: p.playlist_id ?? '(none)', label: p.title ?? '(untitled)', events: p.events, completion_rate: p.completion_rate, skip_rate: p.skip_rate }))),
      genres: d.genres, moods: d.moods, confidence, driftScore: driftResult?.score ?? null,
      metadataCoverage: metaCov, historicalFailureRate: histFail, daysSinceLast: d.summary.days_since_last,
    });
  }, [d, confidence, driftResult, metaCov, histFail]);
  useEffect(() => { setSelectedIds(new Set(strategies.slice(0, 3).map((s) => s.id))); }, [strategies]);
  const selected = useMemo(() => strategies.filter((s) => selectedIds.has(s.id)), [strategies, selectedIds]);

  const baseline = useMemo<BaselineChoice>(() => {
    if (!d) return { kind: 'global', kpis: nullKpi(), fallbackUsed: true, note: 'no context' };
    const cur: KpiSet = {
      completion: d.summary.completion_rate, skip: d.summary.skip_rate, listening: d.summary.avg_listen_seconds,
      health: computeContextHealth(d.summary).score, diversity: null,
    };
    const prior: KpiSet | null = drift?.prior && drift.prior.events >= 20 ? { completion: drift.prior.completion_rate, skip: drift.prior.skip_rate, listening: null, health: null, diversity: null } : null;
    const global: KpiSet | null = d.baseline ? { completion: d.baseline.completion_rate, skip: d.baseline.skip_rate, listening: d.baseline.avg_listen_seconds, health: null, diversity: null } : null;
    return selectBaseline(cur, prior, global);
  }, [d, drift]);

  const runScenario = useCallback((sc: ScenarioParams): SandboxScenarioResult | null => {
    if (!d || !guardrails || !selected.length) return null;
    return runSandboxScenario({
      strategies: selected, summary: d.summary, genres: d.genres, moods: d.moods, guardrails,
      confidence, driftScore: driftResult?.score ?? null, metadataCoverage: metaCov, historicalSuccessRate: 100 - histFail,
      baseline, scenario: sc, contextKey: contextKey || (storeType ?? ''), objective,
    });
  }, [d, guardrails, selected, confidence, driftResult, metaCov, histFail, baseline, contextKey, storeType, objective]);

  const currentScenarioParams = useMemo<ScenarioParams>(() => SCENARIO_PRESETS[scenario], [scenario]);
  const result = useMemo(() => runScenario(currentScenarioParams), [runScenario, currentScenarioParams]);
  const allScenarios = useMemo(() => SCENARIOS.map((sc) => ({ sc, res: runScenario(SCENARIO_PRESETS[sc]) })).filter((x): x is { sc: PresetScenario; res: SandboxScenarioResult } => !!x.res), [runScenario]);

  const portfolio = useMemo(() => (strategies.length ? buildPortfolio(strategies, { costBudget: 150, riskBudget: 150, maxPerType: 2 }) : null), [strategies]);
  const pareto = useMemo(() => paretoFrontier(strategies.map((s) => ({ id: s.id, label: STRATEGY_LABEL[s.type], gain: Math.max(0, s.expected.completion), risk: s.risk.score, cost: s.cost.score, confidence: s.confidence }))), [strategies]);
  const comparison = useMemo(() => {
    const runs = compareIds.map((id) => history.find((h) => h.id === id)).filter((r): r is SandboxRunRow => !!r).slice(0, 3);
    if (runs.length < 2) return null;
    return compareRuns(runs.map((r) => ({ id: r.id!, label: r.run_name || r.scenario || r.id!.slice(0, 6), result: {
      delta_kpis: { completion: r.roi_score, skip: null, listening: null, health: null, diversity: null } as KpiSet,
      risk_score: r.risk_score ?? 0, cost_score: r.cost_score ?? 0, roi_score: r.roi_score ?? 0, safety_score: r.safety_score ?? 0,
      benefit_score: r.benefit_score ?? 0, confidence: r.confidence ?? 0, soft_constraint_warnings: 0, decision: (r.decision ?? 'failed') as never,
    } })));
  }, [compareIds, history]);

  const runSandbox = async () => {
    if (!d || !result || !guardrails) return;
    setBusy(true);
    try {
      const hash = inputHash({ contextKey: contextKey || (storeType ?? ''), strategyIds: selected.map((s) => s.id), scenario, objective, sample: d.summary.events });
      const runStatus = result.decision === 'insufficient_data' ? 'failed' : result.decision === 'go' ? 'passed' : result.decision === 'review_required' ? 'review_required' : result.decision === 'reject' ? 'rejected' : 'simulated';
      await createSandboxRun({
        context_key: contextKey || storeType, strategy_id: selected.map((s) => s.id).join('+'),
        run_name: `${scenario}/${objective}`, run_status: runStatus, objective, scenario, decision: result.decision,
        strategy_snapshot: { strategies: selected.map((s) => ({ type: s.type, target: s.target, roi: s.roi, expected: s.expected })) },
        baseline_snapshot: baseline, constraint_snapshot: { constraints: result.constraints }, scenario_config: currentScenarioParams,
        simulation_result: { baseline_kpis: result.baseline_kpis, predicted_kpis: result.predicted_kpis, delta_kpis: result.delta_kpis },
        validation_result: { regression: result.regression, decisionReasons: result.decisionReasons },
        risk_result: { risk: result.risk_score, safety: result.safety_score, benefit: result.benefit_score },
        safety_score: result.safety_score, benefit_score: result.benefit_score, roi_score: result.roi_score,
        risk_score: result.risk_score, cost_score: result.cost_score, sample_size: d.summary.events, confidence: result.confidence,
        hard_constraint_pass: result.hard_constraint_pass, fallback_used: result.fallback_used, input_hash: hash, model_version: MODEL_VERSION,
        evidence: result.evidence,
      });
      toast.success(`Sandbox Run 저장됨 (${DECISION_LABEL[result.decision]})`);
      setHistory(await fetchSandboxHistory(contextKey || (storeType ?? ''), null, null, 100));
      setSummary(await fetchSandboxSummary(null));
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  const doReview = async (id: string, status: string) => {
    setBusy(true);
    try {
      await markSandboxReview(id, status, null);
      toast.success('Review 상태 갱신됨');
      setHistory(await fetchSandboxHistory(contextKey || (storeType ?? ''), null, null, 100));
      setSummary(await fetchSandboxSummary(null));
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };
  const loadAudit = async (id: string) => {
    setAuditRun(id); setBusy(true);
    try { const dt = await fetchSandboxDetail(id); setAudit(dt.audit); } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  if (loading) return <AdminCard title="Strategy Sandbox"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Strategy Sandbox">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void loadTop()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const insufficient = !d || !sandboxAllowed(d.summary.events);
  const tier = d ? sufficiencyTier(d.summary.events) : 'insufficient';

  return (
    <AdminCard
      title="Strategy Sandbox"
      subtitle="전략을 격리 Sandbox 에서 검증·시뮬레이션 (Production 무변경 · 자동 실행/승인 없음)"
      action={
        <div className="flex items-center gap-1.5">
          <select value={range} onChange={(e) => setRange(e.target.value as (typeof RANGES)[number])} className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold">
            {RANGES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button onClick={() => { void loadTop(); void loadContext(); }} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>
        </div>
      }
    >
      {/* 고정 안내 — 운영 무변경 */}
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="Sandbox 전용 — 실제 Playlist/Queue/Scheduler/Rollout 데이터는 변경되지 않습니다. 승인 후보 지정까지만 가능하며 자동 실행/배포는 없습니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab !== 'overview' && tab !== 'support' && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-muted/30 p-2">
          <span className="text-[10px] font-bold text-muted-foreground">Context</span>
          <select value={storeType ?? ''} onChange={(e) => setStoreType(e.target.value || null)} className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold">
            {(overview?.items ?? []).map((it) => <option key={it.store_type} value={it.store_type}>{it.store_type} ({NUM(it.events)})</option>)}
          </select>
          <select value={daypart ?? ''} onChange={(e) => setDaypart(e.target.value || null)} className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold">
            <option value="">Daypart 전체</option>{DAYPARTS.map((dp) => <option key={dp} value={dp}>{dp}</option>)}
          </select>
          <select value={weekdayGroup ?? ''} onChange={(e) => setWeekdayGroup(e.target.value || null)} className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold">
            <option value="">평일/주말 전체</option><option value="weekday">평일</option><option value="weekend">주말</option>
          </select>
          {busy && <span className="text-[10px] text-muted-foreground">로딩…</span>}
          <code className="ml-auto rounded bg-background px-1.5 py-0.5 text-[10px]">{contextKey || storeType}</code>
        </div>
      )}

      {/* ── Overview ── */}
      {tab === 'overview' && (
        <div className="space-y-3">
          {summary && (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Box label="총 Run" value={NUM(summary.total)} />
              <Box label="Go / Review / Reject" value={`${NUM(summary.passed)}/${NUM(summary.review_required)}/${NUM(summary.rejected)}`} />
              <Box label="데이터 부족 / 실패" value={`${NUM(summary.insufficient_data)}/${NUM(summary.failures)}`} />
              <Box label="Expired / 승인후보" value={`${NUM(summary.expired)}/${NUM(summary.approval_candidates)}`} />
              <Box label="평균 Safety" value={summary.avg_safety == null ? '—' : `${summary.avg_safety}`} />
              <Box label="평균 Benefit" value={summary.avg_benefit == null ? '—' : `${summary.avg_benefit}`} />
              <Box label="평균 ROI" value={summary.avg_roi == null ? '—' : `${summary.avg_roi}`} />
              <Box label="Model Version" value={MODEL_VERSION} />
            </div>
          )}
          <AdminAlert tone="info" title="Sandbox = 격리 검증"
            description="전략을 실제 반영하지 않고 제약/시뮬레이션/회귀/Safety/Benefit 을 계산해 Go/Review/Reject 를 판정합니다. New Run 탭에서 시작하세요." />
        </div>
      )}

      {insufficient && tab !== 'overview' && tab !== 'support' && tab !== 'history' && tab !== 'audit' && (
        <AdminAlert tone="warning" title="Sandbox 실행 불가(표본 부족)"
          description={`이 Context 표본이 ${NUM(d?.summary.events ?? 0)} 입니다(최소 20). Sample/Baseline/Prediction 충족 시에만 실행됩니다. (Tier: ${tier})`} />
      )}

      {/* ── New Run ── */}
      {tab === 'newrun' && !insufficient && d && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-bold text-muted-foreground">Objective</span>
            <select value={objective} onChange={(e) => setObjective(e.target.value as Objective)} className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold">
              {OBJECTIVES.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <span className="text-[10px] font-bold text-muted-foreground">Scenario</span>
            {SCENARIOS.map((sc) => <button key={sc} onClick={() => setScenario(sc)} className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${scenario === sc ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}>{sc}</button>)}
          </div>
          {/* Pre-flight */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Sample" value={`${NUM(d.summary.events)} (${tier})`} />
            <Box label="Confidence" value={`${confidence}`} />
            <Box label="Drift" value={driftResult?.score != null ? `${driftResult.score}` : '데이터 부족'} />
            <Box label="Guardrails" value={`${(guardrails?.genre_guardrails.length ?? 0) + (guardrails?.store_guardrails.length ?? 0)}건`} />
          </div>
          <AdminCard title="전략 선택 (Multi-Strategy Sandbox)">
            {!strategies.length ? <p className="text-[11px] text-muted-foreground">유효 전략 없음</p> : (
              <div className="flex flex-wrap gap-1.5">
                {strategies.map((s) => {
                  const sup = SANDBOX_STRATEGY_SUPPORT.find((x) => x.type === s.type);
                  return (
                    <button key={s.id} disabled={!sup?.simulation} onClick={() => setSelectedIds((prev) => { const n = new Set(prev); n.has(s.id) ? n.delete(s.id) : n.add(s.id); return n; })}
                      title={sup?.simulation ? '' : '미지원 전략'}
                      className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${selectedIds.has(s.id) ? 'bg-accent text-black' : 'border border-border text-muted-foreground'} ${!sup?.simulation ? 'opacity-40' : ''}`}>
                      {STRATEGY_LABEL[s.type]}{s.target ? `·${s.target.slice(0, 8)}` : ''}
                    </button>
                  );
                })}
              </div>
            )}
          </AdminCard>
          {result && <ResultCard result={result} />}
          <button disabled={busy || !result} onClick={() => void runSandbox()} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[11px] font-black text-black disabled:opacity-50">
            <FlaskConical size={13} /> Sandbox 실행 (저장 · 운영 무변경)
          </button>
        </div>
      )}

      {/* ── Validation ── */}
      {tab === 'validation' && !insufficient && result && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold">판정</span><AdminBadge tone={DECISION_TONE[result.decision]}>{DECISION_LABEL[result.decision]}</AdminBadge>
            <span className="text-[10px] text-muted-foreground">{result.decisionReasons.join(' · ')}</span>
          </div>
          <AdminCard title="Constraints (Hard / Soft / 미지원)">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1 pr-2">Code</th><th className="px-2">Severity</th><th className="px-2">결과</th><th className="px-2">현재</th><th className="px-2">허용</th><th className="px-2">근거</th></tr></thead>
              <tbody>
                {result.constraints.map((c) => (
                  <tr key={c.constraint_code} className="border-b border-border/50">
                    <td className="py-1 pr-2 font-semibold">{c.label}</td>
                    <td className="px-2">{c.severity}</td>
                    <td className="px-2"><AdminBadge tone={CONSTRAINT_RESULT_TONE[c.result]}>{c.result}</AdminBadge></td>
                    <td className="px-2">{c.current_value == null ? '—' : String(c.current_value)}</td>
                    <td className="px-2">{c.allowed_value == null ? '—' : String(c.allowed_value)}</td>
                    <td className="px-2 text-[10px] text-muted-foreground">{c.explanation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminCard>
          <AdminCard title="Regression Validation">
            {result.regression.map((r) => (
              <div key={r.key} className="flex items-center justify-between border-b border-border/40 py-1 text-[11px]">
                <span>{r.label} <span className="text-muted-foreground">(Δ {r.delta == null ? '—' : SIGN(r.delta)} / th {r.threshold})</span></span>
                <AdminBadge tone={r.result === 'pass' ? 'success' : r.result === 'fail' ? 'danger' : 'info'}>{r.result}</AdminBadge>
              </div>
            ))}
          </AdminCard>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Conflict" value={`${result.conflict_count}`} />
            <Box label="Dependency" value={`${result.dependency_count}`} />
            <Box label="Safety" value={`${result.safety_score}`} tone={safetyTone(result.safety_score)} />
            <Box label="Benefit" value={`${result.benefit_score}`} tone={benefitTone(result.benefit_score)} />
          </div>
          {/* Candidate Diff */}
          {selected.some((s) => ['track_promotion', 'track_demotion', 'track_replacement'].includes(s.type)) && d && (
            <AdminCard title="Candidate Diff (운영 데이터 무변경)">
              {selected.filter((s) => ['track_promotion', 'track_demotion', 'track_replacement'].includes(s.type)).map((s) => {
                const cand = candidatePlaylistSnapshot(s, d.summary, d.genres, !result.hard_constraint_pass);
                return (
                  <div key={s.id} className="border-b border-border/40 py-1 text-[11px]">
                    <b>{STRATEGY_LABEL[s.type]}</b> · 추가 {cand.add.join(',') || '—'} / 제거 {cand.remove.join(',') || '—'} / 교체 {cand.replace.map((r) => `${r.out}→${r.in}`).join(',') || '—'} · Track {cand.track_count_before}→{cand.track_count_after}
                  </div>
                );
              })}
            </AdminCard>
          )}
        </div>
      )}

      {/* ── Scenarios ── */}
      {tab === 'scenarios' && !insufficient && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Conservative / Balanced / Aggressive 비교"
            description="시나리오 Parameter 는 명시적 설정값입니다. Hard Constraint 는 어떤 시나리오도 위반할 수 없습니다." />
          {!allScenarios.length ? <AdminEmpty icon={<SlidersHorizontal size={20} />} title="전략 선택 필요" /> : (
            <div className="grid gap-2 md:grid-cols-3">
              {allScenarios.map(({ sc, res }) => (
                <AdminCard key={sc} title={sc}>
                  <div className="space-y-1 text-[11px]">
                    <Row k="완주율 Δ" v={SIGN(res.delta_kpis.completion)} />
                    <Row k="Skip Δ" v={SIGN(res.delta_kpis.skip)} />
                    <Row k="ROI / Risk" v={`${res.roi_score} / ${res.risk_score}`} />
                    <Row k="Safety / Benefit" v={`${res.safety_score} / ${res.benefit_score}`} />
                    <Row k="Confidence" v={`${res.confidence}`} />
                    <div className="flex items-center justify-between pt-1"><span className="text-muted-foreground">Decision</span><AdminBadge tone={DECISION_TONE[res.decision]}>{DECISION_LABEL[res.decision]}</AdminBadge></div>
                  </div>
                </AdminCard>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Comparison ── */}
      {tab === 'comparison' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Sandbox Run 비교 (최대 3개, Winner 단정 없음)" description="History 의 Run 을 최대 3개 선택해 항목별로 비교합니다." />
          <div className="flex flex-wrap gap-1.5">
            {history.slice(0, 12).map((h) => (
              <button key={h.id} onClick={() => setCompareIds((prev) => prev.includes(h.id!) ? prev.filter((x) => x !== h.id) : prev.length < 3 ? [...prev, h.id!] : prev)}
                className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${compareIds.includes(h.id!) ? 'bg-accent text-black' : 'border border-border text-muted-foreground'}`}>
                {h.run_name || h.scenario} · {DECISION_LABEL[(h.decision ?? 'failed') as never]}
              </button>
            ))}
          </div>
          {!comparison ? <AdminEmpty icon={<GitCompare size={20} />} title="2개 이상 선택" /> : (
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1 pr-2">지표</th>{comparison.runs.map((r) => <th key={r} className="px-2">{r}</th>)}<th className="px-2">비교</th></tr></thead>
              <tbody>
                {comparison.rows.map((row) => (
                  <tr key={row.metric} className="border-b border-border/50">
                    <td className="py-1 pr-2 font-semibold">{row.metric}</td>
                    {row.values.map((v, i) => <td key={i} className="px-2">{v == null ? '—' : String(v)}</td>)}
                    <td className="px-2 text-[10px] text-muted-foreground">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Portfolio ── */}
      {tab === 'portfolio' && !insufficient && portfolio && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Strategy Portfolio (Cost/Risk Budget · 편중/중복 제한)" description="실제 실행 없음. Budget 초과·중복 전략은 제외 사유와 함께 표시합니다." />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="선택/제외" value={`${portfolio.selected.length}/${portfolio.excluded.length}`} />
            <Box label="총 Cost" value={`${portfolio.total_cost}`} />
            <Box label="총 Risk" value={`${portfolio.total_risk}`} />
            <Box label="Portfolio Conf" value={`${portfolio.portfolio_confidence}`} />
          </div>
          <AdminCard title="선택 전략">
            {portfolio.selected.map((s) => <div key={s.id} className="flex items-center gap-2 border-b border-border/40 py-1 text-[11px]"><AdminBadge tone="success">ROI {s.roi}</AdminBadge><span className="font-semibold">{STRATEGY_LABEL[s.type]}{s.target ? `·${s.target}` : ''}</span></div>)}
          </AdminCard>
          {portfolio.excluded.length > 0 && (
            <AdminCard title="제외 전략">
              {portfolio.excluded.map((e) => <div key={e.strategy.id} className="flex items-center justify-between border-b border-border/40 py-1 text-[11px]"><span>{STRATEGY_LABEL[e.strategy.type]}</span><span className="text-muted-foreground">{e.reason}</span></div>)}
            </AdminCard>
          )}
        </div>
      )}

      {/* ── Pareto ── */}
      {tab === 'pareto' && !insufficient && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Pareto Frontier (Gain↑ · Risk↓ · Cost↓ · Confidence↑)" description="지배당하는 후보는 별도 표시. 단일 최고 전략으로 단정하지 않습니다." />
          {!pareto.length ? <AdminEmpty icon={<ScatterChart size={20} />} title="전략 없음" /> : (
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1 pr-2">전략</th><th className="px-2">Gain</th><th className="px-2">Risk</th><th className="px-2">Cost</th><th className="px-2">Conf</th><th className="px-2">상태</th></tr></thead>
              <tbody>
                {pareto.map((p) => (
                  <tr key={p.id} className="border-b border-border/50">
                    <td className="py-1 pr-2 font-semibold">{p.label}</td>
                    <td className="px-2">{p.gain}</td><td className="px-2">{p.risk}</td><td className="px-2">{p.cost}</td><td className="px-2">{p.confidence}</td>
                    <td className="px-2"><AdminBadge tone={p.dominated ? 'neutral' : 'success'}>{p.dominated ? '지배됨' : 'Frontier'}</AdminBadge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── History ── */}
      {tab === 'history' && (
        <div className="space-y-2">
          {!history.length ? <AdminEmpty icon={<History size={20} />} title="Sandbox Run 없음" description="New Run 에서 실행하세요." /> : history.map((h) => (
            <div key={h.id} className="rounded-lg border border-border p-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <AdminBadge tone={DECISION_TONE[(h.decision ?? 'failed') as never]}>{DECISION_LABEL[(h.decision ?? 'failed') as never]}</AdminBadge>
                <AdminBadge tone={REVIEW_STATUS_TONE[h.review_status] ?? 'neutral'}>{REVIEW_STATUS_LABEL[h.review_status] ?? h.review_status}</AdminBadge>
                <span className="text-[11px] font-semibold">{h.run_name}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">Safety {h.safety_score} · ROI {h.roi_score} · {h.created_at.slice(0, 16).replace('T', ' ')}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(h.decision === 'go' || h.decision === 'review_required') && h.review_status !== 'approval_candidate' && h.run_status !== 'expired' && (
                  <button disabled={busy} onClick={() => void doReview(h.id!, 'approval_candidate')} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">승인 후보 지정</button>
                )}
                {h.review_status !== 'rejected' && <button disabled={busy} onClick={() => void doReview(h.id!, 'rejected')} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">기각</button>}
                <button disabled={busy} onClick={() => { setTab('audit'); void loadAudit(h.id!); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Audit</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Audit ── */}
      {tab === 'audit' && (
        <div className="space-y-3">
          {!auditRun ? <AdminEmpty icon={<ScrollText size={20} />} title="Run 선택" description="History 에서 Audit 을 클릭하세요." /> : !audit.length ? <p className="text-[11px] text-muted-foreground">Audit 없음</p> : (
            <ol className="space-y-1">
              {audit.map((a) => (
                <li key={a.id} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                  <AdminBadge tone="neutral">{a.action}</AdminBadge>
                  <span>{a.previous_state ?? '—'} → {a.next_state ?? '—'}</span>
                  {a.reason && <span className="text-muted-foreground">· {a.reason}</span>}
                  <span className="ml-auto text-[10px] text-muted-foreground">{a.created_at.slice(0, 16).replace('T', ' ')}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {/* ── Support Matrix ── */}
      {tab === 'support' && (
        <div className="space-y-3">
          <AdminCard title="Strategy Support">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1 pr-2">전략</th><th className="px-2">Sim</th><th className="px-2">Policy</th><th className="px-2">Dep</th><th className="px-2">Conflict</th><th className="px-2">Regression</th></tr></thead>
              <tbody>
                {SANDBOX_STRATEGY_SUPPORT.map((s) => (
                  <tr key={s.type} className="border-b border-border/50">
                    <td className="py-1 pr-2 font-semibold">{STRATEGY_LABEL[s.type as StrategyType]}</td>
                    {[s.simulation, s.policy, s.dependency, s.conflict, s.regression].map((v, i) => <td key={i} className="px-2">{v ? '✓' : '—'}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminCard>
          <AdminCard title="Constraint Support (실제 DB 기준)">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1 pr-2">Constraint</th><th className="px-2">상태</th><th className="px-2">근거</th></tr></thead>
              <tbody>
                {CONSTRAINT_SUPPORT.map((c) => (
                  <tr key={c.key} className="border-b border-border/50">
                    <td className="py-1 pr-2 font-semibold">{c.label}</td>
                    <td className="px-2"><AdminBadge tone={CONSTRAINT_SUPPORT_TONE[c.status]}>{c.status}</AdminBadge></td>
                    <td className="px-2 text-[10px] text-muted-foreground">{c.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminCard>
        </div>
      )}
    </AdminCard>
  );
}

function nullKpi(): KpiSet { return { completion: null, skip: null, listening: null, health: null, diversity: null }; }
function Box({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'warning' | 'danger' | 'neutral' }) {
  const color = tone === 'success' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'danger' ? 'text-rose-600 dark:text-rose-400' : tone === 'warning' ? 'text-amber-600 dark:text-amber-400' : '';
  return (
    <div className="rounded-lg border border-border p-2">
      <p className="text-[10px] font-bold text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-sm font-black break-words ${color}`}>{value}</p>
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) { return <div className="flex items-center justify-between"><span className="text-muted-foreground">{k}</span><b>{v}</b></div>; }
function ResultCard({ result }: { result: SandboxScenarioResult }) {
  return (
    <AdminCard title="Sandbox 결과 (미저장 미리보기)">
      <div className="mb-2 flex items-center gap-2">
        <AdminBadge tone={DECISION_TONE[result.decision]}>{DECISION_LABEL[result.decision]}</AdminBadge>
        <span className="text-[10px] text-muted-foreground">{result.decisionReasons.join(' · ')}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Box label="완주율 Δ" value={SIGN(result.delta_kpis.completion)} tone={(result.delta_kpis.completion ?? 0) > 0 ? 'success' : undefined} />
        <Box label="Skip Δ" value={SIGN(result.delta_kpis.skip)} />
        <Box label="Safety" value={`${result.safety_score}`} tone={safetyTone(result.safety_score)} />
        <Box label="Benefit" value={`${result.benefit_score}`} tone={benefitTone(result.benefit_score)} />
        <Box label="ROI / Risk / Cost" value={`${result.roi_score}/${result.risk_score}/${result.cost_score}`} />
        <Box label="Hard Pass" value={result.hard_constraint_pass ? '통과' : '위반'} tone={result.hard_constraint_pass ? 'success' : 'danger'} />
        <Box label="Soft 경고 / 충돌" value={`${result.soft_constraint_warnings}/${result.conflict_count}`} />
        <Box label="Fallback" value={result.fallback_used ? 'Y' : 'N'} />
      </div>
    </AdminCard>
  );
}
