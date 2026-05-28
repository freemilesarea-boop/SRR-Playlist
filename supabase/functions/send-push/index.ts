// supabase/functions/send-push/index.ts
//
// Web Push 알림 발송. 다른 edge function 또는 운영자가 호출.
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
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

// deno-lint-ignore-file no-explicit-any

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import webpush from 'npm:web-push@3.6.7';

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
  if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE) {
    return json({ error: 'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY 미설정' }, 500);
  }
  if (!env.SUPABASE_URL || !env.SERVICE_ROLE) {
    return json({ error: 'SUPABASE env 미설정' }, 500);
  }

  // 인증: service_role JWT 만 허용 (운영 내부 호출만)
  const authHeader = req.headers.get('authorization') ?? '';
  if (authHeader !== `Bearer ${env.SERVICE_ROLE}`) {
    return json({ error: 'unauthorized' }, 401);
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const userId = payload.user_id as string | undefined;
  const title = (payload.title as string | undefined) ?? 'DEUDDA';
  if (!userId) return json({ error: 'user_id required' }, 400);

  const notification = {
    title,
    body: payload.body as string | undefined,
    url: (payload.url as string | undefined) ?? '/',
    tag: payload.tag as string | undefined,
    icon: payload.icon as string | undefined,
  };

  // 사용자의 구독 목록 조회
  let subs: Sub[];
  try {
    subs = await rpc<Sub[]>(env, 'list_push_subscriptions_for', { p_user_id: userId });
  } catch (e) {
    return json({ error: 'list_failed', detail: String(e) }, 500);
  }

  if (subs.length === 0) {
    return json({ ok: true, sent: 0, candidates: 0 });
  }

  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC, env.VAPID_PRIVATE);

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

  return json({
    ok: true,
    user_id: userId,
    candidates: subs.length,
    sent: results.filter((r) => r.status === 'sent').length,
    gone: results.filter((r) => r.status === 'gone').length,
    failed: results.filter((r) => r.status === 'failed').length,
    results,
  });
});
