import { describe, expect, it } from 'vitest';
import {
  aggregateAgentResults,
  analyzeConsensus,
  buildAgentRegistryView,
  buildGovernanceAdvisory,
  buildGovernanceCockpit,
  buildGovernanceWorkflow,
  buildOrchestrationTimeline,
  detectAgentConflicts,
  GOVERNANCE_OS_SUPPORT,
  ORCHESTRATION_AGENT_KINDS,
  planOrchestration,
} from './governanceOrchestration';

describe('agent registry — 7종 kind·4종 status·unknown 유지', () => {
  it('whitelist 밖 kind/status 제외 + 자동 변경 없음', () => {
    const r = buildAgentRegistryView([
      { kind: 'executive', status: 'active' },
      { kind: 'risk', status: 'unknown' },
      { kind: 'risk', status: 'paused' },
      { kind: 'bogus', status: 'active' },
      { kind: 'finance', status: 'running' },   // 허용되지 않는 status
    ]);
    expect(r.rows).toHaveLength(7);
    expect(r.rows.find((x) => x.kind === 'risk')?.unknown).toBe(1);
    expect(r.rows.find((x) => x.kind === 'risk')?.total).toBe(2);
    expect(r.invalidAgents).toBe(2);
    expect(r.totals.active).toBe(1);
    expect(r.autoAgentChangeDisabled).toBe(true);
  });
});

describe('orchestration plan — 자동 실행 없음·cycle 방어', () => {
  it('routing whitelist + missing dependency + cycle 감지', () => {
    const r = planOrchestration([
      { taskId: 't1', agentKind: 'strategy', dependsOn: [] },
      { taskId: 't2', agentKind: 'bogus', dependsOn: ['t1'] },
      { taskId: 't3', agentKind: 'risk', dependsOn: ['missing'] },
      { taskId: 'a', agentKind: 'finance', dependsOn: ['b'] },
      { taskId: 'b', agentKind: 'market', dependsOn: ['a'] },
    ]);
    expect(r.routes.find((x) => x.taskId === 't1')?.verdict).toBe('routed');
    expect(r.routes.find((x) => x.taskId === 't2')?.verdict).toBe('invalid_agent_kind');
    expect(r.routes.find((x) => x.taskId === 't3')?.verdict).toBe('missing_dependency');
    expect(r.cycles.length).toBeGreaterThan(0);
    expect(r.autoExecuted).toBe(false);
    expect(r.executionRequiresHumanApproval).toBe(true);
  });
});

describe('result aggregation — Result ≠ Decision', () => {
  it('추천별 그룹 + 빈 입력 insufficient_data + 자동 적용 없음', () => {
    const r = aggregateAgentResults([
      { agentKind: 'strategy', recommendation: 'expand', confidence: 70 },
      { agentKind: 'finance', recommendation: 'expand', confidence: null },
      { agentKind: 'risk', recommendation: 'hold', confidence: 40 },
    ]);
    expect(r.groups.find((g) => g.recommendation === 'expand')?.agents).toEqual(['strategy', 'finance']);
    expect(r.groups.find((g) => g.recommendation === 'expand')?.measuredConfidences).toBe(1);
    expect(r.verdict).toBe('aggregated');
    expect(r.resultIsNotDecision).toBe(true);
    expect(aggregateAgentResults([]).verdict).toBe('insufficient_data');
    expect(r.autoApplied).toBe(false);
  });
});

describe('consensus — Consensus ≠ Truth·표본 부족 sample_too_small', () => {
  it('표본<3 → sample_too_small + ratio null(0 아님)', () => {
    const small = analyzeConsensus([
      { agent: 'strategy', stance: 'agree', confidence: 60 },
      { agent: 'risk', stance: 'disagree', confidence: null },
    ]);
    expect(small.verdict).toBe('sample_too_small');
    expect(small.agreementRatio).toBeNull();
    expect(analyzeConsensus([]).verdict).toBe('insufficient_data');
  });
  it('agree 우세 → agreement_candidate(Truth 아님) + confidence<3 avg null', () => {
    const r = analyzeConsensus([
      { agent: 'strategy', stance: 'agree', confidence: 60 },
      { agent: 'finance', stance: 'agree', confidence: 70 },
      { agent: 'market', stance: 'agree', confidence: null },
      { agent: 'risk', stance: 'disagree', confidence: null },
      { agent: 'knowledge', stance: 'whatever', confidence: null },
    ]);
    expect(r.verdict).toBe('agreement_candidate');
    expect(r.agreementRatio).toBe(75);
    expect(r.unknownStances).toBe(1);
    expect(r.confidenceAvg).toBeNull();   // 측정 confidence 2건 — 표본 부족 시 null 유지
    expect(r.consensusIsNotTruth).toBe(true);
    expect(r.agreementIsNotCorrectness).toBe(true);
    expect(r.confidenceIsNotAccuracy).toBe(true);
  });
});

describe('conflict — Conflict ≠ Error·자동 해결 없음', () => {
  it('4종 whitelist + invalid 집계', () => {
    const r = detectAgentConflicts([
      { a: 'strategy', b: 'finance', kind: 'recommendation_conflict', note: 'x' },
      { a: 'risk', b: 'market', kind: 'evidence_conflict', note: 'y' },
      { a: 'a', b: 'b', kind: 'personality_conflict', note: 'z' },
    ]);
    expect(r.rows).toHaveLength(4);
    expect(r.rows.find((x) => x.kind === 'recommendation_conflict')?.pairs).toContain('strategy↔finance');
    expect(r.invalidConflicts).toBe(1);
    expect(r.totalConflicts).toBe(2);
    expect(r.conflictIsNotError).toBe(true);
    expect(r.autoResolved).toBe(false);
    expect(r.resolutionRequiresHuman).toBe(true);
  });
});

describe('governance workflow — Approval 은 항상 사람', () => {
  it('approval 없는 execution 차단 + AI approval 불인정', () => {
    const r = buildGovernanceWorkflow([
      { workflowKey: 'w1', stage: 'proposal', actor: 'ai' },
      { workflowKey: 'w1', stage: 'review', actor: 'human' },
      { workflowKey: 'w1', stage: 'approval', actor: 'human' },
      { workflowKey: 'w1', stage: 'execution', actor: 'human' },
      { workflowKey: 'w2', stage: 'proposal', actor: 'ai' },
      { workflowKey: 'w2', stage: 'execution', actor: 'ai' },
      { workflowKey: 'w3', stage: 'approval', actor: 'ai' },   // 사람 아닌 approval
      { workflowKey: 'w4', stage: 'launch', actor: 'human' },  // 허용되지 않는 stage
    ]);
    expect(r.workflows.find((w) => w.workflowKey === 'w1')?.verdict).toBe('executed_after_approval');
    expect(r.workflows.find((w) => w.workflowKey === 'w2')?.verdict).toBe('blocked_execution_without_approval');
    expect(r.workflows.find((w) => w.workflowKey === 'w3')?.verdict).toBe('governance_unverified');
    expect(r.invalidEvents).toBe(1);
    expect(r.approvalAlwaysHuman).toBe(true);
    expect(r.autoApproved).toBe(false);
  });
});

describe('timeline — Request→…→Completion 6단계', () => {
  it('stage whitelist + 원본 없는 단계 insufficient_data', () => {
    const r = buildOrchestrationTimeline([
      { stage: 'request', count: 4, source: 'events 실측' },
      { stage: 'approval', count: 1, source: 'oversight 실측' },
      { stage: 'bogus', count: 9, source: 'x' },
    ]);
    expect(r.stages).toHaveLength(6);
    expect(r.stages.find((s) => s.stage === 'request')?.count).toBe(4);
    expect(r.stages.find((s) => s.stage === 'completion')?.status).toBe('insufficient_data');
    expect(r.invalidStages).toBe(1);
    expect(r.timelineIsNotCompletionClaim).toBe(true);
  });
});

describe('advisory — 5종 whitelist·Evidence 필수', () => {
  it('whitelist 밖/Evidence 없음 거부 + Recommendation ≠ Approval', () => {
    expect('rejected' in buildGovernanceAdvisory({ type: 'approve_agent', reason: 'x', evidence: ['e'], confidence: null, assumptions: [] })).toBe(true);
    expect('rejected' in buildGovernanceAdvisory({ type: 'review_ai_proposal', reason: 'x', evidence: [], confidence: null, assumptions: [] })).toBe(true);
    const r = buildGovernanceAdvisory({ type: 'escalate_decision', reason: 'Agent 간 충돌 지속(오류 아님) — 사람 결정 필요', evidence: ['conflict 실측'], confidence: 250, assumptions: ['a'] });
    if ('humanApprovalRequired' in r) {
      expect(r.humanApprovalRequired).toBe(true);
      expect(r.approvalImplied).toBe(false);
      expect(r.confidence).toBe(100);   // clamp
      expect(r.limitations).toContain('AI Consensus ≠ Truth');
    }
  });
});

describe('cockpit / support', () => {
  it('cockpit: 6영역 + null → insufficient_data(0 아님) + 자동 승인 없음', () => {
    const r = buildGovernanceCockpit({ activeAgents: 3, totalAgents: 7, pendingReviews: null, escalations: 2, consensusVerdict: 'split', conflictsOpen: 1, summaryNote: null });
    expect(r.sections).toHaveLength(6);
    expect(r.sections.find((s) => s.key === 'agent_registry')?.headline).toBe('3/7');
    expect(r.sections.find((s) => s.key === 'oversight')?.headline).toBe('insufficient_data');
    expect(r.humanDecisionRequired).toBe(true);
    expect(r.autoApproved).toBe(false);
    expect(r.executiveDecisionMade).toBe(false);
  });
  it('SUPPORT: 16항목 + 자동 승인/해결/Production unsupported + kinds 7종', () => {
    expect(GOVERNANCE_OS_SUPPORT).toHaveLength(16);
    for (const key of ['agent_runtime_scheduler', 'realtime_agent_telemetry', 'auto_approval', 'auto_conflict_resolution', 'auto_production_change']) {
      expect(GOVERNANCE_OS_SUPPORT.find((s) => s.key === key)?.status).toBe('unsupported');
    }
    expect(ORCHESTRATION_AGENT_KINDS).toHaveLength(7);
  });
});
