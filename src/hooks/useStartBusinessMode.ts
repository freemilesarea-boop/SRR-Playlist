import { useCallback } from 'react';
import { useBusinessScheduleStore } from '@/store/businessScheduleStore';
import { useBusinessStore } from '@/store/businessStore';
import { usePlayerStore } from '@/store/playerStore';
import { usePlaybackSettingsStore } from '@/store/playbackSettingsStore';
import { useAuthStore } from '@/store/authStore';
import { fetchPlaylistTracks } from '@/lib/api';
import { filterPlayableTracks } from '@/lib/trackPlayability';
import { getCurrentSchedule, logScheduleEvent } from '@/lib/businessSchedulerApi';
import { toast } from '@/store/toastStore';
import { captureError } from '@/lib/sentry';
import type { TrackRow } from '@/types/db';

/**
 * 매장 모드 시작 — 단일 진입점.
 *
 * 우선순위:
 *   1) current schedule slot (자동 스케줄러가 지정한 현재 시간대)
 *   2) opts.fallback.playlistId (영업시간 외 수동 시작용 explicit fallback)
 *   3) 첫 schedule with playlist (영업시간 외 자동 폴백)
 *
 * NOW 카드, 스케줄러, 어디서 호출하든 동일 동작을 보장.
 */
export function useStartBusinessMode() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const setBusinessMode = useBusinessStore((s) => s.setBusinessMode);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const setShuffle = usePlayerStore((s) => s.setShuffle);
  const setRepeat = usePlayerStore((s) => s.setRepeat);
  const playAction = usePlayerStore((s) => s.play);
  const enableForBusinessMode = usePlaybackSettingsStore((s) => s.enableForBusinessMode);
  const setLastSwitchedScheduleId = useBusinessScheduleStore((s) => s.setLastSwitchedScheduleId);

  return useCallback(
    async (opts?: { fallback?: { playlistId: string | null; label?: string } }): Promise<boolean> => {
      const store = useBusinessScheduleStore.getState();
      const current = getCurrentSchedule(store.schedules);

      // 어느 플리를 쓸지 결정
      let playlistId: string | null = null;
      let slotLabel = '매장';
      let scheduleId: string | null = null;

      if (current?.playlist_id) {
        playlistId = current.playlist_id;
        slotLabel = current.slot_name;
        scheduleId = current.id;
      } else if (opts?.fallback?.playlistId) {
        playlistId = opts.fallback.playlistId;
        slotLabel = opts.fallback.label ?? '매장';
      } else {
        // 영업시간 외 → 첫 schedule with playlist 자동 폴백
        const any = store.schedules.find((s) => s.playlist_id);
        if (any?.playlist_id) {
          playlistId = any.playlist_id;
          slotLabel = any.slot_name;
          scheduleId = any.id;
        }
      }

      if (!playlistId) {
        toast.info('재생할 플레이리스트가 없어요. 자동 스케줄에서 먼저 설정해주세요.');
        return false;
      }

      try {
        let playable: TrackRow[];
        const cached = store.currentTracks;
        if (current?.id === scheduleId && cached && cached.length > 0) {
          playable = cached;
        } else {
          const tracks = await fetchPlaylistTracks(playlistId);
          playable = filterPlayableTracks(tracks).playable;
        }
        if (playable.length === 0) {
          toast.error(`${slotLabel}: 재생 가능한 음악이 없어요.`);
          return false;
        }
        enableForBusinessMode();
        const playlist = store.playlists.find((p) => p.id === playlistId) ?? null;
        setShuffle(true);
        setRepeat('all');
        setQueue(playable, 0, playlist);
        playAction();
        setBusinessMode(true);
        if (scheduleId) {
          setLastSwitchedScheduleId(scheduleId);
          void logScheduleEvent(userId, scheduleId, playlistId, 'started');
        }
        toast.success(`${slotLabel} 시작 (${playable.length}곡)`);
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '재생 시작 실패');
        void captureError(e, {
          scope: 'useStartBusinessMode',
          playlistId,
          slotLabel,
          scheduleId,
        });
        return false;
      }
    },
    [
      userId,
      setBusinessMode,
      setQueue,
      setShuffle,
      setRepeat,
      playAction,
      enableForBusinessMode,
      setLastSwitchedScheduleId,
    ],
  );
}
