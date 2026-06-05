/**
 * notify-inquiry-reply — Phase X6.3
 *
 * 운영자가 admin_send_inquiry_reply 호출 후 클라이언트가 이 함수 invoke.
 * 사용자 이메일로 답변 본문 발송 (Resend).
 *
 * 권한: admin only (verify_jwt=true + role check)
 *
 * 향후 확장:
 *   - 카카오 알림톡 발송 (솔루션사 API)
 *   - 외부 webhook dispatch
 *   - support_inquiry_events 에 reply_failed / kakao_dispatched 등 추가 로깅
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
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
  const RESEND_FROM = Deno.env.get('RESEND_FROM') || '듣다 운영 <no-reply@deudda.com>';

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

  const sbAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // admin 검증
  const { data: roleRow } = await sbAdmin.from('users').select('role').eq('id', userId).maybeSingle();
  if (!roleRow || (roleRow as { role?: string }).role !== 'admin') {
    return json({ error: 'forbidden' }, 403);
  }

  let body: { inquiry_id?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const inquiryId = body.inquiry_id;
  if (!inquiryId) return json({ error: 'missing inquiry_id' }, 400);

  // 최신 상태의 inquiry 가져오기 (admin_send_inquiry_reply RPC 가 admin_note 를 업데이트한 후)
  const { data: inq, error: inqErr } = await sbAdmin
    .from('support_inquiries')
    .select('id, user_id, user_email, inquiry_type, title, body, status, admin_note, current_page_url, created_at')
    .eq('id', inquiryId)
    .maybeSingle();
  if (inqErr || !inq) return json({ ok: false, error: 'inquiry_not_found' }, 404);

  if (!inq.user_email) {
    // 사용자 이메일 없음 → 발송 불가
    await sbAdmin.from('support_inquiry_events').insert({
      inquiry_id: inquiryId, actor_user_id: userId,
      event_type: 'reply_failed', channel: 'email',
      detail: 'user_email is null',
    });
    return json({ ok: false, error: 'user_email_missing' }, 422);
  }
  if (!inq.admin_note || inq.admin_note.trim().length === 0) {
    return json({ ok: false, error: 'admin_note_empty' }, 422);
  }
  if (!RESEND_API_KEY) {
    await sbAdmin.from('support_inquiry_events').insert({
      inquiry_id: inquiryId, actor_user_id: userId,
      event_type: 'reply_failed', channel: 'email',
      detail: 'RESEND_API_KEY missing',
    });
    return json({ ok: false, error: 'resend_api_key_missing' }, 503);
  }

  const subject = `[DEUDDA 답변] ${inq.inquiry_type} - ${inq.title}`.slice(0, 180);
  const html = `<!DOCTYPE html><html lang="ko"><body style="font-family:-apple-system,sans-serif;background:#f4f4f5;padding:24px;color:#18181b;">
<div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;">
  <h2 style="margin:0 0 6px;">📬 문의 답변</h2>
  <p style="margin:0 0 16px;color:#71717a;font-size:13px;">DEUDDA 운영팀입니다. 보내주신 문의에 답변드립니다.</p>

  <div style="border-top:1px solid #e4e4e7;padding-top:16px;margin-top:16px;">
    <p style="margin:0 0 4px;font-size:11px;color:#a1a1aa;text-transform:uppercase;letter-spacing:0.05em;">원래 문의</p>
    <h3 style="margin:0 0 4px;font-size:14px;color:#3f3f46;">${escapeHtml(inq.title)}</h3>
    <p style="margin:0 0 8px;font-size:11px;color:#71717a;">
      ${escapeHtml(inq.inquiry_type)} · 접수 ${new Date(inq.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
    </p>
    <div style="background:#fafafa;border-radius:8px;padding:12px;white-space:pre-wrap;font-size:12px;color:#52525b;">${escapeHtml(inq.body)}</div>
  </div>

  <div style="border-top:1px solid #e4e4e7;padding-top:16px;margin-top:16px;">
    <p style="margin:0 0 4px;font-size:11px;color:#a1a1aa;text-transform:uppercase;letter-spacing:0.05em;">운영팀 답변</p>
    <div style="background:#eef2ff;border-radius:8px;padding:14px;white-space:pre-wrap;font-size:13px;color:#18181b;border:1px solid #c7d2fe;">${escapeHtml(inq.admin_note)}</div>
  </div>

  <p style="margin-top:20px;font-size:12px;color:#71717a;">
    추가 문의가 있으시면 동일 화면(고객센터)에서 답글을 작성하시거나, 회신 메일로 답해주세요.
  </p>
  <p style="margin-top:18px;font-size:11px;color:#a1a1aa;">DEUDDA 운영 · 문의번호 ${inq.id.slice(0, 8)}</p>
</div>
</body></html>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [inq.user_email],
        subject,
        html,
        reply_to: 'contact@swk.today',
      }),
    });

    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      await sbAdmin.from('support_inquiry_events').insert({
        inquiry_id: inquiryId, actor_user_id: userId,
        event_type: 'reply_failed', channel: 'email',
        detail: `resend ${res.status}: ${raw.slice(0, 200)}`,
      });
      return json({ ok: false, error: `resend ${res.status}`, detail: raw.slice(0, 200) }, 502);
    }

    // 발송 성공 — 이벤트 로깅 (별도 row — admin_send_inquiry_reply 의 'reply_sent' 와 구분)
    await sbAdmin.from('support_inquiry_events').insert({
      inquiry_id: inquiryId, actor_user_id: userId,
      event_type: 'reply_sent', channel: 'email',
      after_data: { sent_to: inq.user_email, status: inq.status },
      detail: 'Email delivered via Resend',
    });

    return json({ ok: true, sent_to: inq.user_email, status: inq.status });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    await sbAdmin.from('support_inquiry_events').insert({
      inquiry_id: inquiryId, actor_user_id: userId,
      event_type: 'reply_failed', channel: 'email',
      detail: errMsg.slice(0, 500),
    });
    return json({ ok: false, error: errMsg }, 500);
  }
});
