import { describe, it, expect } from 'vitest';
import {
  isPlaylistCycleComplete,
  shouldConsumeCycleEvent,
  type CycleCompleteInput,
  type PlaylistCycleEvent,
  type CycleConsumeContext,
} from '@/lib/playerCycleCompletion';

function inp(over: Partial<CycleCompleteInput>): CycleCompleteInput {
  return {
    cause: 'audio_ended',
    repeat: 'all',
    queueLength: 3,
    index: 2,
    shuffle: false,
    shuffleOrder: [],
    ...over,
  };
}

describe('isPlaylistCycleComplete — emit decision (§17)', () => {
  it('multi-track: last track auto-ended → cycle complete', () => {
    expect(isPlaylistCycleComplete(inp({ index: 2, queueLength: 3 }))).toBe(true);
  });
  it('multi-track: middle track auto-ended → no cycle', () => {
    expect(isPlaylistCycleComplete(inp({ index: 1, queueLength: 3 }))).toBe(false);
  });
  it('single-track: auto-ended → cycle complete', () => {
    expect(isPlaylistCycleComplete(inp({ index: 0, queueLength: 1 }))).toBe(true);
  });
  it('manual next → no cycle', () => {
    expect(isPlaylistCycleComplete(inp({ cause: 'manual_next' }))).toBe(false);
  });
  it('skip-on-error → no cycle', () => {
    expect(isPlaylistCycleComplete(inp({ cause: 'skip_error' }))).toBe(false);
  });
  it('repeat=one → never a playlist cycle', () => {
    expect(isPlaylistCycleComplete(inp({ repeat: 'one', queueLength: 1, index: 0 }))).toBe(false);
    expect(isPlaylistCycleComplete(inp({ repeat: 'one', queueLength: 3, index: 2 }))).toBe(false);
  });
  it('repeat=off: last track auto-ended still completes the pass', () => {
    expect(isPlaylistCycleComplete(inp({ repeat: 'off', index: 2, queueLength: 3 }))).toBe(true);
  });
  it('queue length 0 → no cycle', () => {
    expect(isPlaylistCycleComplete(inp({ queueLength: 0, index: 0 }))).toBe(false);
  });
  it('shuffle: last position in shuffle order → cycle complete', () => {
    // shuffleOrder [2,0,1]; index 1 is the last play-order position.
    expect(isPlaylistCycleComplete(inp({ shuffle: true, shuffleOrder: [2, 0, 1], index: 1 }))).toBe(true);
  });
  it('shuffle: non-last position → no cycle', () => {
    expect(isPlaylistCycleComplete(inp({ shuffle: true, shuffleOrder: [2, 0, 1], index: 0 }))).toBe(false);
  });
  it('shuffle order stale (index not present) → linear fallback', () => {
    // shuffleOrder doesn't contain index 2 → linear: index===len-1 → true.
    expect(isPlaylistCycleComplete(inp({ shuffle: true, shuffleOrder: [0, 1], index: 2, queueLength: 3 }))).toBe(true);
  });
});

function evt(over: Partial<PlaylistCycleEvent> = {}): PlaylistCycleEvent {
  return {
    sequence: 5,
    playlistId: 'pl-1',
    queueGeneration: 10,
    trackId: 't-9',
    completedAt: 1000,
    cause: 'audio_ended',
    ...over,
  };
}

function ctx(over: Partial<CycleConsumeContext> = {}): CycleConsumeContext {
  return {
    active: true,
    suppressed: false,
    currentQueueGeneration: 10,
    currentPlaylistId: 'pl-1',
    lastHandledSequence: 4,
    poolSize: 2,
    rotating: false,
    ...over,
  };
}

describe('shouldConsumeCycleEvent — consumer gate (§18)', () => {
  it('valid cycle event → consume', () => {
    expect(shouldConsumeCycleEvent(evt(), ctx()).consume).toBe(true);
  });
  it('no event → reject', () => {
    expect(shouldConsumeCycleEvent(null, ctx()).reason).toBe('no_event');
  });
  it('already-handled sequence → reject (idempotency)', () => {
    expect(shouldConsumeCycleEvent(evt({ sequence: 4 }), ctx({ lastHandledSequence: 4 })).reason).toBe('already_handled');
  });
  it('duplicate lower sequence → reject', () => {
    expect(shouldConsumeCycleEvent(evt({ sequence: 3 }), ctx({ lastHandledSequence: 4 })).consume).toBe(false);
  });
  it('inactive (legacy/fallback) → reject', () => {
    expect(shouldConsumeCycleEvent(evt(), ctx({ active: false })).reason).toBe('not_active');
  });
  it('break/closed suppressed → reject', () => {
    expect(shouldConsumeCycleEvent(evt(), ctx({ suppressed: true })).reason).toBe('suppressed');
  });
  it('rotation already in flight → reject', () => {
    expect(shouldConsumeCycleEvent(evt(), ctx({ rotating: true })).reason).toBe('rotating');
  });
  it('stale queue generation → reject', () => {
    expect(shouldConsumeCycleEvent(evt({ queueGeneration: 9 }), ctx({ currentQueueGeneration: 10 })).reason).toBe('stale_generation');
  });
  it('playlist identity mismatch → reject', () => {
    expect(shouldConsumeCycleEvent(evt({ playlistId: 'other' }), ctx({ currentPlaylistId: 'pl-1' })).reason).toBe('playlist_mismatch');
  });
  it('pool < 2 → reject', () => {
    expect(shouldConsumeCycleEvent(evt(), ctx({ poolSize: 1 })).reason).toBe('pool_lt_2');
  });
});
