import { supabase } from './supabase';
import type {
  ContextSummary, ContextTrackRow, ContextPlaylistRow, GenreMoodRow, ContextBaseline, Grain, TrendPoint,
} from './contextIntel';
import type { DriftWindow, ContextFeature, Snapshot, RecoOutcomeRow } from './contextLearning';
import type { ScanRow } from './predictiveIntel';
import type { GuardrailSource } from './strategySandbox';

export interface DashboardStats {
  today_visitors: number;
  today_unique_visitors: number;
  today_streams: number;
  today_new_users: number;
  today_revenue: number;
  week_revenue: number;
  month_revenue: number;
  total_revenue: number;
  active_subscribers: number;
  free_users: number;
  personal_users: number;
  business_users: number;
  total_users: number;
  pending_subscriptions: number;
}

export interface DailySeriesPoint {
  d: string;
  visitors: number;
  unique_visitors: number;
  streams: number;
  revenue: number;
}

export interface TopTrack {
  track_id: string;
  title: string;
  artist: string | null;
  plays: number;
  completes: number;
  avg_seconds: number;
}

export interface TopPlaylist {
  playlist_id: string;
  title: string;
  category: string;
  plays: number;
}

export interface MemberRow {
  id: string;
  email: string | null;
  nickname: string | null;
  role: 'user' | 'admin';
  subscription_type: 'free' | 'personal' | 'business' | 'individual';
  account_type: 'individual' | 'business' | 'artist';
  membership_tier: 'free' | 'individual' | 'business';
  signup_completed: boolean;
  identity_verified: boolean;
  business_verified: boolean;
  business_number: string | null;
  created_at: string;
  last_seen_at: string | null;
  total_streams: number;
  total_listened_seconds: number;
  // 0056 — 회원 상태
  withdrawn_at: string | null;
  has_cancel_scheduled: boolean;
  // 0095 — 신규 상태
  disabled_at: string | null;
  pii_masked_at: string | null;
  last_sign_in_at: string | null;
  // 0105 — 프로모션 사용 여부
  has_promotion?: boolean;
  // X6.10 Phase 2 — 아티스트 플랜 (artist 계정만 의미 있음)
  plan_type?: 'general_artist' | 'student_artist' | 'admin' | 'legacy_student' | null;
}

export interface MemberDetail {
  user: {
    id: string;
    email: string | null;
    nickname: string | null;
    role: string;
    subscription_type: string;
    business_category: string | null;
    created_at: string;
    withdrawn_at?: string | null;
    withdrawn_reason?: string | null;
    // 0095 — 신규 상태
    disabled_at?: string | null;
    disabled_reason?: string | null;
    pii_masked_at?: string | null;
    last_sign_in_at?: string | null;
    account_type?: string;
    membership_tier?: string;
    is_curator?: boolean;
    // X6.10 Phase 2 — 아티스트 플랜
    plan_type?: 'general_artist' | 'student_artist' | 'admin' | 'legacy_student' | null;
    plan_monthly_quota?: number;
    plan_used_this_month?: number;
  };
  total_streams: number;
  total_listened_seconds: number;
  last_seen_at: string | null;
  recent_visits: Array<{ path: string; created_at: string }>;
  recent_plays: Array<{
    track_title: string;
    playlist_title: string;
    completed: boolean;
    created_at: string;
  }>;
  revenue: Array<{
    amount: number;
    subscription_type: string;
    status: string;
    paid_at: string;
    sales_agent_id?: string | null;
    sales_agent_code?: string | null;
  }>;
  subscription_requests: Array<{
    requested_plan: string;
    status: string;
    created_at: string;
  }>;
  // 0105 — 프로모션 사용 기록
  promotions?: Array<{
    code: string;
    name: string | null;
    discount_type: 'fixed' | 'percent';
    discount_amount: number | null;
    original_amount: number | null;
    final_amount: number | null;
    plan_type: string | null;
    redeemed_at: string;
  }>;
  // 0054 — 연결된 영업인 (없으면 null)
  sales_agent?: {
    id: string;
    name: string;
    code: string;
    is_active: boolean;
    commission_rate: number;
    linked_at: string;
  } | null;
}

export interface TrackAnalytics {
  track_id: string;
  title: string;
  artist: string | null;
  plays: number;
  completes: number;
  avg_seconds: number;
  last_played_at: string | null;
}

export interface RevenueSummary {
  today: number;
  week: number;
  month: number;
  total: number;
  by_plan: Record<string, number>;
  by_status: Record<string, number>;
  recent: Array<{
    id: number;
    email: string | null;
    nickname: string | null;
    subscription_type: string;
    amount: number;
    status: string;
    payment_provider: string | null;
    note: string | null;
    paid_at: string;
  }>;
}

const EMPTY_DASHBOARD_STATS: DashboardStats = {
  today_visitors: 0,
  today_unique_visitors: 0,
  today_streams: 0,
  today_new_users: 0,
  today_revenue: 0,
  week_revenue: 0,
  month_revenue: 0,
  total_revenue: 0,
  active_subscribers: 0,
  free_users: 0,
  personal_users: 0,
  business_users: 0,
  total_users: 0,
  pending_subscriptions: 0,
};

export async function fetchDashboardStats(): Promise<DashboardStats> {
  const { data, error } = await supabase.rpc('admin_dashboard_stats');
  if (error) throw error;
  // RPC 가 null 을 반환해도(데이터 없음/집계 전) 렌더가 깨지지 않도록 기본값 병합.
  return { ...EMPTY_DASHBOARD_STATS, ...((data as Partial<DashboardStats> | null) ?? {}) };
}

// ── 회원 통계 (admin_member_stats) ────────────────────────────────
// 총 회원(내부 admin 제외)을 3개의 정확한 파티션으로 집계한다:
//   구분(account_type) · 결제(유료/무료/미결제) · 상태(활성/이메일미인증/정지/탈퇴).
// 설계상 각 파티션 합계 = total_members. 자세한 집계 기준은 0471 migration 참고.
export interface MemberStats {
  total_members: number;
  // ① 회원 구분
  member_general: number;
  member_business: number;
  member_artist: number;
  // ② 결제 현황
  paid_users: number;
  free_users: number;
  unpaid_users: number;
  // ③ 플랜별 가입자 (미결제 제외)
  plan_free: number;
  plan_individual: number;
  plan_business: number;
  // ④ 회원 상태
  status_active: number;
  status_email_unverified: number;
  status_disabled: number;
  status_withdrawn: number;
  has_dormant_model: boolean;
  generated_at: string | null;
}

export const EMPTY_MEMBER_STATS: MemberStats = {
  total_members: 0,
  member_general: 0,
  member_business: 0,
  member_artist: 0,
  paid_users: 0,
  free_users: 0,
  unpaid_users: 0,
  plan_free: 0,
  plan_individual: 0,
  plan_business: 0,
  status_active: 0,
  status_email_unverified: 0,
  status_disabled: 0,
  status_withdrawn: 0,
  has_dormant_model: false,
  generated_at: null,
};

export async function fetchMemberStats(): Promise<MemberStats> {
  const { data, error } = await supabase.rpc('admin_member_stats');
  if (error) throw error;
  // RPC null 이어도 렌더가 깨지지 않도록 기본값 병합.
  return { ...EMPTY_MEMBER_STATS, ...((data as Partial<MemberStats> | null) ?? {}) };
}

// ── 회원 성장 대시보드 (0472) ─────────────────────────────────────
// 성장 KPI / 시계열 / 최근 가입 — admin_member_stats(0471) 를 확장한다.
// 정의는 admin_member_stats 와 일관(0472 migration 주석 참고). 오늘/이번달 등
// 캘린더 경계는 KST(Asia/Seoul) 기준. 무료→유료 전환 이력 로그는 스키마에
// 부재 → free_to_paid_history_supported=false 로 명시(임의 추정 금지).

export type MomStatus = 'normal' | 'new_growth' | 'flat';

export interface MemberGrowthKpis {
  today_signups: number;
  last_7d: number;
  last_30d: number;
  this_month: number;
  last_month: number;
  mom_growth_rate: number | null;   // 지난달 0 이면 null (Infinity/NaN 금지)
  mom_status: MomStatus;
  active_paid_members: number;
  total_valid_members: number;
  unpaid_users: number;
  paid_conversion_rate: number;
  general_conversion_rate: number;
  business_conversion_rate: number;
  general_total: number;
  general_paid: number;
  business_total: number;
  business_paid: number;
  last30_signups: number;
  last30_paid: number;
  last30_conversion_rate: number;
  free_to_paid_history_supported: boolean;
  free_to_paid_count: number | null;
  generated_at: string | null;
}

export const EMPTY_MEMBER_GROWTH_KPIS: MemberGrowthKpis = {
  today_signups: 0, last_7d: 0, last_30d: 0, this_month: 0, last_month: 0,
  mom_growth_rate: null, mom_status: 'flat',
  active_paid_members: 0, total_valid_members: 0, unpaid_users: 0,
  paid_conversion_rate: 0, general_conversion_rate: 0, business_conversion_rate: 0,
  general_total: 0, general_paid: 0, business_total: 0, business_paid: 0,
  last30_signups: 0, last30_paid: 0, last30_conversion_rate: 0,
  free_to_paid_history_supported: false, free_to_paid_count: null,
  generated_at: null,
};

export async function fetchMemberGrowthKpis(): Promise<MemberGrowthKpis> {
  const { data, error } = await supabase.rpc('admin_member_growth_kpis');
  if (error) throw error;
  return { ...EMPTY_MEMBER_GROWTH_KPIS, ...((data as Partial<MemberGrowthKpis> | null) ?? {}) };
}

export type MemberGrowthRange = '7d' | '30d' | '90d' | '12m';

export interface MemberGrowthPoint {
  bucket: string;        // 'YYYY-MM-DD' (day) 또는 월 첫날 (month)
  new_total: number;
  new_general: number;
  new_business: number;
  new_artist: number;
  new_unknown: number;
  cumulative: number;    // 해당 버킷 종료 시점까지의 누적 회원 수
}

export interface MemberGrowthSeries {
  range: MemberGrowthRange;
  unit: 'day' | 'month';
  start: string | null;
  end: string | null;
  total_new: number;
  unknown_total: number;
  points: MemberGrowthPoint[];
  generated_at: string | null;
}

const EMPTY_GROWTH_SERIES: MemberGrowthSeries = {
  range: '30d', unit: 'day', start: null, end: null,
  total_new: 0, unknown_total: 0, points: [], generated_at: null,
};

export async function fetchMemberGrowthSeries(range: MemberGrowthRange = '30d'): Promise<MemberGrowthSeries> {
  const { data, error } = await supabase.rpc('admin_member_growth_series', { p_range: range });
  if (error) throw error;
  const d = (data as Partial<MemberGrowthSeries> | null) ?? {};
  return { ...EMPTY_GROWTH_SERIES, ...d, points: d.points ?? [] };
}

export type RecentMemberPayStatus = 'paid' | 'unpaid' | 'free';
export type RecentMemberStatus = 'active' | 'email_unverified' | 'disabled' | 'withdrawn';

export interface RecentMember {
  id: string;
  display_name: string | null;
  email: string | null;
  account_type: string | null;
  membership_tier: string;
  subscription_type: string;
  pay_status: RecentMemberPayStatus;
  email_verified: boolean;
  status: RecentMemberStatus;
  created_at: string;
}

export async function fetchRecentMembers(limit = 10): Promise<RecentMember[]> {
  const { data, error } = await supabase.rpc('admin_recent_members', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as RecentMember[];
}

// ── 회원 전환 퍼널 (0473) ─────────────────────────────────────────
// 방문→가입→인증→로그인→프로필→첫재생→무료→유료→사업자→매장→Player→Streaming
// 각 step 은 실제 데이터 근거가 있을 때만 supported=true. 없는 데이터는 추정하지
// 않고 supported=false(count=null)로 반환한다. 전환율/이탈률/단조성 검증은
// memberFunnel.ts 순수 함수에서 계산. 자세한 근거는 0473 migration 주석 참고.

export interface FunnelStep {
  key: string;
  label: string;
  count: number | null;    // supported=false 이면 null
  supported: boolean;
  note?: string;
}

export type MemberFunnelRange = 'all' | 'today' | '7d' | '30d' | '90d' | '12m';

export interface MemberFunnel {
  range: MemberFunnelRange;
  cohort_total: number;
  steps: FunnelStep[];         // 메인 획득→수익화 체인 (단조)
  engagement: FunnelStep[];    // 참여/운영 지표 (subset 아님 또는 미지원)
  generated_at: string | null;
}

const EMPTY_FUNNEL: MemberFunnel = { range: 'all', cohort_total: 0, steps: [], engagement: [], generated_at: null };

export async function fetchMemberFunnel(range: MemberFunnelRange = 'all'): Promise<MemberFunnel> {
  const { data, error } = await supabase.rpc('admin_member_funnel', { p_range: range });
  if (error) throw error;
  const d = (data as Partial<MemberFunnel> | null) ?? {};
  return { ...EMPTY_FUNNEL, ...d, steps: d.steps ?? [], engagement: d.engagement ?? [] };
}

export interface MemberFunnelBreakdown {
  segments: { artist: FunnelStep[]; business: FunnelStep[]; general: FunnelStep[] };
  revenue: FunnelStep[];
  generated_at: string | null;
}

export async function fetchMemberFunnelBreakdown(): Promise<MemberFunnelBreakdown> {
  const { data, error } = await supabase.rpc('admin_member_funnel_breakdown');
  if (error) throw error;
  const d = (data as Partial<MemberFunnelBreakdown> | null) ?? {};
  return {
    segments: {
      artist: d.segments?.artist ?? [],
      business: d.segments?.business ?? [],
      general: d.segments?.general ?? [],
    },
    revenue: d.revenue ?? [],
    generated_at: d.generated_at ?? null,
  };
}

export interface FunnelHistoryStep {
  key: string;
  label: string;
  this: number;
  prev: number;
}

export interface MemberFunnelHistory {
  this_month_start: string | null;
  prev_month_start: string | null;
  steps: FunnelHistoryStep[];
  generated_at: string | null;
}

const EMPTY_HISTORY: MemberFunnelHistory = {
  this_month_start: null, prev_month_start: null, steps: [], generated_at: null,
};

export async function fetchMemberFunnelHistory(): Promise<MemberFunnelHistory> {
  const { data, error } = await supabase.rpc('admin_member_funnel_history');
  if (error) throw error;
  const d = (data as Partial<MemberFunnelHistory> | null) ?? {};
  return { ...EMPTY_HISTORY, ...d, steps: d.steps ?? [] };
}

// ── Revenue Intelligence (0474) ───────────────────────────────────
// SaaS Revenue KPI(MRR/ARR/ARPU/ARPPU/Growth/Churn) + Trend + Breakdown + Forecast.
// 매출 원천 = payment_orders(status=paid, refunded_at null, amount) — 기존
// admin_daily_series 관례와 동일. 기존 admin_revenue_summary 는 무변경(별도 RPC).
// 비율/정합성/포맷은 revenueIntel.ts 순수 함수. 정의는 0474 migration 주석 참고.

export interface RevenueKpis {
  today_revenue: number; yesterday_revenue: number; week_revenue: number;
  month_revenue: number; last_month_revenue: number; year_revenue: number;
  total_revenue: number; month_forecast: number;
  mrr: number; arr: number;
  revenue_growth_this: number; revenue_growth_prev: number;
  subs_this_month: number; subs_last_month: number;
  arpu: number; arppu_numerator: number; active_members: number; paying_users: number;
  avg_payment_amount: number; paid_count: number;
  new_payments: number; renewal_payments: number;
  failed_payments: number; refund_count: number; refund_amount: number;
  cancel_count: number; promo_count: number; unpaid_users: number;
  active_subscriptions: number; ending_subscriptions: number; canceled_subscriptions: number;
  generated_at: string | null;
}

export const EMPTY_REVENUE_KPIS: RevenueKpis = {
  today_revenue: 0, yesterday_revenue: 0, week_revenue: 0, month_revenue: 0,
  last_month_revenue: 0, year_revenue: 0, total_revenue: 0, month_forecast: 0,
  mrr: 0, arr: 0, revenue_growth_this: 0, revenue_growth_prev: 0,
  subs_this_month: 0, subs_last_month: 0, arpu: 0, arppu_numerator: 0,
  active_members: 0, paying_users: 0, avg_payment_amount: 0, paid_count: 0,
  new_payments: 0, renewal_payments: 0, failed_payments: 0, refund_count: 0,
  refund_amount: 0, cancel_count: 0, promo_count: 0, unpaid_users: 0,
  active_subscriptions: 0, ending_subscriptions: 0, canceled_subscriptions: 0,
  generated_at: null,
};

export async function fetchRevenueKpis(): Promise<RevenueKpis> {
  const { data, error } = await supabase.rpc('admin_revenue_kpis');
  if (error) throw error;
  return { ...EMPTY_REVENUE_KPIS, ...((data as Partial<RevenueKpis> | null) ?? {}) };
}

export type RevenueTrendRange = '7d' | '30d' | '90d' | '12m';

export interface RevenueTrendPoint {
  bucket: string;
  revenue: number; payments: number;
  new_payments: number; renewal_payments: number;
  refunds: number; cancels: number; active_subs: number;
}

export interface RevenueTrend {
  range: RevenueTrendRange; unit: 'day' | 'month';
  start: string | null; end: string | null;
  points: RevenueTrendPoint[]; total_revenue: number; generated_at: string | null;
}

const EMPTY_REVENUE_TREND: RevenueTrend = {
  range: '30d', unit: 'day', start: null, end: null, points: [], total_revenue: 0, generated_at: null,
};

export async function fetchRevenueTrend(range: RevenueTrendRange = '30d'): Promise<RevenueTrend> {
  const { data, error } = await supabase.rpc('admin_revenue_trend', { p_range: range });
  if (error) throw error;
  const d = (data as Partial<RevenueTrend> | null) ?? {};
  return { ...EMPTY_REVENUE_TREND, ...d, points: d.points ?? [] };
}

export interface RevenueBucketRow { key: string; count: number; revenue: number }
export interface PlanAnalysisRow {
  key: string; subs: number; active: number; canceled: number; revenue: number; avg_retention_days: number | null;
}
export interface TopPayerRow { user_id: string; email: string | null; revenue: number; payments: number }

export interface RevenueBreakdown {
  by_plan: RevenueBucketRow[];
  by_type: RevenueBucketRow[];
  by_period: { today: number; this_week: number; this_month: number; this_year: number; total: number };
  plan_analysis: PlanAnalysisRow[];
  churn: {
    canceled: number; cancel_scheduled: number; failed_payments: number; refunds: number;
    active: number; churn_numerator: number; churn_denominator: number;
  };
  top_payers: TopPayerRow[];
  top_plan: { key: string; revenue: number } | null;
  top_revenue_day: { day: string; revenue: number } | null;
  top_count_day: { day: string; payments: number } | null;
  revenue_funnel: FunnelStep[];
  support: Record<string, boolean>;
  generated_at: string | null;
}

export async function fetchRevenueBreakdown(): Promise<RevenueBreakdown> {
  const { data, error } = await supabase.rpc('admin_revenue_breakdown');
  if (error) throw error;
  const d = (data as Partial<RevenueBreakdown> | null) ?? {};
  return {
    by_plan: d.by_plan ?? [],
    by_type: d.by_type ?? [],
    by_period: d.by_period ?? { today: 0, this_week: 0, this_month: 0, this_year: 0, total: 0 },
    plan_analysis: d.plan_analysis ?? [],
    churn: d.churn ?? { canceled: 0, cancel_scheduled: 0, failed_payments: 0, refunds: 0, active: 0, churn_numerator: 0, churn_denominator: 0 },
    top_payers: d.top_payers ?? [],
    top_plan: d.top_plan ?? null,
    top_revenue_day: d.top_revenue_day ?? null,
    top_count_day: d.top_count_day ?? null,
    revenue_funnel: d.revenue_funnel ?? [],
    support: d.support ?? {},
    generated_at: d.generated_at ?? null,
  };
}

export interface RevenueForecast {
  method: string;
  month_to_date_revenue: number; days_elapsed: number; days_in_month: number;
  projected_month_revenue: number;
  current_mrr: number; next_month_mrr: number; arr_forecast: number;
  subs_this_month: number; subs_last_month: number;
  generated_at: string | null;
}

export const EMPTY_REVENUE_FORECAST: RevenueForecast = {
  method: '', month_to_date_revenue: 0, days_elapsed: 0, days_in_month: 0,
  projected_month_revenue: 0, current_mrr: 0, next_month_mrr: 0, arr_forecast: 0,
  subs_this_month: 0, subs_last_month: 0, generated_at: null,
};

export async function fetchRevenueForecast(): Promise<RevenueForecast> {
  const { data, error } = await supabase.rpc('admin_revenue_forecast');
  if (error) throw error;
  return { ...EMPTY_REVENUE_FORECAST, ...((data as Partial<RevenueForecast> | null) ?? {}) };
}

// ── Artist Intelligence (0475) ────────────────────────────────────
// 아티스트 Lifecycle(가입→승인→QC→유통→스트리밍→정산) 분석. 실제 데이터만 사용,
// 없는 데이터는 supported=false. 정의는 0475 migration 주석 참고. 비율/단조 검증은
// artistIntel.ts 순수 함수.

export interface ArtistSummary {
  total_artists: number; today_signups: number; month_signups: number;
  pending: number; approved: number; rejected: number; active_artists: number;
  first_upload: number; distributed: number; streaming: number;
  settled: number; settle_paid: number;
  avg_qc_score: number; avg_approval_hours: number;
  generated_at: string | null;
}

export const EMPTY_ARTIST_SUMMARY: ArtistSummary = {
  total_artists: 0, today_signups: 0, month_signups: 0, pending: 0, approved: 0,
  rejected: 0, active_artists: 0, first_upload: 0, distributed: 0, streaming: 0,
  settled: 0, settle_paid: 0, avg_qc_score: 0, avg_approval_hours: 0, generated_at: null,
};

export async function fetchArtistSummary(): Promise<ArtistSummary> {
  const { data, error } = await supabase.rpc('admin_artist_summary');
  if (error) throw error;
  return { ...EMPTY_ARTIST_SUMMARY, ...((data as Partial<ArtistSummary> | null) ?? {}) };
}

export interface ArtistFunnel { steps: FunnelStep[]; generated_at: string | null }

export async function fetchArtistFunnel(): Promise<ArtistFunnel> {
  const { data, error } = await supabase.rpc('admin_artist_funnel');
  if (error) throw error;
  const d = (data as Partial<ArtistFunnel> | null) ?? {};
  return { steps: d.steps ?? [], generated_at: d.generated_at ?? null };
}

export type ArtistGrowthRange = '7d' | '30d' | '90d' | '12m';

export interface ArtistGrowthPoint {
  bucket: string; new_artists: number; uploads: number; qc_passed: number;
  distributed: number; streams: number; settlements: number;
}

export interface ArtistGrowth {
  range: ArtistGrowthRange; unit: 'day' | 'month'; start: string | null; end: string | null;
  points: ArtistGrowthPoint[]; generated_at: string | null;
}

const EMPTY_ARTIST_GROWTH: ArtistGrowth = {
  range: '30d', unit: 'day', start: null, end: null, points: [], generated_at: null,
};

export async function fetchArtistGrowth(range: ArtistGrowthRange = '30d'): Promise<ArtistGrowth> {
  const { data, error } = await supabase.rpc('admin_artist_growth', { p_range: range });
  if (error) throw error;
  const d = (data as Partial<ArtistGrowth> | null) ?? {};
  return { ...EMPTY_ARTIST_GROWTH, ...d, points: d.points ?? [] };
}

export interface CountRow { key: string; count: number }
export interface ArtistBreakdown {
  qc: {
    approved: number; pending: number; queue_open: number; queue_resolved: number;
    avg_score: number; avg_approval_hours: number; proc_time_supported: boolean;
    top_reasons: Array<{ reason: string; count: number }>;
    by_month: Array<{ bucket: string; approved: number }>;
  };
  tracks: {
    total: number; today: number; month: number; pending_dist: number; released: number;
    hidden: number; removed: number; avg_duration: number;
    genre_dist: CountRow[]; bpm_dist: CountRow[]; bpm_coverage: number; key_supported: boolean;
  };
  streaming: { streamed_artists: number; no_stream_artists: number };
  settlement: {
    sum_net: number; sum_final_payout: number; sum_carryover: number;
    held: number; pending: number; carried_over: number; paid: number;
    avg_net: number; this_month: number; payout_supported: boolean;
  };
  support: Record<string, boolean>;
  generated_at: string | null;
}

export async function fetchArtistBreakdown(): Promise<ArtistBreakdown> {
  const { data, error } = await supabase.rpc('admin_artist_breakdown');
  if (error) throw error;
  return data as ArtistBreakdown;
}

export interface ArtistRankRow { artist?: string; genre?: string; value?: number; created_at?: string }
export interface ArtistRankings {
  top_streaming: ArtistRankRow[]; top_settlement: ArtistRankRow[]; top_upload: ArtistRankRow[];
  top_genre: ArtistRankRow[]; top_new: ArtistRankRow[]; generated_at: string | null;
}

export async function fetchArtistRankings(): Promise<ArtistRankings> {
  const { data, error } = await supabase.rpc('admin_artist_rankings');
  if (error) throw error;
  const d = (data as Partial<ArtistRankings> | null) ?? {};
  return {
    top_streaming: d.top_streaming ?? [], top_settlement: d.top_settlement ?? [],
    top_upload: d.top_upload ?? [], top_genre: d.top_genre ?? [], top_new: d.top_new ?? [],
    generated_at: d.generated_at ?? null,
  };
}

// ── Business Intelligence (0476) ──────────────────────────────────
// 사업자/브랜드/매장/Player/계약/운영 Lifecycle 분석. 희소 데이터 — 실제 값만
// 사용하고 없는 데이터는 supported=false. 정의는 0476 migration 주석 참고.

export interface BusinessSummary {
  total_business: number; today_signups: number; month_signups: number;
  active_business: number; inactive_business: number;
  contract_supported: boolean; monthly_fee_default: number;
  total_brands: number; active_brands: number; total_franchises: number; total_enterprises: number;
  total_stores: number; business_stores: number; today_new_stores: number; month_new_stores: number;
  total_players: number; online_players: number; offline_players: number;
  heartbeat_players: number; playing_players: number; today_new_players: number;
  online_cutoff_minutes: number; generated_at: string | null;
}

export const EMPTY_BUSINESS_SUMMARY: BusinessSummary = {
  total_business: 0, today_signups: 0, month_signups: 0, active_business: 0, inactive_business: 0,
  contract_supported: false, monthly_fee_default: 0, total_brands: 0, active_brands: 0,
  total_franchises: 0, total_enterprises: 0, total_stores: 0, business_stores: 0,
  today_new_stores: 0, month_new_stores: 0, total_players: 0, online_players: 0, offline_players: 0,
  heartbeat_players: 0, playing_players: 0, today_new_players: 0, online_cutoff_minutes: 5, generated_at: null,
};

export async function fetchBusinessSummary(): Promise<BusinessSummary> {
  const { data, error } = await supabase.rpc('admin_business_summary');
  if (error) throw error;
  return { ...EMPTY_BUSINESS_SUMMARY, ...((data as Partial<BusinessSummary> | null) ?? {}) };
}

export interface BusinessFunnel { steps: FunnelStep[]; generated_at: string | null }
export async function fetchBusinessFunnel(): Promise<BusinessFunnel> {
  const { data, error } = await supabase.rpc('admin_business_funnel');
  if (error) throw error;
  const d = (data as Partial<BusinessFunnel> | null) ?? {};
  return { steps: d.steps ?? [], generated_at: d.generated_at ?? null };
}

export type BusinessGrowthRange = '7d' | '30d' | '90d' | '12m';
export interface BusinessGrowthPoint { bucket: string; new_business: number; new_brands: number; new_stores: number; new_players: number }
export interface BusinessGrowth {
  range: BusinessGrowthRange; unit: 'day' | 'month'; start: string | null; end: string | null;
  points: BusinessGrowthPoint[]; generated_at: string | null;
}
const EMPTY_BUSINESS_GROWTH: BusinessGrowth = { range: '30d', unit: 'day', start: null, end: null, points: [], generated_at: null };
export async function fetchBusinessGrowth(range: BusinessGrowthRange = '30d'): Promise<BusinessGrowth> {
  const { data, error } = await supabase.rpc('admin_business_growth', { p_range: range });
  if (error) throw error;
  const d = (data as Partial<BusinessGrowth> | null) ?? {};
  return { ...EMPTY_BUSINESS_GROWTH, ...d, points: d.points ?? [] };
}

export interface HealthComponent { key: string; label: string; score: number | null; available: boolean; detail: string }
export interface BusinessHealth {
  components: HealthComponent[]; excluded: string[]; players: number; generated_at: string | null;
}
export async function fetchBusinessHealth(): Promise<BusinessHealth> {
  const { data, error } = await supabase.rpc('admin_business_health');
  if (error) throw error;
  const d = (data as Partial<BusinessHealth> | null) ?? {};
  return { components: d.components ?? [], excluded: d.excluded ?? [], players: d.players ?? 0, generated_at: d.generated_at ?? null };
}

export interface BusinessRankRow { name?: string; value?: number; last_seen?: string | null }
export interface BusinessRankings {
  top_brand_stores: BusinessRankRow[]; top_brand_players: BusinessRankRow[]; recent_players: BusinessRankRow[];
  support: Record<string, boolean>; generated_at: string | null;
}
export async function fetchBusinessRankings(): Promise<BusinessRankings> {
  const { data, error } = await supabase.rpc('admin_business_rankings');
  if (error) throw error;
  const d = (data as Partial<BusinessRankings> | null) ?? {};
  return {
    top_brand_stores: d.top_brand_stores ?? [], top_brand_players: d.top_brand_players ?? [],
    recent_players: d.recent_players ?? [], support: d.support ?? {}, generated_at: d.generated_at ?? null,
  };
}

// ── Streaming Intelligence (0477 + 기존 Observability 재사용) ──────────
// 핵심: Store/Fleet/Playback Health · Quality · Incident · Heartbeat 계산을 새로 만들지
// 않고 기존 WEB-OBS RPC 를 재사용한다(중복 구현 금지). 신규는 전역 재생 스냅샷/시계열만.
// 재사용 RPC(프로덕션 존재): admin_noc_kpi · admin_now_playing_kpi · admin_stream_v2_health
//   · admin_stream_v2_overview · admin_recent_player_errors · admin_noc_store_health_list.

export interface StreamingSummary {
  now_playing: number; online_players: number; offline_players: number; total_players: number;
  online_cutoff_minutes: number;
  today_streams: number; today_listen_seconds: number; avg_listen_seconds: number;
  pb_start: number; pb_complete: number; pb_skip: number; pb_error: number;
  heartbeat_total: number; heartbeat_sessions: number;
  by_device: CountRow[]; by_browser: CountRow[];
  support: Record<string, boolean>;
  generated_at: string | null;
}

export const EMPTY_STREAMING_SUMMARY: StreamingSummary = {
  now_playing: 0, online_players: 0, offline_players: 0, total_players: 0, online_cutoff_minutes: 5,
  today_streams: 0, today_listen_seconds: 0, avg_listen_seconds: 0,
  pb_start: 0, pb_complete: 0, pb_skip: 0, pb_error: 0, heartbeat_total: 0, heartbeat_sessions: 0,
  by_device: [], by_browser: [], support: {}, generated_at: null,
};

export async function fetchStreamingSummary(): Promise<StreamingSummary> {
  const { data, error } = await supabase.rpc('admin_streaming_summary');
  if (error) throw error;
  const d = (data as Partial<StreamingSummary> | null) ?? {};
  return { ...EMPTY_STREAMING_SUMMARY, ...d, by_device: d.by_device ?? [], by_browser: d.by_browser ?? [], support: d.support ?? {} };
}

export type StreamingTimelineRange = '7d' | '30d' | '90d' | '12m';
export interface StreamingTimelinePoint {
  bucket: string; starts: number; completes: number; skips: number; errors: number; streams: number; listen_seconds: number;
}
export interface StreamingTimeline {
  range: StreamingTimelineRange; unit: 'day' | 'month'; start: string | null; end: string | null;
  points: StreamingTimelinePoint[]; generated_at: string | null;
}
const EMPTY_STREAMING_TIMELINE: StreamingTimeline = { range: '30d', unit: 'day', start: null, end: null, points: [], generated_at: null };
export async function fetchStreamingTimeline(range: StreamingTimelineRange = '30d'): Promise<StreamingTimeline> {
  const { data, error } = await supabase.rpc('admin_streaming_timeline', { p_range: range });
  if (error) throw error;
  const d = (data as Partial<StreamingTimeline> | null) ?? {};
  return { ...EMPTY_STREAMING_TIMELINE, ...d, points: d.points ?? [] };
}

// ── 기존 Observability RPC 재사용 (재계산 없음, 값 그대로 노출) ──────────
// 각 fetcher 는 오류를 던지고 컴포넌트가 격리한다. 반환 형태는 원 RPC 문서 기준(loose).

/** NOC/Fleet KPI — admin_noc_kpi() (0385). */
export interface NocKpi {
  total_stores: number; online_stores: number; offline_stores: number;
  emergency_active: number; policy_failed: number; idle_24h: number;
  heartbeat_errors: number; player_errors: number; today_incidents: number; today_recovered: number;
  computed_at: string | null;
}
export async function fetchNocKpi(): Promise<NocKpi | null> {
  const { data, error } = await supabase.rpc('admin_noc_kpi');
  if (error) throw error;
  return (data as NocKpi | null) ?? null;
}

/** Now Playing KPI — admin_now_playing_kpi() (0376). */
export interface NowPlayingKpi {
  total: number; playing: number; paused: number; stopped: number; offline: number;
  error_count: number; recent_track_changes_5m: number; recent_track_changes_1m: number; computed_at: string | null;
}
export async function fetchNowPlayingKpi(): Promise<NowPlayingKpi | null> {
  const { data, error } = await supabase.rpc('admin_now_playing_kpi');
  if (error) throw error;
  return (data as NowPlayingKpi | null) ?? null;
}

/** Streaming v2 Health — admin_stream_v2_health(scope,id,days) (0413). */
export interface StreamV2Health {
  overall_health: number | null; verified_rate: number | null; eligible_rate: number | null;
  heartbeat_success_rate: number | null; fraud_rate: number | null; rejected_rate: number | null;
  top_rejection_reasons?: Array<{ reason: string; count: number }>;
}
export async function fetchStreamV2Health(days = 30): Promise<StreamV2Health | null> {
  const { data, error } = await supabase.rpc('admin_stream_v2_health', { p_scope: 'global', p_id: null, p_days: days });
  if (error) throw error;
  return (data as StreamV2Health | null) ?? null;
}

/** Streaming v2 Overview 퍼널 — admin_stream_v2_overview(days) (0413). */
export interface StreamV2Overview {
  raw: number; play_30s: number; verified: number; eligible: number; settlement_eligible: number;
  rejected_breakdown?: Array<{ reason: string; count: number }>;
  player_type_breakdown?: Array<{ player_type: string; count: number }>;
}
export async function fetchStreamV2Overview(days = 30): Promise<StreamV2Overview | null> {
  const { data, error } = await supabase.rpc('admin_stream_v2_overview', { p_days: days });
  if (error) throw error;
  return (data as StreamV2Overview | null) ?? null;
}

/** 최근 Player 오류 — admin_recent_player_errors(days,limit) (0253). */
export interface PlayerErrorRow { created_at?: string; track_id?: string; message?: string; [k: string]: unknown }
export async function fetchRecentPlayerErrors(days = 30, limit = 20): Promise<PlayerErrorRow[]> {
  const { data, error } = await supabase.rpc('admin_recent_player_errors', { p_days: days, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as PlayerErrorRow[];
}

/** NOC 매장 Health 랭킹 — admin_noc_store_health_list(...) (0385). */
export interface NocStoreHealthRow { store_id?: string; store_name?: string; score?: number; health_tone?: string; [k: string]: unknown }
export async function fetchNocStoreHealth(limit = 20): Promise<NocStoreHealthRow[]> {
  const { data, error } = await supabase.rpc('admin_noc_store_health_list', {
    p_limit: limit, p_min_score: null, p_max_score: null, p_franchise_id: null,
  });
  if (error) throw error;
  return (data ?? []) as NocStoreHealthRow[];
}

// ── Mission Control (0478 + 전면 재사용) ──────────────────────────
// Mission Control 은 기존 Dashboard 의 통합 레이어다. Overview/Health/Timeline 은
// 기존 fetcher(fetchMemberGrowthKpis·fetchRevenueKpis·fetchArtistSummary·
// fetchBusinessSummary/Health·fetchStreamingSummary·fetchNocKpi·fetchNowPlayingKpi
// ·fetchStreamV2Health 등)를 병렬 재사용한다(중복 KPI 계산 없음). 신규는 교차 도메인
// 이벤트 피드(admin_mission_feed) 하나뿐. Alert 는 기존 admin_noc_active_alerts 재사용.

export type MissionFeedKind =
  | 'member_signup' | 'business_signup' | 'artist_signup' | 'artist_approved'
  | 'qc_passed' | 'track_released' | 'subscription' | 'payment_paid' | 'settlement' | 'store_created';

export interface MissionFeedItem { kind: MissionFeedKind; label: string; at: string; ref: string }
export interface MissionFeed { items: MissionFeedItem[]; limit: number; generated_at: string | null }

export async function fetchMissionFeed(limit = 30): Promise<MissionFeed> {
  const { data, error } = await supabase.rpc('admin_mission_feed', { p_limit: limit });
  if (error) throw error;
  const d = (data as Partial<MissionFeed> | null) ?? {};
  return { items: d.items ?? [], limit: d.limit ?? limit, generated_at: d.generated_at ?? null };
}

/** Alert Center — 기존 admin_noc_active_alerts(limit,severity) 재사용. */
export interface NocAlertRow { id?: string; title?: string; message?: string; severity?: string; created_at?: string; store_name?: string; category?: string; [k: string]: unknown }
export async function fetchNocActiveAlerts(limit = 30, severity: string | null = null): Promise<NocAlertRow[]> {
  const { data, error } = await supabase.rpc('admin_noc_active_alerts', { p_limit: limit, p_severity: severity });
  if (error) throw error;
  return (data ?? []) as NocAlertRow[];
}

// ── Action Center (0479 + 기존 action RPC 재사용) ─────────────────
// Action Center 는 운영 실행 계층이다. 실제 실행은 기존 admin RPC 를 재사용하고
// (admin_disable_user/admin_enable_user/admin_force_store_resync/admin_bulk_approve_tracks
//  /admin_retry_pending_qc 등), 여기서는 Command 등록/완료/이력(Audit) 추적만 신규다.
//
// 실행 흐름: registerActionCommand(등록) → 기존 RPC 실행 → completeActionCommand(기록).
// 등록 실패(예: 마이그레이션 미적용·중복 실행) 시 실제 실행을 하지 않는다(Audit 보장).

export type ActionCommandStatus = 'pending' | 'running' | 'success' | 'failed' | 'canceled';

export interface ActionRegisterResult { ok: boolean; command_id: string; status: ActionCommandStatus }

export async function registerActionCommand(input: {
  commandType: string; targetType: string; targetId?: string | null; reason?: string | null; approved?: boolean;
}): Promise<ActionRegisterResult> {
  const { data, error } = await supabase.rpc('admin_action_register', {
    p_command_type: input.commandType, p_target_type: input.targetType,
    p_target_id: input.targetId ?? null, p_reason: input.reason ?? null, p_approved: input.approved ?? false,
  });
  if (error) throw error;
  return data as ActionRegisterResult;
}

export async function completeActionCommand(commandId: string, status: 'success' | 'failed' | 'canceled', result?: unknown, errorMsg?: string | null) {
  const { data, error } = await supabase.rpc('admin_action_complete', {
    p_command_id: commandId, p_status: status, p_result: (result ?? null) as never, p_error: errorMsg ?? null,
  });
  if (error) throw error;
  return data;
}

export interface ActionHistoryRow {
  id: string; command_type: string; target_type: string; target_id: string | null;
  status: ActionCommandStatus; reason: string | null; requested_by: string | null; requested_by_name: string | null;
  approved_by: string | null; requested_at: string; started_at: string | null; completed_at: string | null;
  error: string | null; retry_count: number; duration_seconds: number | null;
}

export async function fetchActionHistory(limit = 30): Promise<ActionHistoryRow[]> {
  const { data, error } = await supabase.rpc('admin_action_history', { p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: ActionHistoryRow[] } | null) ?? {};
  return d.items ?? [];
}

/* 기존 실행 RPC 재사용 wrapper (신규 실행 로직 없음). */
export async function actionForceStoreResync(storeId: string) {
  const { error } = await supabase.rpc('admin_force_store_resync', { p_store_id: storeId });
  if (error) throw error;
}
export async function actionRetryPendingQc(limit = 50) {
  const { data, error } = await supabase.rpc('admin_retry_pending_qc', { p_limit: limit });
  if (error) throw error;
  return data;
}
export async function actionBulkApproveTracks(trackIds: string[], immediate = false) {
  const { data, error } = await supabase.rpc('admin_bulk_approve_tracks', { p_track_ids: trackIds, p_immediate: immediate });
  if (error) throw error;
  return data;
}

// ── Automation Center (0480 + Action Center Command 재사용) ──────────
// 운영 자동화 규칙 저장/게이팅/감사만 신규다. 실제 실행은 Action Center Command
// 모델(0479)과 기존 admin 실행 RPC 재사용. 규칙 생성만으로 실행되지 않으며(비활성+
// dry_run 기본), Auto 는 Kill Switch(global+domain)+risk=low+실행 RPC 존재일 때만.

export interface AutomationRuleRow {
  id: string; name: string; description: string | null;
  domain: string; trigger_type: string; metric: string | null; operator: string | null; threshold: number | null;
  duration_seconds: number | null; scope: string | null;
  action_type: string; action_config: Record<string, unknown>;
  execution_mode: string; risk_level: string; approval_required: boolean;
  cooldown_seconds: number; max_runs_per_day: number; max_targets_per_run: number;
  is_enabled: boolean; dry_run: boolean;
  created_at: string; updated_at: string;
  last_evaluated_at: string | null; last_triggered_at: string | null; last_executed_at: string | null;
  disabled_reason: string | null;
}

export async function fetchAutomationRules(domain?: string | null): Promise<AutomationRuleRow[]> {
  const { data, error } = await supabase.rpc('admin_automation_rule_list', { p_domain: domain ?? null });
  if (error) throw error;
  const d = (data as { items?: AutomationRuleRow[] } | null) ?? {};
  return d.items ?? [];
}

export async function upsertAutomationRule(id: string | null, payload: Record<string, unknown>): Promise<AutomationRuleRow> {
  const { data, error } = await supabase.rpc('admin_automation_rule_upsert', { p_id: id, p_payload: payload as never });
  if (error) throw error;
  return data as AutomationRuleRow;
}

export async function toggleAutomationRule(id: string, opts: { enabled?: boolean; dryRun?: boolean; disabledReason?: string | null }): Promise<AutomationRuleRow> {
  const { data, error } = await supabase.rpc('admin_automation_rule_toggle', {
    p_id: id, p_enabled: opts.enabled ?? null, p_dry_run: opts.dryRun ?? null, p_disabled_reason: opts.disabledReason ?? null,
  });
  if (error) throw error;
  return data as AutomationRuleRow;
}

export interface KillSwitchResult { global: boolean; domains: Record<string, boolean>; generated_at: string }

export async function fetchAutomationKillSwitch(): Promise<KillSwitchResult> {
  const { data, error } = await supabase.rpc('admin_automation_kill_switch_get');
  if (error) throw error;
  const d = (data as Partial<KillSwitchResult> | null) ?? {};
  return { global: d.global ?? false, domains: d.domains ?? {}, generated_at: d.generated_at ?? '' };
}

export async function setAutomationKillSwitch(scope: string, enabled: boolean): Promise<KillSwitchResult> {
  const { data, error } = await supabase.rpc('admin_automation_kill_switch_set', { p_scope: scope, p_enabled: enabled });
  if (error) throw error;
  const d = (data as Partial<KillSwitchResult> | null) ?? {};
  return { global: d.global ?? false, domains: d.domains ?? {}, generated_at: d.generated_at ?? '' };
}

export interface AutomationEvalResult {
  ok: boolean; rule_id: string; condition_met: boolean; decision: string;
  block_reason: string | null; command_id: string | null; dry_run: boolean;
  execution_mode: string; risk_level: string; action_type: string;
}

/** 규칙 평가(서버 게이팅 + 감사). dryRun=true 면 시뮬레이션(Command 생성 없음). */
export async function evaluateAutomationRule(input: {
  ruleId: string; actual: number | null; dryRun?: boolean; supported?: boolean; targetId?: string | null; targetCount?: number | null;
}): Promise<AutomationEvalResult> {
  const { data, error } = await supabase.rpc('admin_automation_evaluate', {
    p_rule_id: input.ruleId, p_actual: input.actual, p_dry_run: input.dryRun ?? true,
    p_supported: input.supported ?? false, p_target_id: input.targetId ?? null, p_target_count: input.targetCount ?? null,
  });
  if (error) throw error;
  return data as AutomationEvalResult;
}

export interface AutomationRunRow {
  id: string; rule_id: string | null; rule_name: string | null; domain: string | null;
  metric: string | null; actual_value: number | null; threshold: number | null; condition_met: boolean | null;
  execution_mode: string | null; decision: string; block_reason: string | null; command_id: string | null;
  target_count: number | null; risk_level: string | null; dry_run: boolean; evaluated_at: string; requested_by_name: string | null;
}

export async function fetchAutomationHistory(opts: { limit?: number; ruleId?: string | null; domain?: string | null; dryRun?: boolean | null } = {}): Promise<AutomationRunRow[]> {
  const { data, error } = await supabase.rpc('admin_automation_history', {
    p_limit: opts.limit ?? 50, p_rule_id: opts.ruleId ?? null, p_domain: opts.domain ?? null, p_dry_run: opts.dryRun ?? null,
  });
  if (error) throw error;
  const d = (data as { items?: AutomationRunRow[] } | null) ?? {};
  return d.items ?? [];
}

// ── AI Recommendation (0481) — Feed 는 실시간 KPI 재사용 계산; DB 는 결정만 저장 ──
// 추천 계산은 프론트(aiRecommendation.ts)가 기존 KPI 로 수행한다. 여기서는 관리자 결정
// (Dismiss/Resolve) 스냅샷/이력만 저장/조회한다. Evidence 없는 추천은 저장 불가(서버 검증).

export interface RecommendationStateInput {
  ruleKey: string; category: string; priority: string; confidence: number; score: number;
  title: string; message?: string | null; evidence: unknown[]; actionRef?: string | null;
  state: 'dismissed' | 'resolved'; commandId?: string | null;
}

export async function setRecommendationState(input: RecommendationStateInput): Promise<{ ok: boolean; id: string; state: string }> {
  const { data, error } = await supabase.rpc('admin_recommendation_set_state', {
    p_rule_key: input.ruleKey, p_category: input.category, p_priority: input.priority,
    p_confidence: input.confidence, p_score: input.score, p_title: input.title, p_message: input.message ?? null,
    p_evidence: input.evidence as never, p_action_ref: input.actionRef ?? null, p_state: input.state, p_command_id: input.commandId ?? null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; state: string };
}

/** 오늘(KST) 처리된 rule_key → state. Feed 숨김 처리용. */
export async function fetchRecommendationActiveStates(): Promise<Record<string, 'dismissed' | 'resolved'>> {
  const { data, error } = await supabase.rpc('admin_recommendation_active_states');
  if (error) throw error;
  const d = (data as { states?: Record<string, 'dismissed' | 'resolved'> } | null) ?? {};
  return d.states ?? {};
}

export interface RecommendationHistoryRow {
  id: string; rule_key: string; gen_date: string; category: string; priority: string;
  confidence: number; score: number; title: string; message: string | null; evidence: unknown[];
  action_ref: string | null; state: string; command_id: string | null; created_at: string; created_by_name: string | null;
}

export async function fetchRecommendationHistory(opts: { limit?: number; category?: string | null } = {}): Promise<RecommendationHistoryRow[]> {
  const { data, error } = await supabase.rpc('admin_recommendation_history', {
    p_limit: opts.limit ?? 50, p_category: opts.category ?? null,
  });
  if (error) throw error;
  const d = (data as { items?: RecommendationHistoryRow[] } | null) ?? {};
  return d.items ?? [];
}

// ── Root Cause / Impact / Outcome / Learning (0482) ──────────────────
// Root Cause 계산은 프론트(rootCauseIntel.ts)가 기존 시계열 재사용해 수행한다(상관≠인과).
// DB 는 스냅샷/Outcome/집계만 저장. Before 필수·After 없이 완료 금지·동일 Command 중복 금지.

export async function saveRootCauseSnapshot(input: {
  recommendationKey: string; analysisStatus: string; candidates: unknown[]; conflicting?: unknown[]; timeWindow?: string | null;
}): Promise<{ ok: boolean; id: string }> {
  const { data, error } = await supabase.rpc('admin_recommendation_root_cause_save', {
    p_recommendation_key: input.recommendationKey, p_analysis_status: input.analysisStatus,
    p_candidates: input.candidates as never, p_conflicting: (input.conflicting ?? []) as never, p_time_window: input.timeWindow ?? null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string };
}

export async function registerOutcome(input: {
  recommendationKey: string; metricKey: string; beforeValue: number; commandId?: string | null;
  actionType?: string | null; direction?: 'lower_better' | 'higher_better'; measurementWindow?: 'immediate' | '1h' | '24h' | '7d';
}): Promise<{ ok: boolean; id: string; status: string }> {
  const { data, error } = await supabase.rpc('admin_recommendation_outcome_register', {
    p_recommendation_key: input.recommendationKey, p_metric_key: input.metricKey, p_before_value: input.beforeValue,
    p_command_id: input.commandId ?? null, p_action_type: input.actionType ?? null,
    p_direction: input.direction ?? 'lower_better', p_measurement_window: input.measurementWindow ?? 'immediate',
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; status: string };
}

export async function evaluateOutcome(outcomeId: string, afterValue: number, status: 'improved' | 'unchanged' | 'worsened' | 'insufficient_data'): Promise<{ ok: boolean; id: string; delta: number; status: string }> {
  const { data, error } = await supabase.rpc('admin_recommendation_outcome_evaluate', {
    p_outcome_id: outcomeId, p_after_value: afterValue, p_outcome_status: status,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; delta: number; status: string };
}

export interface OutcomeRow {
  id: string; recommendation_key: string; command_id: string | null; action_type: string | null; metric_key: string;
  direction: string; measurement_window: string; before_value: number; before_at: string;
  after_value: number | null; after_at: string | null; delta: number | null; outcome_status: string;
  created_at: string; created_by_name: string | null;
}

export async function fetchOutcomes(opts: { limit?: number; recommendationKey?: string | null } = {}): Promise<OutcomeRow[]> {
  const { data, error } = await supabase.rpc('admin_recommendation_outcomes', {
    p_limit: opts.limit ?? 50, p_recommendation_key: opts.recommendationKey ?? null,
  });
  if (error) throw error;
  const d = (data as { items?: OutcomeRow[] } | null) ?? {};
  return d.items ?? [];
}

export interface LearningSignalRow {
  recommendation_key: string; action_type: string | null; times_executed: number;
  improved_count: number; unchanged_count: number; worsened_count: number; insufficient_count: number;
  success_rate: number | null; average_delta: number | null; last_updated_at: string | null;
}

export async function fetchLearningSignals(): Promise<LearningSignalRow[]> {
  const { data, error } = await supabase.rpc('admin_recommendation_learning_signals');
  if (error) throw error;
  const d = (data as { items?: LearningSignalRow[] } | null) ?? {};
  return d.items ?? [];
}

// ── Decision Intelligence (0483 + 기존 outcomes/history 재사용) ──────────
// 추천 순위는 프론트(decisionIntel.ts)가 실제 Outcome/History 집계로 계산한다.
// DB 는 원자료 count 집계(decision_stats) + 순위 스냅샷 저장/이력만. Rule/Weight 자동 변경 없음.

export interface DecisionStatRow {
  recommendation_key: string; considered: number; dismissed: number; resolved: number;
  executed: number; improved: number; unchanged: number; worsened: number; insufficient: number; pending: number;
  avg_delta: number | null; success_rate: number | null; last_at: string | null;
}

export async function fetchDecisionStats(): Promise<DecisionStatRow[]> {
  const { data, error } = await supabase.rpc('admin_recommendation_decision_stats');
  if (error) throw error;
  const d = (data as { items?: DecisionStatRow[] } | null) ?? {};
  return d.items ?? [];
}

export async function saveRankingSnapshot(rankings: unknown[]): Promise<{ ok: boolean; id: string; snapshot_date: string }> {
  const { data, error } = await supabase.rpc('admin_recommendation_ranking_save', { p_rankings: rankings as never });
  if (error) throw error;
  return data as { ok: boolean; id: string; snapshot_date: string };
}

export interface RankingSnapshotRow { snapshot_date: string; rankings: unknown[]; updated_at: string }

export async function fetchRankingHistory(days = 90): Promise<RankingSnapshotRow[]> {
  const { data, error } = await supabase.rpc('admin_recommendation_ranking_history', { p_days: days });
  if (error) throw error;
  const d = (data as { items?: RankingSnapshotRow[] } | null) ?? {};
  return d.items ?? [];
}

// ── Playlist Intelligence (0484 — playback_events_v2 읽기 전용 집계) ────
// 기존 Playback/Queue/Scheduler/Playlist/Policy 무변경. 성과 KPI 읽기 + 추천/학습 기록만.

export type PlaylistRange = '7d' | '30d' | '90d' | '12m';

export interface PlaylistIntelligence {
  range: string;
  playlists: PlaylistKpiRow[];
  industries: IndustryKpiRow[];
  time_bands: BandKpiRow[];
  seasons: SeasonKpiRow[];
  weather_supported: boolean; event_supported: boolean; store_level_supported: boolean;
  generated_at: string | null;
}
export interface PlaylistKpiRow {
  playlist_id: string | null; playlist_title: string | null; events: number; skips: number;
  skip_rate: number | null; completion_rate: number | null; likes: number; replays: number;
  unique_tracks: number; store_type_count: number; last_event_at: string | null;
}
export interface IndustryKpiRow { store_type_slug: string; events: number; skip_rate: number | null; completion_rate: number | null; playlist_count: number; unique_tracks: number }
export interface BandKpiRow { band: string; events: number; skip_rate: number | null; completion_rate: number | null }
export interface SeasonKpiRow { season: string; events: number; skip_rate: number | null; completion_rate: number | null }

export async function fetchPlaylistIntelligence(range: PlaylistRange = '30d'): Promise<PlaylistIntelligence> {
  const { data, error } = await supabase.rpc('admin_playlist_intelligence', { p_range: range });
  if (error) throw error;
  const d = (data as Partial<PlaylistIntelligence> | null) ?? {};
  return {
    range: d.range ?? range, playlists: d.playlists ?? [], industries: d.industries ?? [],
    time_bands: d.time_bands ?? [], seasons: d.seasons ?? [],
    weather_supported: d.weather_supported ?? false, event_supported: d.event_supported ?? false,
    store_level_supported: d.store_level_supported ?? false, generated_at: d.generated_at ?? null,
  };
}

export interface PlaylistRankings {
  top_completion: Array<{ playlist_title: string | null; events: number; completion_rate: number | null }>;
  lowest_skip: Array<{ playlist_title: string | null; events: number; skip_rate: number | null }>;
  top_growth: Array<{ playlist_title: string | null; recent_events: number; prior_events: number; growth_rate: number | null }>;
  range: string; generated_at: string | null;
}
export async function fetchPlaylistRankings(range: PlaylistRange = '30d'): Promise<PlaylistRankings> {
  const { data, error } = await supabase.rpc('admin_playlist_rankings', { p_range: range });
  if (error) throw error;
  const d = (data as Partial<PlaylistRankings> | null) ?? {};
  return { top_completion: d.top_completion ?? [], lowest_skip: d.lowest_skip ?? [], top_growth: d.top_growth ?? [], range: d.range ?? range, generated_at: d.generated_at ?? null };
}

export async function savePlaylistReco(input: {
  ruleKey: string; evidence: unknown[]; storeType?: string | null; timeBand?: string | null;
  targetTitle?: string | null; recommendedTitle?: string | null; reason?: string | null; state?: 'suggested' | 'applied' | 'dismissed';
}): Promise<{ ok: boolean; id: string; state: string }> {
  const { data, error } = await supabase.rpc('admin_playlist_reco_save', {
    p_rule_key: input.ruleKey, p_evidence: input.evidence as never, p_store_type_slug: input.storeType ?? null,
    p_time_band: input.timeBand ?? null, p_target_title: input.targetTitle ?? null, p_recommended_title: input.recommendedTitle ?? null,
    p_reason: input.reason ?? null, p_state: input.state ?? 'suggested',
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; state: string };
}

export interface PlaylistRecoRow {
  id: string; rule_key: string; store_type_slug: string | null; time_band: string | null;
  target_playlist_title: string | null; recommended_title: string | null; reason: string | null;
  evidence: unknown[]; state: string; created_at: string; created_by_name: string | null;
}
export async function fetchPlaylistHistory(limit = 50): Promise<PlaylistRecoRow[]> {
  const { data, error } = await supabase.rpc('admin_playlist_history', { p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: PlaylistRecoRow[] } | null) ?? {};
  return d.items ?? [];
}

export interface PlaylistLearningRow { rule_key: string; total: number; applied: number; dismissed: number; suggested: number; apply_rate: number | null; last_at: string | null }
export async function fetchPlaylistLearning(): Promise<PlaylistLearningRow[]> {
  const { data, error } = await supabase.rpc('admin_playlist_learning');
  if (error) throw error;
  const d = (data as { items?: PlaylistLearningRow[] } | null) ?? {};
  return d.items ?? [];
}

// ── Playlist Experiment (0485 — playback_events_v2 A/B 비교, 자동 교체 없음) ──

export interface PlaylistExperimentRow {
  id: string; name: string; scope_type: string; scope_value: string | null; range: string;
  playlist_a_id: string | null; playlist_a_title: string | null; playlist_b_id: string | null; playlist_b_title: string | null;
  status: string; winner: string | null; result: unknown; evidence: unknown[] | null;
  started_at: string | null; ended_at: string | null; created_at: string; created_by_name?: string | null;
}

export async function fetchPlaylistExperiments(status?: string | null, limit = 50): Promise<PlaylistExperimentRow[]> {
  const { data, error } = await supabase.rpc('admin_playlist_experiments', { p_status: status ?? null, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: PlaylistExperimentRow[] } | null) ?? {};
  return d.items ?? [];
}

export async function upsertPlaylistExperiment(id: string | null, payload: Record<string, unknown>): Promise<PlaylistExperimentRow> {
  const { data, error } = await supabase.rpc('admin_playlist_experiment_upsert', { p_id: id, p_payload: payload as never });
  if (error) throw error;
  return data as PlaylistExperimentRow;
}

export async function setPlaylistExperimentStatus(id: string, status: 'draft' | 'running' | 'completed' | 'cancelled'): Promise<PlaylistExperimentRow> {
  const { data, error } = await supabase.rpc('admin_playlist_experiment_set_status', { p_id: id, p_status: status });
  if (error) throw error;
  return data as PlaylistExperimentRow;
}

export interface PlaylistCompareRow {
  playlist_id: string | null; playlist_title: string | null; events: number; skips: number;
  skip_rate: number | null; completion_rate: number | null; avg_listen_seconds: number | null;
  likes: number; replays: number; unique_tracks: number;
}
export interface PlaylistCompareResult {
  playlist_a: string; playlist_b: string; scope_type: string; scope_value: string | null; range: string;
  rows: PlaylistCompareRow[]; generated_at: string | null;
}
export async function comparePlaylists(input: {
  playlistA: string; playlistB: string; scopeType?: string; scopeValue?: string | null; range?: string;
}): Promise<PlaylistCompareResult> {
  const { data, error } = await supabase.rpc('admin_playlist_compare', {
    p_playlist_a: input.playlistA, p_playlist_b: input.playlistB,
    p_scope_type: input.scopeType ?? 'all', p_scope_value: input.scopeValue ?? null, p_range: input.range ?? '30d',
  });
  if (error) throw error;
  const d = (data as Partial<PlaylistCompareResult> | null) ?? {};
  return { playlist_a: d.playlist_a ?? input.playlistA, playlist_b: d.playlist_b ?? input.playlistB, scope_type: d.scope_type ?? 'all', scope_value: d.scope_value ?? null, range: d.range ?? '30d', rows: d.rows ?? [], generated_at: d.generated_at ?? null };
}

export async function concludePlaylistExperiment(id: string, winner: 'a' | 'b' | 'tie' | 'insufficient', result: unknown, evidence: unknown[]): Promise<PlaylistExperimentRow> {
  const { data, error } = await supabase.rpc('admin_playlist_experiment_conclude', {
    p_id: id, p_winner: winner, p_result: result as never, p_evidence: evidence as never,
  });
  if (error) throw error;
  return data as PlaylistExperimentRow;
}

export interface ExperimentLearningRow { playlist_title: string; wins: number; appearances: number }
export async function fetchExperimentLearning(): Promise<ExperimentLearningRow[]> {
  const { data, error } = await supabase.rpc('admin_playlist_experiment_learning');
  if (error) throw error;
  const d = (data as { items?: ExperimentLearningRow[] } | null) ?? {};
  return d.items ?? [];
}

// ── Track Rollout (0486 — 신규 음원 점진 확산; 자동 배포 없음) ────────────
// 기존 Playback/Queue/Scheduler/Playlist/Recommendation/Experiment 무변경. per-track KPI
// 읽기(playback_events_v2) + rollout 상태/이력 저장만. 승격/Rollback 판정은 프론트.

export interface TrackRolloutRow {
  id: string; track_id: string; track_title: string | null; stage: string; scope_type: string; scope_value: string | null;
  rollout_percent: number; promotion_config: { completion_min: number; skip_max: number; sample_min: number; rollback_skip_max: number; rollback_completion_min: number };
  notes: string | null; last_evaluated_at: string | null; created_at: string; updated_at: string; created_by_name?: string | null;
}

export async function fetchTrackRollouts(stage?: string | null, limit = 100): Promise<TrackRolloutRow[]> {
  const { data, error } = await supabase.rpc('admin_track_rollouts', { p_stage: stage ?? null, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: TrackRolloutRow[] } | null) ?? {};
  return d.items ?? [];
}

export async function upsertTrackRollout(id: string | null, payload: Record<string, unknown>): Promise<TrackRolloutRow> {
  const { data, error } = await supabase.rpc('admin_track_rollout_upsert', { p_id: id, p_payload: payload as never });
  if (error) throw error;
  return data as TrackRolloutRow;
}

export async function setTrackRolloutStage(input: {
  id: string; toStage: string; decision: 'promote' | 'hold' | 'rollback' | 'archive' | 'manual';
  toPercent?: number | null; evidence?: unknown[] | null; reason?: string | null;
}): Promise<TrackRolloutRow> {
  const { data, error } = await supabase.rpc('admin_track_rollout_set_stage', {
    p_id: input.id, p_to_stage: input.toStage, p_decision: input.decision,
    p_to_percent: input.toPercent ?? null, p_evidence: (input.evidence ?? null) as never, p_reason: input.reason ?? null,
  });
  if (error) throw error;
  return data as TrackRolloutRow;
}

export interface TrackRolloutKpi {
  events: number; skips: number; skip_rate: number | null; completion_rate: number | null;
  avg_listen_seconds: number | null; likes: number; replays: number; store_coverage: number; playlist_coverage: number;
}
export interface TrackRolloutCompare { track_id: string; scope_type: string; scope_value: string | null; range: string; kpi: TrackRolloutKpi | null; generated_at: string | null }

export async function compareTrackRollout(input: { trackId: string; scopeType?: string; scopeValue?: string | null; range?: string }): Promise<TrackRolloutCompare> {
  const { data, error } = await supabase.rpc('admin_track_rollout_compare', {
    p_track_id: input.trackId, p_scope_type: input.scopeType ?? 'all', p_scope_value: input.scopeValue ?? null, p_range: input.range ?? '30d',
  });
  if (error) throw error;
  const d = (data as Partial<TrackRolloutCompare> | null) ?? {};
  return { track_id: d.track_id ?? input.trackId, scope_type: d.scope_type ?? 'all', scope_value: d.scope_value ?? null, range: d.range ?? '30d', kpi: d.kpi ?? null, generated_at: d.generated_at ?? null };
}

export interface TrackRolloutHistoryRow {
  id: string; rollout_id: string; track_id: string | null; from_stage: string | null; to_stage: string | null;
  decision: string; from_percent: number | null; to_percent: number | null; evidence: unknown[] | null; reason: string | null; created_at: string; created_by_name: string | null;
}
export async function fetchTrackRolloutHistory(limit = 100, trackId?: string | null): Promise<TrackRolloutHistoryRow[]> {
  const { data, error } = await supabase.rpc('admin_track_rollout_history', { p_limit: limit, p_track_id: trackId ?? null });
  if (error) throw error;
  const d = (data as { items?: TrackRolloutHistoryRow[] } | null) ?? {};
  return d.items ?? [];
}

export interface TrackRolloutLearning { by_decision: Record<string, number>; stage_distribution: Record<string, number>; total_rollouts: number; generated_at: string | null }
export async function fetchTrackRolloutLearning(): Promise<TrackRolloutLearning> {
  const { data, error } = await supabase.rpc('admin_track_rollout_learning');
  if (error) throw error;
  const d = (data as Partial<TrackRolloutLearning> | null) ?? {};
  return { by_decision: d.by_decision ?? {}, stage_distribution: d.stage_distribution ?? {}, total_rollouts: d.total_rollouts ?? 0, generated_at: d.generated_at ?? null };
}

// ── Playlist Generator (0487 — 실제 메타/KPI 기반 Draft; 자동 Publish 없음) ──

export interface GeneratorPoolTrack {
  track_id: string; title: string | null; artist: string | null; main_genre: string | null; mood: string | null;
  bpm: number | null; duration: number | null; language: string | null;
  events: number; skip_rate: number | null; completion_rate: number | null; likes: number; replays: number;
  last_event_at: string | null; store_coverage: number | null; rollout_stage: string | null;
}
export async function fetchGeneratorPool(range = '30d', limit = 300): Promise<GeneratorPoolTrack[]> {
  const { data, error } = await supabase.rpc('admin_generator_track_pool', { p_range: range, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: GeneratorPoolTrack[] } | null) ?? {};
  return d.items ?? [];
}

export interface BrandDnaRow { brand_key: string; brand_label: string | null; profile: Record<string, unknown>; source: string; updated_at: string }
export async function fetchBrandDna(): Promise<BrandDnaRow[]> {
  const { data, error } = await supabase.rpc('admin_brand_dna_list');
  if (error) throw error;
  const d = (data as { items?: BrandDnaRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function upsertBrandDna(brandKey: string, brandLabel: string | null, profile: Record<string, unknown>): Promise<BrandDnaRow> {
  const { data, error } = await supabase.rpc('admin_brand_dna_upsert', { p_brand_key: brandKey, p_brand_label: brandLabel, p_profile: profile as never });
  if (error) throw error;
  return data as BrandDnaRow;
}

export interface PlaylistDraftRow {
  id: string; name: string; store_type: string | null; brand_key: string | null; time_band: string | null; season: string | null; event_key: string | null;
  config: Record<string, unknown>; tracks: unknown[]; excluded: unknown[]; simulation: unknown; status: string; created_at: string; created_by_name?: string | null;
}
export async function savePlaylistDraft(payload: Record<string, unknown>): Promise<PlaylistDraftRow> {
  const { data, error } = await supabase.rpc('admin_playlist_draft_save', { p_payload: payload as never });
  if (error) throw error;
  return data as PlaylistDraftRow;
}
export async function fetchPlaylistDrafts(status?: string | null, limit = 50): Promise<PlaylistDraftRow[]> {
  const { data, error } = await supabase.rpc('admin_playlist_drafts', { p_status: status ?? null, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: PlaylistDraftRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function setPlaylistDraftStatus(id: string, status: 'draft' | 'approved' | 'rejected'): Promise<PlaylistDraftRow> {
  const { data, error } = await supabase.rpc('admin_playlist_draft_set_status', { p_id: id, p_status: status });
  if (error) throw error;
  return data as PlaylistDraftRow;
}

// ── Adaptive Rotation (0488 — Sequencing; 자동 Queue/Scheduler 반영 없음) ──

export interface RotationPoolTrack {
  track_id: string; title: string | null; artist: string | null; main_genre: string | null; mood: string | null;
  bpm: number | null; duration: number | null; language: string | null;
  events: number; skip_rate: number | null; completion_rate: number | null; likes: number; replays: number;
  p1d: number; p7d: number; p30d: number; last_played_at: string | null; days_since_last_play: number | null;
  store_coverage: number | null; rollout_stage: string | null;
}
export async function fetchRotationPool(range = '30d', limit = 500, storeType?: string | null): Promise<RotationPoolTrack[]> {
  const { data, error } = await supabase.rpc('admin_rotation_track_pool', { p_range: range, p_limit: limit, p_store_type: storeType ?? null });
  if (error) throw error;
  const d = (data as { items?: RotationPoolTrack[] } | null) ?? {};
  return d.items ?? [];
}

export interface RotationDraftRow {
  id: string; source_playlist_draft_id: string | null; name: string; store_type_slug: string | null; brand_key: string | null;
  daypart: string | null; season: string | null; target_duration_minutes: number | null; status: string;
  config: Record<string, unknown>; sequence: unknown[]; simulation: unknown; evidence: unknown[]; created_at: string; created_by_name?: string | null;
}
export async function saveRotationDraft(payload: Record<string, unknown>): Promise<RotationDraftRow> {
  const { data, error } = await supabase.rpc('admin_rotation_draft_save', { p_payload: payload as never });
  if (error) throw error;
  return data as RotationDraftRow;
}
export async function fetchRotationDrafts(status?: string | null, limit = 50): Promise<RotationDraftRow[]> {
  const { data, error } = await supabase.rpc('admin_rotation_drafts', { p_status: status ?? null, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: RotationDraftRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function setRotationDraftStatus(id: string, status: 'draft' | 'simulated' | 'approved' | 'rejected' | 'archived', note?: string | null): Promise<RotationDraftRow> {
  const { data, error } = await supabase.rpc('admin_rotation_draft_set_status', { p_id: id, p_status: status, p_note: note ?? null });
  if (error) throw error;
  return data as RotationDraftRow;
}
export interface RotationHistoryRow { id: string; draft_id: string; action: string; from_status: string | null; to_status: string | null; note: string | null; created_at: string; created_by_name: string | null }
export async function fetchRotationHistory(limit = 100): Promise<RotationHistoryRow[]> {
  const { data, error } = await supabase.rpc('admin_rotation_history', { p_limit: limit, p_draft_id: null });
  if (error) throw error;
  const d = (data as { items?: RotationHistoryRow[] } | null) ?? {};
  return d.items ?? [];
}
export interface RotationLearning { by_status: Record<string, number>; total: number; approved: number; rejected: number; approval_rate: number | null }
export async function fetchRotationLearning(): Promise<RotationLearning> {
  const { data, error } = await supabase.rpc('admin_rotation_learning');
  if (error) throw error;
  const d = (data as Partial<RotationLearning> | null) ?? {};
  return { by_status: d.by_status ?? {}, total: d.total ?? 0, approved: d.approved ?? 0, rejected: d.rejected ?? 0, approval_rate: d.approval_rate ?? null };
}

// ── Track Intelligence (0489 — Track 중심 성과 학습, 읽기 전용) ──────────

export interface TrackIntelRow {
  track_id: string; title: string | null; artist: string | null; main_genre: string | null; mood: string | null;
  bpm: number | null; duration: number | null;
  events: number; skip_rate: number | null; completion_rate: number | null; likes: number; replays: number;
  p7d: number; p30d: number; p90d: number; uniq_playlists: number; uniq_store_types: number;
  last_played_at: string | null; days_since_last_play: number | null; rollout_stage: string | null;
}
export async function fetchTrackIntelList(range = '90d', limit = 200): Promise<TrackIntelRow[]> {
  const { data, error } = await supabase.rpc('admin_track_intel_list', { p_range: range, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: TrackIntelRow[] } | null) ?? {};
  return d.items ?? [];
}

export interface TrackIntelBreakdownRow { key: string; events: number; completion_rate: number | null; skip_rate: number | null }
export interface TrackIntelDetail {
  track_id: string; range: string; summary: Record<string, unknown> | null;
  by_industry: TrackIntelBreakdownRow[]; by_daypart: TrackIntelBreakdownRow[]; by_season: TrackIntelBreakdownRow[]; by_playlist: TrackIntelBreakdownRow[];
  brand_supported: boolean; generated_at: string | null;
}
export async function fetchTrackIntelDetail(trackId: string, range = '90d'): Promise<TrackIntelDetail> {
  const { data, error } = await supabase.rpc('admin_track_intel_detail', { p_track_id: trackId, p_range: range });
  if (error) throw error;
  const d = (data as Partial<TrackIntelDetail> | null) ?? {};
  return {
    track_id: d.track_id ?? trackId, range: d.range ?? range, summary: d.summary ?? null,
    by_industry: d.by_industry ?? [], by_daypart: d.by_daypart ?? [], by_season: d.by_season ?? [], by_playlist: d.by_playlist ?? [],
    brand_supported: d.brand_supported ?? false, generated_at: d.generated_at ?? null,
  };
}

// ── Context Intelligence (0490 — 상황 조합 기준 성과 학습, 읽기 전용) ──────

export interface ContextOverviewItem {
  store_type: string; events: number; track_count: number; playlist_count: number;
  completion_rate: number | null; skip_rate: number | null; avg_listen_seconds: number | null; last_event_at: string | null;
}
export interface ContextOverview {
  range: string; items: ContextOverviewItem[];
  season_range: { distinct_seasons: number; earliest: string | null; latest: string | null } | null;
  generated_at: string | null;
}
export async function fetchContextOverview(range = '30d'): Promise<ContextOverview> {
  const { data, error } = await supabase.rpc('admin_context_overview', { p_range: range });
  if (error) throw error;
  const d = (data as Partial<ContextOverview> | null) ?? {};
  return { range: d.range ?? range, items: d.items ?? [], season_range: d.season_range ?? null, generated_at: d.generated_at ?? null };
}

export interface ContextDetailResp {
  store_type: string;
  requested: { daypart: string | null; weekday_group: string | null };
  resolved: { grain: Grain; daypart: string | null; weekday_group: string | null; fallback: boolean };
  candidate_samples: { l1: number; l2: number; l3: number; min_sample: number };
  range: string; summary: ContextSummary;
  tracks: ContextTrackRow[]; playlists: ContextPlaylistRow[];
  genres: GenreMoodRow[]; moods: GenreMoodRow[]; baseline: ContextBaseline; generated_at: string;
}
export async function fetchContextDetail(
  storeType: string, daypart: string | null = null, weekdayGroup: string | null = null, range = '30d', minSample = 20,
): Promise<ContextDetailResp> {
  const { data, error } = await supabase.rpc('admin_context_detail', {
    p_store_type: storeType, p_daypart: daypart, p_weekday_group: weekdayGroup, p_range: range, p_min_sample: minSample,
  });
  if (error) throw error;
  return data as ContextDetailResp;
}

export interface ContextTrendResp {
  store_type: string; daypart: string | null; weekday_group: string | null; range: string; bucket: string;
  series: TrendPoint[]; generated_at: string | null;
}
export async function fetchContextTrend(
  storeType: string, daypart: string | null = null, weekdayGroup: string | null = null, range = '90d',
): Promise<ContextTrendResp> {
  const { data, error } = await supabase.rpc('admin_context_trend', {
    p_store_type: storeType, p_daypart: daypart, p_weekday_group: weekdayGroup, p_range: range,
  });
  if (error) throw error;
  const d = (data as Partial<ContextTrendResp> | null) ?? {};
  return {
    store_type: d.store_type ?? storeType, daypart: d.daypart ?? null, weekday_group: d.weekday_group ?? null,
    range: d.range ?? range, bucket: d.bucket ?? 'week', series: d.series ?? [], generated_at: d.generated_at ?? null,
  };
}

// ── Context Evolution & Adaptive Learning (0491 — Learning Signal 전용, 자동 반영 없음) ──

export interface ContextDriftResp {
  store_type: string; daypart: string | null; weekday_group: string | null; range: string;
  recent: DriftWindow | null; prior: DriftWindow | null;
  recent_window: { from: string; to: string } | null; prior_window: { from: string; to: string } | null;
  generated_at: string | null; supported?: boolean; reason?: string;
}
export async function fetchContextDrift(
  storeType: string, daypart: string | null = null, weekdayGroup: string | null = null, range = '30d',
): Promise<ContextDriftResp> {
  const { data, error } = await supabase.rpc('admin_context_drift', {
    p_store_type: storeType, p_daypart: daypart, p_weekday_group: weekdayGroup, p_range: range,
  });
  if (error) throw error;
  return data as ContextDriftResp;
}

export async function fetchContextSimilarity(range = '30d', minSample = 20, limit = 50): Promise<{ range: string; min_sample: number; items: ContextFeature[]; generated_at: string | null }> {
  const { data, error } = await supabase.rpc('admin_context_similarity', { p_range: range, p_min_sample: minSample, p_limit: limit });
  if (error) throw error;
  const d = (data as { range?: string; min_sample?: number; items?: ContextFeature[]; generated_at?: string } | null) ?? {};
  return { range: d.range ?? range, min_sample: d.min_sample ?? minSample, items: d.items ?? [], generated_at: d.generated_at ?? null };
}

export async function saveContextSnapshot(payload: Record<string, unknown>): Promise<Snapshot> {
  const { data, error } = await supabase.rpc('admin_context_snapshot_save', { p_payload: payload });
  if (error) throw error;
  return data as Snapshot;
}
export async function fetchContextMemory(contextKey: string | null = null, limit = 100): Promise<Snapshot[]> {
  const { data, error } = await supabase.rpc('admin_context_memory', { p_context_key: contextKey, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: Snapshot[] } | null) ?? {};
  return d.items ?? [];
}

export async function saveContextReco(payload: Record<string, unknown>): Promise<RecoOutcomeRow> {
  const { data, error } = await supabase.rpc('admin_context_reco_save', { p_payload: payload });
  if (error) throw error;
  return data as RecoOutcomeRow;
}
export async function resolveContextReco(id: string, status: string, outcome: string | null = null, afterKpi: Record<string, unknown> | null = null): Promise<RecoOutcomeRow> {
  const { data, error } = await supabase.rpc('admin_context_reco_resolve', { p_id: id, p_status: status, p_outcome: outcome, p_after_kpi: afterKpi });
  if (error) throw error;
  return data as RecoOutcomeRow;
}
export async function fetchContextRecos(contextKey: string | null = null, status: string | null = null, limit = 100): Promise<RecoOutcomeRow[]> {
  const { data, error } = await supabase.rpc('admin_context_reco_list', { p_context_key: contextKey, p_status: status, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: RecoOutcomeRow[] } | null) ?? {};
  return d.items ?? [];
}

export interface ContextLearningResp {
  context_key: string | null; by_status: Record<string, number>;
  by_type: Array<{ reco_type: string; total: number; applied: number; dismissed: number; improved: number; neutral: number; degraded: number }>;
  totals: { total: number; applied: number; dismissed: number; resolved_outcomes: number; improved: number; degraded: number } | null;
  generated_at: string | null;
}
export async function fetchContextLearning(contextKey: string | null = null): Promise<ContextLearningResp> {
  const { data, error } = await supabase.rpc('admin_context_learning', { p_context_key: contextKey });
  if (error) throw error;
  const d = (data as Partial<ContextLearningResp> | null) ?? {};
  return { context_key: d.context_key ?? contextKey, by_status: d.by_status ?? {}, by_type: d.by_type ?? [], totals: d.totals ?? null, generated_at: d.generated_at ?? null };
}

// ── Predictive Intelligence (0492 — 예측·시뮬레이션 전용, 자동 반영 없음) ──

export interface PredictionScanResp {
  range: string; min_sample: number; half_days: number; items: ScanRow[]; generated_at: string | null;
}
export async function fetchPredictionScan(range = '30d', minSample = 20): Promise<PredictionScanResp> {
  const { data, error } = await supabase.rpc('admin_prediction_scan', { p_range: range, p_min_sample: minSample });
  if (error) throw error;
  const d = (data as Partial<PredictionScanResp> | null) ?? {};
  return { range: d.range ?? range, min_sample: d.min_sample ?? minSample, half_days: d.half_days ?? 15, items: d.items ?? [], generated_at: d.generated_at ?? null };
}

export interface PredictionSnapshot {
  id?: string; context_key: string; prediction_type: string; horizon?: string | null;
  prediction?: Record<string, unknown>; confidence?: number | null; evidence?: Array<{ label: string; value: string | number | null }>; created_at: string;
}
export async function savePredictionSnapshot(payload: Record<string, unknown>): Promise<PredictionSnapshot> {
  const { data, error } = await supabase.rpc('admin_prediction_snapshot_save', { p_payload: payload });
  if (error) throw error;
  return data as PredictionSnapshot;
}
export async function fetchPredictionHistory(contextKey: string | null = null, predictionType: string | null = null, limit = 100): Promise<PredictionSnapshot[]> {
  const { data, error } = await supabase.rpc('admin_prediction_history', { p_context_key: contextKey, p_prediction_type: predictionType, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: PredictionSnapshot[] } | null) ?? {};
  return d.items ?? [];
}

// ── Optimization Strategy (0493 — 전략 제안·시뮬레이션 전용, 자동 실행 없음) ──

export interface StrategyRow {
  id?: string; context_key: string; strategy_type: string; target: string | null;
  roi_score: number | null; risk_score: number | null; cost_score: number | null; confidence: number | null;
  expected_gain: Record<string, number> | null; evidence: Array<{ label: string; value: string | number | null }>;
  status: string; outcome: string | null; before_kpi: Record<string, unknown> | null; after_kpi: Record<string, unknown> | null;
  created_at: string; resolved_at: string | null;
}
export async function saveStrategy(payload: Record<string, unknown>): Promise<StrategyRow> {
  const { data, error } = await supabase.rpc('admin_strategy_save', { p_payload: payload });
  if (error) throw error;
  return data as StrategyRow;
}
export async function fetchStrategyMemory(contextKey: string | null = null, status: string | null = null, limit = 100): Promise<StrategyRow[]> {
  const { data, error } = await supabase.rpc('admin_strategy_memory', { p_context_key: contextKey, p_status: status, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: StrategyRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function resolveStrategy(id: string, status: string, outcome: string | null = null, afterKpi: Record<string, unknown> | null = null): Promise<StrategyRow> {
  const { data, error } = await supabase.rpc('admin_strategy_resolve', { p_id: id, p_status: status, p_outcome: outcome, p_after_kpi: afterKpi });
  if (error) throw error;
  return data as StrategyRow;
}
export interface StrategyLearningResp {
  context_key: string | null; by_status: Record<string, number>;
  by_type: Array<{ strategy_type: string; total: number; approved: number; dismissed: number; improved: number; degraded: number; avg_roi: number | null }>;
  totals: { total: number; approved: number; dismissed: number; resolved_outcomes: number; improved: number; degraded: number } | null;
  generated_at: string | null;
}
export async function fetchStrategyLearning(contextKey: string | null = null): Promise<StrategyLearningResp> {
  const { data, error } = await supabase.rpc('admin_strategy_learning', { p_context_key: contextKey });
  if (error) throw error;
  const d = (data as Partial<StrategyLearningResp> | null) ?? {};
  return { context_key: d.context_key ?? contextKey, by_status: d.by_status ?? {}, by_type: d.by_type ?? [], totals: d.totals ?? null, generated_at: d.generated_at ?? null };
}

// ── Strategy Sandbox (0494 — 격리 검증·시뮬레이션 전용, Production 무변경/자동 실행 없음) ──

export async function fetchSandboxConstraints(storeType: string): Promise<GuardrailSource> {
  const { data, error } = await supabase.rpc('admin_sandbox_constraints', { p_store_type: storeType });
  if (error) throw error;
  const d = (data as Partial<GuardrailSource> | null) ?? {};
  return { store_type: d.store_type ?? storeType, genre_guardrails: d.genre_guardrails ?? [], store_guardrails: d.store_guardrails ?? [] };
}
export interface SandboxRunRow {
  id?: string; strategy_id: string | null; context_key: string; run_name: string | null;
  run_status: string; review_status: string; objective: string | null; scenario: string | null; decision: string | null;
  safety_score: number | null; benefit_score: number | null; roi_score: number | null; risk_score: number | null; cost_score: number | null;
  sample_size: number | null; confidence: number | null; hard_constraint_pass: boolean | null; fallback_used: boolean | null;
  created_at: string; completed_at: string | null; expired_at: string | null;
  strategy_snapshot?: Record<string, unknown>; baseline_snapshot?: Record<string, unknown>; constraint_snapshot?: Record<string, unknown>;
  simulation_result?: Record<string, unknown>; validation_result?: Record<string, unknown>; evidence?: Array<{ label: string; value: string | number | boolean | null }>;
}
export async function createSandboxRun(payload: Record<string, unknown>): Promise<SandboxRunRow> {
  const { data, error } = await supabase.rpc('admin_sandbox_create', { p_payload: payload });
  if (error) throw error;
  return data as SandboxRunRow;
}
export interface SandboxAuditRow { id: string; sandbox_run_id: string; action: string; previous_state: string | null; next_state: string | null; actor_id: string | null; reason: string | null; created_at: string }
export async function fetchSandboxDetail(runId: string): Promise<{ run: SandboxRunRow | null; audit: SandboxAuditRow[] }> {
  const { data, error } = await supabase.rpc('admin_sandbox_detail', { p_run_id: runId });
  if (error) throw error;
  const d = (data as { found?: boolean; run?: SandboxRunRow; audit?: SandboxAuditRow[] } | null) ?? {};
  return { run: d.run ?? null, audit: d.audit ?? [] };
}
export async function fetchSandboxHistory(contextKey: string | null = null, runStatus: string | null = null, reviewStatus: string | null = null, limit = 100): Promise<SandboxRunRow[]> {
  const { data, error } = await supabase.rpc('admin_sandbox_history', { p_context_key: contextKey, p_run_status: runStatus, p_review_status: reviewStatus, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: SandboxRunRow[] } | null) ?? {};
  return d.items ?? [];
}
export interface SandboxSummary {
  total: number; passed: number; review_required: number; rejected: number; insufficient_data: number;
  failures: number; expired: number; approval_candidates: number; avg_safety: number | null; avg_benefit: number | null; avg_roi: number | null;
}
export async function fetchSandboxSummary(contextKey: string | null = null): Promise<SandboxSummary | null> {
  const { data, error } = await supabase.rpc('admin_sandbox_summary', { p_context_key: contextKey });
  if (error) throw error;
  const d = (data as { summary?: SandboxSummary } | null) ?? {};
  return d.summary ?? null;
}
export async function markSandboxReview(runId: string, reviewStatus: string, reason: string | null = null): Promise<SandboxRunRow> {
  const { data, error } = await supabase.rpc('admin_sandbox_mark_review', { p_run_id: runId, p_review_status: reviewStatus, p_reason: reason });
  if (error) throw error;
  return data as SandboxRunRow;
}

// ── Draft Promotion Gateway (0495 — 운영자 승인 기반 Draft 변환, Production 무변경/자동 실행 없음) ──

export interface EligibleRunRow {
  sandbox_run_id: string; strategy_id: string | null; context_key: string; run_status: string; review_status: string;
  decision: string | null; scenario: string | null; objective: string | null; safety_score: number | null; benefit_score: number | null;
  roi_score: number | null; risk_score: number | null; cost_score: number | null; confidence: number | null; sample_size: number | null;
  hard_constraint_pass: boolean | null; input_hash: string | null; model_version: string | null; strategy_snapshot: Record<string, unknown> | null; created_at: string; expired_at: string | null;
}
export async function fetchEligibleRuns(contextKey: string | null = null, limit = 100): Promise<EligibleRunRow[]> {
  const { data, error } = await supabase.rpc('admin_promotion_eligible_runs', { p_context_key: contextKey, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: EligibleRunRow[] } | null) ?? {};
  return d.items ?? [];
}
export interface PromotionRequestRow {
  id?: string; sandbox_run_id: string | null; strategy_id: string | null; context_key: string; requested_draft_type: string;
  request_status: string; risk_tier: string | null; approval_readiness: number | null; additional_approval_required: boolean | null;
  requested_by: string | null; reviewed_by: string | null; approved_by: string | null; rejected_by: string | null;
  rejection_reason: string | null; approval_reason: string | null; draft_reference: string | null; idempotency_key: string | null;
  source_input_hash: string | null; source_model_version: string | null; created_at: string;
}
export async function createPromotionRequest(payload: Record<string, unknown>): Promise<{ idempotent: boolean; request: PromotionRequestRow }> {
  const { data, error } = await supabase.rpc('admin_promotion_request', { p_payload: payload });
  if (error) throw error;
  return data as { idempotent: boolean; request: PromotionRequestRow };
}
export async function reviewPromotion(id: string, reason: string | null = null): Promise<PromotionRequestRow> {
  const { data, error } = await supabase.rpc('admin_promotion_review', { p_id: id, p_reason: reason });
  if (error) throw error; return data as PromotionRequestRow;
}
export async function approvePromotion(id: string, reason: string | null = null): Promise<PromotionRequestRow> {
  const { data, error } = await supabase.rpc('admin_promotion_approve', { p_id: id, p_reason: reason });
  if (error) throw error; return data as PromotionRequestRow;
}
export async function rejectPromotion(id: string, reason: string | null = null): Promise<PromotionRequestRow> {
  const { data, error } = await supabase.rpc('admin_promotion_reject', { p_id: id, p_reason: reason });
  if (error) throw error; return data as PromotionRequestRow;
}
export interface PromotionDraftRow {
  id?: string; promotion_request_id: string | null; sandbox_run_id: string | null; strategy_id: string | null; context_key: string;
  draft_type: string; draft_status: string; canary_status: string; risk_tier: string | null; canary_readiness: number | null; approval_readiness: number | null;
  payload: Record<string, unknown> | null; validation_result: Record<string, unknown> | null; guardrail_result: Record<string, unknown> | null;
  go_criteria: Record<string, unknown> | null; rollback_plan: Record<string, unknown> | null; observation_plan: Record<string, unknown> | null;
  source_input_hash: string | null; source_model_version: string | null; created_at: string; updated_at: string | null; expired_at: string | null;
}
export async function convertPromotionDraft(requestId: string, payload: Record<string, unknown>): Promise<{ idempotent: boolean; draft: PromotionDraftRow }> {
  const { data, error } = await supabase.rpc('admin_promotion_convert_draft', { p_request_id: requestId, p_payload: payload });
  if (error) throw error; return data as { idempotent: boolean; draft: PromotionDraftRow };
}
export async function validatePromotionDraft(draftId: string, payload: Record<string, unknown>): Promise<PromotionDraftRow> {
  const { data, error } = await supabase.rpc('admin_promotion_draft_validate', { p_draft_id: draftId, p_payload: payload });
  if (error) throw error; return data as PromotionDraftRow;
}
export async function markCanaryCandidate(draftId: string, reason: string | null = null): Promise<PromotionDraftRow> {
  const { data, error } = await supabase.rpc('admin_promotion_mark_canary_candidate', { p_draft_id: draftId, p_reason: reason });
  if (error) throw error; return data as PromotionDraftRow;
}
export async function removeCanaryCandidate(draftId: string, reason: string | null = null): Promise<PromotionDraftRow> {
  const { data, error } = await supabase.rpc('admin_promotion_remove_canary_candidate', { p_draft_id: draftId, p_reason: reason });
  if (error) throw error; return data as PromotionDraftRow;
}
export interface PromotionAuditRow { id: string; request_id: string | null; draft_id: string | null; action: string; previous_state: string | null; next_state: string | null; actor_id: string | null; reason: string | null; created_at: string }
export async function fetchPromotionDraftDetail(draftId: string): Promise<{ draft: PromotionDraftRow | null; audit: PromotionAuditRow[] }> {
  const { data, error } = await supabase.rpc('admin_promotion_draft_detail', { p_draft_id: draftId });
  if (error) throw error;
  const d = (data as { found?: boolean; draft?: PromotionDraftRow; audit?: PromotionAuditRow[] } | null) ?? {};
  return { draft: d.draft ?? null, audit: d.audit ?? [] };
}
export async function fetchPromotionHistory(contextKey: string | null = null, kind: 'requests' | 'drafts' = 'requests', limit = 100): Promise<Array<PromotionRequestRow | PromotionDraftRow>> {
  const { data, error } = await supabase.rpc('admin_promotion_history', { p_context_key: contextKey, p_kind: kind, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: Array<PromotionRequestRow | PromotionDraftRow> } | null) ?? {};
  return d.items ?? [];
}
export interface PromotionSummary {
  requests: { total: number; pending_reviews: number; approved: number; rejected: number; converted: number; expired: number; high_risk: number; critical_risk: number; avg_approval_readiness: number | null } | null;
  drafts: { total: number; ready: number; validation_failed: number; canary_candidates: number; expired: number; avg_canary_readiness: number | null } | null;
}
export async function fetchPromotionSummary(contextKey: string | null = null): Promise<PromotionSummary> {
  const { data, error } = await supabase.rpc('admin_promotion_summary', { p_context_key: contextKey });
  if (error) throw error;
  const d = (data as Partial<PromotionSummary> | null) ?? {};
  return { requests: d.requests ?? null, drafts: d.drafts ?? null };
}
export async function fetchPromotionAudit(requestId: string | null = null, draftId: string | null = null, limit = 200): Promise<PromotionAuditRow[]> {
  const { data, error } = await supabase.rpc('admin_promotion_audit', { p_request_id: requestId, p_draft_id: draftId, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: PromotionAuditRow[] } | null) ?? {};
  return d.items ?? [];
}

export async function fetchDailySeries(days = 7): Promise<DailySeriesPoint[]> {
  const { data, error } = await supabase.rpc('admin_daily_series', { days });
  if (error) throw error;
  return (data ?? []) as DailySeriesPoint[];
}

export async function fetchTopTracks(limit = 10): Promise<TopTrack[]> {
  const { data, error } = await supabase.rpc('admin_top_tracks', { limit_n: limit });
  if (error) throw error;
  return (data ?? []) as TopTrack[];
}

export async function fetchTopPlaylists(limit = 10): Promise<TopPlaylist[]> {
  const { data, error } = await supabase.rpc('admin_top_playlists', { limit_n: limit });
  if (error) throw error;
  return (data ?? []) as TopPlaylist[];
}

export async function fetchMemberList(opts: {
  search?: string;
  plan?: string;
  role?: string;
  status?: 'active' | 'withdrawn' | 'cancel_scheduled';
  limit?: number;
  offset?: number;
} = {}): Promise<MemberRow[]> {
  // 0056 시그니처: (p_limit, p_offset, p_search, p_plan, p_role, p_status)
  const { data, error } = await supabase.rpc('admin_member_list', {
    p_limit: opts.limit ?? 100,
    p_offset: opts.offset ?? 0,
    p_search: opts.search ?? null,
    p_plan: opts.plan ?? null,
    p_role: opts.role ?? null,
    p_status: opts.status ?? null,
  });
  if (error) throw error;
  return (data ?? []) as MemberRow[];
}

export async function fetchMemberDetail(userId: string): Promise<MemberDetail | null> {
  const { data, error } = await supabase.rpc('admin_member_detail', {
    p_user_id: userId,
  });
  if (error) throw error;
  return data as MemberDetail;
}

export async function fetchTrackAnalytics(days = 30): Promise<TrackAnalytics[]> {
  const { data, error } = await supabase.rpc('admin_track_analytics', { days });
  if (error) throw error;
  return (data ?? []) as TrackAnalytics[];
}

export async function fetchRevenueSummary(): Promise<RevenueSummary> {
  const { data, error } = await supabase.rpc('admin_revenue_summary');
  if (error) throw error;
  // by_plan/by_status/recent 가 누락돼도 Object.keys/map 이 throw 하지 않도록 기본값 보강.
  const d = (data as Partial<RevenueSummary> | null) ?? {};
  return {
    today: d.today ?? 0,
    week: d.week ?? 0,
    month: d.month ?? 0,
    total: d.total ?? 0,
    by_plan: d.by_plan ?? {},
    by_status: d.by_status ?? {},
    recent: d.recent ?? [],
  };
}

export async function recomputeDailyMetrics(date?: string) {
  const { data, error } = await supabase.rpc('admin_compute_daily_metrics', {
    target_date: date ?? new Date().toISOString().slice(0, 10),
  });
  if (error) throw error;
  return data;
}

export async function updateUserRole(userId: string, role: 'user' | 'admin') {
  const { error } = await supabase.from('users').update({ role }).eq('id', userId);
  if (error) throw error;
}

export async function updateUserPlan(
  userId: string,
  plan: 'free' | 'personal' | 'individual' | 'business',
) {
  // 0029 이후 users.subscription_type CHECK 가 'individual' 도 허용.
  // membership_tier 와 subscription_type 둘 다 동기화 — 결제/대시보드 정합성 보장.
  const { error } = await supabase
    .from('users')
    .update({
      subscription_type: plan,
      membership_tier: plan === 'personal' ? 'individual' : plan,
    })
    .eq('id', userId);
  if (error) throw error;
}

/* ---------- 0095 — 관리자 회원 위험 작업 wrappers ---------- */

export async function adminDisableUser(userId: string, reason?: string) {
  const { data, error } = await supabase.rpc('admin_disable_user', {
    p_user_id: userId,
    p_reason: reason ?? null,
  });
  if (error) throw error;
  return data as { ok: boolean; canceled_subs: number };
}

export async function adminEnableUser(userId: string) {
  const { data, error } = await supabase.rpc('admin_enable_user', { p_user_id: userId });
  if (error) throw error;
  return data as { ok: boolean };
}

export async function adminWithdrawUser(userId: string, reason?: string) {
  const { data, error } = await supabase.rpc('admin_withdraw_user', {
    p_user_id: userId,
    p_reason: reason ?? null,
  });
  if (error) throw error;
  return data as { ok: boolean; canceled_subs: number };
}

/**
 * 이미 탈퇴된 회원의 누락 상태 보정 (마스킹/티어/구독취소). 재탈퇴 아님.
 * withdrawn_at 이 있는 회원에만 동작하며 idempotent.
 */
export async function adminRepairWithdrawnUser(userId: string, reason?: string) {
  const { data, error } = await supabase.rpc('admin_repair_withdrawn_user', {
    p_user_id: userId,
    p_reason: reason ?? null,
  });
  if (error) throw error;
  return data as { ok: boolean; pii_masked: boolean; tier_fixed: boolean; canceled_subs: number };
}

export async function adminMaskUserPii(userId: string) {
  const { data, error } = await supabase.rpc('admin_mask_user_pii', { p_user_id: userId });
  if (error) throw error;
  return data as { ok: boolean; anon_nickname: string };
}

export async function adminForceSignOutUser(userId: string) {
  const { data, error } = await supabase.rpc('admin_force_sign_out_user', { p_user_id: userId });
  if (error) throw error;
  return data as { ok: boolean; deleted_tokens: number; error: string | null };
}

export async function adminCanHardDeleteUser(userId: string) {
  const { data, error } = await supabase.rpc('admin_can_hard_delete_user', { p_user_id: userId });
  if (error) throw error;
  return data as {
    can_hard_delete: boolean;
    blocking: {
      artist_contracts: number;
      artist_settlements: number;
      streaming_revenues: number;
      payout_account_reveal_logs: number;
    };
    note: string;
  };
}

/* ---------- 0098 — 큐레이터 권한 부여/회수 ---------- */

export async function adminGrantCurator(userId: string) {
  const { data, error } = await supabase.rpc('admin_grant_curator', { p_user_id: userId });
  if (error) throw error;
  return data as { ok: boolean; is_curator: boolean };
}

export async function adminRevokeCurator(userId: string) {
  const { data, error } = await supabase.rpc('admin_revoke_curator', { p_user_id: userId });
  if (error) throw error;
  return data as { ok: boolean; is_curator: boolean };
}

/* ---------- X6.10 Phase 3 — 관리자 plan_type 수동 변경 ---------- */

export type AdminArtistPlanType = 'general_artist' | 'student_artist' | 'legacy_student' | null;

export interface AdminUpdatePlanResult {
  ok: true;
  noop?: boolean;
  user_id: string;
  plan_type: AdminArtistPlanType;
  plan_label?: string;
  monthly_quota?: number;
  before: AdminArtistPlanType;
  account_type?: string;
}

export async function adminUpdateArtistPlanType(
  userId: string,
  planType: AdminArtistPlanType,
  reason: string,
): Promise<AdminUpdatePlanResult> {
  const { data, error } = await supabase.rpc('admin_update_artist_plan_type', {
    p_user_id: userId,
    p_plan_type: planType,
    p_reason: reason,
  });
  if (error) throw error;
  return data as AdminUpdatePlanResult;
}

export interface PlanAuditRow {
  id: number;
  before_plan_type: string | null;
  after_plan_type: string | null;
  admin_user_id: string | null;
  admin_email: string | null;
  reason: string;
  created_at: string;
}

export async function adminListArtistPlanAudit(
  userId: string, limit = 20,
): Promise<PlanAuditRow[]> {
  const { data, error } = await supabase.rpc('admin_list_artist_plan_audit', {
    p_user_id: userId, p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as PlanAuditRow[];
}

/**
 * 비밀번호 재설정 메일 발송 trigger — Edge Function 호출.
 * Supabase Auth 가 사용자에게 magic link 메일 발송.
 * 비밀번호 원문은 어디에도 노출되지 않음 (bcrypt only).
 */
export async function adminTriggerPasswordReset(userId: string) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('로그인 세션이 없어요.');

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const res = await fetch(`${supabaseUrl}/functions/v1/admin-trigger-password-reset`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ user_id: userId }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    detail?: string;
    sent_to_hash?: string;
  };
  if (!res.ok || !body.ok) {
    throw new Error(body.error ?? body.detail ?? '재설정 메일 발송 실패');
  }
  return body as { ok: true; sent_to_hash: string };
}

/* ---------- 0104 — 프로모션 코드 ---------- */

export interface PromotionValidation {
  valid: boolean;
  reason: string;
  promotion_code_id?: string;
  code?: string;
  name?: string | null;
  discount_type?: 'fixed' | 'percent';
  original_amount?: number;
  discount_amount?: number;
  final_amount?: number;
  max_redemptions?: number | null;
  remaining?: number | null;
}

export interface PromotionCodeRow {
  id: string;
  code: string;
  name: string | null;
  target_plan: 'individual' | 'business' | 'all';
  discount_type: 'fixed' | 'percent';
  discount_amount: number;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  deleted_at: string | null;
  note: string | null;
  created_at: string;
  max_redemptions: number | null;
  redemption_count: number;
  total_discount: number;
}

/** 프로모션 코드 검증 (회원/비회원 모두 호출 가능, 가격은 서버 권위). */
export async function validatePromotionCode(
  code: string,
  planType: 'individual' | 'business',
): Promise<PromotionValidation> {
  const { data, error } = await supabase.rpc('validate_promotion_code', {
    p_code: code,
    p_plan_type: planType,
  });
  if (error) throw error;
  return data as PromotionValidation;
}

export async function adminListPromotionCodes(): Promise<PromotionCodeRow[]> {
  const { data, error } = await supabase.rpc('admin_list_promotion_codes');
  if (error) throw error;
  return (data ?? []) as PromotionCodeRow[];
}

export async function adminCreatePromotionCode(payload: {
  code: string;
  name?: string | null;
  target_plan: 'individual' | 'business' | 'all';
  discount_type: 'fixed' | 'percent';
  discount_amount: number;
  starts_at?: string | null;
  ends_at?: string | null;
  note?: string | null;
  max_redemptions?: number | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc('admin_create_promotion_code', {
    p_code: payload.code,
    p_name: payload.name ?? null,
    p_target_plan: payload.target_plan,
    p_discount_type: payload.discount_type,
    p_discount_amount: payload.discount_amount,
    p_starts_at: payload.starts_at ?? null,
    p_ends_at: payload.ends_at ?? null,
    p_note: payload.note ?? null,
    p_max_redemptions: payload.max_redemptions ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function adminSetPromotionActive(id: string, active: boolean) {
  const { data, error } = await supabase.rpc('admin_set_promotion_active', {
    p_id: id,
    p_active: active,
  });
  if (error) throw error;
  return data as { ok: boolean; is_active: boolean };
}

export async function adminDeletePromotionCode(id: string) {
  const { data, error } = await supabase.rpc('admin_delete_promotion_code', { p_id: id });
  if (error) throw error;
  return data as { ok: boolean };
}

export async function insertRevenue(payload: {
  user_id: string;
  subscription_type: 'personal' | 'business';
  amount: number;
  status: 'paid' | 'refunded' | 'pending' | 'failed';
  payment_provider?: string;
  note?: string;
  paid_at?: string;
}) {
  const { error } = await supabase.from('revenue_events').insert({
    ...payload,
    paid_at: payload.paid_at ?? new Date().toISOString(),
  });
  if (error) throw error;
}

// ---------- analytics DB 자동 적용 (0002_analytics.sql) ----------

export interface ApplyAnalyticsResult {
  ok: boolean;
  before?: { tables: string[]; functions: string[] };
  after?: { tables: string[]; functions: string[] };
  created_tables?: string[];
  created_functions?: string[];
  skipped?: { tables: number; functions: number };
  message?: string;
  error?: string;
  details?: string;
  hint?: string;
}

export async function applyAnalyticsDb(): Promise<ApplyAnalyticsResult> {
  try {
    const { data, error } = await supabase.functions.invoke('admin-apply-analytics-db', {
      body: {},
    });
    if (error) {
      // FunctionsHttpError.context 안의 JSON body 추출 시도
      let bodyJson: Partial<ApplyAnalyticsResult> = {};
      try {
        const errAny = error as unknown as { context?: Response };
        if (errAny.context && typeof errAny.context.json === 'function') {
          bodyJson = (await errAny.context.json()) as Partial<ApplyAnalyticsResult>;
        }
      } catch {
        /* noop */
      }
      return { ok: false, error: error.message, ...bodyJson };
    }
    return data as ApplyAnalyticsResult;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}
