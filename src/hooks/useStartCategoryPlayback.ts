import { useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchPlaylistTracks } from '@/lib/api';
import { filterPlayableTracks } from '@/lib/trackPlayability';
import { useAuthStore } from '@/store/authStore';
import { useBusinessStore } from '@/store/businessStore';
import { usePlayerStore } from '@/store/playerStore';
import { usePlaybackSettingsStore } from '@/store/playbackSettingsStore';
import { toast } from '@/store/toastStore';
import { slotScopedKey } from '@/lib/outputSlot';
import type { TrackRow } from '@/types/db';

/** 이 창의 큐를 어떤 카테고리로 만들었는지 — 점주가 카테고리를 바꾸면 다시 만든다. */
const QUEUE_SOURCE_KEY = slotScopedKey('srr.output.queueCategory');

export function getQueueCategory(): string | null {
  try { return localStorage.getItem(QUEUE_SOURCE_KEY); } catch { return null; }
}

function setQueueCategory(c: string): void {
  try { localStorage.setItem(QUEUE_SOURCE_KEY, c); } catch { /* 무시 */ }
}

/**
 * 분리 송출 매장 플레이어 — 점주가 고른 업종 카테고리의 매장 전용 플레이리스트를 합쳐 튼다.
 *
 * 음악은 점주가 직접 고른 카테고리에서만 나온다(운영사가 대신 고르지 않는다).
 * 재생 방식은 매장 모드와 같다: 셔플 + 전체 반복 + 날짜별 시드 순서.
 */
export function useStartCategoryPlayback() {
  const userId = useAuthStore((s) => s.user?.id ?? null);

  return useCallback(async (category: string): Promise<boolean> => {
    try {
      const { data, error } = await supabase
        .from('playlists')
        .select('*')
        .eq('is_business_only', true)
        .or(`business_category.eq.${JSON.stringify(category)},category.eq.${JSON.stringify(category)}`);
      if (error) throw error;
      const playlists = data ?? [];
      if (playlists.length === 0) {
        toast.error(`"${category}" 카테고리에 재생할 플레이리스트가 없어요.`);
        return false;
      }

      const lists = await Promise.all(
        playlists.map((p) => fetchPlaylistTracks(p.id, userId).catch(() => [] as TrackRow[])),
      );
      const seen = new Set<string>();
      const tracks: TrackRow[] = [];
      for (const t of filterPlayableTracks(lists.flat()).playable) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        tracks.push(t);
      }
      if (tracks.length === 0) {
        toast.error(`"${category}" 카테고리에 지금 재생 가능한 곡이 없어요.`);
        return false;
      }

      usePlaybackSettingsStore.getState().enableForBusinessMode();
      const player = usePlayerStore.getState();
      player.setShuffle(true);
      player.setRepeat('all');
      player.setQueue(tracks, 0, null, null, { dailySeedShuffle: true });
      usePlayerStore.getState().play();
      useBusinessStore.getState().setBusinessMode(true);
      setQueueCategory(category);
      toast.success(`${category} 카테고리 재생 (${tracks.length}곡)`);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '재생 시작 실패');
      return false;
    }
  }, [userId]);
}
