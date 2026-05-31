/**
 * playbackEventsV2.ts — Phase X4.3
 *
 * 표준 재생 이벤트 emit helper. 기존 stream_events / track_play_events 와 별도 layer.
 * fit_score / behavior_score 직접 영향 없음. 데이터 수집 표준화용.
 *
 * 사용:
 *   import { logPlaybackEventV2 } from '@/lib/playbackEventsV2';
 *   void logPlaybackEventV2({ trackId, eventType: 'play_start', ... });
 *
 * 모든 호출은 fire-and-forget. 실패해도 silent.
 */
import { supabase } from '@/lib/supabase';

export type PlaybackEventTypeV2 =
  | 'play_start'
  | 'play_progress'
  | 'play_25'
  | 'play_50'
  | 'play_75'
  | 'play_complete'
  | 'skip'
  | 'replay'
  | 'like'
  | 'unlike'
  | 'volume_low'
  | 'muted'
  | 'player_error';

export interface PlaybackEventV2Input {
  trackId: string;
  eventType: PlaybackEventTypeV2;
  sessionId?: string;
  listenedSeconds?: number;
  trackDurationSeconds?: number;
  completionPercent?: number;
  volume?: number;
  muted?: boolean;
  playlistId?: string;
  businessId?: string;
  anonymousId?: string;
  evidence?: Record<string, unknown>;  // X4.3.1: player_error 등 추가 컨텍스트
}

function detectDeviceType(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent.toLowerCase();
  if (/mobile|android|iphone|ipad/.test(ua)) return /ipad/.test(ua) ? 'tablet' : 'mobile';
  return 'desktop';
}

function detectBrowser(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'edge';
  if (/Chrome\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'safari';
  if (/Firefox\//.test(ua)) return 'firefox';
  return 'other';
}

function detectOs(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  if (/Windows/.test(ua)) return 'windows';
  if (/Mac OS X/.test(ua)) return 'macos';
  if (/Android/.test(ua)) return 'android';
  if (/iPhone|iPad/.test(ua)) return 'ios';
  if (/Linux/.test(ua)) return 'linux';
  return 'other';
}

export async function logPlaybackEventV2(input: PlaybackEventV2Input): Promise<void> {
  try {
    await supabase.rpc('log_playback_event_v2', {
      p_track_id: input.trackId,
      p_event_type: input.eventType,
      p_session_id: input.sessionId ?? null,
      p_listened_seconds: input.listenedSeconds ?? null,
      p_track_duration_seconds: input.trackDurationSeconds ?? null,
      p_completion_percent: input.completionPercent ?? null,
      p_volume: input.volume ?? null,
      p_muted: input.muted ?? null,
      p_playlist_id: input.playlistId ?? null,
      p_business_id: input.businessId ?? null,
      p_device_type: detectDeviceType(),
      p_browser: detectBrowser(),
      p_os: detectOs(),
      p_anonymous_id: input.anonymousId ?? null,
      p_evidence_json: input.evidence ?? null,
    });
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[pev2] log failed', e);
    // silent fail — 재생 흐름 차단 금지
  }
}

// ===== Admin API =====
export interface PlaybackEventSummary {
  window_days: number;
  total_events: number;
  distinct_users: number;
  distinct_tracks: number;
  distinct_sessions: number;
  by_event_type: Record<string, number>;
  by_store_slug: Record<string, number>;
  muted_events: number;
  volume_low_events: number;
  null_store_slug_pct: number | null;
  null_duration_pct: number | null;
}

export interface EventQualityIssue {
  issue_type: string;
  event_id: number;
  track_id: string | null;
  session_id: string | null;
  event_type: string;
  listened_seconds: number | null;
  track_duration_seconds: number | null;
  completion_percent: number | null;
  created_at: string;
  evidence: Record<string, unknown> | null;
}

export async function adminPlaybackEventSummary(days = 1): Promise<PlaybackEventSummary | null> {
  const { data, error } = await supabase.rpc('admin_playback_event_summary', { p_days: days });
  if (error) throw error;
  return data as PlaybackEventSummary;
}

export async function adminListEventQualityIssues(
  days = 7, limit = 100,
): Promise<EventQualityIssue[]> {
  const { data, error } = await supabase.rpc('admin_list_event_quality_issues', {
    p_days: days, p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as EventQualityIssue[];
}

export interface PlayerErrorRow {
  id: number;
  track_id: string | null;
  session_id: string | null;
  user_or_anon: string;
  evidence_json: Record<string, unknown> | null;
  created_at: string;
  device_type: string | null;
  browser: string | null;
  os: string | null;
}

export async function adminRecentPlayerErrors(days = 7, limit = 50): Promise<PlayerErrorRow[]> {
  const { data, error } = await supabase.rpc('admin_recent_player_errors', { p_days: days, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as PlayerErrorRow[];
}
