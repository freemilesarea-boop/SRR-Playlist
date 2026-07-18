/**
 * DecisionLaboratorySection — Enterprise Scenario Intelligence, Predictive
 * Simulation & Executive Decision Laboratory (Phase AI-OPS-53).
 *
 * Enterprise Vision→Mission→Current State→Scenario Generation→Alternative
 * Strategies→Trade-off Analysis→Impact/Resource/Financial/Operational/Risk
 * Simulation→Scenario Comparison→Executive Decision Laboratory→Human
 * Decision→Scenario Learning→Audit.
 * Scenario ≠ Future Reality · Simulation ≠ Prediction · Ranking ≠ Executive
 * Priority · Trade-off ≠ Optimal Solution. 자동 전략 실행/프로젝트 생성 없음.
 * (기존 ScenarioIntelligenceSection(0542)/StrategicScenarioSection(0516)과
 *  별도 신규 계층)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, BookOpen, ClipboardList, FlaskConical, Gauge, GitBranch, Grid3x3,
  History, Inbox, Layers, Lightbulb, Lock, RefreshCw, Scale, Shield, Users,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchEnterpriseDecisionLabSummary, fetchEnterpriseDecisionScenarios,
  createEnterpriseDecisionScenario, reviewEnterpriseDecisionScenario,
  createEnterpriseDecisionScenarioReview, reviewEnterpriseDecisionScenarioReview,
  fetchEnterpriseDecisionScenarioReviews, recordEnterpriseDecisionScenarioEvent,
  fetchEnterpriseDecisionLabAudit,
  type EnterpriseDecisionLabSummary, type EnterpriseDecisionScenarioRow,
  type EnterpriseDecisionScenarioReviewRow, type EnterpriseDecisionScenarioEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  SCENARIO_CATEGORIES, IMPACT_SIMULATION_DIMENSIONS, IMPACT_SIMULATION_RESULTS,
  TRADEOFF_DIMENSIONS, TRADEOFF_RESULTS, SCENARIO_CONFIDENCE_RESULTS,
  SCENARIO_RECOMMENDATION_TYPES, DECISION_SCORECARD_FIELDS, buildScenarioTimeline,
  ENTERPRISE_SCENARIO_COMPONENTS, ENTERPRISE_SCENARIO_SUPPORT_MATRIX,
} from '@/lib/enterpriseScenario';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'scenarios' | 'alternatives' | 'whatif' | 'resource' | 'financial'
  | 'operational' | 'risksim' | 'impact' | 'tradeoff' | 'confidence' | 'costbenefit' | 'ranking'
  | 'comparison' | 'summary' | 'scorecard' | 'recommendations' | 'reviewqueue' | 'reviewed'
  | 'humandecision' | 'learning' | 'links' | 'flow' | 'audit' | 'support' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Scenario Overview', icon: Layers },
  { key: 'scenarios', label: 'Decision Scenarios', icon: FlaskConical },
  { key: 'alternatives', label: 'Alternative Strategies', icon: GitBranch },
  { key: 'whatif', label: 'What-if Simulation', icon: Activity },
  { key: 'resource', label: 'Resource Simulation', icon: Gauge },
  { key: 'financial', label: 'Financial Simulation', icon: Gauge },
  { key: 'operational', label: 'Operational Simulation', icon: Activity },
  { key: 'risksim', label: 'Risk Simulation', icon: Shield },
  { key: 'impact', label: 'Impact Simulation', icon: Activity },
  { key: 'tradeoff', label: 'Trade-off Analysis', icon: Scale },
  { key: 'confidence', label: 'Scenario Confidence', icon: Gauge },
  { key: 'costbenefit', label: 'Cost / Benefit', icon: Scale },
  { key: 'ranking', label: 'Scenario Ranking', icon: Grid3x3 },
  { key: 'comparison', label: 'Scenario Comparison', icon: Scale },
  { key: 'summary', label: 'Executive Decision Summaries', icon: ClipboardList },
  { key: 'scorecard', label: 'Executive Decision Scorecard', icon: Grid3x3 },
  { key: 'recommendations', label: 'Recommendations', icon: Lightbulb },
  { key: 'reviewqueue', label: 'Review Queue', icon: Inbox },
  { key: 'reviewed', label: 'Review References', icon: Users },
  { key: 'humandecision', label: 'Human Decisions', icon: Users },
  { key: 'learning', label: 'Scenario Learning', icon: BookOpen },
  { key: 'links', label: 'Reference Links', icon: GitBranch },
  { key: 'flow', label: 'Flow Timeline', icon: History },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
  { key: 'limitations', label: 'Known Limitations', icon: ClipboardList },
];

const KNOWN_LIMITATIONS = [
  '전략 자동 실행·프로젝트 자동 생성·Budget 자동 변경·계약 자동 체결·조직/KPI 자동 변경·Production 변경·Merge/Deploy/Rollback 없음 — 모든 반환 flag(strategy_executed/project_created/budget_changed 등) 항상 false',
  'Scenario ≠ Future Reality · Simulation ≠ Prediction — 어떤 시나리오도 자동 실행되지 않습니다',
  'Ranking ≠ Executive Priority · Trade-off ≠ Optimal Solution · Cost Estimate ≠ Actual Cost · Risk Estimate ≠ Actual Risk',
  'Scenario Review Reference 는 Self-Review 차단(작성자 ≠ 평가자) + Evidence 필수 — Review ≠ Approval, 채택·실행은 사람',
  'archived_reference/review_reference_recorded 재결정 차단 · 참조 실존 검증(0545/0547/0549/0555/0556)',
  '이름 충돌 실측: 0542(AI-OPS-38)가 ai_enterprise_scenario_events·admin_enterprise_scenario_* 를 사용 중 → 본 계층은 ai_enterprise_decision_scenario*/admin_enterprise_decision_scenario_* 로 명명(별개 계층)',
  '재무 계획 시스템/ERP/프로젝트 관리 피드/인력 캐파 피드/외부 예측 피드/Monte Carlo 엔진 부재(실측) — insufficient_data 유지, Simulation 은 수동 입력 기반 후보 계산',
  'Scenario Timeline/Simulation·Trade-off·Impact History 는 simulation_history JSONB append — 시계열 원장 테이블 아님',
  'Migration 0472~0557 production 미적용 — 운영 수치는 적용 후 축적됩니다',
  '브라우저 실측 미검증 — UI 는 코드 리뷰/타입/빌드 기준 검증만 수행했습니다',
];

export default function DecisionLaboratorySection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<EnterpriseDecisionLabSummary>({});
  const [scenarios, setScenarios] = useState<EnterpriseDecisionScenarioRow[]>([]);
  const [reviews, setReviews] = useState<EnterpriseDecisionScenarioReviewRow[]>([]);
  const [audit, setAudit] = useState<EnterpriseDecisionScenarioEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [selScenario, setSelScenario] = useState('');
  const [selReview, setSelReview] = useState('');
  const [catSel, setCatSel] = useState<string>('strategy');
  const [impactDimSel, setImpactDimSel] = useState<string>('financial_impact');
  const [tradeoffDimSel, setTradeoffDimSel] = useState<string>('cost');
  const [recTypeSel, setRecTypeSel] = useState<string>('gather_more_evidence_candidate');
  const [resultSel, setResultSel] = useState<string>('insufficient_data');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, sc, r, a] = await Promise.all([
        fetchEnterpriseDecisionLabSummary(), fetchEnterpriseDecisionScenarios(null, null, 200),
        fetchEnterpriseDecisionScenarioReviews(null, 200), fetchEnterpriseDecisionLabAudit(200),
      ]);
      setSummary(s); setScenarios(sc); setReviews(r); setAudit(a);
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
  const scnReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selScenario) { if (!selScenario) toast.error('Scenario 선택 필수'); return; }
    void act(() => reviewEnterpriseDecisionScenario(selScenario, action, r, payload), ok);
  };
  const srReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selReview) { if (!selReview) toast.error('Scenario Review 선택 필수'); return; }
    void act(() => reviewEnterpriseDecisionScenarioReview(selReview, action, r, payload), ok);
  };
  const scnEvent = (kind: string, payload: Record<string, unknown>, ok: string, ids: { scn?: boolean; review?: boolean } = { scn: true }) => {
    const r = needReason();
    if (!r) return;
    void act(() => recordEnterpriseDecisionScenarioEvent(kind, r, payload, ids.scn ? (selScenario || null) : null, ids.review ? (selReview || null) : null), ok);
  };

  const obj = useCallback((k: string): Record<string, unknown> => (typeof summary[k] === 'object' && summary[k] !== null && !Array.isArray(summary[k]) ? summary[k] as Record<string, unknown> : {}), [summary]);
  const num = useCallback((k: string, sub: string): number | null => {
    const v = obj(k)[sub];
    return typeof v === 'number' ? v : null;
  }, [obj]);

  const flowTimeline = useMemo(() => buildScenarioTimeline({ present: {
    enterprise_vision: (num('scenario_actuals', 'missions_0555') ?? 0) > 0,
    mission: (num('scenario_events', 'mission_links') ?? 0) > 0,
    current_state: (num('scenarios', 'total') ?? 0) > 0,
    scenario_generation: (num('scenarios', 'total') ?? 0) > 0,
    alternative_strategies: (num('scenario_events', 'alternatives') ?? 0) > 0,
    tradeoff_analysis: (num('scenario_events', 'tradeoff_reviews') ?? 0) > 0,
    impact_simulation: (num('scenario_events', 'impact_reviews') ?? 0) > 0,
    resource_simulation: (num('scenario_events', 'resource_simulations') ?? 0) > 0,
    financial_simulation: (num('scenario_events', 'financial_simulations') ?? 0) > 0,
    operational_simulation: (num('scenario_events', 'operational_simulations') ?? 0) > 0,
    risk_simulation: (num('scenario_events', 'risk_simulations') ?? 0) > 0,
    scenario_comparison: (num('scenario_events', 'comparisons') ?? 0) + (num('scenario_events', 'rankings') ?? 0) > 0,
    executive_decision_laboratory: (num('scenario_events', 'scorecards') ?? 0) + (num('scenario_events', 'summaries') ?? 0) > 0,
    human_decision: (num('scenario_events', 'human_decisions') ?? 0) > 0,
    scenario_learning: (num('scenario_events', 'learnings') ?? 0) > 0,
  } }), [num]);

  if (loading) return <AdminCard title="Scenario Intelligence & Executive Decision Laboratory"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Scenario Intelligence & Executive Decision Laboratory">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const scnSelect = (
    <select value={selScenario} onChange={(e) => setSelScenario(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Scenario 선택</option>
      {scenarios.map((s) => <option key={s.id} value={s.id}>{s.scenario_code} · {s.scenario_status}</option>)}
    </select>
  );
  const reviewSelect = (
    <select value={selReview} onChange={(e) => setSelReview(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Scenario Review 선택</option>
      {reviews.map((r) => <option key={r.id} value={r.id}>{r.review_code} · {r.review_status}</option>)}
    </select>
  );
  const reasonInput = <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button disabled={busy} onClick={onClick} className={primary ? 'rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50' : 'rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50'}>{label}</button>
  );
  const tone = (s: string) => (s.includes('high_positive') || s.includes('highly_balanced') || s.includes('high_confidence') || s.includes('review_reference') ? 'success' as const : s.includes('high_negative') || s.includes('poor_tradeoff') || s.includes('speculative') || s === 'unavailable' ? 'danger' as const : 'warning' as const);
  const evByType = (t: string) => audit.filter((e) => e.event_type === t);
  const eventList = (rows: EnterpriseDecisionScenarioEventRow[], emptyTitle: string, emptyDesc: string) => (
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
  const scnList = (list: EnterpriseDecisionScenarioRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((s) => (
          <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(s.scenario_status)}>{s.scenario_status}</AdminBadge>
            <AdminBadge tone={tone(s.impact_status)}>{s.impact_status}</AdminBadge>
            <AdminBadge tone={tone(s.tradeoff_status)}>{s.tradeoff_status}</AdminBadge>
            <span className="ml-2 font-bold">{s.scenario_code}</span>
            <span className="ml-2 text-muted-foreground">{s.scenario_category} · {s.scenario_title} · alternatives {Array.isArray(s.alternatives) ? s.alternatives.length : 0}건 · simulations {Array.isArray(s.simulation_history) ? s.simulation_history.length : 0}건</span>
          </div>
        ))}
      </div>
    )
  );
  const reviewList = (list: EnterpriseDecisionScenarioReviewRow[], emptyTitle: string, emptyDesc: string) => (
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
        {scnSelect}{reasonInput}
        {btn(`${title} 기록`, () => scnEvent(kind, { note: reason.trim() }, `${title} 기록됨`), true)}
      </div>
      <AdminAlert tone="info" description={note} />
      {eventList(evByType(kind), `${title} 없음`, '기록이 여기에 표시됩니다.')}
    </div>
  );
  const resultEventTab = (kind: string, title: string, note: string, results: readonly string[], extraPayload: Record<string, unknown> = {}) => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        {scnSelect}
        <select value={results.includes(resultSel) ? resultSel : results[0]} onChange={(e) => setResultSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
          {results.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {reasonInput}
        {btn(`${title} 기록`, () => scnEvent(kind, { result: results.includes(resultSel) ? resultSel : results[0], ...extraPayload }, `${title} 기록됨`), true)}
      </div>
      <AdminAlert tone="info" description={note} />
      {eventList(evByType(kind), `${title} 없음`, '사람 검토 기록이 여기에 표시됩니다.')}
    </div>
  );

  return (
    <AdminCard
      title="Scenario Intelligence & Executive Decision Laboratory"
      subtitle="Current State→Scenario Generation→Alternatives→Trade-off→Impact/Resource/Financial/Operational/Risk Simulation→Comparison→Decision Laboratory→Human Decision→Learning — 결정과 실행은 반드시 사람"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 현재 Enterprise 상태를 기반으로 여러 실행 시나리오를 생성하고 장단점·영향·리스크·예상 결과를 설명하는 Executive Decision Laboratory 계층입니다. AI 는 Scenario/Alternative Strategy 생성·What-if/Resource/Financial/Operational/Risk Simulation·Trade-off/Cost-Benefit 비교·Scenario Ranking·Executive Summary/Scorecard·Recommendation·Review 요청·Learning 기록까지만 수행하며, 전략 자동 실행·프로젝트 자동 생성·Budget 자동 변경·계약 자동 체결·조직/KPI 자동 변경·Production 변경·Merge/Deploy/Rollback 은 수행하지 않습니다. Scenario ≠ Future Reality, Simulation ≠ Prediction, Ranking ≠ Executive Priority, Trade-off ≠ Optimal Solution. AI 는 가능성을 설명합니다. 사람이 결정을 내리고 실행합니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Decision Scenarios" value={NUM(num('scenarios', 'total'))} />
            <Box label="Draft / Candidate / Reference / Archived" value={`${NUM(num('scenarios', 'draft'))} / ${NUM(num('scenarios', 'candidate'))} / ${NUM(num('scenarios', 'review_reference'))} / ${NUM(num('scenarios', 'archived'))}`} />
            <Box label="High Positive / High Negative Impact" value={`${NUM(num('scenarios', 'high_positive'))} / ${NUM(num('scenarios', 'high_negative'))}`} />
            <Box label="Well Balanced / Poor Trade-off" value={`${NUM(num('scenarios', 'well_balanced'))} / ${NUM(num('scenarios', 'poor_tradeoff'))}`} />
            <Box label="Low Confidence·Speculative" value={NUM(num('scenarios', 'speculative'))} />
            <Box label="Scenario Reviews" value={NUM(num('reviews', 'total'))} />
            <Box label="Requested / In Review / Reference / Revision" value={`${NUM(num('reviews', 'requested'))} / ${NUM(num('reviews', 'in_review'))} / ${NUM(num('reviews', 'reference_recorded'))} / ${NUM(num('reviews', 'revision_requested'))}`} />
            <Box label="Alternatives / What-if Simulations" value={`${NUM(num('scenario_events', 'alternatives'))} / ${NUM(num('scenario_events', 'whatif_simulations'))}`} />
            <Box label="Resource / Financial / Operational / Risk Sim" value={`${NUM(num('scenario_events', 'resource_simulations'))} / ${NUM(num('scenario_events', 'financial_simulations'))} / ${NUM(num('scenario_events', 'operational_simulations'))} / ${NUM(num('scenario_events', 'risk_simulations'))}`} />
            <Box label="Impact / Trade-off / Confidence Reviews" value={`${NUM(num('scenario_events', 'impact_reviews'))} / ${NUM(num('scenario_events', 'tradeoff_reviews'))} / ${NUM(num('scenario_events', 'confidence_reviews'))}`} />
            <Box label="Cost-Benefit / Rankings / Comparisons" value={`${NUM(num('scenario_events', 'cost_benefits'))} / ${NUM(num('scenario_events', 'rankings'))} / ${NUM(num('scenario_events', 'comparisons'))}`} />
            <Box label="Summaries / Scorecards / Recommendations" value={`${NUM(num('scenario_events', 'summaries'))} / ${NUM(num('scenario_events', 'scorecards'))} / ${NUM(num('scenario_events', 'recommendations'))}`} />
            <Box label="Scenario / Executive / Human Review 요청" value={`${NUM(num('scenario_events', 'scenario_review_requests'))} / ${NUM(num('scenario_events', 'executive_review_requests'))} / ${NUM(num('scenario_events', 'human_review_requests'))}`} />
            <Box label="Review References" value={NUM(num('scenario_events', 'review_references'))} />
            <Box label="Human Decisions / Learnings" value={`${NUM(num('scenario_events', 'human_decisions'))} / ${NUM(num('scenario_events', 'learnings'))}`} />
            <Box label="Mission / Portfolio / Environment Links" value={`${NUM(num('scenario_events', 'mission_links'))} / ${NUM(num('scenario_events', 'portfolio_links'))} / ${NUM(num('scenario_events', 'environment_links'))}`} />
          </div>
          <AdminAlert tone="info" description={`scenario_unavailable: ${Array.isArray(summary.scenario_unavailable) ? (summary.scenario_unavailable as unknown[]).map(String).join(', ') : '—'}. Scenario 원천 실측 — Environment Observations(0556) ${NUM(num('scenario_actuals', 'environment_observations_0556'))}건 · Missions(0555) ${NUM(num('scenario_actuals', 'missions_0555'))}건 · Strategy Portfolios(0545) ${NUM(num('scenario_actuals', 'strategy_portfolios_0545'))}건 · Business Values(0549) ${NUM(num('scenario_actuals', 'business_values_0549'))}건 · Scenario Runs(0542) ${NUM(num('scenario_actuals', 'scenario_runs_0542'))}건 · Decision Outcomes(0514) ${NUM(num('scenario_actuals', 'decision_outcomes_0514'))}건. 0 과 Unknown 을 혼동하지 않습니다.`} />
        </div>
      )}

      {tab === 'scenarios' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <select value={catSel} onChange={(e) => setCatSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {SCENARIO_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {reasonInput}
            {btn('Decision Scenario 생성(≠ 실행)', () => {
              const r = needReason();
              if (!r) return;
              void act(() => createEnterpriseDecisionScenario({ scenario_category: catSel, scenario_title: r }), 'Scenario 생성됨(draft — 자동 실행 없음)');
            }, true)}
            {btn('Candidate 표시', () => scnReview('mark_candidate', {}, 'candidate'))}
            {btn('Review Reference(Self 차단·Evidence 필수)', () => scnReview('record_review_reference', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'review_reference(≠ Approval)'))}
            {btn('Archive', () => scnReview('archive_reference', {}, 'archived_reference'))}
            {btn('Insufficient Data', () => scnReview('mark_insufficient_data', {}, 'insufficient_data'))}
            {scnSelect}
          </div>
          <AdminAlert tone="info" description="Category 14종 · 자동 실행/프로젝트 생성/Budget·계약·조직·KPI 변경 계열 category 서버 차단 · archived 재결정 차단." />
          {scnList(scenarios, 'Decision Scenario 없음', '핵심 질문 예: 선택 가능한 전략은? 가장 현실적인 대안은? — 전부 Candidate 분석.')}
        </div>
      )}

      {tab === 'alternatives' && simpleEventTab('alternative_strategy_recorded', 'Alternative Strategy 기록', 'Alternative ≠ 실행 — 대안 전략 후보를 alternatives 로 축적합니다.')}
      {tab === 'whatif' && simpleEventTab('whatif_simulation_recorded', 'What-if Simulation 기록', 'Simulation ≠ Prediction — 가정 기반 후보 계산이며 예측 확정이 아닙니다.')}
      {tab === 'resource' && simpleEventTab('resource_simulation_recorded', 'Resource Simulation 기록', 'Resource Simulation ≠ 배치 확정 — 자원 소요 후보 계산입니다.')}
      {tab === 'financial' && simpleEventTab('financial_simulation_recorded', 'Financial Simulation 기록', 'Cost Estimate ≠ Actual Cost — 재무 영향 후보 계산입니다.')}
      {tab === 'operational' && simpleEventTab('operational_simulation_recorded', 'Operational Simulation 기록', 'Operational Simulation ≠ 운영 변경 — 운영 영향 후보 계산입니다.')}
      {tab === 'risksim' && simpleEventTab('risk_simulation_recorded', 'Risk Simulation 기록', 'Risk Estimate ≠ Actual Risk — 리스크 후보 계산입니다.')}

      {tab === 'impact' && (
        <>
          {resultEventTab('impact_simulation_reviewed', 'Impact Simulation 검토', 'Impact 5평가(§5 — Financial/Operational/Mission/Resource/Risk) — Impact Candidate ≠ 확정 영향.', IMPACT_SIMULATION_RESULTS, { impact_dimension: impactDimSel })}
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <span className="text-[11px] text-muted-foreground">Impact Dimension:</span>
            <select value={impactDimSel} onChange={(e) => setImpactDimSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {IMPACT_SIMULATION_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </>
      )}
      {tab === 'tradeoff' && (
        <>
          {resultEventTab('tradeoff_analysis_reviewed', 'Trade-off Analysis 검토', 'Trade-off 5평가(§6 — Cost/Benefit/Complexity/Time/Risk) — Trade-off ≠ Optimal Solution.', TRADEOFF_RESULTS, { tradeoff_dimension: tradeoffDimSel })}
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <span className="text-[11px] text-muted-foreground">Trade-off Dimension:</span>
            <select value={tradeoffDimSel} onChange={(e) => setTradeoffDimSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {TRADEOFF_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </>
      )}
      {tab === 'confidence' && resultEventTab('scenario_confidence_reviewed', 'Scenario Confidence 검토', 'Confidence 5평가(§7 — Evidence/Coverage/Stability/Consistency/Similar History) — Confidence ≠ Certainty.', SCENARIO_CONFIDENCE_RESULTS)}
      {tab === 'costbenefit' && simpleEventTab('cost_benefit_recorded', 'Cost/Benefit 기록', 'Cost/Benefit 후보 ≠ 확정 수치 — 비용·효익 비교 후보입니다.')}
      {tab === 'ranking' && simpleEventTab('scenario_ranking_recorded', 'Scenario Ranking 기록', 'Ranking ≠ Executive Priority — 결정적 정렬 후보이며 우선순위 확정이 아닙니다.')}
      {tab === 'comparison' && simpleEventTab('scenario_comparison_recorded', 'Scenario Comparison 기록', 'Comparison ≠ 자동 선택 — 시나리오 비교 후보입니다.')}
      {tab === 'summary' && simpleEventTab('executive_decision_summary_recorded', 'Executive Decision Summary 기록', 'Summary ≠ 결정 확정 — 경영진 판단 보조 자료입니다.')}
      {tab === 'scorecard' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {scnSelect}{reasonInput}
            {btn('Decision Scorecard 기록', () => scnEvent('executive_decision_scorecard_recorded', { fields: [...DECISION_SCORECARD_FIELDS], note: reason.trim() }, 'Scorecard 기록됨(≠ Decision)'), true)}
          </div>
          <AdminAlert tone="warning" description={`§8 필드 9종(${DECISION_SCORECARD_FIELDS.join(', ')}) — Scorecard ≠ Decision(high_negative/poor_tradeoff 우선 결정적 정렬 후보).`} />
          {eventList(evByType('executive_decision_scorecard_recorded'), 'Scorecard 없음', 'Executive Decision Scorecard 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'recommendations' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {scnSelect}
            <select value={recTypeSel} onChange={(e) => setRecTypeSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {SCENARIO_RECOMMENDATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Recommendation 기록(Evidence 필수)', () => scnEvent('scenario_recommendation_recorded', { recommendation_type: recTypeSel, evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Recommendation 기록됨(≠ Decision)'), true)}
          </div>
          <AdminAlert tone="info" description="Scenario Recommendation ≠ Decision — 권고 23종 whitelist, Evidence 없는 Recommendation 서버 차단. 채택은 사람이 결정합니다." />
          {eventList(evByType('scenario_recommendation_recorded'), 'Recommendation 없음', 'Scenario Recommendation 후보가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'reviewqueue' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {scnSelect}{reasonInput}
            {btn('Scenario Review 요청', () => {
              const r = needReason();
              if (!r || !selScenario) { if (!selScenario) toast.error('Scenario 선택 필수'); return; }
              void act(() => createEnterpriseDecisionScenarioReview({ decision_scenario_id: selScenario, review_type: 'scenario_review', review_summary: r }), 'Scenario Review 요청됨(≠ Approval)');
            }, true)}
            {btn('Executive Review 요청', () => {
              const r = needReason();
              if (!r || !selScenario) { if (!selScenario) toast.error('Scenario 선택 필수'); return; }
              void act(() => createEnterpriseDecisionScenarioReview({ decision_scenario_id: selScenario, review_type: 'executive_review', review_summary: r }), 'Executive Review 요청됨(≠ Approval)');
            })}
            {btn('Human Review 요청', () => {
              const r = needReason();
              if (!r || !selScenario) { if (!selScenario) toast.error('Scenario 선택 필수'); return; }
              void act(() => createEnterpriseDecisionScenarioReview({ decision_scenario_id: selScenario, review_type: 'human_review', review_summary: r }), 'Human Review 요청됨(채택·실행은 사람)');
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {reviewSelect}
            {btn('검토 시작', () => srReview('mark_in_review', {}, 'in_review'))}
            {btn('Review Reference 기록(Evidence 필수)', () => srReview('record_review_reference', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Review Reference 기록됨(≠ Approval)'), true)}
            {btn('수정 요청', () => srReview('request_revision', {}, 'revision_requested'))}
            {btn('Insufficient Data', () => srReview('mark_insufficient_data', {}, 'insufficient_data'))}
          </div>
          <AdminAlert tone="warning" description="Review Workflow(§9 — scenario/executive/human 3종 요청만) — Self-Review 서버 차단(작성자 ≠ 평가자) · Evidence 없는 Review Reference 차단 · 종결 재결정 차단 · Review ≠ Approval. Scenario 채택과 실행은 반드시 사람이 수행합니다." />
          {reviewList(reviews.filter((r) => ['requested', 'in_review', 'revision_requested'].includes(r.review_status)), '대기 Review 없음', '0건은 검토할 것이 없음을 의미하지 않습니다.')}
        </div>
      )}
      {tab === 'reviewed' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Review Reference — 사람이 기록한 검토 참조이며 승인/실행이 아닙니다." />
          {reviewList(reviews.filter((r) => r.review_status === 'review_reference_recorded'), 'Review Reference 없음', '사람이 검토를 완료한 기록이 여기에 표시됩니다.')}
          {eventList(evByType('scenario_review_reference_recorded'), 'Reference 이벤트 없음', 'Review Reference 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'humandecision' && simpleEventTab('human_decision_recorded', 'Human Decision 기록', '사람이 내린 결정의 기록 — 자동 실행이 아니며, 실행 여부와 방법도 사람이 결정합니다.')}
      {tab === 'learning' && simpleEventTab('scenario_learning_recorded', 'Scenario Learning 기록', 'Scenario Learning ≠ 자동 전략 실행 — 학습 반영 여부는 사람이 결정합니다.')}

      {tab === 'links' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {scnSelect}{reasonInput}
            {btn('Mission Link(0555 실존 검증)', () => scnEvent('mission_reference_linked', { note: reason.trim() }, 'Mission Link 기록됨(≠ Mission 변경)'), true)}
            {btn('Portfolio Link(0545)', () => scnEvent('portfolio_reference_linked', { note: reason.trim() }, 'Portfolio Link 기록됨'))}
            {btn('Environment Link(0556)', () => scnEvent('environment_reference_linked', { note: reason.trim() }, 'Environment Link 기록됨'))}
            {btn('Program Link(0547)', () => scnEvent('program_reference_linked', { note: reason.trim() }, 'Program Link 기록됨(≠ 실행 지시)'))}
            {btn('Value Link(0549)', () => scnEvent('value_reference_linked', { note: reason.trim() }, 'Value Link 기록됨'))}
          </div>
          <AdminAlert tone="info" description="Reference Link — ID 지정 시 실존 검증(0545/0547/0549/0555/0556). Link ≠ 변경/확정/실행." />
          {eventList([...evByType('mission_reference_linked'), ...evByType('portfolio_reference_linked'), ...evByType('environment_reference_linked'), ...evByType('program_reference_linked'), ...evByType('value_reference_linked')], 'Reference Link 없음', '참조 연결 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'flow' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Scenario 흐름 관측 — 단계별 기록 존재 여부만 표시합니다(자동 진행 아님)." />
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
          <AdminAlert tone="info" description={`Decision Scenario 이벤트 31종 통합 Audit — 총 ${NUM(num('scenario_events', 'total'))}건. 자동 실행 이벤트 생성 금지.`} />
          {eventList(audit, 'Audit 이벤트 없음', '모든 Scenario Intelligence 활동이 여기에 기록됩니다.')}
        </div>
      )}

      {tab === 'support' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description={`분류 6종(fully/partially/advisory_only/human_review_only/unavailable/insufficient_data) — 컴포넌트 ${ENTERPRISE_SCENARIO_COMPONENTS.length}종 · 매트릭스 ${ENTERPRISE_SCENARIO_SUPPORT_MATRIX.length}항목. unavailable 은 전부 automatic_*(자동 실행 없음).`} />
          <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
            {ENTERPRISE_SCENARIO_SUPPORT_MATRIX.map((e) => (
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
