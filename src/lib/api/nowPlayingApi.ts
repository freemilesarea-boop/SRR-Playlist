/**
 * nowPlayingApi — Enterprise Phase 1-4 Real-time Now Playing.
 *
 * 전국 매장 현재 재생곡 실시간 모니터링.
 *
 * 설계:
 *   - 새 테이블/heartbeat 없음 (Phase 1-3 store_policy_sync_status + store_heartbeat 재사용)
 *   - view store_now_playing JOIN (track/artist/region/account)
 *   - Supabase Realtime: store_policy_sync_status UPDATE/INSERT 구독
 *   - Realtime 실패 시 15s fallback polling
 *
 * SQL: supabase/migrations/0356_store_now_playing.sql
 */
import { supabase } from '@/lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export type NowPlayingPlayerStatus = 'playing' | 'paused' | 'stopped' | 'offline' | 'unknown';
export type NowPlayingStatusFilter = 'online' | 'playing' | 'offline';

export interface NowPlaying {
  store_id: string;
  store_name: string;
  store_email: string | null;
  franchise_id: string | null;
  franchise_name: string | null;
  enterprise_region_id: string | null;
  region_name: string | null;
  region_code: string | null;
  enterprise_account_id: string | null;
  enterprise_name: string | null;
  track_id: string | null;
  track_title: string | null;
  artist_name: string | null;
  album_art_url: string | null;
  duration: number | null;            // seconds
  started_at: string | null;           // ISO
  elapsed_seconds: number | null;      // 동적 계산
  remaining_seconds: number | null;
  player_status: NowPlayingPlayerStatus;
  last_seen_at: string | null;
  volume: number | null;
  app_version: string | null;
  playback_error: string | null;
  is_online: boolean;
  last_heartbeat_at: string | null;
}

export interface NowPlayingList {
  success: boolean;
  data: NowPlaying[];
  pagination: { total: number; limit: number; offset: number; has_more: boolean };
  computed_at: string;
}

export interface NowPlayingKpi {
  total: number;
  playing: number;
  paused: number;
  stopped: number;
  offline: number;
  recent_track_changes_5m: number;
  computed_at: string;
}

export interface NowPlayingFilter {
  search?: string | null;
  franchiseId?: string | null;
  enterpriseRegionId?: string | null;
  status?: NowPlayingStatusFilter | null;
  sort?: 'started_at_desc' | 'name';
  limit?: number;
  offset?: number;
}

// =============================================================================
// RPC wrappers
// =============================================================================

export async function listNowPlaying(filter: NowPlayingFilter = {}): Promise<NowPlayingList> {
  const { data, error } = await supabase.rpc('admin_now_playing_list', {
    p_search: filter.search ?? null,
    p_franchise_id: filter.franchiseId ?? null,
    p_enterprise_region_id: filter.enterpriseRegionId ?? null,
    p_status: filter.status ?? null,
    p_sort: filter.sort ?? 'started_at_desc',
    p_limit: filter.limit ?? 100,
    p_offset: filter.offset ?? 0,
  });
  if (error) { console.error('[nowPlayingApi] list failed', error); throw error; }
  return data as NowPlayingList;
}

export async function nowPlayingKpi(): Promise<NowPlayingKpi> {
  const { data, error } = await supabase.rpc('admin_now_playing_kpi');
  if (error) { console.error('[nowPlayingApi] kpi failed', error); throw error; }
  return data as NowPlayingKpi;
}

// =============================================================================
// Supabase Realtime subscription
// =============================================================================

export interface NowPlayingSubscriptionHandle {
  channel: RealtimeChannel;
  unsubscribe: () => void;
}

/**
 * store_policy_sync_status INSERT/UPDATE 를 구독해 콜백 호출.
 * 변경 빈도가 잦으므로 콜백 내부에서 debounce 권장.
 *
 * @param onChange 변경 발생 시 호출 (refetch 트리거용). 인자는 변경된 store_id.
 * @returns unsubscribe 함수
 */
export function subscribeNowPlaying(
  onChange: (storeId: string | null) => void,
): NowPlayingSubscriptionHandle {
  const channel = supabase
    .channel('store-now-playing-rt')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'store_policy_sync_status' },
      (payload) => {
        const row = (payload.new ?? payload.old) as { store_id?: string } | null;
        onChange(row?.store_id ?? null);
      },
    )
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('[nowPlayingApi] realtime subscription failed', status);
      }
    });

  return {
    channel,
    unsubscribe: () => {
      try { void supabase.removeChannel(channel); }
      catch (e) { console.warn('[nowPlayingApi] removeChannel failed', e); }
    },
  };
}
