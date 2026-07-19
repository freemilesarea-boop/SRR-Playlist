// AI-OPS-60 — Enterprise Resilience Intelligence, Adaptive Response &
// Business Continuity Center 순수 로직.
//
// 정직성 원칙:
//  * Resilience ≠ Guaranteed Survival. Recovery Plan ≠ Successful Recovery.
//  * Preparedness ≠ Readiness. Scenario ≠ Reality.
//  * Recommendation ≠ Decision. Confidence ≠ Certainty.
//  * Correlation ≠ Causation. Recovery Score ≠ Recovery Success.
//  * Null → 0 변환 금지 — insufficient_data / sample_too_small 유지.
//  * 모든 함수는 deterministic / pure / null-safe.
//  * 자동 복구 실행, 자동 장애 조치, 자동 전략/조직/Budget 변경, Production
//    변경, Merge/Deploy/Rollback 없음.
//  * riskResilience(0528)/selfHealing(0502)/CapacityContinuity(0508) 계층과
//    별개(원본 무변경).

import { isFiniteNumber, clampScore } from './aiMemory';

// ── 상수(0564 SQL CHECK 와 1:1) ─────────────────────────────────────────

export const RESILIENCE_CATEGORIES = [
  'infrastructure', 'operations', 'technology', 'workforce', 'supply_chain',
  'finance', 'governance', 'security', 'executive', 'enterprise', 'custom',
] as const;
export type ResilienceCategory = (typeof RESILIENCE_CATEGORIES)[number];

export const RESILIENCE_STATUSES = [
  'observed', 'candidate', 'review_reference', 'archived_reference', 'insufficient_data',
] as const;
export type ResilienceStatus = (typeof RESILIENCE_STATUSES)[number];

export const RESILIENCE_DIMENSIONS = [
  'operational_stability', 'recovery_capability', 'adaptive_capacity',
  'resource_redundancy', 'business_continuity',
] as const;

export const RESILIENCE_ASSESSMENT_RESULTS = [
  'highly_resilient', 'resilient', 'partially_resilient', 'vulnerable', 'insufficient_data',
] as const;
export type ResilienceAssessmentResult = (typeof RESILIENCE_ASSESSMENT_RESULTS)[number];

export const RECOVERY_DIMENSIONS = [
  'recovery_time', 'recovery_resources', 'recovery_dependencies',
  'recovery_procedures', 'recovery_confidence',
] as const;

export const RECOVERY_READINESS_RESULTS = [
  'fully_ready', 'mostly_ready', 'partially_ready', 'not_ready', 'insufficient_data',
] as const;
export type RecoveryReadinessResult = (typeof RECOVERY_READINESS_RESULTS)[number];

export const ADAPTIVE_DIMENSIONS = [
  'response_speed', 'decision_agility', 'organizational_flexibility',
  'resource_adaptability', 'learning_capability',
] as const;

export const ADAPTIVE_RESPONSE_RESULTS = [
  'highly_adaptive', 'adaptive', 'partially_adaptive', 'rigid', 'insufficient_data',
] as const;
export type AdaptiveResponseResult = (typeof ADAPTIVE_RESPONSE_RESULTS)[number];

export const BUSINESS_CONTINUITY_RESULTS = [
  'continuity_assured_candidate', 'continuity_gap_candidate',
  'continuity_critical_gap_candidate', 'continuity_unverified', 'insufficient_data',
] as const;
export type BusinessContinuityResult = (typeof BUSINESS_CONTINUITY_RESULTS)[number];

export const OPERATIONAL_STABILITY_RESULTS = [
  'stable_candidate', 'minor_instability_candidate', 'unstable_candidate',
  'stability_unverified', 'insufficient_data',
] as const;

export const RISK_SIGNAL_RESULTS = [
  'critical_risk_signal_candidate', 'elevated_risk_signal_candidate',
  'moderate_risk_signal_candidate', 'low_risk_signal_candidate', 'insufficient_data',
] as const;

export const SPOF_RESULTS = [
  'confirmed_spof_candidate', 'suspected_spof_candidate', 'redundant_candidate',
  'spof_unverified', 'insufficient_data',
] as const;

export const PRIORITY_RISK_RESULTS = [
  'top_priority_candidate', 'high_priority_candidate', 'medium_priority_candidate',
  'low_priority_candidate', 'insufficient_data',
] as const;

export const RESILIENCE_REVIEW_TYPES = ['resilience_review', 'executive_review', 'human_review'] as const;
export type ResilienceReviewType = (typeof RESILIENCE_REVIEW_TYPES)[number];

export const RESILIENCE_REVIEW_STATUSES = [
  'requested', 'in_review', 'review_reference_recorded', 'revision_requested', 'insufficient_data',
] as const;

export const RESILIENCE_RECOMMENDATION_TYPES = [
  'create_resilience_candidate', 'review_resilience_assessment', 'review_recovery_readiness',
  'review_adaptive_response', 'review_business_continuity', 'review_operational_stability',
  'review_risk_signal', 'review_spof', 'review_priority_risk', 'record_recovery_timeline',
  'build_executive_resilience_summary', 'build_executive_resilience_scorecard',
  'request_resilience_review', 'request_executive_review', 'request_human_review',
  'record_resilience_learning', 'link_foresight_reference', 'link_capacity_reference',
  'link_environment_reference', 'redundancy_review_candidate',
  'continuity_drill_review_candidate', 'gather_more_evidence_candidate', 'insufficient_data',
] as const;

export const RESILIENCE_SCORECARD_FIELDS = [
  'resilience_score', 'recovery_readiness', 'adaptive_capacity', 'business_continuity',
  'priority_risks', 'recommendation', 'executive_summary', 'human_review',
] as const;

// Vision → … → Audit 흐름(§핵심 목적) — 13단계.
export const RESILIENCE_FLOW_STAGES = [
  'vision', 'mission', 'strategy', 'innovation', 'strategic_foresight',
  'risk_signal_detection', 'enterprise_resilience_assessment', 'adaptive_response_planning',
  'business_continuity_analysis', 'recovery_readiness', 'executive_resilience_review',
  'resilience_learning', 'audit',
] as const;
export type ResilienceFlowStage = (typeof RESILIENCE_FLOW_STAGES)[number];

// ── Resilience Assessment(§5 — Resilience ≠ Guaranteed Survival) ────────

export interface ResilienceDimensionInput {
  dimension: string;
  score: number | null;   // 0~100 — Null 유지
}

export interface ResilienceAssessment {
  result: ResilienceAssessmentResult;
  averageScore: number | null;
  weakestDimension: string | null;
  evaluatedDimensions: string[];
  missingDimensions: string[];
  resilienceIsNotGuaranteedSurvival: true;
}

/** Resilience 평가 — 평균 기반. 유효 차원 3개 미만이면 insufficient_data. */
export function assessResilience(dimensions: ResilienceDimensionInput[] | null | undefined): ResilienceAssessment {
  const valid = (dimensions ?? []).filter(
    (d) => (RESILIENCE_DIMENSIONS as readonly string[]).includes(d.dimension) && isFiniteNumber(d.score),
  );
  const evaluated = valid.map((d) => d.dimension).sort((a, b) => a.localeCompare(b));
  const missing = RESILIENCE_DIMENSIONS.filter((d) => !evaluated.includes(d));
  if (valid.length < 3) {
    return { result: 'insufficient_data', averageScore: null, weakestDimension: null, evaluatedDimensions: evaluated, missingDimensions: [...missing], resilienceIsNotGuaranteedSurvival: true };
  }
  const scores = valid.map((d) => clampScore(d.score as number));
  const avg = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
  const weakest = [...valid].sort((a, b) => (clampScore(a.score as number) - clampScore(b.score as number)) || a.dimension.localeCompare(b.dimension))[0];
  let result: ResilienceAssessmentResult;
  if (avg >= 80) result = 'highly_resilient';
  else if (avg >= 60) result = 'resilient';
  else if (avg >= 40) result = 'partially_resilient';
  else result = 'vulnerable';
  return { result, averageScore: avg, weakestDimension: weakest.dimension, evaluatedDimensions: evaluated, missingDimensions: [...missing], resilienceIsNotGuaranteedSurvival: true };
}

// ── Recovery Readiness(§6 — Recovery Score ≠ Recovery Success) ──────────

export interface RecoveryDimensionInput {
  dimension: string;
  score: number | null;   // 0~100 — Null 유지
}

export interface RecoveryReadinessAssessment {
  result: RecoveryReadinessResult;
  averageScore: number | null;
  weakestDimension: string | null;
  evaluatedDimensions: string[];
  missingDimensions: string[];
  recoveryScoreIsNotRecoverySuccess: true;
}

/** Recovery Readiness 평가 — 평균 기반. 유효 차원 3개 미만이면
 *  insufficient_data. recovery_confidence 차원 미평가 시 fully_ready 로
 *  승격하지 않음(과단정 방지). */
export function assessRecoveryReadiness(dimensions: RecoveryDimensionInput[] | null | undefined): RecoveryReadinessAssessment {
  const valid = (dimensions ?? []).filter(
    (d) => (RECOVERY_DIMENSIONS as readonly string[]).includes(d.dimension) && isFiniteNumber(d.score),
  );
  const evaluated = valid.map((d) => d.dimension).sort((a, b) => a.localeCompare(b));
  const missing = RECOVERY_DIMENSIONS.filter((d) => !evaluated.includes(d));
  if (valid.length < 3) {
    return { result: 'insufficient_data', averageScore: null, weakestDimension: null, evaluatedDimensions: evaluated, missingDimensions: [...missing], recoveryScoreIsNotRecoverySuccess: true };
  }
  const scores = valid.map((d) => clampScore(d.score as number));
  const avg = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
  const weakest = [...valid].sort((a, b) => (clampScore(a.score as number) - clampScore(b.score as number)) || a.dimension.localeCompare(b.dimension))[0];
  const confidenceEvaluated = evaluated.includes('recovery_confidence');
  let result: RecoveryReadinessResult;
  if (avg >= 80 && confidenceEvaluated) result = 'fully_ready';
  else if (avg >= 80) result = 'mostly_ready';   // confidence 미평가 — 승격 차단
  else if (avg >= 60) result = 'mostly_ready';
  else if (avg >= 40) result = 'partially_ready';
  else result = 'not_ready';
  return { result, averageScore: avg, weakestDimension: weakest.dimension, evaluatedDimensions: evaluated, missingDimensions: [...missing], recoveryScoreIsNotRecoverySuccess: true };
}

// ── Adaptive Response(§7 — Preparedness ≠ Readiness) ────────────────────

export interface AdaptiveDimensionInput {
  dimension: string;
  score: number | null;   // 0~100 — Null 유지
}

export interface AdaptiveResponseAssessment {
  result: AdaptiveResponseResult;
  averageScore: number | null;
  weakestDimension: string | null;
  evaluatedDimensions: string[];
  missingDimensions: string[];
  preparednessIsNotReadiness: true;
}

/** Adaptive Response 평가 — 평균 기반. 유효 차원 3개 미만이면 insufficient_data. */
export function assessAdaptiveResponse(dimensions: AdaptiveDimensionInput[] | null | undefined): AdaptiveResponseAssessment {
  const valid = (dimensions ?? []).filter(
    (d) => (ADAPTIVE_DIMENSIONS as readonly string[]).includes(d.dimension) && isFiniteNumber(d.score),
  );
  const evaluated = valid.map((d) => d.dimension).sort((a, b) => a.localeCompare(b));
  const missing = ADAPTIVE_DIMENSIONS.filter((d) => !evaluated.includes(d));
  if (valid.length < 3) {
    return { result: 'insufficient_data', averageScore: null, weakestDimension: null, evaluatedDimensions: evaluated, missingDimensions: [...missing], preparednessIsNotReadiness: true };
  }
  const scores = valid.map((d) => clampScore(d.score as number));
  const avg = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
  const weakest = [...valid].sort((a, b) => (clampScore(a.score as number) - clampScore(b.score as number)) || a.dimension.localeCompare(b.dimension))[0];
  let result: AdaptiveResponseResult;
  if (avg >= 80) result = 'highly_adaptive';
  else if (avg >= 60) result = 'adaptive';
  else if (avg >= 40) result = 'partially_adaptive';
  else result = 'rigid';
  return { result, averageScore: avg, weakestDimension: weakest.dimension, evaluatedDimensions: evaluated, missingDimensions: [...missing], preparednessIsNotReadiness: true };
}

// ── Business Continuity(Recovery Plan ≠ Successful Recovery) ────────────

export interface ContinuityAreaInput {
  area: string;
  covered: boolean | null;   // Null 이면 미검증(unverified) 유지 — 0/false 치환 금지
}

export interface BusinessContinuityAssessment {
  result: BusinessContinuityResult;
  coverageRatio: number | null;   // covered 비율(%) — 검증된 영역 기준
  gaps: string[];                 // covered === false — 정직 공개
  unverifiedAreas: string[];      // covered === null — 정직 공개
  planIsNotSuccessfulRecovery: true;
}

/** Business Continuity 평가 — 검증 영역 3개 미만이면 insufficient_data.
 *  커버리지 ≥90 assured, ≥60 gap, 그 외 critical gap. */
export function assessBusinessContinuity(areas: ContinuityAreaInput[] | null | undefined): BusinessContinuityAssessment {
  const named = (areas ?? []).filter((a) => a.area && a.area.trim() !== '');
  const verified = named.filter((a) => a.covered !== null);
  const unverified = named.filter((a) => a.covered === null).map((a) => a.area).sort((a, b) => a.localeCompare(b));
  const gaps = named.filter((a) => a.covered === false).map((a) => a.area).sort((a, b) => a.localeCompare(b));
  if (verified.length < 3) {
    return { result: 'insufficient_data', coverageRatio: null, gaps, unverifiedAreas: unverified, planIsNotSuccessfulRecovery: true };
  }
  const ratio = Math.round((verified.filter((a) => a.covered === true).length / verified.length) * 100);
  let result: BusinessContinuityResult;
  if (ratio >= 90) result = 'continuity_assured_candidate';
  else if (ratio >= 60) result = 'continuity_gap_candidate';
  else result = 'continuity_critical_gap_candidate';
  return { result, coverageRatio: ratio, gaps, unverifiedAreas: unverified, planIsNotSuccessfulRecovery: true };
}

// ── SPOF Detection(단일 장애점 관측 후보 ≠ 실패 확정) ───────────────────

export interface ComponentInput {
  name: string;
  redundancyCount: number | null;   // 여분 개수 — Null 이면 unverified 유지
  criticality: number | null;       // 0~100 — Null 이면 unverified 유지
  evidenceCount: number;
}

export interface SpofDetection {
  spofCandidates: string[];          // 여분 0 + 중요도 ≥70 + Evidence — 정직 공개
  suspectedCandidates: string[];     // 여분 0 + 중요도 <70(또는 중요도 관측 낮음)
  redundantComponents: string[];     // 여분 ≥1
  unverifiedComponents: string[];    // 측정 불충분 — 판정 미부여(정직 공개)
  excludedWithoutEvidence: string[]; // Evidence 0 — 후보 제외(정직 공개)
  spofIsNotFailurePrediction: true;
}

/** SPOF 관측 — Evidence 없는 구성요소 제외, 미측정은 unverified 로 공개. */
export function detectSinglePointsOfFailure(components: ComponentInput[] | null | undefined): SpofDetection {
  const spof: string[] = [];
  const suspected: string[] = [];
  const redundant: string[] = [];
  const unverified: string[] = [];
  const excluded: string[] = [];
  for (const c of components ?? []) {
    if (!c.name || c.name.trim() === '') continue;
    if (!isFiniteNumber(c.evidenceCount) || c.evidenceCount <= 0) { excluded.push(c.name); continue; }
    if (!isFiniteNumber(c.redundancyCount) || !isFiniteNumber(c.criticality)) { unverified.push(c.name); continue; }
    if ((c.redundancyCount as number) >= 1) { redundant.push(c.name); continue; }
    if (clampScore(c.criticality as number) >= 70) spof.push(c.name);
    else suspected.push(c.name);
  }
  const sortAll = (xs: string[]) => xs.sort((a, b) => a.localeCompare(b));
  return {
    spofCandidates: sortAll(spof),
    suspectedCandidates: sortAll(suspected),
    redundantComponents: sortAll(redundant),
    unverifiedComponents: sortAll(unverified),
    excludedWithoutEvidence: sortAll(excluded),
    spofIsNotFailurePrediction: true,
  };
}

// ── Executive Resilience Scorecard(§8 — Scorecard ≠ 복구 지시) ──────────

export interface ResilienceScorecardInput {
  vulnerableAreas: number;
  notReadyRecoveries: number;
  rigidResponses: number;
  pendingHumanReviews: number;
}

export interface ExecutiveResilienceScorecard {
  fields: readonly string[];
  severityScore: number;
  attention: { area: string; count: number; weight: number }[];
  humanReviewRequired: true;
  scorecardIsNotRecoveryDirective: true;
}

/** Scorecard 심각도 — vulnerable ×10 + not ready ×5 + rigid ×3 + 대기 리뷰. */
export function buildExecutiveResilienceScorecard(input: ResilienceScorecardInput | null | undefined): ExecutiveResilienceScorecard {
  const n = (v: number | undefined) => (isFiniteNumber(v) && (v as number) > 0 ? Math.floor(v as number) : 0);
  const vulnerable = n(input?.vulnerableAreas);
  const notReady = n(input?.notReadyRecoveries);
  const rigid = n(input?.rigidResponses);
  const pending = n(input?.pendingHumanReviews);
  const attention = [
    { area: 'vulnerable_areas', count: vulnerable, weight: 10 },
    { area: 'not_ready_recoveries', count: notReady, weight: 5 },
    { area: 'rigid_responses', count: rigid, weight: 3 },
    { area: 'pending_human_reviews', count: pending, weight: 1 },
  ]
    .filter((a) => a.count > 0)
    .sort((a, b) => (b.count * b.weight - a.count * a.weight) || a.area.localeCompare(b.area));
  return {
    fields: RESILIENCE_SCORECARD_FIELDS,
    severityScore: vulnerable * 10 + notReady * 5 + rigid * 3 + pending,
    attention,
    humanReviewRequired: true,
    scorecardIsNotRecoveryDirective: true,
  };
}

// ── Review Workflow(§9 — Review ≠ Approval) ─────────────────────────────

export interface ResilienceReviewInput {
  reviewType: string;
  createdBy: string | null;
  reviewerId: string | null;
  evidenceCount: number;
}

export interface ResilienceReviewValidation {
  valid: boolean;
  reason: 'valid' | 'invalid_review_type' | 'self_review_blocked' | 'evidence_required' | 'reviewer_required';
  reviewIsNotApproval: true;
}

/** Review 검증 — 3종 외 차단, Self-Review 차단, Evidence 필수. */
export function validateResilienceReview(input: ResilienceReviewInput | null | undefined): ResilienceReviewValidation {
  const type = input?.reviewType ?? '';
  if (!(RESILIENCE_REVIEW_TYPES as readonly string[]).includes(type)) {
    return { valid: false, reason: 'invalid_review_type', reviewIsNotApproval: true };
  }
  if (!input?.reviewerId) {
    return { valid: false, reason: 'reviewer_required', reviewIsNotApproval: true };
  }
  if (input.createdBy !== null && input.createdBy === input.reviewerId) {
    return { valid: false, reason: 'self_review_blocked', reviewIsNotApproval: true };
  }
  if (!isFiniteNumber(input.evidenceCount) || input.evidenceCount <= 0) {
    return { valid: false, reason: 'evidence_required', reviewIsNotApproval: true };
  }
  return { valid: true, reason: 'valid', reviewIsNotApproval: true };
}

// ── Resilience Timeline(Vision → Audit — 13단계) ────────────────────────

export interface ResilienceTimelineEntry {
  stage: string;
  label?: string;
}

export interface ResilienceTimeline {
  stages: { stage: ResilienceFlowStage; entries: string[] }[];
  unknownStages: string[];   // 13단계 외 — 무시하지 않고 정직 공개
}

/** 타임라인 구성 — 13단계 순서 고정, 미지 단계는 별도 공개. */
export function buildResilienceTimeline(entries: ResilienceTimelineEntry[] | null | undefined): ResilienceTimeline {
  const unknown: string[] = [];
  const byStage = new Map<string, string[]>();
  for (const e of entries ?? []) {
    if (!(RESILIENCE_FLOW_STAGES as readonly string[]).includes(e.stage)) {
      if (e.stage && !unknown.includes(e.stage)) unknown.push(e.stage);
      continue;
    }
    const list = byStage.get(e.stage) ?? [];
    list.push(e.label ?? e.stage);
    byStage.set(e.stage, list);
  }
  unknown.sort((a, b) => a.localeCompare(b));
  return {
    stages: RESILIENCE_FLOW_STAGES.map((stage) => ({ stage, entries: byStage.get(stage) ?? [] })),
    unknownStages: unknown,
  };
}

// ── Support Matrix(정직 고지 — 46항목) ──────────────────────────────────

export type ResilienceSupportLevel =
  | 'fully_supported'
  | 'partially_supported'
  | 'advisory_only'
  | 'human_review_only'
  | 'unavailable'
  | 'insufficient_data';

export interface ResilienceSupportEntry {
  feature: string;
  level: ResilienceSupportLevel;
  note: string;
}

export const ENTERPRISE_RESILIENCE_SUPPORT_MATRIX: readonly ResilienceSupportEntry[] = [
  // 기록/감사 계층(서버 RPC 실존).
  { feature: 'resilience_candidate_record', level: 'fully_supported', note: '0564 admin_enterprise_resilience_create — 관측 기록만' },
  { feature: 'resilience_event_audit_log', level: 'fully_supported', note: '0564 이벤트 31종 append-only Audit' },
  { feature: 'resilience_review_request', level: 'fully_supported', note: '§9 3종 요청만 — Review ≠ Approval' },
  { feature: 'resilience_learning_record', level: 'fully_supported', note: 'Learning 기록 ≠ 자동 복구' },
  { feature: 'recovery_timeline_record', level: 'fully_supported', note: 'JSONB resilience_history append — 복구 확정 아님' },
  { feature: 'risk_signal_record', level: 'fully_supported', note: 'Risk Signal ≠ 사고 확정' },
  { feature: 'executive_resilience_summary_record', level: 'fully_supported', note: 'Summary ≠ 복구 실행 확정' },
  { feature: 'executive_resilience_scorecard_record', level: 'fully_supported', note: 'Scorecard ≠ 복구 지시' },
  { feature: 'recovery_recommendation_record', level: 'fully_supported', note: '23종 whitelist + Evidence 필수 — Recommendation ≠ Decision' },
  { feature: 'reference_linking', level: 'fully_supported', note: '0551/0555/0556/0557/0558/0560/0561/0562/0563 실존 검증 후 참조만' },
  // 분석 계층(설명/후보 제시만).
  { feature: 'enterprise_resilience_assessment', level: 'advisory_only', note: '§5 5차원 — Resilience ≠ Guaranteed Survival' },
  { feature: 'risk_signal_detection', level: 'advisory_only', note: '위험 신호 관측 후보 — 사고 확정 아님' },
  { feature: 'recovery_readiness_assessment', level: 'advisory_only', note: '§6 — Recovery Score ≠ Recovery Success' },
  { feature: 'business_continuity_analysis', level: 'advisory_only', note: 'Recovery Plan ≠ Successful Recovery' },
  { feature: 'adaptive_response_planning', level: 'advisory_only', note: '§7 — Preparedness ≠ Readiness, 대응 후보 제시만' },
  { feature: 'operational_resilience_analysis', level: 'advisory_only', note: 'Stability 관측 ≠ 무장애 보장' },
  { feature: 'spof_analysis', level: 'advisory_only', note: 'SPOF 관측 후보 ≠ 실패 확정 — Evidence 필수' },
  { feature: 'priority_risk_analysis', level: 'advisory_only', note: 'Priority ≠ Mandatory Order' },
  { feature: 'recovery_recommendation_generation', level: 'advisory_only', note: 'Recommendation ≠ Decision' },
  { feature: 'executive_resilience_summary_generation', level: 'advisory_only', note: '설명 계층 — 복구 확정 아님' },
  { feature: 'recovery_scenario_discussion', level: 'advisory_only', note: 'Scenario ≠ Reality' },
  { feature: 'resilience_forecast_discussion', level: 'advisory_only', note: 'Confidence ≠ Certainty' },
  { feature: 'continuity_drill_suggestion', level: 'advisory_only', note: 'BCP 훈련 후보 제안만 — 실행은 사람' },
  // 부분 지원(수동 기록 기반 — 자동 연동 아님).
  { feature: 'foresight_actuals_integration', level: 'partially_supported', note: '0563 foresight 수동 기록 기반 참조' },
  { feature: 'capacity_actuals_integration', level: 'partially_supported', note: '0558 capacity_resources 수동 기록 기반 참조(스펙 표기 ai_enterprise_resource_capacity 는 부재)' },
  { feature: 'environment_actuals_integration', level: 'partially_supported', note: '0556 environment_observations 수동 기록 기반 참조' },
  { feature: 'transformation_actuals_integration', level: 'partially_supported', note: '0560 transformations 수동 기록 기반 참조' },
  // 사람 전용 결정.
  { feature: 'recovery_execution_decision', level: 'human_review_only', note: 'Recovery 실행은 사람' },
  { feature: 'failover_decision', level: 'human_review_only', note: '장애 조치는 사람' },
  { feature: 'strategy_change_decision', level: 'human_review_only', note: 'Strategy 변경은 사람' },
  { feature: 'budget_change_decision', level: 'human_review_only', note: 'Budget 변경은 사람' },
  // 금지(스펙 — RPC 자체 없음).
  { feature: 'automatic_recovery_execution', level: 'unavailable', note: '금지 — 자동 복구 실행 없음' },
  { feature: 'automatic_failover', level: 'unavailable', note: '금지 — 자동 장애 조치 없음' },
  { feature: 'automatic_strategy_change', level: 'unavailable', note: '금지 — 자동 전략 변경 없음' },
  { feature: 'automatic_organization_change', level: 'unavailable', note: '금지 — 자동 조직 변경 없음' },
  { feature: 'automatic_budget_change', level: 'unavailable', note: '금지 — 자동 Budget 변경 없음' },
  { feature: 'automatic_production_change', level: 'unavailable', note: '금지 — Production 변경 없음' },
  { feature: 'automatic_merge', level: 'unavailable', note: '금지 — Merge 없음' },
  { feature: 'automatic_deploy', level: 'unavailable', note: '금지 — Deploy 없음' },
  { feature: 'automatic_rollback', level: 'unavailable', note: '금지 — Rollback 없음' },
  // 부재 피드(실측 — 원본 없음).
  { feature: 'incident_management_feed', level: 'insufficient_data', note: '인시던트 관리 피드 부재(실측)' },
  { feature: 'monitoring_alert_feed', level: 'insufficient_data', note: '모니터링 알림 피드 부재(실측)' },
  { feature: 'disaster_recovery_system', level: 'insufficient_data', note: '재해복구 시스템 부재(실측)' },
  { feature: 'backup_verification_feed', level: 'insufficient_data', note: '백업 검증 피드 부재(실측)' },
  { feature: 'supply_chain_feed', level: 'insufficient_data', note: '공급망 피드 부재(실측)' },
  { feature: 'bcp_drill_records', level: 'insufficient_data', note: 'BCP 훈련 기록 부재(실측)' },
] as const;
