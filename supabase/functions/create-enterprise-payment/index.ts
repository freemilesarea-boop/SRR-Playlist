// create-enterprise-payment — 엔터프라이즈 HQ/가맹 정기결제 등록(rebillRegist)
//
// 0512 — 중복 등록 차단:
//   점주가 결제창에서 승인을 마쳤는데 화면이 그대로라 한 번 더 누르면, 예전에는
//   매번 새 구독 + 새 rebill 이 PayApp 에 등록돼 다음 달 요금이 두 번 나갈 수 있었다.
//   이제는 (1) 이미 결제된 구독이면 거절하고, (2) 진행 중인 결제창이 있으면
//   새로 만들지 않고 그 payurl 을 그대로 돌려준다.
//
// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const PAYAPP_USERID = Deno.env.get('PAYAPP_USERID') ?? '';
const PAYAPP_LINKKEY = Deno.env.get('PAYAPP_LINKKEY') ?? '';
const PAYAPP_API_URL = Deno.env.get('PAYAPP_API_URL') ?? 'https://api.payapp.kr/oapi/apiLoad.html';
const PAYAPP_REBILL_EXPIRE = Deno.env.get('PAYAPP_REBILL_EXPIRE') ?? '2099-12-31';
const PAYAPP_PAYMENT_MEMO_RAW = Deno.env.get('PAYAPP_PAYMENT_MEMO') ?? '';
const PAYAPP_PAYMENT_MEMO = PAYAPP_PAYMENT_MEMO_RAW.trim().length > 0 ? PAYAPP_PAYMENT_MEMO_RAW.trim() : '듣다 엔터프라이즈 정기결제';
const SUPPORT_PHONE = Deno.env.get('SUPPORT_PHONE') ?? '';
const APP_BASE_LEGACY = Deno.env.get('APP_BASE_URL') ?? '';
const PAYAPP_FEEDBACK_BASE_URL = Deno.env.get('PAYAPP_FEEDBACK_BASE_URL') || APP_BASE_LEGACY || SUPABASE_URL;
const PUBLIC_APP_URL = Deno.env.get('PUBLIC_APP_URL') || APP_BASE_LEGACY;

/** 진행 중인 결제창을 재사용할 수 있는 시간. 이보다 오래되면 새로 만든다. */
const REUSE_WINDOW_MIN = 30;

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...corsHeaders } }); }
function generateOrderNo(userId: string): string { const ts = Date.now().toString(36); const rand = Math.random().toString(36).slice(2, 8); return `ent_${userId.slice(0, 8)}_${ts}_${rand}`; }
function rebillDayFromToday(): string { const d = new Date().getDate(); return d >= 29 ? '90' : String(d); }

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!PAYAPP_USERID || !PAYAPP_LINKKEY) return json({ error: 'server misconfigured: payapp credentials missing' }, 500);
  if (!PUBLIC_APP_URL) return json({ error: 'server misconfigured: PUBLIC_APP_URL missing' }, 500);
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'unauthorized' }, 401);
  const sbUser = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: userRes, error: userErr } = await sbUser.auth.getUser();
  if (userErr || !userRes?.user) return json({ error: 'unauthorized' }, 401);
  const user = userRes.user;
  let body: { recvphone?: string } = {};
  try { body = await req.json(); } catch { body = {}; }
  const recvphone = (body.recvphone ?? '').replace(/\D/g, '');
  if (recvphone.length < 9) return json({ error: 'invalid phone', reason: '연락처를 입력해주세요.' }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // 0512 — 이탈한 옛 시도를 먼저 정리한다. 이걸 안 하면 아래 유니크 제약(살아있는 구독 1건)
  //        때문에 정상적인 재시도까지 막힌다.
  await sb.rpc('expire_stale_enterprise_pending_subscriptions', { p_minutes: REUSE_WINDOW_MIN });

  const { data: ctxData, error: ctxErr } = await sbUser.rpc('get_my_enterprise_payment_context');
  if (ctxErr) return json({ error: ctxErr.message }, 500);
  const ctx = (ctxData ?? {}) as any;
  if (!ctx.should_pay) { return json({ ok: false, error: ctx.already_active ? 'already_active' : 'not_eligible', reason: ctx.already_active ? '이미 결제가 등록되어 있어요.' : '결제 대상이 아니에요. 관리자에게 문의하세요.' }, 409); }
  const amount = Number(ctx.amount);
  if (!Number.isFinite(amount) || amount <= 0) return json({ error: 'invalid_amount' }, 500);

  // 0512 — 이미 살아있는 구독이 있으면 새로 만들지 않는다.
  //   active  → 결제 완료. 거절.
  //   pending → 결제창까지 갔던 시도. 그 payurl 을 그대로 돌려줘 rebill 중복 등록을 막는다.
  const { data: live } = await sb
    .from('enterprise_payment_subscriptions')
    .select('id, status, created_at')
    .eq('payer_user_id', user.id)
    .eq('enterprise_account_id', ctx.enterprise_account_id)
    .eq('payer_type', ctx.payer_type)
    .in('status', ['pending', 'payment_waiting', 'active'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (live?.status === 'active' || live?.status === 'payment_waiting') {
    return json({ ok: false, error: 'already_active', reason: '이미 결제가 등록되어 있어요.' }, 409);
  }
  if (live?.id) {
    const { data: prevOrder } = await sb
      .from('enterprise_payment_orders')
      .select('order_no, payapp_payurl')
      .eq('subscription_id', live.id)
      .not('payapp_payurl', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (prevOrder?.payapp_payurl) {
      // 같은 결제창을 다시 열어준다 — PayApp 에 rebill 이 두 번 등록되지 않는다.
      return json({ ok: true, payurl: prevOrder.payapp_payurl, order_no: prevOrder.order_no, reused: true });
    }
  }

  const orderNo = generateOrderNo(user.id);
  const { data: sub, error: sErr } = await sb.from('enterprise_payment_subscriptions').insert({ enterprise_account_id: ctx.enterprise_account_id, payer_type: ctx.payer_type, payer_user_id: user.id, franchise_store_id: ctx.franchise_store_id ?? null, amount, status: 'pending' }).select('id').single();
  if (sErr || !sub) {
    // 유니크 제약(살아있는 구독 1건) 위반 = 동시에 두 번 눌린 경우. 중복 등록 대신 안내한다.
    if ((sErr as any)?.code === '23505') {
      return json({ ok: false, error: 'in_progress', reason: '결제가 이미 진행 중이에요. 잠시 후 다시 확인해주세요.' }, 409);
    }
    return json({ error: 'subscription create failed' }, 500);
  }
  const { error: oErr } = await sb.from('enterprise_payment_orders').insert({ subscription_id: sub.id, enterprise_account_id: ctx.enterprise_account_id, payer_user_id: user.id, payer_type: ctx.payer_type, order_no: orderNo, amount, status: 'requested' });
  if (oErr) return json({ error: 'order create failed' }, 500);
  const goodname = `${ctx.enterprise_name ?? '엔터프라이즈'} ${ctx.payer_type === 'hq' ? '본사' : '가맹'} 월 구독`;
  const params = new URLSearchParams();
  params.set('cmd', 'rebillRegist');
  params.set('userid', PAYAPP_USERID);
  params.set('goodname', goodname);
  params.set('goodprice', String(amount));
  params.set('recvphone', recvphone);
  params.set('recvemail', user.email ?? '');
  params.set('memo', PAYAPP_PAYMENT_MEMO);
  if (SUPPORT_PHONE) params.set('sellerphone', SUPPORT_PHONE);
  params.set('rebillCycleType', 'Month');
  params.set('rebillCycleMonth', rebillDayFromToday());
  params.set('rebillExpire', PAYAPP_REBILL_EXPIRE);
  params.set('feedbackurl', `${PAYAPP_FEEDBACK_BASE_URL}/functions/v1/enterprise-payment-feedback`);
  params.set('returnurl', `${PUBLIC_APP_URL}/enterprise/pay/success?order_no=${orderNo}`);
  params.set('failurl', `${PUBLIC_APP_URL}/enterprise/pay/fail?order_no=${orderNo}`);
  params.set('var1', orderNo);
  params.set('var2', user.id);
  params.set('smsuse', 'n');
  params.set('openpaytype', 'card');
  params.set('checkretry', 'y');
  params.set('linkkey', PAYAPP_LINKKEY);
  let payappResp: Record<string, string> = {}; let respText = '';
  try {
    const resp = await fetch(PAYAPP_API_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: params.toString() });
    respText = await resp.text();
    payappResp = Object.fromEntries(new URLSearchParams(respText).entries());
  } catch (e) {
    await sb.from('enterprise_payment_orders').update({ status: 'failed', raw_response: { error: String(e) } }).eq('order_no', orderNo);
    await sb.from('enterprise_payment_subscriptions').update({ status: 'failed' }).eq('id', sub.id);
    return json({ error: 'payapp request failed' }, 502);
  }
  if ((payappResp.state ?? '') === '1') {
    await sb.from('enterprise_payment_orders').update({ payapp_rebill_no: payappResp.rebill_no ?? null, payapp_payurl: payappResp.payurl ?? null, raw_request: Object.fromEntries(params.entries()), raw_response: payappResp }).eq('order_no', orderNo);
    await sb.from('enterprise_payment_subscriptions').update({ payapp_rebill_no: payappResp.rebill_no ?? null }).eq('id', sub.id);
    return json({ ok: true, payurl: payappResp.payurl, order_no: orderNo });
  }
  await sb.from('enterprise_payment_orders').update({ status: 'failed', raw_request: Object.fromEntries(params.entries()), raw_response: payappResp }).eq('order_no', orderNo);
  await sb.from('enterprise_payment_subscriptions').update({ status: 'failed' }).eq('id', sub.id);
  return json({ ok: false, error: payappResp.errorMessage ?? payappResp.errormessage ?? respText ?? 'unknown error' }, 400);
});
