import type { TrackRow } from '@/types/db';

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
  return isPlayableUrl(t.audio_url);
}

export function countPlayable(tracks: TrackRow[]): number {
  return tracks.filter(isPlayableTrack).length;
}
