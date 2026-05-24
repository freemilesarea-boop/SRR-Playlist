import { supabase } from './supabase';

export interface Option { value: string; label: string; }

/**
 * 장르 그룹 — UI collapse/expand + 검색용. value 는 표준 태그(소문자 비교로 플리 genre_tags 와 매칭).
 * DB 는 자유 텍스트(enum/CHECK 없음)라 additive 확장이 안전하며, 추천 엔진은 genre_tags overlap +
 * main_genre 매칭으로 즉시 활용한다.
 */
export const GENRE_GROUPS: { label: string; genres: string[] }[] = [
  { label: 'K-콘텐츠', genres: ['K-POP', 'K-R&B', 'K-HipHop', 'Trot', 'OST', 'Ballad'] },
  { label: '팝 / 록', genres: ['POP', 'Retro Pop', 'Rock', 'Alternative', 'Indie Pop', 'Indie Rock', 'Band', 'Disco'] },
  { label: 'J / 애니 / 게임', genres: ['J-Pop', 'J-Rock', 'Anime', 'Game Music'] },
  { label: '힙합 / R&B / 소울', genres: ['Hip-Hop', 'R&B', 'Soul', 'Blues', 'Funk', 'Gospel'] },
  { label: '일렉트로닉', genres: ['Electronic', 'House', 'Synthwave', 'Drum & Bass', 'UK Garage', 'Phonk'] },
  { label: '로파이 / 칠', genres: ['Lo-fi', 'Chillhop', 'Jazzhop', 'Lounge', 'City Pop'] },
  { label: '재즈 / 어쿠스틱 / 클래식', genres: ['Jazz', 'Acoustic', 'Folk', 'Classical', 'Piano', 'Instrumental'] },
  { label: '무드 / 휴식', genres: ['Ambient', 'Meditation', 'Sleep', 'Cafe Music'] },
  { label: '월드', genres: ['Latin', 'Reggaeton', 'Afrobeats'] },
];

/** 장르 (복수, 최대 3) — 그룹에서 평탄화(중복 제거). */
export const GENRE_OPTIONS: Option[] = Array.from(
  new Set(GENRE_GROUPS.flatMap((g) => g.genres)),
).map((g) => ({ value: g, label: g }));

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

/** 보컬 타입 (단일) — 추천/큐레이션 해상도용 세분화. */
export const VOCAL_OPTIONS: Option[] = [
  { value: 'male_vocal', label: '남성 보컬' },
  { value: 'female_vocal', label: '여성 보컬' },
  { value: 'mixed_vocal', label: '혼성' },
  { value: 'instrumental', label: '인스트루멘탈' },
  { value: 'chorus', label: '코러스 중심' },
  { value: 'rap', label: '랩 중심' },
];

/** 언어권 (단일, 선택). 추천/차트 필터 활용 대비. */
export const LANGUAGE_OPTIONS: Option[] = [
  { value: 'ko', label: '한국어' },
  { value: 'en', label: '영어' },
  { value: 'ja', label: '일본어' },
  { value: 'zh', label: '중국어' },
  { value: 'instrumental', label: '무언어/허밍' },
  { value: 'multi', label: '다국어' },
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
  /** 언어권 (선택) */
  language?: string;
}

export function emptySelectedMeta(): SelectedMeta {
  return { genre_tags: [], mood_tags: [], business_type_tags: [], vocal_type: '', recommended_dayparts: [], language: '' };
}

/** 제출 전 검증 — 누락 시 메시지 반환, 통과 시 null. (언어는 선택 항목 — 검증 제외) */
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
    p_language: m.language || null,
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
    language: (d.language as string) ?? '',
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
    p_language: m.language || null,
  });
  if (error) throw error;
}
