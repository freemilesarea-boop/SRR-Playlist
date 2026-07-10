// WEB-OBS-1 — Session-stable sampling (pure, unit-testable, no browser globals).
//
// Requirement (phase spec): "sampling decision은 세션 단위로 안정적" — the same session must not
// flicker in/out per event. We derive a stable u ∈ [0,1) from a hash of (session_id + type) and
// keep the stream iff u < rate. A whole session is therefore either fully IN or fully OUT of a
// given event type's sampled stream — deterministic, no per-event RNG, reproducible in tests.
//
// Errors are never sampled: sampleRateFor() returns 1 for 'error', so u < 1 is always true.

import type { TelemetryEventType } from './schema';
import { sampleRateFor } from './config';

/** FNV-1a 32-bit — small, fast, dependency-free, good enough for uniform bucketing. */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // h *= 16777619 (FNV prime), kept in 32-bit via Math.imul.
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0; // unsigned
}

/** Stable uniform value in [0,1) for a (session, type) pair. */
export function sessionUniform(sessionId: string, type: string): number {
  return hash32(`${sessionId}:${type}`) / 0x100000000; // divide by 2^32
}

/**
 * Decide whether this session keeps the given event type's stream, and at what recorded rate.
 * Returns `{ keep, rate }` — `rate` is what we stamp on the envelope's `sample_rate` (so the server
 * can reconstruct true counts). Errors → always keep, rate 1.
 */
export function decideSampling(
  sessionId: string,
  type: TelemetryEventType,
  base: number,
): { keep: boolean; rate: number } {
  const rate = sampleRateFor(type, base);
  if (rate >= 1) return { keep: true, rate: 1 };
  if (rate <= 0) return { keep: false, rate };
  const u = sessionUniform(sessionId, type);
  return { keep: u < rate, rate: Math.round(rate * 10000) / 10000 };
}
