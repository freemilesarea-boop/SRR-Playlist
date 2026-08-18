// supabase/functions/payapp-course-feedback/index.ts
//
// 수강신청 PayApp 웹훅. PayApp 이 결제 상태를 POST 로 통지.
//   검증: userid==PAYAPP_USERID && linkval==PAYAPP_LINKVAL (&& linkkey 일치 시)
//         && price==course_orders.amount (order_no 조회)
//   pay_state=64(승인완료)=결제성공 → course_orders.status='paid' (멱등)
//   항상 200 "SUCCESS" 반환(PayApp 재시도 폭주 방지).
//
// ⚠️ 반드시 verify_jwt=false 로 배포 (PayApp 은 JWT 없이 POST).
// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PAYAPP_USERID = Deno.env.get('PAYAPP_USERID') ?? '';
const PAYAPP_LINKKEY = Deno.env.get('PAYAPP_LINKKEY') ?? '';
const PAYAPP_LINKVAL = Deno.env.get('PAYAPP_LINKVAL') ?? '';

// PayApp 는 성공/실패 무관 200 "SUCCESS" 를 기대 (재시도 방지).
function ok() { return new Response('SUCCESS', { status: 200, headers: { 'content-type': 'text/plain' } }); }

function pick(o: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) { if (o[k] != null && o[k] !== '') return o[k]; }
  return '';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 });
  if (req.method !== 'POST') return ok();

  // form-urlencoded 또는 JSON 파싱
  let payload: Record<string, string> = {};
  try {
    const ct = req.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      const j = await req.json();
      payload = Object.fromEntries(Object.entries(j).map(([k, v]) => [k, String(v ?? '')]));
    } else {
      const raw = await req.text();
      payload = Object.fromEntries(new URLSearchParams(raw).entries());
    }
  } catch { return ok(); }

  const orderNo = pick(payload, 'var1', 'order_no', 'memo');
  const mulNo = pick(payload, 'mul_no', 'mulNo');
  const payState = parseInt(pick(payload, 'pay_state', 'state') || '0', 10);
  const price = parseInt((pick(payload, 'price') || '0').replace(/[^\d]/g, '') || '0', 10);
  const userid = pick(payload, 'userid');
  const linkval = pick(payload, 'linkval');
  const linkkey = pick(payload, 'linkkey');

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // 검증 1: 판매자/콜백 토큰
  const useridOk = PAYAPP_USERID.length > 0 && userid === PAYAPP_USERID;
  const linkvalOk = PAYAPP_LINKVAL.length > 0 && linkval === PAYAPP_LINKVAL;
  const linkkeyOk = !linkkey || !PAYAPP_LINKKEY || linkkey === PAYAPP_LINKKEY;
  const headerVerified = useridOk && linkvalOk && linkkeyOk;

  // 검증 2: 금액 대조 (order_no 로 주문 조회)
  let amountOk = false;
  if (orderNo) {
    const { data: order } = await sb.from('course_orders').select('amount').eq('order_no', orderNo).maybeSingle();
    if (order && Number(order.amount) === price) amountOk = true;
  }
  const verified = headerVerified && amountOk;

  // 멱등: 이벤트 기록 (event_key = mulNo:state:price 또는 orderNo:state:price)
  const eventKey = `${mulNo || orderNo}:${payState}:${price}`;
  const { error: insErr } = await sb.from('course_payapp_webhook_events').insert({
    event_key: eventKey, order_no: orderNo || null, payapp_mul_no: mulNo || null,
    pay_state: payState, price, verified, raw_payload: payload,
  });
  if (insErr) {
    // 23505 = 중복 이벤트 → 이미 처리됨
    if ((insErr as any).code === '23505') return ok();
    // 그 외 오류도 PayApp 에는 SUCCESS (내부 로그만)
    console.error('[course-feedback] insert error', insErr);
    return ok();
  }

  if (!verified) {
    console.warn('[course-feedback] verification failed', { useridOk, linkvalOk, linkkeyOk, amountOk, orderNo });
    return ok();
  }

  // 결제 상태 반영
  const { data: applied, error: applyErr } = await sb.rpc('_apply_course_payapp_event', {
    p_order_no: orderNo, p_mul_no: mulNo || null, p_pay_state: payState, p_amount: price, p_raw: payload,
  });
  await sb.from('course_payapp_webhook_events')
    .update({ processing_note: applyErr ? String(applyErr.message) : JSON.stringify(applied), matched_order_id: (applied as any)?.order_id ?? null })
    .eq('event_key', eventKey);

  return ok();
});
