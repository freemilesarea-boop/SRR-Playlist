/**
 * ValueOptimizationSection — Enterprise Value Optimization Intelligence,
 * Benefit Realization & ROI Governance Center (Phase AI-OPS-55).
 *
 * Enterprise Vision→Mission→Strategy→Execution→Resource Intelligence→
 * Business Outcome→Benefit Realization→ROI Analysis→Value Leakage Detection→
 * Optimization Opportunity→Executive Value Review→Value Learning→Audit.
 * ROI ≠ Business Success · Benefit ≠ Profit · Value ≠ Revenue ·
 * Correlation ≠ Causation · Optimization ≠ Automatic Improvement.
 * 자동 투자 승인/취소·Budget/Portfolio/KPI/Strategy 자동 변경 없음.
 * (기존 ValueIntelligenceSection(0549)과 별개 계층 — 원본 무변경)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, BookOpen, ClipboardList, GitBranch, Grid3x3, History, Inbox,
  Layers, Lightbulb, Lock, RefreshCw, Scale, Shield, TrendingUp, Users, Wallet,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchEnterpriseValueOptimizationSummary, fetchEnterpriseValueRealizations,
  createEnterpriseValueRealization, reviewEnterpriseValueRealization,
  createEnterpriseValueOptimizationReview, reviewEnterpriseValueOptimizationReview,
  fetchEnterpriseValueOptimizationReviews, recordEnterpriseValueOptimizationEvent,
  fetchEnterpriseValueOptimizationAudit,
  type EnterpriseValueOptimizationSummary, type EnterpriseValueRealizationRow,
  type EnterpriseValueOptimizationReviewRow, type EnterpriseValueOptimizationEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  VALUE_CATEGORIES, ROI_DIMENSIONS, ROI_RESULTS, BENEFIT_DIMENSIONS, BENEFIT_RESULTS,
  LEAKAGE_DIMENSIONS, LEAKAGE_RESULTS, COST_BENEFIT_RESULTS,
  INVESTMENT_EFFECTIVENESS_RESULTS, KPI_CONTRIBUTION_RESULTS, PORTFOLIO_VALUE_RESULTS,
  VALUE_RECOMMENDATION_TYPES, VALUE_SCORECARD_FIELDS, buildValueTimeline,
  ENTERPRISE_VALUE_OPTIMIZATION_SUPPORT_MATRIX,
} from '@/lib/enterpriseValueOptimization';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'realizations' | 'outcome' | 'roi' | 'benefit' | 'costbenefit'
  | 'leakage' | 'effectiveness' | 'kpi' | 'portfolio' | 'timeline' | 'optimization'
  | 'summary' | 'scorecard' | 'recommendations' | 'reviewqueue' | 'reviewed'
  | 'learning' | 'links' | 'flow' | 'audit' | 'support' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Value Overview', icon: Layers },
  { key: 'realizations', label: 'Value Realizations', icon: Wallet },
  { key: 'outcome', label: 'Business Outcome', icon: Activity },
  { key: 'roi', label: 'ROI Analysis', icon: TrendingUp },
  { key: 'benefit', label: 'Benefit Realization', icon: Scale },
  { key: 'costbenefit', label: 'Cost / Benefit', icon: Scale },
  { key: 'leakage', label: 'Value Leakage', icon: Shield },
  { key: 'effectiveness', label: 'Investment Effectiveness', icon: Activity },
  { key: 'kpi', label: 'KPI Contribution', icon: Grid3x3 },
  { key: 'portfolio', label: 'Portfolio Value', icon: Layers },
  { key: 'timeline', label: 'ROI Timeline', icon: History },
  { key: 'optimization', label: 'Optimization Opportunities', icon: Lightbulb },
  { key: 'summary', label: 'Executive Value Summaries', icon: ClipboardList },
  { key: 'scorecard', label: 'Executive Value Scorecard', icon: Grid3x3 },
  { key: 'recommendations', label: 'Recommendations', icon: Lightbulb },
  { key: 'reviewqueue', label: 'Review Queue', icon: Inbox },
  { key: 'reviewed', label: 'Review References', icon: Users },
  { key: 'learning', label: 'Value Learning', icon: BookOpen },
  { key: 'links', label: 'Reference Links', icon: GitBranch },
  { key: 'flow', label: 'Flow Timeline', icon: History },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
  { key: 'limitations', label: 'Known Limitations', icon: ClipboardList },
];

const KNOWN_LIMITATIONS = [
  '투자 자동 승인·자동 취소·Budget 자동 변경·Portfolio 자동 변경·KPI 자동 변경·Strategy 자동 변경·Project 자동 종료·Production 변경·Merge/Deploy/Rollback 없음 — 모든 반환 flag(investment_approved/budget_changed/portfolio_changed 등) 항상 false',
  'ROI ≠ Business Success · Benefit ≠ Profit · Value ≠ Revenue — 가치 관측 후보 분석이며 회계/재무 확정이 아닙니다',
  'Correlation ≠ Causation · Optimization ≠ Automatic Improvement — Evidence 없는 Optimization Opportunity/Recommendation 서버 차단',
  'Value Review Reference 는 Self-Review 차단(작성자 ≠ 평가자) + Evidence 필수 — Review ≠ Approval, 투자/전략 변경은 사람',
  'archived_reference/review_reference_recorded 재결정 차단 · 참조 실존 검증(0520/0545/0547/0548/0549/0555/0557/0558)',
  '이름 충돌 실측: 0549(AI-OPS-45)가 ai_enterprise_value_events·admin_enterprise_value_* 를 사용 중 → 본 계층은 ai_enterprise_value_realizations/ai_enterprise_value_optimization_*/admin_enterprise_value_realization_*/admin_enterprise_value_optimization_* 로 명명(별개 계층)',
  '회계 원장/ERP 재무 원장/빌링 시스템/CRM 매출/원가 회계 시스템/시장 벤치마크 피드 부재(실측) — insufficient_data 유지, 분석은 수동 기록 기반',
  'ROI Timeline/Benefit·Value·Leakage·Optimization History 는 JSONB 통합 — 시계열 원장 테이블 아님',
  'Migration 0472~0559 production 미적용 — 운영 수치는 적용 후 축적됩니다',
  '브라우저 실측 미검증 — UI 는 코드 리뷰/타입/빌드 기준 검증만 수행했습니다',
];

export default function ValueOptimizationSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<EnterpriseValueOptimizationSummary>({});
  const [realizations, setRealizations] = useState<EnterpriseValueRealizationRow[]>([]);
  const [reviews, setReviews] = useState<EnterpriseValueOptimizationReviewRow[]>([]);
  const [audit, setAudit] = useState<EnterpriseValueOptimizationEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [selRealization, setSelRealization] = useState('');
  const [selReview, setSelReview] = useState('');
  const [catSel, setCatSel] = useState<string>('financial');
  const [roiDimSel, setRoiDimSel] = useState<string>('financial_return');
  const [benefitDimSel, setBenefitDimSel] = useState<string>('planned_benefit');
  const [leakDimSel, setLeakDimSel] = useState<string>('budget_leakage');
  const [recTypeSel, setRecTypeSel] = useState<string>('gather_more_evidence_candidate');
  const [resultSel, setResultSel] = useState<string>('insufficient_data');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, r, v, a] = await Promise.all([
        fetchEnterpriseValueOptimizationSummary(), fetchEnterpriseValueRealizations(null, null, 200),
        fetchEnterpriseValueOptimizationReviews(null, 200), fetchEnterpriseValueOptimizationAudit(200),
      ]);
      setSummary(s); setRealizations(r); setReviews(v); setAudit(a);
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
  const realReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selRealization) { if (!selRealization) toast.error('Realization 선택 필수'); return; }
    void act(() => reviewEnterpriseValueRealization(selRealization, action, r, payload), ok);
  };
  const voReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selReview) { if (!selReview) toast.error('Value Review 선택 필수'); return; }
    void act(() => reviewEnterpriseValueOptimizationReview(selReview, action, r, payload), ok);
  };
  const valEvent = (kind: string, payload: Record<string, unknown>, ok: string, ids: { real?: boolean; review?: boolean } = { real: true }) => {
    const r = needReason();
    if (!r) return;
    void act(() => recordEnterpriseValueOptimizationEvent(kind, r, payload, ids.real ? (selRealization || null) : null, ids.review ? (selReview || null) : null), ok);
  };

  const obj = useCallback((k: string): Record<string, unknown> => (typeof summary[k] === 'object' && summary[k] !== null && !Array.isArray(summary[k]) ? summary[k] as Record<string, unknown> : {}), [summary]);
  const num = useCallback((k: string, sub: string): number | null => {
    const v = obj(k)[sub];
    return typeof v === 'number' ? v : null;
  }, [obj]);

  const flowTimeline = useMemo(() => {
    const present: Record<string, boolean> = {
      mission: (num('value_actuals', 'missions_0555') ?? 0) > 0,
      strategy: (num('value_actuals', 'strategy_portfolios_0545') ?? 0) > 0,
      execution: (num('value_actuals', 'execution_programs_0547') ?? 0) > 0,
      resource_intelligence: (num('value_actuals', 'capacity_resources_0558') ?? 0) > 0,
      business_outcome: (num('value_events', 'outcome_reviews') ?? 0) > 0,
      benefit_realization: (num('value_events', 'benefit_reviews') ?? 0) > 0,
      roi_analysis: (num('value_events', 'roi_assessments') ?? 0) + (num('value_events', 'roi_timelines') ?? 0) > 0,
      value_leakage_detection: (num('value_events', 'leakage_reviews') ?? 0) > 0,
      optimization_opportunity: (num('value_events', 'optimization_opportunities') ?? 0) > 0,
      executive_value_review: (num('value_events', 'value_review_requests') ?? 0) + (num('value_events', 'executive_review_requests') ?? 0) + (num('value_events', 'human_review_requests') ?? 0) + (num('value_events', 'review_references') ?? 0) > 0,
      value_learning: (num('value_events', 'learnings') ?? 0) > 0,
      audit: (num('value_events', 'total') ?? 0) > 0,
      // vision 은 본 summary 에 원천 피드가 없어 관측 여부를 표시하지 않습니다(정직 미관측).
    };
    const entries = Object.entries(present).filter(([, ok]) => ok).map(([stage]) => ({ stage }));
    return buildValueTimeline(entries).stages.map((s) => ({ stage: s.stage, present: s.entries.length > 0 }));
  }, [num]);

  if (loading) return <AdminCard title="Value Optimization Intelligence & ROI Governance Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Value Optimization Intelligence & ROI Governance Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const realSelect = (
    <select value={selRealization} onChange={(e) => setSelRealization(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Realization 선택</option>
      {realizations.map((r) => <option key={r.id} value={r.id}>{r.realization_code} · {r.realization_status}</option>)}
    </select>
  );
  const reviewSelect = (
    <select value={selReview} onChange={(e) => setSelReview(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Value Review 선택</option>
      {reviews.map((r) => <option key={r.id} value={r.id}>{r.review_code} · {r.review_status}</option>)}
    </select>
  );
  const reasonInput = <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button disabled={busy} onClick={onClick} className={primary ? 'rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50' : 'rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50'}>{label}</button>
  );
  const tone = (s: string) => (s.includes('exceptional') || s.includes('strong') || s.includes('fully_realized') || s.includes('negligible') || s.includes('favorable') || s.includes('highly_effective') || s.includes('effective_investment') || s.includes('high_value') || s.includes('primary_contributor') || s.includes('review_reference') || s === 'observed' ? 'success' as const : s.includes('critical') || s.includes('unrealized') || s.includes('weak_roi') || s.includes('ineffective') || s.includes('unfavorable') || s.includes('low_value') || s === 'unavailable' ? 'danger' as const : 'warning' as const);
  const evByType = (t: string) => audit.filter((e) => e.event_type === t);
  const eventList = (rows: EnterpriseValueOptimizationEventRow[], emptyTitle: string, emptyDesc: string) => (
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
  const realList = (list: EnterpriseValueRealizationRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((r) => (
          <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(r.realization_status)}>{r.realization_status}</AdminBadge>
            <AdminBadge tone={tone(r.roi_status)}>{r.roi_status}</AdminBadge>
            <AdminBadge tone={tone(r.leakage_status)}>{r.leakage_status}</AdminBadge>
            <span className="ml-2 font-bold">{r.realization_code}</span>
            <span className="ml-2 text-muted-foreground">{r.value_category} · {r.realization_name} · benefit {r.benefit_status} · opportunities {Array.isArray(r.optimization_opportunities) ? r.optimization_opportunities.length : 0}건</span>
          </div>
        ))}
      </div>
    )
  );
  const reviewList = (list: EnterpriseValueOptimizationReviewRow[], emptyTitle: string, emptyDesc: string) => (
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
        {realSelect}{reasonInput}
        {btn(`${title} 기록`, () => valEvent(kind, { note: reason.trim() }, `${title} 기록됨`), true)}
      </div>
      <AdminAlert tone="info" description={note} />
      {eventList(evByType(kind), `${title} 없음`, '기록이 여기에 표시됩니다.')}
    </div>
  );
  const resultEventTab = (kind: string, title: string, note: string, results: readonly string[], extraPayload: Record<string, unknown> = {}) => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        {realSelect}
        <select value={results.includes(resultSel) ? resultSel : results[0]} onChange={(e) => setResultSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
          {results.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {reasonInput}
        {btn(`${title} 기록`, () => valEvent(kind, { result: results.includes(resultSel) ? resultSel : results[0], ...extraPayload }, `${title} 기록됨`), true)}
      </div>
      <AdminAlert tone="info" description={note} />
      {eventList(evByType(kind), `${title} 없음`, '사람 검토 기록이 여기에 표시됩니다.')}
    </div>
  );

  return (
    <AdminCard
      title="Value Optimization Intelligence & ROI Governance Center"
      subtitle="Business Outcome→Benefit Realization→ROI Analysis→Value Leakage Detection→Optimization Opportunity→Executive Value Review→Learning — 투자와 최종 결정은 반드시 사람"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 Enterprise 가 수행한 전략과 프로젝트가 실제로 얼마만큼의 Business Value 를 창출했는지 분석하는 Value Optimization 계층입니다. AI 는 Business Outcome/Benefit Realization/ROI·Cost-Benefit 분석/Value Leakage Detection/Investment Effectiveness/KPI Contribution/Portfolio Value 분석/Optimization Opportunity 생성/Executive Summary·Scorecard/Recommendation/Review 요청/Learning 기록까지만 수행하며, 투자 자동 승인·자동 취소·Budget 자동 변경·Portfolio 자동 변경·KPI 자동 변경·Strategy 자동 변경·Project 자동 종료·Production 변경·Merge/Deploy/Rollback 은 수행하지 않습니다. ROI ≠ Business Success, Benefit ≠ Profit, Value ≠ Revenue, Correlation ≠ Causation, Optimization ≠ Automatic Improvement. AI 는 가치를 분석합니다. 사람이 투자하고 전략을 수정하며 최종 의사결정을 내립니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Value Realizations" value={NUM(num('realizations', 'total'))} />
            <Box label="Observed / Candidate / Reference / Archived" value={`${NUM(num('realizations', 'observed'))} / ${NUM(num('realizations', 'candidate'))} / ${NUM(num('realizations', 'review_reference'))} / ${NUM(num('realizations', 'archived'))}`} />
            <Box label="Exceptional / Strong / Weak ROI" value={`${NUM(num('realizations', 'exceptional_roi'))} / ${NUM(num('realizations', 'strong_roi'))} / ${NUM(num('realizations', 'weak_roi'))}`} />
            <Box label="Fully Realized / Unrealized Benefit" value={`${NUM(num('realizations', 'fully_realized'))} / ${NUM(num('realizations', 'unrealized'))}`} />
            <Box label="Critical·Elevated Leakage" value={NUM(num('realizations', 'critical_leakage'))} />
            <Box label="Value Reviews" value={NUM(num('reviews', 'total'))} />
            <Box label="Requested / In Review / Reference / Revision" value={`${NUM(num('reviews', 'requested'))} / ${NUM(num('reviews', 'in_review'))} / ${NUM(num('reviews', 'reference_recorded'))} / ${NUM(num('reviews', 'revision_requested'))}`} />
            <Box label="Outcome / ROI / Benefit Reviews" value={`${NUM(num('value_events', 'outcome_reviews'))} / ${NUM(num('value_events', 'roi_assessments'))} / ${NUM(num('value_events', 'benefit_reviews'))}`} />
            <Box label="Cost-Benefit / Leakage / Effectiveness" value={`${NUM(num('value_events', 'cost_benefit_reviews'))} / ${NUM(num('value_events', 'leakage_reviews'))} / ${NUM(num('value_events', 'effectiveness_reviews'))}`} />
            <Box label="KPI Contribution / Portfolio Value Reviews" value={`${NUM(num('value_events', 'kpi_contribution_reviews'))} / ${NUM(num('value_events', 'portfolio_value_reviews'))}`} />
            <Box label="ROI Timelines / Optimization Opportunities" value={`${NUM(num('value_events', 'roi_timelines'))} / ${NUM(num('value_events', 'optimization_opportunities'))}`} />
            <Box label="Summaries / Scorecards / Recommendations" value={`${NUM(num('value_events', 'summaries'))} / ${NUM(num('value_events', 'scorecards'))} / ${NUM(num('value_events', 'recommendations'))}`} />
            <Box label="Value / Executive / Human Review 요청" value={`${NUM(num('value_events', 'value_review_requests'))} / ${NUM(num('value_events', 'executive_review_requests'))} / ${NUM(num('value_events', 'human_review_requests'))}`} />
            <Box label="Review References" value={NUM(num('value_events', 'review_references'))} />
            <Box label="Learnings / Business Value Links(0549)" value={`${NUM(num('value_events', 'learnings'))} / ${NUM(num('value_events', 'business_value_links'))}`} />
            <Box label="KPI Links(0548) / Capacity Links(0558)" value={`${NUM(num('value_events', 'kpi_links'))} / ${NUM(num('value_events', 'capacity_links'))}`} />
          </div>
          <AdminAlert tone="info" description={`value_unavailable: ${Array.isArray(summary.value_unavailable) ? (summary.value_unavailable as unknown[]).map(String).join(', ') : '—'}. Value 원천 실측 — Business Values(0549) ${NUM(num('value_actuals', 'business_values_0549'))}건 · KPIs(0548) ${NUM(num('value_actuals', 'kpis_0548'))}건 · Portfolios(0545) ${NUM(num('value_actuals', 'strategy_portfolios_0545'))}건 · Programs(0547) ${NUM(num('value_actuals', 'execution_programs_0547'))}건 · Capacity Resources(0558) ${NUM(num('value_actuals', 'capacity_resources_0558'))}건 · Decision Outcomes(0514) ${NUM(num('value_actuals', 'decision_outcomes_0514'))}건. 0 과 Unknown 을 혼동하지 않습니다.`} />
        </div>
      )}

      {tab === 'realizations' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <select value={catSel} onChange={(e) => setCatSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {VALUE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {reasonInput}
            {btn('Value Realization 생성(≠ 회계 반영)', () => {
              const r = needReason();
              if (!r) return;
              void act(() => createEnterpriseValueRealization({ value_category: catSel, realization_name: r }), 'Value Realization 생성됨(자동 투자 승인 없음)');
            }, true)}
            {btn('Observed 표시', () => realReview('mark_observed', {}, 'observed(관측 상태)'))}
            {btn('Candidate 표시', () => realReview('mark_candidate', {}, 'candidate(≠ 승인)'))}
            {btn('Review Reference(Self 차단·Evidence 필수)', () => realReview('record_review_reference', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'review_reference(≠ Approval)'))}
            {btn('Archive', () => realReview('archive_reference', {}, 'archived_reference'))}
            {btn('Insufficient Data', () => realReview('mark_insufficient_data', {}, 'insufficient_data'))}
            {realSelect}
          </div>
          <AdminAlert tone="info" description="Category 11종 · 자동 투자 승인/취소/Budget·Portfolio·KPI·Strategy 변경/Project 종료 계열 category 서버 차단 · archived 재결정 차단." />
          {realList(realizations, 'Value Realization 없음', '핵심 질문 예: 어떤 프로젝트가 가장 높은 ROI 를 만들었는가? Value Leakage 는 어디에서 발생하는가? — 전부 Candidate 분석.')}
        </div>
      )}

      {tab === 'outcome' && resultEventTab('business_outcome_reviewed', 'Business Outcome 검토', 'Business Outcome ≠ 회계 확정 — Value ≠ Revenue, 결과 whitelist 는 §6 5종을 공유합니다.', BENEFIT_RESULTS)}
      {tab === 'roi' && (
        <>
          {resultEventTab('roi_assessment_reviewed', 'ROI Assessment 검토', 'ROI 5평가(§5 — Financial Return/Operational Gain/Strategic Value/Resource Efficiency/Sustainability) — ROI ≠ Business Success.', ROI_RESULTS, { roi_dimension: roiDimSel })}
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <span className="text-[11px] text-muted-foreground">ROI Dimension:</span>
            <select value={roiDimSel} onChange={(e) => setRoiDimSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {ROI_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </>
      )}
      {tab === 'benefit' && (
        <>
          {resultEventTab('benefit_realization_reviewed', 'Benefit Realization 검토', 'Benefit 5평가(§6 — Planned/Delivered/Gap/KPI Achievement/Business Outcome) — Benefit ≠ Profit.', BENEFIT_RESULTS, { benefit_dimension: benefitDimSel })}
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <span className="text-[11px] text-muted-foreground">Benefit Dimension:</span>
            <select value={benefitDimSel} onChange={(e) => setBenefitDimSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {BENEFIT_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </>
      )}
      {tab === 'costbenefit' && resultEventTab('cost_benefit_reviewed', 'Cost / Benefit 검토', 'Cost/Benefit ≠ 투자 결정 — 투입 대비 편익 관측 후보입니다.', COST_BENEFIT_RESULTS)}
      {tab === 'leakage' && (
        <>
          {resultEventTab('value_leakage_reviewed', 'Value Leakage 검토', 'Leakage 5평가(§7 — Budget/Resource/Time/Opportunity/Process) — Leakage 관측 ≠ 책임 판정.', LEAKAGE_RESULTS, { leakage_dimension: leakDimSel })}
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <span className="text-[11px] text-muted-foreground">Leakage Dimension:</span>
            <select value={leakDimSel} onChange={(e) => setLeakDimSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {LEAKAGE_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </>
      )}
      {tab === 'effectiveness' && resultEventTab('investment_effectiveness_reviewed', 'Investment Effectiveness 검토', 'Effectiveness ≠ 투자 승인 — 투자 대비 효과 관측 후보입니다.', INVESTMENT_EFFECTIVENESS_RESULTS)}
      {tab === 'kpi' && resultEventTab('kpi_contribution_reviewed', 'KPI Contribution 검토', 'Correlation ≠ Causation — KPI 기여 관측 후보이며 인과 확정이 아닙니다.', KPI_CONTRIBUTION_RESULTS)}
      {tab === 'portfolio' && resultEventTab('portfolio_value_reviewed', 'Portfolio Value 검토', 'Portfolio Value ≠ Portfolio 변경 — 포트폴리오 가치 관측 후보입니다.', PORTFOLIO_VALUE_RESULTS)}
      {tab === 'timeline' && simpleEventTab('roi_timeline_recorded', 'ROI Timeline 기록', 'ROI Timeline — value_history 로 통합 축적됩니다(≠ Forecast 확정).')}
      {tab === 'optimization' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {realSelect}{reasonInput}
            {btn('Optimization Opportunity 기록(Evidence 필수)', () => valEvent('optimization_opportunity_recorded', { note: reason.trim(), evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Optimization Opportunity 기록됨(≠ Automatic Improvement)'), true)}
          </div>
          <AdminAlert tone="warning" description="Optimization ≠ Automatic Improvement — Evidence 없는 후보 서버 차단, 적용은 사람이 결정합니다." />
          {eventList(evByType('optimization_opportunity_recorded'), 'Optimization Opportunity 없음', '최적화 후보가 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'summary' && simpleEventTab('executive_value_summary_recorded', 'Executive Value Summary 기록', 'Summary ≠ 투자 확정 — 경영진 판단 보조 자료입니다.')}
      {tab === 'scorecard' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {realSelect}{reasonInput}
            {btn('Value Scorecard 기록', () => valEvent('executive_value_scorecard_recorded', { fields: [...VALUE_SCORECARD_FIELDS], note: reason.trim() }, 'Scorecard 기록됨(≠ 투자 지시)'), true)}
          </div>
          <AdminAlert tone="warning" description={`§8 필드 8종(${VALUE_SCORECARD_FIELDS.join(', ')}) — Scorecard ≠ 투자 지시(critical leakage/unrealized benefit 우선 결정적 정렬 후보).`} />
          {eventList(evByType('executive_value_scorecard_recorded'), 'Scorecard 없음', 'Executive Value Scorecard 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'recommendations' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {realSelect}
            <select value={recTypeSel} onChange={(e) => setRecTypeSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {VALUE_RECOMMENDATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Recommendation 기록(Evidence 필수)', () => valEvent('value_recommendation_recorded', { recommendation_type: recTypeSel, evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Recommendation 기록됨(≠ Decision)'), true)}
          </div>
          <AdminAlert tone="info" description="Value Recommendation ≠ Decision — 권고 23종 whitelist, Evidence 없는 Recommendation 서버 차단. 채택은 사람이 결정합니다." />
          {eventList(evByType('value_recommendation_recorded'), 'Recommendation 없음', 'Value Recommendation 후보가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'reviewqueue' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {realSelect}{reasonInput}
            {btn('Value Review 요청', () => {
              const r = needReason();
              if (!r || !selRealization) { if (!selRealization) toast.error('Realization 선택 필수'); return; }
              void act(() => createEnterpriseValueOptimizationReview({ value_realization_id: selRealization, review_type: 'value_review', review_summary: r }), 'Value Review 요청됨(≠ Approval)');
            }, true)}
            {btn('Executive Review 요청', () => {
              const r = needReason();
              if (!r || !selRealization) { if (!selRealization) toast.error('Realization 선택 필수'); return; }
              void act(() => createEnterpriseValueOptimizationReview({ value_realization_id: selRealization, review_type: 'executive_review', review_summary: r }), 'Executive Review 요청됨(≠ Approval)');
            })}
            {btn('Human Review 요청', () => {
              const r = needReason();
              if (!r || !selRealization) { if (!selRealization) toast.error('Realization 선택 필수'); return; }
              void act(() => createEnterpriseValueOptimizationReview({ value_realization_id: selRealization, review_type: 'human_review', review_summary: r }), 'Human Review 요청됨(투자/전략 변경은 사람)');
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {reviewSelect}
            {btn('검토 시작', () => voReview('mark_in_review', {}, 'in_review'))}
            {btn('Review Reference 기록(Evidence 필수)', () => voReview('record_review_reference', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Review Reference 기록됨(≠ Approval)'), true)}
            {btn('수정 요청', () => voReview('request_revision', {}, 'revision_requested'))}
            {btn('Insufficient Data', () => voReview('mark_insufficient_data', {}, 'insufficient_data'))}
          </div>
          <AdminAlert tone="warning" description="Review Workflow(§9 — value/executive/human 3종 요청만) — Self-Review 서버 차단(작성자 ≠ 평가자) · Evidence 없는 Review Reference 차단 · 종결 재결정 차단 · Review ≠ Approval. 투자 승인과 전략 변경은 반드시 사람이 수행합니다." />
          {reviewList(reviews.filter((r) => ['requested', 'in_review', 'revision_requested'].includes(r.review_status)), '대기 Review 없음', '0건은 검토할 것이 없음을 의미하지 않습니다.')}
        </div>
      )}
      {tab === 'reviewed' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Review Reference — 사람이 기록한 검토 참조이며 승인/투자 결정이 아닙니다." />
          {reviewList(reviews.filter((r) => r.review_status === 'review_reference_recorded'), 'Review Reference 없음', '사람이 검토를 완료한 기록이 여기에 표시됩니다.')}
          {eventList(evByType('value_review_reference_recorded'), 'Reference 이벤트 없음', 'Review Reference 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'learning' && simpleEventTab('value_learning_recorded', 'Value Learning 기록', 'Value Learning ≠ 자동 투자 변경 — 학습 반영 여부는 사람이 결정합니다.')}

      {tab === 'links' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {realSelect}{reasonInput}
            {btn('Business Value Link(0549 실존 검증)', () => valEvent('business_value_reference_linked', { note: reason.trim() }, 'Business Value Link 기록됨(0549 참조만)'), true)}
            {btn('Portfolio Link(0545)', () => valEvent('portfolio_reference_linked', { note: reason.trim() }, 'Portfolio Link 기록됨'))}
            {btn('Program Link(0547)', () => valEvent('program_reference_linked', { note: reason.trim() }, 'Program Link 기록됨'))}
            {btn('Scenario Link(0557)', () => valEvent('scenario_reference_linked', { note: reason.trim() }, 'Scenario Link 기록됨'))}
            {btn('Mission Link(0555)', () => valEvent('mission_reference_linked', { note: reason.trim() }, 'Mission Link 기록됨'))}
            {btn('KPI Link(0548)', () => valEvent('kpi_reference_linked', { note: reason.trim() }, 'KPI Link 기록됨(0548 참조만)'))}
            {btn('Capacity Link(0558)', () => valEvent('capacity_reference_linked', { note: reason.trim() }, 'Capacity Link 기록됨(0558 참조만)'))}
            {btn('Commitment Link(0520)', () => valEvent('commitment_reference_linked', { note: reason.trim() }, 'Commitment Link 기록됨'))}
          </div>
          <AdminAlert tone="info" description="Reference Link — ID 지정 시 실존 검증(0520/0545/0547/0548/0549/0555/0557/0558). Link ≠ 변경/확정/투자." />
          {eventList([...evByType('business_value_reference_linked'), ...evByType('portfolio_reference_linked'), ...evByType('program_reference_linked'), ...evByType('scenario_reference_linked'), ...evByType('mission_reference_linked'), ...evByType('kpi_reference_linked'), ...evByType('capacity_reference_linked'), ...evByType('commitment_reference_linked')], 'Reference Link 없음', '참조 연결 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'flow' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Value 흐름 관측(13단계) — 단계별 기록 존재 여부만 표시합니다(자동 진행 아님). vision 단계는 본 summary 에 원천 피드가 없어 항상 미관측으로 표시됩니다(정직 고지)." />
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
          <AdminAlert tone="info" description={`Value Optimization 이벤트 31종 통합 Audit — 총 ${NUM(num('value_events', 'total'))}건. 자동 투자 승인 이벤트 생성 금지.`} />
          {eventList(audit, 'Audit 이벤트 없음', '모든 Value Optimization 활동이 여기에 기록됩니다.')}
        </div>
      )}

      {tab === 'support' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description={`분류 6종(fully/partially/advisory_only/human_review_only/unavailable/insufficient_data) — 매트릭스 ${ENTERPRISE_VALUE_OPTIMIZATION_SUPPORT_MATRIX.length}항목. unavailable 은 전부 automatic_*(자동 투자 승인 없음).`} />
          <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
            {ENTERPRISE_VALUE_OPTIMIZATION_SUPPORT_MATRIX.map((e) => (
              <div key={e.feature} className="flex items-center justify-between rounded-lg border border-border p-2 text-[11px]">
                <span>{e.feature}</span>
                <AdminBadge tone={e.level === 'unavailable' ? 'danger' : e.level === 'fully_supported' ? 'success' : 'warning'}>{e.level}</AdminBadge>
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
