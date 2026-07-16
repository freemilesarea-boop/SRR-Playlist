/**
 * policySimulation — Enterprise Policy Simulation, Change Impact Intelligence &
 * Human-Approved Assurance Rollout Center 순수 로직 (Phase AI-OPS-36).
 *
 * Approved Policy Proposal Reference → Policy Change Specification → Baseline Snapshot →
 * Historical Replay → Counterfactual Simulation → Conflict/Compatibility Analysis →
 * Blast Radius → Operational Friction → Safety Benefit → Non-Production Validation Plan →
 * Controlled Rollout Plan → Human Rollout Approval → Application Reference →
 * Post-Rollout Observation → Human Closure → Audit.
 *
 * Policy Simulation 정직성(전부 코드로 강제):
 *  - Simulation ≠ Reality. Replay ≠ Future Outcome. Counterfactual ≠ Fact.
 *  - Compatibility ≠ Safety. No Detected Conflict ≠ No Conflict. Estimate ≠ Actual Impact.
 *  - Plan ≠ Execution. Sandbox Pass ≠ Production Safety. Gate Ready ≠ Applied.
 *  - Application Reference ≠ Applied Success ≠ Effectiveness. Observation ≠ Causality.
 *  - 자동 승인/자동 적용/자동 Rollout 시작·확대/자동 Rollback 없음. 승인은 항상 사람.
 *  - 실제 Policy·Threshold·Runtime Rule·Constitution·Trust·Permission·Scope 변경 없음.
 *  - deterministic · pure · null 안전 · NaN/Infinity 방어 · Date 주입.
 */
import { isFiniteNumber, clampScore } from './aiMemory';

/* ── 상수(0539 CHECK와 1:1 정렬) ─────────────────────────────────────── */
export const POLICY_CHANGE_DOMAINS = ['connector_governance', 'automation_governance', 'execution_gateway', 'runtime_preconditions', 'runtime_assurance', 'permission_validation', 'scope_validation', 'risk_evaluation', 'dry_run_requirement', 'sandbox_requirement', 'idempotency_requirement', 'timeout_policy', 'retry_policy', 'checkpoint_policy', 'evidence_policy', 'cleanup_policy', 'observation_policy', 'escalation_policy', 'recovery_policy', 'closure_policy'] as const;
export const BLOCKED_POLICY_DOMAINS = ['constitution_mutation', 'trust_formula_mutation', 'authentication_mutation', 'rls_mutation', 'payment_policy_mutation', 'settlement_policy_mutation', 'contract_policy_mutation', 'pricing_policy_mutation', 'production_infrastructure_mutation', 'secret_policy_mutation', 'destructive_data_policy_mutation', 'employee_policy_mutation'] as const;
export const POLICY_CHANGE_TYPES = ['add_rule', 'modify_rule', 'disable_rule_reference', 'strengthen_validation', 'relax_validation', 'require_secondary_approval', 'remove_secondary_approval_reference', 'require_dry_run', 'require_sandbox', 'require_idempotency', 'modify_timeout', 'modify_retry_limit', 'require_checkpoint', 'modify_evidence_requirement', 'modify_cleanup_requirement', 'modify_observation_window', 'modify_escalation_rule', 'modify_recovery_requirement', 'modify_closure_requirement', 'insufficient_data'] as const;
export const SPECIFICATION_STATUSES = ['draft', 'pending_evidence', 'pending_review', 'reviewed_reference', 'approved_for_simulation_reference', 'simulation_blocked', 'validation_pending', 'rollout_plan_pending', 'rejected', 'invalidated', 'insufficient_data'] as const;
export const SIMULATION_TYPES = ['historical_replay', 'counterfactual', 'conflict_check', 'compatibility_check', 'blast_radius_analysis', 'operational_friction_analysis', 'safety_benefit_analysis', 'combined_assessment'] as const;
export const SIMULATION_STATUSES = ['draft', 'pending_review', 'running_reference', 'completed_reference', 'completed_with_limitation', 'blocked_reference', 'failed_reference', 'simulation_unverified', 'sample_too_small', 'insufficient_data'] as const;
export const ROLLOUT_STRATEGIES = ['reference_only', 'preview_validation', 'sandbox_validation', 'non_production_pilot', 'enterprise_limited_reference', 'brand_limited_reference', 'store_limited_reference', 'manual_application_reference'] as const;
export const BLOCKED_ROLLOUT_STRATEGIES = ['production_global', 'unattended_rollout', 'automatic_expansion', 'automatic_rollback', 'cross_enterprise_rollout'] as const;
export const ROLLOUT_STATUSES = ['draft', 'pending_simulation', 'simulation_blocked', 'pending_validation', 'validation_unverified', 'pending_review', 'approval_missing', 'approved_reference', 'ready_for_manual_application_reference', 'application_reference_recorded', 'application_unverified', 'observation_pending', 'observation_in_progress_reference', 'closure_pending', 'closed_reference', 'closed_with_limitation', 'rejected', 'cancelled', 'invalidated', 'insufficient_data'] as const;
export const CONFLICT_RESULTS = ['no_conflict_detected_reference', 'constitution_conflict_candidate', 'governance_conflict_candidate', 'security_conflict_candidate', 'privacy_conflict_candidate', 'compliance_conflict_candidate', 'permission_conflict_candidate', 'scope_conflict_candidate', 'connector_conflict_candidate', 'automation_conflict_candidate', 'environment_conflict_candidate', 'duplicate_rule_candidate', 'circular_dependency_candidate', 'contradictory_requirement_candidate', 'impossible_precondition_candidate', 'conflict_unverified', 'insufficient_data'] as const;
export const COMPATIBILITY_DOMAINS = ['constitution', 'governance', 'security', 'privacy', 'compliance', 'connector', 'automation', 'runtime'] as const;
export const ROLLOUT_RECOMMENDATION_TYPES = ['create_change_specification', 'gather_specification_evidence', 'review_change_specification', 'approve_for_simulation', 'record_baseline_snapshot', 'run_historical_replay_reference', 'run_counterfactual_reference', 'review_policy_conflicts', 'review_compatibility', 'review_blast_radius', 'review_operational_friction', 'review_safety_benefit', 'create_validation_plan', 'record_validation_evidence', 'create_rollout_plan', 'request_rollout_approval', 'review_rollout_gate', 'record_application_reference', 'verify_application_reference', 'start_post_rollout_observation', 'review_unexpected_effect', 'insufficient_data'] as const;
export const ROLLOUT_TIMELINE_STAGES = ['specification', 'baseline', 'simulation', 'conflict', 'validation', 'rollout_plan', 'approval', 'application', 'observation'] as const;

/* ── 1) Policy Change Specification(Specification ≠ Application) ─────── */
export function buildPolicyChangeSpecification(i: { proposalExists: boolean; proposalApproved: boolean; policyDomain: string; changeType: string; title: string; evidence: string[] }):
  | { rejected: true; rejectReason: string }
  | { policyDomain: string; changeType: string; title: string; evidence: string[]; status: 'draft' | 'pending_evidence'; specificationIsNotApplication: true; specificationIsNotApproval: true; autoApplied: false } {
  if ((BLOCKED_POLICY_DOMAINS as readonly string[]).includes(i.policyDomain)) return { rejected: true, rejectReason: `금지 policy domain(${i.policyDomain}) — 구조적 차단` };
  if (!(POLICY_CHANGE_DOMAINS as readonly string[]).includes(i.policyDomain)) return { rejected: true, rejectReason: '허용되지 않는 policy_domain' };
  if (!(POLICY_CHANGE_TYPES as readonly string[]).includes(i.changeType)) return { rejected: true, rejectReason: '허용되지 않는 change_type' };
  if (!i.proposalExists) return { rejected: true, rejectReason: 'Policy Proposal(0538) 없음(실존 검증 실패)' };
  if (!i.proposalApproved) return { rejected: true, rejectReason: 'Policy Proposal 미승인 — 승인된 Proposal Reference 필수' };
  if (!i.title.trim()) return { rejected: true, rejectReason: 'title 필수' };
  return {
    policyDomain: i.policyDomain, changeType: i.changeType, title: i.title, evidence: i.evidence.slice(0, 20),
    status: i.evidence.length ? 'draft' : 'pending_evidence',
    specificationIsNotApplication: true, specificationIsNotApproval: true, autoApplied: false,
  };
}

/* ── 2) Policy Delta(현재 스냅샷 vs 제안 — 결측은 unknown 유지) ──────── */
export function calculatePolicyDelta(current: Record<string, unknown> | null, proposed: Record<string, unknown> | null): { addedKeys: string[]; removedKeys: string[]; changedKeys: string[]; unchangedKeys: string[]; currentSnapshotAvailable: boolean; deltaIsNotImpact: true } {
  if (current == null || proposed == null) return { addedKeys: [], removedKeys: [], changedKeys: [], unchangedKeys: [], currentSnapshotAvailable: current != null, deltaIsNotImpact: true };
  const curKeys = Object.keys(current).sort();
  const proKeys = Object.keys(proposed).sort();
  const addedKeys = proKeys.filter((k) => !(k in current));
  const removedKeys = curKeys.filter((k) => !(k in proposed));
  const shared = proKeys.filter((k) => k in current);
  const changedKeys = shared.filter((k) => JSON.stringify(current[k]) !== JSON.stringify(proposed[k]));
  const unchangedKeys = shared.filter((k) => JSON.stringify(current[k]) === JSON.stringify(proposed[k]));
  return { addedKeys, removedKeys, changedKeys, unchangedKeys, currentSnapshotAvailable: true, deltaIsNotImpact: true };
}

/* ── 3) Baseline Snapshot Readiness(Baseline ≠ 미래 결과) ────────────── */
export function evaluateBaselineReadiness(i: { specApprovedForSimulation: boolean; snapshotSources: { name: string; captured: boolean | null }[] | null; capturedAt: Date | null; now: Date; staleAfterDays: number }): { result: 'specification_approval_missing' | 'baseline_ready_reference' | 'baseline_partial' | 'baseline_missing' | 'baseline_stale_candidate' | 'insufficient_data'; missingSources: string[]; baselineIsNotFutureResult: true; snapshotIsNotLiveState: true } {
  const flags = { baselineIsNotFutureResult: true as const, snapshotIsNotLiveState: true as const };
  if (!i.specApprovedForSimulation) return { result: 'specification_approval_missing', missingSources: [], ...flags };
  if (i.snapshotSources == null) return { result: 'insufficient_data', missingSources: [], ...flags };
  if (!i.snapshotSources.length) return { result: 'baseline_missing', missingSources: [], ...flags };
  const missingSources = i.snapshotSources.filter((s) => s.captured !== true).map((s) => s.name);
  if (missingSources.length === i.snapshotSources.length) return { result: 'baseline_missing', missingSources, ...flags };
  if (missingSources.length > 0) return { result: 'baseline_partial', missingSources, ...flags };
  if (i.capturedAt == null) return { result: 'insufficient_data', missingSources, ...flags };
  const ageDays = (i.now.getTime() - i.capturedAt.getTime()) / 86_400_000;
  if (!isFiniteNumber(ageDays) || ageDays < 0) return { result: 'insufficient_data', missingSources, ...flags };
  if (ageDays > i.staleAfterDays) return { result: 'baseline_stale_candidate', missingSources, ...flags };
  return { result: 'baseline_ready_reference', missingSources, ...flags };
}

/* ── 4) Historical Replay(Replay ≠ 미래 결과·과거 데이터 기준 참고) ──── */
export function evaluateHistoricalReplay(i: { baselineReady: boolean; executed: boolean; historyRows: number | null; minSample: number; failures: number | null; selectionBiasReviewed: boolean; replayedAt: Date | null; now: Date; staleAfterDays: number }): { result: 'baseline_missing' | 'replay_not_executed' | 'replay_sample_too_small' | 'selection_bias_candidate' | 'replay_completed_with_failures' | 'replay_stale_candidate' | 'replay_completed_reference' | 'replay_failed_reference' | 'insufficient_data'; replayIsNotFutureOutcome: true; replayIsNotReality: true } {
  const flags = { replayIsNotFutureOutcome: true as const, replayIsNotReality: true as const };
  if (!i.baselineReady) return { result: 'baseline_missing', ...flags };
  if (!i.executed) return { result: 'replay_not_executed', ...flags };
  if (i.historyRows == null || !isFiniteNumber(i.historyRows) || i.historyRows < 0) return { result: 'insufficient_data', ...flags };
  if (i.historyRows === 0) return { result: 'replay_failed_reference', ...flags };
  if (i.historyRows < i.minSample) return { result: 'replay_sample_too_small', ...flags };
  if (!i.selectionBiasReviewed) return { result: 'selection_bias_candidate', ...flags };
  if (i.failures != null && isFiniteNumber(i.failures) && i.failures > 0) return { result: 'replay_completed_with_failures', ...flags };
  if (i.replayedAt != null && (i.now.getTime() - i.replayedAt.getTime()) / 86_400_000 > i.staleAfterDays) return { result: 'replay_stale_candidate', ...flags };
  return { result: 'replay_completed_reference', ...flags };
}

/* ── 5) Counterfactual Simulation(Counterfactual ≠ Fact·Model 미검증 시 명시) ── */
export function evaluateCounterfactualSimulation(i: { replayCompleted: boolean; executed: boolean; modelDefined: boolean; modelValidated: boolean | null; scenarios: number | null; minScenarios: number; externalFactorsReviewed: boolean; contradictions: number | null }): { result: 'replay_missing' | 'counterfactual_not_executed' | 'simulation_model_missing' | 'simulation_model_unverified' | 'scenario_sample_too_small' | 'external_factor_unreviewed' | 'causality_unverified' | 'counterfactual_contradiction_candidate' | 'counterfactual_completed_with_limitation' | 'counterfactual_completed_reference' | 'counterfactual_failed_reference' | 'insufficient_data'; simulationIsNotReality: true; counterfactualIsNotFact: true } {
  const flags = { simulationIsNotReality: true as const, counterfactualIsNotFact: true as const };
  if (!i.replayCompleted) return { result: 'replay_missing', ...flags };
  if (!i.executed) return { result: 'counterfactual_not_executed', ...flags };
  if (!i.modelDefined) return { result: 'simulation_model_missing', ...flags };   // 이 코드베이스에 Counterfactual Model 없음 — 실측
  if (i.modelValidated == null) return { result: 'simulation_model_unverified', ...flags };
  if (i.modelValidated === false) return { result: 'counterfactual_failed_reference', ...flags };
  if (i.scenarios == null || !isFiniteNumber(i.scenarios) || i.scenarios < 0) return { result: 'insufficient_data', ...flags };
  if (i.scenarios < i.minScenarios) return { result: 'scenario_sample_too_small', ...flags };
  if (!i.externalFactorsReviewed) return { result: 'causality_unverified', ...flags };   // 외부 요인 미검토 — 인과 미검증 유지
  if (i.contradictions == null) return { result: 'external_factor_unreviewed', ...flags };
  if (i.contradictions > 0) return { result: 'counterfactual_contradiction_candidate', ...flags };
  return { result: 'counterfactual_completed_reference', ...flags };
}

/* ── 6) Policy Conflict Detection(No Detected Conflict ≠ No Conflict) ── */
export function detectPolicyConflicts(checks: { domain: string; checked: boolean; conflictDetected: boolean | null; conflictType: string | null }[] | null): { rows: { domain: string; result: (typeof CONFLICT_RESULTS)[number] }[]; detectedCount: number; unverifiedCount: number; noDetectedConflictIsNotNoConflict: true; autoResolved: false } {
  const rows = (checks ?? []).slice(0, 30).map((c) => {
    if (!c.checked || c.conflictDetected == null) return { domain: c.domain, result: 'conflict_unverified' as const };   // 미점검 — 재정규화 없이 unverified 유지
    if (!c.conflictDetected) return { domain: c.domain, result: 'no_conflict_detected_reference' as const };
    if (c.conflictType != null && (CONFLICT_RESULTS as readonly string[]).includes(c.conflictType)) return { domain: c.domain, result: c.conflictType as (typeof CONFLICT_RESULTS)[number] };
    return { domain: c.domain, result: 'insufficient_data' as const };
  });
  return {
    rows,
    detectedCount: rows.filter((r) => r.result.endsWith('_candidate')).length,
    unverifiedCount: rows.filter((r) => r.result === 'conflict_unverified').length,
    noDetectedConflictIsNotNoConflict: true, autoResolved: false,
  };
}

/* ── 7) Domain Compatibility(Compatibility ≠ Safety — 8개 도메인 공용) ── */
export function evaluateDomainCompatibility(i: { domain: string; reviewed: boolean; rulesEvaluated: number | null; incompatibilities: number | null; constitutionImmutableTouched: boolean; warnings: number | null; evidence: string[] }): { result: 'domain_invalid' | 'compatibility_unverified' | 'rules_missing' | 'constitution_immutable_conflict_candidate' | 'incompatible_candidate' | 'evidence_missing' | 'compatible_with_warnings' | 'compatible_reference' | 'insufficient_data'; compatibilityIsNotSafety: true; autoApproved: false } {
  const flags = { compatibilityIsNotSafety: true as const, autoApproved: false as const };
  if (!(COMPATIBILITY_DOMAINS as readonly string[]).includes(i.domain)) return { result: 'domain_invalid', ...flags };
  if (!i.reviewed) return { result: 'compatibility_unverified', ...flags };
  if (i.rulesEvaluated == null || !isFiniteNumber(i.rulesEvaluated) || i.rulesEvaluated < 0) return { result: 'insufficient_data', ...flags };
  if (i.rulesEvaluated === 0) return { result: 'rules_missing', ...flags };
  if (i.constitutionImmutableTouched) return { result: 'constitution_immutable_conflict_candidate', ...flags };   // HUMAN_APPROVAL_REQUIRED(0496) immutable 접촉은 항상 충돌 후보
  if (i.incompatibilities != null && isFiniteNumber(i.incompatibilities) && i.incompatibilities > 0) return { result: 'incompatible_candidate', ...flags };
  if (!i.evidence.length) return { result: 'evidence_missing', ...flags };
  if (i.warnings != null && isFiniteNumber(i.warnings) && i.warnings > 0) return { result: 'compatible_with_warnings', ...flags };
  return { result: 'compatible_reference', ...flags };
}

/* ── 8) Blast Radius(Estimate ≠ Actual Impact·Cross-Enterprise 차단) ─── */
export function calculateBlastRadius(i: { targetScopeType: string | null; targetCount: number | null; crossEnterprise: boolean; affectedComponents: string[] | null; maxTargets: number }): { result: 'cross_enterprise_blocked' | 'blast_radius_unverified' | 'target_scope_exceeded' | 'component_impact_unverified' | 'single_target_candidate' | 'limited_scope_candidate' | 'broad_scope_candidate' | 'insufficient_data'; estimateIsNotActualImpact: true; expansionAutomatic: false } {
  const flags = { estimateIsNotActualImpact: true as const, expansionAutomatic: false as const };
  if (i.crossEnterprise) return { result: 'cross_enterprise_blocked', ...flags };
  if (i.targetScopeType == null || !['enterprise', 'brand', 'store', 'user'].includes(i.targetScopeType)) return { result: 'blast_radius_unverified', ...flags };
  if (i.targetCount == null || !isFiniteNumber(i.targetCount) || i.targetCount < 0) return { result: 'insufficient_data', ...flags };
  if (i.targetCount > i.maxTargets) return { result: 'target_scope_exceeded', ...flags };
  if (i.affectedComponents == null) return { result: 'component_impact_unverified', ...flags };
  if (i.targetCount <= 1) return { result: 'single_target_candidate', ...flags };
  if (i.targetCount <= 10) return { result: 'limited_scope_candidate', ...flags };
  return { result: 'broad_scope_candidate', ...flags };
}

/* ── 9) Operational Friction(Friction 후보 ≠ UX 사실) ────────────────── */
export function evaluateOperationalFriction(i: { reviewed: boolean; additionalApprovalSteps: number | null; latencyIncreaseCandidate: boolean | null; manualWorkloadIncrease: boolean | null; automationDisabledCount: number | null; frictionReducedCandidate: boolean; userFeedbackCollected: boolean }): { result: 'friction_unverified' | 'friction_review_pending' | 'combined_friction_candidate' | 'approval_step_increase_candidate' | 'latency_increase_candidate' | 'manual_workload_increase_candidate' | 'automation_reduction_candidate' | 'friction_reduced_candidate' | 'friction_feedback_missing' | 'no_material_friction_candidate' | 'insufficient_data'; frictionIsNotUxFact: true } {
  const flags = { frictionIsNotUxFact: true as const };
  if (!i.reviewed) return { result: 'friction_unverified', ...flags };
  if (i.additionalApprovalSteps == null || !isFiniteNumber(i.additionalApprovalSteps)) return { result: 'friction_review_pending', ...flags };
  const signals: string[] = [];
  if (i.additionalApprovalSteps > 0) signals.push('approval_step_increase_candidate');
  if (i.latencyIncreaseCandidate === true) signals.push('latency_increase_candidate');
  if (i.manualWorkloadIncrease === true) signals.push('manual_workload_increase_candidate');
  if (i.automationDisabledCount != null && isFiniteNumber(i.automationDisabledCount) && i.automationDisabledCount > 0) signals.push('automation_reduction_candidate');
  if (signals.length >= 2) return { result: 'combined_friction_candidate', ...flags };
  if (signals.length === 1) return { result: signals[0] as 'approval_step_increase_candidate' | 'latency_increase_candidate' | 'manual_workload_increase_candidate' | 'automation_reduction_candidate', ...flags };
  if (i.frictionReducedCandidate) return { result: 'friction_reduced_candidate', ...flags };
  if (!i.userFeedbackCollected) return { result: 'friction_feedback_missing', ...flags };   // 실사용자 피드백 없이 "마찰 없음" 확정 금지
  return { result: 'no_material_friction_candidate', ...flags };
}

/* ── 10) Safety Benefit(Benefit 후보 ≠ 실제 이익) ────────────────────── */
export function evaluateSafetyBenefit(i: { reviewed: boolean; incidentsAddressed: number | null; controlGapsAddressed: number | null; recurrenceRiskReducedCandidate: boolean | null; evidence: string[] }): { result: 'benefit_unverified' | 'benefit_review_pending' | 'benefit_evidence_missing' | 'combined_benefit_candidate' | 'incident_reduction_candidate' | 'control_gap_reduction_candidate' | 'recurrence_reduction_candidate' | 'no_measured_benefit_candidate' | 'insufficient_data'; benefitCandidateIsNotActualBenefit: true } {
  const flags = { benefitCandidateIsNotActualBenefit: true as const };
  if (!i.reviewed) return { result: 'benefit_unverified', ...flags };
  if (i.incidentsAddressed == null || !isFiniteNumber(i.incidentsAddressed) || i.controlGapsAddressed == null || !isFiniteNumber(i.controlGapsAddressed)) return { result: 'benefit_review_pending', ...flags };
  const signals: string[] = [];
  if (i.incidentsAddressed > 0) signals.push('incident_reduction_candidate');
  if (i.controlGapsAddressed > 0) signals.push('control_gap_reduction_candidate');
  if (i.recurrenceRiskReducedCandidate === true) signals.push('recurrence_reduction_candidate');
  if (signals.length && !i.evidence.length) return { result: 'benefit_evidence_missing', ...flags };   // Evidence 없는 Benefit 주장 차단
  if (signals.length >= 2) return { result: 'combined_benefit_candidate', ...flags };
  if (signals.length === 1) return { result: signals[0] as 'incident_reduction_candidate' | 'control_gap_reduction_candidate' | 'recurrence_reduction_candidate', ...flags };
  return { result: 'no_measured_benefit_candidate', ...flags };
}

/* ── 11) Non-Production Validation Plan(Plan ≠ 검증 성공·Sandbox Pass ≠ Production Safety) ── */
export function evaluateValidationPlan(i: { environment: string | null; steps: string[] | null; successCriteria: string[] | null; evidenceRequired: boolean; sandboxPassed: boolean | null; previewDeployed: boolean | null }): { result: 'validation_plan_missing' | 'production_environment_blocked' | 'environment_invalid' | 'steps_missing' | 'success_criteria_missing' | 'evidence_requirement_missing' | 'sandbox_fail_reference' | 'sandbox_pass_reference' | 'preview_deployed_reference' | 'preview_unverified' | 'validation_plan_ready_reference' | 'validation_pending' | 'insufficient_data'; planIsNotValidationSuccess: true; sandboxPassIsNotProductionSafety: true } {
  const flags = { planIsNotValidationSuccess: true as const, sandboxPassIsNotProductionSafety: true as const };
  if (i.environment == null) return { result: 'validation_plan_missing', ...flags };
  if (i.environment === 'production') return { result: 'production_environment_blocked', ...flags };
  if (!['non_production', 'sandbox', 'preview', 'reference_only'].includes(i.environment)) return { result: 'environment_invalid', ...flags };
  if (i.steps == null || !i.steps.length) return { result: 'steps_missing', ...flags };
  if (i.successCriteria == null || !i.successCriteria.length) return { result: 'success_criteria_missing', ...flags };
  if (!i.evidenceRequired) return { result: 'evidence_requirement_missing', ...flags };
  if (i.sandboxPassed === false) return { result: 'sandbox_fail_reference', ...flags };
  if (i.sandboxPassed === true) return { result: 'sandbox_pass_reference', ...flags };
  if (i.previewDeployed === true) return { result: 'preview_deployed_reference', ...flags };
  if (i.previewDeployed === false) return { result: 'preview_unverified', ...flags };
  return { result: 'validation_plan_ready_reference', ...flags };
}

/* ── 12) Controlled Rollout Plan(Plan ≠ Execution·금지 전략 차단) ────── */
export function buildControlledRolloutPlan(i: { specificationExists: boolean; simulationExists: boolean; strategy: string; environmentScope: string; targetScopeType: string; targetScopeIds: string[]; stopConditions: string[]; rollbackConditions: string[]; observationWindows: string[]; reviewers: string[] }):
  | { rejected: true; rejectReason: string }
  | { strategy: string; environmentScope: string; targetScopeType: string; targetScopeIds: string[]; status: 'draft'; planIsNotExecution: true; autoRollout: false; autoExpansion: false; autoRollback: false } {
  if ((BLOCKED_ROLLOUT_STRATEGIES as readonly string[]).includes(i.strategy)) return { rejected: true, rejectReason: `금지 rollout 전략(${i.strategy}) — 구조적 차단` };
  if (!(ROLLOUT_STRATEGIES as readonly string[]).includes(i.strategy)) return { rejected: true, rejectReason: '허용되지 않는 rollout_strategy' };
  if (i.environmentScope === 'production' || !['non_production', 'sandbox', 'reference_only'].includes(i.environmentScope)) return { rejected: true, rejectReason: 'production 환경 rollout 차단 — non_production/sandbox/reference_only만 허용' };
  if (!i.specificationExists) return { rejected: true, rejectReason: 'Change Specification 없음(실존 검증 실패)' };
  if (!i.simulationExists) return { rejected: true, rejectReason: 'Simulation Run 없음(실존 검증 실패)' };
  if (!['enterprise', 'brand', 'store', 'user'].includes(i.targetScopeType)) return { rejected: true, rejectReason: '허용되지 않는 target_scope_type' };
  if (i.targetScopeIds.length > 50) return { rejected: true, rejectReason: 'target_scope_ids 50개 초과 — Blast Radius 제한' };
  if (!i.stopConditions.length) return { rejected: true, rejectReason: 'stop_conditions 필수' };
  if (!i.rollbackConditions.length) return { rejected: true, rejectReason: 'rollback_conditions 필수' };
  if (!i.observationWindows.length) return { rejected: true, rejectReason: 'observation_windows 필수' };
  if (!i.reviewers.length) return { rejected: true, rejectReason: 'assigned_reviewers 필수' };
  return {
    strategy: i.strategy, environmentScope: i.environmentScope, targetScopeType: i.targetScopeType, targetScopeIds: i.targetScopeIds.slice(0, 50),
    status: 'draft', planIsNotExecution: true, autoRollout: false, autoExpansion: false, autoRollback: false,
  };
}

/* ── 13) Rollout Gate(Gate Ready ≠ Applied·승인은 항상 사람) ─────────── */
export function evaluateRolloutGate(i: { rolloutStatus: string; humanApprovalEvidence: string[]; specificationStatus: string | null; simulationStatus: string | null; stopConditions: number; rollbackConditions: number; observationWindows: number; reviewers: number; validationEvidenceRecorded: boolean; unexpectedEffectOpen: boolean }): { ready: boolean; blockers: string[]; gateReadyIsNotApplied: true; approvalIsHumanOnly: true; autoApproved: false } {
  const blockers: string[] = [];
  if (i.rolloutStatus !== 'approved_reference') blockers.push('approval_missing');
  if (!i.humanApprovalEvidence.length) blockers.push('approval_evidence_missing');
  if (i.specificationStatus == null) blockers.push('specification_missing');
  else if (!['approved_for_simulation_reference', 'validation_pending', 'rollout_plan_pending'].includes(i.specificationStatus)) blockers.push('specification_not_approved');
  if (i.simulationStatus == null) blockers.push('simulation_missing');
  else if (!['completed_reference', 'completed_with_limitation'].includes(i.simulationStatus)) blockers.push('simulation_not_completed');   // 미실행 Simulation completed 취급 금지
  if (i.stopConditions <= 0) blockers.push('stop_conditions_missing');
  if (i.rollbackConditions <= 0) blockers.push('rollback_conditions_missing');
  if (i.observationWindows <= 0) blockers.push('observation_windows_missing');
  if (i.reviewers <= 0) blockers.push('reviewers_missing');
  if (!i.validationEvidenceRecorded) blockers.push('validation_evidence_missing');
  if (i.unexpectedEffectOpen) blockers.push('unexpected_effect_open');
  return { ready: blockers.length === 0, blockers, gateReadyIsNotApplied: true, approvalIsHumanOnly: true, autoApproved: false };
}

/* ── 14) Application Reference(Reference ≠ Applied Success) ──────────── */
export function evaluateRolloutApplication(i: { gateReady: boolean; referenceRecorded: boolean; referenceUrl: string | null; verificationEvidence: string[]; rollbackReviewRequested: boolean }): { status: 'gate_not_ready' | 'application_pending' | 'reference_url_missing' | 'application_unverified' | 'verified_reference' | 'rollback_review_requested'; applicationReferenceIsNotAppliedSuccess: true; applicationIsNotEffectiveness: true; appliedByThisSystem: false } {
  const flags = { applicationReferenceIsNotAppliedSuccess: true as const, applicationIsNotEffectiveness: true as const, appliedByThisSystem: false as const };
  if (i.rollbackReviewRequested) return { status: 'rollback_review_requested', ...flags };
  if (!i.gateReady) return { status: 'gate_not_ready', ...flags };
  if (!i.referenceRecorded) return { status: 'application_pending', ...flags };
  if (i.referenceUrl == null || !i.referenceUrl.trim()) return { status: 'reference_url_missing', ...flags };
  if (!i.verificationEvidence.length) return { status: 'application_unverified', ...flags };
  return { status: 'verified_reference', ...flags };
}

/* ── 15) Post-Rollout Observation(Application ≠ Effectiveness·Observation ≠ Causality) ── */
export function evaluatePostRolloutObservation(i: { applicationRecorded: boolean; observationStarted: boolean; baseline: number | null; observed: number | null; sampleSize: number | null; minSample: number; observedAt: Date | null; now: Date; staleAfterDays: number; unexpectedEffects: number | null; externalFactorsRuledOut: boolean }): { result: 'application_missing' | 'observation_not_started' | 'unexpected_effect_review_required' | 'sample_too_small' | 'stale_input_candidate' | 'effectiveness_unverified' | 'causality_unverified' | 'expected_effect_candidate' | 'adverse_effect_candidate' | 'mixed_effect_candidate' | 'no_material_change_candidate' | 'insufficient_data'; applicationIsNotEffectiveness: true; observationIsNotCausality: true } {
  const flags = { applicationIsNotEffectiveness: true as const, observationIsNotCausality: true as const };
  if (!i.applicationRecorded) return { result: 'application_missing', ...flags };
  if (!i.observationStarted) return { result: 'observation_not_started', ...flags };
  if (i.unexpectedEffects != null && isFiniteNumber(i.unexpectedEffects) && i.unexpectedEffects > 0) return { result: 'unexpected_effect_review_required', ...flags };
  if (i.sampleSize == null || !isFiniteNumber(i.sampleSize) || i.sampleSize < 0) return { result: 'insufficient_data', ...flags };
  if (i.sampleSize < i.minSample) return { result: 'sample_too_small', ...flags };
  if (i.observedAt == null) return { result: 'insufficient_data', ...flags };
  if ((i.now.getTime() - i.observedAt.getTime()) / 86_400_000 > i.staleAfterDays) return { result: 'stale_input_candidate', ...flags };
  if (i.baseline == null || !isFiniteNumber(i.baseline) || i.observed == null || !isFiniteNumber(i.observed)) return { result: 'effectiveness_unverified', ...flags };
  if (!i.externalFactorsRuledOut) return { result: 'causality_unverified', ...flags };   // 외부 요인 배제 검토 없이 효과 확정 금지
  const delta = i.observed - i.baseline;
  if (delta > 0) return { result: 'expected_effect_candidate', ...flags };
  if (delta < 0) return { result: 'adverse_effect_candidate', ...flags };
  return { result: 'no_material_change_candidate', ...flags };
}

/* ── 16) Rollout Recommendation(제안 전용 — Evidence 필수·실행 없음) ─── */
export function buildPolicyRolloutRecommendation(i: { type: string; reason: string; evidence: string[]; confidence: number | null; alternatives?: string[]; limitations?: string[] }):
  | { rejected: true; rejectReason: string }
  | { type: string; reason: string; evidence: string[]; confidence: number; alternatives: string[]; limitations: string[]; isRecommendationOnly: true; requiresHumanApproval: true; autoExecuted: false } {
  if (!(ROLLOUT_RECOMMENDATION_TYPES as readonly string[]).includes(i.type)) return { rejected: true, rejectReason: '허용되지 않는 recommendation type' };
  if (!i.reason.trim()) return { rejected: true, rejectReason: 'reason 필수' };
  if (!i.evidence.length) return { rejected: true, rejectReason: 'Evidence 없는 추천 금지' };
  return {
    type: i.type, reason: i.reason, evidence: i.evidence.slice(0, 20),
    confidence: clampScore(i.confidence ?? 0),
    alternatives: (i.alternatives ?? []).slice(0, 10), limitations: (i.limitations ?? []).slice(0, 10),
    isRecommendationOnly: true, requiresHumanApproval: true, autoExecuted: false,
  };
}

/* ── 17) Rollout Timeline(측정 카운트 요약 — 완료 주장 아님) ─────────── */
export function buildPolicyRolloutTimeline(counts: { stage: string; count: number | null; source: string }[] | null): { stages: { stage: string; count: number | null; source: string; status: 'measured' | 'insufficient_data' }[]; invalidStages: number; timelineIsNotCompletionClaim: true } {
  const rows = (counts ?? []).filter((c) => (ROLLOUT_TIMELINE_STAGES as readonly string[]).includes(c.stage));
  return {
    stages: rows.map((c) => ({ stage: c.stage, count: isFiniteNumber(c.count) && (c.count as number) >= 0 ? c.count : null, source: c.source, status: isFiniteNumber(c.count) && (c.count as number) >= 0 ? 'measured' as const : 'insufficient_data' as const })),
    invalidStages: (counts ?? []).length - rows.length,
    timelineIsNotCompletionClaim: true,
  };
}

/* ── 실측 구성요소(추측 없음 — 코드/Migration 기준) ──────────────────── */
export const SIMULATION_COMPONENTS: { key: string; available: boolean | null; note: string }[] = [
  { key: 'runtime_history_0536_0537', available: true, note: 'ai_runtime_sessions/checkpoint·signal·incident candidate 이력(0536/0537) — Replay 원천 데이터' },
  { key: 'policy_versions_0512', available: true, note: 'ai_enterprise_policy_versions(policy_id+version unique·checksum) — Version Reference 읽기 전용' },
  { key: 'constitution_rules_0496', available: true, note: 'ai_constitution_rules(HUMAN_APPROVAL_REQUIRED immutable) — Conflict 점검 기준' },
  { key: 'governance_events_0496', available: true, note: 'ai_governance_events — Governance 이력 참조' },
  { key: 'incident_history_0502_0537', available: true, note: 'ai_incidents(0502)+incident candidates(0537) — Safety Benefit 검토 원천' },
  { key: 'policy_proposals_0538', available: true, note: 'ai_runtime_policy_proposals — 승인된 Proposal만 Specification 생성 가능' },
  { key: 'vercel_preview', available: true, note: 'Vercel Preview 배포 실존 — Non-Production Validation 참조 가능' },
  { key: 'counterfactual_model', available: false, note: 'Counterfactual 모델 없음 — simulation_model_missing 처리(임의 모델 가정 금지)' },
  { key: 'feature_flag_engine', available: false, note: '범용 Feature Flag 엔진 없음(track_rollouts는 음악 도메인 별개)' },
  { key: 'canary_staging', available: false, note: 'Canary/Staging 환경 없음 — Sandbox Pass ≠ Production Safety' },
  { key: 'policy_apply_engine', available: false, note: 'Policy 자동 적용 엔진 없음 — Application은 사람 수행 후 Reference 기록만' },
  { key: 'provider_outage_feed', available: false, note: '외부 Provider 장애 피드 없음 — 외부 요인 자동 배제 불가(causality_unverified 유지)' },
];

export const POLICY_ROLLOUT_SUPPORT: { key: string; status: string; note: string }[] = [
  { key: 'change_specification', status: 'supported', note: '승인된 Proposal(0538) 기반 명세 생성' },
  { key: 'specification_review', status: 'supported', note: '7 actions — 사람 검토·Evidence 게이트' },
  { key: 'blocked_policy_domains', status: 'supported', note: '금지 도메인 12종 서버 차단' },
  { key: 'policy_delta', status: 'supported', note: 'added/removed/changed keys — Delta ≠ Impact' },
  { key: 'baseline_snapshot_reference', status: 'supported', note: 'Event JSONB 기록 — Baseline ≠ 미래 결과' },
  { key: 'historical_replay_reference', status: 'supported', note: '과거 이력 기준 참고 — Replay ≠ Future Outcome' },
  { key: 'counterfactual_reference', status: 'supported', note: '모델 없음 명시(simulation_model_missing) — Counterfactual ≠ Fact' },
  { key: 'conflict_review', status: 'supported', note: '17 result whitelist — No Detected Conflict ≠ No Conflict' },
  { key: 'compatibility_review', status: 'supported', note: '8 도메인 — Compatibility ≠ Safety' },
  { key: 'blast_radius_review', status: 'supported', note: 'target 50 제한·cross_enterprise 차단 — Estimate ≠ Actual Impact' },
  { key: 'operational_friction_review', status: 'supported', note: 'Friction 후보 ≠ UX 사실' },
  { key: 'safety_benefit_review', status: 'supported', note: 'Evidence 필수 — Benefit 후보 ≠ 실제 이익' },
  { key: 'validation_plan', status: 'supported', note: 'non_production/sandbox/preview만 — production 차단' },
  { key: 'validation_evidence', status: 'supported', note: 'Sandbox Pass ≠ Production Safety' },
  { key: 'rollout_plan', status: 'supported', note: '허용 전략 8종·금지 전략 5종 차단 — Plan ≠ Execution' },
  { key: 'human_rollout_approval', status: 'supported', note: '승인은 항상 사람 + Evidence 필수' },
  { key: 'rollout_gate', status: 'supported', note: '서버 게이트(승인+simulation completed+stop/rollback/observation/reviewer)' },
  { key: 'application_reference', status: 'supported', note: '사람 적용 후 Reference 기록만 — Reference ≠ Applied Success' },
  { key: 'application_verification_reference', status: 'supported', note: 'Evidence 기반 검증 Reference' },
  { key: 'post_rollout_observation_reference', status: 'supported', note: 'Observation ≠ Causality' },
  { key: 'unexpected_effect_review', status: 'supported', note: '검출 시 사람 검토 필수' },
  { key: 'pause_review_request', status: 'supported', note: 'Pause는 검토 요청 — Request ≠ Success' },
  { key: 'rollback_review_request', status: 'supported', note: 'Rollback은 검토 요청만 — 자동 Rollback 없음' },
  { key: 'human_closure', status: 'supported', note: 'close/close_with_limitation — Evidence 필수' },
  { key: 'audit_trail', status: 'supported', note: 'ai_policy_rollout_events 27종' },
  { key: 'secret_payload_rejection', status: 'supported', note: '_runtime_reject_secret_payload(0536) 재사용' },
  { key: 'idempotency_key', status: 'supported', note: 'partial unique index' },
  { key: 'self_review_warning', status: 'supported', note: '작성자=검토자 경고 부착' },
  { key: 'automatic_policy_application', status: 'unsupported', note: '자동 Policy 적용 없음 — 구조적 미지원' },
  { key: 'automatic_rollout_start', status: 'unsupported', note: '자동 Rollout 시작 없음' },
  { key: 'automatic_rollout_expansion', status: 'unsupported', note: '자동 확대 없음(automatic_expansion 전략 차단)' },
  { key: 'automatic_rollback', status: 'unsupported', note: '자동 Rollback 없음(검토 요청만)' },
  { key: 'automatic_approval', status: 'unsupported', note: '자동 승인 없음 — 승인은 항상 사람' },
  { key: 'automatic_threshold_change', status: 'unsupported', note: 'Threshold 자동 변경 없음' },
  { key: 'automatic_constitution_change', status: 'unsupported', note: 'Constitution 변경 없음(0496 immutable)' },
  { key: 'automatic_trust_change', status: 'unsupported', note: 'Trust 공식 변경 없음' },
  { key: 'automatic_permission_change', status: 'unsupported', note: 'Permission 자동 변경 없음' },
  { key: 'automatic_scope_change', status: 'unsupported', note: 'Scope 자동 변경 없음' },
  { key: 'automatic_production_change', status: 'unsupported', note: 'Production Entity 변경 없음' },
  { key: 'automatic_notification_dispatch', status: 'unsupported', note: '자동 발송 없음(이메일/Slack/Push 미연동)' },
  { key: 'automatic_incident_creation', status: 'unsupported', note: 'ai_incidents(0502) 자동 등록 없음' },
];
