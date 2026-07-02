/**
 * Vercel serverless — POST /api/admin/enterprise-ops-run
 *
 * Phase 2-2 QA-1: 관리자 "Run Enterprise Cron" Quick Action 백엔드.
 *
 * 역할: 관리자 요청을 검증한 뒤 CRON_SECRET 을 서버에서 부착해
 *      /api/cron/enterprise-ops 호출을 대리 실행. (CRON_SECRET 브라우저 노출 방지)
 *
 * 요청:
 *   POST /api/admin/enterprise-ops-run
 *   Authorization: Bearer <supabase user access token>
 *
 * 검증:
 *   1) Supabase user token 유효 확인 (anon key + getUser)
 *   2) users.role='admin' 확인
 *   3) 최근 60초 내 재실행 차단 (in-memory debounce)
 *
 * 응답: /api/cron/enterprise-ops 의 결과를 그대로 전달.
 *
 * 절대 무수정:
 *   /api/cron/enterprise-ops 자체 로직 무관 — HTTP 호출만.
 */

export const config = { runtime: 'edge' };

const debounceRef: { last: number } = { last: 0 };
const DEBOUNCE_MS = 60_000;

function j(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
}

async function verifyAdmin(url: string, anonKey: string, serviceKey: string, token: string): Promise<{ ok: boolean; user_id?: string; reason?: string }> {
  // 1) getUser via anon key + user token
  const userRes = await fetch(`${url}/auth/v1/user`, {
    method: 'GET',
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!userRes || !userRes.ok) return { ok: false, reason: 'invalid_token' };
  const userJson = (await userRes.json().catch(() => null)) as { id?: string } | null;
  if (!userJson?.id) return { ok: false, reason: 'no_user' };

  // 2) role='admin' via service_role select (bypass RLS)
  const roleRes = await fetch(`${url}/rest/v1/users?id=eq.${userJson.id}&select=role`, {
    method: 'GET',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  }).catch(() => null);
  if (!roleRes || !roleRes.ok) return { ok: false, reason: 'role_lookup_failed' };
  const rows = (await roleRes.json().catch(() => [])) as Array<{ role?: string }>;
  if (!rows[0] || rows[0].role !== 'admin') return { ok: false, reason: 'not_admin' };

  return { ok: true, user_id: userJson.id };
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') return j(405, { error: 'method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey     = process.env.SUPABASE_ANON_KEY;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const cronSecret  = process.env.CRON_SECRET;
  const appUrl      = process.env.APP_URL
    ?? process.env.VERCEL_URL       // vercel deploy
    ?? 'http://localhost:3000';

  // Runtime env 진단 — Boolean 존재 여부만. 실제 값은 절대 로그/응답에 포함하지 않음.
  const envPresence = {
    SUPABASE_URL:              Boolean(supabaseUrl),
    SUPABASE_ANON_KEY:         Boolean(anonKey),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(serviceKey),
    CRON_SECRET:               Boolean(cronSecret),
  };
  console.log('[enterprise-ops-run] env presence:', envPresence);

  if (!supabaseUrl || !anonKey || !serviceKey || !cronSecret) {
    return j(500, {
      error: 'missing_env',
      hint: JSON.stringify(envPresence),
      env_presence: envPresence,
    });
  }

  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return j(401, { error: 'missing_bearer' });

  const gate = await verifyAdmin(supabaseUrl, anonKey, serviceKey, token);
  if (!gate.ok) return j(403, { error: 'forbidden', reason: gate.reason });

  // Debounce (60s) — 동일 인스턴스 내 spam 방지
  const now = Date.now();
  if (now - debounceRef.last < DEBOUNCE_MS) {
    const wait = Math.ceil((DEBOUNCE_MS - (now - debounceRef.last)) / 1000);
    return j(429, { error: 'debounced', wait_seconds: wait });
  }
  debounceRef.last = now;

  // 대리 실행 — /api/cron/enterprise-ops 로 Bearer CRON_SECRET 부착
  const target = appUrl.startsWith('http') ? appUrl : `https://${appUrl}`;
  const t0 = Date.now();
  const ranAt = new Date().toISOString();

  try {
    const r = await fetch(`${target}/api/cron/enterprise-ops`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    const text = await r.text();
    const parsed = (() => { try { return JSON.parse(text); } catch { return text; } })();
    const durationMs = Date.now() - t0;

    // Audit log — 성공/실패 무관하게 기록
    await fetch(`${supabaseUrl}/rest/v1/rpc/admin_log_operation`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        p_source: 'enterprise_operations',
        p_category: 'quick_action.run_cron',
        p_level: r.ok ? 'success' : 'error',
        p_status: r.ok ? 'success' : 'failed',
        p_message: `admin quick action: run enterprise cron (via /api/admin/enterprise-ops-run)`,
        p_details: { http_status: r.status, ran_at: ranAt, duration_ms: durationMs },
        p_user_id: gate.user_id ?? null,
        p_duration_ms: durationMs,
      }),
    }).catch(() => undefined);

    return j(r.ok ? 200 : 502, {
      ok: r.ok, upstream_status: r.status, ran_at: ranAt, duration_ms: durationMs, upstream: parsed,
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    await fetch(`${supabaseUrl}/rest/v1/rpc/admin_log_operation`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        p_source: 'enterprise_operations',
        p_category: 'quick_action.run_cron',
        p_level: 'error', p_status: 'failed',
        p_message: `admin quick action failed: ${errMsg}`,
        p_details: { ran_at: ranAt },
        p_user_id: gate.user_id ?? null,
        p_error_message: errMsg,
      }),
    }).catch(() => undefined);
    return j(500, { ok: false, error: errMsg });
  }
}
