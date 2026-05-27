import { supabase } from './supabase';
import type { TrackRow } from '@/types/db';
import { applyDemoMode } from './demoMode';

export interface PreviewCategory {
  key: string;
  businessType: string;
  title: string;
  genre: string;
  mood: string[];
  description: string;
  /** 그라데이션/테마 시드 */
  theme: string;
  /** 추후 관리자에서 연결할 실제 playlist id (현재 null → 샘플 준비 중) */
  playlistId?: string | null;
}

/**
 * 업종별 미리듣기 카테고리 (config 기반 시작).
 * 추후 관리자에서 playlist_id 연결/노출토글/순서변경 가능하도록 구조화.
 */
export const PREVIEW_CATEGORIES: PreviewCategory[] = [
  {
    key: 'hospital_ambience',
    businessType: '병원',
    title: '병원 · 차분한 엠비언스',
    genre: 'Ambience',
    mood: ['차분함', '안정감', '저자극'],
    description: '대기실과 진료 공간에 어울리는 부드러운 엠비언스 BGM',
    theme: '#3b82f6',
  },
  {
    key: 'cafe_lofi',
    businessType: '카페',
    title: '카페 · 로파이 무드',
    genre: 'Lo-fi',
    mood: ['따뜻함', '편안함', '집중'],
    description: '오전과 오후 카페 분위기에 어울리는 로파이 플레이리스트',
    theme: '#f59e0b',
  },
  {
    key: 'selectshop_pop_instrumental',
    businessType: '편집샵',
    title: '편집샵 · 팝 인스트루멘탈',
    genre: 'Pop Instrumental',
    mood: ['감각적', '트렌디', '세련됨'],
    description: '브랜드 공간의 분위기를 살리는 감각적인 팝 인스트루멘탈',
    theme: '#a855f7',
  },
  {
    key: 'salon_kpop_pop',
    businessType: '미용실',
    title: '미용실 · 트렌디 K-POP & POP',
    genre: 'K-POP / POP',
    mood: ['트렌디', '밝음', '세련됨'],
    description: '시술 시간 동안 부담 없이 들을 수 있는 트렌디한 음악',
    theme: '#ec4899',
  },
  {
    key: 'restaurant_kpop',
    businessType: '음식점',
    title: '음식점 · 캐주얼 K-POP',
    genre: 'K-POP',
    mood: ['대중적', '밝음', '활기'],
    description: '식사 분위기를 해치지 않으면서도 매장에 활기를 주는 음악',
    theme: '#10b981',
  },
];

export interface PreviewStatus {
  is_authenticated: boolean;
  is_admin: boolean;
  is_business: boolean;
  used: number;
  limit: number;
  remaining: number;
  can_preview: boolean;
  reason: string;
}

export async function getBusinessPreviewStatus(): Promise<PreviewStatus> {
  const { data, error } = await supabase.rpc('get_business_preview_status');
  if (error || !data) {
    return { is_authenticated: false, is_admin: false, is_business: false, used: 0, limit: 2, remaining: 0, can_preview: false, reason: 'error' };
  }
  return data as PreviewStatus;
}

export interface RecordResult {
  allowed: boolean;
  reason: string;
  used?: number;
  remaining?: number;
  limit?: number;
}

export async function recordBusinessPreviewPlay(category: string, playlistId?: string | null): Promise<RecordResult> {
  const { data, error } = await supabase.rpc('record_business_preview_play', {
    p_category: category, p_playlist_id: playlistId ?? null,
  });
  if (error) return { allowed: false, reason: error.message };
  return data as RecordResult;
}

/** 해당 업종에 어울리는 실제 재생 가능 음원 1트랙(샘플) 조회. 없으면 null → "샘플 준비 중". */
export async function fetchPreviewSampleTracks(businessType: string, limit = 20): Promise<TrackRow[]> {
  try {
    const { data, error } = await supabase
      .from('tracks')
      .select('id, title, artist, genre:main_genre, mood, audio_url, cover_url, duration, created_at')
      .eq('release_status', 'released')
      .eq('suitable_store', businessType)
      .not('audio_url', 'is', null)
      .limit(limit);
    if (error) return [];
    const rows = (data ?? []) as TrackRow[];
    return applyDemoMode(rows).filter((t) => (t.audio_url ?? '').trim().length > 0);
  } catch {
    return [];
  }
}
