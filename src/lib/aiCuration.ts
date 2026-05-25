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
  | 'gym_fit'
  | 'gym_unfit'
  | 'cafe_fit'
  | 'yoga_hospital_unfit'
  | 'kids_risk'
  | 'heuristic'
  | 'real_dsp'
  | 'review_needed';

export interface StoreProfileOption { store_key: string; store_label: string; }
export async function listStoreProfiles(): Promise<StoreProfileOption[]> {
  const { data, error } = await supabase.rpc('admin_list_store_profiles');
  if (error) throw error;
  return (data ?? []) as StoreProfileOption[];
}
export async function setPlaylistStoreKey(playlistId: string, storeKey: string | null): Promise<void> {
  const { error } = await supabase.rpc('admin_set_playlist_store_key', { p_playlist_id: playlistId, p_store_key: storeKey });
  if (error) throw error;
}

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
  analysis_version: string | null;
  bpm: number | null;
  energy: number | null;
  danceability: number | null;
  acousticness: number | null;
  instrumentalness: number | null;
  vocal_presence: number | null;
  brightness: number | null;
  tempo_stability: number | null;
  spectral_centroid: number | null;
  loudness: number | null;
  dynamic_range: number | null;
  raw_features: Record<string, number> | null;
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

// #8 — 자동배치 안전장치: pending 제안 → 관리자 승인 시에만 playlist_tracks 추가
export interface AiSuggestion {
  id: string;
  track_id: string;
  fit_score: number;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected';
  title: string | null;
  artist: string | null;
  cover_url: string | null;
}
export async function generateAiSuggestions(playlistId: string): Promise<{ suggestions: number }> {
  const { data, error } = await supabase.rpc('admin_generate_ai_suggestions', { p_playlist_id: playlistId });
  if (error) throw error;
  return data as { suggestions: number };
}
export async function listAiSuggestions(playlistId: string, status = 'pending'): Promise<AiSuggestion[]> {
  const { data, error } = await supabase.rpc('admin_list_ai_suggestions', { p_playlist_id: playlistId, p_status: status });
  if (error) throw error;
  return (data ?? []) as AiSuggestion[];
}
export async function decideAiSuggestion(id: string, approve: boolean): Promise<void> {
  const { error } = await supabase.rpc('admin_decide_ai_suggestion', { p_id: id, p_approve: approve });
  if (error) throw error;
}

// #6 — 통합 위반 (skip + AI mismatch)
export interface UnifiedViolation {
  id: string;
  source: 'skip' | 'ai';
  track_id: string;
  playlist_id: string | null;
  title: string | null;
  artist: string | null;
  violation_type: string;
  severity: 'low' | 'medium' | 'high';
  skip_count: number | null;
  mismatch_score: number | null;
  status: string;
  reason: string | null;
  detected_at: string | null;
  admin_note: string | null;
}
export async function listUnifiedViolations(limit = 200): Promise<UnifiedViolation[]> {
  const { data, error } = await supabase.rpc('admin_list_unified_violations', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as UnifiedViolation[];
}

// #7 — 가중치 설정
export interface AiScoringConfig {
  fit_audio_w: number; fit_meta_w: number; fit_behavior_w: number; fit_penalty_w: number;
  mismatch_threshold: number; fit_recommend_cutoff: number; fit_exclude_cutoff: number; store_exclude_threshold: number;
}
export async function getAiScoringConfig(): Promise<AiScoringConfig> {
  const { data, error } = await supabase.rpc('get_ai_scoring_config');
  if (error) throw error;
  return data as AiScoringConfig;
}
export async function updateAiScoringConfig(patch: Partial<AiScoringConfig>): Promise<AiScoringConfig> {
  const { data, error } = await supabase.rpc('admin_update_ai_scoring_config', { p_patch: patch });
  if (error) throw error;
  return data as AiScoringConfig;
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

// 운영 성과 대시보드 (track_play_events 기반, 정산 stream_events 와 분리)
export interface PlayEventStats {
  total_plays: number; total_skips: number; total_completes: number;
  total_likes: number; total_errors: number;
  avg_completion_rate: number; avg_skip_rate: number; days: number;
}
export async function playEventStats(days = 30): Promise<PlayEventStats> {
  const { data, error } = await supabase.rpc('admin_play_event_stats', { p_days: days });
  if (error) throw error;
  return data as PlayEventStats;
}

export interface TrackPerformanceRow {
  track_id: string; playlist_id: string | null; title: string | null; artist: string | null; playlist_title: string | null;
  play_count: number; skip_count: number; complete_count: number; like_count: number; error_count: number;
  avg_played_seconds: number; skip_rate: number; completion_rate: number; like_rate: number;
  behavior_score: number; fit_score: number | null; mismatch_score: number | null;
}
export type PerfSort = 'skip_rate' | 'completion_rate' | 'fit_low' | 'mismatch';
export async function trackPerformance(days = 30, sort: PerfSort = 'skip_rate', limit = 100): Promise<TrackPerformanceRow[]> {
  const { data, error } = await supabase.rpc('admin_track_performance', { p_days: days, p_sort: sort, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as TrackPerformanceRow[];
}

export interface PlaylistPerformanceRow {
  playlist_id: string; playlist_title: string | null;
  total_plays: number; total_skips: number; total_completes: number;
  avg_skip_rate: number; avg_completion_rate: number; review_needed_count: number;
}
export async function playlistPerformance(days = 30): Promise<PlaylistPerformanceRow[]> {
  const { data, error } = await supabase.rpc('admin_playlist_performance', { p_days: days });
  if (error) throw error;
  return (data ?? []) as PlaylistPerformanceRow[];
}

export async function registerSkipViolations(): Promise<{ registered: number }> {
  const { data, error } = await supabase.rpc('admin_register_skip_violations');
  if (error) throw error;
  return data as { registered: number };
}

// 임베딩 PoC — export(pending) / import(검증 후 upsert, dry-run 지원)
export interface EmbeddingPendingRow { track_id: string; title: string | null; artist: string | null; audio_url: string | null; duration: number | null; }
export async function exportEmbeddingPending(model = 'openl3', limit = 500): Promise<EmbeddingPendingRow[]> {
  const { data, error } = await supabase.rpc('admin_export_embedding_pending_tracks', { p_model: model, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as EmbeddingPendingRow[];
}
export interface EmbeddingImportResult {
  ok: boolean; dry_run: boolean; imported: number; skipped: number;
  errors: Array<{ track_id: string; reason: string }>;
}
export async function importTrackEmbeddings(rows: unknown[], dryRun: boolean): Promise<EmbeddingImportResult> {
  const { data, error } = await supabase.rpc('admin_import_track_embeddings', { p_rows: rows, p_dry_run: dryRun });
  if (error) throw error;
  return data as EmbeddingImportResult;
}
