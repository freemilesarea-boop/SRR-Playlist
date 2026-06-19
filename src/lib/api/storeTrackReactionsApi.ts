/**
 * storeTrackReactionsApi — X6.84 / Phase 9 (1차).
 *
 * 매장주 행동 데이터 수집: 👍 좋음 / 👎 별로 reaction 저장.
 * 추천 알고리즘 연결은 2차 PR 에서 진행 (이 PR 은 데이터 수집만).
 *
 * SQL: supabase/migrations/0345_phase_9_store_track_reactions.sql
 */
import { supabase } from '@/lib/supabase';

export type StoreTrackReactionType = 'like' | 'dislike';

export interface StoreTrackReaction {
  id: string;
  store_id: string;
  business_id: string | null;
  track_id: string;
  playlist_id: string | null;
  reaction_type: StoreTrackReactionType;
  source: string;
  user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface GetReactionParams {
  storeId: string;
  trackId: string;
}

export interface UpsertReactionParams {
  storeId: string;
  trackId: string;
  reactionType: StoreTrackReactionType;
  playlistId?: string | null;
  businessId?: string | null;
}

/** 현재 매장에서 이 곡의 반응 조회. 없으면 null. */
export async function getStoreTrackReaction(
  params: GetReactionParams,
): Promise<StoreTrackReaction | null> {
  const { data, error } = await supabase.rpc('get_store_track_reaction', {
    p_store_id: params.storeId,
    p_track_id: params.trackId,
  });
  if (error) {
    console.error('[storeTrackReactionsApi] get failed', error);
    throw error;
  }
  // SQL function returns SETOF row → PostgREST returns array (0 or 1 row)
  if (Array.isArray(data)) return (data[0] ?? null) as StoreTrackReaction | null;
  return (data ?? null) as StoreTrackReaction | null;
}

/** 매장 × 트랙 반응 upsert (같은 조합이면 reaction_type 만 갱신). */
export async function upsertStoreTrackReaction(
  params: UpsertReactionParams,
): Promise<StoreTrackReaction> {
  const { data, error } = await supabase.rpc('upsert_store_track_reaction', {
    p_store_id: params.storeId,
    p_track_id: params.trackId,
    p_reaction_type: params.reactionType,
    p_playlist_id: params.playlistId ?? null,
    p_business_id: params.businessId ?? null,
  });
  if (error) {
    console.error('[storeTrackReactionsApi] upsert failed', error);
    throw error;
  }
  if (Array.isArray(data)) {
    if (data.length === 0) throw new Error('upsert returned empty result');
    return data[0] as StoreTrackReaction;
  }
  return data as StoreTrackReaction;
}
