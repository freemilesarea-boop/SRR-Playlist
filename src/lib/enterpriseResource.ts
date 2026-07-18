/**
 * enterpriseResource — Enterprise Resource Intelligence, Capacity Planning &
 * Constraint Optimization 순수 로직 (Phase AI-OPS-54).
 *
 * Enterprise Vision→Mission→Strategy→Scenario→Resource Inventory→Capacity
 * Planning→Constraint Detection→Dependency Analysis→Execution Readiness→
 * Optimization Candidates→Executive Resource Review→Resource Learning→Audit.
 *
 * 정직성: Capacity ≠ Guaranteed Delivery · Bottleneck ≠ Root Cause ·
 * Constraint ≠ Failure · Optimization ≠ Automatic Improvement ·
 * Recommendation ≠ Decision · Readiness ≠ Success · Pattern ≠ Causality ·
 * Null → 0 변환 금지. 전 함수 결정적(Deterministic)·순수(Pure)·Null-safe.
 * 자동 재배치 없음 — 사람이 자원을 배분하고 최종 결정을 내린다.
 * (0546 resourceAllocation/0529 resourceIntelligence 와 별개 계층)
 */
import { isFiniteNumber, clampScore } from './aiMemory';

/* ── 상수(SQL CHECK 1:1) ────────────────────────────────────────────────── */
export const RESOURCE_CATEGORIES = [
  'workforce', 'budget', 'infrastructure', 'technology', 'operations', 'ai',
  'project', 'portfolio', 'vendor', 'executive', 'enterprise', 'custom',
] as const;

export const RESOURCE_STATUSES = [
  'available', 'constrained', 'overloaded', 'underutilized',
  'review_reference', 'archived_reference', 'insufficient_data',
] as const;

export const CAPACITY_DIMENSIONS = [
  'workforce_capacity', 'budget_capacity', 'infrastructure_capacity', 'technology_capacity', 'operational_capacity',
] as const;
export const CAPACITY_RESULTS = [
  'sufficient_candidate', 'constrained_candidate', 'overloaded_candidate',
  'unavailable_candidate', 'insufficient_data',
] as const;
export type CapacityResult = (typeof CAPACITY_RESULTS)[number];

export const CONSTRAINT_DIMENSIONS = [
  'budget_constraint', 'workforce_constraint', 'technology_constraint', 'dependency_constraint', 'schedule_constraint',
] as const;
export const CONSTRAINT_RESULTS = [
  'critical_constraint_candidate', 'elevated_constraint_candidate', 'manageable_constraint_candidate',
  'negligible_constraint_candidate', 'insufficient_data',
] as const;
export type ConstraintResult = (typeof CONSTRAINT_RESULTS)[number];

export const READINESS_DIMENSIONS = [
  'resource_availability', 'capacity', 'dependencies', 'risk', 'organizational_readiness',
] as const;
export const READINESS_RESULTS = [
  'ready_candidate', 'mostly_ready_candidate', 'partially_ready_candidate',
  'not_ready_candidate', 'insufficient_data',
] as const;
export type ReadinessResult = (typeof READINESS_RESULTS)[number];

export const UTILIZATION_RESULTS = ['efficient_utilization_candidate', 'underutilized_candidate', 'overutilized_candidate', 'utilization_unverified', 'insufficient_data'] as const;
export type UtilizationResult = (typeof UTILIZATION_RESULTS)[number];
export const CAPACITY_WORKLOAD_RESULTS = ['balanced_workload_candidate', 'uneven_workload_candidate', 'overloaded_workload_candidate', 'workload_unverified', 'insufficient_data'] as const;
export const CAPACITY_BOTTLENECK_RESULTS = ['no_material_bottleneck_candidate', 'resource_bottleneck_candidate', 'dependency_bottleneck_candidate', 'schedule_bottleneck_candidate', 'bottleneck_unverified', 'insufficient_data'] as const;
export type CapacityBottleneckResult = (typeof CAPACITY_BOTTLENECK_RESULTS)[number];

export const RESOURCE_REVIEW_TYPES = ['resource_review', 'executive_review', 'human_review'] as const;
export const CAPACITY_REVIEW_STATUSES = ['requested', 'in_review', 'review_reference_recorded', 'revision_requested', 'insufficient_data'] as const;

export const RESOURCE_RECOMMENDATION_TYPES = [
  'create_capacity_resource', 'review_resource_inventory', 'review_capacity_assessment',
  'review_constraint_analysis', 'record_dependency_mapping', 'review_resource_utilization',
  'review_workload_analysis', 'review_budget_capacity', 'review_execution_readiness',
  'review_bottleneck_detection', 'record_optimization_candidate', 'record_capacity_timeline',
  'build_executive_resource_summary', 'build_executive_resource_scorecard',
  'request_resource_review', 'request_executive_review', 'request_human_review',
  'record_resource_learning', 'link_scenario_reference', 'link_program_reference',
  'link_inventory_reference', 'gather_more_evidence_candidate', 'insufficient_data',
] as const;

/* §8 Executive Resource Scorecard 포함 필드 */
export const RESOURCE_SCORECARD_FIELDS = [
  'capacity', 'constraints', 'resource_utilization', 'execution_readiness',
  'bottlenecks', 'optimization_candidates', 'executive_summary', 'human_review',
] as const;

/* ── Capacity Assessment(§5 — worst-of 여유율, Capacity ≠ 보장) ─────────── */
export function evaluateCapacityAssessment(dimensions: { dimension: string; headroomScore: number | null }[] | null): {
  result: CapacityResult; worstDimension: string | null; worstHeadroom: number | null;
  assessedDimensions: number; capacityIsNotGuaranteedDelivery: true;
} {
  const list = Array.isArray(dimensions) ? dimensions : [];
  const valid = list.filter((d) => (CAPACITY_DIMENSIONS as readonly string[]).includes(d.dimension) && isFiniteNumber(d.headroomScore));
  // 5평가 중 3개 미만 → insufficient_data(Null → 0 변환 금지).
  if (valid.length < 3) {
    return { result: 'insufficient_data', worstDimension: null, worstHeadroom: null, assessedDimensions: valid.length, capacityIsNotGuaranteedDelivery: true };
  }
  let worst = valid[0];
  for (const d of valid) { if ((d.headroomScore as number) < (worst.headroomScore as number)) worst = d; }
  const h = clampScore(worst.headroomScore as number);
  const result: CapacityResult = h >= 60 ? 'sufficient_candidate'
    : h >= 35 ? 'constrained_candidate'
    : h >= 10 ? 'overloaded_candidate'
    : 'unavailable_candidate';
  return { result, worstDimension: worst.dimension, worstHeadroom: h, assessedDimensions: valid.length, capacityIsNotGuaranteedDelivery: true };
}

/* ── Constraint Analysis(§6 — worst-of, Constraint ≠ Failure) ───────────── */
export function analyzeConstraints(dimensions: { dimension: string; severity: number | null }[] | null): {
  result: ConstraintResult; worstDimension: string | null; worstSeverity: number | null;
  assessedDimensions: number; constraintIsNotFailure: true;
} {
  const list = Array.isArray(dimensions) ? dimensions : [];
  const valid = list.filter((d) => (CONSTRAINT_DIMENSIONS as readonly string[]).includes(d.dimension) && isFiniteNumber(d.severity));
  if (valid.length < 2) {
    return { result: 'insufficient_data', worstDimension: null, worstSeverity: null, assessedDimensions: valid.length, constraintIsNotFailure: true };
  }
  let worst = valid[0];
  for (const d of valid) { if ((d.severity as number) > (worst.severity as number)) worst = d; }
  const s = clampScore(worst.severity as number);
  const result: ConstraintResult = s >= 70 ? 'critical_constraint_candidate'
    : s >= 40 ? 'elevated_constraint_candidate'
    : s >= 15 ? 'manageable_constraint_candidate'
    : 'negligible_constraint_candidate';
  return { result, worstDimension: worst.dimension, worstSeverity: s, assessedDimensions: valid.length, constraintIsNotFailure: true };
}

/* ── Execution Readiness(§7 — 5평가 평균, Readiness ≠ Success) ──────────── */
export function evaluateExecutionReadiness(dimensions: { dimension: string; score: number | null }[] | null): {
  result: ReadinessResult; readinessScore: number | null; weakestDimension: string | null;
  assessedDimensions: number; readinessIsNotSuccess: true;
} {
  const list = Array.isArray(dimensions) ? dimensions : [];
  const valid = list.filter((d) => (READINESS_DIMENSIONS as readonly string[]).includes(d.dimension) && isFiniteNumber(d.score));
  if (valid.length < 3) {
    return { result: 'insufficient_data', readinessScore: null, weakestDimension: null, assessedDimensions: valid.length, readinessIsNotSuccess: true };
  }
  let weakest = valid[0];
  for (const d of valid) { if ((d.score as number) < (weakest.score as number)) weakest = d; }
  const score = clampScore(valid.reduce((s, d) => s + (d.score as number), 0) / valid.length);
  const result: ReadinessResult = score >= 80 ? 'ready_candidate'
    : score >= 60 ? 'mostly_ready_candidate'
    : score >= 40 ? 'partially_ready_candidate'
    : 'not_ready_candidate';
  return { result, readinessScore: score, weakestDimension: weakest.dimension, assessedDimensions: valid.length, readinessIsNotSuccess: true };
}

/* ── Bottleneck Detection(부하/의존 — Bottleneck ≠ Root Cause) ──────────── */
export function detectBottlenecks(items: { itemCode: string; queueLoad: number | null; dependencyCount: number | null }[] | null, loadThreshold = 75, dependencyThreshold = 5): {
  result: CapacityBottleneckResult; loadBottlenecks: string[]; dependencyBottlenecks: string[];
  unverifiedItems: number; bottleneckIsNotRootCause: true;
} {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    return { result: 'insufficient_data', loadBottlenecks: [], dependencyBottlenecks: [], unverifiedItems: 0, bottleneckIsNotRootCause: true };
  }
  const measured = list.filter((i) => isFiniteNumber(i.queueLoad) || isFiniteNumber(i.dependencyCount));
  const unverifiedItems = list.length - measured.length;
  if (!measured.length) {
    return { result: 'bottleneck_unverified', loadBottlenecks: [], dependencyBottlenecks: [], unverifiedItems, bottleneckIsNotRootCause: true };
  }
  const loadBottlenecks = measured.filter((i) => isFiniteNumber(i.queueLoad) && (i.queueLoad as number) >= loadThreshold).map((i) => i.itemCode).sort((a, b) => a.localeCompare(b));
  const dependencyBottlenecks = measured.filter((i) => isFiniteNumber(i.dependencyCount) && (i.dependencyCount as number) >= dependencyThreshold).map((i) => i.itemCode).sort((a, b) => a.localeCompare(b));
  const result: CapacityBottleneckResult = loadBottlenecks.length === 0 && dependencyBottlenecks.length === 0 ? 'no_material_bottleneck_candidate'
    : loadBottlenecks.length >= dependencyBottlenecks.length && loadBottlenecks.length > 0 ? 'resource_bottleneck_candidate'
    : 'dependency_bottleneck_candidate';
  return { result, loadBottlenecks, dependencyBottlenecks, unverifiedItems, bottleneckIsNotRootCause: true };
}

/* ── Resource Utilization(유휴/과부하 — Utilization ≠ 생산성 평가) ──────── */
export function analyzeUtilization(resources: { resourceCode: string; utilizationPct: number | null }[] | null, idleThreshold = 20, overloadThreshold = 85): {
  result: UtilizationResult; idleResources: string[]; overloadedResources: string[];
  unverifiedResources: number; utilizationIsNotProductivity: true;
} {
  const list = Array.isArray(resources) ? resources : [];
  if (!list.length) {
    return { result: 'insufficient_data', idleResources: [], overloadedResources: [], unverifiedResources: 0, utilizationIsNotProductivity: true };
  }
  const measured = list.filter((r) => isFiniteNumber(r.utilizationPct));
  const unverifiedResources = list.length - measured.length;
  if (!measured.length) {
    return { result: 'utilization_unverified', idleResources: [], overloadedResources: [], unverifiedResources, utilizationIsNotProductivity: true };
  }
  const idleResources = measured.filter((r) => (r.utilizationPct as number) < idleThreshold).map((r) => r.resourceCode).sort((a, b) => a.localeCompare(b));
  const overloadedResources = measured.filter((r) => (r.utilizationPct as number) > overloadThreshold).map((r) => r.resourceCode).sort((a, b) => a.localeCompare(b));
  const result: UtilizationResult = overloadedResources.length > 0 ? 'overutilized_candidate'
    : idleResources.length > 0 ? 'underutilized_candidate'
    : 'efficient_utilization_candidate';
  return { result, idleResources, overloadedResources, unverifiedResources, utilizationIsNotProductivity: true };
}

/* ── Executive Resource Scorecard(§8 — 결정적 우선순위 정렬) ────────────── */
export interface ResourceScorecardEntryInput {
  resourceCode: string; category: string; capacity: CapacityResult;
  constraint: ConstraintResult; readiness: ReadinessResult; bottleneckPresent: boolean; humanReviewPresent: boolean;
}
export function buildExecutiveResourceScorecard(entries: ResourceScorecardEntryInput[] | null, topN = 5): {
  priorityRows: ResourceScorecardEntryInput[]; fields: readonly string[]; scorecardIsNotReallocation: true; orderingIsDeterministic: true;
} {
  const severity = (e: ResourceScorecardEntryInput): number => {
    const c = e.capacity === 'unavailable_candidate' ? 3 : e.capacity === 'overloaded_candidate' ? 2 : 0;
    const k = e.constraint === 'critical_constraint_candidate' ? 3 : e.constraint === 'elevated_constraint_candidate' ? 2 : 0;
    const r = e.readiness === 'not_ready_candidate' ? 3 : e.readiness === 'partially_ready_candidate' ? 1 : 0;
    const b = e.bottleneckPresent ? 1 : 0;
    return c * 10 + k * 5 + r * 3 + b;
  };
  const sorted = (Array.isArray(entries) ? [...entries] : [])
    .sort((a, b) => severity(b) - severity(a) || a.resourceCode.localeCompare(b.resourceCode));
  return { priorityRows: sorted.slice(0, Math.max(0, topN)), fields: RESOURCE_SCORECARD_FIELDS, scorecardIsNotReallocation: true, orderingIsDeterministic: true };
}

/* ── Resource Review 검증(§9 — Self 차단·Evidence 필수) ─────────────────── */
export function validateResourceReview(input: { action: string; evidenceCount: number | null; isSelfReview: boolean }): {
  allowed: boolean; blockedReasons: string[]; reviewIsNotApproval: true; resourceChangeIsHuman: true;
} {
  const blockedReasons: string[] = [];
  if (input.action === 'record_review_reference') {
    if (input.isSelfReview) blockedReasons.push('Self-Review 차단(작성자 ≠ 평가자)');
    if (!isFiniteNumber(input.evidenceCount) || input.evidenceCount <= 0) blockedReasons.push('Evidence 없는 Capacity Review Reference 금지');
  }
  return { allowed: blockedReasons.length === 0, blockedReasons, reviewIsNotApproval: true, resourceChangeIsHuman: true };
}

/* ── Resource 흐름 타임라인(관측 여부 표시 — 자동 진행 아님) ────────────── */
export const RESOURCE_FLOW_STAGES = [
  'enterprise_vision', 'mission', 'strategy', 'scenario', 'resource_inventory',
  'capacity_planning', 'constraint_detection', 'dependency_analysis', 'execution_readiness',
  'optimization_candidates', 'executive_resource_review', 'resource_learning',
] as const;
export function buildResourceTimeline(input: { present: Partial<Record<(typeof RESOURCE_FLOW_STAGES)[number], boolean>> }): {
  stage: (typeof RESOURCE_FLOW_STAGES)[number]; present: boolean;
}[] {
  return RESOURCE_FLOW_STAGES.map((stage) => ({ stage, present: input.present[stage] === true }));
}

/* ── 컴포넌트/Support Matrix ────────────────────────────────────────────── */
export const ENTERPRISE_RESOURCE_COMPONENTS = [
  'capacity_resource_registry', 'capacity_review_registry', 'capacity_assessment_analysis',
  'constraint_analysis', 'dependency_mapping', 'utilization_analysis',
  'execution_readiness_analysis', 'bottleneck_detection', 'executive_resource_scorecard',
  'capacity_event_audit',
] as const;

export type ResourceSupportLevel = 'fully_supported' | 'partially_supported' | 'advisory_only' | 'human_review_only' | 'unavailable' | 'insufficient_data';
export const ENTERPRISE_RESOURCE_SUPPORT_MATRIX: { capability: string; support: ResourceSupportLevel }[] = [
  { capability: 'capacity_resource_structuring', support: 'fully_supported' },
  { capability: 'resource_category_12_domains', support: 'fully_supported' },
  { capability: 'resource_inventory_review', support: 'fully_supported' },
  { capability: 'capacity_assessment_5_dimensions', support: 'fully_supported' },
  { capability: 'constraint_analysis_5_dimensions', support: 'fully_supported' },
  { capability: 'dependency_mapping_jsonb', support: 'fully_supported' },
  { capability: 'resource_utilization_candidate', support: 'fully_supported' },
  { capability: 'workload_analysis_candidate', support: 'advisory_only' },
  { capability: 'budget_capacity_candidate', support: 'advisory_only' },
  { capability: 'execution_readiness_5_dimensions', support: 'fully_supported' },
  { capability: 'bottleneck_detection_candidate', support: 'fully_supported' },
  { capability: 'optimization_candidate_with_evidence', support: 'advisory_only' },
  { capability: 'capacity_timeline_recording', support: 'fully_supported' },
  { capability: 'executive_resource_summary_candidate', support: 'advisory_only' },
  { capability: 'executive_resource_scorecard_candidate', support: 'advisory_only' },
  { capability: 'resource_recommendation_with_evidence', support: 'advisory_only' },
  { capability: 'resource_review_request', support: 'human_review_only' },
  { capability: 'executive_review_request', support: 'human_review_only' },
  { capability: 'human_review_request', support: 'human_review_only' },
  { capability: 'capacity_review_reference_no_self_review', support: 'human_review_only' },
  { capability: 'resource_change_human_only', support: 'human_review_only' },
  { capability: 'resource_learning_recording', support: 'fully_supported' },
  { capability: 'scenario_reference_link_0557', support: 'partially_supported' },
  { capability: 'program_reference_link_0547', support: 'partially_supported' },
  { capability: 'organization_reference_link_0552', support: 'partially_supported' },
  { capability: 'portfolio_reference_link_0545', support: 'partially_supported' },
  { capability: 'mission_reference_link_0555', support: 'partially_supported' },
  { capability: 'commitment_reference_link_0520', support: 'partially_supported' },
  { capability: 'inventory_reference_link_0546', support: 'partially_supported' },
  { capability: 'capacity_event_audit_trail', support: 'fully_supported' },
  { capability: 'hr_capacity_system', support: 'insufficient_data' },
  { capability: 'time_tracking_feed', support: 'insufficient_data' },
  { capability: 'erp_finance_ledger', support: 'insufficient_data' },
  { capability: 'resource_booking_system', support: 'insufficient_data' },
  { capability: 'project_management_tool_feed', support: 'insufficient_data' },
  { capability: 'cloud_cost_feed', support: 'insufficient_data' },
  { capability: 'automatic_resource_reallocation', support: 'unavailable' },
  { capability: 'automatic_personnel_transfer', support: 'unavailable' },
  { capability: 'automatic_budget_change', support: 'unavailable' },
  { capability: 'automatic_project_start', support: 'unavailable' },
  { capability: 'automatic_project_termination', support: 'unavailable' },
  { capability: 'automatic_contract_signing', support: 'unavailable' },
  { capability: 'automatic_contract_termination', support: 'unavailable' },
  { capability: 'automatic_organization_change', support: 'unavailable' },
  { capability: 'automatic_production_change', support: 'unavailable' },
  { capability: 'automatic_merge', support: 'unavailable' },
  { capability: 'automatic_deploy', support: 'unavailable' },
  { capability: 'automatic_rollback', support: 'unavailable' },
];
