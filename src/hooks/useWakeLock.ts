import { useEffect, useRef } from 'react';
import { usePlaybackHealthStore } from '@/store/playbackHealthStore';
import { acquireScreenAwake, screenAwakeMode, type ScreenAwakeHandle } from '@/lib/screenAwake';

export interface WakeLockStatus {
  supported: boolean;
  active: boolean;
}

/**
 * 화면 꺼짐 방지. enabled 동안 lock 을 유지하고, 앱/탭이 다시 보일 때 자동 재획득한다.
 * 상태는 playbackHealthStore 로 공유(매장·브랜드 플레이어의 상태 표시에 쓰임).
 *
 * 드라이버 선택은 screenAwake.ts 가 담당한다:
 *   네이티브 쉘 → KeepAwake 플러그인 / 웹·PWA → navigator.wakeLock.
 * 둘 다 불가한 환경만 supported=false 로 "기기 자동 잠금 해제" 안내를 띄운다.
 */
export function useWakeLock(enabled: boolean): WakeLockStatus {
  const handleRef = useRef<ScreenAwakeHandle | null>(null);
  const acquiringRef = useRef(false);
  const setWakeLock = usePlaybackHealthStore((s) => s.setWakeLock);

  useEffect(() => {
    const supported = screenAwakeMode() !== 'unsupported';
    let cancelled = false;

    function syncStatus() {
      setWakeLock(supported, !!handleRef.current);
    }

    async function acquire() {
      if (!supported || acquiringRef.current || handleRef.current) return;
      acquiringRef.current = true;
      try {
        const h = await acquireScreenAwake();
        if (!h) return;
        if (cancelled) {
          await h.release();
          return;
        }
        handleRef.current = h;
        // OS/브라우저가 스스로 풀면(웹) 상태를 되돌려 재획득 대상이 되게 한다.
        h.onLost(() => {
          handleRef.current = null;
          syncStatus();
        });
      } finally {
        acquiringRef.current = false;
        syncStatus();
      }
    }

    async function release() {
      const h = handleRef.current;
      handleRef.current = null;
      if (h) await h.release();
      syncStatus();
    }

    if (!supported) {
      setWakeLock(false, false);
      return;
    }

    if (enabled) {
      void acquire();
      const onVis = () => {
        if (document.visibilityState === 'visible' && !handleRef.current) void acquire();
      };
      document.addEventListener('visibilitychange', onVis);
      return () => {
        cancelled = true;
        document.removeEventListener('visibilitychange', onVis);
        void release();
      };
    }

    void release();
    return () => {
      cancelled = true;
    };
  }, [enabled, setWakeLock]);

  // 렌더 시점 스냅샷 (상태는 store 가 단일 소스)
  return {
    supported: usePlaybackHealthStore.getState().wakeLockSupported,
    active: usePlaybackHealthStore.getState().wakeLockActive,
  };
}
