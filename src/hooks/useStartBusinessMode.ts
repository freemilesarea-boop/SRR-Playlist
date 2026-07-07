import { useCallback } from 'react';
import { useBusinessScheduleStore } from '@/store/businessScheduleStore';
import { useBusinessStore } from '@/store/businessStore';
import { usePlayerStore } from '@/store/playerStore';
import { usePlaybackSettingsStore } from '@/store/playbackSettingsStore';
import { useAuthStore } from '@/store/authStore';
import { fetchPlaylistTracks } from '@/lib/api';
import { filterPlayableTracks } from '@/lib/trackPlayability';
import { getCurrentSchedule, logScheduleEvent } from '@/lib/businessSchedulerApi';
import { findFallbackPlaylist } from '@/lib/businessFallbackApi';
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
          // 0404 (HOTFIX-A): 매장 컨텍스트 (userId === storeId) 전달 → guardrail hard_block 제외
          const tracks = await fetchPlaylistTracks(playlistId, userId);
          playable = filterPlayableTracks(tracks).playable;
        }

        // X6.0.1: 빈 큐 감지 시 같은 카테고리/daypart fallback 자동 시도
        let fallbackUsed = false;
        if (playable.length === 0) {
          const originalPl = store.playlists.find((p) => p.id === playlistId) ?? null;
          const candidate = await findFallbackPlaylist(
            originalPl?.business_category ?? null,
            originalPl?.daypart ?? null,
          ).catch(() => null);
          if (candidate && candidate.playlist_id !== playlistId) {
            // 0404 (HOTFIX-A): fallback playlist 도 guardrail hard_block 제외
            const fbTracks = await fetchPlaylistTracks(candidate.playlist_id, userId);
            const fbPlayable = filterPlayableTracks(fbTracks).playable;
            if (fbPlayable.length > 0) {
              playable = fbPlayable;
              playlistId = candidate.playlist_id;
              slotLabel = `${slotLabel} (fallback: ${candidate.title})`;
              fallbackUsed = true;
              if (import.meta.env.DEV) {
                console.warn('[useStartBusinessMode] fallback used', {
                  strategy: candidate.match_strategy,
                  candidate: candidate.title,
                });
              }
            }
          }
          if (playable.length === 0) {
            toast.error('현재 시간대에 재생 가능한 곡이 없습니다. 관리자에게 문의해주세요.');
            return false;
          }
        }
        enableForBusinessMode();
        const playlist = store.playlists.find((p) => p.id === playlistId) ?? null;
        setShuffle(true);
        setRepeat('all');
        // X6.80 — daily seed shuffle: 매장 매일 다른 순서 (오늘 KST 기준)
        setQueue(playable, 0, playlist, null, { dailySeedShuffle: true });
        playAction();
        setBusinessMode(true);
        if (scheduleId) {
          setLastSwitchedScheduleId(scheduleId);
          void logScheduleEvent(userId, scheduleId, playlistId, 'started');
        }
        if (fallbackUsed) {
          toast.info(`${slotLabel} 시작 (${playable.length}곡) — 원본 플리가 비어 자동 대체됨`);
        } else {
          toast.success(`${slotLabel} 시작 (${playable.length}곡)`);
        }
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
