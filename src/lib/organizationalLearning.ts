/**
 * organizationalLearning — Organizational Learning & Policy Evolution 순수 로직 (Phase AI-OPS-12).
 *
 * Decision Memory/Outcome/Lesson → Evidence Pool → Pattern Consolidation →
 * Repeatability/Applicability → Organizational Learning → Policy Outcome Mapping →
 * Evolution Candidate → Safety Gate → Governance Adaptation → Human Review.
 *
 * 학습 정직성(전부 코드로 강제):
 *  - 1회 성공 ≠ Best Practice · 1회 실패 ≠ 폐기 근거 · Context 다르면 통합 금지.
 *  - Outcome 미관측 Decision 학습 제외(exclusion_reason 보존). 상관 ≠ 인과.
 *  - 인과 미확인 근거 strong 상한. 충돌 근거 평균으로 숨김 금지(보존).
 *  - 표본 부족 시 승격 금지(sample_too_small). Scope 차이 무시한 전사 일반화 방어.
 *  - Policy Candidate ≠ 실제 Policy. Policy Reference ≠ 실제 적용(policy_application_unverified).
 *  - Maturity/Quality 는 인사·조직 평가 아님. deterministic · pure · Date 주입 · Production 변경 없음.
 */
import { isFiniteNumber, clampScore, normalizeAvailableComponents } from './aiMemory';
import type { OutcomeStatus, CausalityStatus, RepeatabilityStatus } from './decisionOutcomeIntelligence';

/* ── 타입 ─────────────────────────────────────────────────────────────── */
export type EvidenceStrength = 'strong' | 'moderate' | 'weak' | 'unverified' | 'conflicting' | 'insufficient_data';
export type ApplicabilityStatus = 'enterprise_specific' | 'brand_specific' | 'store_specific' | 'business_category_specific'
  | 'policy_specific' | 'context_specific' | 'cross_scope_candidate' | 'broadly_applicable_candidate'
  | 'applicability_unverified' | 'not_applicable' | 'insufficient_data';
export type PatternRepeatability = 'single_observation' | 'partially_repeated' | 'consistently_observed' | 'context_limited' | 'inconsistent' | 'repeatability_unverified' | 'sample_too_small' | 'insufficient_data';
export type ConflictLevel = 'no_known_conflict' | 'mild_conflict' | 'material_conflict' | 'critical_conflict' | 'conflicting_evidence' | 'insufficient_data';
export type LearningMaturity = 'initial' | 'developing' | 'defined' | 'measured' | 'adaptive_candidate' | 'insufficient_data';
export type PolicyPerformance = 'evidence_supports_current_policy' | 'partially_supported' | 'scope_limited' | 'conflicting_outcomes' | 'review_required' | 'stale_policy_candidate' | 'deprecation_candidate' | 'policy_application_unverified' | 'insufficient_data';
export type StalenessStatus = 'current' | 'aging' | 'stale_candidate' | 'invalidated_by_change' | 'staleness_unknown' | 'insufficient_data';
export type ChainVerdict = 'direct_chain' | 'indirect_chain' | 'parallel_decisions' | 'possibly_related' | 'unrelated' | 'causality_unverified' | 'insufficient_data';

export const EVOLUTION_CANDIDATE_TYPES = ['retain_current_policy', 'clarify_policy', 'narrow_policy_scope', 'expand_policy_scope_candidate', 'revise_threshold_candidate', 'revise_process_candidate', 'add_exception_candidate', 'remove_exception_candidate', 'split_policy_candidate', 'merge_policy_candidate', 'deprecate_policy_candidate', 'replace_policy_candidate', 'request_more_evidence', 'insufficient_data'] as const;
export type EvolutionCandidateType = (typeof EVOLUTION_CANDIDATE_TYPES)[number];

/* ── Evidence Eligibility(제외해도 사유 보존 — 삭제 금지) ────────────── */
export interface EligibilityInput {
  hasDecision: boolean; hasHumanDecision: boolean; executionKnown: boolean;
  outcomeStatus: OutcomeStatus | 'outcome_pending' | null; observationClosed: boolean;
  baselineAvailable: boolean | null; hasEvidence: boolean; hasScope: boolean;
  decisionTerminal: boolean;  // invalidated/cancelled/expired
}

export function evaluateEvidenceEligibility(i: EligibilityInput): { eligible: boolean; exclusionReason: string | null } {
  if (!i.hasDecision) return { eligible: false, exclusionReason: 'Decision 없음' };
  if (i.decisionTerminal) return { eligible: false, exclusionReason: 'invalidated/cancelled/expired — 학습 제외' };
  if (!i.hasHumanDecision) return { eligible: false, exclusionReason: 'Human Decision 기록 없음' };
  if (i.outcomeStatus == null || i.outcomeStatus === 'outcome_pending') return { eligible: false, exclusionReason: 'outcome_pending — 미관측 Decision 은 학습 증거 사용 금지' };
  if (!i.observationClosed) return { eligible: false, exclusionReason: 'observation_incomplete' };
  if (i.baselineAvailable === false) return { eligible: false, exclusionReason: 'baseline_unavailable' };
  if (!i.hasEvidence) return { eligible: false, exclusionReason: 'Evidence 없음' };
  if (!i.hasScope) return { eligible: false, exclusionReason: 'scope_unverified' };
  if (!i.executionKnown) return { eligible: false, exclusionReason: 'execution_unverified(실행 미확인 명시 필요)' };
  return { eligible: true, exclusionReason: null };
}

/* ── Evidence Strength(인과 미확인 strong 상한) ──────────────────────── */
export function calculateLearningEvidenceStrength(c: {
  baselineQuality: number | null; observationCoverage: number | null; sampleSize: number | null;
  executionVerified: boolean | null; outcomeConfidence: number | null;
  causality: CausalityStatus; repeatability: RepeatabilityStatus; scopeMatch: boolean | null; auditComplete: boolean | null;
  hasConflict: boolean;
}): { strength: EvidenceStrength; score: number | null; missing: string[] } {
  if (c.hasConflict) return { strength: 'conflicting', score: null, missing: [] };   // 충돌은 평균으로 숨기지 않음
  const b = (v: boolean | null): number | null => (v == null ? null : v ? 100 : 0);
  const { score, missing } = normalizeAvailableComponents([
    { key: 'baseline', value: c.baselineQuality, weight: 0.15 },
    { key: 'coverage', value: c.observationCoverage, weight: 0.15 },
    { key: 'sample', value: isFiniteNumber(c.sampleSize) ? Math.min(100, c.sampleSize * 10) : null, weight: 0.15 },
    { key: 'execution', value: b(c.executionVerified), weight: 0.15 },
    { key: 'outcome_confidence', value: c.outcomeConfidence, weight: 0.1 },
    { key: 'repeatability', value: c.repeatability === 'consistently_observed' ? 100 : c.repeatability === 'partially_repeated' ? 60 : c.repeatability === 'single_observation' ? 30 : null, weight: 0.15 },
    { key: 'scope', value: b(c.scopeMatch), weight: 0.08 },
    { key: 'audit', value: b(c.auditComplete), weight: 0.07 },
  ]);
  if (score == null) return { strength: 'insufficient_data', score: null, missing };
  let strength: EvidenceStrength = score >= 75 ? 'strong' : score >= 50 ? 'moderate' : score >= 25 ? 'weak' : 'unverified';
  // 인과 미확인이면 strong 상한 제한
  if (strength === 'strong' && !['plausible_contribution', 'scope_correlated', 'temporally_correlated'].includes(c.causality)) strength = 'moderate';
  return { strength, score, missing };
}

/* ── Context Signature(다르면 통합 금지) ─────────────────────────────── */
export function buildContextSignature(ctx: Record<string, string | null | undefined>): string {
  return Object.entries(ctx)
    .filter(([, v]) => v != null && String(v).trim() !== '')     // 실존 필드만
    .map(([k, v]) => `${k}=${String(v).trim().toLowerCase()}`)
    .sort()
    .join('|') || 'context_unknown';
}

export interface LearningEvidenceItem { id: string; contextSignature: string; outcomeStatus: OutcomeStatus; domain: string }

/** context 별 그룹 — 다른 context 는 강제 통합하지 않음. */
export function groupLearningEvidence(items: LearningEvidenceItem[]): Map<string, LearningEvidenceItem[]> {
  const map = new Map<string, LearningEvidenceItem[]>();
  for (const it of items) map.set(it.contextSignature, [...(map.get(it.contextSignature) ?? []), it]);
  return map;
}

/* ── Pattern Consolidation(표본 방어) ────────────────────────────────── */
export interface DetectedPattern {
  contextSignature: string; patternType: string; sampleSize: number;
  positive: number; negative: number; mixed: number; inconclusive: number;
  repeatability: PatternRepeatability; note: string; bestPractice: false;
}

export function detectLearningPattern(group: LearningEvidenceItem[], minSample = 3): DetectedPattern | { insufficient: true; why: string } {
  if (!group.length) return { insufficient: true, why: '근거 없음' };
  const ctx = group[0].contextSignature;
  if (group.some((g) => g.contextSignature !== ctx)) return { insufficient: true, why: 'Context 불일치 — 통합 금지' };
  const positive = group.filter((g) => g.outcomeStatus === 'positive').length;
  const negative = group.filter((g) => g.outcomeStatus === 'negative').length;
  const mixed = group.filter((g) => g.outcomeStatus === 'mixed').length;
  const inconclusive = group.length - positive - negative - mixed;
  const n = group.length;
  if (n < minSample) {
    return {
      contextSignature: ctx, sampleSize: n, positive, negative, mixed, inconclusive,
      patternType: 'insufficient_data', repeatability: n === 1 ? 'single_observation' : 'sample_too_small',
      note: `표본 ${n} < ${minSample} — organizational_learning 승격 금지`, bestPractice: false,
    };
  }
  let type = 'mixed_outcome_pattern';
  if (positive === n) type = 'repeated_success_candidate';
  else if (negative === n) type = 'repeated_failure_candidate';
  else if (positive > 0 && negative === 0 && positive >= n * 0.7) type = 'conditional_success';
  else if (negative > 0 && positive === 0 && negative >= n * 0.7) type = 'conditional_failure';
  else if (inconclusive === n) type = 'inconclusive_pattern';
  const repeatability: PatternRepeatability = positive === n || negative === n ? 'consistently_observed' : positive > 0 && negative > 0 ? 'inconsistent' : 'partially_repeated';
  return { contextSignature: ctx, sampleSize: n, positive, negative, mixed, inconclusive, patternType: type, repeatability, note: '경향 — Best Practice/폐기 확정 아님(원인 단정 없음)', bestPractice: false };
}

/* ── Repeatability(Scope 교차) ───────────────────────────────────────── */
export function evaluatePatternRepeatability(i: { observations: number | null; distinctContexts: number | null; distinctScopes: number | null; consistent: boolean | null }): PatternRepeatability {
  if (!isFiniteNumber(i.observations) || i.observations <= 0) return 'insufficient_data';
  if (i.observations === 1) return 'single_observation';
  if (i.observations < 3) return 'sample_too_small';
  if (i.consistent === false) return 'inconsistent';
  if (i.consistent == null) return 'repeatability_unverified';
  if (isFiniteNumber(i.distinctScopes) && i.distinctScopes >= 2) return 'consistently_observed';
  if (isFiniteNumber(i.distinctContexts) && i.distinctContexts <= 1) return 'context_limited';
  return 'partially_repeated';
}

/* ── Applicability(전사 일반화 방어) ─────────────────────────────────── */
export function evaluateApplicability(i: { scopeType: string | null; consistentScopeCount: number | null; totalScopeCount: number | null }): ApplicabilityStatus {
  if (!i.scopeType || i.scopeType === 'unverified') return 'applicability_unverified';
  if (!isFiniteNumber(i.consistentScopeCount) || !isFiniteNumber(i.totalScopeCount) || i.totalScopeCount <= 0) {
    // 단일 scope 근거 — 해당 scope 한정
    const map: Record<string, ApplicabilityStatus> = { enterprise: 'enterprise_specific', store: 'store_specific', business_category: 'business_category_specific', policy: 'policy_specific' };
    return map[i.scopeType] ?? 'context_specific';
  }
  if (i.consistentScopeCount >= 3 && i.consistentScopeCount === i.totalScopeCount) return 'broadly_applicable_candidate';  // 다수 scope 일관 근거 시에만 후보
  if (i.consistentScopeCount >= 2) return 'cross_scope_candidate';
  const map: Record<string, ApplicabilityStatus> = { enterprise: 'enterprise_specific', store: 'store_specific', business_category: 'business_category_specific', policy: 'policy_specific' };
  return map[i.scopeType] ?? 'context_specific';
}

/* ── Conflicting Evidence(평균으로 숨김 금지) ────────────────────────── */
export function detectConflictingEvidence(i: { positive: number; negative: number; axis: string; paymentOrSettlement?: boolean }): { level: ConflictLevel; note: string } {
  if (i.positive + i.negative === 0) return { level: 'insufficient_data', note: '근거 없음' };
  if (i.positive === 0 || i.negative === 0) return { level: 'no_known_conflict', note: '반대 근거 없음(현재 표본 기준)' };
  const ratio = Math.min(i.positive, i.negative) / (i.positive + i.negative);
  const level: ConflictLevel = i.paymentOrSettlement ? 'critical_conflict' : ratio >= 0.4 ? 'material_conflict' : 'mild_conflict';
  return { level, note: `${i.axis} 축에서 positive ${i.positive} vs negative ${i.negative} — 평균으로 숨기지 않고 보존` };
}

/* ── Learning Maturity(인사 평가 아님) ───────────────────────────────── */
export function calculateLearningMaturity(c: {
  evidenceCoverage: number | null; observationRate: number | null; baselineAvailability: number | null;
  executionVerification: number | null; repeatabilityCoverage: number | null; contextCoverage: number | null;
  policyMapping: number | null; humanValidation: number | null; auditCompleteness: number | null; freshness: number | null;
}): { maturity: LearningMaturity; score: number | null; missing: string[]; notForPersonnelEvaluation: true } {
  const { score, missing } = normalizeAvailableComponents([
    { key: 'evidence_coverage', value: c.evidenceCoverage, weight: 0.15 },
    { key: 'observation_rate', value: c.observationRate, weight: 0.12 },
    { key: 'baseline', value: c.baselineAvailability, weight: 0.1 },
    { key: 'execution', value: c.executionVerification, weight: 0.1 },
    { key: 'repeatability', value: c.repeatabilityCoverage, weight: 0.12 },
    { key: 'context', value: c.contextCoverage, weight: 0.1 },
    { key: 'policy_mapping', value: c.policyMapping, weight: 0.1 },
    { key: 'human_validation', value: c.humanValidation, weight: 0.11 },
    { key: 'audit', value: c.auditCompleteness, weight: 0.05 },
    { key: 'freshness', value: c.freshness, weight: 0.05 },
  ]);
  if (score == null) return { maturity: 'insufficient_data', score: null, missing, notForPersonnelEvaluation: true };
  const maturity: LearningMaturity = score >= 85 ? 'adaptive_candidate' : score >= 65 ? 'measured' : score >= 45 ? 'defined' : score >= 25 ? 'developing' : 'initial';
  return { maturity, score, missing, notForPersonnelEvaluation: true };
}

/* ── Policy Outcome Mapping / Performance ────────────────────────────── */
export function mapPolicyOutcomes(i: { policyCode: string; positive: number; negative: number; mixed: number; inconclusive: number; applicationVerified: boolean | null }): {
  policyCode: string; total: number; positive: number; negative: number; mixed: number; inconclusive: number;
  applicationStatus: 'verified' | 'policy_application_unverified'; note: string;
} {
  return {
    policyCode: i.policyCode, total: i.positive + i.negative + i.mixed + i.inconclusive,
    positive: i.positive, negative: i.negative, mixed: i.mixed, inconclusive: i.inconclusive,
    applicationStatus: i.applicationVerified === true ? 'verified' : 'policy_application_unverified',
    note: '정책 존재 ≠ 실제 Production 적용(확인 불가 시 unverified 유지)',
  };
}

export function evaluatePolicyPerformance(i: { positive: number; negative: number; mixed: number; inconclusive: number; applicationVerified: boolean | null; stale: boolean }): PolicyPerformance {
  if (i.applicationVerified !== true) return 'policy_application_unverified';   // 적용 미확인 — 성과 판정 금지
  const evaluable = i.positive + i.negative + i.mixed;
  if (evaluable === 0) return 'insufficient_data';
  if (i.stale) return 'stale_policy_candidate';
  if (i.positive > 0 && i.negative > 0) return 'conflicting_outcomes';
  if (i.negative >= 3 && i.positive === 0) return 'deprecation_candidate';      // 1회 실패로 폐기 확정 금지(3회 이상)
  if (i.negative > 0) return 'review_required';
  if (evaluable < 3) return 'partially_supported';                              // 표본 부족 — 전면 지지 금지
  if (i.mixed > 0) return 'scope_limited';
  return 'evidence_supports_current_policy';
}

/* ── Policy Evolution Candidate + Safety Gate ────────────────────────── */
export interface EvolutionCandidateDraft {
  code: string; candidateType: EvolutionCandidateType; changeSummary: string; reason: string;
  expectedBenefit: string; expectedRisk: string; alternatives: string[];
  confidence: number; preconditions: string[]; limitations: string[];
  humanApprovalRequired: true; policyVersionCreated: false;
}

export function buildPolicyEvolutionCandidate(i: {
  code: string; performance: PolicyPerformance; sampleSize: number | null; conflictLevel: ConflictLevel;
}): EvolutionCandidateDraft | { insufficient: true; why: string } {
  if (!isFiniteNumber(i.sampleSize) || i.sampleSize < 3) return { insufficient: true, why: '표본<3 — 후보 생성 금지(1회 결과로 확정 금지)' };
  if (i.performance === 'policy_application_unverified') return { insufficient: true, why: '실제 적용 미확인 — 성과 기반 후보 생성 금지' };
  if (i.performance === 'insufficient_data') return { insufficient: true, why: '근거 부족' };
  const type: EvolutionCandidateType =
    i.conflictLevel === 'material_conflict' || i.conflictLevel === 'critical_conflict' ? 'request_more_evidence'
      : i.performance === 'deprecation_candidate' ? 'deprecate_policy_candidate'
      : i.performance === 'review_required' || i.performance === 'conflicting_outcomes' ? 'revise_process_candidate'
      : i.performance === 'scope_limited' ? 'narrow_policy_scope'
      : i.performance === 'stale_policy_candidate' ? 'clarify_policy'
      : 'retain_current_policy';
  return {
    code: i.code, candidateType: type,
    changeSummary: `[${type}] 성과 근거(${i.performance}, 표본 ${i.sampleSize}) 기반 검토 후보 — 변경 아님`,
    reason: `Policy Outcome Mapping: ${i.performance} · conflict: ${i.conflictLevel}`,
    expectedBenefit: '정책-결과 정합성 개선(사람 검토 후)',
    expectedRisk: '인과 미확인 — 정책 외 요인 가능(causality_unverified)',
    alternatives: ['현행 유지(retain_current_policy)', '추가 근거 수집(request_more_evidence)'],
    confidence: clampScore(Math.min(80, 30 + i.sampleSize * 10 - (i.conflictLevel !== 'no_known_conflict' ? 20 : 0))),
    preconditions: ['Human Approval', '실제 적용 여부 확인', 'Baseline/Observation 계획'],
    limitations: ['후보만 — Policy Version 생성/적용 없음', 'approved_reference ≠ 적용 완료'],
    humanApprovalRequired: true, policyVersionCreated: false,
  };
}

export type SafetyGateVerdict = 'ready_for_human_review' | 'waiting_evidence' | 'scope_unverified' | 'conflict_detected' | 'policy_application_unverified' | 'insufficient_data';

export function evaluatePolicyEvolutionSafety(i: {
  applicationVerified: boolean | null; scopeVerified: boolean; conflictLevel: ConflictLevel;
  evidenceStrength: EvidenceStrength; hasBaselinePlan: boolean; hasObservationPlan: boolean; separateApprover: boolean | null;
}): { verdict: SafetyGateVerdict; blockers: string[]; productionApply: false } {
  const blockers: string[] = [];
  if (i.applicationVerified !== true) blockers.push('현재 정책 실제 적용 여부 미확인');
  if (!i.scopeVerified) blockers.push('대상 Scope 미확인');
  if (i.conflictLevel === 'material_conflict' || i.conflictLevel === 'critical_conflict') blockers.push('충돌 근거 존재');
  if (i.evidenceStrength === 'insufficient_data' || i.evidenceStrength === 'unverified') blockers.push('근거 강도 부족');
  if (!i.hasBaselinePlan || !i.hasObservationPlan) blockers.push('Baseline/Observation 계획 없음');
  if (i.separateApprover === false) blockers.push('Segregation of Duties 미충족(self-approval 경고)');
  const verdict: SafetyGateVerdict =
    i.applicationVerified !== true ? 'policy_application_unverified'
      : !i.scopeVerified ? 'scope_unverified'
      : i.conflictLevel === 'material_conflict' || i.conflictLevel === 'critical_conflict' ? 'conflict_detected'
      : i.evidenceStrength === 'insufficient_data' ? 'insufficient_data'
      : blockers.length > 0 ? 'waiting_evidence'
      : 'ready_for_human_review';
  return { verdict, blockers, productionApply: false };
}

/* ── Repeated Failure / Success(자동 차단·표준 적용 없음) ────────────── */
export type FailureVerdict = 'no_known_repeat_failure' | 'isolated_failure' | 'repeated_failure_candidate' | 'persistent_failure_pattern' | 'critical_repeat_failure' | 'insufficient_data';
export function detectRepeatedFailure(i: { negativeCount: number | null; sameContext: boolean; critical?: boolean }): { verdict: FailureVerdict; note: string } {
  if (!isFiniteNumber(i.negativeCount)) return { verdict: 'insufficient_data', note: '데이터 없음' };
  if (i.negativeCount === 0) return { verdict: 'no_known_repeat_failure', note: '현재 표본 기준' };
  if (!i.sameContext) return { verdict: 'isolated_failure', note: 'Context 상이 — 동일 패턴 아님' };
  if (i.negativeCount === 1) return { verdict: 'isolated_failure', note: '1회 실패 — 폐기 근거 확정 금지' };
  if (i.critical && i.negativeCount >= 3) return { verdict: 'critical_repeat_failure', note: '자동 추천 차단 없음 — "향후 추천 제한 검토" Reference 만' };
  if (i.negativeCount >= 4) return { verdict: 'persistent_failure_pattern', note: '자동 차단 없음' };
  return { verdict: 'repeated_failure_candidate', note: '후보 — 원인 단정 없음' };
}

export type SuccessVerdict = 'single_success' | 'repeated_success_candidate' | 'context_limited_success' | 'cross_scope_success_candidate' | 'validated_practice_reference' | 'repeatability_unverified' | 'insufficient_data';
export function detectRepeatedSuccess(i: { positiveCount: number | null; sameContext: boolean; distinctScopes: number | null; humanValidated: boolean }): { verdict: SuccessVerdict; note: string } {
  if (!isFiniteNumber(i.positiveCount) || i.positiveCount < 0) return { verdict: 'insufficient_data', note: '데이터 없음' };
  if (i.positiveCount === 0) return { verdict: 'insufficient_data', note: '성공 표본 없음' };
  if (i.positiveCount === 1) return { verdict: 'single_success', note: '1회 성공 — Best Practice 확정 금지' };
  if (!i.sameContext) return { verdict: 'repeatability_unverified', note: 'Context 상이 — 재현 미확인' };
  if (i.humanValidated && isFiniteNumber(i.distinctScopes) && i.distinctScopes >= 2 && i.positiveCount >= 3) {
    return { verdict: 'validated_practice_reference', note: '사람 검토 Reference — 자동 표준 정책 아님' };
  }
  if (isFiniteNumber(i.distinctScopes) && i.distinctScopes >= 2) return { verdict: 'cross_scope_success_candidate', note: '후보 — 자동 적용 없음' };
  if (isFiniteNumber(i.distinctScopes) && i.distinctScopes <= 1) return { verdict: 'context_limited_success', note: '단일 scope 한정' };
  return { verdict: 'repeated_success_candidate', note: '후보 — 자동 적용 없음' };
}

/* ── Staleness(자동 삭제 없음) ───────────────────────────────────────── */
export function evaluateLearningStaleness(i: { evidenceAgeDays: number | null; policyVersionChanged: boolean; metricDefinitionChanged: boolean; scopeRetired: boolean }, agingDays = 90, staleDays = 180): { status: StalenessStatus; note: string } {
  if (i.scopeRetired || i.metricDefinitionChanged) return { status: 'invalidated_by_change', note: '구조/정의 변경 — 자동 삭제 없음(검토 필요)' };
  if (i.policyVersionChanged) return { status: 'stale_candidate', note: '정책 버전 변경 — 재검증 필요' };
  if (!isFiniteNumber(i.evidenceAgeDays)) return { status: 'staleness_unknown', note: '근거 시점 미상' };
  if (i.evidenceAgeDays >= staleDays) return { status: 'stale_candidate', note: `근거 ${i.evidenceAgeDays}일 경과 — 자동 삭제 없음` };
  if (i.evidenceAgeDays >= agingDays) return { status: 'aging', note: '재검증 권고' };
  return { status: 'current', note: '최신' };
}

export const KNOWLEDGE_REFRESH_TYPES = ['refresh_evidence', 'reobserve_outcome', 'validate_current_scope', 'compare_latest_policy_version', 'request_new_baseline', 'request_cross_scope_sample', 'review_metric_definition_change', 'invalidate_reference_candidate'] as const;

export function buildKnowledgeRefreshRecommendation(staleness: StalenessStatus): { refreshType: (typeof KNOWLEDGE_REFRESH_TYPES)[number] | null; autoExecuted: false } {
  const refreshType = staleness === 'invalidated_by_change' ? 'review_metric_definition_change'
    : staleness === 'stale_candidate' ? 'refresh_evidence'
    : staleness === 'aging' ? 'reobserve_outcome' : null;
  return { refreshType, autoExecuted: false };
}

/* ── Decision Chain(cycle 방어) ──────────────────────────────────────── */
export function buildDecisionChain(links: { parent: string; child: string; dependencyType: string | null }[], startId: string, maxDepth = 5): { chain: string[]; verdict: ChainVerdict } {
  if (!links.length) return { chain: [startId], verdict: 'insufficient_data' };
  const childMap = new Map<string, string[]>();
  for (const l of links) childMap.set(l.parent, [...(childMap.get(l.parent) ?? []), l.child]);
  const chain = [startId]; const seen = new Set([startId]);
  let cur = startId;
  for (let d = 0; d < maxDepth; d += 1) {
    const next = (childMap.get(cur) ?? []).find((c) => !seen.has(c));   // cycle 방어
    if (!next) break;
    chain.push(next); seen.add(next); cur = next;
  }
  if (chain.length === 1) return { chain, verdict: 'unrelated' };
  const typed = links.filter((l) => chain.includes(l.parent) && chain.includes(l.child));
  const allTyped = typed.every((l) => l.dependencyType != null);
  const verdict: ChainVerdict = chain.length >= 3 ? (allTyped ? 'direct_chain' : 'possibly_related') : allTyped ? 'indirect_chain' : 'causality_unverified';
  return { chain, verdict };
}

/* ── Governance Adaptation Recommendation ────────────────────────────── */
export const GOVERNANCE_ADAPTATION_TYPES = ['improve_evidence_collection', 'require_baseline', 'require_observation_window', 'require_execution_verification', 'require_separate_approver', 'improve_policy_scope_definition', 'improve_exception_tracking', 'add_policy_outcome_review', 'add_learning_review_frequency', 'refresh_stale_learning', 'review_conflicting_evidence', 'retire_unusable_learning_reference', 'create_policy_evolution_candidate', 'insufficient_data'] as const;
export type GovernanceAdaptationType = (typeof GOVERNANCE_ADAPTATION_TYPES)[number];

export interface GovernanceAdaptation {
  code: string; adaptationType: GovernanceAdaptationType; recommendation: string; reason: string;
  evidence: { label: string; value: number | string | null }[]; confidence: number;
  severity: 'low' | 'moderate' | 'high' | 'critical'; scope: string; expectedBenefit: string;
  preconditions: string[]; limitations: string[]; humanApprovalRequired: true; noAutoExecution: true;
}

export function buildGovernanceAdaptationRecommendation(i: { code: string; adaptationType: GovernanceAdaptationType; finding: string; evidenceCount: number | null; severity?: 'low' | 'moderate' | 'high' | 'critical' }): GovernanceAdaptation | { insufficient: true; why: string } {
  if (!(GOVERNANCE_ADAPTATION_TYPES as readonly string[]).includes(i.adaptationType)) return { insufficient: true, why: '허용되지 않는 유형' };
  if (!i.finding?.trim()) return { insufficient: true, why: '관찰 없음' };
  if (!isFiniteNumber(i.evidenceCount) || i.evidenceCount < 1) return { insufficient: true, why: 'Evidence 없음 — 생성 금지' };
  return {
    code: i.code, adaptationType: i.adaptationType,
    recommendation: `[${i.adaptationType}] ${i.finding} — Governance 개선 검토(자동 변경 없음)`,
    reason: `학습 근거 관찰: ${i.finding} (evidence ${i.evidenceCount}건)`,
    evidence: [{ label: 'evidence_count', value: i.evidenceCount }],
    confidence: clampScore(30 + Math.min(40, i.evidenceCount * 10)),
    severity: i.severity ?? 'moderate', scope: 'governance',
    expectedBenefit: '학습 근거 품질/거버넌스 절차 개선(사람 승인 후)',
    preconditions: ['Human Approval', 'Governance 원본 무변경 확인'],
    limitations: ['권고만 — 자동 Governance Rule/Constitution 변경 없음'],
    humanApprovalRequired: true, noAutoExecution: true,
  };
}

/* ── Review 검증 ─────────────────────────────────────────────────────── */
export function validateLearningReview(r: { reason?: string | null; supportingPatterns?: unknown[] | null } | null): string[] {
  if (!r) return ['review 없음'];
  const errors: string[] = [];
  if (!r.reason || !r.reason.trim()) errors.push('Reason 필수');
  if (!r.supportingPatterns || !r.supportingPatterns.length) errors.push('supporting pattern 필수');
  return errors;
}

export const EXTERNAL_POLICY_ACTION_TYPES = ['policy_version_created_reference', 'policy_scope_changed_reference', 'policy_threshold_changed_reference', 'policy_exception_added_reference', 'policy_exception_removed_reference', 'policy_deprecated_reference', 'policy_replaced_reference', 'governance_rule_changed_reference', 'training_process_changed_reference', 'manual_policy_action_reference'] as const;
export function validateExternalPolicyAction(actionType: string): boolean {
  return (EXTERNAL_POLICY_ACTION_TYPES as readonly string[]).includes(actionType);
}

/* ── Support Matrix ──────────────────────────────────────────────────── */
export interface OLSupportItem { key: string; label: string; status: 'fully_supported' | 'partially_supported' | 'read_only' | 'evidence_only' | 'external_reference_only' | 'sample_too_small' | 'causality_unverified' | 'policy_application_unverified' | 'unsupported' | 'insufficient_data'; note: string }

export const OL_SUPPORT: OLSupportItem[] = [
  { key: 'learning_evidence', label: 'Learning Evidence Pool', status: 'fully_supported', note: '요약+참조 — 원본 Outcome 복제/변경 없음' },
  { key: 'evidence_eligibility', label: 'Evidence Eligibility', status: 'fully_supported', note: 'outcome_pending/미검증 제외 — exclusion_reason 보존(삭제 없음)' },
  { key: 'evidence_strength', label: 'Evidence Strength', status: 'partially_supported', note: '재정규화 — 인과 미확인 strong 상한(DB CHECK + 순수 로직)' },
  { key: 'context_signature', label: 'Context Signature', status: 'partially_supported', note: '실존 필드만 — Context 다르면 통합 금지. Brand/Region/Team 구조 미존재' },
  { key: 'learning_pattern', label: 'Learning Pattern', status: 'fully_supported', note: '표본<3 승격 금지 — Best Practice 아님' },
  { key: 'repeatability', label: 'Repeatability', status: 'partially_supported', note: '단일=single_observation · 초기 표본 부족(sample_too_small)' },
  { key: 'applicability', label: 'Applicability', status: 'partially_supported', note: '다수 scope 일관 근거 시에만 broadly_applicable_candidate' },
  { key: 'conflicting_evidence', label: 'Conflicting Evidence', status: 'fully_supported', note: '평균으로 숨김 금지 — 보존 · 자동 해결 없음' },
  { key: 'organizational_learning', label: 'Organizational Learning', status: 'fully_supported', note: 'AI 초안 ≠ 검증 지식 — validated_reference 는 사람 검토' },
  { key: 'learning_maturity', label: 'Learning Maturity', status: 'partially_supported', note: '10성분 재정규화 — 인사/조직 평가 아님' },
  { key: 'policy_outcome_mapping', label: 'Policy Outcome Mapping', status: 'policy_application_unverified', note: '정책 존재 ≠ 적용 — 확인 불가 시 unverified 유지' },
  { key: 'policy_performance', label: 'Policy Performance', status: 'partially_supported', note: '적용 미확인 시 판정 금지 · 1회 실패 폐기 금지(3회+)' },
  { key: 'policy_evolution_candidate', label: 'Policy Evolution Candidate', status: 'fully_supported', note: '후보만 — Policy Version 생성/적용 없음' },
  { key: 'evolution_safety_gate', label: 'Evolution Safety Gate', status: 'partially_supported', note: 'Production Apply 상태 미포함' },
  { key: 'repeated_failure', label: 'Repeated Failure Detection', status: 'partially_supported', note: '자동 추천 차단 없음 — 제한 검토 Reference 만' },
  { key: 'repeated_success', label: 'Repeated Success Detection', status: 'partially_supported', note: 'validated_practice_reference = 사람 검토 — 자동 표준 아님' },
  { key: 'practice_candidate', label: 'Practice Candidate', status: 'evidence_only', note: 'Event 기록(테이블 최소화) — 자동 적용 없음' },
  { key: 'learning_staleness', label: 'Learning Staleness', status: 'partially_supported', note: '오래됐다는 이유로 자동 삭제 없음' },
  { key: 'knowledge_refresh', label: 'Knowledge Refresh', status: 'partially_supported', note: '권고만 — 재실행/재관찰 자동 수행 없음' },
  { key: 'decision_chain', label: 'Decision Chain Learning', status: 'causality_unverified', note: 'cycle 방어 · Outcome 기여는 후보 표현만' },
  { key: 'governance_adaptation', label: 'Governance Adaptation', status: 'fully_supported', note: '권고만 — Governance/Constitution 변경 없음' },
  { key: 'policy_evolution_timeline', label: 'Policy Evolution Timeline', status: 'partially_supported', note: '실제 적용 Event 와 Reference Event 구분 표기' },
  { key: 'human_review', label: 'Human Review Workflow', status: 'fully_supported', note: 'Learning/Evolution/Practice 3중 — 종결 재결정 차단' },
  { key: 'external_policy_action', label: 'External Policy Action Reference', status: 'external_reference_only', note: '참고 기록만 — 실제 정책 변경 미실행' },
  { key: 'historical_backfill', label: 'Historical Learning Backfill', status: 'insufficient_data', note: '과거 표본 부족 · Source ID 체계 상이' },
  { key: 'vector_search', label: 'Vector/Embedding 검색', status: 'unsupported', note: '미도입 — 구조화 필드 기반(정직 표기)' },
  { key: 'auto_policy_change', label: '자동 정책 변경/승인/폐기/적용', status: 'unsupported', note: '금지' },
  { key: 'auto_model_training', label: '자동 모델 학습/Fine-tuning/Embedding/Weight/Prompt', status: 'unsupported', note: '금지' },
  { key: 'auto_governance_change', label: '자동 Governance/Trust/Constitution 변경', status: 'unsupported', note: '금지' },
  { key: 'personnel_evaluation', label: '직원/부서/조직 성과 평가', status: 'unsupported', note: '금지' },
  { key: 'production_apply', label: 'Production Apply/Merge/Deploy/Migration', status: 'unsupported', note: '금지' },
];
