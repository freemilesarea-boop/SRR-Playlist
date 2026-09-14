// Phase BRAND-1 — Brand Player RPC 래퍼.
// 모든 접근은 0405 의 SECURITY DEFINER RPC 경유 (brand_* 테이블 direct 접근 없음).
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type {
  BrandListItem, BrandDetail, StoreVerifyResult, BrandPlayerConfig,
  BrandVocalPolicy, SignageTransitionEffect, BrandPolicyMode, BrandPolicyPreview,
  BrandPlaylistVersion, BrandPlaybackPolicy,
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

/**
 * 0508 — 플레이리스트 버전만 확인하는 가벼운 폴링.
 * 매일 09:00 KST 서버가 새 스냅샷을 만들면 version 이 바뀐다. 값이 달라졌을 때만
 * getBrandPlayerConfig 로 새 목록을 받아 무중단 교체한다.
 */
export async function getBrandPlaylistVersion(brandId: string, sessionToken: string): Promise<BrandPlaylistVersion> {
  const { data, error } = await supabase.rpc('get_brand_playlist_version', {
    p_brand_id: brandId,
    p_session_token: sessionToken,
  });
  if (error) throw error;
  return data as BrandPlaylistVersion;
}

// ── BRAND-DEVICE-BINDING-1: 기기 Binding 서버 검증/폐기/목록 ──────────────
/** 서버 재검증 결과(민감정보 없음). */
export interface BindingVerify {
  ok: boolean;
  reason?: string;
  brand_name?: string | null;
  device_label?: string | null;
  expires_at?: string | null;
}

/** 자동 진입 전 Device Binding 서버 재검증(소유자+미폐기+미만료+활성 브랜드). */
export async function verifyBrandDeviceBinding(brandId: string, sessionToken: string): Promise<BindingVerify> {
  const { data, error } = await supabase.rpc('verify_brand_device_binding', {
    p_brand_id: brandId,
    p_session_token: sessionToken,
  });
  if (error) throw error;
  return (data ?? { ok: false, reason: 'error' }) as BindingVerify;
}

/** 이 기기 연결 해제(자기 binding 만). */
export async function revokeBrandDeviceByToken(brandId: string, sessionToken: string): Promise<{ ok: boolean; reason?: string }> {
  const { data, error } = await supabase.rpc('revoke_brand_device_by_token', {
    p_brand_id: brandId,
    p_session_token: sessionToken,
  });
  if (error) throw error;
  return (data ?? { ok: false }) as { ok: boolean; reason?: string };
}

export interface MyBrandDevice {
  device_label: string | null;
  brand_name: string | null;
  last_seen_at: string | null;
  created_at: string | null;
  expires_at: string | null;
  revoked: boolean;
}

/** 내 계정에 연결된 기기 목록(비민감 표시정보만). */
export async function listMyBrandDevices(): Promise<MyBrandDevice[]> {
  const { data, error } = await supabase.rpc('list_my_brand_devices');
  if (error) throw error;
  return (data ?? []) as MyBrandDevice[];
}

/** 세션 heartbeat (last_seen_at / 현재곡 갱신). 실패는 silent 처리 권장. */
/** 원격 제어 명령 (0518). heartbeat 응답에 실려 1회만 배달된다. */
export type BrandPlayerCommand = 'reload' | 'play' | 'next' | 'hard_recovery';

export interface BrandPlayerHeartbeatResult {
  success: boolean;
  /** 대기 중인 명령이 있으면 그 종류. 없으면 null. */
  command?: BrandPlayerCommand | null;
  /** 중복 실행 방지용 식별자. */
  command_id?: string | null;
  /**
   * 0520 — 이 클라이언트의 세션 id. Realtime 으로 들어온 명령이 **이 탭**을 지목한
   * 것인지 판별하는 데 쓴다. 같은 매장 계정으로 탭이 둘 열려 있으면 두 탭 모두
   * Realtime row 를 받으므로, 세션 대조 없이는 엉뚱한 탭이 실행한다.
   * 구버전 서버는 이 키를 주지 않는다 — 그 경우 세션 지목 명령은 heartbeat 로만 닿는다.
   */
  session_id?: string | null;
}

/**
 * 16A — heartbeat 에 실어 보내는 build identity. 전부 선택적이다.
 * 서버 쪽 인자가 default null 이므로 이 값들을 안 보내도 heartbeat 는 정상이다.
 */
export interface HeartbeatBuildIdentity {
  pageBuildHash?: string | null;
  swBuildHash?: string | null;
  swControlled?: boolean | null;
  navigationType?: string | null;
}

/**
 * 17 — 이 heartbeat 시점의 클라이언트 상태. 프로세스가 OS 에 끊기면 아무것도
 * 보낼 수 없으므로, **마지막 heartbeat 가 곧 부검 소견서**가 된다.
 */
export interface HeartbeatLiveness {
  playerInstanceId?: string | null;
  lastAudioProgressAt?: string | null;
  visibilityState?: string | null;
  online?: boolean | null;
  realtimeStatus?: string | null;
  wakeLockActive?: boolean | null;
}

export async function brandPlayerHeartbeat(
  brandId: string, sessionToken: string, currentTrackId: string | null, userAgent: string | null,
  identity?: HeartbeatBuildIdentity,
  liveness?: HeartbeatLiveness,
): Promise<BrandPlayerHeartbeatResult> {
  const { data, error } = await supabase.rpc('brand_player_heartbeat', {
    p_brand_id: brandId,
    p_session_token: sessionToken,
    p_current_track_id: currentTrackId,
    p_user_agent: userAgent,
    // 16A — 지금 돌고 있는 코드의 신원. 서버 기대값을 복사해 보내지 않는다.
    p_page_build_hash: identity?.pageBuildHash ?? null,
    p_sw_build_hash: identity?.swBuildHash ?? null,
    p_sw_controlled: identity?.swControlled ?? null,
    p_navigation_type: identity?.navigationType ?? null,
    // 17 — 죽기 직전의 마지막 정상 상태. 전부 nullable 이라 구버전 서버에서도
    // 실패하지 않는다(인자 기본값이 있다).
    p_player_instance_id: liveness?.playerInstanceId ?? null,
    p_last_audio_progress_at: liveness?.lastAudioProgressAt ?? null,
    p_visibility_state: liveness?.visibilityState ?? null,
    p_client_online: liveness?.online ?? null,
    p_realtime_status: liveness?.realtimeStatus ?? null,
    p_wake_lock_active: liveness?.wakeLockActive ?? null,
  });
  if (error) throw error;
  return data as BrandPlayerHeartbeatResult;
}

/** 관리자용 실시간 세션 상태 (0518 원격 제어 대상 목록). */
export interface BrandPlayerHealthRow {
  session_id: string;
  /** 0519 — 명령을 매장 단위로 정확히 지목하기 위해 필요하다. */
  store_user_id: string;
  brand_id: string;
  /** 아직 종결되지 않은 최근 명령 1건 (운영자가 배달 상태를 보게). */
  pending_command?: string | null;
  pending_command_id?: string | null;
  pending_command_status?: string | null;
  /** 0520 — 이 명령이 어느 경로로 갔는가 (realtime / heartbeat). */
  pending_command_delivery_source?: string | null;
  /** 0520 — 마지막으로 실제 클라이언트에 닿은 명령 시각/경로. Realtime 가동 여부 근거. */
  last_command_received_at?: string | null;
  last_command_delivery_source?: string | null;
  brand_name: string;
  store_label: string;
  status: 'playing' | 'stalled' | 'offline';
  seconds_since_heartbeat: number;
  seconds_on_current_track: number;
  current_track_title: string | null;
  device: string | null;
  last_seen_at: string;
}

export async function adminBrandPlayerHealth(minutes = 1440): Promise<BrandPlayerHealthRow[]> {
  const { data, error } = await supabase.rpc('admin_brand_player_health', { p_minutes: minutes });
  if (error) throw error;
  return (data ?? []) as BrandPlayerHealthRow[];
}

/** 매장 세션에 원격 명령을 넣는다 (super admin). 10분 내 heartbeat 로 배달된다. */
export async function adminEnqueueBrandPlayerCommand(
  sessionId: string, command: BrandPlayerCommand, note?: string,
): Promise<{ success: boolean; id: string; command: BrandPlayerCommand }> {
  const { data, error } = await supabase.rpc('admin_enqueue_brand_player_command', {
    p_session_id: sessionId,
    p_command: command,
    p_note: note ?? null,
  });
  if (error) throw error;
  return data as { success: boolean; id: string; command: BrandPlayerCommand };
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
  /** 0464 스튜디오: 정책 모드 + 허용 장르 whitelist + BPM 범위. */
  policyMode?: BrandPolicyMode | null;
  allowedGenres?: string[] | null;
  bpmMin?: number | null; bpmMax?: number | null;
}): Promise<{ success: boolean; policy_mode?: BrandPolicyMode; warnings?: string[] }> {
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
    p_policy_mode: input.policyMode ?? null,
    p_allowed_genres: input.allowedGenres ?? null,
    p_bpm_min: input.bpmMin ?? null,
    p_bpm_max: input.bpmMax ?? null,
  });
  if (error) throw error;
  return data as { success: boolean; policy_mode?: BrandPolicyMode; warnings?: string[] };
}

/**
 * 저장 전 후보 수 미리보기(0464). p_overrides 로 미저장 폼값을 반영해 "저장하면 몇 곡 남는가"
 * 를 서버가 런타임과 동일한 필터로 계산한다. 읽기전용(민감정보 없음).
 */
export async function adminPreviewBrandMusicPolicy(
  brandId: string,
  overrides?: Record<string, unknown> | null,
): Promise<BrandPolicyPreview> {
  const { data, error } = await supabase.rpc('admin_preview_brand_music_policy', {
    p_brand_id: brandId,
    p_overrides: overrides ?? null,
  });
  if (error) throw error;
  return data as BrandPolicyPreview;
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

// ── 0508 관리자: 브랜드별 재생 정책 (24시간 / 영업시간) ──────────────
export async function adminGetBrandPlaybackPolicy(brandId: string): Promise<BrandPlaybackPolicy> {
  const { data, error } = await supabase.rpc('admin_get_brand_playback_policy', { p_brand_id: brandId });
  if (error) throw error;
  return data as BrandPlaybackPolicy;
}

export async function adminSetBrandPlaybackPolicy(input: {
  brandId: string;
  playbackMode: 'always_on' | 'business_hours';
  openTime?: string | null;
  closeTime?: string | null;
  timezone?: string;
  days?: number[] | null;
}): Promise<BrandPlaybackPolicy> {
  const { data, error } = await supabase.rpc('admin_set_brand_playback_policy', {
    p_brand_id: input.brandId,
    p_playback_mode: input.playbackMode,
    p_open_time: input.openTime ?? null,
    p_close_time: input.closeTime ?? null,
    p_timezone: input.timezone ?? 'Asia/Seoul',
    p_days: input.days ?? null,
  });
  if (error) throw error;
  return data as BrandPlaybackPolicy;
}

/** 오늘 플레이리스트 즉시 재생성 (09:00 스냅샷을 기다리지 않고). */
export async function adminRegenerateBrandDailyPlaylist(brandId: string): Promise<{
  ok: boolean; reason?: string; service_date?: string;
  track_count?: number; new_release_count?: number; total_hours?: number;
}> {
  const { data, error } = await supabase.rpc('admin_regenerate_brand_daily_playlist', { p_brand_id: brandId });
  if (error) throw error;
  return data as { ok: boolean };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* 0519 — 원격 복구 제어                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

export type RecoveryStatus =
  | 'pending' | 'received' | 'executing' | 'succeeded' | 'failed' | 'expired' | 'rejected';

/**
 * 명령 결과 보고. 실패해도 재생을 막지 않는다(fire-and-forget).
 * 서버가 상태 역전을 거부하므로 중복 ACK 는 무해하다.
 */
export async function ackStoreRecovery(
  commandId: string,
  status: RecoveryStatus,
  resultCode?: string,
  buildHash?: string,
  playerInstanceId?: string,
): Promise<void> {
  try {
    await supabase.rpc('ack_store_recovery', {
      p_command_id: commandId,
      p_status: status,
      p_result_code: resultCode ?? null,
      p_build_hash: buildHash ?? null,
      p_player_instance_id: playerInstanceId ?? null,
    });
  } catch {
    /* 결과 보고 실패가 복구를 막아선 안 된다 */
  }
}

export interface RequestRecoveryResult {
  success: boolean;
  command_id?: string;
  session_id?: string;
  command?: BrandPlayerCommand;
  reason?: string;
  retry_after_seconds?: number;
}

/**
 * 운영자 원격 복구 요청. **admin 전용** — 서버가 _is_super_admin() 으로 거부한다.
 * store_user_id 는 필수다(전 매장 broadcast 불가).
 */
export async function requestStoreRecovery(
  storeUserId: string,
  command: BrandPlayerCommand,
  opts: { sessionId?: string | null; playerInstanceId?: string | null; note?: string } = {},
): Promise<RequestRecoveryResult> {
  const { data, error } = await supabase.rpc('request_store_recovery', {
    p_store_user_id: storeUserId,
    p_command: command,
    p_target_session_id: opts.sessionId ?? null,
    p_target_player_instance_id: opts.playerInstanceId ?? null,
    p_note: opts.note ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? { success: false }) as RequestRecoveryResult;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* 0520 — Realtime 명령 배달 (heartbeat 는 fallback 으로 그대로 남는다)         */
/* ────────────────────────────────────────────────────────────────────────── */

export interface RecoveryCommandSubscription {
  channel: RealtimeChannel;
  unsubscribe: () => void;
}

/**
 * 이 매장으로 들어오는 복구 명령을 즉시 받는다.
 *
 * • 구독 범위는 `store_user_id = 내 uid` 로 서버에서 제한된다(필터 + RLS 이중).
 *   필터를 지우면 남의 매장 row 가 흘러올 수 있으므로 절대 넓히지 않는다.
 * • INSERT 만 본다. UPDATE 를 구독하면 우리 자신의 ACK 가 메아리로 돌아와
 *   같은 명령을 다시 판정하게 되고, 리로드 직후에는 그것이 재실행 위험이 된다.
 *   배달 신호는 INSERT 하나로 충분하다.
 * • **control-plane 전용이다.** 구독이 실패해도 호출자는 아무것도 멈추지 않는다 —
 *   heartbeat fallback 이 그대로 돈다.
 */
export function subscribeStoreRecoveryCommands(
  storeUserId: string,
  onCommand: (row: Record<string, unknown>) => void,
  onStatus?: (status: string) => void,
): RecoveryCommandSubscription {
  const channel = supabase
    .channel(`brand-player-recovery-${storeUserId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'brand_player_commands',
        filter: `store_user_id=eq.${storeUserId}`,
      },
      (payload) => {
        try { onCommand((payload.new ?? {}) as Record<string, unknown>); }
        catch { /* 수신 처리 실패가 재생을 건드리면 안 된다 */ }
      },
    )
    .subscribe((status) => {
      try { onStatus?.(status); } catch { /* noop */ }
    });

  return {
    channel,
    unsubscribe: () => {
      try { void supabase.removeChannel(channel); } catch { /* noop */ }
    },
  };
}
