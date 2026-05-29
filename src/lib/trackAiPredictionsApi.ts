/**
 * trackAiPredictionsApi.ts — CLAP zero-shot + librosa 기반 트랙 메타데이터 자동 추론.
 *
 * 흐름:
 *   1) Modal worker 가 임베딩 추출 시 같이 energy_level + bpm + tempo_feel 예측
 *   2) track_ai_predictions 에 저장 (applied_at=null)
 *   3) admin 이 패널에서 검토 → 1-click 적용 (또는 confidence 임계점 일괄 적용)
 *   4) tracks 본 테이블 채워짐 → 추천/필터/검색에 활용
 */
import { supabase } from './supabase';

export interface PendingAiPrediction {
  id: string;
  track_id: string;
  track_title: string;
  track_artist: string | null;
  cover_url: string | null;
  main_genre: string | null;
  sub_genre: string | null;
  current_energy_level: number | null;
  current_bpm: number | null;
  current_tempo_feel: string | null;
  predicted_energy_level: number | null;
  energy_confidence: number | null;
  predicted_bpm: number | null;
  predicted_tempo_feel: string | null;
  model_version: string;
  created_at: string;
}

export interface AiPredictionsSummary {
  total_predictions: number;
  pending_count: number;
  applied_count: number;
  avg_energy_confidence: number | null;
  high_conf_pending: number;
}

export async function listPendingAiPredictions(limit = 50): Promise<PendingAiPrediction[]> {
  const { data, error } = await supabase.rpc('list_pending_ai_predictions', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as PendingAiPrediction[];
}

export async function aiPredictionsSummary(): Promise<AiPredictionsSummary> {
  const { data, error } = await supabase.rpc('ai_predictions_summary');
  if (error) throw error;
  return (data?.[0] ?? {
    total_predictions: 0, pending_count: 0, applied_count: 0,
    avg_energy_confidence: null, high_conf_pending: 0,
  }) as AiPredictionsSummary;
}

export async function applyTrackAiPredictions(
  predictionId: string,
  opts: { applyEnergy?: boolean; applyBpm?: boolean; applyTempoFeel?: boolean; overwriteExisting?: boolean } = {},
): Promise<void> {
  const { error } = await supabase.rpc('apply_track_ai_predictions', {
    p_prediction_id: predictionId,
    p_apply_energy: opts.applyEnergy ?? true,
    p_apply_bpm: opts.applyBpm ?? true,
    p_apply_tempo_feel: opts.applyTempoFeel ?? true,
    p_overwrite_existing: opts.overwriteExisting ?? false,
  });
  if (error) throw error;
}

export async function bulkApplyHighConfidence(
  confidenceThreshold = 0.6,
  limit = 500,
): Promise<number> {
  const { data, error } = await supabase.rpc('bulk_apply_high_confidence_ai_predictions', {
    p_confidence_threshold: confidenceThreshold,
    p_limit: limit,
  });
  if (error) throw error;
  return (data as number) ?? 0;
}
