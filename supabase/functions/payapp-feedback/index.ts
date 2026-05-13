// supabase/functions/payapp-feedback/index.ts
//
// PayApp feedbackurl 웹훅 처리기.
// - linkval 검증 (PAYAPP_LINKVAL 일치)
// - mul_no + rebill_no + pay_state + price 기준 멱등 처리
// - pay_state 별 status/권한 갱신
// - 가격 위변조 (PayApp price ≠ plan price) 시 권한 부여 금지
// - 최종 응답: HTTP 200 + 'SUCCESS' (PayApp 재시도 방지)
//
// deno-lint-ignore-file no-explicit-any

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PAYAPP_LINKVAL = Deno.env.get('PAYAPP_LINKVAL') ?? '';

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const SUCCESS = () => new Response('SUCCESS', { headers: { 'content-type': 'text/plain' }, status: 200 });

function payloadFromForm(form: URLSearchParams): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const [k, v] of form.entries()) obj[k] = v;
  return obj;
}

async function readPayload(req: Request): Promise<Record<string, string>> {
  const ct = req.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    try {
      return await req.json();
    } catch {
      return {};
    }
  }
  // application/x-www-form-urlencoded 또는 multipart/form-data
  const text = await req.text();
  return payloadFromForm(new URLSearchParams(text));
}

function buildEventKey(p: Record<string, string>): string {
  const mul = p.mul_no ?? p.mulno ?? '';
  const rebill = p.rebill_no ?? p.rebillno ?? '';
  const state = p.pay_state ?? p.paystate ?? '';
  const price = p.price ?? '';
  if (mul || rebill) return `payapp:${mul}:${rebill}:${state}:${price}`;
  // mul_no 없으면 raw hash
  const raw = JSON.stringify(p);
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
  return `payapp:raw:${state}:${price}:${h}`;
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const payload = await readPayload(req);
  const eventKey = buildEventKey(payload);
  const linkval = payload.linkval ?? '';
  const linkvalOk = !!PAYAPP_LINKVAL && linkval === PAYAPP_LINKVAL;

  const orderNo = payload.var1 || null;
  const userIdRaw = payload.var2 || null;
  const mulNo = payload.mul_no || payload.mulno || null;
  const rebillNo = payload.rebill_no || payload.rebillno || null;
  const payState = Number(payload.pay_state ?? payload.paystate ?? 0) || null;
  const priceNum = Number(payload.price ?? 0) || null;

  // 1) webhook 멱등 insert. 이미 처리된 키면 SUCCESS 즉시.
  const { data: insertedEvent, error: insertErr } = await sb
    .from('payapp_webhook_events')
    .insert({
      event_key: eventKey,
      order_no: orderNo,
      user_id: userIdRaw,
      payapp_mul_no: mulNo,
      payapp_rebill_no: rebillNo,
      pay_state: payState,
      price: priceNum,
      linkval_verified: linkvalOk,
      raw_payload: payload,
    })
    .select('id, processed_at')
    .maybeSingle();

  if (insertErr) {
    // unique 위반 = 이미 처리됨
    if (insertErr.code === '23505') {
      return SUCCESS();
    }
    // 그 외 DB 에러 — 그래도 PayApp 에는 SUCCESS (재시도 무한루프 방지). 모니터링 별도.
    console.error('[payapp-feedback] insert error:', insertErr);
    return SUCCESS();
  }

  // 2) linkval 검증 실패 — 저장만 하고 처리 안 함
  if (!linkvalOk) {
    console.warn('[payapp-feedback] linkval mismatch — saved but not processed');
    return SUCCESS();
  }

  // 3) order_no 없으면 raw만 저장하고 SUCCESS
  if (!orderNo) {
    await sb
      .from('payapp_webhook_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('id', insertedEvent?.id);
    return SUCCESS();
  }

  // 4) order 조회
  const { data: order } = await sb
    .from('payment_orders')
    .select('id, user_id, subscription_id, plan_type, amount')
    .eq('order_no', orderNo)
    .maybeSingle();

  if (!order) {
    await sb
      .from('payapp_webhook_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('id', insertedEvent?.id);
    return SUCCESS();
  }

  // 5) 가격 위변조 검증 — plan price 와 일치해야 함
  const { data: plan } = await sb
    .from('subscription_plans')
    .select('price, plan_type')
    .eq('plan_type', order.plan_type)
    .maybeSingle();

  const priceTrusted =
    !!plan && priceNum != null && plan.price === priceNum && order.amount === plan.price;

  if (!priceTrusted) {
    console.warn(
      '[payapp-feedback] price mismatch — refusing to activate',
      { orderNo, payappPrice: priceNum, planPrice: plan?.price, orderAmount: order.amount },
    );
    await sb
      .from('payapp_webhook_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('id', insertedEvent?.id);
    return SUCCESS();
  }

  // 6) pay_state 처리
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);
  const periodEndIso = periodEnd.toISOString();

  if (payState === 4) {
    // 결제 완료
    await sb
      .from('payment_orders')
      .update({
        status: 'paid',
        payapp_rebill_no: rebillNo,
        payapp_mul_no: mulNo,
        raw_response: payload,
      })
      .eq('id', order.id);

    if (order.subscription_id) {
      await sb
        .from('subscriptions')
        .update({
          status: 'active',
          payapp_rebill_no: rebillNo,
          payapp_mul_no: mulNo,
          payapp_pay_state: payState,
          last_paid_at: now.toISOString(),
          current_period_start: now.toISOString(),
          current_period_end: periodEndIso,
        })
        .eq('id', order.subscription_id);
    }

    // membership_tier 갱신
    await sb
      .from('users')
      .update({ membership_tier: order.plan_type, subscription_type: order.plan_type })
      .eq('id', order.user_id);
  } else if (payState === 10) {
    // 가상계좌 결제대기
    await sb.from('payment_orders').update({ status: 'waiting' }).eq('id', order.id);
    if (order.subscription_id) {
      await sb
        .from('subscriptions')
        .update({ status: 'payment_waiting', payapp_pay_state: payState })
        .eq('id', order.subscription_id);
    }
  } else if (payState === 8 || payState === 32) {
    // 요청 취소
    await sb.from('payment_orders').update({ status: 'canceled' }).eq('id', order.id);
    if (order.subscription_id) {
      await sb
        .from('subscriptions')
        .update({
          status: 'canceled',
          canceled_at: now.toISOString(),
          payapp_pay_state: payState,
        })
        .eq('id', order.subscription_id);
    }
  } else if ([9, 64, 70, 71].includes(payState ?? -1)) {
    // 승인 취소 / 부분 취소 — 권한 제거
    await sb.from('payment_orders').update({ status: 'canceled' }).eq('id', order.id);
    if (order.subscription_id) {
      await sb
        .from('subscriptions')
        .update({
          status: 'canceled',
          canceled_at: now.toISOString(),
          payapp_pay_state: payState,
        })
        .eq('id', order.subscription_id);
    }
    await sb
      .from('users')
      .update({ membership_tier: 'free', subscription_type: 'free' })
      .eq('id', order.user_id);
  }
  // 그 외 pay_state: 이벤트만 저장하고 상태 변경 X

  await sb
    .from('payapp_webhook_events')
    .update({ processed_at: new Date().toISOString() })
    .eq('id', insertedEvent?.id);

  return SUCCESS();
});
