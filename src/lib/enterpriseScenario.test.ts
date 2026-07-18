import { describe, it, expect } from 'vitest';
import {
  SCENARIO_CATEGORIES, SCENARIO_STATUSES,
  IMPACT_SIMULATION_DIMENSIONS, IMPACT_SIMULATION_RESULTS,
  TRADEOFF_DIMENSIONS, TRADEOFF_RESULTS,
  SCENARIO_CONFIDENCE_DIMENSIONS, SCENARIO_CONFIDENCE_RESULTS,
  SCENARIO_REVIEW_TYPES, SCENARIO_REVIEW_STATUSES,
  SCENARIO_RECOMMENDATION_TYPES, DECISION_SCORECARD_FIELDS, SCENARIO_FLOW_STAGES,
  generateScenarioMatrix, evaluateImpactSimulation, analyzeTradeoff,
  evaluateScenarioConfidence, rankScenarios, buildExecutiveDecisionScorecard,
  validateScenarioReview, buildScenarioTimeline,
  ENTERPRISE_SCENARIO_COMPONENTS, ENTERPRISE_SCENARIO_SUPPORT_MATRIX,
} from './enterpriseScenario';

describe('enterpriseScenario 상수(§3~§10 — SQL CHECK 1:1)', () => {
  it('Scenario Category 14종·Status 5종', () => {
    expect(SCENARIO_CATEGORIES).toHaveLength(14);
    expect(SCENARIO_STATUSES).toHaveLength(5);
    expect(SCENARIO_STATUSES).toContain('insufficient_data');
  });
  it('Impact/Trade-off/Confidence 결과 5종 + insufficient_data 포함', () => {
    for (const list of [IMPACT_SIMULATION_RESULTS, TRADEOFF_RESULTS, SCENARIO_CONFIDENCE_RESULTS, SCENARIO_REVIEW_STATUSES]) {
      expect(list).toHaveLength(5);
      expect(list).toContain('insufficient_data');
    }
    expect(IMPACT_SIMULATION_DIMENSIONS).toHaveLength(5);
    expect(TRADEOFF_DIMENSIONS).toHaveLength(5);
    expect(SCENARIO_CONFIDENCE_DIMENSIONS).toHaveLength(5);
  });
  it('Review 3종·권고 23종·Scorecard 9필드(§8)·Flow 15단계·컴포넌트 10종', () => {
    expect(SCENARIO_REVIEW_TYPES).toHaveLength(3);
    expect(SCENARIO_RECOMMENDATION_TYPES).toHaveLength(23);
    expect(SCENARIO_RECOMMENDATION_TYPES).toContain('insufficient_data');
    expect(DECISION_SCORECARD_FIELDS).toHaveLength(9);
    expect(SCENARIO_FLOW_STAGES).toHaveLength(15);
    expect(ENTERPRISE_SCENARIO_COMPONENTS).toHaveLength(10);
  });
});

describe('generateScenarioMatrix(Scenario Generation — Scenario ≠ Future Reality)', () => {
  it('레버 조합 카테시안 곱을 결정적 순서로 생성', () => {
    const r = generateScenarioMatrix([
      { name: 'pricing', options: ['keep', 'raise'] },
      { name: 'market', options: ['domestic', 'global'] },
    ], 8);
    expect(r.totalCombinations).toBe(4);
    expect(r.truncated).toBe(false);
    expect(r.scenarios).toHaveLength(4);
    // 결정적: 레버 이름순(market → pricing) 조합.
    expect(r.scenarios[0].choices).toEqual([
      { lever: 'market', option: 'domestic' }, { lever: 'pricing', option: 'keep' },
    ]);
    expect(r.scenarios[0].scenarioCode).toBe('SCN-01');
    expect(r.scenarioIsNotFutureReality).toBe(true);
  });
  it('maxScenarios 초과 시 truncated 정직 공개', () => {
    const r = generateScenarioMatrix([
      { name: 'a', options: ['1', '2', '3'] }, { name: 'b', options: ['x', 'y', 'z'] },
    ], 4);
    expect(r.totalCombinations).toBe(9);
    expect(r.truncated).toBe(true);
    expect(r.scenarios).toHaveLength(4);
  });
  it('레버 없음/무효 → 빈 결과(오류 없음)', () => {
    expect(generateScenarioMatrix(null).scenarios).toEqual([]);
    expect(generateScenarioMatrix([{ name: '', options: [] }]).totalCombinations).toBe(0);
  });
});

describe('evaluateImpactSimulation(§5 — Simulation ≠ Prediction)', () => {
  it('강한 양의 영향 → high_positive_candidate', () => {
    const r = evaluateImpactSimulation([
      { dimension: 'financial_impact', impactScore: 60 }, { dimension: 'operational_impact', impactScore: 55 },
      { dimension: 'mission_impact', impactScore: 70 },
    ]);
    expect(r.result).toBe('high_positive_candidate');
    expect(r.simulationIsNotPrediction).toBe(true);
  });
  it('중간 양수 → moderate_positive, 약한 신호 → neutral, 큰 음수 → high_negative', () => {
    expect(evaluateImpactSimulation([
      { dimension: 'financial_impact', impactScore: 20 }, { dimension: 'operational_impact', impactScore: 15 }, { dimension: 'risk_impact', impactScore: 25 },
    ]).result).toBe('moderate_positive_candidate');
    expect(evaluateImpactSimulation([
      { dimension: 'financial_impact', impactScore: 5 }, { dimension: 'operational_impact', impactScore: -10 }, { dimension: 'risk_impact', impactScore: 0 },
    ]).result).toBe('neutral_candidate');
    expect(evaluateImpactSimulation([
      { dimension: 'financial_impact', impactScore: -70 }, { dimension: 'operational_impact', impactScore: -60 }, { dimension: 'risk_impact', impactScore: -55 },
    ]).result).toBe('high_negative_candidate');
  });
  it('3차원 미만 평가 → insufficient_data(Null → 0 금지)', () => {
    const r = evaluateImpactSimulation([
      { dimension: 'financial_impact', impactScore: 80 }, { dimension: 'operational_impact', impactScore: null },
    ]);
    expect(r.result).toBe('insufficient_data');
    expect(r.averageImpact).toBeNull();
    expect(evaluateImpactSimulation(null).result).toBe('insufficient_data');
  });
});

describe('analyzeTradeoff(§6 — Trade-off ≠ Optimal Solution)', () => {
  it('높은 Benefit + 낮은 부담 → highly_balanced_candidate', () => {
    const r = analyzeTradeoff({ costScore: 30, benefitScore: 85, complexityScore: 25, timeScore: 30, riskScore: 20 });
    expect(r.result).toBe('highly_balanced_candidate');
    expect(r.tradeoffIsNotOptimalSolution).toBe(true);
  });
  it('부담 > Benefit → poor_tradeoff_candidate', () => {
    expect(analyzeTradeoff({ costScore: 90, benefitScore: 30, complexityScore: 85, timeScore: 80, riskScore: 75 }).result).toBe('poor_tradeoff_candidate');
  });
  it('Benefit 미평가 또는 3평가 미만 → insufficient_data', () => {
    expect(analyzeTradeoff({ costScore: 50, benefitScore: null, complexityScore: 40, timeScore: 30, riskScore: 20 }).result).toBe('insufficient_data');
    const r = analyzeTradeoff({ costScore: 50, benefitScore: 70, complexityScore: null, timeScore: null, riskScore: null });
    expect(r.result).toBe('insufficient_data');
    expect(r.assessedDimensions).toBe(2);
  });
});

describe('evaluateScenarioConfidence(§7 — Confidence ≠ Certainty)', () => {
  it('전 차원 고득점 → high_confidence, 저득점 → speculative', () => {
    expect(evaluateScenarioConfidence(SCENARIO_CONFIDENCE_DIMENSIONS.map((dimension) => ({ dimension, score: 85 }))).result).toBe('high_confidence_candidate');
    expect(evaluateScenarioConfidence([
      { dimension: 'evidence', score: 20 }, { dimension: 'coverage', score: 25 }, { dimension: 'stability', score: 30 },
    ]).result).toBe('speculative_candidate');
  });
  it('3차원 미만 평가 → insufficient_data', () => {
    expect(evaluateScenarioConfidence([{ dimension: 'evidence', score: 90 }]).result).toBe('insufficient_data');
    expect(evaluateScenarioConfidence(null).result).toBe('insufficient_data');
  });
});

describe('rankScenarios(Scenario Ranking — Ranking ≠ Executive Priority)', () => {
  it('복합 점수(impact + tradeoff − risk) 내림차순 + 동점 코드순', () => {
    const r = rankScenarios([
      { scenarioCode: 'S-B', impactScore: 60, tradeoffScore: 30, riskScore: 20 },
      { scenarioCode: 'S-A', impactScore: 60, tradeoffScore: 30, riskScore: 20 },
      { scenarioCode: 'S-C', impactScore: 90, tradeoffScore: 40, riskScore: 10 },
    ]);
    expect(r.ranked.map((e) => e.scenarioCode)).toEqual(['S-C', 'S-A', 'S-B']);
    expect(r.ranked[0].compositeScore).toBe(120);
    expect(r.rankingIsNotExecutivePriority).toBe(true);
  });
  it('점수 미비 시나리오는 제외하고 정직 공개(Null → 0 금지)', () => {
    const r = rankScenarios([
      { scenarioCode: 'S-1', impactScore: 50, tradeoffScore: 20, riskScore: 10 },
      { scenarioCode: 'S-2', impactScore: null, tradeoffScore: 20, riskScore: 10 },
    ]);
    expect(r.ranked).toHaveLength(1);
    expect(r.unrankedScenarios).toEqual(['S-2']);
    expect(rankScenarios(null).ranked).toEqual([]);
  });
});

describe('buildExecutiveDecisionScorecard(§8 — 결정적 정렬)', () => {
  const base = { category: 'strategy', humanReviewPresent: false };
  it('high_negative/poor_tradeoff/speculative 우선 + 동순위는 코드순', () => {
    const r = buildExecutiveDecisionScorecard([
      { ...base, scenarioCode: 'S-C', impact: 'neutral_candidate' as const, tradeoff: 'balanced_candidate' as const, confidence: 'high_confidence_candidate' as const },
      { ...base, scenarioCode: 'S-A', impact: 'high_negative_candidate' as const, tradeoff: 'poor_tradeoff_candidate' as const, confidence: 'speculative_candidate' as const },
      { ...base, scenarioCode: 'S-B', impact: 'high_negative_candidate' as const, tradeoff: 'poor_tradeoff_candidate' as const, confidence: 'speculative_candidate' as const },
    ], 3);
    expect(r.priorityRows.map((e) => e.scenarioCode)).toEqual(['S-A', 'S-B', 'S-C']);
    expect(r.fields).toHaveLength(9);
    expect(r.scorecardIsNotDecision).toBe(true);
    expect(r.orderingIsDeterministic).toBe(true);
  });
  it('null 입력 → 빈 행(오류 없음)', () => {
    expect(buildExecutiveDecisionScorecard(null).priorityRows).toEqual([]);
  });
});

describe('validateScenarioReview(§9 — 채택·실행은 사람)', () => {
  it('Self-Review + Evidence 없음 → 이중 차단', () => {
    const r = validateScenarioReview({ action: 'record_review_reference', evidenceCount: 0, isSelfReview: true });
    expect(r.allowed).toBe(false);
    expect(r.blockedReasons).toHaveLength(2);
    expect(r.reviewIsNotApproval).toBe(true);
    expect(r.adoptionIsHuman).toBe(true);
  });
  it('타인 Review + Evidence 존재 → 허용, 그 외 액션은 게이트 미적용', () => {
    expect(validateScenarioReview({ action: 'record_review_reference', evidenceCount: 1, isSelfReview: false }).allowed).toBe(true);
    expect(validateScenarioReview({ action: 'mark_in_review', evidenceCount: null, isSelfReview: true }).allowed).toBe(true);
  });
});

describe('buildScenarioTimeline / Honest Boundary(Support Matrix)', () => {
  it('15단계 관측 표시(자동 진행 아님)', () => {
    const rows = buildScenarioTimeline({ present: { enterprise_vision: true, scenario_learning: true } });
    expect(rows).toHaveLength(15);
    expect(rows[0]).toEqual({ stage: 'enterprise_vision', present: true });
    expect(rows.filter((r) => r.present)).toHaveLength(2);
  });
  it('Support Matrix 48항목 — unavailable 10종은 전부 automatic_*(절대 금지 1:1)', () => {
    expect(ENTERPRISE_SCENARIO_SUPPORT_MATRIX).toHaveLength(48);
    const unavailable = ENTERPRISE_SCENARIO_SUPPORT_MATRIX.filter((e) => e.support === 'unavailable');
    expect(unavailable).toHaveLength(10);
    expect(unavailable.every((e) => e.capability.startsWith('automatic_'))).toBe(true);
    for (const cap of ['automatic_strategy_execution', 'automatic_project_creation', 'automatic_budget_change', 'automatic_contract_signing', 'automatic_organization_change', 'automatic_kpi_change', 'automatic_merge', 'automatic_deploy', 'automatic_rollback']) {
      expect(unavailable.some((e) => e.capability === cap)).toBe(true);
    }
  });
  it('실측 부재 피드(재무 계획/ERP/PM/인력 캐파/외부 예측/Monte Carlo)는 insufficient_data 로 정직 표기', () => {
    const missing = ENTERPRISE_SCENARIO_SUPPORT_MATRIX.filter((e) => e.support === 'insufficient_data').map((e) => e.capability);
    expect(missing).toHaveLength(6);
    for (const feed of ['financial_planning_system', 'erp_feed', 'project_management_feed', 'hr_capacity_feed', 'external_forecast_feed', 'monte_carlo_engine']) {
      expect(missing).toContain(feed);
    }
  });
});
