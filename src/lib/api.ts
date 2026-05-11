import { supabase } from './supabase';
import type { PlaylistRow, TrackRow } from '@/types/db';

export interface PlaylistWithCount extends PlaylistRow {
  track_count?: number;
}

export async function fetchPlaylists(): Promise<PlaylistRow[]> {
  const { data, error } = await supabase
    .from('playlists')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchPlaylist(id: string): Promise<PlaylistRow | null> {
  const { data, error } = await supabase.from('playlists').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchPlaylistTracks(playlistId: string): Promise<TrackRow[]> {
  const { data, error } = await supabase
    .from('playlist_tracks')
    .select('order_index, tracks(*)')
    .eq('playlist_id', playlistId)
    .order('order_index', { ascending: true });
  if (error) throw error;
  // supabase returns embedded record; flatten
  return ((data ?? []) as unknown as Array<{ order_index: number; tracks: TrackRow }>)
    .map((row) => row.tracks)
    .filter(Boolean);
}

export async function fetchTracks(): Promise<TrackRow[]> {
  const { data, error } = await supabase
    .from('tracks')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function toggleLike(userId: string, playlistId: string, liked: boolean) {
  if (liked) {
    const { error } = await supabase.from('likes').delete().match({ user_id: userId, playlist_id: playlistId });
    if (error) throw error;
  } else {
    const { error } = await supabase.from('likes').insert({ user_id: userId, playlist_id: playlistId });
    if (error) throw error;
  }
}

export async function fetchLikedIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase.from('likes').select('playlist_id').eq('user_id', userId);
  if (error) throw error;
  return (data ?? []).map((row) => row.playlist_id);
}

export async function logRecentPlay(userId: string, playlistId: string) {
  await supabase.from('recent_plays').insert({ user_id: userId, playlist_id: playlistId });
}

export async function fetchRecentPlaylists(userId: string, limit = 12): Promise<PlaylistRow[]> {
  const { data, error } = await supabase
    .from('recent_plays')
    .select('played_at, playlists(*)')
    .eq('user_id', userId)
    .order('played_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as unknown as Array<{ played_at: string; playlists: PlaylistRow }>;
  const seen = new Set<string>();
  const result: PlaylistRow[] = [];
  for (const r of rows) {
    if (!r.playlists || seen.has(r.playlists.id)) continue;
    seen.add(r.playlists.id);
    result.push(r.playlists);
  }
  return result;
}
