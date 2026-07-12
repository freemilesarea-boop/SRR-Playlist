// AI-MUSIC-7 — Candidate queue snapshot validation. Pre-builds/validates the candidate playlist as a queue
// INPUT before any application, and computes a stable snapshot hash over the candidate track-id set (+version)
// so a later mismatch is detectable. It stores NO raw audio URLs, artist PII, tokens, signed URLs, or full
// metadata — only ids/counts/hash. Pure & deterministic (FNV-1a; no randomness). Never applies anything.

import { CANDIDATE_MIN_TRACKS, CANDIDATE_MAX_CHANGE_RATIO_WARN } from './thresholds';
import type { CandidateQueueInput, CandidateQueueResult, CandidateQueueStatus } from './types';

function stableHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function validateCandidateQueue(input: CandidateQueueInput): CandidateQueueResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  // Snapshot hash over ordered track ids + pinned version (stable, deterministic).
  const ids = input.tracks.map((t) => t.trackId);
  const snapshotHash = stableHash(`${input.candidateVersion ?? 'null'}::${ids.join(',')}`);

  if (!input.playlistExists) {
    return { status: 'NOT_AVAILABLE', snapshotHash, usableTrackCount: 0, duplicateCount: 0, blockedTrackCount: 0,
      expectedQueueLength: 0, changeRatio: null, blockers: ['Candidate Playlist 없음'], warnings };
  }
  if (input.expectedVersion != null && input.candidateVersion !== input.expectedVersion) {
    blockers.push(`Candidate Version 불일치 (기대 ${input.expectedVersion} ≠ ${input.candidateVersion})`);
  }

  // Track-level validation.
  const seen = new Set<string>();
  let duplicateCount = 0, blockedTrackCount = 0, usable = 0;
  for (const t of input.tracks) {
    if (seen.has(t.trackId)) { duplicateCount++; continue; }
    seen.add(t.trackId);
    const blocked = !t.hasAudio || !t.mediaSupported || t.disabled || t.qcFailed || !t.industrySuitable;
    if (blocked) { blockedTrackCount++; continue; }
    usable++;
  }
  if (input.tracks.length === 0) blockers.push('Candidate Track 없음 (빈 Playlist)');
  if (usable < Math.max(input.minTracks, CANDIDATE_MIN_TRACKS)) blockers.push(`사용 가능한 Track 부족 (${usable}/${Math.max(input.minTracks, CANDIDATE_MIN_TRACKS)})`);
  if (blockedTrackCount > 0) warnings.push(`차단된 Track ${blockedTrackCount}개 (audio/media/disabled/QC/업종부적합)`);
  if (duplicateCount > 0) warnings.push(`중복 Track ${duplicateCount}개`);
  if (!input.existingItemTypeCompatible) blockers.push('기존 Queue Item Type 과 비호환');

  const expectedQueueLength = usable;
  const changeRatio = input.existingQueueLength > 0
    ? Math.min(1, Math.abs(expectedQueueLength - input.existingQueueLength) / input.existingQueueLength)
    : null;
  if (changeRatio != null && changeRatio >= CANDIDATE_MAX_CHANGE_RATIO_WARN) warnings.push(`기존 Queue 대비 변경 비율 높음 (${(changeRatio * 100).toFixed(0)}%)`);

  let status: CandidateQueueStatus;
  if (input.tracks.length === 0) status = 'INSUFFICIENT_DATA';
  else if (blockers.length > 0) status = 'BLOCKED';
  else if (warnings.length > 0) status = 'READY_WITH_WARNINGS';
  else status = 'READY';

  return { status, snapshotHash, usableTrackCount: usable, duplicateCount, blockedTrackCount, expectedQueueLength, changeRatio, blockers, warnings };
}
