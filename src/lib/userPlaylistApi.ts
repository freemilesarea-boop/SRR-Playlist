import { supabase } from '@/lib/supabase';
import type { TrackRow } from '@/types/db';

export interface MyUserPlaylist {
  id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
  track_count: number;
  follower_count: number;
}

export interface UserPlaylistDetail {
  id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  is_public: boolean;
  owner_user_id: string;
  is_owner: boolean;
  created_at: string;
  follower_count: number;
  is_following: boolean;
  tracks: Array<TrackRow & { order_index: number }>;
}

export interface FollowedUserPlaylist {
  id: string;
  title: string;
  thumbnail_url: string | null;
  owner_user_id: string;
  track_count: number;
  followed_at: string;
}

export async function fetchMyUserPlaylists(): Promise<MyUserPlaylist[]> {
  const { data, error } = await supabase.rpc('get_my_user_playlists');
  if (error) throw error;
  return (data ?? []) as MyUserPlaylist[];
}

export async function fetchUserPlaylistDetail(id: string): Promise<UserPlaylistDetail | null> {
  const { data, error } = await supabase.rpc('get_user_playlist_detail', { p_playlist_id: id });
  if (error) throw error;
  return (data as UserPlaylistDetail) ?? null;
}

export async function createUserPlaylist(input: {
  title: string;
  description?: string | null;
  is_public?: boolean;
  thumbnail_url?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_user_playlist', {
    p_title: input.title,
    p_description: input.description ?? null,
    p_is_public: input.is_public ?? false,
    p_thumbnail_url: input.thumbnail_url ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function addTrackToUserPlaylist(playlistId: string, trackId: string) {
  const { data, error } = await supabase.rpc('add_track_to_user_playlist', {
    p_playlist_id: playlistId,
    p_track_id: trackId,
  });
  if (error) throw error;
  return data as { ok: boolean; already: boolean; order_index?: number };
}

export async function removeTrackFromUserPlaylist(playlistId: string, trackId: string) {
  const { error } = await supabase
    .from('user_playlist_tracks')
    .delete()
    .match({ user_playlist_id: playlistId, track_id: trackId });
  if (error) throw error;
}

export async function reorderUserPlaylistTracks(playlistId: string, trackIds: string[]) {
  const { error } = await supabase.rpc('reorder_user_playlist_tracks', {
    p_playlist_id: playlistId,
    p_track_ids: trackIds,
  });
  if (error) throw error;
}

export async function updateUserPlaylistMeta(
  playlistId: string,
  patch: { title?: string; description?: string | null; is_public?: boolean; thumbnail_url?: string | null },
) {
  const { error } = await supabase.from('user_playlists').update(patch).eq('id', playlistId);
  if (error) throw error;
}

export async function deleteUserPlaylist(playlistId: string) {
  const { error } = await supabase.from('user_playlists').delete().eq('id', playlistId);
  if (error) throw error;
}

export async function toggleUserPlaylistFollow(playlistId: string) {
  const { data, error } = await supabase.rpc('toggle_user_playlist_follow', { p_playlist_id: playlistId });
  if (error) throw error;
  return data as { ok: boolean; following: boolean };
}

export async function fetchFollowedUserPlaylists(): Promise<FollowedUserPlaylist[]> {
  const { data, error } = await supabase.rpc('get_followed_user_playlists');
  if (error) throw error;
  return (data ?? []) as FollowedUserPlaylist[];
}

export interface NewPublicPlaylist {
  id: string;
  title: string;
  category: string | null;
  thumbnail_url: string | null;
  source: 'catalog' | 'user';
  sort_at: string;
}

/** 홈 "신규 플레이리스트" — released 카탈로그 + 공개 user_playlists 통합 (created/released desc). */
export async function fetchNewPublicPlaylists(limit = 12): Promise<NewPublicPlaylist[]> {
  try {
    const { data, error } = await supabase.rpc('get_new_public_playlists', { p_limit: limit });
    if (error) throw error;
    return (data ?? []) as NewPublicPlaylist[];
  } catch {
    return [];
  }
}
