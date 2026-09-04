// Phase BRAND-1 — 브랜드 플레이어 heartbeat.
// useStoreHeartbeat 패턴 미러: (a) 트랙 변경 즉시 fire + (b) 60s interval.
// last_seen_at / current_track_id 갱신. 실패는 silent (재생 절대 방해 안 함).
//
// BRAND-PLAYER-SELF-HEAL-1 — **실제로 소리가 났던 곡만 보고한다.**
// 서버는 current_track_id 가 바뀌는 것을 "정상 재생 중"의 근거로 쓴다
// (current_track_started_at → admin_brand_player_health). 그런데 자동 복구가
// 정지된 곡을 계속 건너뛰면 큐 index 는 척척 넘어가므로, store 의 현재 곡을 그대로
// 보고할 경우 소리는 한 번도 안 나는데 서버 눈에는 잘 도는 매장으로 보인다.
// 자가 치유를 붙이면서 감시를 눈멀게 하는 셈이라, 여기서 audioActive(실제 재생
// 여부)를 기준으로 삼는다 — 소리가 안 나는 동안에는 마지막으로 실제 재생된 곡을
// 계속 보고하고, 서버는 그대로 stalled 로 판정한다.
import { useEffect, useRef } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { usePlaybackHealthStore } from '@/store/playbackHealthStore';
import { brandPlayerHeartbeat } from '@/lib/api/brandPlayerApi';

const HEARTBEAT_INTERVAL_MS = 60_000;

interface Options {
  brandId: string | null;
  sessionToken: string | null;
  enabled: boolean;
}

/**
 * 서버에 보고할 곡 = **마지막으로 실제 소리가 났던 곡**.
 * audioActive 가 false 인 동안(정지·자동 스킵 중)에는 기준점을 옮기지 않는다.
 * 아직 한 번도 재생된 적이 없으면 현재 곡을 그대로 보고한다(최초 진입).
 */
function resolveReportedTrackId(
  storeTrackId: string | null,
  lastAudibleRef: React.MutableRefObject<string | null>,
): string | null {
  const audioActive = usePlaybackHealthStore.getState().audioActive;
  if (audioActive) {
    lastAudibleRef.current = storeTrackId;
    return storeTrackId;
  }
  return lastAudibleRef.current ?? storeTrackId;
}

export function useBrandPlayerHeartbeat({ brandId, sessionToken, enabled }: Options): void {
  const currentTrackId = usePlayerStore((s) => s.queue[s.index]?.id ?? null);
  const lastTrackIdRef = useRef<string | null>(null);
  /** 마지막으로 실제 소리가 났던 곡 id. */
  const lastAudibleTrackIdRef = useRef<string | null>(null);
  // 구독해서 소리가 나기 시작한 순간 (a) 가 다시 돌게 한다. 이게 없으면 곡 전환이
  // 60s interval 까지 보고되지 않는다 — 전환 직후엔 아직 audioActive=false 이므로.
  const audioActive = usePlaybackHealthStore((s) => s.audioActive);

  // (a) 트랙 변경(= 실제로 소리가 난 곡의 변경) 즉시 heartbeat
  useEffect(() => {
    if (!enabled || !brandId || !sessionToken) return;
    const reported = resolveReportedTrackId(currentTrackId, lastAudibleTrackIdRef);
    if (reported === lastTrackIdRef.current) return;
    lastTrackIdRef.current = reported;
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 300) : null;
    void brandPlayerHeartbeat(brandId, sessionToken, reported, ua).catch(() => { /* silent */ });
  }, [enabled, brandId, sessionToken, currentTrackId, audioActive]);

  // (b) 60s interval — getState() 로 fresh 값 조회, deps 는 [enabled, brandId, sessionToken] 만
  useEffect(() => {
    if (!enabled || !brandId || !sessionToken) return;
    let cancelled = false;
    const fire = () => {
      const st = usePlayerStore.getState();
      const tid = resolveReportedTrackId(st.queue[st.index]?.id ?? null, lastAudibleTrackIdRef);
      lastTrackIdRef.current = tid;
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 300) : null;
      void brandPlayerHeartbeat(brandId, sessionToken, tid, ua).catch(() => { /* silent */ });
    };
    fire();
    const id = window.setInterval(() => { if (!cancelled) fire(); }, HEARTBEAT_INTERVAL_MS);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [enabled, brandId, sessionToken]);
}
