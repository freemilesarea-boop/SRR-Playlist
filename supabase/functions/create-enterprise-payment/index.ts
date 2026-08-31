// supabase/functions/create-enterprise-payment/index.ts
//
// 엔터프라이즈 본사(HQ)/가맹(store) 정기결제 등록(PayApp rebillRegist).
// - 로그인 사용자 검증
// - 금액/결제주체는 get_my_enterprise_payment_context() (서버 DB, 관리자 정액) 만 신뢰
// - enterprise_payment_subscriptions(pending) + enterprise_payment_orders(requested) 생성
// - PayApp rebillRegist 호출 → payurl 반환. 이후 매월 자동청구.
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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...corsHeaders } });
}
function generateOrderNo(userId: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `ent_${userId.slice(0, 8)}_${ts}_${rand}`;
}
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

  // 금액/주체는 서버 컨텍스트만 신뢰 (관리자 정액)
  const { data: ctxData, error: ctxErr } = await sbUser.rpc('get_my_enterprise_payment_context');
  if (ctxErr) return json({ error: ctxErr.message }, 500);
  const ctx = (ctxData ?? {}) as any;
  if (!ctx.should_pay) {
    return json({ ok: false, error: ctx.already_active ? 'already_active' : 'not_eligible', reason: ctx.already_active ? '이미 결제가 등록되어 있어요.' : '결제 대상이 아니에요. 관리자에게 문의하세요.' }, 409);
  }
  const amount = Number(ctx.amount);
  if (!Number.isFinite(amount) || amount <= 0) return json({ error: 'invalid_amount' }, 500);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const orderNo = generateOrderNo(user.id);

  const { data: sub, error: sErr } = await sb.from('enterprise_payment_subscriptions').insert({
    enterprise_account_id: ctx.enterprise_account_id, payer_type: ctx.payer_type, payer_user_id: user.id,
    franchise_store_id: ctx.franchise_store_id ?? null, amount, status: 'pending',
  }).select('id').single();
  if (sErr || !sub) return json({ error: 'subscription create failed' }, 500);

  const { error: oErr } = await sb.from('enterprise_payment_orders').insert({
    subscription_id: sub.id, enterprise_account_id: ctx.enterprise_account_id, payer_user_id: user.id,
    payer_type: ctx.payer_type, order_no: orderNo, amount, status: 'requested',
  });
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
    await sb.from('enterprise_payment_orders').update({
      payapp_rebill_no: payappResp.rebill_no ?? null, payapp_payurl: payappResp.payurl ?? null,
      raw_request: Object.fromEntries(params.entries()), raw_response: payappResp,
    }).eq('order_no', orderNo);
    await sb.from('enterprise_payment_subscriptions').update({ payapp_rebill_no: payappResp.rebill_no ?? null }).eq('id', sub.id);
    return json({ ok: true, payurl: payappResp.payurl, order_no: orderNo });
  }

  await sb.from('enterprise_payment_orders').update({ status: 'failed', raw_request: Object.fromEntries(params.entries()), raw_response: payappResp }).eq('order_no', orderNo);
  await sb.from('enterprise_payment_subscriptions').update({ status: 'failed' }).eq('id', sub.id);
  return json({ ok: false, error: payappResp.errorMessage ?? payappResp.errormessage ?? respText ?? 'unknown error' }, 400);
});
