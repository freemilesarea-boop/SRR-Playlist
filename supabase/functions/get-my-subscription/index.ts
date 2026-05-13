// supabase/functions/get-my-subscription/index.ts
//
// 현재 로그인 사용자의 최신 구독을 반환. 결제 성공 페이지에서 polling.
//
// deno-lint-ignore-file no-explicit-any

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'unauthorized' }, 401);

  const sb = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  // RLS 가 본인 행만 반환
  const { data, error } = await sb
    .from('subscriptions')
    .select(
      'id, plan_type, status, price, current_period_start, current_period_end, ' +
        'last_paid_at, canceled_at, payapp_rebill_no, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return json({ error: error.message }, 500);

  return json({
    subscription: data ?? null,
    cancelable: !!data && ['active', 'pending', 'payment_waiting'].includes(data.status),
  });
});
