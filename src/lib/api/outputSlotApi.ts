/**
 * outputSlotApi — 분리 송출 공간(플레이어 1~3)별 상태 보고·조회.
 * Migration: supabase/migrations/0537_output_slot_monitoring.sql
 */
import { supabase } from '@/lib/supabase';
import type { OutputSlot } from '@/lib/outputSlot';

export type SlotPlayerStatus = 'playing' | 'paused' | 'stopped' | 'unknown';

export interface OutputSlotStatus {
  slot: OutputSlot;
  /** 점주가 설정한 역할. */
  mode: 'brand' | 'store' | 'announce';
  source: 'schedule' | 'category' | null;
  category: string | null;
  /** 창이 실제로 보고한 역할(설정과 다르면 창을 다시 열어야 한다). */
  reported_mode: 'brand' | 'store' | 'announce' | null;
  player_status: SlotPlayerStatus | null;
  /** 마지막 보고 3분 이내. */
  online: boolean;
  last_heartbeat_at: string | null;
  visibility: 'visible' | 'hidden' | null;
  sink_label: string | null;
  track_title: string | null;
  track_artist: string | null;
  track_started_at: string | null;
  app_version: string | null;
}

export interface AdminOutputSlotStore {
  store_id: string;
  store_label: string | null;
  email: string | null;
  enabled: boolean;
  announcement_slot: OutputSlot | null;
  slots: OutputSlotStatus[];
  offline_count: number;
}

export async function sendOutputSlotHeartbeat(input: {
  slot: OutputSlot;
  mode: 'brand' | 'store' | 'announce';
  playerStatus: SlotPlayerStatus;
  currentTrackId: string | null;
  currentTrackStartedAt: string | null;
  sinkLabel: string | null;
  visibility: 'visible' | 'hidden' | null;
  appVersion: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc('output_slot_heartbeat', {
    p_slot: input.slot,
    p_mode: input.mode,
    p_player_status: input.playerStatus,
    p_current_track_id: input.currentTrackId,
    p_current_track_started_at: input.currentTrackStartedAt,
    p_sink_label: input.sinkLabel,
    p_visibility: input.visibility,
    p_app_version: input.appVersion,
  });
  if (error) throw error;
}

export async function getMyOutputSlotStatus(): Promise<OutputSlotStatus[]> {
  const { data, error } = await supabase.rpc('get_my_output_slot_status');
  if (error) throw error;
  return (data ?? []) as OutputSlotStatus[];
}

export async function adminListOutputSlotStatus(search?: string): Promise<AdminOutputSlotStore[]> {
  const { data, error } = await supabase.rpc('admin_list_output_slot_status', {
    p_search: search?.trim() || null,
  });
  if (error) throw error;
  return (data ?? []) as AdminOutputSlotStore[];
}

/** 화면 표시용 상태 — 오프라인 > 창 숨김(최소화) > 재생 상태. */
/** standby — 안내방송 전용 창이 켜져서 다음 안내를 기다리는 정상 상태. */
export type SlotDisplayState = 'offline' | 'hidden' | 'playing' | 'paused' | 'idle' | 'standby' | 'never';

export function slotDisplayState(
  s: Pick<OutputSlotStatus, 'online' | 'visibility' | 'player_status' | 'last_heartbeat_at'> & { mode?: OutputSlotStatus['mode'] },
): SlotDisplayState {
  if (!s.last_heartbeat_at) return 'never';
  if (!s.online) return 'offline';
  if (s.visibility === 'hidden') return 'hidden';
  // 안내방송 전용 창은 음악이 없는 게 정상이다 — 켜져 있으면 대기.
  if (s.mode === 'announce') return s.player_status === 'playing' ? 'playing' : 'standby';
  if (s.player_status === 'playing') return 'playing';
  if (s.player_status === 'paused') return 'paused';
  return 'idle';
}

export const SLOT_DISPLAY_LABEL: Record<SlotDisplayState, string> = {
  never: '아직 연결 안 됨',
  offline: '연결 끊김',
  hidden: '창 최소화됨',
  playing: '재생 중',
  paused: '일시정지',
  idle: '대기',
  standby: '안내 대기 중',
};
