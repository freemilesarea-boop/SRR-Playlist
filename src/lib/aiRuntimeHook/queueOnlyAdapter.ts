// AI-MUSIC-9 — Queue-only mutation adapter (PURE reducer). Proves — over a snapshot, never the real Zustand
// store — that a candidate queue can be applied by replacing ONLY the queue array + current index while every
// playback field (playing, currentTime, activeAudioIndex, current track) is preserved. It NEVER calls the real
// setQueue, setPlaying, or any audio API. When the current track survives in the candidate it is remapped by
// index; when it does not, the current track is held as the head item and the candidate supplies the tail — so
// the current track is never cut mid-play. Empty candidate / invalid index / non-observable playback → BLOCKED
// (existing queue unchanged). Deterministic.

import type { QueueOnlyMutationInput, QueueOnlyMutation, QueueOnlyMutationResult } from './types';

function base(input: QueueOnlyMutationInput, result: QueueOnlyMutationResult, queue: string[], index: number, reasons: string[]): QueueOnlyMutation {
  return {
    result,
    resultQueueTrackIds: queue,
    resultIndex: index,
    resultCurrentTrackId: input.currentTrackId,     // the current track is ALWAYS preserved
    playingUnchanged: true,
    currentTimeUnchanged: true,
    activeAudioIndexUnchanged: true,
    currentTrackUnchanged: true,
    setQueueCalled: false,
    setPlayingCalled: false,
    audioApiCalled: false,
    reasons,
  };
}

export function computeQueueOnlyMutation(input: QueueOnlyMutationInput): QueueOnlyMutation {
  const existing = input.existingQueueTrackIds;
  // Not observable at runtime → refuse to compute a mutation (fail closed to existing).
  if (!input.playback.observable) return base(input, 'BLOCKED_NOT_OBSERVABLE', existing, input.currentIndex, ['Playback State 관측 불가 — 기존 Queue 유지']);
  if (input.candidateQueueTrackIds.length === 0) return base(input, 'BLOCKED_EMPTY_CANDIDATE', existing, input.currentIndex, ['빈 Candidate — 기존 Queue 유지']);
  if (input.currentIndex < 0 || input.currentIndex >= existing.length) {
    return base(input, 'BLOCKED_INVALID_INDEX', existing, input.currentIndex, ['현재 Index 무효 — 기존 Queue 유지']);
  }

  const cand = input.candidateQueueTrackIds;
  // Identical queue → no change.
  if (cand.length === existing.length && cand.every((t, i) => t === existing[i])) {
    return base(input, 'NO_CHANGE', existing, input.currentIndex, ['Candidate 가 기존 Queue 와 동일']);
  }

  const cur = input.currentTrackId;
  if (cur != null) {
    const posInCand = cand.indexOf(cur);
    if (posInCand >= 0) {
      // Current track survives in the candidate → replace queue, remap index only.
      return base(input, 'QUEUE_REPLACED_PRESERVING_PLAYBACK', cand, posInCand, ['현재 Track 이 Candidate 에 존재 → Queue 교체 + Index 재매핑 (재생 필드 불변)']);
    }
    // Current track missing → hold it as the head item, candidate supplies the tail (dedup the current track).
    const tail = cand.filter((t) => t !== cur);
    return base(input, 'CURRENT_TRACK_HELD_AS_HEAD', [cur, ...tail], 0, ['현재 Track 이 Candidate 에 없음 → 현재 Track 을 Head 로 유지하고 다음부터 Candidate 사용']);
  }

  // No current track (idle/session start) → the candidate becomes the queue at index 0.
  return base(input, 'QUEUE_REPLACED_PRESERVING_PLAYBACK', cand, 0, ['현재 Track 없음(Idle) → Candidate 를 Queue 로 설정 (재생 미시작)']);
}
