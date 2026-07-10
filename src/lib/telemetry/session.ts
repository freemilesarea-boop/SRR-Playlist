// WEB-OBS-1 — Anonymous runtime session id + envelope device dimensions.
//
// The session id is a random opaque token — NOT a user id, never derived from auth. It scopes a
// single page/tab session so the server can order events (session_id, sequence) and count "sessions"
// without ever learning who the user is. It is stored in sessionStorage so a same-tab reload keeps
// one id but a new tab / new session starts fresh (aligns with "session 종료 후 유실 허용").

import type { DeviceProfile } from './collect';
import {
  viewportBucketFor, deviceClassFor, concurrencyBucketFor, memoryBucketFor, networkTypeFor,
  BROWSER_FAMILIES, OS_FAMILIES,
  type BrowserFamily, type OsFamily, type ViewportBucket, type DeviceClass,
  type NetworkType, type ConcurrencyBucket, type MemoryBucket,
} from './schema';

const SESSION_KEY = 'srr-telemetry-session';

/** URL-safe random token (base36). Bounded 16–24 chars → matches schema isValidSessionId. */
function randomToken(): string {
  let s = '';
  try {
    const buf = new Uint8Array(16);
    (globalThis.crypto ?? (globalThis as { msCrypto?: Crypto }).msCrypto)?.getRandomValues(buf);
    for (const b of buf) s += (b % 36).toString(36);
  } catch { /* fall through */ }
  if (s.length < 16) {
    // Deterministic-free fallback WITHOUT Math.random reliance on entropy: mix perf + counter.
    let seed = 0;
    try { seed = Math.floor(performance.now() * 1000); } catch { /* noop */ }
    while (s.length < 20) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; s += (seed % 36).toString(36); }
  }
  return s.slice(0, 22);
}

let memId: string | null = null;

/** Stable per-tab anonymous session id. */
export function getSessionId(): string {
  if (memId) return memId;
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) { memId = existing; return existing; }
  } catch { /* sessionStorage unavailable */ }
  const id = randomToken();
  memId = id;
  try { window.sessionStorage.setItem(SESSION_KEY, id); } catch { /* noop */ }
  return id;
}

/** Per-session monotonic sequence counter (orders events without a wall clock). */
let seq = 0;
export function nextSequence(): number { return seq++; }

/** A unique client event id: `<sessionId>-<sequence>-<rand>` — bounded, dedup key, no PII shape. */
export function newEventId(sessionId: string, sequence: number): string {
  const r = randomToken().slice(0, 6);
  return `${sessionId.slice(0, 12)}${sequence.toString(36)}${r}`.slice(0, 64);
}

// ---------------------------------------------------------------------------
// Device dimensions (pure — derived from the already-PII-free DeviceProfile)
// ---------------------------------------------------------------------------
export interface DeviceDims {
  browser_family: BrowserFamily;
  browser_major: number | null;
  os_family: OsFamily;
  device_class: DeviceClass;
  viewport_bucket: ViewportBucket;
  network_type: NetworkType | null;
  hardware_concurrency_bucket: ConcurrencyBucket | null;
  device_memory_bucket: MemoryBucket | null;
}

function inFamily<T extends string>(list: readonly T[], v: string, fallback: T): T {
  return (list as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** Parse the leading integer from a "WxH" viewport string. */
function viewportWidth(viewport: string): number {
  const n = parseInt(viewport.split('x')[0] ?? '', 10);
  return Number.isFinite(n) ? n : 0;
}

/** Extract the browser MAJOR version from a UA string (bucketing/attribution only — no fingerprint). */
export function browserMajor(ua: string): number | null {
  const patterns = [/edg\/(\d+)/i, /(?:chrome|crios)\/(\d+)/i, /(?:firefox|fxios)\/(\d+)/i, /version\/(\d+).*safari/i];
  for (const re of patterns) {
    const m = ua.match(re);
    if (m) { const n = parseInt(m[1], 10); return Number.isFinite(n) ? n : null; }
  }
  return null;
}

export function buildDeviceDims(profile: DeviceProfile | null, ua: string): DeviceDims {
  if (!profile) {
    return {
      browser_family: 'Other', browser_major: null, os_family: 'Other', device_class: 'unknown',
      viewport_bucket: 'unknown', network_type: null, hardware_concurrency_bucket: null, device_memory_bucket: null,
    };
  }
  const width = viewportWidth(profile.viewport);
  return {
    browser_family: inFamily(BROWSER_FAMILIES, profile.browser, 'Other'),
    browser_major: browserMajor(ua),
    os_family: inFamily(OS_FAMILIES, profile.os, 'Other'),
    device_class: deviceClassFor(width, profile.touch),
    viewport_bucket: viewportBucketFor(width),
    network_type: networkTypeFor(profile.networkType),
    hardware_concurrency_bucket: concurrencyBucketFor(profile.hardwareConcurrency),
    device_memory_bucket: memoryBucketFor(profile.deviceMemoryGb),
  };
}
