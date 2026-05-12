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

/**
 * localStorage 좋아요 데이터 — 단순 ID 가 아니라 track snapshot 까지 저장.
 * 비로그인 사용자도 보관함에서 곡 정보를 정상 표시 가능.
 */
interface LikedSnapshot {
  id: string;
  title: string;
  artist: string | null;
  genre: string | null;
  mood: string | null;
  cover_url: string | null;
  audio_url: string;
  duration: number | null;
  liked_at: string;
}

function readLikedLocal(): LikedSnapshot[] {
  try {
    const raw = localStorage.getItem(LS_LIKED);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // 구버전 (string[]) 호환
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'string') {
      return (parsed as string[]).map((id) => ({
        id,
        title: '(불러올 수 없음)',
        artist: null,
        genre: null,
        mood: null,
        cover_url: null,
        audio_url: '',
        duration: null,
        liked_at: new Date().toISOString(),
      }));
    }
    return Array.isArray(parsed) ? (parsed as LikedSnapshot[]) : [];
  } catch {
    return [];
  }
}

function writeLikedLocal(rows: LikedSnapshot[]) {
  try {
    localStorage.setItem(LS_LIKED, JSON.stringify(rows));
  } catch {
    /* noop */
  }
}

function trackToSnapshot(t: TrackRow): LikedSnapshot {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    genre: t.genre,
    mood: t.mood,
    cover_url: t.cover_url,
    audio_url: t.audio_url,
    duration: t.duration,
    liked_at: new Date().toISOString(),
  };
}

function snapshotToTrack(s: LikedSnapshot): TrackRow {
  return {
    id: s.id,
    title: s.title,
    artist: s.artist,
    genre: s.genre,
    mood: s.mood,
    audio_url: s.audio_url,
    cover_url: s.cover_url,
    duration: s.duration,
    created_at: s.liked_at,
  };
}

/** 좋아요 ID 집합 — DB + localStorage union */
export async function fetchLikedTrackIds(userId: string | null): Promise<Set<string>> {
  const localIds = new Set(readLikedLocal().map((s) => s.id));
  if (!userId) return localIds;
  try {
    const { data, error } = await supabase
      .from('liked_tracks')
      .select('track_id')
      .eq('user_id', userId);
    if (error) return localIds; // RLS/마이그레이션 실패 → 로컬만
    for (const row of data ?? []) localIds.add((row as { track_id: string }).track_id);
    return localIds;
  } catch {
    return localIds;
  }
}

/** 좋아요한 곡 목록 — DB + localStorage union, snapshot fallback 가능 */
export async function fetchLikedTracks(userId: string | null): Promise<TrackRow[]> {
  const local = readLikedLocal();
  // 비로그인: snapshot 그대로
  if (!userId) {
    return applyDemoMode(local.map(snapshotToTrack));
  }

  // 로그인: DB + 로컬 union
  let dbTracks: TrackRow[] = [];
  try {
    const { data, error } = await supabase
      .from('liked_tracks')
      .select('created_at, tracks(*)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (!error) {
      const rows = (data ?? []) as unknown as Array<{ created_at: string; tracks: TrackRow }>;
      dbTracks = rows.map((r) => r.tracks).filter(Boolean);
    }
  } catch {
    /* fall through */
  }

  // DB 가 비어있고 로컬에 있다면 → 로컬 snapshot 사용 (마이그레이션 미적용 케이스)
  if (dbTracks.length === 0 && local.length > 0) {
    return applyDemoMode(local.map(snapshotToTrack));
  }

  // 둘 다 있을 땐 DB 기준 + 로컬에만 있는 것 추가
  const dbIds = new Set(dbTracks.map((t) => t.id));
  const onlyLocal = local.filter((s) => !dbIds.has(s.id)).map(snapshotToTrack);
  return applyDemoMode([...dbTracks, ...onlyLocal]);
}

/** 동기 isLiked — store 사용을 권장하지만 단발성 체크용 */
export function isTrackLiked(trackId: string): boolean {
  return readLikedLocal().some((s) => s.id === trackId);
}

/** 결과 객체로 명확히 반환 */
export interface LikeResult {
  ok: boolean;
  source: 'db' | 'local' | 'both';
  warning?: string;
}

export async function likeTrack(
  track: TrackRow | { id: string },
  userId: string | null,
): Promise<LikeResult> {
  const trackId = track.id;

  // localStorage 는 항상 같이 저장 (offline 안전망)
  const local = readLikedLocal();
  if (!local.some((s) => s.id === trackId)) {
    const snap: LikedSnapshot =
      'title' in track
        ? trackToSnapshot(track as TrackRow)
        : {
            id: trackId,
            title: '(제목 없음)',
            artist: null,
            genre: null,
            mood: null,
            cover_url: null,
            audio_url: '',
            duration: null,
            liked_at: new Date().toISOString(),
          };
    local.unshift(snap);
    writeLikedLocal(local.slice(0, 200));
  }

  if (!userId) return { ok: true, source: 'local' };

  // Supabase insert — error 를 명시적으로 체크
  const { error } = await supabase
    .from('liked_tracks')
    .insert({ user_id: userId, track_id: trackId });
  if (error) {
    // 23505 = unique violation (이미 좋아요) → 정상 처리
    if (error.code === '23505') return { ok: true, source: 'db' };
    // 그 외 (테이블 없음 / RLS 거부 등) → 로컬에만 유지
    return {
      ok: true,
      source: 'local',
      warning: `좋아요 DB 저장 실패 (${error.code ?? '?'}): ${error.message}`,
    };
  }
  return { ok: true, source: 'both' };
}

export async function unlikeTrack(
  trackId: string,
  userId: string | null,
): Promise<LikeResult> {
  const local = readLikedLocal().filter((s) => s.id !== trackId);
  writeLikedLocal(local);

  if (!userId) return { ok: true, source: 'local' };
  const { error } = await supabase
    .from('liked_tracks')
    .delete()
    .match({ user_id: userId, track_id: trackId });
  if (error) {
    return {
      ok: true,
      source: 'local',
      warning: `좋아요 DB 삭제 실패: ${error.message}`,
    };
  }
  return { ok: true, source: 'both' };
}

/** toggle helper */
export async function toggleTrackLike(
  track: TrackRow | { id: string },
  nextLiked: boolean,
  userId: string | null,
): Promise<LikeResult> {
  if (nextLiked) return likeTrack(track, userId);
  return unlikeTrack(track.id, userId);
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

export async function pushRecentlyPlayed(
  trackId: string,
  userId: string | null,
  durationSec = 0,
): Promise<void> {
  const now = new Date().toISOString();
  const arr = readRecentLocal().filter((r) => r.track_id !== trackId);
  arr.unshift({ track_id: trackId, played_at: now, play_duration_sec: durationSec });
  writeRecentLocal(arr);

  if (!userId) return;
  const { error } = await supabase.from('recently_played_tracks').insert({
    user_id: userId,
    session_id: getSessionId(),
    track_id: trackId,
    play_duration_sec: durationSec,
  });
  // 에러는 무시 (테이블 미적용일 수 있음)
  void error;
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
      .limit(limit * 3);
    if (error) throw error;
    const rows = (data ?? []) as unknown as Array<{ played_at: string; tracks: TrackRow }>;
    const seen = new Set<string>();
    const out: TrackRow[] = [];
    for (const r of rows) {
      if (!r.tracks || seen.has(r.tracks.id)) continue;
      seen.add(r.tracks.id);
      out.push(r.tracks);
      if (out.length >= limit) break;
    }
    if (out.length === 0) {
      // DB 비어있으면 로컬 fallback
      return fetchRecentlyPlayedTracks(null, limit);
    }
    return applyDemoMode(out);
  } catch {
    return fetchRecentlyPlayedTracks(null, limit);
  }
}

/* ============================================
 * 이어듣기
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
  const { error } = await supabase.from('continue_listening').upsert(
    {
      user_id: userId,
      track_id: trackId,
      position_sec: Math.floor(positionSec),
      duration_sec: durationSec,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,track_id' },
  );
  void error;
}

export async function clearContinueListening(
  trackId: string,
  userId: string | null,
): Promise<void> {
  writeContinueLocal(null);
  if (!userId) return;
  const { error } = await supabase
    .from('continue_listening')
    .delete()
    .match({ user_id: userId, track_id: trackId });
  void error;
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
    if (!data) return readContinueLocal();
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
 * 라이브러리 한 번에 + 추천
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
  // 항상 RPC + 개별 fetch 결과를 union 해서 가장 풍부한 데이터 반환
  const [liked, recent, cont] = await Promise.all([
    fetchLikedTracks(userId),
    fetchRecentlyPlayedTracks(userId, 20),
    fetchContinueListening(userId),
  ]);

  let recommended: PlaylistRow[] = [];
  if (userId) {
    try {
      const { data } = await supabase.rpc('get_library_overview', {
        limit_recent: 1,
      });
      const r = (data ?? {}) as { recommended_playlists?: PlaylistRow[] };
      recommended = r.recommended_playlists ?? [];
    } catch {
      /* noop */
    }
  }

  return {
    liked_tracks: liked,
    recently_played: recent,
    continue: cont,
    recommended_playlists: recommended,
  };
}

/* ============================================
 * 로그인 시 localStorage → DB 머지 (best effort)
 * ============================================ */

export async function mergeLocalToDb(userId: string): Promise<void> {
  const local = readLikedLocal();
  if (local.length > 0) {
    const payload = local.map((s) => ({ user_id: userId, track_id: s.id }));
    const { error } = await supabase
      .from('liked_tracks')
      .upsert(payload, { onConflict: 'user_id,track_id' });
    void error;
  }
  const cont = readContinueLocal();
  if (cont) {
    const { error } = await supabase.from('continue_listening').upsert(
      {
        user_id: userId,
        track_id: cont.track_id,
        position_sec: cont.position_sec,
        duration_sec: cont.duration_sec ?? null,
        updated_at: cont.updated_at,
      },
      { onConflict: 'user_id,track_id' },
    );
    void error;
  }
}
