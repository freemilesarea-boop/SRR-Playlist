/**
 * notify-new-inquiry — Phase X6.2.10
 *
 * 사용자 폼 제출 직후 클라이언트가 호출 → 운영자에게 즉시 이메일 발송.
 *
 * 권한:
 *   - verify_jwt=true (인증된 사용자만)
 *   - 본인 문의 inquiry_id 만 통과 (또는 admin)
 *
 * 동작:
 *   1. JWT 검증 → user_id
 *   2. support_inquiries 조회 → user_id 일치/admin 검증
 *   3. admin_settings 읽기 (notification_email_enabled / _to / _min_severity)
 *   4. Resend API 로 이메일 발송
 *   5. 결과 반환 (실패해도 클라이언트 흐름 차단 X)
 *
 * 환경변수:
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 *   RESEND_API_KEY, RESEND_FROM (선택, 기본 "듣다 운영 <no-reply@deudda.com>")
 */
import { serve } from 'https://deno.land/std@0.220.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SEV_RANK: Record<string, number> = { info: 0, warning: 1, error: 2 };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
  const RESEND_FROM = Deno.env.get('RESEND_FROM') || '듣다 운영 <no-reply@deudda.com>';

  // 1. JWT 검증
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'unauthorized' }, 401);

  const sbUser = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userRes } = await sbUser.auth.getUser();
  if (!userRes?.user) return json({ error: 'unauthorized' }, 401);
  const userId = userRes.user.id;

  // 2. body 검증
  let body: { inquiry_id?: string } = {};
  try { body = await req.json(); } catch { /* empty body OK */ }
  const inquiryId = body.inquiry_id;
  if (!inquiryId) return json({ error: 'missing inquiry_id' }, 400);

  const sbAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // 3. 문의 row 가져오기 + 소유자/admin 검증
  const { data: inq, error: inqErr } = await sbAdmin
    .from('support_inquiries')
    .select('id, user_id, user_email, user_role, inquiry_type, title, body, priority, contact_phone, wants_kakao_contact, current_page_url, context, created_at')
    .eq('id', inquiryId)
    .maybeSingle();

  if (inqErr || !inq) {
    return json({ ok: false, error: 'inquiry_not_found' }, 404);
  }

  // 소유자 OR admin 만 dispatch 가능
  if (inq.user_id !== userId) {
    const { data: roleRow } = await sbAdmin.from('users').select('role').eq('id', userId).maybeSingle();
    if (!roleRow || roleRow.role !== 'admin') {
      return json({ error: 'forbidden' }, 403);
    }
  }

  // 4. admin_settings 읽기
  const { data: settings } = await sbAdmin
    .from('admin_settings')
    .select('key, value')
    .in('key', ['notification_email_enabled', 'notification_email_to', 'notification_min_severity']);

  const settingsMap: Record<string, unknown> = {};
  for (const row of settings ?? []) settingsMap[(row as any).key] = (row as any).value;

  const emailEnabled = settingsMap.notification_email_enabled === true;
  const emailToRaw = typeof settingsMap.notification_email_to === 'string'
    ? settingsMap.notification_email_to as string : '';
  const minSeverity = typeof settingsMap.notification_min_severity === 'string'
    ? settingsMap.notification_min_severity as string : 'info';

  // 우선순위 → severity 매핑 (RPC 의 매핑과 일치)
  const severity = inq.priority === 'urgent' ? 'error'
                 : inq.priority === 'high' ? 'warning' : 'info';

  if (!emailEnabled) {
    return json({ ok: false, skipped: 'email_disabled' });
  }
  if (!emailToRaw) {
    return json({ ok: false, skipped: 'email_to_empty' });
  }
  if (!RESEND_API_KEY) {
    return json({ ok: false, skipped: 'resend_api_key_missing' });
  }
  if (SEV_RANK[severity] < SEV_RANK[minSeverity]) {
    return json({ ok: false, skipped: `severity_below_min (${severity} < ${minSeverity})` });
  }

  const emailTo = emailToRaw.split(',').map((s) => s.trim()).filter(Boolean);

  // 5. Resend 발송
  const subject = `[DEUDDA 문의] ${inq.inquiry_type} - ${inq.title}`.slice(0, 180);
  const html = `<!DOCTYPE html><html lang="ko"><body style="font-family:-apple-system,sans-serif;background:#f4f4f5;padding:24px;color:#18181b;">
<div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;">
  <h2 style="margin:0 0 12px;">📬 신규 문의: ${escapeHtml(inq.inquiry_type)}</h2>
  <h3 style="margin:0 0 12px;color:#3f3f46;">${escapeHtml(inq.title)}</h3>
  <table style="font-size:13px;line-height:1.7;width:100%;">
    <tr><td style="color:#71717a;width:120px;">우선순위</td><td><b style="color:${inq.priority === 'urgent' ? '#dc2626' : '#18181b'};">${inq.priority}</b></td></tr>
    <tr><td style="color:#71717a;">회원</td><td>${escapeHtml(inq.user_email ?? '-')} <span style="color:#a1a1aa;">(${inq.user_role ?? '-'})</span></td></tr>
    <tr><td style="color:#71717a;">연락처</td><td>${escapeHtml(inq.contact_phone ?? '-')}</td></tr>
    <tr><td style="color:#71717a;">카톡 상담</td><td>${inq.wants_kakao_contact ? '희망' : '비희망'}</td></tr>
    <tr><td style="color:#71717a;">페이지</td><td>${escapeHtml(inq.current_page_url ?? '-')}</td></tr>
    <tr><td style="color:#71717a;">접수</td><td>${new Date(inq.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</td></tr>
  </table>
  <div style="background:#f4f4f5;border-radius:8px;padding:12px;margin-top:16px;white-space:pre-wrap;font-size:13px;">${escapeHtml(inq.body)}</div>
  <p style="margin-top:18px;font-size:11px;color:#71717a;">DEUDDA 운영 · support_inquiries id ${inq.id}</p>
</div>
</body></html>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: RESEND_FROM, to: emailTo, subject, html }),
    });
    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      // 발송 실패 → support_inquiries.context 에 기록
      await sbAdmin
        .from('support_inquiries')
        .update({
          context: {
            ...(inq.context as Record<string, unknown> ?? {}),
            email_notification_error: `resend ${res.status}: ${raw.slice(0, 200)}`,
            email_notification_attempted_at: new Date().toISOString(),
          },
        })
        .eq('id', inquiryId);
      return json({ ok: false, error: `resend ${res.status}`, detail: raw.slice(0, 200) }, 502);
    }
    // 발송 성공
    await sbAdmin
      .from('support_inquiries')
      .update({
        context: {
          ...(inq.context as Record<string, unknown> ?? {}),
          email_notification_sent_at: new Date().toISOString(),
          email_notification_to: emailTo,
        },
      })
      .eq('id', inquiryId);
    return json({ ok: true, sent_to: emailTo });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
