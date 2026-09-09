import { useEffect, useRef, useState } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { prefetchQueue, audioCacheStats, type AudioCacheStats } from '@/lib/audioCache';

/**
 * 매장/브랜드 플레이어의 오프라인 선반입.
 *
 * 현재 큐에서 앞으로 쓸 곡을 미리 받아 IndexedDB 에 저장한다. 매장은 같은 로테이션을
 * 하루 종일 돌기 때문에 한 바퀴만 돌면 사실상 전곡이 로컬에 남고, 그 뒤로는
 * 회선이 끊겨도 재생이 이어진다.
 *
 * 규칙:
 *   • 온라인일 때만 받는다(오프라인이면 이미 받아둔 것으로 버틴다).
 *   • 한 번에 하나씩만 — 재생 중인 스트림의 대역폭을 뺏지 않도록.
 *   • 트랙이 넘어가거나 큐가 바뀌면 이전 선반입은 취소한다.
 */
export function useAudioCachePrefetch(enabled: boolean, ahead = 5) {
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const [stats, setStats] = useState<AudioCacheStats | null>(null);
  const runningRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled || queue.length === 0) return;

    const ac = new AbortController();
    runningRef.current?.abort();
    runningRef.current = ac;

    // 재생 시작 직후의 네트워크 혼잡을 피해 잠깐 늦춘다.
    const timer = window.setTimeout(() => {
      void (async () => {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        try {
          await prefetchQueue({
            urls: queue.map((t) => t.audio_url),
            index,
            ahead,
            signal: ac.signal,
          });
        } finally {
          if (!ac.signal.aborted) setStats(await audioCacheStats());
        }
      })();
    }, 3_000);

    return () => {
      window.clearTimeout(timer);
      ac.abort();
    };
  }, [enabled, queue, index, ahead]);

  // 온라인 복귀 시 한 번 더 시도 — 오프라인 동안 못 받은 곡을 채운다.
  useEffect(() => {
    if (!enabled) return;
    const onOnline = () => {
      void (async () => {
        await prefetchQueue({ urls: queue.map((t) => t.audio_url), index, ahead });
        setStats(await audioCacheStats());
      })();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [enabled, queue, index, ahead]);

  return stats;
}
