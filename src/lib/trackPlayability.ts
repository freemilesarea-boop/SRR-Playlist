import type { TrackRow } from '@/types/db';
import { isPlayableTrack, isPlayableUrl } from './audio';

/**
 * 트랙 재생 가능성 상태.
 * - 'ready':      audio_url 정상, 즉시 재생 가능
 * - 'processing': 업로드/트랜스코딩 중 (DB 에 별도 status 컬럼이 있을 때만 — 현재는 미사용 placeholder)
 * - 'missing':    audio_url 이 빈 문자열/null
 * - 'error':      audio_url 은 있으나 형식이 깨졌거나 url 파싱 실패
 */
export type TrackPlaybackState = 'ready' | 'processing' | 'missing' | 'error';

/** 관리자 삭제(removed)·숨김(hidden) 트랙 여부 — 객체에 해당 필드가 있을 때만 검사(선택적). */
function isRemovedOrHidden(track: { release_status?: string | null; visibility_status?: string | null; removed_at?: string | null }): boolean {
  return track.release_status === 'removed' || track.visibility_status === 'hidden' || track.removed_at != null;
}

export function getTrackPlaybackState(
  track: Pick<TrackRow, 'audio_url'> & { release_status?: string | null; visibility_status?: string | null; removed_at?: string | null },
): TrackPlaybackState {
  if (isRemovedOrHidden(track)) return 'missing';
  const url = track.audio_url;
  if (url == null) return 'missing';
  const trimmed = typeof url === 'string' ? url.trim() : '';
  if (trimmed.length === 0) return 'missing';
  if (!isPlayableUrl(trimmed)) return 'error';
  return 'ready';
}

/** 사람 읽기용 라벨 (UI 배지/툴팁용) */
export function trackPlaybackStateLabel(state: TrackPlaybackState): string {
  switch (state) {
    case 'ready':
      return '재생 가능';
    case 'processing':
      return '준비 중';
    case 'missing':
      return '음원 없음';
    case 'error':
      return '재생 불가';
  }
}

export interface FilterPlayableResult<T extends Pick<TrackRow, 'audio_url'>> {
  playable: T[];
  dropped: T[];
}

/**
 * 큐/재생 후보에서 재생 불가 트랙을 떼어내고 둘로 반환.
 * 호출자는 dropped.length > 0 일 때 toast 등으로 사용자에게 알릴 수 있음.
 *
 * @example
 *   const { playable, dropped } = filterPlayableTracks(tracks);
 *   if (playable.length === 0) { toast.info('재생 가능한 음원이 없어요.'); return; }
 *   if (dropped.length > 0) toast.info(`재생 불가 ${dropped.length}곡 제외`);
 *   setQueue(playable, resolvedStart, playlist);
 */
export function filterPlayableTracks<T extends Pick<TrackRow, 'audio_url'>>(
  tracks: T[],
): FilterPlayableResult<T> {
  const playable: T[] = [];
  const dropped: T[] = [];
  for (const t of tracks) {
    // 삭제/숨김 트랙은 재생 후보에서 제외 + audio_url 정상 검사
    if (!isRemovedOrHidden(t as { release_status?: string | null; visibility_status?: string | null; removed_at?: string | null }) && isPlayableUrl(t.audio_url)) {
      playable.push(t);
    } else {
      dropped.push(t);
    }
  }
  return { playable, dropped };
}

// 기존 헬퍼 재노출 (호출자가 한 곳에서 import 가능하도록)
export { isPlayableTrack, isPlayableUrl };
