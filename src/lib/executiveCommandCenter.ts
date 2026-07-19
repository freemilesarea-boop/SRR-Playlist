/**
 * executiveCommandCenter — Enterprise E-1 (Executive Command Center).
 *
 * 기존 Intelligence/KPI/Audit 를 **통합 관측**하는 순수 Command Layer.
 * 신규 Intelligence Engine 없음 · 신규 Migration/RPC 없음 — 입력은 전부
 * 기존 adminApi wrapper 가 반환한 관측 데이터이며, 이 모듈은 결정적(pure)으로
 * 요약/정렬/등급화만 수행한다.
 *
 * 정직성 원칙:
 *  - 관측되지 않은 피드는 0 으로 치환하지 않는다(Null→0 금지) — insufficient_data 로 노출.
 *  - Health Score ≠ 실제 상태 보장 · Advisor 요약 ≠ 판단 · Coverage ≠ 모델 신뢰도.
 *  - AI 는 Review/Approval/Reject/Feedback 을 "요청"만 한다 — 승인/지급/계약/배포는
 *    사람이 수행하며, automatic_* 액션은 전부 차단 목록이다.
 */
import { isFiniteNumber, clampScore } from './aiMemory';

// ── 상수 (Dashboard 탭/그룹/우선순위와 1:1) ─────────────────────────────

export const EXECUTIVE_KPI_GROUPS = ['business', 'platform', 'music', 'financial', 'operations'] as const;
export type ExecutiveKpiGroup = (typeof EXECUTIVE_KPI_GROUPS)[number];

export const EXECUTIVE_ALERT_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export type ExecutiveAlertPriority = (typeof EXECUTIVE_ALERT_PRIORITIES)[number];

export const EXECUTIVE_ALERT_CATEGORIES = [
  'platform', 'music', 'settlement', 'security', 'compliance', 'financial', 'infrastructure', 'enterprise',
] as const;
export type ExecutiveAlertCategory = (typeof EXECUTIVE_ALERT_CATEGORIES)[number];

export const ENTERPRISE_HEALTH_DOMAINS = [
  'business', 'platform', 'operations', 'financial', 'security', 'music', 'infrastructure', 'compliance',
] as const;
export type EnterpriseHealthDomain = (typeof ENTERPRISE_HEALTH_DOMAINS)[number];

export const ENTERPRISE_HEALTH_RESULTS = ['excellent', 'healthy', 'warning', 'critical', 'insufficient_data'] as const;
export type EnterpriseHealthResult = (typeof ENTERPRISE_HEALTH_RESULTS)[number];

/** AI 가 사람에게 "요청"할 수 있는 유형 — 이 외에는 요청 자체가 무효. */
export const EXECUTIVE_REQUEST_TYPES = ['review', 'approval', 'reject', 'feedback'] as const;
export type ExecutiveRequestType = (typeof EXECUTIVE_REQUEST_TYPES)[number];

/** 감사 로그 대상 Executive Action (0479 admin_action_register 재사용, command_type = executive_<type>). */
export const EXECUTIVE_ACTION_TYPES = ['review', 'approval', 'reject', 'feedback', 'export', 'report'] as const;
export type ExecutiveActionType = (typeof EXECUTIVE_ACTION_TYPES)[number];

/** 금지 목록 — 스펙 금지 사항 1:1. 어떤 경로로도 수행/기록 위임하지 않는다. */
export const BLOCKED_EXECUTIVE_ACTIONS = [
  'automatic_approval', 'automatic_contract_approval', 'automatic_payment', 'automatic_merge',
  'automatic_deploy', 'automatic_production_apply', 'new_recommendation_algorithm', 'new_music_engine',
] as const;

export function isBlockedExecutiveAction(action: string): boolean {
  return (BLOCKED_EXECUTIVE_ACTIONS as readonly string[]).includes(action) || action.startsWith('automatic_');
}

export function validateExecutiveRequest(type: string): { ok: boolean; reason: string } {
  if (isBlockedExecutiveAction(type)) return { ok: false, reason: '자동 승인/지급/계약/배포 요청은 금지되어 있습니다' };
  if (!(EXECUTIVE_REQUEST_TYPES as readonly string[]).includes(type)) {
    return { ok: false, reason: 'AI 요청은 review/approval/reject/feedback 만 허용됩니다' };
  }
  return { ok: true, reason: '' };
}

export function validateExecutiveAuditAction(type: string): { ok: boolean; reason: string } {
  if (isBlockedExecutiveAction(type)) return { ok: false, reason: '금지된 액션은 감사 기록 대상이 아니라 차단 대상입니다' };
  if (!(EXECUTIVE_ACTION_TYPES as readonly string[]).includes(type)) {
    return { ok: false, reason: '감사 기록은 review/approval/reject/feedback/export/report 만 허용됩니다' };
  }
  return { ok: true, reason: '' };
}

// ── 입력 피드 (기존 adminApi 반환값 — 관측 실패 시 null) ─────────────────

export type FeedRecord = Record<string, unknown>;

export interface ExecutiveFeeds {
  business: FeedRecord | null;          // fetchBusinessSummary
  revenue: FeedRecord | null;           // fetchRevenueSummary
  revenueForecast: FeedRecord | null;   // fetchRevenueForecast
  revenueBreakdown: FeedRecord | null;  // fetchRevenueBreakdown
  artist: FeedRecord | null;            // fetchArtistSummary
  artistBreakdown: FeedRecord | null;   // fetchArtistBreakdown
  streaming: FeedRecord | null;         // fetchStreamingSummary
  noc: FeedRecord | null;               // fetchNocKpi
  selfHealing: FeedRecord | null;       // fetchSelfHealingSummary
  settlementKpi: FeedRecord | null;     // fetchReadableSettlementKpi
  costSnapshots: FeedRecord[] | null;   // fetchCostSnapshots
  resilience: FeedRecord | null;        // fetchEnterpriseResilienceSummary
  actionHistory: FeedRecord[] | null;   // fetchActionHistory (0479)
}

export const EXECUTIVE_FEED_KEYS = [
  'business', 'revenue', 'revenueForecast', 'revenueBreakdown', 'artist', 'artistBreakdown',
  'streaming', 'noc', 'selfHealing', 'settlementKpi', 'costSnapshots', 'resilience', 'actionHistory',
] as const;
export type ExecutiveFeedKey = (typeof EXECUTIVE_FEED_KEYS)[number];

export function emptyExecutiveFeeds(): ExecutiveFeeds {
  return {
    business: null, revenue: null, revenueForecast: null, revenueBreakdown: null,
    artist: null, artistBreakdown: null, streaming: null, noc: null, selfHealing: null,
    settlementKpi: null, costSnapshots: null, resilience: null, actionHistory: null,
  };
}

/** 중첩 경로에서 유한 숫자만 추출 — 아니면 null (Null→0 치환 금지). */
export function numAt(rec: FeedRecord | null | undefined, ...path: string[]): number | null {
  let cur: unknown = rec ?? null;
  for (const key of path) {
    if (cur == null || typeof cur !== 'object' || Array.isArray(cur)) return null;
    cur = (cur as FeedRecord)[key];
  }
  return isFiniteNumber(cur) ? cur : null;
}

// ── KPI (스펙 5그룹 × 24지표) ───────────────────────────────────────────

export interface ExecutiveKpiEntry {
  key: string;
  group: ExecutiveKpiGroup;
  label: string;
  value: number | null;
  unit: string;
  status: 'observed' | 'insufficient_data';
  note: string;
}

const PB_MIN_SAMPLE = 10;

export function buildExecutiveKpis(feeds: ExecutiveFeeds): ExecutiveKpiEntry[] {
  const out: ExecutiveKpiEntry[] = [];
  const add = (key: string, group: ExecutiveKpiGroup, label: string, unit: string, value: number | null, note: string) => {
    out.push({ key, group, label, unit, value, status: value == null ? 'insufficient_data' : 'observed', note });
  };

  // Business
  add('today_revenue', 'business', "Today's Revenue", '원', numAt(feeds.revenue, 'today'), '오늘 결제 합계(관측값)');
  add('mrr', 'business', 'MRR', '원', numAt(feeds.revenueForecast, 'current_mrr'), '현재 MRR(기존 forecast RPC 관측값)');
  add('arr', 'business', 'ARR', '원', numAt(feeds.revenueForecast, 'arr_forecast'), 'ARR 추정 ≠ 확정 매출');
  {
    const cur = numAt(feeds.revenueForecast, 'subs_this_month');
    const prev = numAt(feeds.revenueForecast, 'subs_last_month');
    add('subscription_growth', 'business', 'Subscription Growth', '건', cur != null && prev != null ? cur - prev : null, '이번달-지난달 신규 구독 차이');
  }
  {
    const num = numAt(feeds.revenueBreakdown, 'churn', 'churn_numerator');
    const den = numAt(feeds.revenueBreakdown, 'churn', 'churn_denominator');
    add('churn', 'business', 'Churn', '%', num != null && den != null && den > 0 ? clampScore((num / den) * 100) : null, '이탈 비율 — 분모 0/미관측 시 insufficient_data');
  }

  // Platform
  add('online_stores', 'platform', 'Online Stores', '개', numAt(feeds.noc, 'online_stores'), 'NOC KPI 관측값');
  add('active_sessions', 'platform', 'Active Sessions', '개', numAt(feeds.streaming, 'heartbeat_sessions'), '오늘 Heartbeat 세션 수');
  {
    const start = numAt(feeds.streaming, 'pb_start');
    const complete = numAt(feeds.streaming, 'pb_complete');
    const ok = start != null && complete != null && start >= PB_MIN_SAMPLE;
    add('playback_success', 'platform', 'Playback Success', '%', ok ? clampScore((complete / start) * 100) : null,
      start != null && start > 0 && start < PB_MIN_SAMPLE ? `sample_too_small(start=${start})` : '완료/시작 비율(파생값)');
  }
  {
    const start = numAt(feeds.streaming, 'pb_start');
    const err = numAt(feeds.streaming, 'pb_error');
    const ok = start != null && err != null && start >= PB_MIN_SAMPLE;
    add('streaming_quality', 'platform', 'Streaming Quality', '%', ok ? clampScore(100 - (err / start) * 100) : null,
      '오류율 역산(파생값) ≠ 체감 품질');
  }
  add('queue_health', 'platform', 'Queue Health', '%', null, '전용 재생 큐 상태 피드 부재 — 측정 불가(정직 고지)');

  // Music
  add('tracks', 'music', 'Tracks', '곡', numAt(feeds.artistBreakdown, 'tracks', 'total'), '전체 트랙 수');
  add('artists', 'music', 'Artists', '명', numAt(feeds.artist, 'total_artists'), '전체 아티스트 수');
  add('new_releases', 'music', 'New Releases', '곡', numAt(feeds.artistBreakdown, 'tracks', 'month'), '이번달 신규 트랙');
  add('approval_queue', 'music', 'Approval Queue', '건', numAt(feeds.artist, 'pending'), '아티스트 승인 대기');
  add('qc_failure', 'music', 'QC Failure', '건', numAt(feeds.artist, 'rejected'), '누적 QC 반려(오늘 단위 피드 부재)');

  // Financial
  add('settlement_status', 'financial', 'Settlement Status', '원', numAt(feeds.settlementKpi, 'month_paid_total'), '이번달 지급 완료 합계');
  add('pending_payments', 'financial', 'Pending Payments', '원', numAt(feeds.settlementKpi, 'month_payable_total'), '이번달 지급 대기 합계');
  const monthlyCost = computeLatestMonthlyCost(feeds.costSnapshots);
  add('monthly_cost', 'financial', 'Monthly Cost', '원', monthlyCost.total, monthlyCost.note);
  {
    const monthRevenue = numAt(feeds.revenue, 'month');
    add('estimated_profit', 'financial', 'Estimated Profit', '원',
      monthRevenue != null && monthlyCost.total != null ? monthRevenue - monthlyCost.total : null,
      '이번달 매출 − 최신 비용 추정 (추정 ≠ 회계 이익)');
  }

  // Operations
  add('incident_count', 'operations', 'Incident Count', '건', numAt(feeds.noc, 'today_incidents'), '오늘 Incident(NOC 관측값)');
  add('recovery_status', 'operations', 'Recovery Status', '건', numAt(feeds.noc, 'today_recovered'), '오늘 복구 완료 수');
  {
    const rows = feeds.actionHistory;
    add('open_reviews', 'operations', 'Open Reviews', '건',
      rows == null ? null : rows.filter((r) => r.status === 'pending').length, 'Action Center(0479) pending 명령 수');
    add('ops_approval_queue', 'operations', 'Approval Queue', '건',
      rows == null ? null : rows.filter((r) => r.status === 'pending' || r.status === 'running').length,
      'Action Center pending+running 수');
  }
  return out;
}

export function computeLatestMonthlyCost(snapshots: FeedRecord[] | null): { total: number | null; note: string } {
  if (snapshots == null) return { total: null, note: '비용 스냅샷 피드 미관측' };
  const dated = snapshots
    .map((s) => ({ period: typeof s.period_start === 'string' ? s.period_start.slice(0, 7) : null, cost: isFiniteNumber(s.estimated_cost) ? s.estimated_cost : null }))
    .filter((s): s is { period: string; cost: number | null } => s.period != null);
  if (dated.length === 0) return { total: null, note: '비용 스냅샷 없음 — insufficient_data' };
  const latest = dated.map((s) => s.period).reduce((a, b) => (b > a ? b : a));
  const costs = dated.filter((s) => s.period === latest).map((s) => s.cost).filter((c): c is number => c != null);
  if (costs.length === 0) return { total: null, note: `최신 기간(${latest}) 비용 값 미기록` };
  return { total: costs.reduce((a, b) => a + b, 0), note: `최신 기간(${latest}) 추정 비용 합계 ≠ 실제 청구액` };
}

// ── Alert Center ────────────────────────────────────────────────────────

export interface ExecutiveAlert {
  key: string;
  category: ExecutiveAlertCategory;
  priority: ExecutiveAlertPriority;
  message: string;
  evidence: string;
}

const PRIORITY_RANK: Record<ExecutiveAlertPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function deriveExecutiveAlerts(feeds: ExecutiveFeeds): {
  alerts: ExecutiveAlert[];
  observedCategories: ExecutiveAlertCategory[];
  unobservedCategories: ExecutiveAlertCategory[];
} {
  const alerts: ExecutiveAlert[] = [];
  const observed = new Set<ExecutiveAlertCategory>();
  const push = (key: string, category: ExecutiveAlertCategory, priority: ExecutiveAlertPriority, message: string, evidence: string) => {
    alerts.push({ key, category, priority, message, evidence });
  };

  // platform — Store offline 비율 / 재생 오류율
  const total = numAt(feeds.noc, 'total_stores');
  const offline = numAt(feeds.noc, 'offline_stores');
  if (total != null && offline != null) {
    observed.add('platform');
    if (total > 0 && offline > 0) {
      const ratio = offline / total;
      push('stores_offline', 'platform', ratio >= 0.5 ? 'critical' : ratio >= 0.2 ? 'high' : 'medium',
        `Store Offline ${offline}/${total}`, `offline_ratio=${Math.round(ratio * 100)}%`);
    }
  }
  const pbStart = numAt(feeds.streaming, 'pb_start');
  const pbError = numAt(feeds.streaming, 'pb_error');
  if (pbStart != null && pbError != null) {
    observed.add('platform');
    if (pbStart >= PB_MIN_SAMPLE && pbError / pbStart >= 0.1) {
      push('playback_errors', 'platform', pbError / pbStart >= 0.25 ? 'critical' : 'high',
        '재생 오류율 상승', `error_rate=${Math.round((pbError / pbStart) * 100)}% (start=${pbStart})`);
    }
  }

  // infrastructure — heartbeat/player 오류
  const hbErr = numAt(feeds.noc, 'heartbeat_errors');
  const plErr = numAt(feeds.noc, 'player_errors');
  if (hbErr != null || plErr != null) observed.add('infrastructure');
  if (hbErr != null && hbErr > 0) push('heartbeat_errors', 'infrastructure', 'medium', 'Heartbeat 오류 발생', `heartbeat_errors=${hbErr}`);
  if (plErr != null && plErr > 0) push('player_errors', 'infrastructure', plErr >= 10 ? 'medium' : 'low', 'Player 오류 발생', `player_errors=${plErr}`);

  // music — 승인 대기 적체
  const pendingArtists = numAt(feeds.artist, 'pending');
  if (pendingArtists != null) {
    observed.add('music');
    if (pendingArtists >= 20) {
      push('artist_approval_backlog', 'music', pendingArtists >= 50 ? 'high' : 'medium',
        '아티스트 승인 대기 적체', `pending=${pendingArtists}`);
    }
  }

  // settlement — 보류/지급 대기
  const held = numAt(feeds.settlementKpi, 'held_count');
  const payable = numAt(feeds.settlementKpi, 'month_payable_total');
  if (held != null || payable != null) observed.add('settlement');
  if (held != null && held > 0) push('settlements_held', 'settlement', 'high', '보류(Held) 정산 존재', `held_count=${held}`);
  if (payable != null && payable > 0) push('settlements_payable', 'settlement', 'medium', '지급 대기 정산 존재', `month_payable_total=${payable}`);

  // financial — 결제 실패/오늘 매출 미관측
  const failedPayments = numAt(feeds.revenueBreakdown, 'churn', 'failed_payments');
  const todayRevenue = numAt(feeds.revenue, 'today');
  if (failedPayments != null || todayRevenue != null) observed.add('financial');
  if (failedPayments != null && failedPayments > 0) {
    push('failed_payments', 'financial', failedPayments >= 10 ? 'high' : 'medium', '결제 실패 발생', `failed_payments=${failedPayments}`);
  }
  if (todayRevenue != null && todayRevenue === 0) push('no_revenue_today', 'financial', 'low', '오늘 결제 매출 0', 'today_revenue=0');

  // enterprise/operations — Incident 미복구, Resilience 취약
  const incidents = numAt(feeds.noc, 'today_incidents');
  const recovered = numAt(feeds.noc, 'today_recovered');
  if (incidents != null && recovered != null) {
    observed.add('enterprise');
    if (incidents > recovered) push('unrecovered_incidents', 'enterprise', 'high', '미복구 Incident 존재', `incidents=${incidents}, recovered=${recovered}`);
    else if (incidents > 0) push('incidents_recovered', 'enterprise', 'low', '오늘 Incident 전건 복구', `incidents=${incidents}`);
  }
  const vulnerable = numAt(feeds.resilience, 'vulnerable');
  if (vulnerable != null) {
    observed.add('enterprise');
    if (vulnerable > 0) push('resilience_vulnerable', 'enterprise', 'high', 'Resilience 취약(vulnerable) 항목 존재', `vulnerable=${vulnerable}`);
  }

  // security / compliance — 이 화면에 연결된 실시간 피드 없음: 조작하지 않고 미관측으로 보고
  alerts.sort((a, b) =>
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.category.localeCompare(b.category) || a.key.localeCompare(b.key));
  const observedCategories = EXECUTIVE_ALERT_CATEGORIES.filter((c) => observed.has(c));
  const unobservedCategories = EXECUTIVE_ALERT_CATEGORIES.filter((c) => !observed.has(c));
  return { alerts, observedCategories, unobservedCategories };
}

// ── Enterprise Health Score ─────────────────────────────────────────────

/** Alert 카테고리 → Health 도메인 매핑 (settlement 은 financial 도메인에 귀속). */
export const ALERT_CATEGORY_TO_HEALTH_DOMAIN: Record<ExecutiveAlertCategory, EnterpriseHealthDomain> = {
  platform: 'platform', music: 'music', settlement: 'financial', security: 'security',
  compliance: 'compliance', financial: 'financial', infrastructure: 'infrastructure', enterprise: 'operations',
};

const HEALTH_PENALTY: Record<ExecutiveAlertPriority, number> = { critical: 60, high: 30, medium: 15, low: 5 };

/** 피드 관측 여부 → Health 도메인 관측 목록 (결정적). security/compliance 는 이 화면에 연결된 실측 피드가 없어 항상 미관측. */
export function deriveObservedHealthDomains(feeds: ExecutiveFeeds): EnterpriseHealthDomain[] {
  const observed: EnterpriseHealthDomain[] = [];
  if (feeds.revenue != null || feeds.revenueForecast != null || feeds.business != null) observed.push('business');
  if (feeds.noc != null || feeds.streaming != null) observed.push('platform');
  if (feeds.noc != null || feeds.selfHealing != null || feeds.actionHistory != null || feeds.resilience != null) observed.push('operations');
  if (feeds.settlementKpi != null || feeds.revenue != null || feeds.costSnapshots != null) observed.push('financial');
  if (feeds.artist != null || feeds.artistBreakdown != null) observed.push('music');
  if (feeds.noc != null) observed.push('infrastructure');
  return observed;
}
const HEALTH_RANK: Record<Exclude<EnterpriseHealthResult, 'insufficient_data'>, number> = {
  excellent: 3, healthy: 2, warning: 1, critical: 0,
};

export interface EnterpriseHealthDomainState {
  domain: EnterpriseHealthDomain;
  observed: boolean;
  score: number | null;
  result: EnterpriseHealthResult;
  alertCount: number;
}

export interface EnterpriseHealth {
  domains: EnterpriseHealthDomainState[];
  overall: EnterpriseHealthResult;
  overallScore: number | null;
  observedCount: number;
  unobservedDomains: EnterpriseHealthDomain[];
  capped: boolean;
  cappedReason: string;
}

function healthResultFromScore(score: number): Exclude<EnterpriseHealthResult, 'insufficient_data'> {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'healthy';
  if (score >= 50) return 'warning';
  return 'critical';
}

/**
 * 도메인 관측 여부 + Alert 로부터 Health 를 계산한다.
 * 과단정 방지: (1) 관측 도메인 < 4 → overall insufficient_data,
 * (2) 미관측 도메인이 하나라도 있으면 overall 'excellent' 승격 차단(healthy 상한),
 * (3) critical 도메인이 있으면 overall 은 최대 'warning'.
 */
export function computeEnterpriseHealth(input: {
  observedDomains: EnterpriseHealthDomain[];
  alerts: Array<{ category: ExecutiveAlertCategory; priority: ExecutiveAlertPriority }>;
}): EnterpriseHealth {
  const observedSet = new Set(input.observedDomains);
  const domains: EnterpriseHealthDomainState[] = ENTERPRISE_HEALTH_DOMAINS.map((domain) => {
    const observed = observedSet.has(domain);
    if (!observed) return { domain, observed, score: null, result: 'insufficient_data' as const, alertCount: 0 };
    const domainAlerts = input.alerts.filter((a) => ALERT_CATEGORY_TO_HEALTH_DOMAIN[a.category] === domain);
    const penalty = domainAlerts.reduce((sum, a) => sum + HEALTH_PENALTY[a.priority], 0);
    const score = clampScore(100 - penalty);
    return { domain, observed, score, result: healthResultFromScore(score), alertCount: domainAlerts.length };
  });

  const observed = domains.filter((d) => d.score != null);
  const unobservedDomains = domains.filter((d) => !d.observed).map((d) => d.domain);
  if (observed.length < 4) {
    return {
      domains, overall: 'insufficient_data', overallScore: null, observedCount: observed.length,
      unobservedDomains, capped: false, cappedReason: `관측 도메인 ${observed.length}/8 (<4) — 종합 판정 불가`,
    };
  }
  const overallScore = clampScore(observed.reduce((s, d) => s + (d.score as number), 0) / observed.length);
  let overall = healthResultFromScore(overallScore);
  let capped = false;
  let cappedReason = '';
  if (domains.some((d) => d.result === 'critical') && HEALTH_RANK[overall] > HEALTH_RANK.warning) {
    overall = 'warning';
    capped = true;
    cappedReason = 'critical 도메인 존재 — 종합 등급 warning 상한';
  }
  if (unobservedDomains.length > 0 && HEALTH_RANK[overall] > HEALTH_RANK.healthy) {
    overall = 'healthy';
    capped = true;
    cappedReason = `미관측 도메인 ${unobservedDomains.length}개 — excellent 승격 차단`;
  }
  return { domains, overall, overallScore, observedCount: observed.length, unobservedDomains, capped, cappedReason };
}

// ── Executive Timeline (이종 피드 병합) ─────────────────────────────────

export interface ExecutiveTimelineEvent {
  at: string;
  source: string;
  label: string;
  detail: string;
}

export function mergeExecutiveTimeline(
  sources: Array<{ source: string; events: Array<{ at: string | null | undefined; label: string; detail?: string }> }>,
  limit = 50,
): { events: ExecutiveTimelineEvent[]; droppedInvalid: number; observedSources: string[] } {
  const events: ExecutiveTimelineEvent[] = [];
  let droppedInvalid = 0;
  for (const src of sources) {
    for (const ev of src.events) {
      if (typeof ev.at !== 'string' || Number.isNaN(Date.parse(ev.at))) { droppedInvalid += 1; continue; }
      events.push({ at: ev.at, source: src.source, label: ev.label, detail: ev.detail ?? '' });
    }
  }
  events.sort((a, b) =>
    Date.parse(b.at) - Date.parse(a.at) || a.label.localeCompare(b.label) || a.source.localeCompare(b.source));
  return {
    events: events.slice(0, Math.max(1, limit)),
    droppedInvalid,
    observedSources: [...new Set(sources.map((s) => s.source))].sort((a, b) => a.localeCompare(b)),
  };
}

// ── Human Approval / Action Queue ───────────────────────────────────────

export interface ExecutiveQueueItem {
  key: string;
  label: string;
  count: number | null;
  priority: ExecutiveAlertPriority;
  requestType: ExecutiveRequestType;
}

export function buildExecutiveActionQueue(items: ExecutiveQueueItem[]): {
  queue: ExecutiveQueueItem[];
  excludedUnobserved: string[];
  totalPending: number;
} {
  const queue = items
    .filter((i) => isFiniteNumber(i.count) && (i.count as number) > 0)
    .sort((a, b) =>
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (b.count as number) - (a.count as number) || a.key.localeCompare(b.key));
  return {
    queue,
    excludedUnobserved: items.filter((i) => i.count == null).map((i) => i.key).sort((a, b) => a.localeCompare(b)),
    totalPending: queue.reduce((s, i) => s + (i.count as number), 0),
  };
}

// ── AI Executive Advisor (결정적 3줄 요약 — 판단/승인 아님) ──────────────

export function buildAdvisorBrief(input: {
  overall: EnterpriseHealthResult;
  criticalAlerts: number;
  todayApprovedArtists: number | null;
  pendingSettlements: number | null;
  offlineStores: number | null;
  incidents: number | null;
  recovered: number | null;
}): [string, string, string] {
  const statusText: Record<EnterpriseHealthResult, string> = {
    excellent: 'Enterprise는 매우 양호하게 운영 중입니다.',
    healthy: 'Enterprise는 정상 운영 중입니다.',
    warning: 'Enterprise에 주의가 필요한 신호가 있습니다.',
    critical: 'Enterprise에 심각한 신호가 있습니다.',
    insufficient_data: 'Enterprise 상태를 판정하기에 관측 데이터가 부족합니다.',
  };
  const line1 = input.criticalAlerts > 0
    ? `${statusText[input.overall]} (Critical Alert ${input.criticalAlerts}건)`
    : statusText[input.overall];

  const parts: string[] = [];
  parts.push(input.todayApprovedArtists == null ? '오늘 아티스트 승인 수는 관측되지 않았습니다' : `오늘 아티스트 승인 대기 ${input.todayApprovedArtists}건`);
  parts.push(input.pendingSettlements == null ? 'Settlement 대기는 관측되지 않았습니다' : `Settlement 지급 대기 ${input.pendingSettlements.toLocaleString('ko-KR')}원`);
  parts.push(input.offlineStores == null ? 'Store Offline 은 관측되지 않았습니다' : `Store Offline ${input.offlineStores}건`);
  const line2 = `${parts.join(', ')}이(가) 확인되었습니다.`;

  let line3: string;
  if (input.incidents == null || input.recovered == null) line3 = 'Recovery 상태는 관측되지 않았습니다.';
  else if (input.incidents === 0) line3 = '오늘 Incident 는 없습니다.';
  else if (input.recovered >= input.incidents) line3 = `Recovery 는 완료되었습니다 (${input.recovered}/${input.incidents}).`;
  else line3 = `Recovery 진행 중입니다 (${input.recovered}/${input.incidents}) — 사람 확인이 필요합니다.`;
  return [line1, line2, line3];
}

// ── AI Confidence — 관측 커버리지 (모델 신뢰도 아님) ─────────────────────

export function computeObservationCoverage(feeds: ExecutiveFeeds): {
  observed: number;
  total: number;
  ratio: number;
  level: 'high' | 'moderate' | 'low' | 'insufficient_data';
  missing: ExecutiveFeedKey[];
} {
  const missing = EXECUTIVE_FEED_KEYS.filter((k) => feeds[k] == null);
  const observed = EXECUTIVE_FEED_KEYS.length - missing.length;
  const ratio = clampScore((observed / EXECUTIVE_FEED_KEYS.length) * 100);
  const level = observed === 0 ? 'insufficient_data' : ratio >= 80 ? 'high' : ratio >= 50 ? 'moderate' : 'low';
  return { observed, total: EXECUTIVE_FEED_KEYS.length, ratio, level, missing };
}

// ── Executive Summary Card (Cockpit 10필드) ─────────────────────────────

export interface ExecutiveSummaryCard {
  enterpriseHealth: EnterpriseHealthResult;
  activeAlerts: number;
  criticalIssues: number;
  pendingReviews: number | null;
  todayKpi: number | null;        // Today's Revenue
  revenueSnapshot: number | null; // 이번달 매출
  activeStores: number | null;
  activeArtists: number | null;
  platformStatus: string;         // 'online x/y' 또는 미관측
  aiConfidence: number;           // 관측 커버리지 %
}

export function buildExecutiveSummaryCard(input: {
  feeds: ExecutiveFeeds;
  health: EnterpriseHealth;
  alerts: ExecutiveAlert[];
  queueTotal: number | null;
}): ExecutiveSummaryCard {
  const online = numAt(input.feeds.noc, 'online_stores');
  const total = numAt(input.feeds.noc, 'total_stores');
  return {
    enterpriseHealth: input.health.overall,
    activeAlerts: input.alerts.length,
    criticalIssues: input.alerts.filter((a) => a.priority === 'critical').length,
    pendingReviews: input.queueTotal,
    todayKpi: numAt(input.feeds.revenue, 'today'),
    revenueSnapshot: numAt(input.feeds.revenue, 'month'),
    activeStores: online,
    activeArtists: numAt(input.feeds.artist, 'active_artists'),
    platformStatus: online != null && total != null ? `online ${online}/${total}` : '미관측',
    aiConfidence: computeObservationCoverage(input.feeds).ratio,
  };
}

// ── Support Matrix (정직 고지) ───────────────────────────────────────────

export interface ExecutiveSupportEntry {
  feature: string;
  level: 'available' | 'human_review_only' | 'insufficient_data' | 'unavailable';
  note: string;
}

export const EXECUTIVE_COMMAND_SUPPORT_MATRIX: ExecutiveSupportEntry[] = [
  // available — 전부 기존 관측 데이터의 결정적 재구성
  { feature: 'executive_summary_card', level: 'available', note: '기존 KPI/NOC/Revenue 피드 재사용 조합' },
  { feature: 'kpi_aggregation', level: 'available', note: '기존 adminApi 반환값만 사용, 신규 RPC 없음' },
  { feature: 'alert_derivation', level: 'available', note: '관측값 기반 결정적 규칙 — 예측 아님' },
  { feature: 'timeline_merge', level: 'available', note: '기존 이벤트/이력 피드 병합(신규 저장 없음)' },
  { feature: 'enterprise_health_score', level: 'available', note: 'Health Score ≠ 실제 상태 보장' },
  { feature: 'advisor_brief', level: 'available', note: '결정적 3줄 요약 — 요약 ≠ 판단' },
  { feature: 'observation_coverage', level: 'available', note: 'AI Confidence = 관측 커버리지, 모델 신뢰도 아님' },
  { feature: 'action_queue_ranking', level: 'available', note: '우선순위 정렬만 수행 — 실행 없음' },
  { feature: 'executive_audit_via_0479', level: 'available', note: 'admin_action_register/complete/history 재사용' },
  // human_review_only — 사람이 최종 수행
  { feature: 'approval_decision', level: 'human_review_only', note: 'AI는 요청만 — 승인은 사람' },
  { feature: 'reject_decision', level: 'human_review_only', note: '반려 결정은 사람' },
  { feature: 'contract_review', level: 'human_review_only', note: '계약 검토/서명은 사람' },
  { feature: 'payment_execution', level: 'human_review_only', note: '지급 실행은 사람(기존 정산 절차)' },
  // insufficient_data — 이 화면에 연결된 실측 피드 부재 (조작 금지)
  { feature: 'queue_health_feed', level: 'insufficient_data', note: '전용 재생 큐 상태 피드 부재' },
  { feature: 'security_live_feed', level: 'insufficient_data', note: '보안 실시간 Alert 피드 미연결 — 미관측 표기' },
  { feature: 'compliance_live_feed', level: 'insufficient_data', note: '컴플라이언스 실시간 피드 미연결 — 미관측 표기' },
  { feature: 'today_qc_failure_feed', level: 'insufficient_data', note: '오늘 단위 QC 실패 피드 부재(누적만 관측)' },
  { feature: 'actual_cost_feed', level: 'insufficient_data', note: '실제 청구액 미기록 시 추정 비용만 표시' },
  { feature: 'today_artist_approved_feed', level: 'insufficient_data', note: '오늘 승인 완료 수 피드 부재(대기 수만 관측)' },
  // unavailable — 금지 목록 1:1
  { feature: 'automatic_approval', level: 'unavailable', note: '자동 승인 금지' },
  { feature: 'automatic_contract_approval', level: 'unavailable', note: '자동 계약 승인 금지' },
  { feature: 'automatic_payment', level: 'unavailable', note: '자동 지급 금지' },
  { feature: 'automatic_merge', level: 'unavailable', note: '자동 Merge 금지' },
  { feature: 'automatic_deploy', level: 'unavailable', note: '자동 Deploy 금지' },
  { feature: 'automatic_production_apply', level: 'unavailable', note: 'Production Apply 금지' },
  { feature: 'new_recommendation_algorithm', level: 'unavailable', note: '신규 추천 알고리즘 생성 금지' },
  { feature: 'new_music_engine', level: 'unavailable', note: '신규 Music Engine 생성 금지' },
];
