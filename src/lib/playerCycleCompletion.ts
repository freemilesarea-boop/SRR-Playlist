/**
 * playerCycleCompletion — pure logic for the explicit "playlist cycle completed" runtime
 * signal (BRAND-PLAYLIST-ROTATION-4C).
 *
 * The Store Player rotates curated playlist sets when the CURRENT playlist finishes one full
 * pass. Detecting that from queue-index movement alone is ambiguous (single-track queues never
 * change index; a manual prev on a 2-track queue looks like a wrap). Instead, playerStore.next()
 * emits an explicit cycle-completion event ONLY on a real audio-ended that lands on the last
 * play-order position (or a single-track queue). This module is the framework-free core that
 * both the emit decision (isPlaylistCycleComplete) and the consumer gate (shouldConsumeCycleEvent)
 * share, so the rules are unit-testable without a store, a DOM, or audio.
 */

/** Why next() was called. Only 'audio_ended' can complete a playlist cycle. */
export type NextCause = 'audio_ended' | 'manual_next' | 'skip_error';

/** Emitted by playerStore when the current playlist completes one automatic pass. */
export interface PlaylistCycleEvent {
  /** monotonically increasing; consumers track the last handled value (never a boolean flag). */
  sequence: number;
  /** identity of the playlist that completed (playerStore.playlist?.id at emit time). */
  playlistId: string | null;
  /** queue generation at emit time — lets consumers reject a stale event after a queue swap. */
  queueGeneration: number;
  /** the track whose audio ended to complete the cycle. */
  trackId: string | null;
  /** epoch ms of completion. */
  completedAt: number;
  /** always 'audio_ended' — the only cause that emits. */
  cause: 'audio_ended';
}

export interface CycleCompleteInput {
  cause: NextCause;
  repeat: 'off' | 'all' | 'one';
  queueLength: number;
  index: number;
  shuffle: boolean;
  shuffleOrder: number[];
}

/**
 * True when an audio-ended at this queue state completes one full playlist pass. Pure.
 *  - only 'audio_ended' qualifies (manual next/prev/jump/skip never do)
 *  - repeat='one' repeats a single track → NOT a playlist cycle
 *  - a single-track queue: each real ended = one cycle
 *  - otherwise: true only on the LAST play-order position (shuffle-aware)
 */
export function isPlaylistCycleComplete(p: CycleCompleteInput): boolean {
  if (p.cause !== 'audio_ended') return false;
  if (p.queueLength <= 0) return false;
  if (p.repeat === 'one') return false;
  if (p.queueLength === 1) return true;
  if (p.shuffle && p.shuffleOrder.length === p.queueLength) {
    const pos = p.shuffleOrder.indexOf(p.index);
    if (pos !== -1) return pos === p.queueLength - 1;
    // shuffleOrder doesn't contain index (queue changed) → fall back to linear.
  }
  return p.index === p.queueLength - 1;
}

export interface CycleConsumeContext {
  /** enabled && storeId && resolver mode === 'play'. */
  active: boolean;
  /** playerStore.scheduleSuppressed (break/closed). */
  suppressed: boolean;
  /** playerStore.queueGeneration right now. */
  currentQueueGeneration: number;
  /** the playlist id currently loaded in the queue. */
  currentPlaylistId: string | null;
  /** highest sequence the consumer has already acted on. */
  lastHandledSequence: number;
  /** number of eligible sets in the rotation pool. */
  poolSize: number;
  /** a rotation load is already in flight. */
  rotating: boolean;
}

export interface CycleConsumeDecision {
  consume: boolean;
  reason: string;
}

/**
 * Decide whether the rotation consumer should act on a cycle event. Pure. Rejects:
 *  - no event / non-audio_ended cause
 *  - an already-handled sequence (idempotency across StrictMode + rapid events)
 *  - inactive / suppressed (break/closed/legacy/fallback) — never rotate
 *  - a rotation already in flight
 *  - stale queue generation (a queue swap happened after emit)
 *  - a completed playlist that no longer matches what's loaded
 *  - a pool that can't rotate (< 2 sets)
 */
export function shouldConsumeCycleEvent(
  event: PlaylistCycleEvent | null,
  ctx: CycleConsumeContext,
): CycleConsumeDecision {
  if (event == null) return { consume: false, reason: 'no_event' };
  if (event.cause !== 'audio_ended') return { consume: false, reason: 'not_audio_ended' };
  if (event.sequence <= ctx.lastHandledSequence) return { consume: false, reason: 'already_handled' };
  if (!ctx.active) return { consume: false, reason: 'not_active' };
  if (ctx.suppressed) return { consume: false, reason: 'suppressed' };
  if (ctx.rotating) return { consume: false, reason: 'rotating' };
  if (event.queueGeneration !== ctx.currentQueueGeneration) {
    return { consume: false, reason: 'stale_generation' };
  }
  if (event.playlistId !== ctx.currentPlaylistId) {
    return { consume: false, reason: 'playlist_mismatch' };
  }
  if (ctx.poolSize < 2) return { consume: false, reason: 'pool_lt_2' };
  return { consume: true, reason: 'ok' };
}
