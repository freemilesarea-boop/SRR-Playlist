/**
 * enterpriseOrganization — Enterprise Organizational Intelligence,
 * Organizational Health & Operating Model 순수 로직 (Phase AI-OPS-48).
 *
 * Enterprise Vision→Operating Model→Organization Structure→Role &
 * Responsibility→Decision Flow→Cross-Functional Collaboration→Organizational
 * Health→Operating Maturity→Bottleneck Detection→Capability Gap→Improvement
 * Candidate→Executive Organization Review→Operating Learning→Audit.
 *
 * 정직성: Organization Candidate ≠ Organization Change · Improvement
 * Candidate ≠ Approved Improvement · Capability Gap ≠ Employee Performance ·
 * Organizational Health ≠ HR Evaluation · Operating Maturity ≠ Organizational
 * Success · Bottleneck ≠ Root Cause · Collaboration Score ≠ Team Quality ·
 * Recommendation ≠ Decision · Review ≠ Approval · Null → 0 변환 금지.
 * 전 함수 결정적(Deterministic)·순수(Pure)·Null-safe. 자동 조직 개편/인사 없음.
 */
import { isFiniteNumber, clampScore } from './aiMemory';

/* ── 상수(SQL CHECK 1:1) ────────────────────────────────────────────────── */
export const ORGANIZATION_CATEGORIES = [
  'executive', 'product', 'engineering', 'operations', 'sales', 'marketing', 'finance', 'hr',
  'legal', 'customer_success', 'platform', 'ai', 'security', 'compliance', 'enterprise', 'custom',
] as const;

export const ORGANIZATION_STATUSES = [
  'draft', 'active_reference', 'review_reference', 'archived_reference', 'insufficient_data',
] as const;

export const ORG_HEALTH_RESULTS = [
  'excellent_health_candidate', 'healthy_candidate', 'watch_candidate',
  'unhealthy_candidate', 'insufficient_data',
] as const;
export type OrgHealthResult = (typeof ORG_HEALTH_RESULTS)[number];

export const OPERATING_MATURITY_DIMENSIONS = [
  'process_consistency', 'decision_speed', 'collaboration',
  'ownership_clarity', 'capability_coverage', 'governance_alignment',
] as const;
export const OPERATING_MATURITY_RESULTS = [
  'highly_mature_candidate', 'mature_candidate', 'developing_candidate',
  'immature_candidate', 'insufficient_data',
] as const;
export type OperatingMaturityResult = (typeof OPERATING_MATURITY_RESULTS)[number];

export const CAPABILITY_GAP_DOMAINS = [
  'leadership', 'technical', 'operational', 'business', 'ai', 'security', 'compliance',
] as const;
export const CAPABILITY_GAP_RESULTS = [
  'minimal_gap_candidate', 'manageable_gap_candidate', 'significant_gap_candidate',
  'critical_gap_candidate', 'insufficient_data',
] as const;
export type CapabilityGapResult = (typeof CAPABILITY_GAP_RESULTS)[number];

export const DECISION_FLOW_RESULTS = ['fast_decision_flow_candidate', 'acceptable_decision_flow_candidate', 'slow_decision_flow_candidate', 'blocked_decision_flow_candidate', 'decision_flow_unverified', 'insufficient_data'] as const;
export type DecisionFlowResult = (typeof DECISION_FLOW_RESULTS)[number];
export const COLLABORATION_RESULTS = ['strong_collaboration_candidate', 'adequate_collaboration_candidate', 'delayed_collaboration_candidate', 'siloed_collaboration_candidate', 'collaboration_unverified', 'insufficient_data'] as const;
export type CollaborationResult = (typeof COLLABORATION_RESULTS)[number];
export const BOTTLENECK_RESULTS = ['no_material_bottleneck_candidate', 'role_overload_candidate', 'decision_bottleneck_candidate', 'collaboration_bottleneck_candidate', 'capability_bottleneck_candidate', 'bottleneck_unverified', 'insufficient_data'] as const;
export type BottleneckResult = (typeof BOTTLENECK_RESULTS)[number];
export const WORKLOAD_RESULTS = ['balanced_workload_candidate', 'uneven_workload_candidate', 'overloaded_role_candidate', 'workload_unverified', 'insufficient_data'] as const;
export type WorkloadResult = (typeof WORKLOAD_RESULTS)[number];
export const ORG_DEPENDENCY_RESULTS = ['no_material_dependency_candidate', 'cross_team_dependency_candidate', 'blocking_dependency_candidate', 'dependency_unverified', 'insufficient_data'] as const;
export const SPOF_RESULTS = ['no_material_spof_candidate', 'potential_spof_candidate', 'critical_spof_candidate', 'spof_unverified', 'insufficient_data'] as const;
export type SpofResult = (typeof SPOF_RESULTS)[number];

export const OPERATING_REVIEW_TYPES = ['organization_review', 'executive_review', 'operating_review'] as const;
export const OPERATING_REVIEW_STATUSES = ['requested', 'in_review', 'review_reference_recorded', 'revision_requested', 'insufficient_data'] as const;

export const ORG_RECOMMENDATION_TYPES = [
  'create_organization_model', 'record_team_structure', 'record_role_mapping',
  'record_responsibility_matrix', 'review_decision_flow', 'review_collaboration_network',
  'review_organizational_health', 'review_operating_maturity', 'review_bottleneck',
  'review_capability_gap', 'review_workload_balance', 'review_dependency',
  'review_single_point_of_failure', 'record_organizational_scenario', 'record_improvement_candidate',
  'build_executive_organization_summary', 'build_executive_organization_scorecard',
  'request_organization_review', 'request_executive_review', 'request_operating_review',
  'record_organizational_learning_reference', 'gather_more_evidence_candidate', 'insufficient_data',
] as const;

/* §8 Executive Organization Scorecard 포함 필드 */
export const ORG_SCORECARD_FIELDS = [
  'organization_health', 'operating_maturity', 'capability_gap', 'collaboration',
  'decision_flow', 'bottlenecks', 'recommendation', 'executive_review',
] as const;

/* ── Operating Maturity(§6 — 6차원, Maturity ≠ Organizational Success) ──── */
export function evaluateOperatingMaturity(dimensions: { dimension: string; score: number | null }[] | null): {
  result: OperatingMaturityResult; averageScore: number | null; assessedDimensions: number;
  missingDimensions: string[]; maturityIsNotOrganizationalSuccess: true;
} {
  const list = Array.isArray(dimensions) ? dimensions : [];
  const valid = list.filter((d) => (OPERATING_MATURITY_DIMENSIONS as readonly string[]).includes(d.dimension) && isFiniteNumber(d.score));
  const missingDimensions = OPERATING_MATURITY_DIMENSIONS.filter((dim) => !valid.some((d) => d.dimension === dim));
  // 6차원 중 3차원 미만 평가 → sample_too_small(Null → 0 변환 금지).
  if (valid.length < 3) {
    return { result: 'insufficient_data', averageScore: null, assessedDimensions: valid.length, missingDimensions: [...missingDimensions], maturityIsNotOrganizationalSuccess: true };
  }
  const avg = clampScore(valid.reduce((s, d) => s + (d.score as number), 0) / valid.length);
  const result: OperatingMaturityResult = avg >= 80 ? 'highly_mature_candidate'
    : avg >= 60 ? 'mature_candidate'
    : avg >= 40 ? 'developing_candidate'
    : 'immature_candidate';
  return { result, averageScore: avg, assessedDimensions: valid.length, missingDimensions: [...missingDimensions], maturityIsNotOrganizationalSuccess: true };
}

/* ── Capability Gap(§7 — 7도메인 worst-of, Gap ≠ Employee Performance) ─── */
export function evaluateCapabilityGap(domains: { domain: string; coverageScore: number | null }[] | null): {
  result: CapabilityGapResult; weakestDomain: string | null; weakestCoverage: number | null;
  assessedDomains: number; unassessedDomains: string[]; gapIsNotEmployeePerformance: true;
} {
  const list = Array.isArray(domains) ? domains : [];
  const valid = list.filter((d) => (CAPABILITY_GAP_DOMAINS as readonly string[]).includes(d.domain) && isFiniteNumber(d.coverageScore));
  const unassessedDomains = CAPABILITY_GAP_DOMAINS.filter((dom) => !valid.some((d) => d.domain === dom));
  if (!valid.length) {
    return { result: 'insufficient_data', weakestDomain: null, weakestCoverage: null, assessedDomains: 0, unassessedDomains: [...unassessedDomains], gapIsNotEmployeePerformance: true };
  }
  let weakest = valid[0];
  for (const d of valid) { if ((d.coverageScore as number) < (weakest.coverageScore as number)) weakest = d; }
  const cov = clampScore(weakest.coverageScore as number);
  const result: CapabilityGapResult = cov >= 80 ? 'minimal_gap_candidate'
    : cov >= 60 ? 'manageable_gap_candidate'
    : cov >= 40 ? 'significant_gap_candidate'
    : 'critical_gap_candidate';
  return { result, weakestDomain: weakest.domain, weakestCoverage: cov, assessedDomains: valid.length, unassessedDomains: [...unassessedDomains], gapIsNotEmployeePerformance: true };
}

/* ── Organizational Health(§5 — 구성요소 종합, Health ≠ HR Evaluation) ─── */
export function evaluateOrganizationalHealth(input: {
  maturity: OperatingMaturityResult | null; capabilityGap: CapabilityGapResult | null;
  collaboration: CollaborationResult | null; bottleneck: BottleneckResult | null;
}): { result: OrgHealthResult; healthScore: number | null; assessedComponents: number; healthIsNotHrEvaluation: true } {
  const maturityScore: Record<string, number | null> = { highly_mature_candidate: 100, mature_candidate: 75, developing_candidate: 50, immature_candidate: 25, insufficient_data: null };
  const gapScore: Record<string, number | null> = { minimal_gap_candidate: 100, manageable_gap_candidate: 70, significant_gap_candidate: 40, critical_gap_candidate: 10, insufficient_data: null };
  const collabScore: Record<string, number | null> = { strong_collaboration_candidate: 100, adequate_collaboration_candidate: 75, delayed_collaboration_candidate: 45, siloed_collaboration_candidate: 15, collaboration_unverified: null, insufficient_data: null };
  const bottleneckScore: Record<string, number | null> = { no_material_bottleneck_candidate: 100, role_overload_candidate: 40, decision_bottleneck_candidate: 40, collaboration_bottleneck_candidate: 40, capability_bottleneck_candidate: 40, bottleneck_unverified: null, insufficient_data: null };
  const parts = [
    input.maturity == null ? null : maturityScore[input.maturity] ?? null,
    input.capabilityGap == null ? null : gapScore[input.capabilityGap] ?? null,
    input.collaboration == null ? null : collabScore[input.collaboration] ?? null,
    input.bottleneck == null ? null : bottleneckScore[input.bottleneck] ?? null,
  ].filter((s): s is number => isFiniteNumber(s));
  // 4개 구성요소 중 2개 미만 평가 → insufficient_data(미검증은 점수화하지 않음).
  if (parts.length < 2) {
    return { result: 'insufficient_data', healthScore: null, assessedComponents: parts.length, healthIsNotHrEvaluation: true };
  }
  const score = clampScore(parts.reduce((s, v) => s + v, 0) / parts.length);
  const result: OrgHealthResult = score >= 80 ? 'excellent_health_candidate'
    : score >= 60 ? 'healthy_candidate'
    : score >= 40 ? 'watch_candidate'
    : 'unhealthy_candidate';
  return { result, healthScore: score, assessedComponents: parts.length, healthIsNotHrEvaluation: true };
}

/* ── Collaboration Network(Edge 지연 — Score ≠ Team Quality) ────────────── */
export function analyzeCollaborationNetwork(teams: string[] | null, edges: { from: string; to: string; avgDelayDays: number | null }[] | null): {
  result: CollaborationResult; averageDelayDays: number | null; siloedTeams: string[];
  unverifiedEdges: number; collaborationScoreIsNotTeamQuality: true;
} {
  const teamList = (Array.isArray(teams) ? teams : []).filter((t) => typeof t === 'string' && t.length > 0);
  const edgeList = Array.isArray(edges) ? edges : [];
  if (!teamList.length || !edgeList.length) {
    return { result: 'insufficient_data', averageDelayDays: null, siloedTeams: [...teamList].sort((a, b) => a.localeCompare(b)), unverifiedEdges: 0, collaborationScoreIsNotTeamQuality: true };
  }
  const connected = new Set<string>();
  for (const e of edgeList) { connected.add(e.from); connected.add(e.to); }
  const siloedTeams = teamList.filter((t) => !connected.has(t)).sort((a, b) => a.localeCompare(b));
  const measured = edgeList.filter((e) => isFiniteNumber(e.avgDelayDays));
  const unverifiedEdges = edgeList.length - measured.length;
  if (siloedTeams.length > 0) {
    return { result: 'siloed_collaboration_candidate', averageDelayDays: null, siloedTeams, unverifiedEdges, collaborationScoreIsNotTeamQuality: true };
  }
  // 과반 Edge 지연 미계측 → 미검증 유지(Null → 0 금지).
  if (measured.length * 2 < edgeList.length) {
    return { result: 'collaboration_unverified', averageDelayDays: null, siloedTeams: [], unverifiedEdges, collaborationScoreIsNotTeamQuality: true };
  }
  const avg = Math.round((measured.reduce((s, e) => s + (e.avgDelayDays as number), 0) / measured.length) * 100) / 100;
  const result: CollaborationResult = avg <= 2 ? 'strong_collaboration_candidate'
    : avg <= 5 ? 'adequate_collaboration_candidate'
    : 'delayed_collaboration_candidate';
  return { result, averageDelayDays: avg, siloedTeams: [], unverifiedEdges, collaborationScoreIsNotTeamQuality: true };
}

/* ── Decision Flow(단계 소요일 — Flow Candidate ≠ 자동 프로세스 변경) ──── */
export function evaluateDecisionFlow(stages: { stage: string; avgDays: number | null; blocked?: boolean }[] | null): {
  result: DecisionFlowResult; totalDays: number | null; blockedStages: string[]; unverifiedStages: number; flowCandidateIsNotProcessChange: true;
} {
  const list = Array.isArray(stages) ? stages : [];
  if (!list.length) {
    return { result: 'insufficient_data', totalDays: null, blockedStages: [], unverifiedStages: 0, flowCandidateIsNotProcessChange: true };
  }
  const blockedStages = list.filter((s) => s.blocked === true).map((s) => s.stage).sort((a, b) => a.localeCompare(b));
  const measured = list.filter((s) => isFiniteNumber(s.avgDays));
  const unverifiedStages = list.length - measured.length;
  if (blockedStages.length > 0) {
    return { result: 'blocked_decision_flow_candidate', totalDays: null, blockedStages, unverifiedStages, flowCandidateIsNotProcessChange: true };
  }
  if (measured.length * 2 < list.length) {
    return { result: 'decision_flow_unverified', totalDays: null, blockedStages: [], unverifiedStages, flowCandidateIsNotProcessChange: true };
  }
  const totalDays = Math.round(measured.reduce((s, v) => s + (v.avgDays as number), 0) * 100) / 100;
  const result: DecisionFlowResult = totalDays <= 3 ? 'fast_decision_flow_candidate'
    : totalDays <= 10 ? 'acceptable_decision_flow_candidate'
    : 'slow_decision_flow_candidate';
  return { result, totalDays, blockedStages: [], unverifiedStages, flowCandidateIsNotProcessChange: true };
}

/* ── Workload/Role Overload(Workload ≠ 개인 평가/재배치 신호) ───────────── */
export function detectRoleOverload(roles: { role: string; assignmentCount: number | null }[] | null, overloadThreshold = 6): {
  result: WorkloadResult; overloadedRoles: string[]; unverifiedRoles: number; workloadIsNotIndividualEvaluation: true;
} {
  const list = Array.isArray(roles) ? roles : [];
  if (!list.length) {
    return { result: 'insufficient_data', overloadedRoles: [], unverifiedRoles: 0, workloadIsNotIndividualEvaluation: true };
  }
  const measured = list.filter((r) => isFiniteNumber(r.assignmentCount));
  const unverifiedRoles = list.length - measured.length;
  if (!measured.length) {
    return { result: 'workload_unverified', overloadedRoles: [], unverifiedRoles, workloadIsNotIndividualEvaluation: true };
  }
  const overloadedRoles = measured.filter((r) => (r.assignmentCount as number) >= overloadThreshold).map((r) => r.role).sort((a, b) => a.localeCompare(b));
  if (overloadedRoles.length > 0) {
    return { result: 'overloaded_role_candidate', overloadedRoles, unverifiedRoles, workloadIsNotIndividualEvaluation: true };
  }
  const counts = measured.map((r) => r.assignmentCount as number);
  const spread = Math.max(...counts) - Math.min(...counts);
  return { result: spread >= 3 ? 'uneven_workload_candidate' : 'balanced_workload_candidate', overloadedRoles: [], unverifiedRoles, workloadIsNotIndividualEvaluation: true };
}

/* ── Single Point of Failure(SPOF ≠ 개인 책임 추궁) ────────────────────── */
export function detectSinglePointsOfFailure(areas: { area: string; ownerCount: number | null }[] | null): {
  result: SpofResult; spofAreas: string[]; unassignedAreas: string[]; unverifiedAreas: number; spofIsNotIndividualBlame: true;
} {
  const list = Array.isArray(areas) ? areas : [];
  if (!list.length) {
    return { result: 'insufficient_data', spofAreas: [], unassignedAreas: [], unverifiedAreas: 0, spofIsNotIndividualBlame: true };
  }
  const measured = list.filter((a) => isFiniteNumber(a.ownerCount));
  const unverifiedAreas = list.length - measured.length;
  if (!measured.length) {
    return { result: 'spof_unverified', spofAreas: [], unassignedAreas: [], unverifiedAreas, spofIsNotIndividualBlame: true };
  }
  const spofAreas = measured.filter((a) => a.ownerCount === 1).map((a) => a.area).sort((a, b) => a.localeCompare(b));
  const unassignedAreas = measured.filter((a) => a.ownerCount === 0).map((a) => a.area).sort((a, b) => a.localeCompare(b));
  const result: SpofResult = unassignedAreas.length > 0 ? 'critical_spof_candidate'
    : spofAreas.length > 0 ? 'potential_spof_candidate'
    : 'no_material_spof_candidate';
  return { result, spofAreas, unassignedAreas, unverifiedAreas, spofIsNotIndividualBlame: true };
}

/* ── Executive Organization Scorecard(§8 — 결정적 우선순위 정렬) ────────── */
export interface OrgScorecardEntryInput {
  organizationCode: string; category: string; health: OrgHealthResult;
  maturity: OperatingMaturityResult; capabilityGap: CapabilityGapResult;
  collaboration: CollaborationResult | null; bottleneckPresent: boolean;
  recommendation: string | null; executiveReviewPresent: boolean;
}
export function buildExecutiveOrganizationScorecard(entries: OrgScorecardEntryInput[] | null, topN = 5): {
  priorityRows: OrgScorecardEntryInput[]; fields: readonly string[]; scorecardIsNotHrEvaluation: true; orderingIsDeterministic: true;
} {
  const severity = (e: OrgScorecardEntryInput): number => {
    const h = e.health === 'unhealthy_candidate' ? 3 : e.health === 'watch_candidate' ? 2 : 0;
    const g = e.capabilityGap === 'critical_gap_candidate' ? 3 : e.capabilityGap === 'significant_gap_candidate' ? 2 : 0;
    const m = e.maturity === 'immature_candidate' ? 2 : e.maturity === 'developing_candidate' ? 1 : 0;
    const c = e.collaboration === 'siloed_collaboration_candidate' ? 2 : e.collaboration === 'delayed_collaboration_candidate' ? 1 : 0;
    const b = e.bottleneckPresent ? 1 : 0;
    return h * 10 + g * 5 + m * 2 + c * 2 + b;
  };
  const sorted = (Array.isArray(entries) ? [...entries] : [])
    .sort((a, b) => severity(b) - severity(a) || a.organizationCode.localeCompare(b.organizationCode));
  return { priorityRows: sorted.slice(0, Math.max(0, topN)), fields: ORG_SCORECARD_FIELDS, scorecardIsNotHrEvaluation: true, orderingIsDeterministic: true };
}

/* ── Organization Review 검증(§9 — Self-Review 차단·Evidence 필수) ─────── */
export function validateOrganizationReview(input: { action: string; evidenceCount: number | null; isSelfReview: boolean }): {
  allowed: boolean; blockedReasons: string[]; reviewIsNotApproval: true; finalChangeIsHuman: true;
} {
  const blockedReasons: string[] = [];
  if (input.action === 'record_review_reference') {
    if (input.isSelfReview) blockedReasons.push('Self-Review 차단(작성자 ≠ 평가자)');
    if (!isFiniteNumber(input.evidenceCount) || input.evidenceCount <= 0) blockedReasons.push('Evidence 없는 Organization Review Reference 금지');
  }
  return { allowed: blockedReasons.length === 0, blockedReasons, reviewIsNotApproval: true, finalChangeIsHuman: true };
}

/* ── Organization 흐름 타임라인(관측 여부 표시 — 자동 진행 아님) ────────── */
export const ORGANIZATION_FLOW_STAGES = [
  'enterprise_vision', 'operating_model', 'organization_structure', 'role_responsibility',
  'decision_flow', 'cross_functional_collaboration', 'organizational_health', 'operating_maturity',
  'bottleneck_detection', 'capability_gap', 'improvement_candidate', 'executive_organization_review',
  'operating_learning',
] as const;
export function buildOrganizationTimeline(input: { present: Partial<Record<(typeof ORGANIZATION_FLOW_STAGES)[number], boolean>> }): {
  stage: (typeof ORGANIZATION_FLOW_STAGES)[number]; present: boolean;
}[] {
  return ORGANIZATION_FLOW_STAGES.map((stage) => ({ stage, present: input.present[stage] === true }));
}

/* ── 컴포넌트/Support Matrix ────────────────────────────────────────────── */
export const ENTERPRISE_ORGANIZATION_COMPONENTS = [
  'organization_model_registry', 'operating_review_registry', 'role_matrix_analysis',
  'collaboration_network_analysis', 'organizational_health_analysis', 'operating_maturity_analysis',
  'capability_gap_analysis', 'bottleneck_detection', 'executive_organization_scorecard',
  'organization_event_audit',
] as const;

export type OrganizationSupportLevel = 'fully_supported' | 'partially_supported' | 'advisory_only' | 'human_review_only' | 'unavailable' | 'insufficient_data';
export const ENTERPRISE_ORGANIZATION_SUPPORT_MATRIX: { capability: string; support: OrganizationSupportLevel }[] = [
  { capability: 'organization_model_structuring', support: 'fully_supported' },
  { capability: 'organization_category_16_domains', support: 'fully_supported' },
  { capability: 'team_structure_recording', support: 'fully_supported' },
  { capability: 'role_matrix_recording', support: 'fully_supported' },
  { capability: 'responsibility_matrix_recording', support: 'fully_supported' },
  { capability: 'decision_flow_review_candidate', support: 'fully_supported' },
  { capability: 'collaboration_network_review_candidate', support: 'fully_supported' },
  { capability: 'organizational_health_candidate', support: 'fully_supported' },
  { capability: 'operating_maturity_6_dimensions', support: 'fully_supported' },
  { capability: 'capability_gap_7_domains', support: 'fully_supported' },
  { capability: 'bottleneck_review_candidate', support: 'advisory_only' },
  { capability: 'workload_balance_candidate', support: 'advisory_only' },
  { capability: 'dependency_review_candidate', support: 'advisory_only' },
  { capability: 'single_point_of_failure_candidate', support: 'advisory_only' },
  { capability: 'organizational_scenario_candidate', support: 'advisory_only' },
  { capability: 'improvement_candidate_with_evidence', support: 'advisory_only' },
  { capability: 'executive_organization_summary_candidate', support: 'advisory_only' },
  { capability: 'executive_organization_scorecard_candidate', support: 'advisory_only' },
  { capability: 'organization_recommendation_with_evidence', support: 'advisory_only' },
  { capability: 'organization_review_request', support: 'human_review_only' },
  { capability: 'executive_review_request', support: 'human_review_only' },
  { capability: 'operating_review_request', support: 'human_review_only' },
  { capability: 'organization_review_reference_no_self_review', support: 'human_review_only' },
  { capability: 'final_organization_change_human_only', support: 'human_review_only' },
  { capability: 'portfolio_reference_link_0545', support: 'partially_supported' },
  { capability: 'program_reference_link_0547', support: 'partially_supported' },
  { capability: 'governance_reference_link_0551', support: 'partially_supported' },
  { capability: 'resource_reference_link_0546', support: 'partially_supported' },
  { capability: 'organizational_learning_reference_0515', support: 'partially_supported' },
  { capability: 'organization_event_audit_trail', support: 'fully_supported' },
  { capability: 'hr_system_feed', support: 'insufficient_data' },
  { capability: 'org_chart_ledger', support: 'insufficient_data' },
  { capability: 'payroll_system', support: 'insufficient_data' },
  { capability: 'time_tracking_system', support: 'insufficient_data' },
  { capability: 'collaboration_tool_feed', support: 'insufficient_data' },
  { capability: 'performance_review_system', support: 'insufficient_data' },
  { capability: 'automatic_reorganization', support: 'unavailable' },
  { capability: 'automatic_team_creation', support: 'unavailable' },
  { capability: 'automatic_team_deletion', support: 'unavailable' },
  { capability: 'automatic_personnel_transfer', support: 'unavailable' },
  { capability: 'automatic_promotion', support: 'unavailable' },
  { capability: 'automatic_termination', support: 'unavailable' },
  { capability: 'automatic_evaluation', support: 'unavailable' },
  { capability: 'automatic_compensation', support: 'unavailable' },
  { capability: 'automatic_kpi_modification', support: 'unavailable' },
  { capability: 'automatic_budget_change', support: 'unavailable' },
  { capability: 'automatic_strategy_change', support: 'unavailable' },
  { capability: 'automatic_governance_change', support: 'unavailable' },
  { capability: 'automatic_production_change', support: 'unavailable' },
  { capability: 'automatic_merge', support: 'unavailable' },
  { capability: 'automatic_deploy', support: 'unavailable' },
];
