/**
 * runtimeLearning — Enterprise Runtime Learning, Incident Postmortem Intelligence &
 * Assurance Policy Evolution Center 순수 로직 (Phase AI-OPS-35).
 *
 * Runtime Session History → Incident Candidate Review → Human Resolution Evidence →
 * Postmortem Draft → Root Cause Candidate → Contributing Factor → Control Gap →
 * Policy Improvement Proposal → Human Policy Review → Policy Version Reference →
 * Effectiveness Observation → Organizational Learning → Audit.
 *
 * Runtime Learning 정직성(전부 코드로 강제):
 *  - Correlation ≠ Causality. Pattern ≠ Root Cause. Candidate ≠ Confirmed.
 *  - Postmortem Draft ≠ Approved. Proposal ≠ Approval ≠ Application ≠ Effectiveness.
 *  - Missing Evidence ≠ Negligence. Review Delay ≠ Reviewer Failure.
 *  - Root Cause 자동 확정/책임자 확정/인사 평가 없음. 자동 Policy/Threshold 변경 없음.
 *  - 서로 다른 Scope 임의 합산 없음. Unknown 유지(null→0 금지).
 *  - deterministic · pure · null 안전 · NaN/Infinity 방어 · Date 주입.
 */
import { isFiniteNumber, clampScore } from './aiMemory';

/* ── 상수 ─────────────────────────────────────────────────────────────── */
export const POSTMORTEM_STATUSES = ['draft', 'pending_evidence', 'pending_review', 'reviewed_reference', 'approved_reference', 'approved_with_limitation', 'rejected', 'invalidated', 'insufficient_data'] as const;
export const ROOT_CAUSE_TYPES = ['connector_failure_candidate', 'connector_permission_candidate', 'connector_scope_candidate', 'credential_reference_candidate', 'runtime_precondition_candidate', 'automation_definition_candidate', 'timeout_policy_candidate', 'retry_policy_candidate', 'idempotency_candidate', 'evidence_collection_candidate', 'review_delay_candidate', 'cleanup_candidate', 'observation_candidate', 'external_provider_candidate', 'human_process_candidate', 'data_quality_candidate', 'configuration_candidate', 'unknown_candidate'] as const;
export const ROOT_CAUSE_STATUSES = ['candidate', 'pending_review', 'evidence_partial', 'contradicted_candidate', 'supported_candidate', 'rejected', 'confirmed_reference', 'invalidated', 'insufficient_data'] as const;
export const CORRECTIVE_ACTION_TYPES = ['gather_missing_evidence', 'verify_connector_permission', 'verify_connector_scope', 'revalidate_credential_reference', 'revise_automation_definition', 'revise_runtime_precondition', 'revise_timeout_policy', 'revise_retry_policy', 'revise_idempotency_requirement', 'revise_checkpoint_policy', 'revise_cleanup_policy', 'revise_observation_plan', 'improve_human_review_process', 'disable_reference_review', 'manual_investigation', 'insufficient_data'] as const;
export const PREVENTIVE_ACTION_TYPES = ['add_validation_proposal', 'strengthen_scope_guard_proposal', 'strengthen_permission_guard_proposal', 'require_secondary_approval_proposal', 'require_dry_run_proposal', 'require_sandbox_proposal', 'require_idempotency_proposal', 'reduce_timeout_proposal', 'increase_timeout_proposal', 'require_checkpoint_proposal', 'improve_evidence_requirement_proposal', 'improve_cleanup_requirement_proposal', 'extend_observation_proposal', 'add_escalation_rule_proposal', 'add_connector_health_review_proposal', 'add_runtime_readiness_check_proposal', 'disable_automation_review_proposal', 'disable_connector_review_proposal', 'insufficient_data'] as const;
export const POLICY_DOMAINS = ['connector_governance', 'automation_governance', 'execution_gateway', 'runtime_preconditions', 'runtime_assurance', 'permission_validation', 'scope_validation', 'risk_evaluation', 'dry_run_requirement', 'sandbox_requirement', 'idempotency_requirement', 'timeout_policy', 'retry_policy', 'checkpoint_policy', 'evidence_policy', 'cleanup_policy', 'observation_policy', 'escalation_policy', 'recovery_policy', 'closure_policy'] as const;
export const LEARNING_RECOMMENDATION_TYPES = ['create_postmortem_draft', 'gather_postmortem_evidence', 'review_root_cause_candidate', 'review_contributing_factor', 'review_control_gap', 'review_recurrence_pattern', 'propose_corrective_action', 'propose_preventive_action', 'propose_assurance_policy_change', 'request_policy_review', 'request_secondary_policy_review', 'record_policy_version_reference', 'verify_policy_application', 'start_policy_effectiveness_observation', 'extend_policy_observation', 'review_adverse_effect_candidate', 'review_policy_effectiveness', 'record_organizational_learning_reference', 'request_human_closure', 'insufficient_data'] as const;
export const LEARNING_TIMELINE_STAGES = ['history', 'postmortem', 'root_cause', 'control_gap', 'pattern', 'corrective_action', 'policy_proposal', 'application', 'effectiveness'] as const;

/* ── 1) Postmortem Draft(초안 — Approved 아님·Root Cause 확정 아님) ──── */
export function buildPostmortemDraft(i: { sessionExists: boolean; incidentCandidateExists: boolean | null; incidentSummary: string; knownFacts: string[]; unknownFactors: string[]; evidence: string[] }):
  | { rejected: true; rejectReason: string }
  | { incidentSummary: string; knownFacts: string[]; unknownFactors: string[]; evidence: string[]; status: 'draft' | 'pending_evidence'; draftIsNotApproved: true; postmortemIsNotRootCause: true; blameAssigned: false } {
  if (!i.sessionExists) return { rejected: true, rejectReason: 'Runtime Session 없음(실존 검증 실패)' };
  if (i.incidentCandidateExists === false) return { rejected: true, rejectReason: 'Incident Candidate 없음(실존 검증 실패)' };
  if (!i.incidentSummary.trim()) return { rejected: true, rejectReason: 'incident_summary 필수' };
  return {
    incidentSummary: i.incidentSummary, knownFacts: i.knownFacts.slice(0, 20), unknownFactors: i.unknownFactors.slice(0, 20),
    evidence: i.evidence.slice(0, 20),
    status: i.evidence.length ? 'draft' : 'pending_evidence',
    draftIsNotApproved: true, postmortemIsNotRootCause: true, blameAssigned: false,
  };
}

/* ── 2) Postmortem Completeness ──────────────────────────────────────── */
export function evaluatePostmortemCompleteness(i: { summary: boolean; timeline: boolean; detection: boolean; recovery: boolean; resolution: boolean; evidenceCount: number | null; unknownFactorsDocumented: boolean }): { result: 'review_ready_reference' | 'pending_evidence' | 'evidence_incomplete' | 'insufficient_data'; missing: string[] } {
  if (i.evidenceCount == null || !isFiniteNumber(i.evidenceCount)) return { result: 'insufficient_data', missing: [] };
  const missing: string[] = [];
  if (!i.summary) missing.push('incident_summary');
  if (!i.timeline) missing.push('timeline_summary');
  if (!i.detection) missing.push('detection_summary');
  if (!i.recovery) missing.push('recovery_summary');
  if (!i.resolution) missing.push('resolution_summary');
  if (!i.unknownFactorsDocumented) missing.push('unknown_factors');
  if (i.evidenceCount === 0) return { result: 'pending_evidence', missing };
  return { result: missing.length ? 'evidence_incomplete' : 'review_ready_reference', missing };
}

/* ── 3) Root Cause Candidate(Candidate ≠ Confirmed·Correlation ≠ Causality) ── */
export function evaluateRootCauseCandidate(i: { type: string; evidence: string[]; counterEvidence: string[]; alternativeExplanations: string[]; humanConfirmedReference: boolean }): { status: (typeof ROOT_CAUSE_STATUSES)[number]; candidateIsNotConfirmedRootCause: true; correlationIsNotCausality: true; autoConfirmed: false } {
  const flags = { candidateIsNotConfirmedRootCause: true as const, correlationIsNotCausality: true as const, autoConfirmed: false as const };
  if (!(ROOT_CAUSE_TYPES as readonly string[]).includes(i.type)) return { status: 'invalidated', ...flags };
  if (!i.evidence.length) return { status: 'insufficient_data', ...flags };
  if (i.counterEvidence.length > i.evidence.length) return { status: 'contradicted_candidate', ...flags };
  if (i.humanConfirmedReference) return { status: 'confirmed_reference', ...flags };   // 사람 명시 검토 Reference 있을 때만
  if (i.counterEvidence.length > 0 || i.alternativeExplanations.length > 0) return { status: 'evidence_partial', ...flags };
  return { status: 'supported_candidate', ...flags };
}

/* ── 4) Contributing Factor(결측 재정규화 없음) ──────────────────────── */
export function evaluateContributingFactors(factors: { name: string; direction: 'supporting' | 'amplifying' | 'mitigating' | null; evidence: string[]; contradicted: boolean }[] | null): { rows: { name: string; result: 'contributing_factor_candidate' | 'supporting_factor_candidate' | 'amplifying_factor_candidate' | 'mitigating_factor_candidate' | 'contradicted_factor_candidate' | 'factor_unverified' }[]; unverifiedCount: number; factorIsNotCause: true } {
  const rows = (factors ?? []).slice(0, 30).map((f) => {
    if (f.contradicted) return { name: f.name, result: 'contradicted_factor_candidate' as const };
    if (!f.evidence.length || f.direction == null) return { name: f.name, result: 'factor_unverified' as const };   // 결측 — 재정규화 없이 unverified 유지
    if (f.direction === 'supporting') return { name: f.name, result: 'supporting_factor_candidate' as const };
    if (f.direction === 'amplifying') return { name: f.name, result: 'amplifying_factor_candidate' as const };
    return { name: f.name, result: 'mitigating_factor_candidate' as const };
  });
  return { rows, unverifiedCount: rows.filter((r) => r.result === 'factor_unverified').length, factorIsNotCause: true };
}

/* ── 5) Control Gap(확정 취약점 아님) ────────────────────────────────── */
export function evaluateControlGaps(controls: { name: string; present: boolean | null; effective: boolean | null; bypassed: boolean; evidence: string[] }[] | null): { rows: { name: string; result: 'no_control_gap_reference' | 'control_missing_candidate' | 'control_weakness_candidate' | 'control_bypass_candidate' | 'control_evidence_missing' | 'control_effectiveness_unverified' | 'insufficient_data' }[]; gapCount: number; gapIsNotConfirmedVulnerability: true } {
  const rows = (controls ?? []).slice(0, 30).map((c) => {
    if (c.present == null) return { name: c.name, result: 'insufficient_data' as const };
    if (!c.present) return { name: c.name, result: 'control_missing_candidate' as const };
    if (c.bypassed) return { name: c.name, result: 'control_bypass_candidate' as const };
    if (!c.evidence.length) return { name: c.name, result: 'control_evidence_missing' as const };
    if (c.effective == null) return { name: c.name, result: 'control_effectiveness_unverified' as const };
    if (!c.effective) return { name: c.name, result: 'control_weakness_candidate' as const };
    return { name: c.name, result: 'no_control_gap_reference' as const };
  });
  return { rows, gapCount: rows.filter((r) => r.result !== 'no_control_gap_reference' && r.result !== 'insufficient_data').length, gapIsNotConfirmedVulnerability: true };
}

/* ── 6) Recurrence Pattern(Pattern ≠ Root Cause·자동 확정 없음) ──────── */
export function detectRecurrencePattern(i: { dimension: 'signal' | 'incident' | 'connector' | 'automation' | 'control_gap'; occurrences: number | null; sampleSize: number | null; minSample: number; lastObservedAt: Date | null; now: Date; staleAfterDays: number }): { result: 'recurrence_not_detected' | 'recurrence_candidate' | 'repeated_signal_candidate' | 'repeated_incident_candidate' | 'repeated_connector_pattern' | 'repeated_automation_pattern' | 'repeated_control_gap_candidate' | 'sample_too_small' | 'stale_input_candidate' | 'insufficient_data'; patternIsNotRootCause: true; repeatedSignalIsNotStructuralProblem: true; autoConfirmed: false } {
  const flags = { patternIsNotRootCause: true as const, repeatedSignalIsNotStructuralProblem: true as const, autoConfirmed: false as const };
  if (i.occurrences == null || i.sampleSize == null || !isFiniteNumber(i.occurrences) || !isFiniteNumber(i.sampleSize)) return { result: 'insufficient_data', ...flags };
  if (i.sampleSize < i.minSample) return { result: 'sample_too_small', ...flags };
  if (i.lastObservedAt == null) return { result: 'insufficient_data', ...flags };
  const ageDays = (i.now.getTime() - i.lastObservedAt.getTime()) / 86400000;
  if (!isFiniteNumber(ageDays) || ageDays < 0) return { result: 'insufficient_data', ...flags };
  if (ageDays > i.staleAfterDays) return { result: 'stale_input_candidate', ...flags };
  if (i.occurrences < 2) return { result: 'recurrence_not_detected', ...flags };
  const map = { signal: 'repeated_signal_candidate', incident: 'repeated_incident_candidate', connector: 'repeated_connector_pattern', automation: 'repeated_automation_pattern', control_gap: 'repeated_control_gap_candidate' } as const;
  return { result: map[i.dimension], ...flags };
}

/* ── 7) Recovery Effectiveness(Resolution ≠ Outcome) ─────────────────── */
export function evaluateRecoveryEffectiveness(i: { recoveryReviews: number | null; resolvedReferences: number | null; recurrenceAfterResolution: number | null; sampleMin: number }): { result: 'recovery_effective_candidate' | 'recovery_ineffective_candidate' | 'recurrence_unverified' | 'sample_too_small' | 'insufficient_data'; resolutionIsNotOutcomeSuccess: true; recoveryIsNotOutcome: true } {
  const flags = { resolutionIsNotOutcomeSuccess: true as const, recoveryIsNotOutcome: true as const };
  if (i.recoveryReviews == null || i.resolvedReferences == null || !isFiniteNumber(i.recoveryReviews) || !isFiniteNumber(i.resolvedReferences)) return { result: 'insufficient_data', ...flags };
  if (i.resolvedReferences < i.sampleMin) return { result: 'sample_too_small', ...flags };
  if (i.recurrenceAfterResolution == null || !isFiniteNumber(i.recurrenceAfterResolution)) return { result: 'recurrence_unverified', ...flags };
  return { result: i.recurrenceAfterResolution > 0 ? 'recovery_ineffective_candidate' : 'recovery_effective_candidate', ...flags };
}

/* ── 8) Corrective Action(Proposal ≠ Applied Action) ─────────────────── */
export function buildCorrectiveAction(i: { type: string; summary: string; evidence: string[]; highRisk: boolean; irreversible: boolean }):
  | { rejected: true; rejectReason: string }
  | { type: string; summary: string; evidence: string[]; approvalRequired: true; secondaryReviewRequired: boolean; proposalIsNotAppliedAction: true; autoApplied: false } {
  if (!(CORRECTIVE_ACTION_TYPES as readonly string[]).includes(i.type)) return { rejected: true, rejectReason: `허용되지 않는 corrective action type: ${i.type}` };
  if (!i.evidence.length) return { rejected: true, rejectReason: 'Evidence 없는 제안 금지(insufficient_data)' };
  if (!i.summary.trim()) return { rejected: true, rejectReason: 'summary 필수' };
  return { type: i.type, summary: i.summary, evidence: i.evidence.slice(0, 10), approvalRequired: true, secondaryReviewRequired: i.highRisk || i.irreversible, proposalIsNotAppliedAction: true, autoApplied: false };
}

/* ── 9) Preventive Action(≠ Policy 변경) ─────────────────────────────── */
export function buildPreventiveAction(i: { type: string; summary: string; evidence: string[] }):
  | { rejected: true; rejectReason: string }
  | { type: string; summary: string; evidence: string[]; preventiveActionIsNotPolicyChange: true; approvalRequired: true; autoApplied: false } {
  if (!(PREVENTIVE_ACTION_TYPES as readonly string[]).includes(i.type)) return { rejected: true, rejectReason: `허용되지 않는 preventive action type: ${i.type}` };
  if (!i.evidence.length) return { rejected: true, rejectReason: 'Evidence 없는 제안 금지' };
  if (!i.summary.trim()) return { rejected: true, rejectReason: 'summary 필수' };
  return { type: i.type, summary: i.summary, evidence: i.evidence.slice(0, 10), preventiveActionIsNotPolicyChange: true, approvalRequired: true, autoApplied: false };
}

/* ── 10) Policy Proposal(Proposal ≠ Approval ≠ Application) ──────────── */
export function buildPolicyProposal(i: { domain: string; title: string; evidence: string[]; currentPolicyReference: string | null }):
  | { rejected: true; rejectReason: string }
  | { domain: string; title: string; evidence: string[]; currentPolicyReference: string | null; currentPolicyKnown: boolean; proposalIsNotApproval: true; approvalIsNotApplication: true; thresholdChanged: false } {
  if (!(POLICY_DOMAINS as readonly string[]).includes(i.domain)) return { rejected: true, rejectReason: `허용되지 않는 policy domain: ${i.domain}` };
  if (!i.evidence.length) return { rejected: true, rejectReason: 'Evidence 없는 Proposal 금지' };
  if (!i.title.trim()) return { rejected: true, rejectReason: 'title 필수' };
  return { domain: i.domain, title: i.title, evidence: i.evidence.slice(0, 10), currentPolicyReference: i.currentPolicyReference, currentPolicyKnown: i.currentPolicyReference != null, proposalIsNotApproval: true, approvalIsNotApplication: true, thresholdChanged: false };
}

/* ── 11) Policy Application(Reference ≠ Applied Success) ─────────────── */
export function evaluatePolicyApplication(i: { approved: boolean; referenceRecorded: boolean; verificationEvidence: string[]; rollbackReviewNeeded: boolean }): { status: 'not_requested' | 'approval_missing' | 'application_pending' | 'application_reference_recorded' | 'application_unverified' | 'verified_reference' | 'rollback_review_required'; applicationReferenceIsNotAppliedSuccess: true; appliedIsNotEffective: true } {
  const flags = { applicationReferenceIsNotAppliedSuccess: true as const, appliedIsNotEffective: true as const };
  if (!i.approved) return { status: i.referenceRecorded ? 'approval_missing' : 'not_requested', ...flags };
  if (i.rollbackReviewNeeded) return { status: 'rollback_review_required', ...flags };
  if (!i.referenceRecorded) return { status: 'application_pending', ...flags };
  if (!i.verificationEvidence.length) return { status: 'application_unverified', ...flags };
  return { status: 'verified_reference', ...flags };
}

/* ── 12) Policy Effectiveness(인과 자동 확정 없음) ───────────────────── */
export function evaluatePolicyEffectiveness(i: { applicationVerified: boolean; baseline: number | null; observed: number | null; sampleSize: number | null; minSample: number; observedAt: Date | null; now: Date; staleAfterDays: number; adverseSignals: number | null; externalFactorsRuledOut: boolean }): { result: 'observation_not_started' | 'effectiveness_candidate' | 'ineffectiveness_candidate' | 'adverse_effect_candidate' | 'no_material_change_candidate' | 'causality_unverified' | 'sample_too_small' | 'stale_input_candidate' | 'insufficient_data'; applicationIsNotEffectiveness: true; effectivenessIsNotCausality: true } {
  const flags = { applicationIsNotEffectiveness: true as const, effectivenessIsNotCausality: true as const };
  if (!i.applicationVerified) return { result: 'observation_not_started', ...flags };
  if (i.adverseSignals != null && isFiniteNumber(i.adverseSignals) && i.adverseSignals > 0) return { result: 'adverse_effect_candidate', ...flags };
  if (i.baseline == null || i.observed == null || !isFiniteNumber(i.baseline) || !isFiniteNumber(i.observed)) return { result: 'insufficient_data', ...flags };
  if (i.sampleSize == null || !isFiniteNumber(i.sampleSize) || i.sampleSize < i.minSample) return { result: 'sample_too_small', ...flags };
  if (i.observedAt == null) return { result: 'insufficient_data', ...flags };
  const ageDays = (i.now.getTime() - i.observedAt.getTime()) / 86400000;
  if (!isFiniteNumber(ageDays) || ageDays < 0) return { result: 'insufficient_data', ...flags };
  if (ageDays > i.staleAfterDays) return { result: 'stale_input_candidate', ...flags };
  if (!i.externalFactorsRuledOut) return { result: 'causality_unverified', ...flags };   // 외부 요인 검토 없이 인과 판정하지 않음
  if (i.observed < i.baseline) return { result: 'effectiveness_candidate', ...flags };
  if (i.observed > i.baseline) return { result: 'ineffectiveness_candidate', ...flags };
  return { result: 'no_material_change_candidate', ...flags };
}

/* ── 13) Organizational Learning Readiness(원본 자동 변경 없음) ──────── */
export function evaluateOrganizationalLearningReadiness(i: { postmortemApproved: boolean; rootCauseConfirmedReference: boolean; policyApplicationVerified: boolean | null; effectivenessReviewed: boolean | null }): { result: 'learning_reference_ready' | 'learning_reference_partial' | 'postmortem_approval_missing' | 'root_cause_unverified' | 'policy_application_unverified' | 'effectiveness_unverified'; sourceMemoryChanged: false } {
  if (!i.postmortemApproved) return { result: 'postmortem_approval_missing', sourceMemoryChanged: false };
  if (!i.rootCauseConfirmedReference) return { result: 'root_cause_unverified', sourceMemoryChanged: false };
  if (i.policyApplicationVerified == null || i.effectivenessReviewed == null) return { result: 'learning_reference_partial', sourceMemoryChanged: false };   // 미도달 단계 — unknown 유지
  if (!i.policyApplicationVerified) return { result: 'policy_application_unverified', sourceMemoryChanged: false };
  if (!i.effectivenessReviewed) return { result: 'effectiveness_unverified', sourceMemoryChanged: false };
  return { result: 'learning_reference_ready', sourceMemoryChanged: false };
}

/* ── 14) Learning Recommendation(20종 whitelist·Evidence 필수) ───────── */
export function buildRuntimeLearningRecommendation(i: { type: string; reason: string; evidence: string[]; confidence: number | null; alternatives?: string[]; limitations?: string[] }):
  | { rejected: true; rejectReason: string }
  | { type: string; reason: string; evidence: string[]; confidence: number | null; alternatives: string[]; limitations: string[]; humanApprovalRequired: true; autoApplied: false } {
  if (!(LEARNING_RECOMMENDATION_TYPES as readonly string[]).includes(i.type)) return { rejected: true, rejectReason: `허용되지 않는 recommendation type: ${i.type}` };
  if (!i.evidence.length) return { rejected: true, rejectReason: 'Evidence 없는 권고 금지(insufficient_data)' };
  if (!i.reason.trim()) return { rejected: true, rejectReason: 'Reason 필수' };
  return {
    type: i.type, reason: i.reason, evidence: i.evidence.slice(0, 10),
    confidence: i.confidence != null && isFiniteNumber(i.confidence) ? clampScore(i.confidence) : null,
    alternatives: (i.alternatives ?? []).slice(0, 5),
    limitations: [...(i.limitations ?? []), 'Pattern ≠ Root Cause', 'Proposal ≠ Approved Policy', 'Confidence ≠ Correctness'].slice(0, 10),
    humanApprovalRequired: true, autoApplied: false,
  };
}

/* ── 15) Learning Timeline(9단계 실측 집계) ──────────────────────────── */
export function buildRuntimeLearningTimeline(counts: { stage: string; count: number | null; source: string }[] | null): { stages: { stage: string; count: number | null; source: string; status: 'measured' | 'insufficient_data' }[]; invalidStages: number; timelineIsNotCompletionClaim: true } {
  const valid = (counts ?? []).filter((c) => (LEARNING_TIMELINE_STAGES as readonly string[]).includes(c.stage));
  const byStage = new Map(valid.map((c) => [c.stage, c]));
  return {
    stages: LEARNING_TIMELINE_STAGES.map((stage) => {
      const c = byStage.get(stage);
      const count = c && c.count != null && isFiniteNumber(c.count) ? c.count : null;
      return { stage, count, source: c?.source ?? '원본 없음', status: count != null ? ('measured' as const) : ('insufficient_data' as const) };
    }),
    invalidStages: (counts ?? []).length - valid.length,
    timelineIsNotCompletionClaim: true,
  };
}

/* ── 실측 Learning 구성요소(코드/Migration 기준 — 빌드 시점) ─────────── */
export const LEARNING_COMPONENTS: { key: string; available: boolean | null; note: string }[] = [
  { key: 'runtime_history_0536_0537', available: true, note: 'Sessions/Events/Signals/Incident Candidates/Resolution Reference 실존' },
  { key: 'policy_versioning_0512', available: true, note: 'ai_enterprise_policy_versions(policy_id+version unique·previous_version·checksum) 실존 — 읽기 전용 참조' },
  { key: 'policy_versioning_0509_0510_0349', available: true, note: 'operational/retention/franchise policy version 실존 — 읽기 전용' },
  { key: 'organizational_learning_0515', available: true, note: 'ai_organizational_learnings/patterns/evidence 실존 — 원본 미변경(Reference 만)' },
  { key: 'decision_memory_0514', available: true, note: 'ai_decision_memory/outcomes 실존 — 원본 미변경' },
  { key: 'runtime_postmortem_history', available: false, note: '0538 이전 Runtime Postmortem 구조 없음(0482 는 추천 Root Cause·0502 는 Self-Healing — 별개)' },
  { key: 'assurance_threshold_versioning', available: false, note: 'Assurance Threshold 전용 Versioning 없음 — Proposal Reference 중심' },
  { key: 'runtime_rule_apply_engine', available: false, note: 'Runtime Rule 자동 적용 엔진 없음+금지' },
  { key: 'provider_outage_feed', available: false, note: '외부 Provider 장애 Feed 없음 — Connector Failure ≠ Provider Fault 판정 불가' },
  { key: 'external_incident_feed', available: false, note: '외부 Incident/Error Feed 연동 없음(Sentry 는 앱 오류 수집용)' },
];

/* ── Support Matrix(37항목) ──────────────────────────────────────────── */
export const RUNTIME_LEARNING_SUPPORT: { key: string; status: string; note: string }[] = [
  { key: 'runtime_historical_analysis', status: 'read_only', note: '0536/0537 원본 읽기 전용 분석' },
  { key: 'incident_history_analysis', status: 'read_only', note: 'Incident Candidate/Resolution Reference 이력 분석' },
  { key: 'postmortem_draft', status: 'draft_only', note: 'AI 생성분은 초안 — Draft ≠ Approved' },
  { key: 'postmortem_human_review', status: 'human_review_only', note: 'Evidence 없는 승인 서버 차단·self-review 경고' },
  { key: 'root_cause_candidate', status: 'root_cause_unverified', note: '18종 whitelist — Candidate ≠ Confirmed·Correlation ≠ Causality' },
  { key: 'root_cause_human_confirmation', status: 'human_review_only', note: '후보 검토+Evidence 선행 없이 확정 서버 차단' },
  { key: 'contributing_factor_analysis', status: 'partially_supported', note: '결측 재정규화 없음(factor_unverified)' },
  { key: 'control_gap_analysis', status: 'partially_supported', note: 'Gap Candidate ≠ 확정 취약점' },
  { key: 'recurrence_pattern_detection', status: 'partially_supported', note: 'sample_too_small/stale 유지 — Pattern ≠ Root Cause' },
  { key: 'connector_risk_pattern', status: 'partially_supported', note: 'Connector Failure ≠ Provider Fault(외부 Feed 없음)' },
  { key: 'automation_risk_pattern', status: 'partially_supported', note: 'Automation Failure ≠ Design Failure' },
  { key: 'evidence_gap_pattern', status: 'partially_supported', note: 'Missing Evidence ≠ Negligence' },
  { key: 'review_delay_pattern', status: 'partially_supported', note: 'Review Delay ≠ Reviewer Failure·SLA 임의 생성 없음' },
  { key: 'recovery_effectiveness_analysis', status: 'partially_supported', note: 'Resolution ≠ Outcome — 재발 데이터 없으면 recurrence_unverified' },
  { key: 'corrective_action_proposal', status: 'proposal_only', note: '16종 whitelist — Proposal ≠ Applied Action' },
  { key: 'preventive_action_proposal', status: 'proposal_only', note: '19종 whitelist — Preventive Action ≠ Policy 변경' },
  { key: 'assurance_policy_proposal', status: 'proposal_only', note: '20 도메인 — 0512/0509/0510 원본 미변경' },
  { key: 'policy_human_review', status: 'human_review_only', note: 'Evidence 없는 승인 차단 — approved_reference ≠ applied' },
  { key: 'policy_version_reference', status: 'version_reference_only', note: '0512 실존 버전 구조 읽기 전용 참조 — Runtime 전용 Registry 없음' },
  { key: 'policy_application_reference', status: 'version_reference_only', note: '승인 선행 필수 — Reference ≠ 적용 성공' },
  { key: 'policy_application_verification', status: 'evidence_only', note: '자동 검증 없음 — Evidence 기반 사람 검증' },
  { key: 'policy_effectiveness_observation', status: 'policy_effectiveness_unverified', note: '외부 요인 미검토 시 causality_unverified 유지' },
  { key: 'adverse_effect_candidate', status: 'partially_supported', note: '후보 감지/기록 — 자동 Rollback 없음' },
  { key: 'organizational_learning_reference', status: 'version_reference_only', note: '승인 Postmortem 선행 — 원본 Memory/Graph 미변경' },
  { key: 'runtime_learning_recommendation', status: 'fully_supported', note: '20종 whitelist·Evidence 필수 — 자동 적용 없음' },
  { key: 'runtime_learning_timeline', status: 'fully_supported', note: '9단계 실측 집계' },
  { key: 'runtime_learning_audit', status: 'fully_supported', note: '23종 이벤트 — 확정/적용/효과 자동 의미 없음' },
  { key: 'automatic_root_cause_confirmation', status: 'unsupported', note: '자동 Root Cause 확정 금지' },
  { key: 'automatic_policy_approval', status: 'unsupported', note: '자동 Policy 승인 금지' },
  { key: 'automatic_policy_application', status: 'unsupported', note: '자동 Policy 적용 금지 — 원본 Policy Mutation 없음' },
  { key: 'automatic_threshold_change', status: 'unsupported', note: '자동 Threshold 변경 금지 — Threshold Change ≠ Risk Reduction' },
  { key: 'automatic_connector_disable', status: 'unsupported', note: '자동 Connector 비활성 금지(검토 제안만)' },
  { key: 'automatic_automation_disable', status: 'unsupported', note: '자동 Automation 비활성 금지(검토 제안만)' },
  { key: 'automatic_runtime_rule_change', status: 'unsupported', note: '자동 Runtime Rule 적용 금지' },
  { key: 'automatic_production_mutation', status: 'unsupported', note: '자동 Production/Merge/Deploy/Migration Apply 금지' },
  { key: 'automatic_employee_evaluation', status: 'unsupported', note: '직원 평가/인사 조치 금지' },
  { key: 'automatic_responsibility_assignment', status: 'unsupported', note: '책임자 자동 지정 금지(blame_assigned:false)' },
];
