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

/** 브랜드 정책 모드 — 업종 기본 상속 vs 브랜드 커스텀 (0464). */
export type BrandPolicyMode = 'inherit' | 'custom';

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
  /** 0464: 정책 모드. 레거시 행/RPC 응답에는 없을 수 있어 optional. */
  policy_mode?: BrandPolicyMode;
  /** 0464: 허용 장르 whitelist(비면 전체 허용). */
  allowed_genres?: string[];
  /** 0464: BPM 범위(분석값 없는 곡은 통과). */
  bpm_min?: number | null;
  bpm_max?: number | null;
  /** 0464: 마지막 수정 시각(감사 표시용). */
  updated_at?: string | null;
  /** 0464: 마지막 수정 관리자 uuid. */
  updated_by?: string | null;
  /** 0464: 마지막 수정 관리자 이메일(admin_get_brand 가 auth.users 조인으로 해석). */
  updated_by_email?: string | null;
}

/** admin_preview_brand_music_policy 반환 — 저장 전 후보 수 미리보기(0464). */
export interface BrandPolicyPreview {
  total: number;
  industry_pass: number;
  eligible: number;
  blocked_by: {
    industry: number;
    genre_block: number;
    genre_not_allowed: number;
    mood_block: number;
    vocal: number;
    energy: number;
    bpm: number;
  };
  is_study: boolean;
  policy_mode: BrandPolicyMode;
}

/** 지원 이미지 전환 효과 (slide/zoom/kenburns 미지원). */
export type SignageTransitionEffect = 'none' | 'fade';

/**
 * 브랜드 레벨 사이니지 설정 (0452 brand_signage_settings / _brand_signage_json).
 * 행이 없는 레거시 브랜드는 서버가 default(fade/500/전부 off)로 채운다.
 */
export interface SignageSettings {
  transition_effect: SignageTransitionEffect;
  /** 전환 애니메이션 시간(ms, 0~2000). 이미지 유지 시간과 별개. */
  transition_duration_ms: number;
  show_brand_name: boolean;
  show_now_playing: boolean;
  show_clock: boolean;
  show_slide_dots: boolean;
}

/** 사이니지 미디어 종류 (UX-3: 이미지 + 동영상). */
export type BrandMediaType = 'image' | 'video';

export interface BrandMediaAsset {
  id: string;
  asset_type: BrandMediaType;
  title: string | null;
  /** 저장 파일 URL (image 또는 video). 컬럼명은 레거시상 image_url 이지만 video URL 도 담는다. */
  image_url: string;
  display_duration_seconds: number;
  sort_order: number;
  starts_at?: string | null;
  ends_at?: string | null;
  status?: BrandStatus;
  created_at?: string;
  /** UX-3: 업로드 MIME (image/* 또는 video/*). */
  mime_type?: string | null;
  /** UX-3: video 썸네일 URL(선택). null 이면 video 첫 프레임 사용. */
  thumbnail_url?: string | null;
  /** UX-3: video 재생 길이(초, 표시용). image 는 null. */
  media_duration_seconds?: number | null;
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
  /** 0452 이후 항상 포함(레거시는 default). */
  signage: SignageSettings;
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
  media: Array<Pick<BrandMediaAsset,
    'id' | 'title' | 'image_url' | 'display_duration_seconds' | 'sort_order'
    | 'asset_type' | 'mime_type' | 'thumbnail_url' | 'media_duration_seconds'>>;
  /** 0452 이후 항상 포함(레거시는 default). */
  signage: SignageSettings;
  playlist: TrackRow[];
  /**
   * 0508 — 이 플레이리스트의 버전. 매일 09:00 KST 스냅샷이 새로 만들어질 때 바뀐다.
   * 플레이어는 이 값만 폴링하다가 값이 달라지면 큐를 무중단 교체한다.
   * (스냅샷 이전 레거시 응답에는 없을 수 있어 optional)
   */
  playlist_version?: string;
  /** 0508 — 브랜드 재생 정책(24시간/영업시간) 판정 결과. */
  playback?: BrandPlaybackWindow;
}

/** 0508 — 지금 재생해도 되는지에 대한 서버 판정. */
export interface BrandPlaybackWindow {
  mode: 'always_on' | 'business_hours';
  should_play: boolean;
  reason?: 'open' | 'closed_hours' | 'closed_day' | 'brand_not_found';
  local_time?: string;
  open_time?: string | null;
  close_time?: string | null;
  timezone?: string;
}

/** 0508 — 가벼운 폴링 응답 (큐 전체를 받지 않는다). */
export interface BrandPlaylistVersion {
  playlist_version: string;
  track_count: number;
  new_release_count: number;
  playback: BrandPlaybackWindow;
}

/** 0508 — 관리자: 브랜드별 재생 정책. */
export interface BrandPlaybackPolicy {
  brand_id: string;
  brand_name: string;
  playback_mode: 'always_on' | 'business_hours';
  open_time: string | null;
  close_time: string | null;
  playback_timezone: string;
  /** 0=일 … 6=토. null 이면 매일. */
  playback_days: number[] | null;
  now: BrandPlaybackWindow;
  today: {
    service_date: string;
    track_count: number;
    new_release_count: number;
    total_hours: number;
    generated_at: string;
  } | null;
}

/** 매장 코드 검증 실패 사유 → 사용자 메시지 매핑 */
export const STORE_VERIFY_ERROR_MESSAGES: Record<string, string> = {
  empty_code: '매장 코드를 입력해주세요.',
  invalid_code: '매장 코드가 올바르지 않아요. 다시 확인해주세요.',
  brand_not_linked: '브랜드 플레이어가 아직 연결되지 않았습니다. 본사 또는 관리자에게 문의하세요.',
};
