// supabase/functions/cancel-payapp-subscription/index.ts
//
// 사용자 self-cancel:
//   1) PayApp rebillCancel 호출 (자동결제 실제 중단)
//   2) DB: status='cancel_scheduled', auto_renew=false, cancel_requested_at, cancel_reason
//   3) membership_tier 는 안 건드림 — current_period_end 까지 grace
//
// PayApp 해지 webhook 도착 시 0056 의 _internal_apply_payapp_subscription_cancel_event
// 가 grace period 분기에서 membership 유지.

// deno-lint-ignore-file no-explicit-any

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PAYAPP_USERID = Deno.env.get('PAYAPP_USERID') ?? '';
const PAYAPP_LINKKEY = Deno.env.get('PAYAPP_LINKKEY') ?? '';
const PAYAPP_API_URL = Deno.env.get('PAYAPP_API_URL') ?? 'https://api.payapp.kr/oapi/apiLoad.html';

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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'unauthorized' }, 401);

  const sbUser = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userRes } = await sbUser.auth.getUser();
  if (!userRes?.user) return json({ error: 'unauthorized' }, 401);
  const user = userRes.user;

  let body: { subscription_id?: string; reason?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid body' }, 400);
  }
  const subId = body.subscription_id;
  const reason = body.reason ?? 'user_request';
  if (!subId) return json({ error: 'missing subscription_id' }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const { data: sub } = await sb
    .from('subscriptions')
    .select('id, user_id, status, payapp_rebill_no, current_period_end')
    .eq('id', subId)
    .maybeSingle();

  if (!sub) return json({ error: 'subscription not found' }, 404);
  if (sub.user_id !== user.id) return json({ error: 'forbidden' }, 403);
  if (!['active', 'pending', 'payment_waiting'].includes(sub.status)) {
    return json({ error: `cannot cancel: status=${sub.status}` }, 400);
  }

  // 1) PayApp 정기결제 해지 — 등록된 rebill_no 가 있을 때만
  let payappOk = true;
  let payappRaw: string | null = null;
  if (sub.payapp_rebill_no) {
    const params = new URLSearchParams();
    params.set('cmd', 'rebillCancel');
    params.set('userid', PAYAPP_USERID);
    params.set('rebill_no', sub.payapp_rebill_no);
    params.set('linkkey', PAYAPP_LINKKEY);
    try {
      const resp = await fetch(PAYAPP_API_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      payappRaw = await resp.text();
      const parsed = Object.fromEntries(new URLSearchParams(payappRaw).entries());
      // state=1 성공. 그 외는 실패로 간주하되, "이미 해지됨" 류는 OK 취급.
      if (parsed.state !== '1') {
        const msg = (parsed.errmsg ?? '').toString();
        // 이미 해지된 케이스는 우리 입장에선 성공
        if (/already|이미|해지/i.test(msg)) {
          payappOk = true;
        } else {
          payappOk = false;
          console.warn('[cancel-payapp] PayApp rebillCancel failed:', payappRaw);
        }
      }
    } catch (e) {
      payappOk = false;
      console.warn('[cancel-payapp] network error', e);
    }
  }

  // PayApp 해지가 실패했으면 DB 상태 변경하지 않음 — 자동결제가 계속 도는 상황 방지
  if (!payappOk) {
    return json(
      {
        error: 'payapp_cancel_failed',
        message: 'PayApp 자동결제 해지에 실패했어요. 잠시 후 다시 시도하거나 고객센터로 문의해주세요.',
        payapp_raw: payappRaw,
      },
      502,
    );
  }

  // 2) DB 상태 변경 — RPC 호출 (auth.uid() 가 RLS/검증에 쓰임 → user JWT 클라이언트로)
  const { data: rpcRows, error: rpcError } = await sbUser.rpc('user_cancel_my_subscription', {
    p_subscription_id: subId,
    p_reason: reason,
  });
  if (rpcError) {
    return json({ error: 'db_update_failed', message: rpcError.message }, 500);
  }
  const row = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;

  return json({
    ok: true,
    subscription_id: subId,
    status: 'cancel_scheduled',
    current_period_end: row?.current_period_end ?? sub.current_period_end ?? null,
    message:
      '구독이 취소 예약됐어요. 현재 결제 기간이 끝날 때까지 Premium 기능을 이용할 수 있어요.',
  });
});
