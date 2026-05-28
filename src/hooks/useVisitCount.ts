import { useEffect, useState } from 'react';

const COUNT_KEY = 'srr-visit-count';
const SESSION_FLAG = 'srr-visit-counted';

/**
 * 누적 방문 횟수 — localStorage 영구 저장.
 *
 * - 같은 브라우저 세션에서 반복 mount 되어도 1회만 증가 (sessionStorage 가드).
 * - PWA install prompt / re-engagement 같은 점진적 유도 트리거에 사용.
 * - localStorage 막힌 환경(시크릿 모드 등)에서는 항상 0 반환 — 보수적.
 */
export function useVisitCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    try {
      const sessionCounted = sessionStorage.getItem(SESSION_FLAG);
      const prev = parseInt(localStorage.getItem(COUNT_KEY) ?? '0', 10) || 0;
      if (sessionCounted) {
        setCount(prev);
        return;
      }
      const next = prev + 1;
      localStorage.setItem(COUNT_KEY, String(next));
      sessionStorage.setItem(SESSION_FLAG, 'true');
      setCount(next);
    } catch {
      /* localStorage / sessionStorage 막힌 환경 (시크릿/Safari ITP) — 0 유지 */
    }
  }, []);

  return count;
}
