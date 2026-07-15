import { describe, expect, it } from 'vitest';
import {
  ADVISORY_SUPPORT,
  analyzePortfolioBalance,
  analyzeTradeoff,
  buildAdvisoryConfidence,
  buildDecisionMatrix,
  buildExecutiveAdvisory,
  buildExecutiveBriefing20,
  buildExecutiveCockpit20,
  buildScenarioComparison,
  classifyStrategyPosture,
  evaluateStrategicAlignment,
  projectDecisionImpact,
  validateExplainability,
  type ScenarioInput,
} from './strategicAdvisory';

const CONSERVATIVE: ScenarioInput = { name: 'Conservative', posture: 'conservative', expectedDelivery: 80, expectedRisk: 20, expectedCostKrw: 1000, expectedImpact: 40, expectedTimelineDays: 60, confidence: 75 };
const AGGRESSIVE: ScenarioInput = { name: 'Aggressive', posture: 'aggressive', expectedDelivery: 60, expectedRisk: 70, expectedCostKrw: 5000, expectedImpact: 85, expectedTimelineDays: 30, confidence: 45 };

describe('scenario comparison — 자동 선택 없음', () => {
  it('2개 미만 → insufficient, 2개 → sample_too_small, completeness 계산 + autoSelected=false', () => {
    expect(buildScenarioComparison(null).status).toBe('insufficient_data');
    expect(buildScenarioComparison([CONSERVATIVE]).status).toBe('insufficient_data');
    const r = buildScenarioComparison([CONSERVATIVE, AGGRESSIVE]);
    expect(r.status).toBe('sample_too_small');
    expect(r.rows[0].completeness).toBe(100);
    expect(r.autoSelected).toBe(false);
    expect(r.scenarioIsNotReality).toBe(true);
    expect(buildScenarioComparison([CONSERVATIVE, AGGRESSIVE, { ...CONSERVATIVE, name: 'Balanced' }]).status).toBe('advisory_reference');
  });
  it('null 필드는 completeness 에만 반영(0 변환 없음)', () => {
    const partial = buildScenarioComparison([{ ...CONSERVATIVE, expectedCostKrw: null, confidence: null }, AGGRESSIVE]);
    expect(partial.rows[0].completeness).toBe(67);
    expect(partial.rows[0].expectedCostKrw).toBeNull();
  });
});

describe('trade-off — 최적화 보장 아님', () => {
  it('Impact↑ → Risk↑ → Confidence↓ 체인 생성', () => {
    const r = analyzeTradeoff(CONSERVATIVE, AGGRESSIVE);
    expect(r.chains.length).toBeGreaterThan(0);
    expect(r.chains[0].consequence).toContain('Risk ↑');
    expect(r.chains[0].consequence).toContain('Confidence ↓');
    expect(r.optimizationGuaranteed).toBe(false);
    expect(analyzeTradeoff(null, AGGRESSIVE).chains).toEqual([]);
  });
  it('속도 ↔ 안정성 Trade-off 감지', () => {
    const r = analyzeTradeoff(CONSERVATIVE, AGGRESSIVE);
    expect(r.chains.some((c) => c.factor === 'delivery_speed')).toBe(true);
  });
});

describe('decision matrix / posture', () => {
  it('matrix: null 유지 + decisionMadeByAI=false', () => {
    const r = buildDecisionMatrix([{ ...CONSERVATIVE, expectedCostKrw: null }], { unknownFactors: ['market'], assumptions: ['a'], evidenceCoverage: 60 });
    expect(r.rows[0].cost).toBeNull();
    expect(r.unknownFactors).toContain('market');
    expect(r.decisionMadeByAI).toBe(false);
  });
  it('posture: conservative/aggressive/balanced 분류 + 장단점 + 자료 없으면 insufficient', () => {
    expect(classifyStrategyPosture({ expectedRisk: 20, expectedImpact: 40 }).posture).toBe('conservative');
    expect(classifyStrategyPosture({ expectedRisk: 70, expectedImpact: 85 }).posture).toBe('aggressive');
    expect(classifyStrategyPosture({ expectedRisk: 45, expectedImpact: 55 }).posture).toBe('balanced');
    const unknown = classifyStrategyPosture({ expectedRisk: null, expectedImpact: 50 });
    expect(unknown.posture).toBe('insufficient_data');
    expect(unknown.autoSelected).toBe(false);
    expect(classifyStrategyPosture({ expectedRisk: 70, expectedImpact: 85 }).cons.length).toBeGreaterThan(0);
  });
});

describe('portfolio advisory — 자동 재조정 없음', () => {
  it('단일 domain 집중 감지 + capacity unknown/초과 분기', () => {
    const r = analyzePortfolioBalance({ includedCount: 3, hardRiskCount: 1, domains: ['executive', 'executive', 'executive'], totalReviewHours: 50, availableReviewHours: 40, expectedCompletionPct: null });
    expect(r.balance).toBe('concentrated_candidate');
    expect(r.resourcePressure).toBe('over_capacity');
    expect(r.expectedCompletion).toBeNull();
    expect(r.autoRebalanced).toBe(false);
    expect(analyzePortfolioBalance({ includedCount: 2, hardRiskCount: 0, domains: ['a', 'b'], totalReviewHours: null, availableReviewHours: null, expectedCompletionPct: 60 }).resourcePressure).toBe('capacity_unknown');
  });
});

describe('explainable advisory — 근거 없는 추천 금지', () => {
  it('설명 체인 2단계 미만 → 거부, whitelist 외 유형 → 거부', () => {
    expect('rejected' in buildExecutiveAdvisory({ type: 'consider_scenario', title: 't', summary: 's', reasoningChain: ['하나뿐'], evidence: ['e'], confidence: null, alternatives: [], assumptions: [], unknownFactors: [] })).toBe(true);
    expect('rejected' in buildExecutiveAdvisory({ type: 'auto_select_strategy', title: 't', summary: 's', reasoningChain: ['1', '2'], evidence: ['e'], confidence: null, alternatives: [], assumptions: [], unknownFactors: [] })).toBe(true);
    expect('rejected' in buildExecutiveAdvisory({ type: 'consider_scenario', title: 't', summary: 's', reasoningChain: ['Risk 낮음', 'Coverage 높음'], evidence: [], confidence: null, alternatives: [], assumptions: [], unknownFactors: [] })).toBe(true);
  });
  it('정상 생성: 8요소 + humanApprovalRequired + decisionMade=false + 대안 기본값', () => {
    const r = buildExecutiveAdvisory({ type: 'consider_scenario', title: 'Scenario B 검토', summary: 'Risk 낮고 Coverage 높음', reasoningChain: ['Risk 가 낮고', 'Evidence Coverage 가 높으며', 'Dependency 가 적기 때문'], evidence: ['comparison'], confidence: 60, alternatives: [], assumptions: ['현 인력 유지'], unknownFactors: ['market'] });
    if ('humanApprovalRequired' in r) {
      expect(r.humanApprovalRequired).toBe(true);
      expect(r.decisionMade).toBe(false);
      expect(r.reasoningChain).toHaveLength(3);
      expect(r.alternatives[0]).toContain('현행 유지');
      expect(r.limitations).toContain('Recommendation ≠ Decision');
    }
    expect(validateExplainability(['왜', '근거'], ['e']).explainable).toBe(true);
    expect(validateExplainability(['하나'], ['e']).explainable).toBe(false);
  });
});

describe('briefing / alignment / impact projection', () => {
  it('briefing: 5섹션 + autoSent=false + Risk 생략 금지 명시', () => {
    const r = buildExecutiveBriefing20({ period: 'weekly', keyChanges: ['c1'], coreRisks: ['r1'], opportunities: ['o1'], unknowns: ['u1'], recommendations: ['rec1'] });
    expect(r.sections.coreRisks).toContain('r1');
    expect(r.autoSent).toBe(false);
    expect(r.limitations.some((l) => l.includes('생략 금지'))).toBe(true);
  });
  it('alignment: 매핑 자료 없으면 unverified(임의 생성 금지), 충돌 시 misaligned', () => {
    expect(evaluateStrategicAlignment({ scenarioName: 'A', matchedPriorities: null, totalPriorities: null, policyConflicts: null, governanceIssues: null }).verdict).toBe('alignment_unverified');
    expect(evaluateStrategicAlignment({ scenarioName: 'A', matchedPriorities: 8, totalPriorities: 10, policyConflicts: 0, governanceIssues: 0 }).verdict).toBe('aligned_reference');
    expect(evaluateStrategicAlignment({ scenarioName: 'A', matchedPriorities: 8, totalPriorities: 10, policyConflicts: 2, governanceIssues: 0 }).verdict).toBe('misaligned_candidate');
  });
  it('impact projection: KPI 없으면 unavailable + projectionNotOutcome', () => {
    const r = projectDecisionImpact([AGGRESSIVE], [{ key: 'mrr', available: true }, { key: 'csat', available: false }]);
    expect(r.rows.find((x) => x.kpi === 'mrr')?.direction).toBe('increase_expected');
    expect(r.rows.find((x) => x.kpi === 'csat')?.direction).toBe('projection_unavailable');
    expect(r.projectionNotOutcome).toBe(true);
  });
});

describe('cockpit 2.0 / advisory confidence / support', () => {
  it('cockpit: 9영역 + humanDecisionRequired + autoExecution=false', () => {
    const r = buildExecutiveCockpit20({ strategy: '현행', comparisonCount: 1, matrixReady: true, pendingAdvisories: 2, portfolioBalance: 'balanced_reference', tradeoffChains: 2, projectionAvailable: 2, projectionUnavailable: 1, healthStatus: 'watch_candidate', briefingPeriod: 'weekly' });
    expect(r.sections).toHaveLength(9);
    expect(r.humanDecisionRequired).toBe(true);
    expect(r.autoExecution).toBe(false);
    expect(r.sections.find((s) => s.key === 'executive_recommendation')?.detail).toBe('Recommendation ≠ Decision');
  });
  it('advisory confidence: Confidence ≠ Correctness + freshness + 전부 null → null', () => {
    const r = buildAdvisoryConfidence({ componentValues: [80, null, 60], unknownFactors: ['m'], assumptions: ['a'], inputAgeDays: 40 });
    expect(r.confidence).toBe(70);
    expect(r.evidenceCoverage).toBe(67);
    expect(r.freshness).toBe('stale_input_candidate');
    expect(r.correctnessImplied).toBe(false);
    expect(buildAdvisoryConfidence({ componentValues: [null, null], unknownFactors: [], assumptions: [], inputAgeDays: null }).confidence).toBeNull();
  });
  it('ADVISORY_SUPPORT: 17항목 + 시장/CSAT/자동 선택/자동 변경/Production unsupported', () => {
    expect(ADVISORY_SUPPORT).toHaveLength(17);
    for (const key of ['kpi_market', 'kpi_csat', 'auto_strategy_selection', 'auto_change', 'production_apply']) {
      expect(ADVISORY_SUPPORT.find((s) => s.key === key)?.status).toBe('unsupported');
    }
  });
});
