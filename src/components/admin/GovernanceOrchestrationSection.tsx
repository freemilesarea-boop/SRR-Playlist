/**
 * GovernanceOrchestrationSection — Enterprise Autonomous Governance, AI Orchestration &
 * Human Oversight Center (Phase AI-OPS-31).
 *
 * Enterprise→Executive AI OS→Multi-Agent Orchestration→Governance Workflow→Human Oversight→Continuous Supervision.
 * 기존 aiGovernance(0496)/multiAgent(0497)/executiveOS(0533) 모듈 대체 없음 — 읽기 전용 참조 ·
 * AI Consensus ≠ Truth · Recommendation ≠ Approval · Agent Agreement ≠ Correctness ·
 * Confidence ≠ Accuracy · Conflict ≠ Error · Approval 은 항상 사람.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Bot, GitBranch, Grid3x3, History, Layers, Lightbulb, Lock,
  Network, Radar, RefreshCw, Scale, ScrollText, Users,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchOrchestrationSummary, fetchOrchestrationAgents, registerOrchestrationAgent,
  setOrchestrationAgentStatus, recordOrchestrationEvent, fetchOrchestrationAudit,
  type OrchestrationSummary, type OrchestrationAgentRow, type OrchestrationEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  buildAgentRegistryView, planOrchestration, aggregateAgentResults, analyzeConsensus,
  detectAgentConflicts, buildGovernanceWorkflow, buildOrchestrationTimeline,
  buildGovernanceAdvisory, buildGovernanceCockpit,
  ORCHESTRATION_AGENT_KINDS, ORCHESTRATION_AGENT_STATUSES, GOVERNANCE_OS_SUPPORT,
} from '@/lib/governanceOrchestration';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'cockpit' | 'supervision' | 'registry' | 'orchestration' | 'consensus' | 'conflicts'
  | 'oversight' | 'workflow' | 'timeline' | 'advisory' | 'humanreviews' | 'external' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'cockpit', label: 'AI Governance Cockpit', icon: Layers },
  { key: 'supervision', label: 'Executive Supervision', icon: Radar },
  { key: 'registry', label: 'AI Agent Registry', icon: Bot },
  { key: 'orchestration', label: 'Multi-Agent Orchestration', icon: Network },
  { key: 'consensus', label: 'AI Consensus Intelligence', icon: Users },
  { key: 'conflicts', label: 'Conflict Intelligence', icon: AlertTriangle },
  { key: 'oversight', label: 'Human Oversight', icon: Scale },
  { key: 'workflow', label: 'Governance Workflow', icon: GitBranch },
  { key: 'timeline', label: 'Orchestration Timeline', icon: History },
  { key: 'advisory', label: 'Autonomous Advisory Hub', icon: Lightbulb },
  { key: 'humanreviews', label: 'Human Reviews', icon: Scale },
  { key: 'external', label: 'External References', icon: ScrollText },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

export default function GovernanceOrchestrationSection() {
  const [tab, setTab] = useState<Tab>('cockpit');
  const [summary, setSummary] = useState<OrchestrationSummary>({});
  const [agents, setAgents] = useState<OrchestrationAgentRow[]>([]);
  const [audit, setAudit] = useState<OrchestrationEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [agentName, setAgentName] = useState('');
  const [agentKind, setAgentKind] = useState<string>('executive');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, ag, au] = await Promise.all([fetchOrchestrationSummary(), fetchOrchestrationAgents(200), fetchOrchestrationAudit(150)]);
      setSummary(s); setAgents(ag); setAudit(au);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await load(); }
    catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };
  const needReason = (): string | null => {
    if (!reason.trim()) { toast.error('사유/내용 필수(Human Oversight)'); return null; }
    return reason.trim();
  };

  const obj = useCallback((k: string): Record<string, unknown> => (typeof summary[k] === 'object' && summary[k] !== null && !Array.isArray(summary[k]) ? summary[k] as Record<string, unknown> : {}), [summary]);
  const num = useCallback((k: string, sub: string): number | null => {
    const v = obj(k)[sub];
    return typeof v === 'number' ? v : null;
  }, [obj]);

  const registry = useMemo(() => buildAgentRegistryView(agents.map((a) => ({ kind: a.agent_kind, status: a.agent_status }))), [agents]);

  const plan = useMemo(() => planOrchestration(agents.filter((a) => a.agent_status !== 'disabled').slice(0, 30).map((a) => ({
    taskId: `${a.agent_kind}_review`, agentKind: a.agent_kind, dependsOn: [],   // Dependency 원본 없음 — 계획 기록만
  }))), [agents]);

  const aggregation = useMemo(() => aggregateAgentResults([]), []);   // Enterprise 계층 Agent 결과 원본 없음 — insufficient_data 정직 유지

  const consensus = useMemo(() => analyzeConsensus([]), []);   // 의견 단위 원본은 0497 모듈 조회 — 여기서는 분포 실측만 표시
  const consensusDist = useMemo(() => {
    const d = obj('music_agents_0497')['consensus_distribution'];
    return typeof d === 'object' && d !== null && !Array.isArray(d) ? d as Record<string, number> : {};
  }, [obj]);

  const conflicts = useMemo(() => detectAgentConflicts(audit.filter((e) => e.event_type === 'conflict_detected').map((e) => ({
    a: String(e.payload?.a ?? 'unknown'), b: String(e.payload?.b ?? 'unknown'),
    kind: String(e.payload?.conflict_type ?? ''), note: e.detail ?? '',
  }))), [audit]);

  const workflow = useMemo(() => buildGovernanceWorkflow(audit.filter((e) => e.event_type === 'workflow_stage_advanced' && e.workflow_key && e.workflow_stage).map((e) => ({
    workflowKey: e.workflow_key as string, stage: e.workflow_stage as string, actor: 'human' as const,   // 기록 주체는 항상 관리자 RPC(사람)
  }))), [audit]);

  const timeline = useMemo(() => buildOrchestrationTimeline([
    { stage: 'request', count: audit.filter((e) => e.event_type === 'task_routed').length, source: 'task_routed 이벤트 실측' },
    { stage: 'agent', count: num('orchestration_agents', 'total'), source: '레지스트리 실측' },
    { stage: 'recommendation', count: audit.filter((e) => e.event_type === 'orchestration_advisory_created').length, source: 'advisory 이벤트 실측' },
    { stage: 'review', count: num('oversight', 'requested'), source: 'oversight_requested 실측' },
    { stage: 'approval', count: num('oversight', 'approved'), source: 'oversight_approved 실측' },
    { stage: 'completion', count: audit.filter((e) => e.event_type === 'workflow_stage_advanced' && e.workflow_stage === 'execution').length, source: 'execution 기록 실측(승인 선행 필수)' },
  ]), [audit, num]);

  const advisories = useMemo(() => {
    const out: { type: string; reason: string }[] = [];
    const push = (r: ReturnType<typeof buildGovernanceAdvisory>) => { if (!('rejected' in r)) out.push({ type: r.type, reason: r.reason }); };
    const pending = num('oversight', 'requested');
    const approvedOrRejected = (num('oversight', 'approved') ?? 0) + (num('oversight', 'rejected') ?? 0);
    if (pending != null && pending > approvedOrRejected) push(buildGovernanceAdvisory({ type: 'review_ai_proposal', reason: `Oversight 요청 ${pending}건 중 미처리 존재 — 사람 검토 필요`, evidence: ['oversight 실측'], confidence: null, assumptions: [] }));
    if (conflicts.totalConflicts > 0) push(buildGovernanceAdvisory({ type: 'resolve_conflict', reason: `기록된 Conflict ${conflicts.totalConflicts}건 — 사람 해결 검토(자동 해결 없음)`, evidence: ['conflict_detected 실측'], confidence: null, assumptions: [] }));
    if (registry.totals.unknown > 0) push(buildGovernanceAdvisory({ type: 'gather_more_evidence', reason: `unknown 상태 Agent ${registry.totals.unknown}개 — 근거 확보 전 해석 금지`, evidence: ['레지스트리 실측'], confidence: null, assumptions: [] }));
    const escalated = num('oversight', 'escalated');
    if (escalated != null && escalated > 0) push(buildGovernanceAdvisory({ type: 'escalate_decision', reason: `Escalation ${escalated}건 — 상위 사람 결정 대기`, evidence: ['oversight_escalated 실측'], confidence: null, assumptions: [] }));
    if ((consensusDist['governance_required'] ?? 0) > 0 || (consensusDist['insufficient_data'] ?? 0) > 0) push(buildGovernanceAdvisory({ type: 'validate_recommendation', reason: '0497 협업에 governance_required/insufficient_data 존재 — 권고 재검증 필요', evidence: ['0497 consensus 실측'], confidence: null, assumptions: [] }));
    return out;
  }, [num, conflicts, registry, consensusDist]);

  const cockpit = useMemo(() => buildGovernanceCockpit({
    activeAgents: num('orchestration_agents', 'active'),
    totalAgents: num('orchestration_agents', 'total'),
    pendingReviews: num('oversight', 'requested'),
    escalations: num('oversight', 'escalated'),
    consensusVerdict: consensus.verdict,
    conflictsOpen: num('oversight', 'conflicts_detected'),
    summaryNote: null,
  }), [num, consensus]);

  if (loading) return <AdminCard title="Enterprise Autonomous Governance & AI Orchestration"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Enterprise Autonomous Governance & AI Orchestration">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  return (
    <AdminCard
      title="Enterprise Autonomous Governance & AI Orchestration"
      subtitle="Executive AI OS→Multi-Agent Orchestration→Governance Workflow→Human Oversight→Continuous Supervision — 0496/0497/0533 읽기 전용 참조(모듈 대체 없음)"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="자동 승인, 자동 Agent 생성/삭제, 자동 조직/전략 변경, 자동 Production/Merge/Deploy 는 없습니다. Agent 결과는 자동 적용되지 않으며 최종 결정은 항상 사람이 합니다. AI Consensus ≠ Truth, Recommendation ≠ Approval, Agent Agreement ≠ Correctness, Confidence ≠ Accuracy, Conflict ≠ Error. Approval 없는 Execution 기록은 서버에서 차단됩니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {/* ── AI Governance Cockpit(6영역) ── */}
      {tab === 'cockpit' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {cockpit.sections.map((s) => (
              <div key={s.key} className="rounded-lg border border-border p-2">
                <p className="text-[10px] font-bold uppercase text-muted-foreground">{s.key}</p>
                <p className="mt-0.5 text-sm font-black">{s.headline}</p>
                <p className="text-[10px] text-muted-foreground">{s.detail}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">humanDecisionRequired · autoApproved=false · executiveDecisionMade=false</p>
        </div>
      )}

      {/* ── Executive Supervision Dashboard ── */}
      {tab === 'supervision' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Active Agents(신규 레지스트리)" value={`${NUM(num('orchestration_agents', 'active'))}/${NUM(num('orchestration_agents', 'total'))}`} />
            <Box label="Pending Reviews" value={NUM(num('oversight', 'requested'))} />
            <Box label="Escalations" value={NUM(num('oversight', 'escalated'))} />
            <Box label="Conflicts Detected" value={NUM(num('oversight', 'conflicts_detected'))} />
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Music Agents(0497 실측)" value={`${NUM(num('music_agents_0497', 'active'))}/${NUM(num('music_agents_0497', 'total'))}`} />
            <Box label="Collaborations(0497)" value={NUM(num('music_agents_0497', 'collaborations'))} />
            <Box label="Approvals(0496)" value={NUM(num('governance_actuals', 'approvals_0496'))} />
            <Box label="Human Overrides(0496)" value={NUM(num('governance_actuals', 'human_overrides_0496'))} />
          </div>
          <AdminAlert tone="info" description={`governance_unavailable: ${Array.isArray(summary.governance_unavailable) ? (summary.governance_unavailable as unknown[]).map(String).join(', ') : '—'} — Agent 실행 런타임/외부 워크플로 엔진/실시간 텔레메트리 원본 없음. Supervision 은 조회 시점 실측 기준입니다.`} />
        </div>
      )}

      {/* ── Agent Registry ── */}
      {tab === 'registry' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <select value={agentKind} onChange={(e) => setAgentKind(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {ORCHESTRATION_AGENT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <input value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="Agent 이름(필수)" className="min-w-[160px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
            <button disabled={busy} onClick={() => {
              if (!agentName.trim()) { toast.error('Agent 이름 필수'); return; }
              void act(() => registerOrchestrationAgent(agentKind, agentName.trim(), null, '0533 summary 읽기 전용 참조'), 'Agent 등록(사람) — unknown 시작');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Agent 등록(사람)</button>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {(['active', 'paused', 'disabled', 'unknown'] as const).map((s) => <Box key={s} label={s} value={NUM(registry.totals[s])} />)}
          </div>
          {!agents.length ? <AdminEmpty title="등록된 Agent 없음" description="Enterprise Orchestration Agent 는 사람이 등록합니다(자동 생성 없음)." /> : (
            <div className="space-y-1">
              {agents.slice(0, 30).map((a) => (
                <div key={a.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <span className="font-bold">{a.agent_name}</span>
                  <AdminBadge tone="info">{a.agent_kind}</AdminBadge>
                  <AdminBadge tone={a.agent_status === 'active' ? 'success' : a.agent_status === 'disabled' ? 'danger' : a.agent_status === 'paused' ? 'warning' : 'neutral'}>{a.agent_status}</AdminBadge>
                  <span className="ml-2 text-muted-foreground">{a.linked_source ?? ''}</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {ORCHESTRATION_AGENT_STATUSES.filter((s) => s !== a.agent_status).map((s) => (
                      <button key={s} disabled={busy} onClick={() => {
                        const r = needReason(); if (!r) return;
                        void act(() => setOrchestrationAgentStatus(a.id, s, r), `상태 변경(사람): ${s}`);
                      }} className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">→ {s}</button>
                    ))}
                  </div>
                </div>
              ))}
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="상태 변경 사유(필수)" className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">신규 Agent 는 unknown 으로 시작(실측 전 active 금지) · 삭제 RPC 없음(disabled 도 기록 유지) · invalid {registry.invalidAgents}건 제외</p>
        </div>
      )}

      {/* ── Orchestration ── */}
      {tab === 'orchestration' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy || !plan.routes.length} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => recordOrchestrationEvent('task_routed', r, { routes: plan.routes }), 'Routing 계획 기록(자동 실행 없음)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Routing 계획 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="기록 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!plan.routes.length ? <AdminEmpty title="Routing 대상 없음" description="disabled 가 아닌 Agent 가 없습니다 — 먼저 Agent 를 등록하세요." /> : (
            <div className="space-y-1">
              {plan.routes.map((r) => (
                <div key={r.taskId} className="rounded-lg border border-border p-2 text-[11px]">
                  <span className="font-bold">{r.taskId}</span>
                  <AdminBadge tone={r.verdict === 'routed' ? 'info' : 'warning'}>{r.verdict}</AdminBadge>
                  <span className="ml-2 text-muted-foreground">{r.agentKind} · 자동 실행 없음(계획 기록)</span>
                </div>
              ))}
            </div>
          )}
          {plan.cycles.length > 0 && <AdminAlert tone="danger" title="Dependency Cycle 감지" description={plan.cycles.join(' · ')} />}
          <div className="rounded-lg border border-border p-2 text-[11px]">
            <span className="font-bold">Result Aggregation</span>
            <AdminBadge tone={aggregation.verdict === 'aggregated' ? 'info' : 'warning'}>{aggregation.verdict}</AdminBadge>
            <span className="ml-2 text-muted-foreground">Enterprise 계층 Agent 결과 원본 없음 — Result ≠ Decision·자동 적용 없음</span>
          </div>
          <p className="text-[10px] text-muted-foreground">Assignment/Routing/Dependency 는 계획 기록만 — Agent 실행 런타임 원본 없음 · executionRequiresHumanApproval=true</p>
        </div>
      )}

      {/* ── Consensus / Conflicts ── */}
      {tab === 'consensus' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            {Object.entries(consensusDist).length ? Object.entries(consensusDist).map(([k, v]) => <Box key={k} label={`${k}(0497 실측)`} value={NUM(v)} />) : <Box label="Consensus 분포(0497)" value="기록 없음" />}
          </div>
          <div className="rounded-lg border border-border p-2 text-[11px]">
            <span className="font-bold">Enterprise 계층 의견 분석</span>
            <AdminBadge tone="warning">{consensus.verdict}</AdminBadge>
            <span className="ml-2 text-muted-foreground">의견 단위 원본은 0497 Multi-Agent 모듈에서 조회 — 이 계층은 분포 실측만 표시(가짜 합의 생성 없음)</span>
          </div>
          <button disabled={busy} onClick={() => {
            const r = needReason(); if (!r) return;
            void act(() => recordOrchestrationEvent('consensus_analyzed', r, { distribution_0497: consensusDist }), 'Consensus 분석 기록(Consensus ≠ Truth)');
          }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Consensus 분석 기록</button>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="기록 사유(필수)" className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          <p className="text-[10px] text-muted-foreground">AI Consensus ≠ Truth · Agreement ≠ Correctness · Confidence ≠ Accuracy · 표본 부족 시 sample_too_small(0 변환 없음)</p>
        </div>
      )}
      {tab === 'conflicts' && (
        <div className="space-y-1">
          {conflicts.rows.map((r) => (
            <div key={r.kind} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{r.kind}</span>
              <AdminBadge tone={r.count ? 'warning' : 'neutral'}>{r.count}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{r.pairs.join(' · ') || '기록 없음'}</span>
            </div>
          ))}
          <AdminAlert tone="info" description="Conflict ≠ Error — 충돌은 오류가 아니라 사람 검토 대상입니다. 자동 해결은 없으며(autoResolved=false) 0497 collaboration conflicts 원본은 Multi-Agent 모듈에서 조회합니다." />
        </div>
      )}

      {/* ── Oversight / Workflow / Timeline ── */}
      {tab === 'oversight' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Pending Review" value={NUM(num('oversight', 'requested'))} />
            <Box label="Approved" value={NUM(num('oversight', 'approved'))} />
            <Box label="Rejected" value={NUM(num('oversight', 'rejected'))} />
            <Box label="Escalated" value={NUM(num('oversight', 'escalated'))} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => recordOrchestrationEvent('oversight_requested', r, { source: 'admin_ui' }, { oversightStatus: 'pending_review' }), 'Oversight 요청 기록(사람 결정 대기)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Oversight 요청 기록</button>
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => recordOrchestrationEvent('oversight_escalated', r, { source: 'admin_ui' }, { oversightStatus: 'escalated' }), 'Escalation 기록(사람 결정 대기)');
            }} className="rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50">Escalation 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          <p className="text-[10px] text-muted-foreground">승인/반려 기록은 Evidence 필수(서버 차단) — Evidence 없는 승인/반려는 governance_unverified 로 거부됩니다.</p>
        </div>
      )}
      {tab === 'workflow' && (
        <div className="space-y-1">
          {!workflow.workflows.length ? <AdminEmpty title="Workflow 기록 없음" description="AI Proposal→Review→Discussion→Approval→Execution — Approval 은 항상 사람입니다." /> : workflow.workflows.map((w) => (
            <div key={w.workflowKey} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{w.workflowKey}</span>
              <AdminBadge tone={w.verdict === 'executed_after_approval' ? 'success' : w.verdict === 'blocked_execution_without_approval' ? 'danger' : w.verdict === 'approved_by_human' ? 'info' : 'neutral'}>{w.verdict}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{w.stages.join('→') || '—'} · humanApproved={String(w.humanApproved)}</span>
            </div>
          ))}
          <AdminAlert tone="info" description="Approval 없는 Execution 은 서버(0534)와 클라이언트 로직 양쪽에서 차단/표시됩니다. approvalAlwaysHuman=true · autoApproved=false" />
        </div>
      )}
      {tab === 'timeline' && (
        <div className="space-y-1">
          {timeline.stages.map((s) => (
            <div key={s.stage} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.status === 'measured' ? 'info' : 'warning'}>{s.stage}</AdminBadge>
              <span className="ml-2">{s.count == null ? 'null(원본 없음)' : NUM(s.count)}</span>
              <span className="ml-2 text-muted-foreground">{s.source} · timelineIsNotCompletionClaim</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">Request→Agent→Recommendation→Review→Approval→Completion 6단계 실측 집계</p>
        </div>
      )}

      {/* ── Advisory ── */}
      {tab === 'advisory' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy || !advisories.length} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => recordOrchestrationEvent('orchestration_advisory_created', r, { advisories: advisories.map((a) => a.type) }), 'Advisory 기록(Recommendation ≠ Approval)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Advisory 검토 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="기록 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!advisories.length ? <AdminEmpty title="권고 없음" description="Evidence 없는 권고는 생성되지 않습니다(governance_unverified)." /> : (
            <div className="space-y-1">
              {advisories.map((a, i) => (
                <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
                  <AdminBadge tone="info">{a.type}</AdminBadge>
                  <span className="ml-2">{a.reason}</span>
                  <p className="mt-1 text-[10px] text-muted-foreground">humanApprovalRequired · Recommendation ≠ Approval · AI Consensus ≠ Truth</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Reviews / External / Audit / Support ── */}
      {tab === 'humanreviews' && (() => {
        const reviews = audit.filter((e) => ['oversight_approved', 'oversight_rejected', 'oversight_escalated', 'agent_status_changed'].includes(e.event_type));
        return !reviews.length ? <AdminEmpty title="검토 이력 없음" description="승인/반려/Escalation/Agent 상태 변경은 전부 사람이 수행합니다(자동 결정 없음)." /> : (
          <div className="space-y-1">
            {reviews.slice(0, 40).map((e) => (
              <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone={e.event_type === 'oversight_approved' ? 'success' : e.event_type === 'oversight_rejected' ? 'danger' : 'info'}>{e.event_type}</AdminBadge>
                <span className="ml-2">{e.detail}</span>
              </div>
            ))}
          </div>
        );
      })()}
      {tab === 'external' && (() => {
        const ext = audit.filter((e) => e.event_type === 'external_governance_reference');
        return !ext.length ? <AdminEmpty title="외부 참조 없음" description="외부 거버넌스 자료는 참조로만 기록됩니다." /> : (
          <div className="space-y-1">
            {ext.slice(0, 30).map((e) => (
              <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]"><span className="font-mono text-muted-foreground">{e.created_at.slice(0, 16).replace('T', ' ')}</span><span className="ml-2">{e.detail}</span></div>
            ))}
          </div>
        );
      })()}
      {tab === 'audit' && (
        <div className="space-y-2">
          {!audit.length ? <AdminEmpty title="Audit 없음" description="조율/감독 활동이 이벤트로 남습니다(16종 whitelist)." /> : audit.slice(0, 60).map((e) => (
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
          {GOVERNANCE_OS_SUPPORT.map((s) => (
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
