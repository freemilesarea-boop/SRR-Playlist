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

/**
 * 공개 재생 가능 트랙 판정 — RLS 우회(관리자)·stale 링크 방어용.
 * released/approved + 미삭제 + 음원/자켓 존재. (RLS 와 동일 기준)
 */
type PlayableCheckTrack = TrackRow & {
  release_status?: string | null;
  visibility_status?: string | null;
  removed_at?: string | null;
  source_type?: string | null;
  audio_health_status?: string | null;
};
function isPublicPlayableTrack(t: PlayableCheckTrack | null | undefined): boolean {
  if (!t) return false;
  if (t.removed_at) return false;
  // MP3 변환 실패로 표시된 트랙은 사용자 플레이리스트에서 제외 (요구사항 #4)
  if (t.audio_health_status === 'conversion_failed') return false;
  if (t.visibility_status && t.visibility_status !== 'approved') return false;
  const releasedOrCatalog = t.release_status === 'released' || t.source_type === 'admin_upload';
  if (t.release_status != null && !releasedOrCatalog) return false;
  if (!t.cover_url || t.cover_url.trim() === '') return false;
  return true;
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
    .filter(Boolean)
    // 삭제/미발매/자켓없음 트랙 제외 (관리자 RLS 우회·stale 링크 방어). 제외 사유는 dev 로그.
    .filter((t) => {
      const ok = isPublicPlayableTrack(t);
      if (!ok && import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.debug('[fetchPlaylistTracks] 제외:', { id: t.id, title: t.title, release_status: (t as { release_status?: string }).release_status, removed_at: (t as { removed_at?: string }).removed_at });
      }
      return ok;
    });
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
    .select('playlist_id, tracks(audio_url, cover_url, release_status, visibility_status, removed_at, source_type, audio_health_status)');
  if (error) throw error;

  const map = new Map<string, { total: number; playable: number }>();
  const rows = (data ?? []) as unknown as Array<{
    playlist_id: string;
    tracks: PlayableCheckTrack | null;
  }>;
  // 삭제/미발매/자켓없음 트랙은 카운트에서 제외 → "N/N" 이 실제 재생 가능 곡 수와 일치.
  // (이전: audio_url 유무만 봐서 removed 트랙도 재생 가능으로 잘못 카운트 → 10/10 표기 후 제외 발생)
  for (const r of rows) {
    if (!isPublicPlayableTrack(r.tracks)) continue;
    const url = applyDemoMode([{ audio_url: r.tracks?.audio_url ?? '' }])[0]?.audio_url?.trim() ?? '';
    const entry = map.get(r.playlist_id) ?? { total: 0, playable: 0 };
    entry.total += 1;
    if (url.length > 0) entry.playable += 1;
    map.set(r.playlist_id, entry);
  }

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
