import { supabase } from './supabase';

export interface AutoPlaylistRow {
  id: string;
  title: string;
  subtitle: string | null;
  business_category: string | null;
  daypart: string | null;
  mood_tags: string[];
  genre_tags: string[];
  bpm_min: number | null;
  bpm_max: number | null;
  energy_min: number | null;
  energy_max: number | null;
  vocal_preference: string | null;
  priority_score: number;
  status: string;
  track_count: number;
  auto_count: number;
}

export interface PlacedTrack {
  track_id: string;
  title: string;
  artist: string | null;
  cover_url: string | null;
  match_score: number | null;
  placement_reason: string | null;
  placed_by: 'auto' | 'manual' | 'admin';
  order_index: number;
  release_status: string | null;
}

export async function adminGenerateAutoPlaylists(): Promise<{ ok: boolean; created: number }> {
  const { data, error } = await supabase.rpc('admin_generate_auto_playlists');
  if (error) throw error;
  return data as { ok: boolean; created: number };
}

export async function adminRunAutoPlacement(trackId?: string | null): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('admin_run_auto_placement', { p_track_id: trackId ?? null });
  if (error) throw error;
  return data as Record<string, unknown>;
}

export async function adminListAutoPlaylists(): Promise<AutoPlaylistRow[]> {
  const { data, error } = await supabase.rpc('admin_list_auto_playlists');
  if (error) throw error;
  return (data ?? []) as AutoPlaylistRow[];
}

export async function adminPlaylistPlacedTracks(playlistId: string): Promise<PlacedTrack[]> {
  const { data, error } = await supabase.rpc('admin_playlist_placed_tracks', { p_playlist_id: playlistId });
  if (error) throw error;
  return (data ?? []) as PlacedTrack[];
}

export async function adminAddTrackToPlaylist(playlistId: string, trackId: string, reason?: string) {
  const { error } = await supabase.rpc('admin_add_track_to_playlist', {
    p_playlist_id: playlistId, p_track_id: trackId, p_reason: reason ?? null,
  });
  if (error) throw error;
}

export async function adminRemovePlacedTrack(playlistId: string, trackId: string) {
  const { error } = await supabase.rpc('admin_remove_placed_track', {
    p_playlist_id: playlistId, p_track_id: trackId,
  });
  if (error) throw error;
}

export async function setAutoPlacementEnabled(enabled: boolean): Promise<{ ok: boolean; enabled: boolean }> {
  const { data, error } = await supabase.rpc('set_auto_placement_enabled', { p_enabled: enabled });
  if (error) throw error;
  return data as { ok: boolean; enabled: boolean };
}

export async function getAutoPlacementEnabled(): Promise<boolean> {
  const { data, error } = await supabase.from('admin_settings').select('value').eq('key', 'auto_placement_enabled').maybeSingle();
  if (error) return true;
  const v = (data as { value?: unknown } | null)?.value;
  return v === false || v === 'false' ? false : true;
}
