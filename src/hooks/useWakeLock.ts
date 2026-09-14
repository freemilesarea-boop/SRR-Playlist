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
/**
 * OS 가 lock 을 스스로 풀었을 때 다시 잡아보는 횟수. 무한 재시도는 하지 않는다 —
 * 배터리 절약 모드처럼 "정책적으로 거부" 하는 상태에서는 몇 번을 불러도 안 되고,
 * 그때 계속 두드리면 구형 기기에서 그게 곧 배터리·CPU 낭비다.
 */
const MAX_REACQUIRE_ATTEMPTS = 5;
/** 1s → 2s → 4s → 8s → 16s. */
const REACQUIRE_BASE_MS = 1_000;

export function useWakeLock(enabled: boolean): WakeLockStatus {
  const handleRef = useRef<ScreenAwakeHandle | null>(null);
  const acquiringRef = useRef(false);
  const setWakeLock = usePlaybackHealthStore((s) => s.setWakeLock);

  useEffect(() => {
    const supported = screenAwakeMode() !== 'unsupported';
    let cancelled = false;
    let attempts = 0;
    let retryTimer: number | null = null;

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
        // 다시 잡았으니 재시도 예산을 되돌린다.
        attempts = 0;
        // OS/브라우저가 스스로 풀면(웹) 상태를 되돌려 재획득 대상이 되게 한다.
        h.onLost(() => {
          handleRef.current = null;
          syncStatus();
          scheduleReacquire();
          // 화면이 여전히 보이는데 lock 만 풀린 경우가 문제다. 그대로 두면 매장
          // 화면이 꺼지고 WebView 가 스로틀된다 — 지금까지는 다음
          // visibilitychange 까지 영영 기다렸다. 보이는 동안 직접 다시 잡는다.
        });
      } finally {
        acquiringRef.current = false;
        syncStatus();
      }
    }

    /**
     * lock 을 잃은 뒤 다시 잡기. **문서가 보이는 동안에만** 시도한다 —
     * 숨은 문서에서는 브라우저가 어차피 거부하고, 그 거부가 예산만 태운다.
     */
    function scheduleReacquire() {
      if (cancelled || !enabled || handleRef.current) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (attempts >= MAX_REACQUIRE_ATTEMPTS) return;
      const delay = REACQUIRE_BASE_MS * 2 ** attempts;
      attempts += 1;
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (cancelled || handleRef.current) return;
        void acquire().then(() => {
          // 아직도 못 잡았으면 다음 시도를 예약한다(예산 안에서만).
          if (!handleRef.current) scheduleReacquire();
        });
      }, delay) as unknown as number;
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
        if (document.visibilityState !== 'visible') return;
        // 다시 보이게 된 것은 새 기회다 — 재시도 예산을 되돌린다.
        attempts = 0;
        if (!handleRef.current) void acquire();
      };
      document.addEventListener('visibilitychange', onVis);
      return () => {
        cancelled = true;
        if (retryTimer !== null) clearTimeout(retryTimer);
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
