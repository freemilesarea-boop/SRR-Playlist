// AI-OPS-59 — Enterprise Foresight 순수 로직 테스트.
// 스펙 §12 최소: Weak Signal Assessment / Future Scenario Assessment /
// Long-Term Opportunity Assessment / Strategic Option Ranking /
// Review Workflow / Honest Boundary.
import { describe, expect, it } from 'vitest';
import {
  FORESIGHT_CATEGORIES,
  FORESIGHT_STATUSES,
  WEAK_SIGNAL_DIMENSIONS,
  WEAK_SIGNAL_RESULTS,
  FUTURE_SCENARIO_DIMENSIONS,
  FUTURE_SCENARIO_RESULTS,
  LONG_TERM_OPPORTUNITY_DIMENSIONS,
  LONG_TERM_OPPORTUNITY_RESULTS,
  LONG_TERM_RISK_RESULTS,
  STRATEGIC_OPTION_RESULTS,
  TREND_EVOLUTION_RESULTS,
  SCENARIO_READINESS_RESULTS,
  OPPORTUNITY_HORIZON_RESULTS,
  UNCERTAINTY_RESULTS,
  FORESIGHT_REVIEW_TYPES,
  FORESIGHT_REVIEW_STATUSES,
  FORESIGHT_RECOMMENDATION_TYPES,
  FORESIGHT_SCORECARD_FIELDS,
  FORESIGHT_FLOW_STAGES,
  assessWeakSignal,
  assessFutureScenario,
  assessLongTermOpportunity,
  rankStrategicOptions,
  buildExecutiveForesightScorecard,
  validateForesightReview,
  buildForesightTimeline,
  ENTERPRISE_FORESIGHT_SUPPORT_MATRIX,
} from './enterpriseForesight';

describe('상수(0563 SQL CHECK 와 1:1)', () => {
  it('Category 11종 / Status 5종 / Review 3종·5상태 / Scorecard 8필드 / Flow 12단계', () => {
    expect(FORESIGHT_CATEGORIES).toHaveLength(11);
    expect(FORESIGHT_STATUSES).toHaveLength(5);
    expect(FORESIGHT_REVIEW_TYPES).toHaveLength(3);
    expect(FORESIGHT_REVIEW_STATUSES).toHaveLength(5);
    expect(FORESIGHT_SCORECARD_FIELDS).toHaveLength(8);
    expect(FORESIGHT_FLOW_STAGES).toHaveLength(12);
  });

  it('Signal/Scenario/Opportunity 차원 5종 + 결과 5종, 파생 결과 whitelist, 권고 23종', () => {
    expect(WEAK_SIGNAL_DIMENSIONS).toHaveLength(5);
    expect(WEAK_SIGNAL_RESULTS).toHaveLength(5);
    expect(FUTURE_SCENARIO_DIMENSIONS).toHaveLength(5);
    expect(FUTURE_SCENARIO_RESULTS).toHaveLength(5);
    expect(LONG_TERM_OPPORTUNITY_DIMENSIONS).toHaveLength(5);
    expect(LONG_TERM_OPPORTUNITY_RESULTS).toHaveLength(5);
    expect(LONG_TERM_RISK_RESULTS).toHaveLength(5);
    expect(STRATEGIC_OPTION_RESULTS).toHaveLength(5);
    expect(TREND_EVOLUTION_RESULTS).toHaveLength(5);
    expect(SCENARIO_READINESS_RESULTS).toHaveLength(5);
    expect(OPPORTUNITY_HORIZON_RESULTS).toHaveLength(5);
    expect(UNCERTAINTY_RESULTS).toHaveLength(5);
    expect(FORESIGHT_RECOMMENDATION_TYPES).toHaveLength(23);
  });
});

describe('Weak Signal Assessment(§5)', () => {
  it('평균 기반 경계값 75/50/25 판정 + weakest 공개', () => {
    const at = (s: number) =>
      assessWeakSignal([
        { dimension: 'evidence', score: s },
        { dimension: 'signal_strength', score: s },
        { dimension: 'consistency', score: s },
      ]).result;
    expect(at(75)).toBe('highly_significant_candidate');
    expect(at(50)).toBe('significant_candidate');
    expect(at(25)).toBe('emerging_candidate');
    expect(at(24)).toBe('speculative_candidate');
  });

  it('evidence 차원 미평가 시 highly_significant 승격 차단(과단정 방지)', () => {
    const r = assessWeakSignal([
      { dimension: 'signal_strength', score: 90 },
      { dimension: 'consistency', score: 90 },
      { dimension: 'relevance', score: 90 },
    ]);
    expect(r.averageScore).toBe(90);
    expect(r.result).toBe('significant_candidate');
    expect(r.missingDimensions).toContain('evidence');
    expect(r.weakSignalIsNotFutureFact).toBe(true);
  });

  it('유효 차원 3개 미만 → insufficient_data(Null → 0 금지)', () => {
    expect(assessWeakSignal([
      { dimension: 'evidence', score: 90 },
      { dimension: 'signal_strength', score: null },
    ]).result).toBe('insufficient_data');
    expect(assessWeakSignal(null).averageScore).toBeNull();
  });
});

describe('Future Scenario Assessment(§6)', () => {
  it('uncertainty 제외 평균 경계값 75/50/25 판정', () => {
    const at = (s: number) =>
      assessFutureScenario([
        { dimension: 'plausibility', score: s },
        { dimension: 'strategic_impact', score: s },
        { dimension: 'business_alignment', score: s },
      ]).result;
    expect(at(75)).toBe('highly_plausible_candidate');
    expect(at(50)).toBe('plausible_candidate');
    expect(at(25)).toBe('exploratory_candidate');
    expect(at(24)).toBe('speculative_candidate');
  });

  it('불확실성 ≥70 관측 시 plausible 승격 차단(exploratory 유지) + uncertaintyLevel 공개', () => {
    const r = assessFutureScenario([
      { dimension: 'plausibility', score: 90 },
      { dimension: 'strategic_impact', score: 90 },
      { dimension: 'business_alignment', score: 90 },
      { dimension: 'uncertainty', score: 80 },
    ]);
    expect(r.plausibilityScore).toBe(90);
    expect(r.uncertaintyLevel).toBe(80);
    expect(r.result).toBe('exploratory_candidate');
    expect(r.scenarioIsNotPrediction).toBe(true);
  });

  it('uncertainty 제외 유효 차원 3개 미만 → insufficient_data', () => {
    const r = assessFutureScenario([
      { dimension: 'plausibility', score: 90 },
      { dimension: 'uncertainty', score: 50 },
    ]);
    expect(r.result).toBe('insufficient_data');
    expect(r.uncertaintyLevel).toBe(50);
    expect(assessFutureScenario(null).result).toBe('insufficient_data');
  });
});

describe('Long-Term Opportunity Assessment(§7)', () => {
  it('평균 기반 경계값 80/60/35 판정 + strongest/weakest 공개', () => {
    const at = (s: number) =>
      assessLongTermOpportunity([
        { dimension: 'growth_potential', score: s },
        { dimension: 'sustainability', score: s },
        { dimension: 'strategic_value', score: s },
      ]).result;
    expect(at(80)).toBe('exceptional_candidate');
    expect(at(60)).toBe('strong_candidate');
    expect(at(35)).toBe('acceptable_candidate');
    expect(at(34)).toBe('weak_candidate');
    const r = assessLongTermOpportunity([
      { dimension: 'growth_potential', score: 90 },
      { dimension: 'competitive_advantage', score: 40 },
      { dimension: 'innovation_potential', score: 70 },
    ]);
    expect(r.strongestDimension).toBe('growth_potential');
    expect(r.weakestDimension).toBe('competitive_advantage');
    expect(r.missingDimensions).toEqual(['sustainability', 'strategic_value']);
    expect(r.opportunityIsNotSuccess).toBe(true);
  });

  it('유효 차원 3개 미만 → insufficient_data', () => {
    expect(assessLongTermOpportunity([
      { dimension: 'growth_potential', score: 90 },
      { dimension: 'unknown_dimension', score: 50 },
    ]).result).toBe('insufficient_data');
    expect(assessLongTermOpportunity(null).averageScore).toBeNull();
  });
});

describe('Strategic Option Ranking', () => {
  it('opportunity + plausibility − risk 정렬 + Evidence 없는 옵션 제외 + 미측정 분리 공개', () => {
    const r = rankStrategicOptions([
      { title: 'B 옵션', opportunityScore: 70, plausibilityScore: 50, riskScore: 30, evidenceCount: 2 },
      { title: 'A 옵션', opportunityScore: 85, plausibilityScore: 70, riskScore: 20, evidenceCount: 1 },
      { title: 'C 옵션(무증거)', opportunityScore: 95, plausibilityScore: 90, riskScore: 5, evidenceCount: 0 },
      { title: 'D 옵션(미측정)', opportunityScore: null, plausibilityScore: 50, riskScore: 10, evidenceCount: 3 },
    ]);
    expect(r.ranked.map((x) => x.title)).toEqual(['A 옵션', 'B 옵션']);
    expect(r.ranked[0].priorityScore).toBe(135);
    expect(r.excludedWithoutEvidence).toEqual(['C 옵션(무증거)']);
    expect(r.unverifiedOptions).toEqual(['D 옵션(미측정)']);
    expect(r.optionIsNotDecision).toBe(true);
  });

  it('동점은 제목순 결정적 정렬, null 입력 안전', () => {
    const r = rankStrategicOptions([
      { title: 'b', opportunityScore: 50, plausibilityScore: 50, riskScore: 10, evidenceCount: 1 },
      { title: 'a', opportunityScore: 50, plausibilityScore: 50, riskScore: 10, evidenceCount: 1 },
    ]);
    expect(r.ranked.map((x) => x.title)).toEqual(['a', 'b']);
    expect(rankStrategicOptions(null).ranked).toEqual([]);
  });
});

describe('Executive Foresight Scorecard(§8)', () => {
  it('심각도 가중(×10/×5/×3/×1) + attention 정렬', () => {
    const r = buildExecutiveForesightScorecard({ criticalFutureRisks: 2, speculativeSignals: 3, weakOpportunities: 1, pendingHumanReviews: 4 });
    expect(r.severityScore).toBe(2 * 10 + 3 * 5 + 1 * 3 + 4);
    expect(r.attention[0].area).toBe('critical_future_risks');
    expect(r.fields).toHaveLength(8);
    expect(r.humanReviewRequired).toBe(true);
  });

  it('null-safe — 입력 없으면 0 심각도(관측 없음 명시)', () => {
    const r = buildExecutiveForesightScorecard(null);
    expect(r.severityScore).toBe(0);
    expect(r.attention).toEqual([]);
  });
});

describe('Review Workflow(§9)', () => {
  it('허용 3종 외 차단 / Self-Review 차단 / Evidence 필수', () => {
    expect(validateForesightReview({ reviewType: 'auto_approval', createdBy: 'u1', reviewerId: 'u2', evidenceCount: 1 }).reason).toBe('invalid_review_type');
    expect(validateForesightReview({ reviewType: 'foresight_review', createdBy: 'u1', reviewerId: 'u1', evidenceCount: 1 }).reason).toBe('self_review_blocked');
    expect(validateForesightReview({ reviewType: 'executive_review', createdBy: 'u1', reviewerId: 'u2', evidenceCount: 0 }).reason).toBe('evidence_required');
    expect(validateForesightReview({ reviewType: 'human_review', createdBy: 'u1', reviewerId: null, evidenceCount: 1 }).reason).toBe('reviewer_required');
    const ok = validateForesightReview({ reviewType: 'foresight_review', createdBy: 'u1', reviewerId: 'u2', evidenceCount: 2 });
    expect(ok.valid).toBe(true);
    expect(ok.reviewIsNotApproval).toBe(true);
  });
});

describe('Foresight Timeline', () => {
  it('12단계 순서 고정 + 미지 단계 정직 공개', () => {
    const r = buildForesightTimeline([
      { stage: 'weak_signal_detection', label: 'Q1 신호' },
      { stage: 'vision' },
      { stage: 'unknown_stage' },
    ]);
    expect(r.stages).toHaveLength(12);
    expect(r.stages[0].stage).toBe('vision');
    expect(r.stages.find((s) => s.stage === 'weak_signal_detection')?.entries).toEqual(['Q1 신호']);
    expect(r.unknownStages).toEqual(['unknown_stage']);
  });
});

describe('Honest Boundary(Support Matrix)', () => {
  it('47항목 — unavailable 10종은 전부 automatic_*(스펙 금지 목록 1:1)', () => {
    expect(ENTERPRISE_FORESIGHT_SUPPORT_MATRIX).toHaveLength(47);
    const unavailable = ENTERPRISE_FORESIGHT_SUPPORT_MATRIX.filter((e) => e.level === 'unavailable');
    expect(unavailable).toHaveLength(10);
    expect(unavailable.every((e) => e.feature.startsWith('automatic_'))).toBe(true);
  });

  it('부재 피드 6종은 insufficient_data 로 정직 고지', () => {
    const missing = ENTERPRISE_FORESIGHT_SUPPORT_MATRIX.filter((e) => e.level === 'insufficient_data').map((e) => e.feature);
    expect(missing).toEqual(['futures_research_feed', 'trend_database_feed', 'expert_panel_feed', 'horizon_scanning_tool', 'macroeconomic_feed', 'foresight_platform_feed']);
  });

  it('장기 전략/투자/사업 시작/조직 변경 결정은 human_review_only', () => {
    const human = ENTERPRISE_FORESIGHT_SUPPORT_MATRIX.filter((e) => e.level === 'human_review_only').map((e) => e.feature);
    expect(human).toEqual(['long_term_strategy_decision', 'investment_decision', 'business_launch_decision', 'organization_change_decision']);
  });
});
