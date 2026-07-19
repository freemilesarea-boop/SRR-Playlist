import { describe, expect, it } from 'vitest';
import {
  ALIGNMENT_GOALS, STRATEGY_BLOCKED_ACTIONS, STRATEGY_RELATIONSHIP_EDGES, STRATEGY_RELATIONSHIP_FLOW,
  assessStrategyQuality, bucketizeInitiatives, buildStrategyOverview, buildStrategyRelationships,
  buildStrategySummaryLines, computeStrategyAnalytics, emptyStrategyFeeds, improvementDailySeries,
  isBlockedStrategyAction, mapStatusToBucket, overallStrategyQuality, summarizeAlignment,
  summarizeInnovation, summarizeRoadmap,
  type StrategyFeeds,
} from './strategyInnovationCenter';

function feedsFixture(): StrategyFeeds {
  return {
    portfolios: [
      { id: 'p1', portfolio_code: 'PF-1', portfolio_name: 'A', portfolio_status: 'active', initiative_references: [{}, {}] },
      { id: 'p2', portfolio_code: 'PF-2', portfolio_name: 'B', portfolio_status: 'proposed', initiative_references: [] },
      { id: 'p3', portfolio_code: 'PF-3', portfolio_name: 'C', portfolio_status: 'archived_reference', initiative_references: [] },
      { id: 'p4', portfolio_code: 'PF-4', portfolio_name: 'D', portfolio_status: 'weird_state', initiative_references: [] },
    ],
    roadmapItems: [
      { id: 'r1', roadmap_code: 'RM-1', title: 'R1', roadmap_phase: 'h1', review_status: 'approved' },
      { id: 'r2', roadmap_code: 'RM-2', title: 'R2', roadmap_phase: 'h2', review_status: 'pending' },
      { id: 'r3', roadmap_code: 'RM-3', title: 'R3', roadmap_phase: 'done', review_status: 'completed' },
    ],
    innovations: [
      { id: 'i1', innovation_code: 'IN-1', innovation_name: 'I1', innovation_category: 'product', innovation_status: 'candidate', opportunity_status: 'high_opportunity', risk_status: 'high_risk', created_at: '2026-07-18T00:00:00Z' },
      { id: 'i2', innovation_code: 'IN-2', innovation_name: 'I2', innovation_category: 'process', innovation_status: 'discovered', opportunity_status: 'insufficient_data', risk_status: 'low_risk', created_at: '2026-07-18T01:00:00Z' },
    ],
    improvements: [
      { id: 'm1', improvement_code: 'IM-1', improvement_name: 'M1', improvement_category: 'operations', improvement_status: 'identified', created_at: '2026-07-10T00:00:00Z' },
      { id: 'm2', improvement_code: 'IM-2', improvement_name: 'M2', improvement_category: 'operations', improvement_status: 'identified', created_at: '2026-07-11T00:00:00Z' },
      { id: 'm3', improvement_code: 'IM-3', improvement_name: 'M3', improvement_category: 'process', improvement_status: 'identified', created_at: '2026-07-12T00:00:00Z' },
      { id: 'm4', improvement_code: 'IM-4', improvement_name: 'M4', improvement_category: 'process', improvement_status: 'identified', created_at: '2026-07-13T00:00:00Z' },
    ],
    missions: [
      { id: 's1', mission_code: 'MS-1', mission_name: 'S1', mission_category: 'business', mission_status: 'observed' },
      { id: 's2', mission_code: 'MS-2', mission_name: 'S2', mission_category: 'financial', mission_status: 'observed' },
      { id: 's3', mission_code: 'MS-3', mission_name: 'S3', mission_category: 'custom_area', mission_status: 'observed' },
    ],
    foresights: [
      { id: 'f1', foresight_code: 'FS-1', foresight_name: 'F1', foresight_status: 'observed', opportunity_status: 'promising' },
    ],
    performance: { kpi_actuals: {} },
    execRecommendations: [
      { id: 'e1', rec_code: 'ER-1', title: 'E1', status: 'proposed' },
      { id: 'e2', rec_code: 'ER-2', title: 'E2', status: 'archived' },
    ],
  };
}

describe('Initiative Center — 실측 상태 → 스펙 4버킷 매핑(생성 없음)', () => {
  it('active/planned/completed/deferred 매핑 + 매핑 불가 상태 공개', () => {
    expect(mapStatusToBucket('active')).toBe('active');
    expect(mapStatusToBucket('proposed')).toBe('planned');
    expect(mapStatusToBucket('archived_reference')).toBe('completed');
    expect(mapStatusToBucket('on_hold')).toBe('deferred');
    const r = bucketizeInitiatives(feedsFixture().portfolios!.map((p) => ({ status: p.portfolio_status })));
    expect(r.buckets.find((b) => b.bucket === 'active')?.count).toBe(1);
    expect(r.otherStatuses).toEqual([{ status: 'weird_state', count: 1 }]);
    expect(r.total).toBe(4);
  });

  it('피드 미관측이면 전 버킷 null', () => {
    const r = bucketizeInitiatives(null);
    expect(r.buckets.every((b) => b.count === null)).toBe(true);
    expect(r.total).toBeNull();
  });
});

describe('Innovation / Alignment / Roadmap — 조회·연결만', () => {
  it('Innovation: 후보/개선 카테고리/high 위험 집계', () => {
    const s = summarizeInnovation(feedsFixture());
    expect(s.innovationCandidates).toBe(2);
    expect(s.byImprovementCategory[0]).toEqual({ category: 'operations', count: 2 });
    expect(s.highRiskInnovations).toBe(1);
    expect(summarizeInnovation(emptyStrategyFeeds()).innovationCandidates).toBeNull();
  });

  it('Alignment: 스펙 5목표 매핑 + 스펙 외 카테고리 공개', () => {
    const a = summarizeAlignment(feedsFixture().missions);
    expect(a.goals.find((g) => g.goal === 'business')?.count).toBe(1);
    expect(a.goals.find((g) => g.goal === 'technology')?.count).toBe(0);
    expect(a.otherCategories).toEqual([{ category: 'custom_area', count: 1 }]);
    expect(a.mappedGoalCount).toBe(2);
    expect(a.alignmentPct).toBe(40);
    expect(summarizeAlignment(null).goals.every((g) => g.count === null)).toBe(true);
    expect(ALIGNMENT_GOALS).toHaveLength(5);
  });

  it('Roadmap: phase/review 매핑 + delayed 는 판정 필드 부재로 null 정직', () => {
    const r = summarizeRoadmap(feedsFixture().roadmapItems);
    expect(r.buckets.find((b) => b.bucket === 'active')?.count).toBe(1);   // approved
    expect(r.buckets.find((b) => b.bucket === 'planned')?.count).toBe(1);  // pending
    expect(r.buckets.find((b) => b.bucket === 'completed')?.count).toBe(1);
    expect(r.buckets.find((b) => b.bucket === 'delayed')?.count).toBeNull();
    expect(r.progressPct).toBe(33);
    expect(summarizeRoadmap(null).progressPct).toBeNull();
  });
});

describe('Overview / Analytics — Null→0 금지', () => {
  it('카드 8필드를 관측값 기반으로 채운다', () => {
    const card = buildStrategyOverview(feedsFixture());
    expect(card.activeInitiatives).toBe(1);
    expect(card.innovationStatus).toBe(2);
    expect(card.roadmapProgressPct).toBe(33);
    expect(card.businessAlignmentPct).toBe(40);
    expect(card.executiveFocus).toBe(1);
    expect(card.strategicRisks).toBe(1);
    expect(card.strategicHealth).toBe('attention'); // high 위험 1건
  });

  it('전부 미관측이면 null + insufficient_data', () => {
    const card = buildStrategyOverview(emptyStrategyFeeds());
    expect(card.strategicHealth).toBe('insufficient_data');
    expect(card.activeInitiatives).toBeNull();
    expect(card.strategicOpportunities).toBeNull();
    const a = computeStrategyAnalytics(emptyStrategyFeeds());
    expect(a.initiativeProgressPct).toBeNull();
    expect(a.improvementTrend).toBe('insufficient_data');
  });

  it('Analytics: 개선 추세는 일 단위 집계 halves 비교(E-2 재사용), delayed 는 항상 null', () => {
    const a = computeStrategyAnalytics(feedsFixture());
    expect(a.initiativeProgressPct).toBe(25);
    expect(a.completionRatePct).toBe(25);
    expect(a.delayedItems).toBeNull();
    expect(improvementDailySeries(feedsFixture().improvements)).toEqual([1, 1, 1, 1]);
    expect(a.improvementTrend).toBe('flat');
  });
});

describe('Quality / Relationships / Summary / 금지 목록', () => {
  it('Quality: 미관측 insufficient / 0건 attention / high 위험 ≥5 critical', () => {
    const q = assessStrategyQuality(feedsFixture());
    expect(q.find((e) => e.area === 'strategic_risks')?.level).toBe('attention');
    expect(overallStrategyQuality(q)).toBe('attention');
    const empty = assessStrategyQuality(emptyStrategyFeeds());
    expect(empty.every((e) => e.level === 'insufficient_data')).toBe(true);
    expect(overallStrategyQuality(empty)).toBe('insufficient_data');
    const critical = assessStrategyQuality({
      ...emptyStrategyFeeds(),
      innovations: Array.from({ length: 5 }, (_, i) => ({
        id: `x${i}`, innovation_code: `C-${i}`, innovation_name: 'x', innovation_category: 'c',
        innovation_status: 'candidate', opportunity_status: 'o', risk_status: 'high_risk', created_at: '2026-07-01T00:00:00Z',
      })),
    });
    expect(critical.find((e) => e.area === 'strategic_risks')?.level).toBe('critical');
  });

  it('관계 흐름 6단계/5연결 관측 여부', () => {
    expect(STRATEGY_RELATIONSHIP_FLOW).toHaveLength(6);
    expect(STRATEGY_RELATIONSHIP_EDGES).toHaveLength(5);
    const rel = buildStrategyRelationships(feedsFixture());
    expect(rel.every((r) => r.observed)).toBe(true);
    expect(buildStrategyRelationships(emptyStrategyFeeds()).every((r) => !r.observed)).toBe(true);
  });

  it('요약 5줄 이내 + 미관측 정직 서술', () => {
    const lines = buildStrategySummaryLines({ activeInitiatives: 3, topImprovementCategory: 'operations', roadmapProgressPct: 33, strategicRisks: 0, opportunityCount: 1 });
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe('현재 핵심 Initiative 3건이 진행 중입니다.');
    expect(lines[3]).toBe('Critical Strategic Risk는 관측되지 않았습니다.');
    const none = buildStrategySummaryLines({ activeInitiatives: null, topImprovementCategory: null, roadmapProgressPct: null, strategicRisks: null, opportunityCount: null });
    expect(none.every((l) => l.includes('관측되지 않았습니다'))).toBe(true);
  });

  it('금지 9종 + automatic_* 차단', () => {
    expect(STRATEGY_BLOCKED_ACTIONS).toHaveLength(9);
    for (const a of STRATEGY_BLOCKED_ACTIONS) expect(isBlockedStrategyAction(a)).toBe(true);
    expect(isBlockedStrategyAction('view_roadmap')).toBe(false);
  });
});
