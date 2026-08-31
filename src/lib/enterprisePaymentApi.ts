/**
 * 엔터프라이즈 정기결제 — API 래퍼 (유저 + 관리자).
 */
import { supabase } from './supabase';
import type { EnterpriseBillingMode, EnterprisePayerType } from './enterprisePayment';

export interface EnterprisePaymentContext {
  should_pay: boolean;
  already_active?: boolean;
  payer_type?: EnterprisePayerType;
  amount?: number;
  enterprise_account_id?: string;
  enterprise_name?: string;
  franchise_store_id?: string | null;
}

export interface EnterpriseSubscription {
  status: string;
  amount: number;
  payer_type: EnterprisePayerType;
  current_period_end: string | null;
  last_paid_at: string | null;
  enterprise_name: string;
}

export interface EnterpriseOrderStatus {
  order_no: string;
  status: string;
  paid: boolean;
  amount: number;
}

export interface EnterpriseBillingConfig {
  billing_enabled: boolean;
  billing_mode: EnterpriseBillingMode;
  hq_monthly_price: number | null;
  store_monthly_price: number | null;
  active_hq_subs: number;
  active_store_subs: number;
}

/* ── 유저 ── */

export async function getMyEnterprisePaymentContext(): Promise<EnterprisePaymentContext> {
  const { data, error } = await supabase.rpc('get_my_enterprise_payment_context');
  if (error) throw error;
  return (data ?? { should_pay: false }) as EnterprisePaymentContext;
}

export async function createEnterprisePayment(recvphone: string): Promise<{
  ok: boolean; payurl?: string; order_no?: string; error?: string; reason?: string;
}> {
  const { data, error } = await supabase.functions.invoke('create-enterprise-payment', { body: { recvphone } });
  if (error) return { ok: false, error: error.message };
  return data as { ok: boolean; payurl?: string; order_no?: string; error?: string; reason?: string };
}

export async function getMyEnterpriseOrderStatus(orderNo: string): Promise<EnterpriseOrderStatus | null> {
  const { data, error } = await supabase.rpc('get_my_enterprise_order_status', { p_order_no: orderNo });
  if (error) throw error;
  return (data ?? null) as EnterpriseOrderStatus | null;
}

export async function getMyEnterpriseSubscription(): Promise<EnterpriseSubscription | null> {
  const { data, error } = await supabase.rpc('get_my_enterprise_subscription');
  if (error) throw error;
  return (data ?? null) as EnterpriseSubscription | null;
}

/* ── 관리자 ── */

export async function adminGetEnterpriseBillingConfig(enterpriseAccountId: string): Promise<EnterpriseBillingConfig | null> {
  const { data, error } = await supabase.rpc('admin_get_enterprise_billing_config', { p_enterprise_account_id: enterpriseAccountId });
  if (error) throw error;
  return (data ?? null) as EnterpriseBillingConfig | null;
}

export async function adminSetEnterpriseBillingConfig(enterpriseAccountId: string, p: {
  billing_enabled: boolean; billing_mode: EnterpriseBillingMode; hq_monthly_price: number | null; store_monthly_price: number | null;
}): Promise<void> {
  const { error } = await supabase.rpc('admin_set_enterprise_billing_config', {
    p_enterprise_account_id: enterpriseAccountId,
    p_billing_enabled: p.billing_enabled,
    p_billing_mode: p.billing_mode,
    p_hq_monthly_price: p.hq_monthly_price,
    p_store_monthly_price: p.store_monthly_price,
  });
  if (error) throw error;
}
