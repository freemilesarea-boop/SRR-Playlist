/**
 * enterpriseHqOpsApi — Phase 3-3
 *
 * HQ (본사) 운영 관제 화면 (/enterprise/ops) 전용 wrapper.
 * super admin admin_* RPC 는 건드리지 않고 HQ scope RPC 만 호출한다.
 *
 * SQL: supabase/migrations/0401_enterprise_hq_ops_center.sql
 */
import { supabase } from '@/lib/supabase';

// =============================================================================
// Types
// =============================================================================

/** 매장 monitoring row · store_monitoring_status view + join 결과 */
export interface HqOpsStore {
  store_id: string;
  store_name: string;
  store_email: string | null;
  franchise_id: string | null;
  franchise_name: string | null;
  enterprise_region_id: string | null;
  enterprise_region_name: string | null;
  enterprise_region_code: string | null;
  last_seen_at: string | null;
  last_policy_sync_at: string | null;
  active_policy_id: string | null;
  active_version_number: number | null;
  current_track_id: string | null;
  current_track_title: string | null;
  current_track_artist: string | null;
  device_identifier: string | null;
  device_model: string | null;
  device_os: string | null;
  app_version: string | null;
  battery_level: number | null;
  volume: number | null;
  playback_error: string | null;
  wifi_ssid: string | null;
  connection_type: string | null;
  // 계산 flag 8개 (store_monitoring_status view)
  is_online: boolean;
  is_idle_5m_to_1h: boolean;
  is_idle_1h_to_24h: boolean;
  is_offline_24h: boolean;
  has_policy_outdated: boolean;
  has_playback_error: boolean;
  has_volume_error: boolean;
  has_device_missing: boolean;
  has_update_required: boolean;
}

export interface HqOpsKpi {
  enterprise_account_id: string;
  total: number;
  online: number;
  idle_1h: number;
  idle_24h: number;
  offline: number;
  policy_outdated: number;
  playback_errors: number;
  computed_at: string;
  thresholds: {
    online_seconds: number;
    idle_1h_seconds: number;
    offline_seconds: number;
    policy_outdated_seconds: number;
  };
}

export type HqOpsStatusFilter =
  | 'online' | 'idle_1h' | 'idle_24h' | 'offline'
  | 'policy_outdated' | 'playback_error' | 'volume_error'
  | 'device_missing' | 'update_required';

export interface HqOpsStoreListInput {
  search?: string | null;
  status?: HqOpsStatusFilter | null;
  franchise_id?: string | null;
  enterprise_region_id?: string | null;
  sort?: 'status' | 'name' | 'last_seen';
  limit?: number;
  offset?: number;
}

export interface HqOpsStoreListResult {
  success: boolean;
  data: HqOpsStore[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
}

/** store_now_playing view 결과 (view 컬럼 전체는 admin now playing 것과 동일 shape) */
export interface HqOpsNowPlayingRow {
  store_id: string;
  store_name: string | null;
  franchise_name: string | null;
  enterprise_region_name: string | null;
  active_policy_id: string | null;
  active_version_number: number | null;
  current_track_id: string | null;
  current_track_title: string | null;
  current_track_artist: string | null;
  current_track_started_at: string | null;
  current_track_duration_seconds: number | null;
  elapsed_seconds: number | null;
  remaining_seconds: number | null;
  last_seen_at: string | null;
}

export interface HqOpsNowPlayingResult {
  success: boolean;
  total_playing: number;
  data: HqOpsNowPlayingRow[];
  computed_at: string;
}

export interface HqOpsAlert {
  store_id: string;
  store_name: string;
  franchise_name: string | null;
  enterprise_region_name: string | null;
  last_seen_at: string | null;
  last_policy_sync_at: string | null;
  playback_error: string | null;
  is_online: boolean;
  is_offline_24h: boolean;
  is_idle_1h_to_24h: boolean;
  has_playback_error: boolean;
  has_policy_outdated: boolean;
  has_device_missing: boolean;
  health: {
    score: number;
    breakdown: Record<string, unknown>;
  };
}

export interface HqOpsAlertsResult {
  success: boolean;
  data: HqOpsAlert[];
  computed_at: string;
}

export interface HqOpsActivityRow {
  id: string;
  created_at: string;
  source: string;
  category: string;
  level: string;
  status: string;
  message: string;
  related_id: string | null;
}

export interface HqOpsActivityFeedResult {
  success: boolean;
  data: HqOpsActivityRow[];
  computed_at: string;
}

export interface HqOpsForceResyncResult {
  success: boolean;
  store_id: string;
}

export interface HqOpsBulkForceResyncFailure {
  store_id: string;
  reason: 'not_in_scope' | 'not_in_monitoring' | 'db_error';
  error?: string;
}

export interface HqOpsBulkForceResyncResult {
  success: boolean;
  total_requested: number;
  success_count: number;
  failed_count: number;
  failures: HqOpsBulkForceResyncFailure[];
}

// =============================================================================
// RPC wrappers
// =============================================================================

export async function getMyEnterpriseOpsKpi(): Promise<HqOpsKpi> {
  const { data, error } = await supabase.rpc('get_my_enterprise_ops_kpi');
  if (error) {
    console.error('[hq-ops] kpi failed', error);
    throw new Error(error.message || '운영 KPI 를 불러올 수 없습니다.');
  }
  return data as HqOpsKpi;
}

export async function getMyEnterpriseOpsStores(
  input: HqOpsStoreListInput = {},
): Promise<HqOpsStoreListResult> {
  const { data, error } = await supabase.rpc('get_my_enterprise_ops_stores', {
    p_search: input.search ?? null,
    p_status: input.status ?? null,
    p_franchise_id: input.franchise_id ?? null,
    p_enterprise_region_id: input.enterprise_region_id ?? null,
    p_sort: input.sort ?? 'status',
    p_limit: input.limit ?? 50,
    p_offset: input.offset ?? 0,
  });
  if (error) {
    console.error('[hq-ops] stores failed', error);
    throw new Error(error.message || '매장 목록을 불러올 수 없습니다.');
  }
  return data as HqOpsStoreListResult;
}

export async function getMyEnterpriseOpsNowPlaying(
  limit = 30,
): Promise<HqOpsNowPlayingResult> {
  const { data, error } = await supabase.rpc('get_my_enterprise_ops_now_playing', {
    p_limit: limit,
  });
  if (error) {
    console.error('[hq-ops] now_playing failed', error);
    throw new Error(error.message || '재생 스냅샷을 불러올 수 없습니다.');
  }
  return data as HqOpsNowPlayingResult;
}

export async function getMyEnterpriseOpsAlerts(
  limit = 50,
): Promise<HqOpsAlertsResult> {
  const { data, error } = await supabase.rpc('get_my_enterprise_ops_alerts', {
    p_limit: limit,
  });
  if (error) {
    console.error('[hq-ops] alerts failed', error);
    throw new Error(error.message || '알림 목록을 불러올 수 없습니다.');
  }
  return data as HqOpsAlertsResult;
}

export async function getMyEnterpriseOpsActivityFeed(
  limit = 30,
): Promise<HqOpsActivityFeedResult> {
  const { data, error } = await supabase.rpc('get_my_enterprise_ops_activity_feed', {
    p_limit: limit,
  });
  if (error) {
    console.error('[hq-ops] activity_feed failed', error);
    throw new Error(error.message || '활동 로그를 불러올 수 없습니다.');
  }
  return data as HqOpsActivityFeedResult;
}

export async function hqForceStoreResync(
  storeId: string,
): Promise<HqOpsForceResyncResult> {
  const { data, error } = await supabase.rpc('hq_force_store_resync', {
    p_store_id: storeId,
  });
  if (error) {
    console.error('[hq-ops] force_resync failed', error);
    throw new Error(error.message || '강제 동기화에 실패했습니다.');
  }
  return data as HqOpsForceResyncResult;
}

/**
 * Bulk force resync — 최대 100개.
 * 100개 초과 요청은 클라이언트에서 사전에 차단 (서버도 validation error 반환).
 * 개별 실패는 전체 실패가 아니라 failures 배열로 집계.
 */
export async function hqBulkForceResync(
  storeIds: string[],
): Promise<HqOpsBulkForceResyncResult> {
  if (storeIds.length === 0) {
    throw new Error('선택된 매장이 없습니다.');
  }
  if (storeIds.length > 100) {
    throw new Error(`한번에 최대 100개까지만 강제 동기화할 수 있어요. (요청: ${storeIds.length}개)`);
  }
  const { data, error } = await supabase.rpc('hq_bulk_force_resync', {
    p_store_ids: storeIds,
  });
  if (error) {
    console.error('[hq-ops] bulk_force_resync failed', error);
    throw new Error(error.message || '일괄 강제 동기화에 실패했습니다.');
  }
  return data as HqOpsBulkForceResyncResult;
}

// =============================================================================
// UI helpers
// =============================================================================

/**
 * Store 의 대표 상태 (우선순위 기반).
 * playback_error > offline > idle_24h > policy_outdated > idle_1h > online > unknown
 */
export type HqOpsStoreState =
  | 'playback_error' | 'offline' | 'idle_24h' | 'policy_outdated'
  | 'idle_1h' | 'online' | 'unknown';

export function storeState(s: HqOpsStore): HqOpsStoreState {
  if (s.has_playback_error) return 'playback_error';
  if (s.is_offline_24h) return 'offline';
  if (s.is_idle_1h_to_24h) return 'idle_24h';
  if (s.has_policy_outdated) return 'policy_outdated';
  if (s.is_idle_5m_to_1h) return 'idle_1h';
  if (s.is_online) return 'online';
  return 'unknown';
}

export const HQ_OPS_STATE_LABEL: Record<HqOpsStoreState, string> = {
  playback_error: '재생 오류',
  offline: '오프라인',
  idle_24h: '유휴 (1h~24h)',
  policy_outdated: '정책 지연',
  idle_1h: '유휴 (5m~1h)',
  online: '온라인',
  unknown: '알 수 없음',
};

export const HQ_OPS_STATUS_FILTER_LABEL: Record<HqOpsStatusFilter, string> = {
  online: '온라인',
  idle_1h: '유휴 (5m~1h)',
  idle_24h: '유휴 (1h~24h)',
  offline: '오프라인 (24h+)',
  policy_outdated: '정책 지연',
  playback_error: '재생 오류',
  volume_error: '볼륨 이상',
  device_missing: '기기 미등록',
  update_required: '앱 업데이트 필요',
};
