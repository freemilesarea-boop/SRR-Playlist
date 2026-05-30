/**
 * placementAuditApi.ts — 배치 진단 / 의심 플래그 큐 (0231 + 0232).
 *
 * 0232 운영 모드 (관찰):
 *  - flagPlacementRisks: 의심 placement 자동 검출 + placement_risk_flags 행 생성 (dryRun 지원)
 *  - listPlacementRisks: pending 큐 조회
 *  - decidePlacementRisk: 승인 / 유지 / 삭제 선택
 *  - getPlacementRiskStatus: 통계
 *  - explainPlacement: 단일 배치 점수 분해 (디버그)
 *
 * 자동 차단 정책은 보류 — taxonomy-v1 precision > 90% 검증 후 재검토.
 */
import { supabase } from './supabase';

export const LOUNGE_BUSINESS_CATEGORIES = ['호텔', '라운지', '와인바', '카페 라운지', '칵테일바', '미용실'];
export const EXCLUDED_GENRE_PATTERNS = ['rock', 'metal', 'punk', 'hard rock', 'hardstyle', 'hardcore', 'trap', 'drill'];

export type RiskDecision = 'pending' | 'approve' | 'keep' | 'remove';
export type RiskStatusFilter = RiskDecision | 'all';

export interface PlacementRiskFlag {
  flag_id: number;
  playlist_id: string;
  playlist_title: string;
  business_category: string | null;
  track_id: string;
  title: string;
  artist: string | null;
  main_genre: string | null;
  sub_genre: string | null;
  mood: string | null;
  suitable_store: string | null;
  matched_pattern: string | null;
  match_score: number | null;
  risk_reason: string;
  detected_at: string;
  decision: RiskDecision;
  decided_at: string | null;
  decision_note: string | null;
  ai_pred_main_genre: string | null;
  ai_pred_confidence: number | null;
}

export interface FlagDryRunResult {
  ok: true;
  dryRun: true;
  candidate_count: number;
  candidates: Array<{
    playlist_id: string;
    track_id: string;
    playlist_title: string;
    track_title: string;
    artist: string | null;
    main_genre: string;
    business_category: string;
    matched_pattern: string;
    match_score: number | null;
  }>;
}

export interface FlagApplyResult {
  ok: true;
  dryRun: false;
  candidate_count: number;
  inserted_count: number;
  run_id: string;
}

export type FlagResult = FlagDryRunResult | FlagApplyResult;

export async function flagPlacementRisks(
  dryRun: boolean,
  businessCategories: string[] = LOUNGE_BUSINESS_CATEGORIES,
  genrePatterns: string[] = EXCLUDED_GENRE_PATTERNS,
): Promise<FlagResult> {
  const { data, error } = await supabase.rpc('admin_flag_placement_risks', {
    p_dry_run: dryRun,
    p_business_patterns: businessCategories,
    p_genre_patterns: genrePatterns,
  });
  if (error) throw error;
  return data as FlagResult;
}

export async function listPlacementRisks(status: RiskStatusFilter = 'pending', limit = 100): Promise<PlacementRiskFlag[]> {
  const { data, error } = await supabase.rpc('admin_list_placement_risks', { p_status: status, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as PlacementRiskFlag[];
}

export async function decidePlacementRisk(
  flagId: number, decision: Exclude<RiskDecision, 'pending'>, note?: string,
): Promise<{ ok: true; flag_id: number; decision: RiskDecision }> {
  const { data, error } = await supabase.rpc('admin_decide_placement_risk', {
    p_flag_id: flagId, p_decision: decision, p_note: note ?? null,
  });
  if (error) throw error;
  return data as { ok: true; flag_id: number; decision: RiskDecision };
}

export interface PlacementRiskStatus {
  pending_count: number;
  approved_count: number;
  kept_count: number;
  removed_count: number;
  last_run_at: string | null;
}

export async function getPlacementRiskStatus(): Promise<PlacementRiskStatus | null> {
  const { data, error } = await supabase.rpc('admin_placement_risk_status');
  if (error) {
    if (import.meta.env.DEV) console.warn('[placement-risk] status failed', error);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row as PlacementRiskStatus;
}

// ===== 디버그 (0231 의 admin_explain_placement) =====
export interface PlacementExplanation {
  track: {
    id: string; title: string; artist: string | null;
    manual_main_genre: string | null; manual_sub_genre: string | null;
    manual_mood: string | null; manual_mood_tags: string[] | null;
    suitable_store: string | null; time_slots: string[] | null; genre_tags: string[] | null;
  };
  analysis: {
    genre: string | null; mood_tags: string[] | null;
    energy: number | null; bpm: number | null; quality_score: number | null;
  } | null;
  playlist: {
    id: string; title: string; business_category: string | null; daypart: string | null;
    genre_tags: string[] | null; mood_tags: string[] | null;
    bpm_min: number | null; bpm_max: number | null;
    energy_min: number | null; energy_max: number | null;
  };
  scores: {
    genre: number; mood: number; business: number; daypart: number;
    bpm: number; energy: number; vocal: number; quality: number;
    freshness: number; exclude_penalty: number;
  };
  block_reasons: string[] | null;
  allow_exceptions: string[] | null;
  final_score: number;
  threshold: number;
  would_place: boolean;
  metadata_source: string;
  ai_prediction_taxonomy_v1: {
    main: string | null; subs: string[] | null;
    confidence: number | null; applied_at: string | null;
  } | null;
}

export async function explainPlacement(trackId: string, playlistId: string): Promise<PlacementExplanation> {
  const { data, error } = await supabase.rpc('admin_explain_placement', {
    p_track_id: trackId, p_playlist_id: playlistId,
  });
  if (error) throw error;
  return data as PlacementExplanation;
}
