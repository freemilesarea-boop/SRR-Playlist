// supabase/functions/dispatch-moderation-emails/index.ts
//
// 음원 검수 상태 변경 시 자동 enqueue 된 track_moderation_email_jobs 를 Resend 로 발송.
//
// 엔드포인트:
//   POST /dispatch-moderation-emails        — body: { track_id }
//   POST /dispatch-moderation-emails        — body: { health: true }   admin only
//
// Resend 미설정/오류 시 jobs.status='failed' + last_error 기록 (관리자 재발송 가능)

// deno-lint-ignore-file no-explicit-any

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MODULE_LOAD_AT = new Date().toISOString();
const RESEND_FROM_FALLBACK = '듣다 <no-reply@deudda.com>';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', ...corsHeaders },
  });
}

interface Env {
  SUPABASE_URL: string; ANON_KEY: string; SERVICE_ROLE: string;
  RESEND_API_KEY: string; RESEND_FROM: string; APP_PUBLIC_URL: string;
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
  };
}

interface PendingJob {
  job_id: string; track_id: string;
  recipient_email: string; recipient_user_id: string | null;
  kind: 'approved' | 'rejected' | 'revision_requested' | 'removed' | 'released' | 'scheduled';
  subject: string; attempts: number;
  track_title: string; track_artist: string | null;
  track_code: string | null; release_status: string;
  release_date: string | null;
  admin_review_note: string | null;
  rejected_reason: string | null;
  changes_requested_reason: string | null;
  removed_reason: string | null;
  artist_name: string | null;
  batch_key: string | null;
  batch_count: number;
  batch_titles: string[] | null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtDateKR(iso: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }); }
  catch { return iso; }
}

function buildHtml(job: PendingJob, appUrl: string): string {
  const kindLabel: Record<string, string> = {
    approved: '승인 완료', rejected: '반려', revision_requested: '수정 요청',
    removed: '제거', released: '즉시 공개됨', scheduled: '발매 예약됨',
  };
  const kindColor: Record<string, string> = {
    approved: '#15803d', rejected: '#b91c1c',
    revision_requested: '#b45309', removed: '#7f1d1d',
    released: '#15803d', scheduled: '#1d4ed8',
  };
  const kindBg: Record<string, string> = {
    approved: '#dcfce7', rejected: '#fee2e2',
    revision_requested: '#fef3c7', removed: '#fecaca',
    released: '#dcfce7', scheduled: '#dbeafe',
  };
  const note = job.kind === 'rejected'
    ? job.rejected_reason ?? job.admin_review_note
    : job.kind === 'revision_requested'
      ? job.changes_requested_reason ?? job.admin_review_note
      : job.kind === 'removed'
        ? job.removed_reason ?? job.admin_review_note
        : job.admin_review_note;
  const dashboard = `${appUrl.replace(/\/$/, '')}/artist`;
  const artistDisplay = job.artist_name || job.recipient_email;
  const safeTitle = escapeHtml(job.track_title || '');
  const safeArtist = escapeHtml(job.track_artist || job.artist_name || '');
  const safeNote = note ? escapeHtml(note) : null;
  const label = kindLabel[job.kind] || job.kind;
  const color = kindColor[job.kind] || '#18181b';
  const bg = kindBg[job.kind] || '#f4f4f5';

  // 묶음(앨범/일괄 업로드) 단위 — N곡이면 곡 목록을 함께 표기, 1곡이면 단일 상세
  const count = Math.max(1, job.batch_count || 1);
  const titles = (job.batch_titles && job.batch_titles.length > 0) ? job.batch_titles : [job.track_title];
  const nLabel = count > 1 ? `${count}곡` : '음원';

  let intro = '';
  if (job.kind === 'released') intro = `제출하신 ${nLabel}이 검수 승인되어 지금 바로 서비스에 공개되었습니다. 정산 대상에 즉시 포함됩니다.`;
  else if (job.kind === 'scheduled') intro = `제출하신 ${nLabel}이 검수 승인되어 발매일에 자동으로 공개됩니다. 발매일이 도래할 때까지 공개되지 않으며 정산 대상에서도 제외됩니다.`;
  else if (job.kind === 'approved') intro = `제출하신 ${nLabel}이 검수 승인되었습니다.`;
  else if (job.kind === 'rejected') intro = `제출하신 ${nLabel}이 검수에서 반려되었습니다. 아래 사유를 확인해주세요.`;
  else if (job.kind === 'revision_requested') intro = `제출하신 ${nLabel}에 수정 요청이 도착했습니다. 아래 사유에 따라 수정 후 재제출해주세요.`;
  else if (job.kind === 'removed') intro = `권리 또는 정책 사유로 ${nLabel}이 제거되었습니다. 관련 문의는 운영팀에 연락 부탁드립니다.`;
  else intro = '음원 상태가 업데이트되었습니다.';

  // 묶음 곡 목록 (2곡 이상일 때만 별도 목록 블록 — 너무 길면 상위 30곡까지)
  const listBlock = count > 1
    ? `<tr><td style="padding:4px 28px 12px 28px;">
         <div style="background:#fafafa;border:1px solid #e4e4e7;border-radius:10px;padding:14px 16px;">
           <p style="margin:0 0 8px 0;font-size:11px;color:#71717a;font-weight:700;">승인된 곡 목록 (${count}곡)</p>
           <ol style="margin:0;padding-left:18px;font-size:13px;line-height:1.7;color:#27272a;">
             ${titles.slice(0, 30).map((t) => `<li>${escapeHtml(t || '')}</li>`).join('')}
             ${count > 30 ? `<li style="color:#71717a;">외 ${count - 30}곡…</li>` : ''}
           </ol>
         </div>
       </td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(job.subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Apple SD Gothic Neo','Noto Sans KR',sans-serif;color:#18181b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;max-width:100%;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        <tr><td style="padding:24px 28px 12px 28px;border-bottom:1px solid #e4e4e7;">
          <span style="display:inline-block;background:${bg};color:${color};padding:4px 10px;border-radius:9999px;font-size:11px;font-weight:700;">${label}</span>
          <h1 style="margin:8px 0 0 0;font-size:18px;font-weight:800;color:#18181b;">음원 검수 안내</h1>
          <p style="margin:6px 0 0 0;font-size:12px;color:#71717a;">듣다 음원 검수 시스템</p>
        </td></tr>
        <tr><td style="padding:20px 28px 4px 28px;font-size:13.5px;line-height:1.7;color:#27272a;">
          ${escapeHtml(intro)}
        </td></tr>
        <tr><td style="padding:12px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;line-height:1.7;">
            <tr><td style="color:#71717a;width:120px;">아티스트</td><td style="color:#18181b;font-weight:600;">${escapeHtml(artistDisplay)}</td></tr>
            ${count > 1
              ? `<tr><td style="color:#71717a;">곡 수</td><td style="color:#18181b;font-weight:600;">${count}곡</td></tr>`
              : `<tr><td style="color:#71717a;">곡 제목</td><td style="color:#18181b;font-weight:600;">${safeTitle || '—'}</td></tr>
                 <tr><td style="color:#71717a;">참여 아티스트</td><td style="color:#18181b;">${safeArtist || '—'}</td></tr>
                 <tr><td style="color:#71717a;">트랙 코드</td><td style="color:#18181b;font-family:ui-monospace,'SFMono-Regular',Menlo,monospace;">${escapeHtml(job.track_code ?? '—')}</td></tr>`}
            <tr><td style="color:#71717a;">발매일</td><td style="color:#18181b;">${escapeHtml(fmtDateKR(job.release_date))}</td></tr>
            <tr><td style="color:#71717a;">상태</td><td style="color:${color};font-weight:600;">${label}</td></tr>
          </table>
        </td></tr>
        ${listBlock}
        ${safeNote ? `
        <tr><td style="padding:0 28px 12px 28px;">
          <div style="background:${bg};border:1px solid ${color}33;border-radius:10px;padding:14px 16px;">
            <p style="margin:0;font-size:11px;color:${color};font-weight:700;">관리자 메모</p>
            <p style="margin:6px 0 0 0;font-size:13px;line-height:1.7;color:#27272a;white-space:pre-wrap;">${safeNote}</p>
          </div>
        </td></tr>` : ''}
        <tr><td style="padding:0 28px 24px 28px;">
          <a href="${escapeHtml(dashboard)}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;padding:10px 18px;border-radius:8px;">아티스트 대시보드 열기</a>
        </td></tr>
        <tr><td style="padding:14px 28px 22px 28px;border-top:1px solid #e4e4e7;background:#fafafa;">
          <p style="margin:0;font-size:11px;color:#71717a;line-height:1.6;">
            본 메일은 듣다 음원 검수 시스템이 자동 발송했습니다.<br/>
            문의: <a href="mailto:freemilesarea@gmail.com" style="color:#18181b;">freemilesarea@gmail.com</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

interface SendResult { ok: boolean; id?: string; error?: string; status_code?: number; raw?: string; }

async function sendOne(env: Env, job: PendingJob, appUrl: string): Promise<SendResult> {
  if (!env.RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY not configured' };
  const html = buildHtml(job, appUrl);
  // [diag] Resend 실제 payload 의 from 값 — 운영 진단용
  console.log('[dispatch-moderation] resend.send', {
    from: env.RESEND_FROM,
    to: job.recipient_email,
    subject: job.subject,
    job_id: job.job_id,
    kind: job.kind,
  });
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.RESEND_FROM, to: [job.recipient_email], subject: job.subject, html }),
    });
    const raw = await res.text();
    let data: any = null;
    try {
      data = JSON.parse(raw);
    } catch (parseErr) {
      // Resend 가 가끔 비-JSON HTML 에러 페이지를 반환 — raw 가 보존되므로 fallback OK.
      console.warn('[mod-dispatch] Resend response not JSON:', { parseErr: String(parseErr), preview: raw.slice(0, 200) });
    }
    if (!res.ok) {
      const errMsg = (data && (data.message || data.error || data.name)) || `HTTP ${res.status}`;
      console.error('[mod-dispatch] Resend error:', {
        status: res.status, body: raw.slice(0, 800), to: job.recipient_email, kind: job.kind, job_id: job.job_id,
      });
      return { ok: false, error: `[${res.status}] ${String(errMsg)}`.slice(0, 1500), status_code: res.status, raw: raw.slice(0, 800) };
    }
    const id = data?.id ?? data?.message_id ?? '';
    console.log('[mod-dispatch] Resend sent:', {
      to: job.recipient_email, kind: job.kind, provider_message_id: id, job_id: job.job_id,
    });
    return { ok: true, id, status_code: res.status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[mod-dispatch] fetch threw:', { msg, to: job.recipient_email });
    return { ok: false, error: msg };
  }
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

  let body: { track_id?: string; health?: boolean; drain?: boolean } = {};
  try { body = await req.json(); }
  catch { return json({ error: 'invalid body' }, 400); }

  const sbAdmin = createClient(env.SUPABASE_URL, env.SERVICE_ROLE, { auth: { persistSession: false } });

  if (body.health) {
    const { data: u } = await sbAdmin.from('users').select('role').eq('id', user.id).maybeSingle();
    if (!u || (u as any).role !== 'admin') return json({ error: 'forbidden' }, 403);
    return json({
      ok: true, module_load_at: MODULE_LOAD_AT, now: new Date().toISOString(),
      env: {
        resend_api_key_set: !!env.RESEND_API_KEY,
        resend_api_key_length: env.RESEND_API_KEY.length,
        resend_from: env.RESEND_FROM,
        supabase_url: env.SUPABASE_URL,
      },
    });
  }

  const trackId = body.track_id;
  // drain 모드: track_id 없이 모든 pending job 처리 (일괄/전체 승인 후 1회 호출).
  // 묶음당 job 이 1개만 enqueue 되므로, 전체 drain 해도 메일은 묶음 수만큼만 발송됨.
  const drain = body.drain === true || !trackId;

  // 권한: admin 만 호출 허용 (artist 본인 dispatch 호출은 자동 발생하지 않으므로)
  const { data: u } = await sbAdmin.from('users').select('role').eq('id', user.id).maybeSingle();
  if (!u || (u as any).role !== 'admin') return json({ error: 'forbidden' }, 403);

  const { data: jobs, error: jErr } = await sbAdmin.rpc(
    'get_pending_track_moderation_email_jobs',
    { p_track_id: drain ? null : trackId, p_limit: drain ? 200 : 50 },
  );
  if (jErr) {
    console.error('[mod-dispatch] get_pending failed:', jErr);
    return json({ error: jErr.message }, 500);
  }
  const pending = (jobs ?? []) as PendingJob[];
  if (pending.length === 0) return json({ ok: true, processed: 0, message: 'no pending jobs' });

  const origin = req.headers.get('origin') ?? '';
  const appUrl = origin && /^https?:\/\//.test(origin) ? origin : env.APP_PUBLIC_URL || 'https://deudda.com';

  console.log('[mod-dispatch] starting', {
    track_id: trackId, pending_count: pending.length, from: env.RESEND_FROM,
    resend_key_set: !!env.RESEND_API_KEY, module_load_at: MODULE_LOAD_AT,
  });

  if (!env.RESEND_API_KEY) {
    for (const job of pending) {
      await sbAdmin.rpc('lock_track_moderation_email_job', { p_job_id: job.job_id });
      await sbAdmin.rpc('mark_track_moderation_email_failed', {
        p_job_id: job.job_id,
        p_error: 'RESEND_API_KEY not configured (module_load_at=' + MODULE_LOAD_AT + ')',
      });
    }
    return json({ ok: false, error: 'RESEND_API_KEY not configured', processed: pending.length, sent: 0, failed: pending.length }, 503);
  }

  let sent = 0, failed = 0;
  const results: Array<{ job_id: string; ok: boolean; to?: string; error?: string; provider_message_id?: string }> = [];
  for (const job of pending) {
    const { data: lockedData } = await sbAdmin.rpc('lock_track_moderation_email_job', { p_job_id: job.job_id });
    if (lockedData !== true) {
      results.push({ job_id: job.job_id, ok: false, error: 'already locked' });
      continue;
    }
    const r = await sendOne(env, job, appUrl);
    if (r.ok) {
      await sbAdmin.rpc('mark_track_moderation_email_sent', { p_job_id: job.job_id, p_provider_message_id: r.id || null });
      sent++;
      results.push({ job_id: job.job_id, ok: true, to: job.recipient_email, provider_message_id: r.id });
    } else {
      const errBody = r.status_code ? `${r.error}${r.raw ? ' | ' + r.raw.slice(0, 200) : ''}` : r.error || 'unknown';
      await sbAdmin.rpc('mark_track_moderation_email_failed', { p_job_id: job.job_id, p_error: errBody });
      failed++;
      results.push({ job_id: job.job_id, ok: false, to: job.recipient_email, error: r.error });
    }
  }
  console.log('[mod-dispatch] done', { track_id: trackId, sent, failed });
  return json({ ok: failed === 0, processed: pending.length, sent, failed, results });
});
