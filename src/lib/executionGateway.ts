/**
 * executionGateway — Enterprise AI Runtime Readiness, Controlled Execution Gateway &
 * Human-Approved Automation Center 순수 로직 (Phase AI-OPS-32).
 *
 * Governed AI Proposal → Human Approval → Execution Request → Policy/Scope/Permission
 * Validation → Dry Run/Sandbox → Controlled External Action → Execution Evidence →
 * Post-Execution Observation → Human Closure.
 *
 * 실행 정직성(전부 코드로 강제):
 *  - Proposal ≠ Approval. Approval ≠ Execution. Execution Request ≠ Execution Success.
 *  - Dry Run ≠ Real Execution. External Reference ≠ Verified Result.
 *  - HTTP Success ≠ Business Success. Execution Completion ≠ Outcome Achievement.
 *  - Rollback Plan ≠ Rollback Success. Observation ≠ Causality. Closure ≠ Outcome Success.
 *  - 자동 실행/승인/재시도/Rollback/Connector 호출 없음. production mode 미지원.
 *  - Unknown 유지(null→0 금지). 실행하지 않은 Dry Run 을 passed 로 표시하지 않음.
 *  - deterministic · pure · null 안전 · NaN/Infinity 방어 · Date 주입.
 */
import { isFiniteNumber, clampScore } from './aiMemory';

/* ── 상수 ─────────────────────────────────────────────────────────────── */
export const EXECUTION_DOMAINS = ['read_only_query', 'document_draft', 'email_draft', 'message_draft', 'ticket_draft', 'issue_draft', 'report_generation', 'evidence_collection', 'validation_check', 'sandbox_test', 'non_production_action_reference', 'manual_external_action_reference'] as const;
export const BLOCKED_EXECUTION_DOMAINS = ['production_deploy', 'production_migration', 'merge', 'payment', 'refund', 'contract_mutation', 'pricing_mutation', 'role_mutation', 'policy_mutation', 'infrastructure_mutation', 'data_deletion', 'secret_rotation', 'account_deletion'] as const;
export const EXECUTION_MODES = ['reference_only', 'read_only', 'draft_only', 'dry_run', 'sandbox', 'non_production_controlled', 'manual_external_reference'] as const;
export const EXECUTION_SCOPE_TYPES = ['global', 'enterprise', 'brand', 'store', 'user'] as const;
export const CAPABILITY_STATUSES = ['available_reference', 'partially_available', 'dry_run_only', 'sandbox_only', 'disabled', 'connector_unavailable', 'permission_unverified', 'deprecated', 'unknown', 'insufficient_data'] as const;
export const DRY_RUN_STATUSES = ['pending', 'running_reference', 'passed_reference', 'warning_reference', 'blocked_reference', 'failed_reference', 'dry_run_unverified', 'insufficient_data'] as const;
export const EXECUTION_TIMELINE_STAGES = ['request', 'approval', 'validation', 'dry_run', 'gate', 'external_action', 'evidence', 'observation', 'closure'] as const;
export const EXECUTION_RECOMMENDATION_TYPES = ['request_human_approval', 'validate_permission', 'validate_scope', 'perform_dry_run', 'prepare_sandbox', 'review_execution_risk', 'gather_execution_evidence', 'verify_external_result', 'review_retry_safety', 'define_timeout_policy', 'prepare_rollback_reference', 'prepare_observation_plan', 'review_unexpected_effect', 'request_human_closure', 'insufficient_data'] as const;

/* ── 1) Execution Request 검증(Request ≠ Execution) ──────────────────── */
export function validateExecutionRequest(i: { domain: string; mode: string; scopeType: string; title: string; approvalReferenceId: string | null }):
  { valid: boolean; rejectReasons: string[]; approvalStatus: 'approval_linked_reference' | 'approval_missing'; requestIsNotExecution: true; autoExecuted: false } {
  const reasons: string[] = [];
  if ((BLOCKED_EXECUTION_DOMAINS as readonly string[]).includes(i.domain)) reasons.push(`금지 도메인: ${i.domain}`);
  else if (!(EXECUTION_DOMAINS as readonly string[]).includes(i.domain)) reasons.push('허용되지 않는 domain');
  if (i.mode === 'production') reasons.push('production mode 미지원');
  else if (!(EXECUTION_MODES as readonly string[]).includes(i.mode)) reasons.push('허용되지 않는 mode');
  if (!(EXECUTION_SCOPE_TYPES as readonly string[]).includes(i.scopeType)) reasons.push('허용되지 않는 scope type');
  if (!i.title.trim()) reasons.push('title 필수');
  return {
    valid: reasons.length === 0, rejectReasons: reasons,
    approvalStatus: i.approvalReferenceId ? 'approval_linked_reference' : 'approval_missing',
    requestIsNotExecution: true, autoExecuted: false,
  };
}

/* ── 2) Runtime Readiness(런타임 없음 — 평가만·재정규화 없이 결측 명시) ── */
export function evaluateRuntimeReadiness(components: { key: string; available: boolean | null; note: string }[] | null): { rows: { key: string; status: 'available_reference' | 'runtime_unavailable' | 'unknown'; note: string }[]; availableCount: number; verdict: 'runtime_partial_reference' | 'runtime_unavailable' | 'insufficient_data'; readinessIsNotExecution: true } {
  const rows = (components ?? []).map((c) => ({
    key: c.key,
    status: c.available == null ? ('unknown' as const) : c.available ? ('available_reference' as const) : ('runtime_unavailable' as const),
    note: c.note,
  }));
  const available = rows.filter((r) => r.status === 'available_reference').length;
  return {
    rows, availableCount: available,
    verdict: !rows.length ? 'insufficient_data' : available > 0 ? 'runtime_partial_reference' : 'runtime_unavailable',
    readinessIsNotExecution: true,
  };
}

/* ── 3) Capability(Connector 실존과 동일하지 않음) ───────────────────── */
export function evaluateCapabilityAvailability(caps: { code: string; status: string; connectorType: string }[] | null): { rows: { code: string; status: string; connectorType: string }[]; invalidCapabilities: number; executable: number; capabilityIsNotConnector: true } {
  const valid = (caps ?? []).filter((c) => (CAPABILITY_STATUSES as readonly string[]).includes(c.status));
  return {
    rows: valid.slice(0, 100),
    invalidCapabilities: (caps ?? []).length - valid.length,
    executable: valid.filter((c) => ['available_reference', 'partially_available', 'dry_run_only', 'sandbox_only'].includes(c.status)).length,
    capabilityIsNotConnector: true,
  };
}

/* ── 4) Permission Validation(Secret 노출 금지) ──────────────────────── */
export function validatePermissionRequirements(i: { adminVerified: boolean | null; scopeOwned: boolean | null; secondaryApprovalRequired: boolean; sensitiveData: boolean; secretAccess: boolean }): { result: 'permission_verified_reference' | 'partially_verified' | 'permission_unverified' | 'secondary_approval_required' | 'sensitive_scope_detected' | 'secret_scope_detected'; blockers: string[]; secretExposed: false } {
  const blockers: string[] = [];
  if (i.secretAccess) return { result: 'secret_scope_detected', blockers: ['Secret 접근 요구 — 차단(직접 노출 금지)'], secretExposed: false };
  if (i.sensitiveData) blockers.push('민감 데이터 접근 — 경고');
  if (i.secondaryApprovalRequired) return { result: 'secondary_approval_required', blockers, secretExposed: false };
  if (i.adminVerified == null || i.scopeOwned == null) return { result: 'permission_unverified', blockers: [...blockers, '권한 검증 미수행(unknown 유지)'], secretExposed: false };
  if (i.sensitiveData) return { result: 'sensitive_scope_detected', blockers, secretExposed: false };
  if (i.adminVerified && i.scopeOwned) return { result: 'permission_verified_reference', blockers, secretExposed: false };
  return { result: 'partially_verified', blockers: [...blockers, 'Admin/Ownership 부분 검증'], secretExposed: false };
}

/* ── 5) Scope Validation(Cross-Enterprise/Brand/Store·Production 차단) ── */
export function validateExecutionScope(i: { requestScope: { type: string; id: string | null }; approvalScope: { type: string; id: string | null } | null; isProductionTarget: boolean }): { result: 'scope_verified_reference' | 'scope_unverified' | 'scope_mismatch' | 'cross_enterprise_blocked' | 'cross_brand_blocked' | 'cross_store_blocked' | 'production_scope_blocked'; productionBlocked: boolean } {
  if (i.isProductionTarget) return { result: 'production_scope_blocked', productionBlocked: true };
  if (!(EXECUTION_SCOPE_TYPES as readonly string[]).includes(i.requestScope.type)) return { result: 'scope_unverified', productionBlocked: false };
  if (!i.approvalScope) return { result: 'scope_unverified', productionBlocked: false };
  if (i.requestScope.type !== i.approvalScope.type) return { result: 'scope_mismatch', productionBlocked: false };
  if (i.requestScope.id !== i.approvalScope.id) {
    if (i.requestScope.type === 'enterprise') return { result: 'cross_enterprise_blocked', productionBlocked: false };
    if (i.requestScope.type === 'brand') return { result: 'cross_brand_blocked', productionBlocked: false };
    if (i.requestScope.type === 'store') return { result: 'cross_store_blocked', productionBlocked: false };
    return { result: 'scope_mismatch', productionBlocked: false };
  }
  return { result: 'scope_verified_reference', productionBlocked: false };
}

/* ── 6) Execution Risk(Critical 은 Controlled Execution 대상 아님) ────── */
export function calculateExecutionRisk(i: { isWrite: boolean | null; externalSideEffect: boolean | null; financialImpact: boolean; productionProximity: boolean; irreversible: boolean; sensitiveData: boolean }): { level: 'negligible' | 'low' | 'moderate' | 'high' | 'critical' | 'risk_unverified'; factors: string[]; controlledExecutionAllowed: boolean; riskIsNotFailure: true } {
  if (i.isWrite == null || i.externalSideEffect == null) return { level: 'risk_unverified', factors: ['Write/Side Effect 미확인(unknown 유지)'], controlledExecutionAllowed: false, riskIsNotFailure: true };
  const factors: string[] = [];
  let level: 'negligible' | 'low' | 'moderate' | 'high' | 'critical' = i.isWrite ? 'low' : 'negligible';
  if (i.externalSideEffect) { level = 'moderate'; factors.push('외부 Side Effect'); }
  if (i.sensitiveData) { level = level === 'moderate' ? 'high' : 'moderate'; factors.push('민감 데이터'); }
  if (i.financialImpact) { level = 'high'; factors.push('재무 영향'); }
  if (i.productionProximity || i.irreversible) { level = 'critical'; factors.push(i.productionProximity ? 'Production 근접' : '비가역 작업'); }
  return { level, factors, controlledExecutionAllowed: level === 'negligible' || level === 'low' || level === 'moderate', riskIsNotFailure: true };
}

/* ── 7) Dry Run(Dry Run ≠ Real Execution·미수행 passed 금지) ─────────── */
export function evaluateDryRun(i: { performed: boolean; status: string | null; evidence: string[] }): { status: (typeof DRY_RUN_STATUSES)[number]; dryRunIsNotRealExecution: true } {
  if (!i.performed) return { status: 'dry_run_unverified', dryRunIsNotRealExecution: true };   // 실행하지 않은 Dry Run 을 passed 로 표시하지 않음
  if (i.status == null || !(DRY_RUN_STATUSES as readonly string[]).includes(i.status)) return { status: 'insufficient_data', dryRunIsNotRealExecution: true };
  if ((i.status === 'passed_reference' || i.status === 'warning_reference') && !i.evidence.length) return { status: 'dry_run_unverified', dryRunIsNotRealExecution: true };
  return { status: i.status as (typeof DRY_RUN_STATUSES)[number], dryRunIsNotRealExecution: true };
}

/* ── 8) Sandbox Readiness ────────────────────────────────────────────── */
export function evaluateSandboxReadiness(i: { environmentExists: boolean | null; isolationVerified: boolean | null; credentialIsolated: boolean | null; cleanupDefined: boolean | null }): { result: 'sandbox_ready_reference' | 'partially_ready' | 'sandbox_unavailable' | 'isolation_unverified' | 'credential_unverified' | 'cleanup_unverified' | 'insufficient_data' } {
  if (i.environmentExists == null) return { result: 'insufficient_data' };
  if (!i.environmentExists) return { result: 'sandbox_unavailable' };
  if (i.isolationVerified == null || !i.isolationVerified) return { result: 'isolation_unverified' };
  if (i.credentialIsolated == null || !i.credentialIsolated) return { result: 'credential_unverified' };
  if (i.cleanupDefined == null || !i.cleanupDefined) return { result: 'cleanup_unverified' };
  return { result: 'sandbox_ready_reference' };
}

/* ── 9) Controlled Execution Gate(13조건 — 하나라도 미충족이면 차단) ──── */
export function evaluateExecutionGate(i: { approvalLinked: boolean; permissionVerified: boolean; scopeVerified: boolean; riskLevel: string; dryRunRequired: boolean; dryRunPassed: boolean; sandboxRequired: boolean; sandboxReady: boolean; observationPlanDefined: boolean; rollbackRequired: boolean; rollbackReady: boolean }): { result: 'gate_ready_reference' | 'gate_blocked'; blockers: string[]; gateReadyIsNotExecuted: true; autoExecuted: false } {
  const blockers: string[] = [];
  if (!i.approvalLinked) blockers.push('approval_missing');
  if (!i.permissionVerified) blockers.push('permission_unverified');
  if (!i.scopeVerified) blockers.push('scope_unverified');
  if (i.riskLevel === 'high' || i.riskLevel === 'critical') blockers.push('risk_too_high');
  if (i.riskLevel === 'risk_unverified' || i.riskLevel === 'insufficient_data') blockers.push('risk_unverified');
  if (i.dryRunRequired && !i.dryRunPassed) blockers.push('dry_run_missing');
  if (i.sandboxRequired && !i.sandboxReady) blockers.push('sandbox_unavailable');
  if (!i.observationPlanDefined) blockers.push('observation_plan_missing');
  if (i.rollbackRequired && !i.rollbackReady) blockers.push('rollback_unverified');
  return { result: blockers.length ? 'gate_blocked' : 'gate_ready_reference', blockers, gateReadyIsNotExecuted: true, autoExecuted: false };
}

/* ── 10) Result Evidence(HTTP Success ≠ Business Success) ────────────── */
export function evaluateResultEvidence(i: { externalResponse: boolean; evidence: string[]; verificationMethod: string | null; sideEffectChecked: boolean | null }): { result: 'evidence_verified_reference' | 'evidence_partial' | 'response_only' | 'result_unverified' | 'side_effect_unverified'; httpSuccessIsNotBusinessSuccess: true } {
  if (!i.externalResponse && !i.evidence.length) return { result: 'result_unverified', httpSuccessIsNotBusinessSuccess: true };
  if (i.externalResponse && !i.evidence.length) return { result: 'response_only', httpSuccessIsNotBusinessSuccess: true };
  if (i.verificationMethod == null) return { result: 'evidence_partial', httpSuccessIsNotBusinessSuccess: true };
  if (i.sideEffectChecked == null || !i.sideEffectChecked) return { result: 'side_effect_unverified', httpSuccessIsNotBusinessSuccess: true };
  return { result: 'evidence_verified_reference', httpSuccessIsNotBusinessSuccess: true };
}

/* ── 11) Retry Safety(자동 무한 재시도 금지) ─────────────────────────── */
export function evaluateRetrySafety(i: { retryableError: boolean | null; idempotencySupported: boolean; duplicateSideEffectRisk: boolean; retryCount: number | null; retryLimit: number }): { result: 'retry_safe_reference' | 'manual_retry_required' | 'retry_blocked' | 'idempotency_unverified' | 'duplicate_side_effect_risk' | 'retry_limit_reached' | 'insufficient_data'; autoRetry: false } {
  if (i.retryableError == null) return { result: 'insufficient_data', autoRetry: false };
  if (!i.retryableError) return { result: 'retry_blocked', autoRetry: false };
  if (i.retryCount != null && isFiniteNumber(i.retryCount) && i.retryCount >= i.retryLimit) return { result: 'retry_limit_reached', autoRetry: false };
  if (i.duplicateSideEffectRisk) return { result: 'duplicate_side_effect_risk', autoRetry: false };
  if (!i.idempotencySupported) return { result: 'idempotency_unverified', autoRetry: false };
  // 안전해 보여도 자동 재시도는 없음 — 사람 승인 필요.
  return { result: 'manual_retry_required', autoRetry: false };
}

/* ── 12) Timeout & Cancellation ──────────────────────────────────────── */
export function evaluateTimeoutCancellation(i: { timeoutSeconds: number | null; cancellationSupported: boolean | null; partialExecutionPossible: boolean; cleanupRequired: boolean }): { results: string[]; timeoutSeconds: number | null } {
  const results: string[] = [];
  const t = i.timeoutSeconds != null && isFiniteNumber(i.timeoutSeconds) ? Math.min(Math.max(Math.round(i.timeoutSeconds), 1), 600) : null;
  results.push(t != null ? 'timeout_policy_defined' : 'insufficient_data');
  if (i.cancellationSupported == null) results.push('insufficient_data');
  else results.push(i.cancellationSupported ? 'cancellation_supported_reference' : 'cancellation_unavailable');
  if (i.partialExecutionPossible) results.push('partial_execution_risk');
  if (i.cleanupRequired) results.push('cleanup_required');
  return { results, timeoutSeconds: t };
}

/* ── 13) Rollback Readiness(자동 Rollback 없음) ──────────────────────── */
export function evaluateRollbackReadiness(i: { reversible: boolean | null; procedureDefined: boolean; permissionVerified: boolean; tested: boolean }): { result: 'rollback_ready_reference' | 'partially_ready' | 'rollback_unverified' | 'rollback_unavailable' | 'irreversible_action' | 'insufficient_data'; rollbackPlanIsNotRollbackSuccess: true; autoRollback: false } {
  if (i.reversible == null) return { result: 'insufficient_data', rollbackPlanIsNotRollbackSuccess: true, autoRollback: false };
  if (!i.reversible) return { result: 'irreversible_action', rollbackPlanIsNotRollbackSuccess: true, autoRollback: false };
  if (!i.procedureDefined) return { result: 'rollback_unavailable', rollbackPlanIsNotRollbackSuccess: true, autoRollback: false };
  if (!i.permissionVerified) return { result: 'rollback_unverified', rollbackPlanIsNotRollbackSuccess: true, autoRollback: false };
  if (!i.tested) return { result: 'partially_ready', rollbackPlanIsNotRollbackSuccess: true, autoRollback: false };
  return { result: 'rollback_ready_reference', rollbackPlanIsNotRollbackSuccess: true, autoRollback: false };
}

/* ── 14) Post-Execution Observation(Observation ≠ Causality) ─────────── */
export function evaluatePostExecutionObservation(i: { started: boolean; completed: boolean; unexpectedEffects: number | null; evidence: string[] }): { result: 'observation_ready_reference' | 'observation_in_progress_reference' | 'observation_completed_reference' | 'observation_pending' | 'unexpected_effect_candidate' | 'result_unverified'; observationIsNotCausality: true; completionIsNotOutcome: true } {
  if (!i.started) return { result: 'observation_pending', observationIsNotCausality: true, completionIsNotOutcome: true };
  if (i.unexpectedEffects != null && isFiniteNumber(i.unexpectedEffects) && i.unexpectedEffects > 0) return { result: 'unexpected_effect_candidate', observationIsNotCausality: true, completionIsNotOutcome: true };
  if (!i.completed) return { result: 'observation_in_progress_reference', observationIsNotCausality: true, completionIsNotOutcome: true };
  if (!i.evidence.length) return { result: 'result_unverified', observationIsNotCausality: true, completionIsNotOutcome: true };
  return { result: 'observation_completed_reference', observationIsNotCausality: true, completionIsNotOutcome: true };
}

/* ── 15) Human Closure(Closure ≠ Outcome Success) ────────────────────── */
export function evaluateHumanClosure(i: { resultEvidenceReviewed: boolean; observationReviewed: boolean; rollbackReviewRequired: boolean; limitations: string[] }): { result: 'closure_pending' | 'closed_reference' | 'closed_with_limitation' | 'result_unverified' | 'observation_pending' | 'rollback_review_required'; closureIsNotOutcomeSuccess: true; humanClosureRequired: true } {
  if (i.rollbackReviewRequired) return { result: 'rollback_review_required', closureIsNotOutcomeSuccess: true, humanClosureRequired: true };
  if (!i.resultEvidenceReviewed) return { result: 'result_unverified', closureIsNotOutcomeSuccess: true, humanClosureRequired: true };
  if (!i.observationReviewed) return { result: 'observation_pending', closureIsNotOutcomeSuccess: true, humanClosureRequired: true };
  return { result: i.limitations.length ? 'closed_with_limitation' : 'closed_reference', closureIsNotOutcomeSuccess: true, humanClosureRequired: true };
}

/* ── 16) Execution Recommendation(15종 whitelist·Evidence 필수) ──────── */
export function buildExecutionRecommendation(i: { type: string; reason: string; evidence: string[]; confidence: number | null; alternatives?: string[]; preconditions?: string[]; limitations?: string[] }):
  | { rejected: true; rejectReason: string }
  | { type: string; reason: string; evidence: string[]; confidence: number | null; alternatives: string[]; preconditions: string[]; limitations: string[]; humanApprovalRequired: true; autoExecuted: false } {
  if (!(EXECUTION_RECOMMENDATION_TYPES as readonly string[]).includes(i.type)) return { rejected: true, rejectReason: `허용되지 않는 recommendation type: ${i.type}` };
  if (!i.evidence.length) return { rejected: true, rejectReason: 'Evidence 없는 권고 금지(execution_unverified)' };
  if (!i.reason.trim()) return { rejected: true, rejectReason: 'Reason 필수' };
  return {
    type: i.type, reason: i.reason, evidence: i.evidence.slice(0, 10),
    confidence: i.confidence != null && isFiniteNumber(i.confidence) ? clampScore(i.confidence) : null,
    alternatives: (i.alternatives ?? []).slice(0, 5), preconditions: (i.preconditions ?? []).slice(0, 10),
    limitations: [...(i.limitations ?? []), 'Proposal ≠ Approval', 'Approval ≠ Execution', 'Confidence ≠ Correctness'].slice(0, 10),
    humanApprovalRequired: true, autoExecuted: false,
  };
}

/* ── 17) Execution Timeline(9단계 실측 집계) ─────────────────────────── */
export function buildExecutionTimeline(counts: { stage: string; count: number | null; source: string }[] | null): { stages: { stage: string; count: number | null; source: string; status: 'measured' | 'insufficient_data' }[]; invalidStages: number; timelineIsNotCompletionClaim: true } {
  const valid = (counts ?? []).filter((c) => (EXECUTION_TIMELINE_STAGES as readonly string[]).includes(c.stage));
  const byStage = new Map(valid.map((c) => [c.stage, c]));
  return {
    stages: EXECUTION_TIMELINE_STAGES.map((stage) => {
      const c = byStage.get(stage);
      const count = c && c.count != null && isFiniteNumber(c.count) ? c.count : null;
      return { stage, count, source: c?.source ?? '원본 없음', status: count != null ? ('measured' as const) : ('insufficient_data' as const) };
    }),
    invalidStages: (counts ?? []).length - valid.length,
    timelineIsNotCompletionClaim: true,
  };
}

/* ── Connector Registry(코드 실측 — 빌드 시점 기준·자동 실행 없음) ────── */
export const CONNECTOR_REGISTRY: { key: string; status: 'available_reference' | 'connector_unavailable' | 'disabled'; note: string }[] = [
  { key: 'email_dispatch_edge_functions', status: 'available_reference', note: 'dispatch-contract/moderation-emails 등(Resend) — Draft/사람 승인 흐름만, 자동 발송 없음' },
  { key: 'kakao_message_edge_function', status: 'available_reference', note: 'dispatch-kakao-message 실존 — 자동 발송 없음' },
  { key: 'push_notification_edge_function', status: 'available_reference', note: 'send-push 실존 — 자동 발송 없음' },
  { key: 'pdf_generation_edge_function', status: 'available_reference', note: 'generate-enterprise-billing-pdf 실존 — Report/Draft 계열' },
  { key: 'db_admin_edge_function', status: 'available_reference', note: 'admin-apply-analytics-db 실존 — 본 게이트에서 호출하지 않음(Reference 만)' },
  { key: 'payment_payapp_edge_functions', status: 'disabled', note: 'PayApp 결제 실존하나 결제/환불 도메인은 금지(강제 비활성)' },
  { key: 'gmail_connector', status: 'connector_unavailable', note: '앱 코드에 Gmail 연동 없음' },
  { key: 'slack_connector', status: 'connector_unavailable', note: '앱 코드에 Slack 연동 없음' },
  { key: 'github_connector', status: 'connector_unavailable', note: '앱 코드에 GitHub 연동 없음' },
  { key: 'jira_connector', status: 'connector_unavailable', note: '앱 코드에 Jira 연동 없음' },
  { key: 'linear_connector', status: 'connector_unavailable', note: '앱 코드에 Linear 연동 없음' },
  { key: 'calendar_drive_connector', status: 'connector_unavailable', note: '앱 코드에 Calendar/Drive 연동 없음' },
  { key: 'vercel_supabase_admin_api', status: 'connector_unavailable', note: '앱 코드에 관리 API 연동 없음(인프라 변경 금지)' },
  { key: 'runtime_scheduler_worker_queue', status: 'connector_unavailable', note: 'process-scheduled-releases 외 범용 Scheduler/Worker/Queue 없음' },
];

/* ── Support Matrix ──────────────────────────────────────────────────── */
export const EXECUTION_GATEWAY_SUPPORT: { key: string; status: string; note: string }[] = [
  { key: 'runtime_readiness', status: 'partially_supported', note: 'Agent Runtime/Scheduler/Queue 없음 — Readiness 평가만' },
  { key: 'execution_request', status: 'fully_supported', note: '기록/검증/게이트 — Request ≠ Execution' },
  { key: 'human_approval_reference', status: 'fully_supported', note: '0534 oversight_approved 실존 검증 연결만 인정' },
  { key: 'capability_registry', status: 'fully_supported', note: '사람 기록 — Connector 실존과 동일하지 않음' },
  { key: 'connector_registry', status: 'partially_supported', note: 'Edge Function 20종 코드 실측 — 범용 Registry 없음' },
  { key: 'permission_validation', status: 'evidence_only', note: '관리자 Reference 중심 — Secret Scope 차단' },
  { key: 'scope_validation', status: 'evidence_only', note: 'Cross-Enterprise/Brand/Store·Production Scope 차단' },
  { key: 'execution_risk', status: 'fully_supported', note: 'Critical/High 는 Controlled Execution 대상 아님' },
  { key: 'dry_run', status: 'dry_run_only', note: 'Reference 기록 — 미수행 passed 표시 금지(Evidence 강제)' },
  { key: 'sandbox', status: 'runtime_unavailable', note: '실제 Sandbox 환경 미확인 — Readiness 평가만' },
  { key: 'execution_gate', status: 'fully_supported', note: '서버+클라 이중 게이트(승인/권한/Scope/DryRun/Risk)' },
  { key: 'external_action_reference', status: 'external_reference_only', note: 'Reference 기록만 — Connector 실행 없음' },
  { key: 'result_evidence', status: 'evidence_only', note: 'HTTP Success ≠ Business Success' },
  { key: 'retry_safety', status: 'partially_supported', note: '검토만 — 자동 재시도 없음(manual_retry_required)' },
  { key: 'timeout_policy', status: 'partially_supported', note: '1~600s clamp 정의 — 런타임 강제 없음' },
  { key: 'cancellation', status: 'partially_supported', note: 'Reference 기록 — 자동 취소 없음' },
  { key: 'rollback_readiness', status: 'evidence_only', note: 'Rollback Plan ≠ Rollback Success·자동 Rollback 없음' },
  { key: 'post_execution_observation', status: 'read_only', note: '0506/0507/0502/0514 읽기 전용 연결 — Observation ≠ Causality' },
  { key: 'unexpected_effect', status: 'partially_supported', note: '후보 감지/기록 — 자동 대응 없음' },
  { key: 'human_closure', status: 'fully_supported', note: 'Closure ≠ Outcome Success — 결과 보고 없는 Closure 서버 차단' },
  { key: 'execution_recommendation', status: 'fully_supported', note: '15종 whitelist·Evidence 필수 — 자동 실행 없음' },
  { key: 'human_review_audit', status: 'fully_supported', note: '22종 이벤트 Audit — 자동 성공 의미 없음' },
  { key: 'auto_connector_execution', status: 'unsupported', note: '자동 Connector/외부 API/이메일/Slack/Ticket/Issue/PR 금지' },
  { key: 'auto_production_execution', status: 'unsupported', note: '자동 Production 변경 금지 — production mode 자체 미지원' },
  { key: 'auto_merge', status: 'unsupported', note: '자동 Merge 금지' },
  { key: 'auto_deploy', status: 'unsupported', note: '자동 Deploy 금지' },
  { key: 'auto_migration_apply', status: 'unsupported', note: '자동 Migration Apply 금지' },
  { key: 'auto_payment_refund', status: 'unsupported', note: '자동 결제/환불 금지(PayApp 실존하나 도메인 차단)' },
  { key: 'auto_contract_pricing_mutation', status: 'unsupported', note: '자동 계약/가격 변경 금지' },
  { key: 'auto_role_account_data_mutation', status: 'unsupported', note: '자동 권한/계정/데이터 삭제·Secret 변경 금지' },
];
