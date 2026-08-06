// supabase/functions/dispatch-legacy-recovery-notices/index.ts
//
// Phase LEGACY-BILLING-RECOVERY-BUILD-NOTIFY-1 — Legacy 복구 고객 안내(이메일) 발송.
//
// 안전 원칙:
//   • dry_run 기본 true. BILLING_RECOVERY_NOTIFY_ENABLED 가 명확히 참이 아니면
//     요청과 무관하게 dry-run(발송 안 함)으로 강제(fail-closed).
//   • 대상은 SQL RPC legacy_recovery_notify_candidates 가 확정(관리자·데모·무료·해지·
//     이미발송 제외). SMS Provider 미연결 → 이메일 전용(Resend).
//   • 개인정보(email)는 서버측에서만 처리, 응답/로그에 익명 ID·마스킹만.
//   • (subscription, channel, template, execution_id) 멱등. 동일 안내 중복 발송 없음.
//   • 이 함수는 결제를 실행하지 않는다(안내 발송만).
//
// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const RESEND_FROM_FALLBACK = 'DEUDDA <no-reply@deudda.com>';
const APP_PUBLIC_URL_FALLBACK = 'https://deudda.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...corsHeaders } });
}
function readEnv() {
  return {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL') ?? '',
    SERVICE_ROLE: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    RESEND_API_KEY: Deno.env.get('RESEND_API_KEY') ?? '',
    RESEND_FROM: Deno.env.get('RESEND_FROM') || RESEND_FROM_FALLBACK,
    APP_PUBLIC_URL: Deno.env.get('APP_PUBLIC_URL') || APP_PUBLIC_URL_FALLBACK,
    CRON_SECRET: Deno.env.get('CRON_SECRET') ?? '',
    NOTIFY_ENABLED: Deno.env.get('BILLING_RECOVERY_NOTIFY_ENABLED') ?? '',
  };
}
function killOn(raw: string): boolean { const v = (raw ?? '').trim().toLowerCase(); return v === 'true' || v === '1'; }
function anonId(id: string): string { return id.slice(0, 6); }
function maskEmail(e: string): string {
  if (!e || !e.includes('@')) return '***';
  const [l, d] = e.split('@');
  return `${l.slice(0, 2)}***@${(d[0] ?? '')}***`;
}
function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }

// 결제 예정일 = 발송 +24h 이후 첫 15:00 KST(=06:00 UTC). (legacyRecovery.ts 미러)
function computeScheduledChargeAt(sendMs: number): string {
  const min = new Date(sendMs + 24 * 3600_000);
  let cand = new Date(Date.UTC(min.getUTCFullYear(), min.getUTCMonth(), min.getUTCDate(), 6, 0, 0, 0));
  if (cand.getTime() < min.getTime()) cand = new Date(cand.getTime() + 24 * 3600_000);
  return cand.toISOString();
}
function formatKstNotice(iso: string): string {
  const k = new Date(new Date(iso).getTime() + 9 * 3600_000);
  return `${k.getUTCFullYear()}년 ${pad2(k.getUTCMonth() + 1)}월 ${pad2(k.getUTCDate())}일 ${pad2(k.getUTCHours())}시 이후`;
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface Candidate {
  subscription_id: string; user_id: string; email: string;
  template_type: 'auto_recharge' | 'payment_method_required';
  amount: number; current_period_end: string;
}

function subjectFor(t: Candidate['template_type']): string {
  return t === 'auto_recharge' ? '[듣다] 정기결제 재개 안내' : '[듣다] 결제수단 재등록 요청';
}
function paragraphsFor(t: Candidate['template_type'], manageUrl: string, scheduledNotice: string): string[] {
  if (t === 'auto_recharge') {
    return [
      '안녕하세요, 듣다입니다.',
      '시스템 오류로 회원님의 정기결제가 정상적으로 처리되지 않은 사실을 확인했습니다. 누락된 과거 이용료를 여러 번 청구하지 않으며, 현재 이용을 계속하기 위한 1개월 이용료 <b>4,900원</b>만 기존에 등록하신 결제수단으로 결제할 예정입니다.',
      `<b>결제 예정일: ${escapeHtml(scheduledNotice)}</b>`,
      `결제를 원하지 않으시거나 구독 해지를 원하시는 경우, 결제 예정 시각 전까지 듣다 구독 관리 페이지에서 해지해 주세요.`,
      '불편을 드려 죄송합니다.<br/>듣다 드림',
    ];
  }
  return [
    '안녕하세요, 듣다입니다.',
    '등록된 정기결제 정보로 다음 결제를 진행할 수 없어 안내드립니다. 서비스 이용을 계속하시려면 아래 구독 관리 페이지에서 결제수단을 다시 등록해 주세요.',
    '결제수단을 등록하기 전에는 자동결제가 진행되지 않습니다. 구독을 원하지 않으시면 별도의 결제를 진행하지 않으셔도 됩니다.',
    '불편을 드려 죄송합니다.<br/>듣다 드림',
  ];
}
function buildHtml(c: Candidate, appUrl: string, scheduledNotice: string): string {
  const cta = `${appUrl}/subscription`;
  const eyebrow = c.template_type === 'auto_recharge' ? 'Billing · Recovery' : 'Billing · Payment Method';
  const headline = c.template_type === 'auto_recharge' ? '정기결제 재개 안내' : '결제수단 재등록 요청';
  const ctaLabel = c.template_type === 'auto_recharge' ? '구독 관리 · 해지' : '결제수단 등록';
  const paras = paragraphsFor(c.template_type, cta, scheduledNotice)
    .map((p) => `<p style="margin:0 0 16px 0; font-family:'Apple SD Gothic Neo',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:15px; line-height:1.7; color:#A0A0A0;">${p}</p>`)
    .join('');
  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<meta name="color-scheme" content="dark"/><title>${escapeHtml(headline)}</title>
<style>@media only screen and (max-width:480px){.container{width:100%!important}.px{padding-left:28px!important;padding-right:28px!important}.cta{display:block!important;width:100%!important;box-sizing:border-box!important}}
:root{color-scheme:dark}body,table,td{background-color:#0A0A0A}a{color:#B68DFF}</style></head>
<body style="margin:0;padding:0;background-color:#0A0A0A;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0A0A0A"><tr><td align="center" style="padding:40px 16px;">
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
<tr><td align="center" style="padding:4px 0 28px 0;"><span style="font-family:'Apple SD Gothic Neo',-apple-system,sans-serif;font-size:24px;font-weight:800;color:#FFFFFF;">DEUDDA<span style="color:#7B3FF2;">.</span></span></td></tr>
<tr><td class="px" bgcolor="#111111" style="background-color:#111111;border-radius:20px;padding:44px;">
<p style="margin:0 0 12px 0;font-family:'SF Mono',monospace;font-size:11px;font-weight:600;color:#7B3FF2;letter-spacing:0.22em;text-transform:uppercase;">${escapeHtml(eyebrow)}</p>
<h1 style="margin:0 0 20px 0;font-family:'Apple SD Gothic Neo',-apple-system,sans-serif;font-size:26px;line-height:1.35;font-weight:800;color:#FFFFFF;">${escapeHtml(headline)}</h1>
${paras}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:8px 0 4px 0;">
<a class="cta" href="${cta}" target="_blank" style="display:inline-block;background-color:#7B3FF2;color:#FFFFFF;font-family:'Apple SD Gothic Neo',-apple-system,sans-serif;font-size:16px;font-weight:700;text-decoration:none;padding:16px 40px;border-radius:12px;">${escapeHtml(ctaLabel)}</a>
</td></tr></table>
<p style="margin:24px 0 0 0;font-family:'SF Mono',monospace;font-size:12px;line-height:1.6;word-break:break-all;"><a href="${cta}" target="_blank" style="color:#B68DFF;">${cta}</a></p>
</td></tr>
<tr><td align="center" style="padding:32px 24px 8px 24px;"><p style="margin:0;font-family:'SF Mono',monospace;font-size:10px;color:#4B5163;letter-spacing:0.1em;">© DEUDDA · Louver Studio</p></td></tr>
</table></td></tr></table></body></html>`;
}

async function rpc<T>(env: ReturnType<typeof readEnv>, fn: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: env.SERVICE_ROLE, Authorization: `Bearer ${env.SERVICE_ROLE}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`RPC ${fn} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}
async function sendResend(env: ReturnType<typeof readEnv>, to: string, subject: string, html: string): Promise<string> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.RESEND_FROM, to: [to], subject, html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  const j = (await res.json().catch(() => ({}))) as { id?: string };
  return j.id ?? '';
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const env = readEnv();
  const cronSecret = req.headers.get('x-cron-secret') ?? '';
  const authHeader = req.headers.get('authorization') ?? '';
  const isCron = !!env.CRON_SECRET && cronSecret === env.CRON_SECRET;
  const isServiceRole = !!env.SERVICE_ROLE && authHeader === `Bearer ${env.SERVICE_ROLE}`;
  if (!isCron && !isServiceRole) return json({ error: 'unauthorized' }, 401);
  if (!env.SUPABASE_URL || !env.SERVICE_ROLE) return json({ error: 'supabase_env_missing' }, 500);

  let body: { dry_run?: boolean; execution_id?: string; subscription_ids?: string[]; limit?: number } = {};
  try { body = await req.json(); } catch { /* empty ok */ }

  const notifyEnabled = killOn(env.NOTIFY_ENABLED);
  // fail-closed: 스위치 off 면 요청과 무관하게 dry-run.
  const dryRun = !notifyEnabled || body.dry_run !== false;
  const limit = Math.min(Math.max(1, typeof body.limit === 'number' ? Math.floor(body.limit) : 50), 200);
  const executionId = (typeof body.execution_id === 'string' && body.execution_id.trim())
    ? body.execution_id.trim().slice(0, 80) : `notify_${Date.now().toString(36)}`;
  const idFilter = Array.isArray(body.subscription_ids)
    ? new Set(body.subscription_ids.filter((s) => /^[0-9a-f-]{36}$/i.test(s))) : null;

  const sentNowMs = Date.now();
  const scheduledIso = computeScheduledChargeAt(sentNowMs);
  const scheduledNotice = formatKstNotice(scheduledIso);

  let candidates: Candidate[] = [];
  try { candidates = await rpc<Candidate[]>(env, 'legacy_recovery_notify_candidates', {}); }
  catch (e) { return json({ error: 'candidates_query_failed', detail: String(e) }, 500); }

  let targets = idFilter ? candidates.filter((c) => idFilter.has(c.subscription_id)) : candidates;
  targets = targets.slice(0, limit);

  const summary = {
    auto_recharge: targets.filter((c) => c.template_type === 'auto_recharge').length,
    payment_method_required: targets.filter((c) => c.template_type === 'payment_method_required').length,
  };

  if (dryRun) {
    return json({
      ok: true, dry_run: true, notify_enabled: notifyEnabled, execution_id: executionId,
      scheduled_charge_at: scheduledIso, scheduled_notice: scheduledNotice, summary,
      would_send: targets.map((c) => ({ subscription_id: anonId(c.subscription_id), template: c.template_type, to: maskEmail(c.email) })),
    });
  }

  if (!env.RESEND_API_KEY) return json({ error: 'resend_api_key_missing' }, 500);

  const results: Array<Record<string, unknown>> = [];
  for (const c of targets) {
    const r: Record<string, unknown> = { subscription_id: anonId(c.subscription_id), template: c.template_type };
    try {
      const scheduledForRow = c.template_type === 'auto_recharge' ? scheduledIso : null;
      const notifId = await rpc<string | null>(env, 'record_recovery_notification', {
        p_subscription_id: c.subscription_id, p_user_id: c.user_id, p_execution_id: executionId,
        p_channel: 'email', p_template_type: c.template_type, p_scheduled_charge_at: scheduledForRow,
      });
      if (!notifId) { r.status = 'skipped_already_recorded'; results.push(r); continue; }
      try {
        const msgId = await sendResend(env, c.email, subjectFor(c.template_type), buildHtml(c, env.APP_PUBLIC_URL, scheduledNotice));
        await rpc(env, 'mark_recovery_notification_result', { p_id: notifId, p_status: 'sent', p_provider_message_id: msgId });
        r.status = 'sent';
      } catch (e) {
        await rpc(env, 'mark_recovery_notification_result', { p_id: notifId, p_status: 'failed', p_failure_code: String(e).slice(0, 200) });
        r.status = 'failed';
      }
    } catch (e) { r.status = 'error'; r.error = String(e).slice(0, 200); }
    results.push(r);
  }

  return json({
    ok: true, dry_run: false, notify_enabled: notifyEnabled, execution_id: executionId,
    scheduled_charge_at: scheduledIso, scheduled_notice: scheduledNotice, summary,
    sent: results.filter((r) => r.status === 'sent').length,
    failed: results.filter((r) => r.status === 'failed' || r.status === 'error').length,
    skipped: results.filter((r) => String(r.status).startsWith('skipped')).length,
    results,
  });
});
