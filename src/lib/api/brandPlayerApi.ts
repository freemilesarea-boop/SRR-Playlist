// Phase BRAND-1 — Brand Player RPC 래퍼.
// 모든 접근은 0405 의 SECURITY DEFINER RPC 경유 (brand_* 테이블 direct 접근 없음).
import { supabase } from '@/lib/supabase';
import type {
  BrandListItem, BrandDetail, StoreVerifyResult, BrandPlayerConfig,
  BrandVocalPolicy, SignageTransitionEffect,
} from '@/types/brand';

// ── 사용자(매장) 경로 ────────────────────────────────────────────────
/**
 * 매장 코드(Store Invite Code) 검증 → 본사 조회 → 연결 브랜드 → 세션 토큰 발급.
 * 실패 시 success=false + error(empty_code/invalid_code/brand_not_linked).
 */
export async function verifyStoreCode(code: string): Promise<StoreVerifyResult> {
  const { data, error } = await supabase.rpc('verify_store_code', { p_store_code: code });
  if (error) throw error;
  return data as StoreVerifyResult;
}

/** 브랜드 플레이어 config (brand + policy + media + generated playlist). */
export async function getBrandPlayerConfig(brandId: string, sessionToken: string): Promise<BrandPlayerConfig> {
  const { data, error } = await supabase.rpc('get_brand_player_config', {
    p_brand_id: brandId,
    p_session_token: sessionToken,
  });
  if (error) throw error;
  return data as BrandPlayerConfig;
}

/** 세션 heartbeat (last_seen_at / 현재곡 갱신). 실패는 silent 처리 권장. */
export async function brandPlayerHeartbeat(
  brandId: string, sessionToken: string, currentTrackId: string | null, userAgent: string | null,
): Promise<{ success: boolean }> {
  const { data, error } = await supabase.rpc('brand_player_heartbeat', {
    p_brand_id: brandId,
    p_session_token: sessionToken,
    p_current_track_id: currentTrackId,
    p_user_agent: userAgent,
  });
  if (error) throw error;
  return data as { success: boolean };
}

// ── 관리자 경로 (서버 RPC 가 _is_super_admin 최종 판정) ──────────────
export async function adminListBrands(includeDeleted = false): Promise<BrandListItem[]> {
  const { data, error } = await supabase.rpc('admin_list_brands', { p_include_deleted: includeDeleted });
  if (error) throw error;
  return (data ?? []) as BrandListItem[];
}

export async function adminGetBrand(id: string): Promise<BrandDetail> {
  const { data, error } = await supabase.rpc('admin_get_brand', { p_id: id });
  if (error) throw error;
  return data as BrandDetail;
}

/** 브랜드 생성 (사용자 코드 없음). 선택적으로 연결 본사 지정. */
export async function adminCreateBrand(input: {
  name: string; industryType?: string | null; description?: string | null;
  enterpriseAccountId?: string | null;
}): Promise<{ success: boolean; id: string }> {
  const { data, error } = await supabase.rpc('admin_create_brand', {
    p_name: input.name,
    p_industry_type: input.industryType ?? null,
    p_description: input.description ?? null,
    p_enterprise_account_id: input.enterpriseAccountId ?? null,
  });
  if (error) throw error;
  return data as { success: boolean; id: string };
}

/** 브랜드 ↔ 본사 연결/해제 (null 이면 해제). 본사당 active 브랜드 1개. */
export async function adminSetBrandEnterprise(brandId: string, enterpriseId: string | null): Promise<{ success: boolean }> {
  const { data, error } = await supabase.rpc('admin_set_brand_enterprise', {
    p_brand_id: brandId,
    p_enterprise_id: enterpriseId,
  });
  if (error) throw error;
  return data as { success: boolean };
}

export async function adminUpdateBrand(input: {
  id: string; name?: string | null; industryType?: string | null;
  description?: string | null; status?: 'active' | 'inactive' | null;
}): Promise<{ success: boolean; id: string }> {
  const { data, error } = await supabase.rpc('admin_update_brand', {
    p_id: input.id,
    p_name: input.name ?? null,
    p_industry_type: input.industryType ?? null,
    p_description: input.description ?? null,
    p_status: input.status ?? null,
  });
  if (error) throw error;
  return data as { success: boolean; id: string };
}

export async function adminSetBrandDeleted(id: string, deleted: boolean): Promise<{ success: boolean }> {
  const { data, error } = await supabase.rpc('admin_set_brand_deleted', { p_id: id, p_deleted: deleted });
  if (error) throw error;
  return data as { success: boolean };
}

export async function adminUpsertBrandMusicPolicy(input: {
  brandId: string;
  preferredGenres?: string[] | null; blockedGenres?: string[] | null;
  preferredMoods?: string[] | null; blockedMoods?: string[] | null;
  energyMin?: number | null; energyMax?: number | null;
  vocalPolicy?: BrandVocalPolicy | null; autoGenerateEnabled?: boolean | null;
}): Promise<{ success: boolean }> {
  const { data, error } = await supabase.rpc('admin_upsert_brand_music_policy', {
    p_brand_id: input.brandId,
    p_preferred_genres: input.preferredGenres ?? null,
    p_blocked_genres: input.blockedGenres ?? null,
    p_preferred_moods: input.preferredMoods ?? null,
    p_blocked_moods: input.blockedMoods ?? null,
    p_energy_min: input.energyMin ?? null,
    p_energy_max: input.energyMax ?? null,
    p_vocal_policy: input.vocalPolicy ?? null,
    p_daypart_policy: null,
    p_auto_generate_enabled: input.autoGenerateEnabled ?? null,
  });
  if (error) throw error;
  return data as { success: boolean };
}

export async function adminAddBrandMedia(input: {
  brandId: string; imageUrl: string; title?: string | null;
  displayDurationSeconds?: number; sortOrder?: number | null;
  startsAt?: string | null; endsAt?: string | null;
  /** UX-3: 'image' | 'video' (기본 image). */
  assetType?: 'image' | 'video' | null;
  mimeType?: string | null;
  thumbnailUrl?: string | null;
  mediaDurationSeconds?: number | null;
}): Promise<{ success: boolean; id: string; sort_order: number; asset_type?: 'image' | 'video' }> {
  const { data, error } = await supabase.rpc('admin_add_brand_media', {
    p_brand_id: input.brandId,
    p_image_url: input.imageUrl,
    p_title: input.title ?? null,
    p_display_duration_seconds: input.displayDurationSeconds ?? 10,
    p_sort_order: input.sortOrder ?? null,
    p_starts_at: input.startsAt ?? null,
    p_ends_at: input.endsAt ?? null,
    p_asset_type: input.assetType ?? 'image',
    p_mime_type: input.mimeType ?? null,
    p_thumbnail_url: input.thumbnailUrl ?? null,
    p_media_duration_seconds: input.mediaDurationSeconds ?? null,
  });
  if (error) throw error;
  return data as { success: boolean; id: string; sort_order: number; asset_type?: 'image' | 'video' };
}

export async function adminUpdateBrandMedia(input: {
  assetId: string; title?: string | null; displayDurationSeconds?: number | null;
  sortOrder?: number | null; startsAt?: string | null; endsAt?: string | null;
  status?: 'active' | 'inactive' | null;
}): Promise<{ success: boolean }> {
  const { data, error } = await supabase.rpc('admin_update_brand_media', {
    p_asset_id: input.assetId,
    p_title: input.title ?? null,
    p_display_duration_seconds: input.displayDurationSeconds ?? null,
    p_sort_order: input.sortOrder ?? null,
    p_starts_at: input.startsAt ?? null,
    p_ends_at: input.endsAt ?? null,
    p_status: input.status ?? null,
  });
  if (error) throw error;
  return data as { success: boolean };
}

/**
 * 브랜드 사이니지 설정(전환효과/시간 + presentation 표시옵션) upsert.
 * 서버(0452 admin_upsert_brand_signage_settings)가 _is_super_admin 최종 판정 + 값 정규화/clamp.
 * null 인자는 기존 값 유지(부분 저장). 성공 시 정규화된 effect/duration 반환.
 */
export async function adminUpsertBrandSignageSettings(input: {
  brandId: string;
  transitionEffect?: SignageTransitionEffect | null;
  transitionDurationMs?: number | null;
  showBrandName?: boolean | null;
  showNowPlaying?: boolean | null;
  showClock?: boolean | null;
  showSlideDots?: boolean | null;
}): Promise<{ success: boolean; transition_effect: SignageTransitionEffect; transition_duration_ms: number }> {
  const { data, error } = await supabase.rpc('admin_upsert_brand_signage_settings', {
    p_brand_id: input.brandId,
    p_transition_effect: input.transitionEffect ?? null,
    p_transition_duration_ms: input.transitionDurationMs ?? null,
    p_show_brand_name: input.showBrandName ?? null,
    p_show_now_playing: input.showNowPlaying ?? null,
    p_show_clock: input.showClock ?? null,
    p_show_slide_dots: input.showSlideDots ?? null,
  });
  if (error) throw error;
  return data as { success: boolean; transition_effect: SignageTransitionEffect; transition_duration_ms: number };
}

export async function adminDeleteBrandMedia(assetId: string): Promise<{ success: boolean }> {
  const { data, error } = await supabase.rpc('admin_delete_brand_media', { p_asset_id: assetId });
  if (error) throw error;
  return data as { success: boolean };
}
