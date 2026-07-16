import { describe, expect, it } from 'vitest';
import {
  buildCorrectiveAction,
  buildPolicyProposal,
  buildPostmortemDraft,
  buildPreventiveAction,
  buildRuntimeLearningRecommendation,
  buildRuntimeLearningTimeline,
  detectRecurrencePattern,
  evaluateContributingFactors,
  evaluateControlGaps,
  evaluateOrganizationalLearningReadiness,
  evaluatePolicyApplication,
  evaluatePolicyEffectiveness,
  evaluatePostmortemCompleteness,
  evaluateRecoveryEffectiveness,
  evaluateRootCauseCandidate,
  LEARNING_COMPONENTS,
  POLICY_DOMAINS,
  ROOT_CAUSE_TYPES,
  RUNTIME_LEARNING_SUPPORT,
} from './runtimeLearning';

const NOW = new Date('2026-07-16T12:00:00Z');

describe('postmortem — Draft ≠ Approved·Root Cause 확정 아님', () => {
  it('invalid session/incident 거부 + evidence 없으면 pending_evidence', () => {
    expect('rejected' in buildPostmortemDraft({ sessionExists: false, incidentCandidateExists: true, incidentSummary: 'x', knownFacts: [], unknownFactors: [], evidence: [] })).toBe(true);
    expect('rejected' in buildPostmortemDraft({ sessionExists: true, incidentCandidateExists: false, incidentSummary: 'x', knownFacts: [], unknownFactors: [], evidence: [] })).toBe(true);
    const noEv = buildPostmortemDraft({ sessionExists: true, incidentCandidateExists: true, incidentSummary: 'timeout 후보', knownFacts: ['f'], unknownFactors: ['u'], evidence: [] });
    if ('status' in noEv) expect(noEv.status).toBe('pending_evidence');
    const draft = buildPostmortemDraft({ sessionExists: true, incidentCandidateExists: null, incidentSummary: 'timeout 후보', knownFacts: ['f'], unknownFactors: ['u'], evidence: ['0537 실측'] });
    if ('status' in draft) {
      expect(draft.status).toBe('draft');
      expect(draft.draftIsNotApproved).toBe(true);
      expect(draft.postmortemIsNotRootCause).toBe(true);
      expect(draft.blameAssigned).toBe(false);
    }
  });
  it('completeness: evidence null → insufficient·결측 목록', () => {
    expect(evaluatePostmortemCompleteness({ summary: true, timeline: true, detection: true, recovery: true, resolution: true, evidenceCount: null, unknownFactorsDocumented: true }).result).toBe('insufficient_data');
    expect(evaluatePostmortemCompleteness({ summary: true, timeline: false, detection: true, recovery: true, resolution: true, evidenceCount: 0, unknownFactorsDocumented: true }).result).toBe('pending_evidence');
    const inc = evaluatePostmortemCompleteness({ summary: true, timeline: false, detection: true, recovery: false, resolution: true, evidenceCount: 2, unknownFactorsDocumented: true });
    expect(inc.result).toBe('evidence_incomplete');
    expect(inc.missing).toEqual(['timeline_summary', 'recovery_summary']);
    expect(evaluatePostmortemCompleteness({ summary: true, timeline: true, detection: true, recovery: true, resolution: true, evidenceCount: 3, unknownFactorsDocumented: true }).result).toBe('review_ready_reference');
  });
});

describe('root cause — Candidate ≠ Confirmed·Correlation ≠ Causality', () => {
  it('evidence 없음 insufficient·counter 우세 contradicted·사람 확인만 confirmed', () => {
    expect(evaluateRootCauseCandidate({ type: 'meteor', evidence: ['e'], counterEvidence: [], alternativeExplanations: [], humanConfirmedReference: false }).status).toBe('invalidated');
    expect(evaluateRootCauseCandidate({ type: 'timeout_policy_candidate', evidence: [], counterEvidence: [], alternativeExplanations: [], humanConfirmedReference: false }).status).toBe('insufficient_data');
    expect(evaluateRootCauseCandidate({ type: 'timeout_policy_candidate', evidence: ['e'], counterEvidence: ['c1', 'c2'], alternativeExplanations: [], humanConfirmedReference: false }).status).toBe('contradicted_candidate');
    expect(evaluateRootCauseCandidate({ type: 'timeout_policy_candidate', evidence: ['e', 'e2'], counterEvidence: ['c'], alternativeExplanations: [], humanConfirmedReference: false }).status).toBe('evidence_partial');
    expect(evaluateRootCauseCandidate({ type: 'timeout_policy_candidate', evidence: ['e'], counterEvidence: [], alternativeExplanations: [], humanConfirmedReference: false }).status).toBe('supported_candidate');
    const confirmed = evaluateRootCauseCandidate({ type: 'timeout_policy_candidate', evidence: ['e'], counterEvidence: [], alternativeExplanations: [], humanConfirmedReference: true });
    expect(confirmed.status).toBe('confirmed_reference');
    expect(confirmed.candidateIsNotConfirmedRootCause).toBe(true);
    expect(confirmed.correlationIsNotCausality).toBe(true);
    expect(confirmed.autoConfirmed).toBe(false);
    expect(ROOT_CAUSE_TYPES).toHaveLength(18);
  });
});

describe('contributing factor / control gap — 결측 재정규화 없음·확정 취약점 아님', () => {
  it('factor: direction null/evidence 없음 → unverified 유지', () => {
    const r = evaluateContributingFactors([
      { name: 'timeout', direction: 'supporting', evidence: ['e'], contradicted: false },
      { name: 'retry', direction: 'amplifying', evidence: ['e'], contradicted: false },
      { name: 'cleanup', direction: 'mitigating', evidence: ['e'], contradicted: false },
      { name: 'perm', direction: null, evidence: ['e'], contradicted: false },
      { name: 'scope', direction: 'supporting', evidence: [], contradicted: false },
      { name: 'cred', direction: 'supporting', evidence: ['e'], contradicted: true },
    ]);
    expect(r.rows[0].result).toBe('supporting_factor_candidate');
    expect(r.rows[1].result).toBe('amplifying_factor_candidate');
    expect(r.rows[2].result).toBe('mitigating_factor_candidate');
    expect(r.rows[3].result).toBe('factor_unverified');
    expect(r.rows[4].result).toBe('factor_unverified');
    expect(r.rows[5].result).toBe('contradicted_factor_candidate');
    expect(r.unverifiedCount).toBe(2);
    expect(r.factorIsNotCause).toBe(true);
  });
  it('control gap: missing/bypass/weakness/evidence/effectiveness 구분', () => {
    const r = evaluateControlGaps([
      { name: 'approval', present: true, effective: true, bypassed: false, evidence: ['e'] },
      { name: 'dryrun', present: false, effective: null, bypassed: false, evidence: [] },
      { name: 'scope', present: true, effective: null, bypassed: true, evidence: ['e'] },
      { name: 'idem', present: true, effective: false, bypassed: false, evidence: ['e'] },
      { name: 'cleanup', present: true, effective: true, bypassed: false, evidence: [] },
      { name: 'obs', present: true, effective: null, bypassed: false, evidence: ['e'] },
      { name: 'unknown', present: null, effective: null, bypassed: false, evidence: [] },
    ]);
    expect(r.rows.map((x) => x.result)).toEqual(['no_control_gap_reference', 'control_missing_candidate', 'control_bypass_candidate', 'control_weakness_candidate', 'control_evidence_missing', 'control_effectiveness_unverified', 'insufficient_data']);
    expect(r.gapCount).toBe(5);
    expect(r.gapIsNotConfirmedVulnerability).toBe(true);
  });
});

describe('recurrence — Pattern ≠ Root Cause·sample/stale 유지', () => {
  it('sample_too_small/stale/dimension별 후보', () => {
    const base = { dimension: 'connector' as const, occurrences: 3, sampleSize: 10, minSample: 5, lastObservedAt: new Date('2026-07-15T00:00:00Z'), now: NOW, staleAfterDays: 14 };
    expect(detectRecurrencePattern({ ...base, occurrences: null }).result).toBe('insufficient_data');
    expect(detectRecurrencePattern({ ...base, sampleSize: 3 }).result).toBe('sample_too_small');
    expect(detectRecurrencePattern({ ...base, lastObservedAt: new Date('2026-06-01T00:00:00Z') }).result).toBe('stale_input_candidate');
    expect(detectRecurrencePattern({ ...base, occurrences: 1 }).result).toBe('recurrence_not_detected');
    expect(detectRecurrencePattern(base).result).toBe('repeated_connector_pattern');
    expect(detectRecurrencePattern({ ...base, dimension: 'automation' }).result).toBe('repeated_automation_pattern');
    expect(detectRecurrencePattern({ ...base, dimension: 'signal' }).result).toBe('repeated_signal_candidate');
    expect(detectRecurrencePattern({ ...base, dimension: 'incident' }).result).toBe('repeated_incident_candidate');
    const cg = detectRecurrencePattern({ ...base, dimension: 'control_gap' });
    expect(cg.result).toBe('repeated_control_gap_candidate');
    expect(cg.patternIsNotRootCause).toBe(true);
    expect(cg.repeatedSignalIsNotStructuralProblem).toBe(true);
    expect(cg.autoConfirmed).toBe(false);
  });
});

describe('recovery effectiveness — Resolution ≠ Outcome', () => {
  it('sample/recurrence 미확인 유지', () => {
    expect(evaluateRecoveryEffectiveness({ recoveryReviews: null, resolvedReferences: 3, recurrenceAfterResolution: 0, sampleMin: 2 }).result).toBe('insufficient_data');
    expect(evaluateRecoveryEffectiveness({ recoveryReviews: 3, resolvedReferences: 1, recurrenceAfterResolution: 0, sampleMin: 2 }).result).toBe('sample_too_small');
    expect(evaluateRecoveryEffectiveness({ recoveryReviews: 3, resolvedReferences: 3, recurrenceAfterResolution: null, sampleMin: 2 }).result).toBe('recurrence_unverified');
    expect(evaluateRecoveryEffectiveness({ recoveryReviews: 3, resolvedReferences: 3, recurrenceAfterResolution: 1, sampleMin: 2 }).result).toBe('recovery_ineffective_candidate');
    const r = evaluateRecoveryEffectiveness({ recoveryReviews: 3, resolvedReferences: 3, recurrenceAfterResolution: 0, sampleMin: 2 });
    expect(r.result).toBe('recovery_effective_candidate');
    expect(r.resolutionIsNotOutcomeSuccess).toBe(true);
  });
});

describe('corrective / preventive — Proposal ≠ Applied·≠ Policy 변경', () => {
  it('corrective: whitelist+Evidence + 고위험 2차 검토', () => {
    expect('rejected' in buildCorrectiveAction({ type: 'delete_everything', summary: 'x', evidence: ['e'], highRisk: false, irreversible: false })).toBe(true);
    expect('rejected' in buildCorrectiveAction({ type: 'revise_timeout_policy', summary: 'x', evidence: [], highRisk: false, irreversible: false })).toBe(true);
    const hi = buildCorrectiveAction({ type: 'revise_timeout_policy', summary: 'timeout 상향 검토', evidence: ['timeout 후보 실측'], highRisk: true, irreversible: false });
    if ('approvalRequired' in hi) {
      expect(hi.approvalRequired).toBe(true);
      expect(hi.secondaryReviewRequired).toBe(true);
      expect(hi.proposalIsNotAppliedAction).toBe(true);
      expect(hi.autoApplied).toBe(false);
    }
  });
  it('preventive: whitelist + Policy 변경 아님', () => {
    expect('rejected' in buildPreventiveAction({ type: 'fire_employee', summary: 'x', evidence: ['e'] })).toBe(true);
    const r = buildPreventiveAction({ type: 'require_idempotency_proposal', summary: 'Write Action 멱등성 필수화 제안', evidence: ['duplicate 후보 실측'] });
    if ('preventiveActionIsNotPolicyChange' in r) {
      expect(r.preventiveActionIsNotPolicyChange).toBe(true);
      expect(r.autoApplied).toBe(false);
    }
  });
});

describe('policy proposal / application / effectiveness — 단계 분리', () => {
  it('proposal: domain whitelist + current policy unknown 유지', () => {
    expect('rejected' in buildPolicyProposal({ domain: 'world_domination', title: 'x', evidence: ['e'], currentPolicyReference: null })).toBe(true);
    expect('rejected' in buildPolicyProposal({ domain: 'timeout_policy', title: 'x', evidence: [], currentPolicyReference: null })).toBe(true);
    const r = buildPolicyProposal({ domain: 'timeout_policy', title: 'Timeout 정책 개선안', evidence: ['0537 실측'], currentPolicyReference: null });
    if ('proposalIsNotApproval' in r) {
      expect(r.currentPolicyKnown).toBe(false);
      expect(r.proposalIsNotApproval).toBe(true);
      expect(r.approvalIsNotApplication).toBe(true);
      expect(r.thresholdChanged).toBe(false);
    }
    expect(POLICY_DOMAINS).toHaveLength(20);
  });
  it('application: 승인/기록/검증 단계 + Reference ≠ 적용 성공', () => {
    expect(evaluatePolicyApplication({ approved: false, referenceRecorded: false, verificationEvidence: [], rollbackReviewNeeded: false }).status).toBe('not_requested');
    expect(evaluatePolicyApplication({ approved: false, referenceRecorded: true, verificationEvidence: [], rollbackReviewNeeded: false }).status).toBe('approval_missing');
    expect(evaluatePolicyApplication({ approved: true, referenceRecorded: false, verificationEvidence: [], rollbackReviewNeeded: false }).status).toBe('application_pending');
    expect(evaluatePolicyApplication({ approved: true, referenceRecorded: true, verificationEvidence: [], rollbackReviewNeeded: false }).status).toBe('application_unverified');
    expect(evaluatePolicyApplication({ approved: true, referenceRecorded: true, verificationEvidence: ['e'], rollbackReviewNeeded: true }).status).toBe('rollback_review_required');
    const v = evaluatePolicyApplication({ approved: true, referenceRecorded: true, verificationEvidence: ['e'], rollbackReviewNeeded: false });
    expect(v.status).toBe('verified_reference');
    expect(v.applicationReferenceIsNotAppliedSuccess).toBe(true);
    expect(v.appliedIsNotEffective).toBe(true);
  });
  it('effectiveness: adverse/sample/stale/causality 유지 + 인과 자동 확정 없음', () => {
    const base = { applicationVerified: true, baseline: 10, observed: 5, sampleSize: 20, minSample: 10, observedAt: new Date('2026-07-15T00:00:00Z'), now: NOW, staleAfterDays: 30, adverseSignals: 0, externalFactorsRuledOut: true };
    expect(evaluatePolicyEffectiveness({ ...base, applicationVerified: false }).result).toBe('observation_not_started');
    expect(evaluatePolicyEffectiveness({ ...base, adverseSignals: 2 }).result).toBe('adverse_effect_candidate');
    expect(evaluatePolicyEffectiveness({ ...base, baseline: null }).result).toBe('insufficient_data');
    expect(evaluatePolicyEffectiveness({ ...base, sampleSize: 3 }).result).toBe('sample_too_small');
    expect(evaluatePolicyEffectiveness({ ...base, observedAt: new Date('2026-01-01T00:00:00Z') }).result).toBe('stale_input_candidate');
    expect(evaluatePolicyEffectiveness({ ...base, externalFactorsRuledOut: false }).result).toBe('causality_unverified');
    expect(evaluatePolicyEffectiveness(base).result).toBe('effectiveness_candidate');
    expect(evaluatePolicyEffectiveness({ ...base, observed: 15 }).result).toBe('ineffectiveness_candidate');
    const same = evaluatePolicyEffectiveness({ ...base, observed: 10 });
    expect(same.result).toBe('no_material_change_candidate');
    expect(same.applicationIsNotEffectiveness).toBe(true);
    expect(same.effectivenessIsNotCausality).toBe(true);
  });
});

describe('organizational learning — 원본 자동 변경 없음', () => {
  it('승인/확정/검증/효과 선행 게이트 + partial unknown 유지', () => {
    expect(evaluateOrganizationalLearningReadiness({ postmortemApproved: false, rootCauseConfirmedReference: true, policyApplicationVerified: true, effectivenessReviewed: true }).result).toBe('postmortem_approval_missing');
    expect(evaluateOrganizationalLearningReadiness({ postmortemApproved: true, rootCauseConfirmedReference: false, policyApplicationVerified: true, effectivenessReviewed: true }).result).toBe('root_cause_unverified');
    expect(evaluateOrganizationalLearningReadiness({ postmortemApproved: true, rootCauseConfirmedReference: true, policyApplicationVerified: null, effectivenessReviewed: null }).result).toBe('learning_reference_partial');
    expect(evaluateOrganizationalLearningReadiness({ postmortemApproved: true, rootCauseConfirmedReference: true, policyApplicationVerified: false, effectivenessReviewed: true }).result).toBe('policy_application_unverified');
    expect(evaluateOrganizationalLearningReadiness({ postmortemApproved: true, rootCauseConfirmedReference: true, policyApplicationVerified: true, effectivenessReviewed: false }).result).toBe('effectiveness_unverified');
    const r = evaluateOrganizationalLearningReadiness({ postmortemApproved: true, rootCauseConfirmedReference: true, policyApplicationVerified: true, effectivenessReviewed: true });
    expect(r.result).toBe('learning_reference_ready');
    expect(r.sourceMemoryChanged).toBe(false);
  });
});

describe('recommendation / timeline / components / support', () => {
  it('recommendation: whitelist+Evidence 필수 + confidence clamp + 자동 적용 없음', () => {
    expect('rejected' in buildRuntimeLearningRecommendation({ type: 'apply_policy_now', reason: 'x', evidence: ['e'], confidence: null })).toBe(true);
    expect('rejected' in buildRuntimeLearningRecommendation({ type: 'review_root_cause_candidate', reason: 'x', evidence: [], confidence: null })).toBe(true);
    const r = buildRuntimeLearningRecommendation({ type: 'propose_assurance_policy_change', reason: 'timeout 후보 반복 — 정책 개선안 제안(적용 아님)', evidence: ['recurrence 실측'], confidence: 999 });
    if ('humanApprovalRequired' in r) {
      expect(r.humanApprovalRequired).toBe(true);
      expect(r.autoApplied).toBe(false);
      expect(r.confidence).toBe(100);
      expect(r.limitations).toContain('Proposal ≠ Approved Policy');
    }
  });
  it('timeline: 9단계 + 원본 없는 단계 insufficient_data', () => {
    const r = buildRuntimeLearningTimeline([
      { stage: 'history', count: 5, source: 'sessions 실측' },
      { stage: 'postmortem', count: 1, source: 'postmortems 실측' },
      { stage: 'warp', count: 9, source: 'x' },
    ]);
    expect(r.stages).toHaveLength(9);
    expect(r.stages.find((s) => s.stage === 'effectiveness')?.status).toBe('insufficient_data');
    expect(r.invalidStages).toBe(1);
    expect(r.timelineIsNotCompletionClaim).toBe(true);
  });
  it('components: policy versioning(0512) 실존 + runtime postmortem/threshold versioning 없음', () => {
    expect(LEARNING_COMPONENTS.find((c) => c.key === 'policy_versioning_0512')?.available).toBe(true);
    expect(LEARNING_COMPONENTS.find((c) => c.key === 'organizational_learning_0515')?.available).toBe(true);
    for (const key of ['runtime_postmortem_history', 'assurance_threshold_versioning', 'runtime_rule_apply_engine', 'provider_outage_feed', 'external_incident_feed']) {
      expect(LEARNING_COMPONENTS.find((c) => c.key === key)?.available).toBe(false);
    }
  });
  it('SUPPORT: 37항목 + automatic_* 10종 전부 unsupported', () => {
    expect(RUNTIME_LEARNING_SUPPORT).toHaveLength(37);
    for (const key of ['automatic_root_cause_confirmation', 'automatic_policy_approval', 'automatic_policy_application', 'automatic_threshold_change', 'automatic_connector_disable', 'automatic_automation_disable', 'automatic_runtime_rule_change', 'automatic_production_mutation', 'automatic_employee_evaluation', 'automatic_responsibility_assignment']) {
      expect(RUNTIME_LEARNING_SUPPORT.find((s) => s.key === key)?.status).toBe('unsupported');
    }
  });
});
