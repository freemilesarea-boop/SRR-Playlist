import { describe, expect, it } from 'vitest';
import {
  AUTOMATION_STATUSES,
  BLOCKED_CONNECTOR_DOMAINS,
  buildRuntimeRecommendation,
  buildRuntimeTimeline,
  CONNECTOR_DOMAINS,
  evaluateCancellationReadiness,
  evaluateCleanupReadiness,
  evaluateConnectorDefinition,
  evaluateConnectorInstance,
  evaluateConnectorResponse,
  evaluateIdempotencySafety,
  evaluatePauseReadiness,
  evaluateRuntimeCheckpoint,
  evaluateRuntimeClosure,
  evaluateRuntimeObservation,
  evaluateRuntimePreconditions,
  evaluateRuntimeRetrySafety,
  evaluateRuntimeStart,
  evaluateTimeoutResult,
  RUNTIME_COMPONENTS,
  RUNTIME_CONTROL_SUPPORT,
  validateAutomationDefinition,
} from './runtimeControl';

describe('connector definition — Definition ≠ Availability ≠ Permission', () => {
  it('금지 Write 도메인/Secret 접근/invalid provider 차단', () => {
    const bad = evaluateConnectorDefinition({ domain: 'payment_write', provider: 'quantum', requiresSecretAccess: true, supportsWrite: true });
    expect(bad.valid).toBe(false);
    expect(bad.rejectReasons.some((r) => r.includes('금지 Write 도메인'))).toBe(true);
    expect(bad.rejectReasons).toContain('Secret 접근 요구 Connector 차단');
    expect(bad.rejectReasons).toContain('허용되지 않는 provider');
    const ok = evaluateConnectorDefinition({ domain: 'email', provider: 'resend', requiresSecretAccess: false, supportsWrite: false });
    expect(ok.valid).toBe(true);
    expect(ok.definitionIsNotAvailability).toBe(true);
    expect(ok.definitionIsNotPermission).toBe(true);
    expect(CONNECTOR_DOMAINS).toHaveLength(15);
    expect(BLOCKED_CONNECTOR_DOMAINS).toHaveLength(11);
  });
});

describe('connector instance — unverified 시작·production 차단', () => {
  it('status_unknown/unavailable/credential/permission/scope 단계별 판정', () => {
    expect(evaluateConnectorInstance({ connectionStatus: null, permissionStatus: null, scopeStatus: null, credentialReferenced: null, environmentScope: 'non_production' }).verdict).toBe('connector_status_unknown');
    expect(evaluateConnectorInstance({ connectionStatus: 'disabled', permissionStatus: null, scopeStatus: null, credentialReferenced: true, environmentScope: 'non_production' }).verdict).toBe('connector_unavailable');
    expect(evaluateConnectorInstance({ connectionStatus: 'available_reference', permissionStatus: 'permission_verified_reference', scopeStatus: 'scope_verified_reference', credentialReferenced: null, environmentScope: 'non_production' }).verdict).toBe('credential_unverified');
    expect(evaluateConnectorInstance({ connectionStatus: 'available_reference', permissionStatus: 'connector_permission_unverified', scopeStatus: 'scope_verified_reference', credentialReferenced: true, environmentScope: 'non_production' }).verdict).toBe('connector_permission_unverified');
    expect(evaluateConnectorInstance({ connectionStatus: 'available_reference', permissionStatus: 'permission_verified_reference', scopeStatus: 'connector_scope_unverified', credentialReferenced: true, environmentScope: 'non_production' }).verdict).toBe('connector_scope_unverified');
    expect(evaluateConnectorInstance({ connectionStatus: 'available_reference', permissionStatus: 'permission_verified_reference', scopeStatus: 'scope_verified_reference', credentialReferenced: true, environmentScope: 'production' }).verdict).toBe('production_blocked');
    const ok = evaluateConnectorInstance({ connectionStatus: 'available_reference', permissionStatus: 'permission_verified_reference', scopeStatus: 'scope_verified_reference', credentialReferenced: true, environmentScope: 'non_production' });
    expect(ok.verdict).toBe('available_reference');
    expect(ok.availabilityIsNotPermission).toBe(true);
    expect(ok.permissionIsNotApproval).toBe(true);
  });
});

describe('automation definition — 정의 ≠ 실행 요청 ≠ 승인', () => {
  it('금지 domain/production mode 거부 + 정직 플래그', () => {
    expect(validateAutomationDefinition({ domain: 'payment', mode: 'draft_only', status: 'draft' }).valid).toBe(false);
    expect(validateAutomationDefinition({ domain: 'email_draft', mode: 'production', status: 'draft' }).valid).toBe(false);
    const ok = validateAutomationDefinition({ domain: 'email_draft', mode: 'draft_only', status: 'approved_reference' });
    expect(ok.valid).toBe(true);
    expect(ok.definitionIsNotExecutionRequest).toBe(true);
    expect(ok.approvedIsNotRuntimeApproval).toBe(true);
    expect(AUTOMATION_STATUSES).toContain('supervised_only');
  });
});

describe('runtime preconditions — 결측 즉시 차단', () => {
  it('approval/gate/supervisor/정책 결측 blockers + 전부 충족 시 ready', () => {
    const base = { approvalLinked: true, gateReady: true, automationActive: true, connectorAvailable: true, permissionVerified: true, scopeVerified: true, environmentAllowed: true, dryRunSatisfied: true, sandboxSatisfied: true, idempotencyKeyPresent: true, timeoutDefined: true, cancellationPolicyDefined: true, cleanupPolicyDefined: true, evidenceRequirementsDefined: true, observationPlanDefined: true, supervisorAssigned: true };
    expect(evaluateRuntimePreconditions(base).result).toBe('runtime_ready_reference');
    expect(evaluateRuntimePreconditions({ ...base, approvalLinked: false }).result).toBe('approval_missing');
    expect(evaluateRuntimePreconditions({ ...base, gateReady: false }).result).toBe('gate_missing');
    expect(evaluateRuntimePreconditions({ ...base, supervisorAssigned: false }).result).toBe('supervisor_missing');
    const multi = evaluateRuntimePreconditions({ ...base, timeoutDefined: false, cleanupPolicyDefined: false, observationPlanDefined: false });
    expect(multi.blockers).toEqual(['timeout_policy_missing', 'cleanup_policy_missing', 'observation_plan_missing']);
    expect(multi.readyIsNotStarted).toBe(true);
  });
});

describe('runtime start — Approval ≠ Start·Start ≠ Action Success', () => {
  it('preconditions/supervisor/evidence 단계별 판정 + 자동 시작 없음', () => {
    expect(evaluateRuntimeStart({ preconditionsReady: false, startRequested: true, startEvidence: ['e'], supervisorAssigned: true }).result).toBe('precondition_missing');
    expect(evaluateRuntimeStart({ preconditionsReady: true, startRequested: true, startEvidence: ['e'], supervisorAssigned: false }).result).toBe('supervisor_missing');
    expect(evaluateRuntimeStart({ preconditionsReady: true, startRequested: false, startEvidence: [], supervisorAssigned: true }).result).toBe('runtime_start_unverified');
    expect(evaluateRuntimeStart({ preconditionsReady: true, startRequested: true, startEvidence: [], supervisorAssigned: true }).result).toBe('start_requested_reference');
    const started = evaluateRuntimeStart({ preconditionsReady: true, startRequested: true, startEvidence: ['시작 로그'], supervisorAssigned: true });
    expect(started.result).toBe('started_reference');
    expect(started.startIsNotActionSuccess).toBe(true);
    expect(started.autoStarted).toBe(false);
  });
});

describe('checkpoint / pause / cancellation — Request ≠ Success', () => {
  it('checkpoint: stale 감지 + null 유지(Date 주입)', () => {
    const now = new Date('2026-07-16T05:00:00Z');
    expect(evaluateRuntimeCheckpoint({ lastCheckpointAt: new Date('2026-07-16T04:59:30Z'), now, maxIntervalSeconds: 60, checkpointCount: 2 }).result).toBe('checkpoint_reference');
    expect(evaluateRuntimeCheckpoint({ lastCheckpointAt: new Date('2026-07-16T04:00:00Z'), now, maxIntervalSeconds: 60, checkpointCount: 2 }).result).toBe('stale_input_candidate');
    expect(evaluateRuntimeCheckpoint({ lastCheckpointAt: null, now, maxIntervalSeconds: 60, checkpointCount: null }).ageSeconds).toBeNull();
  });
  it('pause: unavailable/request_only 아님·requested/confirmed/unverified 구분', () => {
    expect(evaluatePauseReadiness({ connectorSupportsPause: null, requested: false, confirmationEvidence: [], partialExecutionPossible: false }).result).toBe('insufficient_data');
    expect(evaluatePauseReadiness({ connectorSupportsPause: false, requested: false, confirmationEvidence: [], partialExecutionPossible: false }).result).toBe('pause_unavailable');
    expect(evaluatePauseReadiness({ connectorSupportsPause: false, requested: true, confirmationEvidence: [], partialExecutionPossible: true }).result).toBe('pause_unverified');
    expect(evaluatePauseReadiness({ connectorSupportsPause: true, requested: true, confirmationEvidence: [], partialExecutionPossible: false }).result).toBe('pause_requested');
    const c = evaluatePauseReadiness({ connectorSupportsPause: true, requested: true, confirmationEvidence: ['확정 로그'], partialExecutionPossible: true });
    expect(c.result).toBe('pause_confirmed_reference');
    expect(c.warnings).toContain('partial_execution_risk');
    expect(c.pauseRequestIsNotPauseSuccess).toBe(true);
  });
  it('cancellation: cleanup_required 경고 + Request ≠ Success', () => {
    expect(evaluateCancellationReadiness({ connectorSupportsCancellation: false, requested: true, confirmationEvidence: [], partialExecutionPossible: false, cleanupRequired: false }).result).toBe('cancellation_unverified');
    const r = evaluateCancellationReadiness({ connectorSupportsCancellation: true, requested: true, confirmationEvidence: [], partialExecutionPossible: true, cleanupRequired: true });
    expect(r.result).toBe('cancellation_requested');
    expect(r.warnings).toEqual(['partial_execution_risk', 'cleanup_required']);
    expect(r.cancelRequestIsNotCancelSuccess).toBe(true);
  });
});

describe('timeout — Timeout ≠ 실패 확정', () => {
  it('외부 Action 계속 가능 + result_recheck_required', () => {
    const r = evaluateTimeoutResult({ timeoutSeconds: 60, timedOut: true, externalActionMayContinue: true, partialExecutionPossible: true });
    expect(r.results).toContain('timeout_policy_defined');
    expect(r.results).toContain('timeout_reference');
    expect(r.results).toContain('external_action_may_continue');
    expect(r.results).toContain('result_recheck_required');
    expect(r.results).toContain('cleanup_required');
    expect(r.timeoutIsNotFailureConfirmation).toBe(true);
    expect(evaluateTimeoutResult({ timeoutSeconds: null, timedOut: false, externalActionMayContinue: false, partialExecutionPossible: false }).results).toContain('insufficient_data');
  });
});

describe('connector response — HTTP 2xx ≠ Business Success', () => {
  it('action_unverified/response_only/partial/side_effect/duplicate/ack 구분', () => {
    expect(evaluateConnectorResponse({ responseReceived: false, httpStatus: null, providerAcknowledged: null, evidence: [], sideEffectChecked: null, duplicateChecked: null }).result).toBe('action_unverified');
    expect(evaluateConnectorResponse({ responseReceived: true, httpStatus: 200, providerAcknowledged: null, evidence: [], sideEffectChecked: null, duplicateChecked: null }).result).toBe('response_only');
    expect(evaluateConnectorResponse({ responseReceived: true, httpStatus: null, providerAcknowledged: null, evidence: ['e'], sideEffectChecked: null, duplicateChecked: null }).result).toBe('response_partial');
    expect(evaluateConnectorResponse({ responseReceived: true, httpStatus: 200, providerAcknowledged: null, evidence: ['e'], sideEffectChecked: false, duplicateChecked: null }).result).toBe('side_effect_unverified');
    expect(evaluateConnectorResponse({ responseReceived: true, httpStatus: 200, providerAcknowledged: null, evidence: ['e'], sideEffectChecked: true, duplicateChecked: false }).result).toBe('duplicate_check_unverified');
    const ack = evaluateConnectorResponse({ responseReceived: true, httpStatus: 200, providerAcknowledged: true, evidence: ['e'], sideEffectChecked: true, duplicateChecked: true });
    expect(ack.result).toBe('provider_acknowledged_reference');
    expect(ack.http2xxIsNotBusinessSuccess).toBe(true);
    expect(ack.responseIsNotTrustedEvidence).toBe(true);
  });
});

describe('idempotency — 미검증 Write 시작 불가', () => {
  it('duplicate/execution_blocked/verified 구분', () => {
    expect(evaluateIdempotencySafety({ connectorSupportsIdempotency: true, idempotencyKeyPresent: true, duplicateRequestDetected: false, duplicateActionDetected: true, isWriteAction: true }).result).toBe('duplicate_side_effect_risk');
    expect(evaluateIdempotencySafety({ connectorSupportsIdempotency: true, idempotencyKeyPresent: true, duplicateRequestDetected: true, duplicateActionDetected: false, isWriteAction: false }).result).toBe('duplicate_request_candidate');
    const blocked = evaluateIdempotencySafety({ connectorSupportsIdempotency: false, idempotencyKeyPresent: false, duplicateRequestDetected: false, duplicateActionDetected: false, isWriteAction: true });
    expect(blocked.result).toBe('execution_blocked');
    expect(blocked.writeBlocked).toBe(true);
    expect(evaluateIdempotencySafety({ connectorSupportsIdempotency: false, idempotencyKeyPresent: false, duplicateRequestDetected: false, duplicateActionDetected: false, isWriteAction: false }).result).toBe('idempotency_unverified');
    expect(evaluateIdempotencySafety({ connectorSupportsIdempotency: true, idempotencyKeyPresent: true, duplicateRequestDetected: false, duplicateActionDetected: false, isWriteAction: true }).result).toBe('idempotency_verified_reference');
  });
});

describe('retry — 자동 Retry 없음·Retry ≠ Recovery', () => {
  it('not_required/recheck/blocked/limit/manual 구분', () => {
    expect(evaluateRuntimeRetrySafety({ errorOccurred: false, retryableError: null, idempotencyVerified: true, previousActionMaySucceed: false, retryCount: 0, retryLimit: 3 }).result).toBe('retry_not_required');
    expect(evaluateRuntimeRetrySafety({ errorOccurred: true, retryableError: null, idempotencyVerified: true, previousActionMaySucceed: false, retryCount: 0, retryLimit: 3 }).result).toBe('insufficient_data');
    expect(evaluateRuntimeRetrySafety({ errorOccurred: true, retryableError: true, idempotencyVerified: true, previousActionMaySucceed: true, retryCount: 0, retryLimit: 3 }).result).toBe('result_recheck_required');
    expect(evaluateRuntimeRetrySafety({ errorOccurred: true, retryableError: true, idempotencyVerified: true, previousActionMaySucceed: false, retryCount: 3, retryLimit: 3 }).result).toBe('retry_limit_reached');
    const manual = evaluateRuntimeRetrySafety({ errorOccurred: true, retryableError: true, idempotencyVerified: true, previousActionMaySucceed: false, retryCount: 0, retryLimit: 3 });
    expect(manual.result).toBe('manual_retry_required');
    expect(manual.autoRetry).toBe(false);
    expect(manual.retryIsNotRecovery).toBe(true);
  });
});

describe('cleanup / observation / closure — 자동 없음·Completion ≠ Outcome', () => {
  it('cleanup: orphan/permission/pending/ready + 자동 없음', () => {
    expect(evaluateCleanupReadiness({ residueExists: null, permissionVerified: true, procedureDefined: true, evidence: [] }).result).toBe('insufficient_data');
    expect(evaluateCleanupReadiness({ residueExists: false, permissionVerified: false, procedureDefined: false, evidence: [] }).result).toBe('cleanup_not_required');
    expect(evaluateCleanupReadiness({ residueExists: true, permissionVerified: false, procedureDefined: true, evidence: [] }).result).toBe('cleanup_permission_missing');
    expect(evaluateCleanupReadiness({ residueExists: true, permissionVerified: true, procedureDefined: false, evidence: [] }).result).toBe('orphan_resource_candidate');
    expect(evaluateCleanupReadiness({ residueExists: true, permissionVerified: true, procedureDefined: true, evidence: [] }).result).toBe('cleanup_pending');
    const r = evaluateCleanupReadiness({ residueExists: true, permissionVerified: true, procedureDefined: true, evidence: ['정리 절차'] });
    expect(r.result).toBe('cleanup_ready_reference');
    expect(r.autoCleanup).toBe(false);
    expect(r.cleanupPlanIsNotCleanupSuccess).toBe(true);
  });
  it('observation: pending/in_progress/unexpected/completed + Causality 아님', () => {
    expect(evaluateRuntimeObservation({ started: false, completed: false, unexpectedEffects: null, evidence: [] }).result).toBe('runtime_observation_pending');
    expect(evaluateRuntimeObservation({ started: true, completed: true, unexpectedEffects: 1, evidence: ['e'] }).result).toBe('unexpected_runtime_effect_candidate');
    expect(evaluateRuntimeObservation({ started: true, completed: true, unexpectedEffects: 0, evidence: [] }).result).toBe('result_unverified');
    const r = evaluateRuntimeObservation({ started: true, completed: true, unexpectedEffects: 0, evidence: ['0506 실측'] });
    expect(r.result).toBe('runtime_observation_completed_reference');
    expect(r.observationIsNotCausality).toBe(true);
    expect(r.completionIsNotOutcome).toBe(true);
  });
  it('closure: rollback/result/observation/cleanup 선행 + Business Success 아님', () => {
    expect(evaluateRuntimeClosure({ resultVerified: true, observationReviewed: true, cleanupResolved: true, rollbackReviewRequired: true, limitations: [] }).result).toBe('rollback_review_required');
    expect(evaluateRuntimeClosure({ resultVerified: false, observationReviewed: true, cleanupResolved: true, rollbackReviewRequired: false, limitations: [] }).result).toBe('result_unverified');
    expect(evaluateRuntimeClosure({ resultVerified: true, observationReviewed: false, cleanupResolved: true, rollbackReviewRequired: false, limitations: [] }).result).toBe('observation_pending');
    expect(evaluateRuntimeClosure({ resultVerified: true, observationReviewed: true, cleanupResolved: false, rollbackReviewRequired: false, limitations: [] }).result).toBe('cleanup_pending');
    expect(evaluateRuntimeClosure({ resultVerified: true, observationReviewed: true, cleanupResolved: true, rollbackReviewRequired: false, limitations: ['부분 검증'] }).result).toBe('closed_with_limitation');
    const r = evaluateRuntimeClosure({ resultVerified: true, observationReviewed: true, cleanupResolved: true, rollbackReviewRequired: false, limitations: [] });
    expect(r.result).toBe('closed_reference');
    expect(r.closureIsNotBusinessSuccess).toBe(true);
    expect(r.humanClosureRequired).toBe(true);
  });
});

describe('recommendation / timeline / components / support', () => {
  it('recommendation: whitelist+Evidence 필수 + confidence clamp + 자동 실행 없음', () => {
    expect('rejected' in buildRuntimeRecommendation({ type: 'execute_now', reason: 'x', evidence: ['e'], confidence: null })).toBe(true);
    expect('rejected' in buildRuntimeRecommendation({ type: 'verify_connector_response', reason: 'x', evidence: [], confidence: null })).toBe(true);
    const r = buildRuntimeRecommendation({ type: 'review_runtime_preconditions', reason: 'Supervisor 미지정 — ready 불가', evidence: ['preconditions 실측'], confidence: 300 });
    if ('humanApprovalRequired' in r) {
      expect(r.humanApprovalRequired).toBe(true);
      expect(r.autoExecuted).toBe(false);
      expect(r.confidence).toBe(100);
      expect(r.limitations).toContain('Approval ≠ Runtime Start');
    }
  });
  it('timeline: 9단계 + 원본 없는 단계 insufficient_data', () => {
    const r = buildRuntimeTimeline([
      { stage: 'connector', count: 2, source: 'definitions 실측' },
      { stage: 'session', count: 1, source: 'sessions 실측' },
      { stage: 'warp', count: 5, source: 'x' },
    ]);
    expect(r.stages).toHaveLength(9);
    expect(r.stages.find((s) => s.stage === 'closure')?.status).toBe('insufficient_data');
    expect(r.invalidStages).toBe(1);
    expect(r.timelineIsNotCompletionClaim).toBe(true);
  });
  it('runtime components: pg_cron/webhook/lock 실존 + queue/DLQ/lease 없음 + sandbox unknown', () => {
    expect(RUNTIME_COMPONENTS.find((c) => c.key === 'pg_cron')?.available).toBe(true);
    expect(RUNTIME_COMPONENTS.find((c) => c.key === 'inbound_webhook_consumer')?.available).toBe(true);
    for (const key of ['generic_worker_queue', 'dead_letter_queue', 'heartbeat_lease', 'cancellation_token', 'durable_execution']) {
      expect(RUNTIME_COMPONENTS.find((c) => c.key === key)?.available).toBe(false);
    }
    expect(RUNTIME_COMPONENTS.find((c) => c.key === 'sandbox_environment')?.available).toBeNull();
  });
  it('SUPPORT: 38항목 + 자동 실행 계열 전부 unsupported', () => {
    expect(RUNTIME_CONTROL_SUPPORT).toHaveLength(38);
    for (const key of ['automatic_connector_execution', 'automatic_email_send', 'automatic_slack_send', 'automatic_ticket_creation', 'automatic_issue_creation', 'automatic_production_execution', 'automatic_merge', 'automatic_deploy', 'automatic_migration_apply', 'automatic_payment', 'automatic_contract_mutation', 'automatic_user_role_mutation', 'automatic_data_deletion']) {
      expect(RUNTIME_CONTROL_SUPPORT.find((s) => s.key === key)?.status).toBe('unsupported');
    }
  });
});
