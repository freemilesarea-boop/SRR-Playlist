// WEB-OBS-2 — Error fingerprinting, message normalization & group classification (pure, unit-tested).
//
// The stored error payload (WEB-OBS-1 schema) carries only { kind, sanitized message } — NO stack,
// NO top frame — and the message is already PII-redacted at capture (email/JWT/uuid/long-number).
// Here we go one step further for STABLE grouping: strip the remaining volatile tokens (numbers,
// hex, quoted literals, urls) so "Failed to fetch 3 of 12" and "Failed to fetch 7 of 40" collapse to
// one fingerprint. The fingerprint is a non-reversible FNV-1a hash of `kind|normalizedMessage|route`
// — release is intentionally EXCLUDED from the key so the same defect is comparable across releases
// (release is tracked as a dimension on the group, not baked into identity).

export type ErrorGroupClass = 'chunk' | 'hydration' | 'react' | 'runtime' | 'rejection' | 'resource' | 'other';

/**
 * Collapse volatile tokens in an already-sanitized message to a stable template. Idempotent and
 * order-independent. Never expands or reveals anything — only removes cardinality.
 */
export function normalizeErrorMessage(input: unknown): string {
  let s = typeof input === 'string' ? input : String(input ?? '');
  s = s
    .replace(/https?:\/\/[^\s"')]+/gi, '[url]')     // any residual URL
    .replace(/\/[\w/.-]*\.[a-z0-9]{2,4}\b/gi, '[path]') // file-ish paths
    .replace(/["'`][^"'`]{0,80}["'`]/g, '[str]')    // quoted literals (values, keys)
    .replace(/0x[0-9a-f]+/gi, '[hex]')
    .replace(/\b[0-9a-f]{8,}\b/gi, '[hex]')         // long hex (bundle hashes etc.)
    .replace(/\b\d+(\.\d+)?\b/g, '[n]')             // any remaining number
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  return s || '[empty]';
}

const HYDRATION_RE = /(hydrat|did not match|text content does not match|minified react error #(418|423|425)|server(-| )rendered)/i;
const CHUNK_RE = /(loading chunk|chunkloaderror|failed to fetch dynamically imported module|importing a module script failed|css chunk)/i;

/**
 * Bucket an error into a group class. Chunk and hydration are pulled OUT of the generic 'react'/'js'
 * kinds so they can be tracked and incident-detected separately (they have distinct causes & fixes).
 */
export function classifyErrorGroup(kind: string, message: string): ErrorGroupClass {
  const k = (kind || '').toLowerCase();
  const m = message || '';
  if (k === 'chunk-load' || CHUNK_RE.test(m)) return 'chunk';
  if (HYDRATION_RE.test(m)) return 'hydration';
  if (k === 'react') return 'react';
  if (k === 'unhandledrejection') return 'rejection';
  if (k === 'resource') return 'resource';
  if (k === 'js') return 'runtime';
  return 'other';
}

/** FNV-1a 32-bit → 8-char hex. Deterministic, non-reversible, dependency-free. */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // >>> 0 to unsigned, pad to 8 hex chars.
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Stable fingerprint for an error occurrence. Route is included (same defect on different routes is
 * usually a different investigation); release is NOT (cross-release comparability). Returns both the
 * hash and the normalized message so the UI can show a human-readable representative without a stack.
 */
export function fingerprintError(input: { kind: string; message: string; route?: string | null }): {
  fingerprint: string;
  groupClass: ErrorGroupClass;
  normalizedMessage: string;
} {
  const normalizedMessage = normalizeErrorMessage(input.message);
  const groupClass = classifyErrorGroup(input.kind, input.message);
  const route = (input.route || '/').split('?')[0];
  const key = `${groupClass}|${normalizedMessage}|${route}`;
  return { fingerprint: fnv1a(key), groupClass, normalizedMessage };
}

/** One aggregated error occurrence row (server-provided) before grouping. */
export interface ErrorOccurrence {
  kind: string;
  message: string;
  route: string;
  release: string;
  browser: string;
  severity?: string;
  count: number;
  sessions: number;
  firstSeen?: string | null;
  lastSeen?: string | null;
}

export interface ErrorGroup {
  fingerprint: string;
  groupClass: ErrorGroupClass;
  kind: string;
  normalizedMessage: string;
  representativeRoute: string;
  count: number;
  sessions: number;
  routes: string[];
  browsers: string[];
  releases: string[];
  firstSeen: string | null;
  lastSeen: string | null;
}

function minIso(a: string | null, b: string | null | undefined): string | null {
  if (!b) return a;
  if (!a) return b;
  return b < a ? b : a;
}
function maxIso(a: string | null, b: string | null | undefined): string | null {
  if (!b) return a;
  if (!a) return b;
  return b > a ? b : a;
}

/** Fold occurrence rows into fingerprint groups, aggregating dimensions & first/last seen. */
export function groupErrors(occurrences: readonly ErrorOccurrence[]): ErrorGroup[] {
  const map = new Map<string, ErrorGroup>();
  for (const o of occurrences) {
    const { fingerprint, groupClass, normalizedMessage } = fingerprintError(o);
    const existing = map.get(fingerprint);
    if (!existing) {
      map.set(fingerprint, {
        fingerprint, groupClass, kind: o.kind, normalizedMessage,
        representativeRoute: o.route,
        count: o.count, sessions: o.sessions,
        routes: [o.route], browsers: [o.browser], releases: [o.release],
        firstSeen: o.firstSeen ?? null, lastSeen: o.lastSeen ?? null,
      });
    } else {
      existing.count += o.count;
      existing.sessions += o.sessions; // upper bound (sessions may overlap across rows) — labeled as such in UI
      if (!existing.routes.includes(o.route)) existing.routes.push(o.route);
      if (!existing.browsers.includes(o.browser)) existing.browsers.push(o.browser);
      if (!existing.releases.includes(o.release)) existing.releases.push(o.release);
      existing.firstSeen = minIso(existing.firstSeen, o.firstSeen);
      existing.lastSeen = maxIso(existing.lastSeen, o.lastSeen);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}
