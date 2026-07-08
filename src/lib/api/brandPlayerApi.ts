// Phase BRAND-1 — Brand Player RPC 래퍼.
// 모든 접근은 0405 의 SECURITY DEFINER RPC 경유 (brand_* 테이블 direct 접근 없음).
import { supabase } from '@/lib/supabase';
import type {
  BrandListItem, BrandDetail, BrandVerifyResult, BrandPlayerConfig,
  BrandVocalPolicy,
} from '@/types/brand';

// ── 사용자(매장) 경로 ────────────────────────────────────────────────
/** 브랜드 코드 검증 → 세션 토큰 발급. 실패 시 success=false + error 코드. */
export async function verifyBrandCode(code: string): Promise<BrandVerifyResult> {
  const { data, error } = await supabase.rpc('verify_brand_code', { p_code: code });
  if (error) throw error;
  return data as BrandVerifyResult;
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

/** 생성 → 평문 코드 1회 반환. */
export async function adminCreateBrand(input: {
  name: string; industryType?: string | null; description?: string | null;
}): Promise<{ success: boolean; id: string; code: string; code_hint: string }> {
  const { data, error } = await supabase.rpc('admin_create_brand', {
    p_name: input.name,
    p_industry_type: input.industryType ?? null,
    p_description: input.description ?? null,
  });
  if (error) throw error;
  return data as { success: boolean; id: string; code: string; code_hint: string };
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

/** 코드 재발급 → 새 평문 코드 1회 반환. 기존 코드/세션 무효화. */
export async function adminRegenerateBrandCode(id: string): Promise<{ success: boolean; code: string; code_hint: string }> {
  const { data, error } = await supabase.rpc('admin_regenerate_brand_code', { p_id: id });
  if (error) throw error;
  return data as { success: boolean; code: string; code_hint: string };
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
}): Promise<{ success: boolean; id: string; sort_order: number }> {
  const { data, error } = await supabase.rpc('admin_add_brand_media', {
    p_brand_id: input.brandId,
    p_image_url: input.imageUrl,
    p_title: input.title ?? null,
    p_display_duration_seconds: input.displayDurationSeconds ?? 10,
    p_sort_order: input.sortOrder ?? null,
    p_starts_at: input.startsAt ?? null,
    p_ends_at: input.endsAt ?? null,
  });
  if (error) throw error;
  return data as { success: boolean; id: string; sort_order: number };
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

export async function adminDeleteBrandMedia(assetId: string): Promise<{ success: boolean }> {
  const { data, error } = await supabase.rpc('admin_delete_brand_media', { p_asset_id: assetId });
  if (error) throw error;
  return data as { success: boolean };
}
