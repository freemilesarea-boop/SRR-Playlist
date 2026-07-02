/**
 * enterpriseBrandRegistryApi — Phase 3-2
 *
 * Enterprise Brand Registry + 자동 Onboarding wrapper.
 * Migration: supabase/migrations/0398_enterprise_brand_registry_v1.sql
 *
 * 절대 무수정:
 *   • 기존 enterprise_accounts / enterprise_contracts wrapper 무영향.
 *   • 기존 0363 invite 시스템 (validate_enterprise_invite / claim_enterprise_hq_account) 무관.
 *   • Settlement 계산식 / Contract Snapshot 무영향.
 */
import { supabase } from '@/lib/supabase';

// ============================================================================
// Types
// ============================================================================

export type BrandSettlementMethod = 'monthly' | 'weekly' | 'manual';

export interface BrandRegistryRow {
  id: string;
  brand_name: string;
  brand_code: string;
  business_name: string;
  business_registration_no: string | null;
  representative_name: string | null;
  manager_name: string;
  manager_email: string;
  manager_phone: string | null;
  business_address: string | null;
  default_monthly_fee: number;
  default_store_price: number;
  default_commission_rate: number;
  default_minimum_payout: number;
  default_settlement_method: BrandSettlementMethod;
  default_auto_renew: boolean;
  is_active: boolean;
  memo: string | null;
  created_at: string;
  updated_at: string;
}

export interface BrandCodeGeneration {
  success: boolean;
  brand_name: string;
  base: string;
  suffix: string;
  brand_code: string;
}

export interface BrandRegistryCreateInput {
  brandName: string;
  brandCode?: string | null;                   // null 이면 자동 발번
  businessName: string;
  managerName: string;
  managerEmail: string;
  businessRegistrationNo?: string | null;
  representativeName?: string | null;
  managerPhone?: string | null;
  businessAddress?: string | null;
  defaultMonthlyFee?: number;
  defaultStorePrice?: number;
  defaultCommissionRate?: number;
  defaultMinimumPayout?: number;
  defaultSettlementMethod?: BrandSettlementMethod;
  defaultAutoRenew?: boolean;
  memo?: string | null;
}

export interface BrandRegistryUpdateInput {
  id: string;
  brandName?: string | null;
  businessName?: string | null;
  businessRegistrationNo?: string | null;
  representativeName?: string | null;
  managerName?: string | null;
  managerEmail?: string | null;
  managerPhone?: string | null;
  businessAddress?: string | null;
  defaultMonthlyFee?: number | null;
  defaultStorePrice?: number | null;
  defaultCommissionRate?: number | null;
  defaultMinimumPayout?: number | null;
  defaultSettlementMethod?: BrandSettlementMethod | null;
  defaultAutoRenew?: boolean | null;
  memo?: string | null;
}

export interface BrandRegistryListParams {
  search?: string | null;
  isActive?: boolean | null;
  limit?: number;
  offset?: number;
}

export interface BrandRegistryListResponse {
  success: boolean;
  data: BrandRegistryRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface ValidateBrandSignupResult {
  success: boolean;
  reason?: 'brand_name_required' | 'brand_code_required' | 'brand_not_matched' | string;
  brand_id?: string;
  brand_name?: string;
  brand_code?: string;
  business_name?: string;
}

export interface ClaimBrandRegistryResult {
  success: boolean;
  enterprise_account_id: string;
  contract_id: string;
  brand_registry_id: string;
  brand_code: string;
  brand_name: string;
  status: 'invited';
  awaiting_admin_approval: true;
}

// ============================================================================
// Admin RPCs
// ============================================================================

export async function adminGenerateBrandCode(brandName: string): Promise<BrandCodeGeneration> {
  const { data, error } = await supabase.rpc('admin_generate_brand_code', { p_brand_name: brandName });
  if (error) throw error;
  return data as BrandCodeGeneration;
}

export async function adminCreateBrandRegistry(input: BrandRegistryCreateInput): Promise<{ success: boolean; id: string; brand_code: string }> {
  const { data, error } = await supabase.rpc('admin_create_brand_registry', {
    p_brand_name:                 input.brandName,
    p_brand_code:                 input.brandCode ?? null,
    p_business_name:              input.businessName,
    p_manager_name:               input.managerName,
    p_manager_email:              input.managerEmail,
    p_business_registration_no:   input.businessRegistrationNo ?? null,
    p_representative_name:        input.representativeName ?? null,
    p_manager_phone:              input.managerPhone ?? null,
    p_business_address:           input.businessAddress ?? null,
    p_default_monthly_fee:        input.defaultMonthlyFee ?? 0,
    p_default_store_price:        input.defaultStorePrice ?? 4900,
    p_default_commission_rate:    input.defaultCommissionRate ?? 0,
    p_default_minimum_payout:     input.defaultMinimumPayout ?? 0,
    p_default_settlement_method:  input.defaultSettlementMethod ?? 'monthly',
    p_default_auto_renew:         input.defaultAutoRenew ?? true,
    p_memo:                       input.memo ?? null,
  });
  if (error) throw error;
  return data as { success: boolean; id: string; brand_code: string };
}

export async function adminUpdateBrandRegistry(input: BrandRegistryUpdateInput): Promise<{ success: boolean; id: string }> {
  const { data, error } = await supabase.rpc('admin_update_brand_registry', {
    p_id: input.id,
    p_brand_name:                 input.brandName ?? null,
    p_business_name:              input.businessName ?? null,
    p_business_registration_no:   input.businessRegistrationNo ?? null,
    p_representative_name:        input.representativeName ?? null,
    p_manager_name:               input.managerName ?? null,
    p_manager_email:              input.managerEmail ?? null,
    p_manager_phone:              input.managerPhone ?? null,
    p_business_address:           input.businessAddress ?? null,
    p_default_monthly_fee:        input.defaultMonthlyFee ?? null,
    p_default_store_price:        input.defaultStorePrice ?? null,
    p_default_commission_rate:    input.defaultCommissionRate ?? null,
    p_default_minimum_payout:     input.defaultMinimumPayout ?? null,
    p_default_settlement_method:  input.defaultSettlementMethod ?? null,
    p_default_auto_renew:         input.defaultAutoRenew ?? null,
    p_memo:                       input.memo ?? null,
  });
  if (error) throw error;
  return data as { success: boolean; id: string };
}

export async function adminToggleBrandRegistryActive(id: string, isActive: boolean): Promise<{ success: boolean; id: string; is_active: boolean }> {
  const { data, error } = await supabase.rpc('admin_toggle_brand_registry_active', {
    p_id: id, p_is_active: isActive,
  });
  if (error) throw error;
  return data as { success: boolean; id: string; is_active: boolean };
}

export async function adminListBrandRegistry(params: BrandRegistryListParams = {}): Promise<BrandRegistryListResponse> {
  const { data, error } = await supabase.rpc('admin_list_brand_registry', {
    p_search:    params.search ?? null,
    p_is_active: params.isActive ?? null,
    p_limit:     params.limit ?? 100,
    p_offset:    params.offset ?? 0,
  });
  if (error) throw error;
  return data as BrandRegistryListResponse;
}

export async function adminGetBrandRegistry(id: string): Promise<{ success: boolean; brand: BrandRegistryRow }> {
  const { data, error } = await supabase.rpc('admin_get_brand_registry', { p_id: id });
  if (error) throw error;
  return data as { success: boolean; brand: BrandRegistryRow };
}

// ============================================================================
// Public / Auth RPCs — 회원가입 flow
// ============================================================================

export async function validateBrandRegistrySignup(brandName: string, brandCode: string): Promise<ValidateBrandSignupResult> {
  const { data, error } = await supabase.rpc('validate_brand_registry_signup', {
    p_brand_name: brandName, p_brand_code: brandCode,
  });
  if (error) return { success: false, reason: error.message };
  return data as ValidateBrandSignupResult;
}

export async function claimBrandRegistryEnterprise(input: {
  brandName: string; brandCode: string; businessName?: string; managerPhone?: string;
}): Promise<ClaimBrandRegistryResult> {
  const { data, error } = await supabase.rpc('claim_brand_registry_enterprise', {
    p_brand_name:     input.brandName,
    p_brand_code:     input.brandCode,
    p_business_name:  input.businessName ?? null,
    p_manager_phone:  input.managerPhone ?? null,
  });
  if (error) throw error;
  return data as ClaimBrandRegistryResult;
}

// ============================================================================
// Admin Approval flow
// ============================================================================

export async function adminApproveBrandOnboarding(enterpriseAccountId: string): Promise<{ success: boolean; enterprise_account_id: string; status: string }> {
  const { data, error } = await supabase.rpc('admin_approve_brand_onboarding', {
    p_ea_id: enterpriseAccountId,
  });
  if (error) throw error;
  return data as { success: boolean; enterprise_account_id: string; status: string };
}

export async function adminRejectBrandOnboarding(enterpriseAccountId: string, reason?: string): Promise<{ success: boolean; enterprise_account_id: string; rejected: boolean; reason: string | null }> {
  const { data, error } = await supabase.rpc('admin_reject_brand_onboarding', {
    p_ea_id: enterpriseAccountId, p_reason: reason ?? null,
  });
  if (error) throw error;
  return data as { success: boolean; enterprise_account_id: string; rejected: boolean; reason: string | null };
}
