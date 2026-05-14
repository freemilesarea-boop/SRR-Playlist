/**
 * subscriptionApi.ts — PayApp 정기결제 Edge Function wrapper.
 *
 * 모든 결제 권한 부여는 payapp-feedback 웹훅에서만 수행됨.
 * 프론트는 결제창 진입 / 폴링 / 해지 요청만 담당.
 */

import { supabase } from './supabase';

export interface SubscriptionSnapshot {
  id: string;
  plan_type: 'individual' | 'business';
  status: 'pending' | 'active' | 'canceled' | 'failed' | 'expired' | 'payment_waiting';
  price: number;
  current_period_start: string | null;
  current_period_end: string | null;
  last_paid_at: string | null;
  canceled_at: string | null;
  payapp_rebill_no: string | null;
  created_at: string;
}

export interface MySubscriptionResult {
  subscription: SubscriptionSnapshot | null;
  cancelable: boolean;
}

export interface SubscriptionPlan {
  plan_type: 'individual' | 'business';
  name: string;
  price: number;
  billing_cycle: 'monthly' | 'yearly';
}

/** 서버 가격 기준 plan 조회 — 프론트에서 가격 신뢰 X, 표시용만 */
export async function fetchSubscriptionPlans(): Promise<SubscriptionPlan[]> {
  try {
    const { data, error } = await supabase
      .from('subscription_plans')
      .select('plan_type, name, price, billing_cycle')
      .eq('is_active', true)
      .order('price', { ascending: true });
    if (error) throw error;
    return (data ?? []) as SubscriptionPlan[];
  } catch {
    return [];
  }
}

export async function createPayappSubscription(payload: {
  plan_type: 'individual' | 'business';
  recvphone: string;
}): Promise<{ ok: boolean; payurl?: string; order_no?: string; error?: string }> {
  const { data, error } = await supabase.functions.invoke('create-payapp-subscription', {
    body: payload,
  });
  if (error) return { ok: false, error: error.message };
  const r = (data ?? {}) as { ok?: boolean; payurl?: string; order_no?: string; error?: string };
  return r.ok ? { ok: true, payurl: r.payurl, order_no: r.order_no } : { ok: false, error: r.error };
}

export async function cancelPayappSubscription(
  subscriptionId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.functions.invoke('cancel-payapp-subscription', {
    body: { subscription_id: subscriptionId },
  });
  if (error) return { ok: false, error: error.message };
  const r = (data ?? {}) as { ok?: boolean; error?: string };
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function fetchMySubscription(): Promise<MySubscriptionResult> {
  const { data, error } = await supabase.functions.invoke('get-my-subscription', { body: {} });
  if (error) return { subscription: null, cancelable: false };
  return (data ?? { subscription: null, cancelable: false }) as MySubscriptionResult;
}

// ---------- ADMIN: manual payment sync (0026) ----------

export interface AdminSyncPaymentResult {
  status: 'matched' | 'unmatched' | 'failed';
  user_id: string | null;
  order_id: string | null;
  subscription_id: string | null;
  import_id: string | null;
  message: string;
}

export async function adminSyncPayappPayment(payload: {
  payapp_mul_no: string;
  amount: number;
  plan_type: 'individual' | 'business';
  approval_no?: string;
  buyer_email?: string;
  buyer_phone?: string;
  paid_at?: string;
  goodname?: string;
}): Promise<{ ok: boolean; result?: AdminSyncPaymentResult; error?: string }> {
  try {
    const { data, error } = await supabase.rpc('admin_sync_payapp_payment', {
      p_payapp_mul_no: payload.payapp_mul_no,
      p_amount: payload.amount,
      p_plan_type: payload.plan_type,
      p_approval_no: payload.approval_no ?? null,
      p_buyer_email: payload.buyer_email ?? null,
      p_buyer_phone: payload.buyer_phone ?? null,
      p_paid_at: payload.paid_at ?? new Date().toISOString(),
      p_goodname: payload.goodname ?? null,
    });
    if (error) return { ok: false, error: error.message };
    const row = (Array.isArray(data) ? data[0] : data) as AdminSyncPaymentResult | undefined;
    return row ? { ok: true, result: row } : { ok: false, error: 'empty response' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}

export interface ManualPaymentImportRow {
  id: string;
  payapp_mul_no: string;
  approval_no: string | null;
  buyer_email: string | null;
  buyer_phone: string | null;
  amount: number;
  plan_type: 'individual' | 'business';
  goodname: string | null;
  paid_at: string;
  matched_user_id: string | null;
  matched_user_email: string | null;
  matched_order_id: string | null;
  matched_subscription_id: string | null;
  status: 'matched' | 'unmatched' | 'failed';
  error_message: string | null;
  created_at: string;
}

export async function listManualPaymentImports(limit = 50): Promise<ManualPaymentImportRow[]> {
  try {
    const { data, error } = await supabase.rpc('list_manual_payment_imports', { p_limit: limit });
    if (error) return [];
    return (data ?? []) as ManualPaymentImportRow[];
  } catch {
    return [];
  }
}

// ---------- ADMIN: 자동 동기화 + 미매칭 연결 (0027) ----------

export interface AutoSyncSummary {
  ok: boolean;
  date_from?: string;
  date_to?: string;
  fetched?: number;
  matched?: number;
  unmatched?: number;
  already_synced?: number;
  failed?: number;
  errors?: Array<{ mul_no: string; message: string }>;
  processed?: Array<{ mul_no: string; status: string; amount: number; plan_type: string | null }>;
  raw_response_preview?: string;
  error?: string;
}

export async function syncPayappPaymentsAuto(payload: {
  date_from?: string;
  date_to?: string;
  plan_type?: 'individual' | 'business';
}): Promise<AutoSyncSummary> {
  try {
    const { data, error } = await supabase.functions.invoke('sync-payapp-payments', {
      body: payload,
    });
    if (error) return { ok: false, error: error.message };
    return data as AutoSyncSummary;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}

export interface UserSearchRow {
  user_id: string;
  email: string | null;
  nickname: string | null;
}

export async function searchUsersForLink(query: string, limit = 10): Promise<UserSearchRow[]> {
  try {
    const { data, error } = await supabase.rpc('admin_search_users_for_link', {
      p_query: query,
      p_limit: limit,
    });
    if (error) return [];
    return (data ?? []) as UserSearchRow[];
  } catch {
    return [];
  }
}

export interface LinkUnmatchedResult {
  status: 'matched';
  user_id: string;
  order_id: string;
  subscription_id: string;
  message: string;
}

export async function linkUnmatchedImport(
  importId: string,
  userId: string,
): Promise<{ ok: boolean; result?: LinkUnmatchedResult; error?: string }> {
  try {
    const { data, error } = await supabase.rpc('admin_link_unmatched_import', {
      p_import_id: importId,
      p_user_id: userId,
    });
    if (error) return { ok: false, error: error.message };
    const row = (Array.isArray(data) ? data[0] : data) as LinkUnmatchedResult | undefined;
    return row ? { ok: true, result: row } : { ok: false, error: 'empty response' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}
