/**
 * useAnnouncerHeartbeat — 안내방송 전용 창이 살아 있음을 서버에 알린다 (0554).
 *
 * 같은 계정의 음악 플레이어는 이 신호를 보고 안내를 내보내지 않는다 (중복 송출 방지).
 * 창이 닫히거나 신호가 150초 끊기면 음악 플레이어가 다시 안내를 받는다 (자동 failover).
 *
 * - 진입 즉시 + 60초 주기 + armed 변경 즉시 + 탭이 다시 보일 때
 * - 창을 닫을 때(pagehide/unmount) goodbye — 실패해도 150초 뒤 자연 만료
 * - 실패는 조용히 넘긴다 (관측이 송출을 방해하면 안 된다)
 */
import { useEffect, useRef } from 'react';
import { ensurePlayerInstanceId } from '@/lib/playbackFlightRecorder';
import { getOutputSlot } from '@/lib/outputSlot';
import { sendAnnouncerGoodbye, sendAnnouncerHeartbeat } from '@/lib/api/announcementApi';

const INTERVAL_MS = 60_000;

/** 창마다 다른 id — 같은 문서 안에서는 고정, 분리 송출 창 번호도 구분한다. */
export function announcerInstanceId(): string {
  const slot = getOutputSlot();
  return `${ensurePlayerInstanceId()}${slot ? `:slot${slot}` : ''}`.slice(0, 80);
}

export function useAnnouncerHeartbeat(opts: { enabled: boolean; armed: boolean; brandId?: string | null }): void {
  const { enabled, armed, brandId = null } = opts;
  const armedRef = useRef(armed);
  armedRef.current = armed;

  useEffect(() => {
    if (!enabled) return;
    const id = announcerInstanceId();
    const beat = () => {
      void sendAnnouncerHeartbeat({ instanceId: id, brandId, armed: armedRef.current }).catch(() => undefined);
    };
    beat();
    const t = window.setInterval(beat, INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') beat(); };
    const onHide = () => { void sendAnnouncerGoodbye(id).catch(() => undefined); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', onHide);
      onHide();
    };
  }, [enabled, brandId]);

  // 소리 허용(armed) 이 바뀌면 바로 알린다 — 그때부터 음악 플레이어가 안내를 넘겨준다.
  useEffect(() => {
    if (!enabled) return;
    void sendAnnouncerHeartbeat({ instanceId: announcerInstanceId(), brandId, armed }).catch(() => undefined);
  }, [enabled, armed, brandId]);
}
