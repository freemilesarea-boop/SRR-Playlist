/**
 * Vercel Cron: 매일 오전 10시 KST (UTC 01:00) 에 호출되어
 * 어제 + 오늘 daily_metrics 를 집계 후 upsert 합니다.
 *
 * 환경 변수:
 *   - SUPABASE_URL          (Vercel env)
 *   - SUPABASE_SERVICE_ROLE_KEY   (Vercel env, secret!)
 *   - CRON_SECRET                  (필수, fail-closed 호출 보호)
 *
 * vercel.json 에 schedule "0 1 * * *" 로 등록됨.
 */

import { verifyCronAuth, cronAuthErrorResponse } from '../_lib/cronAuth';

export const config = { runtime: 'edge' };

type VercelRequest = Request;

export default async function handler(req: VercelRequest) {
  // PLATFORM-HOTFIX-1: fail-closed. CRON_SECRET 미설정이면 503, 헤더 없으면 401, 불일치면 403.
  // (이전엔 secret 미설정 시 인증을 건너뛰어 service_role RPC 가 무인증 실행될 수 있었음.)
  const cronAuth = verifyCronAuth(req);
  if (!cronAuth.ok) return cronAuthErrorResponse(cronAuth);
  const secret = process.env.CRON_SECRET ?? '';

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return new Response(
      JSON.stringify({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 미설정' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }

  const todayKst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const yesterdayKst = new Date(Date.now() + 9 * 3600 * 1000 - 86400 * 1000)
    .toISOString()
    .slice(0, 10);

  const results: Record<string, unknown> = {};

  // 만료된 무료 체험 일괄 종료 (재생 권한 회수 + 원장 상태 갱신). 멱등.
  try {
    const expireRes = await fetch(`${url}/rest/v1/rpc/expire_free_trials`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    const expireTxt = await expireRes.text();
    results['expired_free_trials'] = expireRes.ok ? JSON.parse(expireTxt) : { error: expireTxt, status: expireRes.status };
  } catch (e) {
    results['expired_free_trials'] = { error: e instanceof Error ? e.message : 'unknown' };
  }

  // 무료 체험 D-day 알림 메일 (D-3 / D-1 / 만료-당일) — Resend 발송, 멱등.
  // 만료 sweep 직후에 호출해야 expired 케이스가 정확히 잡힘.
  try {
    const reminderRes = await fetch(`${url}/functions/v1/dispatch-trial-reminders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        'x-cron-secret': secret ?? '',
      },
      body: '{}',
    });
    const reminderTxt = await reminderRes.text();
    results['trial_reminders'] = reminderRes.ok
      ? JSON.parse(reminderTxt)
      : { error: reminderTxt, status: reminderRes.status };
  } catch (e) {
    results['trial_reminders'] = { error: e instanceof Error ? e.message : 'unknown' };
  }

  for (const date of [yesterdayKst, todayKst]) {
    const res = await fetch(`${url}/rest/v1/rpc/admin_compute_daily_metrics`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ target_date: date }),
    });
    const txt = await res.text();
    results[date] = res.ok ? JSON.parse(txt) : { error: txt, status: res.status };
  }

  return new Response(
    JSON.stringify({ ok: true, ran_at: new Date().toISOString(), results }, null, 2),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}
