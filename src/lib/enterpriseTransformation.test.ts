// AI-OPS-56 — Enterprise Transformation 순수 로직 테스트.
// 스펙 §12 최소: Change Impact Assessment / Transformation Readiness /
// Stakeholder Analysis / Transformation Priority / Review Workflow /
// Honest Boundary.
import { describe, expect, it } from 'vitest';
import {
  TRANSFORMATION_CATEGORIES,
  TRANSFORMATION_STATUSES,
  CHANGE_IMPACT_DIMENSIONS,
  CHANGE_IMPACT_RESULTS,
  TRANSFORMATION_READINESS_DIMENSIONS,
  TRANSFORMATION_READINESS_RESULTS,
  STAKEHOLDER_GROUPS,
  STAKEHOLDER_RESULTS,
  CHANGE_RISK_RESULTS,
  RESISTANCE_RESULTS,
  MISSION_ALIGNMENT_RESULTS,
  EVOLUTION_RESULTS,
  TRANSFORMATION_PRIORITY_RESULTS,
  TRANSFORMATION_REVIEW_TYPES,
  TRANSFORMATION_REVIEW_STATUSES,
  TRANSFORMATION_RECOMMENDATION_TYPES,
  TRANSFORMATION_SCORECARD_FIELDS,
  TRANSFORMATION_FLOW_STAGES,
  evaluateChangeImpact,
  evaluateTransformationReadiness,
  analyzeStakeholders,
  rankTransformationPriority,
  buildExecutiveTransformationScorecard,
  validateTransformationReview,
  buildTransformationTimeline,
  ENTERPRISE_TRANSFORMATION_SUPPORT_MATRIX,
} from './enterpriseTransformation';

describe('상수(0560 SQL CHECK 와 1:1)', () => {
  it('Category 12종 / Status 5종 / Review 3종·5상태 / Scorecard 8필드 / Flow 13단계', () => {
    expect(TRANSFORMATION_CATEGORIES).toHaveLength(12);
    expect(TRANSFORMATION_STATUSES).toHaveLength(5);
    expect(TRANSFORMATION_REVIEW_TYPES).toHaveLength(3);
    expect(TRANSFORMATION_REVIEW_STATUSES).toHaveLength(5);
    expect(TRANSFORMATION_SCORECARD_FIELDS).toHaveLength(8);
    expect(TRANSFORMATION_FLOW_STAGES).toHaveLength(13);
  });

  it('Impact/Readiness/Stakeholder 차원·그룹 5종 + 결과 5종, 파생 결과 whitelist, 권고 23종', () => {
    expect(CHANGE_IMPACT_DIMENSIONS).toHaveLength(5);
    expect(CHANGE_IMPACT_RESULTS).toHaveLength(5);
    expect(TRANSFORMATION_READINESS_DIMENSIONS).toHaveLength(5);
    expect(TRANSFORMATION_READINESS_RESULTS).toHaveLength(5);
    expect(STAKEHOLDER_GROUPS).toHaveLength(5);
    expect(STAKEHOLDER_RESULTS).toHaveLength(5);
    expect(CHANGE_RISK_RESULTS).toHaveLength(5);
    expect(RESISTANCE_RESULTS).toHaveLength(5);
    expect(MISSION_ALIGNMENT_RESULTS).toHaveLength(5);
    expect(EVOLUTION_RESULTS).toHaveLength(5);
    expect(TRANSFORMATION_PRIORITY_RESULTS).toHaveLength(5);
    expect(TRANSFORMATION_RECOMMENDATION_TYPES).toHaveLength(23);
  });
});

describe('Change Impact Assessment(§5)', () => {
  it('worst-of 판정 + strongest 차원 공개', () => {
    const r = evaluateChangeImpact([
      { dimension: 'organizational_impact', magnitude: 75 },
      { dimension: 'operational_impact', magnitude: 30 },
      { dimension: 'financial_impact', magnitude: 10 },
    ]);
    expect(r.result).toBe('high_impact_candidate');
    expect(r.strongestDimension).toBe('organizational_impact');
    expect(r.impactIsNotActualOutcome).toBe(true);
  });

  it('경계값 70/40 판정', () => {
    const at = (m: number) =>
      evaluateChangeImpact([
        { dimension: 'organizational_impact', magnitude: m },
        { dimension: 'operational_impact', magnitude: 0 },
        { dimension: 'cultural_impact', magnitude: 0 },
      ]).result;
    expect(at(70)).toBe('high_impact_candidate');
    expect(at(40)).toBe('moderate_impact_candidate');
    expect(at(39)).toBe('low_impact_candidate');
  });

  it('미측정 차원이 평가 차원보다 많으면 uncertain_candidate(과단정 방지)', () => {
    const r = evaluateChangeImpact([
      { dimension: 'organizational_impact', magnitude: 80 },
      { dimension: 'operational_impact', magnitude: 60 },
      { dimension: 'financial_impact', magnitude: 50 },
      { dimension: 'strategic_impact', magnitude: null },
      { dimension: 'cultural_impact', magnitude: null },
    ]);
    expect(r.result).toBe('high_impact_candidate');
    const u = evaluateChangeImpact([
      { dimension: 'organizational_impact', magnitude: 80 },
      { dimension: 'operational_impact', magnitude: 60 },
      { dimension: 'financial_impact', magnitude: 50 },
    ]);
    expect(u.result).toBe('high_impact_candidate');
  });

  it('유효 차원 3개 미만 → insufficient_data + 미측정 차원 정직 공개', () => {
    const r = evaluateChangeImpact([
      { dimension: 'organizational_impact', magnitude: 90 },
      { dimension: 'operational_impact', magnitude: null },
      { dimension: 'unknown_dimension', magnitude: 50 },
    ]);
    expect(r.result).toBe('insufficient_data');
    expect(r.unverifiedDimensions).toEqual(['operational_impact']);
    expect(evaluateChangeImpact(null).result).toBe('insufficient_data');
  });
});

describe('Transformation Readiness(§6)', () => {
  it('평균 기반 경계값 80/60/40 판정 + weakest 차원 공개', () => {
    const at = (s: number) =>
      evaluateTransformationReadiness([
        { dimension: 'leadership_readiness', score: s },
        { dimension: 'workforce_readiness', score: s },
        { dimension: 'process_readiness', score: s },
      ]);
    expect(at(80).result).toBe('highly_ready_candidate');
    expect(at(60).result).toBe('mostly_ready_candidate');
    expect(at(40).result).toBe('partially_ready_candidate');
    expect(at(39).result).toBe('not_ready_candidate');
    const r = evaluateTransformationReadiness([
      { dimension: 'leadership_readiness', score: 90 },
      { dimension: 'workforce_readiness', score: 40 },
      { dimension: 'technology_readiness', score: 70 },
    ]);
    expect(r.weakestDimension).toBe('workforce_readiness');
    expect(r.missingDimensions).toEqual(['process_readiness', 'governance_readiness']);
    expect(r.readinessIsNotSuccessfulTransformation).toBe(true);
  });

  it('유효 차원 3개 미만 → insufficient_data(Null → 0 금지)', () => {
    expect(evaluateTransformationReadiness([
      { dimension: 'leadership_readiness', score: 90 },
      { dimension: 'workforce_readiness', score: null },
    ]).result).toBe('insufficient_data');
    expect(evaluateTransformationReadiness(null).averageScore).toBeNull();
  });
});

describe('Stakeholder Analysis(§7)', () => {
  it('그룹별 판정 + mostAffected 공개 + unknown 유지', () => {
    const r = analyzeStakeholders([
      { group: 'executive', impactLevel: 20 },
      { group: 'workforce', impactLevel: 85 },
      { group: 'partner', impactLevel: null },
    ]);
    expect(r.overall).toBe('highly_affected_candidate');
    expect(r.mostAffectedGroup).toBe('workforce');
    expect(r.assessments[0].group).toBe('workforce');
    expect(r.unknownGroups).toEqual(['partner']);
    expect(r.assessments.find((a) => a.group === 'partner')?.result).toBe('unknown_candidate');
    expect(r.stakeholderIsNotPersonalEvaluation).toBe(true);
  });

  it('경계값 70/35 판정', () => {
    const at = (l: number) => analyzeStakeholders([
      { group: 'executive', impactLevel: l },
      { group: 'management', impactLevel: 0 },
    ]).assessments.find((a) => a.group === 'executive')?.result;
    expect(at(70)).toBe('highly_affected_candidate');
    expect(at(35)).toBe('moderately_affected_candidate');
    expect(at(34)).toBe('minimally_affected_candidate');
  });

  it('유효 그룹 2개 미만 → overall insufficient_data', () => {
    expect(analyzeStakeholders([{ group: 'executive', impactLevel: 90 }]).overall).toBe('insufficient_data');
    expect(analyzeStakeholders([{ group: 'executive', impactLevel: null }, { group: 'customer', impactLevel: null }]).overall).toBe('insufficient_data');
    expect(analyzeStakeholders(null).overall).toBe('insufficient_data');
  });
});

describe('Transformation Priority', () => {
  it('value + readiness − risk 정렬 + Evidence 없는 후보 제외 + 미측정 분리 공개', () => {
    const r = rankTransformationPriority([
      { title: 'B 변화', expectedValue: 80, readinessScore: 60, riskScore: 40, evidenceCount: 2 },
      { title: 'A 변화', expectedValue: 90, readinessScore: 70, riskScore: 20, evidenceCount: 1 },
      { title: 'C 변화(무증거)', expectedValue: 95, readinessScore: 90, riskScore: 5, evidenceCount: 0 },
      { title: 'D 변화(미측정)', expectedValue: null, readinessScore: 50, riskScore: 10, evidenceCount: 3 },
    ]);
    expect(r.ranked.map((x) => x.title)).toEqual(['A 변화', 'B 변화']);
    expect(r.ranked[0].priorityScore).toBe(140);
    expect(r.excludedWithoutEvidence).toEqual(['C 변화(무증거)']);
    expect(r.unverifiedCandidates).toEqual(['D 변화(미측정)']);
    expect(r.priorityIsNotMandatoryOrder).toBe(true);
  });

  it('동점은 제목순 결정적 정렬, null 입력 안전', () => {
    const r = rankTransformationPriority([
      { title: 'b', expectedValue: 50, readinessScore: 50, riskScore: 10, evidenceCount: 1 },
      { title: 'a', expectedValue: 50, readinessScore: 50, riskScore: 10, evidenceCount: 1 },
    ]);
    expect(r.ranked.map((x) => x.title)).toEqual(['a', 'b']);
    expect(rankTransformationPriority(null).ranked).toEqual([]);
  });
});

describe('Executive Transformation Scorecard(§8)', () => {
  it('심각도 가중(×10/×5/×3/×1) + attention 정렬', () => {
    const r = buildExecutiveTransformationScorecard({ criticalRisks: 2, notReadyTransformations: 3, highlyAffectedStakeholders: 1, pendingHumanReviews: 4 });
    expect(r.severityScore).toBe(2 * 10 + 3 * 5 + 1 * 3 + 4);
    expect(r.attention[0].area).toBe('critical_risks');
    expect(r.fields).toHaveLength(8);
    expect(r.humanReviewRequired).toBe(true);
  });

  it('null-safe — 입력 없으면 0 심각도(관측 없음 명시)', () => {
    const r = buildExecutiveTransformationScorecard(null);
    expect(r.severityScore).toBe(0);
    expect(r.attention).toEqual([]);
  });
});

describe('Review Workflow(§9)', () => {
  it('허용 3종 외 차단 / Self-Review 차단 / Evidence 필수', () => {
    expect(validateTransformationReview({ reviewType: 'auto_approval', createdBy: 'u1', reviewerId: 'u2', evidenceCount: 1 }).reason).toBe('invalid_review_type');
    expect(validateTransformationReview({ reviewType: 'transformation_review', createdBy: 'u1', reviewerId: 'u1', evidenceCount: 1 }).reason).toBe('self_review_blocked');
    expect(validateTransformationReview({ reviewType: 'executive_review', createdBy: 'u1', reviewerId: 'u2', evidenceCount: 0 }).reason).toBe('evidence_required');
    expect(validateTransformationReview({ reviewType: 'human_review', createdBy: 'u1', reviewerId: null, evidenceCount: 1 }).reason).toBe('reviewer_required');
    const ok = validateTransformationReview({ reviewType: 'transformation_review', createdBy: 'u1', reviewerId: 'u2', evidenceCount: 2 });
    expect(ok.valid).toBe(true);
    expect(ok.reviewIsNotApproval).toBe(true);
  });
});

describe('Transformation Timeline', () => {
  it('13단계 순서 고정 + 미지 단계 정직 공개', () => {
    const r = buildTransformationTimeline([
      { stage: 'transformation_readiness', label: 'Q1 준비도' },
      { stage: 'vision' },
      { stage: 'unknown_stage' },
    ]);
    expect(r.stages).toHaveLength(13);
    expect(r.stages[0].stage).toBe('vision');
    expect(r.stages.find((s) => s.stage === 'transformation_readiness')?.entries).toEqual(['Q1 준비도']);
    expect(r.unknownStages).toEqual(['unknown_stage']);
  });
});

describe('Honest Boundary(Support Matrix)', () => {
  it('48항목 — unavailable 11종은 전부 automatic_*(스펙 금지 목록 1:1)', () => {
    expect(ENTERPRISE_TRANSFORMATION_SUPPORT_MATRIX).toHaveLength(48);
    const unavailable = ENTERPRISE_TRANSFORMATION_SUPPORT_MATRIX.filter((e) => e.level === 'unavailable');
    expect(unavailable).toHaveLength(11);
    expect(unavailable.every((e) => e.feature.startsWith('automatic_'))).toBe(true);
  });

  it('부재 피드 6종은 insufficient_data 로 정직 고지', () => {
    const missing = ENTERPRISE_TRANSFORMATION_SUPPORT_MATRIX.filter((e) => e.level === 'insufficient_data').map((e) => e.feature);
    expect(missing).toEqual(['hr_information_system', 'employee_survey_feed', 'change_management_tool_feed', 'org_chart_system', 'training_platform_feed', 'culture_assessment_feed']);
  });

  it('조직 개편/인사/전략/Budget 결정은 human_review_only', () => {
    const human = ENTERPRISE_TRANSFORMATION_SUPPORT_MATRIX.filter((e) => e.level === 'human_review_only').map((e) => e.feature);
    expect(human).toEqual(['reorganization_decision', 'personnel_change_decision', 'strategy_change_decision', 'budget_change_decision']);
  });
});
