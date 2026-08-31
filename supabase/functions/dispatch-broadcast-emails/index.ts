// supabase/functions/dispatch-broadcast-emails/index.ts
//
// 관리자 → 회원 대량 메일 발송 워커.
//   admin_broadcast_email_jobs (status='pending', 캠페인 status='sending') 을
//   Resend 로 발송하고 sent/failed 로 마킹한다.
//
// 엔드포인트 (POST):
//   { drain: true }                                  — 대기 job 일괄 발송 (관리자 또는 cron)
//   { test: true, subject, body_html, email_kind, to? } — 관리자 본인(또는 to)에게 테스트 1건
//   { health: true }                                 — 진단 (관리자)
//
// 인증: admin Bearer JWT 또는 x-cron-secret (예약 발송 cron). 미러: dispatch-admin-notifications.
// Resend 미설정/오류 시 job.status='failed' + last_error 기록.

// deno-lint-ignore-file no-explicit-any

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MODULE_LOAD_AT = new Date().toISOString();
const RESEND_FROM_FALLBACK = '듣다 <no-reply@deudda.com>';

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

interface Env {
  SUPABASE_URL: string; ANON_KEY: string; SERVICE_ROLE: string;
  RESEND_API_KEY: string; RESEND_FROM: string; APP_PUBLIC_URL: string; CRON_SECRET: string;
}
function readEnv(): Env {
  const fromRaw = Deno.env.get('RESEND_FROM');
  return {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL') ?? '',
    ANON_KEY: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    SERVICE_ROLE: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    RESEND_API_KEY: Deno.env.get('RESEND_API_KEY') ?? '',
    RESEND_FROM: fromRaw && fromRaw.length > 0 ? fromRaw : RESEND_FROM_FALLBACK,
    APP_PUBLIC_URL: Deno.env.get('APP_PUBLIC_URL') ?? '',
    CRON_SECRET: Deno.env.get('CRON_SECRET') ?? '',
  };
}

interface PendingJob {
  job_id: string; campaign_id: string;
  recipient_email: string; recipient_user_id: string | null;
  unsubscribe_token: string;
  subject: string; body_html: string;
  email_kind: 'notice' | 'ad';
  attempts: number;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 광고성이면 제목 앞에 [광고] 표기 (이미 있으면 중복 방지) — 정보통신망법 대응.
function finalSubject(subject: string, kind: 'notice' | 'ad'): string {
  const s = (subject ?? '').trim();
  if (kind === 'ad' && !/^\s*\[광고\]/.test(s)) return `[광고] ${s}`;
  return s;
}

// 본문(admin 작성 HTML)을 브랜드 셸 + 푸터로 감싼다.
// 광고성: 수신거부 링크 필수. 공지성: 발신 정보만.
function buildHtml(env: Env, job: PendingJob): string {
  const unsubUrl = `${env.SUPABASE_URL.replace(/\/$/, '')}/functions/v1/broadcast-unsubscribe?token=${encodeURIComponent(job.unsubscribe_token)}`;
  const isAd = job.email_kind === 'ad';
  const footer = isAd
    ? `<tr><td style="padding:16px 28px 22px 28px;border-top:1px solid #e4e4e7;background:#fafafa;">
         <p style="margin:0 0 6px 0;font-size:11px;color:#71717a;line-height:1.6;">
           본 메일은 <strong>광고성 정보</strong>이며, 회원님께 수신 동의 기준으로 발송되었습니다.<br/>
           발신: 듣다(DEUDDA) · 문의: <a href="mailto:freemilesarea@gmail.com" style="color:#18181b;">freemilesarea@gmail.com</a>
         </p>
         <p style="margin:0;font-size:11px;color:#71717a;">
           더 이상 광고성 메일 수신을 원치 않으시면
           <a href="${escapeHtml(unsubUrl)}" style="color:#2563eb;font-weight:700;">여기(무료 수신거부)</a>를 눌러주세요.
         </p>
       </td></tr>`
    : `<tr><td style="padding:16px 28px 22px 28px;border-top:1px solid #e4e4e7;background:#fafafa;">
         <p style="margin:0;font-size:11px;color:#71717a;line-height:1.6;">
           본 메일은 듣다(DEUDDA) 운영 안내 메일입니다.<br/>
           문의: <a href="mailto:freemilesarea@gmail.com" style="color:#18181b;">freemilesarea@gmail.com</a>
         </p>
       </td></tr>`;

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(finalSubject(job.subject, job.email_kind))}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Apple SD Gothic Neo','Noto Sans KR',sans-serif;color:#18181b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;max-width:100%;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        <tr><td style="padding:22px 28px 14px 28px;border-bottom:1px solid #e4e4e7;">
          ${isAd ? `<span style="display:inline-block;background:#dbeafe;color:#1d4ed8;padding:3px 9px;border-radius:9999px;font-size:11px;font-weight:700;margin-bottom:6px;">광고</span><br/>` : ''}
          <span style="font-size:15px;font-weight:800;color:#18181b;">듣다 DEUDDA</span>
        </td></tr>
        <tr><td style="padding:22px 28px 8px 28px;font-size:14px;line-height:1.75;color:#27272a;word-break:break-word;">
          ${job.body_html}
        </td></tr>
        ${footer}
      </table>
    </td></tr>
  </table>
</body></html>`;
}

interface SendResult { ok: boolean; id?: string; error?: string; status_code?: number; raw?: string; }

async function sendResend(env: Env, to: string, subject: string, html: string): Promise<SendResult> {
  if (!env.RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY not configured' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.RESEND_FROM, to: [to], subject, html }),
    });
    const raw = await res.text();
    let data: any = null;
    try { data = JSON.parse(raw); } catch (_e) { /* Resend 가 비-JSON 반환 가능 */ }
    if (!res.ok) {
      const errMsg = (data && (data.message || data.error || data.name)) || `HTTP ${res.status}`;
      return { ok: false, error: `[${res.status}] ${String(errMsg)}`.slice(0, 1500), status_code: res.status, raw: raw.slice(0, 800) };
    }
    return { ok: true, id: data?.id ?? data?.message_id ?? '', status_code: res.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const env = readEnv();
  const sbAdmin = createClient(env.SUPABASE_URL, env.SERVICE_ROLE, { auth: { persistSession: false } });

  let body: { drain?: boolean; test?: boolean; health?: boolean; subject?: string; body_html?: string; email_kind?: 'notice' | 'ad'; to?: string } = {};
  try { body = await req.json(); } catch { return json({ error: 'invalid body' }, 400); }

  // 인증: cron secret 또는 admin Bearer
  const cronSecret = req.headers.get('x-cron-secret') ?? '';
  const isCron = env.CRON_SECRET.length > 0 && cronSecret === env.CRON_SECRET;

  let callerEmail = '';
  if (!isCron) {
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ error: 'unauthorized' }, 401);
    const sbUser = createClient(env.SUPABASE_URL, env.ANON_KEY, {
      auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userRes } = await sbUser.auth.getUser();
    if (!userRes?.user) return json({ error: 'unauthorized' }, 401);
    callerEmail = userRes.user.email ?? '';
    const { data: u } = await sbAdmin.from('users').select('role').eq('id', userRes.user.id).maybeSingle();
    if (!u || (u as any).role !== 'admin') return json({ error: 'forbidden' }, 403);
  }

  if (body.health) {
    return json({ ok: true, module_load_at: MODULE_LOAD_AT, now: new Date().toISOString(),
      env: { resend_api_key_set: !!env.RESEND_API_KEY, resend_from: env.RESEND_FROM, supabase_url: env.SUPABASE_URL } });
  }

  // 테스트 발송 — 관리자 본인(또는 지정 to) 에게 1건. job/campaign 미생성.
  if (body.test) {
    if (isCron) return json({ error: 'test not allowed via cron' }, 400);
    const to = (body.to && body.to.trim()) || callerEmail;
    if (!to) return json({ error: 'no recipient (caller has no email)' }, 400);
    const kind = body.email_kind === 'ad' ? 'ad' : 'notice';
    const fakeJob: PendingJob = {
      job_id: 'test', campaign_id: 'test', recipient_email: to, recipient_user_id: null,
      unsubscribe_token: '00000000-0000-0000-0000-000000000000',
      subject: body.subject ?? '(제목 없음)', body_html: body.body_html ?? '', email_kind: kind, attempts: 0,
    };
    const r = await sendResend(env, to, `[테스트] ${finalSubject(fakeJob.subject, kind)}`, buildHtml(env, fakeJob));
    return json({ ok: r.ok, to, error: r.error, provider_message_id: r.id }, r.ok ? 200 : 502);
  }

  // drain — 대기 job 발송
  const { data: jobs, error: jErr } = await sbAdmin.rpc('get_pending_broadcast_email_jobs', { p_limit: 100 });
  if (jErr) return json({ error: jErr.message }, 500);
  const pending = (jobs ?? []) as PendingJob[];
  if (pending.length === 0) return json({ ok: true, processed: 0, sent: 0, failed: 0, message: 'no pending jobs' });

  if (!env.RESEND_API_KEY) {
    for (const job of pending) {
      await sbAdmin.rpc('lock_broadcast_email_job', { p_job_id: job.job_id });
      await sbAdmin.rpc('mark_broadcast_email_failed', { p_job_id: job.job_id, p_error: 'RESEND_API_KEY not configured' });
    }
    return json({ ok: false, error: 'RESEND_API_KEY not configured', processed: pending.length, sent: 0, failed: pending.length }, 503);
  }

  let sent = 0, failed = 0;
  for (const job of pending) {
    const { data: locked } = await sbAdmin.rpc('lock_broadcast_email_job', { p_job_id: job.job_id });
    if (locked !== true) continue; // 이미 다른 워커가 처리 중
    const r = await sendResend(env, job.recipient_email, finalSubject(job.subject, job.email_kind), buildHtml(env, job));
    if (r.ok) {
      await sbAdmin.rpc('mark_broadcast_email_sent', { p_job_id: job.job_id, p_provider_message_id: r.id || null });
      sent++;
    } else {
      const errBody = r.status_code ? `${r.error}${r.raw ? ' | ' + r.raw.slice(0, 200) : ''}` : r.error || 'unknown';
      await sbAdmin.rpc('mark_broadcast_email_failed', { p_job_id: job.job_id, p_error: errBody });
      failed++;
    }
  }
  // 아직 남은 pending 이 있으면 클라이언트가 재호출하도록 has_more 표기
  const { data: remain } = await sbAdmin.rpc('get_pending_broadcast_email_jobs', { p_limit: 1 });
  const hasMore = Array.isArray(remain) && remain.length > 0;
  return json({ ok: failed === 0, processed: pending.length, sent, failed, has_more: hasMore });
});
