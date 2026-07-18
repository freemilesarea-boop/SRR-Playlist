import { describe, expect, it } from 'vitest';
import {
  GOVERNANCE_CATEGORIES, GOVERNANCE_DECISION_STATUSES, GOVERNANCE_VALIDATION_RESULTS,
  APPROVAL_WORKFLOW_RESULTS, DECISION_RISK_DIMENSIONS, DECISION_RISK_RESULTS,
  POLICY_MAPPING_RESULTS, GOVERNANCE_RECOMMENDATION_TYPES, GOVERNANCE_SCORECARD_FIELDS,
  APPROVAL_CHAIN_ROLES, GOVERNANCE_FLOW_STAGES,
  evaluateGovernanceValidation, evaluateApprovalWorkflow, evaluateDecisionRisk,
  matchPolicies, findSimilarDecisions, buildApprovalChain, buildExecutiveGovernanceScorecard,
  validateGovernanceReview, buildGovernanceTimeline,
  ENTERPRISE_GOVERNANCE_COMPONENTS, ENTERPRISE_GOVERNANCE_SUPPORT_MATRIX,
  type GovernanceScorecardEntryInput,
} from './enterpriseGovernance';

describe('enterpriseGovernance 상수(SQL CHECK 1:1)', () => {
  it('핵심 whitelist 길이가 마이그레이션과 일치한다', () => {
    expect(GOVERNANCE_CATEGORIES).toHaveLength(16);
    expect(GOVERNANCE_DECISION_STATUSES).toHaveLength(7);
    expect(GOVERNANCE_VALIDATION_RESULTS).toHaveLength(5);
    expect(APPROVAL_WORKFLOW_RESULTS).toHaveLength(5);
    expect(DECISION_RISK_DIMENSIONS).toHaveLength(7);
    expect(DECISION_RISK_RESULTS).toHaveLength(5);
    expect(POLICY_MAPPING_RESULTS).toHaveLength(6);
    expect(GOVERNANCE_RECOMMENDATION_TYPES).toHaveLength(21);
    expect(GOVERNANCE_SCORECARD_FIELDS).toHaveLength(8);
    expect(APPROVAL_CHAIN_ROLES).toHaveLength(4);
  });
  it('상태/결과 whitelist 는 insufficient_data 를 포함한다(Unknown 유지)', () => {
    for (const list of [GOVERNANCE_DECISION_STATUSES, GOVERNANCE_VALIDATION_RESULTS, APPROVAL_WORKFLOW_RESULTS, DECISION_RISK_RESULTS, POLICY_MAPPING_RESULTS]) {
      expect(list).toContain('insufficient_data');
    }
  });
});

describe('evaluateGovernanceValidation — Governance Validation(§5)', () => {
  const CHECKS = (passed: (boolean | null)[]) => passed.map((p, i) => ({ check: `c${i}`, passed: p }));
  it('통과 비율로 4단계 판정하되 Validation ≠ Approval', () => {
    expect(evaluateGovernanceValidation(CHECKS([true, true, true, true])).result).toBe('fully_validated_candidate');
    expect(evaluateGovernanceValidation(CHECKS([true, true, true, true, false])).result).toBe('mostly_validated_candidate');
    expect(evaluateGovernanceValidation(CHECKS([true, true, false, false])).result).toBe('partially_validated_candidate');
    const r = evaluateGovernanceValidation(CHECKS([true, false, false, false]));
    expect(r.result).toBe('validation_incomplete');
    expect(r.validationIsNotApproval).toBe(true);
  });
  it('미검증(null) 항목은 통과로 치지 않는다(Unknown 유지)', () => {
    const r = evaluateGovernanceValidation(CHECKS([true, true, null, null]));
    expect(r.result).toBe('partially_validated_candidate');
    expect(r.unverifiedCount).toBe(2);
  });
  it('빈/전부 null 은 insufficient_data', () => {
    expect(evaluateGovernanceValidation([]).result).toBe('insufficient_data');
    expect(evaluateGovernanceValidation(CHECKS([null, null])).result).toBe('insufficient_data');
    expect(evaluateGovernanceValidation(null).result).toBe('insufficient_data');
  });
});

describe('evaluateApprovalWorkflow — Approval Workflow(§6)', () => {
  const BASE = { hasInitiator: true, reviewerCount: 2, approverCount: 1, hasFinalOwner: true, evidenceCount: 3, policyConflict: false };
  it('체인 완비·Evidence 보유·충돌 없음이면 approval_ready — Chain ≠ Final Approval', () => {
    const r = evaluateApprovalWorkflow(BASE);
    expect(r.result).toBe('approval_ready_candidate');
    expect(r.chainIsNotFinalApproval).toBe(true);
  });
  it('Policy 충돌/Evidence 부재/역할 누락을 우선순위대로 판정한다', () => {
    expect(evaluateApprovalWorkflow({ ...BASE, policyConflict: true }).result).toBe('policy_conflict_detected');
    expect(evaluateApprovalWorkflow({ ...BASE, evidenceCount: 0 }).result).toBe('evidence_missing');
    const missing = evaluateApprovalWorkflow({ ...BASE, approverCount: 0, hasFinalOwner: false });
    expect(missing.result).toBe('additional_review_required');
    expect(missing.missingRoles).toEqual(['executive_approver', 'final_decision_owner']);
  });
  it('null 입력은 insufficient_data — Null→0 치환 금지', () => {
    expect(evaluateApprovalWorkflow({ ...BASE, reviewerCount: null }).result).toBe('insufficient_data');
    expect(evaluateApprovalWorkflow({ ...BASE, policyConflict: null }).result).toBe('insufficient_data');
  });
});

describe('evaluateDecisionRisk — Decision Risk(§7)', () => {
  it('worst-of 7차원으로 판정하되 Risk Summary ≠ Risk Elimination', () => {
    const r = evaluateDecisionRisk([
      { dimension: 'strategic_risk', score: 20 },
      { dimension: 'financial_risk', score: 80 },
      { dimension: 'security_risk', score: 40 },
    ]);
    expect(r.result).toBe('high_risk_candidate');
    expect(r.worstDimension).toBe('financial_risk');
    expect(r.riskSummaryIsNotRiskElimination).toBe(true);
    expect(evaluateDecisionRisk([{ dimension: 'operational_risk', score: 55 }]).result).toBe('elevated_risk_candidate');
    expect(evaluateDecisionRisk([{ dimension: 'technical_risk', score: 30 }]).result).toBe('moderate_risk_candidate');
    expect(evaluateDecisionRisk([{ dimension: 'reputational_risk', score: 10 }]).result).toBe('low_risk_candidate');
  });
  it('허용 밖 dimension/null 은 insufficient_data', () => {
    expect(evaluateDecisionRisk([{ dimension: 'made_up', score: 90 }]).result).toBe('insufficient_data');
    expect(evaluateDecisionRisk([{ dimension: 'strategic_risk', score: null }]).worstScore).toBeNull();
    expect(evaluateDecisionRisk(null).result).toBe('insufficient_data');
  });
});

describe('matchPolicies — Policy Matching(§12)', () => {
  const POLICIES = [
    { policyId: 'P1', tags: ['budget', 'investment'] },
    { policyId: 'P2', tags: ['security'] },
    { policyId: 'P3', tags: ['budget'], conflicting: true },
  ];
  it('태그 겹침으로 매핑하되 Policy Match ≠ Policy Compliance', () => {
    const r = matchPolicies(['budget', 'investment'], [POLICIES[0], POLICIES[1]]);
    expect(r.result).toBe('aligned_candidate');
    expect(r.matchedPolicyIds).toEqual(['P1']);
    expect(r.policyMatchIsNotCompliance).toBe(true);
  });
  it('충돌 정책이 매핑되면 policy_conflict_candidate', () => {
    const r = matchPolicies(['budget'], POLICIES);
    expect(r.result).toBe('policy_conflict_candidate');
    expect(r.conflictingPolicyIds).toEqual(['P3']);
  });
  it('적용 정책 없음/입력 부재를 구분한다', () => {
    expect(matchPolicies(['hr'], POLICIES).result).toBe('no_applicable_policy_candidate');
    expect(matchPolicies([], POLICIES).result).toBe('insufficient_data');
    expect(matchPolicies(['budget'], []).result).toBe('insufficient_data');
  });
});

describe('findSimilarDecisions — Related Decision(Jaccard)', () => {
  const PAST = [
    { decisionCode: 'D1', tags: ['budget', 'investment'], outcomeReference: 'positive_reference' },
    { decisionCode: 'D2', tags: ['security'], outcomeReference: null },
  ];
  it('유사 Decision 을 찾되 Similar Decision ≠ Same Outcome', () => {
    const r = findSimilarDecisions(['budget', 'investment'], PAST);
    expect(r.similar).toHaveLength(1);
    expect(r.similar[0].decisionCode).toBe('D1');
    expect(r.similar[0].similarity).toBe(1);
    expect(r.similarDecisionIsNotSameOutcome).toBe(true);
  });
  it('빈 입력은 insufficientData', () => {
    expect(findSimilarDecisions([], PAST).insufficientData).toBe(true);
    expect(findSimilarDecisions(['budget'], []).insufficientData).toBe(true);
  });
});

describe('buildApprovalChain — Approval Chain(§6)', () => {
  it('역할 4종 체인을 구성하고 완전성만 표시한다 — Final Approval 아님', () => {
    const r = buildApprovalChain({ present: { initiator: true, reviewer: true, executive_approver: true, final_decision_owner: true } });
    expect(r.complete).toBe(true);
    expect(r.chainIsNotFinalApproval).toBe(true);
    expect(buildApprovalChain({ present: { initiator: true } }).complete).toBe(false);
  });
});

const ENTRY = (over: Partial<GovernanceScorecardEntryInput>): GovernanceScorecardEntryInput => ({
  decisionCode: 'D1', category: 'strategy', evidenceCount: 3,
  policyMatch: 'aligned_candidate', validation: 'mostly_validated_candidate',
  risk: 'moderate_risk_candidate', recommendation: 'review_decision_risk',
  reviewStatus: 'under_review', executiveReviewPresent: false,
  ...over,
});

describe('buildExecutiveGovernanceScorecard — Scorecard(§8)', () => {
  it('고위험/Policy 충돌/미검증 우선 결정적 정렬이며 필드 8종 — Executive Judgment 아님', () => {
    const r = buildExecutiveGovernanceScorecard([
      ENTRY({ decisionCode: 'OK' }),
      ENTRY({ decisionCode: 'RISK', risk: 'high_risk_candidate', policyMatch: 'policy_conflict_candidate' }),
      ENTRY({ decisionCode: 'VAL', validation: 'validation_incomplete', evidenceCount: 0 }),
    ], 2);
    expect(r.priorityRows.map((e) => e.decisionCode)).toEqual(['RISK', 'VAL']);
    expect(r.fields).toHaveLength(8);
    expect(r.governanceScoreIsNotExecutiveJudgment).toBe(true);
  });
  it('null 입력은 빈 결과(안전)', () => {
    expect(buildExecutiveGovernanceScorecard(null).priorityRows).toHaveLength(0);
  });
});

describe('validateGovernanceReview — Review Workflow(Honest Boundary)', () => {
  it('Self-Approval 과 Evidence 없는 Review/Approval Reference 를 차단한다', () => {
    const self = validateGovernanceReview({ action: 'record_approval_reference', evidenceCount: 3, isSelfReview: true });
    expect(self.allowed).toBe(false);
    expect(self.blockedReasons.join(' ')).toContain('Self-Approval');
    expect(validateGovernanceReview({ action: 'record_review_reference', evidenceCount: 0, isSelfReview: false }).allowed).toBe(false);
  });
  it('요청 액션은 허용하되 humanApprovalRequired 유지', () => {
    const ok = validateGovernanceReview({ action: 'request_compliance_review', evidenceCount: null, isSelfReview: true });
    expect(ok.allowed).toBe(true);
    expect(ok.humanApprovalRequired).toBe(true);
    expect(validateGovernanceReview({ action: 'record_approval_reference', evidenceCount: 2, isSelfReview: false }).allowed).toBe(true);
  });
});

describe('buildGovernanceTimeline — 흐름 관측', () => {
  it('10 단계 흐름을 순서대로 반환하고 관측 여부만 표시한다', () => {
    const t = buildGovernanceTimeline({ present: { strategic_decision_candidate: true, executive_approval: false } });
    expect(t).toHaveLength(GOVERNANCE_FLOW_STAGES.length);
    expect(t[0].stage).toBe('enterprise_policy');
    expect(t.find((s) => s.stage === 'strategic_decision_candidate')?.present).toBe(true);
    expect(t.find((s) => s.stage === 'executive_approval')?.present).toBe(false);
  });
});

describe('ENTERPRISE_GOVERNANCE_SUPPORT_MATRIX — Honest Boundary', () => {
  it('컴포넌트 10종·매트릭스 49항목', () => {
    expect(ENTERPRISE_GOVERNANCE_COMPONENTS).toHaveLength(10);
    expect(ENTERPRISE_GOVERNANCE_SUPPORT_MATRIX).toHaveLength(49);
  });
  it('unavailable 13항목은 전부 automatic_* — 자동 승인/거절/정책 변경 없음', () => {
    const unavailable = ENTERPRISE_GOVERNANCE_SUPPORT_MATRIX.filter((e) => e.support === 'unavailable');
    expect(unavailable).toHaveLength(13);
    for (const e of unavailable) expect(e.capability.startsWith('automatic_')).toBe(true);
  });
  it('ai_policy_rules 부재와 Legal/Board/감사 피드는 insufficient_data 로 정직하게 표시된다', () => {
    const feeds = ENTERPRISE_GOVERNANCE_SUPPORT_MATRIX.filter((e) => e.support === 'insufficient_data');
    expect(feeds.length).toBeGreaterThanOrEqual(6);
    expect(feeds.map((f) => f.capability)).toContain('ai_policy_rules_table');
    expect(feeds.map((f) => f.capability)).toContain('legal_review_system_feed');
  });
});
