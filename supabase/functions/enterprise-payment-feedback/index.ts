// supabase/functions/enterprise-payment-feedback/index.ts
//
// 엔터프라이즈 정기결제 PayApp 웹훅.
//   검증: userid==PAYAPP_USERID && linkval==PAYAPP_LINKVAL (&& linkkey 일치 시)
//         && price == 기대금액(order.amount 또는 rebill 구독 amount)
//   첫 결제: var1(order_no) 매칭. 매월 자동청구: rebill_no 매칭.
//   pay_state=64 = 결제성공 → order paid + subscription active (멱등). 항상 SUCCESS.
//
// ⚠️ 반드시 verify_jwt=false 로 배포.
// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PAYAPP_USERID = Deno.env.get('PAYAPP_USERID') ?? '';
const PAYAPP_LINKKEY = Deno.env.get('PAYAPP_LINKKEY') ?? '';
const PAYAPP_LINKVAL = Deno.env.get('PAYAPP_LINKVAL') ?? '';

function ok() { return new Response('SUCCESS', { status: 200, headers: { 'content-type': 'text/plain' } }); }
function pick(o: Record<string, string>, ...keys: string[]): string { for (const k of keys) { if (o[k] != null && o[k] !== '') return o[k]; } return ''; }

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 });
  if (req.method !== 'POST') return ok();

  let payload: Record<string, string> = {};
  try {
    const ct = req.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) { const j = await req.json(); payload = Object.fromEntries(Object.entries(j).map(([k, v]) => [k, String(v ?? '')])); }
    else { const raw = await req.text(); payload = Object.fromEntries(new URLSearchParams(raw).entries()); }
  } catch { return ok(); }

  const orderNo = pick(payload, 'var1', 'order_no', 'memo');
  const rebillNo = pick(payload, 'rebill_no', 'rebillNo');
  const mulNo = pick(payload, 'mul_no', 'mulNo');
  const payState = parseInt(pick(payload, 'pay_state', 'state') || '0', 10);
  const price = parseInt((pick(payload, 'price') || '0').replace(/[^\d]/g, '') || '0', 10);
  const userid = pick(payload, 'userid');
  const linkval = pick(payload, 'linkval');
  const linkkey = pick(payload, 'linkkey');

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const useridOk = PAYAPP_USERID.length > 0 && userid === PAYAPP_USERID;
  const linkvalOk = PAYAPP_LINKVAL.length > 0 && linkval === PAYAPP_LINKVAL;
  const linkkeyOk = !linkkey || !PAYAPP_LINKKEY || linkkey === PAYAPP_LINKKEY;
  const headerVerified = useridOk && linkvalOk && linkkeyOk;

  // 기대금액: order_no 우선, 없으면 rebill_no 로 구독금액
  let expectedAmount: number | null = null;
  if (orderNo) {
    const { data: o } = await sb.from('enterprise_payment_orders').select('amount').eq('order_no', orderNo).maybeSingle();
    if (o) expectedAmount = Number(o.amount);
  }
  if (expectedAmount == null && rebillNo) {
    const { data: s } = await sb.from('enterprise_payment_subscriptions').select('amount').eq('payapp_rebill_no', rebillNo).maybeSingle();
    if (s) expectedAmount = Number(s.amount);
  }
  const amountOk = expectedAmount != null && expectedAmount === price;
  const verified = headerVerified && amountOk;

  const eventKey = `${mulNo || rebillNo || orderNo}:${payState}:${price}`;
  const { error: insErr } = await sb.from('enterprise_payapp_webhook_events').insert({
    event_key: eventKey, order_no: orderNo || null, payapp_rebill_no: rebillNo || null, payapp_mul_no: mulNo || null,
    pay_state: payState, price, verified, raw_payload: payload,
  });
  if (insErr) {
    if ((insErr as any).code === '23505') return ok();
    console.error('[ent-feedback] insert error', insErr);
    return ok();
  }
  if (!verified) {
    console.warn('[ent-feedback] verification failed', { useridOk, linkvalOk, linkkeyOk, amountOk, orderNo, rebillNo });
    return ok();
  }

  const { data: applied, error: applyErr } = await sb.rpc('_apply_enterprise_payapp_event', {
    p_order_no: orderNo || null, p_rebill_no: rebillNo || null, p_mul_no: mulNo || null, p_pay_state: payState, p_amount: price, p_raw: payload,
  });
  await sb.from('enterprise_payapp_webhook_events')
    .update({ processing_note: applyErr ? String(applyErr.message) : JSON.stringify(applied), matched_order_id: (applied as any)?.order_id ?? null })
    .eq('event_key', eventKey);

  return ok();
});
