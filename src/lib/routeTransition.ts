/**
 * routeTransition.ts — 화면이 바뀔 때 어느 방향으로 들어올지 정한다.
 *
 * 웹은 링크를 누르면 화면이 툭 바뀐다. 앱은 새 화면이 오른쪽에서 들어오고, 뒤로 가면
 * 왼쪽에서 들어온다. 이 방향 감각이 없으면 "내가 어디로 가고 있는지" 가 안 잡혀서
 * 아무리 레이아웃을 다듬어도 웹페이지처럼 읽힌다.
 *
 * 나가는 화면은 붙잡지 않고 들어오는 화면만 움직인다. 두 화면을 동시에 살려두려면
 * 라우트 트리를 복제해야 하는데, 그 대가(스크롤·포커스·재요청)가 얻는 것보다 크다.
 */

/** react-router 의 useNavigationType() 이 주는 값. */
export type RouteNavigationType = 'PUSH' | 'POP' | 'REPLACE';

export const PUSH_CLASS = 'app-route-push';
export const POP_CLASS = 'app-route-pop';

export interface RouteTransitionInput {
  navigationType: RouteNavigationType;
  /** 네이티브 앱인가. 웹에서는 전환 애니메이션을 넣지 않는다(브라우저 뒤로가기와 충돌). */
  native: boolean;
  /** 사용자가 OS 에서 애니메이션 줄이기를 켰는가. */
  reducedMotion?: boolean;
}

/**
 * 붙일 클래스. null 이면 애니메이션 없음.
 *
 * REPLACE 는 움직이지 않는다 — 같은 화면을 갈아끼우는 것(로그인 후 리다이렉트, 쿼리 갱신)이라
 * 방향이 없다. 여기서 슬라이드를 넣으면 가만히 있는데 화면이 흔들리는 것처럼 보인다.
 */
export function routeTransitionClass(input: RouteTransitionInput): string | null {
  if (!input.native) return null;
  if (input.reducedMotion) return null;
  if (input.navigationType === 'POP') return POP_CLASS;
  if (input.navigationType === 'PUSH') return PUSH_CLASS;
  return null;
}

/**
 * 새 화면으로 들어갈 때 맨 위로 올려야 하는가.
 *
 * 앞으로 갈 때(PUSH)만 올린다. 뒤로 갈 때(POP)까지 올려버리면 보던 목록의 자리를 잃는다 —
 * 목록에서 항목을 열었다 돌아왔는데 맨 위로 튀는 그 동작이다.
 */
export function shouldScrollToTop(navigationType: RouteNavigationType): boolean {
  return navigationType === 'PUSH';
}
