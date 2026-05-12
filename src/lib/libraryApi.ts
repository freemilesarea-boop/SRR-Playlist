import { supabase } from './supabase';
import { applyDemoMode } from './demoMode';
import { getSessionId } from './analytics';
import type { TrackRow, PlaylistRow } from '@/types/db';

const LS_LIKED = 'srr-liked-tracks';
const LS_RECENT = 'srr-recently-played';
const LS_CONTINUE = 'srr-continue-listening';
const RECENT_MAX = 50;

/* ============================================
 * 좋아요한 곡
 * ============================================ */

function readLikedLocal(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_LIKED);
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
function writeLikedLocal(s: Set<string>) {
  try {
    localStorage.setItem(LS_LIKED, JSON.stringify([...s]));
  } catch {
    /* noop */
  }
}

export async function fetchLikedTrackIds(userId: string | null): Promise<Set<string>> {
  if (!userId) return readLikedLocal();
  try {
    const { data, error } = await supabase
      .from('liked_tracks')
      .select('track_id')
      .eq('user_id', userId);
    if (error) throw error;
    return new Set((data ?? []).map((r) => (r as { track_id: string }).track_id));
  } catch {
    // 테이블 없거나 RLS 실패 — localStorage fallback
    return readLikedLocal();
  }
}

export async function fetchLikedTracks(userId: string | null): Promise<TrackRow[]> {
  if (!userId) {
    const ids = [...readLikedLocal()];
    if (ids.length === 0) return [];
    const { data } = await supabase.from('tracks').select('*').in('id', ids);
    return applyDemoMode((data ?? []) as TrackRow[]);
  }
  try {
    const { data, error } = await supabase
      .from('liked_tracks')
      .select('created_at, tracks(*)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const rows = (data ?? []) as unknown as Array<{ created_at: string; tracks: TrackRow }>;
    return applyDemoMode(rows.map((r) => r.tracks).filter(Boolean));
  } catch {
    return [];
  }
}

export async function likeTrack(trackId: string, userId: string | null): Promise<void> {
  if (!userId) {
    const s = readLikedLocal();
    s.add(trackId);
    writeLikedLocal(s);
    return;
  }
  try {
    await supabase.from('liked_tracks').insert({ user_id: userId, track_id: trackId });
  } catch {
    const s = readLikedLocal();
    s.add(trackId);
    writeLikedLocal(s);
  }
}

export async function unlikeTrack(trackId: string, userId: string | null): Promise<void> {
  if (!userId) {
    const s = readLikedLocal();
    s.delete(trackId);
    writeLikedLocal(s);
    return;
  }
  try {
    await supabase
      .from('liked_tracks')
      .delete()
      .match({ user_id: userId, track_id: trackId });
  } catch {
    const s = readLikedLocal();
    s.delete(trackId);
    writeLikedLocal(s);
  }
}

/* ============================================
 * 최근 재생
 * ============================================ */

interface LocalRecent {
  track_id: string;
  played_at: string;
  play_duration_sec: number;
}

function readRecentLocal(): LocalRecent[] {
  try {
    const raw = localStorage.getItem(LS_RECENT);
    return raw ? (JSON.parse(raw) as LocalRecent[]) : [];
  } catch {
    return [];
  }
}

function writeRecentLocal(rows: LocalRecent[]) {
  try {
    localStorage.setItem(LS_RECENT, JSON.stringify(rows.slice(0, RECENT_MAX)));
  } catch {
    /* noop */
  }
}

/** 15초 이상 들었을 때 최근 재생에 push (재생 시작 시점에는 X) */
export async function pushRecentlyPlayed(
  trackId: string,
  userId: string | null,
  durationSec = 0,
): Promise<void> {
  const now = new Date().toISOString();
  // localStorage 도 항상 업데이트 (로그인/비로그인 모두)
  const arr = readRecentLocal().filter((r) => r.track_id !== trackId);
  arr.unshift({ track_id: trackId, played_at: now, play_duration_sec: durationSec });
  writeRecentLocal(arr);

  if (!userId) return;
  try {
    await supabase.from('recently_played_tracks').insert({
      user_id: userId,
      session_id: getSessionId(),
      track_id: trackId,
      play_duration_sec: durationSec,
    });
  } catch {
    /* noop — localStorage 만 유지 */
  }
}

export async function fetchRecentlyPlayedTracks(
  userId: string | null,
  limit = 20,
): Promise<TrackRow[]> {
  if (!userId) {
    const local = readRecentLocal().slice(0, limit);
    if (local.length === 0) return [];
    const { data } = await supabase
      .from('tracks')
      .select('*')
      .in(
        'id',
        local.map((r) => r.track_id),
      );
    const map = new Map(((data ?? []) as TrackRow[]).map((t) => [t.id, t]));
    return applyDemoMode(local.map((r) => map.get(r.track_id)).filter((t): t is TrackRow => !!t));
  }
  try {
    const { data, error } = await supabase
      .from('recently_played_tracks')
      .select('played_at, tracks(*)')
      .eq('user_id', userId)
      .order('played_at', { ascending: false })
      .limit(limit * 3); // distinct 보정용
    if (error) throw error;
    const rows = (data ?? []) as unknown as Array<{ played_at: string; tracks: TrackRow }>;
    // distinct by track id, keep order
    const seen = new Set<string>();
    const out: TrackRow[] = [];
    for (const r of rows) {
      if (!r.tracks || seen.has(r.tracks.id)) continue;
      seen.add(r.tracks.id);
      out.push(r.tracks);
      if (out.length >= limit) break;
    }
    return applyDemoMode(out);
  } catch {
    return [];
  }
}

/* ============================================
 * 이어듣기 (continue_listening)
 * ============================================ */

export interface ContinueListening {
  track_id: string;
  position_sec: number;
  duration_sec: number | null;
  updated_at: string;
  track?: TrackRow;
}

function readContinueLocal(): ContinueListening | null {
  try {
    const raw = localStorage.getItem(LS_CONTINUE);
    return raw ? (JSON.parse(raw) as ContinueListening) : null;
  } catch {
    return null;
  }
}
function writeContinueLocal(c: ContinueListening | null) {
  try {
    if (c) localStorage.setItem(LS_CONTINUE, JSON.stringify(c));
    else localStorage.removeItem(LS_CONTINUE);
  } catch {
    /* noop */
  }
}

let lastSavedAt = 0;
/** 10초마다만 저장 (throttle) */
export async function saveContinueListening(
  trackId: string,
  positionSec: number,
  durationSec: number | null,
  userId: string | null,
): Promise<void> {
  const now = Date.now();
  if (now - lastSavedAt < 10_000) return;
  lastSavedAt = now;

  const payload: ContinueListening = {
    track_id: trackId,
    position_sec: Math.floor(positionSec),
    duration_sec: durationSec,
    updated_at: new Date().toISOString(),
  };
  writeContinueLocal(payload);

  if (!userId) return;
  try {
    await supabase.from('continue_listening').upsert(
      {
        user_id: userId,
        track_id: trackId,
        position_sec: Math.floor(positionSec),
        duration_sec: durationSec,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,track_id' },
    );
  } catch {
    /* noop */
  }
}

export async function clearContinueListening(
  trackId: string,
  userId: string | null,
): Promise<void> {
  writeContinueLocal(null);
  if (!userId) return;
  try {
    await supabase
      .from('continue_listening')
      .delete()
      .match({ user_id: userId, track_id: trackId });
  } catch {
    /* noop */
  }
}

export async function fetchContinueListening(
  userId: string | null,
): Promise<ContinueListening | null> {
  if (!userId) {
    const local = readContinueLocal();
    if (!local) return null;
    const { data } = await supabase.from('tracks').select('*').eq('id', local.track_id).maybeSingle();
    return data ? { ...local, track: applyDemoMode([data as TrackRow])[0] } : local;
  }
  try {
    const { data, error } = await supabase
      .from('continue_listening')
      .select('track_id, position_sec, duration_sec, updated_at, tracks(*)')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = data as unknown as ContinueListening & { tracks: TrackRow | null };
    return {
      track_id: row.track_id,
      position_sec: row.position_sec,
      duration_sec: row.duration_sec,
      updated_at: row.updated_at,
      track: row.tracks ? applyDemoMode([row.tracks])[0] : undefined,
    };
  } catch {
    return readContinueLocal();
  }
}

/* ============================================
 * 라이브러리 전체 한 번에 + 추천
 * ============================================ */

export interface LibraryOverview {
  liked_tracks: TrackRow[];
  recently_played: TrackRow[];
  continue: ContinueListening | null;
  recommended_playlists: PlaylistRow[];
}

export async function fetchLibraryOverview(
  userId: string | null,
): Promise<LibraryOverview> {
  // 비로그인은 RPC 가 빈 결과만 주므로 직접 fetch
  if (!userId) {
    const [liked, recent, cont] = await Promise.all([
      fetchLikedTracks(null),
      fetchRecentlyPlayedTracks(null, 20),
      fetchContinueListening(null),
    ]);
    return {
      liked_tracks: liked,
      recently_played: recent,
      continue: cont,
      recommended_playlists: [],
    };
  }
  try {
    const { data, error } = await supabase.rpc('get_library_overview', {
      limit_recent: 20,
    });
    if (error) throw error;
    const r = (data ?? {}) as {
      liked_tracks: TrackRow[];
      recently_played: TrackRow[];
      continue: ContinueListening | null;
      recommended_playlists: PlaylistRow[];
    };
    return {
      liked_tracks: applyDemoMode(r.liked_tracks ?? []),
      recently_played: applyDemoMode(r.recently_played ?? []),
      continue: r.continue
        ? { ...r.continue, track: r.continue.track ? applyDemoMode([r.continue.track])[0] : undefined }
        : null,
      recommended_playlists: r.recommended_playlists ?? [],
    };
  } catch {
    // fallback — 개별 fetch
    const [liked, recent, cont] = await Promise.all([
      fetchLikedTracks(userId),
      fetchRecentlyPlayedTracks(userId, 20),
      fetchContinueListening(userId),
    ]);
    return {
      liked_tracks: liked,
      recently_played: recent,
      continue: cont,
      recommended_playlists: [],
    };
  }
}

/* ============================================
 * 로그인 시 localStorage → DB 머지 (best effort)
 * ============================================ */

export async function mergeLocalToDb(userId: string): Promise<void> {
  // 좋아요
  const localLiked = [...readLikedLocal()];
  if (localLiked.length > 0) {
    try {
      const payload = localLiked.map((id) => ({ user_id: userId, track_id: id }));
      // ignore conflicts via upsert
      await supabase.from('liked_tracks').upsert(payload, { onConflict: 'user_id,track_id' });
    } catch {
      /* noop */
    }
  }
  // continue
  const cont = readContinueLocal();
  if (cont) {
    try {
      await supabase.from('continue_listening').upsert(
        {
          user_id: userId,
          track_id: cont.track_id,
          position_sec: cont.position_sec,
          duration_sec: cont.duration_sec ?? null,
          updated_at: cont.updated_at,
        },
        { onConflict: 'user_id,track_id' },
      );
    } catch {
      /* noop */
    }
  }
}
