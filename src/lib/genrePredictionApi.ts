/**
 * genrePredictionApi.ts — Phase X1.1 CLAP zero-shot 장르 분류 결과 관리.
 *  - admin_list_genre_predictions: 트랙 × 예측 + 기존 메타 비교 list
 *  - admin_apply_ai_genre_to_track: 1-click 적용 (tracks.main_genre 갱신)
 *  - admin_genre_classification_status: 상단 통계
 */
import { supabase } from './supabase';

export type GenrePredictionFilter = 'all' | 'mismatch' | 'unapplied';

export interface GenrePredictionRow {
  track_id: string;
  title: string;
  artist: string | null;
  cover_url: string | null;
  current_main_genre: string | null;
  predicted_main_genre_slug: string | null;
  predicted_main_genre_label: string | null;
  predicted_sub_genres: string[] | null;
  predicted_sub_labels: string[] | null;
  genre_confidence: number | null;
  prediction_scores: { genre?: Record<string, number> } | null;
  applied_at: string | null;
  prediction_created_at: string | null;
}

export interface GenreClassificationStatus {
  tracks_total: number;
  tracks_classified: number;
  tracks_pending: number;
  tracks_applied: number;
  tracks_mismatch: number;
}

export async function listGenrePredictions(
  filter: GenrePredictionFilter = 'all',
  limit = 50,
  offset = 0,
): Promise<GenrePredictionRow[]> {
  const { data, error } = await supabase.rpc('admin_list_genre_predictions', {
    p_filter: filter, p_limit: limit, p_offset: offset,
  });
  if (error) throw error;
  return (data ?? []) as GenrePredictionRow[];
}

export interface ApplyGenreResult {
  track_id: string;
  applied_genre: string;
  previous_genre: string | null;
}

export async function applyAiGenreToTrack(trackId: string): Promise<ApplyGenreResult> {
  const { data, error } = await supabase.rpc('admin_apply_ai_genre_to_track', { p_track_id: trackId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as ApplyGenreResult;
}

export async function getGenreClassificationStatus(): Promise<GenreClassificationStatus | null> {
  const { data, error } = await supabase.rpc('admin_genre_classification_status');
  if (error) {
    if (import.meta.env.DEV) console.warn('[genre] status fetch failed', error);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row as GenreClassificationStatus;
}
