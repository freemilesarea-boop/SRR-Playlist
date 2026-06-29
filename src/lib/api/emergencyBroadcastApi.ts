/**
 * emergencyBroadcastApi — Emergency Broadcast V1 (Priority 7).
 *
 * SQL: supabase/migrations/0384_emergency_broadcast_v1.sql
 * 음원: enterprise_announcement_assets (0381) 재사용.
 */
import { supabase } from '@/lib/supabase';

export type EmergencyBroadcastStatus = 'draft' | 'active' | 'completed' | 'cancelled' | 'failed';
export type EmergencyScopeType = 'all' | 'enterprise' | 'region' | 'store';
export type EmergencyInterruptMode = 'fade_out' | 'pause' | 'after_current_track';
export type EmergencyTargetStatus = 'pending' | 'playing' | 'played' | 'failed' | 'skipped' | 'expired';

export interface EmergencyBroadcast {
  id: string;
  enterprise_account_id: string | null;
  enterprise_name: string | null;
  asset_id: string;
  asset_title: string;
  asset_duration: number | null;
  title: string;
  message: string | null;
  scope_type: EmergencyScopeType;
  region_id: string | null;
  region_name: string | null;
  region_code: string | null;
  scope_store_ids: string[] | null;
  priority: number;
  status: EmergencyBroadcastStatus;
  interrupt_mode: EmergencyInterruptMode;
  starts_at: string;
  expires_at: string | null;
  activated_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  target_store_count: number;
  played_count: number;
  failed_count: number;
  skipped_count: number;
  pending_count: number;
  memo: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmergencyBroadcastTarget {
  id: string;
  broadcast_id: string;
  store_id: string;
  enterprise_account_id: string | null;
  region_id: string | null;
  region_name: string | null;
  status: EmergencyTargetStatus;
  first_seen_at: string | null;
  started_at: string | null;
  played_at: string | null;
  failed_at: string | null;
  error_message: string | null;
  attempt_count: number;
  device_info: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface EmergencyBroadcastDetail {
  success: boolean;
  broadcast: EmergencyBroadcast;
  asset: {
    id: string; title: string; file_url: string;
    mime_type: string | null; duration_seconds: number | null; file_size_bytes: number | null;
  };
  summary: {
    total: number; pending: number; playing: number; played: number;
    failed: number; skipped: number; expired: number;
  };
  targets: EmergencyBroadcastTarget[];
  computed_at: string;
}

export interface EmergencyBroadcastKpi {
  active_broadcasts: number;
  completed_today: number;
  failed_broadcasts: number;
  cancelled_broadcasts: number;
  pending_targets: number;
  played_targets_today: number;
  failed_targets_today: number;
  computed_at: string;
}

export interface EmergencyBroadcastListParams {
  search?: string | null;
  status?: EmergencyBroadcastStatus | null;
  enterpriseAccountId?: string | null;
  scopeType?: EmergencyScopeType | null;
  activeOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface EmergencyBroadcastListResponse {
  success: boolean;
  data: EmergencyBroadcast[];
  pagination: { total: number; limit: number; offset: number; has_more: boolean };
  computed_at: string;
}

export interface EmergencyBroadcastCreateInput {
  assetId: string;
  title: string;
  scopeType: EmergencyScopeType;
  message?: string | null;
  enterpriseAccountId?: string | null;
  regionId?: string | null;
  scopeStoreIds?: string[] | null;
  priority?: number;
  interruptMode?: EmergencyInterruptMode;
  expiresAt?: string | null;
  memo?: string | null;
}

// Store player overlay 가 호출
export interface ActiveBroadcastPayload {
  broadcast_id: string;
  asset_id: string;
  title: string;
  message: string | null;
  asset_title: string;
  file_url: string;
  mime_type: string | null;
  duration_seconds: number | null;
  interrupt_mode: EmergencyInterruptMode;
  priority: number;
  expires_at: string | null;
  attempt_count: number;
}

// =============================================================================
// Admin RPCs
// =============================================================================

export async function listEmergencyBroadcasts(
  params: EmergencyBroadcastListParams = {},
): Promise<EmergencyBroadcastListResponse> {
  const { data, error } = await supabase.rpc('admin_list_emergency_broadcasts', {
    p_search:                params.search ?? null,
    p_status:                params.status ?? null,
    p_enterprise_account_id: params.enterpriseAccountId ?? null,
    p_scope_type:            params.scopeType ?? null,
    p_active_only:           params.activeOnly ?? false,
    p_limit:                 params.limit ?? 50,
    p_offset:                params.offset ?? 0,
  });
  if (error) { console.error('[emergencyApi] list failed', error); throw error; }
  return data as EmergencyBroadcastListResponse;
}

export async function getEmergencyBroadcastDetail(id: string): Promise<EmergencyBroadcastDetail> {
  const { data, error } = await supabase.rpc('admin_get_emergency_broadcast_detail', { p_id: id });
  if (error) { console.error('[emergencyApi] detail failed', error); throw error; }
  return data as EmergencyBroadcastDetail;
}

export async function createEmergencyBroadcast(
  input: EmergencyBroadcastCreateInput,
): Promise<{ success: boolean; broadcast_id: string; target_store_count: number }> {
  const { data, error } = await supabase.rpc('admin_create_emergency_broadcast', {
    p_asset_id:              input.assetId,
    p_title:                 input.title,
    p_scope_type:            input.scopeType,
    p_message:               input.message ?? null,
    p_enterprise_account_id: input.enterpriseAccountId ?? null,
    p_region_id:             input.regionId ?? null,
    p_scope_store_ids:       input.scopeStoreIds ?? null,
    p_priority:              input.priority ?? 100,
    p_interrupt_mode:        input.interruptMode ?? 'fade_out',
    p_expires_at:            input.expiresAt ?? null,
    p_memo:                  input.memo ?? null,
  });
  if (error) { console.error('[emergencyApi] create failed', error); throw error; }
  return data as { success: boolean; broadcast_id: string; target_store_count: number };
}

export async function activateEmergencyBroadcast(
  id: string,
): Promise<{ success: boolean; broadcast_id: string; status: EmergencyBroadcastStatus }> {
  const { data, error } = await supabase.rpc('admin_activate_emergency_broadcast', { p_id: id });
  if (error) { console.error('[emergencyApi] activate failed', error); throw error; }
  return data as { success: boolean; broadcast_id: string; status: EmergencyBroadcastStatus };
}

export async function cancelEmergencyBroadcast(
  id: string, memo?: string | null,
): Promise<{ success: boolean; broadcast_id: string; status: EmergencyBroadcastStatus; previous_status: EmergencyBroadcastStatus }> {
  const { data, error } = await supabase.rpc('admin_cancel_emergency_broadcast', { p_id: id, p_memo: memo ?? null });
  if (error) { console.error('[emergencyApi] cancel failed', error); throw error; }
  return data as { success: boolean; broadcast_id: string; status: EmergencyBroadcastStatus; previous_status: EmergencyBroadcastStatus };
}

export async function completeEmergencyBroadcast(
  id: string,
): Promise<{ success: boolean; broadcast_id: string; status: EmergencyBroadcastStatus }> {
  const { data, error } = await supabase.rpc('admin_complete_emergency_broadcast', { p_id: id });
  if (error) { console.error('[emergencyApi] complete failed', error); throw error; }
  return data as { success: boolean; broadcast_id: string; status: EmergencyBroadcastStatus };
}

export async function getEmergencyBroadcastKpi(): Promise<EmergencyBroadcastKpi> {
  const { data, error } = await supabase.rpc('admin_emergency_broadcast_kpi');
  if (error) { console.error('[emergencyApi] kpi failed', error); throw error; }
  return data as EmergencyBroadcastKpi;
}

// =============================================================================
// Store RPCs (player overlay)
// =============================================================================

export async function getActiveEmergencyBroadcast(
  storeId?: string | null,
  deviceInfo: Record<string, unknown> = {},
): Promise<{ success: boolean; store_id: string; now_at: string; broadcast: ActiveBroadcastPayload | null }> {
  const { data, error } = await supabase.rpc('store_get_active_emergency_broadcasts', {
    p_store_id: storeId ?? null,
    p_device_info: deviceInfo,
  });
  if (error) { console.error('[emergencyApi] store get failed', error); throw error; }
  return data as { success: boolean; store_id: string; now_at: string; broadcast: ActiveBroadcastPayload | null };
}

export async function markEmergencyBroadcastStatus(
  broadcastId: string,
  status: 'playing' | 'played' | 'failed' | 'skipped',
  errorMessage?: string | null,
  deviceInfo: Record<string, unknown> = {},
): Promise<{ success: boolean; broadcast_id: string; store_id: string; status: typeof status }> {
  const { data, error } = await supabase.rpc('store_mark_emergency_broadcast_status', {
    p_broadcast_id:  broadcastId,
    p_status:        status,
    p_error_message: errorMessage ?? null,
    p_device_info:   deviceInfo,
  });
  if (error) { console.error('[emergencyApi] mark status failed', error); throw error; }
  return data as { success: boolean; broadcast_id: string; store_id: string; status: typeof status };
}
