// supabase/functions/dispatch-subscription-rebill/index.ts
//
// Phase BILLING-SCHEDULER-RECOVERY-1 — 정기결제 자동 재청구(rebillPay) 디스패처(하드닝).
//
// 안전 원칙:
//   • dry_run 기본값 true. Kill Switch(BILLING_REBILL_ENABLED) 가 명확히 참이 아니면
//     요청과 무관하게 dry run 으로 강제(fail-closed).
//   • 실제 청구 대상은 SQL RPC admin_list_rebill_due_v2 가 chargeable=true 로 확정한
//     FUTURE_DUE 만. LEGACY_OVERDUE(과거 누락분)/INVALID/DUPLICATE 는 절대 청구하지 않음.
//   • 서버 플랜 가격을 신뢰(요청 Body 금액 사용 안 함). 개인정보(email/phone)를 PayApp
//     요청/로그에 넣지 않음.
//   • subscription 기간 연장은 오직 webhook(payapp-feedback)만 확정. API 응답으로
//     기간을 연장하지 않음.
//
//   판정 규칙의 단위 테스트는 src/lib/billingRebill.ts / billingRebill.test.ts 참조
//   (이 파일의 resolveKillSwitch/resolveDryRun 은 그 규칙의 미러 구현이다).
//
// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...corsHeaders } });
}

function readEnv() {
  return {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL') ?? '',
    SERVICE_ROLE: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    CRON_SECRET: Deno.env.get('CRON_SECRET') ?? '',
    // Kill Switch — 명확히 'true'/'1' 일 때만 실청구 허용(fail-closed).
    REBILL_ENABLED: Deno.env.get('BILLING_REBILL_ENABLED') ?? '',
    // Legacy 복구 전용 Kill Switch — 미래 Scheduler 스위치와 분리(fail-closed).
    LEGACY_RECOVERY_ENABLED: Deno.env.get('BILLING_LEGACY_RECOVERY_ENABLED') ?? '',
    PAYAPP_USERID: Deno.env.get('PAYAPP_USERID') ?? '',
    PAYAPP_LINKKEY: Deno.env.get('PAYAPP_LINKKEY') ?? '',
    PAYAPP_API_URL: Deno.env.get('PAYAPP_API_URL') ?? 'https://api.payapp.kr/oapi/apiLoad.html',
    PAYAPP_FEEDBACK_BASE_URL: Deno.env.get('PAYAPP_FEEDBACK_BASE_URL') || Deno.env.get('SUPABASE_URL') || '',
  };
}

/** Kill Switch — fail-closed. 값이 명확히 참이 아니면 false. (billingRebill.ts 미러) */
function resolveKillSwitch(raw: string): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  return v === 'true' || v === '1';
}
/** dry_run 결정 — 기본 true, Kill Switch off 면 항상 true. (billingRebill.ts 미러) */
function resolveDryRun(body: { dry_run?: boolean } | null, killSwitch: boolean): boolean {
  if (!killSwitch) return true;
  return body?.dry_run !== false;
}
function resolveMode(raw: unknown): 'future_due' | 'legacy_review' | 'legacy_single_cycle_recovery' {
  if (raw === 'legacy_review') return 'legacy_review';
  if (raw === 'legacy_single_cycle_recovery') return 'legacy_single_cycle_recovery';
  return 'future_due';
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REBILL_TIMEOUT_MS = 15_000;

interface DueRowV2 {
  subscription_id: string; user_id: string; plan_type: string; plan_name: string | null;
  amount: number; current_period_end: string; cycle_period_end: string;
  has_rebill_no: boolean; auto_renew: boolean; sub_status: string;
  classification: 'FUTURE_DUE' | 'LEGACY_OVERDUE' | 'INVALID_REBILL' | 'DUPLICATE_BLOCKED';
  chargeable: boolean; exclude_reason: string;
}

async function rpc<T>(env: ReturnType<typeof readEnv>, fn: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: env.SERVICE_ROLE, Authorization: `Bearer ${env.SERVICE_ROLE}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`RPC ${fn} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

function anonId(id: string): string {
  return id.slice(0, 8);
}
function orderNoFor(subId: string, executionId: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `swk_rebill_${subId.slice(0, 8)}_${executionId.slice(0, 8)}_${ts}_${rand}`;
}

async function insertOrder(env: ReturnType<typeof readEnv>, row: { user_id: string; subscription_id: string; order_no: string; plan_type: string; amount: number }): Promise<void> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/payment_orders`, {
    method: 'POST',
    headers: { apikey: env.SERVICE_ROLE, Authorization: `Bearer ${env.SERVICE_ROLE}`, 'content-type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: row.user_id, subscription_id: row.subscription_id, order_no: row.order_no, plan_type: row.plan_type, amount: row.amount, status: 'requested' }),
  });
  if (!res.ok) throw new Error(`order insert failed: ${res.status} ${await res.text()}`);
}

async function stampCharge(env: ReturnType<typeof readEnv>, chargeId: string, executionId: string, orderNo: string): Promise<void> {
  await fetch(`${env.SUPABASE_URL}/rest/v1/subscription_rebill_charges?id=eq.${chargeId}`, {
    method: 'PATCH',
    headers: { apikey: env.SERVICE_ROLE, Authorization: `Bearer ${env.SERVICE_ROLE}`, 'content-type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ execution_id: executionId, provider: 'payapp', operation_type: 'rebill', order_no: orderNo }),
  }).catch(() => undefined);
}

async function rebillPay(env: ReturnType<typeof readEnv>, d: DueRowV2, orderNo: string): Promise<{ ok: boolean; state: string; raw: Record<string, string> }> {
  // 서버 플랜 가격만 사용. recvemail/recvphone(개인정보)은 전송하지 않음 — 영수증은
  // PayApp 에 등록된 정기결제 프로파일이 처리.
  const params = new URLSearchParams();
  params.set('cmd', 'rebillPay');
  params.set('userid', env.PAYAPP_USERID);
  params.set('linkkey', env.PAYAPP_LINKKEY);
  params.set('rebill_no', ''); // rebill_no 는 chargeable 대상에 대해 별도 서버 조회로 주입(아래 참조)
  params.set('goodname', d.plan_name ?? '듣다 정기이용권');
  params.set('goodprice', String(d.amount));
  params.set('price', String(d.amount));
  params.set('feedbackurl', `${env.PAYAPP_FEEDBACK_BASE_URL}/functions/v1/payapp-feedback`);
  params.set('var1', orderNo);
  params.set('var2', d.subscription_id);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REBILL_TIMEOUT_MS);
  try {
    const resp = await fetch(env.PAYAPP_API_URL, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(), signal: ctrl.signal,
    });
    const raw = Object.fromEntries(new URLSearchParams(await resp.text()).entries());
    return { ok: raw.state === '1', state: raw.state ?? '', raw };
  } finally {
    clearTimeout(timer);
  }
}

/** rebill_no 는 개인정보 아님이나 RPC v2 가 반환하지 않으므로, 청구 직전 대상 1건만
 *  service_role 로 직접 조회해 주입(최소권한·최소노출). */
async function fetchRebillNo(env: ReturnType<typeof readEnv>, subscriptionId: string): Promise<string | null> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/subscriptions?id=eq.${subscriptionId}&select=payapp_rebill_no,status,auto_renew`, {
    method: 'GET', headers: { apikey: env.SERVICE_ROLE, Authorization: `Bearer ${env.SERVICE_ROLE}` },
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as Array<{ payapp_rebill_no: string | null; status: string; auto_renew: boolean }>;
  const r = rows[0];
  if (!r || r.status !== 'active' || r.auto_renew !== true) return null;
  return r.payapp_rebill_no && r.payapp_rebill_no.trim().length > 0 ? r.payapp_rebill_no : null;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const env = readEnv();
  const cronSecret = req.headers.get('x-cron-secret') ?? '';
  const authHeader = req.headers.get('authorization') ?? '';
  const isCron = !!env.CRON_SECRET && cronSecret === env.CRON_SECRET;
  const isServiceRole = !!env.SERVICE_ROLE && authHeader === `Bearer ${env.SERVICE_ROLE}`;
  if (!isCron && !isServiceRole) return json({ error: 'unauthorized' }, 401);
  if (!env.SUPABASE_URL || !env.SERVICE_ROLE) return json({ error: 'supabase_env_missing' }, 500);

  let body: { dry_run?: boolean; limit?: number; subscription_ids?: string[]; execution_id?: string; mode?: string } = {};
  try { body = await req.json(); } catch { /* empty ok → dry run */ }

  const killSwitch = resolveKillSwitch(env.REBILL_ENABLED);
  const dryRun = resolveDryRun(body, killSwitch);
  const mode = resolveMode(body.mode);
  const rawLimit = typeof body.limit === 'number' && Number.isFinite(body.limit) ? Math.floor(body.limit) : 20;
  const limit = Math.min(Math.max(1, rawLimit), 100);
  const explicitIds = Array.isArray(body.subscription_ids) ? body.subscription_ids.filter((s) => UUID_RE.test(s)) : null;
  const executionId = (typeof body.execution_id === 'string' && body.execution_id.trim()) ? body.execution_id.trim().slice(0, 80)
    : `exec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  // ── Legacy 단일 주기 복구 모드 (별도 Kill Switch, 미래 Scheduler 와 분리) ──
  if (mode === 'legacy_single_cycle_recovery') {
    const legacyKill = resolveKillSwitch(env.LEGACY_RECOVERY_ENABLED);
    const recDryRun = !legacyKill || body.dry_run !== false;
    const ids = explicitIds ?? [];
    if (ids.length === 0) return json({ error: 'subscription_ids_required_for_recovery' }, 400);
    let cands: Array<{ subscription_id: string; user_id: string; plan_type: string; amount: number }> = [];
    try { cands = await rpc(env, 'legacy_recovery_charge_candidates', { p_subscription_ids: ids }); }
    catch (e) { return json({ error: 'recovery_query_failed', detail: String(e) }, 500); }
    const recTargets = cands.slice(0, limit);
    if (recDryRun) {
      return json({
        ok: true, mode, dry_run: true, legacy_recovery_enabled: legacyKill, execution_id: executionId,
        ran_at: new Date().toISOString(),
        would_charge: recTargets.map((d) => ({ subscription_id: anonId(d.subscription_id), plan_type: d.plan_type, amount: d.amount })),
        would_charge_total: recTargets.reduce((s, d) => s + d.amount, 0),
      });
    }
    if (!env.PAYAPP_USERID || !env.PAYAPP_LINKKEY) return json({ error: 'payapp_credentials_missing' }, 500);
    const recResults: Array<Record<string, unknown>> = [];
    for (const d of recTargets) {
      const r: Record<string, unknown> = { subscription_id: anonId(d.subscription_id), amount: d.amount };
      try {
        const chargeId = await rpc<string | null>(env, 'record_legacy_recovery_attempt', {
          p_subscription_id: d.subscription_id, p_user_id: d.user_id, p_amount: d.amount, p_plan_type: d.plan_type, p_execution_id: executionId,
        });
        if (!chargeId) { r.status = 'skipped_duplicate_recovery'; recResults.push(r); continue; }
        const rebillNo = await fetchRebillNo(env, d.subscription_id);
        if (!rebillNo) {
          await rpc(env, 'mark_rebill_charge_result', { p_charge_id: chargeId, p_status: 'skipped', p_error: 'missing_rebill_no_at_charge_time' });
          r.status = 'skipped_missing_rebill_no'; recResults.push(r); continue;
        }
        const orderNo = `swk_recovery_${d.subscription_id.slice(0, 8)}_${executionId.slice(0, 8)}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        await stampCharge(env, chargeId, executionId, orderNo);
        await insertOrder(env, { user_id: d.user_id, subscription_id: d.subscription_id, order_no: orderNo, plan_type: d.plan_type, amount: d.amount });
        await rpc(env, 'mark_rebill_charge_result', { p_charge_id: chargeId, p_status: 'requesting', p_payapp_raw: { order_no: orderNo, execution_id: executionId } });
        const dRow = { subscription_id: d.subscription_id, plan_name: null, amount: d.amount } as unknown as DueRowV2;
        let pay: { ok: boolean; state: string; raw: Record<string, string> };
        try { pay = await rebillPay(env, dRow, orderNo); }
        catch (e) {
          await rpc(env, 'mark_rebill_charge_result', { p_charge_id: chargeId, p_status: 'unknown', p_error: String(e) });
          r.status = 'unknown_pending_reconciliation'; r.order_no = orderNo; recResults.push(r); continue;
        }
        if (pay.ok) {
          await rpc(env, 'mark_rebill_charge_result', { p_charge_id: chargeId, p_status: 'awaiting_webhook', p_payapp_state: pay.state, p_payapp_raw: pay.raw });
          r.status = 'accepted_awaiting_webhook';
        } else {
          await rpc(env, 'mark_rebill_charge_result', { p_charge_id: chargeId, p_status: 'provider_rejected', p_payapp_state: pay.state, p_payapp_raw: pay.raw, p_error: pay.raw.errorMessage ?? 'rebillPay rejected' });
          await fetch(`${env.SUPABASE_URL}/rest/v1/payment_orders?order_no=eq.${encodeURIComponent(orderNo)}`, {
            method: 'PATCH', headers: { apikey: env.SERVICE_ROLE, Authorization: `Bearer ${env.SERVICE_ROLE}`, 'content-type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({ status: 'failed', raw_response: pay.raw }),
          }).catch(() => undefined);
          r.status = 'provider_rejected';
        }
        r.order_no = orderNo; r.payapp_state = pay.state;
      } catch (e) { r.status = 'error'; r.error = String(e); }
      recResults.push(r);
    }
    return json({
      ok: true, mode, dry_run: false, legacy_recovery_enabled: legacyKill, execution_id: executionId,
      ran_at: new Date().toISOString(), attempted: recTargets.length,
      accepted: recResults.filter((r) => r.status === 'accepted_awaiting_webhook').length,
      rejected: recResults.filter((r) => r.status === 'provider_rejected').length,
      unknown: recResults.filter((r) => r.status === 'unknown_pending_reconciliation').length,
      skipped: recResults.filter((r) => String(r.status).startsWith('skipped')).length,
      results: recResults,
    });
  }

  // 대상 분류 조회(서버 확정). cutover 는 SQL 기본값(고정 상수) 사용.
  let all: DueRowV2[] = [];
  try { all = await rpc<DueRowV2[]>(env, 'admin_list_rebill_due_v2', { p_grace_days: 0 }); }
  catch (e) { return json({ error: 'classification_query_failed', detail: String(e) }, 500); }

  const byCls = (c: string) => all.filter((d) => d.classification === c);
  const summary = {
    future_due: byCls('FUTURE_DUE').length,
    legacy_overdue: byCls('LEGACY_OVERDUE').length,
    invalid_rebill: byCls('INVALID_REBILL').length,
    duplicate_blocked: byCls('DUPLICATE_BLOCKED').length,
    future_due_amount: byCls('FUTURE_DUE').reduce((s, d) => s + d.amount, 0),
  };

  // legacy_review 모드 — 절대 청구하지 않음. 격리 목록만 반환.
  if (mode === 'legacy_review') {
    return json({
      ok: true, mode, dry_run: true, kill_switch: killSwitch, execution_id: executionId,
      ran_at: new Date().toISOString(), summary,
      legacy: byCls('LEGACY_OVERDUE').map((d) => ({
        subscription_id: anonId(d.subscription_id), plan_type: d.plan_type,
        amount: d.amount, cycle_period_end: d.cycle_period_end,
        status: 'skipped', reason: 'legacy_overdue_requires_manual_policy',
      })),
    });
  }

  // 청구 후보 = FUTURE_DUE & chargeable 만. (explicitIds 있어도 서버 chargeable 재검증)
  let targets = all.filter((d) => d.classification === 'FUTURE_DUE' && d.chargeable === true);
  if (explicitIds && explicitIds.length > 0) {
    const set = new Set(explicitIds);
    targets = targets.filter((d) => set.has(d.subscription_id));
  }
  targets = targets.slice(0, limit);

  if (dryRun) {
    return json({
      ok: true, mode, dry_run: true, kill_switch: killSwitch, execution_id: executionId,
      ran_at: new Date().toISOString(), summary,
      would_charge: targets.map((d) => ({
        subscription_id: anonId(d.subscription_id), plan_type: d.plan_type,
        amount: d.amount, cycle_period_end: d.cycle_period_end,
      })),
      would_charge_total: targets.reduce((s, d) => s + d.amount, 0),
      excluded: {
        legacy_overdue: byCls('LEGACY_OVERDUE').length,
        invalid_rebill: byCls('INVALID_REBILL').map((d) => ({ subscription_id: anonId(d.subscription_id), reason: d.exclude_reason })),
        duplicate_blocked: byCls('DUPLICATE_BLOCKED').length,
      },
    });
  }

  // ── 실청구 경로 (Kill Switch ON + dry_run=false + mode future_due) ──
  if (!env.PAYAPP_USERID || !env.PAYAPP_LINKKEY) return json({ error: 'payapp_credentials_missing' }, 500);

  const results: Array<Record<string, unknown>> = [];
  for (const d of targets) {
    const r: Record<string, unknown> = { subscription_id: anonId(d.subscription_id), amount: d.amount };
    try {
      const chargeId = await rpc<string | null>(env, 'record_rebill_charge_attempt', {
        p_subscription_id: d.subscription_id, p_user_id: d.user_id, p_rebill_no: null,
        p_amount: d.amount, p_plan_type: d.plan_type, p_cycle_period_end: d.cycle_period_end, p_order_no: null,
      });
      if (!chargeId) { r.status = 'skipped_duplicate_cycle'; results.push(r); continue; }

      const rebillNo = await fetchRebillNo(env, d.subscription_id);
      if (!rebillNo) {
        await rpc(env, 'mark_rebill_charge_result', { p_charge_id: chargeId, p_status: 'skipped', p_error: 'missing_rebill_no_at_charge_time' });
        r.status = 'skipped_missing_rebill_no'; results.push(r); continue;
      }

      const orderNo = orderNoFor(d.subscription_id, executionId);
      await stampCharge(env, chargeId, executionId, orderNo);
      await insertOrder(env, { user_id: d.user_id, subscription_id: d.subscription_id, order_no: orderNo, plan_type: d.plan_type, amount: d.amount });
      await rpc(env, 'mark_rebill_charge_result', { p_charge_id: chargeId, p_status: 'requesting', p_payapp_raw: { order_no: orderNo, execution_id: executionId } });

      let pay: { ok: boolean; state: string; raw: Record<string, string> };
      try {
        pay = await rebillPay({ ...env, PAYAPP_LINKKEY: env.PAYAPP_LINKKEY }, { ...d }, orderNo);
      } catch (e) {
        // Timeout / 네트워크 불명확 → 즉시 재시도하지 않고 unknown 으로 두어 reconciliation 대상화.
        await rpc(env, 'mark_rebill_charge_result', { p_charge_id: chargeId, p_status: 'unknown', p_error: String(e) });
        r.status = 'unknown_pending_reconciliation'; r.order_no = orderNo; results.push(r); continue;
      }

      if (pay.ok) {
        await rpc(env, 'mark_rebill_charge_result', { p_charge_id: chargeId, p_status: 'awaiting_webhook', p_payapp_state: pay.state, p_payapp_raw: pay.raw });
        r.status = 'accepted_awaiting_webhook';
      } else {
        await rpc(env, 'mark_rebill_charge_result', { p_charge_id: chargeId, p_status: 'provider_rejected', p_payapp_state: pay.state, p_payapp_raw: pay.raw, p_error: pay.raw.errorMessage ?? pay.raw.errmsg ?? 'rebillPay rejected' });
        await fetch(`${env.SUPABASE_URL}/rest/v1/payment_orders?order_no=eq.${encodeURIComponent(orderNo)}`, {
          method: 'PATCH', headers: { apikey: env.SERVICE_ROLE, Authorization: `Bearer ${env.SERVICE_ROLE}`, 'content-type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ status: 'failed', raw_response: pay.raw }),
        }).catch(() => undefined);
        r.status = 'provider_rejected';
      }
      r.order_no = orderNo; r.payapp_state = pay.state;
    } catch (e) {
      r.status = 'error'; r.error = String(e);
    }
    results.push(r);
  }

  return json({
    ok: true, mode, dry_run: false, kill_switch: killSwitch, execution_id: executionId,
    ran_at: new Date().toISOString(), summary,
    attempted: targets.length,
    accepted: results.filter((r) => r.status === 'accepted_awaiting_webhook').length,
    rejected: results.filter((r) => r.status === 'provider_rejected').length,
    unknown: results.filter((r) => r.status === 'unknown_pending_reconciliation').length,
    skipped: results.filter((r) => String(r.status).startsWith('skipped')).length,
    results,
  });
});
