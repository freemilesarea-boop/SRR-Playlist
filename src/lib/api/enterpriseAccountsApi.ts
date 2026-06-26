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
