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
// pay_state 별 처리 (이 파일의 상수 기준 — 아래 PAYAPP_*_STATES 가 유일한 진실):
//   1, 4, 10     pending  → 이 함수에서는 권한 변경 없음
//   64           paid     → paid/active + period 갱신 + membership_tier 부여
//   8, 32        cancel   → canceled (결제 완료 전 요청 취소)
//   9, 70, 71    refund   → canceled + free 다운그레이드
//   그 외        이벤트만 기록
//
// ⚠️ state=4 의 실제 처리 주체는 이 함수가 아니라 DB 트리거다.
//   운영 실측상 이 가맹점의 PayApp 은 "실제 카드 결제완료"를 state=4 로 통보한다
//   (state=64 는 소수). 그래서 payapp_webhook_events 의 BEFORE INSERT 트리거
//   _trg_promote_state4_to_paid 가 검증된 state=4 (linkval_verified + price>0 +
//   mul_no + 승인번호/rebill_no/매칭주문 중 하나)를 paid 로 승격시킨다.
//   → 이 함수의 pending 분기는 "이미 트리거가 처리함"을 의미하지 미결제가 아니다.
//   과거 이 주석이 4 와 64 를 서로 뒤바꿔 설명해 운영 오진을 유발했다(0482 에서 정정).
//
// 자동 정기결제 (2회차+) 대응:
//   PayApp 재청구는 매 회차 var1 에 "최초 회차 order_no"를 그대로 echo 한다.
//   따라서 _internal_apply_payapp_paid_event 는 그 order_no 의 주문이 이미 paid 면
//   재사용하지 않고 회차별 renewal 주문을 새로 만든다 (0482).
//   order_no = `${original}_renewal_${mul_no}`
//   subscriptions 의 last_paid_at / current_period_* 갱신.
//   (0482 이전에는 기존 paid 주문의 mul_no 를 덮어써서 회차 매출이 유실됐다.)
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

// PayApp 가 echo back 한 raw payload 의 어떤 키에도 var1/order_no 가 안 들어있고
// memo 등에 swk_<uid8>_xxx_yyy 형태로만 박혀 있는 경우 마지막 보루로 정규식 스캔.
function scanForSwkOrderNo(p: Record<string, string>): string | null {
  for (const v of Object.values(p)) {
    if (typeof v !== 'string') continue;
    const m = v.match(/swk_[0-9a-fA-F]{8}_[a-zA-Z0-9]+_[a-zA-Z0-9]+/);
    if (m) return m[0];
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

// PayApp 의 실제 state 의미 (운영 진단 결과 확정):
//   1   요청 수신
//   4   승인대기 — 카드 인증 단계. 아직 정산 미확정 → membership 미적용
//   64  승인완료 — 정산 확정. 실제 결제 성공 → membership 활성화
//   8, 32          요청 취소 (결제 완료 전)
//   9, 70, 71      승인 취소 / 부분 취소 → 권한 제거
//
// 주의: 이전 코드는 state=4 도 paid 로 잘못 처리. 실제로는 state=64 만 paid.
//       state=64 가 안 들어오는 케이스는 admin_force_activate_membership 으로 복구.
// 상태머신 정식 정의 (0036 운영 확정)
const PAYAPP_PENDING_STATES = new Set<number>([1, 4, 10]);
const PAYAPP_PAID_STATES = new Set<number>([64]);
const PAYAPP_CANCEL_STATES = new Set<number>([8, 32]);
const PAYAPP_REFUND_STATES = new Set<number>([9, 70, 71]);
const PAYAPP_ACTIONABLE_STATES = new Set<number>([
  ...PAYAPP_PAID_STATES,
  ...PAYAPP_CANCEL_STATES,
  ...PAYAPP_REFUND_STATES,
]);

// PayApp 정기결제 '해지' webhook 감지 — pay_state 와 별개로 raw_payload 신호로 판단.
//
// ⚠️ 보수적으로 동작 — 모호한 단서(canceldate/cancel_at/stopdate 같은 날짜 필드)는
//    PayApp 가 정상 paid 응답에도 "다음 회차 만료일/해지 예약일" 의미로 echo 하는
//    경우가 있어, 이를 cancel 트리거로 쓰면 정상 결제(state=64)도 해지로 잘못
//    라우팅되어 사용자 membership 이 'free' 로 회수되는 치명 버그가 발생함.
//    → 명시적 boolean 플래그 또는 명시적 "해지" 상태 라벨만 신호로 사용.
function isCancelSubscriptionWebhook(p: Record<string, string>): boolean {
  const truthy = (v?: string) =>
    v != null && /^(y|yes|t|true|1)$/i.test(String(v).trim());
  const stop = (v?: string) =>
    v != null && /^(cancel|stop|expire|terminate|해지)/i.test(String(v).trim());

  // 1) 명시적 cancel boolean
  if (truthy(p.rebill_cancel) || truthy(p.unsubscribe) || truthy(p.subscription_cancel)) {
    return true;
  }
  // 2) 명시적 cancel/해지 상태 라벨
  if (stop(p.rebill_status) || stop(p.subscr_status) || stop(p.subscription_status)) {
    return true;
  }
  // 3) 한글 메시지 명시
  if (p.message && /정기결제\s*해지|구독\s*해지/i.test(p.message)) return true;

  // ⚠️ 의도적으로 제거됨 — 이 분기는 false positive 가 너무 잦음:
  //    if (p.canceldate || p.cancel_at || p.stopdate) ...
  //    PayApp paid webhook 에도 미래 해지 예약일/다음 만료일 의미로 들어오므로,
  //    이걸 신호로 쓰면 정상 결제가 해지로 잘못 라우팅됨.
  //    명시적 boolean(p.rebill_cancel='y' 등) 또는 명시적 상태(p.rebill_status='cancel')
  //    가 함께 와야만 트리거.
  return false;
}

function stateLabel(state: number | null): string {
  if (state == null) return 'unknown';
  switch (state) {
    case 1: return '요청수신';
    case 4: return '결제완료';
    case 8: return '요청취소';
    case 9: return '승인취소';
    case 10: return '입금대기';
    case 32: return '요청취소';
    case 64: return '승인완료';
    case 70: return '환불';
    case 71: return '환불';
    default: return 'unknown';
  }
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

/**
 * X6.43: buildEventKey 강화
 *   - 정상 케이스: mul_no 또는 rebill_no 있으면 그대로 key 조립
 *   - fallback: 32-bit signed hash → SHA-256 hex (collision risk 사실상 0)
 *     deterministic 정렬 (Object.keys().sort()) 후 JSON 직렬화해서 동일
 *     payload 가 다른 순서로 들어와도 동일 key 보장
 */
async function buildEventKey(p: Record<string, string>): Promise<string> {
  const mul = p.mul_no ?? p.mulno ?? '';
  const rebill = p.rebill_no ?? p.rebillno ?? '';
  const state = p.pay_state ?? p.paystate ?? '';
  const price = p.price ?? '';
  if (mul || rebill) return `payapp:${mul}:${rebill}:${state}:${price}`;
  // X6.43: deterministic + SHA-256 fallback
  const keys = Object.keys(p).sort();
  const normalized = JSON.stringify(Object.fromEntries(keys.map((k) => [k, p[k]])));
  const data = new TextEncoder().encode(normalized);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `payapp:raw:${state}:${price}:${hex.slice(0, 32)}`;
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

// 운영 로그 기록 — 실패해도 webhook 처리 자체는 계속 진행
async function logOp(payload: {
  level: 'info' | 'success' | 'warning' | 'error';
  status: string;
  message: string;
  details?: Record<string, unknown>;
  related_id?: string | null;
  duration_ms?: number | null;
  error_code?: string | null;
  error_message?: string | null;
}) {
  try {
    await sb.rpc('admin_log_operation', {
      p_source: 'payapp-feedback',
      p_category: 'webhook',
      p_level: payload.level,
      p_status: payload.status,
      p_message: payload.message,
      p_details: payload.details ?? {},
      p_user_id: null,
      p_related_id: payload.related_id ?? null,
      p_duration_ms: payload.duration_ms ?? null,
      p_error_code: payload.error_code ?? null,
      p_error_message: payload.error_message ?? null,
    });
  } catch (e) {
    console.warn('[payapp-feedback] logOp failed (non-fatal):', e);
  }
}

serve(async (req) => {
  const t0 = Date.now();
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const payload = await readPayload(req);
  const eventKey = await buildEventKey(payload);
  // PayApp payload 필드명은 가맹점 설정/통보 채널마다 미세하게 다를 수 있어 후보 확장.
  const orderNo =
    pickField(payload, [
      'var1', 'order_no', 'orderno', 'orderNo',
      'order_id', 'orderid', 'custom_order_no', 'memo', 'var2',
    ]) ?? scanForSwkOrderNo(payload);
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
    if (insertErr.code === '23505') {
      await logOp({
        level: 'info', status: 'skipped',
        message: 'duplicate webhook (event_key UNIQUE conflict)',
        details: { event_key: eventKey },
        related_id: mulNo,
        duration_ms: Date.now() - t0,
      });
      return SUCCESS(); // 이미 처리됨
    }
    console.error('[payapp-feedback] insert error:', insertErr);
    await logOp({
      level: 'error', status: 'failed',
      message: 'webhook event insert failed',
      details: { event_key: eventKey, error: insertErr.message },
      related_id: mulNo,
      duration_ms: Date.now() - t0,
      error_code: insertErr.code,
      error_message: insertErr.message,
    });
    return SUCCESS(); // PayApp 재시도 폭주 방지
  }

  // webhook 수신 시작 로그
  await logOp({
    level: 'info', status: 'started',
    message: `webhook received (state=${payState ?? '?'})`,
    details: { event_key: eventKey, order_no: orderNo, payapp_mul_no: mulNo, price: priceNum, pay_state: payState },
    related_id: mulNo,
  });

  // --- 검증 실패 처리 ---
  //   order 있고 검증 실패 → price 위변조 의심 → 저장만 하고 종료
  //   order 없고 paid + mul_no → 부분 검증(userid+linkval) 통과시 진행
  const partialVerifyOk = verification.userid_ok && verification.linkval_ok && verification.linkkey_ok !== 'fail';
  const isPaidState = payState != null && PAYAPP_PAID_STATES.has(payState);
  const isRefundState = payState != null && PAYAPP_REFUND_STATES.has(payState);
  const isCancelState = payState != null && PAYAPP_CANCEL_STATES.has(payState);
  const isPendingState = payState != null && PAYAPP_PENDING_STATES.has(payState);
  const isActionable = payState != null && PAYAPP_ACTIONABLE_STATES.has(payState);
  const label = stateLabel(payState);

  if (!verification.ok) {
    if (!order && partialVerifyOk && isActionable && mulNo) {
      // fall through to router 처리
    } else {
      console.warn('[payapp-feedback] verification failed:', verification.reasons);
      await sb
        .from('payapp_webhook_events')
        .update({
          processed_at: isoNow(),
          state_label: label,
          processing_error: 'verification_failed: ' + verification.reasons.join(','),
        })
        .eq('id', insertedEvent?.id);
      await logOp({
        level: 'warning', status: 'failed',
        message: 'webhook verification failed',
        details: { reasons: verification.reasons, pay_state: payState },
        related_id: mulNo,
        duration_ms: Date.now() - t0,
        error_code: 'VERIFY_FAIL',
        error_message: verification.reasons.join(','),
      });
      return SUCCESS();
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 상태머신 처리 — _internal_apply_payapp_event(router) RPC 호출.
  //   paid (64)              → membership 활성화
  //   refund (9, 70, 71)     → membership 회수
  //   cancel (8, 32)         → 권한 변경 없음 (이미 결제 전)
  //   pending (1, 4, 10)     → 권한 변경 없음
  // ─────────────────────────────────────────────────────────────

  // 모든 필드 후보 확장 — refund/cancel 전용 키 포함
  const buyerEmail = pickField(payload, [
    'recvemail', 'buyer_email', 'email', 'recv_email', 'useremail', 'reqemail',
    '구매자이메일',
  ]);
  const buyerPhone = pickField(payload, [
    'recvphone', 'phone', 'buyer_phone', 'recv_phone', 'reqphone',
    'hp', 'cellphone', 'tel', 'mobile',
    'receiver_phone', 'receiverphone',
    '구매자번호', '구매자전화번호',
  ]);
  const goodname = pickField(payload, ['goodname', 'goodsname', 'pname']);
  const approvalNo = pickField(payload, [
    'approval_no', 'apv_no', 'card_apv_no', '승인번호',
    'approvalNo', 'approval', 'auth_no', 'authno', 'card_auth_no',
    'payapp_apv', 'card_approval', 'aprv_no', 'cardno',
  ]);
  const eventAtRaw = pickField(payload, [
    'paid_at', 'pay_date', 'paydate', 'completedate',
    'cancel_at', 'canceldate', 'refunded_at', 'refunddate',
  ]);
  const eventAt = eventAtRaw
    ? new Date(eventAtRaw.replace(' ', 'T') + (eventAtRaw.includes('+') ? '' : '+09:00')).toISOString()
    : isoNow();

  // ─────────────────────────────────────────────────────────────
  // 정기결제 해지 (subscription cancel) — pay_state 와 별개로 raw_payload 로 판단.
  //
  // ⚠️ 절대 paid state(64) 에서 트리거 금지. PayApp 가 paid webhook 에 미래
  //    해지 예약일 등을 echo 하는 경우 isCancelSubscriptionWebhook 의 잔여 false
  //    positive 가 있어도 paid 우선 처리 보장.
  // ─────────────────────────────────────────────────────────────
  const isSubCancel =
    !isCancelState && !isRefundState && !isPaidState && isCancelSubscriptionWebhook(payload);
  if (isSubCancel && mulNo) {
    const cancelReason =
      pickField(payload, ['cancel_reason', 'reason', '사유']) ?? 'PayApp 정기결제 해지';
    const { data: cancelData, error: cancelErr } = await sb.rpc(
      '_internal_apply_payapp_subscription_cancel_event',
      {
        p_payapp_mul_no: mulNo,
        p_payapp_rebill_no: rebillNo,
        p_reason: cancelReason,
        p_event_at: eventAt,
        p_source: 'webhook_subscription_cancel',
      },
    );
    const cancelRow = (Array.isArray(cancelData) ? cancelData[0] : cancelData) as
      | {
          matched_user_id: string | null;
          matched_order_id: string | null;
          matched_subscription_id: string | null;
          membership_updated: boolean;
          final_membership_tier: string | null;
          message: string;
        }
      | undefined;

    await sb
      .from('payapp_webhook_events')
      .update({
        matched_user_id: cancelRow?.matched_user_id ?? null,
        matched_order_id: cancelRow?.matched_order_id ?? null,
        matched_subscription_id: cancelRow?.matched_subscription_id ?? null,
        membership_updated: !!cancelRow?.membership_updated,
        final_membership_tier: cancelRow?.final_membership_tier ?? null,
        state_label: '정기결제 해지',
        processing_error: cancelErr?.message ?? (cancelRow?.membership_updated ? null : cancelRow?.message ?? null),
        processed_at: isoNow(),
      })
      .eq('id', insertedEvent?.id);

    await logOp({
      level: cancelRow?.membership_updated ? 'success' : 'warning',
      status: cancelRow?.membership_updated ? 'subscription_canceled' : 'failed',
      message: cancelRow?.membership_updated
        ? `정기결제 해지 반영 완료 (mul_no=${mulNo})`
        : `정기결제 해지 매칭 실패 (mul_no=${mulNo})`,
      details: {
        mul_no: mulNo,
        rebill_no: rebillNo,
        cancel_reason: cancelReason,
        matched_user_id: cancelRow?.matched_user_id,
        rpc_error: cancelErr?.message ?? null,
      },
      related_id: mulNo,
      duration_ms: Date.now() - t0,
      error_code: cancelErr?.code ?? null,
      error_message: cancelErr?.message ?? null,
    });

    return SUCCESS();
  }

  if (isActionable && mulNo && payState != null) {
    const planType = planFromAmount(priceNum) ?? (order?.plan_type as 'individual' | 'business' | undefined);
    const amount = priceNum ?? order?.amount ?? null;

    const { data: applyData, error: applyErr } = await sb.rpc('_internal_apply_payapp_event', {
      p_payapp_mul_no: mulNo,
      p_pay_state: payState,
      p_amount: amount,
      p_plan_type: planType ?? 'individual',
      p_buyer_email: buyerEmail,
      p_buyer_phone: buyerPhone,
      p_event_at: eventAt,
      p_approval_no: approvalNo,
      p_goodname: goodname,
      p_order_no: orderNo,
      p_source: 'webhook',
      // 0047: RPC 가 var1/memo/문자열 어디든 swk_ 패턴 스캔할 수 있도록 raw payload 전달
      p_raw_payload: payload,
    });

    const row = (Array.isArray(applyData) ? applyData[0] : applyData) as
      | {
          matched_user_id: string | null;
          matched_order_id: string | null;
          matched_subscription_id: string | null;
          membership_updated: boolean;
          final_membership_tier: string | null;
          final_status: string;
          message: string;
        }
      | undefined;

    if (applyErr || !row) {
      console.warn('[payapp-feedback] router apply failed:', applyErr?.message);
      await sb
        .from('payapp_webhook_events')
        .update({
          processed_at: isoNow(),
          state_label: label,
          processing_error: applyErr?.message ?? 'router returned empty',
        })
        .eq('id', insertedEvent?.id);
      await logOp({
        level: 'error', status: 'failed',
        message: `router apply failed (state=${payState})`,
        details: { mul_no: mulNo, amount, plan_type: planType },
        related_id: mulNo,
        duration_ms: Date.now() - t0,
        error_code: 'ROUTER_FAIL',
        error_message: applyErr?.message ?? 'empty result',
      });
      return SUCCESS();
    }

    // paid + 매칭 실패 → manual_imports 큐 (UI 1-클릭 연결)
    if (isPaidState && !row.matched_user_id && amount && planType) {
      await sb.from('payapp_manual_payment_imports').upsert(
        {
          payapp_mul_no: mulNo,
          approval_no: approvalNo,
          buyer_email: buyerEmail,
          buyer_phone: buyerPhone,
          amount,
          plan_type: planType,
          goodname,
          paid_at: eventAt,
          status: 'unmatched',
          raw_payload: { ...payload, _source: 'webhook_unmatched' },
          created_by: null,
        },
        { onConflict: 'payapp_mul_no' },
      );
    }

    // event row writeback
    await sb
      .from('payapp_webhook_events')
      .update({
        matched_user_id: row.matched_user_id,
        matched_order_id: row.matched_order_id,
        matched_subscription_id: row.matched_subscription_id,
        membership_updated: row.membership_updated,
        final_membership_tier: row.final_membership_tier,
        state_label: label,
        processing_error: row.membership_updated ? null : row.message,
        processed_at: isoNow(),
      })
      .eq('id', insertedEvent?.id);

    // 결과 로그 — paid / refunded / cancel / unmatched 분기
    const finalStatus = row.final_status ?? 'unknown';
    const logLevel: 'success' | 'warning' | 'error' = row.membership_updated
      ? 'success'
      : finalStatus === 'unmatched' || finalStatus === 'pending'
        ? 'warning'
        : 'error';
    await logOp({
      level: logLevel,
      status: finalStatus === 'paid'
        ? 'completed'
        : finalStatus === 'refunded' || finalStatus === 'canceled'
          ? 'completed'
          : 'pending',
      message: `state=${payState} → ${finalStatus}` +
        (row.final_membership_tier ? ` (tier=${row.final_membership_tier})` : ''),
      details: {
        mul_no: mulNo, amount, plan_type: planType,
        matched_user_id: row.matched_user_id, final_status: finalStatus,
        is_paid_state: isPaidState, is_refund_state: isRefundState, is_cancel_state: isCancelState,
      },
      related_id: mulNo,
      duration_ms: Date.now() - t0,
    });

    return SUCCESS();
  }

  // pending state (1, 4, 10) 라도 admin 진단 UI 에서 어느 user 의 결제인지 보이게
  // matched_user_id / matched_order_id 만 update (tier 변경 없음).
  // _internal_match_user_for_event RPC 가 var1/raw_payload swk_/mul_no/email 순서로 lookup.
  let pendingMatchUserId: string | null = order?.user_id ?? null;
  let pendingMatchOrderId: string | null = order?.id ?? null;
  if (!pendingMatchUserId || !pendingMatchOrderId) {
    try {
      const { data: matchData } = await sb.rpc('_internal_match_user_for_event', {
        p_order_no: orderNo,
        p_payapp_mul_no: mulNo,
        p_buyer_email: buyerEmail,
        p_raw_payload: payload,
      });
      const matchRow = (Array.isArray(matchData) ? matchData[0] : matchData) as
        | { matched_user_id: string | null; matched_order_id: string | null }
        | undefined;
      pendingMatchUserId = pendingMatchUserId ?? matchRow?.matched_user_id ?? null;
      pendingMatchOrderId = pendingMatchOrderId ?? matchRow?.matched_order_id ?? null;
    } catch (e) {
      console.warn('[payapp-feedback] _internal_match_user_for_event error:', String(e));
    }
  }

  if (!order) {
    await sb
      .from('payapp_webhook_events')
      .update({
        processed_at: isoNow(),
        state_label: label,
        matched_user_id: pendingMatchUserId,
        matched_order_id: pendingMatchOrderId,
      })
      .eq('id', insertedEvent?.id);
    await logOp({
      level: 'info', status: 'skipped',
      message: `non-actionable state=${payState} (${label}), no payment_orders.var1 match` +
        (pendingMatchUserId ? ` — matched user via fallback: ${pendingMatchUserId}` : ''),
      details: { mul_no: mulNo, pay_state: payState, fallback_user: pendingMatchUserId, fallback_order: pendingMatchOrderId },
      related_id: mulNo,
      duration_ms: Date.now() - t0,
    });
    return SUCCESS();
  }

  if (payState === 1 || payState === 4) {
    await sb.from('payment_orders')
      .update({ status: 'requested', raw_response: payload, payapp_state: payState, payapp_state_label: label })
      .eq('id', order.id);
    if (order.subscription_id) {
      await sb
        .from('subscriptions')
        .update({ status: 'pending', payapp_pay_state: payState, payapp_state_label: label })
        .eq('id', order.subscription_id);
    }
  } else if (payState === 10) {
    await sb.from('payment_orders')
      .update({ status: 'waiting', raw_response: payload, payapp_state: 10, payapp_state_label: label })
      .eq('id', order.id);
    if (order.subscription_id) {
      await sb
        .from('subscriptions')
        .update({ status: 'payment_waiting', payapp_pay_state: 10, payapp_state_label: label })
        .eq('id', order.subscription_id);
    }
  }
  // isActionable 가 false 이고 pending 도 아닌 unknown state → 이벤트만 기록

  await sb
    .from('payapp_webhook_events')
    .update({
      processed_at: isoNow(),
      state_label: label,
      matched_user_id: pendingMatchUserId,
      matched_order_id: pendingMatchOrderId,
    })
    .eq('id', insertedEvent?.id);

  return SUCCESS();
});
