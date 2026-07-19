// AI-OPS-60 — Enterprise Resilience 순수 로직 테스트.
// 스펙 §12 최소: Resilience Assessment / Recovery Readiness / Adaptive
// Response / Business Continuity / Review Workflow / Honest Boundary.
import { describe, expect, it } from 'vitest';
import {
  RESILIENCE_CATEGORIES,
  RESILIENCE_STATUSES,
  RESILIENCE_DIMENSIONS,
  RESILIENCE_ASSESSMENT_RESULTS,
  RECOVERY_DIMENSIONS,
  RECOVERY_READINESS_RESULTS,
  ADAPTIVE_DIMENSIONS,
  ADAPTIVE_RESPONSE_RESULTS,
  BUSINESS_CONTINUITY_RESULTS,
  OPERATIONAL_STABILITY_RESULTS,
  RISK_SIGNAL_RESULTS,
  SPOF_RESULTS,
  PRIORITY_RISK_RESULTS,
  RESILIENCE_REVIEW_TYPES,
  RESILIENCE_REVIEW_STATUSES,
  RESILIENCE_RECOMMENDATION_TYPES,
  RESILIENCE_SCORECARD_FIELDS,
  RESILIENCE_FLOW_STAGES,
  assessResilience,
  assessRecoveryReadiness,
  assessAdaptiveResponse,
  assessBusinessContinuity,
  detectSinglePointsOfFailure,
  buildExecutiveResilienceScorecard,
  validateResilienceReview,
  buildResilienceTimeline,
  ENTERPRISE_RESILIENCE_SUPPORT_MATRIX,
} from './enterpriseResilience';

describe('상수(0564 SQL CHECK 와 1:1)', () => {
  it('Category 11종 / Status 5종 / Review 3종·5상태 / Scorecard 8필드 / Flow 13단계', () => {
    expect(RESILIENCE_CATEGORIES).toHaveLength(11);
    expect(RESILIENCE_STATUSES).toHaveLength(5);
    expect(RESILIENCE_REVIEW_TYPES).toHaveLength(3);
    expect(RESILIENCE_REVIEW_STATUSES).toHaveLength(5);
    expect(RESILIENCE_SCORECARD_FIELDS).toHaveLength(8);
    expect(RESILIENCE_FLOW_STAGES).toHaveLength(13);
  });

  it('Assessment/Recovery/Adaptive 차원 5종 + 결과 5종, 파생 결과 whitelist, 권고 23종', () => {
    expect(RESILIENCE_DIMENSIONS).toHaveLength(5);
    expect(RESILIENCE_ASSESSMENT_RESULTS).toHaveLength(5);
    expect(RECOVERY_DIMENSIONS).toHaveLength(5);
    expect(RECOVERY_READINESS_RESULTS).toHaveLength(5);
    expect(ADAPTIVE_DIMENSIONS).toHaveLength(5);
    expect(ADAPTIVE_RESPONSE_RESULTS).toHaveLength(5);
    expect(BUSINESS_CONTINUITY_RESULTS).toHaveLength(5);
    expect(OPERATIONAL_STABILITY_RESULTS).toHaveLength(5);
    expect(RISK_SIGNAL_RESULTS).toHaveLength(5);
    expect(SPOF_RESULTS).toHaveLength(5);
    expect(PRIORITY_RISK_RESULTS).toHaveLength(5);
    expect(RESILIENCE_RECOMMENDATION_TYPES).toHaveLength(23);
  });
});

describe('Resilience Assessment(§5)', () => {
  it('평균 기반 경계값 80/60/40 판정 + weakest 공개', () => {
    const at = (s: number) =>
      assessResilience([
        { dimension: 'operational_stability', score: s },
        { dimension: 'recovery_capability', score: s },
        { dimension: 'adaptive_capacity', score: s },
      ]).result;
    expect(at(80)).toBe('highly_resilient');
    expect(at(60)).toBe('resilient');
    expect(at(40)).toBe('partially_resilient');
    expect(at(39)).toBe('vulnerable');
    const r = assessResilience([
      { dimension: 'operational_stability', score: 90 },
      { dimension: 'resource_redundancy', score: 30 },
      { dimension: 'business_continuity', score: 70 },
    ]);
    expect(r.weakestDimension).toBe('resource_redundancy');
    expect(r.missingDimensions).toEqual(['recovery_capability', 'adaptive_capacity']);
    expect(r.resilienceIsNotGuaranteedSurvival).toBe(true);
  });

  it('유효 차원 3개 미만 → insufficient_data(Null → 0 금지)', () => {
    expect(assessResilience([
      { dimension: 'operational_stability', score: 90 },
      { dimension: 'recovery_capability', score: null },
    ]).result).toBe('insufficient_data');
    expect(assessResilience(null).averageScore).toBeNull();
  });
});

describe('Recovery Readiness(§6)', () => {
  it('평균 기반 경계값 80/60/40 판정', () => {
    const at = (s: number) =>
      assessRecoveryReadiness([
        { dimension: 'recovery_time', score: s },
        { dimension: 'recovery_resources', score: s },
        { dimension: 'recovery_confidence', score: s },
      ]).result;
    expect(at(80)).toBe('fully_ready');
    expect(at(60)).toBe('mostly_ready');
    expect(at(40)).toBe('partially_ready');
    expect(at(39)).toBe('not_ready');
  });

  it('recovery_confidence 차원 미평가 시 fully_ready 승격 차단(과단정 방지)', () => {
    const r = assessRecoveryReadiness([
      { dimension: 'recovery_time', score: 90 },
      { dimension: 'recovery_resources', score: 90 },
      { dimension: 'recovery_procedures', score: 90 },
    ]);
    expect(r.averageScore).toBe(90);
    expect(r.result).toBe('mostly_ready');
    expect(r.missingDimensions).toContain('recovery_confidence');
    expect(r.recoveryScoreIsNotRecoverySuccess).toBe(true);
  });

  it('유효 차원 3개 미만 → insufficient_data', () => {
    expect(assessRecoveryReadiness([{ dimension: 'recovery_time', score: 90 }]).result).toBe('insufficient_data');
    expect(assessRecoveryReadiness(null).result).toBe('insufficient_data');
  });
});

describe('Adaptive Response(§7)', () => {
  it('평균 기반 경계값 80/60/40 판정 + weakest 공개', () => {
    const at = (s: number) =>
      assessAdaptiveResponse([
        { dimension: 'response_speed', score: s },
        { dimension: 'decision_agility', score: s },
        { dimension: 'learning_capability', score: s },
      ]).result;
    expect(at(80)).toBe('highly_adaptive');
    expect(at(60)).toBe('adaptive');
    expect(at(40)).toBe('partially_adaptive');
    expect(at(39)).toBe('rigid');
    const r = assessAdaptiveResponse([
      { dimension: 'response_speed', score: 90 },
      { dimension: 'organizational_flexibility', score: 30 },
      { dimension: 'resource_adaptability', score: 80 },
    ]);
    expect(r.weakestDimension).toBe('organizational_flexibility');
    expect(r.preparednessIsNotReadiness).toBe(true);
  });

  it('유효 차원 3개 미만 → insufficient_data', () => {
    expect(assessAdaptiveResponse([
      { dimension: 'response_speed', score: 90 },
      { dimension: 'unknown_dimension', score: 50 },
    ]).result).toBe('insufficient_data');
    expect(assessAdaptiveResponse(null).averageScore).toBeNull();
  });
});

describe('Business Continuity', () => {
  it('커버리지 경계값 90/60 판정 + gap/unverified 정직 공개', () => {
    const r = assessBusinessContinuity([
      { area: '결제', covered: true },
      { area: '스트리밍', covered: true },
      { area: '정산', covered: false },
      { area: '알림', covered: null },
    ]);
    expect(r.coverageRatio).toBe(67);
    expect(r.result).toBe('continuity_gap_candidate');
    expect(r.gaps).toEqual(['정산']);
    expect(r.unverifiedAreas).toEqual(['알림']);
    expect(r.planIsNotSuccessfulRecovery).toBe(true);
    expect(assessBusinessContinuity([
      { area: 'a', covered: true },
      { area: 'b', covered: true },
      { area: 'c', covered: true },
    ]).result).toBe('continuity_assured_candidate');
    expect(assessBusinessContinuity([
      { area: 'a', covered: false },
      { area: 'b', covered: false },
      { area: 'c', covered: true },
    ]).result).toBe('continuity_critical_gap_candidate');
  });

  it('검증 영역 3개 미만 → insufficient_data(Null 은 false 로 치환하지 않음)', () => {
    const r = assessBusinessContinuity([
      { area: 'a', covered: true },
      { area: 'b', covered: null },
      { area: 'c', covered: null },
    ]);
    expect(r.result).toBe('insufficient_data');
    expect(r.unverifiedAreas).toEqual(['b', 'c']);
    expect(assessBusinessContinuity(null).result).toBe('insufficient_data');
  });
});

describe('SPOF Detection', () => {
  it('여분 0 + 중요도 ≥70 → SPOF 후보, Evidence 없는 구성요소 제외, 미측정 분리 공개', () => {
    const r = detectSinglePointsOfFailure([
      { name: 'DB 클러스터', redundancyCount: 2, criticality: 90, evidenceCount: 1 },
      { name: '결제 게이트웨이', redundancyCount: 0, criticality: 95, evidenceCount: 2 },
      { name: '로그 수집기', redundancyCount: 0, criticality: 30, evidenceCount: 1 },
      { name: '캐시(무증거)', redundancyCount: 0, criticality: 90, evidenceCount: 0 },
      { name: 'CDN(미측정)', redundancyCount: null, criticality: 80, evidenceCount: 1 },
    ]);
    expect(r.spofCandidates).toEqual(['결제 게이트웨이']);
    expect(r.suspectedCandidates).toEqual(['로그 수집기']);
    expect(r.redundantComponents).toEqual(['DB 클러스터']);
    expect(r.excludedWithoutEvidence).toEqual(['캐시(무증거)']);
    expect(r.unverifiedComponents).toEqual(['CDN(미측정)']);
    expect(r.spofIsNotFailurePrediction).toBe(true);
    expect(detectSinglePointsOfFailure(null).spofCandidates).toEqual([]);
  });
});

describe('Executive Resilience Scorecard(§8)', () => {
  it('심각도 가중(×10/×5/×3/×1) + attention 정렬', () => {
    const r = buildExecutiveResilienceScorecard({ vulnerableAreas: 2, notReadyRecoveries: 3, rigidResponses: 1, pendingHumanReviews: 4 });
    expect(r.severityScore).toBe(2 * 10 + 3 * 5 + 1 * 3 + 4);
    expect(r.attention[0].area).toBe('vulnerable_areas');
    expect(r.fields).toHaveLength(8);
    expect(r.humanReviewRequired).toBe(true);
  });

  it('null-safe — 입력 없으면 0 심각도(관측 없음 명시)', () => {
    const r = buildExecutiveResilienceScorecard(null);
    expect(r.severityScore).toBe(0);
    expect(r.attention).toEqual([]);
  });
});

describe('Review Workflow(§9)', () => {
  it('허용 3종 외 차단 / Self-Review 차단 / Evidence 필수', () => {
    expect(validateResilienceReview({ reviewType: 'auto_approval', createdBy: 'u1', reviewerId: 'u2', evidenceCount: 1 }).reason).toBe('invalid_review_type');
    expect(validateResilienceReview({ reviewType: 'resilience_review', createdBy: 'u1', reviewerId: 'u1', evidenceCount: 1 }).reason).toBe('self_review_blocked');
    expect(validateResilienceReview({ reviewType: 'executive_review', createdBy: 'u1', reviewerId: 'u2', evidenceCount: 0 }).reason).toBe('evidence_required');
    expect(validateResilienceReview({ reviewType: 'human_review', createdBy: 'u1', reviewerId: null, evidenceCount: 1 }).reason).toBe('reviewer_required');
    const ok = validateResilienceReview({ reviewType: 'resilience_review', createdBy: 'u1', reviewerId: 'u2', evidenceCount: 2 });
    expect(ok.valid).toBe(true);
    expect(ok.reviewIsNotApproval).toBe(true);
  });
});

describe('Resilience Timeline', () => {
  it('13단계 순서 고정 + 미지 단계 정직 공개', () => {
    const r = buildResilienceTimeline([
      { stage: 'recovery_readiness', label: 'Q1 복구준비' },
      { stage: 'vision' },
      { stage: 'unknown_stage' },
    ]);
    expect(r.stages).toHaveLength(13);
    expect(r.stages[0].stage).toBe('vision');
    expect(r.stages.find((s) => s.stage === 'recovery_readiness')?.entries).toEqual(['Q1 복구준비']);
    expect(r.unknownStages).toEqual(['unknown_stage']);
  });
});

describe('Honest Boundary(Support Matrix)', () => {
  it('46항목 — unavailable 9종은 전부 automatic_*(스펙 금지 목록 1:1)', () => {
    expect(ENTERPRISE_RESILIENCE_SUPPORT_MATRIX).toHaveLength(46);
    const unavailable = ENTERPRISE_RESILIENCE_SUPPORT_MATRIX.filter((e) => e.level === 'unavailable');
    expect(unavailable).toHaveLength(9);
    expect(unavailable.every((e) => e.feature.startsWith('automatic_'))).toBe(true);
  });

  it('부재 피드 6종은 insufficient_data 로 정직 고지', () => {
    const missing = ENTERPRISE_RESILIENCE_SUPPORT_MATRIX.filter((e) => e.level === 'insufficient_data').map((e) => e.feature);
    expect(missing).toEqual(['incident_management_feed', 'monitoring_alert_feed', 'disaster_recovery_system', 'backup_verification_feed', 'supply_chain_feed', 'bcp_drill_records']);
  });

  it('복구 실행/장애 조치/전략/Budget 변경 결정은 human_review_only', () => {
    const human = ENTERPRISE_RESILIENCE_SUPPORT_MATRIX.filter((e) => e.level === 'human_review_only').map((e) => e.feature);
    expect(human).toEqual(['recovery_execution_decision', 'failover_decision', 'strategy_change_decision', 'budget_change_decision']);
  });
});
