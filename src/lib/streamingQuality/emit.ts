// WEB-OBS-7 — Streaming Quality emit + transport (client). Called from emit-only Player instrumentation.
//
// Hard guarantees (playback safety):
//   • FULLY FAIL-OPEN: every path is wrapped; a telemetry failure can never affect playback.
//   • Never awaited by the caller; the record() call returns synchronously (void). The flush is
//     fire-and-forget and its Promise is never surfaced to the Player.
//   • Bounded buffer + bounded retry (a failed flush drops the batch — no retry storm, no backpressure).
//   • OPT-IN: no-op unless VITE_SQ_TELEMETRY_ENABLED (getStreamingQualityConfig().telemetryEnabled) and
//     the per-type flag. Store id is stamped SERVER-SIDE from auth.uid() — never sent on the wire.

import { supabase } from '@/lib/supabase';
import { BUILD_ID } from '@/lib/bootRecovery';
import { getStreamingQualityConfig } from './config';
import {
  sqRoute, hashTrackId,
  type StreamingQualityEvent, type SqEventType, type SqEnvironment, type SqBrowser, type SqOs,
  type SqDevice, type SqVisibility, type SqReason, type SqMediaCode,
} from './eventSchema';

let sessionId = '';
let seq = 0;
const buffer: StreamingQualityEvent[] = [];
let flushTimer: number | null = null;

function randomToken(): string {
  try {
    const b = new Uint8Array(12);
    (globalThis.crypto ?? (globalThis as { msCrypto?: Crypto }).msCrypto)?.getRandomValues(b);
    let s = ''; for (const x of b) s += (x % 36).toString(36);
    if (s.length >= 12) return s.slice(0, 16);
  } catch { /* fall through */ }
  let seed = 0; try { seed = Math.floor(performance.now() * 1000); } catch { /* noop */ }
  let s = ''; while (s.length < 16) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; s += (seed % 36).toString(36); }
  return s.slice(0, 16);
}
function sid(): string { if (!sessionId) sessionId = randomToken(); return sessionId; }

function resolveEnv(): SqEnvironment {
  try {
    const e = (import.meta.env.VITE_APP_ENV as string | undefined)?.toLowerCase();
    if (e === 'production' || e === 'preview' || e === 'development') return e;
    if (import.meta.env.PROD) return 'production';
    if (import.meta.env.DEV) return 'development';
  } catch { /* noop */ }
  return 'unknown';
}
function detectBrowser(): SqBrowser {
  try {
    const ua = navigator.userAgent;
    if (/Edg\//.test(ua)) return 'edge';
    if (/SamsungBrowser/i.test(ua)) return 'samsung';
    if (/Chrome\//.test(ua)) return 'chrome';
    if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'safari';
    if (/Firefox\//.test(ua)) return 'firefox';
  } catch { /* noop */ }
  return 'other';
}
function detectOs(): SqOs {
  try {
    const ua = navigator.userAgent;
    if (/Windows/.test(ua)) return 'windows';
    if (/Mac OS X/.test(ua)) return 'macos';
    if (/Android/.test(ua)) return 'android';
    if (/iPhone|iPad/.test(ua)) return 'ios';
    if (/Linux/.test(ua)) return 'linux';
  } catch { /* noop */ }
  return 'other';
}
function detectDevice(): SqDevice {
  try { const ua = navigator.userAgent.toLowerCase(); if (/ipad/.test(ua)) return 'tablet'; if (/mobile|android|iphone/.test(ua)) return 'mobile'; return 'desktop'; } catch { return 'unknown'; }
}
function visibility(): SqVisibility {
  try { return document.visibilityState === 'visible' ? 'visible' : 'hidden'; } catch { return 'unknown'; }
}

/** FNV-1a → uniform 0..1 for session-stable sampling. */
function sessionUniform(): number {
  const s = sid();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
  return (h >>> 0) / 0xffffffff;
}

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  try {
    const cfg = getStreamingQualityConfig();
    flushTimer = window.setTimeout(() => { flushTimer = null; void flush('interval'); }, cfg.flushMs);
  } catch { /* noop */ }
}

async function flush(_reason: string): Promise<void> {
  try {
    const cfg = getStreamingQualityConfig();
    const batch = buffer.splice(0, cfg.maxBatch);
    if (batch.length === 0) return;
    // store_id stamped server-side from auth.uid(); we pass null (never trust/send a client store id).
    await supabase.rpc('ingest_streaming_quality_events', { p_events: batch as unknown as Record<string, unknown>[], p_store_id: null });
  } catch { /* fail-open: drop the batch, never retry-storm, never surface to the Player */ }
}

export interface RecordInput {
  event_type: SqEventType;
  trackId?: string | null;
  business_mode?: boolean;
  duration_ms?: number | null;
  outcome?: StreamingQualityEvent['outcome'];
  reason?: SqReason | null;
  media_code?: SqMediaCode | null;
  network_state?: number | null;
  ready_state?: number | null;
}

const ALWAYS_KEEP: SqEventType[] = ['media_error', 'recovery_failed'];

function typeEnabled(cfg: ReturnType<typeof getStreamingQualityConfig>, t: SqEventType): boolean {
  switch (t) {
    case 'first_progress': return cfg.ttfaEnabled;
    case 'crossfade_completed': case 'crossfade_fallback': case 'crossfade_aborted': return cfg.crossfadeEnabled;
    case 'preload_ready': case 'preload_failed': return cfg.preloadEnabled;
    case 'media_error': return cfg.mediaErrorEnabled;
    case 'recovery_attempted': case 'recovery_succeeded': case 'recovery_failed': return cfg.recoveryEnabled;
    default: return true;
  }
}

/**
 * Record ONE streaming-quality outcome. Synchronous, fail-open, never throws, never awaited by the
 * caller. Safe to call from any Player/Recovery signal callback without affecting playback.
 */
export function recordStreamingQuality(input: RecordInput): void {
  try {
    const cfg = getStreamingQualityConfig();
    if (!cfg.telemetryEnabled) return;
    if (!typeEnabled(cfg, input.event_type)) return;
    // session-stable sampling; errors/recovery-failures always kept
    if (cfg.sampleRate < 1 && !ALWAYS_KEEP.includes(input.event_type) && sessionUniform() >= cfg.sampleRate) return;

    let route = 'individual'; try { route = sqRoute(window.location?.pathname); } catch { /* noop */ }
    const ev: StreamingQualityEvent = {
      event_id: `${sid()}${(seq).toString(36)}${randomToken().slice(0, 4)}`.slice(0, 64),
      event_type: input.event_type, event_version: 1, player_session_id: sid(), sequence: seq++,
      occurred_at: Date.now(), release: BUILD_ID || 'unknown', environment: resolveEnv(), route,
      browser: detectBrowser(), os: detectOs(), device_class: detectDevice(), visibility_state: visibility(),
      business_mode: input.business_mode === true,
      current_track_hash: hashTrackId(input.trackId ?? null),
      duration_ms: input.duration_ms == null ? null : Math.max(0, Math.min(3_600_000, Math.round(input.duration_ms))),
      outcome: input.outcome ?? null,
      reason: input.reason ?? null,
      media_code: input.media_code ?? null,
      network_state: input.network_state ?? null,
      ready_state: input.ready_state ?? null,
    };
    buffer.push(ev);
    if (buffer.length >= cfg.maxBatch) void flush('batch');
    else scheduleFlush();
  } catch { /* fully fail-open — never affect playback */ }
}

// Best-effort flush on page hide (bounded; never awaited by anything playback-critical).
try {
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => { void flush('pagehide'); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flush('visibility'); });
  }
} catch { /* noop */ }
