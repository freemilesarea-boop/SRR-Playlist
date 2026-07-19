import { describe, expect, it } from 'vitest';
import {
  FORESIGHT_BLOCKED_ACTIONS, FORESIGHT_RELATIONSHIP_EDGES, FORESIGHT_RELATIONSHIP_FLOW,
  RISK_DOMAINS, SCENARIO_CASES,
  assessForesightQuality, buildEarlyWarnings, buildForesightOverview, buildForesightRelationships,
  buildOutlookSummaryLines, emptyForesightFeeds, isBlockedForesightAction, mapScenarioCase,
  summarizeForecasts, summarizeRisks, summarizeScenarios, summarizeTrends, worstQuality,
  type ForesightFeeds,
} from './foresightRiskCenter';

function pts(field: string, values: number[]) {
  return { points: values.map((v, i) => ({ bucket: `d${i}`, [field]: v })) };
}

function feedsFixture(): ForesightFeeds {
  return {
    ...emptyForesightFeeds(),
    revenueForecast: { projected_month_revenue: 3000000, current_mrr: 900000, arr_forecast: 10800000 },
    revenueTrend: pts('revenue', [100, 110, 120, 200, 220, 240]),
    streamingTimeline: pts('streams', [50, 52, 51, 50, 49, 51]),
    noc: { total_stores: 40, online_stores: 39, offline_stores: 1, today_incidents: 1, today_recovered: 0 },
    streaming: { pb_start: 200, pb_complete: 190, pb_error: 4 },
    revenue: { today: 90000, month: 2500000 },
    settlementKpi: { held_count: 0, verification_failed_count: 0 },
    artist: { pending: 3 },
    forecastIntel: { early_warnings: 0 },
    riskSummary: { risks: 2 },
    scenarios: [
      { id: 's1', scenario_code: 'SC-1', scenario_name: 'A', scenario_type: 'best_case_growth', scenario_status: 'ready', confidence: 60 },
      { id: 's2', scenario_code: 'SC-2', scenario_name: 'B', scenario_type: 'baseline', scenario_status: 'ready', confidence: 70 },
      { id: 's3', scenario_code: 'SC-3', scenario_name: 'C', scenario_type: 'exotic', scenario_status: 'draft', confidence: null },
    ],
    govEvents: { violations: 0, overrides: 0, checks: 12 },
    performance: { kpis: {} },
  };
}

describe('Forecast Center — 기존 Forecast 조회만', () => {
  it('revenue/executive 는 기존 RPC 값 그대로, resource/capacity 는 원장 부재 정직', () => {
    const f = summarizeForecasts(feedsFixture());
    expect(f.find((e) => e.kind === 'revenue')?.value).toBe(3000000);
    expect(f.find((e) => e.kind === 'executive')?.value).toBe(10800000);
    expect(f.find((e) => e.kind === 'resource')?.observed).toBe(false);
    expect(f.find((e) => e.kind === 'capacity')?.note).toContain('부재');
    const empty = summarizeForecasts(emptyForesightFeeds());
    expect(empty.every((e) => e.value === null)).toBe(true);
  });
});

describe('Risk Center — 기존 Risk 연결만(재계산 없음)', () => {
  it('5도메인 판정 — security 는 항상 미관측 정직, governance 위반은 critical', () => {
    const risks = summarizeRisks(feedsFixture());
    expect(risks).toHaveLength(RISK_DOMAINS.length);
    expect(risks.find((r) => r.domain === 'operational')?.level).toBe('attention'); // 미복구 1
    expect(risks.find((r) => r.domain === 'financial')?.level).toBe('healthy');
    expect(risks.find((r) => r.domain === 'security')?.level).toBe('insufficient_data');
    const violated = summarizeRisks({ ...feedsFixture(), govEvents: { violations: 2, overrides: 0, checks: 5 } });
    expect(violated.find((r) => r.domain === 'governance')?.level).toBe('critical');
    expect(summarizeRisks(emptyForesightFeeds()).every((r) => r.level === 'insufficient_data')).toBe(true);
  });
});

describe('Scenario Center — 기존 0516 표시만', () => {
  it('scenario_type 결정적 매핑 + 실측 타입 공개', () => {
    expect(mapScenarioCase('best_case_growth')).toBe('best_case');
    expect(mapScenarioCase('baseline')).toBe('expected_case');
    expect(mapScenarioCase('worst_downturn')).toBe('worst_case');
    expect(mapScenarioCase('exotic')).toBe('unknown');
    const s = summarizeScenarios(feedsFixture().scenarios);
    expect(s.cases.find((c) => c.scenarioCase === 'best_case')?.count).toBe(1);
    expect(s.cases.find((c) => c.scenarioCase === 'unknown')?.count).toBe(1);
    expect(s.total).toBe(3);
    expect(SCENARIO_CASES).toHaveLength(4);
    expect(summarizeScenarios(null).cases.every((c) => c.count === null)).toBe(true);
  });
});

describe('Trend / Early Warning — E-2/E-1 로직 재사용', () => {
  it('추세 5영역 — performance/strategic 은 시계열 부재 정직', () => {
    const trends = summarizeTrends(feedsFixture());
    expect(trends.find((t) => t.area === 'business')?.direction).toBe('up');
    expect(trends.find((t) => t.area === 'operational')?.direction).toBe('flat');
    expect(trends.find((t) => t.area === 'performance')?.direction).toBe('insufficient_data');
    expect(trends.find((t) => t.area === 'strategic')?.direction).toBe('insufficient_data');
  });

  it('Early Warning — Alert 재사용, forecast 편차는 판정 피드 부재로 null', () => {
    const w = buildEarlyWarnings(feedsFixture(), summarizeTrends(feedsFixture()));
    expect(w.criticalAlerts).toBe(0);
    expect(w.forecastDeviations).toBeNull();
    expect(w.riskEscalations).toBe(0);
    expect(w.trendChanges).toBe(1); // 관측된 2개 추세(business up, operational flat) 중 변화 1건
  });

  it('전부 미관측이면 경보 수를 지어내지 않는다(null)', () => {
    const w = buildEarlyWarnings(emptyForesightFeeds(), summarizeTrends(emptyForesightFeeds()));
    expect(w.criticalAlerts).toBeNull();
    expect(w.warningAlerts).toBeNull();
    expect(w.trendChanges).toBeNull();
    expect(w.riskEscalations).toBeNull();
  });
});

describe('Overview / Relationships / Quality / Summary / 금지 목록', () => {
  it('카드 8필드 관측값 기반', () => {
    const { card } = buildForesightOverview(feedsFixture());
    expect(card.forecastObserved).toBe(3); // revenue + operational(intel) + executive
    expect(card.riskStatus).toBe('attention');
    expect(card.scenarioCoverage).toBe(3);
    expect(card.trendMeasured).toBe(2);
    expect(card.emergingOpportunities).toBe(1);
    expect(card.executiveOutlook).toBe('attention');
  });

  it('전부 미관측이면 insufficient_data/null', () => {
    const { card } = buildForesightOverview(emptyForesightFeeds());
    expect(card.executiveOutlook).toBe('insufficient_data');
    expect(card.activeWarnings).toBeNull();
    expect(card.scenarioCoverage).toBeNull();
    expect(card.emergingOpportunities).toBeNull();
  });

  it('관계 6단계/5연결 — executive_outlook 은 별도 저장소 없음 정직', () => {
    expect(FORESIGHT_RELATIONSHIP_FLOW).toHaveLength(6);
    expect(FORESIGHT_RELATIONSHIP_EDGES).toHaveLength(5);
    const rel = buildForesightRelationships(feedsFixture());
    expect(rel.find((r) => r.stage === 'forecast')?.observed).toBe(true);
    expect(rel.find((r) => r.stage === 'executive_outlook')?.observed).toBe(false);
  });

  it('Quality — 미관측 insufficient, 종합은 worstQuality', () => {
    const q = assessForesightQuality(feedsFixture());
    expect(q.find((e) => e.area === 'risk_domains')?.level).toBe('attention');
    expect(assessForesightQuality(emptyForesightFeeds()).filter((e) => e.level === 'insufficient_data').length).toBe(7);
    expect(worstQuality(['healthy', 'critical', 'attention'])).toBe('critical');
    expect(worstQuality(['insufficient_data'])).toBe('insufficient_data');
  });

  it('요약 5줄 이내 + 미래 단정 금지 문구', () => {
    const lines = buildOutlookSummaryLines({
      operationalTrend: 'flat', revenueForecastObserved: true, criticalRisks: 0, scenarioTotal: 3, expectedCaseCount: 1,
    });
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe('Operational Trend는 안정적입니다.');
    expect(lines[2]).toBe('새로운 Critical Risk는 관측되지 않았습니다.');
    expect(lines[4]).toContain('단정하지 않습니다');
    const none = buildOutlookSummaryLines({ operationalTrend: 'insufficient_data', revenueForecastObserved: false, criticalRisks: null, scenarioTotal: null, expectedCaseCount: null });
    expect(none[1]).toContain('관측되지 않았습니다');
  });

  it('금지 9종 + automatic_* 차단', () => {
    expect(FORESIGHT_BLOCKED_ACTIONS).toHaveLength(9);
    for (const a of FORESIGHT_BLOCKED_ACTIONS) expect(isBlockedForesightAction(a)).toBe(true);
    expect(isBlockedForesightAction('view_forecast')).toBe(false);
  });
});
