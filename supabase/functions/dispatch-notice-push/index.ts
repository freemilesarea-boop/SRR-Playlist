// supabase/functions/dispatch-notice-push/index.ts
//
// 공지사항 푸시 알림 일괄 발송 (0567).
//
// 호출: admin_send_notice_push() 가 바로 깨우고, 놓치면 pg_cron(5분)이 cron_dispatch_notice_push() 로 다시 깨운다.
//   headers: x-cron-secret: <Vault brand_alert_secret>  (또는 service role Bearer)
//
// 한 번 깨어나면 대기 중인 공지를 하나씩 잡아(cron_claim_notice_push) 모든 수신 기기에 보낸다:
//   • 웹(PWA) 구독  — VAPID 가 설정돼 있을 때만 (없으면 skipped)
//   • 앱 토큰       — Android(FCM) / iOS(APNs), 자격증명이 없는 플랫폼은 skipped
// 만료된 구독·토큰(gone)은 바로 지워 다음 발송에서 빠진다. 결과는 cron_finish_notice_push 로 남긴다.
//
// 알림: 제목 "듣다 공지" (분류가 점검·업데이트·이벤트면 그 이름), 본문 = 공지 제목,
//       누르면 /notice/<번호> (앱·PWA 모두 내부 경로로 이동).

// deno-lint-ignore-file no-explicit-any

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import {
  nativePushReadiness,
  readNativePushEnv,
  sendNativePush,
  type NativeToken,
} from '../_shared/nativePush.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = (Deno.env.get('BRAND_ALERT_SECRET') ?? Deno.env.get('CRON_SECRET') ?? '').trim();
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:noreply@deudda.com';

/** 한 번에 동시에 보내는 수 — 외부 푸시 서버에 몰아치지 않게. */
const CONCURRENCY = 20;
/** 한 번 깨어나서 처리할 최대 공지 수 (함수 실행 시간 보호). */
const MAX_NOTICES_PER_RUN = 3;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });
}

interface WebSub { endpoint: string; p256dh: string; auth: string }
interface Claimed { id: string; no: number; title: string; category: string }

function notificationFor(n: Claimed) {
  const head = n.category && n.category !== '공지' ? `듣다 ${n.category}` : '듣다 공지';
  return {
    title: head,
    body: n.title,
    url: `/notice/${n.no}`,
    tag: `notice-${n.no}`,
  };
}

async function inBatches<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const given = (req.headers.get('x-cron-secret') ?? '').trim();
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  let ok = bearer === SERVICE_ROLE || (CRON_SECRET !== '' && given === CRON_SECRET);
  if (!ok && given) {
    const { data: match } = await sb.rpc('cron_secret_matches', { p_secret: given });
    ok = match === true;
  }
  if (!ok) return json({ error: 'unauthorized' }, 401);

  const nativeEnv = readNativePushEnv((k) => Deno.env.get(k) ?? undefined);
  const ready = { web: !!VAPID_PUBLIC && !!VAPID_PRIVATE, ...nativePushReadiness(nativeEnv) };
  if (ready.web) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

  const runs: unknown[] = [];
  for (let k = 0; k < MAX_NOTICES_PER_RUN; k++) {
    const { data: claimed, error: claimErr } = await sb.rpc('cron_claim_notice_push');
    if (claimErr) return json({ error: claimErr.message, runs }, 500);
    if (!claimed) break;
    const notice = claimed as Claimed;
    const n = notificationFor(notice);

    try {
      const { data: targets, error: tErr } = await sb.rpc('cron_list_notice_push_targets');
      if (tErr) throw new Error(tErr.message);
      const web = ((targets as any)?.web ?? []) as WebSub[];
      const native = ((targets as any)?.native ?? []) as NativeToken[];

      // 웹 구독
      const webResults = ready.web
        ? await inBatches(web, CONCURRENCY, async (s) => {
          try {
            await webpush.sendNotification(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              JSON.stringify(n),
            );
            return 'sent' as const;
          } catch (e: any) {
            if (e?.statusCode === 404 || e?.statusCode === 410) {
              await sb.rpc('delete_push_subscription_by_endpoint', { p_endpoint: s.endpoint });
              return 'gone' as const;
            }
            return 'failed' as const;
          }
        })
        : web.map(() => 'skipped' as const);

      // 앱 토큰
      const nativeResults = (await inBatches(native, CONCURRENCY, (t) => sendNativePush(nativeEnv, [t], n))).flat();
      for (const r of nativeResults) {
        if (r.status === 'gone') await sb.rpc('delete_device_push_token_by_value', { p_token: r.token });
      }

      const tally = (arr: string[]) => ({
        sent: arr.filter((s) => s === 'sent').length,
        gone: arr.filter((s) => s === 'gone').length,
        failed: arr.filter((s) => s === 'failed').length,
        skipped: arr.filter((s) => s === 'skipped').length,
      });
      const result = {
        ready,
        web: { total: web.length, ...tally(webResults) },
        ios: { total: native.filter((t) => t.platform === 'ios').length, ...tally(nativeResults.filter((r) => r.platform === 'ios').map((r) => r.status)) },
        android: { total: native.filter((t) => t.platform === 'android').length, ...tally(nativeResults.filter((r) => r.platform === 'android').map((r) => r.status)) },
        sample_errors: nativeResults.filter((r) => r.status === 'failed').slice(0, 3).map((r) => r.error),
      };
      const anySent = result.web.sent + result.ios.sent + result.android.sent > 0;
      const allFailed = (web.length + native.length) > 0 && !anySent
        && result.web.failed + result.ios.failed + result.android.failed > 0;
      // 받을 기기가 없거나 미설정으로 건너뛴 것만 있으면 '보냄(0건)'으로 기록 — 재시도해도 결과가 같다.
      await sb.rpc('cron_finish_notice_push', { p_id: notice.id, p_ok: !allFailed, p_result: result });
      runs.push({ no: notice.no, ...result });
    } catch (e) {
      await sb.rpc('cron_finish_notice_push', { p_id: notice.id, p_ok: false, p_result: { error: String((e as Error)?.message ?? e) } });
      runs.push({ no: notice.no, error: String(e) });
    }
  }

  console.warn('[dispatch-notice-push] done', JSON.stringify(runs));
  return json({ ok: true, ready, runs });
});
