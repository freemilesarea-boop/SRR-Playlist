/**
 * audioDistributionStatsApi.ts — 관리자 음원 검수/유통 KPI (X6.31)
 *
 * RPC 매핑 (0320):
 *   - admin_audio_distribution_stats(p_start, p_end, p_artist_user_id)
 *   - admin_list_track_artist_owners()
 *
 * Status 정의:
 *   pending   = release_status in ('draft','submitted','review_pending','changes_requested')
 *   approved  = release_status in ('approved','scheduled','released')
 *   distributed = release_status = 'released' AND released_at IS NOT NULL
 *   rejected  = release_status in ('rejected','removed')
 */
import { supabase } from './supabase';

export interface AudioDistributionStats {
  total_submitted: number;
  pending_review: number;
  approved: number;
  distributed: number;
  rejected: number;
  rejection_rate_pct: number;
  distribution_rate_pct: number;
  rejection_breakdown: Array<{ reason: string; n: number }>;
  window_start: string | null;
  window_end: string | null;
  artist_user_id: string | null;
  computed_at: string;
}

export interface TrackArtistOwner {
  owner_user_id: string;
  nickname: string;
  email: string;
  track_count: number;
}

/**
 * 음원 검수/유통 KPI 조회.
 * @param windowStart  ISO timestamp (KST 권장 — 호출자가 변환). null = 전체 기간.
 * @param windowEnd    ISO timestamp (exclusive). null = 전체 기간.
 * @param artistUserId 특정 아티스트 (owner_user_id) 만 집계. null = 전체.
 */
export async function fetchAudioDistributionStats(
  windowStart: string | null,
  windowEnd: string | null,
  artistUserId: string | null,
): Promise<AudioDistributionStats> {
  const { data, error } = await supabase.rpc('admin_audio_distribution_stats', {
    p_start: windowStart,
    p_end: windowEnd,
    p_artist_user_id: artistUserId,
  });
  if (error) throw error;
  return data as AudioDistributionStats;
}

export async function fetchTrackArtistOwners(): Promise<TrackArtistOwner[]> {
  const { data, error } = await supabase.rpc('admin_list_track_artist_owners');
  if (error) throw error;
  return (data ?? []) as TrackArtistOwner[];
}
