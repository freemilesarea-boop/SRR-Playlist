import { supabase } from './supabase';

export interface Option { value: string; label: string; }

/** 장르 (복수, 최대 3). value 는 표준 태그(소문자 비교로 플리 genre_tags 와 매칭). */
export const GENRE_OPTIONS: Option[] = [
  'K-POP','POP','R&B','Hip-Hop','Lo-fi','Jazz','Acoustic','Ballad',
  'Electronic','Ambient','House','Funk','City Pop','Instrumental','Classical',
].map((g) => ({ value: g, label: g }));

/** 분위기/무드 (복수, 최대 5) */
export const MOOD_OPTIONS: Option[] = [
  '차분한','밝은','고급스러운','트렌디한','따뜻한','몽환적인','감각적인',
  '활기찬','로맨틱한','집중되는','편안한','세련된','저자극','신나는',
].map((m) => ({ value: m, label: m }));

/** 추천 매장/업종 (복수, 최대 5). value 는 플리 business_category 와 정렬되도록 정규화. */
export const BUSINESS_OPTIONS: Option[] = [
  { value: '병원', label: '병원/클리닉' },
  { value: '카페', label: '카페' },
  { value: '편집샵', label: '편집샵' },
  { value: '미용실', label: '미용실' },
  { value: '식당', label: '음식점' },
  { value: '와인바', label: '와인바' },
  { value: '헬스장', label: '헬스장' },
  { value: '호텔', label: '호텔/라운지' },
  { value: '사무실', label: '사무실' },
  { value: '네일샵', label: '네일샵' },
  { value: '스튜디오', label: '스튜디오' },
  { value: '서점', label: '서점' },
  { value: '플라워샵', label: '플라워샵' },
  { value: '쇼룸', label: '쇼룸' },
];

/** 보컬 여부 (단일) */
export const VOCAL_OPTIONS: Option[] = [
  { value: 'vocal', label: '보컬 있음' },
  { value: 'instrumental', label: '인스트루멘탈' },
  { value: 'low_vocal', label: '보컬 적음' },
  { value: 'chorus', label: '코러스/허밍 중심' },
];

/** 추천 시간대 (복수, 최대 3). value 는 플리 daypart 와 매칭. */
export const DAYPART_OPTIONS: Option[] = [
  { value: 'morning', label: '오전' },
  { value: 'lunch', label: '점심' },
  { value: 'afternoon', label: '오후' },
  { value: 'evening', label: '저녁' },
  { value: 'late', label: '심야' },
  { value: 'all', label: '전체 시간대' },
];

export const META_CAPS = { genre: 3, mood: 5, business: 5, daypart: 3 } as const;

export interface SelectedMeta {
  genre_tags: string[];
  mood_tags: string[];
  business_type_tags: string[];
  vocal_type: string;
  recommended_dayparts: string[];
}

export function emptySelectedMeta(): SelectedMeta {
  return { genre_tags: [], mood_tags: [], business_type_tags: [], vocal_type: '', recommended_dayparts: [] };
}

/** 제출 전 검증 — 누락 시 메시지 반환, 통과 시 null */
export function validateSelectedMeta(m: SelectedMeta): string | null {
  if (m.genre_tags.length === 0) return '장르를 1개 이상 선택해주세요';
  if (m.genre_tags.length > META_CAPS.genre) return `장르는 최대 ${META_CAPS.genre}개`;
  if (m.mood_tags.length === 0) return '분위기를 1개 이상 선택해주세요';
  if (m.mood_tags.length > META_CAPS.mood) return `분위기는 최대 ${META_CAPS.mood}개`;
  if (m.business_type_tags.length === 0) return '추천 매장을 1개 이상 선택해주세요';
  if (m.business_type_tags.length > META_CAPS.business) return `추천 매장은 최대 ${META_CAPS.business}개`;
  if (!m.vocal_type) return '보컬 유형을 선택해주세요';
  if (m.recommended_dayparts.length === 0) return '추천 시간대를 1개 이상 선택해주세요';
  if (m.recommended_dayparts.length > META_CAPS.daypart) return `추천 시간대는 최대 ${META_CAPS.daypart}개`;
  return null;
}

export function labelFor(options: Option[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

export async function setTrackSelectedMetadata(trackId: string, m: SelectedMeta): Promise<void> {
  const { error } = await supabase.rpc('set_track_selected_metadata', {
    p_track_id: trackId,
    p_genre_tags: m.genre_tags,
    p_mood_tags: m.mood_tags,
    p_business_type_tags: m.business_type_tags,
    p_vocal_type: m.vocal_type,
    p_dayparts: m.recommended_dayparts,
  });
  if (error) throw error;
}

export async function adminGetTrackTags(trackId: string): Promise<SelectedMeta & { title?: string; metadata_source?: string }> {
  const { data, error } = await supabase.rpc('admin_get_track_tags', { p_track_id: trackId });
  if (error || !data) return { ...emptySelectedMeta() };
  const d = data as Record<string, unknown>;
  return {
    title: (d.title as string) ?? '',
    genre_tags: (d.genre_tags as string[]) ?? [],
    mood_tags: (d.mood_tags as string[]) ?? [],
    business_type_tags: (d.business_type_tags as string[]) ?? [],
    vocal_type: (d.vocal_type as string) ?? '',
    recommended_dayparts: (d.recommended_dayparts as string[]) ?? [],
    metadata_source: (d.metadata_source as string) ?? '',
  };
}

export async function adminUpdateTrackTags(trackId: string, m: SelectedMeta): Promise<void> {
  const { error } = await supabase.rpc('admin_update_track_tags', {
    p_track_id: trackId,
    p_genre_tags: m.genre_tags,
    p_mood_tags: m.mood_tags,
    p_business_type_tags: m.business_type_tags,
    p_vocal_type: m.vocal_type,
    p_dayparts: m.recommended_dayparts,
  });
  if (error) throw error;
}
