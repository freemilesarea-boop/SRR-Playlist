// supabase/functions/dispatch-rebill-catchup/index.ts
//
// 밀린 정기결제 회차 소급 청구 디스패처.
//
// 왜 별도 함수인가:
//   dispatch-subscription-rebill 은 "현재 1회차" 만 청구한다. 결제 성공 webhook 이
//   current_period_end 를 결제시각+1개월로 밀어버려서, 재실행해도 밀린 과거 회차는
//   영원히 청구되지 않는다. 운영 판단(밀린 개월 수 전부 소급)을 위해 회차를 명시적으로
//   전개해서 청구한다. 기존 청구 경로는 건드리지 않는다(회귀 격리).
//
// 안전 게이트 (전부 fail-closed):
//   1) x-cron-secret 또는 service_role Bearer 없으면 401.
//   2) dry_run 기본값 true. Kill Switch(BILLING_REBILL_ENABLED)가 명확히 참이 아니면
//      요청이 뭐라 하든 dry run 으로 강등된다.
//   3) 청구 대상은 SQL RPC admin_list_catchup_cycles 가 chargeable=true 로 확정한
//      회차만. Edge 는 그 목록을 좁히기만 할 뿐 넓히지 못한다.
//   4) (구독, 회차) 멱등키 — record_rebill_charge_attempt 가 중복을 막는다.
//      같은 회차를 두 번 청구하는 것은 구조적으로 불가능하다.
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
    REBILL_ENABLED: Deno.env.get('BILLING_REBILL_ENABLED') ?? '',
    PAYAPP_USERID: Deno.env.get('PAYAPP_USERID') ?? '',
    PAYAPP_LINKKEY: Deno.env.get('PAYAPP_LINKKEY') ?? '',
    PAYAPP_API_URL: Deno.env.get('PAYAPP_API_URL') ?? 'https://api.payapp.kr/oapi/apiLoad.html',
    PAYAPP_FEEDBACK_BASE_URL: Deno.env.get('PAYAPP_FEEDBACK_BASE_URL') || Deno.env.get('SUPABASE_URL') || '',
  };
}
type Env = ReturnType<typeof readEnv>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders },
  });
}

/** Kill Switch — 'true'/'1' 이 아니면 항상 false (fail-closed). */
function killSwitchOn(raw: string): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  return v === 'true' || v === '1';
}

function anonId(id: string): string {
  return id.slice(0, 8);
}

async function rpc<T>(env: Env, fn: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: env.SERVICE_ROLE, Authorization: `Bearer ${env.SERVICE_ROLE}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`RPC ${fn} failed: ${res.status} ${await res.text()}`);
  // void 반환 RPC(mark_rebill_charge_result 등)는 본문이 비어 있다. res.json() 을 그대로
  // 부르면 "Unexpected end of JSON input" 으로 죽으면서, 이미 성공한 호출을 실패로 만든다.
  const text = await res.text();
  return (text.trim().length > 0 ? JSON.parse(text) : null) as T;
}

interface CatchupCycle {
  subscription_id: string;
  user_id: string;
  plan_type: string;
  amount: number;
  current_period_end: string;
  cycle_period_end: string;
  cycle_index: number;
  cycles_owed: number;
  chargeable: boolean;
  exclude_reason: string;
}

/** 청구 직전 1건만 조회. 상태가 바뀌었으면(해지 등) null → 청구 중단. */
async function fetchRebillNo(env: Env, subscriptionId: string): Promise<string | null> {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/subscriptions?id=eq.${subscriptionId}&select=payapp_rebill_no,status,auto_renew,cancel_requested_at`,
    { method: 'GET', headers: { apikey: env.SERVICE_ROLE, Authorization: `Bearer ${env.SERVICE_ROLE}` } },
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as Array<{
    payapp_rebill_no: string | null; status: string; auto_renew: boolean; cancel_requested_at: string | null;
  }>;
  const r = rows[0];
  if (!r || r.status !== 'active' || r.auto_renew !== true || r.cancel_requested_at !== null) return null;
  return r.payapp_rebill_no && r.payapp_rebill_no.trim().length > 0 ? r.payapp_rebill_no : null;
}

async function insertOrder(env: Env, row: {
  user_id: string; subscription_id: string; order_no: string; plan_type: string; amount: number;
}): Promise<void> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/payment_orders`, {
    method: 'POST',
    headers: {
      apikey: env.SERVICE_ROLE, Authorization: `Bearer ${env.SERVICE_ROLE}`,
      'content-type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify({ ...row, status: 'requested' }),
  });
  if (!res.ok) throw new Error(`order insert failed: ${res.status} ${await res.text()}`);
}

async function stampCharge(env: Env, chargeId: string, executionId: string, orderNo: string): Promise<void> {
  await fetch(`${env.SUPABASE_URL}/rest/v1/subscription_rebill_charges?id=eq.${chargeId}`, {
    method: 'PATCH',
    headers: {
      apikey: env.SERVICE_ROLE, Authorization: `Bearer ${env.SERVICE_ROLE}`,
      'content-type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify({ execution_id: executionId, provider: 'payapp', operation_type: 'rebill_catchup', order_no: orderNo }),
  }).catch(() => undefined);
}

/**
 * PayApp 정기결제 즉시 청구.
 * 금액은 서버 플랜가(RPC 확정값)만 사용하고, rebill_no 를 반드시 실어 보낸다.
 */
async function rebillPay(
  env: Env,
  args: { rebillNo: string; amount: number; goodname: string; orderNo: string; subscriptionId: string },
): Promise<{ ok: boolean; state: string; raw: Record<string, string> }> {
  const params = new URLSearchParams();
  params.set('cmd', 'rebillPay');
  params.set('userid', env.PAYAPP_USERID);
  params.set('linkkey', env.PAYAPP_LINKKEY);
  params.set('rebill_no', args.rebillNo);
  params.set('goodname', args.goodname);
  params.set('goodprice', String(args.amount));
  params.set('price', String(args.amount));
  params.set('feedbackurl', `${env.PAYAPP_FEEDBACK_BASE_URL}/functions/v1/payapp-feedback`);
  params.set('var1', args.orderNo);
  params.set('var2', args.subscriptionId);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REBILL_TIMEOUT_MS);
  try {
    const resp = await fetch(env.PAYAPP_API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: ctrl.signal,
    });
    const raw = Object.fromEntries(new URLSearchParams(await resp.text()).entries());
    return { ok: raw.state === '1', state: raw.state ?? '', raw };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const env = readEnv();
  const isCron = !!env.CRON_SECRET && (req.headers.get('x-cron-secret') ?? '') === env.CRON_SECRET;
  const isServiceRole = !!env.SERVICE_ROLE && (req.headers.get('authorization') ?? '') === `Bearer ${env.SERVICE_ROLE}`;
  if (!isCron && !isServiceRole) return json({ error: 'unauthorized' }, 401);
  if (!env.SUPABASE_URL || !env.SERVICE_ROLE) return json({ error: 'supabase_env_missing' }, 500);

  let body: {
    dry_run?: boolean; limit?: number; max_cycles?: number;
    subscription_ids?: string[]; execution_id?: string;
  } = {};
  try { body = await req.json(); } catch { /* 빈 body → dry run */ }

  const kill = killSwitchOn(env.REBILL_ENABLED);
  const dryRun = !kill || body.dry_run !== false;   // Kill Switch off → 무조건 dry run
  const rawLimit = typeof body.limit === 'number' && Number.isFinite(body.limit) ? Math.floor(body.limit) : 20;
  const limit = Math.min(Math.max(1, rawLimit), 100);
  const maxCycles = Math.min(Math.max(1, Math.floor(body.max_cycles ?? 6)), 24);
  const ids = Array.isArray(body.subscription_ids) ? body.subscription_ids.filter((s) => UUID_RE.test(s)) : null;
  const executionId = (typeof body.execution_id === 'string' && body.execution_id.trim())
    ? body.execution_id.trim().slice(0, 80)
    : `catchup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  let cycles: CatchupCycle[] = [];
  try {
    cycles = await rpc<CatchupCycle[]>(env, 'admin_list_catchup_cycles', {
      p_subscription_ids: ids && ids.length > 0 ? ids : null,
      p_max_cycles: maxCycles,
    });
  } catch (e) {
    return json({ error: 'catchup_query_failed', detail: String(e) }, 500);
  }

  const excluded: Record<string, number> = {};
  for (const c of cycles) {
    if (!c.chargeable) excluded[c.exclude_reason] = (excluded[c.exclude_reason] ?? 0) + 1;
  }
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
      ok: true, mode: 'catchup', dry_run: true, kill_switch: kill,
      execution_id: executionId, ran_at: new Date().toISOString(), summary,
      would_charge: targets.map((c) => ({
        subscription_id: anonId(c.subscription_id), plan_type: c.plan_type, amount: c.amount,
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
      // rebill_no 를 먼저 확보한다. subscription_rebill_charges.rebill_no 는 NOT NULL 이라
      // 이 값 없이는 청구 기록 자체를 만들 수 없다(= 청구도 못 한다). 겸사겸사 청구 직전
      // 구독 상태(active/auto_renew/해지요청 없음)도 여기서 재확인된다.
      const rebillNo = await fetchRebillNo(env, c.subscription_id);
      if (!rebillNo) { r.status = 'skipped_missing_rebill_no'; results.push(r); continue; }

      // (구독, 회차) 멱등키 — 이미 시도/성공한 회차면 null 반환 → 건너뜀
      const chargeId = await rpc<string | null>(env, 'record_rebill_charge_attempt', {
        p_subscription_id: c.subscription_id, p_user_id: c.user_id, p_rebill_no: rebillNo,
        p_amount: c.amount, p_plan_type: c.plan_type, p_cycle_period_end: c.cycle_period_end, p_order_no: null,
      });
      if (!chargeId) { r.status = 'skipped_duplicate_cycle'; results.push(r); continue; }

      const orderNo = `swk_catchup_${c.subscription_id.slice(0, 8)}_${executionId.slice(0, 12)}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      await stampCharge(env, chargeId, executionId, orderNo);
      await insertOrder(env, {
        user_id: c.user_id, subscription_id: c.subscription_id,
        order_no: orderNo, plan_type: c.plan_type, amount: c.amount,
      });
      await rpc(env, 'mark_rebill_charge_result', {
        p_charge_id: chargeId, p_status: 'requesting',
        p_payapp_raw: { order_no: orderNo, execution_id: executionId, cycle_period_end: c.cycle_period_end },
      });

      let pay: { ok: boolean; state: string; raw: Record<string, string> };
      try {
        pay = await rebillPay(env, {
          rebillNo, amount: c.amount, goodname: '듣다 정기이용권',
          orderNo, subscriptionId: c.subscription_id,
        });
      } catch (e) {
        // 타임아웃/네트워크 불명 → 재시도하지 않고 unknown 으로 남겨 reconciliation 대상화
        await rpc(env, 'mark_rebill_charge_result', { p_charge_id: chargeId, p_status: 'unknown', p_error: String(e) });
        r.status = 'unknown_pending_reconciliation'; r.order_no = orderNo; results.push(r); continue;
      }

      if (pay.ok) {
        await rpc(env, 'mark_rebill_charge_result', {
          p_charge_id: chargeId, p_status: 'awaiting_webhook', p_payapp_state: pay.state, p_payapp_raw: pay.raw,
        });
        r.status = 'accepted_awaiting_webhook';
      } else {
        await rpc(env, 'mark_rebill_charge_result', {
          p_charge_id: chargeId, p_status: 'provider_rejected', p_payapp_state: pay.state,
          p_payapp_raw: pay.raw, p_error: pay.raw.errorMessage ?? pay.raw.errormessage ?? 'rebillPay rejected',
        });
        await fetch(`${env.SUPABASE_URL}/rest/v1/payment_orders?order_no=eq.${encodeURIComponent(orderNo)}`, {
          method: 'PATCH',
          headers: {
            apikey: env.SERVICE_ROLE, Authorization: `Bearer ${env.SERVICE_ROLE}`,
            'content-type': 'application/json', Prefer: 'return=minimal',
          },
          body: JSON.stringify({ status: 'failed', raw_response: pay.raw }),
        }).catch(() => undefined);
        r.status = 'provider_rejected';
      }
      r.order_no = orderNo;
      r.payapp_state = pay.state;
    } catch (e) {
      r.status = 'error'; r.error = String(e);
    }
    results.push(r);
  }

  return json({
    ok: true, mode: 'catchup', dry_run: false, kill_switch: kill,
    execution_id: executionId, ran_at: new Date().toISOString(), summary,
    attempted: targets.length,
    accepted: results.filter((r) => r.status === 'accepted_awaiting_webhook').length,
    rejected: results.filter((r) => r.status === 'provider_rejected').length,
    unknown: results.filter((r) => r.status === 'unknown_pending_reconciliation').length,
    skipped: results.filter((r) => String(r.status).startsWith('skipped')).length,
    results,
  });
});
