/**
 * runtimeControl — Enterprise Connector Governance, Approved Automation Lifecycle &
 * Supervised Runtime Control Center 순수 로직 (Phase AI-OPS-33).
 *
 * Approved Execution Request → Connector Capability Resolution → Automation Definition →
 * Runtime Preconditions → Supervised Execution Session → Checkpoint/Pause/Cancel →
 * Connector Action Evidence → Result Verification → Observation → Human Closure.
 *
 * 실행 정직성(전부 코드로 강제):
 *  - Connector Registry ≠ Availability ≠ Permission. Approval ≠ Runtime Start.
 *  - Runtime Start ≠ Action Completion ≠ Result Verification.
 *  - HTTP 2xx ≠ Business Success. Draft Created ≠ Message Sent.
 *  - Pause/Cancel Requested ≠ Paused/Cancelled. Timeout ≠ 실패 확정.
 *  - Retry ≠ Recovery. Cleanup Plan ≠ Cleanup Success. Closure ≠ Outcome.
 *  - 자동 Connector 실행/발송/생성/재시도/Cleanup/Rollback/무인 장기 실행 없음.
 *  - Unknown 유지(null→0 금지). deterministic · pure · null 안전 · Date 주입.
 */
import { isFiniteNumber, clampScore } from './aiMemory';

/* ── 상수 ─────────────────────────────────────────────────────────────── */
export const CONNECTOR_DOMAINS = ['email', 'messaging', 'source_control', 'issue_tracking', 'calendar', 'document_storage', 'deployment_read', 'database_read', 'analytics_read', 'monitoring_read', 'notification_draft', 'report_export', 'document_generation', 'webhook_reference', 'custom_reference'] as const;
export const BLOCKED_CONNECTOR_DOMAINS = ['payment_write', 'contract_write', 'pricing_write', 'settlement_write', 'production_deployment_write', 'production_database_write', 'infrastructure_write', 'identity_write', 'secret_write', 'policy_write', 'destructive_storage_write'] as const;
export const CONNECTOR_PROVIDERS = ['resend', 'kakao', 'push_fcm', 'payapp_webhook', 'pdf_internal', 'supabase_edge', 'manual', 'none'] as const;
export const RUNTIME_EXECUTION_DOMAINS = ['read_only_query', 'evidence_collection', 'report_generation', 'document_draft', 'email_draft', 'message_draft', 'ticket_draft', 'issue_draft', 'calendar_draft', 'non_production_validation', 'sandbox_test_reference', 'manual_external_action_reference', 'supervised_non_production_action_reference'] as const;
export const CONNECTOR_STATUSES = ['available_reference', 'partially_available', 'read_only', 'draft_only', 'dry_run_only', 'sandbox_only', 'supervised_only', 'disabled', 'connector_unavailable', 'permission_unverified', 'scope_unverified', 'credential_unverified', 'health_unverified', 'rate_limited', 'deprecated', 'unknown', 'insufficient_data'] as const;
export const AUTOMATION_STATUSES = ['draft', 'pending_review', 'approved_reference', 'partially_supported', 'dry_run_only', 'sandbox_only', 'supervised_only', 'disabled', 'invalidated', 'deprecated', 'unsupported', 'insufficient_data'] as const;
export const RUNTIME_TIMELINE_STAGES = ['connector', 'automation', 'session', 'preconditions', 'start', 'action', 'response', 'observation', 'closure'] as const;
export const RUNTIME_RECOMMENDATION_TYPES = ['register_connector_definition', 'verify_connector_instance', 'validate_connector_permission', 'validate_connector_scope', 'disable_connector', 'prepare_automation_definition', 'request_automation_review', 'review_runtime_preconditions', 'request_runtime_start_review', 'create_runtime_checkpoint', 'request_pause_review', 'request_cancellation_review', 'verify_connector_response', 'review_idempotency', 'review_retry_safety', 'review_timeout_result', 'review_cleanup_readiness', 'start_runtime_observation', 'review_unexpected_runtime_effect', 'request_human_runtime_closure', 'insufficient_data'] as const;

/* ── 1) Connector Definition(정의 ≠ Availability ≠ Permission) ───────── */
export function evaluateConnectorDefinition(i: { domain: string; provider: string; requiresSecretAccess: boolean; supportsWrite: boolean }): { valid: boolean; rejectReasons: string[]; definitionIsNotAvailability: true; definitionIsNotPermission: true } {
  const reasons: string[] = [];
  if ((BLOCKED_CONNECTOR_DOMAINS as readonly string[]).includes(i.domain)) reasons.push(`금지 Write 도메인: ${i.domain}`);
  else if (!(CONNECTOR_DOMAINS as readonly string[]).includes(i.domain)) reasons.push('허용되지 않는 connector domain');
  if (!(CONNECTOR_PROVIDERS as readonly string[]).includes(i.provider)) reasons.push('허용되지 않는 provider');
  if (i.requiresSecretAccess) reasons.push('Secret 접근 요구 Connector 차단');
  if (i.supportsWrite && (BLOCKED_CONNECTOR_DOMAINS as readonly string[]).includes(i.domain)) reasons.push('Write 도메인 차단');
  return { valid: reasons.length === 0, rejectReasons: reasons, definitionIsNotAvailability: true, definitionIsNotPermission: true };
}

/* ── 2) Connector Instance Availability ──────────────────────────────── */
export function evaluateConnectorInstance(i: { connectionStatus: string | null; permissionStatus: string | null; scopeStatus: string | null; credentialReferenced: boolean | null; environmentScope: string }): { verdict: 'available_reference' | 'connector_unavailable' | 'connector_status_unknown' | 'connector_permission_unverified' | 'connector_scope_unverified' | 'credential_unverified' | 'production_blocked'; availabilityIsNotPermission: true; permissionIsNotApproval: true } {
  if (i.environmentScope === 'production') return { verdict: 'production_blocked', availabilityIsNotPermission: true, permissionIsNotApproval: true };
  if (i.connectionStatus == null) return { verdict: 'connector_status_unknown', availabilityIsNotPermission: true, permissionIsNotApproval: true };
  if (i.connectionStatus !== 'available_reference' && i.connectionStatus !== 'partially_available') return { verdict: 'connector_unavailable', availabilityIsNotPermission: true, permissionIsNotApproval: true };
  if (i.credentialReferenced == null || !i.credentialReferenced) return { verdict: 'credential_unverified', availabilityIsNotPermission: true, permissionIsNotApproval: true };
  if (i.permissionStatus !== 'permission_verified_reference') return { verdict: 'connector_permission_unverified', availabilityIsNotPermission: true, permissionIsNotApproval: true };
  if (i.scopeStatus !== 'scope_verified_reference') return { verdict: 'connector_scope_unverified', availabilityIsNotPermission: true, permissionIsNotApproval: true };
  return { verdict: 'available_reference', availabilityIsNotPermission: true, permissionIsNotApproval: true };
}

/* ── 3) Automation Definition(정의 ≠ 실행 요청 ≠ 승인) ───────────────── */
export function validateAutomationDefinition(i: { domain: string; mode: string; status: string }): { valid: boolean; rejectReasons: string[]; definitionIsNotExecutionRequest: true; approvedIsNotRuntimeApproval: true } {
  const reasons: string[] = [];
  if (!(RUNTIME_EXECUTION_DOMAINS as readonly string[]).includes(i.domain)) reasons.push(`허용되지 않는/금지된 domain: ${i.domain}`);
  if (i.mode === 'production') reasons.push('production mode 미지원');
  if (!(AUTOMATION_STATUSES as readonly string[]).includes(i.status)) reasons.push('허용되지 않는 status');
  return { valid: reasons.length === 0, rejectReasons: reasons, definitionIsNotExecutionRequest: true, approvedIsNotRuntimeApproval: true };
}

/* ── 4) Runtime Preconditions(23항목 — 첫 결측 즉시 보고) ────────────── */
export function evaluateRuntimePreconditions(i: { approvalLinked: boolean; gateReady: boolean; automationActive: boolean; connectorAvailable: boolean; permissionVerified: boolean; scopeVerified: boolean; environmentAllowed: boolean; dryRunSatisfied: boolean; sandboxSatisfied: boolean; idempotencyKeyPresent: boolean; timeoutDefined: boolean; cancellationPolicyDefined: boolean; cleanupPolicyDefined: boolean; evidenceRequirementsDefined: boolean; observationPlanDefined: boolean; supervisorAssigned: boolean }): { result: 'runtime_ready_reference' | 'approval_missing' | 'gate_missing' | 'connector_unavailable' | 'connector_permission_unverified' | 'connector_scope_unverified' | 'environment_scope_blocked' | 'dry_run_missing' | 'sandbox_missing' | 'idempotency_unverified' | 'timeout_policy_missing' | 'cancellation_policy_missing' | 'cleanup_policy_missing' | 'evidence_requirement_missing' | 'observation_plan_missing' | 'supervisor_missing' | 'insufficient_data'; blockers: string[]; readyIsNotStarted: true } {
  const blockers: string[] = [];
  if (!i.approvalLinked) blockers.push('approval_missing');
  if (!i.gateReady) blockers.push('gate_missing');
  if (!i.automationActive) blockers.push('insufficient_data');
  if (!i.connectorAvailable) blockers.push('connector_unavailable');
  if (!i.permissionVerified) blockers.push('connector_permission_unverified');
  if (!i.scopeVerified) blockers.push('connector_scope_unverified');
  if (!i.environmentAllowed) blockers.push('environment_scope_blocked');
  if (!i.dryRunSatisfied) blockers.push('dry_run_missing');
  if (!i.sandboxSatisfied) blockers.push('sandbox_missing');
  if (!i.idempotencyKeyPresent) blockers.push('idempotency_unverified');
  if (!i.timeoutDefined) blockers.push('timeout_policy_missing');
  if (!i.cancellationPolicyDefined) blockers.push('cancellation_policy_missing');
  if (!i.cleanupPolicyDefined) blockers.push('cleanup_policy_missing');
  if (!i.evidenceRequirementsDefined) blockers.push('evidence_requirement_missing');
  if (!i.observationPlanDefined) blockers.push('observation_plan_missing');
  if (!i.supervisorAssigned) blockers.push('supervisor_missing');
  return { result: blockers.length ? (blockers[0] as ReturnType<typeof evaluateRuntimePreconditions>['result']) : 'runtime_ready_reference', blockers, readyIsNotStarted: true };
}

/* ── 5) Runtime Start(Approval ≠ Start·Start ≠ Action Success) ───────── */
export function evaluateRuntimeStart(i: { preconditionsReady: boolean; startRequested: boolean; startEvidence: string[]; supervisorAssigned: boolean }): { result: 'runtime_start_unverified' | 'start_requested_reference' | 'started_reference' | 'supervisor_missing' | 'precondition_missing'; startIsNotActionSuccess: true; autoStarted: false } {
  if (!i.preconditionsReady) return { result: 'precondition_missing', startIsNotActionSuccess: true, autoStarted: false };
  if (!i.supervisorAssigned) return { result: 'supervisor_missing', startIsNotActionSuccess: true, autoStarted: false };
  if (!i.startRequested) return { result: 'runtime_start_unverified', startIsNotActionSuccess: true, autoStarted: false };
  if (!i.startEvidence.length) return { result: 'start_requested_reference', startIsNotActionSuccess: true, autoStarted: false };
  return { result: 'started_reference', startIsNotActionSuccess: true, autoStarted: false };
}

/* ── 6) Runtime Checkpoint(완전한 상태 검증 아님·stale 감지) ─────────── */
export function evaluateRuntimeCheckpoint(i: { lastCheckpointAt: Date | null; now: Date; maxIntervalSeconds: number; checkpointCount: number | null }): { result: 'checkpoint_reference' | 'stale_input_candidate' | 'insufficient_data'; ageSeconds: number | null; checkpointIsNotFullVerification: true } {
  if (i.lastCheckpointAt == null || i.checkpointCount == null) return { result: 'insufficient_data', ageSeconds: null, checkpointIsNotFullVerification: true };
  const age = Math.floor((i.now.getTime() - i.lastCheckpointAt.getTime()) / 1000);
  if (!isFiniteNumber(age) || age < 0) return { result: 'insufficient_data', ageSeconds: null, checkpointIsNotFullVerification: true };
  return { result: age > i.maxIntervalSeconds ? 'stale_input_candidate' : 'checkpoint_reference', ageSeconds: age, checkpointIsNotFullVerification: true };
}

/* ── 7) Pause Governance(Pause Request ≠ Pause Success) ──────────────── */
export function evaluatePauseReadiness(i: { connectorSupportsPause: boolean | null; requested: boolean; confirmationEvidence: string[]; partialExecutionPossible: boolean }): { result: 'pause_supported_reference' | 'pause_request_only' | 'pause_unavailable' | 'pause_requested' | 'pause_confirmed_reference' | 'pause_unverified' | 'insufficient_data'; warnings: string[]; pauseRequestIsNotPauseSuccess: true } {
  const warnings = i.partialExecutionPossible ? ['partial_execution_risk'] : [];
  if (i.connectorSupportsPause == null) return { result: 'insufficient_data', warnings, pauseRequestIsNotPauseSuccess: true };
  if (!i.connectorSupportsPause) return { result: i.requested ? 'pause_unverified' : 'pause_unavailable', warnings, pauseRequestIsNotPauseSuccess: true };
  if (!i.requested) return { result: 'pause_supported_reference', warnings, pauseRequestIsNotPauseSuccess: true };
  if (!i.confirmationEvidence.length) return { result: 'pause_requested', warnings, pauseRequestIsNotPauseSuccess: true };
  return { result: 'pause_confirmed_reference', warnings, pauseRequestIsNotPauseSuccess: true };
}

/* ── 8) Cancellation Governance(Cancel Request ≠ Cancel Success) ─────── */
export function evaluateCancellationReadiness(i: { connectorSupportsCancellation: boolean | null; requested: boolean; confirmationEvidence: string[]; partialExecutionPossible: boolean; cleanupRequired: boolean }): { result: 'cancellation_supported_reference' | 'cancellation_request_only' | 'cancellation_unavailable' | 'cancellation_requested' | 'cancellation_confirmed_reference' | 'cancellation_unverified' | 'insufficient_data'; warnings: string[]; cancelRequestIsNotCancelSuccess: true } {
  const warnings: string[] = [];
  if (i.partialExecutionPossible) warnings.push('partial_execution_risk');
  if (i.cleanupRequired) warnings.push('cleanup_required');
  if (i.connectorSupportsCancellation == null) return { result: 'insufficient_data', warnings, cancelRequestIsNotCancelSuccess: true };
  if (!i.connectorSupportsCancellation) return { result: i.requested ? 'cancellation_unverified' : 'cancellation_unavailable', warnings, cancelRequestIsNotCancelSuccess: true };
  if (!i.requested) return { result: 'cancellation_supported_reference', warnings, cancelRequestIsNotCancelSuccess: true };
  if (!i.confirmationEvidence.length) return { result: 'cancellation_requested', warnings, cancelRequestIsNotCancelSuccess: true };
  return { result: 'cancellation_confirmed_reference', warnings, cancelRequestIsNotCancelSuccess: true };
}

/* ── 9) Timeout Governance(Timeout ≠ 실패 확정) ──────────────────────── */
export function evaluateTimeoutResult(i: { timeoutSeconds: number | null; timedOut: boolean; externalActionMayContinue: boolean; partialExecutionPossible: boolean }): { results: string[]; timeoutIsNotFailureConfirmation: true } {
  const results: string[] = [];
  results.push(i.timeoutSeconds != null && isFiniteNumber(i.timeoutSeconds) ? 'timeout_policy_defined' : 'insufficient_data');
  if (i.timedOut) {
    results.push('timeout_reference');
    if (i.externalActionMayContinue) { results.push('external_action_may_continue'); results.push('result_recheck_required'); }
    if (i.partialExecutionPossible) { results.push('partial_execution_risk'); results.push('cleanup_required'); }
  }
  return { results, timeoutIsNotFailureConfirmation: true };
}

/* ── 10) Connector Response Evidence(HTTP 2xx ≠ Business Success) ────── */
export function evaluateConnectorResponse(i: { responseReceived: boolean; httpStatus: number | null; providerAcknowledged: boolean | null; evidence: string[]; sideEffectChecked: boolean | null; duplicateChecked: boolean | null }): { result: 'response_received_reference' | 'response_partial' | 'response_only' | 'provider_acknowledged_reference' | 'action_unverified' | 'side_effect_unverified' | 'duplicate_check_unverified'; http2xxIsNotBusinessSuccess: true; responseIsNotTrustedEvidence: true } {
  if (!i.responseReceived) return { result: 'action_unverified', http2xxIsNotBusinessSuccess: true, responseIsNotTrustedEvidence: true };
  if (!i.evidence.length) return { result: 'response_only', http2xxIsNotBusinessSuccess: true, responseIsNotTrustedEvidence: true };
  if (i.httpStatus == null || !isFiniteNumber(i.httpStatus)) return { result: 'response_partial', http2xxIsNotBusinessSuccess: true, responseIsNotTrustedEvidence: true };
  if (i.sideEffectChecked == null || !i.sideEffectChecked) return { result: 'side_effect_unverified', http2xxIsNotBusinessSuccess: true, responseIsNotTrustedEvidence: true };
  if (i.duplicateChecked == null || !i.duplicateChecked) return { result: 'duplicate_check_unverified', http2xxIsNotBusinessSuccess: true, responseIsNotTrustedEvidence: true };
  if (i.providerAcknowledged === true) return { result: 'provider_acknowledged_reference', http2xxIsNotBusinessSuccess: true, responseIsNotTrustedEvidence: true };
  return { result: 'response_received_reference', http2xxIsNotBusinessSuccess: true, responseIsNotTrustedEvidence: true };
}

/* ── 11) Idempotency Governance(미검증 Write 시작 불가) ──────────────── */
export function evaluateIdempotencySafety(i: { connectorSupportsIdempotency: boolean | null; idempotencyKeyPresent: boolean; duplicateRequestDetected: boolean; duplicateActionDetected: boolean; isWriteAction: boolean }): { result: 'idempotency_verified_reference' | 'idempotency_partially_supported' | 'idempotency_unverified' | 'duplicate_request_candidate' | 'duplicate_action_candidate' | 'duplicate_side_effect_risk' | 'execution_blocked' | 'insufficient_data'; writeBlocked: boolean } {
  if (i.duplicateActionDetected) return { result: 'duplicate_side_effect_risk', writeBlocked: true };
  if (i.duplicateRequestDetected) return { result: 'duplicate_request_candidate', writeBlocked: i.isWriteAction };
  if (i.connectorSupportsIdempotency == null) return { result: 'insufficient_data', writeBlocked: i.isWriteAction };
  if (!i.idempotencyKeyPresent || !i.connectorSupportsIdempotency) {
    // Idempotency 미검증 Write Action 은 시작 불가.
    return i.isWriteAction ? { result: 'execution_blocked', writeBlocked: true } : { result: 'idempotency_unverified', writeBlocked: false };
  }
  return { result: 'idempotency_verified_reference', writeBlocked: false };
}

/* ── 12) Retry Governance(자동 Retry 없음·Retry ≠ Recovery) ──────────── */
export function evaluateRuntimeRetrySafety(i: { errorOccurred: boolean; retryableError: boolean | null; idempotencyVerified: boolean; previousActionMaySucceed: boolean; retryCount: number | null; retryLimit: number }): { result: 'retry_not_required' | 'retry_safe_reference' | 'manual_retry_required' | 'result_recheck_required' | 'retry_blocked' | 'idempotency_unverified' | 'duplicate_side_effect_risk' | 'retry_limit_reached' | 'insufficient_data'; autoRetry: false; retryIsNotRecovery: true } {
  if (!i.errorOccurred) return { result: 'retry_not_required', autoRetry: false, retryIsNotRecovery: true };
  if (i.retryableError == null) return { result: 'insufficient_data', autoRetry: false, retryIsNotRecovery: true };
  if (!i.retryableError) return { result: 'retry_blocked', autoRetry: false, retryIsNotRecovery: true };
  if (i.previousActionMaySucceed) return { result: 'result_recheck_required', autoRetry: false, retryIsNotRecovery: true };
  if (i.retryCount != null && isFiniteNumber(i.retryCount) && i.retryCount >= i.retryLimit) return { result: 'retry_limit_reached', autoRetry: false, retryIsNotRecovery: true };
  if (!i.idempotencyVerified) return { result: 'idempotency_unverified', autoRetry: false, retryIsNotRecovery: true };
  // 안전 조건 충족해도 자동 재시도 없음 — 사람 승인 필요.
  return { result: 'manual_retry_required', autoRetry: false, retryIsNotRecovery: true };
}

/* ── 13) Cleanup Readiness(자동 Cleanup 없음) ────────────────────────── */
export function evaluateCleanupReadiness(i: { residueExists: boolean | null; permissionVerified: boolean; procedureDefined: boolean; evidence: string[] }): { result: 'cleanup_not_required' | 'cleanup_ready_reference' | 'cleanup_pending' | 'cleanup_unverified' | 'cleanup_permission_missing' | 'orphan_resource_candidate' | 'insufficient_data'; autoCleanup: false; cleanupPlanIsNotCleanupSuccess: true } {
  if (i.residueExists == null) return { result: 'insufficient_data', autoCleanup: false, cleanupPlanIsNotCleanupSuccess: true };
  if (!i.residueExists) return { result: 'cleanup_not_required', autoCleanup: false, cleanupPlanIsNotCleanupSuccess: true };
  if (!i.permissionVerified) return { result: 'cleanup_permission_missing', autoCleanup: false, cleanupPlanIsNotCleanupSuccess: true };
  if (!i.procedureDefined) return { result: 'orphan_resource_candidate', autoCleanup: false, cleanupPlanIsNotCleanupSuccess: true };
  if (!i.evidence.length) return { result: 'cleanup_pending', autoCleanup: false, cleanupPlanIsNotCleanupSuccess: true };
  return { result: 'cleanup_ready_reference', autoCleanup: false, cleanupPlanIsNotCleanupSuccess: true };
}

/* ── 14) Runtime Observation(Observation ≠ Causality) ────────────────── */
export function evaluateRuntimeObservation(i: { started: boolean; completed: boolean; unexpectedEffects: number | null; evidence: string[] }): { result: 'runtime_observation_ready_reference' | 'runtime_observation_in_progress_reference' | 'runtime_observation_completed_reference' | 'runtime_observation_pending' | 'unexpected_runtime_effect_candidate' | 'result_unverified'; observationIsNotCausality: true; completionIsNotOutcome: true } {
  if (!i.started) return { result: 'runtime_observation_pending', observationIsNotCausality: true, completionIsNotOutcome: true };
  if (i.unexpectedEffects != null && isFiniteNumber(i.unexpectedEffects) && i.unexpectedEffects > 0) return { result: 'unexpected_runtime_effect_candidate', observationIsNotCausality: true, completionIsNotOutcome: true };
  if (!i.completed) return { result: 'runtime_observation_in_progress_reference', observationIsNotCausality: true, completionIsNotOutcome: true };
  if (!i.evidence.length) return { result: 'result_unverified', observationIsNotCausality: true, completionIsNotOutcome: true };
  return { result: 'runtime_observation_completed_reference', observationIsNotCausality: true, completionIsNotOutcome: true };
}

/* ── 15) Runtime Closure(Closure ≠ Business Success) ─────────────────── */
export function evaluateRuntimeClosure(i: { resultVerified: boolean; observationReviewed: boolean; cleanupResolved: boolean; rollbackReviewRequired: boolean; limitations: string[] }): { result: 'closure_pending' | 'observation_pending' | 'cleanup_pending' | 'rollback_review_required' | 'closed_reference' | 'closed_with_limitation' | 'result_unverified'; closureIsNotBusinessSuccess: true; humanClosureRequired: true } {
  if (i.rollbackReviewRequired) return { result: 'rollback_review_required', closureIsNotBusinessSuccess: true, humanClosureRequired: true };
  if (!i.resultVerified) return { result: 'result_unverified', closureIsNotBusinessSuccess: true, humanClosureRequired: true };
  if (!i.observationReviewed) return { result: 'observation_pending', closureIsNotBusinessSuccess: true, humanClosureRequired: true };
  if (!i.cleanupResolved) return { result: 'cleanup_pending', closureIsNotBusinessSuccess: true, humanClosureRequired: true };
  return { result: i.limitations.length ? 'closed_with_limitation' : 'closed_reference', closureIsNotBusinessSuccess: true, humanClosureRequired: true };
}

/* ── 16) Runtime Recommendation(21종 whitelist·Evidence 필수) ────────── */
export function buildRuntimeRecommendation(i: { type: string; reason: string; evidence: string[]; confidence: number | null; alternatives?: string[]; limitations?: string[] }):
  | { rejected: true; rejectReason: string }
  | { type: string; reason: string; evidence: string[]; confidence: number | null; alternatives: string[]; limitations: string[]; humanApprovalRequired: true; autoExecuted: false } {
  if (!(RUNTIME_RECOMMENDATION_TYPES as readonly string[]).includes(i.type)) return { rejected: true, rejectReason: `허용되지 않는 recommendation type: ${i.type}` };
  if (!i.evidence.length) return { rejected: true, rejectReason: 'Evidence 없는 권고 금지(runtime_unverified)' };
  if (!i.reason.trim()) return { rejected: true, rejectReason: 'Reason 필수' };
  return {
    type: i.type, reason: i.reason, evidence: i.evidence.slice(0, 10),
    confidence: i.confidence != null && isFiniteNumber(i.confidence) ? clampScore(i.confidence) : null,
    alternatives: (i.alternatives ?? []).slice(0, 5),
    limitations: [...(i.limitations ?? []), 'Approval ≠ Runtime Start', 'Runtime Start ≠ Action Completion', 'Confidence ≠ Correctness'].slice(0, 10),
    humanApprovalRequired: true, autoExecuted: false,
  };
}

/* ── 17) Runtime Timeline(9단계 실측 집계) ───────────────────────────── */
export function buildRuntimeTimeline(counts: { stage: string; count: number | null; source: string }[] | null): { stages: { stage: string; count: number | null; source: string; status: 'measured' | 'insufficient_data' }[]; invalidStages: number; timelineIsNotCompletionClaim: true } {
  const valid = (counts ?? []).filter((c) => (RUNTIME_TIMELINE_STAGES as readonly string[]).includes(c.stage));
  const byStage = new Map(valid.map((c) => [c.stage, c]));
  return {
    stages: RUNTIME_TIMELINE_STAGES.map((stage) => {
      const c = byStage.get(stage);
      const count = c && c.count != null && isFiniteNumber(c.count) ? c.count : null;
      return { stage, count, source: c?.source ?? '원본 없음', status: count != null ? ('measured' as const) : ('insufficient_data' as const) };
    }),
    invalidStages: (counts ?? []).length - valid.length,
    timelineIsNotCompletionClaim: true,
  };
}

/* ── 실측 Runtime 구성요소(코드/Migration 기준 — 빌드 시점) ──────────── */
export const RUNTIME_COMPONENTS: { key: string; available: boolean | null; note: string }[] = [
  { key: 'pg_cron', available: true, note: '0337/0338/0340 cron.schedule 실존 — 본 게이트에서 사용하지 않음' },
  { key: 'cron_worker', available: true, note: 'process-scheduled-releases(x-cron-secret) 실존 — 별개 용도' },
  { key: 'inbound_webhook_consumer', available: true, note: 'payapp-feedback + payapp_webhook_events.event_key UNIQUE 멱등성 실존' },
  { key: 'advisory_locks', available: true, note: '0058/0060/0064 실존' },
  { key: 'idempotency_storage', available: true, note: '05xx 다수 테이블 idempotency_key 실존' },
  { key: 'generic_worker_queue', available: false, note: '범용 Worker/Queue 없음' },
  { key: 'dead_letter_queue', available: false, note: 'DLQ 없음' },
  { key: 'heartbeat_lease', available: false, note: 'Heartbeat/Lease 없음' },
  { key: 'cancellation_token', available: false, note: 'Cancellation Token 없음 — Cancel 은 Request/Reference 기록만' },
  { key: 'durable_execution', available: false, note: 'Durable Execution 없음 — 무인 장기 실행 금지' },
  { key: 'sandbox_environment', available: null, note: '실제 Sandbox 환경 미확인(unknown 유지)' },
];

/* ── Support Matrix(38항목) ──────────────────────────────────────────── */
export const RUNTIME_CONTROL_SUPPORT: { key: string; status: string; note: string }[] = [
  { key: 'connector_definition_registry', status: 'fully_supported', note: '사람 기록 — Definition ≠ Availability ≠ Permission' },
  { key: 'connector_instance_registry', status: 'fully_supported', note: 'Credential Reference 만 — 원문 저장/반환 차단' },
  { key: 'connector_availability', status: 'evidence_only', note: '연결/자격증명 unverified 시작 — 자동 검증 없음' },
  { key: 'connector_permission', status: 'evidence_only', note: '사람 검토 Reference — Permission ≠ Approval' },
  { key: 'connector_scope', status: 'evidence_only', note: 'Cross-Enterprise/Brand/Store·Production 차단' },
  { key: 'connector_health', status: 'evidence_only', note: 'health_unverified 시작 — 자동 Polling 없음' },
  { key: 'automation_definition', status: 'fully_supported', note: '정의 ≠ 실행 요청 ≠ 승인 — draft 시작' },
  { key: 'automation_review', status: 'fully_supported', note: 'approved_reference ≠ 실행 허용(별도 승인+게이트 필요)' },
  { key: 'runtime_preconditions', status: 'fully_supported', note: 'Supervisor/Timeout/Cancel/Cleanup/Evidence/Observation 정책 없이 ready 불가(서버 강제)' },
  { key: 'runtime_session', status: 'supervised_only', note: '0535 gate ready + 0534 승인 실존 없이 생성 불가' },
  { key: 'runtime_checkpoint', status: 'fully_supported', note: '완전한 상태 검증 아님 — stale 감지 포함' },
  { key: 'pause_governance', status: 'external_reference_only', note: 'Pause Request ≠ Paused — 확정은 Evidence 필수' },
  { key: 'cancellation_governance', status: 'external_reference_only', note: 'Cancel Request ≠ Cancelled — 확정은 Evidence 필수' },
  { key: 'timeout_governance', status: 'partially_supported', note: 'Timeout ≠ 실패 확정 — 외부 Action 계속 가능 명시' },
  { key: 'connector_action_attempt', status: 'external_reference_only', note: 'started 이후에만 기록 — Attempt ≠ Success' },
  { key: 'connector_response_evidence', status: 'evidence_only', note: 'HTTP 2xx ≠ Business Success · Response ≠ Trusted Evidence' },
  { key: 'result_verification', status: 'evidence_only', note: '자동 검증 없음 — 사람 검토 Reference' },
  { key: 'idempotency_governance', status: 'fully_supported', note: '미검증 Write Action execution_blocked' },
  { key: 'retry_safety', status: 'partially_supported', note: '자동 Retry 없음 — 안전해도 manual_retry_required' },
  { key: 'cleanup_readiness', status: 'evidence_only', note: '자동 Cleanup 없음 — orphan resource 후보 감지' },
  { key: 'runtime_observation', status: 'read_only', note: '0506/0507/0502/0514 연결 — Observation ≠ Causality' },
  { key: 'unexpected_runtime_effect', status: 'partially_supported', note: '후보 감지/기록 — 자동 대응 없음' },
  { key: 'human_runtime_review', status: 'fully_supported', note: 'Connector/Automation/Start/Result/Closure 5계열 전부 사람' },
  { key: 'runtime_recommendation', status: 'fully_supported', note: '21종 whitelist·Evidence 필수 — 자동 실행 없음' },
  { key: 'runtime_audit', status: 'fully_supported', note: '30종 이벤트 — 성공/Outcome 자동 의미 없음' },
  { key: 'automatic_connector_execution', status: 'unsupported', note: 'RPC 내부 실제 Connector 호출 금지' },
  { key: 'automatic_email_send', status: 'unsupported', note: 'Draft Created ≠ Message Sent — 자동 발송 금지' },
  { key: 'automatic_slack_send', status: 'unsupported', note: 'Slack 연동 자체 없음 + 자동 발송 금지' },
  { key: 'automatic_ticket_creation', status: 'unsupported', note: 'Ticket Draft ≠ Ticket Created' },
  { key: 'automatic_issue_creation', status: 'unsupported', note: '자동 Issue/PR 생성 금지' },
  { key: 'automatic_production_execution', status: 'unsupported', note: 'production mode/scope 차단' },
  { key: 'automatic_merge', status: 'unsupported', note: '자동 Merge 금지' },
  { key: 'automatic_deploy', status: 'unsupported', note: '자동 Deploy 금지' },
  { key: 'automatic_migration_apply', status: 'unsupported', note: '자동 Migration Apply 금지' },
  { key: 'automatic_payment', status: 'unsupported', note: 'payment_write 도메인 차단(PayApp 은 webhook_reference 만)' },
  { key: 'automatic_contract_mutation', status: 'unsupported', note: 'contract_write 도메인 차단' },
  { key: 'automatic_user_role_mutation', status: 'unsupported', note: 'identity_write 도메인 차단' },
  { key: 'automatic_data_deletion', status: 'unsupported', note: 'destructive_storage_write 도메인 차단·자동 Cleanup 없음' },
];
