// supabase/functions/dispatch-contract-emails/index.ts
//
// 계약 서명 후 호출되어 contract_email_jobs 의 pending 항목을 Resend 로 발송.
//
// 엔드포인트:
//   POST /dispatch-contract-emails        — 메일 발송 실행 (body: { contract_id })
//   POST /dispatch-contract-emails        — 환경 점검 (body: { health: true })
//
// 권한:
//   - 본인 계약 서명자 (artist_user_id == auth.uid()) 또는 admin
//   - 그 외는 401/403
//   - health 체크는 admin only
//
// 발송 결과:
//   - 각 job 별 mark_contract_email_sent / mark_contract_email_failed 호출
//   - 계약 자체 (artist_contracts.status='signed') 는 절대 rollback 안 함
//   - Resend 실패 시 status_code, raw response 일부, message 모두 last_error 에 보존
//   - 모든 status 전이는 contract_email_job_events 에 trigger 로 자동 기록

// deno-lint-ignore-file no-explicit-any

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const RESEND_FROM =
  Deno.env.get('RESEND_FROM') ?? 'SRR Playlist <no-reply@srr-playlist.app>';
const APP_PUBLIC_URL = Deno.env.get('APP_PUBLIC_URL') ?? '';

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
    return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  } catch {
    return iso;
  }
}

/** "Name <addr@domain>" 또는 "addr@domain" 에서 domain 추출 */
function extractFromDomain(from: string): string | null {
  const m = from.match(/<([^>]+)>/);
  const email = m ? m[1] : from.trim();
  const at = email.lastIndexOf('@');
  if (at < 0) return null;
  return email.slice(at + 1).toLowerCase();
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

interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
  status_code?: number;
  raw?: string;
}

async function sendOne(job: PendingJob, appUrl: string): Promise<SendResult> {
  if (!RESEND_API_KEY) {
    return { ok: false, error: 'RESEND_API_KEY not configured' };
  }
  const html = buildHtml(job, appUrl);
  const payload = {
    from: RESEND_FROM,
    to: [job.recipient_email],
    subject: job.subject,
    html,
  };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const raw = await res.text();
    let data: any = null;
    try { data = JSON.parse(raw); } catch { /* non-json */ }
    if (!res.ok) {
      const errMsg =
        (data && (data.message || data.error || data.name)) ||
        `HTTP ${res.status}`;
      console.error('[dispatch] Resend error:', {
        status: res.status,
        body: raw.slice(0, 800),
        to: job.recipient_email,
        kind: job.recipient_kind,
        job_id: job.job_id,
      });
      return {
        ok: false,
        error: `[${res.status}] ${String(errMsg)}`.slice(0, 1500),
        status_code: res.status,
        raw: raw.slice(0, 800),
      };
    }
    const id = data?.id ?? data?.message_id ?? '';
    console.log('[dispatch] Resend sent:', {
      to: job.recipient_email,
      kind: job.recipient_kind,
      provider_message_id: id,
      job_id: job.job_id,
    });
    return { ok: true, id, status_code: res.status, raw: raw.slice(0, 400) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[dispatch] fetch threw:', { msg, to: job.recipient_email });
    return { ok: false, error: msg };
  }
}

interface EnvCheck {
  resend_api_key_set: boolean;
  resend_from: string;
  resend_from_domain: string | null;
  app_public_url: string | null;
}

function envCheck(): EnvCheck {
  return {
    resend_api_key_set: !!RESEND_API_KEY && RESEND_API_KEY.length > 0,
    resend_from: RESEND_FROM,
    resend_from_domain: extractFromDomain(RESEND_FROM),
    app_public_url: APP_PUBLIC_URL || null,
  };
}

/** Resend API 로 from 도메인 verification 상태 조회. 실패 시 null. */
async function checkResendDomain(): Promise<{
  domain: string | null;
  status: string | null;
  region: string | null;
  error?: string;
}> {
  const domain = extractFromDomain(RESEND_FROM);
  if (!RESEND_API_KEY) return { domain, status: null, region: null, error: 'no_api_key' };
  if (!domain) return { domain: null, status: null, region: null, error: 'no_from_domain' };
  try {
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
    });
    const raw = await res.text();
    if (!res.ok) {
      return { domain, status: null, region: null, error: `resend_list_${res.status}` };
    }
    const data = JSON.parse(raw);
    const list: any[] = data?.data ?? data ?? [];
    const match = Array.isArray(list)
      ? list.find((d: any) => (d?.name || '').toLowerCase() === domain)
      : null;
    if (!match) {
      // resend.dev 같은 sandbox 도메인은 도메인 목록에 안 잡혀도 정상 동작 — 별도 처리
      if (domain.endsWith('resend.dev')) {
        return { domain, status: 'sandbox', region: null };
      }
      return { domain, status: 'not_registered', region: null };
    }
    return {
      domain,
      status: String(match.status ?? 'unknown'),
      region: match.region ?? null,
    };
  } catch (e) {
    return {
      domain,
      status: null,
      region: null,
      error: e instanceof Error ? e.message : String(e),
    };
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

  let body: { contract_id?: string; health?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid body' }, 400);
  }

  const sbAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  // ============================================
  // Health check 분기 (admin only)
  // ============================================
  if (body.health) {
    const { data: u } = await sbAdmin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (!u || (u as any).role !== 'admin') {
      return json({ error: 'forbidden' }, 403);
    }
    const env = envCheck();
    const domainCheck = await checkResendDomain();
    return json({
      ok: true,
      env,
      resend_domain: domainCheck,
      ready:
        env.resend_api_key_set &&
        (domainCheck.status === 'verified' || domainCheck.status === 'sandbox'),
    });
  }

  // ============================================
  // 일반 발송 분기
  // ============================================
  const contractId = body.contract_id;
  if (!contractId) return json({ error: 'missing contract_id' }, 400);

  const { data: contract, error: cErr } = await sbAdmin
    .from('artist_contracts')
    .select('id, artist_user_id, status')
    .eq('id', contractId)
    .maybeSingle();
  if (cErr || !contract) {
    console.error('[dispatch] contract lookup failed:', { contractId, cErr });
    return json({ error: 'contract not found' }, 404);
  }
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

  const { data: jobs, error: jErr } = await sbAdmin.rpc(
    'get_pending_contract_email_jobs',
    { p_contract_id: contractId, p_limit: 50 },
  );
  if (jErr) {
    console.error('[dispatch] get_pending failed:', jErr);
    return json({ error: jErr.message }, 500);
  }
  const pending = (jobs ?? []) as PendingJob[];

  if (pending.length === 0) {
    return json({ ok: true, processed: 0, message: 'no pending jobs' });
  }

  const origin = req.headers.get('origin') ?? '';
  const appUrl =
    origin && /^https?:\/\//.test(origin)
      ? origin
      : APP_PUBLIC_URL || 'https://srr-playlist.app';

  // 환경 미설정 시 빠른 실패 — 모든 job 을 일괄 failed 로 마킹하고 명확한 에러 반환
  if (!RESEND_API_KEY) {
    console.error('[dispatch] RESEND_API_KEY not configured — failing all pending jobs');
    for (const job of pending) {
      await sbAdmin.rpc('lock_contract_email_job', { p_job_id: job.job_id });
      await sbAdmin.rpc('mark_contract_email_failed', {
        p_job_id: job.job_id,
        p_error: 'RESEND_API_KEY not configured on Edge Function',
      });
    }
    return json(
      {
        ok: false,
        error: 'RESEND_API_KEY not configured',
        processed: pending.length,
        sent: 0,
        failed: pending.length,
      },
      503,
    );
  }

  console.log('[dispatch] starting', {
    contract_id: contractId,
    pending_count: pending.length,
    from: RESEND_FROM,
    app_url: appUrl,
  });

  let sent = 0;
  let failed = 0;
  const results: Array<{
    job_id: string;
    ok: boolean;
    to?: string;
    error?: string;
    provider_message_id?: string;
    status_code?: number;
  }> = [];

  for (const job of pending) {
    const { data: lockedData } = await sbAdmin.rpc('lock_contract_email_job', {
      p_job_id: job.job_id,
    });
    if (lockedData !== true) {
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
      results.push({
        job_id: job.job_id,
        ok: true,
        to: job.recipient_email,
        provider_message_id: r.id,
        status_code: r.status_code,
      });
    } else {
      const errBody = r.status_code
        ? `${r.error}${r.raw ? ' | ' + r.raw.slice(0, 200) : ''}`
        : r.error || 'unknown';
      await sbAdmin.rpc('mark_contract_email_failed', {
        p_job_id: job.job_id,
        p_error: errBody,
      });
      failed++;
      results.push({
        job_id: job.job_id,
        ok: false,
        to: job.recipient_email,
        error: r.error,
        status_code: r.status_code,
      });
    }
  }

  console.log('[dispatch] done', {
    contract_id: contractId,
    sent,
    failed,
  });

  return json({
    ok: failed === 0,
    processed: pending.length,
    sent,
    failed,
    results,
  });
});
