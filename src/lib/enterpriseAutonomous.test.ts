import { describe, it, expect } from 'vitest';
import {
  AI_REVIEW_CATEGORIES, AI_REVIEW_STATUSES,
  RECOMMENDATION_ACCURACY_DIMENSIONS, RECOMMENDATION_ACCURACY_RESULTS,
  CONFIDENCE_CALIBRATION_RESULTS, IMPROVEMENT_AREAS, IMPROVEMENT_PRIORITY_RESULTS,
  IMPROVEMENT_STATUSES, DECISION_QUALITY_RESULTS, FAILURE_PATTERN_RESULTS,
  HALLUCINATION_RISK_RESULTS, BLIND_SPOT_RESULTS, KNOWLEDGE_COVERAGE_RESULTS,
  AI_REVIEW_TYPES, AI_RECOMMENDATION_TYPES, AI_SCORECARD_FIELDS, AUTONOMOUS_FLOW_STAGES,
  evaluateRecommendationAccuracy, evaluateConfidenceCalibration,
  analyzeFailurePatterns, detectBlindSpots, buildExecutiveAiScorecard,
  validateAiReview, buildAutonomousTimeline,
  ENTERPRISE_AUTONOMOUS_COMPONENTS, ENTERPRISE_AUTONOMOUS_SUPPORT_MATRIX,
} from './enterpriseAutonomous';

describe('enterpriseAutonomous 상수(§3~§10 — SQL CHECK 1:1)', () => {
  it('AI Review Category 15종·Status 5종', () => {
    expect(AI_REVIEW_CATEGORIES).toHaveLength(15);
    expect(AI_REVIEW_STATUSES).toHaveLength(5);
    expect(AI_REVIEW_STATUSES).toContain('insufficient_data');
  });
  it('Accuracy/Calibration/Priority/Quality/Failure/Hallucination/Blind Spot/Coverage 결과 5종 + insufficient_data 포함', () => {
    for (const list of [RECOMMENDATION_ACCURACY_RESULTS, CONFIDENCE_CALIBRATION_RESULTS, IMPROVEMENT_PRIORITY_RESULTS, IMPROVEMENT_STATUSES, DECISION_QUALITY_RESULTS, FAILURE_PATTERN_RESULTS, HALLUCINATION_RISK_RESULTS, BLIND_SPOT_RESULTS, KNOWLEDGE_COVERAGE_RESULTS]) {
      expect(list).toHaveLength(5);
      expect(list).toContain('insufficient_data');
    }
    expect(RECOMMENDATION_ACCURACY_DIMENSIONS).toHaveLength(5);
    expect(IMPROVEMENT_AREAS).toHaveLength(6);
  });
  it('Review 3종·권고 23종·Scorecard 8필드·Flow 12단계·컴포넌트 10종', () => {
    expect(AI_REVIEW_TYPES).toHaveLength(3);
    expect(AI_RECOMMENDATION_TYPES).toHaveLength(23);
    expect(AI_RECOMMENDATION_TYPES).toContain('insufficient_data');
    expect(AI_SCORECARD_FIELDS).toHaveLength(8);
    expect(AUTONOMOUS_FLOW_STAGES).toHaveLength(12);
    expect(ENTERPRISE_AUTONOMOUS_COMPONENTS).toHaveLength(10);
  });
});

describe('evaluateRecommendationAccuracy(§5 — Accuracy ≠ Future Accuracy)', () => {
  it('전 차원 고득점 → highly_reliable_candidate', () => {
    const r = evaluateRecommendationAccuracy({ recommendationQuality: 90, humanAcceptanceRate: 85, predictionStability: 88, consistencyScore: 92, evidenceQuality: 87 });
    expect(r.result).toBe('highly_reliable_candidate');
    expect(r.assessedDimensions).toBe(5);
    expect(r.accuracyIsNotFutureAccuracy).toBe(true);
  });
  it('중간/저득점 → uncertain/unreliable', () => {
    expect(evaluateRecommendationAccuracy({ recommendationQuality: 45, humanAcceptanceRate: 50, predictionStability: 40, consistencyScore: null, evidenceQuality: null }).result).toBe('uncertain_candidate');
    expect(evaluateRecommendationAccuracy({ recommendationQuality: 20, humanAcceptanceRate: 25, predictionStability: 30, consistencyScore: 15, evidenceQuality: 10 }).result).toBe('unreliable_candidate');
  });
  it('3차원 미만 평가 → insufficient_data(Null → 0 금지)', () => {
    const r = evaluateRecommendationAccuracy({ recommendationQuality: 90, humanAcceptanceRate: null, predictionStability: null, consistencyScore: null, evidenceQuality: 80 });
    expect(r.result).toBe('insufficient_data');
    expect(r.accuracyScore).toBeNull();
    expect(r.assessedDimensions).toBe(2);
  });
});

describe('evaluateConfidenceCalibration(§6 — Confidence ≠ Correctness)', () => {
  const mk = (confidence: number, correct: boolean) => ({ confidence, correct });
  it('Confidence ≈ 실제 정확도 → well_calibrated_candidate', () => {
    const r = evaluateConfidenceCalibration([mk(80, true), mk(80, true), mk(80, true), mk(80, true), mk(80, false)]);
    expect(r.result).toBe('well_calibrated_candidate');
    expect(r.observedAccuracy).toBe(80);
    expect(r.calibrationGap).toBe(0);
    expect(r.confidenceIsNotCorrectness).toBe(true);
  });
  it('높은 Confidence + 낮은 정확도 → overconfident_candidate(gap 양수)', () => {
    const r = evaluateConfidenceCalibration([mk(90, false), mk(90, false), mk(90, true), mk(90, false), mk(90, false)]);
    expect(r.result).toBe('overconfident_candidate');
    expect(r.calibrationGap).toBe(70);
  });
  it('낮은 Confidence + 높은 정확도 → underconfident_candidate(gap 음수)', () => {
    const r = evaluateConfidenceCalibration([mk(30, true), mk(30, true), mk(30, true), mk(30, true), mk(30, true)]);
    expect(r.result).toBe('underconfident_candidate');
    expect(r.calibrationGap).toBe(-70);
  });
  it('표본 5건 미만 → insufficient_data(sample_too_small — 미판정 제외)', () => {
    const r = evaluateConfidenceCalibration([mk(80, true), mk(70, false), { confidence: 60, correct: null }, { confidence: null, correct: true }]);
    expect(r.result).toBe('insufficient_data');
    expect(r.sampleCount).toBe(2);
    expect(evaluateConfidenceCalibration(null).result).toBe('insufficient_data');
  });
});

describe('analyzeFailurePatterns(Failure Pattern ≠ Root Cause)', () => {
  it('반복 실패 태그 → recurring_failure_candidate', () => {
    const r = analyzeFailurePatterns([
      { recordCode: 'R-1', failed: true, tags: ['stale_data', 'overreach'] },
      { recordCode: 'R-2', failed: true, tags: ['stale_data'] },
      { recordCode: 'R-3', failed: false, tags: ['ok'] },
    ]);
    expect(r.result).toBe('recurring_failure_candidate');
    expect(r.recurringFailureTags).toEqual(['stale_data']);
    expect(r.failureCount).toBe(2);
    expect(r.failurePatternIsNotRootCause).toBe(true);
  });
  it('실패 있으나 반복 없음 → isolated, 실패 없음 → no_material', () => {
    expect(analyzeFailurePatterns([
      { recordCode: 'R-1', failed: true, tags: ['a'] }, { recordCode: 'R-2', failed: false, tags: [] },
    ]).result).toBe('isolated_failure_candidate');
    expect(analyzeFailurePatterns([
      { recordCode: 'R-1', failed: false, tags: [] }, { recordCode: 'R-2', failed: false, tags: [] },
    ]).result).toBe('no_material_failure_candidate');
  });
  it('판정 표본 2건 미만 → insufficient_data(미판정은 실패로 치지 않음)', () => {
    expect(analyzeFailurePatterns([
      { recordCode: 'R-1', failed: true, tags: ['a'] }, { recordCode: 'R-2', failed: null, tags: [] },
    ]).result).toBe('insufficient_data');
    expect(analyzeFailurePatterns(null).result).toBe('insufficient_data');
  });
});

describe('detectBlindSpots(Blind Spot ≠ Missing Knowledge)', () => {
  it('커버리지 0 도메인 2개 이상 → critical, 1개 → potential', () => {
    const r = detectBlindSpots([
      { domain: 'security', coverageCount: 0 }, { domain: 'legal', coverageCount: 0 }, { domain: 'ai', coverageCount: 5 },
    ]);
    expect(r.result).toBe('critical_blind_spot_candidate');
    expect(r.blindSpotDomains).toEqual(['legal', 'security']);
    expect(r.blindSpotIsNotMissingKnowledge).toBe(true);
    expect(detectBlindSpots([
      { domain: 'security', coverageCount: 0 }, { domain: 'ai', coverageCount: 3 },
    ]).result).toBe('potential_blind_spot_candidate');
  });
  it('전 도메인 커버 → no_material, 전부 미계측 → unverified, 없음 → insufficient_data', () => {
    expect(detectBlindSpots([{ domain: 'ai', coverageCount: 4 }, { domain: 'security', coverageCount: 2 }]).result).toBe('no_material_blind_spot_candidate');
    const r = detectBlindSpots([{ domain: 'ai', coverageCount: null }]);
    expect(r.result).toBe('blind_spot_unverified');
    expect(r.unverifiedDomains).toBe(1);
    expect(detectBlindSpots(null).result).toBe('insufficient_data');
  });
});

describe('buildExecutiveAiScorecard(§8 — 결정적 정렬)', () => {
  const base = {
    category: 'ai', failure: null, blindSpot: null, improvementCount: 0, humanOversightPresent: false,
  };
  it('unreliable/overconfident 우선 + 동순위는 코드순', () => {
    const r = buildExecutiveAiScorecard([
      { ...base, reviewCode: 'AR-C', accuracy: 'reliable_candidate' as const, calibration: 'well_calibrated_candidate' as const },
      { ...base, reviewCode: 'AR-A', accuracy: 'unreliable_candidate' as const, calibration: 'overconfident_candidate' as const },
      { ...base, reviewCode: 'AR-B', accuracy: 'unreliable_candidate' as const, calibration: 'overconfident_candidate' as const },
    ], 3);
    expect(r.priorityRows.map((e) => e.reviewCode)).toEqual(['AR-A', 'AR-B', 'AR-C']);
    expect(r.fields).toHaveLength(8);
    expect(r.scorecardIsNotModelChange).toBe(true);
    expect(r.orderingIsDeterministic).toBe(true);
  });
  it('null 입력 → 빈 행(오류 없음)', () => {
    expect(buildExecutiveAiScorecard(null).priorityRows).toEqual([]);
  });
});

describe('validateAiReview(§9 — AI Review ≠ Human Approval)', () => {
  it('Self-Review + Evidence 없음 → 이중 차단', () => {
    const r = validateAiReview({ action: 'record_review_reference', evidenceCount: 0, isSelfReview: true });
    expect(r.allowed).toBe(false);
    expect(r.blockedReasons).toHaveLength(2);
    expect(r.aiReviewIsNotHumanApproval).toBe(true);
    expect(r.improvementAppliedByHuman).toBe(true);
  });
  it('타인 Review + Evidence 존재 → 허용, 그 외 액션은 게이트 미적용', () => {
    expect(validateAiReview({ action: 'record_review_reference', evidenceCount: 1, isSelfReview: false }).allowed).toBe(true);
    expect(validateAiReview({ action: 'mark_candidate', evidenceCount: null, isSelfReview: true }).allowed).toBe(true);
  });
});

describe('buildAutonomousTimeline / Honest Boundary(Support Matrix)', () => {
  it('12단계 관측 표시(자동 진행 아님)', () => {
    const rows = buildAutonomousTimeline({ present: { enterprise_vision: true, ai_learning: true } });
    expect(rows).toHaveLength(12);
    expect(rows[0]).toEqual({ stage: 'enterprise_vision', present: true });
    expect(rows.filter((r) => r.present)).toHaveLength(2);
  });
  it('Support Matrix 51항목 — unavailable 14종은 전부 automatic_*(절대 금지 1:1)', () => {
    expect(ENTERPRISE_AUTONOMOUS_SUPPORT_MATRIX).toHaveLength(51);
    const unavailable = ENTERPRISE_AUTONOMOUS_SUPPORT_MATRIX.filter((e) => e.support === 'unavailable');
    expect(unavailable).toHaveLength(14);
    expect(unavailable.every((e) => e.capability.startsWith('automatic_'))).toBe(true);
    for (const cap of ['automatic_model_replacement', 'automatic_model_training', 'automatic_prompt_change', 'automatic_rule_change', 'automatic_code_modification', 'automatic_database_change', 'automatic_merge', 'automatic_deploy', 'automatic_rollback']) {
      expect(unavailable.some((e) => e.capability === cap)).toBe(true);
    }
  });
  it('실측 부재 피드(모델 레지스트리/Prompt 원장/추론 로그 등)는 insufficient_data 로 정직 표기', () => {
    const missing = ENTERPRISE_AUTONOMOUS_SUPPORT_MATRIX.filter((e) => e.support === 'insufficient_data').map((e) => e.capability);
    expect(missing).toHaveLength(6);
    for (const feed of ['model_registry_feed', 'prompt_version_ledger', 'inference_telemetry_log', 'evaluation_harness_feed', 'training_pipeline_feed', 'human_feedback_labeling_system']) {
      expect(missing).toContain(feed);
    }
  });
});
