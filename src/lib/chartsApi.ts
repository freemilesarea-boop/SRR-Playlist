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
  like_count?: number;
  total_listened_seconds: number;
  playlist_count?: number;
}

export interface GenreSummary {
  genre: string;
  play_count: number;
  track_count: number;
  total_listened_seconds: number;
}

export interface ChartResult {
  tracks: ChartTrack[];
  isFallback: boolean;
}

/**
 * 차트는 스트리밍 수(30초+ 인정 재생) 기반. 0회 곡은 서버에서 제외된다.
 * 재생 기록이 없으면 0회 곡으로 채우지 않고 빈 결과를 반환 → UI 가 안내 문구 표시.
 * (신곡 추천은 차트에 섞지 않음)
 */
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
    if (rows.length === 0) return { tracks: [], isFallback: false };
    // 데모 모드면 빈 audio_url 채워주기 (순서/rank 는 서버 그대로 유지)
    const enriched = applyDemoMode(rows) as ChartTrack[];
    return { tracks: enriched, isFallback: false };
  } catch {
    return { tracks: [], isFallback: false };
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
    if (rows.length === 0) return { tracks: [], isFallback: false };
    const enriched = applyDemoMode(rows) as ChartTrack[];
    return { tracks: enriched, isFallback: false };
  } catch {
    return { tracks: [], isFallback: false };
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
    // RPC 미적용 fallback — tracks 직접 조회 후 distinct (차트 집계와 동일하게 main_genre 기준)
    const { data } = await supabase.from('tracks').select('main_genre');
    const rows = (data ?? []) as Array<{ main_genre: string | null }>;
    const counts = new Map<string, number>();
    for (const r of rows) {
      const g = r.main_genre?.trim() || '기타';
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
