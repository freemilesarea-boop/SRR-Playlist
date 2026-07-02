// supabase/functions/dispatch-subscription-rebill/index.ts
//
// 정기결제 자동 재청구(rebillPay) 디스패처 (Phase — 재청구 실행 레이어).
//
// 배경: 구독 등록 시 rebillRegist 로 빌링키(subscriptions.payapp_rebill_no)만 저장하고
//       이후 그 키로 재청구(rebillPay)하는 실행 레이어가 없어, 만료 도래 구독이 자동
//       갱신되지 않고 랩스되었음. 본 함수가 만료 도래 구독을 PayApp rebillPay 로 청구한다.
//
// 인증: x-cron-secret 헤더 또는 service_role JWT.
//
// 흐름:
//   1) RPC admin_list_rebill_due_subscriptions(grace_days) — 재청구 대상 조회
//   2) 제외 목록(REBILL_EXCLUDE_USER_IDS env + body.exclude_user_ids) 필터
//   3) dry_run(기본 true): 대상/금액만 반환, 청구 안 함
//   4) dry_run=false: 대상별로
//        a) record_rebill_charge_attempt — cycle 단위 멱등 예약(중복이면 skip)
//        b) payment_orders(requested) 생성 (webhook 매칭용 var1=order_no)
//        c) PayApp rebillPay 호출 (등록된 rebill_no 로 카드 재입력 없이 청구)
//        d) 응답 반영(mark_rebill_charge_result). 실제 결제확정(기간연장/등급유지)은
//           기존 payapp-feedback 웹훅(state=64)이 처리 — 본 함수는 트리거만.
//
// 안전장치:
//   - dry_run 기본 true (명시적으로 false 를 줘야 실제 청구).
//   - cycle 단위 unique(구독,cycle_period_end) 로 이중청구 물리 차단(0397).
//   - 제외 목록으로 테스트/내부 계정 청구 방지.
//   - 단건 실패 격리 — 나머지 대상에 영향 없음.
//
// deno-lint-ignore-file no-explicit-any

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders },
  });
}

function readEnv() {
  return {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL') ?? '',
    SERVICE_ROLE: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    CRON_SECRET: Deno.env.get('CRON_SECRET') ?? '',
    PAYAPP_USERID: Deno.env.get('PAYAPP_USERID') ?? '',
    PAYAPP_LINKKEY: Deno.env.get('PAYAPP_LINKKEY') ?? '',
    PAYAPP_API_URL: Deno.env.get('PAYAPP_API_URL') ?? 'https://api.payapp.kr/oapi/apiLoad.html',
    PAYAPP_FEEDBACK_BASE_URL:
      Deno.env.get('PAYAPP_FEEDBACK_BASE_URL') || Deno.env.get('APP_BASE_URL') || Deno.env.get('SUPABASE_URL') || '',
    EXCLUDE_USER_IDS: (Deno.env.get('REBILL_EXCLUDE_USER_IDS') ?? '')
      .split(',').map((s) => s.trim()).filter(Boolean),
  };
}

interface DueRow {
  subscription_id: string;
  user_id: string;
  email: string;
  nickname: string | null;
  phone: string | null;
  plan_type: string;
  plan_name: string | null;
  amount: number;
  current_period_end: string;
  rebill_no: string;
}

async function rpc<T>(env: ReturnType<typeof readEnv>, fn: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: env.SERVICE_ROLE,
      Authorization: `Bearer ${env.SERVICE_ROLE}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`RPC ${fn} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function insertOrder(
  env: ReturnType<typeof readEnv>,
  row: { user_id: string; subscription_id: string; order_no: string; plan_type: string; amount: number },
): Promise<void> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/payment_orders`, {
    method: 'POST',
    headers: {
      apikey: env.SERVICE_ROLE,
      Authorization: `Bearer ${env.SERVICE_ROLE}`,
      'content-type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      user_id: row.user_id,
      subscription_id: row.subscription_id,
      order_no: row.order_no,
      plan_type: row.plan_type,
      amount: row.amount,
      status: 'requested',
    }),
  });
  if (!res.ok) throw new Error(`order insert failed: ${res.status} ${await res.text()}`);
}

/** PayApp rebillPay — 등록된 rebill_no 로 즉시 재청구. 결제확정은 feedbackurl 웹훅(state=64). */
async function rebillPay(
  env: ReturnType<typeof readEnv>,
  d: DueRow,
  orderNo: string,
): Promise<{ ok: boolean; state: string; raw: Record<string, string> }> {
  const params = new URLSearchParams();
  params.set('cmd', 'rebillPay');
  params.set('userid', env.PAYAPP_USERID);
  params.set('linkkey', env.PAYAPP_LINKKEY);
  params.set('rebill_no', d.rebill_no);
  params.set('goodname', d.plan_name ?? '듣다 정기이용권');
  params.set('goodprice', String(d.amount));
  params.set('price', String(d.amount));
  if (d.phone) params.set('recvphone', d.phone.replace(/\D/g, ''));
  if (d.email) params.set('recvemail', d.email);
  params.set('feedbackurl', `${env.PAYAPP_FEEDBACK_BASE_URL}/functions/v1/payapp-feedback`);
  params.set('var1', orderNo);
  params.set('var2', d.user_id);
  const resp = await fetch(env.PAYAPP_API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const raw = Object.fromEntries(new URLSearchParams(await resp.text()).entries());
  return { ok: raw.state === '1', state: raw.state ?? '', raw };
}

function orderNoFor(subId: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `swk_rebill_${subId.slice(0, 8)}_${ts}_${rand}`;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const env = readEnv();

  // 인증
  const cronSecret = req.headers.get('x-cron-secret') ?? '';
  const authHeader = req.headers.get('authorization') ?? '';
  const isCron = env.CRON_SECRET && cronSecret === env.CRON_SECRET;
  const isServiceRole = authHeader === `Bearer ${env.SERVICE_ROLE}`;
  if (!isCron && !isServiceRole) return json({ error: 'unauthorized' }, 401);
  if (!env.SUPABASE_URL || !env.SERVICE_ROLE) return json({ error: 'supabase_env_missing' }, 500);

  let body: { dry_run?: boolean; grace_days?: number; limit?: number; exclude_user_ids?: string[] } = {};
  try { body = await req.json(); } catch { /* empty ok */ }
  // 안전 기본값: dry_run 명시적으로 false 일 때만 실제 청구
  const dryRun = body.dry_run !== false;
  const graceDays = Math.max(0, body.grace_days ?? 0);
  const limit = Math.min(Math.max(1, body.limit ?? 100), 500);
  const excludeSet = new Set<string>([...env.EXCLUDE_USER_IDS, ...(body.exclude_user_ids ?? [])]);

  let due: DueRow[] = [];
  try {
    due = await rpc<DueRow[]>(env, 'admin_list_rebill_due_subscriptions', { p_grace_days: graceDays });
  } catch (e) {
    return json({ error: 'due_query_failed', detail: String(e) }, 500);
  }

  const excluded = due.filter((d) => excludeSet.has(d.user_id));
  const targets = due.filter((d) => !excludeSet.has(d.user_id)).slice(0, limit);

  // 실제 청구에 PayApp 자격증명 필요
  if (!dryRun && (!env.PAYAPP_USERID || !env.PAYAPP_LINKKEY)) {
    return json({ error: 'payapp_credentials_missing' }, 500);
  }

  if (dryRun) {
    return json({
      ok: true,
      dry_run: true,
      ran_at: new Date().toISOString(),
      due_total: due.length,
      excluded: excluded.map((d) => ({ user_id: d.user_id, nickname: d.nickname, email: d.email })),
      would_charge: targets.map((d) => ({
        subscription_id: d.subscription_id,
        nickname: d.nickname,
        email: d.email,
        plan_type: d.plan_type,
        amount: d.amount,
        cycle_period_end: d.current_period_end,
        rebill_no: d.rebill_no,
      })),
      total_amount: targets.reduce((s, d) => s + d.amount, 0),
    });
  }

  const results: Array<Record<string, unknown>> = [];
  for (const d of targets) {
    const r: Record<string, unknown> = { subscription_id: d.subscription_id, nickname: d.nickname, amount: d.amount };
    try {
      // a) cycle 멱등 예약
      const chargeId = await rpc<string | null>(env, 'record_rebill_charge_attempt', {
        p_subscription_id: d.subscription_id,
        p_user_id: d.user_id,
        p_rebill_no: d.rebill_no,
        p_amount: d.amount,
        p_plan_type: d.plan_type,
        p_cycle_period_end: d.current_period_end,
        p_order_no: null,
      });
      if (!chargeId) { r.status = 'skipped_duplicate_cycle'; results.push(r); continue; }

      // b) payment_orders(requested) — 웹훅(state=64) 매칭용
      const orderNo = orderNoFor(d.subscription_id);
      await insertOrder(env, {
        user_id: d.user_id, subscription_id: d.subscription_id,
        order_no: orderNo, plan_type: d.plan_type, amount: d.amount,
      });
      await rpc(env, 'mark_rebill_charge_result', { p_charge_id: chargeId, p_status: 'attempted', p_payapp_raw: { order_no: orderNo } });

      // c) PayApp rebillPay
      const pay = await rebillPay(env, d, orderNo);
      // d) 결과 반영 (확정 paid 는 웹훅이 처리)
      await rpc(env, 'mark_rebill_charge_result', {
        p_charge_id: chargeId,
        p_status: pay.ok ? 'accepted' : 'failed',
        p_payapp_state: pay.state,
        p_payapp_raw: pay.raw,
        p_error: pay.ok ? null : (pay.raw.errorMessage ?? pay.raw.errmsg ?? pay.raw.errormessage ?? 'rebillPay failed'),
      });
      if (!pay.ok) {
        // 청구 실패 → order 도 failed 로
        await fetch(`${env.SUPABASE_URL}/rest/v1/payment_orders?order_no=eq.${encodeURIComponent(orderNo)}`, {
          method: 'PATCH',
          headers: {
            apikey: env.SERVICE_ROLE, Authorization: `Bearer ${env.SERVICE_ROLE}`,
            'content-type': 'application/json', Prefer: 'return=minimal',
          },
          body: JSON.stringify({ status: 'failed', raw_response: pay.raw }),
        });
      }
      r.status = pay.ok ? 'charged_accepted' : 'charge_failed';
      r.order_no = orderNo;
      r.payapp_state = pay.state;
      if (!pay.ok) r.error = pay.raw.errorMessage ?? pay.raw.errmsg ?? pay.raw.errormessage ?? null;
    } catch (e) {
      r.status = 'error';
      r.error = String(e);
    }
    results.push(r);
  }

  return json({
    ok: true,
    dry_run: false,
    ran_at: new Date().toISOString(),
    due_total: due.length,
    excluded_count: excluded.length,
    attempted: targets.length,
    accepted: results.filter((r) => r.status === 'charged_accepted').length,
    failed: results.filter((r) => r.status === 'charge_failed' || r.status === 'error').length,
    skipped: results.filter((r) => r.status === 'skipped_duplicate_cycle').length,
    results,
  });
});
