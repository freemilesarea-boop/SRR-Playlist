/**
 * audioQcGuideApi.ts — 음원 업로드 가이드 + 본인 QC 리포트 (X6.35)
 */
import { supabase } from './supabase';
import { fetchAllPages, RPC_NO_LIMIT } from './fetchAllPages';

export interface AudioUploadGuidelines {
  integrated_lufs: {
    recommended_min: number;
    recommended_max: number;
    ideal_target: number;
    note: string;
  };
  true_peak_db: { recommended_max: number; ideal_max: number; note: string };
  clipping_count: { recommended_max: number; fail_threshold: number; note: string };
  qc_score: { recommended_min: number; excellent: number; note: string };
  file_format: { accepted: string[]; max_size_mb: number; preferred: string };
  duration: { recommended_min_seconds: number; recommended_max_seconds: number; note: string };
  common_rejection_reasons: Array<{ reason: string; tips: string }>;
  general_tips: string[];
}

export async function fetchAudioUploadGuidelines(): Promise<AudioUploadGuidelines> {
  const { data, error } = await supabase.rpc('get_audio_upload_guidelines');
  if (error) throw error;
  return data as AudioUploadGuidelines;
}

export type QcVerdict = 'ok' | 'warning' | 'fail' | 'unknown';

export interface TrackQcValidation {
  track_id: string;
  status: 'analyzing' | 'analyzed';
  analyzed: boolean;
  overall_verdict?: QcVerdict;
  qc_score?: number;
  qc_grade?: string;
  risk_level?: string;
  metrics?: {
    integrated_lufs?: number;
    true_peak_db?: number;
    clipping_count?: number;
    noise_floor_db?: number;
    dynamic_range?: number;
    duration?: number;
  };
  verdicts?: {
    lufs: QcVerdict;
    true_peak: QcVerdict;
    clipping: QcVerdict;
    qc_score: QcVerdict;
  };
  messages?: string[];
  measured_at?: string;
  message?: string;
}

export async function validateTrackAudioQc(trackId: string): Promise<TrackQcValidation> {
  const { data, error } = await supabase.rpc('validate_track_audio_qc', { p_track_id: trackId });
  if (error) throw error;
  return data as TrackQcValidation;
}

export interface MyTrackQcRow {
  track_id: string;
  title: string;
  release_status: string;
  created_at: string;
  qc_score: number | null;
  qc_grade: string | null;
  risk_level: string | null;
  integrated_lufs: number | null;
  true_peak_db: number | null;
  clipping_count: number | null;
  has_report: boolean;
}

/**
 * 내 음원 QC 리포트. limit 을 주지 않으면 전부 받는다 — 곡이 많은 아티스트(600곡+)도
 * 음원 관리의 모든 곡에 QC 배지가 붙어야 한다 (예전엔 최신 100곡만).
 */
export async function fetchMyTrackQcReport(limit?: number): Promise<MyTrackQcRow[]> {
  if (limit != null) {
    const { data, error } = await supabase.rpc('get_my_track_qc_report', { p_limit: limit });
    if (error) throw error;
    return (data ?? []) as MyTrackQcRow[];
  }
  return fetchAllPages<MyTrackQcRow>((from, to) =>
    supabase.rpc('get_my_track_qc_report', { p_limit: RPC_NO_LIMIT })
      .order('created_at', { ascending: false }).order('track_id').range(from, to) as unknown as
      PromiseLike<{ data: MyTrackQcRow[] | null; error: unknown }>);
}
