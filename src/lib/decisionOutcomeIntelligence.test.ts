// Phase AI-OPS-11 — Decision Memory & Outcome Intelligence 순수 로직 단위 테스트.
// 승인≠성공 · 실행 Reference≠검증 · 관찰 미종료 확정 금지 · baseline 0 대체 금지 ·
// 상관≠인과 · 단일 성공=single_observation · 품질은 결과와 독립 · 미실행 추천 제외 ·
// 표본 방어 · 패턴 원인 단정 없음 · Lesson 사람 검토 · 유사 검색 차이점 표시.
import { describe, it, expect } from 'vitest';
import {
  validateDecisionRecord, decisionStatusFacts, classifyExecutionVerification,
  validateObservationWindow, canCloseObservation, classifyBaselineAvailability,
  calculateActualOutcome, evaluateExpectedVsActual, classifyOutcomeStatus,
  evaluateCausality, evaluateRepeatability, calculateDecisionQuality, calculateDecisionOutcomeScore,
  evaluateRecommendationAccuracy, calculateConfidenceCalibration, detectDecisionPatterns,
  buildLessonsLearned, calculateAdoptionRate, calculateObservationRate, findSimilarDecisions,
  buildDecisionTimeline, DM_SUPPORT,
  type MetricVerdict, type DecisionPatternRecord,
} from './decisionOutcomeIntelligence';

const NOW = new Date('2026-07-14T12:00:00Z');

describe('Decision Record(승인 ≠ 성공)', () => {
  it('검증 — domain/type whitelist·summary·evidence 필수 · 미존재 type 차단', () => {
    expect(validateDecisionRecord({ domain: 'operations', type: 'accept_recommendation', summary: 's', evidence: [1] })).toEqual([]);
    expect(validateDecisionRecord({ domain: 'operations', type: 'auto_execute', summary: 's', evidence: [1] }).some((e) => e.includes('type'))).toBe(true);
    expect(validateDecisionRecord({ domain: 'hr', type: 'manual', summary: 's', evidence: [1] }).some((e) => e.includes('domain'))).toBe(true);
    expect(validateDecisionRecord({ domain: 'manual', type: 'manual', summary: ' ', evidence: [] }).length).toBe(2);
    expect(validateDecisionRecord(null)).toEqual(['record 없음']);
  });
  it('decided ≠ executed · evaluated ≠ causality confirmed', () => {
    expect(decisionStatusFacts('decided').executed).toBe(false);
    expect(decisionStatusFacts('evaluated').causalityConfirmed).toBe(false);
    expect(decisionStatusFacts('cancelled').terminal).toBe(true);
  });
});

describe('Execution Reference(외부 보고 ≠ 내부 검증)', () => {
  it('externally_reported_success 는 내부 검증 아님 · 내부 관측만 verified', () => {
    expect(classifyExecutionVerification('externally_reported_success').internallyVerified).toBe(false);
    expect(classifyExecutionVerification('externally_reported_success').note).toContain('내부 검증 완료 아님');
    expect(classifyExecutionVerification('internally_observed_effect').internallyVerified).toBe(true);
    expect(classifyExecutionVerification('partially_verified').internallyVerified).toBe(true);
    expect(classifyExecutionVerification('execution_unverified').note).toContain('단정 금지');
  });
});

describe('Observation / Baseline', () => {
  it('기간 검증 · 종료 전 closed 금지 · null→0 없음', () => {
    expect(validateObservationWindow({ startAt: new Date('2026-07-01'), endAt: new Date('2026-07-08') })).toEqual([]);
    expect(validateObservationWindow({ startAt: new Date('2026-07-08'), endAt: new Date('2026-07-01') }).some((e) => e.includes('기간 오류'))).toBe(true);
    expect(validateObservationWindow({ startAt: null, endAt: null })).toEqual(['관찰 기간 필수']);
    expect(canCloseObservation(new Date('2026-07-20T00:00:00Z'), NOW)).toBe(false);
    expect(canCloseObservation(new Date('2026-07-10T00:00:00Z'), NOW)).toBe(true);
  });
  it('baseline — available/partial/unavailable/not_comparable', () => {
    expect(classifyBaselineAvailability({ values: { mrr: 100, churn: 5 }, expectedMetrics: ['mrr', 'churn'], comparable: true })).toBe('baseline_available');
    expect(classifyBaselineAvailability({ values: { mrr: 100, churn: null }, expectedMetrics: ['mrr', 'churn'], comparable: true })).toBe('baseline_partial');
    expect(classifyBaselineAvailability({ values: null, expectedMetrics: ['mrr'], comparable: true })).toBe('baseline_unavailable');
    expect(classifyBaselineAvailability({ values: { mrr: 100 }, expectedMetrics: ['mrr'], comparable: false })).toBe('baseline_not_comparable');
    expect(classifyBaselineAvailability({ values: { mrr: 100 }, expectedMetrics: [], comparable: true })).toBe('insufficient_data');
  });
});

describe('Actual Outcome(0 대체 금지)', () => {
  it('절대/퍼센트 변화 · baseline 0 → % null · baseline/actual null 처리', () => {
    const r = calculateActualOutcome({ metric: 'mrr', baseline: 100, actual: 120, sampleSize: 30 });
    expect(r.absoluteChange).toBe(20); expect(r.percentageChange).toBe(20); expect(r.status).toBe('computed');
    expect(calculateActualOutcome({ metric: 'x', baseline: 0, actual: 10 }).percentageChange).toBeNull();
    expect(calculateActualOutcome({ metric: 'x', baseline: null, actual: 10 }).status).toBe('baseline_unavailable');
    expect(calculateActualOutcome({ metric: 'x', baseline: 100, actual: null }).status).toBe('insufficient_data');
    expect(calculateActualOutcome({ metric: 'x', baseline: 100, actual: 110, sampleSize: -5 }).sampleSize).toBeNull();
  });
});

describe('Expected vs Actual(임의 threshold 금지)', () => {
  const base = { target: 120, acceptableRange: null, baseline: 100, observationClosed: true };
  it('increase — exceeded/met/partial/regressed · 미종료 pending · baseline 없음', () => {
    expect(evaluateExpectedVsActual({ ...base, direction: 'increase', actual: 130 })).toBe('exceeded_expectation');
    expect(evaluateExpectedVsActual({ ...base, direction: 'increase', actual: 120 })).toBe('met_expectation');
    expect(evaluateExpectedVsActual({ ...base, direction: 'increase', actual: 110 })).toBe('partially_met');
    expect(evaluateExpectedVsActual({ ...base, direction: 'increase', actual: 90 })).toBe('regressed');
    expect(evaluateExpectedVsActual({ ...base, direction: 'increase', actual: 100 })).toBe('no_material_change');
    expect(evaluateExpectedVsActual({ ...base, direction: 'increase', actual: 130, observationClosed: false })).toBe('outcome_pending');
    expect(evaluateExpectedVsActual({ ...base, direction: 'increase', actual: 130, baseline: null })).toBe('baseline_unavailable');
    expect(evaluateExpectedVsActual({ ...base, direction: 'increase', actual: null })).toBe('insufficient_data');
  });
  it('decrease/range/maintain/no_regression/unknown — 허용 범위 없으면 판정 금지', () => {
    expect(evaluateExpectedVsActual({ direction: 'decrease', target: 80, acceptableRange: null, baseline: 100, actual: 70, observationClosed: true })).toBe('exceeded_expectation');
    expect(evaluateExpectedVsActual({ direction: 'range', target: null, acceptableRange: { min: 90, max: 110 }, baseline: null, actual: 100, observationClosed: true })).toBe('met_expectation');
    expect(evaluateExpectedVsActual({ direction: 'range', target: null, acceptableRange: { min: 90, max: 110 }, baseline: null, actual: 120, observationClosed: true })).toBe('missed_expectation');
    expect(evaluateExpectedVsActual({ direction: 'maintain', target: null, acceptableRange: null, baseline: 100, actual: 100, observationClosed: true })).toBe('insufficient_data');
    expect(evaluateExpectedVsActual({ direction: 'no_regression', target: null, acceptableRange: { min: 95, max: null }, baseline: 100, actual: 90, observationClosed: true })).toBe('regressed');
    expect(evaluateExpectedVsActual({ direction: 'unknown', target: null, acceptableRange: null, baseline: 100, actual: 100, observationClosed: true })).toBe('insufficient_data');
  });
  it('집계 — positive/mixed/neutral/negative/pending · positive ≠ 인과 확정', () => {
    const V = (v: MetricVerdict) => v;
    expect(classifyOutcomeStatus([V('met_expectation'), V('exceeded_expectation')]).status).toBe('positive');
    expect(classifyOutcomeStatus([V('met_expectation'), V('regressed')]).status).toBe('mixed');
    expect(classifyOutcomeStatus([V('missed_expectation'), V('regressed')]).status).toBe('negative');
    expect(classifyOutcomeStatus([V('no_material_change')]).status).toBe('neutral');
    expect(classifyOutcomeStatus([V('met_expectation'), V('outcome_pending')]).status).toBe('pending');
    expect(classifyOutcomeStatus([V('baseline_unavailable')]).status).toBe('insufficient_data');
    expect(classifyOutcomeStatus([V('met_expectation')]).causalityConfirmed).toBe(false);
    expect(classifyOutcomeStatus([]).status).toBe('insufficient_data');
  });
});

describe('Causality(상관 ≠ 인과)', () => {
  it('temporal/scope/plausible/confounded/unrelated — caused_by 없음', () => {
    expect(evaluateCausality({ temporalCorrelation: true, scopeMatch: null, knownConfounders: 0, controlledExperiment: false })).toBe('temporally_correlated');
    expect(evaluateCausality({ temporalCorrelation: true, scopeMatch: true, knownConfounders: 0, controlledExperiment: false })).toBe('scope_correlated');
    expect(evaluateCausality({ temporalCorrelation: true, scopeMatch: true, knownConfounders: 0, controlledExperiment: true })).toBe('plausible_contribution');
    expect(evaluateCausality({ temporalCorrelation: true, scopeMatch: true, knownConfounders: 2, controlledExperiment: true })).toBe('confounded');
    expect(evaluateCausality({ temporalCorrelation: false, scopeMatch: false, knownConfounders: 0, controlledExperiment: false })).toBe('unrelated');
    expect(evaluateCausality({ temporalCorrelation: null, scopeMatch: null, knownConfounders: null, controlledExperiment: false })).toBe('insufficient_data');
  });
});

describe('Repeatability(단일 성공 ≠ 재현 보장)', () => {
  it('single/partial/consistent/inconsistent/insufficient', () => {
    expect(evaluateRepeatability(['positive'])).toBe('single_observation');
    expect(evaluateRepeatability(['positive', 'positive'])).toBe('partially_repeated');
    expect(evaluateRepeatability(['positive', 'positive', 'positive'])).toBe('consistently_observed');
    expect(evaluateRepeatability(['positive', 'negative'])).toBe('inconsistent');
    expect(evaluateRepeatability([])).toBe('insufficient_data');
  });
});

describe('Decision Quality(결과와 독립)', () => {
  const full = { evidenceCount: 4, alternativesConsidered: true, riskDisclosed: true, preconditionsRecorded: true, limitationsDisclosed: true, humanReviewed: true, segregationOfDuties: true, baselineAvailable: true, outcomeMeasurable: true, auditRecorded: true };
  it('well/weak/unsupported · 성분 재정규화 · outcome 입력 자체가 없음(결과 무관)', () => {
    expect(calculateDecisionQuality(full).quality).toBe('well_supported');
    expect(calculateDecisionQuality({ ...full, evidenceCount: 0, alternativesConsidered: false, riskDisclosed: false, humanReviewed: false, segregationOfDuties: false, limitationsDisclosed: false, preconditionsRecorded: false, baselineAvailable: false, outcomeMeasurable: false, auditRecorded: false }).quality).toBe('unsupported');
    const partial = calculateDecisionQuality({ ...full, segregationOfDuties: null, auditRecorded: null });
    expect(partial.missing).toEqual(['segregation', 'audit']);
    expect(calculateDecisionQuality({ evidenceCount: null, alternativesConsidered: null, riskDisclosed: null, preconditionsRecorded: null, limitationsDisclosed: null, humanReviewed: null, segregationOfDuties: null, baselineAvailable: null, outcomeMeasurable: null, auditRecorded: null }).quality).toBe('insufficient_data');
  });
  it('Outcome Score — 재정규화 · 인사 평가 금지 플래그', () => {
    const r = calculateDecisionOutcomeScore({ expectedAchievement: 80, regressionAvoidance: 90, riskRealization: null, unintendedEffects: null, observationCoverage: 70, dataQuality: 60, repeatability: null, benefitPersistence: null });
    expect(r.score).not.toBeNull(); expect(r.missing.length).toBe(4);
    expect(r.notForPersonnelEvaluation).toBe(true);
    expect(calculateDecisionOutcomeScore({ expectedAchievement: null, regressionAvoidance: null, riskRealization: null, unintendedEffects: null, observationCoverage: null, dataQuality: null, repeatability: null, benefitPersistence: null }).score).toBeNull();
  });
});

describe('Recommendation Accuracy(미실행 제외)', () => {
  it('not_executed/direction/risk/pending', () => {
    expect(evaluateRecommendationAccuracy({ approved: false, executionReferenced: false, metricVerdict: 'met_expectation', riskPredicted: null, riskRealized: null })).toBe('not_executed');
    expect(evaluateRecommendationAccuracy({ approved: true, executionReferenced: false, metricVerdict: 'met_expectation', riskPredicted: null, riskRealized: null })).toBe('not_executed');
    expect(evaluateRecommendationAccuracy({ approved: true, executionReferenced: true, metricVerdict: 'met_expectation', riskPredicted: null, riskRealized: null })).toBe('direction_correct');
    expect(evaluateRecommendationAccuracy({ approved: true, executionReferenced: true, metricVerdict: 'regressed', riskPredicted: null, riskRealized: null })).toBe('direction_incorrect');
    expect(evaluateRecommendationAccuracy({ approved: true, executionReferenced: true, metricVerdict: 'partially_met', riskPredicted: null, riskRealized: null })).toBe('partially_correct');
    expect(evaluateRecommendationAccuracy({ approved: true, executionReferenced: true, metricVerdict: 'missed_expectation', riskPredicted: false, riskRealized: true })).toBe('risk_underestimated');
    expect(evaluateRecommendationAccuracy({ approved: true, executionReferenced: true, metricVerdict: 'met_expectation', riskPredicted: true, riskRealized: false })).toBe('risk_overestimated');
    expect(evaluateRecommendationAccuracy({ approved: true, executionReferenced: true, metricVerdict: 'outcome_pending', riskPredicted: null, riskRealized: null })).toBe('outcome_pending');
    expect(evaluateRecommendationAccuracy({ approved: true, executionReferenced: true, metricVerdict: null, riskPredicted: null, riskRealized: null })).toBe('insufficient_data');
  });
});

describe('Confidence Calibration(표본 방어)', () => {
  it('표본<5 → sample_too_small · over/under/well candidate', () => {
    expect(calculateConfidenceCalibration([]).verdict).toBe('insufficient_data');
    expect(calculateConfidenceCalibration([{ confidence: 90, verdict: 'direction_correct' }]).verdict).toBe('sample_too_small');
    const over = calculateConfidenceCalibration(Array.from({ length: 6 }, () => ({ confidence: 90, verdict: 'direction_incorrect' as const })));
    expect(over.verdict).toBe('overconfident_candidate');
    const well = calculateConfidenceCalibration(Array.from({ length: 6 }, () => ({ confidence: 92, verdict: 'direction_correct' as const })));
    expect(well.verdict).toBe('well_calibrated');
    const under = calculateConfidenceCalibration(Array.from({ length: 6 }, () => ({ confidence: 30, verdict: 'direction_correct' as const })));
    expect(under.verdict).toBe('underconfident_candidate');
    // not_executed 는 계산 제외
    expect(calculateConfidenceCalibration(Array.from({ length: 6 }, () => ({ confidence: 90, verdict: 'not_executed' as const }))).verdict).toBe('sample_too_small');
  });
});

describe('Pattern / Lessons / 채택률', () => {
  it('패턴 — 실행 ref 없음/outcome 없음/단일 approver — 원인 단정 없음', () => {
    const R = (over: Partial<DecisionPatternRecord>): DecisionPatternRecord => ({ domain: 'operations', type: 'accept_recommendation', status: 'decided', approverId: 'a1', hasExecutionRef: false, hasOutcome: false, ...over });
    const patterns = detectDecisionPatterns([R({}), R({}), R({ type: 'accept_recommendation' })]);
    expect(patterns.find((p) => p.pattern === '실행 Reference 없는 결정')!.count).toBe(3);
    expect(patterns.find((p) => p.pattern === '단일 Approver 의존')).toBeTruthy();
    expect(patterns.find((p) => p.pattern === 'operations 반복 승인')!.count).toBe(3);
    expect(patterns.every((p) => p.note.includes('원인 단정 없음'))).toBe(true);
    expect(detectDecisionPatterns([])).toEqual([]);
  });
  it('Lesson — 미확정 결과 금지 · 과거 없으면 best practice 생성 금지 · 사람 검토 필수', () => {
    expect('insufficient' in buildLessonsLearned({ context: 'c', decisionSummary: 'd', expected: 'e', actual: 'a', outcomeStatus: 'pending', repeatability: 'not_evaluated', priorSimilarCount: 3 })).toBe(true);
    const noPrior = buildLessonsLearned({ context: 'c', decisionSummary: 'd', expected: 'e', actual: 'a', outcomeStatus: 'positive', repeatability: 'single_observation', priorSimilarCount: 0 });
    if ('insufficient' in noPrior) throw new Error('unexpected');
    expect(noPrior.reusableInsight).toBeNull();
    expect(noPrior.nonReusableConditions.join(' ')).toContain('best practice 아님');
    expect(noPrior.humanReviewRequired).toBe(true); expect(noPrior.autoBestPractice).toBe(false);
    const withPrior = buildLessonsLearned({ context: 'c', decisionSummary: 'd', expected: 'e', actual: 'a', outcomeStatus: 'positive', repeatability: 'consistently_observed', priorSimilarCount: 4 });
    if ('insufficient' in withPrior) throw new Error('unexpected');
    expect(withPrior.reusableInsight).toContain('보장 아님');
  });
  it('채택률/관측률 — 모수 0 → null(0% 단정 금지)', () => {
    expect(calculateAdoptionRate({ accepted: 3, rejected: 1 })).toBe(75);
    expect(calculateAdoptionRate({ accepted: 0, rejected: 0 })).toBeNull();
    expect(calculateAdoptionRate({ accepted: null, rejected: 1 })).toBeNull();
    expect(calculateObservationRate({ decided: 4, observed: 2 })).toBe(50);
    expect(calculateObservationRate({ decided: 0, observed: 0 })).toBeNull();
  });
});

describe('Similarity / Timeline / Support', () => {
  it('유사 검색 — 공유/차이 context 필수 표시 · 과거 outcome 포함 · 적용 한계', () => {
    const r = findSimilarDecisions({ domain: 'policy', type: 'accept_recommendation', sourceSystem: 'ai_policy_recommendations' }, [
      { id: 'd1', domain: 'policy', type: 'accept_recommendation', sourceSystem: 'ai_policy_recommendations', outcomeStatus: 'positive', repeatability: 'single_observation' },
      { id: 'd2', domain: 'security', type: 'reject_recommendation', sourceSystem: 'ai_security_access_reviews', outcomeStatus: null, repeatability: null },
    ]);
    expect(r.find((x) => x.id === 'd1')!.verdict).toBe('highly_relevant');
    expect(r.find((x) => x.id === 'd1')!.applicabilityNote).toContain('단일 관찰');
    expect(r.find((x) => x.id === 'd2')!.verdict).toBe('not_comparable');
    expect(r.find((x) => x.id === 'd2')!.differentContext.length).toBe(3);
    expect(findSimilarDecisions({ domain: 'x', type: 'manual', sourceSystem: 'manual_decision' }, [])).toEqual([]);
  });
  it('Timeline 시간순 정렬 · Support Matrix 자동 실행/인사 평가 전부 unsupported', () => {
    const t = buildDecisionTimeline([
      { eventType: 'b', detail: null, actorId: null, createdAt: '2026-07-02T00:00:00Z' },
      { eventType: 'a', detail: null, actorId: null, createdAt: '2026-07-01T00:00:00Z' },
    ]);
    expect(t[0].eventType).toBe('a');
    expect(DM_SUPPORT.find((s) => s.key === 'execution_reference')!.status).toBe('external_reference_only');
    expect(DM_SUPPORT.find((s) => s.key === 'causality_review')!.status).toBe('causality_unverified');
    expect(DM_SUPPORT.find((s) => s.key === 'institutional_memory')!.note).toContain('Vector');
    for (const k of ['auto_decision', 'auto_execution', 'auto_model_training', 'auto_policy_contract_settlement', 'auto_trust_change', 'personnel_evaluation', 'production_apply']) {
      expect(DM_SUPPORT.find((s) => s.key === k)!.status).toBe('unsupported');
    }
  });
});
