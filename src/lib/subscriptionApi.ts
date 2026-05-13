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
