/**
 * AnnouncementOverlay — Priority 5 (Announcement Audio Scheduler V1).
 *
 * 매장 플레이어에 안전하게 부착되는 광고/안내 음원 오버레이.
 *
 * 동작:
 *   1) 매 30초 store_get_due_announcements 폴링
 *   2) BGM 트랙 전환 시점 (playerStore.index 변경 또는 queue[index].id 변경) 감지
 *   3) due 안내음이 있으면:
 *       a) playerStore.pause() — BGM 일시정지
 *       b) 별도 <audio> ref 로 안내음 재생
 *       c) ended → store_mark_announcement_played('played') + playerStore.play() (BGM 재개)
 *       d) error → store_mark_announcement_played('failed') + playerStore.play()
 *   4) 안내음 재생 중에는 BGM 의 stream count / artist settlement 영향 없음
 *      (BGM 은 paused 상태)
 *
 * 안전:
 *   - Player.tsx / crossfade / queue 로직 무수정
 *   - 곡 중간 강제 interrupt 금지 — 항상 트랙 전환 시점에만 trigger
 *   - 서버 측 debounce (5분) + max_plays_per_day 로 중복 방지
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Volume2 } from 'lucide-react';
import { usePlayerStore } from '@/store/playerStore';
import {
  getDueAnnouncements, markAnnouncementPlayed,
  type DueAnnouncement,
} from '@/lib/api/announcementApi';

const POLL_INTERVAL_MS = 30_000;

export interface AnnouncementOverlayProps {
  /** 매장 사용자 id (auth.uid()). null 이면 비활성. */
  storeId: string | null;
  /** 디버그 로그 활성화 */
  debug?: boolean;
}

export default function AnnouncementOverlay({ storeId, debug = false }: AnnouncementOverlayProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [due, setDue] = useState<DueAnnouncement[]>([]);
  const [active, setActive] = useState<DueAnnouncement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastTrackIdRef = useRef<string | null>(null);
  const playingRef = useRef(false);  // overlay 자체 재생 중 flag (중복 trigger 방지)

  const log = useCallback((...args: unknown[]) => {
    if (debug) console.log('[announcement-overlay]', ...args);
  }, [debug]);

  // 30s 폴링
  const refresh = useCallback(async () => {
    if (!storeId) return;
    try {
      const r = await getDueAnnouncements(storeId);
      setDue(r.data ?? []);
      setError(null);
    } catch (e) {
      const msg = (e as Error).message;
      log('poll failed', msg);
      setError(msg);
    }
  }, [storeId, log]);

  useEffect(() => {
    if (!storeId) return;
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [storeId, refresh]);

  // 안내음 재생 시작
  const startAnnouncement = useCallback((ann: DueAnnouncement) => {
    if (playingRef.current) return;
    const a = audioRef.current;
    if (!a) return;
    playingRef.current = true;
    setActive(ann);

    // BGM 일시정지
    try {
      usePlayerStore.getState().pause();
    } catch (e) {
      log('pause BGM failed', e);
    }

    a.src = ann.asset_file_url;
    a.volume = 1.0;
    a.currentTime = 0;
    void a.play().catch((e) => {
      log('play announcement failed', e);
      // 재생 자체 실패 → failed 기록 + BGM 재개
      void markAnnouncementPlayed(ann.schedule_id, ann.asset_id, 'failed', (e as Error).message)
        .catch(() => undefined);
      playingRef.current = false;
      setActive(null);
      try { usePlayerStore.getState().play(); } catch (_e) { void _e; }
    });
  }, [log]);

  // 안내음 종료/실패 핸들러
  const finishAnnouncement = useCallback(async (status: 'played' | 'failed' | 'skipped', errorMsg?: string) => {
    const ann = active;
    if (!ann) return;
    playingRef.current = false;
    setActive(null);

    try {
      await markAnnouncementPlayed(ann.schedule_id, ann.asset_id, status, errorMsg ?? null);
    } catch (e) {
      log('mark played failed', e);
    }

    // BGM 재개 (사용자가 직접 pause 한 게 아닌 경우만)
    try { usePlayerStore.getState().play(); } catch (e) { log('resume BGM failed', e); }

    // 서버 측 debounce + max_plays_per_day 가 즉시 반영되도록 due 리스트 새로고침
    void refresh();
  }, [active, refresh, log]);

  // playerStore.index 또는 queue[index] 변경 감지 (트랙 전환 시점)
  useEffect(() => {
    if (!storeId) return;
    const unsub = usePlayerStore.subscribe((state) => {
      const cur = state.queue[state.index]?.id ?? null;
      const prev = lastTrackIdRef.current;
      lastTrackIdRef.current = cur;
      if (!cur || !prev || cur === prev) return;          // 트랙 변경 아님
      if (playingRef.current) return;                      // 이미 announcement 재생 중
      if (due.length === 0) return;                        // due 없음
      const next = due[0];
      log('track changed → injecting announcement', { prev, cur, schedule: next.schedule_id });
      startAnnouncement(next);
    });
    return unsub;
  }, [storeId, due, startAnnouncement, log]);

  // 안내음 오디오 이벤트 wiring
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onEnded = () => void finishAnnouncement('played');
    const onError = () => void finishAnnouncement('failed', 'audio error');
    a.addEventListener('ended', onEnded);
    a.addEventListener('error', onError);
    return () => {
      a.removeEventListener('ended', onEnded);
      a.removeEventListener('error', onError);
    };
  }, [finishAnnouncement]);

  if (!storeId) return null;

  return (
    <>
      {/* 보이지 않는 audio 엘리먼트 — overlay 전용 */}
      <audio ref={audioRef} preload="auto" />

      {/* 안내음 재생 중 — 시각 피드백 (sm 매장 화면 하단 띠) */}
      {active && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 z-[120] -translate-x-1/2 flex items-center gap-2 rounded-full bg-violet-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-black/30"
        >
          <Volume2 size={12} className="animate-pulse" />
          안내방송 재생 중 · {active.asset_title}
        </div>
      )}

      {/* 폴링 에러는 silent — 콘솔만 (디버그) */}
      {debug && error && (
        <div className="fixed bottom-16 left-1/2 z-[120] -translate-x-1/2 rounded bg-rose-500/25 px-3 py-1 text-[10px] text-rose-200">
          announcement poll error: {error}
        </div>
      )}
    </>
  );
}
