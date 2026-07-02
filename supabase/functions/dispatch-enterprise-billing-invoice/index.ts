// supabase/functions/dispatch-enterprise-billing-invoice/index.ts
//
// Phase 3-1: 청구서 이메일 발송 (재발송 지원).
//
// 절대 무수정:
//   - enterprise_billing_invoices 스키마 / RPC 무관 (읽기 + finalize 만 호출)
//   - dispatch-contract-emails 무관 (별개 edge fn, 패턴만 복사)
//   - cron / dispatch-admin-notifications / policy / player 무관
//
// 엔드포인트:
//   POST /dispatch-enterprise-billing-invoice { job_id: uuid }
//   POST /dispatch-enterprise-billing-invoice { health: true }
//
// 인증:
//   Authorization: Bearer <user_access_token> — super_admin 만 통과.
//
// 응답:
//   200 { ok:true, job_id, status:'sent', resend_id, duration_ms }
//   200 { ok:false, job_id, status:'failed', error_message, duration_ms }
//   4xx { error, ... }
//   500 { error, hint }

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MODULE_LOAD_AT = new Date().toISOString();
const BUCKET = 'enterprise-billing-invoices';
const RESEND_FROM_FALLBACK = '듣다 <no-reply@deudda.com>';

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

interface Env {
  SUPABASE_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE: string;
  RESEND_API_KEY: string;
  RESEND_FROM: string;
  RESEND_FROM_IS_FALLBACK: boolean;
}

function readEnv(): Env {
  const fromRaw = Deno.env.get('RESEND_FROM');
  return {
    SUPABASE_URL:  Deno.env.get('SUPABASE_URL') ?? '',
    ANON_KEY:      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    SERVICE_ROLE:  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    RESEND_API_KEY: Deno.env.get('RESEND_API_KEY') ?? '',
    RESEND_FROM:   fromRaw && fromRaw.length > 0 ? fromRaw : RESEND_FROM_FALLBACK,
    RESEND_FROM_IS_FALLBACK: !fromRaw || fromRaw.length === 0,
  };
}

async function verifyAdmin(env: Env, accessToken: string): Promise<{ ok: boolean; reason?: string; user_id?: string }> {
  const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.ANON_KEY, Authorization: `Bearer ${accessToken}` },
  });
  if (!userRes.ok) return { ok: false, reason: 'invalid_token' };
  const u = await userRes.json().catch(() => null) as { id?: string } | null;
  if (!u?.id) return { ok: false, reason: 'no_user' };

  const roleRes = await fetch(`${env.SUPABASE_URL}/rest/v1/users?id=eq.${u.id}&select=role`, {
    headers: { apikey: env.SERVICE_ROLE, Authorization: `Bearer ${env.SERVICE_ROLE}` },
  });
  const rows = await roleRes.json().catch(() => []) as Array<{ role?: string }>;
  if (!rows[0] || rows[0].role !== 'admin') return { ok: false, reason: 'not_admin' };
  return { ok: true, user_id: u.id };
}

interface EmailJob {
  id: string;
  invoice_id: string;
  to_email: string;
  cc_emails: string[] | null;
  status: string;
  retry_count: number;
}

async function fetchJob(env: Env, jobId: string): Promise<EmailJob | null> {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/enterprise_billing_email_jobs?id=eq.${jobId}&select=id,invoice_id,to_email,cc_emails,status,retry_count`,
    { headers: { apikey: env.SERVICE_ROLE, Authorization: `Bearer ${env.SERVICE_ROLE}` } },
  );
  if (!res.ok) return null;
  const rows = await res.json() as EmailJob[];
  return rows?.[0] ?? null;
}

interface InvoiceMeta {
  id: string;
  enterprise_account_name: string | null;
  billing_month: string;
  total_amount: number;
  currency: string;
  pdf_url: string | null;    // Storage path
  status: string;
  due_date: string | null;
  memo: string | null;
}

async function fetchInvoice(env: Env, invoiceId: string): Promise<InvoiceMeta> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/admin_get_enterprise_billing_invoice_detail`, {
    method: 'POST',
    headers: { apikey: env.SERVICE_ROLE, Authorization: `Bearer ${env.SERVICE_ROLE}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_invoice_id: invoiceId }),
  });
  if (!res.ok) throw new Error(`fetch invoice failed: HTTP ${res.status}`);
  const body = await res.json();
  const inv = body?.invoice ?? body;
  if (!inv?.id) throw new Error('invoice not found');
  return inv;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildHtml(inv: InvoiceMeta): string {
  const brand = escapeHtml(inv.enterprise_account_name ?? '(브랜드 미상)');
  const month = escapeHtml(inv.billing_month.slice(0, 7));
  const amount = inv.total_amount.toLocaleString('en-US');
  const currency = inv.currency;
  const due = inv.due_date ?? '-';
  return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Apple SD Gothic Neo','Noto Sans KR',sans-serif;background:#f4f4f5;margin:0;padding:24px 12px;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden;">
    <tr><td style="padding:20px 24px;border-bottom:1px solid #e4e4e7;">
      <div style="font-size:12px;color:#71717a;letter-spacing:.06em;">DEUDDA — Enterprise Billing</div>
      <h1 style="margin:6px 0 0;font-size:22px;font-weight:800;color:#18181b;">${month} 청구서</h1>
    </td></tr>
    <tr><td style="padding:22px 24px;">
      <p style="margin:0 0 12px;font-size:14px;color:#27272a;">${brand} 담당자님, 이번 달 청구서를 발송드립니다.</p>
      <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;margin:16px 0;border:1px solid #e4e4e7;border-radius:10px;">
        <tr><td style="padding:10px 14px;background:#fafafa;border-bottom:1px solid #e4e4e7;">
          <strong style="font-size:12px;color:#52525b;letter-spacing:.04em;">청구 요약</strong>
        </td></tr>
        <tr><td style="padding:12px 14px;">
          <table role="presentation" cellspacing="0" cellpadding="4" style="width:100%;font-size:13px;color:#27272a;">
            <tr><td style="color:#71717a;">브랜드</td><td style="text-align:right;font-weight:600;">${brand}</td></tr>
            <tr><td style="color:#71717a;">청구월</td><td style="text-align:right;font-weight:600;">${month}</td></tr>
            <tr><td style="color:#71717a;">납기한</td><td style="text-align:right;font-weight:600;">${escapeHtml(due)}</td></tr>
            <tr><td style="color:#71717a;">총 금액</td><td style="text-align:right;font-weight:800;font-size:15px;">${escapeHtml(currency)} ${amount}</td></tr>
          </table>
        </td></tr>
      </table>
      ${inv.memo ? `<p style="margin:0;padding:12px 14px;border:1px dashed #d4d4d8;border-radius:10px;color:#52525b;font-size:12.5px;">${escapeHtml(inv.memo.slice(0, 300))}</p>` : ''}
      <p style="margin:18px 0 0;color:#52525b;font-size:12.5px;line-height:1.7;">청구서 PDF 는 이 이메일에 첨부되어 있습니다. 세금계산서 발행은 별도 요청 부탁드립니다.</p>
    </td></tr>
    <tr><td style="padding:14px 24px 20px;border-top:1px solid #e4e4e7;background:#fafafa;">
      <p style="margin:0;font-size:11px;color:#71717a;line-height:1.6;">
        본 메일은 자동 발송된 청구서입니다.<br/>
        문의: <a href="mailto:freemilesarea@gmail.com" style="color:#18181b;">freemilesarea@gmail.com</a>
      </p>
    </td></tr>
  </table>
</body></html>`;
}

async function downloadPdfAsBase64(env: Env, storagePath: string): Promise<string> {
  const supabase = createClient(env.SUPABASE_URL, env.SERVICE_ROLE);
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
  if (error || !data) throw new Error(`PDF download failed: ${error?.message}`);
  const buf = new Uint8Array(await data.arrayBuffer());
  // Base64 encode
  let bin = '';
  for (let i = 0; i < buf.byteLength; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}

async function finalizeJob(
  env: Env, jobId: string, status: 'sent' | 'failed',
  resendId: string | null, errorMsg: string | null,
): Promise<void> {
  await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/admin_finalize_billing_email_job`, {
    method: 'POST',
    headers: { apikey: env.SERVICE_ROLE, Authorization: `Bearer ${env.SERVICE_ROLE}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_job_id: jobId, p_status: status, p_resend_id: resendId, p_error: errorMsg }),
  }).catch(() => undefined);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const env = readEnv();
  const envPresence = {
    SUPABASE_URL: Boolean(env.SUPABASE_URL),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(env.SERVICE_ROLE),
    SUPABASE_ANON_KEY: Boolean(env.ANON_KEY),
    RESEND_API_KEY: Boolean(env.RESEND_API_KEY),
    RESEND_FROM_IS_FALLBACK: env.RESEND_FROM_IS_FALLBACK,
  };
  if (!env.SUPABASE_URL || !env.SERVICE_ROLE || !env.ANON_KEY || !env.RESEND_API_KEY) {
    return json({ error: 'missing_env', hint: JSON.stringify(envPresence) }, 500);
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  if (body.health === true) {
    return json({ ok: true, module_load_at: MODULE_LOAD_AT, env_presence: envPresence });
  }

  const jobId = String(body.job_id ?? '').trim();
  if (!jobId) return json({ error: 'job_id required' }, 400);

  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'missing_bearer' }, 401);

  const gate = await verifyAdmin(env, token);
  if (!gate.ok) return json({ error: 'forbidden', reason: gate.reason }, 403);

  const t0 = Date.now();
  let job: EmailJob | null = null;
  try {
    job = await fetchJob(env, jobId);
    if (!job) return json({ error: 'job_not_found', job_id: jobId }, 404);
    if (job.status !== 'pending') {
      return json({ error: 'job_not_pending', job_id: jobId, current_status: job.status }, 409);
    }

    const inv = await fetchInvoice(env, job.invoice_id);
    if (!inv.pdf_url) throw new Error('invoice has no pdf_url yet');

    const pdfBase64 = await downloadPdfAsBase64(env, inv.pdf_url);
    const html = buildHtml(inv);
    const attachmentName = `invoice-${inv.billing_month.slice(0, 7)}-${inv.id.slice(0, 8)}.pdf`;

    const payload = {
      from: env.RESEND_FROM,
      to: [job.to_email],
      cc: job.cc_emails && job.cc_emails.length > 0 ? job.cc_emails : undefined,
      subject: `[듣다] ${inv.billing_month.slice(0, 7)} 청구서 — ${inv.enterprise_account_name ?? ''}`,
      html,
      attachments: [{ filename: attachmentName, content: pdfBase64 }],
    };

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const raw = await res.text();
    let data: any = null;
    try { data = JSON.parse(raw); } catch { /* non-json */ }

    if (!res.ok) {
      const errMsg = (data && (data.message || data.error || data.name)) || `HTTP ${res.status}`;
      const summary = `[${res.status}] ${String(errMsg)}`.slice(0, 1500);
      await finalizeJob(env, jobId, 'failed', null, summary);
      console.error('[dispatch-billing] Resend error:', { status: res.status, body: raw.slice(0, 800), to: job.to_email, job_id: jobId });
      return json({ ok: false, job_id: jobId, status: 'failed', error_message: summary, duration_ms: Date.now() - t0 });
    }

    const resendId = data?.id ?? data?.message_id ?? '';
    await finalizeJob(env, jobId, 'sent', resendId, null);
    console.log('[dispatch-billing] sent:', { to: job.to_email, job_id: jobId, resend_id: resendId });
    return json({ ok: true, job_id: jobId, status: 'sent', resend_id: resendId, duration_ms: Date.now() - t0 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (job) await finalizeJob(env, jobId, 'failed', null, msg.slice(0, 1500));
    return json({ error: 'dispatch_failed', message: msg, job_id: jobId, duration_ms: Date.now() - t0 }, 500);
  }
});
