// AI-MUSIC-7 — Existing queue snapshot (observation/audit only — NOT a restore source). Records the existing
// queue state at activation as hashes only (store/session/playlist/current/next). Actual restore always uses
// the existing playlist resolution path, never this snapshot. No audio URLs, titles, artist names, signed URLs,
// or raw queue JSON. Deterministic FNV-1a.

import type { ExistingQueueSnapshotInput, ExistingQueueSnapshot } from './types';

function stableHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
function hashOrNull(v: string | null | undefined): string | null { return v ? stableHash(v) : null; }

export function buildExistingQueueSnapshot(input: ExistingQueueSnapshotInput): ExistingQueueSnapshot {
  const canonical = [
    input.storeId, input.sessionToken, input.playlistId ?? 'null', input.queueLength,
    input.currentTrackId ?? 'null', input.nextTrackId ?? 'null', input.queueSource, input.capturedAt,
  ].join('|');
  return {
    storeIdHash: stableHash(input.storeId),
    sessionHash: stableHash(input.sessionToken),
    playlistHash: hashOrNull(input.playlistId),
    queueLength: input.queueLength,
    currentTrackHash: hashOrNull(input.currentTrackId),
    nextTrackHash: hashOrNull(input.nextTrackId),
    queueSource: input.queueSource,
    capturedAt: input.capturedAt,
    snapshotHash: stableHash(canonical),
  };
}
