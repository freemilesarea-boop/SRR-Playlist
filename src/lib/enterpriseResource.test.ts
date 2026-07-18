import { describe, it, expect } from 'vitest';
import {
  RESOURCE_CATEGORIES, RESOURCE_STATUSES,
  CAPACITY_DIMENSIONS, CAPACITY_RESULTS,
  CONSTRAINT_DIMENSIONS, CONSTRAINT_RESULTS,
  READINESS_DIMENSIONS, READINESS_RESULTS,
  UTILIZATION_RESULTS, CAPACITY_WORKLOAD_RESULTS, CAPACITY_BOTTLENECK_RESULTS,
  RESOURCE_REVIEW_TYPES, CAPACITY_REVIEW_STATUSES,
  RESOURCE_RECOMMENDATION_TYPES, RESOURCE_SCORECARD_FIELDS, RESOURCE_FLOW_STAGES,
  evaluateCapacityAssessment, analyzeConstraints, evaluateExecutionReadiness,
  detectBottlenecks, analyzeUtilization, buildExecutiveResourceScorecard,
  validateResourceReview, buildResourceTimeline,
  ENTERPRISE_RESOURCE_COMPONENTS, ENTERPRISE_RESOURCE_SUPPORT_MATRIX,
} from './enterpriseResource';

describe('enterpriseResource 상수(§3~§10 — SQL CHECK 1:1)', () => {
  it('Resource Category 12종·Status 7종', () => {
    expect(RESOURCE_CATEGORIES).toHaveLength(12);
    expect(RESOURCE_STATUSES).toHaveLength(7);
    expect(RESOURCE_STATUSES).toContain('insufficient_data');
  });
  it('Capacity/Constraint/Readiness/Utilization/Workload 결과 5종 + insufficient_data 포함, Bottleneck 6종', () => {
    for (const list of [CAPACITY_RESULTS, CONSTRAINT_RESULTS, READINESS_RESULTS, UTILIZATION_RESULTS, CAPACITY_WORKLOAD_RESULTS, CAPACITY_REVIEW_STATUSES]) {
      expect(list).toHaveLength(5);
      expect(list).toContain('insufficient_data');
    }
    expect(CAPACITY_BOTTLENECK_RESULTS).toHaveLength(6);
    expect(CAPACITY_DIMENSIONS).toHaveLength(5);
    expect(CONSTRAINT_DIMENSIONS).toHaveLength(5);
    expect(READINESS_DIMENSIONS).toHaveLength(5);
  });
  it('Review 3종·권고 23종·Scorecard 8필드·Flow 12단계·컴포넌트 10종', () => {
    expect(RESOURCE_REVIEW_TYPES).toHaveLength(3);
    expect(RESOURCE_RECOMMENDATION_TYPES).toHaveLength(23);
    expect(RESOURCE_RECOMMENDATION_TYPES).toContain('insufficient_data');
    expect(RESOURCE_SCORECARD_FIELDS).toHaveLength(8);
    expect(RESOURCE_FLOW_STAGES).toHaveLength(12);
    expect(ENTERPRISE_RESOURCE_COMPONENTS).toHaveLength(10);
  });
});

describe('evaluateCapacityAssessment(§5 — worst-of 여유율, Capacity ≠ 보장)', () => {
  it('가장 낮은 여유율 차원이 결과를 결정(worst-of)', () => {
    const r = evaluateCapacityAssessment([
      { dimension: 'workforce_capacity', headroomScore: 80 }, { dimension: 'budget_capacity', headroomScore: 20 },
      { dimension: 'technology_capacity', headroomScore: 70 },
    ]);
    expect(r.result).toBe('overloaded_candidate');
    expect(r.worstDimension).toBe('budget_capacity');
    expect(r.capacityIsNotGuaranteedDelivery).toBe(true);
  });
  it('경계값: 60 → sufficient, 35 → constrained, 9 → unavailable', () => {
    expect(evaluateCapacityAssessment([
      { dimension: 'workforce_capacity', headroomScore: 60 }, { dimension: 'budget_capacity', headroomScore: 70 }, { dimension: 'operational_capacity', headroomScore: 65 },
    ]).result).toBe('sufficient_candidate');
    expect(evaluateCapacityAssessment([
      { dimension: 'workforce_capacity', headroomScore: 35 }, { dimension: 'budget_capacity', headroomScore: 70 }, { dimension: 'operational_capacity', headroomScore: 65 },
    ]).result).toBe('constrained_candidate');
    expect(evaluateCapacityAssessment([
      { dimension: 'workforce_capacity', headroomScore: 9 }, { dimension: 'budget_capacity', headroomScore: 70 }, { dimension: 'operational_capacity', headroomScore: 65 },
    ]).result).toBe('unavailable_candidate');
  });
  it('3차원 미만 평가 → insufficient_data(Null → 0 금지)', () => {
    const r = evaluateCapacityAssessment([
      { dimension: 'workforce_capacity', headroomScore: 80 }, { dimension: 'budget_capacity', headroomScore: null },
    ]);
    expect(r.result).toBe('insufficient_data');
    expect(r.worstHeadroom).toBeNull();
    expect(evaluateCapacityAssessment(null).result).toBe('insufficient_data');
  });
});

describe('analyzeConstraints(§6 — worst-of, Constraint ≠ Failure)', () => {
  it('가장 심한 제약 차원이 결과를 결정(worst-of)', () => {
    const r = analyzeConstraints([
      { dimension: 'budget_constraint', severity: 20 }, { dimension: 'schedule_constraint', severity: 85 },
    ]);
    expect(r.result).toBe('critical_constraint_candidate');
    expect(r.worstDimension).toBe('schedule_constraint');
    expect(r.constraintIsNotFailure).toBe(true);
  });
  it('중간 → elevated/manageable, 낮음 → negligible', () => {
    expect(analyzeConstraints([
      { dimension: 'budget_constraint', severity: 50 }, { dimension: 'workforce_constraint', severity: 10 },
    ]).result).toBe('elevated_constraint_candidate');
    expect(analyzeConstraints([
      { dimension: 'budget_constraint', severity: 20 }, { dimension: 'workforce_constraint', severity: 10 },
    ]).result).toBe('manageable_constraint_candidate');
    expect(analyzeConstraints([
      { dimension: 'budget_constraint', severity: 5 }, { dimension: 'workforce_constraint', severity: 10 },
    ]).result).toBe('negligible_constraint_candidate');
  });
  it('2차원 미만 평가 → insufficient_data', () => {
    expect(analyzeConstraints([{ dimension: 'budget_constraint', severity: 90 }]).result).toBe('insufficient_data');
    expect(analyzeConstraints(null).result).toBe('insufficient_data');
  });
});

describe('evaluateExecutionReadiness(§7 — Readiness ≠ Success)', () => {
  it('전 차원 고득점 → ready + 최약 차원 공개', () => {
    const r = evaluateExecutionReadiness(READINESS_DIMENSIONS.map((dimension) => ({ dimension, score: 85 })));
    expect(r.result).toBe('ready_candidate');
    expect(r.assessedDimensions).toBe(5);
    expect(r.readinessIsNotSuccess).toBe(true);
  });
  it('중간 → mostly/partially, 저득점 → not_ready + weakest 공개', () => {
    const r = evaluateExecutionReadiness([
      { dimension: 'resource_availability', score: 30 }, { dimension: 'capacity', score: 25 }, { dimension: 'risk', score: 20 },
    ]);
    expect(r.result).toBe('not_ready_candidate');
    expect(r.weakestDimension).toBe('risk');
    expect(evaluateExecutionReadiness([
      { dimension: 'resource_availability', score: 65 }, { dimension: 'capacity', score: 60 }, { dimension: 'risk', score: 70 },
    ]).result).toBe('mostly_ready_candidate');
  });
  it('3차원 미만 평가 → insufficient_data', () => {
    expect(evaluateExecutionReadiness([{ dimension: 'capacity', score: 90 }]).result).toBe('insufficient_data');
    expect(evaluateExecutionReadiness(null).result).toBe('insufficient_data');
  });
});

describe('detectBottlenecks(Bottleneck ≠ Root Cause)', () => {
  it('부하 임계 초과 → resource_bottleneck + 목록 공개', () => {
    const r = detectBottlenecks([
      { itemCode: 'P-1', queueLoad: 90, dependencyCount: 1 }, { itemCode: 'P-2', queueLoad: 30, dependencyCount: 2 },
    ]);
    expect(r.result).toBe('resource_bottleneck_candidate');
    expect(r.loadBottlenecks).toEqual(['P-1']);
    expect(r.bottleneckIsNotRootCause).toBe(true);
  });
  it('의존 임계 초과 → dependency_bottleneck, 없음 → no_material', () => {
    expect(detectBottlenecks([
      { itemCode: 'P-1', queueLoad: 30, dependencyCount: 7 }, { itemCode: 'P-2', queueLoad: 20, dependencyCount: 1 },
    ]).result).toBe('dependency_bottleneck_candidate');
    expect(detectBottlenecks([
      { itemCode: 'P-1', queueLoad: 30, dependencyCount: 1 },
    ]).result).toBe('no_material_bottleneck_candidate');
  });
  it('전부 미계측 → bottleneck_unverified, 없음 → insufficient_data', () => {
    const r = detectBottlenecks([{ itemCode: 'P-1', queueLoad: null, dependencyCount: null }]);
    expect(r.result).toBe('bottleneck_unverified');
    expect(r.unverifiedItems).toBe(1);
    expect(detectBottlenecks(null).result).toBe('insufficient_data');
  });
});

describe('analyzeUtilization(유휴/과부하 — Utilization ≠ 생산성 평가)', () => {
  it('과부하 자원 존재 → overutilized + 목록 공개', () => {
    const r = analyzeUtilization([
      { resourceCode: 'R-1', utilizationPct: 95 }, { resourceCode: 'R-2', utilizationPct: 50 },
    ]);
    expect(r.result).toBe('overutilized_candidate');
    expect(r.overloadedResources).toEqual(['R-1']);
    expect(r.utilizationIsNotProductivity).toBe(true);
  });
  it('유휴 자원 존재 → underutilized, 정상 범위 → efficient', () => {
    const r = analyzeUtilization([
      { resourceCode: 'R-1', utilizationPct: 10 }, { resourceCode: 'R-2', utilizationPct: 50 },
    ]);
    expect(r.result).toBe('underutilized_candidate');
    expect(r.idleResources).toEqual(['R-1']);
    expect(analyzeUtilization([{ resourceCode: 'R-1', utilizationPct: 60 }]).result).toBe('efficient_utilization_candidate');
  });
  it('전부 미계측 → utilization_unverified, 없음 → insufficient_data', () => {
    expect(analyzeUtilization([{ resourceCode: 'R-1', utilizationPct: null }]).result).toBe('utilization_unverified');
    expect(analyzeUtilization(null).result).toBe('insufficient_data');
  });
});

describe('buildExecutiveResourceScorecard(§8 — 결정적 정렬)', () => {
  const base = { category: 'workforce', bottleneckPresent: false, humanReviewPresent: false };
  it('unavailable/critical constraint/not_ready 우선 + 동순위는 코드순', () => {
    const r = buildExecutiveResourceScorecard([
      { ...base, resourceCode: 'R-C', capacity: 'sufficient_candidate' as const, constraint: 'negligible_constraint_candidate' as const, readiness: 'ready_candidate' as const },
      { ...base, resourceCode: 'R-A', capacity: 'unavailable_candidate' as const, constraint: 'critical_constraint_candidate' as const, readiness: 'not_ready_candidate' as const },
      { ...base, resourceCode: 'R-B', capacity: 'unavailable_candidate' as const, constraint: 'critical_constraint_candidate' as const, readiness: 'not_ready_candidate' as const },
    ], 3);
    expect(r.priorityRows.map((e) => e.resourceCode)).toEqual(['R-A', 'R-B', 'R-C']);
    expect(r.fields).toHaveLength(8);
    expect(r.scorecardIsNotReallocation).toBe(true);
    expect(r.orderingIsDeterministic).toBe(true);
  });
  it('null 입력 → 빈 행(오류 없음)', () => {
    expect(buildExecutiveResourceScorecard(null).priorityRows).toEqual([]);
  });
});

describe('validateResourceReview(§9 — Resource 변경은 사람)', () => {
  it('Self-Review + Evidence 없음 → 이중 차단', () => {
    const r = validateResourceReview({ action: 'record_review_reference', evidenceCount: 0, isSelfReview: true });
    expect(r.allowed).toBe(false);
    expect(r.blockedReasons).toHaveLength(2);
    expect(r.reviewIsNotApproval).toBe(true);
    expect(r.resourceChangeIsHuman).toBe(true);
  });
  it('타인 Review + Evidence 존재 → 허용, 그 외 액션은 게이트 미적용', () => {
    expect(validateResourceReview({ action: 'record_review_reference', evidenceCount: 1, isSelfReview: false }).allowed).toBe(true);
    expect(validateResourceReview({ action: 'mark_available', evidenceCount: null, isSelfReview: true }).allowed).toBe(true);
  });
});

describe('buildResourceTimeline / Honest Boundary(Support Matrix)', () => {
  it('12단계 관측 표시(자동 진행 아님)', () => {
    const rows = buildResourceTimeline({ present: { enterprise_vision: true, resource_learning: true } });
    expect(rows).toHaveLength(12);
    expect(rows[0]).toEqual({ stage: 'enterprise_vision', present: true });
    expect(rows.filter((r) => r.present)).toHaveLength(2);
  });
  it('Support Matrix 48항목 — unavailable 12종은 전부 automatic_*(절대 금지 1:1)', () => {
    expect(ENTERPRISE_RESOURCE_SUPPORT_MATRIX).toHaveLength(48);
    const unavailable = ENTERPRISE_RESOURCE_SUPPORT_MATRIX.filter((e) => e.support === 'unavailable');
    expect(unavailable).toHaveLength(12);
    expect(unavailable.every((e) => e.capability.startsWith('automatic_'))).toBe(true);
    for (const cap of ['automatic_resource_reallocation', 'automatic_personnel_transfer', 'automatic_budget_change', 'automatic_project_start', 'automatic_project_termination', 'automatic_contract_signing', 'automatic_contract_termination', 'automatic_organization_change', 'automatic_merge', 'automatic_deploy', 'automatic_rollback']) {
      expect(unavailable.some((e) => e.capability === cap)).toBe(true);
    }
  });
  it('실측 부재 피드(HR 캐파/타임트래킹/ERP/예약/PM 도구/클라우드 비용)는 insufficient_data 로 정직 표기', () => {
    const missing = ENTERPRISE_RESOURCE_SUPPORT_MATRIX.filter((e) => e.support === 'insufficient_data').map((e) => e.capability);
    expect(missing).toHaveLength(6);
    for (const feed of ['hr_capacity_system', 'time_tracking_feed', 'erp_finance_ledger', 'resource_booking_system', 'project_management_tool_feed', 'cloud_cost_feed']) {
      expect(missing).toContain(feed);
    }
  });
});
