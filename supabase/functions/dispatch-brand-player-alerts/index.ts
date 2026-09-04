// supabase/functions/dispatch-brand-player-alerts/index.ts
//
// 매장(브랜드) 플레이어 장애 알림 — 앱 푸시 + 운영 알림 채널 디스패치.
//
// 호출: public._notify_brand_player_alert() 가 pg_net 으로 POST (5분 cron).
//   headers: x-cron-secret: <BRAND_ALERT_SECRET 또는 CRON_SECRET>
//   body:    detect_brand_player_incidents() 가 만든 payload
//            { event, severity, brand, status, device, track, text, incident_id, ... }
//
// 하는 일:
//   1. 관리자 전원에게 Web Push (send-push 엣지함수 경유 — VAPID 로직 재사용)
//   2. admin_notifications 미발송분을 Slack/이메일로 흘려보냄
//      (dispatch-admin-notifications 재사용 — 채널 설정은 admin_settings 그대로)
//
// 인증 실패는 401. 개별 채널 실패는 격리 — 하나가 죽어도 나머지는 나간다.
// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ALERT_SECRET = (Deno.env.get('BRAND_ALERT_SECRET') ?? Deno.env.get('CRON_SECRET') ?? '').trim();

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

interface AlertPayload {
  event?: string;
  severity?: string;
  brand?: string;
  status?: string;
  device?: string;
  track?: string | null;
  text?: string;
  incident_id?: string;
  minutes_since_heartbeat?: number;
  minutes_down?: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // fail-closed — 시크릿이 설정돼 있지 않으면 아무도 호출할 수 없다
  if (!ALERT_SECRET) return json({ error: 'server misconfigured: BRAND_ALERT_SECRET missing' }, 500);
  const given = (req.headers.get('x-cron-secret') ?? '').trim();
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (given !== ALERT_SECRET && bearer !== SERVICE_ROLE) return json({ error: 'unauthorized' }, 401);

  let payload: AlertPayload = {};
  try { payload = await req.json(); } catch { payload = {}; }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const isRecovery = payload.event === 'brand_player_recovered';
  const title = isRecovery
    ? `✅ ${payload.brand ?? '매장'} 재생 복구`
    : `🚨 [긴급] ${payload.brand ?? '매장'} 음악 멈춤`;
  const body = payload.text
    ?? (isRecovery ? '매장 음악이 다시 나옵니다.' : '매장 플레이어를 확인해주세요.');

  const result: Record<string, unknown> = { event: payload.event ?? 'unknown' };

  // ── 1. 관리자 전원에게 Web Push ──────────────────────────────────────────
  try {
    const { data: admins } = await sb.from('users').select('id').eq('role', 'admin');
    const ids = (admins ?? []).map((a: any) => a.id as string);
    // push_subscriptions 가 있는 관리자만 (없으면 send-push 가 어차피 no-op)
    const { data: subs } = await sb
      .from('push_subscriptions').select('user_id').in('user_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
    const targets = Array.from(new Set((subs ?? []).map((s: any) => s.user_id as string)));

    let sent = 0; const failures: string[] = [];
    for (const uid of targets) {
      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${SERVICE_ROLE}` },
          body: JSON.stringify({
            user_id: uid,
            title,
            body,
            url: '/ops',
            tag: `brand-player-${payload.incident_id ?? payload.brand ?? 'alert'}`,
          }),
        });
        if (r.ok) sent += 1; else failures.push(`${uid}:${r.status}`);
      } catch (e) { failures.push(`${uid}:${String(e)}`); }
    }
    result.push = { admins: ids.length, subscribed: targets.length, sent, failures };
  } catch (e) {
    result.push = { error: String(e) };
  }

  // ── 2. Slack / 이메일 — 미발송 admin_notifications 흘려보내기 ────────────
  try {
    const { data: pending } = await sb
      .from('admin_notifications')
      .select('id')
      .in('kind', ['brand_player_down', 'brand_player_recovered'])
      .is('dispatched_at', null)
      .order('created_at', { ascending: false })
      .limit(10);

    let dispatched = 0;
    for (const n of pending ?? []) {
      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/dispatch-admin-notifications`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${SERVICE_ROLE}` },
          body: JSON.stringify({ notification_id: (n as any).id }),
        });
        if (r.ok) dispatched += 1;
      } catch { /* 채널 실패는 격리 */ }
    }
    result.admin_notifications = { pending: (pending ?? []).length, dispatched };
  } catch (e) {
    result.admin_notifications = { error: String(e) };
  }

  return json({ ok: true, ...result });
});
