/**
 * executionIntelligence — Enterprise Execution Intelligence, Program Management &
 * Initiative Delivery 순수 로직 (Phase AI-OPS-43).
 *
 * Strategic Portfolio→Execution Program→Execution Plan(Wave)→Initiative Delivery→
 * Milestone Tracking→Dependency→Critical Path→Health→Risk→Planned/Actual/Forecast
 * Progress→Drift→Velocity/Stability→Delay Root Cause→Bottleneck→Delivery Forecast→
 * Quality→Recommendation→Human Delivery Review→Approval Reference→Outcome→Learning.
 *
 * 정직성: Plan ≠ Execution · Progress Candidate ≠ Actual Completion ·
 * Milestone Candidate ≠ Completed Milestone · Forecast ≠ Future Fact ·
 * Delay Candidate ≠ Confirmed Delay · Root Cause Candidate ≠ Proven Cause ·
 * Velocity ≠ Productivity · Health ≠ Guaranteed Success · Stable ≠ Risk Free.
 * 전 함수 결정적(Deterministic)·Null-safe·Date 주입. 자동 실행/완료/승인 없음.
 */
import { isFiniteNumber, clampScore } from './aiMemory';

/* ── 상수(SQL CHECK 1:1) ────────────────────────────────────────────────── */
export const EXECUTION_PROGRAM_TYPES = [
  'initiative_delivery_program', 'platform_program', 'operations_program', 'content_program',
  'music_quality_program', 'playlist_operations_program', 'store_operations_program',
  'connector_program', 'automation_reference_program', 'compliance_program',
  'infrastructure_reference_program', 'custom_reference',
] as const;

export const EXECUTION_STATUSES = [
  'draft', 'pending_review', 'planned', 'ready_candidate', 'executing_reference',
  'delayed_candidate', 'blocked_candidate', 'partially_completed_candidate',
  'completed_reference', 'cancelled_reference', 'insufficient_data',
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const DELIVERY_HEALTH_LEVELS = ['excellent', 'healthy', 'watch', 'degraded', 'critical', 'insufficient_data'] as const;
export type DeliveryHealthLevel = (typeof DELIVERY_HEALTH_LEVELS)[number];

export const DELIVERY_RISK_LEVELS = ['low', 'moderate', 'high', 'critical', 'insufficient_data'] as const;
export type DeliveryRiskLevel = (typeof DELIVERY_RISK_LEVELS)[number];

export const EXECUTION_RISK_DIMENSIONS = [
  'schedule_risk', 'resource_risk', 'dependency_risk', 'provider_risk',
  'approval_risk', 'technical_risk', 'operational_risk', 'external_risk',
] as const;

export const PROGRESS_DRIFT_LEVELS = ['on_track', 'minor_drift_candidate', 'major_drift_candidate', 'severe_drift_candidate', 'insufficient_data'] as const;
export type ProgressDriftLevel = (typeof PROGRESS_DRIFT_LEVELS)[number];

export const DELIVERY_QUALITY_LEVELS = ['excellent', 'acceptable', 'degraded', 'poor', 'insufficient_data'] as const;
export type DeliveryQualityLevel = (typeof DELIVERY_QUALITY_LEVELS)[number];

export const MILESTONE_STATUSES = [
  'proposed_candidate', 'planned_candidate', 'in_progress_reference', 'at_risk_candidate',
  'delayed_candidate', 'completed_reference', 'cancelled_reference', 'insufficient_data',
] as const;

export const EXECUTION_TIMELINE_RESULTS = ['timeline_ready_candidate', 'timeline_partial_candidate', 'timeline_conflict_candidate', 'timeline_unverified', 'insufficient_data'] as const;
export const MILESTONE_PROGRESS_RESULTS = ['milestone_on_track_candidate', 'milestone_at_risk_candidate', 'milestone_delayed_candidate', 'milestone_blocked_candidate', 'milestone_progress_unverified', 'insufficient_data'] as const;
export const EXECUTION_DEPENDENCY_RESULTS = ['no_material_dependency_risk_candidate', 'upstream_dependency_candidate', 'cross_program_dependency_candidate', 'circular_dependency_candidate', 'blocking_dependency_candidate', 'external_dependency_candidate', 'dependency_unverified', 'insufficient_data'] as const;
export const CRITICAL_PATH_RESULTS = ['critical_path_identified_candidate', 'critical_path_shift_candidate', 'no_critical_path_candidate', 'critical_path_unverified', 'insufficient_data'] as const;
export const SCHEDULE_DRIFT_RESULTS = ['no_material_schedule_drift_candidate', 'minor_schedule_drift_candidate', 'major_schedule_drift_candidate', 'severe_schedule_drift_candidate', 'schedule_drift_unverified', 'insufficient_data'] as const;
export const VELOCITY_RESULTS = ['stable_velocity_candidate', 'improving_velocity_candidate', 'declining_velocity_candidate', 'volatile_velocity_candidate', 'velocity_unverified', 'insufficient_data'] as const;
export const STABILITY_RESULTS = ['stable_execution_candidate', 'moderately_stable_candidate', 'unstable_execution_candidate', 'stability_unverified', 'insufficient_data'] as const;
export const DELAY_RESULTS = ['no_delay_candidate', 'minor_delay_candidate', 'major_delay_candidate', 'severe_delay_candidate', 'delay_unverified', 'insufficient_data'] as const;
export const DELAY_ROOT_CAUSE_CATEGORIES = ['dependency_cause_candidate', 'resource_cause_candidate', 'approval_cause_candidate', 'scope_cause_candidate', 'technical_cause_candidate', 'provider_cause_candidate', 'external_cause_candidate', 'unknown_cause', 'insufficient_data'] as const;
export const BOTTLENECK_RESULTS = ['no_material_bottleneck_candidate', 'review_bottleneck_candidate', 'approval_bottleneck_candidate', 'resource_bottleneck_candidate', 'dependency_bottleneck_candidate', 'technical_bottleneck_candidate', 'bottleneck_unverified', 'insufficient_data'] as const;
export const DELIVERY_FORECAST_RESULTS = ['on_schedule_forecast_candidate', 'at_risk_forecast_candidate', 'delayed_forecast_candidate', 'highly_uncertain_forecast_candidate', 'forecast_unverified', 'insufficient_data'] as const;
export const DELIVERY_RECOMMENDATION_TYPES = [
  'create_execution_program', 'create_execution_plan', 'review_execution_timeline',
  'record_milestone_candidate', 'review_milestone_progress', 'review_execution_dependency',
  'review_critical_path', 'review_execution_health', 'review_execution_risk',
  'record_planned_progress', 'request_actual_progress_evidence', 'review_progress_drift',
  'review_schedule_drift', 'review_velocity', 'review_stability', 'record_delay_candidate',
  'review_delay_root_cause', 'review_bottleneck', 'review_delivery_forecast',
  'review_execution_quality', 'request_delivery_review', 'request_executive_review',
  'request_resource_review', 'record_delivery_approval_reference', 'link_execution_reference',
  'link_delivery_outcome', 'record_execution_learning_reference', 'gather_more_evidence_candidate',
  'insufficient_data',
] as const;

/* ── Planned Progress Candidate(경과 기반 — Planned ≠ Actual) ───────────── */
export function calculatePlannedProgressCandidate(plannedStartMs: number | null, plannedEndMs: number | null, nowMs: number | null): {
  plannedProgressCandidate: number | null; insufficientData: boolean; plannedIsNotActual: true;
} {
  if (!isFiniteNumber(plannedStartMs) || !isFiniteNumber(plannedEndMs) || !isFiniteNumber(nowMs) || plannedEndMs <= plannedStartMs) {
    return { plannedProgressCandidate: null, insufficientData: true, plannedIsNotActual: true };
  }
  const ratio = ((nowMs - plannedStartMs) / (plannedEndMs - plannedStartMs)) * 100;
  return { plannedProgressCandidate: clampScore(ratio), insufficientData: false, plannedIsNotActual: true };
}

/* ── Progress Drift(Planned vs Actual — Drift Candidate ≠ Confirmed Delay) ─ */
export function evaluateProgressDrift(plannedProgress: number | null, actualProgress: number | null): {
  driftPoints: number | null; level: ProgressDriftLevel; driftIsNotConfirmedDelay: true;
} {
  if (!isFiniteNumber(plannedProgress) || !isFiniteNumber(actualProgress)) {
    return { driftPoints: null, level: 'insufficient_data', driftIsNotConfirmedDelay: true };
  }
  const drift = clampScore(plannedProgress) - clampScore(actualProgress);
  const abs = Math.abs(drift);
  const level: ProgressDriftLevel = abs < 5 ? 'on_track' : abs < 15 ? 'minor_drift_candidate' : abs < 30 ? 'major_drift_candidate' : 'severe_drift_candidate';
  return { driftPoints: drift, level, driftIsNotConfirmedDelay: true };
}

/* ── Execution Dependency 순환 탐지(DFS — 자동 차단/해제 없음) ──────────── */
export interface ExecutionDependencyNode { id: string; dependsOn: string[] }
export function detectExecutionDependencyCycles(nodes: ExecutionDependencyNode[]): {
  cycles: string[][]; hasCycle: boolean; autoResolutionApplied: false;
} {
  const graph = new Map<string, string[]>();
  for (const n of nodes) graph.set(n.id, Array.isArray(n.dependsOn) ? n.dependsOn : []);
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const walk = (id: string, stack: string[]) => {
    const idx = stack.indexOf(id);
    if (idx >= 0) { cycles.push(stack.slice(idx).concat(id)); return; }
    if (visited.has(id)) return;
    visited.add(id);
    for (const dep of graph.get(id) ?? []) {
      if (graph.has(dep)) walk(dep, stack.concat(id));
    }
  };
  for (const n of nodes) walk(n.id, []);
  return { cycles, hasCycle: cycles.length > 0, autoResolutionApplied: false };
}

/* ── Delay Candidate(Delay Candidate ≠ Confirmed Delay) ────────────────── */
export function evaluateDelayCandidate(plannedEndMs: number | null, nowMs: number | null, completedWithEvidence: boolean): {
  delayDaysCandidate: number | null; result: (typeof DELAY_RESULTS)[number]; confirmedDelay: false;
} {
  if (!isFiniteNumber(plannedEndMs) || !isFiniteNumber(nowMs)) {
    return { delayDaysCandidate: null, result: 'insufficient_data', confirmedDelay: false };
  }
  if (completedWithEvidence || nowMs <= plannedEndMs) {
    return { delayDaysCandidate: 0, result: 'no_delay_candidate', confirmedDelay: false };
  }
  const days = Math.floor((nowMs - plannedEndMs) / 86_400_000);
  const result = days < 7 ? 'minor_delay_candidate' as const : days < 30 ? 'major_delay_candidate' as const : 'severe_delay_candidate' as const;
  return { delayDaysCandidate: days, result, confirmedDelay: false };
}

/* ── Delivery Health(Health ≠ Guaranteed Success) ──────────────────────── */
export function evaluateDeliveryHealth(input: { driftLevel: ProgressDriftLevel | null; riskLevel: DeliveryRiskLevel | null; blockedCount: number | null }): {
  level: DeliveryHealthLevel; guaranteedSuccess: false;
} {
  const { driftLevel, riskLevel, blockedCount } = input;
  if (driftLevel == null || riskLevel == null || driftLevel === 'insufficient_data' || riskLevel === 'insufficient_data') {
    return { level: 'insufficient_data', guaranteedSuccess: false };
  }
  const blocked = isFiniteNumber(blockedCount) ? blockedCount : 0;
  if (riskLevel === 'critical' || driftLevel === 'severe_drift_candidate') return { level: 'critical', guaranteedSuccess: false };
  if (riskLevel === 'high' || driftLevel === 'major_drift_candidate' || blocked >= 3) return { level: 'degraded', guaranteedSuccess: false };
  if (riskLevel === 'moderate' || driftLevel === 'minor_drift_candidate' || blocked >= 1) return { level: 'watch', guaranteedSuccess: false };
  if (driftLevel === 'on_track' && riskLevel === 'low' && blocked === 0) return { level: 'excellent', guaranteedSuccess: false };
  return { level: 'healthy', guaranteedSuccess: false };
}

/* ── Delivery Risk(worst-of — 목록 밖 위험은 평가되지 않음) ────────────── */
export function evaluateDeliveryRisk(dimensions: { dimension: string; level: DeliveryRiskLevel }[]): {
  overall: DeliveryRiskLevel; assessedDimensions: number; riskListIsExhaustive: false;
} {
  const order: DeliveryRiskLevel[] = ['low', 'moderate', 'high', 'critical'];
  const assessed = dimensions.filter((d) => order.includes(d.level));
  if (!assessed.length) return { overall: 'insufficient_data', assessedDimensions: 0, riskListIsExhaustive: false };
  let worst: DeliveryRiskLevel = 'low';
  for (const d of assessed) {
    if (order.indexOf(d.level) > order.indexOf(worst)) worst = d.level;
  }
  return { overall: worst, assessedDimensions: assessed.length, riskListIsExhaustive: false };
}

/* ── Delivery Quality(Quality ≠ Verified Quality) ──────────────────────── */
export function evaluateDeliveryQuality(input: { milestonesCompletedWithEvidence: number | null; milestonesTotal: number | null; regressionCount: number | null; rollbackCount: number | null; outcomeLinked: boolean }): {
  level: DeliveryQualityLevel; verifiedQuality: false; causalityEstablished: false;
} {
  const done = input.milestonesCompletedWithEvidence;
  const total = input.milestonesTotal;
  if (!isFiniteNumber(done) || !isFiniteNumber(total) || total <= 0) {
    return { level: 'insufficient_data', verifiedQuality: false, causalityEstablished: false };
  }
  const regressions = isFiniteNumber(input.regressionCount) ? input.regressionCount : 0;
  const rollbacks = isFiniteNumber(input.rollbackCount) ? input.rollbackCount : 0;
  const ratio = done / total;
  let level: DeliveryQualityLevel;
  if (regressions + rollbacks >= 3 || ratio < 0.25) level = 'poor';
  else if (regressions + rollbacks >= 1 || ratio < 0.5) level = 'degraded';
  else if (ratio < 0.9 || !input.outcomeLinked) level = 'acceptable';
  else level = 'excellent';
  return { level, verifiedQuality: false, causalityEstablished: false };
}

/* ── Velocity Candidate(Velocity ≠ Productivity) ───────────────────────── */
export function calculateVelocityCandidate(completedWithEvidenceCount: number | null, windowDays: number | null): {
  milestonesPerWeekCandidate: number | null; insufficientData: boolean; velocityIsNotProductivity: true;
} {
  if (!isFiniteNumber(completedWithEvidenceCount) || !isFiniteNumber(windowDays) || windowDays <= 0 || completedWithEvidenceCount < 0) {
    return { milestonesPerWeekCandidate: null, insufficientData: true, velocityIsNotProductivity: true };
  }
  const perWeek = (completedWithEvidenceCount / windowDays) * 7;
  return { milestonesPerWeekCandidate: Math.round(perWeek * 100) / 100, insufficientData: false, velocityIsNotProductivity: true };
}

/* ── Delivery Forecast Candidate(Forecast ≠ Future Fact) ───────────────── */
export function buildDeliveryForecastCandidate(actualProgress: number | null, velocityPerWeek: number | null, remainingWeeks: number | null, milestonesTotal: number | null): {
  forecastProgressCandidate: number | null; result: (typeof DELIVERY_FORECAST_RESULTS)[number]; forecastIsNotFutureFact: true;
} {
  if (!isFiniteNumber(actualProgress) || !isFiniteNumber(velocityPerWeek) || !isFiniteNumber(remainingWeeks) || !isFiniteNumber(milestonesTotal) || milestonesTotal <= 0 || remainingWeeks < 0) {
    return { forecastProgressCandidate: null, result: 'insufficient_data', forecastIsNotFutureFact: true };
  }
  const additional = (velocityPerWeek * remainingWeeks / milestonesTotal) * 100;
  const forecast = clampScore(clampScore(actualProgress) + additional);
  const result = forecast >= 95 ? 'on_schedule_forecast_candidate' as const
    : forecast >= 70 ? 'at_risk_forecast_candidate' as const
    : 'delayed_forecast_candidate' as const;
  return { forecastProgressCandidate: forecast, result, forecastIsNotFutureFact: true };
}

/* ── Delay Root Cause Candidate(Root Cause Candidate ≠ Proven Cause) ───── */
export function evaluateDelayRootCauseCandidate(signals: { category: string; weight: number }[]): {
  topCategory: string; provenCause: false; insufficientData: boolean;
} {
  const valid = signals.filter((s) => (DELAY_ROOT_CAUSE_CATEGORIES as readonly string[]).includes(s.category) && isFiniteNumber(s.weight) && s.weight > 0);
  if (!valid.length) return { topCategory: 'insufficient_data', provenCause: false, insufficientData: true };
  let top = valid[0];
  for (const s of valid) { if (s.weight > top.weight) top = s; }
  return { topCategory: top.category, provenCause: false, insufficientData: false };
}

/* ── Human Delivery Review 검증(Self-Approval 차단·Evidence 필수) ──────── */
export function validateDeliveryReview(input: { action: string; evidenceCount: number | null; isSelfApproval: boolean }): {
  allowed: boolean; blockedReasons: string[]; humanDecisionRequired: true;
} {
  const blockedReasons: string[] = [];
  const approveActions = ['approve_delivery_reference', 'approve_with_conditions_reference'];
  if (approveActions.includes(input.action)) {
    if (input.isSelfApproval) blockedReasons.push('Self-Approval 차단(작성자 ≠ 승인자)');
    if (!isFiniteNumber(input.evidenceCount) || input.evidenceCount <= 0) blockedReasons.push('Evidence 없는 Delivery Approval Reference 금지');
  }
  return { allowed: blockedReasons.length === 0, blockedReasons, humanDecisionRequired: true };
}

/* ── Execution 흐름 타임라인(관측 여부 표시 — 자동 진행 아님) ──────────── */
export const EXECUTION_FLOW_STAGES = [
  'strategic_portfolio', 'execution_program', 'execution_plan', 'milestone_candidate',
  'dependency_review', 'health_review', 'risk_review', 'progress_record', 'drift_review',
  'delivery_forecast', 'quality_review', 'human_delivery_review', 'approval_reference', 'outcome_link',
] as const;
export function buildExecutionTimeline(input: { present: Partial<Record<(typeof EXECUTION_FLOW_STAGES)[number], boolean>> }): {
  stage: (typeof EXECUTION_FLOW_STAGES)[number]; present: boolean;
}[] {
  return EXECUTION_FLOW_STAGES.map((stage) => ({ stage, present: input.present[stage] === true }));
}

/* ── 컴포넌트/Support Matrix(분류 7종 — §1) ────────────────────────────── */
export const EXECUTION_COMPONENTS = [
  'execution_program_registry', 'execution_plan_registry', 'milestone_tracking_jsonb',
  'dependency_analysis', 'critical_path_candidate', 'progress_drift_analysis',
  'delivery_forecast_candidate', 'delivery_health_risk_quality', 'human_delivery_review_workflow',
  'execution_event_audit',
] as const;

export type ExecutionSupportLevel = 'fully_supported' | 'partially_supported' | 'execution_only' | 'advisory_only' | 'human_review_only' | 'unavailable' | 'insufficient_data';
export const EXECUTION_SUPPORT_MATRIX: { capability: string; support: ExecutionSupportLevel }[] = [
  { capability: 'execution_program_structuring', support: 'fully_supported' },
  { capability: 'execution_plan_structuring', support: 'fully_supported' },
  { capability: 'execution_wave_reference_jsonb', support: 'fully_supported' },
  { capability: 'milestone_candidate_recording', support: 'fully_supported' },
  { capability: 'milestone_completed_reference_with_evidence', support: 'human_review_only' },
  { capability: 'milestone_progress_review', support: 'advisory_only' },
  { capability: 'execution_timeline_candidate', support: 'advisory_only' },
  { capability: 'execution_dependency_analysis', support: 'fully_supported' },
  { capability: 'circular_dependency_detection', support: 'fully_supported' },
  { capability: 'critical_path_candidate_analysis', support: 'advisory_only' },
  { capability: 'execution_health_candidate', support: 'advisory_only' },
  { capability: 'execution_risk_candidate_8_dimensions', support: 'advisory_only' },
  { capability: 'planned_progress_candidate_calculation', support: 'fully_supported' },
  { capability: 'actual_progress_reference_with_evidence', support: 'human_review_only' },
  { capability: 'progress_drift_analysis', support: 'fully_supported' },
  { capability: 'schedule_drift_candidate', support: 'advisory_only' },
  { capability: 'velocity_candidate_calculation', support: 'partially_supported' },
  { capability: 'execution_stability_candidate', support: 'advisory_only' },
  { capability: 'delay_candidate_detection', support: 'fully_supported' },
  { capability: 'delay_root_cause_candidate', support: 'advisory_only' },
  { capability: 'bottleneck_candidate_review', support: 'advisory_only' },
  { capability: 'delivery_forecast_candidate', support: 'advisory_only' },
  { capability: 'execution_quality_candidate', support: 'advisory_only' },
  { capability: 'regression_reference_recording', support: 'partially_supported' },
  { capability: 'rollback_reference_recording', support: 'partially_supported' },
  { capability: 'delivery_recommendation_with_evidence', support: 'advisory_only' },
  { capability: 'human_delivery_review_workflow', support: 'human_review_only' },
  { capability: 'executive_review_request', support: 'human_review_only' },
  { capability: 'resource_review_request', support: 'human_review_only' },
  { capability: 'delivery_approval_reference_no_self_approval', support: 'human_review_only' },
  { capability: 'initiative_reference_link_0545', support: 'partially_supported' },
  { capability: 'portfolio_reference_link_0545', support: 'partially_supported' },
  { capability: 'allocation_reference_link_0546', support: 'partially_supported' },
  { capability: 'commitment_reference_link_0520', support: 'partially_supported' },
  { capability: 'execution_request_reference_link_0535', support: 'partially_supported' },
  { capability: 'delivery_outcome_link', support: 'partially_supported' },
  { capability: 'execution_learning_reference', support: 'partially_supported' },
  { capability: 'execution_event_audit_trail', support: 'fully_supported' },
  { capability: 'project_management_system_feed', support: 'insufficient_data' },
  { capability: 'issue_tracker_feed', support: 'insufficient_data' },
  { capability: 'ci_cd_pipeline_feed', support: 'insufficient_data' },
  { capability: 'deployment_history_feed', support: 'insufficient_data' },
  { capability: 'sprint_velocity_feed', support: 'insufficient_data' },
  { capability: 'time_tracking_feed', support: 'insufficient_data' },
  { capability: 'automatic_project_start', support: 'unavailable' },
  { capability: 'automatic_project_completion', support: 'unavailable' },
  { capability: 'automatic_milestone_completion', support: 'unavailable' },
  { capability: 'automatic_approval', support: 'unavailable' },
  { capability: 'automatic_rollout', support: 'unavailable' },
  { capability: 'automatic_rollback', support: 'unavailable' },
  { capability: 'automatic_merge', support: 'unavailable' },
  { capability: 'automatic_deployment', support: 'unavailable' },
  { capability: 'automatic_budget_change', support: 'unavailable' },
  { capability: 'automatic_resource_allocation', support: 'unavailable' },
  { capability: 'automatic_schedule_change', support: 'unavailable' },
  { capability: 'automatic_contract_execution', support: 'unavailable' },
  { capability: 'automatic_payment_execution', support: 'unavailable' },
  { capability: 'automatic_incident_creation', support: 'unavailable' },
  { capability: 'automatic_production_change', support: 'unavailable' },
];
