import { supabase } from './supabase';

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
