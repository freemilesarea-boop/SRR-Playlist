// supabase/functions/cleanup-hq-uploads/index.ts
//
// 본사 검수 전 업로드(hq/<본사 id>/) 중 아무도 쓰지 않는 파일을 매일 지운다 (0545).
// 취소·반려·전송 실패로 남은 파일이 공개 버킷에 쌓이지 않게. 본사 화면도 열 때 정리하지만(0544),
// 본사가 다시 들어오지 않으면 남으므로 서버가 매일 한 번 마무리한다.
//
// 호출: pg_cron → cron_cleanup_hq_uploads() → POST /cleanup-hq-uploads
//   headers: x-cron-secret: <BRAND_ALERT_SECRET 또는 CRON_SECRET>  (또는 service role Bearer)
//   body: { limit?: number }  — 한 번에 지울 최대 개수(기본 200, 최대 500)
//
// 무엇을 지울지는 DB 가 정한다(cron_list_hq_orphan_uploads — 검수 대기 요청·매장 자산이 쓰는 파일 제외,
// 6시간 지난 것만). SQL 로 storage.objects 행만 지우면 실제 파일이 남으므로 삭제는 Storage API 로 한다.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = (Deno.env.get('BRAND_ALERT_SECRET') ?? Deno.env.get('CRON_SECRET') ?? '').trim();

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const given = (req.headers.get('x-cron-secret') ?? '').trim();
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  // 비밀값은 cron 이 실제로 보내는 Vault 'brand_alert_secret' 과 대조한다 — 함수 환경변수와
  // Vault 값이 어긋나 있어도(0513 참고) 동작하게. 환경변수 일치·service role 도 허용.
  let ok = bearer === SERVICE_ROLE || (CRON_SECRET !== '' && given === CRON_SECRET);
  if (!ok && given) {
    const { data: match } = await sb.rpc('cron_secret_matches', { p_secret: given });
    ok = match === true;
  }
  if (!ok) return json({ error: 'unauthorized' }, 401);

  let limit = 200;
  try {
    const body = await req.json();
    if (typeof body?.limit === 'number') limit = Math.max(1, Math.min(500, Math.floor(body.limit)));
  } catch { /* 빈 본문 허용 */ }

  const { data, error } = await sb.rpc('cron_list_hq_orphan_uploads', { p_limit: limit });
  if (error) {
    console.error('[cleanup-hq-uploads] list failed', error.message);
    return json({ error: error.message }, 500);
  }

  const rows = (data ?? []) as { bucket: string; path: string }[];
  const byBucket = new Map<string, string[]>();
  for (const r of rows) {
    // 이중 안전장치 — 본사 검수 전 폴더 밖은 절대 지우지 않는다.
    if (!r.path?.startsWith('hq/')) continue;
    byBucket.set(r.bucket, [...(byBucket.get(r.bucket) ?? []), r.path]);
  }

  let removed = 0;
  const errors: string[] = [];
  for (const [bucket, paths] of byBucket) {
    const { data: gone, error: e } = await sb.storage.from(bucket).remove(paths);
    if (e) errors.push(`${bucket}: ${e.message}`);
    else removed += gone?.length ?? 0;
  }

  console.warn('[cleanup-hq-uploads] done', { listed: rows.length, removed, errors });
  return json({ listed: rows.length, removed, errors });
});
