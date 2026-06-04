/**
 * supportContactApi.ts — Phase X6.2.8
 *
 * 외부 채널 진입 이벤트 (카톡 채팅 열기 / 친구추가 / mailto / tel) 로깅.
 * 자동 발송 아님 — 사용자가 우리 측 채널로 이동했다는 클릭 로그.
 */
import { supabase } from '@/lib/supabase';

export type ContactChannel = 'kakao' | 'tel' | 'email';
export type ContactAction = 'open_chat' | 'add_friend' | 'open_channel' | 'dial' | 'mailto';

function detectDeviceType(): string | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent.toLowerCase();
  if (/mobile|android|iphone|ipad/.test(ua)) return /ipad/.test(ua) ? 'tablet' : 'mobile';
  return 'desktop';
}

export async function logSupportContactEvent(input: {
  channel: ContactChannel;
  action: ContactAction;
  context?: Record<string, unknown>;
}): Promise<void> {
  try {
    await supabase.rpc('log_support_contact_event', {
      p_channel: input.channel,
      p_action: input.action,
      p_page_url: typeof window !== 'undefined' ? window.location.href : null,
      p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      p_device_type: detectDeviceType(),
      p_context: input.context ?? {},
    });
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[contact-event] log failed', e);
    // silent — 클릭 흐름 차단 금지
  }
}

// ===== Admin =====
export interface AdminContactEventRow {
  id: number;
  user_id: string | null;
  user_email: string | null;
  channel: ContactChannel;
  action: ContactAction;
  page_url: string | null;
  device_type: string | null;
  context: Record<string, unknown>;
  created_at: string;
}

export async function adminListSupportContactEvents(
  days = 7, channel?: ContactChannel, action?: ContactAction, limit = 200,
): Promise<AdminContactEventRow[]> {
  const { data, error } = await supabase.rpc('admin_list_support_contact_events', {
    p_days: days,
    p_channel: channel ?? null,
    p_action: action ?? null,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as AdminContactEventRow[];
}
