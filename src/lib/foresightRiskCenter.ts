/**
 * foresightRiskCenter — Enterprise E-8 (Foresight & Risk Center).
 *
 * Forecast/Risk/Scenario/Trend/Early Warning/Executive Outlook 을 통합하는
 * Executive Foresight Layer. 신규 Forecast Engine/Risk Engine/Scenario Engine
 * 없음 — 입력은 전부 기존 adminApi wrapper 반환값(Revenue Forecast RPC ·
 * AI-OPS-39 Forecast Intel · 0528 Risk · 0516 Strategic Scenario ·
 * 0496 Governance · NOC/Streaming/Revenue/Settlement/Artist 관측 피드)이며,
 * 이 모듈은 결정적(pure)으로 연결/분류/요약만 수행한다.
 *
 * 원칙:
 *  - AI 는 미래를 단정하지 않는다 — 기존 Forecast/Risk 를 연결·설명·우선순위만.
 *  - Forecast/Risk/Scenario 는 자동 생성하지 않는다 — 기존 기록 조회 전용.
 *  - Early Warning 은 E-1 deriveExecutiveAlerts 재사용, Trend 는 E-2
 *    analyzeTrendDirection 재사용(중복 로직 생성 금지).
 *  - 없는 데이터는 추론하지 않는다 — insufficient_data/null 로 표시한다.
 */
import {
  deriveExecutiveAlerts, emptyExecutiveFeeds, numAt,
  type ExecutiveAlert, type FeedRecord,
} from './executiveCommandCenter';
import { analyzeTrendDirection, seriesOf, type TrendDirection } from './enterpriseIntelligenceHub';

// ── 상수 (스펙 1:1) ─────────────────────────────────────────────────────

export const FORESIGHT_QUALITY_LEVELS = ['healthy', 'attention', 'critical', 'insufficient_data'] as const;
export type ForesightQuality = (typeof FORESIGHT_QUALITY_LEVELS)[number];

export const FORECAST_KINDS = ['revenue', 'resource', 'capacity', 'operational', 'executive'] as const;
export type ForecastKind = (typeof FORECAST_KINDS)[number];

export const RISK_DOMAINS = ['operational', 'financial', 'governance', 'security', 'strategic'] as const;
export type RiskDomain = (typeof RISK_DOMAINS)[number];

export const SCENARIO_CASES = ['best_case', 'expected_case', 'worst_case', 'unknown'] as const;
export type ScenarioCase = (typeof SCENARIO_CASES)[number];

export const TREND_AREAS = ['business', 'operational', 'financial', 'performance', 'strategic'] as const;
export type TrendArea = (typeof TREND_AREAS)[number];

export const FORESIGHT_RELATIONSHIP_FLOW = ['performance', 'trend', 'forecast', 'risk', 'scenario', 'executive_outlook'] as const;
export type ForesightStage = (typeof FORESIGHT_RELATIONSHIP_FLOW)[number];

export const FORESIGHT_RELATIONSHIP_EDGES: Array<{ from: ForesightStage; to: ForesightStage; via: string }> = [
  { from: 'performance', to: 'trend', via: '성과 관측이 추세 해석의 입력이 된다' },
  { from: 'trend', to: 'forecast', via: '추세가 기존 Forecast 의 참조 근거가 된다' },
  { from: 'forecast', to: 'risk', via: 'Forecast 와 실측의 차이가 위험 신호로 검토된다(사람이 판단)' },
  { from: 'risk', to: 'scenario', via: '위험이 기존 Scenario 비교의 입력이 된다' },
  { from: 'scenario', to: 'executive_outlook', via: 'Scenario 참조가 경영진 전망 논의의 근거가 된다' },
];

/** 금지 목록 — 스펙 금지 사항 1:1 (9종). */
export const FORESIGHT_BLOCKED_ACTIONS = [
  'automatic_forecast_generation', 'automatic_risk_generation', 'automatic_scenario_generation',
  'automatic_approval', 'automatic_contract_approval', 'automatic_payment',
  'automatic_merge', 'automatic_deploy', 'automatic_production_apply',
] as const;

export function isBlockedForesightAction(action: string): boolean {
  return (FORESIGHT_BLOCKED_ACTIONS as readonly string[]).includes(action) || action.startsWith('automatic_');
}

// ── 입력 피드 ───────────────────────────────────────────────────────────

export interface FRScenarioRow {
  id: string; scenario_code: string; scenario_name: string; scenario_type: string;
  scenario_status: string; confidence: number | null;
}

export interface ForesightFeeds {
  revenueForecast: FeedRecord | null;    // fetchRevenueForecast (typed RPC)
  revenueTrend: FeedRecord | null;       // fetchRevenueTrend('30d')
  businessGrowth: FeedRecord | null;     // fetchBusinessGrowth('30d')
  streamingTimeline: FeedRecord | null;  // fetchStreamingTimeline('30d')
  noc: FeedRecord | null;                // fetchNocKpi
  streaming: FeedRecord | null;          // fetchStreamingSummary
  revenue: FeedRecord | null;            // fetchRevenueSummary
  settlementKpi: FeedRecord | null;      // fetchReadableSettlementKpi
  artist: FeedRecord | null;             // fetchArtistSummary
  forecastIntel: FeedRecord | null;      // fetchForecastIntelSummary (AI-OPS-39, loose)
  riskSummary: FeedRecord | null;        // fetchRiskSummary (0528, loose)
  scenarios: FRScenarioRow[] | null;     // fetchStratScenarios (0516)
  govEvents: { violations: number; overrides: number; checks: number } | null; // fetchGovernanceSummary().events (0496)
  performance: FeedRecord | null;        // fetchEnterprisePerformanceSummary (AI-OPS-44, loose)
}

export function emptyForesightFeeds(): ForesightFeeds {
  return {
    revenueForecast: null, revenueTrend: null, businessGrowth: null, streamingTimeline: null,
    noc: null, streaming: null, revenue: null, settlementKpi: null, artist: null,
    forecastIntel: null, riskSummary: null, scenarios: null, govEvents: null, performance: null,
  };
}

// ── Forecast Center — 기존 Forecast 조회만 (생성 없음) ───────────────────

export interface ForecastEntry {
  kind: ForecastKind;
  observed: boolean;
  value: number | null;
  note: string;
}

export function summarizeForecasts(feeds: ForesightFeeds): ForecastEntry[] {
  const rev = feeds.revenueForecast;
  return [
    {
      kind: 'revenue',
      observed: rev != null,
      value: numAt(rev, 'projected_month_revenue'),
      note: rev == null ? 'Revenue Forecast RPC 미관측' : 'admin_revenue_forecast 관측값 — 추정 ≠ 확정 매출',
    },
    { kind: 'resource', observed: false, value: null, note: '전용 Resource Forecast 원장 부재(실측) — 추론하지 않음' },
    { kind: 'capacity', observed: false, value: null, note: '전용 Capacity Forecast 원장 부재(실측) — 추론하지 않음' },
    {
      kind: 'operational',
      observed: feeds.forecastIntel != null,
      value: null,
      note: feeds.forecastIntel == null ? 'AI-OPS-39 Forecast Intel 미관측' : 'AI-OPS-39 Forecast Intel 관측됨(세부는 해당 센터 참조) — 값 재계산 없음',
    },
    {
      kind: 'executive',
      observed: rev != null,
      value: numAt(rev, 'arr_forecast'),
      note: rev == null ? 'ARR Forecast 미관측' : 'ARR 추정 ≠ 확정 — 기존 RPC 값 그대로',
    },
  ];
}

// ── Risk Center — 기존 Risk 연결만 (재계산 없음) ─────────────────────────

export interface RiskEntry {
  domain: RiskDomain;
  indicator: number | null;
  level: ForesightQuality;
  note: string;
}

export function summarizeRisks(feeds: ForesightFeeds): RiskEntry[] {
  const out: RiskEntry[] = [];

  // operational — 미복구 Incident (NOC 관측값)
  const incidents = numAt(feeds.noc, 'today_incidents');
  const recovered = numAt(feeds.noc, 'today_recovered');
  if (incidents == null || recovered == null) out.push({ domain: 'operational', indicator: null, level: 'insufficient_data', note: 'NOC 피드 미관측' });
  else {
    const open = Math.max(0, incidents - recovered);
    out.push({ domain: 'operational', indicator: open, level: open > 0 ? 'attention' : 'healthy', note: open > 0 ? `미복구 Incident ${open}건` : '오늘 미복구 Incident 없음' });
  }

  // financial — Settlement 보류/검증 실패
  const held = numAt(feeds.settlementKpi, 'held_count');
  const verif = numAt(feeds.settlementKpi, 'verification_failed_count');
  if (held == null && verif == null) out.push({ domain: 'financial', indicator: null, level: 'insufficient_data', note: 'Settlement KPI 미관측' });
  else {
    const n = (held ?? 0) + (verif ?? 0);
    out.push({ domain: 'financial', indicator: n, level: n > 0 ? 'attention' : 'healthy', note: n > 0 ? `보류/검증 실패 ${n}건` : '보류/검증 실패 0건' });
  }

  // governance — Constitution 위반 (0496)
  if (feeds.govEvents == null) out.push({ domain: 'governance', indicator: null, level: 'insufficient_data', note: 'Governance 이벤트 미관측' });
  else {
    const v = feeds.govEvents.violations;
    out.push({ domain: 'governance', indicator: v, level: v > 0 ? 'critical' : 'healthy', note: v > 0 ? `위반 ${v}건` : '위반 0건' });
  }

  // security — 이 화면에 연결된 실시간 보안 위험 피드 없음 (조작 금지)
  out.push({ domain: 'security', indicator: null, level: 'insufficient_data', note: '보안 실시간 위험 피드 미연결(실측) — 추론하지 않음' });

  // strategic — 0528 Risk 원장 관측 여부 (값 재계산 없음)
  out.push(feeds.riskSummary == null
    ? { domain: 'strategic', indicator: null, level: 'insufficient_data', note: '0528 Risk 원장 미관측' }
    : { domain: 'strategic', indicator: null, level: 'attention', note: '0528 Risk 원장 관측됨 — 세부/등급은 Risk Resilience 센터 참조(재계산 없음)' });

  return out;
}

// ── Scenario Center — 기존 0516 Scenario 표시만 (자동 생성 없음) ─────────

/** 실측 scenario_type → 스펙 4케이스 결정적 매핑 (매핑 근거 substring). */
export function mapScenarioCase(scenarioType: string): ScenarioCase {
  const t = scenarioType.toLowerCase();
  if (t.includes('best') || t.includes('optimistic')) return 'best_case';
  if (t.includes('worst') || t.includes('pessimistic') || t.includes('downside')) return 'worst_case';
  if (t.includes('expect') || t.includes('base') || t.includes('likely')) return 'expected_case';
  return 'unknown';
}

export function summarizeScenarios(rows: FRScenarioRow[] | null): {
  cases: Array<{ scenarioCase: ScenarioCase; count: number | null }>;
  actualTypes: Array<{ type: string; count: number }>;
  total: number | null;
} {
  if (rows == null) {
    return { cases: SCENARIO_CASES.map((scenarioCase) => ({ scenarioCase, count: null })), actualTypes: [], total: null };
  }
  const caseCounts = new Map<ScenarioCase, number>();
  const typeCounts = new Map<string, number>();
  for (const r of rows) {
    const c = mapScenarioCase(r.scenario_type);
    caseCounts.set(c, (caseCounts.get(c) ?? 0) + 1);
    typeCounts.set(r.scenario_type, (typeCounts.get(r.scenario_type) ?? 0) + 1);
  }
  return {
    cases: SCENARIO_CASES.map((scenarioCase) => ({ scenarioCase, count: caseCounts.get(scenarioCase) ?? 0 })),
    actualTypes: [...typeCounts.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => a.type.localeCompare(b.type)),
    total: rows.length,
  };
}

// ── Trend Center — E-2 추세 로직 재사용 ─────────────────────────────────

export interface TrendEntry {
  area: TrendArea;
  direction: TrendDirection;
  note: string;
}

export function summarizeTrends(feeds: ForesightFeeds): TrendEntry[] {
  return [
    { area: 'business', direction: analyzeTrendDirection(seriesOf(feeds.revenueTrend, 'revenue')).direction, note: '30d 매출 시계열 전·후반 비교(예측 아님)' },
    { area: 'operational', direction: analyzeTrendDirection(seriesOf(feeds.streamingTimeline, 'streams')).direction, note: '30d 스트림 시계열 전·후반 비교' },
    { area: 'financial', direction: analyzeTrendDirection(seriesOf(feeds.revenueTrend, 'active_subs')).direction, note: '30d 활성 구독 시계열 전·후반 비교' },
    { area: 'performance', direction: 'insufficient_data', note: 'Performance 시계열 피드 부재(실측) — summary 관측 여부만 표시' },
    { area: 'strategic', direction: 'insufficient_data', note: '전략 시계열 피드 부재(실측) — 추론하지 않음' },
  ];
}

// ── Early Warning Center — E-1 Alert 파생 규칙 재사용 ────────────────────

export interface EarlyWarnings {
  criticalAlerts: number | null;
  warningAlerts: number | null;
  trendChanges: number | null;
  forecastDeviations: number | null; // 편차 판정 피드 부재 — null
  riskEscalations: number | null;
  alerts: ExecutiveAlert[];
  unobservedNote: string;
}

export function buildEarlyWarnings(feeds: ForesightFeeds, trends: TrendEntry[]): EarlyWarnings {
  const execFeeds = {
    ...emptyExecutiveFeeds(),
    revenue: feeds.revenue, artist: feeds.artist, streaming: feeds.streaming,
    noc: feeds.noc, settlementKpi: feeds.settlementKpi,
  };
  const derived = deriveExecutiveAlerts(execFeeds);
  const observed = derived.observedCategories.length > 0;
  const measuredTrends = trends.filter((t) => t.direction !== 'insufficient_data');
  return {
    criticalAlerts: observed ? derived.alerts.filter((a) => a.priority === 'critical').length : null,
    warningAlerts: observed ? derived.alerts.filter((a) => a.priority === 'high' || a.priority === 'medium').length : null,
    trendChanges: measuredTrends.length === 0 ? null : measuredTrends.filter((t) => t.direction !== 'flat').length,
    forecastDeviations: null, // Forecast 대비 실측 편차 판정 피드 부재(실측) — 추론하지 않음
    riskEscalations: feeds.govEvents == null ? null : feeds.govEvents.violations,
    alerts: derived.alerts,
    unobservedNote: derived.unobservedCategories.length > 0 ? `미관측 카테고리: ${derived.unobservedCategories.join(', ')}` : '미관측 카테고리 없음',
  };
}

// ── Foresight Relationships ─────────────────────────────────────────────

export function buildForesightRelationships(feeds: ForesightFeeds): Array<{
  stage: ForesightStage;
  observed: boolean;
  note: string;
}> {
  return FORESIGHT_RELATIONSHIP_FLOW.map((stage) => {
    switch (stage) {
      case 'performance': return { stage, observed: feeds.performance != null, note: 'Performance Summary(AI-OPS-44)' };
      case 'trend': return { stage, observed: feeds.revenueTrend != null || feeds.streamingTimeline != null, note: '30d 시계열 피드' };
      case 'forecast': return { stage, observed: feeds.revenueForecast != null || feeds.forecastIntel != null, note: 'Revenue Forecast/AI-OPS-39' };
      case 'risk': return { stage, observed: feeds.riskSummary != null || feeds.govEvents != null, note: '0528 Risk/0496 Governance' };
      case 'scenario': return { stage, observed: feeds.scenarios != null, note: 'Strategic Scenario(0516)' };
      case 'executive_outlook': return { stage, observed: false, note: '통합 전망 계층(이 화면) — 별도 저장소 없음(자동 생성 금지)' };
      default: return { stage, observed: false, note: '' };
    }
  });
}

// ── Foresight Overview (최상단 카드 8필드) ──────────────────────────────

export interface ForesightOverviewCard {
  executiveOutlook: ForesightQuality;
  forecastObserved: number;        // 관측된 Forecast 종류 수 / 5
  riskStatus: ForesightQuality;
  activeWarnings: number | null;
  trendMeasured: number;           // 방향 판정된 Trend 수 / 5
  scenarioCoverage: number | null; // 관측된 Scenario 수
  emergingOpportunities: number | null; // up 방향 추세 수
  emergingRisks: number | null;         // down 방향 추세 + attention 이상 위험 도메인 수
}

const QUALITY_RANK: Record<ForesightQuality, number> = { critical: 0, attention: 1, insufficient_data: 2, healthy: 3 };

export function worstQuality(levels: ForesightQuality[]): ForesightQuality {
  const observed = levels.filter((l) => l !== 'insufficient_data');
  if (observed.length === 0) return 'insufficient_data';
  return observed.reduce((worst, l) => (QUALITY_RANK[l] < QUALITY_RANK[worst] ? l : worst), 'healthy' as ForesightQuality);
}

export function buildForesightOverview(feeds: ForesightFeeds): {
  card: ForesightOverviewCard;
  risks: RiskEntry[];
  trends: TrendEntry[];
  warnings: EarlyWarnings;
} {
  const risks = summarizeRisks(feeds);
  const trends = summarizeTrends(feeds);
  const warnings = buildEarlyWarnings(feeds, trends);
  const forecasts = summarizeForecasts(feeds);
  const scenarios = summarizeScenarios(feeds.scenarios);
  const riskStatus = worstQuality(risks.map((r) => r.level));
  const measured = trends.filter((t) => t.direction !== 'insufficient_data');
  const downTrends = measured.filter((t) => t.direction === 'down').length;
  const attentionRisks = risks.filter((r) => r.level === 'attention' || r.level === 'critical').length;
  const outlookInputs: ForesightQuality[] = [
    riskStatus,
    warnings.criticalAlerts == null ? 'insufficient_data' : warnings.criticalAlerts > 0 ? 'critical' : 'healthy',
    measured.length === 0 ? 'insufficient_data' : downTrends > 0 ? 'attention' : 'healthy',
  ];
  return {
    card: {
      executiveOutlook: worstQuality(outlookInputs),
      forecastObserved: forecasts.filter((f) => f.observed).length,
      riskStatus,
      activeWarnings: warnings.criticalAlerts == null || warnings.warningAlerts == null ? null : warnings.criticalAlerts + warnings.warningAlerts,
      trendMeasured: measured.length,
      scenarioCoverage: scenarios.total,
      emergingOpportunities: measured.length === 0 ? null : measured.filter((t) => t.direction === 'up').length,
      emergingRisks: measured.length === 0 && risks.every((r) => r.level === 'insufficient_data') ? null : downTrends + attentionRisks,
    },
    risks, trends, warnings,
  };
}

// ── Foresight Quality ───────────────────────────────────────────────────

export interface ForesightQualityEntry {
  area: string;
  level: ForesightQuality;
  note: string;
}

export function assessForesightQuality(feeds: ForesightFeeds): ForesightQualityEntry[] {
  const feedArea = (area: string, observed: boolean): ForesightQualityEntry =>
    observed
      ? { area, level: 'healthy', note: '관측됨' }
      : { area, level: 'insufficient_data', note: '피드 미관측 — 추론하지 않음' };
  const risks = summarizeRisks(feeds);
  const riskLevel = worstQuality(risks.map((r) => r.level));
  return [
    feedArea('revenue_forecast_rpc', feeds.revenueForecast != null),
    feedArea('forecast_intel_ai_ops_39', feeds.forecastIntel != null),
    feedArea('risk_ledger_0528', feeds.riskSummary != null),
    feedArea('scenarios_0516', feeds.scenarios != null),
    feedArea('trend_series_30d', feeds.revenueTrend != null || feeds.streamingTimeline != null),
    feedArea('performance_summary', feeds.performance != null),
    { area: 'risk_domains', level: riskLevel, note: `위험 도메인 종합(관측 영역 최악): ${riskLevel}` },
  ];
}

// ── Executive Outlook Summary (5줄 이내 결정적 — 미래 단정 금지) ─────────

export function buildOutlookSummaryLines(input: {
  operationalTrend: TrendDirection;
  revenueForecastObserved: boolean;
  criticalRisks: number | null;
  scenarioTotal: number | null;
  expectedCaseCount: number | null;
}): string[] {
  const lines: string[] = [];
  const dirText: Record<TrendDirection, string> = {
    up: '상승 방향으로 관측됩니다', down: '하락 방향으로 관측됩니다', flat: '안정적입니다',
    insufficient_data: '표본이 부족해 방향을 판정하지 않습니다',
  };
  lines.push(`Operational Trend는 ${dirText[input.operationalTrend]}.`);
  lines.push(input.revenueForecastObserved
    ? 'Revenue Forecast는 기존 RPC 관측값 기준으로 유지되고 있습니다.'
    : 'Revenue Forecast는 관측되지 않았습니다.');
  if (input.criticalRisks == null) lines.push('Critical Risk 상태는 관측되지 않았습니다.');
  else if (input.criticalRisks === 0) lines.push('새로운 Critical Risk는 관측되지 않았습니다.');
  else lines.push(`Critical Risk ${input.criticalRisks}건 — 사람 검토가 필요합니다.`);
  if (input.scenarioTotal == null) lines.push('Scenario 기록은 관측되지 않았습니다.');
  else if (input.expectedCaseCount != null && input.expectedCaseCount > 0) lines.push(`Scenario는 Expected Case ${input.expectedCaseCount}건을 포함해 ${input.scenarioTotal}건이 기록되어 있습니다.`);
  else lines.push(`Scenario 기록 ${input.scenarioTotal}건이 있습니다.`);
  lines.push('본 요약은 관측값 연결이며 미래를 단정하지 않습니다.');
  return lines.slice(0, 5);
}
