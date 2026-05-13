// supabase/functions/cancel-payapp-subscription/index.ts
//
// PayApp 정기결제 해지 (rebillCancel) 요청.
// MVP 정책: 즉시 free 다운그레이드.
//
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

  let body: { subscription_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid body' }, 400);
  }
  const subId = body.subscription_id;
  if (!subId) return json({ error: 'missing subscription_id' }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const { data: sub } = await sb
    .from('subscriptions')
    .select('id, user_id, status, payapp_rebill_no')
    .eq('id', subId)
    .maybeSingle();

  if (!sub) return json({ error: 'subscription not found' }, 404);
  if (sub.user_id !== user.id) return json({ error: 'forbidden' }, 403);
  if (!['active', 'pending', 'payment_waiting'].includes(sub.status)) {
    return json({ error: `cannot cancel: status=${sub.status}` }, 400);
  }

  // PayApp 에 등록된 rebill_no 가 있으면 해지 요청
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
      const text = await resp.text();
      const parsed = Object.fromEntries(new URLSearchParams(text).entries());
      if (parsed.state !== '1') {
        // PayApp 에서 거부 — 그대로 진행하되 로그 남김
        console.warn('[cancel-payapp] PayApp rebillCancel failed:', text);
      }
    } catch (e) {
      console.warn('[cancel-payapp] network error', e);
    }
  }

  // 내부 상태 즉시 canceled + free 다운그레이드
  await sb
    .from('subscriptions')
    .update({ status: 'canceled', canceled_at: new Date().toISOString() })
    .eq('id', sub.id);

  await sb
    .from('users')
    .update({ membership_tier: 'free', subscription_type: 'free' })
    .eq('id', user.id);

  return json({ ok: true });
});
