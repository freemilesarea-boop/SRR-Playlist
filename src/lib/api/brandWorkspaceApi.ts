// Phase ENT-OS-2 — Brand Workspace / Playlist Engine RPC 래퍼.
// 0409 admin_get_brand_workspace + brand playlist CRUD. 모두 super_admin RPC 경유.
import { supabase } from '@/lib/supabase';
import type { BrandMusicPolicy, BrandVocalPolicy } from '@/types/brand';

export type BrandPlaylistType = 'manual' | 'auto';
export type BrandPlaylistStatus = 'active' | 'inactive';

export interface BrandPlaylistRow {
  id: string;
  name: string;
  description: string | null;
  type: BrandPlaylistType;
  version: number;
  status: BrandPlaylistStatus;
  created_at: string;
  updated_at: string | null;
  track_count: number;
}

export interface BrandWorkspaceOverview {
  connected_store_count: number;
  connected_region_count: number;
  player_session_count: number;
  media_count: number;
  active_media_count: number;
  playlist_count: number;
  available_track_count: number;
  music_policy_set: boolean;
  ai_profile_set: boolean;
  store_invite_code: string | null;
  health_score: number;
}

export interface BrandWorkspacePlaylistSummary {
  total: number;
  active: number;
  manual: number;
  auto: number;
}

export interface BrandWorkspaceMediaAsset {
  id: string;
  asset_type: string;
  title: string | null;
  image_url: string;
  display_duration_seconds: number | null;
  sort_order: number | null;
  status: string | null;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface BrandWorkspaceSession {
  id: string;
  last_seen_at: string | null;
  playback_started_at: string | null;
  user_agent: string | null;
  current_track_id: string | null;
  created_at: string;
}

export interface BrandWorkspacePlayer {
  store_invite_code: string | null;
  enterprise_name: string | null;
  session_summary: { total: number; active_recent: number; last_24h: number };
  now_playing: { track_id: string; title: string | null; artist: string | null; last_seen_at: string | null } | null;
  sessions: BrandWorkspaceSession[];
  media_asset_count: number;
}

/** AI Profile — 현재는 brand_music_policies + 후속 예약 필드(null). Read-only. */
export interface BrandWorkspaceAiProfile extends Pick<BrandMusicPolicy,
  'preferred_genres' | 'blocked_genres' | 'preferred_moods' | 'blocked_moods' |
  'energy_min' | 'energy_max' | 'auto_generate_enabled' | 'daypart_policy'> {
  industry_type: string | null;
  vocal_policy: BrandVocalPolicy | null;
  // 후속 AI Music OS 예약 (현재 미저장)
  weather_rule: unknown | null;
  holiday_rule: unknown | null;
  schedule_rule: unknown | null;
  auto_media: boolean | null;
  auto_rotation: boolean | null;
}

export interface BrandWorkspaceHistoryEntry {
  id: string;
  action: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface BrandWorkspace {
  brand: {
    id: string;
    name: string;
    enterprise_account_id: string | null;
    enterprise_name: string | null;
    industry_type: string | null;
    status: string;
    description: string | null;
    created_at: string;
    updated_at: string | null;
  };
  overview: BrandWorkspaceOverview;
  playlists: BrandPlaylistRow[];
  playlist_summary: BrandWorkspacePlaylistSummary;
  media: BrandWorkspaceMediaAsset[];
  player: BrandWorkspacePlayer;
  ai_profile: BrandWorkspaceAiProfile | null;
  history: BrandWorkspaceHistoryEntry[];
}

/** 관리자 전용 Brand Workspace 통합 조회. */
export async function adminGetBrandWorkspace(brandId: string): Promise<BrandWorkspace> {
  const { data, error } = await supabase.rpc('admin_get_brand_workspace', { p_brand_id: brandId });
  if (error) { console.error('[brandWorkspaceApi] admin_get_brand_workspace failed', error); throw error; }
  return data as BrandWorkspace;
}

// ── Playlist CRUD ────────────────────────────────────────────────────
export async function adminCreateBrandPlaylist(input: {
  brandId: string; name: string; description?: string | null;
  type: BrandPlaylistType; trackIds?: string[] | null;
}): Promise<{ success: boolean; id: string; track_count: number }> {
  const { data, error } = await supabase.rpc('admin_create_brand_playlist', {
    p_brand_id: input.brandId,
    p_name: input.name,
    p_description: input.description ?? null,
    p_type: input.type,
    p_track_ids: input.trackIds ?? null,
  });
  if (error) throw error;
  return data as { success: boolean; id: string; track_count: number };
}

export async function adminUpdateBrandPlaylist(input: {
  playlistId: string; name?: string | null; description?: string | null; status?: BrandPlaylistStatus | null;
}): Promise<{ success: boolean }> {
  const { data, error } = await supabase.rpc('admin_update_brand_playlist', {
    p_playlist_id: input.playlistId,
    p_name: input.name ?? null,
    p_description: input.description ?? null,
    p_status: input.status ?? null,
  });
  if (error) throw error;
  return data as { success: boolean };
}

export async function adminSetBrandPlaylistTracks(playlistId: string, trackIds: string[]): Promise<{ success: boolean; track_count: number; version: number }> {
  const { data, error } = await supabase.rpc('admin_set_brand_playlist_tracks', {
    p_playlist_id: playlistId, p_track_ids: trackIds,
  });
  if (error) throw error;
  return data as { success: boolean; track_count: number; version: number };
}

export async function adminCloneBrandPlaylist(playlistId: string): Promise<{ success: boolean; id: string }> {
  const { data, error } = await supabase.rpc('admin_clone_brand_playlist', { p_playlist_id: playlistId });
  if (error) throw error;
  return data as { success: boolean; id: string };
}

export async function adminDeleteBrandPlaylist(playlistId: string, deleted = true): Promise<{ success: boolean }> {
  const { data, error } = await supabase.rpc('admin_delete_brand_playlist', { p_playlist_id: playlistId, p_deleted: deleted });
  if (error) throw error;
  return data as { success: boolean };
}

export async function adminRegenerateBrandPlaylist(playlistId: string): Promise<{ success: boolean; track_count: number; version: number }> {
  const { data, error } = await supabase.rpc('admin_regenerate_brand_playlist', { p_playlist_id: playlistId });
  if (error) throw error;
  return data as { success: boolean; track_count: number; version: number };
}
