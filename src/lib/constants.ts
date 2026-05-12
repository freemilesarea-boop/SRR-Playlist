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
    tagline: '가볍게 시작',
    features: ['기본 플레이리스트 일부 감상', '모바일 재생', '광고 포함'],
    excluded: ['좋아요 / 보관함', '프리미엄 감성 플리', '매장 모드'],
  },
  {
    key: 'personal' as const,
    name: '일반',
    price: 4900,
    tagline: '내 일상에',
    features: [
      '광고 제거',
      '무제한 감상',
      '좋아요 / 보관함',
      '프리미엄 감성 플리',
      '오프라인 저장 (예정)',
    ],
    excluded: ['매장 모드', '업종별 추천'],
  },
  {
    key: 'business' as const,
    name: '사업자',
    price: 6900,
    tagline: '매장에서 그대로',
    features: [
      '일반 플랜 모든 기능 포함',
      '매장 모드 (화면 꺼짐 방지)',
      '시간대 자동 추천',
      '업종별 추천 플레이리스트',
      '장시간 재생 최적화',
      '직원 공유 (예정)',
    ],
    excluded: [],
  },
];
