/**
 * experimentRuntimeRouting — Internal Treatment Routing & Guarded Validation
 * (Phase AI-EXPERIMENT-2, 순수 로직).
 *
 * 승인된 internal_test Store(최대 1~2곳)에 한해 Recommendation v2 결과를 기존
 * Queue 계약으로 변환하기 위한 결정/검증 로직. 모든 실패 경로는 Control 로 종료한다
 * (Internal Only / Fail Closed / Control Fallback / Observable / Reversible /
 * Human Controlled). 실제 Assignment/Gate 의 최종 진실은 서버(0570
 * experiment_treatment_gate / experiment_treatment_recommend)이며, 이 모듈은
 * 클라이언트 어댑터·검증·관측 판정만 담당한다(서버 판정을 신뢰).
 *
 * 이 모듈은 Recommendation v1/v2 점수식·Production Weight·Queue 계약·Player 상태
 * 머신을 변경하지 않는다. Global Rollout / Auto Canary / Auto Weight Apply /
 * Auto Rollback 은 함수 자체가 없다(BLOCKED 목록 고정).
 */

/* ── Runtime Route / Fallback ────────────────────────────────────────────── */
export type RuntimeRoute = 'control' | 'treatment' | 'shadow' | 'fallback_control';

export type RuntimeFallbackReason =
  | 'no_experiment'
  | 'experiment_not_running'
  | 'wrong_stage'
  | 'not_allowlisted'
  | 'control_assignment'
  | 'shadow_assignment'
  | 'emergency_stop'
  | 'store_stopped'
  | 'assignment_lookup_failed'
  | 'config_lookup_failed'
  | 'stale_assignment'
  | 'invalid_config'
  | 'treatment_timeout'
  | 'treatment_error'
  | 'candidate_pool_empty'
  | 'insufficient_candidates'
  | 'hard_gate_failed'
  | 'queue_adapter_failed'
  | 'response_contract_failed'
  | 'exposure_limit_reached'
  | 'guardrail_blocked';

/** 서버 gate reason → Runtime Fallback reason 정규화(미지의 값은 hard_gate_failed). */
export function normalizeGateReason(reason: string | null | undefined): RuntimeFallbackReason {
  switch (reason) {
    case 'no_running_assignment': return 'experiment_not_running';
    case 'control_assignment': return 'control_assignment';
    case 'shadow_assignment': return 'shadow_assignment';
    case 'not_treatment': return 'control_assignment';
    case 'wrong_stage': return 'wrong_stage';
    case 'emergency_stop': return 'emergency_stop';
    case 'not_allowlisted': return 'not_allowlisted';
    case 'store_stopped': return 'store_stopped';
    case 'invalid_config': return 'invalid_config';
    case 'auth_required': return 'assignment_lookup_failed';
    case 'candidate_pool_empty': return 'candidate_pool_empty';
    case 'insufficient_candidates': return 'insufficient_candidates';
    case null: case undefined: case '': return 'hard_gate_failed';
    default: return 'hard_gate_failed';
  }
}

/* ── Internal Scope 제한 ─────────────────────────────────────────────────── */
export const INTERNAL_STORE_LIMIT = 2;
export const MAX_CONCURRENT_INTERNAL_EXPERIMENTS = 1;
export const MAX_TREATMENT_ASSIGNMENTS = 2;

/* ── Timeout / Retry(권장값 — Playback 우선, 재시도 최소) ───────────────────── */
export const GATE_LOOKUP_TIMEOUT_MS = 500;
export const TREATMENT_TIMEOUT_MS = 2500;
export const TREATMENT_RETRY_MAX = 0;
export const QUEUE_TREATMENT_CAP = 50;

export const INTERNAL_RUNTIME_WARNING =
  '현재 Runtime Treatment는 승인된 내부 테스트 Store에만 적용됩니다. Canary 또는 일반 Production Store에는 적용되지 않습니다.';

/** 금지 액션 — 스펙 금지 기능과 1:1(자동 확대/적용/롤백은 함수 부재로도 이중 차단). */
export const BLOCKED_RUNTIME_ACTIONS = [
  'enable_canary',
  'apply_to_all_stores',
  'replace_recommendation_v1',
  'global_rollout',
  'apply_production_weight',
  'auto_expand_treatment',
  'auto_winner_apply',
  'auto_rollback_execute',
  'disable_recommendation_v1',
] as const;
export function isBlockedRuntimeAction(action: string): boolean {
  return (BLOCKED_RUNTIME_ACTIONS as readonly string[]).includes(action) || action.startsWith('automatic_');
}

/* ── Runtime Gate 판정(서버 gate 결과 → route) ──────────────────────────── */
export interface RuntimeGateInput {
  lookupFailed: boolean;
  eligible: boolean;
  reason: string | null;
  variant: string | null;
}

export function evaluateRuntimeGate(g: RuntimeGateInput): { route: RuntimeRoute; fallbackReason: RuntimeFallbackReason | null } {
  if (g.lookupFailed) return { route: 'fallback_control', fallbackReason: 'assignment_lookup_failed' };
  if (g.variant === 'shadow_treatment') return { route: 'fallback_control', fallbackReason: 'shadow_assignment' };
  if (!g.eligible) return { route: 'fallback_control', fallbackReason: normalizeGateReason(g.reason) };
  return { route: 'treatment', fallbackReason: null };
}

/* ── Queue Contract Adapter — v2 결과 → 기존 Queue Track 계약 ─────────────── */
export interface RuntimeQueueTrack {
  id: string;
  title: string;
  artist: string | null;
  genre: string | null;
  mood: string | null;
  audio_url: string;
  cover_url: string | null;
  duration: number | null;
  created_at: string;
  /** 실험 Metadata 는 Optional Nested — 기존 Player 는 요구하지 않는다. */
  experimentMeta?: ExperimentQueueMetadata;
}

export interface ExperimentQueueMetadata {
  experimentId: string;
  assignmentId: string;
  variant: 'treatment';
  algorithmVersion: string;
  weightVersion: string;
  recommendationRank: number;
  exposureKey: string;
}

export interface QueueAdapterContext {
  experimentId: string;
  assignmentId: string;
  algorithmVersion: string;
  weightVersion: string;
  currentTrackId: string | null;
  recentTrackIds: string[];
  targetCount: number;
}

export interface QueueAdapterResult {
  valid: boolean;
  tracks: RuntimeQueueTrack[];
  issues: string[];
  droppedCount: number;
}

const isNonEmpty = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0;

/**
 * v2 서버 결과(raw jsonb rows)를 Queue Track 으로 변환·검증한다.
 * 필수 필드(id/audio_url/title) 누락, 중복(자기/current/recent) 을 제거한다.
 * 유효 Track 이 0 이거나 target 미만이면 valid=false → 호출측은 Control 을 사용한다.
 * 부분 손상 Queue 를 재생하지 않는다(전부-또는-Control).
 */
export function adaptTreatmentQueue(
  rawTracks: Array<Record<string, unknown>>,
  ctx: QueueAdapterContext,
): QueueAdapterResult {
  const issues: string[] = [];
  const seen = new Set<string>();
  const recent = new Set([...(ctx.recentTrackIds ?? []), ...(ctx.currentTrackId ? [ctx.currentTrackId] : [])]);
  const out: RuntimeQueueTrack[] = [];
  let dropped = 0;

  for (const r of rawTracks) {
    const id = r.id;
    const audio = r.audio_url;
    const title = r.title;
    if (!isNonEmpty(id) || !isNonEmpty(audio) || !isNonEmpty(title)) {
      dropped += 1;
      if (!issues.includes('missing_required_field')) issues.push('missing_required_field');
      continue;
    }
    if (seen.has(id)) { dropped += 1; if (!issues.includes('duplicate_track')) issues.push('duplicate_track'); continue; }
    if (recent.has(id)) { dropped += 1; if (!issues.includes('recent_track_duplicate')) issues.push('recent_track_duplicate'); continue; }
    seen.add(id);
    out.push({
      id,
      title,
      artist: isNonEmpty(r.artist) ? (r.artist as string) : null,
      genre: isNonEmpty(r.genre) ? (r.genre as string) : null,
      mood: isNonEmpty(r.mood) ? (r.mood as string) : null,
      audio_url: audio,
      cover_url: isNonEmpty(r.cover_url) ? (r.cover_url as string) : null,
      duration: typeof r.duration === 'number' ? r.duration : null,
      created_at: isNonEmpty(r.created_at) ? (r.created_at as string) : new Date(0).toISOString(),
      experimentMeta: {
        experimentId: ctx.experimentId,
        assignmentId: ctx.assignmentId,
        variant: 'treatment',
        algorithmVersion: ctx.algorithmVersion,
        weightVersion: ctx.weightVersion,
        recommendationRank: out.length + 1,
        exposureKey: `t|${ctx.experimentId}|${id}|${out.length}`,
      },
    });
  }

  // 부분 손상 방지 — target 을 채우지 못하면 무효(Control 사용).
  if (out.length === 0) { issues.push('empty_after_validation'); return { valid: false, tracks: [], issues, droppedCount: dropped }; }
  if (out.length < ctx.targetCount) { issues.push('below_target_after_validation'); return { valid: false, tracks: out, issues, droppedCount: dropped }; }
  return { valid: true, tracks: out.slice(0, ctx.targetCount), issues, droppedCount: dropped };
}

/* ── Playback Attribution 검증 ───────────────────────────────────────────── */
export type AttributionStatus = 'attributed' | 'partially_attributed' | 'unattributed' | 'invalid' | 'ambiguous';

export interface AttributionInput {
  exposureStoreId: string | null;
  playbackStoreId: string | null;
  exposureTrackId: string | null;
  playbackTrackId: string | null;
  assignmentStoreId: string | null;
  variant: string | null;
  isShadow: boolean;
  experimentRunningAtEvent: boolean;
  exposureAt: number | null;
  playbackStartedAt: number | null;
  sessionMatch: boolean;
  algorithmVersionMatch: boolean;
  weightVersionMatch: boolean;
  exposureRecorded: boolean;
}

export function validateAttribution(a: AttributionInput): { status: AttributionStatus; reasons: string[] } {
  const reasons: string[] = [];
  // 정합성 위반 → invalid(Treatment 성공 Outcome 에 포함 금지).
  if (a.playbackStoreId && a.exposureStoreId && a.playbackStoreId !== a.exposureStoreId) reasons.push('store_mismatch');
  if (a.assignmentStoreId && a.playbackStoreId && a.assignmentStoreId !== a.playbackStoreId) reasons.push('assignment_store_mismatch');
  if (a.playbackTrackId && a.exposureTrackId && a.playbackTrackId !== a.exposureTrackId) reasons.push('track_mismatch');
  if (reasons.length) return { status: 'invalid', reasons };

  if (a.isShadow || a.variant !== 'treatment') { reasons.push('not_treatment_variant'); return { status: 'invalid', reasons }; }
  if (!a.experimentRunningAtEvent) { reasons.push('experiment_not_running_at_event'); return { status: 'invalid', reasons }; }

  // 시간 순서 위반 / 세션 불일치 → ambiguous.
  if (a.exposureAt != null && a.playbackStartedAt != null && a.playbackStartedAt < a.exposureAt) reasons.push('event_time_out_of_order');
  if (!a.sessionMatch) reasons.push('session_mismatch');
  if (reasons.length) return { status: 'ambiguous', reasons };

  // Exposure 미기록 또는 버전 불일치 → partial.
  if (!a.exposureRecorded) reasons.push('exposure_not_recorded');
  if (!a.algorithmVersionMatch) reasons.push('algorithm_version_mismatch');
  if (!a.weightVersionMatch) reasons.push('weight_version_mismatch');
  if (reasons.length) return { status: 'partially_attributed', reasons };

  return { status: 'attributed', reasons: [] };
}

/* ── Session Integrity — Variant Drift 감지 ─────────────────────────────── */
export function detectVariantDrift(sessionVariant: string | null, currentVariant: string | null): boolean {
  if (sessionVariant == null || currentVariant == null) return false;
  return sessionVariant !== currentVariant;
}

/* ── Experiment Quality(Internal) ────────────────────────────────────────── */
export interface InternalQualityInput {
  runtimeGateIntegrity: boolean;
  allowlistIntegrity: boolean;
  assignmentIntegrity: boolean;
  queueContractIntegrity: boolean;
  controlFallbackReliable: boolean;
  exposureCompleteness: number | null; // 0..1
  playbackAttributionRate: number | null; // 0..1
  sessionIntegrity: boolean;
  eventDeliveryRate: number | null; // 0..1
  sampleSufficient: boolean;
  guardrailCompliant: boolean;
  streamingStable: boolean;
  treatmentStable: boolean;
  generalStoreTreatment: boolean;
  variantDrift: boolean;
  hardPolicyViolation: boolean;
  algorithmVersionMixed: boolean;
  weightVersionMixed: boolean;
}

export interface InternalQualityResult {
  score: number | null;
  grade: 'A' | 'B' | 'C' | 'D' | 'insufficient_data' | 'invalid';
  invalidReasons: string[];
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function computeInternalQuality(input: InternalQualityInput): InternalQualityResult {
  const invalid: string[] = [];
  if (input.generalStoreTreatment) invalid.push('general_store_treatment');
  if (!input.allowlistIntegrity) invalid.push('allowlist_violation');
  if (input.variantDrift) invalid.push('variant_drift');
  if (!input.queueContractIntegrity) invalid.push('queue_contract_violation');
  if (input.hardPolicyViolation) invalid.push('hard_policy_violation');
  if (!input.controlFallbackReliable) invalid.push('control_fallback_unreliable');
  if (input.algorithmVersionMixed) invalid.push('algorithm_version_mixed');
  if (input.weightVersionMixed) invalid.push('weight_version_mixed');
  if (!input.assignmentIntegrity) invalid.push('assignment_integrity_failed');
  if (invalid.length) return { score: null, grade: 'invalid', invalidReasons: invalid };

  if (!input.sampleSufficient || input.playbackAttributionRate == null || input.exposureCompleteness == null) {
    return { score: null, grade: 'insufficient_data', invalidReasons: [] };
  }

  const parts = [
    (input.runtimeGateIntegrity ? 1 : 0) * 100 * 0.15,
    clamp01(input.exposureCompleteness) * 100 * 0.15,
    clamp01(input.playbackAttributionRate) * 100 * 0.2,
    (input.sessionIntegrity ? 1 : 0) * 100 * 0.1,
    clamp01(input.eventDeliveryRate ?? 0) * 100 * 0.1,
    (input.guardrailCompliant ? 1 : 0) * 100 * 0.15,
    (input.streamingStable ? 1 : 0) * 100 * 0.075,
    (input.treatmentStable ? 1 : 0) * 100 * 0.075,
  ];
  const score = Math.round(parts.reduce((s, v) => s + v, 0) * 100) / 100;
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : 'D';
  return { score, grade, invalidReasons: [] };
}

/* ── Decision Proposal(Internal) — 자동 실행 없음 ────────────────────────── */
export type InternalDecision =
  | 'continue_internal' | 'pause' | 'stop' | 'extend_internal'
  | 'return_to_shadow' | 'canary_candidate' | 'insufficient_data';

export interface InternalDecisionInput {
  quality: InternalQualityResult;
  blockingGuardrail: boolean;
  srmDetected: boolean;
  sampleSufficient: boolean;
  minDurationMet: boolean;
  playbackStable: boolean;
  queueStable: boolean;
  fallbackRate: number | null;
  primaryImproved: boolean; // 유의미 개선(하위 통계 계층 판정)
  primaryRegressed: boolean; // 유의미 악화
}

export function deriveInternalDecision(input: InternalDecisionInput): { decision: InternalDecision; reasons: string[] } {
  const reasons: string[] = [];
  if (input.blockingGuardrail) {
    reasons.push('Blocking Guardrail 발생 — 성과와 무관하게 Pause 제안(자동 Rollback 없음).');
    return { decision: 'pause', reasons };
  }
  if (input.srmDetected) {
    reasons.push('SRM 감지 — 결과 신뢰 불가, 결론 보류.');
    return { decision: 'pause', reasons };
  }
  if (input.quality.grade === 'invalid') {
    reasons.push('실험 무효(일반 Store Treatment/Drift/Queue 계약 위반 등) — 중단 검토.');
    return { decision: 'stop', reasons };
  }
  if (!input.playbackStable || !input.queueStable) {
    reasons.push('Playback/Queue 불안정 — Shadow 로 회귀하여 안정성 재확인.');
    return { decision: 'return_to_shadow', reasons };
  }
  if ((input.fallbackRate ?? 0) > 0.5) {
    reasons.push('Treatment Fallback 과다 — Runtime 안정화 후 재개(Shadow 회귀 검토).');
    return { decision: 'return_to_shadow', reasons };
  }
  if (!input.sampleSufficient || input.quality.grade === 'insufficient_data') {
    reasons.push('표본 부족 — 승자 선언 없이 관찰(기간 미달 시 연장).');
    return { decision: input.minDurationMet ? 'insufficient_data' : 'extend_internal', reasons };
  }
  if (input.primaryRegressed) {
    reasons.push('Primary Metric 유의미 악화 — 중단 검토.');
    return { decision: 'stop', reasons };
  }
  if (input.primaryImproved && input.minDurationMet) {
    reasons.push('내부 테스트 안정 + 유의미 개선 — canary_candidate.');
    reasons.push('canary_candidate 는 Canary Phase 검토 후보일 뿐 실제 Canary 활성화가 아니다(별도 Phase).');
    return { decision: 'canary_candidate', reasons };
  }
  reasons.push('안정적이나 유의미한 차이 없음 — 내부 테스트 계속 관찰.');
  return { decision: 'continue_internal', reasons };
}

/* ── Go / No-Go Checklist ────────────────────────────────────────────────── */
export interface GoNoGoInput {
  internalStoreOnly: boolean;
  allowlistConfirmed: boolean;
  treatmentAssignmentConfirmed: boolean;
  emergencyStopTested: boolean;
  controlFallbackTested: boolean;
  queueContractTested: boolean;
  playerRegressionFree: boolean;
  candidatePoolAvailable: boolean;
  hardGatePass: boolean;
  exposureCreationConfirmed: boolean;
  attributionConfirmed: boolean;
  noBlockingGuardrail: boolean;
  sessionVariantIntegrity: boolean;
  migrationAndRpcApplied: boolean;
}

export function evaluateGoNoGo(c: GoNoGoInput): { go: boolean; blockers: string[] } {
  const blockers: string[] = [];
  if (!c.internalStoreOnly) blockers.push('general_store_included');
  if (!c.allowlistConfirmed) blockers.push('allowlist_not_confirmed');
  if (!c.treatmentAssignmentConfirmed) blockers.push('assignment_not_confirmed');
  if (!c.emergencyStopTested) blockers.push('emergency_stop_untested');
  if (!c.controlFallbackTested) blockers.push('control_fallback_untested');
  if (!c.queueContractTested) blockers.push('queue_contract_untested');
  if (!c.playerRegressionFree) blockers.push('player_regression');
  if (!c.candidatePoolAvailable) blockers.push('candidate_pool_unavailable');
  if (!c.hardGatePass) blockers.push('hard_gate_failed');
  if (!c.exposureCreationConfirmed) blockers.push('exposure_creation_unconfirmed');
  if (!c.attributionConfirmed) blockers.push('attribution_unconfirmed');
  if (!c.noBlockingGuardrail) blockers.push('blocking_guardrail_present');
  if (!c.sessionVariantIntegrity) blockers.push('session_variant_integrity_failed');
  if (!c.migrationAndRpcApplied) blockers.push('migration_or_rpc_not_applied');
  return { go: blockers.length === 0, blockers };
}
