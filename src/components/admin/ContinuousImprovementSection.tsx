/**
 * ContinuousImprovementSection — Enterprise Continuous Improvement
 * Intelligence, Continuous Optimization & Operational Excellence Center
 * (Phase AI-OPS-57).
 *
 * Enterprise Vision→Mission→Strategy→Execution→Transformation→Continuous
 * Observation→Improvement Opportunity Detection→Root Cause Review→
 * Continuous Optimization→Operational Excellence→Executive Improvement
 * Review→Continuous Learning→Audit.
 * Improvement ≠ Guaranteed Success · Best Practice ≠ Universal Practice ·
 * Pattern ≠ Root Cause · Trend ≠ Prediction.
 * 자동 프로세스/워크플로/전략/KPI/Budget/조직 변경 없음.
 * (0554 improvement_candidates(AI 자기개선 후보)와 별개 계층 — 원본 무변경)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, BookOpen, ClipboardList, GitBranch, Grid3x3, History, Inbox,
  Layers, Lightbulb, Lock, RefreshCw, Repeat, Scale, Shield, TrendingUp, Users,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchEnterpriseContinuousImprovementSummary, fetchEnterpriseImprovements,
  createEnterpriseImprovement, reviewEnterpriseImprovement,
  createEnterpriseImprovementReview, reviewEnterpriseImprovementReview,
  fetchEnterpriseImprovementReviews, recordEnterpriseImprovementEvent,
  fetchEnterpriseContinuousImprovementAudit,
  type EnterpriseContinuousImprovementSummary, type EnterpriseImprovementRow,
  type EnterpriseImprovementReviewRow, type EnterpriseImprovementEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  IMPROVEMENT_CATEGORIES, IMPROVEMENT_DIMENSIONS, IMPROVEMENT_ASSESSMENT_RESULTS,
  ROOT_CAUSE_DIMENSIONS, ROOT_CAUSE_RESULTS, EXCELLENCE_DIMENSIONS, EXCELLENCE_RESULTS,
  IMPROVEMENT_TREND_RESULTS, PROCESS_EFFICIENCY_RESULTS, BEST_PRACTICE_RESULTS,
  RECURRENCE_RESULTS, IMPROVEMENT_PRIORITY_RESULTS,
  IMPROVEMENT_RECOMMENDATION_TYPES, IMPROVEMENT_SCORECARD_FIELDS,
  buildImprovementTimeline, ENTERPRISE_CONTINUOUS_IMPROVEMENT_SUPPORT_MATRIX,
} from '@/lib/enterpriseContinuousImprovement';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'improvements' | 'observation' | 'opportunity' | 'rootcause' | 'trend'
  | 'efficiency' | 'excellence' | 'bestpractice' | 'recurrence' | 'priority' | 'timeline'
  | 'summary' | 'scorecard' | 'recommendations' | 'reviewqueue' | 'reviewed'
  | 'learning' | 'links' | 'flow' | 'audit' | 'support' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Improvement Overview', icon: Layers },
  { key: 'improvements', label: 'Improvement Opportunities', icon: Lightbulb },
  { key: 'observation', label: 'Continuous Observation', icon: Activity },
  { key: 'opportunity', label: 'Improvement Assessment', icon: Scale },
  { key: 'rootcause', label: 'Root Cause Review', icon: Shield },
  { key: 'trend', label: 'Trend Analysis', icon: TrendingUp },
  { key: 'efficiency', label: 'Process Efficiency', icon: Activity },
  { key: 'excellence', label: 'Operational Excellence', icon: Grid3x3 },
  { key: 'bestpractice', label: 'Best Practices', icon: BookOpen },
  { key: 'recurrence', label: 'Recurrence Patterns', icon: Repeat },
  { key: 'priority', label: 'Improvement Priority', icon: Scale },
  { key: 'timeline', label: 'Improvement Timeline', icon: History },
  { key: 'summary', label: 'Executive Improvement Summaries', icon: ClipboardList },
  { key: 'scorecard', label: 'Executive Improvement Scorecard', icon: Grid3x3 },
  { key: 'recommendations', label: 'Recommendations', icon: Lightbulb },
  { key: 'reviewqueue', label: 'Review Queue', icon: Inbox },
  { key: 'reviewed', label: 'Review References', icon: Users },
  { key: 'learning', label: 'Continuous Learning', icon: BookOpen },
  { key: 'links', label: 'Reference Links', icon: GitBranch },
  { key: 'flow', label: 'Flow Timeline', icon: History },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
  { key: 'limitations', label: 'Known Limitations', icon: ClipboardList },
];

const KNOWN_LIMITATIONS = [
  'Process 자동 변경·Workflow 자동 변경·Strategy 자동 변경·KPI 자동 변경·Budget 자동 변경·조직 자동 변경·Production 변경·Merge/Deploy/Rollback 없음 — 모든 반환 flag(process_changed/workflow_changed/strategy_changed 등) 항상 false',
  'Improvement ≠ Guaranteed Success · Best Practice ≠ Universal Practice — 개선 기회 관측 후보 분석이며 성공 보장이 아닙니다',
  'Pattern ≠ Root Cause · Correlation ≠ Causation · Trend ≠ Prediction — Evidence 없는 Best Practice/Recommendation 서버 차단',
  'Improvement Review Reference 는 Self-Review 차단(작성자 ≠ 평가자) + Evidence 필수 — Review ≠ Approval, 개선 적용은 사람',
  'archived_reference/review_reference_recorded 재결정 차단 · 참조 실존 검증(0547/0549/0551/0555/0557/0558/0559/0560)',
  '이름 충돌 실측: 0554(AI-OPS-50)가 ai_enterprise_improvement_candidates·admin_enterprise_improvement_candidate_* 를 사용 중(AI 자기개선 후보 원장) — 본 계층 ai_enterprise_improvements/improvement_reviews/improvement_events 는 미사용 확인 후 스펙 권장명 그대로 사용(별개 계층)',
  '프로세스 마이닝/인시던트 관리/품질 관리 시스템/워크플로 분석/티켓팅/운영 메트릭 웨어하우스 피드 부재(실측) — insufficient_data 유지, 분석은 수동 기록 기반',
  'Improvement Timeline/Optimization·Root Cause·Best Practice·Continuous Learning History 는 JSONB 통합 — 시계열 원장 테이블 아님',
  'Migration 0472~0561 production 미적용 — 운영 수치는 적용 후 축적됩니다',
  '브라우저 실측 미검증 — UI 는 코드 리뷰/타입/빌드 기준 검증만 수행했습니다',
];

export default function ContinuousImprovementSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<EnterpriseContinuousImprovementSummary>({});
  const [improvements, setImprovements] = useState<EnterpriseImprovementRow[]>([]);
  const [reviews, setReviews] = useState<EnterpriseImprovementReviewRow[]>([]);
  const [audit, setAudit] = useState<EnterpriseImprovementEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [selImprovement, setSelImprovement] = useState('');
  const [selReview, setSelReview] = useState('');
  const [catSel, setCatSel] = useState<string>('process');
  const [impDimSel, setImpDimSel] = useState<string>('business_impact');
  const [rcDimSel, setRcDimSel] = useState<string>('evidence');
  const [excDimSel, setExcDimSel] = useState<string>('process_stability');
  const [recTypeSel, setRecTypeSel] = useState<string>('gather_more_evidence_candidate');
  const [resultSel, setResultSel] = useState<string>('insufficient_data');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, i, v, a] = await Promise.all([
        fetchEnterpriseContinuousImprovementSummary(), fetchEnterpriseImprovements(null, null, 200),
        fetchEnterpriseImprovementReviews(null, 200), fetchEnterpriseContinuousImprovementAudit(200),
      ]);
      setSummary(s); setImprovements(i); setReviews(v); setAudit(a);
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
  const impReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selImprovement) { if (!selImprovement) toast.error('Improvement 선택 필수'); return; }
    void act(() => reviewEnterpriseImprovement(selImprovement, action, r, payload), ok);
  };
  const irReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selReview) { if (!selReview) toast.error('Improvement Review 선택 필수'); return; }
    void act(() => reviewEnterpriseImprovementReview(selReview, action, r, payload), ok);
  };
  const impEvent = (kind: string, payload: Record<string, unknown>, ok: string, ids: { imp?: boolean; review?: boolean } = { imp: true }) => {
    const r = needReason();
    if (!r) return;
    void act(() => recordEnterpriseImprovementEvent(kind, r, payload, ids.imp ? (selImprovement || null) : null, ids.review ? (selReview || null) : null), ok);
  };

  const obj = useCallback((k: string): Record<string, unknown> => (typeof summary[k] === 'object' && summary[k] !== null && !Array.isArray(summary[k]) ? summary[k] as Record<string, unknown> : {}), [summary]);
  const num = useCallback((k: string, sub: string): number | null => {
    const v = obj(k)[sub];
    return typeof v === 'number' ? v : null;
  }, [obj]);

  const flowTimeline = useMemo(() => {
    const present: Record<string, boolean> = {
      mission: (num('improvement_actuals', 'missions_0555') ?? 0) > 0,
      strategy: (num('improvement_actuals', 'decision_scenarios_0557') ?? 0) > 0,
      execution: (num('improvement_actuals', 'execution_programs_0547') ?? 0) > 0,
      transformation: (num('improvement_actuals', 'transformations_0560') ?? 0) > 0,
      continuous_observation: (num('improvement_events', 'observations') ?? 0) > 0,
      improvement_opportunity_detection: (num('improvements', 'total') ?? 0) + (num('improvement_events', 'opportunity_reviews') ?? 0) > 0,
      root_cause_review: (num('improvement_events', 'root_cause_reviews') ?? 0) > 0,
      continuous_optimization: (num('improvement_events', 'trend_reviews') ?? 0) + (num('improvement_events', 'efficiency_reviews') ?? 0) + (num('improvement_events', 'priority_reviews') ?? 0) > 0,
      operational_excellence: (num('improvement_events', 'excellence_reviews') ?? 0) > 0,
      executive_improvement_review: (num('improvement_events', 'improvement_review_requests') ?? 0) + (num('improvement_events', 'executive_review_requests') ?? 0) + (num('improvement_events', 'human_review_requests') ?? 0) + (num('improvement_events', 'review_references') ?? 0) > 0,
      continuous_learning: (num('improvement_events', 'learnings') ?? 0) > 0,
      audit: (num('improvement_events', 'total') ?? 0) > 0,
      // vision 은 본 summary 에 원천 피드가 없어 관측 여부를 표시하지 않습니다(정직 미관측).
    };
    const entries = Object.entries(present).filter(([, ok]) => ok).map(([stage]) => ({ stage }));
    return buildImprovementTimeline(entries).stages.map((s) => ({ stage: s.stage, present: s.entries.length > 0 }));
  }, [num]);

  if (loading) return <AdminCard title="Continuous Improvement & Operational Excellence Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Continuous Improvement & Operational Excellence Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const impSelect = (
    <select value={selImprovement} onChange={(e) => setSelImprovement(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Improvement 선택</option>
      {improvements.map((i) => <option key={i.id} value={i.id}>{i.improvement_code} · {i.improvement_status}</option>)}
    </select>
  );
  const reviewSelect = (
    <select value={selReview} onChange={(e) => setSelReview(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Improvement Review 선택</option>
      {reviews.map((r) => <option key={r.id} value={r.id}>{r.review_code} · {r.review_status}</option>)}
    </select>
  );
  const reasonInput = <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button disabled={busy} onClick={onClick} className={primary ? 'rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50' : 'rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50'}>{label}</button>
  );
  const tone = (s: string) => (s.includes('exceptional') || s.includes('strong') || s.includes('highly_supported') || s.includes('excellence') || s.includes('mature_candidate') || s.includes('improving') || s.includes('efficient_process') || s.includes('proven_practice') || s.includes('isolated_incident') || s.includes('review_reference') || s === 'identified' ? 'success' as const : s.includes('speculative') || s.includes('weak_candidate') || s.includes('immature') || s.includes('deteriorating') || s.includes('inefficient') || s.includes('frequent_recurrence') || s === 'unavailable' ? 'danger' as const : 'warning' as const);
  const evByType = (t: string) => audit.filter((e) => e.event_type === t);
  const eventList = (rows: EnterpriseImprovementEventRow[], emptyTitle: string, emptyDesc: string) => (
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
  const impList = (list: EnterpriseImprovementRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((i) => (
          <div key={i.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(i.improvement_status)}>{i.improvement_status}</AdminBadge>
            <AdminBadge tone={tone(i.assessment_status)}>{i.assessment_status}</AdminBadge>
            <AdminBadge tone={tone(i.root_cause_status)}>{i.root_cause_status}</AdminBadge>
            <span className="ml-2 font-bold">{i.improvement_code}</span>
            <span className="ml-2 text-muted-foreground">{i.improvement_category} · {i.improvement_name} · excellence {i.excellence_status} · reviews {Array.isArray(i.improvement_reviews) ? i.improvement_reviews.length : 0}건</span>
          </div>
        ))}
      </div>
    )
  );
  const reviewList = (list: EnterpriseImprovementReviewRow[], emptyTitle: string, emptyDesc: string) => (
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
        {impSelect}{reasonInput}
        {btn(`${title} 기록`, () => impEvent(kind, { note: reason.trim() }, `${title} 기록됨`), true)}
      </div>
      <AdminAlert tone="info" description={note} />
      {eventList(evByType(kind), `${title} 없음`, '기록이 여기에 표시됩니다.')}
    </div>
  );
  const resultEventTab = (kind: string, title: string, note: string, results: readonly string[], extraPayload: Record<string, unknown> = {}) => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        {impSelect}
        <select value={results.includes(resultSel) ? resultSel : results[0]} onChange={(e) => setResultSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
          {results.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {reasonInput}
        {btn(`${title} 기록`, () => impEvent(kind, { result: results.includes(resultSel) ? resultSel : results[0], ...extraPayload }, `${title} 기록됨`), true)}
      </div>
      <AdminAlert tone="info" description={note} />
      {eventList(evByType(kind), `${title} 없음`, '사람 검토 기록이 여기에 표시됩니다.')}
    </div>
  );

  return (
    <AdminCard
      title="Continuous Improvement & Operational Excellence Center"
      subtitle="Continuous Observation→Improvement Opportunity Detection→Root Cause Review→Continuous Optimization→Operational Excellence→Executive Review→Learning — 개선 적용과 최종 결정은 반드시 사람"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 Enterprise 가 한 번의 개선으로 끝나지 않고 지속적으로 개선 기회를 발견하고 운영 품질을 향상시키도록 지원하는 Continuous Improvement 계층입니다. AI 는 Continuous Observation/Improvement Opportunity Detection/Root Cause Review/Trend·Process Efficiency·Operational Excellence 분석/Best Practice Detection/Recurrence Pattern 분석/Improvement Priority/Executive Summary·Scorecard/Recommendation/Review 요청/Continuous Learning 기록까지만 수행하며, Process 자동 변경·Workflow 자동 변경·Strategy 자동 변경·KPI 자동 변경·Budget 자동 변경·조직 자동 변경·Production 변경·Merge/Deploy/Rollback 은 수행하지 않습니다. Improvement ≠ Guaranteed Success, Best Practice ≠ Universal Practice, Pattern ≠ Root Cause, Trend ≠ Prediction. AI 는 개선 기회를 분석합니다. 사람이 개선을 승인하고 실행하며 최종 의사결정을 내립니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Improvements" value={NUM(num('improvements', 'total'))} />
            <Box label="Identified / Candidate / Reference / Archived" value={`${NUM(num('improvements', 'identified'))} / ${NUM(num('improvements', 'candidate'))} / ${NUM(num('improvements', 'review_reference'))} / ${NUM(num('improvements', 'archived'))}`} />
            <Box label="Exceptional / Strong / Weak Assessment" value={`${NUM(num('improvements', 'exceptional'))} / ${NUM(num('improvements', 'strong'))} / ${NUM(num('improvements', 'weak'))}`} />
            <Box label="Highly Supported / Speculative Root Causes" value={`${NUM(num('improvements', 'highly_supported_root_causes'))} / ${NUM(num('improvements', 'speculative_root_causes'))}`} />
            <Box label="Excellence·Mature / Developing·Immature" value={`${NUM(num('improvements', 'excellence'))} / ${NUM(num('improvements', 'immature'))}`} />
            <Box label="Improvement Reviews" value={NUM(num('reviews', 'total'))} />
            <Box label="Requested / In Review / Reference / Revision" value={`${NUM(num('reviews', 'requested'))} / ${NUM(num('reviews', 'in_review'))} / ${NUM(num('reviews', 'reference_recorded'))} / ${NUM(num('reviews', 'revision_requested'))}`} />
            <Box label="Observations / Opportunity / Root Cause Reviews" value={`${NUM(num('improvement_events', 'observations'))} / ${NUM(num('improvement_events', 'opportunity_reviews'))} / ${NUM(num('improvement_events', 'root_cause_reviews'))}`} />
            <Box label="Trend / Efficiency / Excellence Reviews" value={`${NUM(num('improvement_events', 'trend_reviews'))} / ${NUM(num('improvement_events', 'efficiency_reviews'))} / ${NUM(num('improvement_events', 'excellence_reviews'))}`} />
            <Box label="Best Practice / Recurrence / Priority" value={`${NUM(num('improvement_events', 'best_practice_reviews'))} / ${NUM(num('improvement_events', 'recurrence_reviews'))} / ${NUM(num('improvement_events', 'priority_reviews'))}`} />
            <Box label="Timelines / Summaries / Scorecards" value={`${NUM(num('improvement_events', 'timelines'))} / ${NUM(num('improvement_events', 'summaries'))} / ${NUM(num('improvement_events', 'scorecards'))}`} />
            <Box label="Recommendations" value={NUM(num('improvement_events', 'recommendations'))} />
            <Box label="Improvement / Executive / Human Review 요청" value={`${NUM(num('improvement_events', 'improvement_review_requests'))} / ${NUM(num('improvement_events', 'executive_review_requests'))} / ${NUM(num('improvement_events', 'human_review_requests'))}`} />
            <Box label="Review References" value={NUM(num('improvement_events', 'review_references'))} />
            <Box label="Learnings / Transformation Links(0560)" value={`${NUM(num('improvement_events', 'learnings'))} / ${NUM(num('improvement_events', 'transformation_links'))}`} />
            <Box label="Value Links(0559) / Capacity Links(0558)" value={`${NUM(num('improvement_events', 'value_links'))} / ${NUM(num('improvement_events', 'capacity_links'))}`} />
          </div>
          <AdminAlert tone="info" description={`improvement_unavailable: ${Array.isArray(summary.improvement_unavailable) ? (summary.improvement_unavailable as unknown[]).map(String).join(', ') : '—'}. Improvement 원천 실측 — Transformations(0560) ${NUM(num('improvement_actuals', 'transformations_0560'))}건 · Value Realizations(0559) ${NUM(num('improvement_actuals', 'value_realizations_0559'))}건 · Capacity Resources(0558) ${NUM(num('improvement_actuals', 'capacity_resources_0558'))}건 · Execution Programs(0547) ${NUM(num('improvement_actuals', 'execution_programs_0547'))}건 · Business Values(0549) ${NUM(num('improvement_actuals', 'business_values_0549'))}건 · Missions(0555) ${NUM(num('improvement_actuals', 'missions_0555'))}건. 0 과 Unknown 을 혼동하지 않습니다.`} />
        </div>
      )}

      {tab === 'improvements' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <select value={catSel} onChange={(e) => setCatSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {IMPROVEMENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {reasonInput}
            {btn('Improvement 기회 기록(≠ 개선 적용)', () => {
              const r = needReason();
              if (!r) return;
              void act(() => createEnterpriseImprovement({ improvement_category: catSel, improvement_name: r }), 'Improvement 기회 기록됨(자동 프로세스 변경 없음)');
            }, true)}
            {btn('Identified 표시', () => impReview('mark_identified', {}, 'identified(식별 상태)'))}
            {btn('Candidate 표시', () => impReview('mark_candidate', {}, 'candidate(≠ 승인)'))}
            {btn('Review Reference(Self 차단·Evidence 필수)', () => impReview('record_review_reference', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'review_reference(≠ Approval)'))}
            {btn('Archive', () => impReview('archive_reference', {}, 'archived_reference'))}
            {btn('Insufficient Data', () => impReview('mark_insufficient_data', {}, 'insufficient_data'))}
            {impSelect}
          </div>
          <AdminAlert tone="info" description="Category 11종 · 자동 프로세스/워크플로/전략/KPI/Budget/조직 변경 계열 category 서버 차단 · archived 재결정 차단." />
          {impList(improvements, 'Improvement 없음', '핵심 질문 예: 어떤 문제가 반복적으로 발생하는가? 어떤 개선이 가장 큰 효과를 만드는가? — 전부 Candidate 분석.')}
        </div>
      )}

      {tab === 'observation' && simpleEventTab('continuous_observation_recorded', 'Continuous Observation 기록', '관측 기록 ≠ 문제 확정 — 지속 관측 원장입니다.')}
      {tab === 'opportunity' && (
        <>
          {resultEventTab('improvement_opportunity_reviewed', 'Improvement Assessment 검토', 'Improvement 5평가(§5 — Business Impact/Operational Impact/Cost Reduction/Quality Improvement/Sustainability) — Improvement ≠ Guaranteed Success.', IMPROVEMENT_ASSESSMENT_RESULTS, { improvement_dimension: impDimSel })}
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <span className="text-[11px] text-muted-foreground">Improvement Dimension:</span>
            <select value={impDimSel} onChange={(e) => setImpDimSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {IMPROVEMENT_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </>
      )}
      {tab === 'rootcause' && (
        <>
          {resultEventTab('root_cause_reviewed', 'Root Cause Review 검토', 'Root Cause 5평가(§6 — Evidence/Frequency/Severity/Scope/Confidence) — Pattern ≠ Root Cause.', ROOT_CAUSE_RESULTS, { root_cause_dimension: rcDimSel })}
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <span className="text-[11px] text-muted-foreground">Root Cause Dimension:</span>
            <select value={rcDimSel} onChange={(e) => setRcDimSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {ROOT_CAUSE_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </>
      )}
      {tab === 'trend' && resultEventTab('trend_analysis_reviewed', 'Trend Analysis 검토', 'Trend ≠ Prediction — 관측 추세 후보이며 예측 확정이 아닙니다.', IMPROVEMENT_TREND_RESULTS)}
      {tab === 'efficiency' && resultEventTab('process_efficiency_reviewed', 'Process Efficiency 검토', 'Efficiency 관측 ≠ 프로세스 변경 — 비효율 관측 후보입니다.', PROCESS_EFFICIENCY_RESULTS)}
      {tab === 'excellence' && (
        <>
          {resultEventTab('operational_excellence_reviewed', 'Operational Excellence 검토', 'Excellence 5평가(§7 — Process Stability/Quality Consistency/Resource Efficiency/Continuous Learning/Improvement Adoption) — Excellence 관측 후보 ≠ 조직 평가.', EXCELLENCE_RESULTS, { excellence_dimension: excDimSel })}
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <span className="text-[11px] text-muted-foreground">Excellence Dimension:</span>
            <select value={excDimSel} onChange={(e) => setExcDimSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {EXCELLENCE_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </>
      )}
      {tab === 'bestpractice' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {impSelect}
            <select value={(BEST_PRACTICE_RESULTS as readonly string[]).includes(resultSel) ? resultSel : BEST_PRACTICE_RESULTS[0]} onChange={(e) => setResultSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {BEST_PRACTICE_RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {reasonInput}
            {btn('Best Practice 기록(Evidence 필수)', () => impEvent('best_practice_reviewed', { result: (BEST_PRACTICE_RESULTS as readonly string[]).includes(resultSel) ? resultSel : BEST_PRACTICE_RESULTS[0], evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Best Practice 기록됨(≠ Universal Practice)'), true)}
          </div>
          <AdminAlert tone="warning" description="Best Practice ≠ Universal Practice — Evidence 없는 기록 서버 차단, 확산 결정은 사람이 수행합니다." />
          {eventList(evByType('best_practice_reviewed'), 'Best Practice 없음', 'Best Practice 후보가 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'recurrence' && resultEventTab('recurrence_pattern_reviewed', 'Recurrence Pattern 검토', 'Correlation ≠ Causation — 반복 발생 관측 후보이며 인과 확정이 아닙니다.', RECURRENCE_RESULTS)}
      {tab === 'priority' && resultEventTab('improvement_priority_reviewed', 'Improvement Priority 검토', 'Priority ≠ Mandatory Order — 우선순위 후보이며 강제 순서가 아닙니다.', IMPROVEMENT_PRIORITY_RESULTS)}
      {tab === 'timeline' && simpleEventTab('improvement_timeline_recorded', 'Improvement Timeline 기록', 'Improvement Timeline — improvement_history 로 통합 축적됩니다(≠ Forecast 확정).')}
      {tab === 'summary' && simpleEventTab('executive_improvement_summary_recorded', 'Executive Improvement Summary 기록', 'Summary ≠ 개선 적용 확정 — 경영진 판단 보조 자료입니다.')}
      {tab === 'scorecard' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {impSelect}{reasonInput}
            {btn('Improvement Scorecard 기록', () => impEvent('executive_improvement_scorecard_recorded', { fields: [...IMPROVEMENT_SCORECARD_FIELDS], note: reason.trim() }, 'Scorecard 기록됨(≠ 개선 지시)'), true)}
          </div>
          <AdminAlert tone="warning" description={`§8 필드 8종(${IMPROVEMENT_SCORECARD_FIELDS.join(', ')}) — Scorecard ≠ 개선 지시(speculative root cause/weak improvement 우선 결정적 정렬 후보).`} />
          {eventList(evByType('executive_improvement_scorecard_recorded'), 'Scorecard 없음', 'Executive Improvement Scorecard 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'recommendations' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {impSelect}
            <select value={recTypeSel} onChange={(e) => setRecTypeSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {IMPROVEMENT_RECOMMENDATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Recommendation 기록(Evidence 필수)', () => impEvent('improvement_recommendation_recorded', { recommendation_type: recTypeSel, evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Recommendation 기록됨(≠ Decision)'), true)}
          </div>
          <AdminAlert tone="info" description="Improvement Recommendation ≠ Decision — 권고 23종 whitelist, Evidence 없는 Recommendation 서버 차단. 채택은 사람이 결정합니다." />
          {eventList(evByType('improvement_recommendation_recorded'), 'Recommendation 없음', 'Improvement Recommendation 후보가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'reviewqueue' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {impSelect}{reasonInput}
            {btn('Improvement Review 요청', () => {
              const r = needReason();
              if (!r || !selImprovement) { if (!selImprovement) toast.error('Improvement 선택 필수'); return; }
              void act(() => createEnterpriseImprovementReview({ improvement_id: selImprovement, review_type: 'improvement_review', review_summary: r }), 'Improvement Review 요청됨(≠ Approval)');
            }, true)}
            {btn('Executive Review 요청', () => {
              const r = needReason();
              if (!r || !selImprovement) { if (!selImprovement) toast.error('Improvement 선택 필수'); return; }
              void act(() => createEnterpriseImprovementReview({ improvement_id: selImprovement, review_type: 'executive_review', review_summary: r }), 'Executive Review 요청됨(≠ Approval)');
            })}
            {btn('Human Review 요청', () => {
              const r = needReason();
              if (!r || !selImprovement) { if (!selImprovement) toast.error('Improvement 선택 필수'); return; }
              void act(() => createEnterpriseImprovementReview({ improvement_id: selImprovement, review_type: 'human_review', review_summary: r }), 'Human Review 요청됨(개선 적용은 사람)');
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {reviewSelect}
            {btn('검토 시작', () => irReview('mark_in_review', {}, 'in_review'))}
            {btn('Review Reference 기록(Evidence 필수)', () => irReview('record_review_reference', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Review Reference 기록됨(≠ Approval)'), true)}
            {btn('수정 요청', () => irReview('request_revision', {}, 'revision_requested'))}
            {btn('Insufficient Data', () => irReview('mark_insufficient_data', {}, 'insufficient_data'))}
          </div>
          <AdminAlert tone="warning" description="Review Workflow(§9 — improvement/executive/human 3종 요청만) — Self-Review 서버 차단(작성자 ≠ 평가자) · Evidence 없는 Review Reference 차단 · 종결 재결정 차단 · Review ≠ Approval. 개선 적용은 반드시 사람이 수행합니다." />
          {reviewList(reviews.filter((r) => ['requested', 'in_review', 'revision_requested'].includes(r.review_status)), '대기 Review 없음', '0건은 검토할 것이 없음을 의미하지 않습니다.')}
        </div>
      )}
      {tab === 'reviewed' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Review Reference — 사람이 기록한 검토 참조이며 승인/개선 적용이 아닙니다." />
          {reviewList(reviews.filter((r) => r.review_status === 'review_reference_recorded'), 'Review Reference 없음', '사람이 검토를 완료한 기록이 여기에 표시됩니다.')}
          {eventList(evByType('improvement_review_reference_recorded'), 'Reference 이벤트 없음', 'Review Reference 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'learning' && simpleEventTab('continuous_learning_recorded', 'Continuous Learning 기록', 'Continuous Learning ≠ 자동 프로세스 변경 — 학습 반영 여부는 사람이 결정합니다.')}

      {tab === 'links' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {impSelect}{reasonInput}
            {btn('Transformation Link(0560 실존 검증)', () => impEvent('transformation_reference_linked', { note: reason.trim() }, 'Transformation Link 기록됨(0560 참조만)'), true)}
            {btn('Value Link(0559)', () => impEvent('value_reference_linked', { note: reason.trim() }, 'Value Link 기록됨(0559 참조만)'))}
            {btn('Capacity Link(0558)', () => impEvent('capacity_reference_linked', { note: reason.trim() }, 'Capacity Link 기록됨(0558 참조만)'))}
            {btn('Program Link(0547)', () => impEvent('program_reference_linked', { note: reason.trim() }, 'Program Link 기록됨'))}
            {btn('Scenario Link(0557)', () => impEvent('scenario_reference_linked', { note: reason.trim() }, 'Scenario Link 기록됨'))}
            {btn('Mission Link(0555)', () => impEvent('mission_reference_linked', { note: reason.trim() }, 'Mission Link 기록됨'))}
            {btn('Governance Link(0551)', () => impEvent('governance_reference_linked', { note: reason.trim() }, 'Governance Link 기록됨(0551 참조만)'))}
            {btn('Business Value Link(0549)', () => impEvent('business_value_reference_linked', { note: reason.trim() }, 'Business Value Link 기록됨(0549 참조만)'))}
          </div>
          <AdminAlert tone="info" description="Reference Link — ID 지정 시 실존 검증(0547/0549/0551/0555/0557/0558/0559/0560). Link ≠ 변경/확정/적용." />
          {eventList([...evByType('transformation_reference_linked'), ...evByType('value_reference_linked'), ...evByType('capacity_reference_linked'), ...evByType('program_reference_linked'), ...evByType('scenario_reference_linked'), ...evByType('mission_reference_linked'), ...evByType('governance_reference_linked'), ...evByType('business_value_reference_linked')], 'Reference Link 없음', '참조 연결 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'flow' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Improvement 흐름 관측(13단계) — 단계별 기록 존재 여부만 표시합니다(자동 진행 아님). vision 단계는 본 summary 에 원천 피드가 없어 항상 미관측으로 표시됩니다(정직 고지)." />
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
          <AdminAlert tone="info" description={`Improvement 이벤트 31종 통합 Audit — 총 ${NUM(num('improvement_events', 'total'))}건. 자동 프로세스 변경 이벤트 생성 금지.`} />
          {eventList(audit, 'Audit 이벤트 없음', '모든 Continuous Improvement 활동이 여기에 기록됩니다.')}
        </div>
      )}

      {tab === 'support' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description={`분류 6종(fully/partially/advisory_only/human_review_only/unavailable/insufficient_data) — 매트릭스 ${ENTERPRISE_CONTINUOUS_IMPROVEMENT_SUPPORT_MATRIX.length}항목. unavailable 은 전부 automatic_*(자동 프로세스 변경 없음).`} />
          <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
            {ENTERPRISE_CONTINUOUS_IMPROVEMENT_SUPPORT_MATRIX.map((e) => (
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
