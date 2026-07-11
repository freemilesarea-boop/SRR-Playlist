// WEB-OBS-7 — Streaming Quality event schema (single source of truth for the wire format).
//
// Dependency-free (no `@/` aliases, no browser globals at module load) so the SAME file is imported by
// the Player emit helper, the transport, and unit tests, and mirrors what the server ingest RPC
// validates. Privacy is enforced at the type level:
//   • NO store name / user id / track title / artist / playlist name / audio URL / raw src / UA /
//     query string / token / raw stack. Store attribution is stamped SERVER-SIDE from auth.uid() —
//     the wire envelope has NO store_id, so a client can never spoof one.
//   • The current track is a NON-REVERSIBLE hash. Durations are small bounded integers (ms).
//   • player_session_id is an opaque per-page-load token (NOT a user id).

export const SQ_EVENT_VERSION = 1;
export const SQ_MAX_BATCH_EVENTS = 40;
export const SQ_MAX_BODY_BYTES = 32 * 1024;

// Only the event types we actually emit from real signals are listed. (playback start success and
// session continuity are DERIVED server-side from these + the existing playback_events_v2 funnel.)
export const SQ_EVENT_TYPES = [
  'first_progress',        // TTFA_APPROX: request → first currentTime progress
  'crossfade_completed',
  'crossfade_fallback',    // safety_timeout path
  'crossfade_aborted',     // recovery-manager forced / superseded
  'preload_ready',
  'preload_failed',
  'media_error',
  'recovery_attempted',
  'recovery_succeeded',
  'recovery_failed',
] as const;
export type SqEventType = (typeof SQ_EVENT_TYPES)[number];

export const SQ_ENVIRONMENTS = ['production', 'preview', 'development', 'unknown'] as const;
export type SqEnvironment = (typeof SQ_ENVIRONMENTS)[number];
export const SQ_BROWSERS = ['chrome', 'safari', 'firefox', 'edge', 'samsung', 'other'] as const;
export type SqBrowser = (typeof SQ_BROWSERS)[number];
export const SQ_OS = ['windows', 'macos', 'ios', 'android', 'linux', 'other'] as const;
export type SqOs = (typeof SQ_OS)[number];
export const SQ_DEVICE = ['mobile', 'tablet', 'desktop', 'unknown'] as const;
export type SqDevice = (typeof SQ_DEVICE)[number];
export const SQ_VISIBILITY = ['visible', 'hidden', 'unknown'] as const;
export type SqVisibility = (typeof SQ_VISIBILITY)[number];

/** Normalized reason for crossfade/recovery outcome (low-cardinality allow-list). */
export const SQ_REASONS = [
  'raf', 'safety_timeout', 'recovery-manager', 'superseded',
  'media-error', 'stalled', 'neither-playing', 'network-resume', 'visibility-resume',
  'both-playing', 'sink-mismatch', 'crossfade-stuck', 'inactive-playing', 'other',
] as const;
export type SqReason = (typeof SQ_REASONS)[number];

/** Normalized MediaError code (0 = none/unknown; 1..4 = the four MediaError codes). */
export type SqMediaCode = 0 | 1 | 2 | 3 | 4;

export interface StreamingQualityEvent {
  event_id: string;
  event_type: SqEventType;
  event_version: number;
  player_session_id: string;   // opaque per-page-load token, NOT a user id
  sequence: number;
  occurred_at: number;         // client epoch ms (server also stamps received_at)
  release: string;             // BUILD_ID
  environment: SqEnvironment;
  route: string;               // normalized ('store'|'brand'|'individual'|'other')
  browser: SqBrowser;
  os: SqOs;
  device_class: SqDevice;
  visibility_state: SqVisibility;
  business_mode: boolean;      // true when playing in store/business mode
  current_track_hash: string | null;
  /** duration for the event (TTFA ms / crossfade elapsed ms / time-to-recovery ms). bounded. */
  duration_ms: number | null;
  outcome: 'success' | 'failed' | 'fallback' | 'aborted' | 'progress' | null;
  reason: SqReason | null;
  media_code: SqMediaCode | null;   // media_error only
  network_state: number | null;     // 0..3, media_error only
  ready_state: number | null;       // 0..4, media_error only
}

const MAX_ID_LEN = 64;
const MAX_HASH_LEN = 16;
const MAX_DURATION_MS = 3_600_000; // clamp absurd values

function oneOf<T extends string>(list: readonly T[], v: unknown, fallback: T): T {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : fallback;
}
function boundedId(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/[^A-Za-z0-9_-]/g, '').slice(0, max) : '';
}
function intInRange(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** FNV-1a 32-bit → base36, truncated. Non-reversible, stable, low-collision-enough for grouping. */
export function hashTrackId(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(36).slice(0, MAX_HASH_LEN);
}

/** Normalize a route to the fleet-relevant playback contexts. */
export function sqRoute(pathname: string | null | undefined): string {
  const p = (pathname ?? '').toLowerCase();
  if (p.includes('brand') && p.includes('player')) return 'brand';
  if ((p.includes('store') || p.includes('business')) && p.includes('player')) return 'store';
  return 'individual';
}

export function parseStreamingQualityEvent(raw: unknown): StreamingQualityEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const event_id = boundedId(o.event_id, MAX_ID_LEN);
  const player_session_id = boundedId(o.player_session_id, MAX_ID_LEN);
  if (!event_id || !player_session_id) return null;
  if (typeof o.event_type !== 'string' || !(SQ_EVENT_TYPES as readonly string[]).includes(o.event_type)) return null;
  const hashRaw = o.current_track_hash;
  const current_track_hash = typeof hashRaw === 'string' && hashRaw ? boundedId(hashRaw, MAX_HASH_LEN) || null : null;
  const outcome = o.outcome;
  return {
    event_id,
    event_type: o.event_type as SqEventType,
    event_version: SQ_EVENT_VERSION,
    player_session_id,
    sequence: intInRange(o.sequence, 0, 2_000_000_000) ?? 0,
    occurred_at: intInRange(o.occurred_at, 0, 9_000_000_000_000) ?? 0,
    release: boundedId(o.release, MAX_ID_LEN) || 'unknown',
    environment: oneOf(SQ_ENVIRONMENTS, o.environment, 'unknown'),
    route: sqRoute(typeof o.route === 'string' ? o.route : ''),
    browser: oneOf(SQ_BROWSERS, o.browser, 'other'),
    os: oneOf(SQ_OS, o.os, 'other'),
    device_class: oneOf(SQ_DEVICE, o.device_class, 'unknown'),
    visibility_state: oneOf(SQ_VISIBILITY, o.visibility_state, 'unknown'),
    business_mode: o.business_mode === true,
    current_track_hash,
    duration_ms: intInRange(o.duration_ms, 0, MAX_DURATION_MS),
    outcome: (['success', 'failed', 'fallback', 'aborted', 'progress'] as const).includes(outcome as never) ? (outcome as StreamingQualityEvent['outcome']) : null,
    reason: typeof o.reason === 'string' && (SQ_REASONS as readonly string[]).includes(o.reason) ? (o.reason as SqReason) : null,
    media_code: (intInRange(o.media_code, 0, 4) as SqMediaCode | null),
    network_state: intInRange(o.network_state, 0, 3),
    ready_state: intInRange(o.ready_state, 0, 4),
  };
}

export function parseStreamingQualityBatch(raw: unknown): StreamingQualityEvent[] {
  const arr = Array.isArray(raw) ? raw : Array.isArray((raw as { events?: unknown })?.events) ? (raw as { events: unknown[] }).events : [];
  const out: StreamingQualityEvent[] = [];
  for (const e of arr) {
    if (out.length >= SQ_MAX_BATCH_EVENTS) break;
    const parsed = parseStreamingQualityEvent(e);
    if (parsed) out.push(parsed);
  }
  return out;
}
