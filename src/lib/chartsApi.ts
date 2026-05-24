import { supabase } from './supabase';
import { applyDemoMode } from './demoMode';
import type { TrackRow } from '@/types/db';

export type ChartPeriod = 'daily' | 'weekly' | 'monthly' | 'all';

export interface ChartTrack {
  rank: number;
  track_id: string;
  title: string;
  artist: string | null;
  genre: string | null;
  mood: string | null;
  cover_url: string | null;
  audio_url: string;
  duration: number | null;
  play_count: number;
  completed_count: number;
  total_listened_seconds: number;
  playlist_count?: number;
}

export interface GenreSummary {
  genre: string;
  play_count: number;
  track_count: number;
  total_listened_seconds: number;
}

/**
 * 차트 데이터가 없을 때 fallback 으로 사용할 추천 트랙.
 * tracks 테이블에서 직접 가져와서 가짜 rank/0 카운트를 채워 반환.
 */
async function fetchFallbackTracks(limit: number): Promise<ChartTrack[]> {
  const { data, error } = await supabase
    .from('tracks')
    .select('id, title, artist, genre, mood, cover_url, audio_url, duration, created_at')
    // 공개 노출 기준 — removed/hidden/자켓없음 제외 (관리자 전체 SELECT 우회 방어 포함)
    .eq('visibility_status', 'approved')
    .is('removed_at', null)
    .not('cover_url', 'is', null)
    .not('audio_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as (TrackRow & { created_at: string })[];
  const enriched = applyDemoMode(rows);
  return enriched.map((t, i) => ({
    rank: i + 1,
    track_id: t.id,
    title: t.title,
    artist: t.artist,
    genre: t.genre,
    mood: t.mood,
    cover_url: t.cover_url,
    audio_url: t.audio_url,
    duration: t.duration,
    play_count: 0,
    completed_count: 0,
    total_listened_seconds: 0,
  }));
}

export interface ChartResult {
  tracks: ChartTrack[];
  isFallback: boolean;
}

export async function fetchTrackChart(
  period: ChartPeriod,
  limit = 100,
): Promise<ChartResult> {
  try {
    const { data, error } = await supabase.rpc('get_track_chart', {
      period,
      limit_count: limit,
    });
    if (error) throw error;
    const rows = (data ?? []) as ChartTrack[];
    if (rows.length > 0) {
      // 데모 모드면 빈 audio_url 채워주기
      const enriched = applyDemoMode(rows);
      return { tracks: enriched as ChartTrack[], isFallback: false };
    }
    // 데이터 0 → fallback
    const fallback = await fetchFallbackTracks(limit);
    return { tracks: fallback, isFallback: true };
  } catch {
    // RPC 미적용 등 — fallback
    const fallback = await fetchFallbackTracks(limit);
    return { tracks: fallback, isFallback: true };
  }
}

export async function fetchTrackChartByGenre(
  genre: string,
  period: ChartPeriod,
  limit = 50,
): Promise<ChartResult> {
  try {
    const { data, error } = await supabase.rpc('get_track_chart_by_genre', {
      genre_filter: genre,
      period,
      limit_count: limit,
    });
    if (error) throw error;
    const rows = (data ?? []) as ChartTrack[];
    if (rows.length > 0) {
      const enriched = applyDemoMode(rows);
      return { tracks: enriched as ChartTrack[], isFallback: false };
    }
    // fallback — 해당 장르 트랙 직접 조회
    const { data: t, error: terr } = await supabase
      .from('tracks')
      .select('id, title, artist, genre, mood, cover_url, audio_url, duration, created_at')
      .eq('visibility_status', 'approved')
      .is('removed_at', null)
      .not('cover_url', 'is', null)
      .not('audio_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (terr) throw terr;
    const all = (t ?? []) as (TrackRow & { created_at: string })[];
    const filtered =
      genre === '기타'
        ? all.filter((x) => !x.genre || x.genre.trim() === '')
        : all.filter((x) => x.genre === genre);
    const enriched = applyDemoMode(filtered);
    return {
      tracks: enriched.map((x, i) => ({
        rank: i + 1,
        track_id: x.id,
        title: x.title,
        artist: x.artist,
        genre: x.genre,
        mood: x.mood,
        cover_url: x.cover_url,
        audio_url: x.audio_url,
        duration: x.duration,
        play_count: 0,
        completed_count: 0,
        total_listened_seconds: 0,
      })),
      isFallback: true,
    };
  } catch {
    return { tracks: [], isFallback: true };
  }
}

export async function fetchGenreChart(period: ChartPeriod): Promise<GenreSummary[]> {
  try {
    const { data, error } = await supabase.rpc('get_genre_chart', { period });
    if (error) throw error;
    return (data ?? []) as GenreSummary[];
  } catch {
    return [];
  }
}

export async function fetchGenres(): Promise<GenreSummary[]> {
  try {
    const { data, error } = await supabase.rpc('list_genres');
    if (error) throw error;
    return (data ?? []) as GenreSummary[];
  } catch {
    // RPC 미적용 fallback — tracks 직접 조회 후 distinct
    const { data } = await supabase.from('tracks').select('genre');
    const rows = (data ?? []) as Array<{ genre: string | null }>;
    const counts = new Map<string, number>();
    for (const r of rows) {
      const g = r.genre?.trim() || '기타';
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([genre, track_count]) => ({
        genre,
        track_count,
        play_count: 0,
        total_listened_seconds: 0,
      }))
      .sort((a, b) => a.genre.localeCompare(b.genre));
  }
}

export function chartTrackToTrackRow(c: ChartTrack): TrackRow {
  return {
    id: c.track_id,
    title: c.title,
    artist: c.artist,
    genre: c.genre,
    mood: c.mood,
    audio_url: c.audio_url,
    cover_url: c.cover_url,
    duration: c.duration,
    created_at: new Date().toISOString(),
  };
}
