import type { TrackRow } from '@/types/db';
import { isTrackBlocked } from './failedTracks';

export function isPlayableUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (url.trim().length === 0) return false;
  try {
    const u = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://x');
    return ['http:', 'https:', 'blob:', 'data:'].includes(u.protocol);
  } catch {
    return false;
  }
}

export function isPlayableTrack(t: TrackRow | undefined | null): boolean {
  if (!t) return false;
  // 이 기기에서 반복 실패로 내려둔 음원은 큐에 넣지 않는다(failedTracks.ts).
  // setQueue 의 마지막 안전망 — 호출 측이 filterPlayableTracks 를 잊어도 걸러진다.
  if (isTrackBlocked(t.id)) return false;
  return isPlayableUrl(t.audio_url);
}

export function countPlayable(tracks: TrackRow[]): number {
  return tracks.filter(isPlayableTrack).length;
}
