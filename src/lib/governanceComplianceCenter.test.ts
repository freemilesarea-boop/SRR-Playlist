import { describe, expect, it } from 'vitest';
import {
  GOVERNANCE_AI_ALLOWED, GOVERNANCE_BLOCKED_ACTIONS, GOVERNANCE_HUMAN_ONLY,
  GOVERNANCE_OVERSIGHT_MATRIX, GOVERNANCE_POLICY_DOMAINS, GOVERNANCE_RELATIONSHIP_EDGES,
  GOVERNANCE_RELATIONSHIP_FLOW,
  assessCompliance, buildGovernanceOverview, buildGovernanceRelationships,
  buildGovernanceSummaryLines, categorizeAuditHistory, computeComplianceAnalytics,
  emptyGovernanceFeeds, isBlockedGovernanceAction, overallCompliance, summarizePermissions,
  summarizePolicies,
  type GovernanceFeeds,
} from './governanceComplianceCenter';

function feedsFixture(): GovernanceFeeds {
  return {
    govEvents: { total: 40, violations: 0, blocked: 1, overrides: 0, checks: 30 },
    govCandidates: { total: 5, pending: 2, governance_ready: 1, rejected: 1, expired: 1, high_risk: 0, critical_risk: 0 },
    constitutionRules: [{ is_active: true, severity: 'critical' }, { is_active: true, severity: 'high' }],
    policies: [
      { domain: 'financial', status: 'active' }, { domain: 'financial', status: 'draft' },
      { domain: 'security', status: 'active' }, { domain: 'ops_custom', status: 'active' },
    ],
    identities: [
      { role: 'admin', is_admin: true, is_active: true },
      { role: 'user', is_admin: false, is_active: true },
      { role: 'user', is_admin: false, is_active: false },
    ],
    accessReviews: [{ review_status: 'pending' }, { review_status: 'approved' }, { review_status: 'rejected' }],
    actionHistory: [
      { command_type: 'decision_approve', status: 'success', reason: '근거 있음' },
      { command_type: 'decision_reject', status: 'success', reason: '' },
      { command_type: 'decision_defer', status: 'pending', reason: '보류 사유' },
      { command_type: 'executive_review', status: 'success', reason: 'r' },
      { command_type: 'executive_export', status: 'success', reason: 'r' },
      { command_type: 'force_store_resync', status: 'success' },
    ],
    settlementKpi: { held_count: 0, verification_failed_count: 0 },
  };
}

describe('Policy Center — 조회만, 생성 없음', () => {
  it('스펙 6도메인 분류 + 스펙 외 도메인은 별도 공개', () => {
    const s = summarizePolicies(feedsFixture().policies);
    expect(s.byDomain.find((d) => d.domain === 'financial')?.count).toBe(2);
    expect(s.byDomain.find((d) => d.domain === 'music')?.count).toBe(0);
    expect(s.otherDomains).toEqual([{ domain: 'ops_custom', count: 1 }]);
    expect(s.activeCount).toBe(3);
  });

  it('피드 미관측이면 전 도메인 null (0 조작 없음)', () => {
    const s = summarizePolicies(null);
    expect(s.byDomain).toHaveLength(GOVERNANCE_POLICY_DOMAINS.length);
    expect(s.byDomain.every((d) => d.count === null)).toBe(true);
    expect(s.totalCount).toBeNull();
  });
});

describe('Compliance Center — 결정적 판정', () => {
  it('관측값 기반 5영역 판정 (fixture: 전부 compliant/warning)', () => {
    const entries = assessCompliance(feedsFixture());
    expect(entries).toHaveLength(5);
    expect(entries.find((e) => e.area === 'policy')?.status).toBe('compliant');
    expect(entries.find((e) => e.area === 'review')?.status).toBe('warning'); // pending 1
    expect(entries.find((e) => e.area === 'financial')?.status).toBe('compliant');
    expect(overallCompliance(entries)).toBe('warning');
  });

  it('violation 이 있으면 종합은 violation, 전 영역 미관측이면 insufficient_data', () => {
    const feeds = { ...feedsFixture(), govEvents: { total: 10, violations: 2, blocked: 0, overrides: 0, checks: 10 } };
    expect(overallCompliance(assessCompliance(feeds))).toBe('violation');
    const empty = assessCompliance(emptyGovernanceFeeds());
    expect(empty.every((e) => e.status === 'insufficient_data')).toBe(true);
    expect(overallCompliance(empty)).toBe('insufficient_data');
  });
});

describe('Permission Center — 기존 체계 재사용, 부재 role 정직 표시', () => {
  it('실측 role 집계 + 스펙 role 매핑(부재 role 은 null)', () => {
    const p = summarizePermissions(feedsFixture().identities);
    expect(p.actualRoles).toEqual([{ role: 'admin', count: 1 }, { role: 'user', count: 2 }]);
    expect(p.specRoles.find((r) => r.role === 'admin')?.count).toBe(1);
    expect(p.specRoles.find((r) => r.role === 'executive')?.count).toBeNull();
    expect(p.specRoles.find((r) => r.role === 'executive')?.note).toContain('부재');
    expect(p.activeCount).toBe(2);
  });

  it('피드 미관측이면 전부 null', () => {
    const p = summarizePermissions(null);
    expect(p.specRoles.every((r) => r.count === null)).toBe(true);
    expect(p.adminCount).toBeNull();
  });
});

describe('Audit Center — 기존 0479 로그 분류만', () => {
  it('review/approval/decision/export/report 분류 + 기타 집계', () => {
    const { buckets, otherCount } = categorizeAuditHistory(feedsFixture().actionHistory);
    expect(buckets.find((b) => b.kind === 'approval')?.rows).toHaveLength(2);
    expect(buckets.find((b) => b.kind === 'decision')?.rows).toHaveLength(1); // defer
    expect(buckets.find((b) => b.kind === 'review')?.rows).toHaveLength(1);
    expect(buckets.find((b) => b.kind === 'export')?.rows).toHaveLength(1);
    expect(buckets.find((b) => b.kind === 'report')?.rows).toHaveLength(0);
    expect(otherCount).toBe(1);
    expect(categorizeAuditHistory(null).buckets.every((b) => b.rows.length === 0)).toBe(true);
  });
});

describe('Governance Overview / Relationships', () => {
  it('카드 8필드 — violation 0 + warning 존재 → attention', () => {
    const { card } = buildGovernanceOverview(feedsFixture());
    expect(card.governanceStatus).toBe('attention');
    expect(card.activePolicies).toBe(3);
    expect(card.pendingReviews).toBe(3); // access pending 1 + candidates pending 2
    expect(card.complianceStatus).toBe('warning');
    expect(card.humanOversightHumanOnly).toBe(5);
    expect(card.criticalViolations).toBe(0);
  });

  it('전부 미관측이면 insufficient_data + null 유지', () => {
    const { card } = buildGovernanceOverview(emptyGovernanceFeeds());
    expect(card.governanceStatus).toBe('insufficient_data');
    expect(card.activePolicies).toBeNull();
    expect(card.pendingReviews).toBeNull();
    expect(card.auditRecords).toBeNull();
  });

  it('관계 흐름 6단계/5연결 — 관측 여부 정직 표시', () => {
    expect(GOVERNANCE_RELATIONSHIP_FLOW).toHaveLength(6);
    expect(GOVERNANCE_RELATIONSHIP_EDGES).toHaveLength(5);
    const rel = buildGovernanceRelationships(feedsFixture());
    expect(rel.find((r) => r.stage === 'approval')?.observed).toBe(true);
    expect(buildGovernanceRelationships(emptyGovernanceFeeds()).every((r) => !r.observed)).toBe(true);
  });
});

describe('Compliance Analytics — 측정 불가 시 null', () => {
  it('관측값 기반 집계', () => {
    const a = computeComplianceAnalytics(feedsFixture());
    expect(a.totalReviews).toBe(3);
    expect(a.totalApprovals).toBe(1);
    expect(a.policyViolations).toBe(0);
    expect(a.auditCoveragePct).toBe(67); // decision 3건 중 사유 기록 2건
    expect(a.humanReviewRatePct).toBe(67); // 3건 중 결정 완료 2건
  });

  it('미관측 피드에서는 null (조작 없음)', () => {
    const a = computeComplianceAnalytics(emptyGovernanceFeeds());
    expect(a.totalReviews).toBeNull();
    expect(a.totalApprovals).toBeNull();
    expect(a.auditCoveragePct).toBeNull();
    expect(a.humanReviewRatePct).toBeNull();
  });
});

describe('Governance Summary + Oversight/금지 목록', () => {
  it('5줄 이내 결정적 요약, 미관측은 정직 서술', () => {
    const lines = buildGovernanceSummaryLines({ criticalViolations: 0, pendingApprovals: 0, auditRecords: 6, compliance: 'compliant', permissionChanges: null });
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe('Critical Policy 위반은 없습니다.');
    expect(lines[3]).toBe('Compliance는 Healthy 상태입니다.');
    expect(lines[4]).toContain('관측되지 않았습니다');
  });

  it('매트릭스: ai 4종/human 5종/unavailable 8종 = 스펙 1:1', () => {
    const ai = GOVERNANCE_OVERSIGHT_MATRIX.filter((e) => e.level === 'ai_allowed').map((e) => e.capability);
    expect(ai.sort()).toEqual([...GOVERNANCE_AI_ALLOWED].sort());
    const human = GOVERNANCE_OVERSIGHT_MATRIX.filter((e) => e.level === 'human_only').map((e) => e.capability);
    expect(human.sort()).toEqual([...GOVERNANCE_HUMAN_ONLY].sort());
    const blocked = GOVERNANCE_OVERSIGHT_MATRIX.filter((e) => e.level === 'unavailable').map((e) => e.capability);
    expect(blocked.sort()).toEqual([...GOVERNANCE_BLOCKED_ACTIONS].sort());
    for (const b of GOVERNANCE_BLOCKED_ACTIONS) expect(isBlockedGovernanceAction(b)).toBe(true);
    expect(isBlockedGovernanceAction('explain')).toBe(false);
  });
});
