import { useEffect, useRef } from 'react';
import { getOutputSlot } from '@/lib/outputSlot';
import { sendOutputSlotHeartbeat } from '@/lib/api/outputSlotApi';
import { usePlayerStore } from '@/store/playerStore';
import { useAudioOutputStore } from '@/store/audioOutputStore';
import { useAuthStore } from '@/store/authStore';
import { pageBuildHash } from '@/lib/pwaBuildIdentity';

const INTERVAL_MS = 60_000;

/**
 * 분리 송출 창의 공간별 상태 보고 — 1분마다 + 곡이 바뀌거나 창이 숨겨지거나 스피커를 바꿀 때.
 *
 * 기존 매장 상태(store_heartbeat)는 매장당 한 줄이라 창들이 서로 덮어쓴다. 이 보고는
 * (매장, 슬롯) 단위로 따로 쌓여 관리자·점주가 "2번 룸 스피커가 멈췄다" 를 볼 수 있다.
 * 보고 실패는 조용히 넘긴다 — 재생을 절대 막지 않는다. 슬롯 창이 아니면 아무것도 하지 않는다.
 */
export function useOutputSlotHeartbeat(kind: 'brand' | 'store' | 'announce'): void {
  const slot = getOutputSlot();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const playing = usePlayerStore((s) => s.playing);
  const trackId = usePlayerStore((s) => s.queue[s.index]?.id ?? null);
  const sinkLabel = useAudioOutputStore((s) => s.sinkLabel);
  const startedAtRef = useRef<string | null>(null);
  const lastTrackRef = useRef<string | null>(null);

  if (trackId !== lastTrackRef.current) {
    lastTrackRef.current = trackId;
    startedAtRef.current = trackId ? new Date().toISOString() : null;
  }

  useEffect(() => {
    if (!slot || !userId) return;
    let cancelled = false;
    const send = () => {
      if (cancelled) return;
      const p = usePlayerStore.getState();
      void sendOutputSlotHeartbeat({
        slot,
        mode: kind,
        playerStatus: p.playing ? 'playing' : p.queue.length > 0 ? 'paused' : 'stopped',
        currentTrackId: p.queue[p.index]?.id ?? null,
        currentTrackStartedAt: startedAtRef.current,
        sinkLabel: useAudioOutputStore.getState().sinkLabel,
        visibility: typeof document === 'undefined' ? null : document.visibilityState === 'hidden' ? 'hidden' : 'visible',
        appVersion: pageBuildHash(),
      }).catch(() => { /* 보고 실패가 재생을 막지 않는다 */ });
    };
    send();
    const timer = window.setInterval(send, INTERVAL_MS);
    document.addEventListener('visibilitychange', send);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', send);
    };
    // 곡·재생 상태·스피커가 바뀌면 즉시 한 번 더 보고하고 주기를 다시 잡는다.
  }, [slot, userId, kind, playing, trackId, sinkLabel]);
}
