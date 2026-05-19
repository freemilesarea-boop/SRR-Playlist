// supabase/functions/dispatch-contract-emails/index.ts
//
// 계약 서명 후 호출되어 contract_email_jobs 의 pending 항목을 Resend 로 발송.
//
// 엔드포인트:
//   POST /dispatch-contract-emails        — 메일 발송 실행 (body: { contract_id })
//   POST /dispatch-contract-emails        — 환경 점검 (body: { health: true })
//
// v5 변경:
// - health 응답에 Deno.env.toObject() 의 key 이름 목록 추가 (값 절대 미노출)
// - RESEND_API_KEY / RESEND_FROM 각각 명시적으로 set/using_fallback 구분
// - 비슷한 오타 (RESEND_APIKEY / RESEND_KEY / resend_api_key 등) 자동 탐지

// deno-lint-ignore-file no-explicit-any

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MODULE_LOAD_AT = new Date().toISOString();

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

const RESEND_FROM_FALLBACK = '듣다 <noreply@deudda.com>';

interface Env {
  SUPABASE_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE: string;
  RESEND_API_KEY: string;
  RESEND_FROM: string;
  RESEND_FROM_IS_FALLBACK: boolean;
  APP_PUBLIC_URL: string;
}

function readEnv(): Env {
  const fromRaw = Deno.env.get('RESEND_FROM');
  return {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL') ?? '',
    ANON_KEY: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    SERVICE_ROLE: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    RESEND_API_KEY: Deno.env.get('RESEND_API_KEY') ?? '',
    RESEND_FROM: fromRaw && fromRaw.length > 0 ? fromRaw : RESEND_FROM_FALLBACK,
    RESEND_FROM_IS_FALLBACK: !fromRaw || fromRaw.length === 0,
    APP_PUBLIC_URL: Deno.env.get('APP_PUBLIC_URL') ?? '',
  };
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
  const heading = `[듣다] 아티스트 계약 체결 완료 — ${kindLabel}`;
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
          <p style="margin:6px 0 0 0;font-size:12px;color:#71717a;">듣다 정산 시스템</p>
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

async function sendOne(env: Env, job: PendingJob, appUrl: string): Promise<SendResult> {
  if (!env.RESEND_API_KEY) {
    return { ok: false, error: 'RESEND_API_KEY not configured' };
  }
  const html = buildHtml(job, appUrl);
  const payload = {
    from: env.RESEND_FROM,
    to: [job.recipient_email],
    subject: job.subject,
    html,
  };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
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
        status: res.status, body: raw.slice(0, 800),
        to: job.recipient_email, kind: job.recipient_kind,
        job_id: job.job_id, from: env.RESEND_FROM,
      });
      return {
        ok: false,
        error: `[${res.status}] ${String(errMsg)}`.slice(0, 1500),
        status_code: res.status, raw: raw.slice(0, 800),
      };
    }
    const id = data?.id ?? data?.message_id ?? '';
    console.log('[dispatch] Resend sent:', {
      to: job.recipient_email, kind: job.recipient_kind,
      provider_message_id: id, job_id: job.job_id,
    });
    return { ok: true, id, status_code: res.status, raw: raw.slice(0, 400) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[dispatch] fetch threw:', { msg, to: job.recipient_email });
    return { ok: false, error: msg };
  }
}

async function checkResendDomain(env: Env): Promise<{
  domain: string | null;
  status: string | null;
  region: string | null;
  error?: string;
}> {
  const domain = extractFromDomain(env.RESEND_FROM);
  if (!env.RESEND_API_KEY) return { domain, status: null, region: null, error: 'no_api_key' };
  if (!domain) return { domain: null, status: null, region: null, error: 'no_from_domain' };
  try {
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
    });
    const raw = await res.text();
    if (!res.ok) return { domain, status: null, region: null, error: `resend_list_${res.status}` };
    const data = JSON.parse(raw);
    const list: any[] = data?.data ?? data ?? [];
    const match = Array.isArray(list)
      ? list.find((d: any) => (d?.name || '').toLowerCase() === domain)
      : null;
    if (!match) {
      if (domain.endsWith('resend.dev')) return { domain, status: 'sandbox', region: null };
      return { domain, status: 'not_registered', region: null };
    }
    return { domain, status: String(match.status ?? 'unknown'), region: match.region ?? null };
  } catch (e) {
    return { domain, status: null, region: null, error: e instanceof Error ? e.message : String(e) };
  }
}

function diagnosticKey(k: string): { set: boolean; length: number; first4: string; last4: string } {
  return {
    set: !!k && k.length > 0,
    length: k.length,
    first4: k.length >= 4 ? k.slice(0, 4) : '',
    last4: k.length >= 4 ? k.slice(-4) : '',
  };
}

/**
 * v5 — runtime env 의 key 이름 목록 + RESEND 관련 오타 후보 탐지.
 * 값은 절대 노출 X. 이름만.
 */
function inspectAllEnvKeys(): {
  all_keys: string[];
  resend_like_keys: string[];
  has_RESEND_API_KEY: boolean;
  has_RESEND_FROM: boolean;
} {
  const all = Object.keys(Deno.env.toObject()).sort();
  const resendLike = all.filter((k) => /resend|RESEND/.test(k));
  return {
    all_keys: all,
    resend_like_keys: resendLike,
    has_RESEND_API_KEY: all.includes('RESEND_API_KEY'),
    has_RESEND_FROM: all.includes('RESEND_FROM'),
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const env = readEnv();

  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'unauthorized' }, 401);

  const sbUser = createClient(env.SUPABASE_URL, env.ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userRes } = await sbUser.auth.getUser();
  if (!userRes?.user) return json({ error: 'unauthorized' }, 401);
  const user = userRes.user;

  let body: { contract_id?: string; health?: boolean } = {};
  try { body = await req.json(); }
  catch { return json({ error: 'invalid body' }, 400); }

  const sbAdmin = createClient(env.SUPABASE_URL, env.SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  // ============================================
  // Health 분기 (admin only) — v5: env 전체 키 이름 노출 (값 X)
  // ============================================
  if (body.health) {
    const { data: u } = await sbAdmin
      .from('users').select('role').eq('id', user.id).maybeSingle();
    if (!u || (u as any).role !== 'admin') {
      return json({ error: 'forbidden' }, 403);
    }
    const keyDiag = diagnosticKey(env.RESEND_API_KEY);
    const fromDomain = extractFromDomain(env.RESEND_FROM);
    const domainCheck = await checkResendDomain(env);
    const envInspect = inspectAllEnvKeys();
    const result = {
      ok: true,
      env: {
        resend_api_key_set: keyDiag.set,
        resend_api_key_length: keyDiag.length,
        resend_api_key_first4: keyDiag.first4,
        resend_api_key_last4: keyDiag.last4,
        resend_from: env.RESEND_FROM,
        resend_from_is_fallback: env.RESEND_FROM_IS_FALLBACK,
        resend_from_domain: fromDomain,
        app_public_url: env.APP_PUBLIC_URL || null,
        supabase_url: env.SUPABASE_URL,
        module_load_at: MODULE_LOAD_AT,
        now: new Date().toISOString(),
        // v5 진단 — 키 이름만, 값 X
        env_inspect: envInspect,
      },
      resend_domain: domainCheck,
      ready: keyDiag.set && (domainCheck.status === 'verified' || domainCheck.status === 'sandbox'),
    };
    console.log('[dispatch] health check:', {
      ...result,
      // 콘솔에는 더 짧게
      env_keys_count: envInspect.all_keys.length,
      resend_like: envInspect.resend_like_keys,
    });
    return json(result);
  }

  // ============================================
  // 일반 발송 분기
  // ============================================
  const contractId = body.contract_id;
  if (!contractId) return json({ error: 'missing contract_id' }, 400);

  const { data: contract, error: cErr } = await sbAdmin
    .from('artist_contracts').select('id, artist_user_id, status')
    .eq('id', contractId).maybeSingle();
  if (cErr || !contract) {
    console.error('[dispatch] contract lookup failed:', { contractId, cErr });
    return json({ error: 'contract not found' }, 404);
  }
  if (contract.artist_user_id !== user.id) {
    const { data: u } = await sbAdmin
      .from('users').select('role').eq('id', user.id).maybeSingle();
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
      : env.APP_PUBLIC_URL || 'https://deudda.com';

  const keyDiag = diagnosticKey(env.RESEND_API_KEY);
  const envInspect = inspectAllEnvKeys();
  console.log('[dispatch] starting', {
    contract_id: contractId, pending_count: pending.length,
    from: env.RESEND_FROM, app_url: appUrl,
    resend_key_set: keyDiag.set, resend_key_length: keyDiag.length,
    module_load_at: MODULE_LOAD_AT,
    env_keys_count: envInspect.all_keys.length,
    resend_like_keys: envInspect.resend_like_keys,
  });

  if (!env.RESEND_API_KEY) {
    console.error('[dispatch] RESEND_API_KEY not configured — failing all pending jobs', {
      env_inspect: envInspect,
    });
    for (const job of pending) {
      await sbAdmin.rpc('lock_contract_email_job', { p_job_id: job.job_id });
      await sbAdmin.rpc('mark_contract_email_failed', {
        p_job_id: job.job_id,
        p_error:
          'RESEND_API_KEY not configured (resend_like_keys=' +
          JSON.stringify(envInspect.resend_like_keys) +
          ', module_load_at=' + MODULE_LOAD_AT + ')',
      });
    }
    return json(
      {
        ok: false,
        error: 'RESEND_API_KEY not configured',
        env_snapshot: {
          module_load_at: MODULE_LOAD_AT,
          supabase_url: env.SUPABASE_URL,
          env_inspect: envInspect,
        },
        processed: pending.length, sent: 0, failed: pending.length,
      },
      503,
    );
  }

  let sent = 0, failed = 0;
  const results: Array<{
    job_id: string; ok: boolean; to?: string; error?: string;
    provider_message_id?: string; status_code?: number;
  }> = [];

  for (const job of pending) {
    const { data: lockedData } = await sbAdmin.rpc('lock_contract_email_job', { p_job_id: job.job_id });
    if (lockedData !== true) {
      results.push({ job_id: job.job_id, ok: false, error: 'already locked' });
      continue;
    }
    const r = await sendOne(env, job, appUrl);
    if (r.ok) {
      await sbAdmin.rpc('mark_contract_email_sent', {
        p_job_id: job.job_id, p_provider_message_id: r.id || null,
      });
      sent++;
      results.push({
        job_id: job.job_id, ok: true, to: job.recipient_email,
        provider_message_id: r.id, status_code: r.status_code,
      });
    } else {
      const errBody = r.status_code
        ? `${r.error}${r.raw ? ' | ' + r.raw.slice(0, 200) : ''}`
        : r.error || 'unknown';
      await sbAdmin.rpc('mark_contract_email_failed', {
        p_job_id: job.job_id, p_error: errBody,
      });
      failed++;
      results.push({
        job_id: job.job_id, ok: false, to: job.recipient_email,
        error: r.error, status_code: r.status_code,
      });
    }
  }

  console.log('[dispatch] done', { contract_id: contractId, sent, failed });
  return json({ ok: failed === 0, processed: pending.length, sent, failed, results });
});
