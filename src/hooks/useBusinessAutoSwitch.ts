import { useEffect, useMemo } from 'react';
import { useBusinessScheduleStore } from '@/store/businessScheduleStore';
import { useBusinessStore } from '@/store/businessStore';
import { usePlayerStore } from '@/store/playerStore';
import { useAuthStore } from '@/store/authStore';
import { fetchPlaylistTracks } from '@/lib/api';
import { filterPlayableTracks } from '@/lib/trackPlayability';
import { getCurrentSchedule, logScheduleEvent } from '@/lib/businessSchedulerApi';
import { toast } from '@/store/toastStore';
import { captureError } from '@/lib/sentry';
import { sendPush } from '@/lib/pushApi';
import { emitQueueExposures, resolveStoreQueue } from '@/lib/experimentRuntime';

/**
 * 매장 자동 운영 엔진 — BusinessPage 마운트 시 1회 활성.
 *
 * 1) 1분 tick — current schedule 재계산 트리거 (store.tick)
 * 2) current slot 트랙 prefetch — user gesture 안에서 동기 setQueue 가능 (autoplay 정책 안전)
 * 3) businessMode ON + current 변경 → 자동 큐 교체 (로테이션)
 *
 * 기존 BusinessScheduler 컴포넌트 내부에 있던 동일 로직을 끌어올려
 * NOW 카드/에디터 어디서 시작하든 동일 엔진이 돌게 함.
 */
export function useBusinessAutoSwitch() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const schedules = useBusinessScheduleStore((s) => s.schedules);
  const playlists = useBusinessScheduleStore((s) => s.playlists);
  const tick = useBusinessScheduleStore((s) => s.tick);
  const bumpTick = useBusinessScheduleStore((s) => s.bumpTick);
  const setCurrentTracks = useBusinessScheduleStore((s) => s.setCurrentTracks);
  const setTracksLoading = useBusinessScheduleStore((s) => s.setTracksLoading);
  const setTracksError = useBusinessScheduleStore((s) => s.setTracksError);
  const lastSwitchedScheduleId = useBusinessScheduleStore((s) => s.lastSwitchedScheduleId);
  const setLastSwitchedScheduleId = useBusinessScheduleStore((s) => s.setLastSwitchedScheduleId);
  const businessMode = useBusinessStore((s) => s.businessMode);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const setRepeat = usePlayerStore((s) => s.setRepeat);
  const setShuffle = usePlayerStore((s) => s.setShuffle);
  const playAction = usePlayerStore((s) => s.play);

  // 1분마다 tick — current/next 재계산
  useEffect(() => {
    const id = window.setInterval(bumpTick, 60_000);
    return () => window.clearInterval(id);
  }, [bumpTick]);

  // tick 은 60s interval bump — 시간 경과로 current slot 가 바뀌어야 재계산 됨
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const current = useMemo(() => getCurrentSchedule(schedules), [schedules, tick]);

  // current slot 트랙 prefetch
  useEffect(() => {
    setCurrentTracks(null);
    setTracksError(null);
    if (!current?.playlist_id) return;
    setTracksLoading(true);
    let alive = true;
    // 0404 (HOTFIX-A): 매장 컨텍스트 (userId === storeId) 전달 → guardrail hard_block 제외
    fetchPlaylistTracks(current.playlist_id, userId)
      .then((tracks) => {
        if (!alive) return;
        const { playable } = filterPlayableTracks(tracks);
        if (import.meta.env.DEV) {
          console.debug('[StoreEngine] tracks loaded', { slot: current.slot_name, total: tracks.length, playable: playable.length });
        }
        setCurrentTracks(playable);
      })
      .catch((e) => {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : String(e);
        if (import.meta.env.DEV) console.error('[StoreEngine] tracks fetch failed', e);
        setTracksError(msg);
        void captureError(e, {
          scope: 'useBusinessAutoSwitch.prefetch',
          playlistId: current?.playlist_id,
          slot: current?.slot_name,
        });
      })
      .finally(() => { if (alive) setTracksLoading(false); });
    return () => { alive = false; };
  }, [current?.playlist_id, current?.slot_name, userId, setCurrentTracks, setTracksLoading, setTracksError]);

  // businessMode ON + current 변경 → 자동 큐 교체.
  //
  // 항상 fresh fetch. (이전 구현은 cached currentTracks 동기 path 가 있었으나
  // slot 전환 시점에 stale [이전 슬롯 tracks] 가 setQueue 되는 race 존재.
  // cached 는 user-gesture useStartBusinessMode 에서만 사용.)
  useEffect(() => {
    if (!businessMode || !current?.id || !current.playlist_id) return;
    if (lastSwitchedScheduleId === current.id) return;
    const isInitial = lastSwitchedScheduleId === null;
    // 비동기 fetch 도중 current 가 또 바뀔 수 있으므로 setup 시점 값 캡처
    const targetScheduleId = current.id;
    const targetPlaylistId = current.playlist_id;
    const targetSlotName = current.slot_name;
    let alive = true;
    (async () => {
      try {
        // 0404 (HOTFIX-A): 매장 컨텍스트 (userId === storeId) 전달 → guardrail hard_block 제외
        const tracks = await fetchPlaylistTracks(targetPlaylistId, userId);
        const playable = filterPlayableTracks(tracks).playable;
        if (!alive) return;
        if (!useBusinessStore.getState().businessMode) return;
        if (getCurrentSchedule(useBusinessScheduleStore.getState().schedules)?.id !== targetScheduleId) return;
        if (playable.length === 0) {
          toast.error(`${targetSlotName}: 재생 가능한 음악이 없어요.`);
          return;
        }
        const playlist = playlists.find((p) => p.id === targetPlaylistId) ?? null;

        // AI-EXPERIMENT-2 Stage 2 — Internal Treatment Routing(Fail-Closed).
        // 승인된 internal_test Treatment Store 만 Recommendation v2 Runtime 순서를
        // 사용한다. 부적격/Timeout/무효 Queue 는 항상 playable(Control)로 회귀하며
        // 일반 매장은 Gate 조회가 부적격 → playable 그대로. Player/Queue 계약 무변경.
        let queueTracks = playable;
        let treatmentRouted = false;
        if (userId) {
          const routed = await resolveStoreQueue({
            storeId: userId, playlistId: targetPlaylistId, sessionId: null,
            controlTracks: playable,
            currentTrackId: usePlayerStore.getState().queue[usePlayerStore.getState().index]?.id ?? null,
            recentTrackIds: [], targetCount: Math.min(playable.length, 50),
          });
          if (!alive) return;
          if (!useBusinessStore.getState().businessMode) return;
          if (getCurrentSchedule(useBusinessScheduleStore.getState().schedules)?.id !== targetScheduleId) return;
          queueTracks = routed.tracks.length > 0 ? routed.tracks : playable;
          treatmentRouted = routed.route === 'treatment';
        }

        setRepeat('all');
        setShuffle(true);
        // X6.80 — 시간대 전환 시에도 daily seed shuffle 적용 (매일 다른 순서).
        // Treatment 는 v2 결정론 순서를 유지하므로 daily shuffle 을 끈다(Control 은 유지).
        // setShuffle 을 먼저 호출해야 setQueue 내부의 get().shuffle 이 true 임
        setQueue(queueTracks, 0, playlist, null, { dailySeedShuffle: !treatmentRouted });
        playAction();
        if (import.meta.env.DEV) console.debug('[StoreEngine] playback switched', { tracks: playable.length, isInitial, slot: targetSlotName });
        setLastSwitchedScheduleId(targetScheduleId);
        if (!isInitial) toast.success(`${targetSlotName} 플레이리스트로 자동 전환했어요`);
        void logScheduleEvent(userId, targetScheduleId, targetPlaylistId, isInitial ? 'started' : 'switched');
        // AI-EXPERIMENT-1 Stage 0 — Exposure Emission(fire-and-forget · 실패 silent ·
        // Assignment 없는 일반 매장은 내부에서 no-op). 재생 로직/Queue 계약 무변경.
        if (userId) {
          void emitQueueExposures({
            storeId: userId, playlistId: targetPlaylistId, sessionId: null,
            trackIds: queueTracks.map((t) => t.id), source: 'scheduler',
            dayKey: `${new Date().toISOString().slice(0, 10)}|${targetScheduleId}`,
          });
        }
      } catch (e) {
        if (alive) {
          toast.error(e instanceof Error ? e.message : '자동 전환 실패');
          void captureError(e, {
            scope: 'useBusinessAutoSwitch.autoswitch',
            scheduleId: targetScheduleId,
            playlistId: targetPlaylistId,
            slot: targetSlotName,
          });
          // 매장 사장님이 자리 비웠을 수 있어 본인 폰에 push 발송.
          // VAPID 미설정 / 미구독이면 silent skip.
          if (userId) {
            void sendPush({
              user_id: userId,
              title: '⚠️ 매장 자동 전환 실패',
              body: `${targetSlotName} 시간대 음악 전환에 실패했어요. 매장 페이지에서 확인해주세요.`,
              url: '/business',
              tag: 'business-autoswitch-failure',
            });
          }
        }
      }
    })();
    return () => { alive = false; };
    // currentTracks 의존 제거 — cached 사용 안 함
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessMode, current?.id, current?.playlist_id]);
}
