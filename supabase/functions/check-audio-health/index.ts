// supabase/functions/check-audio-health/index.ts
//
// 오디오 헬스체크 워커 — tracks.audio_url 대상으로 HEAD 요청 후 결과를
// tracks.audio_health_status / audio_health_checked_at / audio_health_error /
// audio_content_type / audio_content_length 에 기록.
//
// 상태 매핑:
//   ok          — HEAD 200 + content-type starts with 'audio/' + content-length > 0
//   wrong_mime  — HEAD 200 이지만 content-type 이 'audio/' 아님
//   empty       — HEAD 200 이지만 content-length 0
//   unreachable — HEAD 4xx/5xx
//   error       — fetch throw / timeout
//
// 인증: admin Bearer token 또는 x-cron-secret 헤더
//
// 호출 옵션 (body):
//   { limit?: number, recheck_after_hours?: number, track_ids?: string[] }
//   기본: limit=50, recheck_after_hours=24

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MODULE_LOAD_AT = new Date().toISOString();
const HEAD_TIMEOUT_MS = 10_000;
const CONCURRENCY = 5;

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

interface CheckResult {
  track_id: string;
  url: string;
  status: 'ok' | 'wrong_mime' | 'empty' | 'unreachable' | 'error';
  content_type: string | null;
  content_length: number | null;
  http_status?: number;
  error?: string;
}

async function headCheck(trackId: string, url: string): Promise<CheckResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), HEAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
    clearTimeout(t);
    const ct = res.headers.get('content-type') ?? null;
    const clRaw = res.headers.get('content-length');
    const cl = clRaw ? Number(clRaw) : null;
    if (!res.ok) {
      return { track_id: trackId, url, status: 'unreachable', content_type: ct, content_length: cl, http_status: res.status, error: `HTTP ${res.status}` };
    }
    if (cl !== null && cl === 0) {
      return { track_id: trackId, url, status: 'empty', content_type: ct, content_length: cl, http_status: res.status };
    }
    if (ct && !ct.toLowerCase().startsWith('audio/')) {
      return { track_id: trackId, url, status: 'wrong_mime', content_type: ct, content_length: cl, http_status: res.status, error: `content-type=${ct}` };
    }
    return { track_id: trackId, url, status: 'ok', content_type: ct, content_length: cl, http_status: res.status };
  } catch (e) {
    clearTimeout(t);
    const msg = e instanceof Error ? e.message : String(e);
    return { track_id: trackId, url, status: 'error', content_type: null, content_length: null, error: msg };
  }
}

async function runWithConcurrency<T, R>(
  items: T[], limit: number, fn: (it: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';

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
  if (!mode) return json({ error: 'unauthorized (admin token or x-cron-secret required)' }, 401);

  let body: { limit?: number; recheck_after_hours?: number; track_ids?: string[] } = {};
  try { body = await req.json(); } catch { /* allow empty body */ }
  const limit = Math.min(Math.max(1, body.limit ?? 50), 200);
  const recheckHours = body.recheck_after_hours ?? 24;

  let targets: Array<{ track_id: string; audio_url: string }>;
  if (body.track_ids && body.track_ids.length > 0) {
    const { data, error } = await sbAdmin
      .from('tracks').select('id, audio_url').in('id', body.track_ids).limit(limit);
    if (error) return json({ ok: false, error: error.message }, 500);
    targets = (data ?? [])
      .filter((r) => r.audio_url && String(r.audio_url).trim().length > 0)
      .map((r) => ({ track_id: r.id as string, audio_url: String(r.audio_url) }));
  } else {
    const { data, error } = await sbAdmin.rpc('pick_tracks_for_health_check', {
      p_limit: limit, p_recheck_after_hours: recheckHours,
    });
    if (error) return json({ ok: false, error: error.message }, 500);
    targets = (data ?? []) as Array<{ track_id: string; audio_url: string }>;
  }

  console.log('[health] starting', { mode, count: targets.length, module_load_at: MODULE_LOAD_AT });
  if (targets.length === 0) return json({ ok: true, mode, processed: 0, message: 'no tracks to check' });

  const results = await runWithConcurrency(targets, CONCURRENCY, (t) => headCheck(t.track_id, t.audio_url));

  // 결과 DB 반영
  let updated = 0;
  for (const r of results) {
    const { error } = await sbAdmin.rpc('update_track_audio_health', {
      p_track_id: r.track_id,
      p_status: r.status,
      p_content_type: r.content_type,
      p_content_length: r.content_length,
      p_error: r.error ?? null,
    });
    if (error) {
      console.error('[health] update failed', { track_id: r.track_id, err: error.message });
    } else {
      updated++;
    }
  }

  const summary = {
    ok: results.filter((r) => r.status === 'ok').length,
    wrong_mime: results.filter((r) => r.status === 'wrong_mime').length,
    empty: results.filter((r) => r.status === 'empty').length,
    unreachable: results.filter((r) => r.status === 'unreachable').length,
    error: results.filter((r) => r.status === 'error').length,
  };

  // 0083 — 문제 발견 시 admin_notifications 적립 (silent 실패, 워커 결과에 영향 X)
  const problems = results.filter((r) => r.status !== 'ok');
  const notificationIds: number[] = [];
  if (problems.length > 0) {
    try {
      // 트랙별 개별 알림 (최대 20건 — 폭주 방지)
      for (const p of problems.slice(0, 20)) {
        const sev = (p.status === 'unreachable' || p.status === 'error') ? 'error' : 'warning';
        const { data: nid } = await sbAdmin.rpc('create_admin_notification', {
          p_kind: 'audio_health_issue',
          p_severity: sev,
          p_title: `오디오 ${p.status} — ${p.url.split('/').pop()?.slice(0, 40) ?? ''}`,
          p_body: p.error ?? `content-type=${p.content_type ?? '?'} / size=${p.content_length ?? '?'}`,
          p_context: { status: p.status, http_status: p.http_status ?? null, content_type: p.content_type, content_length: p.content_length },
          p_track_id: p.track_id,
        });
        if (typeof nid === 'number') notificationIds.push(nid);
      }
      // 5건 이상이면 요약 알림도 함께
      if (problems.length >= 5) {
        const { data: sumId } = await sbAdmin.rpc('create_admin_notification', {
          p_kind: 'worker_summary',
          p_severity: 'warning',
          p_title: `오디오 헬스체크 — 문제 ${problems.length}건`,
          p_body: `처리 ${results.length}건 / 정상 ${summary.ok} / 접근불가 ${summary.unreachable} / MIME 오류 ${summary.wrong_mime} / 빈파일 ${summary.empty} / 검사실패 ${summary.error}`,
          p_context: { summary, processed: results.length },
          p_track_id: null,
        });
        if (typeof sumId === 'number') notificationIds.push(sumId);
      }
    } catch (e) {
      console.error('[health] notification enqueue failed (continuing):', e);
    }

    // 0093 — 외부 채널 dispatch (silent fire-and-forget, 워커 결과 영향 X)
    if (notificationIds.length > 0) {
      try {
        const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        await sbAdmin.functions.invoke('dispatch-admin-notifications', {
          body: { since_ts: since, limit: 50 },
        });
      } catch (e) {
        console.error('[health] external notify dispatch failed (continuing):', e);
      }
    }
  }

  console.log('[health] done', { mode, processed: results.length, updated, summary });
  return json({ ok: true, mode, processed: results.length, updated, summary, results });
});
