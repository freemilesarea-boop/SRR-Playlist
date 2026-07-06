/**
 * enterpriseHqIntelApi — Phase 3-4
 *
 * HQ (본사) 인텔리전스 센터 (/enterprise/intel) 전용 wrapper.
 * super admin admin_* / 기존 관리자 패널 무변경 · HQ scope RPC 만 호출.
 *
 * SQL: supabase/migrations/0402_enterprise_hq_intel_center.sql
 */
import { supabase } from '@/lib/supabase';

// =============================================================================
// Types
// =============================================================================

export interface HqIntelKpi {
  enterprise_account_id: string;
  total_stores: number;
  active_stores: number;
  mtd_revenue: number;
  carryover_pending: number;
  open_alerts: number;
  computed_at: string;
}

export interface HqIntelHealthScore {
  score: number;
  total_stores: number;
  active_stores: number;
  breakdown: {
    avg_store_health: number;
    online_ratio: number;
    policy_sync_ratio: number;
    playback_success_ratio: number;
  };
  delta_7d_signal: {
    force_resync_events: number;
    paid_blocked_events: number;
  };
  computed_at: string;
}

export type HqIntelRankingMetric = 'health' | 'uptime';
export type HqIntelRankingDirection = 'top' | 'bottom';

export interface HqIntelRankingRow {
  store_id: string;
  store_name: string;
  franchise_name: string | null;
  enterprise_region_name: string | null;
  last_seen_at: string | null;
  last_policy_sync_at: string | null;
  is_online: boolean;
  is_offline_24h: boolean;
  health_score: number;
  uptime_score: number;
}

export interface HqIntelRankingResult {
  metric: HqIntelRankingMetric;
  direction: HqIntelRankingDirection;
  data: HqIntelRankingRow[];
  computed_at: string;
}

export interface HqIntelRiskStore {
  store_id: string;
  store_name: string;
  franchise_name: string | null;
  enterprise_region_name: string | null;
  last_seen_at: string | null;
  last_policy_sync_at: string | null;
  playback_error: string | null;
  is_online: boolean;
  is_offline_24h: boolean;
  is_idle_1h_to_24h: boolean;
  has_playback_error: boolean;
  has_policy_outdated: boolean;
  has_device_missing: boolean;
  health_score: number;
}

export interface HqIntelRiskResult {
  data: HqIntelRiskStore[];
  computed_at: string;
}

export type HqIntelPeriod = '7d' | '30d' | '90d';

export interface HqIntelDailyActivityRow {
  date: string;              // 'YYYY-MM-DD'
  force_resync_count: number;
  paid_blocked_count: number;
  carryover_created_count: number;
  error_count: number;
}

export interface HqIntelMonthlyRevenueRow {
  settlement_month: string;  // 'YYYY-MM-DD' (월 첫날)
  total_commission: number;
  previous_carryover: number;
  effective_total: number;
  status: 'pending' | 'approved' | 'paid' | 'cancelled';
  active_store_count: number;
}

export interface HqIntelTrendResult {
  period: HqIntelPeriod;
  from: string;
  daily_activity: HqIntelDailyActivityRow[];
  monthly_revenue: HqIntelMonthlyRevenueRow[];
  computed_at: string;
}

export type HqIntelInsightSeverity = 'critical' | 'warning' | 'info';

export type HqIntelInsightRule =
  | 'offline_5d'
  | 'policy_sync_stale'
  | 'playback_error_spike'
  | 'carryover_pending'
  | 'monthly_revenue_change'
  | 'health_gap'
  | 'brand_health_drop_signal';

export interface HqIntelInsight {
  rule: HqIntelInsightRule;
  severity: HqIntelInsightSeverity;
  title: string;
  body: string;
  metric?: Record<string, unknown>;
  action_hint?: string;
}

export interface HqIntelInsightsResult {
  insights: HqIntelInsight[];
  computed_at: string;
}

export interface HqIntelMonthlyReportSettlement {
  settlement_month: string;
  status: string;
  active_store_count: number;
  monthly_store_price: number;
  commission_rate: number;
  per_store_commission: number;
  total_commission: number;
  previous_carryover: number;
  effective_total: number;
  minimum_payout: number | null;
  carryover_amount: number;
  carryover_applied: boolean;
  paid_at: string | null;
  payment_reference: string | null;
}

export interface HqIntelMonthlyReportStore {
  store_id: string;
  store_name: string;
  franchise_name: string | null;
  region_name: string | null;
  is_online: boolean;
  has_playback_error: boolean;
  has_policy_outdated: boolean;
  last_seen_at: string | null;
  last_policy_sync_at: string | null;
  health_score: number;
}

export interface HqIntelMonthlyReport {
  enterprise_account_id: string;
  month: string;
  settlement: HqIntelMonthlyReportSettlement | null;
  stores: HqIntelMonthlyReportStore[];
  event_counts: {
    force_resync: number;
    paid_blocked: number;
    carryover_created: number;
    total_events: number;
  };
  computed_at: string;
}

export type HqIntelExecutiveTone = 'stable' | 'attention' | 'risk';

export interface HqIntelExecutiveSummary {
  tone: HqIntelExecutiveTone;
  brand_score: number;
  online_ratio: number;
  alert_stores: number;
  total_stores: number;
  lines: string[];
  computed_at: string;
}

// =============================================================================
// RPC wrappers
// =============================================================================

export async function getMyEnterpriseIntelKpi(): Promise<HqIntelKpi> {
  const { data, error } = await supabase.rpc('get_my_enterprise_intel_kpi');
  if (error) {
    console.error('[hq-intel] kpi failed', error);
    throw new Error(error.message || 'KPI 를 불러올 수 없습니다.');
  }
  return data as HqIntelKpi;
}

export async function getMyEnterpriseIntelHealthScore(): Promise<HqIntelHealthScore> {
  const { data, error } = await supabase.rpc('get_my_enterprise_intel_health_score');
  if (error) {
    console.error('[hq-intel] health failed', error);
    throw new Error(error.message || 'Brand Health 를 불러올 수 없습니다.');
  }
  return data as HqIntelHealthScore;
}

export async function getMyEnterpriseIntelStoreRanking(
  metric: HqIntelRankingMetric = 'health',
  direction: HqIntelRankingDirection = 'top',
  limit = 5,
): Promise<HqIntelRankingResult> {
  const { data, error } = await supabase.rpc('get_my_enterprise_intel_store_ranking', {
    p_metric: metric,
    p_direction: direction,
    p_limit: limit,
  });
  if (error) {
    console.error('[hq-intel] ranking failed', error);
    throw new Error(error.message || '랭킹을 불러올 수 없습니다.');
  }
  return data as HqIntelRankingResult;
}

export async function getMyEnterpriseIntelRiskStores(
  limit = 20,
): Promise<HqIntelRiskResult> {
  const { data, error } = await supabase.rpc('get_my_enterprise_intel_risk_stores', {
    p_limit: limit,
  });
  if (error) {
    console.error('[hq-intel] risk failed', error);
    throw new Error(error.message || '리스크 매장을 불러올 수 없습니다.');
  }
  return data as HqIntelRiskResult;
}

export async function getMyEnterpriseIntelTrend(
  period: HqIntelPeriod = '30d',
): Promise<HqIntelTrendResult> {
  const { data, error } = await supabase.rpc('get_my_enterprise_intel_trend', {
    p_period: period,
  });
  if (error) {
    console.error('[hq-intel] trend failed', error);
    throw new Error(error.message || '트렌드를 불러올 수 없습니다.');
  }
  return data as HqIntelTrendResult;
}

export async function getMyEnterpriseIntelInsights(): Promise<HqIntelInsightsResult> {
  const { data, error } = await supabase.rpc('get_my_enterprise_intel_insights');
  if (error) {
    console.error('[hq-intel] insights failed', error);
    throw new Error(error.message || 'AI 인사이트를 불러올 수 없습니다.');
  }
  return data as HqIntelInsightsResult;
}

export async function getMyEnterpriseIntelMonthlyReport(
  monthYyyyMmDd: string | null = null,
): Promise<HqIntelMonthlyReport> {
  const { data, error } = await supabase.rpc('get_my_enterprise_intel_monthly_report', {
    p_month: monthYyyyMmDd,
  });
  if (error) {
    console.error('[hq-intel] monthly_report failed', error);
    throw new Error(error.message || '월간 리포트를 불러올 수 없습니다.');
  }
  return data as HqIntelMonthlyReport;
}

export async function getMyEnterpriseIntelExecutiveSummary(): Promise<HqIntelExecutiveSummary> {
  const { data, error } = await supabase.rpc('get_my_enterprise_intel_executive_summary');
  if (error) {
    console.error('[hq-intel] summary failed', error);
    throw new Error(error.message || 'Executive Summary 를 불러올 수 없습니다.');
  }
  return data as HqIntelExecutiveSummary;
}

// =============================================================================
// CSV / JSON export helpers
// =============================================================================

/** Monthly report → CSV 문자열 (매장별 상태 · 정산 요약 · 이벤트 카운트) */
export function monthlyReportToCsv(report: HqIntelMonthlyReport): string {
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines: string[] = [];

  lines.push(`# Enterprise Monthly Report — ${report.month}`);
  lines.push(`# generated_at,${report.computed_at}`);
  lines.push('');

  // 정산 요약
  lines.push('# Settlement Summary');
  if (report.settlement) {
    const s = report.settlement;
    lines.push('field,value');
    lines.push(`settlement_month,${esc(s.settlement_month)}`);
    lines.push(`status,${esc(s.status)}`);
    lines.push(`active_store_count,${esc(s.active_store_count)}`);
    lines.push(`monthly_store_price,${esc(s.monthly_store_price)}`);
    lines.push(`commission_rate,${esc(s.commission_rate)}`);
    lines.push(`per_store_commission,${esc(s.per_store_commission)}`);
    lines.push(`total_commission,${esc(s.total_commission)}`);
    lines.push(`previous_carryover,${esc(s.previous_carryover)}`);
    lines.push(`effective_total,${esc(s.effective_total)}`);
    lines.push(`minimum_payout,${esc(s.minimum_payout)}`);
    lines.push(`carryover_amount,${esc(s.carryover_amount)}`);
    lines.push(`carryover_applied,${esc(s.carryover_applied)}`);
    lines.push(`paid_at,${esc(s.paid_at)}`);
  } else {
    lines.push('(no settlement for this month)');
  }
  lines.push('');

  // 매장별 상태
  lines.push('# Stores');
  lines.push([
    'store_id', 'store_name', 'franchise_name', 'region_name',
    'is_online', 'has_playback_error', 'has_policy_outdated',
    'last_seen_at', 'last_policy_sync_at', 'health_score',
  ].join(','));
  for (const s of report.stores) {
    lines.push([
      esc(s.store_id), esc(s.store_name), esc(s.franchise_name), esc(s.region_name),
      esc(s.is_online), esc(s.has_playback_error), esc(s.has_policy_outdated),
      esc(s.last_seen_at), esc(s.last_policy_sync_at), esc(s.health_score),
    ].join(','));
  }
  lines.push('');

  // 이벤트 카운트
  lines.push('# Event Counts (during month)');
  lines.push('event,count');
  lines.push(`force_resync,${esc(report.event_counts.force_resync)}`);
  lines.push(`paid_blocked,${esc(report.event_counts.paid_blocked)}`);
  lines.push(`carryover_created,${esc(report.event_counts.carryover_created)}`);
  lines.push(`total_events,${esc(report.event_counts.total_events)}`);

  return lines.join('\n');
}

/** 브라우저에서 CSV 파일로 저장 (Blob + download link). */
export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 브라우저에서 JSON 파일로 저장. */
export function downloadJson(filename: string, obj: unknown) {
  const json = JSON.stringify(obj, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// =============================================================================
// UI helpers
// =============================================================================

export const INSIGHT_SEVERITY_LABEL: Record<HqIntelInsightSeverity, string> = {
  critical: '위험',
  warning: '주의',
  info: '정보',
};

export const EXEC_TONE_LABEL: Record<HqIntelExecutiveTone, string> = {
  stable: '안정',
  attention: '주의',
  risk: '위험',
};

/** 'YYYY-MM' → 'YYYY-MM-01' */
export function firstOfMonth(yyyyMm: string): string {
  return `${yyyyMm}-01`;
}
