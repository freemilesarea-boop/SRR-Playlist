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

export async function fetchDashboardStats(): Promise<DashboardStats> {
  const { data, error } = await supabase.rpc('admin_dashboard_stats');
  if (error) throw error;
  return data as DashboardStats;
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
  return data as RevenueSummary;
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
