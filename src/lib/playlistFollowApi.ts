/**
 * playlistFollowApi.ts
 *
 * 플레이리스트 팔로우(구독) API.
 *   - 로그인: Supabase `playlist_follows` 테이블 + RPC
 *   - 미로그인 / 0012 미적용 / RLS 실패: localStorage 폴백 (조용히)
 *
 * 좋아요(likes) 와는 별개:
 *   - likes = 임시 좋아요/저장
 *   - playlist_follows = 업데이트 구독 (큐레이터 시스템 기반)
 */

import { supabase } from './supabase';
import type { PlaylistRow, TimeSlot } from '@/types/db';

function toTimeSlot(v: string | null): TimeSlot | null {
  if (v === 'morning' || v === 'afternoon' || v === 'evening') return v;
  // legacy DB row 호환 — 0215 이전 'night'/'late'/'lunch' 데이터가 캐시에 남아있을 때
  if (v === 'night' || v === 'late') return 'evening';
  if (v === 'lunch') return 'afternoon';
  return null;
}

const LS_KEY = 'srr-followed-playlists';

/** localStorage 에 보관하는 팔로우 스냅샷 — 비로그인 사용자도 표시 가능하도록 */
interface FollowedSnapshot {
  id: string;
  title: string;
  description: string | null;
  category: string;
  thumbnail_url: string | null;
  is_business_only: boolean;
  time_slot: string | null;
  followed_at: string;
}

function playlistToSnapshot(p: PlaylistRow): FollowedSnapshot {
  return {
    id: p.id,
    title: p.title,
    description: p.description ?? null,
    category: p.category,
    thumbnail_url: p.thumbnail_url ?? null,
    is_business_only: p.is_business_only,
    time_slot: p.time_slot ?? null,
    followed_at: new Date().toISOString(),
  };
}

function snapshotToPlaylist(s: FollowedSnapshot): PlaylistRow {
  return {
    id: s.id,
    title: s.title,
    description: s.description,
    category: s.category,
    business_category: null,
    thumbnail_url: s.thumbnail_url,
    is_business_only: s.is_business_only,
    time_slot: toTimeSlot(s.time_slot),
    sort_order: 0,
    created_at: s.followed_at,
  } as PlaylistRow;
}

function readLocal(): FollowedSnapshot[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FollowedSnapshot[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(rows: FollowedSnapshot[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(rows));
  } catch {
    /* quota — noop */
  }
}

/** 동기 isFollowed (localStorage 기반) — store/optimistic UI 용 */
export function isPlaylistFollowedLocal(playlistId: string): boolean {
  return readLocal().some((s) => s.id === playlistId);
}

/** DB + localStorage union 으로 팔로우 여부 */
export async function isPlaylistFollowed(
  playlistId: string,
  userId: string | null,
): Promise<boolean> {
  if (isPlaylistFollowedLocal(playlistId)) return true;
  if (!userId) return false;
  try {
    const { data, error } = await supabase
      .from('playlist_follows')
      .select('id')
      .eq('user_id', userId)
      .eq('playlist_id', playlistId)
      .maybeSingle();
    if (error) return false;
    return !!data;
  } catch {
    return false;
  }
}

export interface FollowResult {
  ok: boolean;
  source: 'db' | 'local' | 'both';
  warning?: string;
}

export async function followPlaylist(
  playlist: PlaylistRow,
  userId: string | null,
): Promise<FollowResult> {
  // localStorage 우선 저장 — 비로그인 / DB 실패 안전망
  const local = readLocal();
  if (!local.some((s) => s.id === playlist.id)) {
    local.unshift(playlistToSnapshot(playlist));
    writeLocal(local.slice(0, 500));
  }
  if (!userId) return { ok: true, source: 'local' };

  try {
    const { error } = await supabase
      .from('playlist_follows')
      .insert({ user_id: userId, playlist_id: playlist.id });
    if (error) {
      if (error.code === '23505') return { ok: true, source: 'db' }; // 이미 팔로우
      return {
        ok: true,
        source: 'local',
        warning: `팔로우 DB 저장 실패 (${error.code ?? '?'})`,
      };
    }
    return { ok: true, source: 'both' };
  } catch (e) {
    return {
      ok: true,
      source: 'local',
      warning: e instanceof Error ? e.message : 'network',
    };
  }
}

export async function unfollowPlaylist(
  playlistId: string,
  userId: string | null,
): Promise<FollowResult> {
  writeLocal(readLocal().filter((s) => s.id !== playlistId));
  if (!userId) return { ok: true, source: 'local' };
  try {
    const { error } = await supabase
      .from('playlist_follows')
      .delete()
      .match({ user_id: userId, playlist_id: playlistId });
    if (error) return { ok: true, source: 'local', warning: error.message };
    return { ok: true, source: 'both' };
  } catch {
    return { ok: true, source: 'local' };
  }
}

export async function togglePlaylistFollow(
  playlist: PlaylistRow,
  nextFollowed: boolean,
  userId: string | null,
): Promise<FollowResult> {
  if (nextFollowed) return followPlaylist(playlist, userId);
  return unfollowPlaylist(playlist.id, userId);
}

/**
 * 팔로우한 플레이리스트 목록.
 * DB(authed) + localStorage 의 union 반환.
 */
export interface FollowedPlaylist extends PlaylistRow {
  followed_at: string;
  follower_count: number;
}

export async function fetchFollowedPlaylists(
  userId: string | null,
): Promise<FollowedPlaylist[]> {
  const local = readLocal();
  if (!userId) {
    return local.map((s) => ({
      ...(snapshotToPlaylist(s) as PlaylistRow),
      followed_at: s.followed_at,
      follower_count: 0,
    }));
  }

  // DB RPC 우선
  try {
    const { data, error } = await supabase.rpc('get_followed_playlists');
    if (error) throw error;
    const rows = (data ?? []) as Array<{
      playlist_id: string;
      title: string;
      description: string | null;
      category: string;
      thumbnail_url: string | null;
      is_business_only: boolean;
      time_slot: string | null;
      followed_at: string;
      follower_count: number;
    }>;
    const dbList: FollowedPlaylist[] = rows.map((r) => ({
      id: r.playlist_id,
      title: r.title,
      description: r.description,
      category: r.category,
      business_category: null,
      thumbnail_url: r.thumbnail_url,
      is_business_only: r.is_business_only,
      time_slot: toTimeSlot(r.time_slot),
      sort_order: 0,
      created_at: r.followed_at,
      followed_at: r.followed_at,
      follower_count: r.follower_count,
    }));
    const dbIds = new Set(dbList.map((p) => p.id));
    const onlyLocal: FollowedPlaylist[] = local
      .filter((s) => !dbIds.has(s.id))
      .map((s) => ({
        ...(snapshotToPlaylist(s) as PlaylistRow),
        followed_at: s.followed_at,
        follower_count: 0,
      }));
    return [...dbList, ...onlyLocal];
  } catch {
    // 0012 미적용 / RLS 실패 → localStorage 만
    return local.map((s) => ({
      ...(snapshotToPlaylist(s) as PlaylistRow),
      followed_at: s.followed_at,
      follower_count: 0,
    }));
  }
}

/** 일괄 follower count 조회 (PlaylistCard / Hero 등에서 사용) */
export async function fetchPlaylistFollowCounts(
  ids: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  try {
    const { data, error } = await supabase.rpc('get_playlist_follow_counts', {
      p_playlist_ids: ids,
    });
    if (error) throw error;
    for (const r of (data ?? []) as Array<{ playlist_id: string; follower_count: number }>) {
      out.set(r.playlist_id, Number(r.follower_count));
    }
    return out;
  } catch {
    return out; // 폴백: 빈 맵 (UI 가 0 처리)
  }
}

export interface PopularPlaylist extends PlaylistRow {
  follower_count: number;
  track_count: number;
}

export async function fetchPopularPlaylistsByFollows(
  limit = 10,
): Promise<PopularPlaylist[]> {
  try {
    const { data, error } = await supabase.rpc('get_popular_playlists_by_follows', {
      p_limit: limit,
    });
    if (error) throw error;
    const rows = (data ?? []) as Array<{
      playlist_id: string;
      title: string;
      description: string | null;
      category: string;
      thumbnail_url: string | null;
      is_business_only: boolean;
      time_slot: string | null;
      follower_count: number;
      track_count: number;
    }>;
    return rows.map((r) => ({
      id: r.playlist_id,
      title: r.title,
      description: r.description,
      category: r.category,
      business_category: null,
      thumbnail_url: r.thumbnail_url,
      is_business_only: r.is_business_only,
      time_slot: toTimeSlot(r.time_slot),
      sort_order: 0,
      created_at: '',
      follower_count: Number(r.follower_count),
      track_count: Number(r.track_count),
    }));
  } catch {
    return []; // 폴백 — 호출 측에서 빈 결과면 seed/숨김 처리
  }
}

/** 로그인 직후 localStorage → DB 머지 */
export async function mergePlaylistFollows(userId: string): Promise<void> {
  const local = readLocal();
  if (local.length === 0) return;
  try {
    const payload = local.map((s) => ({ user_id: userId, playlist_id: s.id }));
    const { error } = await supabase
      .from('playlist_follows')
      .upsert(payload, { onConflict: 'user_id,playlist_id' });
    void error;
  } catch {
    /* noop */
  }
}
