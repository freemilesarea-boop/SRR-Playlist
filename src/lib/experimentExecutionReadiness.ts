/**
 * experimentExecutionReadiness — Internal Test Execution Readiness, Live
 * Validation & Canary Promotion Gate (Phase AI-EXPERIMENT-3, 순수 로직).
 *
 * 이 모듈은 새 추천 알고리즘을 만들지 않는다. AI-EXPERIMENT-2 의 Internal
 * Treatment Runtime 이 **실제 환경에서 안전하게 동작하는지** 판정하기 위한
 * 환경 격리/준비 게이트, Control Baseline, Latency/Event Delivery 집계,
 * Promotion Gate, 최종 Decision 로직을 담는다.
 *
 * 절대 원칙: Evidence-Based / Fail-Closed / Reversible / Human-Approved.
 *  · Preview 앱이 Production DB 에 연결됐거나 격리 Test/Preview DB 가 없으면
 *    실행은 불가하며 Decision 은 NO-GO 다(실제 Treatment 실행 금지).
 *  · 증거 없는 항목은 PASS 가 아니라 not_run 이다.
 *  · Sample 부족 시 p95/승자/우열을 주장하지 않는다.
 *  · CANARY_CANDIDATE 는 외부 Canary 활성화가 아니라 Human Review 상태일 뿐이다.
 *  · Canary 활성화 / Global Rollout / Production Apply / Weight Apply /
 *    Auto Rollback 은 함수 자체가 없다(BLOCKED 목록 고정).
 */

/* ── Environment Classification ──────────────────────────────────────────── */
export type ExecutionEnvironmentStatus = 'ready' | 'partially_ready' | 'blocked' | 'unknown';
export type DatabaseIsolationStatus = 'isolated_test_db' | 'isolated_preview_db' | 'production_connected' | 'unknown';
export type MigrationStatus = 'fully_applied' | 'partially_applied' | 'not_applied' | 'failed' | 'unknown';

export type CheckStatus = 'pass' | 'fail' | 'not_run' | 'insufficient_data';

export type ExecutionDecision =
  | 'NO_GO' | 'CONTINUE_INTERNAL' | 'EXTEND_INTERNAL' | 'RETURN_TO_SHADOW' | 'CANARY_CANDIDATE';

export const FIXED_EXECUTION_WARNING =
  '이 검증은 격리된 Test/Preview 환경에서만 실제 Treatment를 실행합니다. Preview 앱이 Production DB에 연결되어 있으면 실제 실행은 NO-GO이며, CANARY_CANDIDATE는 외부 Canary 활성화가 아니라 다음 Phase 검토 상태입니다.';

/** 필수 스키마/RPC — Readiness Gate 는 이 목록이 전부 present 여야 통과. */
export const REQUIRED_TABLES = [
  'ai_learning_exposures', 'ai_learning_events', 'ai_learning_aggregates', 'ai_learning_weight_proposals',
  'ai_recommendation_experiments', 'ai_experiment_store_allowlist', 'ai_experiment_assignments',
  'ai_experiment_exposures', 'ai_experiment_metric_snapshots', 'ai_experiment_events',
  'ai_experiment_rollback_proposals', 'ai_experiment_runtime_events', 'ai_experiment_store_stops',
] as const;

export const REQUIRED_ADMIN_RPCS = [
  'admin_ai_exp_create', 'admin_ai_exps', 'admin_ai_exp_allowlist_set', 'admin_ai_exp_build_assignments',
  'admin_ai_exp_runtime_events', 'admin_ai_exp_store_stop', 'admin_ai_exp_store_resume',
  'admin_ai_exp_generate_metric_snapshot', 'admin_ai_exp_generate_guardrail_snapshot',
  'admin_ai_exp_internal_overview',
] as const;

export const REQUIRED_RUNTIME_RPCS = [
  'experiment_runtime_lookup', 'experiment_treatment_gate', 'experiment_treatment_recommend',
  'experiment_record_runtime_event', 'experiment_record_exposure',
] as const;

/** 금지 액션 — 스펙 금지 기능과 1:1. */
export const BLOCKED_EXECUTION_ACTIONS = [
  'activate_canary', 'add_external_store', 'apply_to_production', 'replace_v1',
  'apply_weight', 'global_rollout', 'auto_expand', 'auto_rollout', 'auto_winner_apply', 'auto_rollback',
] as const;
export function isBlockedExecutionAction(action: string): boolean {
  return (BLOCKED_EXECUTION_ACTIONS as readonly string[]).includes(action) || action.startsWith('automatic_');
}

/* ── Environment Classification 판정 ─────────────────────────────────────── */
export interface EnvironmentInput {
  previewConnectedToProduction: boolean;
  isolatedTestDb: boolean;
  isolatedPreviewDb: boolean;
  migrationStatus: MigrationStatus;
  missingTables: string[];
  missingAdminRpcs: string[];
  missingRuntimeRpcs: string[];
  testStoreConfirmed: boolean;
  emergencyStopTestable: boolean;
}

export function classifyDatabaseIsolation(e: EnvironmentInput): DatabaseIsolationStatus {
  if (e.previewConnectedToProduction) return 'production_connected';
  if (e.isolatedTestDb) return 'isolated_test_db';
  if (e.isolatedPreviewDb) return 'isolated_preview_db';
  return 'unknown';
}

export function classifyEnvironment(e: EnvironmentInput): ExecutionEnvironmentStatus {
  const iso = classifyDatabaseIsolation(e);
  if (iso === 'production_connected') return 'blocked';
  if (iso === 'unknown') return 'unknown';
  const rpcOk = e.missingAdminRpcs.length === 0 && e.missingRuntimeRpcs.length === 0;
  const schemaOk = e.missingTables.length === 0;
  if (e.migrationStatus === 'fully_applied' && rpcOk && schemaOk && e.testStoreConfirmed && e.emergencyStopTestable) return 'ready';
  if (e.migrationStatus === 'failed') return 'blocked';
  return 'partially_ready';
}

/** Readiness Gate — 모든 실행 전제 충족 여부. Fail-Closed. */
export function evaluateReadinessGate(e: EnvironmentInput): { ready: boolean; blockers: string[]; isolation: DatabaseIsolationStatus; environment: ExecutionEnvironmentStatus } {
  const isolation = classifyDatabaseIsolation(e);
  const environment = classifyEnvironment(e);
  const blockers: string[] = [];
  if (isolation === 'production_connected') blockers.push('preview_connected_to_production');
  if (isolation === 'unknown') blockers.push('db_isolation_unknown');
  if (e.migrationStatus !== 'fully_applied') blockers.push(`migration_${e.migrationStatus}`);
  if (e.missingTables.length) blockers.push('missing_tables');
  if (e.missingAdminRpcs.length) blockers.push('missing_admin_rpcs');
  if (e.missingRuntimeRpcs.length) blockers.push('missing_runtime_rpcs');
  if (!e.testStoreConfirmed) blockers.push('test_store_unconfirmed');
  if (!e.emergencyStopTestable) blockers.push('emergency_stop_untestable');
  return { ready: blockers.length === 0, blockers, isolation, environment };
}

/* ── Control Baseline ────────────────────────────────────────────────────── */
export interface ControlBaselineInput {
  storeLogin: boolean;
  playlistLoaded: boolean;
  queueCreated: boolean;
  trackCount: number;
  audioStarted: boolean;
  timeToFirstAudioMs: number | null;
  trackTransitioned: boolean;
  completeEvent: boolean;
  decoderError: boolean;
  queueEmptyOccurred: boolean;
  eventDelivered: boolean;
}

export function validateControlBaseline(c: ControlBaselineInput): { stable: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!c.storeLogin) issues.push('store_login_failed');
  if (!c.playlistLoaded) issues.push('playlist_load_failed');
  if (!c.queueCreated || c.trackCount <= 0) issues.push('queue_empty');
  if (!c.audioStarted) issues.push('audio_did_not_start');
  if (c.decoderError) issues.push('decoder_error');
  if (c.queueEmptyOccurred) issues.push('queue_empty_occurred');
  if (!c.eventDelivered) issues.push('event_not_delivered');
  // Control 자체가 불안정하면 Treatment 테스트 금지.
  return { stable: issues.length === 0, issues };
}

/* ── Runtime Latency ─────────────────────────────────────────────────────── */
export const LATENCY_MIN_SAMPLE = 5;
export const LATENCY_THRESHOLDS = {
  gateP95Ms: 500,
  treatmentP95Ms: 2500,
  queueAdapterP95Ms: 100,
  totalRuntimeP95Ms: 3000,
} as const;

export interface LatencyStats {
  count: number;
  min: number | null;
  median: number | null;
  p95: number | null;
  max: number | null;
  status: 'available' | 'insufficient_data';
}

export function computeLatencyStats(samples: number[]): LatencyStats {
  const valid = samples.filter((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0).slice().sort((a, b) => a - b);
  if (valid.length < LATENCY_MIN_SAMPLE) {
    return { count: valid.length, min: valid[0] ?? null, median: null, p95: null, max: valid[valid.length - 1] ?? null, status: 'insufficient_data' };
  }
  const pick = (q: number) => valid[Math.min(valid.length - 1, Math.floor(q * (valid.length - 1)))];
  return { count: valid.length, min: valid[0], median: pick(0.5), p95: pick(0.95), max: valid[valid.length - 1], status: 'available' };
}

export function evaluateLatencyThreshold(stats: LatencyStats, thresholdMs: number): CheckStatus {
  if (stats.status === 'insufficient_data' || stats.p95 == null) return 'insufficient_data';
  return stats.p95 <= thresholdMs ? 'pass' : 'fail';
}

/* ── Event Delivery ──────────────────────────────────────────────────────── */
export interface EventDeliveryInput {
  expected: number;
  received: number;
  duplicate: number;
  invalid: number;
}

export interface EventDeliveryResult {
  expected: number;
  received: number;
  missing: number;
  duplicate: number;
  invalid: number;
  deliveryRate: number | null;
  lossRate: number | null;
  status: CheckStatus;
}

export const EVENT_LOSS_MAX = 0.1;
export const EVENT_DELIVERY_MIN_SAMPLE = 5;

export function evaluateEventDelivery(i: EventDeliveryInput): EventDeliveryResult {
  const missing = Math.max(0, i.expected - i.received);
  if (i.expected < EVENT_DELIVERY_MIN_SAMPLE) {
    return { expected: i.expected, received: i.received, missing, duplicate: i.duplicate, invalid: i.invalid, deliveryRate: null, lossRate: null, status: 'insufficient_data' };
  }
  const deliveryRate = Math.round((i.received / i.expected) * 1000) / 1000;
  const lossRate = Math.round((missing / i.expected) * 1000) / 1000;
  const ok = lossRate <= EVENT_LOSS_MAX && i.invalid === 0;
  return { expected: i.expected, received: i.received, missing, duplicate: i.duplicate, invalid: i.invalid, deliveryRate, lossRate, status: ok ? 'pass' : 'fail' };
}

/* ── Promotion Gate ──────────────────────────────────────────────────────── */
export interface PromotionGateInput {
  // Environment
  testDbIsolated: boolean;
  migrationOk: boolean;
  requiredRpcOk: boolean;
  rlsOk: boolean;
  // Runtime
  treatmentGatePass: CheckStatus;
  queueContractPass: CheckStatus;
  actualPlaybackPass: CheckStatus;
  currentTrackNotForceStopped: CheckStatus;
  controlFallbackPass: CheckStatus;
  emergencyStopPass: CheckStatus;
  storeResumePass: CheckStatus;
  // Data
  exposureCreationPass: CheckStatus;
  attributionPass: CheckStatus;
  eventDeliveryWithinRange: boolean;
  variantDriftCount: number;
  invalidAttributionCount: number;
  // Stability
  queueEmptyCount: number;
  playbackStartFailureCount: number;
  decoderErrorCount: number;
  duplicatePlaybackCount: number;
  playerFreezeCount: number;
  blockingGuardrailCount: number;
  timeToFirstAudioSevereRegression: boolean;
  // Operations
  runbookComplete: boolean;
  stopProcedureComplete: boolean;
  controlRecoveryConfirmed: boolean;
  auditConfirmed: boolean;
  humanReviewApproved: boolean;
  generalStoreImpact: boolean;
}

export interface PromotionGateResult {
  environment: CheckStatus;
  runtime: CheckStatus;
  data: CheckStatus;
  stability: CheckStatus;
  operations: CheckStatus;
  pass: boolean;
  blockingReasons: string[];
}

const allPass = (...s: CheckStatus[]): boolean => s.every((x) => x === 'pass');

export function evaluatePromotionGate(g: PromotionGateInput): PromotionGateResult {
  const reasons: string[] = [];

  const environment: CheckStatus = g.testDbIsolated && g.migrationOk && g.requiredRpcOk && g.rlsOk ? 'pass' : 'fail';
  if (environment !== 'pass') reasons.push('environment_not_ready');

  const runtimeChecks = [g.treatmentGatePass, g.queueContractPass, g.actualPlaybackPass, g.currentTrackNotForceStopped, g.controlFallbackPass, g.emergencyStopPass, g.storeResumePass];
  const runtime: CheckStatus = runtimeChecks.some((x) => x === 'fail') ? 'fail'
    : runtimeChecks.some((x) => x === 'not_run' || x === 'insufficient_data') ? 'not_run'
    : 'pass';
  if (runtime !== 'pass') reasons.push('runtime_not_proven');

  const dataChecks = [g.exposureCreationPass, g.attributionPass];
  const data: CheckStatus = (dataChecks.some((x) => x === 'fail') || !g.eventDeliveryWithinRange || g.variantDriftCount > 0 || g.invalidAttributionCount > 0) ? 'fail'
    : dataChecks.some((x) => x === 'not_run' || x === 'insufficient_data') ? 'not_run'
    : 'pass';
  if (data !== 'pass') reasons.push('data_linkage_not_proven');

  const stabilityBad = g.queueEmptyCount > 0 || g.playbackStartFailureCount > 0 || g.decoderErrorCount > 0
    || g.duplicatePlaybackCount > 0 || g.playerFreezeCount > 0 || g.blockingGuardrailCount > 0 || g.timeToFirstAudioSevereRegression;
  const stability: CheckStatus = stabilityBad ? 'fail' : (runtime === 'pass' ? 'pass' : 'not_run');
  if (stability !== 'pass') reasons.push('stability_not_proven');

  const operations: CheckStatus = g.generalStoreImpact ? 'fail'
    : (g.runbookComplete && g.stopProcedureComplete && g.controlRecoveryConfirmed && g.auditConfirmed && g.humanReviewApproved) ? 'pass'
    : 'not_run';
  if (operations !== 'pass') reasons.push('operations_incomplete');

  const pass = allPass(environment, runtime, data, stability, operations);
  return { environment, runtime, data, stability, operations, pass, blockingReasons: reasons };
}

/* ── Execution Decision ──────────────────────────────────────────────────── */
export interface ExecutionDecisionInput {
  readiness: { ready: boolean; blockers: string[] };
  promotion: PromotionGateResult;
  treatmentRuntimeRepeatedFailure: boolean;
  attributionReliable: boolean;
  fallbackRateExcessive: boolean;
  latencyExcessive: boolean;
  sampleSufficient: boolean;
  minDurationMet: boolean;
  multiSessionDeviceValidated: boolean;
  minorWarningsOnly: boolean;
}

export function deriveExecutionDecision(input: ExecutionDecisionInput): { decision: ExecutionDecision; reasons: string[] } {
  const reasons: string[] = [];

  // 1) 환경/게이트 하드 실패 → NO_GO.
  if (!input.readiness.ready) {
    reasons.push(`실행 전제 미충족: ${input.readiness.blockers.join(', ')} — 격리 Test/Preview DB·Migration·RPC 확보 전 실제 Treatment 실행 금지.`);
    return { decision: 'NO_GO', reasons };
  }
  if (input.promotion.environment === 'fail' || input.promotion.data === 'fail'
    || input.promotion.runtime === 'fail' || input.promotion.stability === 'fail' || input.promotion.operations === 'fail') {
    reasons.push(`Promotion Gate 하드 실패: ${input.promotion.blockingReasons.join(', ')}.`);
    return { decision: 'NO_GO', reasons };
  }

  // 2) Runtime 반복 실패/데이터 신뢰 부족/Fallback 과다/Latency 과다 → RETURN_TO_SHADOW.
  if (input.treatmentRuntimeRepeatedFailure || !input.attributionReliable || input.fallbackRateExcessive || input.latencyExcessive) {
    reasons.push('Queue/Player 는 안전하나 Treatment Runtime 반복 실패·Attribution 신뢰 부족·Fallback/Latency 과다 — Shadow 회귀로 안정성 재확인.');
    return { decision: 'RETURN_TO_SHADOW', reasons };
  }

  // 3) 핵심 Runtime 정상이나 Sample 부족/추가 관찰 필요.
  if (!input.sampleSufficient || !input.minDurationMet) {
    reasons.push('핵심 Runtime 은 정상이나 Sample/관찰 기간 부족 — 승자 선언 없이 내부 관찰 계속.');
    return { decision: 'CONTINUE_INTERNAL', reasons };
  }
  if (!input.multiSessionDeviceValidated) {
    reasons.push('안정성 양호 — 여러 Session/Browser/Device 검증과 추가 Sample 필요.');
    return { decision: 'EXTEND_INTERNAL', reasons };
  }

  // 4) 모든 Gate PASS + Human Review 승인 → CANARY_CANDIDATE(활성화 아님).
  if (input.promotion.pass) {
    reasons.push('Environment/Runtime/Data/Stability/Operations Gate 전부 PASS + Human Review 승인.');
    reasons.push('CANARY_CANDIDATE 는 외부 Canary 활성화가 아니다 — 다음 Phase 에서 Canary 실행을 검토할 수 있는 Human Review 상태일 뿐이다.');
    return { decision: 'CANARY_CANDIDATE', reasons };
  }
  reasons.push('일부 항목 미완(not_run) — 내부 관찰 계속.');
  return { decision: 'CONTINUE_INTERNAL', reasons };
}

/* ── Evidence / Test Session 모델 ────────────────────────────────────────── */
export type EvidenceType =
  | 'db_row' | 'rpc_response' | 'runtime_event' | 'browser_console' | 'network_request'
  | 'screenshot' | 'player_state' | 'queue_state' | 'exposure_row' | 'playback_event_row'
  | 'audit_event' | 'test_log' | 'none';

export interface ExecutionCheck {
  checkKey: string;
  category: 'environment' | 'runtime' | 'playback' | 'emergency' | 'data' | 'operations';
  status: CheckStatus;
  evidenceType: EvidenceType;
  evidenceSummary: string;
}

/** 증거 유형이 none/비어있으면 pass 로 승격 불가 — 증거 없는 항목은 not_run. */
export function normalizeCheck(c: ExecutionCheck): ExecutionCheck {
  if (c.status === 'pass' && (c.evidenceType === 'none' || c.evidenceSummary.trim() === '')) {
    return { ...c, status: 'not_run' };
  }
  return c;
}
