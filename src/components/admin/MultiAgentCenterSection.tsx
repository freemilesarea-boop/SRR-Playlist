/**
 * MultiAgentCenterSection — Multi-Agent Collaboration Engine (Phase AI-MUSIC-9).
 *
 * 여러 전문 Agent 가 독립 의견 → Discussion → Consensus → Conflict 해결 → Governance 제출한다.
 * Agent 는 Production Entity/Trust/Constitution/서로의 Memory 를 수정하지 않는다(분석·기록만).
 * Production Apply 없음. Memory 는 읽기 전용 Snapshot.
 *
 * 탭: Agent Overview · Agents · Collaboration · Consensus · Conflict · Agent Reputation · Agent Memory · Support Matrix.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Users, Bot, MessagesSquare, Handshake, Swords, Award, Database, BookOpen, RefreshCw, Lock, Play,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchContextOverview, fetchContextDetail, fetchContextDrift, fetchGovernanceSummary,
  fetchAiAgents, fetchAgentReputation, fetchAgentMemory, saveCollaboration, fetchCollaborationHistory,
  type ContextOverview, type ContextDetailResp, type ContextDriftResp, type GovernanceSummaryResp,
  type AiAgentRow, type AgentReputationRow, type CollaborationRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import { computeContextHealth, computeContextScore, type ContextDetail } from '@/lib/contextIntel';
import { computeDrift } from '@/lib/contextLearning';
import {
  AGENTS, runCollaboration, collaborationIdempotencyKey, agentDef,
  AGENT_SUPPORT, STANCE_LABEL, STANCE_TONE, CONSENSUS_LABEL, CONSENSUS_TONE, CONFLICT_SEVERITY_TONE,
  FINAL_DECISION_LABEL, reputationTone,
  type CollaborationInput, type AgentCode,
} from '@/lib/multiAgent';

const NUM = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('ko-KR'));
const DAYPARTS = ['새벽', '아침', '점심', '오후', '저녁', '심야'] as const;

type Tab = 'overview' | 'agents' | 'collaboration' | 'consensus' | 'conflict' | 'reputation' | 'memory' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Users }[] = [
  { key: 'overview', label: 'Agent Overview', icon: Users },
  { key: 'agents', label: 'Agents', icon: Bot },
  { key: 'collaboration', label: 'Collaboration', icon: MessagesSquare },
  { key: 'consensus', label: 'Consensus', icon: Handshake },
  { key: 'conflict', label: 'Conflict', icon: Swords },
  { key: 'reputation', label: 'Agent Reputation', icon: Award },
  { key: 'memory', label: 'Agent Memory', icon: Database },
  { key: 'support', label: 'Support Matrix', icon: BookOpen },
];

export default function MultiAgentCenterSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<ContextOverview | null>(null);
  const [storeType, setStoreType] = useState<string | null>(null);
  const [daypart, setDaypart] = useState<string | null>(null);
  const [detail, setDetail] = useState<ContextDetailResp | null>(null);
  const [drift, setDrift] = useState<ContextDriftResp | null>(null);
  const [govSummary, setGovSummary] = useState<GovernanceSummaryResp | null>(null);
  const [agents, setAgents] = useState<AiAgentRow[]>([]);
  const [reputation, setReputation] = useState<AgentReputationRow[]>([]);
  const [history, setHistory] = useState<CollaborationRow[]>([]);
  const [memory, setMemory] = useState<Array<Record<string, unknown>>>([]);
  const [memAgent, setMemAgent] = useState<AgentCode>('context');
  const [selAgent, setSelAgent] = useState<AgentCode>('context');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const contextKey = useMemo(() => `store_type=${storeType ?? ''}${daypart ? `|daypart=${daypart}` : ''}`, [storeType, daypart]);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [o, ag, rep, gs, hist] = await Promise.all([
        fetchContextOverview('30d'), fetchAiAgents(null), fetchAgentReputation(), fetchGovernanceSummary(), fetchCollaborationHistory(null, null, 100),
      ]);
      setOverview(o); setAgents(ag); setReputation(rep); setGovSummary(gs); setHistory(hist);
      if (o.items.length && !storeType) setStoreType(o.items[0].store_type);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, [storeType]);
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadContext = useCallback(async () => {
    if (!storeType) return;
    setBusy(true);
    try {
      const [de, dr] = await Promise.all([
        fetchContextDetail(storeType, daypart, null, '30d', 20).catch(() => null),
        fetchContextDrift(storeType, daypart, null, '30d').catch(() => null),
      ]);
      setDetail(de); setDrift(dr);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setBusy(false); }
  }, [storeType, daypart]);
  useEffect(() => { void loadContext(); }, [loadContext]);

  const d = useMemo(() => (detail ? (detail as ContextDetail) : null), [detail]);
  const driftResult = useMemo(() => (drift?.recent && drift?.prior ? computeDrift(drift.prior, drift.recent) : null), [drift]);

  // 협업 입력 — 실제 신호(없으면 null → 해당 Agent abstain).
  const collabInput = useMemo<CollaborationInput | null>(() => {
    if (!d) return null;
    const health = computeContextHealth(d.summary);
    const score = computeContextScore(d.summary);
    return {
      contextKey: contextKey || (storeType ?? ''),
      contextHealth: health.score, contextDrift: driftResult?.score ?? null, sample: d.summary.events,
      predictedCompletion: d.summary.completion_rate, predictedSkip: d.summary.skip_rate, predictionConfidence: score.confidence, riskScore: driftResult?.score ?? null,
      playlistDiversity: d.summary.genre_count > 0 ? Math.min(100, Math.round((d.summary.genre_count / 8) * 100)) : null, playlistFreshness: null,
      trackCoverage: d.summary.track_count > 0 ? Math.min(100, Math.round((d.summary.track_count / 50) * 100)) : null, artistExposure: null,
      repeatRisk: null, fatigueRisk: null, streamingQuality: null, bufferHealth: null, roi: null, storeSatisfaction: null,
      governanceHealth: govSummary?.events ? Math.max(0, 100 - Math.min(100, govSummary.events.violations)) : null, constitutionPass: (govSummary?.candidates?.critical_risk ?? 0) === 0,
    };
  }, [d, driftResult, contextKey, storeType, govSummary]);

  const repMap = useMemo(() => Object.fromEntries(reputation.map((r) => [r.agent_code, r.reputation])) as Partial<Record<AgentCode, number>>, [reputation]);
  const collab = useMemo(() => (collabInput ? runCollaboration(collabInput, repMap) : null), [collabInput, repMap]);

  const runAndSave = async () => {
    if (!collab || !collabInput) return;
    setBusy(true);
    try {
      await saveCollaboration({
        context_key: collabInput.contextKey, topic: 'context_optimization',
        participants: collab.opinions.filter((o) => o.supported).map((o) => o.agent),
        opinions: collab.opinions, consensus_type: collab.consensus.type, consensus_score: collab.consensus.score,
        conflicts: collab.conflicts, final_decision: collab.finalDecision,
        governance_result: { required: collab.governanceRequired },
        idempotency_key: collaborationIdempotencyKey({ contextKey: collabInput.contextKey, topic: 'context_optimization', participants: collab.opinions.filter((o) => o.supported).map((o) => o.agent), inputHash: `${collabInput.sample}` }),
        evidence: collab.evidence,
      });
      toast.success('Collaboration 저장됨(분석·기록 · Production 무변경)');
      setHistory(await fetchCollaborationHistory(null, null, 100));
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };
  const loadMemory = async (code: AgentCode) => {
    setMemAgent(code); setBusy(true);
    try { const m = await fetchAgentMemory(code, storeType ? contextKey : null, 20); setMemory(m.memory); }
    catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };
  useEffect(() => { if (tab === 'memory') void loadMemory(memAgent); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <AdminCard title="AI Multi-Agent Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="AI Multi-Agent Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const selOpinion = collab?.opinions.find((o) => o.agent === selAgent);
  const selAgentDef = agentDef(selAgent);

  return (
    <AdminCard
      title="AI Multi-Agent Center"
      subtitle="전문 Agent 독립 분석 → 협업 → Consensus → Conflict → Governance (Production 무변경 · Agent 직접수정 불가)"
      action={<button onClick={() => { void load(); void loadContext(); }} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="Agent 는 Production Entity/Trust/Constitution/서로의 Memory 를 직접 수정하지 않습니다. Discussion/Consensus/Conflict 는 분석·기록이며 실제 Playlist/Queue/Scheduler/Playback 반영이나 Production Apply 는 없습니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {/* Context 선택(Collaboration/Consensus/Conflict/Agents) */}
      {['agents', 'collaboration', 'consensus', 'conflict'].includes(tab) && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-muted/30 p-2">
          <span className="text-[10px] font-bold text-muted-foreground">Context</span>
          <select value={storeType ?? ''} onChange={(e) => setStoreType(e.target.value || null)} className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold">
            {(overview?.items ?? []).map((it) => <option key={it.store_type} value={it.store_type}>{it.store_type} ({NUM(it.events)})</option>)}
          </select>
          <select value={daypart ?? ''} onChange={(e) => setDaypart(e.target.value || null)} className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold">
            <option value="">Daypart 전체</option>{DAYPARTS.map((dp) => <option key={dp} value={dp}>{dp}</option>)}
          </select>
          {busy && <span className="text-[10px] text-muted-foreground">로딩…</span>}
          <code className="ml-auto rounded bg-background px-1.5 py-0.5 text-[10px]">{contextKey}</code>
        </div>
      )}

      {/* ── Agent Overview ── */}
      {tab === 'overview' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="등록 Agent" value={NUM(agents.length)} />
            <Box label="협업 세션" value={NUM(history.length)} />
            <Box label="Governance 필요" value={NUM(history.filter((h) => h.consensus_type === 'governance_required').length)} />
            <Box label="충돌 세션" value={NUM(history.filter((h) => (h.conflicts?.length ?? 0) > 0).length)} />
          </div>
          <AdminAlert tone="info" title="Multi-Agent 구조"
            description="Operational Data → 각 Agent 독립 의견 → Discussion → Consensus → Conflict → Governance → Trust → Draft → Production Change Candidate. 각 단계는 기존 Governance/Draft/Sandbox 흐름과 연동됩니다." />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Agent</th><th className="px-2">Domain</th><th className="px-2">Reputation</th><th className="px-2">결정/승/패</th><th className="px-2">담당</th></tr></thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.agent_code} className="border-b border-border/50">
                    <td className="py-1.5 pr-2 font-bold">{a.name}</td>
                    <td className="px-2 text-[10px] text-muted-foreground">{a.domain}</td>
                    <td className="px-2"><AdminBadge tone={reputationTone(a.reputation)}>{a.reputation}</AdminBadge></td>
                    <td className="px-2">{a.decisions}/{a.wins}/{a.losses}</td>
                    <td className="px-2 text-[10px] text-muted-foreground">{a.responsibilities.slice(0, 3).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Agents (explorer) ── */}
      {tab === 'agents' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {AGENTS.map((a) => <button key={a.code} onClick={() => setSelAgent(a.code)} className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${selAgent === a.code ? 'bg-accent text-black' : 'border border-border text-muted-foreground'}`}>{a.name}</button>)}
          </div>
          {selAgentDef && (
            <AdminCard title={selAgentDef.name}>
              <p className="text-[11px] text-muted-foreground">담당: {selAgentDef.responsibilities.join(' · ')}</p>
              {!selOpinion ? <p className="mt-2 text-[11px] text-muted-foreground">Context 선택 후 의견이 생성됩니다.</p> : (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                  <AdminBadge tone={STANCE_TONE[selOpinion.stance]}>{STANCE_LABEL[selOpinion.stance]}</AdminBadge>
                  <span>Score <b>{selOpinion.score ?? '—'}</b></span>
                  <span>Confidence <b>{selOpinion.confidence}</b></span>
                  <span className="text-muted-foreground">— {selOpinion.rationale}</span>
                </div>
              )}
              <button disabled={busy} onClick={() => { setMemAgent(selAgent); setTab('memory'); void loadMemory(selAgent); }} className="mt-2 rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Memory(읽기 전용) 보기</button>
            </AdminCard>
          )}
        </div>
      )}

      {/* ── Collaboration ── */}
      {tab === 'collaboration' && (
        <div className="space-y-3">
          {!collab ? <AdminEmpty icon={<MessagesSquare size={20} />} title="Context 선택 필요" /> : (
            <>
              <div className="flex items-center gap-2">
                <AdminBadge tone={collab.finalDecision === 'proceed_to_governance' ? 'success' : collab.finalDecision === 'governance_review' ? 'warning' : 'neutral'}>{FINAL_DECISION_LABEL[collab.finalDecision]}</AdminBadge>
                <AdminBadge tone={CONSENSUS_TONE[collab.consensus.type]}>{CONSENSUS_LABEL[collab.consensus.type]}</AdminBadge>
                <span className="text-[10px] text-muted-foreground">Score {collab.consensus.score ?? '—'} · 참여 {collab.consensus.participants} · 충돌 {collab.conflicts.length}</span>
                <button disabled={busy} onClick={() => void runAndSave()} className="ml-auto inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[11px] font-bold text-black disabled:opacity-50"><Play size={12} /> 협업 저장(기록)</button>
              </div>
              <AdminCard title="Agent 의견 (독립 생성)">
                <table className="w-full text-left text-xs">
                  <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1 pr-2">Agent</th><th className="px-2">Stance</th><th className="px-2">Score</th><th className="px-2">Confidence</th><th className="px-2">근거</th></tr></thead>
                  <tbody>
                    {collab.opinions.map((o) => (
                      <tr key={o.agent} className="border-b border-border/50">
                        <td className="py-1 pr-2 font-semibold">{agentDef(o.agent)?.name}</td>
                        <td className="px-2"><AdminBadge tone={STANCE_TONE[o.stance]}>{STANCE_LABEL[o.stance]}</AdminBadge></td>
                        <td className="px-2">{o.score ?? '—'}</td><td className="px-2">{o.confidence}</td>
                        <td className="px-2 text-[10px] text-muted-foreground">{o.rationale}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </AdminCard>
            </>
          )}
        </div>
      )}

      {/* ── Consensus ── */}
      {tab === 'consensus' && (
        <div className="space-y-3">
          {!collab ? <AdminEmpty icon={<Handshake size={20} />} title="Context 선택 필요" /> : (
            <>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Box label="Consensus" value={CONSENSUS_LABEL[collab.consensus.type]} />
                <Box label="Score" value={collab.consensus.score == null ? '데이터 부족' : `${collab.consensus.score}`} />
                <Box label="찬성/반대/중립" value={`${collab.consensus.support}/${collab.consensus.oppose}/${collab.consensus.neutral}`} />
                <Box label="기권" value={`${collab.consensus.abstain}`} />
              </div>
              <AdminAlert tone={CONSENSUS_TONE[collab.consensus.type] === 'warning' ? 'warning' : 'info'} title={CONSENSUS_LABEL[collab.consensus.type]} description={collab.consensus.note} />
              {collab.governanceRequired && <AdminAlert tone="warning" title="Governance Review Required" description="Critical 충돌 또는 Governance Agent 반대 — Governance 검토가 필요합니다." />}
            </>
          )}
        </div>
      )}

      {/* ── Conflict ── */}
      {tab === 'conflict' && (
        <div className="space-y-2">
          {!collab ? <AdminEmpty icon={<Swords size={20} />} title="Context 선택 필요" /> : !collab.conflicts.length ? <AdminEmpty icon={<Swords size={20} />} title="충돌 없음" description="상반 도메인 Agent 간 대립이 없습니다." /> : collab.conflicts.map((c, i) => (
            <div key={i} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={CONFLICT_SEVERITY_TONE[c.severity]}>{c.severity}</AdminBadge>
              <span className="font-semibold">{agentDef(c.a)?.name} ↔ {agentDef(c.b)?.name}</span>
              <span className="text-muted-foreground">— {c.reason}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Agent Reputation ── */}
      {tab === 'reputation' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Agent Reputation (실제 Outcome 으로만 갱신)" description="Agent 는 자신의 Reputation 을 직접 수정할 수 없습니다(Win/Loss 기반)." />
          {reputation.map((r) => (
            <div key={r.agent_code} className="flex items-center gap-2">
              <span className="w-32 text-[11px] font-bold">{r.name}</span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted"><div className={`h-full ${r.reputation >= 65 ? 'bg-emerald-500' : r.reputation >= 45 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${r.reputation}%` }} /></div>
              <span className="w-10 text-right text-[11px]">{r.reputation}</span>
              <span className="w-24 text-right text-[10px] text-muted-foreground">{r.decisions}회 · 승률 {r.win_rate ?? '—'}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Agent Memory ── */}
      {tab === 'memory' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Agent Memory (읽기 전용 Snapshot)" description="Memory 는 기존 Snapshot 을 재사용하며 다른 Agent 가 수정할 수 없습니다." />
          <div className="flex flex-wrap gap-1.5">
            {AGENTS.map((a) => <button key={a.code} onClick={() => void loadMemory(a.code)} className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${memAgent === a.code ? 'bg-accent text-black' : 'border border-border text-muted-foreground'}`}>{a.name}</button>)}
          </div>
          {!memory.length ? <AdminEmpty icon={<Database size={20} />} title="Memory 없음" description="해당 도메인 Snapshot 이 아직 없습니다." /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground">{Object.keys(memory[0]).slice(0, 6).map((k) => <th key={k} className="py-1 px-2">{k}</th>)}</tr></thead>
                <tbody>{memory.slice(0, 20).map((m, i) => <tr key={i} className="border-b border-border/50">{Object.keys(memory[0]).slice(0, 6).map((k) => <td key={k} className="px-2 text-[10px]">{m[k] == null ? '—' : String(m[k]).slice(0, 24)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Support Matrix ── */}
      {tab === 'support' && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Agent</th><th className="px-2">상태</th><th className="px-2">근거</th></tr></thead>
            <tbody>
              {AGENT_SUPPORT.map((s) => (
                <tr key={s.code} className="border-b border-border/50">
                  <td className="py-1.5 pr-2 font-semibold">{s.label}</td>
                  <td className="px-2"><AdminBadge tone={s.status === 'supported' ? 'success' : s.status === 'unsupported' ? 'danger' : 'warning'}>{s.status}</AdminBadge></td>
                  <td className="px-2 text-[10px] text-muted-foreground">{s.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminCard>
  );
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <p className="text-[10px] font-bold text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-black break-words">{value}</p>
    </div>
  );
}
