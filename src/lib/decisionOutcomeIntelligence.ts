/**
 * decisionOutcomeIntelligence — Decision Memory & Outcome Intelligence 순수 로직 (Phase AI-OPS-11).
 *
 * Recommendation → Decision → Execution Reference → Observation → Outcome →
 * Expected vs Actual → Quality/Accuracy/Calibration → Patterns → Lessons → Retrieval.
 *
 * 학습 정직성(전부 코드로 강제):
 *  - 승인 ≠ 성공 · 실행 Reference ≠ 실제 실행 검증 · 외부 성공 보고 ≠ 내부 검증.
 *  - 관찰 미종료 → outcome_pending. baseline 없으면 baseline_unavailable(0 대체 금지).
 *  - 상관 ≠ 인과(caused_by 판정 없음). 단일 성공 = single_observation(재현 보장 아님).
 *  - 결과가 좋아도 근거 없으면 well_supported 금지 / 나빠도 근거 충분하면 자동 하락 금지.
 *  - Decision Quality/Outcome Score 는 인사 평가 용도 아님. 표본 부족 시 일반화 금지.
 *  - deterministic · pure · null 안전 · NaN/Infinity 방어 · Date 주입 · Production 변경 없음.
 */
import { isFiniteNumber, normalizeAvailableComponents } from './aiMemory';

/* ── 타입 ─────────────────────────────────────────────────────────────── */
export type DecisionStatus = 'draft' | 'pending_review' | 'waiting_evidence' | 'decided' | 'execution_reference_pending'
  | 'observation_pending' | 'outcome_review_pending' | 'evaluated' | 'invalidated' | 'cancelled' | 'expired';
export type ExecutionVerification = 'reference_recorded' | 'verification_pending' | 'externally_reported_success'
  | 'externally_reported_failure' | 'internally_observed_effect' | 'partially_verified' | 'execution_unverified' | 'invalidated';
export type ExpectedDirection = 'increase' | 'decrease' | 'maintain' | 'no_regression' | 'range' | 'unknown';
export type MetricVerdict = 'exceeded_expectation' | 'met_expectation' | 'partially_met' | 'missed_expectation'
  | 'regressed' | 'no_material_change' | 'outcome_pending' | 'baseline_unavailable' | 'insufficient_data';
export type OutcomeStatus = 'pending' | 'observation_incomplete' | 'positive' | 'mixed' | 'neutral' | 'negative' | 'inconclusive' | 'invalidated' | 'insufficient_data';
export type CausalityStatus = 'not_evaluated' | 'temporally_correlated' | 'scope_correlated' | 'plausible_contribution' | 'causality_unverified' | 'confounded' | 'unrelated' | 'insufficient_data';
export type RepeatabilityStatus = 'not_evaluated' | 'single_observation' | 'partially_repeated' | 'consistently_observed' | 'inconsistent' | 'repeatability_unverified' | 'insufficient_data';
export type DecisionQuality = 'well_supported' | 'adequately_supported' | 'partially_supported' | 'weakly_supported' | 'unsupported' | 'insufficient_data';

export const DECISION_DOMAINS = ['operations', 'execution', 'reliability', 'release', 'capacity', 'cost', 'continuity', 'security', 'privacy', 'compliance', 'executive', 'strategy', 'policy', 'knowledge_graph', 'incident', 'recovery', 'governance', 'manual'] as const;
export const DECISION_TYPES = ['accept_recommendation', 'reject_recommendation', 'defer_decision', 'request_more_evidence', 'retain_current_state', 'approve_reference', 'reject_reference', 'correction_recommended', 'risk_accepted_reference', 'freeze_reference', 'rollback_reference', 'release_reference', 'policy_reference', 'access_reference', 'privacy_reference', 'security_reference', 'executive_reference', 'manual'] as const;

/* ── Decision Record 검증(승인 ≠ 성공) ───────────────────────────────── */
export function validateDecisionRecord(r: { domain?: string; type?: string; summary?: string | null; evidence?: unknown[] | null } | null | undefined): string[] {
  if (!r) return ['record 없음'];
  const errors: string[] = [];
  if (!r.domain || !(DECISION_DOMAINS as readonly string[]).includes(r.domain)) errors.push('허용되지 않는 domain');
  if (!r.type || !(DECISION_TYPES as readonly string[]).includes(r.type)) errors.push('허용되지 않는 decision type');
  if (!r.summary || !r.summary.trim()) errors.push('decision_summary 필수');
  if (!r.evidence || !r.evidence.length) errors.push('Evidence 필수(빈 배열 금지)');
  return errors;
}

/** 상태 의미 고정 — decided 는 실행 완료가 아니고 evaluated 는 인과 확정이 아니다. */
export function decisionStatusFacts(status: DecisionStatus): { executed: false; causalityConfirmed: false; terminal: boolean } {
  return { executed: false, causalityConfirmed: false, terminal: ['invalidated', 'cancelled', 'expired'].includes(status) };
}

/* ── Execution Verification(외부 보고 ≠ 내부 검증) ───────────────────── */
export function classifyExecutionVerification(status: ExecutionVerification): { internallyVerified: boolean; note: string } {
  const internal = status === 'internally_observed_effect' || status === 'partially_verified';
  return {
    internallyVerified: internal,
    note: status === 'externally_reported_success' ? '외부 성공 보고 — 내부 검증 완료 아님'
      : status === 'execution_unverified' ? '실행 확인 불가 — 실행됐다고 단정 금지'
      : internal ? '내부 관측 효과(부분 검증 포함)' : '참고 기록',
  };
}

/* ── Observation Window ──────────────────────────────────────────────── */
export function validateObservationWindow(w: { startAt: Date | null; endAt: Date | null; baselineStartAt?: Date | null; baselineEndAt?: Date | null }): string[] {
  const errors: string[] = [];
  if (!w.startAt || !w.endAt) { errors.push('관찰 기간 필수'); return errors; }
  if (w.endAt.getTime() <= w.startAt.getTime()) errors.push('기간 오류(end ≤ start)');
  if (w.baselineStartAt && w.baselineEndAt && w.baselineEndAt.getTime() <= w.baselineStartAt.getTime()) errors.push('baseline 기간 오류');
  return errors;
}

/** 관찰 종료 전 closed 금지. */
export function canCloseObservation(endAt: Date, now: Date): boolean { return now.getTime() >= endAt.getTime(); }

export type BaselineAvailability = 'baseline_available' | 'baseline_partial' | 'baseline_unavailable' | 'baseline_not_comparable' | 'insufficient_data';
export function classifyBaselineAvailability(input: { values: Record<string, number | null> | null; expectedMetrics: string[]; comparable: boolean | null }): BaselineAvailability {
  if (input.comparable === false) return 'baseline_not_comparable';   // 조건 불일치 강제 비교 금지
  if (!input.expectedMetrics.length) return 'insufficient_data';
  if (input.values == null) return 'baseline_unavailable';
  const present = input.expectedMetrics.filter((m) => isFiniteNumber(input.values![m]));
  if (!present.length) return 'baseline_unavailable';
  return present.length === input.expectedMetrics.length ? 'baseline_available' : 'baseline_partial';
}

/* ── Actual Outcome(0 대체 금지) ─────────────────────────────────────── */
export interface ActualOutcome {
  metric: string; baseline: number | null; actual: number | null;
  absoluteChange: number | null; percentageChange: number | null;
  sampleSize: number | null; status: 'computed' | 'baseline_unavailable' | 'insufficient_data';
}

export function calculateActualOutcome(input: { metric: string; baseline: number | null; actual: number | null; sampleSize?: number | null }): ActualOutcome {
  const sample = isFiniteNumber(input.sampleSize) && input.sampleSize >= 0 ? input.sampleSize : null;
  if (!isFiniteNumber(input.actual)) return { metric: input.metric, baseline: isFiniteNumber(input.baseline) ? input.baseline : null, actual: null, absoluteChange: null, percentageChange: null, sampleSize: sample, status: 'insufficient_data' };
  if (!isFiniteNumber(input.baseline)) return { metric: input.metric, baseline: null, actual: input.actual, absoluteChange: null, percentageChange: null, sampleSize: sample, status: 'baseline_unavailable' };
  const abs = input.actual - input.baseline;
  const pct = input.baseline !== 0 ? Math.round((abs / Math.abs(input.baseline)) * 1000) / 10 : null;   // baseline 0 → % 계산 금지
  return { metric: input.metric, baseline: input.baseline, actual: input.actual, absoluteChange: abs, percentageChange: pct, sampleSize: sample, status: 'computed' };
}

/* ── Expected vs Actual(임의 threshold 금지 — 정의된 허용 범위만) ────── */
export interface ExpectedVsActualInput {
  direction: ExpectedDirection;
  target: number | null;
  acceptableRange: { min: number | null; max: number | null } | null;
  baseline: number | null;
  actual: number | null;
  observationClosed: boolean;
}

export function evaluateExpectedVsActual(i: ExpectedVsActualInput): MetricVerdict {
  if (!i.observationClosed) return 'outcome_pending';                 // 관찰 미종료 — 확정 금지
  if (!isFiniteNumber(i.actual)) return 'insufficient_data';
  if (i.direction === 'unknown') return 'insufficient_data';
  if (i.direction === 'range') {
    if (!i.acceptableRange || (!isFiniteNumber(i.acceptableRange.min) && !isFiniteNumber(i.acceptableRange.max))) return 'insufficient_data';
    const okMin = !isFiniteNumber(i.acceptableRange.min) || i.actual >= i.acceptableRange.min;
    const okMax = !isFiniteNumber(i.acceptableRange.max) || i.actual <= i.acceptableRange.max;
    return okMin && okMax ? 'met_expectation' : 'missed_expectation';
  }
  if (!isFiniteNumber(i.baseline)) return 'baseline_unavailable';     // baseline 없으면 개선률 판정 금지
  const change = i.actual - i.baseline;
  if (i.direction === 'increase' || i.direction === 'decrease') {
    const sign = i.direction === 'increase' ? 1 : -1;
    const moved = change * sign;
    if (isFiniteNumber(i.target)) {
      const targetMove = (i.target - i.baseline) * sign;
      if (targetMove <= 0) return 'insufficient_data';                // target 이 방향과 모순 — 판정 금지
      if (moved >= targetMove) return moved > targetMove ? 'exceeded_expectation' : 'met_expectation';
      if (moved > 0) return 'partially_met';
      return moved < 0 ? 'regressed' : 'no_material_change';
    }
    // target 없음 — 방향만 판정(정도 판정 금지)
    return moved > 0 ? 'partially_met' : moved < 0 ? 'regressed' : 'no_material_change';
  }
  // maintain / no_regression — 허용 범위 정의 없이는 판정 금지(임의 threshold 금지)
  if (!i.acceptableRange || (!isFiniteNumber(i.acceptableRange.min) && !isFiniteNumber(i.acceptableRange.max))) return 'insufficient_data';
  const lo = isFiniteNumber(i.acceptableRange.min) ? i.acceptableRange.min : -Infinity;
  const hi = isFiniteNumber(i.acceptableRange.max) ? i.acceptableRange.max : Infinity;
  if (i.actual >= lo && i.actual <= hi) return 'met_expectation';
  return i.direction === 'no_regression' && i.actual < lo ? 'regressed' : 'missed_expectation';
}

/** Metric 판정 집계 — positive ≠ 인과 확정(플래그 고정). */
export function classifyOutcomeStatus(verdicts: MetricVerdict[]): { status: OutcomeStatus; causalityConfirmed: false } {
  if (!verdicts.length) return { status: 'insufficient_data', causalityConfirmed: false };
  if (verdicts.some((v) => v === 'outcome_pending')) return { status: 'pending', causalityConfirmed: false };
  const evaluable = verdicts.filter((v) => v !== 'baseline_unavailable' && v !== 'insufficient_data');
  if (!evaluable.length) return { status: 'insufficient_data', causalityConfirmed: false };
  const good = evaluable.filter((v) => v === 'exceeded_expectation' || v === 'met_expectation').length;
  const bad = evaluable.filter((v) => v === 'missed_expectation' || v === 'regressed').length;
  const flat = evaluable.filter((v) => v === 'no_material_change').length;
  if (good === evaluable.length) return { status: 'positive', causalityConfirmed: false };
  if (bad === evaluable.length) return { status: 'negative', causalityConfirmed: false };
  if (flat === evaluable.length) return { status: 'neutral', causalityConfirmed: false };
  if (good > 0 && bad > 0) return { status: 'mixed', causalityConfirmed: false };
  if (good > 0 || bad > 0) return { status: 'mixed', causalityConfirmed: false };
  return { status: 'inconclusive', causalityConfirmed: false };
}

/* ── Causality(실험 설계 없이 caused_by 금지) ────────────────────────── */
export function evaluateCausality(i: { temporalCorrelation: boolean | null; scopeMatch: boolean | null; knownConfounders: number | null; controlledExperiment: boolean }): CausalityStatus {
  if (i.temporalCorrelation == null && i.scopeMatch == null) return 'insufficient_data';
  if (isFiniteNumber(i.knownConfounders) && i.knownConfounders > 0) return 'confounded';
  if (i.temporalCorrelation === false && i.scopeMatch === false) return 'unrelated';
  if (i.controlledExperiment && i.temporalCorrelation === true && i.scopeMatch === true) return 'plausible_contribution';  // 최대 판정 — caused_by 없음
  if (i.temporalCorrelation === true && i.scopeMatch === true) return 'scope_correlated';
  if (i.temporalCorrelation === true) return 'temporally_correlated';
  return 'causality_unverified';
}

/* ── Repeatability(단일 성공 ≠ 재현 보장) ────────────────────────────── */
export function evaluateRepeatability(observations: ('positive' | 'negative' | 'mixed' | 'neutral' | 'inconclusive')[]): RepeatabilityStatus {
  if (!observations.length) return 'insufficient_data';
  if (observations.length === 1) return 'single_observation';
  const positives = observations.filter((o) => o === 'positive').length;
  if (positives === observations.length && observations.length >= 3) return 'consistently_observed';
  if (positives === 0 || observations.some((o) => o === 'negative')) return positives > 0 ? 'inconsistent' : 'inconsistent';
  return 'partially_repeated';
}

/* ── Decision Quality(결과와 독립 — 절차·근거 품질만) ────────────────── */
export interface DecisionQualityInput {
  evidenceCount: number | null; alternativesConsidered: boolean | null; riskDisclosed: boolean | null;
  preconditionsRecorded: boolean | null; limitationsDisclosed: boolean | null; humanReviewed: boolean | null;
  segregationOfDuties: boolean | null; baselineAvailable: boolean | null; outcomeMeasurable: boolean | null; auditRecorded: boolean | null;
}

/** 절차 품질 — outcome 입력이 없다 = 결과로 품질을 올리거나 내리지 않는다. */
export function calculateDecisionQuality(i: DecisionQualityInput): { quality: DecisionQuality; score: number | null; missing: string[] } {
  const b = (v: boolean | null): number | null => (v == null ? null : v ? 100 : 0);
  const { score, missing } = normalizeAvailableComponents([
    { key: 'evidence', value: isFiniteNumber(i.evidenceCount) ? Math.min(100, i.evidenceCount * 25) : null, weight: 0.2 },
    { key: 'alternatives', value: b(i.alternativesConsidered), weight: 0.1 },
    { key: 'risk_disclosure', value: b(i.riskDisclosed), weight: 0.12 },
    { key: 'preconditions', value: b(i.preconditionsRecorded), weight: 0.08 },
    { key: 'limitations', value: b(i.limitationsDisclosed), weight: 0.08 },
    { key: 'human_review', value: b(i.humanReviewed), weight: 0.14 },
    { key: 'segregation', value: b(i.segregationOfDuties), weight: 0.08 },
    { key: 'baseline', value: b(i.baselineAvailable), weight: 0.08 },
    { key: 'measurability', value: b(i.outcomeMeasurable), weight: 0.06 },
    { key: 'audit', value: b(i.auditRecorded), weight: 0.06 },
  ]);
  if (score == null) return { quality: 'insufficient_data', score: null, missing };
  const quality: DecisionQuality = score >= 80 ? 'well_supported' : score >= 60 ? 'adequately_supported' : score >= 40 ? 'partially_supported' : score >= 20 ? 'weakly_supported' : 'unsupported';
  return { quality, score, missing };
}

/* ── Decision Outcome Score(인사 평가 금지) ──────────────────────────── */
export function calculateDecisionOutcomeScore(c: {
  expectedAchievement: number | null; regressionAvoidance: number | null; riskRealization: number | null;
  unintendedEffects: number | null; observationCoverage: number | null; dataQuality: number | null;
  repeatability: number | null; benefitPersistence: number | null;
}): { score: number | null; missing: string[]; notForPersonnelEvaluation: true } {
  const { score, missing } = normalizeAvailableComponents([
    { key: 'achievement', value: c.expectedAchievement, weight: 0.25 },
    { key: 'regression_avoidance', value: c.regressionAvoidance, weight: 0.15 },
    { key: 'risk_realization', value: c.riskRealization, weight: 0.12 },
    { key: 'unintended', value: c.unintendedEffects, weight: 0.1 },
    { key: 'coverage', value: c.observationCoverage, weight: 0.12 },
    { key: 'data_quality', value: c.dataQuality, weight: 0.1 },
    { key: 'repeatability', value: c.repeatability, weight: 0.08 },
    { key: 'persistence', value: c.benefitPersistence, weight: 0.08 },
  ]);
  return { score, missing, notForPersonnelEvaluation: true };
}

/* ── Recommendation Accuracy(미실행 제외) ────────────────────────────── */
export type AccuracyVerdict = 'direction_correct' | 'direction_incorrect' | 'partially_correct' | 'risk_underestimated' | 'risk_overestimated' | 'confidence_misaligned' | 'not_executed' | 'outcome_pending' | 'causality_unverified' | 'insufficient_data';

export function evaluateRecommendationAccuracy(i: {
  approved: boolean; executionReferenced: boolean; metricVerdict: MetricVerdict | null;
  riskPredicted: boolean | null; riskRealized: boolean | null;
}): AccuracyVerdict {
  if (!i.approved || !i.executionReferenced) return 'not_executed';   // 미승인/미실행 추천은 실패로 계산 금지
  if (i.metricVerdict == null || i.metricVerdict === 'insufficient_data' || i.metricVerdict === 'baseline_unavailable') return 'insufficient_data';
  if (i.metricVerdict === 'outcome_pending') return 'outcome_pending';
  if (i.riskPredicted === false && i.riskRealized === true) return 'risk_underestimated';
  if (i.riskPredicted === true && i.riskRealized === false && (i.metricVerdict === 'met_expectation' || i.metricVerdict === 'exceeded_expectation')) return 'risk_overestimated';
  if (i.metricVerdict === 'met_expectation' || i.metricVerdict === 'exceeded_expectation') return 'direction_correct';
  if (i.metricVerdict === 'partially_met') return 'partially_correct';
  if (i.metricVerdict === 'regressed' || i.metricVerdict === 'missed_expectation') return 'direction_incorrect';
  return 'insufficient_data';
}

/* ── Confidence Calibration(표본 방어 · candidate 표현) ──────────────── */
export type CalibrationVerdict = 'well_calibrated' | 'overconfident_candidate' | 'underconfident_candidate' | 'mixed' | 'sample_too_small' | 'insufficient_data';

export function calculateConfidenceCalibration(samples: { confidence: number | null; verdict: AccuracyVerdict }[]): { verdict: CalibrationVerdict; sampleSize: number; avgConfidence: number | null; successRate: number | null } {
  const evaluable = samples.filter((s) => isFiniteNumber(s.confidence) && (s.verdict === 'direction_correct' || s.verdict === 'partially_correct' || s.verdict === 'direction_incorrect'));
  if (!samples.length) return { verdict: 'insufficient_data', sampleSize: 0, avgConfidence: null, successRate: null };
  if (evaluable.length < 5) return { verdict: 'sample_too_small', sampleSize: evaluable.length, avgConfidence: null, successRate: null };
  const avgConf = evaluable.reduce((a, s) => a + (s.confidence as number), 0) / evaluable.length;
  const success = evaluable.filter((s) => s.verdict === 'direction_correct').length + evaluable.filter((s) => s.verdict === 'partially_correct').length * 0.5;
  const rate = (success / evaluable.length) * 100;
  const gap = avgConf - rate;
  const verdict: CalibrationVerdict = Math.abs(gap) <= 15 ? 'well_calibrated' : gap > 15 ? 'overconfident_candidate' : 'underconfident_candidate';
  return { verdict, sampleSize: evaluable.length, avgConfidence: Math.round(avgConf), successRate: Math.round(rate) };
}

/* ── Decision Patterns(경향 — 원인 단정 없음) ────────────────────────── */
export interface DecisionPatternRecord { domain: string; type: string; status: DecisionStatus; approverId: string | null; hasExecutionRef: boolean; hasOutcome: boolean }

export function detectDecisionPatterns(records: DecisionPatternRecord[]): { pattern: string; count: number; note: string }[] {
  if (!records.length) return [];
  const out: { pattern: string; count: number; note: string }[] = [];
  const NOTE = '경향 표시 — 원인 단정 없음';
  const decidedNoRef = records.filter((r) => r.status === 'decided' && !r.hasExecutionRef).length;
  if (decidedNoRef > 0) out.push({ pattern: '실행 Reference 없는 결정', count: decidedNoRef, note: NOTE });
  const noOutcome = records.filter((r) => ['decided', 'observation_pending', 'outcome_review_pending'].includes(r.status) && !r.hasOutcome).length;
  if (noOutcome > 0) out.push({ pattern: 'Outcome 미관측 결정', count: noOutcome, note: NOTE });
  const waiting = records.filter((r) => r.status === 'waiting_evidence').length;
  if (waiting > 0) out.push({ pattern: 'Evidence 부족 보류', count: waiting, note: NOTE });
  const approvers = new Map<string, number>();
  for (const r of records) if (r.approverId) approvers.set(r.approverId, (approvers.get(r.approverId) ?? 0) + 1);
  const decidedTotal = [...approvers.values()].reduce((a, b) => a + b, 0);
  if (approvers.size === 1 && decidedTotal >= 3) out.push({ pattern: '단일 Approver 의존', count: decidedTotal, note: NOTE + ' — 인사 평가 아님' });
  const byDomain = new Map<string, { accept: number; reject: number }>();
  for (const r of records) {
    const d = byDomain.get(r.domain) ?? { accept: 0, reject: 0 };
    if (r.type === 'accept_recommendation') d.accept += 1;
    if (r.type === 'reject_recommendation') d.reject += 1;
    byDomain.set(r.domain, d);
  }
  for (const [domain, d] of [...byDomain.entries()].sort()) {
    if (d.accept >= 3) out.push({ pattern: `${domain} 반복 승인`, count: d.accept, note: NOTE });
    if (d.reject >= 3) out.push({ pattern: `${domain} 반복 거절`, count: d.reject, note: NOTE });
  }
  return out;
}

/* ── Lessons Learned(사람 검토 필수 · best practice 임의 생성 금지) ──── */
export interface LessonDraft {
  context: string; decision: string; expectedOutcome: string; actualOutcome: string;
  whatWorked: string[]; whatDidNotWork: string[]; unknownFactors: string[];
  reusableInsight: string | null; nonReusableConditions: string[]; futurePreconditions: string[];
  humanReviewRequired: true; autoBestPractice: false;
}

export function buildLessonsLearned(i: {
  context: string; decisionSummary: string; expected: string; actual: string;
  outcomeStatus: OutcomeStatus; repeatability: RepeatabilityStatus; priorSimilarCount: number | null;
}): LessonDraft | { insufficient: true; why: string } {
  if (!i.context?.trim() || !i.decisionSummary?.trim()) return { insufficient: true, why: 'Context/Decision 없음 — Lesson 생성 금지' };
  if (i.outcomeStatus === 'pending' || i.outcomeStatus === 'observation_incomplete') return { insufficient: true, why: '결과 미확정 — Lesson 확정 금지' };
  if (!isFiniteNumber(i.priorSimilarCount) || i.priorSimilarCount < 1) {
    // 과거 결정 없음 — best practice 임의 생성 금지, 단일 관찰 기록만
    return {
      context: i.context, decision: i.decisionSummary, expectedOutcome: i.expected, actualOutcome: i.actual,
      whatWorked: i.outcomeStatus === 'positive' ? ['단일 관찰 — 재현 보장 아님'] : [],
      whatDidNotWork: i.outcomeStatus === 'negative' ? ['단일 관찰 — 정책 전체 실패 단정 아님'] : [],
      unknownFactors: ['과거 유사 결정 없음 — 일반화 금지'],
      reusableInsight: null, nonReusableConditions: ['표본 1 — best practice 아님'],
      futurePreconditions: ['유사 결정 축적 후 재평가'], humanReviewRequired: true, autoBestPractice: false,
    };
  }
  return {
    context: i.context, decision: i.decisionSummary, expectedOutcome: i.expected, actualOutcome: i.actual,
    whatWorked: i.outcomeStatus === 'positive' || i.outcomeStatus === 'mixed' ? ['기대 방향 달성 metric 존재(인과 미확정)'] : [],
    whatDidNotWork: i.outcomeStatus === 'negative' || i.outcomeStatus === 'mixed' ? ['기대 미달 metric 존재'] : [],
    unknownFactors: ['외부 요인 통제 없음(causality_unverified 가능)'],
    reusableInsight: i.repeatability === 'consistently_observed' ? '반복 관측됨 — 유사 조건에서 참고 가능(보장 아님)' : null,
    nonReusableConditions: i.repeatability === 'single_observation' ? ['단일 관찰 — 재현 미보장'] : [],
    futurePreconditions: ['baseline 확보', 'observation window 계획', 'Human Approval'],
    humanReviewRequired: true, autoBestPractice: false,
  };
}

/* ── 채택률/관측률(모수 0 → null — 0% 단정 금지) ─────────────────────── */
export function calculateAdoptionRate(i: { accepted: number | null; rejected: number | null }): number | null {
  if (!isFiniteNumber(i.accepted) || !isFiniteNumber(i.rejected)) return null;
  const total = i.accepted + i.rejected;
  if (total <= 0) return null;
  return Math.round((i.accepted / total) * 1000) / 10;
}
export function calculateObservationRate(i: { decided: number | null; observed: number | null }): number | null {
  if (!isFiniteNumber(i.decided) || !isFiniteNumber(i.observed) || i.decided <= 0) return null;
  return Math.round((Math.min(i.observed, i.decided) / i.decided) * 1000) / 10;
}

/* ── Similar Decision Retrieval(구조화 필드 기반 · 차이점 필수 표시) ─── */
export type SimilarityVerdict = 'highly_relevant' | 'partially_relevant' | 'weakly_relevant' | 'not_comparable' | 'insufficient_data';
export interface SimilarDecisionInput { id: string; domain: string; type: string; sourceSystem: string; outcomeStatus: OutcomeStatus | null; repeatability: RepeatabilityStatus | null }

export function findSimilarDecisions(current: Omit<SimilarDecisionInput, 'id' | 'outcomeStatus' | 'repeatability'>, past: SimilarDecisionInput[]): {
  id: string; verdict: SimilarityVerdict; sharedContext: string[]; differentContext: string[];
  priorOutcome: OutcomeStatus | null; repeatability: RepeatabilityStatus | null; applicabilityNote: string;
}[] {
  if (!past.length) return [];
  return past.map((p) => {
    const shared: string[] = []; const different: string[] = [];
    (p.domain === current.domain ? shared : different).push(`domain:${p.domain}`);
    (p.type === current.type ? shared : different).push(`type:${p.type}`);
    (p.sourceSystem === current.sourceSystem ? shared : different).push(`source:${p.sourceSystem}`);
    const score = (p.domain === current.domain ? 2 : 0) + (p.type === current.type ? 1 : 0) + (p.sourceSystem === current.sourceSystem ? 1 : 0);
    const verdict: SimilarityVerdict = score >= 4 ? 'highly_relevant' : score >= 2 ? 'partially_relevant' : score >= 1 ? 'weakly_relevant' : 'not_comparable';
    return {
      id: p.id, verdict, sharedContext: shared, differentContext: different,
      priorOutcome: p.outcomeStatus, repeatability: p.repeatability,
      applicabilityNote: p.repeatability === 'single_observation' ? '단일 관찰 — 적용 가능성 제한' : '과거 결과 참고 — 현재 조건 차이 확인 필수',
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

/* ── Timeline ────────────────────────────────────────────────────────── */
export interface TimelineEvent { eventType: string; detail: string | null; actorId: string | null; createdAt: string }
export function buildDecisionTimeline(events: TimelineEvent[]): TimelineEvent[] {
  return [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, 200);
}

/* ── Support Matrix ──────────────────────────────────────────────────── */
export interface DMSupportItem { key: string; label: string; status: 'fully_supported' | 'partially_supported' | 'read_only' | 'evidence_only' | 'external_reference_only' | 'causality_unverified' | 'unsupported' | 'insufficient_data'; note: string }

export const DM_SUPPORT: DMSupportItem[] = [
  { key: 'decision_memory', label: 'Decision Memory', status: 'fully_supported', note: '요약+참조 기록 — 원본 복제/변경 없음, decided ≠ 실행' },
  { key: 'recommendation_link', label: 'Recommendation Link', status: 'partially_supported', note: '수동 연결 + 서버 실존 검증 — ID 동일만으로 자동 연결 금지' },
  { key: 'manual_decision', label: 'Manual Decision', status: 'fully_supported', note: 'source 없으면 manual_decision 명시' },
  { key: 'human_decision', label: 'Human Decision', status: 'fully_supported', note: '사유 필수 · Self Approval 경고(차단 아님)' },
  { key: 'execution_reference', label: 'Execution Reference', status: 'external_reference_only', note: '참고 기록만 — 실행 기능 없음' },
  { key: 'execution_verification', label: 'Execution Verification', status: 'partially_supported', note: '외부 성공 보고 ≠ 내부 검증(상태 분리)' },
  { key: 'observation_window', label: 'Observation Window', status: 'fully_supported', note: '종료 전 closed 서버 차단 — 자동 수집 없음(수동 기록)' },
  { key: 'baseline', label: 'Baseline', status: 'partially_supported', note: '없으면 baseline_unavailable(0 대체 금지) · 조건 불일치 강제 비교 금지' },
  { key: 'expected_outcome', label: 'Expected Outcome', status: 'fully_supported', note: 'direction/target/range/horizon — 없으면 expected_outcome_unavailable' },
  { key: 'actual_outcome', label: 'Actual Outcome', status: 'partially_supported', note: 'baseline 0 → % 미계산 · null 미대체' },
  { key: 'expected_vs_actual', label: 'Expected vs Actual', status: 'fully_supported', note: '정의된 허용 범위만 — 임의 threshold 없음 · 미종료 → outcome_pending' },
  { key: 'outcome_evaluation', label: 'Outcome Evaluation', status: 'fully_supported', note: 'positive ≠ 인과 확정(플래그 고정)' },
  { key: 'causality_review', label: 'Causality Review', status: 'causality_unverified', note: '최대 판정 plausible_contribution — caused_by 없음' },
  { key: 'repeatability_review', label: 'Repeatability Review', status: 'partially_supported', note: '단일 성공 = single_observation' },
  { key: 'decision_quality', label: 'Decision Quality', status: 'fully_supported', note: '절차·근거 품질만(결과와 독립) — 인사 평가 아님' },
  { key: 'outcome_score', label: 'Decision Outcome Score', status: 'partially_supported', note: '8성분 재정규화 — 인사 평가 금지' },
  { key: 'recommendation_accuracy', label: 'Recommendation Accuracy', status: 'partially_supported', note: '미승인/미실행 → not_executed(실패 계산 제외)' },
  { key: 'confidence_calibration', label: 'Confidence Calibration', status: 'partially_supported', note: '표본<5 → sample_too_small · 초기 표본 부족' },
  { key: 'decision_pattern', label: 'Decision Pattern', status: 'partially_supported', note: '경향만 — 원인 단정 없음' },
  { key: 'lessons_learned', label: 'Lessons Learned', status: 'partially_supported', note: 'AI 초안 + 사람 검토 Reference 필수 — 자동 best practice 없음' },
  { key: 'institutional_memory', label: 'Institutional Memory', status: 'partially_supported', note: '구조화 필드 검색 — Vector/Embedding 미도입(정직 표기)' },
  { key: 'similar_decision', label: 'Similar Decision Retrieval', status: 'partially_supported', note: '유사성 판단 시 차이점 필수 표시' },
  { key: 'decision_timeline', label: 'Decision Timeline', status: 'fully_supported', note: 'event 기반 시간순 — 실행/인과 확정 이벤트 아님' },
  { key: 'external_outcome_reference', label: 'External Outcome Reference', status: 'external_reference_only', note: '참고 기록만 — 결과 수집 시스템 미변경' },
  { key: 'historical_backfill', label: 'Historical Decision Backfill', status: 'insufficient_data', note: '과거 Source 별 ID 체계 상이 — 수동 연결 필요' },
  { key: 'auto_decision', label: '자동 의사결정/승인/거절', status: 'unsupported', note: '금지' },
  { key: 'auto_execution', label: '자동 실행/Rollback/Incident 조치', status: 'unsupported', note: '금지' },
  { key: 'auto_model_training', label: '자동 모델 학습/Weight/Prompt 변경', status: 'unsupported', note: '금지' },
  { key: 'auto_policy_contract_settlement', label: '자동 정책/계약/정산/가격 변경', status: 'unsupported', note: '금지' },
  { key: 'auto_trust_change', label: '자동 Trust Score 변경', status: 'unsupported', note: '금지' },
  { key: 'personnel_evaluation', label: '직원 성과 평가 용도', status: 'unsupported', note: '금지 — Decision Quality 는 절차 품질' },
  { key: 'production_apply', label: 'Production Apply/Merge/Deploy/Migration', status: 'unsupported', note: '금지' },
];
