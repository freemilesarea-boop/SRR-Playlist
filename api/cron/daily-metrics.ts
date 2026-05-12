/**
 * Vercel Cron: 매일 오전 10시 KST (UTC 01:00) 에 호출되어
 * 어제 + 오늘 daily_metrics 를 집계 후 upsert 합니다.
 *
 * 환경 변수:
 *   - SUPABASE_URL          (Vercel env)
 *   - SUPABASE_SERVICE_ROLE_KEY   (Vercel env, secret!)
 *   - CRON_SECRET                  (선택, 호출 보호)
 *
 * vercel.json 에 schedule "0 1 * * *" 로 등록됨.
 */

export const config = { runtime: 'edge' };

interface VercelRequest extends Request {}

export default async function handler(req: VercelRequest) {
  // CRON_SECRET 보호 (Vercel cron 은 Authorization: Bearer <CRON_SECRET> 헤더를 자동 추가)
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${secret}`) {
      return new Response('unauthorized', { status: 401 });
    }
  }

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
