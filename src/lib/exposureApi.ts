// Phase ALGO-4A — AI Exposure Engine (Shadow) API 래퍼.
// 0430 admin RPC 경유. SHADOW ONLY — 실제 Queue/재생 순서 미반영.
// 기존 Queue/Scheduler/Playback/Settlement 무관.
import { supabase } from './supabase';

export interface ExposureRun {
  id: string; run_at: string; store_scope: string | null;
  track_count: number | null; store_count: number | null; score_count: number | null;
  formula_version: number; notes: string | null;
}

export interface ExposureCandidate {
  exposure_id: string; run_id: string; store_id: string | null; track_id: string;
  track_title: string | null; main_genre: string | null; mood: string | null;
  exposure_score: number; base_score: number; penalty: number;
  learning_score: number; freshness: number; completion_rate: number; skip_rate: number;
  recent_plays: number; settlement_eligible: boolean;
  store_name: string | null; health_score: number | null; rank: number;
}

export interface ExposureStoreProfile {
  store_id: string | null; store_name: string | null;
  candidate_count: number; avg_exposure: number; max_exposure: number; top_track_id: string | null;
}

export interface ExposureOverview {
  has_data: boolean;
  run?: ExposureRun;
  stores?: ExposureStoreProfile[];
  top_candidates?: ExposureCandidate[];
  low_exposure?: ExposureCandidate[];
}

export interface ExposureGenResult {
  ok: boolean; run_id: string; track_count: number; store_count: number; score_count: number; note?: string;
}

export interface ExposureExplain {
  id: string; run_id: string; store_id: string | null; track_id: string;
  track_title: string | null; store_name: string | null;
  exposure_score: number;
  explain: Record<string, unknown> | null;
  genome: Record<string, unknown> | null;
}

export interface TrackGenome { has_data?: boolean; [k: string]: unknown }
export interface StoreGenome { has_data?: boolean; [k: string]: unknown }

export async function adminGenerateExposureScores(storeId: string | null = null, trackLimit = 100): Promise<ExposureGenResult> {
  const { data, error } = await supabase.rpc('admin_generate_exposure_scores', { p_store_id: storeId, p_track_limit: trackLimit });
  if (error) throw error;
  return data as ExposureGenResult;
}

export async function adminExposureOverview(runId: string | null = null): Promise<ExposureOverview> {
  const { data, error } = await supabase.rpc('admin_exposure_overview', { p_run_id: runId });
  if (error) throw error;
  return data as ExposureOverview;
}

export async function adminGetExposureCandidates(storeId: string | null = null, limit = 50, runId: string | null = null): Promise<{ run_id: string | null; store_id: string | null; candidates: ExposureCandidate[] }> {
  const { data, error } = await supabase.rpc('admin_get_exposure_candidates', { p_store_id: storeId, p_limit: limit, p_run_id: runId });
  if (error) throw error;
  return data as { run_id: string | null; store_id: string | null; candidates: ExposureCandidate[] };
}

export async function adminGenerateShadowQueue(storeId: string, size = 20, runId: string | null = null): Promise<{ ok: boolean; run_id: string; store_id: string; queue_size: number; note?: string }> {
  const { data, error } = await supabase.rpc('admin_generate_shadow_queue', { p_store_id: storeId, p_size: size, p_run_id: runId });
  if (error) throw error;
  return data as { ok: boolean; run_id: string; store_id: string; queue_size: number; note?: string };
}

export async function adminGetExposureExplain(exposureScoreId: string): Promise<ExposureExplain> {
  const { data, error } = await supabase.rpc('admin_get_exposure_explain', { p_exposure_score_id: exposureScoreId });
  if (error) throw error;
  return data as ExposureExplain;
}

export async function adminGetTrackGenome(trackId: string): Promise<TrackGenome> {
  const { data, error } = await supabase.rpc('admin_get_track_genome', { p_track_id: trackId });
  if (error) throw error;
  return data as TrackGenome;
}

export async function adminGetStoreGenome(storeId: string): Promise<StoreGenome> {
  const { data, error } = await supabase.rpc('admin_get_store_genome', { p_store_id: storeId });
  if (error) throw error;
  return data as StoreGenome;
}
