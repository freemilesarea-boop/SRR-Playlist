/**
 * playlistBuilderApi — Phase AI-PLAYLIST-ADMIN-UX-1
 *
 * 관리자 "플레이리스트 빌더" 서비스 래퍼.
 *   - 최종 저장은 트랜잭션 1회(admin_save_playlist_tracks): 드래그 중 DB write 금지,
 *     저장 버튼을 눌렀을 때만 최종 트랙 집합/순서를 일괄 반영한다.
 *   - 복제(admin_clone_playlist): 메타데이터 + 트랙목록을 새 draft 로 복사.
 *   - 배치된 트랙 조회(admin_playlist_placed_tracks).
 * 모두 admin 전용(RPC 내부 users.role='admin' 게이트).
 *
 * SQL: supabase/migrations/0466_admin_playlist_builder.sql
 */
import { supabase } from '@/lib/supabase';
import type { StoreProfileRow } from '@/lib/playlistPresets';

/** admin_save_playlist_tracks 반환. */
export interface SavePlaylistTracksResult {
  playlist_id: string;
  track_count: number;
  removed: number;
  computed_at: string;
}

/** admin_clone_playlist 반환. */
export interface ClonePlaylistResult {
  new_playlist_id: string;
  source_playlist_id: string;
  track_count: number;
  status: string;
}

/** admin_playlist_placed_tracks 의 배치 트랙 행. */
export interface PlacedTrackRow {
  track_id: string;
  title: string | null;
  artist: string | null;
  cover_url: string | null;
  order_index: number;
  placed_by: string | null;
  match_score: number | null;
  release_status: string | null;
  placement_reason: string | null;
}

/**
 * 최종 트랙 집합/순서를 트랜잭션 1회로 저장한다.
 * @param playlistId 대상 플레이리스트(수동 플리만; auto 플리는 RPC 가 거부).
 * @param trackIds   최종 순서대로의 track_id 목록. 없는 트랙은 삭제, 순서는 배열 위치로 반영.
 */
export async function savePlaylistTracks(
  playlistId: string,
  trackIds: string[],
): Promise<SavePlaylistTracksResult> {
  const { data, error } = await supabase.rpc('admin_save_playlist_tracks', {
    p_playlist_id: playlistId,
    p_track_ids: trackIds,
  });
  if (error) {
    console.error('[playlistBuilderApi] save failed', error);
    throw error;
  }
  return data as SavePlaylistTracksResult;
}

/**
 * 플레이리스트를 복제한다(메타 + 트랙목록 → 새 플리). 기본 draft.
 * 복제본은 항상 수동(is_auto=false) 플리로 만들어진다.
 */
export async function clonePlaylist(
  sourcePlaylistId: string,
  newTitle: string,
  status: 'draft' | 'released' = 'draft',
): Promise<ClonePlaylistResult> {
  const { data, error } = await supabase.rpc('admin_clone_playlist', {
    p_source_playlist_id: sourcePlaylistId,
    p_new_title: newTitle,
    p_status: status,
  });
  if (error) {
    console.error('[playlistBuilderApi] clone failed', error);
    throw error;
  }
  return data as ClonePlaylistResult;
}

/** 플레이리스트에 배치된 트랙을 order_index 순으로 조회(admin 전용). */
export async function loadPlacedTracks(playlistId: string): Promise<PlacedTrackRow[]> {
  const { data, error } = await supabase.rpc('admin_playlist_placed_tracks', {
    p_playlist_id: playlistId,
  });
  if (error) {
    console.error('[playlistBuilderApi] placed_tracks failed', error);
    throw error;
  }
  return (Array.isArray(data) ? data : []) as PlacedTrackRow[];
}

/** candidate pool tracks[] 행(fit/adaptive/guardrail) — enrichWithCandidatePool 입력용. */
export interface CandidatePoolRow {
  track_id: string;
  fit_score?: number | null;
  adaptive_score?: number | null;
  fit_status?: string | null;
  guardrail_blocked?: boolean | null;
  guardrail_penalty?: number | null;
  guardrail_severity?: string | null;
}

/**
 * 후보 풀(fit/adaptive/guardrail) 조회. storeId 를 주면 매장별, 없으면(null) 전역 카탈로그 기준.
 * 점수 표시는 부가 정보이므로 실패 시 호출부에서 무시할 수 있다.
 */
export async function loadCandidatePool(
  playlistId: string,
  storeId: string | null = null,
): Promise<CandidatePoolRow[]> {
  const { data, error } = await supabase.rpc('admin_ai_store_candidate_pool', {
    p_store_id: storeId,
    p_playlist_id: playlistId,
  });
  if (error) {
    console.error('[playlistBuilderApi] candidate_pool failed', error);
    throw error;
  }
  const rows = (data as { tracks?: unknown } | null)?.tracks;
  return (Array.isArray(rows) ? rows : []) as CandidatePoolRow[];
}

/**
 * 운영 Preset 소스: 기존 ai_store_profiles(업종별 정책) 조회.
 *   RLS: asp_admin_read(admin 전체) / asp_public_read(active). 신규 테이블/RPC 없이 재사용.
 *   active 프로필만, sort_order 순.
 */
export async function listStoreProfiles(): Promise<StoreProfileRow[]> {
  const { data, error } = await supabase
    .from('ai_store_profiles')
    .select(
      'store_key, store_label, preferred_genres, blocked_genres, preferred_moods, vocal_preference, ' +
        'ideal_bpm_min, ideal_bpm_max, bpm_min, bpm_max, ideal_energy_min, ideal_energy_max, energy_min, energy_max, ' +
        'allow_explicit, require_clean_content, sort_order, active, description',
    )
    .eq('active', true)
    .order('sort_order', { ascending: true });
  if (error) {
    console.error('[playlistBuilderApi] listStoreProfiles failed', error);
    throw error;
  }
  return (data ?? []) as unknown as StoreProfileRow[];
}
