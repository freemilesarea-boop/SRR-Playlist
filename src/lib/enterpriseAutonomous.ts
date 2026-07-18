/**
 * enterpriseAutonomous — Enterprise Autonomous Intelligence, Meta-Reasoning &
 * Self-Improvement Governance 순수 로직 (Phase AI-OPS-50).
 *
 * Enterprise Vision→AI Observation→AI Reasoning→Meta Reasoning→Decision
 * Quality→Recommendation Accuracy→Confidence Calibration→Failure Analysis→
 * Self Improvement Candidate→Human Oversight→Executive AI Review→AI Learning→
 * Audit.
 *
 * 정직성: Improvement Candidate ≠ Applied Improvement · Recommendation
 * Accuracy ≠ Future Accuracy · Confidence ≠ Correctness · Failure Pattern ≠
 * Root Cause · Blind Spot ≠ Missing Knowledge · Meta Reasoning ≠ Truth ·
 * AI Review ≠ Human Approval · Recommendation ≠ Decision · Pattern ≠
 * Causality · Null → 0 변환 금지.
 * 전 함수 결정적(Deterministic)·순수(Pure)·Null-safe. 자동 모델/Prompt/Rule
 * 변경 없음 — 사람이 AI 를 개선한다.
 */
import { isFiniteNumber, clampScore } from './aiMemory';

/* ── 상수(SQL CHECK 1:1) ────────────────────────────────────────────────── */
export const AI_REVIEW_CATEGORIES = [
  'strategy', 'execution', 'performance', 'business_value', 'portfolio', 'governance',
  'organization', 'knowledge', 'recommendation', 'prompt', 'rule', 'ai', 'executive', 'enterprise', 'custom',
] as const;

export const AI_REVIEW_STATUSES = [
  'draft', 'candidate', 'review_reference', 'archived_reference', 'insufficient_data',
] as const;

export const RECOMMENDATION_ACCURACY_DIMENSIONS = [
  'recommendation_quality', 'human_acceptance', 'prediction_stability', 'consistency', 'evidence_quality',
] as const;
export const RECOMMENDATION_ACCURACY_RESULTS = [
  'highly_reliable_candidate', 'reliable_candidate', 'uncertain_candidate',
  'unreliable_candidate', 'insufficient_data',
] as const;
export type RecommendationAccuracyResult = (typeof RECOMMENDATION_ACCURACY_RESULTS)[number];

export const CONFIDENCE_CALIBRATION_RESULTS = [
  'well_calibrated_candidate', 'acceptable_candidate', 'overconfident_candidate',
  'underconfident_candidate', 'insufficient_data',
] as const;
export type ConfidenceCalibrationResult = (typeof CONFIDENCE_CALIBRATION_RESULTS)[number];

export const IMPROVEMENT_AREAS = ['rule', 'prompt', 'workflow', 'knowledge', 'validation', 'review'] as const;
export const IMPROVEMENT_PRIORITY_RESULTS = [
  'highly_recommended_candidate', 'recommended_candidate', 'optional_candidate',
  'unverified_candidate', 'insufficient_data',
] as const;
export const IMPROVEMENT_STATUSES = ['proposed', 'under_review', 'review_reference_recorded', 'revision_requested', 'insufficient_data'] as const;

export const DECISION_QUALITY_RESULTS = ['high_quality_candidate', 'acceptable_quality_candidate', 'low_quality_candidate', 'quality_unverified', 'insufficient_data'] as const;
export const FAILURE_PATTERN_RESULTS = ['recurring_failure_candidate', 'isolated_failure_candidate', 'no_material_failure_candidate', 'failure_unverified', 'insufficient_data'] as const;
export type FailurePatternResult = (typeof FAILURE_PATTERN_RESULTS)[number];
export const HALLUCINATION_RISK_RESULTS = ['low_hallucination_risk_candidate', 'moderate_hallucination_risk_candidate', 'high_hallucination_risk_candidate', 'hallucination_unverified', 'insufficient_data'] as const;
export const BLIND_SPOT_RESULTS = ['no_material_blind_spot_candidate', 'potential_blind_spot_candidate', 'critical_blind_spot_candidate', 'blind_spot_unverified', 'insufficient_data'] as const;
export type BlindSpotResult = (typeof BLIND_SPOT_RESULTS)[number];
export const KNOWLEDGE_COVERAGE_RESULTS = ['broad_coverage_candidate', 'adequate_coverage_candidate', 'narrow_coverage_candidate', 'coverage_unverified', 'insufficient_data'] as const;

export const AI_REVIEW_TYPES = ['ai_review', 'executive_review', 'human_oversight_review'] as const;

export const AI_RECOMMENDATION_TYPES = [
  'create_ai_review', 'record_ai_observation', 'record_ai_reasoning', 'record_meta_reasoning',
  'review_recommendation_accuracy', 'review_confidence_calibration', 'review_decision_quality',
  'review_failure_pattern', 'review_hallucination_risk', 'review_blind_spot',
  'review_knowledge_coverage', 'record_human_correction', 'create_improvement_candidate',
  'record_rule_refinement_candidate', 'record_prompt_improvement_candidate',
  'build_executive_ai_summary', 'build_executive_ai_scorecard',
  'request_ai_review', 'request_executive_review', 'request_human_oversight_review',
  'record_ai_learning', 'gather_more_evidence_candidate', 'insufficient_data',
] as const;

/* §8 Executive AI Scorecard 포함 필드 */
export const AI_SCORECARD_FIELDS = [
  'recommendation_accuracy', 'confidence_calibration', 'failure_pattern', 'blind_spot',
  'improvement_candidate', 'ai_review', 'executive_summary', 'human_oversight',
] as const;

/* ── Recommendation Accuracy(§5 — 5평가, Accuracy ≠ Future Accuracy) ────── */
export function evaluateRecommendationAccuracy(input: {
  recommendationQuality: number | null; humanAcceptanceRate: number | null;
  predictionStability: number | null; consistencyScore: number | null; evidenceQuality: number | null;
}): { result: RecommendationAccuracyResult; accuracyScore: number | null; assessedDimensions: number; accuracyIsNotFutureAccuracy: true } {
  const parts = [
    input.recommendationQuality, input.humanAcceptanceRate, input.predictionStability,
    input.consistencyScore, input.evidenceQuality,
  ].filter((s): s is number => isFiniteNumber(s)).map((s) => clampScore(s));
  // 5평가 중 3개 미만 → insufficient_data(Null → 0 변환 금지).
  if (parts.length < 3) {
    return { result: 'insufficient_data', accuracyScore: null, assessedDimensions: parts.length, accuracyIsNotFutureAccuracy: true };
  }
  const score = clampScore(parts.reduce((s, v) => s + v, 0) / parts.length);
  const result: RecommendationAccuracyResult = score >= 80 ? 'highly_reliable_candidate'
    : score >= 60 ? 'reliable_candidate'
    : score >= 40 ? 'uncertain_candidate'
    : 'unreliable_candidate';
  return { result, accuracyScore: score, assessedDimensions: parts.length, accuracyIsNotFutureAccuracy: true };
}

/* ── Confidence Calibration(§6 — Confidence ≠ Correctness) ──────────────── */
export function evaluateConfidenceCalibration(samples: { confidence: number | null; correct: boolean | null }[] | null): {
  result: ConfidenceCalibrationResult; averageConfidence: number | null; observedAccuracy: number | null;
  calibrationGap: number | null; sampleCount: number; confidenceIsNotCorrectness: true;
} {
  const valid = (Array.isArray(samples) ? samples : []).filter((s) => isFiniteNumber(s.confidence) && s.correct != null);
  // 표본 5건 미만 → sample_too_small(insufficient_data 유지).
  if (valid.length < 5) {
    return { result: 'insufficient_data', averageConfidence: null, observedAccuracy: null, calibrationGap: null, sampleCount: valid.length, confidenceIsNotCorrectness: true };
  }
  const averageConfidence = clampScore(valid.reduce((s, v) => s + (v.confidence as number), 0) / valid.length);
  const observedAccuracy = clampScore((valid.filter((v) => v.correct === true).length / valid.length) * 100);
  const calibrationGap = averageConfidence - observedAccuracy;   // 양수 = 과신, 음수 = 과소신뢰.
  const result: ConfidenceCalibrationResult = Math.abs(calibrationGap) <= 10 ? 'well_calibrated_candidate'
    : Math.abs(calibrationGap) <= 20 ? 'acceptable_candidate'
    : calibrationGap > 20 ? 'overconfident_candidate'
    : 'underconfident_candidate';
  return { result, averageConfidence, observedAccuracy, calibrationGap, sampleCount: valid.length, confidenceIsNotCorrectness: true };
}

/* ── Failure Pattern(태그 빈도 — Failure Pattern ≠ Root Cause) ──────────── */
export function analyzeFailurePatterns(records: { recordCode: string; failed: boolean | null; tags: string[] }[] | null, minOccurrence = 2): {
  result: FailurePatternResult; recurringFailureTags: string[]; failureCount: number;
  assessedCount: number; failurePatternIsNotRootCause: true;
} {
  const list = Array.isArray(records) ? records : [];
  const assessed = list.filter((r) => r.failed != null);
  // 판정된 표본 2건 미만 → insufficient_data(미판정은 실패로 치지 않음).
  if (assessed.length < 2) {
    return { result: 'insufficient_data', recurringFailureTags: [], failureCount: 0, assessedCount: assessed.length, failurePatternIsNotRootCause: true };
  }
  const failures = assessed.filter((r) => r.failed === true);
  if (!failures.length) {
    return { result: 'no_material_failure_candidate', recurringFailureTags: [], failureCount: 0, assessedCount: assessed.length, failurePatternIsNotRootCause: true };
  }
  const freq = new Map<string, number>();
  for (const f of failures) {
    const tags = Array.isArray(f.tags) ? f.tags.filter((t) => typeof t === 'string' && t.length > 0) : [];
    for (const t of new Set(tags)) freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  const recurringFailureTags = [...freq.entries()].filter(([, n]) => n >= minOccurrence).map(([t]) => t).sort((a, b) => a.localeCompare(b));
  const result: FailurePatternResult = recurringFailureTags.length > 0 ? 'recurring_failure_candidate' : 'isolated_failure_candidate';
  return { result, recurringFailureTags, failureCount: failures.length, assessedCount: assessed.length, failurePatternIsNotRootCause: true };
}

/* ── Blind Spot(도메인 커버리지 — Blind Spot ≠ Missing Knowledge) ───────── */
export function detectBlindSpots(domains: { domain: string; coverageCount: number | null }[] | null): {
  result: BlindSpotResult; blindSpotDomains: string[]; unverifiedDomains: number; assessedDomains: number; blindSpotIsNotMissingKnowledge: true;
} {
  const list = Array.isArray(domains) ? domains : [];
  if (!list.length) {
    return { result: 'insufficient_data', blindSpotDomains: [], unverifiedDomains: 0, assessedDomains: 0, blindSpotIsNotMissingKnowledge: true };
  }
  const measured = list.filter((d) => isFiniteNumber(d.coverageCount));
  const unverifiedDomains = list.length - measured.length;
  if (!measured.length) {
    return { result: 'blind_spot_unverified', blindSpotDomains: [], unverifiedDomains, assessedDomains: 0, blindSpotIsNotMissingKnowledge: true };
  }
  const blindSpotDomains = measured.filter((d) => d.coverageCount === 0).map((d) => d.domain).sort((a, b) => a.localeCompare(b));
  const result: BlindSpotResult = blindSpotDomains.length >= 2 ? 'critical_blind_spot_candidate'
    : blindSpotDomains.length === 1 ? 'potential_blind_spot_candidate'
    : 'no_material_blind_spot_candidate';
  return { result, blindSpotDomains, unverifiedDomains, assessedDomains: measured.length, blindSpotIsNotMissingKnowledge: true };
}

/* ── Executive AI Scorecard(§8 — 결정적 우선순위 정렬) ──────────────────── */
export interface AiScorecardEntryInput {
  reviewCode: string; category: string; accuracy: RecommendationAccuracyResult;
  calibration: ConfidenceCalibrationResult; failure: FailurePatternResult | null;
  blindSpot: BlindSpotResult | null; improvementCount: number | null; humanOversightPresent: boolean;
}
export function buildExecutiveAiScorecard(entries: AiScorecardEntryInput[] | null, topN = 5): {
  priorityRows: AiScorecardEntryInput[]; fields: readonly string[]; scorecardIsNotModelChange: true; orderingIsDeterministic: true;
} {
  const severity = (e: AiScorecardEntryInput): number => {
    const a = e.accuracy === 'unreliable_candidate' ? 3 : e.accuracy === 'uncertain_candidate' ? 1 : 0;
    const c = e.calibration === 'overconfident_candidate' ? 3 : e.calibration === 'underconfident_candidate' ? 2 : 0;
    const f = e.failure === 'recurring_failure_candidate' ? 2 : 0;
    const b = e.blindSpot === 'critical_blind_spot_candidate' ? 3 : e.blindSpot === 'potential_blind_spot_candidate' ? 1 : 0;
    return a * 10 + c * 5 + b * 3 + f * 2;
  };
  const sorted = (Array.isArray(entries) ? [...entries] : [])
    .sort((a, b) => severity(b) - severity(a) || a.reviewCode.localeCompare(b.reviewCode));
  return { priorityRows: sorted.slice(0, Math.max(0, topN)), fields: AI_SCORECARD_FIELDS, scorecardIsNotModelChange: true, orderingIsDeterministic: true };
}

/* ── AI Review 검증(§9 — Self 차단·Evidence 필수) ───────────────────────── */
export function validateAiReview(input: { action: string; evidenceCount: number | null; isSelfReview: boolean }): {
  allowed: boolean; blockedReasons: string[]; aiReviewIsNotHumanApproval: true; improvementAppliedByHuman: true;
} {
  const blockedReasons: string[] = [];
  if (input.action === 'record_review_reference') {
    if (input.isSelfReview) blockedReasons.push('Self-Review 차단(작성자 ≠ 평가자)');
    if (!isFiniteNumber(input.evidenceCount) || input.evidenceCount <= 0) blockedReasons.push('Evidence 없는 AI Review Reference 금지');
  }
  return { allowed: blockedReasons.length === 0, blockedReasons, aiReviewIsNotHumanApproval: true, improvementAppliedByHuman: true };
}

/* ── Autonomous 흐름 타임라인(관측 여부 표시 — 자동 진행 아님) ──────────── */
export const AUTONOMOUS_FLOW_STAGES = [
  'enterprise_vision', 'ai_observation', 'ai_reasoning', 'meta_reasoning',
  'decision_quality', 'recommendation_accuracy', 'confidence_calibration', 'failure_analysis',
  'self_improvement_candidate', 'human_oversight', 'executive_ai_review', 'ai_learning',
] as const;
export function buildAutonomousTimeline(input: { present: Partial<Record<(typeof AUTONOMOUS_FLOW_STAGES)[number], boolean>> }): {
  stage: (typeof AUTONOMOUS_FLOW_STAGES)[number]; present: boolean;
}[] {
  return AUTONOMOUS_FLOW_STAGES.map((stage) => ({ stage, present: input.present[stage] === true }));
}

/* ── 컴포넌트/Support Matrix ────────────────────────────────────────────── */
export const ENTERPRISE_AUTONOMOUS_COMPONENTS = [
  'ai_review_registry', 'improvement_candidate_registry', 'meta_reasoning_analysis',
  'recommendation_accuracy_analysis', 'confidence_calibration_analysis', 'failure_pattern_analysis',
  'blind_spot_analysis', 'human_oversight_ledger', 'executive_ai_scorecard',
  'ai_event_audit',
] as const;

export type AutonomousSupportLevel = 'fully_supported' | 'partially_supported' | 'advisory_only' | 'human_review_only' | 'unavailable' | 'insufficient_data';
export const ENTERPRISE_AUTONOMOUS_SUPPORT_MATRIX: { capability: string; support: AutonomousSupportLevel }[] = [
  { capability: 'ai_review_structuring', support: 'fully_supported' },
  { capability: 'ai_review_category_15_domains', support: 'fully_supported' },
  { capability: 'ai_observation_recording', support: 'fully_supported' },
  { capability: 'ai_reasoning_recording', support: 'fully_supported' },
  { capability: 'meta_reasoning_candidate', support: 'advisory_only' },
  { capability: 'recommendation_accuracy_5_dimensions', support: 'fully_supported' },
  { capability: 'confidence_calibration_candidate', support: 'fully_supported' },
  { capability: 'decision_quality_candidate', support: 'advisory_only' },
  { capability: 'failure_pattern_candidate', support: 'advisory_only' },
  { capability: 'hallucination_risk_candidate', support: 'advisory_only' },
  { capability: 'blind_spot_candidate', support: 'advisory_only' },
  { capability: 'knowledge_coverage_candidate', support: 'advisory_only' },
  { capability: 'human_correction_recording', support: 'fully_supported' },
  { capability: 'improvement_candidate_with_evidence', support: 'advisory_only' },
  { capability: 'rule_refinement_candidate_with_evidence', support: 'advisory_only' },
  { capability: 'prompt_improvement_candidate_with_evidence', support: 'advisory_only' },
  { capability: 'executive_ai_summary_candidate', support: 'advisory_only' },
  { capability: 'executive_ai_scorecard_candidate', support: 'advisory_only' },
  { capability: 'ai_recommendation_with_evidence', support: 'advisory_only' },
  { capability: 'ai_review_request', support: 'human_review_only' },
  { capability: 'executive_review_request', support: 'human_review_only' },
  { capability: 'human_oversight_review_request', support: 'human_review_only' },
  { capability: 'ai_review_reference_no_self_review', support: 'human_review_only' },
  { capability: 'improvement_application_human_only', support: 'human_review_only' },
  { capability: 'ai_learning_recording', support: 'fully_supported' },
  { capability: 'knowledge_reference_link_0553', support: 'partially_supported' },
  { capability: 'governance_reference_link_0551', support: 'partially_supported' },
  { capability: 'decision_outcome_link_0514', support: 'partially_supported' },
  { capability: 'commitment_reference_link_0520', support: 'partially_supported' },
  { capability: 'org_memory_link_0531', support: 'partially_supported' },
  { capability: 'ai_event_audit_trail', support: 'fully_supported' },
  { capability: 'model_registry_feed', support: 'insufficient_data' },
  { capability: 'prompt_version_ledger', support: 'insufficient_data' },
  { capability: 'inference_telemetry_log', support: 'insufficient_data' },
  { capability: 'evaluation_harness_feed', support: 'insufficient_data' },
  { capability: 'training_pipeline_feed', support: 'insufficient_data' },
  { capability: 'human_feedback_labeling_system', support: 'insufficient_data' },
  { capability: 'automatic_model_replacement', support: 'unavailable' },
  { capability: 'automatic_model_training', support: 'unavailable' },
  { capability: 'automatic_prompt_change', support: 'unavailable' },
  { capability: 'automatic_rule_change', support: 'unavailable' },
  { capability: 'automatic_strategy_change', support: 'unavailable' },
  { capability: 'automatic_governance_change', support: 'unavailable' },
  { capability: 'automatic_policy_change', support: 'unavailable' },
  { capability: 'automatic_budget_change', support: 'unavailable' },
  { capability: 'automatic_production_change', support: 'unavailable' },
  { capability: 'automatic_merge', support: 'unavailable' },
  { capability: 'automatic_deploy', support: 'unavailable' },
  { capability: 'automatic_rollback', support: 'unavailable' },
  { capability: 'automatic_code_modification', support: 'unavailable' },
  { capability: 'automatic_database_change', support: 'unavailable' },
];
