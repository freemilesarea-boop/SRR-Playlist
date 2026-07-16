import { describe, expect, it } from 'vitest';
import {
  BLOCKED_EXECUTION_DOMAINS,
  buildExecutionRecommendation,
  buildExecutionTimeline,
  calculateExecutionRisk,
  CONNECTOR_REGISTRY,
  evaluateCapabilityAvailability,
  evaluateDryRun,
  evaluateExecutionGate,
  evaluateHumanClosure,
  evaluatePostExecutionObservation,
  evaluateResultEvidence,
  evaluateRetrySafety,
  evaluateRollbackReadiness,
  evaluateRuntimeReadiness,
  evaluateSandboxReadiness,
  evaluateTimeoutCancellation,
  EXECUTION_DOMAINS,
  EXECUTION_GATEWAY_SUPPORT,
  validateExecutionRequest,
  validateExecutionScope,
  validatePermissionRequirements,
} from './executionGateway';

describe('execution request — Request ≠ Execution·production 차단', () => {
  it('금지 도메인/production mode/invalid scope 거부 + approval_missing', () => {
    const bad = validateExecutionRequest({ domain: 'payment', mode: 'production', scopeType: 'planet', title: '', approvalReferenceId: null });
    expect(bad.valid).toBe(false);
    expect(bad.rejectReasons.some((r) => r.includes('금지 도메인'))).toBe(true);
    expect(bad.rejectReasons).toContain('production mode 미지원');
    expect(bad.approvalStatus).toBe('approval_missing');
    const ok = validateExecutionRequest({ domain: 'email_draft', mode: 'draft_only', scopeType: 'store', title: '이메일 초안', approvalReferenceId: 'ref-1' });
    expect(ok.valid).toBe(true);
    expect(ok.approvalStatus).toBe('approval_linked_reference');
    expect(ok.requestIsNotExecution).toBe(true);
    expect(ok.autoExecuted).toBe(false);
    expect(EXECUTION_DOMAINS).toHaveLength(12);
    expect(BLOCKED_EXECUTION_DOMAINS).toHaveLength(13);
  });
});

describe('runtime readiness — 런타임 없음 정직 표기', () => {
  it('unknown 유지 + runtime_unavailable', () => {
    const r = evaluateRuntimeReadiness([
      { key: 'edge_functions', available: true, note: '코드 실측' },
      { key: 'worker_queue', available: false, note: '없음' },
      { key: 'sandbox_env', available: null, note: '미확인' },
    ]);
    expect(r.rows[2].status).toBe('unknown');
    expect(r.verdict).toBe('runtime_partial_reference');
    expect(evaluateRuntimeReadiness([{ key: 'q', available: false, note: '' }]).verdict).toBe('runtime_unavailable');
    expect(evaluateRuntimeReadiness([]).verdict).toBe('insufficient_data');
    expect(r.readinessIsNotExecution).toBe(true);
  });
});

describe('permission / scope — Secret·Cross·Production 차단', () => {
  it('secret_scope_detected + 미검증 unknown 유지', () => {
    expect(validatePermissionRequirements({ adminVerified: true, scopeOwned: true, secondaryApprovalRequired: false, sensitiveData: false, secretAccess: true }).result).toBe('secret_scope_detected');
    expect(validatePermissionRequirements({ adminVerified: null, scopeOwned: null, secondaryApprovalRequired: false, sensitiveData: false, secretAccess: false }).result).toBe('permission_unverified');
    expect(validatePermissionRequirements({ adminVerified: true, scopeOwned: true, secondaryApprovalRequired: true, sensitiveData: false, secretAccess: false }).result).toBe('secondary_approval_required');
    expect(validatePermissionRequirements({ adminVerified: true, scopeOwned: true, secondaryApprovalRequired: false, sensitiveData: false, secretAccess: false }).result).toBe('permission_verified_reference');
  });
  it('scope: production 차단 + cross-enterprise/brand/store 차단 + 승인 scope 불일치', () => {
    expect(validateExecutionScope({ requestScope: { type: 'store', id: 's1' }, approvalScope: { type: 'store', id: 's1' }, isProductionTarget: true }).result).toBe('production_scope_blocked');
    expect(validateExecutionScope({ requestScope: { type: 'enterprise', id: 'e1' }, approvalScope: { type: 'enterprise', id: 'e2' }, isProductionTarget: false }).result).toBe('cross_enterprise_blocked');
    expect(validateExecutionScope({ requestScope: { type: 'brand', id: 'b1' }, approvalScope: { type: 'brand', id: 'b2' }, isProductionTarget: false }).result).toBe('cross_brand_blocked');
    expect(validateExecutionScope({ requestScope: { type: 'store', id: 's1' }, approvalScope: { type: 'enterprise', id: 'e1' }, isProductionTarget: false }).result).toBe('scope_mismatch');
    expect(validateExecutionScope({ requestScope: { type: 'store', id: 's1' }, approvalScope: null, isProductionTarget: false }).result).toBe('scope_unverified');
    expect(validateExecutionScope({ requestScope: { type: 'store', id: 's1' }, approvalScope: { type: 'store', id: 's1' }, isProductionTarget: false }).result).toBe('scope_verified_reference');
  });
});

describe('execution risk — Critical 은 Controlled 대상 아님', () => {
  it('read-only negligible → production/비가역 critical + 미확인 risk_unverified', () => {
    expect(calculateExecutionRisk({ isWrite: false, externalSideEffect: false, financialImpact: false, productionProximity: false, irreversible: false, sensitiveData: false }).level).toBe('negligible');
    expect(calculateExecutionRisk({ isWrite: true, externalSideEffect: true, financialImpact: false, productionProximity: false, irreversible: false, sensitiveData: false }).level).toBe('moderate');
    expect(calculateExecutionRisk({ isWrite: true, externalSideEffect: true, financialImpact: true, productionProximity: false, irreversible: false, sensitiveData: false }).level).toBe('high');
    const crit = calculateExecutionRisk({ isWrite: true, externalSideEffect: true, financialImpact: false, productionProximity: true, irreversible: false, sensitiveData: false });
    expect(crit.level).toBe('critical');
    expect(crit.controlledExecutionAllowed).toBe(false);
    expect(calculateExecutionRisk({ isWrite: null, externalSideEffect: null, financialImpact: false, productionProximity: false, irreversible: false, sensitiveData: false }).level).toBe('risk_unverified');
  });
});

describe('dry run — 미수행 passed 금지', () => {
  it('performed=false → dry_run_unverified + Evidence 없는 passed → unverified', () => {
    expect(evaluateDryRun({ performed: false, status: 'passed_reference', evidence: ['e'] }).status).toBe('dry_run_unverified');
    expect(evaluateDryRun({ performed: true, status: 'passed_reference', evidence: [] }).status).toBe('dry_run_unverified');
    expect(evaluateDryRun({ performed: true, status: 'passed_reference', evidence: ['로그'] }).status).toBe('passed_reference');
    expect(evaluateDryRun({ performed: true, status: 'blocked_reference', evidence: [] }).status).toBe('blocked_reference');
    expect(evaluateDryRun({ performed: true, status: null, evidence: [] }).status).toBe('insufficient_data');
    expect(evaluateDryRun({ performed: true, status: 'passed_reference', evidence: ['e'] }).dryRunIsNotRealExecution).toBe(true);
  });
});

describe('sandbox / capability', () => {
  it('sandbox: 환경 없음/격리·자격증명·cleanup 미검증 구분', () => {
    expect(evaluateSandboxReadiness({ environmentExists: null, isolationVerified: null, credentialIsolated: null, cleanupDefined: null }).result).toBe('insufficient_data');
    expect(evaluateSandboxReadiness({ environmentExists: false, isolationVerified: null, credentialIsolated: null, cleanupDefined: null }).result).toBe('sandbox_unavailable');
    expect(evaluateSandboxReadiness({ environmentExists: true, isolationVerified: false, credentialIsolated: null, cleanupDefined: null }).result).toBe('isolation_unverified');
    expect(evaluateSandboxReadiness({ environmentExists: true, isolationVerified: true, credentialIsolated: false, cleanupDefined: null }).result).toBe('credential_unverified');
    expect(evaluateSandboxReadiness({ environmentExists: true, isolationVerified: true, credentialIsolated: true, cleanupDefined: true }).result).toBe('sandbox_ready_reference');
  });
  it('capability: status whitelist + Connector 실존과 별개', () => {
    const r = evaluateCapabilityAvailability([
      { code: 'email_draft', status: 'available_reference', connectorType: 'email_dispatch' },
      { code: 'x', status: 'super_powered', connectorType: 'none' },
      { code: 'pay', status: 'disabled', connectorType: 'payment_payapp' },
    ]);
    expect(r.rows).toHaveLength(2);
    expect(r.invalidCapabilities).toBe(1);
    expect(r.executable).toBe(1);
    expect(r.capabilityIsNotConnector).toBe(true);
  });
});

describe('execution gate — 13조건 차단', () => {
  it('approval/permission/scope/dryrun/risk/observation/rollback blockers', () => {
    const blocked = evaluateExecutionGate({ approvalLinked: false, permissionVerified: false, scopeVerified: false, riskLevel: 'critical', dryRunRequired: true, dryRunPassed: false, sandboxRequired: true, sandboxReady: false, observationPlanDefined: false, rollbackRequired: true, rollbackReady: false });
    expect(blocked.result).toBe('gate_blocked');
    for (const b of ['approval_missing', 'permission_unverified', 'scope_unverified', 'risk_too_high', 'dry_run_missing', 'sandbox_unavailable', 'observation_plan_missing', 'rollback_unverified']) {
      expect(blocked.blockers).toContain(b);
    }
    const ready = evaluateExecutionGate({ approvalLinked: true, permissionVerified: true, scopeVerified: true, riskLevel: 'low', dryRunRequired: true, dryRunPassed: true, sandboxRequired: false, sandboxReady: false, observationPlanDefined: true, rollbackRequired: true, rollbackReady: true });
    expect(ready.result).toBe('gate_ready_reference');
    expect(ready.gateReadyIsNotExecuted).toBe(true);
    expect(ready.autoExecuted).toBe(false);
  });
});

describe('result evidence — HTTP Success ≠ Business Success', () => {
  it('response_only/partial/side_effect_unverified/verified 구분', () => {
    expect(evaluateResultEvidence({ externalResponse: false, evidence: [], verificationMethod: null, sideEffectChecked: null }).result).toBe('result_unverified');
    expect(evaluateResultEvidence({ externalResponse: true, evidence: [], verificationMethod: null, sideEffectChecked: null }).result).toBe('response_only');
    expect(evaluateResultEvidence({ externalResponse: true, evidence: ['e'], verificationMethod: null, sideEffectChecked: null }).result).toBe('evidence_partial');
    expect(evaluateResultEvidence({ externalResponse: true, evidence: ['e'], verificationMethod: 'manual', sideEffectChecked: false }).result).toBe('side_effect_unverified');
    const v = evaluateResultEvidence({ externalResponse: true, evidence: ['e'], verificationMethod: 'manual', sideEffectChecked: true });
    expect(v.result).toBe('evidence_verified_reference');
    expect(v.httpSuccessIsNotBusinessSuccess).toBe(true);
  });
});

describe('retry / timeout / rollback — 자동 실행 없음', () => {
  it('retry: 안전해도 manual_retry_required(자동 재시도 없음) + limit/duplicate/idempotency', () => {
    expect(evaluateRetrySafety({ retryableError: null, idempotencySupported: true, duplicateSideEffectRisk: false, retryCount: 0, retryLimit: 3 }).result).toBe('insufficient_data');
    expect(evaluateRetrySafety({ retryableError: false, idempotencySupported: true, duplicateSideEffectRisk: false, retryCount: 0, retryLimit: 3 }).result).toBe('retry_blocked');
    expect(evaluateRetrySafety({ retryableError: true, idempotencySupported: true, duplicateSideEffectRisk: false, retryCount: 3, retryLimit: 3 }).result).toBe('retry_limit_reached');
    expect(evaluateRetrySafety({ retryableError: true, idempotencySupported: true, duplicateSideEffectRisk: true, retryCount: 0, retryLimit: 3 }).result).toBe('duplicate_side_effect_risk');
    expect(evaluateRetrySafety({ retryableError: true, idempotencySupported: false, duplicateSideEffectRisk: false, retryCount: 0, retryLimit: 3 }).result).toBe('idempotency_unverified');
    const safe = evaluateRetrySafety({ retryableError: true, idempotencySupported: true, duplicateSideEffectRisk: false, retryCount: 0, retryLimit: 3 });
    expect(safe.result).toBe('manual_retry_required');
    expect(safe.autoRetry).toBe(false);
  });
  it('timeout clamp 1~600 + cancellation/cleanup', () => {
    const r = evaluateTimeoutCancellation({ timeoutSeconds: 9999, cancellationSupported: false, partialExecutionPossible: true, cleanupRequired: true });
    expect(r.timeoutSeconds).toBe(600);
    expect(r.results).toContain('timeout_policy_defined');
    expect(r.results).toContain('cancellation_unavailable');
    expect(r.results).toContain('partial_execution_risk');
    expect(r.results).toContain('cleanup_required');
    expect(evaluateTimeoutCancellation({ timeoutSeconds: null, cancellationSupported: null, partialExecutionPossible: false, cleanupRequired: false }).timeoutSeconds).toBeNull();
  });
  it('rollback: irreversible/unavailable/unverified/partial/ready + 자동 없음', () => {
    expect(evaluateRollbackReadiness({ reversible: null, procedureDefined: true, permissionVerified: true, tested: true }).result).toBe('insufficient_data');
    expect(evaluateRollbackReadiness({ reversible: false, procedureDefined: true, permissionVerified: true, tested: true }).result).toBe('irreversible_action');
    expect(evaluateRollbackReadiness({ reversible: true, procedureDefined: false, permissionVerified: true, tested: true }).result).toBe('rollback_unavailable');
    expect(evaluateRollbackReadiness({ reversible: true, procedureDefined: true, permissionVerified: false, tested: true }).result).toBe('rollback_unverified');
    expect(evaluateRollbackReadiness({ reversible: true, procedureDefined: true, permissionVerified: true, tested: false }).result).toBe('partially_ready');
    const r = evaluateRollbackReadiness({ reversible: true, procedureDefined: true, permissionVerified: true, tested: true });
    expect(r.result).toBe('rollback_ready_reference');
    expect(r.rollbackPlanIsNotRollbackSuccess).toBe(true);
    expect(r.autoRollback).toBe(false);
  });
});

describe('observation / closure — Completion ≠ Outcome', () => {
  it('observation: pending/in_progress/unexpected/completed + Causality 아님', () => {
    expect(evaluatePostExecutionObservation({ started: false, completed: false, unexpectedEffects: null, evidence: [] }).result).toBe('observation_pending');
    expect(evaluatePostExecutionObservation({ started: true, completed: false, unexpectedEffects: 0, evidence: [] }).result).toBe('observation_in_progress_reference');
    expect(evaluatePostExecutionObservation({ started: true, completed: true, unexpectedEffects: 2, evidence: ['e'] }).result).toBe('unexpected_effect_candidate');
    expect(evaluatePostExecutionObservation({ started: true, completed: true, unexpectedEffects: 0, evidence: [] }).result).toBe('result_unverified');
    const r = evaluatePostExecutionObservation({ started: true, completed: true, unexpectedEffects: 0, evidence: ['0506 실측'] });
    expect(r.result).toBe('observation_completed_reference');
    expect(r.observationIsNotCausality).toBe(true);
    expect(r.completionIsNotOutcome).toBe(true);
  });
  it('closure: rollback review/result/observation 선행 + limitation 구분 + Outcome 아님', () => {
    expect(evaluateHumanClosure({ resultEvidenceReviewed: true, observationReviewed: true, rollbackReviewRequired: true, limitations: [] }).result).toBe('rollback_review_required');
    expect(evaluateHumanClosure({ resultEvidenceReviewed: false, observationReviewed: true, rollbackReviewRequired: false, limitations: [] }).result).toBe('result_unverified');
    expect(evaluateHumanClosure({ resultEvidenceReviewed: true, observationReviewed: false, rollbackReviewRequired: false, limitations: [] }).result).toBe('observation_pending');
    expect(evaluateHumanClosure({ resultEvidenceReviewed: true, observationReviewed: true, rollbackReviewRequired: false, limitations: ['부분 검증'] }).result).toBe('closed_with_limitation');
    const r = evaluateHumanClosure({ resultEvidenceReviewed: true, observationReviewed: true, rollbackReviewRequired: false, limitations: [] });
    expect(r.result).toBe('closed_reference');
    expect(r.closureIsNotOutcomeSuccess).toBe(true);
    expect(r.humanClosureRequired).toBe(true);
  });
});

describe('recommendation / timeline / registry / support', () => {
  it('recommendation: whitelist+Evidence 필수 + confidence clamp + 자동 실행 없음', () => {
    expect('rejected' in buildExecutionRecommendation({ type: 'execute_now', reason: 'x', evidence: ['e'], confidence: null })).toBe(true);
    expect('rejected' in buildExecutionRecommendation({ type: 'perform_dry_run', reason: 'x', evidence: [], confidence: null })).toBe(true);
    const r = buildExecutionRecommendation({ type: 'request_human_approval', reason: '승인 Reference 없음 — 사람 승인 필요', evidence: ['approval_missing 실측'], confidence: 180, alternatives: ['대기'], preconditions: ['0534 승인'] });
    if ('humanApprovalRequired' in r) {
      expect(r.humanApprovalRequired).toBe(true);
      expect(r.autoExecuted).toBe(false);
      expect(r.confidence).toBe(100);
      expect(r.limitations).toContain('Approval ≠ Execution');
    }
  });
  it('timeline: 9단계 + 원본 없는 단계 insufficient_data', () => {
    const r = buildExecutionTimeline([
      { stage: 'request', count: 3, source: 'requests 실측' },
      { stage: 'approval', count: 1, source: 'approval_reference_linked 실측' },
      { stage: 'warp', count: 5, source: 'x' },
    ]);
    expect(r.stages).toHaveLength(9);
    expect(r.stages.find((s) => s.stage === 'closure')?.status).toBe('insufficient_data');
    expect(r.invalidStages).toBe(1);
    expect(r.timelineIsNotCompletionClaim).toBe(true);
  });
  it('connector registry: 결제 disabled + Slack/Jira/Linear/GitHub unavailable', () => {
    expect(CONNECTOR_REGISTRY.find((c) => c.key === 'payment_payapp_edge_functions')?.status).toBe('disabled');
    for (const key of ['slack_connector', 'jira_connector', 'linear_connector', 'github_connector', 'runtime_scheduler_worker_queue']) {
      expect(CONNECTOR_REGISTRY.find((c) => c.key === key)?.status).toBe('connector_unavailable');
    }
  });
  it('SUPPORT: 30항목 + 자동 실행 계열 전부 unsupported', () => {
    expect(EXECUTION_GATEWAY_SUPPORT).toHaveLength(30);
    for (const key of ['auto_connector_execution', 'auto_production_execution', 'auto_merge', 'auto_deploy', 'auto_migration_apply', 'auto_payment_refund', 'auto_contract_pricing_mutation', 'auto_role_account_data_mutation']) {
      expect(EXECUTION_GATEWAY_SUPPORT.find((s) => s.key === key)?.status).toBe('unsupported');
    }
  });
});
