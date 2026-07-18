import { describe, it, expect } from 'vitest';
import {
  ORGANIZATION_CATEGORIES, ORGANIZATION_STATUSES, ORG_HEALTH_RESULTS,
  OPERATING_MATURITY_DIMENSIONS, OPERATING_MATURITY_RESULTS,
  CAPABILITY_GAP_DOMAINS, CAPABILITY_GAP_RESULTS,
  DECISION_FLOW_RESULTS, COLLABORATION_RESULTS, BOTTLENECK_RESULTS,
  WORKLOAD_RESULTS, ORG_DEPENDENCY_RESULTS, SPOF_RESULTS,
  OPERATING_REVIEW_TYPES, OPERATING_REVIEW_STATUSES,
  ORG_RECOMMENDATION_TYPES, ORG_SCORECARD_FIELDS, ORGANIZATION_FLOW_STAGES,
  evaluateOperatingMaturity, evaluateCapabilityGap, evaluateOrganizationalHealth,
  analyzeCollaborationNetwork, evaluateDecisionFlow, detectRoleOverload,
  detectSinglePointsOfFailure, buildExecutiveOrganizationScorecard,
  validateOrganizationReview, buildOrganizationTimeline,
  ENTERPRISE_ORGANIZATION_COMPONENTS, ENTERPRISE_ORGANIZATION_SUPPORT_MATRIX,
} from './enterpriseOrganization';

describe('enterpriseOrganization 상수(§3~§10 — SQL CHECK 1:1)', () => {
  it('Organization Category 16종·Status 5종', () => {
    expect(ORGANIZATION_CATEGORIES).toHaveLength(16);
    expect(ORGANIZATION_STATUSES).toHaveLength(5);
    expect(ORGANIZATION_STATUSES).toContain('insufficient_data');
  });
  it('Health/Maturity/Capability Gap 결과 5종 + insufficient_data 포함', () => {
    for (const list of [ORG_HEALTH_RESULTS, OPERATING_MATURITY_RESULTS, CAPABILITY_GAP_RESULTS, WORKLOAD_RESULTS, ORG_DEPENDENCY_RESULTS, SPOF_RESULTS]) {
      expect(list).toHaveLength(5);
      expect(list).toContain('insufficient_data');
    }
    expect(OPERATING_MATURITY_DIMENSIONS).toHaveLength(6);
    expect(CAPABILITY_GAP_DOMAINS).toHaveLength(7);
  });
  it('Decision Flow/Collaboration 6종·Bottleneck 7종·Review 3종/5종·권고 23종·Scorecard 8필드·Flow 13단계', () => {
    expect(DECISION_FLOW_RESULTS).toHaveLength(6);
    expect(COLLABORATION_RESULTS).toHaveLength(6);
    expect(BOTTLENECK_RESULTS).toHaveLength(7);
    expect(OPERATING_REVIEW_TYPES).toHaveLength(3);
    expect(OPERATING_REVIEW_STATUSES).toHaveLength(5);
    expect(ORG_RECOMMENDATION_TYPES).toHaveLength(23);
    expect(ORG_RECOMMENDATION_TYPES).toContain('insufficient_data');
    expect(ORG_SCORECARD_FIELDS).toHaveLength(8);
    expect(ORGANIZATION_FLOW_STAGES).toHaveLength(13);
    expect(ENTERPRISE_ORGANIZATION_COMPONENTS).toHaveLength(10);
  });
});

describe('evaluateOperatingMaturity(§6 — Maturity ≠ Organizational Success)', () => {
  it('6차원 고득점 → highly_mature_candidate', () => {
    const r = evaluateOperatingMaturity(OPERATING_MATURITY_DIMENSIONS.map((dimension) => ({ dimension, score: 90 })));
    expect(r.result).toBe('highly_mature_candidate');
    expect(r.averageScore).toBe(90);
    expect(r.assessedDimensions).toBe(6);
    expect(r.maturityIsNotOrganizationalSuccess).toBe(true);
  });
  it('중간 점수 → developing_candidate, 저득점 → immature_candidate', () => {
    expect(evaluateOperatingMaturity([
      { dimension: 'process_consistency', score: 45 }, { dimension: 'decision_speed', score: 50 }, { dimension: 'collaboration', score: 40 },
    ]).result).toBe('developing_candidate');
    expect(evaluateOperatingMaturity([
      { dimension: 'process_consistency', score: 20 }, { dimension: 'decision_speed', score: 25 }, { dimension: 'collaboration', score: 30 },
    ]).result).toBe('immature_candidate');
  });
  it('3차원 미만 평가 → insufficient_data(Null → 0 금지)', () => {
    const r = evaluateOperatingMaturity([
      { dimension: 'process_consistency', score: 90 }, { dimension: 'decision_speed', score: null },
    ]);
    expect(r.result).toBe('insufficient_data');
    expect(r.averageScore).toBeNull();
    expect(r.missingDimensions).toContain('decision_speed');
    expect(evaluateOperatingMaturity(null).result).toBe('insufficient_data');
  });
  it('허용되지 않은 차원은 평가에서 제외', () => {
    const r = evaluateOperatingMaturity([
      { dimension: 'employee_ranking', score: 100 }, { dimension: 'process_consistency', score: 70 }, { dimension: 'decision_speed', score: 70 },
    ]);
    expect(r.result).toBe('insufficient_data');
    expect(r.assessedDimensions).toBe(2);
  });
});

describe('evaluateCapabilityGap(§7 — Gap ≠ Employee Performance, worst-of)', () => {
  it('전 도메인 커버리지 양호 → minimal_gap_candidate', () => {
    const r = evaluateCapabilityGap(CAPABILITY_GAP_DOMAINS.map((domain) => ({ domain, coverageScore: 85 })));
    expect(r.result).toBe('minimal_gap_candidate');
    expect(r.assessedDomains).toBe(7);
    expect(r.gapIsNotEmployeePerformance).toBe(true);
  });
  it('가장 약한 도메인이 결과를 결정(worst-of)', () => {
    const r = evaluateCapabilityGap([
      { domain: 'leadership', coverageScore: 90 }, { domain: 'security', coverageScore: 35 }, { domain: 'ai', coverageScore: 70 },
    ]);
    expect(r.result).toBe('critical_gap_candidate');
    expect(r.weakestDomain).toBe('security');
    expect(r.weakestCoverage).toBe(35);
  });
  it('경계값: 60 → manageable, 40 → significant', () => {
    expect(evaluateCapabilityGap([{ domain: 'technical', coverageScore: 60 }]).result).toBe('manageable_gap_candidate');
    expect(evaluateCapabilityGap([{ domain: 'technical', coverageScore: 40 }]).result).toBe('significant_gap_candidate');
  });
  it('평가 없음/null → insufficient_data + 미평가 도메인 공개', () => {
    const r = evaluateCapabilityGap([{ domain: 'leadership', coverageScore: null }]);
    expect(r.result).toBe('insufficient_data');
    expect(r.unassessedDomains).toHaveLength(7);
    expect(evaluateCapabilityGap(null).result).toBe('insufficient_data');
  });
});

describe('evaluateOrganizationalHealth(§5 — Health ≠ HR Evaluation)', () => {
  it('성숙+저갭+강한 협업 → excellent_health_candidate', () => {
    const r = evaluateOrganizationalHealth({
      maturity: 'highly_mature_candidate', capabilityGap: 'minimal_gap_candidate',
      collaboration: 'strong_collaboration_candidate', bottleneck: 'no_material_bottleneck_candidate',
    });
    expect(r.result).toBe('excellent_health_candidate');
    expect(r.assessedComponents).toBe(4);
    expect(r.healthIsNotHrEvaluation).toBe(true);
  });
  it('심각한 갭 + 사일로 협업 → unhealthy_candidate', () => {
    const r = evaluateOrganizationalHealth({
      maturity: 'immature_candidate', capabilityGap: 'critical_gap_candidate',
      collaboration: 'siloed_collaboration_candidate', bottleneck: 'decision_bottleneck_candidate',
    });
    expect(r.result).toBe('unhealthy_candidate');
  });
  it('구성요소 2개 미만 평가 → insufficient_data(미검증 점수화 금지)', () => {
    const r = evaluateOrganizationalHealth({
      maturity: 'mature_candidate', capabilityGap: 'insufficient_data',
      collaboration: 'collaboration_unverified', bottleneck: null,
    });
    expect(r.result).toBe('insufficient_data');
    expect(r.healthScore).toBeNull();
    expect(r.assessedComponents).toBe(1);
  });
});

describe('analyzeCollaborationNetwork(Score ≠ Team Quality)', () => {
  it('빠른 Edge → strong, 지연 Edge → delayed', () => {
    const teams = ['product', 'engineering', 'operations'];
    expect(analyzeCollaborationNetwork(teams, [
      { from: 'product', to: 'engineering', avgDelayDays: 1 }, { from: 'engineering', to: 'operations', avgDelayDays: 2 },
    ]).result).toBe('strong_collaboration_candidate');
    expect(analyzeCollaborationNetwork(teams, [
      { from: 'product', to: 'engineering', avgDelayDays: 8 }, { from: 'engineering', to: 'operations', avgDelayDays: 9 },
    ]).result).toBe('delayed_collaboration_candidate');
  });
  it('Edge 없는 팀 → siloed_collaboration_candidate + 팀 목록 공개', () => {
    const r = analyzeCollaborationNetwork(['product', 'engineering', 'legal'], [
      { from: 'product', to: 'engineering', avgDelayDays: 1 },
    ]);
    expect(r.result).toBe('siloed_collaboration_candidate');
    expect(r.siloedTeams).toEqual(['legal']);
    expect(r.collaborationScoreIsNotTeamQuality).toBe(true);
  });
  it('과반 Edge 지연 미계측 → collaboration_unverified(Null → 0 금지)', () => {
    const r = analyzeCollaborationNetwork(['a', 'b', 'c'], [
      { from: 'a', to: 'b', avgDelayDays: null }, { from: 'b', to: 'c', avgDelayDays: null }, { from: 'a', to: 'c', avgDelayDays: 1 },
    ]);
    expect(r.result).toBe('collaboration_unverified');
    expect(r.unverifiedEdges).toBe(2);
  });
  it('팀/Edge 없음 → insufficient_data', () => {
    expect(analyzeCollaborationNetwork(null, null).result).toBe('insufficient_data');
    expect(analyzeCollaborationNetwork(['a'], []).result).toBe('insufficient_data');
  });
});

describe('evaluateDecisionFlow(Flow Candidate ≠ 자동 프로세스 변경)', () => {
  it('총 소요 3일 이하 → fast, 차단 단계 존재 → blocked', () => {
    expect(evaluateDecisionFlow([
      { stage: 'proposal', avgDays: 1 }, { stage: 'review', avgDays: 1.5 },
    ]).result).toBe('fast_decision_flow_candidate');
    const r = evaluateDecisionFlow([
      { stage: 'proposal', avgDays: 1 }, { stage: 'approval', avgDays: null, blocked: true },
    ]);
    expect(r.result).toBe('blocked_decision_flow_candidate');
    expect(r.blockedStages).toEqual(['approval']);
  });
  it('과반 미계측 → decision_flow_unverified, 입력 없음 → insufficient_data', () => {
    expect(evaluateDecisionFlow([
      { stage: 'a', avgDays: null }, { stage: 'b', avgDays: null }, { stage: 'c', avgDays: 2 },
    ]).result).toBe('decision_flow_unverified');
    expect(evaluateDecisionFlow(null).result).toBe('insufficient_data');
  });
});

describe('detectRoleOverload / detectSinglePointsOfFailure(개인 평가 아님)', () => {
  it('임계 이상 담당 → overloaded_role_candidate, 균등 → balanced', () => {
    const r = detectRoleOverload([
      { role: 'platform_lead', assignmentCount: 8 }, { role: 'qa', assignmentCount: 2 },
    ]);
    expect(r.result).toBe('overloaded_role_candidate');
    expect(r.overloadedRoles).toEqual(['platform_lead']);
    expect(r.workloadIsNotIndividualEvaluation).toBe(true);
    expect(detectRoleOverload([
      { role: 'a', assignmentCount: 2 }, { role: 'b', assignmentCount: 3 },
    ]).result).toBe('balanced_workload_candidate');
  });
  it('편차 큼 → uneven, 전부 미계측 → workload_unverified, 없음 → insufficient_data', () => {
    expect(detectRoleOverload([
      { role: 'a', assignmentCount: 1 }, { role: 'b', assignmentCount: 5 },
    ]).result).toBe('uneven_workload_candidate');
    expect(detectRoleOverload([{ role: 'a', assignmentCount: null }]).result).toBe('workload_unverified');
    expect(detectRoleOverload(null).result).toBe('insufficient_data');
  });
  it('담당 0명 영역 → critical_spof, 1명 영역 → potential_spof', () => {
    const r = detectSinglePointsOfFailure([
      { area: 'billing', ownerCount: 0 }, { area: 'auth', ownerCount: 1 }, { area: 'web', ownerCount: 3 },
    ]);
    expect(r.result).toBe('critical_spof_candidate');
    expect(r.unassignedAreas).toEqual(['billing']);
    expect(r.spofAreas).toEqual(['auth']);
    expect(r.spofIsNotIndividualBlame).toBe(true);
    expect(detectSinglePointsOfFailure([
      { area: 'auth', ownerCount: 1 }, { area: 'web', ownerCount: 2 },
    ]).result).toBe('potential_spof_candidate');
    expect(detectSinglePointsOfFailure([
      { area: 'web', ownerCount: 2 },
    ]).result).toBe('no_material_spof_candidate');
    expect(detectSinglePointsOfFailure([{ area: 'x', ownerCount: null }]).result).toBe('spof_unverified');
  });
});

describe('buildExecutiveOrganizationScorecard(§8 — 결정적 정렬)', () => {
  const base = {
    category: 'engineering', maturity: 'mature_candidate' as const, collaboration: null,
    bottleneckPresent: false, recommendation: null, executiveReviewPresent: false,
  };
  it('unhealthy/critical gap 우선 + 동순위는 코드순', () => {
    const r = buildExecutiveOrganizationScorecard([
      { ...base, organizationCode: 'ORG-C', health: 'healthy_candidate', capabilityGap: 'minimal_gap_candidate' },
      { ...base, organizationCode: 'ORG-A', health: 'unhealthy_candidate', capabilityGap: 'critical_gap_candidate' },
      { ...base, organizationCode: 'ORG-B', health: 'unhealthy_candidate', capabilityGap: 'critical_gap_candidate' },
    ], 3);
    expect(r.priorityRows.map((e) => e.organizationCode)).toEqual(['ORG-A', 'ORG-B', 'ORG-C']);
    expect(r.fields).toHaveLength(8);
    expect(r.scorecardIsNotHrEvaluation).toBe(true);
    expect(r.orderingIsDeterministic).toBe(true);
  });
  it('null 입력 → 빈 행(오류 없음)', () => {
    expect(buildExecutiveOrganizationScorecard(null).priorityRows).toEqual([]);
  });
});

describe('validateOrganizationReview(§9 — Review ≠ Approval)', () => {
  it('Self-Review + Evidence 없음 → 이중 차단', () => {
    const r = validateOrganizationReview({ action: 'record_review_reference', evidenceCount: 0, isSelfReview: true });
    expect(r.allowed).toBe(false);
    expect(r.blockedReasons).toHaveLength(2);
    expect(r.reviewIsNotApproval).toBe(true);
    expect(r.finalChangeIsHuman).toBe(true);
  });
  it('타인 Review + Evidence 존재 → 허용, 그 외 액션은 게이트 미적용', () => {
    expect(validateOrganizationReview({ action: 'record_review_reference', evidenceCount: 2, isSelfReview: false }).allowed).toBe(true);
    expect(validateOrganizationReview({ action: 'mark_in_review', evidenceCount: null, isSelfReview: true }).allowed).toBe(true);
  });
});

describe('buildOrganizationTimeline / Honest Boundary(Support Matrix)', () => {
  it('13단계 관측 표시(자동 진행 아님)', () => {
    const rows = buildOrganizationTimeline({ present: { enterprise_vision: true, operating_learning: true } });
    expect(rows).toHaveLength(13);
    expect(rows[0]).toEqual({ stage: 'enterprise_vision', present: true });
    expect(rows.filter((r) => r.present)).toHaveLength(2);
  });
  it('Support Matrix 51항목 — unavailable 15종은 전부 automatic_*(절대 금지 1:1)', () => {
    expect(ENTERPRISE_ORGANIZATION_SUPPORT_MATRIX).toHaveLength(51);
    const unavailable = ENTERPRISE_ORGANIZATION_SUPPORT_MATRIX.filter((e) => e.support === 'unavailable');
    expect(unavailable).toHaveLength(15);
    expect(unavailable.every((e) => e.capability.startsWith('automatic_'))).toBe(true);
    for (const cap of ['automatic_reorganization', 'automatic_promotion', 'automatic_termination', 'automatic_compensation', 'automatic_merge', 'automatic_deploy']) {
      expect(unavailable.some((e) => e.capability === cap)).toBe(true);
    }
  });
  it('실측 부재 피드(HR/조직도/Payroll 등)는 insufficient_data 로 정직 표기', () => {
    const missing = ENTERPRISE_ORGANIZATION_SUPPORT_MATRIX.filter((e) => e.support === 'insufficient_data').map((e) => e.capability);
    expect(missing).toHaveLength(6);
    for (const feed of ['hr_system_feed', 'org_chart_ledger', 'payroll_system', 'time_tracking_system', 'collaboration_tool_feed', 'performance_review_system']) {
      expect(missing).toContain(feed);
    }
  });
});
