/**
 * strategyInnovationCenter — Enterprise E-7 (Strategy & Innovation Center).
 *
 * Strategy/Initiative/Opportunity/Innovation/Roadmap/Business Alignment 을
 * 통합하는 Executive Strategy Layer. 신규 Strategy Engine/Innovation Engine/
 * Roadmap Engine 없음 — 입력은 전부 기존 adminApi wrapper 반환값
 * (AI-OPS-46 Strategy Portfolio · 0524 Roadmap · 0562 Innovation ·
 * 0561 Improvement · 0555 Mission · 0563 Foresight · AI-OPS-44 Performance ·
 * 0503 Executive Recommendation)이며, 이 모듈은 결정적(pure)으로
 * 분류/집계/연결만 수행한다.
 *
 * 원칙:
 *  - AI 는 전략을 결정하지 않는다 — 기존 데이터 기반 후보와 근거를 정리·연결만 한다.
 *  - Strategy/Initiative/Roadmap 은 자동 생성하지 않는다 — 기존 기록 조회 전용.
 *  - 없는 데이터는 추론하지 않는다 — insufficient_data/null 로 표시한다.
 *  - 추세는 E-2 analyzeTrendDirection 재사용(중복 로직 생성 금지).
 */
import { clampScore } from './aiMemory';
import { analyzeTrendDirection, type TrendDirection } from './enterpriseIntelligenceHub';

// ── 상수 (스펙 1:1) ─────────────────────────────────────────────────────

export const STRATEGY_QUALITY_LEVELS = ['healthy', 'attention', 'critical', 'insufficient_data'] as const;
export type StrategyQuality = (typeof STRATEGY_QUALITY_LEVELS)[number];

export const INITIATIVE_BUCKETS = ['active', 'planned', 'completed', 'deferred'] as const;
export type InitiativeBucket = (typeof INITIATIVE_BUCKETS)[number];

export const ALIGNMENT_GOALS = ['business', 'operational', 'technology', 'financial', 'governance'] as const;
export type AlignmentGoal = (typeof ALIGNMENT_GOALS)[number];

export const STRATEGY_RELATIONSHIP_FLOW = ['knowledge', 'performance', 'opportunity', 'initiative', 'strategy', 'enterprise'] as const;
export type StrategyStage = (typeof STRATEGY_RELATIONSHIP_FLOW)[number];

export const STRATEGY_RELATIONSHIP_EDGES: Array<{ from: StrategyStage; to: StrategyStage; via: string }> = [
  { from: 'knowledge', to: 'performance', via: '축적된 기록이 성과 해석의 근거가 된다' },
  { from: 'performance', to: 'opportunity', via: '성과 관측이 기회/개선 후보를 드러낸다' },
  { from: 'opportunity', to: 'initiative', via: '기회가 Initiative 후보로 정리된다(사람이 결정)' },
  { from: 'initiative', to: 'strategy', via: 'Initiative 가 전략 포트폴리오에 배치된다(사람이 승인)' },
  { from: 'strategy', to: 'enterprise', via: '전략이 Enterprise 운영 방향의 기준이 된다' },
];

/** 금지 목록 — 스펙 금지 사항 1:1 (9종). */
export const STRATEGY_BLOCKED_ACTIONS = [
  'automatic_strategy_generation', 'automatic_initiative_generation', 'automatic_roadmap_generation',
  'automatic_approval', 'automatic_contract_approval', 'automatic_payment',
  'automatic_merge', 'automatic_deploy', 'automatic_production_apply',
] as const;

export function isBlockedStrategyAction(action: string): boolean {
  return (STRATEGY_BLOCKED_ACTIONS as readonly string[]).includes(action) || action.startsWith('automatic_');
}

// ── 입력 피드 (기존 wrapper 반환값의 최소 필드) ─────────────────────────

export interface SIPortfolioRow { id: string; portfolio_code: string; portfolio_name: string; portfolio_status: string; initiative_references: unknown[] }
export interface SIRoadmapRow { id: string; roadmap_code: string; title: string; roadmap_phase: string; review_status: string }
export interface SIInnovationRow {
  id: string; innovation_code: string; innovation_name: string; innovation_category: string;
  innovation_status: string; opportunity_status: string; risk_status: string; created_at: string;
}
export interface SIImprovementRow {
  id: string; improvement_code: string; improvement_name: string; improvement_category: string;
  improvement_status: string; created_at: string;
}
export interface SIMissionRow { id: string; mission_code: string; mission_name: string; mission_category: string; mission_status: string }
export interface SIForesightRow { id: string; foresight_code: string; foresight_name: string; foresight_status: string; opportunity_status: string }
export interface SIExecRecoRow { id: string; rec_code: string; title: string; status: string }

export interface StrategyFeeds {
  portfolios: SIPortfolioRow[] | null;      // fetchStrategyPortfolios (AI-OPS-46)
  roadmapItems: SIRoadmapRow[] | null;      // fetchRoadmapItems (0524)
  innovations: SIInnovationRow[] | null;    // fetchEnterpriseInnovations (0562)
  improvements: SIImprovementRow[] | null;  // fetchEnterpriseImprovements (0561)
  missions: SIMissionRow[] | null;          // fetchEnterpriseMissions (0555)
  foresights: SIForesightRow[] | null;      // fetchEnterpriseForesights (0563)
  performance: Record<string, unknown> | null; // fetchEnterprisePerformanceSummary (AI-OPS-44, loose)
  execRecommendations: SIExecRecoRow[] | null; // fetchExecRecommendations (0503)
}

export function emptyStrategyFeeds(): StrategyFeeds {
  return {
    portfolios: null, roadmapItems: null, innovations: null, improvements: null,
    missions: null, foresights: null, performance: null, execRecommendations: null,
  };
}

// ── Initiative Center — 기존 상태값을 스펙 4버킷으로 분류만 ──────────────

const ACTIVE_HINTS = ['active', 'in_progress', 'executing', 'running'];
const PLANNED_HINTS = ['draft', 'proposed', 'candidate', 'planned', 'observed', 'discovered', 'identified'];
const COMPLETED_HINTS = ['completed', 'done', 'archived', 'review_reference', 'resolved'];
const DEFERRED_HINTS = ['deferred', 'hold', 'paused', 'insufficient'];

/** 실측 상태 문자열 → 스펙 버킷 결정적 매핑 — 매핑 불가는 other 로 정직 공개. */
export function mapStatusToBucket(status: string): InitiativeBucket | 'other' {
  const s = status.toLowerCase();
  if (ACTIVE_HINTS.some((h) => s.includes(h))) return 'active';
  if (COMPLETED_HINTS.some((h) => s.includes(h))) return 'completed';
  if (DEFERRED_HINTS.some((h) => s.includes(h))) return 'deferred';
  if (PLANNED_HINTS.some((h) => s.includes(h))) return 'planned';
  return 'other';
}

export function bucketizeInitiatives(rows: Array<{ status: string }> | null): {
  buckets: Array<{ bucket: InitiativeBucket; count: number | null }>;
  otherStatuses: Array<{ status: string; count: number }>;
  total: number | null;
} {
  if (rows == null) {
    return { buckets: INITIATIVE_BUCKETS.map((bucket) => ({ bucket, count: null })), otherStatuses: [], total: null };
  }
  const counts = new Map<InitiativeBucket | 'other', number>();
  const otherMap = new Map<string, number>();
  for (const r of rows) {
    const b = mapStatusToBucket(r.status);
    counts.set(b, (counts.get(b) ?? 0) + 1);
    if (b === 'other') otherMap.set(r.status, (otherMap.get(r.status) ?? 0) + 1);
  }
  return {
    buckets: INITIATIVE_BUCKETS.map((bucket) => ({ bucket, count: counts.get(bucket) ?? 0 })),
    otherStatuses: [...otherMap.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => a.status.localeCompare(b.status)),
    total: rows.length,
  };
}

// ── Innovation Center — 기존 원장 분류만 (엔진 없음) ─────────────────────

export function summarizeInnovation(feeds: StrategyFeeds): {
  innovationCandidates: number | null;
  improvementOpportunities: number | null;
  byImprovementCategory: Array<{ category: string; count: number }>;
  highRiskInnovations: number | null;
} {
  return {
    innovationCandidates: feeds.innovations == null ? null : feeds.innovations.length,
    improvementOpportunities: feeds.improvements == null ? null : feeds.improvements.length,
    byImprovementCategory: feeds.improvements == null ? [] : [...feeds.improvements
      .reduce((m, r) => m.set(r.improvement_category, (m.get(r.improvement_category) ?? 0) + 1), new Map<string, number>())
      .entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category)),
    highRiskInnovations: feeds.innovations == null ? null : feeds.innovations.filter((r) => r.risk_status.toLowerCase().includes('high')).length,
  };
}

// ── Business Alignment — 기존 Mission 카테고리 연결만 ────────────────────

export function summarizeAlignment(missions: SIMissionRow[] | null): {
  goals: Array<{ goal: AlignmentGoal; count: number | null; note: string }>;
  otherCategories: Array<{ category: string; count: number }>;
  mappedGoalCount: number | null;
  alignmentPct: number | null;
} {
  if (missions == null) {
    return {
      goals: ALIGNMENT_GOALS.map((goal) => ({ goal, count: null, note: 'Mission 피드 미관측' })),
      otherCategories: [], mappedGoalCount: null, alignmentPct: null,
    };
  }
  const counts = new Map<string, number>();
  for (const m of missions) counts.set(m.mission_category, (counts.get(m.mission_category) ?? 0) + 1);
  const goalSet = new Set<string>(ALIGNMENT_GOALS);
  const goals = ALIGNMENT_GOALS.map((goal) => {
    const c = counts.get(goal);
    return c != null
      ? { goal, count: c, note: '실측 mission_category 일치' }
      : { goal, count: 0, note: '해당 카테고리 Mission 없음(관측 창 내)' };
  });
  const mapped = goals.filter((g) => (g.count ?? 0) > 0).length;
  return {
    goals,
    otherCategories: [...counts.entries()].filter(([c]) => !goalSet.has(c))
      .map(([category, count]) => ({ category, count })).sort((a, b) => a.category.localeCompare(b.category)),
    mappedGoalCount: mapped,
    alignmentPct: clampScore((mapped / ALIGNMENT_GOALS.length) * 100),
  };
}

// ── Roadmap Center — 기존 0524 Roadmap 조회만 (자동 생성 없음) ───────────

export function summarizeRoadmap(items: SIRoadmapRow[] | null): {
  buckets: Array<{ bucket: 'active' | 'planned' | 'completed' | 'delayed'; count: number | null; note: string }>;
  byPhase: Array<{ phase: string; count: number }>;
  progressPct: number | null;
  total: number | null;
} {
  if (items == null) {
    return {
      buckets: [
        { bucket: 'active', count: null, note: 'Roadmap 피드 미관측' },
        { bucket: 'planned', count: null, note: 'Roadmap 피드 미관측' },
        { bucket: 'completed', count: null, note: 'Roadmap 피드 미관측' },
        { bucket: 'delayed', count: null, note: 'Roadmap 피드 미관측' },
      ],
      byPhase: [], progressPct: null, total: null,
    };
  }
  const bucketOf = (r: SIRoadmapRow): 'active' | 'planned' | 'completed' | 'other' => {
    const p = `${r.roadmap_phase} ${r.review_status}`.toLowerCase();
    if (COMPLETED_HINTS.some((h) => p.includes(h))) return 'completed';
    if (ACTIVE_HINTS.some((h) => p.includes(h)) || p.includes('approved')) return 'active';
    if (PLANNED_HINTS.some((h) => p.includes(h)) || p.includes('pending')) return 'planned';
    return 'other';
  };
  const counts = new Map<string, number>();
  const phaseMap = new Map<string, number>();
  for (const r of items) {
    counts.set(bucketOf(r), (counts.get(bucketOf(r)) ?? 0) + 1);
    phaseMap.set(r.roadmap_phase, (phaseMap.get(r.roadmap_phase) ?? 0) + 1);
  }
  const completed = counts.get('completed') ?? 0;
  return {
    buckets: [
      { bucket: 'active', count: counts.get('active') ?? 0, note: 'phase/review 상태 매핑(실측)' },
      { bucket: 'planned', count: counts.get('planned') ?? 0, note: 'phase/review 상태 매핑(실측)' },
      { bucket: 'completed', count: completed, note: 'phase/review 상태 매핑(실측)' },
      { bucket: 'delayed', count: null, note: '지연 판정 필드 부재(실측) — 추론하지 않음' },
    ],
    byPhase: [...phaseMap.entries()].map(([phase, count]) => ({ phase, count })).sort((a, b) => a.phase.localeCompare(b.phase)),
    progressPct: items.length > 0 ? clampScore((completed / items.length) * 100) : null,
    total: items.length,
  };
}

// ── Strategy Relationships ──────────────────────────────────────────────

export function buildStrategyRelationships(feeds: StrategyFeeds): Array<{
  stage: StrategyStage;
  observed: boolean;
  note: string;
}> {
  return STRATEGY_RELATIONSHIP_FLOW.map((stage) => {
    switch (stage) {
      case 'knowledge': return { stage, observed: feeds.improvements != null || feeds.innovations != null, note: '개선/혁신 기록(0561/0562)' };
      case 'performance': return { stage, observed: feeds.performance != null, note: 'Performance Summary(AI-OPS-44)' };
      case 'opportunity': return { stage, observed: feeds.foresights != null || feeds.innovations != null, note: 'Foresight/Innovation 기회(0563/0562)' };
      case 'initiative': return { stage, observed: feeds.portfolios != null, note: 'Strategy Portfolio initiative 참조(AI-OPS-46)' };
      case 'strategy': return { stage, observed: feeds.portfolios != null || feeds.roadmapItems != null, note: 'Portfolio/Roadmap(0524)' };
      case 'enterprise': return { stage, observed: feeds.missions != null, note: 'Enterprise Mission(0555)' };
      default: return { stage, observed: false, note: '' };
    }
  });
}

// ── Strategy Overview (최상단 카드 8필드) ───────────────────────────────

export interface StrategyOverviewCard {
  strategicHealth: StrategyQuality;
  activeInitiatives: number | null;
  innovationStatus: number | null;      // 관측된 Innovation 후보 수
  roadmapProgressPct: number | null;
  businessAlignmentPct: number | null;
  executiveFocus: number | null;        // 0503 제안(proposed) 수
  strategicRisks: number | null;        // risk_status 에 'high' 포함 건수
  strategicOpportunities: number | null;
}

export function buildStrategyOverview(feeds: StrategyFeeds): StrategyOverviewCard {
  const initiatives = bucketizeInitiatives(feeds.portfolios?.map((p) => ({ status: p.portfolio_status })) ?? null);
  const innovation = summarizeInnovation(feeds);
  const roadmap = summarizeRoadmap(feeds.roadmapItems);
  const alignment = summarizeAlignment(feeds.missions);
  const quality = assessStrategyQuality(feeds);
  const opportunities = feeds.foresights == null && feeds.innovations == null
    ? null
    : (feeds.foresights?.length ?? 0)
      + (feeds.innovations?.filter((r) => r.opportunity_status.toLowerCase().includes('opportunit') || r.opportunity_status.toLowerCase().includes('high')).length ?? 0);
  return {
    strategicHealth: overallStrategyQuality(quality),
    activeInitiatives: initiatives.buckets.find((b) => b.bucket === 'active')?.count ?? null,
    innovationStatus: innovation.innovationCandidates,
    roadmapProgressPct: roadmap.progressPct,
    businessAlignmentPct: alignment.alignmentPct,
    executiveFocus: feeds.execRecommendations == null ? null : feeds.execRecommendations.filter((r) => r.status === 'proposed').length,
    strategicRisks: innovation.highRiskInnovations,
    strategicOpportunities: opportunities,
  };
}

// ── Strategy Analytics ──────────────────────────────────────────────────

export interface StrategyAnalytics {
  initiativeProgressPct: number | null; // active/total
  completionRatePct: number | null;     // completed/total
  delayedItems: number | null;          // 지연 판정 피드 부재 — null
  improvementTrend: TrendDirection;
  opportunityCount: number | null;
  strategicAlignmentPct: number | null;
}

/** created_at 을 일 단위로 집계해 관측 구간 내 추세만 계산 (E-2 로직 재사용, 예측 없음). */
export function improvementDailySeries(rows: Array<{ created_at: string }> | null): Array<number | null> {
  if (rows == null || rows.length === 0) return [];
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const day = r.created_at.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, c]) => c);
}

export function computeStrategyAnalytics(feeds: StrategyFeeds): StrategyAnalytics {
  const initiatives = bucketizeInitiatives(feeds.portfolios?.map((p) => ({ status: p.portfolio_status })) ?? null);
  const active = initiatives.buckets.find((b) => b.bucket === 'active')?.count ?? null;
  const completed = initiatives.buckets.find((b) => b.bucket === 'completed')?.count ?? null;
  const overview = summarizeAlignment(feeds.missions);
  const opportunities = feeds.foresights == null ? null : feeds.foresights.length;
  return {
    initiativeProgressPct: initiatives.total != null && initiatives.total > 0 && active != null ? clampScore((active / initiatives.total) * 100) : null,
    completionRatePct: initiatives.total != null && initiatives.total > 0 && completed != null ? clampScore((completed / initiatives.total) * 100) : null,
    delayedItems: null, // 지연 판정 필드 부재(실측) — 추론하지 않음
    improvementTrend: analyzeTrendDirection(improvementDailySeries(feeds.improvements)).direction,
    opportunityCount: opportunities,
    strategicAlignmentPct: overview.alignmentPct,
  };
}

// ── Strategy Quality (Healthy/Attention/Critical/Insufficient Data) ─────

export interface StrategyQualityEntry {
  area: string;
  level: StrategyQuality;
  note: string;
}

const HIGH_RISK_CRITICAL_THRESHOLD = 5;

export function assessStrategyQuality(feeds: StrategyFeeds): StrategyQualityEntry[] {
  const listArea = (area: string, rows: unknown[] | null): StrategyQualityEntry => {
    if (rows == null) return { area, level: 'insufficient_data', note: '피드 미관측 — 추론하지 않음' };
    if (rows.length === 0) return { area, level: 'attention', note: '관측 창 내 기록 0건' };
    return { area, level: 'healthy', note: `${rows.length}건 관측` };
  };
  const out: StrategyQualityEntry[] = [
    listArea('initiatives_portfolio', feeds.portfolios),
    listArea('roadmap_0524', feeds.roadmapItems),
    listArea('innovations_0562', feeds.innovations),
    listArea('improvements_0561', feeds.improvements),
    listArea('missions_0555', feeds.missions),
    listArea('foresights_0563', feeds.foresights),
  ];
  // 위험 영역 — high 위험 건수 기반 (부재 시 insufficient)
  if (feeds.innovations == null) out.push({ area: 'strategic_risks', level: 'insufficient_data', note: 'Innovation 위험 피드 미관측' });
  else {
    const high = feeds.innovations.filter((r) => r.risk_status.toLowerCase().includes('high')).length;
    out.push(high >= HIGH_RISK_CRITICAL_THRESHOLD
      ? { area: 'strategic_risks', level: 'critical', note: `high 위험 ${high}건(≥${HIGH_RISK_CRITICAL_THRESHOLD})` }
      : high > 0
        ? { area: 'strategic_risks', level: 'attention', note: `high 위험 ${high}건` }
        : { area: 'strategic_risks', level: 'healthy', note: 'high 위험 0건' });
  }
  return out;
}

const QUALITY_RANK: Record<StrategyQuality, number> = { critical: 0, attention: 1, insufficient_data: 2, healthy: 3 };

/** 종합 = 관측된 영역 중 최악. 전 영역 미관측이면 insufficient_data. */
export function overallStrategyQuality(entries: StrategyQualityEntry[]): StrategyQuality {
  const observed = entries.filter((e) => e.level !== 'insufficient_data');
  if (observed.length === 0) return 'insufficient_data';
  return observed.reduce((worst, e) => (QUALITY_RANK[e.level] < QUALITY_RANK[worst] ? e.level : worst), 'healthy' as StrategyQuality);
}

// ── AI Strategy Summary (5줄 이내 결정적 — 전략 결정 아님) ───────────────

export function buildStrategySummaryLines(input: {
  activeInitiatives: number | null;
  topImprovementCategory: string | null;
  roadmapProgressPct: number | null;
  strategicRisks: number | null;
  opportunityCount: number | null;
}): string[] {
  const lines: string[] = [];
  lines.push(input.activeInitiatives == null ? 'Initiative 현황은 관측되지 않았습니다.' : `현재 핵심 Initiative ${input.activeInitiatives}건이 진행 중입니다.`);
  lines.push(input.topImprovementCategory == null ? '개선 제안 분포는 관측되지 않았습니다.' : `${input.topImprovementCategory} Improvement가 가장 많이 제안되었습니다.`);
  if (input.roadmapProgressPct == null) lines.push('Roadmap 진행률은 관측되지 않았습니다.');
  else lines.push(`Roadmap 완료율은 ${input.roadmapProgressPct}%로 관측됩니다.`);
  if (input.strategicRisks == null) lines.push('Strategic Risk 상태는 관측되지 않았습니다.');
  else if (input.strategicRisks === 0) lines.push('Critical Strategic Risk는 관측되지 않았습니다.');
  else lines.push(`High 위험 항목 ${input.strategicRisks}건 — 사람 검토가 필요합니다.`);
  if (input.opportunityCount != null && input.opportunityCount > 0) lines.push(`장기 기회 기록 ${input.opportunityCount}건이 있습니다.`);
  return lines.slice(0, 5);
}
