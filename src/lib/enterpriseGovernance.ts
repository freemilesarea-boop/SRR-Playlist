/**
 * enterpriseGovernance — Enterprise Governance Intelligence, Strategic
 * Decision Governance & Executive Approval 순수 로직 (Phase AI-OPS-47).
 *
 * Enterprise Vision→Enterprise Policy→Strategic Decision Candidate→Decision
 * Context→Decision Evidence→Governance Validation→Policy Compliance→
 * Approval Workflow→Executive Approval→Decision Record→Governance Learning→Audit.
 *
 * 정직성: Decision Candidate ≠ Approved Decision · Review ≠ Approval ·
 * Approval Chain ≠ Final Approval · Policy Match ≠ Policy Compliance ·
 * Compliance Check ≠ Regulatory Approval · Risk Summary ≠ Risk Elimination ·
 * Evidence Link ≠ Proven Fact · Similar Decision ≠ Same Outcome ·
 * Governance Score ≠ Executive Judgment · Null → 0 변환 금지.
 * 전 함수 결정적(Deterministic)·순수(Pure)·Null-safe. 자동 승인/거절 없음.
 */
import { isFiniteNumber, clampScore } from './aiMemory';

/* ── 상수(SQL CHECK 1:1) ────────────────────────────────────────────────── */
export const GOVERNANCE_CATEGORIES = [
  'strategy', 'investment', 'budget', 'operations', 'product', 'security', 'compliance',
  'ai', 'platform', 'infrastructure', 'hr', 'legal', 'partnership', 'incident', 'enterprise', 'custom',
] as const;

export const GOVERNANCE_DECISION_STATUSES = [
  'draft', 'under_review', 'awaiting_approval', 'approved_reference',
  'rejected_reference', 'archived_reference', 'insufficient_data',
] as const;

export const GOVERNANCE_VALIDATION_RESULTS = [
  'fully_validated_candidate', 'mostly_validated_candidate', 'partially_validated_candidate',
  'validation_incomplete', 'insufficient_data',
] as const;
export type GovernanceValidationResult = (typeof GOVERNANCE_VALIDATION_RESULTS)[number];

export const APPROVAL_WORKFLOW_RESULTS = [
  'approval_ready_candidate', 'additional_review_required', 'policy_conflict_detected',
  'evidence_missing', 'insufficient_data',
] as const;
export type ApprovalWorkflowResult = (typeof APPROVAL_WORKFLOW_RESULTS)[number];

export const DECISION_RISK_DIMENSIONS = [
  'strategic_risk', 'financial_risk', 'operational_risk', 'technical_risk',
  'security_risk', 'compliance_risk', 'reputational_risk',
] as const;
export const DECISION_RISK_RESULTS = [
  'low_risk_candidate', 'moderate_risk_candidate', 'elevated_risk_candidate',
  'high_risk_candidate', 'insufficient_data',
] as const;
export type DecisionRiskResult = (typeof DECISION_RISK_RESULTS)[number];

export const POLICY_MAPPING_RESULTS = ['aligned_candidate', 'partial_match_candidate', 'policy_conflict_candidate', 'no_applicable_policy_candidate', 'policy_match_unverified', 'insufficient_data'] as const;
export type PolicyMappingResult = (typeof POLICY_MAPPING_RESULTS)[number];
export const COMPLIANCE_CHECK_RESULTS = ['compliant_candidate', 'partially_compliant_candidate', 'non_compliant_candidate', 'compliance_unverified', 'insufficient_data'] as const;
export const APPROVAL_CHAIN_RESULTS = ['chain_complete_candidate', 'chain_incomplete_candidate', 'approver_missing_candidate', 'chain_unverified', 'insufficient_data'] as const;

export const GOVERNANCE_RECOMMENDATION_TYPES = [
  'create_governance_decision', 'record_decision_context', 'record_decision_evidence',
  'summarize_evidence', 'search_related_decisions', 'review_policy_mapping',
  'review_governance_validation', 'review_compliance_check', 'review_decision_risk',
  'create_approval_workflow', 'review_approval_chain', 'record_decision_timeline',
  'compare_decisions', 'build_executive_brief', 'build_executive_governance_scorecard',
  'request_governance_review', 'request_executive_review', 'request_compliance_review',
  'record_governance_learning_reference', 'gather_more_evidence_candidate', 'insufficient_data',
] as const;

/* §8 Executive Governance Scorecard 포함 필드 */
export const GOVERNANCE_SCORECARD_FIELDS = [
  'decision', 'evidence', 'policy_match', 'validation', 'risk',
  'recommendation', 'review_status', 'executive_review',
] as const;

/* ── Governance Validation(§5 — Validation ≠ Approval) ─────────────────── */
export function evaluateGovernanceValidation(checks: { check: string; passed: boolean | null }[] | null): {
  result: GovernanceValidationResult; passedCount: number; totalChecks: number; unverifiedCount: number; validationIsNotApproval: true;
} {
  const list = Array.isArray(checks) ? checks : [];
  if (!list.length) {
    return { result: 'insufficient_data', passedCount: 0, totalChecks: 0, unverifiedCount: 0, validationIsNotApproval: true };
  }
  const unverifiedCount = list.filter((c) => c.passed == null).length;
  const assessed = list.filter((c) => c.passed != null);
  if (!assessed.length) {
    return { result: 'insufficient_data', passedCount: 0, totalChecks: list.length, unverifiedCount, validationIsNotApproval: true };
  }
  const passedCount = assessed.filter((c) => c.passed === true).length;
  const ratio = passedCount / list.length;   // 미검증 항목은 통과로 치지 않음(Unknown 유지).
  const result: GovernanceValidationResult = ratio >= 1 ? 'fully_validated_candidate'
    : ratio >= 0.8 ? 'mostly_validated_candidate'
    : ratio >= 0.5 ? 'partially_validated_candidate'
    : 'validation_incomplete';
  return { result, passedCount, totalChecks: list.length, unverifiedCount, validationIsNotApproval: true };
}

/* ── Approval Workflow(§6 — Chain ≠ Final Approval) ────────────────────── */
export function evaluateApprovalWorkflow(input: { hasInitiator: boolean; reviewerCount: number | null; approverCount: number | null; hasFinalOwner: boolean; evidenceCount: number | null; policyConflict: boolean | null }): {
  result: ApprovalWorkflowResult; missingRoles: string[]; chainIsNotFinalApproval: true;
} {
  const { hasInitiator, reviewerCount, approverCount, hasFinalOwner, evidenceCount, policyConflict } = input;
  if (reviewerCount == null || approverCount == null || evidenceCount == null || policyConflict == null) {
    return { result: 'insufficient_data', missingRoles: [], chainIsNotFinalApproval: true };
  }
  if (policyConflict) return { result: 'policy_conflict_detected', missingRoles: [], chainIsNotFinalApproval: true };
  if (evidenceCount <= 0) return { result: 'evidence_missing', missingRoles: [], chainIsNotFinalApproval: true };
  const missingRoles: string[] = [];
  if (!hasInitiator) missingRoles.push('initiator');
  if (reviewerCount <= 0) missingRoles.push('reviewer');
  if (approverCount <= 0) missingRoles.push('executive_approver');
  if (!hasFinalOwner) missingRoles.push('final_decision_owner');
  if (missingRoles.length > 0) return { result: 'additional_review_required', missingRoles, chainIsNotFinalApproval: true };
  return { result: 'approval_ready_candidate', missingRoles: [], chainIsNotFinalApproval: true };
}

/* ── Decision Risk(§7 — worst-of 7차원, Risk Summary ≠ Risk Elimination) ─ */
export function evaluateDecisionRisk(dimensions: { dimension: string; score: number | null }[] | null): {
  result: DecisionRiskResult; worstDimension: string | null; worstScore: number | null; assessedDimensions: number; riskSummaryIsNotRiskElimination: true;
} {
  const valid = (Array.isArray(dimensions) ? dimensions : []).filter((d) => (DECISION_RISK_DIMENSIONS as readonly string[]).includes(d.dimension) && isFiniteNumber(d.score));
  if (!valid.length) {
    return { result: 'insufficient_data', worstDimension: null, worstScore: null, assessedDimensions: 0, riskSummaryIsNotRiskElimination: true };
  }
  let worst = valid[0];
  for (const d of valid) { if ((d.score as number) > (worst.score as number)) worst = d; }
  const s = clampScore(worst.score as number);
  const result: DecisionRiskResult = s >= 75 ? 'high_risk_candidate'
    : s >= 50 ? 'elevated_risk_candidate'
    : s >= 25 ? 'moderate_risk_candidate'
    : 'low_risk_candidate';
  return { result, worstDimension: worst.dimension, worstScore: s, assessedDimensions: valid.length, riskSummaryIsNotRiskElimination: true };
}

/* ── Policy Mapping(태그 겹침 — Policy Match ≠ Policy Compliance) ──────── */
export function matchPolicies(decisionTags: string[] | null, policies: { policyId: string; tags: string[]; conflicting?: boolean }[] | null): {
  result: PolicyMappingResult; matchedPolicyIds: string[]; conflictingPolicyIds: string[]; policyMatchIsNotCompliance: true;
} {
  const tags = (Array.isArray(decisionTags) ? decisionTags : []).filter((t) => typeof t === 'string' && t.length > 0);
  const list = Array.isArray(policies) ? policies : [];
  if (!tags.length || !list.length) {
    return { result: 'insufficient_data', matchedPolicyIds: [], conflictingPolicyIds: [], policyMatchIsNotCompliance: true };
  }
  const matched = list.filter((p) => Array.isArray(p.tags) && p.tags.some((t) => tags.includes(t)));
  const conflictingPolicyIds = matched.filter((p) => p.conflicting === true).map((p) => p.policyId);
  if (!matched.length) return { result: 'no_applicable_policy_candidate', matchedPolicyIds: [], conflictingPolicyIds: [], policyMatchIsNotCompliance: true };
  if (conflictingPolicyIds.length > 0) return { result: 'policy_conflict_candidate', matchedPolicyIds: matched.map((p) => p.policyId), conflictingPolicyIds, policyMatchIsNotCompliance: true };
  const fullMatch = matched.some((p) => tags.every((t) => p.tags.includes(t)));
  return { result: fullMatch ? 'aligned_candidate' : 'partial_match_candidate', matchedPolicyIds: matched.map((p) => p.policyId), conflictingPolicyIds: [], policyMatchIsNotCompliance: true };
}

/* ── Related Decision 검색(Jaccard — Similar Decision ≠ Same Outcome) ──── */
export function findSimilarDecisions(currentTags: string[] | null, pastDecisions: { decisionCode: string; tags: string[]; outcomeReference: string | null }[] | null, minSimilarity = 0.5): {
  similar: { decisionCode: string; similarity: number; outcomeReference: string | null }[]; similarDecisionIsNotSameOutcome: true; insufficientData: boolean;
} {
  const tags = (Array.isArray(currentTags) ? currentTags : []).filter((t) => typeof t === 'string' && t.length > 0);
  const past = Array.isArray(pastDecisions) ? pastDecisions : [];
  if (!tags.length || !past.length) {
    return { similar: [], similarDecisionIsNotSameOutcome: true, insufficientData: true };
  }
  const similar = past
    .map((d) => {
      const dTags = Array.isArray(d.tags) ? d.tags : [];
      const intersection = dTags.filter((t) => tags.includes(t)).length;
      const union = new Set([...tags, ...dTags]).size;
      const similarity = union > 0 ? Math.round((intersection / union) * 1000) / 1000 : 0;
      return { decisionCode: d.decisionCode, similarity, outcomeReference: d.outcomeReference };
    })
    .filter((d) => d.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity || a.decisionCode.localeCompare(b.decisionCode));
  return { similar, similarDecisionIsNotSameOutcome: true, insufficientData: false };
}

/* ── Approval Chain 구성(§6 — 관측 표시, Chain ≠ Final Approval) ───────── */
export const APPROVAL_CHAIN_ROLES = ['initiator', 'reviewer', 'executive_approver', 'final_decision_owner'] as const;
export function buildApprovalChain(input: { present: Partial<Record<(typeof APPROVAL_CHAIN_ROLES)[number], boolean>> }): {
  chain: { role: (typeof APPROVAL_CHAIN_ROLES)[number]; present: boolean }[]; complete: boolean; chainIsNotFinalApproval: true;
} {
  const chain = APPROVAL_CHAIN_ROLES.map((role) => ({ role, present: input.present[role] === true }));
  return { chain, complete: chain.every((c) => c.present), chainIsNotFinalApproval: true };
}

/* ── Executive Governance Scorecard(§8 — 고위험/미검증 우선 결정적 정렬) ─ */
export interface GovernanceScorecardEntryInput {
  decisionCode: string; category: string; evidenceCount: number | null;
  policyMatch: PolicyMappingResult; validation: GovernanceValidationResult;
  risk: DecisionRiskResult; recommendation: string | null; reviewStatus: string; executiveReviewPresent: boolean;
}
export function buildExecutiveGovernanceScorecard(entries: GovernanceScorecardEntryInput[] | null, topN = 5): {
  priorityRows: GovernanceScorecardEntryInput[]; fields: readonly string[]; governanceScoreIsNotExecutiveJudgment: true; orderingIsDeterministic: true;
} {
  const severity = (e: GovernanceScorecardEntryInput): number => {
    const r = e.risk === 'high_risk_candidate' ? 3 : e.risk === 'elevated_risk_candidate' ? 2 : 0;
    const v = e.validation === 'validation_incomplete' ? 2 : e.validation === 'partially_validated_candidate' ? 1 : 0;
    const p = e.policyMatch === 'policy_conflict_candidate' ? 3 : 0;
    const ev = !isFiniteNumber(e.evidenceCount) || e.evidenceCount <= 0 ? 1 : 0;
    return r * 10 + p * 5 + v * 2 + ev;
  };
  const sorted = (Array.isArray(entries) ? [...entries] : [])
    .sort((a, b) => severity(b) - severity(a) || a.decisionCode.localeCompare(b.decisionCode));
  return { priorityRows: sorted.slice(0, Math.max(0, topN)), fields: GOVERNANCE_SCORECARD_FIELDS, governanceScoreIsNotExecutiveJudgment: true, orderingIsDeterministic: true };
}

/* ── Governance Review 검증(Self 차단·Evidence 필수) ───────────────────── */
export function validateGovernanceReview(input: { action: string; evidenceCount: number | null; isSelfReview: boolean }): {
  allowed: boolean; blockedReasons: string[]; humanApprovalRequired: true;
} {
  const blockedReasons: string[] = [];
  if (input.action === 'record_review_reference' || input.action === 'record_approval_reference') {
    if (input.isSelfReview) blockedReasons.push('Self-Approval 차단(작성자 ≠ 승인자)');
    if (!isFiniteNumber(input.evidenceCount) || input.evidenceCount <= 0) blockedReasons.push('Evidence 없는 Review/Approval Reference 금지');
  }
  return { allowed: blockedReasons.length === 0, blockedReasons, humanApprovalRequired: true };
}

/* ── Governance 흐름 타임라인(관측 여부 표시 — 자동 진행 아님) ─────────── */
export const GOVERNANCE_FLOW_STAGES = [
  'enterprise_policy', 'strategic_decision_candidate', 'decision_context', 'decision_evidence',
  'governance_validation', 'policy_compliance', 'approval_workflow', 'executive_approval',
  'decision_record', 'governance_learning',
] as const;
export function buildGovernanceTimeline(input: { present: Partial<Record<(typeof GOVERNANCE_FLOW_STAGES)[number], boolean>> }): {
  stage: (typeof GOVERNANCE_FLOW_STAGES)[number]; present: boolean;
}[] {
  return GOVERNANCE_FLOW_STAGES.map((stage) => ({ stage, present: input.present[stage] === true }));
}

/* ── 컴포넌트/Support Matrix(분류 6종 — §1) ────────────────────────────── */
export const ENTERPRISE_GOVERNANCE_COMPONENTS = [
  'governance_decision_registry', 'approval_workflow_registry', 'decision_evidence_ledger',
  'policy_mapping_analysis', 'governance_validation', 'compliance_check',
  'decision_risk_analysis', 'executive_governance_scorecard', 'governance_review_workflow',
  'governance_event_audit',
] as const;

export type GovernanceSupportLevel = 'fully_supported' | 'partially_supported' | 'advisory_only' | 'human_review_only' | 'unavailable' | 'insufficient_data';
export const ENTERPRISE_GOVERNANCE_SUPPORT_MATRIX: { capability: string; support: GovernanceSupportLevel }[] = [
  { capability: 'governance_decision_structuring', support: 'fully_supported' },
  { capability: 'governance_category_16_domains', support: 'fully_supported' },
  { capability: 'decision_context_recording', support: 'fully_supported' },
  { capability: 'decision_evidence_recording', support: 'fully_supported' },
  { capability: 'evidence_summary_candidate', support: 'advisory_only' },
  { capability: 'related_decision_search_jaccard', support: 'fully_supported' },
  { capability: 'policy_mapping_0512', support: 'partially_supported' },
  { capability: 'governance_validation_candidate', support: 'fully_supported' },
  { capability: 'compliance_check_candidate', support: 'advisory_only' },
  { capability: 'decision_risk_7_dimensions', support: 'fully_supported' },
  { capability: 'approval_workflow_structuring', support: 'fully_supported' },
  { capability: 'approval_chain_completeness_candidate', support: 'fully_supported' },
  { capability: 'decision_timeline_candidate', support: 'advisory_only' },
  { capability: 'decision_comparison_candidate', support: 'advisory_only' },
  { capability: 'executive_brief_candidate', support: 'advisory_only' },
  { capability: 'executive_governance_scorecard_candidate', support: 'advisory_only' },
  { capability: 'governance_recommendation_with_evidence', support: 'advisory_only' },
  { capability: 'governance_review_request', support: 'human_review_only' },
  { capability: 'executive_review_request', support: 'human_review_only' },
  { capability: 'compliance_review_request', support: 'human_review_only' },
  { capability: 'governance_review_reference_no_self_review', support: 'human_review_only' },
  { capability: 'executive_approval_reference_human_only', support: 'human_review_only' },
  { capability: 'decision_record_human_only', support: 'human_review_only' },
  { capability: 'policy_reference_link_0512', support: 'partially_supported' },
  { capability: 'portfolio_reference_link_0550', support: 'partially_supported' },
  { capability: 'program_reference_link_0547', support: 'partially_supported' },
  { capability: 'value_reference_link_0549', support: 'partially_supported' },
  { capability: 'decision_outcome_link_0514', support: 'partially_supported' },
  { capability: 'governance_learning_reference', support: 'partially_supported' },
  { capability: 'governance_event_audit_trail', support: 'fully_supported' },
  { capability: 'ai_policy_rules_table', support: 'insufficient_data' },
  { capability: 'legal_review_system_feed', support: 'insufficient_data' },
  { capability: 'regulatory_filing_feed', support: 'insufficient_data' },
  { capability: 'board_meeting_system_feed', support: 'insufficient_data' },
  { capability: 'contract_management_system_feed', support: 'insufficient_data' },
  { capability: 'external_audit_feed', support: 'insufficient_data' },
  { capability: 'automatic_decision_approval', support: 'unavailable' },
  { capability: 'automatic_decision_rejection', support: 'unavailable' },
  { capability: 'automatic_policy_change', support: 'unavailable' },
  { capability: 'automatic_governance_change', support: 'unavailable' },
  { capability: 'automatic_budget_approval', support: 'unavailable' },
  { capability: 'automatic_capital_allocation', support: 'unavailable' },
  { capability: 'automatic_strategy_change', support: 'unavailable' },
  { capability: 'automatic_contract_approval', support: 'unavailable' },
  { capability: 'automatic_payment_approval', support: 'unavailable' },
  { capability: 'automatic_merge', support: 'unavailable' },
  { capability: 'automatic_deploy', support: 'unavailable' },
  { capability: 'automatic_rollback', support: 'unavailable' },
  { capability: 'automatic_production_change', support: 'unavailable' },
];
