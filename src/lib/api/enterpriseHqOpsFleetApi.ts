/**
 * enterpriseHqOpsFleetApi — ENTERPRISE-HQ-OPS-1
 *
 * 본사(HQ) Franchise Operations Center RPC wrapper.
 *   - get_my_enterprise_ops_fleet         → 통합 KPI + 매장 목록
 *   - get_my_enterprise_ops_store_detail  → 매장 상세
 *
 * 보안: RPC 내부에서 HQ scope(_hq_current_enterprise_account_id) + 소유(_hq_owns_store) 강제.
 * SQL: supabase/migrations/0457_hq_ops_fleet_center.sql
 */
import { supabase } from '@/lib/supabase';
import {
  normalizeOperationalStatus,
  normalizeHeartbeatState,
  type StoreOperationalStatus,
  type HeartbeatState,
} from '@/lib/hqOpsFleet';

// =============================================================================
// Types
// =============================================================================

export interface HqFleetKpi {
  total_stores: number;
  normal_stores: number;
  warning_stores: number;
  offline_stores: number;
  incident_stores: number;
  update_required_stores: number;
  unpaid_stores: number;
  contract_expiring_stores: number;
}

export interface HqFleetBilling {
  scope: 'enterprise';
  unpaid_invoice_count: number;
  is_overdue: boolean;
}

export interface HqFleetContract {
  scope: 'enterprise';
  contract_no: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  days_to_end: number | null;
  is_expiring: boolean;
}

export interface HqFleetRow {
  store_id: string;
  store_name: string;
  business_category: string | null;
  franchise_id: string | null;
  franchise_name: string | null;
  enterprise_region_id: string | null;
  enterprise_region_name: string | null;
  enterprise_region_code: string | null;
  fs_status: string | null;
  is_active: boolean;
  last_seen_at: string | null;
  last_heartbeat_at: string | null;
  heartbeat_state: HeartbeatState;
  player_status: string | null;
  current_track_id: string | null;
  current_track_title: string | null;
  current_track_artist: string | null;
  app_version: string | null;
  device_model: string | null;
  device_os: string | null;
  device_identifier: string | null;
  connection_type: string | null;
  playback_error: string | null;
  health_score: number | null;
  active_alert_count: number;
  is_online: boolean;
  is_offline_24h: boolean;
  has_playback_error: boolean;
  has_update_required: boolean;
  has_policy_outdated: boolean;
  operational: StoreOperationalStatus;
}

export interface HqFleetResult {
  success: boolean;
  kpi: HqFleetKpi;
  billing: HqFleetBilling;
  contract: HqFleetContract | null;
  data: HqFleetRow[];
  pagination: { total: number; limit: number; offset: number; has_more: boolean };
  computed_at: string;
}

export type HqFleetStatusFilter =
  | 'normal'
  | 'warning'
  | 'offline'
  | 'unpaid'
  | 'overdue'
  | 'contract_expiring'
  | 'update_required'
  | 'incident';

export interface HqFleetInput {
  search?: string | null;
  status?: HqFleetStatusFilter | null;
  franchise_id?: string | null;
  enterprise_region_id?: string | null;
  business_category?: string | null;
  sort?: 'status' | 'name' | 'health';
  limit?: number;
  offset?: number;
}

// 상세
export interface HqStoreDetailOverview {
  store_name: string;
  business_category: string | null;
  franchise_name: string | null;
  enterprise_region_id: string | null;
  is_active: boolean;
  fs_status: string | null;
  joined_at: string | null;
  operational: StoreOperationalStatus;
}

export interface HqStoreDetailPlayback {
  current_track_id: string | null;
  current_track_title: string | null;
  current_track_artist: string | null;
  started_at: string | null;
  elapsed_seconds: number | null;
  remaining_seconds: number | null;
  player_status: string | null;
  last_seen_at: string | null;
  last_heartbeat_at: string | null;
  heartbeat_state: HeartbeatState;
  playback_error: string | null;
}

export interface HqStoreDetailHealth {
  score: number | null;
  breakdown: Record<string, number>;
  heartbeat_state: HeartbeatState;
  last_heartbeat_at: string | null;
  active_alert_count: number;
  has_policy_outdated: boolean;
  has_volume_error: boolean;
}

export interface HqStoreDetailBilling {
  scope: 'enterprise';
  unpaid_invoice_count: number;
  is_overdue: boolean;
  current_invoice: {
    billing_month: string;
    status: string;
    total_amount: number;
    due_date: string | null;
    active_store_count: number;
  } | null;
  contract: {
    contract_no: string;
    status: string;
    start_date: string | null;
    end_date: string | null;
    days_to_end: number | null;
    is_expiring: boolean;
  } | null;
  settlement: {
    settlement_month: string;
    status: string;
    total_commission: number;
    carryover_amount: number;
  } | null;
}

export interface HqStoreDetailDevice {
  app_version: string | null;
  last_player_version: string | null;
  device_model: string | null;
  device_os: string | null;
  device_identifier: string | null;
  connection_type: string | null;
  wifi_ssid: string | null;
  has_update_required: boolean;
  last_heartbeat_at: string | null;
}

export interface HqStoreDetail {
  success: boolean;
  store_id: string;
  overview: HqStoreDetailOverview;
  playback: HqStoreDetailPlayback;
  health: HqStoreDetailHealth;
  billing: HqStoreDetailBilling;
  device: HqStoreDetailDevice;
  computed_at: string;
}

// =============================================================================
// RPC wrappers
// =============================================================================

export async function getMyEnterpriseOpsFleet(input: HqFleetInput = {}): Promise<HqFleetResult> {
  const { data, error } = await supabase.rpc('get_my_enterprise_ops_fleet', {
    p_search: input.search ?? null,
    p_status: input.status ?? null,
    p_franchise_id: input.franchise_id ?? null,
    p_enterprise_region_id: input.enterprise_region_id ?? null,
    p_business_category: input.business_category ?? null,
    p_sort: input.sort ?? 'status',
    p_limit: input.limit ?? 50,
    p_offset: input.offset ?? 0,
  });
  if (error) {
    console.error('[hq-ops-fleet] list failed', error);
    throw new Error(error.message || '가맹점 운영 목록을 불러올 수 없습니다.');
  }
  const raw = data as HqFleetResult;
  // 서버가 준 operational/heartbeat_state 를 정규화 (재계산 아님, 안전 폴백)
  const rows = (raw.data ?? []).map((r) => ({
    ...r,
    heartbeat_state: normalizeHeartbeatState(r.heartbeat_state),
    operational: normalizeOperationalStatus(r.operational),
  }));
  return { ...raw, data: rows };
}

export async function getMyEnterpriseOpsStoreDetail(storeId: string): Promise<HqStoreDetail> {
  const { data, error } = await supabase.rpc('get_my_enterprise_ops_store_detail', {
    p_store_id: storeId,
  });
  if (error) {
    console.error('[hq-ops-fleet] detail failed', error);
    throw new Error(error.message || '매장 상세를 불러올 수 없습니다.');
  }
  const raw = data as HqStoreDetail;
  return {
    ...raw,
    overview: {
      ...raw.overview,
      operational: normalizeOperationalStatus(raw.overview?.operational),
    },
    playback: {
      ...raw.playback,
      heartbeat_state: normalizeHeartbeatState(raw.playback?.heartbeat_state),
    },
    health: {
      ...raw.health,
      heartbeat_state: normalizeHeartbeatState(raw.health?.heartbeat_state),
    },
  };
}
