/**
 * unifiedExecutiveOS — Enterprise E-10 (Unified Executive AI Operating System).
 *
 * E-1~E-9 Executive Layer(Command/Intelligence/Decision/Governance/Knowledge/
 * Performance/Strategy/Foresight/Resilience)를 하나의 운영체계로 통합하는
 * 최상위 계층. 신규 Executive Engine/AI Engine/Agent/Knowledge Store/
 * Timeline Engine 없음 — 입력은 전부 기존 adminApi wrapper 반환값이며,
 * 계산은 기존 E-계층 모듈 함수(E-1 Alert/Timeline · E-2 Trend ·
 * E-3 Decision Analytics · E-5 Knowledge Overview · E-7 일 단위 집계 ·
 * E-8 worstQuality)를 재사용한다.
 *
 * 원칙:
 *  - AI 는 결정을 내리지 않는다 — 요약·연결·우선순위 제안만. 최종 결정은 사람.
 *  - 없는 데이터는 추론하지 않는다 — insufficient_data/null 로 표시한다.
 *  - Enterprise Score 는 관측된 Layer 의 등급 환산 평균이며, 관측 Layer <5 이면
 *    산출하지 않는다(과단정 방지). Score ≠ 실제 기업 상태 보장.
 */
import { clampScore } from './aiMemory';
import {
  deriveExecutiveAlerts, emptyExecutiveFeeds, mergeExecutiveTimeline,
  type FeedRecord,
} from './executiveCommandCenter';
import { analyzeTrendDirection, seriesOf, type TrendDirection } from './enterpriseIntelligenceHub';
import { summarizeDecisionAnalytics, type DecisionAuditRow } from './decisionReviewCenter';
import { buildKnowledgeOverview, emptyKnowledgeFeeds } from './enterpriseKnowledgeHub';
import { improvementDailySeries } from './strategyInnovationCenter';
import { worstQuality, type ForesightQuality } from './foresightRiskCenter';

// ── 상수 (스펙 1:1) ─────────────────────────────────────────────────────

export type OsQuality = ForesightQuality; // healthy/attention/critical/insufficient_data (E-8 재사용)

export const EXECUTIVE_LAYERS = [
  'command', 'intelligence', 'decision', 'governance', 'knowledge',
  'performance', 'strategy', 'foresight', 'resilience',
] as const;
export type ExecutiveLayer = (typeof EXECUTIVE_LAYERS)[number];

export const OS_RELATIONSHIP_FLOW = [...EXECUTIVE_LAYERS, 'enterprise'] as const;
export type OsStage = (typeof OS_RELATIONSHIP_FLOW)[number];

export const OS_RELATIONSHIP_EDGES: Array<{ from: OsStage; to: OsStage; via: string }> = [
  { from: 'command', to: 'intelligence', via: '통합 관측이 데이터 연결 계층의 입력이 된다' },
  { from: 'intelligence', to: 'decision', via: '연결된 데이터가 사람의 결정 근거가 된다' },
  { from: 'decision', to: 'governance', via: '결정은 정책 부합 확인과 감사를 거친다' },
  { from: 'governance', to: 'knowledge', via: '감사 기록이 조직 지식으로 축적된다' },
  { from: 'knowledge', to: 'performance', via: '축적된 기록이 성과 해석의 근거가 된다' },
  { from: 'performance', to: 'strategy', via: '성과 관측이 전략 후보 정리의 입력이 된다' },
  { from: 'strategy', to: 'foresight', via: '전략 참조가 전망/위험 검토의 입력이 된다' },
  { from: 'foresight', to: 'resilience', via: '위험 신호가 복원력 검토의 입력이 된다' },
  { from: 'resilience', to: 'enterprise', via: '복원력 관측이 Enterprise 운영 판단의 근거가 된다(결정은 사람)' },
];

/** 금지 목록 — 스펙 금지 사항 1:1 (9종). */
export const OS_BLOCKED_ACTIONS = [
  'automatic_executive_decision', 'automatic_strategy_generation', 'automatic_governance_approval',
  'automatic_contract_approval', 'automatic_payment', 'automatic_recovery_execution',
  'automatic_merge', 'automatic_deploy', 'automatic_production_apply',
] as const;

export function isBlockedOsAction(action: string): boolean {
  return (OS_BLOCKED_ACTIONS as readonly string[]).includes(action) || action.startsWith('automatic_');
}

/** 요약 마지막 줄 — 스펙 고정 문구. */
export const OS_SUMMARY_FIXED_LINE = '본 요약은 기존 관측 데이터를 연결한 결과이며 AI가 Enterprise를 운영하거나 의사결정을 대신하지 않습니다.';

// ── 입력 피드 (기존 wrapper 반환값 — 대표 피드 14종) ─────────────────────

export interface OsIncidentRow { id: string; incident_code: string; incident_type: string; detected_at: string; resolved_at: string | null }
export interface OsRecoveryRow { id: string; recovery_code: string; status: string; outcome: string; created_at: string }
export interface OsPortfolioRow { id: string; portfolio_code: string; portfolio_status: string }
export interface OsActionRow extends DecisionAuditRow {
  id: string; requested_at?: string | null; target_type?: string;
}

export interface OsFeeds {
  actionHistory: OsActionRow[] | null;   // fetchActionHistory (0479)
  noc: FeedRecord | null;                // fetchNocKpi
  streaming: FeedRecord | null;          // fetchStreamingSummary
  revenue: FeedRecord | null;            // fetchRevenueSummary
  revenueTrend: FeedRecord | null;       // fetchRevenueTrend('30d')
  revenueForecast: FeedRecord | null;    // fetchRevenueForecast
  settlementKpi: FeedRecord | null;      // fetchReadableSettlementKpi
  artist: FeedRecord | null;             // fetchArtistSummary
  govEvents: { violations: number; overrides: number; checks: number } | null; // 0496
  incidents: OsIncidentRow[] | null;     // fetchIncidents (0502)
  recoveries: OsRecoveryRow[] | null;    // fetchRecoveryCandidates (0502)
  portfolios: OsPortfolioRow[] | null;   // fetchStrategyPortfolios (AI-OPS-46)
  performance: FeedRecord | null;        // fetchEnterprisePerformanceSummary (AI-OPS-44)
  resilienceSummary: FeedRecord | null;  // fetchEnterpriseResilienceSummary (0564)
}

export const OS_FEED_KEYS = [
  'actionHistory', 'noc', 'streaming', 'revenue', 'revenueTrend', 'revenueForecast',
  'settlementKpi', 'artist', 'govEvents', 'incidents', 'recoveries', 'portfolios',
  'performance', 'resilienceSummary',
] as const;

export function emptyOsFeeds(): OsFeeds {
  return {
    actionHistory: null, noc: null, streaming: null, revenue: null, revenueTrend: null,
    revenueForecast: null, settlementKpi: null, artist: null, govEvents: null,
    incidents: null, recoveries: null, portfolios: null, performance: null, resilienceSummary: null,
  };
}

// ── Layer 상태 평가 (기존 E-계층 규칙 재사용 — 신규 판단 로직 최소) ──────

export interface LayerState {
  layer: ExecutiveLayer;
  level: OsQuality;
  note: string;
}

export function assessLayers(feeds: OsFeeds): LayerState[] {
  const out: LayerState[] = [];

  // command — E-1 Alert 파생 규칙 재사용
  const execFeeds = {
    ...emptyExecutiveFeeds(),
    revenue: feeds.revenue, artist: feeds.artist, streaming: feeds.streaming,
    noc: feeds.noc, settlementKpi: feeds.settlementKpi,
  };
  const alerts = deriveExecutiveAlerts(execFeeds);
  if (alerts.observedCategories.length === 0) out.push({ layer: 'command', level: 'insufficient_data', note: 'E-1 Alert 입력 피드 미관측' });
  else {
    const critical = alerts.alerts.filter((a) => a.priority === 'critical').length;
    const high = alerts.alerts.filter((a) => a.priority === 'high').length;
    out.push({ layer: 'command', level: critical > 0 ? 'critical' : high > 0 ? 'attention' : 'healthy', note: `E-1 Alert ${alerts.alerts.length}건(critical ${critical})` });
  }

  // intelligence — E-2 시계열 피드 관측 여부
  out.push(feeds.revenueTrend == null
    ? { layer: 'intelligence', level: 'insufficient_data', note: '30d 시계열 피드 미관측' }
    : { layer: 'intelligence', level: 'healthy', note: 'E-2 데이터 연결 입력 피드 관측됨' });

  // decision — E-3 Decision Analytics 재사용
  const decisions = summarizeDecisionAnalytics(feeds.actionHistory);
  if (decisions == null) out.push({ layer: 'decision', level: 'insufficient_data', note: '0479 감사 피드 미관측' });
  else out.push({ layer: 'decision', level: decisions.pending > 0 ? 'attention' : 'healthy', note: `결정 ${decisions.totalDecisions}건, 대기 ${decisions.pending}건` });

  // governance — 0496 위반/override
  if (feeds.govEvents == null) out.push({ layer: 'governance', level: 'insufficient_data', note: '0496 이벤트 미관측' });
  else out.push({
    layer: 'governance',
    level: feeds.govEvents.violations > 0 ? 'critical' : feeds.govEvents.overrides > 0 ? 'attention' : 'healthy',
    note: `위반 ${feeds.govEvents.violations} · override ${feeds.govEvents.overrides} · 체크 ${feeds.govEvents.checks}`,
  });

  // knowledge — E-5 Overview 재사용 (부분 피드로 커버리지만)
  const knowledge = buildKnowledgeOverview({
    ...emptyKnowledgeFeeds(),
    actionHistory: feeds.actionHistory,
    incidents: feeds.incidents == null ? null : feeds.incidents.map((i) => ({
      id: i.id, incident_code: i.incident_code, incident_type: i.incident_type, severity: '', status: '',
      detected_at: i.detected_at, resolved_at: i.resolved_at, evidence: [],
    })),
    recoveries: feeds.recoveries == null ? null : feeds.recoveries.map((r) => ({
      id: r.id, recovery_code: r.recovery_code, strategy_type: '', status: r.status, description: null, created_at: r.created_at,
    })),
  });
  out.push(knowledge.totalKnowledge == null
    ? { layer: 'knowledge', level: 'insufficient_data', note: 'E-5 지식 소스 미관측' }
    : { layer: 'knowledge', level: 'healthy', note: `E-5 인덱스 ${knowledge.totalKnowledge}건 · 커버리지 ${knowledge.knowledgeCoveragePct}%(부분 피드)` });

  // performance — AI-OPS-44 summary 관측 여부
  out.push(feeds.performance == null
    ? { layer: 'performance', level: 'insufficient_data', note: 'Performance Summary 미관측' }
    : { layer: 'performance', level: 'healthy', note: 'AI-OPS-44 Summary 관측됨(세부는 해당 센터)' });

  // strategy — Portfolio 원장 관측 여부
  out.push(feeds.portfolios == null
    ? { layer: 'strategy', level: 'insufficient_data', note: 'Strategy Portfolio 미관측' }
    : { layer: 'strategy', level: 'healthy', note: `Portfolio ${feeds.portfolios.length}건 관측` });

  // foresight — Forecast RPC 관측 여부
  out.push(feeds.revenueForecast == null
    ? { layer: 'foresight', level: 'insufficient_data', note: 'Revenue Forecast RPC 미관측' }
    : { layer: 'foresight', level: 'healthy', note: 'Forecast 관측됨(추정 ≠ 확정)' });

  // resilience — 미해결 Incident (E-9 규칙)
  if (feeds.incidents == null && feeds.resilienceSummary == null) out.push({ layer: 'resilience', level: 'insufficient_data', note: 'Incident/0564 피드 미관측' });
  else {
    const open = feeds.incidents?.filter((i) => i.resolved_at == null).length ?? 0;
    out.push({ layer: 'resilience', level: open > 0 ? 'attention' : 'healthy', note: `미해결 Incident ${open}건` });
  }

  return out;
}

// ── Executive Cockpit (최상단 카드 8필드) ───────────────────────────────

export interface OsCockpitCard {
  enterpriseHealth: OsQuality;      // 전 Layer worstQuality
  executiveStatus: OsQuality;       // command layer
  operationalStability: OsQuality;  // resilience layer
  strategicHealth: OsQuality;       // strategy layer
  governanceHealth: OsQuality;      // governance layer
  executiveReadiness: number;       // 관측 Layer 수 / 9
  overallConfidencePct: number;     // 피드 관측 커버리지 — 실제 신뢰도 아님
  enterpriseScore: number | null;   // 관측 Layer 등급 환산 평균 — 관측 <5 이면 null(과단정 방지)
}

const SCORE_OF: Record<Exclude<OsQuality, 'insufficient_data'>, number> = { healthy: 100, attention: 60, critical: 20 };
const MIN_LAYERS_FOR_SCORE = 5;

export function buildCockpit(feeds: OsFeeds): { card: OsCockpitCard; layers: LayerState[] } {
  const layers = assessLayers(feeds);
  const of = (layer: ExecutiveLayer): OsQuality => layers.find((l) => l.layer === layer)?.level ?? 'insufficient_data';
  const observed = layers.filter((l) => l.level !== 'insufficient_data');
  const observedFeeds = OS_FEED_KEYS.filter((k) => feeds[k] != null).length;
  const score = observed.length < MIN_LAYERS_FOR_SCORE
    ? null
    : clampScore(observed.reduce((s, l) => s + SCORE_OF[l.level as Exclude<OsQuality, 'insufficient_data'>], 0) / observed.length);
  return {
    card: {
      enterpriseHealth: worstQuality(layers.map((l) => l.level)),
      executiveStatus: of('command'),
      operationalStability: of('resilience'),
      strategicHealth: of('strategy'),
      governanceHealth: of('governance'),
      executiveReadiness: observed.length,
      overallConfidencePct: clampScore((observedFeeds / OS_FEED_KEYS.length) * 100),
      enterpriseScore: score,
    },
    layers,
  };
}

// ── Unified Executive Timeline — E-1 병합 로직 재사용 ────────────────────

export function buildUnifiedTimeline(feeds: OsFeeds, limit = 60): ReturnType<typeof mergeExecutiveTimeline> {
  const actionRows = feeds.actionHistory ?? [];
  const recent = (feeds.revenue?.recent ?? []) as Array<Record<string, unknown>>;
  return mergeExecutiveTimeline([
    {
      source: 'decision_0479',
      events: actionRows.filter((r) => r.command_type.startsWith('decision_'))
        .map((r) => ({ at: r.requested_at, label: r.command_type, detail: r.status })),
    },
    {
      source: 'executive_0479',
      events: actionRows.filter((r) => r.command_type.startsWith('executive_'))
        .map((r) => ({ at: r.requested_at, label: r.command_type, detail: r.status })),
    },
    {
      source: 'operations_0479',
      events: actionRows.filter((r) => !r.command_type.startsWith('decision_') && !r.command_type.startsWith('executive_'))
        .map((r) => ({ at: r.requested_at, label: r.command_type, detail: r.status })),
    },
    {
      source: 'incident_0502',
      events: (feeds.incidents ?? []).map((i) => ({ at: i.detected_at, label: `incident: ${i.incident_type}`, detail: i.resolved_at == null ? '미해결' : '해결' })),
    },
    {
      source: 'recovery_0502',
      events: (feeds.recoveries ?? []).map((r) => ({ at: r.created_at, label: `recovery: ${r.recovery_code}`, detail: r.outcome })),
    },
    {
      source: 'payment',
      events: Array.isArray(recent) ? recent.map((p) => ({
        at: typeof p.paid_at === 'string' ? p.paid_at : null,
        label: 'subscription payment',
        detail: String(p.subscription_type ?? ''),
      })) : [],
    },
  ], limit);
}

// ── Executive Relationships ─────────────────────────────────────────────

export function buildOsRelationships(feeds: OsFeeds): Array<{ stage: OsStage; observed: boolean; note: string }> {
  const layerStates = assessLayers(feeds);
  return OS_RELATIONSHIP_FLOW.map((stage) => {
    if (stage === 'enterprise') return { stage, observed: false, note: '통합 표시 계층(이 화면) — 별도 저장소 없음(자동 운영 금지)' };
    const l = layerStates.find((s) => s.layer === stage);
    return { stage, observed: l != null && l.level !== 'insufficient_data', note: l?.note ?? '' };
  });
}

// ── Executive Analytics — 기존 Trend 로직 재사용 (7종) ───────────────────

export interface OsTrendEntry {
  area: string;
  direction: TrendDirection;
  note: string;
}

export function computeOsAnalytics(feeds: OsFeeds): OsTrendEntry[] {
  const dailyOf = (rows: Array<{ created_at: string }> | null): TrendDirection =>
    analyzeTrendDirection(improvementDailySeries(rows)).direction;
  return [
    { area: 'enterprise_health', direction: 'insufficient_data', note: 'Health 시계열 저장소 부재(실측) — 신규 저장소를 만들지 않음' },
    { area: 'decision', direction: dailyOf(feeds.actionHistory?.filter((r) => r.command_type.startsWith('decision_')).map((r) => ({ created_at: r.requested_at ?? '' })).filter((r) => r.created_at !== '') ?? null), note: '0479 decision_* 일 단위 집계(E-7 로직 재사용)' },
    { area: 'governance', direction: 'insufficient_data', note: 'Governance 시계열 피드 부재(실측)' },
    { area: 'performance', direction: analyzeTrendDirection(seriesOf(feeds.revenueTrend, 'revenue')).direction, note: '30d 매출 시계열(E-2 로직 재사용, 예측 아님)' },
    { area: 'strategy', direction: 'insufficient_data', note: '전략 시계열 피드 부재(실측)' },
    { area: 'recovery', direction: dailyOf(feeds.incidents?.map((i) => ({ created_at: i.detected_at })) ?? null), note: 'Incident 발생 일 단위 집계(E-9 와 동일 재사용)' },
    { area: 'executive', direction: dailyOf(feeds.actionHistory?.filter((r) => r.command_type.startsWith('executive_')).map((r) => ({ created_at: r.requested_at ?? '' })).filter((r) => r.created_at !== '') ?? null), note: '0479 executive_* 일 단위 집계' },
  ];
}

// ── Executive Summary (5줄 이내 — 마지막 줄 스펙 고정) ───────────────────

export function buildOsSummaryLines(input: {
  enterpriseHealth: OsQuality;
  governanceViolations: number | null;
  openIncidents: number | null;
  performanceTrend: TrendDirection;
}): string[] {
  const lines: string[] = [];
  const healthText: Record<OsQuality, string> = {
    healthy: 'Enterprise는 Healthy 상태입니다.',
    attention: 'Enterprise에 주의가 필요한 Layer가 있습니다.',
    critical: 'Enterprise에 Critical 신호가 있습니다 — 사람 확인이 필요합니다.',
    insufficient_data: 'Enterprise 상태를 판정하기에 관측 데이터가 부족합니다.',
  };
  lines.push(healthText[input.enterpriseHealth]);
  if (input.governanceViolations == null) lines.push('Governance 위반 상태는 관측되지 않았습니다.');
  else if (input.governanceViolations === 0) lines.push('Governance 위반은 관측되지 않았습니다.');
  else lines.push(`Governance 위반 ${input.governanceViolations}건 — 사람 검토가 필요합니다.`);
  if (input.openIncidents == null) lines.push('Recovery 상태는 관측되지 않았습니다.');
  else if (input.openIncidents === 0) lines.push('Recovery는 안정적으로 수행되고 있습니다 (미해결 Incident 0건).');
  else lines.push(`미해결 Incident ${input.openIncidents}건 — 복구 실행 여부는 사람이 결정합니다.`);
  const perfText: Record<TrendDirection, string> = {
    up: 'Performance는 상승 방향으로 관측됩니다.', down: 'Performance는 하락 방향으로 관측됩니다.',
    flat: 'Performance는 유지되고 있습니다.', insufficient_data: 'Performance 추세는 표본이 부족해 판정하지 않습니다.',
  };
  lines.push(perfText[input.performanceTrend]);
  lines.push(OS_SUMMARY_FIXED_LINE);
  return lines.slice(0, 5);
}

// ── Enterprise Quality — Layer 종합 (E-8 worstQuality 재사용) ────────────

export function assessOsQuality(feeds: OsFeeds): { entries: LayerState[]; overall: OsQuality } {
  const entries = assessLayers(feeds);
  return { entries, overall: worstQuality(entries.map((e) => e.level)) };
}
