// Phase AI-MUSIC-9 — Multi-Agent Collaboration Engine 순수 로직 단위 테스트.
// Agent 의견 · Consensus(unanimous/majority/weighted/governance_required/insufficient) · Conflict ·
// Reputation(Outcome) · Collaboration · Idempotency · Support · 0~100 clamp · NaN 금지 · abstain.
import { describe, it, expect } from 'vitest';
import {
  AGENTS, agentDef, generateOpinions, consensusEngine, detectConflicts, hasCriticalConflict,
  agentReputationScore, runCollaboration, collaborationIdempotencyKey,
  AGENT_SUPPORT, STANCE_LABEL, CONSENSUS_LABEL, FINAL_DECISION_LABEL,
  type CollaborationInput, type AgentOpinion, type AgentCode,
} from './multiAgent';

const inp = (over: Partial<CollaborationInput> = {}): CollaborationInput => ({
  contextKey: 'store_type=cafe', contextHealth: 80, contextDrift: 15, sample: 300,
  predictedCompletion: 82, predictedSkip: 6, predictionConfidence: 70, riskScore: 20,
  playlistDiversity: 70, playlistFreshness: 65, trackCoverage: 60, artistExposure: 55,
  repeatRisk: 20, fatigueRisk: 15, streamingQuality: 90, bufferHealth: 85, roi: 60, storeSatisfaction: 70,
  governanceHealth: 85, constitutionPass: true, ...over,
});

describe('Agents / 의견 생성', () => {
  it('8개 Agent 등록', () => { expect(AGENTS.length).toBe(8); expect(agentDef('governance')!.name).toBe('Governance Agent'); });
  it('의견 8개 · score 0~100 · stance', () => {
    const ops = generateOpinions(inp());
    expect(ops.length).toBe(8);
    for (const o of ops) { if (o.score != null) { expect(o.score).toBeGreaterThanOrEqual(0); expect(o.score).toBeLessThanOrEqual(100); } }
    expect(ops.find((o) => o.agent === 'context')!.stance).toBe('support');
  });
  it('신호 없음 → abstain', () => {
    const ops = generateOpinions(inp({ streamingQuality: null, bufferHealth: null }));
    expect(ops.find((o) => o.agent === 'quality')!.stance).toBe('abstain');
  });
  it('Constitution 위반 → governance oppose', () => {
    const ops = generateOpinions(inp({ constitutionPass: false }));
    expect(ops.find((o) => o.agent === 'governance')!.stance).toBe('oppose');
  });
});

describe('Consensus Engine', () => {
  it('전원 support → unanimous', () => {
    const ops = generateOpinions(inp());
    // 모두 support 되도록 높은 신호
    const c = consensusEngine(ops.map((o) => ({ ...o, stance: 'support' as const, supported: true, score: 80 })));
    expect(c.type).toBe('unanimous'); expect(c.score!).toBeGreaterThan(0);
  });
  it('과반 support → majority', () => {
    const ops: AgentOpinion[] = [
      { agent: 'context', score: 80, stance: 'support', confidence: 70, rationale: '', supported: true },
      { agent: 'prediction', score: 78, stance: 'support', confidence: 70, rationale: '', supported: true },
      { agent: 'playlist', score: 75, stance: 'support', confidence: 70, rationale: '', supported: true },
      { agent: 'rotation', score: 50, stance: 'neutral', confidence: 70, rationale: '', supported: true },
    ];
    expect(consensusEngine(ops).type).toBe('majority');
  });
  it('참여<3 → insufficient_data', () => {
    const ops: AgentOpinion[] = [{ agent: 'context', score: 80, stance: 'support', confidence: 70, rationale: '', supported: true }];
    expect(consensusEngine(ops).type).toBe('insufficient_data');
  });
  it('Governance 반대 → governance_required', () => {
    const ops: AgentOpinion[] = [
      { agent: 'context', score: 80, stance: 'support', confidence: 70, rationale: '', supported: true },
      { agent: 'prediction', score: 78, stance: 'support', confidence: 70, rationale: '', supported: true },
      { agent: 'governance', score: 20, stance: 'oppose', confidence: 70, rationale: '', supported: true },
    ];
    expect(consensusEngine(ops).type).toBe('governance_required');
  });
  it('강한 대립(2 support 2 oppose) → governance_required', () => {
    const ops: AgentOpinion[] = [
      { agent: 'context', score: 80, stance: 'support', confidence: 70, rationale: '', supported: true },
      { agent: 'prediction', score: 78, stance: 'support', confidence: 70, rationale: '', supported: true },
      { agent: 'playlist', score: 30, stance: 'oppose', confidence: 70, rationale: '', supported: true },
      { agent: 'rotation', score: 25, stance: 'oppose', confidence: 70, rationale: '', supported: true },
    ];
    expect(consensusEngine(ops).type).toBe('governance_required');
  });
  it('Reputation 가중 반영', () => {
    const ops: AgentOpinion[] = [
      { agent: 'context', score: 90, stance: 'support', confidence: 70, rationale: '', supported: true },
      { agent: 'prediction', score: 40, stance: 'oppose', confidence: 70, rationale: '', supported: true },
      { agent: 'playlist', score: 60, stance: 'neutral', confidence: 70, rationale: '', supported: true },
    ];
    const high = consensusEngine(ops, { context: 90, prediction: 10, playlist: 50 });
    const low = consensusEngine(ops, { context: 10, prediction: 90, playlist: 50 });
    expect(high.score!).toBeGreaterThan(low.score!);
  });
});

describe('Conflict Detection', () => {
  it('Playlist vs Rotation 대립 → conflict', () => {
    const ops: AgentOpinion[] = [
      { agent: 'playlist', score: 85, stance: 'support', confidence: 70, rationale: '', supported: true },
      { agent: 'rotation', score: 25, stance: 'oppose', confidence: 70, rationale: '', supported: true },
    ];
    const c = detectConflicts(ops);
    expect(c.length).toBeGreaterThan(0); expect(c[0].severity).toBe('high');
  });
  it('무대립 → conflict 없음', () => {
    const ops: AgentOpinion[] = [
      { agent: 'playlist', score: 70, stance: 'support', confidence: 70, rationale: '', supported: true },
      { agent: 'rotation', score: 68, stance: 'support', confidence: 70, rationale: '', supported: true },
    ];
    expect(detectConflicts(ops).length).toBe(0);
  });
  it('hasCriticalConflict', () => {
    expect(hasCriticalConflict([{ a: 'playlist', b: 'rotation', reason: '', severity: 'high' }])).toBe(true);
    expect(hasCriticalConflict([{ a: 'playlist', b: 'rotation', reason: '', severity: 'low' }])).toBe(false);
  });
});

describe('Reputation / Collaboration', () => {
  it('agentReputationScore Outcome 기반', () => {
    expect(agentReputationScore({ decisions: 10, wins: 8 })).toBe(80);
    expect(agentReputationScore({ decisions: 0, wins: 0 })).toBeNull();
  });
  it('runCollaboration 정상 → proceed_to_governance', () => {
    const r = runCollaboration(inp());
    expect(['proceed_to_governance', 'governance_review']).toContain(r.finalDecision);
    expect(r.evidence.length).toBeGreaterThan(0);
  });
  it('Constitution 위반 → governance_review', () => {
    const r = runCollaboration(inp({ constitutionPass: false }));
    expect(r.governanceRequired).toBe(true); expect(r.finalDecision).toBe('governance_review');
  });
  it('신호 대량 부족 → hold', () => {
    const r = runCollaboration({ contextKey: 'c', sample: 10 });
    expect(r.finalDecision).toBe('hold');
  });
  it('idempotencyKey 결정적·순서 안정', () => {
    const a = collaborationIdempotencyKey({ contextKey: 'c', topic: 't', participants: ['context', 'prediction'] as AgentCode[], inputHash: 'h' });
    const b = collaborationIdempotencyKey({ contextKey: 'c', topic: 't', participants: ['prediction', 'context'] as AgentCode[], inputHash: 'h' });
    expect(a).toBe(b);
  });
});

describe('Support / 라벨', () => {
  it('Ranking/Quality/Revenue 부분 지원', () => {
    for (const k of ['ranking', 'quality', 'revenue'] as AgentCode[]) expect(AGENT_SUPPORT.find((s) => s.code === k)!.status).toBe('partially_supported');
    expect(AGENT_SUPPORT.find((s) => s.code === 'context')!.status).toBe('supported');
  });
  it('라벨', () => {
    expect(STANCE_LABEL.support).toBe('찬성'); expect(CONSENSUS_LABEL.unanimous).toBe('만장일치');
    expect(FINAL_DECISION_LABEL.governance_review).toBe('Governance Review');
  });
});
