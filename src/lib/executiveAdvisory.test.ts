import { describe, expect, it } from 'vitest';
import {
  BLOCKED_DECISION_DOMAINS, BLOCKED_OPTION_TYPES, DECISION_DOMAINS, DECISION_OPTION_TYPES,
  DECISION_STATUSES, EXECUTIVE_RECOMMENDATION_TYPES, EXECUTIVE_SUPPORT_MATRIX,
  buildDecisionContext, buildDecisionLearningReference, buildDecisionOption, buildExecutiveBrief,
  buildExecutiveRecommendationCandidate, buildExecutiveTimeline, buildNoActionConsequence,
  calculateDecisionDriftCandidate, calculateDecisionQualityCandidate, detectEvidenceConflicts,
  detectEvidenceGaps, evaluateAgentAgreementCandidate, evaluateAgentConflictCandidate,
  evaluateDecisionOutcome, evaluateDecisionPriorityCandidate, evaluateDecisionUrgencyCandidate,
  evaluateEvidenceQuality, evaluateExecutiveTradeoffs, evaluateOptionFeasibility,
  evaluateOptionRegret, evaluateOptionReversibility, evaluateOptionRobustness,
  evaluatePolicyConstraints, synthesizeAgentAdvisory, synthesizeCrossDomainImpact,
  synthesizeFinancialImpact, validateExecutiveReviewAction,
} from './executiveAdvisory';

const NOW = new Date('2026-07-17T00:00:00Z');

describe('executiveAdvisory — Decision Context/Priority/Urgency', () => {
  it('금지 도메인 거부, 허용 도메인 draft (Context ≠ Decision)', () => {
    for (const d of BLOCKED_DECISION_DOMAINS) {
      const r = buildDecisionContext({ domain: d, title: 't', question: 'q', scopeType: 'enterprise', deadline: null, now: NOW });
      expect('rejected' in r && r.rejected).toBe(true);
    }
    const ok = buildDecisionContext({ domain: 'capacity_planning', title: '용량 결정', question: '확장할까?', scopeType: 'enterprise', deadline: new Date('2026-07-27T00:00:00Z'), now: NOW });
    expect(ok).toMatchObject({ status: 'draft', contextIsNotDecision: true, autoApproved: false, productionApplied: false, deadlineDays: 10 });
    expect(DECISION_DOMAINS).toHaveLength(27);
    expect(DECISION_STATUSES).toHaveLength(16);
  });

  it('priority: 데이터 없음 → insufficient, 완전성 낮음 → unverified, 고위험+규제기한 → critical (확정 아님)', () => {
    expect(evaluateDecisionPriorityCandidate({ riskMagnitude: null, impactedDomainCount: null, delayCostKnown: false, regulatoryDeadline: false, incidentLinked: false, criticalWarningLinked: false, irreversibleOptionOnly: false, dataCompleteness: null }).result).toBe('insufficient_data');
    expect(evaluateDecisionPriorityCandidate({ riskMagnitude: 90, impactedDomainCount: 3, delayCostKnown: true, regulatoryDeadline: true, incidentLinked: false, criticalWarningLinked: false, irreversibleOptionOnly: false, dataCompleteness: 10 }).result).toBe('priority_unverified');
    const r = evaluateDecisionPriorityCandidate({ riskMagnitude: 80, impactedDomainCount: 4, delayCostKnown: true, regulatoryDeadline: true, incidentLinked: true, criticalWarningLinked: true, irreversibleOptionOnly: false, dataCompleteness: 90 });
    expect(r.result).toBe('critical_candidate');
    expect(r.priorityIsNotFinalBusinessPriority).toBe(true);
  });

  it('urgency: deadline 없음/미검증/1일 내 구분 (자동 승인 아님)', () => {
    expect(evaluateDecisionUrgencyCandidate({ deadline: null, now: NOW, deadlineVerified: true }).result).toBe('no_deadline_candidate');
    expect(evaluateDecisionUrgencyCandidate({ deadline: new Date('2026-07-18T00:00:00Z'), now: NOW, deadlineVerified: false }).result).toBe('urgency_unverified');
    const r = evaluateDecisionUrgencyCandidate({ deadline: new Date('2026-07-17T12:00:00Z'), now: NOW, deadlineVerified: true });
    expect(r.result).toBe('immediate_review_candidate');
    expect(r.urgencyIsNotAutomaticApproval).toBe(true);
    expect(evaluateDecisionUrgencyCandidate({ deadline: new Date('2026-09-30T00:00:00Z'), now: NOW, deadlineVerified: true }).result).toBe('routine_candidate');
  });
});

describe('executiveAdvisory — Evidence(양 ≠ 질)', () => {
  it('missing/circular/duplicate/stale/ready 구분', () => {
    expect(evaluateEvidenceQuality({ items: [], staleAfterDays: 30 }).result).toBe('evidence_missing');
    expect(evaluateEvidenceQuality({ items: [{ key: 'a', source: 's', ageDays: 1, scopeMatched: true, versionMatched: true, derivedFromKeys: ['a'] }], staleAfterDays: 30 }).result).toBe('evidence_circularity_candidate');
    expect(evaluateEvidenceQuality({ items: [{ key: 'a', source: 's1', ageDays: 1, scopeMatched: true, versionMatched: true, derivedFromKeys: [] }, { key: 'a', source: 's2', ageDays: 1, scopeMatched: true, versionMatched: true, derivedFromKeys: [] }], staleAfterDays: 30 }).result).toBe('evidence_duplicate_candidate');
    expect(evaluateEvidenceQuality({ items: [{ key: 'a', source: 's', ageDays: 90, scopeMatched: true, versionMatched: true, derivedFromKeys: [] }], staleAfterDays: 30 }).result).toBe('evidence_stale_candidate');
    const ready = evaluateEvidenceQuality({ items: [{ key: 'a', source: 's', ageDays: 2, scopeMatched: true, versionMatched: true, derivedFromKeys: [] }], staleAfterDays: 30 });
    expect(ready.result).toBe('evidence_ready_reference');
    expect(ready.evidenceVolumeIsNotQuality).toBe(true);
  });

  it('gap/conflict 탐지 — 미탐지 ≠ 없음', () => {
    const gap = detectEvidenceGaps({ requiredKinds: ['cost', 'risk', 'capacity'], presentKinds: ['cost'] });
    expect(gap.missing).toEqual(['risk', 'capacity']);
    expect(gap.noDetectedGapIsNotNoGap).toBe(true);
    const conf = detectEvidenceConflicts([{ key: 'cost', value: '100', source: 'a' }, { key: 'cost', value: '900', source: 'b' }]);
    expect(conf.result).toBe('evidence_conflict_candidate');
    expect(conf.noDetectedConflictIsNotNoConflict).toBe(true);
  });
});

describe('executiveAdvisory — Multi-Agent Advisory(Consensus ≠ Truth)', () => {
  it('unavailable/specialist missing/shared evidence/consensus/split 구분', () => {
    expect(synthesizeAgentAdvisory({ inputs: [], requiredSpecialistRoles: [] }).result).toBe('advisory_input_unavailable');
    const base = { recommendedOptionCode: 'A', confidence: 70, independentEvidence: true, dissent: false, derivedFromAgentRoles: [] as string[] };
    expect(synthesizeAgentAdvisory({ inputs: [{ agentRole: 'ops', ...base }], requiredSpecialistRoles: ['security'] }).result).toBe('specialist_missing');
    expect(synthesizeAgentAdvisory({ inputs: [{ agentRole: 'ops', ...base, independentEvidence: false }, { agentRole: 'cost', ...base, independentEvidence: false }], requiredSpecialistRoles: [] }).result).toBe('shared_evidence_dependency_candidate');
    const consensus = synthesizeAgentAdvisory({ inputs: [{ agentRole: 'ops', ...base }, { agentRole: 'cost', ...base }, { agentRole: 'security', ...base }], requiredSpecialistRoles: [] });
    expect(consensus.result).toBe('advisory_consensus_candidate');
    expect(consensus.consensusIsNotTruth).toBe(true);
    expect(consensus.autoOptionSelected).toBe(false);
    expect(synthesizeAgentAdvisory({ inputs: [{ agentRole: 'ops', ...base }, { agentRole: 'cost', ...base, recommendedOptionCode: 'B' }], requiredSpecialistRoles: [] }).result).toBe('advisory_conflict_candidate');
  });

  it('agreement/conflict candidate — 다수결 ≠ 정답, Conflict ≠ Error', () => {
    expect(evaluateAgentAgreementCandidate({ supportRatio: 0.9, independentEvidenceRatio: 0.8, roleDiversityCount: 4, dissentExists: false }).result).toBe('strong_agreement_candidate');
    expect(evaluateAgentAgreementCandidate({ supportRatio: 0.5, independentEvidenceRatio: 0.8, roleDiversityCount: 4, dissentExists: true }).result).toBe('split_opinion_candidate');
    expect(evaluateAgentAgreementCandidate({ supportRatio: null, independentEvidenceRatio: null, roleDiversityCount: null, dissentExists: false }).result).toBe('insufficient_data');
    const c = evaluateAgentConflictCandidate({ conflictKinds: ['policy_interpretation'], assumptionConflict: false, evidenceConflict: true });
    expect(c.result).toBe('structural_conflict_candidate');
    expect(c.conflictIsNotError).toBe(true);
    expect(evaluateAgentConflictCandidate({ conflictKinds: [], assumptionConflict: false, evidenceConflict: false }).result).toBe('no_material_conflict_candidate');
  });
});

describe('executiveAdvisory — Option/Constraint/Feasibility/Reversibility', () => {
  it('금지 option type 거부 + no_action/defer 파생 플래그 (Option ≠ Execution)', () => {
    for (const t of BLOCKED_OPTION_TYPES) {
      const r = buildDecisionOption({ optionType: t, name: 'x', summary: '' });
      expect('rejected' in r && r.rejected).toBe(true);
    }
    const noAction = buildDecisionOption({ optionType: 'no_action_reference', name: '현행 유지', summary: '' });
    expect(noAction).toMatchObject({ isNoAction: true, optionIsNotSelectedOption: true, optionIsNotExecution: true, productionApplied: false });
    expect(DECISION_OPTION_TYPES).toHaveLength(16);
  });

  it('constraint: constitution 차단 우선, secondary review, clear (우회 없음)', () => {
    const blocked = evaluatePolicyConstraints({ policyBlocked: true, constitutionBlocked: true, complianceBlocked: false, contractBlocked: false, scopeBlocked: false, approvalRequired: true, secondaryReviewRequired: true, conditional: false, constraintsVerified: true });
    expect(blocked.result).toBe('option_blocked_by_constitution');
    expect(blocked.constraintBypassed).toBe(false);
    expect(evaluatePolicyConstraints({ policyBlocked: false, constitutionBlocked: false, complianceBlocked: false, contractBlocked: false, scopeBlocked: false, approvalRequired: false, secondaryReviewRequired: true, conditional: false, constraintsVerified: true }).result).toBe('secondary_review_required_reference');
    expect(evaluatePolicyConstraints({ policyBlocked: false, constitutionBlocked: false, complianceBlocked: false, contractBlocked: false, scopeBlocked: false, approvalRequired: false, secondaryReviewRequired: false, conditional: false, constraintsVerified: false }).result).toBe('constraint_unverified');
  });

  it('feasibility: reviewer 없음 → blocked, null → unverified (리소스 예약 아님)', () => {
    expect(evaluateOptionFeasibility({ technicallyPossible: true, reviewerAvailable: false, budgetReferenceAvailable: true, capacityAvailable: true, policyAllowed: true, scheduleRealistic: true }).result).toBe('feasibility_blocked_candidate');
    expect(evaluateOptionFeasibility({ technicallyPossible: null, reviewerAvailable: true, budgetReferenceAvailable: null, capacityAvailable: null, policyAllowed: true, scheduleRealistic: null }).result).toBe('feasibility_unverified');
    const ok = evaluateOptionFeasibility({ technicallyPossible: true, reviewerAvailable: true, budgetReferenceAvailable: true, capacityAvailable: true, policyAllowed: true, scheduleRealistic: true });
    expect(ok.result).toBe('feasible_candidate');
    expect(ok.feasibilityIsNotResourceReservation).toBe(true);
  });

  it('reversibility: 계약 비가역 → irreversible, rollback 미검증 → 조건부 (보장 아님)', () => {
    expect(evaluateOptionReversibility({ rollbackReferenceExists: true, rollbackVerified: true, dataMutation: false, contractualIrreversibility: true, costIrreversibility: false, customerImpactHigh: false }).result).toBe('irreversible_candidate');
    expect(evaluateOptionReversibility({ rollbackReferenceExists: null, rollbackVerified: false, dataMutation: false, contractualIrreversibility: false, costIrreversibility: false, customerImpactHigh: false }).result).toBe('reversibility_unverified');
    const r = evaluateOptionReversibility({ rollbackReferenceExists: true, rollbackVerified: true, dataMutation: false, contractualIrreversibility: false, costIrreversibility: false, customerImpactHigh: false });
    expect(r.result).toBe('highly_reversible_candidate');
    expect(r.reversibilityIsNotRollbackGuarantee).toBe(true);
  });
});

describe('executiveAdvisory — Impact/Trade-off/Robustness/Regret', () => {
  it('financial: budget 없음 → constraint, 순이익+비용 → mixed (회계 확정 아님)', () => {
    expect(synthesizeFinancialImpact({ estimatedCost: 100, estimatedSavings: 500, budgetAvailable: false }).result).toBe('budget_constraint_candidate');
    const mixed = synthesizeFinancialImpact({ estimatedCost: 100, estimatedSavings: 500, budgetAvailable: true });
    expect(mixed.result).toBe('mixed_financial_candidate');
    expect(mixed.financialCandidateIsNotAccountingFact).toBe(true);
    expect(synthesizeFinancialImpact({ estimatedCost: null, estimatedSavings: null, budgetAvailable: true }).result).toBe('insufficient_data');
    expect(synthesizeFinancialImpact({ estimatedCost: Number.NaN, estimatedSavings: 10, budgetAvailable: true }).result).toBe('financial_impact_unverified');
  });

  it('impact synthesis: 단일/다중/전사/혼합 구분 (Settlement/Payment Reference만)', () => {
    expect(synthesizeCrossDomainImpact({ impactedDomains: ['cost'], adverseDomains: [], favorableDomains: ['cost'], totalDomainCount: 10 }).result).toBe('isolated_impact_candidate');
    expect(synthesizeCrossDomainImpact({ impactedDomains: ['a', 'b', 'c'], adverseDomains: [], favorableDomains: [], totalDomainCount: 10 }).result).toBe('multi_domain_impact_candidate');
    const mixed = synthesizeCrossDomainImpact({ impactedDomains: ['a', 'b'], adverseDomains: ['a'], favorableDomains: ['b'], totalDomainCount: 10 });
    expect(mixed.result).toBe('mixed_impact_candidate');
    expect(mixed.settlementPaymentReferenceOnly).toBe(true);
  });

  it('tradeoff: 잘못된 axis 거부·balanced·auto winner 없음', () => {
    expect(evaluateExecutiveTradeoffs({ axis: 'invalid_axis', favorableSideScore: 50, unfavorableSideScore: 50 }).result).toBe('insufficient_data');
    const b = evaluateExecutiveTradeoffs({ axis: 'speed_vs_safety', favorableSideScore: 52, unfavorableSideScore: 50 });
    expect(b.result).toBe('balanced_tradeoff_candidate');
    expect(b.autoWinnerSelected).toBe(false);
    expect(evaluateExecutiveTradeoffs({ axis: 'risk_vs_cost', favorableSideScore: 90, unfavorableSideScore: 20 }).result).toBe('favorable_tradeoff_candidate');
  });

  it('robustness/regret — Robust ≠ Correct·Lowest Regret ≠ Best', () => {
    const cases = (flags: (boolean | null)[]) => flags.map((acceptable, k) => ({ scenario: `s${k}`, acceptable }));
    const robust = evaluateOptionRobustness({ caseOutcomes: cases([true, true, true, true]), minScenarios: 3 });
    expect(robust.result).toBe('robust_option_candidate');
    expect(robust.robustOptionIsNotCorrectOption).toBe(true);
    expect(evaluateOptionRobustness({ caseOutcomes: cases([true, false, false, false]), minScenarios: 3 }).result).toBe('scenario_specific_candidate');
    expect(evaluateOptionRobustness({ caseOutcomes: cases([true, null, true]), minScenarios: 3 }).result).toBe('robustness_unverified');
    const regret = evaluateOptionRegret({ worstCaseLoss: 100, bestAlternativeGap: 5, reversible: false });
    expect(regret.result).toBe('asymmetric_regret_candidate');
    expect(regret.lowestRegretIsNotBestDecision).toBe(true);
    expect(evaluateOptionRegret({ worstCaseLoss: 0, bestAlternativeGap: 0, reversible: true }).result).toBe('lowest_regret_candidate');
  });
});

describe('executiveAdvisory — Brief/Recommendation/Human Review', () => {
  it('brief: evidence 없으면 pending_evidence, recommendation은 Evidence 필수 (Brief ≠ Approval)', () => {
    expect(buildExecutiveBrief({ contextExists: false, optionCount: 0, evidenceCount: 0, advisoryAvailable: false, recommendationType: null })).toMatchObject({ rejected: true });
    expect(buildExecutiveBrief({ contextExists: true, optionCount: 2, evidenceCount: 0, advisoryAvailable: true, recommendationType: 'defer_decision_candidate' })).toMatchObject({ rejected: true });
    const b = buildExecutiveBrief({ contextExists: true, optionCount: 3, evidenceCount: 2, advisoryAvailable: true, recommendationType: 'proceed_with_conditions_candidate' });
    expect(b).toMatchObject({ status: 'draft', briefIsNotDecision: true, briefIsNotApproval: true, preferredOptionIsNotFinalChoice: true, humanApprovalRequired: true });
    expect(buildExecutiveBrief({ contextExists: true, optionCount: 1, evidenceCount: 0, advisoryAvailable: true, recommendationType: null })).toMatchObject({ status: 'pending_evidence' });
  });

  it('recommendation candidate: whitelist+Evidence, confidence clamp (≠ Approval)', () => {
    expect(buildExecutiveRecommendationCandidate({ type: 'auto_execute', reason: 'r', evidence: ['e'], confidence: 50 })).toMatchObject({ rejected: true });
    expect(buildExecutiveRecommendationCandidate({ type: 'reversible_pilot_candidate', reason: 'r', evidence: [], confidence: 50 })).toMatchObject({ rejected: true });
    const r = buildExecutiveRecommendationCandidate({ type: 'reversible_pilot_candidate', reason: '가역 파일럿', evidence: ['scenario_run'], confidence: 250 });
    expect(r).toMatchObject({ confidence: 100, recommendationIsNotApproval: true, humanExecutiveApprovalRequired: true, autoSelected: false, autoExecuted: false });
    expect(EXECUTIVE_RECOMMENDATION_TYPES).toHaveLength(20);
  });

  it('executive review: self-approval 차단, Evidence 필수, production_applied 항상 false', () => {
    expect(validateExecutiveReviewAction({ action: 'approve_reference', reason: 'ok', evidenceCount: 1, reviewerIsCreator: true })).toMatchObject({ rejected: true });
    expect(validateExecutiveReviewAction({ action: 'approve_reference', reason: 'ok', evidenceCount: 0, reviewerIsCreator: false })).toMatchObject({ rejected: true });
    expect(validateExecutiveReviewAction({ action: 'approve_reference', reason: '', evidenceCount: 1, reviewerIsCreator: false })).toMatchObject({ rejected: true });
    const ok = validateExecutiveReviewAction({ action: 'approve_with_conditions_reference', reason: '조건부 승인', evidenceCount: 2, reviewerIsCreator: false });
    expect(ok).toMatchObject({ humanDecisionConfirmed: true, approvalIsNotAppliedChange: true, productionApplied: false, autoApproved: false });
    expect(validateExecutiveReviewAction({ action: 'execute_decision', reason: 'r', evidenceCount: 1, reviewerIsCreator: false })).toMatchObject({ rejected: true });
  });
});

describe('executiveAdvisory — Outcome/Quality/Drift/Learning/Timeline/Matrix', () => {
  it('outcome: 외부 요인 → causality_unverified, 표본 부족 → sample_too_small (Outcome ≠ Causality)', () => {
    expect(evaluateDecisionOutcome({ observedOutcomeExists: false, observationCompletenessPct: null, externalFactorPresent: false, sampleSize: 10, minSample: 5 }).result).toBe('outcome_unverified');
    expect(evaluateDecisionOutcome({ observedOutcomeExists: true, observationCompletenessPct: 100, externalFactorPresent: false, sampleSize: 2, minSample: 5 }).result).toBe('sample_too_small');
    expect(evaluateDecisionOutcome({ observedOutcomeExists: true, observationCompletenessPct: 100, externalFactorPresent: true, sampleSize: 10, minSample: 5 }).result).toBe('causality_unverified');
    const linked = evaluateDecisionOutcome({ observedOutcomeExists: true, observationCompletenessPct: 95, externalFactorPresent: false, sampleSize: 10, minSample: 5 });
    expect(linked.result).toBe('outcome_linked_reference');
    expect(linked.outcomeLinkIsNotCausality).toBe(true);
  });

  it('quality: outcome 미연결 → unverified, 3/3 달성 → high (경영 평가 아님)', () => {
    expect(calculateDecisionQualityCandidate({ outcomeLinked: false, goalAchieved: true, costWithinRange: true, riskWithinRange: true, unexpectedSideEffect: false, causalityVerified: true, sampleSize: 10, minSample: 5 }).result).toBe('outcome_unverified');
    expect(calculateDecisionQualityCandidate({ outcomeLinked: true, goalAchieved: true, costWithinRange: true, riskWithinRange: true, unexpectedSideEffect: false, causalityVerified: false, sampleSize: 10, minSample: 5 }).result).toBe('causality_unverified');
    const high = calculateDecisionQualityCandidate({ outcomeLinked: true, goalAchieved: true, costWithinRange: true, riskWithinRange: true, unexpectedSideEffect: false, causalityVerified: true, sampleSize: 10, minSample: 5 });
    expect(high.result).toBe('high_quality_candidate');
    expect(high.qualityCandidateIsNotVerifiedQuality).toBe(true);
    expect(calculateDecisionQualityCandidate({ outcomeLinked: true, goalAchieved: true, costWithinRange: true, riskWithinRange: false, unexpectedSideEffect: true, causalityVerified: true, sampleSize: 10, minSample: 5 }).result).toBe('mixed_quality_candidate');
  });

  it('drift: goal_drift → structural, 0건 → no_material (Confirmed 아님)', () => {
    expect(calculateDecisionDriftCandidate({ driftedDimensions: null, assumptionsInvalidated: null }).result).toBe('insufficient_data');
    expect(calculateDecisionDriftCandidate({ driftedDimensions: ['goal_drift'], assumptionsInvalidated: 0 }).result).toBe('structural_drift_candidate');
    const none = calculateDecisionDriftCandidate({ driftedDimensions: [], assumptionsInvalidated: 0 });
    expect(none.result).toBe('no_material_drift_candidate');
    expect(none.driftCandidateIsNotConfirmedDrift).toBe(true);
  });

  it('learning/no-action/timeline — 자동 정책 변경 없음·Scenario ≠ Reality', () => {
    const learn = buildDecisionLearningReference({ effectiveEvidence: ['a'], ineffectiveEvidence: [], missedRisks: ['b'], overestimatedOpportunities: [], reviewTriggers: ['c'] });
    expect(learn).toMatchObject({ entryCount: 3, result: 'learning_reference_recorded', autoPolicyChanged: false });
    const na = buildNoActionConsequence({ projectedRiskDelta: 12, projectedCostDelta: null, unknownFactors: ['u1'] });
    expect(na).toMatchObject({ result: 'no_action_consequence_reference', scenarioIsNotReality: true, unknownCount: 1 });
    const t = buildExecutiveTimeline({ present: { decision_context: true, evidence: true, executive_review: false } });
    expect(t.stages).toHaveLength(10);
    expect(t.completedCount).toBe(2);
    expect(t.timelineIsNotExecutionLog).toBe(true);
  });

  it('support matrix: 58항목, automatic 계열 11개 전부 unsupported', () => {
    expect(EXECUTIVE_SUPPORT_MATRIX).toHaveLength(58);
    const unsupported = EXECUTIVE_SUPPORT_MATRIX.filter((f) => f.status === 'unsupported');
    expect(unsupported).toHaveLength(11);
    expect(unsupported.every((f) => f.feature.startsWith('automatic_'))).toBe(true);
  });
});
