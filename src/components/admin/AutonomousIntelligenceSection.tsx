/**
 * AutonomousIntelligenceSection — Enterprise Autonomous Intelligence,
 * Meta-Reasoning & Self-Improvement Governance Center (Phase AI-OPS-50).
 *
 * Enterprise Vision→AI Observation→AI Reasoning→Meta Reasoning→Decision
 * Quality→Recommendation Accuracy→Confidence Calibration→Failure Analysis→
 * Self Improvement Candidate→Human Oversight→Executive AI Review→AI Learning→
 * Audit.
 * Improvement Candidate ≠ Applied Improvement · Confidence ≠ Correctness ·
 * Failure Pattern ≠ Root Cause · Meta Reasoning ≠ Truth · AI Review ≠ Human
 * Approval. 자동 모델 교체/학습·Prompt/Rule/Code/DB 자동 변경 없음.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, BookOpen, Brain, ClipboardList, Gauge, GitBranch, Grid3x3,
  History, Inbox, Layers, Lightbulb, Lock, RefreshCw, Search, Shield, Users,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchEnterpriseAiSummary, fetchEnterpriseAiReviews, createEnterpriseAiReview,
  reviewEnterpriseAiReview, createEnterpriseImprovementCandidate,
  reviewEnterpriseImprovementCandidate, fetchEnterpriseImprovementCandidates,
  recordEnterpriseAiEvent, fetchEnterpriseAiAudit,
  type EnterpriseAiSummary, type EnterpriseAiReviewRow,
  type EnterpriseImprovementCandidateRow, type EnterpriseAiEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  AI_REVIEW_CATEGORIES, RECOMMENDATION_ACCURACY_RESULTS, CONFIDENCE_CALIBRATION_RESULTS,
  IMPROVEMENT_AREAS, IMPROVEMENT_PRIORITY_RESULTS, DECISION_QUALITY_RESULTS,
  FAILURE_PATTERN_RESULTS, HALLUCINATION_RISK_RESULTS, BLIND_SPOT_RESULTS,
  KNOWLEDGE_COVERAGE_RESULTS, AI_RECOMMENDATION_TYPES, AI_SCORECARD_FIELDS,
  buildAutonomousTimeline, ENTERPRISE_AUTONOMOUS_COMPONENTS, ENTERPRISE_AUTONOMOUS_SUPPORT_MATRIX,
} from '@/lib/enterpriseAutonomous';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'reviews' | 'observation' | 'reasoning' | 'meta' | 'accuracy' | 'calibration'
  | 'quality' | 'failures' | 'hallucination' | 'blindspot' | 'coverage' | 'corrections'
  | 'improvements' | 'rulerefine' | 'promptimprove' | 'summary' | 'scorecard' | 'recommendations'
  | 'reviewqueue' | 'oversight' | 'learning' | 'links' | 'flow' | 'audit' | 'support' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'AI Overview', icon: Layers },
  { key: 'reviews', label: 'AI Reviews', icon: BookOpen },
  { key: 'observation', label: 'AI Observation', icon: Search },
  { key: 'reasoning', label: 'AI Reasoning', icon: Brain },
  { key: 'meta', label: 'Meta Reasoning', icon: Brain },
  { key: 'accuracy', label: 'Recommendation Accuracy', icon: Gauge },
  { key: 'calibration', label: 'Confidence Calibration', icon: Gauge },
  { key: 'quality', label: 'Decision Quality', icon: Activity },
  { key: 'failures', label: 'Failure Analysis', icon: Activity },
  { key: 'hallucination', label: 'Hallucination Risk', icon: Shield },
  { key: 'blindspot', label: 'Blind Spot', icon: Search },
  { key: 'coverage', label: 'Knowledge Coverage', icon: Shield },
  { key: 'corrections', label: 'Human Corrections', icon: Users },
  { key: 'improvements', label: 'Improvement Candidates', icon: Lightbulb },
  { key: 'rulerefine', label: 'Rule Refinement', icon: ClipboardList },
  { key: 'promptimprove', label: 'Prompt Improvement', icon: ClipboardList },
  { key: 'summary', label: 'Executive AI Summaries', icon: ClipboardList },
  { key: 'scorecard', label: 'Executive AI Scorecard', icon: Grid3x3 },
  { key: 'recommendations', label: 'AI Recommendations', icon: Lightbulb },
  { key: 'reviewqueue', label: 'Review Queue', icon: Inbox },
  { key: 'oversight', label: 'Human Oversight', icon: Users },
  { key: 'learning', label: 'AI Learning', icon: BookOpen },
  { key: 'links', label: 'Reference Links', icon: GitBranch },
  { key: 'flow', label: 'Flow Timeline', icon: History },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
  { key: 'limitations', label: 'Known Limitations', icon: ClipboardList },
];

const KNOWN_LIMITATIONS = [
  '모델 자동 교체/학습·Prompt/Rule/Strategy/Governance/Policy/Budget 자동 변경·Production 변경·Merge/Deploy/Rollback·Code/DB 자동 수정 없음 — 모든 반환 flag(model_changed/prompt_changed/rule_changed/code_changed 등) 항상 false',
  'Improvement Candidate ≠ Applied Improvement — Evidence 없는 후보 생성 서버 차단, 적용은 사람',
  'Recommendation Accuracy ≠ Future Accuracy · Confidence ≠ Correctness — Calibration gap 은 관측 후보',
  'Failure Pattern ≠ Root Cause · Blind Spot ≠ Missing Knowledge · Meta Reasoning ≠ Truth',
  'AI Review Reference 는 Self-Review 차단(작성자 ≠ 평가자) + Evidence 필수 — AI Review ≠ Human Approval',
  'archived_reference/review_reference_recorded 재결정 차단 · 참조 실존 검증(0514/0520/0551/0553)',
  '실제 모델 레지스트리/Prompt 버전 원장/추론 텔레메트리 로그/평가 하네스/학습 파이프라인/휴먼 피드백 라벨링 시스템 부재(실측) — insufficient_data 유지',
  'Accuracy/Confidence/Failure History 는 JSONB append — 시계열 원장 테이블 아님',
  'Migration 0472~0554 production 미적용 — 운영 수치는 적용 후 축적됩니다',
  '브라우저 실측 미검증 — UI 는 코드 리뷰/타입/빌드 기준 검증만 수행했습니다',
];

export default function AutonomousIntelligenceSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<EnterpriseAiSummary>({});
  const [reviews, setReviews] = useState<EnterpriseAiReviewRow[]>([]);
  const [candidates, setCandidates] = useState<EnterpriseImprovementCandidateRow[]>([]);
  const [audit, setAudit] = useState<EnterpriseAiEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [selReview, setSelReview] = useState('');
  const [selCandidate, setSelCandidate] = useState('');
  const [catSel, setCatSel] = useState<string>('recommendation');
  const [areaSel, setAreaSel] = useState<string>('rule');
  const [prioSel, setPrioSel] = useState<string>('unverified_candidate');
  const [recTypeSel, setRecTypeSel] = useState<string>('gather_more_evidence_candidate');
  const [resultSel, setResultSel] = useState<string>('insufficient_data');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, r, c, a] = await Promise.all([
        fetchEnterpriseAiSummary(), fetchEnterpriseAiReviews(null, null, 200),
        fetchEnterpriseImprovementCandidates(null, 200), fetchEnterpriseAiAudit(200),
      ]);
      setSummary(s); setReviews(r); setCandidates(c); setAudit(a);
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
  const arReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selReview) { if (!selReview) toast.error('AI Review 선택 필수'); return; }
    void act(() => reviewEnterpriseAiReview(selReview, action, r, payload), ok);
  };
  const icReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selCandidate) { if (!selCandidate) toast.error('Improvement Candidate 선택 필수'); return; }
    void act(() => reviewEnterpriseImprovementCandidate(selCandidate, action, r, payload), ok);
  };
  const aiEvent = (kind: string, payload: Record<string, unknown>, ok: string, ids: { review?: boolean; candidate?: boolean } = { review: true }) => {
    const r = needReason();
    if (!r) return;
    void act(() => recordEnterpriseAiEvent(kind, r, payload, ids.review ? (selReview || null) : null, ids.candidate ? (selCandidate || null) : null), ok);
  };

  const obj = useCallback((k: string): Record<string, unknown> => (typeof summary[k] === 'object' && summary[k] !== null && !Array.isArray(summary[k]) ? summary[k] as Record<string, unknown> : {}), [summary]);
  const num = useCallback((k: string, sub: string): number | null => {
    const v = obj(k)[sub];
    return typeof v === 'number' ? v : null;
  }, [obj]);

  const flowTimeline = useMemo(() => buildAutonomousTimeline({ present: {
    enterprise_vision: (num('ai_actuals', 'governance_decisions_0551') ?? 0) > 0,
    ai_observation: (num('ai_events', 'observations') ?? 0) > 0,
    ai_reasoning: (num('ai_events', 'reasonings') ?? 0) > 0,
    meta_reasoning: (num('ai_events', 'meta_reasonings') ?? 0) > 0,
    decision_quality: (num('ai_events', 'quality_reviews') ?? 0) > 0,
    recommendation_accuracy: (num('ai_events', 'accuracy_reviews') ?? 0) > 0,
    confidence_calibration: (num('ai_events', 'calibration_reviews') ?? 0) > 0,
    failure_analysis: (num('ai_events', 'failure_reviews') ?? 0) + (num('ai_events', 'hallucination_reviews') ?? 0) + (num('ai_events', 'blind_spot_reviews') ?? 0) > 0,
    self_improvement_candidate: (num('improvements', 'total') ?? 0) + (num('ai_events', 'rule_candidates') ?? 0) + (num('ai_events', 'prompt_candidates') ?? 0) > 0,
    human_oversight: (num('ai_events', 'oversights') ?? 0) + (num('ai_events', 'human_corrections') ?? 0) > 0,
    executive_ai_review: (num('ai_events', 'ai_review_requests') ?? 0) + (num('ai_events', 'executive_review_requests') ?? 0) + (num('ai_events', 'oversight_review_requests') ?? 0) + (num('ai_events', 'review_references') ?? 0) > 0,
    ai_learning: (num('ai_events', 'learnings') ?? 0) > 0,
  } }), [num]);

  if (loading) return <AdminCard title="Autonomous Intelligence & Self-Improvement Governance Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Autonomous Intelligence & Self-Improvement Governance Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const reviewSelect = (
    <select value={selReview} onChange={(e) => setSelReview(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">AI Review 선택</option>
      {reviews.map((r) => <option key={r.id} value={r.id}>{r.review_code} · {r.review_status}</option>)}
    </select>
  );
  const candidateSelect = (
    <select value={selCandidate} onChange={(e) => setSelCandidate(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Improvement Candidate 선택</option>
      {candidates.map((c) => <option key={c.id} value={c.id}>{c.candidate_code} · {c.improvement_status}</option>)}
    </select>
  );
  const reasonInput = <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button disabled={busy} onClick={onClick} className={primary ? 'rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50' : 'rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50'}>{label}</button>
  );
  const tone = (s: string) => (s.includes('highly_reliable') || s.includes('reliable_candidate') || s.includes('well_calibrated') || s.includes('high_quality') || s.includes('no_material') || s.includes('broad_coverage') || s.includes('low_hallucination') || s.includes('review_reference') || s.includes('highly_recommended') ? 'success' as const : s.includes('unreliable') || s.includes('overconfident') || s.includes('recurring_failure') || s.includes('critical') || s.includes('high_hallucination') || s.includes('low_quality') || s === 'unavailable' ? 'danger' as const : 'warning' as const);
  const evByType = (t: string) => audit.filter((e) => e.event_type === t);
  const eventList = (rows: EnterpriseAiEventRow[], emptyTitle: string, emptyDesc: string) => (
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
  const reviewList = (list: EnterpriseAiReviewRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((r) => (
          <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(r.review_status)}>{r.review_status}</AdminBadge>
            <AdminBadge tone={tone(r.accuracy_status)}>{r.accuracy_status}</AdminBadge>
            <AdminBadge tone={tone(r.calibration_status)}>{r.calibration_status}</AdminBadge>
            <span className="ml-2 font-bold">{r.review_code}</span>
            <span className="ml-2 text-muted-foreground">{r.review_category} · {r.review_title} · learnings {Array.isArray(r.learning_history) ? r.learning_history.length : 0}건</span>
          </div>
        ))}
      </div>
    )
  );
  const candidateList = (list: EnterpriseImprovementCandidateRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((c) => (
          <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(c.improvement_status)}>{c.improvement_status}</AdminBadge>
            <AdminBadge tone={tone(c.priority_status)}>{c.priority_status}</AdminBadge>
            <span className="ml-2 font-bold">{c.candidate_code}</span>
            <span className="ml-2 text-muted-foreground">{c.improvement_area} · {c.description ?? '—'} · evidence {Array.isArray(c.evidence) ? c.evidence.length : 0}건</span>
          </div>
        ))}
      </div>
    )
  );
  const resultEventTab = (kind: string, title: string, note: string, results: readonly string[], extraPayload: Record<string, unknown> = {}) => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        {reviewSelect}
        <select value={results.includes(resultSel) ? resultSel : results[0]} onChange={(e) => setResultSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
          {results.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {reasonInput}
        {btn(`${title} 기록`, () => aiEvent(kind, { result: results.includes(resultSel) ? resultSel : results[0], ...extraPayload }, `${title} 기록됨`), true)}
      </div>
      <AdminAlert tone="info" description={note} />
      {eventList(evByType(kind), `${title} 없음`, '사람 검토 기록이 여기에 표시됩니다.')}
    </div>
  );

  return (
    <AdminCard
      title="Autonomous Intelligence & Self-Improvement Governance Center"
      subtitle="AI Observation→Reasoning→Meta Reasoning→Decision Quality→Accuracy→Calibration→Failure→Improvement Candidate→Human Oversight→Executive AI Review→Learning — AI 는 개선 후보를 설명하고, 사람이 AI 를 개선"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 AI 가 Enterprise 를 분석하는 것을 넘어 자신의 분석 품질 자체를 평가하는 Meta Intelligence 계층입니다. AI 는 Recommendation Accuracy/Confidence Calibration/Meta Reasoning/Failure Pattern/Decision Quality/Hallucination Risk/Blind Spot/Knowledge Coverage 분석·Improvement/Rule/Prompt 개선 후보 생성·Executive AI Summary/Scorecard·AI Review 요청·AI Learning 기록까지만 수행하며, 모델 자동 교체·모델 자동 학습·Prompt/Rule/Strategy/Governance/Policy/Budget 자동 변경·Production 변경·Merge/Deploy/Rollback·Code/DB 자동 수정은 수행하지 않습니다. Improvement Candidate ≠ Applied Improvement, Confidence ≠ Correctness, Failure Pattern ≠ Root Cause, Meta Reasoning ≠ Truth, AI Review ≠ Human Approval. AI 는 개선 후보를 설명합니다. 사람이 AI 를 개선합니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="AI Reviews" value={NUM(num('ai_reviews', 'total'))} />
            <Box label="Draft / Candidate / Reference / Archived" value={`${NUM(num('ai_reviews', 'draft'))} / ${NUM(num('ai_reviews', 'candidate'))} / ${NUM(num('ai_reviews', 'review_reference'))} / ${NUM(num('ai_reviews', 'archived'))}`} />
            <Box label="Reliable / Unreliable Candidates" value={`${NUM(num('ai_reviews', 'reliable'))} / ${NUM(num('ai_reviews', 'unreliable'))}`} />
            <Box label="Well Calibrated / Miscalibrated" value={`${NUM(num('ai_reviews', 'well_calibrated'))} / ${NUM(num('ai_reviews', 'miscalibrated'))}`} />
            <Box label="Improvement Candidates" value={NUM(num('improvements', 'total'))} />
            <Box label="Proposed / Under Review / Reference / Revision" value={`${NUM(num('improvements', 'proposed'))} / ${NUM(num('improvements', 'under_review'))} / ${NUM(num('improvements', 'reference_recorded'))} / ${NUM(num('improvements', 'revision_requested'))}`} />
            <Box label="Highly Recommended Candidates" value={NUM(num('improvements', 'highly_recommended'))} />
            <Box label="Observations / Reasonings / Meta" value={`${NUM(num('ai_events', 'observations'))} / ${NUM(num('ai_events', 'reasonings'))} / ${NUM(num('ai_events', 'meta_reasonings'))}`} />
            <Box label="Accuracy / Calibration / Quality Reviews" value={`${NUM(num('ai_events', 'accuracy_reviews'))} / ${NUM(num('ai_events', 'calibration_reviews'))} / ${NUM(num('ai_events', 'quality_reviews'))}`} />
            <Box label="Failure / Hallucination / Blind Spot / Coverage" value={`${NUM(num('ai_events', 'failure_reviews'))} / ${NUM(num('ai_events', 'hallucination_reviews'))} / ${NUM(num('ai_events', 'blind_spot_reviews'))} / ${NUM(num('ai_events', 'coverage_reviews'))}`} />
            <Box label="Human Corrections / Oversights" value={`${NUM(num('ai_events', 'human_corrections'))} / ${NUM(num('ai_events', 'oversights'))}`} />
            <Box label="Rule / Prompt 개선 후보" value={`${NUM(num('ai_events', 'rule_candidates'))} / ${NUM(num('ai_events', 'prompt_candidates'))}`} />
            <Box label="Summaries / Scorecards / Recommendations" value={`${NUM(num('ai_events', 'summaries'))} / ${NUM(num('ai_events', 'scorecards'))} / ${NUM(num('ai_events', 'recommendations'))}`} />
            <Box label="AI / Executive / Oversight Review 요청" value={`${NUM(num('ai_events', 'ai_review_requests'))} / ${NUM(num('ai_events', 'executive_review_requests'))} / ${NUM(num('ai_events', 'oversight_review_requests'))}`} />
            <Box label="Review References" value={NUM(num('ai_events', 'review_references'))} />
            <Box label="Learnings / Knowledge / Governance Links" value={`${NUM(num('ai_events', 'learnings'))} / ${NUM(num('ai_events', 'knowledge_links'))} / ${NUM(num('ai_events', 'governance_links'))}`} />
          </div>
          <AdminAlert tone="info" description={`ai_unavailable: ${Array.isArray(summary.ai_unavailable) ? (summary.ai_unavailable as unknown[]).map(String).join(', ') : '—'}. Autonomous 원천 실측 — Knowledge Memories(0553) ${NUM(num('ai_actuals', 'knowledge_memories_0553'))}건 · Decision Outcomes(0514) ${NUM(num('ai_actuals', 'decision_outcomes_0514'))}건 · Governance Decisions(0551) ${NUM(num('ai_actuals', 'governance_decisions_0551'))}건 · Execution Commitments(0520) ${NUM(num('ai_actuals', 'execution_commitments_0520'))}건 · Org Memory(0531) ${NUM(num('ai_actuals', 'org_memory_0531'))}건 · Organizational Learnings(0515) ${NUM(num('ai_actuals', 'organizational_learnings_0515'))}건. 0 과 Unknown 을 혼동하지 않습니다.`} />
        </div>
      )}

      {tab === 'reviews' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <select value={catSel} onChange={(e) => setCatSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {AI_REVIEW_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {reasonInput}
            {btn('AI Review 생성(≠ Human Approval)', () => {
              const r = needReason();
              if (!r) return;
              void act(() => createEnterpriseAiReview({ review_category: catSel, review_title: r }), 'AI Review 생성됨(draft — 자동 모델 변경 없음)');
            }, true)}
            {btn('Candidate 표시', () => arReview('mark_candidate', {}, 'candidate'))}
            {btn('Review Reference(Self 차단·Evidence 필수)', () => arReview('record_review_reference', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'review_reference(사람의 검토 기록)'))}
            {btn('Archive', () => arReview('archive_reference', {}, 'archived_reference'))}
            {btn('Insufficient Data', () => arReview('mark_insufficient_data', {}, 'insufficient_data'))}
            {reviewSelect}
          </div>
          <AdminAlert tone="info" description="Category 15종 · 자동 모델/Prompt/Rule 변경 계열 category 서버 차단 · archived 재결정 차단." />
          {reviewList(reviews, 'AI Review 없음', '핵심 질문 예: 어떤 Recommendation 이 가장 정확했는가? AI 는 어디에서 과신하는가? — 전부 Candidate 분석.')}
        </div>
      )}

      {tab === 'observation' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {reviewSelect}{reasonInput}
            {btn('AI Observation 기록', () => aiEvent('ai_observation_recorded', { note: reason.trim() }, 'Observation 기록됨(≠ 사실 확정)'), true)}
          </div>
          <AdminAlert tone="info" description="AI Observation — 분석 대상 관측 기록이며 사실 확정이 아닙니다." />
          {eventList(evByType('ai_observation_recorded'), 'Observation 없음', 'AI 관측 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'reasoning' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {reviewSelect}{reasonInput}
            {btn('AI Reasoning 기록', () => aiEvent('ai_reasoning_recorded', { note: reason.trim() }, 'Reasoning 기록됨(≠ 결론 확정)'), true)}
          </div>
          <AdminAlert tone="info" description="AI Reasoning — 추론 과정 기록이며 결론 확정이 아닙니다." />
          {eventList(evByType('ai_reasoning_recorded'), 'Reasoning 없음', 'AI 추론 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'meta' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {reviewSelect}{reasonInput}
            {btn('Meta Reasoning 기록', () => aiEvent('meta_reasoning_recorded', { note: reason.trim() }, 'Meta Reasoning 기록됨(≠ Truth)'), true)}
          </div>
          <AdminAlert tone="warning" description="Meta Reasoning ≠ Truth — 자신의 추론에 대한 추론이며 진리 판정이 아닙니다." />
          {eventList(evByType('meta_reasoning_recorded'), 'Meta Reasoning 없음', '메타 추론 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'accuracy' && resultEventTab('recommendation_accuracy_reviewed', 'Recommendation Accuracy 검토', 'Accuracy 5평가(§5 — Recommendation Quality/Human Acceptance/Prediction Stability/Consistency/Evidence Quality) — Accuracy ≠ Future Accuracy.', RECOMMENDATION_ACCURACY_RESULTS)}
      {tab === 'calibration' && resultEventTab('confidence_calibration_reviewed', 'Confidence Calibration 검토', 'Calibration(§6 — Prediction/Confidence/Actual Outcome/Gap) — Confidence ≠ Correctness, 과신/과소신뢰 관측 후보.', CONFIDENCE_CALIBRATION_RESULTS)}
      {tab === 'quality' && resultEventTab('decision_quality_reviewed', 'Decision Quality 검토', 'Decision Quality Candidate ≠ 품질 확정 — 의사결정 품질 관측 후보입니다.', DECISION_QUALITY_RESULTS)}
      {tab === 'failures' && resultEventTab('failure_pattern_reviewed', 'Failure Pattern 검토', 'Failure Pattern ≠ Root Cause — 반복 실패 후보이며 원인 확정이 아닙니다.', FAILURE_PATTERN_RESULTS)}
      {tab === 'hallucination' && resultEventTab('hallucination_risk_reviewed', 'Hallucination Risk 검토', 'Hallucination Risk 후보 ≠ 판정 확정 — 근거 없는 생성 위험 관측 후보입니다.', HALLUCINATION_RISK_RESULTS)}
      {tab === 'blindspot' && resultEventTab('blind_spot_reviewed', 'Blind Spot 검토', 'Blind Spot ≠ Missing Knowledge — 관측되지 않은 영역 후보입니다.', BLIND_SPOT_RESULTS)}
      {tab === 'coverage' && resultEventTab('knowledge_coverage_reviewed', 'Knowledge Coverage 검토', 'Coverage Candidate ≠ 지식 충분 확정 — 지식 커버리지 관측 후보입니다.', KNOWLEDGE_COVERAGE_RESULTS)}

      {tab === 'corrections' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {reviewSelect}{reasonInput}
            {btn('Human Correction 기록', () => aiEvent('human_correction_recorded', { note: reason.trim() }, 'Human Correction 기록됨(자동 반영 없음)'), true)}
          </div>
          <AdminAlert tone="info" description="사람이 AI 분석을 수정한 기록 — 학습 소재이며 자동 반영은 없습니다." />
          {eventList(evByType('human_correction_recorded'), 'Human Correction 없음', '사람의 수정 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'improvements' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {reviewSelect}
            <select value={areaSel} onChange={(e) => setAreaSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {IMPROVEMENT_AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            {reasonInput}
            {btn('Improvement Candidate 생성(Evidence 필수)', () => {
              const r = needReason();
              if (!r) return;
              void act(() => createEnterpriseImprovementCandidate({ improvement_area: areaSel, description: r, ai_review_id: selReview || null, evidence: [{ type: 'manual_review', note: r }] }), 'Improvement Candidate 생성됨(≠ Applied Improvement)');
            }, true)}
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {candidateSelect}
            <select value={prioSel} onChange={(e) => setPrioSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {IMPROVEMENT_PRIORITY_RESULTS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            {btn('검토 시작', () => icReview('mark_under_review', {}, 'under_review'))}
            {btn('Review Reference 기록(Evidence 필수)', () => icReview('record_review_reference', { priority: prioSel, evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Review Reference 기록됨(적용은 사람)'), true)}
            {btn('수정 요청', () => icReview('request_revision', {}, 'revision_requested'))}
            {btn('Insufficient Data', () => icReview('mark_insufficient_data', {}, 'insufficient_data'))}
          </div>
          <AdminAlert tone="warning" description="Improvement Candidate(§7 — Rule/Prompt/Workflow/Knowledge/Validation/Review 6영역) — Evidence 없는 후보 서버 차단 · Self-Review 차단 · 종결 재결정 차단 · Candidate ≠ Applied Improvement, 최종 적용은 사람." />
          {candidateList(candidates, 'Improvement Candidate 없음', '개선 후보가 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'rulerefine' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {reviewSelect}{reasonInput}
            {btn('Rule Refinement 후보 기록(Evidence 필수)', () => aiEvent('rule_refinement_candidate_recorded', { note: reason.trim(), evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Rule 후보 기록됨(≠ 자동 Rule 변경)'), true)}
          </div>
          <AdminAlert tone="warning" description="Rule Refinement Candidate ≠ 자동 Rule 변경 — 실제 Rule 원장(0496/0512)은 무변경, 적용은 사람." />
          {eventList(evByType('rule_refinement_candidate_recorded'), 'Rule 후보 없음', 'Rule 개선 후보가 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'promptimprove' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {reviewSelect}{reasonInput}
            {btn('Prompt Improvement 후보 기록(Evidence 필수)', () => aiEvent('prompt_improvement_candidate_recorded', { note: reason.trim(), evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Prompt 후보 기록됨(≠ 자동 Prompt 변경)'), true)}
          </div>
          <AdminAlert tone="warning" description="Prompt Improvement Candidate ≠ 자동 Prompt 변경 — Prompt 버전 원장 부재(실측), 적용은 사람." />
          {eventList(evByType('prompt_improvement_candidate_recorded'), 'Prompt 후보 없음', 'Prompt 개선 후보가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'summary' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {reviewSelect}{reasonInput}
            {btn('Executive AI Summary 기록', () => aiEvent('executive_ai_summary_recorded', { note: reason.trim() }, 'Summary 기록됨(≠ AI 품질 확정)'), true)}
          </div>
          <AdminAlert tone="info" description="Executive AI Summary ≠ AI 품질 확정 — 경영진 판단 보조 자료입니다." />
          {eventList(evByType('executive_ai_summary_recorded'), 'Summary 없음', 'Executive AI Summary 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'scorecard' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {reviewSelect}{reasonInput}
            {btn('AI Scorecard 기록', () => aiEvent('executive_ai_scorecard_recorded', { fields: [...AI_SCORECARD_FIELDS], note: reason.trim() }, 'Scorecard 기록됨(≠ 모델 변경 지시)'), true)}
          </div>
          <AdminAlert tone="warning" description={`§8 필드 8종(${AI_SCORECARD_FIELDS.join(', ')}) — Scorecard ≠ 모델 변경 지시(unreliable/overconfident 우선 결정적 정렬 후보).`} />
          {eventList(evByType('executive_ai_scorecard_recorded'), 'Scorecard 없음', 'Executive AI Scorecard 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'recommendations' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {reviewSelect}
            <select value={recTypeSel} onChange={(e) => setRecTypeSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {AI_RECOMMENDATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Recommendation 기록(Evidence 필수)', () => aiEvent('ai_recommendation_recorded', { recommendation_type: recTypeSel, evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Recommendation 기록됨(≠ Decision)'), true)}
          </div>
          <AdminAlert tone="info" description="AI Recommendation ≠ Decision — 권고 23종 whitelist, Evidence 없는 Recommendation 서버 차단. 채택은 사람이 결정합니다." />
          {eventList(evByType('ai_recommendation_recorded'), 'Recommendation 없음', 'AI Recommendation 후보가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'reviewqueue' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {reviewSelect}{reasonInput}
            {btn('AI Review 요청', () => aiEvent('ai_review_requested', { note: reason.trim() }, 'AI Review 요청됨(≠ Approval)'), true)}
            {btn('Executive Review 요청', () => aiEvent('executive_review_requested', { note: reason.trim() }, 'Executive Review 요청됨(≠ Approval)'))}
            {btn('Human Oversight Review 요청', () => aiEvent('human_oversight_review_requested', { note: reason.trim() }, 'Oversight Review 요청됨(최종 개선 적용은 사람)'))}
          </div>
          <AdminAlert tone="warning" description="Review Workflow(§9 — AI/Executive/Human Oversight Review 3종 요청만) — Review ≠ Approval. 최종 AI 개선 적용은 반드시 사람이 수행합니다." />
          {eventList([...evByType('ai_review_requested'), ...evByType('executive_review_requested'), ...evByType('human_oversight_review_requested')], 'Review 요청 없음', 'AI/Executive/Oversight Review 요청이 여기에 표시됩니다.')}
          {reviewList(reviews.filter((r) => ['draft', 'candidate'].includes(r.review_status)), '대기 AI Review 없음', '0건은 검토할 것이 없음을 의미하지 않습니다.')}
        </div>
      )}
      {tab === 'oversight' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {reviewSelect}{reasonInput}
            {btn('Human Oversight 기록', () => aiEvent('human_oversight_recorded', { note: reason.trim() }, 'Oversight 기록됨(≠ 자동 개선 적용)'), true)}
          </div>
          <AdminAlert tone="info" description="Human Oversight — 사람의 감독 기록이며 자동 개선 적용이 아닙니다." />
          {eventList(evByType('human_oversight_recorded'), 'Oversight 없음', '사람의 감독 기록이 여기에 표시됩니다.')}
          {reviewList(reviews.filter((r) => r.review_status === 'review_reference'), 'Review Reference 없음', '사람이 검토를 완료한 AI Review 가 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'learning' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {reviewSelect}{reasonInput}
            {btn('AI Learning 기록(History append)', () => aiEvent('ai_learning_recorded', { note: reason.trim() }, 'AI Learning 기록됨(≠ 자동 모델 학습)'), true)}
          </div>
          <AdminAlert tone="info" description="AI Learning ≠ 자동 모델 학습 — 학습 소재 기록이며 모델 반영은 사람이 결정합니다." />
          {eventList(evByType('ai_learning_recorded'), 'Learning 없음', 'AI 학습 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'links' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {reviewSelect}{reasonInput}
            {btn('Knowledge Link(0553 실존 검증)', () => aiEvent('knowledge_reference_linked', { note: reason.trim() }, 'Knowledge Link 기록됨(≠ 사실 확정)'), true)}
            {btn('Governance Link(0551)', () => aiEvent('governance_reference_linked', { note: reason.trim() }, 'Governance Link 기록됨(≠ 승인)'))}
            {btn('Decision Outcome Link(0514)', () => aiEvent('decision_outcome_linked', { note: reason.trim() }, 'Outcome Link 기록됨(≠ Proven Causality)'))}
            {btn('Commitment Link(0520)', () => aiEvent('commitment_reference_linked', { note: reason.trim() }, 'Commitment Link 기록됨(≠ 실행 보장)'))}
          </div>
          <AdminAlert tone="info" description="Reference Link — ID 지정 시 실존 검증(0514/0520/0551/0553). Link ≠ 확정/승인/보장." />
          {eventList([...evByType('knowledge_reference_linked'), ...evByType('governance_reference_linked'), ...evByType('decision_outcome_linked'), ...evByType('commitment_reference_linked')], 'Reference Link 없음', '참조 연결 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'flow' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Autonomous 흐름 관측 — 단계별 기록 존재 여부만 표시합니다(자동 진행 아님)." />
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
          <AdminAlert tone="info" description={`AI 이벤트 31종 통합 Audit — 총 ${NUM(num('ai_events', 'total'))}건. 자동 모델/Prompt/Rule 변경 이벤트 생성 금지.`} />
          {eventList(audit, 'Audit 이벤트 없음', '모든 Autonomous Intelligence 활동이 여기에 기록됩니다.')}
        </div>
      )}

      {tab === 'support' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description={`분류 6종(fully/partially/advisory_only/human_review_only/unavailable/insufficient_data) — 컴포넌트 ${ENTERPRISE_AUTONOMOUS_COMPONENTS.length}종 · 매트릭스 ${ENTERPRISE_AUTONOMOUS_SUPPORT_MATRIX.length}항목. unavailable 은 전부 automatic_*(자동 모델/Prompt/Rule/Code/DB 변경 없음).`} />
          <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
            {ENTERPRISE_AUTONOMOUS_SUPPORT_MATRIX.map((e) => (
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
