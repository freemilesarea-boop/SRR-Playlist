// WEB-OBS-1 — Transport pure logic (no browser globals; fully unit-testable).
//
// The stateful browser transport (transport.ts) delegates every decision here so the retry/backoff/
// batch/dedup rules can be tested deterministically. Nothing in this file touches window, fetch,
// navigator, timers, or Date.now — callers pass in the inputs.

import { MAX_BATCH_EVENTS } from './schema';

/** Split a list into chunks no larger than the batch cap (never emits an empty trailing chunk). */
export function splitBatches<T>(items: readonly T[], size = MAX_BATCH_EVENTS): T[][] {
  const cap = Math.max(1, Math.min(size, MAX_BATCH_EVENTS));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += cap) out.push(items.slice(i, i + cap));
  return out;
}

/**
 * Should a failed send be retried, given the HTTP status (or 0 for a network error)?
 *  - 2xx: success, no retry.
 *  - 429: retry (bounded) — server asked us to back off.
 *  - 4xx (except 429): client/permanent error → NEVER retry (would loop forever on bad payload).
 *  - 5xx / 0 (network/offline): retry (bounded).
 */
export function shouldRetry(status: number, attempt: number, maxRetries: number): boolean {
  if (attempt >= maxRetries) return false;
  if (status >= 200 && status < 300) return false;
  if (status === 429) return true;
  if (status >= 400 && status < 500) return false;
  return true; // 5xx or network error (status 0)
}

/**
 * Exponential backoff with full jitter. `rng` is injected (Math.random in prod, seeded in tests).
 * base * 2^attempt, capped, then multiplied by a jitter factor in [0.5, 1].
 */
export function backoffMs(attempt: number, opts?: { baseMs?: number; capMs?: number; rng?: () => number }): number {
  const baseMs = opts?.baseMs ?? 1_000;
  const capMs = opts?.capMs ?? 30_000;
  const rng = opts?.rng ?? Math.random;
  const raw = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt));
  const jitter = 0.5 + rng() * 0.5; // [0.5, 1]
  return Math.round(raw * jitter);
}

/**
 * Bound the buffer: if over `cap`, drop the OLDEST events first — but always preserve error events
 * (errors are never sampled and are the highest-signal). Returns the retained list + dropped count.
 */
export function enforceBufferCap<T extends { event_type: string }>(
  buffer: readonly T[],
  cap: number,
): { kept: T[]; dropped: number } {
  if (buffer.length <= cap) return { kept: [...buffer], dropped: 0 };
  const errors = buffer.filter((e) => e.event_type === 'error');
  const nonErrors = buffer.filter((e) => e.event_type !== 'error');
  // Keep all errors; fill remaining capacity with the NEWEST non-errors.
  const room = Math.max(0, cap - errors.length);
  const keptNonErrors = room >= nonErrors.length ? nonErrors : nonErrors.slice(nonErrors.length - room);
  const kept = [...errors, ...keptNonErrors];
  return { kept, dropped: buffer.length - kept.length };
}

export interface TransportHealth {
  queued: number;
  sent: number;
  accepted: number;
  rejected: number;
  dropped: number;
  retries: number;
  lastFlush: number | null;
  lastSuccess: number | null;
  lastErrorCategory: string | null;
  transportType: 'beacon' | 'fetch' | 'none';
  bufferCapacity: number;
  sampleRate: number;
}

export function emptyHealth(bufferCapacity: number, sampleRate: number): TransportHealth {
  return {
    queued: 0, sent: 0, accepted: 0, rejected: 0, dropped: 0, retries: 0,
    lastFlush: null, lastSuccess: null, lastErrorCategory: null,
    transportType: 'none', bufferCapacity, sampleRate,
  };
}
