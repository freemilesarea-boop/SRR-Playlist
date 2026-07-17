/**
 * predictiveEnterprise — Predictive Enterprise Intelligence, Forecast Calibration &
 * Human-Reviewed Early Warning Center 순수 로직 (Phase AI-OPS-39).
 *
 * Observed Signals → Forecast Definition → Baseline → Leading Indicator → Risk Trend →
 * Forecast Run → Prediction Error → Confidence Calibration → Forecast Drift →
 * Threshold Candidate → Early Warning Candidate → Cross-Domain Impact →
 * Human Warning Review → Escalation Recommendation → Outcome → Effectiveness → Audit.
 *
 * 정직성(전부 코드로 강제):
 *  - Forecast ≠ Future Fact. Trend ≠ Guaranteed Continuation. Leading Indicator ≠ Cause.
 *  - Warning Candidate ≠ Alert. Threshold Candidate ≠ Applied Threshold.
 *  - Confidence ≠ Correctness. Calibration Candidate ≠ Verified Calibration.
 *  - Error ≠ Model Failure. Drift/FP/FN Candidate ≠ Confirmed.
 *  - Escalation Recommendation ≠ Escalation. Outcome Link ≠ Causality.
 *  - No Warning ≠ No Risk. Unknown 유지(null→0 금지).
 *  - deterministic · pure · null 안전 · NaN/Infinity 방어 · Date 주입.
 */
import { isFiniteNumber, clampScore } from './aiMemory';

/* ── 상수(0543 CHECK와 1:1 정렬) ─────────────────────────────────────── */
export const FORECAST_DOMAINS = ['runtime_latency', 'runtime_failure', 'connector_timeout', 'connector_failure', 'approval_queue', 'review_delay', 'evidence_gap', 'duplicate_side_effect', 'incident_escalation', 'recovery_duration', 'capacity_utilization', 'capacity_exhaustion', 'cost_growth', 'throughput_decline', 'human_workload', 'policy_effectiveness', 'false_positive_growth', 'scope_violation', 'permission_violation', 'security_risk', 'privacy_risk', 'compliance_risk', 'operational_friction', 'enterprise_growth', 'custom_reference'] as const;
export const BLOCKED_FORECAST_DOMAINS = ['automatic_threshold_mutation', 'automatic_incident_creation', 'automatic_connector_disable', 'automatic_automation_disable', 'automatic_capacity_scaling', 'automatic_infrastructure_change', 'automatic_cost_commitment', 'automatic_policy_mutation', 'employee_performance_prediction', 'personal_behavior_prediction', 'credit_risk_prediction', 'medical_prediction'] as const;
export const FORECAST_DEFINITION_STATUSES = ['draft', 'pending_evidence', 'pending_review', 'reviewed_reference', 'approved_for_forecast_reference', 'forecast_blocked', 'invalidated', 'rejected', 'insufficient_data'] as const;
export const BASELINE_METHODS = ['fixed_period_baseline', 'rolling_average_baseline', 'rolling_median_baseline', 'prior_period_baseline', 'same_weekday_baseline', 'same_hour_baseline', 'policy_version_baseline', 'pre_change_baseline', 'post_change_baseline', 'enterprise_snapshot_baseline', 'insufficient_data'] as const;
export const BASELINE_RESULTS = ['baseline_ready_reference', 'baseline_partial', 'baseline_stale_candidate', 'baseline_scope_mismatch', 'baseline_seasonality_unverified', 'sample_too_small', 'baseline_unavailable', 'insufficient_data'] as const;
export const LEADING_INDICATOR_RESULTS = ['leading_indicator_candidate', 'weak_leading_indicator_candidate', 'inconsistent_lead_candidate', 'lagging_indicator_candidate', 'coincident_indicator_candidate', 'correlation_unverified', 'causality_unverified', 'sample_too_small', 'insufficient_data'] as const;
export const TREND_RESULTS = ['stable_trend_candidate', 'increasing_trend_candidate', 'decreasing_trend_candidate', 'accelerating_trend_candidate', 'decelerating_trend_candidate', 'volatile_trend_candidate', 'reversal_candidate', 'trend_unverified', 'sample_too_small', 'insufficient_data'] as const;
export const FORECAST_METHODS = ['baseline_projection_reference', 'rolling_trend_reference', 'moving_average_reference', 'median_trend_reference', 'scenario_derived_reference', 'historical_similarity_reference', 'capacity_projection_reference', 'cost_projection_reference', 'manual_reference', 'insufficient_data'] as const;
export const BLOCKED_FORECAST_METHODS = ['autonomous_ml_training', 'live_model_deployment', 'automatic_model_replacement', 'automatic_threshold_tuning'] as const;
export const FORECAST_RUN_STATUSES = ['draft', 'pending_review', 'ready_reference', 'running_reference', 'completed_reference', 'completed_with_limitation', 'blocked_reference', 'failed_reference', 'forecast_model_unavailable', 'baseline_unavailable', 'prediction_unverified', 'sample_too_small', 'invalidated', 'insufficient_data'] as const;
export const PREDICTION_ERROR_RESULTS = ['error_low_candidate', 'error_moderate_candidate', 'error_high_candidate', 'direction_match_only', 'range_match_only', 'threshold_match_only', 'outcome_unverified', 'sample_too_small', 'insufficient_data'] as const;
export const CALIBRATION_RESULTS = ['well_calibrated_candidate', 'overconfident_candidate', 'underconfident_candidate', 'calibration_drift_candidate', 'calibration_unverified', 'sample_too_small', 'calibration_unavailable', 'insufficient_data'] as const;
export const FORECAST_DRIFT_RESULTS = ['no_material_drift_candidate', 'minor_drift_candidate', 'moderate_drift_candidate', 'severe_drift_candidate', 'structural_drift_candidate', 'drift_unverified', 'insufficient_data'] as const;
export const THRESHOLD_TYPES = ['absolute_value', 'relative_change', 'rolling_average', 'rolling_median', 'percentile', 'slope', 'acceleration', 'volatility', 'duration_above', 'duration_below', 'compound_condition', 'cross_domain_condition', 'manual_reference', 'insufficient_data'] as const;
export const THRESHOLD_STATUSES = ['draft', 'pending_evidence', 'pending_review', 'candidate_reference', 'approved_for_warning_reference', 'rejected', 'invalidated', 'threshold_unverified', 'insufficient_data'] as const;
export const WARNING_TYPES = ['runtime_degradation_candidate', 'connector_degradation_candidate', 'connector_failure_candidate', 'approval_bottleneck_candidate', 'incident_escalation_candidate', 'recovery_deterioration_candidate', 'capacity_exhaustion_candidate', 'cost_escalation_candidate', 'throughput_decline_candidate', 'workload_overload_candidate', 'policy_effectiveness_decline_candidate', 'false_positive_growth_candidate', 'security_risk_candidate', 'privacy_risk_candidate', 'compliance_risk_candidate', 'operational_friction_candidate', 'multi_domain_risk_candidate', 'insufficient_data'] as const;
export const WARNING_SEVERITIES = ['informational_candidate', 'low_candidate', 'moderate_candidate', 'high_candidate', 'critical_candidate', 'severity_unverified', 'insufficient_data'] as const;
export const WARNING_STATUSES = ['candidate', 'pending_evidence', 'pending_review', 'reviewed_reference', 'escalation_recommended_reference', 'watch_reference', 'dismissed_reference', 'false_positive_candidate', 'outcome_pending', 'outcome_linked_reference', 'closed_reference', 'closed_with_limitation', 'invalidated', 'insufficient_data'] as const;
export const CROSS_DOMAIN_IMPACT_RESULTS = ['isolated_impact_candidate', 'limited_impact_candidate', 'multi_domain_impact_candidate', 'enterprise_wide_impact_candidate', 'cross_enterprise_blocked', 'impact_unverified', 'insufficient_data'] as const;
export const LEAD_TIME_RESULTS = ['lead_time_available_reference', 'lead_time_short_candidate', 'lead_time_adequate_candidate', 'lead_time_long_candidate', 'warning_after_event_candidate', 'event_time_unverified', 'lead_time_unverified', 'insufficient_data'] as const;
export const FALSE_POSITIVE_RESULTS = ['false_positive_candidate', 'likely_false_positive_candidate', 'unresolved_warning_candidate', 'external_factor_explained_candidate', 'data_quality_candidate', 'duplicate_warning_candidate', 'false_positive_unverified', 'insufficient_data'] as const;
export const FALSE_NEGATIVE_RESULTS = ['false_negative_candidate', 'missed_signal_candidate', 'threshold_gap_candidate', 'data_gap_candidate', 'unsupported_domain_candidate', 'external_factor_candidate', 'false_negative_unverified', 'insufficient_data'] as const;
export const WARNING_EFFECTIVENESS_RESULTS = ['effective_warning_candidate', 'partially_effective_candidate', 'ineffective_warning_candidate', 'too_late_candidate', 'excessive_false_positive_candidate', 'missed_warning_candidate', 'effectiveness_unverified', 'causality_unverified', 'sample_too_small', 'insufficient_data'] as const;
export const FORECAST_RECOMMENDATION_TYPES = ['create_forecast_definition', 'gather_baseline', 'gather_signal_history', 'review_data_quality', 'define_forecast_horizon', 'review_leading_indicator', 'perform_forecast_reference', 'review_prediction_error', 'review_confidence_calibration', 'review_forecast_drift', 'create_threshold_candidate', 'review_threshold_candidate', 'create_early_warning_candidate', 'request_warning_review', 'request_specialist_review', 'recommend_watch_reference', 'recommend_escalation_reference', 'link_warning_outcome', 'review_false_positive_candidate', 'review_false_negative_candidate', 'review_warning_effectiveness', 'update_forecast_definition_reference', 'insufficient_data'] as const;
export const FORECAST_TIMELINE_STAGES = ['definition', 'baseline', 'signal_window', 'leading_indicator', 'trend', 'forecast_run', 'threshold_candidate', 'warning_candidate', 'human_review', 'outcome'] as const;

/* ── 1) Forecast Definition(자동 Monitoring 아님) ────────────────────── */
export function buildForecastDefinition(i: { domain: string; name: string; targetMetric: string; baselineMethod: string; modelReferenceType: string }):
  | { rejected: true; rejectReason: string }
  | { domain: string; name: string; targetMetric: string; supportStatus: 'supported_reference' | 'partially_supported'; status: 'draft'; definitionIsNotMonitoring: true; forecastIsNotFutureFact: true; alertDispatched: false } {
  if ((BLOCKED_FORECAST_DOMAINS as readonly string[]).includes(i.domain)) return { rejected: true, rejectReason: `금지 forecast domain(${i.domain}) — 구조적 차단` };
  if (!(FORECAST_DOMAINS as readonly string[]).includes(i.domain)) return { rejected: true, rejectReason: '허용되지 않는 forecast_domain' };
  if (!(BASELINE_METHODS as readonly string[]).includes(i.baselineMethod)) return { rejected: true, rejectReason: '허용되지 않는 baseline_method' };
  if (!i.name.trim()) return { rejected: true, rejectReason: 'forecast_name 필수' };
  if (!i.targetMetric.trim()) return { rejected: true, rejectReason: 'target_metric 필수' };
  return { domain: i.domain, name: i.name, targetMetric: i.targetMetric, supportStatus: i.modelReferenceType === 'none' ? 'partially_supported' : 'supported_reference', status: 'draft', definitionIsNotMonitoring: true, forecastIsNotFutureFact: true, alertDispatched: false };
}

/* ── 2) Forecast Horizon(기간이 길수록 Confidence 상한 하락) ─────────── */
export function validateForecastHorizon(minutes: number | null): { cap: number | null; result: 'horizon_valid' | 'horizon_too_short' | 'horizon_too_long' | 'insufficient_data' } {
  if (minutes == null || !isFiniteNumber(minutes)) return { cap: null, result: 'insufficient_data' };
  if (minutes < 15) return { cap: null, result: 'horizon_too_short' };
  if (minutes > 525600) return { cap: null, result: 'horizon_too_long' };
  const hours = minutes / 60;
  if (hours <= 1) return { cap: 95, result: 'horizon_valid' };
  if (hours <= 24) return { cap: 90, result: 'horizon_valid' };
  if (hours <= 24 * 7) return { cap: 75, result: 'horizon_valid' };
  if (hours <= 24 * 30) return { cap: 60, result: 'horizon_valid' };
  if (hours <= 24 * 90) return { cap: 40, result: 'horizon_valid' };
  return { cap: 25, result: 'horizon_valid' };
}

/* ── 3) Signal Window(원인 아님 — 완전성/순서/NaN 검증) ──────────────── */
export function evaluateSignalWindow(i: { samples: { at: Date; value: number }[] | null; expectedSamples: number | null; minSample: number }): { sampleCount: number; missingCount: number | null; completenessPct: number | null; result: 'window_complete_reference' | 'window_partial' | 'window_empty' | 'invalid_sample_blocked' | 'ordering_unverified' | 'sample_too_small' | 'insufficient_data'; windowIsNotCause: true } {
  const flags = { windowIsNotCause: true as const };
  if (i.samples == null) return { sampleCount: 0, missingCount: null, completenessPct: null, result: 'insufficient_data', ...flags };
  if (!i.samples.length) return { sampleCount: 0, missingCount: i.expectedSamples, completenessPct: i.expectedSamples ? 0 : null, result: 'window_empty', ...flags };
  if (i.samples.some((s) => !isFiniteNumber(s.value))) return { sampleCount: i.samples.length, missingCount: null, completenessPct: null, result: 'invalid_sample_blocked', ...flags };
  const times = i.samples.map((s) => s.at.getTime());
  if (!times.every((t, k) => k === 0 || t >= times[k - 1])) return { sampleCount: i.samples.length, missingCount: null, completenessPct: null, result: 'ordering_unverified', ...flags };
  if (i.samples.length < i.minSample) return { sampleCount: i.samples.length, missingCount: null, completenessPct: null, result: 'sample_too_small', ...flags };
  if (i.expectedSamples == null || !isFiniteNumber(i.expectedSamples) || i.expectedSamples <= 0) return { sampleCount: i.samples.length, missingCount: null, completenessPct: null, result: 'window_partial', ...flags };
  const missingCount = Math.max(0, i.expectedSamples - i.samples.length);
  const completenessPct = Math.round((i.samples.length / i.expectedSamples) * 1000) / 10;
  return { sampleCount: i.samples.length, missingCount, completenessPct, result: missingCount > 0 ? 'window_partial' : 'window_complete_reference', ...flags };
}

/* ── 4) Baseline Readiness ───────────────────────────────────────────── */
export function evaluateBaselineReadiness(i: { method: string; sampleCount: number | null; minSample: number; scopeMatched: boolean; seasonalityReviewed: boolean; newestSampleAgeDays: number | null; staleAfterDays: number }): { result: (typeof BASELINE_RESULTS)[number]; baselineIsNotFutureGuarantee: true } {
  const flags = { baselineIsNotFutureGuarantee: true as const };
  if (!(BASELINE_METHODS as readonly string[]).includes(i.method) || i.method === 'insufficient_data') return { result: 'baseline_unavailable', ...flags };
  if (i.sampleCount == null || !isFiniteNumber(i.sampleCount) || i.sampleCount < 0) return { result: 'insufficient_data', ...flags };
  if (i.sampleCount === 0) return { result: 'baseline_unavailable', ...flags };
  if (i.sampleCount < i.minSample) return { result: 'sample_too_small', ...flags };
  if (!i.scopeMatched) return { result: 'baseline_scope_mismatch', ...flags };
  if (i.newestSampleAgeDays != null && isFiniteNumber(i.newestSampleAgeDays) && i.newestSampleAgeDays > i.staleAfterDays) return { result: 'baseline_stale_candidate', ...flags };
  if (!i.seasonalityReviewed) return { result: 'baseline_seasonality_unverified', ...flags };
  return { result: 'baseline_ready_reference', ...flags };
}

/* ── 5) Trend(지속 보장 아님) — slope/acceleration/volatility 포함 ───── */
export function calculateSlopeCandidate(values: number[] | null): number | null {
  if (values == null || values.length < 2 || values.some((v) => !isFiniteNumber(v))) return null;
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0; let den = 0;
  values.forEach((y, x) => { num += (x - xMean) * (y - yMean); den += (x - xMean) ** 2; });
  return den === 0 ? null : Math.round((num / den) * 10000) / 10000;
}

export function calculateVolatilityCandidate(values: number[] | null): number | null {
  if (values == null || values.length < 2 || values.some((v) => !isFiniteNumber(v))) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.round(Math.sqrt(variance) * 10000) / 10000;
}

export function calculateTrendCandidate(i: { values: number[] | null; minSample: number; volatilityThreshold: number }): { slope: number | null; acceleration: number | null; volatility: number | null; result: (typeof TREND_RESULTS)[number]; trendIsNotGuaranteedContinuation: true } {
  const flags = { trendIsNotGuaranteedContinuation: true as const };
  if (i.values == null) return { slope: null, acceleration: null, volatility: null, result: 'insufficient_data', ...flags };
  if (i.values.some((v) => !isFiniteNumber(v))) return { slope: null, acceleration: null, volatility: null, result: 'trend_unverified', ...flags };
  if (i.values.length < i.minSample) return { slope: null, acceleration: null, volatility: null, result: 'sample_too_small', ...flags };
  const slope = calculateSlopeCandidate(i.values);
  const half = Math.floor(i.values.length / 2);
  const slopeA = calculateSlopeCandidate(i.values.slice(0, half));
  const slopeB = calculateSlopeCandidate(i.values.slice(half));
  const acceleration = slopeA != null && slopeB != null ? Math.round((slopeB - slopeA) * 10000) / 10000 : null;
  const volatility = calculateVolatilityCandidate(i.values);
  if (slope == null) return { slope, acceleration, volatility, result: 'trend_unverified', ...flags };
  const mean = i.values.reduce((a, b) => a + b, 0) / i.values.length;
  const relVol = volatility != null && mean !== 0 ? Math.abs(volatility / mean) : null;
  if (relVol != null && relVol > i.volatilityThreshold) return { slope, acceleration, volatility, result: 'volatile_trend_candidate', ...flags };
  if (slopeA != null && slopeB != null && slopeA !== 0 && Math.sign(slopeA) !== Math.sign(slopeB) && slopeB !== 0) return { slope, acceleration, volatility, result: 'reversal_candidate', ...flags };
  if (slope > 0 && acceleration != null && acceleration > Math.abs(slope) * 0.5) return { slope, acceleration, volatility, result: 'accelerating_trend_candidate', ...flags };
  if (slope !== 0 && acceleration != null && Math.sign(acceleration) === -Math.sign(slope) && Math.abs(acceleration) > Math.abs(slope) * 0.5) return { slope, acceleration, volatility, result: 'decelerating_trend_candidate', ...flags };
  if (slope > 0) return { slope, acceleration, volatility, result: 'increasing_trend_candidate', ...flags };
  if (slope < 0) return { slope, acceleration, volatility, result: 'decreasing_trend_candidate', ...flags };
  return { slope, acceleration, volatility, result: 'stable_trend_candidate', ...flags };
}

/* ── 6) Leading Indicator(원인 아님) ─────────────────────────────────── */
export function evaluateLeadingIndicatorCandidate(i: { precededTarget: boolean | null; repeatedLeadCount: number | null; sampleSize: number | null; minSample: number; leadTimeConsistent: boolean | null; sameScope: boolean; externalFactorExplains: boolean | null; postHocSelected: boolean }): { result: (typeof LEADING_INDICATOR_RESULTS)[number]; leadingIndicatorIsNotCause: true; correlationIsNotCausality: true } {
  const flags = { leadingIndicatorIsNotCause: true as const, correlationIsNotCausality: true as const };
  if (i.sampleSize == null || !isFiniteNumber(i.sampleSize)) return { result: 'insufficient_data', ...flags };
  if (i.sampleSize < i.minSample) return { result: 'sample_too_small', ...flags };
  if (i.precededTarget == null) return { result: 'correlation_unverified', ...flags };
  if (!i.sameScope) return { result: 'correlation_unverified', ...flags };
  if (!i.precededTarget) return { result: 'lagging_indicator_candidate', ...flags };
  if (i.postHocSelected) return { result: 'causality_unverified', ...flags };   // 사건 이후 역선택 지표 — 인과 미검증
  if (i.externalFactorExplains === true) return { result: 'causality_unverified', ...flags };
  if (i.repeatedLeadCount == null || !isFiniteNumber(i.repeatedLeadCount)) return { result: 'correlation_unverified', ...flags };
  if (i.repeatedLeadCount <= 1) return { result: 'coincident_indicator_candidate', ...flags };
  if (i.leadTimeConsistent === false) return { result: 'inconsistent_lead_candidate', ...flags };
  if (i.repeatedLeadCount < 3 || i.leadTimeConsistent == null) return { result: 'weak_leading_indicator_candidate', ...flags };
  return { result: 'leading_indicator_candidate', ...flags };
}

/* ── 7) Forecast 값/범위/Threshold 도달 추정(선형 — 사실 아님) ───────── */
export function projectForecastValue(i: { lastValue: number | null; slope: number | null; horizonSteps: number | null }): { projected: number | null; result: 'projected_reference' | 'insufficient_data'; forecastIsNotFutureFact: true } {
  if (i.lastValue == null || !isFiniteNumber(i.lastValue) || i.slope == null || !isFiniteNumber(i.slope) || i.horizonSteps == null || !isFiniteNumber(i.horizonSteps) || i.horizonSteps < 0) {
    return { projected: null, result: 'insufficient_data', forecastIsNotFutureFact: true };
  }
  return { projected: Math.round((i.lastValue + i.slope * i.horizonSteps) * 100) / 100, result: 'projected_reference', forecastIsNotFutureFact: true };
}

export function projectForecastRange(i: { projected: number | null; volatility: number | null; spreadFactor: number }): { low: number | null; high: number | null; result: 'range_projected_reference' | 'range_unverified' | 'insufficient_data'; rangeIsNotGuarantee: true } {
  if (i.projected == null || !isFiniteNumber(i.projected)) return { low: null, high: null, result: 'insufficient_data', rangeIsNotGuarantee: true };
  if (i.volatility == null || !isFiniteNumber(i.volatility)) return { low: null, high: null, result: 'range_unverified', rangeIsNotGuarantee: true };
  const spread = i.volatility * i.spreadFactor;
  return { low: Math.round((i.projected - spread) * 100) / 100, high: Math.round((i.projected + spread) * 100) / 100, result: 'range_projected_reference', rangeIsNotGuarantee: true };
}

export function projectThresholdCrossingCandidate(i: { lastValue: number | null; slope: number | null; threshold: number | null; stepMinutes: number }): { stepsToCross: number | null; minutesToCross: number | null; result: 'crossing_projected_candidate' | 'no_projected_crossing' | 'threshold_unverified' | 'insufficient_data'; crossingIsNotFact: true } {
  const flags = { crossingIsNotFact: true as const };
  if (i.threshold == null || !isFiniteNumber(i.threshold)) return { stepsToCross: null, minutesToCross: null, result: 'threshold_unverified', ...flags };
  if (i.lastValue == null || !isFiniteNumber(i.lastValue) || i.slope == null || !isFiniteNumber(i.slope)) return { stepsToCross: null, minutesToCross: null, result: 'insufficient_data', ...flags };
  if (i.slope === 0 || (i.threshold > i.lastValue && i.slope < 0) || (i.threshold < i.lastValue && i.slope > 0)) return { stepsToCross: null, minutesToCross: null, result: 'no_projected_crossing', ...flags };
  if ((i.threshold >= i.lastValue && i.slope > 0) || (i.threshold <= i.lastValue && i.slope < 0)) {
    const steps = Math.ceil(Math.abs((i.threshold - i.lastValue) / i.slope));
    return { stepsToCross: steps, minutesToCross: steps * i.stepMinutes, result: 'crossing_projected_candidate', ...flags };
  }
  return { stepsToCross: null, minutesToCross: null, result: 'no_projected_crossing', ...flags };
}

/* ── 8) Prediction Error(Error ≠ Model Failure) ──────────────────────── */
export function calculatePredictionError(i: { predicted: number | null; observed: number | null; rangeLow: number | null; rangeHigh: number | null; toleranceRatio: number; outcomeLinked: boolean; sampleSize: number | null; minSample: number }): { absoluteError: number | null; relativeError: number | null; directionMatch: boolean | null; rangeMatch: boolean | null; result: (typeof PREDICTION_ERROR_RESULTS)[number]; errorIsNotModelFailure: true } {
  const flags = { errorIsNotModelFailure: true as const };
  if (!i.outcomeLinked) return { absoluteError: null, relativeError: null, directionMatch: null, rangeMatch: null, result: 'outcome_unverified', ...flags };
  if (i.sampleSize == null || !isFiniteNumber(i.sampleSize)) return { absoluteError: null, relativeError: null, directionMatch: null, rangeMatch: null, result: 'insufficient_data', ...flags };
  if (i.sampleSize < i.minSample) return { absoluteError: null, relativeError: null, directionMatch: null, rangeMatch: null, result: 'sample_too_small', ...flags };
  if (i.predicted == null || !isFiniteNumber(i.predicted) || i.observed == null || !isFiniteNumber(i.observed)) return { absoluteError: null, relativeError: null, directionMatch: null, rangeMatch: null, result: 'insufficient_data', ...flags };
  const absoluteError = Math.round(Math.abs(i.predicted - i.observed) * 100) / 100;
  const relativeError = i.observed === 0 ? null : Math.round((absoluteError / Math.abs(i.observed)) * 1000) / 1000;
  const directionMatch = (i.predicted >= 0) === (i.observed >= 0);
  const rangeMatch = i.rangeLow != null && i.rangeHigh != null && isFiniteNumber(i.rangeLow) && isFiniteNumber(i.rangeHigh) ? i.observed >= i.rangeLow && i.observed <= i.rangeHigh : null;
  if (relativeError == null) return { absoluteError, relativeError, directionMatch, rangeMatch, result: directionMatch ? 'direction_match_only' : 'insufficient_data', ...flags };
  if (relativeError <= i.toleranceRatio) return { absoluteError, relativeError, directionMatch, rangeMatch, result: 'error_low_candidate', ...flags };
  if (relativeError <= i.toleranceRatio * 3) return { absoluteError, relativeError, directionMatch, rangeMatch, result: 'error_moderate_candidate', ...flags };
  if (rangeMatch === true) return { absoluteError, relativeError, directionMatch, rangeMatch, result: 'range_match_only', ...flags };
  if (directionMatch) return { absoluteError, relativeError, directionMatch, rangeMatch, result: 'direction_match_only', ...flags };
  return { absoluteError, relativeError, directionMatch, rangeMatch, result: 'error_high_candidate', ...flags };
}

/* ── 9) Confidence Calibration(검증된 성능 아님) ─────────────────────── */
export function evaluateConfidenceCalibration(i: { avgConfidence: number | null; actualMatchRatePct: number | null; sampleSize: number | null; minSample: number; toleranceGap: number }): { gap: number | null; result: (typeof CALIBRATION_RESULTS)[number]; calibrationCandidateIsNotVerified: true; highConfidenceIsNotHighAccuracy: true } {
  const flags = { calibrationCandidateIsNotVerified: true as const, highConfidenceIsNotHighAccuracy: true as const };
  if (i.sampleSize == null || !isFiniteNumber(i.sampleSize)) return { gap: null, result: 'calibration_unavailable', ...flags };
  if (i.sampleSize === 0) return { gap: null, result: 'calibration_unavailable', ...flags };
  if (i.sampleSize < i.minSample) return { gap: null, result: 'sample_too_small', ...flags };
  if (i.avgConfidence == null || !isFiniteNumber(i.avgConfidence) || i.actualMatchRatePct == null || !isFiniteNumber(i.actualMatchRatePct)) return { gap: null, result: 'calibration_unverified', ...flags };
  const gap = Math.round((i.avgConfidence - i.actualMatchRatePct) * 10) / 10;
  if (Math.abs(gap) <= i.toleranceGap) return { gap, result: 'well_calibrated_candidate', ...flags };
  if (gap > 0) return { gap, result: 'overconfident_candidate', ...flags };
  return { gap, result: 'underconfident_candidate', ...flags };
}

/* ── 10) Forecast Drift(확정 아님) ───────────────────────────────────── */
export function calculateForecastDriftCandidate(dims: { dimension: string; driftRatio: number | null }[] | null): { result: (typeof FORECAST_DRIFT_RESULTS)[number]; driftedDimensions: string[]; driftCandidateIsNotConfirmedDrift: true; noDetectedDriftIsNotNoDrift: true } {
  const flags = { driftCandidateIsNotConfirmedDrift: true as const, noDetectedDriftIsNotNoDrift: true as const };
  if (dims == null || !dims.length) return { result: 'insufficient_data', driftedDimensions: [], ...flags };
  const measured = dims.filter((d) => d.driftRatio != null && isFiniteNumber(d.driftRatio));
  if (!measured.length) return { result: 'drift_unverified', driftedDimensions: [], ...flags };
  const drifted = measured.filter((d) => Math.abs(d.driftRatio as number) > 0.1);
  const severe = measured.filter((d) => Math.abs(d.driftRatio as number) > 0.5);
  const driftedDimensions = drifted.map((d) => d.dimension).slice(0, 20);
  if (severe.length >= 3) return { result: 'structural_drift_candidate', driftedDimensions, ...flags };
  if (severe.length > 0) return { result: 'severe_drift_candidate', driftedDimensions, ...flags };
  if (drifted.length >= 3) return { result: 'moderate_drift_candidate', driftedDimensions, ...flags };
  if (drifted.length > 0) return { result: 'minor_drift_candidate', driftedDimensions, ...flags };
  return { result: 'no_material_drift_candidate', driftedDimensions, ...flags };
}

/* ── 11) Threshold Candidate(적용 아님) ──────────────────────────────── */
export function buildThresholdCandidate(i: { thresholdType: string; proposedValue: number | null; basisDescribed: boolean; evidence: string[]; historicalHits: number | null; historicalMisses: number | null }):
  | { rejected: true; rejectReason: string }
  | { thresholdType: string; proposedValue: number; status: 'draft'; estimatedPrecisionPct: number | null; thresholdCandidateIsNotAppliedThreshold: true; autoApplied: false } {
  if (!(THRESHOLD_TYPES as readonly string[]).includes(i.thresholdType)) return { rejected: true, rejectReason: '허용되지 않는 threshold_type' };
  if (i.proposedValue == null || !isFiniteNumber(i.proposedValue)) return { rejected: true, rejectReason: 'NaN/Infinity/결측 threshold 차단' };
  if (!i.basisDescribed) return { rejected: true, rejectReason: 'threshold_unverified: 근거 없는 Threshold 금지' };
  if (!i.evidence.length) return { rejected: true, rejectReason: 'Evidence 없는 Threshold Candidate 금지' };
  const hits = i.historicalHits; const misses = i.historicalMisses;
  const estimatedPrecisionPct = hits != null && misses != null && isFiniteNumber(hits) && isFiniteNumber(misses) && hits + misses > 0
    ? Math.round((hits / (hits + misses)) * 1000) / 10 : null;
  return { thresholdType: i.thresholdType, proposedValue: i.proposedValue, status: 'draft', estimatedPrecisionPct, thresholdCandidateIsNotAppliedThreshold: true, autoApplied: false };
}

/* ── 12) Warning Severity/Lead Time ──────────────────────────────────── */
export function evaluateWarningSeverityCandidate(i: { projectedImpactScore: number | null; crossDomain: boolean; reviewed: boolean }): { result: (typeof WARNING_SEVERITIES)[number]; severityIsNotIncidentSeverity: true } {
  const flags = { severityIsNotIncidentSeverity: true as const };
  if (!i.reviewed) return { result: 'severity_unverified', ...flags };
  if (i.projectedImpactScore == null || !isFiniteNumber(i.projectedImpactScore)) return { result: 'insufficient_data', ...flags };
  const s = i.projectedImpactScore;
  if (s >= 80 || (s >= 60 && i.crossDomain)) return { result: 'critical_candidate', ...flags };
  if (s >= 60) return { result: 'high_candidate', ...flags };
  if (s >= 30) return { result: 'moderate_candidate', ...flags };
  if (s > 5) return { result: 'low_candidate', ...flags };
  return { result: 'informational_candidate', ...flags };
}

export function calculateWarningLeadTime(i: { warningAt: Date | null; eventStartedAt: Date | null; adequateMinutes: number }): { leadTimeMinutes: number | null; result: (typeof LEAD_TIME_RESULTS)[number]; leadTimeIsNotGuaranteedResponseTime: true } {
  const flags = { leadTimeIsNotGuaranteedResponseTime: true as const };
  if (i.warningAt == null) return { leadTimeMinutes: null, result: 'lead_time_unverified', ...flags };
  if (i.eventStartedAt == null) return { leadTimeMinutes: null, result: 'event_time_unverified', ...flags };
  const leadTimeMinutes = Math.round((i.eventStartedAt.getTime() - i.warningAt.getTime()) / 60000);
  if (leadTimeMinutes < 0) return { leadTimeMinutes, result: 'warning_after_event_candidate', ...flags };
  if (leadTimeMinutes < i.adequateMinutes / 2) return { leadTimeMinutes, result: 'lead_time_short_candidate', ...flags };
  if (leadTimeMinutes <= i.adequateMinutes * 4) return { leadTimeMinutes, result: 'lead_time_adequate_candidate', ...flags };
  return { leadTimeMinutes, result: 'lead_time_long_candidate', ...flags };
}

/* ── 13) Cross-Domain Impact(Settlement·Payment 는 Reference 만) ─────── */
export function evaluateCrossDomainImpact(i: { affectedDomains: string[] | null; crossEnterprise: boolean; reviewed: boolean }): { result: (typeof CROSS_DOMAIN_IMPACT_RESULTS)[number]; domainCount: number | null; impactIsReferenceOnly: true } {
  const flags = { impactIsReferenceOnly: true as const };
  if (i.crossEnterprise) return { result: 'cross_enterprise_blocked', domainCount: null, ...flags };
  if (!i.reviewed) return { result: 'impact_unverified', domainCount: null, ...flags };
  if (i.affectedDomains == null) return { result: 'insufficient_data', domainCount: null, ...flags };
  const n = new Set(i.affectedDomains).size;
  if (n === 0) return { result: 'insufficient_data', domainCount: 0, ...flags };
  if (n === 1) return { result: 'isolated_impact_candidate', domainCount: n, ...flags };
  if (n <= 3) return { result: 'limited_impact_candidate', domainCount: n, ...flags };
  if (n <= 8) return { result: 'multi_domain_impact_candidate', domainCount: n, ...flags };
  return { result: 'enterprise_wide_impact_candidate', domainCount: n, ...flags };
}

/* ── 14) False Positive / False Negative(확정 아님) ──────────────────── */
export function evaluateFalsePositiveCandidate(i: { observationWindowEnded: boolean; eventOccurred: boolean | null; metricNormalized: boolean | null; externalFactorExplains: boolean | null; dataQualityIssue: boolean; duplicateWarning: boolean }): { result: (typeof FALSE_POSITIVE_RESULTS)[number]; fpCandidateIsNotConfirmed: true } {
  const flags = { fpCandidateIsNotConfirmed: true as const };
  if (i.duplicateWarning) return { result: 'duplicate_warning_candidate', ...flags };
  if (i.dataQualityIssue) return { result: 'data_quality_candidate', ...flags };
  if (!i.observationWindowEnded) return { result: 'unresolved_warning_candidate', ...flags };
  if (i.eventOccurred == null) return { result: 'false_positive_unverified', ...flags };
  if (i.eventOccurred) return { result: 'false_positive_unverified', ...flags };   // 사건 발생 — FP 아님(여기서 판정 종료)
  if (i.externalFactorExplains === true) return { result: 'external_factor_explained_candidate', ...flags };
  if (i.metricNormalized === true) return { result: 'likely_false_positive_candidate', ...flags };
  return { result: 'false_positive_candidate', ...flags };
}

export function evaluateFalseNegativeCandidate(i: { eventOccurred: boolean; priorWarningExisted: boolean; signalExisted: boolean | null; thresholdReached: boolean | null; dataGap: boolean; domainSupported: boolean; externalFactorOnly: boolean | null }): { result: (typeof FALSE_NEGATIVE_RESULTS)[number]; fnCandidateIsNotConfirmed: true; noWarningIsNotNoRisk: true } {
  const flags = { fnCandidateIsNotConfirmed: true as const, noWarningIsNotNoRisk: true as const };
  if (!i.eventOccurred) return { result: 'false_negative_unverified', ...flags };
  if (i.priorWarningExisted) return { result: 'false_negative_unverified', ...flags };
  if (!i.domainSupported) return { result: 'unsupported_domain_candidate', ...flags };
  if (i.dataGap) return { result: 'data_gap_candidate', ...flags };
  if (i.externalFactorOnly === true) return { result: 'external_factor_candidate', ...flags };
  if (i.signalExisted === true && i.thresholdReached === false) return { result: 'threshold_gap_candidate', ...flags };
  if (i.signalExisted === true) return { result: 'missed_signal_candidate', ...flags };
  if (i.signalExisted == null) return { result: 'false_negative_unverified', ...flags };
  return { result: 'false_negative_candidate', ...flags };
}

/* ── 15) Warning Effectiveness(예방 증명 아님) ───────────────────────── */
export function evaluateWarningEffectiveness(i: { outcomeLinked: boolean; eventOccurred: boolean | null; leadTimeResult: string | null; humanReviewedBeforeEvent: boolean | null; falsePositiveRatePct: number | null; externalFactorsReviewed: boolean; sampleSize: number | null; minSample: number }): { result: (typeof WARNING_EFFECTIVENESS_RESULTS)[number]; effectivenessIsNotPreventionProof: true } {
  const flags = { effectivenessIsNotPreventionProof: true as const };
  if (!i.outcomeLinked) return { result: 'effectiveness_unverified', ...flags };
  if (i.sampleSize == null || !isFiniteNumber(i.sampleSize)) return { result: 'insufficient_data', ...flags };
  if (i.sampleSize < i.minSample) return { result: 'sample_too_small', ...flags };
  if (i.falsePositiveRatePct != null && isFiniteNumber(i.falsePositiveRatePct) && i.falsePositiveRatePct > 50) return { result: 'excessive_false_positive_candidate', ...flags };
  if (i.eventOccurred === true && i.leadTimeResult === 'warning_after_event_candidate') return { result: 'too_late_candidate', ...flags };
  if (i.eventOccurred === true && i.humanReviewedBeforeEvent === false) return { result: 'missed_warning_candidate', ...flags };
  if (!i.externalFactorsReviewed) return { result: 'causality_unverified', ...flags };
  if (i.eventOccurred == null) return { result: 'effectiveness_unverified', ...flags };
  if (i.humanReviewedBeforeEvent === true && (i.leadTimeResult === 'lead_time_adequate_candidate' || i.leadTimeResult === 'lead_time_long_candidate')) return { result: 'effective_warning_candidate', ...flags };
  return { result: 'partially_effective_candidate', ...flags };
}

/* ── 16) Recommendation(제안 전용 — Evidence 필수) ───────────────────── */
export function buildForecastRecommendation(i: { type: string; reason: string; evidence: string[]; confidence: number | null; alternatives?: string[]; limitations?: string[] }):
  | { rejected: true; rejectReason: string }
  | { type: string; reason: string; evidence: string[]; confidence: number; alternatives: string[]; limitations: string[]; isRecommendationOnly: true; recommendationIsNotDecision: true; alertDispatched: false; autoExecuted: false } {
  if (!(FORECAST_RECOMMENDATION_TYPES as readonly string[]).includes(i.type)) return { rejected: true, rejectReason: '허용되지 않는 recommendation type' };
  if (!i.reason.trim()) return { rejected: true, rejectReason: 'reason 필수' };
  if (!i.evidence.length) return { rejected: true, rejectReason: 'Evidence 없는 추천 금지' };
  return {
    type: i.type, reason: i.reason, evidence: i.evidence.slice(0, 20),
    confidence: clampScore(i.confidence ?? 0),
    alternatives: (i.alternatives ?? []).slice(0, 10), limitations: (i.limitations ?? []).slice(0, 10),
    isRecommendationOnly: true, recommendationIsNotDecision: true, alertDispatched: false, autoExecuted: false,
  };
}

/* ── 17) Forecast Timeline(측정 카운트 — 완료 주장 아님) ─────────────── */
export function buildForecastTimeline(counts: { stage: string; count: number | null; source: string }[] | null): { stages: { stage: string; count: number | null; source: string; status: 'measured' | 'insufficient_data' }[]; invalidStages: number; timelineIsNotCompletionClaim: true } {
  const rows = (counts ?? []).filter((c) => (FORECAST_TIMELINE_STAGES as readonly string[]).includes(c.stage));
  return {
    stages: rows.map((c) => ({ stage: c.stage, count: isFiniteNumber(c.count) && (c.count as number) >= 0 ? c.count : null, source: c.source, status: isFiniteNumber(c.count) && (c.count as number) >= 0 ? 'measured' as const : 'insufficient_data' as const })),
    invalidStages: (counts ?? []).length - rows.length,
    timelineIsNotCompletionClaim: true,
  };
}

/* ── 실측 구성요소·지원 매트릭스(추측 없음) ──────────────────────────── */
export const FORECAST_COMPONENTS: { key: string; available: boolean | null; note: string }[] = [
  { key: 'assurance_signals_0537', available: true, note: 'ai_runtime_assurance_signals(19종) — Signal 원천' },
  { key: 'runtime_events_0536', available: true, note: 'Runtime Latency/Timeout/Failure 이력 원천' },
  { key: 'incident_history_0502_0537', available: true, note: 'Incident/Recovery Duration 이력' },
  { key: 'approval_queue_0535_0539', available: true, note: '승인 대기 counts proxy(Approval Queue History)' },
  { key: 'capacity_cost_history_0508', available: true, note: 'ai_capacity_metrics/snapshots + ai_cost_snapshots' },
  { key: 'scenario_predictions_0542', available: true, note: 'Scenario Prediction/Outcome/Accuracy/Drift 원천' },
  { key: 'twin_runs_0540', available: true, note: 'Twin 예측 이력' },
  { key: 'decision_outcomes_0514', available: true, note: 'Observed Outcome 원천' },
  { key: 'policy_observations_0506_0539', available: true, note: 'Policy Effectiveness Observation 원천' },
  { key: 'trained_forecast_model', available: false, note: '학습된 Forecast Model 없음 — 단순 Trend Projection Reference 중심' },
  { key: 'anomaly_detection_engine', available: false, note: 'Anomaly Detection 엔진 없음' },
  { key: 'alert_dispatcher', available: false, note: 'Alert Dispatcher/Pager 없음 — Warning 은 Candidate 로만 존재' },
  { key: 'provider_state_feed', available: false, note: 'Provider 상태 피드 없음' },
  { key: 'region_outage_feed', available: false, note: 'Region 장애 피드 없음' },
  { key: 'seasonality_dataset', available: false, note: 'Seasonality 데이터셋 없음 — baseline_seasonality_unverified 유지' },
];

export const FORECAST_SUPPORT_MATRIX: { key: string; status: string; note: string }[] = [
  { key: 'forecast_definition', status: 'fully_supported', note: '도메인 25종·금지 12종 차단·Definition ≠ Monitoring' },
  { key: 'forecast_horizon', status: 'fully_supported', note: '15분~365일·Confidence 상한(1h:95→90d초과:25)' },
  { key: 'signal_window', status: 'signal_only', note: 'Events+JSONB 통합·완전성/순서/NaN 검증·Window ≠ 원인' },
  { key: 'baseline', status: 'trend_only', note: '11 method·8 판정·Baseline ≠ 미래 보장' },
  { key: 'leading_indicator_candidate', status: 'candidate_only', note: '9 판정·post-hoc 선택 차단·Indicator ≠ Cause' },
  { key: 'trend_analysis', status: 'trend_only', note: 'slope/acceleration/volatility — Trend ≠ Guaranteed Continuation' },
  { key: 'forecast_run', status: 'forecast_only', note: '금지 method 4종 차단·미실행 completed 차단' },
  { key: 'prediction_range', status: 'forecast_only', note: 'volatility 기반 범위 — 보장 아님' },
  { key: 'prediction_error', status: 'outcome_reference_only', note: 'Outcome 연결 후에만·Error ≠ Model Failure' },
  { key: 'confidence_calibration', status: 'calibration_only', note: 'over/underconfident 후보 — Verified Calibration 아님' },
  { key: 'forecast_drift', status: 'candidate_only', note: 'Drift Candidate ≠ Confirmed Drift' },
  { key: 'threshold_candidate', status: 'candidate_only', note: '14 타입·근거+Evidence 필수·적용 없음' },
  { key: 'early_warning_candidate', status: 'warning_candidate_only', note: 'Warning ≠ Alert — 발송 없음' },
  { key: 'severity_candidate', status: 'candidate_only', note: 'Incident Severity 아님' },
  { key: 'cross_domain_impact', status: 'candidate_only', note: 'Settlement/Payment 는 Reference 만·cross-enterprise 차단' },
  { key: 'warning_lead_time', status: 'outcome_reference_only', note: 'Lead Time ≠ 보장된 대응 시간' },
  { key: 'false_positive_candidate', status: 'outcome_reference_only', note: 'Confirmed FP 아님' },
  { key: 'false_negative_candidate', status: 'outcome_reference_only', note: 'Confirmed FN 아님·No Warning ≠ No Risk' },
  { key: 'warning_outcome', status: 'outcome_reference_only', note: '예방 증명 아님' },
  { key: 'warning_effectiveness', status: 'outcome_reference_only', note: 'Causality 미검토 시 unverified' },
  { key: 'human_warning_review', status: 'human_review_only', note: '검토/Watch/기각/Closure 전부 사람' },
  { key: 'escalation_recommendation', status: 'human_review_only', note: 'Recommendation ≠ Escalation — 실제 발송 없음' },
  { key: 'forecast_learning', status: 'reference_only', note: 'Learning Reference 기록만' },
  { key: 'forecast_audit', status: 'fully_supported', note: 'ai_enterprise_forecast_events 24종' },
  { key: 'automatic_alert_dispatch', status: 'unsupported', note: '자동 Alert 발송 없음 — Dispatcher 자체가 없음' },
  { key: 'automatic_incident_creation', status: 'unsupported', note: '자동 Incident 생성 없음(0502 미기록)' },
  { key: 'automatic_escalation', status: 'unsupported', note: '자동 Escalation 없음' },
  { key: 'automatic_threshold_mutation', status: 'unsupported', note: '자동 Threshold 변경 없음' },
  { key: 'automatic_runtime_mutation', status: 'unsupported', note: '자동 Runtime 변경 없음' },
  { key: 'automatic_connector_disable', status: 'unsupported', note: '자동 Connector 비활성 없음' },
  { key: 'automatic_automation_disable', status: 'unsupported', note: '자동 Automation 비활성 없음' },
  { key: 'automatic_capacity_scaling', status: 'unsupported', note: '자동 Capacity 확장 없음' },
  { key: 'automatic_policy_mutation', status: 'unsupported', note: '자동 Policy 변경 없음' },
  { key: 'automatic_rollout', status: 'unsupported', note: '자동 Rollout 없음' },
  { key: 'automatic_rollback', status: 'unsupported', note: '자동 Rollback 없음' },
  { key: 'automatic_production_mutation', status: 'unsupported', note: 'Production 변경 없음 — 해당 RPC 자체가 없음' },
];
