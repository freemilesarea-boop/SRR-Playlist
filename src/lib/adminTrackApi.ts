/**
 * adminTrackApi.ts — admin 트랙 관리 (메타데이터 수정 + 완전 삭제).
 */
import { supabase } from './supabase';

export interface AdminTrackDetail {
  id: string;
  // 식별
  title: string;
  artist: string | null;
  album_name: string | null;
  release_title: string | null;
  release_type: string | null;
  release_date: string | null;
  release_status: string | null;
  visibility_status: string | null;
  removed_at: string | null;
  removed_reason: string | null;
  source_type: string | null;
  source_label: string | null;
  // 아티스트 메타
  main_genre: string | null;
  sub_genre: string | null;
  mood: string | null;
  suitable_store: string | null;
  lyrics: string | null;
  lyric_type: string | null;
  isrc: string | null;
  rights_holder_name: string | null;
  language: string | null;
  explicit_content: boolean | null;
  instrumental: boolean | null;
  // 태깅 (배열)
  genre_tags: string[] | null;
  mood_tags: string[] | null;
  business_tags: string[] | null;
  business_type_tags: string[] | null;
  recommended_dayparts: string[] | null;
  time_slots: string[] | null;
  situation_tags: string[] | null;
  season_tags: string[] | null;
  // 보컬/감정
  vocal_type: string | null;
  vocal_presence: number | null;
  emotional_intensity: number | null;
  brightness_level: number | null;
  // 음원 분석 (admin 수정 가능)
  energy_level: number | null;
  bpm: number | null;
  tempo_feel: string | null;
  // AI 예측 (참고)
  ai_predicted_energy_level: number | null;
  ai_energy_confidence: number | null;
  ai_predicted_bpm: number | null;
  ai_predicted_tempo_feel: string | null;
  ai_predicted_at: string | null;
  ai_applied_at: string | null;
  // 미디어/품질
  audio_url: string | null;
  cover_url: string | null;
  duration: number | null;
  audio_health_status: string | null;
  audio_review_status: string | null;
  cover_review_status: string | null;
  metadata_review_status: string | null;
  metadata_source: string | null;
  // 시간
  created_at: string;
  submitted_at: string | null;
  approved_at: string | null;
  released_at: string | null;
}

export async function getAdminTrackDetail(trackId: string): Promise<AdminTrackDetail | null> {
  const { data, error } = await supabase.rpc('get_admin_track_detail', { p_track_id: trackId });
  if (error) throw error;
  const arr = data as AdminTrackDetail[] | null;
  return arr?.[0] ?? null;
}

export interface AdminTrackPurgeResult {
  track_id: string;
  audio_bucket: string;
  audio_path: string | null;
  cover_bucket: string;
  cover_path: string | null;
  mode: 'hard' | 'soft_due_to_revenue';
}

export async function adminHardDeleteTrack(trackId: string): Promise<AdminTrackPurgeResult> {
  const { data, error } = await supabase.rpc('admin_hard_delete_track', { p_track_id: trackId });
  if (error) throw error;
  const row = (data as AdminTrackPurgeResult[] | null)?.[0];
  if (!row) throw new Error('삭제 응답이 비어있어요.');
  if (row.audio_path) {
    try { await supabase.storage.from(row.audio_bucket).remove([row.audio_path]); } catch { /* ignore */ }
  }
  if (row.cover_path) {
    try { await supabase.storage.from(row.cover_bucket).remove([row.cover_path]); } catch { /* ignore */ }
  }
  return row;
}

export interface AdminTrackMetadataFullInput {
  title?: string | null;
  artist?: string | null;
  album_name?: string | null;
  main_genre?: string | null;
  sub_genre?: string | null;
  mood?: string | null;
  suitable_store?: string | null;
  lyrics?: string | null;
  language?: string | null;
  explicit_content?: boolean | null;
  instrumental?: boolean | null;
  energy_level?: number | null;
  bpm?: number | null;
  tempo_feel?: string | null;
  vocal_type?: string | null;
  vocal_presence?: number | null;
  emotional_intensity?: number | null;
  brightness_level?: number | null;
  genre_tags?: string[] | null;
  mood_tags?: string[] | null;
  business_tags?: string[] | null;
  recommended_dayparts?: string[] | null;
  time_slots?: string[] | null;
  situation_tags?: string[] | null;
  season_tags?: string[] | null;
}

export async function adminUpdateTrackMetadataFull(
  trackId: string,
  input: AdminTrackMetadataFullInput,
): Promise<void> {
  const { error } = await supabase.rpc('admin_update_track_metadata_full', {
    p_track_id: trackId,
    p_title: input.title ?? null,
    p_artist: input.artist ?? null,
    p_album_name: input.album_name ?? null,
    p_main_genre: input.main_genre ?? null,
    p_sub_genre: input.sub_genre ?? null,
    p_mood: input.mood ?? null,
    p_suitable_store: input.suitable_store ?? null,
    p_lyrics: input.lyrics ?? null,
    p_language: input.language ?? null,
    p_explicit_content: input.explicit_content ?? null,
    p_instrumental: input.instrumental ?? null,
    p_energy_level: input.energy_level ?? null,
    p_bpm: input.bpm ?? null,
    p_tempo_feel: input.tempo_feel ?? null,
    p_vocal_type: input.vocal_type ?? null,
    p_vocal_presence: input.vocal_presence ?? null,
    p_emotional_intensity: input.emotional_intensity ?? null,
    p_brightness_level: input.brightness_level ?? null,
    p_genre_tags: input.genre_tags ?? null,
    p_mood_tags: input.mood_tags ?? null,
    p_business_tags: input.business_tags ?? null,
    p_recommended_dayparts: input.recommended_dayparts ?? null,
    p_time_slots: input.time_slots ?? null,
    p_situation_tags: input.situation_tags ?? null,
    p_season_tags: input.season_tags ?? null,
  });
  if (error) throw error;
}

export interface AdminTrackWithAi {
  id: string;
  title: string;
  artist: string | null;
  audio_url: string;
  cover_url: string | null;
  duration: number | null;
  created_at: string;
  main_genre: string | null;
  sub_genre: string | null;
  mood: string | null;
  energy_level: number | null;
  bpm: number | null;
  tempo_feel: string | null;
  ai_predicted_energy_level: number | null;
  ai_energy_confidence: number | null;
  ai_predicted_bpm: number | null;
  ai_predicted_tempo_feel: string | null;
  ai_applied_at: string | null;
}

export async function listAdminTracksWithAi(limit = 1000): Promise<AdminTrackWithAi[]> {
  const { data, error } = await supabase.rpc('list_admin_tracks_with_ai', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as AdminTrackWithAi[];
}

export interface AiCorrectionStat {
  field_name: string;
  total_corrections: number;
  exact_matches: number;
  changed: number;
  accuracy_pct: number | null;
  avg_numeric_delta: number | null;
  recent_corrections: number;
}

export async function aiCorrectionStats(): Promise<AiCorrectionStat[]> {
  const { data, error } = await supabase.rpc('ai_correction_stats');
  if (error) throw error;
  return (data ?? []) as AiCorrectionStat[];
}

// legacy alias — 기존 호출 (간단 모드) 위해 유지
export type AdminTrackMetadataInput = AdminTrackMetadataFullInput;
export const adminUpdateTrackMetadata = adminUpdateTrackMetadataFull;

