/**
 * storeTypeCanonical.ts — Phase AI-PLAYLIST-P0-HARDENING-1
 *
 * 매장 유형 canonical 정규화 (UI/클라이언트용).
 *
 * ⚠️ SSOT 는 DB 함수 `public._ai_canonical_store_type(text)` (migration 0462) 이다.
 *    런타임 guardrail 평가 정확성은 DB 함수가 최종 판정한다. 이 파일은 그 매핑을 "미러"한 것으로,
 *    프론트 표시/입력 정규화 용도이며 DB 함수와 동일한 결과를 내도록 유지한다(테스트로 고정).
 *    두 곳의 매핑이 갈라지지 않도록, 매핑 변경 시 SQL·TS 를 함께 수정한다.
 *
 * Unknown → 입력을 lower/trim 한 passthrough (특정 정상 유형으로 추정하지 않음). 빈값/null → null.
 */

/** 24 canonical 매장 유형. */
export type CanonicalStoreType =
  | 'cafe' | 'hospital' | 'select_shop' | 'hair_salon' | 'nail_shop'
  | 'korean_restaurant' | 'japanese_restaurant' | 'chinese_restaurant' | 'western_restaurant'
  | 'fine_dining' | 'izakaya' | 'restaurant' | 'pub' | 'wine_bar'
  | 'gym' | 'hotel' | 'office' | 'studio' | 'bookstore' | 'flower_shop' | 'showroom'
  | 'pilates' | 'yoga' | 'study_cafe' | 'pc_bang';

/** alias(소문자) → canonical. DB `_ai_canonical_store_type` 의 CASE 와 1:1 대응. */
const ALIAS_TO_CANONICAL: Record<string, CanonicalStoreType> = {
  // cafe
  cafe: 'cafe', '카페': 'cafe', coffee_shop: 'cafe', 'coffee shop': 'cafe',
  cafe_independent: 'cafe', cafe_franchise: 'cafe', brunch_cafe: 'cafe',
  // hospital
  hospital: 'hospital', '병원': 'hospital', '의원': 'hospital', '클리닉': 'hospital', clinic: 'hospital',
  // select shop
  select_shop: 'select_shop', '편집샵': 'select_shop', boutique: 'select_shop', '부티크': 'select_shop', clothing_store: 'select_shop',
  // hair salon (taxonomy 'beauty_shop' coarse → hair_salon; nail_shop distinct)
  hair_salon: 'hair_salon', salon: 'hair_salon', '미용실': 'hair_salon', '헤어샵': 'hair_salon', beauty_shop: 'hair_salon', '뷰티샵': 'hair_salon',
  // nail shop
  nail_shop: 'nail_shop', '네일샵': 'nail_shop', nail: 'nail_shop',
  // restaurants
  korean_restaurant: 'korean_restaurant', '한식': 'korean_restaurant', '한식당': 'korean_restaurant',
  japanese_restaurant: 'japanese_restaurant', '일식': 'japanese_restaurant',
  chinese_restaurant: 'chinese_restaurant', '중식': 'chinese_restaurant',
  western_restaurant: 'western_restaurant', '양식': 'western_restaurant',
  fine_dining: 'fine_dining', '파인다이닝': 'fine_dining', '다이닝': 'fine_dining',
  izakaya: 'izakaya', '이자카야': 'izakaya',
  restaurant: 'restaurant', '식당': 'restaurant', '레스토랑': 'restaurant', '술집': 'restaurant',
  // bars
  pub: 'pub', '펍': 'pub',
  wine_bar: 'wine_bar', winebar: 'wine_bar', '와인바': 'wine_bar', cocktail_bar: 'wine_bar', '칵테일바': 'wine_bar', '라운지바': 'wine_bar',
  // gym
  gym: 'gym', fitness: 'gym', '헬스장': 'gym', '피트니스': 'gym', '짐': 'gym',
  // hotel
  hotel: 'hotel', hotel_lobby: 'hotel', '호텔': 'hotel', '라운지': 'hotel', lounge: 'hotel',
  // office
  office: 'office', '사무실': 'office', coworking: 'office', '코워킹': 'office',
  // studio
  studio: 'studio', '스튜디오': 'studio',
  // bookstore
  bookstore: 'bookstore', '서점': 'bookstore', '책방': 'bookstore',
  // flower shop
  flower_shop: 'flower_shop', '화원': 'flower_shop', '플라워샵': 'flower_shop', '꽃집': 'flower_shop',
  // showroom
  showroom: 'showroom', '쇼룸': 'showroom',
  // pilates / yoga
  pilates: 'pilates', '필라테스': 'pilates',
  yoga: 'yoga', '요가': 'yoga',
  // study cafe
  study_cafe: 'study_cafe', '스터디카페': 'study_cafe', studycafe: 'study_cafe',
  // pc bang
  pc_bang: 'pc_bang', 'pc방': 'pc_bang', '피시방': 'pc_bang', pcroom: 'pc_bang', pc_room: 'pc_bang', internet_cafe: 'pc_bang',
};

/**
 * 매장 유형 canonical 정규화.
 *   - 알려진 alias(한국어/영어/legacy/taxonomy/guardrail-key) → canonical.
 *   - unknown → lower/trim passthrough (동일 키에만 매칭됨; 잘못된 추정 없음).
 *   - null/빈값 → null.
 */
export function canonicalStoreType(raw: string | null | undefined): string | null {
  const key = (raw ?? '').trim().toLowerCase();
  if (!key) return null;
  return ALIAS_TO_CANONICAL[key] ?? key;
}

/** 24 canonical 집합(테스트/검증용). */
export const CANONICAL_STORE_TYPES: CanonicalStoreType[] = [
  'cafe', 'hospital', 'select_shop', 'hair_salon', 'nail_shop',
  'korean_restaurant', 'japanese_restaurant', 'chinese_restaurant', 'western_restaurant',
  'fine_dining', 'izakaya', 'restaurant', 'pub', 'wine_bar',
  'gym', 'hotel', 'office', 'studio', 'bookstore', 'flower_shop', 'showroom',
  'pilates', 'yoga', 'study_cafe', 'pc_bang',
];
