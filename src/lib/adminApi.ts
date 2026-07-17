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

// ── AI Governance & Trust (0496 — 헌법/신뢰/거버넌스, Production Apply 없음, AI 자기수정 불가) ──

export interface ConstitutionRuleRow { id: string; rule_code: string; category: string; title: string; description: string | null; severity: string; enforcement_type: string; scope: string | null; version: number; is_active: boolean; immutable: boolean }
export async function fetchConstitutionRules(active: boolean | null = null): Promise<ConstitutionRuleRow[]> {
  const { data, error } = await supabase.rpc('admin_ai_constitution_rules', { p_active: active });
  if (error) throw error;
  const d = (data as { items?: ConstitutionRuleRow[] } | null) ?? {};
  return d.items ?? [];
}
export interface GovernanceEventRow { id: string; source_type: string; source_id: string | null; context_key: string | null; event_type: string; rule_results: unknown; governance_decision: string | null; actor_id: string | null; created_at: string }
export async function recordConstitutionCheck(payload: Record<string, unknown>): Promise<GovernanceEventRow> {
  const { data, error } = await supabase.rpc('admin_ai_constitution_check', { p_payload: payload });
  if (error) throw error; return data as GovernanceEventRow;
}
export async function fetchGovernanceEvents(sourceType: string | null = null, eventType: string | null = null, limit = 200): Promise<GovernanceEventRow[]> {
  const { data, error } = await supabase.rpc('admin_ai_governance_events', { p_source_type: sourceType, p_event_type: eventType, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: GovernanceEventRow[] } | null) ?? {};
  return d.items ?? [];
}
export interface HumanOverrideRow { id: string; source_type: string; source_id: string | null; context_key: string | null; override_type: string; reason_code: string | null; reason: string | null; risk_tier: string | null; previous_decision: string | null; overridden_decision: string | null; actor_id: string | null; created_at: string }
export async function recordHumanOverride(payload: Record<string, unknown>): Promise<HumanOverrideRow> {
  const { data, error } = await supabase.rpc('admin_ai_human_override', { p_payload: payload });
  if (error) throw error; return data as HumanOverrideRow;
}
export async function fetchHumanOverrides(limit = 200): Promise<{ items: HumanOverrideRow[]; signal: Array<{ override_type: string; reason_code: string | null; n: number }> }> {
  const { data, error } = await supabase.rpc('admin_ai_human_overrides', { p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: HumanOverrideRow[]; signal?: Array<{ override_type: string; reason_code: string | null; n: number }> } | null) ?? {};
  return { items: d.items ?? [], signal: d.signal ?? [] };
}
export interface ChangeCandidateRow {
  id?: string; source_draft_id: string | null; source_promotion_request_id: string | null; source_sandbox_run_id: string | null;
  context_key: string; change_type: string; candidate_status: string; risk_tier: string | null; readiness_score: number | null;
  trust_snapshot: Record<string, unknown> | null; constitution_result: Record<string, unknown> | null; governance_result: Record<string, unknown> | null;
  rollback_plan: Record<string, unknown> | null; observation_plan: Record<string, unknown> | null; execution_preconditions: Record<string, unknown> | null;
  go_criteria: Record<string, unknown> | null; source_input_hash: string | null; source_model_version: string | null; created_at: string; reviewed_at: string | null; expired_at: string | null;
}
export async function requestChangeCandidate(payload: Record<string, unknown>): Promise<{ idempotent: boolean; candidate: ChangeCandidateRow }> {
  const { data, error } = await supabase.rpc('admin_ai_change_candidate_request', { p_payload: payload });
  if (error) throw error; return data as { idempotent: boolean; candidate: ChangeCandidateRow };
}
export async function setChangeCandidateStatus(id: string, status: string, reason: string | null = null): Promise<ChangeCandidateRow> {
  const { data, error } = await supabase.rpc('admin_ai_change_candidate_set_status', { p_id: id, p_status: status, p_reason: reason });
  if (error) throw error; return data as ChangeCandidateRow;
}
export async function fetchChangeCandidateDetail(id: string): Promise<{ candidate: ChangeCandidateRow | null; events: GovernanceEventRow[] }> {
  const { data, error } = await supabase.rpc('admin_ai_change_candidate_detail', { p_id: id });
  if (error) throw error;
  const d = (data as { found?: boolean; candidate?: ChangeCandidateRow; events?: GovernanceEventRow[] } | null) ?? {};
  return { candidate: d.candidate ?? null, events: d.events ?? [] };
}
export async function fetchChangeCandidateHistory(contextKey: string | null = null, status: string | null = null, limit = 100): Promise<ChangeCandidateRow[]> {
  const { data, error } = await supabase.rpc('admin_ai_change_candidate_history', { p_context_key: contextKey, p_status: status, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: ChangeCandidateRow[] } | null) ?? {};
  return d.items ?? [];
}
export interface GovernanceSummaryResp {
  events: { total: number; violations: number; blocked: number; overrides: number; checks: number } | null;
  candidates: { total: number; pending: number; governance_ready: number; rejected: number; expired: number; high_risk: number; critical_risk: number } | null;
  constitution_audit: Array<{ rule_code: string; checked: number; violations: number; warnings: number }>;
}
export async function fetchGovernanceSummary(): Promise<GovernanceSummaryResp> {
  const { data, error } = await supabase.rpc('admin_ai_governance_summary');
  if (error) throw error;
  const d = (data as Partial<GovernanceSummaryResp> | null) ?? {};
  return { events: d.events ?? null, candidates: d.candidates ?? null, constitution_audit: d.constitution_audit ?? [] };
}

// ── Multi-Agent Collaboration (0497 — Agent 협업 분석, Production 무변경, Agent 직접수정 불가) ──

export interface AiAgentRow { id: string; agent_code: string; name: string; domain: string; responsibilities: string[]; is_active: boolean; reputation: number; decisions: number; wins: number; losses: number }
export async function fetchAiAgents(active: boolean | null = null): Promise<AiAgentRow[]> {
  const { data, error } = await supabase.rpc('admin_ai_agents', { p_active: active });
  if (error) throw error;
  const d = (data as { items?: AiAgentRow[] } | null) ?? {};
  return d.items ?? [];
}
export interface AgentReputationRow { agent_code: string; name: string; domain: string; reputation: number; decisions: number; wins: number; losses: number; win_rate: number | null }
export async function fetchAgentReputation(): Promise<AgentReputationRow[]> {
  const { data, error } = await supabase.rpc('admin_ai_agent_reputation');
  if (error) throw error;
  const d = (data as { items?: AgentReputationRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function fetchAgentMemory(agentCode: string, contextKey: string | null = null, limit = 20): Promise<{ agent_code: string; read_only: boolean; memory: Array<Record<string, unknown>> }> {
  const { data, error } = await supabase.rpc('admin_ai_agent_memory', { p_agent_code: agentCode, p_context_key: contextKey, p_limit: limit });
  if (error) throw error;
  const d = (data as { agent_code?: string; read_only?: boolean; memory?: Array<Record<string, unknown>> } | null) ?? {};
  return { agent_code: d.agent_code ?? agentCode, read_only: d.read_only ?? true, memory: d.memory ?? [] };
}
export interface CollaborationRow {
  id?: string; context_key: string; topic: string | null; participants: string[]; opinions: Array<Record<string, unknown>>;
  consensus_type: string | null; consensus_score: number | null; conflicts: Array<Record<string, unknown>>;
  final_decision: string | null; governance_result: Record<string, unknown> | null; input_hash: string | null; created_at: string;
}
export async function saveCollaboration(payload: Record<string, unknown>): Promise<{ idempotent: boolean; collaboration: CollaborationRow }> {
  const { data, error } = await supabase.rpc('admin_ai_collaboration_save', { p_payload: payload });
  if (error) throw error; return data as { idempotent: boolean; collaboration: CollaborationRow };
}
export async function fetchCollaborationHistory(contextKey: string | null = null, consensusType: string | null = null, limit = 100): Promise<CollaborationRow[]> {
  const { data, error } = await supabase.rpc('admin_ai_collaboration_history', { p_context_key: contextKey, p_consensus_type: consensusType, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: CollaborationRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function recordAgentOutcome(agentCode: string, win: boolean): Promise<AiAgentRow> {
  const { data, error } = await supabase.rpc('admin_ai_agent_record_outcome', { p_agent_code: agentCode, p_win: win });
  if (error) throw error; return data as AiAgentRow;
}

// ── AI Memory & Knowledge (0498 — Long-Term Memory/Graph/Pattern, Evidence 계층 · Production 무변경) ──

export interface AiMemoryRecordRow {
  id: string; memory_type: string; memory_scope: string; scope_id: string | null; agent_code: string | null;
  source_type: string; source_id: string; source_version: string; input_hash: string;
  context_key: string | null; context_snapshot: Record<string, unknown>; subject_type: string | null; subject_id: string | null;
  action_type: string | null; action_snapshot: Record<string, unknown> | null;
  outcome_status: string; outcome_snapshot: Record<string, unknown> | null; evidence: Array<Record<string, unknown>>;
  sample_size: number | null; confidence: number | null; freshness_score: number | null; quality_score: number | null;
  lifecycle_status: string; seasonal_tag: string | null; recurrence_count: number; contradiction_count: number;
  occurred_at: string; last_reinforced_at: string | null; created_at: string;
}
export interface AiMemorySummaryResp {
  memory: Record<string, number | string | null> | null;
  graph: { nodes: number; edges: number } | null;
  patterns: Record<string, number> | null;
  sources: Record<string, number> | null;
}
export async function fetchAiMemorySummary(): Promise<AiMemorySummaryResp> {
  const { data, error } = await supabase.rpc('admin_ai_memory_summary');
  if (error) throw error;
  const d = (data as Partial<AiMemorySummaryResp> | null) ?? {};
  return { memory: d.memory ?? null, graph: d.graph ?? null, patterns: d.patterns ?? null, sources: d.sources ?? null };
}
export async function fetchAiMemoryRecords(opts: {
  memoryType?: string | null; scope?: string | null; agentCode?: string | null; status?: string | null;
  contextKey?: string | null; outcome?: string | null; includeBlocked?: boolean; limit?: number;
} = {}): Promise<AiMemoryRecordRow[]> {
  const { data, error } = await supabase.rpc('admin_ai_memory_records', {
    p_memory_type: opts.memoryType ?? null, p_scope: opts.scope ?? null, p_agent_code: opts.agentCode ?? null,
    p_status: opts.status ?? null, p_context_key: opts.contextKey ?? null, p_outcome: opts.outcome ?? null,
    p_include_blocked: opts.includeBlocked ?? false, p_limit: opts.limit ?? 100,
  });
  if (error) throw error;
  const d = (data as { items?: AiMemoryRecordRow[] } | null) ?? {};
  return d.items ?? [];
}
export interface AiMemoryAuditRow { id: string; memory_id: string | null; event_type: string; previous_state: string | null; new_state: string | null; reason: string | null; evidence: Array<Record<string, unknown>>; created_at: string }
export async function fetchAiMemoryDetail(id: string): Promise<{ found: boolean; memory: AiMemoryRecordRow | null; audit: AiMemoryAuditRow[] }> {
  const { data, error } = await supabase.rpc('admin_ai_memory_detail', { p_id: id });
  if (error) throw error;
  const d = (data as { found?: boolean; memory?: AiMemoryRecordRow; audit?: AiMemoryAuditRow[] } | null) ?? {};
  return { found: d.found ?? false, memory: d.memory ?? null, audit: d.audit ?? [] };
}
export async function fetchAiMemoryAuditLog(memoryId: string | null = null, limit = 200): Promise<AiMemoryAuditRow[]> {
  const { data, error } = await supabase.rpc('admin_ai_memory_audit_log', { p_memory_id: memoryId, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: AiMemoryAuditRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function createAiMemoryCandidate(payload: Record<string, unknown>): Promise<{ eligibility: string; idempotent: boolean; memory: AiMemoryRecordRow }> {
  const { data, error } = await supabase.rpc('admin_ai_memory_create_candidate', { p_payload: payload });
  if (error) throw error; return data as { eligibility: string; idempotent: boolean; memory: AiMemoryRecordRow };
}
export async function setAiMemoryStatus(id: string, status: string, reason: string): Promise<AiMemoryRecordRow> {
  const { data, error } = await supabase.rpc('admin_ai_memory_set_status', { p_id: id, p_status: status, p_reason: reason });
  if (error) throw error; return data as AiMemoryRecordRow;
}
export async function reinforceAiMemory(id: string, payload: Record<string, unknown>): Promise<AiMemoryRecordRow> {
  const { data, error } = await supabase.rpc('admin_ai_memory_reinforce', { p_id: id, p_payload: payload });
  if (error) throw error; return data as AiMemoryRecordRow;
}
export async function contradictAiMemory(id: string, payload: Record<string, unknown>): Promise<AiMemoryRecordRow> {
  const { data, error } = await supabase.rpc('admin_ai_memory_contradict', { p_id: id, p_payload: payload });
  if (error) throw error; return data as AiMemoryRecordRow;
}
export async function markAiMemoryUsed(id: string, useType: 'retrieval_used' | 'replay_used' | 'pattern_derived', reason: string | null = null): Promise<void> {
  const { error } = await supabase.rpc('admin_ai_memory_mark_used', { p_id: id, p_use_type: useType, p_reason: reason });
  if (error) throw error;
}
export interface KnowledgeNodeRow { id: string; node_type: string; entity_id: string | null; canonical_key: string; label: string; properties: Record<string, unknown>; source_version: string; is_active: boolean; created_at: string }
export interface KnowledgeEdgeRow { id: string; from_node_id: string; to_node_id: string; relation_type: string; scope: string | null; context_key: string | null; weight: number | null; confidence: number | null; sample_size: number | null; evidence: Array<Record<string, unknown>>; lifecycle_status: string; created_at: string }
export async function saveKnowledgeNode(payload: Record<string, unknown>): Promise<KnowledgeNodeRow> {
  const { data, error } = await supabase.rpc('admin_ai_knowledge_node_save', { p_payload: payload });
  if (error) throw error; return data as KnowledgeNodeRow;
}
export async function saveKnowledgeEdge(payload: Record<string, unknown>): Promise<{ idempotent: boolean; edge: KnowledgeEdgeRow }> {
  const { data, error } = await supabase.rpc('admin_ai_knowledge_edge_save', { p_payload: payload });
  if (error) throw error; return data as { idempotent: boolean; edge: KnowledgeEdgeRow };
}
export async function fetchKnowledgeNodes(nodeType: string | null = null, q: string | null = null, limit = 100): Promise<KnowledgeNodeRow[]> {
  const { data, error } = await supabase.rpc('admin_ai_knowledge_nodes', { p_node_type: nodeType, p_q: q, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: KnowledgeNodeRow[] } | null) ?? {};
  return d.items ?? [];
}
export interface KnowledgeNeighborsResp { found: boolean; node: KnowledgeNodeRow | null; outgoing: Array<{ edge: KnowledgeEdgeRow; node: KnowledgeNodeRow }>; incoming: Array<{ edge: KnowledgeEdgeRow; node: KnowledgeNodeRow }> }
export async function fetchKnowledgeNeighbors(nodeId: string, limit = 50): Promise<KnowledgeNeighborsResp> {
  const { data, error } = await supabase.rpc('admin_ai_knowledge_neighbors', { p_node_id: nodeId, p_limit: limit });
  if (error) throw error;
  const d = (data as Partial<KnowledgeNeighborsResp> | null) ?? {};
  return { found: d.found ?? false, node: d.node ?? null, outgoing: d.outgoing ?? [], incoming: d.incoming ?? [] };
}
export interface AiPatternRow {
  id: string; pattern_code: string; pattern_type: string; scope: string; scope_id: string | null;
  context_definition: Record<string, unknown>; subject_definition: Record<string, unknown>; outcome_definition: Record<string, unknown>;
  direction: string | null; effect_size: number | null; confidence: number | null; sample_size: number | null;
  support_count: number; contradiction_count: number; quality_score: number | null; status: string;
  evidence: Array<Record<string, unknown>>; source_period_start: string | null; source_period_end: string | null;
  first_detected_at: string; last_detected_at: string; last_validated_at: string | null; source_version: string; created_at: string;
}
export async function saveAiPattern(payload: Record<string, unknown>): Promise<{ idempotent: boolean; pattern: AiPatternRow }> {
  const { data, error } = await supabase.rpc('admin_ai_pattern_save', { p_payload: payload });
  if (error) throw error; return data as { idempotent: boolean; pattern: AiPatternRow };
}
export async function fetchAiPatterns(patternType: string | null = null, status: string | null = null, scope: string | null = null, limit = 100): Promise<AiPatternRow[]> {
  const { data, error } = await supabase.rpc('admin_ai_patterns', { p_pattern_type: patternType, p_status: status, p_scope: scope, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: AiPatternRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function setAiPatternStatus(id: string, status: string, reason: string): Promise<AiPatternRow> {
  const { data, error } = await supabase.rpc('admin_ai_pattern_set_status', { p_id: id, p_status: status, p_reason: reason });
  if (error) throw error; return data as AiPatternRow;
}

// ── Digital Twin & Simulation (0499 — Immutable Snapshot + 결정적 Simulation, simulated ≠ actual) ──

export interface TwinSummaryResp {
  twins: Record<string, number | string | null> | null;
  runs: Record<string, number | string | null> | null;
  calibration: { pending_outcome: number; calibrated: number } | null;
}
export async function fetchTwinSummary(): Promise<TwinSummaryResp> {
  const { data, error } = await supabase.rpc('admin_ai_twin_summary');
  if (error) throw error;
  const d = (data as Partial<TwinSummaryResp> | null) ?? {};
  return { twins: d.twins ?? null, runs: d.runs ?? null, calibration: d.calibration ?? null };
}
export interface TwinRow {
  id: string; twin_code: string; twin_type: string; twin_scope: string; scope_id: string | null;
  source_type: string; source_id: string; source_version: string; snapshot_at: string;
  completeness_score: number | null; freshness_score: number | null; readiness_status: string; lifecycle_status: string;
  limitations: Array<string | Record<string, unknown>>; created_at: string;
}
export interface TwinDetailResp {
  found: boolean; twin: (TwinRow & Record<string, unknown>) | null;
  scenarios: Array<{ id: string; scenario_code: string; scenario_type: string; title: string; simulation_horizon: number; lifecycle_status: string; created_at: string }>;
  audit: Array<{ event_type: string; previous_state: string | null; new_state: string | null; reason: string | null; created_at: string }>;
}
export async function fetchTwins(twinType: string | null = null, status: string | null = null, limit = 100): Promise<TwinRow[]> {
  const { data, error } = await supabase.rpc('admin_ai_twins', { p_twin_type: twinType, p_status: status, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: TwinRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function fetchTwinDetail(id: string): Promise<TwinDetailResp> {
  const { data, error } = await supabase.rpc('admin_ai_twin_detail', { p_id: id });
  if (error) throw error;
  const d = (data as Partial<TwinDetailResp> | null) ?? {};
  return { found: d.found ?? false, twin: d.twin ?? null, scenarios: d.scenarios ?? [], audit: d.audit ?? [] };
}
export async function createTwin(payload: Record<string, unknown>): Promise<{ eligibility: string; idempotent: boolean; twin: TwinRow }> {
  const { data, error } = await supabase.rpc('admin_ai_twin_create', { p_payload: payload });
  if (error) throw error; return data as { eligibility: string; idempotent: boolean; twin: TwinRow };
}
export async function setTwinLifecycle(id: string, status: 'superseded' | 'archived' | 'blocked', reason: string): Promise<TwinRow> {
  const { data, error } = await supabase.rpc('admin_ai_twin_set_lifecycle', { p_id: id, p_status: status, p_reason: reason });
  if (error) throw error; return data as TwinRow;
}
export interface TwinScenarioRow {
  id: string; scenario_code: string; twin_id: string; scenario_type: string; title: string; objective: string | null;
  hypothesis: string | null; baseline_definition: Record<string, unknown>; simulation_horizon: number;
  requested_metrics: string[]; assumption_snapshot: Record<string, unknown>; model_version: string; input_hash: string;
  risk_tier: string | null; lifecycle_status: string; limitations: Array<string | Record<string, unknown>>; created_at: string;
}
export async function createTwinScenario(payload: Record<string, unknown>): Promise<{ idempotent: boolean; scenario: TwinScenarioRow }> {
  const { data, error } = await supabase.rpc('admin_ai_twin_scenario_create', { p_payload: payload });
  if (error) throw error; return data as { idempotent: boolean; scenario: TwinScenarioRow };
}
export async function fetchTwinScenarios(twinId: string | null = null, limit = 100): Promise<TwinScenarioRow[]> {
  const { data, error } = await supabase.rpc('admin_ai_twin_scenarios', { p_twin_id: twinId, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: TwinScenarioRow[] } | null) ?? {};
  return d.items ?? [];
}
export interface TwinVariantRow {
  id: string; scenario_id: string; variant_code: string; variant_name: string; variant_definition: Record<string, unknown>;
  changed_dimensions: string[]; expected_direction: string | null; assumption_snapshot: Record<string, unknown>;
  input_hash: string; is_baseline: boolean; lifecycle_status: string; created_at: string;
}
export async function createTwinVariant(payload: Record<string, unknown>): Promise<{ idempotent: boolean; variant: TwinVariantRow }> {
  const { data, error } = await supabase.rpc('admin_ai_twin_variant_create', { p_payload: payload });
  if (error) throw error; return data as { idempotent: boolean; variant: TwinVariantRow };
}
export async function fetchTwinVariants(scenarioId: string, limit = 50): Promise<TwinVariantRow[]> {
  const { data, error } = await supabase.rpc('admin_ai_twin_variants', { p_scenario_id: scenarioId, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: TwinVariantRow[] } | null) ?? {};
  return d.items ?? [];
}
export interface TwinSimRunRow {
  id: string; run_code: string; twin_id: string; scenario_id: string; baseline_variant_id: string | null; run_status: string;
  simulation_engine_version: string; model_version: string; seed: number; iteration_count: number; simulation_horizon: number;
  input_hash: string; started_at: string | null; completed_at: string | null; failure_code: string | null; failure_reason: string | null;
  output_summary: Record<string, unknown> | null; confidence_summary: Record<string, unknown> | null;
  limitations: Array<string | Record<string, unknown>>; created_at: string;
}
export async function saveTwinSimulation(payload: Record<string, unknown>): Promise<{ idempotent: boolean; run: TwinSimRunRow; result_count?: number }> {
  const { data, error } = await supabase.rpc('admin_ai_twin_simulation_save', { p_payload: payload });
  if (error) throw error; return data as { idempotent: boolean; run: TwinSimRunRow; result_count?: number };
}
export async function fetchTwinSimulationRuns(twinId: string | null = null, status: string | null = null, limit = 100): Promise<TwinSimRunRow[]> {
  const { data, error } = await supabase.rpc('admin_ai_twin_simulation_runs', { p_twin_id: twinId, p_status: status, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: TwinSimRunRow[] } | null) ?? {};
  return d.items ?? [];
}
export interface TwinSimResultRow {
  id: string; simulation_run_id: string; variant_id: string; metric_code: string; metric_type: string;
  baseline_value: number | null; simulated_value: number | null; delta_value: number | null; delta_percent: number | null;
  confidence: number | null; uncertainty_low: number | null; uncertainty_high: number | null; sample_size: number | null;
  result_status: string; calibration_status: string; observed_value: number | null; absolute_error: number | null;
  relative_error: number | null; observed_at: string | null; created_at: string;
}
export async function fetchTwinSimulationResults(runId: string, limit = 200): Promise<TwinSimResultRow[]> {
  const { data, error } = await supabase.rpc('admin_ai_twin_simulation_results', { p_run_id: runId, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: TwinSimResultRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function linkTwinCalibration(resultId: string, payload: Record<string, unknown>): Promise<TwinSimResultRow> {
  const { data, error } = await supabase.rpc('admin_ai_twin_calibration_link', { p_result_id: resultId, p_payload: payload });
  if (error) throw error; return data as TwinSimResultRow;
}
export interface TwinAuditRow { id: string; twin_id: string | null; scenario_id: string | null; simulation_run_id: string | null; event_type: string; previous_state: string | null; new_state: string | null; reason: string | null; created_at: string }
export async function fetchTwinAudit(twinId: string | null = null, runId: string | null = null, limit = 200): Promise<TwinAuditRow[]> {
  const { data, error } = await supabase.rpc('admin_ai_twin_audit', { p_twin_id: twinId, p_run_id: runId, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: TwinAuditRow[] } | null) ?? {};
  return d.items ?? [];
}

// ── Enterprise Fleet Intelligence (0500 — 익명 집계 Benchmark, Production 무변경) ──

export interface FleetSummaryResp {
  range: string; global: Record<string, number | string | null> | null; fleet: Record<string, number> | null;
}
export async function fetchFleetSummary(range = '30d'): Promise<FleetSummaryResp> {
  const { data, error } = await supabase.rpc('admin_fleet_summary', { p_range: range });
  if (error) throw error;
  const d = (data as Partial<FleetSummaryResp> | null) ?? {};
  return { range: d.range ?? range, global: d.global ?? null, fleet: d.fleet ?? null };
}
export interface FleetHealthResp {
  scope: string; scope_key: string | null; supported: boolean;
  kpi: Record<string, number | null> | null; governance: { trust: number | null; governance_health: number | null } | null;
  queue_stability: null; note?: string;
}
export async function fetchFleetHealth(scope = 'global', scopeKey: string | null = null, range = '30d'): Promise<FleetHealthResp> {
  const { data, error } = await supabase.rpc('admin_fleet_health', { p_scope: scope, p_scope_key: scopeKey, p_range: range });
  if (error) throw error;
  const d = (data as Partial<FleetHealthResp> | null) ?? {};
  return { scope: d.scope ?? scope, scope_key: d.scope_key ?? scopeKey, supported: d.supported ?? false, kpi: d.kpi ?? null, governance: d.governance ?? null, queue_stability: null, note: d.note };
}
export interface EnterpriseBenchmarkRow { anon_code: string; store_count: number; events: number; completion_rate: number | null; skip_rate: number | null; like_rate: number | null; error_rate: number | null }
export async function fetchEnterpriseBenchmark(range = '30d', limit = 50): Promise<{ anonymized: boolean; items: EnterpriseBenchmarkRow[]; note?: string }> {
  const { data, error } = await supabase.rpc('admin_enterprise_benchmark', { p_range: range, p_limit: limit });
  if (error) throw error;
  const d = (data as { anonymized?: boolean; items?: EnterpriseBenchmarkRow[]; note?: string } | null) ?? {};
  return { anonymized: d.anonymized ?? true, items: d.items ?? [], note: d.note };
}
export interface RegionBenchmarkRow { region_name: string; store_count: number; events: number; completion_rate: number | null; skip_rate: number | null; like_rate: number | null }
export async function fetchRegionBenchmark(range = '30d', limit = 50): Promise<RegionBenchmarkRow[]> {
  const { data, error } = await supabase.rpc('admin_region_benchmark', { p_range: range, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: RegionBenchmarkRow[] } | null) ?? {};
  return d.items ?? [];
}
export interface FleetGrowthRow { store_type: string; prev_events: number; curr_events: number; prev_completion: number | null; curr_completion: number | null; prev_stores: number; curr_stores: number }
export async function fetchFleetGrowth(range = '30d'): Promise<FleetGrowthRow[]> {
  const { data, error } = await supabase.rpc('admin_fleet_growth', { p_range: range });
  if (error) throw error;
  const d = (data as { items?: FleetGrowthRow[] } | null) ?? {};
  return d.items ?? [];
}
export interface FleetScanRow { anon_code: string; store_type: string | null; events: number; skip_rate: number | null; completion_rate: number | null; error_rate: number | null; replay_rate: number | null; track_count: number | null }
export interface FleetScanResp { anonymized: boolean; global_baseline: Record<string, number | null> | null; items: FleetScanRow[] }
export async function fetchFleetOpportunityScan(range = '30d', minEvents = 50, limit = 50): Promise<FleetScanResp> {
  const { data, error } = await supabase.rpc('admin_fleet_opportunity_scan', { p_range: range, p_min_events: minEvents, p_limit: limit });
  if (error) throw error;
  const d = (data as Partial<FleetScanResp> | null) ?? {};
  return { anonymized: d.anonymized ?? true, global_baseline: d.global_baseline ?? null, items: d.items ?? [] };
}
export interface BestPracticeRow {
  id: string; practice_code: string; scope: string; scope_key: string; title: string; description: string | null;
  subject: Record<string, unknown>; observed_effect: Record<string, unknown>; sample_stores: number | null; sample_events: number | null;
  confidence: number | null; status: string; evidence: Array<Record<string, unknown>>; limitations: Array<string | Record<string, unknown>>; created_at: string;
}
export async function saveBestPractice(payload: Record<string, unknown>): Promise<{ idempotent: boolean; practice: BestPracticeRow }> {
  const { data, error } = await supabase.rpc('admin_best_practice_save', { p_payload: payload });
  if (error) throw error; return data as { idempotent: boolean; practice: BestPracticeRow };
}
export async function fetchBestPractices(scope: string | null = null, status: string | null = null, limit = 100): Promise<BestPracticeRow[]> {
  const { data, error } = await supabase.rpc('admin_best_practices', { p_scope: scope, p_status: status, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: BestPracticeRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function setBestPracticeStatus(id: string, status: string, reason: string): Promise<BestPracticeRow> {
  const { data, error } = await supabase.rpc('admin_best_practice_set_status', { p_id: id, p_status: status, p_reason: reason });
  if (error) throw error; return data as BestPracticeRow;
}
export interface FleetOpportunityRow {
  id: string; opportunity_code: string; opportunity_type: string; scope: string; scope_key: string; severity: string;
  kpi_snapshot: Record<string, unknown>; benchmark_snapshot: Record<string, unknown> | null; expected_direction: string | null;
  status: string; evidence: Array<Record<string, unknown>>; limitations: Array<string | Record<string, unknown>>; created_at: string;
}
export async function saveFleetOpportunity(payload: Record<string, unknown>): Promise<{ idempotent: boolean; opportunity: FleetOpportunityRow }> {
  const { data, error } = await supabase.rpc('admin_fleet_opportunity_save', { p_payload: payload });
  if (error) throw error; return data as { idempotent: boolean; opportunity: FleetOpportunityRow };
}
export async function fetchFleetOpportunities(type: string | null = null, status: string | null = null, limit = 100): Promise<FleetOpportunityRow[]> {
  const { data, error } = await supabase.rpc('admin_fleet_opportunities', { p_type: type, p_status: status, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: FleetOpportunityRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function setFleetOpportunityStatus(id: string, status: string, reason: string): Promise<FleetOpportunityRow> {
  const { data, error } = await supabase.rpc('admin_fleet_opportunity_set_status', { p_id: id, p_status: status, p_reason: reason });
  if (error) throw error; return data as FleetOpportunityRow;
}

// ── Federated Learning (0501 — 익명 Knowledge Federation, Privacy Gate, Evidence Only) ──

export interface FederatedSummaryResp {
  patterns: { total: number; by_layer: Record<string, number>; by_status: Record<string, number>; global_validated: number; deprecated: number; last_pattern_at: string | null } | null;
  privacy: { total: number; passed: number; blocked: number } | null;
  conflicts: { total: number; unresolved: number; governance_review: number } | null;
}
export async function fetchFederatedSummary(): Promise<FederatedSummaryResp> {
  const { data, error } = await supabase.rpc('admin_federated_summary');
  if (error) throw error;
  const d = (data as Partial<FederatedSummaryResp> | null) ?? {};
  return { patterns: d.patterns ?? null, privacy: d.privacy ?? null, conflicts: d.conflicts ?? null };
}
export interface FederatedPatternRow {
  id: string; pattern_key: string; layer: string; industry: string | null; region_label: string | null; context_key: string | null;
  subject: Record<string, unknown>; metric_code: string; direction: string | null; effect_value: number | null; baseline_value: number | null;
  confidence: number | null; sample_count: number; sample_stores: number; freshness_score: number | null; status: string;
  privacy_passed: boolean; evidence: Array<Record<string, unknown>>; limitations: Array<string | Record<string, unknown>>;
  source_version: string; input_hash: string; last_validated_at: string | null; created_at: string;
}
export async function fetchFederatedPatterns(layer: string | null = null, status: string | null = null, industry: string | null = null, limit = 100): Promise<FederatedPatternRow[]> {
  const { data, error } = await supabase.rpc('admin_federated_patterns', { p_layer: layer, p_status: status, p_industry: industry, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: FederatedPatternRow[] } | null) ?? {};
  return d.items ?? [];
}
export interface FederatedSaveResp { saved: boolean; idempotent?: boolean; privacy_passed: boolean; violations?: string[]; pattern?: FederatedPatternRow }
export async function saveFederatedPattern(payload: Record<string, unknown>): Promise<FederatedSaveResp> {
  const { data, error } = await supabase.rpc('admin_federated_pattern_save', { p_payload: payload });
  if (error) throw error; return data as FederatedSaveResp;
}
export async function promoteFederatedPattern(id: string, status: string, reason: string): Promise<FederatedPatternRow> {
  const { data, error } = await supabase.rpc('admin_federated_promote', { p_id: id, p_status: status, p_reason: reason });
  if (error) throw error; return data as FederatedPatternRow;
}
export interface FederatedConflictRow {
  id: string; conflict_key: string; conflict_type: string; local_pattern_id: string | null; global_pattern_id: string | null;
  context_key: string | null; summary: string; resolution: string; resolution_reason: string | null; resolved_at: string | null; created_at: string;
}
export async function saveFederatedConflict(payload: Record<string, unknown>): Promise<{ idempotent: boolean; conflict: FederatedConflictRow }> {
  const { data, error } = await supabase.rpc('admin_federated_conflict_save', { p_payload: payload });
  if (error) throw error; return data as { idempotent: boolean; conflict: FederatedConflictRow };
}
export async function fetchFederatedConflicts(resolution: string | null = null, limit = 100): Promise<FederatedConflictRow[]> {
  const { data, error } = await supabase.rpc('admin_federated_conflicts', { p_resolution: resolution, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: FederatedConflictRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function resolveFederatedConflict(id: string, resolution: string, reason: string): Promise<FederatedConflictRow> {
  const { data, error } = await supabase.rpc('admin_federated_conflict_resolve', { p_id: id, p_resolution: resolution, p_reason: reason });
  if (error) throw error; return data as FederatedConflictRow;
}
export interface FederatedPrivacyRow { id: string; pattern_key: string | null; layer: string | null; passed: boolean; checks: Record<string, boolean>; violations: string[]; created_at: string }
export async function fetchFederatedPrivacyLog(passed: boolean | null = null, limit = 100): Promise<FederatedPrivacyRow[]> {
  const { data, error } = await supabase.rpc('admin_federated_privacy_log', { p_passed: passed, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: FederatedPrivacyRow[] } | null) ?? {};
  return d.items ?? [];
}

// ── Self-Healing (0502 — Incident/RCA/Recovery Candidate, 자동 복구 없음 · Evidence Only) ──

export interface SelfHealingSummaryResp {
  incidents: Record<string, number | string | null> | null;
  recovery: Record<string, number> | null;
  playbooks: number | null;
}
export async function fetchSelfHealingSummary(): Promise<SelfHealingSummaryResp> {
  const { data, error } = await supabase.rpc('admin_self_healing_summary');
  if (error) throw error;
  const d = (data as Partial<SelfHealingSummaryResp> | null) ?? {};
  return { incidents: d.incidents ?? null, recovery: d.recovery ?? null, playbooks: d.playbooks ?? null };
}
export interface IncidentScanResp {
  range: string; global: Record<string, number | null> | null;
  by_industry: Array<Record<string, number | string | null>>; note?: string;
}
export async function fetchIncidentScan(range = '7d'): Promise<IncidentScanResp> {
  const { data, error } = await supabase.rpc('admin_incident_scan', { p_range: range });
  if (error) throw error;
  const d = (data as Partial<IncidentScanResp> | null) ?? {};
  return { range: d.range ?? range, global: d.global ?? null, by_industry: d.by_industry ?? [], note: d.note };
}
export interface IncidentRow {
  id: string; incident_code: string; incident_type: string; severity: string; scope: string; scope_key: string | null;
  status: string; kpi_snapshot: Record<string, unknown>; baseline_snapshot: Record<string, unknown> | null;
  root_cause_candidates: Array<Record<string, unknown>>; timeline: Array<{ at: string; event: string; detail: string | null }>;
  evidence: Array<Record<string, unknown>>; limitations: Array<string | Record<string, unknown>>;
  detected_at: string; resolved_at: string | null; created_at: string;
}
export async function saveIncident(payload: Record<string, unknown>): Promise<{ idempotent: boolean; incident: IncidentRow }> {
  const { data, error } = await supabase.rpc('admin_incident_save', { p_payload: payload });
  if (error) throw error; return data as { idempotent: boolean; incident: IncidentRow };
}
export async function fetchIncidents(status: string | null = null, type: string | null = null, limit = 100): Promise<IncidentRow[]> {
  const { data, error } = await supabase.rpc('admin_incidents', { p_status: status, p_type: type, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: IncidentRow[] } | null) ?? {};
  return d.items ?? [];
}
export interface RecoveryCandidateRow {
  id: string; recovery_code: string; incident_id: string; strategy_type: string; description: string | null;
  preconditions: Array<string | Record<string, unknown>>; twin_run_id: string | null; validation_status: string;
  success_probability: number | null; blast_radius: string | null; recovery_time_estimate_min: number | null;
  business_impact: string | null; confidence: number | null; status: string; outcome: string; outcome_note: string | null;
  evidence: Array<Record<string, unknown>>; limitations: Array<string | Record<string, unknown>>; created_at: string;
}
export async function fetchIncidentDetail(id: string): Promise<{ found: boolean; incident: IncidentRow | null; candidates: RecoveryCandidateRow[] }> {
  const { data, error } = await supabase.rpc('admin_incident_detail', { p_id: id });
  if (error) throw error;
  const d = (data as { found?: boolean; incident?: IncidentRow; candidates?: RecoveryCandidateRow[] } | null) ?? {};
  return { found: d.found ?? false, incident: d.incident ?? null, candidates: d.candidates ?? [] };
}
export async function updateIncidentStatus(id: string, status: string, reason: string, rootCauses: Array<Record<string, unknown>> | null = null): Promise<IncidentRow> {
  const { data, error } = await supabase.rpc('admin_incident_update_status', { p_id: id, p_status: status, p_reason: reason, p_root_cause_candidates: rootCauses });
  if (error) throw error; return data as IncidentRow;
}
export async function saveRecoveryCandidate(payload: Record<string, unknown>): Promise<{ idempotent: boolean; candidate: RecoveryCandidateRow }> {
  const { data, error } = await supabase.rpc('admin_recovery_candidate_save', { p_payload: payload });
  if (error) throw error; return data as { idempotent: boolean; candidate: RecoveryCandidateRow };
}
export async function fetchRecoveryCandidates(incidentId: string | null = null, status: string | null = null, limit = 100): Promise<RecoveryCandidateRow[]> {
  const { data, error } = await supabase.rpc('admin_recovery_candidates', { p_incident_id: incidentId, p_status: status, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: RecoveryCandidateRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function linkRecoveryTwin(id: string, twinRunId: string, passed: boolean, reason: string): Promise<RecoveryCandidateRow> {
  const { data, error } = await supabase.rpc('admin_recovery_link_twin', { p_id: id, p_twin_run_id: twinRunId, p_passed: passed, p_reason: reason });
  if (error) throw error; return data as RecoveryCandidateRow;
}
export async function setRecoveryStatus(id: string, status: string, reason: string): Promise<RecoveryCandidateRow> {
  const { data, error } = await supabase.rpc('admin_recovery_set_status', { p_id: id, p_status: status, p_reason: reason });
  if (error) throw error; return data as RecoveryCandidateRow;
}
export async function recordRecoveryOutcome(id: string, outcome: string, note: string): Promise<RecoveryCandidateRow> {
  const { data, error } = await supabase.rpc('admin_recovery_record_outcome', { p_id: id, p_outcome: outcome, p_note: note });
  if (error) throw error; return data as RecoveryCandidateRow;
}
export interface PlaybookRow {
  id: string; playbook_code: string; incident_type: string; title: string; steps: Array<{ order: number; action: string; note: string }>;
  source_incident_ids: string[]; success_count: number; fail_count: number; status: string; created_at: string;
}
export async function savePlaybook(payload: Record<string, unknown>): Promise<{ idempotent: boolean; playbook: PlaybookRow }> {
  const { data, error } = await supabase.rpc('admin_playbook_save', { p_payload: payload });
  if (error) throw error; return data as { idempotent: boolean; playbook: PlaybookRow };
}
export async function fetchPlaybooks(incidentType: string | null = null, status: string | null = null, limit = 100): Promise<PlaybookRow[]> {
  const { data, error } = await supabase.rpc('admin_playbooks', { p_incident_type: incidentType, p_status: status, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: PlaybookRow[] } | null) ?? {};
  return d.items ?? [];
}

// ── AI Music OS Executive (0503 — 통합 Executive Intelligence, Evidence Only) ──

export interface AiOsHealthResp { domains: Record<string, Record<string, number | null> | number | null> | null }
export async function fetchAiOsHealth(): Promise<AiOsHealthResp> {
  const { data, error } = await supabase.rpc('admin_ai_os_health');
  if (error) throw error;
  const d = (data as Partial<AiOsHealthResp> | null) ?? {};
  return { domains: d.domains ?? null };
}
export interface ExecRecommendationRow {
  id: string; rec_code: string; category: string; horizon: string; title: string; summary: string;
  evidence: Array<Record<string, unknown>>; confidence: number; risk_tier: string;
  expected_outcome: Record<string, unknown>; source_refs: Array<Record<string, unknown>>;
  status: string; limitations: Array<string | Record<string, unknown>>; created_at: string;
}
export async function saveExecRecommendation(payload: Record<string, unknown>): Promise<{ idempotent: boolean; recommendation: ExecRecommendationRow }> {
  const { data, error } = await supabase.rpc('admin_executive_recommendation_save', { p_payload: payload });
  if (error) throw error; return data as { idempotent: boolean; recommendation: ExecRecommendationRow };
}
export async function fetchExecRecommendations(category: string | null = null, status: string | null = null, horizon: string | null = null, limit = 100): Promise<ExecRecommendationRow[]> {
  const { data, error } = await supabase.rpc('admin_executive_recommendations', { p_category: category, p_status: status, p_horizon: horizon, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: ExecRecommendationRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function setExecRecommendationStatus(id: string, status: string, reason: string): Promise<ExecRecommendationRow> {
  const { data, error } = await supabase.rpc('admin_executive_recommendation_set_status', { p_id: id, p_status: status, p_reason: reason });
  if (error) throw error; return data as ExecRecommendationRow;
}

// ── AI Operations Center (0504 — 통합 Queue/Review/Feedback, 자동 승인 없음) ──

export interface OperationRow {
  id: string; operation_code: string; source_type: string; source_id: string; title: string; category: string;
  risk_tier: string | null; impact: string | null; approval_policy: string; status: string;
  timeline: Array<{ at: string; event: string; actor: string | null; detail: string | null }>;
  evidence_refs: Array<Record<string, unknown>>; source_version: string; created_at: string; updated_at: string;
  approve_count?: number;
}
export async function enrollOperation(payload: Record<string, unknown>): Promise<{ idempotent: boolean; operation: OperationRow }> {
  const { data, error } = await supabase.rpc('admin_operation_enroll', { p_payload: payload });
  if (error) throw error; return data as { idempotent: boolean; operation: OperationRow };
}
export async function fetchOperationsQueue(status: string | null = null, category: string | null = null, risk: string | null = null, limit = 100): Promise<OperationRow[]> {
  const { data, error } = await supabase.rpc('admin_operations_queue', { p_status: status, p_category: category, p_risk: risk, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: OperationRow[] } | null) ?? {};
  return d.items ?? [];
}
export interface OperationReviewRow { id: string; operation_id: string; action: string; reason: string; feedback_type: string | null; learning_note: string | null; reviewer_id: string | null; created_at: string }
export async function fetchOperationDetail(id: string): Promise<{ found: boolean; operation: OperationRow | null; reviews: OperationReviewRow[]; source: Record<string, unknown> | null }> {
  const { data, error } = await supabase.rpc('admin_operation_detail', { p_id: id });
  if (error) throw error;
  const d = (data as { found?: boolean; operation?: OperationRow; reviews?: OperationReviewRow[]; source?: Record<string, unknown> } | null) ?? {};
  return { found: d.found ?? false, operation: d.operation ?? null, reviews: d.reviews ?? [], source: d.source ?? null };
}
export async function reviewOperation(id: string, action: string, reason: string, feedbackType: string | null = null, learningNote: string | null = null): Promise<{ operation: OperationRow; note: string | null }> {
  const { data, error } = await supabase.rpc('admin_operation_review', { p_id: id, p_action: action, p_reason: reason, p_feedback_type: feedbackType, p_learning_note: learningNote });
  if (error) throw error; return data as { operation: OperationRow; note: string | null };
}
export async function archiveOperation(id: string, reason: string): Promise<OperationRow> {
  const { data, error } = await supabase.rpc('admin_operation_archive', { p_id: id, p_reason: reason });
  if (error) throw error; return data as OperationRow;
}
export interface OperationAnalyticsResp {
  operations: Record<string, number | string | Record<string, number> | null> | null;
  reviews: Record<string, number> | null;
}
export async function fetchOperationAnalytics(): Promise<OperationAnalyticsResp> {
  const { data, error } = await supabase.rpc('admin_operation_analytics');
  if (error) throw error;
  const d = (data as Partial<OperationAnalyticsResp> | null) ?? {};
  return { operations: d.operations ?? null, reviews: d.reviews ?? null };
}

// ── Execution Readiness (0505 — 사람 실행 대기 계획, 자동 실행/Apply 없음) ──

export interface ExecutionPlanRow {
  id: string; plan_code: string; operation_id: string; source_type: string; source_id: string;
  execution_type: string; plan_status: string; risk_tier: string; change_summary: string; business_objective: string | null;
  scope: Record<string, unknown>; dependencies: Array<Record<string, unknown>>; preconditions: Array<Record<string, unknown>>;
  execution_steps: Array<Record<string, unknown> | string>; validation_steps: Array<Record<string, unknown> | string>;
  preflight: Array<{ key: string; label: string; required: boolean; status: string; evidence?: string | null; failure_reason?: string | null }>;
  rollback_plan: Record<string, unknown> | null; observation_plan: Record<string, unknown> | null;
  go_criteria: Array<unknown>; no_go_criteria: Array<unknown>; go_decision: string | null; go_reason: string | null;
  change_window_start: string | null; change_window_end: string | null; change_window_meta: Record<string, unknown> | null;
  execution_owner: string | null; rollback_owner: string | null; observation_owner: string | null;
  evidence: Array<Record<string, unknown>>; source_versions: Record<string, string>; input_hash: string;
  manual_reference: Record<string, unknown> | null; limitations: Array<string | Record<string, unknown>>;
  created_at: string; reviewed_at: string | null; updated_at: string;
}
export async function createExecutionPlan(payload: Record<string, unknown>): Promise<{ idempotent: boolean; eligibility: string; plan: ExecutionPlanRow }> {
  const { data, error } = await supabase.rpc('admin_execution_plan_create', { p_payload: payload });
  if (error) throw error; return data as { idempotent: boolean; eligibility: string; plan: ExecutionPlanRow };
}
export async function fetchExecutionPlans(status: string | null = null, risk: string | null = null, limit = 100): Promise<ExecutionPlanRow[]> {
  const { data, error } = await supabase.rpc('admin_execution_plans', { p_status: status, p_risk: risk, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: ExecutionPlanRow[] } | null) ?? {};
  return d.items ?? [];
}
export interface ExecutionAuditRow { id?: string; event_type: string; detail: string | null; actor_id: string | null; created_at: string }
export async function fetchExecutionPlanDetail(id: string): Promise<{ found: boolean; plan: ExecutionPlanRow | null; audit: ExecutionAuditRow[] }> {
  const { data, error } = await supabase.rpc('admin_execution_plan_detail', { p_id: id });
  if (error) throw error;
  const d = (data as { found?: boolean; plan?: ExecutionPlanRow; audit?: ExecutionAuditRow[] } | null) ?? {};
  return { found: d.found ?? false, plan: d.plan ?? null, audit: d.audit ?? [] };
}
export async function fetchExecutionSummary(): Promise<Record<string, number | string | Record<string, number> | null>> {
  const { data, error } = await supabase.rpc('admin_execution_summary');
  if (error) throw error;
  return (data as Record<string, number | string | Record<string, number> | null> | null) ?? {};
}
export async function updateExecutionPlan(id: string, section: string, value: unknown, reason: string): Promise<ExecutionPlanRow> {
  const { data, error } = await supabase.rpc('admin_execution_plan_update', { p_id: id, p_section: section, p_value: value, p_reason: reason });
  if (error) throw error; return data as ExecutionPlanRow;
}
export async function goReviewExecutionPlan(id: string, decision: string, reason: string): Promise<ExecutionPlanRow> {
  const { data, error } = await supabase.rpc('admin_execution_go_review', { p_id: id, p_decision: decision, p_reason: reason });
  if (error) throw error; return data as ExecutionPlanRow;
}
export async function cancelExecutionPlan(id: string, reason: string): Promise<ExecutionPlanRow> {
  const { data, error } = await supabase.rpc('admin_execution_cancel', { p_id: id, p_reason: reason });
  if (error) throw error; return data as ExecutionPlanRow;
}
export async function recordManualExecutionReference(id: string, payload: Record<string, unknown>): Promise<ExecutionPlanRow> {
  const { data, error } = await supabase.rpc('admin_execution_manual_reference', { p_id: id, p_payload: payload });
  if (error) throw error; return data as ExecutionPlanRow;
}
export async function fetchExecutionAudit(planId: string | null = null, limit = 200): Promise<ExecutionAuditRow[]> {
  const { data, error } = await supabase.rpc('admin_execution_audit', { p_plan_id: planId, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: ExecutionAuditRow[] } | null) ?? {};
  return d.items ?? [];
}

// ── Post-Change Observation (0506 — 사후 관측/검증/Rollback 권고/사람 인증, 실행 없음) ──

export interface PostChangeObservationRow {
  id: string; observation_code: string; execution_plan_id: string; operation_id: string | null; external_change_id: string | null;
  observation_status: string; observation_scope: string | null;
  baseline_start: string; baseline_end: string; observation_start: string | null; observation_end: string | null;
  source_version: string; deployed_version: string | null; input_hash: string;
  baseline_snapshot: Record<string, unknown>; target_snapshot: Record<string, unknown>; observed_snapshot: Record<string, unknown> | null;
  monitoring_sources: Array<string>; success_criteria: Array<unknown>; failure_criteria: Array<unknown>;
  regression_summary: Record<string, unknown> | null; incident_summary: Record<string, unknown> | null;
  rollback_assessment: Record<string, unknown> | null; rollback_decision: string | null; rollback_decision_reason: string | null;
  rollback_reference: Record<string, unknown> | null; certification_result: string | null; certification_reason: string | null;
  evidence: Array<Record<string, unknown>>; limitations: Array<string | Record<string, unknown>>;
  started_at: string | null; completed_at: string | null; created_at: string; updated_at: string;
}
export interface PostChangeMetricRow {
  id: string; observation_id: string; metric_code: string; metric_type: string; metric_role: string;
  baseline_value: number | null; target_value: number | null; observed_value: number | null;
  absolute_delta: number | null; relative_delta: number | null; sample_size: number | null; baseline_sample_size: number | null;
  threshold_status: string | null; validation_status: string; observed_at: string | null;
  evidence: Array<Record<string, unknown>>; limitations: Array<string | Record<string, unknown>>;
}
export interface PostChangeAuditRow { id?: string; observation_id: string | null; event_type: string; detail: string | null; actor_id: string | null; created_at: string }
export async function createPostChangeObservation(payload: Record<string, unknown>): Promise<{ idempotent: boolean; eligibility: string; observation: PostChangeObservationRow }> {
  const { data, error } = await supabase.rpc('admin_post_change_observation_create', { p_payload: payload });
  if (error) throw error; return data as { idempotent: boolean; eligibility: string; observation: PostChangeObservationRow };
}
export async function startPostChangeObservation(id: string, reason: string): Promise<PostChangeObservationRow> {
  const { data, error } = await supabase.rpc('admin_post_change_observation_start', { p_id: id, p_reason: reason });
  if (error) throw error; return data as PostChangeObservationRow;
}
export async function collectPostChangeMetrics(id: string): Promise<{ collected: number; status: string }> {
  const { data, error } = await supabase.rpc('admin_post_change_metrics_collect', { p_id: id });
  if (error) throw error; return data as { collected: number; status: string };
}
export async function fetchPostChangeObservations(status: string | null = null, limit = 100): Promise<PostChangeObservationRow[]> {
  const { data, error } = await supabase.rpc('admin_post_change_observations', { p_status: status, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: PostChangeObservationRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function fetchPostChangeObservationDetail(id: string): Promise<{ found: boolean; observation: PostChangeObservationRow | null; metrics: PostChangeMetricRow[]; audit: PostChangeAuditRow[] }> {
  const { data, error } = await supabase.rpc('admin_post_change_observation_detail', { p_id: id });
  if (error) throw error;
  const d = (data as { found?: boolean; observation?: PostChangeObservationRow; metrics?: PostChangeMetricRow[]; audit?: PostChangeAuditRow[] } | null) ?? {};
  return { found: d.found ?? false, observation: d.observation ?? null, metrics: d.metrics ?? [], audit: d.audit ?? [] };
}
export async function fetchPostChangeSummary(): Promise<Record<string, number | string | Record<string, number> | null>> {
  const { data, error } = await supabase.rpc('admin_post_change_summary');
  if (error) throw error;
  return (data as Record<string, number | string | Record<string, number> | null> | null) ?? {};
}
export async function updatePostChangeReview(id: string, section: string, value: unknown, reason: string): Promise<PostChangeObservationRow> {
  const { data, error } = await supabase.rpc('admin_post_change_review_update', { p_id: id, p_section: section, p_value: value, p_reason: reason });
  if (error) throw error; return data as PostChangeObservationRow;
}
export async function recordPostChangeRollbackDecision(id: string, decision: string, reason: string): Promise<PostChangeObservationRow> {
  const { data, error } = await supabase.rpc('admin_post_change_rollback_decision', { p_id: id, p_decision: decision, p_reason: reason });
  if (error) throw error; return data as PostChangeObservationRow;
}
export async function recordPostChangeRollbackReference(id: string, payload: Record<string, unknown>): Promise<PostChangeObservationRow> {
  const { data, error } = await supabase.rpc('admin_post_change_rollback_reference', { p_id: id, p_payload: payload });
  if (error) throw error; return data as PostChangeObservationRow;
}
export async function certifyPostChangeObservation(id: string, result: string, reason: string): Promise<PostChangeObservationRow> {
  const { data, error } = await supabase.rpc('admin_post_change_certify', { p_id: id, p_result: result, p_reason: reason });
  if (error) throw error; return data as PostChangeObservationRow;
}
export async function fetchPostChangeAudit(observationId: string | null = null, limit = 200): Promise<PostChangeAuditRow[]> {
  const { data, error } = await supabase.rpc('admin_post_change_audit', { p_observation_id: observationId, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: PostChangeAuditRow[] } | null) ?? {};
  return d.items ?? [];
}

// ── Reliability Governance (0507 — SLI/SLO/Error Budget/Freeze 권고, 자동 실행/차단 없음) ──

export interface ReliabilityIndicatorRow {
  id: string; indicator_code: string; domain: string; title: string; description: string | null;
  metric_code: string; metric_type: string; aggregation_type: string;
  good_event_definition: string; total_event_definition: string; source_type: string; source_version: string;
  scope_type: string; is_active: boolean; limitations: Array<string | Record<string, unknown>>; evidence: Array<Record<string, unknown>>;
  created_by: string | null; approved_by: string | null; created_at: string; updated_at: string;
}
export interface ReliabilityObjectiveRow {
  id: string; objective_code: string; indicator_id: string; indicator_code?: string; domain?: string; metric_code?: string;
  scope_type: string; scope_id: string | null; target_value: number; compliance_window: string;
  minimum_sample: number; minimum_data_coverage: number; severity: string;
  error_budget_policy: Record<string, unknown>; burn_rate_policy: Record<string, unknown>;
  effective_from: string; effective_to: string | null; lifecycle_status: string; version: number;
  change_reason: string; checksum: string; previous_version_id: string | null;
  approved_by: string | null; created_by: string | null; created_at: string; updated_at: string;
}
export interface ReliabilitySnapshotRow {
  id: string; indicator_id: string; indicator_code?: string; domain?: string; metric_code?: string;
  window_code: string; period_start: string | null; period_end: string;
  good_events: number | null; total_events: number | null; sli_value: number | null; sample_size: number | null;
  data_coverage: number | null; status: string; source_version: string; input_hash: string;
  evidence: Array<Record<string, unknown>>; limitations: Array<string | Record<string, unknown>>; calculated_at: string; created_at: string;
}
export interface ReliabilityDecisionRow {
  id: string; decision_type: string; decision: string; scope: string | null; reason: string;
  period_start: string | null; period_end: string | null; expires_at: string | null;
  risk_snapshot: Record<string, unknown>; freeze_reference: Record<string, unknown> | null;
  evidence: Array<Record<string, unknown>>; limitations: Array<string | Record<string, unknown>>; decided_by: string | null; created_at: string;
}
export interface ReliabilityEventRow { id: string; event_type: string; ref_id: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }
export async function saveReliabilityIndicator(payload: Record<string, unknown>): Promise<ReliabilityIndicatorRow> {
  const { data, error } = await supabase.rpc('admin_reliability_indicator_save', { p_payload: payload });
  if (error) throw error; return data as ReliabilityIndicatorRow;
}
export async function fetchReliabilityIndicators(domain: string | null = null, limit = 100): Promise<ReliabilityIndicatorRow[]> {
  const { data, error } = await supabase.rpc('admin_reliability_indicators', { p_domain: domain, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: ReliabilityIndicatorRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function saveReliabilityObjective(payload: Record<string, unknown>): Promise<ReliabilityObjectiveRow> {
  const { data, error } = await supabase.rpc('admin_reliability_objective_save', { p_payload: payload });
  if (error) throw error; return data as ReliabilityObjectiveRow;
}
export async function fetchReliabilityObjectives(status: string | null = null, limit = 100): Promise<ReliabilityObjectiveRow[]> {
  const { data, error } = await supabase.rpc('admin_reliability_objectives', { p_status: status, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: ReliabilityObjectiveRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function computeReliabilitySli(indicatorId: string, window: string | null): Promise<ReliabilitySnapshotRow> {
  const { data, error } = await supabase.rpc('admin_reliability_sli_compute', { p_indicator_id: indicatorId, p_window: window });
  if (error) throw error; return data as ReliabilitySnapshotRow;
}
export async function fetchReliabilitySnapshots(indicatorId: string | null = null, window: string | null = null, limit = 100): Promise<ReliabilitySnapshotRow[]> {
  const { data, error } = await supabase.rpc('admin_reliability_snapshots', { p_indicator_id: indicatorId, p_window: window, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: ReliabilitySnapshotRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function fetchReliabilitySummary(): Promise<Record<string, number | string | Record<string, number> | null>> {
  const { data, error } = await supabase.rpc('admin_reliability_summary');
  if (error) throw error;
  return (data as Record<string, number | string | Record<string, number> | null> | null) ?? {};
}
export async function recordReliabilityFreezeDecision(payload: Record<string, unknown>): Promise<ReliabilityDecisionRow> {
  const { data, error } = await supabase.rpc('admin_reliability_freeze_decision', { p_payload: payload });
  if (error) throw error; return data as ReliabilityDecisionRow;
}
export async function certifyReliability(payload: Record<string, unknown>): Promise<ReliabilityDecisionRow> {
  const { data, error } = await supabase.rpc('admin_reliability_certify', { p_payload: payload });
  if (error) throw error; return data as ReliabilityDecisionRow;
}
export async function fetchReliabilityDecisions(type: string | null = null, limit = 100): Promise<ReliabilityDecisionRow[]> {
  const { data, error } = await supabase.rpc('admin_reliability_decisions', { p_type: type, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: ReliabilityDecisionRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function fetchReliabilityAudit(limit = 200): Promise<ReliabilityEventRow[]> {
  const { data, error } = await supabase.rpc('admin_reliability_audit', { p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: ReliabilityEventRow[] } | null) ?? {};
  return d.items ?? [];
}

// ── Capacity & Continuity (0508 — 예측/권고/계획 Evidence 만, Infrastructure/Billing 실행 없음) ──

export interface CapacityMetricRow {
  id: string; metric_code: string; domain: string; title: string; description: string | null;
  unit: string; source_type: string; aggregation_type: string; limit_source: string;
  hard_limit: number | null; soft_limit: number | null; warning_threshold: number; critical_threshold: number;
  scope_type: string; source_version: string; is_active: boolean;
  limitations: Array<string | Record<string, unknown>>; evidence: Array<Record<string, unknown>>;
  created_by: string | null; approved_by: string | null; created_at: string; updated_at: string;
}
export interface CapacitySnapshotRow {
  id: string; metric_id: string; metric_code?: string; domain?: string; unit?: string;
  scope_type: string; period_start: string | null; period_end: string;
  current_usage: number | null; soft_limit: number | null; hard_limit: number | null;
  utilization_percent: number | null; growth_per_day: number | null; headroom: number | null;
  projected_exhaustion_at: string | null; status: string; sample_size: number | null;
  source_version: string; input_hash: string;
  evidence: Array<Record<string, unknown>>; limitations: Array<string | Record<string, unknown>>;
  calculated_at: string; created_at: string;
}
export interface CapacityUsageDay { day: string; events: number; active_stores: number; active_players: number }
export interface CostModelRow {
  id: string; cost_code: string; provider: string; resource_type: string; unit: string;
  unit_price: number; currency: string; billing_period: string; included_amount: number | null; overage_price: number | null;
  effective_from: string; effective_to: string | null; version: number; source: string;
  evidence: Array<Record<string, unknown>>; approved_by: string | null; created_by: string | null; created_at: string;
}
export interface CostSnapshotRow {
  id: string; period_start: string; period_end: string; provider: string; resource_type: string;
  usage_amount: number | null; included_usage: number | null; billable_usage: number | null;
  estimated_cost: number | null; actual_cost: number | null; currency: string; model_version: string | null;
  input_hash: string; status: string; evidence: Array<Record<string, unknown>>; limitations: Array<string | Record<string, unknown>>;
  created_by: string | null; created_at: string;
}
export interface CapacityPlanRow {
  id: string; plan_code: string; metric_code: string; scope_type: string; plan_type: string;
  current_capacity: number | null; target_capacity: number | null; forecast_horizon: string | null;
  trigger_condition: string; recommended_window: string | null; expected_cost: Record<string, unknown>;
  risk_tier: string; dependencies: Array<unknown>; validation_plan: Array<unknown>;
  rollback_plan: Record<string, unknown> | null; observation_plan: Record<string, unknown> | null;
  evidence: Array<Record<string, unknown>>; limitations: Array<string | Record<string, unknown>>;
  status: string; idempotency_key: string; requested_by: string | null; reviewed_by: string | null;
  created_at: string; reviewed_at: string | null; expired_at: string | null;
}
export interface OperationalDependencyRow {
  id: string; dependency_code: string; domain: string; provider: string; service_name: string;
  dependency_type: string; criticality: string; failure_impact: string | null;
  fallback_available: boolean | null; fallback_description: string | null;
  rto_target: string; rpo_target: string; monitoring_source: string | null; owner: string | null;
  evidence: Array<Record<string, unknown>>; limitations: Array<string | Record<string, unknown>>;
  lifecycle_status: string; approved_by: string | null; created_at: string; updated_at: string;
}
export interface CapacityEventRow { id: string; event_type: string; ref_id: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }
export async function saveCapacityMetric(payload: Record<string, unknown>): Promise<CapacityMetricRow> {
  const { data, error } = await supabase.rpc('admin_capacity_metric_save', { p_payload: payload });
  if (error) throw error; return data as CapacityMetricRow;
}
export async function fetchCapacityMetrics(domain: string | null = null, limit = 100): Promise<CapacityMetricRow[]> {
  const { data, error } = await supabase.rpc('admin_capacity_metrics', { p_domain: domain, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: CapacityMetricRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function fetchCapacityUsage(days = 30): Promise<CapacityUsageDay[]> {
  const { data, error } = await supabase.rpc('admin_capacity_usage', { p_days: days });
  if (error) throw error;
  const d = (data as { items?: CapacityUsageDay[] } | null) ?? {};
  return d.items ?? [];
}
export async function createCapacitySnapshot(metricId: string): Promise<CapacitySnapshotRow> {
  const { data, error } = await supabase.rpc('admin_capacity_snapshot_create', { p_metric_id: metricId });
  if (error) throw error; return data as CapacitySnapshotRow;
}
export async function fetchCapacitySnapshots(metricId: string | null = null, limit = 100): Promise<CapacitySnapshotRow[]> {
  const { data, error } = await supabase.rpc('admin_capacity_snapshots', { p_metric_id: metricId, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: CapacitySnapshotRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function fetchCapacitySummary(): Promise<Record<string, number | string | Record<string, number> | null>> {
  const { data, error } = await supabase.rpc('admin_capacity_summary');
  if (error) throw error;
  return (data as Record<string, number | string | Record<string, number> | null> | null) ?? {};
}
export async function saveCostModel(payload: Record<string, unknown>): Promise<CostModelRow> {
  const { data, error } = await supabase.rpc('admin_cost_model_save', { p_payload: payload });
  if (error) throw error; return data as CostModelRow;
}
export async function fetchCostModels(limit = 100): Promise<CostModelRow[]> {
  const { data, error } = await supabase.rpc('admin_cost_models', { p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: CostModelRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function saveCostSnapshot(payload: Record<string, unknown>): Promise<CostSnapshotRow> {
  const { data, error } = await supabase.rpc('admin_cost_snapshot_save', { p_payload: payload });
  if (error) throw error; return data as CostSnapshotRow;
}
export async function fetchCostSnapshots(limit = 100): Promise<CostSnapshotRow[]> {
  const { data, error } = await supabase.rpc('admin_cost_snapshots', { p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: CostSnapshotRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function saveCapacityPlan(payload: Record<string, unknown>): Promise<{ idempotent: boolean; plan: CapacityPlanRow }> {
  const { data, error } = await supabase.rpc('admin_capacity_plan_save', { p_payload: payload });
  if (error) throw error; return data as { idempotent: boolean; plan: CapacityPlanRow };
}
export async function fetchCapacityPlans(status: string | null = null, limit = 100): Promise<CapacityPlanRow[]> {
  const { data, error } = await supabase.rpc('admin_capacity_plans', { p_status: status, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: CapacityPlanRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function reviewCapacityPlan(id: string, status: string, reason: string): Promise<CapacityPlanRow> {
  const { data, error } = await supabase.rpc('admin_capacity_plan_review', { p_id: id, p_status: status, p_reason: reason });
  if (error) throw error; return data as CapacityPlanRow;
}
export async function saveOperationalDependency(payload: Record<string, unknown>): Promise<OperationalDependencyRow> {
  const { data, error } = await supabase.rpc('admin_operational_dependency_save', { p_payload: payload });
  if (error) throw error; return data as OperationalDependencyRow;
}
export async function fetchOperationalDependencies(limit = 100): Promise<OperationalDependencyRow[]> {
  const { data, error } = await supabase.rpc('admin_operational_dependencies', { p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: OperationalDependencyRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function fetchCapacityAudit(limit = 200): Promise<CapacityEventRow[]> {
  const { data, error } = await supabase.rpc('admin_capacity_audit', { p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: CapacityEventRow[] } | null) ?? {};
  return d.items ?? [];
}

// ── Operational Command (0509 — 업무 등록/배정/추적/권고/보고, 자동 배정·발송 없음) ──

export interface OpsWorkItemRow {
  id: string; work_item_code: string; source_type: string; source_id: string | null; work_type: string;
  title: string; description: string | null; priority: string; severity: string | null; work_status: string;
  scope_type: string; scope_id: string | null;
  assigned_to: string | null; backup_assignee: string | null; reviewer_id: string | null; approver_id: string | null;
  sla_policy_id: string | null; due_at: string | null; response_due_at: string | null; resolution_due_at: string | null;
  sla_paused_at: string | null; sla_pause_reason: string | null;
  acknowledged_at: string | null; started_at: string | null; completed_at: string | null; cancelled_at: string | null;
  source_version: string; input_hash: string; idempotency_key: string;
  evidence: Array<Record<string, unknown>>; limitations: Array<string | Record<string, unknown>>;
  created_by: string | null; created_at: string; updated_at: string;
}
export interface OpsPolicyRow {
  id: string; policy_code: string; policy_type: string; work_type: string | null; priority: string | null;
  config: Record<string, unknown>; lifecycle_status: string; version: number; change_reason: string; checksum: string;
  previous_version_id: string | null; approved_by: string | null; created_by: string | null; created_at: string; updated_at: string;
}
export interface OpsEscalationRow {
  id: string; work_item_id: string; work_item_code?: string; title?: string; escalation_level: number;
  trigger_type: string; escalation_status: string; recommended_target: string | null; assigned_target: string | null;
  reason: string; notification_references: Array<Record<string, unknown>>;
  acknowledged_by: string | null; acknowledged_at: string | null; resolved_at: string | null;
  evidence: Array<Record<string, unknown>>; limitations: Array<string | Record<string, unknown>>; created_by: string | null; created_at: string;
}
export interface OpsShiftRow {
  id: string; shift_code: string; shift_date: string; timezone: string; shift_start: string; shift_end: string;
  primary_operator: string; backup_operator: string | null; escalation_operator: string | null; scope: string; status: string;
  evidence: Array<Record<string, unknown>>; limitations: Array<string | Record<string, unknown>>;
  created_by: string | null; approved_by: string | null; created_at: string; updated_at: string;
}
export interface OpsHandoverRow {
  id: string; from_shift_id: string | null; to_shift_id: string | null; snapshot: Record<string, number>;
  handover_summary: string; unresolved_questions: Array<unknown>; status: string;
  evidence: Array<Record<string, unknown>>; limitations: Array<string | Record<string, unknown>>;
  accepted_by: string | null; accepted_at: string | null; decline_reason: string | null; created_by: string | null; created_at: string;
}
export interface OpsEmergencyRow {
  id: string; reference_code: string; mode_status: string; scope: string; activation_trigger: string;
  decision_authority: string; plan_policy_id: string | null; expires_at: string | null; reason: string;
  evidence: Array<Record<string, unknown>>; limitations: Array<string | Record<string, unknown>>; created_by: string | null; created_at: string;
}
export interface OpsOperatorRow { id: string; email: string; is_active: boolean; availability: string; open_assigned: number; urgent_assigned: number }
export interface OpsEventRow { id: string; event_type: string; work_item_id: string | null; ref_id: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }
export async function fetchOpsCommandSummary(): Promise<Record<string, number | string | Record<string, number> | null>> {
  const { data, error } = await supabase.rpc('admin_ops_command_summary');
  if (error) throw error;
  return (data as Record<string, number | string | Record<string, number> | null> | null) ?? {};
}
export async function enrollOpsWorkItem(payload: Record<string, unknown>): Promise<{ idempotent: boolean; work_item: OpsWorkItemRow }> {
  const { data, error } = await supabase.rpc('admin_ops_work_enroll', { p_payload: payload });
  if (error) throw error; return data as { idempotent: boolean; work_item: OpsWorkItemRow };
}
export async function fetchOpsWorkItems(status: string | null = null, priority: string | null = null, assigned: string | null = null, limit = 100): Promise<OpsWorkItemRow[]> {
  const { data, error } = await supabase.rpc('admin_ops_work_items', { p_status: status, p_priority: priority, p_assigned: assigned, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: OpsWorkItemRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function updateOpsWorkItem(id: string, section: string, value: unknown, reason: string): Promise<OpsWorkItemRow> {
  const { data, error } = await supabase.rpc('admin_ops_work_update', { p_id: id, p_section: section, p_value: value, p_reason: reason });
  if (error) throw error; return data as OpsWorkItemRow;
}
export async function assignOpsWorkItem(id: string, role: string, userId: string | null, reason: string): Promise<OpsWorkItemRow> {
  const { data, error } = await supabase.rpc('admin_ops_assign', { p_id: id, p_role: role, p_user_id: userId, p_reason: reason });
  if (error) throw error; return data as OpsWorkItemRow;
}
export async function saveOpsPolicy(payload: Record<string, unknown>): Promise<OpsPolicyRow> {
  const { data, error } = await supabase.rpc('admin_ops_policy_save', { p_payload: payload });
  if (error) throw error; return data as OpsPolicyRow;
}
export async function fetchOpsPolicies(type: string | null = null, limit = 100): Promise<OpsPolicyRow[]> {
  const { data, error } = await supabase.rpc('admin_ops_policies', { p_type: type, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: OpsPolicyRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function requestOpsEscalation(payload: Record<string, unknown>): Promise<OpsEscalationRow> {
  const { data, error } = await supabase.rpc('admin_ops_escalation_request', { p_payload: payload });
  if (error) throw error; return data as OpsEscalationRow;
}
export async function decideOpsEscalation(id: string, section: string, value: unknown, reason: string): Promise<OpsEscalationRow> {
  const { data, error } = await supabase.rpc('admin_ops_escalation_decision', { p_id: id, p_section: section, p_value: value, p_reason: reason });
  if (error) throw error; return data as OpsEscalationRow;
}
export async function fetchOpsEscalations(status: string | null = null, limit = 100): Promise<OpsEscalationRow[]> {
  const { data, error } = await supabase.rpc('admin_ops_escalations', { p_status: status, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: OpsEscalationRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function saveOpsShift(payload: Record<string, unknown>): Promise<OpsShiftRow> {
  const { data, error } = await supabase.rpc('admin_ops_shift_save', { p_payload: payload });
  if (error) throw error; return data as OpsShiftRow;
}
export async function fetchOpsShifts(limit = 100): Promise<OpsShiftRow[]> {
  const { data, error } = await supabase.rpc('admin_ops_shifts', { p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: OpsShiftRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function createOpsHandover(payload: Record<string, unknown>): Promise<OpsHandoverRow> {
  const { data, error } = await supabase.rpc('admin_ops_handover_create', { p_payload: payload });
  if (error) throw error; return data as OpsHandoverRow;
}
export async function acceptOpsHandover(id: string, action: string, reason: string): Promise<OpsHandoverRow> {
  const { data, error } = await supabase.rpc('admin_ops_handover_accept', { p_id: id, p_action: action, p_reason: reason });
  if (error) throw error; return data as OpsHandoverRow;
}
export async function fetchOpsHandovers(limit = 100): Promise<OpsHandoverRow[]> {
  const { data, error } = await supabase.rpc('admin_ops_handovers', { p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: OpsHandoverRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function recordOpsEmergencyReference(payload: Record<string, unknown>): Promise<OpsEmergencyRow> {
  const { data, error } = await supabase.rpc('admin_ops_emergency_reference', { p_payload: payload });
  if (error) throw error; return data as OpsEmergencyRow;
}
export async function fetchOpsEmergencyReferences(limit = 50): Promise<OpsEmergencyRow[]> {
  const { data, error } = await supabase.rpc('admin_ops_emergency_references', { p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: OpsEmergencyRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function fetchOpsOperators(): Promise<{ items: OpsOperatorRow[]; note: string }> {
  const { data, error } = await supabase.rpc('admin_ops_operators');
  if (error) throw error;
  const d = (data as { items?: OpsOperatorRow[]; note?: string } | null) ?? {};
  return { items: d.items ?? [], note: d.note ?? '' };
}
export async function fetchOpsAudit(workItemId: string | null = null, limit = 200): Promise<OpsEventRow[]> {
  const { data, error } = await supabase.rpc('admin_ops_audit', { p_work_item_id: workItemId, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: OpsEventRow[] } | null) ?? {};
  return d.items ?? [];
}

// ── Security / Privacy / Compliance (0510 — 조회·검토·권고·Reference 만, 계정/권한/데이터 변경 없음) ──

export interface SecurityIdentityRow {
  id: string; role: string; account_type: string | null; masked_email: string | null;
  is_active: boolean; is_admin: boolean; last_sign_in_at: string | null; created_at: string; mfa_status: string;
}
export interface AccessReviewRow {
  id: string; review_code: string; review_scope: string; subject_user_id: string; subject_role: string | null;
  review_type: string; current_permissions: Record<string, unknown>; risk_summary: Record<string, unknown>;
  conflict_summary: Record<string, unknown>; recommendation: string | null; review_status: string;
  reviewer_id: string | null; approver_id: string | null; decision: string | null; decision_reason: string | null;
  evidence: Array<Record<string, unknown>>; limitations: Array<string | Record<string, unknown>>;
  source_version: string; input_hash: string; idempotency_key: string;
  created_by: string | null; created_at: string; reviewed_at: string | null; expires_at: string | null;
}
export interface DataRegistryRow {
  id: string; data_code: string; domain: string; table_name: string; column_name: string | null;
  storage_location: string; classification: string; contains_personal_data: boolean;
  contains_financial_data: boolean; contains_contract_data: boolean;
  encryption_status: string; access_logging_status: string; retention_policy_id: string | null; owner: string | null;
  evidence: Array<Record<string, unknown>>; limitations: Array<string | Record<string, unknown>>;
  lifecycle_status: string; approved_by: string | null; created_at: string; updated_at: string;
}
export interface PrivacyRequestRow {
  id: string; request_code: string; subject_user_id: string | null; request_type: string; request_status: string;
  requested_at: string; identity_verified_at: string | null; due_at: string | null; assigned_to: string | null;
  data_scope: Array<unknown>; legal_hold: boolean; retention_exception: string | null; action_plan: Array<unknown>;
  external_action_reference: Record<string, unknown> | null; decision: string | null; decision_reason: string | null;
  evidence: Array<Record<string, unknown>>; limitations: Array<string | Record<string, unknown>>;
  created_by: string | null; reviewed_by: string | null; completed_at: string | null; created_at: string;
}
export interface RetentionPolicyRow {
  id: string; policy_code: string; data_domain: string; retention_period_days: number | null; legal_basis: string;
  contract_requirement: boolean; settlement_requirement: boolean; deletion_method: string; exception_rules: Array<unknown>;
  effective_from: string; effective_to: string | null; version: number; lifecycle_status: string; change_reason: string;
  approved_by: string | null; created_by: string | null; created_at: string;
}
export interface ComplianceControlRow {
  id: string; control_code: string; control_domain: string; title: string; description: string | null; requirement: string | null;
  evidence_sources: Array<unknown>; control_status: string; owner: string | null; reviewer: string | null;
  review_frequency: string | null; last_reviewed_at: string | null; next_review_at: string | null;
  evidence: Array<Record<string, unknown>>; limitations: Array<string | Record<string, unknown>>;
  lifecycle_status: string; approved_by: string | null; created_at: string; updated_at: string;
}
export interface SecurityEventRow { id: string; event_type: string; severity: string; subject_user_id: string | null; ref_id: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }
export async function fetchSecuritySummary(): Promise<Record<string, number | string | Record<string, number> | null>> {
  const { data, error } = await supabase.rpc('admin_security_summary');
  if (error) throw error;
  return (data as Record<string, number | string | Record<string, number> | null> | null) ?? {};
}
export async function fetchSecurityIdentities(limit = 200): Promise<{ items: SecurityIdentityRow[]; note: string }> {
  const { data, error } = await supabase.rpc('admin_security_identities', { p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: SecurityIdentityRow[]; note?: string } | null) ?? {};
  return { items: d.items ?? [], note: d.note ?? '' };
}
export async function createAccessReview(payload: Record<string, unknown>): Promise<{ idempotent: boolean; review: AccessReviewRow }> {
  const { data, error } = await supabase.rpc('admin_security_access_review_create', { p_payload: payload });
  if (error) throw error; return data as { idempotent: boolean; review: AccessReviewRow };
}
export async function decideAccessReview(id: string, status: string, recommendation: string | null, reason: string): Promise<AccessReviewRow> {
  const { data, error } = await supabase.rpc('admin_security_access_review_decide', { p_id: id, p_status: status, p_recommendation: recommendation, p_reason: reason });
  if (error) throw error; return data as AccessReviewRow;
}
export async function fetchAccessReviews(status: string | null = null, limit = 100): Promise<AccessReviewRow[]> {
  const { data, error } = await supabase.rpc('admin_security_access_reviews', { p_status: status, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: AccessReviewRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function recordSecurityExternalAction(payload: Record<string, unknown>): Promise<{ recorded: boolean; event_id: string; note: string }> {
  const { data, error } = await supabase.rpc('admin_security_external_action_reference', { p_payload: payload });
  if (error) throw error; return data as { recorded: boolean; event_id: string; note: string };
}
export async function saveSecurityDataRegistry(payload: Record<string, unknown>): Promise<DataRegistryRow> {
  const { data, error } = await supabase.rpc('admin_security_data_registry_save', { p_payload: payload });
  if (error) throw error; return data as DataRegistryRow;
}
export async function fetchSecurityDataRegistry(limit = 100): Promise<DataRegistryRow[]> {
  const { data, error } = await supabase.rpc('admin_security_data_registry', { p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: DataRegistryRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function createPrivacyRequest(payload: Record<string, unknown>): Promise<PrivacyRequestRow> {
  const { data, error } = await supabase.rpc('admin_privacy_request_create', { p_payload: payload });
  if (error) throw error; return data as PrivacyRequestRow;
}
export async function updatePrivacyRequest(id: string, section: string, value: unknown, reason: string): Promise<PrivacyRequestRow> {
  const { data, error } = await supabase.rpc('admin_privacy_request_update', { p_id: id, p_section: section, p_value: value, p_reason: reason });
  if (error) throw error; return data as PrivacyRequestRow;
}
export async function fetchPrivacyRequests(status: string | null = null, limit = 100): Promise<PrivacyRequestRow[]> {
  const { data, error } = await supabase.rpc('admin_privacy_requests', { p_status: status, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: PrivacyRequestRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function saveRetentionPolicy(payload: Record<string, unknown>): Promise<RetentionPolicyRow> {
  const { data, error } = await supabase.rpc('admin_retention_policy_save', { p_payload: payload });
  if (error) throw error; return data as RetentionPolicyRow;
}
export async function fetchRetentionPolicies(limit = 100): Promise<RetentionPolicyRow[]> {
  const { data, error } = await supabase.rpc('admin_retention_policies', { p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: RetentionPolicyRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function saveComplianceControl(payload: Record<string, unknown>): Promise<ComplianceControlRow> {
  const { data, error } = await supabase.rpc('admin_compliance_control_save', { p_payload: payload });
  if (error) throw error; return data as ComplianceControlRow;
}
export async function fetchComplianceControls(limit = 100): Promise<ComplianceControlRow[]> {
  const { data, error } = await supabase.rpc('admin_compliance_controls', { p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: ComplianceControlRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function fetchSecurityAudit(limit = 200): Promise<SecurityEventRow[]> {
  const { data, error } = await supabase.rpc('admin_security_audit', { p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: SecurityEventRow[] } | null) ?? {};
  return d.items ?? [];
}

// ── Executive Strategy (0511 — 경영 지표 실측/추정, 추천·근거만·자동 의사결정 없음) ──

export type ExecBusinessSummary = Record<string, number | string | Record<string, number> | null>;
export interface ExecGrowthSeries {
  months: number;
  new_businesses: Array<{ month: string; count: number }>;
  new_artists: Array<{ month: string; count: number }>;
  new_tracks: Array<{ month: string; count: number }>;
  new_signed_contracts: Array<{ month: string; count: number }>;
  monthly_paid_revenue: Array<{ month: string; amount: number }>;
  growth_by_industry: Array<{ industry: string; count: number }>;
}
export interface ExecBriefingRow {
  id: string; briefing_date: string; snapshot: Record<string, unknown>; highlights: Array<unknown>;
  recommendations_ref: Array<unknown>; limitations: Array<string | Record<string, unknown>>;
  generated_by: string | null; created_at: string;
}
export interface ExecDecisionRow {
  id: string; decision_code: string; category: string; recommendation: string; reason: string;
  evidence: Array<Record<string, unknown>>; confidence: number | null; alternatives: Array<string>;
  expected_benefit: string; risk: string; decision_status: string; human_decision_reason: string | null;
  decided_by: string | null; decided_at: string | null; limitations: Array<string | Record<string, unknown>>;
  source_version: string; idempotency_key: string; created_by: string | null; created_at: string;
}
export interface ExecEventRow { id: string; event_type: string; ref_id: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }
export async function fetchExecBusinessSummary(): Promise<ExecBusinessSummary> {
  const { data, error } = await supabase.rpc('admin_executive_business_summary');
  if (error) throw error;
  return (data as ExecBusinessSummary | null) ?? {};
}
export async function fetchExecGrowthSeries(months = 6): Promise<ExecGrowthSeries> {
  const { data, error } = await supabase.rpc('admin_executive_growth_series', { p_months: months });
  if (error) throw error;
  const d = (data as Partial<ExecGrowthSeries> | null) ?? {};
  return { months: d.months ?? months, new_businesses: d.new_businesses ?? [], new_artists: d.new_artists ?? [], new_tracks: d.new_tracks ?? [], new_signed_contracts: d.new_signed_contracts ?? [], monthly_paid_revenue: d.monthly_paid_revenue ?? [], growth_by_industry: d.growth_by_industry ?? [] };
}
export async function saveExecBriefing(payload: Record<string, unknown>): Promise<ExecBriefingRow> {
  const { data, error } = await supabase.rpc('admin_executive_briefing_save', { p_payload: payload });
  if (error) throw error; return data as ExecBriefingRow;
}
export async function fetchExecBriefings(limit = 30): Promise<ExecBriefingRow[]> {
  const { data, error } = await supabase.rpc('admin_executive_briefings', { p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: ExecBriefingRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function saveExecDecision(payload: Record<string, unknown>): Promise<{ idempotent: boolean; decision: ExecDecisionRow }> {
  const { data, error } = await supabase.rpc('admin_executive_decision_save', { p_payload: payload });
  if (error) throw error; return data as { idempotent: boolean; decision: ExecDecisionRow };
}
export async function decideExecDecision(id: string, status: string, reason: string): Promise<ExecDecisionRow> {
  const { data, error } = await supabase.rpc('admin_executive_decision_decide', { p_id: id, p_status: status, p_reason: reason });
  if (error) throw error; return data as ExecDecisionRow;
}
export async function fetchExecDecisions(status: string | null = null, limit = 100): Promise<ExecDecisionRow[]> {
  const { data, error } = await supabase.rpc('admin_executive_decisions', { p_status: status, p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: ExecDecisionRow[] } | null) ?? {};
  return d.items ?? [];
}
export async function fetchExecAudit(limit = 200): Promise<ExecEventRow[]> {
  const { data, error } = await supabase.rpc('admin_executive_audit', { p_limit: limit });
  if (error) throw error;
  const d = (data as { items?: ExecEventRow[] } | null) ?? {};
  return d.items ?? [];
}

// ── Policy Governance (0512 — 정책 registry/버전/추천, 자동 정책 변경·Production 적용 없음) ──

export type PolicySummary = Record<string, number | string | boolean | Record<string, number> | Array<Record<string, unknown>> | null>;
export interface PolicyRow {
  id: string; policy_code: string; domain: string; title: string; status: string;
  current_version: number; source_ref: string | null; depends_on: string[];
  objectives: string[]; limitations: Array<string | Record<string, unknown>>;
  created_by: string | null; created_at: string; updated_at: string;
}
export interface PolicyVersionRow {
  id: string; policy_id: string; version: number; previous_version: number | null;
  content: Record<string, unknown>; effective_date: string | null; change_reason: string;
  evidence: Array<Record<string, unknown>>; limitations: Array<string | Record<string, unknown>>;
  proposed_by: string | null; approved_by: string | null; approval_date: string | null; created_at: string;
}
export interface PolicyRecommendationRow {
  id: string; rec_code: string; policy_code: string | null; rec_type: string;
  recommendation: string; reason: string; evidence: Array<Record<string, unknown>>;
  confidence: number | null; alternatives: string[]; risk: string;
  preconditions: Array<string | Record<string, unknown>>; limitations: Array<string | Record<string, unknown>>;
  simulation: Record<string, unknown> | null; impact: Record<string, unknown> | null;
  approval_status: string; human_decision_reason: string | null; decided_by: string | null;
  decided_at: string | null; source_version: string; idempotency_key: string;
  created_by: string | null; created_at: string;
}
export interface PolicyEventRow { id: string; event_type: string; ref_id: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }

export async function fetchPolicySummary(): Promise<PolicySummary> {
  const { data, error } = await supabase.rpc('admin_policy_summary');
  if (error) throw error;
  return (data as PolicySummary | null) ?? {};
}
export async function fetchPolicyInventory(domain: string | null = null, status: string | null = null, limit = 100): Promise<PolicyRow[]> {
  const { data, error } = await supabase.rpc('admin_policy_inventory', { p_domain: domain, p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as PolicyRow[];
}
export async function fetchPolicyVersions(policyCode: string, limit = 50): Promise<PolicyVersionRow[]> {
  const { data, error } = await supabase.rpc('admin_policy_versions', { p_policy_code: policyCode, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as PolicyVersionRow[];
}
export async function registerPolicy(payload: {
  code: string; domain: string; title: string; content: Record<string, unknown>; changeReason: string;
  evidence?: Array<Record<string, unknown>>; sourceRef?: string | null; dependsOn?: string[];
  objectives?: string[]; status?: string; effectiveDate?: string | null;
}): Promise<{ ok: boolean; policy_id: string; version: number; production_applied: boolean }> {
  const { data, error } = await supabase.rpc('admin_policy_register', {
    p_code: payload.code, p_domain: payload.domain, p_title: payload.title,
    p_content: payload.content, p_change_reason: payload.changeReason,
    p_evidence: payload.evidence ?? [], p_source_ref: payload.sourceRef ?? null,
    p_depends_on: payload.dependsOn ?? [], p_objectives: payload.objectives ?? [],
    p_status: payload.status ?? 'draft', p_effective_date: payload.effectiveDate ?? null,
  });
  if (error) throw error;
  return data as { ok: boolean; policy_id: string; version: number; production_applied: boolean };
}
export async function addPolicyVersion(payload: {
  code: string; content: Record<string, unknown>; changeReason: string;
  evidence?: Array<Record<string, unknown>>; effectiveDate?: string | null;
  newStatus?: string | null; approvedBySelf?: boolean;
}): Promise<{ ok: boolean; policy_id: string; version: number; previous_version: number; production_applied: boolean }> {
  const { data, error } = await supabase.rpc('admin_policy_version_add', {
    p_code: payload.code, p_content: payload.content, p_change_reason: payload.changeReason,
    p_evidence: payload.evidence ?? [], p_effective_date: payload.effectiveDate ?? null,
    p_new_status: payload.newStatus ?? null, p_approved_by_self: payload.approvedBySelf ?? false,
  });
  if (error) throw error;
  return data as { ok: boolean; policy_id: string; version: number; previous_version: number; production_applied: boolean };
}
export async function savePolicyRecommendation(payload: {
  code: string; recType: string; recommendation: string; reason: string;
  evidence: Array<Record<string, unknown>>; confidence: number; alternatives: string[];
  risk: string; preconditions: string[]; limitations: string[]; idempotencyKey: string;
  policyCode?: string | null; simulation?: Record<string, unknown> | null; impact?: Record<string, unknown> | null;
}): Promise<{ ok: boolean; id: string; approval_status?: string; idempotent?: boolean }> {
  const { data, error } = await supabase.rpc('admin_policy_recommendation_save', {
    p_code: payload.code, p_rec_type: payload.recType, p_recommendation: payload.recommendation,
    p_reason: payload.reason, p_evidence: payload.evidence, p_confidence: payload.confidence,
    p_alternatives: payload.alternatives, p_risk: payload.risk, p_preconditions: payload.preconditions,
    p_limitations: payload.limitations, p_idempotency_key: payload.idempotencyKey,
    p_policy_code: payload.policyCode ?? null, p_simulation: payload.simulation ?? null, p_impact: payload.impact ?? null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; approval_status?: string; idempotent?: boolean };
}
export async function decidePolicyRecommendation(id: string, status: string, reason: string): Promise<{ ok: boolean; approval_status: string; production_applied: boolean }> {
  const { data, error } = await supabase.rpc('admin_policy_recommendation_decide', { p_id: id, p_status: status, p_reason: reason });
  if (error) throw error;
  return data as { ok: boolean; approval_status: string; production_applied: boolean };
}
export async function fetchPolicyRecommendations(status: string | null = null, limit = 100): Promise<PolicyRecommendationRow[]> {
  const { data, error } = await supabase.rpc('admin_policy_recommendations', { p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as PolicyRecommendationRow[];
}
export async function fetchPolicyAudit(limit = 200): Promise<PolicyEventRow[]> {
  const { data, error } = await supabase.rpc('admin_policy_audit', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as PolicyEventRow[];
}

// ── Knowledge Graph (0513 — Entity/관계 inventory·분석 전용, 원본/FK/관계 변경 없음) ──

export type KGSummary = Record<string, number | string | boolean | Record<string, number> | Record<string, unknown> | null>;
export interface KGEntityRow {
  id: string; entity_type: string; source_table: string; source_primary_key: string;
  display_label: string; domain: string; lifecycle_status: string | null; is_sensitive: boolean;
  source_version: string; limitations: Array<string | Record<string, unknown>>;
  first_observed_at: string; last_observed_at: string; snapshot_at: string; created_at: string;
}
export interface KGRelationshipRow {
  id: string; relationship_type: string; source_entity_id: string; target_entity_id: string;
  direction: string; evidence_type: string; evidence_source: string; evidence_strength: string;
  relationship_status: string; confidence: number | null; limitations: Array<string | Record<string, unknown>>;
  source_version: string; first_observed_at: string; last_observed_at: string; snapshot_at: string; created_at: string;
}
export interface KGEntityDetail {
  entity: KGEntityRow;
  outgoing: Array<{ id: string; relationship_type: string; target_entity_id: string; target_label: string; target_type: string; evidence_type: string; evidence_strength: string; evidence_source: string }>;
  incoming: Array<{ id: string; relationship_type: string; source_entity_id: string; source_label: string; source_type: string; evidence_type: string; evidence_strength: string; evidence_source: string }>;
}
export interface KGSnapshotRow {
  id: string; snapshot_code: string; domain_scope: string; entity_count: number; relationship_count: number;
  confirmed_relationship_count: number; inferred_relationship_count: number;
  source_entity_counts: Record<string, unknown>; risk_summary: Record<string, unknown> | null;
  limitations: Array<string | Record<string, unknown>>; input_hash: string; source_version: string;
  generated_by: string | null; generated_at: string; created_at: string;
}
export interface KGReviewRow {
  id: string; review_code: string; kind: string; subject_entity_id: string | null; subject_relationship_id: string | null;
  topic: string; reason: string; evidence: Array<Record<string, unknown>>; review_status: string;
  external_action_type: string | null; human_decision_reason: string | null; decided_by: string | null;
  decided_at: string | null; limitations: Array<string | Record<string, unknown>>; idempotency_key: string;
  created_by: string | null; created_at: string;
}
export interface KGEventRow { id: string; event_type: string; ref_id: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }

export async function fetchKGSummary(): Promise<KGSummary> {
  const { data, error } = await supabase.rpc('admin_knowledge_graph_summary');
  if (error) throw error;
  return (data as KGSummary | null) ?? {};
}
export async function createKGSnapshot(): Promise<{ ok: boolean; idempotent: boolean; snapshot_id: string; snapshot_code?: string; counts: Record<string, number>; production_applied: boolean }> {
  const { data, error } = await supabase.rpc('admin_knowledge_graph_snapshot_create');
  if (error) throw error;
  return data as { ok: boolean; idempotent: boolean; snapshot_id: string; snapshot_code?: string; counts: Record<string, number>; production_applied: boolean };
}
export async function fetchKGEntities(type: string | null = null, domain: string | null = null, limit = 100, offset = 0): Promise<KGEntityRow[]> {
  const { data, error } = await supabase.rpc('admin_knowledge_entities', { p_type: type, p_domain: domain, p_limit: limit, p_offset: offset });
  if (error) throw error;
  return (data ?? []) as KGEntityRow[];
}
export async function fetchKGRelationships(type: string | null = null, strength: string | null = null, limit = 500, offset = 0): Promise<KGRelationshipRow[]> {
  const { data, error } = await supabase.rpc('admin_knowledge_relationships', { p_type: type, p_strength: strength, p_limit: limit, p_offset: offset });
  if (error) throw error;
  return (data ?? []) as KGRelationshipRow[];
}
export async function fetchKGEntityDetail(entityId: string): Promise<KGEntityDetail> {
  const { data, error } = await supabase.rpc('admin_knowledge_entity_detail', { p_entity_id: entityId });
  if (error) throw error;
  return data as KGEntityDetail;
}
export async function fetchKGSnapshots(limit = 30): Promise<KGSnapshotRow[]> {
  const { data, error } = await supabase.rpc('admin_knowledge_graph_snapshots', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as KGSnapshotRow[];
}
export async function createKGReview(payload: { code: string; topic: string; reason: string; evidence: Array<Record<string, unknown>>; subjectEntityId?: string | null; subjectRelationshipId?: string | null }): Promise<{ ok: boolean; id: string; review_status?: string; idempotent?: boolean }> {
  const { data, error } = await supabase.rpc('admin_knowledge_review_create', {
    p_code: payload.code, p_topic: payload.topic, p_reason: payload.reason, p_evidence: payload.evidence,
    p_subject_entity_id: payload.subjectEntityId ?? null, p_subject_relationship_id: payload.subjectRelationshipId ?? null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; review_status?: string; idempotent?: boolean };
}
export async function decideKGReview(id: string, status: string, reason: string): Promise<{ ok: boolean; review_status: string; db_relationship_changed: boolean }> {
  const { data, error } = await supabase.rpc('admin_knowledge_review_decide', { p_id: id, p_status: status, p_reason: reason });
  if (error) throw error;
  return data as { ok: boolean; review_status: string; db_relationship_changed: boolean };
}
export async function recordKGExternalCorrection(payload: { code: string; actionType: string; reason: string; evidence: Array<Record<string, unknown>>; subjectEntityId?: string | null }): Promise<{ ok: boolean; id: string; reference_only?: boolean }> {
  const { data, error } = await supabase.rpc('admin_knowledge_external_correction_reference', {
    p_code: payload.code, p_action_type: payload.actionType, p_reason: payload.reason, p_evidence: payload.evidence, p_subject_entity_id: payload.subjectEntityId ?? null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; reference_only?: boolean };
}
export async function fetchKGReviews(status: string | null = null, limit = 100): Promise<KGReviewRow[]> {
  const { data, error } = await supabase.rpc('admin_knowledge_reviews', { p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as KGReviewRow[];
}
export async function fetchKGAudit(limit = 200): Promise<KGEventRow[]> {
  const { data, error } = await supabase.rpc('admin_knowledge_audit', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as KGEventRow[];
}

// ── Decision Memory (0514 — 결정/실행 Reference/관찰/Outcome 기록, 자동 실행·학습 없음) ──

export type DMSummary = Record<string, number | string | boolean | Record<string, number> | Record<string, unknown> | null>;
export interface DMRecordRow {
  id: string; decision_code: string; decision_domain: string; decision_type: string;
  source_system: string; source_reference_id: string | null; recommendation_summary: string | null;
  decision_summary: string; decision_status: string; decision_reason: string | null;
  decision_maker_id: string | null; reviewer_id: string | null; approver_id: string | null;
  self_approval_warning: boolean; decision_at: string | null; expected_outcome: Record<string, unknown> | null;
  confidence_at_decision: number | null; risk_at_decision: string | null;
  alternatives: Array<string | Record<string, unknown>>; preconditions: Array<string | Record<string, unknown>>;
  limitations: Array<string | Record<string, unknown>>; evidence: Array<Record<string, unknown>>;
  source_version: string; idempotency_key: string; created_by: string | null; created_at: string; updated_at: string;
}
export interface DMExecutionRefRow {
  id: string; decision_memory_id: string; action_type: string; execution_system: string;
  external_reference: string | null; performed_by: string | null; performed_at: string | null;
  reported_result: string | null; verification_status: string; evidence: Array<Record<string, unknown>>;
  limitations: Array<string | Record<string, unknown>>; idempotency_key: string; created_at: string;
}
export interface DMObservationRow {
  id: string; decision_memory_id: string; observation_type: string;
  baseline_start_at: string | null; baseline_end_at: string | null;
  observation_start_at: string; observation_end_at: string;
  metric_definitions: Array<Record<string, unknown>>; baseline_values: Record<string, unknown> | null;
  expected_values: Record<string, unknown> | null; actual_values: Record<string, unknown> | null;
  data_coverage: number | null; observation_status: string; closed_at: string | null; created_at: string;
}
export interface DMOutcomeRow {
  id: string; decision_memory_id: string; observation_window_id: string | null; outcome_status: string;
  expected_vs_actual: Record<string, unknown> | null; benefit_summary: string | null; risk_realized: string | null;
  unintended_effects: Array<unknown>; metric_results: Array<Record<string, unknown>>;
  confidence_after_observation: number | null; causality_status: string; repeatability_status: string;
  decision_quality: string | null; outcome_score: number | null; lessons_learned: Record<string, unknown> | null;
  lesson_status: string; outcome_review_status: string; reviewer_id: string | null; reviewed_at: string | null;
  evidence: Array<Record<string, unknown>>; created_at: string;
}
export interface DMEventRow { id: string; event_type: string; ref_id: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }
export interface DMDetail {
  decision: DMRecordRow; execution_references: DMExecutionRefRow[]; observation_windows: DMObservationRow[];
  outcomes: DMOutcomeRow[]; timeline: Array<{ event_type: string; detail: string | null; actor_id: string | null; created_at: string }>;
}

export async function fetchDMSummary(): Promise<DMSummary> {
  const { data, error } = await supabase.rpc('admin_decision_memory_summary');
  if (error) throw error;
  return (data as DMSummary | null) ?? {};
}
export async function fetchDMRecords(domain: string | null = null, status: string | null = null, limit = 100): Promise<DMRecordRow[]> {
  const { data, error } = await supabase.rpc('admin_decision_memory_records', { p_domain: domain, p_status: status, p_limit: limit, p_offset: 0 });
  if (error) throw error;
  return (data ?? []) as DMRecordRow[];
}
export async function fetchDMDetail(id: string): Promise<DMDetail> {
  const { data, error } = await supabase.rpc('admin_decision_memory_detail', { p_id: id });
  if (error) throw error;
  return data as DMDetail;
}
export async function createDMRecord(payload: {
  code: string; domain: string; type: string; sourceSystem: string; decisionSummary: string;
  evidence: Array<Record<string, unknown>>; sourceReferenceId?: string | null; recommendationSummary?: string | null;
  expectedOutcome?: Record<string, unknown> | null; confidence?: number | null; risk?: string | null;
  alternatives?: string[]; preconditions?: string[];
}): Promise<{ ok: boolean; id: string; idempotent?: boolean }> {
  const { data, error } = await supabase.rpc('admin_decision_memory_create', {
    p_code: payload.code, p_domain: payload.domain, p_type: payload.type, p_source_system: payload.sourceSystem,
    p_decision_summary: payload.decisionSummary, p_evidence: payload.evidence,
    p_source_reference_id: payload.sourceReferenceId ?? null, p_recommendation_summary: payload.recommendationSummary ?? null,
    p_expected_outcome: payload.expectedOutcome ?? null, p_confidence: payload.confidence ?? null,
    p_risk: payload.risk ?? null, p_alternatives: payload.alternatives ?? [], p_preconditions: payload.preconditions ?? [],
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; idempotent?: boolean };
}
export async function decideDMRecord(id: string, status: string, reason: string): Promise<{ ok: boolean; decision_status: string; self_approval_warning: boolean }> {
  const { data, error } = await supabase.rpc('admin_decision_memory_decide', { p_id: id, p_status: status, p_reason: reason });
  if (error) throw error;
  return data as { ok: boolean; decision_status: string; self_approval_warning: boolean };
}
export async function addDMExecutionRef(payload: { code: string; decisionId: string; actionType: string; executionSystem: string; reportedResult: string; evidence: Array<Record<string, unknown>>; externalReference?: string | null }): Promise<{ ok: boolean; id: string }> {
  const { data, error } = await supabase.rpc('admin_decision_execution_reference_add', {
    p_code: payload.code, p_decision_id: payload.decisionId, p_action_type: payload.actionType,
    p_execution_system: payload.executionSystem, p_reported_result: payload.reportedResult,
    p_evidence: payload.evidence, p_external_reference: payload.externalReference ?? null, p_performed_at: null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string };
}
export async function updateDMExecutionVerification(id: string, status: string, reason: string): Promise<{ ok: boolean; verification_status: string }> {
  const { data, error } = await supabase.rpc('admin_decision_execution_verification_update', { p_id: id, p_status: status, p_reason: reason });
  if (error) throw error;
  return data as { ok: boolean; verification_status: string };
}
export async function createDMObservation(payload: { decisionId: string; observationType: string; startAt: string; endAt: string; metricDefinitions: Array<Record<string, unknown>>; baselineStart?: string | null; baselineEnd?: string | null; baselineValues?: Record<string, unknown> | null; expectedValues?: Record<string, unknown> | null }): Promise<{ ok: boolean; id: string }> {
  const { data, error } = await supabase.rpc('admin_decision_observation_create', {
    p_decision_id: payload.decisionId, p_observation_type: payload.observationType,
    p_start: payload.startAt, p_end: payload.endAt, p_metric_definitions: payload.metricDefinitions,
    p_baseline_start: payload.baselineStart ?? null, p_baseline_end: payload.baselineEnd ?? null,
    p_baseline_values: payload.baselineValues ?? null, p_expected_values: payload.expectedValues ?? null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string };
}
export async function updateDMObservation(id: string, status: string, reason: string, actualValues: Record<string, unknown> | null = null, dataCoverage: number | null = null): Promise<{ ok: boolean; observation_status: string }> {
  const { data, error } = await supabase.rpc('admin_decision_observation_update', { p_id: id, p_status: status, p_reason: reason, p_actual_values: actualValues, p_data_coverage: dataCoverage });
  if (error) throw error;
  return data as { ok: boolean; observation_status: string };
}
export async function recordDMOutcome(payload: {
  code: string; decisionId: string; outcomeStatus: string; evidence: Array<Record<string, unknown>>;
  observationId?: string | null; expectedVsActual?: Record<string, unknown> | null; metricResults?: Array<Record<string, unknown>>;
  causality?: string; repeatability?: string; decisionQuality?: string | null; outcomeScore?: number | null;
  benefit?: string | null; riskRealized?: string | null; lessons?: Record<string, unknown> | null;
}): Promise<{ ok: boolean; id: string; causality_confirmed: boolean }> {
  const { data, error } = await supabase.rpc('admin_decision_outcome_record', {
    p_code: payload.code, p_decision_id: payload.decisionId, p_outcome_status: payload.outcomeStatus,
    p_evidence: payload.evidence, p_observation_id: payload.observationId ?? null,
    p_expected_vs_actual: payload.expectedVsActual ?? null, p_metric_results: payload.metricResults ?? [],
    p_causality: payload.causality ?? 'not_evaluated', p_repeatability: payload.repeatability ?? 'not_evaluated',
    p_decision_quality: payload.decisionQuality ?? null, p_outcome_score: payload.outcomeScore ?? null,
    p_benefit: payload.benefit ?? null, p_risk_realized: payload.riskRealized ?? null, p_lessons: payload.lessons ?? null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; causality_confirmed: boolean };
}
export async function reviewDMOutcome(id: string, reviewStatus: string, reason: string, lessonStatus: string | null = null): Promise<{ ok: boolean; outcome_review_status: string }> {
  const { data, error } = await supabase.rpc('admin_decision_outcome_review', { p_id: id, p_review_status: reviewStatus, p_reason: reason, p_lesson_status: lessonStatus });
  if (error) throw error;
  return data as { ok: boolean; outcome_review_status: string };
}
export async function recordDMExternalOutcome(decisionId: string, actionType: string, reason: string, evidence: Array<Record<string, unknown>>): Promise<{ ok: boolean; reference_only: boolean }> {
  const { data, error } = await supabase.rpc('admin_decision_external_outcome_reference', { p_decision_id: decisionId, p_action_type: actionType, p_reason: reason, p_evidence: evidence });
  if (error) throw error;
  return data as { ok: boolean; reference_only: boolean };
}
export async function fetchDMExecutionRefs(limit = 100): Promise<DMExecutionRefRow[]> {
  const { data, error } = await supabase.rpc('admin_decision_execution_references', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as DMExecutionRefRow[];
}
export async function fetchDMObservations(status: string | null = null, limit = 100): Promise<DMObservationRow[]> {
  const { data, error } = await supabase.rpc('admin_decision_observations', { p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as DMObservationRow[];
}
export async function fetchDMOutcomes(status: string | null = null, limit = 100): Promise<DMOutcomeRow[]> {
  const { data, error } = await supabase.rpc('admin_decision_outcomes', { p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as DMOutcomeRow[];
}
export async function fetchDMAudit(limit = 200): Promise<DMEventRow[]> {
  const { data, error } = await supabase.rpc('admin_decision_memory_audit', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as DMEventRow[];
}

// ── Organizational Learning (0515 — 학습 근거/패턴/조직 학습/정책 진화 후보, 자동 정책 변경·학습 없음) ──

export type OLSummary = Record<string, number | string | boolean | Record<string, number> | Record<string, unknown> | null>;
export interface OLEvidenceRow {
  id: string; evidence_code: string; learning_domain: string; source_decision_id: string | null;
  source_outcome_id: string | null; source_policy_id: string | null; scope_type: string; scope_id: string | null;
  context_signature: string; outcome_status: string; causality_status: string; repeatability_status: string;
  evidence_strength: string; applicability_status: string; eligibility: string; exclusion_reason: string | null;
  evidence_summary: string; assumptions: Array<unknown>; unknown_factors: Array<unknown>;
  limitations: Array<string | Record<string, unknown>>; observed_at: string | null; idempotency_key: string; created_at: string;
}
export interface OLPatternRow {
  id: string; pattern_code: string; learning_domain: string; pattern_type: string; scope_type: string;
  scope_id: string | null; context_signature: string; supporting_evidence_ids: string[]; contradicting_evidence_ids: string[];
  sample_size: number; positive_count: number; negative_count: number; mixed_count: number; inconclusive_count: number;
  pattern_strength: string; repeatability_status: string; applicability_status: string; confidence: number | null;
  pattern_summary: string; reusable_insight: string | null; non_reusable_conditions: Array<unknown>;
  lifecycle_status: string; reviewed_by: string | null; created_at: string;
}
export interface OLLearningRow {
  id: string; learning_code: string; title: string; learning_domain: string; scope_type: string; scope_id: string | null;
  supporting_pattern_ids: string[]; learning_summary: string; what_worked: Array<unknown>; what_did_not_work: Array<unknown>;
  applicability_status: string; repeatability_status: string; evidence_strength: string; confidence: number | null;
  policy_implication: string | null; governance_implication: string | null;
  limitations: Array<string | Record<string, unknown>>; review_status: string; reviewed_by: string | null;
  approved_by: string | null; created_at: string;
}
export interface OLEvolutionRow {
  id: string; candidate_code: string; policy_id: string; current_policy_version: number | null; candidate_type: string;
  target_scope_type: string; proposed_change_summary: string; reason: string; supporting_learning_ids: string[];
  expected_benefit: string; expected_risk: string; alternatives: Array<unknown>; confidence: number | null;
  evidence_strength: string; repeatability_status: string; applicability_status: string;
  safety_gate: Record<string, unknown> | null; preconditions: Array<unknown>; limitations: Array<unknown>;
  review_status: string; reviewer_id: string | null; approver_id: string | null; self_approval_warning: boolean;
  decision_reason: string | null; created_at: string; reviewed_at: string | null;
}
export interface OLEventRow { id: string; event_type: string; ref_id: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }

export async function fetchOLSummary(): Promise<OLSummary> {
  const { data, error } = await supabase.rpc('admin_organizational_learning_summary');
  if (error) throw error;
  return (data as OLSummary | null) ?? {};
}
export async function createOLEvidence(payload: {
  code: string; domain: string; summary: string; contextSignature: string; outcomeStatus: string; evidenceStrength: string;
  sourceDecisionId?: string | null; sourceOutcomeId?: string | null; sourcePolicyId?: string | null;
  scopeType?: string; scopeId?: string | null; causality?: string; repeatability?: string; applicability?: string;
  eligibility?: string; exclusionReason?: string | null;
}): Promise<{ ok: boolean; id: string }> {
  const { data, error } = await supabase.rpc('admin_learning_evidence_create', {
    p_code: payload.code, p_domain: payload.domain, p_summary: payload.summary,
    p_context_signature: payload.contextSignature, p_outcome_status: payload.outcomeStatus,
    p_evidence_strength: payload.evidenceStrength,
    p_source_decision_id: payload.sourceDecisionId ?? null, p_source_outcome_id: payload.sourceOutcomeId ?? null,
    p_source_policy_id: payload.sourcePolicyId ?? null, p_scope_type: payload.scopeType ?? 'unverified',
    p_scope_id: payload.scopeId ?? null, p_causality: payload.causality ?? 'causality_unverified',
    p_repeatability: payload.repeatability ?? 'not_evaluated', p_applicability: payload.applicability ?? 'applicability_unverified',
    p_eligibility: payload.eligibility ?? 'eligible', p_exclusion_reason: payload.exclusionReason ?? null,
    p_assumptions: [], p_unknown_factors: [],
  });
  if (error) throw error;
  return data as { ok: boolean; id: string };
}
export async function fetchOLEvidence(domain: string | null = null, eligibility: string | null = null, limit = 100): Promise<OLEvidenceRow[]> {
  const { data, error } = await supabase.rpc('admin_learning_evidence', { p_domain: domain, p_eligibility: eligibility, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as OLEvidenceRow[];
}
export async function createOLPattern(payload: {
  code: string; domain: string; patternType: string; summary: string; contextSignature: string;
  supporting: string[]; sampleSize: number; positive: number; negative: number; mixed: number; inconclusive: number;
  strength?: string; repeatability?: string; applicability?: string; confidence?: number | null;
}): Promise<{ ok: boolean; id: string }> {
  const { data, error } = await supabase.rpc('admin_learning_pattern_create', {
    p_code: payload.code, p_domain: payload.domain, p_pattern_type: payload.patternType,
    p_summary: payload.summary, p_context_signature: payload.contextSignature,
    p_supporting: payload.supporting, p_contradicting: [],
    p_sample_size: payload.sampleSize, p_positive: payload.positive, p_negative: payload.negative,
    p_mixed: payload.mixed, p_inconclusive: payload.inconclusive,
    p_strength: payload.strength ?? 'insufficient_data', p_repeatability: payload.repeatability ?? 'sample_too_small',
    p_applicability: payload.applicability ?? 'applicability_unverified', p_confidence: payload.confidence ?? null,
    p_reusable_insight: null, p_non_reusable: [], p_scope_type: 'unverified', p_scope_id: null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string };
}
export async function fetchOLPatterns(type: string | null = null, status: string | null = null, limit = 100): Promise<OLPatternRow[]> {
  const { data, error } = await supabase.rpc('admin_learning_patterns', { p_type: type, p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as OLPatternRow[];
}
export async function saveOLLearning(payload: {
  code: string; title: string; domain: string; summary: string; supportingPatterns: string[];
  applicability?: string; repeatability?: string; strength?: string; confidence?: number | null;
  policyImplication?: string | null; governanceImplication?: string | null;
}): Promise<{ ok: boolean; id: string }> {
  const { data, error } = await supabase.rpc('admin_organizational_learning_save', {
    p_code: payload.code, p_title: payload.title, p_domain: payload.domain, p_summary: payload.summary,
    p_supporting_patterns: payload.supportingPatterns, p_what_worked: [], p_what_did_not: [],
    p_applicability: payload.applicability ?? 'applicability_unverified', p_repeatability: payload.repeatability ?? 'repeatability_unverified',
    p_strength: payload.strength ?? 'insufficient_data', p_confidence: payload.confidence ?? null,
    p_policy_implication: payload.policyImplication ?? null, p_governance_implication: payload.governanceImplication ?? null,
    p_scope_type: 'unverified', p_scope_id: null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string };
}
export async function reviewOLLearning(id: string, status: string, reason: string): Promise<{ ok: boolean; review_status: string }> {
  const { data, error } = await supabase.rpc('admin_organizational_learning_review', { p_id: id, p_status: status, p_reason: reason });
  if (error) throw error;
  return data as { ok: boolean; review_status: string };
}
export async function fetchOLLearnings(status: string | null = null, limit = 100): Promise<OLLearningRow[]> {
  const { data, error } = await supabase.rpc('admin_organizational_learnings', { p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as OLLearningRow[];
}
export async function createOLEvolutionCandidate(payload: {
  code: string; policyId: string; candidateType: string; changeSummary: string; reason: string;
  expectedBenefit: string; expectedRisk: string; supportingLearnings?: string[]; alternatives?: string[];
  confidence?: number | null; strength?: string; repeatability?: string; applicability?: string;
  safetyGate?: Record<string, unknown> | null;
}): Promise<{ ok: boolean; id: string; policy_version_created: boolean }> {
  const { data, error } = await supabase.rpc('admin_policy_evolution_candidate_create', {
    p_code: payload.code, p_policy_id: payload.policyId, p_candidate_type: payload.candidateType,
    p_change_summary: payload.changeSummary, p_reason: payload.reason,
    p_expected_benefit: payload.expectedBenefit, p_expected_risk: payload.expectedRisk,
    p_supporting_learnings: payload.supportingLearnings ?? [], p_alternatives: payload.alternatives ?? [],
    p_confidence: payload.confidence ?? null, p_strength: payload.strength ?? 'insufficient_data',
    p_repeatability: payload.repeatability ?? 'repeatability_unverified', p_applicability: payload.applicability ?? 'applicability_unverified',
    p_safety_gate: payload.safetyGate ?? null, p_target_scope_type: 'unverified', p_target_scope_id: null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; policy_version_created: boolean };
}
export async function reviewOLEvolution(id: string, status: string, reason: string): Promise<{ ok: boolean; review_status: string; policy_applied: boolean }> {
  const { data, error } = await supabase.rpc('admin_policy_evolution_review', { p_id: id, p_status: status, p_reason: reason });
  if (error) throw error;
  return data as { ok: boolean; review_status: string; policy_applied: boolean };
}
export async function fetchOLEvolutionCandidates(status: string | null = null, limit = 100): Promise<OLEvolutionRow[]> {
  const { data, error } = await supabase.rpc('admin_policy_evolution_candidates', { p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as OLEvolutionRow[];
}
export async function recordOLExternalPolicyAction(actionType: string, reason: string, evidence: Array<Record<string, unknown>>, refId: string | null = null): Promise<{ ok: boolean; reference_only: boolean }> {
  const { data, error } = await supabase.rpc('admin_learning_external_policy_action', { p_action_type: actionType, p_reason: reason, p_evidence: evidence, p_ref_id: refId });
  if (error) throw error;
  return data as { ok: boolean; reference_only: boolean };
}
export async function fetchOLAudit(limit = 200): Promise<OLEventRow[]> {
  const { data, error } = await supabase.rpc('admin_learning_audit', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as OLEventRow[];
}

// ── Strategic Scenario (0516 — 전략 시나리오/포트폴리오/배분 후보, 자동 예산·실행 없음) ──

export type StratSummary = Record<string, number | string | boolean | Record<string, number> | Record<string, unknown> | null>;
export interface StratObjectiveRow {
  id: string; objective_code: string; title: string; strategic_domain: string; objective_type: string;
  objective_status: string; target_metric: string | null; target_direction: string | null;
  target_value: number | null; baseline_value: number | null; priority: number | null;
  evidence: Array<Record<string, unknown>>; limitations: Array<unknown>; created_at: string;
}
export interface StratAssumptionRow {
  id: string; assumption_code: string; strategic_objective_id: string | null; assumption_type: string;
  description: string; input_value: number | null; value_unit: string | null; source_type: string;
  verification_status: string; confidence: number | null; sensitivity: string | null; created_at: string;
}
export interface StratConstraintRow {
  id: string; constraint_code: string; constraint_type: string; resource_type: string | null;
  minimum_value: number | null; maximum_value: number | null; current_value: number | null;
  unit: string | null; hard_constraint: boolean; exclusivity_group: string | null; created_at: string;
}
export interface StratScenarioRow {
  id: string; scenario_code: string; strategic_objective_id: string | null; scenario_name: string;
  scenario_type: string; scenario_status: string; scenario_horizon: string;
  forecast_results: Record<string, unknown> | null; input_validation: Record<string, unknown> | null;
  feasibility_status: string; confidence: number | null; unknown_factors: Array<unknown>;
  limitations: Array<unknown>; created_at: string;
}
export interface StratInitiativeRow {
  id: string; initiative_code: string; title: string; initiative_type: string; strategic_domain: string;
  required_budget: number | null; dependencies: string[]; mutual_exclusion_group: string | null;
  reversibility: string | null; expected_cost_note: string | null; lifecycle_status: string; created_at: string;
}
export interface StratPortfolioRow {
  id: string; portfolio_code: string; title: string; scenario_id: string | null; initiative_ids: string[];
  portfolio_type: string; total_required_budget: number | null; feasibility_status: string;
  concentration_summary: Record<string, unknown> | null; confidence: number | null;
  expected_value_summary: string | null; expected_cost_summary: string | null; expected_risk_summary: string | null;
  review_status: string; self_approval_warning: boolean; decision_reason: string | null; created_at: string;
}
export interface StratAllocationRow {
  id: string; candidate_code: string; strategic_portfolio_id: string; resource_type: string;
  available_amount: number | null; reserve_amount: number | null; allocated_amount: number;
  allocation_items: Array<{ initiative_code: string; amount: number }>; constraint_status: string;
  review_status: string; created_at: string;
}
export interface StratEventRow { id: string; event_type: string; ref_id: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }

export async function fetchStratSummary(): Promise<StratSummary> {
  const { data, error } = await supabase.rpc('admin_strategic_summary');
  if (error) throw error;
  return (data as StratSummary | null) ?? {};
}
export async function createStratObjective(p: { code: string; title: string; domain: string; type: string; evidence: Array<Record<string, unknown>>; targetMetric?: string | null; targetDirection?: string | null; targetValue?: number | null; baselineValue?: number | null; priority?: number | null }): Promise<{ ok: boolean; id: string }> {
  const { data, error } = await supabase.rpc('admin_strategic_objective_create', {
    p_code: p.code, p_title: p.title, p_domain: p.domain, p_type: p.type, p_evidence: p.evidence,
    p_target_metric: p.targetMetric ?? null, p_target_direction: p.targetDirection ?? null,
    p_target_value: p.targetValue ?? null, p_baseline_value: p.baselineValue ?? null,
    p_priority: p.priority ?? null, p_start_at: null, p_target_at: null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string };
}
export async function fetchStratObjectives(status: string | null = null, limit = 100): Promise<StratObjectiveRow[]> {
  const { data, error } = await supabase.rpc('admin_strategic_objectives', { p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as StratObjectiveRow[];
}
export async function saveStratAssumption(p: { code: string; type: string; description: string; evidence: Array<Record<string, unknown>>; objectiveId?: string | null; value?: number | null; unit?: string | null; sourceType?: string; verification?: string; confidence?: number | null }): Promise<{ ok: boolean; id: string }> {
  const { data, error } = await supabase.rpc('admin_strategic_assumption_save', {
    p_code: p.code, p_type: p.type, p_description: p.description, p_evidence: p.evidence,
    p_objective_id: p.objectiveId ?? null, p_value: p.value ?? null, p_unit: p.unit ?? null,
    p_source_type: p.sourceType ?? 'manual', p_verification: p.verification ?? 'unverified', p_confidence: p.confidence ?? null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string };
}
export async function fetchStratAssumptions(limit = 100): Promise<StratAssumptionRow[]> {
  const { data, error } = await supabase.rpc('admin_strategic_assumptions', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as StratAssumptionRow[];
}
export async function saveStratConstraint(p: { code: string; type: string; evidence: Array<Record<string, unknown>>; objectiveId?: string | null; resourceType?: string | null; min?: number | null; max?: number | null; current?: number | null; unit?: string | null; hard?: boolean; exclusivity?: string | null }): Promise<{ ok: boolean; id: string }> {
  const { data, error } = await supabase.rpc('admin_strategic_constraint_save', {
    p_code: p.code, p_type: p.type, p_evidence: p.evidence, p_objective_id: p.objectiveId ?? null,
    p_resource_type: p.resourceType ?? null, p_min: p.min ?? null, p_max: p.max ?? null,
    p_current: p.current ?? null, p_unit: p.unit ?? null, p_hard: p.hard ?? false, p_exclusivity: p.exclusivity ?? null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string };
}
export async function fetchStratConstraints(limit = 100): Promise<StratConstraintRow[]> {
  const { data, error } = await supabase.rpc('admin_strategic_constraints', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as StratConstraintRow[];
}
export async function createStratScenario(p: { code: string; name: string; type: string; horizon: string; evidence: Array<Record<string, unknown>>; objectiveId?: string | null; forecastResults?: Record<string, unknown> | null; inputValidation?: Record<string, unknown> | null; feasibility?: string; confidence?: number | null; unknownFactors?: string[] }): Promise<{ ok: boolean; id: string }> {
  const { data, error } = await supabase.rpc('admin_strategic_scenario_create', {
    p_code: p.code, p_name: p.name, p_type: p.type, p_horizon: p.horizon, p_evidence: p.evidence,
    p_objective_id: p.objectiveId ?? null, p_assumption_ids: [], p_constraint_ids: [],
    p_forecast_results: p.forecastResults ?? null, p_input_validation: p.inputValidation ?? null,
    p_feasibility: p.feasibility ?? 'feasibility_unverified', p_confidence: p.confidence ?? null,
    p_unknown_factors: p.unknownFactors ?? [],
  });
  if (error) throw error;
  return data as { ok: boolean; id: string };
}
export async function reviewStratScenario(id: string, status: string, reason: string): Promise<{ ok: boolean; scenario_status: string }> {
  const { data, error } = await supabase.rpc('admin_strategic_scenario_review', { p_id: id, p_status: status, p_reason: reason });
  if (error) throw error;
  return data as { ok: boolean; scenario_status: string };
}
export async function fetchStratScenarios(type: string | null = null, status: string | null = null, limit = 100): Promise<StratScenarioRow[]> {
  const { data, error } = await supabase.rpc('admin_strategic_scenarios', { p_type: type, p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as StratScenarioRow[];
}
export async function createStratInitiative(p: { code: string; title: string; type: string; domain: string; evidence: Array<Record<string, unknown>>; objectiveId?: string | null; budget?: number | null; dependencies?: string[]; exclusionGroup?: string | null; reversibility?: string | null; costNote?: string | null }): Promise<{ ok: boolean; id: string }> {
  const { data, error } = await supabase.rpc('admin_strategic_initiative_create', {
    p_code: p.code, p_title: p.title, p_type: p.type, p_domain: p.domain, p_evidence: p.evidence,
    p_objective_id: p.objectiveId ?? null, p_budget: p.budget ?? null, p_dependencies: p.dependencies ?? [],
    p_exclusion_group: p.exclusionGroup ?? null, p_reversibility: p.reversibility ?? null,
    p_value_note: null, p_cost_note: p.costNote ?? null, p_risk_note: null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string };
}
export async function fetchStratInitiatives(limit = 100): Promise<StratInitiativeRow[]> {
  const { data, error } = await supabase.rpc('admin_strategic_initiatives', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as StratInitiativeRow[];
}
export async function createStratPortfolio(p: { code: string; title: string; type: string; evidence: Array<Record<string, unknown>>; objectiveId?: string | null; scenarioId?: string | null; initiativeIds?: string[]; totalBudget?: number | null; feasibility?: string; concentration?: Record<string, unknown> | null; confidence?: number | null }): Promise<{ ok: boolean; id: string; budget_allocated: boolean }> {
  const { data, error } = await supabase.rpc('admin_strategic_portfolio_create', {
    p_code: p.code, p_title: p.title, p_type: p.type, p_evidence: p.evidence,
    p_objective_id: p.objectiveId ?? null, p_scenario_id: p.scenarioId ?? null, p_initiative_ids: p.initiativeIds ?? [],
    p_total_budget: p.totalBudget ?? null, p_feasibility: p.feasibility ?? 'feasibility_unverified',
    p_concentration: p.concentration ?? null, p_confidence: p.confidence ?? null,
    p_value_summary: null, p_cost_summary: null, p_risk_summary: null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; budget_allocated: boolean };
}
export async function reviewStratPortfolio(id: string, status: string, reason: string): Promise<{ ok: boolean; review_status: string; budget_executed: boolean }> {
  const { data, error } = await supabase.rpc('admin_strategic_portfolio_review', { p_id: id, p_status: status, p_reason: reason });
  if (error) throw error;
  return data as { ok: boolean; review_status: string; budget_executed: boolean };
}
export async function fetchStratPortfolios(status: string | null = null, limit = 100): Promise<StratPortfolioRow[]> {
  const { data, error } = await supabase.rpc('admin_strategic_portfolios', { p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as StratPortfolioRow[];
}
export async function createStratAllocation(p: { code: string; portfolioId: string; resourceType: string; allocated: number; items: Array<{ initiative_code: string; amount: number }>; evidence: Array<Record<string, unknown>>; available?: number | null; reserve?: number | null }): Promise<{ ok: boolean; id: string; constraint_status: string; budget_changed: boolean }> {
  const { data, error } = await supabase.rpc('admin_resource_allocation_create', {
    p_code: p.code, p_portfolio_id: p.portfolioId, p_resource_type: p.resourceType,
    p_allocated: p.allocated, p_items: p.items, p_evidence: p.evidence,
    p_available: p.available ?? null, p_reserve: p.reserve ?? null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; constraint_status: string; budget_changed: boolean };
}
export async function fetchStratAllocations(limit = 100): Promise<StratAllocationRow[]> {
  const { data, error } = await supabase.rpc('admin_resource_allocation_candidates', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as StratAllocationRow[];
}
export async function recordStratExternalAction(actionType: string, reason: string, evidence: Array<Record<string, unknown>>, refId: string | null = null): Promise<{ ok: boolean; reference_only: boolean }> {
  const { data, error } = await supabase.rpc('admin_strategic_external_action_reference', { p_action_type: actionType, p_reason: reason, p_evidence: evidence, p_ref_id: refId });
  if (error) throw error;
  return data as { ok: boolean; reference_only: boolean };
}
export async function fetchStratAudit(limit = 200): Promise<StratEventRow[]> {
  const { data, error } = await supabase.rpc('admin_strategic_audit', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as StratEventRow[];
}

// ── Business Causal (0517 — 인과 후보/Digital Twin/Calibration, 자동 인과 확정·개입·Confidence 수정 없음) ──

export type CausalSummary = Record<string, number | string | boolean | Record<string, number> | Record<string, unknown> | null>;
export interface BizSignalRow {
  id: string; signal_code: string; signal_domain: string; signal_type: string; source_system: string;
  scope_type: string; metric_name: string; metric_value: number | null; metric_unit: string | null;
  baseline_value: number | null; observed_at: string; sample_size: number | null; created_at: string;
}
export interface CausalCandidateRow {
  id: string; candidate_code: string; cause_signal_id: string; effect_signal_id: string;
  causal_domain: string; candidate_type: string; time_lag_days: number | null;
  temporal_order_status: string; mechanism_hypothesis: string | null; mechanism_status: string;
  correlation_summary: string | null; supporting_evidence: Array<Record<string, unknown>>;
  counter_evidence: Array<Record<string, unknown>>; confounders: Array<Record<string, unknown>>;
  confounder_status: string; counter_evidence_status: string; evidence_strength: string;
  causal_status: string; causal_confidence: number | null; review_status: string;
  limitations: Array<unknown>; created_at: string;
}
export interface CounterfactualRow {
  id: string; counterfactual_code: string; causal_candidate_id: string | null; intervention_type: string;
  intervention_summary: string; counterfactual_scenario: string; expected_effect: number | null;
  low_range: number | null; high_range: number | null; confidence: number | null;
  verification_status: string; limitations: Array<unknown>; created_at: string;
}
export interface CorporateTwinRow {
  id: string; twin_code: string; title: string; twin_scope: string; model_version: string;
  included_domains: string[]; state_snapshot: Record<string, unknown>;
  simulations: Array<Record<string, unknown>>; input_coverage: number | null;
  input_validation: string; twin_status: string; snapshot_at: string; limitations: Array<unknown>; created_at: string;
}
export interface ConfidenceRecordRow {
  id: string; confidence_code: string; confidence_domain: string; source_type: string;
  predicted_confidence: number | null; predicted_direction: string | null;
  actual_outcome_status: string | null; actual_direction: string | null; actual_value: number | null;
  observation_status: string; causality_status: string; calibration_eligible: boolean;
  exclusion_reason: string | null; predicted_at: string | null; observed_at: string | null; created_at: string;
}
export interface CalibrationSnapshotRow {
  id: string; snapshot_code: string; calibration_domain: string; source_type: string | null;
  sample_size: number; eligible_count: number; excluded_count: number;
  confidence_buckets: Array<Record<string, unknown>>; calibration_metrics: Record<string, unknown>;
  calibration_status: string; recommendations: Array<unknown>; generated_at: string; created_at: string;
}
export interface CausalEventRow { id: string; event_type: string; ref_id: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }

export async function fetchCausalSummary(): Promise<CausalSummary> {
  const { data, error } = await supabase.rpc('admin_causal_summary');
  if (error) throw error;
  return (data as CausalSummary | null) ?? {};
}
export async function createBizSignal(p: { code: string; domain: string; type: string; sourceSystem: string; metricName: string; observedAt: string; evidence: Array<Record<string, unknown>>; metricValue?: number | null; unit?: string | null; baseline?: number | null; windowDays?: number | null; sampleSize?: number | null }): Promise<{ ok: boolean; id: string }> {
  const { data, error } = await supabase.rpc('admin_business_signal_create', {
    p_code: p.code, p_domain: p.domain, p_type: p.type, p_source_system: p.sourceSystem,
    p_metric_name: p.metricName, p_observed_at: p.observedAt, p_evidence: p.evidence,
    p_metric_value: p.metricValue ?? null, p_unit: p.unit ?? null, p_baseline: p.baseline ?? null,
    p_window_days: p.windowDays ?? null, p_sample_size: p.sampleSize ?? null,
    p_scope_type: 'unverified', p_scope_id: null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string };
}
export async function fetchBizSignals(domain: string | null = null, limit = 100): Promise<BizSignalRow[]> {
  const { data, error } = await supabase.rpc('admin_business_signals', { p_domain: domain, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as BizSignalRow[];
}
export async function createCausalCandidate(p: { code: string; causeId: string; effectId: string; domain: string; type: string; evidence: Array<Record<string, unknown>>; mechanism?: string | null; correlation?: string | null; confounders?: Array<Record<string, unknown>>; counterEvidence?: Array<Record<string, unknown>>; confidence?: number | null; timeLag?: number | null }): Promise<{ ok: boolean; id: string; causality_confirmed: boolean }> {
  const { data, error } = await supabase.rpc('admin_causal_candidate_create', {
    p_code: p.code, p_cause_id: p.causeId, p_effect_id: p.effectId, p_domain: p.domain, p_type: p.type,
    p_evidence: p.evidence, p_mechanism: p.mechanism ?? null, p_correlation: p.correlation ?? null,
    p_temporal_order: 'insufficient_data', p_mechanism_status: 'mechanism_hypothesis_only',
    p_confounders: p.confounders ?? [], p_counter_evidence: p.counterEvidence ?? [],
    p_causal_status: 'draft', p_confidence: p.confidence ?? null, p_time_lag: p.timeLag ?? null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; causality_confirmed: boolean };
}
export async function reviewCausalCandidate(id: string, status: string, reason: string, causalStatus: string | null = null): Promise<{ ok: boolean; review_status: string; causality_confirmed: boolean }> {
  const { data, error } = await supabase.rpc('admin_causal_candidate_review', { p_id: id, p_status: status, p_reason: reason, p_causal_status: causalStatus });
  if (error) throw error;
  return data as { ok: boolean; review_status: string; causality_confirmed: boolean };
}
export async function fetchCausalCandidates(status: string | null = null, limit = 100): Promise<CausalCandidateRow[]> {
  const { data, error } = await supabase.rpc('admin_causal_candidates', { p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as CausalCandidateRow[];
}
export async function createCounterfactual(p: { code: string; interventionType: string; summary: string; scenario: string; evidence: Array<Record<string, unknown>>; candidateId?: string | null; baseline?: string | null; expected?: number | null; low?: number | null; high?: number | null; confidence?: number | null }): Promise<{ ok: boolean; id: string; actual_outcome: boolean }> {
  const { data, error } = await supabase.rpc('admin_causal_counterfactual_create', {
    p_code: p.code, p_intervention_type: p.interventionType, p_summary: p.summary,
    p_cf_scenario: p.scenario, p_evidence: p.evidence, p_candidate_id: p.candidateId ?? null,
    p_baseline: p.baseline ?? null, p_expected: p.expected ?? null, p_low: p.low ?? null,
    p_high: p.high ?? null, p_confidence: p.confidence ?? null, p_assumed: [], p_held: [],
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; actual_outcome: boolean };
}
export async function fetchCounterfactuals(limit = 100): Promise<CounterfactualRow[]> {
  const { data, error } = await supabase.rpc('admin_causal_counterfactuals', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as CounterfactualRow[];
}
export async function createCorporateTwin(p: { code: string; title: string; scope: string; evidence: Array<Record<string, unknown>>; includedDomains?: string[]; state?: Record<string, unknown>; simulations?: Array<Record<string, unknown>>; inputCoverage?: number | null; inputValidation?: string }): Promise<{ ok: boolean; id: string; production_identical: boolean }> {
  const { data, error } = await supabase.rpc('admin_corporate_twin_create', {
    p_code: p.code, p_title: p.title, p_scope: p.scope, p_evidence: p.evidence,
    p_included_domains: p.includedDomains ?? [], p_state: p.state ?? {}, p_simulations: p.simulations ?? [],
    p_input_coverage: p.inputCoverage ?? null, p_input_validation: p.inputValidation ?? 'twin_input_incomplete', p_scope_id: null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; production_identical: boolean };
}
export async function fetchCorporateTwins(limit = 50): Promise<CorporateTwinRow[]> {
  const { data, error } = await supabase.rpc('admin_corporate_twins', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as CorporateTwinRow[];
}
export async function createConfidenceRecord(p: { code: string; domain: string; sourceType: string; evidence: Array<Record<string, unknown>>; sourceReferenceId?: string | null; predicted?: number | null; direction?: string | null; actualStatus?: string | null; actualDirection?: string | null; actualValue?: number | null; observationStatus?: string; eligible?: boolean; exclusionReason?: string | null }): Promise<{ ok: boolean; id: string }> {
  const { data, error } = await supabase.rpc('admin_confidence_record_create', {
    p_code: p.code, p_domain: p.domain, p_source_type: p.sourceType, p_evidence: p.evidence,
    p_source_reference_id: p.sourceReferenceId ?? null, p_predicted: p.predicted ?? null,
    p_direction: p.direction ?? null, p_low: null, p_high: null,
    p_actual_status: p.actualStatus ?? null, p_actual_direction: p.actualDirection ?? null,
    p_actual_value: p.actualValue ?? null, p_observation_status: p.observationStatus ?? 'outcome_pending',
    p_eligible: p.eligible ?? false, p_exclusion_reason: p.exclusionReason ?? null,
    p_predicted_at: null, p_observed_at: null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string };
}
export async function fetchConfidenceRecords(domain: string | null = null, limit = 100): Promise<ConfidenceRecordRow[]> {
  const { data, error } = await supabase.rpc('admin_confidence_records', { p_domain: domain, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ConfidenceRecordRow[];
}
export async function createCalibrationSnapshot(p: { code: string; domain: string; evidence: Array<Record<string, unknown>>; sourceType?: string | null; sample?: number; eligible?: number; excluded?: number; buckets?: Array<Record<string, unknown>>; metrics?: Record<string, unknown>; status?: string; recommendations?: Array<Record<string, unknown>> }): Promise<{ ok: boolean; id: string; confidence_auto_adjusted: boolean }> {
  const { data, error } = await supabase.rpc('admin_confidence_calibration_create', {
    p_code: p.code, p_domain: p.domain, p_evidence: p.evidence, p_source_type: p.sourceType ?? null,
    p_sample: p.sample ?? 0, p_eligible: p.eligible ?? 0, p_excluded: p.excluded ?? 0,
    p_buckets: p.buckets ?? [], p_metrics: p.metrics ?? {}, p_status: p.status ?? 'insufficient_data',
    p_recommendations: p.recommendations ?? [], p_range_start: null, p_range_end: null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; confidence_auto_adjusted: boolean };
}
export async function fetchCalibrationSnapshots(limit = 50): Promise<CalibrationSnapshotRow[]> {
  const { data, error } = await supabase.rpc('admin_confidence_calibration_snapshots', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as CalibrationSnapshotRow[];
}
export async function recordCausalExternalEvidence(actionType: string, reason: string, evidence: Array<Record<string, unknown>>, refId: string | null = null): Promise<{ ok: boolean; reference_only: boolean }> {
  const { data, error } = await supabase.rpc('admin_causal_external_evidence', { p_action_type: actionType, p_reason: reason, p_evidence: evidence, p_ref_id: refId });
  if (error) throw error;
  return data as { ok: boolean; reference_only: boolean };
}
export async function fetchCausalAudit(limit = 200): Promise<CausalEventRow[]> {
  const { data, error } = await supabase.rpc('admin_causal_audit', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as CausalEventRow[];
}

// ── Corporate Intelligence (0518 — Executive Command, 자동 경영 결정·Priority 확정·캘린더 생성·보고서 발송 없음) ──

export type CorporateIntelSummary = Record<string, number | string | boolean | Record<string, number> | Record<string, unknown> | null>;
export interface CorpSignalRow {
  id: string; signal_code: string; signal_domain: string; signal_type: string; source_system: string;
  title: string; metric_name: string | null; metric_value: number | null; metric_unit: string | null;
  baseline_value: number | null; observed_at: string; monetary_impact_krw: number | null;
  materiality_score: number | null; materiality_status: string; urgency_score: number | null;
  urgency_status: string; deadline_at: string | null; blast_radius: Array<unknown>;
  blast_radius_status: string; review_status: string; limitations: Array<unknown>; created_at: string;
}
export interface ExecPriorityRow {
  id: string; priority_code: string; priority_type: string; title: string; summary: string | null;
  priority_domain: string; source_signal_ids: string[]; materiality_score: number | null;
  materiality_status: string; urgency_score: number | null; urgency_status: string;
  urgent_vs_important: string; deadline_at: string | null; hard_risk_flags: string[];
  priority_score: number | null; priority_tier: string; mutually_exclusive_with: Array<unknown>;
  dependencies: Array<unknown>; expected_impact: string | null; warnings: Array<unknown>;
  priority_status: string; review_reason: string | null; reviewed_at: string | null; limitations: Array<unknown>; created_by: string | null; created_at: string;
}
export interface CorpConflictRow {
  id: string; conflict_code: string; conflict_type: string; title: string; conflict_domain: string;
  side_a_summary: string; side_b_summary: string; severity: string;
  resolution_candidates: Array<Record<string, unknown>>; conflict_status: string;
  review_reason: string | null; limitations: Array<unknown>; created_at: string;
}
export interface ExecAgendaRow {
  id: string; agenda_code: string; agenda_type: string; title: string; agenda_window: string;
  scheduled_for: string | null; items: Array<Record<string, unknown>>; linked_priority_ids: string[];
  decision_required_items: Array<unknown>; can_wait_items: Array<unknown>; must_not_do_items: Array<unknown>;
  agenda_status: string; review_reason: string | null; limitations: Array<unknown>; created_at: string;
}
export interface CorpIntelEventRow { id: string; event_type: string; ref_id: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }

export async function fetchCorporateIntelSummary(): Promise<CorporateIntelSummary> {
  const { data, error } = await supabase.rpc('admin_corporate_intel_summary');
  if (error) throw error;
  return (data as CorporateIntelSummary | null) ?? {};
}
export async function createCorpSignal(p: { code: string; domain: string; type: string; sourceSystem: string; title: string; observedAt: string; evidence: Array<Record<string, unknown>>; metricName?: string | null; metricValue?: number | null; unit?: string | null; baseline?: number | null; monetaryImpact?: number | null; deadline?: string | null; blastRadius?: Array<Record<string, unknown>> }): Promise<{ ok: boolean; id: string; materiality_verified: boolean }> {
  const { data, error } = await supabase.rpc('admin_corporate_signal_create', {
    p_code: p.code, p_domain: p.domain, p_type: p.type, p_source_system: p.sourceSystem,
    p_title: p.title, p_observed_at: p.observedAt, p_evidence: p.evidence,
    p_metric_name: p.metricName ?? null, p_metric_value: p.metricValue ?? null,
    p_unit: p.unit ?? null, p_baseline: p.baseline ?? null,
    p_monetary_impact: p.monetaryImpact ?? null, p_deadline: p.deadline ?? null,
    p_blast_radius: p.blastRadius ?? [], p_source_reference_id: null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; materiality_verified: boolean };
}
export async function reviewCorpSignal(p: { id: string; reason: string; materialityStatus?: string | null; materialityScore?: number | null; urgencyStatus?: string | null; urgencyScore?: number | null; reviewStatus?: string | null }): Promise<{ ok: boolean }> {
  const { data, error } = await supabase.rpc('admin_corporate_signal_review', {
    p_id: p.id, p_reason: p.reason,
    p_materiality_status: p.materialityStatus ?? null, p_materiality_score: p.materialityScore ?? null,
    p_urgency_status: p.urgencyStatus ?? null, p_urgency_score: p.urgencyScore ?? null,
    p_review_status: p.reviewStatus ?? null,
  });
  if (error) throw error;
  return data as { ok: boolean };
}
export async function fetchCorpSignals(domain: string | null = null, limit = 100): Promise<CorpSignalRow[]> {
  const { data, error } = await supabase.rpc('admin_corporate_signals', { p_domain: domain, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as CorpSignalRow[];
}
export async function createExecPriority(p: { code: string; type: string; title: string; domain: string; evidence: Array<Record<string, unknown>>; summary?: string | null; sourceSignalIds?: string[]; materialityScore?: number | null; materialityStatus?: string; urgencyScore?: number | null; urgencyStatus?: string; urgentVsImportant?: string; deadline?: string | null; hardRiskFlags?: string[]; priorityScore?: number | null; priorityTier?: string; dependencies?: Array<Record<string, unknown>>; expectedImpact?: string | null }): Promise<{ ok: boolean; id: string; auto_execution: boolean }> {
  const { data, error } = await supabase.rpc('admin_executive_priority_create', {
    p_code: p.code, p_type: p.type, p_title: p.title, p_domain: p.domain, p_evidence: p.evidence,
    p_summary: p.summary ?? null, p_source_signal_ids: p.sourceSignalIds ?? [],
    p_materiality_score: p.materialityScore ?? null, p_materiality_status: p.materialityStatus ?? 'materiality_unverified',
    p_urgency_score: p.urgencyScore ?? null, p_urgency_status: p.urgencyStatus ?? 'urgency_unverified',
    p_urgent_vs_important: p.urgentVsImportant ?? 'insufficient_data', p_deadline: p.deadline ?? null,
    p_hard_risk_flags: p.hardRiskFlags ?? [], p_priority_score: p.priorityScore ?? null,
    p_priority_tier: p.priorityTier ?? 'insufficient_data', p_mutually_exclusive: [],
    p_dependencies: p.dependencies ?? [], p_expected_impact: p.expectedImpact ?? null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; auto_execution: boolean };
}
export async function reviewExecPriority(id: string, status: string, reason: string, tier: string | null = null): Promise<{ ok: boolean; priority_status: string; warnings: Array<unknown>; executed: boolean }> {
  const { data, error } = await supabase.rpc('admin_executive_priority_review', { p_id: id, p_status: status, p_reason: reason, p_tier: tier });
  if (error) throw error;
  return data as { ok: boolean; priority_status: string; warnings: Array<unknown>; executed: boolean };
}
export async function fetchExecPriorities(tier: string | null = null, limit = 100): Promise<ExecPriorityRow[]> {
  const { data, error } = await supabase.rpc('admin_executive_priorities', { p_tier: tier, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ExecPriorityRow[];
}
export async function createCorpConflict(p: { code: string; type: string; title: string; domain: string; sideA: string; sideB: string; evidence: Array<Record<string, unknown>>; severity?: string; resolutionCandidates?: Array<Record<string, unknown>> }): Promise<{ ok: boolean; id: string; auto_resolved: boolean }> {
  const { data, error } = await supabase.rpc('admin_corporate_conflict_create', {
    p_code: p.code, p_type: p.type, p_title: p.title, p_domain: p.domain,
    p_side_a: p.sideA, p_side_b: p.sideB, p_evidence: p.evidence,
    p_severity: p.severity ?? 'severity_unverified', p_side_a_ref: null, p_side_b_ref: null,
    p_resolution_candidates: p.resolutionCandidates ?? [],
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; auto_resolved: boolean };
}
export async function reviewCorpConflict(id: string, status: string, reason: string): Promise<{ ok: boolean; conflict_status: string }> {
  const { data, error } = await supabase.rpc('admin_corporate_conflict_review', { p_id: id, p_status: status, p_reason: reason });
  if (error) throw error;
  return data as { ok: boolean; conflict_status: string };
}
export async function fetchCorpConflicts(status: string | null = null, limit = 100): Promise<CorpConflictRow[]> {
  const { data, error } = await supabase.rpc('admin_corporate_conflicts', { p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as CorpConflictRow[];
}
export async function createExecAgenda(p: { code: string; type: string; title: string; evidence: Array<Record<string, unknown>>; window?: string; scheduledFor?: string | null; items?: Array<Record<string, unknown>>; linkedPriorityIds?: string[]; decisionRequired?: Array<Record<string, unknown>>; canWait?: Array<Record<string, unknown>>; mustNotDo?: Array<Record<string, unknown>> }): Promise<{ ok: boolean; id: string; calendar_created: boolean }> {
  const { data, error } = await supabase.rpc('admin_executive_agenda_create', {
    p_code: p.code, p_type: p.type, p_title: p.title, p_evidence: p.evidence,
    p_window: p.window ?? 'ad_hoc', p_scheduled_for: p.scheduledFor ?? null,
    p_items: p.items ?? [], p_linked_priority_ids: p.linkedPriorityIds ?? [],
    p_decision_required: p.decisionRequired ?? [], p_can_wait: p.canWait ?? [],
    p_must_not_do: p.mustNotDo ?? [],
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; calendar_created: boolean };
}
export async function reviewExecAgenda(id: string, status: string, reason: string): Promise<{ ok: boolean; agenda_status: string; calendar_created: boolean }> {
  const { data, error } = await supabase.rpc('admin_executive_agenda_review', { p_id: id, p_status: status, p_reason: reason });
  if (error) throw error;
  return data as { ok: boolean; agenda_status: string; calendar_created: boolean };
}
export async function fetchExecAgendas(type: string | null = null, limit = 50): Promise<ExecAgendaRow[]> {
  const { data, error } = await supabase.rpc('admin_executive_agendas_list', { p_type: type, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ExecAgendaRow[];
}
export async function recordCorpBriefing(kind: string, reason: string, payload: Record<string, unknown>, refId: string | null = null): Promise<{ ok: boolean; id: string; report_sent: boolean; legal_board_document: boolean }> {
  const { data, error } = await supabase.rpc('admin_corporate_briefing_record', { p_kind: kind, p_reason: reason, p_payload: payload, p_ref_id: refId });
  if (error) throw error;
  return data as { ok: boolean; id: string; report_sent: boolean; legal_board_document: boolean };
}
export async function recordCorpExternalAction(actionType: string, reason: string, evidence: Array<Record<string, unknown>>, refId: string | null = null): Promise<{ ok: boolean; reference_only: boolean }> {
  const { data, error } = await supabase.rpc('admin_corporate_external_action', { p_action_type: actionType, p_reason: reason, p_evidence: evidence, p_ref_id: refId });
  if (error) throw error;
  return data as { ok: boolean; reference_only: boolean };
}
export async function fetchCorpIntelAudit(limit = 200): Promise<CorpIntelEventRow[]> {
  const { data, error } = await supabase.rpc('admin_corporate_intel_audit', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as CorpIntelEventRow[];
}

// ── Executive Capacity (0519 — Capacity/Portfolio/Exposure, 자동 Priority 선택·캘린더·업무 할당·예산 배정 없음) ──

export type ExecCapacitySummary = Record<string, number | string | boolean | Record<string, number> | Record<string, unknown> | null>;
export interface ExecCapacitySnapshotRow {
  id: string; snapshot_code: string; capacity_scope: string; scope_id: string | null; capacity_domain: string;
  role_reference: string | null; period_start: string | null; period_end: string | null;
  available_hours: number | null; reserved_hours: number | null; review_capacity_count: number | null;
  decision_capacity_count: number | null; concurrent_priority_limit: number | null;
  current_priority_count: number | null; current_review_count: number | null; current_decision_count: number | null;
  capacity_status: string; review_status: string; limitations: Array<unknown>; generated_at: string; created_at: string;
}
export interface EffortEstimateRow {
  id: string; estimate_code: string; priority_candidate_id: string; effort_domain: string;
  review_hours: number | null; decision_hours: number | null; meeting_hours: number | null;
  analysis_hours: number | null; execution_reference_hours: number | null; observation_hours: number | null;
  required_roles: Array<unknown>; dependency_wait_days: number | null; expected_duration_days: number | null;
  estimate_confidence: number | null; effort_status: string; limitations: Array<unknown>; created_at: string;
}
export interface AgingSnapshotRow {
  id: string; snapshot_code: string; priority_candidate_id: string; snapshot_at: string;
  age_days: number; status_age_days: number | null; days_to_deadline: number | null;
  days_past_deadline: number | null; waiting_evidence_days: number | null; deferred_days: number | null;
  aging_status: string; escalation_candidate: boolean; delay_risk: string | null; limitations: Array<unknown>; created_at: string;
}
export interface FinancialExposureRow {
  id: string; exposure_code: string; priority_candidate_id: string; exposure_type: string; currency: string;
  baseline_amount: number | null; low_estimate: number | null; expected_estimate: number | null;
  high_estimate: number | null; time_horizon: string | null; exposure_direction: string | null;
  probability_reference: number | null; confidence: number | null; calculation_method: string | null;
  verification_status: string; review_status: string; limitations: Array<unknown>; created_at: string;
}
export interface ConfidenceDriftSnapshotRow {
  id: string; snapshot_code: string; priority_candidate_id: string; snapshot_at: string;
  confidence_value: number; confidence_source: string; evidence_count: number | null;
  counter_evidence_count: number | null; input_freshness: string | null;
  drift_from_previous: number | null; drift_from_initial: number | null; drift_status: string;
  reason_summary: string | null; limitations: Array<unknown>; created_at: string;
}
export interface PriorityPortfolioRow {
  id: string; portfolio_code: string; title: string; portfolio_period_start: string | null;
  portfolio_period_end: string | null; portfolio_type: string; priority_candidate_ids: string[];
  excluded_priority_ids: string[]; hard_risk_exclusion_reasons: Array<unknown>;
  total_review_hours: number | null; total_decision_hours: number | null; total_meeting_hours: number | null;
  total_financial_exposure: number | null; risk_summary: Array<unknown>; conflict_summary: Array<unknown>;
  feasibility_status: string; confidence: number | null; review_status: string; decision: string | null;
  decision_reason: string | null; warnings: Array<unknown>; limitations: Array<unknown>; created_by: string | null;
  created_at: string; reviewed_at: string | null;
}
export interface ExecCapacityEventRow { id: string; event_type: string; ref_id: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }

export async function fetchExecCapacitySummary(): Promise<ExecCapacitySummary> {
  const { data, error } = await supabase.rpc('admin_executive_capacity_summary');
  if (error) throw error;
  return (data as ExecCapacitySummary | null) ?? {};
}
export async function createExecCapacitySnapshot(p: { code: string; scope: string; domain: string; evidence: Array<Record<string, unknown>>; scopeId?: string | null; role?: string | null; availableHours?: number | null; reservedHours?: number | null; reviewCapacity?: number | null; decisionCapacity?: number | null; concurrentLimit?: number | null; currentPriorities?: number | null; status?: string }): Promise<{ ok: boolean; id: string; capacity_status: string }> {
  const { data, error } = await supabase.rpc('admin_executive_capacity_snapshot_create', {
    p_code: p.code, p_scope: p.scope, p_domain: p.domain, p_evidence: p.evidence,
    p_scope_id: p.scopeId ?? null, p_role: p.role ?? null, p_period_start: null, p_period_end: null,
    p_available_hours: p.availableHours ?? null, p_reserved_hours: p.reservedHours ?? null,
    p_review_capacity: p.reviewCapacity ?? null, p_decision_capacity: p.decisionCapacity ?? null,
    p_concurrent_limit: p.concurrentLimit ?? null, p_current_priorities: p.currentPriorities ?? null,
    p_current_reviews: null, p_current_decisions: null,
    p_status: p.status ?? 'executive_capacity_unknown', p_assumptions: [],
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; capacity_status: string };
}
export async function fetchExecCapacitySnapshots(domain: string | null = null, limit = 50): Promise<ExecCapacitySnapshotRow[]> {
  const { data, error } = await supabase.rpc('admin_executive_capacity_snapshots', { p_domain: domain, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ExecCapacitySnapshotRow[];
}
export async function createPriorityEffort(p: { code: string; priorityId: string; domain: string; evidence: Array<Record<string, unknown>>; reviewHours?: number | null; decisionHours?: number | null; meetingHours?: number | null; analysisHours?: number | null; executionHours?: number | null; observationHours?: number | null; confidence?: number | null; status?: string }): Promise<{ ok: boolean; id: string; effort_status: string }> {
  const { data, error } = await supabase.rpc('admin_priority_effort_create', {
    p_code: p.code, p_priority_id: p.priorityId, p_domain: p.domain, p_evidence: p.evidence,
    p_review_hours: p.reviewHours ?? null, p_decision_hours: p.decisionHours ?? null,
    p_meeting_hours: p.meetingHours ?? null, p_analysis_hours: p.analysisHours ?? null,
    p_execution_hours: p.executionHours ?? null, p_observation_hours: p.observationHours ?? null,
    p_required_roles: [], p_dependency_wait_days: null, p_duration_days: null,
    p_confidence: p.confidence ?? null, p_status: p.status ?? 'manually_estimated', p_assumptions: [],
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; effort_status: string };
}
export async function fetchPriorityEfforts(priorityId: string | null = null, limit = 100): Promise<EffortEstimateRow[]> {
  const { data, error } = await supabase.rpc('admin_priority_effort_estimates', { p_priority_id: priorityId, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as EffortEstimateRow[];
}
export async function createAgingSnapshot(p: { code: string; priorityId: string; evidence: Array<Record<string, unknown>>; status?: string; daysToDeadline?: number | null; delayRisk?: string | null; escalationCandidate?: boolean }): Promise<{ ok: boolean; id: string; auto_escalated: boolean }> {
  const { data, error } = await supabase.rpc('admin_priority_aging_snapshot_create', {
    p_code: p.code, p_priority_id: p.priorityId, p_evidence: p.evidence,
    p_status: p.status ?? 'aging_threshold_unverified', p_days_to_deadline: p.daysToDeadline ?? null,
    p_waiting_evidence_days: null, p_deferred_days: null,
    p_delay_risk: p.delayRisk ?? null, p_escalation_candidate: p.escalationCandidate ?? false,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; auto_escalated: boolean };
}
export async function fetchAgingSnapshots(priorityId: string | null = null, limit = 100): Promise<AgingSnapshotRow[]> {
  const { data, error } = await supabase.rpc('admin_priority_aging_snapshots', { p_priority_id: priorityId, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as AgingSnapshotRow[];
}
export async function createFinancialExposure(p: { code: string; priorityId: string; type: string; evidence: Array<Record<string, unknown>>; currency?: string; low?: number | null; expected?: number | null; high?: number | null; horizon?: string | null; direction?: string | null; probability?: number | null; confidence?: number | null; method?: string | null; verification?: string }): Promise<{ ok: boolean; id: string; accounting_loss: boolean }> {
  const { data, error } = await supabase.rpc('admin_priority_financial_exposure_create', {
    p_code: p.code, p_priority_id: p.priorityId, p_type: p.type, p_evidence: p.evidence,
    p_currency: p.currency ?? 'KRW', p_baseline: null, p_low: p.low ?? null,
    p_expected: p.expected ?? null, p_high: p.high ?? null, p_horizon: p.horizon ?? null,
    p_direction: p.direction ?? null, p_probability: p.probability ?? null,
    p_confidence: p.confidence ?? null, p_method: p.method ?? null,
    p_verification: p.verification ?? 'financial_exposure_unknown', p_assumptions: [],
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; accounting_loss: boolean };
}
export async function fetchFinancialExposures(priorityId: string | null = null, limit = 100): Promise<FinancialExposureRow[]> {
  const { data, error } = await supabase.rpc('admin_priority_financial_exposures', { p_priority_id: priorityId, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as FinancialExposureRow[];
}
export async function createConfidenceDriftSnapshot(p: { code: string; priorityId: string; confidence: number; source: string; evidence: Array<Record<string, unknown>>; evidenceCount?: number | null; counterCount?: number | null; status?: string; reason?: string | null }): Promise<{ ok: boolean; id: string; confidence_auto_adjusted: boolean }> {
  const { data, error } = await supabase.rpc('admin_priority_confidence_snapshot_create', {
    p_code: p.code, p_priority_id: p.priorityId, p_confidence: p.confidence, p_source: p.source,
    p_evidence: p.evidence, p_evidence_count: p.evidenceCount ?? null, p_counter_count: p.counterCount ?? null,
    p_freshness: null, p_status: p.status ?? 'confidence_drift_unverified', p_reason: p.reason ?? null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; confidence_auto_adjusted: boolean };
}
export async function fetchConfidenceDriftSnapshots(priorityId: string | null = null, limit = 100): Promise<ConfidenceDriftSnapshotRow[]> {
  const { data, error } = await supabase.rpc('admin_priority_confidence_snapshots', { p_priority_id: priorityId, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ConfidenceDriftSnapshotRow[];
}
export async function createPriorityPortfolio(p: { code: string; title: string; type: string; evidence: Array<Record<string, unknown>>; priorityIds?: string[]; excludedIds?: string[]; hardRiskExclusionReasons?: Array<Record<string, unknown>>; reviewHours?: number | null; decisionHours?: number | null; meetingHours?: number | null; totalExposure?: number | null; riskSummary?: Array<Record<string, unknown>>; conflictSummary?: Array<Record<string, unknown>>; confidence?: number | null }): Promise<{ ok: boolean; id: string; auto_selected: boolean; optimal_claimed: boolean }> {
  const { data, error } = await supabase.rpc('admin_priority_portfolio_create', {
    p_code: p.code, p_title: p.title, p_type: p.type, p_evidence: p.evidence,
    p_priority_ids: p.priorityIds ?? [], p_excluded_ids: p.excludedIds ?? [],
    p_hard_risk_exclusion_reasons: p.hardRiskExclusionReasons ?? [],
    p_period_start: null, p_period_end: null,
    p_review_hours: p.reviewHours ?? null, p_decision_hours: p.decisionHours ?? null,
    p_meeting_hours: p.meetingHours ?? null, p_total_exposure: p.totalExposure ?? null,
    p_risk_summary: p.riskSummary ?? [], p_conflict_summary: p.conflictSummary ?? [],
    p_confidence: p.confidence ?? null, p_assumptions: [],
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; auto_selected: boolean; optimal_claimed: boolean };
}
export async function reviewPriorityPortfolio(id: string, status: string, reason: string, feasibility: string | null = null): Promise<{ ok: boolean; review_status: string; warnings: Array<unknown>; executed: boolean }> {
  const { data, error } = await supabase.rpc('admin_priority_portfolio_review', { p_id: id, p_status: status, p_reason: reason, p_feasibility: feasibility });
  if (error) throw error;
  return data as { ok: boolean; review_status: string; warnings: Array<unknown>; executed: boolean };
}
export async function fetchPriorityPortfolios(status: string | null = null, limit = 50): Promise<PriorityPortfolioRow[]> {
  const { data, error } = await supabase.rpc('admin_priority_portfolios', { p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as PriorityPortfolioRow[];
}
export async function recordExecCapacityExternalAction(actionType: string, reason: string, evidence: Array<Record<string, unknown>>, refId: string | null = null): Promise<{ ok: boolean; reference_only: boolean }> {
  const { data, error } = await supabase.rpc('admin_executive_capacity_external_action', { p_action_type: actionType, p_reason: reason, p_evidence: evidence, p_ref_id: refId });
  if (error) throw error;
  return data as { ok: boolean; reference_only: boolean };
}
export async function fetchExecCapacityAudit(limit = 200): Promise<ExecCapacityEventRow[]> {
  const { data, error } = await supabase.rpc('admin_executive_capacity_audit', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ExecCapacityEventRow[];
}

// ── Commitment Intelligence (0520 — Execution Assurance/Accountability, 자동 업무 할당·일정 변경·완료 처리·인사 평가 없음) ──

export type CommitmentSummary = Record<string, number | string | boolean | Record<string, number> | Record<string, unknown> | null>;
export interface CommitmentRow {
  id: string; commitment_code: string; commitment_domain: string; commitment_type: string;
  source_reference_type: string | null; priority_candidate_id: string | null; priority_portfolio_id: string | null;
  title: string; commitment_summary: string | null; owner_reference: string | null;
  sponsor_reference: string | null; reviewer_reference: string | null; backup_owner_reference: string | null;
  owner_acknowledged: boolean; sponsor_acknowledged: boolean; reviewer_acknowledged: boolean;
  start_reference_at: string | null; target_reference_at: string | null;
  actual_start_reference_at: string | null; actual_complete_reference_at: string | null;
  success_criteria: Array<Record<string, unknown>>; preconditions: Array<unknown>;
  dependencies: Array<unknown>; risks: Array<unknown>; evidence: Array<unknown>;
  commitment_status: string; review_status: string; review_reason: string | null;
  warnings: Array<unknown>; limitations: Array<unknown>; created_by: string | null;
  created_at: string; updated_at: string; reviewed_at: string | null;
}
export interface CommitmentMilestoneRow {
  id: string; milestone_code: string; commitment_id: string; title: string; milestone_sequence: number;
  milestone_type: string; planned_start_reference_at: string | null; planned_due_reference_at: string | null;
  actual_start_reference_at: string | null; actual_complete_reference_at: string | null;
  milestone_status: string; completion_percentage_reference: number | null;
  success_criteria: Array<unknown>; evidence_required: Array<unknown>; evidence: Array<unknown>;
  dependencies: Array<unknown>; blockers: Array<unknown>; review_status: string;
  limitations: Array<unknown>; created_at: string;
}
export interface CommitmentProgressRow {
  id: string; snapshot_code: string; commitment_id: string; snapshot_at: string;
  reported_progress_percentage: number | null; verified_progress_percentage: number | null;
  progress_status: string; completed_milestone_count: number | null; total_milestone_count: number | null;
  active_blocker_count: number | null; schedule_variance_days: number | null;
  scope_variance_status: string | null; delivery_confidence: number | null;
  limitations: Array<unknown>; created_at: string;
}
export interface CommitmentBlockerRow {
  id: string; blocker_code: string; commitment_id: string; milestone_id: string | null;
  blocker_type: string; blocker_summary: string; severity: string; impact_status: string;
  blocking_domain: string | null; owner_reference: string | null; detected_at: string;
  expected_resolution_reference_at: string | null; resolved_reference_at: string | null;
  blocker_status: string; limitations: Array<unknown>; created_at: string;
}
export interface CompletionReviewRow {
  id: string; review_code: string; commitment_id: string; completion_reported_at: string;
  reported_by_reference: string | null; completion_summary: string;
  claimed_deliverables: Array<unknown>; completion_evidence: Array<unknown>;
  success_criteria_results: Array<unknown>; verification_status: string;
  reviewer_reference: string | null; reviewed_at: string | null; review_reason: string | null;
  unresolved_items: Array<unknown>; outcome_observation_required: boolean;
  limitations: Array<unknown>; created_at: string;
}
export interface CommitmentEventRow { id: string; event_type: string; ref_id: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }

export async function fetchCommitmentSummary(): Promise<CommitmentSummary> {
  const { data, error } = await supabase.rpc('admin_commitment_summary');
  if (error) throw error;
  return (data as CommitmentSummary | null) ?? {};
}
export async function createCommitment(p: { code: string; domain: string; type: string; title: string; evidence: Array<Record<string, unknown>>; summary?: string | null; priorityId?: string | null; portfolioId?: string | null; owner?: string | null; sponsor?: string | null; reviewer?: string | null; backup?: string | null; startAt?: string | null; targetAt?: string | null; successCriteria?: Array<Record<string, unknown>>; preconditions?: Array<Record<string, unknown>>; dependencies?: Array<Record<string, unknown>>; risks?: Array<Record<string, unknown>> }): Promise<{ ok: boolean; id: string; execution_started: boolean; work_assigned: boolean }> {
  const { data, error } = await supabase.rpc('admin_commitment_create', {
    p_code: p.code, p_domain: p.domain, p_type: p.type, p_title: p.title, p_evidence: p.evidence,
    p_summary: p.summary ?? null, p_priority_id: p.priorityId ?? null, p_portfolio_id: p.portfolioId ?? null,
    p_source_type: null, p_source_id: null, p_owner: p.owner ?? null, p_sponsor: p.sponsor ?? null,
    p_reviewer: p.reviewer ?? null, p_backup: p.backup ?? null, p_start_at: p.startAt ?? null,
    p_target_at: p.targetAt ?? null, p_success_criteria: p.successCriteria ?? [],
    p_preconditions: p.preconditions ?? [], p_dependencies: p.dependencies ?? [], p_risks: p.risks ?? [],
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; execution_started: boolean; work_assigned: boolean };
}
export async function reviewCommitment(id: string, status: string, reason: string, commitmentStatus: string | null = null): Promise<{ ok: boolean; review_status: string; warnings: Array<unknown> }> {
  const { data, error } = await supabase.rpc('admin_commitment_review', { p_id: id, p_status: status, p_reason: reason, p_commitment_status: commitmentStatus });
  if (error) throw error;
  return data as { ok: boolean; review_status: string; warnings: Array<unknown> };
}
export async function setCommitmentOwnership(p: { id: string; role: string; reference: string; reason: string; acknowledged?: boolean; evidence?: Array<Record<string, unknown>> }): Promise<{ ok: boolean; role: string; acknowledged: boolean; work_assigned: boolean }> {
  const { data, error } = await supabase.rpc('admin_commitment_ownership_reference', { p_id: p.id, p_role: p.role, p_reference: p.reference, p_reason: p.reason, p_acknowledged: p.acknowledged ?? false, p_evidence: p.evidence ?? [] });
  if (error) throw error;
  return data as { ok: boolean; role: string; acknowledged: boolean; work_assigned: boolean };
}
export async function fetchCommitments(status: string | null = null, limit = 100): Promise<CommitmentRow[]> {
  const { data, error } = await supabase.rpc('admin_commitments', { p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as CommitmentRow[];
}
export async function createCommitmentMilestone(p: { code: string; commitmentId: string; title: string; sequence: number; type: string; evidence: Array<Record<string, unknown>>; plannedStart?: string | null; plannedDue?: string | null; successCriteria?: Array<Record<string, unknown>>; evidenceRequired?: Array<Record<string, unknown>> }): Promise<{ ok: boolean; id: string; task_created: boolean }> {
  const { data, error } = await supabase.rpc('admin_commitment_milestone_create', {
    p_code: p.code, p_commitment_id: p.commitmentId, p_title: p.title, p_sequence: p.sequence,
    p_type: p.type, p_evidence: p.evidence, p_planned_start: p.plannedStart ?? null,
    p_planned_due: p.plannedDue ?? null, p_success_criteria: p.successCriteria ?? [],
    p_evidence_required: p.evidenceRequired ?? [],
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; task_created: boolean };
}
export async function reviewCommitmentMilestone(id: string, status: string, reason: string, evidence: Array<Record<string, unknown>> = []): Promise<{ ok: boolean; milestone_status: string; outcome_achieved: boolean }> {
  const { data, error } = await supabase.rpc('admin_commitment_milestone_review', { p_id: id, p_status: status, p_reason: reason, p_evidence: evidence });
  if (error) throw error;
  return data as { ok: boolean; milestone_status: string; outcome_achieved: boolean };
}
export async function fetchCommitmentMilestones(commitmentId: string | null = null, limit = 100): Promise<CommitmentMilestoneRow[]> {
  const { data, error } = await supabase.rpc('admin_commitment_milestones', { p_commitment_id: commitmentId, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as CommitmentMilestoneRow[];
}
export async function createCommitmentProgress(p: { code: string; commitmentId: string; evidence: Array<Record<string, unknown>>; reported?: number | null; verified?: number | null; status?: string; scheduleVariance?: number | null; deliveryConfidence?: number | null }): Promise<{ ok: boolean; id: string; progress_status: string; auto_progress_change: boolean }> {
  const { data, error } = await supabase.rpc('admin_commitment_progress_snapshot_create', {
    p_code: p.code, p_commitment_id: p.commitmentId, p_evidence: p.evidence,
    p_reported: p.reported ?? null, p_verified: p.verified ?? null,
    p_status: p.status ?? 'insufficient_data', p_schedule_variance: p.scheduleVariance ?? null,
    p_scope_variance: null, p_delivery_confidence: p.deliveryConfidence ?? null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; progress_status: string; auto_progress_change: boolean };
}
export async function fetchCommitmentProgress(commitmentId: string | null = null, limit = 100): Promise<CommitmentProgressRow[]> {
  const { data, error } = await supabase.rpc('admin_commitment_progress_snapshots', { p_commitment_id: commitmentId, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as CommitmentProgressRow[];
}
export async function createCommitmentBlocker(p: { code: string; commitmentId: string; type: string; summary: string; evidence: Array<Record<string, unknown>>; milestoneId?: string | null; severity?: string; impact?: string; domain?: string | null; owner?: string | null }): Promise<{ ok: boolean; id: string; auto_resolved: boolean }> {
  const { data, error } = await supabase.rpc('admin_commitment_blocker_create', {
    p_code: p.code, p_commitment_id: p.commitmentId, p_type: p.type, p_summary: p.summary,
    p_evidence: p.evidence, p_milestone_id: p.milestoneId ?? null,
    p_severity: p.severity ?? 'severity_unverified', p_impact: p.impact ?? 'blocker_impact_unverified',
    p_domain: p.domain ?? null, p_owner: p.owner ?? null, p_expected_resolution: null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; auto_resolved: boolean };
}
export async function reviewCommitmentBlocker(id: string, status: string, reason: string): Promise<{ ok: boolean; blocker_status: string }> {
  const { data, error } = await supabase.rpc('admin_commitment_blocker_review', { p_id: id, p_status: status, p_reason: reason });
  if (error) throw error;
  return data as { ok: boolean; blocker_status: string };
}
export async function fetchCommitmentBlockers(commitmentId: string | null = null, limit = 100): Promise<CommitmentBlockerRow[]> {
  const { data, error } = await supabase.rpc('admin_commitment_blockers', { p_commitment_id: commitmentId, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as CommitmentBlockerRow[];
}
export async function reportCommitmentCompletion(p: { code: string; commitmentId: string; summary: string; evidence: Array<Record<string, unknown>>; reportedBy?: string | null; deliverables?: Array<Record<string, unknown>>; criteriaResults?: Array<Record<string, unknown>> }): Promise<{ ok: boolean; id: string; verified: boolean; outcome_achieved: boolean }> {
  const { data, error } = await supabase.rpc('admin_commitment_completion_report', {
    p_code: p.code, p_commitment_id: p.commitmentId, p_summary: p.summary, p_evidence: p.evidence,
    p_reported_by: p.reportedBy ?? null, p_deliverables: p.deliverables ?? [],
    p_criteria_results: p.criteriaResults ?? [],
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; verified: boolean; outcome_achieved: boolean };
}
export async function reviewCommitmentCompletion(id: string, status: string, reason: string, unresolved: Array<Record<string, unknown>> = []): Promise<{ ok: boolean; verification_status: string; warnings: Array<unknown>; outcome_achieved: boolean }> {
  const { data, error } = await supabase.rpc('admin_commitment_completion_review', { p_id: id, p_status: status, p_reason: reason, p_unresolved: unresolved });
  if (error) throw error;
  return data as { ok: boolean; verification_status: string; warnings: Array<unknown>; outcome_achieved: boolean };
}
export async function fetchCompletionReviews(commitmentId: string | null = null, limit = 100): Promise<CompletionReviewRow[]> {
  const { data, error } = await supabase.rpc('admin_commitment_completion_reviews', { p_commitment_id: commitmentId, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as CompletionReviewRow[];
}
export async function recordCommitmentGovernance(kind: string, reason: string, payload: Record<string, unknown>, refId: string | null = null): Promise<{ ok: boolean; id: string; personnel_evaluation: boolean }> {
  const { data, error } = await supabase.rpc('admin_commitment_governance_record', { p_kind: kind, p_reason: reason, p_payload: payload, p_ref_id: refId });
  if (error) throw error;
  return data as { ok: boolean; id: string; personnel_evaluation: boolean };
}
export async function recordCommitmentExternalAction(actionType: string, reason: string, evidence: Array<Record<string, unknown>>, refId: string | null = null): Promise<{ ok: boolean; reference_only: boolean }> {
  const { data, error } = await supabase.rpc('admin_commitment_external_action', { p_action_type: actionType, p_reason: reason, p_evidence: evidence, p_ref_id: refId });
  if (error) throw error;
  return data as { ok: boolean; reference_only: boolean };
}
export async function fetchCommitmentAudit(limit = 200): Promise<CommitmentEventRow[]> {
  const { data, error } = await supabase.rpc('admin_commitment_audit', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as CommitmentEventRow[];
}

// ── Execution Delivery Analytics (0521 — Delivery/KPI 상관/Health, 자동 업무·KPI·Outcome 변경·인사 평가 없음) ──

export type DeliverySummary = Record<string, number | string | boolean | Record<string, number> | Record<string, unknown> | null>;
export interface DeliverySnapshotRow {
  id: string; snapshot_code: string; snapshot_kind: string; period_start: string | null;
  period_end: string | null; sample_size: number; success_rate: number | null; rate_status: string;
  metrics: Record<string, unknown>; findings: Array<unknown>; risk_factors: Array<unknown>;
  unknown_factors: Array<unknown>; limitations: Array<unknown>; generated_at: string; created_at: string;
}
export interface KpiCorrelationRow {
  id: string; correlation_code: string; commitment_scope: string; kpi_type: string; kpi_source: string;
  sample_size: number; correlation_summary: string; correlation_direction: string | null;
  correlation_status: string; causal_candidate_ref: string | null; limitations: Array<unknown>; created_at: string;
}
export interface DeliveryEventRow { id: string; event_type: string; ref_id: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }

export async function fetchDeliverySummary(): Promise<DeliverySummary> {
  const { data, error } = await supabase.rpc('admin_execution_delivery_summary');
  if (error) throw error;
  return (data as DeliverySummary | null) ?? {};
}
export async function createDeliverySnapshot(p: { code: string; kind: string; evidence: Array<Record<string, unknown>>; sample?: number; successRate?: number | null; metrics?: Record<string, unknown>; findings?: Array<Record<string, unknown>>; riskFactors?: Array<Record<string, unknown>> }): Promise<{ ok: boolean; id: string; rate_status: string; personnel_evaluation: boolean }> {
  const { data, error } = await supabase.rpc('admin_delivery_snapshot_create', {
    p_code: p.code, p_kind: p.kind, p_evidence: p.evidence,
    p_sample: p.sample ?? 0, p_success_rate: p.successRate ?? null,
    p_metrics: p.metrics ?? {}, p_findings: p.findings ?? [],
    p_risk_factors: p.riskFactors ?? [], p_unknown: [],
    p_period_start: null, p_period_end: null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; rate_status: string; personnel_evaluation: boolean };
}
export async function fetchDeliverySnapshots(kind: string | null = null, limit = 50): Promise<DeliverySnapshotRow[]> {
  const { data, error } = await supabase.rpc('admin_delivery_snapshots', { p_kind: kind, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as DeliverySnapshotRow[];
}
export async function createKpiCorrelation(p: { code: string; scope: string; kpiType: string; kpiSource: string; summary: string; evidence: Array<Record<string, unknown>>; sample?: number; direction?: string | null }): Promise<{ ok: boolean; id: string; correlation_status: string; causally_attributed: boolean }> {
  const { data, error } = await supabase.rpc('admin_kpi_correlation_create', {
    p_code: p.code, p_scope: p.scope, p_kpi_type: p.kpiType, p_kpi_source: p.kpiSource,
    p_summary: p.summary, p_evidence: p.evidence, p_sample: p.sample ?? 0,
    p_direction: p.direction ?? null, p_causal_ref: null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; correlation_status: string; causally_attributed: boolean };
}
export async function fetchKpiCorrelations(kpiType: string | null = null, limit = 100): Promise<KpiCorrelationRow[]> {
  const { data, error } = await supabase.rpc('admin_kpi_correlations', { p_kpi_type: kpiType, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as KpiCorrelationRow[];
}
export async function recordDeliveryGovernance(kind: string, reason: string, payload: Record<string, unknown>, refId: string | null = null): Promise<{ ok: boolean; id: string; personnel_evaluation: boolean }> {
  const { data, error } = await supabase.rpc('admin_delivery_governance_record', { p_kind: kind, p_reason: reason, p_payload: payload, p_ref_id: refId });
  if (error) throw error;
  return data as { ok: boolean; id: string; personnel_evaluation: boolean };
}
export async function fetchDeliveryAudit(limit = 200): Promise<DeliveryEventRow[]> {
  const { data, error } = await supabase.rpc('admin_execution_delivery_audit', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as DeliveryEventRow[];
}

// ── Predictive Execution (0522 — Forecast/Simulation, Prediction ≠ Outcome·자동 확정/배정 없음) ──

export type ForecastSummary = Record<string, number | string | boolean | Record<string, number> | Record<string, unknown> | null>;
export interface ForecastRow {
  id: string; forecast_code: string; forecast_kind: string; target_reference_type: string | null;
  target_reference_id: string | null; horizon: string; predicted_value: number | null;
  predicted_low: number | null; predicted_high: number | null; predicted_unit: string | null;
  probability_reference: number | null; forecast_confidence: number | null; sample_size: number;
  forecast_status: string; evidence_coverage: number | null; unknown_components: Array<unknown>;
  missing_signals: Array<unknown>; assumptions: Array<unknown>; input_freshness: string | null;
  actual_value: number | null; actual_recorded_at: string | null; limitations: Array<unknown>;
  generated_at: string; created_at: string;
}
export interface ExecSimulationRow {
  id: string; simulation_code: string; simulation_kind: string; scenario_summary: string;
  baseline_snapshot: Record<string, unknown>; assumed_changes: Array<unknown>;
  projected_effects: Array<Record<string, unknown>>; affected_references: Array<unknown>;
  simulation_confidence: number | null; simulation_status: string; unknown_factors: Array<unknown>;
  limitations: Array<unknown>; created_at: string;
}
export interface ForecastEventRow { id: string; event_type: string; ref_id: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }

export async function fetchForecastSummary(): Promise<ForecastSummary> {
  const { data, error } = await supabase.rpc('admin_forecast_summary');
  if (error) throw error;
  return (data as ForecastSummary | null) ?? {};
}
export async function createForecast(p: { code: string; kind: string; horizon: string; evidence: Array<Record<string, unknown>>; predicted?: number | null; low?: number | null; high?: number | null; unit?: string | null; probability?: number | null; confidence?: number | null; sample?: number; evidenceCoverage?: number | null; unknown?: Array<Record<string, unknown>>; missing?: Array<Record<string, unknown>>; assumptions?: Array<Record<string, unknown>>; freshness?: string | null; targetType?: string | null; targetId?: string | null }): Promise<{ ok: boolean; id: string; forecast_status: string; outcome_guaranteed: boolean }> {
  const { data, error } = await supabase.rpc('admin_forecast_create', {
    p_code: p.code, p_kind: p.kind, p_horizon: p.horizon, p_evidence: p.evidence,
    p_predicted: p.predicted ?? null, p_low: p.low ?? null, p_high: p.high ?? null,
    p_unit: p.unit ?? null, p_probability: p.probability ?? null, p_confidence: p.confidence ?? null,
    p_sample: p.sample ?? 0, p_evidence_coverage: p.evidenceCoverage ?? null,
    p_unknown: p.unknown ?? [], p_missing: p.missing ?? [], p_assumptions: p.assumptions ?? [],
    p_freshness: p.freshness ?? null, p_target_type: p.targetType ?? null, p_target_id: p.targetId ?? null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; forecast_status: string; outcome_guaranteed: boolean };
}
export async function recordForecastActual(id: string, actual: number, reason: string): Promise<{ ok: boolean }> {
  const { data, error } = await supabase.rpc('admin_forecast_actual_record', { p_id: id, p_actual: actual, p_reason: reason });
  if (error) throw error;
  return data as { ok: boolean };
}
export async function fetchForecasts(kind: string | null = null, limit = 100): Promise<ForecastRow[]> {
  const { data, error } = await supabase.rpc('admin_forecasts', { p_kind: kind, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ForecastRow[];
}
export async function createExecSimulation(p: { code: string; kind: string; summary: string; evidence: Array<Record<string, unknown>>; baseline?: Record<string, unknown>; changes?: Array<Record<string, unknown>>; effects?: Array<Record<string, unknown>>; affected?: Array<Record<string, unknown>>; confidence?: number | null; unknown?: Array<Record<string, unknown>> }): Promise<{ ok: boolean; id: string; executed: boolean; resources_assigned: boolean }> {
  const { data, error } = await supabase.rpc('admin_executive_simulation_create', {
    p_code: p.code, p_kind: p.kind, p_summary: p.summary, p_evidence: p.evidence,
    p_baseline: p.baseline ?? {}, p_changes: p.changes ?? [], p_effects: p.effects ?? [],
    p_affected: p.affected ?? [], p_confidence: p.confidence ?? null, p_unknown: p.unknown ?? [],
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; executed: boolean; resources_assigned: boolean };
}
export async function fetchExecSimulations(kind: string | null = null, limit = 100): Promise<ExecSimulationRow[]> {
  const { data, error } = await supabase.rpc('admin_executive_simulations', { p_kind: kind, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ExecSimulationRow[];
}
export async function recordForecastGovernance(kind: string, reason: string, payload: Record<string, unknown>, refId: string | null = null): Promise<{ ok: boolean; id: string; forecast_confirmed_as_fact: boolean }> {
  const { data, error } = await supabase.rpc('admin_forecast_governance_record', { p_kind: kind, p_reason: reason, p_payload: payload, p_ref_id: refId });
  if (error) throw error;
  return data as { ok: boolean; id: string; forecast_confirmed_as_fact: boolean };
}
export async function fetchForecastAudit(limit = 200): Promise<ForecastEventRow[]> {
  const { data, error } = await supabase.rpc('admin_forecast_audit', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ForecastEventRow[];
}

// ── Strategic Advisory (0523 — Scenario Comparison/Advisory, Recommendation ≠ Decision·자동 전략 선택 없음) ──

export type AdvisorySummary = Record<string, number | string | boolean | Record<string, number> | Record<string, unknown> | null>;
export interface ScenarioComparisonRow {
  id: string; comparison_code: string; title: string; scenarios: Array<Record<string, unknown>>;
  comparison_axes: Array<unknown>; tradeoffs: Array<Record<string, unknown>>;
  decision_matrix: Array<Record<string, unknown>>; selected_scenario_reference: string | null;
  comparison_status: string; review_status: string; review_reason: string | null;
  unknown_factors: Array<unknown>; assumptions: Array<unknown>; limitations: Array<unknown>;
  created_by: string | null; created_at: string;
}
export interface ExecAdvisoryRow {
  id: string; advisory_code: string; advisory_type: string; title: string;
  recommendation_summary: string; reasoning_chain: Array<unknown>; evidence: Array<unknown>;
  advisory_confidence: number | null; evidence_coverage: number | null;
  alternatives: Array<unknown>; assumptions: Array<unknown>; unknown_factors: Array<unknown>;
  input_freshness: string | null; advisory_status: string; review_reason: string | null;
  warnings: Array<unknown>; limitations: Array<unknown>; created_by: string | null; created_at: string;
}
export interface AdvisoryEventRow { id: string; event_type: string; ref_id: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }

export async function fetchAdvisorySummary(): Promise<AdvisorySummary> {
  const { data, error } = await supabase.rpc('admin_advisory_summary');
  if (error) throw error;
  return (data as AdvisorySummary | null) ?? {};
}
export async function createScenarioComparison(p: { code: string; title: string; scenarios: Array<Record<string, unknown>>; evidence: Array<Record<string, unknown>>; axes?: Array<Record<string, unknown>>; tradeoffs?: Array<Record<string, unknown>>; matrix?: Array<Record<string, unknown>>; unknown?: Array<Record<string, unknown>>; assumptions?: Array<Record<string, unknown>> }): Promise<{ ok: boolean; id: string; auto_selected: boolean }> {
  const { data, error } = await supabase.rpc('admin_scenario_comparison_create', {
    p_code: p.code, p_title: p.title, p_scenarios: p.scenarios, p_evidence: p.evidence,
    p_axes: p.axes ?? [], p_tradeoffs: p.tradeoffs ?? [], p_matrix: p.matrix ?? [],
    p_unknown: p.unknown ?? [], p_assumptions: p.assumptions ?? [],
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; auto_selected: boolean };
}
export async function reviewScenarioComparison(id: string, status: string, reason: string, selected: string | null = null): Promise<{ ok: boolean; review_status: string; warnings: Array<unknown>; executed: boolean }> {
  const { data, error } = await supabase.rpc('admin_scenario_comparison_review', { p_id: id, p_status: status, p_reason: reason, p_selected: selected });
  if (error) throw error;
  return data as { ok: boolean; review_status: string; warnings: Array<unknown>; executed: boolean };
}
export async function fetchScenarioComparisons(status: string | null = null, limit = 50): Promise<ScenarioComparisonRow[]> {
  const { data, error } = await supabase.rpc('admin_scenario_comparisons', { p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ScenarioComparisonRow[];
}
export async function createExecAdvisory(p: { code: string; type: string; title: string; summary: string; reasoning: Array<Record<string, unknown>>; evidence: Array<Record<string, unknown>>; confidence?: number | null; coverage?: number | null; alternatives?: Array<Record<string, unknown>>; assumptions?: Array<Record<string, unknown>>; unknown?: Array<Record<string, unknown>>; freshness?: string | null }): Promise<{ ok: boolean; id: string; decision_made: boolean; human_approval_required: boolean }> {
  const { data, error } = await supabase.rpc('admin_executive_advisory_create', {
    p_code: p.code, p_type: p.type, p_title: p.title, p_summary: p.summary,
    p_reasoning: p.reasoning, p_evidence: p.evidence,
    p_confidence: p.confidence ?? null, p_coverage: p.coverage ?? null,
    p_alternatives: p.alternatives ?? [], p_assumptions: p.assumptions ?? [],
    p_unknown: p.unknown ?? [], p_freshness: p.freshness ?? null,
    p_target_type: null, p_target_id: null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; decision_made: boolean; human_approval_required: boolean };
}
export async function reviewExecAdvisory(id: string, status: string, reason: string): Promise<{ ok: boolean; advisory_status: string; warnings: Array<unknown>; executed: boolean }> {
  const { data, error } = await supabase.rpc('admin_executive_advisory_review', { p_id: id, p_status: status, p_reason: reason });
  if (error) throw error;
  return data as { ok: boolean; advisory_status: string; warnings: Array<unknown>; executed: boolean };
}
export async function fetchExecAdvisories(type: string | null = null, limit = 100): Promise<ExecAdvisoryRow[]> {
  const { data, error } = await supabase.rpc('admin_executive_advisories', { p_type: type, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ExecAdvisoryRow[];
}
export async function recordAdvisoryGovernance(kind: string, reason: string, payload: Record<string, unknown>, refId: string | null = null): Promise<{ ok: boolean; id: string; decision_made: boolean }> {
  const { data, error } = await supabase.rpc('admin_advisory_governance_record', { p_kind: kind, p_reason: reason, p_payload: payload, p_ref_id: refId });
  if (error) throw error;
  return data as { ok: boolean; id: string; decision_made: boolean };
}
export async function fetchAdvisoryAudit(limit = 200): Promise<AdvisoryEventRow[]> {
  const { data, error } = await supabase.rpc('admin_advisory_audit', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as AdvisoryEventRow[];
}

// ── Corporate Strategy (0524 — Vision/Objectives/Roadmap, 자동 생성·승인·변경 없음) ──

export type CorpStrategySummary = Record<string, number | string | boolean | Record<string, number> | Record<string, unknown> | null>;
export interface VisionRecordRow {
  id: string; record_code: string; record_kind: string; statement: string; human_authored: boolean;
  version_note: string | null; effective_from: string | null; record_status: string;
  limitations: Array<unknown>; created_at: string;
}
export interface CorpObjectiveRow {
  id: string; objective_code: string; objective_kind: string; title: string; description: string | null;
  parent_vision_id: string | null; parent_objective_id: string | null; target_year: number | null;
  target_quarter: number | null; priority_reference: string; owner_reference: string | null;
  review_cycle: string; success_criteria: Array<unknown>; linked_initiative_ids: string[];
  linked_priority_ids: string[]; objective_status: string; review_reason: string | null;
  warnings: Array<unknown>; unknown_factors: Array<unknown>; limitations: Array<unknown>;
  created_by: string | null; created_at: string;
}
export interface RoadmapItemRow {
  id: string; roadmap_code: string; title: string; roadmap_year: number; roadmap_phase: string;
  phase_sequence: number | null; summary: string | null; linked_objective_ids: string[];
  planned_milestones: Array<unknown>; dependencies: Array<unknown>; review_status: string;
  review_reason: string | null; limitations: Array<unknown>; created_at: string;
}
export interface StrategyEventRow { id: string; event_type: string; ref_id: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }

export async function fetchCorpStrategySummary(): Promise<CorpStrategySummary> {
  const { data, error } = await supabase.rpc('admin_corporate_strategy_summary');
  if (error) throw error;
  return (data as CorpStrategySummary | null) ?? {};
}
export async function createVisionRecord(p: { code: string; kind: string; statement: string; reason: string; effectiveFrom?: string | null; versionNote?: string | null }): Promise<{ ok: boolean; id: string; ai_generated: boolean }> {
  const { data, error } = await supabase.rpc('admin_vision_record_create', { p_code: p.code, p_kind: p.kind, p_statement: p.statement, p_reason: p.reason, p_effective_from: p.effectiveFrom ?? null, p_version_note: p.versionNote ?? null });
  if (error) throw error;
  return data as { ok: boolean; id: string; ai_generated: boolean };
}
export async function fetchVisionRecords(kind: string | null = null, limit = 50): Promise<VisionRecordRow[]> {
  const { data, error } = await supabase.rpc('admin_vision_records', { p_kind: kind, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as VisionRecordRow[];
}
export async function createCorpObjective(p: { code: string; kind: string; title: string; evidence: Array<Record<string, unknown>>; description?: string | null; visionId?: string | null; year?: number | null; quarter?: number | null; priority?: string; owner?: string | null; reviewCycle?: string; criteria?: Array<Record<string, unknown>>; initiativeIds?: string[]; priorityIds?: string[] }): Promise<{ ok: boolean; id: string; ai_generated: boolean; outcome_achieved: boolean }> {
  const { data, error } = await supabase.rpc('admin_corporate_objective_create', {
    p_code: p.code, p_kind: p.kind, p_title: p.title, p_evidence: p.evidence,
    p_description: p.description ?? null, p_vision_id: p.visionId ?? null, p_parent_id: null,
    p_year: p.year ?? null, p_quarter: p.quarter ?? null, p_priority: p.priority ?? 'unranked',
    p_owner: p.owner ?? null, p_review_cycle: p.reviewCycle ?? 'quarterly',
    p_criteria: p.criteria ?? [], p_initiative_ids: p.initiativeIds ?? [], p_priority_ids: p.priorityIds ?? [],
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; ai_generated: boolean; outcome_achieved: boolean };
}
export async function reviewCorpObjective(id: string, status: string, reason: string): Promise<{ ok: boolean; objective_status: string; warnings: Array<unknown> }> {
  const { data, error } = await supabase.rpc('admin_corporate_objective_review', { p_id: id, p_status: status, p_reason: reason });
  if (error) throw error;
  return data as { ok: boolean; objective_status: string; warnings: Array<unknown> };
}
export async function fetchCorpObjectives(kind: string | null = null, limit = 100): Promise<CorpObjectiveRow[]> {
  const { data, error } = await supabase.rpc('admin_corporate_objectives', { p_kind: kind, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as CorpObjectiveRow[];
}
export async function createRoadmapItem(p: { code: string; title: string; year: number; evidence: Array<Record<string, unknown>>; phase?: string; sequence?: number | null; summary?: string | null; objectiveIds?: string[]; milestones?: Array<Record<string, unknown>>; dependencies?: Array<Record<string, unknown>> }): Promise<{ ok: boolean; id: string; commitment_created: boolean }> {
  const { data, error } = await supabase.rpc('admin_roadmap_item_create', {
    p_code: p.code, p_title: p.title, p_year: p.year, p_evidence: p.evidence,
    p_phase: p.phase ?? 'planned', p_sequence: p.sequence ?? null, p_summary: p.summary ?? null,
    p_objective_ids: p.objectiveIds ?? [], p_milestones: p.milestones ?? [], p_dependencies: p.dependencies ?? [],
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; commitment_created: boolean };
}
export async function reviewRoadmapItem(id: string, status: string, reason: string, phase: string | null = null): Promise<{ ok: boolean; review_status: string; auto_changed: boolean }> {
  const { data, error } = await supabase.rpc('admin_roadmap_item_review', { p_id: id, p_status: status, p_reason: reason, p_phase: phase });
  if (error) throw error;
  return data as { ok: boolean; review_status: string; auto_changed: boolean };
}
export async function fetchRoadmapItems(year: number | null = null, limit = 100): Promise<RoadmapItemRow[]> {
  const { data, error } = await supabase.rpc('admin_roadmap_items', { p_year: year, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as RoadmapItemRow[];
}
export async function recordStrategyGovernance(kind: string, reason: string, payload: Record<string, unknown>, refId: string | null = null): Promise<{ ok: boolean; id: string; strategy_approved: boolean }> {
  const { data, error } = await supabase.rpc('admin_strategy_governance_record', { p_kind: kind, p_reason: reason, p_payload: payload, p_ref_id: refId });
  if (error) throw error;
  return data as { ok: boolean; id: string; strategy_approved: boolean };
}
export async function fetchStrategyAudit(limit = 200): Promise<StrategyEventRow[]> {
  const { data, error } = await supabase.rpc('admin_strategy_audit', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as StrategyEventRow[];
}

// ── Executive Performance (0525 — KPI Intelligence, 자동 생성·수정·목표 변경 없음) ──

export type PerformanceSummary = Record<string, number | string | boolean | Record<string, number> | Record<string, unknown> | Array<unknown> | null>;
export interface KpiDefinitionRow {
  id: string; kpi_code: string; title: string; description: string | null; measurement_source: string;
  unit: string | null; direction: string; hierarchy_level: string; parent_kpi_id: string | null;
  linked_objective_ids: string[]; review_cycle: string; target_value: number | null;
  target_rationale: string | null; target_set_at: string | null; kpi_status: string;
  reviewed_at: string | null; review_reason: string | null; warnings: Array<unknown>;
  evidence: Array<unknown>; unknown_factors: Array<unknown>; limitations: Array<unknown>;
  created_by: string | null; created_at: string;
}
export interface KpiSnapshotRow {
  id: string; kpi_id: string; period_kind: string; period_start: string | null; period_end: string | null;
  actual_value: number | null; target_value: number | null; forecast_value: number | null;
  source_kind: string; sample_size: number | null; evidence: Array<unknown>;
  unknown_factors: Array<unknown>; limitations: Array<unknown>; created_at: string;
}
export interface PerformanceTimelinePoint {
  day: string; new_members: number; listening_hours: number | null; play_starts: number;
  player_errors: number; active_stores: number;
}
export interface PerformanceEventRow { id: string; event_type: string; ref_id: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }

export async function fetchPerformanceSummary(): Promise<PerformanceSummary> {
  const { data, error } = await supabase.rpc('admin_performance_summary');
  if (error) throw error;
  return (data as PerformanceSummary | null) ?? {};
}
export async function createKpiDefinition(p: { code: string; title: string; source: string; evidence: Array<Record<string, unknown>>; description?: string | null; unit?: string | null; direction?: string; level?: string; parentId?: string | null; objectiveIds?: string[]; reviewCycle?: string }): Promise<{ ok: boolean; id: string; kpi_status: string; ai_generated: boolean }> {
  const { data, error } = await supabase.rpc('admin_kpi_definition_create', {
    p_code: p.code, p_title: p.title, p_source: p.source, p_evidence: p.evidence,
    p_description: p.description ?? null, p_unit: p.unit ?? null, p_direction: p.direction ?? 'unspecified',
    p_level: p.level ?? 'business_kpi', p_parent_id: p.parentId ?? null,
    p_objective_ids: p.objectiveIds ?? [], p_review_cycle: p.reviewCycle ?? 'monthly',
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; kpi_status: string; ai_generated: boolean };
}
export async function setKpiTarget(id: string, target: number | null, rationale: string): Promise<{ ok: boolean; target_value: number | null; auto_changed: boolean }> {
  const { data, error } = await supabase.rpc('admin_kpi_target_set', { p_id: id, p_target: target, p_rationale: rationale });
  if (error) throw error;
  return data as { ok: boolean; target_value: number | null; auto_changed: boolean };
}
export async function reviewKpiDefinition(id: string, status: string, reason: string): Promise<{ ok: boolean; kpi_status: string; warnings: Array<unknown> }> {
  const { data, error } = await supabase.rpc('admin_kpi_definition_review', { p_id: id, p_status: status, p_reason: reason });
  if (error) throw error;
  return data as { ok: boolean; kpi_status: string; warnings: Array<unknown> };
}
export async function fetchKpiDefinitions(status: string | null = null, limit = 100): Promise<KpiDefinitionRow[]> {
  const { data, error } = await supabase.rpc('admin_kpi_definitions', { p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as KpiDefinitionRow[];
}
export async function recordKpiSnapshot(p: { key: string; kpiId: string; periodKind: string; sourceKind: string; evidence: Array<Record<string, unknown>>; actual?: number | null; target?: number | null; forecast?: number | null; periodStart?: string | null; periodEnd?: string | null; sampleSize?: number | null }): Promise<{ ok: boolean; id: string; forecast_is_not_actual: boolean }> {
  const { data, error } = await supabase.rpc('admin_kpi_snapshot_record', {
    p_key: p.key, p_kpi_id: p.kpiId, p_period_kind: p.periodKind, p_source_kind: p.sourceKind, p_evidence: p.evidence,
    p_actual: p.actual ?? null, p_target: p.target ?? null, p_forecast: p.forecast ?? null,
    p_period_start: p.periodStart ?? null, p_period_end: p.periodEnd ?? null, p_sample_size: p.sampleSize ?? null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; forecast_is_not_actual: boolean };
}
export async function captureKpiSnapshot(key: string, kpiId: string, periodKind = 'monthly'): Promise<{ ok: boolean; id: string; actual_value: number | null; sample_size: number | null }> {
  const { data, error } = await supabase.rpc('admin_kpi_snapshot_capture', { p_key: key, p_kpi_id: kpiId, p_period_kind: periodKind });
  if (error) throw error;
  return data as { ok: boolean; id: string; actual_value: number | null; sample_size: number | null };
}
export async function fetchKpiSnapshots(kpiId: string | null = null, limit = 100): Promise<KpiSnapshotRow[]> {
  const { data, error } = await supabase.rpc('admin_kpi_snapshots', { p_kpi_id: kpiId, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as KpiSnapshotRow[];
}
export async function fetchPerformanceTimeline(days = 30): Promise<PerformanceTimelinePoint[]> {
  const { data, error } = await supabase.rpc('admin_performance_timeline', { p_days: days });
  if (error) throw error;
  return (data ?? []) as PerformanceTimelinePoint[];
}
export async function recordPerformanceGovernance(kind: string, reason: string, payload: Record<string, unknown>, refId: string | null = null): Promise<{ ok: boolean; id: string; kpi_changed: boolean; auto_sent: boolean }> {
  const { data, error } = await supabase.rpc('admin_performance_governance_record', { p_kind: kind, p_reason: reason, p_payload: payload, p_ref_id: refId });
  if (error) throw error;
  return data as { ok: boolean; id: string; kpi_changed: boolean; auto_sent: boolean };
}
export async function fetchPerformanceAudit(limit = 200): Promise<PerformanceEventRow[]> {
  const { data, error } = await supabase.rpc('admin_performance_audit', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as PerformanceEventRow[];
}

// ── Financial Intelligence (0526 — 회계 수정·예산 변경·지출/투자 승인 자동화 없음) ──

export type FinancialSummary = Record<string, number | string | boolean | Record<string, number> | Record<string, unknown> | Array<unknown> | null>;
export interface FinancialRecordRow {
  id: string; record_code: string; record_kind: string; title: string; description: string | null;
  amount: number | null; currency: string; period_kind: string; period_start: string | null;
  period_end: string | null; record_status: string; reviewed_at: string | null;
  review_reason: string | null; warnings: Array<unknown>; evidence: Array<unknown>;
  unknown_factors: Array<unknown>; limitations: Array<unknown>; created_by: string | null; created_at: string;
}
export interface FinancialSnapshotRow {
  id: string; metric_source: string; period_kind: string; period_start: string | null; period_end: string | null;
  actual_value: number | null; budget_value: number | null; forecast_value: number | null;
  source_kind: string; sample_size: number | null; evidence: Array<unknown>;
  unknown_factors: Array<unknown>; limitations: Array<unknown>; created_at: string;
}
export interface FinancialTimelinePoint {
  day: string; cash_inflow: number; paid_orders: number; failed_orders: number;
  cash_outflow_settlements: number; settlements_paid: number;
}
export interface FinancialEventRow { id: string; event_type: string; ref_id: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }

export async function fetchFinancialSummary(): Promise<FinancialSummary> {
  const { data, error } = await supabase.rpc('admin_financial_summary');
  if (error) throw error;
  return (data as FinancialSummary | null) ?? {};
}
export async function createFinancialRecord(p: { code: string; kind: string; title: string; evidence: Array<Record<string, unknown>>; description?: string | null; amount?: number | null; currency?: string; periodKind?: string; periodStart?: string | null; periodEnd?: string | null }): Promise<{ ok: boolean; id: string; accounting_modified: boolean; budget_changed: boolean }> {
  const { data, error } = await supabase.rpc('admin_financial_record_create', {
    p_code: p.code, p_kind: p.kind, p_title: p.title, p_evidence: p.evidence,
    p_description: p.description ?? null, p_amount: p.amount ?? null, p_currency: p.currency ?? 'KRW',
    p_period_kind: p.periodKind ?? 'monthly', p_period_start: p.periodStart ?? null, p_period_end: p.periodEnd ?? null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; accounting_modified: boolean; budget_changed: boolean };
}
export async function reviewFinancialRecord(id: string, status: string, reason: string): Promise<{ ok: boolean; record_status: string; warnings: Array<unknown>; spend_approved: boolean }> {
  const { data, error } = await supabase.rpc('admin_financial_record_review', { p_id: id, p_status: status, p_reason: reason });
  if (error) throw error;
  return data as { ok: boolean; record_status: string; warnings: Array<unknown>; spend_approved: boolean };
}
export async function fetchFinancialRecords(kind: string | null = null, limit = 100): Promise<FinancialRecordRow[]> {
  const { data, error } = await supabase.rpc('admin_financial_records', { p_kind: kind, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as FinancialRecordRow[];
}
export async function recordFinancialSnapshot(p: { key: string; source: string; periodKind: string; sourceKind: string; evidence: Array<Record<string, unknown>>; actual?: number | null; budget?: number | null; forecast?: number | null; periodStart?: string | null; periodEnd?: string | null; sampleSize?: number | null }): Promise<{ ok: boolean; id: string; forecast_is_not_actual: boolean }> {
  const { data, error } = await supabase.rpc('admin_financial_snapshot_record', {
    p_key: p.key, p_source: p.source, p_period_kind: p.periodKind, p_source_kind: p.sourceKind, p_evidence: p.evidence,
    p_actual: p.actual ?? null, p_budget: p.budget ?? null, p_forecast: p.forecast ?? null,
    p_period_start: p.periodStart ?? null, p_period_end: p.periodEnd ?? null, p_sample_size: p.sampleSize ?? null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; forecast_is_not_actual: boolean };
}
export async function captureFinancialSnapshot(key: string, source: string, periodKind = 'monthly'): Promise<{ ok: boolean; id: string; actual_value: number | null; sample_size: number | null }> {
  const { data, error } = await supabase.rpc('admin_financial_snapshot_capture', { p_key: key, p_source: source, p_period_kind: periodKind });
  if (error) throw error;
  return data as { ok: boolean; id: string; actual_value: number | null; sample_size: number | null };
}
export async function fetchFinancialSnapshots(source: string | null = null, limit = 100): Promise<FinancialSnapshotRow[]> {
  const { data, error } = await supabase.rpc('admin_financial_snapshots', { p_source: source, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as FinancialSnapshotRow[];
}
export async function fetchFinancialTimeline(days = 30): Promise<FinancialTimelinePoint[]> {
  const { data, error } = await supabase.rpc('admin_financial_timeline', { p_days: days });
  if (error) throw error;
  return (data ?? []) as FinancialTimelinePoint[];
}
export async function recordFinancialGovernance(kind: string, reason: string, payload: Record<string, unknown>, refId: string | null = null): Promise<{ ok: boolean; id: string; budget_changed: boolean; spend_approved: boolean; auto_sent: boolean }> {
  const { data, error } = await supabase.rpc('admin_financial_governance_record', { p_kind: kind, p_reason: reason, p_payload: payload, p_ref_id: refId });
  if (error) throw error;
  return data as { ok: boolean; id: string; budget_changed: boolean; spend_approved: boolean; auto_sent: boolean };
}
export async function fetchFinancialAudit(limit = 200): Promise<FinancialEventRow[]> {
  const { data, error } = await supabase.rpc('admin_financial_audit', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as FinancialEventRow[];
}

// ── Market Intelligence (0527 — 자동 경쟁사 생성·시장 분석 확정 없음) ──

export type MarketSummary = Record<string, number | string | boolean | Record<string, number> | Record<string, unknown> | Array<unknown> | null>;
export interface MarketCompetitorRow {
  id: string; competitor_code: string; name: string; category: string | null; region: string | null;
  position_reference: string | null; capability_notes: Array<unknown>; data_availability: string;
  record_status: string; reviewed_at: string | null; review_reason: string | null;
  warnings: Array<unknown>; evidence: Array<unknown>; unknown_factors: Array<unknown>;
  limitations: Array<unknown>; created_by: string | null; created_at: string;
}
export interface MarketSignalRow {
  id: string; signal_code: string; signal_kind: string; title: string; detail: string | null;
  region: string | null; category: string | null; observed_at: string | null; signal_status: string;
  reviewed_at: string | null; review_reason: string | null; warnings: Array<unknown>;
  evidence: Array<unknown>; unknown_factors: Array<unknown>; limitations: Array<unknown>; created_at: string;
}
export interface MarketCategoryPoint { day: string; category: string; plays: number }
export interface MarketEventRow { id: string; event_type: string; ref_id: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }

export async function fetchMarketSummary(): Promise<MarketSummary> {
  const { data, error } = await supabase.rpc('admin_market_summary');
  if (error) throw error;
  return (data as MarketSummary | null) ?? {};
}
export async function createMarketCompetitor(p: { code: string; name: string; evidence: Array<Record<string, unknown>>; category?: string | null; region?: string | null; position?: string | null; capabilities?: Array<Record<string, unknown>>; externalData?: boolean }): Promise<{ ok: boolean; id: string; ai_generated: boolean; threat_claimed: boolean }> {
  const { data, error } = await supabase.rpc('admin_market_competitor_create', {
    p_code: p.code, p_name: p.name, p_evidence: p.evidence,
    p_category: p.category ?? null, p_region: p.region ?? null, p_position: p.position ?? null,
    p_capabilities: p.capabilities ?? [], p_external_data: p.externalData ?? false,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; ai_generated: boolean; threat_claimed: boolean };
}
export async function observeMarketCompetitor(id: string, note: string, payload: Record<string, unknown> = {}): Promise<{ ok: boolean; id: string; fact_confirmed: boolean }> {
  const { data, error } = await supabase.rpc('admin_market_competitor_observe', { p_id: id, p_note: note, p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; id: string; fact_confirmed: boolean };
}
export async function reviewMarketCompetitor(id: string, status: string, reason: string): Promise<{ ok: boolean; record_status: string; warnings: Array<unknown> }> {
  const { data, error } = await supabase.rpc('admin_market_competitor_review', { p_id: id, p_status: status, p_reason: reason });
  if (error) throw error;
  return data as { ok: boolean; record_status: string; warnings: Array<unknown> };
}
export async function fetchMarketCompetitors(status: string | null = null, limit = 100): Promise<MarketCompetitorRow[]> {
  const { data, error } = await supabase.rpc('admin_market_competitors', { p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as MarketCompetitorRow[];
}
export async function recordMarketSignal(p: { code: string; kind: string; title: string; evidence: Array<Record<string, unknown>>; detail?: string | null; region?: string | null; category?: string | null; observedAt?: string | null }): Promise<{ ok: boolean; id: string; signal_status: string; fact_confirmed: boolean }> {
  const { data, error } = await supabase.rpc('admin_market_signal_record', {
    p_code: p.code, p_kind: p.kind, p_title: p.title, p_evidence: p.evidence,
    p_detail: p.detail ?? null, p_region: p.region ?? null, p_category: p.category ?? null, p_observed_at: p.observedAt ?? null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; signal_status: string; fact_confirmed: boolean };
}
export async function reviewMarketSignal(id: string, status: string, reason: string, additionalEvidence: Array<Record<string, unknown>> | null = null): Promise<{ ok: boolean; signal_status: string; warnings: Array<unknown>; fact_confirmed: boolean }> {
  const { data, error } = await supabase.rpc('admin_market_signal_review', { p_id: id, p_status: status, p_reason: reason, p_additional_evidence: additionalEvidence });
  if (error) throw error;
  return data as { ok: boolean; signal_status: string; warnings: Array<unknown>; fact_confirmed: boolean };
}
export async function fetchMarketSignals(kind: string | null = null, limit = 100): Promise<MarketSignalRow[]> {
  const { data, error } = await supabase.rpc('admin_market_signals', { p_kind: kind, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as MarketSignalRow[];
}
export async function fetchMarketCategoryTimeline(days = 30): Promise<MarketCategoryPoint[]> {
  const { data, error } = await supabase.rpc('admin_market_category_timeline', { p_days: days });
  if (error) throw error;
  return (data ?? []) as MarketCategoryPoint[];
}
export async function recordMarketGovernance(kind: string, reason: string, payload: Record<string, unknown>, refId: string | null = null): Promise<{ ok: boolean; id: string; market_conclusion_confirmed: boolean; auto_sent: boolean }> {
  const { data, error } = await supabase.rpc('admin_market_governance_record', { p_kind: kind, p_reason: reason, p_payload: payload, p_ref_id: refId });
  if (error) throw error;
  return data as { ok: boolean; id: string; market_conclusion_confirmed: boolean; auto_sent: boolean };
}
export async function fetchMarketAudit(limit = 200): Promise<MarketEventRow[]> {
  const { data, error } = await supabase.rpc('admin_market_audit', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as MarketEventRow[];
}

// ── Risk & Resilience (0528 — 자동 Incident 생성·Risk 종료·서비스 중단 없음) ──

export type RiskSummary = Record<string, number | string | boolean | Record<string, number> | Record<string, unknown> | Array<unknown> | null>;
export interface RiskRegisterRow {
  id: string; risk_code: string; risk_category: string; title: string; description: string | null;
  likelihood_reference: number | null; impact_reference: number | null;
  linked_risk_ids: string[]; linked_incident_ids: string[]; controls: Array<Record<string, unknown>>;
  risk_status: string; reviewed_at: string | null; review_reason: string | null;
  closure_evidence: Array<unknown> | null; warnings: Array<unknown>; evidence: Array<unknown>;
  unknown_factors: Array<unknown>; limitations: Array<unknown>; created_by: string | null; created_at: string;
}
export interface RiskEventRow { id: string; event_type: string; ref_id: string | null; stage: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }

export async function fetchRiskSummary(): Promise<RiskSummary> {
  const { data, error } = await supabase.rpc('admin_risk_summary');
  if (error) throw error;
  return (data as RiskSummary | null) ?? {};
}
export async function createRiskRegisterEntry(p: { code: string; category: string; title: string; evidence: Array<Record<string, unknown>>; description?: string | null; likelihood?: number | null; impact?: number | null; linkedRiskIds?: string[]; linkedIncidentIds?: string[]; controls?: Array<Record<string, unknown>> }): Promise<{ ok: boolean; id: string; risk_status: string; incident_created: boolean }> {
  const { data, error } = await supabase.rpc('admin_risk_register_create', {
    p_code: p.code, p_category: p.category, p_title: p.title, p_evidence: p.evidence,
    p_description: p.description ?? null, p_likelihood: p.likelihood ?? null, p_impact: p.impact ?? null,
    p_linked_risk_ids: p.linkedRiskIds ?? [], p_linked_incident_ids: p.linkedIncidentIds ?? [], p_controls: p.controls ?? [],
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; risk_status: string; incident_created: boolean };
}
export async function reviewRiskRegisterEntry(id: string, status: string, reason: string, closureEvidence: Array<Record<string, unknown>> | null = null): Promise<{ ok: boolean; risk_status: string; warnings: Array<unknown>; auto_closed: boolean }> {
  const { data, error } = await supabase.rpc('admin_risk_register_review', { p_id: id, p_status: status, p_reason: reason, p_closure_evidence: closureEvidence });
  if (error) throw error;
  return data as { ok: boolean; risk_status: string; warnings: Array<unknown>; auto_closed: boolean };
}
export async function fetchRiskRegister(category: string | null = null, limit = 100): Promise<RiskRegisterRow[]> {
  const { data, error } = await supabase.rpc('admin_risk_register_list', { p_category: category, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as RiskRegisterRow[];
}
export async function recordRiskTimeline(riskId: string, stage: string, note: string): Promise<{ ok: boolean; id: string; stage: string; stage_completed_guarantee: boolean }> {
  const { data, error } = await supabase.rpc('admin_risk_timeline_record', { p_risk_id: riskId, p_stage: stage, p_note: note });
  if (error) throw error;
  return data as { ok: boolean; id: string; stage: string; stage_completed_guarantee: boolean };
}
export async function recordRiskGovernance(kind: string, reason: string, payload: Record<string, unknown>, refId: string | null = null): Promise<{ ok: boolean; id: string; risk_resolved: boolean; service_stopped: boolean; auto_sent: boolean }> {
  const { data, error } = await supabase.rpc('admin_risk_governance_record', { p_kind: kind, p_reason: reason, p_payload: payload, p_ref_id: refId });
  if (error) throw error;
  return data as { ok: boolean; id: string; risk_resolved: boolean; service_stopped: boolean; auto_sent: boolean };
}
export async function fetchRiskAudit(limit = 200): Promise<RiskEventRow[]> {
  const { data, error } = await supabase.rpc('admin_risk_audit', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as RiskEventRow[];
}

// ── Resource & Capacity (0529 — 자동 증설·축소·인프라/모델 변경 없음) ──

export type ResourceSummary = Record<string, number | string | boolean | Record<string, number> | Record<string, unknown> | Array<unknown> | null>;
export interface ResourceRegistryRow {
  id: string; resource_code: string; resource_kind: string; title: string; description: string | null;
  provider: string | null; capacity_reference: number | null; capacity_unit: string | null;
  linked_metric_ids: string[]; resource_status: string; reviewed_at: string | null;
  review_reason: string | null; warnings: Array<unknown>; evidence: Array<unknown>;
  unknown_factors: Array<unknown>; limitations: Array<unknown>; created_by: string | null; created_at: string;
}
export interface ResourceUsagePoint { day: string; playback_events: number; play_starts: number; distinct_sessions: number }
export interface ResourceEventRow { id: string; event_type: string; ref_id: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }

export async function fetchResourceSummary(): Promise<ResourceSummary> {
  const { data, error } = await supabase.rpc('admin_resource_summary');
  if (error) throw error;
  return (data as ResourceSummary | null) ?? {};
}
export async function createResourceRegistryEntry(p: { code: string; kind: string; title: string; evidence: Array<Record<string, unknown>>; description?: string | null; provider?: string | null; capacity?: number | null; unit?: string | null; metricIds?: string[] }): Promise<{ ok: boolean; id: string; resource_status: string; infra_changed: boolean }> {
  const { data, error } = await supabase.rpc('admin_resource_register_create', {
    p_code: p.code, p_kind: p.kind, p_title: p.title, p_evidence: p.evidence,
    p_description: p.description ?? null, p_provider: p.provider ?? null,
    p_capacity: p.capacity ?? null, p_unit: p.unit ?? null, p_metric_ids: p.metricIds ?? [],
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; resource_status: string; infra_changed: boolean };
}
export async function reviewResourceRegistryEntry(id: string, status: string, reason: string): Promise<{ ok: boolean; resource_status: string; warnings: Array<unknown>; infra_changed: boolean }> {
  const { data, error } = await supabase.rpc('admin_resource_register_review', { p_id: id, p_status: status, p_reason: reason });
  if (error) throw error;
  return data as { ok: boolean; resource_status: string; warnings: Array<unknown>; infra_changed: boolean };
}
export async function fetchResourceRegistry(kind: string | null = null, limit = 100): Promise<ResourceRegistryRow[]> {
  const { data, error } = await supabase.rpc('admin_resource_register_list', { p_kind: kind, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ResourceRegistryRow[];
}
export async function fetchResourceUsageTimeline(days = 30): Promise<ResourceUsagePoint[]> {
  const { data, error } = await supabase.rpc('admin_resource_usage_timeline', { p_days: days });
  if (error) throw error;
  return (data ?? []) as ResourceUsagePoint[];
}
export async function recordResourceGovernance(kind: string, reason: string, payload: Record<string, unknown>, refId: string | null = null): Promise<{ ok: boolean; id: string; scaled: boolean; infra_changed: boolean; auto_sent: boolean }> {
  const { data, error } = await supabase.rpc('admin_resource_governance_record', { p_kind: kind, p_reason: reason, p_payload: payload, p_ref_id: refId });
  if (error) throw error;
  return data as { ok: boolean; id: string; scaled: boolean; infra_changed: boolean; auto_sent: boolean };
}
export async function fetchResourceAudit(limit = 200): Promise<ResourceEventRow[]> {
  const { data, error } = await supabase.rpc('admin_resource_audit', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ResourceEventRow[];
}

// ── Ecosystem & Partner (0530 — 자동 파트너 등록·계약/API/공급사 변경 없음) ──

export type EcosystemSummary = Record<string, number | string | boolean | Record<string, number> | Record<string, unknown> | Array<unknown> | null>;
export interface PartnerRegistryRow {
  id: string; partner_code: string; partner_kind: string; name: string; description: string | null;
  provider_reference: string | null; linked_dependency_ids: string[]; partner_status: string;
  reviewed_at: string | null; review_reason: string | null; warnings: Array<unknown>;
  evidence: Array<unknown>; unknown_factors: Array<unknown>; limitations: Array<unknown>;
  created_by: string | null; created_at: string;
}
export interface EcosystemDependencyRow {
  id: string; dependency_code: string; domain: string; provider: string; service_name: string;
  dependency_type: string; criticality: string; failure_impact: string | null;
  fallback_available: boolean | null; fallback_description: string | null;
  rto_target: string; rpo_target: string; monitoring_source: string | null; owner: string | null;
  lifecycle_status: string; created_at: string;
}
export interface EcosystemEventRow { id: string; event_type: string; ref_id: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }

export async function fetchEcosystemSummary(): Promise<EcosystemSummary> {
  const { data, error } = await supabase.rpc('admin_ecosystem_summary');
  if (error) throw error;
  return (data as EcosystemSummary | null) ?? {};
}
export async function createPartnerRegistryEntry(p: { code: string; kind: string; name: string; evidence: Array<Record<string, unknown>>; description?: string | null; provider?: string | null; dependencyIds?: string[] }): Promise<{ ok: boolean; id: string; partner_status: string; contract_changed: boolean }> {
  const { data, error } = await supabase.rpc('admin_partner_register_create', {
    p_code: p.code, p_kind: p.kind, p_name: p.name, p_evidence: p.evidence,
    p_description: p.description ?? null, p_provider: p.provider ?? null, p_dependency_ids: p.dependencyIds ?? [],
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; partner_status: string; contract_changed: boolean };
}
export async function reviewPartnerRegistryEntry(id: string, status: string, reason: string): Promise<{ ok: boolean; partner_status: string; warnings: Array<unknown>; contract_changed: boolean }> {
  const { data, error } = await supabase.rpc('admin_partner_register_review', { p_id: id, p_status: status, p_reason: reason });
  if (error) throw error;
  return data as { ok: boolean; partner_status: string; warnings: Array<unknown>; contract_changed: boolean };
}
export async function fetchPartnerRegistry(kind: string | null = null, limit = 100): Promise<PartnerRegistryRow[]> {
  const { data, error } = await supabase.rpc('admin_partner_register_list', { p_kind: kind, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as PartnerRegistryRow[];
}
export async function fetchEcosystemDependencies(domain: string | null = null, limit = 100): Promise<EcosystemDependencyRow[]> {
  const { data, error } = await supabase.rpc('admin_ecosystem_dependencies', { p_domain: domain, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as EcosystemDependencyRow[];
}
export async function recordEcosystemGovernance(kind: string, reason: string, payload: Record<string, unknown>, refId: string | null = null): Promise<{ ok: boolean; id: string; contract_changed: boolean; api_changed: boolean; auto_sent: boolean }> {
  const { data, error } = await supabase.rpc('admin_ecosystem_governance_record', { p_kind: kind, p_reason: reason, p_payload: payload, p_ref_id: refId });
  if (error) throw error;
  return data as { ok: boolean; id: string; contract_changed: boolean; api_changed: boolean; auto_sent: boolean };
}
export async function fetchEcosystemAudit(limit = 200): Promise<EcosystemEventRow[]> {
  const { data, error } = await supabase.rpc('admin_ecosystem_audit', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as EcosystemEventRow[];
}

// ── Knowledge Evolution (0531 — Best Practice 자동 등록·Knowledge 자동 삭제 없음) ──

export type KnowledgeSummary = Record<string, number | string | boolean | Record<string, number> | Record<string, unknown> | Array<unknown> | null>;
export interface OrgMemoryRow {
  id: string; memory_code: string; memory_kind: string; title: string; content: string | null;
  confidence_reference: string; linked_decision_ids: string[]; linked_memory_ids: string[];
  memory_status: string; revision_count: number; reviewed_at: string | null; review_reason: string | null;
  warnings: Array<unknown>; evidence: Array<unknown>; unknown_factors: Array<unknown>;
  limitations: Array<unknown>; created_by: string | null; created_at: string; updated_at: string;
}
export interface KnowledgeEventRow { id: string; event_type: string; ref_id: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }

export async function fetchKnowledgeSummary(): Promise<KnowledgeSummary> {
  const { data, error } = await supabase.rpc('admin_knowledge_summary');
  if (error) throw error;
  return (data as KnowledgeSummary | null) ?? {};
}
export async function createOrgMemory(p: { code: string; kind: string; title: string; evidence: Array<Record<string, unknown>>; content?: string | null; decisionIds?: string[]; memoryIds?: string[] }): Promise<{ ok: boolean; id: string; memory_status: string; auto_registered: boolean }> {
  const { data, error } = await supabase.rpc('admin_org_memory_create', {
    p_code: p.code, p_kind: p.kind, p_title: p.title, p_evidence: p.evidence,
    p_content: p.content ?? null, p_decision_ids: p.decisionIds ?? [], p_memory_ids: p.memoryIds ?? [],
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; memory_status: string; auto_registered: boolean };
}
export async function reviewOrgMemory(id: string, status: string, reason: string, confidence: string | null = null): Promise<{ ok: boolean; memory_status: string; warnings: Array<unknown>; auto_deleted: boolean }> {
  const { data, error } = await supabase.rpc('admin_org_memory_review', { p_id: id, p_status: status, p_reason: reason, p_confidence: confidence });
  if (error) throw error;
  return data as { ok: boolean; memory_status: string; warnings: Array<unknown>; auto_deleted: boolean };
}
export async function reviseOrgMemory(id: string, title: string | null, content: string | null, reason: string): Promise<{ ok: boolean; revised: boolean; human_approved_revision: boolean }> {
  const { data, error } = await supabase.rpc('admin_org_memory_revise', { p_id: id, p_title: title, p_content: content, p_reason: reason });
  if (error) throw error;
  return data as { ok: boolean; revised: boolean; human_approved_revision: boolean };
}
export async function fetchOrgMemories(kind: string | null = null, limit = 100): Promise<OrgMemoryRow[]> {
  const { data, error } = await supabase.rpc('admin_org_memory_list', { p_kind: kind, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as OrgMemoryRow[];
}
export async function recordKnowledgeGovernance(kind: string, reason: string, payload: Record<string, unknown>, refId: string | null = null): Promise<{ ok: boolean; id: string; best_practice_registered: boolean; knowledge_deleted: boolean; auto_sent: boolean }> {
  const { data, error } = await supabase.rpc('admin_knowledge_governance_record', { p_kind: kind, p_reason: reason, p_payload: payload, p_ref_id: refId });
  if (error) throw error;
  return data as { ok: boolean; id: string; best_practice_registered: boolean; knowledge_deleted: boolean; auto_sent: boolean };
}
export async function fetchKnowledgeAudit(limit = 200): Promise<KnowledgeEventRow[]> {
  const { data, error } = await supabase.rpc('admin_knowledge_audit', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as KnowledgeEventRow[];
}

// ── Learning Intelligence (0532 — Improvement/Optimization 자동 적용·정책 변경 없음) ──

export type LearningSummary = Record<string, number | string | boolean | Record<string, number> | Record<string, unknown> | Array<unknown> | null>;
export interface LearningRegistryRow {
  id: string; learning_code: string; learning_kind: string; optimization_domain: string | null;
  title: string; content: string | null; linked_memory_ids: string[]; linked_learning_ids: string[];
  learning_status: string; adoption_recorded: boolean; reviewed_at: string | null;
  review_reason: string | null; warnings: Array<unknown>; evidence: Array<unknown>;
  unknown_factors: Array<unknown>; limitations: Array<unknown>; created_by: string | null;
  created_at: string; updated_at: string;
}
export interface LearningEventRow { id: string; event_type: string; ref_id: string | null; stage: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }

export async function fetchLearningSummary(): Promise<LearningSummary> {
  const { data, error } = await supabase.rpc('admin_learning_summary');
  if (error) throw error;
  return (data as LearningSummary | null) ?? {};
}
export async function createLearningEntry(p: { code: string; kind: string; title: string; evidence: Array<Record<string, unknown>>; content?: string | null; domain?: string | null; memoryIds?: string[]; learningIds?: string[] }): Promise<{ ok: boolean; id: string; learning_status: string; auto_applied: boolean }> {
  const { data, error } = await supabase.rpc('admin_learning_register_create', {
    p_code: p.code, p_kind: p.kind, p_title: p.title, p_evidence: p.evidence,
    p_content: p.content ?? null, p_domain: p.domain ?? null,
    p_memory_ids: p.memoryIds ?? [], p_learning_ids: p.learningIds ?? [],
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; learning_status: string; auto_applied: boolean };
}
export async function reviewLearningEntry(id: string, status: string, reason: string): Promise<{ ok: boolean; learning_status: string; warnings: Array<unknown>; auto_applied: boolean }> {
  const { data, error } = await supabase.rpc('admin_learning_register_review', { p_id: id, p_status: status, p_reason: reason });
  if (error) throw error;
  return data as { ok: boolean; learning_status: string; warnings: Array<unknown>; auto_applied: boolean };
}
export async function recordLearningAdoption(id: string, reason: string): Promise<{ ok: boolean; adoption_recorded: boolean; human_approved: boolean; outcome_guaranteed: boolean }> {
  const { data, error } = await supabase.rpc('admin_learning_adoption_record', { p_id: id, p_reason: reason });
  if (error) throw error;
  return data as { ok: boolean; adoption_recorded: boolean; human_approved: boolean; outcome_guaranteed: boolean };
}
export async function fetchLearningRegistry(kind: string | null = null, limit = 100): Promise<LearningRegistryRow[]> {
  const { data, error } = await supabase.rpc('admin_learning_register_list', { p_kind: kind, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as LearningRegistryRow[];
}
export async function recordLearningTimeline(learningId: string, stage: string, note: string): Promise<{ ok: boolean; id: string; stage: string; stage_completed_guarantee: boolean }> {
  const { data, error } = await supabase.rpc('admin_learning_timeline_record', { p_learning_id: learningId, p_stage: stage, p_note: note });
  if (error) throw error;
  return data as { ok: boolean; id: string; stage: string; stage_completed_guarantee: boolean };
}
export async function recordLearningGovernance(kind: string, reason: string, payload: Record<string, unknown>, refId: string | null = null): Promise<{ ok: boolean; id: string; improvement_applied: boolean; optimization_applied: boolean; auto_sent: boolean }> {
  const { data, error } = await supabase.rpc('admin_learning_governance_record', { p_kind: kind, p_reason: reason, p_payload: payload, p_ref_id: refId });
  if (error) throw error;
  return data as { ok: boolean; id: string; improvement_applied: boolean; optimization_applied: boolean; auto_sent: boolean };
}
export async function fetchLearningAudit(limit = 200): Promise<LearningEventRow[]> {
  const { data, error } = await supabase.rpc('admin_learning_audit', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as LearningEventRow[];
}

// ── Executive AI OS (0533 — 최종 통합 레이어, 자동 Executive Decision 없음) ──

export type ExecutiveOsSummary = Record<string, number | string | boolean | Record<string, number> | Record<string, unknown> | Array<unknown> | null>;
export interface ExecutiveOsEventRow { id: string; event_type: string; ref_id: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }

export async function fetchExecutiveOsSummary(): Promise<ExecutiveOsSummary> {
  const { data, error } = await supabase.rpc('admin_executive_os_summary');
  if (error) throw error;
  return (data as ExecutiveOsSummary | null) ?? {};
}
export async function recordExecutiveOsGovernance(kind: string, reason: string, payload: Record<string, unknown>, refId: string | null = null): Promise<{ ok: boolean; id: string; executive_decision_made: boolean; strategy_changed: boolean; auto_sent: boolean }> {
  const { data, error } = await supabase.rpc('admin_executive_os_governance_record', { p_kind: kind, p_reason: reason, p_payload: payload, p_ref_id: refId });
  if (error) throw error;
  return data as { ok: boolean; id: string; executive_decision_made: boolean; strategy_changed: boolean; auto_sent: boolean };
}
export async function fetchExecutiveOsAudit(limit = 200): Promise<ExecutiveOsEventRow[]> {
  const { data, error } = await supabase.rpc('admin_executive_os_audit', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ExecutiveOsEventRow[];
}

// ── Governance Orchestration (0534 — Multi-Agent 조율/Human Oversight, 자동 승인 없음) ──

export type OrchestrationSummary = Record<string, number | string | boolean | Record<string, number> | Record<string, unknown> | Array<unknown> | null>;
export interface OrchestrationAgentRow { id: string; agent_kind: string; agent_name: string; agent_status: string; note: string | null; linked_source: string | null; idempotency_key: string | null; created_by: string | null; created_at: string; updated_at: string }
export interface OrchestrationEventRow { id: string; event_type: string; agent_id: string | null; workflow_key: string | null; workflow_stage: string | null; oversight_status: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }

export async function fetchOrchestrationSummary(): Promise<OrchestrationSummary> {
  const { data, error } = await supabase.rpc('admin_orchestration_summary');
  if (error) throw error;
  return (data as OrchestrationSummary | null) ?? {};
}
export async function fetchOrchestrationAgents(limit = 200): Promise<OrchestrationAgentRow[]> {
  const { data, error } = await supabase.rpc('admin_orchestration_agents', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as OrchestrationAgentRow[];
}
export async function registerOrchestrationAgent(kind: string, name: string, note: string | null = null, linkedSource: string | null = null): Promise<{ ok: boolean; id: string; auto_created: boolean; initial_status: string }> {
  const { data, error } = await supabase.rpc('admin_orchestration_agent_register', { p_kind: kind, p_name: name, p_note: note, p_linked_source: linkedSource, p_idempotency_key: null });
  if (error) throw error;
  return data as { ok: boolean; id: string; auto_created: boolean; initial_status: string };
}
export async function setOrchestrationAgentStatus(agentId: string, status: string, reason: string): Promise<{ ok: boolean; before: string; after: string; auto_approved: boolean }> {
  const { data, error } = await supabase.rpc('admin_orchestration_agent_set_status', { p_agent_id: agentId, p_status: status, p_reason: reason });
  if (error) throw error;
  return data as { ok: boolean; before: string; after: string; auto_approved: boolean };
}
export async function recordOrchestrationEvent(kind: string, reason: string, payload: Record<string, unknown>, opts: { agentId?: string | null; workflowKey?: string | null; workflowStage?: string | null; oversightStatus?: string | null } = {}): Promise<{ ok: boolean; id: string; auto_approved: boolean; human_decision_required: boolean }> {
  const { data, error } = await supabase.rpc('admin_orchestration_event_record', {
    p_kind: kind, p_reason: reason, p_payload: payload,
    p_agent_id: opts.agentId ?? null, p_workflow_key: opts.workflowKey ?? null,
    p_workflow_stage: opts.workflowStage ?? null, p_oversight_status: opts.oversightStatus ?? null,
  });
  if (error) throw error;
  return data as { ok: boolean; id: string; auto_approved: boolean; human_decision_required: boolean };
}
export async function fetchOrchestrationAudit(limit = 200): Promise<OrchestrationEventRow[]> {
  const { data, error } = await supabase.rpc('admin_orchestration_audit', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as OrchestrationEventRow[];
}

// ── Execution Gateway (0535 — Controlled Execution·자동 실행 없음) ──

export type ExecutionGatewaySummary = Record<string, number | string | boolean | Record<string, number> | Record<string, unknown> | Array<unknown> | null>;
export interface ExecutionRequestRow { id: string; execution_code: string; request_type: string; execution_domain: string; execution_mode: string; execution_status: string; title: string; execution_summary: string | null; requested_action: string | null; target_system: string | null; target_resource_type: string | null; target_resource_id: string | null; scope_type: string; scope_id: string | null; requested_parameters: Record<string, unknown>; expected_result: string | null; expected_evidence: string | null; risk_level: string; reversibility_status: string; dry_run_required: boolean; sandbox_required: boolean; observation_required: boolean; rollback_required: boolean; approval_reference_id: string | null; governance_reference_id: string | null; source_agent_id: string | null; commitment_id: string | null; preconditions: unknown[]; assumptions: unknown[]; unknown_factors: unknown[]; limitations: unknown[]; requested_by: string | null; reviewed_by: string | null; created_at: string; updated_at: string }
export interface ExecutionCapabilityRow { id: string; capability_code: string; capability_domain: string; connector_type: string; action_type: string | null; execution_mode: string; environment_scope: string; supports_dry_run: boolean; supports_sandbox: boolean; supports_idempotency: boolean; supports_retry: boolean; supports_cancellation: boolean; supports_rollback_reference: boolean; requires_human_approval: boolean; requires_secondary_review: boolean; max_payload_size: number; timeout_seconds: number; retry_limit: number; status: string; limitations: unknown[]; created_at: string; updated_at: string }
export interface ExecutionGatewayEventRow { id: string; event_type: string; execution_request_id: string; capability_id: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }

export async function fetchExecutionGatewaySummary(): Promise<ExecutionGatewaySummary> {
  const { data, error } = await supabase.rpc('admin_execution_gateway_summary');
  if (error) throw error;
  return (data as ExecutionGatewaySummary | null) ?? {};
}
export async function fetchExecutionRequests(status: string | null = null, limit = 200): Promise<ExecutionRequestRow[]> {
  const { data, error } = await supabase.rpc('admin_execution_requests', { p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ExecutionRequestRow[];
}
export async function createExecutionRequest(payload: Record<string, unknown>): Promise<{ ok: boolean; id: string; initial_status: string; request_is_not_execution: boolean; executed: boolean }> {
  const { data, error } = await supabase.rpc('admin_execution_request_create', { p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; id: string; initial_status: string; request_is_not_execution: boolean; executed: boolean };
}
export async function reviewExecutionRequest(requestId: string, action: string, reason: string, payload: Record<string, unknown> = {}): Promise<{ ok: boolean; status: string; executed: boolean; auto_approved: boolean }> {
  const { data, error } = await supabase.rpc('admin_execution_request_review', { p_request_id: requestId, p_action: action, p_reason: reason, p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; status: string; executed: boolean; auto_approved: boolean };
}
export async function fetchExecutionCapabilities(limit = 200): Promise<ExecutionCapabilityRow[]> {
  const { data, error } = await supabase.rpc('admin_execution_capabilities', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ExecutionCapabilityRow[];
}
export async function recordExecutionCapability(payload: Record<string, unknown>): Promise<{ ok: boolean; id: string; requires_human_approval: boolean; connector_executed: boolean }> {
  const { data, error } = await supabase.rpc('admin_execution_capability_record', { p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; id: string; requires_human_approval: boolean; connector_executed: boolean };
}
export async function recordExecutionEvent(kind: string, requestId: string, reason: string, payload: Record<string, unknown>, capabilityId: string | null = null): Promise<{ ok: boolean; id: string; connector_executed: boolean; auto_retry: boolean; production_applied: boolean }> {
  const { data, error } = await supabase.rpc('admin_execution_event_record', { p_kind: kind, p_request_id: requestId, p_reason: reason, p_payload: payload, p_capability_id: capabilityId });
  if (error) throw error;
  return data as { ok: boolean; id: string; connector_executed: boolean; auto_retry: boolean; production_applied: boolean };
}
export async function fetchExecutionGatewayAudit(limit = 200): Promise<ExecutionGatewayEventRow[]> {
  const { data, error } = await supabase.rpc('admin_execution_gateway_audit', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ExecutionGatewayEventRow[];
}

// ── Connector Runtime Control (0536 — Supervised Runtime·자동 Connector 실행 없음) ──

export type RuntimeControlSummary = Record<string, number | string | boolean | Record<string, number> | Record<string, unknown> | Array<unknown> | null>;
export interface ConnectorDefinitionRow { id: string; connector_code: string; connector_name: string; connector_domain: string; provider: string; supports_read: boolean; supports_draft: boolean; supports_write: boolean; supports_dry_run: boolean; supports_sandbox: boolean; supports_idempotency: boolean; supports_retry: boolean; supports_pause: boolean; supports_cancellation: boolean; supports_cleanup: boolean; supports_rollback_reference: boolean; requires_human_approval: boolean; requires_secondary_approval: boolean; requires_sensitive_data_access: boolean; requires_secret_access: boolean; max_payload_size: number; timeout_seconds: number; retry_limit: number; status: string; limitations: unknown[]; created_at: string; updated_at: string }
export interface ConnectorInstanceRow { id: string; connector_definition_id: string; instance_code: string; environment_scope: string; scope_type: string; scope_id: string | null; connection_status: string; permission_status: string; scope_status: string; credential_reference_type: string; credential_reference_id: string | null; health_status: string; last_verified_at: string | null; disabled_reason: string | null; limitations: unknown[]; created_at: string; updated_at: string }
export interface AutomationDefinitionRow { id: string; automation_code: string; title: string; description: string | null; execution_domain: string; connector_definition_id: string | null; capability_id: string | null; action_type: string | null; execution_mode: string; dry_run_required: boolean; sandbox_required: boolean; observation_required: boolean; rollback_reference_required: boolean; cleanup_required: boolean; max_execution_duration_seconds: number; max_retry_count: number; status: string; limitations: unknown[]; created_at: string; updated_at: string }
export interface RuntimeSessionRow { id: string; runtime_session_code: string; execution_request_id: string; automation_definition_id: string; connector_instance_id: string | null; capability_id: string | null; approval_reference_id: string; gate_reference_id: string | null; session_status: string; execution_mode: string; environment_scope: string; target_resource_type: string | null; target_resource_id: string | null; runtime_preconditions: Record<string, unknown> | null; checkpoint_count: number; supervised_by: string | null; started_by: string | null; started_at: string | null; last_checkpoint_at: string | null; pause_requested_at: string | null; paused_at: string | null; cancellation_requested_at: string | null; cancelled_at: string | null; completed_reference_at: string | null; timeout_reference_at: string | null; cleanup_status: string; result_verification_status: string; observation_status: string; closure_status: string; limitations: unknown[]; created_at: string; updated_at: string }
export interface RuntimeEventRow { id: string; event_type: string; runtime_session_id: string | null; connector_definition_id: string | null; connector_instance_id: string | null; automation_definition_id: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }

export async function fetchRuntimeControlSummary(): Promise<RuntimeControlSummary> {
  const { data, error } = await supabase.rpc('admin_runtime_control_summary');
  if (error) throw error;
  return (data as RuntimeControlSummary | null) ?? {};
}
export async function fetchConnectorDefinitions(limit = 200): Promise<ConnectorDefinitionRow[]> {
  const { data, error } = await supabase.rpc('admin_connector_definitions', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ConnectorDefinitionRow[];
}
export async function recordConnectorDefinition(payload: Record<string, unknown>): Promise<{ ok: boolean; id: string; definition_is_not_availability: boolean }> {
  const { data, error } = await supabase.rpc('admin_connector_definition_record', { p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; id: string; definition_is_not_availability: boolean };
}
export async function fetchConnectorInstances(limit = 200): Promise<ConnectorInstanceRow[]> {
  const { data, error } = await supabase.rpc('admin_connector_instances', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ConnectorInstanceRow[];
}
export async function recordConnectorInstance(payload: Record<string, unknown>): Promise<{ ok: boolean; id: string; credential_stored: boolean }> {
  const { data, error } = await supabase.rpc('admin_connector_instance_record', { p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; id: string; credential_stored: boolean };
}
export async function fetchAutomationDefinitions(limit = 200): Promise<AutomationDefinitionRow[]> {
  const { data, error } = await supabase.rpc('admin_automation_definitions', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as AutomationDefinitionRow[];
}
export async function recordAutomationDefinition(payload: Record<string, unknown>): Promise<{ ok: boolean; id: string; definition_is_not_execution_request: boolean }> {
  const { data, error } = await supabase.rpc('admin_automation_definition_record', { p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; id: string; definition_is_not_execution_request: boolean };
}
export async function fetchRuntimeSessions(status: string | null = null, limit = 200): Promise<RuntimeSessionRow[]> {
  const { data, error } = await supabase.rpc('admin_runtime_sessions', { p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as RuntimeSessionRow[];
}
export async function createRuntimeSession(payload: Record<string, unknown>): Promise<{ ok: boolean; id: string; runtime_started: boolean; auto_started: boolean }> {
  const { data, error } = await supabase.rpc('admin_runtime_session_create', { p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; id: string; runtime_started: boolean; auto_started: boolean };
}
export async function reviewRuntimeSession(sessionId: string, action: string, reason: string, payload: Record<string, unknown> = {}): Promise<{ ok: boolean; status: string; auto_started: boolean }> {
  const { data, error } = await supabase.rpc('admin_runtime_session_review', { p_session_id: sessionId, p_action: action, p_reason: reason, p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; status: string; auto_started: boolean };
}
export async function recordRuntimeEvent(kind: string, sessionId: string, reason: string, payload: Record<string, unknown>): Promise<{ ok: boolean; id: string; connector_executed: boolean; auto_retry: boolean }> {
  const { data, error } = await supabase.rpc('admin_runtime_event_record', { p_kind: kind, p_session_id: sessionId, p_reason: reason, p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; id: string; connector_executed: boolean; auto_retry: boolean };
}
export async function fetchRuntimeAudit(limit = 200): Promise<RuntimeEventRow[]> {
  const { data, error } = await supabase.rpc('admin_runtime_audit', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as RuntimeEventRow[];
}

// ── Runtime Assurance (0537 — Connector Health/Incident Candidate/Escalation, 자동 제어 없음) ──

export type RuntimeAssuranceSummary = Record<string, number | string | boolean | Record<string, number> | Record<string, unknown> | Array<unknown> | null>;
export interface RuntimeSignalRow { id: string; signal_code: string | null; runtime_session_id: string; connector_instance_id: string | null; signal_type: string; signal_source: string; signal_status: string; observed_value: string | null; expected_value: string | null; threshold_reference: string | null; severity: string; confidence: number | null; evidence: unknown[]; limitations: unknown[]; observed_at: string | null; source_event_id: string | null; created_at: string }
export interface RuntimeIncidentCandidateRow { id: string; incident_code: string; runtime_session_id: string; connector_instance_id: string | null; incident_type: string; incident_status: string; severity: string; confidence: number | null; detection_source: string | null; detected_signals: unknown[]; suspected_scope: string | null; suspected_effect: string | null; evidence: unknown[]; limitations: unknown[]; escalation_status: string; resolution_status: string; assigned_reviewer: string | null; first_detected_at: string; last_detected_at: string; created_at: string; updated_at: string }
export interface RuntimeAssuranceEventRow { id: string; event_type: string; runtime_session_id: string | null; connector_instance_id: string | null; incident_candidate_id: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }

export async function fetchRuntimeAssuranceSummary(): Promise<RuntimeAssuranceSummary> {
  const { data, error } = await supabase.rpc('admin_runtime_assurance_summary');
  if (error) throw error;
  return (data as RuntimeAssuranceSummary | null) ?? {};
}
export async function fetchRuntimeSignals(sessionId: string | null = null, limit = 200): Promise<RuntimeSignalRow[]> {
  const { data, error } = await supabase.rpc('admin_runtime_signals', { p_session_id: sessionId, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as RuntimeSignalRow[];
}
export async function recordRuntimeSignal(payload: Record<string, unknown>): Promise<{ ok: boolean; id: string; signal_is_not_fact: boolean; incident_confirmed: boolean }> {
  const { data, error } = await supabase.rpc('admin_runtime_signal_record', { p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; id: string; signal_is_not_fact: boolean; incident_confirmed: boolean };
}
export async function fetchRuntimeIncidentCandidates(status: string | null = null, limit = 200): Promise<RuntimeIncidentCandidateRow[]> {
  const { data, error } = await supabase.rpc('admin_runtime_incident_candidates', { p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as RuntimeIncidentCandidateRow[];
}
export async function createRuntimeIncidentCandidate(payload: Record<string, unknown>): Promise<{ ok: boolean; id: string; incident_confirmed: boolean; auto_registered_to_ai_incidents: boolean }> {
  const { data, error } = await supabase.rpc('admin_runtime_incident_candidate_create', { p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; id: string; incident_confirmed: boolean; auto_registered_to_ai_incidents: boolean };
}
export async function reviewRuntimeIncidentCandidate(candidateId: string, action: string, reason: string, payload: Record<string, unknown> = {}): Promise<{ ok: boolean; status: string; incident_confirmed: boolean; auto_action_taken: boolean }> {
  const { data, error } = await supabase.rpc('admin_runtime_incident_candidate_review', { p_candidate_id: candidateId, p_action: action, p_reason: reason, p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; status: string; incident_confirmed: boolean; auto_action_taken: boolean };
}
export async function recordRuntimeAssuranceEvent(kind: string, reason: string, payload: Record<string, unknown>, sessionId: string | null = null, incidentId: string | null = null): Promise<{ ok: boolean; id: string; runtime_controlled: boolean; auto_message_sent: boolean }> {
  const { data, error } = await supabase.rpc('admin_runtime_assurance_event_record', { p_kind: kind, p_reason: reason, p_payload: payload, p_session_id: sessionId, p_incident_id: incidentId });
  if (error) throw error;
  return data as { ok: boolean; id: string; runtime_controlled: boolean; auto_message_sent: boolean };
}
export async function fetchRuntimeAssuranceAudit(limit = 200): Promise<RuntimeAssuranceEventRow[]> {
  const { data, error } = await supabase.rpc('admin_runtime_assurance_audit', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as RuntimeAssuranceEventRow[];
}

// ── Runtime Learning (0538 — Postmortem/Policy Proposal, 자동 확정·적용 없음) ──

export type RuntimeLearningSummary = Record<string, number | string | boolean | Record<string, number> | Record<string, unknown> | Array<unknown> | null>;
export interface RuntimePostmortemRow { id: string; postmortem_code: string; runtime_session_id: string; runtime_incident_candidate_id: string | null; connector_instance_id: string | null; automation_definition_id: string | null; execution_request_id: string | null; postmortem_status: string; incident_summary: string; observed_effect: string | null; affected_scope: string | null; timeline_summary: string | null; detection_summary: string | null; escalation_summary: string | null; recovery_summary: string | null; resolution_summary: string | null; evidence_summary: unknown[]; known_facts: unknown[]; unknown_factors: unknown[]; assumptions: unknown[]; limitations: unknown[]; root_cause_candidates: unknown[]; contributing_factors: unknown[]; control_gaps: unknown[]; drafted_by: string | null; reviewed_by: string | null; approved_by: string | null; created_at: string; updated_at: string }
export interface RuntimePolicyProposalRow { id: string; proposal_code: string; source_postmortem_id: string | null; source_incident_candidate_id: string | null; policy_domain: string; policy_type: string | null; title: string; proposal_summary: string | null; current_policy_reference: string | null; proposed_policy: Record<string, unknown>; expected_benefit: string | null; potential_side_effects: unknown[]; risk_level: string; rollback_reference_required: boolean; observation_required: boolean; evidence: unknown[]; alternatives: unknown[]; preconditions: unknown[]; limitations: unknown[]; proposal_status: string; application_status: string; effectiveness_status: string; proposed_by: string | null; reviewed_by: string | null; approved_by: string | null; created_at: string; updated_at: string }
export interface RuntimeLearningEventRow { id: string; event_type: string; runtime_postmortem_id: string | null; policy_proposal_id: string | null; runtime_session_id: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }

export async function fetchRuntimeLearningSummary(): Promise<RuntimeLearningSummary> {
  const { data, error } = await supabase.rpc('admin_runtime_learning_summary');
  if (error) throw error;
  return (data as RuntimeLearningSummary | null) ?? {};
}
export async function fetchRuntimePostmortems(status: string | null = null, limit = 200): Promise<RuntimePostmortemRow[]> {
  const { data, error } = await supabase.rpc('admin_runtime_postmortems', { p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as RuntimePostmortemRow[];
}
export async function createRuntimePostmortem(payload: Record<string, unknown>): Promise<{ ok: boolean; id: string; draft_is_not_approved: boolean; root_cause_confirmed: boolean }> {
  const { data, error } = await supabase.rpc('admin_runtime_postmortem_create', { p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; id: string; draft_is_not_approved: boolean; root_cause_confirmed: boolean };
}
export async function reviewRuntimePostmortem(postmortemId: string, action: string, reason: string, payload: Record<string, unknown> = {}): Promise<{ ok: boolean; status: string; root_cause_confirmed: boolean; policy_applied: boolean }> {
  const { data, error } = await supabase.rpc('admin_runtime_postmortem_review', { p_postmortem_id: postmortemId, p_action: action, p_reason: reason, p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; status: string; root_cause_confirmed: boolean; policy_applied: boolean };
}
export async function fetchRuntimePolicyProposals(status: string | null = null, limit = 200): Promise<RuntimePolicyProposalRow[]> {
  const { data, error } = await supabase.rpc('admin_runtime_policy_proposals', { p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as RuntimePolicyProposalRow[];
}
export async function createRuntimePolicyProposal(payload: Record<string, unknown>): Promise<{ ok: boolean; id: string; proposal_is_not_approval: boolean; policy_applied: boolean }> {
  const { data, error } = await supabase.rpc('admin_runtime_policy_proposal_create', { p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; id: string; proposal_is_not_approval: boolean; policy_applied: boolean };
}
export async function reviewRuntimePolicyProposal(proposalId: string, action: string, reason: string, payload: Record<string, unknown> = {}): Promise<{ ok: boolean; proposal_status: string; application_status: string; effectiveness_status: string; policy_applied: boolean }> {
  const { data, error } = await supabase.rpc('admin_runtime_policy_review', { p_proposal_id: proposalId, p_action: action, p_reason: reason, p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; proposal_status: string; application_status: string; effectiveness_status: string; policy_applied: boolean };
}
export async function recordRuntimeLearningEvent(kind: string, reason: string, payload: Record<string, unknown>, postmortemId: string | null = null, proposalId: string | null = null, sessionId: string | null = null): Promise<{ ok: boolean; id: string; root_cause_confirmed_automatically: boolean; policy_applied: boolean }> {
  const { data, error } = await supabase.rpc('admin_runtime_learning_event_record', { p_kind: kind, p_reason: reason, p_payload: payload, p_postmortem_id: postmortemId, p_proposal_id: proposalId, p_session_id: sessionId });
  if (error) throw error;
  return data as { ok: boolean; id: string; root_cause_confirmed_automatically: boolean; policy_applied: boolean };
}
export async function fetchRuntimeLearningAudit(limit = 200): Promise<RuntimeLearningEventRow[]> {
  const { data, error } = await supabase.rpc('admin_runtime_learning_audit', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as RuntimeLearningEventRow[];
}

// ── Policy Simulation (0539 — 정책 시뮬레이션/통제 Rollout, 자동 승인·적용·Rollout 없음) ──

export type PolicySimulationSummary = Record<string, number | string | boolean | Record<string, number> | Record<string, unknown> | Array<unknown> | null>;
export interface PolicyChangeSpecificationRow { id: string; change_code: string; policy_proposal_id: string; policy_domain: string; change_type: string; current_policy_reference: string | null; proposed_policy_reference: string | null; current_policy_snapshot: Record<string, unknown>; proposed_policy_snapshot: Record<string, unknown>; normalized_delta: Record<string, unknown>; affected_execution_domains: unknown[]; affected_environment_scopes: unknown[]; affected_scope_types: unknown[]; expected_benefit: string | null; potential_side_effects: unknown[]; assumptions: unknown[]; unknown_factors: unknown[]; limitations: unknown[]; risk_level: string; reversibility_status: string; rollback_reference_required: boolean; validation_required: boolean; simulation_required: boolean; observation_required: boolean; specification_status: string; created_by: string | null; reviewed_by: string | null; created_at: string; updated_at: string }
export interface PolicySimulationRunRow { id: string; simulation_code: string; policy_change_specification_id: string; simulation_type: string; simulation_status: string; simulation_scope_type: string; simulation_scope_id: string | null; baseline_snapshot_reference: Record<string, unknown>; input_dataset_reference: string | null; input_hash: string | null; sample_size: number | null; replay_result: Record<string, unknown> | null; counterfactual_result: Record<string, unknown> | null; conflict_result: Record<string, unknown> | null; compatibility_result: Record<string, unknown> | null; blast_radius_result: Record<string, unknown> | null; friction_result: Record<string, unknown> | null; safety_benefit_result: Record<string, unknown> | null; expected_changes: unknown[]; expected_side_effects: unknown[]; confidence: number | null; evidence: unknown[]; limitations: unknown[]; simulated_by: string | null; reviewed_by: string | null; started_at: string | null; completed_at: string | null; created_at: string }
export interface PolicyRolloutPlanRow { id: string; rollout_code: string; policy_change_specification_id: string; policy_simulation_run_id: string; rollout_strategy: string; rollout_status: string; environment_scope: string; target_scope_type: string; target_scope_ids: unknown[]; excluded_scope_ids: unknown[]; rollout_stages: unknown[]; stage_entry_criteria: unknown[]; stage_exit_criteria: unknown[]; stop_conditions: unknown[]; rollback_conditions: unknown[]; observation_windows: unknown[]; evidence_requirements: unknown[]; assigned_reviewers: unknown[]; estimated_blast_radius: string; estimated_operational_friction: string; expected_benefit: string | null; potential_side_effects: unknown[]; limitations: unknown[]; created_by: string | null; reviewed_by: string | null; approved_by: string | null; created_at: string; updated_at: string }
export interface PolicyRolloutEventRow { id: string; event_type: string; policy_change_specification_id: string | null; policy_simulation_run_id: string | null; policy_rollout_plan_id: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }

export async function fetchPolicySimulationSummary(): Promise<PolicySimulationSummary> {
  const { data, error } = await supabase.rpc('admin_policy_simulation_summary');
  if (error) throw error;
  return (data as PolicySimulationSummary | null) ?? {};
}
export async function fetchPolicyChangeSpecifications(status: string | null = null, limit = 200): Promise<PolicyChangeSpecificationRow[]> {
  const { data, error } = await supabase.rpc('admin_policy_change_specifications', { p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as PolicyChangeSpecificationRow[];
}
export async function createPolicyChangeSpecification(payload: Record<string, unknown>): Promise<{ ok: boolean; id: string; specification_is_not_application: boolean; policy_applied: boolean }> {
  const { data, error } = await supabase.rpc('admin_policy_change_specification_create', { p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; id: string; specification_is_not_application: boolean; policy_applied: boolean };
}
export async function reviewPolicyChangeSpecification(specId: string, action: string, reason: string, payload: Record<string, unknown> = {}): Promise<{ ok: boolean; status: string; policy_applied: boolean; human_decision: boolean }> {
  const { data, error } = await supabase.rpc('admin_policy_change_specification_review', { p_spec_id: specId, p_action: action, p_reason: reason, p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; status: string; policy_applied: boolean; human_decision: boolean };
}
export async function fetchPolicySimulationRuns(status: string | null = null, limit = 200): Promise<PolicySimulationRunRow[]> {
  const { data, error } = await supabase.rpc('admin_policy_simulation_runs', { p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as PolicySimulationRunRow[];
}
export async function recordPolicySimulationRun(payload: Record<string, unknown>): Promise<{ ok: boolean; id: string; simulation_is_not_reality: boolean; policy_applied: boolean }> {
  const { data, error } = await supabase.rpc('admin_policy_simulation_run_record', { p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; id: string; simulation_is_not_reality: boolean; policy_applied: boolean };
}
export async function fetchPolicyRolloutPlans(status: string | null = null, limit = 200): Promise<PolicyRolloutPlanRow[]> {
  const { data, error } = await supabase.rpc('admin_policy_rollout_plans', { p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as PolicyRolloutPlanRow[];
}
export async function createPolicyRolloutPlan(payload: Record<string, unknown>): Promise<{ ok: boolean; id: string; plan_is_not_execution: boolean; rollout_started: boolean }> {
  const { data, error } = await supabase.rpc('admin_policy_rollout_plan_create', { p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; id: string; plan_is_not_execution: boolean; rollout_started: boolean };
}
export async function reviewPolicyRollout(planId: string, action: string, reason: string, payload: Record<string, unknown> = {}): Promise<{ ok: boolean; status: string; policy_applied: boolean; rollout_executed: boolean; auto_rollback: boolean }> {
  const { data, error } = await supabase.rpc('admin_policy_rollout_review', { p_plan_id: planId, p_action: action, p_reason: reason, p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; status: string; policy_applied: boolean; rollout_executed: boolean; auto_rollback: boolean };
}
export async function recordPolicyRolloutEvent(kind: string, reason: string, payload: Record<string, unknown>, specId: string | null = null, simId: string | null = null, planId: string | null = null): Promise<{ ok: boolean; id: string; policy_applied: boolean; rollout_executed: boolean; auto_action_taken: boolean }> {
  const { data, error } = await supabase.rpc('admin_policy_rollout_event_record', { p_kind: kind, p_reason: reason, p_payload: payload, p_spec_id: specId, p_sim_id: simId, p_plan_id: planId });
  if (error) throw error;
  return data as { ok: boolean; id: string; policy_applied: boolean; rollout_executed: boolean; auto_action_taken: boolean };
}
export async function fetchPolicyRolloutAudit(limit = 200): Promise<PolicyRolloutEventRow[]> {
  const { data, error } = await supabase.rpc('admin_policy_rollout_audit', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as PolicyRolloutEventRow[];
}

// ── Enterprise Digital Twin (0540 — Twin ≠ Production, 자동 실행·Production 변경 없음) ──

export type EnterpriseTwinSummary = Record<string, number | string | boolean | Record<string, number> | Record<string, unknown> | Array<unknown> | null>;
export interface EnterpriseStateSnapshotRow { id: string; snapshot_code: string; snapshot_status: string; organization_state: Record<string, unknown>; runtime_state: Record<string, unknown>; connector_state: Record<string, unknown>; agent_state: Record<string, unknown>; policy_state: Record<string, unknown>; decision_state: Record<string, unknown>; knowledge_state: Record<string, unknown>; capacity_state: Record<string, unknown>; cost_state: Record<string, unknown>; incident_state: Record<string, unknown>; approval_state: Record<string, unknown>; source_coverage: unknown[]; missing_sources: unknown[]; assumptions: unknown[]; limitations: unknown[]; captured_by: string | null; captured_at: string; created_at: string }
export interface EnterpriseTwinScenarioRow { id: string; scenario_code: string; scenario_type: string; title: string; description: string | null; scenario_status: string; support_status: string; injection_parameters: Record<string, unknown>; target_twin_layers: unknown[]; horizon_days: number | null; assumptions: unknown[]; unknown_factors: unknown[]; evidence: unknown[]; limitations: unknown[]; created_by: string | null; reviewed_by: string | null; created_at: string; updated_at: string }
export interface EnterpriseTwinRunRow { id: string; run_code: string; snapshot_id: string; scenario_id: string; run_status: string; simulation_mode: string; sample_size: number | null; future_timeline: Record<string, unknown> | null; risk_projection: Record<string, unknown> | null; opportunity_projection: Record<string, unknown> | null; cost_projection: Record<string, unknown> | null; capacity_projection: Record<string, unknown> | null; throughput_projection: Record<string, unknown> | null; queue_projection: Record<string, unknown> | null; incident_projection: Record<string, unknown> | null; approval_queue_projection: Record<string, unknown> | null; kpi_projection: Record<string, unknown> | null; human_workload_projection: Record<string, unknown> | null; best_case: Record<string, unknown> | null; worst_case: Record<string, unknown> | null; confidence: number | null; assumptions: unknown[]; unknown_factors: unknown[]; evidence: unknown[]; limitations: unknown[]; simulated_by: string | null; reviewed_by: string | null; started_at: string | null; completed_at: string | null; created_at: string }
export interface EnterpriseTwinEventRow { id: string; event_type: string; snapshot_id: string | null; scenario_id: string | null; run_id: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }

export async function fetchEnterpriseTwinSummary(): Promise<EnterpriseTwinSummary> {
  const { data, error } = await supabase.rpc('admin_enterprise_twin_summary');
  if (error) throw error;
  return (data as EnterpriseTwinSummary | null) ?? {};
}
export async function fetchEnterpriseStateSnapshots(status: string | null = null, limit = 200): Promise<EnterpriseStateSnapshotRow[]> {
  const { data, error } = await supabase.rpc('admin_enterprise_state_snapshots', { p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as EnterpriseStateSnapshotRow[];
}
export async function captureEnterpriseStateSnapshot(payload: Record<string, unknown> = {}): Promise<{ ok: boolean; id: string; snapshot_status: string; twin_is_not_production: boolean; snapshot_is_not_live_state: boolean; production_changed: boolean }> {
  const { data, error } = await supabase.rpc('admin_enterprise_state_snapshot_capture', { p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; id: string; snapshot_status: string; twin_is_not_production: boolean; snapshot_is_not_live_state: boolean; production_changed: boolean };
}
export async function fetchEnterpriseTwinScenarios(status: string | null = null, limit = 200): Promise<EnterpriseTwinScenarioRow[]> {
  const { data, error } = await supabase.rpc('admin_enterprise_twin_scenarios', { p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as EnterpriseTwinScenarioRow[];
}
export async function createEnterpriseTwinScenario(payload: Record<string, unknown>): Promise<{ ok: boolean; id: string; support_status: string; scenario_is_not_reality: boolean; auto_executed: boolean; production_changed: boolean }> {
  const { data, error } = await supabase.rpc('admin_enterprise_twin_scenario_create', { p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; id: string; support_status: string; scenario_is_not_reality: boolean; auto_executed: boolean; production_changed: boolean };
}
export async function reviewEnterpriseTwinScenario(scenarioId: string, action: string, reason: string, payload: Record<string, unknown> = {}): Promise<{ ok: boolean; status: string; production_changed: boolean; auto_executed: boolean; human_decision: boolean }> {
  const { data, error } = await supabase.rpc('admin_enterprise_twin_scenario_review', { p_scenario_id: scenarioId, p_action: action, p_reason: reason, p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; status: string; production_changed: boolean; auto_executed: boolean; human_decision: boolean };
}
export async function fetchEnterpriseTwinRuns(status: string | null = null, limit = 200): Promise<EnterpriseTwinRunRow[]> {
  const { data, error } = await supabase.rpc('admin_enterprise_twin_runs', { p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as EnterpriseTwinRunRow[];
}
export async function recordEnterpriseTwinRun(payload: Record<string, unknown>): Promise<{ ok: boolean; id: string; run_status: string; prediction_is_not_future_fact: boolean; projection_is_not_observation: boolean; twin_is_not_production: boolean; production_changed: boolean; auto_executed: boolean }> {
  const { data, error } = await supabase.rpc('admin_enterprise_twin_run_record', { p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; id: string; run_status: string; prediction_is_not_future_fact: boolean; projection_is_not_observation: boolean; twin_is_not_production: boolean; production_changed: boolean; auto_executed: boolean };
}
export async function recordEnterpriseTwinEvent(kind: string, reason: string, payload: Record<string, unknown>, snapshotId: string | null = null, scenarioId: string | null = null, runId: string | null = null): Promise<{ ok: boolean; id: string; production_changed: boolean; auto_executed: boolean; recommendation_is_not_decision: boolean; human_review_required: boolean }> {
  const { data, error } = await supabase.rpc('admin_enterprise_twin_event_record', { p_kind: kind, p_reason: reason, p_payload: payload, p_snapshot_id: snapshotId, p_scenario_id: scenarioId, p_run_id: runId });
  if (error) throw error;
  return data as { ok: boolean; id: string; production_changed: boolean; auto_executed: boolean; recommendation_is_not_decision: boolean; human_review_required: boolean };
}
export async function fetchEnterpriseTwinAudit(limit = 200): Promise<EnterpriseTwinEventRow[]> {
  const { data, error } = await supabase.rpc('admin_enterprise_twin_audit', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as EnterpriseTwinEventRow[];
}

// ── Settlement Readability (0541 — 읽기 전용 조회·마스킹·접근 Audit. 정산/지급/Shadow 계산 변경 없음) ──

export interface ReadableSettlementListRow { settlement_id: string; artist_user_id: string; settlement_month: string; status: string; artist_name: string | null; real_name: string | null; nickname: string | null; email: string | null; gross_settlement_amount: number; company_fee_amount: number; sales_agent_fee_amount: number; withholding_tax_amount: number; artist_net_settlement: number; previous_carried_amount: number; final_payout_amount: number; carried_over_amount: number; paid_at: string | null; bank_name: string | null; account_holder: string | null; masked_account_number: string | null; masked_resident_number: string | null; account_status: string; tax_withholding_type: string | null; entity_type: string; rrn_registered: boolean; developer_fields: Record<string, unknown> }
export type ReadableSettlementDetail = Record<string, unknown> & { basic: Record<string, unknown> | null; settlement: Record<string, unknown>; shadow: Record<string, unknown>; streams: Record<string, unknown>; payout_history: Array<Record<string, unknown>>; developer_fields: Record<string, unknown> };
export type ReadableShadowCompare = Record<string, unknown> & { rows: Array<Record<string, unknown>> };
export type ReadableSettlementKpi = Record<string, unknown>;
export interface SettlementAccessLogRow { id: string; action: string; target_type: string; settlement_id: string | null; artist_user_id: string | null; detail: string | null; payload: Record<string, unknown> | null; viewer_id: string | null; viewed_at: string }

export async function fetchReadableSettlements(params: { month?: string | null; status?: string | null; search?: string | null; bank?: string | null; entityType?: string | null; minAmount?: number | null; maxAmount?: number | null; limit?: number } = {}): Promise<{ rows: ReadableSettlementListRow[]; pii_masked_by_default: boolean }> {
  const { data, error } = await supabase.rpc('admin_settlement_readable_list', {
    p_month: params.month ?? null, p_status: params.status ?? null, p_search: params.search ?? null,
    p_bank: params.bank ?? null, p_entity_type: params.entityType ?? null,
    p_min_amount: params.minAmount ?? null, p_max_amount: params.maxAmount ?? null, p_limit: params.limit ?? 100,
  });
  if (error) throw error;
  const d = (data ?? {}) as { rows?: ReadableSettlementListRow[]; pii_masked_by_default?: boolean };
  return { rows: d.rows ?? [], pii_masked_by_default: d.pii_masked_by_default ?? true };
}
export async function fetchReadableSettlementDetail(settlementId: string): Promise<ReadableSettlementDetail> {
  const { data, error } = await supabase.rpc('admin_settlement_readable_detail', { p_settlement_id: settlementId });
  if (error) throw error;
  return data as ReadableSettlementDetail;
}
export async function fetchReadableShadowCompare(month: string, limit = 100): Promise<ReadableShadowCompare> {
  const { data, error } = await supabase.rpc('admin_settlement_shadow_readable', { p_month: month, p_limit: limit });
  if (error) throw error;
  return data as ReadableShadowCompare;
}
export async function fetchReadableSettlementKpi(month: string): Promise<ReadableSettlementKpi> {
  const { data, error } = await supabase.rpc('admin_settlement_readable_kpi', { p_month: month });
  if (error) throw error;
  return (data ?? {}) as ReadableSettlementKpi;
}
export async function recordSettlementAccess(action: string, targetType: string, detail: string, payload: Record<string, unknown> = {}, settlementId: string | null = null, artistUserId: string | null = null): Promise<{ ok: boolean; id: string; pii_revealed: boolean; settlement_modified: boolean }> {
  const { data, error } = await supabase.rpc('admin_settlement_access_record', { p_action: action, p_target_type: targetType, p_detail: detail, p_payload: payload, p_settlement_id: settlementId, p_artist_user_id: artistUserId });
  if (error) throw error;
  return data as { ok: boolean; id: string; pii_revealed: boolean; settlement_modified: boolean };
}
export async function fetchSettlementAccessAudit(limit = 100): Promise<SettlementAccessLogRow[]> {
  const { data, error } = await supabase.rpc('admin_settlement_access_audit', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as SettlementAccessLogRow[];
}

// ── Scenario Intelligence (0542 — Scenario ≠ Reality, 자동 실행·Failure Injection·Production 변경 없음) ──

export type ScenarioIntelSummary = Record<string, number | string | boolean | Record<string, number> | Record<string, unknown> | Array<unknown> | null>;
export interface ScenarioTemplateRow { id: string; template_code: string; template_name: string; scenario_domain: string; scenario_type: string | null; template_version: number; previous_version_id: string | null; version_compatibility: string; change_summary: string | null; source_type: string; source_reference_id: string | null; source_snapshot_id: string | null; historical_event_reference: Record<string, unknown>; baseline_requirements: unknown[]; required_twin_layers: unknown[]; required_data_sources: unknown[]; initial_conditions: Record<string, unknown>; scenario_variables: unknown[]; default_assumptions: unknown[]; known_external_factors: unknown[]; unknown_factors: unknown[]; timeline_definition: unknown[]; decision_points: unknown[]; transition_rules: unknown[]; stop_conditions: unknown[]; success_conditions: unknown[]; failure_conditions: unknown[]; recovery_conditions: unknown[]; expected_outputs: unknown[]; evidence: unknown[]; limitations: unknown[]; support_status: string; template_status: string; created_by: string | null; reviewed_by: string | null; created_at: string; updated_at: string }
export interface ScenarioRunRow { id: string; run_code: string; scenario_template_id: string; scenario_template_version: number; enterprise_snapshot_id: string; source_twin_run_id: string | null; run_mode: string; run_status: string; scenario_scope_type: string; scenario_scope_id: string | null; horizon_minutes: number | null; input_variables: Record<string, unknown>; input_hash: string | null; branch_generation_strategy: string; max_branch_depth: number; max_branch_count: number; timeline_result: Record<string, unknown> | null; branch_summary: Record<string, unknown> | null; future_state_results: Record<string, unknown> | null; comparison_result: Record<string, unknown> | null; tradeoff_result: Record<string, unknown> | null; robustness_result: Record<string, unknown> | null; regret_result: Record<string, unknown> | null; risk_result: Record<string, unknown> | null; opportunity_result: Record<string, unknown> | null; outcome_reference: Record<string, unknown> | null; accuracy_candidate: Record<string, unknown> | null; drift_candidate: Record<string, unknown> | null; confidence: number | null; sample_size: number | null; assumptions: unknown[]; unknown_factors: unknown[]; evidence: unknown[]; limitations: unknown[]; started_by: string | null; reviewed_by: string | null; started_at: string | null; completed_at: string | null; created_at: string; updated_at: string }
export interface ScenarioBranchRow { id: string; branch_code: string; scenario_run_id: string; parent_branch_id: string | null; branch_name: string; branch_depth: number; branch_trigger: string | null; branch_condition: Record<string, unknown>; transition_type: string | null; selected_option_reference: string | null; future_case_type: string | null; variable_overrides: Record<string, unknown>; probability_candidate: number | null; probability_basis: string | null; probability_confidence: number | null; branch_status: string; projected_outputs: Record<string, unknown> | null; risk_projection: Record<string, unknown> | null; cost_projection: Record<string, unknown> | null; capacity_projection: Record<string, unknown> | null; opportunity_projection: Record<string, unknown> | null; human_workload_projection: Record<string, unknown> | null; recovery_projection: Record<string, unknown> | null; assumptions: unknown[]; unknown_factors: unknown[]; evidence: unknown[]; limitations: unknown[]; created_by: string | null; reviewed_by: string | null; created_at: string; updated_at: string }
export interface ScenarioEventRow { id: string; event_type: string; scenario_template_id: string | null; scenario_run_id: string | null; scenario_branch_id: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }

export async function fetchScenarioIntelSummary(): Promise<ScenarioIntelSummary> {
  const { data, error } = await supabase.rpc('admin_enterprise_scenario_summary');
  if (error) throw error;
  return (data as ScenarioIntelSummary | null) ?? {};
}
export async function fetchScenarioTemplates(status: string | null = null, limit = 200): Promise<ScenarioTemplateRow[]> {
  const { data, error } = await supabase.rpc('admin_enterprise_scenario_templates', { p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ScenarioTemplateRow[];
}
export async function createScenarioTemplate(payload: Record<string, unknown>): Promise<{ ok: boolean; id: string; template_is_not_execution: boolean; scenario_is_not_reality: boolean; production_changed: boolean }> {
  const { data, error } = await supabase.rpc('admin_enterprise_scenario_template_create', { p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; id: string; template_is_not_execution: boolean; scenario_is_not_reality: boolean; production_changed: boolean };
}
export async function reviewScenarioTemplate(templateId: string, action: string, reason: string, payload: Record<string, unknown> = {}): Promise<{ ok: boolean; status: string; production_changed: boolean; auto_executed: boolean; human_decision: boolean }> {
  const { data, error } = await supabase.rpc('admin_enterprise_scenario_template_review', { p_template_id: templateId, p_action: action, p_reason: reason, p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; status: string; production_changed: boolean; auto_executed: boolean; human_decision: boolean };
}
export async function versionScenarioTemplate(templateId: string, reason: string, payload: Record<string, unknown> = {}): Promise<{ ok: boolean; id: string; template_version: number; previous_version_id: string; version_compatibility: string; production_changed: boolean }> {
  const { data, error } = await supabase.rpc('admin_enterprise_scenario_template_version', { p_template_id: templateId, p_reason: reason, p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; id: string; template_version: number; previous_version_id: string; version_compatibility: string; production_changed: boolean };
}
export async function fetchScenarioRuns(status: string | null = null, limit = 200): Promise<ScenarioRunRow[]> {
  const { data, error } = await supabase.rpc('admin_enterprise_scenario_runs', { p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ScenarioRunRow[];
}
export async function createScenarioRun(payload: Record<string, unknown>): Promise<{ ok: boolean; id: string; simulation_is_not_execution: boolean; prediction_is_not_future_fact: boolean; production_changed: boolean; auto_executed: boolean }> {
  const { data, error } = await supabase.rpc('admin_enterprise_scenario_run_create', { p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; id: string; simulation_is_not_execution: boolean; prediction_is_not_future_fact: boolean; production_changed: boolean; auto_executed: boolean };
}
export async function recordScenarioRun(runId: string, action: string, reason: string, payload: Record<string, unknown> = {}): Promise<{ ok: boolean; status: string; simulation_is_not_execution: boolean; production_changed: boolean; auto_executed: boolean; human_decision: boolean }> {
  const { data, error } = await supabase.rpc('admin_enterprise_scenario_run_record', { p_run_id: runId, p_action: action, p_reason: reason, p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; status: string; simulation_is_not_execution: boolean; production_changed: boolean; auto_executed: boolean; human_decision: boolean };
}
export async function fetchScenarioBranches(runId: string | null = null, limit = 200): Promise<ScenarioBranchRow[]> {
  const { data, error } = await supabase.rpc('admin_enterprise_scenario_branches', { p_run_id: runId, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ScenarioBranchRow[];
}
export async function recordScenarioBranch(payload: Record<string, unknown>): Promise<{ ok: boolean; id: string; branch_depth: number; branch_probability_is_not_true_probability: boolean; production_changed: boolean; auto_executed: boolean }> {
  const { data, error } = await supabase.rpc('admin_enterprise_scenario_branch_record', { p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; id: string; branch_depth: number; branch_probability_is_not_true_probability: boolean; production_changed: boolean; auto_executed: boolean };
}
export async function reviewScenarioBranch(branchId: string, action: string, reason: string, payload: Record<string, unknown> = {}): Promise<{ ok: boolean; status: string; production_changed: boolean; auto_executed: boolean; human_decision: boolean }> {
  const { data, error } = await supabase.rpc('admin_enterprise_scenario_branch_review', { p_branch_id: branchId, p_action: action, p_reason: reason, p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; status: string; production_changed: boolean; auto_executed: boolean; human_decision: boolean };
}
export async function recordScenarioEvent(kind: string, reason: string, payload: Record<string, unknown>, templateId: string | null = null, runId: string | null = null, branchId: string | null = null): Promise<{ ok: boolean; id: string; production_changed: boolean; auto_executed: boolean; recommendation_is_not_decision: boolean; human_review_required: boolean }> {
  const { data, error } = await supabase.rpc('admin_enterprise_scenario_event_record', { p_kind: kind, p_reason: reason, p_payload: payload, p_template_id: templateId, p_run_id: runId, p_branch_id: branchId });
  if (error) throw error;
  return data as { ok: boolean; id: string; production_changed: boolean; auto_executed: boolean; recommendation_is_not_decision: boolean; human_review_required: boolean };
}
export async function fetchScenarioAudit(limit = 200): Promise<ScenarioEventRow[]> {
  const { data, error } = await supabase.rpc('admin_enterprise_scenario_audit', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ScenarioEventRow[];
}

// ── Predictive Enterprise (0543 — Forecast ≠ Future Fact, 자동 Alert·Incident·Escalation·Threshold 변경 없음) ──

export type ForecastIntelSummary = Record<string, number | string | boolean | Record<string, number> | Record<string, unknown> | Array<unknown> | null>;
export interface ForecastDefinitionRow { id: string; forecast_code: string; forecast_name: string; forecast_domain: string; target_metric: string; target_scope_type: string; target_scope_id: string | null; source_metric_references: unknown[]; source_table_references: unknown[]; baseline_method: string; rolling_window_definition: Record<string, unknown>; forecast_horizons: unknown[]; aggregation_interval: string | null; minimum_sample_size: number; required_data_completeness: number | null; known_external_factors: unknown[]; unknown_factors: unknown[]; leading_indicator_candidates: unknown[]; lagging_indicator_references: unknown[]; threshold_candidate_rules: unknown[]; warning_candidate_rules: unknown[]; model_reference_type: string; model_reference_id: string | null; model_version: string | null; output_schema_version: number; assumptions: unknown[]; evidence: unknown[]; limitations: unknown[]; support_status: string; definition_status: string; created_by: string | null; reviewed_by: string | null; created_at: string; updated_at: string }
export interface ForecastRunRow { id: string; run_code: string; forecast_definition_id: string; forecast_domain: string; target_metric: string; target_scope_type: string; target_scope_id: string | null; forecast_horizon_minutes: number | null; source_window_start: string | null; source_window_end: string | null; baseline_reference: Record<string, unknown> | null; input_dataset_reference: string | null; input_hash: string | null; sample_size: number | null; data_completeness: number | null; forecast_method: string; model_reference: string | null; model_version: string | null; predicted_value: number | null; predicted_range_low: number | null; predicted_range_high: number | null; predicted_direction: string | null; predicted_risk_class: string | null; predicted_threshold_crossing_at: string | null; leading_indicator_results: Record<string, unknown> | null; trend_result: Record<string, unknown> | null; cross_domain_impact_result: Record<string, unknown> | null; prediction_error: Record<string, unknown> | null; calibration_result: Record<string, unknown> | null; drift_result: Record<string, unknown> | null; confidence: number | null; assumptions: unknown[]; unknown_factors: unknown[]; external_factors: unknown[]; evidence: unknown[]; limitations: unknown[]; run_status: string; started_by: string | null; reviewed_by: string | null; started_at: string | null; completed_at: string | null; created_at: string; updated_at: string }
export interface WarningCandidateRow { id: string; warning_code: string; forecast_definition_id: string; forecast_run_id: string | null; threshold_candidate_reference: Record<string, unknown>; warning_domain: string; warning_type: string; target_scope_type: string; target_scope_id: string | null; warning_status: string; severity_candidate: string; confidence: number | null; detected_at: string; expected_event_window_start: string | null; expected_event_window_end: string | null; expected_lead_time_minutes: number | null; observed_signals: unknown[]; leading_indicator_results: Record<string, unknown> | null; projected_impact: Record<string, unknown> | null; cross_domain_impact: Record<string, unknown> | null; affected_scopes: Record<string, unknown>; recommended_review_deadline: string | null; escalation_recommendation: Record<string, unknown> | null; suggested_human_roles: unknown[]; outcome_reference: Record<string, unknown> | null; effectiveness_result: Record<string, unknown> | null; assumptions: unknown[]; unknown_factors: unknown[]; external_factors: unknown[]; evidence: unknown[]; limitations: unknown[]; created_by: string | null; reviewed_by: string | null; reviewed_at: string | null; created_at: string; updated_at: string }
export interface EnterpriseForecastEventRow { id: string; event_type: string; forecast_definition_id: string | null; forecast_run_id: string | null; warning_candidate_id: string | null; detail: string | null; payload: Record<string, unknown> | null; actor_id: string | null; created_at: string }

export async function fetchForecastIntelSummary(): Promise<ForecastIntelSummary> {
  const { data, error } = await supabase.rpc('admin_enterprise_forecast_summary');
  if (error) throw error;
  return (data as ForecastIntelSummary | null) ?? {};
}
export async function fetchForecastDefinitions(status: string | null = null, limit = 200): Promise<ForecastDefinitionRow[]> {
  const { data, error } = await supabase.rpc('admin_enterprise_forecast_definitions', { p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ForecastDefinitionRow[];
}
export async function createForecastDefinition(payload: Record<string, unknown>): Promise<{ ok: boolean; id: string; forecast_is_not_future_fact: boolean; alert_dispatched: boolean; production_changed: boolean }> {
  const { data, error } = await supabase.rpc('admin_enterprise_forecast_definition_create', { p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; id: string; forecast_is_not_future_fact: boolean; alert_dispatched: boolean; production_changed: boolean };
}
export async function reviewForecastDefinition(definitionId: string, action: string, reason: string, payload: Record<string, unknown> = {}): Promise<{ ok: boolean; status: string; alert_dispatched: boolean; production_changed: boolean; human_decision: boolean }> {
  const { data, error } = await supabase.rpc('admin_enterprise_forecast_definition_review', { p_definition_id: definitionId, p_action: action, p_reason: reason, p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; status: string; alert_dispatched: boolean; production_changed: boolean; human_decision: boolean };
}
export async function fetchForecastRuns(status: string | null = null, limit = 200): Promise<ForecastRunRow[]> {
  const { data, error } = await supabase.rpc('admin_enterprise_forecast_runs', { p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ForecastRunRow[];
}
export async function createForecastRun(payload: Record<string, unknown>): Promise<{ ok: boolean; id: string; forecast_is_not_future_fact: boolean; alert_dispatched: boolean; production_changed: boolean }> {
  const { data, error } = await supabase.rpc('admin_enterprise_forecast_run_create', { p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; id: string; forecast_is_not_future_fact: boolean; alert_dispatched: boolean; production_changed: boolean };
}
export async function recordForecastRun(runId: string, action: string, reason: string, payload: Record<string, unknown> = {}): Promise<{ ok: boolean; status: string; forecast_is_not_future_fact: boolean; alert_dispatched: boolean; production_changed: boolean; human_decision: boolean }> {
  const { data, error } = await supabase.rpc('admin_enterprise_forecast_run_record', { p_run_id: runId, p_action: action, p_reason: reason, p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; status: string; forecast_is_not_future_fact: boolean; alert_dispatched: boolean; production_changed: boolean; human_decision: boolean };
}
export async function fetchWarningCandidates(status: string | null = null, limit = 200): Promise<WarningCandidateRow[]> {
  const { data, error } = await supabase.rpc('admin_enterprise_warning_candidates', { p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as WarningCandidateRow[];
}
export async function createWarningCandidate(payload: Record<string, unknown>): Promise<{ ok: boolean; id: string; warning_is_not_alert: boolean; alert_dispatched: boolean; incident_created: boolean; escalated: boolean; production_changed: boolean }> {
  const { data, error } = await supabase.rpc('admin_enterprise_warning_candidate_create', { p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; id: string; warning_is_not_alert: boolean; alert_dispatched: boolean; incident_created: boolean; escalated: boolean; production_changed: boolean };
}
export async function reviewWarningCandidate(warningId: string, action: string, reason: string, payload: Record<string, unknown> = {}): Promise<{ ok: boolean; status: string; alert_dispatched: boolean; incident_created: boolean; escalated: boolean; production_changed: boolean; human_decision: boolean }> {
  const { data, error } = await supabase.rpc('admin_enterprise_warning_review', { p_warning_id: warningId, p_action: action, p_reason: reason, p_payload: payload });
  if (error) throw error;
  return data as { ok: boolean; status: string; alert_dispatched: boolean; incident_created: boolean; escalated: boolean; production_changed: boolean; human_decision: boolean };
}
export async function recordForecastEvent(kind: string, reason: string, payload: Record<string, unknown>, definitionId: string | null = null, runId: string | null = null, warningId: string | null = null): Promise<{ ok: boolean; id: string; alert_dispatched: boolean; threshold_applied: boolean; incident_created: boolean; production_changed: boolean; human_review_required: boolean }> {
  const { data, error } = await supabase.rpc('admin_enterprise_forecast_event_record', { p_kind: kind, p_reason: reason, p_payload: payload, p_definition_id: definitionId, p_run_id: runId, p_warning_id: warningId });
  if (error) throw error;
  return data as { ok: boolean; id: string; alert_dispatched: boolean; threshold_applied: boolean; incident_created: boolean; production_changed: boolean; human_review_required: boolean };
}
export async function fetchEnterpriseForecastAudit(limit = 200): Promise<EnterpriseForecastEventRow[]> {
  const { data, error } = await supabase.rpc('admin_enterprise_forecast_audit', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as EnterpriseForecastEventRow[];
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
