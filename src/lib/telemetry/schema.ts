// WEB-OBS-1 — Runtime Telemetry Event Envelope (shared schema).
//
// This module is the SINGLE SOURCE OF TRUTH for the telemetry wire format. It is imported by
// BOTH the client transport (`src/lib/telemetry/transport.ts`, via `./schema`) AND the server
// ingestion function (`api/telemetry/runtime.ts`, via a relative path). For that reason it MUST
// stay dependency-free and side-effect-free at module load:
//   • no `@/…` alias imports (the Vercel edge bundler does not resolve Vite aliases),
//   • no browser globals (window/performance/navigator) read at import time,
//   • no Node globals.
//
// Privacy contract (enforced structurally, not by convention):
//   • The envelope carries ONLY low-cardinality, bucketed dimensions — never raw identifiers,
//     emails, tokens, query strings, request/response bodies, or free-form user input.
//   • `parseEnvelope()` REBUILDS a clean event from an allow-list of fields. Any field not in the
//     schema is dropped. Strings that flow to storage (route, message, api name) are re-sanitized.
//   • The same sanitizers run on BOTH sides ("double sanitization"): the client sanitizes before
//     enqueue, the server sanitizes again before insert. Neither side trusts the other.
//
// Discriminated union on `event_type` with a per-type `payload` — no `any` anywhere.

// ---------------------------------------------------------------------------
// Versioning + hard limits (referenced by client transport and server validator)
// ---------------------------------------------------------------------------
/** Wire schema version. Bump when the envelope shape changes incompatibly. */
export const TELEMETRY_EVENT_VERSION = 1;

/** Max events accepted in one ingestion request body (batch). Over → 413. */
export const MAX_BATCH_EVENTS = 50;
/** Max serialized request body the ingestion endpoint will read. Over → 413. */
export const MAX_BODY_BYTES = 64 * 1024;
/** Max serialized bytes of a single event's `payload`. Over → event rejected. */
export const MAX_PAYLOAD_BYTES = 4 * 1024;
/** Sanitized free-text (error message) is truncated to this many chars. */
export const MAX_MESSAGE_LEN = 300;
/** Sanitized route/api-name length cap. */
export const MAX_NAME_LEN = 200;

// ---------------------------------------------------------------------------
// Enumerations (closed allow-lists — anything outside collapses to a safe default)
// ---------------------------------------------------------------------------
export const EVENT_TYPES = ['vital', 'longtask', 'api', 'route', 'interaction', 'error', 'memory'] as const;
export type TelemetryEventType = (typeof EVENT_TYPES)[number];

export const SEVERITIES = ['info', 'warn', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const ENVIRONMENTS = ['production', 'preview', 'development', 'unknown'] as const;
export type TelemetryEnvironment = (typeof ENVIRONMENTS)[number];

export const DEVICE_CLASSES = ['mobile', 'tablet', 'desktop', 'unknown'] as const;
export type DeviceClass = (typeof DEVICE_CLASSES)[number];

export const VIEWPORT_BUCKETS = ['xs', 'sm', 'md', 'lg', 'xl', 'unknown'] as const;
export type ViewportBucket = (typeof VIEWPORT_BUCKETS)[number];

export const BROWSER_FAMILIES = ['Chrome', 'Safari', 'Firefox', 'Edge', 'Other'] as const;
export type BrowserFamily = (typeof BROWSER_FAMILIES)[number];

export const OS_FAMILIES = ['Windows', 'macOS', 'Android', 'iOS', 'Linux', 'Other'] as const;
export type OsFamily = (typeof OS_FAMILIES)[number];

export const VITAL_NAMES = ['LCP', 'INP', 'FCP', 'TTFB', 'CLS'] as const;
export type VitalName = (typeof VITAL_NAMES)[number];

export const VITAL_RATINGS = ['good', 'needs-improvement', 'poor'] as const;
export type VitalRating = (typeof VITAL_RATINGS)[number];

export const API_KINDS = ['rest', 'rpc', 'storage', 'auth', 'other'] as const;
export type ApiKind = (typeof API_KINDS)[number];

export const ERROR_KINDS = ['js', 'unhandledrejection', 'chunk-load', 'react', 'resource', 'other'] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

// Bucket labels for hardware/memory/network (low cardinality by construction).
export const CONCURRENCY_BUCKETS = ['1-2', '3-4', '5-8', '9+', 'unknown'] as const;
export type ConcurrencyBucket = (typeof CONCURRENCY_BUCKETS)[number];

export const MEMORY_BUCKETS = ['<=1', '2', '3-4', '5-8', '8+', 'unknown'] as const;
export type MemoryBucket = (typeof MEMORY_BUCKETS)[number];

export const NETWORK_TYPES = ['slow-2g', '2g', '3g', '4g', 'unknown'] as const;
export type NetworkType = (typeof NETWORK_TYPES)[number];

// ---------------------------------------------------------------------------
// Per-event-type payloads (discriminated union member bodies)
// ---------------------------------------------------------------------------
export interface VitalPayload { name: VitalName; value: number; rating: VitalRating; }
export interface LongTaskPayload { duration: number; startTime: number; }
export interface ApiPayload { name: string; kind: ApiKind; duration: number; transferKb: number | null; }
export interface RoutePayload { duration: number | null; }
export interface InteractionPayload { kind: string; duration: number; }
export interface ErrorPayload { kind: ErrorKind; message: string; }
export interface MemoryPayload { usedMb: number; totalMb: number; limitMb: number; }

// ---------------------------------------------------------------------------
// Envelope — common dimensions shared by every event
// ---------------------------------------------------------------------------
export interface TelemetryEnvelope {
  /** Client-generated unique id — the dedup key (UNIQUE at rest). */
  event_id: string;
  event_type: TelemetryEventType;
  event_version: number;
  /** Opaque per-session id (random, NOT a user id). Rotates each page session. */
  session_id: string;
  /** Monotonic per-session counter — orders events without a wall clock. */
  sequence: number;
  /** Client epoch ms at capture (approximate; server also records received_at). */
  occurred_at: number;
  /** Release/build identifier (release attribution). */
  release: string;
  environment: TelemetryEnvironment;
  /** Sanitized route (query + ids stripped). */
  route: string;
  previous_route: string | null;
  /** Primary duration in ms for the event, when meaningful. */
  duration_ms: number | null;
  severity: Severity;
  browser_family: BrowserFamily;
  browser_major: number | null;
  os_family: OsFamily;
  device_class: DeviceClass;
  viewport_bucket: ViewportBucket;
  network_type: NetworkType | null;
  hardware_concurrency_bucket: ConcurrencyBucket | null;
  device_memory_bucket: MemoryBucket | null;
  /** Fraction in (0,1] at which this event's stream was sampled (errors = 1). */
  sample_rate: number;
}

// Discriminated union — `event_type` narrows `payload`.
export type TelemetryEvent =
  | (TelemetryEnvelope & { event_type: 'vital'; payload: VitalPayload })
  | (TelemetryEnvelope & { event_type: 'longtask'; payload: LongTaskPayload })
  | (TelemetryEnvelope & { event_type: 'api'; payload: ApiPayload })
  | (TelemetryEnvelope & { event_type: 'route'; payload: RoutePayload })
  | (TelemetryEnvelope & { event_type: 'interaction'; payload: InteractionPayload })
  | (TelemetryEnvelope & { event_type: 'error'; payload: ErrorPayload })
  | (TelemetryEnvelope & { event_type: 'memory'; payload: MemoryPayload });

/** Server-stamped fields added at ingestion (never trusted from the client). */
export type StoredTelemetryEvent = TelemetryEvent & {
  received_at: string; // ISO timestamp assigned server-side
};

// ---------------------------------------------------------------------------
// Small pure helpers (no external deps)
// ---------------------------------------------------------------------------
function inList<T extends string>(list: readonly T[], v: unknown, fallback: T): T {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : fallback;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function clampInt(v: unknown, min: number, max: number): number | null {
  const n = num(v);
  if (n === null) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// ---------------------------------------------------------------------------
// Sanitizers (run on BOTH client and server — the double-sanitization contract)
// ---------------------------------------------------------------------------

/**
 * Route sanitizer — independent of bootRecovery so this module stays portable to the edge runtime.
 * Strips query/hash, collapses obvious id path segments (uuid, long numbers, hex, jwt-ish) to `:id`,
 * lowercases host-less path, and caps length. Never returns raw user input.
 */
export function sanitizeRoute(input: unknown): string {
  let s = typeof input === 'string' ? input : '';
  // Drop scheme+host if a full URL slipped through; keep pathname only.
  try {
    if (/^[a-z]+:\/\//i.test(s)) s = new URL(s).pathname;
  } catch { /* keep as-is */ }
  // Strip query string and hash defensively.
  s = s.split('?')[0].split('#')[0];
  if (!s.startsWith('/')) s = `/${s}`;
  const parts = s.split('/').map((seg) => {
    if (!seg) return seg;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ':id';
    if (/^\d{4,}$/.test(seg)) return ':id';
    if (/^[0-9a-f]{16,}$/i.test(seg)) return ':id';
    if (/eyJ[A-Za-z0-9_-]{6,}/.test(seg)) return ':id';
    return seg;
  });
  const out = parts.join('/').slice(0, MAX_NAME_LEN);
  return out || '/';
}

/** Redacts email / JWT / uuid / long-number and truncates. Mirrors collect.ts sanitizeMessage. */
export function sanitizeMessage(input: unknown): string {
  const raw = input instanceof Error ? input.message : String(input ?? '');
  return raw
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[email]')
    .replace(/eyJ[A-Za-z0-9_-]{8,}/g, '[jwt]')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[uuid]')
    .replace(/\b\d{6,}\b/g, '[num]')
    .slice(0, MAX_MESSAGE_LEN);
}

/** Sanitize an api-timing name (already `host/path` shaped) — strip query + collapse ids + cap. */
export function sanitizeApiName(input: unknown): string {
  let s = typeof input === 'string' ? input : 'unknown';
  s = s.split('?')[0].split('#')[0];
  s = s
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\b\d{4,}\b/g, ':id')
    .slice(0, MAX_NAME_LEN);
  return s || 'unknown';
}

// ---------------------------------------------------------------------------
// Payload validation per event type (rebuild from allow-listed fields only)
// ---------------------------------------------------------------------------
function parsePayload(type: TelemetryEventType, raw: unknown):
  | VitalPayload | LongTaskPayload | ApiPayload | RoutePayload
  | InteractionPayload | ErrorPayload | MemoryPayload | null {
  const p = isRecord(raw) ? raw : {};
  switch (type) {
    case 'vital': {
      const value = num(p.value);
      if (value === null) return null;
      return {
        name: inList(VITAL_NAMES, p.name, 'LCP'),
        value: Math.round(value * 1000) / 1000,
        rating: inList(VITAL_RATINGS, p.rating, 'needs-improvement'),
      };
    }
    case 'longtask': {
      const duration = clampInt(p.duration, 0, 600_000);
      if (duration === null) return null;
      return { duration, startTime: clampInt(p.startTime, 0, 86_400_000) ?? 0 };
    }
    case 'api': {
      const duration = clampInt(p.duration, 0, 600_000);
      if (duration === null) return null;
      const transfer = clampInt(p.transferKb, 0, 1_048_576);
      return {
        name: sanitizeApiName(p.name),
        kind: inList(API_KINDS, p.kind, 'other'),
        duration,
        transferKb: transfer,
      };
    }
    case 'route':
      return { duration: clampInt(p.duration, 0, 86_400_000) };
    case 'interaction': {
      const duration = clampInt(p.duration, 0, 600_000);
      if (duration === null) return null;
      return { kind: (typeof p.kind === 'string' ? p.kind : 'event').slice(0, 32), duration };
    }
    case 'error':
      return { kind: inList(ERROR_KINDS, p.kind, 'other'), message: sanitizeMessage(p.message) };
    case 'memory': {
      const usedMb = clampInt(p.usedMb, 0, 1_048_576);
      if (usedMb === null) return null;
      return {
        usedMb,
        totalMb: clampInt(p.totalMb, 0, 1_048_576) ?? 0,
        limitMb: clampInt(p.limitMb, 0, 1_048_576) ?? 0,
      };
    }
    default:
      return null;
  }
}

function isValidEventId(v: unknown): v is string {
  // Accept our client id format: <hex/base36 chars, hyphens>, bounded length. No PII shape.
  return typeof v === 'string' && v.length >= 8 && v.length <= 64 && /^[A-Za-z0-9_-]+$/.test(v);
}

function isValidSessionId(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 8 && v.length <= 64 && /^[A-Za-z0-9_-]+$/.test(v);
}

export interface ParseResult {
  ok: boolean;
  event?: TelemetryEvent;
  error?: string;
}

/**
 * Validate + REBUILD a single event from untrusted input. Returns a clean, fully-typed event or an
 * error reason. This is the server's authoritative gate (and is reused client-side as a guard).
 * Unknown/extra fields are dropped; strings are re-sanitized; enums collapse to safe defaults;
 * numbers are clamped. Rejects only on structurally missing essentials (id/type/payload).
 */
export function parseEnvelope(raw: unknown): ParseResult {
  if (!isRecord(raw)) return { ok: false, error: 'not_object' };
  if (!isValidEventId(raw.event_id)) return { ok: false, error: 'bad_event_id' };
  if (!isValidSessionId(raw.session_id)) return { ok: false, error: 'bad_session_id' };

  const type = raw.event_type;
  if (typeof type !== 'string' || !(EVENT_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: 'bad_event_type' };
  }
  const eventType = type as TelemetryEventType;

  const payload = parsePayload(eventType, raw.payload);
  if (payload === null) return { ok: false, error: 'bad_payload' };

  // Enforce payload size AFTER rebuild (bounds a hostile giant payload).
  try {
    if (JSON.stringify(payload).length > MAX_PAYLOAD_BYTES) return { ok: false, error: 'payload_too_large' };
  } catch { return { ok: false, error: 'payload_unserializable' }; }

  const release = (typeof raw.release === 'string' ? raw.release : 'unknown').slice(0, 64);
  const sampleRate = num(raw.sample_rate);

  const envelope: TelemetryEnvelope = {
    event_id: raw.event_id,
    event_type: eventType,
    event_version: clampInt(raw.event_version, 1, 1_000) ?? TELEMETRY_EVENT_VERSION,
    session_id: raw.session_id,
    sequence: clampInt(raw.sequence, 0, 1_000_000_000) ?? 0,
    occurred_at: clampInt(raw.occurred_at, 0, 4_102_444_800_000) ?? 0,
    release,
    environment: inList(ENVIRONMENTS, raw.environment, 'unknown'),
    route: sanitizeRoute(raw.route),
    previous_route: raw.previous_route == null ? null : sanitizeRoute(raw.previous_route),
    duration_ms: clampInt(raw.duration_ms, 0, 86_400_000),
    severity: inList(SEVERITIES, raw.severity, 'info'),
    browser_family: inList(BROWSER_FAMILIES, raw.browser_family, 'Other'),
    browser_major: clampInt(raw.browser_major, 0, 100_000),
    os_family: inList(OS_FAMILIES, raw.os_family, 'Other'),
    device_class: inList(DEVICE_CLASSES, raw.device_class, 'unknown'),
    viewport_bucket: inList(VIEWPORT_BUCKETS, raw.viewport_bucket, 'unknown'),
    network_type: raw.network_type == null ? null : inList(NETWORK_TYPES, raw.network_type, 'unknown'),
    hardware_concurrency_bucket:
      raw.hardware_concurrency_bucket == null ? null : inList(CONCURRENCY_BUCKETS, raw.hardware_concurrency_bucket, 'unknown'),
    device_memory_bucket:
      raw.device_memory_bucket == null ? null : inList(MEMORY_BUCKETS, raw.device_memory_bucket, 'unknown'),
    sample_rate: sampleRate !== null && sampleRate > 0 && sampleRate <= 1 ? Math.round(sampleRate * 10000) / 10000 : 1,
  };

  // Reassemble as the correct discriminated-union member.
  return { ok: true, event: { ...envelope, event_type: eventType, payload } as TelemetryEvent };
}

// ---------------------------------------------------------------------------
// Bucketing helpers (client uses these to build the envelope; kept here so server-side
// analytics and tests can reference the exact same boundaries)
// ---------------------------------------------------------------------------
export function viewportBucketFor(width: number): ViewportBucket {
  if (!Number.isFinite(width) || width <= 0) return 'unknown';
  if (width < 480) return 'xs';
  if (width < 768) return 'sm';
  if (width < 1024) return 'md';
  if (width < 1440) return 'lg';
  return 'xl';
}

export function deviceClassFor(width: number, touch: boolean): DeviceClass {
  if (!Number.isFinite(width) || width <= 0) return 'unknown';
  if (width < 768) return 'mobile';
  if (width < 1024) return touch ? 'tablet' : 'desktop';
  return 'desktop';
}

export function concurrencyBucketFor(n: number | null): ConcurrencyBucket | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return n == null ? null : 'unknown';
  if (n <= 2) return '1-2';
  if (n <= 4) return '3-4';
  if (n <= 8) return '5-8';
  return '9+';
}

export function memoryBucketFor(gb: number | null): MemoryBucket | null {
  if (gb == null) return null;
  if (!Number.isFinite(gb) || gb <= 0) return 'unknown';
  if (gb <= 1) return '<=1';
  if (gb < 3) return '2';
  if (gb <= 4) return '3-4';
  if (gb <= 8) return '5-8';
  return '8+';
}

export function networkTypeFor(t: string | null): NetworkType | null {
  if (t == null) return null;
  return inList(NETWORK_TYPES, t, 'unknown');
}
