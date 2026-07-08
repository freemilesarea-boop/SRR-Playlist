// Phase ENT-DETAIL-1 — 관리자 본사 상세 집계 RPC 래퍼.
// 0406 admin_get_enterprise_detail (조회 전용, _is_super_admin 게이트).
import { supabase } from '@/lib/supabase';

export interface EntDetailEnterprise {
  id: string;
  enterprise_name: string;
  manager_name: string | null;
  manager_email: string | null;
  manager_phone: string | null;
  role: string | null;
  status: string;
  last_login_at: string | null;
  auth_user_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
  onboarding_enabled: boolean | null;
  allow_self_register_region: boolean | null;
  auto_onboarded: boolean | null;
  brand_registry_id: string | null;
}

export interface EntDetailBusinessProfile {
  company_name: string | null;
  business_number: string | null;
  representative_name: string | null;
  business_address: string | null;
  contact_phone: string | null;
  tax_invoice_email: string | null;
  settlement_contact_name: string | null;
  settlement_contact_phone: string | null;
  settlement_contact_email: string | null;
}

export interface EntDetailInviteClaim {
  claim_type: string | null;
  status: string | null;
  invite_code_last4: string | null;
  user_id: string | null;
  store_name_input: string | null;
  region_name_input: string | null;
  brand_name_input: string | null;
  failure_reason: string | null;
  created_at: string;
}

export interface EntDetailInvite {
  hq_invite_code: string | null;
  store_invite_code: string | null;
  brand_code: string | null;
  invite_code_rotated_at: string | null;
  claims: EntDetailInviteClaim[];
}

export interface EntDetailRegion {
  id: string;
  region_name: string | null;
  region_code: string | null;
  status: string | null;
  store_count: number | null;
  manager_name: string | null;
  last_policy_applied_at: string | null;
}

export interface EntDetailStoreSummary {
  total: number;
  active: number;
  inactive: number;
  heartbeat_recent: number;
  playing: number;
  connected_24h: number;
  offline_or_error: number;
}

export interface EntDetailStore {
  store_id: string;
  store_name: string | null;
  store_status: string | null;
  region_id: string | null;
  region_name: string | null;
  player_status: string | null;
  last_seen_at: string | null;
  last_synced_at: string | null;
  last_policy_sync_at: string | null;
  active_policy_id: string | null;
  active_version_number: number | null;
  current_track_id: string | null;
  current_track_title: string | null;
  current_track_artist: string | null;
  current_track_started_at: string | null;
  device_model: string | null;
  device_os: string | null;
  app_version: string | null;
  connection_type: string | null;
  volume: number | null;
  playback_error: string | null;
  business_category: string | null;
  store_owner_nickname: string | null;
  joined_at: string | null;
}

export interface EntDetailContract {
  id: string;
  contract_no: string | null;
  contract_name: string | null;
  contract_type: string | null;
  start_date: string | null;
  end_date: string | null;
  auto_renew: boolean | null;
  renewal_period_month: number | null;
  status: string | null;
  monthly_store_price: number | null;
  commission_rate: number | null;
  minimum_payout: number | null;
  settlement_method: string | null;
  signed_at: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface EntDetailSettlement {
  id: string;
  settlement_month: string | null;
  status: string | null;
  active_store_count: number | null;
  monthly_store_price: number | null;
  commission_rate: number | null;
  per_store_commission: number | null;
  total_commission: number | null;
  minimum_payout: number | null;
  below_minimum: boolean | null;
  settlement_method: string | null;
  contract_no: string | null;
  generated_at: string | null;
  approved_at: string | null;
  paid_at: string | null;
  payment_reference: string | null;
}

export interface EntDetailMusicPolicy {
  id: string;
  franchise_id: string | null;
  name: string | null;
  description: string | null;
  status: string | null;
  is_default: boolean | null;
  effective_from: string | null;
  effective_until: string | null;
  source_type: string | null;
  source_playlist_id: string | null;
  track_count_snapshot: number | null;
  latest_version: number | null;
}

export interface EntDetailAuditLog {
  created_at: string;
  source: string | null;
  category: string | null;
  level: string | null;
  status: string | null;
  message: string | null;
  actor: string | null;
  related_id: string | null;
  error_code: string | null;
}

export interface EnterpriseDetail {
  enterprise: EntDetailEnterprise;
  business_profile: EntDetailBusinessProfile | null;
  invite: EntDetailInvite;
  regions: EntDetailRegion[];
  store_summary: EntDetailStoreSummary;
  stores: EntDetailStore[];
  contract: EntDetailContract | null;
  contracts: Array<Pick<EntDetailContract, 'id' | 'contract_no' | 'contract_name' | 'status' | 'start_date' | 'end_date' | 'monthly_store_price' | 'commission_rate' | 'settlement_method' | 'auto_renew'>>;
  settlements: EntDetailSettlement[];
  music_policy: EntDetailMusicPolicy[];
  audit_logs: EntDetailAuditLog[];
}

/** 관리자 전용 본사 상세 집계. */
export async function adminGetEnterpriseDetail(enterpriseId: string): Promise<EnterpriseDetail> {
  const { data, error } = await supabase.rpc('admin_get_enterprise_detail', { p_enterprise_id: enterpriseId });
  if (error) {
    console.error('[enterpriseDetailApi] admin_get_enterprise_detail failed', error);
    throw error;
  }
  return data as EnterpriseDetail;
}

// ── Phase ENT-OS-1 — Enterprise OS 통합 조회 (0408) ───────────────────
// 본사 1곳 = 브랜드/이미지/플레이어 세션까지 한 번에. 조회 전용, super_admin.
export interface EntOsEnterprise {
  id: string;
  enterprise_name: string;
  manager_name: string | null;
  manager_email: string | null;
  manager_phone: string | null;
  role: string | null;
  status: string;
  last_login_at: string | null;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
  hq_invite_code: string | null;
  store_invite_code: string | null;
}

export interface EntOsBrand {
  id: string;
  name: string;
  enterprise_account_id: string | null;
  status: string;
  industry_type: string | null;
  description: string | null;
  created_at: string;
  updated_at: string | null;
  media_count: number;
  active_media_count: number;
  playlist_track_count: number;
  connected_store_count: number;
}

export interface EntOsBrandMusicPolicy {
  preferred_genres: string[] | null;
  blocked_genres: string[] | null;
  preferred_moods: string[] | null;
  blocked_moods: string[] | null;
  energy_min: number | null;
  energy_max: number | null;
  vocal_policy: string | null;
  auto_generate_enabled: boolean | null;
}

export interface EntOsBrandMediaAsset {
  id: string;
  asset_type: string;
  title: string | null;
  image_url: string;
  display_duration_seconds: number | null;
  sort_order: number | null;
  status: string | null;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface EntOsBrandSession {
  id: string;
  last_seen_at: string | null;
  playback_started_at: string | null;
  user_agent: string | null;
  current_track_id: string | null;
  created_at: string;
  user_id: string | null;
}

export interface EntOsBrandSessionSummary {
  total: number;
  active_recent: number;
  last_24h: number;
}

export interface EntOsMusicPolicy {
  id: string;
  name: string | null;
  status: string | null;
  is_default: boolean | null;
  source_type: string | null;
  track_count_snapshot: number | null;
  effective_from: string | null;
  latest_version: number | null;
}

export interface EnterpriseOsDetail {
  enterprise: EntOsEnterprise;
  brand: EntOsBrand | null;
  brand_music_policy: EntOsBrandMusicPolicy | null;
  brand_media_assets: EntOsBrandMediaAsset[];
  brand_player_sessions: EntOsBrandSession[];
  brand_session_summary: EntOsBrandSessionSummary;
  store_summary: EntDetailStoreSummary;
  stores: Array<Pick<EntDetailStore,
    'store_id' | 'store_name' | 'store_status' | 'region_name' | 'player_status' |
    'last_seen_at' | 'active_version_number' | 'current_track_title' | 'device_model' |
    'playback_error' | 'business_category'>>;
  enterprise_music_policy: EntOsMusicPolicy[];
  contract: EntDetailContract | null;
  settlements: EntDetailSettlement[];
  audit_logs: EntDetailAuditLog[];
}

/** 관리자 전용 본사 OS 통합 조회 (브랜드/이미지/플레이어 포함). */
export async function adminGetEnterpriseOsDetail(enterpriseId: string): Promise<EnterpriseOsDetail> {
  const { data, error } = await supabase.rpc('admin_get_enterprise_os_detail', { p_enterprise_id: enterpriseId });
  if (error) {
    console.error('[enterpriseDetailApi] admin_get_enterprise_os_detail failed', error);
    throw error;
  }
  return data as EnterpriseOsDetail;
}
