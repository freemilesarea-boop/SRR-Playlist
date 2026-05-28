// supabase/functions/dispatch-trial-reminders/index.ts
//
// 무료 체험 D-day 자동 알림 메일 발송.
//
// 트리거: Vercel cron (/api/cron/daily-metrics) 가 매일 KST 10시(UTC 01시) 호출.
// 인증: x-cron-secret 헤더 또는 service_role JWT.
//
// 흐름:
//   1) RPC trial_reminder_candidates() — 오늘 보낼 사용자 + kind 반환
//   2) kind 별 HTML 빌드 (DEUDDA 다크 톤, /supabase/templates 와 동일 어법)
//   3) Resend API POST
//   4) 성공 시 mark_trial_email_sent(user_id, kind) 호출 — 멱등 보장
//   5) 결과 요약 반환
//
// 실패 처리: 단건 실패는 results 에 error 로 기록, 200 OK 유지. 다른 사용자 발송 영향 없음.

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
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders },
  });
}

interface Candidate {
  user_id: string;
  email: string;
  store_name: string | null;
  business_name: string | null;
  free_trial_ends_at: string;
  kind: 'd-3' | 'd-1' | 'expired';
}

function readEnv() {
  return {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL') ?? '',
    SERVICE_ROLE: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    RESEND_API_KEY: Deno.env.get('RESEND_API_KEY') ?? '',
    RESEND_FROM: Deno.env.get('RESEND_FROM') || RESEND_FROM_FALLBACK,
    APP_PUBLIC_URL: Deno.env.get('APP_PUBLIC_URL') || APP_PUBLIC_URL_FALLBACK,
    CRON_SECRET: Deno.env.get('CRON_SECRET') ?? '',
  };
}

function subjectFor(kind: Candidate['kind']): string {
  switch (kind) {
    case 'd-3':
      return '[듣다] 무료 체험 3일 남았어요';
    case 'd-1':
      return '[듣다] 무료 체험 내일 끝나요';
    case 'expired':
      return '[듣다] 무료 체험이 끝났어요';
  }
}

function ctaLabelFor(kind: Candidate['kind']): string {
  return kind === 'expired' ? '지금 구독하고 계속 듣기' : '구독 플랜 보기';
}

function eyebrowFor(kind: Candidate['kind']): string {
  switch (kind) {
    case 'd-3':
      return 'Trial · 3 Days Left';
    case 'd-1':
      return 'Trial · Last Day';
    case 'expired':
      return 'Trial · Expired';
  }
}

function headlineFor(kind: Candidate['kind']): string {
  switch (kind) {
    case 'd-3':
      return '무료 체험이 3일 남았어요';
    case 'd-1':
      return '내일 무료 체험이 끝나요';
    case 'expired':
      return '무료 체험이 끝났어요';
  }
}

function bodyFor(c: Candidate): string {
  const store = c.store_name || c.business_name || '매장';
  switch (c.kind) {
    case 'd-3':
      return `<b>${escapeHtml(store)}</b>의 매장 음악 자동 운영 무료 체험이 <b>3일</b> 남았어요. ` +
        `종료 후에는 재생이 중단되니, 미리 구독 플랜을 확인해주세요.`;
    case 'd-1':
      return `<b>${escapeHtml(store)}</b>의 무료 체험이 <b>내일</b> 종료돼요. ` +
        `매장 운영이 끊기지 않도록 지금 구독해두시면 됩니다.`;
    case 'expired':
      return `<b>${escapeHtml(store)}</b>의 무료 체험이 종료됐어요. ` +
        `다시 매장 음악을 켜고 싶다면 아래에서 플랜을 선택해주세요.`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildHtml(c: Candidate, appUrl: string): string {
  const cta = `${appUrl}/subscription`;
  const eyebrow = eyebrowFor(c.kind);
  const headline = headlineFor(c.kind);
  const body = bodyFor(c);
  const ctaLabel = ctaLabelFor(c.kind);
  // 다크 톤 (PR #23 auth 메일과 동일 톤). inline 스타일 — Gmail/iPhone Mail 호환.
  return `<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="dark" />
    <meta name="supported-color-schemes" content="dark" />
    <title>${escapeHtml(headline)}</title>
    <style>
      @media only screen and (max-width: 480px) {
        .container { width: 100% !important; }
        .px { padding-left: 28px !important; padding-right: 28px !important; }
        .cta { display: block !important; width: 100% !important; box-sizing: border-box !important; }
        .h1 { font-size: 22px !important; }
      }
      :root { color-scheme: dark; supported-color-schemes: dark; }
      body, table, td { background-color: #0A0A0A; }
      a { color: #B68DFF; }
    </style>
  </head>
  <body style="margin:0; padding:0; background-color:#0A0A0A; -webkit-font-smoothing:antialiased;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:#0A0A0A; font-size:1px; line-height:1px;">
      ${escapeHtml(headline)} · ${escapeHtml(bodyFor({ ...c, kind: c.kind }).replace(/<[^>]+>/g, ''))}
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0A0A0A" style="background-color:#0A0A0A;">
      <tr><td align="center" style="padding:40px 16px;">
        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px;">
          <tr><td align="center" style="padding:4px 0 28px 0;">
            <span style="font-family:'Apple SD Gothic Neo',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:24px; font-weight:800; color:#FFFFFF; letter-spacing:-0.5px;">DEUDDA<span style="color:#7B3FF2;">.</span></span>
          </td></tr>
          <tr><td class="px" bgcolor="#111111" style="background-color:#111111; border-radius:20px; padding:44px 44px;">
            <p style="margin:0 0 12px 0; font-family:'SF Mono','JetBrains Mono','Roboto Mono',Menlo,Consolas,monospace; font-size:11px; line-height:1.4; font-weight:600; color:#7B3FF2; letter-spacing:0.22em; text-transform:uppercase;">${escapeHtml(eyebrow)}</p>
            <h1 class="h1" style="margin:0 0 20px 0; font-family:'Apple SD Gothic Neo',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:26px; line-height:1.35; font-weight:800; color:#FFFFFF; letter-spacing:-0.5px;">${escapeHtml(headline)}</h1>
            <p style="margin:0 0 28px 0; font-family:'Apple SD Gothic Neo',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:15px; line-height:1.7; color:#A0A0A0;">${body}</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:8px 0 4px 0;">
              <a class="cta" href="${cta}" target="_blank" style="display:inline-block; background-color:#7B3FF2; color:#FFFFFF; font-family:'Apple SD Gothic Neo',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; font-weight:700; text-decoration:none; padding:16px 40px; border-radius:12px; letter-spacing:-0.3px; mso-padding-alt:0;">${escapeHtml(ctaLabel)}</a>
            </td></tr></table>
            <p style="margin:28px 0 0 0; font-family:'SF Mono','JetBrains Mono','Roboto Mono',Menlo,Consolas,monospace; font-size:11px; line-height:1.5; color:#6B7280; letter-spacing:0.06em;">버튼이 안 보이면 아래 주소를 복사해 브라우저에 붙여넣어 주세요.</p>
            <p style="margin:8px 0 0 0; font-family:'SF Mono','JetBrains Mono','Roboto Mono',Menlo,Consolas,monospace; font-size:12px; line-height:1.6; word-break:break-all;"><a href="${cta}" target="_blank" style="color:#B68DFF; text-decoration:underline;">${cta}</a></p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:32px;"><tr><td height="1" style="background-color:#1F1F1F; line-height:1px; font-size:1px;">&nbsp;</td></tr></table>
            <p style="margin:20px 0 0 0; font-family:'Apple SD Gothic Neo',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; line-height:1.7; color:#6B7280;">본 메일은 무료 체험 진행 상태에 따라 자동으로 발송됩니다.<br />이미 구독을 시작하셨다면 이 메일을 무시하셔도 됩니다.</p>
          </td></tr>
          <tr><td align="center" style="padding:32px 24px 8px 24px;">
            <p style="margin:0 0 8px 0; font-family:'Apple SD Gothic Neo',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:13px; font-weight:700; color:#A0A0A0;">DEUDDA — 매장을 위한 AI 음악 운영 시스템</p>
            <p style="margin:0 0 6px 0; font-family:'SF Mono','JetBrains Mono','Roboto Mono',Menlo,Consolas,monospace; font-size:11px; color:#6B7280; letter-spacing:0.06em;">
              <a href="${appUrl}" target="_blank" style="color:#B68DFF; text-decoration:none;">deudda.com</a>
              &nbsp;·&nbsp;
              <a href="mailto:freemilesarea@gmail.com?subject=듣다 문의" style="color:#6B7280; text-decoration:none;">고객문의</a>
            </p>
            <p style="margin:0; font-family:'SF Mono','JetBrains Mono','Roboto Mono',Menlo,Consolas,monospace; font-size:10px; color:#4B5163; letter-spacing:0.1em;">© DEUDDA · Louver Studio</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

async function rpc<T>(env: ReturnType<typeof readEnv>, fn: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: env.SERVICE_ROLE,
      Authorization: `Bearer ${env.SERVICE_ROLE}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`RPC ${fn} failed: ${res.status} ${txt}`);
  }
  return (await res.json()) as T;
}

async function sendResend(env: ReturnType<typeof readEnv>, to: string, subject: string, html: string): Promise<void> {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY 미설정');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: env.RESEND_FROM,
      to: [to],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Resend ${res.status}: ${txt}`);
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const env = readEnv();

  // 인증: x-cron-secret 헤더 (Vercel cron) 또는 service_role JWT
  const cronSecret = req.headers.get('x-cron-secret') ?? '';
  const authHeader = req.headers.get('authorization') ?? '';
  const isCron = env.CRON_SECRET && cronSecret === env.CRON_SECRET;
  const isServiceRole = authHeader === `Bearer ${env.SERVICE_ROLE}`;
  if (!isCron && !isServiceRole) {
    return json({ error: 'unauthorized' }, 401);
  }

  if (!env.SUPABASE_URL || !env.SERVICE_ROLE) {
    return json({ error: 'SUPABASE env 미설정' }, 500);
  }

  let candidates: Candidate[] = [];
  try {
    candidates = await rpc<Candidate[]>(env, 'trial_reminder_candidates');
  } catch (e) {
    return json({ error: 'candidates_query_failed', detail: String(e) }, 500);
  }

  const results: Array<{ user_id: string; kind: string; status: 'sent' | 'failed' | 'skipped'; error?: string }> = [];

  for (const c of candidates) {
    const subject = subjectFor(c.kind);
    const html = buildHtml(c, env.APP_PUBLIC_URL);
    try {
      await sendResend(env, c.email, subject, html);
      // 발송 성공 → 표시 (멱등 보장)
      try {
        await rpc(env, 'mark_trial_email_sent', { p_user_id: c.user_id, p_kind: c.kind });
        results.push({ user_id: c.user_id, kind: c.kind, status: 'sent' });
      } catch (e) {
        // 메일은 갔지만 mark 실패 — 다음 cron 때 중복 발송 위험. 로그만 남기고 sent 로 본다.
        results.push({
          user_id: c.user_id,
          kind: c.kind,
          status: 'sent',
          error: `mark_failed: ${String(e)}`,
        });
      }
    } catch (e) {
      results.push({
        user_id: c.user_id,
        kind: c.kind,
        status: 'failed',
        error: String(e),
      });
    }
  }

  return json({
    ok: true,
    ran_at: new Date().toISOString(),
    candidates: candidates.length,
    sent: results.filter((r) => r.status === 'sent').length,
    failed: results.filter((r) => r.status === 'failed').length,
    results,
  });
});
