/**
 * aiCuration.ts — AI 큐레이션 엔진 클라이언트 API (관리자).
 * 스코어링 규칙은 서버(SQL RPC)에 단일 구현. 여기서는 호출 래퍼만 제공.
 */
import { supabase } from '@/lib/supabase';
import type { AudioFeatureValues } from '@/lib/audioAnalysis';

export type CurationFilter =
  | 'all'
  | 'pending'
  | 'analyzed'
  | 'failed'
  | 'mismatch_high'
  | 'gym_unfit'
  | 'cafe_fit'
  | 'review_needed';

export interface AiCurationRow {
  track_id: string;
  title: string | null;
  artist: string | null;
  cover_url: string | null;
  audio_url: string | null;
  duration: number | null;
  main_genre: string | null;
  genre_tags: string[] | null;
  mood: string | null;
  mood_tags: string[] | null;
  business_type_tags: string[] | null;
  registrant_energy: number | null;
  registrant_bpm: number | null;
  feature_status: string | null;
  analyzer: string | null;
  bpm: number | null;
  energy: number | null;
  danceability: number | null;
  acousticness: number | null;
  instrumentalness: number | null;
  vocal_presence: number | null;
  brightness: number | null;
  tempo_stability: number | null;
  error_message: string | null;
  ai_status: string | null;
  ai_energy_level: string | null;
  ai_store_fit: Record<string, number> | null;
  ai_exclusions: string[] | null;
  ai_moods: string[] | null;
  ai_situations: string[] | null;
  mismatch_score: number | null;
  mismatch_reasons: string[] | null;
  explanation: string | null;
  metadata_confidence: number | null;
  reviewed_at: string | null;
}

export async function listAiCuration(filter: CurationFilter = 'all', limit = 100, offset = 0): Promise<AiCurationRow[]> {
  const { data, error } = await supabase.rpc('admin_list_ai_curation', { p_filter: filter, p_limit: limit, p_offset: offset });
  if (error) throw error;
  return (data ?? []) as AiCurationRow[];
}

/** 분석기/mock 가 추출한 오디오 피처를 저장 → 서버가 AI 메타데이터 자동 재계산 */
export async function setTrackAudioFeatures(trackId: string, features: AudioFeatureValues): Promise<void> {
  const { error } = await supabase.rpc('admin_set_track_audio_features', { p_track_id: trackId, p_features: features });
  if (error) throw error;
}

export async function markAnalysisFailed(trackId: string, errorMsg: string): Promise<void> {
  const { error } = await supabase.rpc('admin_mark_audio_analysis_failed', { p_track_id: trackId, p_error: errorMsg });
  if (error) throw error;
}

export async function recomputeTrackAiMetadata(trackId: string): Promise<void> {
  const { error } = await supabase.rpc('recompute_track_ai_metadata', { p_track_id: trackId });
  if (error) throw error;
}

export async function recomputeTrackFitScores(trackId: string): Promise<void> {
  const { error } = await supabase.rpc('recompute_track_fit_scores', { p_track_id: trackId });
  if (error) throw error;
}

export async function recomputePlaylistFitScores(playlistId: string): Promise<{ tracks_scored: number }> {
  const { data, error } = await supabase.rpc('recompute_playlist_fit_scores', { p_playlist_id: playlistId });
  if (error) throw error;
  return data as { tracks_scored: number };
}

export async function applyAiMetadata(
  trackId: string,
  opts: { genres?: string[] | null; moods?: string[] | null; situations?: string[] | null },
): Promise<void> {
  const { error } = await supabase.rpc('admin_apply_ai_metadata', {
    p_track_id: trackId,
    p_genres: opts.genres ?? null,
    p_moods: opts.moods ?? null,
    p_situations: opts.situations ?? null,
  });
  if (error) throw error;
}

export interface FitScoreRow {
  track_id: string;
  fit_score: number;
  audio_score: number;
  metadata_score: number;
  behavior_score: number;
  penalty_score: number;
  reason: string;
  status: string;
  title: string | null;
  artist: string | null;
  cover_url: string | null;
}

export async function getAiRecommendedTracksForPlaylist(playlistId: string, limit = 50): Promise<FitScoreRow[]> {
  const { data, error } = await supabase.rpc('get_ai_recommended_tracks_for_playlist', { p_playlist_id: playlistId, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as FitScoreRow[];
}

export async function getTracksNeedingAiReview(): Promise<unknown[]> {
  const { data, error } = await supabase.rpc('get_tracks_needing_ai_review');
  if (error) throw error;
  return (data ?? []) as unknown[];
}

export interface PlayEventInput {
  trackId: string;
  playlistId?: string | null;
  eventType: 'play' | 'start' | 'skip' | 'complete' | 'like' | 'unlike' | 'error';
  played?: number | null;
  duration?: number | null;
  skipReason?: string | null;
  device?: string | null;
  anonId?: string | null;
}

/** 사용자 반응 이벤트 기록 (best-effort, fire-and-forget) */
export async function recordPlayEvent(input: PlayEventInput): Promise<void> {
  try {
    await supabase.rpc('record_play_event', {
      p_track_id: input.trackId,
      p_playlist_id: input.playlistId ?? null,
      p_event_type: input.eventType,
      p_played: input.played ?? null,
      p_duration: input.duration ?? null,
      p_skip_reason: input.skipReason ?? null,
      p_device: input.device ?? null,
      p_anon_id: input.anonId ?? null,
    });
  } catch {
    /* fire-and-forget */
  }
}
