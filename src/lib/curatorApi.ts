/**
 * curatorApi.ts
 *
 * 큐레이터 프로필 + 통계 + 검색.
 * 0013 마이그레이션이 안 적용된 환경에서는 fetch 류가 빈 결과를 반환 (silent fallback).
 */

import { supabase } from './supabase';

export interface CuratorPlaylistSummary {
  id: string;
  title: string;
  thumbnail_url: string | null;
  category: string;
  follower_count: number;
  stream_count: number;
}

export interface CuratorProfile {
  user_id: string;
  display_name: string;
  handle: string;
  bio: string | null;
  profile_image_url: string | null;
  contact_email: string | null;
  instagram_url: string | null;
  youtube_url: string | null;
  website_url: string | null;
  allow_business_contact: boolean;
  is_verified: boolean;
  is_featured: boolean;
  created_at: string;
  follower_count: number;
  playlist_count: number;
  total_playlist_streams: number;
  monthly_streams: number;
  chart_entries: number;
  playlists: CuratorPlaylistSummary[];
}

export interface FeaturedCurator {
  user_id: string;
  display_name: string;
  handle: string;
  bio: string | null;
  profile_image_url: string | null;
  is_verified: boolean;
  is_featured: boolean;
  playlist_count: number;
  total_streams: number;
}

export interface CuratorSearchResult {
  user_id: string;
  display_name: string;
  handle: string;
  profile_image_url: string | null;
  is_verified: boolean;
}

export interface CuratorProfilePayload {
  display_name: string;
  handle: string;
  bio?: string | null;
  profile_image_url?: string | null;
  contact_email?: string | null;
  instagram_url?: string | null;
  youtube_url?: string | null;
  website_url?: string | null;
  allow_business_contact?: boolean;
}

export async function fetchCuratorProfile(handle: string): Promise<CuratorProfile | null> {
  try {
    const { data, error } = await supabase
      .rpc('get_curator_profile', { p_handle: handle.toLowerCase() })
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = data as unknown as CuratorProfile;
    return {
      ...row,
      follower_count: Number(row.follower_count ?? 0),
      playlist_count: Number(row.playlist_count ?? 0),
      total_playlist_streams: Number(row.total_playlist_streams ?? 0),
      monthly_streams: Number(row.monthly_streams ?? 0),
      chart_entries: Number(row.chart_entries ?? 0),
      playlists: Array.isArray(row.playlists) ? row.playlists : [],
    };
  } catch {
    return null;
  }
}

export async function fetchFeaturedCurators(limit = 12): Promise<FeaturedCurator[]> {
  try {
    const { data, error } = await supabase.rpc('get_featured_curators', {
      p_limit: limit,
    });
    if (error) throw error;
    return ((data ?? []) as FeaturedCurator[]).map((r) => ({
      ...r,
      playlist_count: Number(r.playlist_count ?? 0),
      total_streams: Number(r.total_streams ?? 0),
    }));
  } catch {
    return [];
  }
}

export async function searchCurators(query: string): Promise<CuratorSearchResult[]> {
  try {
    const { data, error } = await supabase.rpc('search_curators', { p_query: query });
    if (error) throw error;
    return (data ?? []) as CuratorSearchResult[];
  } catch {
    return [];
  }
}

/**
 * 본인 큐레이터 프로필 조회 (없으면 null).
 * ProfilePage 의 편집 폼 초기 로드용.
 */
export async function fetchMyCuratorProfile(
  userId: string,
): Promise<CuratorProfilePayload | null> {
  try {
    const { data, error } = await supabase
      .from('curator_profiles')
      .select(
        'display_name, handle, bio, profile_image_url, contact_email, ' +
          'instagram_url, youtube_url, website_url, allow_business_contact',
      )
      .eq('user_id', userId)
      .maybeSingle();
    if (error) return null;
    return data as CuratorProfilePayload | null;
  } catch {
    return null;
  }
}

/** Handle 유효성 (서버 정규식과 일치) */
export function isValidHandle(handle: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{1,30}[a-z0-9]$/.test(handle);
}

/** handle 중복 체크 — 본인 행은 제외 */
export async function isHandleAvailable(
  handle: string,
  selfUserId: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('curator_profiles')
      .select('user_id')
      .eq('handle', handle.toLowerCase())
      .maybeSingle();
    if (error) return true; // 모를 땐 통과 — insert/update 에서 unique 가 잡아냄
    return !data || data.user_id === selfUserId;
  } catch {
    return true;
  }
}

export async function upsertCuratorProfile(
  userId: string,
  payload: CuratorProfilePayload,
): Promise<{ ok: boolean; error?: string }> {
  if (!isValidHandle(payload.handle)) {
    return { ok: false, error: 'handle 형식이 올바르지 않아요 (영문/숫자/-/_ , 3~32자)' };
  }
  const ok = await isHandleAvailable(payload.handle, userId);
  if (!ok) return { ok: false, error: '이미 사용 중인 handle 이에요' };
  try {
    const { error } = await supabase.from('curator_profiles').upsert(
      {
        user_id: userId,
        display_name: payload.display_name.trim(),
        handle: payload.handle.toLowerCase(),
        bio: payload.bio ?? null,
        profile_image_url: payload.profile_image_url ?? null,
        contact_email: payload.contact_email ?? null,
        instagram_url: payload.instagram_url ?? null,
        youtube_url: payload.youtube_url ?? null,
        website_url: payload.website_url ?? null,
        allow_business_contact: payload.allow_business_contact ?? true,
      },
      { onConflict: 'user_id' },
    );
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}

/** Playlist 의 curator 작성자 조회 — PlaylistPage 의 큐레이터 카드용 */
export async function fetchPlaylistCurator(
  playlistId: string,
): Promise<{
  user_id: string;
  display_name: string;
  handle: string;
  profile_image_url: string | null;
  bio: string | null;
  is_verified: boolean;
} | null> {
  try {
    const { data, error } = await supabase
      .from('playlists')
      .select(
        'created_by_user_id, curator_profiles!playlists_created_by_user_id_fkey(' +
          'user_id, display_name, handle, profile_image_url, bio, is_verified)',
      )
      .eq('id', playlistId)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as unknown as {
      created_by_user_id: string | null;
      curator_profiles: {
        user_id: string;
        display_name: string;
        handle: string;
        profile_image_url: string | null;
        bio: string | null;
        is_verified: boolean;
      } | null;
    };
    return row.curator_profiles;
  } catch {
    return null;
  }
}
