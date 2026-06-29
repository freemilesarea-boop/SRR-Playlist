/**
 * nocApi — Enterprise Network Operations Center V1 (Phase 8).
 * SQL: supabase/migrations/0385_enterprise_noc_v1.sql
 */
import { supabase } from '@/lib/supabase';

export type NocSeverity = 'critical' | 'major' | 'minor' | 'info';
export type NocChannelType = 'slack' | 'discord' | 'email' | 'webhook';

export interface NocKpi {
  total_stores: number;
  online_stores: number;
  offline_stores: number;
  emergency_active: number;
  announcement_active: number;
  policy_active: number;
  policy_failed: number;
  idle_24h: number;
  heartbeat_errors: number;
  player_errors: number;
  today_incidents: number;
  today_recovered: number;
  computed_at: string;
}

export interface NocRegionRow {
  region_name: string;
  region_code: string;
  total: number;
  online: number;
  offline: number;
  errors: number;
  warnings: number;
}

export interface NocAlert {
  severity: NocSeverity;
  category: string;
  message: string;
  store_id: string;
  store_name: string | null;
  franchise_name: string | null;
  region_name: string | null;
  ref_id: string | null;
  event_at: string | null;
  error_message: string | null;
}

export interface NocRecentEvent {
  id: string;
  source: string;
  category: string;
  level: 'info' | 'success' | 'warning' | 'error';
  status: string;
  message: string;
  details: Record<string, unknown>;
  related_id: string | null;
  created_at: string;
  severity: NocSeverity;
}

export interface NocStoreHealth {
  store_id: string;
  store_name: string | null;
  franchise_id: string | null;
  franchise_name: string | null;
  region_name: string | null;
  is_online: boolean;
  player_status: string | null;
  last_heartbeat_at: string | null;
  score: number;
  breakdown: Record<string, number>;
  health_tone: 'green' | 'yellow' | 'orange' | 'red';
}

export interface NocStoreDetail {
  success: boolean;
  store_id: string;
  now_playing: Record<string, unknown> | null;
  sync_status: Record<string, unknown> | null;
  health: { score: number; breakdown: Record<string, number> };
  recent_emergency: Array<Record<string, unknown>>;
  recent_announcement: Array<Record<string, unknown>>;
  recent_policy: Array<Record<string, unknown>>;
  recent_logs: Array<Record<string, unknown>>;
  computed_at: string;
}

export interface NocNotificationChannel {
  id: string;
  name: string;
  channel_type: NocChannelType;
  config: Record<string, unknown>;
  enabled: boolean;
  severity_filter: NocSeverity | 'all';
  created_at: string;
  updated_at: string;
}

// =============================================================================
// Wrappers
// =============================================================================

export async function getNocKpi(): Promise<NocKpi> {
  const { data, error } = await supabase.rpc('admin_noc_kpi');
  if (error) { console.error('[nocApi] kpi failed', error); throw error; }
  return data as NocKpi;
}

export async function getNocRegionSummary(): Promise<NocRegionRow[]> {
  const { data, error } = await supabase.rpc('admin_noc_region_summary');
  if (error) { console.error('[nocApi] region summary failed', error); throw error; }
  return ((data as { data: NocRegionRow[] }).data) ?? [];
}

export async function getNocActiveAlerts(limit = 50, severity?: NocSeverity | null): Promise<NocAlert[]> {
  const { data, error } = await supabase.rpc('admin_noc_active_alerts', {
    p_limit: limit, p_severity: severity ?? null,
  });
  if (error) { console.error('[nocApi] alerts failed', error); throw error; }
  return ((data as { data: NocAlert[] }).data) ?? [];
}

export async function getNocRecentEvents(limit = 100, source?: string | null): Promise<NocRecentEvent[]> {
  const { data, error } = await supabase.rpc('admin_noc_recent_events', {
    p_limit: limit, p_source: source ?? null,
  });
  if (error) { console.error('[nocApi] recent events failed', error); throw error; }
  return ((data as { data: NocRecentEvent[] }).data) ?? [];
}

export async function getNocStoreHealthList(opts: {
  limit?: number; minScore?: number | null; maxScore?: number | null; franchiseId?: string | null;
} = {}): Promise<NocStoreHealth[]> {
  const { data, error } = await supabase.rpc('admin_noc_store_health_list', {
    p_limit:        opts.limit ?? 100,
    p_min_score:    opts.minScore ?? null,
    p_max_score:    opts.maxScore ?? null,
    p_franchise_id: opts.franchiseId ?? null,
  });
  if (error) { console.error('[nocApi] store health list failed', error); throw error; }
  return ((data as { data: NocStoreHealth[] }).data) ?? [];
}

export async function getNocStoreDetail(storeId: string): Promise<NocStoreDetail> {
  const { data, error } = await supabase.rpc('admin_noc_store_detail', { p_store_id: storeId });
  if (error) { console.error('[nocApi] store detail failed', error); throw error; }
  return data as NocStoreDetail;
}

export async function getNocSettings(): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('admin_noc_get_settings');
  if (error) { console.error('[nocApi] get settings failed', error); throw error; }
  return ((data as { settings: Record<string, unknown> }).settings) ?? {};
}

export async function setNocSetting(key: string, value: unknown): Promise<void> {
  const { error } = await supabase.rpc('admin_noc_set_setting', { p_key: key, p_value: value });
  if (error) { console.error('[nocApi] set setting failed', error); throw error; }
}

export async function listNotificationChannels(): Promise<NocNotificationChannel[]> {
  const { data, error } = await supabase.rpc('admin_noc_list_notification_channels');
  if (error) { console.error('[nocApi] list channels failed', error); throw error; }
  return ((data as { data: NocNotificationChannel[] }).data) ?? [];
}

export async function upsertNotificationChannel(input: {
  id?: string | null;
  name: string;
  channelType: NocChannelType;
  config?: Record<string, unknown>;
  enabled?: boolean;
  severityFilter?: NocSeverity | 'all';
}): Promise<{ success: boolean; channel_id: string }> {
  const { data, error } = await supabase.rpc('admin_noc_upsert_notification_channel', {
    p_id:              input.id ?? null,
    p_name:            input.name,
    p_channel_type:    input.channelType,
    p_config:          input.config ?? {},
    p_enabled:         input.enabled ?? true,
    p_severity_filter: input.severityFilter ?? 'critical',
  });
  if (error) { console.error('[nocApi] upsert channel failed', error); throw error; }
  return data as { success: boolean; channel_id: string };
}

export async function deleteNotificationChannel(id: string): Promise<void> {
  const { error } = await supabase.rpc('admin_noc_delete_notification_channel', { p_id: id });
  if (error) { console.error('[nocApi] delete channel failed', error); throw error; }
}
