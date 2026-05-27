import { supabase } from './supabase';

export interface MetadataTrainingStats {
  window_days: number;
  total_examples: number;
  ai_evaluated: number;
  ai_accuracy: number | null;
  by_correction_type: Record<string, number>;
  ai_wrong_by_store: Array<{ store: string; wrong: number; total: number; wrong_rate: number | null }>;
  ai_wrong_by_genre: Array<{ genre: string; wrong: number; total: number }>;
  uploader_user_wrong: Array<{ owner_user_id: string; user_wrong: number; total: number }>;
  frequent_ai_miss: Array<{ ai: string; admin: string; n: number }>;
}

export async function fetchMetadataTrainingStats(days = 90): Promise<MetadataTrainingStats | null> {
  const { data, error } = await supabase.rpc('admin_metadata_training_stats', { p_days: days });
  if (error) throw error;
  return (data as MetadataTrainingStats) ?? null;
}

export interface WeightSuggestion {
  id: string;
  suggestion_type: 'store_overpredict' | 'store_underpredict' | 'uploader_trust_down' | string;
  target_kind: string;
  target_key: string;
  metric: Record<string, unknown>;
  suggested_direction: 'up' | 'down' | null;
  suggested_action: string;
  target_config_key: string | null;
  confidence: number | null;
  source_window_days: number | null;
  status: 'pending' | 'approved' | 'rejected';
  generated_at: string;
  decided_at: string | null;
  decision_note: string | null;
}

/** 학습 데이터 기반 가중치 수정 "제안" 생성 (설정 무변경, 제안만 적재). */
export async function generateWeightSuggestions(days = 90, minSamples = 5): Promise<number> {
  const { data, error } = await supabase.rpc('admin_generate_weight_suggestions', { p_days: days, p_min_samples: minSamples });
  if (error) throw error;
  return (data as { generated_or_updated?: number } | null)?.generated_or_updated ?? 0;
}

export async function listWeightSuggestions(status?: string): Promise<WeightSuggestion[]> {
  const { data, error } = await supabase.rpc('admin_list_weight_suggestions', { p_status: status ?? null });
  if (error) throw error;
  return (data as WeightSuggestion[]) ?? [];
}

/** 제안 승인/반려 — 상태 기록만, 실제 가중치 반영은 하지 않음(Phase 4 별도). */
export async function decideWeightSuggestion(id: string, decision: 'approved' | 'rejected', note?: string): Promise<void> {
  const { error } = await supabase.rpc('admin_decide_weight_suggestion', { p_id: id, p_decision: decision, p_note: note ?? null });
  if (error) throw error;
}

export interface MetaTriple { genre: string[] | null; moods: string[] | null; store_tags: string[] | null; tempo: string | null }
export interface WeightSuggestionSample {
  track_id: string;
  track_title: string | null;
  artist_email: string | null;
  owner_user_id: string | null;
  ai_metadata: MetaTriple;
  user_metadata: MetaTriple;
  admin_final_metadata: MetaTriple;
  correction_type: string | null;
  changed_at: string | null;
  reviewed_by: string | null;
  field_diffs: Record<string, unknown> | null;
}

/** 특정 제안의 근거가 된 실제 샘플 곡 목록 (read-only). */
export async function fetchWeightSuggestionSamples(suggestionId: string, limit = 10): Promise<WeightSuggestionSample[]> {
  const { data, error } = await supabase.rpc('admin_weight_suggestion_samples', { p_suggestion_id: suggestionId, p_limit: limit });
  if (error) throw error;
  return ((data as { samples?: WeightSuggestionSample[] } | null)?.samples) ?? [];
}

export interface SimulationSample {
  track_id: string; title: string | null; artist_email: string | null;
  current_score: number; simulated_score: number; delta: number;
  current_top_stores: string[] | null; simulated_top_stores: string[] | null;
  currently_recommended: boolean; simulated_recommended: boolean; in_playlists: boolean;
}
export interface WeightSimulation {
  suggestion_id: string; suggestion_type: string; target_key: string;
  current_config: { fit_recommend_cutoff: number; store_exclude_threshold: number };
  proposed_delta: number;
  affected_tracks_count: number;
  would_drop_below_recommend: number;
  would_enter_recommend: number;
  would_be_excluded: number;
  playlist_impact_count: number;
  guardrail_conflict_change_estimate: { sensitive_store: boolean; direction: string; estimate: number };
  sample_tracks: SimulationSample[];
}

/** 제안 적용 전 영향도 시뮬레이션 (read-only, 실제 가중치/score/update 없음). */
export async function simulateWeightSuggestion(suggestionId: string, sampleLimit = 100): Promise<WeightSimulation> {
  const { data, error } = await supabase.rpc('admin_simulate_weight_suggestion', { p_suggestion_id: suggestionId, p_sample_limit: sampleLimit });
  if (error) throw error;
  return data as WeightSimulation;
}

export interface ShadowTrackDiff {
  track_id: string; playlist_id: string; store: string | null;
  current_score: number | null; shadow_score: number; delta: number;
  current_status: string | null; shadow_status: string; in_playlist: boolean; risk_reason: string | null;
}
export interface ShadowSimResult {
  affected_tracks_count: number;
  changed_recommendations_count: number;
  dropped_from_recommendation_count: number;
  newly_recommended_count: number;
  excluded_count: number;
  playlist_impact_count: number;
  guardrail_conflict_change: number;
  proposed_changes: Record<string, unknown>;
  config_weights: Record<string, number>;
  top_changed_tracks: ShadowTrackDiff[];
  risky_changes: ShadowTrackDiff[];
  safe_changes: ShadowTrackDiff[];
  note: string;
}

/** 제안 → shadow config 생성 (실제 config 무변경). shadow_config_id 반환. */
export async function createShadowFromSuggestion(suggestionId: string): Promise<string> {
  const { data, error } = await supabase.rpc('admin_create_shadow_config_from_suggestion', { p_suggestion_id: suggestionId });
  if (error) throw error;
  return (data as { shadow_config_id: string }).shadow_config_id;
}
/** shadow config 정밀 시뮬레이션 (실제 recompute 공식 재현, read-only). */
export async function simulateShadowConfig(shadowConfigId: string, sampleLimit = 500): Promise<ShadowSimResult> {
  const { data, error } = await supabase.rpc('admin_simulate_shadow_config', { p_shadow_config_id: shadowConfigId, p_sample_limit: sampleLimit });
  if (error) throw error;
  return data as ShadowSimResult;
}
/** shadow config 승인(반영 준비)/반려 — 상태만, 실제 config 반영은 Phase 4 별도. */
export async function decideShadowConfig(shadowConfigId: string, decision: 'approved_for_apply' | 'rejected'): Promise<void> {
  const { error } = await supabase.rpc('admin_decide_shadow_config', { p_id: shadowConfigId, p_decision: decision });
  if (error) throw error;
}

/** 변경 없이 "AI 정답/문제 없음" 확인을 학습 데이터로 명시 기록 (관리자 검수 화면에서 호출). */
export async function recordMetadataTrainingExample(
  trackId: string,
  correctionType: 'ai_correct' | 'admin_override' | 'user_wrong' | 'ai_wrong' | 'both_wrong' = 'ai_correct',
  reason?: string,
): Promise<void> {
  const { error } = await supabase.rpc('record_metadata_training_example', {
    p_track_id: trackId,
    p_correction_type: correctionType,
    p_reason: reason ?? null,
  });
  if (error) throw error;
}
