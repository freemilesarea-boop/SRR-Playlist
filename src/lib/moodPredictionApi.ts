/**
 * moodPredictionApi.ts — Phase X1.2 CLAP zero-shot mood 분류 결과.
 *  - admin_list_mood_predictions
 *  - admin_apply_ai_mood_to_track (top1 → tracks.mood, top1~3 → tracks.mood_tags)
 *  - admin_mood_classification_status
 *
 * 동일 taxonomy-v1 row 에 genre 와 공존. mood 적용 시 predicted_main_genre 보존.
 */
import { supabase } from './supabase';

export type MoodPredictionFilter = 'all' | 'mismatch' | 'unapplied';

export interface MoodPredictionRow {
  track_id: string;
  title: string;
  artist: string | null;
  cover_url: string | null;
  current_mood: string | null;
  current_mood_tags: string[] | null;
  predicted_mood_slugs: string[] | null;
  predicted_mood_labels: string[] | null;
  mood_confidence: number | null;
  prediction_scores: { mood?: Record<string, number>; genre?: Record<string, number> } | null;
  applied_at: string | null;
  prediction_created_at: string | null;
}

export interface MoodClassificationStatus {
  tracks_total: number;
  tracks_classified: number;
  tracks_pending: number;
  tracks_applied: number;
  tracks_mismatch: number;
}

export async function listMoodPredictions(
  filter: MoodPredictionFilter = 'all',
  limit = 50,
  offset = 0,
): Promise<MoodPredictionRow[]> {
  const { data, error } = await supabase.rpc('admin_list_mood_predictions', {
    p_filter: filter, p_limit: limit, p_offset: offset,
  });
  if (error) throw error;
  return (data ?? []) as MoodPredictionRow[];
}

export interface ApplyMoodResult {
  track_id: string;
  applied_mood: string;
  applied_mood_tags: string[];
  previous_mood: string | null;
  previous_mood_tags: string[] | null;
}

export async function applyAiMoodToTrack(trackId: string): Promise<ApplyMoodResult> {
  const { data, error } = await supabase.rpc('admin_apply_ai_mood_to_track', { p_track_id: trackId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as ApplyMoodResult;
}

export async function getMoodClassificationStatus(): Promise<MoodClassificationStatus | null> {
  const { data, error } = await supabase.rpc('admin_mood_classification_status');
  if (error) {
    if (import.meta.env.DEV) console.warn('[mood] status fetch failed', error);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row as MoodClassificationStatus;
}
