// Phase BRAND-PLAYER-UX-1 — 브랜드 사이니지 슬라이드쇼 순수 로직.
// UI(admin)와 Player 의 전환 시간 단위 변환을 하나의 공통 함수로 통합한다.
// display_duration_seconds 는 DB/API 에 "초" 단위로 저장된다(admin 입력 min=1 max=600).

/** 잘못된 저장값(0/음수/NaN/null)에 사용할 서비스 기본값(초). admin add 기본값과 동일. */
export const DEFAULT_SLIDE_SECONDS = 10;
/** admin 설정 UI(min={1} max={600})와 동일한 허용 범위. */
export const MIN_SLIDE_SECONDS = 1;
export const MAX_SLIDE_SECONDS = 600;

/**
 * display_duration_seconds(초, DB/API 저장값) → 슬라이드 전환 지연 ms.
 * - 정상적인 양수: 그대로 사용(범위 clamp).
 * - 문자열: Number 변환 후 유효성 검사.
 * - 0 / 음수 / NaN / null / undefined: 기본값(DEFAULT_SLIDE_SECONDS) 사용.
 * 저장 단위가 이미 초이므로 seconds * 1000 (추가 곱셈 없음).
 */
export function resolveSlideDurationMs(seconds: unknown): number {
  const n = typeof seconds === 'number' ? seconds : Number(seconds);
  const valid = Number.isFinite(n) && n > 0 ? n : DEFAULT_SLIDE_SECONDS;
  const clamped = Math.min(Math.max(valid, MIN_SLIDE_SECONDS), MAX_SLIDE_SECONDS);
  return clamped * 1000;
}

/** out-of-range/음수 index 를 [0, count) 로 안전하게 정규화. count<=0 이면 0. */
export function normalizeSlideIndex(index: number, count: number): number {
  if (!Number.isFinite(index) || count <= 0) return 0;
  const m = Math.trunc(index) % count;
  return m < 0 ? m + count : m;
}

/** 다음 슬라이드 index (마지막 → 첫번째 순환). count<=1 이면 항상 0. */
export function nextSlideIndex(current: number, count: number): number {
  if (count <= 1) return 0;
  return normalizeSlideIndex(current + 1, count);
}

/** 자동 순환 타이머를 만들어야 하는가 — 이미지 2장 이상일 때만. */
export function shouldRunSlideshow(count: number): boolean {
  return count >= 2;
}
