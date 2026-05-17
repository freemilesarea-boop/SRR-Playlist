// supabase/functions/dispatch-contract-emails/index.ts
//
// 계약 서명 후 호출되어 contract_email_jobs 의 pending 항목을 Resend 로 발송.
//
// 호출 방식:
//   POST /dispatch-contract-emails
//   Authorization: Bearer <user_jwt>
//   Body: { contract_id: uuid }
//
// 권한:
//   - 본인 계약 서명자 (artist_user_id == auth.uid()) 또는 admin
//   - 그 외는 401/403
//
// 발송 결과:
//   - 각 job 별 mark_contract_email_sent / mark_contract_email_failed 호출
//   - 계약 자체 (artist_contracts.status='signed') 는 절대 rollback 안 함
//   - Resend 실패한 job 은 status='failed' + last_error 기록 — 관리자 재발송 가능

// deno-lint-ignore-file no-explicit-any

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const RESEND_FROM =
  Deno.env.get('RESEND_FROM') ?? 'SRR Playlist <no-reply@srr-playlist.app>';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders },
  });
}

interface PendingJob {
  job_id: string;
  contract_id: string;
  recipient_email: string;
  recipient_kind: 'artist' | 'admin' | 'hardcoded';
  subject: string;
  attempts: number;
  contract_version: string;
  contract_title: string;
  contract_body: string;
  contract_hash: string | null;
  signed_at: string;
  signed_ip: string | null;
  signed_user_agent: string | null;
  artist_user_id: string;
  artist_email: string | null;
  artist_name: string | null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDateTimeKR(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  } catch {
    return iso;
  }
}

function buildHtml(job: PendingJob, appUrl: string): string {
  const kindLabel =
    job.recipient_kind === 'artist'
      ? '본인 사본'
      : job.recipient_kind === 'admin'
        ? '관리자 사본'
        : '운영팀 사본';
  const heading = `[스르륵 플리] 아티스트 계약 체결 완료 — ${kindLabel}`;
  const contractLink = `${appUrl.replace(/\/$/, '')}/artist/contract`;
  const safeBody = escapeHtml(job.contract_body);
  const artistDisplay = job.artist_name || job.artist_email || job.artist_user_id;

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Apple SD Gothic Neo','Noto Sans KR',sans-serif;color:#18181b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;max-width:100%;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        <tr><td style="padding:24px 28px 12px 28px;border-bottom:1px solid #e4e4e7;">
          <h1 style="margin:0;font-size:18px;font-weight:800;color:#18181b;">아티스트 계약 체결 완료</h1>
          <p style="margin:6px 0 0 0;font-size:12px;color:#71717a;">스르륵 플리 정산 시스템</p>
        </td></tr>
        <tr><td style="padding:20px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;line-height:1.7;">
            <tr><td style="color:#71717a;width:120px;">아티스트</td><td style="color:#18181b;font-weight:600;">${escapeHtml(artistDisplay)}</td></tr>
            <tr><td style="color:#71717a;">이메일</td><td style="color:#18181b;">${escapeHtml(job.artist_email ?? '—')}</td></tr>
            <tr><td style="color:#71717a;">계약 버전</td><td style="color:#18181b;font-family:ui-monospace,'SFMono-Regular',Menlo,monospace;">${escapeHtml(job.contract_version)}</td></tr>
            <tr><td style="color:#71717a;">서명 일시</td><td style="color:#18181b;">${escapeHtml(fmtDateTimeKR(job.signed_at))}</td></tr>
            <tr><td style="color:#71717a;">서명 IP</td><td style="color:#18181b;font-family:ui-monospace,'SFMono-Regular',Menlo,monospace;">${escapeHtml(job.signed_ip ?? '—')}</td></tr>
            <tr><td style="color:#71717a;vertical-align:top;">contract_hash</td><td style="color:#52525b;font-family:ui-monospace,'SFMono-Regular',Menlo,monospace;font-size:11px;word-break:break-all;">${escapeHtml(job.contract_hash ?? '—')}</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 28px 16px 28px;">
          <a href="${escapeHtml(contractLink)}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;padding:10px 18px;border-radius:8px;">앱에서 계약서 보기</a>
        </td></tr>
        <tr><td style="padding:0 28px 8px 28px;">
          <h2 style="margin:16px 0 8px 0;font-size:14px;font-weight:700;color:#18181b;">계약서 본문 (서명 시점 스냅샷)</h2>
        </td></tr>
        <tr><td style="padding:0 28px 24px 28px;">
          <div style="background:#fafafa;border:1px solid #e4e4e7;border-radius:10px;padding:16px 18px;">
            <pre style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Apple SD Gothic Neo','Noto Sans KR',sans-serif;white-space:pre-wrap;word-break:break-word;font-size:12.5px;line-height:1.65;color:#27272a;">${safeBody}</pre>
          </div>
        </td></tr>
        <tr><td style="padding:14px 28px 22px 28px;border-top:1px solid #e4e4e7;background:#fafafa;">
          <p style="margin:0;font-size:11px;color:#71717a;line-height:1.6;">
            본 메일은 자동 발송된 계약 체결 사본입니다. ${kindLabel} 으로 발송됨.<br/>
            계약은 전자문서 및 전자거래 기본법·전자서명법에 따라 서면 계약과 동일한 효력을 가집니다.<br/>
            문의: <a href="mailto:freemilesarea@gmail.com" style="color:#18181b;">freemilesarea@gmail.com</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

async function sendOne(job: PendingJob, appUrl: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!RESEND_API_KEY) {
    return { ok: false, error: 'RESEND_API_KEY not configured' };
  }
  const html = buildHtml(job, appUrl);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [job.recipient_email],
        subject: job.subject,
        html,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg =
        (data && (data.message || data.error || data.name)) ||
        `HTTP ${res.status}`;
      return { ok: false, error: String(errMsg).slice(0, 1500) };
    }
    return { ok: true, id: (data && (data.id || data.message_id)) ?? '' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'unauthorized' }, 401);

  const sbUser = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userRes } = await sbUser.auth.getUser();
  if (!userRes?.user) return json({ error: 'unauthorized' }, 401);
  const user = userRes.user;

  let body: { contract_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid body' }, 400);
  }
  const contractId = body.contract_id;
  if (!contractId) return json({ error: 'missing contract_id' }, 400);

  // 권한: 본인 계약 또는 admin
  const sbAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });
  const { data: contract, error: cErr } = await sbAdmin
    .from('artist_contracts')
    .select('id, artist_user_id, status')
    .eq('id', contractId)
    .maybeSingle();
  if (cErr || !contract) return json({ error: 'contract not found' }, 404);
  if (contract.artist_user_id !== user.id) {
    const { data: u } = await sbAdmin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (!u || (u as any).role !== 'admin') {
      return json({ error: 'forbidden' }, 403);
    }
  }
  if (contract.status !== 'signed') {
    return json({ error: `contract not signed (status=${contract.status})` }, 400);
  }

  // pending jobs 조회 (service_role)
  const { data: jobs, error: jErr } = await sbAdmin.rpc(
    'get_pending_contract_email_jobs',
    { p_contract_id: contractId, p_limit: 50 },
  );
  if (jErr) return json({ error: jErr.message }, 500);
  const pending = (jobs ?? []) as PendingJob[];

  if (pending.length === 0) {
    return json({ ok: true, processed: 0, message: 'no pending jobs' });
  }

  // 앱 URL 결정 (origin 헤더 우선, 없으면 환경변수, 둘 다 없으면 fallback)
  const origin = req.headers.get('origin') ?? '';
  const appUrl =
    origin && /^https?:\/\//.test(origin)
      ? origin
      : Deno.env.get('APP_PUBLIC_URL') ?? 'https://srr-playlist.app';

  let sent = 0;
  let failed = 0;
  const results: Array<{ job_id: string; ok: boolean; error?: string }> = [];

  for (const job of pending) {
    // lock — race 방지 (다른 호출이 동시에 처리 시 한쪽만 진행)
    const { data: lockedData } = await sbAdmin.rpc('lock_contract_email_job', {
      p_job_id: job.job_id,
    });
    const locked = lockedData === true;
    if (!locked) {
      results.push({ job_id: job.job_id, ok: false, error: 'already locked' });
      continue;
    }
    const r = await sendOne(job, appUrl);
    if (r.ok) {
      await sbAdmin.rpc('mark_contract_email_sent', {
        p_job_id: job.job_id,
        p_provider_message_id: r.id || null,
      });
      sent++;
      results.push({ job_id: job.job_id, ok: true });
    } else {
      await sbAdmin.rpc('mark_contract_email_failed', {
        p_job_id: job.job_id,
        p_error: r.error,
      });
      failed++;
      results.push({ job_id: job.job_id, ok: false, error: r.error });
    }
  }

  return json({ ok: true, processed: pending.length, sent, failed, results });
});
