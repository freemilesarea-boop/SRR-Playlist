import { describe, expect, it } from 'vitest';
import {
  analyzeOrganizationalEvolution,
  assessOptimizationCandidates,
  buildImprovementTimeline,
  buildLearningBriefing,
  buildLearningCockpit,
  buildLearningGraph,
  buildLearningRecommendation,
  evaluateOrganizationalMaturity,
  LEARNING_SUPPORT,
  measureLearningEffectiveness,
} from './learningIntelligence';

describe('optimization — 후보만·자동 적용 없음', () => {
  it('4 도메인 whitelist + Evidence 없으면 unverified + autoApplied=false', () => {
    const r = assessOptimizationCandidates([
      { code: 'O-1', domain: 'process', evidenceCount: 2 },
      { code: 'O-2', domain: 'ai', evidenceCount: 0 },
      { code: 'O-3', domain: 'bogus', evidenceCount: 1 },
      { code: 'O-4', domain: null, evidenceCount: 1 },
    ]);
    expect(r.rows[0].verdict).toBe('reviewable_candidate');
    expect(r.rows[1].verdict).toBe('learning_unverified');
    expect(r.rows[2].verdict).toBe('invalid_domain');
    expect(r.rows[3].verdict).toBe('invalid_domain');
    expect(r.autoApplied).toBe(false);
    expect(r.optimizationIsNotBetterOutcome).toBe(true);
  });
});

describe('evolution — 사실 단정 아님·표본 방어', () => {
  it('5종 whitelist + 관찰<3 sample_too_small + Evidence 필수', () => {
    const r = analyzeOrganizationalEvolution([
      { kind: 'success_evolution', observations: 5, evidence: ['0515 실측'] },
      { kind: 'failure_evolution', observations: 2, evidence: ['e'] },
      { kind: 'quality_evolution', observations: 5, evidence: [] },
      { kind: 'bogus_evolution', observations: 5, evidence: ['e'] },
    ]);
    expect(r.rows[0].verdict).toBe('evolution_candidate');
    expect(r.rows[1].verdict).toBe('sample_too_small');
    expect(r.rows[2].verdict).toBe('learning_unverified');
    expect(r.rows[3].verdict).toBe('invalid_kind');
    expect(r.evolutionIsNotFact).toBe(true);
  });
});

describe('effectiveness — Coverage 실측만', () => {
  it('분모 없으면 insufficient_data(null 유지 — 0 아님)', () => {
    const r = measureLearningEffectiveness({ learningsTotal: 10, learningsApproved: 4, improvementsTotal: 5, improvementsApproved: 2, optimizationsTotal: 3, adoptionsRecorded: 1 });
    expect(r.coverages[0].pct).toBe(40);
    expect(r.coverages[1].pct).toBe(40);
    expect(r.coverages[3].pct).toBe(25);
    expect(r.measuredOnly).toBe(true);
    expect(r.adoptionIsNotOutcome).toBe(true);
    const none = measureLearningEffectiveness({ learningsTotal: null, learningsApproved: null, improvementsTotal: 0, improvementsApproved: 0, optimizationsTotal: null, adoptionsRecorded: null });
    expect(none.coverages.every((c) => c.status === 'insufficient_data')).toBe(true);
    expect(none.coverages[0].pct).toBeNull();
  });
});

describe('timeline — 7단계·Approval/Adoption Human Required', () => {
  it('stage whitelist + humanRequired 플래그 + 완료 보장 아님', () => {
    const r = buildImprovementTimeline([
      { stage: 'issue', at: new Date('2026-07-01'), note: 'i' },
      { stage: 'approval', at: new Date('2026-07-02'), note: 'a' },
      { stage: 'bogus', at: new Date('2026-07-03'), note: 'x' },
    ]);
    expect(r.stages).toHaveLength(7);
    expect(r.stages.find((s) => s.stage === 'approval')?.humanRequired).toBe(true);
    expect(r.stages.find((s) => s.stage === 'adoption')?.humanRequired).toBe(true);
    expect(r.stages.find((s) => s.stage === 'issue')?.humanRequired).toBe(false);
    expect(r.invalidStages).toBe(1);
    expect(r.stageCompletionGuarantee).toBe(false);
  });
});

describe('maturity — Evidence 게이트·Success 아님', () => {
  it('Evidence 없는 차원 점수 제외 + Supporting/Missing/Unknown 동시 반환', () => {
    const r = evaluateOrganizationalMaturity([
      { dimension: 'process', score: 80, evidence: ['0512 policies'] },
      { dimension: 'learning', score: 70, evidence: [] },   // 제외
      { dimension: 'knowledge', score: 60, evidence: ['0531 memory'] },
    ]);
    expect(r.overall).toBe(70);
    expect(r.byDimension.find((d) => d.dimension === 'learning')?.score).toBeNull();
    expect(r.missingAreas).toContain('learning');
    expect(r.supportingEvidence.length).toBeGreaterThan(0);
    expect(r.unknownFactors.some((u) => u.includes('learning'))).toBe(true);
    expect(r.maturityIsNotSuccess).toBe(true);
    expect(r.scoreOnlyReturn).toBe(false);
    expect(evaluateOrganizationalMaturity([]).overall).toBeNull();
  });
});

describe('learning graph — 5단계·인과 주장 없음', () => {
  it('orphan/cycle 감지 + causalityClaimed=false', () => {
    const r = buildLearningGraph([
      { id: 'k', stage: 'knowledge', label: 'K', parentId: null },
      { id: 'l', stage: 'learning', label: 'L', parentId: 'k' },
      { id: 'i', stage: 'improvement', label: 'I', parentId: null },   // orphan
      { id: 'x', stage: 'bogus', label: 'X', parentId: null },
    ]);
    expect(r.stages).toHaveLength(5);
    expect(r.orphans).toContain('i');
    expect(r.orphans).not.toContain('l');
    const cyclic = buildLearningGraph([
      { id: 'a', stage: 'learning', label: 'A', parentId: 'b' },
      { id: 'b', stage: 'learning', label: 'B', parentId: 'a' },
    ]);
    expect(cyclic.cycles.length).toBeGreaterThan(0);
    expect(cyclic.causalityClaimed).toBe(false);
  });
});

describe('briefing / recommendation / cockpit / support', () => {
  it('briefing: 5섹션 + 자동 발송 없음', () => {
    const r = buildLearningBriefing({ periodKind: 'monthly', newLearnings: ['l'], improvementCandidates: ['i'], optimizationCandidates: [], maturityNote: ['m'], recommendations: [] });
    expect(r.valid).toBe(true);
    expect(r.sections).toHaveLength(5);
    expect(r.autoSendDisabled).toBe(true);
    expect(r.learningIsNotCorrectness).toBe(true);
    expect(buildLearningBriefing({ periodKind: 'hourly', newLearnings: [], improvementCandidates: [], optimizationCandidates: [], maturityNote: [], recommendations: [] }).valid).toBe(false);
  });
  it('recommendation: whitelist + Evidence 필수 + ≠ Organizational Decision', () => {
    expect('rejected' in buildLearningRecommendation({ type: 'apply_improvement', reason: 'x', evidence: ['e'], confidence: null, assumptions: [] })).toBe(true);
    expect('rejected' in buildLearningRecommendation({ type: 'review_learning', reason: 'x', evidence: [], confidence: null, assumptions: [] })).toBe(true);
    const r = buildLearningRecommendation({ type: 'review_adoption', reason: 'approved 후 Adoption 미기록 존재', evidence: ['registry'], confidence: 40, assumptions: ['a'] });
    if ('humanApprovalRequired' in r) {
      expect(r.humanApprovalRequired).toBe(true);
      expect(r.approvalImplied).toBe(false);
      expect(r.limitations).toContain('Recommendation ≠ Organizational Decision');
    }
  });
  it('cockpit: 7영역 + organizationAutoOptimized=false', () => {
    const r = buildLearningCockpit({ registryTotal: 4, improvementCandidates: 2, optimizationCandidates: 1, evolutionCandidates: 0, maturityOverall: null, graphOrphans: 1, summaryNote: null });
    expect(r.sections).toHaveLength(7);
    expect(r.humanDecisionRequired).toBe(true);
    expect(r.organizationAutoOptimized).toBe(false);
    expect(r.sections.find((s) => s.key === 'maturity')?.headline).toBe('insufficient_data');
  });
  it('LEARNING_SUPPORT: 16항목 + 교육/자동 적용/정책 변경/조직 최적화 unsupported', () => {
    expect(LEARNING_SUPPORT).toHaveLength(16);
    for (const key of ['training_platform', 'auto_improvement_apply', 'auto_policy_change', 'auto_org_optimization']) {
      expect(LEARNING_SUPPORT.find((s) => s.key === key)?.status).toBe('unsupported');
    }
  });
});
