/**
 * streamMonitorApi — 실시간 스트리밍 모니터 (앱/웹 공용 백엔드).
 *
 * 앱/웹이 같은 Supabase 를 공유하므로, 어느 클라이언트에서 스트리밍하든 stream_events
 * 에 INSERT 된다. 그 INSERT 를 Supabase Realtime 으로 구독해 관리자 대시보드가 라이브로
 * 노출한다. 인가는 stream_events 의 admin SELECT RLS(stream_events_admin_select)로 처리.
 *
 * DB: supabase/migrations/0477_realtime_streaming_publication.sql
 */
import { supabase } from '@/lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface StreamEventLite {
  id: string;
  track_id: string | null;
  user_id: string | null;
  event_type: string | null;
  source_page: string | null;
  is_effective: boolean | null;
  created_at: string | null;
}

export interface StreamMonitorHandle {
  channel: RealtimeChannel;
  unsubscribe: () => void;
}

/**
 * stream_events INSERT 실시간 구독. onInsert 로 신규 스트림 이벤트 전달.
 * onStatus 로 연결 상태(SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT) 통지.
 */
export function subscribeStreamEvents(
  onInsert: (row: StreamEventLite) => void,
  onStatus?: (status: string) => void,
): StreamMonitorHandle {
  const channel = supabase
    .channel('admin-live-streams')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'stream_events' },
      (payload) => {
        onInsert(payload.new as StreamEventLite);
      },
    )
    .subscribe((status) => {
      onStatus?.(status);
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('[streamMonitorApi] realtime subscription status', status);
      }
    });

  return {
    channel,
    unsubscribe: () => {
      try {
        void supabase.removeChannel(channel);
      } catch (e) {
        console.warn('[streamMonitorApi] removeChannel failed', e);
      }
    },
  };
}
