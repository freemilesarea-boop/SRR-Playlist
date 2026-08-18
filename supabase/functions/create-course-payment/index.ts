// supabase/functions/create-course-payment/index.ts
//
// 수강신청 — PayApp 일회성 결제(payrequest) 요청.
// - 로그인 사용자 검증
// - 가격은 DB(course_products.price)만 신뢰
// - 정원(capacity) 초과 시 마감 처리
// - course_orders(requested) 생성 → PayApp 호출 → payurl 반환
//
// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PAYAPP_USERID = Deno.env.get('PAYAPP_USERID') ?? '';
const PAYAPP_LINKKEY = Deno.env.get('PAYAPP_LINKKEY') ?? '';
const PAYAPP_API_URL = Deno.env.get('PAYAPP_API_URL') ?? 'https://api.payapp.kr/oapi/apiLoad.html';
const PAYAPP_PAYMENT_MEMO_RAW = Deno.env.get('PAYAPP_PAYMENT_MEMO') ?? '';
const PAYAPP_PAYMENT_MEMO = PAYAPP_PAYMENT_MEMO_RAW.trim().length > 0 ? PAYAPP_PAYMENT_MEMO_RAW.trim() : '듣다 수강신청';
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
  return `crs_${userId.slice(0, 8)}_${ts}_${rand}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  if (!PAYAPP_USERID || !PAYAPP_LINKKEY) return json({ error: 'server misconfigured: payapp credentials missing' }, 500);
  if (!PUBLIC_APP_URL) return json({ error: 'server misconfigured: PUBLIC_APP_URL missing' }, 500);

  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'unauthorized' }, 401);
  const sbUser = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userRes, error: userErr } = await sbUser.auth.getUser();
  if (userErr || !userRes?.user) return json({ error: 'unauthorized' }, 401);
  const user = userRes.user;

  let body: { product_id?: string; recvphone?: string; buyer_name?: string } = {};
  try { body = await req.json(); } catch { return json({ error: 'invalid body' }, 400); }
  const productId = (body.product_id ?? '').trim();
  const recvphone = (body.recvphone ?? '').replace(/\D/g, '');
  const buyerName = (body.buyer_name ?? '').trim().slice(0, 60);
  if (!productId) return json({ error: 'product_id required' }, 400);
  if (recvphone.length < 9) return json({ error: 'invalid phone' }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // 가격/상품은 서버 DB 만 신뢰
  const { data: product, error: pErr } = await sb
    .from('course_products').select('id, name, price, is_active, capacity').eq('id', productId).maybeSingle();
  if (pErr || !product || !product.is_active) return json({ error: 'product not found' }, 404);

  // 정원 체크 (best-effort) — 이미 결제된 수량이 정원 이상이면 마감
  if (product.capacity != null) {
    const { count } = await sb.from('course_orders').select('id', { count: 'exact', head: true })
      .eq('product_id', product.id).eq('status', 'paid');
    if ((count ?? 0) >= product.capacity) return json({ ok: false, error: 'sold_out', reason: '정원이 마감되었습니다.' }, 409);
  }

  const orderNo = generateOrderNo(user.id);
  const { error: oErr } = await sb.from('course_orders').insert({
    product_id: product.id, user_id: user.id, order_no: orderNo, amount: product.price,
    buyer_name: buyerName || null, recvphone, recvemail: user.email ?? '', status: 'requested',
  });
  if (oErr) return json({ error: 'order create failed' }, 500);

  // PayApp payrequest (일회성)
  const params = new URLSearchParams();
  params.set('cmd', 'payrequest');
  params.set('userid', PAYAPP_USERID);
  params.set('goodname', product.name);
  params.set('price', String(product.price));
  params.set('recvphone', recvphone);
  params.set('recvemail', user.email ?? '');
  params.set('memo', PAYAPP_PAYMENT_MEMO);
  if (SUPPORT_PHONE) params.set('sellerphone', SUPPORT_PHONE);
  params.set('feedbackurl', `${PAYAPP_FEEDBACK_BASE_URL}/functions/v1/payapp-course-feedback`);
  params.set('returnurl', `${PUBLIC_APP_URL}/enroll/success?order_no=${orderNo}`);
  params.set('failurl', `${PUBLIC_APP_URL}/enroll/fail?order_no=${orderNo}`);
  params.set('var1', orderNo);
  params.set('var2', user.id);
  params.set('smsuse', 'n');
  params.set('openpaytype', 'card');
  params.set('checkretry', 'y');
  params.set('linkkey', PAYAPP_LINKKEY);

  let payappResp: Record<string, string> = {};
  let respText = '';
  try {
    const resp = await fetch(PAYAPP_API_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: params.toString() });
    respText = await resp.text();
    payappResp = Object.fromEntries(new URLSearchParams(respText).entries());
  } catch (e) {
    await sb.from('course_orders').update({ status: 'failed', raw_response: { error: String(e) } }).eq('order_no', orderNo);
    return json({ error: 'payapp request failed' }, 502);
  }

  if ((payappResp.state ?? '') === '1') {
    await sb.from('course_orders').update({
      payapp_mul_no: payappResp.mul_no ?? null, payapp_payurl: payappResp.payurl ?? null,
      raw_request: Object.fromEntries(params.entries()), raw_response: payappResp,
    }).eq('order_no', orderNo);
    return json({ ok: true, payurl: payappResp.payurl, order_no: orderNo });
  }

  await sb.from('course_orders').update({ status: 'failed', raw_request: Object.fromEntries(params.entries()), raw_response: payappResp }).eq('order_no', orderNo);
  return json({ ok: false, error: payappResp.errorMessage ?? payappResp.errormessage ?? respText ?? 'unknown error' }, 400);
});
