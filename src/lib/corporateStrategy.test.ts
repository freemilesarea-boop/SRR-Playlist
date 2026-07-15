import { describe, expect, it } from 'vitest';
import {
  analyzeCapability,
  analyzeStrategicGap,
  assessObjectiveAchievability,
  buildObjectiveHierarchy,
  buildRoadmapDashboard,
  buildRoadmapTimeline,
  buildStrategyEvolution,
  buildStrategyRecommendation,
  evaluateStrategicMaturity,
  evaluateStrategyAlignment,
  STRATEGY_SUPPORT,
  validateVisionRecord,
} from './corporateStrategy';

describe('vision — 사람 입력만', () => {
  it('AI 생성 플래그 거부 + kind/statement 검증', () => {
    expect(validateVisionRecord(null)).toEqual(['vision 입력 없음']);
    expect(validateVisionRecord({ kind: 'vision_statement', statement: '', humanAuthored: true })).toContain('statement 필수(사람 입력)');
    expect(validateVisionRecord({ kind: 'vision_statement', statement: 'v', humanAuthored: false })).toContain('AI 자동 생성 Vision 금지 — human_authored 필수');
    expect(validateVisionRecord({ kind: 'mission_statement', statement: '음악으로 매장 가치를 높인다', humanAuthored: true })).toEqual([]);
  });
});

describe('hierarchy — orphan/cycle 감지', () => {
  it('6단계 그룹 + parent 없는 노드 orphan, cycle 감지', () => {
    const r = buildObjectiveHierarchy([
      { id: 'v1', stage: 'vision', label: 'V', parentId: null },
      { id: 'o1', stage: 'objective', label: 'O', parentId: 'v1' },
      { id: 'i1', stage: 'initiative', label: 'I', parentId: null },   // orphan
      { id: 'c1', stage: 'commitment', label: 'C', parentId: 'o1' },
      { id: 'x', stage: 'bogus', label: 'X', parentId: null },
    ]);
    expect(r.stages).toHaveLength(6);
    expect(r.orphans).toContain('i1');
    expect(r.orphans).not.toContain('o1');
    const cyclic = buildObjectiveHierarchy([
      { id: 'a', stage: 'objective', label: 'A', parentId: 'b' },
      { id: 'b', stage: 'objective', label: 'B', parentId: 'a' },
    ]);
    expect(cyclic.cycles.length).toBeGreaterThan(0);
  });
});

describe('gap — 사실 단정 아님', () => {
  it('Evidence 없음 → gap_unverified, 값 없음 → insufficient, notFactualClaim 고정', () => {
    expect(analyzeStrategicGap({ area: 'mrr', currentValue: 100, targetValue: 200, evidence: [], unknownFactors: [] }).verdict).toBe('gap_unverified');
    expect(analyzeStrategicGap({ area: 'mrr', currentValue: null, targetValue: 200, evidence: ['e'], unknownFactors: [] }).verdict).toBe('insufficient_data');
    const r = analyzeStrategicGap({ area: 'mrr', currentValue: 100, targetValue: 200, evidence: ['e'], unknownFactors: ['market'] });
    expect(r.gap).toBe(100);
    expect(r.verdict).toBe('gap_candidate');
    expect(r.confidence).toBe(65);   // unknown 1건 감점
    expect(r.notFactualClaim).toBe(true);
    expect(analyzeStrategicGap({ area: 'x', currentValue: 200, targetValue: 200, evidence: ['e'], unknownFactors: [] }).verdict).toBe('no_known_gap');
  });
});

describe('capability / alignment', () => {
  it('capability: missing 감지 + 인사 평가 아님', () => {
    const r = analyzeCapability({ current: ['analytics', 'governance'], required: ['analytics', 'governance', 'ml_ops'] });
    expect(r.missing).toEqual(['ml_ops']);
    expect(r.present).toHaveLength(2);
    expect(r.notPersonnelEvaluation).toBe(true);
  });
  it('alignment: 자료 없으면 unverified(4상태만) + ≠ Success', () => {
    expect(evaluateStrategyAlignment({ pair: 'initiative↔strategy', linkedCount: null, totalCount: null }).alignment).toBe('alignment_unverified');
    expect(evaluateStrategyAlignment({ pair: 'x', linkedCount: 0, totalCount: 0 }).alignment).toBe('insufficient_data');
    const r = evaluateStrategyAlignment({ pair: 'portfolio↔objectives', linkedCount: 8, totalCount: 10 });
    expect(r.alignment).toBe('aligned');
    expect(r.alignmentIsNotSuccess).toBe(true);
    expect(evaluateStrategyAlignment({ pair: 'y', linkedCount: 4, totalCount: 10 }).alignment).toBe('partially_aligned');
  });
});

describe('maturity — 점수 단독 반환 금지', () => {
  it('Evidence 없는 차원은 점수 제외 + missing/unknown 동시 반환', () => {
    const r = evaluateStrategicMaturity([
      { dimension: 'governance', score: 80, evidence: ['audit'] },
      { dimension: 'execution', score: 70, evidence: [] },   // Evidence 없음 → 제외
      { dimension: 'analytics', score: 60, evidence: ['snapshots'] },
    ]);
    expect(r.overall).toBe(70);   // (80+60)/2
    expect(r.byDimension.find((d) => d.dimension === 'execution')?.score).toBeNull();
    expect(r.unknownFactors.some((u) => u.includes('execution'))).toBe(true);
    expect(r.missingAreas).toContain('execution');
    expect(r.scoreOnlyReturn).toBe(false);
    expect(evaluateStrategicMaturity([]).overall).toBeNull();
  });
});

describe('roadmap timeline / evolution', () => {
  it('연도별 정렬 + Roadmap ≠ Commitment', () => {
    const r = buildRoadmapTimeline([
      { year: 2027, phase: 'next', title: 'b' }, { year: 2026, phase: 'current', title: 'a' },
    ]);
    expect(r.years.map((y) => y.year)).toEqual([2026, 2027]);
    expect(r.roadmapIsNotCommitment).toBe(true);
    expect(buildRoadmapTimeline(null).years).toEqual([]);
  });
  it('evolution: 7단계 whitelist + revision/objective_update 는 Human Approval', () => {
    const r = buildStrategyEvolution([
      { at: new Date('2026-07-01'), stage: 'strategy_revision', label: 'rev' },
      { at: new Date('2026-06-01'), stage: 'outcome', label: 'out' },
      { at: new Date('2026-05-01'), stage: 'bogus', label: 'x' },
    ]);
    expect(r.timeline).toHaveLength(2);
    expect(r.timeline[0].humanApprovalRequired).toBe(true);
    expect(r.timeline[1].humanApprovalRequired).toBe(false);
    expect(r.revisionRequiresHumanApproval).toBe(true);
  });
});

describe('achievability — 확정 아님·표본 방어', () => {
  it('연결 없음 → strategy_unverified, 이력<5 제외, notGuarantee', () => {
    expect(assessObjectiveAchievability({ linkedInitiatives: 0, linkedCommitments: 0, verifiedProgress: null, historicalSuccessRate: null, historicalSample: 0, unknownFactors: [] }).verdict).toBe('strategy_unverified');
    const r = assessObjectiveAchievability({ linkedInitiatives: 2, linkedCommitments: 1, verifiedProgress: 70, historicalSuccessRate: 90, historicalSample: 3, unknownFactors: ['market'] });
    expect(r.drivers.some((d) => d.includes('이력 표본'))).toBe(true);
    expect(r.notGuarantee).toBe(true);
    expect(r.verdict).toBe('achievable_candidate');
    expect(assessObjectiveAchievability({ linkedInitiatives: 1, linkedCommitments: 0, verifiedProgress: null, historicalSuccessRate: null, historicalSample: 2, unknownFactors: [] }).verdict).toBe('sample_too_small');
  });
});

describe('recommendation / dashboard / support', () => {
  it('recommendation: whitelist + Evidence 필수 + Recommendation ≠ Approval', () => {
    expect('rejected' in buildStrategyRecommendation({ type: 'auto_approve_strategy', reason: 'x', evidence: ['e'], confidence: null, assumptions: [] })).toBe(true);
    expect('rejected' in buildStrategyRecommendation({ type: 'review_objective', reason: 'x', evidence: [], confidence: null, assumptions: [] })).toBe(true);
    const r = buildStrategyRecommendation({ type: 'review_strategic_gap', reason: 'MRR gap 후보', evidence: ['gap'], confidence: 50, assumptions: ['a'] });
    if ('humanApprovalRequired' in r) {
      expect(r.humanApprovalRequired).toBe(true);
      expect(r.approvalImplied).toBe(false);
      expect(r.limitations).toContain('Recommendation ≠ Approval');
    }
  });
  it('dashboard: 9영역 + humanDecisionRequired + 정직 문구', () => {
    const r = buildRoadmapDashboard({ visionCount: 1, objectiveCount: 3, roadmapYears: 5, initiativeCount: 2, alignedPairs: 1, totalPairs: 4, gapCandidates: 2, missingCapabilities: 1, maturityOverall: null, briefingNote: '검토 필요' });
    expect(r.sections).toHaveLength(9);
    expect(r.humanDecisionRequired).toBe(true);
    expect(r.sections.find((s) => s.key === 'roadmap')?.detail).toBe('Roadmap ≠ Commitment');
    expect(r.sections.find((s) => s.key === 'strategic_health')?.headline).toBe('insufficient_data');
  });
  it('STRATEGY_SUPPORT: 16항목 + 자동 생성/승인/Production unsupported', () => {
    expect(STRATEGY_SUPPORT).toHaveLength(16);
    for (const key of ['auto_vision', 'auto_approval', 'production_apply']) {
      expect(STRATEGY_SUPPORT.find((s) => s.key === key)?.status).toBe('unsupported');
    }
  });
});
