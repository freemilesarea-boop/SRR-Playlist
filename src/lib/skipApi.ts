/**
 * skipApi.ts — 스킵률 기반 메타데이터 위반 자동 신고/관리자 재세팅 클라이언트.
 * recordTrackSkip 은 fire-and-forget(사용자에게 어떤 문구도 노출하지 않음).
 */
import { supabase } from '@/lib/supabase';
import { getAnonymousId } from '@/lib/analytics';

export type SkipReason =
  | 'manual_skip' // 다음 버튼
  | 'select_other' // 다른 곡 선택
  | 'early_leave'; // 재생 중 이탈

/**
 * 스킵 기록. 클라이언트에서 1차 필터(>=5초 재생 AND 30% 이전 스킵)를 적용한 뒤
 * 서버 RPC 가 동일 기준으로 재검증/집계한다. best-effort — 실패해도 무시.
 */
export async function recordTrackSkip(
  playlistId: string,
  trackId: string,
  playedSeconds: number,
  trackDuration: number | null,
  reason: SkipReason = 'manual_skip',
): Promise<void> {
  if (!playlistId || !trackId) return;
  const played = Math.max(0, playedSeconds || 0);
  const dur = trackDuration && trackDuration > 0 ? trackDuration : null;
  // 1차 필터: 너무 짧게 듣거나(<5s) 거의 끝까지 들은(>=30%) 경우는 스킵으로 보지 않음.
  if (played < 5) return;
  if (dur !== null && played >= 0.3 * dur) return;
  try {
    await supabase.rpc('record_track_skip', {
      p_playlist_id: playlistId,
      p_track_id: trackId,
      p_played_seconds: played,
      p_track_duration: dur,
      p_reason: reason,
      p_anon_id: getAnonymousId(),
    });
  } catch {
    /* fire-and-forget */
  }
}

// 앱 로드 단위 세션 ID — 사업자 early_skip 중복 집계 방지(같은 세션 동일곡 1회).
let PLAYER_SESSION_ID: string | null = null;
function playerSessionId(): string {
  if (!PLAYER_SESSION_ID) {
    try { PLAYER_SESSION_ID = crypto.randomUUID(); } catch { PLAYER_SESSION_ID = `s_${Date.now()}_${Math.random().toString(36).slice(2)}`; }
  }
  return PLAYER_SESSION_ID;
}

/**
 * 사업자 회원의 30초 이내 수동 스킵 기록 (fire-and-forget).
 * 서버 RPC 가 사업자 여부/30초/사유를 재검증하고, 비사업자면 조용히 무시한다.
 * 사용자에게 어떤 문구도 노출하지 않는다.
 */
export async function recordBusinessEarlySkip(
  playlistId: string,
  trackId: string,
  playedSeconds: number,
  trackDuration: number | null,
  reason: SkipReason = 'manual_skip',
): Promise<void> {
  if (!playlistId || !trackId) return;
  if (playedSeconds > 30) return; // 클라 1차 필터 (서버 재검증)
  try {
    await supabase.rpc('record_business_early_skip', {
      p_playlist_id: playlistId,
      p_track_id: trackId,
      p_played_seconds: Math.max(0, playedSeconds || 0),
      p_duration: trackDuration && trackDuration > 0 ? trackDuration : null,
      p_session_id: playerSessionId(),
      p_skip_reason: reason,
    });
  } catch {
    /* fire-and-forget */
  }
}

export interface MetadataViolation {
  id: string;
  playlist_id: string;
  track_id: string;
  skip_count: number;
  status: 'pending' | 'reviewed' | 'resolved' | 'ignored';
  reason: string | null;
  first_detected_at: string;
  last_detected_at: string;
  reviewed_at: string | null;
  admin_note: string | null;
  title: string | null;
  artist: string | null;
  main_genre: string | null;
  mood: string | null;
  energy_level: number | null;
  playlist_title: string | null;
  playlist_category: string | null;
  playlist_skip_count: number;
  total_skip_count: number;
  avg_played_before_skip: number | null;
}

export async function listMetadataViolations(
  status?: MetadataViolation['status'] | null,
): Promise<MetadataViolation[]> {
  const { data, error } = await supabase.rpc('admin_list_metadata_violations', {
    p_status: status ?? null,
  });
  if (error) throw error;
  return (data ?? []) as MetadataViolation[];
}

export async function resolveMetadataViolation(
  id: string,
  status: MetadataViolation['status'],
  note?: string,
): Promise<void> {
  const { error } = await supabase.rpc('admin_resolve_metadata_violation', {
    p_id: id,
    p_status: status,
    p_note: note ?? null,
  });
  if (error) throw error;
}

export async function excludeTrackFromPlaylist(
  playlistId: string,
  trackId: string,
): Promise<void> {
  const { error } = await supabase.rpc('admin_exclude_track_from_playlist', {
    p_playlist_id: playlistId,
    p_track_id: trackId,
  });
  if (error) throw error;
}

export interface SkippedTrackStat {
  track_id: string;
  title: string | null;
  artist: string | null;
  skips: number;
}
export interface SkippedPlaylistStat {
  playlist_id: string;
  title: string | null;
  category: string | null;
  skips: number;
}
export interface CategoryStat {
  category: string | null;
  unfit_tracks: number;
}
export interface MetadataViolationStats {
  recent7d_candidates: number;
  pending_candidates: number;
  top_skipped_tracks: SkippedTrackStat[];
  top_skipped_playlists: SkippedPlaylistStat[];
  by_category: CategoryStat[];
}

export async function metadataViolationStats(): Promise<MetadataViolationStats> {
  const { data, error } = await supabase.rpc('admin_metadata_violation_stats');
  if (error) throw error;
  return data as MetadataViolationStats;
}
