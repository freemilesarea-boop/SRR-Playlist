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
  // X2.2 — fit score AI boost breakdown (nullable for backward compat)
  manual_score?: number | null;
  ai_store_score?: number | null;
  ai_mood_score?: number | null;
  ai_genre_score?: number | null;
  ai_boost_total?: number | null;
  normalized_store_slug?: string | null;
  reason_codes?: string[] | null;
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
export interface EmbeddingStatus { model: string; track_embeddings: number; store_archetypes: number; pending: number; embedding_dim: number | null; }
export async function embeddingStatus(model = 'openl3'): Promise<EmbeddingStatus> {
  const { data, error } = await supabase.rpc('admin_embedding_status', { p_model: model });
  if (error) throw error; return data as EmbeddingStatus;
}
export async function buildStoreArchetypes(model = 'openl3', top = 8): Promise<{ built: number; skipped: unknown[] }> {
  const { data, error } = await supabase.rpc('admin_build_store_archetypes', { p_model: model, p_top: top });
  if (error) throw error; return data as { built: number; skipped: unknown[] };
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

// AI 메타 적용 + 자동 재평가 파이프라인 (self-healing) — before/after diff 반환
export interface RecomputeFitDelta { store_key: string; store_label: string; before: number | null; after: number | null; delta: number; }
export interface RecomputeResult {
  ok: boolean; track_id: string; declared_stores: string[] | null;
  fit_before: Record<string, number>; fit_after: Record<string, number>;
  fit_diff: RecomputeFitDelta[]; top_gains: RecomputeFitDelta[];
  blocked_before: string[]; blocked_after: string[];
  unblocked_stores: string[]; newly_blocked_stores: string[];
  removed_conflicts: string[]; remaining_conflicts: string[];
  mismatch_before: number; mismatch_after: number; mismatch_reduced: boolean;
  risk_before: string; risk_after: string; risk_reduced: boolean;
  open_flags_after: string[]; warning: string | null;
}
export async function applyAiMetadataAndRecompute(trackId: string, opts: { autoResolve?: boolean } = {}): Promise<RecomputeResult> {
  const { data, error } = await supabase.rpc('admin_apply_ai_metadata_and_recompute', {
    p_track_id: trackId, p_options: { auto_resolve: opts.autoResolve ?? false },
  });
  if (error) throw error; return data as RecomputeResult;
}

// Playlist Flow AI 엔진 — 곡↔곡 전환 흐름 평가
export interface FlowSummaryRow {
  playlist_id: string; title: string | null; flow_score: number | null; n_tracks: number; n_transitions: number;
  avg_transition: number | null; rough_transitions: number; fatigue_index: number; monotony_index: number;
  repetitive_count: number; drop_shock_count: number; mood_collision_count: number; emotional_continuity: number | null;
  computed_at: string;
}
export interface FlowTransition {
  position: number; from_track_id: string | null; to_track_id: string | null; from_title: string | null; to_title: string | null;
  bpm_jump: number | null; energy_jump: number | null; brightness_jump: number | null; vocal_jump: number | null;
  energy_drop: number | null; transition_score: number | null; issues: string[];
}
export interface FlowDetail { score: (FlowSummaryRow & { breakdown: Record<string, number> }) | null; transitions: FlowTransition[]; }
export async function computeAllPlaylistFlows(): Promise<{ playlists_scored: number }> {
  const { data, error } = await supabase.rpc('admin_compute_all_playlist_flows');
  if (error) throw error; return data as { playlists_scored: number };
}
export async function computePlaylistFlow(playlistId: string): Promise<FlowSummaryRow> {
  const { data, error } = await supabase.rpc('admin_compute_playlist_flow', { p_playlist_id: playlistId });
  if (error) throw error; return data as FlowSummaryRow;
}
export async function playlistFlowSummary(): Promise<FlowSummaryRow[]> {
  const { data, error } = await supabase.rpc('admin_playlist_flow_summary');
  if (error) throw error; return (data ?? []) as FlowSummaryRow[];
}
export async function getPlaylistFlow(playlistId: string): Promise<FlowDetail> {
  const { data, error } = await supabase.rpc('admin_get_playlist_flow', { p_playlist_id: playlistId });
  if (error) throw error; return data as FlowDetail;
}

// Playlist Auto Reordering — Flow Score 기반 순서 최적화 "제안" (자동 적용 없음, 관리자 승인 필요)
export interface ReorderMetrics {
  flow_score: number | null; n_transitions: number; avg_transition?: number;
  rough_transitions?: number; repetitive_count?: number; drop_shock_count?: number;
  mood_collision_count?: number; fatigue_index?: number; monotony_index?: number; emotional_continuity?: number;
}
export interface ReorderProposalRow {
  id: string; playlist_id: string; title: string | null; status: string;
  current_score: number | null; proposed_score: number | null; improvement: number | null;
  n_tracks: number; created_at: string; metrics_before: ReorderMetrics; metrics_after: ReorderMetrics;
}
export interface ReorderListEntry { position: number; track_id: string; title: string | null; moved?: boolean; }
export interface ReorderDetail {
  ok: boolean; proposal_id?: string; playlist_id?: string; title?: string | null; status?: string;
  current_score?: number | null; proposed_score?: number | null; improvement?: number | null;
  metrics_before?: ReorderMetrics; metrics_after?: ReorderMetrics;
  current_list?: ReorderListEntry[]; proposed_list?: ReorderListEntry[]; note?: string;
}
export async function generateAllReorders(): Promise<{ proposals: number; with_improvement: number }> {
  const { data, error } = await supabase.rpc('admin_generate_all_reorders');
  if (error) throw error; return data as { proposals: number; with_improvement: number };
}
export async function generatePlaylistReorder(playlistId: string): Promise<unknown> {
  const { data, error } = await supabase.rpc('admin_generate_playlist_reorder', { p_playlist_id: playlistId });
  if (error) throw error; return data;
}
export async function listReorderProposals(): Promise<ReorderProposalRow[]> {
  const { data, error } = await supabase.rpc('admin_list_reorder_proposals');
  if (error) throw error; return (data ?? []) as ReorderProposalRow[];
}
export async function getReorderProposal(playlistId: string): Promise<ReorderDetail> {
  const { data, error } = await supabase.rpc('admin_get_reorder_proposal', { p_playlist_id: playlistId });
  if (error) throw error; return data as ReorderDetail;
}
export async function applyPlaylistReorder(proposalId: string): Promise<{ reordered: number }> {
  const { data, error } = await supabase.rpc('admin_apply_playlist_reorder', { p_proposal_id: proposalId });
  if (error) throw error; return data as { reordered: number };
}
export async function rejectPlaylistReorder(proposalId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_reject_playlist_reorder', { p_proposal_id: proposalId });
  if (error) throw error;
}

// 사업자 30초내 스킵 기반 자동 제외 — 관리자
export interface BusinessSkipSummary {
  active: number; restored: number; ignored: number; skip_events_7d: number; skip_events_30d: number;
  by_store: Array<{ store_key: string; store_label: string; n: number }>;
}
export interface BusinessExclusionRow {
  id: string; track_id: string; title: string | null; artist: string | null;
  playlist_store_key: string; store_group_key: string | null; store_label: string;
  skip_count: number; unique_business_skip_count: number; status: string; reason: string | null;
  first_detected_at: string | null; last_detected_at: string | null; created_at: string; admin_note: string | null;
}
export async function businessSkipSummary(): Promise<BusinessSkipSummary> {
  const { data, error } = await supabase.rpc('admin_business_skip_summary');
  if (error) throw error; return data as BusinessSkipSummary;
}
export async function listBusinessExclusions(store = 'all', days = 0, status = 'all'): Promise<BusinessExclusionRow[]> {
  const { data, error } = await supabase.rpc('admin_list_business_exclusions', { p_store: store, p_days: days, p_status: status });
  if (error) throw error; return (data ?? []) as BusinessExclusionRow[];
}
export async function restoreBusinessExclusion(id: string, note?: string): Promise<void> {
  const { error } = await supabase.rpc('admin_restore_business_exclusion', { p_id: id, p_note: note ?? null });
  if (error) throw error;
}
export async function ignoreBusinessExclusion(id: string, note?: string): Promise<void> {
  const { error } = await supabase.rpc('admin_ignore_business_exclusion', { p_id: id, p_note: note ?? null });
  if (error) throw error;
}
export async function reactivateBusinessExclusion(id: string): Promise<void> {
  const { error } = await supabase.rpc('admin_reactivate_business_exclusion', { p_id: id });
  if (error) throw error;
}
export async function excludeTrackStore(trackId: string, storeKey: string, note?: string): Promise<void> {
  const { error } = await supabase.rpc('admin_exclude_track_store', { p_track_id: trackId, p_store_key: storeKey, p_note: note ?? null });
  if (error) throw error;
}
export async function excludeTrackGroup(trackId: string, groupKey: string, note?: string): Promise<void> {
  const { error } = await supabase.rpc('admin_exclude_track_group', { p_track_id: trackId, p_group_key: groupKey, p_note: note ?? null });
  if (error) throw error;
}

// ===== Phase X2.3 — Chromaprint Audio Fingerprint Duplicate Detection =====
export interface DuplicateCandidate {
  source_track_id: string;
  candidate_track_id: string;
  similarity: number;
  source_title: string | null;
  source_artist: string | null;
  candidate_title: string | null;
  candidate_artist: string | null;
  source_duration: number | null;
  candidate_duration: number | null;
  duration_delta: number | null;
  hash_exact: boolean;
}

export async function adminFindDuplicateTracks(
  trackId: string,
  threshold = 0.85,
  maxResults = 20,
  durationTolerance = 5.0,
): Promise<DuplicateCandidate[]> {
  const { data, error } = await supabase.rpc('admin_find_duplicate_tracks', {
    p_target_track_id: trackId,
    p_similarity_threshold: threshold,
    p_max_results: maxResults,
    p_duration_tolerance: durationTolerance,
  });
  if (error) throw error;
  return (data ?? []) as DuplicateCandidate[];
}

export async function adminFindAllDuplicateCandidates(
  threshold = 0.85,
  maxResults = 100,
  durationTolerance = 3.0,
): Promise<DuplicateCandidate[]> {
  const { data, error } = await supabase.rpc('admin_find_all_duplicate_candidates', {
    p_similarity_threshold: threshold,
    p_max_results: maxResults,
    p_duration_tolerance: durationTolerance,
  });
  if (error) throw error;
  return (data ?? []) as DuplicateCandidate[];
}

// ===== Phase X2.3 (0244) — Fingerprint failure tracking =====
export interface FingerprintFailureSummary {
  total_success: number;
  total_failed: number;
  total_retryable: number;
  total_exhausted: number;
  pending_never_attempted: number;
  failure_breakdown: Record<string, number>;
}

export interface FingerprintFailureRow {
  track_id: string;
  title: string | null;
  artist: string | null;
  audio_url: string | null;
  error: string | null;
  retry_count: number;
  attempted_at: string | null;
  download_size_bytes: number | null;
  download_content_type: string | null;
}

export async function adminFingerprintFailureSummary(): Promise<FingerprintFailureSummary | null> {
  const { data, error } = await supabase.rpc('admin_fingerprint_failure_summary');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as FingerprintFailureSummary;
}

export async function adminListFingerprintFailures(
  limit = 100, onlyExhausted = false,
): Promise<FingerprintFailureRow[]> {
  const { data, error } = await supabase.rpc('admin_list_fingerprint_failures', {
    p_limit: limit, p_only_exhausted: onlyExhausted,
  });
  if (error) throw error;
  return (data ?? []) as FingerprintFailureRow[];
}

export async function adminResetFingerprintFailure(trackId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_reset_fingerprint_failure', { p_track_id: trackId });
  if (error) throw error;
}

// ===== 0245 — Audio corruption candidate queue =====
export interface CorruptionCandidate {
  track_id: string;
  title: string | null;
  artist: string | null;
  audio_url: string | null;
  fingerprint_error: string | null;
  retry_count: number;
  attempted_at: string | null;
  download_size_bytes: number | null;
  download_content_type: string | null;
  track_duration: number | null;
  qc_risk_level: string | null;
  qc_score: number | null;
  qc_issues_count: number;
  has_qc_report: boolean;
}

export async function adminListCorruptionCandidates(
  limit = 100, onlyExhausted = false,
): Promise<CorruptionCandidate[]> {
  const { data, error } = await supabase.rpc('admin_list_corruption_candidates', {
    p_limit: limit, p_only_exhausted: onlyExhausted,
  });
  if (error) throw error;
  return (data ?? []) as CorruptionCandidate[];
}

export async function adminMarkFingerprintQcRisk(trackId: string): Promise<string> {
  const { data, error } = await supabase.rpc('admin_mark_fingerprint_qc_risk', { p_track_id: trackId });
  if (error) throw error;
  return data as string;
}

// ===== Phase X3 (0246) — Admin Track Placement Editor =====
export interface TrackPlacementDetail {
  track: {
    id: string; title: string | null; artist: string | null;
    main_genre: string | null; sub_genre: string | null;
    mood: string | null; mood_tags: string[] | null;
    suitable_store: string | null; business_tags: string[] | null;
    genre_tags: string[] | null; time_slots: string[] | null;
    instrumental: boolean | null;
    release_status: string | null; release_date: string | null;
    audio_url_present: boolean; isrc_present: boolean;
    locked_fields: string[];
    [key: string]: unknown;
  };
  ai_prediction: {
    predicted_main_genre: string | null;
    predicted_sub_genres: string[] | null;
    genre_confidence: number | null;
    predicted_moods: string[] | null;
    mood_confidence: number | null;
    predicted_store_types: string[] | null;
    store_type_confidence: number | null;
    prediction_scores: Record<string, Record<string, number>> | null;
    applied_at: string | null;
    predicted_main_genre_ko: string | null;
    predicted_moods_ko: string[] | null;
    predicted_store_types_ko: string[] | null;
  } | null;
  exclusions: Array<{
    id: string; store_type_slug: string; store_type_name_ko: string | null;
    reason: string | null; created_at: string; created_by_name: string | null;
  }>;
  placements: Array<{
    playlist_id: string; playlist_title: string;
    business_category: string | null; daypart: string | null; ai_store_key: string | null;
    fit_score: number | null; fit_status: string | null;
    manual_score: number | null; ai_boost_total: number | null;
    reason_codes: string[] | null;
    in_playlist: boolean; order_index: number | null;
    placement_reason: string | null;
    is_excluded_by_admin: boolean;
  }>;
  audit_count: number;
}

export async function adminGetTrackPlacementDetail(trackId: string): Promise<TrackPlacementDetail> {
  const { data, error } = await supabase.rpc('admin_get_track_placement_detail', { p_track_id: trackId });
  if (error) throw error;
  return data as TrackPlacementDetail;
}

export async function adminUpdateTrackMetadata(
  trackId: string, fields: { title?: string; artist?: string; main_genre?: string; mood?: string; suitable_store?: string }, reason?: string,
): Promise<{ ok: true; before: Record<string, unknown>; after: Record<string, unknown> }> {
  const { data, error } = await supabase.rpc('admin_update_track_metadata', {
    p_track_id: trackId,
    p_title: fields.title ?? null,
    p_artist: fields.artist ?? null,
    p_main_genre: fields.main_genre ?? null,
    p_mood: fields.mood ?? null,
    p_suitable_store: fields.suitable_store ?? null,
    p_reason: reason ?? null,
  });
  if (error) throw error;
  return data as { ok: true; before: Record<string, unknown>; after: Record<string, unknown> };
}

export async function adminApplyAiMetadataWithAudit(
  trackId: string, scope: { genre: boolean; mood: boolean; store: boolean }, reason?: string,
) {
  const { data, error } = await supabase.rpc('admin_apply_ai_metadata_with_audit', {
    p_track_id: trackId,
    p_apply_genre: scope.genre,
    p_apply_mood: scope.mood,
    p_apply_store: scope.store,
    p_reason: reason ?? null,
  });
  if (error) throw error;
  return data;
}

export async function adminAddTrackExclusion(trackId: string, storeTypeSlug: string, reason?: string): Promise<string> {
  const { data, error } = await supabase.rpc('admin_add_track_exclusion', {
    p_track_id: trackId, p_store_type_slug: storeTypeSlug, p_reason: reason ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function adminRemoveTrackExclusion(exclusionId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_remove_track_exclusion', { p_exclusion_id: exclusionId });
  if (error) throw error;
}

export interface PreviewPlacementChanges {
  remove_count: number;
  keep_count: number;
  new_candidate_count: number;
  to_remove: Array<{ playlist_id: string; playlist_title: string; business_category: string | null; current_fit_score: number | null; order_index: number | null; matched_exclusion_slug: string | null }>;
  to_keep: Array<{ playlist_id: string; playlist_title: string; business_category: string | null; current_fit_score: number | null; order_index: number | null }>;
  new_candidates: Array<{ playlist_id: string; playlist_title: string; business_category: string | null; estimated_score: number; decision: string }>;
}

export async function adminPreviewPlacementChanges(trackId: string): Promise<PreviewPlacementChanges> {
  const { data, error } = await supabase.rpc('admin_preview_placement_changes', { p_track_id: trackId });
  if (error) throw error;
  return data as PreviewPlacementChanges;
}

export async function adminRemoveMisplacedPlaylistTracks(
  trackId: string, confirm: boolean, reason?: string,
): Promise<{ preview: boolean; count: number; targets?: unknown[]; removed?: unknown[] }> {
  const { data, error } = await supabase.rpc('admin_remove_misplaced_playlist_tracks', {
    p_track_id: trackId, p_confirm: confirm, p_reason: reason ?? null,
  });
  if (error) throw error;
  return data as { preview: boolean; count: number; targets?: unknown[]; removed?: unknown[] };
}

export async function adminRecomputeTrackFitScores(trackId: string): Promise<number> {
  const { data, error } = await supabase.rpc('admin_recompute_track_fit_scores', { p_track_id: trackId });
  if (error) throw error;
  return data as number;
}

export interface TrackAuditEntry {
  id: string; action_type: string;
  before_json: Record<string, unknown> | null;
  after_json: Record<string, unknown> | null;
  reason: string | null;
  created_at: string;
  admin_name: string | null;
}

export async function adminListTrackMetadataAudit(trackId: string, limit = 100): Promise<TrackAuditEntry[]> {
  const { data, error } = await supabase.rpc('admin_list_track_metadata_audit', {
    p_track_id: trackId, p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as TrackAuditEntry[];
}

// taxonomy store types — exclusion picker 용
export interface StoreTypeOption {
  slug: string; name_ko: string; name_en: string;
}
export async function listTaxonomyStoreTypes(): Promise<StoreTypeOption[]> {
  const { data, error } = await supabase.rpc('list_taxonomy_store_types');
  if (error) throw error;
  return (data ?? []) as StoreTypeOption[];
}

// ===== Phase X3.2 (0247) — Bulk Operations =====
export interface BulkAiApplyResult {
  ok: true;
  audit_id: string;
  preview: boolean;
  total: number;
  applied: number;
  skipped_low_conf: number;
  skipped_no_pred: number;
  failed: number;
  breakdown?: Array<{
    track_id: string; title: string | null;
    min_confidence: number;
    will_apply_genre: boolean; will_apply_mood: boolean; will_apply_store: boolean;
  }> | null;
}

export async function adminBulkApplyAiMetadata(
  trackIds: string[],
  scope: { genre: boolean; mood: boolean; store: boolean },
  minConfidence: number,
  confirm: boolean,
  reason?: string,
): Promise<BulkAiApplyResult> {
  const { data, error } = await supabase.rpc('admin_bulk_apply_ai_metadata', {
    p_track_ids: trackIds,
    p_apply_genre: scope.genre, p_apply_mood: scope.mood, p_apply_store: scope.store,
    p_min_confidence: minConfidence, p_confirm: confirm, p_reason: reason ?? null,
  });
  if (error) throw error;
  return data as BulkAiApplyResult;
}

export interface BulkExclusionResult {
  ok: true; audit_id: string; preview: boolean;
  track_count: number; slug_count: number; combos_total: number;
  inserted: number; already_active: number;
}

export async function adminBulkAddTrackExclusions(
  trackIds: string[], storeSlugs: string[], confirm: boolean, reason?: string,
): Promise<BulkExclusionResult> {
  const { data, error } = await supabase.rpc('admin_bulk_add_track_exclusions', {
    p_track_ids: trackIds, p_store_slugs: storeSlugs, p_confirm: confirm, p_reason: reason ?? null,
  });
  if (error) throw error;
  return data as BulkExclusionResult;
}

export interface BulkRecomputeResult {
  ok: true; audit_id: string; track_count: number; total_recomputed: number;
}

export async function adminBulkRecomputeFitScores(trackIds: string[]): Promise<BulkRecomputeResult> {
  const { data, error } = await supabase.rpc('admin_bulk_recompute_fit_scores', { p_track_ids: trackIds });
  if (error) throw error;
  return data as BulkRecomputeResult;
}

export interface BulkPreviewPlacement {
  ok: true; track_count: number; total_remove: number; total_keep: number;
  per_track: Array<{ track_id: string; title: string | null; remove_count: number; keep_count: number }>;
}

export async function adminBulkPreviewPlacementChanges(trackIds: string[]): Promise<BulkPreviewPlacement> {
  const { data, error } = await supabase.rpc('admin_bulk_preview_placement_changes', { p_track_ids: trackIds });
  if (error) throw error;
  return data as BulkPreviewPlacement;
}

export interface BulkRemoveMisplacedResult {
  ok: true; audit_id: string; preview: boolean;
  track_count: number; total_removed: number;
  per_track: Array<{ track_id: string; removed: number }>;
}

export async function adminBulkRemoveMisplacedPlaylistTracks(
  trackIds: string[], confirm: boolean, reason?: string,
): Promise<BulkRemoveMisplacedResult> {
  const { data, error } = await supabase.rpc('admin_bulk_remove_misplaced_playlist_tracks', {
    p_track_ids: trackIds, p_confirm: confirm, p_reason: reason ?? null,
  });
  if (error) throw error;
  return data as BulkRemoveMisplacedResult;
}

export interface QcQueueFilter {
  main_genre_in?: string[];
  in_playlist_categories?: string[];
  fingerprint_status?: 'success' | 'failed';
  store_type_confidence_lt?: number;
  mood_confidence_lt?: number;
  genre_confidence_lt?: number;
  ai_predicted_store_in?: string[];
  limit?: number;
}

export interface QcQueueRow {
  track_id: string; title: string | null; artist: string | null; main_genre: string | null;
  current_playlists: string[] | null;
  genre_conf: number | null; mood_conf: number | null; store_conf: number | null;
  fingerprint_status: string | null;
}

export async function adminBulkQcQueueFilter(filter: QcQueueFilter): Promise<QcQueueRow[]> {
  const { data, error } = await supabase.rpc('admin_bulk_qc_queue_filter', { p_filter: filter });
  if (error) throw error;
  return (data ?? []) as QcQueueRow[];
}

export interface BulkAuditEntry {
  id: string; operation_type: string; track_count: number;
  params_json: Record<string, unknown> | null;
  after_json: Record<string, unknown> | null;
  status: string; created_at: string; admin_name: string | null;
}

export async function adminListBulkAudit(limit = 50): Promise<BulkAuditEntry[]> {
  const { data, error } = await supabase.rpc('admin_list_bulk_audit', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as BulkAuditEntry[];
}

// ===== Phase X3.3 (0248) — QC Queue Automation =====
export type QcSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type QcStatus = 'open' | 'reviewing' | 'resolved' | 'dismissed' | 'all';
export type QcSource = 'rule' | 'ai' | 'chromaprint' | 'fingerprint' | 'placement' | 'manual';

export interface QcQueueRowFull {
  id: string;
  track_id: string;
  title: string | null;
  artist: string | null;
  main_genre: string | null;
  issue_type: string;
  severity: QcSeverity;
  source: QcSource;
  reason: string;
  evidence_json: Record<string, unknown> | null;
  status: 'open' | 'reviewing' | 'resolved' | 'dismissed';
  assigned_to_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface QcQueueSummary {
  total_open: number;
  total_reviewing: number;
  total_resolved: number;
  total_dismissed: number;
  by_severity: Record<string, number> | null;
  by_issue_type: Record<string, number> | null;
  by_source: Record<string, number> | null;
}

export interface QcGenerateResult {
  ok: true;
  by_rule: Record<string, number | string>;
  generated_total: number;
  limit?: number;
  issue?: string | null;
}

export async function adminGenerateQcQueueCandidates(
  limit = 100,
  issue?: string | null,
  force = false,
): Promise<QcGenerateResult> {
  const { data, error } = await supabase.rpc('admin_generate_qc_queue_candidates', {
    p_limit: limit,
    p_issue: issue ?? null,
    p_force: force,
  });
  if (error) {
    if (/timeout/i.test(error.message)) {
      throw new Error('DB timeout — batch size 를 줄여 다시 실행하세요 (현재 limit=' + limit + ')');
    }
    throw error;
  }
  return data as QcGenerateResult;
}

export async function adminGenerateFingerprintQcCandidates(
  limit = 100,
): Promise<QcGenerateResult> {
  const { data, error } = await supabase.rpc('admin_generate_fingerprint_qc_candidates', {
    p_limit: limit,
  });
  if (error) {
    if (/timeout/i.test(error.message)) {
      throw new Error('Fingerprint 후보 생성 timeout — limit 을 줄여 재시도하세요 (현재 ' + limit + ')');
    }
    throw error;
  }
  return data as QcGenerateResult;
}

// Phase 0264: QC 큐 처리 UX 강화
export async function adminBulkReviewQcQueue(
  ids: string[],
  assignee?: string | null,
  note?: string | null,
): Promise<{ ok: true; count: number }> {
  const { data, error } = await supabase.rpc('admin_bulk_review_qc_queue', {
    p_ids: ids,
    p_assignee: assignee ?? null,
    p_note: note ?? null,
  });
  if (error) throw error;
  return data as { ok: true; count: number };
}

export interface FingerprintFailureDetail {
  queue: Record<string, unknown> | null;
  track: {
    id: string; title: string | null; artist: string | null;
    audio_url: string | null; audio_health_status: string | null;
    audio_content_type: string | null; audio_content_length: number | null;
  } | null;
  fingerprint: {
    track_id: string; fingerprint_status: string | null;
    retry_count: number | null; fingerprint_error: string | null;
    download_content_type: string | null; download_size_bytes: number | null;
    fingerprint_attempted_at: string | null;
  } | null;
}

export async function adminGetFingerprintFailureDetail(
  queueId: string,
): Promise<FingerprintFailureDetail> {
  const { data, error } = await supabase.rpc('admin_get_fingerprint_failure_detail', {
    p_queue_id: queueId,
  });
  if (error) throw error;
  return data as FingerprintFailureDetail;
}

export async function adminRetryFingerprintForQueue(
  queueId: string,
  resetRetry = false,
  note?: string | null,
): Promise<{ ok: true; before_status: string; before_retry: number; reset: boolean }> {
  const { data, error } = await supabase.rpc('admin_retry_fingerprint_for_queue', {
    p_queue_id: queueId,
    p_reset_retry: resetRetry,
    p_note: note ?? null,
  });
  if (error) throw error;
  return data as { ok: true; before_status: string; before_retry: number; reset: boolean };
}

export interface QcQueueAuditRow {
  id: string;
  queue_id: string;
  track_id: string | null;
  admin_user_id: string | null;
  admin_name: string | null;
  action: string;
  before_status: string | null;
  after_status: string | null;
  before_assignee: string | null;
  after_assignee: string | null;
  note: string | null;
  created_at: string;
}

export async function adminGetQcQueueAudit(
  queueId?: string | null,
  limit = 50,
): Promise<QcQueueAuditRow[]> {
  const { data, error } = await supabase.rpc('admin_get_qc_queue_audit', {
    p_queue_id: queueId ?? null,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as QcQueueAuditRow[];
}

// Phase 0265: QC 큐 inline 운영 조치
export interface QcTrackContextPlaylist {
  pt_id: string;
  order_index: number;
  placement_reason: string | null;
  placed_by: string | null;
  removed_at: string | null;
  removed_reason: string | null;
  playlist_id: string;
  playlist_name: string | null;
  business_category: string | null;
  normalized_slug: string | null;
  fit_score: number | null;
  fit_status: 'active' | 'review_needed' | 'excluded' | null;
  fit_source: string | null;
  reason: string | null;
  reason_codes: string[] | null;
  audio_score: number | null;
  metadata_score: number | null;
  behavior_score: number | null;
  penalty_score: number | null;
}

export interface QcTrackContext {
  queue: Record<string, unknown>;
  track: {
    id: string; title: string | null; artist: string | null; cover_url: string | null;
    audio_url: string | null; duration: number | null;
    main_genre: string | null; sub_genre: string | null;
    mood: string | null; mood_tags: string[] | null; genre_tags: string[] | null;
    suitable_store: string | null; business_tags: string[] | null;
    bpm: number | null; energy_level: number | null;
    instrumental: boolean | null; explicit_content: boolean | null;
    language: string | null; vocal_type: string | null; admin_note: string | null;
    audio_health_status: string | null;
  };
  audio_features: {
    energy: number | null; instrumentalness: number | null;
    acousticness: number | null; speechiness: number | null;
    danceability: number | null; valence: number | null;
    analyzer: string | null;
  } | null;
  playlists: QcTrackContextPlaylist[];
}

export async function adminGetQcTrackContext(queueId: string): Promise<QcTrackContext> {
  const { data, error } = await supabase.rpc('admin_get_qc_track_context', {
    p_queue_id: queueId,
  });
  if (error) throw error;
  return data as QcTrackContext;
}

export type QcInlineAction = 'remove' | 'change_status' | 'update_metadata' | 'recompute';

export interface QcActAndResolveResult {
  ok: true;
  action: QcInlineAction;
  queue_id: string;
  action_result: unknown;
  resolved: boolean;
}

export async function adminQcActAndResolve(input: {
  queueId: string;
  action: QcInlineAction;
  playlistId?: string | null;
  payload?: Record<string, unknown> | null;
  status?: 'active' | 'review_needed' | 'excluded' | null;
  reason?: string | null;
  adminNote?: string | null;
  resolveAfter?: boolean;
}): Promise<QcActAndResolveResult> {
  const { data, error } = await supabase.rpc('admin_qc_act_and_resolve', {
    p_queue_id: input.queueId,
    p_action: input.action,
    p_playlist_id: input.playlistId ?? null,
    p_payload: input.payload ?? null,
    p_status: input.status ?? null,
    p_reason: input.reason ?? null,
    p_admin_note: input.adminNote ?? null,
    p_resolve_after: input.resolveAfter ?? false,
  });
  if (error) throw error;
  return data as QcActAndResolveResult;
}

export async function adminListQcQueue(
  status: QcStatus = 'open',
  severity?: QcSeverity,
  issueType?: string,
  source?: QcSource,
  limit = 200,
): Promise<QcQueueRowFull[]> {
  const { data, error } = await supabase.rpc('admin_list_qc_queue', {
    p_status: status, p_severity: severity ?? null,
    p_issue_type: issueType ?? null, p_source: source ?? null, p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as QcQueueRowFull[];
}

export async function adminQcQueueSummary(): Promise<QcQueueSummary | null> {
  const { data, error } = await supabase.rpc('admin_qc_queue_summary');
  if (error) throw error;
  return data as QcQueueSummary;
}

export async function adminAssignQcQueue(id: string, assignee?: string): Promise<void> {
  const { error } = await supabase.rpc('admin_assign_qc_queue', { p_id: id, p_assignee: assignee ?? null });
  if (error) throw error;
}

export async function adminResolveQcQueue(id: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('admin_resolve_qc_queue', { p_id: id, p_reason: reason ?? null });
  if (error) throw error;
}

export async function adminDismissQcQueue(id: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('admin_dismiss_qc_queue', { p_id: id, p_reason: reason ?? null });
  if (error) throw error;
}

export async function adminBulkResolveQcQueue(
  ids: string[], status: 'resolved' | 'dismissed', reason?: string,
): Promise<number> {
  const { data, error } = await supabase.rpc('admin_bulk_resolve_qc_queue', {
    p_ids: ids, p_status: status, p_reason: reason ?? null,
  });
  if (error) throw error;
  return data as number;
}

// ===== Phase X3.4 (0249) — QC Rule Management =====
export interface QcRule {
  id: string;
  rule_key: string;
  name: string;
  description: string | null;
  issue_type: string;
  severity: QcSeverity;
  source: QcSource;
  condition_json: Record<string, unknown> | null;
  is_active: boolean;
  open_count: number;
  created_at: string;
  updated_at: string;
}

export async function adminListQcRules(): Promise<QcRule[]> {
  const { data, error } = await supabase.rpc('admin_list_qc_rules');
  if (error) throw error;
  return (data ?? []) as QcRule[];
}

export async function adminUpdateQcRule(
  id: string,
  fields: { is_active?: boolean; severity?: QcSeverity; description?: string; name?: string },
  reason?: string,
): Promise<{ ok: true; before: Record<string, unknown>; after: Record<string, unknown> }> {
  const { data, error } = await supabase.rpc('admin_update_qc_rule', {
    p_id: id,
    p_is_active: fields.is_active ?? null,
    p_severity: fields.severity ?? null,
    p_description: fields.description ?? null,
    p_name: fields.name ?? null,
    p_reason: reason ?? null,
  });
  if (error) throw error;
  return data as { ok: true; before: Record<string, unknown>; after: Record<string, unknown> };
}

export interface QcRuleAuditEntry {
  id: string;
  rule_id: string | null;
  rule_key: string | null;
  admin_name: string | null;
  action_type: string;
  before_json: Record<string, unknown> | null;
  after_json: Record<string, unknown> | null;
  reason: string | null;
  created_at: string;
}

export async function adminListQcRuleAudit(ruleId?: string, limit = 100): Promise<QcRuleAuditEntry[]> {
  const { data, error } = await supabase.rpc('admin_list_qc_rule_audit', {
    p_rule_id: ruleId ?? null, p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as QcRuleAuditEntry[];
}

// ===== Phase X4.0 (0250) — Behavior Learning =====
export interface BehaviorScore {
  track_id: string;
  window_days: number;
  play_count: number;
  unique_listener_count: number;
  completion_rate: number;
  skip_rate: number;
  replay_rate: number;
  like_rate: number;
  save_rate: number;
  avg_listen_seconds: number;
  avg_completion_percent: number;
  behavior_score: number;
  confidence: number;
  store_breakdown_json: Record<string, { play_count: number; completion_rate: number; avg_listen_seconds?: number }> | null;
  playlist_breakdown_json: Record<string, { title: string; play_count: number; completion_rate: number; business_category: string | null }> | null;
  daypart_breakdown_json: Record<string, { play_count: number; completion_rate: number }> | null;
  calculated_at: string;
}

export interface BehaviorOutlier {
  track_id: string;
  title: string | null;
  artist: string | null;
  main_genre: string | null;
  play_count: number;
  unique_listener_count: number;
  completion_rate: number;
  skip_rate: number;
  replay_rate: number;
  like_rate: number;
  behavior_score: number;
  confidence: number;
  risk_signals: string[];
}

export async function adminRecomputeBehaviorScores(windowDays = 30): Promise<{ ok: true; tracks_computed: number; elapsed_ms: number }> {
  const { data, error } = await supabase.rpc('recompute_track_behavior_scores', { p_window_days: windowDays });
  if (error) throw error;
  return data as { ok: true; tracks_computed: number; elapsed_ms: number };
}

export async function adminRecomputeSingleTrackBehaviorScore(
  trackId: string, windowDays = 30,
): Promise<BehaviorScore | null> {
  const { data, error } = await supabase.rpc('recompute_single_track_behavior_score', {
    p_track_id: trackId, p_window_days: windowDays,
  });
  if (error) throw error;
  return data as BehaviorScore | null;
}

export async function adminGetTrackBehaviorDetail(
  trackId: string, windowDays = 30,
): Promise<{ track: Record<string, unknown>; score: BehaviorScore | null; window_days: number; has_data: boolean }> {
  const { data, error } = await supabase.rpc('admin_get_track_behavior_detail', {
    p_track_id: trackId, p_window_days: windowDays,
  });
  if (error) throw error;
  return data as { track: Record<string, unknown>; score: BehaviorScore | null; window_days: number; has_data: boolean };
}

export async function adminListBehaviorOutliers(
  windowDays = 30, minPlayCount = 20, limit = 200,
): Promise<BehaviorOutlier[]> {
  const { data, error } = await supabase.rpc('admin_list_behavior_outliers', {
    p_window_days: windowDays, p_min_play_count: minPlayCount, p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as BehaviorOutlier[];
}

// ===== Phase X4.1 (0251) — Behavior Feedback Engine =====
export interface PromotionDemotionCandidate {
  track_id: string;
  title: string | null;
  artist: string | null;
  main_genre: string | null;
  behavior_score: number;
  confidence: number;
  play_count: number;
  completion_rate: number;
  skip_rate: number;
  like_rate: number;
  avg_fit_score: number;
  avg_final_fit_score: number;
  avg_boost: number;
  current_placement_count: number;
}

export interface BehaviorComparisonRow {
  track_id: string;
  title: string | null;
  artist: string | null;
  main_genre: string | null;
  play_count: number;
  confidence: number;
  behavior_score: number;
  avg_fit_score: number;
  avg_final_fit_score: number;
  avg_boost: number;
  is_promotion_candidate: boolean;
  is_demotion_candidate: boolean;
}

export async function adminRecomputeBehaviorBoosts(windowDays = 30): Promise<{ ok: true; rows_updated: number; elapsed_ms: number }> {
  const { data, error } = await supabase.rpc('admin_recompute_behavior_boosts', { p_window_days: windowDays });
  if (error) throw error;
  return data as { ok: true; rows_updated: number; elapsed_ms: number };
}

export async function adminListPromotionCandidates(
  minBehavior = 70, minConfidence = 0.30, limit = 100,
): Promise<PromotionDemotionCandidate[]> {
  const { data, error } = await supabase.rpc('admin_list_promotion_candidates', {
    p_min_behavior: minBehavior, p_min_confidence: minConfidence, p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as PromotionDemotionCandidate[];
}

export async function adminListDemotionCandidates(
  maxBehavior = 30, minConfidence = 0.30, limit = 100,
): Promise<PromotionDemotionCandidate[]> {
  const { data, error } = await supabase.rpc('admin_list_demotion_candidates', {
    p_max_behavior: maxBehavior, p_min_confidence: minConfidence, p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as PromotionDemotionCandidate[];
}

export async function adminListBehaviorComparison(limit = 50): Promise<BehaviorComparisonRow[]> {
  const { data, error } = await supabase.rpc('admin_list_behavior_comparison', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as BehaviorComparisonRow[];
}

// ===== Phase X4.2 (0252) — Store Learning Engine =====
export interface TrackStoreScoreRow {
  track_id: string;
  title: string | null;
  artist: string | null;
  main_genre: string | null;
  store_type_slug: string;
  store_name_ko: string | null;
  play_count: number;
  unique_listener_count: number;
  completion_rate: number;
  skip_rate: number;
  replay_rate: number;
  like_rate: number;
  store_behavior_score: number;
  confidence: number;
  is_promotion_candidate: boolean;
  is_demotion_candidate: boolean;
}

export interface StoreMismatchCandidate {
  track_id: string;
  title: string | null;
  artist: string | null;
  main_genre: string | null;
  store_type_slug: string;
  store_name_ko: string | null;
  play_count: number;
  completion_rate: number;
  skip_rate: number;
  store_behavior_score: number;
  confidence: number;
  risk_signals: string[];
}

export interface StoreLearningSummary {
  total_rows: number;
  distinct_tracks: number;
  by_store: Record<string, {
    rows: number; distinct_tracks: number; avg_score: number; avg_confidence: number;
    high_confidence_rows: number; promotion_candidates: number; demotion_candidates: number;
  }> | null;
}

export async function adminRecomputeTrackStoreBehaviorScores(windowDays = 30): Promise<{ ok: true; rows_upserted: number; elapsed_ms: number }> {
  const { data, error } = await supabase.rpc('recompute_track_store_behavior_scores', { p_window_days: windowDays });
  if (error) throw error;
  return data as { ok: true; rows_upserted: number; elapsed_ms: number };
}

export async function adminListTrackStoreScores(
  storeSlug?: string, windowDays = 30, limit = 200,
): Promise<TrackStoreScoreRow[]> {
  const { data, error } = await supabase.rpc('admin_list_track_store_scores', {
    p_store_slug: storeSlug ?? null, p_window_days: windowDays, p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as TrackStoreScoreRow[];
}

export async function adminListStoreMismatchCandidates(
  windowDays = 30, minPlayCount = 10, limit = 200,
): Promise<StoreMismatchCandidate[]> {
  const { data, error } = await supabase.rpc('admin_list_store_mismatch_candidates', {
    p_window_days: windowDays, p_min_play_count: minPlayCount, p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as StoreMismatchCandidate[];
}

export async function adminStoreLearningSummary(windowDays = 30): Promise<StoreLearningSummary | null> {
  const { data, error } = await supabase.rpc('admin_store_learning_summary', { p_window_days: windowDays });
  if (error) throw error;
  return data as StoreLearningSummary;
}

// ===== X5.0 Genre Guardrails =====

export type GenreGuardrailRuleType = 'hard_block' | 'soft_penalty' | 'bonus';

export interface GenreGuardrailRow {
  id: string;
  genre_pattern: string;
  store_slug: string;
  rule_type: GenreGuardrailRuleType;
  score_delta: number;
  description: string | null;
  is_active: boolean;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface GenreGuardrailSummary {
  total: number;
  active: number;
  by_rule_type: Record<GenreGuardrailRuleType, number>;
  by_store: Record<string, number>;
}

export async function adminListGenreGuardrails(storeSlug?: string | null): Promise<GenreGuardrailRow[]> {
  const { data, error } = await supabase.rpc('admin_list_genre_guardrails', {
    p_store_slug: storeSlug ?? null,
  });
  if (error) throw error;
  return (data ?? []) as GenreGuardrailRow[];
}

export async function adminGenreGuardrailSummary(): Promise<GenreGuardrailSummary | null> {
  const { data, error } = await supabase.rpc('admin_genre_guardrail_summary');
  if (error) throw error;
  return data as GenreGuardrailSummary;
}

export async function adminUpsertGenreGuardrail(input: {
  id?: string | null;
  genre_pattern?: string | null;
  store_slug?: string | null;
  rule_type?: GenreGuardrailRuleType | null;
  score_delta?: number | null;
  description?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc('admin_upsert_genre_guardrail', {
    p_id: input.id ?? null,
    p_genre_pattern: input.genre_pattern ?? null,
    p_store_slug: input.store_slug ?? null,
    p_rule_type: input.rule_type ?? null,
    p_score_delta: input.score_delta ?? null,
    p_description: input.description ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function adminToggleGenreGuardrail(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('admin_toggle_genre_guardrail', { p_id: id });
  if (error) throw error;
  return data as boolean;
}

export async function adminDeleteGenreGuardrail(id: string): Promise<void> {
  const { error } = await supabase.rpc('admin_delete_genre_guardrail', { p_id: id });
  if (error) throw error;
}
