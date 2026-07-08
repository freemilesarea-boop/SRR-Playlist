// Phase BRAND-1 — 브랜드 플레이어 heartbeat.
// useStoreHeartbeat 패턴 미러: (a) 트랙 변경 즉시 fire + (b) 60s interval.
// last_seen_at / current_track_id 갱신. 실패는 silent (재생 절대 방해 안 함).
import { useEffect, useRef } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { brandPlayerHeartbeat } from '@/lib/api/brandPlayerApi';

const HEARTBEAT_INTERVAL_MS = 60_000;

interface Options {
  brandId: string | null;
  sessionToken: string | null;
  enabled: boolean;
}

export function useBrandPlayerHeartbeat({ brandId, sessionToken, enabled }: Options): void {
  const currentTrackId = usePlayerStore((s) => s.queue[s.index]?.id ?? null);
  const lastTrackIdRef = useRef<string | null>(null);

  // (a) 트랙 변경 즉시 heartbeat
  useEffect(() => {
    if (!enabled || !brandId || !sessionToken) return;
    if (currentTrackId === lastTrackIdRef.current) return;
    lastTrackIdRef.current = currentTrackId;
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 300) : null;
    void brandPlayerHeartbeat(brandId, sessionToken, currentTrackId, ua).catch(() => { /* silent */ });
  }, [enabled, brandId, sessionToken, currentTrackId]);

  // (b) 60s interval — getState() 로 fresh 값 조회, deps 는 [enabled, brandId, sessionToken] 만
  useEffect(() => {
    if (!enabled || !brandId || !sessionToken) return;
    let cancelled = false;
    const fire = () => {
      const tid = usePlayerStore.getState().queue[usePlayerStore.getState().index]?.id ?? null;
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 300) : null;
      void brandPlayerHeartbeat(brandId, sessionToken, tid, ua).catch(() => { /* silent */ });
    };
    fire();
    const id = window.setInterval(() => { if (!cancelled) fire(); }, HEARTBEAT_INTERVAL_MS);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [enabled, brandId, sessionToken]);
}
