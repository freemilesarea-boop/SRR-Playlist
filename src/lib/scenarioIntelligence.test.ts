import { describe, expect, it } from 'vitest';
import {
  SCENARIO_DOMAINS, BLOCKED_SCENARIO_DOMAINS, TEMPLATE_SOURCE_TYPES, TEMPLATE_STATUSES,
  VERSION_COMPATIBILITY_RESULTS, SCENARIO_VARIABLE_TYPES, INJECTION_RESULTS, REPLAY_RESULTS,
  TRANSITION_TYPES, FUTURE_CASE_TYPES, RUN_MODES, BLOCKED_RUN_MODES, SCENARIO_RUN_STATUSES,
  SCENARIO_BRANCH_STATUSES, SCENARIO_COMPARISON_DIMENSIONS, TRADEOFF_TYPES, TRADEOFF_RESULTS,
  ROBUSTNESS_RESULTS, REGRET_RESULTS, ACCURACY_RESULTS, DRIFT_RESULTS, SCENARIO_RECOMMENDATION_TYPES,
  buildScenarioTemplate, validateScenarioVersion, validateScenarioVariables, evaluateScenarioInjection,
  evaluateHistoricalReplay, detectReplayGaps, buildDecisionPoint, evaluateBranchCondition,
  calculateBranchProbabilityCandidate, horizonConfidenceCap, generateMultiFutureSet,
  projectScenarioRisk, projectScenarioOpportunity, compareScenarioFutures, evaluateTradeoffs,
  evaluateRobustness, evaluateRegret, detectCommonRisks, detectCommonSafeConditions,
  evaluateScenarioOutcome, calculateScenarioAccuracyCandidate, calculateScenarioDriftCandidate,
  buildScenarioRecommendation, buildScenarioTimeline, SCENARIO_COMPONENTS, SCENARIO_SUPPORT_MATRIX,
} from './scenarioIntelligence';

describe('scenarioIntelligence 상수(0542 CHECK 정렬)', () => {
  it('whitelist 개수 고정 — 도메인 23·금지 13·source 9·status 9/13/10·transition 14·case 14·mode 7·금지 mode 5·추천 23', () => {
    expect(SCENARIO_DOMAINS).toHaveLength(23);
    expect(BLOCKED_SCENARIO_DOMAINS).toHaveLength(13);
    expect(TEMPLATE_SOURCE_TYPES).toHaveLength(9);
    expect(TEMPLATE_STATUSES).toHaveLength(9);
    expect(VERSION_COMPATIBILITY_RESULTS).toHaveLength(6);
    expect(SCENARIO_VARIABLE_TYPES).toHaveLength(14);
    expect(INJECTION_RESULTS).toHaveLength(13);
    expect(REPLAY_RESULTS).toHaveLength(13);
    expect(TRANSITION_TYPES).toHaveLength(14);
    expect(FUTURE_CASE_TYPES).toHaveLength(14);
    expect(RUN_MODES).toHaveLength(7);
    expect(BLOCKED_RUN_MODES).toHaveLength(5);
    expect(SCENARIO_RUN_STATUSES).toHaveLength(13);
    expect(SCENARIO_BRANCH_STATUSES).toHaveLength(10);
    expect(SCENARIO_COMPARISON_DIMENSIONS).toHaveLength(16);
    expect(TRADEOFF_TYPES).toHaveLength(10);
    expect(TRADEOFF_RESULTS).toHaveLength(6);
    expect(ROBUSTNESS_RESULTS).toHaveLength(6);
    expect(REGRET_RESULTS).toHaveLength(7);
    expect(ACCURACY_RESULTS).toHaveLength(9);
    expect(DRIFT_RESULTS).toHaveLength(7);
    expect(SCENARIO_RECOMMENDATION_TYPES).toHaveLength(23);
    expect(BLOCKED_SCENARIO_DOMAINS.filter((d) => (SCENARIO_DOMAINS as readonly string[]).includes(d))).toHaveLength(0);
    expect(BLOCKED_RUN_MODES.filter((m) => (RUN_MODES as readonly string[]).includes(m))).toHaveLength(0);
  });
});

describe('buildScenarioTemplate', () => {
  it('금지 도메인 거부·synthetic 명시·Template ≠ Execution', () => {
    expect(buildScenarioTemplate({ domain: 'destructive_failure_injection', name: 't', sourceType: 'manual_reference', sourceExists: true, variableCount: 1 })).toMatchObject({ rejected: true });
    expect(buildScenarioTemplate({ domain: 'connector_failure', name: 't', sourceType: 'historical_incident', sourceExists: false, variableCount: 1 })).toMatchObject({ rejected: true });
    expect(buildScenarioTemplate({ domain: 'connector_failure', name: 't', sourceType: 'manual_reference', sourceExists: null, variableCount: 101 })).toMatchObject({ rejected: true });
    const syn = buildScenarioTemplate({ domain: 'scale_growth', name: '매장 10배', sourceType: 'synthetic_reference', sourceExists: null, variableCount: 3 });
    expect(syn).toMatchObject({ supportStatus: 'partially_supported', syntheticMarked: true, templateIsNotExecution: true, scenarioIsNotReality: true });
    expect(buildScenarioTemplate({ domain: 'runtime_failure', name: '장애 재발', sourceType: 'historical_incident', sourceExists: true, variableCount: 3 })).toMatchObject({ supportStatus: 'supported_reference', status: 'draft' });
  });
});

describe('validateScenarioVersion', () => {
  it('출력 스키마 변경 → breaking·요약 없음 → unverified(버전별 결과 상이 명시)', () => {
    expect(validateScenarioVersion({ templateVersion: 2, previousVersionExists: true, variableSchemaChanged: false, transitionRulesChanged: false, outputSchemaChanged: true, changeSummary: 's' }).result).toBe('breaking_change_candidate');
    expect(validateScenarioVersion({ templateVersion: 2, previousVersionExists: true, variableSchemaChanged: true, transitionRulesChanged: false, outputSchemaChanged: false, changeSummary: 's' }).result).toBe('compatible_with_limitation');
    expect(validateScenarioVersion({ templateVersion: 2, previousVersionExists: false, variableSchemaChanged: false, transitionRulesChanged: false, outputSchemaChanged: false, changeSummary: 's' }).result).toBe('version_unverified');
    expect(validateScenarioVersion({ templateVersion: 2, previousVersionExists: true, variableSchemaChanged: false, transitionRulesChanged: false, outputSchemaChanged: false, changeSummary: '' }).result).toBe('version_unverified');
    expect(validateScenarioVersion({ templateVersion: 2, previousVersionExists: true, variableSchemaChanged: false, transitionRulesChanged: false, outputSchemaChanged: false, changeSummary: 's' })).toMatchObject({ result: 'backward_compatible_reference', versionResultsMayDiffer: true });
  });
});

describe('validateScenarioVariables', () => {
  it('NaN/Infinity/음수/percentage 범위/duration 상한 차단·Unknown 유지', () => {
    const r = validateScenarioVariables([
      { code: 'ok_count', type: 'count', value: 5 },
      { code: 'nan', type: 'decimal', value: Number.NaN },
      { code: 'inf', type: 'integer', value: Number.POSITIVE_INFINITY },
      { code: 'neg', type: 'count', value: -1 },
      { code: 'pct', type: 'percentage', value: 150 },
      { code: 'dur', type: 'duration', value: 600000 },
      { code: 'unk', type: 'unknown', value: null },
      { code: 'range', type: 'integer', value: 5, min: 10 },
      { code: 'bad_type', type: 'weird', value: 1 },
    ]);
    expect(r.rows.map((x) => x.result)).toEqual(['valid', 'nan_or_infinity_blocked', 'nan_or_infinity_blocked', 'negative_blocked', 'percentage_out_of_range', 'duration_exceeded', 'unknown_kept', 'invalid_range', 'invalid_type']);
    expect(r).toMatchObject({ validCount: 1, unknownKept: true });
  });
});

describe('evaluateScenarioInjection', () => {
  it('승인 선행·cross-enterprise 차단·reviewer 필수(Injection ≠ Failure Injection)', () => {
    const base = { templateStatus: 'approved_for_replay_reference', snapshotStatus: 'captured_reference', snapshotAgeHours: 1, staleAfterHours: 24, requiredLayersCovered: true, requiredSourcesCovered: true, variablesValid: true, scopeMatched: true, crossEnterprise: false, horizonMinutes: 1440, evidenceCount: 1, reviewerAssigned: true };
    expect(evaluateScenarioInjection({ ...base, crossEnterprise: true }).result).toBe('cross_enterprise_blocked');
    expect(evaluateScenarioInjection({ ...base, templateStatus: 'draft' }).result).toBe('template_unapproved');
    expect(evaluateScenarioInjection({ ...base, snapshotAgeHours: 100 }).result).toBe('snapshot_stale_candidate');
    expect(evaluateScenarioInjection({ ...base, reviewerAssigned: false }).result).toBe('reviewer_missing');
    expect(evaluateScenarioInjection({ ...base, horizonMinutes: 600000 }).result).toBe('horizon_too_long');
    expect(evaluateScenarioInjection(base)).toMatchObject({ result: 'injection_ready_reference', injectionIsNotFailureInjection: true, productionChanged: false });
  });
});

describe('evaluateHistoricalReplay + detectReplayGaps', () => {
  it('원천 없음 → replay_unavailable·gap/duplicate/ordering/bias 구분(Replay ≠ Reoccurrence)', () => {
    const base = { sourceAvailable: true, eventCount: 50, minSample: 10, gapCount: 0, duplicateCount: 0, orderingVerified: true, scopeMatched: true, externalFactorsReviewed: true, selectionBiasReviewed: true, newestEventAgeDays: 1, staleAfterDays: 90 };
    expect(evaluateHistoricalReplay({ ...base, sourceAvailable: false }).result).toBe('replay_unavailable');
    expect(evaluateHistoricalReplay({ ...base, eventCount: 3 }).result).toBe('sample_too_small');
    expect(evaluateHistoricalReplay({ ...base, gapCount: 2 }).result).toBe('replay_event_gap_candidate');
    expect(evaluateHistoricalReplay({ ...base, duplicateCount: 1 }).result).toBe('replay_duplicate_candidate');
    expect(evaluateHistoricalReplay({ ...base, orderingVerified: false }).result).toBe('replay_order_unverified');
    expect(evaluateHistoricalReplay({ ...base, selectionBiasReviewed: false }).result).toBe('replay_bias_candidate');
    expect(evaluateHistoricalReplay(base)).toMatchObject({ result: 'replay_ready_reference', replayIsNotReoccurrence: true, historicalEventIsNotFutureEvent: true });
    const gaps = detectReplayGaps([{ seq: 1, occurredAt: new Date(1) }, { seq: 3, occurredAt: new Date(2) }, { seq: 3, occurredAt: new Date(3) }]);
    expect(gaps).toMatchObject({ gapCount: 1, duplicateCount: 1, missingSeqs: [2], result: 'gaps_detected_candidate' });
  });
});

describe('buildDecisionPoint + evaluateBranchCondition', () => {
  it('선택지 2개 미만 거부·AI 는 결정하지 않음·unknown transition 유지', () => {
    expect(buildDecisionPoint({ code: 'dp1', context: 'ctx', availableOptions: ['a'], humanRoleRequired: true })).toMatchObject({ rejected: true });
    expect(buildDecisionPoint({ code: 'dp1', context: 'ctx', availableOptions: ['a', 'b'], humanRoleRequired: true })).toMatchObject({ decisionMadeByAi: false, humanRoleRequired: true, decisionPointIsNotDecision: true });
    expect(evaluateBranchCondition({ transitionType: 'weird', conditionDefined: true }).result).toBe('transition_type_invalid');
    expect(evaluateBranchCondition({ transitionType: 'unknown', conditionDefined: false }).result).toBe('unknown_kept');
    expect(evaluateBranchCondition({ transitionType: 'metric_threshold', conditionDefined: true })).toMatchObject({ result: 'condition_valid_reference', transitionIsNotRealStateChange: true });
  });
});

describe('calculateBranchProbabilityCandidate', () => {
  it('근거 없으면 branch_probability_unverified·표본 부족 유지(확률 ≠ 실제 확률)', () => {
    expect(calculateBranchProbabilityCandidate({ historicalOccurrences: 5, historicalSample: 100, minSample: 10, basisDescribed: false })).toMatchObject({ probabilityCandidate: null, result: 'branch_probability_unverified' });
    expect(calculateBranchProbabilityCandidate({ historicalOccurrences: 5, historicalSample: 4, minSample: 10, basisDescribed: true }).result).toBe('sample_too_small');
    expect(calculateBranchProbabilityCandidate({ historicalOccurrences: 25, historicalSample: 100, minSample: 10, basisDescribed: true })).toMatchObject({ probabilityCandidate: 25, result: 'probability_candidate_estimated', probabilityIsNotTrueProbability: true, estimatedIsNotMeasured: true });
  });
});

describe('horizonConfidenceCap + generateMultiFutureSet', () => {
  it('기간별 상한(24h:90/7d:75/30d:60/90d:40/초과:25)·Future ≠ Fact', () => {
    expect(horizonConfidenceCap(1440).cap).toBe(90);
    expect(horizonConfidenceCap(7 * 1440).cap).toBe(75);
    expect(horizonConfidenceCap(30 * 1440).cap).toBe(60);
    expect(horizonConfidenceCap(90 * 1440).cap).toBe(40);
    expect(horizonConfidenceCap(180 * 1440).cap).toBe(25);
    expect(horizonConfidenceCap(null).result).toBe('insufficient_data');
    const set = generateMultiFutureSet({ requestedCases: ['base_case_candidate', 'best_case_candidate', 'worst_case_candidate', 'no_action_candidate', 'weird_case'], baselineAvailable: true, horizonMinutes: 7 * 1440 });
    expect(set.cases.filter((c) => c.status === 'case_defined_reference')).toHaveLength(4);
    expect(set.cases[0].confidenceCap).toBe(75);
    expect(set).toMatchObject({ result: 'multi_future_defined_reference', futureIsNotFact: true, bestCaseIsNotExpectedOutcome: true, worstCaseIsNotGuaranteedFailure: true });
    expect(generateMultiFutureSet({ requestedCases: ['base_case_candidate'], baselineAvailable: false, horizonMinutes: 1440 }).result).toBe('baseline_missing');
  });
});

describe('projectScenarioRisk/Opportunity', () => {
  it('연쇄 장애/SPOF 후보·Evidence 없는 기회 차단(No Detected Risk ≠ No Risk)', () => {
    expect(projectScenarioRisk({ incidentProbabilityCandidate: 10, failureChainDetected: true, singlePointOfFailure: false, recoveryDifficultyHigh: false, reviewed: true }).result).toBe('cascading_failure_candidate');
    expect(projectScenarioRisk({ incidentProbabilityCandidate: 70, failureChainDetected: false, singlePointOfFailure: false, recoveryDifficultyHigh: true, reviewed: true }).result).toBe('critical_risk_candidate');
    expect(projectScenarioRisk({ incidentProbabilityCandidate: null, failureChainDetected: false, singlePointOfFailure: false, recoveryDifficultyHigh: null, reviewed: false })).toMatchObject({ result: 'risk_unverified', noDetectedRiskIsNotNoRisk: true });
    expect(projectScenarioOpportunity({ reviewed: true, costReduction: true, capacityIncrease: true, fasterRecovery: null, adverseSignals: 0, evidenceCount: 0 }).result).toBe('opportunity_unverified');
    expect(projectScenarioOpportunity({ reviewed: true, costReduction: true, capacityIncrease: true, fasterRecovery: null, adverseSignals: 1, evidenceCount: 2 }).result).toBe('mixed_opportunity_candidate');
    expect(projectScenarioOpportunity({ reviewed: true, costReduction: true, capacityIncrease: true, fasterRecovery: null, adverseSignals: 0, evidenceCount: 2 }).result).toBe('opportunity_candidate');
  });
});

describe('compareScenarioFutures', () => {
  it('scope/horizon/version 불일치 거부·결측 차원 unverified·자동 승자 없음', () => {
    const run = (over: Partial<{ runCode: string; scopeType: string; horizonMinutes: number; templateVersion: number; dimensions: Record<string, number | null> }> = {}) => ({ runCode: 'A', scopeType: 'enterprise', horizonMinutes: 1440, templateVersion: 1, dimensions: { risk: 3, cost: 100 }, ...over });
    expect(compareScenarioFutures([run()]).result).toBe('insufficient_runs');
    expect(compareScenarioFutures([run(), run({ scopeType: 'store' })]).result).toBe('incomparable_scope');
    expect(compareScenarioFutures([run(), run({ horizonMinutes: 999 })]).result).toBe('incomparable_horizon');
    expect(compareScenarioFutures([run(), run({ templateVersion: 2 })]).result).toBe('incompatible_version');
    const ok = compareScenarioFutures([run(), run({ runCode: 'B', dimensions: { risk: 5, cost: 80 } })]);
    expect(ok.comparableDimensions).toEqual(['risk', 'cost']);
    expect(ok.unverifiedDimensions).toContain('mttr');
    expect(ok).toMatchObject({ result: 'comparison_partial', comparisonIsNotAutomaticRanking: true, winnerIsNotSelectedDecision: true, autoSelected: false });
  });
});

describe('evaluateTradeoffs', () => {
  it('favorable/unfavorable/mixed/unverified 구분(Score ≠ Business Value)', () => {
    const r = evaluateTradeoffs([
      { type: 'risk_vs_cost', gain: 10, loss: 0 },
      { type: 'speed_vs_safety', gain: 0, loss: 5 },
      { type: 'growth_vs_stability', gain: 5, loss: 5 },
      { type: 'cost_vs_reliability', gain: null, loss: 5 },
    ]);
    expect(r.rows.map((x) => x.result)).toEqual(['favorable_tradeoff_candidate', 'unfavorable_tradeoff_candidate', 'mixed_tradeoff_candidate', 'tradeoff_unverified']);
    expect(r.tradeoffScoreIsNotBusinessValue).toBe(true);
  });
});

describe('evaluateRobustness', () => {
  it('worst 도 바닥 위 → robust·민감도 높으면 conditional·바닥 아래 fragile(Robust ≠ Correct)', () => {
    expect(evaluateRobustness({ bestCaseScore: 90, baseCaseScore: 70, worstCaseScore: 55, acceptableFloor: 50, sensitivityHigh: false })).toMatchObject({ result: 'robust_option_candidate', robustOptionIsNotCorrectOption: true });
    expect(evaluateRobustness({ bestCaseScore: 90, baseCaseScore: 70, worstCaseScore: 55, acceptableFloor: 50, sensitivityHigh: true }).result).toBe('conditionally_robust_candidate');
    expect(evaluateRobustness({ bestCaseScore: 90, baseCaseScore: 40, worstCaseScore: 20, acceptableFloor: 50, sensitivityHigh: false }).result).toBe('scenario_specific_candidate');
    expect(evaluateRobustness({ bestCaseScore: 45, baseCaseScore: 40, worstCaseScore: 20, acceptableFloor: 50, sensitivityHigh: false }).result).toBe('fragile_option_candidate');
    expect(evaluateRobustness({ bestCaseScore: null, baseCaseScore: 70, worstCaseScore: 55, acceptableFloor: 50, sensitivityHigh: false }).result).toBe('robustness_unverified');
  });
});

describe('evaluateRegret', () => {
  it('대안 미평가 unverified·비가역+큰 손실 asymmetric(Lowest Regret ≠ Best Decision)', () => {
    expect(evaluateRegret({ chosenOutcome: 80, bestAlternativeOutcome: 90, worstCaseLoss: 5, reversible: true, alternativesEvaluated: 0 }).result).toBe('regret_unverified');
    expect(evaluateRegret({ chosenOutcome: 90, bestAlternativeOutcome: 85, worstCaseLoss: 5, reversible: true, alternativesEvaluated: 2 })).toMatchObject({ result: 'lowest_regret_candidate', lowestRegretIsNotBestDecision: true });
    expect(evaluateRegret({ chosenOutcome: 50, bestAlternativeOutcome: 90, worstCaseLoss: 5, reversible: true, alternativesEvaluated: 2 }).result).toBe('high_regret_candidate');
    expect(evaluateRegret({ chosenOutcome: 88, bestAlternativeOutcome: 90, worstCaseLoss: 50, reversible: false, alternativesEvaluated: 2 }).result).toBe('asymmetric_regret_candidate');
  });
});

describe('detectCommonRisks/SafeConditions', () => {
  it('교집합 후보 — 미검출 ≠ 무위험', () => {
    expect(detectCommonRisks([['a', 'b', 'c'], ['b', 'c'], ['c', 'b', 'd']])).toMatchObject({ commonRisks: ['b', 'c'], result: 'common_risks_detected_candidate', noDetectedRiskIsNotNoRisk: true });
    expect(detectCommonRisks([['a'], ['b']]).result).toBe('no_common_risk_detected');
    expect(detectCommonRisks([['a']]).result).toBe('insufficient_data');
    expect(detectCommonSafeConditions([['s1', 's2'], ['s2']])).toMatchObject({ commonSafeConditions: ['s2'], safeConditionIsCandidateOnly: true });
  });
});

describe('evaluateScenarioOutcome + Accuracy + Drift', () => {
  it('외부 요인 미검토 causality_unverified·Accuracy 는 Outcome 연결 후에만·Drift 는 후보', () => {
    expect(evaluateScenarioOutcome({ outcomeLinked: false, observationComplete: null, externalFactorsReviewed: false, sampleSize: 10, minSample: 5 }).result).toBe('outcome_pending');
    expect(evaluateScenarioOutcome({ outcomeLinked: true, observationComplete: false, externalFactorsReviewed: true, sampleSize: 10, minSample: 5 }).result).toBe('observation_partial');
    expect(evaluateScenarioOutcome({ outcomeLinked: true, observationComplete: true, externalFactorsReviewed: false, sampleSize: 10, minSample: 5 }).result).toBe('causality_unverified');
    expect(evaluateScenarioOutcome({ outcomeLinked: true, observationComplete: true, externalFactorsReviewed: true, sampleSize: 10, minSample: 5 })).toMatchObject({ result: 'outcome_linked_reference', outcomeIsNotCausalityProof: true });
    expect(calculateScenarioAccuracyCandidate({ predicted: 100, observed: 105, toleranceRatio: 0.1, outcomeLinked: false, sampleSize: 20, minSample: 5 }).result).toBe('outcome_unverified');
    expect(calculateScenarioAccuracyCandidate({ predicted: 100, observed: 105, toleranceRatio: 0.1, outcomeLinked: true, sampleSize: 20, minSample: 5 })).toMatchObject({ result: 'accuracy_candidate_high', accuracyCandidateIsNotVerifiedAccuracy: true });
    expect(calculateScenarioAccuracyCandidate({ predicted: 100, observed: 300, toleranceRatio: 0.1, outcomeLinked: true, sampleSize: 20, minSample: 5 }).result).toBe('direction_match_only');
    expect(calculateScenarioDriftCandidate([{ dimension: 'cost', driftRatio: 0.05 }, { dimension: 'capacity', driftRatio: 0.02 }])).toMatchObject({ result: 'no_material_drift_candidate', driftCandidateIsNotConfirmedFailure: true });
    expect(calculateScenarioDriftCandidate([{ dimension: 'cost', driftRatio: 0.6 }]).result).toBe('severe_drift_candidate');
    expect(calculateScenarioDriftCandidate([{ dimension: 'cost', driftRatio: null }]).result).toBe('drift_unverified');
  });
});

describe('buildScenarioRecommendation + Timeline', () => {
  it('Evidence 없는 추천 금지·type whitelist·confidence clamp·Timeline whitelist', () => {
    expect(buildScenarioRecommendation({ type: 'execute_scenario_now', reason: 'r', evidence: ['e'], confidence: 50 })).toMatchObject({ rejected: true });
    expect(buildScenarioRecommendation({ type: 'review_regret', reason: 'r', evidence: [], confidence: 50 })).toMatchObject({ rejected: true });
    expect(buildScenarioRecommendation({ type: 'review_regret', reason: 'r', evidence: ['e'], confidence: 150 })).toMatchObject({ confidence: 100, recommendationIsNotDecision: true, humanApprovalRequired: true, autoExecuted: false });
    const t = buildScenarioTimeline([{ stage: 'template', count: 2, source: 'templates 실측' }, { stage: 'weird', count: 1, source: 'x' }, { stage: 'outcome', count: null, source: 'events 실측' }]);
    expect(t.stages).toHaveLength(2);
    expect(t).toMatchObject({ invalidStages: 1, timelineIsNotActualSchedule: true });
  });
});

describe('실측 구성요소·지원 매트릭스', () => {
  it('Replay 원천 9종 가용·부재 6종 명시·automatic_* 계열 unsupported', () => {
    const byKey = Object.fromEntries(SCENARIO_COMPONENTS.map((c) => [c.key, c.available]));
    expect(byKey['runtime_event_sequence_0536']).toBe(true);
    expect(byKey['decision_outcome_0514']).toBe(true);
    expect(byKey['true_probability_model']).toBe(false);
    expect(byKey['chaos_engine']).toBe(false);
    expect(byKey['production_replay_engine']).toBe(false);
    const unsupported = SCENARIO_SUPPORT_MATRIX.filter((s) => s.status === 'unsupported');
    expect(unsupported.length).toBe(10);
    expect(unsupported.every((s) => s.key.startsWith('automatic_'))).toBe(true);
    expect(SCENARIO_SUPPORT_MATRIX.length).toBe(44);
  });
});
