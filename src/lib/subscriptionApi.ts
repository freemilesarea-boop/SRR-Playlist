/**
 * subscriptionApi.ts — PayApp 정기결제 Edge Function wrapper.
 *
 * 모든 결제 권한 부여는 payapp-feedback 웹훅에서만 수행됨.
 * 프론트는 결제창 진입 / 폴링 / 해지 요청만 담당.
 */

import { supabase } from './supabase';
import { captureError } from './sentry';

export interface SubscriptionSnapshot {
  id: string;
  plan_type: 'individual' | 'business';
  status:
    | 'pending'
    | 'active'
    | 'canceled'
    | 'cancel_scheduled'
    | 'failed'
    | 'expired'
    | 'payment_waiting';
  price: number;
  current_period_start: string | null;
  current_period_end: string | null;
  last_paid_at: string | null;
  canceled_at: string | null;
  cancel_requested_at?: string | null;
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
  promotion_code?: string | null;
}): Promise<{ ok: boolean; payurl?: string; order_no?: string; error?: string; reason?: string }> {
  const { data, error } = await supabase.functions.invoke('create-payapp-subscription', {
    body: payload,
  });
  if (error) {
    // non-2xx 응답 body(예: {error,reason})를 error.context 에서 추출 — 프로모션 마감 등 사유 전달
    let body: { error?: string; reason?: string } = {};
    try {
      const errAny = error as unknown as { context?: Response };
      if (errAny.context && typeof errAny.context.json === 'function') {
        body = (await errAny.context.json()) as { error?: string; reason?: string };
      }
    } catch {
      /* ignore */
    }
    return { ok: false, error: body.error ?? error.message, reason: body.reason };
  }
  const r = (data ?? {}) as {
    ok?: boolean; payurl?: string; order_no?: string; error?: string; reason?: string;
  };
  return r.ok
    ? { ok: true, payurl: r.payurl, order_no: r.order_no }
    : { ok: false, error: r.error, reason: r.reason };
}

export async function cancelPayappSubscription(
  subscriptionId: string,
  reason?: string,
): Promise<{ ok: boolean; error?: string; current_period_end?: string | null; message?: string }> {
  const { data, error } = await supabase.functions.invoke('cancel-payapp-subscription', {
    body: { subscription_id: subscriptionId, reason: reason ?? 'user_request' },
  });
  if (error) {
    // supabase-js 가 non-2xx 에서 body 를 error.context 에 담음. message 추출
    let bodyMsg: string | undefined;
    try {
      const errAny = error as unknown as { context?: Response };
      if (errAny.context && typeof errAny.context.json === 'function') {
        const b = (await errAny.context.json()) as { message?: string };
        bodyMsg = b.message;
      }
    } catch {
      /* ignore */
    }
    return { ok: false, error: bodyMsg ?? error.message };
  }
  const r = (data ?? {}) as {
    ok?: boolean;
    error?: string;
    current_period_end?: string | null;
    message?: string;
  };
  return r.ok
    ? { ok: true, current_period_end: r.current_period_end, message: r.message }
    : { ok: false, error: r.error };
}

/** 회원 탈퇴 — 활성 구독 있으면 server 에서 reject */
export async function requestWithdrawal(
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('user_request_withdrawal', {
    p_reason: reason ?? null,
  });
  if (error) {
    const hint = (error as { hint?: string }).hint;
    return { ok: false, error: hint ?? error.message };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { withdrawn_at?: string } | undefined;
  return row ? { ok: true } : { ok: false, error: 'empty response' };
}

/** 본인 cancel_scheduled 가 period_end 지났으면 즉시 free 회수 — 로그인 시 한 번 호출 */
export async function expireMyScheduledCancellation(): Promise<number> {
  const { data } = await supabase.rpc('expire_my_scheduled_cancellation');
  return (data as number | null) ?? 0;
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
    if (error) return { ok: false, error: rpcErrorDetail('admin_sync_payapp_payment', error) };
    const row = (Array.isArray(data) ? data[0] : data) as AdminSyncPaymentResult | undefined;
    return row ? { ok: true, result: row } : { ok: false, error: 'empty response' };
  } catch (e) {
    return { ok: false, error: rpcErrorDetail('admin_sync_payapp_payment', e) };
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
    if (error) return { rows: [], error: rpcErrorDetail('list_manual_payment_imports', error) };
    return { rows: (data ?? []) as ManualPaymentImportRow[], error: null };
  } catch (e) {
    return { rows: [], error: rpcErrorDetail('list_manual_payment_imports', e) };
  }
}

// ---------- ADMIN: 자동 동기화 + 미매칭 연결 (0027) ----------

export interface SyncAttemptPreview {
  cmd: string;
  http_status: number | null;
  errno?: string | null;
  errmsg?: string | null;
  remoteaddr?: string | null;
  parsed_count: number;
  success: boolean;
  from_cache?: boolean;
  error: string | null;
  raw_preview: string;
}

export interface AutoSyncSummary {
  ok: boolean;
  // 'webhook_replay' = 신규 동작 (PayApp REST API 가 list cmd 를 지원하지 않아
  // 저장된 webhook event 를 재처리하는 모드). 이전 'cmd 탐색' 모드는 폐기됨.
  mode?: 'webhook_replay' | string;
  date_from?: string;
  date_to?: string;
  // 신규: webhook replay 결과
  scanned?: number;
  pending_total?: number | null;
  // 정상 보류 상태(state=4 승인대기, approval_no 없음)로 사전 필터되어 RPC 호출
  // 생략된 webhook 수. actionable = scanned 와 별개.
  skipped_pending?: number;
  // 구 필드 유지 (UI 하위 호환). scanned 와 동일 값.
  fetched?: number;
  matched?: number;
  unmatched?: number;
  already_synced?: number;
  failed?: number;
  errors?: Array<{ mul_no: string; message: string }>;
  processed?: Array<{ mul_no: string; status: string; amount: number; plan_type: string | null }>;
  hint?: string;
  missing_env?: string[];
  details?: string;
  user_id?: string;
  error?: string;
  // 구 'cmd 탐색' 모드 잔여 필드 (서버 응답에 더 이상 포함되지 않지만, 타입
  // breakage 방지용 optional 로 유지)
  success_cmd?: string | null;
  cached_cmd?: string | null;
  attempts?: SyncAttemptPreview[];
  log_failures?: number;
  all_errno_70040?: boolean;
  observed_remote_addr?: string | null;
  raw_response_preview?: string;
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
    void captureError(e, { scope: 'syncPayappPaymentsAuto' });
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
    if (error) return { ok: false, error: rpcErrorDetail('admin_link_unmatched_import', error) };
    const row = (Array.isArray(data) ? data[0] : data) as LinkUnmatchedResult | undefined;
    return row ? { ok: true, result: row } : { ok: false, error: 'empty response' };
  } catch (e) {
    return { ok: false, error: rpcErrorDetail('admin_link_unmatched_import', e) };
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
    if (error) return { rows: [], error: rpcErrorDetail('list_recent_sync_attempts', error) };
    return { rows: (data ?? []) as SyncAttemptRow[], error: null };
  } catch (e) {
    return { rows: [], error: rpcErrorDetail('list_recent_sync_attempts', e) };
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
    if (error) return { ok: false, error: rpcErrorDetail('admin_force_apply_paid_candidate', error) };
    const row = (Array.isArray(data) ? data[0] : data) as ForceActivateResult | undefined;
    return row ? { ok: true, result: row } : { ok: false, error: 'empty response' };
  } catch (e) {
    return { ok: false, error: rpcErrorDetail('admin_force_apply_paid_candidate', e) };
  }
}

export interface ReplayResult {
  matched_user_id: string | null;
  matched_order_id: string | null;
  matched_subscription_id: string | null;
  membership_updated: boolean;
  final_membership_tier: string | null;
  message: string;
  // 0036 admin_replay_webhook_by_mul_no 추가 필드 (event-단일 replay 에는 없음, optional)
  final_status?: string;
  processed_count?: number;
  paid_count?: number;
  refund_count?: number;
  pending_count?: number;
  error_count?: number;
}

// PG/PostgREST 에러를 상세히 포착 — UI 에 어떤 RPC 가 어떤 SQLSTATE/메시지로 실패했는지 표시
function rpcErrorDetail(name: string, e: unknown): string {
  const x = (e ?? {}) as { message?: string; code?: string; details?: string; hint?: string; status?: number };
  const parts: string[] = [name];
  if (x.code) parts.push(`[${x.code}]`);
  if (x.status) parts.push(`HTTP ${x.status}`);
  parts.push(x.message ?? String(e));
  if (x.details && x.details !== x.message) parts.push(`details: ${x.details}`);
  if (x.hint) parts.push(`hint: ${x.hint}`);
  const full = parts.join(' ');
  if (import.meta.env.DEV) console.error('[RPC failed]', name, e);
  return full;
}

export async function replayWebhookEvent(
  eventId: string,
): Promise<{ ok: boolean; result?: ReplayResult; error?: string }> {
  try {
    const { data, error } = await supabase.rpc('admin_replay_webhook_event', {
      p_event_id: eventId,
    });
    if (error) return { ok: false, error: rpcErrorDetail('admin_replay_webhook_event', error) };
    const row = (Array.isArray(data) ? data[0] : data) as ReplayResult | undefined;
    return row ? { ok: true, result: row } : { ok: false, error: 'empty response' };
  } catch (e) {
    return { ok: false, error: rpcErrorDetail('admin_replay_webhook_event', e) };
  }
}

export async function replayWebhookByMulNo(
  mulNo: string,
): Promise<{ ok: boolean; result?: ReplayResult; error?: string }> {
  try {
    const { data, error } = await supabase.rpc('admin_replay_webhook_by_mul_no', {
      p_mul_no: mulNo,
    });
    if (error) return { ok: false, error: rpcErrorDetail('admin_replay_webhook_by_mul_no', error) };
    const row = (Array.isArray(data) ? data[0] : data) as ReplayResult | undefined;
    return row ? { ok: true, result: row } : { ok: false, error: 'empty response' };
  } catch (e) {
    return { ok: false, error: rpcErrorDetail('admin_replay_webhook_by_mul_no', e) };
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
    if (error) return { ok: false, error: rpcErrorDetail('admin_force_activate_membership', error) };
    const row = (Array.isArray(data) ? data[0] : data) as ForceActivateResult | undefined;
    return row ? { ok: true, result: row } : { ok: false, error: 'empty response' };
  } catch (e) {
    return { ok: false, error: rpcErrorDetail('admin_force_activate_membership', e) };
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
    if (error) return { rows: [], error: rpcErrorDetail('list_recent_webhook_events', error) };
    return { rows: (data ?? []) as WebhookEventRow[], error: null };
  } catch (e) {
    return { rows: [], error: rpcErrorDetail('list_recent_webhook_events', e) };
  }
}

// ---------- 0042 — 정기결제 해지 백필 ----------

export interface BackfillCancelResult {
  applied: number;
  scanned: number;
  events: unknown[];
}

export async function backfillSubscriptionCancels(payload: {
  since?: string; // ISO timestamptz
  dryRun?: boolean;
}): Promise<{ ok: boolean; result?: BackfillCancelResult; error?: string }> {
  try {
    const { data, error } = await supabase.rpc('admin_backfill_subscription_cancels', {
      p_since: payload.since ?? null,
      p_dry_run: payload.dryRun ?? true,
    });
    if (error) return { ok: false, error: rpcErrorDetail('admin_backfill_subscription_cancels', error) };
    const row = (Array.isArray(data) ? data[0] : data) as BackfillCancelResult | undefined;
    return row ? { ok: true, result: row } : { ok: false, error: 'empty response' };
  } catch (e) {
    return { ok: false, error: rpcErrorDetail('admin_backfill_subscription_cancels', e) };
  }
}

// ---------- /payment/success 결제 적용 확인 (0046) ----------

export interface MyPaymentStatusRow {
  order_no: string;
  status: 'requested' | 'pending' | 'paid' | 'canceled' | 'cancelled' | 'failed' | 'waiting' | 'refunded';
  user_id: string;
  plan_type: 'individual' | 'business';
  amount: number;
  membership_tier: 'free' | 'individual' | 'business' | null;
  subscription_type: string | null;
  paid_at: string | null;
  refunded_at: string | null;
  membership_applied: boolean;
}

export type MyPaymentStatusResult =
  | { ok: true; row: MyPaymentStatusRow }
  | { ok: false; notFound: true }
  | { ok: false; notFound: false; error: string };

export async function getMyPaymentStatus(orderNo: string): Promise<MyPaymentStatusResult> {
  try {
    const { data, error } = await supabase.rpc('get_my_payment_status', { p_order_no: orderNo });
    if (error) return { ok: false, notFound: false, error: rpcErrorDetail('get_my_payment_status', error) };
    const row = (Array.isArray(data) ? data[0] : data) as MyPaymentStatusRow | undefined;
    if (!row) return { ok: false, notFound: true };
    return { ok: true, row };
  } catch (e) {
    return { ok: false, notFound: false, error: rpcErrorDetail('get_my_payment_status', e) };
  }
}

// ---------- 0047 백필: 기존 webhook event 의 raw_payload 로 원 swk_ order paid 전환 ----------

export interface BackfillPaidByMulNoResult {
  matched_user_id: string | null;
  matched_order_id: string | null;
  matched_order_no: string | null;
  final_membership_tier: string | null;
  message: string;
}

export async function backfillPaidOrderByMulNo(
  mulNo: string,
): Promise<{ ok: boolean; result?: BackfillPaidByMulNoResult; error?: string }> {
  try {
    const { data, error } = await supabase.rpc('admin_backfill_paid_order_by_mul_no', {
      p_mul_no: mulNo,
    });
    if (error) return { ok: false, error: rpcErrorDetail('admin_backfill_paid_order_by_mul_no', error) };
    const row = (Array.isArray(data) ? data[0] : data) as BackfillPaidByMulNoResult | undefined;
    return row ? { ok: true, result: row } : { ok: false, error: 'empty response' };
  } catch (e) {
    return { ok: false, error: rpcErrorDetail('admin_backfill_paid_order_by_mul_no', e) };
  }
}

// ---------- 0048 admin 1-클릭 강제 결제완료 (state=64 미도착 케이스 복구) ----------

export interface ForcePaidByOrderNoResult {
  matched_user_id: string | null;
  matched_order_id: string | null;
  matched_order_no: string | null;
  final_membership_tier: string | null;
  message: string;
}

export async function forcePaidByOrderNo(payload: {
  orderNo: string;
  payappMulNo?: string;
  approvalNo?: string;
}): Promise<{ ok: boolean; result?: ForcePaidByOrderNoResult; error?: string }> {
  try {
    const { data, error } = await supabase.rpc('admin_force_paid_by_order_no', {
      p_order_no: payload.orderNo,
      p_payapp_mul_no: payload.payappMulNo ?? null,
      p_approval_no: payload.approvalNo ?? null,
    });
    if (error) return { ok: false, error: rpcErrorDetail('admin_force_paid_by_order_no', error) };
    const row = (Array.isArray(data) ? data[0] : data) as ForcePaidByOrderNoResult | undefined;
    return row ? { ok: true, result: row } : { ok: false, error: 'empty response' };
  } catch (e) {
    return { ok: false, error: rpcErrorDetail('admin_force_paid_by_order_no', e) };
  }
}
