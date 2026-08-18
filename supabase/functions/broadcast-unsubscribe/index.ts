// supabase/functions/broadcast-unsubscribe/index.ts
//
// 광고성 메일 하단 "무료 수신거부" 링크의 공개 엔드포인트.
//   GET/POST /broadcast-unsubscribe?token=<uuid>
//   → record_broadcast_unsubscribe(token) 호출(service_role) → email_unsubscribes 기록
//   → 브라우저용 확인 HTML 반환.
//
// 인증 없음(verify_jwt=false). 토큰은 job 별 랜덤 uuid 라 추측 불가.

// deno-lint-ignore-file no-explicit-any

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function page(title: string, message: string, ok: boolean): Response {
  const color = ok ? '#15803d' : '#b91c1c';
  const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Apple SD Gothic Neo','Noto Sans KR',sans-serif;color:#18181b;">
  <div style="max-width:440px;margin:64px auto;background:#fff;border-radius:16px;padding:32px 28px;box-shadow:0 1px 3px rgba(0,0,0,.06);text-align:center;">
    <p style="font-size:15px;font-weight:800;margin:0 0 16px 0;">듣다 DEUDDA</p>
    <p style="font-size:16px;font-weight:700;color:${color};margin:0 0 10px 0;">${title}</p>
    <p style="font-size:13.5px;line-height:1.7;color:#52525b;margin:0;">${message}</p>
  </div>
</body></html>`;
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

serve(async (req) => {
  const url = new URL(req.url);
  let token = url.searchParams.get('token') ?? '';
  if (!token && req.method === 'POST') {
    try { const b = await req.json(); token = b?.token ?? ''; } catch { /* ignore */ }
  }
  if (!token) return page('처리할 수 없습니다', '수신거부 링크가 올바르지 않습니다. 메일의 링크를 다시 눌러주세요.', false);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const { data, error } = await sb.rpc('record_broadcast_unsubscribe', { p_token: token });
  if (error) {
    return page('처리 중 오류가 발생했습니다', '잠시 후 다시 시도해주세요. 계속 문제가 있으면 freemilesarea@gmail.com 으로 문의해주세요.', false);
  }
  const res = data as any;
  if (!res?.ok) {
    return page('처리할 수 없습니다', '수신거부 링크가 만료되었거나 올바르지 않습니다.', false);
  }
  return page('수신거부가 완료되었습니다', `${res.email ? `<strong>${res.email}</strong> 주소로는 ` : ''}앞으로 광고성 메일을 보내지 않습니다. (운영/안내 메일은 계속 발송될 수 있습니다.)`, true);
});
