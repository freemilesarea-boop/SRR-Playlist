// supabase/functions/payapp-feedback/index.ts
//
// PayApp feedbackurl 웹훅 처리기 (2차 보강판).
//
// 검증 4중:
//   - userid  === PAYAPP_USERID      (가맹점 식별)
//   - linkval === PAYAPP_LINKVAL     (콜백 검증 토큰)
//   - linkkey === PAYAPP_LINKKEY     (payload 에 포함될 때만)
//   - price   === payment_orders.amount  (가격 위변조 차단)
// → 하나라도 불일치하면 권한 부여 금지. PayApp 재시도 폭주 방지 위해 응답은 항상 SUCCESS.
//
// pay_state 별 처리:
//   1            결제 요청 수신 (완료 아님) → requested/pending 유지
//   4            결제 완료 → paid/active + period 갱신 + membership_tier 부여
//   10           가상계좌 대기 → waiting/payment_waiting
//   8, 32        요청 취소 → canceled
//   9, 64, 70, 71 승인 취소/부분 취소 → canceled + free 다운그레이드
//   그 외        이벤트만 기록
//
// 자동 정기결제 (2회차+) 대응:
//   같은 order_no 로 새 mul_no 가 오면 renewal payment_orders 생성
//   order_no = `${original}_renewal_${mul_no}`
//   subscriptions 의 last_paid_at / current_period_* 갱신.
//
// 멱등성: payapp_webhook_events.event_key UNIQUE → 같은 payload 두 번 와도 1회 처리.
//
// deno-lint-ignore-file no-explicit-any

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PAYAPP_USERID = Deno.env.get('PAYAPP_USERID') ?? '';
const PAYAPP_LINKKEY = Deno.env.get('PAYAPP_LINKKEY') ?? '';
const PAYAPP_LINKVAL = Deno.env.get('PAYAPP_LINKVAL') ?? '';

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const SUCCESS = () =>
  new Response('SUCCESS', { headers: { 'content-type': 'text/plain' }, status: 200 });

function payloadFromForm(form: URLSearchParams): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const [k, v] of form.entries()) obj[k] = v;
  return obj;
}

// 다양한 PayApp payload 필드명 후보를 한 번에 매칭.
function pickField(p: Record<string, string>, keys: string[]): string | null {
  for (const k of keys) {
    if (p[k] != null && String(p[k]).trim() !== '') return String(p[k]).trim();
  }
  return null;
}

// '결제완료' / 'paid' / '4' / 'complete' 등을 모두 '4' 로 normalize.
function normalizePayState(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  if (/^(4|paid|complete|completed|결제완료|완료)$/i.test(s)) return 4;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function planFromAmount(amount: number | null): 'individual' | 'business' | null {
  if (amount === 4900) return 'individual';
  if (amount === 6900) return 'business';
  return null;
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
  const text = await req.text();
  return payloadFromForm(new URLSearchParams(text));
}

function buildEventKey(p: Record<string, string>): string {
  const mul = p.mul_no ?? p.mulno ?? '';
  const rebill = p.rebill_no ?? p.rebillno ?? '';
  const state = p.pay_state ?? p.paystate ?? '';
  const price = p.price ?? '';
  if (mul || rebill) return `payapp:${mul}:${rebill}:${state}:${price}`;
  // mul_no 없으면 raw payload hash fallback
  const raw = JSON.stringify(p);
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
  return `payapp:raw:${state}:${price}:${h}`;
}

interface Verification {
  ok: boolean;
  userid_ok: boolean;
  linkval_ok: boolean;
  /** linkkey 가 payload 에 있을 때만 검증. 없으면 'absent'. */
  linkkey_ok: 'ok' | 'fail' | 'absent';
  price_ok: boolean;
  price_observed: number | null;
  price_expected: number | null;
  reasons: string[];
}

function verifyHeaders(
  p: Record<string, string>,
  expectedAmount: number | null,
): Verification {
  const userid = p.userid ?? '';
  const linkval = p.linkval ?? '';
  const linkkey = p.linkkey ?? '';
  const priceNum = Number(p.price ?? 0) || null;

  const userid_ok = !!PAYAPP_USERID && userid === PAYAPP_USERID;
  const linkval_ok = !!PAYAPP_LINKVAL && linkval === PAYAPP_LINKVAL;
  const linkkey_ok: 'ok' | 'fail' | 'absent' =
    linkkey === ''
      ? 'absent'
      : !!PAYAPP_LINKKEY && linkkey === PAYAPP_LINKKEY
        ? 'ok'
        : 'fail';
  const price_ok =
    expectedAmount != null && priceNum != null && priceNum === expectedAmount;

  const reasons: string[] = [];
  if (!userid_ok) reasons.push(`userid_mismatch (got=${userid})`);
  if (!linkval_ok) reasons.push('linkval_mismatch');
  if (linkkey_ok === 'fail') reasons.push('linkkey_mismatch');
  if (expectedAmount == null) reasons.push('expected_amount_unknown');
  else if (!price_ok) reasons.push(`price_mismatch (got=${priceNum}, expect=${expectedAmount})`);

  // ok = userid/linkval/price 통과 + (linkkey 가 'fail' 이 아닐 것)
  const ok = userid_ok && linkval_ok && price_ok && linkkey_ok !== 'fail';
  return { ok, userid_ok, linkval_ok, linkkey_ok, price_ok, price_observed: priceNum, price_expected: expectedAmount, reasons };
}

function isoNow(): string {
  return new Date().toISOString();
}

function isoOneMonthFromNow(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString();
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const payload = await readPayload(req);
  const eventKey = buildEventKey(payload);
  // PayApp payload 필드명은 가맹점 설정/통보 채널마다 미세하게 다를 수 있어 후보 확장.
  const orderNo = pickField(payload, ['var1', 'order_no', 'orderno']);
  const userIdRaw = pickField(payload, ['var2', 'user_id', 'userid_local']);
  const mulNo = pickField(payload, ['mul_no', 'mulno', 'payapp_mul_no', 'reqno', 'req_no', 'request_no']);
  const rebillNo = pickField(payload, ['rebill_no', 'rebillno']);
  const payState = normalizePayState(pickField(payload, ['pay_state', 'paystate', 'state', 'status']));
  const priceNum = (() => {
    const s = pickField(payload, ['price', 'amount', 'goodprice']);
    const n = s ? Number(s) : null;
    return Number.isFinite(n) ? n : null;
  })();

  // --- order 조회 (검증에 필요한 expected amount) ---
  let order:
    | {
        id: string;
        user_id: string;
        subscription_id: string | null;
        plan_type: string;
        amount: number;
        payapp_mul_no: string | null;
      }
    | null = null;
  if (orderNo) {
    const { data } = await sb
      .from('payment_orders')
      .select('id, user_id, subscription_id, plan_type, amount, payapp_mul_no')
      .eq('order_no', orderNo)
      .maybeSingle();
    order = (data as typeof order) ?? null;
  }

  const verification = verifyHeaders(payload, order?.amount ?? null);

  // --- webhook 이벤트 멱등 INSERT ---
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
      linkval_verified: verification.ok,
      raw_payload: { ...payload, _verification: verification },
    })
    .select('id, processed_at')
    .maybeSingle();

  if (insertErr) {
    if (insertErr.code === '23505') return SUCCESS(); // 이미 처리됨
    console.error('[payapp-feedback] insert error:', insertErr);
    return SUCCESS(); // PayApp 재시도 폭주 방지
  }

  // --- 검증 실패 처리 ---
  //   order 가 있는데 검증 실패 → 저장만 하고 종료 (price 위변조 의심)
  //   order 가 없는데 검증 실패 → 부분 검증(userid+linkval 만) 으로 fallback,
  //   결제완료 + mul_no 가 있으면 manual_imports 에 enqueue (관리자가 처리)
  const partialVerifyOk = verification.userid_ok && verification.linkval_ok && verification.linkkey_ok !== 'fail';
  if (!verification.ok) {
    if (!order && partialVerifyOk && payState === 4 && mulNo) {
      // fall through — 아래 !order 블록에서 enqueue
    } else {
      console.warn('[payapp-feedback] verification failed:', verification.reasons);
      await sb
        .from('payapp_webhook_events')
        .update({ processed_at: isoNow() })
        .eq('id', insertedEvent?.id);
      return SUCCESS();
    }
  }

  // --- order_no 매칭 실패 또는 var1 자체가 없는 경우 ---
  //     결제 완료(payState=4) 이고 mul_no 가 있으면 manual_imports 로 enqueue.
  //     자동 동기화/관리자 UI 에서 사용자 연결 가능.
  if (!order) {
    if (payState === 4 && mulNo) {
      const buyerEmail = pickField(payload, ['recvemail', 'buyer_email', 'email']);
      const buyerPhone = pickField(payload, ['recvphone', 'buyer_phone', 'phone']);
      const goodname = pickField(payload, ['goodname', 'goodsname', 'pname']);
      const approvalNo = pickField(payload, ['approval_no', 'apv_no', 'card_apv_no']);
      const paidAtRaw = pickField(payload, ['paid_at', 'pay_date', 'paydate', 'completedate']);
      const paidAt = paidAtRaw
        ? new Date(paidAtRaw.replace(' ', 'T') + (paidAtRaw.includes('+') ? '' : '+09:00')).toISOString()
        : isoNow();
      const planType = planFromAmount(priceNum);
      if (planType && priceNum) {
        // 직접 admin_sync_payapp_payment RPC 호출은 admin 검사 때문에 실패.
        // 대신 imports 테이블에 unmatched 로 직접 INSERT → admin UI 에서 처리.
        // (자동 매칭 RPC 와 동일한 멱등성 보장 위해 ON CONFLICT 처리)
        const { error: importErr } = await sb
          .from('payapp_manual_payment_imports')
          .upsert(
            {
              payapp_mul_no: mulNo,
              approval_no: approvalNo,
              buyer_email: buyerEmail,
              buyer_phone: buyerPhone,
              amount: priceNum,
              plan_type: planType,
              goodname,
              paid_at: paidAt,
              status: 'unmatched',
              raw_payload: { ...payload, _source: 'webhook_no_order' },
              created_by: null,
            },
            { onConflict: 'payapp_mul_no' },
          );
        if (importErr) {
          console.warn('[payapp-feedback] enqueue manual import failed:', importErr.message);
        }
      }
    }
    await sb
      .from('payapp_webhook_events')
      .update({ processed_at: isoNow() })
      .eq('id', insertedEvent?.id);
    return SUCCESS();
  }

  // --- pay_state 별 처리 ---
  if (payState === 1) {
    // 결제 요청 수신 — 완료 아님. 기존 status 유지.
    // 명시적으로 requested/pending 보장.
    await sb
      .from('payment_orders')
      .update({ status: 'requested', raw_response: payload })
      .eq('id', order.id);
    if (order.subscription_id) {
      await sb
        .from('subscriptions')
        .update({ status: 'pending', payapp_pay_state: payState })
        .eq('id', order.subscription_id);
    }
  } else if (payState === 4) {
    // 결제 완료
    const isFirstPaymentForThisOrder =
      !order.payapp_mul_no || order.payapp_mul_no === mulNo;

    if (isFirstPaymentForThisOrder) {
      // 첫 결제 — 기존 order 를 paid 로 갱신
      await sb
        .from('payment_orders')
        .update({
          status: 'paid',
          payapp_rebill_no: rebillNo,
          payapp_mul_no: mulNo,
          raw_response: payload,
        })
        .eq('id', order.id);
    } else {
      // 2회차+ 자동 결제 — 새 renewal order 행 생성 (멱등: order_no UNIQUE)
      const renewalOrderNo = `${orderNo}_renewal_${mulNo ?? Date.now()}`;
      const { error: renewErr } = await sb.from('payment_orders').insert({
        user_id: order.user_id,
        subscription_id: order.subscription_id,
        order_no: renewalOrderNo,
        plan_type: order.plan_type,
        amount: order.amount,
        status: 'paid',
        payapp_rebill_no: rebillNo,
        payapp_mul_no: mulNo,
        raw_response: payload,
      });
      if (renewErr && renewErr.code !== '23505') {
        console.warn('[payapp-feedback] renewal order insert failed:', renewErr.message);
      }
    }

    // subscription 갱신 (첫 결제든 재결제든 last_paid_at + period 갱신)
    if (order.subscription_id) {
      await sb
        .from('subscriptions')
        .update({
          status: 'active',
          payapp_rebill_no: rebillNo,
          payapp_mul_no: mulNo,
          payapp_pay_state: payState,
          last_paid_at: isoNow(),
          current_period_start: isoNow(),
          current_period_end: isoOneMonthFromNow(),
        })
        .eq('id', order.subscription_id);
    }

    // membership_tier 갱신
    await sb
      .from('users')
      .update({ membership_tier: order.plan_type, subscription_type: order.plan_type })
      .eq('id', order.user_id);
  } else if (payState === 10) {
    // 가상계좌 결제 대기
    await sb.from('payment_orders').update({ status: 'waiting', raw_response: payload }).eq('id', order.id);
    if (order.subscription_id) {
      await sb
        .from('subscriptions')
        .update({ status: 'payment_waiting', payapp_pay_state: payState })
        .eq('id', order.subscription_id);
    }
  } else if (payState === 8 || payState === 32) {
    // 요청 취소 — 결제 완료 전이므로 권한 변경 없음
    await sb.from('payment_orders').update({ status: 'canceled', raw_response: payload }).eq('id', order.id);
    if (order.subscription_id) {
      await sb
        .from('subscriptions')
        .update({
          status: 'canceled',
          canceled_at: isoNow(),
          payapp_pay_state: payState,
        })
        .eq('id', order.subscription_id);
    }
  } else if ([9, 64, 70, 71].includes(payState ?? -1)) {
    // 승인 취소 / 부분 취소 → 권한 제거
    await sb.from('payment_orders').update({ status: 'canceled', raw_response: payload }).eq('id', order.id);
    if (order.subscription_id) {
      await sb
        .from('subscriptions')
        .update({
          status: 'canceled',
          canceled_at: isoNow(),
          payapp_pay_state: payState,
        })
        .eq('id', order.subscription_id);
    }
    await sb
      .from('users')
      .update({ membership_tier: 'free', subscription_type: 'free' })
      .eq('id', order.user_id);
  }
  // 그 외 pay_state — 이벤트만 기록

  await sb
    .from('payapp_webhook_events')
    .update({ processed_at: isoNow() })
    .eq('id', insertedEvent?.id);

  return SUCCESS();
});
