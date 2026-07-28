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

/** BRAND-HQ-RUNTIME-TRUTH-1 — 실제 Brand Player Binding(brand_accounts). Runtime 준비 상태의 유일 근거. */
export interface EntDetailPlayerBinding {
  brand_account_id: string | null;
  brand_account_name: string | null;
  brand_account_status: string | null;
  brand_account_deleted_at: string | null;
  enterprise_account_id: string | null;
  /** verify_store_code 와 동일 조건: status='active' AND deleted_at IS NULL. */
  is_active_binding: boolean;
  /** 이 본사에 연결된 brand_accounts 행 수(>1 이면 이상 상태 경고). */
  binding_count: number;
}

export interface EnterpriseDetail {
  enterprise: EntDetailEnterprise;
  /** 실제 Player Binding. 구버전 RPC 호환 위해 optional. */
  player_binding?: EntDetailPlayerBinding | null;
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
