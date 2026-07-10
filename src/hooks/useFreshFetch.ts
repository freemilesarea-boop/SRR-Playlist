import { useCallback, useEffect, useRef } from 'react';

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
  // WEB-OPT-6 — 진행 중인 fetch 가 있으면 focus/visibility 재호출을 스킵(중복 스택 방지).
  const inFlightRef = useRef(false);

  // WEB-OPT-6 — focus/visibility 복귀 시의 guarded 호출.
  //   브라우저는 탭 복귀 시 'focus' 와 'visibilitychange' 를 함께 발생시켜 동일 콜백이
  //   2회 실행됐다(약 12개 화면에서 매 복귀마다 중복 요청). 하나의 핸들러로 합치고
  //   in-flight 가드로 진행 중 재호출을 무시한다. deps/마운트 경로는 아래에서 항상 실행하므로
  //   새 조건의 최신 fetch 는 그대로 보장된다(정합성 불변).
  const runGuarded = useCallback(() => {
    if (inFlightRef.current) return;
    const r = cbRef.current();
    if (r && typeof (r as Promise<void>).then === 'function') {
      inFlightRef.current = true;
      void (r as Promise<void>).finally(() => {
        inFlightRef.current = false;
      });
    }
  }, []);

  useEffect(() => {
    void cbRef.current();
    // 의존성 변화 (예: user.id 가 늦게 들어옴) 시 재실행
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    function onFocus() {
      runGuarded();
    }
    function onVisibility() {
      if (document.visibilityState === 'visible') runGuarded();
    }
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [runGuarded]);
}
