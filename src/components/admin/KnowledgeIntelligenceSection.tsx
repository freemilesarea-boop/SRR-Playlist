/**
 * KnowledgeIntelligenceSection — Enterprise Knowledge Intelligence,
 * Organizational Memory & Continuous Learning Center (Phase AI-OPS-49).
 *
 * Enterprise Vision→Enterprise Knowledge→Knowledge Source→Knowledge
 * Validation→Evidence→Knowledge Relationship→Organizational Memory→
 * Experience Pattern→Lesson Learned→Knowledge Quality→Continuous Learning→
 * Executive Knowledge Review→Knowledge Audit.
 * Knowledge Candidate ≠ Verified Knowledge · Lesson ≠ Universal Truth ·
 * Best Practice ≠ Mandatory Practice · Pattern ≠ Causality · Review ≠ Approval.
 * 자동 사실 확정/정책 승격/법적 판단/Compliance 확정 없음.
 * (기존 KnowledgeGraphSection(0513)/AiMemoryKnowledgeSection(0498)/
 *  KnowledgeEvolutionSection(0531) 과 별도 신규 계층)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, BookOpen, ClipboardList, Gauge, GitBranch, Grid3x3,
  History, Inbox, Layers, Lightbulb, Lock, Network, RefreshCw,
  Search, Shield, Users,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchEnterpriseKnowledgeSummary, fetchEnterpriseKnowledgeMemories,
  createEnterpriseKnowledgeMemory, reviewEnterpriseKnowledgeMemory,
  createEnterpriseKnowledgeReview, reviewEnterpriseKnowledgeReview,
  fetchEnterpriseKnowledgeReviews, recordEnterpriseKnowledgeEvent,
  fetchEnterpriseKnowledgeAudit,
  type EnterpriseKnowledgeSummary, type EnterpriseKnowledgeMemoryRow,
  type EnterpriseKnowledgeReviewRow, type EnterpriseKnowledgeEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  KNOWLEDGE_CATEGORIES, KNOWLEDGE_QUALITY_RESULTS, EVIDENCE_COVERAGE_RESULTS,
  KNOWLEDGE_RELATIONSHIP_TYPES, KNOWLEDGE_RELATIONSHIP_RESULTS,
  KNOWLEDGE_VALIDATION_RESULTS, EXPERIENCE_PATTERN_RESULTS, KNOWLEDGE_FRESHNESS_RESULTS,
  KNOWLEDGE_RECOMMENDATION_TYPES, KNOWLEDGE_SCORECARD_FIELDS, buildKnowledgeTimeline,
  ENTERPRISE_KNOWLEDGE_COMPONENTS, ENTERPRISE_KNOWLEDGE_SUPPORT_MATRIX,
} from '@/lib/enterpriseKnowledge';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'memories' | 'sources' | 'validation' | 'evidence' | 'coverage' | 'graph'
  | 'orgmemory' | 'patterns' | 'lessons' | 'bestpractices' | 'similar' | 'quality' | 'freshness'
  | 'learning' | 'summary' | 'scorecard' | 'recommendations' | 'reviewqueue' | 'reviewed'
  | 'links' | 'flow' | 'audit' | 'support' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Knowledge Overview', icon: Layers },
  { key: 'memories', label: 'Knowledge Memories', icon: BookOpen },
  { key: 'sources', label: 'Knowledge Sources', icon: ClipboardList },
  { key: 'validation', label: 'Knowledge Validation', icon: Shield },
  { key: 'evidence', label: 'Evidence Chain', icon: Search },
  { key: 'coverage', label: 'Evidence Coverage', icon: Gauge },
  { key: 'graph', label: 'Knowledge Graph', icon: Network },
  { key: 'orgmemory', label: 'Organizational Memory', icon: History },
  { key: 'patterns', label: 'Pattern Detection', icon: Activity },
  { key: 'lessons', label: 'Lesson Learned', icon: Lightbulb },
  { key: 'bestpractices', label: 'Best Practices', icon: Lightbulb },
  { key: 'similar', label: 'Similar Cases', icon: Search },
  { key: 'quality', label: 'Knowledge Quality', icon: Gauge },
  { key: 'freshness', label: 'Knowledge Freshness', icon: Activity },
  { key: 'learning', label: 'Continuous Learning', icon: BookOpen },
  { key: 'summary', label: 'Executive Summaries', icon: ClipboardList },
  { key: 'scorecard', label: 'Executive Knowledge Scorecard', icon: Grid3x3 },
  { key: 'recommendations', label: 'Knowledge Recommendations', icon: Lightbulb },
  { key: 'reviewqueue', label: 'Review Queue', icon: Inbox },
  { key: 'reviewed', label: 'Review References', icon: Users },
  { key: 'links', label: 'Reference Links', icon: GitBranch },
  { key: 'flow', label: 'Flow Timeline', icon: History },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
  { key: 'limitations', label: 'Known Limitations', icon: ClipboardList },
];

const KNOWN_LIMITATIONS = [
  '자동 사실 확정/정책 승격/법적 판단/Compliance 확정/Strategy·Governance·조직·KPI·Budget 변경/Merge/Deploy/Production 변경 없음 — 모든 반환 flag(fact_confirmed/policy_promoted 등) 항상 false',
  'Knowledge Candidate ≠ Verified Knowledge — 생성은 draft, verified_reference 는 사람의 검증 기록(Self-Verification 차단 + Evidence 필수), archived 재결정 차단',
  'Lesson Learned ≠ Universal Truth · Best Practice ≠ Mandatory Practice — Evidence 없는 Lesson/Best Practice/Recommendation 서버 차단',
  'Similar Case ≠ Same Outcome · Pattern ≠ Causality · Knowledge Graph ≠ Proven Relationship · Evidence ≠ Absolute Truth',
  'Knowledge Review Reference 는 Self-Review 차단(작성자 ≠ 평가자) + Evidence 필수 — Review ≠ Approval, 채택·정책 반영은 사람',
  '실제 Wiki/문서 관리/외부 지식 베이스/검색 인덱스/회의록/고객 피드백 피드 부재(실측) — insufficient_data 유지',
  '기존 지식 원장은 ai_knowledge_entities/relationships(0513)/ai_org_memory(0531)/ai_organizational_learnings(0515) — 참조만 하며 원본 무변경',
  'adminApi 의 KnowledgeEventRow/fetchKnowledgeSummary(0498 계층)와 구분을 위해 EnterpriseKnowledge* 프리픽스 사용',
  'Migration 0472~0553 production 미적용 — 운영 수치는 적용 후 축적됩니다',
  '브라우저 실측 미검증 — UI 는 코드 리뷰/타입/빌드 기준 검증만 수행했습니다',
];

export default function KnowledgeIntelligenceSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<EnterpriseKnowledgeSummary>({});
  const [memories, setMemories] = useState<EnterpriseKnowledgeMemoryRow[]>([]);
  const [reviews, setReviews] = useState<EnterpriseKnowledgeReviewRow[]>([]);
  const [audit, setAudit] = useState<EnterpriseKnowledgeEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [selMemory, setSelMemory] = useState('');
  const [selReview, setSelReview] = useState('');
  const [catSel, setCatSel] = useState<string>('engineering');
  const [relTypeSel, setRelTypeSel] = useState<string>('related');
  const [recTypeSel, setRecTypeSel] = useState<string>('gather_more_evidence_candidate');
  const [resultSel, setResultSel] = useState<string>('insufficient_data');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, m, r, a] = await Promise.all([
        fetchEnterpriseKnowledgeSummary(), fetchEnterpriseKnowledgeMemories(null, null, 200),
        fetchEnterpriseKnowledgeReviews(null, 200), fetchEnterpriseKnowledgeAudit(200),
      ]);
      setSummary(s); setMemories(m); setReviews(r); setAudit(a);
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
  const memReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selMemory) { if (!selMemory) toast.error('Knowledge Memory 선택 필수'); return; }
    void act(() => reviewEnterpriseKnowledgeMemory(selMemory, action, r, payload), ok);
  };
  const krReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selReview) { if (!selReview) toast.error('Knowledge Review 선택 필수'); return; }
    void act(() => reviewEnterpriseKnowledgeReview(selReview, action, r, payload), ok);
  };
  const knEvent = (kind: string, payload: Record<string, unknown>, ok: string, ids: { mem?: boolean; review?: boolean } = { mem: true }) => {
    const r = needReason();
    if (!r) return;
    void act(() => recordEnterpriseKnowledgeEvent(kind, r, payload, ids.mem ? (selMemory || null) : null, ids.review ? (selReview || null) : null), ok);
  };

  const obj = useCallback((k: string): Record<string, unknown> => (typeof summary[k] === 'object' && summary[k] !== null && !Array.isArray(summary[k]) ? summary[k] as Record<string, unknown> : {}), [summary]);
  const num = useCallback((k: string, sub: string): number | null => {
    const v = obj(k)[sub];
    return typeof v === 'number' ? v : null;
  }, [obj]);

  const flowTimeline = useMemo(() => buildKnowledgeTimeline({ present: {
    enterprise_vision: (num('knowledge_actuals', 'governance_decisions_0551') ?? 0) > 0,
    enterprise_knowledge: (num('memories', 'total') ?? 0) > 0,
    knowledge_source: (num('knowledge_events', 'sources') ?? 0) > 0,
    knowledge_validation: (num('knowledge_events', 'validations') ?? 0) > 0,
    evidence: (num('knowledge_events', 'evidence_records') ?? 0) + (num('knowledge_events', 'coverage_reviews') ?? 0) > 0,
    knowledge_relationship: (num('knowledge_events', 'relationships') ?? 0) + (num('knowledge_events', 'graph_reviews') ?? 0) > 0,
    organizational_memory: (num('knowledge_events', 'org_memories') ?? 0) > 0,
    experience_pattern: (num('knowledge_events', 'pattern_reviews') ?? 0) > 0,
    lesson_learned: (num('knowledge_events', 'lessons') ?? 0) + (num('knowledge_events', 'best_practices') ?? 0) > 0,
    knowledge_quality: (num('knowledge_events', 'quality_reviews') ?? 0) + (num('knowledge_events', 'freshness_reviews') ?? 0) > 0,
    continuous_learning: (num('knowledge_events', 'learnings') ?? 0) > 0,
    executive_knowledge_review: (num('knowledge_events', 'knowledge_review_requests') ?? 0) + (num('knowledge_events', 'executive_review_requests') ?? 0) + (num('knowledge_events', 'evidence_review_requests') ?? 0) + (num('knowledge_events', 'review_references') ?? 0) > 0,
  } }), [num]);

  if (loading) return <AdminCard title="Knowledge Intelligence & Organizational Memory Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Knowledge Intelligence & Organizational Memory Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const memSelect = (
    <select value={selMemory} onChange={(e) => setSelMemory(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Knowledge Memory 선택</option>
      {memories.map((m) => <option key={m.id} value={m.id}>{m.knowledge_code} · {m.knowledge_status}</option>)}
    </select>
  );
  const reviewSelect = (
    <select value={selReview} onChange={(e) => setSelReview(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Knowledge Review 선택</option>
      {reviews.map((r) => <option key={r.id} value={r.id}>{r.review_code} · {r.review_status}</option>)}
    </select>
  );
  const reasonInput = <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button disabled={busy} onClick={onClick} className={primary ? 'rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50' : 'rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50'}>{label}</button>
  );
  const tone = (s: string) => (s.includes('excellent') || s.includes('high_quality') || s.includes('strongly_supported') || s.includes('highly_connected') || s.includes('validated_candidate') || s.includes('fresh_candidate') || s.includes('verified_reference') || s.includes('review_reference_recorded') || s.includes('no_material') ? 'success' as const : s.includes('low_quality') || s.includes('unsupported') || s.includes('validation_failed') || s.includes('stale') || s.includes('contradicts') || s === 'unavailable' ? 'danger' as const : 'warning' as const);
  const evByType = (t: string) => audit.filter((e) => e.event_type === t);
  const eventList = (rows: EnterpriseKnowledgeEventRow[], emptyTitle: string, emptyDesc: string) => (
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
  const memList = (list: EnterpriseKnowledgeMemoryRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((m) => (
          <div key={m.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(m.knowledge_status)}>{m.knowledge_status}</AdminBadge>
            <AdminBadge tone={tone(m.quality_status)}>{m.quality_status}</AdminBadge>
            <AdminBadge tone={tone(m.evidence_coverage_status)}>{m.evidence_coverage_status}</AdminBadge>
            <span className="ml-2 font-bold">{m.knowledge_code}</span>
            <span className="ml-2 text-muted-foreground">{m.knowledge_category} · {m.knowledge_title} · evidence {Array.isArray(m.evidence) ? m.evidence.length : 0}건 · relations {Array.isArray(m.knowledge_graph) ? m.knowledge_graph.length : 0}건</span>
          </div>
        ))}
      </div>
    )
  );
  const reviewList = (list: EnterpriseKnowledgeReviewRow[], emptyTitle: string, emptyDesc: string) => (
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
  const resultEventTab = (kind: string, title: string, note: string, results: readonly string[], extraPayload: Record<string, unknown> = {}, ids: { mem?: boolean; review?: boolean } = { mem: true }) => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        {ids.mem ? memSelect : null}{ids.review ? reviewSelect : null}
        <select value={results.includes(resultSel) ? resultSel : results[0]} onChange={(e) => setResultSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
          {results.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {reasonInput}
        {btn(`${title} 기록`, () => knEvent(kind, { result: results.includes(resultSel) ? resultSel : results[0], ...extraPayload }, `${title} 기록됨`, ids), true)}
      </div>
      <AdminAlert tone="info" description={note} />
      {eventList(evByType(kind), `${title} 없음`, '사람 검토 기록이 여기에 표시됩니다.')}
    </div>
  );

  return (
    <AdminCard
      title="Knowledge Intelligence & Organizational Memory Center"
      subtitle="Enterprise Knowledge→Source→Validation→Evidence→Relationship→Organizational Memory→Pattern→Lesson→Quality→Continuous Learning→Executive Review — 지식 채택과 정책 반영은 반드시 사람"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 Enterprise 의 경험·실행 결과·의사결정·Incident·성과·실패 사례를 장기 Organizational Memory 와 Knowledge Asset 으로 축적하는 Knowledge Intelligence 계층입니다. AI 는 Knowledge Candidate 생성·Relationship/Graph 구축·Organizational Memory·Lesson Learned·Best Practice 후보·Similar Case 검색·Pattern Detection·Quality/Freshness/Evidence Coverage 계산·Continuous Learning 기록·Executive Summary/Scorecard·Recommendation·Review 요청까지만 수행하며, 자동 사실 확정·자동 정책 승격·자동 법적 판단·자동 Compliance 확정·자동 Strategy/Governance/조직/KPI/Budget 변경·자동 Merge/Deploy/Production 변경은 수행하지 않습니다. Knowledge Candidate ≠ Verified Knowledge, Lesson Learned ≠ Universal Truth, Best Practice ≠ Mandatory Practice, Pattern ≠ Causality, Review ≠ Approval. AI 는 지식을 정리하고 연결하며 재사용을 지원합니다. 사람이 지식을 승인하고 정책으로 반영합니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Knowledge Memories" value={NUM(num('memories', 'total'))} />
            <Box label="Draft / Candidate / Verified / Archived" value={`${NUM(num('memories', 'draft'))} / ${NUM(num('memories', 'candidate'))} / ${NUM(num('memories', 'verified'))} / ${NUM(num('memories', 'archived'))}`} />
            <Box label="High / Low Quality Candidates" value={`${NUM(num('memories', 'high_quality'))} / ${NUM(num('memories', 'low_quality'))}`} />
            <Box label="Strongly Supported / Weak·Unsupported" value={`${NUM(num('memories', 'strongly_supported'))} / ${NUM(num('memories', 'unsupported'))}`} />
            <Box label="Knowledge Reviews" value={NUM(num('reviews', 'total'))} />
            <Box label="Requested / In Review / Reference / Revision" value={`${NUM(num('reviews', 'requested'))} / ${NUM(num('reviews', 'in_review'))} / ${NUM(num('reviews', 'reference_recorded'))} / ${NUM(num('reviews', 'revision_requested'))}`} />
            <Box label="Sources / Validations / Evidence Records" value={`${NUM(num('knowledge_events', 'sources'))} / ${NUM(num('knowledge_events', 'validations'))} / ${NUM(num('knowledge_events', 'evidence_records'))}`} />
            <Box label="Coverage / Graph Reviews" value={`${NUM(num('knowledge_events', 'coverage_reviews'))} / ${NUM(num('knowledge_events', 'graph_reviews'))}`} />
            <Box label="Relationships / Org Memories" value={`${NUM(num('knowledge_events', 'relationships'))} / ${NUM(num('knowledge_events', 'org_memories'))}`} />
            <Box label="Patterns / Lessons / Best Practices" value={`${NUM(num('knowledge_events', 'pattern_reviews'))} / ${NUM(num('knowledge_events', 'lessons'))} / ${NUM(num('knowledge_events', 'best_practices'))}`} />
            <Box label="Similar Searches / Quality / Freshness" value={`${NUM(num('knowledge_events', 'similar_searches'))} / ${NUM(num('knowledge_events', 'quality_reviews'))} / ${NUM(num('knowledge_events', 'freshness_reviews'))}`} />
            <Box label="Continuous Learnings" value={NUM(num('knowledge_events', 'learnings'))} />
            <Box label="Summaries / Scorecards / Recommendations" value={`${NUM(num('knowledge_events', 'summaries'))} / ${NUM(num('knowledge_events', 'scorecards'))} / ${NUM(num('knowledge_events', 'recommendations'))}`} />
            <Box label="Knowledge / Executive / Evidence Review 요청" value={`${NUM(num('knowledge_events', 'knowledge_review_requests'))} / ${NUM(num('knowledge_events', 'executive_review_requests'))} / ${NUM(num('knowledge_events', 'evidence_review_requests'))}`} />
            <Box label="Review References" value={NUM(num('knowledge_events', 'review_references'))} />
            <Box label="Governance / Organization Links / Learning" value={`${NUM(num('knowledge_events', 'governance_links'))} / ${NUM(num('knowledge_events', 'organization_links'))} / ${NUM(num('knowledge_events', 'learning_references'))}`} />
          </div>
          <AdminAlert tone="info" description={`knowledge_unavailable: ${Array.isArray(summary.knowledge_unavailable) ? (summary.knowledge_unavailable as unknown[]).map(String).join(', ') : '—'}. Knowledge 원천 실측 — Knowledge Entities(0513) ${NUM(num('knowledge_actuals', 'knowledge_entities_0513'))}건 · Relationships(0513) ${NUM(num('knowledge_actuals', 'knowledge_relationships_0513'))}건 · Org Memory(0531) ${NUM(num('knowledge_actuals', 'org_memory_0531'))}건 · Organizational Learnings(0515) ${NUM(num('knowledge_actuals', 'organizational_learnings_0515'))}건 · Decision Outcomes(0514) ${NUM(num('knowledge_actuals', 'decision_outcomes_0514'))}건 · Governance Decisions(0551) ${NUM(num('knowledge_actuals', 'governance_decisions_0551'))}건. 0 과 Unknown 을 혼동하지 않습니다.`} />
        </div>
      )}

      {tab === 'memories' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <select value={catSel} onChange={(e) => setCatSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {KNOWLEDGE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {reasonInput}
            {btn('Knowledge Candidate 생성(≠ 사실 확정)', () => {
              const r = needReason();
              if (!r) return;
              void act(() => createEnterpriseKnowledgeMemory({ knowledge_category: catSel, knowledge_title: r }), 'Knowledge Candidate 생성됨(draft — 자동 사실 확정 없음)');
            }, true)}
            {btn('Candidate 표시', () => memReview('mark_candidate', {}, 'candidate'))}
            {btn('Verified Reference(Self 차단·Evidence 필수)', () => memReview('record_verified_reference', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'verified_reference(사람의 검증 기록)'))}
            {btn('Archive', () => memReview('archive_reference', {}, 'archived_reference'))}
            {btn('Insufficient Data', () => memReview('mark_insufficient_data', {}, 'insufficient_data'))}
            {memSelect}
          </div>
          <AdminAlert tone="info" description="Category 16종 · 자동 사실 확정/정책 승격 계열 category 서버 차단 · archived 재결정 차단 · Verified Reference 는 Self-Verification 차단 + Evidence 필수." />
          {memList(memories, 'Knowledge Memory 없음', '핵심 질문 예: 어떤 경험이 가장 중요한 Knowledge 인가? 어떤 실패가 반복되는가? — 전부 Candidate 분석.')}
        </div>
      )}

      {tab === 'sources' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {memSelect}{reasonInput}
            {btn('Knowledge Source 기록', () => knEvent('knowledge_source_recorded', { note: reason.trim() }, 'Source 기록됨(≠ 출처 신뢰 확정)'), true)}
          </div>
          <AdminAlert tone="info" description="Knowledge Source — 출처 기록이며 출처 신뢰 확정이 아닙니다." />
          {eventList(evByType('knowledge_source_recorded'), 'Source 없음', '지식 출처 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'validation' && resultEventTab('knowledge_validation_reviewed', 'Knowledge Validation 검토', 'Validation Candidate ≠ 사실 확정 — 검증 시도 결과의 관측 기록입니다.', KNOWLEDGE_VALIDATION_RESULTS)}
      {tab === 'evidence' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {memSelect}{reasonInput}
            {btn('Evidence 기록(Chain append)', () => knEvent('evidence_recorded', { note: reason.trim() }, 'Evidence 기록됨(≠ Absolute Truth)'), true)}
          </div>
          <AdminAlert tone="warning" description="Evidence ≠ Absolute Truth — Evidence Chain 은 evidence[] append 로 축적되며 부족하면 부족한 대로 표시합니다." />
          {eventList(evByType('evidence_recorded'), 'Evidence 기록 없음', '근거 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'coverage' && resultEventTab('evidence_coverage_reviewed', 'Evidence Coverage 검토', 'Coverage 5평가(§6 — Source Count/Evidence Strength/Freshness/Validation/Consistency) — Coverage Candidate ≠ 근거 충분 확정.', EVIDENCE_COVERAGE_RESULTS)}

      {tab === 'graph' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {memSelect}
            <select value={relTypeSel} onChange={(e) => setRelTypeSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {KNOWLEDGE_RELATIONSHIP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Relationship 기록', () => knEvent('knowledge_relationship_recorded', { relationship_type: relTypeSel, note: reason.trim() }, 'Relationship 기록됨(≠ Proven Relationship)'), true)}
          </div>
          <AdminAlert tone="info" description="Relationship 6종(§7 — related/depends_on/derived_from/similar_to/contradicts/reinforces) — Knowledge Graph ≠ Proven Relationship. 결과 검토는 아래에 기록합니다." />
          {resultEventTab('knowledge_graph_reviewed', 'Knowledge Graph 검토', 'Graph Candidate ≠ 관계 확정 — 연결성 관측 후보입니다.', KNOWLEDGE_RELATIONSHIP_RESULTS)}
          {eventList(evByType('knowledge_relationship_recorded'), 'Relationship 없음', '지식 관계 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'orgmemory' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {memSelect}{reasonInput}
            {btn('Organizational Memory 기록', () => knEvent('organizational_memory_recorded', { note: reason.trim() }, 'Organizational Memory 기록됨(≠ 공식 기록 확정)'), true)}
          </div>
          <AdminAlert tone="info" description="Organizational Memory — 장기 축적용 관측 기록이며 공식 기록 확정이 아닙니다." />
          {eventList(evByType('organizational_memory_recorded'), 'Organizational Memory 없음', '조직 기억 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'patterns' && resultEventTab('experience_pattern_reviewed', 'Experience Pattern 검토', 'Pattern ≠ Causality — 반복 패턴 후보이며 인과 확정이 아닙니다.', EXPERIENCE_PATTERN_RESULTS)}
      {tab === 'lessons' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {memSelect}{reasonInput}
            {btn('Lesson Learned 기록(Evidence 필수)', () => knEvent('lesson_learned_recorded', { note: reason.trim(), evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Lesson 기록됨(≠ Universal Truth)'), true)}
          </div>
          <AdminAlert tone="warning" description="Lesson Learned ≠ Universal Truth — Evidence 없는 Lesson 서버 차단, 일반화 여부는 사람이 판단합니다." />
          {eventList(evByType('lesson_learned_recorded'), 'Lesson 없음', '교훈 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'bestpractices' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {memSelect}{reasonInput}
            {btn('Best Practice 후보 기록(Evidence 필수)', () => knEvent('best_practice_candidate_recorded', { note: reason.trim(), evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Best Practice 후보 기록됨(≠ Mandatory Practice)'), true)}
          </div>
          <AdminAlert tone="warning" description="Best Practice ≠ Mandatory Practice — Evidence 없는 후보 서버 차단, 의무화는 사람이 결정합니다." />
          {eventList(evByType('best_practice_candidate_recorded'), 'Best Practice 후보 없음', '모범 사례 후보가 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'similar' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {memSelect}{reasonInput}
            {btn('Similar Case 검색 기록', () => knEvent('similar_case_search_recorded', { note: reason.trim() }, 'Similar Case 검색 기록됨(≠ Same Outcome)'), true)}
          </div>
          <AdminAlert tone="info" description="Similar Case ≠ Same Outcome — 유사 사례는 참조용이며 같은 결과를 보장하지 않습니다." />
          {eventList(evByType('similar_case_search_recorded'), 'Similar Case 검색 없음', '유사 사례 검색 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'quality' && resultEventTab('knowledge_quality_reviewed', 'Knowledge Quality 검토', 'Quality 5단계(§5) — Quality Candidate ≠ Verified Knowledge.', KNOWLEDGE_QUALITY_RESULTS)}
      {tab === 'freshness' && resultEventTab('knowledge_freshness_reviewed', 'Knowledge Freshness 검토', 'Freshness ≠ 정확성 판단 — 오래된 지식은 신뢰도 재검토 후보입니다.', KNOWLEDGE_FRESHNESS_RESULTS)}
      {tab === 'learning' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {memSelect}{reasonInput}
            {btn('Continuous Learning 기록(History append)', () => knEvent('continuous_learning_recorded', { note: reason.trim() }, 'Learning 기록됨(≠ 자동 정책 반영)'), true)}
          </div>
          <AdminAlert tone="info" description="Continuous Learning — Learning History 로 축적되며 자동 정책 반영은 없습니다." />
          {eventList(evByType('continuous_learning_recorded'), 'Learning 없음', '지속 학습 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'summary' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {memSelect}{reasonInput}
            {btn('Executive Knowledge Summary 기록', () => knEvent('executive_knowledge_summary_recorded', { note: reason.trim() }, 'Summary 기록됨(≠ 지식 확정)'), true)}
          </div>
          <AdminAlert tone="info" description="Executive Summary ≠ 지식 확정 — 경영진 판단 보조 자료입니다." />
          {eventList(evByType('executive_knowledge_summary_recorded'), 'Summary 없음', 'Executive Knowledge Summary 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'scorecard' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {memSelect}{reasonInput}
            {btn('Knowledge Scorecard 기록', () => knEvent('executive_knowledge_scorecard_recorded', { fields: [...KNOWLEDGE_SCORECARD_FIELDS], note: reason.trim() }, 'Scorecard 기록됨(≠ 사실 확정)'), true)}
          </div>
          <AdminAlert tone="warning" description={`§8 필드 8종(${KNOWLEDGE_SCORECARD_FIELDS.join(', ')}) — Scorecard ≠ 사실 확정(low quality/unsupported 우선 결정적 정렬 후보).`} />
          {eventList(evByType('executive_knowledge_scorecard_recorded'), 'Scorecard 없음', 'Executive Knowledge Scorecard 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'recommendations' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {memSelect}
            <select value={recTypeSel} onChange={(e) => setRecTypeSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {KNOWLEDGE_RECOMMENDATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Recommendation 기록(Evidence 필수)', () => knEvent('knowledge_recommendation_recorded', { recommendation_type: recTypeSel, evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Recommendation 기록됨(≠ Decision)'), true)}
          </div>
          <AdminAlert tone="info" description="Knowledge Recommendation ≠ Decision — 권고 23종 whitelist, Evidence 없는 Recommendation 서버 차단. 채택은 사람이 결정합니다." />
          {eventList(evByType('knowledge_recommendation_recorded'), 'Recommendation 없음', 'Knowledge Recommendation 후보가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'reviewqueue' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {memSelect}{reasonInput}
            {btn('Knowledge Review 요청', () => {
              const r = needReason();
              if (!r || !selMemory) { if (!selMemory) toast.error('Knowledge Memory 선택 필수'); return; }
              void act(() => createEnterpriseKnowledgeReview({ knowledge_memory_id: selMemory, review_type: 'knowledge_review', review_summary: r }), 'Knowledge Review 요청됨(≠ Approval)');
            }, true)}
            {btn('Executive Review 요청', () => {
              const r = needReason();
              if (!r || !selMemory) { if (!selMemory) toast.error('Knowledge Memory 선택 필수'); return; }
              void act(() => createEnterpriseKnowledgeReview({ knowledge_memory_id: selMemory, review_type: 'executive_review', review_summary: r }), 'Executive Review 요청됨(≠ Approval)');
            })}
            {btn('Evidence Review 요청', () => {
              const r = needReason();
              if (!r || !selMemory) { if (!selMemory) toast.error('Knowledge Memory 선택 필수'); return; }
              void act(() => createEnterpriseKnowledgeReview({ knowledge_memory_id: selMemory, review_type: 'evidence_review', review_summary: r }), 'Evidence Review 요청됨(≠ Approval)');
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {reviewSelect}
            {btn('검토 시작', () => krReview('mark_in_review', {}, 'in_review'))}
            {btn('Review Reference 기록(Evidence 필수)', () => krReview('record_review_reference', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Review Reference 기록됨(≠ Approval)'), true)}
            {btn('수정 요청', () => krReview('request_revision', {}, 'revision_requested'))}
            {btn('Insufficient Data', () => krReview('mark_insufficient_data', {}, 'insufficient_data'))}
          </div>
          <AdminAlert tone="warning" description="Knowledge Review(§9 — knowledge/executive/evidence 3종 요청만) — Self-Review 서버 차단(작성자 ≠ 평가자) · Evidence 없는 Review Reference 차단 · 종결 재결정 차단 · Review ≠ Approval. 지식 채택과 정책 반영은 반드시 사람이 수행합니다." />
          {reviewList(reviews.filter((r) => ['requested', 'in_review', 'revision_requested'].includes(r.review_status)), '대기 Review 없음', '0건은 검토할 것이 없음을 의미하지 않습니다.')}
        </div>
      )}
      {tab === 'reviewed' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Review Reference — 사람이 기록한 검토 참조이며 승인/정책 반영이 아닙니다." />
          {reviewList(reviews.filter((r) => r.review_status === 'review_reference_recorded'), 'Review Reference 없음', '사람이 검토를 완료한 기록이 여기에 표시됩니다.')}
          {eventList(evByType('knowledge_review_reference_recorded'), 'Reference 이벤트 없음', 'Review Reference 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'links' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {memSelect}{reasonInput}
            {btn('Governance Link(0551 실존 검증)', () => knEvent('governance_reference_linked', { note: reason.trim() }, 'Governance Link 기록됨(≠ 승인)'), true)}
            {btn('Value Link(0549)', () => knEvent('value_reference_linked', { note: reason.trim() }, 'Value Link 기록됨'))}
            {btn('Program Link(0547)', () => knEvent('program_reference_linked', { note: reason.trim() }, 'Program Link 기록됨'))}
            {btn('Organization Link(0552)', () => knEvent('organization_reference_linked', { note: reason.trim() }, 'Organization Link 기록됨(≠ 조직 변경)'))}
            {btn('Learning Reference(0515)', () => knEvent('learning_reference_recorded', { note: reason.trim() }, 'Learning Reference 기록됨(≠ 정책 승격)'))}
          </div>
          <AdminAlert tone="info" description="Reference Link — ID 지정 시 실존 검증(0515/0547/0549/0551/0552). Link ≠ 승인/확정/정책 반영." />
          {eventList([...evByType('governance_reference_linked'), ...evByType('value_reference_linked'), ...evByType('program_reference_linked'), ...evByType('organization_reference_linked'), ...evByType('learning_reference_recorded')], 'Reference Link 없음', '참조 연결 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'flow' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Knowledge 흐름 관측 — 단계별 기록 존재 여부만 표시합니다(자동 진행 아님)." />
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
          <AdminAlert tone="info" description={`Knowledge 이벤트 31종 통합 Audit — 총 ${NUM(num('knowledge_events', 'total'))}건. 자동 사실 확정 이벤트 생성 금지.`} />
          {eventList(audit, 'Audit 이벤트 없음', '모든 Knowledge Intelligence 활동이 여기에 기록됩니다.')}
        </div>
      )}

      {tab === 'support' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description={`분류 6종(fully/partially/advisory_only/human_review_only/unavailable/insufficient_data) — 컴포넌트 ${ENTERPRISE_KNOWLEDGE_COMPONENTS.length}종 · 매트릭스 ${ENTERPRISE_KNOWLEDGE_SUPPORT_MATRIX.length}항목. unavailable 은 전부 automatic_*(자동 사실 확정/정책 승격 없음).`} />
          <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
            {ENTERPRISE_KNOWLEDGE_SUPPORT_MATRIX.map((e) => (
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
