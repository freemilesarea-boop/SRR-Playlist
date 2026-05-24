import { useEffect, useRef } from 'react';
import { usePlaybackHealthStore } from '@/store/playbackHealthStore';

export interface WakeLockStatus {
  supported: boolean;
  active: boolean;
}

/**
 * 화면 꺼짐 방지(Screen Wake Lock). enabled 동안 wake lock 을 유지하고,
 * 탭이 다시 보일 때 자동 재획득한다. 상태는 playbackHealthStore 로 공유.
 * 미지원 브라우저(iOS Safari 일부 등)에서는 supported=false 로 안내.
 */
export function useWakeLock(enabled: boolean): WakeLockStatus {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);
  const acquiringRef = useRef(false);
  const setWakeLock = usePlaybackHealthStore((s) => s.setWakeLock);

  useEffect(() => {
    const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator && !!navigator.wakeLock;
    let cancelled = false;

    function syncStatus() {
      setWakeLock(supported, !!sentinelRef.current);
    }

    async function acquire() {
      if (!supported || acquiringRef.current || sentinelRef.current) return;
      acquiringRef.current = true;
      try {
        const s = await navigator.wakeLock!.request('screen');
        if (cancelled) {
          await s.release();
          return;
        }
        sentinelRef.current = s;
        s.addEventListener('release', () => {
          sentinelRef.current = null;
          syncStatus();
        });
        syncStatus();
      } catch {
        // 권한 거부 / 비활성 탭 / 배터리 절약 모드 등 — 조용히 실패
        syncStatus();
      } finally {
        acquiringRef.current = false;
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
      syncStatus();
    }

    if (!supported) {
      setWakeLock(false, false);
      return;
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
      return () => {
        cancelled = true;
      };
    }
  }, [enabled, setWakeLock]);

  // 렌더 시점 스냅샷 (상태는 store 가 단일 소스)
  return {
    supported: usePlaybackHealthStore.getState().wakeLockSupported,
    active: usePlaybackHealthStore.getState().wakeLockActive,
  };
}
