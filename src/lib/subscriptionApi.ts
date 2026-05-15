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

export interface RpcListResult<T> {
  rows: T[];
  error: string | null;
}

export async function listManualPaymentImports(
  limit = 50,
): Promise<RpcListResult<ManualPaymentImportRow>> {
  try {
    const { data, error } = await supabase.rpc('list_manual_payment_imports', { p_limit: limit });
    if (error) {
      if (import.meta.env.DEV) console.error('[listManualPaymentImports]', error);
      return { rows: [], error: error.message };
    }
    return { rows: (data ?? []) as ManualPaymentImportRow[], error: null };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : 'unknown' };
  }
}

// ---------- ADMIN: 자동 동기화 + 미매칭 연결 (0027) ----------

export interface SyncAttemptPreview {
  cmd: string;
  http_status: number | null;
  parsed_count: number;
  success: boolean;
  error: string | null;
  raw_preview: string;
}

export interface AutoSyncSummary {
  ok: boolean;
  date_from?: string;
  date_to?: string;
  success_cmd?: string | null;
  attempts?: SyncAttemptPreview[];
  fetched?: number;
  matched?: number;
  unmatched?: number;
  already_synced?: number;
  failed?: number;
  errors?: Array<{ mul_no: string; message: string }>;
  processed?: Array<{ mul_no: string; status: string; amount: number; plan_type: string | null }>;
  raw_response_preview?: string;
  log_failures?: number;
  hint?: string;
  missing_env?: string[];
  details?: string;
  user_id?: string;
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
    // 2xx → data 가 우리 JSON. non-2xx → error 가 채워지지만 data 에도 body 가 들어올 수 있음.
    if (error) {
      // supabase-js 는 non-2xx 에서 error 의 context 에 response body 를 담음
      // (FunctionsHttpError.context 에 Response 객체)
      let bodyJson: Partial<AutoSyncSummary> = {};
      try {
        const errAny = error as unknown as { context?: Response };
        if (errAny.context && typeof errAny.context.json === 'function') {
          bodyJson = (await errAny.context.json()) as Partial<AutoSyncSummary>;
        }
      } catch {
        /* parse 실패 무시 */
      }
      return {
        ok: false,
        error: error.message,
        ...bodyJson,
      };
    }
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

// ---------- ADMIN: diagnostics (0028) ----------

export interface SyncAttemptRow {
  id: string;
  requested_cmd: string;
  date_from: string | null;
  date_to: string | null;
  http_status: number | null;
  parsed_count: number;
  success: boolean;
  error_message: string | null;
  raw_preview: string | null;
  created_at: string;
}

export async function listRecentSyncAttempts(
  limit = 20,
): Promise<RpcListResult<SyncAttemptRow>> {
  try {
    const { data, error } = await supabase.rpc('list_recent_sync_attempts', { p_limit: limit });
    if (error) {
      if (import.meta.env.DEV) console.error('[listRecentSyncAttempts]', error);
      return { rows: [], error: error.message };
    }
    return { rows: (data ?? []) as SyncAttemptRow[], error: null };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : 'unknown' };
  }
}

export interface WebhookEventRow {
  id: string;
  event_key: string;
  order_no: string | null;
  user_id: string | null;
  payapp_mul_no: string | null;
  payapp_rebill_no: string | null;
  pay_state: number | null;
  state_label: string | null;
  price: number | null;
  linkval_verified: boolean;
  processed_at: string | null;
  reasons: string | null;
  matched_user_id: string | null;
  matched_user_email: string | null;
  matched_order_id: string | null;
  matched_subscription_id: string | null;
  membership_updated: boolean;
  final_membership_tier: string | null;
  processing_error: string | null;
  paid_candidate: boolean;
  approval_no: string | null;
  created_at: string;
}

export async function forceApplyPaidCandidate(
  eventId: string,
  reason?: string,
): Promise<{ ok: boolean; result?: ForceActivateResult; error?: string }> {
  try {
    const { data, error } = await supabase.rpc('admin_force_apply_paid_candidate', {
      p_event_id: eventId,
      p_reason: reason ?? null,
    });
    if (error) return { ok: false, error: error.message };
    const row = (Array.isArray(data) ? data[0] : data) as ForceActivateResult | undefined;
    return row ? { ok: true, result: row } : { ok: false, error: 'empty response' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}

export interface ReplayResult {
  matched_user_id: string | null;
  matched_order_id: string | null;
  matched_subscription_id: string | null;
  membership_updated: boolean;
  final_membership_tier: string | null;
  message: string;
}

export async function replayWebhookEvent(
  eventId: string,
): Promise<{ ok: boolean; result?: ReplayResult; error?: string }> {
  try {
    const { data, error } = await supabase.rpc('admin_replay_webhook_event', {
      p_event_id: eventId,
    });
    if (error) return { ok: false, error: error.message };
    const row = (Array.isArray(data) ? data[0] : data) as ReplayResult | undefined;
    return row ? { ok: true, result: row } : { ok: false, error: 'empty response' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}

export async function replayWebhookByMulNo(
  mulNo: string,
): Promise<{ ok: boolean; result?: ReplayResult; error?: string }> {
  try {
    const { data, error } = await supabase.rpc('admin_replay_webhook_by_mul_no', {
      p_mul_no: mulNo,
    });
    if (error) return { ok: false, error: error.message };
    const row = (Array.isArray(data) ? data[0] : data) as ReplayResult | undefined;
    return row ? { ok: true, result: row } : { ok: false, error: 'empty response' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}

// ---------- 강제 membership 적용 (state=64 webhook 영구 미도착 케이스) ----------

export interface ForceActivateResult {
  user_id: string;
  subscription_id: string | null;
  order_id: string | null;
  membership_updated: boolean;
  final_membership_tier: string | null;
  message: string;
}

export async function forceActivateMembership(payload: {
  user_id: string;
  plan_type?: 'individual' | 'business';
  reason?: string;
  amount?: number;
}): Promise<{ ok: boolean; result?: ForceActivateResult; error?: string }> {
  try {
    const { data, error } = await supabase.rpc('admin_force_activate_membership', {
      p_user_id: payload.user_id,
      p_plan_type: payload.plan_type ?? 'individual',
      p_reason: payload.reason ?? null,
      p_amount: payload.amount ?? null,
    });
    if (error) return { ok: false, error: error.message };
    const row = (Array.isArray(data) ? data[0] : data) as ForceActivateResult | undefined;
    return row ? { ok: true, result: row } : { ok: false, error: 'empty response' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}

export async function listRecentWebhookEvents(payload: {
  search?: string;
  minutes?: number;
  limit?: number;
}): Promise<RpcListResult<WebhookEventRow>> {
  try {
    const { data, error } = await supabase.rpc('list_recent_webhook_events', {
      p_search: payload.search ?? null,
      p_minutes: payload.minutes ?? 60,
      p_limit: payload.limit ?? 50,
    });
    if (error) {
      if (import.meta.env.DEV) console.error('[listRecentWebhookEvents]', error);
      return { rows: [], error: error.message };
    }
    return { rows: (data ?? []) as WebhookEventRow[], error: null };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : 'unknown' };
  }
}
