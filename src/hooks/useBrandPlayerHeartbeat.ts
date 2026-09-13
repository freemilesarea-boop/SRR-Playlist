// Phase BRAND-1 — 브랜드 플레이어 heartbeat.
// useStoreHeartbeat 패턴 미러: (a) 트랙 변경 즉시 fire + (b) 60s interval.
// last_seen_at / current_track_id 갱신. 실패는 silent (재생 절대 방해 안 함).
//
// 0518 — 원격 제어: heartbeat 응답에 실려 오는 명령을 실행한다.
// 플레이어는 Realtime 을 구독하지 않으므로 이 응답이 유일한 서버→매장 통로다.
// 서버가 배달 시점에 명령을 소비하므로 같은 명령이 두 번 오지 않지만,
// StrictMode 중복 호출 등에 대비해 실행한 command_id 를 한 번 더 걸러낸다.
import { useEffect, useRef } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { brandPlayerHeartbeat, type BrandPlayerHeartbeatResult } from '@/lib/api/brandPlayerApi';
import { decideCommandAction } from '@/lib/brandPlayerCommand';

const HEARTBEAT_INTERVAL_MS = 60_000;

interface Options {
  brandId: string | null;
  sessionToken: string | null;
  enabled: boolean;
}

export function useBrandPlayerHeartbeat({ brandId, sessionToken, enabled }: Options): void {
  const currentTrackId = usePlayerStore((s) => s.queue[s.index]?.id ?? null);
  const lastTrackIdRef = useRef<string | null>(null);
  const doneCommandsRef = useRef<Set<string>>(new Set());

  // 명령 실행. 재생을 되살리는 것이 목적이므로 실패해도 조용히 넘어간다.
  const runCommand = (res: BrandPlayerHeartbeatResult): void => {
    const action = decideCommandAction(res, doneCommandsRef.current);
    if (action.kind !== 'run') return;
    const { command, commandId } = action;
    doneCommandsRef.current.add(commandId);

    try {
      if (command === 'reload') {
        // 매장 PC 의 F5 를 대신한다. 새 빌드도 함께 적용된다.
        window.location.reload();
        return;
      }
      const store = usePlayerStore.getState();
      if (command === 'play') store.play();
      else if (command === 'next') store.next({ cause: 'manual_next' });
    } catch {
      /* silent — 명령 실패가 재생을 망가뜨리면 안 된다 */
    }
  };

  // (a) 트랙 변경 즉시 heartbeat
  useEffect(() => {
    if (!enabled || !brandId || !sessionToken) return;
    if (currentTrackId === lastTrackIdRef.current) return;
    lastTrackIdRef.current = currentTrackId;
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 300) : null;
    void brandPlayerHeartbeat(brandId, sessionToken, currentTrackId, ua)
      .then(runCommand)
      .catch(() => { /* silent */ });
  }, [enabled, brandId, sessionToken, currentTrackId]);

  // (b) 60s interval — getState() 로 fresh 값 조회, deps 는 [enabled, brandId, sessionToken] 만
  useEffect(() => {
    if (!enabled || !brandId || !sessionToken) return;
    let cancelled = false;
    const fire = () => {
      const tid = usePlayerStore.getState().queue[usePlayerStore.getState().index]?.id ?? null;
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 300) : null;
      void brandPlayerHeartbeat(brandId, sessionToken, tid, ua)
        .then((res) => { if (!cancelled) runCommand(res); })
        .catch(() => { /* silent */ });
    };
    fire();
    const id = window.setInterval(() => { if (!cancelled) fire(); }, HEARTBEAT_INTERVAL_MS);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [enabled, brandId, sessionToken]);
}
