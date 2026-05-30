/**
 * storetypePredictionApi.ts — Phase X1.3 CLAP zero-shot store_type 분류 결과.
 *  - admin_list_storetype_predictions
 *  - admin_apply_ai_storetype_to_track (top1 → tracks.suitable_store)
 *  - admin_storetype_classification_status
 *
 * 동일 taxonomy-v1 row 에 genre/mood 와 공존. store_type 적용 시 모두 보존.
 */
import { supabase } from './supabase';

export type StoreTypePredictionFilter = 'all' | 'mismatch' | 'unapplied';

export interface StoreTypePredictionRow {
  track_id: string;
  title: string;
  artist: string | null;
  cover_url: string | null;
  current_suitable_store: string | null;
  predicted_store_type_slugs: string[] | null;
  predicted_store_type_labels: string[] | null;
  store_type_confidence: number | null;
  prediction_scores: {
    store_type?: Record<string, number>;
    genre?: Record<string, number>;
    mood?: Record<string, number>;
  } | null;
  applied_at: string | null;
  prediction_created_at: string | null;
}

export interface StoreTypeClassificationStatus {
  tracks_total: number;
  tracks_classified: number;
  tracks_pending: number;
  tracks_applied: number;
  tracks_mismatch: number;
}

export async function listStoreTypePredictions(
  filter: StoreTypePredictionFilter = 'all',
  limit = 50,
  offset = 0,
): Promise<StoreTypePredictionRow[]> {
  const { data, error } = await supabase.rpc('admin_list_storetype_predictions', {
    p_filter: filter, p_limit: limit, p_offset: offset,
  });
  if (error) throw error;
  return (data ?? []) as StoreTypePredictionRow[];
}

export interface ApplyStoreTypeResult {
  track_id: string;
  applied_store: string;
  previous_store: string | null;
}

export async function applyAiStoreTypeToTrack(trackId: string): Promise<ApplyStoreTypeResult> {
  const { data, error } = await supabase.rpc('admin_apply_ai_storetype_to_track', { p_track_id: trackId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as ApplyStoreTypeResult;
}

export async function getStoreTypeClassificationStatus(): Promise<StoreTypeClassificationStatus | null> {
  const { data, error } = await supabase.rpc('admin_storetype_classification_status');
  if (error) {
    if (import.meta.env.DEV) console.warn('[storetype] status fetch failed', error);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row as StoreTypeClassificationStatus;
}
