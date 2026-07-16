import { describe, expect, it } from 'vitest';
import {
  POLICY_CHANGE_DOMAINS, BLOCKED_POLICY_DOMAINS, POLICY_CHANGE_TYPES, SPECIFICATION_STATUSES,
  SIMULATION_TYPES, SIMULATION_STATUSES, ROLLOUT_STRATEGIES, BLOCKED_ROLLOUT_STRATEGIES,
  ROLLOUT_STATUSES, CONFLICT_RESULTS, COMPATIBILITY_DOMAINS, ROLLOUT_RECOMMENDATION_TYPES, ROLLOUT_TIMELINE_STAGES,
  buildPolicyChangeSpecification, calculatePolicyDelta, evaluateBaselineReadiness, evaluateHistoricalReplay,
  evaluateCounterfactualSimulation, detectPolicyConflicts, evaluateDomainCompatibility, calculateBlastRadius,
  evaluateOperationalFriction, evaluateSafetyBenefit, evaluateValidationPlan, buildControlledRolloutPlan,
  evaluateRolloutGate, evaluateRolloutApplication, evaluatePostRolloutObservation,
  buildPolicyRolloutRecommendation, buildPolicyRolloutTimeline, SIMULATION_COMPONENTS, POLICY_ROLLOUT_SUPPORT,
} from './policySimulation';

const NOW = new Date('2026-07-16T00:00:00Z');

describe('policySimulation 상수(0539 CHECK 정렬)', () => {
  it('whitelist 개수 고정 — 허용 도메인 20·금지 12·전략 8·금지 전략 5·상태 11/10/20', () => {
    expect(POLICY_CHANGE_DOMAINS).toHaveLength(20);
    expect(BLOCKED_POLICY_DOMAINS).toHaveLength(12);
    expect(POLICY_CHANGE_TYPES).toHaveLength(20);
    expect(SPECIFICATION_STATUSES).toHaveLength(11);
    expect(SIMULATION_TYPES).toHaveLength(8);
    expect(SIMULATION_STATUSES).toHaveLength(10);
    expect(ROLLOUT_STRATEGIES).toHaveLength(8);
    expect(BLOCKED_ROLLOUT_STRATEGIES).toHaveLength(5);
    expect(ROLLOUT_STATUSES).toHaveLength(20);
    expect(CONFLICT_RESULTS).toHaveLength(17);
    expect(COMPATIBILITY_DOMAINS).toHaveLength(8);
    expect(ROLLOUT_RECOMMENDATION_TYPES).toHaveLength(22);
    expect(ROLLOUT_TIMELINE_STAGES).toHaveLength(9);
    // 금지 도메인/전략은 허용 목록과 절대 겹치지 않음
    expect(BLOCKED_POLICY_DOMAINS.filter((d) => (POLICY_CHANGE_DOMAINS as readonly string[]).includes(d))).toHaveLength(0);
    expect(BLOCKED_ROLLOUT_STRATEGIES.filter((s) => (ROLLOUT_STRATEGIES as readonly string[]).includes(s))).toHaveLength(0);
  });
});

describe('buildPolicyChangeSpecification', () => {
  it('금지 도메인·미승인 Proposal 거부, 유효 입력은 Specification ≠ Application 명시', () => {
    expect(buildPolicyChangeSpecification({ proposalExists: true, proposalApproved: true, policyDomain: 'payment_policy_mutation', changeType: 'add_rule', title: 't', evidence: ['e'] })).toMatchObject({ rejected: true });
    expect(buildPolicyChangeSpecification({ proposalExists: true, proposalApproved: false, policyDomain: 'timeout_policy', changeType: 'modify_timeout', title: 't', evidence: ['e'] })).toMatchObject({ rejected: true });
    expect(buildPolicyChangeSpecification({ proposalExists: false, proposalApproved: true, policyDomain: 'timeout_policy', changeType: 'modify_timeout', title: 't', evidence: ['e'] })).toMatchObject({ rejected: true });
    const ok = buildPolicyChangeSpecification({ proposalExists: true, proposalApproved: true, policyDomain: 'timeout_policy', changeType: 'modify_timeout', title: 't', evidence: [] });
    expect(ok).toMatchObject({ status: 'pending_evidence', specificationIsNotApplication: true, autoApplied: false });
  });
});

describe('calculatePolicyDelta', () => {
  it('added/removed/changed 분리, snapshot 결측 시 unknown 유지(Delta ≠ Impact)', () => {
    const d = calculatePolicyDelta({ a: 1, b: 2, c: 3 }, { b: 9, c: 3, d: 4 });
    expect(d).toMatchObject({ addedKeys: ['d'], removedKeys: ['a'], changedKeys: ['b'], unchangedKeys: ['c'], currentSnapshotAvailable: true, deltaIsNotImpact: true });
    expect(calculatePolicyDelta(null, { a: 1 })).toMatchObject({ currentSnapshotAvailable: false, addedKeys: [], deltaIsNotImpact: true });
  });
});

describe('evaluateBaselineReadiness', () => {
  it('승인 선행·부분 캡처는 partial·오래되면 stale(Baseline ≠ 미래 결과)', () => {
    expect(evaluateBaselineReadiness({ specApprovedForSimulation: false, snapshotSources: [], capturedAt: NOW, now: NOW, staleAfterDays: 30 }).result).toBe('specification_approval_missing');
    expect(evaluateBaselineReadiness({ specApprovedForSimulation: true, snapshotSources: [{ name: 's1', captured: true }, { name: 's2', captured: false }], capturedAt: NOW, now: NOW, staleAfterDays: 30 })).toMatchObject({ result: 'baseline_partial', missingSources: ['s2'] });
    expect(evaluateBaselineReadiness({ specApprovedForSimulation: true, snapshotSources: [{ name: 's1', captured: true }], capturedAt: new Date('2026-05-01T00:00:00Z'), now: NOW, staleAfterDays: 30 }).result).toBe('baseline_stale_candidate');
    const r = evaluateBaselineReadiness({ specApprovedForSimulation: true, snapshotSources: [{ name: 's1', captured: true }], capturedAt: NOW, now: NOW, staleAfterDays: 30 });
    expect(r).toMatchObject({ result: 'baseline_ready_reference', baselineIsNotFutureResult: true, snapshotIsNotLiveState: true });
  });
});

describe('evaluateHistoricalReplay', () => {
  it('미실행/표본 부족/편향 미검토 구분(Replay ≠ Future Outcome)', () => {
    expect(evaluateHistoricalReplay({ baselineReady: true, executed: false, historyRows: 100, minSample: 10, failures: 0, selectionBiasReviewed: true, replayedAt: NOW, now: NOW, staleAfterDays: 30 }).result).toBe('replay_not_executed');
    expect(evaluateHistoricalReplay({ baselineReady: true, executed: true, historyRows: 3, minSample: 10, failures: 0, selectionBiasReviewed: true, replayedAt: NOW, now: NOW, staleAfterDays: 30 }).result).toBe('replay_sample_too_small');
    expect(evaluateHistoricalReplay({ baselineReady: true, executed: true, historyRows: 100, minSample: 10, failures: 0, selectionBiasReviewed: false, replayedAt: NOW, now: NOW, staleAfterDays: 30 }).result).toBe('selection_bias_candidate');
    const r = evaluateHistoricalReplay({ baselineReady: true, executed: true, historyRows: 100, minSample: 10, failures: 0, selectionBiasReviewed: true, replayedAt: NOW, now: NOW, staleAfterDays: 30 });
    expect(r).toMatchObject({ result: 'replay_completed_reference', replayIsNotFutureOutcome: true, replayIsNotReality: true });
  });
});

describe('evaluateCounterfactualSimulation', () => {
  it('모델 없음 명시·외부 요인 미검토는 causality_unverified(Counterfactual ≠ Fact)', () => {
    expect(evaluateCounterfactualSimulation({ replayCompleted: true, executed: true, modelDefined: false, modelValidated: null, scenarios: 10, minScenarios: 3, externalFactorsReviewed: true, contradictions: 0 }).result).toBe('simulation_model_missing');
    expect(evaluateCounterfactualSimulation({ replayCompleted: true, executed: true, modelDefined: true, modelValidated: null, scenarios: 10, minScenarios: 3, externalFactorsReviewed: true, contradictions: 0 }).result).toBe('simulation_model_unverified');
    expect(evaluateCounterfactualSimulation({ replayCompleted: true, executed: true, modelDefined: true, modelValidated: true, scenarios: 10, minScenarios: 3, externalFactorsReviewed: false, contradictions: 0 }).result).toBe('causality_unverified');
    const r = evaluateCounterfactualSimulation({ replayCompleted: true, executed: true, modelDefined: true, modelValidated: true, scenarios: 10, minScenarios: 3, externalFactorsReviewed: true, contradictions: 0 });
    expect(r).toMatchObject({ result: 'counterfactual_completed_reference', simulationIsNotReality: true, counterfactualIsNotFact: true });
  });
});

describe('detectPolicyConflicts', () => {
  it('미점검은 conflict_unverified 유지·No Detected Conflict ≠ No Conflict', () => {
    const r = detectPolicyConflicts([
      { domain: 'constitution', checked: true, conflictDetected: true, conflictType: 'constitution_conflict_candidate' },
      { domain: 'privacy', checked: false, conflictDetected: null, conflictType: null },
      { domain: 'scope', checked: true, conflictDetected: false, conflictType: null },
    ]);
    expect(r.rows.map((x) => x.result)).toEqual(['constitution_conflict_candidate', 'conflict_unverified', 'no_conflict_detected_reference']);
    expect(r).toMatchObject({ detectedCount: 1, unverifiedCount: 1, noDetectedConflictIsNotNoConflict: true, autoResolved: false });
    expect(detectPolicyConflicts(null).rows).toHaveLength(0);
  });
});

describe('evaluateDomainCompatibility', () => {
  it('도메인 whitelist·immutable 접촉은 항상 충돌 후보(Compatibility ≠ Safety)', () => {
    expect(evaluateDomainCompatibility({ domain: 'weird', reviewed: true, rulesEvaluated: 5, incompatibilities: 0, constitutionImmutableTouched: false, warnings: 0, evidence: ['e'] }).result).toBe('domain_invalid');
    expect(evaluateDomainCompatibility({ domain: 'constitution', reviewed: true, rulesEvaluated: 5, incompatibilities: 0, constitutionImmutableTouched: true, warnings: 0, evidence: ['e'] }).result).toBe('constitution_immutable_conflict_candidate');
    expect(evaluateDomainCompatibility({ domain: 'runtime', reviewed: false, rulesEvaluated: 5, incompatibilities: 0, constitutionImmutableTouched: false, warnings: 0, evidence: ['e'] }).result).toBe('compatibility_unverified');
    const r = evaluateDomainCompatibility({ domain: 'connector', reviewed: true, rulesEvaluated: 5, incompatibilities: 0, constitutionImmutableTouched: false, warnings: 2, evidence: ['e'] });
    expect(r).toMatchObject({ result: 'compatible_with_warnings', compatibilityIsNotSafety: true, autoApproved: false });
  });
});

describe('calculateBlastRadius', () => {
  it('cross_enterprise 차단·50 초과 차단(Estimate ≠ Actual Impact)', () => {
    expect(calculateBlastRadius({ targetScopeType: 'store', targetCount: 3, crossEnterprise: true, affectedComponents: [], maxTargets: 50 }).result).toBe('cross_enterprise_blocked');
    expect(calculateBlastRadius({ targetScopeType: 'store', targetCount: 51, crossEnterprise: false, affectedComponents: [], maxTargets: 50 }).result).toBe('target_scope_exceeded');
    expect(calculateBlastRadius({ targetScopeType: 'store', targetCount: 1, crossEnterprise: false, affectedComponents: ['c'], maxTargets: 50 })).toMatchObject({ result: 'single_target_candidate', estimateIsNotActualImpact: true, expansionAutomatic: false });
    expect(calculateBlastRadius({ targetScopeType: 'store', targetCount: 30, crossEnterprise: false, affectedComponents: ['c'], maxTargets: 50 }).result).toBe('broad_scope_candidate');
  });
});

describe('evaluateOperationalFriction', () => {
  it('복합 신호는 combined·피드백 없으면 "마찰 없음" 확정 금지(Friction ≠ UX 사실)', () => {
    expect(evaluateOperationalFriction({ reviewed: false, additionalApprovalSteps: 0, latencyIncreaseCandidate: false, manualWorkloadIncrease: false, automationDisabledCount: 0, frictionReducedCandidate: false, userFeedbackCollected: true }).result).toBe('friction_unverified');
    expect(evaluateOperationalFriction({ reviewed: true, additionalApprovalSteps: 2, latencyIncreaseCandidate: true, manualWorkloadIncrease: false, automationDisabledCount: 0, frictionReducedCandidate: false, userFeedbackCollected: true }).result).toBe('combined_friction_candidate');
    expect(evaluateOperationalFriction({ reviewed: true, additionalApprovalSteps: 0, latencyIncreaseCandidate: false, manualWorkloadIncrease: false, automationDisabledCount: 0, frictionReducedCandidate: false, userFeedbackCollected: false }).result).toBe('friction_feedback_missing');
    expect(evaluateOperationalFriction({ reviewed: true, additionalApprovalSteps: 0, latencyIncreaseCandidate: false, manualWorkloadIncrease: false, automationDisabledCount: 0, frictionReducedCandidate: false, userFeedbackCollected: true })).toMatchObject({ result: 'no_material_friction_candidate', frictionIsNotUxFact: true });
  });
});

describe('evaluateSafetyBenefit', () => {
  it('Evidence 없는 Benefit 주장 차단(Benefit 후보 ≠ 실제 이익)', () => {
    expect(evaluateSafetyBenefit({ reviewed: true, incidentsAddressed: 2, controlGapsAddressed: 0, recurrenceRiskReducedCandidate: false, evidence: [] }).result).toBe('benefit_evidence_missing');
    expect(evaluateSafetyBenefit({ reviewed: true, incidentsAddressed: 2, controlGapsAddressed: 1, recurrenceRiskReducedCandidate: false, evidence: ['e'] }).result).toBe('combined_benefit_candidate');
    expect(evaluateSafetyBenefit({ reviewed: true, incidentsAddressed: 0, controlGapsAddressed: 0, recurrenceRiskReducedCandidate: false, evidence: [] })).toMatchObject({ result: 'no_measured_benefit_candidate', benefitCandidateIsNotActualBenefit: true });
  });
});

describe('evaluateValidationPlan', () => {
  it('production 차단·Sandbox Pass ≠ Production Safety', () => {
    expect(evaluateValidationPlan({ environment: 'production', steps: ['s'], successCriteria: ['c'], evidenceRequired: true, sandboxPassed: null, previewDeployed: null }).result).toBe('production_environment_blocked');
    expect(evaluateValidationPlan({ environment: 'sandbox', steps: [], successCriteria: ['c'], evidenceRequired: true, sandboxPassed: null, previewDeployed: null }).result).toBe('steps_missing');
    const r = evaluateValidationPlan({ environment: 'sandbox', steps: ['s'], successCriteria: ['c'], evidenceRequired: true, sandboxPassed: true, previewDeployed: null });
    expect(r).toMatchObject({ result: 'sandbox_pass_reference', sandboxPassIsNotProductionSafety: true, planIsNotValidationSuccess: true });
    expect(evaluateValidationPlan({ environment: 'non_production', steps: ['s'], successCriteria: ['c'], evidenceRequired: true, sandboxPassed: null, previewDeployed: null }).result).toBe('validation_plan_ready_reference');
  });
});

describe('buildControlledRolloutPlan', () => {
  it('금지 전략 5종·production 환경·stop/rollback 결측 거부(Plan ≠ Execution)', () => {
    const base = { specificationExists: true, simulationExists: true, strategy: 'store_limited_reference', environmentScope: 'non_production', targetScopeType: 'store', targetScopeIds: ['s1'], stopConditions: ['stop'], rollbackConditions: ['rb'], observationWindows: ['7d'], reviewers: ['r1'] };
    expect(buildControlledRolloutPlan({ ...base, strategy: 'production_global' })).toMatchObject({ rejected: true });
    expect(buildControlledRolloutPlan({ ...base, strategy: 'automatic_expansion' })).toMatchObject({ rejected: true });
    expect(buildControlledRolloutPlan({ ...base, environmentScope: 'production' })).toMatchObject({ rejected: true });
    expect(buildControlledRolloutPlan({ ...base, stopConditions: [] })).toMatchObject({ rejected: true });
    expect(buildControlledRolloutPlan({ ...base, rollbackConditions: [] })).toMatchObject({ rejected: true });
    expect(buildControlledRolloutPlan({ ...base, targetScopeIds: Array.from({ length: 51 }, (_, k) => `s${k}`) })).toMatchObject({ rejected: true });
    expect(buildControlledRolloutPlan(base)).toMatchObject({ status: 'draft', planIsNotExecution: true, autoRollout: false, autoExpansion: false, autoRollback: false });
  });
});

describe('evaluateRolloutGate', () => {
  it('승인·simulation completed·통제 조건 전부 충족해야 ready(Gate Ready ≠ Applied)', () => {
    const bad = evaluateRolloutGate({ rolloutStatus: 'draft', humanApprovalEvidence: [], specificationStatus: null, simulationStatus: 'draft', stopConditions: 0, rollbackConditions: 0, observationWindows: 0, reviewers: 0, validationEvidenceRecorded: false, unexpectedEffectOpen: true });
    expect(bad.ready).toBe(false);
    expect(bad.blockers).toContain('approval_missing');
    expect(bad.blockers).toContain('simulation_not_completed');
    expect(bad.blockers).toContain('unexpected_effect_open');
    const ok = evaluateRolloutGate({ rolloutStatus: 'approved_reference', humanApprovalEvidence: ['e'], specificationStatus: 'approved_for_simulation_reference', simulationStatus: 'completed_reference', stopConditions: 1, rollbackConditions: 1, observationWindows: 1, reviewers: 1, validationEvidenceRecorded: true, unexpectedEffectOpen: false });
    expect(ok).toMatchObject({ ready: true, blockers: [], gateReadyIsNotApplied: true, approvalIsHumanOnly: true, autoApproved: false });
  });
});

describe('evaluateRolloutApplication', () => {
  it('Reference ≠ Applied Success — 검증 Evidence 없으면 unverified 유지', () => {
    expect(evaluateRolloutApplication({ gateReady: false, referenceRecorded: false, referenceUrl: null, verificationEvidence: [], rollbackReviewRequested: false }).status).toBe('gate_not_ready');
    expect(evaluateRolloutApplication({ gateReady: true, referenceRecorded: true, referenceUrl: 'https://x', verificationEvidence: [], rollbackReviewRequested: false }).status).toBe('application_unverified');
    expect(evaluateRolloutApplication({ gateReady: true, referenceRecorded: true, referenceUrl: 'https://x', verificationEvidence: ['e'], rollbackReviewRequested: true }).status).toBe('rollback_review_requested');
    const r = evaluateRolloutApplication({ gateReady: true, referenceRecorded: true, referenceUrl: 'https://x', verificationEvidence: ['e'], rollbackReviewRequested: false });
    expect(r).toMatchObject({ status: 'verified_reference', applicationReferenceIsNotAppliedSuccess: true, appliedByThisSystem: false });
  });
});

describe('evaluatePostRolloutObservation', () => {
  it('표본 부족/stale/외부 요인 미배제 구분(Observation ≠ Causality)', () => {
    const base = { applicationRecorded: true, observationStarted: true, baseline: 10, observed: 15, sampleSize: 100, minSample: 10, observedAt: NOW, now: NOW, staleAfterDays: 30, unexpectedEffects: 0, externalFactorsRuledOut: true };
    expect(evaluatePostRolloutObservation({ ...base, applicationRecorded: false }).result).toBe('application_missing');
    expect(evaluatePostRolloutObservation({ ...base, unexpectedEffects: 2 }).result).toBe('unexpected_effect_review_required');
    expect(evaluatePostRolloutObservation({ ...base, sampleSize: 3 }).result).toBe('sample_too_small');
    expect(evaluatePostRolloutObservation({ ...base, observedAt: new Date('2026-05-01T00:00:00Z') }).result).toBe('stale_input_candidate');
    expect(evaluatePostRolloutObservation({ ...base, externalFactorsRuledOut: false }).result).toBe('causality_unverified');
    expect(evaluatePostRolloutObservation(base)).toMatchObject({ result: 'expected_effect_candidate', applicationIsNotEffectiveness: true, observationIsNotCausality: true });
    expect(evaluatePostRolloutObservation({ ...base, observed: 5 }).result).toBe('adverse_effect_candidate');
  });
});

describe('buildPolicyRolloutRecommendation', () => {
  it('Evidence 없는 추천 금지·type whitelist·confidence clamp', () => {
    expect(buildPolicyRolloutRecommendation({ type: 'apply_policy_now', reason: 'r', evidence: ['e'], confidence: 50 })).toMatchObject({ rejected: true });
    expect(buildPolicyRolloutRecommendation({ type: 'review_rollout_gate', reason: 'r', evidence: [], confidence: 50 })).toMatchObject({ rejected: true });
    const r = buildPolicyRolloutRecommendation({ type: 'review_rollout_gate', reason: 'r', evidence: ['e'], confidence: 150 });
    expect(r).toMatchObject({ confidence: 100, isRecommendationOnly: true, requiresHumanApproval: true, autoExecuted: false });
  });
});

describe('buildPolicyRolloutTimeline', () => {
  it('9단계 whitelist·음수/비수치 카운트는 insufficient_data 유지', () => {
    const r = buildPolicyRolloutTimeline([
      { stage: 'specification', count: 3, source: 'ai_policy_change_specifications' },
      { stage: 'approval', count: null, source: 'ai_policy_rollout_plans' },
      { stage: 'weird', count: 1, source: 'x' },
    ]);
    expect(r.stages).toHaveLength(2);
    expect(r.stages[0]).toMatchObject({ status: 'measured', count: 3 });
    expect(r.stages[1]).toMatchObject({ status: 'insufficient_data', count: null });
    expect(r).toMatchObject({ invalidStages: 1, timelineIsNotCompletionClaim: true });
  });
});

describe('실측 구성요소·지원 매트릭스', () => {
  it('counterfactual model/feature flag/canary/policy apply engine 부재 명시·automatic_* 13종 unsupported', () => {
    const byKey = Object.fromEntries(SIMULATION_COMPONENTS.map((c) => [c.key, c.available]));
    expect(byKey['policy_versions_0512']).toBe(true);
    expect(byKey['vercel_preview']).toBe(true);
    expect(byKey['counterfactual_model']).toBe(false);
    expect(byKey['feature_flag_engine']).toBe(false);
    expect(byKey['canary_staging']).toBe(false);
    expect(byKey['policy_apply_engine']).toBe(false);
    expect(POLICY_ROLLOUT_SUPPORT).toHaveLength(41);
    const auto = POLICY_ROLLOUT_SUPPORT.filter((s) => s.key.startsWith('automatic_'));
    expect(auto).toHaveLength(13);
    expect(auto.every((s) => s.status === 'unsupported')).toBe(true);
  });
});
