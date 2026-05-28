import { supabase } from './supabase';
import { applyDemoMode } from './demoMode';
import type { PlaylistRow, TrackRow } from '@/types/db';

export interface RecommendContext {
  time_slot?: string | null;
  situation?: string | null;
  business_type?: string | null;
  mood?: string | null;
  limit?: number;
}

export interface RecommendedTrack extends TrackRow {
  score: number;
  score_reasons: string[];
}

export interface RecommendedPlaylist extends PlaylistRow {
  score: number;
}

interface RpcTrackRow {
  track_id: string;
  title: string;
  artist: string | null;
  genre: string | null;
  main_genre?: string | null;
  sub_genre?: string | null;
  mood: string | null;
  cover_url: string | null;
  audio_url: string;
  duration: number | null;
  score: number;
  score_reasons: string[] | null;
}

function toTrack(row: RpcTrackRow): RecommendedTrack {
  return {
    id: row.track_id,
    title: row.title,
    artist: row.artist,
    genre: row.genre,
    mood: row.mood,
    audio_url: row.audio_url,
    cover_url: row.cover_url,
    duration: row.duration,
    created_at: new Date().toISOString(),
    score: row.score,
    score_reasons: row.score_reasons ?? [],
  };
}

export async function recommendTracksByContext(
  ctx: RecommendContext,
): Promise<RecommendedTrack[]> {
  try {
    const { data, error } = await supabase.rpc('recommend_tracks_by_context', {
      p_time_slot: ctx.time_slot ?? null,
      p_situation: ctx.situation ?? null,
      p_business_type: ctx.business_type ?? null,
      p_mood: ctx.mood ?? null,
      p_limit: ctx.limit ?? 20,
    });
    if (error) throw error;
    const rows = (data ?? []) as RpcTrackRow[];
    const tracks = rows.map(toTrack);
    return applyDemoMode(tracks) as RecommendedTrack[];
  } catch {
    return [];
  }
}

export async function recommendSimilarTracks(
  trackId: string,
  limit = 20,
): Promise<RecommendedTrack[]> {
  try {
    const { data, error } = await supabase.rpc('recommend_similar_tracks', {
      p_track_id: trackId,
      p_limit: limit,
    });
    if (error) throw error;
    const rows = (data ?? []) as RpcTrackRow[];
    const tracks = rows.map(toTrack);
    return applyDemoMode(tracks) as RecommendedTrack[];
  } catch {
    return [];
  }
}

export interface PersonalizedPlaylist {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  cover_url: string | null;
  track_count: number;
  score: number;
}

/**
 * 로그인 사용자의 청취 이력 기반 개인화 추천 신곡.
 * 비로그인/콜드스타트 사용자는 최신·인기 트랙으로 폴백(RPC 내부 처리).
 */
export async function fetchPersonalizedTracks(limit = 12): Promise<RecommendedTrack[]> {
  try {
    const { data, error } = await supabase.rpc('get_personalized_recommendations', {
      p_limit: limit,
    });
    if (error) throw error;
    const rows = (data ?? []) as Array<RpcTrackRow & { reason?: string }>;
    const tracks = rows.map((r) => {
      const t = toTrack(r);
      return { ...t, score_reasons: r.reason ? [r.reason] : t.score_reasons };
    });
    return applyDemoMode(tracks) as RecommendedTrack[];
  } catch {
    return [];
  }
}

/** 사용자 취향(장르/무드) 태그와 겹치는 플레이리스트 추천. */
export async function fetchPersonalizedPlaylists(limit = 8): Promise<PersonalizedPlaylist[]> {
  try {
    const { data, error } = await supabase.rpc('get_personalized_playlists', {
      p_limit: limit,
    });
    if (error) throw error;
    return ((data ?? []) as PersonalizedPlaylist[]).map((p) => ({
      ...p,
      track_count: Number(p.track_count ?? 0),
    }));
  } catch {
    return [];
  }
}

export async function recommendPlaylistsByContext(
  ctx: RecommendContext,
): Promise<RecommendedPlaylist[]> {
  try {
    const { data, error } = await supabase.rpc('recommend_playlists_by_context', {
      p_time_slot: ctx.time_slot ?? null,
      p_situation: ctx.situation ?? null,
      p_business_type: ctx.business_type ?? null,
      p_limit: ctx.limit ?? 10,
    });
    if (error) throw error;
    return (data ?? []) as RecommendedPlaylist[];
  } catch {
    return [];
  }
}

/**
 * Item-based Collaborative Filtering — 0217 RPC.
 * "이 곡 들은 사용자가 같이 들은 곡" — track 상세/공유 페이지에서 사용.
 *
 * @returns track_id 와 점수만 반환. 클라이언트가 fetchTracksByIds 로 트랙 정보 hydrate.
 *          비로그인 사용자도 호출 가능 (seed track 기반이라 user 정보 불필요).
 */
export async function recommendCollabTracksFor(
  seedTrackId: string,
  limit = 12,
): Promise<Array<{ track_id: string; score: number; co_users: number }>> {
  try {
    const { data, error } = await supabase.rpc('recommend_collab_tracks_for', {
      seed_track_id: seedTrackId,
      p_limit: limit,
    });
    if (error) throw error;
    return (data ?? []) as Array<{ track_id: string; score: number; co_users: number }>;
  } catch {
    return [];
  }
}

/**
 * User-based Collaborative Filtering — 0217 RPC.
 * "당신을 위한 추천" — 사용자의 최근 30일 청취 이력 기반.
 *
 * 비로그인 시 빈 배열. 청취 이력이 적으면 (시드 트랙 < 1개) 결과 0.
 */
export async function recommendCollabForUser(
  userId: string,
  limit = 12,
): Promise<Array<{ track_id: string; score: number }>> {
  try {
    const { data, error } = await supabase.rpc('recommend_collab_for_user', {
      p_user_id: userId,
      p_limit: limit,
    });
    if (error) throw error;
    return (data ?? []) as Array<{ track_id: string; score: number }>;
  } catch {
    return [];
  }
}
