// Phase BRAND-1 — Franchise Brand Player 타입.
// 0405_brand_player_mvp.sql RPC 반환 구조와 1:1 대응.
import type { TrackRow } from './db';

export type BrandStatus = 'active' | 'inactive';
export type BrandVocalPolicy = 'any' | 'vocal_ok' | 'prefer_instrumental' | 'instrumental_only';

/** 관리자 목록 행 (admin_list_brands) */
export interface BrandListItem {
  id: string;
  name: string;
  status: BrandStatus;
  industry_type: string | null;
  description: string | null;
  code_hint: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  active_media_count: number;
  total_media_count: number;
  last_seen_at: string | null;
  auto_generate_enabled: boolean | null;
  preferred_genre_count: number | null;
  blocked_genre_count: number | null;
}

export interface BrandMusicPolicy {
  brand_id?: string;
  preferred_genres: string[];
  blocked_genres: string[];
  preferred_moods: string[];
  blocked_moods: string[];
  energy_min: number | null;
  energy_max: number | null;
  vocal_policy: BrandVocalPolicy;
  daypart_policy: Record<string, unknown> | null;
  auto_generate_enabled: boolean;
}

export interface BrandMediaAsset {
  id: string;
  asset_type: 'image';
  title: string | null;
  image_url: string;
  display_duration_seconds: number;
  sort_order: number;
  starts_at?: string | null;
  ends_at?: string | null;
  status?: BrandStatus;
  created_at?: string;
}

/** admin_get_brand */
export interface BrandDetail {
  brand: {
    id: string;
    name: string;
    status: BrandStatus;
    industry_type: string | null;
    description: string | null;
    code_hint: string | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  };
  policy: BrandMusicPolicy | null;
  media: BrandMediaAsset[];
}

/** verify_brand_code 성공 응답 */
export interface BrandVerifyResult {
  success: boolean;
  error?: string;
  brand_id?: string;
  brand_name?: string;
  session_token?: string;
  expires_at?: string;
}

/** get_brand_player_config */
export interface BrandPlayerConfig {
  brand: { id: string; name: string; industry_type: string | null };
  policy: Omit<BrandMusicPolicy, 'brand_id' | 'daypart_policy'> | null;
  media: Array<Pick<BrandMediaAsset, 'id' | 'title' | 'image_url' | 'display_duration_seconds' | 'sort_order'>>;
  playlist: TrackRow[];
}

/** brand code 검증 실패 사유 → 사용자 메시지 매핑 */
export const BRAND_VERIFY_ERROR_MESSAGES: Record<string, string> = {
  empty_code: '브랜드 코드를 입력해주세요.',
  invalid_code: '브랜드 코드가 올바르지 않아요. 다시 확인해주세요.',
  inactive_brand: '현재 사용할 수 없는 브랜드예요. 본사 또는 관리자에게 문의해주세요.',
};
