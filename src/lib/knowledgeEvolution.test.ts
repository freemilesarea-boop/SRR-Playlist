import { describe, expect, it } from 'vitest';
import {
  analyzeKnowledgeAging,
  analyzeLearningPatterns,
  assessBestPracticeCandidates,
  buildKnowledgeBriefing,
  buildKnowledgeCockpit,
  buildKnowledgeGraph,
  buildKnowledgeRecommendation,
  evaluateKnowledgeConfidence,
  KNOWLEDGE_SUPPORT,
  traceDecisionMemory,
} from './knowledgeEvolution';

describe('confidence — 정답 의미 아님', () => {
  it('Evidence 없음 → knowledge_unverified, 사람 검증만 verified', () => {
    expect(evaluateKnowledgeConfidence({ evidenceCount: 0, humanVerified: true }).confidence).toBe('knowledge_unverified');
    expect(evaluateKnowledgeConfidence({ evidenceCount: 2, humanVerified: false }).confidence).toBe('candidate');
    const r = evaluateKnowledgeConfidence({ evidenceCount: 2, humanVerified: true });
    expect(r.confidence).toBe('verified');
    expect(r.confidenceIsNotCorrectness).toBe(true);
  });
});

describe('aging — 오래됐다고 삭제하지 않음', () => {
  it('Fresh/Stable/Needs Review/Candidate Archive 분류 + deletionPerformed=false', () => {
    const now = new Date('2026-07-15');
    const r = analyzeKnowledgeAging([
      { code: 'K-1', updatedAt: new Date('2026-07-10'), status: 'active' },     // fresh
      { code: 'K-2', updatedAt: new Date('2026-05-01'), status: 'active' },     // stable
      { code: 'K-3', updatedAt: new Date('2026-02-01'), status: 'candidate' },  // needs_review
      { code: 'K-4', updatedAt: new Date('2025-06-01'), status: 'active' },     // candidate_archive
      { code: 'K-5', updatedAt: new Date('2025-06-01'), status: 'archived' },   // 제외
    ], now);
    expect(r.rows.find((x) => x.code === 'K-1')?.aging).toBe('fresh');
    expect(r.rows.find((x) => x.code === 'K-2')?.aging).toBe('stable');
    expect(r.rows.find((x) => x.code === 'K-3')?.aging).toBe('needs_review');
    expect(r.rows.find((x) => x.code === 'K-4')?.aging).toBe('candidate_archive');
    expect(r.rows).toHaveLength(4);
    expect(r.deletionPerformed).toBe(false);
  });
});

describe('best practice / decision memory', () => {
  it('best practice: 후보만 + Evidence 없으면 unverified + Universal Rule 아님', () => {
    const r = assessBestPracticeCandidates([
      { code: 'BP-1', domain: 'operational', evidenceCount: 2, status: 'candidate' },
      { code: 'BP-2', domain: 'engineering', evidenceCount: 0, status: 'candidate' },
      { code: 'BP-3', domain: 'bogus', evidenceCount: 1, status: 'candidate' },
    ]);
    expect(r.rows[0].verdict).toBe('promotable_candidate');
    expect(r.rows[1].verdict).toBe('knowledge_unverified');
    expect(r.rows[2].verdict).toBe('invalid_domain');
    expect(r.autoRegistered).toBe(false);
    expect(r.bestPracticeIsNotUniversalRule).toBe(true);
  });
  it('decision memory: 체인 결손 추적 + Approval 아님', () => {
    const r = traceDecisionMemory([
      { decision: 'D-1', hasReason: true, hasEvidence: true, hasOutcome: true, hasLearning: true },
      { decision: 'D-2', hasReason: true, hasEvidence: false, hasOutcome: false, hasLearning: false },
    ]);
    expect(r.completeCount).toBe(1);
    expect(r.rows[1].missing).toEqual(['evidence', 'outcome', 'learning']);
    expect(r.decisionMemoryIsNotApproval).toBe(true);
  });
});

describe('learning patterns — 사실 단정 아님·표본 방어', () => {
  it('5종 whitelist + 발생<3 sample_too_small + Evidence 필수', () => {
    const r = analyzeLearningPatterns([
      { kind: 'repeated_success', occurrences: 5, evidence: ['0515 실측'] },
      { kind: 'repeated_failure', occurrences: 2, evidence: ['e'] },
      { kind: 'repeated_delay', occurrences: 5, evidence: [] },
      { kind: 'bogus_pattern', occurrences: 5, evidence: ['e'] },
    ]);
    expect(r.patterns[0].verdict).toBe('pattern_candidate');
    expect(r.patterns[1].verdict).toBe('sample_too_small');
    expect(r.patterns[2].verdict).toBe('knowledge_unverified');
    expect(r.patterns[3].verdict).toBe('invalid_kind');
    expect(r.patternIsNotFact).toBe(true);
  });
});

describe('knowledge graph — 6단계·인과 주장 없음', () => {
  it('orphan/cycle 감지 + causalityClaimed=false', () => {
    const r = buildKnowledgeGraph([
      { id: 'ex', stage: 'experience', label: 'EX', parentId: null },
      { id: 'ev', stage: 'evidence', label: 'EV', parentId: 'ex' },
      { id: 'kn', stage: 'knowledge', label: 'KN', parentId: null },   // orphan
      { id: 'x', stage: 'bogus', label: 'X', parentId: null },
    ]);
    expect(r.stages).toHaveLength(6);
    expect(r.orphans).toContain('kn');
    expect(r.orphans).not.toContain('ev');
    const cyclic = buildKnowledgeGraph([
      { id: 'a', stage: 'knowledge', label: 'A', parentId: 'b' },
      { id: 'b', stage: 'knowledge', label: 'B', parentId: 'a' },
    ]);
    expect(cyclic.cycles.length).toBeGreaterThan(0);
    expect(cyclic.causalityClaimed).toBe(false);
  });
});

describe('briefing / recommendation / cockpit / support', () => {
  it('briefing: 5섹션 + 자동 발송 없음', () => {
    const r = buildKnowledgeBriefing({ periodKind: 'weekly', newKnowledge: ['k'], changedKnowledge: [], bestPracticeCandidates: ['bp'], agingKnowledge: ['old'], recommendations: [] });
    expect(r.valid).toBe(true);
    expect(r.sections).toHaveLength(5);
    expect(r.autoSendDisabled).toBe(true);
    expect(r.knowledgeIsNotTruth).toBe(true);
    expect(buildKnowledgeBriefing({ periodKind: 'hourly', newKnowledge: [], changedKnowledge: [], bestPracticeCandidates: [], agingKnowledge: [], recommendations: [] }).valid).toBe(false);
  });
  it('recommendation: whitelist + Evidence 필수 + ≠ Organizational Decision', () => {
    expect('rejected' in buildKnowledgeRecommendation({ type: 'register_best_practice', reason: 'x', evidence: ['e'], confidence: null, assumptions: [] })).toBe(true);
    expect('rejected' in buildKnowledgeRecommendation({ type: 'review_knowledge', reason: 'x', evidence: [], confidence: null, assumptions: [] })).toBe(true);
    const r = buildKnowledgeRecommendation({ type: 'promote_best_practice_candidate', reason: 'Evidence 있는 후보 존재(자동 등록 아님)', evidence: ['bp'], confidence: 40, assumptions: ['a'] });
    if ('humanApprovalRequired' in r) {
      expect(r.humanApprovalRequired).toBe(true);
      expect(r.approvalImplied).toBe(false);
      expect(r.limitations).toContain('Recommendation ≠ Organizational Decision');
    }
  });
  it('cockpit: 7영역 + knowledgeAutoDecided=false', () => {
    const r = buildKnowledgeCockpit({ memoryTotal: 3, knowledgeNodes: 10, decisionChainsComplete: 1, learningPatternCandidates: 2, bestPracticeCandidates: 1, graphOrphans: 0, summaryNote: null });
    expect(r.sections).toHaveLength(7);
    expect(r.humanDecisionRequired).toBe(true);
    expect(r.knowledgeAutoDecided).toBe(false);
    expect(r.sections.find((s) => s.key === 'executive_summary')?.headline).toBe('insufficient_data');
  });
  it('KNOWLEDGE_SUPPORT: 16항목 + 외부 위키/자동 등록/삭제/정책 변경 unsupported', () => {
    expect(KNOWLEDGE_SUPPORT).toHaveLength(16);
    for (const key of ['external_wiki', 'auto_best_practice_registration', 'auto_knowledge_deletion', 'auto_policy_change']) {
      expect(KNOWLEDGE_SUPPORT.find((s) => s.key === key)?.status).toBe('unsupported');
    }
  });
});
