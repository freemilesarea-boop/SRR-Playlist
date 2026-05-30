/**
 * qcApi.ts — Phase 0 AI 음원 QC (DSP-급 검수).
 *
 * Modal 워커가 자동 분석한 결과를 admin UI 에서 조회.
 *  - getTrackQcReport: 단일 트랙
 *  - listQcReviewQueue: 검수 대기 큐 (위험도 우선 정렬)
 */
import { supabase } from './supabase';

export type QcGrade = 'A' | 'B' | 'C' | 'D';
export type QcRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface QcIssue {
  code: string;
  message: string;
}

export interface AudioQcReport {
  id: string;
  track_id: string;
  integrated_lufs: number | null;
  true_peak_db: number | null;
  dynamic_range: number | null;
  stereo_width: number | null;
  noise_floor_db: number | null;
  silence_ratio: number | null;
  clipping_count: number | null;
  distortion_score: number | null;
  sample_rate: number | null;
  bit_depth: number | null;
  duration: number | null;
  qc_score: number | null;
  qc_grade: QcGrade | null;
  risk_level: QcRiskLevel | null;
  issues_json: QcIssue[] | null;
  model_version: string;
  created_at: string;
}

export interface QcReviewQueueRow {
  track_id: string;
  title: string;
  artist: string | null;
  cover_url: string | null;
  release_status: string | null;
  submitted_at: string | null;
  qc_score: number | null;
  qc_grade: QcGrade | null;
  risk_level: QcRiskLevel | null;
  integrated_lufs: number | null;
  true_peak_db: number | null;
  clipping_count: number | null;
  issues_count: number;
  qc_created_at: string | null;
}

export async function getTrackQcReport(trackId: string): Promise<AudioQcReport | null> {
  const { data, error } = await supabase.rpc('get_track_qc_report', { p_track_id: trackId });
  if (error) {
    if (import.meta.env.DEV) console.warn('[qc] fetch failed', error);
    return null;
  }
  return data as AudioQcReport | null;
}

export async function listQcReviewQueue(limit = 50): Promise<QcReviewQueueRow[]> {
  const { data, error } = await supabase.rpc('list_admin_qc_review_queue', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as QcReviewQueueRow[];
}

// 등급/위험도 색상 도구
export const GRADE_TONE: Record<QcGrade, string> = {
  A: 'text-emerald-400 bg-emerald-500/15 ring-emerald-500/30',
  B: 'text-sky-400 bg-sky-500/15 ring-sky-500/30',
  C: 'text-amber-400 bg-amber-500/15 ring-amber-500/30',
  D: 'text-rose-400 bg-rose-500/15 ring-rose-500/30',
};

export const RISK_TONE: Record<QcRiskLevel, string> = {
  LOW: 'text-emerald-400 bg-emerald-500/10 ring-emerald-500/20',
  MEDIUM: 'text-sky-400 bg-sky-500/10 ring-sky-500/20',
  HIGH: 'text-amber-400 bg-amber-500/15 ring-amber-500/30',
  CRITICAL: 'text-rose-400 bg-rose-500/20 ring-rose-500/40',
};
