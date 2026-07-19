/**
 * resilienceRecoveryCenter — Enterprise E-9 (Resilience & Recovery Center).
 *
 * Resilience/Recovery/Continuity/Incident Readiness/Recovery Progress/
 * Operational Stability 를 통합하는 Executive Resilience Layer.
 * 신규 Recovery Engine/Self-Healing Engine/Incident Engine 없음 — 입력은 전부
 * 기존 adminApi wrapper 반환값(0502 Incident/Recovery · NOC KPI ·
 * Self-Healing Summary · 0564 Enterprise Resilience · 0496 Governance ·
 * AI-OPS-44 Performance · Streaming)이며, 이 모듈은 결정적(pure)으로
 * 연결/분류/집계만 수행한다.
 *
 * 원칙:
 *  - AI 는 복구를 실행하지 않는다 — 기존 Recovery 정보를 연결·설명·우선순위 제시만.
 *  - Continuity 를 계산하지 않는다 — 기존 관측값만 표시한다.
 *  - Quality 종합은 E-8 worstQuality, Trend 는 E-2 analyzeTrendDirection +
 *    E-7 improvementDailySeries 재사용(중복 로직 생성 금지).
 *  - 없는 데이터는 추론하지 않는다 — insufficient_data/null 로 표시한다.
 */
import { isFiniteNumber, clampScore } from './aiMemory';
import { numAt, type FeedRecord } from './executiveCommandCenter';
import { analyzeTrendDirection, type TrendDirection } from './enterpriseIntelligenceHub';
import { improvementDailySeries } from './strategyInnovationCenter';
import { worstQuality, type ForesightQuality } from './foresightRiskCenter';

// ── 상수 (스펙 1:1) ─────────────────────────────────────────────────────

export type ResilienceQuality = ForesightQuality; // healthy/attention/critical/insufficient_data (E-8 재사용)

export const RECOVERY_BUCKETS = ['active', 'pending', 'completed', 'failed', 'candidates'] as const;
export type RecoveryBucket = (typeof RECOVERY_BUCKETS)[number];

export const READINESS_AREAS = ['detection', 'monitoring', 'alert', 'recovery', 'governance'] as const;
export type ReadinessArea = (typeof READINESS_AREAS)[number];

export const CONTINUITY_AREAS = ['service', 'business', 'operational', 'executive'] as const;
export type ContinuityArea = (typeof CONTINUITY_AREAS)[number];

export const RECOVERY_RELATIONSHIP_FLOW = ['incident', 'recovery', 'performance', 'continuity', 'resilience', 'executive'] as const;
export type RecoveryStage = (typeof RECOVERY_RELATIONSHIP_FLOW)[number];

export const RECOVERY_RELATIONSHIP_EDGES: Array<{ from: RecoveryStage; to: RecoveryStage; via: string }> = [
  { from: 'incident', to: 'recovery', via: '장애 기록이 복구 후보 검토의 입력이 된다(실행은 사람)' },
  { from: 'recovery', to: 'performance', via: '복구 결과가 성과 관측으로 확인된다' },
  { from: 'performance', to: 'continuity', via: '성과 안정성이 연속성 관측의 근거가 된다' },
  { from: 'continuity', to: 'resilience', via: '연속성 관측이 회복력 분석(0564)의 입력이 된다' },
  { from: 'resilience', to: 'executive', via: '회복력 분석이 경영진 판단의 근거가 된다(결정은 사람)' },
];

/** 금지 목록 — 스펙 금지 사항 1:1 (9종). */
export const RECOVERY_BLOCKED_ACTIONS = [
  'automatic_recovery_execution', 'automatic_incident_resolution', 'automatic_self_healing_execution',
  'automatic_approval', 'automatic_contract_approval', 'automatic_payment',
  'automatic_merge', 'automatic_deploy', 'automatic_production_apply',
] as const;

export function isBlockedRecoveryAction(action: string): boolean {
  return (RECOVERY_BLOCKED_ACTIONS as readonly string[]).includes(action) || action.startsWith('automatic_');
}

// ── 입력 피드 (기존 wrapper 반환값의 최소 필드) ─────────────────────────

export interface RRIncidentRow {
  id: string; incident_code: string; incident_type: string; severity: string; status: string;
  detected_at: string; resolved_at: string | null;
}
export interface RRRecoveryRow {
  id: string; recovery_code: string; strategy_type: string; status: string; outcome: string;
  validation_status: string; recovery_time_estimate_min: number | null; created_at: string;
}

export interface RecoveryFeeds {
  incidents: RRIncidentRow[] | null;      // fetchIncidents (0502)
  recoveries: RRRecoveryRow[] | null;     // fetchRecoveryCandidates (0502)
  noc: FeedRecord | null;                 // fetchNocKpi
  selfHealing: FeedRecord | null;         // fetchSelfHealingSummary (0502)
  resilienceSummary: FeedRecord | null;   // fetchEnterpriseResilienceSummary (0564, loose)
  govEvents: { violations: number; overrides: number; checks: number } | null; // 0496
  performance: FeedRecord | null;         // fetchEnterprisePerformanceSummary (AI-OPS-44, loose)
  streaming: FeedRecord | null;           // fetchStreamingSummary
}

export function emptyRecoveryFeeds(): RecoveryFeeds {
  return {
    incidents: null, recoveries: null, noc: null, selfHealing: null,
    resilienceSummary: null, govEvents: null, performance: null, streaming: null,
  };
}

// ── Recovery Center — 기존 0502 Recovery 조회만 (실행/생성 없음) ─────────

const ACTIVE_HINTS = ['active', 'in_progress', 'executing', 'running', 'approved'];
const PENDING_HINTS = ['pending', 'hold', 'deferred', 'waiting'];
const CANDIDATE_HINTS = ['proposed', 'candidate', 'validated', 'draft'];

/** 실측 status/outcome → 스펙 5버킷 결정적 매핑 — 매핑 불가 상태는 other 공개. */
export function mapRecoveryBucket(row: { status: string; outcome: string }): RecoveryBucket | 'other' {
  const outcome = row.outcome.toLowerCase();
  if (outcome.includes('success')) return 'completed';
  if (outcome.includes('fail')) return 'failed';
  const s = row.status.toLowerCase();
  if (ACTIVE_HINTS.some((h) => s.includes(h))) return 'active';
  if (PENDING_HINTS.some((h) => s.includes(h))) return 'pending';
  if (CANDIDATE_HINTS.some((h) => s.includes(h))) return 'candidates';
  return 'other';
}

export function summarizeRecoveries(rows: RRRecoveryRow[] | null): {
  buckets: Array<{ bucket: RecoveryBucket; count: number | null }>;
  otherStatuses: Array<{ status: string; count: number }>;
  total: number | null;
} {
  if (rows == null) {
    return { buckets: RECOVERY_BUCKETS.map((bucket) => ({ bucket, count: null })), otherStatuses: [], total: null };
  }
  const counts = new Map<RecoveryBucket | 'other', number>();
  const otherMap = new Map<string, number>();
  for (const r of rows) {
    const b = mapRecoveryBucket(r);
    counts.set(b, (counts.get(b) ?? 0) + 1);
    if (b === 'other') otherMap.set(`${r.status}/${r.outcome}`, (otherMap.get(`${r.status}/${r.outcome}`) ?? 0) + 1);
  }
  return {
    buckets: RECOVERY_BUCKETS.map((bucket) => ({ bucket, count: counts.get(bucket) ?? 0 })),
    otherStatuses: [...otherMap.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => a.status.localeCompare(b.status)),
    total: rows.length,
  };
}

// ── Incident Readiness — 기존 피드 연결만 (커버리지 수치 계측 부재 정직) ─

export interface ReadinessEntry {
  area: ReadinessArea;
  observed: boolean;
  note: string;
}

export function summarizeReadiness(feeds: RecoveryFeeds): ReadinessEntry[] {
  return [
    { area: 'detection', observed: feeds.incidents != null, note: feeds.incidents != null ? 'Incident 원장(0502) 관측 — 커버리지 수치 계측 부재(실측)' : 'Incident 원장 미관측' },
    { area: 'monitoring', observed: feeds.noc != null || feeds.streaming != null, note: feeds.noc != null || feeds.streaming != null ? 'NOC/Streaming 관측 피드 연결됨' : 'NOC/Streaming 피드 미관측' },
    { area: 'alert', observed: feeds.noc != null, note: feeds.noc != null ? 'E-1 Alert 파생 규칙 입력 피드 관측됨' : 'Alert 입력 피드 미관측' },
    { area: 'recovery', observed: feeds.recoveries != null, note: feeds.recoveries != null ? 'Recovery 후보 원장(0502) 관측됨' : 'Recovery 원장 미관측' },
    { area: 'governance', observed: feeds.govEvents != null, note: feeds.govEvents != null ? 'Governance 이벤트(0496) 관측됨' : 'Governance 피드 미관측' },
  ];
}

// ── Continuity Center — 계산 없음, 기존 관측값 표시만 ────────────────────

export interface ContinuityEntry {
  area: ContinuityArea;
  value: string;
  level: ResilienceQuality;
  note: string;
}

export function summarizeContinuity(feeds: RecoveryFeeds): ContinuityEntry[] {
  const out: ContinuityEntry[] = [];

  // service — Store online 비율 (NOC 관측값 그대로)
  const online = numAt(feeds.noc, 'online_stores');
  const total = numAt(feeds.noc, 'total_stores');
  if (online == null || total == null || total === 0) out.push({ area: 'service', value: '미관측', level: 'insufficient_data', note: 'NOC 피드 미관측/Store 0' });
  else {
    const pct = clampScore((online / total) * 100);
    out.push({ area: 'service', value: `online ${online}/${total} (${pct}%)`, level: pct >= 90 ? 'healthy' : pct >= 60 ? 'attention' : 'critical', note: 'NOC 관측값 그대로(계산식은 비율 표기뿐)' });
  }

  // business — 0564 Enterprise Resilience 원장 관측 여부 (재계산 없음)
  out.push(feeds.resilienceSummary == null
    ? { area: 'business', value: '미관측', level: 'insufficient_data', note: '0564 Resilience 원장 미관측' }
    : { area: 'business', value: '관측됨', level: 'attention', note: '0564 원장 관측 — Continuity 판정은 해당 센터/사람 검토 참조(재계산 없음)' });

  // operational — 오늘 미복구 Incident (NOC 관측값)
  const incidents = numAt(feeds.noc, 'today_incidents');
  const recovered = numAt(feeds.noc, 'today_recovered');
  if (incidents == null || recovered == null) out.push({ area: 'operational', value: '미관측', level: 'insufficient_data', note: 'NOC 피드 미관측' });
  else {
    const open = Math.max(0, incidents - recovered);
    out.push({ area: 'operational', value: `미복구 ${open}건`, level: open === 0 ? 'healthy' : 'attention', note: '오늘 Incident/복구 관측값' });
  }

  // executive — 전용 연속성 피드 부재 (조작 금지)
  out.push({ area: 'executive', value: '미관측', level: 'insufficient_data', note: 'Executive Continuity 전용 피드 부재(실측) — 추론하지 않음' });

  return out;
}

// ── Recovery Analytics — 기존 기록 집계만 (측정 불가 시 null) ────────────

export interface RecoveryAnalytics {
  avgRecoveryEstimateMin: number | null; // 추정치 평균 ≠ 실측 복구 시간
  recoverySuccessRatePct: number | null; // success/(success+failed)
  avgIncidentDurationMin: number | null; // resolved 건만
  incidentPerDay: number | null;         // 관측 창 내 일 평균
  incidentTrend: TrendDirection;         // 일 단위 발생 건수 추세(E-2/E-7 재사용)
  measuredNote: string;
}

export function computeRecoveryAnalytics(feeds: RecoveryFeeds): RecoveryAnalytics {
  const recoveries = feeds.recoveries;
  const estimates = recoveries?.map((r) => r.recovery_time_estimate_min).filter((v): v is number => isFiniteNumber(v)) ?? [];
  const success = recoveries?.filter((r) => r.outcome.toLowerCase().includes('success')).length ?? null;
  const failed = recoveries?.filter((r) => r.outcome.toLowerCase().includes('fail')).length ?? null;
  const denominator = success != null && failed != null ? success + failed : null;

  const incidents = feeds.incidents;
  const durations = incidents
    ?.filter((i) => i.resolved_at != null)
    .map((i) => (Date.parse(i.resolved_at as string) - Date.parse(i.detected_at)) / 60000)
    .filter((m) => isFiniteNumber(m) && m >= 0) ?? [];
  const days = incidents == null ? null : new Set(incidents.map((i) => i.detected_at.slice(0, 10))).size;

  return {
    avgRecoveryEstimateMin: estimates.length === 0 ? null : Math.round(estimates.reduce((a, b) => a + b, 0) / estimates.length),
    recoverySuccessRatePct: denominator == null || denominator === 0 ? null : clampScore(((success as number) / denominator) * 100),
    avgIncidentDurationMin: durations.length === 0 ? null : Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
    incidentPerDay: incidents == null || days == null || days === 0 ? null : Math.round((incidents.length / days) * 10) / 10,
    incidentTrend: analyzeTrendDirection(improvementDailySeries(incidents?.map((i) => ({ created_at: i.detected_at })) ?? null)).direction,
    measuredNote: '측정된 기록만 사용 — 추정치 평균 ≠ 실측 복구 시간, 결과 미기록(unknown) 건은 성공률 분모에서 제외',
  };
}

// ── Recovery Relationships ──────────────────────────────────────────────

export function buildRecoveryRelationships(feeds: RecoveryFeeds): Array<{
  stage: RecoveryStage;
  observed: boolean;
  note: string;
}> {
  return RECOVERY_RELATIONSHIP_FLOW.map((stage) => {
    switch (stage) {
      case 'incident': return { stage, observed: feeds.incidents != null || feeds.selfHealing != null, note: 'Incident 원장(0502)/Self-Healing Summary' };
      case 'recovery': return { stage, observed: feeds.recoveries != null, note: 'Recovery 후보 원장(0502)' };
      case 'performance': return { stage, observed: feeds.performance != null, note: 'Performance Summary(AI-OPS-44)' };
      case 'continuity': return { stage, observed: feeds.noc != null, note: 'NOC 관측값(Store/Incident)' };
      case 'resilience': return { stage, observed: feeds.resilienceSummary != null, note: 'Enterprise Resilience(0564)' };
      case 'executive': return { stage, observed: false, note: '통합 표시 계층(이 화면) — 별도 저장소 없음(자동 실행 금지)' };
      default: return { stage, observed: false, note: '' };
    }
  });
}

// ── Resilience Overview (최상단 카드 8필드) ─────────────────────────────

export interface ResilienceOverviewCard {
  operationalStability: ResilienceQuality;
  recoveryHealth: ResilienceQuality;
  activeIncidents: number | null;       // 미해결(resolved_at 없음) Incident
  recoveryProgressPct: number | null;   // completed/total
  incidentReadiness: number;            // 관측된 준비 영역 수 / 5
  continuityStatus: ResilienceQuality;
  executiveConfidencePct: number;       // 피드 관측 커버리지 — 실제 신뢰도 아님
  recoveryRisks: number | null;         // failed recovery + 미해결 incident
}

export function buildResilienceOverview(feeds: RecoveryFeeds): {
  card: ResilienceOverviewCard;
  recoveries: ReturnType<typeof summarizeRecoveries>;
  readiness: ReadinessEntry[];
  continuity: ContinuityEntry[];
  analytics: RecoveryAnalytics;
} {
  const recoveries = summarizeRecoveries(feeds.recoveries);
  const readiness = summarizeReadiness(feeds);
  const continuity = summarizeContinuity(feeds);
  const analytics = computeRecoveryAnalytics(feeds);

  const openIncidents = feeds.incidents == null ? null : feeds.incidents.filter((i) => i.resolved_at == null).length;
  const completed = recoveries.buckets.find((b) => b.bucket === 'completed')?.count ?? null;
  const failedCount = recoveries.buckets.find((b) => b.bucket === 'failed')?.count ?? null;

  const todayIncidents = numAt(feeds.noc, 'today_incidents');
  const todayRecovered = numAt(feeds.noc, 'today_recovered');
  const operationalStability: ResilienceQuality = todayIncidents == null || todayRecovered == null
    ? 'insufficient_data'
    : todayIncidents - todayRecovered > 0 ? 'attention' : 'healthy';

  const recoveryHealth: ResilienceQuality = analytics.recoverySuccessRatePct == null
    ? 'insufficient_data'
    : analytics.recoverySuccessRatePct >= 80 ? 'healthy' : analytics.recoverySuccessRatePct >= 50 ? 'attention' : 'critical';

  const observedFeeds = (['incidents', 'recoveries', 'noc', 'selfHealing', 'resilienceSummary', 'govEvents', 'performance', 'streaming'] as const)
    .filter((k) => feeds[k] != null).length;

  return {
    card: {
      operationalStability,
      recoveryHealth,
      activeIncidents: openIncidents,
      recoveryProgressPct: recoveries.total == null || recoveries.total === 0 || completed == null ? null : clampScore((completed / recoveries.total) * 100),
      incidentReadiness: readiness.filter((r) => r.observed).length,
      continuityStatus: worstQuality(continuity.map((c) => c.level)),
      executiveConfidencePct: clampScore((observedFeeds / 8) * 100),
      recoveryRisks: failedCount == null && openIncidents == null ? null : (failedCount ?? 0) + (openIncidents ?? 0),
    },
    recoveries, readiness, continuity, analytics,
  };
}

// ── Resilience Quality ──────────────────────────────────────────────────

export interface ResilienceQualityEntry {
  area: string;
  level: ResilienceQuality;
  note: string;
}

export function assessResilienceQuality(feeds: RecoveryFeeds): ResilienceQualityEntry[] {
  const { card } = buildResilienceOverview(feeds);
  const feedArea = (area: string, observed: boolean): ResilienceQualityEntry =>
    observed ? { area, level: 'healthy', note: '관측됨' } : { area, level: 'insufficient_data', note: '피드 미관측 — 추론하지 않음' };
  return [
    feedArea('incidents_0502', feeds.incidents != null),
    feedArea('recoveries_0502', feeds.recoveries != null),
    feedArea('noc_kpi', feeds.noc != null),
    feedArea('self_healing_summary', feeds.selfHealing != null),
    feedArea('resilience_0564', feeds.resilienceSummary != null),
    feedArea('governance_0496', feeds.govEvents != null),
    { area: 'operational_stability', level: card.operationalStability, note: '오늘 미복구 Incident 기준' },
    { area: 'recovery_health', level: card.recoveryHealth, note: 'Recovery 성공률 기준(분모 없으면 판정 보류)' },
  ];
}

// ── Executive Recovery Summary (5줄 이내 결정적 — 복구 실행 아님) ────────

export function buildRecoverySummaryLines(input: {
  recoverySuccessRatePct: number | null;
  pendingRecoveries: number | null;
  operationalStability: ResilienceQuality;
  criticalRecoveryRisks: number | null;
}): string[] {
  const lines: string[] = [];
  if (input.recoverySuccessRatePct == null) lines.push('Recovery 성공률은 측정 가능한 기록이 없어 판정하지 않습니다.');
  else if (input.recoverySuccessRatePct >= 80) lines.push(`Recovery 성공률은 ${input.recoverySuccessRatePct}%로 안정적입니다.`);
  else lines.push(`Recovery 성공률은 ${input.recoverySuccessRatePct}%로 관측됩니다 — 사람 검토가 필요합니다.`);
  lines.push(input.pendingRecoveries == null ? '복구 대기 건수는 관측되지 않았습니다.' : `복구 대기 항목이 ${input.pendingRecoveries}건 있습니다.`);
  const stabilityText: Record<ResilienceQuality, string> = {
    healthy: 'Operational Stability는 Healthy 상태입니다.',
    attention: 'Operational Stability에 주의가 필요합니다(미복구 Incident 존재).',
    critical: 'Operational Stability가 Critical 상태로 관측됩니다.',
    insufficient_data: 'Operational Stability는 관측되지 않았습니다.',
  };
  lines.push(stabilityText[input.operationalStability]);
  if (input.criticalRecoveryRisks == null) lines.push('Recovery Risk 상태는 관측되지 않았습니다.');
  else if (input.criticalRecoveryRisks === 0) lines.push('새로운 Critical Recovery Risk는 관측되지 않았습니다.');
  else lines.push(`Recovery Risk ${input.criticalRecoveryRisks}건 — 복구 실행 여부는 사람이 결정합니다.`);
  lines.push('AI는 복구를 실행하지 않습니다 — 본 요약은 관측값 연결입니다.');
  return lines.slice(0, 5);
}
