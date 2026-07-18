// AI-OPS-55 — Enterprise Value Optimization 순수 로직 테스트.
// 스펙 §12 최소: ROI Assessment / Benefit Realization / Value Leakage /
// Optimization Opportunity / Review Workflow / Honest Boundary.
import { describe, expect, it } from 'vitest';
import {
  VALUE_CATEGORIES,
  VALUE_REALIZATION_STATUSES,
  ROI_DIMENSIONS,
  ROI_RESULTS,
  BENEFIT_DIMENSIONS,
  BENEFIT_RESULTS,
  LEAKAGE_DIMENSIONS,
  LEAKAGE_RESULTS,
  COST_BENEFIT_RESULTS,
  INVESTMENT_EFFECTIVENESS_RESULTS,
  KPI_CONTRIBUTION_RESULTS,
  PORTFOLIO_VALUE_RESULTS,
  VALUE_REVIEW_TYPES,
  VALUE_REVIEW_STATUSES,
  VALUE_RECOMMENDATION_TYPES,
  VALUE_SCORECARD_FIELDS,
  VALUE_FLOW_STAGES,
  evaluateRoiAssessment,
  evaluateBenefitRealization,
  analyzeValueLeakage,
  analyzeInvestmentEffectiveness,
  buildOptimizationOpportunities,
  buildExecutiveValueScorecard,
  validateValueReview,
  buildValueTimeline,
  ENTERPRISE_VALUE_OPTIMIZATION_SUPPORT_MATRIX,
} from './enterpriseValueOptimization';

describe('상수(0559 SQL CHECK 와 1:1)', () => {
  it('Category 11종 / Status 5종 / Review 3종·5상태 / Scorecard 8필드 / Flow 13단계', () => {
    expect(VALUE_CATEGORIES).toHaveLength(11);
    expect(VALUE_REALIZATION_STATUSES).toHaveLength(5);
    expect(VALUE_REVIEW_TYPES).toHaveLength(3);
    expect(VALUE_REVIEW_STATUSES).toHaveLength(5);
    expect(VALUE_SCORECARD_FIELDS).toHaveLength(8);
    expect(VALUE_FLOW_STAGES).toHaveLength(13);
  });

  it('ROI/Benefit/Leakage 차원 5종 + 결과 5종, 파생 결과 whitelist, 권고 23종', () => {
    expect(ROI_DIMENSIONS).toHaveLength(5);
    expect(ROI_RESULTS).toHaveLength(5);
    expect(BENEFIT_DIMENSIONS).toHaveLength(5);
    expect(BENEFIT_RESULTS).toHaveLength(5);
    expect(LEAKAGE_DIMENSIONS).toHaveLength(5);
    expect(LEAKAGE_RESULTS).toHaveLength(5);
    expect(COST_BENEFIT_RESULTS).toHaveLength(5);
    expect(INVESTMENT_EFFECTIVENESS_RESULTS).toHaveLength(6);
    expect(KPI_CONTRIBUTION_RESULTS).toHaveLength(5);
    expect(PORTFOLIO_VALUE_RESULTS).toHaveLength(5);
    expect(VALUE_RECOMMENDATION_TYPES).toHaveLength(23);
  });
});

describe('ROI Assessment(§5)', () => {
  it('평균 기반 판정 + weakest 차원 공개', () => {
    const r = evaluateRoiAssessment([
      { dimension: 'financial_return', score: 90 },
      { dimension: 'operational_gain', score: 80 },
      { dimension: 'strategic_value', score: 70 },
    ]);
    expect(r.result).toBe('exceptional_roi_candidate');
    expect(r.averageScore).toBe(80);
    expect(r.weakestDimension).toBe('strategic_value');
    expect(r.missingDimensions).toEqual(['resource_efficiency', 'sustainability']);
    expect(r.roiIsNotBusinessSuccess).toBe(true);
  });

  it('경계값 80/60/35 판정', () => {
    const at = (s: number) =>
      evaluateRoiAssessment([
        { dimension: 'financial_return', score: s },
        { dimension: 'operational_gain', score: s },
        { dimension: 'strategic_value', score: s },
      ]).result;
    expect(at(80)).toBe('exceptional_roi_candidate');
    expect(at(60)).toBe('strong_roi_candidate');
    expect(at(35)).toBe('acceptable_roi_candidate');
    expect(at(34)).toBe('weak_roi_candidate');
  });

  it('유효 차원 3개 미만 → insufficient_data(Null → 0 금지)', () => {
    const r = evaluateRoiAssessment([
      { dimension: 'financial_return', score: 90 },
      { dimension: 'operational_gain', score: null },
      { dimension: 'unknown_dimension', score: 50 },
    ]);
    expect(r.result).toBe('insufficient_data');
    expect(r.averageScore).toBeNull();
    expect(evaluateRoiAssessment(null).result).toBe('insufficient_data');
  });
});

describe('Benefit Realization(§6)', () => {
  it('경계값 90/65/30 판정 + benefitGap 공개', () => {
    expect(evaluateBenefitRealization({ plannedBenefit: 100, deliveredBenefit: 90 }).result).toBe('fully_realized_candidate');
    expect(evaluateBenefitRealization({ plannedBenefit: 100, deliveredBenefit: 65 }).result).toBe('mostly_realized_candidate');
    expect(evaluateBenefitRealization({ plannedBenefit: 100, deliveredBenefit: 30 }).result).toBe('partially_realized_candidate');
    const r = evaluateBenefitRealization({ plannedBenefit: 100, deliveredBenefit: 10 });
    expect(r.result).toBe('unrealized_candidate');
    expect(r.benefitGap).toBe(90);
    expect(r.benefitIsNotProfit).toBe(true);
  });

  it('Null/invalid planned → insufficient_data, 표본 3 미만 → sample_too_small', () => {
    expect(evaluateBenefitRealization({ plannedBenefit: null, deliveredBenefit: 50 }).reason).toBe('insufficient_data');
    expect(evaluateBenefitRealization({ plannedBenefit: 0, deliveredBenefit: 50 }).reason).toBe('invalid_planned_benefit');
    const r = evaluateBenefitRealization({ plannedBenefit: 100, deliveredBenefit: 90, sampleSize: 2 });
    expect(r.result).toBe('insufficient_data');
    expect(r.reason).toBe('sample_too_small');
    expect(evaluateBenefitRealization(null).result).toBe('insufficient_data');
  });

  it('초과 실현은 200% 클램프(과대 표시 방지)', () => {
    expect(evaluateBenefitRealization({ plannedBenefit: 10, deliveredBenefit: 100 }).realizationRatio).toBe(200);
  });
});

describe('Value Leakage(§7)', () => {
  it('worst-of 판정 + worst 차원 공개', () => {
    const r = analyzeValueLeakage([
      { dimension: 'budget_leakage', severity: 20 },
      { dimension: 'time_leakage', severity: 75 },
    ]);
    expect(r.result).toBe('critical_leakage_candidate');
    expect(r.worstDimension).toBe('time_leakage');
    expect(r.unevaluatedDimensions).toEqual(['resource_leakage', 'opportunity_leakage', 'process_leakage']);
    expect(r.leakageIsNotFailure).toBe(true);
  });

  it('경계값 70/40/15 판정', () => {
    const at = (s: number) =>
      analyzeValueLeakage([
        { dimension: 'budget_leakage', severity: s },
        { dimension: 'process_leakage', severity: 0 },
      ]).result;
    expect(at(70)).toBe('critical_leakage_candidate');
    expect(at(40)).toBe('elevated_leakage_candidate');
    expect(at(15)).toBe('manageable_leakage_candidate');
    expect(at(14)).toBe('negligible_leakage_candidate');
  });

  it('유효 차원 2개 미만 → insufficient_data', () => {
    expect(analyzeValueLeakage([{ dimension: 'budget_leakage', severity: 90 }]).result).toBe('insufficient_data');
    expect(analyzeValueLeakage([{ dimension: 'budget_leakage', severity: null }, { dimension: 'time_leakage', severity: null }]).result).toBe('insufficient_data');
  });
});

describe('Investment Effectiveness', () => {
  it('비율 경계값 1.5/1.0/0.5 판정', () => {
    expect(analyzeInvestmentEffectiveness({ investment: 100, benefit: 150 }).result).toBe('highly_effective_investment_candidate');
    expect(analyzeInvestmentEffectiveness({ investment: 100, benefit: 100 }).result).toBe('effective_investment_candidate');
    expect(analyzeInvestmentEffectiveness({ investment: 100, benefit: 50 }).result).toBe('marginally_effective_investment_candidate');
    expect(analyzeInvestmentEffectiveness({ investment: 100, benefit: 49 }).result).toBe('ineffective_investment_candidate');
  });

  it('investment ≤ 0/Null → insufficient_data, benefit Null → unverified(Null → 0 금지)', () => {
    expect(analyzeInvestmentEffectiveness({ investment: 0, benefit: 50 }).result).toBe('insufficient_data');
    expect(analyzeInvestmentEffectiveness({ investment: null, benefit: 50 }).result).toBe('insufficient_data');
    const r = analyzeInvestmentEffectiveness({ investment: 100, benefit: null });
    expect(r.result).toBe('investment_effectiveness_unverified');
    expect(r.benefitToInvestmentRatio).toBeNull();
  });
});

describe('Optimization Opportunity', () => {
  it('impact − effort 정렬 + Evidence 없는 후보 제외 + 미측정 후보 분리 공개', () => {
    const r = buildOptimizationOpportunities([
      { title: 'B 후보', expectedImpact: 80, effort: 20, evidenceCount: 2 },
      { title: 'A 후보', expectedImpact: 90, effort: 30, evidenceCount: 1 },
      { title: 'C 후보(무증거)', expectedImpact: 95, effort: 5, evidenceCount: 0 },
      { title: 'D 후보(미측정)', expectedImpact: null, effort: 10, evidenceCount: 3 },
    ]);
    expect(r.ranked.map((x) => x.title)).toEqual(['A 후보', 'B 후보']);
    expect(r.ranked[0].priorityScore).toBe(60);
    expect(r.excludedWithoutEvidence).toEqual(['C 후보(무증거)']);
    expect(r.unverifiedCandidates).toEqual(['D 후보(미측정)']);
    expect(r.optimizationIsNotAutomaticImprovement).toBe(true);
  });

  it('동점은 제목순 결정적 정렬, null 입력 안전', () => {
    const r = buildOptimizationOpportunities([
      { title: 'b', expectedImpact: 50, effort: 10, evidenceCount: 1 },
      { title: 'a', expectedImpact: 50, effort: 10, evidenceCount: 1 },
    ]);
    expect(r.ranked.map((x) => x.title)).toEqual(['a', 'b']);
    expect(buildOptimizationOpportunities(null).ranked).toEqual([]);
  });
});

describe('Executive Value Scorecard(§8)', () => {
  it('심각도 가중(×10/×5/×3/×1) + attention 정렬', () => {
    const r = buildExecutiveValueScorecard({ criticalLeakages: 2, unrealizedBenefits: 3, weakRoiRealizations: 1, pendingHumanReviews: 4 });
    expect(r.severityScore).toBe(2 * 10 + 3 * 5 + 1 * 3 + 4);
    expect(r.attention[0].area).toBe('critical_leakages');
    expect(r.fields).toHaveLength(8);
    expect(r.humanReviewRequired).toBe(true);
  });

  it('null-safe — 입력 없으면 0 심각도(0 생성 아님 — 관측 없음 명시)', () => {
    const r = buildExecutiveValueScorecard(null);
    expect(r.severityScore).toBe(0);
    expect(r.attention).toEqual([]);
  });
});

describe('Review Workflow(§9)', () => {
  it('허용 3종 외 차단 / Self-Review 차단 / Evidence 필수', () => {
    expect(validateValueReview({ reviewType: 'auto_approval', createdBy: 'u1', reviewerId: 'u2', evidenceCount: 1 }).reason).toBe('invalid_review_type');
    expect(validateValueReview({ reviewType: 'value_review', createdBy: 'u1', reviewerId: 'u1', evidenceCount: 1 }).reason).toBe('self_review_blocked');
    expect(validateValueReview({ reviewType: 'executive_review', createdBy: 'u1', reviewerId: 'u2', evidenceCount: 0 }).reason).toBe('evidence_required');
    expect(validateValueReview({ reviewType: 'human_review', createdBy: 'u1', reviewerId: null, evidenceCount: 1 }).reason).toBe('reviewer_required');
    const ok = validateValueReview({ reviewType: 'value_review', createdBy: 'u1', reviewerId: 'u2', evidenceCount: 2 });
    expect(ok.valid).toBe(true);
    expect(ok.reviewIsNotApproval).toBe(true);
  });
});

describe('Value Timeline', () => {
  it('13단계 순서 고정 + 미지 단계 정직 공개', () => {
    const r = buildValueTimeline([
      { stage: 'roi_analysis', label: 'Q1 ROI' },
      { stage: 'vision' },
      { stage: 'unknown_stage' },
    ]);
    expect(r.stages).toHaveLength(13);
    expect(r.stages[0].stage).toBe('vision');
    expect(r.stages.find((s) => s.stage === 'roi_analysis')?.entries).toEqual(['Q1 ROI']);
    expect(r.unknownStages).toEqual(['unknown_stage']);
  });
});

describe('Honest Boundary(Support Matrix)', () => {
  it('48항목 — unavailable 11종은 전부 automatic_*(스펙 금지 목록 1:1)', () => {
    expect(ENTERPRISE_VALUE_OPTIMIZATION_SUPPORT_MATRIX).toHaveLength(48);
    const unavailable = ENTERPRISE_VALUE_OPTIMIZATION_SUPPORT_MATRIX.filter((e) => e.level === 'unavailable');
    expect(unavailable).toHaveLength(11);
    expect(unavailable.every((e) => e.feature.startsWith('automatic_'))).toBe(true);
  });

  it('부재 피드 6종은 insufficient_data 로 정직 고지', () => {
    const missing = ENTERPRISE_VALUE_OPTIMIZATION_SUPPORT_MATRIX.filter((e) => e.level === 'insufficient_data').map((e) => e.feature);
    expect(missing).toEqual(['accounting_ledger_feed', 'erp_finance_ledger', 'billing_system_feed', 'crm_revenue_feed', 'cost_accounting_system', 'market_benchmark_feed']);
  });

  it('투자 결정/Budget/Portfolio/Strategy 변경은 human_review_only', () => {
    const human = ENTERPRISE_VALUE_OPTIMIZATION_SUPPORT_MATRIX.filter((e) => e.level === 'human_review_only').map((e) => e.feature);
    expect(human).toEqual(['investment_decision', 'budget_change_decision', 'portfolio_change_decision', 'strategy_change_decision']);
  });
});
