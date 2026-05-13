/**
 * 추천 엔진용 분류 체계.
 * 트랙 메타데이터 입력 / 추천 컨텍스트 / 관리자 테스트에서 공통 사용.
 */

export const MAIN_GENRES = [
  'lofi',
  'jazz',
  'bossa nova',
  'ambient',
  'classical',
  'pop',
  'rnb',
  'soul',
  'indie',
  'electronic',
  'house',
  'hip hop',
  'rock',
  'folk',
  'kpop',
  'instrumental',
] as const;
export type MainGenre = (typeof MAIN_GENRES)[number];

export const SUB_GENRES_BY_MAIN: Record<string, string[]> = {
  lofi: ['lofi hip hop', 'chillhop', 'lofi jazz', 'study lofi'],
  jazz: ['cool jazz', 'smooth jazz', 'jazz trio', 'fusion'],
  'bossa nova': ['classic bossa', 'modern bossa'],
  ambient: ['drone', 'space ambient', 'nature ambient'],
  classical: ['piano solo', 'string quartet', 'modern classical'],
  pop: ['indie pop', 'synth pop', 'dream pop'],
  rnb: ['neo soul', 'contemporary rnb', 'slow jam'],
  soul: ['classic soul', 'neo soul'],
  indie: ['indie folk', 'indie rock', 'dream pop'],
  electronic: ['downtempo', 'idm', 'edm', 'synthwave'],
  house: ['deep house', 'lounge house', 'tech house'],
  'hip hop': ['boom bap', 'trap', 'kpop hip hop'],
  rock: ['indie rock', 'alt rock', 'soft rock'],
  folk: ['acoustic', 'indie folk'],
  kpop: ['ballad', 'kpop dance', 'kpop indie'],
  instrumental: ['piano', 'guitar', 'cinematic'],
};

export const LYRIC_TYPES = [
  { value: 'instrumental', label: '연주곡' },
  { value: 'soft_vocal', label: '약한 보컬' },
  { value: 'vocal', label: '보컬' },
  { value: 'rap', label: '랩' },
  { value: 'none', label: '없음' },
] as const;
export type LyricType = (typeof LYRIC_TYPES)[number]['value'];

export const LANGUAGES = [
  { value: 'ko', label: '한국어' },
  { value: 'en', label: '영어' },
  { value: 'ja', label: '일본어' },
  { value: 'instrumental', label: '연주곡' },
  { value: 'other', label: '기타' },
] as const;

export const MOOD_TAGS = [
  'calm',
  'cozy',
  'romantic',
  'lonely',
  'bright',
  'energetic',
  'dreamy',
  'classy',
  'emotional',
  'chill',
  'melancholy',
  'happy',
  'mysterious',
  'warm',
  'sensual',
] as const;

export const MOOD_TAG_LABELS: Record<string, string> = {
  calm: '잔잔',
  cozy: '아늑',
  romantic: '로맨틱',
  lonely: '외로움',
  bright: '밝음',
  energetic: '에너지',
  dreamy: '몽환',
  classy: '클래시',
  emotional: '감성',
  chill: '칠',
  melancholy: '쓸쓸',
  happy: '행복',
  mysterious: '신비',
  warm: '따뜻',
  sensual: '관능',
};

export const SITUATION_TAGS = [
  'cafe',
  'drive',
  'study',
  'workout',
  'sleep',
  'winebar',
  'shop',
  'reading',
  'rainy_day',
  'night_walk',
  'morning',
  'dinner',
  'date',
  'travel',
] as const;

export const SITUATION_TAG_LABELS: Record<string, string> = {
  cafe: '카페',
  drive: '드라이브',
  study: '공부',
  workout: '운동',
  sleep: '수면',
  winebar: '와인바',
  shop: '쇼핑',
  reading: '독서',
  rainy_day: '비오는 날',
  night_walk: '밤 산책',
  morning: '아침',
  dinner: '저녁식사',
  date: '데이트',
  travel: '여행',
};

export const TIME_SLOT_TAGS = [
  'dawn',
  'morning',
  'afternoon',
  'evening',
  'night',
] as const;

export const TIME_SLOT_TAG_LABELS: Record<string, string> = {
  dawn: '새벽',
  morning: '아침',
  afternoon: '점심',
  evening: '저녁',
  night: '밤',
};

export const SEASON_TAGS = ['spring', 'summer', 'autumn', 'winter', 'all'] as const;
export const SEASON_TAG_LABELS: Record<string, string> = {
  spring: '봄',
  summer: '여름',
  autumn: '가을',
  winter: '겨울',
  all: '사계절',
};

export const BUSINESS_TAGS = [
  'cafe',
  'winebar',
  'pt',
  'pilates',
  'nailshop',
  'boutique',
  'study_cafe',
  'restaurant',
] as const;
export const BUSINESS_TAG_LABELS: Record<string, string> = {
  cafe: '카페',
  winebar: '와인바',
  pt: 'PT샵',
  pilates: '필라테스',
  nailshop: '네일샵',
  boutique: '편집샵',
  study_cafe: '스터디카페',
  restaurant: '식당',
};

export const ENERGY_LABELS: Record<number, string> = {
  1: '아주 잔잔',
  2: '잔잔',
  3: '중간',
  4: '활발',
  5: '강렬',
};

export const BRIGHTNESS_LABELS: Record<number, string> = {
  1: '아주 어두움',
  2: '어두움',
  3: '중간',
  4: '밝음',
  5: '아주 밝음',
};

export const VISIBILITY_OPTIONS = [
  { value: 'public', label: '전체 공개' },
  { value: 'business', label: '사업자 전용' },
  { value: 'private', label: '비공개' },
] as const;

export const COPYRIGHT_OPTIONS = [
  { value: 'owned', label: '자체 보유' },
  { value: 'licensed', label: '라이선스' },
  { value: 'unknown', label: '확인 필요' },
] as const;
