import { supabase } from './supabase';
import { applyDemoMode } from './demoMode';
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
  const tracks = ((data ?? []) as unknown as Array<{ order_index: number; tracks: TrackRow }>)
    .map((row) => row.tracks)
    .filter(Boolean);
  return applyDemoMode(tracks);
}

/** 플레이리스트별 (총 트랙 수, 재생 가능한 트랙 수) 를 한 번에 가져옵니다. */
export async function fetchPlaylistCounts(): Promise<
  Map<string, { total: number; playable: number }>
> {
  const { data, error } = await supabase
    .from('playlist_tracks')
    .select('playlist_id, tracks(audio_url)');
  if (error) throw error;

  const map = new Map<string, { total: number; playable: number }>();
  const rows = (data ?? []) as unknown as Array<{
    playlist_id: string;
    tracks: { audio_url: string | null } | null;
  }>;
  // 데모 모드가 켜져 있으면 빈 audio_url 도 재생 가능으로 카운트
  const enrichedTracks = applyDemoMode(
    rows.map((r) => ({ audio_url: r.tracks?.audio_url ?? '' })),
  );
  rows.forEach((r, i) => {
    const url = enrichedTracks[i]?.audio_url?.trim() ?? '';
    const entry = map.get(r.playlist_id) ?? { total: 0, playable: 0 };
    entry.total += 1;
    if (url.length > 0) entry.playable += 1;
    map.set(r.playlist_id, entry);
  });
  return map;
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
