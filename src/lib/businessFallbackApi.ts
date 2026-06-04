/**
 * businessFallbackApi.ts — Phase X6.0.1
 *
 * 매장 모드에서 schedule 의 플리가 비어있거나 모두 review_needed/excluded 일 때
 * 같은 카테고리/daypart 의 정상 플리를 자동 fallback 추천.
 */
import { supabase } from '@/lib/supabase';

export type FallbackMatchStrategy = 'category_daypart' | 'category_only' | 'any_playable';

export interface FallbackCandidate {
  playlist_id: string;
  title: string;
  business_category: string | null;
  daypart: string | null;
  playable_count: number;
  match_strategy: FallbackMatchStrategy;
}

export interface PlaylistPlayableSummary {
  id: string;
  title: string;
  business_category: string | null;
  daypart: string | null;
  is_business_only: boolean;
  archived: boolean;
  total_tracks: number;
  playable_count: number;
}

/**
 * 빈 플리/큐 0건 감지 시 fallback 후보 1개를 우선순위에 따라 반환.
 * 우선순위: category_daypart → category_only → any_playable
 *
 * @example
 *   const candidate = await findFallbackPlaylist('카페', 'morning');
 *   if (candidate) { await fetchTracks(candidate.playlist_id); ... }
 */
export async function findFallbackPlaylist(
  businessCategory: string | null,
  daypart: string | null,
): Promise<FallbackCandidate | null> {
  const { data, error } = await supabase.rpc('business_find_fallback_playlist', {
    p_category: businessCategory ?? null,
    p_daypart: daypart ?? null,
  });
  if (error) throw error;
  const rows = (data ?? []) as FallbackCandidate[];
  return rows[0] ?? null;
}

/**
 * Admin schedule 편집 UI 용 — 각 플리의 playable_count 표시.
 */
export async function listPlaylistsWithPlayableCount(): Promise<PlaylistPlayableSummary[]> {
  const { data, error } = await supabase.rpc('business_list_playlists_with_playable_count');
  if (error) throw error;
  return (data ?? []) as PlaylistPlayableSummary[];
}
