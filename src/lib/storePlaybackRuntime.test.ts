import { describe, it, expect } from 'vitest';
import type { StorePlaybackResolution } from '@/lib/api/franchiseApi';
import type { RotationSet } from '@/lib/storePlaybackPolicy';
import {
  mapResolutionToRuntimeState,
  parseTimestampMs,
  computeTransitionDelayMs,
  recordSetPlay,
  advanceRotation,
  EMPTY_ROTATION_MEMORY,
  MAX_TIMEOUT_MS,
} from '@/lib/storePlaybackRuntime';

// Minimal valid resolver response; override per-test.
function res(over: Partial<StorePlaybackResolution>): StorePlaybackResolution {
  return {
    mode: 'play',
    source: 'brand_schedule',
    has_franchise_policy: true,
    timezone: 'Asia/Seoul',
    matched_slot: null,
    playlist_set_id: null,
    playlist_id: 'pl-1',
    next_transition_at: '2026-07-25T13:00:00.000Z',
    computed_at: '2026-07-25T12:00:00.000Z',
    ...over,
  };
}

describe('mapResolutionToRuntimeState — policy mapping (§4/§5/§20)', () => {
  it('has_franchise_policy=false → fallback (legacy), ignoring resolver mode=closed', () => {
    const d = mapResolutionToRuntimeState(
      res({ has_franchise_policy: false, mode: 'closed', source: 'fallback', playlist_id: null }),
    );
    expect(d.state).toBe('fallback');
    expect(d.useLegacyPlayback).toBe(true);
    expect(d.suppressPlayback).toBe(false); // must NOT be forced closed
    expect(d.suppressReason).toBeNull();
  });

  it('mode=play with a playlist → play (not suppressed)', () => {
    const d = mapResolutionToRuntimeState(res({ mode: 'play', playlist_id: 'pl-42' }));
    expect(d.state).toBe('play');
    expect(d.suppressPlayback).toBe(false);
    expect(d.playlistId).toBe('pl-42');
    expect(d.reason).toBe('ok');
  });

  it('mode=break → break, suppressed with reason=break, queue preserved (no playlist load)', () => {
    const d = mapResolutionToRuntimeState(res({ mode: 'break', playlist_id: null }));
    expect(d.state).toBe('break');
    expect(d.suppressPlayback).toBe(true);
    expect(d.suppressReason).toBe('break');
    expect(d.playlistId).toBeNull();
  });

  it('mode=closed → closed, suppressed with reason=closed', () => {
    const d = mapResolutionToRuntimeState(res({ mode: 'closed', playlist_id: null }));
    expect(d.state).toBe('closed');
    expect(d.suppressPlayback).toBe(true);
    expect(d.suppressReason).toBe('closed');
  });

  it('unknown mode → error (never guessed as play)', () => {
    const d = mapResolutionToRuntimeState(
      res({ mode: 'weird' as unknown as StorePlaybackResolution['mode'] }),
    );
    expect(d.state).toBe('error');
    expect(d.suppressPlayback).toBe(false);
    expect(d.anomalies).toContain('unknown_mode');
  });

  it('mode=play with null playlist → error (never silently plays)', () => {
    const d = mapResolutionToRuntimeState(res({ mode: 'play', playlist_id: null }));
    expect(d.state).toBe('error');
    expect(d.suppressPlayback).toBe(false);
    expect(d.anomalies).toContain('play_without_playlist');
  });

  it('mode=break carrying a stray playlist_id → still break, anomaly flagged', () => {
    const d = mapResolutionToRuntimeState(res({ mode: 'break', playlist_id: 'pl-stale' }));
    expect(d.state).toBe('break');
    expect(d.suppressPlayback).toBe(true);
    expect(d.anomalies).toContain('break_with_playlist');
  });

  it('null resolution while loading → policy_loading', () => {
    const d = mapResolutionToRuntimeState(null, { loading: true });
    expect(d.state).toBe('policy_loading');
  });

  it('null resolution when not loading → error (fail-safe, not closed)', () => {
    const d = mapResolutionToRuntimeState(null);
    expect(d.state).toBe('error');
    expect(d.suppressPlayback).toBe(false);
  });

  it('unknown source → anomaly but still maps by mode', () => {
    const d = mapResolutionToRuntimeState(
      res({ mode: 'play', source: 'mystery' as unknown as StorePlaybackResolution['source'] }),
    );
    expect(d.state).toBe('play');
    expect(d.source).toBeNull();
    expect(d.anomalies).toContain('unknown_source');
  });

  it('carries timezone + validated next_transition into the decision', () => {
    const d = mapResolutionToRuntimeState(
      res({ timezone: 'America/New_York', next_transition_at: '2026-07-25T13:30:00.000Z' }),
    );
    expect(d.timezone).toBe('America/New_York');
    expect(d.nextTransitionAtMs).toBe(Date.parse('2026-07-25T13:30:00.000Z'));
  });

  it('invalid next_transition_at → null + anomaly, no crash', () => {
    const d = mapResolutionToRuntimeState(res({ next_transition_at: 'not-a-date' }));
    expect(d.nextTransitionAtMs).toBeNull();
    expect(d.anomalies).toContain('invalid_next_transition_at');
  });

  it('missing timezone → anomaly flagged', () => {
    const d = mapResolutionToRuntimeState(
      res({ timezone: '' as unknown as string }),
    );
    expect(d.anomalies).toContain('missing_timezone');
  });
});

describe('parseTimestampMs', () => {
  it('parses a valid ISO string', () => {
    expect(parseTimestampMs('2026-07-25T00:00:00.000Z')).toBe(Date.parse('2026-07-25T00:00:00.000Z'));
  });
  it('returns null for null/empty/invalid', () => {
    expect(parseTimestampMs(null)).toBeNull();
    expect(parseTimestampMs(undefined)).toBeNull();
    expect(parseTimestampMs('')).toBeNull();
    expect(parseTimestampMs('garbage')).toBeNull();
  });
});

describe('computeTransitionDelayMs — scheduler math (§11)', () => {
  const now = Date.parse('2026-07-25T12:00:00.000Z');

  it('future transition → positive delay incl. buffer', () => {
    const next = now + 60_000;
    expect(computeTransitionDelayMs(next, now, 1_000)).toBe(61_000);
  });

  it('past transition → 0 (re-evaluate immediately)', () => {
    expect(computeTransitionDelayMs(now - 5_000, now)).toBe(0);
  });

  it('exactly now → buffer only', () => {
    expect(computeTransitionDelayMs(now, now, 1_000)).toBe(1_000);
  });

  it('null transition → null (no timer)', () => {
    expect(computeTransitionDelayMs(null, now)).toBeNull();
  });

  it('over-long delay is clamped to MAX_TIMEOUT_MS (chunked reschedule)', () => {
    const next = now + MAX_TIMEOUT_MS * 4;
    expect(computeTransitionDelayMs(next, now, 0)).toBe(MAX_TIMEOUT_MS);
  });
});

describe('rotation memory (§7) — deterministic, reuses certified core', () => {
  it('recordSetPlay stores a non-null set id', () => {
    const m = recordSetPlay(EMPTY_ROTATION_MEMORY, 'set-a', 100);
    expect(m.lastSetId).toBe('set-a');
    expect(m.lastAtMs).toBe(100);
  });

  it('recordSetPlay leaves memory unchanged for a null set id', () => {
    const start = { lastSetId: 'set-a', lastAtMs: 1 };
    expect(recordSetPlay(start, null, 999)).toBe(start);
  });

  it('recordSetPlay for the same set only bumps the timestamp', () => {
    const m = recordSetPlay({ lastSetId: 'set-a', lastAtMs: 1 }, 'set-a', 50);
    expect(m.lastSetId).toBe('set-a');
    expect(m.lastAtMs).toBe(50);
  });

  const at = Date.parse('2026-07-25T12:00:00.000Z');
  const pool: RotationSet[] = [
    { id: 'a', rotationOrder: 0, isActive: true },
    { id: 'b', rotationOrder: 1, isActive: true },
    { id: 'c', rotationOrder: 2, isActive: false }, // inactive
    { id: 'd', rotationOrder: 3, isActive: true, validFromMs: at + 86_400_000 }, // future
    { id: 'e', rotationOrder: 4, isActive: true, validUntilMs: at - 86_400_000 }, // expired
  ];

  it('advanceRotation picks the first eligible active/in-window set from empty memory', () => {
    const { set, memory } = advanceRotation(pool, EMPTY_ROTATION_MEMORY, at);
    expect(set?.id).toBe('a');
    expect(memory.lastSetId).toBe('a');
  });

  it('advanceRotation advances deterministically and avoids immediate repeat', () => {
    const first = advanceRotation(pool, EMPTY_ROTATION_MEMORY, at);
    const second = advanceRotation(pool, first.memory, at);
    expect(first.set?.id).toBe('a');
    expect(second.set?.id).toBe('b'); // only a & b eligible → rotate to b
  });

  it('advanceRotation excludes inactive/future/expired sets', () => {
    const eligibleIds = new Set<string>();
    let mem = EMPTY_ROTATION_MEMORY;
    for (let i = 0; i < 6; i++) {
      const r = advanceRotation(pool, mem, at);
      if (r.set) eligibleIds.add(r.set.id);
      mem = r.memory;
    }
    expect([...eligibleIds].sort()).toEqual(['a', 'b']);
  });

  it('advanceRotation returns null (no-set fallback) when the pool is empty', () => {
    const { set, memory } = advanceRotation([], EMPTY_ROTATION_MEMORY, at);
    expect(set).toBeNull();
    expect(memory).toBe(EMPTY_ROTATION_MEMORY);
  });
});
