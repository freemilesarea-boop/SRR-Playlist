/**
 * pricingApi.ts — 요금제 화면 서버 호출 래퍼.
 * Migration: supabase/migrations/0502_pricing_self_serve_signup.sql
 * Edge Function: supabase/functions/verify-business-number
 */
import { supabase } from '@/lib/supabase';
import type { HqApplyForm, PricingContext } from '@/lib/pricingPlans';

export async function getMyPricingContext(): Promise<PricingContext> {
  const { data, error } = await supabase.rpc('get_my_pricing_context');
  if (error) throw error;
  return (data ?? { signed_in: false }) as PricingContext;
}

export interface BusinessVerifyResult {
  ok: boolean;
  business_verified: boolean;
  verification_status: 'verified' | 'manual_review' | 'rejected' | string;
  business_state: string | null;
  tax_type: string | null;
  nts_checked: boolean;
  verified_at: string | null;
  message: string;
}

/** 사업자등록번호 진위확인 + business_verification_profiles 기록 (서버가 유일한 기록자) */
export async function verifyBusinessNumberServerSide(input: {
  businessNumber: string;
  representativeName: string;
  businessOpenDate: string;   // YYYY-MM-DD
  businessName?: string;
  businessAddress?: string;
}): Promise<BusinessVerifyResult> {
  const { data, error } = await supabase.functions.invoke('verify-business-number', {
    body: {
      business_number: input.businessNumber,
      representative_name: input.representativeName,
      business_open_date: input.businessOpenDate,
      business_name: input.businessName ?? '',
      business_address: input.businessAddress ?? '',
    },
  });
  if (error) {
    // supabase-js 는 non-2xx 의 body 를 error.context 에 담는다 — 사유를 그대로 노출한다.
    let body: Partial<BusinessVerifyResult> = {};
    try {
      const ctx = (error as unknown as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') body = (await ctx.json()) as Partial<BusinessVerifyResult>;
    } catch { /* ignore */ }
    return {
      ok: false,
      business_verified: false,
      verification_status: body.verification_status ?? 'rejected',
      business_state: null,
      tax_type: null,
      nts_checked: false,
      verified_at: null,
      message: body.message ?? error.message,
    };
  }
  return data as BusinessVerifyResult;
}

export interface HqApplyResult {
  success: boolean;
  already_exists?: boolean;
  enterprise_account_id?: string;
  enterprise_name?: string;
  status?: string;
  join_code?: string | null;
  billing_mode?: 'per_store' | 'hq_consolidated';
  billing_enabled?: boolean;
  store_monthly_price?: number | null;
  awaiting_admin_approval?: boolean;
}

export async function applyEnterpriseHq(form: HqApplyForm): Promise<HqApplyResult> {
  const { data, error } = await supabase.rpc('apply_enterprise_hq_selfserve', {
    p_enterprise_name: form.enterpriseName.trim(),
    p_business_number: form.businessNumber.replace(/\D/g, ''),
    p_business_name: form.businessName.trim() || form.enterpriseName.trim(),
    p_representative_name: form.representativeName.trim(),
    p_business_open_date: form.businessOpenDate,
    p_business_address: form.businessAddress.trim() || null,
    p_manager_name: form.managerName.trim(),
    p_manager_phone: form.managerPhone.trim() || null,
    p_billing_mode: form.billingMode,
  });
  if (error) throw error;
  return data as HqApplyResult;
}

export interface JoinCodeLookup {
  success: boolean;
  reason?: string;
  enterprise_account_id?: string;
  enterprise_name?: string;
  billing_mode?: 'per_store' | 'hq_consolidated';
  billing_enabled?: boolean;
  store_pays?: boolean;
  store_monthly_price?: number | null;
}

export async function lookupEnterpriseJoinCode(code: string): Promise<JoinCodeLookup> {
  const { data, error } = await supabase.rpc('lookup_enterprise_join_code', { p_code: code });
  if (error) return { success: false, reason: error.message };
  return (data ?? { success: false }) as JoinCodeLookup;
}

export interface StoreJoinResult {
  success: boolean;
  reason?: string;
  enterprise_account_id?: string;
  franchise_store_id?: string;
  enterprise_name?: string;
  store_pays?: boolean;
  store_monthly_price?: number | string | null;
}

export async function joinEnterpriseStoreByCode(input: {
  code: string; storeName: string; regionName?: string;
}): Promise<StoreJoinResult> {
  const { data, error } = await supabase.rpc('join_enterprise_store_by_code', {
    p_code: input.code,
    p_store_name: input.storeName.trim(),
    p_region_name: input.regionName?.trim() || null,
    p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
  });
  if (error) return { success: false, reason: error.message };
  return (data ?? { success: false }) as StoreJoinResult;
}
