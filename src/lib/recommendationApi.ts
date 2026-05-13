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
