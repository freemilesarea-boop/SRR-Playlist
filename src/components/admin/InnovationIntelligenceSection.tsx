/**
 * InnovationIntelligenceSection — Enterprise Innovation Intelligence,
 * Innovation Portfolio & Future Opportunity Center (Phase AI-OPS-58).
 *
 * Enterprise Vision→Mission→Strategy→Execution→Continuous Improvement→
 * Innovation Opportunity Detection→Innovation Portfolio→Innovation
 * Readiness→Future Opportunity Analysis→Innovation Prioritization→
 * Executive Innovation Review→Innovation Learning→Audit.
 * Opportunity ≠ Guaranteed Success · Innovation ≠ Business Success ·
 * Potential ≠ Outcome · Priority ≠ Mandatory Order.
 * 자동 사업 시작/제품 출시/투자 승인/Budget·조직·전략 변경/계약 체결 없음.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, BookOpen, ClipboardList, GitBranch, Grid3x3, History, Inbox,
  Layers, Lightbulb, Lock, RefreshCw, Rocket, Scale, Shield, TrendingUp, Users,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchEnterpriseInnovationSummary, fetchEnterpriseInnovations,
  createEnterpriseInnovation, reviewEnterpriseInnovation,
  createEnterpriseInnovationReview, reviewEnterpriseInnovationReview,
  fetchEnterpriseInnovationReviews, recordEnterpriseInnovationEvent,
  fetchEnterpriseInnovationAudit,
  type EnterpriseInnovationSummary, type EnterpriseInnovationRow,
  type EnterpriseInnovationReviewRow, type EnterpriseInnovationEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  INNOVATION_CATEGORIES, OPPORTUNITY_DIMENSIONS, OPPORTUNITY_RESULTS,
  INNOVATION_RISK_DIMENSIONS, INNOVATION_RISK_RESULTS,
  INNOVATION_PORTFOLIO_DIMENSIONS, INNOVATION_PORTFOLIO_RESULTS,
  INNOVATION_READINESS_RESULTS, FUTURE_OPPORTUNITY_RESULTS,
  TECHNOLOGY_OPPORTUNITY_RESULTS, MARKET_POTENTIAL_RESULTS,
  INNOVATION_ALIGNMENT_RESULTS, INNOVATION_PRIORITY_RESULTS,
  INNOVATION_RECOMMENDATION_TYPES, INNOVATION_SCORECARD_FIELDS,
  buildInnovationTimeline, ENTERPRISE_INNOVATION_SUPPORT_MATRIX,
} from '@/lib/enterpriseInnovation';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'innovations' | 'opportunity' | 'risk' | 'portfolio' | 'readiness'
  | 'future' | 'technology' | 'market' | 'alignment' | 'priority' | 'timeline'
  | 'summary' | 'scorecard' | 'recommendations' | 'reviewqueue' | 'reviewed'
  | 'learning' | 'links' | 'flow' | 'audit' | 'support' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Innovation Overview', icon: Layers },
  { key: 'innovations', label: 'Innovation Opportunities', icon: Rocket },
  { key: 'opportunity', label: 'Opportunity Assessment', icon: Scale },
  { key: 'risk', label: 'Innovation Risk', icon: Shield },
  { key: 'portfolio', label: 'Innovation Portfolio', icon: Layers },
  { key: 'readiness', label: 'Innovation Readiness', icon: Activity },
  { key: 'future', label: 'Future Opportunities', icon: TrendingUp },
  { key: 'technology', label: 'Technology Opportunities', icon: Lightbulb },
  { key: 'market', label: 'Market Potential', icon: TrendingUp },
  { key: 'alignment', label: 'Mission Alignment', icon: Scale },
  { key: 'priority', label: 'Innovation Priority', icon: Scale },
  { key: 'timeline', label: 'Innovation Timeline', icon: History },
  { key: 'summary', label: 'Executive Innovation Summaries', icon: ClipboardList },
  { key: 'scorecard', label: 'Executive Innovation Scorecard', icon: Grid3x3 },
  { key: 'recommendations', label: 'Recommendations', icon: Lightbulb },
  { key: 'reviewqueue', label: 'Review Queue', icon: Inbox },
  { key: 'reviewed', label: 'Review References', icon: Users },
  { key: 'learning', label: 'Innovation Learning', icon: BookOpen },
  { key: 'links', label: 'Reference Links', icon: GitBranch },
  { key: 'flow', label: 'Flow Timeline', icon: History },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
  { key: 'limitations', label: 'Known Limitations', icon: ClipboardList },
];

const KNOWN_LIMITATIONS = [
  '신규 사업 자동 시작·제품 자동 출시·투자 자동 승인·Budget 자동 변경·조직 자동 변경·Strategy 자동 변경·계약 자동 체결·Production 변경·Merge/Deploy/Rollback 없음 — 모든 반환 flag(business_launched/product_launched/investment_approved 등) 항상 false',
  'Opportunity ≠ Guaranteed Success · Innovation ≠ Business Success · Potential ≠ Outcome — 혁신 기회 관측 후보 분석이며 성공 보장이 아닙니다',
  'Forecast ≠ Future Fact · Correlation ≠ Causation · Priority ≠ Mandatory Order — Evidence 없는 Future Opportunity/Recommendation 서버 차단',
  'Innovation Review Reference 는 Self-Review 차단(작성자 ≠ 평가자) + Evidence 필수 — Review ≠ Approval, Innovation 실행은 사람',
  'archived_reference/review_reference_recorded 재결정 차단 · 참조 실존 검증(0547/0555/0556/0557/0558/0559/0560/0561)',
  '이름 실측: ai_enterprise_innovations/admin_enterprise_innovation_* 미사용 확인 — 스펙 권장명 그대로 사용(충돌 없음)',
  '시장 조사/특허 DB/스타트업 생태계/기술 레이더/고객 인사이트/R&D 랩 피드 부재(실측) — insufficient_data 유지, 분석은 수동 기록 기반',
  'Innovation Timeline/Opportunity·Portfolio·Risk·Learning History 는 JSONB 통합 — 시계열 원장 테이블 아님',
  'Migration 0472~0562 production 미적용 — 운영 수치는 적용 후 축적됩니다',
  '브라우저 실측 미검증 — UI 는 코드 리뷰/타입/빌드 기준 검증만 수행했습니다',
];

export default function InnovationIntelligenceSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<EnterpriseInnovationSummary>({});
  const [innovations, setInnovations] = useState<EnterpriseInnovationRow[]>([]);
  const [reviews, setReviews] = useState<EnterpriseInnovationReviewRow[]>([]);
  const [audit, setAudit] = useState<EnterpriseInnovationEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [selInnovation, setSelInnovation] = useState('');
  const [selReview, setSelReview] = useState('');
  const [catSel, setCatSel] = useState<string>('technology');
  const [oppDimSel, setOppDimSel] = useState<string>('strategic_value');
  const [riskDimSel, setRiskDimSel] = useState<string>('technology_risk');
  const [pfDimSel, setPfDimSel] = useState<string>('portfolio_balance');
  const [recTypeSel, setRecTypeSel] = useState<string>('gather_more_evidence_candidate');
  const [resultSel, setResultSel] = useState<string>('insufficient_data');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, i, v, a] = await Promise.all([
        fetchEnterpriseInnovationSummary(), fetchEnterpriseInnovations(null, null, 200),
        fetchEnterpriseInnovationReviews(null, 200), fetchEnterpriseInnovationAudit(200),
      ]);
      setSummary(s); setInnovations(i); setReviews(v); setAudit(a);
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
  const innReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selInnovation) { if (!selInnovation) toast.error('Innovation 선택 필수'); return; }
    void act(() => reviewEnterpriseInnovation(selInnovation, action, r, payload), ok);
  };
  const ivReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selReview) { if (!selReview) toast.error('Innovation Review 선택 필수'); return; }
    void act(() => reviewEnterpriseInnovationReview(selReview, action, r, payload), ok);
  };
  const innEvent = (kind: string, payload: Record<string, unknown>, ok: string, ids: { inn?: boolean; review?: boolean } = { inn: true }) => {
    const r = needReason();
    if (!r) return;
    void act(() => recordEnterpriseInnovationEvent(kind, r, payload, ids.inn ? (selInnovation || null) : null, ids.review ? (selReview || null) : null), ok);
  };

  const obj = useCallback((k: string): Record<string, unknown> => (typeof summary[k] === 'object' && summary[k] !== null && !Array.isArray(summary[k]) ? summary[k] as Record<string, unknown> : {}), [summary]);
  const num = useCallback((k: string, sub: string): number | null => {
    const v = obj(k)[sub];
    return typeof v === 'number' ? v : null;
  }, [obj]);

  const flowTimeline = useMemo(() => {
    const present: Record<string, boolean> = {
      mission: (num('innovation_actuals', 'missions_0555') ?? 0) > 0,
      strategy: (num('innovation_actuals', 'decision_scenarios_0557') ?? 0) > 0,
      execution: (num('innovation_actuals', 'execution_programs_0547') ?? 0) > 0,
      continuous_improvement: (num('innovation_actuals', 'improvements_0561') ?? 0) > 0,
      innovation_opportunity_detection: (num('innovations', 'total') ?? 0) + (num('innovation_events', 'opportunity_reviews') ?? 0) > 0,
      innovation_portfolio: (num('innovation_events', 'portfolio_reviews') ?? 0) > 0,
      innovation_readiness: (num('innovation_events', 'readiness_reviews') ?? 0) > 0,
      future_opportunity_analysis: (num('innovation_events', 'future_reviews') ?? 0) + (num('innovation_events', 'technology_reviews') ?? 0) + (num('innovation_events', 'market_reviews') ?? 0) > 0,
      innovation_prioritization: (num('innovation_events', 'priority_reviews') ?? 0) > 0,
      executive_innovation_review: (num('innovation_events', 'innovation_review_requests') ?? 0) + (num('innovation_events', 'executive_review_requests') ?? 0) + (num('innovation_events', 'human_review_requests') ?? 0) + (num('innovation_events', 'review_references') ?? 0) > 0,
      innovation_learning: (num('innovation_events', 'learnings') ?? 0) > 0,
      audit: (num('innovation_events', 'total') ?? 0) > 0,
      // vision 은 본 summary 에 원천 피드가 없어 관측 여부를 표시하지 않습니다(정직 미관측).
    };
    const entries = Object.entries(present).filter(([, ok]) => ok).map(([stage]) => ({ stage }));
    return buildInnovationTimeline(entries).stages.map((s) => ({ stage: s.stage, present: s.entries.length > 0 }));
  }, [num]);

  if (loading) return <AdminCard title="Innovation Intelligence & Future Opportunity Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Innovation Intelligence & Future Opportunity Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const innSelect = (
    <select value={selInnovation} onChange={(e) => setSelInnovation(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Innovation 선택</option>
      {innovations.map((i) => <option key={i.id} value={i.id}>{i.innovation_code} · {i.innovation_status}</option>)}
    </select>
  );
  const reviewSelect = (
    <select value={selReview} onChange={(e) => setSelReview(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Innovation Review 선택</option>
      {reviews.map((r) => <option key={r.id} value={r.id}>{r.review_code} · {r.review_status}</option>)}
    </select>
  );
  const reasonInput = <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button disabled={busy} onClick={onClick} className={primary ? 'rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50' : 'rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50'}>{label}</button>
  );
  const tone = (s: string) => (s.includes('exceptional') || s.includes('strong') || s.includes('low_risk') || s.includes('highly_balanced') || s.includes('balanced_candidate') || s.includes('highly_ready') || s.includes('high_potential') || s.includes('strategic_technology') || s.includes('large_market') || s.includes('strongly_aligned') || s.includes('review_reference') || s === 'discovered' ? 'success' as const : s.includes('critical') || s.includes('weak_candidate') || s.includes('imbalanced') || s.includes('not_ready') || s.includes('misaligned') || s.includes('saturated') || s === 'unavailable' ? 'danger' as const : 'warning' as const);
  const evByType = (t: string) => audit.filter((e) => e.event_type === t);
  const eventList = (rows: EnterpriseInnovationEventRow[], emptyTitle: string, emptyDesc: string) => (
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
  const innList = (list: EnterpriseInnovationRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((i) => (
          <div key={i.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(i.innovation_status)}>{i.innovation_status}</AdminBadge>
            <AdminBadge tone={tone(i.opportunity_status)}>{i.opportunity_status}</AdminBadge>
            <AdminBadge tone={tone(i.risk_status)}>{i.risk_status}</AdminBadge>
            <span className="ml-2 font-bold">{i.innovation_code}</span>
            <span className="ml-2 text-muted-foreground">{i.innovation_category} · {i.innovation_name} · portfolio {i.portfolio_status} · reviews {Array.isArray(i.innovation_reviews) ? i.innovation_reviews.length : 0}건</span>
          </div>
        ))}
      </div>
    )
  );
  const reviewList = (list: EnterpriseInnovationReviewRow[], emptyTitle: string, emptyDesc: string) => (
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
        {innSelect}{reasonInput}
        {btn(`${title} 기록`, () => innEvent(kind, { note: reason.trim() }, `${title} 기록됨`), true)}
      </div>
      <AdminAlert tone="info" description={note} />
      {eventList(evByType(kind), `${title} 없음`, '기록이 여기에 표시됩니다.')}
    </div>
  );
  const resultEventTab = (kind: string, title: string, note: string, results: readonly string[], extraPayload: Record<string, unknown> = {}) => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        {innSelect}
        <select value={results.includes(resultSel) ? resultSel : results[0]} onChange={(e) => setResultSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
          {results.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {reasonInput}
        {btn(`${title} 기록`, () => innEvent(kind, { result: results.includes(resultSel) ? resultSel : results[0], ...extraPayload }, `${title} 기록됨`), true)}
      </div>
      <AdminAlert tone="info" description={note} />
      {eventList(evByType(kind), `${title} 없음`, '사람 검토 기록이 여기에 표시됩니다.')}
    </div>
  );

  return (
    <AdminCard
      title="Innovation Intelligence & Future Opportunity Center"
      subtitle="Innovation Opportunity Detection→Innovation Portfolio→Readiness→Future Opportunity Analysis→Prioritization→Executive Review→Learning — 투자·사업 시작과 최종 결정은 반드시 사람"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 Enterprise 가 현재 운영만 최적화하는 것을 넘어 새로운 성장 기회를 지속적으로 발견하도록 지원하는 Innovation Intelligence 계층입니다. AI 는 Innovation Opportunity Detection/Portfolio·Readiness·Risk 분석/Future·Technology·Market Opportunity 분석/Mission Alignment/Prioritization/Executive Summary·Scorecard/Recommendation/Review 요청/Learning 기록까지만 수행하며, 신규 사업 자동 시작·제품 자동 출시·투자 자동 승인·Budget 자동 변경·조직 자동 변경·Strategy 자동 변경·계약 자동 체결·Production 변경·Merge/Deploy/Rollback 은 수행하지 않습니다. Opportunity ≠ Guaranteed Success, Innovation ≠ Business Success, Potential ≠ Outcome, Priority ≠ Mandatory Order. AI 는 혁신 가능성을 분석합니다. 사람이 투자하고 사업을 시작하며 최종 의사결정을 내립니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Innovations" value={NUM(num('innovations', 'total'))} />
            <Box label="Discovered / Candidate / Reference / Archived" value={`${NUM(num('innovations', 'discovered'))} / ${NUM(num('innovations', 'candidate'))} / ${NUM(num('innovations', 'review_reference'))} / ${NUM(num('innovations', 'archived'))}`} />
            <Box label="Exceptional / Strong / Weak Opportunity" value={`${NUM(num('innovations', 'exceptional'))} / ${NUM(num('innovations', 'strong'))} / ${NUM(num('innovations', 'weak'))}`} />
            <Box label="Critical·Elevated / Low·Manageable Risk" value={`${NUM(num('innovations', 'critical_risk'))} / ${NUM(num('innovations', 'low_risk'))}`} />
            <Box label="Balanced / Imbalanced Portfolio" value={`${NUM(num('innovations', 'balanced'))} / ${NUM(num('innovations', 'imbalanced'))}`} />
            <Box label="Innovation Reviews" value={NUM(num('reviews', 'total'))} />
            <Box label="Requested / In Review / Reference / Revision" value={`${NUM(num('reviews', 'requested'))} / ${NUM(num('reviews', 'in_review'))} / ${NUM(num('reviews', 'reference_recorded'))} / ${NUM(num('reviews', 'revision_requested'))}`} />
            <Box label="Opportunity / Risk / Portfolio Reviews" value={`${NUM(num('innovation_events', 'opportunity_reviews'))} / ${NUM(num('innovation_events', 'risk_reviews'))} / ${NUM(num('innovation_events', 'portfolio_reviews'))}`} />
            <Box label="Readiness / Future / Technology Reviews" value={`${NUM(num('innovation_events', 'readiness_reviews'))} / ${NUM(num('innovation_events', 'future_reviews'))} / ${NUM(num('innovation_events', 'technology_reviews'))}`} />
            <Box label="Market / Alignment / Priority" value={`${NUM(num('innovation_events', 'market_reviews'))} / ${NUM(num('innovation_events', 'alignment_reviews'))} / ${NUM(num('innovation_events', 'priority_reviews'))}`} />
            <Box label="Timelines / Summaries / Scorecards" value={`${NUM(num('innovation_events', 'timelines'))} / ${NUM(num('innovation_events', 'summaries'))} / ${NUM(num('innovation_events', 'scorecards'))}`} />
            <Box label="Recommendations" value={NUM(num('innovation_events', 'recommendations'))} />
            <Box label="Innovation / Executive / Human Review 요청" value={`${NUM(num('innovation_events', 'innovation_review_requests'))} / ${NUM(num('innovation_events', 'executive_review_requests'))} / ${NUM(num('innovation_events', 'human_review_requests'))}`} />
            <Box label="Review References" value={NUM(num('innovation_events', 'review_references'))} />
            <Box label="Learnings / Improvement Links(0561)" value={`${NUM(num('innovation_events', 'learnings'))} / ${NUM(num('innovation_events', 'improvement_links'))}`} />
            <Box label="Transformation Links(0560) / Scenario Links(0557)" value={`${NUM(num('innovation_events', 'transformation_links'))} / ${NUM(num('innovation_events', 'scenario_links'))}`} />
          </div>
          <AdminAlert tone="info" description={`innovation_unavailable: ${Array.isArray(summary.innovation_unavailable) ? (summary.innovation_unavailable as unknown[]).map(String).join(', ') : '—'}. Innovation 원천 실측 — Improvements(0561) ${NUM(num('innovation_actuals', 'improvements_0561'))}건 · Transformations(0560) ${NUM(num('innovation_actuals', 'transformations_0560'))}건 · Value Realizations(0559) ${NUM(num('innovation_actuals', 'value_realizations_0559'))}건 · Capacity Resources(0558) ${NUM(num('innovation_actuals', 'capacity_resources_0558'))}건 · Environment Observations(0556) ${NUM(num('innovation_actuals', 'environment_observations_0556'))}건 · Missions(0555) ${NUM(num('innovation_actuals', 'missions_0555'))}건. 0 과 Unknown 을 혼동하지 않습니다.`} />
        </div>
      )}

      {tab === 'innovations' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <select value={catSel} onChange={(e) => setCatSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {INNOVATION_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {reasonInput}
            {btn('Innovation 기회 기록(≠ 사업 시작)', () => {
              const r = needReason();
              if (!r) return;
              void act(() => createEnterpriseInnovation({ innovation_category: catSel, innovation_name: r }), 'Innovation 기회 기록됨(자동 사업 시작 없음)');
            }, true)}
            {btn('Discovered 표시', () => innReview('mark_discovered', {}, 'discovered(발견 상태)'))}
            {btn('Candidate 표시', () => innReview('mark_candidate', {}, 'candidate(≠ 승인)'))}
            {btn('Review Reference(Self 차단·Evidence 필수)', () => innReview('record_review_reference', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'review_reference(≠ Approval)'))}
            {btn('Archive', () => innReview('archive_reference', {}, 'archived_reference'))}
            {btn('Insufficient Data', () => innReview('mark_insufficient_data', {}, 'insufficient_data'))}
            {innSelect}
          </div>
          <AdminAlert tone="info" description="Category 11종 · 자동 사업 시작/제품 출시/투자 승인/Budget·조직·전략 변경/계약 체결 계열 category 서버 차단 · archived 재결정 차단." />
          {innList(innovations, 'Innovation 없음', '핵심 질문 예: 어떤 Innovation Opportunity 가 존재하는가? 어떤 신규 사업이 가장 높은 잠재력을 가지는가? — 전부 Candidate 분석.')}
        </div>
      )}

      {tab === 'opportunity' && (
        <>
          {resultEventTab('innovation_opportunity_reviewed', 'Opportunity Assessment 검토', 'Opportunity 5평가(§5 — Strategic Value/Market Potential/Technical Feasibility/Resource Availability/Innovation Readiness) — Opportunity ≠ Guaranteed Success.', OPPORTUNITY_RESULTS, { opportunity_dimension: oppDimSel })}
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <span className="text-[11px] text-muted-foreground">Opportunity Dimension:</span>
            <select value={oppDimSel} onChange={(e) => setOppDimSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {OPPORTUNITY_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </>
      )}
      {tab === 'risk' && (
        <>
          {resultEventTab('innovation_risk_reviewed', 'Innovation Risk 검토', 'Risk 5평가(§6 — Technology/Market/Resource/Execution/Governance) — Risk 관측 ≠ 실패 확정.', INNOVATION_RISK_RESULTS, { risk_dimension: riskDimSel })}
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <span className="text-[11px] text-muted-foreground">Risk Dimension:</span>
            <select value={riskDimSel} onChange={(e) => setRiskDimSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {INNOVATION_RISK_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </>
      )}
      {tab === 'portfolio' && (
        <>
          {resultEventTab('innovation_portfolio_reviewed', 'Innovation Portfolio 검토', 'Portfolio 5평가(§7 — Balance/Strategic Alignment/Investment Diversity/Innovation Coverage/Long-term Sustainability) — Portfolio 관측 ≠ Portfolio 변경.', INNOVATION_PORTFOLIO_RESULTS, { portfolio_dimension: pfDimSel })}
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <span className="text-[11px] text-muted-foreground">Portfolio Dimension:</span>
            <select value={pfDimSel} onChange={(e) => setPfDimSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {INNOVATION_PORTFOLIO_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </>
      )}
      {tab === 'readiness' && resultEventTab('innovation_readiness_reviewed', 'Innovation Readiness 검토', 'Readiness ≠ Success — 혁신 준비도 관측 후보입니다.', INNOVATION_READINESS_RESULTS)}
      {tab === 'future' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {innSelect}
            <select value={(FUTURE_OPPORTUNITY_RESULTS as readonly string[]).includes(resultSel) ? resultSel : FUTURE_OPPORTUNITY_RESULTS[0]} onChange={(e) => setResultSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {FUTURE_OPPORTUNITY_RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {reasonInput}
            {btn('Future Opportunity 기록(Evidence 필수)', () => innEvent('future_opportunity_reviewed', { result: (FUTURE_OPPORTUNITY_RESULTS as readonly string[]).includes(resultSel) ? resultSel : FUTURE_OPPORTUNITY_RESULTS[0], evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Future Opportunity 기록됨(Potential ≠ Outcome)'), true)}
          </div>
          <AdminAlert tone="warning" description="Potential ≠ Outcome — Evidence 없는 미래 기회 기록 서버 차단, Forecast ≠ Future Fact." />
          {eventList(evByType('future_opportunity_reviewed'), 'Future Opportunity 없음', '미래 기회 후보가 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'technology' && resultEventTab('technology_opportunity_reviewed', 'Technology Opportunity 검토', 'Technology 관측 후보 ≠ 도입 결정 — 기술 기회 관측입니다.', TECHNOLOGY_OPPORTUNITY_RESULTS)}
      {tab === 'market' && resultEventTab('market_potential_reviewed', 'Market Potential 검토', 'Market Potential ≠ 시장 확정 — 시장 잠재력 관측 후보입니다.', MARKET_POTENTIAL_RESULTS)}
      {tab === 'alignment' && resultEventTab('mission_alignment_reviewed', 'Mission Alignment 검토', 'Alignment 관측 ≠ Mission 변경 — Mission 정렬 관측 후보입니다.', INNOVATION_ALIGNMENT_RESULTS)}
      {tab === 'priority' && resultEventTab('innovation_priority_reviewed', 'Innovation Priority 검토', 'Priority ≠ Mandatory Order — 우선순위 후보이며 강제 순서가 아닙니다.', INNOVATION_PRIORITY_RESULTS)}
      {tab === 'timeline' && simpleEventTab('innovation_timeline_recorded', 'Innovation Timeline 기록', 'Innovation Timeline — innovation_history 로 통합 축적됩니다(≠ Forecast 확정).')}
      {tab === 'summary' && simpleEventTab('executive_innovation_summary_recorded', 'Executive Innovation Summary 기록', 'Summary ≠ 사업 시작 확정 — 경영진 판단 보조 자료입니다.')}
      {tab === 'scorecard' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {innSelect}{reasonInput}
            {btn('Innovation Scorecard 기록', () => innEvent('executive_innovation_scorecard_recorded', { fields: [...INNOVATION_SCORECARD_FIELDS], note: reason.trim() }, 'Scorecard 기록됨(≠ 투자 지시)'), true)}
          </div>
          <AdminAlert tone="warning" description={`§8 필드 8종(${INNOVATION_SCORECARD_FIELDS.join(', ')}) — Scorecard ≠ 투자 지시(critical risk/imbalanced portfolio 우선 결정적 정렬 후보).`} />
          {eventList(evByType('executive_innovation_scorecard_recorded'), 'Scorecard 없음', 'Executive Innovation Scorecard 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'recommendations' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {innSelect}
            <select value={recTypeSel} onChange={(e) => setRecTypeSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {INNOVATION_RECOMMENDATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Recommendation 기록(Evidence 필수)', () => innEvent('innovation_recommendation_recorded', { recommendation_type: recTypeSel, evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Recommendation 기록됨(≠ Decision)'), true)}
          </div>
          <AdminAlert tone="info" description="Innovation Recommendation ≠ Decision — 권고 23종 whitelist, Evidence 없는 Recommendation 서버 차단. 채택은 사람이 결정합니다." />
          {eventList(evByType('innovation_recommendation_recorded'), 'Recommendation 없음', 'Innovation Recommendation 후보가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'reviewqueue' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {innSelect}{reasonInput}
            {btn('Innovation Review 요청', () => {
              const r = needReason();
              if (!r || !selInnovation) { if (!selInnovation) toast.error('Innovation 선택 필수'); return; }
              void act(() => createEnterpriseInnovationReview({ innovation_id: selInnovation, review_type: 'innovation_review', review_summary: r }), 'Innovation Review 요청됨(≠ Approval)');
            }, true)}
            {btn('Executive Review 요청', () => {
              const r = needReason();
              if (!r || !selInnovation) { if (!selInnovation) toast.error('Innovation 선택 필수'); return; }
              void act(() => createEnterpriseInnovationReview({ innovation_id: selInnovation, review_type: 'executive_review', review_summary: r }), 'Executive Review 요청됨(≠ Approval)');
            })}
            {btn('Human Review 요청', () => {
              const r = needReason();
              if (!r || !selInnovation) { if (!selInnovation) toast.error('Innovation 선택 필수'); return; }
              void act(() => createEnterpriseInnovationReview({ innovation_id: selInnovation, review_type: 'human_review', review_summary: r }), 'Human Review 요청됨(Innovation 실행은 사람)');
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {reviewSelect}
            {btn('검토 시작', () => ivReview('mark_in_review', {}, 'in_review'))}
            {btn('Review Reference 기록(Evidence 필수)', () => ivReview('record_review_reference', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Review Reference 기록됨(≠ Approval)'), true)}
            {btn('수정 요청', () => ivReview('request_revision', {}, 'revision_requested'))}
            {btn('Insufficient Data', () => ivReview('mark_insufficient_data', {}, 'insufficient_data'))}
          </div>
          <AdminAlert tone="warning" description="Review Workflow(§9 — innovation/executive/human 3종 요청만) — Self-Review 서버 차단(작성자 ≠ 평가자) · Evidence 없는 Review Reference 차단 · 종결 재결정 차단 · Review ≠ Approval. Innovation 실행은 반드시 사람이 수행합니다." />
          {reviewList(reviews.filter((r) => ['requested', 'in_review', 'revision_requested'].includes(r.review_status)), '대기 Review 없음', '0건은 검토할 것이 없음을 의미하지 않습니다.')}
        </div>
      )}
      {tab === 'reviewed' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Review Reference — 사람이 기록한 검토 참조이며 승인/사업 시작이 아닙니다." />
          {reviewList(reviews.filter((r) => r.review_status === 'review_reference_recorded'), 'Review Reference 없음', '사람이 검토를 완료한 기록이 여기에 표시됩니다.')}
          {eventList(evByType('innovation_review_reference_recorded'), 'Reference 이벤트 없음', 'Review Reference 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'learning' && simpleEventTab('innovation_learning_recorded', 'Innovation Learning 기록', 'Innovation Learning ≠ 자동 사업 시작 — 학습 반영 여부는 사람이 결정합니다.')}

      {tab === 'links' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {innSelect}{reasonInput}
            {btn('Improvement Link(0561 실존 검증)', () => innEvent('improvement_reference_linked', { note: reason.trim() }, 'Improvement Link 기록됨(0561 참조만)'), true)}
            {btn('Transformation Link(0560)', () => innEvent('transformation_reference_linked', { note: reason.trim() }, 'Transformation Link 기록됨(0560 참조만)'))}
            {btn('Value Link(0559)', () => innEvent('value_reference_linked', { note: reason.trim() }, 'Value Link 기록됨(0559 참조만)'))}
            {btn('Capacity Link(0558)', () => innEvent('capacity_reference_linked', { note: reason.trim() }, 'Capacity Link 기록됨(0558 참조만)'))}
            {btn('Scenario Link(0557)', () => innEvent('scenario_reference_linked', { note: reason.trim() }, 'Scenario Link 기록됨'))}
            {btn('Mission Link(0555)', () => innEvent('mission_reference_linked', { note: reason.trim() }, 'Mission Link 기록됨'))}
            {btn('Environment Link(0556)', () => innEvent('environment_reference_linked', { note: reason.trim() }, 'Environment Link 기록됨(0556 참조만)'))}
            {btn('Program Link(0547)', () => innEvent('program_reference_linked', { note: reason.trim() }, 'Program Link 기록됨'))}
          </div>
          <AdminAlert tone="info" description="Reference Link — ID 지정 시 실존 검증(0547/0555/0556/0557/0558/0559/0560/0561). Link ≠ 변경/확정/시작." />
          {eventList([...evByType('improvement_reference_linked'), ...evByType('transformation_reference_linked'), ...evByType('value_reference_linked'), ...evByType('capacity_reference_linked'), ...evByType('scenario_reference_linked'), ...evByType('mission_reference_linked'), ...evByType('environment_reference_linked'), ...evByType('program_reference_linked')], 'Reference Link 없음', '참조 연결 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'flow' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Innovation 흐름 관측(13단계) — 단계별 기록 존재 여부만 표시합니다(자동 진행 아님). vision 단계는 본 summary 에 원천 피드가 없어 항상 미관측으로 표시됩니다(정직 고지)." />
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
          <AdminAlert tone="info" description={`Innovation 이벤트 31종 통합 Audit — 총 ${NUM(num('innovation_events', 'total'))}건. 자동 사업 시작 이벤트 생성 금지.`} />
          {eventList(audit, 'Audit 이벤트 없음', '모든 Innovation Intelligence 활동이 여기에 기록됩니다.')}
        </div>
      )}

      {tab === 'support' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description={`분류 6종(fully/partially/advisory_only/human_review_only/unavailable/insufficient_data) — 매트릭스 ${ENTERPRISE_INNOVATION_SUPPORT_MATRIX.length}항목. unavailable 은 전부 automatic_*(자동 사업 시작 없음).`} />
          <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
            {ENTERPRISE_INNOVATION_SUPPORT_MATRIX.map((e) => (
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
