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

// =============================================================================
// X6.85 — Store Learning Dashboard (admin only)
// 단일 RPC `admin_store_learning_dashboard(p_window_days)` 가 7개 섹션을 반환.
// =============================================================================

export interface StoreLearningOverview {
  total_likes: number;
  total_dislikes: number;
  recent_likes: number;
  recent_dislikes: number;
  unique_stores: number;
  unique_tracks: number;
  total_reactions: number;
  like_ratio: number | null;
}

export interface StoreLearningTrackRow {
  track_id: string;
  title: string | null;
  artist: string | null;
  genre: string | null;
  like_count: number;
  dislike_count: number;
  like_ratio?: number | null;
  dislike_ratio?: number | null;
  fit_score: number | null;
}

export interface StoreLearningDailyPoint {
  date: string; // YYYY-MM-DD
  likes: number;
  dislikes: number;
}

export interface StoreLearningStoreTypeRow {
  store_type: string;
  likes: number;
  dislikes: number;
  like_ratio: number | null;
  reactions: number;
  stores: number;
}

export interface StoreLearningGenreRow {
  genre: string;
  likes: number;
  dislikes: number;
  like_ratio: number | null;
  reactions: number;
  tracks: number;
}

export type StoreLearningReadinessStatus = 'LOW' | 'MEDIUM' | 'READY';

export interface StoreLearningReadiness {
  score: number;
  status: StoreLearningReadinessStatus;
  breakdown: {
    reaction_score: number;
    store_score: number;
    track_score: number;
    total_reactions: number;
    unique_stores: number;
    unique_tracks: number;
  };
}

export interface StoreLearningDashboard {
  overview: StoreLearningOverview;
  topLiked: StoreLearningTrackRow[];
  topDisliked: StoreLearningTrackRow[];
  dailyTrend: StoreLearningDailyPoint[];
  storeTypes: StoreLearningStoreTypeRow[];
  genres: StoreLearningGenreRow[];
  readiness: StoreLearningReadiness;
  window_days: number;
  computed_at: string;
}

/** X6.85 — admin dashboard. window_days 기본 30. */
export async function adminStoreLearningDashboard(
  windowDays = 30,
): Promise<StoreLearningDashboard> {
  const { data, error } = await supabase.rpc('admin_store_learning_dashboard', {
    p_window_days: windowDays,
  });
  if (error) {
    console.error('[storeTrackReactionsApi] dashboard failed', error);
    throw error;
  }
  return data as StoreLearningDashboard;
}
