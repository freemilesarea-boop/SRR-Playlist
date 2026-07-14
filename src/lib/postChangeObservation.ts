/**
 * postChangeObservation — Post-Change Observation, Validation, Rollback Governance &
 * Operational Certification 순수 로직 (Phase AI-OPS-3).
 *
 * AI-OPS-2 에서 completed_reference 에 도달한 Execution Plan 이 **외부에서 사람에 의해
 * 실행된 뒤**, 그 결과를 Baseline 대비 실측 KPI 로 관측·검증·판정하는 계산 계층.
 *
 * 원칙: 실행/Rollback 엔진 아님(권고만) · Baseline 필수 · Actual/Simulated 분리 ·
 *       Baseline 0 나눗셈 금지(relative_delta=null) · null→0 변환 금지 · 자동 Rollback/
 *       Certification 없음 · Rollback Reference 후 재검증 필수 · deterministic · Date 주입.
 */
import { isFiniteNumber, clampScore, normalizeAvailableComponents } from './aiMemory';
import { detectVersionMismatch } from './executionReadiness';

export { isFiniteNumber, clampScore, normalizeAvailableComponents, detectVersionMismatch };

export const PCO_SOURCE_VERSION = 'postchange_v1(0506)';

/* ── Observation Status(Production 작업 상태 표현 금지) ─────────────────── */
export type ObservationStatus = 'draft' | 'pending_observation' | 'observing' | 'data_delayed' | 'review_required' | 'completed' | 'failed_validation' | 'rollback_review' | 'certified' | 'certified_with_conditions' | 'rejected' | 'cancelled' | 'expired' | 'invalidated';
export const OBSERVATION_STATUSES: ObservationStatus[] = ['draft', 'pending_observation', 'observing', 'data_delayed', 'review_required', 'completed', 'failed_validation', 'rollback_review', 'certified', 'certified_with_conditions', 'rejected', 'cancelled', 'expired', 'invalidated'];
export const FORBIDDEN_OBSERVATION_STATUSES = ['executing', 'deploying', 'applying', 'rolling_back', 'production_running', 'auto_recovered'];

/* ── KPI Catalog(실측 가능한 것만 supported — playback_events_v2 기반) ──── */
export type MetricCode = 'player_error_rate' | 'skip_rate' | 'completion_rate' | 'like_rate' | 'events' | 'playback_start_success';
export type MetricDirection = 'lower_is_better' | 'higher_is_better' | 'neutral';
export const SUPPORTED_METRICS: Array<{ code: MetricCode; label: string; direction: MetricDirection; defaultRole: MetricRole; note: string }> = [
  { code: 'completion_rate', label: 'Completion Rate', direction: 'higher_is_better', defaultRole: 'primary', note: 'play_complete / (complete+skip)' },
  { code: 'skip_rate', label: 'Skip Rate', direction: 'lower_is_better', defaultRole: 'primary', note: 'skip / (complete+skip)' },
  { code: 'player_error_rate', label: 'Player Error Rate', direction: 'lower_is_better', defaultRole: 'guardrail', note: 'player_error / 전체 이벤트' },
  { code: 'like_rate', label: 'Like Rate', direction: 'higher_is_better', defaultRole: 'diagnostic', note: 'like / 전체 이벤트' },
  { code: 'playback_start_success', label: 'Playback Start Success', direction: 'higher_is_better', defaultRole: 'guardrail', note: 'play_start − player_error 비율(proxy)' },
  { code: 'events', label: 'Event Volume', direction: 'neutral', defaultRole: 'informational', note: 'Sample 규모 진단용' },
];
export const UNSUPPORTED_METRICS: Array<{ code: string; group: string; note: string }> = [
  { code: 'transition_failure_rate', group: 'playback', note: 'transition telemetry 미수집' },
  { code: 'streaming_quality_score', group: 'streaming', note: 'streaming quality telemetry 미수집' },
  { code: 'buffering_rate', group: 'streaming', note: 'buffer telemetry 미수집' },
  { code: 'stall_rate', group: 'streaming', note: 'stall telemetry 미수집' },
  { code: 'time_to_first_audio', group: 'streaming', note: 'TTFA telemetry 미수집' },
  { code: 'decoder_error_rate', group: 'streaming', note: 'decoder telemetry 미수집' },
  { code: 'queue_depth', group: 'queue', note: 'queue telemetry 미수집' },
  { code: 'queue_stall_rate', group: 'queue', note: 'queue telemetry 미수집' },
  { code: 'scheduler_drift', group: 'scheduler', note: 'scheduler telemetry 미수집' },
  { code: 'schedule_miss_rate', group: 'scheduler', note: 'scheduler telemetry 미수집' },
  { code: 'repetition_rate', group: 'playlist', note: 'runtime rotation telemetry 미수집' },
  { code: 'diversity_score', group: 'playlist', note: 'runtime rotation telemetry 미수집' },
  { code: 'dislike_rate', group: 'business', note: 'dislike 이벤트 미수집' },
  { code: 'session_duration', group: 'business', note: 'session telemetry 미수집' },
  { code: 'revenue_impact', group: 'business', note: '매출-재생 직접 연결 계수 미지원' },
  { code: 'store_satisfaction_proxy', group: 'business', note: '만족도 지표 미수집' },
];
export const isSupportedMetric = (code: string): code is MetricCode => SUPPORTED_METRICS.some((m) => m.code === code);

/* ── Observation Eligibility ────────────────────────────────────────────── */
export type ObservationEligibility = 'eligible' | 'pending_execution_reference' | 'missing_observation_plan' | 'missing_baseline' | 'missing_monitoring_source' | 'version_mismatch' | 'duplicate' | 'expired' | 'blocked' | 'unsupported' | 'insufficient_data';
export interface ManualReferenceLike { external_change_id?: unknown; executed_by?: unknown; executed_at?: unknown; execution_result?: unknown }
export interface ObsEligibilityInput {
  planStatus: string;
  manualReference: ManualReferenceLike | null;
  observationPlan: { kpis?: unknown; monitoring_source?: unknown; owner?: unknown; success?: unknown; failure?: unknown } | null;
  baselinePresent: boolean;
  sourceVersionMatch: boolean;
  inputHashMatch: boolean;
  duplicateObservation: boolean;
  planExpired: boolean;
  hasIdempotencyKey: boolean;
}
export function validateObservationEligibility(inp: ObsEligibilityInput): { status: ObservationEligibility; reasons: string[] } {
  if (inp.duplicateObservation) return { status: 'duplicate', reasons: ['이미 Observation 존재'] };
  if (inp.planExpired) return { status: 'expired', reasons: ['plan expired'] };
  if (inp.planStatus !== 'completed_reference') {
    if (inp.planStatus === 'ready_for_manual_execution') return { status: 'pending_execution_reference', reasons: ['외부 실행 Reference 대기'] };
    return { status: 'blocked', reasons: [`plan status=${inp.planStatus} — completed_reference 필요`] };
  }
  const mr = inp.manualReference;
  const mrMissing = !mr || ['external_change_id', 'executed_by', 'executed_at', 'execution_result'].filter((k) => !(mr as Record<string, unknown>)[k]);
  if (mrMissing === true || (Array.isArray(mrMissing) && mrMissing.length > 0)) return { status: 'pending_execution_reference', reasons: [`manual reference 불완전: ${Array.isArray(mrMissing) ? mrMissing.join(',') : '없음'}`] };
  const plan = inp.observationPlan;
  const kpis = Array.isArray(plan?.kpis) ? (plan!.kpis as unknown[]).filter((k): k is string => typeof k === 'string') : [];
  if (!plan || kpis.length === 0) return { status: 'missing_observation_plan', reasons: ['observation plan/KPI 없음'] };
  const unsupported = kpis.filter((k) => !isSupportedMetric(k));
  if (unsupported.length > 0) return { status: 'unsupported', reasons: [`미지원 KPI: ${unsupported.join(',')}`] };
  if (!plan.monitoring_source) return { status: 'missing_monitoring_source', reasons: ['monitoring source 없음'] };
  if (!inp.baselinePresent) return { status: 'missing_baseline', reasons: ['baseline 없음 — 필수'] };
  if (!inp.sourceVersionMatch || !inp.inputHashMatch) return { status: 'version_mismatch', reasons: ['version/hash 불일치'] };
  if (!inp.hasIdempotencyKey) return { status: 'blocked', reasons: ['idempotency key 없음'] };
  return { status: 'eligible', reasons: [] };
}

/* ── Observation Window & Minimum Policy ────────────────────────────────── */
export const OBSERVATION_WINDOW_HOURS = [0.25, 0.5, 1, 3, 6, 12, 24, 72, 168] as const;
export type RiskTier = 'low' | 'medium' | 'high' | 'critical';
export const MIN_OBSERVATION_POLICY: Record<RiskTier, { minHours: number; minEvents: number; extraReview: boolean; certifiable: boolean }> = {
  low: { minHours: 0.5, minEvents: 50, extraReview: false, certifiable: true },
  medium: { minHours: 3, minEvents: 200, extraReview: false, certifiable: true },
  high: { minHours: 24, minEvents: 1000, extraReview: true, certifiable: true },
  critical: { minHours: 0, minEvents: 0, extraReview: true, certifiable: false }, // 인증 불가 — 사전 차단 대상
};
export function validateObservationWindow(hours: number, risk: RiskTier): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isFiniteNumber(hours) || !OBSERVATION_WINDOW_HOURS.includes(hours as (typeof OBSERVATION_WINDOW_HOURS)[number])) errors.push(`지원하지 않는 window(${hours}h)`);
  const policy = MIN_OBSERVATION_POLICY[risk];
  if (!policy.certifiable) errors.push('critical risk — 인증 불가(Observation 전에 차단되었어야 함 → failed_validation/rollback_review)');
  else if (isFiniteNumber(hours) && hours < policy.minHours) errors.push(`${risk} risk 최소 관측 ${policy.minHours}h 미충족`);
  return { valid: errors.length === 0, errors };
}

/* ── Baseline / Target ──────────────────────────────────────────────────── */
export interface BaselineMetricLike { metric_code?: unknown; value?: unknown; sample_size?: unknown; source?: unknown }
export function validateBaseline(b: BaselineMetricLike | null): string[] {
  if (!b) return ['baseline 없음 — 모든 Observation 은 baseline 필수'];
  const errors: string[] = [];
  if (typeof b.metric_code !== 'string' || !isSupportedMetric(b.metric_code)) errors.push('metric_code 미지원 또는 없음');
  if (b.value === null || b.value === undefined) errors.push('baseline 값 없음(null→0 변환 금지)');
  else if (!isFiniteNumber(b.value)) errors.push('baseline 값 NaN/Infinity');
  if (!isFiniteNumber(b.sample_size) || (b.sample_size as number) < 1) errors.push('baseline sample 부족');
  if (!b.source) errors.push('baseline source 없음');
  return errors;
}
export type ExpectedDirection = 'increase' | 'decrease' | 'maintain';
export interface TargetSpecLike { expected_direction?: unknown; target_value?: unknown; warning_threshold?: unknown; failure_threshold?: unknown; minimum_sample?: unknown }
export function validateTarget(t: TargetSpecLike | null): { errors: string[]; informationalOnly: boolean } {
  if (!t) return { errors: [], informationalOnly: true }; // Target 없는 KPI 는 성공 판정 제외, 참고 관측만
  const errors: string[] = [];
  if (!['increase', 'decrease', 'maintain'].includes(t.expected_direction as string)) errors.push('expected_direction 필요(increase/decrease/maintain)');
  for (const k of ['target_value', 'warning_threshold', 'failure_threshold', 'minimum_sample'] as const) {
    if (t[k] !== undefined && t[k] !== null && !isFiniteNumber(t[k])) errors.push(`${k} NaN/Infinity`);
  }
  return { errors, informationalOnly: false };
}

/* ── Metric Delta(Actual 전용 · Baseline 0 나눗셈 금지) ─────────────────── */
export function calculateMetricDelta(baseline: number | null, observed: number | null): { absolute: number | null; relativePct: number | null } {
  if (!isFiniteNumber(baseline) || !isFiniteNumber(observed)) return { absolute: null, relativePct: null };
  const absolute = observed - baseline;
  if (baseline === 0) return { absolute, relativePct: null }; // 0 나눗셈 금지 — 절대 delta 만
  const rel = (absolute / Math.abs(baseline)) * 100;
  return { absolute, relativePct: isFiniteNumber(rel) ? Math.round(rel * 100) / 100 : null };
}

/* ── Observed Metric Validation / Classification ────────────────────────── */
export type MetricRole = 'primary' | 'guardrail' | 'diagnostic' | 'informational';
export type MetricValidationStatus = 'improved' | 'stable' | 'degraded' | 'failed' | 'pending' | 'unsupported' | 'insufficient_data' | 'invalid';
export interface ObservedMetricInput {
  metricCode: string; metricType?: 'actual' | 'proxy' | string;
  baseline: number | null; observed: number | null;
  sampleSize: number | null; minSample: number;
  warningThresholdPct?: number | null; failureThresholdPct?: number | null;
}
/** 구조 검증 — simulated/predicted 를 actual 로 저장 금지, NaN/Infinity 방어. */
export function validateObservedMetric(m: ObservedMetricInput): string[] {
  const errors: string[] = [];
  if (!isSupportedMetric(m.metricCode)) errors.push(`metric ${m.metricCode} 미지원`);
  if (m.metricType && m.metricType !== 'actual' && m.metricType !== 'proxy') errors.push(`metric_type ${m.metricType} 금지 — actual/proxy 만 허용(simulation 저장 금지)`);
  for (const [k, v] of [['baseline', m.baseline], ['observed', m.observed]] as const) {
    if (v !== null && !isFiniteNumber(v)) errors.push(`${k} NaN/Infinity`);
  }
  return errors;
}
/** KPI 판정 — 방향/threshold 기반. Baseline 없으면 insufficient_data, Observed 없으면 pending. */
export function classifyMetricResult(m: ObservedMetricInput): MetricValidationStatus {
  if (!isSupportedMetric(m.metricCode)) return 'unsupported';
  if (validateObservedMetric(m).some((e) => e.includes('NaN') || e.includes('금지'))) return 'invalid';
  if (m.observed === null) return 'pending';
  if (m.baseline === null) return 'insufficient_data';
  if (!isFiniteNumber(m.sampleSize) || m.sampleSize < m.minSample) return 'insufficient_data';
  const spec = SUPPORTED_METRICS.find((s) => s.code === m.metricCode)!;
  if (spec.direction === 'neutral') return 'stable'; // events 등 진단용 — 성패 판정 안 함
  const { relativePct, absolute } = calculateMetricDelta(m.baseline, m.observed);
  const warn = isFiniteNumber(m.warningThresholdPct) ? m.warningThresholdPct : 10;
  const fail = isFiniteNumber(m.failureThresholdPct) ? m.failureThresholdPct : 25;
  if (relativePct === null) { // baseline 0 — 절대 delta 부호만으로 판정(failed 판정은 상대 threshold 필요)
    if (absolute === null || absolute === 0) return 'stable';
    const worse = spec.direction === 'lower_is_better' ? absolute > 0 : absolute < 0;
    return worse ? 'degraded' : 'improved';
  }
  const badPct = spec.direction === 'lower_is_better' ? relativePct : -relativePct;
  if (badPct >= fail) return 'failed';
  if (badPct >= warn) return 'degraded';
  if (badPct <= -warn) return 'improved';
  return 'stable';
}

/* ── Regression Detection ───────────────────────────────────────────────── */
export type RegressionSeverity = 'informational' | 'warning' | 'high' | 'critical';
export interface MetricRow { metricCode: string; metricRole: MetricRole; validationStatus: MetricValidationStatus; sampleSize?: number | null }
export interface RegressionContext { versionMatch: boolean; monitoringGap: boolean; dataDelayed: boolean; minSample: number }
export interface Regression { type: string; metricCode?: string; severity: RegressionSeverity; note: string }
export function detectRegression(rows: MetricRow[], ctx: RegressionContext): Regression[] {
  const out: Regression[] = [];
  for (const r of rows) {
    if (r.validationStatus === 'failed') {
      if (r.metricRole === 'guardrail') out.push({ type: 'guardrail_violation', metricCode: r.metricCode, severity: 'critical', note: 'guardrail KPI failure threshold 초과' });
      else if (r.metricCode === 'player_error_rate') out.push({ type: 'error_spike', metricCode: r.metricCode, severity: 'critical', note: 'error rate 급증' });
      else out.push({ type: 'absolute_regression', metricCode: r.metricCode, severity: r.metricRole === 'primary' ? 'critical' : 'high', note: 'failure threshold 초과' });
    } else if (r.validationStatus === 'degraded') {
      if (r.metricRole === 'guardrail') out.push({ type: 'guardrail_violation', metricCode: r.metricCode, severity: 'high', note: 'guardrail KPI warning 수준 악화' });
      else if (r.metricCode === 'player_error_rate') out.push({ type: 'error_spike', metricCode: r.metricCode, severity: 'high', note: 'error rate 상승' });
      else out.push({ type: 'relative_regression', metricCode: r.metricCode, severity: 'warning', note: 'warning threshold 초과 악화' });
    }
    if (isFiniteNumber(r.sampleSize) && r.sampleSize < ctx.minSample && r.validationStatus !== 'insufficient_data') {
      out.push({ type: 'sample_instability', metricCode: r.metricCode, severity: 'informational', note: `sample ${r.sampleSize} < 최소 ${ctx.minSample}` });
    }
  }
  if (!ctx.versionMatch) out.push({ type: 'version_mismatch', severity: 'high', note: 'source/deployed version 불일치' });
  if (ctx.monitoringGap) out.push({ type: 'monitoring_gap', severity: 'warning', note: '관측 공백 구간 존재' });
  if (ctx.dataDelayed) out.push({ type: 'data_delay', severity: 'warning', note: '데이터 수집 지연' });
  return out;
}

/* ── Cross-Metric Trade-off ─────────────────────────────────────────────── */
export type TradeoffResult = 'consistent_improvement' | 'acceptable_tradeoff' | 'mixed' | 'degraded' | 'critical_tradeoff' | 'insufficient_data';
export function detectCrossMetricTradeoff(rows: MetricRow[]): { result: TradeoffResult; pairs: string[] } {
  const decided = rows.filter((r) => ['improved', 'stable', 'degraded', 'failed'].includes(r.validationStatus));
  if (decided.length === 0) return { result: 'insufficient_data', pairs: [] };
  const improved = decided.filter((r) => r.validationStatus === 'improved');
  const degraded = decided.filter((r) => r.validationStatus === 'degraded');
  const failed = decided.filter((r) => r.validationStatus === 'failed');
  const pairs = improved.flatMap((i) => [...degraded, ...failed].map((d) => `${i.metricCode} 개선 / ${d.metricCode} 악화`));
  if (failed.length > 0) return { result: improved.length > 0 ? 'critical_tradeoff' : 'degraded', pairs };
  if (degraded.length > 0) {
    if (improved.length === 0) return { result: 'degraded', pairs };
    if (degraded.some((d) => d.metricRole === 'guardrail')) return { result: 'critical_tradeoff', pairs };
    if (degraded.some((d) => d.metricRole === 'primary')) return { result: 'mixed', pairs };
    return { result: 'acceptable_tradeoff', pairs };
  }
  if (improved.length > 0) return { result: 'consistent_improvement', pairs: [] };
  return { result: 'acceptable_tradeoff', pairs: [] }; // 전부 stable — 허용 범위 내 변화 없음
}

/* ── Incident Correlation(인과 단정 없음) ───────────────────────────────── */
export type IncidentCorrelation = 'temporally_correlated' | 'scope_correlated' | 'possibly_related' | 'unrelated' | 'insufficient_data';
export interface IncidentLike { occurredAt: string | null; scopeKeys: string[] }
export interface ObservationWindowLike { start: string | null; end: string | null; scopeKeys: string[] }
export function correlateIncident(incident: IncidentLike, obs: ObservationWindowLike): { correlation: IncidentCorrelation; timeMatch: boolean; scopeMatch: boolean } {
  if (!incident.occurredAt || !obs.start) return { correlation: 'insufficient_data', timeMatch: false, scopeMatch: false };
  const t = Date.parse(incident.occurredAt); const s = Date.parse(obs.start);
  const e = obs.end ? Date.parse(obs.end) : s + 24 * 3600_000;
  if (!Number.isFinite(t) || !Number.isFinite(s) || !Number.isFinite(e)) return { correlation: 'insufficient_data', timeMatch: false, scopeMatch: false };
  const timeMatch = t >= s && t <= e;
  const scopeMatch = incident.scopeKeys.some((k) => obs.scopeKeys.includes(k));
  const correlation: IncidentCorrelation = timeMatch && scopeMatch ? 'possibly_related' : timeMatch ? 'temporally_correlated' : scopeMatch ? 'scope_correlated' : 'unrelated';
  return { correlation, timeMatch, scopeMatch }; // 상관 표기일 뿐 — 인과관계 단정 아님
}

/* ── Rollback Assessment(권고 전용 — 실행 아님) ─────────────────────────── */
export type RollbackAssessment = 'rollback_not_required' | 'monitor_closely' | 'rollback_recommended' | 'rollback_urgently_recommended' | 'manual_review_required' | 'insufficient_data';
export interface RollbackNeedInput {
  dataSufficient: boolean; criticalRegressions: number; primaryFailed: boolean; guardrailViolated: boolean;
  failureThresholdExceeded: boolean; incidentIncrease: boolean; errorSpike: boolean;
  versionMismatch: boolean; monitoringGap: boolean; rollbackPlanExists: boolean; rollbackOwnerExists: boolean; irreversible: boolean;
}
export function assessRollbackNeed(inp: RollbackNeedInput): { assessment: RollbackAssessment; reasons: string[]; executionBlocked: true } {
  const reasons: string[] = [];
  const finish = (assessment: RollbackAssessment): { assessment: RollbackAssessment; reasons: string[]; executionBlocked: true } => {
    if ((assessment === 'rollback_recommended' || assessment === 'rollback_urgently_recommended') && (!inp.rollbackPlanExists || !inp.rollbackOwnerExists)) {
      reasons.push('rollback plan/owner 불완전 — 수동 검토 필요');
      return { assessment: 'manual_review_required', reasons, executionBlocked: true };
    }
    reasons.push('본 평가는 권고이며 시스템이 Rollback 을 실행하지 않는다');
    return { assessment, reasons, executionBlocked: true };
  };
  if (!inp.dataSufficient) { reasons.push('관측 데이터 부족'); return finish('insufficient_data'); }
  if (inp.versionMismatch || inp.monitoringGap) { reasons.push(inp.versionMismatch ? 'version 불일치' : '관측 공백'); return finish('manual_review_required'); }
  if (inp.irreversible && (inp.primaryFailed || inp.criticalRegressions > 0)) { reasons.push('irreversible change — 사람 검토 필수'); return finish('manual_review_required'); }
  if (inp.criticalRegressions > 0 || (inp.primaryFailed && inp.errorSpike)) { reasons.push('critical regression/error spike'); return finish('rollback_urgently_recommended'); }
  if (inp.primaryFailed || inp.guardrailViolated || inp.failureThresholdExceeded) { reasons.push('primary 실패/guardrail 위반/failure threshold 초과'); return finish('rollback_recommended'); }
  if (inp.errorSpike || inp.incidentIncrease) { reasons.push('경계 신호 — 관측 지속'); return finish('monitor_closely'); }
  return finish('rollback_not_required');
}

/* ── Human Rollback Decision / Rollback Reference ───────────────────────── */
export const ROLLBACK_DECISIONS = ['continue_observation', 'accept_degradation', 'rollback_requested', 'rollback_completed_reference', 'change_cancelled', 'invalidated'] as const;
export type RollbackDecision = (typeof ROLLBACK_DECISIONS)[number];
export interface RollbackReferenceLike { external_rollback_id?: unknown; rollback_executed_by?: unknown; rollback_executed_at?: unknown; rollback_result?: unknown }
/** 외부 수행 Rollback 의 참고 기록 검증 — 기록 후에도 별도 재검증(재관측) 없이 성공 인증 금지. */
export function validateRollbackReference(ref: RollbackReferenceLike | null): { errors: string[]; requiresRevalidation: true } {
  const errors: string[] = [];
  if (!ref) errors.push('rollback reference 없음');
  else for (const k of ['external_rollback_id', 'rollback_executed_by', 'rollback_executed_at', 'rollback_result'] as const) {
    if (!ref[k]) errors.push(`${k} 필수`);
  }
  return { errors, requiresRevalidation: true };
}

/* ── Operational Certification(사람 판정 전 계산 — 자동 인증 아님) ──────── */
export type CertificationResult = 'certified' | 'certified_with_conditions' | 'not_certified' | 'rollback_recommended' | 'rollback_completed_pending_validation' | 'invalidated' | 'insufficient_data';
export const CERTIFICATION_RESULTS: CertificationResult[] = ['certified', 'certified_with_conditions', 'not_certified', 'rollback_recommended', 'rollback_completed_pending_validation', 'invalidated', 'insufficient_data'];
export interface CertificationInput {
  dataSufficient: boolean; primaryPassed: boolean; guardrailFailed: boolean; warningRegressions: number;
  criticalRegressions: number; criticalIncidents: number; windowMet: boolean; sampleMet: boolean;
  versionMatch: boolean; monitoringGap: boolean; humanReviewed: boolean; evidenceComplete: boolean;
  rollbackAssessment: RollbackAssessment | null; rollbackDecision: RollbackDecision | null; riskTier: RiskTier;
}
export function evaluateCertification(inp: CertificationInput): { result: CertificationResult; reasons: string[]; requiresHumanApproval: true } {
  const reasons: string[] = [];
  const done = (result: CertificationResult): { result: CertificationResult; reasons: string[]; requiresHumanApproval: true } => {
    reasons.push('최종 Certification 은 사람이 사유와 함께 확정한다(자동 인증 없음)');
    return { result, reasons, requiresHumanApproval: true };
  };
  if (inp.rollbackDecision === 'invalidated') { reasons.push('관측 무효화'); return done('invalidated'); }
  if (inp.rollbackDecision === 'rollback_completed_reference') { reasons.push('rollback reference 기록됨 — 재검증 전 성공 인증 금지'); return done('rollback_completed_pending_validation'); }
  if (!MIN_OBSERVATION_POLICY[inp.riskTier].certifiable) { reasons.push('critical risk — 인증 불가'); return done('not_certified'); }
  if (!inp.dataSufficient) { reasons.push('관측 데이터 부족'); return done('insufficient_data'); }
  if (inp.rollbackAssessment === 'rollback_recommended' || inp.rollbackAssessment === 'rollback_urgently_recommended') { reasons.push('rollback 권고 상태'); return done('rollback_recommended'); }
  const blockers: string[] = [];
  if (!inp.primaryPassed) blockers.push('primary KPI 미통과');
  if (inp.guardrailFailed) blockers.push('guardrail 위반(failure)');
  if (inp.criticalRegressions > 0) blockers.push('critical regression 존재');
  if (inp.criticalIncidents > 0) blockers.push('critical incident 존재');
  if (!inp.windowMet) blockers.push('관측 기간 미충족');
  if (!inp.sampleMet) blockers.push('최소 sample 미충족');
  if (!inp.versionMatch) blockers.push('version 불일치');
  if (inp.monitoringGap) blockers.push('monitoring gap 존재');
  if (!inp.humanReviewed) blockers.push('사람 review 미완료');
  if (!inp.evidenceComplete) blockers.push('evidence 불완전');
  if (blockers.length > 0) { reasons.push(...blockers); return done('not_certified'); }
  if (inp.warningRegressions > 0) { reasons.push('warning 수준 regression 존재 — 조건부 인증(추가 관측/제한사항 명시 필요)'); return done('certified_with_conditions'); }
  return done('certified');
}

/* ── Certification Package(Simulation/Prediction/Actual 분리 표기) ──────── */
export interface ObservationLike {
  observation_code: string; external_change_id: string | null; observation_scope: unknown;
  baseline_start: string | null; baseline_end: string | null; observation_start: string | null; observation_end: string | null;
  source_version: unknown; deployed_version: unknown; baseline_snapshot: unknown; target_snapshot: unknown; observed_snapshot: unknown;
  regression_summary: unknown; incident_summary: unknown; rollback_assessment: unknown; rollback_decision: string | null;
  certification_result: string | null; evidence: unknown; limitations: unknown;
}
export function buildCertificationPackage(obs: ObservationLike, metrics: MetricRow[]): Array<{ section: string; content: unknown }> {
  const roleOf = (role: MetricRole) => metrics.filter((m) => m.metricRole === role).map((m) => ({ metric: m.metricCode, status: m.validationStatus }));
  return [
    { section: 'Change Summary', content: { observation_code: obs.observation_code, external_change_id: obs.external_change_id ?? 'insufficient_data' } },
    { section: 'Execution Reference', content: { external_change_id: obs.external_change_id ?? 'insufficient_data', note: '외부 수동 실행 참고 기록' } },
    { section: 'Observation Window', content: { baseline: [obs.baseline_start, obs.baseline_end], observation: [obs.observation_start, obs.observation_end] } },
    { section: 'Scope', content: obs.observation_scope ?? 'insufficient_data' },
    { section: 'Baseline', content: obs.baseline_snapshot ?? 'insufficient_data' },
    { section: 'Target', content: obs.target_snapshot ?? 'insufficient_data' },
    { section: 'Actual Outcome', content: { data: obs.observed_snapshot ?? 'insufficient_data', metric_type: 'actual(실측) — simulation/prediction 미포함' } },
    { section: 'Primary KPI', content: roleOf('primary') },
    { section: 'Guardrail KPI', content: roleOf('guardrail') },
    { section: 'Regression', content: obs.regression_summary ?? 'insufficient_data' },
    { section: 'Incident Correlation', content: obs.incident_summary ?? 'insufficient_data' },
    { section: 'Trade-offs', content: detectCrossMetricTradeoff(metrics) },
    { section: 'Rollback Assessment', content: { data: obs.rollback_assessment ?? 'insufficient_data', note: '권고 전용 — 실행 아님' } },
    { section: 'Human Decision', content: obs.rollback_decision ?? 'insufficient_data' },
    { section: 'Certification Result', content: obs.certification_result ?? 'pending' },
    { section: 'Evidence', content: obs.evidence ?? [] },
    { section: 'Limitations', content: obs.limitations ?? [] },
    { section: 'Source Version', content: obs.source_version ?? 'insufficient_data' },
    { section: 'Deployed Version', content: obs.deployed_version ?? 'insufficient_data' },
    { section: 'Audit Timeline', content: 'admin_post_change_audit 참조' },
  ];
}

/* ── Progress / Data Delay ──────────────────────────────────────────────── */
export function calculateObservationProgress(startIso: string | null, requiredHours: number, now: Date): { progressPct: number | null; elapsedHours: number | null } {
  if (!startIso || !isFiniteNumber(requiredHours) || requiredHours <= 0) return { progressPct: null, elapsedHours: null };
  const start = Date.parse(startIso);
  if (!Number.isFinite(start)) return { progressPct: null, elapsedHours: null };
  const elapsed = Math.max(0, (now.getTime() - start) / 3600_000);
  return { progressPct: clampScore((elapsed / requiredHours) * 100), elapsedHours: Math.round(elapsed * 100) / 100 };
}
export function detectDataDelay(lastEventAt: string | null, now: Date, maxSilenceMinutes = 60): boolean {
  if (!lastEventAt) return true;
  const t = Date.parse(lastEventAt);
  if (!Number.isFinite(t)) return true;
  return (now.getTime() - t) / 60_000 > maxSilenceMinutes;
}

/* ── 해시(결정적) ───────────────────────────────────────────────────────── */
export function pcoHash(parts: Array<string | number | null>): string {
  const s = parts.map((p) => String(p ?? '')).join('|');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `pco_${(h >>> 0).toString(16)}`;
}

/* ── UI 라벨/톤 ─────────────────────────────────────────────────────────── */
export const OBS_STATUS_LABEL: Record<ObservationStatus, string> = {
  draft: 'Draft', pending_observation: '관측 대기', observing: '관측 중', data_delayed: '데이터 지연',
  review_required: '검토 필요', completed: '관측 완료', failed_validation: '검증 실패', rollback_review: 'Rollback 검토',
  certified: '인증', certified_with_conditions: '조건부 인증', rejected: '기각', cancelled: '취소', expired: '만료', invalidated: '무효화',
};
export const OBS_STATUS_TONE: Record<ObservationStatus, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  draft: 'neutral', pending_observation: 'info', observing: 'info', data_delayed: 'warning',
  review_required: 'warning', completed: 'success', failed_validation: 'danger', rollback_review: 'danger',
  certified: 'success', certified_with_conditions: 'warning', rejected: 'danger', cancelled: 'neutral', expired: 'neutral', invalidated: 'neutral',
};
export const METRIC_STATUS_TONE: Record<MetricValidationStatus, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  improved: 'success', stable: 'info', degraded: 'warning', failed: 'danger', pending: 'neutral', unsupported: 'neutral', insufficient_data: 'neutral', invalid: 'danger',
};
export const CERT_LABEL: Record<CertificationResult, string> = {
  certified: '인증', certified_with_conditions: '조건부 인증', not_certified: '인증 불가', rollback_recommended: 'Rollback 권고',
  rollback_completed_pending_validation: 'Rollback 후 재검증 대기', invalidated: '무효화', insufficient_data: '데이터 부족',
};
export const CERT_TONE: Record<CertificationResult, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  certified: 'success', certified_with_conditions: 'warning', not_certified: 'danger', rollback_recommended: 'danger',
  rollback_completed_pending_validation: 'warning', invalidated: 'neutral', insufficient_data: 'neutral',
};
export const ROLLBACK_ASSESS_TONE: Record<RollbackAssessment, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  rollback_not_required: 'success', monitor_closely: 'info', rollback_recommended: 'warning', rollback_urgently_recommended: 'danger', manual_review_required: 'warning', insufficient_data: 'neutral',
};

/* ── Support Matrix ─────────────────────────────────────────────────────── */
export type SupportStatus = 'fully_supported' | 'partially_supported' | 'observation_only' | 'evidence_only' | 'provisional' | 'unsupported' | 'insufficient_data';
export const PCO_SUPPORT: Array<{ key: string; label: string; status: SupportStatus; note: string }> = [
  { key: 'manual_execution_reference', label: 'Manual Execution Reference', status: 'evidence_only', note: '외부 실행 참고 기록(0505) — 실행 경로 아님' },
  { key: 'observation_eligibility', label: 'Observation Eligibility', status: 'fully_supported', note: 'completed_reference + manual reference + baseline 필수' },
  { key: 'observation_session', label: 'Observation Session', status: 'fully_supported', note: 'ai_post_change_observations(0506)' },
  { key: 'baseline', label: 'Baseline', status: 'partially_supported', note: 'playback_events_v2 실측 6 KPI 한정' },
  { key: 'target', label: 'Target', status: 'fully_supported', note: 'direction/threshold/minimum sample' },
  { key: 'primary_kpi', label: 'Primary KPI', status: 'partially_supported', note: 'completion/skip 등 실측 KPI 한정' },
  { key: 'guardrail_kpi', label: 'Guardrail KPI', status: 'partially_supported', note: 'error rate/start success proxy 한정' },
  { key: 'diagnostic_kpi', label: 'Diagnostic KPI', status: 'partially_supported', note: 'like_rate/events' },
  { key: 'playback_metrics', label: 'Playback Metrics', status: 'partially_supported', note: '6 KPI 실측 · transition failure 미수집' },
  { key: 'streaming_quality_metrics', label: 'Streaming Quality Metrics', status: 'unsupported', note: 'buffer/stall/TTFA/decoder telemetry 미수집' },
  { key: 'queue_metrics', label: 'Queue Metrics', status: 'unsupported', note: 'queue telemetry 미수집' },
  { key: 'scheduler_metrics', label: 'Scheduler Metrics', status: 'unsupported', note: 'scheduler telemetry 미수집' },
  { key: 'playlist_metrics', label: 'Playlist Metrics', status: 'unsupported', note: 'runtime repetition/diversity telemetry 미수집' },
  { key: 'business_metrics', label: 'Business Metrics', status: 'partially_supported', note: 'like_rate 만 · dislike/session/revenue 미수집' },
  { key: 'minimum_observation_policy', label: 'Minimum Observation Policy', status: 'fully_supported', note: 'risk tier 별 최소 기간/sample' },
  { key: 'regression_detection', label: 'Regression Detection', status: 'partially_supported', note: '실측 KPI + version/monitoring/data delay 한정' },
  { key: 'cross_metric_tradeoff', label: 'Cross-Metric Trade-off', status: 'partially_supported', note: '실측 KPI 조합 한정' },
  { key: 'incident_correlation', label: 'Incident Correlation', status: 'partially_supported', note: 'ai_incidents(0502) 시간/scope 상관 — 인과 단정 없음' },
  { key: 'rollback_assessment', label: 'Rollback Assessment', status: 'fully_supported', note: '권고 전용 — 실행 경로 없음' },
  { key: 'human_rollback_decision', label: 'Human Rollback Decision', status: 'fully_supported', note: '6 결정 whitelist + 사유 필수' },
  { key: 'rollback_reference', label: 'Rollback Reference', status: 'evidence_only', note: '외부 수행 Rollback 의 참고 기록' },
  { key: 'rollback_validation', label: 'Rollback Validation', status: 'partially_supported', note: '기록 후 재검증 필요 상태로만 표기 — 별도 재관측 필요' },
  { key: 'operational_certification', label: 'Operational Certification', status: 'fully_supported', note: '서버 gate + 사람 확정' },
  { key: 'conditional_certification', label: 'Conditional Certification', status: 'fully_supported', note: 'warning regression 시 조건부' },
  { key: 'outcome_evidence', label: 'Outcome Evidence', status: 'evidence_only', note: 'certification package/audit' },
  { key: 'learning_evidence_integration', label: 'Learning Evidence Integration', status: 'evidence_only', note: '참고 evidence 만 — 자동 weight/memory/trust 변경 없음' },
  { key: 'automatic_certification', label: 'Automatic Certification', status: 'unsupported', note: '금지 — 사람 확정만' },
  { key: 'automatic_rollback', label: 'Automatic Rollback', status: 'unsupported', note: '금지 — 권고/기록만' },
  { key: 'production_apply', label: 'Production Apply', status: 'unsupported', note: '금지' },
];
