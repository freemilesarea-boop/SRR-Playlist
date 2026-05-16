// supabase/functions/create-payapp-subscription/index.ts
//
// PayApp 정기결제 등록(rebillRegist) 요청.
// - 로그인 사용자 검증
// - plan 가격은 DB seed 만 신뢰
// - subscriptions(pending) + payment_orders(requested) 생성
// - PayApp REST 호출 후 payurl 반환
//
// deno-lint-ignore-file no-explicit-any

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PAYAPP_USERID = Deno.env.get('PAYAPP_USERID') ?? '';
const PAYAPP_LINKKEY = Deno.env.get('PAYAPP_LINKKEY') ?? '';
const PAYAPP_API_URL = Deno.env.get('PAYAPP_API_URL') ?? 'https://api.payapp.kr/oapi/apiLoad.html';
const PAYAPP_REBILL_EXPIRE = Deno.env.get('PAYAPP_REBILL_EXPIRE') ?? '2099-12-31';
// 결제창에 노출되는 판매자 메모 / 상품 설명. PayApp 의 'memo' 파라미터로 전송됨.
//   - 운영 secret 미설정이거나 빈 문자열이면 아래 fallback 적용.
//   - 운영 secret 에 옛 값('SWK monthly subscription' 등)이 그대로 남아 있으면 fallback 이
//     무력화되므로 반드시 `supabase secrets set PAYAPP_PAYMENT_MEMO="SRR Playlist 정기결제"`
//     로 갱신 후 `supabase functions deploy create-payapp-subscription` 재배포 필요.
const PAYAPP_PAYMENT_MEMO_RAW = Deno.env.get('PAYAPP_PAYMENT_MEMO') ?? '';
const PAYAPP_PAYMENT_MEMO =
  PAYAPP_PAYMENT_MEMO_RAW.trim().length > 0
    ? PAYAPP_PAYMENT_MEMO_RAW.trim()
    : 'SRR Playlist 정기결제';
// 고객센터/지원 연락처 — 개인 휴대폰 사용 금지. 070/대표번호/업무용 번호만.
// PayApp REST 의 rebillRegist 자체에는 seller_phone 파라미터가 없으나, 일부 응답/대응 채널
// (returnurl 안내 페이지 등) 또는 cmd 종류에 따라 사용될 수 있도록 환경변수만 노출.
// 가맹점 정보(판매자 연락처)는 PayApp 콘솔의 가맹점 설정에서 직접 SUPPORT_PHONE 값으로 동기화 필요.
const SUPPORT_PHONE = Deno.env.get('SUPPORT_PHONE') ?? '';
// URL 분리:
//   PAYAPP_FEEDBACK_BASE_URL = Supabase Functions URL (webhook 수신 endpoint host)
//   PUBLIC_APP_URL           = 프론트 도메인 (return/fail 페이지 host)
// 우선순위: 명시된 신규 env → APP_BASE_URL legacy → 마지막 폴백 (SUPABASE_URL/빈문자열)
const APP_BASE_LEGACY = Deno.env.get('APP_BASE_URL') ?? '';
const PAYAPP_FEEDBACK_BASE_URL =
  Deno.env.get('PAYAPP_FEEDBACK_BASE_URL') || APP_BASE_LEGACY || SUPABASE_URL;
const PUBLIC_APP_URL = Deno.env.get('PUBLIC_APP_URL') || APP_BASE_LEGACY;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders },
  });
}

function generateOrderNo(userId: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `swk_${userId.slice(0, 8)}_${ts}_${rand}`;
}

/** 결제 요청일의 day. 29~31 이면 90(말일 처리). */
function rebillDayFromToday(): string {
  const d = new Date().getDate();
  return d >= 29 ? '90' : String(d);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // env guard — 운영 배포 전 누락되면 결제창이 깨진 URL 로 진입하므로 명확히 실패시킴
  if (!PAYAPP_USERID || !PAYAPP_LINKKEY) {
    console.error('[create-payapp] PAYAPP_USERID / PAYAPP_LINKKEY 시크릿 누락');
    return json({ error: 'server misconfigured: payapp credentials missing' }, 500);
  }
  if (!PUBLIC_APP_URL) {
    console.error('[create-payapp] PUBLIC_APP_URL 또는 APP_BASE_URL 시크릿 누락');
    return json({ error: 'server misconfigured: PUBLIC_APP_URL missing' }, 500);
  }

  // 로그인 사용자 검증
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'unauthorized' }, 401);

  const sbUser = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userRes, error: userErr } = await sbUser.auth.getUser();
  if (userErr || !userRes?.user) return json({ error: 'unauthorized' }, 401);
  const user = userRes.user;

  // 입력 파싱
  let body: { plan_type?: string; recvphone?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid body' }, 400);
  }
  const planType = body.plan_type;
  const recvphone = (body.recvphone ?? '').replace(/\D/g, '');
  if (planType !== 'individual' && planType !== 'business') {
    return json({ error: 'invalid plan_type' }, 400);
  }
  if (recvphone.length < 9) return json({ error: 'invalid phone' }, 400);

  // service role 으로 DB 작업
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // 가격은 서버 DB 만 신뢰
  const { data: plan, error: planErr } = await sb
    .from('subscription_plans')
    .select('plan_type, name, price, is_active')
    .eq('plan_type', planType)
    .maybeSingle();
  if (planErr || !plan || !plan.is_active) {
    return json({ error: 'plan not found' }, 404);
  }

  const orderNo = generateOrderNo(user.id);

  // 기존 pending 구독이 있으면 그걸 갱신, 없으면 신규
  const { data: existing } = await sb
    .from('subscriptions')
    .select('id, status')
    .eq('user_id', user.id)
    .in('status', ['pending', 'payment_waiting'])
    .maybeSingle();

  let subscriptionId: string;
  if (existing) {
    subscriptionId = existing.id;
    await sb
      .from('subscriptions')
      .update({ plan_type: plan.plan_type, price: plan.price, status: 'pending' })
      .eq('id', subscriptionId);
  } else {
    const { data: created, error: createErr } = await sb
      .from('subscriptions')
      .insert({
        user_id: user.id,
        plan_type: plan.plan_type,
        price: plan.price,
        status: 'pending',
      })
      .select('id')
      .single();
    if (createErr || !created) return json({ error: 'subscription create failed' }, 500);
    subscriptionId = created.id;
  }

  // payment_orders 생성
  await sb.from('payment_orders').insert({
    user_id: user.id,
    subscription_id: subscriptionId,
    order_no: orderNo,
    plan_type: plan.plan_type,
    amount: plan.price,
    status: 'requested',
  });

  // PayApp rebillRegist 호출
  const params = new URLSearchParams();
  params.set('cmd', 'rebillRegist');
  params.set('userid', PAYAPP_USERID);
  params.set('goodname', plan.name);
  params.set('goodprice', String(plan.price));
  params.set('recvphone', recvphone);
  params.set('recvemail', user.email ?? '');
  params.set('memo', PAYAPP_PAYMENT_MEMO);
  // PayApp 가 sellerphone 같은 파라미터를 지원하면 자동 첨부 (현재 공식 rebillRegist 에는 없음).
  // 운영 중 PayApp 응답/이메일 알림에 노출되는 판매자 번호는 PayApp 콘솔에서 SUPPORT_PHONE 으로 동기화.
  if (SUPPORT_PHONE) params.set('sellerphone', SUPPORT_PHONE);
  params.set('rebillCycleType', 'Month');
  params.set('rebillCycleMonth', rebillDayFromToday());
  params.set('rebillExpire', PAYAPP_REBILL_EXPIRE);
  params.set('feedbackurl', `${PAYAPP_FEEDBACK_BASE_URL}/functions/v1/payapp-feedback`);
  params.set('returnurl', `${PUBLIC_APP_URL}/payment/success?order_no=${orderNo}`);
  params.set('failurl', `${PUBLIC_APP_URL}/payment/fail?order_no=${orderNo}`);
  params.set('var1', orderNo);
  params.set('var2', user.id);
  params.set('smsuse', 'n');
  params.set('openpaytype', 'card');
  // PayApp 가 feedbackurl 실패 시 재시도 — 우리 EF 는 항상 SUCCESS 반환하므로
  // 실제 재시도 폭주는 없음. 매뉴얼 권장값.
  params.set('checkretry', 'y');
  params.set('linkkey', PAYAPP_LINKKEY);

  // 디버그 로그 — 민감정보(linkkey/linkval/recvphone/recvemail/userid 값) 제외.
  // 브랜딩 문구 확인용. 운영자가 결제창에 표시되는 memo / goodname 을 검증 가능.
  console.log('[create-payapp] request preview:', {
    goodname: plan.name,
    goodprice: plan.price,
    memo: PAYAPP_PAYMENT_MEMO,
    userid_present: PAYAPP_USERID.length > 0,
    feedbackurl: `${PAYAPP_FEEDBACK_BASE_URL}/functions/v1/payapp-feedback`,
    returnurl: `${PUBLIC_APP_URL}/payment/success?order_no=${orderNo}`,
    failurl: `${PUBLIC_APP_URL}/payment/fail?order_no=${orderNo}`,
    order_no: orderNo,
    plan_type: plan.plan_type,
  });

  let payappResp: Record<string, string> = {};
  let respText = '';
  try {
    const resp = await fetch(PAYAPP_API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    respText = await resp.text();
    payappResp = Object.fromEntries(new URLSearchParams(respText).entries());
  } catch (e) {
    await sb
      .from('payment_orders')
      .update({ status: 'failed', raw_response: { error: String(e) } })
      .eq('order_no', orderNo);
    return json({ error: 'payapp request failed' }, 502);
  }

  const state = payappResp.state ?? '';
  if (state === '1') {
    await sb
      .from('payment_orders')
      .update({
        payapp_rebill_no: payappResp.rebill_no ?? null,
        payapp_payurl: payappResp.payurl ?? null,
        raw_request: Object.fromEntries(params.entries()),
        raw_response: payappResp,
      })
      .eq('order_no', orderNo);
    await sb
      .from('subscriptions')
      .update({ payapp_rebill_no: payappResp.rebill_no ?? null })
      .eq('id', subscriptionId);

    return json({ ok: true, payurl: payappResp.payurl, order_no: orderNo });
  }

  // state != 1 → 실패
  await sb
    .from('payment_orders')
    .update({
      status: 'failed',
      raw_request: Object.fromEntries(params.entries()),
      raw_response: payappResp,
    })
    .eq('order_no', orderNo);
  return json(
    {
      ok: false,
      error: payappResp.errorMessage ?? payappResp.errormessage ?? respText ?? 'unknown error',
    },
    400,
  );
});
