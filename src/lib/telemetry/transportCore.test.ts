// WEB-OBS-1 — Transport pure logic: batch / retry / backoff / buffer-cap tests.
import { describe, it, expect } from 'vitest';
import { splitBatches, shouldRetry, backoffMs, enforceBufferCap } from './transportCore';

describe('splitBatches', () => {
  it('chunks into <= size groups with no empty trailing chunk', () => {
    const items = Array.from({ length: 55 }, (_, i) => i);
    const b = splitBatches(items, 20);
    expect(b.map((c) => c.length)).toEqual([20, 20, 15]);
  });
  it('caps size at MAX_BATCH_EVENTS (50)', () => {
    const items = Array.from({ length: 120 }, (_, i) => i);
    const b = splitBatches(items, 1000);
    expect(b[0].length).toBe(50);
  });
  it('returns [] for empty input', () => {
    expect(splitBatches([])).toEqual([]);
  });
});

describe('shouldRetry', () => {
  it('never retries 2xx', () => {
    expect(shouldRetry(202, 0, 3)).toBe(false);
  });
  it('never retries 4xx except 429', () => {
    expect(shouldRetry(400, 0, 3)).toBe(false);
    expect(shouldRetry(413, 0, 3)).toBe(false);
    expect(shouldRetry(415, 0, 3)).toBe(false);
  });
  it('retries 429 (bounded)', () => {
    expect(shouldRetry(429, 0, 3)).toBe(true);
    expect(shouldRetry(429, 3, 3)).toBe(false); // attempt cap reached
  });
  it('retries 5xx and network(0), bounded by maxRetries', () => {
    expect(shouldRetry(500, 0, 3)).toBe(true);
    expect(shouldRetry(0, 1, 3)).toBe(true);
    expect(shouldRetry(503, 3, 3)).toBe(false);
  });
});

describe('backoffMs', () => {
  it('grows exponentially and is capped, with jitter in [0.5,1]', () => {
    const rng = () => 1; // jitter factor 1 → upper bound
    expect(backoffMs(0, { baseMs: 1000, capMs: 30000, rng })).toBe(1000);
    expect(backoffMs(1, { baseMs: 1000, capMs: 30000, rng })).toBe(2000);
    expect(backoffMs(2, { baseMs: 1000, capMs: 30000, rng })).toBe(4000);
    expect(backoffMs(10, { baseMs: 1000, capMs: 30000, rng })).toBe(30000); // capped
  });
  it('applies the lower jitter bound (0.5)', () => {
    const rng = () => 0;
    expect(backoffMs(1, { baseMs: 1000, capMs: 30000, rng })).toBe(1000); // 2000 * 0.5
  });
});

describe('enforceBufferCap', () => {
  const mk = (type: string, n: number) => Array.from({ length: n }, (_, i) => ({ event_type: type, i }));

  it('is a no-op under cap', () => {
    const buf = mk('api', 5);
    const { kept, dropped } = enforceBufferCap(buf, 10);
    expect(dropped).toBe(0);
    expect(kept.length).toBe(5);
  });
  it('drops OLDEST non-errors first when over cap', () => {
    const buf = [{ event_type: 'api', i: 0 }, { event_type: 'api', i: 1 }, { event_type: 'api', i: 2 }];
    const { kept, dropped } = enforceBufferCap(buf, 2);
    expect(dropped).toBe(1);
    // newest two kept
    expect(kept.map((e) => (e as { i: number }).i)).toEqual([1, 2]);
  });
  it('never drops error events (preserved over cap)', () => {
    const buf = [
      { event_type: 'error', i: 0 }, { event_type: 'error', i: 1 }, { event_type: 'error', i: 2 },
      { event_type: 'api', i: 3 }, { event_type: 'api', i: 4 },
    ];
    const { kept } = enforceBufferCap(buf, 3);
    const errs = kept.filter((e) => e.event_type === 'error');
    expect(errs.length).toBe(3); // all errors kept even though cap=3
  });
});
