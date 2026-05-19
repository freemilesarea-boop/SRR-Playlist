/**
 * admin-trigger-password-reset
 *
 * 운영자가 회원 비밀번호 재설정 메일을 사용자에게 발송하도록 trigger.
 * 비밀번호 원문은 어디서도 노출되지 않음 (Supabase Auth bcrypt only).
 *
 * 흐름:
 *  1) admin Bearer 검증 (users.role='admin')
 *  2) self 방지 (자기 자신에게 재설정 메일 의미 없음 — 본인이면 /login 에서 직접 사용)
 *  3) target 의 auth.users.email 조회 (없으면 reject)
 *  4) supabase.auth.resetPasswordForEmail(email, {redirectTo: ${APP_PUBLIC_URL}/auth/reset})
 *     - 사용자가 받는 magic link 가 /auth/reset 으로 안내
 *  5) admin_log_operation 기록
 *
 * 인증: admin Bearer only (cron 시나리오 없음)
 * 메서드: POST { user_id: uuid }
 */
// @ts-ignore Deno deploy
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: { env: { get(k: string): string | undefined } };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// @ts-ignore Deno serve
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const APP_PUBLIC_URL = Deno.env.get('APP_PUBLIC_URL') || 'https://deudda.com';

  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE) {
    return json({ error: 'server misconfigured' }, 500);
  }

  // admin Bearer 검증
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'unauthorized' }, 401);

  const sbUser = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const sbAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const { data: userRes, error: userErr } = await sbUser.auth.getUser();
  if (userErr || !userRes?.user) return json({ error: 'unauthorized' }, 401);
  const callerId = userRes.user.id;

  const { data: callerRow } = await sbAdmin
    .from('users').select('role').eq('id', callerId).maybeSingle();
  if (!callerRow || (callerRow as { role?: string }).role !== 'admin') {
    return json({ error: 'admin only' }, 403);
  }

  // body
  let body: { user_id?: string } = {};
  try { body = await req.json(); } catch { /* allow empty */ }
  const targetId = (body.user_id ?? '').trim();
  if (!targetId) return json({ error: 'user_id required' }, 400);
  if (targetId === callerId) return json({ error: 'self-protection: 자기 자신에게 보낼 수 없어요' }, 400);

  // target 이메일 조회 (service_role 로 auth.users 접근)
  const { data: targetAuth, error: targetErr } = await sbAdmin.auth.admin.getUserById(targetId);
  if (targetErr || !targetAuth?.user?.email) {
    return json({ error: 'target user not found or has no email' }, 404);
  }
  const targetEmail = targetAuth.user.email;

  // 재설정 메일 발송 — Supabase Auth 가 alerting magic link 발송
  // redirectTo 는 사용자가 메일 링크 클릭 시 이동할 페이지 (deudda.com/auth/reset)
  const { error: resetErr } = await sbAdmin.auth.resetPasswordForEmail(targetEmail, {
    redirectTo: `${APP_PUBLIC_URL}/auth/reset`,
  });

  // audit log
  try {
    await sbAdmin.rpc('admin_log_operation', {
      p_source: 'admin_member_actions',
      p_category: 'member',
      p_level: resetErr ? 'error' : 'info',
      p_status: resetErr ? 'failed' : 'completed',
      p_message: `password reset email triggered for user ${targetId}`,
      p_details: { user_id: targetId, target_email_hash: hashLite(targetEmail), error: resetErr?.message ?? null },
      p_user_id: targetId,
      p_related_id: targetId,
      p_duration_ms: null,
      p_error_code: resetErr ? 'RESET_FAILED' : null,
      p_error_message: resetErr?.message ?? null,
    });
  } catch { /* silent — admin_log_operation 은 절대 caller 차단 안 함 */ }

  if (resetErr) {
    return json({ error: 'reset failed', detail: resetErr.message }, 502);
  }

  return json({ ok: true, sent_to_hash: hashLite(targetEmail) });
});

/** 이메일을 audit log 에 평문으로 남기지 않기 위한 light 해시 (PII 보호) */
function hashLite(s: string): string {
  // sha-256 비동기는 무거우므로 간단한 fingerprint — 운영 디버깅용
  // 정확한 검증이 필요한 경우 SUPABASE 에서 user_id 로 lookup
  const head = s.slice(0, 2);
  const tail = s.slice(s.indexOf('@'));
  return `${head}***${tail}`;
}
