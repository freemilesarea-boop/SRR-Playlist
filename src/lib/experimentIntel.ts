/**
 * experimentIntel — Controlled A/B Test, Canary Validation & Safe Event Emission
 * (Phase AI-EXPERIMENT-1).
 *
 * Allowlist / Deterministic / Measurable / Reversible / Guarded / Human-Controlled.
 * Global Rollout·v1 교체·Production Weight Apply·자동 Rollback 은 함수 자체가 없다
 * (BLOCKED 목록으로 고정). Guardrail 은 성과보다 우선하며, SRM/Blocking Breach
 * 상태에서는 continue/promote 결정을 생성하지 않는다.
 *
 * Assignment 의 최종 진실은 서버(0569 _ai_exp_variant, md5 bucket + sticky 저장)다.
 * 이 모듈의 bucket 함수는 preview/테스트용 결정론 검증이며(fnv-1a), 저장된 서버
 * 배정이 항상 우선한다(sticky). 외부 LLM 은 Assignment/승자 결정에 사용하지 않는다.
 */

/* ── Domain 타입 ─────────────────────────────────────────────────────── */
export type ExperimentStage = 'event_emission_only' | 'shadow_assignment' | 'internal_test' | 'canary' | 'limited';
export type ExperimentStatus =
  | 'draft' | 'ready_for_review' | 'approved' | 'scheduled' | 'running'
  | 'paused' | 'stopped' | 'completed' | 'rejected' | 'archived';
export type ExperimentVariant = 'control' | 'treatment' | 'shadow_treatment';
export type AssignmentStatus = 'assigned' | 'excluded' | 'ineligible' | 'overridden' | 'expired';
export type ExperimentDecision = 'continue' | 'pause' | 'stop' | 'extend' | 'promote_candidate' | 'insufficient_data';
export type GuardrailStatus = 'pass' | 'warning' | 'breach' | 'insufficient_data' | 'not_applicable';

export const FIXED_EXPERIMENT_WARNING =
  '이 실험은 허용된 Store에만 적용됩니다. 실험 승인 또는 성공 판정은 Recommendation v2의 전체 Production 적용을 의미하지 않습니다.';

export const BLOCKED_EXPERIMENT_ACTIONS = [
  'global_rollout',
  'apply_to_all_stores',
  'replace_recommendation_v1',
  'apply_weight_to_production',
  'auto_expand',
  'auto_rollback_execute',
  'auto_treatment_ratio_increase',
  'auto_store_enrollment',
] as const;
export function isBlockedExperimentAction(action: string): boolean {
  return (BLOCKED_EXPERIMENT_ACTIONS as readonly string[]).includes(action) || action.startsWith('automatic_');
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/* ── Deterministic Assignment(preview 용 — 서버 md5 가 최종) ─────────────── */
export function assignmentBucket(experimentId: string, storeId: string, seed: number, version: string): number {
  const s = `${experimentId}|${storeId}|${seed}|${version}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0; }
  return h % 10000;
}

export function previewVariant(
  experimentId: string, storeId: string, seed: number, version: string,
  allocationRatio: number, stage: ExperimentStage,
): ExperimentVariant {
  const treated = assignmentBucket(experimentId, storeId, seed, version) < allocationRatio * 10000;
  if (!treated) return 'control';
  if (stage === 'shadow_assignment') return 'shadow_treatment';
  if (stage === 'event_emission_only') return 'control'; // Stage 0 은 Treatment 없음.
  return 'treatment';
}

/* ── Store Eligibility(자동 완화 없음) ───────────────────────────────── */
export interface StoreEligibilityInput {
  storeId: string | null;
  active: boolean;
  recentPlaybackCount: number;
  recentCriticalIncidents: number;
  sessionStable: boolean;
  policyAllowsExperiment: boolean | null; // null = 미확인
  inAllowlist: boolean;
  explicitlyExcluded: boolean;
  emergencyExcluded: boolean;
  inConflictingExperiment: boolean;
}

export function evaluateStoreEligibility(s: StoreEligibilityInput): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!s.storeId) reasons.push('missing_store_id');
  if (!s.active) reasons.push('store_inactive');
  if (s.recentPlaybackCount < 10) reasons.push('insufficient_recent_playback');
  if (s.recentCriticalIncidents > 0) reasons.push('recent_player_incident');
  if (!s.sessionStable) reasons.push('unstable_session');
  if (s.policyAllowsExperiment !== true) reasons.push(s.policyAllowsExperiment == null ? 'policy_unverified' : 'policy_disallows');
  if (!s.inAllowlist) reasons.push('not_in_allowlist');
  if (s.explicitlyExcluded) reasons.push('explicitly_excluded');
  if (s.emergencyExcluded) reasons.push('emergency_excluded');
  if (s.inConflictingExperiment) reasons.push('conflicting_experiment');
  return { eligible: reasons.length === 0, reasons };
}

/* ── Treatment Fallback 규칙(Runtime 안전 조건) — 항상 Control ───────────── */
export interface FallbackContext {
  experimentRunning: boolean;
  storeAllowlisted: boolean;
  hasTreatmentAssignment: boolean;
  stageAtLeastInternalTest: boolean;
  emergencyStop: boolean;
  guardrailBreach: boolean;
  configValid: boolean;
  candidatePoolValid: boolean;
  hardGatePassed: boolean;
  recommendationAvailable: boolean;
  timedOut: boolean;
  lookupFailed: boolean;
}

export function shouldFallbackToControl(ctx: FallbackContext): { fallback: boolean; reason: string | null } {
  if (ctx.lookupFailed) return { fallback: true, reason: 'assignment_lookup_failed' };
  if (!ctx.experimentRunning) return { fallback: true, reason: 'experiment_not_running' };
  if (!ctx.storeAllowlisted) return { fallback: true, reason: 'not_allowlisted' };
  if (!ctx.hasTreatmentAssignment) return { fallback: true, reason: 'no_treatment_assignment' };
  if (!ctx.stageAtLeastInternalTest) return { fallback: true, reason: 'stage_below_internal_test' };
  if (ctx.emergencyStop) return { fallback: true, reason: 'emergency_stop' };
  if (ctx.guardrailBreach) return { fallback: true, reason: 'guardrail_breach' };
  if (!ctx.configValid) return { fallback: true, reason: 'config_invalid' };
  if (!ctx.candidatePoolValid) return { fallback: true, reason: 'candidate_pool_invalid' };
  if (!ctx.hardGatePassed) return { fallback: true, reason: 'hard_gate_failed' };
  if (!ctx.recommendationAvailable) return { fallback: true, reason: 'no_recommendation_result' };
  if (ctx.timedOut) return { fallback: true, reason: 'treatment_timeout' };
  return { fallback: false, reason: null };
}

/* ── SRM(Sample Ratio Mismatch) — χ² 1df, 임계 3.84(p<0.05) ─────────────── */
export const SRM_MIN_SAMPLE = 100;
export const SRM_CHI_SQUARE_THRESHOLD = 3.84;

export interface SrmResult {
  srmDetected: boolean;
  chiSquare: number | null;
  expectedRatio: number;
  observedRatio: number | null;
  sample: number;
  status: 'ok' | 'srm_detected' | 'insufficient_data';
}

export function checkSrm(controlCount: number, treatmentCount: number, expectedTreatmentRatio: number): SrmResult {
  const n = controlCount + treatmentCount;
  if (n < SRM_MIN_SAMPLE) {
    return { srmDetected: false, chiSquare: null, expectedRatio: expectedTreatmentRatio, observedRatio: n > 0 ? round3(treatmentCount / n) : null, sample: n, status: 'insufficient_data' };
  }
  const expT = n * expectedTreatmentRatio;
  const expC = n * (1 - expectedTreatmentRatio);
  const chi = ((treatmentCount - expT) ** 2) / expT + ((controlCount - expC) ** 2) / expC;
  const detected = chi > SRM_CHI_SQUARE_THRESHOLD;
  return {
    srmDetected: detected, chiSquare: round3(chi), expectedRatio: expectedTreatmentRatio,
    observedRatio: round3(treatmentCount / n), sample: n,
    status: detected ? 'srm_detected' : 'ok',
  };
}

/* ── Metric 분석(two-proportion, 95% CI) — 유의성 없이는 승자 없음 ────────── */
export interface ExperimentMetricResult {
  metric: string;
  controlValue: number | null;
  treatmentValue: number | null;
  absoluteDelta: number | null;
  relativeDelta: number | null;
  confidenceInterval: { lower: number | null; upper: number | null };
  significant: boolean;
  sampleSizeControl: number;
  sampleSizeTreatment: number;
  status: GuardrailStatus;
  insufficientData: string[];
}

export const METRIC_MIN_SAMPLE_PER_ARM = 30;

export function analyzeRateMetric(
  metric: string,
  control: { successes: number; total: number },
  treatment: { successes: number; total: number },
): ExperimentMetricResult {
  const insufficient: string[] = [];
  if (control.total < METRIC_MIN_SAMPLE_PER_ARM) insufficient.push('control_sample_below_min');
  if (treatment.total < METRIC_MIN_SAMPLE_PER_ARM) insufficient.push('treatment_sample_below_min');
  const pC = control.total > 0 ? control.successes / control.total : null;
  const pT = treatment.total > 0 ? treatment.successes / treatment.total : null;
  if (pC == null || pT == null || insufficient.length) {
    return {
      metric, controlValue: pC == null ? null : round3(pC), treatmentValue: pT == null ? null : round3(pT),
      absoluteDelta: null, relativeDelta: null, confidenceInterval: { lower: null, upper: null },
      significant: false, sampleSizeControl: control.total, sampleSizeTreatment: treatment.total,
      status: 'insufficient_data', insufficientData: insufficient,
    };
  }
  const delta = pT - pC;
  const se = Math.sqrt((pC * (1 - pC)) / control.total + (pT * (1 - pT)) / treatment.total);
  const lower = delta - 1.96 * se;
  const upper = delta + 1.96 * se;
  const significant = lower > 0 || upper < 0; // CI 가 0 을 포함하지 않을 때만.
  return {
    metric, controlValue: round3(pC), treatmentValue: round3(pT),
    absoluteDelta: round3(delta), relativeDelta: pC > 0 ? round3(delta / pC) : null,
    confidenceInterval: { lower: round3(lower), upper: round3(upper) },
    significant,
    sampleSizeControl: control.total, sampleSizeTreatment: treatment.total,
    status: 'pass', insufficientData: [],
  };
}

/* ── Guardrail Engine — 성과보다 우선. 자동 Rollback 없음(Proposal 만). ───── */
export interface GuardrailCheckInput {
  name: string;
  kind: 'blocking' | 'warning';
  controlValue: number | null;
  treatmentValue: number | null;
  /** 절대 임계(초과 시 위반). null 이면 delta 기준. */
  absoluteMax?: number | null;
  /** treatment−control 악화 허용 한도(방향: higherIsWorse=true 면 증가가 악화). */
  maxDegradation?: number | null;
  higherIsWorse: boolean;
}

export interface GuardrailResult { name: string; kind: 'blocking' | 'warning'; status: GuardrailStatus; detail: string }

export function evaluateGuardrail(g: GuardrailCheckInput): GuardrailResult {
  if (g.treatmentValue == null || (g.maxDegradation != null && g.controlValue == null)) {
    return { name: g.name, kind: g.kind, status: 'insufficient_data', detail: '측정값 부족' };
  }
  let violated: boolean;
  let detail: string;
  if (g.absoluteMax != null) {
    violated = g.higherIsWorse ? g.treatmentValue > g.absoluteMax : g.treatmentValue < g.absoluteMax;
    detail = `treatment ${g.treatmentValue} vs 한계 ${g.absoluteMax}`;
  } else if (g.maxDegradation != null && g.controlValue != null) {
    const delta = g.higherIsWorse ? g.treatmentValue - g.controlValue : g.controlValue - g.treatmentValue;
    violated = delta > g.maxDegradation;
    detail = `악화 ${round3(delta)} vs 허용 ${g.maxDegradation}`;
  } else {
    return { name: g.name, kind: g.kind, status: 'not_applicable', detail: '임계 미설정' };
  }
  if (!violated) return { name: g.name, kind: g.kind, status: 'pass', detail };
  return { name: g.name, kind: g.kind, status: g.kind === 'blocking' ? 'breach' : 'warning', detail };
}

/* ── Experiment Quality ─────────────────────────────────────────────── */
export interface ExperimentQualityInput {
  assignmentIntegrity: boolean;
  attributionRate: number | null;
  eventLossRate: number | null;
  srm: SrmResult;
  sampleSufficient: boolean;
  durationHoursMet: boolean;
  guardrails: GuardrailResult[];
  fallbackRate: number | null;
  configChangedMidRun: boolean;
  versionMixed: boolean;
  leakageDetected: boolean;
}

export interface ExperimentQualityResult {
  score: number | null;
  grade: 'A' | 'B' | 'C' | 'D' | 'insufficient_data' | 'invalid';
  approvalBlockers: string[];
}

export function computeExperimentQuality(input: ExperimentQualityInput): ExperimentQualityResult {
  const blockers: string[] = [];
  const breaches = input.guardrails.filter((g) => g.status === 'breach');
  if (input.srm.status === 'srm_detected') blockers.push('srm_detected');
  if (breaches.length) blockers.push('blocking_guardrail_breach');
  if ((input.attributionRate ?? 0) < 0.6) blockers.push('attribution_rate_below_threshold');
  if ((input.eventLossRate ?? 1) > 0.1) blockers.push('event_loss_excessive');
  if (!input.sampleSufficient) blockers.push('sample_insufficient');
  if (!input.durationHoursMet) blockers.push('duration_insufficient');
  if (input.configChangedMidRun) blockers.push('config_changed_mid_run');
  if (input.versionMixed) blockers.push('version_mixed');
  if ((input.fallbackRate ?? 0) > 0.2) blockers.push('treatment_fallback_excessive');
  if (input.leakageDetected) blockers.push('dataset_leakage');
  if (!input.assignmentIntegrity) blockers.push('assignment_integrity_failed');

  if (input.configChangedMidRun || input.versionMixed || !input.assignmentIntegrity || input.leakageDetected) {
    return { score: null, grade: 'invalid', approvalBlockers: blockers };
  }
  if (!input.sampleSufficient || input.attributionRate == null || input.srm.status === 'insufficient_data') {
    return { score: null, grade: 'insufficient_data', approvalBlockers: blockers };
  }
  const parts = [
    (input.attributionRate ?? 0) * 100 * 0.25,
    (1 - Math.min(1, input.eventLossRate ?? 0)) * 100 * 0.15,
    (input.srm.status === 'ok' ? 100 : 0) * 0.2,
    (breaches.length === 0 ? 100 : 0) * 0.2,
    (1 - Math.min(1, input.fallbackRate ?? 0)) * 100 * 0.1,
    (input.durationHoursMet ? 100 : 0) * 0.1,
  ];
  const score = round2(parts.reduce((s, v) => s + v, 0));
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : 'D';
  return { score, grade, approvalBlockers: blockers };
}

/* ── Decision Proposal(자동 실행 없음 — 사람 검토) ───────────────────────── */
export function deriveDecision(input: {
  quality: ExperimentQualityResult;
  primary: ExperimentMetricResult;
  srm: SrmResult;
  guardrails: GuardrailResult[];
  minDurationMet: boolean;
}): { decision: ExperimentDecision; reasons: string[] } {
  const reasons: string[] = [];
  const breaches = input.guardrails.filter((g) => g.status === 'breach');
  if (breaches.length) {
    reasons.push(`Blocking Guardrail 위반: ${breaches.map((b) => b.name).join(', ')} — 성과와 무관하게 중단 검토.`);
    return { decision: breaches.length > 1 ? 'stop' : 'pause', reasons };
  }
  if (input.srm.status === 'srm_detected') {
    reasons.push(`SRM 감지(χ²=${input.srm.chiSquare}) — 결과 신뢰 불가, 원인 분석 필요.`);
    return { decision: 'pause', reasons };
  }
  if (input.quality.grade === 'invalid') {
    reasons.push('실험 무효(설정 변경/버전 혼합/무결성 실패) — 중단 검토.');
    return { decision: 'stop', reasons };
  }
  if (input.primary.status === 'insufficient_data' || input.quality.grade === 'insufficient_data' || !input.minDurationMet) {
    reasons.push('Sample/기간 부족 — 승자 선언 없이 관찰 연장.');
    return { decision: input.minDurationMet ? 'insufficient_data' : 'extend', reasons };
  }
  if (input.primary.significant && (input.primary.absoluteDelta ?? 0) > 0 && input.quality.approvalBlockers.length === 0) {
    reasons.push(`Primary Metric 유의미 개선(Δ=${input.primary.absoluteDelta}, CI [${input.primary.confidenceInterval.lower}, ${input.primary.confidenceInterval.upper}]).`);
    reasons.push('promote_candidate 는 다음 단계의 더 제한된 Canary/Limited 후보이며 Global Rollout 이 아니다.');
    return { decision: 'promote_candidate', reasons };
  }
  if (input.primary.significant && (input.primary.absoluteDelta ?? 0) < 0) {
    reasons.push(`Primary Metric 유의미 악화(Δ=${input.primary.absoluteDelta}) — 중단 검토.`);
    return { decision: 'stop', reasons };
  }
  reasons.push('유의미한 차이 없음 — 계속 관찰. 반복 중간 분석은 False Positive 위험이 있음을 고지.');
  return { decision: 'continue', reasons };
}

/* ── Exposure Lifecycle 검증 ─────────────────────────────────────────── */
export const EXPOSURE_LIFECYCLE = [
  'candidate_generated', 'recommendation_exposed', 'recommendation_selected',
  'track_queued', 'playback_started', 'playback_outcome',
] as const;

export function isLifecycleTransitionValid(from: string, to: string): boolean {
  const order = EXPOSURE_LIFECYCLE as readonly string[];
  const i = order.indexOf(from);
  const j = order.indexOf(to);
  return i >= 0 && j >= 0 && j > i;
}

/** Shadow 는 candidate_generated/recommendation_exposed 까지만 허용. */
export function isShadowStageAllowed(lifecycle: string): boolean {
  return lifecycle === 'candidate_generated' || lifecycle === 'recommendation_exposed';
}
