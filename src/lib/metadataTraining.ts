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
