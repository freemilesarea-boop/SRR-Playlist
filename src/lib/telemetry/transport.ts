// WEB-OBS-1 — Client Telemetry Transport.
//
// Turns the collector's PII-free "raw emits" into sampled, batched, sanitized envelopes and ships
// them to the same-origin ingestion endpoint. Design contract (phase spec):
//   • NEVER block boot or the main thread — init is deferred; flush is timer/visibility driven.
//   • Fail-OPEN — any transport error is swallowed; a telemetry failure never surfaces to the user,
//     never toasts, never throws into app code. No console spam (single throttled warn max).
//   • sendBeacon first (survives unload), fetch(keepalive) fallback.
//   • Bounded buffer, bounded retries (5xx/429/network only — 4xx never retried), backoff+jitter.
//   • Offline aware: pause sends while offline, resume on 'online'.
//   • Memory-first: no unbounded localStorage queue. Losing a tab's tail on close is acceptable —
//     user stability outweighs telemetry completeness.
//   • Self-referential loop guard: transport errors are NOT re-emitted as telemetry.

import { setTelemetrySink, getDeviceProfile, type RawTelemetryEmit } from './collect';
import { getTelemetryConfig } from './config';
import { decideSampling } from './sampling';
import { getSessionId, nextSequence, newEventId, buildDeviceDims } from './session';
import {
  parseEnvelope, TELEMETRY_EVENT_VERSION, type TelemetryEvent, type TelemetryEventType,
} from './schema';
import {
  splitBatches, shouldRetry, backoffMs, enforceBufferCap, emptyHealth, type TransportHealth,
} from './transportCore';

const MAX_RETRIES = 3;

let started = false;
let buffer: TelemetryEvent[] = [];
const seenIds = new Set<string>();
let flushTimer: number | null = null;
let flushing = false;
let online = true;
let warnedOnce = false;

let cfg = getTelemetryConfig();
let health: TransportHealth = emptyHealth(cfg.maxBuffer, cfg.baseSampleRate);

/** Read-only snapshot of transport health for the dashboard. Never throws. */
export function getTransportHealth(): TransportHealth {
  return { ...health, queued: buffer.length };
}

function warnOnce(msg: string): void {
  if (warnedOnce) return;
  warnedOnce = true;
  try { console.warn(`[telemetry-transport] ${msg} (further transport warnings suppressed)`); } catch { /* noop */ }
}

// ---------------------------------------------------------------------------
// Envelope assembly (sampling + device dims + sanitize via parseEnvelope)
// ---------------------------------------------------------------------------
function buildEnvelope(raw: RawTelemetryEmit): TelemetryEvent | null {
  const sessionId = getSessionId();
  const { keep, rate } = decideSampling(sessionId, raw.type as TelemetryEventType, cfg.baseSampleRate);
  if (!keep) return null;

  const seq = nextSequence();
  const ua = (() => { try { return navigator.userAgent || ''; } catch { return ''; } })();
  const dims = buildDeviceDims(getDeviceProfile(), ua);

  const candidate = {
    event_id: newEventId(sessionId, seq),
    event_type: raw.type,
    event_version: TELEMETRY_EVENT_VERSION,
    session_id: sessionId,
    sequence: seq,
    occurred_at: raw.occurredAt,
    release: cfg.release,
    environment: cfg.environment,
    route: raw.route,
    previous_route: raw.previousRoute,
    duration_ms: raw.durationMs,
    severity: raw.severity,
    sample_rate: rate,
    ...dims,
    payload: raw.payload,
  };

  // parseEnvelope is the SAME validator the server runs → client-side pre-sanitization ("double
  // sanitization"). It rebuilds from an allow-list and drops anything unexpected.
  const res = parseEnvelope(candidate);
  return res.ok && res.event ? res.event : null;
}

function enqueue(raw: RawTelemetryEmit): void {
  if (!cfg.transportEnabled) return;
  try {
    const ev = buildEnvelope(raw);
    if (!ev) return;
    if (seenIds.has(ev.event_id)) return; // dedup within the session
    seenIds.add(ev.event_id);
    buffer.push(ev);
    // Bound the buffer (errors preserved, oldest non-errors dropped).
    const { kept, dropped } = enforceBufferCap(buffer, cfg.maxBuffer);
    if (dropped > 0) { buffer = kept; health.dropped += dropped; }
    if (buffer.length >= cfg.batchSize) void flush('batch');
  } catch { /* never let enqueue throw into collection */ }
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------
function sendBeacon(body: string): boolean {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return false;
    const blob = new Blob([body], { type: 'application/json' });
    const ok = navigator.sendBeacon(cfg.endpoint, blob);
    if (ok) health.transportType = 'beacon';
    return ok;
  } catch { return false; }
}

async function sendFetch(body: string): Promise<number> {
  try {
    const res = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
      // Telemetry is fire-and-forget; never send credentials/cookies with it.
      credentials: 'omit',
      cache: 'no-store',
    });
    health.transportType = 'fetch';
    return res.status;
  } catch {
    return 0; // network error
  }
}

async function sendBatch(events: TelemetryEvent[], useBeacon: boolean): Promise<boolean> {
  const body = JSON.stringify({ events });
  health.lastFlush = Date.now();
  health.sent += events.length;

  // On unload paths, prefer beacon (fetch may be cancelled). No retry there — best effort.
  if (useBeacon && sendBeacon(body)) {
    health.accepted += events.length; // beacon gives no status; assume queued by the UA
    health.lastSuccess = Date.now();
    return true;
  }

  let attempt = 0;
  for (;;) {
    const status = await sendFetch(body);
    if (status >= 200 && status < 300) {
      health.accepted += events.length;
      health.lastSuccess = Date.now();
      return true;
    }
    health.lastErrorCategory = status === 0 ? 'network' : status === 429 ? 'rate_limit' : status >= 500 ? 'server' : 'client';
    if (status >= 400 && status < 500 && status !== 429) {
      // Permanent: drop the batch (malformed/rejected). Do NOT retry, do NOT re-emit.
      health.rejected += events.length;
      warnOnce(`batch rejected (${status})`);
      return false;
    }
    if (!shouldRetry(status, attempt, MAX_RETRIES)) {
      health.rejected += events.length;
      return false;
    }
    attempt++;
    health.retries++;
    await sleep(backoffMs(attempt));
    if (!online) return false; // went offline mid-retry; keep events for next online flush
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { try { window.setTimeout(resolve, ms); } catch { resolve(); } });
}

/** Flush the buffer. `reason` is diagnostic only. Uses beacon on unload reasons. */
async function flush(reason: 'batch' | 'interval' | 'visibility' | 'pagehide' | 'online'): Promise<void> {
  if (flushing || buffer.length === 0) return;
  if (!cfg.transportEnabled) { buffer = []; return; }
  if (!online && reason !== 'pagehide' && reason !== 'visibility') return; // offline: wait (but still try beacon on unload)

  flushing = true;
  const unload = reason === 'pagehide' || reason === 'visibility';
  try {
    const toSend = buffer;
    buffer = [];
    for (const batch of splitBatches(toSend)) {
      const ok = await sendBatch(batch, unload);
      if (!ok && !unload) {
        // Retriable failure exhausted: re-buffer (bounded) for the next cycle, then stop.
        const { kept, dropped } = enforceBufferCap([...batch, ...buffer], cfg.maxBuffer);
        buffer = kept;
        if (dropped) health.dropped += dropped;
        break;
      }
    }
  } catch { /* fail-open */ } finally {
    flushing = false;
  }
}

// ---------------------------------------------------------------------------
// Lifecycle wiring (idempotent, deferred so boot is never blocked)
// ---------------------------------------------------------------------------
function wireLifecycle(): void {
  try {
    online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
    window.addEventListener('online', () => { online = true; void flush('online'); });
    window.addEventListener('offline', () => { online = false; });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void flush('visibility');
    });
    window.addEventListener('pagehide', () => { void flush('pagehide'); });
    flushTimer = window.setInterval(() => { void flush('interval'); }, cfg.flushIntervalMs);
  } catch { /* noop — transport simply won't auto-flush */ }
}

/**
 * Start the transport. Safe to call unconditionally from boot: honors the kill switch, defers all
 * work to idle, and can never throw. When disabled, registers no sink (collection still works, the
 * session dashboard still reads the ring buffers — nothing is transmitted).
 */
export function initTelemetryTransport(): void {
  if (started) return;
  started = true;
  cfg = getTelemetryConfig();
  health = emptyHealth(cfg.maxBuffer, cfg.baseSampleRate);
  if (!cfg.collectionEnabled || !cfg.transportEnabled) return;
  if (typeof window === 'undefined') return;

  const begin = (): void => {
    try {
      setTelemetrySink(enqueue);
      wireLifecycle();
    } catch { /* fail-open */ }
  };
  // Defer to idle so telemetry never competes with first paint / hydration.
  try {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (typeof ric === 'function') ric(begin, { timeout: 3000 });
    else window.setTimeout(begin, 1500);
  } catch { begin(); }
}

/** Test/ops hook — tear down (clears sink, timer, buffer). Idempotent. */
export function stopTelemetryTransport(): void {
  try { setTelemetrySink(null); } catch { /* noop */ }
  if (flushTimer != null) { try { window.clearInterval(flushTimer); } catch { /* noop */ } flushTimer = null; }
  buffer = [];
  started = false;
}
