/**
 * dispatch-kakao-message — Phase X6.2 (STUB — 2차 카카오 알림 준비)
 *
 * 현재 상태: 비활성. 호출하면 501 Not Implemented 반환.
 *
 * 미래 확장 경로 (둘 중 하나 선택):
 *
 * A) "나에게 보내기" (사용자가 카카오 로그인 + talk_message scope 동의 시):
 *    - https://kapi.kakao.com/v2/api/talk/memo/default/send
 *    - 사용자 access_token 필요 (Supabase Auth 의 provider_token 사용)
 *    - 운영자가 답변 등록 시 사용자 본인 카톡으로 알림 가능
 *    - 별도 비즈 계약 불필요
 *
 * B) "알림톡" (AlimTalk, 솔루션사 경유):
 *    - 비즈메시지 + 발신프로파일 + 솔루션사 (NHN/알리고/솔라피/비즈뿌리오) API
 *    - 솔루션사 API Key + 템플릿 코드 별도 발급
 *    - 사용자 동의 없이도 발송 가능 (사전 등록된 템플릿만)
 *    - 본 함수는 솔루션사 환경변수 추가 후 활성화:
 *      ALIMTALK_API_KEY / ALIMTALK_SENDER_KEY / ALIMTALK_TEMPLATE_CODE
 *
 * 환경변수:
 *   KAKAO_REST_API_KEY  — Kakao Developers REST API 키 (경로 A 용)
 *   KAKAO_ADMIN_KEY     — Admin API 용 (사용자 unlink 등, 경로 A 용)
 *
 * 호출 권한:
 *   - service_role 또는 admin 만 호출 가능
 *   - 본 함수가 활성화되기 전까지 admin_update_inquiry 트리거가 호출하지 않도록 코드 추가 필요.
 */
import { serve } from 'https://deno.land/std@0.220.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const restKey = Deno.env.get('KAKAO_REST_API_KEY') ?? '';
  const adminKey = Deno.env.get('KAKAO_ADMIN_KEY') ?? '';

  // 키 등록 자체는 됐는지 확인 (운영 진단용)
  return json({
    ok: false,
    status: 'not_implemented',
    reason: '카카오 자동 발송은 2차 작업 예정 — 받으신 키만으로는 알림톡 불가',
    keys_configured: {
      rest_api_key: restKey.length > 0,
      admin_key: adminKey.length > 0,
    },
    available_paths: {
      A_self_message: 'Kakao 로그인 + talk_message scope 동의 → 사용자 본인에게 알림',
      B_alimtalk: '솔루션사 (NHN/알리고/솔라피) 별도 계약 + 템플릿 등록 필요',
    },
  }, 501);
});
