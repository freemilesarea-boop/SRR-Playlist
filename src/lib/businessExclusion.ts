/**
 * businessExclusion — X6.72 / Phase 5: 매장주 1-click 트랙 제외.
 *
 * Phase 3c (X6.65) 의 매장별 cluster 학습 데이터를 채우기 위한 사용자 진입점.
 * business 플랜 사용자가 재생 중인 트랙을 "이 곡 우리 매장 안 어울려" 표시 →
 *   1) track_store_exclusions (is_active=true) 저장
 *   2) 트리거가 fit_score_recompute_jobs 에 segment scope enqueue (Phase 4d 연계)
 *   3) 다음 트랙부터 _ai_check_store_guardrails 로 자동 차단
 *
 * 매장 매핑: useBusinessStore.selectedCategory (한글) → BUSINESS_TAG_MAP slug.
 */
import { supabase } from '@/lib/supabase';
import { BUSINESS_CATEGORIES } from '@/lib/constants';

const BUSINESS_TAG_MAP: Record<string, string> = {
  '카페': 'cafe',
  'PT샵': 'fitness',
  '필라테스': 'fitness',
  '와인바': 'winebar',
  '네일샵': 'beauty_shop',
  '편집샵': 'boutique',
};

export function deriveStoreTypeSlug(selectedCategory: string | null): string | null {
  if (!selectedCategory) return null;
  return BUSINESS_TAG_MAP[selectedCategory] ?? null;
}

export interface BusinessExclusionResult {
  ok: boolean;
  exclusion_id: string;
  track_id: string;
  store_type_slug: string;
  reason_key: string;
  reason: string;
}

export async function businessExcludeTrack(
  trackId: string,
  storeTypeSlug: string,
  reasonKey: string = 'store_mismatch',
): Promise<BusinessExclusionResult> {
  const { data, error } = await supabase.rpc('business_exclude_track', {
    p_track_id: trackId,
    p_store_type_slug: storeTypeSlug,
    p_reason_key: reasonKey,
  });
  if (error) throw error;
  return data as BusinessExclusionResult;
}

export async function businessUndoTrackExclusion(
  exclusionId: string,
): Promise<{ ok: boolean; exclusion_id: string; track_id: string; store_type_slug: string }> {
  const { data, error } = await supabase.rpc('business_undo_track_exclusion', {
    p_exclusion_id: exclusionId,
  });
  if (error) throw error;
  return data as { ok: boolean; exclusion_id: string; track_id: string; store_type_slug: string };
}

export interface MyExclusionRow {
  id: string;
  track_id: string;
  track_title: string | null;
  track_artist: string | null;
  cover_url: string | null;
  store_type_slug: string;
  reason: string | null;
  created_at: string;
}

export async function businessListMyExclusions(
  storeTypeSlug: string | null = null,
  limit: number = 100,
): Promise<MyExclusionRow[]> {
  const { data, error } = await supabase.rpc('business_list_my_exclusions', {
    p_store_type_slug: storeTypeSlug,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as MyExclusionRow[];
}

// dev-time guard — BUSINESS_CATEGORIES 와 BUSINESS_TAG_MAP 동기화 검증
if (import.meta.env.DEV) {
  for (const c of BUSINESS_CATEGORIES) {
    if (!(c.key in BUSINESS_TAG_MAP)) {
      console.warn('[businessExclusion] BUSINESS_TAG_MAP 누락:', c.key);
    }
  }
}
