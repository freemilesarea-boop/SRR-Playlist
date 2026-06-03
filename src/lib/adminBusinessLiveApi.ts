/**
 * adminBusinessLiveApi.ts — Phase X6.0.1
 *
 * 매장 실시간 진단 RPC 래퍼.
 * 사업자 신고 시 admin 이 즉시 진단 가능한 도구 (0280).
 */
import { supabase } from '@/lib/supabase';

export interface ActiveBusinessRow {
  business_id: string;
  store_name: string | null;
  business_type: string | null;
  store_type_slug: string | null;
  recent_events: number;
  unique_sessions: number;
  unique_tracks: number;
  skips: number;
  errors: number;
  last_event_at: string;
}

export interface BusinessLiveEvent {
  created_at: string;
  event_type: string;
  track_id: string | null;
  track_title: string | null;
  artist: string | null;
  playlist_id: string | null;
  playlist_title: string | null;
  session_id: string | null;
  listened_seconds: number | null;
  completion_percent: number | null;
  volume: number | null;
  muted: boolean | null;
  device_type: string | null;
}

export interface BusinessLiveTopTrack {
  track_id: string;
  title: string | null;
  artist: string | null;
  plays: number;
  skip_rate: number | null;
}

export interface BusinessLiveError {
  created_at: string;
  track_id: string | null;
  track_title: string | null;
  session_id: string | null;
  device_type: string | null;
  browser: string | null;
}

export interface BusinessLiveSummary {
  window_minutes: number;
  total_events: number;
  unique_sessions: number;
  unique_tracks: number;
  unique_playlists: number;
  event_breakdown: Record<string, number>;
  last_event_at: string | null;
}

export interface BusinessLiveDetail {
  business_id: string | null;
  business: Record<string, unknown> | null;
  summary: BusinessLiveSummary;
  recent_events: BusinessLiveEvent[];
  top_tracks: BusinessLiveTopTrack[];
  errors: BusinessLiveError[];
}

export async function adminListActiveBusinesses(
  minutes = 60, limit = 100,
): Promise<ActiveBusinessRow[]> {
  const { data, error } = await supabase.rpc('admin_list_active_businesses', {
    p_minutes: minutes, p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as ActiveBusinessRow[];
}

export async function adminBusinessLiveDetail(
  businessId: string | null, minutes = 30,
): Promise<BusinessLiveDetail> {
  const { data, error } = await supabase.rpc('admin_business_live_detail', {
    p_business_id: businessId, p_minutes: minutes,
  });
  if (error) throw error;
  return data as BusinessLiveDetail;
}
