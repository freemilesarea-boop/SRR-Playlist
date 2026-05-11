import { useEffect, useRef } from 'react';

export function useWakeLock(enabled: boolean) {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function acquire() {
      if (!('wakeLock' in navigator) || !navigator.wakeLock) return;
      try {
        const s = await navigator.wakeLock.request('screen');
        if (cancelled) {
          await s.release();
          return;
        }
        sentinelRef.current = s;
        s.addEventListener('release', () => {
          sentinelRef.current = null;
        });
      } catch {
        // 권한 거부 / 비활성 탭 등 — 무시
      }
    }

    async function release() {
      const s = sentinelRef.current;
      if (s) {
        try {
          await s.release();
        } catch {
          /* noop */
        }
        sentinelRef.current = null;
      }
    }

    if (enabled) {
      void acquire();
      const onVis = () => {
        if (document.visibilityState === 'visible' && enabled && !sentinelRef.current) {
          void acquire();
        }
      };
      document.addEventListener('visibilitychange', onVis);
      return () => {
        cancelled = true;
        document.removeEventListener('visibilitychange', onVis);
        void release();
      };
    } else {
      void release();
    }

    return () => {
      cancelled = true;
    };
  }, [enabled]);
}
