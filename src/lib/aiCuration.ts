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

// 임베딩 검증 (heuristic vs embedding 비교 + 리뷰 액션)
export interface EmbeddingReviewRow {
  track_id: string; title: string | null; artist: string | null; cover_url: string | null; created_at: string;
  embedding_status: string; model_name: string | null; model_version: string | null; embedding_dim: number | null;
  error_message: string | null; ai_status: string | null; disagreement_score: number | null;
  has_embedding: boolean | null; review_status: string | null;
}
export interface EmbeddingComparison {
  track_id: string; embedding_status: string; model_name: string | null; model_version: string | null;
  embedding_dim: number | null; confidence: number | null; error_message: string | null; embedded_at: string | null;
  has_embedding: boolean; disagreement_score: number | null; suspected_issues: string[];
  heuristic_top5: Array<{ store_key: string; score: number }>;
  embedding_top5: Array<{ store_key: string; similarity: number }>;
  ai_status: string | null;
}
export async function listEmbeddingReviewTracks(filter = 'all', model = 'openl3', limit = 150): Promise<EmbeddingReviewRow[]> {
  const { data, error } = await supabase.rpc('admin_list_embedding_review_tracks', { p_filter: filter, p_model: model, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as EmbeddingReviewRow[];
}
export async function getEmbeddingComparison(trackId: string, model = 'openl3'): Promise<EmbeddingComparison> {
  const { data, error } = await supabase.rpc('admin_get_embedding_comparison', { p_track_id: trackId, p_model: model });
  if (error) throw error;
  return data as EmbeddingComparison;
}
export async function markEmbeddingReviewed(trackId: string, model = 'openl3', note?: string): Promise<void> {
  const { error } = await supabase.rpc('admin_mark_embedding_reviewed', { p_track_id: trackId, p_model: model, p_note: note ?? null });
  if (error) throw error;
}
export async function markEmbeddingReanalysisNeeded(trackId: string, model = 'openl3', note?: string): Promise<void> {
  const { error } = await supabase.rpc('admin_mark_embedding_reanalysis_needed', { p_track_id: trackId, p_model: model, p_note: note ?? null });
  if (error) throw error;
}
export async function addStoreSeedCandidate(trackId: string, storeKey: string, model = 'openl3'): Promise<void> {
  const { error } = await supabase.rpc('admin_add_store_seed_candidate', { p_track_id: trackId, p_store_key: storeKey, p_model: model });
  if (error) throw error;
}
export async function applyEmbeddingToAiMetadata(trackId: string, model = 'openl3'): Promise<void> {
  const { error } = await supabase.rpc('admin_apply_embedding_to_ai_metadata', { p_track_id: trackId, p_model: model });
  if (error) throw error;
}

// Hard Guardrails — 매장별 절대 금지 규칙 위반/차단 + 관리자 override
export interface GuardrailViolation { rule_key: string; severity: 'warning' | 'soft_block' | 'hard_block'; reason: string | null; }
export interface GuardrailStoreResult {
  store_key: string;
  gr: { passed: boolean; blocked: boolean; severity: string | null; violations: GuardrailViolation[]; penalty_score: number; overridden?: boolean };
}
export async function getTrackGuardrails(trackId: string): Promise<GuardrailStoreResult[]> {
  const { data, error } = await supabase.rpc('admin_get_track_guardrails', { p_track_id: trackId });
  if (error) throw error;
  return (data ?? []) as GuardrailStoreResult[];
}
export async function setGuardrailOverride(trackId: string, storeKey: string, enable: boolean, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('admin_set_guardrail_override', { p_track_id: trackId, p_store_key: storeKey, p_enable: enable, p_reason: reason ?? null });
  if (error) throw error;
}

// Guardrail 위반 대시보드 / 일괄 처리 / 업로더 trust
export interface GuardrailDashboard {
  total_violating_tracks: number; hard_block_tracks: number;
  by_severity: Record<string, number>;
  by_store: Array<{ store_key: string; total: number; hard_count: number }>;
  top_rules: Array<{ rule_key: string; cnt: number }>;
  uploaders: Array<{ user_id: string; artist_name: string | null; metadata_trust_score: number | null; total_tracks: number; hard_tracks: number; violation_rate: number | null }>;
}
export interface GuardrailViolationTrack {
  track_id: string; title: string | null; artist: string | null; main_genre: string | null;
  hard_stores: number; soft_stores: number; blocked_stores: string[] | null; rules: string[] | null;
}
export async function recomputeGuardrailFlags(): Promise<{ flags: number }> {
  const { data, error } = await supabase.rpc('admin_recompute_guardrail_flags');
  if (error) throw error; return data as { flags: number };
}
export async function guardrailDashboard(): Promise<GuardrailDashboard> {
  const { data, error } = await supabase.rpc('admin_guardrail_dashboard');
  if (error) throw error; return data as GuardrailDashboard;
}
export async function listGuardrailViolationTracks(severity = 'hard_block', storeKey: string | null = null, limit = 200): Promise<GuardrailViolationTrack[]> {
  const { data, error } = await supabase.rpc('admin_list_guardrail_violation_tracks', { p_severity: severity, p_store_key: storeKey, p_limit: limit });
  if (error) throw error; return (data ?? []) as GuardrailViolationTrack[];
}
export async function recomputeMetadataTrust(): Promise<{ updated: number }> {
  const { data, error } = await supabase.rpc('admin_recompute_metadata_trust');
  if (error) throw error; return data as { updated: number };
}
export async function bulkGuardrailOverride(trackIds: string[], storeKey: string, reason?: string): Promise<{ overridden: number }> {
  const { data, error } = await supabase.rpc('admin_bulk_guardrail_override', { p_track_ids: trackIds, p_store_key: storeKey, p_reason: reason ?? null });
  if (error) throw error; return data as { overridden: number };
}
export async function bulkGuardrailClear(trackIds: string[], reason?: string): Promise<{ cleared: number }> {
  const { data, error } = await supabase.rpc('admin_bulk_guardrail_clear', { p_track_ids: trackIds, p_reason: reason ?? null });
  if (error) throw error; return data as { cleared: number };
}
export async function bulkApplyAiMetadata(trackIds: string[]): Promise<void> {
  for (const id of trackIds) { await applyAiMetadata(id, {}); }
}

// 고위험 검수 + 업로더 상세
export interface HighRiskTrack {
  track_id: string; title: string | null; artist: string | null; release_status: string | null;
  trust_score: number; trust_tier: string; low_trust: boolean; guardrail_hard: boolean;
  ai_mismatch_high: boolean; embedding_disagree_high: boolean; lufs_boundary: boolean;
  hard_stores: number; mismatch_score: number | null; owner_name: string | null; owner_user_id: string; risk_score: number;
}
export async function listHighRiskTracks(limit = 200): Promise<HighRiskTrack[]> {
  const { data, error } = await supabase.rpc('admin_list_high_risk_tracks', { p_limit: limit });
  if (error) throw error; return (data ?? []) as HighRiskTrack[];
}
export interface UploaderDetail {
  user_id: string; artist_name: string | null; trust_score: number; tier: string;
  violation_tracks: Array<{ track_id: string; title: string | null; main_genre: string | null; hard_stores: number; blocked_stores: string[] | null }>;
  trust_history: Array<{ old_score: number | null; new_score: number | null; reason: string | null; created_at: string }>;
  notice_message: string;
}
export async function getUploaderDetail(userId: string): Promise<UploaderDetail> {
  const { data, error } = await supabase.rpc('admin_get_uploader_detail', { p_user_id: userId });
  if (error) throw error; return data as UploaderDetail;
}

// 전체 재검수 배치
export interface RereviewSummary {
  total_target: number; features_done: number; features_missing: number; features_failed: number;
  quality_review_required: number; guardrail_hard_tracks: number; mismatch_high: number;
  high_risk_flags: number; needs_re_review: number; low_trust_uploaders: number;
  fix_requested: number; resolved_total: number;
}
export async function rereviewBatch(offset: number, limit = 20): Promise<{ total: number; processed: number; failed: number; next_offset: number; has_more: boolean }> {
  const { data, error } = await supabase.rpc('admin_rereview_batch', { p_offset: offset, p_limit: limit });
  if (error) throw error; return data as { total: number; processed: number; failed: number; next_offset: number; has_more: boolean };
}
export async function finalizeRereview(): Promise<{ flags_upserted: number }> {
  const { data, error } = await supabase.rpc('admin_finalize_rereview');
  if (error) throw error; return data as { flags_upserted: number };
}
export async function rereviewSummary(): Promise<RereviewSummary> {
  const { data, error } = await supabase.rpc('admin_rereview_summary');
  if (error) throw error; return data as RereviewSummary;
}
export interface RereviewFlag { track_id: string; flag_type: string; status: string; reason: string | null; created_at: string; title: string | null; artist: string | null; release_status: string | null; }
export async function listRereviewFlags(flagType = 'needs_re_review', limit = 200): Promise<RereviewFlag[]> {
  const { data, error } = await supabase.rpc('admin_list_rereview_flags', { p_flag_type: flagType, p_limit: limit });
  if (error) throw error; return (data ?? []) as RereviewFlag[];
}
export async function resolveRereviewFlag(trackId: string, flagType: string, status = 'resolved', note?: string): Promise<void> {
  const { error } = await supabase.rpc('admin_resolve_rereview_flag', { p_track_id: trackId, p_flag_type: flagType, p_status: status, p_note: note ?? null });
  if (error) throw error;
}

// 재검수 빠른 처리 큐 — 등록 vs AI 메타 비교 + 선언/차단 매장 + 한줄 요약 + 처리상태
export interface RereviewQueueRow {
  track_id: string; title: string | null; artist: string | null; release_status: string | null;
  audio_url: string | null; duration: number | null;
  declared_genres: string[] | null; declared_moods: string[] | null; declared_situations: string[] | null;
  declared_store_tags: string[] | null; declared_stores: string[] | null;
  ai_genres: string[] | null; ai_moods: string[] | null; ai_situations: string[] | null; ai_energy_level: string | null;
  mismatch_score: number | null; mismatch_reasons: string[] | null; ai_explanation: string | null;
  blocked_stores: string[] | null; blocked_declared_stores: string[] | null;
  lufs: number | null; qpass: boolean | null;
  trust_score: number; owner_name: string | null; owner_user_id: string;
  open_flags: string[] | null; disposition: string | null; needs_fix: boolean | null;
  problem_summary: string;
}
// p_filter: needs_re_review | high_risk | quality_review_required | guardrail_hard | all | mismatch_high | low_trust | store:<key>
export async function rereviewQueue(filter = 'needs_re_review', limit = 200): Promise<RereviewQueueRow[]> {
  const { data, error } = await supabase.rpc('admin_rereview_queue', { p_filter: filter, p_limit: limit });
  if (error) throw error; return (data ?? []) as RereviewQueueRow[];
}
export interface RereviewGuardrail { store_key: string; store_label: string; severity: string; rules: string[] | null; is_declared: boolean; }
export interface RereviewDetail extends Omit<RereviewQueueRow, 'open_flags' | 'disposition' | 'needs_fix' | 'problem_summary' | 'owner_name' | 'owner_user_id' | 'trust_score'> {
  ai_vocal_type: string | null; ai_exclusions: string[] | null; guardrails: RereviewGuardrail[]; open_flags: string[] | null;
}
export async function rereviewTrackDetail(trackId: string): Promise<RereviewDetail> {
  const { data, error } = await supabase.rpc('admin_rereview_track_detail', { p_track_id: trackId });
  if (error) throw error; return data as RereviewDetail;
}
export type RereviewActionType = 'apply_ai_meta' | 'remove_declared_store' | 'exclude_store' | 'no_problem' | 'request_fix';
export async function rereviewAction(trackIds: string[], action: RereviewActionType, storeKey?: string, note?: string): Promise<{ affected: number }> {
  const { data, error } = await supabase.rpc('admin_rereview_action', { p_track_ids: trackIds, p_action: action, p_store_key: storeKey ?? null, p_note: note ?? null });
  if (error) throw error; return data as { affected: number };
}
