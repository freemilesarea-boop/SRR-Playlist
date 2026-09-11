// supabase/functions/send-push/index.ts
//
// 푸시 알림 발송 — Web Push + 네이티브 앱(FCM/APNs) 동시.
//
// 한 사용자가 웹(PWA)과 앱을 함께 쓸 수 있으므로 양쪽 모두에 보낸다.
// 자격증명이 없는 경로는 'skipped' 로 표시하고 나머지는 정상 발송한다
// (예: VAPID 만 설정된 현재 상태에서도 웹 발송은 그대로 동작).
//
// 요청:
//   POST /send-push
//   Authorization: Bearer <service_role JWT> 또는 admin 사용자 JWT
//   body: {
//     user_id: string,        // 알림 받을 사용자
//     title: string,
//     body?: string,
//     url?: string,           // 클릭 시 이동 URL (예: /business)
//     tag?: string,           // 중복 알림 그룹화
//     icon?: string,          // 알림 아이콘 URL
//   }
//
// 환경변수:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...)   — Web Push
//   FCM_SERVICE_ACCOUNT_JSON                                          — Android
//   APNS_KEY_P8, APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_ENV  — iOS
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

// deno-lint-ignore-file no-explicit-any

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import webpush from 'npm:web-push@3.6.7';
import {
  nativePushReadiness,
  readNativePushEnv,
  sendNativePush,
  type NativeToken,
} from '../_shared/nativePush.ts';

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

interface Sub {
  endpoint: string;
  p256dh: string;
  auth: string;
}

function readEnv() {
  return {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL') ?? '',
    SERVICE_ROLE: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    VAPID_PUBLIC: Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
    VAPID_PRIVATE: Deno.env.get('VAPID_PRIVATE_KEY') ?? '',
    VAPID_SUBJECT: Deno.env.get('VAPID_SUBJECT') || 'mailto:freemilesarea@gmail.com',
  };
}

/**
 * user JWT 검증 → user_id 반환. 실패 시 null.
 *
 * 앱/웹 클라이언트는 service_role 키를 가질 수 없다(가지면 안 된다). 대신 자기
 * JWT 로 호출하고, 아래에서 "본인에게만" 으로 제한한다.
 * PushNotificationToggle 의 테스트 알림과 useBusinessAutoSwitch 의 시간대 전환
 * 알림이 이 경로를 쓴다.
 */
async function verifyUserJwt(env: ReturnType<typeof readEnv>, token: string): Promise<string | null> {
  try {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: env.SERVICE_ROLE, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data?.id as string | undefined) ?? null;
  } catch {
    return null;
  }
}

async function rpc<T>(env: ReturnType<typeof readEnv>, fn: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: env.SERVICE_ROLE,
      Authorization: `Bearer ${env.SERVICE_ROLE}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`RPC ${fn} ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const env = readEnv();
  const nativeEnv = readNativePushEnv((k) => Deno.env.get(k) ?? undefined);
  const ready = {
    web: !!env.VAPID_PUBLIC && !!env.VAPID_PRIVATE,
    ...nativePushReadiness(nativeEnv),
  };
  // 하나도 설정돼 있지 않을 때만 실패. 일부만 설정된 상태는 정상 운영 경로다.
  if (!ready.web && !ready.android && !ready.ios) {
    return json({ error: 'push_not_configured', detail: 'VAPID / FCM / APNS 자격증명이 모두 미설정', ready }, 500);
  }
  if (!env.SUPABASE_URL || !env.SERVICE_ROLE) {
    return json({ error: 'SUPABASE env 미설정' }, 500);
  }

  // 인증 (배포본과 동일한 이중 경로):
  //   service_role  → 임의 user_id 로 발송 (cron · 서버 내부)
  //   user JWT      → 본인에게만
  // 여기를 service_role 전용으로 좁히면 앱의 "테스트 알림" 버튼이 401 로 죽는다.
  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);
  const token = authHeader.slice(7);

  let isServiceRole = false;
  let userIdFromJwt: string | null = null;
  if (token === env.SERVICE_ROLE) {
    isServiceRole = true;
  } else {
    userIdFromJwt = await verifyUserJwt(env, token);
  }
  if (!isServiceRole && !userIdFromJwt) return json({ error: 'unauthorized' }, 401);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const userId = payload.user_id as string | undefined;
  const title = (payload.title as string | undefined) ?? 'DEUDDA';
  if (!userId) return json({ error: 'user_id required' }, 400);

  // user JWT 로 왔으면 본인에게만.
  if (!isServiceRole && userId !== userIdFromJwt) {
    return json({ error: 'cannot send push to other users' }, 403);
  }

  const notification = {
    title,
    body: payload.body as string | undefined,
    url: (payload.url as string | undefined) ?? '/',
    tag: payload.tag as string | undefined,
    icon: payload.icon as string | undefined,
  };

  // 사용자의 구독 목록 조회 — 웹(브라우저)과 네이티브(앱)를 각각.
  let subs: Sub[] = [];
  let devices: NativeToken[] = [];
  try {
    [subs, devices] = await Promise.all([
      ready.web
        ? rpc<Sub[]>(env, 'list_push_subscriptions_for', { p_user_id: userId })
        : Promise.resolve([] as Sub[]),
      rpc<NativeToken[]>(env, 'list_device_push_tokens_for', { p_user_id: userId }),
    ]);
  } catch (e) {
    return json({ error: 'list_failed', detail: String(e) }, 500);
  }

  const candidates = subs.length + devices.length;
  if (candidates === 0) {
    return json({ ok: true, sent: 0, candidates: 0, ready });
  }

  if (ready.web) {
    webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC, env.VAPID_PRIVATE);
  }

  const results: Array<{ endpoint: string; status: 'sent' | 'gone' | 'failed'; error?: string }> = [];
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh, auth: s.auth },
        },
        JSON.stringify(notification),
      );
      results.push({ endpoint: s.endpoint, status: 'sent' });
    } catch (e: any) {
      const code = e?.statusCode;
      if (code === 410 || code === 404) {
        // Gone — 구독 만료. 삭제.
        try {
          await rpc(env, 'delete_push_subscription_by_endpoint', { p_endpoint: s.endpoint });
        } catch {
          /* noop */
        }
        results.push({ endpoint: s.endpoint, status: 'gone' });
      } else {
        results.push({ endpoint: s.endpoint, status: 'failed', error: String(e?.message ?? e) });
      }
    }
  }

  // 네이티브 앱 발송 — 만료 토큰(gone)은 즉시 정리해 다음 발송에서 빠진다.
  const nativeResults = devices.length > 0
    ? await sendNativePush(nativeEnv, devices, notification)
    : [];
  for (const r of nativeResults) {
    if (r.status !== 'gone') continue;
    try {
      await rpc(env, 'delete_device_push_token_by_value', { p_token: r.token });
    } catch {
      /* noop */
    }
  }

  const count = (status: string) =>
    results.filter((r) => r.status === status).length + nativeResults.filter((r) => r.status === status).length;

  return json({
    ok: true,
    user_id: userId,
    ready,
    candidates,
    web_candidates: subs.length,
    native_candidates: devices.length,
    sent: count('sent'),
    gone: count('gone'),
    failed: count('failed'),
    skipped: nativeResults.filter((r) => r.status === 'skipped').length,
    results,
    native_results: nativeResults,
  });
});
