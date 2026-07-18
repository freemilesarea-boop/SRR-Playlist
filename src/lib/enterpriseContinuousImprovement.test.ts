// AI-OPS-57 — Enterprise Continuous Improvement 순수 로직 테스트.
// 스펙 §12 최소: Improvement Assessment / Root Cause Review / Operational
// Excellence / Improvement Priority / Review Workflow / Honest Boundary.
import { describe, expect, it } from 'vitest';
import {
  IMPROVEMENT_CATEGORIES,
  IMPROVEMENT_STATUSES,
  IMPROVEMENT_DIMENSIONS,
  IMPROVEMENT_ASSESSMENT_RESULTS,
  ROOT_CAUSE_DIMENSIONS,
  ROOT_CAUSE_RESULTS,
  EXCELLENCE_DIMENSIONS,
  EXCELLENCE_RESULTS,
  IMPROVEMENT_TREND_RESULTS,
  PROCESS_EFFICIENCY_RESULTS,
  BEST_PRACTICE_RESULTS,
  RECURRENCE_RESULTS,
  IMPROVEMENT_PRIORITY_RESULTS,
  IMPROVEMENT_REVIEW_TYPES,
  IMPROVEMENT_REVIEW_STATUSES,
  IMPROVEMENT_RECOMMENDATION_TYPES,
  IMPROVEMENT_SCORECARD_FIELDS,
  IMPROVEMENT_FLOW_STAGES,
  evaluateImprovementAssessment,
  reviewRootCause,
  evaluateOperationalExcellence,
  analyzeTrend,
  rankImprovementPriority,
  buildExecutiveImprovementScorecard,
  validateImprovementReview,
  buildImprovementTimeline,
  ENTERPRISE_CONTINUOUS_IMPROVEMENT_SUPPORT_MATRIX,
} from './enterpriseContinuousImprovement';

describe('상수(0561 SQL CHECK 와 1:1)', () => {
  it('Category 11종 / Status 5종 / Review 3종·5상태 / Scorecard 8필드 / Flow 13단계', () => {
    expect(IMPROVEMENT_CATEGORIES).toHaveLength(11);
    expect(IMPROVEMENT_STATUSES).toHaveLength(5);
    expect(IMPROVEMENT_REVIEW_TYPES).toHaveLength(3);
    expect(IMPROVEMENT_REVIEW_STATUSES).toHaveLength(5);
    expect(IMPROVEMENT_SCORECARD_FIELDS).toHaveLength(8);
    expect(IMPROVEMENT_FLOW_STAGES).toHaveLength(13);
  });

  it('Assessment/Root Cause/Excellence 차원 5종 + 결과 5종, 파생 결과 whitelist, 권고 23종', () => {
    expect(IMPROVEMENT_DIMENSIONS).toHaveLength(5);
    expect(IMPROVEMENT_ASSESSMENT_RESULTS).toHaveLength(5);
    expect(ROOT_CAUSE_DIMENSIONS).toHaveLength(5);
    expect(ROOT_CAUSE_RESULTS).toHaveLength(5);
    expect(EXCELLENCE_DIMENSIONS).toHaveLength(5);
    expect(EXCELLENCE_RESULTS).toHaveLength(5);
    expect(IMPROVEMENT_TREND_RESULTS).toHaveLength(5);
    expect(PROCESS_EFFICIENCY_RESULTS).toHaveLength(5);
    expect(BEST_PRACTICE_RESULTS).toHaveLength(5);
    expect(RECURRENCE_RESULTS).toHaveLength(5);
    expect(IMPROVEMENT_PRIORITY_RESULTS).toHaveLength(5);
    expect(IMPROVEMENT_RECOMMENDATION_TYPES).toHaveLength(23);
  });
});

describe('Improvement Assessment(§5)', () => {
  it('평균 기반 경계값 80/60/35 판정 + strongest/weakest 공개', () => {
    const at = (s: number) =>
      evaluateImprovementAssessment([
        { dimension: 'business_impact', score: s },
        { dimension: 'operational_impact', score: s },
        { dimension: 'cost_reduction', score: s },
      ]).result;
    expect(at(80)).toBe('exceptional_candidate');
    expect(at(60)).toBe('strong_candidate');
    expect(at(35)).toBe('acceptable_candidate');
    expect(at(34)).toBe('weak_candidate');
    const r = evaluateImprovementAssessment([
      { dimension: 'business_impact', score: 90 },
      { dimension: 'quality_improvement', score: 40 },
      { dimension: 'sustainability', score: 70 },
    ]);
    expect(r.strongestDimension).toBe('business_impact');
    expect(r.weakestDimension).toBe('quality_improvement');
    expect(r.missingDimensions).toEqual(['operational_impact', 'cost_reduction']);
    expect(r.improvementIsNotGuaranteedSuccess).toBe(true);
  });

  it('유효 차원 3개 미만 → insufficient_data(Null → 0 금지)', () => {
    expect(evaluateImprovementAssessment([
      { dimension: 'business_impact', score: 90 },
      { dimension: 'operational_impact', score: null },
    ]).result).toBe('insufficient_data');
    expect(evaluateImprovementAssessment(null).averageScore).toBeNull();
  });
});

describe('Root Cause Review(§6)', () => {
  it('근거 평균 경계값 75/50/25 판정 + weakest 공개', () => {
    const at = (s: number) =>
      reviewRootCause([
        { dimension: 'evidence', score: s },
        { dimension: 'frequency', score: s },
        { dimension: 'severity', score: s },
      ]).result;
    expect(at(75)).toBe('highly_supported_candidate');
    expect(at(50)).toBe('moderately_supported_candidate');
    expect(at(25)).toBe('weakly_supported_candidate');
    expect(at(24)).toBe('speculative_candidate');
  });

  it('evidence 차원 미평가 시 highly_supported 승격 차단(과단정 방지)', () => {
    const r = reviewRootCause([
      { dimension: 'frequency', score: 90 },
      { dimension: 'severity', score: 90 },
      { dimension: 'scope', score: 90 },
    ]);
    expect(r.averageSupport).toBe(90);
    expect(r.result).toBe('moderately_supported_candidate');
    expect(r.missingDimensions).toContain('evidence');
    expect(r.patternIsNotRootCause).toBe(true);
  });

  it('유효 차원 3개 미만 → insufficient_data', () => {
    expect(reviewRootCause([{ dimension: 'evidence', score: 90 }]).result).toBe('insufficient_data');
    expect(reviewRootCause(null).result).toBe('insufficient_data');
  });
});

describe('Operational Excellence(§7)', () => {
  it('평균 기반 경계값 80/60/40 판정 + weakest 공개', () => {
    const at = (s: number) =>
      evaluateOperationalExcellence([
        { dimension: 'process_stability', score: s },
        { dimension: 'quality_consistency', score: s },
        { dimension: 'resource_efficiency', score: s },
      ]).result;
    expect(at(80)).toBe('excellence_candidate');
    expect(at(60)).toBe('mature_candidate');
    expect(at(40)).toBe('developing_candidate');
    expect(at(39)).toBe('immature_candidate');
    const r = evaluateOperationalExcellence([
      { dimension: 'process_stability', score: 90 },
      { dimension: 'continuous_learning', score: 30 },
      { dimension: 'improvement_adoption', score: 80 },
    ]);
    expect(r.weakestDimension).toBe('continuous_learning');
    expect(r.excellenceIsNotOrganizationRating).toBe(true);
  });

  it('유효 차원 3개 미만 → insufficient_data', () => {
    expect(evaluateOperationalExcellence([
      { dimension: 'process_stability', score: 90 },
      { dimension: 'unknown_dimension', score: 50 },
    ]).result).toBe('insufficient_data');
    expect(evaluateOperationalExcellence(null).averageScore).toBeNull();
  });
});

describe('Trend Analysis(Trend ≠ Prediction)', () => {
  it('전/후반 평균 비교 — ±5 경계 판정', () => {
    expect(analyzeTrend([10, 20, 30, 40]).result).toBe('improving_trend_candidate');
    expect(analyzeTrend([40, 30, 20, 10]).result).toBe('deteriorating_trend_candidate');
    expect(analyzeTrend([50, 50, 52, 51]).result).toBe('stable_trend_candidate');
  });

  it('유효 표본 4개 미만 → sample_too_small(Null 은 표본 제외)', () => {
    const r = analyzeTrend([10, null, 20]);
    expect(r.result).toBe('insufficient_data');
    expect(r.reason).toBe('sample_too_small');
    expect(r.sampleCount).toBe(2);
    expect(r.trendIsNotPrediction).toBe(true);
    expect(analyzeTrend(null).result).toBe('insufficient_data');
  });
});

describe('Improvement Priority', () => {
  it('impact + recurrence − effort 정렬 + Evidence 없는 후보 제외 + 미측정 분리 공개', () => {
    const r = rankImprovementPriority([
      { title: 'B 개선', expectedImpact: 70, effort: 30, recurrence: 40, evidenceCount: 2 },
      { title: 'A 개선', expectedImpact: 80, effort: 20, recurrence: 60, evidenceCount: 1 },
      { title: 'C 개선(무증거)', expectedImpact: 95, effort: 5, recurrence: 90, evidenceCount: 0 },
      { title: 'D 개선(미측정)', expectedImpact: null, effort: 10, recurrence: 50, evidenceCount: 3 },
    ]);
    expect(r.ranked.map((x) => x.title)).toEqual(['A 개선', 'B 개선']);
    expect(r.ranked[0].priorityScore).toBe(120);
    expect(r.excludedWithoutEvidence).toEqual(['C 개선(무증거)']);
    expect(r.unverifiedCandidates).toEqual(['D 개선(미측정)']);
    expect(r.priorityIsNotMandatoryOrder).toBe(true);
  });

  it('동점은 제목순 결정적 정렬, null 입력 안전', () => {
    const r = rankImprovementPriority([
      { title: 'b', expectedImpact: 50, effort: 10, recurrence: 20, evidenceCount: 1 },
      { title: 'a', expectedImpact: 50, effort: 10, recurrence: 20, evidenceCount: 1 },
    ]);
    expect(r.ranked.map((x) => x.title)).toEqual(['a', 'b']);
    expect(rankImprovementPriority(null).ranked).toEqual([]);
  });
});

describe('Executive Improvement Scorecard(§8)', () => {
  it('심각도 가중(×10/×5/×3/×1) + attention 정렬', () => {
    const r = buildExecutiveImprovementScorecard({ speculativeRootCauses: 2, weakImprovements: 3, immatureExcellenceAreas: 1, pendingHumanReviews: 4 });
    expect(r.severityScore).toBe(2 * 10 + 3 * 5 + 1 * 3 + 4);
    expect(r.attention[0].area).toBe('speculative_root_causes');
    expect(r.fields).toHaveLength(8);
    expect(r.humanReviewRequired).toBe(true);
  });

  it('null-safe — 입력 없으면 0 심각도(관측 없음 명시)', () => {
    const r = buildExecutiveImprovementScorecard(null);
    expect(r.severityScore).toBe(0);
    expect(r.attention).toEqual([]);
  });
});

describe('Review Workflow(§9)', () => {
  it('허용 3종 외 차단 / Self-Review 차단 / Evidence 필수', () => {
    expect(validateImprovementReview({ reviewType: 'auto_approval', createdBy: 'u1', reviewerId: 'u2', evidenceCount: 1 }).reason).toBe('invalid_review_type');
    expect(validateImprovementReview({ reviewType: 'improvement_review', createdBy: 'u1', reviewerId: 'u1', evidenceCount: 1 }).reason).toBe('self_review_blocked');
    expect(validateImprovementReview({ reviewType: 'executive_review', createdBy: 'u1', reviewerId: 'u2', evidenceCount: 0 }).reason).toBe('evidence_required');
    expect(validateImprovementReview({ reviewType: 'human_review', createdBy: 'u1', reviewerId: null, evidenceCount: 1 }).reason).toBe('reviewer_required');
    const ok = validateImprovementReview({ reviewType: 'improvement_review', createdBy: 'u1', reviewerId: 'u2', evidenceCount: 2 });
    expect(ok.valid).toBe(true);
    expect(ok.reviewIsNotApproval).toBe(true);
  });
});

describe('Improvement Timeline', () => {
  it('13단계 순서 고정 + 미지 단계 정직 공개', () => {
    const r = buildImprovementTimeline([
      { stage: 'root_cause_review', label: 'Q1 근본원인' },
      { stage: 'vision' },
      { stage: 'unknown_stage' },
    ]);
    expect(r.stages).toHaveLength(13);
    expect(r.stages[0].stage).toBe('vision');
    expect(r.stages.find((s) => s.stage === 'root_cause_review')?.entries).toEqual(['Q1 근본원인']);
    expect(r.unknownStages).toEqual(['unknown_stage']);
  });
});

describe('Honest Boundary(Support Matrix)', () => {
  it('47항목 — unavailable 10종은 전부 automatic_*(스펙 금지 목록 1:1)', () => {
    expect(ENTERPRISE_CONTINUOUS_IMPROVEMENT_SUPPORT_MATRIX).toHaveLength(47);
    const unavailable = ENTERPRISE_CONTINUOUS_IMPROVEMENT_SUPPORT_MATRIX.filter((e) => e.level === 'unavailable');
    expect(unavailable).toHaveLength(10);
    expect(unavailable.every((e) => e.feature.startsWith('automatic_'))).toBe(true);
  });

  it('부재 피드 6종은 insufficient_data 로 정직 고지', () => {
    const missing = ENTERPRISE_CONTINUOUS_IMPROVEMENT_SUPPORT_MATRIX.filter((e) => e.level === 'insufficient_data').map((e) => e.feature);
    expect(missing).toEqual(['process_mining_tool', 'incident_management_feed', 'quality_management_system', 'workflow_analytics_feed', 'ticketing_system_feed', 'ops_metrics_warehouse']);
  });

  it('개선 적용/Process 변경/Best Practice 확산/KPI 변경은 human_review_only', () => {
    const human = ENTERPRISE_CONTINUOUS_IMPROVEMENT_SUPPORT_MATRIX.filter((e) => e.level === 'human_review_only').map((e) => e.feature);
    expect(human).toEqual(['improvement_apply_decision', 'process_change_decision', 'best_practice_spread_decision', 'kpi_change_decision']);
  });
});
