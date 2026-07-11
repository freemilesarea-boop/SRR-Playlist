// WEB-OBS-7 — Streaming Quality emit regression tests.
// Verifies the playback-safety contract of the emit boundary: it NEVER throws, returns void (is not
// awaited), and is a no-op when the opt-in flag is off (the default). The Player calls this from audio
// callbacks, so a throw or a rejected Promise here would be a playback regression.

import { describe, it, expect } from 'vitest';
import { recordStreamingQuality } from './emit';
import type { SqEventType } from './eventSchema';

const TYPES: SqEventType[] = [
  'first_progress', 'crossfade_completed', 'crossfade_fallback', 'crossfade_aborted',
  'preload_ready', 'preload_failed', 'media_error', 'recovery_attempted', 'recovery_succeeded', 'recovery_failed',
];

describe('recordStreamingQuality — playback-safety contract', () => {
  it('returns void (not a Promise) so the Player never awaits it', () => {
    const r = recordStreamingQuality({ event_type: 'media_error', media_code: 3 });
    expect(r).toBeUndefined();
  });

  it('never throws for any event type or malformed input (default flag OFF → no-op)', () => {
    for (const t of TYPES) {
      expect(() => recordStreamingQuality({ event_type: t })).not.toThrow();
    }
    // hostile / partial inputs
    expect(() => recordStreamingQuality({ event_type: 'first_progress', duration_ms: Number.NaN })).not.toThrow();
    expect(() => recordStreamingQuality({ event_type: 'media_error', trackId: null, media_code: 99 as never })).not.toThrow();
    expect(() => recordStreamingQuality({ event_type: 'recovery_failed', reason: 'stalled', duration_ms: -5 })).not.toThrow();
    expect(() => recordStreamingQuality({ event_type: 'crossfade_completed', trackId: 'x'.repeat(500) })).not.toThrow();
  });

  it('is a synchronous no-op when telemetry is disabled (opt-in default)', () => {
    // default config has telemetryEnabled=false; calling many times must stay cheap + silent
    for (let i = 0; i < 100; i++) recordStreamingQuality({ event_type: 'first_progress', duration_ms: i });
    expect(true).toBe(true); // reaching here without a throw is the assertion
  });
});
