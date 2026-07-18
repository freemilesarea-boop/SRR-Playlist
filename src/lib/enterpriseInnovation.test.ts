// AI-OPS-58 — Enterprise Innovation 순수 로직 테스트.
// 스펙 §12 최소: Innovation Opportunity Assessment / Innovation Risk
// Assessment / Innovation Portfolio / Innovation Priority / Review Workflow /
// Honest Boundary.
import { describe, expect, it } from 'vitest';
import {
  INNOVATION_CATEGORIES,
  INNOVATION_STATUSES,
  OPPORTUNITY_DIMENSIONS,
  OPPORTUNITY_RESULTS,
  INNOVATION_RISK_DIMENSIONS,
  INNOVATION_RISK_RESULTS,
  INNOVATION_PORTFOLIO_DIMENSIONS,
  INNOVATION_PORTFOLIO_RESULTS,
  INNOVATION_READINESS_RESULTS,
  FUTURE_OPPORTUNITY_RESULTS,
  TECHNOLOGY_OPPORTUNITY_RESULTS,
  MARKET_POTENTIAL_RESULTS,
  INNOVATION_ALIGNMENT_RESULTS,
  INNOVATION_PRIORITY_RESULTS,
  INNOVATION_REVIEW_TYPES,
  INNOVATION_REVIEW_STATUSES,
  INNOVATION_RECOMMENDATION_TYPES,
  INNOVATION_SCORECARD_FIELDS,
  INNOVATION_FLOW_STAGES,
  evaluateInnovationOpportunity,
  assessInnovationRisk,
  evaluateInnovationPortfolio,
  rankInnovationPriority,
  buildExecutiveInnovationScorecard,
  validateInnovationReview,
  buildInnovationTimeline,
  ENTERPRISE_INNOVATION_SUPPORT_MATRIX,
} from './enterpriseInnovation';

describe('상수(0562 SQL CHECK 와 1:1)', () => {
  it('Category 11종 / Status 5종 / Review 3종·5상태 / Scorecard 8필드 / Flow 13단계', () => {
    expect(INNOVATION_CATEGORIES).toHaveLength(11);
    expect(INNOVATION_STATUSES).toHaveLength(5);
    expect(INNOVATION_REVIEW_TYPES).toHaveLength(3);
    expect(INNOVATION_REVIEW_STATUSES).toHaveLength(5);
    expect(INNOVATION_SCORECARD_FIELDS).toHaveLength(8);
    expect(INNOVATION_FLOW_STAGES).toHaveLength(13);
  });

  it('Opportunity/Risk/Portfolio 차원 5종 + 결과 5종, 파생 결과 whitelist, 권고 23종', () => {
    expect(OPPORTUNITY_DIMENSIONS).toHaveLength(5);
    expect(OPPORTUNITY_RESULTS).toHaveLength(5);
    expect(INNOVATION_RISK_DIMENSIONS).toHaveLength(5);
    expect(INNOVATION_RISK_RESULTS).toHaveLength(5);
    expect(INNOVATION_PORTFOLIO_DIMENSIONS).toHaveLength(5);
    expect(INNOVATION_PORTFOLIO_RESULTS).toHaveLength(5);
    expect(INNOVATION_READINESS_RESULTS).toHaveLength(5);
    expect(FUTURE_OPPORTUNITY_RESULTS).toHaveLength(5);
    expect(TECHNOLOGY_OPPORTUNITY_RESULTS).toHaveLength(5);
    expect(MARKET_POTENTIAL_RESULTS).toHaveLength(5);
    expect(INNOVATION_ALIGNMENT_RESULTS).toHaveLength(5);
    expect(INNOVATION_PRIORITY_RESULTS).toHaveLength(5);
    expect(INNOVATION_RECOMMENDATION_TYPES).toHaveLength(23);
  });
});

describe('Innovation Opportunity Assessment(§5)', () => {
  it('평균 기반 경계값 80/60/35 판정 + strongest/weakest 공개', () => {
    const at = (s: number) =>
      evaluateInnovationOpportunity([
        { dimension: 'strategic_value', score: s },
        { dimension: 'market_potential', score: s },
        { dimension: 'technical_feasibility', score: s },
      ]).result;
    expect(at(80)).toBe('exceptional_candidate');
    expect(at(60)).toBe('strong_candidate');
    expect(at(35)).toBe('acceptable_candidate');
    expect(at(34)).toBe('weak_candidate');
    const r = evaluateInnovationOpportunity([
      { dimension: 'strategic_value', score: 90 },
      { dimension: 'resource_availability', score: 40 },
      { dimension: 'innovation_readiness', score: 70 },
    ]);
    expect(r.strongestDimension).toBe('strategic_value');
    expect(r.weakestDimension).toBe('resource_availability');
    expect(r.missingDimensions).toEqual(['market_potential', 'technical_feasibility']);
    expect(r.opportunityIsNotGuaranteedSuccess).toBe(true);
  });

  it('유효 차원 3개 미만 → insufficient_data(Null → 0 금지)', () => {
    expect(evaluateInnovationOpportunity([
      { dimension: 'strategic_value', score: 90 },
      { dimension: 'market_potential', score: null },
    ]).result).toBe('insufficient_data');
    expect(evaluateInnovationOpportunity(null).averageScore).toBeNull();
  });
});

describe('Innovation Risk Assessment(§6)', () => {
  it('worst-of 경계값 70/40/15 판정 + worst 차원 공개', () => {
    const at = (s: number) =>
      assessInnovationRisk([
        { dimension: 'technology_risk', severity: s },
        { dimension: 'market_risk', severity: 0 },
      ]).result;
    expect(at(70)).toBe('critical_risk_candidate');
    expect(at(40)).toBe('elevated_risk_candidate');
    expect(at(15)).toBe('manageable_risk_candidate');
    expect(at(14)).toBe('low_risk_candidate');
    const r = assessInnovationRisk([
      { dimension: 'execution_risk', severity: 80 },
      { dimension: 'governance_risk', severity: 20 },
    ]);
    expect(r.worstDimension).toBe('execution_risk');
    expect(r.unevaluatedDimensions).toEqual(['technology_risk', 'market_risk', 'resource_risk']);
    expect(r.riskIsNotFailure).toBe(true);
  });

  it('유효 차원 2개 미만 → insufficient_data', () => {
    expect(assessInnovationRisk([{ dimension: 'technology_risk', severity: 90 }]).result).toBe('insufficient_data');
    expect(assessInnovationRisk([{ dimension: 'technology_risk', severity: null }, { dimension: 'market_risk', severity: null }]).result).toBe('insufficient_data');
    expect(assessInnovationRisk(null).result).toBe('insufficient_data');
  });
});

describe('Innovation Portfolio(§7)', () => {
  it('평균 기반 경계값 80/60/40 판정 + weakest 공개', () => {
    const at = (s: number) =>
      evaluateInnovationPortfolio([
        { dimension: 'portfolio_balance', score: s },
        { dimension: 'strategic_alignment', score: s },
        { dimension: 'investment_diversity', score: s },
      ]).result;
    expect(at(80)).toBe('highly_balanced_candidate');
    expect(at(60)).toBe('balanced_candidate');
    expect(at(40)).toBe('partially_balanced_candidate');
    expect(at(39)).toBe('imbalanced_candidate');
    const r = evaluateInnovationPortfolio([
      { dimension: 'portfolio_balance', score: 90 },
      { dimension: 'innovation_coverage', score: 30 },
      { dimension: 'long_term_sustainability', score: 80 },
    ]);
    expect(r.weakestDimension).toBe('innovation_coverage');
    expect(r.portfolioIsNotChangeDirective).toBe(true);
  });

  it('유효 차원 3개 미만 → insufficient_data', () => {
    expect(evaluateInnovationPortfolio([
      { dimension: 'portfolio_balance', score: 90 },
      { dimension: 'unknown_dimension', score: 50 },
    ]).result).toBe('insufficient_data');
    expect(evaluateInnovationPortfolio(null).averageScore).toBeNull();
  });
});

describe('Innovation Priority', () => {
  it('opportunity + alignment − risk 정렬 + Evidence 없는 후보 제외 + 미측정 분리 공개', () => {
    const r = rankInnovationPriority([
      { title: 'B 혁신', opportunityScore: 70, alignmentScore: 50, riskScore: 30, evidenceCount: 2 },
      { title: 'A 혁신', opportunityScore: 85, alignmentScore: 70, riskScore: 20, evidenceCount: 1 },
      { title: 'C 혁신(무증거)', opportunityScore: 95, alignmentScore: 90, riskScore: 5, evidenceCount: 0 },
      { title: 'D 혁신(미측정)', opportunityScore: null, alignmentScore: 50, riskScore: 10, evidenceCount: 3 },
    ]);
    expect(r.ranked.map((x) => x.title)).toEqual(['A 혁신', 'B 혁신']);
    expect(r.ranked[0].priorityScore).toBe(135);
    expect(r.excludedWithoutEvidence).toEqual(['C 혁신(무증거)']);
    expect(r.unverifiedCandidates).toEqual(['D 혁신(미측정)']);
    expect(r.priorityIsNotMandatoryOrder).toBe(true);
  });

  it('동점은 제목순 결정적 정렬, null 입력 안전', () => {
    const r = rankInnovationPriority([
      { title: 'b', opportunityScore: 50, alignmentScore: 50, riskScore: 10, evidenceCount: 1 },
      { title: 'a', opportunityScore: 50, alignmentScore: 50, riskScore: 10, evidenceCount: 1 },
    ]);
    expect(r.ranked.map((x) => x.title)).toEqual(['a', 'b']);
    expect(rankInnovationPriority(null).ranked).toEqual([]);
  });
});

describe('Executive Innovation Scorecard(§8)', () => {
  it('심각도 가중(×10/×5/×3/×1) + attention 정렬', () => {
    const r = buildExecutiveInnovationScorecard({ criticalRisks: 2, imbalancedPortfolios: 3, weakOpportunities: 1, pendingHumanReviews: 4 });
    expect(r.severityScore).toBe(2 * 10 + 3 * 5 + 1 * 3 + 4);
    expect(r.attention[0].area).toBe('critical_risks');
    expect(r.fields).toHaveLength(8);
    expect(r.humanReviewRequired).toBe(true);
  });

  it('null-safe — 입력 없으면 0 심각도(관측 없음 명시)', () => {
    const r = buildExecutiveInnovationScorecard(null);
    expect(r.severityScore).toBe(0);
    expect(r.attention).toEqual([]);
  });
});

describe('Review Workflow(§9)', () => {
  it('허용 3종 외 차단 / Self-Review 차단 / Evidence 필수', () => {
    expect(validateInnovationReview({ reviewType: 'auto_approval', createdBy: 'u1', reviewerId: 'u2', evidenceCount: 1 }).reason).toBe('invalid_review_type');
    expect(validateInnovationReview({ reviewType: 'innovation_review', createdBy: 'u1', reviewerId: 'u1', evidenceCount: 1 }).reason).toBe('self_review_blocked');
    expect(validateInnovationReview({ reviewType: 'executive_review', createdBy: 'u1', reviewerId: 'u2', evidenceCount: 0 }).reason).toBe('evidence_required');
    expect(validateInnovationReview({ reviewType: 'human_review', createdBy: 'u1', reviewerId: null, evidenceCount: 1 }).reason).toBe('reviewer_required');
    const ok = validateInnovationReview({ reviewType: 'innovation_review', createdBy: 'u1', reviewerId: 'u2', evidenceCount: 2 });
    expect(ok.valid).toBe(true);
    expect(ok.reviewIsNotApproval).toBe(true);
  });
});

describe('Innovation Timeline', () => {
  it('13단계 순서 고정 + 미지 단계 정직 공개', () => {
    const r = buildInnovationTimeline([
      { stage: 'innovation_portfolio', label: 'Q1 포트폴리오' },
      { stage: 'vision' },
      { stage: 'unknown_stage' },
    ]);
    expect(r.stages).toHaveLength(13);
    expect(r.stages[0].stage).toBe('vision');
    expect(r.stages.find((s) => s.stage === 'innovation_portfolio')?.entries).toEqual(['Q1 포트폴리오']);
    expect(r.unknownStages).toEqual(['unknown_stage']);
  });
});

describe('Honest Boundary(Support Matrix)', () => {
  it('48항목 — unavailable 11종은 전부 automatic_*(스펙 금지 목록 1:1)', () => {
    expect(ENTERPRISE_INNOVATION_SUPPORT_MATRIX).toHaveLength(48);
    const unavailable = ENTERPRISE_INNOVATION_SUPPORT_MATRIX.filter((e) => e.level === 'unavailable');
    expect(unavailable).toHaveLength(11);
    expect(unavailable.every((e) => e.feature.startsWith('automatic_'))).toBe(true);
  });

  it('부재 피드 6종은 insufficient_data 로 정직 고지', () => {
    const missing = ENTERPRISE_INNOVATION_SUPPORT_MATRIX.filter((e) => e.level === 'insufficient_data').map((e) => e.feature);
    expect(missing).toEqual(['market_research_feed', 'patent_database_feed', 'startup_ecosystem_feed', 'technology_radar_feed', 'customer_insight_feed', 'rnd_lab_system']);
  });

  it('사업 시작/제품 출시/투자/전략 변경 결정은 human_review_only', () => {
    const human = ENTERPRISE_INNOVATION_SUPPORT_MATRIX.filter((e) => e.level === 'human_review_only').map((e) => e.feature);
    expect(human).toEqual(['business_launch_decision', 'product_launch_decision', 'investment_decision', 'strategy_change_decision']);
  });
});
