// WEB-OPT-11 — Runtime Telemetry collection engine.
//
// Design goals:
//  - Native browser APIs only (PerformanceObserver / Performance / navigator). No new dependency.
//  - Zero React coupling: collectors write into module-level bounded ring buffers. The Admin
//    dashboard PULLS a snapshot on demand — collection never triggers a re-render → minimal overhead.
//  - Privacy: URLs are stripped of query strings + ids (reuses bootRecovery.sanitizePath); error
//    messages are redacted (email/JWT/uuid/long-number) and truncated. No tokens/PII stored.
//  - Fully feature-detected + try/catch guarded so it can never break app boot.
//  - Errors are NEVER sampled. High-frequency streams are bounded by fixed-size ring buffers.

import { sanitizePath, BUILD_ID } from '@/lib/bootRecovery';
import { rateVital, type Rating, type VitalName } from './aggregate';

// ---------------------------------------------------------------------------
// Sample shapes (all privacy-safe: no ids, tokens, emails, or free-form user text)
// ---------------------------------------------------------------------------
export type ApiKind = 'rest' | 'rpc' | 'storage' | 'auth' | 'other';
export type ErrorKind =
  | 'js' | 'unhandledrejection' | 'chunk-load' | 'react' | 'resource' | 'other';

export interface VitalSample { name: VitalName; value: number; rating: Rating; ts: number; }
export interface LongTaskSample { duration: number; startTime: number; route: string; ts: number; }
export interface ApiSample { name: string; kind: ApiKind; duration: number; transferKb: number | null; ts: number; }
export interface RouteSample { route: string; prevRoute: string | null; duration: number | null; ts: number; }
export interface InteractionSample { kind: string; duration: number; ts: number; }
export interface ErrorSample { kind: ErrorKind; message: string; route: string; ts: number; }
export interface MemorySample { usedMb: number; totalMb: number; limitMb: number; ts: number; }

export interface DeviceProfile {
  browser: string;
  os: string;
  viewport: string;
  dpr: number;
  deviceMemoryGb: number | null;
  hardwareConcurrency: number | null;
  networkType: string | null;
  language: string;
  timezone: string;
  touch: boolean;
  reducedMotion: boolean;
  darkMode: boolean;
}

// ---------------------------------------------------------------------------
// Bounded ring buffer
// ---------------------------------------------------------------------------
class Ring<T> {
  private buf: T[] = [];
  constructor(private readonly cap: number) {}
  push(item: T): void {
    this.buf.push(item);
    if (this.buf.length > this.cap) this.buf.shift();
  }
  all(): readonly T[] { return this.buf; }
  clear(): void { this.buf = []; }
  get size(): number { return this.buf.length; }
}

const vitalsRing = new Ring<VitalSample>(60);
const longTaskRing = new Ring<LongTaskSample>(200);
const apiRing = new Ring<ApiSample>(300);
const routeRing = new Ring<RouteSample>(200);
const interactionRing = new Ring<InteractionSample>(200);
const errorRing = new Ring<ErrorSample>(200); // errors are NEVER sampled/dropped except by cap
const memoryRing = new Ring<MemorySample>(120);

const latestVitals: Partial<Record<VitalName, VitalSample>> = {};
let clsValue = 0;
let worstInteraction = 0;

let currentRoute = '/';
let deviceProfile: DeviceProfile | null = null;
let initialized = false;

// ---------------------------------------------------------------------------
// Privacy helpers
// ---------------------------------------------------------------------------
function sanitizeMessage(msg: string): string {
  return String(msg)
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[email]')
    .replace(/eyJ[A-Za-z0-9_-]{8,}/g, '[jwt]')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[uuid]')
    .replace(/\b\d{6,}\b/g, '[num]')
    .slice(0, 300);
}

function classifyApiKind(u: URL): ApiKind {
  const p = u.pathname;
  if (p.includes('/rest/v1/rpc/')) return 'rpc';
  if (p.includes('/rest/v1/')) return 'rest';
  if (p.includes('/storage/v1/')) return 'storage';
  if (p.includes('/auth/v1/')) return 'auth';
  return 'other';
}

function sanitizeUrl(url: string): { name: string; kind: ApiKind } {
  try {
    const u = new URL(url, window.location.href);
    return { name: `${u.host}${sanitizePath(u.pathname)}`, kind: classifyApiKind(u) };
  } catch {
    return { name: 'unknown', kind: 'other' };
  }
}

function now(): number {
  try { return Math.round(performance.now()); } catch { return 0; }
}

// ---------------------------------------------------------------------------
// Public record API (also called from React error boundary / route hook)
// ---------------------------------------------------------------------------
export function recordRouteChange(rawPath: string, durationMs: number | null): void {
  const route = sanitizePath(rawPath);
  const prev = currentRoute;
  currentRoute = route;
  routeRing.push({ route, prevRoute: prev === route ? null : prev, duration: durationMs, ts: now() });
  sampleMemory();
}

export function recordInteraction(kind: string, durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  interactionRing.push({ kind: String(kind).slice(0, 32), duration: Math.round(durationMs), ts: now() });
}

export function recordError(kind: ErrorKind, message: unknown): void {
  errorRing.push({
    kind,
    message: sanitizeMessage(message instanceof Error ? message.message : String(message ?? 'error')),
    route: currentRoute,
    ts: now(),
  });
}

export function sampleMemory(): void {
  try {
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    if (!mem) return;
    const mb = (b: number) => Math.round(b / 1048576);
    memoryRing.push({ usedMb: mb(mem.usedJSHeapSize), totalMb: mb(mem.totalJSHeapSize), limitMb: mb(mem.jsHeapSizeLimit), ts: now() });
  } catch { /* unsupported */ }
}

// ---------------------------------------------------------------------------
// Device profile (computed once; no PII)
// ---------------------------------------------------------------------------
function detectBrowser(ua: string): string {
  if (/edg\//i.test(ua)) return 'Edge';
  if (/chrome|crios/i.test(ua)) return 'Chrome';
  if (/firefox|fxios/i.test(ua)) return 'Firefox';
  if (/safari/i.test(ua)) return 'Safari';
  return 'Other';
}
function detectOs(ua: string): string {
  if (/windows/i.test(ua)) return 'Windows';
  if (/mac os|macintosh/i.test(ua)) return 'macOS';
  if (/android/i.test(ua)) return 'Android';
  if (/iphone|ipad|ios/i.test(ua)) return 'iOS';
  if (/linux/i.test(ua)) return 'Linux';
  return 'Other';
}

function buildDeviceProfile(): DeviceProfile {
  const ua = navigator.userAgent || '';
  const nav = navigator as unknown as { deviceMemory?: number; connection?: { effectiveType?: string } };
  const mm = (q: string) => { try { return window.matchMedia(q).matches; } catch { return false; } };
  let tz = 'unknown';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown'; } catch { /* noop */ }
  return {
    browser: detectBrowser(ua),
    os: detectOs(ua),
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100,
    deviceMemoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    hardwareConcurrency: typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : null,
    networkType: nav.connection?.effectiveType ?? null,
    language: navigator.language || 'unknown',
    timezone: tz,
    touch: 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0,
    reducedMotion: mm('(prefers-reduced-motion: reduce)'),
    darkMode: mm('(prefers-color-scheme: dark)'),
  };
}

// ---------------------------------------------------------------------------
// PerformanceObserver wiring
// ---------------------------------------------------------------------------
function pushVital(name: VitalName, value: number): void {
  const s: VitalSample = { name, value: Math.round(value * 1000) / 1000, rating: rateVital(name, value), ts: now() };
  latestVitals[name] = s;
  vitalsRing.push(s);
}

function observe(type: string, cb: (entries: PerformanceEntryList) => void): void {
  try {
    const po = new PerformanceObserver((list) => cb(list.getEntries()));
    // buffered:true replays entries that fired before init.
    po.observe({ type, buffered: true } as PerformanceObserverInit);
  } catch { /* type unsupported in this browser */ }
}

function wireObservers(): void {
  // FCP
  observe('paint', (entries) => {
    for (const e of entries) if (e.name === 'first-contentful-paint') pushVital('FCP', e.startTime);
  });
  // LCP (keep the latest/largest candidate)
  observe('largest-contentful-paint', (entries) => {
    const last = entries[entries.length - 1] as (PerformanceEntry & { renderTime?: number; loadTime?: number }) | undefined;
    if (last) pushVital('LCP', last.renderTime || last.loadTime || last.startTime);
  });
  // CLS (cumulative, excluding shifts after recent input — the standard approximation)
  observe('layout-shift', (entries) => {
    for (const e of entries) {
      const ls = e as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
      if (!ls.hadRecentInput && typeof ls.value === 'number') clsValue += ls.value;
    }
    pushVital('CLS', clsValue);
  });
  // INP≈ (worst interaction latency via Event Timing — event-timing based, see report caveat)
  observe('event', (entries) => {
    for (const e of entries) {
      if (e.duration > 0) {
        recordInteraction(e.name, e.duration);
        if (e.duration > worstInteraction) {
          worstInteraction = e.duration;
          pushVital('INP', worstInteraction);
        }
      }
    }
  });
  // Long tasks
  observe('longtask', (entries) => {
    for (const e of entries) longTaskRing.push({ duration: Math.round(e.duration), startTime: Math.round(e.startTime), route: currentRoute, ts: now() });
  });
  // API timing via resource entries (fetch/xhr only → the app's REST/RPC/Storage/Auth calls + /api)
  observe('resource', (entries) => {
    for (const e of entries) {
      const r = e as PerformanceResourceTiming;
      if (r.initiatorType !== 'fetch' && r.initiatorType !== 'xmlhttprequest') continue;
      const { name, kind } = sanitizeUrl(r.name);
      const transfer = typeof r.transferSize === 'number' && r.transferSize > 0 ? Math.round(r.transferSize / 1024) : null;
      apiRing.push({ name, kind, duration: Math.round(r.duration), transferKb: transfer, ts: now() });
    }
  });
  // TTFB from the navigation entry
  try {
    const navEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (navEntry && typeof navEntry.responseStart === 'number') pushVital('TTFB', navEntry.responseStart);
  } catch { /* noop */ }
}

function wireErrorHandlers(): void {
  try {
    window.addEventListener('error', (ev) => {
      const target = ev.target as (HTMLElement & { src?: string; href?: string }) | null;
      if (target && (target.src || target.href) && target !== (window as unknown)) {
        recordError('resource', target.src || target.href || 'resource error');
      } else {
        recordError('js', ev.message || ev.error);
      }
    }, true);
    window.addEventListener('unhandledrejection', (ev) => {
      const reason = (ev as PromiseRejectionEvent).reason;
      const msg = reason instanceof Error ? reason.message : String(reason);
      recordError(/chunk|dynamically imported|Loading .*failed/i.test(msg) ? 'chunk-load' : 'unhandledrejection', msg);
    });
  } catch { /* noop */ }
}

// ---------------------------------------------------------------------------
// init (idempotent, guarded)
// ---------------------------------------------------------------------------
export function initTelemetry(): void {
  if (initialized) return;
  if (typeof window === 'undefined' || typeof performance === 'undefined') return;
  initialized = true;
  try {
    deviceProfile = buildDeviceProfile();
    if (typeof PerformanceObserver !== 'undefined') wireObservers();
    wireErrorHandlers();
    sampleMemory();
  } catch { /* telemetry must never break the app */ }
}

export function isTelemetryReady(): boolean { return initialized; }

// ---------------------------------------------------------------------------
// Snapshot for the Admin dashboard (pull-based; cheap read of current buffers)
// ---------------------------------------------------------------------------
export interface TelemetrySnapshot {
  buildId: string;
  device: DeviceProfile | null;
  vitals: VitalSample[];
  longTasks: readonly LongTaskSample[];
  apis: readonly ApiSample[];
  routes: readonly RouteSample[];
  interactions: readonly InteractionSample[];
  errors: readonly ErrorSample[];
  memory: readonly MemorySample[];
  capturedAt: number;
}

export function getTelemetrySnapshot(): TelemetrySnapshot {
  sampleMemory();
  return {
    buildId: BUILD_ID,
    device: deviceProfile,
    vitals: Object.values(latestVitals) as VitalSample[],
    longTasks: longTaskRing.all(),
    apis: apiRing.all(),
    routes: routeRing.all(),
    interactions: interactionRing.all(),
    errors: errorRing.all(),
    memory: memoryRing.all(),
    capturedAt: Date.now(),
  };
}

export function clearTelemetry(): void {
  vitalsRing.clear(); longTaskRing.clear(); apiRing.clear(); routeRing.clear();
  interactionRing.clear(); errorRing.clear(); memoryRing.clear();
  for (const k of Object.keys(latestVitals)) delete latestVitals[k as VitalName];
  clsValue = 0; worstInteraction = 0;
}
