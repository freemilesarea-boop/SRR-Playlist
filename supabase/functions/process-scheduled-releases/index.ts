// supabase/functions/process-scheduled-releases/index.ts
//
// 예약 발매 worker — release_status='scheduled' 인 트랙 중 release_date <= today 인
// 트랙을 released 로 일괄 전환. 실패는 release_failures 에 기록 (RPC 내부에서 처리).
//
// 인증:
//   - admin Bearer token   → admin only RPC 권한
//   - x-cron-secret 헤더    → 환경 변수 CRON_SECRET 과 일치 시 service_role 호출
//
// 호출 예:
//   POST /process-scheduled-releases   (admin Bearer token)
//   POST /process-scheduled-releases   (x-cron-secret: ...)

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MODULE_LOAD_AT = new Date().toISOString();

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', ...corsHeaders },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';

  // 인증: admin Bearer token 또는 x-cron-secret 헤더
  const authHeader = req.headers.get('authorization') ?? '';
  const cronSecret = req.headers.get('x-cron-secret') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  const sbAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  let mode: 'admin' | 'cron' | null = null;
  if (CRON_SECRET && cronSecret && cronSecret === CRON_SECRET) {
    mode = 'cron';
  } else if (token) {
    const sbUser = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userRes } = await sbUser.auth.getUser();
    if (userRes?.user) {
      const { data: u } = await sbAdmin.from('users').select('role').eq('id', userRes.user.id).maybeSingle();
      if (u && (u as { role?: string }).role === 'admin') mode = 'admin';
    }
  }
  if (!mode) return json({ error: 'unauthorized (admin token or x-cron-secret required)' }, 401);

  console.log('[scheduled-releases] starting', { mode, module_load_at: MODULE_LOAD_AT });

  const { data, error } = await sbAdmin.rpc('process_due_scheduled_releases');
  if (error) {
    console.error('[scheduled-releases] RPC failed:', error);
    return json({ ok: false, error: error.message }, 500);
  }
  const rows = (data ?? []) as Array<{ track_id: string; track_code: string | null; status: string; error: string | null }>;
  const released = rows.filter((r) => r.status === 'released').length;
  const failed = rows.filter((r) => r.status === 'failed').length;

  // 0083 — 실패 발생 시 admin_notifications 적립 (silent 실패)
  let hasNewError = false;
  if (failed > 0) {
    try {
      for (const r of rows.filter((x) => x.status === 'failed').slice(0, 10)) {
        await sbAdmin.rpc('create_admin_notification', {
          p_kind: 'scheduled_release_failed',
          p_severity: 'error',
          p_title: `예약 발매 실패 — ${r.track_code ?? r.track_id.slice(0, 8)}`,
          p_body: r.error ?? 'unknown',
          p_context: { released, failed, total: rows.length },
          p_track_id: r.track_id,
        });
      }
      hasNewError = true;
    } catch (e) {
      console.error('[scheduled-releases] notification enqueue failed (continuing):', e);
    }
  } else if (released > 0) {
    // 성공 요약 (info) — 5건 이상만
    if (released >= 5) {
      try {
        await sbAdmin.rpc('create_admin_notification', {
          p_kind: 'worker_summary',
          p_severity: 'info',
          p_title: `예약 발매 — ${released}건 공개됨`,
          p_body: `처리 ${rows.length}건 / released ${released}`,
          p_context: { released, failed, total: rows.length },
          p_track_id: null,
        });
      } catch (e) {
        console.error('[scheduled-releases] info notification failed (continuing):', e);
      }
    }
  }

  // 0093 — 외부 채널 dispatch (error 만 자동 전파, info 요약은 admin_settings.min_severity 가드)
  if (hasNewError) {
    try {
      const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      await sbAdmin.functions.invoke('dispatch-admin-notifications', {
        body: { since_ts: since, limit: 50 },
      });
    } catch (e) {
      console.error('[scheduled-releases] external notify dispatch failed (continuing):', e);
    }
  }

  console.log('[scheduled-releases] done', { mode, processed: rows.length, released, failed });
  return json({ ok: true, mode, processed: rows.length, released, failed, results: rows });
});
