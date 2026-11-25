// supabase/functions/payapp-rebill-fail/index.ts
//
// PayApp 정기결제 failurl 수신기 — 2회차+ 승인 실패 노티(pay_state=99).
//
// 왜 필요한가:
//   정기결제 등록(rebillRegist)의 failurl 이 React 화면(/payment/fail)으로 걸려 있었다.
//   PayApp 은 그 주소로 POST 하고 HTTP 200 + 본문 'SUCCESS' 를 기다리는데, 화면은 HTML 을
//   돌려준다. 문서상 성공 응답이 아니면 재통보 후 포기이므로 실패가 한 건도 기록되지 않았다.
//   회원 16명이 "성공도 실패도 없이" 조용히 끊긴 이유가 이것이다.
//
// 설계 원칙:
//   1) 응답은 언제나 200 'SUCCESS'. 검증 실패든 DB 오류든 마찬가지다. PayApp 재통보
//      폭주를 막는 게 우선이고, 판단 근거는 verified 컬럼과 raw_payload 로 남긴다.
//      (기존 payapp-feedback 과 같은 방침)
//   2) 결제 webhook 테이블에 섞지 않는다. 그쪽은 트리거가 결제 주문을 만들기 때문에
//      실패 건을 넣으면 매출이 오염된다.
//   3) 이 함수는 기록만 한다. 구독 상태를 바꾸거나 회원 권한을 내리지 않는다 —
//      실패 1회로 해지 처리하면 일시적 한도 초과에도 서비스가 끊긴다.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PAYAPP_USERID = Deno.env.get('PAYAPP_USERID') ?? '';
const PAYAPP_LINKKEY = Deno.env.get('PAYAPP_LINKKEY') ?? '';
const PAYAPP_LINKVAL = Deno.env.get('PAYAPP_LINKVAL') ?? '';

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

/** PayApp 은 본문이 정확히 'SUCCESS' 여야 재통보를 멈춘다. */
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

/**
 * 같은 실패가 재통보돼도 한 행만 남기기 위한 키.
 * rebill_no + mul_no 조합이 가장 안정적이고, 둘 다 없으면 날짜까지 섞어 최소한 중복을 줄인다.
 */
function eventKey(p: Record<string, string>): string {
  const rebill = pick(p, ['rebill_no', 'rebillno', 'rebillNo']) ?? 'norebill';
  const mul = pick(p, ['mul_no', 'mulno', 'mulNo']) ?? 'nomul';
  const when = pick(p, ['responsedate', 'pay_date', 'reqdate']) ?? '';
  return `rebillfail:${rebill}:${mul}:${when}`;
}

serve(async (req: Request): Promise<Response> => {
  // PayApp 은 POST 로만 호출한다. 그 외 메서드도 조용히 200 으로 닫는다.
  if (req.method !== 'POST') return SUCCESS();

  let payload: Record<string, string> = {};
  try {
    const raw = await req.text();
    const trimmed = raw.trim();
    // JSON 을 먼저 가린다. URLSearchParams 는 '{"a":1}' 도 키 1개로 파싱해버려서,
    // form 을 먼저 시도하면 JSON 본문이 쓰레기 키 하나로 들어온다.
    if (trimmed.startsWith('{')) {
      try {
        payload = JSON.parse(trimmed) as Record<string, string>;
      } catch {
        payload = {};
      }
    }
    if (Object.keys(payload).length === 0) {
      // PayApp 의 실제 호출 경로 — application/x-www-form-urlencoded.
      const form = new URLSearchParams(raw);
      for (const [k, v] of form.entries()) payload[k] = v;
    }
  } catch {
    // 파싱 실패해도 재통보를 유발하지 않는다. 남길 게 없으니 그대로 종료.
    return SUCCESS();
  }

  // 가맹점 검증. 불일치해도 기록은 남기되 verified=false 로 구분한다.
  const userid = pick(payload, ['userid']);
  const linkval = pick(payload, ['linkval']);
  const linkkey = pick(payload, ['linkkey']);
  const verified =
    !!PAYAPP_USERID && userid === PAYAPP_USERID &&
    (!PAYAPP_LINKVAL || !linkval || linkval === PAYAPP_LINKVAL) &&
    (!PAYAPP_LINKKEY || !linkkey || linkkey === PAYAPP_LINKKEY);

  const rebillNo = pick(payload, ['rebill_no', 'rebillno', 'rebillNo']);

  // rebill_no 로 구독을 역추적한다. 못 찾으면 null 로 두고 raw 로 조사한다.
  let subscriptionId: string | null = null;
  let userId: string | null = null;
  if (rebillNo) {
    const { data } = await sb
      .from('subscriptions')
      .select('id, user_id')
      .eq('payapp_rebill_no', rebillNo)
      .order('created_at', { ascending: false })
      .limit(1);
    if (data && data.length > 0) {
      subscriptionId = data[0].id as string;
      userId = data[0].user_id as string;
    }
  }

  const row = {
    event_key: eventKey(payload),
    rebill_no: rebillNo,
    mul_no: pick(payload, ['mul_no', 'mulno', 'mulNo']),
    pay_state: toInt(pick(payload, ['pay_state', 'paystate', 'state'])),
    result_msg: pick(payload, ['ResultMsg', 'resultmsg', 'result_msg', 'errorMessage', 'errmsg', 'memo']),
    price: toInt(pick(payload, ['price', 'goodprice'])),
    goodname: pick(payload, ['goodname']),
    verified,
    subscription_id: subscriptionId,
    user_id: userId,
    raw_payload: payload,
  };

  // event_key UNIQUE 충돌(= 재통보)은 정상 동작이므로 무시한다.
  const { error } = await sb.from('payapp_rebill_failures').insert(row);
  if (error && error.code !== '23505') {
    console.error('[payapp-rebill-fail] insert failed', error.code, error.message);
  }

  return SUCCESS();
});
