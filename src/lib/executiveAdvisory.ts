/**
 * executiveAdvisory — Autonomous Executive Advisory, Decision Synthesis &
 * Human Approval Center 순수 로직 (Phase AI-OPS-40).
 *
 * Enterprise State → Decision Context → Evidence → Multi-Agent Advisory →
 * Decision Option Synthesis → Policy Constraint → Impact/Trade-off/Robustness/Regret →
 * Reversibility/Feasibility → Executive Brief → Recommendation Candidate →
 * Human Executive Review → Decision/Commitment/Outcome Reference →
 * Decision Quality/Drift → Decision Learning → Audit.
 *
 * 정직성(전부 코드로 강제):
 *  - Advisory ≠ Decision. Recommendation Candidate ≠ Approved Recommendation.
 *  - Executive Brief ≠ Executive Approval. Option ≠ Selected Option.
 *  - Agent Agreement ≠ Truth. Agent Majority ≠ Correctness. Agent Conflict ≠ Error.
 *  - Evidence Volume ≠ Evidence Quality. Confidence ≠ Correctness.
 *  - Financial Impact Candidate ≠ Accounting Fact. Reversibility ≠ Rollback Guarantee.
 *  - Robust Option ≠ Correct Option. Lowest Regret ≠ Best Decision.
 *  - Approval Reference ≠ Applied Change(production_applied 항상 false).
 *  - Outcome Link ≠ Decision Causality. Quality Candidate ≠ Verified Quality.
 *  - Unknown 유지(null→0 금지) · deterministic · pure · NaN/Infinity 방어 · Date 주입.
 */
import { isFiniteNumber, clampScore } from './aiMemory';

/* ── 상수(0544 CHECK와 1:1 정렬) ─────────────────────────────────────── */
export const DECISION_DOMAINS = ['operational_risk', 'incident_response', 'runtime_reliability', 'connector_governance', 'automation_governance', 'agent_governance', 'policy_change', 'security_risk', 'privacy_risk', 'compliance_risk', 'capacity_planning', 'cost_management', 'resource_allocation', 'approval_bottleneck', 'recovery_strategy', 'enterprise_growth', 'new_enterprise_onboarding', 'new_connector_adoption', 'rollout_strategy', 'contract_risk_reference', 'settlement_impact_reference', 'payment_impact_reference', 'customer_experience', 'store_operations', 'organizational_workload', 'strategic_priority', 'custom_reference'] as const;
export const BLOCKED_DECISION_DOMAINS = ['automatic_investment_execution', 'automatic_payment_approval', 'automatic_contract_signature', 'automatic_employee_hiring', 'automatic_employee_termination', 'automatic_compensation_decision', 'automatic_credit_decision', 'automatic_legal_decision', 'automatic_medical_decision', 'automatic_production_change', 'automatic_policy_application', 'automatic_infrastructure_purchase', 'personal_behavior_decision'] as const;
export const DECISION_STATUSES = ['draft', 'pending_evidence', 'pending_advisory', 'pending_review', 'ready_for_executive_review_reference', 'under_executive_review', 'revision_requested', 'deferred_reference', 'approved_reference', 'rejected_reference', 'superseded', 'invalidated', 'outcome_pending', 'closed_reference', 'closed_with_limitation', 'insufficient_data'] as const;
export const DECISION_PRIORITY_CANDIDATES = ['informational_candidate', 'low_candidate', 'normal_candidate', 'high_candidate', 'critical_candidate', 'priority_unverified', 'insufficient_data'] as const;
export const DECISION_URGENCY_CANDIDATES = ['no_deadline_candidate', 'routine_candidate', 'time_sensitive_candidate', 'urgent_candidate', 'immediate_review_candidate', 'urgency_unverified', 'insufficient_data'] as const;
export const DECISION_OPTION_TYPES = ['no_action_reference', 'defer_reference', 'gather_more_evidence_reference', 'monitor_reference', 'limited_action_reference', 'phased_action_reference', 'reversible_action_reference', 'policy_change_reference', 'rollout_reference', 'rollback_reference', 'capacity_change_reference', 'cost_control_reference', 'governance_change_reference', 'operational_change_reference', 'escalation_reference', 'custom_reference'] as const;
export const BLOCKED_OPTION_TYPES = ['direct_production_execution', 'automatic_payment', 'automatic_contract_execution', 'automatic_employee_action', 'automatic_policy_apply', 'automatic_infrastructure_purchase'] as const;
export const DECISION_OPTION_STATUSES = ['draft', 'pending_evidence', 'pending_review', 'viable_candidate', 'conditionally_viable_candidate', 'blocked_candidate', 'infeasible_candidate', 'rejected_reference', 'superseded', 'invalidated', 'insufficient_data'] as const;
export const ADVISORY_SYNTHESIS_RESULTS = ['advisory_ready_reference', 'advisory_partial', 'advisory_conflict_candidate', 'advisory_consensus_candidate', 'advisory_majority_candidate', 'specialist_missing', 'shared_evidence_dependency_candidate', 'circular_reasoning_candidate', 'advisory_input_unavailable', 'insufficient_data'] as const;
export const AGENT_AGREEMENT_RESULTS = ['strong_agreement_candidate', 'moderate_agreement_candidate', 'weak_agreement_candidate', 'split_opinion_candidate', 'agreement_unverified', 'insufficient_data'] as const;
export const AGENT_CONFLICT_RESULTS = ['no_material_conflict_candidate', 'minor_conflict_candidate', 'moderate_conflict_candidate', 'major_conflict_candidate', 'structural_conflict_candidate', 'conflict_unverified', 'insufficient_data'] as const;
export const EVIDENCE_QUALITY_RESULTS = ['evidence_ready_reference', 'evidence_partial', 'evidence_stale_candidate', 'evidence_conflict_candidate', 'evidence_duplicate_candidate', 'evidence_circularity_candidate', 'evidence_scope_mismatch', 'evidence_version_mismatch', 'evidence_missing', 'insufficient_data'] as const;
export const CONSTRAINT_RESULTS = ['constraint_clear_reference', 'conditional_constraint_candidate', 'approval_required_reference', 'secondary_review_required_reference', 'option_blocked_by_policy', 'option_blocked_by_constitution', 'option_blocked_by_compliance', 'option_blocked_by_contract', 'option_blocked_by_scope', 'constraint_unverified', 'insufficient_data'] as const;
export const IMPACT_SYNTHESIS_RESULTS = ['isolated_impact_candidate', 'limited_impact_candidate', 'multi_domain_impact_candidate', 'enterprise_wide_impact_candidate', 'adverse_impact_candidate', 'mixed_impact_candidate', 'impact_unverified', 'insufficient_data'] as const;
export const FINANCIAL_IMPACT_RESULTS = ['favorable_financial_candidate', 'neutral_financial_candidate', 'adverse_financial_candidate', 'mixed_financial_candidate', 'budget_constraint_candidate', 'financial_impact_unverified', 'insufficient_data'] as const;
export const REVERSIBILITY_RESULTS = ['highly_reversible_candidate', 'reversible_with_condition_candidate', 'partially_reversible_candidate', 'difficult_to_reverse_candidate', 'irreversible_candidate', 'reversibility_unverified', 'insufficient_data'] as const;
export const FEASIBILITY_RESULTS = ['feasible_candidate', 'conditionally_feasible_candidate', 'feasibility_blocked_candidate', 'feasibility_unverified', 'insufficient_data'] as const;
export const TRADEOFF_AXES = ['risk_vs_cost', 'risk_vs_opportunity', 'cost_vs_reliability', 'speed_vs_safety', 'growth_vs_stability', 'automation_vs_human_control', 'approval_speed_vs_governance', 'capacity_vs_cost', 'customer_experience_vs_operational_friction', 'short_term_vs_long_term', 'reversibility_vs_time_to_value', 'opportunity_vs_downside'] as const;
export const TRADEOFF_RESULTS = ['favorable_tradeoff_candidate', 'balanced_tradeoff_candidate', 'unfavorable_tradeoff_candidate', 'mixed_tradeoff_candidate', 'tradeoff_unverified', 'insufficient_data'] as const;
export const ROBUSTNESS_RESULTS = ['robust_option_candidate', 'conditionally_robust_candidate', 'fragile_option_candidate', 'scenario_specific_candidate', 'robustness_unverified', 'insufficient_data'] as const;
export const REGRET_RESULTS = ['lowest_regret_candidate', 'low_regret_candidate', 'moderate_regret_candidate', 'high_regret_candidate', 'asymmetric_regret_candidate', 'regret_unverified', 'insufficient_data'] as const;
export const BRIEF_STATUSES = ['draft', 'pending_evidence', 'pending_advisory', 'pending_review', 'ready_for_executive_review_reference', 'under_executive_review', 'revision_requested', 'reviewed_reference', 'superseded', 'invalidated', 'insufficient_data'] as const;
export const EXECUTIVE_RECOMMENDATION_TYPES = ['proceed_with_option_candidate', 'proceed_with_conditions_candidate', 'limited_action_candidate', 'phased_action_candidate', 'reversible_pilot_candidate', 'gather_more_evidence_candidate', 'request_specialist_review_candidate', 'defer_decision_candidate', 'maintain_current_state_candidate', 'monitor_and_review_candidate', 'reject_current_options_candidate', 'create_new_option_candidate', 'resolve_agent_conflict_candidate', 'resolve_evidence_conflict_candidate', 'review_policy_constraint_candidate', 'review_financial_constraint_candidate', 'review_capacity_constraint_candidate', 'review_contract_constraint_candidate', 'review_security_privacy_compliance_candidate', 'insufficient_data'] as const;
export const EXECUTIVE_REVIEW_ACTIONS = ['start_executive_review', 'approve_reference', 'approve_with_conditions_reference', 'reject_reference', 'defer_reference', 'request_revision_reference', 'request_more_evidence_reference', 'request_specialist_review_reference', 'invalidate'] as const;
export const DECISION_QUALITY_RESULTS = ['high_quality_candidate', 'moderate_quality_candidate', 'low_quality_candidate', 'mixed_quality_candidate', 'outcome_unverified', 'causality_unverified', 'sample_too_small', 'insufficient_data'] as const;
export const DECISION_DRIFT_RESULTS = ['no_material_drift_candidate', 'minor_drift_candidate', 'moderate_drift_candidate', 'severe_drift_candidate', 'structural_drift_candidate', 'drift_unverified', 'insufficient_data'] as const;
export const EXECUTIVE_TIMELINE_STAGES = ['decision_context', 'evidence', 'agent_advisory', 'decision_options', 'policy_constraints', 'impact_synthesis', 'executive_brief', 'executive_review', 'decision_reference', 'outcome'] as const;

/* ── 1) Decision Context(≠ Decision) ─────────────────────────────────── */
export function buildDecisionContext(i: { domain: string; title: string; question: string; scopeType: string; deadline: Date | null; now: Date }):
  | { rejected: true; rejectReason: string }
  | { domain: string; title: string; question: string; scopeType: string; status: 'draft'; deadlineDays: number | null; contextIsNotDecision: true; autoApproved: false; productionApplied: false } {
  if ((BLOCKED_DECISION_DOMAINS as readonly string[]).includes(i.domain)) return { rejected: true, rejectReason: `금지 decision domain(${i.domain}) — 구조적 차단` };
  if (!(DECISION_DOMAINS as readonly string[]).includes(i.domain)) return { rejected: true, rejectReason: '허용되지 않는 decision_domain' };
  if (!i.title.trim()) return { rejected: true, rejectReason: 'decision_title 필수' };
  if (!i.question.trim()) return { rejected: true, rejectReason: 'decision_question 필수' };
  const deadlineDays = i.deadline == null ? null : Math.round(((i.deadline.getTime() - i.now.getTime()) / 86400000) * 10) / 10;
  return { domain: i.domain, title: i.title, question: i.question, scopeType: i.scopeType, status: 'draft', deadlineDays, contextIsNotDecision: true, autoApproved: false, productionApplied: false };
}

/* ── 2) Priority Candidate(경영 우선순위 확정 아님) ──────────────────── */
export function evaluateDecisionPriorityCandidate(i: { riskMagnitude: number | null; impactedDomainCount: number | null; delayCostKnown: boolean; regulatoryDeadline: boolean; incidentLinked: boolean; criticalWarningLinked: boolean; irreversibleOptionOnly: boolean; dataCompleteness: number | null }): { score: number | null; result: (typeof DECISION_PRIORITY_CANDIDATES)[number]; priorityIsNotFinalBusinessPriority: true } {
  const flags = { priorityIsNotFinalBusinessPriority: true as const };
  if (i.riskMagnitude == null && i.impactedDomainCount == null) return { score: null, result: 'insufficient_data', ...flags };
  if (i.riskMagnitude != null && !isFiniteNumber(i.riskMagnitude)) return { score: null, result: 'priority_unverified', ...flags };
  if (i.dataCompleteness != null && isFiniteNumber(i.dataCompleteness) && i.dataCompleteness < 30) return { score: null, result: 'priority_unverified', ...flags };
  let score = i.riskMagnitude != null ? clampScore(i.riskMagnitude) : 30;
  if (i.impactedDomainCount != null && isFiniteNumber(i.impactedDomainCount)) score += Math.min(20, Math.max(0, i.impactedDomainCount) * 4);
  if (i.regulatoryDeadline) score += 15;
  if (i.incidentLinked) score += 10;
  if (i.criticalWarningLinked) score += 10;
  if (i.irreversibleOptionOnly) score += 10;
  if (i.delayCostKnown) score += 5;
  score = clampScore(score);
  if (score >= 80) return { score, result: 'critical_candidate', ...flags };
  if (score >= 60) return { score, result: 'high_candidate', ...flags };
  if (score >= 35) return { score, result: 'normal_candidate', ...flags };
  if (score >= 15) return { score, result: 'low_candidate', ...flags };
  return { score, result: 'informational_candidate', ...flags };
}

/* ── 3) Urgency Candidate(자동 승인/실행 아님) ───────────────────────── */
export function evaluateDecisionUrgencyCandidate(i: { deadline: Date | null; now: Date; deadlineVerified: boolean }): { daysRemaining: number | null; result: (typeof DECISION_URGENCY_CANDIDATES)[number]; urgencyIsNotAutomaticApproval: true } {
  const flags = { urgencyIsNotAutomaticApproval: true as const };
  if (i.deadline == null) return { daysRemaining: null, result: 'no_deadline_candidate', ...flags };
  if (!i.deadlineVerified) return { daysRemaining: null, result: 'urgency_unverified', ...flags };
  const days = (i.deadline.getTime() - i.now.getTime()) / 86400000;
  if (!isFiniteNumber(days)) return { daysRemaining: null, result: 'insufficient_data', ...flags };
  const rounded = Math.round(days * 10) / 10;
  if (days <= 1) return { daysRemaining: rounded, result: 'immediate_review_candidate', ...flags };
  if (days <= 7) return { daysRemaining: rounded, result: 'urgent_candidate', ...flags };
  if (days <= 30) return { daysRemaining: rounded, result: 'time_sensitive_candidate', ...flags };
  return { daysRemaining: rounded, result: 'routine_candidate', ...flags };
}

/* ── 4) Evidence Quality(양 ≠ 질) / Gap / Conflict ───────────────────── */
export interface EvidenceItem { key: string; source: string; ageDays: number | null; scopeMatched: boolean; versionMatched: boolean; derivedFromKeys: string[] }
export function evaluateEvidenceQuality(i: { items: EvidenceItem[] | null; staleAfterDays: number }): { total: number; result: (typeof EVIDENCE_QUALITY_RESULTS)[number]; evidenceVolumeIsNotQuality: true } {
  const flags = { evidenceVolumeIsNotQuality: true as const };
  if (i.items == null) return { total: 0, result: 'insufficient_data', ...flags };
  if (!i.items.length) return { total: 0, result: 'evidence_missing', ...flags };
  const keys = new Set(i.items.map((e) => e.key));
  if (i.items.some((e) => e.derivedFromKeys.includes(e.key))) return { total: i.items.length, result: 'evidence_circularity_candidate', ...flags };
  if (i.items.some((e) => !e.scopeMatched)) return { total: i.items.length, result: 'evidence_scope_mismatch', ...flags };
  if (i.items.some((e) => !e.versionMatched)) return { total: i.items.length, result: 'evidence_version_mismatch', ...flags };
  if (keys.size < i.items.length) return { total: i.items.length, result: 'evidence_duplicate_candidate', ...flags };
  if (i.items.some((e) => e.ageDays != null && isFiniteNumber(e.ageDays) && e.ageDays > i.staleAfterDays)) return { total: i.items.length, result: 'evidence_stale_candidate', ...flags };
  if (i.items.some((e) => e.ageDays == null)) return { total: i.items.length, result: 'evidence_partial', ...flags };
  return { total: i.items.length, result: 'evidence_ready_reference', ...flags };
}

export function detectEvidenceGaps(i: { requiredKinds: string[]; presentKinds: string[] }): { missing: string[]; result: 'no_gap_detected_reference' | 'evidence_gap_candidate' | 'insufficient_data'; noDetectedGapIsNotNoGap: true } {
  const flags = { noDetectedGapIsNotNoGap: true as const };
  if (!i.requiredKinds.length) return { missing: [], result: 'insufficient_data', ...flags };
  const present = new Set(i.presentKinds);
  const missing = i.requiredKinds.filter((k) => !present.has(k));
  return { missing, result: missing.length ? 'evidence_gap_candidate' : 'no_gap_detected_reference', ...flags };
}

export function detectEvidenceConflicts(claims: { key: string; value: string; source: string }[] | null): { conflicts: { key: string; values: string[] }[]; result: 'no_conflict_detected_reference' | 'evidence_conflict_candidate' | 'insufficient_data'; noDetectedConflictIsNotNoConflict: true } {
  const flags = { noDetectedConflictIsNotNoConflict: true as const };
  if (claims == null || !claims.length) return { conflicts: [], result: 'insufficient_data', ...flags };
  const byKey = new Map<string, Set<string>>();
  claims.forEach((c) => { const s = byKey.get(c.key) ?? new Set<string>(); s.add(c.value); byKey.set(c.key, s); });
  const conflicts = [...byKey.entries()].filter(([, v]) => v.size > 1).map(([key, v]) => ({ key, values: [...v].sort() }));
  return { conflicts, result: conflicts.length ? 'evidence_conflict_candidate' : 'no_conflict_detected_reference', ...flags };
}

/* ── 5) Multi-Agent Advisory Synthesis(Consensus ≠ Truth) ────────────── */
export interface AgentAdvisoryInput { agentRole: string; recommendedOptionCode: string | null; confidence: number | null; independentEvidence: boolean; dissent: boolean; derivedFromAgentRoles: string[] }
export function synthesizeAgentAdvisory(i: { inputs: AgentAdvisoryInput[] | null; requiredSpecialistRoles: string[] }): { inputCount: number; result: (typeof ADVISORY_SYNTHESIS_RESULTS)[number]; consensusIsNotTruth: true; autoOptionSelected: false } {
  const flags = { consensusIsNotTruth: true as const, autoOptionSelected: false as const };
  if (i.inputs == null) return { inputCount: 0, result: 'insufficient_data', ...flags };
  if (!i.inputs.length) return { inputCount: 0, result: 'advisory_input_unavailable', ...flags };
  const roles = new Set(i.inputs.map((a) => a.agentRole));
  if (i.requiredSpecialistRoles.some((r) => !roles.has(r))) return { inputCount: i.inputs.length, result: 'specialist_missing', ...flags };
  if (i.inputs.some((a) => a.derivedFromAgentRoles.includes(a.agentRole))) return { inputCount: i.inputs.length, result: 'circular_reasoning_candidate', ...flags };
  const independent = i.inputs.filter((a) => a.independentEvidence).length;
  if (independent === 0 && i.inputs.length > 1) return { inputCount: i.inputs.length, result: 'shared_evidence_dependency_candidate', ...flags };
  const opinions = i.inputs.map((a) => a.recommendedOptionCode).filter((o): o is string => o != null);
  if (!opinions.length) return { inputCount: i.inputs.length, result: 'advisory_partial', ...flags };
  const counts = new Map<string, number>();
  opinions.forEach((o) => counts.set(o, (counts.get(o) ?? 0) + 1));
  const top = Math.max(...counts.values());
  if (counts.size > 1 && top <= opinions.length / 2) return { inputCount: i.inputs.length, result: 'advisory_conflict_candidate', ...flags };
  if (counts.size === 1 && opinions.length === i.inputs.length && !i.inputs.some((a) => a.dissent)) return { inputCount: i.inputs.length, result: 'advisory_consensus_candidate', ...flags };
  if (top > opinions.length / 2) return { inputCount: i.inputs.length, result: 'advisory_majority_candidate', ...flags };
  return { inputCount: i.inputs.length, result: 'advisory_ready_reference', ...flags };
}

/* ── 6) Agent Agreement(다수결 자동 선택 없음) ───────────────────────── */
export function evaluateAgentAgreementCandidate(i: { supportRatio: number | null; independentEvidenceRatio: number | null; roleDiversityCount: number | null; dissentExists: boolean }): { result: (typeof AGENT_AGREEMENT_RESULTS)[number]; agentMajorityIsNotCorrectness: true; autoOptionSelected: false } {
  const flags = { agentMajorityIsNotCorrectness: true as const, autoOptionSelected: false as const };
  if (i.supportRatio == null) return { result: 'insufficient_data', ...flags };
  if (!isFiniteNumber(i.supportRatio) || i.supportRatio < 0 || i.supportRatio > 1) return { result: 'agreement_unverified', ...flags };
  if (i.independentEvidenceRatio == null || i.roleDiversityCount == null) return { result: 'agreement_unverified', ...flags };
  if (i.supportRatio <= 0.5) return { result: 'split_opinion_candidate', ...flags };
  if (i.supportRatio >= 0.8 && i.independentEvidenceRatio >= 0.5 && i.roleDiversityCount >= 3 && !i.dissentExists) return { result: 'strong_agreement_candidate', ...flags };
  if (i.supportRatio >= 0.65) return { result: 'moderate_agreement_candidate', ...flags };
  return { result: 'weak_agreement_candidate', ...flags };
}

/* ── 7) Agent Conflict(오류 판정 아님) ───────────────────────────────── */
export function evaluateAgentConflictCandidate(i: { conflictKinds: string[] | null; assumptionConflict: boolean; evidenceConflict: boolean }): { result: (typeof AGENT_CONFLICT_RESULTS)[number]; conflictIsNotError: true } {
  const flags = { conflictIsNotError: true as const };
  if (i.conflictKinds == null) return { result: 'insufficient_data', ...flags };
  const n = i.conflictKinds.length + (i.assumptionConflict ? 1 : 0) + (i.evidenceConflict ? 1 : 0);
  if (n === 0) return { result: 'no_material_conflict_candidate', ...flags };
  if (i.conflictKinds.includes('policy_interpretation') && i.evidenceConflict) return { result: 'structural_conflict_candidate', ...flags };
  if (n >= 4) return { result: 'major_conflict_candidate', ...flags };
  if (n >= 2) return { result: 'moderate_conflict_candidate', ...flags };
  return { result: 'minor_conflict_candidate', ...flags };
}

/* ── 8) Policy/Constitution Constraint(우회 없음) ────────────────────── */
export function evaluatePolicyConstraints(i: { policyBlocked: boolean; constitutionBlocked: boolean; complianceBlocked: boolean; contractBlocked: boolean; scopeBlocked: boolean; approvalRequired: boolean; secondaryReviewRequired: boolean; conditional: boolean; constraintsVerified: boolean }): { result: (typeof CONSTRAINT_RESULTS)[number]; constraintBypassed: false } {
  const flags = { constraintBypassed: false as const };
  if (!i.constraintsVerified) return { result: 'constraint_unverified', ...flags };
  if (i.constitutionBlocked) return { result: 'option_blocked_by_constitution', ...flags };
  if (i.policyBlocked) return { result: 'option_blocked_by_policy', ...flags };
  if (i.complianceBlocked) return { result: 'option_blocked_by_compliance', ...flags };
  if (i.contractBlocked) return { result: 'option_blocked_by_contract', ...flags };
  if (i.scopeBlocked) return { result: 'option_blocked_by_scope', ...flags };
  if (i.secondaryReviewRequired) return { result: 'secondary_review_required_reference', ...flags };
  if (i.approvalRequired) return { result: 'approval_required_reference', ...flags };
  if (i.conditional) return { result: 'conditional_constraint_candidate', ...flags };
  return { result: 'constraint_clear_reference', ...flags };
}

/* ── 9) Decision Option(≠ 실행 계획) ─────────────────────────────────── */
export function buildDecisionOption(i: { optionType: string; name: string; summary: string }):
  | { rejected: true; rejectReason: string }
  | { optionType: string; name: string; isNoAction: boolean; isDefer: boolean; isEvidenceGathering: boolean; status: 'draft'; optionIsNotSelectedOption: true; optionIsNotExecution: true; productionApplied: false } {
  if ((BLOCKED_OPTION_TYPES as readonly string[]).includes(i.optionType)) return { rejected: true, rejectReason: `금지 option_type(${i.optionType}) — 구조적 차단` };
  if (!(DECISION_OPTION_TYPES as readonly string[]).includes(i.optionType)) return { rejected: true, rejectReason: '허용되지 않는 option_type' };
  if (!i.name.trim()) return { rejected: true, rejectReason: 'option_name 필수' };
  return { optionType: i.optionType, name: i.name, isNoAction: i.optionType === 'no_action_reference', isDefer: i.optionType === 'defer_reference', isEvidenceGathering: i.optionType === 'gather_more_evidence_reference', status: 'draft', optionIsNotSelectedOption: true, optionIsNotExecution: true, productionApplied: false };
}

/* ── 10) Feasibility(리소스 예약 아님) ───────────────────────────────── */
export function evaluateOptionFeasibility(i: { technicallyPossible: boolean | null; reviewerAvailable: boolean; budgetReferenceAvailable: boolean | null; capacityAvailable: boolean | null; policyAllowed: boolean; scheduleRealistic: boolean | null }): { result: (typeof FEASIBILITY_RESULTS)[number]; feasibilityIsNotResourceReservation: true } {
  const flags = { feasibilityIsNotResourceReservation: true as const };
  if (i.technicallyPossible == null) return { result: 'feasibility_unverified', ...flags };
  if (!i.policyAllowed || !i.technicallyPossible) return { result: 'feasibility_blocked_candidate', ...flags };
  if (!i.reviewerAvailable) return { result: 'feasibility_blocked_candidate', ...flags };
  if (i.budgetReferenceAvailable == null || i.capacityAvailable == null || i.scheduleRealistic == null) return { result: 'feasibility_unverified', ...flags };
  if (i.budgetReferenceAvailable && i.capacityAvailable && i.scheduleRealistic) return { result: 'feasible_candidate', ...flags };
  return { result: 'conditionally_feasible_candidate', ...flags };
}

/* ── 11) Reversibility(Rollback 보장 아님) ───────────────────────────── */
export function evaluateOptionReversibility(i: { rollbackReferenceExists: boolean | null; rollbackVerified: boolean; dataMutation: boolean; contractualIrreversibility: boolean; costIrreversibility: boolean; customerImpactHigh: boolean }): { result: (typeof REVERSIBILITY_RESULTS)[number]; reversibilityIsNotRollbackGuarantee: true } {
  const flags = { reversibilityIsNotRollbackGuarantee: true as const };
  if (i.rollbackReferenceExists == null) return { result: 'reversibility_unverified', ...flags };
  if (i.contractualIrreversibility || i.costIrreversibility) return { result: 'irreversible_candidate', ...flags };
  if (!i.rollbackReferenceExists) return { result: i.dataMutation ? 'difficult_to_reverse_candidate' : 'partially_reversible_candidate', ...flags };
  if (!i.rollbackVerified) return { result: 'reversible_with_condition_candidate', ...flags };
  if (i.dataMutation || i.customerImpactHigh) return { result: 'reversible_with_condition_candidate', ...flags };
  return { result: 'highly_reversible_candidate', ...flags };
}

/* ── 12) Financial Impact(회계 확정값 아님) ──────────────────────────── */
export function synthesizeFinancialImpact(i: { estimatedCost: number | null; estimatedSavings: number | null; budgetAvailable: boolean | null }): { netCandidate: number | null; result: (typeof FINANCIAL_IMPACT_RESULTS)[number]; financialCandidateIsNotAccountingFact: true } {
  const flags = { financialCandidateIsNotAccountingFact: true as const };
  if (i.estimatedCost == null && i.estimatedSavings == null) return { netCandidate: null, result: 'insufficient_data', ...flags };
  if ((i.estimatedCost != null && !isFiniteNumber(i.estimatedCost)) || (i.estimatedSavings != null && !isFiniteNumber(i.estimatedSavings))) return { netCandidate: null, result: 'financial_impact_unverified', ...flags };
  if (i.budgetAvailable === false) return { netCandidate: null, result: 'budget_constraint_candidate', ...flags };
  if (i.estimatedCost == null || i.estimatedSavings == null) return { netCandidate: null, result: 'financial_impact_unverified', ...flags };
  const net = Math.round((i.estimatedSavings - i.estimatedCost) * 100) / 100;
  if (net > 0 && i.estimatedCost > 0) return { netCandidate: net, result: 'mixed_financial_candidate', ...flags };
  if (net > 0) return { netCandidate: net, result: 'favorable_financial_candidate', ...flags };
  if (net < 0) return { netCandidate: net, result: 'adverse_financial_candidate', ...flags };
  return { netCandidate: net, result: 'neutral_financial_candidate', ...flags };
}

/* ── 13) Impact Synthesis(Settlement/Payment 은 Reference 만) ────────── */
export function synthesizeCrossDomainImpact(i: { impactedDomains: string[] | null; adverseDomains: string[]; favorableDomains: string[]; totalDomainCount: number }): { result: (typeof IMPACT_SYNTHESIS_RESULTS)[number]; settlementPaymentReferenceOnly: true } {
  const flags = { settlementPaymentReferenceOnly: true as const };
  if (i.impactedDomains == null) return { result: 'insufficient_data', ...flags };
  if (!i.impactedDomains.length) return { result: 'impact_unverified', ...flags };
  if (i.adverseDomains.length && i.favorableDomains.length) return { result: 'mixed_impact_candidate', ...flags };
  if (i.adverseDomains.length === i.impactedDomains.length && i.impactedDomains.length > 0) return { result: 'adverse_impact_candidate', ...flags };
  if (i.totalDomainCount > 0 && i.impactedDomains.length >= Math.max(2, Math.ceil(i.totalDomainCount * 0.7))) return { result: 'enterprise_wide_impact_candidate', ...flags };
  if (i.impactedDomains.length >= 3) return { result: 'multi_domain_impact_candidate', ...flags };
  if (i.impactedDomains.length === 1) return { result: 'isolated_impact_candidate', ...flags };
  return { result: 'limited_impact_candidate', ...flags };
}

/* ── 14) Trade-off(자동 점수 순위 선택 없음) ─────────────────────────── */
export function evaluateExecutiveTradeoffs(i: { axis: string; favorableSideScore: number | null; unfavorableSideScore: number | null }): { axis: string | null; result: (typeof TRADEOFF_RESULTS)[number]; autoWinnerSelected: false } {
  const flags = { autoWinnerSelected: false as const };
  if (!(TRADEOFF_AXES as readonly string[]).includes(i.axis)) return { axis: null, result: 'insufficient_data', ...flags };
  if (i.favorableSideScore == null || i.unfavorableSideScore == null) return { axis: i.axis, result: 'tradeoff_unverified', ...flags };
  if (!isFiniteNumber(i.favorableSideScore) || !isFiniteNumber(i.unfavorableSideScore)) return { axis: i.axis, result: 'tradeoff_unverified', ...flags };
  const delta = i.favorableSideScore - i.unfavorableSideScore;
  if (Math.abs(delta) <= 5) return { axis: i.axis, result: 'balanced_tradeoff_candidate', ...flags };
  if (delta > 25) return { axis: i.axis, result: 'favorable_tradeoff_candidate', ...flags };
  if (delta < -25) return { axis: i.axis, result: 'unfavorable_tradeoff_candidate', ...flags };
  return { axis: i.axis, result: 'mixed_tradeoff_candidate', ...flags };
}

/* ── 15) Robustness(Robust ≠ Correct) ────────────────────────────────── */
export function evaluateOptionRobustness(i: { caseOutcomes: { scenario: string; acceptable: boolean | null }[] | null; minScenarios: number }): { acceptableCount: number | null; result: (typeof ROBUSTNESS_RESULTS)[number]; robustOptionIsNotCorrectOption: true } {
  const flags = { robustOptionIsNotCorrectOption: true as const };
  if (i.caseOutcomes == null) return { acceptableCount: null, result: 'insufficient_data', ...flags };
  if (i.caseOutcomes.length < i.minScenarios) return { acceptableCount: null, result: 'robustness_unverified', ...flags };
  if (i.caseOutcomes.some((c) => c.acceptable == null)) return { acceptableCount: null, result: 'robustness_unverified', ...flags };
  const acceptable = i.caseOutcomes.filter((c) => c.acceptable).length;
  if (acceptable === i.caseOutcomes.length) return { acceptableCount: acceptable, result: 'robust_option_candidate', ...flags };
  if (acceptable === 0) return { acceptableCount: acceptable, result: 'fragile_option_candidate', ...flags };
  if (acceptable === 1) return { acceptableCount: acceptable, result: 'scenario_specific_candidate', ...flags };
  return { acceptableCount: acceptable, result: 'conditionally_robust_candidate', ...flags };
}

/* ── 16) Regret(Lowest Regret ≠ Best Decision) ───────────────────────── */
export function evaluateOptionRegret(i: { worstCaseLoss: number | null; bestAlternativeGap: number | null; reversible: boolean | null }): { result: (typeof REGRET_RESULTS)[number]; lowestRegretIsNotBestDecision: true } {
  const flags = { lowestRegretIsNotBestDecision: true as const };
  if (i.worstCaseLoss == null || i.bestAlternativeGap == null) return { result: 'insufficient_data', ...flags };
  if (!isFiniteNumber(i.worstCaseLoss) || !isFiniteNumber(i.bestAlternativeGap)) return { result: 'regret_unverified', ...flags };
  if (i.reversible == null) return { result: 'regret_unverified', ...flags };
  if (i.worstCaseLoss > i.bestAlternativeGap * 3 && !i.reversible) return { result: 'asymmetric_regret_candidate', ...flags };
  if (i.bestAlternativeGap <= 0 && i.worstCaseLoss <= 0) return { result: 'lowest_regret_candidate', ...flags };
  if (i.bestAlternativeGap < 10 && (i.reversible || i.worstCaseLoss < 10)) return { result: 'low_regret_candidate', ...flags };
  if (i.bestAlternativeGap < 40) return { result: 'moderate_regret_candidate', ...flags };
  return { result: 'high_regret_candidate', ...flags };
}

/* ── 17) No Action Consequence ───────────────────────────────────────── */
export function buildNoActionConsequence(i: { projectedRiskDelta: number | null; projectedCostDelta: number | null; unknownFactors: string[] }): { projectedRiskDelta: number | null; projectedCostDelta: number | null; unknownCount: number; result: 'no_action_consequence_reference' | 'insufficient_data'; scenarioIsNotReality: true } {
  const flags = { scenarioIsNotReality: true as const };
  if (i.projectedRiskDelta == null && i.projectedCostDelta == null) return { projectedRiskDelta: null, projectedCostDelta: null, unknownCount: i.unknownFactors.length, result: 'insufficient_data', ...flags };
  const risk = i.projectedRiskDelta != null && isFiniteNumber(i.projectedRiskDelta) ? i.projectedRiskDelta : null;
  const cost = i.projectedCostDelta != null && isFiniteNumber(i.projectedCostDelta) ? i.projectedCostDelta : null;
  return { projectedRiskDelta: risk, projectedCostDelta: cost, unknownCount: i.unknownFactors.length, result: 'no_action_consequence_reference', ...flags };
}

/* ── 18) Executive Brief(≠ Decision/Approval) ────────────────────────── */
export function buildExecutiveBrief(i: { contextExists: boolean; optionCount: number; evidenceCount: number; advisoryAvailable: boolean; recommendationType: string | null }):
  | { rejected: true; rejectReason: string }
  | { status: 'draft' | 'pending_evidence' | 'pending_advisory'; optionCount: number; briefIsNotDecision: true; briefIsNotApproval: true; preferredOptionIsNotFinalChoice: true; humanApprovalRequired: true } {
  if (!i.contextExists) return { rejected: true, rejectReason: 'Decision Context 실존 검증 실패' };
  if (i.recommendationType != null && !(EXECUTIVE_RECOMMENDATION_TYPES as readonly string[]).includes(i.recommendationType)) return { rejected: true, rejectReason: '허용되지 않는 recommendation_candidate' };
  if (i.recommendationType != null && i.evidenceCount === 0) return { rejected: true, rejectReason: 'Evidence 없는 Recommendation Candidate 금지' };
  const status = i.evidenceCount === 0 ? 'pending_evidence' : !i.advisoryAvailable ? 'pending_advisory' : 'draft';
  return { status, optionCount: i.optionCount, briefIsNotDecision: true, briefIsNotApproval: true, preferredOptionIsNotFinalChoice: true, humanApprovalRequired: true };
}

/* ── 19) Recommendation Candidate(≠ Approval — 자동 선택/실행 없음) ──── */
export function buildExecutiveRecommendationCandidate(i: { type: string; reason: string; evidence: string[]; confidence: number | null }):
  | { rejected: true; rejectReason: string }
  | { type: string; reason: string; confidence: number | null; recommendationIsNotApproval: true; humanExecutiveApprovalRequired: true; autoSelected: false; autoExecuted: false } {
  if (!(EXECUTIVE_RECOMMENDATION_TYPES as readonly string[]).includes(i.type)) return { rejected: true, rejectReason: '허용되지 않는 recommendation type' };
  if (!i.reason.trim()) return { rejected: true, rejectReason: 'Reason 필수' };
  if (!i.evidence.length) return { rejected: true, rejectReason: 'Evidence 없는 Recommendation 금지' };
  const confidence = i.confidence == null || !isFiniteNumber(i.confidence) ? null : clampScore(i.confidence);
  return { type: i.type, reason: i.reason, confidence, recommendationIsNotApproval: true, humanExecutiveApprovalRequired: true, autoSelected: false, autoExecuted: false };
}

/* ── 20) Human Executive Review(Approval Reference ≠ Applied Change) ─── */
export function validateExecutiveReviewAction(i: { action: string; reason: string; evidenceCount: number; reviewerIsCreator: boolean }):
  | { rejected: true; rejectReason: string }
  | { action: string; humanDecisionConfirmed: true; approvalIsNotAppliedChange: true; productionApplied: false; autoApproved: false } {
  if (!(EXECUTIVE_REVIEW_ACTIONS as readonly string[]).includes(i.action)) return { rejected: true, rejectReason: '허용되지 않는 review action' };
  if (!i.reason.trim()) return { rejected: true, rejectReason: 'Reason 필수(승인/거절/보류/수정 전부)' };
  if ((i.action === 'approve_reference' || i.action === 'approve_with_conditions_reference')) {
    if (i.reviewerIsCreator) return { rejected: true, rejectReason: 'Self-Approval 차단(작성자 ≠ 승인자)' };
    if (i.evidenceCount === 0) return { rejected: true, rejectReason: 'Evidence 없는 Approval Reference 금지' };
  }
  return { action: i.action, humanDecisionConfirmed: true, approvalIsNotAppliedChange: true, productionApplied: false, autoApproved: false };
}

/* ── 21) Decision Outcome(Outcome ≠ Causality) ───────────────────────── */
export function evaluateDecisionOutcome(i: { observedOutcomeExists: boolean; observationCompletenessPct: number | null; externalFactorPresent: boolean; sampleSize: number | null; minSample: number }): { result: 'outcome_linked_reference' | 'observation_partial' | 'outcome_unverified' | 'causality_unverified' | 'sample_too_small' | 'insufficient_data'; outcomeLinkIsNotCausality: true } {
  const flags = { outcomeLinkIsNotCausality: true as const };
  if (!i.observedOutcomeExists) return { result: 'outcome_unverified', ...flags };
  if (i.sampleSize == null || !isFiniteNumber(i.sampleSize)) return { result: 'insufficient_data', ...flags };
  if (i.sampleSize < i.minSample) return { result: 'sample_too_small', ...flags };
  if (i.externalFactorPresent) return { result: 'causality_unverified', ...flags };
  if (i.observationCompletenessPct != null && isFiniteNumber(i.observationCompletenessPct) && i.observationCompletenessPct < 80) return { result: 'observation_partial', ...flags };
  return { result: 'outcome_linked_reference', ...flags };
}

/* ── 22) Decision Quality Candidate(경영진 평가 아님) ────────────────── */
export function calculateDecisionQualityCandidate(i: { outcomeLinked: boolean; goalAchieved: boolean | null; costWithinRange: boolean | null; riskWithinRange: boolean | null; unexpectedSideEffect: boolean; causalityVerified: boolean; sampleSize: number | null; minSample: number }): { result: (typeof DECISION_QUALITY_RESULTS)[number]; qualityCandidateIsNotVerifiedQuality: true } {
  const flags = { qualityCandidateIsNotVerifiedQuality: true as const };
  if (!i.outcomeLinked) return { result: 'outcome_unverified', ...flags };
  if (i.sampleSize == null || !isFiniteNumber(i.sampleSize)) return { result: 'insufficient_data', ...flags };
  if (i.sampleSize < i.minSample) return { result: 'sample_too_small', ...flags };
  if (!i.causalityVerified) return { result: 'causality_unverified', ...flags };
  if (i.goalAchieved == null || i.costWithinRange == null || i.riskWithinRange == null) return { result: 'insufficient_data', ...flags };
  const positives = [i.goalAchieved, i.costWithinRange, i.riskWithinRange].filter(Boolean).length;
  if (positives === 3 && !i.unexpectedSideEffect) return { result: 'high_quality_candidate', ...flags };
  if (positives >= 2 && i.unexpectedSideEffect) return { result: 'mixed_quality_candidate', ...flags };
  if (positives >= 2) return { result: 'moderate_quality_candidate', ...flags };
  return { result: 'low_quality_candidate', ...flags };
}

/* ── 23) Decision Drift Candidate(Confirmed 아님) ────────────────────── */
export function calculateDecisionDriftCandidate(i: { driftedDimensions: string[] | null; assumptionsInvalidated: number | null }): { result: (typeof DECISION_DRIFT_RESULTS)[number]; driftCandidateIsNotConfirmedDrift: true } {
  const flags = { driftCandidateIsNotConfirmedDrift: true as const };
  if (i.driftedDimensions == null) return { result: 'insufficient_data', ...flags };
  if (i.assumptionsInvalidated == null || !isFiniteNumber(i.assumptionsInvalidated)) return { result: 'drift_unverified', ...flags };
  const n = i.driftedDimensions.length;
  if (n === 0 && i.assumptionsInvalidated === 0) return { result: 'no_material_drift_candidate', ...flags };
  if (i.driftedDimensions.includes('goal_drift') || i.assumptionsInvalidated >= 3) return { result: 'structural_drift_candidate', ...flags };
  if (n >= 4) return { result: 'severe_drift_candidate', ...flags };
  if (n >= 2) return { result: 'moderate_drift_candidate', ...flags };
  return { result: 'minor_drift_candidate', ...flags };
}

/* ── 24) Decision Learning Reference(자동 정책 변경 아님) ────────────── */
export function buildDecisionLearningReference(i: { effectiveEvidence: string[]; ineffectiveEvidence: string[]; missedRisks: string[]; overestimatedOpportunities: string[]; reviewTriggers: string[] }): { entryCount: number; result: 'learning_reference_recorded' | 'insufficient_data'; autoPolicyChanged: false; learningIsNotVerifiedImprovement: true } {
  const flags = { autoPolicyChanged: false as const, learningIsNotVerifiedImprovement: true as const };
  const entryCount = i.effectiveEvidence.length + i.ineffectiveEvidence.length + i.missedRisks.length + i.overestimatedOpportunities.length + i.reviewTriggers.length;
  if (entryCount === 0) return { entryCount, result: 'insufficient_data', ...flags };
  return { entryCount, result: 'learning_reference_recorded', ...flags };
}

/* ── 25) Executive Timeline ──────────────────────────────────────────── */
export function buildExecutiveTimeline(i: { present: Partial<Record<(typeof EXECUTIVE_TIMELINE_STAGES)[number], boolean>> }): { stages: { stage: (typeof EXECUTIVE_TIMELINE_STAGES)[number]; present: boolean }[]; completedCount: number; timelineIsNotExecutionLog: true } {
  const stages = EXECUTIVE_TIMELINE_STAGES.map((stage) => ({ stage, present: i.present[stage] === true }));
  return { stages, completedCount: stages.filter((s) => s.present).length, timelineIsNotExecutionLog: true };
}

/* ── 26) Support Matrix(실측 기반 — Automatic 계열 전부 unsupported) ─── */
export const EXECUTIVE_COMPONENTS = [
  { key: 'decision_memory_0514', available: true },
  { key: 'decision_outcomes_0514', available: true },
  { key: 'commitments_0520', available: true },
  { key: 'execution_requests_0535', available: true },
  { key: 'agents_0497', available: true },
  { key: 'agent_collaboration_0497', available: true },
  { key: 'constitution_rules_0496', available: true },
  { key: 'governance_events_0496', available: true },
  { key: 'scenario_runs_0542', available: true },
  { key: 'forecast_runs_0543', available: true },
  { key: 'warning_candidates_0543', available: true },
  { key: 'knowledge_entities_0513', available: true },
  { key: 'trained_decision_model', available: false },
  { key: 'executive_org_chart_data', available: false },
  { key: 'reviewer_role_directory', available: false },
  { key: 'agent_independence_verifier', available: false },
  { key: 'evidence_reliability_model', available: false },
  { key: 'accounting_actuals_feed', available: false },
  { key: 'revenue_forecast_dataset', available: false },
  { key: 'rollback_guarantee_engine', available: false },
  { key: 'causality_model', available: false },
] as const;

export type ExecutiveSupportStatus = 'fully_supported' | 'partially_supported' | 'read_only' | 'advisory_only' | 'option_only' | 'recommendation_only' | 'reference_only' | 'human_review_only' | 'approval_reference_only' | 'outcome_reference_only' | 'unavailable' | 'unverified' | 'unsupported' | 'insufficient_data';
export const EXECUTIVE_SUPPORT_MATRIX: { feature: string; status: ExecutiveSupportStatus }[] = [
  { feature: 'decision_context', status: 'fully_supported' },
  { feature: 'decision_priority_candidate', status: 'advisory_only' },
  { feature: 'decision_urgency_candidate', status: 'advisory_only' },
  { feature: 'evidence_quality', status: 'advisory_only' },
  { feature: 'evidence_gap', status: 'advisory_only' },
  { feature: 'evidence_conflict', status: 'advisory_only' },
  { feature: 'multi_agent_advisory', status: 'partially_supported' },
  { feature: 'agent_agreement', status: 'advisory_only' },
  { feature: 'agent_conflict', status: 'advisory_only' },
  { feature: 'decision_option', status: 'option_only' },
  { feature: 'no_action_option', status: 'option_only' },
  { feature: 'defer_option', status: 'option_only' },
  { feature: 'evidence_gathering_option', status: 'option_only' },
  { feature: 'policy_constraint', status: 'reference_only' },
  { feature: 'constitution_constraint', status: 'reference_only' },
  { feature: 'compliance_constraint', status: 'reference_only' },
  { feature: 'contract_constraint', status: 'reference_only' },
  { feature: 'impact_synthesis', status: 'advisory_only' },
  { feature: 'financial_impact', status: 'advisory_only' },
  { feature: 'capacity_impact', status: 'advisory_only' },
  { feature: 'operational_impact', status: 'advisory_only' },
  { feature: 'security_impact', status: 'advisory_only' },
  { feature: 'privacy_impact', status: 'advisory_only' },
  { feature: 'compliance_impact', status: 'advisory_only' },
  { feature: 'customer_experience_impact', status: 'advisory_only' },
  { feature: 'human_workload_impact', status: 'advisory_only' },
  { feature: 'tradeoff_analysis', status: 'advisory_only' },
  { feature: 'robustness_analysis', status: 'advisory_only' },
  { feature: 'regret_analysis', status: 'advisory_only' },
  { feature: 'reversibility_analysis', status: 'advisory_only' },
  { feature: 'feasibility_analysis', status: 'advisory_only' },
  { feature: 'executive_brief', status: 'recommendation_only' },
  { feature: 'recommendation_candidate', status: 'recommendation_only' },
  { feature: 'human_executive_review', status: 'human_review_only' },
  { feature: 'approval_reference', status: 'approval_reference_only' },
  { feature: 'rejection_reference', status: 'approval_reference_only' },
  { feature: 'defer_reference', status: 'approval_reference_only' },
  { feature: 'revision_request', status: 'human_review_only' },
  { feature: 'decision_reference', status: 'reference_only' },
  { feature: 'commitment_reference', status: 'reference_only' },
  { feature: 'observation_plan_reference', status: 'reference_only' },
  { feature: 'review_trigger_reference', status: 'reference_only' },
  { feature: 'outcome_reference', status: 'outcome_reference_only' },
  { feature: 'decision_quality_candidate', status: 'advisory_only' },
  { feature: 'decision_drift_candidate', status: 'advisory_only' },
  { feature: 'decision_learning_reference', status: 'reference_only' },
  { feature: 'executive_audit', status: 'read_only' },
  { feature: 'automatic_decision', status: 'unsupported' },
  { feature: 'automatic_approval', status: 'unsupported' },
  { feature: 'automatic_execution', status: 'unsupported' },
  { feature: 'automatic_policy_application', status: 'unsupported' },
  { feature: 'automatic_payment', status: 'unsupported' },
  { feature: 'automatic_settlement_mutation', status: 'unsupported' },
  { feature: 'automatic_contract_execution', status: 'unsupported' },
  { feature: 'automatic_infrastructure_change', status: 'unsupported' },
  { feature: 'automatic_rollout', status: 'unsupported' },
  { feature: 'automatic_rollback', status: 'unsupported' },
  { feature: 'automatic_production_mutation', status: 'unsupported' },
];
