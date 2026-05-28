import { supabase } from './supabase';
import { applyDemoMode } from './demoMode';
import { getSessionId } from './analytics';
import type { TrackRow } from '@/types/db';

export type SearchResultType = 'track' | 'playlist' | 'user_playlist' | 'curator' | 'genre' | 'mood' | 'category';

export interface SearchResult {
  result_type: SearchResultType;
  id: string | null;
  title: string;
  subtitle: string | null;
  image_url: string | null;
  audio_url: string | null;
  genre: string | null;
  mood: string | null;
  category: string | null;
  rank_score: number;
  play_count: number | null;
}

export interface GroupedResults {
  tracks: SearchResult[];
  playlists: SearchResult[];
  userPlaylists: SearchResult[];
  curators: SearchResult[];
  genres: SearchResult[];
  moods: SearchResult[];
  categories: SearchResult[];
}

const RECENT_KEY = 'srr-recent-searches';
const RECENT_MAX = 10;

export const QUICK_KEYWORDS = [
  '카페',
  '드라이브',
  '공부',
  '운동',
  '수면',
  '재즈',
  '로파이',
  '감성',
  '새벽',
  '매장',
] as const;

export const HARDCODED_POPULAR = [
  '카페',
  '새벽',
  '드라이브',
  '공부',
  '운동',
  '수면',
  '재즈',
  '로파이',
  '감성',
  '매장',
] as const;

/* ---------- 최근 검색어 ---------- */

export function getRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as string[]).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function saveRecentSearch(query: string): void {
  const q = query.trim();
  if (!q) return;
  try {
    const prev = getRecentSearches().filter((s) => s.toLowerCase() !== q.toLowerCase());
    const next = [q, ...prev].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* noop */
  }
}

export function clearRecentSearches(): void {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    /* noop */
  }
}

/* ---------- 인기 검색어 ---------- */

export async function fetchTopSearches(limit = 10): Promise<string[]> {
  try {
    const { data, error } = await supabase.rpc('top_searches', { limit_count: limit });
    if (error) throw error;
    const rows = (data ?? []) as Array<{ query: string; hits: number }>;
    if (rows.length === 0) return [...HARDCODED_POPULAR].slice(0, limit);
    return rows.map((r) => r.query).slice(0, limit);
  } catch {
    return [...HARDCODED_POPULAR].slice(0, limit);
  }
}

/* ---------- 검색 ---------- */

export interface SearchOutcome {
  query: string;
  total: number;
  groups: GroupedResults;
  isFallback: boolean;
}

function emptyGroups(): GroupedResults {
  return { tracks: [], playlists: [], userPlaylists: [], curators: [], genres: [], moods: [], categories: [] };
}

function groupResults(rows: SearchResult[]): GroupedResults {
  const g = emptyGroups();
  for (const r of rows) {
    if (r.result_type === 'track') g.tracks.push(r);
    else if (r.result_type === 'playlist') g.playlists.push(r);
    else if (r.result_type === 'user_playlist') g.userPlaylists.push(r);
    else if (r.result_type === 'curator') g.curators.push(r);
    else if (r.result_type === 'genre') g.genres.push(r);
    else if (r.result_type === 'mood') g.moods.push(r);
    else if (r.result_type === 'category') g.categories.push(r);
  }
  return g;
}

export async function searchCatalog(query: string, limit = 30): Promise<SearchOutcome> {
  const q = query.trim();
  if (!q) {
    return { query: q, total: 0, groups: emptyGroups(), isFallback: false };
  }

  try {
    const { data, error } = await supabase.rpc('search_catalog', {
      search_query: q,
      limit_count: limit,
    });
    if (error) throw error;
    const rows = (data ?? []) as SearchResult[];
    // 데모 모드 — 트랙만 audio_url 보강
    const enrichedTracks = applyDemoMode(
      rows
        .filter((r) => r.result_type === 'track')
        .map((r) => ({ audio_url: r.audio_url ?? '' })),
    );
    let i = 0;
    const enriched = rows.map((r) => {
      if (r.result_type !== 'track') return r;
      const url = enrichedTracks[i]?.audio_url ?? r.audio_url;
      i += 1;
      return { ...r, audio_url: url };
    });
    return { query: q, total: enriched.length, groups: groupResults(enriched), isFallback: false };
  } catch {
    // RPC 미적용 fallback — 클라이언트에서 tracks/playlists 직접 필터
    return fallbackSearch(q, limit);
  }
}

async function fallbackSearch(q: string, limit: number): Promise<SearchOutcome> {
  const like = `%${q.toLowerCase()}%`;
  try {
    const [tRes, pRes] = await Promise.all([
      supabase
        .from('tracks')
        .select('id, title, artist, genre:main_genre, mood, cover_url, audio_url, duration, created_at')
        .eq('visibility_status', 'approved')
        .is('removed_at', null)
        .not('cover_url', 'is', null)
        .not('audio_url', 'is', null)
        .or(`title.ilike.${like},artist.ilike.${like},main_genre.ilike.${like},mood.ilike.${like}`)
        .limit(limit),
      supabase
        .from('playlists')
        .select('id, title, category, thumbnail_url, description, business_category')
        .or(`title.ilike.${like},category.ilike.${like},description.ilike.${like}`)
        .limit(limit),
    ]);
    const tracks = ((tRes.data ?? []) as TrackRow[]).map(
      (t): SearchResult => ({
        result_type: 'track',
        id: t.id,
        title: t.title,
        subtitle: t.artist,
        image_url: t.cover_url,
        audio_url: t.audio_url,
        genre: t.genre,
        mood: t.mood,
        category: null,
        rank_score: 50,
        play_count: null,
      }),
    );
    const playlists = ((pRes.data ?? []) as Array<{
      id: string;
      title: string;
      category: string;
      thumbnail_url: string | null;
      description: string | null;
    }>).map(
      (p): SearchResult => ({
        result_type: 'playlist',
        id: p.id,
        title: p.title,
        subtitle: p.description,
        image_url: p.thumbnail_url,
        audio_url: null,
        genre: null,
        mood: null,
        category: p.category,
        rank_score: 50,
        play_count: null,
      }),
    );
    return {
      query: q,
      total: tracks.length + playlists.length,
      groups: { ...emptyGroups(), tracks, playlists },
      isFallback: true,
    };
  } catch {
    return { query: q, total: 0, groups: emptyGroups(), isFallback: true };
  }
}

/* ---------- 검색 이벤트 기록 (실패해도 무시) ---------- */

export async function logSearchEvent(query: string, resultCount: number, userId: string | null) {
  const q = query.trim();
  if (!q) return;
  try {
    await supabase.from('search_events').insert({
      user_id: userId,
      session_id: getSessionId(),
      query: q,
      result_count: resultCount,
    });
  } catch {
    /* noop */
  }
}

/* ---------- 검색 결과 → TrackRow (player queue 변환) ---------- */

export function searchTrackToTrackRow(r: SearchResult): TrackRow | null {
  if (r.result_type !== 'track' || !r.id) return null;
  return {
    id: r.id,
    title: r.title,
    artist: r.subtitle,
    genre: r.genre,
    mood: r.mood,
    audio_url: r.audio_url ?? '',
    cover_url: r.image_url,
    duration: null,
    created_at: new Date().toISOString(),
  };
}
