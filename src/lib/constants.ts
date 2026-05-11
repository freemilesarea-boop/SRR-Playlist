export const PERSONAL_CATEGORIES = [
  { key: '새벽 감성', emoji: '🌙' },
  { key: '공부 집중', emoji: '📚' },
  { key: '카페 음악', emoji: '☕' },
  { key: '드라이브', emoji: '🚗' },
  { key: '운동', emoji: '🏃' },
  { key: '수면 음악', emoji: '😴' },
] as const;

export const BUSINESS_CATEGORIES = [
  { key: '카페', emoji: '☕' },
  { key: 'PT샵', emoji: '💪' },
  { key: '필라테스', emoji: '🧘' },
  { key: '와인바', emoji: '🍷' },
  { key: '네일샵', emoji: '💅' },
  { key: '편집샵', emoji: '🛍️' },
] as const;

export type PersonalCategory = (typeof PERSONAL_CATEGORIES)[number]['key'];
export type BusinessCategory = (typeof BUSINESS_CATEGORIES)[number]['key'];

export const SUBSCRIPTION_PLANS = [
  {
    key: 'free' as const,
    name: '무료',
    price: 0,
    features: ['기본 플레이리스트', '광고 포함', '모바일 재생'],
  },
  {
    key: 'personal' as const,
    name: '일반',
    price: 4900,
    features: ['전체 플레이리스트', '광고 없음', '오프라인 저장 (예정)'],
  },
  {
    key: 'business' as const,
    name: '사업자',
    price: 6900,
    features: ['사업자 모드 전체', '업종별 추천', '장시간 안정 재생', '화면 꺼짐 방지'],
  },
];
