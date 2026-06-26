/**
 * storeMonitoringApi — Enterprise Phase 1-3.
 *
 * 매장 운영 관제: heartbeat + KPI + 목록 + 매장 ↔ 지역 매핑 + 강제 재동기화.
 *
 * 기존 store_policy_sync_status (X6.89) 확장 — 중복 인프라 만들지 않음.
 *
 * SQL: supabase/migrations/0353_store_monitoring.sql
 */
import { supabase } from '@/lib/supabase';

export type StorePlayerStatus = 'playing' | 'paused' | 'stopped' | 'offline' | 'unknown';

/** UI 표시용 상태 (계산식 기반). 매장은 여러 issue 동시 가능 → 우선순위로 1개 노출. */
export type StoreMonitoringStatusFilter =
  | 'online' | 'idle_1h' | 'idle_24h' | 'offline'
  | 'policy_outdated' | 'playback_error' | 'volume_error'
  | 'device_missing' | 'update_required';

export interface StoreMonitoringRow {
  // sync_status base
  id: string;
  store_id: string;
  franchise_id: string | null;
  enterprise_region_id: string | null;
  active_policy_id: string | null;
  active_version_number: number;
  last_synced_at: string | null;
  last_seen_at: string | null;
  current_track_id: string | null;
  player_status: StorePlayerStatus;
  // Phase 1-3 신규 컬럼
  last_policy_sync_at: string | null;
  last_player_version: string | null;
  device_model: string | null;
  device_os: string | null;
  battery_level: number | null;
  volume: number | null;
  current_track_started_at: string | null;
  playback_error: string | null;
  connection_type: string | null;
  wifi_ssid: string | null;
  app_version: string | null;
  device_identifier: string | null;
  created_at: string;
  updated_at: string;
  // 계산 flag (store_monitoring_status view)
  is_online: boolean;
  is_idle_5m_to_1h: boolean;
  is_idle_1h_to_24h: boolean;
  is_offline_24h: boolean;
  has_policy_outdated: boolean;
  has_playback_error: boolean;
  has_volume_error: boolean;
  has_device_missing: boolean;
  has_update_required: boolean;
  // joined
  store_name: string;
  store_email: string | null;
  franchise_name: string | null;
  enterprise_region_name: string | null;
  enterprise_region_code: string | null;
  current_track_title: string | null;
  current_track_artist: string | null;
}

export interface StoreMonitoringKpi {
  total: number;
  online: number;
  idle_1h: number;
  idle_24h: number;
  offline: number;
  policy_outdated: number;
  playback_errors: number;
  volume_errors: number;
  device_missing: number;
  update_required: number;
  computed_at: string;
  thresholds: {
    online_seconds: number;
    idle_1h_seconds: number;
    offline_seconds: number;
    policy_outdated_seconds: number;
  };
}

export interface StoreMonitoringListParams {
  search?: string | null;
  status?: StoreMonitoringStatusFilter | null;
  franchiseId?: string | null;
  enterpriseRegionId?: string | null;
  sort?: 'last_seen' | 'name' | 'status';
  limit?: number;
  offset?: number;
}

export interface StoreMonitoringListResponse {
  success: boolean;
  data: StoreMonitoringRow[];
  pagination: { total: number; limit: number; offset: number; has_more: boolean };
}

export interface StoreHeartbeatInput {
  storeId?: string | null;             // null = 본인
  appVersion?: string | null;
  batteryLevel?: number | null;
  volume?: number | null;
  currentTrackId?: string | null;
  currentTrackStartedAt?: string | null;
  deviceModel?: string | null;
  deviceOs?: string | null;
  wifiSsid?: string | null;
  connectionType?: string | null;
  playerStatus?: StorePlayerStatus;
  playbackError?: string | null;
  deviceIdentifier?: string | null;
}

// =============================================================================
// Heartbeat (모든 business 사용자 — Phase 1-1/1-2 무관)
// =============================================================================

export async function storeHeartbeat(input: StoreHeartbeatInput): Promise<void> {
  const { error } = await supabase.rpc('store_heartbeat', {
    p_store_id: input.storeId ?? null,
    p_app_version: input.appVersion ?? null,
    p_battery_level: input.batteryLevel ?? null,
    p_volume: input.volume ?? null,
    p_current_track_id: input.currentTrackId ?? null,
    p_current_track_started_at: input.currentTrackStartedAt ?? null,
    p_device_model: input.deviceModel ?? null,
    p_device_os: input.deviceOs ?? null,
    p_wifi_ssid: input.wifiSsid ?? null,
    p_connection_type: input.connectionType ?? null,
    p_player_status: input.playerStatus ?? 'unknown',
    p_playback_error: input.playbackError ?? null,
    p_device_identifier: input.deviceIdentifier ?? null,
  });
  if (error) {
    // heartbeat 실패는 silent — 재생을 막지 않음. 단, console.warn 으로 디버깅 가능.
    console.warn('[storeMonitoringApi] heartbeat failed', error, {
      storeId: input.storeId, status: input.playerStatus, trackId: input.currentTrackId,
    });
  } else if (import.meta.env.DEV) {
    // DEV 모드에서만 성공 로그 (운영 환경 콘솔 소음 차단)
    console.info('[storeMonitoringApi] heartbeat ok', {
      storeId: input.storeId, status: input.playerStatus, trackId: input.currentTrackId,
    });
  }
}

// =============================================================================
// Admin
// =============================================================================

export async function adminStoreMonitoringKpi(): Promise<StoreMonitoringKpi> {
  const { data, error } = await supabase.rpc('admin_store_monitoring_kpi');
  if (error) { console.error('[storeMonitoringApi] kpi failed', error); throw error; }
  return data as StoreMonitoringKpi;
}

export async function adminListStoreMonitoring(
  params: StoreMonitoringListParams = {},
): Promise<StoreMonitoringListResponse> {
  const { data, error } = await supabase.rpc('admin_list_store_monitoring', {
    p_search: params.search ?? null,
    p_status: params.status ?? null,
    p_franchise_id: params.franchiseId ?? null,
    p_enterprise_region_id: params.enterpriseRegionId ?? null,
    p_sort: params.sort ?? 'last_seen',
    p_limit: params.limit ?? 50,
    p_offset: params.offset ?? 0,
  });
  if (error) { console.error('[storeMonitoringApi] list failed', error); throw error; }
  return data as StoreMonitoringListResponse;
}

export async function adminAssignStoreToEnterpriseRegion(
  storeId: string, enterpriseRegionId: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('admin_assign_store_to_enterprise_region', {
    p_store_id: storeId, p_enterprise_region_id: enterpriseRegionId,
  });
  if (error) { console.error('[storeMonitoringApi] assign_region failed', error); throw error; }
}

export async function adminForceStoreResync(storeId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_force_store_resync', { p_store_id: storeId });
  if (error) { console.error('[storeMonitoringApi] force_resync failed', error); throw error; }
}
