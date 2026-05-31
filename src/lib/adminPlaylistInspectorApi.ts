/**
 * adminPlaylistInspectorApi.ts — Phase 0262
 * 관리자 플레이리스트 상세 화면: 곡 메타 quick edit, soft remove, status 변경, fit 재계산.
 */
import { supabase } from '@/lib/supabase';

export type FitStatus = 'active' | 'review_needed' | 'excluded';

export interface InspectorTrack {
  pt_id: string;
  order_index: number;
  placement_reason: string | null;
  placed_by: string | null;
  removed_at: string | null;
  removed_by: string | null;
  removed_reason: string | null;
  track_id: string;
  title: string;
  artist: string | null;
  cover_url: string | null;
  main_genre: string | null;
  sub_genre: string | null;
  mood: string | null;
  mood_tags: string[] | null;
  genre_tags: string[] | null;
  suitable_store: string | null;
  business_tags: string[] | null;
  bpm: number | null;
  energy_level: number | null;
  instrumental: boolean | null;
  explicit_content: boolean | null;
  language: string | null;
  vocal_type: string | null;
  admin_note: string | null;
  duration: number | null;
  af_energy: number | null;
  af_instrumentalness: number | null;
  af_acousticness: number | null;
  af_speechiness: number | null;
  af_danceability: number | null;
  af_valence: number | null;
  af_analyzer: string | null;
  fit_score: number | null;
  fit_status: FitStatus | null;
  fit_source: string | null;
  reason: string | null;
  reason_codes: string[] | null;
  audio_score: number | null;
  metadata_score: number | null;
  behavior_score: number | null;
  penalty_score: number | null;
  normalized_store_slug: string | null;
}

export interface InspectorResult {
  playlist: Record<string, unknown> | null;
  tracks: InspectorTrack[];
}

export async function adminGetPlaylistInspector(
  playlistId: string,
  includeRemoved = false,
): Promise<InspectorResult> {
  const { data, error } = await supabase.rpc('admin_get_playlist_inspector', {
    p_playlist_id: playlistId,
    p_include_removed: includeRemoved,
  });
  if (error) throw error;
  return (data ?? { playlist: null, tracks: [] }) as InspectorResult;
}

export interface TrackMetadataPayload {
  main_genre?: string | null;
  sub_genre?: string | null;
  mood?: string | null;
  mood_tags?: string[];
  genre_tags?: string[];
  suitable_store?: string | null;
  business_tags?: string[];
  energy_level?: number | null;
  instrumental?: boolean;
  vocal_type?: string | null;
  explicit_content?: boolean;
  language?: string | null;
  admin_note?: string | null;
}

export async function adminUpdateTrackMetadata(
  trackId: string,
  payload: TrackMetadataPayload,
  reason?: string,
): Promise<{ ok: true; before: Record<string, unknown>; after: Record<string, unknown> }> {
  const { data, error } = await supabase.rpc('admin_update_track_metadata', {
    p_track_id: trackId,
    p_payload: payload,
    p_reason: reason ?? null,
  });
  if (error) throw error;
  return data as { ok: true; before: Record<string, unknown>; after: Record<string, unknown> };
}

export async function adminRemoveTrackFromPlaylist(
  playlistId: string,
  trackId: string,
  reason?: string,
): Promise<{ ok: true; pt_id: string }> {
  const { data, error } = await supabase.rpc('admin_remove_track_from_playlist', {
    p_playlist_id: playlistId,
    p_track_id: trackId,
    p_reason: reason ?? null,
  });
  if (error) throw error;
  return data as { ok: true; pt_id: string };
}

export async function adminRestoreTrackToPlaylist(
  ptId: string,
  reason?: string,
): Promise<{ ok: true }> {
  const { data, error } = await supabase.rpc('admin_restore_track_to_playlist', {
    p_pt_id: ptId,
    p_reason: reason ?? null,
  });
  if (error) throw error;
  return data as { ok: true };
}

export async function adminChangeTrackFitStatus(
  playlistId: string,
  trackId: string,
  status: FitStatus,
  reason?: string,
  adminNote?: string,
): Promise<{ ok: true; status: FitStatus }> {
  const { data, error } = await supabase.rpc('admin_change_track_fit_status', {
    p_playlist_id: playlistId,
    p_track_id: trackId,
    p_status: status,
    p_reason: reason ?? null,
    p_admin_note: adminNote ?? null,
  });
  if (error) throw error;
  return data as { ok: true; status: FitStatus };
}

export interface RecomputeResult {
  ok: true;
  before: { fit_score: number | null; status: string | null; reason_codes: string[] | null } | null;
  after:  { fit_score: number | null; status: string | null; reason_codes: string[] | null } | null;
  auto_place: Record<string, unknown> | null;
}

export async function adminRecomputeTrackFit(
  playlistId: string,
  trackId: string,
  alsoAutoPlace = false,
): Promise<RecomputeResult> {
  const { data, error } = await supabase.rpc('admin_recompute_track_fit', {
    p_playlist_id: playlistId,
    p_track_id: trackId,
    p_also_auto_place: alsoAutoPlace,
  });
  if (error) throw error;
  return data as RecomputeResult;
}

export interface AuditLogRow {
  id: string;
  admin_user_id: string;
  admin_name: string | null;
  track_id: string;
  playlist_id: string | null;
  action_type: 'metadata_update' | 'playlist_remove' | 'status_change' | 'fit_score_recalculate' | 'playlist_restore';
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  reason: string | null;
  created_at: string;
}

export async function adminListTrackAudit(
  trackId?: string | null,
  playlistId?: string | null,
  limit = 50,
): Promise<AuditLogRow[]> {
  const { data, error } = await supabase.rpc('admin_list_track_audit', {
    p_track_id: trackId ?? null,
    p_playlist_id: playlistId ?? null,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as AuditLogRow[];
}
