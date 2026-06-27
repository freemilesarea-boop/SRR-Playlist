/**
 * enterpriseHqApi — Phase 1-7
 *
 * Phase 1-6 invite-code 가입으로 enterprise_accounts.auth_user_id 매칭된
 * HQ 사용자 / 매장 사용자 셀프 dashboard + 본사 사업자 정보 wrapper.
 *
 * 기존 enterpriseAccountsApi.ts (admin 전용) 와 분리 — 사용자(authenticated)
 * 본인 행만 접근하는 셀프 RPC 만 모음.
 *
 * SQL: supabase/migrations/0364_enterprise_hq_profile_dashboard.sql
 */
import { supabase } from '@/lib/supabase';

// =============================================================================
// Types — role / store info
// =============================================================================

export type EnterpriseHqRole =
  | { is_hq: false }
  | {
      is_hq: true;
      enterprise_account_id: string;
      enterprise_name: string;
      brand_code: string | null;
      status: 'active' | 'invited' | 'suspended' | 'inactive';
    };

export type EnterpriseStoreInfo =
  | { is_store: false }
  | {
      is_store: true;
      store_name: string | null;
      store_status: 'active' | 'inactive' | 'suspended';
      franchise_id: string;
      franchise_name: string;
      region_name: string | null;
      region_code: string | null;
      enterprise_account_id: string | null;
      enterprise_name: string | null;
      brand_code: string | null;
    };

// =============================================================================
// Types — dashboard
// =============================================================================

export interface EnterpriseBusinessProfile {
  id: string;
  enterprise_account_id: string;
  company_name: string | null;
  business_number: string | null;
  representative_name: string | null;
  business_address: string | null;
  contact_phone: string | null;
  tax_invoice_email: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnterpriseHqFranchiseSummary {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  role: 'primary' | 'secondary';
  store_count: number;
}

export interface EnterpriseHqRegionSummary {
  id: string;
  region_name: string;
  region_code: string | null;
  status: string;
}

export interface EnterpriseHqRecentStore {
  store_id: string;
  store_name: string | null;
  franchise_name: string;
  region_name: string | null;
  joined_at: string | null;
  status: string;
}

export interface EnterpriseHqDashboardAccount {
  id: string;
  enterprise_name: string;
  brand_code: string | null;
  manager_name: string;
  manager_email: string;
  manager_phone: string | null;
  role: string;
  status: 'active' | 'invited' | 'suspended' | 'inactive';
  onboarding_enabled: boolean;
  allow_self_register_region: boolean;
  hq_invite_code: string | null;
  store_invite_code: string | null;
  invite_code_rotated_at: string | null;
  last_login_at: string | null;
}

export interface EnterpriseHqDashboard {
  success: boolean;
  enterprise_account: EnterpriseHqDashboardAccount;
  franchises: EnterpriseHqFranchiseSummary[];
  regions: EnterpriseHqRegionSummary[];
  store_count: number;
  recent_stores: EnterpriseHqRecentStore[];
  business_profile: EnterpriseBusinessProfile | null;
  business_profile_present: boolean;
  computed_at: string;
}

// =============================================================================
// Types — upsert input
// =============================================================================

export interface EnterpriseBusinessProfileUpsertInput {
  companyName?: string | null;
  businessNumber?: string | null;
  representativeName?: string | null;
  businessAddress?: string | null;
  contactPhone?: string | null;
  taxInvoiceEmail?: string | null;
  notes?: string | null;
}

export interface EnterpriseBusinessProfileUpsertResult {
  success: boolean;
  profile: EnterpriseBusinessProfile;
}

// =============================================================================
// Wrappers
// =============================================================================

export async function getMyEnterpriseRole(): Promise<EnterpriseHqRole> {
  const { data, error } = await supabase.rpc('get_my_enterprise_role');
  if (error) {
    // 인증 안 됐거나 RPC 미적용 — 안전하게 is_hq=false fallback
    console.warn('[enterpriseHqApi] get_my_enterprise_role failed', error);
    return { is_hq: false };
  }
  return (data as EnterpriseHqRole | null) ?? { is_hq: false };
}

export async function getMyEnterpriseStoreInfo(): Promise<EnterpriseStoreInfo> {
  const { data, error } = await supabase.rpc('get_my_enterprise_store_info');
  if (error) {
    console.warn('[enterpriseHqApi] get_my_enterprise_store_info failed', error);
    return { is_store: false };
  }
  return (data as EnterpriseStoreInfo | null) ?? { is_store: false };
}

export async function getMyEnterpriseDashboard(): Promise<EnterpriseHqDashboard> {
  const { data, error } = await supabase.rpc('get_my_enterprise_dashboard');
  if (error) {
    console.error('[enterpriseHqApi] get_my_enterprise_dashboard failed', error);
    throw new Error(error.message || '본사 대시보드를 불러올 수 없습니다.');
  }
  return data as EnterpriseHqDashboard;
}

export async function upsertMyEnterpriseBusinessProfile(
  input: EnterpriseBusinessProfileUpsertInput,
): Promise<EnterpriseBusinessProfileUpsertResult> {
  const { data, error } = await supabase.rpc('upsert_my_enterprise_business_profile', {
    p_company_name: input.companyName ?? null,
    p_business_number: input.businessNumber ?? null,
    p_representative_name: input.representativeName ?? null,
    p_business_address: input.businessAddress ?? null,
    p_contact_phone: input.contactPhone ?? null,
    p_tax_invoice_email: input.taxInvoiceEmail ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) {
    console.error('[enterpriseHqApi] upsert business profile failed', error);
    throw new Error(error.message || '사업자 정보 저장에 실패했습니다.');
  }
  return data as EnterpriseBusinessProfileUpsertResult;
}
