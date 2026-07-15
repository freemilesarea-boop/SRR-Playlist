/**
 * KnowledgeEvolutionSection — Enterprise Knowledge Evolution, Organizational Memory &
 * Continuous Intelligence Center (Phase AI-OPS-28).
 *
 * Enterprise→Experience→Knowledge→Learning→Organizational Memory→Knowledge Evolution→Executive Knowledge Advisory.
 * Best Practice 자동 등록/Knowledge 자동 삭제/정책·전략·조직 규칙 자동 변경 없음 ·
 * Knowledge ≠ Truth · Learning ≠ Correctness · Best Practice ≠ Universal Rule.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Award, BadgeCheck, Brain, Gauge, GitBranch, Grid3x3, History, Hourglass,
  Layers, Lightbulb, Lock, RefreshCw, Repeat, Scale, ScrollText,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchKnowledgeSummary, createOrgMemory, reviewOrgMemory, reviseOrgMemory,
  fetchOrgMemories, recordKnowledgeGovernance, fetchKnowledgeAudit,
  type KnowledgeSummary, type OrgMemoryRow, type KnowledgeEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  evaluateKnowledgeConfidence, analyzeKnowledgeAging, assessBestPracticeCandidates,
  traceDecisionMemory, analyzeLearningPatterns, buildKnowledgeGraph,
  buildKnowledgeBriefing, buildKnowledgeRecommendation, buildKnowledgeCockpit,
  LEARNING_PATTERN_KINDS, KNOWLEDGE_SUPPORT,
} from '@/lib/knowledgeEvolution';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const MEMORY_CREATE_KINDS = ['decision', 'experience', 'lesson_learned', 'best_practice_candidate'] as const;

type Tab = 'cockpit' | 'dashboard' | 'memory' | 'evolution' | 'bestpractice' | 'decisionmemory'
  | 'confidence' | 'aging' | 'patterns' | 'graph' | 'briefing' | 'recommendations'
  | 'humanreviews' | 'external' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'cockpit', label: 'Knowledge Cockpit', icon: Layers },
  { key: 'dashboard', label: 'Executive Knowledge Dashboard', icon: Gauge },
  { key: 'memory', label: 'Organizational Memory', icon: Brain },
  { key: 'evolution', label: 'Knowledge Evolution', icon: History },
  { key: 'bestpractice', label: 'Best Practice Candidates', icon: Award },
  { key: 'decisionmemory', label: 'Decision Memory', icon: Scale },
  { key: 'confidence', label: 'Knowledge Confidence', icon: BadgeCheck },
  { key: 'aging', label: 'Knowledge Aging', icon: Hourglass },
  { key: 'patterns', label: 'Learning Patterns', icon: Repeat },
  { key: 'graph', label: 'Knowledge Graph', icon: GitBranch },
  { key: 'briefing', label: 'Executive Knowledge Briefing', icon: ScrollText },
  { key: 'recommendations', label: 'Knowledge Recommendations', icon: Lightbulb },
  { key: 'humanreviews', label: 'Human Reviews', icon: Scale },
  { key: 'external', label: 'External References', icon: ScrollText },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

export default function KnowledgeEvolutionSection() {
  const [tab, setTab] = useState<Tab>('cockpit');
  const [summary, setSummary] = useState<KnowledgeSummary>({});
  const [memories, setMemories] = useState<OrgMemoryRow[]>([]);
  const [audit, setAudit] = useState<KnowledgeEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, me, au] = await Promise.all([fetchKnowledgeSummary(), fetchOrgMemories(null, 100), fetchKnowledgeAudit(150)]);
      setSummary(s); setMemories(me); setAudit(au);
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

  const actuals = useMemo(() => (typeof summary.knowledge_actuals === 'object' && summary.knowledge_actuals !== null && !Array.isArray(summary.knowledge_actuals) ? summary.knowledge_actuals as Record<string, unknown> : {}), [summary]);
  const anum = useCallback((k: string): number | null => (typeof actuals[k] === 'number' ? actuals[k] as number : null), [actuals]);

  const aging = useMemo(() => analyzeKnowledgeAging(memories.map((m) => ({ code: m.memory_code, updatedAt: new Date(m.updated_at), status: m.memory_status })), now), [memories, now]);

  const bestPractices = useMemo(() => assessBestPracticeCandidates(memories.filter((m) => m.memory_kind === 'best_practice_candidate').map((m) => ({
    code: m.memory_code, domain: 'operational', evidenceCount: (m.evidence ?? []).length, status: m.memory_status,   // 도메인 세분류 원본 없음 — operational 참조 표기
  }))), [memories]);

  const decisionChains = useMemo(() => traceDecisionMemory(memories.filter((m) => m.memory_kind === 'decision').map((m) => ({
    decision: m.memory_code,
    hasReason: !!m.content?.trim(),
    hasEvidence: (m.evidence ?? []).length > 0,
    hasOutcome: (m.linked_decision_ids ?? []).length > 0,
    hasLearning: (m.linked_memory_ids ?? []).length > 0,
  }))), [memories]);

  const confidences = useMemo(() => memories.map((m) => ({
    m, c: evaluateKnowledgeConfidence({ evidenceCount: (m.evidence ?? []).length, humanVerified: m.confidence_reference === 'verified' }),
  })), [memories]);

  const patterns = useMemo(() => analyzeLearningPatterns(LEARNING_PATTERN_KINDS.map((kind) => {
    const noted = audit.filter((e) => e.event_type === 'learning_pattern_analyzed' && (e.detail ?? '').includes(kind)).length;
    return { kind, occurrences: noted, evidence: noted > 0 ? ['learning_pattern_analyzed 기록 실측'] : [] };
  })), [audit]);

  const graph = useMemo(() => buildKnowledgeGraph(memories.map((m) => ({
    id: m.id,
    stage: m.memory_kind === 'experience' || m.memory_kind === 'retrospective' ? 'experience'
      : m.memory_kind === 'decision' ? 'decision'
      : m.memory_kind === 'lesson_learned' ? 'learning' : 'knowledge',
    label: m.memory_code,
    parentId: (m.linked_memory_ids ?? [])[0] ?? null,
  }))), [memories]);

  const briefing = useMemo(() => buildKnowledgeBriefing({
    periodKind: 'weekly',
    newKnowledge: memories.slice(0, 5).map((m) => `${m.memory_code}(${m.memory_kind}) ${m.memory_status}`),
    changedKnowledge: memories.filter((m) => m.revision_count > 0).slice(0, 5).map((m) => `${m.memory_code} rev${m.revision_count}(사람 승인)`),
    bestPracticeCandidates: bestPractices.rows.filter((r) => r.verdict === 'promotable_candidate').map((r) => r.code),
    agingKnowledge: aging.rows.filter((r) => r.aging === 'needs_review' || r.aging === 'candidate_archive').slice(0, 5).map((r) => `${r.code}(${r.aging})`),
    recommendations: [],
  }), [memories, bestPractices, aging]);

  const autoRecs = useMemo(() => {
    const out: { type: string; reason: string }[] = [];
    const push = (r: ReturnType<typeof buildKnowledgeRecommendation>) => { if (!('rejected' in r)) out.push({ type: r.type, reason: r.reason }); };
    if (!memories.length) push(buildKnowledgeRecommendation({ type: 'review_knowledge', reason: 'Organizational Memory 비어 있음 — 사람 기록 필요(자동 생성 불가)', evidence: ['memory:0'], confidence: null, assumptions: [] }));
    const unverified = confidences.filter(({ c }) => c.confidence === 'knowledge_unverified').length;
    if (unverified > 0) push(buildKnowledgeRecommendation({ type: 'validate_evidence', reason: `Evidence 없는 Memory ${unverified}건(knowledge_unverified)`, evidence: [`unverified:${unverified}`], confidence: null, assumptions: [] }));
    const promotable = bestPractices.rows.filter((r) => r.verdict === 'promotable_candidate').length;
    if (promotable > 0) push(buildKnowledgeRecommendation({ type: 'promote_best_practice_candidate', reason: `승격 검토 가능 Best Practice 후보 ${promotable}건(자동 등록 아님 — 사람 승인 필요)`, evidence: ['bp_candidates'], confidence: null, assumptions: [] }));
    const old = aging.rows.filter((r) => r.aging === 'needs_review' || r.aging === 'candidate_archive').length;
    if (old > 0) push(buildKnowledgeRecommendation({ type: 'review_aging_knowledge', reason: `검토 필요/보관 후보 지식 ${old}건(삭제 아님)`, evidence: ['aging 실측'], confidence: null, assumptions: [] }));
    if (patterns.patterns.every((p) => p.verdict !== 'pattern_candidate')) push(buildKnowledgeRecommendation({ type: 'gather_more_evidence', reason: '패턴 후보 없음 — 관찰 기록 축적 필요(사실 단정 아님)', evidence: ['patterns'], confidence: null, assumptions: [] }));
    if (patterns.patterns.some((p) => p.verdict === 'pattern_candidate')) push(buildKnowledgeRecommendation({ type: 'review_learning_pattern', reason: '반복 패턴 후보 존재 — 사람 검토 필요(Correctness 아님)', evidence: ['pattern_candidate'], confidence: null, assumptions: [] }));
    return out;
  }, [memories, confidences, bestPractices, aging, patterns]);

  const cockpit = useMemo(() => buildKnowledgeCockpit({
    memoryTotal: memories.length,
    knowledgeNodes: anum('knowledge_nodes_0498') ?? 0,
    decisionChainsComplete: decisionChains.completeCount,
    learningPatternCandidates: patterns.patterns.filter((p) => p.verdict === 'pattern_candidate').length,
    bestPracticeCandidates: bestPractices.rows.length,
    graphOrphans: graph.orphans.length,
    summaryNote: null,
  }), [memories, anum, decisionChains, patterns, bestPractices, graph]);

  if (loading) return <AdminCard title="Enterprise Knowledge Evolution & Organizational Memory Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Enterprise Knowledge Evolution & Organizational Memory Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  return (
    <AdminCard
      title="Enterprise Knowledge Evolution & Organizational Memory Center"
      subtitle="Experience→Knowledge→Learning→Organizational Memory→Knowledge Evolution→Executive Knowledge Advisory — 자동 등록/삭제/정책 변경 없음"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="Best Practice 자동 등록, Knowledge 자동 삭제, 정책/전략/조직 규칙 자동 변경, 자동 Production/Merge/Deploy 는 없습니다. Best Practice 와 Knowledge 는 Evidence 기반 후보(candidate)로만 생성되며 사람 승인 없이 활성화되지 않습니다. Knowledge ≠ Truth, Learning ≠ Correctness, Best Practice ≠ Universal Rule, Decision Memory ≠ Decision Approval, Recommendation ≠ Organizational Decision." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {/* ── Cockpit ── */}
      {tab === 'cockpit' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
            {cockpit.sections.map((s) => (
              <div key={s.key} className="rounded-lg border border-border p-2">
                <p className="text-[10px] font-bold uppercase text-muted-foreground">{s.key}</p>
                <p className="mt-0.5 text-sm font-black">{s.headline}</p>
                <p className="text-[10px] text-muted-foreground">{s.detail}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">humanDecisionRequired · knowledgeAutoDecided=false</p>
        </div>
      )}

      {/* ── Dashboard(0498/0515/0514/0500 실측) ── */}
      {tab === 'dashboard' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Memory Records(0498)" value={NUM(anum('memory_records_0498'))} />
            <Box label="Knowledge Nodes(0498)" value={NUM(anum('knowledge_nodes_0498'))} />
            <Box label="Knowledge Edges(0498)" value={NUM(anum('knowledge_edges_0498'))} />
            <Box label="Org Learnings(0515)" value={NUM(anum('org_learnings_0515'))} />
            <Box label="Learning Patterns(0515)" value={NUM(anum('learning_patterns_0515'))} />
            <Box label="Decision Memory(0514)" value={NUM(anum('decision_memory_0514'))} />
            <Box label="Best Practices(0500)" value={NUM(anum('best_practices_0500'))} />
            <Box label="Playbooks(0502)" value={NUM(anum('playbooks_0502'))} />
          </div>
          <AdminAlert tone="info" description={`knowledge_unavailable: ${Array.isArray(summary.knowledge_unavailable) ? (summary.knowledge_unavailable as unknown[]).map(String).join(', ') : '—'} — 외부 위키/문서 시스템/교육 기록 원본 없음(임의 생성 금지). AI-OPS-1~27 데이터는 전부 읽기 전용 참조입니다.`} />
        </div>
      )}

      {/* ── Memory / Evolution ── */}
      {tab === 'memory' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {MEMORY_CREATE_KINDS.map((kind) => (
              <button key={kind} disabled={busy} onClick={() => {
                const r = needReason(); if (!r) return;
                void act(() => createOrgMemory({ code: `mem_${kind}_${now.toISOString().slice(0, 19)}`, kind, title: r.slice(0, 100), evidence: [{ label: 'note', value: '사람 기록' }] }), `${kind} 기록(candidate 시작 — Truth 아님)`);
              }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">{kind} 기록</button>
            ))}
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="제목/내용/사유(사람 입력·필수)" className="min-w-[220px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!memories.length ? <AdminEmpty title="Memory 없음" description="지식은 AI 가 자동 생성/삭제하지 않습니다 — 사람 기록만 candidate 상태로 저장됩니다." /> : memories.map((m) => (
            <div key={m.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{m.memory_code}</span>
                <AdminBadge tone="info">{m.memory_kind}</AdminBadge>
                <AdminBadge tone={m.memory_status === 'active' ? 'success' : m.memory_status === 'candidate' ? 'warning' : 'neutral'}>{m.memory_status}</AdminBadge>
                <AdminBadge tone={m.confidence_reference === 'verified' ? 'success' : 'neutral'}>{m.confidence_reference}</AdminBadge>
                <span className="text-muted-foreground">{m.title} · rev{m.revision_count} · Knowledge ≠ Truth</span>
              </div>
              {m.memory_status !== 'archived' && (
                <div className="mt-1 flex flex-wrap gap-1">
                  <button disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewOrgMemory(m.id, 'active', rr, 'verified'), 'active/verified(사람 승인 — 정답 아님)'); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">active+verified(승인)</button>
                  <button disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewOrgMemory(m.id, 'archived', rr), 'archive candidate(삭제 아님 — 보존)'); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">archived(보존)</button>
                  <button disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviseOrgMemory(m.id, null, rr, 'Revision(사람 승인)'), 'Revision 기록(사람 승인)'); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Revision(내용 입력)</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {tab === 'evolution' && (() => {
        const evo = audit.filter((e) => ['memory_recorded', 'memory_reviewed', 'memory_revised', 'memory_archive_candidate_noted', 'knowledge_evolution_noted'].includes(e.event_type));
        return !evo.length ? <AdminEmpty title="Evolution 이력 없음" description="Creation→Update→Review→Revision→Archive Candidate 를 추적합니다. Revision 은 사람 승인이 필요합니다." /> : (
          <div className="space-y-1">
            {evo.slice(0, 40).map((e) => (
              <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono text-muted-foreground">{e.created_at.slice(0, 16).replace('T', ' ')}</span>
                <AdminBadge tone={e.event_type === 'memory_revised' ? 'warning' : 'info'}>{e.event_type}</AdminBadge>
                <span className="ml-2">{e.detail}</span>
              </div>
            ))}
          </div>
        );
      })()}

      {/* ── Best Practice / Decision Memory / Confidence / Aging ── */}
      {tab === 'bestpractice' && (
        <div className="space-y-2">
          {!bestPractices.rows.length ? <AdminEmpty title="Best Practice 후보 없음" description="best_practice_candidate 로 기록된 항목만 후보로 표시됩니다 — 자동 등록하지 않으며 Universal Rule 이 아닙니다." /> : (
            <div className="space-y-1">
              {bestPractices.rows.map((r) => (
                <div key={r.code} className="rounded-lg border border-border p-2 text-[11px]">
                  <span className="font-mono font-bold">{r.code}</span>
                  <AdminBadge tone={r.verdict === 'promotable_candidate' ? 'info' : 'warning'}>{r.verdict}</AdminBadge>
                  <span className="ml-2 text-muted-foreground">domain {r.domain}(세분류 원본 없음 — 참조) · 자동 등록 아님</span>
                </div>
              ))}
            </div>
          )}
          <AdminAlert tone="info" description="Operational/Engineering/Business/AI 도메인 세분류는 기록 시 제목에 명시하는 참조이며, 승격(active)은 Evidence + 사람 승인으로만 가능합니다. 0500 ai_best_practices 는 읽기 전용 참조입니다." />
        </div>
      )}
      {tab === 'decisionmemory' && (
        !decisionChains.rows.length ? <AdminEmpty title="Decision Memory 없음" description="Decision→Reason→Evidence→Outcome→Learning 체인을 추적합니다 — Approval 이 아닙니다." /> : (
          <div className="space-y-1">
            {decisionChains.rows.map((r) => (
              <div key={r.decision} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{r.decision}</span>
                <AdminBadge tone={r.chainComplete ? 'success' : 'warning'}>{r.chainComplete ? 'chain_complete' : 'chain_incomplete'}</AdminBadge>
                <span className="ml-2 text-muted-foreground">{r.missing.length ? `누락: ${r.missing.join(', ')}` : 'Reason/Evidence/Outcome/Learning 연결됨'} · Decision Memory ≠ Approval</span>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'confidence' && (
        !confidences.length ? <AdminEmpty title="평가 대상 없음" description="verified/candidate/unknown/knowledge_unverified 4단계로만 평가하며 정답을 의미하지 않습니다." /> : (
          <div className="space-y-1">
            {confidences.map(({ m, c }) => (
              <div key={m.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{m.memory_code}</span>
                <AdminBadge tone={c.confidence === 'verified' ? 'success' : c.confidence === 'knowledge_unverified' ? 'danger' : 'warning'}>{c.confidence}</AdminBadge>
                <span className="ml-2 text-muted-foreground">Evidence {(m.evidence ?? []).length}건 · Confidence ≠ 정답</span>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'aging' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {(['fresh', 'stable', 'needs_review', 'candidate_archive'] as const).map((k) => (
              <Box key={k} label={k} value={NUM(aging.agingCounts[k] ?? 0)} />
            ))}
          </div>
          {aging.rows.filter((r) => r.aging === 'needs_review' || r.aging === 'candidate_archive').slice(0, 15).map((r) => (
            <div key={r.code} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{r.code}</span>
              <AdminBadge tone={r.aging === 'candidate_archive' ? 'warning' : 'info'}>{r.aging}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{r.ageDays}일 경과 · 오래됐다고 삭제하지 않습니다(deletionPerformed=false)</span>
            </div>
          ))}
          <button disabled={busy} onClick={() => {
            const r = needReason(); if (!r) return;
            void act(() => recordKnowledgeGovernance('knowledge_aging_analyzed', r, { counts: aging.agingCounts }), 'Aging 분석 기록(삭제 없음)');
          }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Aging 분석 기록</button>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="기록 사유(필수)" className="ml-2 min-w-[200px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
        </div>
      )}

      {/* ── Patterns / Graph ── */}
      {tab === 'patterns' && (
        <div className="space-y-1">
          {patterns.patterns.map((p) => (
            <div key={p.kind} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{p.kind}</span>
              <AdminBadge tone={p.verdict === 'pattern_candidate' ? 'info' : 'warning'}>{p.verdict}</AdminBadge>
              <span className="ml-2 text-muted-foreground">Pattern ≠ 사실 단정{p.verdict === 'knowledge_unverified' ? ' · 관찰 기록 없음 — unknown 유지' : ''}</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">Success/Failure/Delay/Recovery/Optimization 5종 — 발생&lt;3 은 sample_too_small. 0515 실측 패턴은 Dashboard 탭 참조.</p>
        </div>
      )}
      {tab === 'graph' && (
        <div className="space-y-2">
          {graph.stages.map((s) => (
            <div key={s.stage} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.nodes.length ? 'info' : 'neutral'}>{s.stage}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{s.nodes.length ? s.nodes.slice(0, 6).map((n) => n.label + (n.linked ? '' : '(미연결)')).join(' · ') : '노드 없음'}</span>
            </div>
          ))}
          {graph.orphans.length > 0 && <AdminAlert tone="warning" title={`미연결 ${graph.orphans.length}건`} description="상위 단계와 연결되지 않은 지식 — 사람 검토 필요" />}
          {graph.cycles.length > 0 && <AdminAlert tone="danger" title="Cycle 감지(인과 주장 없음)" description={graph.cycles.join(' · ')} />}
          <p className="text-[10px] text-muted-foreground">Experience→Evidence→Knowledge→Decision→Outcome→Learning 6단계(0498 Knowledge Graph 확장) · causalityClaimed=false</p>
        </div>
      )}

      {/* ── Briefing ── */}
      {tab === 'briefing' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => recordKnowledgeGovernance('knowledge_briefing_recorded', r, { period: 'weekly', sections: briefing.sections.map((s) => ({ key: s.key, count: s.items.length })) }), 'Briefing 기록(자동 발송 없음)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Weekly Knowledge Briefing 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="기록 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {briefing.sections.map((s) => (
            <div key={s.key} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.items.length ? 'info' : 'neutral'}>{s.key}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{s.items.length ? s.items.join(' · ') : '항목 없음(unknown 유지)'}</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">Today/Weekly/Monthly/Quarterly — autoSendDisabled=true(자동 발송 없음)</p>
        </div>
      )}

      {/* ── Recommendations / Reviews / External / Audit / Support ── */}
      {tab === 'recommendations' && (
        !autoRecs.length ? <AdminEmpty title="권고 없음" description="Evidence 없는 권고는 생성되지 않습니다." /> : (
          <div className="space-y-1">
            {autoRecs.map((r, i) => (
              <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone="info">{r.type}</AdminBadge>
                <span className="ml-2">{r.reason}</span>
                <p className="mt-1 text-[10px] text-muted-foreground">humanApprovalRequired · Recommendation ≠ Organizational Decision</p>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'humanreviews' && (() => {
        const reviews = audit.filter((e) => ['memory_recorded', 'memory_reviewed', 'memory_revised', 'best_practice_candidate_noted'].includes(e.event_type));
        return !reviews.length ? <AdminEmpty title="검토 이력 없음" description="지식 기록/승인/Revision 은 전부 사람이 수행합니다(자동 결정 없음)." /> : (
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
        const ext = audit.filter((e) => e.event_type === 'external_knowledge_reference');
        return !ext.length ? <AdminEmpty title="외부 참조 없음" description="외부 지식 자료는 참조로만 기록됩니다 — 원본 없이 지식을 확정하지 않습니다." /> : (
          <div className="space-y-1">
            {ext.slice(0, 30).map((e) => (
              <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]"><span className="font-mono text-muted-foreground">{e.created_at.slice(0, 16).replace('T', ' ')}</span><span className="ml-2">{e.detail}</span></div>
            ))}
          </div>
        );
      })()}
      {tab === 'audit' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => recordKnowledgeGovernance('knowledge_graph_analyzed', r, { orphans: graph.orphans.length, cycles: graph.cycles.length }), 'Graph 분석 기록(인과 주장 없음)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Graph 분석 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="기록 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!audit.length ? <AdminEmpty title="Audit 없음" description="지식 기록/분석이 이벤트로 남습니다(16종 whitelist)." /> : audit.slice(0, 60).map((e) => (
            <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono text-muted-foreground">{e.created_at.slice(0, 16).replace('T', ' ')}</span>
              <AdminBadge tone="neutral">{e.event_type}</AdminBadge>
              <span className="ml-2">{e.detail}</span>
            </div>
          ))}
        </div>
      )}
      {tab === 'support' && (
        <div className="space-y-1">
          {KNOWLEDGE_SUPPORT.map((s) => (
            <div key={s.key} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.status === 'supported' ? 'success' : s.status === 'partial' ? 'warning' : 'danger'}>{s.status}</AdminBadge>
              <span className="ml-2 font-bold">{s.key}</span>
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
