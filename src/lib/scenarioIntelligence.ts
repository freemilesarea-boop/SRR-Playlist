/**
 * scenarioIntelligence — Enterprise Scenario Intelligence, Scenario Replay &
 * Multi-Future Comparison Center 순수 로직 (Phase AI-OPS-38).
 *
 * Historical Event Reference → Scenario Template(Versioning) → Historical Replay →
 * Branching → Variable Injection → Multi-Future → Timeline → Cross-Scenario Comparison →
 * Trade-off/Robustness/Regret → Human Review → Decision Reference → Outcome Link →
 * Accuracy/Drift Candidate → Audit.
 *
 * 정직성(전부 코드로 강제):
 *  - Scenario ≠ Reality. Replay ≠ Reoccurrence. Prediction ≠ Future Fact.
 *  - Branch Probability ≠ True Probability. Best/Worst/Base Case ≠ 확정 미래.
 *  - Robust Option ≠ Correct Option. Lowest Regret ≠ Best Decision.
 *  - Comparison ≠ Automatic Ranking(자동 승자 없음). Simulation ≠ Execution.
 *  - Accuracy Candidate ≠ Verified Accuracy. Drift Candidate ≠ Confirmed Failure.
 *  - Unknown 유지(null→0 금지) · insufficient_data/sample_too_small/stale_input_candidate/
 *    replay_unavailable/branch_probability_unverified/outcome_unverified 유지.
 *  - deterministic · pure · null 안전 · NaN/Infinity 방어 · Date 주입.
 *  - Cost/Capacity/Queue/Incident/Workload projection 은 enterpriseTwin(0540) 순수 함수 재사용.
 */
import { isFiniteNumber, clampScore } from './aiMemory';
import { projectCost, projectCapacity, projectApprovalQueue, projectIncidents, projectHumanWorkload } from './enterpriseTwin';

/* Scenario projection 은 Twin projection 순수 함수를 그대로 재사용(중복 구현 없음). */
export { projectCost as projectScenarioCost, projectCapacity as projectScenarioCapacity, projectApprovalQueue as projectScenarioQueue, projectIncidents as projectScenarioIncidents, projectHumanWorkload as projectScenarioHumanWorkload };

/* ── 상수(0542 CHECK와 1:1 정렬) ─────────────────────────────────────── */
export const SCENARIO_DOMAINS = ['runtime_failure', 'connector_failure', 'provider_failure', 'approval_delay', 'human_absence', 'agent_failure', 'policy_conflict', 'policy_change', 'recovery_failure', 'evidence_gap', 'permission_failure', 'scope_violation', 'queue_growth', 'capacity_shortage', 'cost_spike', 'scale_growth', 'region_failure', 'multi_incident', 'multi_policy_change', 'new_connector', 'new_enterprise', 'operational_bottleneck', 'custom_reference'] as const;
export const BLOCKED_SCENARIO_DOMAINS = ['production_chaos_execution', 'destructive_failure_injection', 'real_provider_shutdown', 'real_connector_disable', 'real_account_lock', 'real_permission_revocation', 'real_policy_mutation', 'real_payment_failure', 'real_settlement_mutation', 'real_data_corruption', 'real_infrastructure_failure', 'employee_performance_simulation', 'personal_behavior_prediction'] as const;
export const TEMPLATE_SOURCE_TYPES = ['historical_incident', 'runtime_session', 'policy_simulation', 'rollout_observation', 'decision_outcome', 'enterprise_snapshot', 'manual_reference', 'synthetic_reference', 'insufficient_data'] as const;
export const TEMPLATE_STATUSES = ['draft', 'pending_evidence', 'pending_review', 'reviewed_reference', 'approved_for_replay_reference', 'replay_blocked', 'invalidated', 'rejected', 'insufficient_data'] as const;
export const VERSION_COMPATIBILITY_RESULTS = ['version_ready_reference', 'backward_compatible_reference', 'compatible_with_limitation', 'breaking_change_candidate', 'version_unverified', 'insufficient_data'] as const;
export const SCENARIO_VARIABLE_TYPES = ['boolean', 'integer', 'decimal', 'percentage', 'duration', 'count', 'currency', 'enum_reference', 'scope_reference', 'connector_reference', 'policy_reference', 'agent_reference', 'date_reference', 'unknown'] as const;
export const INJECTION_RESULTS = ['injection_ready_reference', 'template_unapproved', 'snapshot_missing', 'snapshot_stale_candidate', 'required_layer_missing', 'required_source_missing', 'invalid_variable', 'scope_mismatch', 'cross_enterprise_blocked', 'horizon_too_long', 'evidence_missing', 'reviewer_missing', 'insufficient_data'] as const;
export const REPLAY_RESULTS = ['replay_ready_reference', 'replay_completed_reference', 'replay_partial', 'replay_event_gap_candidate', 'replay_order_unverified', 'replay_duplicate_candidate', 'replay_scope_mismatch', 'replay_external_factor_unverified', 'replay_bias_candidate', 'sample_too_small', 'stale_input_candidate', 'replay_unavailable', 'insufficient_data'] as const;
export const TRANSITION_TYPES = ['metric_threshold', 'time_elapsed', 'event_detected', 'event_missing', 'approval_received_reference', 'approval_delayed_reference', 'connector_status_reference', 'policy_status_reference', 'capacity_limit_candidate', 'cost_limit_candidate', 'risk_limit_candidate', 'human_intervention_reference', 'recovery_reference', 'unknown'] as const;
export const FUTURE_CASE_TYPES = ['base_case_candidate', 'best_case_candidate', 'worst_case_candidate', 'conservative_case_candidate', 'aggressive_case_candidate', 'delayed_response_candidate', 'immediate_response_candidate', 'no_action_candidate', 'limited_action_candidate', 'policy_applied_reference', 'policy_not_applied_reference', 'recovery_success_candidate', 'recovery_failure_candidate', 'custom_branch_reference'] as const;
export const RUN_MODES = ['historical_replay_reference', 'deterministic_reference', 'multi_future_reference', 'branch_comparison_reference', 'robustness_reference', 'regret_reference', 'combined_reference'] as const;
export const BLOCKED_RUN_MODES = ['production_execution', 'live_chaos_test', 'real_connector_test', 'real_policy_apply_test', 'unattended_multi_agent_execution'] as const;
export const SCENARIO_RUN_STATUSES = ['draft', 'pending_review', 'ready_reference', 'running_reference', 'completed_reference', 'completed_with_limitation', 'blocked_reference', 'failed_reference', 'replay_unavailable', 'prediction_unverified', 'sample_too_small', 'invalidated', 'insufficient_data'] as const;
export const SCENARIO_BRANCH_STATUSES = ['draft', 'ready_reference', 'running_reference', 'completed_reference', 'completed_with_limitation', 'blocked_reference', 'pruned_reference', 'invalidated', 'sample_too_small', 'insufficient_data'] as const;
export const SCENARIO_COMPARISON_DIMENSIONS = ['risk', 'cost', 'capacity', 'throughput', 'incident_count', 'approval_queue', 'human_workload', 'recovery_difficulty', 'mttr', 'opportunity', 'confidence', 'unknown_factors', 'external_factor_coverage', 'evidence_completeness', 'reversibility', 'operational_friction'] as const;
export const TRADEOFF_TYPES = ['risk_vs_cost', 'risk_vs_capacity', 'cost_vs_reliability', 'speed_vs_safety', 'automation_vs_human_control', 'approval_speed_vs_governance', 'capacity_vs_operational_friction', 'recovery_speed_vs_validation', 'growth_vs_stability', 'opportunity_vs_downside'] as const;
export const TRADEOFF_RESULTS = ['favorable_tradeoff_candidate', 'balanced_tradeoff_candidate', 'unfavorable_tradeoff_candidate', 'mixed_tradeoff_candidate', 'tradeoff_unverified', 'insufficient_data'] as const;
export const ROBUSTNESS_RESULTS = ['robust_option_candidate', 'conditionally_robust_candidate', 'fragile_option_candidate', 'scenario_specific_candidate', 'robustness_unverified', 'insufficient_data'] as const;
export const REGRET_RESULTS = ['lowest_regret_candidate', 'low_regret_candidate', 'moderate_regret_candidate', 'high_regret_candidate', 'asymmetric_regret_candidate', 'regret_unverified', 'insufficient_data'] as const;
export const SCENARIO_RISK_RESULTS = ['negligible_risk_candidate', 'low_risk_candidate', 'moderate_risk_candidate', 'high_risk_candidate', 'critical_risk_candidate', 'cascading_failure_candidate', 'single_point_of_failure_candidate', 'risk_unverified', 'insufficient_data'] as const;
export const SCENARIO_OPPORTUNITY_RESULTS = ['opportunity_candidate', 'limited_opportunity_candidate', 'mixed_opportunity_candidate', 'no_material_opportunity_candidate', 'adverse_tradeoff_candidate', 'opportunity_unverified', 'insufficient_data'] as const;
export const ACCURACY_RESULTS = ['accuracy_candidate_high', 'accuracy_candidate_moderate', 'accuracy_candidate_low', 'direction_match_only', 'range_match_only', 'accuracy_unverified', 'outcome_unverified', 'sample_too_small', 'insufficient_data'] as const;
export const DRIFT_RESULTS = ['no_material_drift_candidate', 'minor_drift_candidate', 'moderate_drift_candidate', 'severe_drift_candidate', 'structural_drift_candidate', 'drift_unverified', 'insufficient_data'] as const;
export const SCENARIO_RECOMMENDATION_TYPES = ['create_scenario_template', 'gather_replay_evidence', 'create_historical_replay', 'define_variables', 'validate_variable_ranges', 'create_scenario_branch', 'generate_base_case', 'generate_best_case', 'generate_worst_case', 'generate_no_action_case', 'compare_scenarios', 'review_tradeoffs', 'review_robustness', 'review_regret', 'review_common_risks', 'review_common_safe_conditions', 'request_human_scenario_review', 'record_decision_reference', 'link_observed_outcome', 'review_accuracy_candidate', 'review_drift_candidate', 'update_scenario_template_reference', 'insufficient_data'] as const;
export const SCENARIO_TIMELINE_STAGES = ['template', 'replay', 'injection', 'run', 'branch', 'multi_future', 'comparison', 'human_review', 'decision_reference', 'outcome'] as const;

/* ── 1) Scenario Template(Template ≠ Execution) ──────────────────────── */
export function buildScenarioTemplate(i: { domain: string; name: string; sourceType: string; sourceExists: boolean | null; variableCount: number }):
  | { rejected: true; rejectReason: string }
  | { domain: string; name: string; sourceType: string; supportStatus: 'supported_reference' | 'partially_supported' | 'support_unverified'; status: 'draft'; templateIsNotExecution: true; scenarioIsNotReality: true; syntheticMarked: boolean } {
  if ((BLOCKED_SCENARIO_DOMAINS as readonly string[]).includes(i.domain)) return { rejected: true, rejectReason: `금지 scenario domain(${i.domain}) — 구조적 차단` };
  if (!(SCENARIO_DOMAINS as readonly string[]).includes(i.domain)) return { rejected: true, rejectReason: '허용되지 않는 scenario_domain' };
  if (!(TEMPLATE_SOURCE_TYPES as readonly string[]).includes(i.sourceType)) return { rejected: true, rejectReason: '허용되지 않는 source_type' };
  if (!i.name.trim()) return { rejected: true, rejectReason: 'template_name 필수' };
  if (i.variableCount > 100) return { rejected: true, rejectReason: 'scenario_variables 100개 초과' };
  if (i.sourceType !== 'manual_reference' && i.sourceType !== 'synthetic_reference' && i.sourceType !== 'insufficient_data' && i.sourceExists === false) return { rejected: true, rejectReason: '원천 Reference 없음(실존 검증 실패)' };
  const supportStatus = i.sourceType === 'synthetic_reference' ? 'partially_supported' as const : i.sourceType === 'insufficient_data' ? 'support_unverified' as const : 'supported_reference' as const;
  return { domain: i.domain, name: i.name, sourceType: i.sourceType, supportStatus, status: 'draft', templateIsNotExecution: true, scenarioIsNotReality: true, syntheticMarked: i.sourceType === 'synthetic_reference' };
}

/* ── 2) Template Version(버전별 결과 상이 가능 명시) ─────────────────── */
export function validateScenarioVersion(i: { templateVersion: number | null; previousVersionExists: boolean; variableSchemaChanged: boolean; transitionRulesChanged: boolean; outputSchemaChanged: boolean; changeSummary: string }): { result: (typeof VERSION_COMPATIBILITY_RESULTS)[number]; versionResultsMayDiffer: true } {
  const flags = { versionResultsMayDiffer: true as const };
  if (i.templateVersion == null || !isFiniteNumber(i.templateVersion) || i.templateVersion < 1) return { result: 'insufficient_data', ...flags };
  if (!i.changeSummary.trim()) return { result: 'version_unverified', ...flags };
  if (i.templateVersion > 1 && !i.previousVersionExists) return { result: 'version_unverified', ...flags };
  if (i.outputSchemaChanged) return { result: 'breaking_change_candidate', ...flags };
  if (i.variableSchemaChanged || i.transitionRulesChanged) return { result: 'compatible_with_limitation', ...flags };
  if (i.templateVersion === 1) return { result: 'version_ready_reference', ...flags };
  return { result: 'backward_compatible_reference', ...flags };
}

/* ── 3) Scenario Variables(NaN/Infinity 차단·Unknown 유지) ───────────── */
export function validateScenarioVariables(vars: { code: string; type: string; value: number | boolean | string | null; min?: number | null; max?: number | null }[] | null): { rows: { code: string; result: 'valid' | 'invalid_type' | 'invalid_range' | 'nan_or_infinity_blocked' | 'negative_blocked' | 'percentage_out_of_range' | 'duration_exceeded' | 'count_exceeded' | 'currency_exceeded' | 'unknown_kept' }[]; validCount: number; invalidCount: number; unknownKept: true } {
  const rows = (vars ?? []).slice(0, 100).map((v) => {
    if (!(SCENARIO_VARIABLE_TYPES as readonly string[]).includes(v.type)) return { code: v.code, result: 'invalid_type' as const };
    if (v.type === 'unknown' || v.value == null) return { code: v.code, result: 'unknown_kept' as const };   // Unknown 유지 — 0 대체 금지
    if (typeof v.value === 'number') {
      if (!isFiniteNumber(v.value)) return { code: v.code, result: 'nan_or_infinity_blocked' as const };
      if ((v.type === 'count' || v.type === 'duration' || v.type === 'currency') && v.value < 0) return { code: v.code, result: 'negative_blocked' as const };
      if (v.type === 'percentage' && (v.value < 0 || v.value > 100)) return { code: v.code, result: 'percentage_out_of_range' as const };
      if (v.type === 'duration' && v.value > 525600) return { code: v.code, result: 'duration_exceeded' as const };      // 365일(분)
      if (v.type === 'count' && v.value > 1_000_000) return { code: v.code, result: 'count_exceeded' as const };
      if (v.type === 'currency' && v.value > 100_000_000_000) return { code: v.code, result: 'currency_exceeded' as const };
      if (v.min != null && isFiniteNumber(v.min) && v.value < v.min) return { code: v.code, result: 'invalid_range' as const };
      if (v.max != null && isFiniteNumber(v.max) && v.value > v.max) return { code: v.code, result: 'invalid_range' as const };
    }
    return { code: v.code, result: 'valid' as const };
  });
  return { rows, validCount: rows.filter((r) => r.result === 'valid').length, invalidCount: rows.filter((r) => r.result !== 'valid' && r.result !== 'unknown_kept').length, unknownKept: true };
}

/* ── 4) Scenario Injection(실제 장애 주입 아님) ──────────────────────── */
export function evaluateScenarioInjection(i: { templateStatus: string; snapshotStatus: string | null; snapshotAgeHours: number | null; staleAfterHours: number; requiredLayersCovered: boolean; requiredSourcesCovered: boolean; variablesValid: boolean; scopeMatched: boolean; crossEnterprise: boolean; horizonMinutes: number | null; evidenceCount: number; reviewerAssigned: boolean }): { result: (typeof INJECTION_RESULTS)[number]; injectionIsNotFailureInjection: true; productionChanged: false } {
  const flags = { injectionIsNotFailureInjection: true as const, productionChanged: false as const };
  if (i.crossEnterprise) return { result: 'cross_enterprise_blocked', ...flags };
  if (i.templateStatus !== 'approved_for_replay_reference') return { result: 'template_unapproved', ...flags };
  if (i.snapshotStatus == null) return { result: 'snapshot_missing', ...flags };
  if (i.snapshotAgeHours != null && isFiniteNumber(i.snapshotAgeHours) && i.snapshotAgeHours > i.staleAfterHours) return { result: 'snapshot_stale_candidate', ...flags };
  if (!i.requiredLayersCovered) return { result: 'required_layer_missing', ...flags };
  if (!i.requiredSourcesCovered) return { result: 'required_source_missing', ...flags };
  if (!i.variablesValid) return { result: 'invalid_variable', ...flags };
  if (!i.scopeMatched) return { result: 'scope_mismatch', ...flags };
  if (i.horizonMinutes == null || !isFiniteNumber(i.horizonMinutes)) return { result: 'insufficient_data', ...flags };
  if (i.horizonMinutes > 525600) return { result: 'horizon_too_long', ...flags };
  if (i.evidenceCount <= 0) return { result: 'evidence_missing', ...flags };
  if (!i.reviewerAssigned) return { result: 'reviewer_missing', ...flags };
  return { result: 'injection_ready_reference', ...flags };
}

/* ── 5) Historical Replay(Replay ≠ Reoccurrence·완벽 재현 아님) ──────── */
export function evaluateHistoricalReplay(i: { sourceAvailable: boolean; eventCount: number | null; minSample: number; gapCount: number | null; duplicateCount: number | null; orderingVerified: boolean; scopeMatched: boolean; externalFactorsReviewed: boolean; selectionBiasReviewed: boolean; newestEventAgeDays: number | null; staleAfterDays: number }): { result: (typeof REPLAY_RESULTS)[number]; replayIsNotReoccurrence: true; historicalEventIsNotFutureEvent: true } {
  const flags = { replayIsNotReoccurrence: true as const, historicalEventIsNotFutureEvent: true as const };
  if (!i.sourceAvailable) return { result: 'replay_unavailable', ...flags };
  if (i.eventCount == null || !isFiniteNumber(i.eventCount) || i.eventCount < 0) return { result: 'insufficient_data', ...flags };
  if (i.eventCount === 0) return { result: 'replay_unavailable', ...flags };
  if (i.eventCount < i.minSample) return { result: 'sample_too_small', ...flags };
  if (!i.scopeMatched) return { result: 'replay_scope_mismatch', ...flags };
  if (i.gapCount != null && isFiniteNumber(i.gapCount) && i.gapCount > 0) return { result: 'replay_event_gap_candidate', ...flags };
  if (i.duplicateCount != null && isFiniteNumber(i.duplicateCount) && i.duplicateCount > 0) return { result: 'replay_duplicate_candidate', ...flags };
  if (!i.orderingVerified) return { result: 'replay_order_unverified', ...flags };
  if (!i.externalFactorsReviewed) return { result: 'replay_external_factor_unverified', ...flags };
  if (!i.selectionBiasReviewed) return { result: 'replay_bias_candidate', ...flags };
  if (i.newestEventAgeDays != null && isFiniteNumber(i.newestEventAgeDays) && i.newestEventAgeDays > i.staleAfterDays) return { result: 'stale_input_candidate', ...flags };
  return { result: 'replay_ready_reference', ...flags };
}

/* ── 6) Replay Gap Detection(이벤트 시퀀스 분석) ─────────────────────── */
export function detectReplayGaps(events: { seq: number; occurredAt: Date | null }[] | null): { gapCount: number; duplicateCount: number; orderingVerified: boolean; missingSeqs: number[]; result: 'sequence_clean_reference' | 'gaps_detected_candidate' | 'insufficient_data' } {
  if (events == null || !events.length) return { gapCount: 0, duplicateCount: 0, orderingVerified: false, missingSeqs: [], result: 'insufficient_data' };
  const seqs = events.map((e) => e.seq).sort((a, b) => a - b);
  const missingSeqs: number[] = [];
  let duplicateCount = 0;
  for (let k = 1; k < seqs.length; k += 1) {
    if (seqs[k] === seqs[k - 1]) duplicateCount += 1;
    else for (let m = seqs[k - 1] + 1; m < seqs[k]; m += 1) missingSeqs.push(m);
  }
  const times = events.filter((e) => e.occurredAt != null).map((e) => (e.occurredAt as Date).getTime());
  const orderingVerified = times.length === events.length && times.every((t, k) => k === 0 || t >= times[k - 1]);
  return {
    gapCount: missingSeqs.length, duplicateCount, orderingVerified, missingSeqs: missingSeqs.slice(0, 50),
    result: missingSeqs.length || duplicateCount ? 'gaps_detected_candidate' : 'sequence_clean_reference',
  };
}

/* ── 7) Decision Point(AI 는 생성만 — 결정하지 않음) ─────────────────── */
export function buildDecisionPoint(i: { code: string; context: string; availableOptions: string[]; humanRoleRequired: boolean }):
  | { rejected: true; rejectReason: string }
  | { code: string; context: string; availableOptions: string[]; humanRoleRequired: true; decisionMadeByAi: false; decisionPointIsNotDecision: true } {
  if (!i.code.trim()) return { rejected: true, rejectReason: 'decision_point_code 필수' };
  if (!i.context.trim()) return { rejected: true, rejectReason: 'decision_context 필수' };
  if (i.availableOptions.length < 2) return { rejected: true, rejectReason: '선택지 2개 이상 필수' };
  return { code: i.code, context: i.context, availableOptions: i.availableOptions.slice(0, 20), humanRoleRequired: true, decisionMadeByAi: false, decisionPointIsNotDecision: true };
}

/* ── 8) Branch Condition/Probability(근거 없는 확률 금지) ────────────── */
export function evaluateBranchCondition(i: { transitionType: string; conditionDefined: boolean }): { result: 'condition_valid_reference' | 'transition_type_invalid' | 'condition_missing' | 'unknown_kept'; transitionIsNotRealStateChange: true } {
  const flags = { transitionIsNotRealStateChange: true as const };
  if (!(TRANSITION_TYPES as readonly string[]).includes(i.transitionType)) return { result: 'transition_type_invalid', ...flags };
  if (i.transitionType === 'unknown') return { result: 'unknown_kept', ...flags };
  if (!i.conditionDefined) return { result: 'condition_missing', ...flags };
  return { result: 'condition_valid_reference', ...flags };
}

export function calculateBranchProbabilityCandidate(i: { historicalOccurrences: number | null; historicalSample: number | null; minSample: number; basisDescribed: boolean }): { probabilityCandidate: number | null; result: 'probability_candidate_estimated' | 'branch_probability_unverified' | 'sample_too_small' | 'insufficient_data'; probabilityIsNotTrueProbability: true; estimatedIsNotMeasured: true } {
  const flags = { probabilityIsNotTrueProbability: true as const, estimatedIsNotMeasured: true as const };
  if (!i.basisDescribed) return { probabilityCandidate: null, result: 'branch_probability_unverified', ...flags };   // 근거 없는 확률 표시 금지
  if (i.historicalOccurrences == null || !isFiniteNumber(i.historicalOccurrences) || i.historicalSample == null || !isFiniteNumber(i.historicalSample) || i.historicalSample <= 0) return { probabilityCandidate: null, result: 'insufficient_data', ...flags };
  if (i.historicalSample < i.minSample) return { probabilityCandidate: null, result: 'sample_too_small', ...flags };
  return { probabilityCandidate: clampScore((i.historicalOccurrences / i.historicalSample) * 100), result: 'probability_candidate_estimated', ...flags };
}

/* ── 9) Horizon Confidence Cap(기간이 길수록 상한 하락) ──────────────── */
export function horizonConfidenceCap(horizonMinutes: number | null): { cap: number | null; result: 'cap_applied' | 'insufficient_data' } {
  if (horizonMinutes == null || !isFiniteNumber(horizonMinutes) || horizonMinutes <= 0) return { cap: null, result: 'insufficient_data' };
  const days = horizonMinutes / 1440;
  if (days <= 1) return { cap: 90, result: 'cap_applied' };
  if (days <= 7) return { cap: 75, result: 'cap_applied' };
  if (days <= 30) return { cap: 60, result: 'cap_applied' };
  if (days <= 90) return { cap: 40, result: 'cap_applied' };
  return { cap: 25, result: 'cap_applied' };
}

/* ── 10) Multi-Future 생성(Future ≠ Fact) ────────────────────────────── */
export function generateMultiFutureSet(i: { requestedCases: string[]; baselineAvailable: boolean; horizonMinutes: number | null }): { cases: { caseType: string; confidenceCap: number | null; status: 'case_defined_reference' | 'case_type_invalid' }[]; result: 'multi_future_defined_reference' | 'baseline_missing' | 'no_valid_case' | 'insufficient_data'; futureIsNotFact: true; bestCaseIsNotExpectedOutcome: true; worstCaseIsNotGuaranteedFailure: true; baseCaseIsNotMostLikelyFact: true } {
  const flags = { futureIsNotFact: true as const, bestCaseIsNotExpectedOutcome: true as const, worstCaseIsNotGuaranteedFailure: true as const, baseCaseIsNotMostLikelyFact: true as const };
  if (!i.baselineAvailable) return { cases: [], result: 'baseline_missing', ...flags };
  if (i.horizonMinutes == null || !isFiniteNumber(i.horizonMinutes)) return { cases: [], result: 'insufficient_data', ...flags };
  const cap = horizonConfidenceCap(i.horizonMinutes).cap;
  const cases = i.requestedCases.slice(0, 14).map((c) => ({
    caseType: c,
    confidenceCap: (FUTURE_CASE_TYPES as readonly string[]).includes(c) ? cap : null,
    status: (FUTURE_CASE_TYPES as readonly string[]).includes(c) ? 'case_defined_reference' as const : 'case_type_invalid' as const,
  }));
  return { cases, result: cases.some((c) => c.status === 'case_defined_reference') ? 'multi_future_defined_reference' : 'no_valid_case', ...flags };
}

/* ── 11) Scenario Risk/Opportunity Projection(후보 — 사실 아님) ──────── */
export function projectScenarioRisk(i: { incidentProbabilityCandidate: number | null; failureChainDetected: boolean; singlePointOfFailure: boolean; recoveryDifficultyHigh: boolean | null; reviewed: boolean }): { result: (typeof SCENARIO_RISK_RESULTS)[number]; noDetectedRiskIsNotNoRisk: true; riskIsNotFact: true } {
  const flags = { noDetectedRiskIsNotNoRisk: true as const, riskIsNotFact: true as const };
  if (!i.reviewed) return { result: 'risk_unverified', ...flags };
  if (i.failureChainDetected) return { result: 'cascading_failure_candidate', ...flags };
  if (i.singlePointOfFailure) return { result: 'single_point_of_failure_candidate', ...flags };
  if (i.incidentProbabilityCandidate == null || !isFiniteNumber(i.incidentProbabilityCandidate)) return { result: 'insufficient_data', ...flags };
  const p = i.incidentProbabilityCandidate;
  if (p >= 80 || (p >= 60 && i.recoveryDifficultyHigh === true)) return { result: 'critical_risk_candidate', ...flags };
  if (p >= 50) return { result: 'high_risk_candidate', ...flags };
  if (p >= 20) return { result: 'moderate_risk_candidate', ...flags };
  if (p > 0) return { result: 'low_risk_candidate', ...flags };
  return { result: 'negligible_risk_candidate', ...flags };
}

export function projectScenarioOpportunity(i: { reviewed: boolean; costReduction: boolean | null; capacityIncrease: boolean | null; fasterRecovery: boolean | null; adverseSignals: number | null; evidenceCount: number }): { result: (typeof SCENARIO_OPPORTUNITY_RESULTS)[number]; opportunityIsNotActualBenefit: true } {
  const flags = { opportunityIsNotActualBenefit: true as const };
  if (!i.reviewed) return { result: 'opportunity_unverified', ...flags };
  const positives = [i.costReduction, i.capacityIncrease, i.fasterRecovery].filter((x) => x === true).length;
  const unknowns = [i.costReduction, i.capacityIncrease, i.fasterRecovery].filter((x) => x == null).length;
  if (positives > 0 && i.evidenceCount <= 0) return { result: 'opportunity_unverified', ...flags };
  if (i.adverseSignals != null && isFiniteNumber(i.adverseSignals) && i.adverseSignals > 0 && positives > 0) return { result: 'mixed_opportunity_candidate', ...flags };
  if (i.adverseSignals != null && isFiniteNumber(i.adverseSignals) && i.adverseSignals > 0) return { result: 'adverse_tradeoff_candidate', ...flags };
  if (positives >= 2) return { result: 'opportunity_candidate', ...flags };
  if (positives === 1) return { result: 'limited_opportunity_candidate', ...flags };
  if (unknowns === 3) return { result: 'insufficient_data', ...flags };
  return { result: 'no_material_opportunity_candidate', ...flags };
}

/* ── 12) Cross-Scenario Comparison(자동 승자 없음) ───────────────────── */
export function compareScenarioFutures(runs: { runCode: string; scopeType: string; horizonMinutes: number | null; templateVersion: number; dimensions: Record<string, number | null> }[] | null): { result: 'comparison_ready_reference' | 'comparison_partial' | 'incomparable_scope' | 'incomparable_horizon' | 'incompatible_version' | 'insufficient_runs' | 'insufficient_data'; comparableDimensions: string[]; unverifiedDimensions: string[]; comparisonIsNotAutomaticRanking: true; winnerIsNotSelectedDecision: true; autoSelected: false } {
  const flags = { comparisonIsNotAutomaticRanking: true as const, winnerIsNotSelectedDecision: true as const, autoSelected: false as const };
  if (runs == null || runs.length < 2) return { result: 'insufficient_runs', comparableDimensions: [], unverifiedDimensions: [], ...flags };
  if (runs.length > 20) return { result: 'insufficient_data', comparableDimensions: [], unverifiedDimensions: [], ...flags };
  if (new Set(runs.map((r) => r.scopeType)).size > 1) return { result: 'incomparable_scope', comparableDimensions: [], unverifiedDimensions: [], ...flags };
  const horizons = runs.map((r) => r.horizonMinutes);
  if (horizons.some((h) => h == null)) return { result: 'insufficient_data', comparableDimensions: [], unverifiedDimensions: [], ...flags };
  if (new Set(horizons).size > 1) return { result: 'incomparable_horizon', comparableDimensions: [], unverifiedDimensions: [], ...flags };
  if (new Set(runs.map((r) => r.templateVersion)).size > 1) return { result: 'incompatible_version', comparableDimensions: [], unverifiedDimensions: [], ...flags };
  const comparableDimensions = (SCENARIO_COMPARISON_DIMENSIONS as readonly string[]).filter((d) => runs.every((r) => isFiniteNumber(r.dimensions[d])));
  const unverifiedDimensions = (SCENARIO_COMPARISON_DIMENSIONS as readonly string[]).filter((d) => !comparableDimensions.includes(d));   // 결측 차원 unverified 유지 — 보간 없음
  if (!comparableDimensions.length) return { result: 'insufficient_data', comparableDimensions, unverifiedDimensions, ...flags };
  return { result: unverifiedDimensions.length ? 'comparison_partial' : 'comparison_ready_reference', comparableDimensions, unverifiedDimensions, ...flags };
}

/* ── 13) Trade-off(Score ≠ Business Value) ───────────────────────────── */
export function evaluateTradeoffs(pairs: { type: string; gain: number | null; loss: number | null }[] | null): { rows: { type: string; result: (typeof TRADEOFF_RESULTS)[number] }[]; tradeoffScoreIsNotBusinessValue: true } {
  const rows = (pairs ?? []).slice(0, 10).map((p) => {
    if (!(TRADEOFF_TYPES as readonly string[]).includes(p.type)) return { type: p.type, result: 'insufficient_data' as const };
    if (p.gain == null || !isFiniteNumber(p.gain) || p.loss == null || !isFiniteNumber(p.loss)) return { type: p.type, result: 'tradeoff_unverified' as const };
    if (p.gain > 0 && p.loss <= 0) return { type: p.type, result: 'favorable_tradeoff_candidate' as const };
    if (p.gain <= 0 && p.loss > 0) return { type: p.type, result: 'unfavorable_tradeoff_candidate' as const };
    if (p.gain > 0 && p.loss > 0) return { type: p.type, result: 'mixed_tradeoff_candidate' as const };
    return { type: p.type, result: 'balanced_tradeoff_candidate' as const };
  });
  return { rows, tradeoffScoreIsNotBusinessValue: true };
}

/* ── 14) Robustness(Robust ≠ Correct) ────────────────────────────────── */
export function evaluateRobustness(i: { bestCaseScore: number | null; baseCaseScore: number | null; worstCaseScore: number | null; acceptableFloor: number; sensitivityHigh: boolean | null }): { result: (typeof ROBUSTNESS_RESULTS)[number]; robustOptionIsNotCorrectOption: true } {
  const flags = { robustOptionIsNotCorrectOption: true as const };
  const scores = [i.bestCaseScore, i.baseCaseScore, i.worstCaseScore];
  if (scores.some((s) => s == null || !isFiniteNumber(s))) return { result: 'robustness_unverified', ...flags };
  const [best, base, worst] = scores as number[];
  if (i.sensitivityHigh == null) return { result: 'robustness_unverified', ...flags };
  if (worst >= i.acceptableFloor && base >= i.acceptableFloor && !i.sensitivityHigh) return { result: 'robust_option_candidate', ...flags };
  if (worst >= i.acceptableFloor && i.sensitivityHigh) return { result: 'conditionally_robust_candidate', ...flags };
  if (best >= i.acceptableFloor && worst < i.acceptableFloor && base < i.acceptableFloor) return { result: 'scenario_specific_candidate', ...flags };
  if (worst < i.acceptableFloor) return { result: 'fragile_option_candidate', ...flags };
  return { result: 'conditionally_robust_candidate', ...flags };
}

/* ── 15) Regret(Lowest Regret ≠ Best Decision) ───────────────────────── */
export function evaluateRegret(i: { chosenOutcome: number | null; bestAlternativeOutcome: number | null; worstCaseLoss: number | null; reversible: boolean | null; alternativesEvaluated: number }): { regretGap: number | null; result: (typeof REGRET_RESULTS)[number]; lowestRegretIsNotBestDecision: true } {
  const flags = { lowestRegretIsNotBestDecision: true as const };
  if (i.alternativesEvaluated <= 0) return { regretGap: null, result: 'regret_unverified', ...flags };   // 대안 미평가 — 후회 판정 불가
  if (i.chosenOutcome == null || !isFiniteNumber(i.chosenOutcome) || i.bestAlternativeOutcome == null || !isFiniteNumber(i.bestAlternativeOutcome)) return { regretGap: null, result: 'insufficient_data', ...flags };
  const regretGap = Math.round((i.bestAlternativeOutcome - i.chosenOutcome) * 100) / 100;
  if (i.worstCaseLoss != null && isFiniteNumber(i.worstCaseLoss) && i.reversible === false && i.worstCaseLoss > Math.abs(regretGap) * 2) return { regretGap, result: 'asymmetric_regret_candidate', ...flags };
  if (regretGap <= 0) return { regretGap, result: 'lowest_regret_candidate', ...flags };
  if (regretGap <= 5) return { regretGap, result: 'low_regret_candidate', ...flags };
  if (regretGap <= 20) return { regretGap, result: 'moderate_regret_candidate', ...flags };
  return { regretGap, result: 'high_regret_candidate', ...flags };
}

/* ── 16) Common Risk/Safe Condition(교집합 — Scenario 간 공통) ───────── */
export function detectCommonRisks(perRunRisks: string[][] | null): { commonRisks: string[]; result: 'common_risks_detected_candidate' | 'no_common_risk_detected' | 'insufficient_data'; noDetectedRiskIsNotNoRisk: true } {
  if (perRunRisks == null || perRunRisks.length < 2) return { commonRisks: [], result: 'insufficient_data', noDetectedRiskIsNotNoRisk: true };
  const commonRisks = perRunRisks.reduce((acc, list) => acc.filter((r) => list.includes(r)));
  return { commonRisks: commonRisks.slice(0, 30), result: commonRisks.length ? 'common_risks_detected_candidate' : 'no_common_risk_detected', noDetectedRiskIsNotNoRisk: true };
}

export function detectCommonSafeConditions(perRunSafe: string[][] | null): { commonSafeConditions: string[]; result: 'common_safe_conditions_candidate' | 'no_common_safe_condition' | 'insufficient_data'; safeConditionIsCandidateOnly: true } {
  if (perRunSafe == null || perRunSafe.length < 2) return { commonSafeConditions: [], result: 'insufficient_data', safeConditionIsCandidateOnly: true };
  const common = perRunSafe.reduce((acc, list) => acc.filter((r) => list.includes(r)));
  return { commonSafeConditions: common.slice(0, 30), result: common.length ? 'common_safe_conditions_candidate' : 'no_common_safe_condition', safeConditionIsCandidateOnly: true };
}

/* ── 17) Outcome/Accuracy/Drift(Outcome ≠ 인과 증명) ─────────────────── */
export function evaluateScenarioOutcome(i: { outcomeLinked: boolean; observationComplete: boolean | null; externalFactorsReviewed: boolean; sampleSize: number | null; minSample: number }): { result: 'outcome_linked_reference' | 'outcome_pending' | 'observation_partial' | 'causality_unverified' | 'sample_too_small' | 'insufficient_data'; outcomeIsNotCausalityProof: true } {
  const flags = { outcomeIsNotCausalityProof: true as const };
  if (!i.outcomeLinked) return { result: 'outcome_pending', ...flags };
  if (i.sampleSize == null || !isFiniteNumber(i.sampleSize) || i.sampleSize < 0) return { result: 'insufficient_data', ...flags };
  if (i.sampleSize < i.minSample) return { result: 'sample_too_small', ...flags };
  if (i.observationComplete !== true) return { result: 'observation_partial', ...flags };
  if (!i.externalFactorsReviewed) return { result: 'causality_unverified', ...flags };
  return { result: 'outcome_linked_reference', ...flags };
}

export function calculateScenarioAccuracyCandidate(i: { predicted: number | null; observed: number | null; toleranceRatio: number; outcomeLinked: boolean; sampleSize: number | null; minSample: number }): { result: (typeof ACCURACY_RESULTS)[number]; relativeError: number | null; accuracyCandidateIsNotVerifiedAccuracy: true } {
  const flags = { accuracyCandidateIsNotVerifiedAccuracy: true as const };
  if (!i.outcomeLinked) return { result: 'outcome_unverified', relativeError: null, ...flags };
  if (i.sampleSize == null || !isFiniteNumber(i.sampleSize)) return { result: 'insufficient_data', relativeError: null, ...flags };
  if (i.sampleSize < i.minSample) return { result: 'sample_too_small', relativeError: null, ...flags };
  if (i.predicted == null || !isFiniteNumber(i.predicted) || i.observed == null || !isFiniteNumber(i.observed)) return { result: 'accuracy_unverified', relativeError: null, ...flags };
  if (i.observed === 0 && i.predicted === 0) return { result: 'accuracy_candidate_high', relativeError: 0, ...flags };
  if (i.observed === 0) return { result: 'direction_match_only', relativeError: null, ...flags };
  const relativeError = Math.round(Math.abs(i.predicted - i.observed) / Math.abs(i.observed) * 1000) / 1000;
  const directionMatch = (i.predicted >= 0) === (i.observed >= 0);
  if (relativeError <= i.toleranceRatio) return { result: 'accuracy_candidate_high', relativeError, ...flags };
  if (relativeError <= i.toleranceRatio * 2) return { result: 'accuracy_candidate_moderate', relativeError, ...flags };
  if (relativeError <= i.toleranceRatio * 4) return { result: 'accuracy_candidate_low', relativeError, ...flags };
  if (directionMatch) return { result: 'direction_match_only', relativeError, ...flags };
  return { result: 'range_match_only', relativeError, ...flags };
}

export function calculateScenarioDriftCandidate(dims: { dimension: string; driftRatio: number | null }[] | null): { result: (typeof DRIFT_RESULTS)[number]; driftedDimensions: string[]; driftCandidateIsNotConfirmedFailure: true } {
  const flags = { driftCandidateIsNotConfirmedFailure: true as const };
  if (dims == null || !dims.length) return { result: 'insufficient_data', driftedDimensions: [], ...flags };
  const measured = dims.filter((d) => d.driftRatio != null && isFiniteNumber(d.driftRatio));
  if (!measured.length) return { result: 'drift_unverified', driftedDimensions: [], ...flags };
  const drifted = measured.filter((d) => Math.abs(d.driftRatio as number) > 0.1);
  const severe = measured.filter((d) => Math.abs(d.driftRatio as number) > 0.5);
  const driftedDimensions = drifted.map((d) => d.dimension).slice(0, 20);
  if (severe.length >= 3) return { result: 'structural_drift_candidate', driftedDimensions, ...flags };
  if (severe.length > 0) return { result: 'severe_drift_candidate', driftedDimensions, ...flags };
  if (drifted.length >= 3) return { result: 'moderate_drift_candidate', driftedDimensions, ...flags };
  if (drifted.length > 0) return { result: 'minor_drift_candidate', driftedDimensions, ...flags };
  return { result: 'no_material_drift_candidate', driftedDimensions, ...flags };
}

/* ── 18) Recommendation(제안 전용 — Evidence 필수) ───────────────────── */
export function buildScenarioRecommendation(i: { type: string; reason: string; evidence: string[]; confidence: number | null; alternatives?: string[]; limitations?: string[] }):
  | { rejected: true; rejectReason: string }
  | { type: string; reason: string; evidence: string[]; confidence: number; alternatives: string[]; limitations: string[]; isRecommendationOnly: true; recommendationIsNotDecision: true; humanApprovalRequired: true; autoExecuted: false } {
  if (!(SCENARIO_RECOMMENDATION_TYPES as readonly string[]).includes(i.type)) return { rejected: true, rejectReason: '허용되지 않는 recommendation type' };
  if (!i.reason.trim()) return { rejected: true, rejectReason: 'reason 필수' };
  if (!i.evidence.length) return { rejected: true, rejectReason: 'Evidence 없는 추천 금지' };
  return {
    type: i.type, reason: i.reason, evidence: i.evidence.slice(0, 20),
    confidence: clampScore(i.confidence ?? 0),
    alternatives: (i.alternatives ?? []).slice(0, 10), limitations: (i.limitations ?? []).slice(0, 10),
    isRecommendationOnly: true, recommendationIsNotDecision: true, humanApprovalRequired: true, autoExecuted: false,
  };
}

/* ── 19) Scenario Timeline(측정 카운트 — 완료 주장 아님) ─────────────── */
export function buildScenarioTimeline(counts: { stage: string; count: number | null; source: string }[] | null): { stages: { stage: string; count: number | null; source: string; status: 'measured' | 'insufficient_data' }[]; invalidStages: number; timelineIsNotActualSchedule: true } {
  const rows = (counts ?? []).filter((c) => (SCENARIO_TIMELINE_STAGES as readonly string[]).includes(c.stage));
  return {
    stages: rows.map((c) => ({ stage: c.stage, count: isFiniteNumber(c.count) && (c.count as number) >= 0 ? c.count : null, source: c.source, status: isFiniteNumber(c.count) && (c.count as number) >= 0 ? 'measured' as const : 'insufficient_data' as const })),
    invalidStages: (counts ?? []).length - rows.length,
    timelineIsNotActualSchedule: true,
  };
}

/* ── 실측 구성요소·지원 매트릭스(추측 없음) ──────────────────────────── */
export const SCENARIO_COMPONENTS: { key: string; available: boolean | null; note: string }[] = [
  { key: 'runtime_event_sequence_0536', available: true, note: 'ai_runtime_execution_events(30종·created_at 순서) — Replay 원천' },
  { key: 'incident_timeline_0502_0537', available: true, note: 'ai_incidents + ai_runtime_incident_candidates(first/last_detected_at)' },
  { key: 'postmortem_timeline_0538', available: true, note: 'ai_runtime_postmortems + learning events' },
  { key: 'policy_simulation_0539', available: true, note: 'ai_policy_simulation_runs — Policy Change Replay 원천' },
  { key: 'twin_runs_0540', available: true, note: 'ai_enterprise_twin_runs — Snapshot/Scenario 연계' },
  { key: 'decision_outcome_0514', available: true, note: 'ai_decision_memory/outcomes — Decision Outcome History' },
  { key: 'post_change_observations_0506', available: true, note: 'Rollout Observation 원천' },
  { key: 'commitment_events_0520', available: true, note: 'Approval Timeline 참조' },
  { key: 'capacity_cost_history_0508', available: true, note: 'ai_capacity_metrics/ai_cost_models — Cost/Capacity Snapshot History' },
  { key: 'true_probability_model', available: false, note: '실제 확률 모델 없음 — Branch Probability 는 Candidate(근거 필수)' },
  { key: 'chaos_engine', available: false, note: 'Chaos Engineering 엔진 없음 — 실제 Failure Injection 불가(구조적 차단)' },
  { key: 'production_replay_engine', available: false, note: 'Production Replay 없음 — Replay 는 저장 이력 Reference 만' },
  { key: 'provider_state_feed', available: false, note: 'Provider 상태 피드 없음 — provider_failure 는 partially_supported' },
  { key: 'region_outage_feed', available: false, note: 'Region 장애 피드 없음' },
  { key: 'human_absence_calendar', available: false, note: '휴가/캘린더 데이터 없음' },
];

export const SCENARIO_SUPPORT_MATRIX: { key: string; status: string; note: string }[] = [
  { key: 'scenario_template', status: 'fully_supported', note: '23 도메인·금지 13종 차단·Template ≠ Execution' },
  { key: 'template_versioning', status: 'fully_supported', note: '새 버전 행 생성(원본 불변)·호환성 6종·버전별 결과 상이 명시' },
  { key: 'historical_incident_source', status: 'read_only', note: '0502/0537/0538 읽기 전용 참조' },
  { key: 'historical_runtime_source', status: 'read_only', note: '0536 이벤트 시퀀스 읽기 전용' },
  { key: 'historical_replay', status: 'replay_only', note: '저장 이력 Reference 재생 — Replay ≠ Reoccurrence' },
  { key: 'replay_gap_detection', status: 'fully_supported', note: 'seq gap/duplicate/ordering 분석' },
  { key: 'scenario_variables', status: 'fully_supported', note: '14 타입·NaN/Infinity/음수/범위 차단·Unknown 유지·최대 100' },
  { key: 'scenario_injection_reference', status: 'reference_only', note: '실제 장애 주입 아님 — 13 판정' },
  { key: 'timeline', status: 'simulation_only', note: 'Events+JSONB 통합·최대 500 step·Timeline ≠ Actual Schedule' },
  { key: 'decision_points', status: 'human_review_only', note: 'AI 는 생성만 — 결정하지 않음' },
  { key: 'branching', status: 'simulation_only', note: 'Depth≤6·Count≤100·미실행 completed 차단' },
  { key: 'conditional_transition', status: 'simulation_only', note: '14 타입 — 실제 상태 전환 아님' },
  { key: 'multi_future', status: 'prediction_only', note: '14 case 타입 — Future ≠ Fact' },
  { key: 'base_best_worst_no_action', status: 'prediction_only', note: '전부 Candidate — 확정 미래 아님' },
  { key: 'risk_projection', status: 'prediction_only', note: 'cascading/SPOF 후보 포함 — No Detected Risk ≠ No Risk' },
  { key: 'opportunity_projection', status: 'prediction_only', note: 'Evidence 없는 기회 주장 차단' },
  { key: 'cost_projection', status: 'prediction_only', note: '0540 projectCost 재사용 — 모델 없으면 cost_model_missing' },
  { key: 'capacity_projection', status: 'prediction_only', note: '0540 projectCapacity 재사용' },
  { key: 'queue_projection', status: 'prediction_only', note: '0540 proxy 재사용(범용 Queue 없음)' },
  { key: 'incident_projection', status: 'prediction_only', note: '0540 재사용 — sample_too_small 유지' },
  { key: 'human_workload_projection', status: 'prediction_only', note: '0540 재사용 — 인사 판단 없음' },
  { key: 'cross_scenario_comparison', status: 'comparison_only', note: 'Run 2~20·scope/horizon/version 검증·자동 승자 없음' },
  { key: 'tradeoff_analysis', status: 'comparison_only', note: '10 타입 — Score ≠ Business Value' },
  { key: 'robustness_analysis', status: 'comparison_only', note: 'Robust ≠ Correct' },
  { key: 'regret_analysis', status: 'comparison_only', note: '대안 미평가 시 unverified — Lowest Regret ≠ Best Decision' },
  { key: 'common_risk_detection', status: 'comparison_only', note: '교집합 후보 — 미검출 ≠ 무위험' },
  { key: 'common_safe_condition_detection', status: 'comparison_only', note: '후보만' },
  { key: 'scenario_recommendation', status: 'human_review_only', note: '23 타입·Evidence 필수 — Recommendation ≠ Decision' },
  { key: 'human_review', status: 'fully_supported', note: 'Template/Replay/Branch/Comparison/Recommendation/Outcome 워크플로' },
  { key: 'decision_reference', status: 'reference_only', note: 'Decision Reference ≠ Decision' },
  { key: 'observed_outcome_reference', status: 'outcome_reference_only', note: '인과관계 증명 아님' },
  { key: 'accuracy_candidate', status: 'outcome_reference_only', note: 'Outcome 연결 후에만 — Verified Accuracy 아님' },
  { key: 'drift_candidate', status: 'outcome_reference_only', note: '장기 관측 필요 — Confirmed Failure 아님' },
  { key: 'scenario_audit', status: 'fully_supported', note: 'ai_enterprise_scenario_events 29종' },
  { key: 'automatic_scenario_selection', status: 'unsupported', note: '자동 Scenario 선택 없음' },
  { key: 'automatic_executive_decision', status: 'unsupported', note: '자동 Decision 없음' },
  { key: 'automatic_runtime_execution', status: 'unsupported', note: '실제 Runtime 실행 없음' },
  { key: 'automatic_connector_execution', status: 'unsupported', note: '실제 Connector 실행 없음' },
  { key: 'automatic_agent_execution', status: 'unsupported', note: '실제 Agent 실행 없음' },
  { key: 'automatic_policy_application', status: 'unsupported', note: '실제 Policy 적용 없음' },
  { key: 'automatic_failure_injection', status: 'unsupported', note: 'Failure Injection 없음 — 금지 도메인/모드 서버 차단' },
  { key: 'automatic_chaos_test', status: 'unsupported', note: 'Chaos Test 없음' },
  { key: 'automatic_rollout_rollback', status: 'unsupported', note: 'Rollout/Rollback 없음' },
  { key: 'automatic_production_mutation', status: 'unsupported', note: 'Production 변경 없음 — 해당 RPC 자체가 없음' },
];
