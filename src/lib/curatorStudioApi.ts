import { supabase } from '@/lib/supabase';

export interface MyCuratorPlaylist {
  id: string;
  title: string;
  category: string;
  description: string | null;
  thumbnail_url: string | null;
  business_category: string | null;
  time_slot: string | null;
  is_business_only: boolean;
  status: 'draft' | 'released';
  released_at: string | null;
  created_at: string;
  track_count: number;
  follower_count: number;
}

export interface CuratorMadePlaylist {
  id: string;
  title: string;
  category: string;
  thumbnail_url: string | null;
  curator_user_id: string;
  curator_handle: string | null;
  curator_name: string | null;
  released_at: string | null;
  follower_count: number;
}

export async function createCuratorPlaylist(input: {
  title: string;
  category: string;
  description?: string | null;
  business_category?: string | null;
  time_slot?: string | null;
  is_business_only?: boolean;
  mood_tags?: string[];
  situation_tags?: string[];
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_curator_playlist', {
    p_title: input.title,
    p_category: input.category,
    p_description: input.description ?? null,
    p_business_category: input.business_category ?? null,
    p_time_slot: input.time_slot ?? null,
    p_is_business_only: input.is_business_only ?? false,
    p_mood_tags: input.mood_tags ?? [],
    p_situation_tags: input.situation_tags ?? [],
  });
  if (error) throw error;
  return data as string;
}

export async function releaseCuratorPlaylist(playlistId: string) {
  const { data, error } = await supabase.rpc('release_curator_playlist', {
    p_playlist_id: playlistId,
  });
  if (error) throw error;
  return data as { ok: boolean; status: string; track_count: number };
}

export async function unreleaseCuratorPlaylist(playlistId: string) {
  const { data, error } = await supabase.rpc('unrelease_curator_playlist', {
    p_playlist_id: playlistId,
  });
  if (error) throw error;
  return data as { ok: boolean; status: string };
}

/** released 상태에서도 썸네일만 변경 — RPC 경유 (released RLS 우회, 컬럼 제한). */
export async function updateCuratorPlaylistThumbnail(playlistId: string, thumbnailUrl: string) {
  const { data, error } = await supabase.rpc('update_curator_playlist_thumbnail', {
    p_playlist_id: playlistId,
    p_thumbnail_url: thumbnailUrl,
  });
  if (error) throw error;
  return data as { ok: boolean; thumbnail_url: string };
}

export async function fetchMyCuratorPlaylists(): Promise<MyCuratorPlaylist[]> {
  const { data, error } = await supabase.rpc('get_my_curator_playlists');
  if (error) throw error;
  return (data ?? []) as MyCuratorPlaylist[];
}

export async function fetchCuratorMadePlaylists(limit = 8): Promise<CuratorMadePlaylist[]> {
  try {
    const { data, error } = await supabase.rpc('get_curator_made_playlists', { p_limit: limit });
    if (error) throw error;
    return (data ?? []) as CuratorMadePlaylist[];
  } catch {
    // 0098 미적용 등 — 조용히 빈 배열 (홈 섹션 숨김)
    return [];
  }
}
