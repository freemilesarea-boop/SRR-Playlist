// BRAND-DAILY-PLAYLIST-1 — 매일 09:00 KST 새 브랜드 플레이리스트를 무중단으로 반영한다.
//
// 서버(pg_cron, 0508)가 09:00 KST 에 관리자 규칙대로 그날의 스냅샷을 만들고 버전을 올린다.
// 이 훅은 버전만 가볍게 폴링하다가 값이 바뀌면 새 목록을 받아 큐를 교체한다 —
// **재생 중인 곡은 건드리지 않는다**(replaceQueueKeepingCurrent). 24시간 도는 무인 매장에서
// 갱신 때문에 소리가 끊기는 일이 없어야 한다.
//
// 영업시간 모드(business_hours) 브랜드는 같은 응답의 playback 판정으로 재생/정지를 맞춘다.
// 기본값 always_on 브랜드는 이 경로에 걸리지 않는다(24시간 그대로).
import { useEffect, useRef } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { getBrandPlayerConfig, getBrandPlaylistVersion } from '@/lib/api/brandPlayerApi';
import { filterPlayableTracks } from '@/lib/trackPlayability';
import { nextPollDelayMs, shouldSwapPlaylist } from '@/lib/brandPlaylistRefresh';
import type { BrandPlaybackWindow } from '@/types/brand';

interface Args {
  brandId: string | null;
  sessionToken: string | null;
  enabled: boolean;
  /** config 로드 시점에 확인된 버전. 이 값이 폴링 기준선이 된다. */
  playlistVersion: string | null;
  /** 교체 성공 시 페이지 쪽 기준선/표시를 갱신하기 위한 콜백. */
  onSwapped?: (version: string, trackCount: number) => void;
}

/** 영업시간 판정 → 재생 게이트. always_on 이면 아무것도 하지 않는다. */
function applyPlaybackWindow(w: BrandPlaybackWindow | undefined): void {
  if (!w || w.mode !== 'business_hours') return;
  const store = usePlayerStore.getState();
  if (w.should_play) {
    if (store.scheduleSuppressed) {
      store.setScheduleSuppression(null);
      usePlayerStore.getState().play();
    }
  } else if (!store.scheduleSuppressed) {
    store.setScheduleSuppression('closed');
  }
}

export function useBrandDailyPlaylistSync({ brandId, sessionToken, enabled, playlistVersion, onSwapped }: Args): void {
  // 최신 버전 기준선. 폴링 루프가 재시작되지 않도록 ref 로 들고 간다.
  const knownRef = useRef<string | null>(playlistVersion);
  const onSwappedRef = useRef(onSwapped);
  useEffect(() => { knownRef.current = playlistVersion; }, [playlistVersion]);
  useEffect(() => { onSwappedRef.current = onSwapped; }, [onSwapped]);

  useEffect(() => {
    if (!enabled || !brandId || !sessionToken) return;
    let cancelled = false;
    let timer: number | undefined;

    const tick = async (): Promise<void> => {
      try {
        const v = await getBrandPlaylistVersion(brandId, sessionToken);
        if (cancelled) return;
        applyPlaybackWindow(v.playback);

        if (shouldSwapPlaylist(knownRef.current, v.playlist_version)) {
          const cfg = await getBrandPlayerConfig(brandId, sessionToken);
          if (cancelled) return;
          const { playable } = filterPlayableTracks(cfg.playlist ?? []);
          if (playable.length > 0) {
            // 무중단 교체 — 지금 나오는 곡은 그대로 끝까지 재생된다.
            usePlayerStore.getState().replaceQueueKeepingCurrent(playable, undefined, undefined, {
              dailySeedShuffle: true,
            });
            knownRef.current = v.playlist_version;
            onSwappedRef.current?.(v.playlist_version, playable.length);
          }
          // playable 이 0 이면 기준선을 갱신하지 않는다 → 다음 폴링에서 다시 시도.
        }
      } catch {
        // 일시 오류로 재생을 건드리지 않는다. 다음 주기에 다시 확인.
      } finally {
        if (!cancelled) timer = window.setTimeout(() => { void tick(); }, nextPollDelayMs());
      }
    };

    timer = window.setTimeout(() => { void tick(); }, nextPollDelayMs());
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [brandId, sessionToken, enabled]);
}
