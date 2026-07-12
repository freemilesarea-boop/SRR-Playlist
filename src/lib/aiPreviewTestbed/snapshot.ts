// AI-MUSIC-11 — Candidate snapshot hash (matches the AI-MUSIC-7/8 deterministic FNV-1a over the ordered track-id
// set + version). No crypto, no clock, no randomness. A snapshot mismatch invalidates the approval/candidate.
// Pure & deterministic.

export function computeSnapshotHash(trackIds: string[], version: number): string {
  // Order-sensitive: the queue order is part of the candidate identity.
  const payload = `v${version}:${trackIds.join(',')}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function snapshotMatches(trackIds: string[], version: number, expectedHash: string): boolean {
  return computeSnapshotHash(trackIds, version) === expectedHash;
}
