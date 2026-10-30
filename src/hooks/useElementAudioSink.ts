import { useEffect, type RefObject } from 'react';
import { useAudioOutputStore } from '@/store/audioOutputStore';

/**
 * 안내·긴급방송처럼 Player 밖에 있는 <audio> 도 이 창에서 고른 출력 장치로 보낸다.
 *
 * 그동안 이 엘리먼트들은 setSinkId 를 받지 않아 늘 기본 스피커로 나갔다. 분리 송출에서
 * "안내방송은 2번 플레이어(룸) 스피커로" 를 고르면 그 창의 장치로 나가야 한다.
 * 지원하지 않는 브라우저·실패는 조용히 기본 출력으로 남긴다(방송 자체를 막지 않는다).
 */
export function useElementAudioSink(ref: RefObject<HTMLAudioElement | null>): void {
  const sinkId = useAudioOutputStore((s) => s.sinkId);
  const hydrated = useAudioOutputStore((s) => s.hasHydrated);

  useEffect(() => {
    const el = ref.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void>; sinkId?: string }) | null;
    if (!el || !hydrated || typeof el.setSinkId !== 'function') return;
    const desired = sinkId ?? '';
    if (el.sinkId === desired) return;
    el.setSinkId(desired).catch(() => { /* 장치가 사라졌거나 권한 없음 — 기본 출력 유지 */ });
  }, [ref, sinkId, hydrated]);
}
