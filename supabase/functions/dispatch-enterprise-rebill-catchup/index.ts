// dispatch-enterprise-rebill-catchup — 엔터프라이즈 밀린 회차 소급 청구 디스패처
//
// 안전 게이트 (전부 fail-closed):
//   1) x-cron-secret 또는 service_role Bearer 없으면 401.
//   2) dry_run 기본값 true. 킬스위치 BILLING_ENTERPRISE_REBILL_ENABLED 가 명확히
//      참이 아니면 요청이 뭐라 하든 dry run 으로 강등된다.
//      ※ 소비자용 BILLING_REBILL_ENABLED 와 **별도 스위치**다. 소비자 청구가 켜져 있어도
//        엔터프라이즈는 이 값을 따로 켜지 않는 한 절대 카드를 긁지 않는다.
//   3) 청구 대상은 SQL RPC admin_list_enterprise_catchup_cycles 가 chargeable=true 로
//      확정한 회차만. 엣지는 그 목록을 좁히기만 할 뿐 넓히지 못한다.
//   4) (구독, 회차) 멱등키 — record_enterprise_rebill_charge_attempt 가 중복을 막는다.
//
// 개인정보: 응답/로그에 이메일·전화·rebill_no 를 싣지 않는다(구독 id 앞 8자만).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const REBILL_TIMEOUT_MS = 15_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readEnv() {
  return {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL') ?? '',
    SERVICE_ROLE: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    CRON_SECRET: Deno.env.get('CRON_SECRET') ?? '',
    REBILL_ENABLED: Deno.env.get('BILLING_ENTERPRISE_REBILL_ENABLED') ?? '',
    PAYAPP_USERID: Deno.env.get('PAYAPP_USERID') ?? '',
    PAYAPP_LINKKEY: Deno.env.get('PAYAPP_LINKKEY') ?? '',
    PAYAPP_API_URL: Deno.env.get('PAYAPP_API_URL') ?? 'https://api.payapp.kr/oapi/apiLoad.html',
    PAYAPP_FEEDBACK_BASE_URL: Deno.env.get('PAYAPP_FEEDBACK_BASE_URL') || Deno.env.get('SUPABASE_URL') || '',
  };
}
type Env = ReturnType<typeof readEnv>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status, headers: { 'content-type': 'application/json', ...corsHeaders },
  });
}

/** 킬스위치 — 'true'/'1' 이 아니면 항상 false (fail-closed). */
function killSwitchOn(raw: string): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  return v === 'true' || v === '1';
}
function anonId(id: string): string { return id.slice(0, 8); }

async function rpc<T>(env: Env, fn: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: env.SERVICE_ROLE, Authorization: `Bearer ${env.SERVICE_ROLE}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`RPC ${fn} failed: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return (text.trim().length > 0 ? JSON.parse(text) : null) as T;
}

interface CatchupCycle {
  subscription_id: string; payer_user_id: string; enterprise_account_id: string;
  payer_type: string; store_label: string; amount: number; rebill_no: string | null;
  current_period_end: string; cycle_period_end: string;
  cycle_index: number; cycles_owed: number; chargeable: boolean; exclude_reason: string;
}

/** 청구 직전 재확인 — 상태가 바뀌었으면(해지 등) null → 청구 중단. */
async function fetchLiveRebillNo(env: Env, subscriptionId: string): Promise<string | null> {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/enterprise_payment_subscriptions?id=eq.${subscriptionId}&select=payapp_rebill_no,status`,
    { headers: { apikey: env.SERVICE_ROLE, Authorization: `Bearer ${env.SERVICE_ROLE}` } },
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as Array<{ payapp_rebill_no: string | null; status: string }>;
  const r = rows[0];
  if (!r || r.status !== 'active') return null;
  return r.payapp_rebill_no && r.payapp_rebill_no.trim().length > 0 ? r.payapp_rebill_no : null;
}

async function rebillPay(env: Env, args: {
  rebillNo: string; amount: number; goodname: string; orderNo: string; subscriptionId: string;
}): Promise<{ ok: boolean; state: string; raw: Record<string, string> }> {
  const params = new URLSearchParams();
  params.set('cmd', 'rebillPay');
  params.set('userid', env.PAYAPP_USERID);
  params.set('linkkey', env.PAYAPP_LINKKEY);
  params.set('rebill_no', args.rebillNo);
  params.set('goodname', args.goodname);
  params.set('goodprice', String(args.amount));
  params.set('price', String(args.amount));
  params.set('feedbackurl', `${env.PAYAPP_FEEDBACK_BASE_URL}/functions/v1/enterprise-payment-feedback`);
  params.set('var1', args.orderNo);
  params.set('var2', args.subscriptionId);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REBILL_TIMEOUT_MS);
  try {
    const resp = await fetch(env.PAYAPP_API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(), signal: ctrl.signal,
    });
    const raw = Object.fromEntries(new URLSearchParams(await resp.text()).entries());
    return { ok: raw.state === '1', state: raw.state ?? '', raw };
  } finally { clearTimeout(timer); }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const env = readEnv();
  const isCron = !!env.CRON_SECRET && (req.headers.get('x-cron-secret') ?? '') === env.CRON_SECRET;
  const isServiceRole = !!env.SERVICE_ROLE && (req.headers.get('authorization') ?? '') === `Bearer ${env.SERVICE_ROLE}`;
  if (!isCron && !isServiceRole) return json({ error: 'unauthorized' }, 401);
  if (!env.SUPABASE_URL || !env.SERVICE_ROLE) return json({ error: 'supabase_env_missing' }, 500);

  let body: { dry_run?: boolean; limit?: number; max_cycles?: number; grace_days?: number; subscription_ids?: string[]; execution_id?: string } = {};
  try { body = await req.json(); } catch { /* 빈 body → dry run */ }

  const kill = killSwitchOn(env.REBILL_ENABLED);
  const dryRun = !kill || body.dry_run !== false;   // 킬스위치 off → 무조건 dry run
  const rawLimit = typeof body.limit === 'number' && Number.isFinite(body.limit) ? Math.floor(body.limit) : 20;
  const limit = Math.min(Math.max(1, rawLimit), 100);
  const maxCycles = Math.min(Math.max(1, Math.floor(body.max_cycles ?? 6)), 24);
  const graceDays = Math.min(Math.max(0, Math.floor(body.grace_days ?? 2)), 30);
  const ids = Array.isArray(body.subscription_ids) ? body.subscription_ids.filter((s) => UUID_RE.test(s)) : null;
  const executionId = (typeof body.execution_id === 'string' && body.execution_id.trim())
    ? body.execution_id.trim().slice(0, 80)
    : `entcatchup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  let cycles: CatchupCycle[] = [];
  try {
    cycles = await rpc<CatchupCycle[]>(env, 'admin_list_enterprise_catchup_cycles', {
      p_subscription_ids: ids && ids.length > 0 ? ids : null,
      p_max_cycles: maxCycles,
      p_grace_days: graceDays,
    }) ?? [];
  } catch (e) {
    return json({ error: 'catchup_query_failed', detail: String(e) }, 500);
  }

  const excluded: Record<string, number> = {};
  for (const c of cycles) if (!c.chargeable) excluded[c.exclude_reason || 'unknown'] = (excluded[c.exclude_reason || 'unknown'] ?? 0) + 1;
  const targets = cycles.filter((c) => c.chargeable).slice(0, limit);
  const summary = {
    cycles_total: cycles.length,
    chargeable_cycles: cycles.filter((c) => c.chargeable).length,
    chargeable_subscriptions: new Set(cycles.filter((c) => c.chargeable).map((c) => c.subscription_id)).size,
    chargeable_amount: cycles.filter((c) => c.chargeable).reduce((s, c) => s + c.amount, 0),
    excluded,
  };

  if (dryRun) {
    return json({
      ok: true, mode: 'enterprise_catchup', dry_run: true, kill_switch: kill,
      kill_switch_env: 'BILLING_ENTERPRISE_REBILL_ENABLED',
      execution_id: executionId, ran_at: new Date().toISOString(), summary,
      would_charge: targets.map((c) => ({
        subscription_id: anonId(c.subscription_id), store_label: c.store_label,
        payer_type: c.payer_type, amount: c.amount,
        cycle_period_end: c.cycle_period_end, cycle: `${c.cycle_index}/${c.cycles_owed}`,
      })),
      would_charge_total: targets.reduce((s, c) => s + c.amount, 0),
    });
  }

  if (!env.PAYAPP_USERID || !env.PAYAPP_LINKKEY) return json({ error: 'payapp_credentials_missing' }, 500);

  const results: Array<Record<string, unknown>> = [];
  for (const c of targets) {
    const r: Record<string, unknown> = {
      subscription_id: anonId(c.subscription_id), amount: c.amount,
      cycle_period_end: c.cycle_period_end, cycle: `${c.cycle_index}/${c.cycles_owed}`,
    };
    try {
      const rebillNo = await fetchLiveRebillNo(env, c.subscription_id);
      if (!rebillNo) { r.status = 'skipped_missing_rebill_no'; results.push(r); continue; }

      const orderNo = `entcatchup_${c.subscription_id.slice(0, 8)}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const chargeId = await rpc<string | null>(env, 'record_enterprise_rebill_charge_attempt', {
        p_subscription_id: c.subscription_id, p_payer_user_id: c.payer_user_id, p_rebill_no: rebillNo,
        p_amount: c.amount, p_cycle_period_end: c.cycle_period_end,
        p_order_no: orderNo, p_execution_id: executionId,
      });
      if (!chargeId) { r.status = 'skipped_duplicate_cycle'; results.push(r); continue; }

      let pay: { ok: boolean; state: string; raw: Record<string, string> };
      try {
        pay = await rebillPay(env, {
          rebillNo, amount: c.amount,
          goodname: `${c.payer_type === 'hq' ? '본사' : '가맹'} 월 구독(소급)`,
          orderNo, subscriptionId: c.subscription_id,
        });
      } catch (e) {
        await rpc(env, 'mark_enterprise_rebill_charge_result', { p_charge_id: chargeId, p_status: 'unknown', p_error: String(e) });
        r.status = 'unknown_pending_reconciliation'; r.order_no = orderNo; results.push(r); continue;
      }

      if (pay.ok) {
        await rpc(env, 'mark_enterprise_rebill_charge_result', {
          p_charge_id: chargeId, p_status: 'awaiting_webhook', p_payapp_state: pay.state, p_payapp_raw: pay.raw,
        });
        r.status = 'accepted_awaiting_webhook';
      } else {
        await rpc(env, 'mark_enterprise_rebill_charge_result', {
          p_charge_id: chargeId, p_status: 'provider_rejected', p_payapp_state: pay.state,
          p_payapp_raw: pay.raw, p_error: pay.raw.errorMessage ?? pay.raw.errormessage ?? 'rebillPay rejected',
        });
        r.status = 'provider_rejected';
        r.payapp_error = pay.raw.errorMessage ?? pay.raw.errormessage ?? null;
      }
      r.order_no = orderNo;
      r.payapp_state = pay.state;
    } catch (e) {
      r.status = 'error'; r.error = String(e);
    }
    results.push(r);
  }

  return json({
    ok: true, mode: 'enterprise_catchup', dry_run: false, kill_switch: kill,
    execution_id: executionId, ran_at: new Date().toISOString(), summary,
    attempted: targets.length,
    accepted: results.filter((r) => r.status === 'accepted_awaiting_webhook').length,
    rejected: results.filter((r) => r.status === 'provider_rejected').length,
    unknown: results.filter((r) => r.status === 'unknown_pending_reconciliation').length,
    skipped: results.filter((r) => String(r.status).startsWith('skipped')).length,
    results,
  });
});
