/**
 * clapCurationApi.ts — CLAP 기반 AI 큐레이션 admin API.
 *
 * 흐름:
 *   1) Modal worker 가 트랙 임베딩을 track_embeddings 에 저장 → trigger 로 centroid 자동 갱신
 *   2) admin 이 플레이리스트 골라 generate_clap_recommendations 호출 → 후보 top-N 저장
 *   3) admin 이 1-by-1 승인/반려 → decide_clap_recommendation
 */
import { supabase } from './supabase';

export interface ClapPlaylistRow {
  playlist_id: string;
  title: string;
  business_category: string | null;
  track_count: number;
  centroid_track_count: number | null;
  centroid_updated_at: string | null;
  pending_count: number;
}

export interface ClapRecommendationRow {
  id: string;
  track_id: string;
  title: string;
  artist: string | null;
  main_genre: string | null;
  sub_genre: string | null;
  cover_url: string | null;
  audio_url: string;
  duration: number | null;
  energy_level: string | null;
  audio_health_status: string | null;
  clap_similarity: number;
  genre_score: number;
  mood_score: number;
  energy_score: number;
  quality_score: number;
  total_score: number;
  hard_block_reason: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export async function listClapCurationPlaylists(): Promise<ClapPlaylistRow[]> {
  const { data, error } = await supabase.rpc('list_clap_curation_playlists');
  if (error) throw error;
  return (data ?? []) as ClapPlaylistRow[];
}

export async function listClapRecommendations(
  playlistId: string,
  limit = 20,
): Promise<ClapRecommendationRow[]> {
  const { data, error } = await supabase.rpc('list_clap_recommendations', {
    p_playlist_id: playlistId,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as ClapRecommendationRow[];
}

export async function generateClapRecommendations(
  playlistId: string,
  limit = 20,
): Promise<number> {
  const { data, error } = await supabase.rpc('generate_clap_recommendations', {
    p_playlist_id: playlistId,
    p_limit: limit,
  });
  if (error) throw error;
  return (data as number) ?? 0;
}

export async function decideClapRecommendation(
  recommendationId: string,
  approve: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('decide_clap_recommendation', {
    p_recommendation_id: recommendationId,
    p_approve: approve,
  });
  if (error) throw error;
}
