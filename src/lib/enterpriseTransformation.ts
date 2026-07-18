// AI-OPS-56 — Enterprise Transformation Intelligence, Change Management &
// Organizational Evolution Center 순수 로직.
//
// 정직성 원칙:
//  * Readiness ≠ Successful Transformation. Change Impact ≠ Actual Outcome.
//  * Recommendation ≠ Decision. Priority ≠ Mandatory Order.
//  * Organizational Evolution ≠ Automatic Change.
//  * Pattern ≠ Causality. Correlation ≠ Causation. Forecast ≠ Future Fact.
//  * Confidence ≠ Certainty.
//  * Null → 0 변환 금지 — insufficient_data / sample_too_small 유지.
//  * 모든 함수는 deterministic / pure / null-safe.
//  * 조직 자동 개편, 인사 자동 이동, 전략/Budget/KPI 자동 변경, Project 자동
//    생성, 계약 자동 변경, Production 변경, Merge/Deploy/Rollback 없음.

import { isFiniteNumber, clampScore } from './aiMemory';

// ── 상수(0560 SQL CHECK 와 1:1) ─────────────────────────────────────────

export const TRANSFORMATION_CATEGORIES = [
  'organization', 'strategy', 'operations', 'process', 'technology', 'product',
  'portfolio', 'governance', 'workforce', 'executive', 'enterprise', 'custom',
] as const;
export type TransformationCategory = (typeof TRANSFORMATION_CATEGORIES)[number];

export const TRANSFORMATION_STATUSES = [
  'proposed', 'candidate', 'review_reference', 'archived_reference', 'insufficient_data',
] as const;
export type TransformationStatus = (typeof TRANSFORMATION_STATUSES)[number];

export const CHANGE_IMPACT_DIMENSIONS = [
  'organizational_impact', 'operational_impact', 'financial_impact', 'strategic_impact', 'cultural_impact',
] as const;

export const CHANGE_IMPACT_RESULTS = [
  'high_impact_candidate', 'moderate_impact_candidate', 'low_impact_candidate',
  'uncertain_candidate', 'insufficient_data',
] as const;
export type ChangeImpactResult = (typeof CHANGE_IMPACT_RESULTS)[number];

export const TRANSFORMATION_READINESS_DIMENSIONS = [
  'leadership_readiness', 'workforce_readiness', 'process_readiness',
  'technology_readiness', 'governance_readiness',
] as const;

export const TRANSFORMATION_READINESS_RESULTS = [
  'highly_ready_candidate', 'mostly_ready_candidate', 'partially_ready_candidate',
  'not_ready_candidate', 'insufficient_data',
] as const;
export type TransformationReadinessResult = (typeof TRANSFORMATION_READINESS_RESULTS)[number];

export const STAKEHOLDER_GROUPS = [
  'executive', 'management', 'workforce', 'partner', 'customer',
] as const;

export const STAKEHOLDER_RESULTS = [
  'highly_affected_candidate', 'moderately_affected_candidate', 'minimally_affected_candidate',
  'unknown_candidate', 'insufficient_data',
] as const;
export type StakeholderResult = (typeof STAKEHOLDER_RESULTS)[number];

export const CHANGE_RISK_RESULTS = [
  'critical_risk_candidate', 'elevated_risk_candidate', 'manageable_risk_candidate',
  'negligible_risk_candidate', 'insufficient_data',
] as const;

export const RESISTANCE_RESULTS = [
  'high_resistance_candidate', 'moderate_resistance_candidate', 'low_resistance_candidate',
  'resistance_unverified', 'insufficient_data',
] as const;

export const MISSION_ALIGNMENT_RESULTS = [
  'strongly_aligned_candidate', 'partially_aligned_candidate', 'misaligned_candidate',
  'alignment_unverified', 'insufficient_data',
] as const;

export const EVOLUTION_RESULTS = [
  'evolution_ready_candidate', 'evolution_in_progress_candidate', 'evolution_stalled_candidate',
  'evolution_unverified', 'insufficient_data',
] as const;

export const TRANSFORMATION_PRIORITY_RESULTS = [
  'high_priority_candidate', 'medium_priority_candidate', 'low_priority_candidate',
  'priority_unverified', 'insufficient_data',
] as const;

export const TRANSFORMATION_REVIEW_TYPES = ['transformation_review', 'executive_review', 'human_review'] as const;
export type TransformationReviewType = (typeof TRANSFORMATION_REVIEW_TYPES)[number];

export const TRANSFORMATION_REVIEW_STATUSES = [
  'requested', 'in_review', 'review_reference_recorded', 'revision_requested', 'insufficient_data',
] as const;

export const TRANSFORMATION_RECOMMENDATION_TYPES = [
  'create_transformation_candidate', 'review_change_impact', 'review_transformation_readiness',
  'review_stakeholder_analysis', 'review_organizational_evolution', 'record_change_dependency',
  'review_transformation_priority', 'review_change_risk', 'review_resistance_analysis',
  'review_mission_alignment', 'record_transformation_timeline',
  'build_executive_transformation_summary', 'build_executive_transformation_scorecard',
  'request_transformation_review', 'request_executive_review', 'request_human_review',
  'record_transformation_learning', 'link_value_reference', 'link_organization_reference',
  'link_capacity_reference', 'phased_rollout_review_candidate',
  'gather_more_evidence_candidate', 'insufficient_data',
] as const;

export const TRANSFORMATION_SCORECARD_FIELDS = [
  'transformation_priority', 'change_impact', 'readiness', 'stakeholder_impact',
  'change_risk', 'recommendation', 'executive_summary', 'human_review',
] as const;

// Vision → … → Audit 흐름(§핵심 목적) — 13단계.
export const TRANSFORMATION_FLOW_STAGES = [
  'vision', 'mission', 'strategy', 'execution', 'value_optimization',
  'transformation_candidates', 'change_impact_analysis', 'transformation_readiness',
  'stakeholder_analysis', 'organizational_evolution', 'executive_transformation_review',
  'transformation_learning', 'audit',
] as const;
export type TransformationFlowStage = (typeof TRANSFORMATION_FLOW_STAGES)[number];

// ── Change Impact Assessment(§5 — worst-of, Impact ≠ Actual Outcome) ────

export interface ChangeImpactDimensionInput {
  dimension: string;
  magnitude: number | null;   // 0~100 (높을수록 영향 관측 큼) — Null 유지
}

export interface ChangeImpactAssessment {
  result: ChangeImpactResult;
  strongestMagnitude: number | null;
  strongestDimension: string | null;
  evaluatedDimensions: string[];
  unverifiedDimensions: string[];   // 제시되었으나 미측정(Null) — 정직 공개
  impactIsNotActualOutcome: true;
}

/** Change Impact — worst-of. 유효 3개 미만 insufficient_data,
 *  미측정 차원이 평가 차원보다 많으면 uncertain_candidate(과단정 방지). */
export function evaluateChangeImpact(dimensions: ChangeImpactDimensionInput[] | null | undefined): ChangeImpactAssessment {
  const known = (dimensions ?? []).filter((d) => (CHANGE_IMPACT_DIMENSIONS as readonly string[]).includes(d.dimension));
  const valid = known.filter((d) => isFiniteNumber(d.magnitude));
  const unverified = known.filter((d) => !isFiniteNumber(d.magnitude)).map((d) => d.dimension).sort((a, b) => a.localeCompare(b));
  const evaluated = valid.map((d) => d.dimension).sort((a, b) => a.localeCompare(b));
  if (valid.length < 3) {
    return { result: 'insufficient_data', strongestMagnitude: null, strongestDimension: null, evaluatedDimensions: evaluated, unverifiedDimensions: unverified, impactIsNotActualOutcome: true };
  }
  const strongest = [...valid].sort((a, b) => (clampScore(b.magnitude as number) - clampScore(a.magnitude as number)) || a.dimension.localeCompare(b.dimension))[0];
  const mag = clampScore(strongest.magnitude as number);
  if (unverified.length > valid.length) {
    return { result: 'uncertain_candidate', strongestMagnitude: mag, strongestDimension: strongest.dimension, evaluatedDimensions: evaluated, unverifiedDimensions: unverified, impactIsNotActualOutcome: true };
  }
  let result: ChangeImpactResult;
  if (mag >= 70) result = 'high_impact_candidate';
  else if (mag >= 40) result = 'moderate_impact_candidate';
  else result = 'low_impact_candidate';
  return { result, strongestMagnitude: mag, strongestDimension: strongest.dimension, evaluatedDimensions: evaluated, unverifiedDimensions: unverified, impactIsNotActualOutcome: true };
}

// ── Transformation Readiness(§6 — 평균, Readiness ≠ Success) ────────────

export interface ReadinessDimensionInput {
  dimension: string;
  score: number | null;   // 0~100 — Null 유지
}

export interface TransformationReadinessAssessment {
  result: TransformationReadinessResult;
  averageScore: number | null;
  weakestDimension: string | null;
  evaluatedDimensions: string[];
  missingDimensions: string[];
  readinessIsNotSuccessfulTransformation: true;
}

/** Readiness 평가 — 평균 기반. 유효 차원 3개 미만이면 insufficient_data. */
export function evaluateTransformationReadiness(dimensions: ReadinessDimensionInput[] | null | undefined): TransformationReadinessAssessment {
  const valid = (dimensions ?? []).filter(
    (d) => (TRANSFORMATION_READINESS_DIMENSIONS as readonly string[]).includes(d.dimension) && isFiniteNumber(d.score),
  );
  const evaluated = valid.map((d) => d.dimension).sort((a, b) => a.localeCompare(b));
  const missing = TRANSFORMATION_READINESS_DIMENSIONS.filter((d) => !evaluated.includes(d));
  if (valid.length < 3) {
    return { result: 'insufficient_data', averageScore: null, weakestDimension: null, evaluatedDimensions: evaluated, missingDimensions: [...missing], readinessIsNotSuccessfulTransformation: true };
  }
  const scores = valid.map((d) => clampScore(d.score as number));
  const avg = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
  const weakest = [...valid].sort((a, b) => (clampScore(a.score as number) - clampScore(b.score as number)) || a.dimension.localeCompare(b.dimension))[0];
  let result: TransformationReadinessResult;
  if (avg >= 80) result = 'highly_ready_candidate';
  else if (avg >= 60) result = 'mostly_ready_candidate';
  else if (avg >= 40) result = 'partially_ready_candidate';
  else result = 'not_ready_candidate';
  return { result, averageScore: avg, weakestDimension: weakest.dimension, evaluatedDimensions: evaluated, missingDimensions: [...missing], readinessIsNotSuccessfulTransformation: true };
}

// ── Stakeholder Analysis(§7 — Unknown 은 Unknown 으로 유지) ─────────────

export interface StakeholderInput {
  group: string;
  impactLevel: number | null;   // 0~100 — Null 이면 unknown_candidate
}

export interface StakeholderAssessment {
  group: string;
  result: StakeholderResult;
  impactLevel: number | null;
}

export interface StakeholderAnalysis {
  overall: StakeholderResult;
  assessments: StakeholderAssessment[];   // 영향 큰 순 결정적 정렬(unknown 은 후미)
  mostAffectedGroup: string | null;
  unknownGroups: string[];
  stakeholderIsNotPersonalEvaluation: true;
}

/** Stakeholder 분석 — 그룹별 판정, Null 은 unknown_candidate 유지(0 생성 금지).
 *  유효 그룹 2개 미만이면 overall insufficient_data. */
export function analyzeStakeholders(stakeholders: StakeholderInput[] | null | undefined): StakeholderAnalysis {
  const known = (stakeholders ?? []).filter((s) => (STAKEHOLDER_GROUPS as readonly string[]).includes(s.group));
  const assessments: StakeholderAssessment[] = known.map((s) => {
    if (!isFiniteNumber(s.impactLevel)) return { group: s.group, result: 'unknown_candidate', impactLevel: null };
    const lvl = clampScore(s.impactLevel as number);
    const result: StakeholderResult = lvl >= 70 ? 'highly_affected_candidate' : lvl >= 35 ? 'moderately_affected_candidate' : 'minimally_affected_candidate';
    return { group: s.group, result, impactLevel: lvl };
  });
  assessments.sort((a, b) => ((b.impactLevel ?? -1) - (a.impactLevel ?? -1)) || a.group.localeCompare(b.group));
  const measured = assessments.filter((a) => a.impactLevel !== null);
  const unknownGroups = assessments.filter((a) => a.impactLevel === null).map((a) => a.group).sort((a, b) => a.localeCompare(b));
  if (measured.length < 2) {
    return { overall: 'insufficient_data', assessments, mostAffectedGroup: null, unknownGroups, stakeholderIsNotPersonalEvaluation: true };
  }
  return {
    overall: measured[0].result,
    assessments,
    mostAffectedGroup: measured[0].group,
    unknownGroups,
    stakeholderIsNotPersonalEvaluation: true,
  };
}

// ── Transformation Priority(Priority ≠ Mandatory Order) ─────────────────

export interface TransformationCandidateInput {
  title: string;
  expectedValue: number | null;     // 0~100 — Null 이면 unverified 로 분리
  readinessScore: number | null;    // 0~100
  riskScore: number | null;         // 0~100 (높을수록 위험 관측 큼)
  evidenceCount: number;
}

export interface RankedTransformation {
  title: string;
  priorityScore: number;   // value + readiness − risk
}

export interface TransformationPriorityRanking {
  ranked: RankedTransformation[];
  unverifiedCandidates: string[];        // 측정 불충분 — 순위 미부여(정직 공개)
  excludedWithoutEvidence: string[];     // Evidence 0 — 후보 제외(정직 공개)
  priorityIsNotMandatoryOrder: true;
}

/** 변화 우선순위 — value + readiness − risk. Evidence 없는 후보 제외,
 *  미측정 후보는 순위 없이 공개. 동점은 제목순 결정적 정렬. */
export function rankTransformationPriority(candidates: TransformationCandidateInput[] | null | undefined): TransformationPriorityRanking {
  const excluded: string[] = [];
  const unverified: string[] = [];
  const ranked: RankedTransformation[] = [];
  for (const c of candidates ?? []) {
    if (!c.title || c.title.trim() === '') continue;
    if (!isFiniteNumber(c.evidenceCount) || c.evidenceCount <= 0) { excluded.push(c.title); continue; }
    if (!isFiniteNumber(c.expectedValue) || !isFiniteNumber(c.readinessScore) || !isFiniteNumber(c.riskScore)) { unverified.push(c.title); continue; }
    ranked.push({
      title: c.title,
      priorityScore: clampScore(c.expectedValue as number) + clampScore(c.readinessScore as number) - clampScore(c.riskScore as number),
    });
  }
  ranked.sort((a, b) => (b.priorityScore - a.priorityScore) || a.title.localeCompare(b.title));
  excluded.sort((a, b) => a.localeCompare(b));
  unverified.sort((a, b) => a.localeCompare(b));
  return { ranked, unverifiedCandidates: unverified, excludedWithoutEvidence: excluded, priorityIsNotMandatoryOrder: true };
}

// ── Executive Transformation Scorecard(§8 — Scorecard ≠ 개편 지시) ──────

export interface TransformationScorecardInput {
  criticalRisks: number;
  notReadyTransformations: number;
  highlyAffectedStakeholders: number;
  pendingHumanReviews: number;
}

export interface ExecutiveTransformationScorecard {
  fields: readonly string[];
  severityScore: number;
  attention: { area: string; count: number; weight: number }[];
  humanReviewRequired: true;
  scorecardIsNotReorganizationDirective: true;
}

/** Scorecard 심각도 — critical risk ×10 + not ready ×5 + 고영향 ×3 + 대기 리뷰. */
export function buildExecutiveTransformationScorecard(input: TransformationScorecardInput | null | undefined): ExecutiveTransformationScorecard {
  const n = (v: number | undefined) => (isFiniteNumber(v) && (v as number) > 0 ? Math.floor(v as number) : 0);
  const critical = n(input?.criticalRisks);
  const notReady = n(input?.notReadyTransformations);
  const affected = n(input?.highlyAffectedStakeholders);
  const pending = n(input?.pendingHumanReviews);
  const attention = [
    { area: 'critical_risks', count: critical, weight: 10 },
    { area: 'not_ready_transformations', count: notReady, weight: 5 },
    { area: 'highly_affected_stakeholders', count: affected, weight: 3 },
    { area: 'pending_human_reviews', count: pending, weight: 1 },
  ]
    .filter((a) => a.count > 0)
    .sort((a, b) => (b.count * b.weight - a.count * a.weight) || a.area.localeCompare(b.area));
  return {
    fields: TRANSFORMATION_SCORECARD_FIELDS,
    severityScore: critical * 10 + notReady * 5 + affected * 3 + pending,
    attention,
    humanReviewRequired: true,
    scorecardIsNotReorganizationDirective: true,
  };
}

// ── Review Workflow(§9 — Review ≠ Approval) ─────────────────────────────

export interface TransformationReviewInput {
  reviewType: string;
  createdBy: string | null;
  reviewerId: string | null;
  evidenceCount: number;
}

export interface TransformationReviewValidation {
  valid: boolean;
  reason: 'valid' | 'invalid_review_type' | 'self_review_blocked' | 'evidence_required' | 'reviewer_required';
  reviewIsNotApproval: true;
}

/** Review 검증 — 3종 외 차단, Self-Review 차단, Evidence 필수. */
export function validateTransformationReview(input: TransformationReviewInput | null | undefined): TransformationReviewValidation {
  const type = input?.reviewType ?? '';
  if (!(TRANSFORMATION_REVIEW_TYPES as readonly string[]).includes(type)) {
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

// ── Transformation Timeline(Vision → Audit — 13단계) ────────────────────

export interface TransformationTimelineEntry {
  stage: string;
  label?: string;
}

export interface TransformationTimeline {
  stages: { stage: TransformationFlowStage; entries: string[] }[];
  unknownStages: string[];   // 13단계 외 — 무시하지 않고 정직 공개
}

/** 타임라인 구성 — 13단계 순서 고정, 미지 단계는 별도 공개. */
export function buildTransformationTimeline(entries: TransformationTimelineEntry[] | null | undefined): TransformationTimeline {
  const unknown: string[] = [];
  const byStage = new Map<string, string[]>();
  for (const e of entries ?? []) {
    if (!(TRANSFORMATION_FLOW_STAGES as readonly string[]).includes(e.stage)) {
      if (e.stage && !unknown.includes(e.stage)) unknown.push(e.stage);
      continue;
    }
    const list = byStage.get(e.stage) ?? [];
    list.push(e.label ?? e.stage);
    byStage.set(e.stage, list);
  }
  unknown.sort((a, b) => a.localeCompare(b));
  return {
    stages: TRANSFORMATION_FLOW_STAGES.map((stage) => ({ stage, entries: byStage.get(stage) ?? [] })),
    unknownStages: unknown,
  };
}

// ── Support Matrix(정직 고지 — 48항목) ──────────────────────────────────

export type TransformationSupportLevel =
  | 'fully_supported'
  | 'partially_supported'
  | 'advisory_only'
  | 'human_review_only'
  | 'unavailable'
  | 'insufficient_data';

export interface TransformationSupportEntry {
  feature: string;
  level: TransformationSupportLevel;
  note: string;
}

export const ENTERPRISE_TRANSFORMATION_SUPPORT_MATRIX: readonly TransformationSupportEntry[] = [
  // 기록/감사 계층(서버 RPC 실존).
  { feature: 'transformation_candidate_record', level: 'fully_supported', note: '0560 admin_enterprise_transformation_create — 후보 기록만' },
  { feature: 'transformation_event_audit_log', level: 'fully_supported', note: '0560 이벤트 31종 append-only Audit' },
  { feature: 'transformation_review_request', level: 'fully_supported', note: '§9 3종 요청만 — Review ≠ Approval' },
  { feature: 'transformation_learning_record', level: 'fully_supported', note: 'Learning 기록 ≠ 자동 조직 변경' },
  { feature: 'transformation_timeline_record', level: 'fully_supported', note: 'JSONB transformation_history append — Forecast 확정 아님' },
  { feature: 'change_dependency_record', level: 'fully_supported', note: 'Dependency 기록 ≠ 자동 조정' },
  { feature: 'executive_transformation_summary_record', level: 'fully_supported', note: 'Summary ≠ 조직 변경 확정' },
  { feature: 'executive_transformation_scorecard_record', level: 'fully_supported', note: 'Scorecard ≠ 개편 지시' },
  { feature: 'change_recommendation_record', level: 'fully_supported', note: '23종 whitelist + Evidence 필수 — Recommendation ≠ Decision' },
  { feature: 'reference_linking', level: 'fully_supported', note: '0547/0549/0551/0552/0555/0556/0557/0558/0559 실존 검증 후 참조만' },
  // 분석 계층(설명/후보 제시만).
  { feature: 'change_impact_analysis', level: 'advisory_only', note: '§5 5차원 — Change Impact ≠ Actual Outcome' },
  { feature: 'transformation_readiness_assessment', level: 'advisory_only', note: '§6 — Readiness ≠ Successful Transformation' },
  { feature: 'stakeholder_analysis', level: 'advisory_only', note: '§7 — Unknown 은 Unknown 으로 유지, 개인 평가 아님' },
  { feature: 'organizational_evolution_analysis', level: 'advisory_only', note: 'Evolution ≠ Automatic Change' },
  { feature: 'change_dependency_analysis', level: 'advisory_only', note: '의존 관측 후보 — 자동 조정 없음' },
  { feature: 'transformation_priority_analysis', level: 'advisory_only', note: 'Priority ≠ Mandatory Order' },
  { feature: 'change_risk_analysis', level: 'advisory_only', note: 'Risk 관측 후보 ≠ 실패 확정' },
  { feature: 'resistance_analysis', level: 'advisory_only', note: '저항 관측 후보 — 개인/조직 판정 아님' },
  { feature: 'mission_alignment_analysis', level: 'advisory_only', note: 'Alignment 관측 ≠ Mission 변경' },
  { feature: 'change_recommendation_generation', level: 'advisory_only', note: 'Recommendation ≠ Decision' },
  { feature: 'executive_transformation_summary_generation', level: 'advisory_only', note: '설명 계층 — 조직 변경 확정 아님' },
  { feature: 'transformation_forecast_discussion', level: 'advisory_only', note: 'Forecast ≠ Future Fact' },
  { feature: 'phased_rollout_suggestion', level: 'advisory_only', note: '단계적 전환 후보 제안만 — 실행은 사람' },
  // 부분 지원(수동 기록 기반 — 자동 연동 아님).
  { feature: 'value_actuals_integration', level: 'partially_supported', note: '0559 value_realizations 수동 기록 기반 참조' },
  { feature: 'organization_actuals_integration', level: 'partially_supported', note: '0552 organization_models 수동 기록 기반 참조' },
  { feature: 'capacity_actuals_integration', level: 'partially_supported', note: '0558 capacity_resources 수동 기록 기반 참조' },
  { feature: 'environment_actuals_integration', level: 'partially_supported', note: '0556 environment_observations 수동 기록 기반 참조' },
  // 사람 전용 결정.
  { feature: 'reorganization_decision', level: 'human_review_only', note: '조직 개편은 사람' },
  { feature: 'personnel_change_decision', level: 'human_review_only', note: '인사 이동은 사람' },
  { feature: 'strategy_change_decision', level: 'human_review_only', note: 'Strategy 변경은 사람' },
  { feature: 'budget_change_decision', level: 'human_review_only', note: 'Budget 변경은 사람' },
  // 금지(스펙 — RPC 자체 없음).
  { feature: 'automatic_reorganization', level: 'unavailable', note: '금지 — 조직 자동 개편 없음' },
  { feature: 'automatic_personnel_transfer', level: 'unavailable', note: '금지 — 인사 자동 이동 없음' },
  { feature: 'automatic_strategy_change', level: 'unavailable', note: '금지 — 전략 자동 변경 없음' },
  { feature: 'automatic_budget_change', level: 'unavailable', note: '금지 — Budget 자동 변경 없음' },
  { feature: 'automatic_kpi_change', level: 'unavailable', note: '금지 — KPI 자동 변경 없음' },
  { feature: 'automatic_project_creation', level: 'unavailable', note: '금지 — Project 자동 생성 없음' },
  { feature: 'automatic_contract_change', level: 'unavailable', note: '금지 — 계약 자동 변경 없음' },
  { feature: 'automatic_production_change', level: 'unavailable', note: '금지 — Production 변경 없음' },
  { feature: 'automatic_merge', level: 'unavailable', note: '금지 — Merge 없음' },
  { feature: 'automatic_deploy', level: 'unavailable', note: '금지 — Deploy 없음' },
  { feature: 'automatic_rollback', level: 'unavailable', note: '금지 — Rollback 없음' },
  // 부재 피드(실측 — 원본 없음).
  { feature: 'hr_information_system', level: 'insufficient_data', note: 'HR 정보 시스템 부재(실측)' },
  { feature: 'employee_survey_feed', level: 'insufficient_data', note: '직원 설문 피드 부재(실측)' },
  { feature: 'change_management_tool_feed', level: 'insufficient_data', note: '변화관리 도구 피드 부재(실측)' },
  { feature: 'org_chart_system', level: 'insufficient_data', note: '조직도 시스템 부재(실측)' },
  { feature: 'training_platform_feed', level: 'insufficient_data', note: '교육 플랫폼 피드 부재(실측)' },
  { feature: 'culture_assessment_feed', level: 'insufficient_data', note: '문화 진단 피드 부재(실측)' },
] as const;
