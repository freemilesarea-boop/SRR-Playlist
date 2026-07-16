/**
 * governanceOrchestration — Enterprise Autonomous Governance, AI Orchestration &
 * Human Oversight Center 순수 로직 (Phase AI-OPS-31).
 *
 * Enterprise → Executive AI OS → Multi-Agent Orchestration → Governance Workflow →
 * Human Oversight → Continuous Supervision.
 * 기존 aiGovernance(0496)/multiAgent(0497)/executiveOS(0533) 모듈을 대체하지 않는
 * Enterprise 계층 조율/감독 — 원본 전부 읽기 전용.
 *
 * AI Governance 정직성(전부 코드로 강제):
 *  - AI Consensus ≠ Truth. Recommendation ≠ Approval. Agent Agreement ≠ Correctness.
 *  - Confidence ≠ Accuracy. Conflict ≠ Error.
 *  - 자동 승인/자동 Agent 생성·삭제/자동 실행/자동 해결 없음 — Approval 은 항상 사람.
 *  - Unknown 유지(null→0 금지). 표본 부족 sample_too_small. 근거 부족 governance_unverified.
 *  - deterministic · pure · null 안전 · cycle 방어.
 */
import { isFiniteNumber, clampScore } from './aiMemory';

/* ── 상수 ─────────────────────────────────────────────────────────────── */
export const ORCHESTRATION_AGENT_KINDS = ['executive', 'strategy', 'finance', 'market', 'risk', 'resource', 'knowledge'] as const;
export const ORCHESTRATION_AGENT_STATUSES = ['active', 'paused', 'disabled', 'unknown'] as const;
export const OVERSIGHT_STATUSES = ['pending_review', 'approved', 'rejected', 'escalated'] as const;
export const GOVERNANCE_WORKFLOW_STAGES = ['proposal', 'review', 'discussion', 'approval', 'execution'] as const;
export const ORCHESTRATION_TIMELINE_STAGES = ['request', 'agent', 'recommendation', 'review', 'approval', 'completion'] as const;
export const AGENT_CONFLICT_TYPES = ['recommendation_conflict', 'evidence_conflict', 'policy_conflict', 'strategy_conflict'] as const;
export const GOVERNANCE_ADVISORY_TYPES = ['review_ai_proposal', 'resolve_conflict', 'gather_more_evidence', 'escalate_decision', 'validate_recommendation'] as const;

/* ── 1) Agent Registry View(7종 kind·4종 status — unknown 유지) ──────── */
export function buildAgentRegistryView(agents: { kind: string; status: string }[] | null): { rows: { kind: string; active: number; paused: number; disabled: number; unknown: number; total: number }[]; invalidAgents: number; totals: Record<(typeof ORCHESTRATION_AGENT_STATUSES)[number], number>; autoAgentChangeDisabled: true } {
  const valid = (agents ?? []).filter((a) => (ORCHESTRATION_AGENT_KINDS as readonly string[]).includes(a.kind) && (ORCHESTRATION_AGENT_STATUSES as readonly string[]).includes(a.status));
  const totals = { active: 0, paused: 0, disabled: 0, unknown: 0 };
  for (const a of valid) totals[a.status as keyof typeof totals] += 1;
  return {
    rows: ORCHESTRATION_AGENT_KINDS.map((kind) => {
      const mine = valid.filter((a) => a.kind === kind);
      const count = (s: string) => mine.filter((a) => a.status === s).length;
      return { kind, active: count('active'), paused: count('paused'), disabled: count('disabled'), unknown: count('unknown'), total: mine.length };
    }),
    invalidAgents: (agents ?? []).length - valid.length,
    totals, autoAgentChangeDisabled: true,
  };
}

/* ── 2) Multi-Agent Orchestration Plan(Routing/Dependency — 자동 실행 없음) ── */
export function planOrchestration(assignments: { taskId: string; agentKind: string; dependsOn: string[] }[] | null): { routes: { taskId: string; agentKind: string; verdict: 'routed' | 'invalid_agent_kind' | 'missing_dependency' }[]; cycles: string[]; autoExecuted: false; executionRequiresHumanApproval: true } {
  const items = (assignments ?? []).slice(0, 200);
  const ids = new Set(items.map((a) => a.taskId));
  const byId = new Map(items.map((a) => [a.taskId, a]));
  const cycles: string[] = [];
  for (const a of items) {
    const path = new Set<string>([a.taskId]);
    let frontier = a.dependsOn.filter((d) => ids.has(d));
    let depth = 0;
    let cycled = false;
    while (frontier.length && depth < 20 && !cycled) {   // depth 방어
      const next: string[] = [];
      for (const d of frontier) {
        if (path.has(d)) { cycles.push(`${a.taskId}→…→${d}`); cycled = true; break; }
        path.add(d);
        next.push(...(byId.get(d)?.dependsOn ?? []).filter((x) => ids.has(x)));
      }
      frontier = next;
      depth += 1;
    }
  }
  return {
    routes: items.map((a) => ({
      taskId: a.taskId,
      agentKind: a.agentKind,
      verdict: !(ORCHESTRATION_AGENT_KINDS as readonly string[]).includes(a.agentKind) ? ('invalid_agent_kind' as const)
        : a.dependsOn.some((d) => !ids.has(d)) ? ('missing_dependency' as const) : ('routed' as const),
    })),
    cycles: [...new Set(cycles)].slice(0, 10),
    autoExecuted: false, executionRequiresHumanApproval: true,
  };
}

/* ── 3) Result Aggregation(Result ≠ Decision — 자동 적용 없음) ───────── */
export function aggregateAgentResults(results: { agentKind: string; recommendation: string; confidence: number | null }[] | null): { groups: { recommendation: string; agents: string[]; measuredConfidences: number }[]; verdict: 'aggregated' | 'insufficient_data'; resultIsNotDecision: true; autoApplied: false } {
  const valid = (results ?? []).filter((r) => (ORCHESTRATION_AGENT_KINDS as readonly string[]).includes(r.agentKind) && r.recommendation.trim() !== '');
  const byRec = new Map<string, { agentKind: string; confidence: number | null }[]>();
  for (const r of valid) {
    const list = byRec.get(r.recommendation) ?? [];
    list.push(r);
    byRec.set(r.recommendation, list);
  }
  return {
    groups: [...byRec.entries()].map(([recommendation, rs]) => ({
      recommendation,
      agents: rs.map((r) => r.agentKind),
      measuredConfidences: rs.filter((r) => r.confidence != null && isFiniteNumber(r.confidence)).length,
    })).slice(0, 50),
    verdict: valid.length ? 'aggregated' : 'insufficient_data',
    resultIsNotDecision: true, autoApplied: false,
  };
}

/* ── 4) AI Consensus Intelligence(Consensus ≠ Truth) ─────────────────── */
export function analyzeConsensus(opinions: { agent: string; stance: string; confidence: number | null }[] | null): { agree: number; disagree: number; abstain: number; unknownStances: number; agreementRatio: number | null; confidenceMeasured: number; confidenceAvg: number | null; verdict: 'agreement_candidate' | 'split' | 'sample_too_small' | 'insufficient_data'; consensusIsNotTruth: true; agreementIsNotCorrectness: true; confidenceIsNotAccuracy: true } {
  const items = opinions ?? [];
  const agree = items.filter((o) => o.stance === 'agree').length;
  const disagree = items.filter((o) => o.stance === 'disagree').length;
  const abstain = items.filter((o) => o.stance === 'abstain').length;
  const unknownStances = items.length - agree - disagree - abstain;
  const voiced = agree + disagree;
  const confidences = items.map((o) => o.confidence).filter((c): c is number => c != null && isFiniteNumber(c)).map(clampScore);
  const verdict = !items.length ? ('insufficient_data' as const)
    : voiced < 3 ? ('sample_too_small' as const)
    : agree > disagree * 2 ? ('agreement_candidate' as const) : ('split' as const);
  return {
    agree, disagree, abstain, unknownStances,
    agreementRatio: voiced >= 3 ? Math.round((100 * agree) / voiced) : null,   // 표본 부족 시 null 유지(0 아님)
    confidenceMeasured: confidences.length,
    confidenceAvg: confidences.length >= 3 ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length) : null,
    verdict, consensusIsNotTruth: true, agreementIsNotCorrectness: true, confidenceIsNotAccuracy: true,
  };
}

/* ── 5) Conflict Resolution Intelligence(Conflict ≠ Error — 자동 해결 없음) ── */
export function detectAgentConflicts(items: { a: string; b: string; kind: string; note: string }[] | null): { rows: { kind: string; count: number; pairs: string[] }[]; invalidConflicts: number; totalConflicts: number; conflictIsNotError: true; autoResolved: false; resolutionRequiresHuman: true } {
  const valid = (items ?? []).filter((c) => (AGENT_CONFLICT_TYPES as readonly string[]).includes(c.kind));
  return {
    rows: AGENT_CONFLICT_TYPES.map((kind) => {
      const mine = valid.filter((c) => c.kind === kind);
      return { kind, count: mine.length, pairs: mine.slice(0, 10).map((c) => `${c.a}↔${c.b}`) };
    }),
    invalidConflicts: (items ?? []).length - valid.length,
    totalConflicts: valid.length,
    conflictIsNotError: true, autoResolved: false, resolutionRequiresHuman: true,
  };
}

/* ── 6) Governance Workflow(Approval 은 항상 사람) ───────────────────── */
export function buildGovernanceWorkflow(events: { workflowKey: string; stage: string; actor: 'human' | 'ai' | 'unknown' }[] | null): { workflows: { workflowKey: string; stages: string[]; humanApproved: boolean; verdict: 'in_review' | 'approved_by_human' | 'executed_after_approval' | 'blocked_execution_without_approval' | 'governance_unverified' }[]; invalidEvents: number; approvalAlwaysHuman: true; autoApproved: false } {
  const valid = (events ?? []).filter((e) => (GOVERNANCE_WORKFLOW_STAGES as readonly string[]).includes(e.stage) && e.workflowKey.trim() !== '');
  const keys = [...new Set(valid.map((e) => e.workflowKey))].slice(0, 50);
  return {
    workflows: keys.map((workflowKey) => {
      const mine = valid.filter((e) => e.workflowKey === workflowKey);
      const stages = GOVERNANCE_WORKFLOW_STAGES.filter((s) => mine.some((e) => e.stage === s));
      const humanApproved = mine.some((e) => e.stage === 'approval' && e.actor === 'human');
      const aiApprovalAttempt = mine.some((e) => e.stage === 'approval' && e.actor !== 'human');
      const executed = mine.some((e) => e.stage === 'execution');
      const verdict = executed && !humanApproved ? ('blocked_execution_without_approval' as const)
        : aiApprovalAttempt && !humanApproved ? ('governance_unverified' as const)   // 사람 아닌 approval 은 승인으로 인정하지 않음
        : executed && humanApproved ? ('executed_after_approval' as const)
        : humanApproved ? ('approved_by_human' as const) : ('in_review' as const);
      return { workflowKey, stages: [...stages], humanApproved, verdict };
    }),
    invalidEvents: (events ?? []).length - valid.length,
    approvalAlwaysHuman: true, autoApproved: false,
  };
}

/* ── 9) Executive Orchestration Timeline(6단계 실측 집계) ────────────── */
export function buildOrchestrationTimeline(counts: { stage: string; count: number | null; source: string }[] | null): { stages: { stage: string; count: number | null; source: string; status: 'measured' | 'insufficient_data' }[]; invalidStages: number; timelineIsNotCompletionClaim: true } {
  const valid = (counts ?? []).filter((c) => (ORCHESTRATION_TIMELINE_STAGES as readonly string[]).includes(c.stage));
  const byStage = new Map(valid.map((c) => [c.stage, c]));
  return {
    stages: ORCHESTRATION_TIMELINE_STAGES.map((stage) => {
      const c = byStage.get(stage);
      const count = c && c.count != null && isFiniteNumber(c.count) ? c.count : null;
      return { stage, count, source: c?.source ?? '원본 없음', status: count != null ? ('measured' as const) : ('insufficient_data' as const) };
    }),
    invalidStages: (counts ?? []).length - valid.length,
    timelineIsNotCompletionClaim: true,
  };
}

/* ── 8) Autonomous Advisory Hub(5종 whitelist·Evidence 필수) ─────────── */
export function buildGovernanceAdvisory(i: { type: string; reason: string; evidence: string[]; confidence: number | null; assumptions: string[] }):
  | { rejected: true; rejectReason: string }
  | { type: string; reason: string; evidence: string[]; confidence: number | null; assumptions: string[]; limitations: string[]; humanApprovalRequired: true; approvalImplied: false } {
  if (!(GOVERNANCE_ADVISORY_TYPES as readonly string[]).includes(i.type)) return { rejected: true, rejectReason: `허용되지 않는 advisory type: ${i.type}` };
  if (!i.evidence.length) return { rejected: true, rejectReason: 'Evidence 없는 권고 금지(governance_unverified)' };
  if (!i.reason.trim()) return { rejected: true, rejectReason: 'Reason 필수' };
  return {
    type: i.type, reason: i.reason, evidence: i.evidence.slice(0, 10),
    confidence: i.confidence != null && isFiniteNumber(i.confidence) ? clampScore(i.confidence) : null,
    assumptions: i.assumptions.slice(0, 10),
    limitations: ['Recommendation ≠ Approval', 'AI Consensus ≠ Truth', 'Confidence ≠ Accuracy'],
    humanApprovalRequired: true, approvalImplied: false,
  };
}

/* ── 7/10) AI Governance Cockpit(6영역 — Supervision 통합) ───────────── */
export function buildGovernanceCockpit(i: { activeAgents: number | null; totalAgents: number | null; pendingReviews: number | null; escalations: number | null; consensusVerdict: string | null; conflictsOpen: number | null; summaryNote: string | null }): { sections: { key: string; headline: string; detail: string }[]; humanDecisionRequired: true; autoApproved: false; executiveDecisionMade: false } {
  const n = (x: number | null) => (x != null && isFiniteNumber(x) ? String(x) : 'insufficient_data');
  return {
    sections: [
      { key: 'agent_registry', headline: i.totalAgents != null && i.activeAgents != null ? `${i.activeAgents}/${i.totalAgents}` : 'insufficient_data', detail: 'Active/Total — 자동 생성·삭제 없음' },
      { key: 'orchestration', headline: n(i.conflictsOpen), detail: '기록된 Conflict — 자동 실행/자동 해결 없음' },
      { key: 'governance', headline: 'human_approval', detail: 'Proposal→Review→Discussion→Approval→Execution — Approval 은 항상 사람' },
      { key: 'oversight', headline: n(i.pendingReviews), detail: 'Pending Review — 사람 결정 대기' },
      { key: 'consensus', headline: i.consensusVerdict ?? 'insufficient_data', detail: 'AI Consensus ≠ Truth · Agreement ≠ Correctness' },
      { key: 'executive_summary', headline: i.summaryNote ? 'note' : `escalations ${n(i.escalations)}`, detail: i.summaryNote ?? 'Recommendation ≠ Approval · Confidence ≠ Accuracy' },
    ],
    humanDecisionRequired: true, autoApproved: false, executiveDecisionMade: false,
  };
}

/* ── Support Matrix ──────────────────────────────────────────────────── */
export const GOVERNANCE_OS_SUPPORT: { key: string; status: 'supported' | 'partial' | 'unsupported'; note: string }[] = [
  { key: 'agent_registry', status: 'supported', note: '7종 Enterprise Agent 레지스트리(사람 등록/상태 변경만)' },
  { key: 'multi_agent_orchestration', status: 'supported', note: 'Assignment/Routing/Dependency 계획 기록 — 자동 실행 없음' },
  { key: 'result_aggregation', status: 'supported', note: 'Agent 결과 비교/집계 — Result ≠ Decision' },
  { key: 'consensus_intelligence', status: 'supported', note: '0497 collaboration 실측 재사용 — Consensus ≠ Truth' },
  { key: 'conflict_intelligence', status: 'supported', note: '4종 Conflict 감지/기록 — Conflict ≠ Error·자동 해결 없음' },
  { key: 'human_oversight', status: 'supported', note: 'Pending/Approved/Rejected/Escalated — 승인/반려 Evidence 필수' },
  { key: 'governance_workflow', status: 'supported', note: 'Proposal→…→Execution — Approval 없는 Execution 서버 차단' },
  { key: 'orchestration_timeline', status: 'supported', note: 'Request→…→Completion 6단계 실측 집계' },
  { key: 'advisory_hub', status: 'supported', note: '5종 whitelist·Evidence 필수 — Recommendation ≠ Approval' },
  { key: 'supervision_dashboard', status: 'supported', note: 'Active Agents/Pending/Consensus/Escalations 실측' },
  { key: 'constitution_reuse_0496', status: 'supported', note: 'HUMAN_APPROVAL_REQUIRED 등 immutable rule 읽기 전용 참조' },
  { key: 'agent_runtime_scheduler', status: 'unsupported', note: 'Agent 실행 런타임/스케줄러 원본 없음 — 계획/기록만' },
  { key: 'realtime_agent_telemetry', status: 'unsupported', note: '실시간 Agent 텔레메트리 원본 없음' },
  { key: 'auto_approval', status: 'unsupported', note: '자동 승인 금지 — Approval 은 항상 사람' },
  { key: 'auto_conflict_resolution', status: 'unsupported', note: '자동 충돌 해결 금지 — 감지/기록만' },
  { key: 'auto_production_change', status: 'unsupported', note: '자동 조직/전략/Production/Merge/Deploy 금지' },
];
