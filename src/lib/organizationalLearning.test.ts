// Phase AI-OPS-12 — Organizational Learning & Policy Evolution 순수 로직 단위 테스트.
// Eligibility(미관측 제외·사유 보존) · Strength(인과 상한·충돌 보존) · Context(통합 금지) ·
// Pattern(표본 방어·Best Practice 아님) · Repeatability/Applicability(일반화 방어) ·
// Conflict(평균 숨김 금지) · Maturity(인사 평가 아님) · Policy Mapping(존재≠적용) ·
// Evolution(1회 실패 폐기 금지·Version 생성 없음) · Safety Gate · 반복 실패/성공 ·
// Staleness(자동 삭제 없음) · Chain(cycle 방어) · Governance 권고 · Support.
import { describe, it, expect } from 'vitest';
import {
  evaluateEvidenceEligibility, calculateLearningEvidenceStrength, buildContextSignature,
  groupLearningEvidence, detectLearningPattern, evaluatePatternRepeatability, evaluateApplicability,
  detectConflictingEvidence, calculateLearningMaturity, mapPolicyOutcomes, evaluatePolicyPerformance,
  buildPolicyEvolutionCandidate, evaluatePolicyEvolutionSafety, detectRepeatedFailure, detectRepeatedSuccess,
  evaluateLearningStaleness, buildKnowledgeRefreshRecommendation, buildDecisionChain,
  buildGovernanceAdaptationRecommendation, validateLearningReview, validateExternalPolicyAction, OL_SUPPORT,
  type LearningEvidenceItem,
} from './organizationalLearning';

const ELIGIBLE = { hasDecision: true, hasHumanDecision: true, executionKnown: true, outcomeStatus: 'positive' as const, observationClosed: true, baselineAvailable: true, hasEvidence: true, hasScope: true, decisionTerminal: false };

describe('Evidence Eligibility(미관측 제외 — 사유 보존)', () => {
  it('전부 충족 시 eligible · outcome_pending/미종료/invalidated/baseline 없음 제외', () => {
    expect(evaluateEvidenceEligibility(ELIGIBLE).eligible).toBe(true);
    expect(evaluateEvidenceEligibility({ ...ELIGIBLE, outcomeStatus: 'outcome_pending' }).exclusionReason).toContain('outcome_pending');
    expect(evaluateEvidenceEligibility({ ...ELIGIBLE, observationClosed: false }).exclusionReason).toBe('observation_incomplete');
    expect(evaluateEvidenceEligibility({ ...ELIGIBLE, decisionTerminal: true }).eligible).toBe(false);
    expect(evaluateEvidenceEligibility({ ...ELIGIBLE, baselineAvailable: false }).exclusionReason).toBe('baseline_unavailable');
    expect(evaluateEvidenceEligibility({ ...ELIGIBLE, hasScope: false }).exclusionReason).toBe('scope_unverified');
    expect(evaluateEvidenceEligibility({ ...ELIGIBLE, executionKnown: false }).exclusionReason).toContain('execution_unverified');
    expect(evaluateEvidenceEligibility({ ...ELIGIBLE, hasHumanDecision: false }).eligible).toBe(false);
  });
});

describe('Evidence Strength(인과 미확인 strong 상한 · 충돌 보존)', () => {
  const base = { baselineQuality: 90, observationCoverage: 90, sampleSize: 10, executionVerified: true, outcomeConfidence: 80, repeatability: 'consistently_observed' as const, scopeMatch: true, auditComplete: true, hasConflict: false };
  it('strong/moderate/insufficient · 인과 미확인이면 strong → moderate 강등 · 충돌 → conflicting', () => {
    expect(calculateLearningEvidenceStrength({ ...base, causality: 'plausible_contribution' }).strength).toBe('strong');
    expect(calculateLearningEvidenceStrength({ ...base, causality: 'causality_unverified' }).strength).toBe('moderate');
    expect(calculateLearningEvidenceStrength({ ...base, causality: 'confounded' }).strength).toBe('moderate');
    expect(calculateLearningEvidenceStrength({ ...base, causality: 'plausible_contribution', hasConflict: true }).strength).toBe('conflicting');
    const partial = calculateLearningEvidenceStrength({ ...base, causality: 'plausible_contribution', scopeMatch: null, auditComplete: null });
    expect(partial.missing).toEqual(['scope', 'audit']);
    expect(calculateLearningEvidenceStrength({ baselineQuality: null, observationCoverage: null, sampleSize: null, executionVerified: null, outcomeConfidence: null, causality: 'not_evaluated', repeatability: 'not_evaluated', scopeMatch: null, auditComplete: null, hasConflict: false }).strength).toBe('insufficient_data');
  });
});

describe('Context Signature(다르면 통합 금지)', () => {
  it('실존 필드만 정렬 서명 · 그룹 분리', () => {
    expect(buildContextSignature({ domain: 'policy', enterprise: 'E1', region: null })).toBe('domain=policy|enterprise=e1');
    expect(buildContextSignature({})).toBe('context_unknown');
    const items: LearningEvidenceItem[] = [
      { id: 'a', contextSignature: 'domain=policy', outcomeStatus: 'positive', domain: 'policy' },
      { id: 'b', contextSignature: 'domain=policy', outcomeStatus: 'positive', domain: 'policy' },
      { id: 'c', contextSignature: 'domain=security', outcomeStatus: 'negative', domain: 'security' },
    ];
    const g = groupLearningEvidence(items);
    expect(g.size).toBe(2); expect(g.get('domain=policy')!.length).toBe(2);
  });
});

describe('Pattern(표본 방어 · Best Practice 아님)', () => {
  const E = (id: string, outcomeStatus: LearningEvidenceItem['outcomeStatus'], ctx = 'c1'): LearningEvidenceItem => ({ id, contextSignature: ctx, outcomeStatus, domain: 'policy' });
  it('표본<3 → insufficient(승격 금지) · 반복 성공/실패/조건부/혼합 · context 불일치 거부', () => {
    const small = detectLearningPattern([E('a', 'positive')]);
    if ('insufficient' in small) throw new Error('unexpected');
    expect(small.patternType).toBe('insufficient_data'); expect(small.repeatability).toBe('single_observation');
    const success = detectLearningPattern([E('a', 'positive'), E('b', 'positive'), E('c', 'positive')]);
    if ('insufficient' in success) throw new Error('unexpected');
    expect(success.patternType).toBe('repeated_success_candidate');
    expect(success.bestPractice).toBe(false);
    expect(success.note).toContain('확정 아님');
    const fail = detectLearningPattern([E('a', 'negative'), E('b', 'negative'), E('c', 'negative')]);
    if ('insufficient' in fail) throw new Error('unexpected');
    expect(fail.patternType).toBe('repeated_failure_candidate');
    const mixed = detectLearningPattern([E('a', 'positive'), E('b', 'negative'), E('c', 'mixed')]);
    if ('insufficient' in mixed) throw new Error('unexpected');
    expect(mixed.patternType).toBe('mixed_outcome_pattern'); expect(mixed.repeatability).toBe('inconsistent');
    expect('insufficient' in detectLearningPattern([E('a', 'positive'), E('b', 'positive', 'c2'), E('c', 'positive')])).toBe(true);
    expect('insufficient' in detectLearningPattern([])).toBe(true);
  });
});

describe('Repeatability / Applicability(일반화 방어)', () => {
  it('단일/표본 부족/일관/context 한정/불일치', () => {
    expect(evaluatePatternRepeatability({ observations: 1, distinctContexts: 1, distinctScopes: 1, consistent: true })).toBe('single_observation');
    expect(evaluatePatternRepeatability({ observations: 2, distinctContexts: 1, distinctScopes: 1, consistent: true })).toBe('sample_too_small');
    expect(evaluatePatternRepeatability({ observations: 4, distinctContexts: 2, distinctScopes: 2, consistent: true })).toBe('consistently_observed');
    expect(evaluatePatternRepeatability({ observations: 4, distinctContexts: 1, distinctScopes: 1, consistent: true })).toBe('context_limited');
    expect(evaluatePatternRepeatability({ observations: 4, distinctContexts: 2, distinctScopes: 1, consistent: false })).toBe('inconsistent');
    expect(evaluatePatternRepeatability({ observations: 4, distinctContexts: 2, distinctScopes: 1, consistent: null })).toBe('repeatability_unverified');
    expect(evaluatePatternRepeatability({ observations: null, distinctContexts: null, distinctScopes: null, consistent: null })).toBe('insufficient_data');
  });
  it('scope 한정 · 다수 scope 일관 시에만 broad 후보 · 미확인', () => {
    expect(evaluateApplicability({ scopeType: 'enterprise', consistentScopeCount: null, totalScopeCount: null })).toBe('enterprise_specific');
    expect(evaluateApplicability({ scopeType: 'store', consistentScopeCount: 1, totalScopeCount: 1 })).toBe('store_specific');
    expect(evaluateApplicability({ scopeType: 'enterprise', consistentScopeCount: 2, totalScopeCount: 3 })).toBe('cross_scope_candidate');
    expect(evaluateApplicability({ scopeType: 'enterprise', consistentScopeCount: 3, totalScopeCount: 3 })).toBe('broadly_applicable_candidate');
    expect(evaluateApplicability({ scopeType: null, consistentScopeCount: 5, totalScopeCount: 5 })).toBe('applicability_unverified');
  });
});

describe('Conflicting Evidence(평균 숨김 금지)', () => {
  it('반대 근거 혼재 → mild/material · 정산 축 critical · 보존 문구', () => {
    expect(detectConflictingEvidence({ positive: 3, negative: 0, axis: 'enterprise' }).level).toBe('no_known_conflict');
    expect(detectConflictingEvidence({ positive: 4, negative: 1, axis: 'enterprise' }).level).toBe('mild_conflict');
    expect(detectConflictingEvidence({ positive: 3, negative: 2, axis: 'policy_version' }).level).toBe('material_conflict');
    expect(detectConflictingEvidence({ positive: 2, negative: 2, axis: 'settlement', paymentOrSettlement: true }).level).toBe('critical_conflict');
    expect(detectConflictingEvidence({ positive: 0, negative: 0, axis: 'x' }).level).toBe('insufficient_data');
    expect(detectConflictingEvidence({ positive: 3, negative: 2, axis: 'x' }).note).toContain('숨기지 않고 보존');
  });
});

describe('Learning Maturity(인사 평가 아님)', () => {
  it('initial~adaptive_candidate · 재정규화 · 전부 null insufficient', () => {
    const full = { evidenceCoverage: 90, observationRate: 90, baselineAvailability: 90, executionVerification: 90, repeatabilityCoverage: 90, contextCoverage: 90, policyMapping: 90, humanValidation: 90, auditCompleteness: 90, freshness: 90 };
    expect(calculateLearningMaturity(full).maturity).toBe('adaptive_candidate');
    expect(calculateLearningMaturity({ ...full, evidenceCoverage: 10, observationRate: 10, baselineAvailability: 10, executionVerification: 10, repeatabilityCoverage: 10, contextCoverage: 10, policyMapping: 10, humanValidation: 10, auditCompleteness: 10, freshness: 10 }).maturity).toBe('initial');
    const r = calculateLearningMaturity({ ...full, policyMapping: null, freshness: null });
    expect(r.missing).toEqual(['policy_mapping', 'freshness']);
    expect(r.notForPersonnelEvaluation).toBe(true);
    expect(calculateLearningMaturity({ evidenceCoverage: null, observationRate: null, baselineAvailability: null, executionVerification: null, repeatabilityCoverage: null, contextCoverage: null, policyMapping: null, humanValidation: null, auditCompleteness: null, freshness: null }).maturity).toBe('insufficient_data');
  });
});

describe('Policy Outcome / Performance(존재 ≠ 적용)', () => {
  it('적용 미확인 → policy_application_unverified 유지', () => {
    expect(mapPolicyOutcomes({ policyCode: 'p1', positive: 2, negative: 1, mixed: 0, inconclusive: 1, applicationVerified: null }).applicationStatus).toBe('policy_application_unverified');
    expect(evaluatePolicyPerformance({ positive: 5, negative: 0, mixed: 0, inconclusive: 0, applicationVerified: null, stale: false })).toBe('policy_application_unverified');
  });
  it('1회 실패 폐기 금지(3회+) · 충돌 · 표본 부족 partial · stale', () => {
    const V = { applicationVerified: true, stale: false };
    expect(evaluatePolicyPerformance({ positive: 0, negative: 1, mixed: 0, inconclusive: 0, ...V })).toBe('review_required');
    expect(evaluatePolicyPerformance({ positive: 0, negative: 3, mixed: 0, inconclusive: 0, ...V })).toBe('deprecation_candidate');
    expect(evaluatePolicyPerformance({ positive: 2, negative: 1, mixed: 0, inconclusive: 0, ...V })).toBe('conflicting_outcomes');
    expect(evaluatePolicyPerformance({ positive: 2, negative: 0, mixed: 0, inconclusive: 0, ...V })).toBe('partially_supported');
    expect(evaluatePolicyPerformance({ positive: 4, negative: 0, mixed: 0, inconclusive: 0, ...V })).toBe('evidence_supports_current_policy');
    expect(evaluatePolicyPerformance({ positive: 3, negative: 0, mixed: 1, inconclusive: 0, ...V })).toBe('scope_limited');
    expect(evaluatePolicyPerformance({ positive: 3, negative: 0, mixed: 0, inconclusive: 0, applicationVerified: true, stale: true })).toBe('stale_policy_candidate');
    expect(evaluatePolicyPerformance({ positive: 0, negative: 0, mixed: 0, inconclusive: 2, ...V })).toBe('insufficient_data');
  });
});

describe('Evolution Candidate / Safety Gate(Version 생성 없음)', () => {
  it('표본<3/적용 미확인 → 생성 금지 · 성과별 후보 유형 · Version 미생성 플래그', () => {
    expect('insufficient' in buildPolicyEvolutionCandidate({ code: 'c1', performance: 'deprecation_candidate', sampleSize: 2, conflictLevel: 'no_known_conflict' })).toBe(true);
    expect('insufficient' in buildPolicyEvolutionCandidate({ code: 'c2', performance: 'policy_application_unverified', sampleSize: 5, conflictLevel: 'no_known_conflict' })).toBe(true);
    const dep = buildPolicyEvolutionCandidate({ code: 'c3', performance: 'deprecation_candidate', sampleSize: 5, conflictLevel: 'no_known_conflict' });
    if ('insufficient' in dep) throw new Error('unexpected');
    expect(dep.candidateType).toBe('deprecate_policy_candidate');
    expect(dep.policyVersionCreated).toBe(false); expect(dep.humanApprovalRequired).toBe(true);
    const conflict = buildPolicyEvolutionCandidate({ code: 'c4', performance: 'review_required', sampleSize: 5, conflictLevel: 'material_conflict' });
    if ('insufficient' in conflict) throw new Error('unexpected');
    expect(conflict.candidateType).toBe('request_more_evidence');
    const ok = buildPolicyEvolutionCandidate({ code: 'c5', performance: 'evidence_supports_current_policy', sampleSize: 5, conflictLevel: 'no_known_conflict' });
    if ('insufficient' in ok) throw new Error('unexpected');
    expect(ok.candidateType).toBe('retain_current_policy');
    expect(ok).toEqual(buildPolicyEvolutionCandidate({ code: 'c5', performance: 'evidence_supports_current_policy', sampleSize: 5, conflictLevel: 'no_known_conflict' }));
  });
  it('Safety Gate — 적용 미확인/scope/충돌/근거 부족 차단 · Production Apply 미포함', () => {
    const base = { applicationVerified: true, scopeVerified: true, conflictLevel: 'no_known_conflict' as const, evidenceStrength: 'moderate' as const, hasBaselinePlan: true, hasObservationPlan: true, separateApprover: true };
    expect(evaluatePolicyEvolutionSafety(base).verdict).toBe('ready_for_human_review');
    expect(evaluatePolicyEvolutionSafety({ ...base, applicationVerified: null }).verdict).toBe('policy_application_unverified');
    expect(evaluatePolicyEvolutionSafety({ ...base, scopeVerified: false }).verdict).toBe('scope_unverified');
    expect(evaluatePolicyEvolutionSafety({ ...base, conflictLevel: 'critical_conflict' }).verdict).toBe('conflict_detected');
    expect(evaluatePolicyEvolutionSafety({ ...base, evidenceStrength: 'insufficient_data' }).verdict).toBe('insufficient_data');
    expect(evaluatePolicyEvolutionSafety({ ...base, separateApprover: false }).verdict).toBe('waiting_evidence');
    expect(evaluatePolicyEvolutionSafety(base).productionApply).toBe(false);
  });
});

describe('반복 실패/성공(자동 차단·표준 없음)', () => {
  it('실패 — 1회 isolated · context 상이 제외 · critical 도 자동 차단 없음', () => {
    expect(detectRepeatedFailure({ negativeCount: 0, sameContext: true }).verdict).toBe('no_known_repeat_failure');
    expect(detectRepeatedFailure({ negativeCount: 1, sameContext: true }).note).toContain('확정 금지');
    expect(detectRepeatedFailure({ negativeCount: 3, sameContext: false }).verdict).toBe('isolated_failure');
    expect(detectRepeatedFailure({ negativeCount: 2, sameContext: true }).verdict).toBe('repeated_failure_candidate');
    expect(detectRepeatedFailure({ negativeCount: 5, sameContext: true }).verdict).toBe('persistent_failure_pattern');
    const crit = detectRepeatedFailure({ negativeCount: 3, sameContext: true, critical: true });
    expect(crit.verdict).toBe('critical_repeat_failure');
    expect(crit.note).toContain('차단 없음');
    expect(detectRepeatedFailure({ negativeCount: null, sameContext: true }).verdict).toBe('insufficient_data');
  });
  it('성공 — 1회 single · 사람 검증+다수 scope 만 validated_practice_reference', () => {
    expect(detectRepeatedSuccess({ positiveCount: 1, sameContext: true, distinctScopes: 1, humanValidated: false }).verdict).toBe('single_success');
    expect(detectRepeatedSuccess({ positiveCount: 3, sameContext: true, distinctScopes: 1, humanValidated: false }).verdict).toBe('context_limited_success');
    expect(detectRepeatedSuccess({ positiveCount: 3, sameContext: true, distinctScopes: 2, humanValidated: false }).verdict).toBe('cross_scope_success_candidate');
    const val = detectRepeatedSuccess({ positiveCount: 3, sameContext: true, distinctScopes: 2, humanValidated: true });
    expect(val.verdict).toBe('validated_practice_reference');
    expect(val.note).toContain('자동 표준 정책 아님');
    expect(detectRepeatedSuccess({ positiveCount: 3, sameContext: false, distinctScopes: 2, humanValidated: false }).verdict).toBe('repeatability_unverified');
  });
});

describe('Staleness / Refresh / Chain', () => {
  it('Staleness — current/aging/stale/invalidated · 자동 삭제 없음', () => {
    expect(evaluateLearningStaleness({ evidenceAgeDays: 10, policyVersionChanged: false, metricDefinitionChanged: false, scopeRetired: false }).status).toBe('current');
    expect(evaluateLearningStaleness({ evidenceAgeDays: 100, policyVersionChanged: false, metricDefinitionChanged: false, scopeRetired: false }).status).toBe('aging');
    const stale = evaluateLearningStaleness({ evidenceAgeDays: 200, policyVersionChanged: false, metricDefinitionChanged: false, scopeRetired: false });
    expect(stale.status).toBe('stale_candidate'); expect(stale.note).toContain('자동 삭제 없음');
    expect(evaluateLearningStaleness({ evidenceAgeDays: 10, policyVersionChanged: true, metricDefinitionChanged: false, scopeRetired: false }).status).toBe('stale_candidate');
    expect(evaluateLearningStaleness({ evidenceAgeDays: 10, policyVersionChanged: false, metricDefinitionChanged: true, scopeRetired: false }).status).toBe('invalidated_by_change');
    expect(evaluateLearningStaleness({ evidenceAgeDays: null, policyVersionChanged: false, metricDefinitionChanged: false, scopeRetired: false }).status).toBe('staleness_unknown');
    expect(buildKnowledgeRefreshRecommendation('stale_candidate').refreshType).toBe('refresh_evidence');
    expect(buildKnowledgeRefreshRecommendation('current').refreshType).toBeNull();
    expect(buildKnowledgeRefreshRecommendation('stale_candidate').autoExecuted).toBe(false);
  });
  it('Decision Chain — direct/possibly/unrelated · cycle 방어', () => {
    const links = [{ parent: 'a', child: 'b', dependencyType: 'evidence' }, { parent: 'b', child: 'c', dependencyType: 'evidence' }];
    const r = buildDecisionChain(links, 'a');
    expect(r.chain).toEqual(['a', 'b', 'c']); expect(r.verdict).toBe('direct_chain');
    expect(buildDecisionChain([{ parent: 'a', child: 'b', dependencyType: null }], 'a').verdict).toBe('causality_unverified');
    expect(buildDecisionChain(links, 'z').verdict).toBe('unrelated');
    const cyc = buildDecisionChain([{ parent: 'a', child: 'b', dependencyType: 'x' }, { parent: 'b', child: 'a', dependencyType: 'x' }], 'a');
    expect(cyc.chain.length).toBeLessThanOrEqual(3);
    expect(buildDecisionChain([], 'a').verdict).toBe('insufficient_data');
  });
});

describe('Governance Adaptation / Review / Support', () => {
  it('권고 — Evidence 없으면 생성 금지 · Human Approval · 결정적', () => {
    const ok = buildGovernanceAdaptationRecommendation({ code: 'g1', adaptationType: 'require_baseline', finding: 'baseline 없는 결정 4건', evidenceCount: 4, severity: 'high' });
    if ('insufficient' in ok) throw new Error('unexpected');
    expect(ok.humanApprovalRequired).toBe(true); expect(ok.noAutoExecution).toBe(true);
    expect(ok.limitations.join(' ')).toContain('Constitution 변경 없음');
    expect('insufficient' in buildGovernanceAdaptationRecommendation({ code: 'g2', adaptationType: 'require_baseline', finding: 'x', evidenceCount: 0 })).toBe(true);
    expect('insufficient' in buildGovernanceAdaptationRecommendation({ code: 'g3', adaptationType: 'delete_rule' as never, finding: 'x', evidenceCount: 3 })).toBe(true);
    expect(ok).toEqual(buildGovernanceAdaptationRecommendation({ code: 'g1', adaptationType: 'require_baseline', finding: 'baseline 없는 결정 4건', evidenceCount: 4, severity: 'high' }));
  });
  it('Review 검증 · External Action whitelist', () => {
    expect(validateLearningReview({ reason: 'r', supportingPatterns: [1] })).toEqual([]);
    expect(validateLearningReview({ reason: ' ', supportingPatterns: [] }).length).toBe(2);
    expect(validateLearningReview(null)).toEqual(['review 없음']);
    expect(validateExternalPolicyAction('policy_deprecated_reference')).toBe(true);
    expect(validateExternalPolicyAction('apply_policy')).toBe(false);
  });
  it('Support Matrix — 자동 정책/학습/거버넌스/인사 평가 전부 unsupported', () => {
    expect(OL_SUPPORT.find((s) => s.key === 'policy_outcome_mapping')!.status).toBe('policy_application_unverified');
    expect(OL_SUPPORT.find((s) => s.key === 'decision_chain')!.status).toBe('causality_unverified');
    expect(OL_SUPPORT.find((s) => s.key === 'vector_search')!.status).toBe('unsupported');
    expect(OL_SUPPORT.find((s) => s.key === 'conflicting_evidence')!.note).toContain('숨김 금지');
    for (const k of ['auto_policy_change', 'auto_model_training', 'auto_governance_change', 'personnel_evaluation', 'production_apply']) {
      expect(OL_SUPPORT.find((s) => s.key === k)!.status).toBe('unsupported');
    }
  });
});
