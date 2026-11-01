// supabase/functions/dispatch-arrears-request/index.ts
//
// 연체분 회수 — 밀린 회차마다 PayApp 개별 결제요청(payrequest)으로 결제링크를 만든다.
//
// 왜 이 방식뿐인가: PayApp 에는 등록된 rebill_no 를 임의 시점·임의 금액으로 긁는 API 가
// 없다. cmd=rebillPay 는 존재하지 않는 명령이다(0543 / docs/PAYMENT.md).
//
// 기존 결제 파이프라인을 탄다: payment_orders(requested) 를 먼저 만들고 그 order_no 를
// var1 로 보낸다. 결제되면 payapp-feedback 이 order_no 로 주문을 집어 paid 처리하고
// 구독 기간을 한 회차 민다. 회차당 1건이라 4건 결제 = 4회차 반영.
//
// 안전 게이트(전부 fail-closed):
//   1) x-cron-secret 또는 service_role Bearer 없으면 401
//   2) dry_run 기본 true. Kill Switch(BILLING_ARREARS_ENABLED)가 참이 아니면 강등
//   3) 대상은 admin_list_arrears_cycles 가 eligible=true 로 확정한 회차만
//   4) (구독, 회차) 멱등 — arrears_payment_requests UNIQUE 가 중복 발송을 막는다
//   5) smsuse 기본 'n' — PayApp 이 회원에게 문자를 보내지 않는다. 링크를 받아
//      확인한 뒤 우리가 직접 전달하는 게 기본. 문자는 명시적으로 켜야 한다.
//
// 개인정보: 응답에 이메일·전화번호를 싣지 않는다(구독 id 앞 8자만).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PAYAPP_TIMEOUT_MS = 15_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readEnv() {
  return {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL') ?? '',
    SERVICE_ROLE: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    CRON_SECRET: Deno.env.get('CRON_SECRET') ?? '',
    ARREARS_ENABLED: Deno.env.get('BILLING_ARREARS_ENABLED') ?? '',
    PAYAPP_USERID: Deno.env.get('PAYAPP_USERID') ?? '',
    PAYAPP_LINKKEY: Deno.env.get('PAYAPP_LINKKEY') ?? '',
    PAYAPP_API_URL: Deno.env.get('PAYAPP_API_URL') ?? 'https://api.payapp.kr/oapi/apiLoad.html',
    PAYAPP_FEEDBACK_BASE_URL: Deno.env.get('PAYAPP_FEEDBACK_BASE_URL') || Deno.env.get('SUPABASE_URL') || '',
    PUBLIC_APP_URL: Deno.env.get('PUBLIC_APP_URL') ?? '',
    SHOP_NAME: Deno.env.get('PAYAPP_SHOP_NAME') || '듣다',
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

/** 상품명 — "듣다 7월 이용료". cycle_month 는 RPC 가 KST 로 계산해 준다. */
function goodnameFor(cycleMonth: string): string {
  const m = Number(cycleMonth.slice(5, 7));
  return Number.isFinite(m) && m >= 1 && m <= 12 ? `듣다 ${m}월 이용료` : '듣다 이용료';
}

/** payment_orders.order_no — 기존 주문과 같은 모양이어야 결제통보 매칭이 깨지지 않는다. */
function generateOrderNo(userId: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `swk_${userId.slice(0, 8)}_${ts}_${rand}`;
}

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

async function insertRow(env: Env, table: string, row: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: env.SERVICE_ROLE, Authorization: `Bearer ${env.SERVICE_ROLE}`,
      'content-type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`${table} insert failed: ${res.status} ${await res.text()}`);
}

async function patchRow(env: Env, table: string, filter: string, patch: Record<string, unknown>): Promise<void> {
  await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: {
      apikey: env.SERVICE_ROLE, Authorization: `Bearer ${env.SERVICE_ROLE}`,
      'content-type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify(patch),
  }).catch(() => undefined);
}

interface ArrearsCycle {
  subscription_id: string;
  user_id: string;
  plan_type: string;
  amount: number;
  cycle_period_end: string;
  cycle_month: string;
  cycle_index: number;
  cycles_owed: number;
  recvphone: string | null;
  eligible: boolean;
  exclude_reason: string;
}

/** PayApp 개별 결제요청. 결제창 URL(payurl)을 돌려준다. */
async function payRequest(
  env: Env,
  args: { goodname: string; price: number; recvphone: string; orderNo: string; userId: string; smsuse: string },
): Promise<{ ok: boolean; state: string; raw: Record<string, string> }> {
  const params = new URLSearchParams();
  params.set('cmd', 'payrequest');
  params.set('userid', env.PAYAPP_USERID);
  params.set('linkkey', env.PAYAPP_LINKKEY);
  params.set('shopname', env.SHOP_NAME);
  params.set('goodname', args.goodname);
  params.set('price', String(args.price));
  params.set('recvphone', args.recvphone);
  params.set('feedbackurl', `${env.PAYAPP_FEEDBACK_BASE_URL}/functions/v1/payapp-feedback`);
  params.set('checkretry', 'y');
  params.set('var1', args.orderNo);
  params.set('var2', args.userId);
  // 기본은 문자 미발송. 링크를 우리가 받아 확인한 뒤 직접 전달한다.
  params.set('smsuse', args.smsuse);
  params.set('openpaytype', 'card');
  if (env.PUBLIC_APP_URL) {
    params.set('returnurl', `${env.PUBLIC_APP_URL}/payment/success?order_no=${args.orderNo}`);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PAYAPP_TIMEOUT_MS);
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
    subscription_ids?: string[]; exclude_user_ids?: string[]; smsuse?: string;
  } = {};
  try { body = await req.json(); } catch { /* 빈 body → dry run */ }

  const kill = killSwitchOn(env.ARREARS_ENABLED);
  const dryRun = !kill || body.dry_run !== false;
  const rawLimit = typeof body.limit === 'number' && Number.isFinite(body.limit) ? Math.floor(body.limit) : 20;
  const limit = Math.min(Math.max(1, rawLimit), 100);
  const maxCycles = Math.min(Math.max(1, Math.floor(body.max_cycles ?? 6)), 24);
  const onlyIds = Array.isArray(body.subscription_ids) ? body.subscription_ids.filter((s) => UUID_RE.test(s)) : null;
  const excludeUsers = Array.isArray(body.exclude_user_ids) ? body.exclude_user_ids.filter((s) => UUID_RE.test(s)) : [];
  const smsuse = body.smsuse === 'y' ? 'y' : 'n';

  let cycles: ArrearsCycle[] = [];
  try {
    cycles = await rpc<ArrearsCycle[]>(env, 'admin_list_arrears_cycles', { p_max_cycles: maxCycles });
  } catch (e) {
    return json({ error: 'arrears_query_failed', detail: String(e) }, 500);
  }

  const excluded: Record<string, number> = {};
  for (const c of cycles) {
    if (!c.eligible) excluded[c.exclude_reason] = (excluded[c.exclude_reason] ?? 0) + 1;
  }

  // Edge 는 RPC 가 내준 목록을 좁히기만 한다. 넓히지 못한다.
  let targets = cycles.filter((c) => c.eligible && !!c.recvphone);
  if (onlyIds && onlyIds.length > 0) targets = targets.filter((c) => onlyIds.includes(c.subscription_id));
  if (excludeUsers.length > 0) targets = targets.filter((c) => !excludeUsers.includes(c.user_id));
  targets = targets.slice(0, limit);

  const summary = {
    cycles_total: cycles.length,
    eligible_cycles: cycles.filter((c) => c.eligible).length,
    eligible_subscriptions: new Set(cycles.filter((c) => c.eligible).map((c) => c.subscription_id)).size,
    eligible_amount: cycles.filter((c) => c.eligible).reduce((s, c) => s + c.amount, 0),
    excluded,
    selected_cycles: targets.length,
    selected_amount: targets.reduce((s, c) => s + c.amount, 0),
    selected_subscriptions: new Set(targets.map((c) => c.subscription_id)).size,
  };

  if (dryRun) {
    return json({
      ok: true, mode: 'arrears', dry_run: true, kill_switch: kill, smsuse,
      ran_at: new Date().toISOString(), summary,
      would_request: targets.map((c) => ({
        subscription_id: anonId(c.subscription_id),
        cycle_month: c.cycle_month,
        goodname: goodnameFor(c.cycle_month),
        amount: c.amount,
        cycle: `${c.cycle_index}/${c.cycles_owed}`,
      })),
    });
  }

  if (!env.PAYAPP_USERID || !env.PAYAPP_LINKKEY) return json({ error: 'payapp_credentials_missing' }, 500);

  const results: Array<Record<string, unknown>> = [];
  for (const c of targets) {
    const goodname = goodnameFor(c.cycle_month);
    const r: Record<string, unknown> = {
      subscription_id: anonId(c.subscription_id),
      cycle_month: c.cycle_month, goodname, amount: c.amount,
    };
    const orderNo = generateOrderNo(c.user_id);
    try {
      // (구독, 회차) 멱등키 — UNIQUE 충돌이면 이미 보낸 회차다.
      try {
        await insertRow(env, 'arrears_payment_requests', {
          subscription_id: c.subscription_id, user_id: c.user_id,
          cycle_period_end: c.cycle_period_end, cycle_month: c.cycle_month,
          amount: c.amount, goodname, order_no: orderNo, status: 'requested',
        });
      } catch (e) {
        if (String(e).includes('23505') || String(e).includes('duplicate')) {
          r.status = 'skipped_already_requested'; results.push(r); continue;
        }
        throw e;
      }

      // 결제 통보가 이 주문을 집어 paid 로 바꾸고 구독 기간을 한 회차 민다.
      await insertRow(env, 'payment_orders', {
        user_id: c.user_id, subscription_id: c.subscription_id,
        order_no: orderNo, plan_type: c.plan_type, amount: c.amount, status: 'requested',
      });

      const pay = await payRequest(env, {
        goodname, price: c.amount, recvphone: c.recvphone as string,
        orderNo, userId: c.user_id, smsuse,
      });

      if (pay.ok) {
        await patchRow(env, 'arrears_payment_requests', `order_no=eq.${encodeURIComponent(orderNo)}`, {
          payurl: pay.raw.payurl ?? null, payapp_mul_no: pay.raw.mul_no ?? null, status: 'requested',
        });
        await patchRow(env, 'payment_orders', `order_no=eq.${encodeURIComponent(orderNo)}`, {
          payapp_mul_no: pay.raw.mul_no ?? null, payapp_payurl: pay.raw.payurl ?? null,
        });
        r.status = 'link_created';
        r.payurl = pay.raw.payurl ?? null;
      } else {
        const msg = pay.raw.errorMessage ?? pay.raw.errormessage ?? 'payrequest rejected';
        await patchRow(env, 'arrears_payment_requests', `order_no=eq.${encodeURIComponent(orderNo)}`, {
          status: 'failed', error_message: msg,
        });
        await patchRow(env, 'payment_orders', `order_no=eq.${encodeURIComponent(orderNo)}`, {
          status: 'failed', raw_response: pay.raw,
        });
        r.status = 'provider_rejected';
        r.payapp_error = msg;
      }
      r.payapp_state = pay.state;
      r.order_no = orderNo;
    } catch (e) {
      r.status = 'error';
      r.error = String(e);
    }
    results.push(r);
  }

  return json({
    ok: true, mode: 'arrears', dry_run: false, kill_switch: kill, smsuse,
    ran_at: new Date().toISOString(), summary,
    attempted: targets.length,
    created: results.filter((r) => r.status === 'link_created').length,
    rejected: results.filter((r) => r.status === 'provider_rejected').length,
    skipped: results.filter((r) => String(r.status).startsWith('skipped')).length,
    results,
  });
});
