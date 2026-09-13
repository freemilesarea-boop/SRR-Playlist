/**
 * RouteTransition — 화면이 바뀔 때 들어오는 쪽만 움직인다. 방향은 routeTransition.ts 가 정한다.
 *
 * key 로 리마운트하지 않는다. 같은 라우트에서 파라미터만 바뀌는 경우(/playlist/1 → /playlist/2)
 * 까지 통째로 다시 그리게 되어 스크롤·포커스·진행 중인 요청을 잃는다.
 * 대신 클래스를 떼었다 붙여서 애니메이션만 다시 재생한다.
 */
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { isNativeApp } from '@/lib/native';
import {
  routeTransitionClass,
  shouldScrollToTop,
  PUSH_CLASS,
  POP_CLASS,
  type RouteNavigationType,
} from '@/lib/routeTransition';

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

export default function RouteTransition({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigationType = useNavigationType() as RouteNavigationType;
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (shouldScrollToTop(navigationType)) {
      try {
        window.scrollTo(0, 0);
      } catch {
        /* noop */
      }
    }

    const cls = routeTransitionClass({
      navigationType,
      native: isNativeApp(),
      reducedMotion: prefersReducedMotion(),
    });
    el.classList.remove(PUSH_CLASS, POP_CLASS);
    if (!cls) return;
    // 클래스를 뗀 직후 바로 붙이면 브라우저가 변화를 못 보고 애니메이션이 재생되지 않는다.
    // 레이아웃을 한 번 읽어 강제로 반영시킨다.
    void el.offsetWidth;
    el.classList.add(cls);
    // location.key 는 같은 경로로 다시 이동해도 매번 바뀐다 — 그래서 이걸 봐야 한다.
  }, [location.key, navigationType]);

  return <div ref={ref}>{children}</div>;
}
