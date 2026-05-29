import { supabase } from './supabase';

/**
 * Web Push 알림 발송 — send-push edge function 호출.
 *
 * 인증:
 *   - 본인에게 보낼 때: 그냥 호출 (supabase client 가 user JWT 자동 첨부)
 *   - 다른 user 에게 보낼 때: service_role 필요 (edge function 또는 cron 에서만)
 *
 * 미설정 환경 (VAPID 미등록) 또는 사용자 미구독 시 silent skip.
 */
export interface PushPayload {
  user_id: string;
  title: string;
  body?: string;
  url?: string;
  tag?: string;
  icon?: string;
}

export interface PushResult {
  ok: boolean;
  sent: number;
  candidates: number;
  error?: string;
}

export async function sendPush(payload: PushPayload): Promise<PushResult> {
  try {
    const { data, error } = await supabase.functions.invoke<PushResult>('send-push', {
      body: payload,
    });
    if (error) {
      return { ok: false, sent: 0, candidates: 0, error: error.message };
    }
    return data ?? { ok: false, sent: 0, candidates: 0, error: 'no_response' };
  } catch (e) {
    return { ok: false, sent: 0, candidates: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
