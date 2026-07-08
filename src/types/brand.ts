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
  enterprise_account_id: string | null;
  enterprise_name: string | null;
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
    enterprise_account_id: string | null;
    enterprise_name: string | null;
    /** 연결 본사의 매장 코드(참고 표시용, read-only). 브랜드 코드 아님. */
    store_invite_code: string | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  };
  policy: BrandMusicPolicy | null;
  media: BrandMediaAsset[];
}

/** verify_store_code 응답 — 매장 코드 → 연결 브랜드 */
export interface StoreVerifyResult {
  success: boolean;
  error?: string;
  brand_id?: string;
  /** 연결 본사명 (표시용) */
  store_label?: string;
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

/** 매장 코드 검증 실패 사유 → 사용자 메시지 매핑 */
export const STORE_VERIFY_ERROR_MESSAGES: Record<string, string> = {
  empty_code: '매장 코드를 입력해주세요.',
  invalid_code: '매장 코드가 올바르지 않아요. 다시 확인해주세요.',
  brand_not_linked: '브랜드 플레이어가 아직 연결되지 않았습니다. 본사 또는 관리자에게 문의하세요.',
};
