/**
 * runtimeAssurance — Enterprise Runtime Assurance, Connector Health Intelligence &
 * Human Escalation Control Center 순수 로직 (Phase AI-OPS-34).
 *
 * Runtime Session → Signal Collection → Connector Health → Progress Assurance →
 * Stall/Timeout/Duplicate/Evidence Gap Detection → Incident Candidate →
 * Human Escalation → Recovery Readiness → Observation → Human Resolution → Audit.
 * 실행 엔진이 아님 — 실시간 자동 제어 없이 사람이 판단할 수 있는 분석 계층.
 *
 * Runtime Assurance 정직성(전부 코드로 강제):
 *  - Signal ≠ Fact. Missing Signal ≠ Failure. Candidate ≠ Confirmed Incident.
 *  - Connector Health ≠ Action Success. Heartbeat ≠ Progress. Timeout ≠ Failure.
 *  - Duplicate Candidate ≠ Confirmed Duplicate. Evidence Gap ≠ Execution Failure.
 *  - Escalation Recommendation ≠ 실제 Escalation. Recovery Plan ≠ Recovery Success.
 *  - Resolution ≠ Outcome Success. Observation ≠ Causality.
 *  - 자동 Runtime 제어/Connector 제어/Retry/Cleanup/Rollback/Incident 해결 없음.
 *  - Unknown 유지(null→0 금지). SLA 원본 없으면 임의 판정 없음.
 *  - deterministic · pure · null 안전 · NaN/Infinity 방어 · Date 주입.
 */
import { isFiniteNumber, clampScore } from './aiMemory';

/* ── 상수 ─────────────────────────────────────────────────────────────── */
export const ASSURANCE_SIGNAL_TYPES = ['runtime_started_reference', 'runtime_checkpoint_reference', 'runtime_progress_reference', 'runtime_pause_reference', 'runtime_cancellation_reference', 'runtime_timeout_reference', 'connector_response_reference', 'connector_failure_reference', 'connector_rate_limit_reference', 'result_verification_reference', 'cleanup_reference', 'observation_reference', 'closure_reference', 'missing_checkpoint_candidate', 'stale_runtime_candidate', 'duplicate_action_candidate', 'evidence_gap_candidate', 'delayed_review_candidate', 'unexpected_effect_candidate'] as const;
export const ASSURANCE_SIGNAL_STATUSES = ['available_reference', 'partial', 'stale_signal_candidate', 'signal_unavailable', 'signal_unverified', 'contradictory_signal', 'insufficient_data'] as const;
export const ASSURANCE_STATUSES = ['healthy_reference', 'healthy_with_limitation', 'monitoring_reference', 'warning_candidate', 'degraded_candidate', 'stalled_candidate', 'timeout_candidate', 'duplicate_candidate', 'evidence_gap', 'result_unverified', 'observation_pending', 'cleanup_pending', 'escalation_pending', 'incident_candidate', 'resolution_pending', 'unknown', 'insufficient_data'] as const;
export const RUNTIME_INCIDENT_TYPES = ['connector_unavailable_candidate', 'connector_degraded_candidate', 'permission_failure_candidate', 'scope_failure_candidate', 'runtime_stall_candidate', 'timeout_candidate', 'duplicate_action_candidate', 'duplicate_side_effect_candidate', 'evidence_gap_candidate', 'result_verification_delay_candidate', 'cleanup_delay_candidate', 'observation_delay_candidate', 'closure_delay_candidate', 'unexpected_runtime_effect_candidate', 'unknown_runtime_anomaly_candidate'] as const;
export const ASSURANCE_SEVERITIES = ['informational', 'low', 'moderate', 'high', 'critical', 'severity_unverified', 'insufficient_data'] as const;
export const ASSURANCE_RECOMMENDATION_TYPES = ['review_connector_health', 'verify_connector_permission', 'verify_connector_scope', 'verify_connector_credential_reference', 'review_runtime_progress', 'review_stall_candidate', 'review_timeout_candidate', 'review_duplicate_candidate', 'gather_missing_evidence', 'verify_external_result', 'request_result_recheck', 'request_pause_review', 'request_cancellation_review', 'request_connector_disable_review', 'request_cleanup_review', 'request_rollback_review', 'extend_observation', 'request_security_review', 'request_privacy_review', 'request_compliance_review', 'request_executive_review', 'request_human_resolution', 'insufficient_data'] as const;
export const ASSURANCE_TIMELINE_STAGES = ['signal', 'connector_health', 'progress', 'detection', 'incident_candidate', 'escalation', 'investigation', 'recovery', 'resolution'] as const;

/* ── 1) Signal Freshness(Signal ≠ Fact·오래된 Signal 유지) ───────────── */
export function evaluateSignalFreshness(i: { observedAt: Date | null; now: Date; maxAgeSeconds: number }): { status: 'available_reference' | 'stale_signal_candidate' | 'signal_unavailable' | 'insufficient_data'; ageSeconds: number | null; signalIsNotFact: true } {
  if (i.observedAt == null) return { status: 'signal_unavailable', ageSeconds: null, signalIsNotFact: true };
  const age = Math.floor((i.now.getTime() - i.observedAt.getTime()) / 1000);
  if (!isFiniteNumber(age)) return { status: 'insufficient_data', ageSeconds: null, signalIsNotFact: true };
  if (age < 0) return { status: 'insufficient_data', ageSeconds: null, signalIsNotFact: true };   // 미래 시각 — 판정하지 않음
  return { status: age > i.maxAgeSeconds ? 'stale_signal_candidate' : 'available_reference', ageSeconds: age, signalIsNotFact: true };
}

/* ── 2) Signal 정규화(Missing Signal ≠ Failure) ──────────────────────── */
export function normalizeRuntimeSignals(signals: { type: string; status: string }[] | null): { rows: { type: string; status: string }[]; invalidSignals: number; counts: Record<string, number>; missingSignalIsNotFailure: true } {
  const valid = (signals ?? []).filter((s) => (ASSURANCE_SIGNAL_TYPES as readonly string[]).includes(s.type) && (ASSURANCE_SIGNAL_STATUSES as readonly string[]).includes(s.status));
  const counts: Record<string, number> = {};
  for (const s of valid) counts[s.status] = (counts[s.status] ?? 0) + 1;
  return { rows: valid.slice(0, 200), invalidSignals: (signals ?? []).length - valid.length, counts, missingSignalIsNotFailure: true };
}

/* ── 3) Connector Health(Health ≠ Action Success·Business Outcome 아님) ── */
export function evaluateConnectorHealth(i: { instanceExists: boolean; connectionStatus: string | null; permissionStatus: string | null; scopeStatus: string | null; credentialReferenced: boolean | null; lastVerifiedAt: Date | null; now: Date; staleAfterSeconds: number; recentFailures: number | null; rateLimited: boolean | null }): { result: 'connector_healthy_reference' | 'connector_healthy_with_limitation' | 'connector_degraded_candidate' | 'connector_rate_limited' | 'connector_failure_candidate' | 'connector_permission_unverified' | 'connector_scope_unverified' | 'connector_credential_unverified' | 'connector_status_stale' | 'connector_unavailable' | 'insufficient_data'; healthIsNotActionSuccess: true; healthIsNotBusinessOutcome: true } {
  const flags = { healthIsNotActionSuccess: true as const, healthIsNotBusinessOutcome: true as const };
  if (!i.instanceExists) return { result: 'connector_unavailable', ...flags };
  if (i.connectionStatus == null) return { result: 'insufficient_data', ...flags };
  if (i.connectionStatus === 'disabled' || i.connectionStatus === 'connector_unavailable') return { result: 'connector_unavailable', ...flags };
  if (i.rateLimited === true || i.connectionStatus === 'rate_limited') return { result: 'connector_rate_limited', ...flags };
  if (i.recentFailures != null && isFiniteNumber(i.recentFailures) && i.recentFailures > 0) return { result: 'connector_failure_candidate', ...flags };
  if (i.credentialReferenced == null || !i.credentialReferenced) return { result: 'connector_credential_unverified', ...flags };
  if (i.permissionStatus !== 'permission_verified_reference') return { result: 'connector_permission_unverified', ...flags };
  if (i.scopeStatus !== 'scope_verified_reference') return { result: 'connector_scope_unverified', ...flags };
  if (i.lastVerifiedAt == null) return { result: 'connector_status_stale', ...flags };
  const age = Math.floor((i.now.getTime() - i.lastVerifiedAt.getTime()) / 1000);
  if (!isFiniteNumber(age) || age < 0) return { result: 'insufficient_data', ...flags };
  if (age > i.staleAfterSeconds) return { result: 'connector_status_stale', ...flags };
  if (i.connectionStatus === 'partially_available') return { result: 'connector_healthy_with_limitation', ...flags };
  if (i.connectionStatus === 'connector_status_unknown') return { result: 'connector_degraded_candidate', ...flags };
  return { result: 'connector_healthy_reference', ...flags };
}

/* ── 4) Runtime Progress(Heartbeat ≠ Progress·Checkpoint ≠ 완료 검증) ── */
export function evaluateRuntimeProgress(i: { sessionStatus: string | null; checkpointCount: number | null; hasActionAttempt: boolean; hasConnectorResponse: boolean; hasResultReview: boolean }): { result: 'progress_not_started' | 'progress_ready_reference' | 'progress_active_reference' | 'progress_checkpointed_reference' | 'progress_waiting_response' | 'progress_waiting_verification' | 'progress_waiting_observation' | 'progress_waiting_cleanup' | 'progress_waiting_closure' | 'progress_stalled_candidate' | 'progress_unverified' | 'insufficient_data'; checkpointIsNotVerifiedCompletion: true } {
  const s = i.sessionStatus;
  if (s == null) return { result: 'insufficient_data', checkpointIsNotVerifiedCompletion: true };
  if (['draft', 'pending_review'].includes(s)) return { result: 'progress_not_started', checkpointIsNotVerifiedCompletion: true };
  if (['ready_reference', 'start_requested_reference'].includes(s)) return { result: 'progress_ready_reference', checkpointIsNotVerifiedCompletion: true };
  if (s === 'observation_pending') return { result: 'progress_waiting_observation', checkpointIsNotVerifiedCompletion: true };
  if (s === 'closure_pending') return { result: 'progress_waiting_closure', checkpointIsNotVerifiedCompletion: true };
  if (s === 'result_verification_pending' || (i.hasConnectorResponse && !i.hasResultReview)) return { result: 'progress_waiting_verification', checkpointIsNotVerifiedCompletion: true };
  if (s === 'started_reference' || s === 'checkpoint_reference' || s === 'action_reported_reference') {
    if (i.hasActionAttempt && !i.hasConnectorResponse) return { result: 'progress_waiting_response', checkpointIsNotVerifiedCompletion: true };
    if (i.checkpointCount != null && isFiniteNumber(i.checkpointCount) && i.checkpointCount > 0) return { result: 'progress_checkpointed_reference', checkpointIsNotVerifiedCompletion: true };
    return { result: 'progress_active_reference', checkpointIsNotVerifiedCompletion: true };
  }
  if (['completed_reference', 'failed_reference', 'cancelled_reference', 'invalidated', 'paused_reference', 'pause_requested', 'cancellation_requested', 'timeout_reference'].includes(s)) {
    return { result: 'progress_unverified', checkpointIsNotVerifiedCompletion: true };   // 종결/중간 상태 — 진행 판정하지 않음
  }
  return { result: 'progress_unverified', checkpointIsNotVerifiedCompletion: true };
}

/* ── 5) Stall Detection(Candidate ≠ Confirmed Stall) ─────────────────── */
export function detectStallCandidate(i: { started: boolean; lastActivityAt: Date | null; now: Date; expectedDurationSeconds: number | null; paused: boolean; cancellationRequested: boolean }): { result: 'no_stall_reference' | 'stall_candidate' | 'checkpoint_stale_candidate' | 'pause_state_unverified' | 'cancellation_state_unverified' | 'insufficient_data'; notes: string[]; candidateIsNotConfirmedStall: true } {
  if (!i.started) return { result: 'no_stall_reference', notes: ['미시작 — Stall 판정 대상 아님'], candidateIsNotConfirmedStall: true };
  if (i.paused) return { result: 'pause_state_unverified', notes: ['Pause 상태 — 실제 Pause 확정 별도 검증 필요'], candidateIsNotConfirmedStall: true };
  if (i.cancellationRequested) return { result: 'cancellation_state_unverified', notes: ['Cancel 요청 상태 — 확정 별도 검증 필요'], candidateIsNotConfirmedStall: true };
  if (i.lastActivityAt == null) return { result: 'stall_candidate', notes: ['활동 Signal 없음 — Missing Signal ≠ Failure', 'external_action_may_continue'], candidateIsNotConfirmedStall: true };
  if (i.expectedDurationSeconds == null || !isFiniteNumber(i.expectedDurationSeconds)) return { result: 'insufficient_data', notes: ['Expected Duration 원본 없음 — 임의 판정 없음'], candidateIsNotConfirmedStall: true };
  const age = Math.floor((i.now.getTime() - i.lastActivityAt.getTime()) / 1000);
  if (!isFiniteNumber(age) || age < 0) return { result: 'insufficient_data', notes: [], candidateIsNotConfirmedStall: true };
  if (age > i.expectedDurationSeconds * 2) return { result: 'stall_candidate', notes: ['external_action_may_continue'], candidateIsNotConfirmedStall: true };
  if (age > i.expectedDurationSeconds) return { result: 'checkpoint_stale_candidate', notes: [], candidateIsNotConfirmedStall: true };
  return { result: 'no_stall_reference', notes: [], candidateIsNotConfirmedStall: true };
}

/* ── 6) Timeout Candidate(Timeout ≠ Failure 확정) ────────────────────── */
export function detectTimeoutCandidate(i: { timeoutPolicySeconds: number | null; startedAt: Date | null; now: Date; timeoutReferenceRecorded: boolean }): { result: 'timeout_not_detected' | 'timeout_approaching_candidate' | 'timeout_candidate' | 'timeout_reference_recorded' | 'insufficient_data'; notes: string[]; timeoutIsNotFailure: true } {
  if (i.timeoutReferenceRecorded) return { result: 'timeout_reference_recorded', notes: ['external_action_may_continue', 'result_recheck_required', 'cleanup_review_required'], timeoutIsNotFailure: true };
  if (i.timeoutPolicySeconds == null || !isFiniteNumber(i.timeoutPolicySeconds)) return { result: 'insufficient_data', notes: ['Timeout Policy 원본 없음 — 임의 판정 없음'], timeoutIsNotFailure: true };
  if (i.startedAt == null) return { result: 'timeout_not_detected', notes: ['미시작'], timeoutIsNotFailure: true };
  const elapsed = Math.floor((i.now.getTime() - i.startedAt.getTime()) / 1000);
  if (!isFiniteNumber(elapsed) || elapsed < 0) return { result: 'insufficient_data', notes: [], timeoutIsNotFailure: true };
  if (elapsed > i.timeoutPolicySeconds) return { result: 'timeout_candidate', notes: ['external_action_may_continue', 'result_recheck_required'], timeoutIsNotFailure: true };
  if (elapsed > i.timeoutPolicySeconds * 0.8) return { result: 'timeout_approaching_candidate', notes: [], timeoutIsNotFailure: true };
  return { result: 'timeout_not_detected', notes: [], timeoutIsNotFailure: true };
}

/* ── 7) Duplicate Candidate(Candidate ≠ Confirmed·자동 제거 없음) ────── */
export function detectDuplicateCandidate(i: { sameInputHashSessions: number | null; sameIdempotencyKeyCount: number | null; sameExternalReferenceCount: number | null; idempotencyKeyPresent: boolean; isWriteAction: boolean }): { results: string[]; verdict: 'duplicate_not_detected' | 'duplicate_candidate_detected' | 'idempotency_unverified' | 'insufficient_data'; candidateIsNotConfirmedDuplicate: true; autoDeduplication: false; autoCancellation: false } {
  const flags = { candidateIsNotConfirmedDuplicate: true as const, autoDeduplication: false as const, autoCancellation: false as const };
  const results: string[] = [];
  if (i.sameInputHashSessions == null && i.sameIdempotencyKeyCount == null && i.sameExternalReferenceCount == null) {
    return { results: [], verdict: 'insufficient_data', ...flags };
  }
  if (i.sameInputHashSessions != null && isFiniteNumber(i.sameInputHashSessions) && i.sameInputHashSessions > 1) results.push('duplicate_session_candidate');
  if (i.sameIdempotencyKeyCount != null && isFiniteNumber(i.sameIdempotencyKeyCount) && i.sameIdempotencyKeyCount > 1) results.push('duplicate_request_candidate');
  if (i.sameExternalReferenceCount != null && isFiniteNumber(i.sameExternalReferenceCount) && i.sameExternalReferenceCount > 1) results.push('duplicate_external_reference_candidate');
  if (results.length && i.isWriteAction) results.push('duplicate_side_effect_risk');
  if (!i.idempotencyKeyPresent) {
    results.push('idempotency_unverified');
    return { results, verdict: 'idempotency_unverified', ...flags };
  }
  return { results, verdict: results.length ? 'duplicate_candidate_detected' : 'duplicate_not_detected', ...flags };
}

/* ── 8) Evidence Completeness(Evidence Gap ≠ Execution Failure) ──────── */
export function evaluateEvidenceCompleteness(i: { approval: boolean; gate: boolean; start: boolean | null; action: boolean | null; response: boolean | null; verification: boolean | null; cleanup: boolean | null; observation: boolean | null; closure: boolean | null }): { result: 'evidence_complete_reference' | 'evidence_partial' | 'evidence_gap'; missing: string[]; notApplicable: number; evidenceGapIsNotFailure: true } {
  const missing: string[] = [];
  let notApplicable = 0;
  if (!i.approval) missing.push('approval_evidence_missing');
  if (!i.gate) missing.push('gate_evidence_missing');
  const stages: [string, boolean | null][] = [['runtime_start_evidence_missing', i.start], ['action_evidence_missing', i.action], ['response_evidence_missing', i.response], ['verification_evidence_missing', i.verification], ['cleanup_evidence_missing', i.cleanup], ['observation_evidence_missing', i.observation], ['closure_evidence_missing', i.closure]];
  for (const [key, val] of stages) {
    if (val == null) { notApplicable += 1; continue; }   // 해당 단계 미도달 — 결측으로 세지 않음(unknown 유지)
    if (!val) missing.push(key);
  }
  return {
    result: !missing.length ? 'evidence_complete_reference' : missing.length <= 2 ? 'evidence_partial' : 'evidence_gap',
    missing, notApplicable, evidenceGapIsNotFailure: true,
  };
}

/* ── 9) Review Delay(SLA 원본 없으면 임의 판정 없음) ─────────────────── */
export function evaluateReviewDelay(i: { kind: 'runtime_start' | 'result' | 'cleanup' | 'observation' | 'closure'; slaSeconds: number | null; waitingSeconds: number | null; reviewerAssigned: boolean }): { result: 'review_on_time_reference' | 'runtime_start_review_delayed' | 'result_review_delayed' | 'cleanup_review_delayed' | 'observation_review_delayed' | 'closure_review_delayed' | 'reviewer_missing' | 'insufficient_data'; slaDefined: boolean } {
  if (!i.reviewerAssigned) return { result: 'reviewer_missing', slaDefined: i.slaSeconds != null };
  if (i.slaSeconds == null || !isFiniteNumber(i.slaSeconds)) return { result: 'insufficient_data', slaDefined: false };   // SLA 원본 없음 — 임의 SLA 판정 금지
  if (i.waitingSeconds == null || !isFiniteNumber(i.waitingSeconds) || i.waitingSeconds < 0) return { result: 'insufficient_data', slaDefined: true };
  if (i.waitingSeconds <= i.slaSeconds) return { result: 'review_on_time_reference', slaDefined: true };
  const map = { runtime_start: 'runtime_start_review_delayed', result: 'result_review_delayed', cleanup: 'cleanup_review_delayed', observation: 'observation_review_delayed', closure: 'closure_review_delayed' } as const;
  return { result: map[i.kind], slaDefined: true };
}

/* ── 10) Runtime Assurance State(Snapshot — 원본 대체 없음) ──────────── */
export function evaluateRuntimeAssurance(i: { connectorHealthy: boolean | null; progressResult: string; stallResult: string; timeoutResult: string; duplicateVerdict: string; evidenceResult: string; openIncidentCandidates: number | null; escalationsPending: number | null }): { status: (typeof ASSURANCE_STATUSES)[number]; stateIsSnapshotNotSource: true } {
  if (i.openIncidentCandidates != null && isFiniteNumber(i.openIncidentCandidates) && i.openIncidentCandidates > 0) return { status: 'incident_candidate', stateIsSnapshotNotSource: true };
  if (i.escalationsPending != null && isFiniteNumber(i.escalationsPending) && i.escalationsPending > 0) return { status: 'escalation_pending', stateIsSnapshotNotSource: true };
  if (i.stallResult === 'stall_candidate') return { status: 'stalled_candidate', stateIsSnapshotNotSource: true };
  if (i.timeoutResult === 'timeout_candidate' || i.timeoutResult === 'timeout_reference_recorded') return { status: 'timeout_candidate', stateIsSnapshotNotSource: true };
  if (i.duplicateVerdict === 'duplicate_candidate_detected') return { status: 'duplicate_candidate', stateIsSnapshotNotSource: true };
  if (i.evidenceResult === 'evidence_gap') return { status: 'evidence_gap', stateIsSnapshotNotSource: true };
  if (i.stallResult === 'checkpoint_stale_candidate' || i.timeoutResult === 'timeout_approaching_candidate') return { status: 'warning_candidate', stateIsSnapshotNotSource: true };
  if (i.connectorHealthy == null) return { status: 'unknown', stateIsSnapshotNotSource: true };
  if (!i.connectorHealthy) return { status: 'degraded_candidate', stateIsSnapshotNotSource: true };
  if (i.progressResult === 'insufficient_data') return { status: 'insufficient_data', stateIsSnapshotNotSource: true };
  if (i.evidenceResult === 'evidence_partial') return { status: 'healthy_with_limitation', stateIsSnapshotNotSource: true };
  if (['progress_active_reference', 'progress_checkpointed_reference', 'progress_waiting_response', 'progress_waiting_verification'].includes(i.progressResult)) return { status: 'monitoring_reference', stateIsSnapshotNotSource: true };
  return { status: 'healthy_reference', stateIsSnapshotNotSource: true };
}

/* ── 11) Incident Severity(결측 재정규화 없음·Critical ≠ 자동 조치) ──── */
export function evaluateIncidentSeverity(i: { productionProximity: boolean | null; externalSideEffect: boolean | null; financialImpact: boolean | null; dataSensitivity: boolean | null; irreversible: boolean | null; duplicateSideEffectRisk: boolean | null }): { severity: (typeof ASSURANCE_SEVERITIES)[number]; unknownComponents: string[]; criticalIsNotAutomaticAction: true } {
  const entries = Object.entries(i) as [string, boolean | null][];
  const unknownComponents = entries.filter(([, v]) => v == null).map(([k]) => k);
  if (unknownComponents.length === entries.length) return { severity: 'insufficient_data', unknownComponents, criticalIsNotAutomaticAction: true };
  if (unknownComponents.length > 0) return { severity: 'severity_unverified', unknownComponents, criticalIsNotAutomaticAction: true };   // 결측 시 재정규화 없이 unverified 유지
  if (i.productionProximity || i.irreversible) return { severity: 'critical', unknownComponents, criticalIsNotAutomaticAction: true };
  if (i.financialImpact || i.duplicateSideEffectRisk) return { severity: 'high', unknownComponents, criticalIsNotAutomaticAction: true };
  if (i.externalSideEffect || i.dataSensitivity) return { severity: 'moderate', unknownComponents, criticalIsNotAutomaticAction: true };
  return { severity: 'low', unknownComponents, criticalIsNotAutomaticAction: true };
}

/* ── 12) Incident Candidate 검증(확정 Incident 아님) ─────────────────── */
export function buildRuntimeIncidentCandidate(i: { type: string; severity: string; evidence: string[]; reason: string }):
  | { rejected: true; rejectReason: string }
  | { type: string; severity: string; evidence: string[]; reason: string; candidateIsNotConfirmedIncident: true; autoRegisteredToIncidents: false; autoActionTaken: false } {
  if (!(RUNTIME_INCIDENT_TYPES as readonly string[]).includes(i.type)) return { rejected: true, rejectReason: `허용되지 않는 incident type: ${i.type}` };
  if (!(ASSURANCE_SEVERITIES as readonly string[]).includes(i.severity)) return { rejected: true, rejectReason: '허용되지 않는 severity' };
  if (!i.evidence.length) return { rejected: true, rejectReason: 'Evidence 없는 Candidate 금지(insufficient_data)' };
  if (!i.reason.trim()) return { rejected: true, rejectReason: 'Reason 필수' };
  return { type: i.type, severity: i.severity, evidence: i.evidence.slice(0, 10), reason: i.reason, candidateIsNotConfirmedIncident: true, autoRegisteredToIncidents: false, autoActionTaken: false };
}

/* ── 13) Escalation Readiness(권고 ≠ 실제 Escalation·자동 발송 없음) ─── */
export function evaluateEscalationReadiness(i: { severity: string; acknowledged: boolean; investigationStarted: boolean; specialistRequired: boolean; executiveRequired: boolean; resolved: boolean }): { status: 'escalation_not_required' | 'escalation_recommended' | 'escalation_pending' | 'acknowledged_reference' | 'investigation_in_progress_reference' | 'specialist_review_required' | 'executive_review_required' | 'resolution_pending' | 'resolved_reference' | 'insufficient_data'; recommendationIsNotEscalation: true; autoMessageSent: false } {
  const flags = { recommendationIsNotEscalation: true as const, autoMessageSent: false as const };
  if (!(ASSURANCE_SEVERITIES as readonly string[]).includes(i.severity)) return { status: 'insufficient_data', ...flags };
  if (i.resolved) return { status: 'resolved_reference', ...flags };
  if (i.executiveRequired) return { status: 'executive_review_required', ...flags };
  if (i.specialistRequired) return { status: 'specialist_review_required', ...flags };
  if (i.investigationStarted) return { status: 'investigation_in_progress_reference', ...flags };
  if (i.acknowledged) return { status: 'acknowledged_reference', ...flags };
  if (i.severity === 'high' || i.severity === 'critical') return { status: 'escalation_recommended', ...flags };
  if (i.severity === 'severity_unverified' || i.severity === 'insufficient_data') return { status: 'escalation_pending', ...flags };   // 판정 불가 — 사람 검토 대기
  return { status: 'escalation_not_required', ...flags };
}

/* ── 14) Recovery Readiness(자동 Recovery 없음) ──────────────────────── */
export function evaluateRecoveryReadiness(i: { recoveryRequired: boolean | null; pauseReviewNeeded: boolean; cancellationReviewNeeded: boolean; resultRecheckNeeded: boolean; cleanupReviewNeeded: boolean; rollbackReviewNeeded: boolean; connectorDisableReviewNeeded: boolean; irreversibleEffect: boolean; reviewerAssigned: boolean; observationPlanDefined: boolean }): { result: 'recovery_not_required' | 'recovery_ready_reference' | 'recovery_partially_ready' | 'pause_review_required' | 'cancellation_review_required' | 'result_recheck_required' | 'cleanup_review_required' | 'rollback_review_required' | 'connector_disable_review_required' | 'manual_intervention_required' | 'recovery_unverified' | 'irreversible_effect_candidate' | 'insufficient_data'; pendingReviews: string[]; autoRecovery: false; recoveryPlanIsNotRecoverySuccess: true } {
  const flags = { autoRecovery: false as const, recoveryPlanIsNotRecoverySuccess: true as const };
  if (i.recoveryRequired == null) return { result: 'insufficient_data', pendingReviews: [], ...flags };
  if (!i.recoveryRequired) return { result: 'recovery_not_required', pendingReviews: [], ...flags };
  if (i.irreversibleEffect) return { result: 'irreversible_effect_candidate', pendingReviews: [], ...flags };
  const pending: string[] = [];
  if (i.pauseReviewNeeded) pending.push('pause_review_required');
  if (i.cancellationReviewNeeded) pending.push('cancellation_review_required');
  if (i.resultRecheckNeeded) pending.push('result_recheck_required');
  if (i.cleanupReviewNeeded) pending.push('cleanup_review_required');
  if (i.rollbackReviewNeeded) pending.push('rollback_review_required');
  if (i.connectorDisableReviewNeeded) pending.push('connector_disable_review_required');
  if (!i.reviewerAssigned) return { result: 'manual_intervention_required', pendingReviews: pending, ...flags };
  if (!i.observationPlanDefined) return { result: 'recovery_unverified', pendingReviews: pending, ...flags };
  if (pending.length) return { result: pending[0] as ReturnType<typeof evaluateRecoveryReadiness>['result'], pendingReviews: pending, ...flags };
  return { result: 'recovery_ready_reference', pendingReviews: [], ...flags };
}

/* ── 15) Runtime Resolution(Resolution ≠ Outcome Success) ────────────── */
export function evaluateRuntimeResolution(i: { incidentReviewed: boolean; evidenceReviewed: boolean; sideEffectReviewed: boolean; recoveryReviewed: boolean; observationReviewed: boolean; followUpRequired: boolean; limitations: string[] }): { result: 'resolution_pending' | 'resolved_reference' | 'resolved_with_limitation' | 'monitoring_required' | 'recovery_review_required' | 'observation_extension_required' | 'result_unverified'; resolutionIsNotOutcomeSuccess: true; humanResolutionRequired: true } {
  const flags = { resolutionIsNotOutcomeSuccess: true as const, humanResolutionRequired: true as const };
  if (!i.incidentReviewed || !i.evidenceReviewed) return { result: 'resolution_pending', ...flags };
  if (!i.sideEffectReviewed) return { result: 'result_unverified', ...flags };
  if (!i.recoveryReviewed) return { result: 'recovery_review_required', ...flags };
  if (!i.observationReviewed) return { result: 'observation_extension_required', ...flags };
  if (i.followUpRequired) return { result: 'monitoring_required', ...flags };
  return { result: i.limitations.length ? 'resolved_with_limitation' : 'resolved_reference', ...flags };
}

/* ── 16) Assurance Recommendation(22종 whitelist·Evidence 필수) ──────── */
export function buildAssuranceRecommendation(i: { type: string; reason: string; evidence: string[]; confidence: number | null; alternatives?: string[]; limitations?: string[] }):
  | { rejected: true; rejectReason: string }
  | { type: string; reason: string; evidence: string[]; confidence: number | null; alternatives: string[]; limitations: string[]; humanApprovalRequired: true; autoActionTaken: false } {
  if (!(ASSURANCE_RECOMMENDATION_TYPES as readonly string[]).includes(i.type)) return { rejected: true, rejectReason: `허용되지 않는 recommendation type: ${i.type}` };
  if (!i.evidence.length) return { rejected: true, rejectReason: 'Evidence 없는 권고 금지(insufficient_data)' };
  if (!i.reason.trim()) return { rejected: true, rejectReason: 'Reason 필수' };
  return {
    type: i.type, reason: i.reason, evidence: i.evidence.slice(0, 10),
    confidence: i.confidence != null && isFiniteNumber(i.confidence) ? clampScore(i.confidence) : null,
    alternatives: (i.alternatives ?? []).slice(0, 5),
    limitations: [...(i.limitations ?? []), 'Signal ≠ Fact', 'Candidate ≠ Confirmed Incident', 'Confidence ≠ Correctness'].slice(0, 10),
    humanApprovalRequired: true, autoActionTaken: false,
  };
}

/* ── 17) Assurance Timeline(9단계 실측 집계) ─────────────────────────── */
export function buildAssuranceTimeline(counts: { stage: string; count: number | null; source: string }[] | null): { stages: { stage: string; count: number | null; source: string; status: 'measured' | 'insufficient_data' }[]; invalidStages: number; timelineIsNotCompletionClaim: true } {
  const valid = (counts ?? []).filter((c) => (ASSURANCE_TIMELINE_STAGES as readonly string[]).includes(c.stage));
  const byStage = new Map(valid.map((c) => [c.stage, c]));
  return {
    stages: ASSURANCE_TIMELINE_STAGES.map((stage) => {
      const c = byStage.get(stage);
      const count = c && c.count != null && isFiniteNumber(c.count) ? c.count : null;
      return { stage, count, source: c?.source ?? '원본 없음', status: count != null ? ('measured' as const) : ('insufficient_data' as const) };
    }),
    invalidStages: (counts ?? []).length - valid.length,
    timelineIsNotCompletionClaim: true,
  };
}

/* ── 실측 Assurance 구성요소(코드/Migration 기준 — 빌드 시점) ────────── */
export const ASSURANCE_COMPONENTS: { key: string; available: boolean | null; note: string }[] = [
  { key: 'session_timestamps_0536', available: true, note: 'started/checkpoint/pause/cancel/completed/timeout 타임스탬프 8종 실존' },
  { key: 'runtime_events_0536', available: true, note: '30종 이벤트(attempt/response/result/cleanup/observation/closure) 실존' },
  { key: 'connector_instance_status_0536', available: true, note: 'connection/permission/scope/health_status + last_verified_at 실존' },
  { key: 'sentry_error_tracking', available: true, note: '@sentry/react captureError 실존 — 자동 Incident 등록에는 사용하지 않음' },
  { key: 'pg_cron_advisory_locks', available: true, note: '실존 — 본 계층에서 사용하지 않음(자동 Polling 없음)' },
  { key: 'connector_success_failure_columns', available: false, note: 'last_success/last_failure_reference_at·rate_limit_status 컬럼 없음(0536 실측) — signal_unavailable' },
  { key: 'runtime_heartbeat', available: false, note: 'Heartbeat 없음 — Heartbeat ≠ Progress 원칙과 무관하게 원본 자체 부재' },
  { key: 'runtime_metrics', available: false, note: '범용 Runtime Metrics 없음' },
  { key: 'worker_queue_dlq', available: false, note: 'Worker Queue/DLQ 없음' },
  { key: 'lease_cancellation_token', available: false, note: 'Lease/Cancellation Token 없음' },
  { key: 'alert_integration', available: false, note: 'Alert 연동 없음 — 자동 Escalation 메시지 발송 불가+금지' },
];

/* ── Support Matrix(38항목) ──────────────────────────────────────────── */
export const RUNTIME_ASSURANCE_SUPPORT: { key: string; status: string; note: string }[] = [
  { key: 'runtime_signal_collection', status: 'evidence_only', note: '0536 타임스탬프/이벤트 실측 + 사람 기록 — Signal ≠ Fact' },
  { key: 'signal_normalization', status: 'fully_supported', note: '19종 whitelist — Missing Signal ≠ Failure' },
  { key: 'signal_freshness', status: 'fully_supported', note: 'stale_signal_candidate 유지 — Date 주입' },
  { key: 'runtime_assurance_state', status: 'fully_supported', note: '순수 로직 Snapshot — 원본 Runtime Event 대체 없음(테이블 미생성)' },
  { key: 'connector_health_intelligence', status: 'partially_supported', note: 'success/failure/rate_limit 컬럼 없음 — Health ≠ Action Success' },
  { key: 'runtime_progress_evaluation', status: 'fully_supported', note: 'Checkpoint ≠ Verified Completion' },
  { key: 'checkpoint_continuity', status: 'fully_supported', note: 'checkpoint_count/last_checkpoint_at 실측 — stale 감지' },
  { key: 'stall_detection', status: 'incident_candidate_only', note: 'Candidate ≠ Confirmed Stall — 자동 확정 없음' },
  { key: 'timeout_detection', status: 'incident_candidate_only', note: 'Timeout ≠ Failure — external_action_may_continue 명시' },
  { key: 'duplicate_detection', status: 'incident_candidate_only', note: 'Candidate ≠ Confirmed — 자동 제거/취소 없음' },
  { key: 'evidence_completeness', status: 'evidence_only', note: 'Evidence Gap ≠ Execution Failure — 미도달 단계 unknown 유지' },
  { key: 'result_verification_delay', status: 'partially_supported', note: 'SLA 원본 없으면 임의 판정 없음(insufficient_data)' },
  { key: 'cleanup_delay', status: 'partially_supported', note: 'SLA 원본 없으면 임의 판정 없음' },
  { key: 'observation_delay', status: 'partially_supported', note: 'SLA 원본 없으면 임의 판정 없음' },
  { key: 'human_review_delay', status: 'partially_supported', note: 'reviewer_missing 감지 — SLA 임의 생성 없음' },
  { key: 'runtime_incident_candidate', status: 'incident_candidate_only', note: '15종 — ai_incidents(0502) 자동 등록 없음' },
  { key: 'incident_severity', status: 'fully_supported', note: '결측 재정규화 없음(severity_unverified) — Critical ≠ 자동 조치' },
  { key: 'human_escalation', status: 'escalation_reference_only', note: '요청/확인 기록만 — 자동 메시지 발송 없음' },
  { key: 'investigation_reference', status: 'escalation_reference_only', note: '시작 Reference 기록만' },
  { key: 'pause_review_recommendation', status: 'reference_only', note: 'Pause 권고 ≠ Pause 실행' },
  { key: 'cancellation_review_recommendation', status: 'reference_only', note: 'Cancel 권고 ≠ Cancellation' },
  { key: 'connector_disable_recommendation', status: 'reference_only', note: '비활성 권고 ≠ 실제 Disable' },
  { key: 'result_recheck_recommendation', status: 'reference_only', note: '재조회 권고 — 자동 재조회 없음' },
  { key: 'cleanup_review_recommendation', status: 'reference_only', note: '자동 Cleanup 없음' },
  { key: 'rollback_review_recommendation', status: 'reference_only', note: 'Rollback Plan ≠ Rollback Execution ≠ Success' },
  { key: 'recovery_readiness', status: 'recovery_reference_only', note: '자동 Recovery 없음 — irreversible 후보 감지' },
  { key: 'runtime_resolution', status: 'fully_supported', note: 'Resolution ≠ Outcome Success — Evidence 없는 resolve 서버 차단' },
  { key: 'runtime_recommendation', status: 'fully_supported', note: '22종 whitelist·Evidence 필수 — 자동 조치 없음' },
  { key: 'assurance_timeline', status: 'fully_supported', note: '9단계 실측 집계' },
  { key: 'assurance_audit', status: 'fully_supported', note: '18종 이벤트 — 장애/해결 자동 의미 없음' },
  { key: 'automatic_runtime_pause', status: 'unsupported', note: '실제 Runtime 중단/재개 금지' },
  { key: 'automatic_runtime_cancellation', status: 'unsupported', note: '실제 Runtime 취소 금지' },
  { key: 'automatic_connector_disable', status: 'unsupported', note: '실제 Connector 비활성/재연결 금지' },
  { key: 'automatic_retry', status: 'unsupported', note: '자동 Retry 금지' },
  { key: 'automatic_cleanup', status: 'unsupported', note: '자동 Cleanup 금지' },
  { key: 'automatic_rollback', status: 'unsupported', note: '자동 Rollback 금지' },
  { key: 'automatic_incident_resolution', status: 'unsupported', note: '자동 Incident 해결 금지' },
  { key: 'automatic_production_execution', status: 'unsupported', note: '자동 Production/Merge/Deploy/Migration Apply 금지' },
];
