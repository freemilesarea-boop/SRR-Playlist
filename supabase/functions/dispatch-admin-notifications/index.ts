// supabase/functions/dispatch-admin-notifications/index.ts
//
// 운영 알림 외부 채널 디스패처 — admin_notifications 신규 row 를 Slack webhook /
// 이메일 (Resend) 로 전송.
//
// 호출:
//   POST /dispatch-admin-notifications  body: { notification_id }
//     - admin Bearer 또는 x-cron-secret 헤더
//     - 단일 알림 dispatch
//   POST /dispatch-admin-notifications  body: { since_ts?, limit?: 20 }
//     - admin Bearer 또는 x-cron-secret
//     - 일정 시각 이후 미발송 알림 일괄 (선택적 사용)
//
// 정책:
// - admin_settings 에서 채널 설정 읽음
// - notification_min_severity 미만이면 skip
// - Slack webhook URL 없거나 빈 문자열이면 Slack skip
// - notification_email_enabled=false 또는 to 빈 문자열이면 email skip
// - 채널 전송 실패는 silent log (워커 실패로 전파 X)
// - 알림 row 자체는 변경 안 함 (UI 종에서 unread 그대로 보임)

// deno-lint-ignore-file no-explicit-any

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MODULE_LOAD_AT = new Date().toISOString();

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

const SEV_ORDER: Record<string, number> = { info: 1, warning: 2, error: 3 };
const SEV_EMOJI: Record<string, string> = { info: 'ℹ️', warning: '⚠️', error: '🚨' };

interface NotificationRow {
  id: number;
  kind: string;
  severity: 'info' | 'warning' | 'error';
  title: string;
  body: string | null;
  context: Record<string, unknown> | null;
  track_id: string | null;
  created_at: string;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function sendSlack(webhookUrl: string, n: NotificationRow): Promise<{ ok: boolean; error?: string }> {
  const emoji = SEV_EMOJI[n.severity] ?? '📣';
  const text = `${emoji} *${n.title}*`;
  const blocks: any[] = [
    { type: 'header', text: { type: 'plain_text', text: `${emoji} ${n.title}`.slice(0, 150) } },
    { type: 'section', fields: [
      { type: 'mrkdwn', text: `*severity:*\n${n.severity}` },
      { type: 'mrkdwn', text: `*kind:*\n${n.kind}` },
    ]},
  ];
  if (n.body) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: n.body.slice(0, 2900) } });
  }
  if (n.track_id) {
    blocks.push({ type: 'context', elements: [
      { type: 'mrkdwn', text: `track_id: \`${n.track_id}\`` },
    ]});
  }
  blocks.push({ type: 'context', elements: [
    { type: 'mrkdwn', text: `${n.created_at} · id ${n.id}` },
  ]});
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, blocks }),
    });
    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      return { ok: false, error: `slack ${res.status}: ${raw.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function sendEmail(
  resendKey: string, from: string, to: string[], n: NotificationRow,
): Promise<{ ok: boolean; error?: string }> {
  const emoji = SEV_EMOJI[n.severity] ?? '📣';
  const subject = `[듣다 Ops ${n.severity.toUpperCase()}] ${n.title}`.slice(0, 180);
  const html = `<!DOCTYPE html><html lang="ko"><body style="font-family:-apple-system,sans-serif;background:#f4f4f5;padding:24px;color:#18181b;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;">
    <h2 style="margin:0 0 12px;">${emoji} ${escapeHtml(n.title)}</h2>
    <table style="font-size:13px;line-height:1.7;width:100%;">
      <tr><td style="color:#71717a;width:120px;">severity</td><td><b>${n.severity}</b></td></tr>
      <tr><td style="color:#71717a;">kind</td><td>${escapeHtml(n.kind)}</td></tr>
      ${n.track_id ? `<tr><td style="color:#71717a;">track_id</td><td><code>${n.track_id}</code></td></tr>` : ''}
      <tr><td style="color:#71717a;">시각</td><td>${new Date(n.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</td></tr>
    </table>
    ${n.body ? `<div style="background:#f4f4f5;border-radius:8px;padding:12px;margin-top:12px;white-space:pre-wrap;font-size:13px;">${escapeHtml(n.body)}</div>` : ''}
    <p style="margin-top:18px;font-size:11px;color:#71717a;">듣다 운영 알림 시스템 자동 발송 · admin_notifications id ${n.id}</p>
  </div>
</body></html>`;
  // [diag] Resend 실제 payload 의 from 값 — 운영 진단용
  console.log('[dispatch-admin-notifications] resend.send', { from, to, subject });
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      return { ok: false, error: `resend ${res.status}: ${raw.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
  const RESEND_FROM = Deno.env.get('RESEND_FROM') || '듣다 운영 <no-reply@deudda.com>';

  const authHeader = req.headers.get('authorization') ?? '';
  const cronSecret = req.headers.get('x-cron-secret') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  const sbAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  let mode: 'admin' | 'cron' | null = null;
  if (CRON_SECRET && cronSecret && cronSecret === CRON_SECRET) {
    mode = 'cron';
  } else if (token) {
    const sbUser = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userRes } = await sbUser.auth.getUser();
    if (userRes?.user) {
      const { data: u } = await sbAdmin.from('users').select('role').eq('id', userRes.user.id).maybeSingle();
      if (u && (u as { role?: string }).role === 'admin') mode = 'admin';
    }
  }
  if (!mode) return json({ error: 'unauthorized' }, 401);

  let body: { notification_id?: number; since_ts?: string; limit?: number } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  // 채널 설정 읽기
  const { data: settingsRows } = await sbAdmin
    .from('admin_settings').select('key, value')
    .in('key', [
      'notification_slack_webhook_url',
      'notification_email_enabled',
      'notification_email_to',
      'notification_min_severity',
    ]);
  const settings: Record<string, any> = {};
  for (const r of settingsRows ?? []) settings[(r as any).key] = (r as any).value;

  const slackUrl = typeof settings['notification_slack_webhook_url'] === 'string'
    ? settings['notification_slack_webhook_url'] : '';
  const emailEnabled = settings['notification_email_enabled'] === true;
  const emailToRaw = typeof settings['notification_email_to'] === 'string'
    ? settings['notification_email_to'] : '';
  const minSeverity = typeof settings['notification_min_severity'] === 'string'
    ? settings['notification_min_severity'] : 'warning';

  const slackEnabled = slackUrl && slackUrl.startsWith('https://');
  const emailReady = emailEnabled && emailToRaw.length > 0 && RESEND_API_KEY.length > 0;
  const emailTo = emailToRaw.split(',').map((s) => s.trim()).filter(Boolean);

  console.log('[notify-dispatch] config', {
    mode, slack: !!slackEnabled, email: emailReady,
    minSev: minSeverity, module_load_at: MODULE_LOAD_AT,
  });

  // 알림 row 가져오기
  let notifications: NotificationRow[] = [];
  if (body.notification_id) {
    const { data, error } = await sbAdmin
      .from('admin_notifications')
      .select('id, kind, severity, title, body, context, track_id, created_at')
      .eq('id', body.notification_id);
    if (error) return json({ ok: false, error: error.message }, 500);
    notifications = (data ?? []) as NotificationRow[];
  } else {
    const sinceTs = body.since_ts ?? new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const limit = Math.min(Math.max(1, body.limit ?? 20), 100);
    const { data, error } = await sbAdmin
      .from('admin_notifications')
      .select('id, kind, severity, title, body, context, track_id, created_at')
      .gte('created_at', sinceTs)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return json({ ok: false, error: error.message }, 500);
    notifications = (data ?? []) as NotificationRow[];
  }

  const minSevLevel = SEV_ORDER[minSeverity] ?? 2;
  const targets = notifications.filter((n) => (SEV_ORDER[n.severity] ?? 1) >= minSevLevel);

  const results: any[] = [];
  for (const n of targets) {
    const r: any = { id: n.id, severity: n.severity, slack: 'skipped', email: 'skipped' };
    if (slackEnabled) {
      const sr = await sendSlack(slackUrl, n);
      r.slack = sr.ok ? 'sent' : `failed: ${sr.error}`;
    }
    if (emailReady) {
      const er = await sendEmail(RESEND_API_KEY, RESEND_FROM, emailTo, n);
      r.email = er.ok ? 'sent' : `failed: ${er.error}`;
    }
    results.push(r);
  }
  console.log('[notify-dispatch] done', { mode, attempted: targets.length, total: notifications.length });
  return json({
    ok: true, mode,
    processed: targets.length, total_fetched: notifications.length,
    channels: { slack: slackEnabled, email: emailReady },
    min_severity: minSeverity,
    results,
  });
});
