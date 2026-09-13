/**
 * useIsTablet — 태블릿 여부를 렌더에 반영한다. 회전하면 다시 계산한다.
 *
 * 값을 한 번만 읽어두면 아이패드를 돌렸을 때 하단탭이 그대로 남는다.
 * resize 는 회전·분할화면·소프트키보드에서 모두 발생하므로 이것만 보면 된다.
 */
import { useEffect, useState } from 'react';
import { currentDeviceIsTablet } from '@/lib/deviceClass';

export function useIsTablet(): boolean {
  const [tablet, setTablet] = useState(currentDeviceIsTablet);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => setTablet(currentDeviceIsTablet());
    update(); // 첫 렌더와 실제 크기가 다를 수 있다(스플래시 직후 등)
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return tablet;
}
