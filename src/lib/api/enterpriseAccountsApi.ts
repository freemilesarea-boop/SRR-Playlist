/**
 * enterpriseAccountsApi — Enterprise Phase 1-1.
 *
 * 본사 담당자 directory. franchise_admins 와 별개 — 사용자 가입 전부터 등록 가능
 * (status='invited'). 가입 후 auth_user_id 채워지면 franchise_admins 연동 가능.
 *
 * SQL: supabase/migrations/0351_enterprise_accounts.sql
 */
import { supabase } from '@/lib/supabase';

export type EnterpriseAccountStatus = 'active' | 'invited' | 'suspended' | 'inactive';
export type EnterpriseAccountRole = 'owner' | 'admin' | 'enterprise_manager' | 'viewer';

export interface EnterpriseAccount {
  id: string;
  enterprise_name: string;
  manager_name: string;
  manager_email: string;
  manager_phone: string | null;
  role: EnterpriseAccountRole;
  status: EnterpriseAccountStatus;
  last_login_at: string | null;
  auth_user_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  // Phase 1-6 — 0363 invite onboarding 컬럼 (additive)
  brand_code: string | null;
  hq_invite_code: string | null;
  store_invite_code: string | null;
  invite_code_rotated_at: string | null;
  onboarding_enabled: boolean;
  allow_self_register_region: boolean;
}

export interface EnterpriseAccountListParams {
  search?: string | null;
  status?: EnterpriseAccountStatus | null;
  role?: EnterpriseAccountRole | null;
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
}

export interface EnterpriseAccountListResponse {
  success: boolean;
  data: EnterpriseAccount[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
}

export interface EnterpriseAccountCreateInput {
  enterpriseName: string;
  managerName: string;
  managerEmail: string;
  managerPhone?: string | null;
  role?: EnterpriseAccountRole;
  status?: EnterpriseAccountStatus;
  notes?: string | null;
  authUserId?: string | null;
}

export interface EnterpriseAccountUpdateInput {
  enterpriseName?: string | null;
  managerName?: string | null;
  managerEmail?: string | null;
  managerPhone?: string | null;
  role?: EnterpriseAccountRole | null;
  status?: EnterpriseAccountStatus | null;
  notes?: string | null;
  authUserId?: string | null;
}

export interface EnterpriseAccountKpi {
  total: number;
  active: number;
  invited: number;
  suspended: number;
  inactive: number;
  recent_login_7d: number;
  computed_at: string;
}

// =============================================================================
// RPCs
// =============================================================================

export async function adminListEnterpriseAccounts(
  params: EnterpriseAccountListParams = {},
): Promise<EnterpriseAccountListResponse> {
  const { data, error } = await supabase.rpc('admin_list_enterprise_accounts', {
    p_search: params.search ?? null,
    p_status: params.status ?? null,
    p_role: params.role ?? null,
    p_limit: params.limit ?? 50,
    p_offset: params.offset ?? 0,
    p_include_deleted: params.includeDeleted ?? false,
  });
  if (error) { console.error('[enterpriseAccountsApi] list failed', error); throw error; }
  return data as EnterpriseAccountListResponse;
}

export async function adminCreateEnterpriseAccount(
  input: EnterpriseAccountCreateInput,
): Promise<EnterpriseAccount> {
  const { data, error } = await supabase.rpc('admin_create_enterprise_account', {
    p_enterprise_name: input.enterpriseName,
    p_manager_name: input.managerName,
    p_manager_email: input.managerEmail,
    p_manager_phone: input.managerPhone ?? null,
    p_role: input.role ?? 'enterprise_manager',
    p_status: input.status ?? 'active',
    p_notes: input.notes ?? null,
    p_auth_user_id: input.authUserId ?? null,
  });
  if (error) { console.error('[enterpriseAccountsApi] create failed', error); throw error; }
  return data as EnterpriseAccount;
}

export async function adminUpdateEnterpriseAccount(
  id: string, input: EnterpriseAccountUpdateInput,
): Promise<EnterpriseAccount> {
  const { data, error } = await supabase.rpc('admin_update_enterprise_account', {
    p_id: id,
    p_enterprise_name: input.enterpriseName ?? null,
    p_manager_name: input.managerName ?? null,
    p_manager_email: input.managerEmail ?? null,
    p_manager_phone: input.managerPhone ?? null,
    p_role: input.role ?? null,
    p_status: input.status ?? null,
    p_notes: input.notes ?? null,
    p_auth_user_id: input.authUserId ?? null,
  });
  if (error) { console.error('[enterpriseAccountsApi] update failed', error); throw error; }
  return data as EnterpriseAccount;
}

export async function adminSetEnterpriseAccountStatus(
  id: string, status: EnterpriseAccountStatus,
): Promise<EnterpriseAccount> {
  const { data, error } = await supabase.rpc('admin_set_enterprise_account_status', {
    p_id: id, p_status: status,
  });
  if (error) { console.error('[enterpriseAccountsApi] set_status failed', error); throw error; }
  return data as EnterpriseAccount;
}

export async function adminSoftDeleteEnterpriseAccount(id: string): Promise<void> {
  const { error } = await supabase.rpc('admin_soft_delete_enterprise_account', { p_id: id });
  if (error) { console.error('[enterpriseAccountsApi] soft_delete failed', error); throw error; }
}

export async function adminEnterpriseAccountKpi(): Promise<EnterpriseAccountKpi> {
  const { data, error } = await supabase.rpc('admin_enterprise_account_kpi');
  if (error) { console.error('[enterpriseAccountsApi] kpi failed', error); throw error; }
  return data as EnterpriseAccountKpi;
}

/** 향후 로그인 훅에서 호출. 본인 또는 admin 만. */
export async function recordEnterpriseLogin(authUserId?: string): Promise<void> {
  const { error } = await supabase.rpc('record_enterprise_login', {
    p_auth_user_id: authUserId ?? null,
  });
  if (error) {
    // silent — 로그인 자체를 막지 않음
    console.warn('[enterpriseAccountsApi] record_login failed', error);
  }
}


// =============================================================================
// Phase 1-6 — Invite Onboarding (additive, 기존 RPC 변경 X)
// SQL: supabase/migrations/0363_enterprise_invite_onboarding.sql
// =============================================================================

export type EnterpriseInviteClaimType = 'hq_admin' | 'store';
export type EnterpriseInviteCodeKind = 'hq' | 'store' | 'both';
export type EnterpriseInviteClaimStatus = 'success' | 'failed' | 'pending';
export type EnterpriseFranchiseRole = 'primary' | 'secondary';

export interface EnterpriseInviteCodes {
  brand_code: string | null;
  hq_invite_code: string | null;
  store_invite_code: string | null;
}

// ----- admin_create_enterprise_account_v2 -----
export interface EnterpriseAccountV2CreateInput extends EnterpriseAccountCreateInput {
  brandCode?: string | null;
  hqInviteCode?: string | null;
  storeInviteCode?: string | null;
  franchiseName?: string | null;
  franchiseSlug?: string | null;
}

export interface EnterpriseAccountV2CreateResult {
  success: boolean;
  enterprise_account: EnterpriseAccount;
  franchise_id: string | null;
  codes: EnterpriseInviteCodes;
}

export async function adminCreateEnterpriseAccountV2(
  input: EnterpriseAccountV2CreateInput,
): Promise<EnterpriseAccountV2CreateResult> {
  const { data, error } = await supabase.rpc('admin_create_enterprise_account_v2', {
    p_enterprise_name: input.enterpriseName,
    p_manager_name: input.managerName,
    p_manager_email: input.managerEmail,
    p_manager_phone: input.managerPhone ?? null,
    p_brand_code: input.brandCode ?? null,
    p_hq_invite_code: input.hqInviteCode ?? null,
    p_store_invite_code: input.storeInviteCode ?? null,
    p_franchise_name: input.franchiseName ?? null,
    p_franchise_slug: input.franchiseSlug ?? null,
    p_role: input.role ?? 'enterprise_manager',
    p_status: input.status ?? 'active',
  });
  if (error) {
    console.error('[enterpriseAccountsApi] create_v2 failed', error);
    throw error;
  }
  return data as EnterpriseAccountV2CreateResult;
}

// ----- admin_rotate_enterprise_invite_code -----
export interface EnterpriseInviteRotateInput {
  enterpriseAccountId: string;
  codeType: EnterpriseInviteCodeKind;
  customCode?: string | null;
}

export interface EnterpriseInviteRotateResult {
  success: boolean;
  codes: {
    hq_invite_code: string | null;
    store_invite_code: string | null;
  };
  rotated_at: string;
}

export async function adminRotateEnterpriseInviteCode(
  input: EnterpriseInviteRotateInput,
): Promise<EnterpriseInviteRotateResult> {
  const { data, error } = await supabase.rpc('admin_rotate_enterprise_invite_code', {
    p_enterprise_account_id: input.enterpriseAccountId,
    p_code_type: input.codeType,
    p_custom_code: input.customCode ?? null,
  });
  if (error) {
    console.error('[enterpriseAccountsApi] rotate_invite failed', error);
    throw error;
  }
  return data as EnterpriseInviteRotateResult;
}

// ----- admin_get_enterprise_invite_summary -----
export interface EnterpriseFranchiseMapping {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  role: EnterpriseFranchiseRole;
}

export interface EnterpriseRegionSummary {
  id: string;
  region_name: string;
  region_code: string | null;
  status: string;
}

export interface EnterpriseInviteClaimRecord {
  id: string;
  claim_type: EnterpriseInviteClaimType;
  status: EnterpriseInviteClaimStatus;
  brand_name_input: string | null;
  store_name_input: string | null;
  region_name_input: string | null;
  failure_reason: string | null;
  invite_code_last4: string | null;
  user_id: string | null;
  created_at: string;
}

export interface EnterpriseInviteSummary {
  success: boolean;
  enterprise_account: EnterpriseAccount;
  franchises: EnterpriseFranchiseMapping[];
  regions: EnterpriseRegionSummary[];
  store_count: number;
  recent_claims: EnterpriseInviteClaimRecord[];
  computed_at: string;
}

export async function adminGetEnterpriseInviteSummary(
  enterpriseAccountId: string,
): Promise<EnterpriseInviteSummary> {
  const { data, error } = await supabase.rpc('admin_get_enterprise_invite_summary', {
    p_enterprise_account_id: enterpriseAccountId,
  });
  if (error) {
    console.error('[enterpriseAccountsApi] invite_summary failed', error);
    throw error;
  }
  return data as EnterpriseInviteSummary;
}

// ----- validate_enterprise_invite (anon allowed) -----
export interface EnterpriseInviteValidateInput {
  brandName: string;
  inviteCode: string;
  claimType: EnterpriseInviteClaimType;
}

export interface EnterpriseInviteAllowedRegion {
  id: string;
  region_name: string;
  region_code: string | null;
}

export type EnterpriseInviteValidateResult =
  | {
      success: true;
      enterprise_account_id: string;
      enterprise_name: string;
      brand_code: string | null;
      claim_type: EnterpriseInviteClaimType;
      allow_self_register_region: boolean;
      allowed_regions: EnterpriseInviteAllowedRegion[];
    }
  | { success: false; reason: string };

export async function validateEnterpriseInvite(
  input: EnterpriseInviteValidateInput,
): Promise<EnterpriseInviteValidateResult> {
  const { data, error } = await supabase.rpc('validate_enterprise_invite', {
    p_brand_name: input.brandName,
    p_invite_code: input.inviteCode,
    p_claim_type: input.claimType,
  });
  if (error) {
    // 네트워크/RLS 오류는 generic 메시지로 → 정보 누설 방지 + 사용자 친화
    console.warn('[enterpriseAccountsApi] validate_invite failed', error);
    return { success: false, reason: '검증 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' };
  }
  return data as EnterpriseInviteValidateResult;
}

// ----- claim_enterprise_hq_account -----
export interface EnterpriseHqClaimInput {
  brandName: string;
  inviteCode: string;
  userAgent?: string | null;
}

export type EnterpriseHqClaimResult =
  | { success: true; enterprise_account_id: string; claim_id: string }
  | { success: false; reason: string };

export async function claimEnterpriseHqAccount(
  input: EnterpriseHqClaimInput,
): Promise<EnterpriseHqClaimResult> {
  const { data, error } = await supabase.rpc('claim_enterprise_hq_account', {
    p_brand_name: input.brandName,
    p_invite_code: input.inviteCode,
    p_user_agent: input.userAgent ?? null,
  });
  if (error) {
    console.error('[enterpriseAccountsApi] claim_hq failed', error);
    // RPC raise exception 의 사용자 친화 메시지 그대로 노출
    const message = (error.message ?? '본사 계정 연결에 실패했습니다.').toString();
    return { success: false, reason: message };
  }
  return data as EnterpriseHqClaimResult;
}

// ----- claim_enterprise_store_account -----
export interface EnterpriseStoreClaimInput {
  brandName: string;
  inviteCode: string;
  storeName: string;
  regionName: string;
  userAgent?: string | null;
}

export type EnterpriseStoreClaimResult =
  | {
      success: true;
      enterprise_account_id: string;
      franchise_id: string;
      enterprise_region_id: string;
      franchise_store_id: string;
      claim_id: string;
    }
  | { success: false; reason: string };

export async function claimEnterpriseStoreAccount(
  input: EnterpriseStoreClaimInput,
): Promise<EnterpriseStoreClaimResult> {
  const { data, error } = await supabase.rpc('claim_enterprise_store_account', {
    p_brand_name: input.brandName,
    p_invite_code: input.inviteCode,
    p_store_name: input.storeName,
    p_region_name: input.regionName,
    p_user_agent: input.userAgent ?? null,
  });
  if (error) {
    console.error('[enterpriseAccountsApi] claim_store failed', error);
    const message = (error.message ?? '매장 연결에 실패했습니다.').toString();
    return { success: false, reason: message };
  }
  return data as EnterpriseStoreClaimResult;
}
