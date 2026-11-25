import { useEffect, useRef } from 'react';

/**
 * 요소의 실제 높이를 CSS 변수로 올린다.
 *
 * 하단탭 높이는 기기마다 다르다 — 제스처바냐 3버튼이냐에 따라
 * safe-area-inset-bottom 이 0 에서 48px 까지 움직이고, 탭 개수와 글자 크기도
 * 계정 종류·OS 글꼴 설정에 따라 달라진다. 그걸 rem 상수로 적어두면 한 기기에서만
 * 맞고 나머지는 겹치거나 뜬다. 실제로 겹쳤다.
 *
 * 그래서 재지 않고 쓰지 않는다. ResizeObserver 로 실측해서 :root 에 꽂으면
 * CSS 쪽은 calc() 로 받아쓰기만 하면 된다.
 *
 * 반환한 ref 를 측정할 요소에 붙인다.
 */
export function useMeasuredCssVar(name: `--${string}`): React.RefObject<HTMLElement> {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const root = document.documentElement;
    let last = -1;
    const apply = (): void => {
      // 경계에서 소수점이 흔들려 변수가 매 프레임 바뀌는 것을 막는다.
      const h = Math.round(el.getBoundingClientRect().height);
      if (h === last) return;
      last = h;
      root.style.setProperty(name, `${h}px`);
    };

    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    // 화면 회전·제스처바 변화는 요소 크기 변화로 안 잡힐 수 있다.
    window.addEventListener('orientationchange', apply);
    window.addEventListener('resize', apply);

    return () => {
      ro.disconnect();
      window.removeEventListener('orientationchange', apply);
      window.removeEventListener('resize', apply);
      root.style.removeProperty(name);
    };
  }, [name]);

  return ref;
}
