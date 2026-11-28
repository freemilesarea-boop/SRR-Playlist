// payapp-arrears-feedback — 연체분 결제요청 전용 결제통보 수신기.
//
// 왜 기존 payapp-feedback 을 안 쓰나:
//   그쪽은 결제를 "오늘부터 한 달"로 본다. 일반 갱신엔 맞지만 연체분은
//   과거 회차를 받는 것이라 틀린다. 실측(2026-11-01): 7월분 4,900원을
//   받았는데 period_end 가 2026-07-15 → 2026-12-01 로 점프해 남은 3회차
//   (14,700원)가 통째로 사라졌다.
//
// 이 함수는 실무를 하지 않는다. 검증하고 apply_arrears_payment RPC 를 부른다.
// 기간 계산·멱등·금액검증은 전부 그 RPC 안에서 원자적으로 돌아간다.
//
// 응답은 언제나 200 'SUCCESS' — PayApp 재통보 폭주를 막는 게 우선이고,
// 판단 근거는 DB 에 남긴다(기존 payapp-feedback 과 같은 방침).

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

function pick(p: Record<string, string>, keys: string[]): string | null {
  for (const k of keys) {
    const v = p[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

function toInt(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^0-9-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return SUCCESS();

  let payload: Record<string, string> = {};
  try {
    const raw = await req.text();
    const trimmed = raw.trim();
    if (trimmed.startsWith('{')) {
      try { payload = JSON.parse(trimmed) as Record<string, string>; } catch { payload = {}; }
    }
    if (Object.keys(payload).length === 0) {
      for (const [k, v] of new URLSearchParams(raw).entries()) payload[k] = v;
    }
  } catch {
    return SUCCESS();
  }

  // 가맹점 검증. 불일치면 반영하지 않는다 — 위조 통보로 기간을 밀 수는 없다.
  const userid = pick(payload, ['userid']);
  const linkval = pick(payload, ['linkval']);
  const linkkey = pick(payload, ['linkkey']);
  const verified =
    !!PAYAPP_USERID && userid === PAYAPP_USERID &&
    (!PAYAPP_LINKVAL || !linkval || linkval === PAYAPP_LINKVAL) &&
    (!PAYAPP_LINKKEY || !linkkey || linkkey === PAYAPP_LINKKEY);

  const orderNo = pick(payload, ['var1', 'order_no', 'orderno']);
  const mulNo = pick(payload, ['mul_no', 'mulno']);
  const payState = toInt(pick(payload, ['pay_state', 'paystate', 'state']));
  const price = toInt(pick(payload, ['price']));

  if (!verified) {
    console.warn('[arrears-feedback] verification failed', { order_no: orderNo, mul_no: mulNo });
    return SUCCESS();
  }
  if (!orderNo || payState == null) return SUCCESS();

  try {
    const { data, error } = await sb.rpc('apply_arrears_payment', {
      p_order_no: orderNo,
      p_mul_no: mulNo,
      p_pay_state: payState,
      p_amount: price,
      p_raw: payload,
    });
    if (error) {
      console.error('[arrears-feedback] rpc failed', error.code, error.message);
    } else {
      console.log('[arrears-feedback] applied', JSON.stringify(data));
    }
  } catch (e) {
    console.error('[arrears-feedback] unexpected', String(e));
  }

  return SUCCESS();
});
