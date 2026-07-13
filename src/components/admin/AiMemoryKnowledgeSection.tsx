/**
 * AiMemoryKnowledgeSection — Long-Term Memory, Knowledge Graph & Pattern Intelligence (Phase AI-MUSIC-10).
 *
 * 과거 실제 운영 경험을 구조화된 Memory 로 보존 → 검색 → 패턴 발견 → Experience Replay →
 * Multi-Agent Evidence 로 제공한다. Memory/Graph/Pattern 은 Evidence 계층일 뿐 —
 * Production Playlist/Rotation/Scheduler/Queue/Playback/Trust/Constitution 을 변경하지 않는다.
 * 자동 삭제 없음(상태 기반 Aging) · Apply/Publish/Deploy/Execute 버튼 없음.
 *
 * 탭: Overview · Long-Term · Episodic · Semantic · Negative · Agent · Graph · Retrieval ·
 *     Patterns · Seasonal · Replay · Temporal · Quality · Contradictions · Audit · Support.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Brain, Database, Network, Search, Layers, Snowflake, Repeat, TrendingUp, Gauge,
  AlertTriangle, ScrollText, Grid3x3, Lock, RefreshCw, Eye, FlaskConical, CloudOff, History,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchAiMemorySummary, fetchAiMemoryRecords, fetchAiMemoryDetail, fetchAiMemoryAuditLog,
  createAiMemoryCandidate, markAiMemoryUsed, fetchKnowledgeNodes, fetchKnowledgeNeighbors,
  saveKnowledgeNode, saveKnowledgeEdge, fetchAiPatterns, saveAiPattern,
  fetchAgentMemory, fetchCollaborationHistory,
  type AiMemorySummaryResp, type AiMemoryRecordRow, type AiMemoryAuditRow,
  type KnowledgeNodeRow, type KnowledgeNeighborsResp, type AiPatternRow, type CollaborationRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import { AGENTS, type AgentCode } from '@/lib/multiAgent';
import {
  calculateMemoryQuality, calculateMemoryFreshness, calculateContextSimilarity, calculateRetrievalScore,
  rankMemories, retrievalSafety, classifyPatternStatus, evaluateExperienceReplay, classifyTemporalEvolution,
  buildMemoryEvidencePackage, memoryInputHash, seasonForMonth, MEMORY_SUPPORT,
  MEMORY_TYPE_LABEL, LIFECYCLE_LABEL, LIFECYCLE_TONE, OUTCOME_LABEL, OUTCOME_TONE,
  PATTERN_STATUS_LABEL, PATTERN_STATUS_TONE, REPLAY_LABEL, REPLAY_TONE, EVOLUTION_LABEL, qualityTone,
  type MemoryType, type LifecycleStatus, type OutcomeStatus, type QualityGrade,
} from '@/lib/aiMemory';

const NUM = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('ko-KR'));

type Tab = 'overview' | 'longterm' | 'episodic' | 'semantic' | 'negative' | 'agent' | 'graph' | 'retrieval'
  | 'patterns' | 'seasonal' | 'replay' | 'temporal' | 'quality' | 'contradictions' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Brain }[] = [
  { key: 'overview', label: 'Overview', icon: Brain },
  { key: 'longterm', label: 'Long-Term Memory', icon: Database },
  { key: 'episodic', label: 'Episodic', icon: History },
  { key: 'semantic', label: 'Semantic', icon: Layers },
  { key: 'negative', label: 'Negative', icon: CloudOff },
  { key: 'agent', label: 'Agent Memory', icon: Eye },
  { key: 'graph', label: 'Knowledge Graph', icon: Network },
  { key: 'retrieval', label: 'Retrieval', icon: Search },
  { key: 'patterns', label: 'Patterns', icon: FlaskConical },
  { key: 'seasonal', label: 'Seasonal', icon: Snowflake },
  { key: 'replay', label: 'Replay', icon: Repeat },
  { key: 'temporal', label: 'Temporal', icon: TrendingUp },
  { key: 'quality', label: 'Quality', icon: Gauge },
  { key: 'contradictions', label: 'Contradictions', icon: AlertTriangle },
  { key: 'audit', label: 'Audit', icon: ScrollText },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

export default function AiMemoryKnowledgeSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<AiMemorySummaryResp | null>(null);
  const [records, setRecords] = useState<AiMemoryRecordRow[]>([]);
  const [patterns, setPatterns] = useState<AiPatternRow[]>([]);
  const [auditLog, setAuditLog] = useState<AiMemoryAuditRow[]>([]);
  const [collabs, setCollabs] = useState<CollaborationRow[]>([]);
  const [nodes, setNodes] = useState<KnowledgeNodeRow[]>([]);
  const [neighbors, setNeighbors] = useState<KnowledgeNeighborsResp | null>(null);
  const [detail, setDetail] = useState<{ memory: AiMemoryRecordRow; audit: AiMemoryAuditRow[] } | null>(null);
  const [agentMemory, setAgentMemory] = useState<Array<Record<string, unknown>>>([]);
  const [memAgent, setMemAgent] = useState<AgentCode>('context');
  const [fltStatus, setFltStatus] = useState<string>('');
  const [retrAgent, setRetrAgent] = useState<AgentCode | ''>('');
  const [retrContext, setRetrContext] = useState('');
  const [replayId, setReplayId] = useState<string>('');
  const [replayContext, setReplayContext] = useState('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), []);
  const currentSeason = seasonForMonth(now.getMonth() + 1);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, r, p, a, c] = await Promise.all([
        fetchAiMemorySummary(), fetchAiMemoryRecords({ limit: 200 }), fetchAiPatterns(null, null, null, 100),
        fetchAiMemoryAuditLog(null, 100), fetchCollaborationHistory(null, null, 20),
      ]);
      setSummary(s); setRecords(r); setPatterns(p); setAuditLog(a); setCollabs(c);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const loadNodes = useCallback(async () => {
    setBusy(true);
    try { setNodes(await fetchKnowledgeNodes(null, null, 100)); }
    catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  }, []);
  useEffect(() => { if (tab === 'graph') void loadNodes(); }, [tab, loadNodes]);

  const loadAgentMemory = async (code: AgentCode) => {
    setMemAgent(code); setBusy(true);
    try { const m = await fetchAgentMemory(code, null, 20); setAgentMemory(m.memory); }
    catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };
  useEffect(() => { if (tab === 'agent') void loadAgentMemory(memAgent); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const openDetail = async (id: string) => {
    setBusy(true);
    try { const d = await fetchAiMemoryDetail(id); if (d.found && d.memory) setDetail({ memory: d.memory, audit: d.audit }); }
    catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  // 실제 운영 Source(Collaboration 세션)에서 Memory 후보 생성 — Outcome 없으므로 observation_only(정직).
  const createFromCollab = async (c: CollaborationRow) => {
    if (!c.id) return;
    setBusy(true);
    try {
      const res = await createAiMemoryCandidate({
        memory_type: 'observation', memory_scope: 'context', scope_id: c.context_key, agent_code: null,
        source_type: 'ai_agent_collaboration', source_id: c.id, source_version: 'collab_v1(0497)',
        input_hash: memoryInputHash({ sourceType: 'ai_agent_collaboration', sourceId: c.id, contextKey: c.context_key, occurredAt: c.created_at }),
        context_key: c.context_key, context_snapshot: { consensus_type: c.consensus_type, participants: c.participants },
        subject_type: 'collaboration', subject_id: c.id, action_type: c.final_decision,
        outcome_status: 'observation_only',
        evidence: [{ label: 'consensus', value: c.consensus_type }, { label: 'participants', value: c.participants.length }, { label: 'conflicts', value: c.conflicts?.length ?? 0 }],
        sample_size: c.participants.length, occurred_at: c.created_at,
      });
      toast.success(res.idempotent ? '이미 존재(중복 방지)' : `Memory 후보 저장(${res.eligibility})`);
      await load();
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  // Memory → Knowledge Graph 등록(memory node + context node + associated_with edge, Evidence 필수).
  const registerGraph = async (m: AiMemoryRecordRow) => {
    setBusy(true);
    try {
      const memNode = await saveKnowledgeNode({ node_type: 'memory', entity_id: m.id, canonical_key: `memory:${m.id}`, label: `${MEMORY_TYPE_LABEL[m.memory_type as MemoryType] ?? m.memory_type} ${m.context_key ?? m.id.slice(0, 8)}`, source_version: m.source_version });
      const ctxNode = await saveKnowledgeNode({ node_type: 'context', entity_id: m.context_key, canonical_key: `context:${m.context_key ?? 'unknown'}`, label: m.context_key ?? 'unknown', source_version: m.source_version });
      await saveKnowledgeEdge({
        from_node_id: memNode.id, to_node_id: ctxNode.id, relation_type: 'associated_with',
        scope: m.memory_scope, context_key: m.context_key, confidence: m.confidence, sample_size: m.sample_size,
        evidence: [{ label: 'memory_id', value: m.id }, { label: 'outcome', value: m.outcome_status }, { label: 'source', value: `${m.source_type}:${m.source_id}` }],
        source_version: m.source_version,
      });
      toast.success('Knowledge Graph 등록(associated_with — 인과 아님)');
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  // Memory 집계 → Pattern 가설 저장(자동 Strategy/Draft 생성 없음).
  const derivePattern = async (contextKey: string, group: AiMemoryRecordRow[]) => {
    setBusy(true);
    try {
      const withOutcome = group.filter((g) => ['improved', 'neutral', 'degraded'].includes(g.outcome_status));
      const sample = group.reduce((a, g) => a + (g.sample_size ?? 0), 0);
      const status = classifyPatternStatus({ sampleSize: sample, supportCount: withOutcome.filter((g) => g.outcome_status === 'improved').length, contradictionCount: withOutcome.filter((g) => g.outcome_status === 'degraded').length, hasOutcome: withOutcome.length > 0 });
      const res = await saveAiPattern({
        pattern_code: `ctx_perf:${contextKey}`, pattern_type: 'context_performance', scope: 'context', scope_id: contextKey,
        context_definition: { context_key: contextKey }, subject_definition: { memories: group.length },
        outcome_definition: { improved: withOutcome.filter((g) => g.outcome_status === 'improved').length, degraded: withOutcome.filter((g) => g.outcome_status === 'degraded').length },
        direction: withOutcome.filter((g) => g.outcome_status === 'improved').length >= withOutcome.filter((g) => g.outcome_status === 'degraded').length ? 'positive' : 'negative',
        sample_size: sample, support_count: withOutcome.filter((g) => g.outcome_status === 'improved').length,
        contradiction_count: withOutcome.filter((g) => g.outcome_status === 'degraded').length,
        status, evidence: group.slice(0, 5).map((g) => ({ label: 'memory', value: g.id })), source_version: 'memory_v1(0498)',
      });
      toast.success(res.idempotent ? '이미 존재하는 Pattern(중복 방지)' : `Pattern 저장(${PATTERN_STATUS_LABEL[status]})`);
      setPatterns(await fetchAiPatterns(null, null, null, 100));
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  const byType = (t: MemoryType) => records.filter((r) => r.memory_type === t);
  const filtered = fltStatus ? records.filter((r) => r.lifecycle_status === fltStatus) : records;

  // Retrieval(결정적 · 클라이언트 순위 계산 — Production 실행 아님).
  const retrieved = useMemo(() => {
    if (!retrContext && !retrAgent) return [];
    const scored = records
      .filter((r) => retrievalSafety(r.lifecycle_status as LifecycleStatus, r.contradiction_count) !== 'exclude')
      .map((r) => {
        const rs = calculateRetrievalScore({
          contextSimilarity: calculateContextSimilarity(retrContext || null, r.context_key),
          scopeMatch: retrAgent ? r.agent_code === retrAgent : null,
          temporalRelevance: calculateMemoryFreshness({ occurredAt: r.occurred_at, now, lastReinforcedAt: r.last_reinforced_at, seasonalTag: r.seasonal_tag, recurrenceCount: r.recurrence_count }),
          seasonalMatch: r.seasonal_tag ? (r.seasonal_tag === currentSeason ? 100 : 25) : null,
          qualityScore: r.quality_score, confidence: r.confidence, sampleSize: r.sample_size,
          outcomeAvailable: ['improved', 'neutral', 'degraded'].includes(r.outcome_status), contradictionCount: r.contradiction_count,
        });
        return { ...r, retrievalScore: rs.score, retrievalReasons: rs.reasons, qualityScore: r.quality_score, occurredAt: r.occurred_at, safety: retrievalSafety(r.lifecycle_status as LifecycleStatus, r.contradiction_count) };
      })
      .filter((r) => r.retrievalScore != null);
    return rankMemories(scored).slice(0, 20);
  }, [records, retrContext, retrAgent, now, currentSeason]);

  // Replay 평가(Evidence-only).
  const replayMemory = records.find((r) => r.id === replayId) ?? null;
  const replayResult = useMemo(() => {
    if (!replayMemory) return null;
    const sim = calculateContextSimilarity(replayContext || null, replayMemory.context_key);
    const res = evaluateExperienceReplay({
      contextSimilarity: sim, versionCompatible: true,
      hasOutcome: ['improved', 'neutral', 'degraded'].includes(replayMemory.outcome_status),
      contradictionCount: replayMemory.contradiction_count, qualityScore: replayMemory.quality_score,
    });
    return { sim, ...res };
  }, [replayMemory, replayContext]);

  // Temporal Evolution — 기간 분할(이전/현재 절반) Quality 평균 비교(0 비교 금지).
  const temporal = useMemo(() => {
    const withQ = records.filter((r) => r.quality_score != null).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
    if (withQ.length < 4) return null;
    const mid = Math.floor(withQ.length / 2);
    const avgOf = (xs: AiMemoryRecordRow[]) => Math.round(xs.reduce((a, r) => a + (r.quality_score as number), 0) / xs.length);
    const prev = avgOf(withQ.slice(0, mid)); const curr = avgOf(withQ.slice(mid));
    return { prev, curr, prevN: mid, currN: withQ.length - mid, ...classifyTemporalEvolution({ prev, curr }) };
  }, [records]);

  const qualityDist = useMemo(() => {
    const grades: Record<QualityGrade, number> = { high: 0, medium: 0, low: 0, provisional: 0, insufficient_data: 0 };
    for (const r of records) {
      const q = calculateMemoryQuality({
        evidenceCount: r.evidence?.length ?? 0, hasSource: true, hasVersion: !!r.source_version, hasInputHash: !!r.input_hash,
        outcomeStatus: r.outcome_status as OutcomeStatus, sampleSize: r.sample_size,
        contextDepth: r.context_key ? r.context_key.split('|').length : null, contradictionCount: r.contradiction_count,
      });
      grades[q.grade] += 1;
    }
    return grades;
  }, [records]);

  if (loading) return <AdminCard title="AI Memory & Knowledge Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="AI Memory & Knowledge Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const mem = summary?.memory ?? null;

  return (
    <AdminCard
      title="AI Memory & Knowledge Center"
      subtitle="Long-Term Memory · Knowledge Graph · Pattern Discovery · Experience Replay (Evidence 계층 · Production 무변경)"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="Memory/Graph/Pattern 은 근거(Evidence) 계층입니다. Production Playlist/Rotation/Scheduler/Queue/Playback/Rollout/Trust/Constitution 을 수정하지 않으며, Memory 존재만으로 Strategy/Draft/Candidate 가 자동 생성되지 않습니다. 오래된 Memory 는 삭제가 아닌 상태(stale/superseded/archived)로 관리됩니다." />
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
            <Box label="Total Memory" value={NUM(num(mem?.total))} />
            <Box label="Active" value={NUM(num(mem?.active))} />
            <Box label="Provisional" value={NUM(num(mem?.provisional))} />
            <Box label="Stale" value={NUM(num(mem?.stale))} />
            <Box label="Contradicted" value={NUM(num(mem?.contradicted))} />
            <Box label="High Quality(≥70)" value={NUM(num(mem?.high_quality))} />
            <Box label="Outcome 보유" value={NUM(num(mem?.with_outcome))} />
            <Box label="Pending Outcome" value={NUM(num(mem?.pending_outcome))} />
            <Box label="Negative Memory" value={NUM(num(mem?.negative))} />
            <Box label="Seasonal Memory" value={NUM(num(mem?.seasonal))} />
            <Box label="Knowledge Nodes" value={NUM(summary?.graph?.nodes)} />
            <Box label="Knowledge Edges" value={NUM(summary?.graph?.edges)} />
            <Box label="Patterns" value={NUM(summary?.patterns?.total)} />
            <Box label="Validated Patterns" value={NUM(summary?.patterns?.validated)} />
            <Box label="Emerging Patterns" value={NUM(summary?.patterns?.emerging)} />
            <Box label="Last Memory Event" value={mem?.last_event_at ? String(mem.last_event_at).slice(0, 10) : '—'} />
          </div>
          <AdminAlert tone="info" title="Memory Source(기존 Snapshot 재사용 — 복제 없음)"
            description={summary?.sources ? Object.entries(summary.sources).map(([k, v]) => `${k}: ${v}`).join(' · ') : '—'} />
          {(num(mem?.total) ?? 0) === 0 && (
            <AdminEmpty icon={<Brain size={20} />} title="Memory 없음" description="아직 저장된 Long-Term Memory 가 없습니다. Long-Term Memory 탭에서 실제 Collaboration 세션으로부터 후보를 생성할 수 있습니다." />
          )}
        </div>
      )}

      {/* ── Long-Term Memory ── */}
      {tab === 'longterm' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <select value={fltStatus} onChange={(e) => setFltStatus(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold">
              <option value="">상태 전체</option>
              {Object.entries(LIFECYCLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <span className="text-[10px] text-muted-foreground">{filtered.length}건 (limit 200)</span>
          </div>
          <MemoryTable items={filtered} onDetail={openDetail} />
          <AdminCard title="Memory 후보 생성 — 실제 운영 Source(Collaboration 세션)">
            <p className="mb-2 text-[10px] text-muted-foreground">Outcome 이 없는 세션은 observation_only 로 저장됩니다(성공 Memory 로 사용 금지 · Synthetic Outcome 생성 없음).</p>
            {!collabs.length ? <AdminEmpty icon={<Database size={20} />} title="Collaboration 세션 없음" description="Multi-Agent Center 에서 협업 세션을 먼저 기록하세요." /> : (
              <div className="space-y-1.5">
                {collabs.slice(0, 5).map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{c.context_key}</code>
                    <span className="text-muted-foreground">{c.consensus_type ?? '—'} · {c.created_at.slice(0, 16)}</span>
                    <button disabled={busy} onClick={() => void createFromCollab(c)} className="ml-auto rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Memory 후보 저장</button>
                  </div>
                ))}
              </div>
            )}
          </AdminCard>
        </div>
      )}

      {/* ── Episodic / Semantic / Negative ── */}
      {tab === 'episodic' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Episodic Memory" description="특정 시점에 실제 발생한 사건 기록(시간 범위·Source·Context·Action·Outcome·Evidence·Version·Hash 필수). Outcome 미확정은 성공으로 해석하지 않습니다." />
          <MemoryTable items={[...byType('episodic'), ...byType('observation')]} onDetail={openDetail} />
        </div>
      )}
      {tab === 'semantic' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Semantic Memory" description="여러 Episodic Memory 를 집계한 일반화 지식 — 최소 Sample 10 강제(단일 사건 일반화 금지). 설명은 데이터에서 결정적으로 생성됩니다." />
          <MemoryTable items={byType('semantic')} onDetail={openDetail} />
        </div>
      )}
      {tab === 'negative' && (
        <div className="space-y-3">
          <AdminAlert tone="warning" title="Negative Memory (성공 편향 금지)" description="실패/회귀/기각/위반 경험도 보존합니다. Evidence 와 Sample 이 충분하면 실패 Memory 도 높은 Quality 를 가질 수 있습니다." />
          <MemoryTable items={[...byType('negative'), ...records.filter((r) => r.outcome_status === 'degraded' && r.memory_type !== 'negative')]} onDetail={openDetail} />
        </div>
      )}

      {/* ── Agent Memory (읽기 전용, 0497 재사용) ── */}
      {tab === 'agent' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Agent Memory (읽기 전용)" description="0497 admin_ai_agent_memory 재사용 — 도메인별 기존 Snapshot 을 Domain Filter 로 조회합니다. Agent 는 서로의 Memory 를 수정할 수 없으며, Memory 가 없으면 abstain 을 유지합니다." />
          <div className="flex flex-wrap gap-1.5">
            {AGENTS.map((a) => <button key={a.code} onClick={() => void loadAgentMemory(a.code)} className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${memAgent === a.code ? 'bg-accent text-black' : 'border border-border text-muted-foreground'}`}>{a.name}</button>)}
          </div>
          {!agentMemory.length ? <AdminEmpty icon={<Eye size={20} />} title="Memory 없음" description="해당 도메인 Snapshot 이 아직 없습니다(abstain 유지)." /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground">{Object.keys(agentMemory[0]).slice(0, 6).map((k) => <th key={k} className="px-2 py-1">{k}</th>)}</tr></thead>
                <tbody>{agentMemory.slice(0, 20).map((m, i) => <tr key={i} className="border-b border-border/50">{Object.keys(agentMemory[0]).slice(0, 6).map((k) => <td key={k} className="px-2 text-[10px]">{m[k] == null ? '—' : String(m[k]).slice(0, 24)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Knowledge Graph ── */}
      {tab === 'graph' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Knowledge Graph (1-Hop Relation Explorer)" description="Node 는 기존 Entity 참조만(복제 없음). Edge 는 Evidence 필수 · associated_with 는 인과가 아닙니다. 초기 구현은 목록형 1-Hop 조회만 지원합니다(대형 그래프 라이브러리 미추가)." />
          {!nodes.length ? <AdminEmpty icon={<Network size={20} />} title="Node 없음" description="Long-Term Memory 상세에서 'Graph 등록'으로 Memory↔Context 관계를 만들 수 있습니다." /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Type</th><th className="px-2">Label</th><th className="px-2">Canonical Key</th><th className="px-2">Version</th><th className="px-2" /></tr></thead>
                <tbody>
                  {nodes.slice(0, 30).map((n) => (
                    <tr key={n.id} className="border-b border-border/50">
                      <td className="py-1.5 pr-2"><AdminBadge tone="neutral">{n.node_type}</AdminBadge></td>
                      <td className="px-2 font-semibold">{n.label}</td>
                      <td className="px-2"><code className="text-[10px]">{n.canonical_key.slice(0, 40)}</code></td>
                      <td className="px-2 text-[10px] text-muted-foreground">{n.source_version}</td>
                      <td className="px-2"><button disabled={busy} onClick={() => { void (async () => { try { setNeighbors(await fetchKnowledgeNeighbors(n.id, 50)); } catch (e) { toast.error(classifyAdminError(e).message); } })(); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Neighbors</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {neighbors?.found && neighbors.node && (
            <AdminCard title={`Neighbors — ${neighbors.node.label}`}>
              {!neighbors.outgoing.length && !neighbors.incoming.length ? <AdminEmpty icon={<Network size={20} />} title="연결 없음" /> : (
                <div className="space-y-1.5 text-[11px]">
                  {neighbors.outgoing.map((o, i) => (
                    <div key={`o${i}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
                      <AdminBadge tone="info">{o.edge.relation_type}</AdminBadge>
                      <span>→ {o.node.label}</span>
                      <span className="text-[10px] text-muted-foreground">confidence {o.edge.confidence ?? '—'} · sample {o.edge.sample_size ?? '—'}</span>
                    </div>
                  ))}
                  {neighbors.incoming.map((o, i) => (
                    <div key={`i${i}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
                      <AdminBadge tone="neutral">{o.edge.relation_type}</AdminBadge>
                      <span>← {o.node.label}</span>
                      <span className="text-[10px] text-muted-foreground">confidence {o.edge.confidence ?? '—'}</span>
                    </div>
                  ))}
                </div>
              )}
            </AdminCard>
          )}
        </div>
      )}

      {/* ── Retrieval ── */}
      {tab === 'retrieval' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Memory Retrieval (결정적 관련성 순위)" description="Context 유사도·Scope·Freshness·Seasonal·Quality·Confidence·Sample 성분을 재정규화해 순위를 계산합니다(하드코딩 점수 없음). blocked/반증 Memory 는 제외, stale/provisional 은 경고와 함께 노출됩니다. 조회는 Production 실행이 아닙니다." />
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-muted/30 p-2">
            <select value={retrAgent} onChange={(e) => setRetrAgent(e.target.value as AgentCode | '')} className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold">
              <option value="">Agent 전체</option>{AGENTS.map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}
            </select>
            <input value={retrContext} onChange={(e) => setRetrContext(e.target.value)} placeholder="context_key 예: store_type=cafe|daypart=아침" className="min-w-[220px] flex-1 rounded-md border border-border bg-background px-2 py-1 text-[11px]" aria-label="검색 Context Key" />
            <span className="text-[10px] text-muted-foreground">현재 계절: {currentSeason}</span>
          </div>
          {!retrieved.length ? <AdminEmpty icon={<Search size={20} />} title="검색 결과 없음" description="Context Key 를 입력하거나 Agent 를 선택하세요. Memory 가 없으면 결과도 없습니다(가짜 결과 생성 없음)." /> : (
            <div className="space-y-1.5">
              {retrieved.map((r, i) => (
                <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-black">#{i + 1}</span>
                    <AdminBadge tone={r.retrievalScore! >= 70 ? 'success' : r.retrievalScore! >= 45 ? 'info' : 'neutral'}>score {r.retrievalScore}</AdminBadge>
                    <AdminBadge tone={LIFECYCLE_TONE[r.lifecycle_status as LifecycleStatus]}>{LIFECYCLE_LABEL[r.lifecycle_status as LifecycleStatus]}</AdminBadge>
                    {r.safety === 'warn' && <AdminBadge tone="warning">주의</AdminBadge>}
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{r.context_key ?? '—'}</code>
                    <button disabled={busy} onClick={() => { void openDetail(r.id); void markAiMemoryUsed(r.id, 'retrieval_used', `rank ${i + 1}`).catch(() => undefined); }} className="ml-auto rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Evidence</button>
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">이유: {r.retrievalReasons.join(', ')} · Outcome {OUTCOME_LABEL[r.outcome_status as OutcomeStatus]} · Quality {r.quality_score ?? '—'} · 반례 {r.contradiction_count}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Patterns ── */}
      {tab === 'patterns' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Pattern Discovery (관찰 상관관계 — 인과 아님)" description="validated 는 sample≥30 + support≥3 + 실제 Outcome 충족 시만. Pattern 은 자동 운영 명령이 아니며 Strategy/Draft 를 자동 생성하지 않습니다." />
          {!patterns.length ? <AdminEmpty icon={<FlaskConical size={20} />} title="Pattern 없음" description="아래에서 Memory 집계 기반 가설을 도출할 수 있습니다(데이터 없으면 생성 불가)." /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Pattern</th><th className="px-2">Type</th><th className="px-2">Scope</th><th className="px-2">Status</th><th className="px-2">Sample</th><th className="px-2">Support/반례</th><th className="px-2">Direction</th><th className="px-2">감지</th></tr></thead>
                <tbody>
                  {patterns.map((p) => (
                    <tr key={p.id} className="border-b border-border/50">
                      <td className="py-1.5 pr-2 font-semibold"><code className="text-[10px]">{p.pattern_code.slice(0, 36)}</code></td>
                      <td className="px-2 text-[10px]">{p.pattern_type}</td>
                      <td className="px-2 text-[10px]">{p.scope}{p.scope_id ? `:${p.scope_id.slice(0, 16)}` : ''}</td>
                      <td className="px-2"><AdminBadge tone={PATTERN_STATUS_TONE[p.status as keyof typeof PATTERN_STATUS_TONE] ?? 'neutral'}>{PATTERN_STATUS_LABEL[p.status as keyof typeof PATTERN_STATUS_LABEL] ?? p.status}</AdminBadge></td>
                      <td className="px-2">{NUM(p.sample_size)}</td>
                      <td className="px-2">{p.support_count}/{p.contradiction_count}</td>
                      <td className="px-2 text-[10px]">{p.direction ?? '—'}</td>
                      <td className="px-2 text-[10px] text-muted-foreground">{p.last_detected_at.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <AdminCard title="Context Performance 가설 도출(Memory 집계)">
            {(() => {
              const groups = new Map<string, AiMemoryRecordRow[]>();
              for (const r of records) { if (r.context_key) { const g = groups.get(r.context_key) ?? []; g.push(r); groups.set(r.context_key, g); } }
              const entries = [...groups.entries()].slice(0, 5);
              if (!entries.length) return <AdminEmpty icon={<FlaskConical size={20} />} title="집계할 Memory 없음" />;
              return (
                <div className="space-y-1.5">
                  {entries.map(([k, g]) => (
                    <div key={k} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                      <code className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{k}</code>
                      <span className="text-muted-foreground">{g.length}개 Memory</span>
                      <button disabled={busy} onClick={() => void derivePattern(k, g)} className="ml-auto rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">가설 저장</button>
                    </div>
                  ))}
                </div>
              );
            })()}
          </AdminCard>
        </div>
      )}

      {/* ── Seasonal ── */}
      {tab === 'seasonal' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title={`Seasonal Memory (현재 계절: ${currentSeason})`} description="월 기반 4계절(봄/여름/가을/겨울)만 지원합니다. 장마/폭염/벚꽃/크리스마스/설날/시험기간/날씨 데이터는 현재 없음(unsupported). 같은 계절 재진입 시 Freshness 가 회복됩니다(자동 삭제 없음)." />
          {(() => {
            const seasonal = records.filter((r) => r.seasonal_tag);
            if (!seasonal.length) return <AdminEmpty icon={<Snowflake size={20} />} title="Seasonal Memory 없음" description="seasonal_tag 가 지정된 Memory 가 없습니다." />;
            return (
              <div className="space-y-1.5">
                {seasonal.map((r) => {
                  const f = calculateMemoryFreshness({ occurredAt: r.occurred_at, now, lastReinforcedAt: r.last_reinforced_at, seasonalTag: r.seasonal_tag, recurrenceCount: r.recurrence_count });
                  return (
                    <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                      <AdminBadge tone={r.seasonal_tag === currentSeason ? 'success' : 'neutral'}>{r.seasonal_tag}</AdminBadge>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{r.context_key ?? '—'}</code>
                      <span className="text-muted-foreground">Freshness {f ?? '—'}{r.seasonal_tag === currentSeason ? ' (계절 재진입 회복)' : ''}</span>
                      <span className="text-[10px] text-muted-foreground">{r.occurred_at.slice(0, 10)}</span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Replay ── */}
      {tab === 'replay' && (
        <div className="space-y-3">
          <AdminAlert tone="warning" icon={<Lock size={14} />} title="Experience Replay (Evidence-only)" description="과거 경험을 현재 Context 에 대입해 참고 근거만 생성합니다. 실제 재생/Publish/Scheduler/Queue/Rollout/Experiment/Apply 는 수행할 수 없습니다." />
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-muted/30 p-2">
            <select value={replayId} onChange={(e) => setReplayId(e.target.value)} className="max-w-[280px] rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold" aria-label="Replay Memory 선택">
              <option value="">Memory 선택</option>
              {records.slice(0, 50).map((r) => <option key={r.id} value={r.id}>{(r.context_key ?? r.id).slice(0, 32)} · {OUTCOME_LABEL[r.outcome_status as OutcomeStatus]}</option>)}
            </select>
            <input value={replayContext} onChange={(e) => setReplayContext(e.target.value)} placeholder="현재 context_key" className="min-w-[200px] flex-1 rounded-md border border-border bg-background px-2 py-1 text-[11px]" aria-label="현재 Context Key" />
          </div>
          {!replayMemory || !replayResult ? <AdminEmpty icon={<Repeat size={20} />} title="Memory 와 현재 Context 를 선택하세요" /> : (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Box label="Replay Assessment" value={REPLAY_LABEL[replayResult.assessment]} />
                <Box label="Context Similarity" value={replayResult.sim == null ? '비교 불가' : `${replayResult.sim}`} />
                <Box label="Historical Outcome" value={OUTCOME_LABEL[replayMemory.outcome_status as OutcomeStatus]} />
                <Box label="반례(Counter Evidence)" value={`${replayMemory.contradiction_count}`} />
              </div>
              <AdminAlert tone={REPLAY_TONE[replayResult.assessment] === 'danger' ? 'danger' : REPLAY_TONE[replayResult.assessment] === 'warning' ? 'warning' : 'info'} title={REPLAY_LABEL[replayResult.assessment]} description={replayResult.note} />
              <div className="flex gap-1.5">
                <button disabled={busy} onClick={() => { void openDetail(replayMemory.id); void markAiMemoryUsed(replayMemory.id, 'replay_used', replayResult.assessment).catch(() => undefined); }} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Evidence 보기</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Temporal ── */}
      {tab === 'temporal' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Temporal Evolution" description="이전 기간과 현재 기간의 Memory Quality 평균을 비교합니다. 이전값이 없으면 0 과 비교하지 않고 insufficient_data 로 표시합니다." />
          {!temporal ? <AdminEmpty icon={<TrendingUp size={20} />} title="데이터 부족 (insufficient_data)" description="Quality 가 있는 Memory 4건 이상 필요." /> : (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Box label="이전 기간 평균 Quality" value={`${temporal.prev} (${temporal.prevN}건)`} />
              <Box label="현재 기간 평균 Quality" value={`${temporal.curr} (${temporal.currN}건)`} />
              <Box label="변화량" value={temporal.delta == null ? '—' : `${temporal.delta > 0 ? '+' : ''}${temporal.delta}`} />
              <Box label="판정" value={EVOLUTION_LABEL[temporal.result]} />
            </div>
          )}
        </div>
      )}

      {/* ── Quality ── */}
      {tab === 'quality' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Memory Quality (직접 입력 금지)" description="Evidence 완전성·Source 신뢰성·Outcome 보유·Sample 충분성·Context 구체성으로 계산합니다. 없는 성분은 0 으로 바꾸지 않고 재정규화합니다. 실패 Memory 도 Evidence 가 충분하면 높은 Quality 가 됩니다." />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            {(Object.entries(qualityDist) as Array<[QualityGrade, number]>).map(([g, n]) => (
              <div key={g} className="rounded-lg border border-border p-2">
                <AdminBadge tone={qualityTone(g)}>{g}</AdminBadge>
                <p className="mt-1 text-sm font-black">{NUM(n)}</p>
              </div>
            ))}
          </div>
          {!records.length && <AdminEmpty icon={<Gauge size={20} />} title="Memory 없음" />}
        </div>
      )}

      {/* ── Contradictions ── */}
      {tab === 'contradictions' && (
        <div className="space-y-3">
          <AdminAlert tone="warning" title="Memory Contradiction" description="반대 Outcome 이 발견돼도 과거 Memory 를 삭제하지 않습니다 — quality/confidence 감소, stale/contradicted 전이, context/기간 분리 또는 Governance Review 로 처리합니다." />
          {(() => {
            const items = records.filter((r) => r.contradiction_count > 0 || r.lifecycle_status === 'contradicted');
            if (!items.length) return <AdminEmpty icon={<AlertTriangle size={20} />} title="Contradiction 없음" />;
            return <MemoryTable items={items} onDetail={openDetail} />;
          })()}
        </div>
      )}

      {/* ── Audit ── */}
      {tab === 'audit' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Memory Audit History" description="생성/자격검증/강화/모순/상태 전이/Retrieval·Replay 사용이 모두 기록됩니다(재현 가능)." />
          {!auditLog.length ? <AdminEmpty icon={<ScrollText size={20} />} title="Audit 없음" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Event</th><th className="px-2">상태 변화</th><th className="px-2">사유</th><th className="px-2">시각</th></tr></thead>
                <tbody>
                  {auditLog.map((a) => (
                    <tr key={a.id} className="border-b border-border/50">
                      <td className="py-1.5 pr-2"><AdminBadge tone={a.event_type === 'contradicted' || a.event_type === 'blocked' ? 'danger' : a.event_type === 'reinforced' ? 'success' : 'neutral'}>{a.event_type}</AdminBadge></td>
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
              {MEMORY_SUPPORT.map((s) => (
                <tr key={s.key} className="border-b border-border/50">
                  <td className="py-1.5 pr-2 font-semibold">{s.label}</td>
                  <td className="px-2"><AdminBadge tone={s.status === 'fully_supported' ? 'success' : s.status === 'unsupported' ? 'danger' : s.status === 'insufficient_data' ? 'neutral' : 'warning'}>{s.status}</AdminBadge></td>
                  <td className="px-2 text-[10px] text-muted-foreground">{s.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Memory Detail Drawer ── */}
      {detail && (
        <div className="mt-3">
          <AdminCard title={`Memory Detail — ${detail.memory.id.slice(0, 8)}`} action={<button onClick={() => setDetail(null)} className="text-[11px] font-bold underline">닫기</button>}>
            <div className="grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4">
              {buildMemoryEvidencePackage(detail.memory, { score: null, reasons: [] }).map((e) => (
                <div key={e.label} className="rounded-lg border border-border p-2">
                  <p className="text-[10px] font-bold text-muted-foreground">{e.label}</p>
                  <p className="mt-0.5 break-all text-[11px] font-semibold">{e.value == null ? '—' : String(e.value)}</p>
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button disabled={busy} onClick={() => void registerGraph(detail.memory)} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Knowledge Graph 등록</button>
            </div>
            <div className="mt-2 max-h-48 overflow-auto rounded-lg border border-border bg-muted/30 p-2">
              <p className="text-[10px] font-bold text-muted-foreground">Evidence JSON</p>
              <pre className="mt-1 whitespace-pre-wrap break-all text-[10px]">{JSON.stringify(detail.memory.evidence, null, 1)}</pre>
            </div>
            {detail.audit.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-[10px] font-bold text-muted-foreground">Audit ({detail.audit.length})</p>
                {detail.audit.slice(0, 10).map((a) => (
                  <p key={a.id} className="text-[10px] text-muted-foreground">{a.created_at.slice(0, 16)} · {a.event_type} · {a.reason ?? '—'}</p>
                ))}
              </div>
            )}
          </AdminCard>
        </div>
      )}
    </AdminCard>
  );
}

function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function MemoryTable({ items, onDetail }: { items: AiMemoryRecordRow[]; onDetail: (id: string) => void }) {
  if (!items.length) return <AdminEmpty icon={<Database size={20} />} title="Memory 없음" description="해당 조건의 Memory 가 없습니다." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Type</th><th className="px-2">Scope</th><th className="px-2">Context</th><th className="px-2">Outcome</th><th className="px-2">Quality</th><th className="px-2">Sample</th><th className="px-2">상태</th><th className="px-2">반례</th><th className="px-2">발생</th><th className="px-2" /></tr></thead>
        <tbody>
          {items.slice(0, 50).map((r) => (
            <tr key={r.id} className="border-b border-border/50">
              <td className="py-1.5 pr-2"><AdminBadge tone={r.memory_type === 'negative' ? 'danger' : 'neutral'}>{MEMORY_TYPE_LABEL[r.memory_type as MemoryType] ?? r.memory_type}</AdminBadge></td>
              <td className="px-2 text-[10px]">{r.memory_scope}{r.scope_id ? `:${r.scope_id.slice(0, 14)}` : ''}</td>
              <td className="px-2"><code className="text-[10px]">{(r.context_key ?? '—').slice(0, 24)}</code></td>
              <td className="px-2"><AdminBadge tone={OUTCOME_TONE[r.outcome_status as OutcomeStatus] ?? 'neutral'}>{OUTCOME_LABEL[r.outcome_status as OutcomeStatus] ?? r.outcome_status}</AdminBadge></td>
              <td className="px-2">{r.quality_score ?? '—'}</td>
              <td className="px-2">{NUM(r.sample_size)}</td>
              <td className="px-2"><AdminBadge tone={LIFECYCLE_TONE[r.lifecycle_status as LifecycleStatus] ?? 'neutral'}>{LIFECYCLE_LABEL[r.lifecycle_status as LifecycleStatus] ?? r.lifecycle_status}</AdminBadge></td>
              <td className="px-2">{r.contradiction_count}</td>
              <td className="px-2 text-[10px] text-muted-foreground">{r.occurred_at.slice(0, 10)}</td>
              <td className="px-2"><button onClick={() => onDetail(r.id)} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted">상세</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length > 50 && <p className="mt-1 text-[10px] text-muted-foreground">50건까지 표시(총 {items.length}건)</p>}
    </div>
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
