import { describe, expect, it } from 'vitest';
import {
  FORECAST_DOMAINS, BLOCKED_FORECAST_DOMAINS, FORECAST_DEFINITION_STATUSES, BASELINE_METHODS,
  BASELINE_RESULTS, LEADING_INDICATOR_RESULTS, TREND_RESULTS, FORECAST_METHODS, BLOCKED_FORECAST_METHODS,
  FORECAST_RUN_STATUSES, PREDICTION_ERROR_RESULTS, CALIBRATION_RESULTS, FORECAST_DRIFT_RESULTS,
  THRESHOLD_TYPES, THRESHOLD_STATUSES, WARNING_TYPES, WARNING_SEVERITIES, WARNING_STATUSES,
  CROSS_DOMAIN_IMPACT_RESULTS, LEAD_TIME_RESULTS, FALSE_POSITIVE_RESULTS, FALSE_NEGATIVE_RESULTS,
  WARNING_EFFECTIVENESS_RESULTS, FORECAST_RECOMMENDATION_TYPES,
  buildForecastDefinition, validateForecastHorizon, evaluateSignalWindow, evaluateBaselineReadiness,
  calculateSlopeCandidate, calculateVolatilityCandidate, calculateTrendCandidate,
  evaluateLeadingIndicatorCandidate, projectForecastValue, projectForecastRange,
  projectThresholdCrossingCandidate, calculatePredictionError, evaluateConfidenceCalibration,
  calculateForecastDriftCandidate, buildThresholdCandidate, evaluateWarningSeverityCandidate,
  calculateWarningLeadTime, evaluateCrossDomainImpact, evaluateFalsePositiveCandidate,
  evaluateFalseNegativeCandidate, evaluateWarningEffectiveness, buildForecastRecommendation,
  buildForecastTimeline, FORECAST_COMPONENTS, FORECAST_SUPPORT_MATRIX,
} from './predictiveEnterprise';

describe('predictiveEnterprise 상수(0543 CHECK 정렬)', () => {
  it('whitelist 개수 고정 — 도메인 25·금지 12·method 10·금지 method 4·warning 18·severity 7·status 9/14/14 등', () => {
    expect(FORECAST_DOMAINS).toHaveLength(25);
    expect(BLOCKED_FORECAST_DOMAINS).toHaveLength(12);
    expect(FORECAST_DEFINITION_STATUSES).toHaveLength(9);
    expect(BASELINE_METHODS).toHaveLength(11);
    expect(BASELINE_RESULTS).toHaveLength(8);
    expect(LEADING_INDICATOR_RESULTS).toHaveLength(9);
    expect(TREND_RESULTS).toHaveLength(10);
    expect(FORECAST_METHODS).toHaveLength(10);
    expect(BLOCKED_FORECAST_METHODS).toHaveLength(4);
    expect(FORECAST_RUN_STATUSES).toHaveLength(14);
    expect(PREDICTION_ERROR_RESULTS).toHaveLength(9);
    expect(CALIBRATION_RESULTS).toHaveLength(8);
    expect(FORECAST_DRIFT_RESULTS).toHaveLength(7);
    expect(THRESHOLD_TYPES).toHaveLength(14);
    expect(THRESHOLD_STATUSES).toHaveLength(9);
    expect(WARNING_TYPES).toHaveLength(18);
    expect(WARNING_SEVERITIES).toHaveLength(7);
    expect(WARNING_STATUSES).toHaveLength(14);
    expect(CROSS_DOMAIN_IMPACT_RESULTS).toHaveLength(7);
    expect(LEAD_TIME_RESULTS).toHaveLength(8);
    expect(FALSE_POSITIVE_RESULTS).toHaveLength(8);
    expect(FALSE_NEGATIVE_RESULTS).toHaveLength(8);
    expect(WARNING_EFFECTIVENESS_RESULTS).toHaveLength(10);
    expect(FORECAST_RECOMMENDATION_TYPES).toHaveLength(23);
    expect(BLOCKED_FORECAST_DOMAINS.filter((d) => (FORECAST_DOMAINS as readonly string[]).includes(d))).toHaveLength(0);
    expect(BLOCKED_FORECAST_METHODS.filter((m) => (FORECAST_METHODS as readonly string[]).includes(m))).toHaveLength(0);
  });
});

describe('buildForecastDefinition', () => {
  it('금지 도메인 거부·모델 없으면 partially_supported(Definition ≠ Monitoring)', () => {
    expect(buildForecastDefinition({ domain: 'employee_performance_prediction', name: 'n', targetMetric: 'm', baselineMethod: 'rolling_average_baseline', modelReferenceType: 'none' })).toMatchObject({ rejected: true });
    expect(buildForecastDefinition({ domain: 'weird', name: 'n', targetMetric: 'm', baselineMethod: 'rolling_average_baseline', modelReferenceType: 'none' })).toMatchObject({ rejected: true });
    const ok = buildForecastDefinition({ domain: 'connector_timeout', name: 'Timeout 증가', targetMetric: 'timeout_count', baselineMethod: 'rolling_average_baseline', modelReferenceType: 'none' });
    expect(ok).toMatchObject({ supportStatus: 'partially_supported', definitionIsNotMonitoring: true, forecastIsNotFutureFact: true, alertDispatched: false });
  });
});

describe('validateForecastHorizon', () => {
  it('상한 1h:95/24h:90/7d:75/30d:60/90d:40/초과:25·범위 검증', () => {
    expect(validateForecastHorizon(60)).toMatchObject({ cap: 95, result: 'horizon_valid' });
    expect(validateForecastHorizon(24 * 60).cap).toBe(90);
    expect(validateForecastHorizon(7 * 1440).cap).toBe(75);
    expect(validateForecastHorizon(30 * 1440).cap).toBe(60);
    expect(validateForecastHorizon(90 * 1440).cap).toBe(40);
    expect(validateForecastHorizon(180 * 1440).cap).toBe(25);
    expect(validateForecastHorizon(10).result).toBe('horizon_too_short');
    expect(validateForecastHorizon(600000).result).toBe('horizon_too_long');
    expect(validateForecastHorizon(null).result).toBe('insufficient_data');
  });
});

describe('evaluateSignalWindow', () => {
  it('NaN 차단·순서 검증·결측 유지(Window ≠ 원인)', () => {
    const at = (n: number) => new Date(n * 60000);
    expect(evaluateSignalWindow({ samples: null, expectedSamples: 10, minSample: 3 }).result).toBe('insufficient_data');
    expect(evaluateSignalWindow({ samples: [], expectedSamples: 10, minSample: 3 }).result).toBe('window_empty');
    expect(evaluateSignalWindow({ samples: [{ at: at(1), value: Number.NaN }], expectedSamples: 10, minSample: 1 }).result).toBe('invalid_sample_blocked');
    expect(evaluateSignalWindow({ samples: [{ at: at(2), value: 1 }, { at: at(1), value: 2 }], expectedSamples: 10, minSample: 1 }).result).toBe('ordering_unverified');
    const p = evaluateSignalWindow({ samples: [{ at: at(1), value: 1 }, { at: at(2), value: 2 }, { at: at(3), value: 3 }], expectedSamples: 6, minSample: 3 });
    expect(p).toMatchObject({ result: 'window_partial', missingCount: 3, completenessPct: 50, windowIsNotCause: true });
  });
});

describe('evaluateBaselineReadiness', () => {
  it('method 없음 unavailable·표본/scope/stale/seasonality 구분', () => {
    expect(evaluateBaselineReadiness({ method: 'insufficient_data', sampleCount: 100, minSample: 10, scopeMatched: true, seasonalityReviewed: true, newestSampleAgeDays: 1, staleAfterDays: 30 }).result).toBe('baseline_unavailable');
    expect(evaluateBaselineReadiness({ method: 'rolling_average_baseline', sampleCount: 3, minSample: 10, scopeMatched: true, seasonalityReviewed: true, newestSampleAgeDays: 1, staleAfterDays: 30 }).result).toBe('sample_too_small');
    expect(evaluateBaselineReadiness({ method: 'rolling_average_baseline', sampleCount: 100, minSample: 10, scopeMatched: false, seasonalityReviewed: true, newestSampleAgeDays: 1, staleAfterDays: 30 }).result).toBe('baseline_scope_mismatch');
    expect(evaluateBaselineReadiness({ method: 'rolling_average_baseline', sampleCount: 100, minSample: 10, scopeMatched: true, seasonalityReviewed: false, newestSampleAgeDays: 1, staleAfterDays: 30 }).result).toBe('baseline_seasonality_unverified');
    expect(evaluateBaselineReadiness({ method: 'rolling_average_baseline', sampleCount: 100, minSample: 10, scopeMatched: true, seasonalityReviewed: true, newestSampleAgeDays: 60, staleAfterDays: 30 }).result).toBe('baseline_stale_candidate');
    expect(evaluateBaselineReadiness({ method: 'rolling_average_baseline', sampleCount: 100, minSample: 10, scopeMatched: true, seasonalityReviewed: true, newestSampleAgeDays: 1, staleAfterDays: 30 })).toMatchObject({ result: 'baseline_ready_reference', baselineIsNotFutureGuarantee: true });
  });
});

describe('calculateTrendCandidate', () => {
  it('increasing/decreasing/stable/volatile/reversal 구분(Trend ≠ 지속 보장)', () => {
    expect(calculateTrendCandidate({ values: [1, 2, 3, 4, 5, 6], minSample: 4, volatilityThreshold: 2 }).result).toBe('increasing_trend_candidate');
    expect(calculateTrendCandidate({ values: [6, 5, 4, 3, 2, 1], minSample: 4, volatilityThreshold: 2 }).result).toBe('decreasing_trend_candidate');
    expect(calculateTrendCandidate({ values: [5, 5, 5, 5, 5, 5], minSample: 4, volatilityThreshold: 2 }).result).toBe('stable_trend_candidate');
    expect(calculateTrendCandidate({ values: [1, 100, 2, 99, 3, 98], minSample: 4, volatilityThreshold: 0.5 }).result).toBe('volatile_trend_candidate');
    expect(calculateTrendCandidate({ values: [1, 2, 3, 3, 2, 1], minSample: 4, volatilityThreshold: 5 }).result).toBe('reversal_candidate');
    expect(calculateTrendCandidate({ values: [1, 2], minSample: 4, volatilityThreshold: 2 }).result).toBe('sample_too_small');
    expect(calculateTrendCandidate({ values: [1, Number.NaN], minSample: 1, volatilityThreshold: 2 }).result).toBe('trend_unverified');
    expect(calculateSlopeCandidate([0, 2, 4])).toBe(2);
    expect(calculateVolatilityCandidate([5, 5, 5])).toBe(0);
  });
});

describe('evaluateLeadingIndicatorCandidate', () => {
  it('post-hoc 선택 차단·반복/일관성 판정(Indicator ≠ Cause)', () => {
    const base = { precededTarget: true, repeatedLeadCount: 5, sampleSize: 30, minSample: 10, leadTimeConsistent: true, sameScope: true, externalFactorExplains: false, postHocSelected: false };
    expect(evaluateLeadingIndicatorCandidate(base)).toMatchObject({ result: 'leading_indicator_candidate', leadingIndicatorIsNotCause: true, correlationIsNotCausality: true });
    expect(evaluateLeadingIndicatorCandidate({ ...base, postHocSelected: true }).result).toBe('causality_unverified');
    expect(evaluateLeadingIndicatorCandidate({ ...base, precededTarget: false }).result).toBe('lagging_indicator_candidate');
    expect(evaluateLeadingIndicatorCandidate({ ...base, repeatedLeadCount: 1 }).result).toBe('coincident_indicator_candidate');
    expect(evaluateLeadingIndicatorCandidate({ ...base, leadTimeConsistent: false }).result).toBe('inconsistent_lead_candidate');
    expect(evaluateLeadingIndicatorCandidate({ ...base, repeatedLeadCount: 2 }).result).toBe('weak_leading_indicator_candidate');
    expect(evaluateLeadingIndicatorCandidate({ ...base, sampleSize: 3 }).result).toBe('sample_too_small');
  });
});

describe('projectForecastValue/Range/ThresholdCrossing', () => {
  it('선형 추정·결측 유지(Forecast ≠ Future Fact)', () => {
    expect(projectForecastValue({ lastValue: 100, slope: 5, horizonSteps: 10 })).toMatchObject({ projected: 150, forecastIsNotFutureFact: true });
    expect(projectForecastValue({ lastValue: null, slope: 5, horizonSteps: 10 }).result).toBe('insufficient_data');
    expect(projectForecastRange({ projected: 150, volatility: 10, spreadFactor: 2 })).toMatchObject({ low: 130, high: 170, rangeIsNotGuarantee: true });
    expect(projectForecastRange({ projected: 150, volatility: null, spreadFactor: 2 }).result).toBe('range_unverified');
    expect(projectThresholdCrossingCandidate({ lastValue: 80, slope: 5, threshold: 100, stepMinutes: 60 })).toMatchObject({ stepsToCross: 4, minutesToCross: 240, result: 'crossing_projected_candidate', crossingIsNotFact: true });
    expect(projectThresholdCrossingCandidate({ lastValue: 80, slope: -5, threshold: 100, stepMinutes: 60 }).result).toBe('no_projected_crossing');
    expect(projectThresholdCrossingCandidate({ lastValue: 80, slope: 5, threshold: null, stepMinutes: 60 }).result).toBe('threshold_unverified');
  });
});

describe('calculatePredictionError', () => {
  it('Outcome 미연결 unverified·low/moderate/direction/range 구분(Error ≠ Model Failure)', () => {
    expect(calculatePredictionError({ predicted: 100, observed: 105, rangeLow: 90, rangeHigh: 110, toleranceRatio: 0.1, outcomeLinked: false, sampleSize: 20, minSample: 5 }).result).toBe('outcome_unverified');
    expect(calculatePredictionError({ predicted: 100, observed: 105, rangeLow: 90, rangeHigh: 110, toleranceRatio: 0.1, outcomeLinked: true, sampleSize: 20, minSample: 5 })).toMatchObject({ result: 'error_low_candidate', directionMatch: true, rangeMatch: true, errorIsNotModelFailure: true });
    expect(calculatePredictionError({ predicted: 100, observed: 125, rangeLow: 90, rangeHigh: 110, toleranceRatio: 0.1, outcomeLinked: true, sampleSize: 20, minSample: 5 }).result).toBe('error_moderate_candidate');
    expect(calculatePredictionError({ predicted: 100, observed: 300, rangeLow: 90, rangeHigh: 310, toleranceRatio: 0.1, outcomeLinked: true, sampleSize: 20, minSample: 5 }).result).toBe('range_match_only');
    expect(calculatePredictionError({ predicted: 100, observed: 300, rangeLow: 90, rangeHigh: 110, toleranceRatio: 0.1, outcomeLinked: true, sampleSize: 20, minSample: 5 }).result).toBe('direction_match_only');
    expect(calculatePredictionError({ predicted: 100, observed: 105, rangeLow: null, rangeHigh: null, toleranceRatio: 0.1, outcomeLinked: true, sampleSize: 2, minSample: 5 }).result).toBe('sample_too_small');
  });
});

describe('evaluateConfidenceCalibration', () => {
  it('over/underconfident 후보·표본 없으면 unavailable(High Confidence ≠ High Accuracy)', () => {
    expect(evaluateConfidenceCalibration({ avgConfidence: 80, actualMatchRatePct: 78, sampleSize: 50, minSample: 10, toleranceGap: 10 })).toMatchObject({ result: 'well_calibrated_candidate', calibrationCandidateIsNotVerified: true, highConfidenceIsNotHighAccuracy: true });
    expect(evaluateConfidenceCalibration({ avgConfidence: 90, actualMatchRatePct: 50, sampleSize: 50, minSample: 10, toleranceGap: 10 }).result).toBe('overconfident_candidate');
    expect(evaluateConfidenceCalibration({ avgConfidence: 40, actualMatchRatePct: 80, sampleSize: 50, minSample: 10, toleranceGap: 10 }).result).toBe('underconfident_candidate');
    expect(evaluateConfidenceCalibration({ avgConfidence: 80, actualMatchRatePct: 78, sampleSize: 0, minSample: 10, toleranceGap: 10 }).result).toBe('calibration_unavailable');
    expect(evaluateConfidenceCalibration({ avgConfidence: 80, actualMatchRatePct: 78, sampleSize: 3, minSample: 10, toleranceGap: 10 }).result).toBe('sample_too_small');
  });
});

describe('calculateForecastDriftCandidate + buildThresholdCandidate', () => {
  it('Drift 후보 단계·근거/Evidence 없는 Threshold 거부(Candidate ≠ Applied)', () => {
    expect(calculateForecastDriftCandidate([{ dimension: 'input', driftRatio: 0.05 }]).result).toBe('no_material_drift_candidate');
    expect(calculateForecastDriftCandidate([{ dimension: 'input', driftRatio: 0.6 }, { dimension: 'error', driftRatio: 0.7 }, { dimension: 'cost', driftRatio: 0.8 }]).result).toBe('structural_drift_candidate');
    expect(calculateForecastDriftCandidate([{ dimension: 'input', driftRatio: null }]).result).toBe('drift_unverified');
    expect(buildThresholdCandidate({ thresholdType: 'slope', proposedValue: 5, basisDescribed: false, evidence: ['e'], historicalHits: 8, historicalMisses: 2 })).toMatchObject({ rejected: true });
    expect(buildThresholdCandidate({ thresholdType: 'slope', proposedValue: Number.NaN, basisDescribed: true, evidence: ['e'], historicalHits: 8, historicalMisses: 2 })).toMatchObject({ rejected: true });
    expect(buildThresholdCandidate({ thresholdType: 'weird', proposedValue: 5, basisDescribed: true, evidence: ['e'], historicalHits: 8, historicalMisses: 2 })).toMatchObject({ rejected: true });
    expect(buildThresholdCandidate({ thresholdType: 'slope', proposedValue: 5, basisDescribed: true, evidence: ['e'], historicalHits: 8, historicalMisses: 2 })).toMatchObject({ estimatedPrecisionPct: 80, thresholdCandidateIsNotAppliedThreshold: true, autoApplied: false });
  });
});

describe('evaluateWarningSeverityCandidate + calculateWarningLeadTime', () => {
  it('severity 후보·lead time 판정(Warning after event 포함)', () => {
    expect(evaluateWarningSeverityCandidate({ projectedImpactScore: 90, crossDomain: false, reviewed: true }).result).toBe('critical_candidate');
    expect(evaluateWarningSeverityCandidate({ projectedImpactScore: 65, crossDomain: true, reviewed: true }).result).toBe('critical_candidate');
    expect(evaluateWarningSeverityCandidate({ projectedImpactScore: 40, crossDomain: false, reviewed: true }).result).toBe('moderate_candidate');
    expect(evaluateWarningSeverityCandidate({ projectedImpactScore: 40, crossDomain: false, reviewed: false })).toMatchObject({ result: 'severity_unverified', severityIsNotIncidentSeverity: true });
    const t = (m: number) => new Date(m * 60000);
    expect(calculateWarningLeadTime({ warningAt: t(0), eventStartedAt: t(120), adequateMinutes: 60 })).toMatchObject({ leadTimeMinutes: 120, result: 'lead_time_adequate_candidate', leadTimeIsNotGuaranteedResponseTime: true });
    expect(calculateWarningLeadTime({ warningAt: t(100), eventStartedAt: t(50), adequateMinutes: 60 }).result).toBe('warning_after_event_candidate');
    expect(calculateWarningLeadTime({ warningAt: t(0), eventStartedAt: null, adequateMinutes: 60 }).result).toBe('event_time_unverified');
  });
});

describe('evaluateCrossDomainImpact', () => {
  it('cross-enterprise 차단·도메인 수 기반 후보(Reference 만)', () => {
    expect(evaluateCrossDomainImpact({ affectedDomains: ['runtime'], crossEnterprise: true, reviewed: true }).result).toBe('cross_enterprise_blocked');
    expect(evaluateCrossDomainImpact({ affectedDomains: ['runtime'], crossEnterprise: false, reviewed: true }).result).toBe('isolated_impact_candidate');
    expect(evaluateCrossDomainImpact({ affectedDomains: ['runtime', 'connector', 'capacity', 'cost', 'approval'], crossEnterprise: false, reviewed: true })).toMatchObject({ result: 'multi_domain_impact_candidate', domainCount: 5, impactIsReferenceOnly: true });
    expect(evaluateCrossDomainImpact({ affectedDomains: null, crossEnterprise: false, reviewed: false }).result).toBe('impact_unverified');
  });
});

describe('evaluateFalsePositiveCandidate / FalseNegativeCandidate', () => {
  it('FP/FN 후보 — 확정 아님·No Warning ≠ No Risk', () => {
    expect(evaluateFalsePositiveCandidate({ observationWindowEnded: true, eventOccurred: false, metricNormalized: true, externalFactorExplains: false, dataQualityIssue: false, duplicateWarning: false })).toMatchObject({ result: 'likely_false_positive_candidate', fpCandidateIsNotConfirmed: true });
    expect(evaluateFalsePositiveCandidate({ observationWindowEnded: false, eventOccurred: null, metricNormalized: null, externalFactorExplains: null, dataQualityIssue: false, duplicateWarning: false }).result).toBe('unresolved_warning_candidate');
    expect(evaluateFalsePositiveCandidate({ observationWindowEnded: true, eventOccurred: false, metricNormalized: false, externalFactorExplains: true, dataQualityIssue: false, duplicateWarning: false }).result).toBe('external_factor_explained_candidate');
    expect(evaluateFalsePositiveCandidate({ observationWindowEnded: true, eventOccurred: false, metricNormalized: false, externalFactorExplains: false, dataQualityIssue: false, duplicateWarning: true }).result).toBe('duplicate_warning_candidate');
    const fn = evaluateFalseNegativeCandidate({ eventOccurred: true, priorWarningExisted: false, signalExisted: true, thresholdReached: false, dataGap: false, domainSupported: true, externalFactorOnly: false });
    expect(fn).toMatchObject({ result: 'threshold_gap_candidate', fnCandidateIsNotConfirmed: true, noWarningIsNotNoRisk: true });
    expect(evaluateFalseNegativeCandidate({ eventOccurred: true, priorWarningExisted: false, signalExisted: true, thresholdReached: true, dataGap: false, domainSupported: true, externalFactorOnly: false }).result).toBe('missed_signal_candidate');
    expect(evaluateFalseNegativeCandidate({ eventOccurred: true, priorWarningExisted: false, signalExisted: null, thresholdReached: null, dataGap: true, domainSupported: true, externalFactorOnly: false }).result).toBe('data_gap_candidate');
    expect(evaluateFalseNegativeCandidate({ eventOccurred: true, priorWarningExisted: false, signalExisted: null, thresholdReached: null, dataGap: false, domainSupported: false, externalFactorOnly: false }).result).toBe('unsupported_domain_candidate');
  });
});

describe('evaluateWarningEffectiveness', () => {
  it('too late/missed/excessive FP/causality 구분(예방 증명 아님)', () => {
    const base = { outcomeLinked: true, eventOccurred: true, leadTimeResult: 'lead_time_adequate_candidate', humanReviewedBeforeEvent: true, falsePositiveRatePct: 10, externalFactorsReviewed: true, sampleSize: 20, minSample: 5 };
    expect(evaluateWarningEffectiveness(base)).toMatchObject({ result: 'effective_warning_candidate', effectivenessIsNotPreventionProof: true });
    expect(evaluateWarningEffectiveness({ ...base, leadTimeResult: 'warning_after_event_candidate' }).result).toBe('too_late_candidate');
    expect(evaluateWarningEffectiveness({ ...base, humanReviewedBeforeEvent: false }).result).toBe('missed_warning_candidate');
    expect(evaluateWarningEffectiveness({ ...base, falsePositiveRatePct: 70 }).result).toBe('excessive_false_positive_candidate');
    expect(evaluateWarningEffectiveness({ ...base, externalFactorsReviewed: false }).result).toBe('causality_unverified');
    expect(evaluateWarningEffectiveness({ ...base, outcomeLinked: false }).result).toBe('effectiveness_unverified');
  });
});

describe('buildForecastRecommendation + Timeline', () => {
  it('Evidence 필수·type whitelist·Timeline whitelist(발송 없음)', () => {
    expect(buildForecastRecommendation({ type: 'send_alert_now', reason: 'r', evidence: ['e'], confidence: 50 })).toMatchObject({ rejected: true });
    expect(buildForecastRecommendation({ type: 'recommend_escalation_reference', reason: 'r', evidence: [], confidence: 50 })).toMatchObject({ rejected: true });
    expect(buildForecastRecommendation({ type: 'recommend_escalation_reference', reason: 'r', evidence: ['e'], confidence: 150 })).toMatchObject({ confidence: 100, recommendationIsNotDecision: true, alertDispatched: false, autoExecuted: false });
    const t = buildForecastTimeline([{ stage: 'definition', count: 1, source: 'defs 실측' }, { stage: 'weird', count: 1, source: 'x' }, { stage: 'outcome', count: null, source: 'events 실측' }]);
    expect(t.stages).toHaveLength(2);
    expect(t).toMatchObject({ invalidStages: 1, timelineIsNotCompletionClaim: true });
  });
});

describe('실측 구성요소·지원 매트릭스', () => {
  it('Signal 원천 9종 가용·부재 6종 명시·automatic_* 계열 unsupported', () => {
    const byKey = Object.fromEntries(FORECAST_COMPONENTS.map((c) => [c.key, c.available]));
    expect(byKey['assurance_signals_0537']).toBe(true);
    expect(byKey['scenario_predictions_0542']).toBe(true);
    expect(byKey['trained_forecast_model']).toBe(false);
    expect(byKey['alert_dispatcher']).toBe(false);
    expect(byKey['anomaly_detection_engine']).toBe(false);
    const unsupported = FORECAST_SUPPORT_MATRIX.filter((s) => s.status === 'unsupported');
    expect(unsupported.length).toBe(12);
    expect(unsupported.every((s) => s.key.startsWith('automatic_'))).toBe(true);
    expect(FORECAST_SUPPORT_MATRIX.length).toBe(36);
  });
});
