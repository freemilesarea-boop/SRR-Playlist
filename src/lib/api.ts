import { supabase } from './supabase';
import { applyDemoMode } from './demoMode';
import type { PlaylistRow, TrackRow } from '@/types/db';

export interface PlaylistWithCount extends PlaylistRow {
  track_count?: number;
}

export async function fetchPlaylists(): Promise<PlaylistRow[]> {
  const { data, error } = await supabase
    .from('playlists')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchPlaylist(id: string): Promise<PlaylistRow | null> {
  const { data, error } = await supabase.from('playlists').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchPlaylistTracks(playlistId: string): Promise<TrackRow[]> {
  const { data, error } = await supabase
    .from('playlist_tracks')
    .select('order_index, tracks(*)')
    .eq('playlist_id', playlistId)
    .order('order_index', { ascending: true });
  if (error) throw error;
  const tracks = ((data ?? []) as unknown as Array<{ order_index: number; tracks: TrackRow }>)
    .map((row) => row.tracks)
    .filter(Boolean);
  return applyDemoMode(tracks);
}

/**
 * 0103 — 동적 스마트 플레이리스트 트랙 (auto_rule 기반 실시간 매칭).
 * playlist_tracks 저장 없이 RPC 가 점수순으로 반환. is_auto=true 플리에서만 사용.
 */
export async function fetchAutoPlaylistTracks(playlistId: string, limit = 100): Promise<TrackRow[]> {
  const { data, error } = await supabase.rpc('get_auto_playlist_tracks', {
    p_playlist_id: playlistId,
    p_limit: limit,
  });
  if (error) throw error;
  const tracks = ((data ?? []) as TrackRow[]);
  return applyDemoMode(tracks);
}

/** 플레이리스트별 (총 트랙 수, 재생 가능한 트랙 수) 를 한 번에 가져옵니다. */
export async function fetchPlaylistCounts(): Promise<
  Map<string, { total: number; playable: number }>
> {
  const { data, error } = await supabase
    .from('playlist_tracks')
    .select('playlist_id, tracks(audio_url)');
  if (error) throw error;

  const map = new Map<string, { total: number; playable: number }>();
  const rows = (data ?? []) as unknown as Array<{
    playlist_id: string;
    tracks: { audio_url: string | null } | null;
  }>;
  // 데모 모드가 켜져 있으면 빈 audio_url 도 재생 가능으로 카운트
  const enrichedTracks = applyDemoMode(
    rows.map((r) => ({ audio_url: r.tracks?.audio_url ?? '' })),
  );
  rows.forEach((r, i) => {
    const url = enrichedTracks[i]?.audio_url?.trim() ?? '';
    const entry = map.get(r.playlist_id) ?? { total: 0, playable: 0 };
    entry.total += 1;
    if (url.length > 0) entry.playable += 1;
    map.set(r.playlist_id, entry);
  });

  // 자동(스마트) 플레이리스트는 playlist_tracks 가 없으므로 동적 매칭 수를 별도 RPC 로 병합.
  // (없으면 "0곡" 으로 표시되고 정렬에서 밀려 비어있는 것처럼 보임)
  try {
    const { data: autoCounts } = await supabase.rpc('auto_playlist_counts');
    for (const a of (autoCounts ?? []) as Array<{ playlist_id: string; n: number }>) {
      map.set(a.playlist_id, { total: a.n, playable: a.n });
    }
  } catch {
    /* RPC 미적용 환경 — 조용히 폴백 */
  }
  return map;
}

/**
 * 0110 — 카탈로그 플레이리스트 대표 커버 맵 (playlist_id → cover_url).
 * 내부 음원 자켓 기반. 1회 호출(N+1 방지). 없으면 키 없음 → 카드가 그라데이션 fallback.
 */
export async function fetchPlaylistCovers(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { data, error } = await supabase.rpc('get_catalog_playlist_covers');
    if (error) return map;
    for (const r of (data ?? []) as Array<{ playlist_id: string; cover_url: string | null }>) {
      if (r.cover_url) map.set(r.playlist_id, r.cover_url);
    }
  } catch {
    /* noop */
  }
  return map;
}

export async function fetchTracks(): Promise<TrackRow[]> {
  const { data, error } = await supabase
    .from('tracks')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function toggleLike(userId: string, playlistId: string, liked: boolean) {
  if (liked) {
    const { error } = await supabase.from('likes').delete().match({ user_id: userId, playlist_id: playlistId });
    if (error) throw error;
  } else {
    const { error } = await supabase.from('likes').insert({ user_id: userId, playlist_id: playlistId });
    if (error) throw error;
  }
}

export async function fetchLikedIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase.from('likes').select('playlist_id').eq('user_id', userId);
  if (error) throw error;
  return (data ?? []).map((row) => row.playlist_id);
}

export async function logRecentPlay(userId: string, playlistId: string) {
  const { error } = await supabase
    .from('recent_plays')
    .insert({ user_id: userId, playlist_id: playlistId });
  if (error && import.meta.env.DEV) console.error('[logRecentPlay] insert failed:', error);
}

export async function fetchRecentPlaylists(userId: string, limit = 12): Promise<PlaylistRow[]> {
  const { data, error } = await supabase
    .from('recent_plays')
    .select('played_at, playlists(*)')
    .eq('user_id', userId)
    .order('played_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as unknown as Array<{ played_at: string; playlists: PlaylistRow }>;
  const seen = new Set<string>();
  const result: PlaylistRow[] = [];
  for (const r of rows) {
    if (!r.playlists || seen.has(r.playlists.id)) continue;
    seen.add(r.playlists.id);
    result.push(r.playlists);
  }
  return result;
}
