import { useEffect, useRef } from 'react';

/**
 * 마운트 + window focus + visibility 복귀 + 추가 deps 변경 시 모두 callback 을 호출.
 *
 * 사용 예:
 *   useFreshFetch(loadTracks, [userId]);
 *
 * - 새로고침 / 재로그인 / 다른 탭 다녀온 후에도 항상 최신 fetch 보장
 * - localStorage / zustand 캐시만 믿고 "데이터 없음" 처리되는 문제 차단
 */
export function useFreshFetch(
  callback: () => void | Promise<void>,
  deps: ReadonlyArray<unknown> = [],
): void {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    void cbRef.current();
    // 의존성 변화 (예: user.id 가 늦게 들어옴) 시 재실행
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    function onFocus() {
      void cbRef.current();
    }
    function onVisibility() {
      if (document.visibilityState === 'visible') void cbRef.current();
    }
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
}
