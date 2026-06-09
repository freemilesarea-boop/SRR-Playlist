// Artist streaming analytics (X6.50 — extracted from artistApi.ts)
// 아티스트/관리자 스트리밍 집계: 일별/월별/제외사유/TOP 트랙.
import { supabase } from '../supabase';

export interface ArtistStreamingSummaryRow {
  track_id: string;
  title: string;
  visibility_status: 'pending_review' | 'approved' | 'rejected' | 'hidden';
  total_streams: number;
  today_streams: number;
  last_7d_streams: number;
  last_30d_streams: number;
  last_played_at: string | null;
}

export interface ArtistDailyStreamRow {
  day: string;
  track_id: string;
  title: string;
  daily_streams: number;
}

export async function fetchArtistStreamingSummary(): Promise<ArtistStreamingSummaryRow[]> {
  try {
    const { data, error } = await supabase.rpc('get_artist_streaming_summary');
    if (error) return [];
    return ((data ?? []) as ArtistStreamingSummaryRow[]).map((r) => ({
      ...r,
      total_streams: Number(r.total_streams ?? 0),
      today_streams: Number(r.today_streams ?? 0),
      last_7d_streams: Number(r.last_7d_streams ?? 0),
      last_30d_streams: Number(r.last_30d_streams ?? 0),
    }));
  } catch {
    return [];
  }
}

export async function fetchArtistDailyStreams(days = 30): Promise<ArtistDailyStreamRow[]> {
  try {
    const { data, error } = await supabase.rpc('get_artist_daily_streams', { p_days: days });
    if (error) return [];
    return ((data ?? []) as ArtistDailyStreamRow[]).map((r) => ({
      ...r,
      daily_streams: Number(r.daily_streams ?? 0),
    }));
  } catch {
    return [];
  }
}

export interface AdminStreamingDay {
  day: string;
  total_streams: number;
  eligible_streams: number;
  unique_listeners: number;
  unique_tracks: number;
}

export async function adminStreamingOverview(days = 30): Promise<AdminStreamingDay[]> {
  const { data, error } = await supabase.rpc('admin_streaming_overview', { p_days: days });
  if (error) throw error;
  return (data ?? []) as AdminStreamingDay[];
}

export interface AdminTopTrackRow {
  rank: number;
  track_id: string;
  track_code: string | null;
  title: string;
  artist: string | null;
  artist_user_id: string | null;
  stream_count: number;
  eligible_count: number;
}

export async function adminTopStreamingTracks(days = 7, limit = 20): Promise<AdminTopTrackRow[]> {
  const { data, error } = await supabase.rpc('admin_top_streaming_tracks', {
    p_days: days, p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as AdminTopTrackRow[];
}

// 0087 — exclusion_reason breakdown
export interface StreamingExclusionBreakdown {
  unreleased: number;
  admin_preview: number;
  artist_preview: number;
  self_play: number;
  daily_user_track_cap: number;
  /** 0089 — 플레이어 음소거 또는 volume=0 */
  muted_play: number;
  /** 0089 — 플레이어 볼륨 10% 미만 */
  low_player_volume: number;
  /** X6.47 (0329) — 같은 user/anon+track 30s 내 중복 milestone_30s */
  dedup_30s_window: number;
  total_excluded: number;
  total_eligible: number;
  days: number;
}

export async function adminStreamingExclusionBreakdown(days = 30): Promise<StreamingExclusionBreakdown> {
  const { data, error } = await supabase.rpc('admin_streaming_exclusion_breakdown', { p_days: days });
  if (error) throw error;
  return data as StreamingExclusionBreakdown;
}

// 0119 — 월간 스트리밍 정산 요약 (관리자)
export interface MonthlyStreamingSummary {
  month_start: string;   // YYYY-MM-DD (해당 월 1일)
  month_end: string;     // YYYY-MM-DD (해당 월 말일)
  total_stream_count: number;
  eligible_stream_count: number;
  excluded_stream_count: number;
  unique_tracks: number;
  unique_artists: number;
  estimated_revenue: number;        // 월간 매출 × 정산 풀 비율 (정산 대상 풀, 원)
  settlement_ready_amount: number;  // 해당 월 지급 준비(payable/paid) 정산액 합 (원)
  pool_revenue_ratio: number;
}

/**
 * 관리자 월간 스트리밍 정산 요약.
 * @param monthStart YYYY-MM-DD (해당 월 아무 날짜나 가능 — 서버가 1일로 정규화). 미지정 시 이번 달.
 */
export async function adminGetMonthlyStreamingSummary(
  monthStart?: string | null,
): Promise<MonthlyStreamingSummary> {
  const { data, error } = await supabase.rpc('admin_get_monthly_streaming_summary', {
    p_month_start: monthStart ?? undefined,
  });
  if (error) throw error;
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    month_start: (d.month_start as string) ?? '',
    month_end: (d.month_end as string) ?? '',
    total_stream_count: Number(d.total_stream_count ?? 0),
    eligible_stream_count: Number(d.eligible_stream_count ?? 0),
    excluded_stream_count: Number(d.excluded_stream_count ?? 0),
    unique_tracks: Number(d.unique_tracks ?? 0),
    unique_artists: Number(d.unique_artists ?? 0),
    estimated_revenue: Number(d.estimated_revenue ?? 0),
    settlement_ready_amount: Number(d.settlement_ready_amount ?? 0),
    pool_revenue_ratio: Number(d.pool_revenue_ratio ?? 0.5),
  };
}
