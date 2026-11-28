/**
 * deviceClass.ts — 지금 이 기기가 폰이냐 태블릿이냐.
 *
 * 이 앱 하나가 네 종류의 기기에서 돈다: 안드로이드 폰 · 아이폰 · 안드로이드 태블릿 · 아이패드.
 * 그런데 지금까지 코드에는 그걸 구분하는 수단이 CSS 브레이크포인트밖에 없었다. 그래서
 * "매장 계정이면 앱을 켤 때 바로 전체화면 플레이어로" 같은 규칙이 폰에서도 그대로 걸렸다 —
 * 점주가 자기 폰에서 앱을 열면 검색도 홈도 못 보고 플레이어만 떴다.
 *
 * 판정은 짧은 변의 길이로 한다. 가로/세로를 돌려도 기기 종류는 안 바뀌기 때문이다.
 * (innerWidth 만 보면 폰을 가로로 눕혔을 때 태블릿으로 잘못 읽는다.)
 */

/**
 * 태블릿으로 볼 짧은 변의 최소 길이(CSS px).
 *
 * 600 은 안드로이드의 sw600dp 관례를 따른 것이고, 실제 기기로도 잘 갈린다:
 *   아이폰 16 Pro Max  440 × 956  → 짧은 변 440 → 폰
 *   갤럭시 S24 Ultra   412 × 915  → 412 → 폰
 *   아이패드 미니       744 × 1133 → 744 → 태블릿
 *   매장 태블릿        1280 × 800 → 800 → 태블릿
 */
export const TABLET_MIN_SIDE = 600;

/** 화면 크기로 태블릿인지 판정. 두 변 중 짧은 쪽을 본다. */
export function isTabletSize(width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  return Math.min(width, height) >= TABLET_MIN_SIDE;
}

/** 지금 창 크기 기준 태블릿 여부. 브라우저 밖(SSR·테스트)에서는 false. */
export function currentDeviceIsTablet(): boolean {
  if (typeof window === 'undefined') return false;
  return isTabletSize(window.innerWidth, window.innerHeight);
}
