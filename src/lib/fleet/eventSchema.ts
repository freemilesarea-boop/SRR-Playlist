// WEB-OBS-6 — Store Fleet Player-Health event schema (single source of truth for the wire format).
//
// Dependency-free (no `@/` aliases, no browser globals at module load) so the SAME file can be
// imported by the client emit hook and unit tests, and so its shape mirrors exactly what the server
// ingestion RPC validates. Privacy is enforced at the type level:
//   • NO store name / user id / track title / artist / playlist name / audio URL / UA / query string /
//     token is ever carried. Store attribution is stamped SERVER-SIDE from auth.uid() — the wire
//     envelope deliberately has NO store_id field, so a client can never spoof one.
//   • The current track is a NON-REVERSIBLE hash, never the raw id. Position / queue length /
//     scheduler age / reconnect count are BUCKETED, never exact.
//   • player_session_id is an opaque per-tab token (NOT a user id), used only to group a run.

export const FLEET_EVENT_VERSION = 1;
export const FLEET_MAX_BATCH_EVENTS = 40;
export const FLEET_MAX_BODY_BYTES = 32 * 1024;

export const FLEET_EVENT_TYPES = [
  'player_heartbeat',
  'playback_stalled',
  'silence_suspected',
  'queue_empty',
  'track_transition',
  'network_disconnected',
  'network_reconnected',
  'duplicate_track_detected',
  'session_started',
  'session_ended',
] as const;
export type FleetEventType = (typeof FLEET_EVENT_TYPES)[number];

export const PLAYBACK_STATES = ['playing', 'paused', 'stopped', 'unknown'] as const;
export type PlaybackState = (typeof PLAYBACK_STATES)[number];

export const VISIBILITY_STATES = ['visible', 'hidden', 'unknown'] as const;
export type VisibilityState = (typeof VISIBILITY_STATES)[number];

// Bucketed enums (low cardinality; never exact values).
export const POSITION_BUCKETS = ['start', 'early', 'mid', 'late', 'end', 'unknown'] as const;
export type PositionBucket = (typeof POSITION_BUCKETS)[number];

export const QUEUE_LENGTH_BUCKETS = ['empty', 'low', 'some', 'many', 'unknown'] as const;
export type QueueLengthBucket = (typeof QUEUE_LENGTH_BUCKETS)[number];

export const SCHEDULER_AGE_BUCKETS = ['fresh', 'recent', 'aging', 'stale', 'unknown'] as const;
export type SchedulerAgeBucket = (typeof SCHEDULER_AGE_BUCKETS)[number];

export const RECONNECT_BUCKETS = ['none', 'few', 'several', 'loop', 'unknown'] as const;
export type ReconnectBucket = (typeof RECONNECT_BUCKETS)[number];

// Device dims reuse the runtime-telemetry allow-lists (kept local so this file stays dependency-free).
export const FLEET_BROWSER_FAMILIES = ['Chrome', 'Safari', 'Firefox', 'Edge', 'Samsung', 'Other'] as const;
export type FleetBrowserFamily = (typeof FLEET_BROWSER_FAMILIES)[number];
export const FLEET_OS_FAMILIES = ['Windows', 'macOS', 'iOS', 'Android', 'Linux', 'Other'] as const;
export type FleetOsFamily = (typeof FLEET_OS_FAMILIES)[number];
export const FLEET_DEVICE_CLASSES = ['mobile', 'tablet', 'desktop', 'unknown'] as const;
export type FleetDeviceClass = (typeof FLEET_DEVICE_CLASSES)[number];

export const FLEET_ENVIRONMENTS = ['production', 'preview', 'development', 'unknown'] as const;
export type FleetEnvironment = (typeof FLEET_ENVIRONMENTS)[number];

/** The wire envelope. No store id, no raw track id, no free text. */
export interface FleetHealthEvent {
  event_id: string;
  event_type: FleetEventType;
  event_version: number;
  player_session_id: string;   // opaque per-tab token, NOT a user id
  sequence: number;
  occurred_at: number;         // client epoch ms (server also stamps received_at)
  release: string;             // BUILD_ID
  environment: FleetEnvironment;
  route: string;               // normalized ('/store/player' | '/brand/player' | 'other')
  browser_family: FleetBrowserFamily;
  os_family: FleetOsFamily;
  device_class: FleetDeviceClass;
  visibility_state: VisibilityState;
  playback_state: PlaybackState;
  current_track_hash: string | null; // non-reversible short hash, or null
  position_bucket: PositionBucket;
  queue_length_bucket: QueueLengthBucket;
  has_next: boolean;
  scheduler_age_bucket: SchedulerAgeBucket; // 'unknown' when no scheduler signal (the common case)
  reconnect_bucket: ReconnectBucket;
  online: boolean;
}

const MAX_ID_LEN = 64;
const MAX_HASH_LEN = 16;

function oneOf<T extends string>(list: readonly T[], v: unknown, fallback: T): T {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : fallback;
}
function boundedId(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  const s = v.replace(/[^A-Za-z0-9_-]/g, '').slice(0, max);
  return s;
}
function intOr(v: unknown, dflt: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : dflt;
}

/** Normalize a route to the only two fleet-relevant player routes (everything else → 'other'). */
export function fleetRoute(pathname: string | null | undefined): string {
  const p = (pathname ?? '').toLowerCase();
  if (p.includes('/brand/') && p.includes('player')) return '/brand/player';
  if (p.includes('brand') && p.includes('player')) return '/brand/player';
  if (p.includes('store') && p.includes('player')) return '/store/player';
  if (p.includes('business') && p.includes('player')) return '/store/player';
  return 'other';
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

/** Bucket a playback position (seconds) against a duration (seconds). */
export function positionBucketFor(position: number | null, duration: number | null): PositionBucket {
  if (position == null || !Number.isFinite(position) || position < 0) return 'unknown';
  if (duration == null || !Number.isFinite(duration) || duration <= 0) {
    // no duration → coarse absolute buckets
    if (position < 15) return 'start';
    if (position < 90) return 'early';
    return 'mid';
  }
  const f = position / duration;
  if (f < 0.05) return 'start';
  if (f < 0.33) return 'early';
  if (f < 0.66) return 'mid';
  if (f < 0.95) return 'late';
  return 'end';
}

export function queueLengthBucketFor(len: number | null): QueueLengthBucket {
  if (len == null || !Number.isFinite(len) || len < 0) return 'unknown';
  if (len === 0) return 'empty';
  if (len <= 2) return 'low';
  if (len <= 20) return 'some';
  return 'many';
}

export function reconnectBucketFor(count: number | null): ReconnectBucket {
  if (count == null || !Number.isFinite(count) || count < 0) return 'unknown';
  if (count === 0) return 'none';
  if (count <= 1) return 'few';
  if (count <= 3) return 'several';
  return 'loop';
}

export function schedulerAgeBucketFor(hours: number | null): SchedulerAgeBucket {
  if (hours == null || !Number.isFinite(hours) || hours < 0) return 'unknown';
  if (hours < 4) return 'fresh';
  if (hours < 12) return 'recent';
  if (hours < 18) return 'aging';
  return 'stale';
}

/**
 * Rebuild a single event from an allow-list, dropping unknown fields and coercing every value into
 * its bounded/enum type. Returns null when the event is unusable (bad type / missing ids). The server
 * RPC performs the equivalent validation in SQL; this is the client-side pre-sanitization.
 */
export function parseFleetEvent(raw: unknown): FleetHealthEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const event_type = oneOf(FLEET_EVENT_TYPES, o.event_type, 'player_heartbeat');
  const event_id = boundedId(o.event_id, MAX_ID_LEN);
  const player_session_id = boundedId(o.player_session_id, MAX_ID_LEN);
  if (!event_id || !player_session_id) return null;
  const hashRaw = o.current_track_hash;
  const current_track_hash =
    typeof hashRaw === 'string' && hashRaw ? boundedId(hashRaw, MAX_HASH_LEN) || null : null;
  return {
    event_id,
    event_type,
    event_version: FLEET_EVENT_VERSION,
    player_session_id,
    sequence: Math.max(0, intOr(o.sequence, 0)),
    occurred_at: Math.max(0, intOr(o.occurred_at, 0)),
    release: boundedId(o.release, MAX_ID_LEN) || 'unknown',
    environment: oneOf(FLEET_ENVIRONMENTS, o.environment, 'unknown'),
    route: fleetRoute(typeof o.route === 'string' ? o.route : ''),
    browser_family: oneOf(FLEET_BROWSER_FAMILIES, o.browser_family, 'Other'),
    os_family: oneOf(FLEET_OS_FAMILIES, o.os_family, 'Other'),
    device_class: oneOf(FLEET_DEVICE_CLASSES, o.device_class, 'unknown'),
    visibility_state: oneOf(VISIBILITY_STATES, o.visibility_state, 'unknown'),
    playback_state: oneOf(PLAYBACK_STATES, o.playback_state, 'unknown'),
    current_track_hash,
    position_bucket: oneOf(POSITION_BUCKETS, o.position_bucket, 'unknown'),
    queue_length_bucket: oneOf(QUEUE_LENGTH_BUCKETS, o.queue_length_bucket, 'unknown'),
    has_next: o.has_next === true,
    scheduler_age_bucket: oneOf(SCHEDULER_AGE_BUCKETS, o.scheduler_age_bucket, 'unknown'),
    reconnect_bucket: oneOf(RECONNECT_BUCKETS, o.reconnect_bucket, 'unknown'),
    online: o.online !== false,
  };
}

/** Validate + rebuild a batch, dropping unusable events, capped at FLEET_MAX_BATCH_EVENTS. */
export function parseFleetBatch(raw: unknown): FleetHealthEvent[] {
  const arr = Array.isArray(raw) ? raw : Array.isArray((raw as { events?: unknown })?.events) ? (raw as { events: unknown[] }).events : [];
  const out: FleetHealthEvent[] = [];
  for (const e of arr) {
    if (out.length >= FLEET_MAX_BATCH_EVENTS) break;
    const parsed = parseFleetEvent(e);
    if (parsed) out.push(parsed);
  }
  return out;
}
